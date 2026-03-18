# Implementation Plan V4 (Part 2/3)
_Revised to reflect flexible ISC Buffer logic (5-20%)_

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
  - Dropdown: `CS Tolerance (default)`, `ISC Buffer (Flexible 5-20%)`, `Custom %`.  
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
8. `TOLERANCE_MODE_APPLIED` – derived from dashboard selector (`CS`, `ISC_BUFFER`, `CUSTOM`)  
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
