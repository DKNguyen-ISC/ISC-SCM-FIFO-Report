# Production Order Duplicate — Walkthrough V4

*Date: 2026-03-12 | Status: Phase 2 ✅ Deployed | Phase 3 — Surgical Recovery (No planner needed)*
*Supersedes: Walkthrough V3*

---

## 1. Phase 2 Verified ✅

Both SPs are confirmed deployed in BigQuery:

```
SP_M1_MASTER_MERGE    ✅ QUALIFY guard present | ✅ VALID_TO_TS guard present
SP_SPLIT_BATCH_GATE   ✅ QUALIFY guard present | ✅ VALID_TO_TS guard present
```

---

## 2. Phase 3 — Surgical Recovery Strategy

### Why We Don't Need the Planner

`BOM_Order_List_Staging` is an **append-only audit table** — every row ever promoted through the gate is still there. The staging records for POs 7576/7577 (from 2026-02-28) and POs 7923/7925/7931/7933/7935 (from 2026-03-03) are preserved with all their BOM consumption, tolerance, and note data.

We can re-generate exactly the correct `BOM_Order_List_Final` entries directly from Staging — using the same identity logic (`FN_GENERATE_HASH`) as the original SP, with the `QUALIFY` guard to ensure exactly 1 clean row per `(PRODUCTION_ORDER_ID, BOM_UPDATE)`.

### Recovery Approach: INSERT from Staging (Not UPDATE)

**Why INSERT into Final rather than trying to UPDATE (reactivate) the expired rows?**

All expired copies are physically identical — same `BOM_ORDER_LIST_FINAL_ID`, same `VALID_FROM_TS`, same data. A BigQuery UPDATE has no way to target "exactly 1 of N identical rows" and set its `VALID_TO_TS = NULL` without affecting all copies. Attempting this would re-create the duplicate problem immediately.

Instead, we INSERT a fresh, new active row for each affected `(PO, BOM_UPDATE)` pair. The expired rows remain as historical audit evidence. The new row has `VALID_FROM_TS = CURRENT_TIMESTAMP()` — which cleanly represents "re-activated 2026-03-12."

```
Expired rows (from cleanup):   [2026-02-28, VALID_TO_TS = 2026-03-12] ← history, stays
Recovery row (new):            [2026-03-12, VALID_TO_TS = NULL       ] ← the new active version
```

---

## 3. Recovery SQL (Run in BigQuery Console)

### Query R0 — Inspect: What Does Staging Have for Affected POs?

Run this first to see what raw material is available in Staging:

```sql
-- R0: Staging inventory for affected POs
-- Shows what data is available as source for recovery
SELECT
  PRODUCTION_ORDER_ID,
  BOM_UPDATE,
  VALIDATION_STATUS,
  COUNT(*) AS staging_copies,
  MAX(COALESCE(BOM_CONSUMPTION, 0)) AS max_consumption,
  MAX(UPLOADED_AT) AS latest_upload
FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Staging`
WHERE PRODUCTION_ORDER_ID IN ('7576', '7577', '7923', '7925', '7931', '7933', '7935')
  AND VALIDATION_STATUS = 'PASS'
GROUP BY PRODUCTION_ORDER_ID, BOM_UPDATE, VALIDATION_STATUS
ORDER BY PRODUCTION_ORDER_ID, BOM_UPDATE;
```

**What to verify:**
- All 7 POs appear with the BOMs you expect
- `staging_copies` confirms we have the source data (1+ copies per BOM is sufficient)

---

### Query R1 — Preview: What Would the Recovery INSERT Create?

Safe SELECT-only query — shows exactly what the INSERT will create before committing:

```sql
-- R1: PREVIEW of recovery rows (SELECT only — no mutation)
-- Run this to inspect before committing with R2
WITH Recovery_Candidates AS (
  SELECT
    CONCAT('DEM_', `boxwood-charmer-473204-k8.isc_scm_ops.FN_GENERATE_HASH`(S.PRODUCTION_ORDER_ID, M.BOM)) AS NEW_FINAL_ID,
    S.PRODUCTION_ORDER_ID,
    S.BOM_UPDATE,
    M.BOM AS PARENT_BOM,
    S.BOM_CONSUMPTION,
    S.BOM_TOLERANCE,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Data` BD
        WHERE BD.BOM_UPDATE = S.BOM_UPDATE AND LOWER(TRIM(BD.MAIN_GROUP)) = 'bao bì'
      ) THEN 'PRIVATE' ELSE 'PUBLIC'
    END AS FULFILLMENT_MODE,
    S.ORDER_LIST_NOTE,
    S.UPLOADED_AT AS ORIGINAL_UPLOAD_AT,
    ROW_NUMBER() OVER (
      PARTITION BY S.PRODUCTION_ORDER_ID, S.BOM_UPDATE
      ORDER BY COALESCE(S.BOM_CONSUMPTION, 0) DESC, S.UPLOADED_AT DESC
    ) AS rn
  FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Staging` S
  LEFT JOIN `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Data` M
    ON S.BOM_UPDATE = M.BOM_UPDATE
  WHERE S.PRODUCTION_ORDER_ID IN ('7576', '7577', '7923', '7925', '7931', '7933', '7935')
    AND S.VALIDATION_STATUS = 'PASS'
)
SELECT
  NEW_FINAL_ID,
  PRODUCTION_ORDER_ID,
  BOM_UPDATE,
  PARENT_BOM,
  BOM_CONSUMPTION,
  BOM_TOLERANCE,
  FULFILLMENT_MODE,
  ORDER_LIST_NOTE,
  ORIGINAL_UPLOAD_AT
FROM Recovery_Candidates
WHERE rn = 1        -- QUALIFY output: exactly 1 row per (PO, BOM_UPDATE)
  AND NOT EXISTS (  -- Safety: skip if an active row already exists
    SELECT 1 FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Final` F
    WHERE F.PRODUCTION_ORDER_ID = Recovery_Candidates.PRODUCTION_ORDER_ID
      AND F.BOM_UPDATE = Recovery_Candidates.BOM_UPDATE
      AND F.VALID_TO_TS IS NULL
  )
ORDER BY PRODUCTION_ORDER_ID, BOM_UPDATE;
```

**What to verify:**
- Row count should match the number of affected (PO, BOM) pairs (105 unique pairs)
- PO 7576 should have ~36 rows, PO 7577 ~59 rows, each of POs 7923-7935 should have 2 rows
- `BOM_CONSUMPTION` values look correct
- No surprises in `FULFILLMENT_MODE`

---

### Query R2 — Execute: The Recovery INSERT

**Run only after reviewing R1 and confirming the 105 preview rows look correct.**

```sql
-- R2: SURGICAL RECOVERY INSERT
-- Re-creates exactly 1 active row per (PRODUCTION_ORDER_ID, BOM_UPDATE)
-- for the 7 affected POs, sourced from BOM_Order_List_Staging history.
-- QUALIFY guard ensures upstream staging duplicates are absorbed (1 row per pair).
-- NOT EXISTS guard ensures we never double-insert if somehow a row is already active.
INSERT INTO `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Final`
(BOM_ORDER_LIST_FINAL_ID, PRODUCTION_ORDER_ID, BOM_UPDATE, BOM_CONSUMPTION, BOM_TOLERANCE, FULFILLMENT_MODE, ORDER_LIST_NOTE, UPDATED_BY, UPDATED_AT, VALID_FROM_TS, VALID_TO_TS)
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
  'RECOVERY_2026_03_12',          -- UPDATED_BY: marks this as a system recovery
  CURRENT_TIMESTAMP(),
  CURRENT_TIMESTAMP(),            -- VALID_FROM_TS: today = "re-activated 2026-03-12"
  NULL                            -- VALID_TO_TS: active
FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Staging` S
LEFT JOIN `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Data` M
  ON S.BOM_UPDATE = M.BOM_UPDATE
WHERE S.PRODUCTION_ORDER_ID IN ('7576', '7577', '7923', '7925', '7931', '7933', '7935')
  AND S.VALIDATION_STATUS = 'PASS'
  AND NOT EXISTS (
    SELECT 1 FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Final` F
    WHERE F.PRODUCTION_ORDER_ID = S.PRODUCTION_ORDER_ID
      AND F.BOM_UPDATE = S.BOM_UPDATE
      AND F.VALID_TO_TS IS NULL    -- Only insert if no active row already exists
  )
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY S.PRODUCTION_ORDER_ID, S.BOM_UPDATE
  ORDER BY COALESCE(S.BOM_CONSUMPTION, 0) DESC, S.UPLOADED_AT DESC
) = 1;
```

**Expected result:** `This statement added N rows to BOM_Order_List_Final.`
Where N ≤ 105 (fewer if any PO/BOM pairs already had active rows from elsewhere).

---

### Query R3 — Verify: Confirm Exactly 1 Active Row Per (PO, BOM_UPDATE)

```sql
-- R3: Post-recovery verification
-- Should show 1 active entry per BOM for each of the 7 affected POs
-- Any row with active_entries > 1 means a problem; any missing BOM = incomplete recovery
SELECT
  PRODUCTION_ORDER_ID,
  COUNT(DISTINCT BOM_UPDATE) AS distinct_active_boms,
  MAX(CASE WHEN active_entries > 1 THEN 1 ELSE 0 END) AS has_duplicates,
  SUM(CASE WHEN active_entries > 1 THEN 1 ELSE 0 END) AS duplicate_bom_count
FROM (
  SELECT
    PRODUCTION_ORDER_ID,
    BOM_UPDATE,
    COUNT(*) AS active_entries
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
PRODUCTION_ORDER_ID | distinct_active_boms | has_duplicates | duplicate_bom_count
7576                | 36                   | 0              | 0
7577                | 59                   | 0              | 0
7923                | 2                    | 0              | 0
7925                | 2                    | 0              | 0
7931                | 2                    | 0              | 0
7933                | 2                    | 0              | 0
7935                | 2                    | 0              | 0
```

> If `has_duplicates = 1` for any row: the NOT EXISTS guard in R2 missed something. Do not run M2 until this is 0.

---

### Query R4 — Final Global Check: Full SNAPSHOT Integrity

After M2 Force Allocation:

```sql
-- R4: Full system health check post-recovery
SELECT
  COUNT(*) AS total_rows,
  COUNT(DISTINCT DEMAND_ID) AS distinct_demand_ids,
  COUNT(*) - COUNT(DISTINCT DEMAND_ID) AS duplicate_rows,
  MIN(CALCULATED_AT) AS snapshot_time
FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Demand_SNAPSHOT`;
```

**Expected:**
- `duplicate_rows = 0`
- `total_rows` should be approximately 10,661 + 105 = ~10,766 (the 105 recovered demand pairs restored)

---

## 4. Recovery Execution Order

```
[ ] Step 1: Run R0 — inspect Staging availability for 7 affected POs
[ ] Step 2: Run R1 — preview recovery rows (read-only)
            → Verify ~105 rows, correct BOMs, correct consumptions
[ ] Step 3: Run R2 — execute recovery INSERT
            → Note "N rows added"
[ ] Step 4: Run R3 — verify exactly 1 active row per (PO, BOM), 0 duplicates
[ ] Step 5: M2 Force Allocation → regenerate SNAPSHOT with restored demand
[ ] Step 6: Run R4 — confirm duplicate_rows = 0, total_rows ~10,766
```

---

## 5. What the Audit Trail Now Shows

The `BOM_Order_List_Final` table will contain a clean 3-layer history for each affected (PO, BOM):

```
Layer 1: [VALID_FROM=2026-02-28, VALID_TO=2026-03-12, UPDATED_BY=AUTO_SYNC]
         ← Original upload (2 identical copies — the bug)

Layer 2: [VALID_FROM=2026-02-28, VALID_TO=2026-03-12, UPDATED_BY=DEDUP_FIX_2026_03_12]
         ← The duplicate copy (expired by cleanup)

Layer 3: [VALID_FROM=2026-03-12, VALID_TO=NULL,        UPDATED_BY=RECOVERY_2026_03_12]
         ← The recovered, clean, single active version ✅
```

---

## 6. Full System State After Recovery

| Component | Status |
|---|---|
| `BOM_Order_List_Final` — duplicate active pairs | ✅ 0 |
| `BOM_Order_List_Final` — affected POs active rows | ✅ Restored (1 per BOM) |
| `SP_SPLIT_BATCH_GATE` | ✅ QUALIFY guard active |
| `SP_M1_MASTER_MERGE` resurrection guard | ✅ VALID_TO_TS IS NULL guard active |
| `Material_Demand_SNAPSHOT` | ✅ Expected: 0 duplicates, ~10,766 rows |
| `PR_Draft` | ✅ Demand for all 7 affected POs fully restored |
| Future uploads with any sheet duplicates | ✅ Absorbed silently by QUALIFY |

---

*Walkthrough V4 — 2026-03-12*
*Phase 2: ✅ Deployed | Phase 3: Surgical recovery from Staging — no planner re-upload needed*
