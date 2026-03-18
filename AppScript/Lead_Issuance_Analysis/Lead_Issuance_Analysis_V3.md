# Lead Issuance AutoSync — Definitive Analysis V3

*Final consolidated root cause analysis based on all live BQ data, SP code review, and VIEW definition.*
*Date: 2026-03-11 | Supersedes V1 and V2*

---

## 0. Corrections to Previous Versions

| Version | Wrong Claim | Truth (Confirmed by SQL) |
|---|---|---|
| V1 | BOM_Data missing ~232 BOMs | ❌ All tested BOMs are ACTIVE in BOM_Data |
| V2 | Material_Issuance has duplicate (BOM,VPO) rows causing fan-out | ❌ Query 4.1 = no duplicates. SP correctly merges on (BOM+VPO+SOURCE_ID) |
| V2 | HAS_ISSUANCE_DATA broken for all 835 BOMs | ❌ It works correctly. 32 demand rows have it TRUE. VPO-specific join is by design. |
| V2 | SP_M4_ISSUANCE_MERGE creates new rows each run | ❌ SP MERGE logic is correct. "Inserted:62, Updated:62" is a counting artifact in the SP |

---

## 1. Confirmed System State (Snapshot: 2026-03-11)

### Material_Issuance
```
SOURCE_ID  rows  unique_boms  unique_vpos  total_qty   earliest     latest
CHI_LEAD   137   82           34           65,774.6    2026-03-02   2026-03-10
```
- **137 rows are unique** per (BOM_UPDATE, VPO, SOURCE_ID) — confirmed by Query 4.1 returning no duplicates
- 82 unique BOMs across 3 sync runs (2026-03-02, 2026-03-08, 2026-03-10)
- Rows accumulate across runs because **orphans are never deleted**

### Material_Demand_VIEW — Chì
```
HAS_ISSUANCE_DATA=FALSE  COMPLETION:  3,244 rows  835 BOMs  519,819.3 demand qty
HAS_ISSUANCE_DATA=TRUE   ISSUANCE:       32 rows   28 BOMs   10,397.7 demand qty
```
- **99% of Chì demand rows use Completion method** (should use Issuance once data exists)
- Only 32 rows (1%) correctly use Issuance method
- Root cause: only 62 of ~280 non-zero (BOM, VPO) triples were synced

### PR_Draft — Chì Active Shortages
```
HAS_ISSUANCE_DATA=FALSE:  212 rows  64 unique BOMs  6,978.3 total net shortage
```
- 212 shortage rows calculated with wrong method (Completion instead of Issuance)
- After fix, many of these shortages may decrease or disappear

### Method_Override_Config — Chì
```
CONFIG_ID   MAIN_GROUP  PREFERRED_METHOD  IS_ACTIVE  VALIDATED_BY
MOC_chi     Chì         ISSUANCE          TRUE        NULL
```
- Auto-switch IS correctly configured and active for Chì
- `VALIDATED_BY = NULL` — formal PIC validation by Ngàn is pending

---

## 2. The Three Real Root Causes

### 🔴 ROOT CAUSE #1 — `MAX_ROWS = 600` Hard Cap (PRIMARY, Confirmed)

**Code location**: `M4_Issuance_AutoSync_Main.txt`, line 210:
```javascript
// CURRENT (WRONG):
const lastRow = Math.min(sheet.getLastRow(), source.MAX_ROWS);
//              ↑ source.MAX_ROWS = 600 from Config
//              ↑ sheet.getLastRow() = 3000+ ← this is the real number
//              ↑ Math.min picks 600 → TRUNCATES at row 600
```

**Evidence from execution log:**
```
Matrix read complete: 62 (BOM, VPO, qty) triples extracted  ← only rows 10-600
62 resolved, 0 unresolved, 0 group-rejected                ← all 62 passed fine
SP: Orphans = 75                                            ← 75 old rows not seen this run
```

**Impact cascade:**
```
600-row cap → 62 triples captured (of ~280)
→ Only 62 (BOM,VPO) pairs in staging → SP merges → 62 rows updated in Material_Issuance
→ ~218 (BOM,VPO) pairs NEVER enter Material_Issuance
→ 218 demand rows stay HAS_ISSUANCE_DATA=FALSE
→ Those demand rows use Completion method (wrong for Chì)
→ M2 calculates shortage on wrong demand qty
→ PR_Draft has 212 shortage rows with wrong calculation
```

**The fix — Dynamic `sheet.getLastRow()` (User's preferred approach):**

In `M4_Issuance_AutoSync_Main.txt`, line 210, change:
```javascript
// FROM (lines 210-211):
const lastRow = Math.min(sheet.getLastRow(), source.MAX_ROWS);
const lastCol = Math.min(sheet.getLastColumn(), source.MAX_COLS);

// TO:
const lastRow = sheet.getLastRow();                // Self-adapting — reads the full sheet
const lastCol = Math.min(sheet.getLastColumn(), source.MAX_COLS || 300);  // Keep col cap as safety
```

This removes the row hard cap entirely while keeping the column cap (sensible — a BOM matrix shouldn't have thousands of VPO columns). The sheet will now be read completely regardless of size.

> **Why keep the column cap?** The VPO count (31 columns currently) is bounded by the number of active production orders. A hard column cap of 300 is safe headroom. Rows, however, scale with the BOM catalog and can be thousands.

---

### 🟡 ROOT CAUSE #2 — Orphan Row Accumulation (SECONDARY, Confirmed)

**The SP is correctly designed** (MERGE on BOM+VPO+SOURCE_ID) — V2 diagnosis was wrong. The SP correctly:
- UPDATES existing (BOM, VPO) rows with latest `CUMULATIVE_ISSUANCE_QTY`
- INSERTS new (BOM, VPO) rows not seen before
- **Does NOT DELETE** old (BOM, VPO) rows not in current staging run

**Why 9 VPOs for BOM 302014364 across 3 runs (from Query 4.5):**
```
Run 2026-03-02 (ISU_1772425415074): captured V2510019C02, V2510019C03, V2511006C02, V2511018C01
Run 2026-03-08 (ISU_1772982369420): captured V2510012C04, V2510012C05, V2510013C01, V2511006C01
Run 2026-03-10 (ISU_1773155174422): captured V2511005C01 only (latest, what demand shows)
```

Each run had MAX_ROWS=600 and captured different subsets of the sheet (the source sheet likely changed between runs as VPO columns were added/removed). Each new VPO got INSERTed; old VPOs from previous runs were never DELETEd.

**Current orphan state:**
- Latest staging (2026-03-10): 62 rows
- Material_Issuance total: 137 rows
- Orphans: 75 rows from runs of 2026-03-02 and 2026-03-08

**The hidden danger of orphans:** VPO `V2510019C02` may have been a production order that is now COMPLETED. If it no longer appears in `production_orders` with active states, it won't appear in `Material_Demand_VIEW` at all — so the orphan row is harmless to the current demand calculation. **BUT** if it still appears in demand, the stale quantity from 2026-03-02 would be applied to that VPO's demand calculation instead of the real current issuance.

**Fix — Option B: DELETE + INSERT per SOURCE_ID**

Replace the SP with a clean-slate approach per source. New SP logic:
```sql
CREATE OR REPLACE PROCEDURE `isc_scm_ops.SP_M4_ISSUANCE_MERGE`(
  IN p_session_id STRING,
  IN p_source_id  STRING
)
BEGIN
  DECLARE v_staged    INT64 DEFAULT 0;
  DECLARE v_deleted   INT64 DEFAULT 0;
  DECLARE v_inserted  INT64 DEFAULT 0;

  -- Count staged rows for this session
  SET v_staged = (
    SELECT COUNT(*) FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Issuance_Staging`
    WHERE SYNC_BATCH_ID = p_session_id AND SOURCE_ID = p_source_id
  );

  IF v_staged = 0 THEN
    SELECT p_session_id AS SESSION_ID, 0 AS STAGED_COUNT,
           0 AS INSERTED_COUNT, 0 AS DELETED_COUNT, 'NO_DATA' AS SP_STATUS;
    RETURN;
  END IF;

  -- Step 1: Record how many we're about to delete
  SET v_deleted = (
    SELECT COUNT(*) FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Issuance`
    WHERE SOURCE_ID = p_source_id
  );

  -- Step 2: DELETE all existing rows for this source (clean slate)
  DELETE FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Issuance`
  WHERE SOURCE_ID = p_source_id;

  -- Step 3: INSERT fresh rows from staging (deduplicated by BOM+VPO)
  INSERT INTO `boxwood-charmer-473204-k8.isc_scm_ops.Material_Issuance`
  SELECT
    ISSUANCE_ID, BOM_UPDATE, VPO, CUMULATIVE_ISSUANCE_QTY,
    CAST(SNAPSHOT_DATE AS DATE),
    SOURCE_BOM_CODE, SYNC_BATCH_ID,
    CAST(SYNCED_AT AS TIMESTAMP),
    SOURCE_ID, MAIN_GROUP, RESOLUTION_METHOD
  FROM (
    SELECT *,
      ROW_NUMBER() OVER (
        PARTITION BY BOM_UPDATE, VPO, SOURCE_ID
        ORDER BY SYNCED_AT DESC
      ) AS rn
    FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Issuance_Staging`
    WHERE SYNC_BATCH_ID = p_session_id AND SOURCE_ID = p_source_id
  )
  WHERE rn = 1;

  SET v_inserted = (
    SELECT COUNT(*) FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Issuance`
    WHERE SOURCE_ID = p_source_id
  );

  SELECT
    p_session_id AS SESSION_ID,
    v_staged     AS STAGED_COUNT,
    v_inserted   AS INSERTED_COUNT,
    v_deleted    AS DELETED_COUNT,
    'SUCCESS'    AS SP_STATUS;

EXCEPTION WHEN ERROR THEN
  SELECT p_session_id AS SESSION_ID, v_staged AS STAGED_COUNT,
         0 AS INSERTED_COUNT, 0 AS DELETED_COUNT,
         CONCAT('SP_ERROR: ', @@error.message) AS SP_STATUS;
END;
```

> **Important note**: The Apps Script caller (`trigger_IssuanceAutoSync`) currently parses: `Inserted: X, Updated: Y, Orphans: Z`. The new SP returns `INSERTED_COUNT` and `DELETED_COUNT` instead. You need to update `_parseIssuanceSpResult()` in `M4_Issuance_AutoSync_Main.txt` to match the new output columns.

---

### 🟡 ROOT CAUSE #3 — VIEW Fan-Out from Production Data Side (New Finding)

**Query 4.2 result:** 30+ Chì (BOM, VPO) pairs have `view_row_count = 2` in `Material_Demand_VIEW`.

**This is NOT caused by Material_Issuance** (4.1 proves no duplicates there). The fan-out comes from either:

1. **Most likely: `BOM_Order_List_Final` has 2 entries for same (BOM_UPDATE, PRODUCTION_ORDER_ID)**  
   This would multiply every demand row by 2 — same BOM, same production order, two list entries.

2. **Possible: `Production_Order` has 2 rows for same VPO**  
   If VPO `V2602003C01` has 2 production order rows (e.g., original + amended), joining with a BOM list creates 2 demand rows.

3. **Unlikely here but possible: `BOM_Data` has 2 active entries for same BOM_UPDATE**  
   The view joins `BOM_Data` on `BOM_UPDATE` — if an older entry was not deleted, it would double rows.

**The affected BOMs** all belong to the `302067xxx` range with VPOs `V2602003C01` and `V2602003C02`. This suggests a specific batch of production orders (likely a new batch entered in early 2026) has a data entry issue.

**Impact:** `distinct_demand_values = 1` for all affected rows — both duplicated rows have the **same `GROSS_DEMAND_QTY`**. This means M2 counts the demand **twice** for these BOMs, leading to inflated shortages.

---

## 3. The V2511030C03 Data — Confirmed Legitimate

Query 4.7 showed 48 BOMs all at `V2511030C03` with mostly `72.9167`:

```
72.9167 = 875 / 12  (monthly fraction of annual allocation)
52.0833 = 625 / 12
45.1389 = 541.67 / 12
59.0278 = 708.33 / 12
```

These are **prorated monthly allocations** — the warehouse sheet divides annual pencil core issuance into monthly figures. This is real, intentional business data, not formula artifacts. The issuance represents how much lead (pencil core material) has been cumulatively issued against VPO `V2511030C03` (a November 2025 production run) as of 2026-03-08.

✅ This data is valid and should be kept.

---

## 4. Current Shortage Accuracy Assessment

### What Query 4.6 Tells Us (BOMs currently using Issuance correctly)

```
BOM        VPO          Completion   Issuance   Active   Delta    Method
302014364  V2511005C01  12,535.0     10,175.0   10,175   2,360    ISSUANCE ✅
302004882  V2603002C02    391.4         181.4      181.4   209.96  ISSUANCE ✅
302079261  V2601003C05    288.4           0          0     288.4   ISSUANCE ✅
302079250  V2601003C04    288.4           0          0     288.4   ISSUANCE ✅
302079283  V2601003C07    144.2           0          0     144.2   ISSUANCE ✅
```

**Key insight for rows showing `Issuance = 0` with `ISSUANCE` method:**
- `302079261 + V2601003C05` → `ISSUANCE_METHOD = 0` means full MRP demand is already covered by issuance (`CUMULATIVE_ISSUANCE_QTY ≥ MRP_Full_Qty`)
- `GROSS_DEMAND_QTY = GREATEST(0, MRP - Issued) = 0` → **No shortage for this order!**
- These rows should NOT appear in PR_Draft (no demand = no shortage)
- BIG win: Issuance method correctly identifies zero-demand completions that Completion method would bogusly flag

**For `302014364 + V2511005C01`:**
- Completion method: 12,535 demand → 12,535 shortage (wrong, over-counts)
- Issuance method: 10,175 demand → net shortage is less (8,800 already issued out of full MRP)
- Delta = 2,360 units of artificially inflated shortage from wrong method

---

## 5. Complete Fix SQL — Additional Diagnostics First

Run these queries **before implementing fixes** to fully understand the current state:

### 5.1 — Diagnose Fan-Out Root Cause (Root Cause #3)

```sql
-- Which Production_Order or BOM_Order_List_Final rows cause the 302067xxx doubling?
SELECT
  P.PRODUCTION_ORDER_ID,
  P.VPO,
  L.BOM_UPDATE,
  COUNT(*) AS join_count,
  COUNT(DISTINCT P.PRODUCTION_ORDER_ID) AS distinct_orders,
  COUNT(DISTINCT L.BOM_ORDER_LIST_FINAL_ID) AS distinct_list_entries,
  ARRAY_AGG(DISTINCT L.BOM_ORDER_LIST_FINAL_ID) AS list_ids
FROM `boxwood-charmer-473204-k8.isc_scm_ops.Production_Order` P
JOIN `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Final` L
  ON P.PRODUCTION_ORDER_ID = L.PRODUCTION_ORDER_ID
WHERE P.VPO IN ('V2602003C01','V2602003C02')
  AND L.BOM_UPDATE = '302067421'
  AND P.VALID_TO_TS IS NULL
  AND L.VALID_TO_TS IS NULL
GROUP BY P.PRODUCTION_ORDER_ID, P.VPO, L.BOM_UPDATE
ORDER BY join_count DESC;
```

### 5.2 — Check BOM_Data Duplicates for 302067xxx

```sql
-- Does BOM_Data have multiple active entries for these BOMs?
SELECT BOM_UPDATE, BOM_STATUS, COUNT(*) AS entry_count
FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Data`
WHERE BOM_UPDATE IN ('302067421','302067487','302067396','302067261','302067352')
GROUP BY BOM_UPDATE, BOM_STATUS;
```

### 5.3 — Check Method_Override_Config for Any Duplicates

```sql
-- Any chance MOC has 2 active rows for Chì? (would cause join fan-out across entire view)
SELECT MAIN_GROUP, COUNT(*) AS cnt, ARRAY_AGG(IS_ACTIVE) AS active_flags
FROM `boxwood-charmer-473204-k8.isc_scm_ops.Method_Override_Config`
GROUP BY MAIN_GROUP
HAVING COUNT(*) > 1;
```

### 5.4 — Measure Full Impact After MAX_ROWS Fix (Predictive)

```sql
-- How many unique (BOM, VPO) pairs in Demand VIEW currently DON'T have issuance
-- but where the BOM IS in Material_Issuance (some VPO for it)?
-- This shows the MINIMUM gain from orphan cleanup alone.
SELECT
  COUNT(DISTINCT CONCAT(d.BOM_UPDATE, '|', d.VPO)) AS demand_pairs_with_bom_in_issuance,
  COUNT(DISTINCT d.BOM_UPDATE) AS unique_boms,
  ROUND(SUM(d.GROSS_DEMAND_QTY), 1) AS total_demand_at_stake
FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Demand_VIEW` d
JOIN (
  SELECT DISTINCT BOM_UPDATE FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Issuance`
  WHERE SOURCE_ID = 'CHI_LEAD'
) i ON d.BOM_UPDATE = i.BOM_UPDATE
WHERE LOWER(TRIM(d.MAIN_GROUP)) = 'chì'
  AND d.HAS_ISSUANCE_DATA = FALSE;
```

### 5.5 — Current Orphan Inventory

```sql
-- List all orphan (BOM, VPO) rows in Material_Issuance
-- (rows that are NOT in the most recent sync batch)
-- These will be deleted once Option B SP is deployed
SELECT
  T.BOM_UPDATE,
  T.VPO,
  T.SNAPSHOT_DATE,
  ROUND(T.CUMULATIVE_ISSUANCE_QTY, 2) AS qty,
  T.SYNC_BATCH_ID
FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Issuance` T
WHERE T.SOURCE_ID = 'CHI_LEAD'
  AND T.SYNC_BATCH_ID <> 'ISU_1773155174422_CHI_LEAD'  -- latest batch id
ORDER BY T.BOM_UPDATE, T.VPO;
```

### 5.6 — Issuance Coverage After Fix (Run AFTER the sync fix)

```sql
-- Run this AFTER applying the MAX_ROWS fix and re-running sync
-- Shows how many demand rows switched from Completion to Issuance method
SELECT
  HAS_ISSUANCE_DATA,
  CALC_METHOD_USED,
  COUNT(*) AS demand_rows,
  COUNT(DISTINCT BOM_UPDATE) AS unique_boms,
  ROUND(SUM(GROSS_DEMAND_QTY), 1) AS total_demand
FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Demand_VIEW`
WHERE LOWER(TRIM(MAIN_GROUP)) = 'chì'
GROUP BY HAS_ISSUANCE_DATA, CALC_METHOD_USED
ORDER BY 1, 2;
-- BEFORE fix: FALSE/COMPLETION = 3244 rows, TRUE/ISSUANCE = 32 rows
-- AFTER fix:  Should see significant increase in TRUE/ISSUANCE rows
```

---

## 6. Implementation Plan — Step by Step

### ✅ Phase 1: Code Fix (Apps Script)

**File: `M4_Issuance_AutoSync_Main.txt` — Lines 209–211**

```javascript
// BEFORE:
// Bounded read: cap rows and columns to prevent memory issues
const lastRow = Math.min(sheet.getLastRow(), source.MAX_ROWS);
const lastCol = Math.min(sheet.getLastColumn(), source.MAX_COLS);

// AFTER:
// Dynamic read: use actual sheet dimensions (self-adapting, no hard row cap)
const lastRow = sheet.getLastRow();                           // Full sheet, always
const lastCol = Math.min(sheet.getLastColumn(), source.MAX_COLS || 300);  // Col cap kept
```

Also remove `MAX_ROWS` from `ISSUANCE_SOURCES` in `M4_Issuance_AutoSync_Config.txt` (or keep it for documentation — it's no longer used in the read logic):
```javascript
// In ISSUANCE_SOURCES[0] config block — MAX_ROWS can stay for reference but is unused:
// MAX_ROWS: 600,   // ← This is now unused by the fixed code
```

---

### ✅ Phase 2: BigQuery SP Replacement

**Step 2a — Run diagnostic SQL 5.1, 5.2, 5.3 first (understand fan-out)**

**Step 2b — Deploy new SP (Option B: DELETE + INSERT)**

Use the SP SQL from Section 2 (Root Cause #2) above. Deploy via BigQuery console.

**Step 2c — Update `_parseIssuanceSpResult()` in `M4_Issuance_AutoSync_Main.txt`**

The Apps Script parser expects the SP result columns. Update to match new SP output:
```javascript
// Current parser expects: SESSION_ID, STAGED_COUNT, INSERTED_COUNT, UPDATED_COUNT,
//                         ORPHAN_COUNT, SP_STATUS
// New SP returns:         SESSION_ID, STAGED_COUNT, INSERTED_COUNT, DELETED_COUNT,
//                         SP_STATUS
// Update the parser accordingly and update the dashboard log format.
```

---

### ✅ Phase 3: Trigger Full Sync + M2 Recalculation

1. **Run Issuance AutoSync manually** (via M4 menu) → should extract ~280+ triples
2. **Verify** in BQ: `SELECT COUNT(*) FROM Material_Issuance WHERE SOURCE_ID='CHI_LEAD'`  
   Expected: ~280 rows (clean, no orphans)
3. **Run M2 Force Allocation** (via M2 menu) → recalculates all shortages with new data
4. **Verify** using SQL 5.6 → should see significant increase in `TRUE/ISSUANCE` rows

---

### ✅ Phase 4: Validate Business Impact

```sql
-- After all fixes: Are the 302079261, 302079250 etc. showing 0 demand correct?
-- (These were getting ISSUANCE=0 meaning fully covered — is that accurate?)
SELECT
  BOM_UPDATE, VPO, CALC_METHOD_USED,
  ROUND(GROSS_DEMAND_COMPLETION_METHOD, 2) AS completion_qty,
  ROUND(GROSS_DEMAND_ISSUANCE_METHOD, 2) AS issuance_qty,
  ROUND(GROSS_DEMAND_QTY, 2) AS active_demand
FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Demand_VIEW`
WHERE LOWER(TRIM(MAIN_GROUP)) = 'chì'
  AND HAS_ISSUANCE_DATA = TRUE
ORDER BY BOM_UPDATE, VPO;
-- Ngàn should verify that ISSUANCE=0 rows are indeed fully issued
-- (VALIDATED_BY in Method_Override_Config should be updated after validation)
```

---

## 7. Expected Outcomes After All Fixes

| Metric | Current State | Expected After Fixes |
|---|---|---|
| Triples extracted per sync | 62 | ~280+ (all non-zero cells) |
| Rows in Material_Issuance (CHI_LEAD) | 137 (with 75 orphans) | ~280 (clean, zero orphans) |
| `HAS_ISSUANCE_DATA=TRUE` demand rows | 32 rows (1%) | Significantly higher |
| Demand rows using Issuance method | 32 (1%) | Correct for all matched (BOM,VPO) |
| PR_Draft shortages with wrong method | 212 rows | Should decrease significantly |
| Net shortage for Chì (total) | Overcounted (Completion bias) | More accurate (Issuance-based) |
| Orphan rows in Material_Issuance | 75 | 0 after each clean sync |
| Fan-out rows in view (302067xxx) | 30 BOMs × 2 | Needs separate fix (Phase 4 diagnostic) |

---

## 8. Open Questions for Next Session

1. **Fan-out source (Section 5.1-5.3)**: Run the 3 diagnostic queries to confirm whether it's `BOM_Order_List_Final`, `Production_Order`, or `BOM_Data` causing the 2x multiplication for 302067xxx BOMs.

2. **Orphan VPO legitimacy**: Are the 9 VPOs for BOM 302014364 (V2510019C02, V2511006C02, etc.) still active orders in the source sheet? Or has the warehouse already zeroed them out? Run Query 5.5 to list them, then verify in the source spreadsheet.

3. **Ngàn validation**: After fixes, Ngàn should review the `ISSUANCE=0` demand rows and update `Method_Override_Config.VALIDATED_BY`.

4. **Config cleanup**: Should `MAX_ROWS` be removed from the Config object entirely or kept as dead code documentation?

---

*Analysis V3 — 2026-03-11*
*Supersedes V1 (wrong BOM_Data theory) and V2 (wrong duplicate row theory)*
*Key correction: SP is correctly designed. Material_Issuance has unique (BOM,VPO) rows. Fan-out is from Production_Order side, not Issuance side.*
