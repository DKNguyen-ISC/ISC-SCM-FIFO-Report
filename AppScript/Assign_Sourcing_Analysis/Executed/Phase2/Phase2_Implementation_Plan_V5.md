# Phase 2 Implementation Plan (V5) — Decoupled BOM Aggregation Sourcing (M3)
**Scope: Assign Sourcing (M3) — Decoupled PUBLIC BOM Aggregation & Explode Logic**
_Synthesized from: V2 (system grounding), V3 (architecture & QA), V4 (column contracts & algorithm)_
_Date: 2026-03-17_

---

## 0. Executive Summary & Phase 2 Goals

### 0.1 The Business Problem
In the current `M3 Assign_Sourcing` workflow, planners make purchasing decisions at the **VPO (Purchase Order) level**. For materials shared across many VPOs — classified as **PUBLIC** materials (e.g., packaging, wire, common components) — applying Standard Package Quantity (SPQ) rounding and tolerance rules to each individual VPO causes severe **rounding waste and quantity fragmentation**.

**Example:** If 15 VPOs each need 5 units of a component (Total = 75 units), and SPQ = 100, the legacy per-VPO path would round each VPO up to 100, ordering `15 × 100 = 1,500 units` instead of the correct bulk order of `100 units`. This is a 20× over-order.

### 0.2 The Solution: BOM-Level Aggregation
Phase 2 introduces a **BOM-Aggregated Sourcing Pipeline** exclusively for PUBLIC materials. Planners will make decisions based on the **total aggregated shortage for a BOM**, apply a single Tolerance/SPQ constraint once, and the system will "explode" (proportionally allocate) that single bulk quantity back into the underlying VPO-level `PR_Staging` records automatically and without remainder loss.

### 0.3 The Decoupled Architecture (Key Architectural Decision)
Injecting BOM-aggregated logic into the existing VPO-level UI and upload script creates a fragile monolith with fundamentally incompatible data contracts and diverging upload algorithms. **The two pipelines are architecturally separated.**

| Concern | Legacy VPO Pipeline | Aggregated BOM Pipeline (NEW) |
| :--- | :--- | :--- |
| **Target Material** | PRIVATE materials & manual fallback | PUBLIC materials |
| **BigQuery Source** | `Sourcing_Feed_VIEW` (VPO grain) | `Sourcing_Feed_Aggregated_VIEW` (BOM grain) |
| **UI Row Grain** | 1 Row = 1 VPO Request | 1 Row = 1 BOM (bundles N VPOs) |
| **Sheet Template** | `Tpl_Assign_Sourcing` (unchanged) | `Tpl_Assign_Sourcing_Aggregated` (new) |
| **Tolerance Rules** | Inherited upstream, static in UI | Dynamic, row-level, planner-editable |
| **Upload Handler** | `uploadLegacy1to1()` (unchanged) | `uploadAggregatedExplode()` (new) |
| **Staging Destination** | `PR_Staging` (1 row per UI row) | `PR_Staging` (N rows per UI row) |
| **SP Downstream** | `SP_M3_MERGE_PR_DECISIONS` (unchanged) | `SP_M3_MERGE_PR_DECISIONS` (unchanged) |

### 0.4 Definition of "Done"
Phase 2 is complete when **all** of the following are true:
- Two distinct sheet templates exist: `Tpl_Assign_Sourcing` and `Tpl_Assign_Sourcing_Aggregated`.
- A **Smart Router** in `M3_Sourcing_Main.gs` correctly directs sessions based on session control mode.
- The Aggregated Sheet computes Tolerance locally per BOM row and yields a single, correct `FINAL_Q_BOM`.
- The `uploadAggregatedExplode()` algorithm cleanly allocates `Q_BOM` into integer fragments mapped to exact `DRAFT_PR_ID`s with **zero remainder loss** (`∑Qᵢ = Q_BOM` always holds).
- `SP_M3_MERGE_PR_DECISIONS` remains entirely untouched and processes exploded rows seamlessly.
- PRIVATE (Legacy) flow shows zero behavioral regression.
- All verification checklists in Section 9 pass.

---

## 1. System Baseline (Verified from Codebase)

### 1.1 Current Data Sources
`ISC_Module_M3/M3_Sourcing_Main.txt` currently reads from:
- `SOURCING_CONSTANTS.VIEW_NAME = 'Sourcing_Feed_VIEW'` (VPO grain, defined in `ISC_SCM_Core_Lib/SQL_Vault.txt`)

Phase 2 introduces a controlled routing layer that selects between:
- **PUBLIC → `Sourcing_Feed_Aggregated_VIEW`** (Phase 1 output, extended in Section 3)
- **PRIVATE → `Sourcing_Feed_VIEW`** (unchanged)

### 1.2 Current Upload Contract
The current upload in `M3_Sourcing_Main.txt` writes **one row per visible UI row** directly into `PR_Staging` and calls `SP_M3_MERGE_PR_DECISIONS`. The staging table enforces a strict **15-column schema** for every insert:

| # | Column | Notes |
| :- | :--- | :--- |
| 1 | `PR_STAGING_ID` | Maps to `DRAFT_PR_ID` from source JSON — **critical contract** |
| 2 | `BOM_UPDATE` | BOM-level identifier |
| 3 | `SUPPLIER_ID` | From planner selection |
| 4 | `SUPPLIER_NAME` | From planner selection |
| 5 | `QTY_TO_APPROVE` | `Qᵢ` for exploded rows |
| 6 | `FULFILLMENT_MODE` | Always `'PUBLIC'` for aggregated rows |
| 7 | `FINAL_UNIT_PRICE` | Inherited from parent BOM row |
| 8 | `REQUESTED_DELIVERY_DATE` | Per-VPO delivery date from JSON |
| 9 | `VPO` | Per-VPO identifier from JSON |
| 10 | `VALIDATION_STATUS` | Always `'PENDING'` on insert |
| 11 | `VALIDATION_LOG` | Always `'OK'` on insert |
| 12 | `PIC` | From session context |
| 13 | `DATE_CODE` | From planner input (Col AA) |
| 14 | `UPDATED_BY` | From session user |
| 15 | `UPDATED_AT` | Server timestamp at upload time |

> ⚠️ **V5 Critical Note:** `PR_STAGING_ID` must map to the **per-VPO `DRAFT_PR_ID`** embedded inside `VPO_COMPONENTS_JSON`, not to any BOM-level identifier. This is the primary key contract with `SP_M3_MERGE_PR_DECISIONS` and must not be violated.

Phase 2 preserves this exact schema. The Explode algorithm generates N rows per BOM UI row, each row conforming to this 15-column schema.

---

## 2. Design Decisions (Locked for V5)

### 2.1 Session Control Modes
A session control cell in the dashboard (Rows 1–4) provides three explicit routing modes persisted per session sheet:

| Mode | Behavior |
| :--- | :--- |
| `AUTO` *(Default)* | PUBLIC materials → Aggregated pipeline. PRIVATE materials → Legacy pipeline. Recommended for all production use. |
| `AGGREGATED_ONLY` | Forces all items through the Aggregated pipeline. For pilot testing or debugging. |
| `VPO_LEVEL_ONLY` | Forces all items through the Legacy pipeline. **This is the instant rollback path.** |

> The mode decision must be **data-driven** by the `FULFILLMENT_MODE` field in the source view — it must **not** be hardcoded to any specific material (e.g., "Chì"). Any PUBLIC material must route correctly without a code change.

### 2.2 Tolerance Model: Row-Level, Planner-Owned
Tolerance is applied **per BOM row**, not as a session-wide setting. This is operationally sound because BOM aggregation already reduces total row count to a manageable number.

- **Option A (locked for Phase 2):** Tolerance is a **planner decisioning overlay** applied to `NET_SHORTAGE_QTY_AGG`. It does not attempt to recompute upstream `PR_Draft` values from M2.
- The sheet applies tolerance purely for computing `Q_BOM`. The upload transmits `Q_BOM` and its exploded integer fragments, with no upstream interference.
- `ISC_BUFFER = 10%` is the default/fallback when tolerance input is blank or invalid.

### 2.3 SPQ Terminology
The rounding increment for BOM-level purchasing is referred to as **SPQ (Standard Package Quantity)** throughout Phase 2. The legacy column `STANDARD_MOQ_REF` is renamed to `SPQ_REF` in the Aggregated template. True MOQ (minimum order quantity) is out of Phase 2 scope.

---

## 3. BigQuery Data Contract Upgrades

Phase 1 already defines `Sourcing_Feed_Aggregated_VIEW` with:
- `VPO_COMPONENTS_JSON` (array of `{vpo, draft_pr_id, net_shortage_qty, delivery_date}`)
- `NET_SHORTAGE_QTY_AGG` (sum of underlying PUBLIC VPO shortages)
- Mismatch fields: `BOM_SHORTAGE_DIFF`, `BOM_SHORTAGE_STATUS`
- `VPO_AGG`, `DRAFT_PR_ID_AGG` (pipe-delimited backup lists)

### 3.1 Required Additions / Verifications for Phase 2

#### 3.1.1 JSON Payload Validation
`VPO_COMPONENTS_JSON` must strictly contain all four keys per element:
```json
[
  {
    "vpo": "VPO-2024-001",
    "draft_pr_id": "PR-DRAFT-123",
    "net_shortage_qty": 50,
    "delivery_date": "2026-04-15"
  }
]
```
> ⚠️ **V5 Critical Note:** `delivery_date` **must be present** in the JSON payload. This is required by the Explode Algorithm's tie-breaking logic (Section 5.4) and was missing from the V4 specification of the JSON contract.

#### 3.1.2 Row Grain Marker
```sql
CAST('BOM_AGG' AS STRING) AS ROW_GRAIN,
CAST('Sourcing_Feed_Aggregated_VIEW' AS STRING) AS SOURCE_VIEW
```
These allow the Apps Script router to branch logic definitively without fragile heuristics.

#### 3.1.3 Supplier & Capacity Fields
Use `ANY_VALUE()` grouping — supplier assignment is constant within a BOM:
```sql
ANY_VALUE(ASSIGNED_SUPPLIER_NAME) AS ASSIGNED_SUPPLIER_NAME,
ANY_VALUE(KNOWN_CAPACITY_OPTIONS) AS KNOWN_CAPACITY_OPTIONS
```
Optional diagnostic: `COUNT(DISTINCT ASSIGNED_SUPPLIER_NAME) AS SUPPLIER_CONSISTENCY_CHECK` (should always = 1).

#### 3.1.4 `NET_SHORTAGE_QTY_AGG` Integrity Check
The view must guarantee:
```sql
NET_SHORTAGE_QTY_AGG = SUM(net_shortage_qty) from underlying PUBLIC VPO components
```
Verify this against `BOM_Shortage_Backup_VIEW.BOM_TOTAL_SHORTAGE`. Any divergence triggers a `BOM_SHORTAGE_STATUS = 'MISMATCH'` flag.

### 3.2 Deployment
Deploy all SQL assets via `admin_DeploySQLAssets()` (in `ISC_SCM_Core_Lib/Admin_Infrastructure.txt`) and re-run all Phase 1 runtime checks plus the new Phase 2 column checks.

---

## 4. Template Architecture & Column Mapping (`Tpl_Assign_Sourcing_Aggregated`)

The new template integrates with the existing `M3_Sourcing_SheetBuilder.gs` Zone framework. A new method `buildAggregatedInterface()` builds this template.

### 4.1 Zone Architecture

#### Zone A: System Outputs & Upload Payload (Columns A–P, Locked / Formula)
*This zone holds the final computed math where `uploadAggregatedExplode()` reads its payload by fixed column index.*

| Col | Field | Notes |
| :- | :--- | :--- |
| A | `BOM_UPDATE` | BOM system identifier (replaces DRAFT_PR_ID at BOM level) |
| B | `FULFILLMENT_MODE` | Hardcoded `'PUBLIC'` |
| C | `PIC` | From session context |
| D–G | *(Reserved / System)* | — |
| H | `SUPPLIER_ID` | Looked up from ASSIGNED_SUPPLIER_NAME selection |
| I | `ASSIGNED_SUPPLIER_NAME` | Mirrors Zone B selection (Col AB) |
| J | `FINAL_UNIT_PRICE` | Resolved from override or standard ref |
| K | `FINAL_LEAD_TIME` | Resolved from override or standard ref |
| L | **`FINAL_Q_BOM`** | **Formula:** `=IF(AI{row}>0, AI{row}, CEILING(W{row}*(1+Z{row}/100), AH{row}))` — see Section 4.3 |
| M | `PROJECTED_ARRIVAL_DATE` | Formula: `N{row} + K{row}` (days) |
| N | `EARLIEST_REQUESTED_DELIVERY_DATE` | Pulled from `Sourcing_Feed_Aggregated_VIEW` |
| O | *(Reserved)* | — |
| P | `SUPPLIER_CHECK` | Boolean gate: TRUE when row is ready for upload |

#### Pillar 1: Column Q (`RAW_START`)
Apps Script delimiter — marks the boundary between locked Zone A and editable Zone B.

#### Zone B: Planner Context & Inputs (Columns R–AK)
*The planner's working area. Color-coded for clarity.*

| Col | Field | Color | Notes |
| :- | :--- | :--- | :--- |
| R | `BOM_CTX` | Grey | BOM identifier from `Sourcing_Feed_Aggregated_VIEW` |
| S | `BOM_DESCRIPTION` | Grey | Material description |
| T | `MAIN_GROUP` | Grey | Material classification group |
| U | `VPO_COUNT` | Blue | Read-only. E.g., `"15 VPOs included"` |
| V | **`VPO_COMPONENTS_JSON`** | Hidden | Full JSON payload for Explode Script — **do not delete rows** |
| W | `NET_SHORTAGE_QTY_AGG` | Blue | Read-only aggregated base shortage |
| X | `BOM_SHORTAGE_STATUS` | Blue | `'OK'` or `'MISMATCH'` — conditional formatting: MISMATCH = red |
| Y | **`TOLERANCE_%_INPUT`** | Yellow | Editable. Planner types `10` for 10%. If blank → default applies |
| Z | **`TOLERANCE_%_EFFECTIVE`** | Yellow | Formula — see Section 4.2 |
| AA | `DATE_CODE` | Yellow | Editable. Planner-supplied date code |
| AB | `ASSIGNED_SUPPLIER_NAME` | Yellow | Dropdown from `KNOWN_CAPACITY_OPTIONS` |
| AC | `KNOWN_CAPACITY_OPTIONS` | Grey | Reference list from view |
| AD | `STANDARD_PRICE_REF` | Grey | Reference price |
| AE | `UNIT_PRICE_OVERRIDE` | Yellow | Editable. If set, overrides `STANDARD_PRICE_REF` for `FINAL_UNIT_PRICE` |
| AF | `STANDARD_LEAD_TIME_REF` | Grey | Reference lead time |
| AG | *(Reserved)* | — | — |
| AH | **`SPQ_REF`** | Blue | Standard Package Quantity — CEILING increment |
| AI | **`MANUAL_Q_BOM_OVERRIDE`** | Yellow | If > 0, overrides formula entirely for `FINAL_Q_BOM` |
| AJ | **`SAVINGS_VS_LEGACY`** | Purple | Read-only formula — see Section 4.4 |

#### Pillar 2: Column AK (`RAW_END`)
Apps Script delimiter — marks the end of Zone B.

---

### 4.2 `TOLERANCE_%_EFFECTIVE` Formula (Col Z) — V5 Corrected

**The V4 formula `=IF(ISBLANK(Y), 10, Y)` is insufficient.** It does not guard against non-numeric inputs or out-of-range values. V5 mandates the following robust formula:

```
=IF(OR(ISBLANK(Y{row}), NOT(ISNUMBER(Y{row})), Y{row}<0, Y{row}>200), 10, Y{row})
```

**Logic:**
- If the cell is blank → default to `10` (i.e., 10%)
- If the value is non-numeric (e.g., text was pasted) → default to `10`
- If the value is negative → default to `10`
- If the value exceeds `200` (200% tolerance, an operational sanity cap) → default to `10`
- Otherwise → use the planner's input

Apply **conditional formatting** to Col Y: if `Y{row}` is non-blank but `Z{row}` still evaluates to `10`, highlight Y in orange to signal the fallback was triggered by an invalid entry.

---

### 4.3 `FINAL_Q_BOM` Formula (Col L) — V5 Full Specification

```
=IF(AI{row}>0,
    AI{row},
    CEILING(W{row} * (1 + Z{row}/100), AH{row})
)
```

**Step-by-step logic:**
1. **Check `MANUAL_Q_BOM_OVERRIDE` (Col AI):** If planner has entered a positive value, use it as-is. The manual override bypasses all formula math.
2. **Otherwise compute formula:**
   - `ADJUSTED_QTY = NET_SHORTAGE_QTY_AGG (W) × (1 + TOLERANCE_%_EFFECTIVE (Z) / 100)`
   - `FINAL_Q_BOM = CEILING(ADJUSTED_QTY, SPQ_REF (AH))`
   - *CEILING rounds up to the nearest multiple of SPQ_REF.*

> ⚠️ **V5 Critical Fix:** `TOLERANCE_%_EFFECTIVE` stores the tolerance as a plain number (e.g., `10` for 10%). The formula **must divide by 100** before applying it as a multiplier. V3 implied this but did not state it. V4's column description did not explicitly call it out.

**Edge case — Zero Shortage:**
If `W{row} = 0` and `AI{row}` is also blank, `FINAL_Q_BOM = CEILING(0, SPQ_REF) = 0`. No order is generated. Only a `MANUAL_Q_BOM_OVERRIDE > 0` can force an order when the base shortage is zero.

---

### 4.4 `SAVINGS_VS_LEGACY` Formula (Col AJ) — V5 Full Specification

This column demonstrates the value of BOM aggregation. It answers: *"How many units would we have wasted if we had rounded at the VPO level instead?"*

Because the individual VPO shortages are embedded in `VPO_COMPONENTS_JSON` (a hidden string column), a direct per-row Sheets formula cannot iterate the JSON. The **Savings metric is therefore populated by the `loadSourcingSession()` script** at data load time, not by a live formula. The script computes:

```
LEGACY_TOTAL = SUM over each VPO_i: CEILING(net_shortage_qty_i × (1 + Z/100), SPQ_REF)
SAVINGS_VS_LEGACY = LEGACY_TOTAL − FINAL_Q_BOM
```

- If `SAVINGS_VS_LEGACY > 0`: Aggregation saves units. Display in green.
- If `SAVINGS_VS_LEGACY = 0`: No rounding benefit (e.g., only one VPO, or perfectly divisible).
- If `SAVINGS_VS_LEGACY < 0`: This should never happen mathematically. Flag as a data anomaly in the log.

> **Note:** Because this field is script-populated, it becomes stale if the planner manually changes Tolerance or Override after load. Add a visual indicator (e.g., italic or greyed text) and a note in the dashboard: *"Savings figure reflects values at load time. Re-load to refresh."*

---

## 5. The "Explode" Algorithm (`uploadAggregatedExplode()`)

When the PIC clicks "Upload Sourcing" in the Aggregated Sheet, `uploadAggregatedExplode()` executes.

### 5.1 Pre-Flight: Row Eligibility
Filter active sheet rows where **all** of the following are true:
- `SUPPLIER_CHECK` (Col P) = `TRUE`
- `ASSIGNED_SUPPLIER_NAME` (Col AB) is not blank
- `FINAL_Q_BOM` (Col L) ≥ 0 (zero is valid — it means "no order, clear the draft")

### 5.2 Step-by-Step Execution (Per Eligible Row)

**Step 1 — Extract Inputs**
```javascript
const Q_BOM = getColValue(row, COL.FINAL_Q_BOM);   // Integer or 0
const jsonStr = getColValue(row, COL.VPO_COMPONENTS_JSON);
```

**Step 2 — Parse JSON**
```javascript
let components;
try {
  components = JSON.parse(jsonStr);
} catch (e) {
  throw new HardError(`Row ${row}: VPO_COMPONENTS_JSON is corrupted or truncated. Upload aborted.`);
}
if (!Array.isArray(components) || components.length === 0) {
  throw new HardError(`Row ${row}: VPO_COMPONENTS_JSON parsed to empty array. Upload aborted.`);
}
```
Validate that each element contains: `vpo`, `draft_pr_id`, `net_shortage_qty`, `delivery_date`. If any key is missing, throw a HardError.

**Step 3 — Compute Weights**
```javascript
const weights = components.map(c => Math.max(0, c.net_shortage_qty));
const W = weights.reduce((sum, w) => sum + w, 0);
```

**Step 4 — Four Edge Case Branches**

| Condition | Action |
| :--- | :--- |
| `W > 0` and `Q_BOM > 0` | **Normal path** → proportional allocation (Step 5) |
| `W > 0` and `Q_BOM = 0` | Allocate `Qᵢ = 0` to all VPOs (planner chose not to order) → skip to Step 7 |
| `W = 0` and `Q_BOM = 0` | Allocate `Qᵢ = 0` to all VPOs → skip to Step 7 |
| `W = 0` and `Q_BOM > 0` | **Manual override on zero-shortage BOM** → allocate entire `Q_BOM` to the VPO with the **earliest `delivery_date`**. If dates are equal, select the VPO with the lexicographically smallest `vpo` string. Log a warning. → skip to Step 7 |

**Step 5 — Fractional Slicing (Normal Path Only)**
```javascript
const rawSlices = weights.map(w => (w / W) * Q_BOM);
const intBases  = rawSlices.map(s => Math.floor(s));
const remainders = rawSlices.map((s, i) => s - intBases[i]);
```

**Step 6 — Largest Remainder Resolution**
```javascript
const allocated = intBases.reduce((sum, q) => sum + q, 0);
let delta = Q_BOM - allocated;  // Units still to distribute (always ≥ 0)

// Build sorted index: descending remainder, tie-break by earliest delivery_date,
// then lexicographically by vpo ascending.
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
```

**Step 7 — Construct Staging Rows**
For each VPO component `i`, build the 15-column staging record:

```javascript
{
  PR_STAGING_ID:            components[i].draft_pr_id,   // Maps to DRAFT_PR_ID — CRITICAL
  BOM_UPDATE:               getColValue(row, COL.BOM_UPDATE),
  SUPPLIER_ID:              getColValue(row, COL.SUPPLIER_ID),
  SUPPLIER_NAME:            getColValue(row, COL.ASSIGNED_SUPPLIER_NAME),
  QTY_TO_APPROVE:           intBases[i],                 // Qᵢ
  FULFILLMENT_MODE:         'PUBLIC',
  FINAL_UNIT_PRICE:         getColValue(row, COL.FINAL_UNIT_PRICE),
  REQUESTED_DELIVERY_DATE:  components[i].delivery_date, // Per-VPO from JSON
  VPO:                      components[i].vpo,
  VALIDATION_STATUS:        'PENDING',
  VALIDATION_LOG:           'OK',
  PIC:                      getColValue(row, COL.PIC),
  DATE_CODE:                getColValue(row, COL.DATE_CODE),
  UPDATED_BY:               Session.getActiveUser().getEmail(),
  UPDATED_AT:               new Date().toISOString()
}
```

> ⚠️ **V5 Critical Note:** `REQUESTED_DELIVERY_DATE` is taken **from the per-VPO `delivery_date` inside the JSON**, not from the BOM-level `EARLIEST_REQUESTED_DELIVERY_DATE` (Col N). Each VPO has its own delivery expectation. Using the BOM-level date for all VPOs would be incorrect.

**Step 8 — Compile CSV and Upload**
```javascript
const csvPayload = compileToCsv(allStagingRows);         // All rows across all BOM rows
ISC_SCM_Core_Lib.loadCsvData('PR_Staging', csvPayload);
```

**Step 9 — Invoke Merge SP**
```javascript
ISC_SCM_Core_Lib.executeSP('SP_M3_MERGE_PR_DECISIONS');
```
The SP is invoked **once** after all BOM rows are uploaded, not per-row.

### 5.3 Upload-Time Validations

#### Hard Errors (Abort immediately — no partial uploads)
| Condition | Message |
| :--- | :--- |
| `VPO_COMPONENTS_JSON` is missing, blank, or JSON.parse fails | `"Row X: JSON payload corrupted. Upload aborted."` |
| JSON element count ≠ list length of pipe-delimited `DRAFT_PR_ID_AGG` | `"Row X: JSON element count mismatch. Upload aborted."` |
| Any `draft_pr_id` in JSON is null or empty string | `"Row X: Null DRAFT_PR_ID in JSON. Upload aborted."` |
| `Q_BOM` is non-numeric or negative | `"Row X: FINAL_Q_BOM is invalid. Upload aborted."` |

#### Soft Warnings (Require explicit user confirmation to proceed)
| Condition | Warning Message |
| :--- | :--- |
| `BOM_SHORTAGE_STATUS = 'MISMATCH'` and `Q_BOM > 0` | `"Row X: BOM shortage mismatch detected. Aggregated total differs from M2 master. Proceed?"` |
| `Q_BOM > NET_SHORTAGE_QTY_AGG × (1 + 2.0)` (ordering more than 200% above shortage) | `"Row X: Order quantity is >200% of shortage. This may indicate a manual override anomaly. Proceed?"` |
| `W = 0` and `Q_BOM > 0` (zero-shortage override path triggered) | `"Row X: All underlying VPOs have zero shortage but a manual override quantity was set. Entire quantity will be assigned to the earliest VPO. Proceed?"` |

---

## 6. Session Lifecycle & Orchestration

### 6.1 Session Load: `loadSourcingSession()`

1. Read dashboard mode control cell (AUTO / AGGREGATED_ONLY / VPO_LEVEL_ONLY).
2. Query BigQuery to determine user's pending workload:
   - In `AUTO` mode: separate pending items into `PUBLIC` and `PRIVATE` buckets by `FULFILLMENT_MODE`.
   - In `AGGREGATED_ONLY`: treat all as PUBLIC.
   - In `VPO_LEVEL_ONLY`: treat all as PRIVATE.
3. Route accordingly:
   - PUBLIC items → find or create sheet `{PICName}_Assign_Sourcing_Aggregated` → call `buildAggregatedInterface()` → populate from `Sourcing_Feed_Aggregated_VIEW`.
   - PRIVATE items → find or create sheet `{PICName}_Assign_Sourcing` → populate from `Sourcing_Feed_VIEW` (unchanged legacy path).
4. For the Aggregated sheet: compute and populate `SAVINGS_VS_LEGACY` (Col AJ) during data write, using the algorithm from Section 4.4.
5. Dashboard indicators (read-only, auto-refreshed):
   - Mode currently active
   - Count of MISMATCH rows
   - Total SAVINGS_VS_LEGACY (sum column)
   - Last loaded timestamp

### 6.2 Planner Workflow Inside the Aggregated Sheet
1. Planner views `VPO_COUNT` (Col U) and `NET_SHORTAGE_QTY_AGG` (Col W) for each BOM row.
2. Planner types tolerance percentage into `TOLERANCE_%_INPUT` (Col Y) or leaves blank for 10% default.
3. Sheet instantly recalculates `TOLERANCE_%_EFFECTIVE` (Col Z) and `FINAL_Q_BOM` (Col L).
4. Planner optionally types `MANUAL_Q_BOM_OVERRIDE` (Col AI) to hard-set the order quantity.
5. Planner selects supplier from `ASSIGNED_SUPPLIER_NAME` dropdown (Col AB).
6. Planner reviews `SAVINGS_VS_LEGACY` (Col AJ) and `BOM_SHORTAGE_STATUS` (Col X).
7. Planner marks rows ready (SUPPLIER_CHECK = TRUE / automated based on required fields).
8. Planner clicks "Upload Sourcing" → `uploadAggregatedExplode()` runs.

---

## 7. Cross-Module Verification Plan

### 7.1 BigQuery Verification Checklist
- [ ] `Sourcing_Feed_Aggregated_VIEW` returns exactly **one row per PUBLIC BOM**.
- [ ] `VPO_COMPONENTS_JSON` parses successfully and matches `VPO_AGG` and `DRAFT_PR_ID_AGG` pipe lists in element count.
- [ ] `NET_SHORTAGE_QTY_AGG` equals `SUM(net_shortage_qty)` of all underlying components for every BOM row.
- [ ] `BOM_Shortage_Backup_VIEW.BOM_TOTAL_SHORTAGE` matches `NET_SHORTAGE_QTY_AGG` for "OK" rows.
- [ ] Mismatch distribution is sensible (not all rows are MISMATCH — that indicates a view logic error).
- [ ] View queries return within acceptable time under production row counts.
- [ ] `ROW_GRAIN = 'BOM_AGG'` and `SOURCE_VIEW` are present in every row.
- [ ] `delivery_date` is present in every element of `VPO_COMPONENTS_JSON`.

### 7.2 Apps Script Verification Checklist
- [ ] Session controls persist across sheet refresh and reload.
- [ ] `AUTO` mode correctly routes PUBLIC rows to Aggregated sheet and PRIVATE rows to Legacy sheet.
- [ ] `VPO_LEVEL_ONLY` mode routes all rows to Legacy sheet (rollback works).
- [ ] Aggregated template renders all columns in correct positions (spot-check Col L, V, Z, AH, AI).
- [ ] `TOLERANCE_%_EFFECTIVE` formula correctly defaults to `10` when input is blank, non-numeric, negative, or > 200.
- [ ] `FINAL_Q_BOM` formula correctly applies `÷100` on tolerance and uses CEILING with SPQ.
- [ ] `MANUAL_Q_BOM_OVERRIDE > 0` overrides `FINAL_Q_BOM` formula correctly.
- [ ] Explode algorithm: `∑Qᵢ = Q_BOM` for 20 randomized test cases (see QA matrix below).
- [ ] Explode algorithm: all `Qᵢ ≥ 0` (no negative allocations).
- [ ] Explode algorithm: deterministic — same inputs yield identical `Qᵢ` distribution across repeated runs.
- [ ] Hard errors abort upload before any data is written to `PR_Staging`.
- [ ] Soft warnings pause upload and require confirmation.

### 7.3 Downstream Regression Checks
- [ ] `SP_M3_MERGE_PR_DECISIONS` succeeds for **both** legacy VPO rows and exploded aggregated rows.
- [ ] `PR_Final` rows are created/updated at correct VPO-level keys after merge.
- [ ] PRIVATE (Legacy) session: layout unchanged, upload produces 1 row → 1 staging record, merge succeeds.
- [ ] Consolidation and PO issuance modules continue processing `PR_Final` keys without modification.

### 7.4 QA Verification Matrix

| # | Test Scenario | Module | Input | Expected Outcome |
| :- | :--- | :--- | :--- | :--- |
| 1 | **Tolerance Fallback — Blank** | Sheet UI | `TOLERANCE_%_INPUT` = blank | `EFFECTIVE` = 10 |
| 2 | **Tolerance Fallback — Text** | Sheet UI | `TOLERANCE_%_INPUT` = `"abc"` | `EFFECTIVE` = 10, Col Y highlighted orange |
| 3 | **Tolerance Fallback — Negative** | Sheet UI | `TOLERANCE_%_INPUT` = `-5` | `EFFECTIVE` = 10, Col Y highlighted orange |
| 4 | **Tolerance Fallback — Extreme** | Sheet UI | `TOLERANCE_%_INPUT` = `250` | `EFFECTIVE` = 10, Col Y highlighted orange |
| 5 | **Tolerance Valid** | Sheet UI | `TOLERANCE_%_INPUT` = `5` | `EFFECTIVE` = 5, `FINAL_Q_BOM = CEILING(W×1.05, SPQ)` |
| 6 | **Manual Override** | Sheet UI | `MANUAL_Q_BOM_OVERRIDE` = 500, `W` = 300, `SPQ` = 100 | `FINAL_Q_BOM` = 500 (override wins) |
| 7 | **Zero Shortage, No Override** | Sheet UI | `W` = 0, `AI` = blank | `FINAL_Q_BOM` = 0 |
| 8 | **Explode Conservation — 3 VPOs** | App Script | `Q_BOM` = 100, weights = [50, 30, 20] | `Q₁=50, Q₂=30, Q₃=20`, `∑=100` ✓ |
| 9 | **Explode Conservation — Uneven** | App Script | `Q_BOM` = 100, weights = [1, 1, 1] | `Q₁=34, Q₂=33, Q₃=33`, `∑=100` ✓ |
| 10 | **Explode Zero Shortage Override** | App Script | `Q_BOM` = 500, all `net_shortage_qty=0` | Entire 500 → earliest delivery VPO, warning logged |
| 11 | **Explode W=0, Q=0** | App Script | All `net_shortage_qty=0`, `Q_BOM=0` | All `Qᵢ=0`, no warning |
| 12 | **JSON Corruption Hard Error** | App Script | `VPO_COMPONENTS_JSON` = `"{bad json"` | Upload aborts immediately, error displayed, no rows written |
| 13 | **MISMATCH Soft Warning** | App Script | `BOM_SHORTAGE_STATUS='MISMATCH'`, `Q_BOM>0` | Upload pauses, user confirmation required |
| 14 | **Legacy Protection** | End-to-End | PRIVATE VPO processed in Legacy tab | 1:1 row inserted to `PR_Staging`, no aggregated logic invoked |
| 15 | **Rollback** | End-to-End | Mode = `VPO_LEVEL_ONLY` | All items route to Legacy tab, Aggregated tab not created |
| 16 | **Savings Metric Accuracy** | Script + Sheet | `Q_BOM`=100, legacy would be 300 | `SAVINGS_VS_LEGACY` = 200 |
| 17 | **Savings Anomaly Flag** | Script | `SAVINGS_VS_LEGACY < 0` | Log warning: *"Savings anomaly on Row X"* |

---

## 8. Deployment & Rollout Plan

### Stage Gates (must pass in order)

**Gate A — Data Readiness**
- Deploy updated `Sourcing_Feed_Aggregated_VIEW` via `admin_DeploySQLAssets()`.
- Run BigQuery verification checklist (Section 7.1).
- Validate `VPO_COMPONENTS_JSON` contains `delivery_date` in all rows.
- Confirm `NET_SHORTAGE_QTY_AGG` matches sum of components for 100% of rows (or explain any delta).

**Gate B — UI Deployment (Dry Run)**
- Deploy `buildAggregatedInterface()` in `M3_Sourcing_SheetBuilder.gs`.
- Load a session for a pilot PIC in `AGGREGATED_ONLY` mode.
- Disable Upload button. Verify: column positions, formulas, conditional formatting, dropdowns, savings metric.
- Pilot PIC reviews UX and confirms tolerance inputs and formula feedback work correctly.

**Gate C — Algorithm Shadow Test**
- Implement `uploadAggregatedExplode()` with output redirected to **Logger** (not `PR_Staging`).
- Submit a batch of 10 PUBLIC BOMs.
- Verify via Logger output that `∑Qᵢ = Q_BOM` for every BOM row.
- Run QA scenarios 8–13 from the verification matrix.

**Gate D — Staging Pilot**
- Re-enable upload pointing to `PR_Staging_TEST` (test environment).
- Run 10 BOMs end-to-end: load → review → upload → merge → verify `PR_Final`.
- Confirm `SP_M3_MERGE_PR_DECISIONS` processes exploded rows correctly.

**Gate E — Production Pilot (10% Traffic)**
- Route 10% of PUBLIC workload to the Aggregated pipeline.
- Monitor `PR_Final` row creation, PO issuance, and consolidation for one complete cycle.
- Verify `SAVINGS_VS_LEGACY` figures in Dashboard.

**Gate F — Full Deployment**
- Enable router for all users and all PUBLIC material.
- Monitor for 2 weeks. Evaluate savings metrics.

### Rollback Procedure
**Immediate rollback** is available at any stage by setting the session control to `VPO_LEVEL_ONLY`. No SQL rollback is required because:
1. The Aggregated view is additive — legacy views are untouched.
2. `SP_M3_MERGE_PR_DECISIONS` is unchanged.
3. The Legacy template is unchanged.

---

## 9. Concrete Build Tasks (Implementation Order)

### 9.1 BigQuery (Gate A)
- [ ] Extend `Sourcing_Feed_Aggregated_VIEW` with: `ROW_GRAIN`, `SOURCE_VIEW`, `ANY_VALUE(ASSIGNED_SUPPLIER_NAME)`, `ANY_VALUE(KNOWN_CAPACITY_OPTIONS)`, `delivery_date` in JSON.
- [ ] Deploy via `admin_DeploySQLAssets()`.
- [ ] Run verification queries (Section 7.1).

### 9.2 Sheet Builder (Gate B)
- [ ] Add session control dropdown to dashboard rows 1–4 (AUTO / AGGREGATED_ONLY / VPO_LEVEL_ONLY).
- [ ] Implement `buildAggregatedInterface()` in `M3_Sourcing_SheetBuilder.gs` with all columns from Section 4.1.
- [ ] Implement robust `TOLERANCE_%_EFFECTIVE` formula (Section 4.2).
- [ ] Implement `FINAL_Q_BOM` formula with manual override priority (Section 4.3).
- [ ] Apply conditional formatting: MISMATCH = red on Col X; invalid tolerance = orange on Col Y.
- [ ] Add dashboard read-only indicators: MISMATCH count, total savings, last load timestamp.

### 9.3 Session Load & Router (Gate B + C)
- [ ] Modify `loadSourcingSession()` to read mode control and fork to Aggregated vs Legacy path.
- [ ] Implement savings metric computation during data write (Section 4.4).
- [ ] Implement savings anomaly logging (`SAVINGS_VS_LEGACY < 0`).

### 9.4 Upload Algorithm (Gate C + D)
- [ ] Implement `uploadAggregatedExplode()` (Section 5 full spec).
- [ ] Implement all Hard Error guards (Section 5.3).
- [ ] Implement all Soft Warning confirmations (Section 5.3).
- [ ] Shadow test mode: redirect output to Logger for Gate C validation.
- [ ] Wire to `ISC_SCM_Core_Lib.loadCsvData()` and `SP_M3_MERGE_PR_DECISIONS` for Gate D.

### 9.5 Logging & QA (All Gates)
- [ ] Log: mode chosen at session load.
- [ ] Log: number of Aggregated rows loaded, number of Legacy rows loaded.
- [ ] Log: per-BOM explode results (BOM_ID, Q_BOM, N VPOs, ∑Qᵢ confirmation).
- [ ] Log: any validation failures with row context.
- [ ] Run all 17 QA scenarios from Section 7.4.

---

## 10. Acceptance Criteria (Phase 2)

Phase 2 is accepted **only if all of the following are true**:

1. **Rounding Waste Reduction:** PUBLIC aggregated sessions produce measurably lower `∑Q` than the legacy VPO-level path for at least one pilot batch. `SAVINGS_VS_LEGACY` confirms this directionally.
2. **Sum Conservation:** `∑Qᵢ = Q_BOM` for every BOM row processed in production, with no exceptions.
3. **No Negative Allocations:** All `Qᵢ ≥ 0` in every explode output.
4. **Merge Compatibility:** `SP_M3_MERGE_PR_DECISIONS` processes exploded rows without modification and produces correct `PR_Final` records.
5. **Mismatch Visibility:** `BOM_SHORTAGE_STATUS = 'MISMATCH'` rows are visually flagged and trigger upload warnings.
6. **PRIVATE Regression-Free:** Legacy sessions show zero behavioral change. Upload produces 1:1 staging rows, merge succeeds.
7. **Rollback Proven:** `VPO_LEVEL_ONLY` mode successfully diverts all traffic to Legacy path in Gate C testing.
8. **All Gate Verifications Pass:** All 7.1 (BigQuery), 7.2 (Apps Script), and 7.3 (Downstream) checklists fully checked.

---

_End of Document — Phase 2 Implementation Plan V5_
_Synthesized from V2 (system baseline & design decisions), V3 (architecture & QA), V4 (column contracts & algorithm)_
_V5 additions: Robust TOLERANCE formula, FINAL_Q_BOM ÷100 fix, SAVINGS_VS_LEGACY full spec, complete 4-branch edge case table, PR_STAGING_ID=DRAFT_PR_ID callout, per-VPO delivery_date in JSON contract, delivery_date in explode output, SP invoked once per batch not per row._