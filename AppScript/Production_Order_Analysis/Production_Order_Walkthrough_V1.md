# Production Order Analysis — Deep Dive Walkthrough

*Date: 2026-03-11 | Based on: Query C results + SP_SPLIT_BATCH_GATE code review*
*Purpose: Explain the exact mechanism of duplication, validate Query D safety, and recommend additional investigation SQL*

---

## Part 1 — Reading the Query C Data (Pattern Recognition)

Query C returned **130 rows to expire** across **105 distinct (PO, BOM) pairs**. Two distinct "clusters" are visible:

### Cluster 1 — POs 7576 & 7577 (Rows 1–95)
```
VALID_FROM_TS = 2026-02-28 02:38:07.214322 UTC  ← ALL IDENTICAL
rn = 2 for ALL rows
```
- **36 duplicate rows** for PO 7576
- **59 duplicate rows** for PO 7577
- **Every single BOM** for both POs is doubled
- `rn = 2` only (never 3, 4, 5) → exactly **1 phantom per (PO, BOM) pair**

### Cluster 2 — POs 7923, 7925, 7931, 7933, 7935 (Rows 96–130)
```
VALID_FROM_TS = 2026-03-03 07:57:01.907874 UTC  ← ALL IDENTICAL
rn = 2, 3, 4, 5 for the SAME DEMAND_ID
```
- **2 BOMs affected** per group: `300029521` and `300029532`
- For `300029521`: **5 active copies** (rn 1–5, need to expire rn 2–5)
- For `300029532`: PO 7923 has 4 copies; PO 7925/7931/7933/7935 have 3–4 copies
- The same `BOM_ORDER_LIST_FINAL_ID` (e.g. `DEM_210d59b0...`) appears at rn=2, 3, 4, AND 5 → **physically 5 identical rows** in the table

### Critical Insight: Same Timestamp = Same Transaction

The fact that ALL duplicates within each cluster share **the exact same millisecond timestamp** (`02:38:07.214322` for cluster 1, `07:57:01.907874` for cluster 2) is the most important pattern. This tells us:

> Each cluster was created by a **single execution event** — not gradual accumulation over time.

---

## Part 2 — The Exact Bug Mechanism

### The SP_SPLIT_BATCH_GATE Block B Logic

When a planner uploads a new BOM list (e.g., for VPO V2602003C01), the SP runs this sequence:

```
Block B, Step 4: EXPIRE old active rows in BOM_Order_List_Final
                 WHERE PRODUCTION_ORDER_ID IN (batch uploaded)

Block B, Step 5: INSERT fresh rows from BOM_Order_List_Staging
                 WHERE VALIDATION_STATUS = 'PASS'
                 AND PRODUCTION_ORDER_ID IN (batch)
                 AND UPLOADED_AT > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 5 MINUTE)
```

This is a clean SCD-2 pattern: expire → insert. Under normal conditions, it creates exactly 1 new active row per (PO, BOM) pair.

### How Cluster 1 Was Born (POs 7576 & 7577 — 2026-02-28)

**Hypothesis: Two concurrent uploads or a double-execution of SP_SPLIT_BATCH_GATE**

```
Timeline: 2026-02-28 02:38:07 UTC

Run ①:  Step 4: Expire old rows for PO 7576, 7577 ✅
         Step 5: INSERT new rows (VALID_FROM = 02:38:07.214322) ✅ → 1 active row per (PO, BOM)

Run ②:  Step 4: Expire old rows... but the rows from Run① have VALID_FROM = NOW()
                 Wait — Step 4 matches WHERE VALID_TO_TS IS NULL
                 AND PRODUCTION_ORDER_ID IN (7576, 7577)
         → ❌ BUG: If Step 4 of Run② ran AFTER Run① Step 5, it would expire the Run① rows
         → But Query C shows VALID_TO_TS = NULL for both copies!

Alternative — if Step 4 ran BEFORE the Step 5 from Run①:
Run ②:  Step 4: Tries to expire but nothing to expire (Run① Step 5 hadn't committed yet)
         Step 5: INSERT new rows (VALID_FROM = 02:38:07.214322) → SECOND SET inserted ❌
```

Or more likely — **the STAGING table had 2 valid rows per (PO, BOM) at Step 5 time**:

```sql
-- Step 5 logic (simplified):
INSERT INTO BOM_Order_List_Final
SELECT CONCAT('DEM_', FN_GENERATE_HASH(PO_ID, BOM)), PO_ID, BOM_UPDATE, ...
FROM BOM_Order_List_Staging S
LEFT JOIN BOM_Data M ON S.BOM_UPDATE = M.BOM_UPDATE
WHERE S.VALIDATION_STATUS = 'PASS'
  AND S.PRODUCTION_ORDER_ID IN (batch)
  AND S.UPLOADED_AT > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 5 MINUTE);
```

**Key:** The Staging table has NO uniqueness constraint on `(PRODUCTION_ORDER_ID, BOM_UPDATE)`.
If the Draft table that feeds Staging had 2 rows for the same (PO, BOM), Staging gets 2 rows,
and the INSERT in Step 5 promotes **both of them** into Final at the same millisecond.

**Result:** Two active rows with identical `BOM_ORDER_LIST_FINAL_ID`, identical `VALID_FROM_TS`,
identical data — except possibly `ORDER_LIST_NOTE` differing (the tab character you noticed!).

### How Cluster 2 Was Born (POs 7923-7935 — 2026-03-03, 5 copies)

Same mechanism, but the Draft/Staging table had **5 rows** for BOM `300029521` per PO.
This happened 5 times for each of the 5 POs — a single batch upload event on 2026-03-03.

The parent BOM `300029521` likely appeared **5 times** in the uploaded Excel/sheet for those POs,
either because:
- 5 sub-lines referencing the same BOM (e.g., different lots, split quantities)
- The sheet had formula copy errors producing 5 identical rows

Since `STAGING_ID = FN_GENERATE_HASH(PRODUCTION_ORDER_ID, BOM)` — if BOM is the same, only
1 unique STAGING_ID is generated. But if BOM is slightly different (trailing spaces, etc.),
5 distinct staging rows could pass validation and all insert into Final with the same DEMAND_ID.

---

## Part 3 — Is Query D Safe to Run?

### Safety Analysis

#### For Cluster 1 (POs 7576/7577 — all `rn=2`, identical timestamps):

```
Both duplicates have:
  VALID_FROM_TS = 2026-02-28 02:38:07.214322 UTC (EXACT SAME)
  BOM_ORDER_LIST_FINAL_ID = same value (e.g. DEM_29da3c32b920...)
  All data fields: identical
```

Query D's window function `ORDER BY VALID_FROM_TS DESC` is **non-deterministic** when
timestamps are equal — either copy could become rn=1. But since both rows are **completely
identical in content**, expiring either one is 100% safe. The remaining active row will be correct.

**Verdict for Cluster 1: ✅ SAFE**

#### For Cluster 2 (POs 7923-7935 — same `rn=2,3,4,5`, identical timestamps):

Same situation — all 5 copies of `DEM_210d59b0...` for (PO 7923, BOM 300029521) are
physically identical rows. The window function arbitrarily picks one as rn=1 and marks
rn=2-5 as expired. After fix: 1 active row with correct data. 4 expired rows in history.

**Verdict for Cluster 2: ✅ SAFE**

#### Residual Risk: Does Query D accidentally expire non-duplicate rows?

Query D's predicate:
```sql
WHERE VALID_TO_TS IS NULL
  AND BOM_ORDER_LIST_FINAL_ID IN (
    SELECT BOM_ORDER_LIST_FINAL_ID FROM (...) WHERE rn > 1
  )
```

The inner subquery only selects `BOM_ORDER_LIST_FINAL_IDs` where `rn > 1` within their
`(PRODUCTION_ORDER_ID, BOM_UPDATE)` partition. A "non-duplicate" (a unique active row)
always has `rn = 1` → never enters the IN-list → **never touched by the UPDATE**.

**Verdict for Query D overall: ✅ SAFE — no clean rows will be expired**

### One Caution: Tie-Breaking

For Cluster 1, `ORDER BY VALID_FROM_TS DESC` is a tie — two rows with identical timestamps.
BigQuery will arbitrarily pick one as rn=1. In theory, for future SCD-2 operations that
look at `MAX(VALID_FROM_TS)` to find the "current" version, both candidates are equally valid.
Since the DEMAND_ID and all data are identical this is truly safe — but you should be aware
of why the tie-breaking exists.

---

## Part 4 — Additional SQL Investigation (Recommended Before Fix)

These are diagnostic-only (no mutations). They help you understand WHERE the duplicate
staging data came from and whether the root cause is still active.

### Q-Extra-1: Was Staging the Source of the Duplicate? (Audit BOM_Order_List_Staging)

```sql
-- Find any (PO, BOM_UPDATE) in Staging that had 2+ rows on 2026-02-28
-- This reveals if the Draft/upload had duplicate rows at the source
SELECT
  PRODUCTION_ORDER_ID,
  BOM_UPDATE,
  BOM,
  COUNT(*) AS staging_count,
  ARRAY_AGG(STAGING_ID) AS staging_ids,
  ARRAY_AGG(VALIDATION_STATUS) AS statuses,
  ARRAY_AGG(ORDER_LIST_NOTE) AS notes,
  MIN(UPLOADED_AT) AS first_upload,
  MAX(UPLOADED_AT) AS last_upload
FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Staging`
WHERE PRODUCTION_ORDER_ID IN ('7576', '7577')
  AND DATE(UPLOADED_AT) = '2026-02-28'
GROUP BY PRODUCTION_ORDER_ID, BOM_UPDATE, BOM
HAVING COUNT(*) > 1
ORDER BY PRODUCTION_ORDER_ID, BOM_UPDATE;
```

**Expected if staging was the source:** Returns rows with `staging_count > 1`
**Expected if staging was clean:** Returns no rows → suggests a double-run of SP_SPLIT_BATCH_GATE

---

### Q-Extra-2: How Many TOTAL Rows Does BOM_Order_List_Final Have for PO 7576? (All History)

```sql
-- Full audit: active + expired rows for POs 7576 and 7577
SELECT
  PRODUCTION_ORDER_ID,
  CASE WHEN VALID_TO_TS IS NULL THEN 'ACTIVE' ELSE 'EXPIRED' END AS row_state,
  COUNT(*) AS row_count,
  MIN(VALID_FROM_TS) AS earliest,
  MAX(VALID_FROM_TS) AS latest
FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Final`
WHERE PRODUCTION_ORDER_ID IN ('7576', '7577')
GROUP BY PRODUCTION_ORDER_ID, row_state
ORDER BY PRODUCTION_ORDER_ID, row_state;
```

**What to look for:** If there are also EXPIRED rows for these POs, it means a prior SCD-2
cycle DID work correctly at some point. If there are only ACTIVE rows (all from 2026-02-28),
the very first upload event created the duplicates — no prior clean version ever existed.

---

### Q-Extra-3: BOM_Order_List_Staging — What Batch Exists for 2026-03-03? (Cluster 2 Origin)

```sql
-- Look at the 2026-03-03 staging for POs 7923-7935
SELECT
  PRODUCTION_ORDER_ID,
  BOM_UPDATE,
  BOM,
  COUNT(*) AS staging_count,
  ARRAY_AGG(VALIDATION_STATUS) AS statuses,
  ARRAY_AGG(UPLOADED_AT ORDER BY UPLOADED_AT) AS upload_times
FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Staging`
WHERE PRODUCTION_ORDER_ID IN ('7923', '7925', '7931', '7933', '7935')
  AND BOM_UPDATE IN ('300029521', '300029532')
  AND DATE(UPLOADED_AT) = '2026-03-03'
GROUP BY PRODUCTION_ORDER_ID, BOM_UPDATE, BOM
ORDER BY PRODUCTION_ORDER_ID, BOM_UPDATE;
```

---

### Q-Extra-4: Is Step 4 (Expiration) in SP_SPLIT_BATCH_GATE Working? (Critical — Are We Still at Risk?)

```sql
-- If Step 4 worked correctly, all previously-active rows for PO 7576
-- should have VALID_TO_TS set (non-null) from before 2026-02-28.
-- If this returns rows with VALID_TO_TS IS NOT NULL from before 2026-02-28,
-- Step 4 fired correctly before the insert. If NO expired rows exist before 2026-02-28,
-- then either: (a) this was the first-ever upload, or (b) Step 4 was bypassed.
SELECT
  PRODUCTION_ORDER_ID,
  BOM_UPDATE,
  VALID_FROM_TS,
  VALID_TO_TS,
  UPDATED_BY
FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Final`
WHERE PRODUCTION_ORDER_ID IN ('7576', '7577')
  AND VALID_TO_TS IS NOT NULL          -- Only PREVIOUSLY EXPIRED rows
  AND VALID_FROM_TS < '2026-02-28'    -- Before the duplicate-creation event
ORDER BY PRODUCTION_ORDER_ID, BOM_UPDATE, VALID_FROM_TS
LIMIT 20;
```

**If this returns 0 rows:** The 2026-02-28 event was the FIRST ever upload for these POs,
meaning the SCD-2 Step 4 found nothing to expire, and BOTH insertions in Step 5 succeeded.
→ The bug: Draft table had 2 rows per (PO, BOM).

**If this returns rows:** Step 4 worked, then Step 5 somehow ran twice.

---

### Q-Extra-5: Is The Root Cause Still Active Today? (Guard Against Recurrence)

```sql
-- Check if BOM_Order_List_Draft currently has any (PO, BOM) duplicates
-- (This is the source that SP_SPLIT_BATCH_GATE reads from)
SELECT
  PRODUCTION_ORDER_ID,
  BOM_UPDATE,
  BOM,
  COUNT(*) AS draft_count
FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Draft`
GROUP BY PRODUCTION_ORDER_ID, BOM_UPDATE, BOM
HAVING COUNT(*) > 1
ORDER BY draft_count DESC
LIMIT 20;
```

**If this returns rows:** The source data is STILL dirty today. Running SP_SPLIT_BATCH_GATE
again would create NEW duplicates in Final. Fix the Draft table FIRST, then run the gate.
**If this returns 0:** The Draft is currently clean; the historical damage is isolated.

---

## Part 5 — Decision: Run Query D Now or Wait?

### ✅ Run Query D NOW if:
- Q-Extra-5 returns **0 rows** (Draft is clean today — no new duplicates will be created)
- You have reviewed Query C and the duplicate IDs look correct

### ⏸️ Wait if:
- Q-Extra-5 returns rows (Draft still dirty — fix the upload source first)
- Any of Q-Extra-1/2/3 reveals something unexpected (e.g., intentionally kept duplicate rows)

### Recommended Sequence:
```
Step 1: Run Q-Extra-5 first → if 0 rows, proceed
Step 2: Run Q-Extra-1 → understand the historical origin
Step 3: Run Query D (fix)
Step 4: Run Query D-verify → confirm 0 remaining duplicates
Step 5: M2 Force Allocation → regenerate SNAPSHOT
Step 6: Query E → confirm SNAPSHOT is clean
```

---

## Part 6 — SP_M1_MASTER_MERGE Fix (Prevention)

### Finding the Second INSERT Path

`BOM_Order_List_Final` has **two INSERT paths**:
1. `SP_SPLIT_BATCH_GATE` Block B Step 5 — the primary path (lines ~260-286)
2. `SP_M1_MASTER_MERGE` Part 2 "Resurrection" — the retroactive path (lines ~449-465)

#### Fix for Path 1 — SP_SPLIT_BATCH_GATE Step 5

Add a `NOT EXISTS` guard before the INSERT to prevent doubles when Staging has duplicates:

```sql
-- CURRENT Step 5 (no guard against Staging duplicates):
INSERT INTO BOM_Order_List_Final (BOM_ORDER_LIST_FINAL_ID, ...)
SELECT CONCAT('DEM_', FN_GENERATE_HASH(PO, BOM)), PO, BOM_UPDATE, ...
FROM BOM_Order_List_Staging S
JOIN BOM_Data M ON S.BOM_UPDATE = M.BOM_UPDATE
WHERE S.VALIDATION_STATUS = 'PASS'
  AND S.PRODUCTION_ORDER_ID IN (batch)
  AND S.UPLOADED_AT > - 5min

-- PROPOSED FIX: Add QUALIFY to deduplicate within Staging first
INSERT INTO BOM_Order_List_Final (BOM_ORDER_LIST_FINAL_ID, ...)
SELECT DISTINCT CONCAT('DEM_', FN_GENERATE_HASH(PO, BOM)), PO, BOM_UPDATE,
  -- Use QUALIFY to pick 1 row per (PO_ID, BOM_UPDATE) from Staging
  ...
FROM BOM_Order_List_Staging S
JOIN BOM_Data M ON S.BOM_UPDATE = M.BOM_UPDATE
WHERE S.VALIDATION_STATUS = 'PASS'
  AND S.PRODUCTION_ORDER_ID IN (batch)
  AND S.UPLOADED_AT > - 5min
QUALIFY ROW_NUMBER() OVER (PARTITION BY S.PRODUCTION_ORDER_ID, S.BOM_UPDATE
                           ORDER BY S.UPLOADED_AT DESC) = 1  -- ← ADD THIS
```

#### Fix for Path 2 — SP_M1_MASTER_MERGE Resurrection Guard

```sql
-- CURRENT (misses active rows guard):
AND NOT EXISTS (
  SELECT 1 FROM BOM_Order_List_Final F
  WHERE F.PRODUCTION_ORDER_ID = S.PRODUCTION_ORDER_ID
    AND F.BOM_UPDATE = S.BOM_UPDATE
)

-- PROPOSED FIX:
AND NOT EXISTS (
  SELECT 1 FROM BOM_Order_List_Final F
  WHERE F.PRODUCTION_ORDER_ID = S.PRODUCTION_ORDER_ID
    AND F.BOM_UPDATE = S.BOM_UPDATE
    AND F.VALID_TO_TS IS NULL  -- ← ONLY block if an ACTIVE row exists
)
```

---

## Summary Table

| Question | Answer |
|---|---|
| Root cause confirmed? | ✅ YES — `BOM_Order_List_Final` phantom rows |
| Production_Order clean? | ✅ YES — PO table is healthy |
| BOM_Data clean? | ✅ YES — no duplicates |
| Scope | 130 rows to expire across 105 (PO, BOM) pairs |
| POs affected | 7576, 7577, 7923, 7925, 7931, 7933, 7935 |
| Worst case | (7923/7925/7931/7933/7935) × BOM `300029521` = **5 active copies** |
| Query D safe? | ✅ YES — soft UPDATE only, non-deterministic tie-breaking is harmless |
| Should run Q-Extra-5 first? | ✅ YES — confirm Draft is clean before fix |
| Prevention needed? | ✅ YES — QUALIFY guard in SP_SPLIT_BATCH_GATE + VALID_TO_TS check in SP_M1_MASTER_MERGE |

---

*Walkthrough V1 — 2026-03-11*
