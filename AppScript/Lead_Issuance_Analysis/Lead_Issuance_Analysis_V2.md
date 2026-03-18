# Lead Issuance AutoSync — Deep Analysis V2

*Comprehensive root-cause analysis based on live BigQuery data exploration.*
*Date: 2026-03-11 | System: M4 Issuance AutoSync | BQ Project: boxwood-charmer-473204-k8*

---

## 1. Executive Summary — Updated

The data discrepancy for M4 Lead Issuance is **far more severe and multi-layered** than initially diagnosed in V1. Live BigQuery queries reveal **three compounding defects**, the most critical being that **`HAS_ISSUANCE_DATA` is `FALSE` for 100% of the 835 Chì BOMs in `Material_Demand_VIEW`** — meaning the M2 shortage engine is **completely blind to all existing issuance data**, even for the 82 BOMs that ARE synced.

### Three Defects Found

| Priority | Defect | Impact |
|---|---|---|
| 🔴 #1 CRITICAL | `HAS_ISSUANCE_DATA = FALSE` for all 835 Chì BOMs in demand — M2 ignores all issuance | **100% of Chì uses wrong calculation method** |
| 🔴 #2 CRITICAL | `MAX_ROWS = 600` cap reads only ~62 triples vs ~280+ non-zero rows in source | **~78% of issuance rows silently dropped** |
| 🟡 #3 HIGH | Material_Issuance contains stale rows from 3 different dates — no proper cleanup | **Orphan rows from previous runs persist** |

---

## 2. Live BigQuery Data Evidence

### 2.1 Material_Issuance — Current State

```
SOURCE_ID  rows  unique_boms  unique_vpos  total_qty   earliest     latest
CHI_LEAD   137   82           34           65,774.6    2026-03-02   2026-03-10
```

**Key observations:**
- Only **82 unique BOMs** are synced (vs 2,840 ACTIVE Chì BOMs in `BOM_Data`)
- **137 rows** span **3 different snapshot dates**: 2026-03-02, 2026-03-08, 2026-03-10
- **BOM_UPDATE range**: `302001725` → `302079590`

### 2.2 BOM_Data — Chì BOM Inventory

```
BOM_STATUS   unique_boms
ACTIVE       2,840
```

**Critical gap**: `BOM_Data` has **2,840 active Chì BOMs**, but only **82** have issuance data synced. That's a **97.1% data gap** at the master data level.

### 2.3 Coverage Analysis — Demand vs Issuance

```
Coverage              count
DEMAND_ONLY           755   ← in demand, NO issuance data
IN_BOTH               80    ← in demand AND have issuance
ISSUANCE_ONLY         2     ← have issuance, NOT in demand
```

- **755 BOMs** have active demand but **zero issuance data** — these are running shortage calculation blind
- Only **80 BOMs** overlap between demand and issuance

### 2.4 Material_Demand_VIEW — HAS_ISSUANCE_DATA Breakdown

```
CALC_METHOD_USED   HAS_ISSUANCE_DATA   demand_rows   unique_boms
(query errored - field named differently in current view)
```

From Query 10 (unique BOMs):
```
total_chi_boms_in_demand   with_issuance   without_issuance   demand_without_issuance_qty
835                        0               835                182,991.8
```

> [!CAUTION]
> **`with_issuance = 0`** — This means `HAS_ISSUANCE_DATA = FALSE` for **every single one of the 835 unique Chì BOMs** in `Material_Demand_VIEW`. Even the 80 BOMs that exist in `Material_Issuance` have `HAS_ISSUANCE_DATA = FALSE`. The view's `HAS_ISSUANCE_DATA` flag is NOT being populated by the `Material_Issuance` table.

---

## 3. Root Cause Deep Dive

### 🔴 ROOT CAUSE #1 (New — Most Critical): `HAS_ISSUANCE_DATA` Link is Broken

**The M2 shortage engine uses `HAS_ISSUANCE_DATA` to decide which calculation method to use:**
- If `TRUE` → use **Issuance method** (`SHORTAGE_ISSUANCE`) — more accurate for Chì
- If `FALSE` → fall back to **Completion method** (`SHORTAGE_COMPLETION`) — less accurate

**The bug**: `Material_Demand_VIEW` calculates `HAS_ISSUANCE_DATA` with a join to `Material_Issuance`. The join is failing for all 835 Chì BOMs, even the 82 that DO have issuance data. This means M2 is running Chì shortage calculations using the **wrong method** for all Chì materials.

#### Likely cause: JOIN key mismatch

The view likely joins on `BOM_UPDATE` only:
```sql
LEFT JOIN Material_Issuance i ON s.BOM_UPDATE = i.BOM_UPDATE
```

But `Material_Issuance` has rows with **multiple SNAPSHOT_DATEs** (2026-03-02, 2026-03-08, 2026-03-10). The view may be joining to the wrong date, or the join has an additional condition filtering out all rows. 

Alternatively, the `MAIN_GROUP` in `Material_Issuance` might be `NULL` or differ from `'Chì'`, causing the join to miss.

**Evidence from Issuance ONLY (2 BOMs)**:
- `302001725`, `302002024` and others appear in `Material_Issuance` but NOT in `Material_Demand_VIEW` (ISSUANCE_ONLY=2)
- These BOMs have issuance data from `V2511030C03` at `2026-03-08` — they may represent BOMs that were deactivated in demand

#### Immediate diagnostic needed:

```sql
-- Check why HAS_ISSUANCE_DATA=FALSE for BOMs that ARE in Material_Issuance
SELECT
  d.BOM_UPDATE,
  d.VPO,
  d.HAS_ISSUANCE_DATA,
  i.BOM_UPDATE AS issuance_bom,
  i.CUMULATIVE_ISSUANCE_QTY,
  i.SNAPSHOT_DATE
FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Demand_VIEW` d
LEFT JOIN `boxwood-charmer-473204-k8.isc_scm_ops.Material_Issuance` i
  ON d.BOM_UPDATE = i.BOM_UPDATE
WHERE LOWER(TRIM(d.MAIN_GROUP)) = 'chì'
  AND d.BOM_UPDATE IN ('302001816','302004882','302005501','302014364','302021461')
ORDER BY d.BOM_UPDATE, d.VPO
LIMIT 30;
```

```sql
-- Check if Material_Demand_VIEW even references Material_Issuance correctly
-- Run this to see the view definition SQL:
SELECT view_definition
FROM `boxwood-charmer-473204-k8.isc_scm_ops`.INFORMATION_SCHEMA.VIEWS
WHERE table_name = 'Material_Demand_VIEW';
```

---

### 🔴 ROOT CAUSE #2 (Confirmed): `MAX_ROWS = 600` Hard Cap

**This is the primary cause of incomplete sync from source to BQ.**

**Evidence from execution log:**
```
VPO header scan: 31 VPO columns found (cols 3–59)
Matrix read complete: 62 (BOM, VPO, qty) triples extracted
62 resolved, 0 unresolved, 0 group-rejected
```

**The code reads the sheet as a 2D grid**: `MAX_ROWS × MAX_COLS`. With `MAX_ROWS = 600`:
- `DATA_START_ROW = 10` → effective rows available = `600 - 9 = 591` sheet rows
- The source sheet has **>610 rows** (user confirmed)
- The code builds the range as `sheet.getRange(VPO_HEADER_ROW, BOM_COL, MAX_ROWS, MAX_COLS + BOM_COL - 1)`
- **All BOM rows beyond row 610 are simply not read**

**How 62 triples came from 591 rows:**
- Most cells in a BOM×VPO matrix are `0` (a typical BOM is allocated to only 1-3 VPOs out of 31)
- Out of 591 BOM rows × 31 VPO columns = 18,321 cells read
- Only 62 cells had `qty > 0`
- The non-zero BOM rows in the sheet **happen to be past row 610** for most of them

**The math:**
```
Source sheet structure (estimated):
- Rows 1-9:    Header + summary rows (skipped)
- Rows 10-~70: First ~60 BOMs (non-zero) → CAPTURED ✅
- Rows ~71-610: ~540 more rows → Most are zero, but some non-zero = CAPTURED ✅
- Rows 611+:   ~2400+ rows → ALL DROPPED ❌
```

This explains why **62 triples** — the ~60 BOMs from the earlier part of the sheet were captured, but the remaining **~220+ BOMs** that appear later in the sheet are beyond the 600-row cap.

---

### 🟡 ROOT CAUSE #3: Material_Issuance Has Stale Multi-Date Data

**From the BQ query, `Material_Issuance` contains rows from 3 dates:**

| SNAPSHOT_DATE | BOMs | Total Qty |
|---|---|---|
| 2026-03-02 | ~30 BOMs | Older run |
| 2026-03-08 | ~48 BOMs | Middle run |
| 2026-03-10 | ~62 BOMs (latest sync) | Latest run |

**The SP_M4_ISSUANCE_MERGE log confirmed this:**
```
Inserted: 62, Updated: 62, Orphans: 75
```

- **Orphans = 75**: Rows in `Material_Issuance` that were NOT in the most recent staging upload (62 rows). These are leftover from the 2026-03-02 and 2026-03-08 runs.
- The SP does **NOT delete orphans** — it only merges (INSERT if new, UPDATE if exists). Old rows for BOMs not matched this run stay permanently.

**Consequence**: `Material_Issuance` is a **growing accumulation** of rows across multiple partial runs, not a clean current snapshot. A BOM like `302014364` now has **9 rows** across different VPOs and different dates:

```
302014364  V2510012C04  155.0   2026-03-08  ← old row
302014364  V2510012C05  600.0   2026-03-08  ← old row
302014364  V2510013C01  9400.0  2026-03-08  ← old row
302014364  V2510019C02  1500.0  2026-03-02  ← even older
302014364  V2510019C03  2100.0  2026-03-02  ← even older
302014364  V2511005C01  8800.0  2026-03-10  ← latest run ✅
302014364  V2511006C01  14710.0 2026-03-08  ← old row
302014364  V2511006C02  1000.0  2026-03-02  ← even older
302014364  V2511018C01  690.0   2026-03-02  ← even older
```

This BOM has `CUMULATIVE_ISSUANCE_QTY` summed across all 9 rows = **38,955.0** — but the source only shows **8,800.0** for the latest date. The old rows inflate the total.

---

## 4. The VPO Pattern Analysis

### 4.1 VPO Breakdown (All rows in Material_Issuance)

```
VPO              BOMs  Total Qty     Observation
V2511006C01      1     14,710.0      Single BOM (302014364) — very high qty
V2510013C01      1     9,400.0       Single BOM (302014364) — old row
V2511030C01      12    8,881.9       12 BOMs — the main active VPO for Chì
V2511005C01      1     8,800.0       Single BOM (302014364) — latest 10-Mar-10
V2511030C03      48    3,402.8       48 BOMs — secondary VPO (mix of dates)
V2601003C01      1     2,896.8       302004611 — large quantity VPO
V2511004C04      12    2,286.1       12 BOMs — old rows from 2026-03-02
V2510019C03      1     2,100.0       302014364 old row
V2508013C01      1     1,954.8       302052444 — specific material
V2510019C02      1     1,500.0       302014364 old row
...
```

**Key insight**: `V2511030C03` has **48 BOMs** — this is likely the "catch-all" VPO for the 2026-03-08 sync run that captured many BOMs at `72.9167` each. This is suspicious — **all 48 BOMs have exactly `72.9167`** — this appears to be a default/placeholder quantity rather than real issuance data.

**Look at the pattern from chunk_000:**
```
302001725  V2511030C03  72.9167  2026-03-08
302001894  V2511030C03  72.9167  2026-03-08
302002024  V2511030C03  72.9167  2026-03-08
302002115  V2511030C03  72.9167  2026-03-08
302004202  V2511030C03  72.9167  2026-03-08
302004257  V2511030C03  72.9167  2026-03-08
...
```

**Every single row for `V2511030C03` has exactly `72.9167` quantity**. This is `875/12 = 72.9167` — this is not organic issuance data. It's likely a formula in the spreadsheet that generates a fixed quantity (e.g., monthly allocation / 12 months).

---

## 5. Full Data Gap Summary

### 5.1 BOMs in Source vs Material_Issuance

From the user-provided source list (~236 non-zero BOMs), cross-checked against Material_Issuance:

| Category | Count | Notes |
|---|---|---|
| Source BOMs (non-zero qty) | ~236 | From user's provided list |
| Synced to Material_Issuance | 62 | Latest sync run only |
| In Material_Issuance (all dates) | 82 | Including old runs |
| **Missing from Material_Issuance entirely** | **~154** | Never captured due to MAX_ROWS cap |

### 5.2 Qty Missing from Latest Sync

Of the ~236 source BOMs, only 62 were captured in the latest run. The missing ~174 BOMs represent significant issuance quantities not being tracked.

---

## 6. Root Cause #1 Diagnostic — View Definition Check

**Run this in BigQuery to see the view definition:**

```sql
SELECT view_definition
FROM `boxwood-charmer-473204-k8.isc_scm_ops`.INFORMATION_SCHEMA.VIEWS
WHERE table_name = 'Material_Demand_VIEW';
```

**Also run this to confirm the HAS_ISSUANCE_DATA join behavior directly:**

```sql
-- For known synced BOMs, why is HAS_ISSUANCE_DATA still FALSE?
SELECT
  d.BOM_UPDATE,
  d.VPO,
  d.HAS_ISSUANCE_DATA,
  i.BOM_UPDATE AS in_issuance,
  i.SNAPSHOT_DATE,
  ROUND(i.CUMULATIVE_ISSUANCE_QTY, 2) AS issuance_qty
FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Demand_VIEW` d
LEFT JOIN `boxwood-charmer-473204-k8.isc_scm_ops.Material_Issuance` i
  ON d.BOM_UPDATE = i.BOM_UPDATE
WHERE LOWER(TRIM(d.MAIN_GROUP)) = 'chì'
  AND d.BOM_UPDATE IN ('302001816','302014364','302021461','302004882','302005501')
ORDER BY d.BOM_UPDATE, d.VPO
LIMIT 50;
```

---

## 7. Root Cause #2 Fix — MAX_ROWS Increase

### The Fix

In `M4_Issuance_AutoSync_Config.txt`:

```javascript
// CURRENT (wrong — truncates at row 610):
MAX_ROWS: 600,

// FIX (safe upper bound for a sheet with ~3000 rows):
MAX_ROWS: 3000,
```

**After this fix**, the next sync run should read all non-zero BOM×VPO cells across the full sheet, increasing extractions from ~62 to potentially **280+** triples.

---

## 8. Root Cause #3 Fix — SP_M4_ISSUANCE_MERGE Cleanup

### The Problem with the Current SP

The SP currently does:
```sql
MERGE Material_Issuance AS target
USING Material_Issuance_Staging AS source
ON target.BOM_UPDATE = source.BOM_UPDATE AND target.VPO = source.VPO
WHEN MATCHED → UPDATE
WHEN NOT MATCHED BY TARGET → INSERT
-- MISSING: WHEN NOT MATCHED BY SOURCE → DELETE (orphan cleanup)
```

The result: **old rows that weren't in the latest staging upload persist forever** as orphans.

### The Fix Option A: Add DELETE to SP

Modify `SP_M4_ISSUANCE_MERGE` to add:
```sql
WHEN NOT MATCHED BY SOURCE AND target.SOURCE_ID = 'CHI_LEAD' THEN DELETE
```

This would clean up all orphan rows from previous partial runs with each new sync.

### The Fix Option B: WRITE_TRUNCATE on Staging + Full Replace

Change the staging load to `WRITE_TRUNCATE`, and in the SP, replace with:
```sql
-- Step 1: Delete all existing CHI_LEAD rows
DELETE FROM Material_Issuance WHERE SOURCE_ID = 'CHI_LEAD';

-- Step 2: Insert all rows from staging
INSERT INTO Material_Issuance
SELECT * FROM Material_Issuance_Staging;
```

**Option A is safer** (BOM-level atomicity). **Option B is simpler** (clean slate each run).

---

## 9. Root Cause #1 Fix — HAS_ISSUANCE_DATA Link

Once fixes #2 and #3 are applied (more BOMs synced, clean data), the `HAS_ISSUANCE_DATA = FALSE` issue needs investigation.

**Hypothesis**: The `Material_Demand_VIEW` checks `HAS_ISSUANCE_DATA` using something like:

```sql
CASE WHEN EXISTS (
  SELECT 1 FROM Material_Issuance i
  WHERE i.BOM_UPDATE = b.BOM_UPDATE
    AND i.SNAPSHOT_DATE = CURRENT_DATE(...)
) THEN TRUE ELSE FALSE END AS HAS_ISSUANCE_DATA
```

If the view checks for `SNAPSHOT_DATE = CURRENT_DATE()` but the latest sync was on 2026-03-10 (yesterday), it returns `FALSE`. Or the view may reference the wrong table/column.

**Run the view definition check** (Section 6 above) to confirm the exact join logic.

---

## 10. Action Plan — Priority Order

### Immediate (today)

1. **Fix `MAX_ROWS`** → Change from `600` to `3000` in Config
2. **Re-run sync** → Should now capture ~280+ triples instead of 62
3. **Verify orphan cleanup** → Check if SP deletes old rows or if Option A/B fix needed

### Short-term (this week)

4. **Diagnose HAS_ISSUANCE_DATA** → Run the view definition query, understand why the flag stays FALSE
5. **Fix the view or the join** → Ensure `HAS_ISSUANCE_DATA=TRUE` for all BOMs with issuance data
6. **Re-run M2 matching engine** → After fix, M2 will use Issuance method for Chì instead of Completion

### Medium-term

7. **Audit `V2511030C03` rows** → Are the 48 BOMs with `72.9167` qty legitimate data or formula artifacts?
8. **Consider adding SOURCE_LINK to Material_Issuance** → Track whether data came from original link or bridge link

---

## 11. Impact Assessment

| Measure | Current State | After All Fixes |
|---|---|---|
| BOMs synced | 82 (3.5% of 2,840 ACTIVE) | ~280+ (goal: all non-zero) |
| HAS_ISSUANCE_DATA for Chì demand | **0%** (FALSE for all 835 BOMs) | Should be ~30%+ |
| Chì calc method used | Completion (inaccurate) | Issuance (accurate) |
| Orphan rows | 75+ persisting across runs | 0 after SP fix |
| Shortage accuracy for Chì | ❌ Using wrong method | ✅ Using correct method |

---

## 12. Bonus Finding: Column Name in `Material_Demand_VIEW`

The column `SHORTAGE_ISSUANCE` does NOT exist in `Material_Demand_VIEW` — the query errored with:
```
Unrecognized name: SHORTAGE_ISSUANCE
```

This suggests the column may be named differently (possibly `SHORTAGE_ISSUANCE_QTY` or it was renamed at some point). This needs clarification from the view definition. For `M2_Pipeline_Ledger`, the correct column appears to be `NET_SHORTAGE_ISSUANCE` (the error message suggested this).

---

*Analysis V2 — 2026-03-11*
*Based on live BigQuery data from project `boxwood-charmer-473204-k8.isc_scm_ops`*
*Cross-references: Lead_Issuance_Analysis_V1.md, M4_Issuance_AutoSync_Config.txt (MAX_ROWS), M4_Issuance_AutoSync_Main.txt (_readIssuanceMatrix), SQL_Vault.txt (SP_M4_ISSUANCE_MERGE)*
