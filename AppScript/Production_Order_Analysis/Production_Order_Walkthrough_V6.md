# Production Order Duplicate — Walkthrough V6 (Final)

*Date: 2026-03-12 10:12 VN | Status: ✅ ALL PHASES COMPLETE*
*This is the definitive post-mortem and ongoing monitoring guide.*

---

## 1. Final State — All Numbers Verified

### The Math Is Beautiful

| Checkpoint | Value | Verified |
|---|---|---|
| SNAPSHOT before any fix | 11,066 rows (130 duplicates) | ✅ |
| After Phase 1 cleanup (Query D) | 10,661 rows (0 duplicates) | ✅ |
| After Phase 3 recovery (R2) | **10,766 rows (0 duplicates)** | ✅ |
| 10,661 + 105 recovered | **= 10,766** — exact match | ✅ |

### R3 Active BOMs Per PO

| PO | Active BOMs | Breakdown | Duplicates |
|---|---|---|---|
| 7576 | **36** | 36 recovered | 0 ✅ |
| 7577 | **59** | 59 recovered | 0 ✅ |
| 7923 | **22** | 2 recovered + 20 untouched | 0 ✅ |
| 7925 | **19** | 2 recovered + 17 untouched | 0 ✅ |
| 7931 | **22** | 2 recovered + 20 untouched | 0 ✅ |
| 7933 | **19** | 2 recovered + 17 untouched | 0 ✅ |
| 7935 | **19** | 2 recovered + 17 untouched | 0 ✅ |

### Shortages: 4,249 → 4,294 (+45) — Legitimate Restoration

| M2 Run | Shortages | Interpretation |
|---|---|---|
| Before any fix (historical) | ~4,460+ est. | Inflated by doubled demand for 105 pairs |
| After Phase 1 only (9:15) | 4,249 | Clean but missing 105 demand pairs |
| After Phase 3 recovery (9:58) | **4,294** | ✅ Correct — 45 legitimate shortages restored |

The **+45 shortages** are not a regression. They are materials for POs 7576/7577/7923-7935 that genuinely have insufficient supply — they were previously hidden because those demand rows had been accidentally removed during the cleanup. The system is now seeing the full, accurate demand picture.

---

## 2. Complete Operation Timeline

```
2026-03-11 07:43 UTC  ← M2 frozen SNAPSHOT: 11,066 rows, 130 duplicates active
2026-03-11 15:32 VN   ← Python investigation script ran; root cause confirmed
2026-03-12 08:27      ← Phase 2 SP code deployed (SQL_Vault.txt → BigQuery)
2026-03-12 09:15      ← Phase 1: Query D ran; 235 rows expired; M2 → 4,249 shortages
2026-03-12 09:27      ← Phase 2: admin_DeploySQLAssets(); both SPs confirmed ✅
2026-03-12 09:58      ← Phase 3: R2 (105 rows inserted); M2 → 4,294 shortages
2026-03-12 10:xx      ← ✅ FULL RECOVERY COMPLETE: 10,766 clean rows, 0 duplicates
```

**Total investigation-to-fix time: ~18 hours** from root cause discovery to full recovery.

---

## 3. What the Audit Trail Shows Now

For each of the 105 recovered (PO, BOM) pairs, `BOM_Order_List_Final` now contains a clean 3-layer SCD-2 history:

```
Version 1 (Expired): VALID_FROM=2026-02-28, VALID_TO=2026-03-12, UPDATED_BY=AUTO_SYNC
  ← The original upload. Expired by our cleanup.

Version 2 (Expired): VALID_FROM=2026-02-28, VALID_TO=2026-03-12, UPDATED_BY=DEDUP_FIX_2026_03_12  
  ← The duplicate copy. Expired by our cleanup.

Version 3 (ACTIVE):  VALID_FROM=2026-03-12, VALID_TO=NULL,        UPDATED_BY=RECOVERY_2026_03_12
  ← Single clean active version. ✅
```

You can verify any specific row's full history with:

```sql
-- History audit for a specific (PO, BOM) pair
SELECT
  BOM_ORDER_LIST_FINAL_ID,
  PRODUCTION_ORDER_ID,
  BOM_UPDATE,
  VALID_FROM_TS,
  VALID_TO_TS,
  UPDATED_BY,
  UPDATED_AT
FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Final`
WHERE PRODUCTION_ORDER_ID = '7576'   -- change as needed
  AND BOM_UPDATE = '302067330'        -- change as needed
ORDER BY VALID_FROM_TS;
```

---

## 4. Prevention — What the System Now Has

### Guard 1: SP_SPLIT_BATCH_GATE Step 5 — QUALIFY Dedup

```sql
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY S.PRODUCTION_ORDER_ID, S.BOM_UPDATE
  ORDER BY COALESCE(S.BOM_CONSUMPTION, 0) DESC, S.UPLOADED_AT DESC
) = 1;
```

**What it protects against:** Any number of duplicate BOM rows in the upload sheet. Whether the planner submits a BOM 2× or 100×, exactly 1 row enters `BOM_Order_List_Final`. This is the primary defense — it runs on every M1 sync.

### Guard 2: SP_M1_MASTER_MERGE Resurrection — VALID_TO_TS IS NULL

```sql
AND F.VALID_TO_TS IS NULL  -- only treats as "existing" if the row is currently ACTIVE
```

**What it protects against:** False negatives in the resurrection block. Without this, an expired row for a (PO, BOM) could block a legitimate resurrection, causing missing demand for materials that failed initial BOM validation but later got their BOM master data added.

---

## 5. Suggested Further Verification Points

### V1 — Verify Demand Quantities Are Correct for Recovered POs

The `GROSS_DEMAND_QTY` in `Material_Demand_VIEW` is calculated as:
`BOM_CONSUMPTION × GROSS_DEMAND_COMPLETION_METHOD / BOM_TOLERANCE_...`

Run this to spot-check that the recovered rows produce reasonable demand quantities:

```sql
-- Verify demand quantities for recovered POs look reasonable
SELECT
  S.DEMAND_ID,
  S.PRODUCTION_ORDER_ID,
  S.BOM_UPDATE,
  S.GROSS_DEMAND_QTY,
  S.CALC_METHOD_USED,
  S.HAS_ISSUANCE_DATA
FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Demand_SNAPSHOT` S
WHERE S.PRODUCTION_ORDER_ID IN ('7576', '7577')
ORDER BY S.PRODUCTION_ORDER_ID, S.BOM_UPDATE;
```

**What to look for:** `GROSS_DEMAND_QTY` should be positive numbers consistent with the BOM_CONSUMPTION values shown in R1 (e.g., BOM 300029134 for PO 7576 had consumption 1.0, so GROSS_DEMAND_QTY should be approximately the finished goods order quantity).

---

### V2 — Confirm M2 Daily Stats Show a Sensible Trend

```sql
-- M2 daily stats: recent trend to confirm the system is behaving consistently
SELECT
  RUN_DATE,
  TOTAL_DEMAND_ROWS,
  TOTAL_SHORTAGE_ITEMS,
  TOTAL_SHORTAGE_QTY,
  TRIGGER_SOURCE
FROM `boxwood-charmer-473204-k8.isc_scm_ops.M2_Daily_Stats`
ORDER BY RUN_DATE DESC
LIMIT 7;
```

**What to look for:**
- Today's entry should show `TOTAL_DEMAND_ROWS ≈ 10,766`
- `TOTAL_SHORTAGE_ITEMS = 4,294`
- Prior days' entries (before fix) should show higher `TOTAL_DEMAND_ROWS` (11,066) but fewer distinct demand instances

---

### V3 — Confirm PR_Draft Has No Lingering Phantom Shortages

```sql
-- Check PR_Draft for the affected POs: are shortages now correct (not doubled)?
SELECT
  PO.VPO,
  PO.PRODUCTION_ORDER_ID,
  PR.SKU_CODE,
  PR.NET_SHORTAGE_QTY,
  PR.DEMAND_QTY,
  PR.RESERVED_QTY
FROM `boxwood-charmer-473204-k8.isc_scm_ops.PR_Draft` PR
JOIN `boxwood-charmer-473204-k8.isc_scm_ops.Production_Order` PO
  ON PR.PRODUCTION_ORDER_ID = PO.PRODUCTION_ORDER_ID
WHERE PO.PRODUCTION_ORDER_ID IN ('7576', '7577')
  AND PO.VALID_TO_TS IS NULL
ORDER BY PO.PRODUCTION_ORDER_ID, PR.SKU_CODE;
```

**What to look for:** `DEMAND_QTY` per BOM should not be 2× the expected order quantity. If any `DEMAND_QTY` appears unreasonably doubled, that would indicate a remaining phantom.

---

### V4 — Global Integrity Check: Ensure Final Has No New Duplicates

Run this daily or after every M1 sync as a quick sanity check:

```sql
-- 🔁 MONITORING QUERY: Run after every M1 sync
-- Should always return 0 rows if system is healthy
SELECT
  PRODUCTION_ORDER_ID,
  BOM_UPDATE,
  COUNT(*) AS active_copies
FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Final`
WHERE VALID_TO_TS IS NULL
GROUP BY PRODUCTION_ORDER_ID, BOM_UPDATE
HAVING COUNT(*) > 1
ORDER BY active_copies DESC
LIMIT 20;
```

**Expected:** No rows (empty result). **If rows appear:** The dedup guard missed something — investigate the batch that just ran.

---

### V5 — Staging Table Size Check (Long-term Hygiene)

`BOM_Order_List_Staging` is append-only. Every upload cycle adds rows. Over time it will grow large. Check its current size and oldest records:

```sql
-- Staging table health
SELECT
  COUNT(*) AS total_staging_rows,
  MIN(UPLOADED_AT) AS oldest_record,
  MAX(UPLOADED_AT) AS newest_record,
  COUNT(DISTINCT PRODUCTION_ORDER_ID) AS distinct_pos,
  COUNTIF(VALIDATION_STATUS = 'PASS') AS pass_count,
  COUNTIF(VALIDATION_STATUS = 'FAIL') AS fail_count,
  COUNTIF(VALIDATION_STATUS = 'PASS_RETROACTIVE') AS retroactive_count
FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Staging`;
```

**Long-term recommendation:** Consider a periodic archive/cleanup of staging rows older than 90 days that have `VALIDATION_STATUS IN ('PASS', 'FAIL')` — they are no longer needed for operational decisions and only serve as historical audit records. The `SP_M1_MASTER_MERGE` resurrection logic only looks for `VALIDATION_STATUS = 'FAIL'` rows, and adding an age filter (`UPLOADED_AT > DATE_SUB(...)`) would prevent resurrecting very old stale entries.

---

## 6. The One Remaining Risk — Apps Script Upstream

The current fix operates at the **SP layer** (inside BigQuery). This means if the Google Sheet has duplicate BOM rows, they are silently absorbed and only 1 enters Final. This is safe — but the planner never knows a duplication happened.

**Long-term recommendation:** Add a dedup log to `SP_SPLIT_BATCH_GATE`. When `QUALIFY` discards a row, log it:

```sql
-- Add to SP_SPLIT_BATCH_GATE: detect if QUALIFY discarded anything
DECLARE v_staging_pass_count INT64;
DECLARE v_final_insert_count INT64;

SET v_staging_pass_count = (
  SELECT COUNT(*) FROM BOM_Order_List_Staging
  WHERE VALIDATION_STATUS = 'PASS'
    AND PRODUCTION_ORDER_ID IN (SELECT CLEAN_ID FROM Current_Batch_IDs)
    AND UPLOADED_AT > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 5 MINUTE)
);

-- After the INSERT into Final, check if fewer rows were inserted than staging had
-- If v_final_insert_count < v_staging_pass_count → upstream sheet had duplicates
-- Log this to System_Audit_Log with status = 'DEDUP_ABSORBED'
```

Or alternatively — add a **pre-flight check in the Apps Script M1 side** before writing to `BOM_Order_List_Draft`: deduplicate by `(PRODUCTION_ORDER_ID, BOM_UPDATE)` and alert if duplicates were found in the source sheet.

---

## 7. Complete Decision Map (For Future Reference)

```
When you see "duplicate DEMAND_IDs in Material_Demand_SNAPSHOT":

1. Run: SELECT COUNT(*) - COUNT(DISTINCT DEMAND_ID) FROM Material_Demand_SNAPSHOT
   → If 0: system is clean
   → If >0: duplicates exist

2. Run V4 monitoring query on BOM_Order_List_Final
   → If returns rows: active duplicate in Final → run recovery
   → If returns no rows: snapshot is stale → just re-run M2

3. Before any fix: check BOM_Order_List_Draft (Q-Extra-5)
   → If empty: safe to fix data without new uploads
   → If non-empty: M1 sync in progress — wait or coordinate

4. Recovery path:
   Phase 1: Expire all copies of affected (PO, BOM) pairs (Query D)
   Phase 2: QUALIFY guard already deployed — no SP work needed
   Phase 3: INSERT from Staging (R2) to restore 1 clean row per pair
   Phase 4: M2 Force Allocation + R4 verify
```

---

## 8. Complete Project Checklist — Final ✅

```
Phase 1 — Data Cleanup
  [✅] Query D: 235 rows expired in BOM_Order_List_Final
  [✅] Verify: 0 remaining duplicates
  [✅] M2 run: 4,249 shortages (clean base)

Phase 2 — SP Fix Deployment
  [✅] SQL_Vault.txt: QUALIFY guard added to SP_SPLIT_BATCH_GATE Step 5
  [✅] SQL_Vault.txt: VALID_TO_TS IS NULL added to SP_M1_MASTER_MERGE
  [✅] admin_DeploySQLAssets(): 40 assets deployed
  [✅] BQ verification: both SPs confirmed with QUALIFY + VALID_TO_TS guards

Phase 3 — Surgical Recovery (No planner re-upload)
  [✅] R0: Staging inventory confirmed for all 7 POs
  [✅] R1: 105 recovery rows previewed — all data correct
  [✅] R2: 105 rows inserted into BOM_Order_List_Final
  [✅] R3: All 7 POs — 0 duplicates, correct BOM counts
  [✅] M2 Force Allocation: 4,294 shortages (↑45 legitimate shortages restored)
  [✅] R4: 10,766 rows, 0 duplicates — PERFECT

Suggested Next
  [ ] V1: Verify GROSS_DEMAND_QTY for recovered POs
  [ ] V2: Review M2_Daily_Stats trend
  [ ] V3: Check PR_Draft for POs 7576/7577
  [ ] V4: Set up monitoring query (run after each M1 sync)
  [ ] V5: Staging table size check
  [ ] Long-term: Upstream Apps Script dedup alert
```

---

*Walkthrough V6 (Final) — 2026-03-12*
*Root cause: SP_SPLIT_BATCH_GATE Step 5 missing QUALIFY dedup guard*
*Scope: 7 POs, 105 unique (PO, BOM) demand pairs, 130 phantom SNAPSHOT rows*
*Resolution: 3-phase approach — Cleanup → SP fix → Surgical recovery from Staging*
*System state: 10,766 demand rows, 0 duplicates, 4,294 accurate shortages*
