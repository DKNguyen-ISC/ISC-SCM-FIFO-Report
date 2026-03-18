# Lead Issuance AutoSync — Complete Walkthrough & Fix Guide

*Based on live BigQuery analysis + view definition + execution log data*
*Date: 2026-03-11 | Author: AI Analysis*

---

## 1. What We Know For Sure — Confirmed Facts

Before diving in, here's everything now confirmed with hard evidence:

| # | Fact | Evidence |
|---|---|---|
| ✅ | `MAX_ROWS=600` cap reads only rows 10-610 of source sheet | Log: "62 triples extracted", sheet has >610 rows |
| ✅ | Source sheet has ~280 non-zero (BOM, VPO, qty) cells scattered across 3000+ rows | User confirmed |
| ✅ | `SP_M4_ISSUANCE_MERGE` creates **duplicate rows** for same (BOM, VPO) across runs | `Material_Issuance` has 9 rows for (302014364, V2511005C01) across 3 dates |
| ✅ | `Material_Demand_VIEW` joins `Material_Issuance` on **BOM+VPO** (not BOM alone) | View SQL: `ON L.BOM_UPDATE = I.BOM_UPDATE AND P.VPO = I.VPO` |
| ✅ | `HAS_ISSUANCE_DATA=FALSE` for non-matching VPOs is **by design** (correct behavior) | Expected — issuance data is VPO-specific |
| ✅ | `CALC_METHOD_USED='ISSUANCE'` IS working for rows with matching BOM+VPO | User sample shows `ISSUANCE` method active |
| ✅ | Duplicate (BOM+VPO) rows cause **non-unique join fan-out** in the VIEW | Row 33-41: same demand row produces 9 output rows for 302014364+V2511005C01 |
| ✅ | BOM_Data has 2,840 ACTIVE Chì BOMs | BQ Query 3 |
| ✅ | Only 82 unique BOMs currently in `Material_Issuance` (3% coverage) | BQ Query 2 |

---

## 2. The Three Root Causes — Final Definitive Analysis

### 🔴 BUG #1: `MAX_ROWS = 600` — Source Data Truncation (Primary)

**What happens:**
```
Source sheet layout:
Row 1:     Date header (skip)
Row 2:     VPO column headers: [BOM] [Total] [V2511030C01] [V2511030C03] ... (31 VPOs)
Rows 3-9:  Summary rows (skip)
Row 10:    First BOM data row  ← DATA_START_ROW
...
Row 610:   ← HARD STOP (MAX_ROWS=600, starting from row 1)
Rows 611+: ← ❌ NEVER READ — all data here is silently dropped
```

**Execution log proof:**
```
VPO header scan: 31 VPO columns found (cols 3–59)
Matrix read complete: 62 (BOM, VPO, qty) triples extracted ← from only 600 rows
```

With 31 VPO columns and ~3000 BOM rows, only the BOMs appearing in rows 10-610 are captured. The rest (~78%) are silently ignored.

**Why only 62 triples from 591 rows × 31 cols = 18,321 cells?**  
In a BOM × VPO issuance matrix, most cells are `0`. A typical BOM is only issued to 1-3 specific VPOs out of 31. So 62 non-zero cells across 591 BOM rows is realistic — but it means **~218+ non-zero cells from rows 611+ are missed completely**.

**Fix:**
In `M4_Issuance_AutoSync_Config.txt`, update `MAX_ROWS`:
```javascript
// FROM:
MAX_ROWS: 600,

// TO: (user confirmed >3000 rows in sheet)
MAX_ROWS: 5000,   // Covers full sheet with room to grow
```

> **Why not unlimited?** Google Apps Script reads the entire range as a 2D array at once: `MAX_ROWS × MAX_COLS = 5000 × 300 = 1.5M cells`. This is fine — Apps Script handles 2M cells normally. Setting to 10,000+ risks timeout for very large sheets.

> **Better long-term fix**: Replace the hard cap with dynamic detection: `sheet.getLastRow()` instead of fixed `MAX_ROWS`. This makes the code self-adapting.

---

### 🔴 BUG #2: `SP_M4_ISSUANCE_MERGE` Creates Duplicate Rows — Multi-Date Accumulation (Critical)

**The smoking gun — 9 rows for the same (BOM, VPO) pair:**
```
Material_Issuance for (302014364, V2511005C01):

SNAPSHOT_DATE    CUMULATIVE_ISSUANCE_QTY
2026-03-02       1000.0    ← Run 1 orphan
2026-03-02       1500.0    ← Run 1 orphan
2026-03-02       690.0     ← Run 1 orphan
2026-03-02       2100.0    ← Run 1 orphan
2026-03-08       600.0     ← Run 2 orphan
2026-03-08       9400.0    ← Run 2 orphan
2026-03-08       14710.0   ← Run 2 orphan
2026-03-08       155.0     ← Run 2 orphan
2026-03-10       8800.0    ← Latest run ✅
```

This BOM+VPO has 9 rows across 3 runs. The SP logged `Inserted: 62, Updated: 62` for 62 staging rows — meaning it's INSERTING new rows every run, not UPDATING existing ones.

**Root Cause of the Duplicate Row Bug:**
The SP likely merges on `ISSUANCE_ID = MD5(BOM_UPDATE + VPO + SNAPSHOT_DATE)` — because SNAPSHOT_DATE changes each run, every run generates a NEW `ISSUANCE_ID`, causing INSERT instead of UPDATE.

Or the SP is merging on `ISSUANCE_ID` only, but the ID calculation in the CSV builder includes `SYNC_BATCH_ID` (which changes each run), making every row appear "new".

**Downstream impact:**
The VIEW joins `Material_Issuance` on `BOM_UPDATE + VPO` — when there are 9 rows for one (BOM, VPO), the join produces **9 output rows** for every matching demand record:
```
Demand: 302014364 + V2511005C01 → JOINS TO → 9 issuance rows
Result: 9 output demand rows (WRONG — should be 1)
COALESCE picks an arbitrary CUMULATIVE_ISSUANCE_QTY from the 9 values
GROSS_DEMAND_QTY = MRP_Full_Qty - (random value: 690 or 14710 or 8800?)
```
This means **GROSS_DEMAND_QTY is calculated wrong** for every BOM+VPO with multiple issuance rows.

**Fix — Option B (User's preference): Clean-Slate Replace per Run**

Modify `SP_M4_ISSUANCE_MERGE` to completely replace CHI_LEAD data each run:
```sql
CREATE OR REPLACE PROCEDURE `isc_scm_ops.SP_M4_ISSUANCE_MERGE`(IN p_source_id STRING)
BEGIN
  -- Step 1: Delete ALL existing rows for this source
  DELETE FROM `isc_scm_ops.Material_Issuance`
  WHERE SOURCE_ID = p_source_id;

  -- Step 2: Insert fresh rows from staging
  INSERT INTO `isc_scm_ops.Material_Issuance`
  SELECT
    CONCAT('ISU_', TO_HEX(MD5(CONCAT(BOM_UPDATE, VPO)))) AS ISSUANCE_ID,
    BOM_UPDATE,
    VPO,
    CUMULATIVE_ISSUANCE_QTY,
    SNAPSHOT_DATE,
    SOURCE_BOM_CODE,
    SYNC_BATCH_ID,
    SYNCED_AT,
    SOURCE_ID,
    MAIN_GROUP,
    RESOLUTION_METHOD
  FROM `isc_scm_ops.Material_Issuance_Staging`
  WHERE SOURCE_ID = p_source_id;
END;
```

This guarantees:
- ✅ No accumulation of old rows
- ✅ No duplicates for same (BOM, VPO) 
- ✅ Single authoritative row per (BOM, VPO)
- ✅ Clean `CUMULATIVE_ISSUANCE_QTY` = latest value only

---

### 🟡 BUG #3: `HAS_ISSUANCE_DATA` — By Design, But Amplified by Bug #1

**This was a misdiagnosis in V2.** The VIEW behavior is actually correct:

```sql
-- VIEW join:
LEFT JOIN Material_Issuance I
  ON L.BOM_UPDATE = I.BOM_UPDATE
 AND P.VPO = I.VPO    ← ← ← VPO-specific join (intentional)

-- HAS_ISSUANCE_DATA:
(I.ISSUANCE_ID IS NOT NULL) AS HAS_ISSUANCE_DATA
```

**The design intent:** Issuance data is **per (BOM, VPO) pair** — not just per BOM. For VPO `V2511030C01`, if material was issued to that specific production run, the issuance qty is deducted from demand. For VPO `V2601019C01` (different run), if no material was issued yet, demand = full MRP qty.

**Data from the diagnostic query:**
```
302001816 + V2511030C01 → HAS_ISSUANCE_DATA=TRUE  ✅ (VPO matches issuance)
302001816 + V2511030C02 → HAS_ISSUANCE_DATA=FALSE  (VPO NOT in issuance — correct!)
302001816 + V2601019C01 → HAS_ISSUANCE_DATA=FALSE  (VPO NOT in issuance — correct!)
```

`V2511030C02`, `V2601019C01` etc. don't have issuance yet → they still show full demand. This is **correct behavior** — the demand is real and hasn't been fulfilled yet.

**The real amplification:** Because Bug #1 (MAX_ROWS=600) is catching only ~62 of ~280 non-zero cells, approximately **218 (BOM, VPO) pairs** that SHOULD have `HAS_ISSUANCE_DATA=TRUE` are showing `FALSE`. After fixing Bug #1, many more rows will correctly show `TRUE` and use the Issuance method.

---

## 3. The Fan-Out Row Multiplication Problem

This is a **separate, severe data quality issue** that needs immediate attention.

**What the diagnostic query showed for 302014364 + V2511005C01:**
```
33: 302014364  V2511005C01  TRUE  [date: 2026-03-02]  qty: 1000.0
34: 302014364  V2511005C01  TRUE  [date: 2026-03-02]  qty: 690.0
35: 302014364  V2511005C01  TRUE  [date: 2026-03-10]  qty: 8800.0
36: 302014364  V2511005C01  TRUE  [date: 2026-03-02]  qty: 1500.0  ← Different qty!
37: 302014364  V2511005C01  TRUE  [date: 2026-03-08]  qty: 600.0
... etc (9 rows total)
```

When the VIEW joins on BOM+VPO and finds 9 matching rows:
- The demand record for this (BOM+VPO) is **duplicated 9 times** in the view output
- The `COALESCE(I.CUMULATIVE_ISSUANCE_QTY, 0)` picks an arbitrary value
- `GROSS_DEMAND_QTY` calculation is based on a random issuance qty

**From user's Material_Demand_VIEW sample:**
```
302014364  V2511005C01  ISSUANCE  GROSS_DEMAND_QTY=12535  GROSS_DEMAND_ISSUANCE=10175
```

`10175 = Full_MRP - 8800 (the 2026-03-10 row)` — so BQ apparently applied the LATEST value, but this is **not guaranteed** by SQL without an explicit `ORDER BY` in the join.

**Fixing this is WHY Option B is better** — a clean slate each run means Material_Issuance has exactly 1 row per (BOM, VPO), eliminating fan-out completely.

---

## 4. Complete Diagnostic SQL Suite

### 4.1 Confirm the Duplicate Row Problem

```sql
-- How many duplicates exist in Material_Issuance?
SELECT
  BOM_UPDATE,
  VPO,
  SOURCE_ID,
  COUNT(*) AS row_count,
  COUNT(DISTINCT SNAPSHOT_DATE) AS distinct_dates,
  MIN(SNAPSHOT_DATE) AS oldest_date,
  MAX(SNAPSHOT_DATE) AS newest_date,
  ROUND(MIN(CUMULATIVE_ISSUANCE_QTY), 2) AS min_qty,
  ROUND(MAX(CUMULATIVE_ISSUANCE_QTY), 2) AS max_qty
FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Issuance`
WHERE SOURCE_ID = 'CHI_LEAD'
GROUP BY BOM_UPDATE, VPO, SOURCE_ID
HAVING COUNT(*) > 1
ORDER BY row_count DESC;
```

### 4.2 Check Fan-Out Multiplication in VIEW

```sql
-- How many demand rows are duplicated in the VIEW due to fan-out?
SELECT
  BOM_UPDATE, VPO, MAIN_GROUP,
  COUNT(*) AS view_row_count,  -- Should be 1; if >1, fan-out detected
  COUNT(DISTINCT GROSS_DEMAND_QTY) AS distinct_demand_values  -- Should be 1
FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Demand_VIEW`
WHERE LOWER(TRIM(MAIN_GROUP)) = 'chì'
GROUP BY BOM_UPDATE, VPO, MAIN_GROUP
HAVING COUNT(*) > 1
ORDER BY view_row_count DESC
LIMIT 30;
```

### 4.3 Quantify the MAX_ROWS Impact

```sql
-- How many Chì demand rows currently have HAS_ISSUANCE_DATA=TRUE vs FALSE?
-- This shows impact of Bug #1 (expect to dramatically improve after fix)
SELECT
  HAS_ISSUANCE_DATA,
  CALC_METHOD_USED,
  COUNT(*) AS demand_rows,
  COUNT(DISTINCT BOM_UPDATE) AS unique_boms,
  COUNT(DISTINCT VPO) AS unique_vpos,
  ROUND(SUM(GROSS_DEMAND_QTY), 1) AS total_demand_qty
FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Demand_VIEW`
WHERE LOWER(TRIM(MAIN_GROUP)) = 'chì'
GROUP BY HAS_ISSUANCE_DATA, CALC_METHOD_USED
ORDER BY HAS_ISSUANCE_DATA, CALC_METHOD_USED;
```

### 4.4 Check the SP Merge Key (Critical)

```sql
-- Look at the SP definition to understand its merge key
SELECT routine_definition
FROM `boxwood-charmer-473204-k8.isc_scm_ops`.INFORMATION_SCHEMA.ROUTINES
WHERE routine_name = 'SP_M4_ISSUANCE_MERGE';
```

### 4.5 Identify Exact ISSUANCE_ID Pattern

```sql
-- Are ISSUANCE_IDs unique per (BOM, VPO) or per (BOM, VPO, date)?
SELECT
  ISSUANCE_ID,
  BOM_UPDATE,
  VPO,
  SNAPSHOT_DATE,
  CUMULATIVE_ISSUANCE_QTY,
  SYNC_BATCH_ID
FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Issuance`
WHERE SOURCE_ID = 'CHI_LEAD'
  AND BOM_UPDATE = '302014364'
ORDER BY VPO, SNAPSHOT_DATE;
```

### 4.6 Shortage Calculation Accuracy Check

```sql
-- For BOMs with issuance data: compare Completion vs Issuance method
-- Large deltas = incorrect method causing significant demand miscalculation
SELECT
  BOM_UPDATE,
  VPO,
  ROUND(GROSS_DEMAND_COMPLETION_METHOD, 2) AS completion_demand,
  ROUND(GROSS_DEMAND_ISSUANCE_METHOD, 2) AS issuance_demand,
  ROUND(GROSS_DEMAND_QTY, 2) AS active_demand,
  ROUND(GROSS_DEMAND_COMPLETION_METHOD - GROSS_DEMAND_ISSUANCE_METHOD, 2) AS method_delta,
  HAS_ISSUANCE_DATA,
  CALC_METHOD_USED
FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Demand_VIEW`
WHERE LOWER(TRIM(MAIN_GROUP)) = 'chì'
  AND HAS_ISSUANCE_DATA = TRUE
  AND ABS(GROSS_DEMAND_COMPLETION_METHOD - GROSS_DEMAND_ISSUANCE_METHOD) > 100
ORDER BY ABS(GROSS_DEMAND_COMPLETION_METHOD - GROSS_DEMAND_ISSUANCE_METHOD) DESC
LIMIT 30;
```

### 4.7 The 72.9167 Pattern Investigation

```sql
-- The suspicious V2511030C03 rows that all have qty=72.9167
-- This is 875/12 = 72.9167 — is this a formula or real data?
SELECT
  BOM_UPDATE,
  VPO,
  CUMULATIVE_ISSUANCE_QTY,
  SNAPSHOT_DATE,
  SOURCE_BOM_CODE
FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Issuance`
WHERE VPO = 'V2511030C03'
  AND SOURCE_ID = 'CHI_LEAD'
ORDER BY BOM_UPDATE
LIMIT 60;
-- If ALL rows have exactly 72.9167, this is a formula artifact.
-- This quantity might represent a formula in the sheet: =875/12 or similar.
```

### 4.8 After Fix #1 — Predict New Coverage

```sql
-- After fixing MAX_ROWS, how many Chì VPOs in demand should get issuance data?
-- This tells us the EXPECTED improvements
SELECT
  d.BOM_UPDATE,
  d.VPO,
  d.HAS_ISSUANCE_DATA AS current_has_issuance,
  CASE WHEN i.BOM_UPDATE IS NOT NULL THEN TRUE ELSE FALSE END AS should_have_issuance,
  ROUND(d.GROSS_DEMAND_COMPLETION_METHOD, 2) AS completion_demand,
  ROUND(d.GROSS_DEMAND_ISSUANCE_METHOD, 2) AS issuance_demand
FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Demand_VIEW` d
JOIN (
  -- These are the BOMs confirmed to have issuance data in the source
  SELECT DISTINCT BOM_UPDATE FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Issuance`
  WHERE SOURCE_ID = 'CHI_LEAD'
) i ON d.BOM_UPDATE = i.BOM_UPDATE
WHERE LOWER(TRIM(d.MAIN_GROUP)) = 'chì'
  AND d.HAS_ISSUANCE_DATA = FALSE
ORDER BY d.BOM_UPDATE, d.VPO
LIMIT 50;
```

### 4.9 Method_Override_Config — Confirm Auto-Switch is Active

```sql
-- Verify Chì is correctly configured for ISSUANCE method auto-switch
SELECT * FROM `boxwood-charmer-473204-k8.isc_scm_ops.Method_Override_Config`
WHERE MAIN_GROUP = 'Chì' OR IS_ACTIVE = TRUE
ORDER BY MAIN_GROUP;
```

### 4.10 Net Shortage Impact — What's Currently Wrong

```sql
-- How much net shortage is being calculated with wrong method for Chì?
SELECT
  COUNT(*) AS shortage_rows,
  COUNT(DISTINCT BOM_UPDATE) AS unique_boms,
  HAS_ISSUANCE_DATA,
  ROUND(SUM(NET_SHORTAGE_QTY), 1) AS total_net_shortage,
  ROUND(AVG(NET_SHORTAGE_QTY), 2) AS avg_shortage_per_row
FROM `boxwood-charmer-473204-k8.isc_scm_ops.PR_Draft`
WHERE LOWER(TRIM(MAIN_GROUP)) = 'chì'
GROUP BY HAS_ISSUANCE_DATA
ORDER BY HAS_ISSUANCE_DATA;
```

---

## 5. Fix Sequence — Implementation Order

### Phase 1: Stop the Bleeding (Do Today)

**Step 1.1 — Increase MAX_ROWS in Config**

File: `M4_Issuance_AutoSync_Config.txt`
```javascript
// Line ~66 — CHANGE:
MAX_ROWS: 600,
// TO:
MAX_ROWS: 5000,    // Full sheet coverage
```

**Step 1.2 — Fix SP_M4_ISSUANCE_MERGE (Option B: Clean Slate)**

In BigQuery console, run the new SP definition (see Section 3 above). The new SP deletes all CHI_LEAD rows then inserts fresh staging data each run.

**Step 1.3 — Manual Purge of Current Duplicate Rows**

Before the next sync run, clean up existing duplicates:
```sql
-- Keep only the LATEST snapshot date per (BOM_UPDATE, VPO)
-- Run in BigQuery console to clean existing duplicates
DELETE FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Issuance`
WHERE SOURCE_ID = 'CHI_LEAD'
  AND ISSUANCE_ID NOT IN (
    SELECT ISSUANCE_ID
    FROM (
      SELECT ISSUANCE_ID,
        ROW_NUMBER() OVER (
          PARTITION BY BOM_UPDATE, VPO, SOURCE_ID
          ORDER BY SNAPSHOT_DATE DESC, SYNCED_AT DESC
        ) AS rn
      FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Issuance`
      WHERE SOURCE_ID = 'CHI_LEAD'
    )
    WHERE rn = 1
  );
```

**Step 1.4 — Run the Issuance AutoSync**

After Steps 1.1-1.3, trigger the sync manually. Expected result:
- ~280+ triples extracted (vs 62 before)
- SP deletes existing rows, inserts fresh ~280+ rows
- Material_Issuance: single row per (BOM, VPO)

**Step 1.5 — Force Refresh M2 Matching Engine**

After clean issuance data is loaded, run M2 to recalculate shortages:
```sql
-- Run from Google Sheets M2 menu or directly:
CALL `boxwood-charmer-473204-k8.isc_scm_ops.SP_RUN_MATCHING_ENGINE`();
```

### Phase 2: Long-Term Improvements

**Step 2.1 — Use Dynamic MAX_ROWS Instead of Hard Cap**

Replace `MAX_ROWS` config parameter with dynamic detection in `_readIssuanceMatrix()`:
```javascript
// In M4_Issuance_AutoSync_Main.txt, _readIssuanceMatrix():
// BEFORE:
const maxRows = src.MAX_ROWS || 600;

// AFTER:
const lastRow = sheet.getLastRow();  // Actual used rows
const maxRows = Math.max(lastRow, src.DATA_START_ROW);  // Dynamic
```

**Step 2.2 — Add Duplicate Guard to SP**

Even with Option B (delete+insert), add a QUALIFY check to staging before insert:
```sql
INSERT INTO Material_Issuance
SELECT * FROM Material_Issuance_Staging
WHERE SOURCE_ID = p_source_id
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY BOM_UPDATE, VPO ORDER BY SYNCED_AT DESC
) = 1;  -- Only the latest per (BOM, VPO) pair
```

**Step 2.3 — Investigate V2511030C03 Formula Data**

Run Query 4.7 (above). If all 48 rows have `72.9167 = 875/12`, this is sheet formula data not real issuance. Decide whether to include or exclude formula-generated quantities from sync.

---

## 6. Expected Results After All Fixes

| Metric | Before Fixes | After Phase 1 |
|---|---|---|
| Triples extracted per sync | 62 | ~280+ |
| Unique (BOM, VPO) pairs in Material_Issuance | 82 with duplicates | ~280 clean, unique |
| Rows per (BOM, VPO) | 1-9 rows (duplicates) | Exactly 1 |
| Chì demand rows with HAS_ISSUANCE_DATA=TRUE | Small subset | Substantially higher |
| CUMULATIVE_ISSUANCE_QTY accuracy | Random from fan-out | Exact, latest value |
| GROSS_DEMAND_QTY calculation method | Mixed, some wrong | Correct per BOM+VPO |
| M2 shortage accuracy (Chì) | Degraded (fan-out + old data) | Accurate |

---

## 7. Key Architectural Insight

The system design is **fundamentally sound**:

```
Material_Issuance stores: ONE row per (BOM_UPDATE, VPO)
Material_Demand_VIEW joins: ON BOM_UPDATE + VPO
CUMULATIVE_ISSUANCE_QTY: What was issued for THIS BOM to THIS production run
GROSS_DEMAND_ISSUANCE = MRP_Full_Qty - CUMULATIVE_ISSUANCE_QTY
```

This is the correct approach — each production run (VPO) gets its own issuance deduction. A BOM issued to VPO_A doesn't affect demand for VPO_B.

**The bugs are implementation failures, not design failures:**
1. Config cap too low → source data truncated
2. SP merge key wrong → duplicates accumulate
3. Together → fan-out × wrong quantities

Once fixed, the system will correctly calculate Issuance-method shortages for all Chì materials with actual warehouse data.

---

*Walkthrough V1 — 2026-03-11*
*Next steps: Run SQL diagnostics in Section 4, then execute Phase 1 fixes in order*
