# Production Order Duplicate — Walkthrough V2

*Date: 2026-03-12 | Status: ✅ Root Cause Fully Proven — Ultimate Fix Ready*
*Supersedes: Walkthrough V1*

---

## 1. Complete Evidence Summary

All five diagnostic queries have now confirmed the full picture. Here is each result decoded:

---

### Q2 — BOM_Order_List_Final Full History for POs 7576 & 7577

```
PO   | State   | row_count | earliest              | latest
7576 | ACTIVE  | 72        | 2026-02-28 02:38:07   | 2026-02-28 02:38:07
7577 | ACTIVE  | 118       | 2026-02-28 02:38:07   | 2026-02-28 02:38:07
```

**Three decisive observations:**

1. **Zero EXPIRED rows** — these two POs have never been through a prior SCD-2 expiration cycle. The 2026-02-28 upload was their **first-ever** entry into `BOM_Order_List_Final`.

2. **The math confirms exact 2× duplication:**
   - PO 7576: 72 active rows ÷ 2 = **36 unique BOMs**, each with 2 copies ✅
   - PO 7577: 118 active rows ÷ 2 = **59 unique BOMs**, each with 2 copies ✅

3. **Earliest = Latest = same millisecond** — all 72 rows (and all 118 rows) were inserted in a **single transaction**. The duplication was born in one batch run, not accumulated over time.

---

### Q3 — BOM_Order_List_Staging for POs 7923-7935 on 2026-03-03

```
PO    | BOM_UPDATE | staging_count | VALIDATION_STATUS | upload_times
7923  | 300029521  | 5             | PASS × 5          | 07:56:55.439 (same for all 5)
7923  | 300029532  | 4             | PASS × 4          | 07:56:55.439 (same for all 4)
7925  | 300029521  | 5             | PASS × 5          | (same)
...   | ...        | ...           | ...               | ...
```

**Three decisive observations:**

1. **Staging already had N copies** — before `SP_SPLIT_BATCH_GATE` promoted anything into Final, Staging itself contained 5 copies of (PO=7923, BOM=300029521). This proves the duplication originated **before** Final — at the Staging INSERT step.

2. **All upload_times are identical to the millisecond** — all 5 rows arrived in one single INSERT statement from `BOM_Order_List_Draft`. The Draft table had 5 identical rows for that BOM.

3. **All status = PASS** — the validation step (Step 3) simply checked BOM existence per row, with no concept of "this (PO, BOM) combination was already validated before in this batch." All 5 rows passed independently.

---

### Q4 — Expired Rows Before 2026-02-28 for POs 7576 & 7577

**Result: 0 rows**

This eliminates the "SP_SPLIT_BATCH_GATE ran twice" hypothesis. If the SP had run twice, the first run's rows would have been expired by the second run's Step 4. Since there are **zero expired rows** and **all active rows share the same timestamp**, only ONE run of the SP occurred. The duplication was already in the input data (Draft → Staging), not in the SP execution.

---

### Q5 — BOM_Order_List_Draft Today

**Result: No data to display**

The Draft table is a temporary buffer that is **cleared after each upload**. It is empty today, meaning:
- No pending M1 sync is in progress
- No new duplicates are waiting to be created
- **Query D is safe to run immediately**

---

### Q1 — Why It Failed (Minor Technical Note)

`ARRAY_AGG(ORDER_LIST_NOTE)` fails when ORDER_LIST_NOTE contains NULL — BigQuery arrays cannot have NULL elements. This is the tab-character vs empty-string artifact you noticed in the original data. Fix for future use: `ARRAY_AGG(COALESCE(ORDER_LIST_NOTE, '[NULL]'))`. But we no longer need this query — Q2/Q3/Q4/Q5 already told us everything.

---

## 2. The Complete Causal Chain

Here is the exact sequence of events that created every duplicate record:

### Event A — 2026-02-28 02:38:07 UTC (POs 7576 & 7577)

```
STEP 1 — Apps Script uploads BOM list for a batch containing PO 7576 and 7577.
          The source Google Sheet had each BOM line listed TWICE for these POs.
          (Why? — column merge error, double-paste, formula repeat, or 2 sheet tabs merged)

STEP 2 — SP_SPLIT_BATCH_GATE Block B, Step 2:
          INSERT INTO BOM_Order_List_Staging FROM BOM_Order_List_Draft
          36 BOMs for PO 7576 × 2 copies in Draft → 72 rows inserted into Staging
          59 BOMs for PO 7577 × 2 copies in Draft → 118 rows inserted into Staging

STEP 3 — Validation (Step 3):
          Each of the 72 rows is validated independently against BOM_Data.
          All pass → VALIDATION_STATUS = 'PASS' for all 72 rows.
          No check for "have I already validated this (PO, BOM) pair in this batch?"

STEP 4 — Expiration (Step 4):
          UPDATE BOM_Order_List_Final WHERE VALID_TO_TS IS NULL AND PO IN batch
          ⚠️ FIRST EVER UPLOAD → nothing to expire → Step 4 is a no-op

STEP 5 — Promote Valid Lines (Step 5):
          INSERT INTO BOM_Order_List_Final
          SELECT FROM BOM_Order_List_Staging
          WHERE VALIDATION_STATUS = 'PASS' AND PO IN batch AND UPLOADED_AT > -5min
          ⚠️ NO DEDUPLICATION GUARD → all 72 Staging rows promoted → 72 active rows in Final
          Expected: 36 rows. Actual: 72 rows. Damage: 36 phantom rows.
```

### Event B — 2026-03-03 07:56:55 UTC (POs 7923, 7925, 7931, 7933, 7935)

```
STEP 1 — Apps Script uploads a BOM list batch containing POs 7923-7935.
          The source sheet had BOM 300029521 listed 5 times per PO.
          (Why? — This BOM is a "common material" used in multiple sub-assemblies.
           Each sub-assembly reference appeared as a separate sheet row.)

STEP 2 → Staging receives 5 identical rows per (PO, BOM) pair.
STEP 3 → All 5 pass validation independently.
STEP 4 → Prior active rows (if any existed) are expired correctly for these POs.
STEP 5 → All 5 rows promoted into Final → 5 active copies of the same demand row.
```

---

## 3. The True Root Cause (The "Ultimate" Answer)

You are absolutely right — Query D only fixes the symptom (the current 130 dirty rows). The **true root cause is structural, in the SP code.**

### Root Cause: SP_SPLIT_BATCH_GATE Block B Step 5 has no deduplication

```sql
-- CURRENT Step 5 (line ~260–286 in SQL_Vault.txt):
INSERT INTO BOM_Order_List_Final
(BOM_ORDER_LIST_FINAL_ID, PRODUCTION_ORDER_ID, BOM_UPDATE, ...)
SELECT
  CONCAT('DEM_', FN_GENERATE_HASH(S.PRODUCTION_ORDER_ID, M.BOM)),
  S.PRODUCTION_ORDER_ID,
  S.BOM_UPDATE,
  S.BOM_CONSUMPTION,
  S.BOM_TOLERANCE,
  ...,
  S.ORDER_LIST_NOTE,
  ...
FROM BOM_Order_List_Staging S
LEFT JOIN BOM_Data M ON S.BOM_UPDATE = M.BOM_UPDATE
WHERE S.VALIDATION_STATUS = 'PASS'
  AND S.PRODUCTION_ORDER_ID IN (SELECT CLEAN_ID FROM Current_Batch_IDs)
  AND S.UPLOADED_AT > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 5 MINUTE);
  ↑
  ❌ NO QUALIFY / NO GROUP BY / NO ROW_NUMBER
  → If staging has N rows for the same (PO, BOM_UPDATE), N rows enter Final
```

**Why this is dangerous:**

| Source Scenario | Draft rows per (PO, BOM) | Staging rows | Final rows created |
|---|---|---|---|
| Normal upload (no dup) | 1 | 1 | 1 ✅ |
| BOM listed twice in sheet | 2 | 2 | 2 ❌ |
| Sub-assembly BOM × 5 rows | 5 | 5 | 5 ❌ |
| Column merge error × N | N | N | N ❌ |

**The SP was designed assuming the upstream sheet is always deduplicated.** That assumption breaks whenever the planner's Excel/Google Sheet has a BOM repeated.

---

## 4. The Ultimate Fix: QUALIFY Deduplication in Step 5

This is the surgical, permanent fix. It makes `SP_SPLIT_BATCH_GATE` resilient against any amount of upstream duplication.

### Fix Location

**File:** `ISC_SCM_Core_Lib/SQL_Vault.txt`
**SP:** `SP_SPLIT_BATCH_GATE` → Block B → Step 5 (lines ~260–286)

### Before (Current — vulnerable)

```sql
-- 5. Promote New Valid Lines
INSERT INTO `${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Order_List_Final`
(BOM_ORDER_LIST_FINAL_ID, PRODUCTION_ORDER_ID, BOM_UPDATE, BOM_CONSUMPTION, BOM_TOLERANCE, FULFILLMENT_MODE, ORDER_LIST_NOTE, UPDATED_BY, UPDATED_AT, VALID_FROM_TS, VALID_TO_TS)
SELECT
  CONCAT('DEM_', `${ENV.PROJECT_ID}.${ENV.DATASET_ID}.FN_GENERATE_HASH`(S.PRODUCTION_ORDER_ID, M.BOM)),
  S.PRODUCTION_ORDER_ID,
  S.BOM_UPDATE,
  S.BOM_CONSUMPTION,
  S.BOM_TOLERANCE,
  CASE
      WHEN EXISTS (
          SELECT 1 FROM `${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Data` M
          WHERE M.BOM_UPDATE = S.BOM_UPDATE
          AND LOWER(TRIM(M.MAIN_GROUP)) = 'bao bì'
      ) THEN 'PRIVATE'
      ELSE 'PUBLIC'
  END,
  S.ORDER_LIST_NOTE,
  execution_user,
  CURRENT_TIMESTAMP(),
  CURRENT_TIMESTAMP(),
  NULL
FROM `${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Order_List_Staging` S
LEFT JOIN `${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Data` M
   ON S.BOM_UPDATE = M.BOM_UPDATE
WHERE S.VALIDATION_STATUS = 'PASS'
  AND S.PRODUCTION_ORDER_ID IN (SELECT CLEAN_ID FROM Current_Batch_IDs)
  AND S.UPLOADED_AT > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 5 MINUTE);
```

### After (Fixed — resilient)

```sql
-- 5. Promote New Valid Lines  ← V2: QUALIFY dedup added — resilient to upstream duplicates
INSERT INTO `${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Order_List_Final`
(BOM_ORDER_LIST_FINAL_ID, PRODUCTION_ORDER_ID, BOM_UPDATE, BOM_CONSUMPTION, BOM_TOLERANCE, FULFILLMENT_MODE, ORDER_LIST_NOTE, UPDATED_BY, UPDATED_AT, VALID_FROM_TS, VALID_TO_TS)
SELECT
  CONCAT('DEM_', `${ENV.PROJECT_ID}.${ENV.DATASET_ID}.FN_GENERATE_HASH`(S.PRODUCTION_ORDER_ID, M.BOM)),
  S.PRODUCTION_ORDER_ID,
  S.BOM_UPDATE,
  S.BOM_CONSUMPTION,
  S.BOM_TOLERANCE,
  CASE
      WHEN EXISTS (
          SELECT 1 FROM `${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Data` M
          WHERE M.BOM_UPDATE = S.BOM_UPDATE
          AND LOWER(TRIM(M.MAIN_GROUP)) = 'bao bì'
      ) THEN 'PRIVATE'
      ELSE 'PUBLIC'
  END,
  S.ORDER_LIST_NOTE,
  execution_user,
  CURRENT_TIMESTAMP(),
  CURRENT_TIMESTAMP(),
  NULL
FROM `${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Order_List_Staging` S
LEFT JOIN `${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Data` M
   ON S.BOM_UPDATE = M.BOM_UPDATE
WHERE S.VALIDATION_STATUS = 'PASS'
  AND S.PRODUCTION_ORDER_ID IN (SELECT CLEAN_ID FROM Current_Batch_IDs)
  AND S.UPLOADED_AT > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 5 MINUTE)
-- 🛡️ V2 DEDUP GUARD: If Staging has N rows for the same (PO, BOM_UPDATE),
--    pick exactly 1 — preferring the row with the highest BOM_CONSUMPTION
--    (avoids silently zero-ing out the quantity by picking the wrong copy).
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY S.PRODUCTION_ORDER_ID, S.BOM_UPDATE
  ORDER BY COALESCE(S.BOM_CONSUMPTION, 0) DESC,  -- prefer highest consumption
           S.UPLOADED_AT DESC                      -- tie-break: latest ingested
) = 1;
```

### Why `ORDER BY BOM_CONSUMPTION DESC` for tie-breaking?

When the sheet has N copies, they may have different consumption values (e.g., 3 rows of 10 units and 2 rows of 0 units). Picking the highest avoids silently zeroing out demand. `UPLOADED_AT DESC` as secondary ensures the latest-ingested copy wins if all consumptions are equal.

---

## 5. Secondary Fix: SP_M1_MASTER_MERGE Guard

A second, smaller fix closes the resurrection path as well:

```sql
-- In SP_M1_MASTER_MERGE, Part 2 Temp Table Resurrected_Items:

-- CURRENT (may allow re-insertion even when an active row exists):
AND NOT EXISTS (
  SELECT 1 FROM `...BOM_Order_List_Final` F
  WHERE F.PRODUCTION_ORDER_ID = S.PRODUCTION_ORDER_ID
    AND F.BOM_UPDATE = S.BOM_UPDATE
)

-- FIXED (only blocks if an ACTIVE row already exists):
AND NOT EXISTS (
  SELECT 1 FROM `...BOM_Order_List_Final` F
  WHERE F.PRODUCTION_ORDER_ID = S.PRODUCTION_ORDER_ID
    AND F.BOM_UPDATE = S.BOM_UPDATE
    AND F.VALID_TO_TS IS NULL   -- ← Add this line
)
```

---

## 6. Complete Fix Execution Plan

### Phase 1 — Immediate Data Cleanup (Query D)

> **Prerequisites confirmed ✅:** Draft is empty (Q5), fix is safe.

**Step 1 — (Optional but recommended) Run Query C preview again to confirm scope:**
Paste [Query C from Analysis V1] in BQ Console to see the 130 rows one more time.

**Step 2 — Run Query D (the fix):**
```sql
UPDATE `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Final`
SET
  VALID_TO_TS = CURRENT_TIMESTAMP(),
  UPDATED_BY = 'DEDUP_FIX_2026_03_12',
  UPDATED_AT = CURRENT_TIMESTAMP()
WHERE VALID_TO_TS IS NULL
  AND BOM_ORDER_LIST_FINAL_ID IN (
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
    WHERE rn > 1
  );
```

**Step 3 — Verify Query D result:**
```sql
-- Must return 0
SELECT COUNT(*) AS remaining_duplicates
FROM (
  SELECT PRODUCTION_ORDER_ID, BOM_UPDATE, COUNT(*) AS cnt
  FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Final`
  WHERE VALID_TO_TS IS NULL
  GROUP BY PRODUCTION_ORDER_ID, BOM_UPDATE
  HAVING COUNT(*) > 1
);
```

**Step 4 — Re-run M2 Force Allocation:**
> M2 Menu → ⚡ Force Run Allocation

**Step 5 — Verify SNAPSHOT is clean:**
```sql
-- Must return 0 in duplicate_rows column
SELECT
  COUNT(*) AS total_rows,
  COUNT(DISTINCT DEMAND_ID) AS distinct_demand_ids,
  COUNT(*) - COUNT(DISTINCT DEMAND_ID) AS duplicate_rows
FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Demand_SNAPSHOT`;
```

---

### Phase 2 — Permanent Code Fix (SP_SPLIT_BATCH_GATE)

**Step 6 — Update SQL_Vault.txt:**
In `SQL_Vault.txt`, find `SP_SPLIT_BATCH_GATE` Block B Step 5 and add the QUALIFY clause exactly as shown in Section 4 above.

**Step 7 — Update SP_M1_MASTER_MERGE guard:**
In `SQL_Vault.txt`, find the `Resurrected_Items` NOT EXISTS clause and add `AND F.VALID_TO_TS IS NULL`.

**Step 8 — Deploy via Admin_Infrastructure:**
Run `admin_DeploySQLAssets()` to push updated SPs to BigQuery.

**Step 9 — Smoke test:**
Upload a test BOM list with an intentional duplicate BOM line for a test PO. Verify that `BOM_Order_List_Final` gets exactly 1 active row (not 2).

---

## 7. Full Picture — One Diagram

```
SOURCE ISSUE:
  Google Sheets BOM list had N copies of the same BOM per PO
       │
       ▼ Apps Script reads all N rows
  BOM_Order_List_Draft  (N duplicate rows per BOM)
       │
       ▼ SP_SPLIT_BATCH_GATE Block B Step 2
  BOM_Order_List_Staging  (N copies inserted, same STAGING_ID)
       │
       ▼ Step 3: Validation (per-row, no uniqueness check)
       │   ALL N copies → VALIDATION_STATUS = 'PASS'
       │
       ▼ Step 4: Expire old active rows in Final (correct ✅)
       │   (If first-ever upload, nothing to expire — no-op)
       │
       ▼ Step 5: INSERT from Staging to Final  ← ❌ THE BUG IS HERE
  BOM_Order_List_Final  (N active copies per BOM — no dedup guard)
       │
       ▼ SP_RUN_MATCHING_ENGINE (M2)
  Material_Demand_VIEW  (N demand rows per BOM — fan-out)
       │
       ▼ SNAPSHOT FREEZE
  Material_Demand_SNAPSHOT  (N demand rows per BOM)
       │
       ▼ PR_Draft shortages
  Net shortage = demand × N  ← ❌ N× OVERCOUNTED SHORTAGES

THE FIX:
  Add QUALIFY ROW_NUMBER() = 1 to Step 5 → regardless of how many
  Staging rows exist for a (PO, BOM), exactly 1 enters Final.
```

---

## 8. Why This Matters Operationally

| BOM | Affected POs | Duplication | Current Shortage Impact |
|---|---|---|---|
| `300029521` | 7923, 7925, 7931, 7933, 7935 | **5×** | Shortage is **5× overcounted** |
| `300029532` | 7923, 7925, 7933, 7935 | **4×** | Shortage is **4× overcounted** |
| 36 BOMs | 7576 | 2× | Shortage is 2× overcounted |
| 59 BOMs | 7577 | 2× | Shortage is 2× overcounted |

After fix, the M2 engine will compute accurate shortages for all these orders — likely resulting in a significant drop in PR_Draft line count and shortage quantities for the affected materials.

---

*Walkthrough V2 — 2026-03-12*
*Supersedes V1 — True root cause identified: SP_SPLIT_BATCH_GATE Step 5 missing QUALIFY guard*
*Query D = temporary cleanup | SP QUALIFY fix = permanent prevention*
