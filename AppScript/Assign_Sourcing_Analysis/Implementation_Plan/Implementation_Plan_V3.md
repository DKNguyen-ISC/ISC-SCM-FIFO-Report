# Implementation plan document improvement
_Exported on 3/16/2026 at 10:20:44 GMT+7 from Cursor (2.5.26)_

---

**User**

Please read all the files then give me the most comprehensive and better version Implementation_Plan_V3.md under the folder Implementation_Plan.

---

**Cursor**

### Implementation_Plan_V3.md  

## 0. Executive Summary  

This document defines **Implementation Plan V3** for upgrading the **Assign_Sourcing (M3)** session for **PUBLIC materials** (initially the `"Chì"` material group). It consolidates and extends V1 and V2 by specifying a **BOM-aggregated sourcing architecture**, **MOQ/SPQ waste elimination**, **tolerance override controls**, and **BOM-level backup calculations** to protect against warehouse issuance attribution errors, while **preserving VPO traceability** for downstream PR/PO generation.  

The solution introduces a dedicated **aggregated BigQuery view**, enhanced **Apps Script UI/UX**, and robust **upload and merge logic** that explodes aggregated decisions back into VPO-level records. It also defines a **phased rollout, verification framework, and risk mitigations** to support a safe production deployment.  

---

## 1. Objectives & Success Criteria  

### 1.1 Core Objectives  

1. **Eliminate MOQ/SPQ Waste**  
   - Aggregate shortages at **BOM level** for PUBLIC materials so that MOQ/SPQ ceiling logic is applied **once per BOM**, not per VPO.  
   - Quantify and display **savings vs. current VPO-level approach**.

2. **Standardize & Control Tolerances**  
   - Provide **session-level tolerance mode**:  
     - `CS Tolerance (BOM_TOLERANCE from BOM)`,  
     - `ISC Standard (10%)`,  
     - `Custom %`.  
   - Ensure all shortage and order-quantity calculations recompute correctly when tolerance mode changes.

3. **Mitigate Warehouse Attribution Errors**  
   - Introduce **BOM-level ground-truth shortage**:  
     \[
     \text{BOM_TOTAL_SHORTAGE} = \text{Total BOM Demand} - \text{Total BOM Issued} - (\text{Stock}+\text{PO On Way})
     \]  
   - Display BOM backup shortage alongside aggregated net shortage and flag mismatches.

4. **Preserve VPO Traceability**  
   - While operators see **BOM-aggregated rows** in PUBLIC mode, the **final PR/PO pipeline remains VPO-level**:  
     - Apps Script explodes aggregated decisions back into VPO-level rows in `PR_Staging`.  
     - Existing stored procedure `SP_M3_MERGE_PR_DECISIONS` remains unchanged.

5. **Deliver Operationally Usable UI/UX**  
   - Clear indication of aggregation mode, tolerance mode, key metrics (e.g., **MOQ savings**), and **data-quality alerts** (BOM mismatches).  
   - Controls fit within existing **`Ngàn_Assign_Sourcing`** session conventions.  

---

## 2. Scope  

- **In Scope**  
  - PUBLIC materials (e.g., `"Chì"` group) in Assign_Sourcing M3.  
  - BigQuery data model and views powering the M3 dashboard.  
  - Apps Script logic loading data into the Assign_Sourcing sheet.  
  - Apps Script upload flow that writes to `PR_Staging`.  
  - UI/UX changes in the `Ngàn_Assign_Sourcing` Google Sheet (dashboard + main grid).  
  - Test and rollout for PUBLIC aggregated mode only.

- **Out of Scope (for V3)**  
  - Structural changes to PRIVATE material handling (remains VPO-level).  
  - Changes to `SP_M3_MERGE_PR_DECISIONS` or downstream PO engine.  
  - Generic refactoring of unrelated M3 scripts.  

---

## 3. Architecture Overview  

### 3.1 Modes  

- **PUBLIC Mode**  
  - **Data**: BOM-aggregated records from new aggregated view.  
  - **UI**: One row per `BOM_UPDATE`, pipe-delimited `VPO` and `DRAFT_PR_ID`.  
  - **Upload**: Aggregated decisions exploded back into multiple VPO-level records.  

- **PRIVATE Mode**  
  - **Data**: Existing `Material_Demand_VIEW` / VPO-level feed.  
  - **UI**: One row per VPO (unchanged).  
  - **Upload**: As-is today.  

- **Aggregation Mode Selector**  
  - `AUTO`: PUBLIC → aggregated, PRIVATE → VPO-level.  
  - `AGGREGATED_ONLY`: Force BOM aggregation (for diagnostic or special use).  
  - `VPO_LEVEL_ONLY`: Force VPO-level (fallback / troubleshooting).  

### 3.2 Key Components  

- **BigQuery**  
  - New view: `Sourcing_Feed_Aggregated_VIEW`.  
  - BOM-level backup calculation query (used to populate BOM_TOTAL_SHORTAGE).  

- **Apps Script**  
  - `loadPendingPRsToSheet` (or equivalent) updated to:  
    - Pull from `Sourcing_Feed_Aggregated_VIEW` when PUBLIC/aggregated.  
    - Populate grid with new columns.  
  - `runSourcingUpload` updated to:  
    - Parse pipe-delimited `VPO` / `DRAFT_PR_ID`.  
    - Distribute `FINAL_ORDER_QTY` to individual VPOs.  
    - Insert VPO-level records into `PR_Staging`.  

- **Google Sheet (M3 UI)**  
  - Dashboard rows (1–5) updated with new indicators, metrics, and selectors.  
  - Main table updated with additional columns for aggregated and backup logic.  

---

## 4. Phase 1 – Data Layer (BigQuery)  

### 4.1 New Aggregated View: `Sourcing_Feed_Aggregated_VIEW`  

**Goal**: Provide BOM-aggregated sourcing feed specifically for PUBLIC materials, without breaking existing PRIVATE/VPO-level data flows.  

**Core Behavior**  

- **Input**: existing `PR_Draft` / sourcing feed at VPO granularity.  
- **Grouping key**: `BOM_UPDATE` (plus any required dimensional fields such as material, plant, supplier, etc.).  
- **Aggregations per BOM**:  
  - `NET_SHORTAGE_QTY_AGG = SUM(NET_SHORTAGE_QTY)`  
  - `VPO_AGG = STRING_AGG(VPO, '|')`  
  - `DRAFT_PR_ID_AGG = STRING_AGG(DRAFT_PR_ID, '|')`  
  - `EARLIEST_DELIVERY_DATE = MIN(REQUESTED_DELIVERY_DATE)`  
  - Additional attributes (e.g., material, supplier, INCOTERM, MOQ/SPQ, BOM_TOLERANCE, etc.) propagated or aggregated as appropriate.  

**Filtering & Flagging**  

- View includes a **MATERIAL_GROUP** or **PUBLIC_FLAG** filter to limit aggregation to PUBLIC materials.  
- PRIVATE materials either:  
  - Continue to be provided by the existing non-aggregated view, or  
  - Are passed through unaggregated within the same view, controlled by an `AGGREGATION_MODE` field.  

### 4.2 BOM-Level Backup Shortage Calculation  

Introduce a separate query or derived view that calculates **BOM_TOTAL_SHORTAGE** independent of VPO allocations:  

- **Definition**:  
  \[
  \text{BOM_TOTAL_SHORTAGE} = \text{Total BOM Demand} - \text{Total BOM Issued} - (\text{On-Hand Stock} + \text{PO On Way})
  \]  

- **Implementation Considerations**:  
  - Join BOM demand table to issuance and inventory/PO tables by BOM.  
  - Carefully handle: returns, cancellations, negative adjustments, and data lags.  
  - Provide **status flags**:  
    - `BOM_SHORTAGE_OK` when aligned within tolerance.  
    - `BOM_SHORTAGE_MISMATCH` when discrepancy exceeds threshold.  

- **Integration into Aggregated View**:  
  - Join backup calculation into `Sourcing_Feed_Aggregated_VIEW` on `BOM_UPDATE`.  
  - Expose `BOM_TOTAL_SHORTAGE` and `BOM_SHORTAGE_STATUS` for UI display.  

---

## 5. Phase 2 – Session Logic & UI/UX (Apps Script & Sheet)  

### 5.1 Dashboard Changes (`Ngàn_Assign_Sourcing` Header Rows 1–5)  

Add or update the following fields:  

- **Aggregation Mode Indicator**  
  - Display: `[PUBLIC_AGGREGATED]` vs `[PRIVATE_VPO_LEVEL]`, plus override state if user forces mode.  

- **Aggregation Mode Selector**  
  - Dropdown: `AUTO`, `AGGREGATED_ONLY`, `VPO_LEVEL_ONLY`.  
  - Used by `loadPendingPRsToSheet` to decide which view / layout to load.  

- **Tolerance Mode Selector**  
  - Dropdown: `CS Tolerance (default)`, `ISC Standard 10%`, `Custom %`.  
  - Custom % cell for numeric input (data validation: 0–100).  

- **Session Savings Metric**  
  - `TOTAL MOQ SAVINGS (Units)` =  
    - `Total Order Qty under VPO-level CEILING`  
    - minus `Total Order Qty under Aggregated BOM CEILING`.  
  - Optionally, add `Savings %` vs total ordered volume.  

- **Shortage Audit Metrics**  
  - `TOTAL BOMs`, `TOTAL BOMs OK`, `TOTAL BOMs with Mismatch`.  
  - Optionally `BOM_MISMATCH_RATE`.  

### 5.2 Main Grid Layout (PUBLIC Aggregated Mode)  

For PUBLIC/aggregated mode, define the following columns (simplified list; adapt to existing schema):  

1. `BOM_UPDATE`  
2. `Material`, `Description`, `Plant`, `Supplier` (as today)  
3. `VPO_AGG` – pipe-delimited VPO values (`V2601015C01|V2512007C06|...`)  
4. `DRAFT_PR_ID_AGG` – pipe-delimited draft PR IDs  
5. `NET_SHORTAGE_QTY_AGG` – sum of VPO-level NET_SHORTAGE_QTY  
6. `BOM_TOTAL_SHORTAGE` – backup shortage from Phase 1  
7. `BOM_SHORTAGE_STATUS` – e.g. `OK` / `MISMATCH` / `MISSING_DATA`  
8. `TOLERANCE_MODE_APPLIED` – derived from dashboard selector (`CS`, `ISC10`, `CUSTOM`)  
9. `EFFECTIVE_TOLERANCE_%` – resolved numeric tolerance used in calculations  
10. `CALC_SHORTAGE_WITH_TOLERANCE` – shortage after applying tolerance  
11. `FINAL_ORDER_QTY` – PIC-entered or formula-driven recommended order quantity  
12. `MOQ`, `SPQ` – as per existing logic  
13. `CEILING_APPLIED_QTY` – actual order quantity after MOQ/SPQ/pack rounding  
14. `SAVINGS_VS_VPO_MODEL` – per-BOM units saved versus baseline VPO-level CEILING.  
15. `VALIDATION_FLAGS` – combined flags: BOM mismatch, negative qty, missing VPO, etc.  

**Conditional Formatting**  

- **Yellow** when `NET_SHORTAGE_QTY_AGG` ≠ `BOM_TOTAL_SHORTAGE` within mild threshold.  
- **Red** when discrepancy larger than a critical threshold or sign mismatch.  
- Icons or bold text for `BOM_SHORTAGE_MISMATCH`.  

### 5.3 Behavior on Tolerance Changes  

- When the user changes **Tolerance Mode** or Custom % on the dashboard:  
  - Apps Script **recalculates** shortage- and order-related columns:  
    - Effective tolerance per row.  
    - `CALC_SHORTAGE_WITH_TOLERANCE`.  
    - `FINAL_ORDER_QTY` and `CEILING_APPLIED_QTY` as applicable.  
    - `SAVINGS_VS_VPO_MODEL` and `TOTAL MOQ SAVINGS` on the dashboard.  

---

## 6. Phase 3 – Upload & PR Merge Logic  

### 6.1 Explosion Strategy in `runSourcingUpload`  

**Goal**: Users operate at BOM-aggregated level, but downstream systems continue to see **VPO-level rows**.  

For each **aggregated row** submitted:  

1. **Parse Pipe-Delimited Fields**  
   - `VPO_LIST = SPLIT(VPO_AGG, '|')`  
   - `PR_LIST = SPLIT(DRAFT_PR_ID_AGG, '|')`  
   - Ensure list lengths align (same number of VPOs and PR IDs, or define business rule for mismatches).  

2. **Derive Original VPO Shortage Weights**  
   - From original feed (if present in view) or via join back to base table:  
     - `SHORTAGE_PER_VPO[i]` for each VPO.  
   - Compute total original shortage per BOM:  
     \[
     \text{TOTAL_SHORTAGE_VPO} = \sum_i SHORTAGE\_PER\_VPO[i]
     \]  

3. **Allocate FINAL_ORDER_QTY**  
   - Let `Q_BOM = CEILING_APPLIED_QTY` (after tolerance and MOQ/SPQ in UI).  
   - For each VPO `i`:  
     \[
     Q_i = \text{ROUND}\left(Q\_BOM \times \frac{SHORTAGE\_PER\_VPO[i]}{TOTAL\_SHORTAGE\_VPO}\right)
     \]  
   - Adjust the **last VPO** to absorb rounding differences so that  
     \[
     \sum_i Q_i = Q_BOM
     \]  

4. **Insert VPO-Level Rows to `PR_Staging`**  
   - For each `i`: insert a row with:  
     - `VPO = VPO_LIST[i]`  
     - `DRAFT_PR_ID = PR_LIST[i]` (or chosen mapping rule)  
     - `ORDER_QTY = Q_i`  
     - Other attributes carried from BOM header (material, plant, supplier, tolerance mode, etc.).  

5. **Compatibility with `SP_M3_MERGE_PR_DECISIONS`**  
   - The stored procedure receives **VPO-level rows only**, just like today.  
   - No changes are necessary in `SP_M3_MERGE_PR_DECISIONS`.  

### 6.2 Edge Case Handling  

- **Missing or Partial VPO Lists**  
  - If `VPO_AGG` is empty or invalid, reject row with an error message and highlight it.  

- **Zero or Negative Shortage**  
  - If `TOTAL_SHORTAGE_VPO ≤ 0`, but `FINAL_ORDER_QTY > 0`, log as data issue and require manual override/justification.  

- **Tolerance or MOQ Conflicts**  
  - If `Q_BOM` < MOQ or not multiple of SPQ, highlight in grid and require PIC confirmation.  

---

## 7. Phase 4 – Verification & Testing  

### 7.1 Test Data & Scenarios  

- **Baseline Scenarios (from Part 2 & 3 Analyses)**  
  - Use the same data sets and cases from:  
    - `Part2_Assign_Sourcing_Analysis` (Python S2.2 & S2.3).  
    - `Part3_Assign_Sourcing_Analysis` (SQL Q13 and related checks).  

- **Test Case Types**  
  - Multi-VPO BOM where aggregation yields significant MOQ/SPQ savings.  
  - BOM with warehouse attribution issues (issuance assigned to wrong VPO) to validate backup.  
  - Edge cases: single VPO per BOM, zero shortage, negative adjustments, partial PO on way.  

### 7.2 Verification Checklist  

- **Data Consistency**  
  - [ ] BOM counts match between current VPO-level and new aggregated views for PUBLIC materials.  
  - [ ] `NET_SHORTAGE_QTY_AGG` equals the sum of underlying VPO shortages for all BOMs (where data is clean).  

- **Backup Calculation Alignment**  
  - [ ] For “good” BOMs, `NET_SHORTAGE_QTY_AGG` ≈ `BOM_TOTAL_SHORTAGE` within acceptable tolerance.  
  - [ ] For intentionally corrupted/offset cases, BOM mismatch flags correctly appear in UI.  

- **Savings Accuracy**  
  - [ ] TOTAL MOQ savings in the dashboard matches the savings calculated by **Part 2 Python scripts (S2.2 & S2.3)**.  

- **Tolerance Functionality**  
  - [ ] Switching between `CS`, `ISC10`, and `Custom` tolerance modes recomputes shortages, orders, and savings correctly.  
  - [ ] Custom tolerance entry enforces valid numeric range and updates the grid and metrics.  

- **Upload & Explosion Logic**  
  - [ ] Pipe-delimited VPO and PR IDs are split correctly.  
  - [ ] Allocated `Q_i` values sum exactly to BOM-level `CEILING_APPLIED_QTY`.  
  - [ ] Inserted `PR_Staging` rows look identical in shape to today’s VPO-level records.  
  - [ ] `SP_M3_MERGE_PR_DECISIONS` executes successfully with the new data, generating correct PR/PO outputs.  

---

## 8. Phase 5 – Rollout Plan  

### 8.1 Environments  

1. **DEV / Sandbox**  
   - Deploy `Sourcing_Feed_Aggregated_VIEW` and BOM backup query.  
   - Connect DEV Apps Script to DEV views and test with copied `"Chì"` data.  

2. **UAT / Pilot**  
   - Enable for a **small set of PUBLIC materials**, starting with `"Chì"`.  
   - Run parallel sessions:  
     - Current VPO-level workflow.  
     - New BOM-aggregated workflow.  
   - Collect feedback from PIC Ngàn and SC team.  

3. **PROD**  
   - Enable `AUTO` aggregation for PUBLIC materials by default.  
   - Keep **VPO_LEVEL_ONLY** as fallback toggle during early adoption.  

### 8.2 Stepwise Rollout  

- **Stage 1 – Data-Only Validation**  
  - Expose `Sourcing_Feed_Aggregated_VIEW` for read-only analysis.  
  - SC/analytics team validates shortages, BOM backup, and savings offline.  

- **Stage 2 – UI/UX & Upload in DEV**  
  - Deploy UI changes and Apps Script logic to DEV.  
  - Run full end-to-end flows (load → adjust tolerances → upload → PR_Staging → merge procedure).  

- **Stage 3 – Controlled Production Pilot**  
  - Enable aggregated mode for `"Chì"` only.  
  - Closely monitor first full sessions and initial PR/POs.  

- **Stage 4 – Broader Rollout**  
  - Expand to other PUBLIC groups after stable pilot.  
  - Document lessons learned and update SOPs.  

---

## 9. Roles & Responsibilities  

- **Architecture & Design**: Khánh (solution design, data model approvals).  
- **Analysis & Validation**: Antigravity AI / Analytics (review logic, run Python & SQL checks).  
- **BigQuery Development**: BigQuery engineer (views, BOM backup calculations, performance tuning).  
- **Apps Script & UI**: Apps Script developer (session loading, calculations, upload logic, tolerance handling, dashboard & grid changes).  
- **Business Testing**: SC team & PIC Ngàn (UAT, pilot feedback, operational sign-off).  
- **Deployment & Change Management**: SC IT / Ops (environment promotion, communication, documentation).  

---

## 10. Risks & Mitigations  

- **R1 – Data Quality & Warehouse Attribution Errors**  
  - *Risk*: Incorrect issuance attribution per VPO causing misleading shortages.  
  - *Mitigation*: BOM-level backup calculation, mismatch flags, and mandatory review of mismatched BOMs.

- **R2 – Tolerance Divergence vs BOM**  
  - *Risk*: ISC or custom tolerance differs from CS BOM data, leading to unexpected orders.  
  - *Mitigation*: Explicit tolerance mode indicator per session, documented business rules, and default to CS tolerance unless PIC intentionally overrides.

- **R3 – MOQ/SPQ & Pack Size Complexity**  
  - *Risk*: Miscalculation of MOQ/SPQ rounding when applied at BOM level.  
  - *Mitigation*: Centralized rounding logic in Apps Script, test cases covering small and large orders, and validation vs current system outputs.

- **R4 – User Adoption & Training**  
  - *Risk*: Users misinterpret aggregated rows or mismatch flags.  
  - *Mitigation*: Short training material, annotated screenshots, and a fallback `VPO_LEVEL_ONLY` mode during early rollout.

- **R5 – Performance & Scalability**  
  - *Risk*: Aggregated view or explosion logic degrades performance on large sessions.  
  - *Mitigation*: Optimize BigQuery views (partitioning, clustering), and ensure Apps Script loops are batched and vectorized where possible.  

---

## 11. References  

- `Part1_Assign_Sourcing_Analysis.md`  
- `Part2_Assign_Sourcing_Analysis.md` (including Python scripts S2.2 & S2.3)  
- `Part3_Assign_Sourcing_Analysis.md` (including SQL Q13 and related checks)  
- `Project_Analysis_V1.md`  
- `shortage_calculation_analysis_v8.md`  

---

**Status**: *Implementation_Plan_V3 – Ready for design review, development, and phased rollout for PUBLIC (Chì) materials.*

