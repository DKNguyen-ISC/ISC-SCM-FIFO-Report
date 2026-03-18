# Phase 2 Implementation Plan (V7) — Decoupled BOM Aggregation Sourcing (M3)

**Scope:** Assign Sourcing (M3) — Decoupled PUBLIC BOM Aggregation & Explode Logic
**Synthesized from:** V2 (system baseline), V3 (decoupled architecture), V4 (column contracts), V5 (algorithm & formula spec), V6 (codebase verification), Phase1_Review.md
**Date:** 2026-03-17
**Status:** Authoritative implementation specification — supersedes all prior versions

---

## V7 Changelog vs V6

| # | Fix / Addition | Category |
|---|---|---|
| F1 | Corrected `VPO_COMPONENTS_JSON` SQL syntax: `ARRAY_AGG(STRUCT(...))` produces a BigQuery native ARRAY, not a JSON string. Apps Script receives a plain string column; the correct pattern is `CONCAT('[', STRING_AGG(TO_JSON_STRING(STRUCT(...)), ',' ORDER BY ...), ']')` — as confirmed in the existing codebase. | **Critical SQL Bug Fix** |
| F2 | Phase 1 SQL in production (`SQL_Vault.txt`) is missing `delivery_date` in the JSON payload. This is not a "done prerequisite" — it is an explicit upgrade task in Phase 2 Gate A. | **Critical Prerequisite Gap** |
| F3 | `SUPPLIER_CHECK` auto-set conditions defined explicitly for the first time. | **Spec Gap Filled** |
| F4 | `SAVINGS_VS_LEGACY` staleness handling promoted to a concrete UI requirement (italic column, dashboard disclaimer). | **UX Requirement Hardened** |
| F5 | Savings computation at load time uses effective tolerance = 10% default (since Col Z is not yet populated). The formula for `LEGACY_TOTAL` is stated precisely. | **Algorithm Precision** |
| F6 | Third soft warning (zero-shortage override path) integrated into upload-time validations in full. | **Completeness** |
| F7 | SP invoked once per batch explicitly stated in algorithm Step 9 (carried from V5, lost in V6 pseudocode). | **Correctness** |
| F8 | Full 20-test QA matrix integrated cleanly (V5 had 17, V6 added 3 in a separate table — now unified). | **QA Completeness** |
| F9 | Col AG clarified: no longer "Reserved" — used as `LEAD_TIME_OVERRIDE` (planner-editable) to override `STANDARD_LEAD_TIME_REF`. | **Spec Gap Filled** |
| F10 | Concrete build tasks refined with sub-tasks per Gate for direct implementation handoff. | **Implementability** |

---

## 0. Executive Summary & Phase 2 Goals

### 0.1 Verified Business Problem

Three root-cause problems exist in the current M3 `Assign_Sourcing` workflow (verified in Part 1 analysis):

- **P1 — Tolerance Divergence:** CS tolerance varies by BOM while ISC system applies a fixed 10% buffer — leading to gross demand mismatch when decisions are made per VPO.
- **P2 — VPO Fragmentation / SPQ Waste:** Multi-VPO BOMs apply `CEILING(..., SPQ)` repeatedly on tiny fragments. Example: 15 VPOs × 5 units each = 75 units total; SPQ = 100 → legacy orders `15 × 100 = 1,500 units` instead of a single bulk order of `100 units`. A 20× over-order.
- **P3 — Issuance Attribution Noise:** Warehouse issuance is combined at BOM level, making per-VPO shortage figures unreliable. BOM-level totals are the reliable ground truth.

### 0.2 The Solution

Phase 2 introduces a **BOM-Aggregated Sourcing Pipeline** exclusively for PUBLIC materials. Planners decide based on total BOM-level shortage, apply a single tolerance/SPQ constraint once, and the system "explodes" that bulk quantity back into VPO-level `PR_Staging` records — deterministically, with zero remainder loss.

### 0.3 Decoupled Architecture (Locked)

Injecting BOM-aggregated logic into the existing VPO-level pipeline creates fundamentally incompatible data contracts, column schemas, and upload algorithms. The two pipelines are architecturally separated.

| Concern | Legacy VPO Pipeline | Aggregated BOM Pipeline (NEW) |
|---|---|---|
| **Target Material** | PRIVATE materials & manual fallback | PUBLIC materials |
| **BigQuery Source** | `Sourcing_Feed_VIEW` (VPO grain) | `Sourcing_Feed_Aggregated_VIEW` (BOM grain) |
| **UI Row Grain** | 1 Row = 1 VPO Request | 1 Row = 1 BOM (bundles N VPOs) |
| **Sheet Template** | `Tpl_Assign_Sourcing` (unchanged) | `Tpl_Assign_Sourcing_Aggregated` (new) |
| **Tolerance** | Inherited upstream, static in UI | Dynamic, row-level, planner-editable |
| **Upload Handler** | `runSourcingUpload()` (unchanged) | `uploadAggregatedExplode()` (new) |
| **Staging Destination** | `PR_Staging` (1 row per UI row) | `PR_Staging` (N rows per UI row) |
| **SP Downstream** | `SP_M3_MERGE_PR_DECISIONS` (unchanged) | Same SP (unchanged) |

### 0.4 Definition of "Done"

Phase 2 is complete when **all** of the following are verified:

- [ ] Phase 1 SQL upgraded: `VPO_COMPONENTS_JSON` in `SQL_Vault.txt` includes `delivery_date`.
- [ ] `Sourcing_Feed_Aggregated_VIEW` deployed to BigQuery and passes Q7.1 checklist.
- [ ] Two distinct sheet templates exist: `Tpl_Assign_Sourcing` and `Tpl_Assign_Sourcing_Aggregated`.
- [ ] Smart Router in `M3_Sourcing_Main.gs` correctly directs sessions by mode.
- [ ] `TOLERANCE_%_EFFECTIVE` formula uses V5 robust guard (blank/non-numeric/negative/>200 → default 10).
- [ ] `FINAL_Q_BOM` formula applies `÷100` on tolerance and CEILING with SPQ.
- [ ] `uploadAggregatedExplode()` guarantees `∑Qᵢ = Q_BOM` for every BOM row, with all `Qᵢ ≥ 0`.
- [ ] `SP_M3_MERGE_PR_DECISIONS` is untouched and processes exploded rows correctly.
- [ ] PRIVATE (Legacy) flow shows zero behavioral regression.
- [ ] All 20 QA scenarios in Section 7.4 pass.

---

## 1. System Baseline (Code-Verified)

### 1.1 Current Data Sources

`ISC_Module_M3/M3_Sourcing_Main.txt` (v57) reads from:

```
SOURCING_CONSTANTS.VIEW_NAME = 'Sourcing_Feed_VIEW'
```

This view is VPO-grain and is defined in `ISC_SCM_Core_Lib/SQL_Vault.txt`. Phase 2 introduces a controlled routing layer:

- **PUBLIC → `Sourcing_Feed_Aggregated_VIEW`** (to be upgraded in Gate A)
- **PRIVATE → `Sourcing_Feed_VIEW`** (unchanged)

**Codebase search confirms:** `Sourcing_Feed_Aggregated_VIEW` does not yet exist as a deployed view name in the codebase (search = 0 references in `M3_Sourcing_Main.txt`). The SQL definition exists in `SQL_Vault.txt` (Phase 1) but requires upgrade and runtime deployment.

### 1.2 Upload Contract (Strict 15-Column Schema)

The current upload in `M3_Sourcing_Main.txt` writes **one row per visible UI row** to `PR_Staging`, then calls `SP_M3_MERGE_PR_DECISIONS`. The staging table enforces this exact schema for every insert:

| # | Column | Aggregated Pipeline Source |
|---|---|---|
| 1 | `PR_STAGING_ID` | `components[i].draft_pr_id` from JSON — **critical: per-VPO, not BOM-level** |
| 2 | `BOM_UPDATE` | Col A of sheet row |
| 3 | `SUPPLIER_ID` | Col H (resolved from supplier selection) |
| 4 | `SUPPLIER_NAME` | Col I / Col AB |
| 5 | `QTY_TO_APPROVE` | `Qᵢ` — exploded integer allocation |
| 6 | `FULFILLMENT_MODE` | Hardcoded `'PUBLIC'` |
| 7 | `FINAL_UNIT_PRICE` | Col J |
| 8 | `REQUESTED_DELIVERY_DATE` | `components[i].delivery_date` — **per-VPO from JSON, not BOM-level Col N** |
| 9 | `VPO` | `components[i].vpo` from JSON |
| 10 | `VALIDATION_STATUS` | Hardcoded `'PENDING'` |
| 11 | `VALIDATION_LOG` | Hardcoded `'OK'` |
| 12 | `PIC` | Col C |
| 13 | `DATE_CODE` | Col AA |
| 14 | `UPDATED_BY` | `Session.getActiveUser().getEmail()` |
| 15 | `UPDATED_AT` | `new Date().toISOString()` |

> ⚠️ **Critical Contract:** `PR_STAGING_ID` must map to the **per-VPO `draft_pr_id`** from inside `VPO_COMPONENTS_JSON`, not to any BOM-level identifier. Violating this breaks `SP_M3_MERGE_PR_DECISIONS`.

> ⚠️ **Critical Contract:** `REQUESTED_DELIVERY_DATE` must be taken from the **per-VPO `delivery_date`** inside the JSON, not from the BOM-level `EARLIEST_REQUESTED_DELIVERY_DATE` (Col N). Each VPO has its own delivery expectation.

---

## 2. Design Decisions (Locked for V7)

### 2.1 Session Control Modes

A session control cell in dashboard Rows 1–4 provides three routing modes, persisted per session sheet:

| Mode | Behavior |
|---|---|
| `AUTO` *(Default)* | PUBLIC materials → Aggregated pipeline. PRIVATE materials → Legacy pipeline. |
| `AGGREGATED_ONLY` | Forces all items through Aggregated pipeline. For pilot/debug. |
| `VPO_LEVEL_ONLY` | Forces all items through Legacy pipeline. **Instant rollback path.** |

> The mode decision must be **data-driven** by `FULFILLMENT_MODE` in the source view. It must **not** be hardcoded to any specific material (e.g., "Chì"). Any PUBLIC material must route correctly without a code change.

### 2.2 Tolerance Model: Row-Level, Planner-Owned (Option A)

Tolerance is applied **per BOM row**, not as a session-wide setting. BOM aggregation already reduces row count to a manageable number, making per-row input operationally feasible.

**Option A (Locked):** Tolerance is a **planner decisioning overlay** applied to `NET_SHORTAGE_QTY_AGG` for the purpose of computing `Q_BOM` only. It does not recompute upstream `PR_Draft` values from M2. The upload transmits `Q_BOM` and its exploded integer fragments with no upstream interference.

`ISC_BUFFER = 10%` is the default/fallback when tolerance input is blank or invalid.

### 2.3 SPQ Terminology

The rounding increment is **SPQ (Standard Package Quantity)**. The legacy label `STANDARD_MOQ_REF` is renamed to `SPQ_REF` in the Aggregated template. True MOQ (minimum order quantity) remains out of Phase 2 scope.

---

## 3. BigQuery Data Contract

### 3.1 Phase 1 SQL Upgrade Required (Gate A Blocker)

The Phase 1 `VPO_COMPONENTS_JSON` definition in `SQL_Vault.txt` currently contains:

```sql
CONCAT('[', STRING_AGG(
  TO_JSON_STRING(STRUCT(
    VPO AS vpo,
    DRAFT_PR_ID AS draft_pr_id,
    NET_SHORTAGE_QTY AS net_shortage_qty
    -- ⚠️ delivery_date IS MISSING — V5 identified this as critical
  )), ',' ORDER BY VPO ASC
), ']') AS VPO_COMPONENTS_JSON,
```

**Gate A requires upgrading this to:**

```sql
CONCAT('[', STRING_AGG(
  TO_JSON_STRING(STRUCT(
    VPO                AS vpo,
    DRAFT_PR_ID        AS draft_pr_id,
    NET_SHORTAGE_QTY   AS net_shortage_qty,
    DELIVERY_DATE      AS delivery_date   -- ← V7 addition, required for explode tie-break
  )), ',' ORDER BY VPO ASC
), ']') AS VPO_COMPONENTS_JSON,
```

> ⚠️ **V7 SQL Format Note (corrects V6):** The JSON payload **must** use `CONCAT + STRING_AGG + TO_JSON_STRING`, not `ARRAY_AGG(STRUCT(...))`. `ARRAY_AGG` produces a BigQuery native ARRAY type which does not serialize to a JSON string in Apps Script. The `CONCAT + STRING_AGG + TO_JSON_STRING` pattern (confirmed in the existing codebase) produces a proper JSON string that `JSON.parse()` can consume directly.

### 3.2 Full `Sourcing_Feed_Aggregated_VIEW` Specification

Deploy as a new asset in `SQL_Vault.txt` via `admin_DeploySQLAssets()`:

```sql
-- Grain: 1 row per PUBLIC BOM_UPDATE
-- Source: PR_Draft (VPO-level) + BOM_Shortage_Backup_VIEW (BOM totals for mismatch check)

WITH Aggregated_Base AS (
  SELECT
    CAST('BOM_AGG' AS STRING)                           AS ROW_GRAIN,
    CAST('Sourcing_Feed_Aggregated_VIEW' AS STRING)     AS SOURCE_VIEW,
    BOM_UPDATE,
    BOM_DESCRIPTION,
    MAIN_GROUP,
    COUNT(DISTINCT VPO)                                  AS VPO_COUNT,
    ANY_VALUE(ASSIGNED_SUPPLIER_NAME)                    AS ASSIGNED_SUPPLIER_NAME,
    ANY_VALUE(KNOWN_CAPACITY_OPTIONS)                    AS KNOWN_CAPACITY_OPTIONS,
    ANY_VALUE(PIC)                                       AS PIC,
    MIN(DELIVERY_DATE)                                   AS EARLIEST_REQUESTED_DELIVERY_DATE,

    -- Aggregated shortage sum
    SUM(GREATEST(0, NET_SHORTAGE_QTY))                  AS NET_SHORTAGE_QTY_AGG,

    -- Deterministic pipe-delimited backup lists
    STRING_AGG(VPO,          '|' ORDER BY VPO ASC)     AS VPO_AGG,
    STRING_AGG(DRAFT_PR_ID,  '|' ORDER BY VPO ASC)     AS DRAFT_PR_ID_AGG,

    -- JSON payload for Explode algorithm (Apps Script JSON.parse compatible)
    CONCAT('[', STRING_AGG(
      TO_JSON_STRING(STRUCT(
        VPO              AS vpo,
        DRAFT_PR_ID      AS draft_pr_id,
        NET_SHORTAGE_QTY AS net_shortage_qty,
        DELIVERY_DATE    AS delivery_date    -- Required for tie-break in Explode Step 6
      )), ',' ORDER BY VPO ASC
    ), ']')                                             AS VPO_COMPONENTS_JSON,

    -- Optional diagnostic
    COUNT(DISTINCT ASSIGNED_SUPPLIER_NAME)              AS SUPPLIER_CONSISTENCY_CHECK

  FROM `${ENV.PROJECT_ID}.${ENV.DATASET_ID}.M2_Output`  -- or PR_Draft, per system alias
  WHERE LOWER(TRIM(FULFILLMENT_MODE)) = 'public'
  GROUP BY BOM_UPDATE, BOM_DESCRIPTION, MAIN_GROUP
)

SELECT
  A.*,
  B.BOM_TOTAL_SHORTAGE,
  B.BOM_TOTAL_DEMAND,
  B.BOM_TOTAL_ISSUED,
  B.BOM_STOCK,
  B.BOM_PO_ON_WAY,
  (A.NET_SHORTAGE_QTY_AGG - B.BOM_TOTAL_SHORTAGE)  AS BOM_SHORTAGE_DIFF,

  CASE
    WHEN A.NET_SHORTAGE_QTY_AGG = 0 AND B.BOM_TOTAL_SHORTAGE = 0 THEN 'OK'
    WHEN ABS(A.NET_SHORTAGE_QTY_AGG - B.BOM_TOTAL_SHORTAGE) >
         GREATEST(5, B.BOM_TOTAL_SHORTAGE * 0.05)     THEN 'MISMATCH'
    ELSE 'OK'
  END                                                  AS BOM_SHORTAGE_STATUS

FROM Aggregated_Base A
LEFT JOIN `${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Shortage_Backup_VIEW` B
  ON A.BOM_UPDATE = B.BOM_UPDATE;
```

### 3.3 Post-Deploy Verification Checklist (Q7.1)

Run in BigQuery after `admin_DeploySQLAssets()`:

```sql
-- Check 1: One row per PUBLIC BOM
SELECT COUNT(*) AS rows, COUNT(DISTINCT BOM_UPDATE) AS distinct_boms
FROM `<project>.<dataset>.Sourcing_Feed_Aggregated_VIEW`;
-- EXPECTED: rows = distinct_boms

-- Check 2: JSON element count matches pipe-list length
SELECT BOM_UPDATE,
  ARRAY_LENGTH(JSON_EXTRACT_ARRAY(VPO_COMPONENTS_JSON)) AS json_count,
  (LENGTH(VPO_AGG) - LENGTH(REPLACE(VPO_AGG, '|', '')) + 1) AS pipe_count
FROM `<project>.<dataset>.Sourcing_Feed_Aggregated_VIEW`
WHERE ARRAY_LENGTH(JSON_EXTRACT_ARRAY(VPO_COMPONENTS_JSON))
   != (LENGTH(VPO_AGG) - LENGTH(REPLACE(VPO_AGG, '|', '')) + 1)
LIMIT 10;
-- EXPECTED: 0 rows

-- Check 3: NET_SHORTAGE_QTY_AGG equals sum of components
-- (Cross-validate against BOM_TOTAL_SHORTAGE for OK rows)
SELECT BOM_SHORTAGE_STATUS, COUNT(*) AS bom_count
FROM `<project>.<dataset>.Sourcing_Feed_Aggregated_VIEW`
GROUP BY BOM_SHORTAGE_STATUS;
-- EXPECTED: Mostly 'OK'; small fraction 'MISMATCH'

-- Check 4: delivery_date present in every JSON element (spot check)
SELECT BOM_UPDATE, VPO_COMPONENTS_JSON
FROM `<project>.<dataset>.Sourcing_Feed_Aggregated_VIEW`
WHERE VPO_COMPONENTS_JSON NOT LIKE '%delivery_date%'
LIMIT 5;
-- EXPECTED: 0 rows
```

---

## 4. Template Architecture: `Tpl_Assign_Sourcing_Aggregated`

A new method `buildAggregatedInterface()` in `M3_Sourcing_SheetBuilder.gs` builds this template. It integrates with the existing Zone A / Pillar / Zone B framework from SheetBuilder v57.

### 4.1 Zone Architecture

#### Zone A: System Outputs & Upload Payload (Columns A–P, Locked / Formula)

*`uploadAggregatedExplode()` reads its payload by fixed column index from this zone.*

| Col | Field | Source / Formula |
|---|---|---|
| A | `BOM_UPDATE` | Loaded from `Sourcing_Feed_Aggregated_VIEW` |
| B | `FULFILLMENT_MODE` | Hardcoded `'PUBLIC'` |
| C | `PIC` | From session context |
| D–G | *(Reserved / System)* | — |
| H | `SUPPLIER_ID` | Looked up from AB (supplier name → ID) |
| I | `ASSIGNED_SUPPLIER_NAME` | Mirror of Col AB selection |
| J | `FINAL_UNIT_PRICE` | `=IF(AE{row}>0, AE{row}, AD{row})` |
| K | `FINAL_LEAD_TIME` | `=IF(AG{row}>0, AG{row}, AF{row})` |
| L | **`FINAL_Q_BOM`** | See Section 4.3 — **Explode input** |
| M | `PROJECTED_ARRIVAL_DATE` | `=N{row} + K{row}` (days) |
| N | `EARLIEST_REQUESTED_DELIVERY_DATE` | From view (MIN delivery_date across VPOs) |
| O | *(Reserved)* | — |
| P | `SUPPLIER_CHECK` | Auto-set TRUE when: AB not blank AND AA not blank AND L ≥ 0 |

> **SUPPLIER_CHECK Auto-Set Logic (V7 Addition):** `SUPPLIER_CHECK` evaluates to `TRUE` when all of the following hold: `ASSIGNED_SUPPLIER_NAME` (Col AB) is not blank, `DATE_CODE` (Col AA) is not blank, and `FINAL_Q_BOM` (Col L) is a non-negative number. The script sets this column automatically on each row evaluation — the planner does not set it manually.

#### Pillar 1: Column Q (`RAW_START`)

Apps Script delimiter — marks the boundary between Zone A (locked) and Zone B (editable).

#### Zone B: Planner Context & Inputs (Columns R–AK)

| Col | Field | Color | Notes |
|---|---|---|---|
| R | `BOM_CTX` | Grey | BOM identifier (read-only context) |
| S | `BOM_DESCRIPTION` | Grey | Material description |
| T | `MAIN_GROUP` | Grey | Material classification group |
| U | `VPO_COUNT` | Blue | Read-only. e.g., `"15 VPOs included"` |
| V | **`VPO_COMPONENTS_JSON`** | Hidden | Full JSON for Explode — do not delete |
| W | `NET_SHORTAGE_QTY_AGG` | Blue | Read-only aggregated base shortage |
| X | `BOM_SHORTAGE_STATUS` | Blue | `'OK'` / `'MISMATCH'` — MISMATCH → red conditional formatting |
| Y | **`TOLERANCE_%_INPUT`** | Yellow | Editable. Planner types `10` for 10%. Blank → default applies |
| Z | **`TOLERANCE_%_EFFECTIVE`** | Yellow | Formula — see Section 4.2 |
| AA | `DATE_CODE` | Yellow | Editable. Required before upload |
| AB | `ASSIGNED_SUPPLIER_NAME` | Yellow | Dropdown from `KNOWN_CAPACITY_OPTIONS` |
| AC | `KNOWN_CAPACITY_OPTIONS` | Grey | Reference list from view |
| AD | `STANDARD_PRICE_REF` | Grey | Reference price |
| AE | `UNIT_PRICE_OVERRIDE` | Yellow | Editable. If > 0, overrides AD for FINAL_UNIT_PRICE |
| AF | `STANDARD_LEAD_TIME_REF` | Grey | Reference lead time from view |
| AG | **`LEAD_TIME_OVERRIDE`** | Yellow | Editable. If > 0, overrides AF for FINAL_LEAD_TIME (replaces "Reserved" from V5) |
| AH | **`SPQ_REF`** | Blue | Standard Package Quantity — CEILING increment |
| AI | **`MANUAL_Q_BOM_OVERRIDE`** | Yellow | If > 0, overrides formula entirely for FINAL_Q_BOM |
| AJ | **`SAVINGS_VS_LEGACY`** | Purple | Script-populated at load time (see Section 4.4) |

#### Pillar 2: Column AK (`RAW_END`)

Apps Script delimiter — marks the end of Zone B.

---

### 4.2 `TOLERANCE_%_EFFECTIVE` Formula (Col Z) — V5 Specification, V7 Confirmed

```
=IF(OR(ISBLANK(Y{row}), NOT(ISNUMBER(Y{row})), Y{row}<0, Y{row}>200), 10, Y{row})
```

| Input condition | Result in Z |
|---|---|
| Blank | `10` (default 10%) |
| Non-numeric (e.g., "abc" pasted) | `10` |
| Negative (e.g., `-5`) | `10` |
| Exceeds 200 (sanity cap) | `10` |
| Valid number (e.g., `5`, `15`) | Use that value |

**Conditional Formatting on Col Y:** If Y is non-blank but Z evaluates to `10` (i.e., the fallback was triggered by invalid input), highlight Col Y in **orange** to signal the override.

---

### 4.3 `FINAL_Q_BOM` Formula (Col L)

```
=IF(AI{row}>0,
    AI{row},
    CEILING(W{row} * (1 + Z{row}/100), AH{row})
)
```

**Logic:**
1. If `MANUAL_Q_BOM_OVERRIDE` (Col AI) is positive → use it as-is. Bypasses all formula math.
2. Otherwise: `ADJUSTED_QTY = NET_SHORTAGE_QTY_AGG × (1 + TOLERANCE_%_EFFECTIVE / 100)`, then `FINAL_Q_BOM = CEILING(ADJUSTED_QTY, SPQ_REF)`.

> ⚠️ **Critical:** `TOLERANCE_%_EFFECTIVE` stores the tolerance as a plain number (e.g., `10` for 10%). The formula **must divide by 100** before applying as a multiplier.

**Edge case:** If `W{row} = 0` and `AI{row}` is blank, `FINAL_Q_BOM = CEILING(0, SPQ) = 0`. No order is generated. Only a `MANUAL_Q_BOM_OVERRIDE > 0` can force an order on a zero-shortage BOM.

---

### 4.4 `SAVINGS_VS_LEGACY` (Col AJ) — Script-Populated

Because `VPO_COMPONENTS_JSON` (Col V) is a hidden string, a Sheets formula cannot iterate the JSON to compute per-VPO legacy rounding. **This column is populated by `loadSourcingSession()` at data load time**, not by a live formula.

**Computation (at load time, before planner input):**

```
Effective tolerance at load = 10  (default, since Col Z is not yet populated by planner)

For each VPO_i in VPO_COMPONENTS_JSON:
  legacy_i = CEILING(max(0, net_shortage_qty_i) × (1 + 10/100), SPQ_REF)

LEGACY_TOTAL = SUM(legacy_i) for all VPOs in this BOM row
SAVINGS_VS_LEGACY = LEGACY_TOTAL − FINAL_Q_BOM_at_load_time
```

**Display rules:**
- `SAVINGS > 0`: Aggregation saves units. Display green.
- `SAVINGS = 0`: No rounding benefit (e.g., single VPO, or perfectly divisible). Display neutral.
- `SAVINGS < 0`: Should never occur mathematically. Log warning: `"Savings anomaly on BOM row {BOM_UPDATE} — investigate"`. Continue (do not block load).

**UI staleness handling (V7 requirement):** Because this column is script-populated at load time, it becomes stale if the planner later changes Tolerance or Override. The column header should be rendered in **italic** and the dashboard must show the note: *"Savings figures reflect values at load time. Re-load session to refresh."*

---

## 5. The Explode Algorithm (`uploadAggregatedExplode()`)

### 5.1 Pre-Flight: Row Eligibility

Filter active sheet rows where **all** of the following are true:
- `SUPPLIER_CHECK` (Col P) = `TRUE`
- `ASSIGNED_SUPPLIER_NAME` (Col AB) is not blank
- `FINAL_Q_BOM` (Col L) is a non-negative number (0 is valid — it clears the draft)

### 5.2 Step-by-Step Execution (Per Eligible Row)

**Step 1 — Extract Inputs**
```javascript
const Q_BOM  = getColValue(row, COL.FINAL_Q_BOM);       // Integer ≥ 0
const jsonStr = getColValue(row, COL.VPO_COMPONENTS_JSON);
```

**Step 2 — Parse & Validate JSON**
```javascript
let components;
try {
  components = JSON.parse(jsonStr);
} catch (e) {
  throw new HardError(`Row ${row}: VPO_COMPONENTS_JSON is corrupted. Upload aborted.`);
}
if (!Array.isArray(components) || components.length === 0) {
  throw new HardError(`Row ${row}: VPO_COMPONENTS_JSON parsed to empty array. Upload aborted.`);
}
// Validate required keys on every element
components.forEach((c, idx) => {
  ['vpo', 'draft_pr_id', 'net_shortage_qty', 'delivery_date'].forEach(key => {
    if (c[key] === undefined || c[key] === null || c[key] === '') {
      throw new HardError(`Row ${row}, element ${idx}: Missing key '${key}'. Upload aborted.`);
    }
  });
});
// Cross-validate element count vs pipe-list
const pipeListCount = getColValue(row, COL.DRAFT_PR_ID_AGG).split('|').length;
if (components.length !== pipeListCount) {
  throw new HardError(`Row ${row}: JSON element count (${components.length}) != pipe-list count (${pipeListCount}). Upload aborted.`);
}
```

**Step 3 — Compute Weights**
```javascript
const weights = components.map(c => Math.max(0, Number(c.net_shortage_qty)));
const W = weights.reduce((sum, w) => sum + w, 0);
```

**Step 4 — Four Edge Case Branches**

| Condition | Action |
|---|---|
| `W > 0` and `Q_BOM > 0` | Normal path → proportional allocation (Step 5) |
| `W > 0` and `Q_BOM = 0` | All `Qᵢ = 0` (planner chose not to order) → skip to Step 7 |
| `W = 0` and `Q_BOM = 0` | All `Qᵢ = 0` → skip to Step 7 |
| `W = 0` and `Q_BOM > 0` | Manual override on zero-shortage BOM → entire `Q_BOM` allocated to VPO with **earliest `delivery_date`**; tie-break by lexicographically smallest `vpo` string. Log warning. → skip to Step 7 |

**Step 5 — Fractional Slicing (Normal Path Only)**
```javascript
const rawSlices = weights.map(w => (w / W) * Q_BOM);
const intBases  = rawSlices.map(s => Math.floor(s));
const remainders = rawSlices.map((s, i) => s - intBases[i]);
```

**Step 6 — Largest Remainder Resolution (Integer Output)**
```javascript
const allocated = intBases.reduce((sum, q) => sum + q, 0);
let delta = Q_BOM - allocated;   // Units remaining to distribute; always ≥ 0

// Sort indices: descending remainder → earliest delivery_date → vpo ascending
const sortedIdx = components.map((_, i) => i).sort((a, b) => {
  if (Math.abs(remainders[b] - remainders[a]) > 1e-9) return remainders[b] - remainders[a];
  const dateA = new Date(components[a].delivery_date);
  const dateB = new Date(components[b].delivery_date);
  if (dateA - dateB !== 0) return dateA - dateB;
  return components[a].vpo.localeCompare(components[b].vpo);
});

for (let k = 0; k < delta; k++) {
  intBases[sortedIdx[k]] += 1;
}
// INVARIANT: intBases.reduce((s,q) => s+q, 0) === Q_BOM  ✓
// INVARIANT: all intBases[i] >= 0                         ✓
```

**Step 7 — Construct Staging Rows**
```javascript
for (let i = 0; i < components.length; i++) {
  stagingRows.push({
    PR_STAGING_ID:           components[i].draft_pr_id,   // Critical: per-VPO DRAFT_PR_ID
    BOM_UPDATE:              getColValue(row, COL.BOM_UPDATE),
    SUPPLIER_ID:             getColValue(row, COL.SUPPLIER_ID),
    SUPPLIER_NAME:           getColValue(row, COL.ASSIGNED_SUPPLIER_NAME),
    QTY_TO_APPROVE:          intBases[i],                  // Qᵢ (integer, ≥ 0)
    FULFILLMENT_MODE:        'PUBLIC',
    FINAL_UNIT_PRICE:        getColValue(row, COL.FINAL_UNIT_PRICE),
    REQUESTED_DELIVERY_DATE: components[i].delivery_date,  // Per-VPO, not BOM-level Col N
    VPO:                     components[i].vpo,
    VALIDATION_STATUS:       'PENDING',
    VALIDATION_LOG:          'OK',
    PIC:                     getColValue(row, COL.PIC),
    DATE_CODE:               getColValue(row, COL.DATE_CODE),
    UPDATED_BY:              Session.getActiveUser().getEmail(),
    UPDATED_AT:              new Date().toISOString()
  });
}
```

**Step 8 — Compile CSV and Batch Upload**
```javascript
const csvPayload = compileToCsv(allStagingRows);  // Across ALL eligible BOM rows
ISC_SCM_Core_Lib.loadCsvData('PR_Staging', csvPayload, 'WRITE_APPEND');
```

**Step 9 — Invoke Merge SP (Once Per Batch)**
```javascript
ISC_SCM_Core_Lib.executeSP('SP_M3_MERGE_PR_DECISIONS');
// SP is called ONCE after all BOM rows are uploaded — NOT once per BOM row.
```

---

### 5.3 Upload-Time Validations

#### Hard Errors (Abort immediately — no data written to `PR_Staging`)

| Condition | Error Message |
|---|---|
| `VPO_COMPONENTS_JSON` missing, blank, or `JSON.parse` fails | `"Row X: JSON payload corrupted or truncated. Upload aborted."` |
| JSON element count ≠ pipe-list count in `DRAFT_PR_ID_AGG` | `"Row X: JSON element count mismatch. Upload aborted."` |
| Any required JSON key (`vpo`, `draft_pr_id`, `net_shortage_qty`, `delivery_date`) is null/empty | `"Row X, element N: Missing key '{key}'. Upload aborted."` |
| `FINAL_Q_BOM` is non-numeric or negative | `"Row X: FINAL_Q_BOM is invalid. Upload aborted."` |

#### Soft Warnings (Require explicit user confirmation to proceed)

| Condition | Warning Message |
|---|---|
| `BOM_SHORTAGE_STATUS = 'MISMATCH'` and `Q_BOM > 0` | `"Row X: BOM shortage mismatch detected. Aggregated total differs from M2 master. Proceed?"` |
| `Q_BOM > NET_SHORTAGE_QTY_AGG × 3.0` (ordering more than 200% above shortage) | `"Row X: Order quantity is >200% above shortage. This may indicate a manual override anomaly. Proceed?"` |
| `W = 0` and `Q_BOM > 0` (zero-shortage override path triggered) | `"Row X: All underlying VPOs show zero shortage but a manual override quantity was set. Entire quantity will be assigned to the earliest VPO. Proceed?"` |

---

## 6. Session Lifecycle & Orchestration

### 6.1 Session Load: `loadSourcingSession()`

```
1. Read dashboard mode control cell (AUTO / AGGREGATED_ONLY / VPO_LEVEL_ONLY)
2. Call resolvePicIdentity() for the current user
3. Show scope/group/method dialog (existing logic)
4. Query BigQuery to determine user's pending workload:
   - AUTO:             Separate into PUBLIC and PRIVATE buckets by FULFILLMENT_MODE
   - AGGREGATED_ONLY:  Treat all as PUBLIC
   - VPO_LEVEL_ONLY:   Treat all as PRIVATE
5. Route:
   - PUBLIC  → find/create sheet '{PICName}_Assign_Sourcing_Aggregated'
             → buildAggregatedInterface()
             → populate from Sourcing_Feed_Aggregated_VIEW
             → compute and write SAVINGS_VS_LEGACY (Col AJ) per row
   - PRIVATE → find/create sheet '{PICName}_Assign_Sourcing' (unchanged legacy path)
             → populate from Sourcing_Feed_VIEW
6. Update dashboard read-only indicators:
   - Mode currently active
   - Count of MISMATCH rows (from BOM_SHORTAGE_STATUS)
   - Total SAVINGS_VS_LEGACY (column sum)
   - Last loaded timestamp
   - Note: "Savings figures reflect values at load time. Re-load session to refresh."
```

**Logging (required):**
- Log mode chosen at session start.
- Log count of Aggregated rows loaded and Legacy rows loaded.

### 6.2 Planner Workflow Inside the Aggregated Sheet

1. Planner reviews `VPO_COUNT` (Col U) and `NET_SHORTAGE_QTY_AGG` (Col W) per BOM row.
2. Planner checks `BOM_SHORTAGE_STATUS` (Col X) — red flag on MISMATCH rows prompts investigation before ordering.
3. Planner types tolerance percentage into `TOLERANCE_%_INPUT` (Col Y) or leaves blank for 10% default.
4. Sheet instantly recalculates `TOLERANCE_%_EFFECTIVE` (Col Z) and `FINAL_Q_BOM` (Col L).
5. Planner optionally enters `MANUAL_Q_BOM_OVERRIDE` (Col AI) to hard-set the order quantity.
6. Planner selects supplier from `ASSIGNED_SUPPLIER_NAME` dropdown (Col AB).
7. Planner fills `DATE_CODE` (Col AA).
8. `SUPPLIER_CHECK` (Col P) sets automatically when all required fields are filled.
9. Planner reviews `SAVINGS_VS_LEGACY` (Col AJ) for aggregate efficiency signal.
10. Planner clicks "Upload Sourcing" → `uploadAggregatedExplode()` runs.

---

## 7. Cross-Module Verification Plan

### 7.1 BigQuery Verification Checklist

- [ ] `Sourcing_Feed_Aggregated_VIEW` returns exactly **one row per PUBLIC BOM**.
- [ ] `VPO_COMPONENTS_JSON` parses successfully via `JSON.parse()`.
- [ ] JSON element count matches `VPO_AGG` and `DRAFT_PR_ID_AGG` pipe-list lengths for every row.
- [ ] `NET_SHORTAGE_QTY_AGG` = `SUM(max(0, net_shortage_qty))` for all underlying VPO components.
- [ ] `BOM_Shortage_Backup_VIEW.BOM_TOTAL_SHORTAGE` aligns with `NET_SHORTAGE_QTY_AGG` for all `'OK'` rows.
- [ ] Mismatch distribution is sensible (not all rows are `'MISMATCH'` — that signals a view logic error).
- [ ] `ROW_GRAIN = 'BOM_AGG'` and `SOURCE_VIEW` columns present in every row.
- [ ] `delivery_date` is present and non-null in every element of `VPO_COMPONENTS_JSON`.
- [ ] View queries return within acceptable time under production row counts.

### 7.2 Apps Script Verification Checklist

- [ ] Session controls persist across sheet refresh and reload.
- [ ] `AUTO` mode routes PUBLIC rows to Aggregated sheet, PRIVATE to Legacy sheet.
- [ ] `VPO_LEVEL_ONLY` routes all rows to Legacy sheet.
- [ ] Aggregated template renders all columns in correct positions (spot-check Col L, V, Z, AH, AI, AJ).
- [ ] `TOLERANCE_%_EFFECTIVE` formula defaults to `10` for blank, non-numeric, negative, or >200 inputs.
- [ ] `FINAL_Q_BOM` formula correctly divides tolerance by 100 and applies CEILING with SPQ.
- [ ] `MANUAL_Q_BOM_OVERRIDE > 0` overrides `FINAL_Q_BOM` formula correctly.
- [ ] `SUPPLIER_CHECK` auto-sets correctly when all required fields are filled.
- [ ] `SAVINGS_VS_LEGACY` populated correctly at load time using 10% default tolerance.
- [ ] Explode algorithm: `∑Qᵢ = Q_BOM` for all test cases.
- [ ] Explode algorithm: all `Qᵢ ≥ 0`.
- [ ] Explode algorithm: deterministic — same inputs yield identical distribution across repeated runs.
- [ ] Hard errors abort upload before any data is written.
- [ ] Soft warnings pause upload and require confirmation.

### 7.3 Downstream Regression Checks

- [ ] `SP_M3_MERGE_PR_DECISIONS` succeeds for both legacy VPO rows and exploded aggregated rows.
- [ ] `PR_Final` rows are created/updated at correct VPO-level keys after merge.
- [ ] PRIVATE (Legacy) session: layout unchanged, upload produces 1 row → 1 staging record, merge succeeds.
- [ ] Consolidation and PO issuance modules continue processing `PR_Final` keys without modification.

### 7.4 QA Verification Matrix (20 Tests — V5 + V6 Unified)

| # | Test Scenario | Module | Input | Expected Outcome |
|---|---|---|---|---|
| 1 | **Tolerance Fallback — Blank** | Sheet UI | `TOLERANCE_%_INPUT` = blank | `EFFECTIVE` = 10 |
| 2 | **Tolerance Fallback — Text** | Sheet UI | `TOLERANCE_%_INPUT` = `"abc"` | `EFFECTIVE` = 10; Col Y highlighted orange |
| 3 | **Tolerance Fallback — Negative** | Sheet UI | `TOLERANCE_%_INPUT` = `-5` | `EFFECTIVE` = 10; Col Y highlighted orange |
| 4 | **Tolerance Fallback — Extreme** | Sheet UI | `TOLERANCE_%_INPUT` = `250` | `EFFECTIVE` = 10; Col Y highlighted orange |
| 5 | **Tolerance Valid** | Sheet UI | `TOLERANCE_%_INPUT` = `5` | `EFFECTIVE` = 5; `FINAL_Q_BOM = CEILING(W×1.05, SPQ)` |
| 6 | **Manual Override Wins** | Sheet UI | `MANUAL_Q_BOM_OVERRIDE` = 500; W = 300; SPQ = 100 | `FINAL_Q_BOM` = 500 (override wins regardless of formula) |
| 7 | **Zero Shortage, No Override** | Sheet UI | W = 0; AI = blank | `FINAL_Q_BOM` = 0 |
| 8 | **Explode Conservation — Even** | App Script | `Q_BOM` = 100; weights = [50, 30, 20] | `Q₁=50, Q₂=30, Q₃=20`; `∑=100` ✓ |
| 9 | **Explode Conservation — Uneven** | App Script | `Q_BOM` = 100; weights = [1, 1, 1] | `Q₁=34, Q₂=33, Q₃=33`; `∑=100` ✓ |
| 10 | **Explode Zero Shortage Override** | App Script | `Q_BOM` = 500; all `net_shortage_qty=0` | Entire 500 → earliest delivery VPO; warning logged |
| 11 | **Explode W=0, Q=0** | App Script | All `net_shortage_qty=0`; `Q_BOM=0` | All `Qᵢ=0`; no warning |
| 12 | **JSON Corruption — Hard Error** | App Script | `VPO_COMPONENTS_JSON` = `"{bad json"` | Upload aborts immediately; error displayed; zero rows written |
| 13 | **MISMATCH — Soft Warning** | App Script | `BOM_SHORTAGE_STATUS='MISMATCH'`; `Q_BOM>0` | Upload pauses; user confirmation required |
| 14 | **Legacy Protection** | End-to-End | PRIVATE VPO in Legacy tab | 1:1 row inserted to `PR_Staging`; aggregated logic not invoked |
| 15 | **Rollback** | End-to-End | Mode = `VPO_LEVEL_ONLY` | All items route to Legacy tab; Aggregated tab not created |
| 16 | **Savings Metric Accuracy** | Script + Sheet | `Q_BOM`=100; legacy would be 300 | `SAVINGS_VS_LEGACY` = 200 |
| 17 | **Savings Anomaly Flag** | Script | `SAVINGS_VS_LEGACY < 0` | Warning logged; load continues; column shown with anomaly marker |
| 18 | **BOM MISMATCH Upload Warning** | App Script | MISMATCH row with Q_BOM > 0; planner confirms | Upload proceeds after confirmation; rows written |
| 19 | **Missing `delivery_date` in JSON** | App Script | JSON element lacks `delivery_date` key | Hard error; upload aborted; specific row and key reported |
| 20 | **PRIVATE Full Regression** | End-to-End | Full PRIVATE session load → edit → upload → merge | Zero behavioral change in any step vs pre-Phase-2 baseline |

---

## 8. Deployment & Rollout Plan (Gated)

### Gate A — Data Readiness
- [ ] Upgrade `VPO_COMPONENTS_JSON` in `SQL_Vault.txt` to include `delivery_date` in STRUCT.
- [ ] Deploy `Sourcing_Feed_Aggregated_VIEW` via `admin_DeploySQLAssets()`.
- [ ] Run all 4 BigQuery verification queries from Section 3.3.
- [ ] Confirm all 9 items in BigQuery Verification Checklist (Section 7.1).

### Gate B — UI Deployment (Dry Run, Upload Disabled)
- [ ] Implement `buildAggregatedInterface()` in `M3_Sourcing_SheetBuilder.gs` with all columns from Section 4.1.
- [ ] Add session mode dropdown to dashboard Rows 1–4.
- [ ] Implement `TOLERANCE_%_EFFECTIVE` formula (Section 4.2) with conditional formatting.
- [ ] Implement `FINAL_Q_BOM` formula (Section 4.3).
- [ ] Add `LEAD_TIME_OVERRIDE` (Col AG) editable cell.
- [ ] Add `SUPPLIER_CHECK` auto-set logic (Section 4.1 note).
- [ ] Add dashboard read-only indicators + staleness disclaimer for savings.
- [ ] Disable Upload button. Load session for pilot PIC in `AGGREGATED_ONLY` mode. Verify column positions, formulas, formatting.

### Gate C — Algorithm Shadow Test (Logger Output)
- [ ] Implement `uploadAggregatedExplode()` with Step 8 redirected to `Logger.log()` (not `PR_Staging`).
- [ ] Submit 10 PUBLIC BOMs. Verify `∑Qᵢ = Q_BOM` for every row in Logger.
- [ ] Run QA scenarios 8–13 from the QA matrix.
- [ ] Implement savings computation in `_loadPendingPRsToSheet()`. Verify QA scenarios 16–17.

### Gate D — Staging Pilot (`PR_Staging_TEST`)
- [ ] Re-enable upload pointing to `PR_Staging_TEST` (test environment).
- [ ] Run 10 BOMs end-to-end: load → review → upload → merge → verify `PR_Final`.
- [ ] Confirm `SP_M3_MERGE_PR_DECISIONS` processes exploded rows correctly.
- [ ] Run QA scenarios 14 and 20 (regression tests).

### Gate E — Production Pilot (10% Traffic)
- [ ] Route 10% of PUBLIC workload to the Aggregated pipeline in `AUTO` mode.
- [ ] Monitor `PR_Final` creation, PO issuance, and consolidation for one complete cycle.
- [ ] Verify `SAVINGS_VS_LEGACY` figures in Dashboard match expectations.

### Gate F — Full Deployment
- [ ] Enable router for all users and all PUBLIC materials.
- [ ] Monitor for 2 weeks. Evaluate savings metrics.
- [ ] Run QA scenario 15 (rollback) as drill to confirm `VPO_LEVEL_ONLY` works under production traffic.

### Rollback Procedure (Available at Any Gate)

**Immediate rollback:** Set session control to `VPO_LEVEL_ONLY`. No SQL rollback required because:
1. `Sourcing_Feed_Aggregated_VIEW` is additive — legacy views are untouched.
2. `SP_M3_MERGE_PR_DECISIONS` is unchanged.
3. `Tpl_Assign_Sourcing` (legacy template) is unchanged.

---

## 9. Concrete Build Tasks (Implementation Order)

### Task 1 — Phase 1 SQL Upgrade (Gate A)
- [ ] Edit `SQL_Vault.txt`: add `DELIVERY_DATE AS delivery_date` to `VPO_COMPONENTS_JSON` STRUCT.
- [ ] Run `admin_DeploySQLAssets()`.
- [ ] Execute all 4 verification queries from Section 3.3.

### Task 2 — `Sourcing_Feed_Aggregated_VIEW` Deployment (Gate A)
- [ ] Add full VIEW definition from Section 3.2 to `SQL_Vault.txt`.
- [ ] Run `admin_DeploySQLAssets()`.
- [ ] Confirm all 9 BigQuery checklist items.

### Task 3 — Sheet Builder: Aggregated Template (Gate B)
- [ ] Implement `buildAggregatedInterface()` in `M3_Sourcing_SheetBuilder.gs`.
  - [ ] All Zone A columns (A–P) with locked formatting.
  - [ ] Pillar Q delimiter.
  - [ ] All Zone B columns (R–AK) with color coding.
  - [ ] `TOLERANCE_%_EFFECTIVE` formula + orange conditional formatting.
  - [ ] `FINAL_Q_BOM` formula with `÷100` and CEILING.
  - [ ] `LEAD_TIME_OVERRIDE` editable Col AG.
  - [ ] `SUPPLIER_CHECK` auto-set logic.
  - [ ] `ASSIGNED_SUPPLIER_NAME` dropdown wired to `KNOWN_CAPACITY_OPTIONS`.
  - [ ] `BOM_SHORTAGE_STATUS = 'MISMATCH'` → red conditional format on Col X.
  - [ ] Dashboard mode dropdown + read-only indicators.
  - [ ] Savings staleness disclaimer note.

### Task 4 — Session Router + Savings (Gate B + C)
- [ ] Modify `loadSourcingSession()` to read mode control and fork to Aggregated vs Legacy path.
- [ ] In `_loadPendingPRsToSheet()` (Aggregated path): compute and write `SAVINGS_VS_LEGACY` per row.
- [ ] Log: mode, row counts, savings anomalies.

### Task 5 — `uploadAggregatedExplode()` (Gate C → D)
- [ ] Implement pre-flight row eligibility filter.
- [ ] Implement Steps 1–9 from Section 5.2.
- [ ] Implement all Hard Error guards (Section 5.3).
- [ ] Implement all 3 Soft Warning confirmations (Section 5.3).
- [ ] Gate C: redirect Step 8 to Logger for shadow test.
- [ ] Gate D: wire to `ISC_SCM_Core_Lib.loadCsvData()` and `SP_M3_MERGE_PR_DECISIONS`.

### Task 6 — Logging & QA (All Gates)
- [ ] Log session mode at load.
- [ ] Log: aggregated rows loaded, legacy rows loaded.
- [ ] Log per-BOM explode results: `{BOM_UPDATE, Q_BOM, N_VPOs, sum_Qi}`.
- [ ] Log validation failures with row context.
- [ ] Execute all 20 QA scenarios from Section 7.4.

---

## 10. Acceptance Criteria (Phase 2)

Phase 2 is accepted **only if all of the following are true:**

1. **Rounding Waste Reduction:** `SAVINGS_VS_LEGACY > 0` for at least one pilot batch, confirming real efficiency gain.
2. **Sum Conservation:** `∑Qᵢ = Q_BOM` for every BOM row processed in production, with no exceptions.
3. **No Negative Allocations:** All `Qᵢ ≥ 0` in every explode output.
4. **Merge Compatibility:** `SP_M3_MERGE_PR_DECISIONS` processes exploded rows without modification and produces correct `PR_Final` records.
5. **Mismatch Visibility:** `BOM_SHORTAGE_STATUS = 'MISMATCH'` rows trigger upload soft warnings and are visually flagged in the sheet.
6. **PRIVATE Regression-Free:** Legacy sessions show zero behavioral change. Upload produces 1:1 staging rows; merge succeeds.
7. **Rollback Proven:** `VPO_LEVEL_ONLY` mode successfully diverts all traffic to Legacy path (verified in Gate C and as drill in Gate F).
8. **All Checklists Pass:** All items in Section 7.1 (BigQuery), 7.2 (Apps Script), 7.3 (Downstream) fully checked.
9. **All 20 QA Scenarios Pass:** Every scenario in Section 7.4 verified with explicit pass/fail documentation.

---

_End of Document — Phase 2 Implementation Plan V7_
_Sources: V2–V6 full version history + Phase1_Review.md codebase evidence_
_V7 key additions: F1 SQL format bug fix (ARRAY_AGG→STRING_AGG), F2 delivery_date prerequisite gap surfaced, F3 SUPPLIER_CHECK logic, F4/F5 savings staleness & computation precision, F6 third soft warning, F7 batch SP invocation, F8 unified 20-test QA, F9 Col AG definition, F10 sub-task build order_