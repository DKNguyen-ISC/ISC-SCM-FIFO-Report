# Production Order Duplicate — Walkthrough V5

*Date: 2026-03-12 | Status: Recovery IN PROGRESS — R2 type error fixed*
*Supersedes: Walkthrough V4*

---

## 1. R0 & R1 Verification — All Clear ✅

### R0 Confirmed

| PO | Affected BOMs (duplicated) | Other BOMs in Staging (untouched) |
|---|---|---|
| 7576 | 36 BOMs — all `staging_copies = 2` ✅ | — |
| 7577 | 59 BOMs — all `staging_copies = 2` ✅ | — |
| 7923-7935 | 2 BOMs (`300029521`, `300029532`) with 4-5 copies ✅ | ~15 other BOMs per PO — `staging_copies = 1`, still active in Final, untouched |

> The non-duplicated BOMs for POs 7923-7935 (302063xxx, 308019xxx, 313284456, etc.) **were never affected by Query D**. They still have exactly 1 active row in Final and do not need recovery.

### R1 Confirmed (105 rows — perfect match)

| Rows | PO | Verification |
|---|---|---|
| 1–36 | 7576 | 36 BOMs, correct CONSUMPTION, correct FULFILLMENT_MODE (PRIVATE for Bao Bì) ✅ |
| 37–95 | 7577 | 59 BOMs, correct values ✅ |
| 96–105 | 7923/7925/7931/7933/7935 | 2 BOMs each (300029521 + 300029532), BOM_CONSUMPTION = 1.0 ✅ |

All `NEW_FINAL_ID` values **match exactly** the original DEMAND_IDs from Query C — meaning the same deterministic hash will be restored. ✅

---

## 2. R2 Type Error — Root Cause & Fix

### Error

```
Query column 11 has type INT64 which cannot be inserted into column VALID_TO_TS,
which has type TIMESTAMP at [8:1]
```

### Root Cause

BigQuery infers a bare `NULL` literal as `INT64` by default. Column 11 in the INSERT column list is `VALID_TO_TS` (type `TIMESTAMP`). Passing a raw `NULL` creates a type mismatch.

### Fix

```sql
-- OLD (causes error):
NULL                   -- BigQuery infers INT64

-- FIXED:
CAST(NULL AS TIMESTAMP)  -- explicitly typed as TIMESTAMP
```

---

## 3. Fixed Recovery SQL

### Query R2 (Fixed) — Execute Recovery INSERT

```sql
-- R2 FIXED: Surgical recovery INSERT — re-creates exactly 1 active row per
-- (PRODUCTION_ORDER_ID, BOM_UPDATE) for the 7 affected POs.
-- Fix: CAST(NULL AS TIMESTAMP) for the VALID_TO_TS column.
INSERT INTO `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Final`
(BOM_ORDER_LIST_FINAL_ID, PRODUCTION_ORDER_ID, BOM_UPDATE, BOM_CONSUMPTION,
 BOM_TOLERANCE, FULFILLMENT_MODE, ORDER_LIST_NOTE, UPDATED_BY, UPDATED_AT,
 VALID_FROM_TS, VALID_TO_TS)
SELECT
  CONCAT('DEM_', `boxwood-charmer-473204-k8.isc_scm_ops.FN_GENERATE_HASH`(S.PRODUCTION_ORDER_ID, M.BOM)),
  S.PRODUCTION_ORDER_ID,
  S.BOM_UPDATE,
  S.BOM_CONSUMPTION,
  S.BOM_TOLERANCE,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Data` BD
      WHERE BD.BOM_UPDATE = S.BOM_UPDATE AND LOWER(TRIM(BD.MAIN_GROUP)) = 'bao bì'
    ) THEN 'PRIVATE'
    ELSE 'PUBLIC'
  END,
  S.ORDER_LIST_NOTE,
  'RECOVERY_2026_03_12',
  CURRENT_TIMESTAMP(),
  CURRENT_TIMESTAMP(),
  CAST(NULL AS TIMESTAMP)           -- ← FIXED: explicit TIMESTAMP cast
FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Staging` S
LEFT JOIN `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Data` M
  ON S.BOM_UPDATE = M.BOM_UPDATE
WHERE S.PRODUCTION_ORDER_ID IN ('7576', '7577', '7923', '7925', '7931', '7933', '7935')
  AND S.VALIDATION_STATUS = 'PASS'
  AND NOT EXISTS (
    SELECT 1 FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Final` F
    WHERE F.PRODUCTION_ORDER_ID = S.PRODUCTION_ORDER_ID
      AND F.BOM_UPDATE = S.BOM_UPDATE
      AND F.VALID_TO_TS IS NULL
  )
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY S.PRODUCTION_ORDER_ID, S.BOM_UPDATE
  ORDER BY COALESCE(S.BOM_CONSUMPTION, 0) DESC, S.UPLOADED_AT DESC
) = 1;
```

**Expected result:** `This statement added 105 rows to BOM_Order_List_Final.`

---

### Query R3 — Verify: 1 Active Row Per (PO, BOM), 0 Duplicates

```sql
-- R3: Post-recovery check — must show 0 has_duplicates for all 7 POs
SELECT
  PRODUCTION_ORDER_ID,
  COUNT(DISTINCT BOM_UPDATE) AS distinct_active_boms,
  MAX(CASE WHEN cnt > 1 THEN 1 ELSE 0 END) AS has_duplicates
FROM (
  SELECT PRODUCTION_ORDER_ID, BOM_UPDATE, COUNT(*) AS cnt
  FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Final`
  WHERE VALID_TO_TS IS NULL
    AND PRODUCTION_ORDER_ID IN ('7576', '7577', '7923', '7925', '7931', '7933', '7935')
  GROUP BY PRODUCTION_ORDER_ID, BOM_UPDATE
)
GROUP BY PRODUCTION_ORDER_ID
ORDER BY PRODUCTION_ORDER_ID;
```

**Expected:**
```
7576 | 36 | 0
7577 | 59 | 0
7923 |  ~17 (2 recovered + 15 untouched) | 0
7925 |  ~16 | 0
7931 |  ~18 | 0
7933 |  ~17 | 0
7935 |  ~16 | 0
```

> The `distinct_active_boms` for POs 7923-7935 will be higher than 2 — that is correct. The non-duplicated BOMs (302063xxx, 308019xxx, etc.) were never removed from Final and are included in the count.

---

### Step: M2 Force Allocation

After R3 confirms 0 duplicates, run M2 Force Allocation:
> M2 Menu → ⚡ Force Run Allocation

---

### Query R4 — Final SNAPSHOT Health Check

```sql
-- R4: Final system health — run after M2
SELECT
  COUNT(*) AS total_rows,
  COUNT(DISTINCT DEMAND_ID) AS distinct_demand_ids,
  COUNT(*) - COUNT(DISTINCT DEMAND_ID) AS duplicate_rows
FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Demand_SNAPSHOT`;
```

**Expected:**
- `duplicate_rows = 0` ✅
- `total_rows` ≈ 10,661 + 105 = ~10,766

---

## 4. Execution Checklist

```
[ ] Step 1: Run R2 (FIXED above) → expect "added 105 rows"
[ ] Step 2: Run R3 → verify 0 has_duplicates for all 7 POs
[ ] Step 3: M2 Force Allocation
[ ] Step 4: Run R4 → confirm duplicate_rows = 0, total_rows ~10,766
```

---

## 5. Complete Project State

| Phase | Status |
|---|---|
| Phase 1 — Duplicate cleanup (Query D) | ✅ Done — 235 rows expired |
| Phase 2 — SP fix deployed | ✅ Done — QUALIFY + VALID_TO_TS guards live in BQ |
| Phase 3 — Surgical recovery | ⏳ R2 ready to run (type fix applied) |

---

*Walkthrough V5 — 2026-03-12 | Fix: `NULL` → `CAST(NULL AS TIMESTAMP)` for VALID_TO_TS*
