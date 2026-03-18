## Phase 1 Review — Assign_Sourcing (M3) PUBLIC Aggregation Data Layer
_Source of truth: `Implementation_Plan/Implementation_Plan_V5.md` (Section 5)_
_Evidence source: `ISC_SCM_Core_Lib/SQL_Vault.txt`_
_Review date: 2026-03-16_

---

## 1. What Phase 1 is supposed to deliver (per V5)

Phase 1 is **BigQuery data-layer only**. It must provide:

- **Aggregated view**: `Sourcing_Feed_Aggregated_VIEW` (PUBLIC only, 1 row per `BOM_UPDATE`)
- **BOM-level backup shortage**: `BOM_Shortage_Backup_VIEW` (issuance-robust ground truth)
- **Mismatch signals**: `BOM_SHORTAGE_DIFF` and `BOM_SHORTAGE_STATUS`
- **Deterministic ordering contract**: stable `VPO_AGG` + `DRAFT_PR_ID_AGG` alignment for downstream “split/explode” upload logic

Phase 1 does **not** require any M3 Sheet UI changes yet (those start in Phase 2).

---

## 2. What is present in the system (code-level evidence)

### 2.1 `Sourcing_Feed_Aggregated_VIEW` exists and matches the V5 contract

In `ISC_SCM_Core_Lib/SQL_Vault.txt`, the SQL asset `Sourcing_Feed_Aggregated_VIEW` is defined and includes all key Phase 1 requirements:

- **PUBLIC-only aggregation** (keeps PRIVATE out of aggregation):

```4500:4505:g:\My Drive\Tech Jobs\ISC\Presentation\Report 2\Task 1 Supply Chain Database\Diagrams\SC Database Diagrams\Diagrams\Diagrams Version 129-Assign_Sourcing_Analysis\AppScript\ISC_SCM_Core_Lib\SQL_Vault.txt
          FROM M2_Output
          -- Crucial: We only aggregate PUBLIC items. PRIVATE items stay 1-to-1.
          -- (For Phase 1 pilot, 'Chì' is the primary PUBLIC target)
          WHERE LOWER(TRIM(FULFILLMENT_MODE)) = 'public'
          GROUP BY BOM_UPDATE
```

- **Deterministic ordering contract** for downstream splitting:

```4476:4481:g:\My Drive\Tech Jobs\ISC\Presentation\Report 2\Task 1 Supply Chain Database\Diagrams\SC Database Diagrams\Diagrams\Diagrams Version 129-Assign_Sourcing_Analysis\AppScript\ISC_SCM_Core_Lib\SQL_Vault.txt
              -- Strictly ordered aggregations for correct VPO splitting downstream
              STRING_AGG(VPO, '|' ORDER BY VPO ASC) AS VPO_AGG,
              STRING_AGG(DRAFT_PR_ID, '|' ORDER BY VPO ASC) AS DRAFT_PR_ID_AGG,
```

- **Upload-safe component payload** (`VPO_COMPONENTS_JSON`) for a more reliable explode/allocation algorithm:

```4482:4490:g:\My Drive\Tech Jobs\ISC\Presentation\Report 2\Task 1 Supply Chain Database\Diagrams\SC Database Diagrams\Diagrams\Diagrams Version 129-Assign_Sourcing_Analysis\AppScript\ISC_SCM_Core_Lib\SQL_Vault.txt
              -- Expose detailed component weights as JSON array for safer downstream processing 
              CONCAT('[', STRING_AGG(
                TO_JSON_STRING(STRUCT(
                  VPO AS vpo, 
                  DRAFT_PR_ID AS draft_pr_id, 
                  NET_SHORTAGE_QTY AS net_shortage_qty
                )), ',' ORDER BY VPO ASC
              ), ']') AS VPO_COMPONENTS_JSON,
```

### 2.2 `BOM_Shortage_Backup_VIEW` exists and matches the V5 definition

`BOM_TOTAL_SHORTAGE` is computed as BOM totals:

```4426:4433:g:\My Drive\Tech Jobs\ISC\Presentation\Report 2\Task 1 Supply Chain Database\Diagrams\SC Database Diagrams\Diagrams\Diagrams Version 129-Assign_Sourcing_Analysis\AppScript\ISC_SCM_Core_Lib\SQL_Vault.txt
      SELECT 
          d.BOM_UPDATE,
          COALESCE(d.total_demand, 0) AS BOM_TOTAL_DEMAND,
          COALESCE(i.total_issued, 0) AS BOM_TOTAL_ISSUED,
          COALESCE(s.stock_qty, 0) AS BOM_STOCK,
          COALESCE(p.po_on_way, 0) AS BOM_PO_ON_WAY,
          GREATEST(0, COALESCE(d.total_demand, 0) - COALESCE(i.total_issued, 0) - COALESCE(s.stock_qty, 0) - COALESCE(p.po_on_way, 0)) AS BOM_TOTAL_SHORTAGE
```

### 2.3 Mismatch flags exist and are wired into the aggregated view

The aggregated view joins to `BOM_Shortage_Backup_VIEW` and emits:

- `BOM_SHORTAGE_DIFF = NET_SHORTAGE_QTY_AGG - BOM_TOTAL_SHORTAGE`
- `BOM_SHORTAGE_STATUS` with a threshold rule (currently hardcoded to \(> \max(5, 5\%)\))

```4506:4524:g:\My Drive\Tech Jobs\ISC\Presentation\Report 2\Task 1 Supply Chain Database\Diagrams\SC Database Diagrams\Diagrams\Diagrams Version 129-Assign_Sourcing_Analysis\AppScript\ISC_SCM_Core_Lib\SQL_Vault.txt
      SELECT 
          A.*,
          B.BOM_TOTAL_SHORTAGE,
          B.BOM_TOTAL_DEMAND,
          B.BOM_TOTAL_ISSUED,
          B.BOM_STOCK,
          B.BOM_PO_ON_WAY,
          (A.NET_SHORTAGE_QTY_AGG - B.BOM_TOTAL_SHORTAGE) AS BOM_SHORTAGE_DIFF,
          
          CASE
            WHEN A.NET_SHORTAGE_QTY_AGG = 0 AND B.BOM_TOTAL_SHORTAGE = 0 THEN 'OK'
            -- Threshold rule: Flag MISMATCH if difference is > 5 units OR > 5% of ground truth
            WHEN ABS(A.NET_SHORTAGE_QTY_AGG - B.BOM_TOTAL_SHORTAGE) > GREATEST(5, B.BOM_TOTAL_SHORTAGE * 0.05) THEN 'MISMATCH'
            ELSE 'OK'
          END AS BOM_SHORTAGE_STATUS
          
      FROM Aggregated_Base A
      LEFT JOIN `${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Shortage_Backup_VIEW` B 
          ON A.BOM_UPDATE = B.BOM_UPDATE;
```

---

## 3. Deployment assessment (what we can and cannot prove from this workspace)

### 3.1 What we can confirm **offline** (from code)

- **PASS**: The Phase 1 SQL definitions exist in `SQL_Vault.txt` and implement the V5 logic contracts listed above.
- **PASS**: There is a supported deployment mechanism to push SQL assets to BigQuery:
  - `admin_DeploySQLAssets()` executes every SQL asset in the vault (no dependency ordering).
  - There are also “smart deploy” helpers (dependency-ordered) in `Admin_Infrastructure.txt`, but those are for the M2 dual-method shortage upgrade, not specifically for the aggregated sourcing view.

### 3.2 What we cannot confirm **offline**

This workspace does not contain live BigQuery job results, so we cannot prove:

- The view exists **in BigQuery** right now
- The view compiles without errors in your dataset
- The view outputs correct counts/sums for your current production data

So the “deployment status” is:

- **Code readiness**: **PASS**
- **Runtime deployment verification**: **REQUIRES LIVE CHECK**

---

## 4. Minimal runtime checks to declare Phase 1 “successfully deployed”

Run these in BigQuery (or via Apps Script `runReadQueryMapped`) against your configured dataset:

### 4.1 Compile/existence checks

- `SELECT 1 FROM \`<project>.<dataset>.Sourcing_Feed_Aggregated_VIEW\` LIMIT 1;`
- `SELECT 1 FROM \`<project>.<dataset>.BOM_Shortage_Backup_VIEW\` LIMIT 1;`

Expected: both queries run without error.

### 4.2 Row-shape & uniqueness check (PUBLIC aggregation)

- One row per `BOM_UPDATE` in the aggregated view:

```sql
SELECT
  COUNT(*) AS row_count,
  COUNT(DISTINCT BOM_UPDATE) AS distinct_bom
FROM `<project>.<dataset>.Sourcing_Feed_Aggregated_VIEW`;
```

Expected: `row_count = distinct_bom`.

### 4.3 Deterministic ordering alignment check (spot)

Pick 1 BOM with multiple VPOs:

```sql
SELECT
  BOM_UPDATE,
  VPO_AGG,
  DRAFT_PR_ID_AGG,
  VPO_COMPONENTS_JSON
FROM `<project>.<dataset>.Sourcing_Feed_Aggregated_VIEW`
WHERE VPO_COUNT >= 2
LIMIT 20;
```

Expected:
- `VPO_AGG` and `DRAFT_PR_ID_AGG` have the same number of pipe segments.
- Ordering is stable (re-running yields same ordering for the same BOM).

### 4.4 Backup shortage join present + mismatch distribution sanity

```sql
SELECT
  BOM_SHORTAGE_STATUS,
  COUNT(*) AS bom_count
FROM `<project>.<dataset>.Sourcing_Feed_Aggregated_VIEW`
GROUP BY BOM_SHORTAGE_STATUS;
```

Expected:
- Mostly `OK`
- A small fraction `MISMATCH` (and those are the ones you’ll treat carefully in Phase 2 UI)

---

## 5. Phase 1 “success” verdict (based on evidence available here)

- **Phase 1 logic implemented in `SQL_Vault.txt`**: **YES (PASS)**
- **Phase 1 deployed to BigQuery and producing correct outputs**: **UNKNOWN until runtime checks are run**

If your Phase 1 deployment step included running `admin_DeploySQLAssets()` after updating `SQL_Vault.txt`, then the **most likely** outcome is that these two views are installed; the checks in Section 4 are the definitive proof.

---

## 6. Critical note for Phase 2 planning

Your current M3 sourcing UI (`ISC_Module_M3/M3_Sourcing_Main.txt`) still reads from:

- `SOURCING_CONSTANTS.VIEW_NAME = 'Sourcing_Feed_VIEW'`

So Phase 1 alone will **not** change the planner experience until Phase 2 adds:

- Aggregation mode selector
- Reading from `Sourcing_Feed_Aggregated_VIEW` for PUBLIC flows
- Upload “explode” logic back into VPO-level rows for `PR_Staging`

