# Production Order Duplicate Analysis V1

*Date: 2026-03-11 | Status: ✅ Root Cause CONFIRMED — Fix Ready*
*Analyst: Antigravity AI + Live BQ Data*
*Scope: `Material_Demand_SNAPSHOT` duplicate rows — System-wide*

---

## 0. The Problem Statement

Following the successful Lead Issuance Fix (V3), a new anomaly was observed in `Material_Demand_SNAPSHOT`. The snapshot for `PRODUCTION_ORDER_ID = 7576` returned **two identical rows** for the same `DEMAND_ID`:

```
DEMAND_ID                              PRODUCTION_ORDER_ID  BOM_UPDATE  VPO
─────────────────────────────────────────────────────────────────────────────
DEM_29da3c32b920cf6e511d5be04c6a0c16  7576                302067330   V2602003C01   ← DUPLICATE ①
DEM_654ebf8cedf4f5e7505f9be8dbf11ae6  7576                302067501   V2602003C01
DEM_29da3c32b920cf6e511d5be04c6a0c16  7576                302067330   V2602003C01   ← DUPLICATE ②
DEM_0af0f299f3a3a618d13477ee5de33aeb  7576                302067374   V2602003C01
DEM_a9e9024f72cf49b93927422bf6a754be  7576                302067396   V2602003C01
```

The user noticed the tab character artifact in `ORDER_LIST_NOTE` on one row and an empty string on the other — a clue that two separate insertions happened.

---

## 1. Live Analysis Results (2026-03-11 15:32 VN Time)

### Global Scope (Q1.3 — SNAPSHOT-wide duplicate scan)

| Metric | Value | Meaning |
|---|---|---|
| Total rows in SNAPSHOT | **11,066** | Full demand load |
| Distinct DEMAND_IDs | **10,936** | After dedup |
| **Duplicate rows** | **130** | ❌ 130 phantom rows inflating shortages |

### Root Cause Verdict (3-hypothesis elimination)

| Hypothesis | Table | Evidence | Verdict |
|---|---|---|---|
| **A — BOM_Order_List_Final dup** | `BOM_Order_List_Final` | Q3.2: `DEM_29da3c32b920...` → **2 rows, both `VALID_TO_TS = NULL`** | ✅ **CONFIRMED — ROOT CAUSE** |
| B — Production_Order SCD2 ghost | `Production_Order` | Q2.3: 0 POs have 2+ active rows | ✅ Ruled out — table is clean |
| C — BOM_Data duplication | `BOM_Data` | Q4.2: 0 BOM_UPDATEs have 2+ rows | ✅ Ruled out — table is clean |

---

## 2. Root Cause — BOM_Order_List_Final Phantom Insertions

### What Q3.2 Confirmed

Both rows for `DEM_29da3c32b920cf6e511d5be04c6a0c16` have:
- `PRODUCTION_ORDER_ID = 7576`
- `BOM_UPDATE = 302067330`
- `VALID_TO_TS = NULL` (both active)
- **`VALID_FROM_TS = 2026-02-28 02:38:07`** — exact same timestamp

The identical timestamps suggest **both rows were inserted in the same execution run** — i.e., the same staging batch was promoted to Final twice in a single `SP_M1_MASTER_MERGE` call.

### What Q3.3 Revealed (Full Scope)

`BOM_Order_List_Final` has **30+ (PO, BOM_UPDATE) pairs with duplicate active entries**:

| PO_ID | BOM_UPDATE | Active Copies | Impact |
|---|---|---|---|
| 7925, 7931, 7923, 7935, 7933 | `300029521` | **5 copies** | Each BOM demand counted 5× |
| 7923, 7925, 7933, 7931, 7935 | `300029532` | **4 copies** | Each BOM demand counted 4× |
| 7577 | `31204203801`, `302067329`, `31323731902`, `302067363`, `302067409`, `302067465`, `302067261`, `308013378`, `330000061`, `330091402`, `302067363`, `330092314` | **2 copies** | Each BOM demand doubled |
| 7576 | `330092198`, `31204203801`, `330000061`, `330091402`, `330092030`, `308013378`, `330092018`, `330092314`, `31323731902` | **2 copies** | Each BOM demand doubled |

### What Q5.2 Confirmed (Live VIEW also affected)

The **live `Material_Demand_VIEW`** also returns duplicates — proving this is not a stale snapshot issue:

```
DEMAND_ID                              occurrences  PO_ID
DEM_5d4e77025db48cdaa2bf1784e5...          5         7931
DEM_6d8948c52f070fcb6a0b0f66a6...          5         7933
DEM_210d59b0b0431547a63ef904b7...          5         7923
DEM_a1c7afee9b5db19fcb76380f7c...          5         7925
DEM_89b63f67c9c6919cb2c22236e4...          5         7935
...
20 DEMAND_IDs shown, all belong to POs 7576, 7577, 7923, 7925, 7931, 7933, 7935
```

### Why Both `VALID_TO_TS = NULL` for Same (PO, BOM)?

`SP_M1_MASTER_MERGE` Part 2 (Resurrection Logic) checks:

```sql
AND NOT EXISTS (
  SELECT 1 FROM BOM_Order_List_Final F
  WHERE F.PRODUCTION_ORDER_ID = S.PRODUCTION_ORDER_ID
    AND F.BOM_UPDATE = S.BOM_UPDATE
    -- ⚠️ MISSING: AND F.VALID_TO_TS IS NULL
)
```

**The bug:** Without `AND F.VALID_TO_TS IS NULL`, this guard checks if ANY row (including expired ones) exists in Final. If a row was previously expired (`VALID_TO_TS IS NOT NULL`) and the staging shows the same (PO, BOM) again, the guard passes and **a new active row is inserted** — even though an active version may also exist from the gate batch.

- **Scenario 1**: Staging row FAIL → expires in Final → re-uploaded → PASS_RETROACTIVE inserts a second active copy
- **Scenario 2**: `SP_SPLIT_BATCH_GATE` inserts a new active row AND `SP_M1_MASTER_MERGE` inserts another in the same day
- **Scenario 3**: POs 7923/7925/7931/7933/7935 with BOM `300029521` having 5 copies suggest 5 re-upload cycles where the guard silently passed

---

## 3. Impact Assessment

### Demand Inflation

For any (PO, BOM) pair with `N` active copies in `BOM_Order_List_Final`:
- `GROSS_DEMAND_QTY` is counted **N times** in `Material_Demand_SNAPSHOT`
- `NET_SHORTAGE_QTY` in `PR_Draft` is inflated by factor N
- For BOM `300029521` + POs `7923/7925/7931/7933/7935` with 5 copies: **demand is 5× overcounted**

### Affected POs (confirmed)

| PO_ID | VPO | Condition | Max Duplication Factor |
|---|---|---|---|
| 7576 | V2602003C01 | PARTIALLY_RELEASED | 2× |
| 7577 | (sibling VPO) | — | 2× |
| 7923, 7925, 7931, 7933, 7935 | — | — | **5×** |

---

## 4. SQL Queries to Run in BigQuery Console

Paste these into the [BigQuery Console](https://console.cloud.google.com/bigquery?project=boxwood-charmer-473204-k8).

---

### Query A — Confirm Full Scope of BOM_Order_List_Final Duplicates

```sql
-- Q-A: All (PO, BOM) pairs with more than 1 active row
-- Run this FIRST to see the complete picture
SELECT
  PRODUCTION_ORDER_ID,
  BOM_UPDATE,
  COUNT(*) AS active_entries,
  ARRAY_AGG(BOM_ORDER_LIST_FINAL_ID ORDER BY VALID_FROM_TS) AS all_ids,
  ARRAY_AGG(ORDER_LIST_NOTE ORDER BY VALID_FROM_TS) AS all_notes
FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Final`
WHERE VALID_TO_TS IS NULL
GROUP BY PRODUCTION_ORDER_ID, BOM_UPDATE
HAVING COUNT(*) > 1
ORDER BY active_entries DESC, PRODUCTION_ORDER_ID;
```

---

### Query B — Count Total Phantom Rows (Scope of Cleanup)

```sql
-- Q-B: How many BOM_Order_List_Final rows need to be expired?
WITH dup_info AS (
  SELECT
    PRODUCTION_ORDER_ID,
    BOM_UPDATE,
    COUNT(*) AS active_entries,
    MAX(VALID_FROM_TS) AS latest_ts
  FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Final`
  WHERE VALID_TO_TS IS NULL
  GROUP BY PRODUCTION_ORDER_ID, BOM_UPDATE
  HAVING COUNT(*) > 1
)
SELECT
  SUM(active_entries - 1) AS rows_to_expire,  -- all except the latest 1
  COUNT(*) AS affected_pairs,
  SUM(active_entries) AS total_active_in_affected_pairs
FROM dup_info;
```

---

### Query C — Preview Which Rows Will Be Expired (Safe Preview)

```sql
-- Q-C: Which specific BOM_ORDER_LIST_FINAL_IDs are the OLDER duplicates?
-- These are the ones that will be expired (not deleted)
WITH ranked AS (
  SELECT
    BOM_ORDER_LIST_FINAL_ID,
    PRODUCTION_ORDER_ID,
    BOM_UPDATE,
    VALID_FROM_TS,
    ROW_NUMBER() OVER (
      PARTITION BY PRODUCTION_ORDER_ID, BOM_UPDATE
      ORDER BY VALID_FROM_TS DESC  -- Keep the NEWEST (latest VALID_FROM_TS)
    ) AS rn
  FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Final`
  WHERE VALID_TO_TS IS NULL
),
dup_pairs AS (
  SELECT PRODUCTION_ORDER_ID, BOM_UPDATE
  FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Final`
  WHERE VALID_TO_TS IS NULL
  GROUP BY PRODUCTION_ORDER_ID, BOM_UPDATE
  HAVING COUNT(*) > 1
)
SELECT
  r.BOM_ORDER_LIST_FINAL_ID AS id_to_expire,
  r.PRODUCTION_ORDER_ID,
  r.BOM_UPDATE,
  r.VALID_FROM_TS,
  r.rn
FROM ranked r
JOIN dup_pairs d
  ON r.PRODUCTION_ORDER_ID = d.PRODUCTION_ORDER_ID
  AND r.BOM_UPDATE = d.BOM_UPDATE
WHERE r.rn > 1  -- All except rank 1 (the newest)
ORDER BY r.PRODUCTION_ORDER_ID, r.BOM_UPDATE, r.rn;
```

> ⚠️ **Review this result BEFORE running the fix.** Confirm the rows look correct.

---

### Query D — THE FIX: Expire All Older Duplicate Rows

```sql
-- Q-D: PRODUCTION FIX — Expire all duplicate (PO, BOM) entries except the newest
-- Run ONLY after reviewing Query C
UPDATE `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Final`
SET
  VALID_TO_TS = CURRENT_TIMESTAMP(),
  UPDATED_BY = 'DEDUP_FIX_2026_03_11',
  UPDATED_AT = CURRENT_TIMESTAMP()
WHERE VALID_TO_TS IS NULL
  AND BOM_ORDER_LIST_FINAL_ID IN (
    -- Find all non-newest active rows for any (PO, BOM) with duplicates
    SELECT BOM_ORDER_LIST_FINAL_ID
    FROM (
      SELECT
        BOM_ORDER_LIST_FINAL_ID,
        ROW_NUMBER() OVER (
          PARTITION BY PRODUCTION_ORDER_ID, BOM_UPDATE
          ORDER BY VALID_FROM_TS DESC
        ) AS rn
      FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Final`
      WHERE VALID_TO_TS IS NULL
    )
    WHERE rn > 1  -- All except rank 1 (the newest per (PO, BOM) pair)
  );
```

**After running, verify:**
```sql
-- Q-D-verify: Should return 0 rows
SELECT COUNT(*) AS remaining_duplicates
FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Final`
WHERE VALID_TO_TS IS NULL
GROUP BY PRODUCTION_ORDER_ID, BOM_UPDATE
HAVING COUNT(*) > 1;
```

---

### Query E — After Fix: Re-run M2 and Verify SNAPSHOT

After running Q-D and re-running M2, verify the snapshot was cleaned:
```sql
-- Q-E: SNAPSHOT should now have 0 duplicates
SELECT
  COUNT(*) AS total_rows,
  COUNT(DISTINCT DEMAND_ID) AS distinct_demand_ids,
  COUNT(*) - COUNT(DISTINCT DEMAND_ID) AS duplicate_rows
FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Demand_SNAPSHOT`;
-- Expected: total_rows = distinct_demand_ids, duplicate_rows = 0
```

---

## 5. SP_M1_MASTER_MERGE Code Fix (Prevention)

### The Bug in Resurrection Logic (Part 2)

**File:** `ISC_SCM_Core_Lib/SQL_Vault.txt` → `SP_M1_MASTER_MERGE` → Temp Table `Resurrected_Items`

```sql
-- CURRENT (BUG): Checks for existence of ANY F row, including expired ones
AND NOT EXISTS (
  SELECT 1 FROM `...BOM_Order_List_Final` F
  WHERE F.PRODUCTION_ORDER_ID = S.PRODUCTION_ORDER_ID
    AND F.BOM_UPDATE = S.BOM_UPDATE
)

-- FIX: Only block insertion if an ACTIVE row already exists
AND NOT EXISTS (
  SELECT 1 FROM `...BOM_Order_List_Final` F
  WHERE F.PRODUCTION_ORDER_ID = S.PRODUCTION_ORDER_ID
    AND F.BOM_UPDATE = S.BOM_UPDATE
    AND F.VALID_TO_TS IS NULL   -- ← ADD THIS
)
```

### QUALIFY Clause in Resurrected_Items

The resurrection CTE uses:
```sql
QUALIFY ROW_NUMBER() OVER (PARTITION BY PRODUCTION_ORDER_ID, BOM_UPDATE ORDER BY STAGING_ID DESC) = 1;
```

This correctly deduplicates within the staging batch. But even with this dedup, if the Final table already has an active row for that (PO, BOM) pair (from `SP_SPLIT_BATCH_GATE`), a second active row is still injected without the `VALID_TO_TS IS NULL` guard.

---

## 6. Fix Implementation Plan

| Step | Action | Tool | Expected Outcome |
|:---:|---|---|---|
| 1 | Run **Query A** on BQ Console | BigQuery | See full scope of duplicates |
| 2 | Run **Query B** on BQ Console | BigQuery | Count rows to expire |
| 3 | Run **Query C** on BQ Console | BigQuery | Preview exact rows to expire |
| 4 | Run **Query D** on BQ Console | BigQuery | Expire all older duplicates |
| 5 | Run **Query D-verify** | BigQuery | Confirm 0 duplicates remain |
| 6 | Run **M2 Force Allocation** | M2 Menu | Regenerate clean SNAPSHOT + PR_Draft |
| 7 | Run **Query E** | BigQuery | Verify SNAPSHOT has 0 duplicate rows |
| 8 | Apply **SP_M1_MASTER_MERGE code fix** | SQL_Vault.txt | Prevent recurrence |
| 9 | Deploy updated SQL via Admin_Infrastructure | Apps Script | Push fix to BQ |

---

## 7. Expected Outcomes After Fix

| Metric | Current | After Fix |
|---|---|---|
| Duplicate rows in SNAPSHOT | **130** | **0** |
| Distinct DEMAND_IDs in SNAPSHOT | 10,936 | ~11,066 (all unique) |
| `PR_Draft` shortages for POs 7923/7925/7931/7933/7935 | **5× overcounted** | Correct |
| `PR_Draft` shortages for POs 7576/7577 | **2× overcounted** | Correct |
| `BOM_Order_List_Final` active rows per (PO, BOM) | Up to 5 | Exactly 1 |

---

## 8. Files Created

| File | Location | Purpose |
|---|---|---|
| `Production_Order_Analysis_V1.md` | `Production_Order_Analysis/` | This document |
| `analyze_production_order.py` | `Production_Order_Analysis/` | Python analysis script (9 sections) |
| `analysis_results.txt` | `Production_Order_Analysis/` | Live BQ query results (generated 2026-03-11 15:32) |

---

*Production Order Analysis V1 — 2026-03-11*
*Root cause CONFIRMED: `BOM_Order_List_Final` phantom insertions (Hypothesis A)*
*Production_Order and BOM_Data are both clean*
*Related: Lead_Issuance_Analysis_V3.md, Post_Lead_Issuance_Analysis_V3.md*
