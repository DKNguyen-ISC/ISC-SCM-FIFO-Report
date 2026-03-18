# Phase 2 Implementation Plan (V3) — Decoupled BOM Aggregation Sourcing (M3)
_Based on: `Implementation_Plan/Implementation_Plan_V5.md` and Phase 2 V2 Feedback_
_Date: 2026-03-17_

---

## 0. Executive Summary & Phase 2 Goals

### The Business Problem
In the current M3 Assign_Sourcing workflow, planners make purchasing decisions at the **VPO (Purchase Order) level**. For materials shared across many VPOs (PUBLIC materials), applying Standard Package Quantity (SPQ) rounding and tolerance rules to each individual VPO leads to significant **rounding waste and fragmentation**. Over-ordering compounds quickly when standard constraints are enforced piece-meal across dozens of tiny VPOs.

### The Solution: BOM-Level Aggregation
Phase 2 introduces a **BOM-Aggregated Sourcing Pipeline** specifically tailored for PUBLIC materials. Planners will make decisions based on the total aggregated shortage for a BOM, apply a single tolerance/SPQ constraint, and then allow the system to "explode" (proportionally allocate) that single bulk quantity back into the underlying VPO fragments automatically.

### Strategic Shift from V2: Decoupling the Pipelines 
*In previous iterations, we considered injecting the aggregated logic into the existing VPO-level UI. However, injecting different data columns, distinct upload algorithms, and complex conditional rendering into the legacy Assign Sourcing sheet creates an overwhelming, fragile monolith.*

**Key Decision for V3**: We will **Decouple the Concerns**. 
We will introduce a **new, separate pipeline and UI template specifically for Aggregated BOM Sourcing**, leaving the legacy VPO-level pipeline untouched. This drastically reduces system risk, simplifies long-term maintenance, and provides a cleaner User Experience (UX) catered specifically to aggregated purchasing.

### Definition of "Done"
- **Two distinct sheet templates exist:** `Tpl_Assign_Sourcing_Legacy` (for VPO-level) and `Tpl_Assign_Sourcing_Aggregated` (for BOM-level).
- **UI/UX is optimized** for BOM-level decision-making, with clear tracking of tolerance, SPQ, and Mismatch flags.
- **Data Routing Automation:** The system intelligently routes PRIVATE materials to the legacy flow, and PUBLIC materials to the Aggregated flow.
- **Upload "Explode" Logic:** A dedicated algorithm flawlessly allocates BOM-level bulk quantities back to VPO-level `PR_Staging` records without floating-point loss or unassigned remainders.

---

## 1. Problem Statement & Architecture Vision

### 1.1 The Limitation of Current VPO-Level Sourcing
Currently, `ISC_Module_M3` maps 1 VPO row to 1 UI row. If 10 VPOs need 5 units of a component each (Total = 50), and the SPQ is 100, checking out via 10 disparate VPOs might trigger an order of 100 x 10 = 1,000 units. This is mathematically correct at the VPO level, but terrible for business efficiency.

### 1.2 Why Decoupling is Necessary (Addressing the V2 Monolith)
Combining the Aggregated requirements into the existing pipeline is overwhelming for several reasons:
1. **Differing Data Contracts:** The legacy sheet reads from `Sourcing_Feed_VIEW` (VPO grain). The new workflow requires `Sourcing_Feed_Aggregated_VIEW` (BOM grain).
2. **Differing Columns:** VPO rows don't need `VPO_COMPONENTS_JSON` or `VPO_COUNT`. Aggregated rows don't need VPO-specific identifiers.
3. **Differing Upload Logic:** The legacy script is a simple 1:1 row insert. The new workflow requires an N:1 explode logic. 
4. **Maintenance Nightmare:** Mixing both into a single `<select>` dropdown mode toggle creates spaghetti code with `if(mode === 'aggregated')` littered across hundreds of lines of Google Apps Script.

**Conclusion:** Separating them into two distinct modules and templates eliminates risk to the current stable process while giving the new Aggregated process the exact UI it needs to succeed.

---

## 2. Decoupled Pipeline Architecture (Proposed Solution)

We will implement a clean fork in the M3 module based on the material's `PUBLIC`/`PRIVATE` status.

### 2.1 The Two Parallel Pipelines

| Feature | Legacy VPO Pipeline | Aggregated BOM Pipeline (NEW) |
| :--- | :--- | :--- |
| **Target Data** | PRIVATE materials (or rollbacks) | PUBLIC materials |
| **Data Source View** | `Sourcing_Feed_VIEW` | `Sourcing_Feed_Aggregated_VIEW` |
| **Granularity** | 1 Row = 1 VPO Request | 1 Row = 1 BOM (Bundling N VPOs) |
| **UI Template** | `Tpl_Assign_Sourcing_Legacy` | `Tpl_Assign_Sourcing_Aggregated` |
| **Tolerance Rules** | Inherited upstream, static in UI | Dynamic & Editable row-level formula |
| **Upload Handler** | `uploadLegacy1to1()` | `uploadAggregatedExplode()` |
| **Destination** | `PR_Staging` (VPO level) | `PR_Staging` (VPO level) |

### 2.2 Orchestration & Data Routing Logic
When a PIC opens their `M3_Assign_Sourcing_Main` dashboard and clicks "Load Data":
1. The script checks the user's pending queue.
2. It queries BigQuery to separate pending workload into `PUBLIC` and `PRIVATE` buckets.
3. It generates two distinct tabs (or two separate files/links depending on Apps Script constraints):
   - **Tab 1: Legacy Sourcing** (Populated with PRIVATE VPOs)
   - **Tab 2: Aggregated Sourcing** (Populated with PUBLIC BOMs)
4. The PIC can comfortably tackle each workflow in its optimized environment without context switching within the same grid.

---

## 3. UI/UX Design for the Aggregated Template

Because we decoupled the pipeline, we have the freedom to design the Aggregated UI specifically around the goal of BOM-level visibility and precision.

### 3.1 Sheet Layout & Visual Structure

The new `Tpl_Assign_Sourcing_Aggregated` spreadsheet will be segmented by color to guide the user's eye from left (Read-Only context) to right (Editable decision).

#### Part A: Component Identification (Grey / Read-Only)
- `BOM_ID` | `MATERIAL_NAME` | `PIC`
*(Provides immediate context on what is being purchased).*

#### Part B: Aggregated Shortage Metrics (Blue / Read-Only)
- `BASE_SHORTAGE_QTY`: The raw sum of all underlying VPO shortages.
- `VPO_COUNT`: How many VPOs are bundled into this single BOM row (e.g., "12 VPOs").
- `BOM_SHORTAGE_STATUS`: "OK" or "MISMATCH" (Alerts user if the aggregated sum differs from M2 master tables).

#### Part C: Tolerance & Planner Inputs (Yellow / Editable)
- `TOLERANCE_%_INPUT`: An explicitly editable column. Planners type here (e.g., `5%`). If left blank, it stays blank visually.
- `TOLERANCE_%_EFFECTIVE`: **Formula Column**. If `INPUT` is blank, it defaults to `10%`. Otherwise, it mirrors `INPUT`. *(Ensures system always has a number to calculate with).*

#### Part D: Final Purchasing Math (Green / Editable & Calculated)
- `SPQ_REF`: Standard Package Quantity lookup.
- `ADJUSTED_QTY`: Formula: `BASE_SHORTAGE_QTY * (1 + TOLERANCE_%_EFFECTIVE)`.
- `FINAL_Q_BOM`: Formula: `CEIL(ADJUSTED_QTY / SPQ_REF) * SPQ_REF`. **This is the Explode Base.**
- `MANUAL_OVERRIDE_QTY`: If the math is wrong due to an external constraint, the PIC types the final hard number here.
- `SUPPLIER_SELECTION`: Dropdown selection.

#### Part E: Savings Tracker (Purple / Read-Only)
- `SAVINGS_VS_LEGACY_QTY`: Formula calculating the difference between ordering this via 1:1 legacy rounding vs BOM-aggregated rounding. *(Gamifies efficiency and proves the feature's worth).*

### 3.2 Workflow Process Flow

1. **Load Data:** System maps `PUBLIC` BOMs into this new UI.
2. **Review Needs:** Planner looks at `# of VPOs` bundled and reviews total `BASE_SHORTAGE_QTY`.
3. **Set Tolerance:** Planner dictates `TOLERANCE_%_INPUT` by row. The sheet auto-calculates the multiplier.
4. **Determine final Q_BOM:** Sheet computes the SPQ-rounded total base order size.
5. **Set Supplier:** Select Supplier from Dropdown.
6. **Submit:** Hit the Upload Script button to validate and process.

---

## 4. The "Explode" Upload Algorithm (App Script)

When the user clicks the "Submit Aggregated" button, the system must take the `FINAL_Q_BOM` ($Q_{BOM}$) and distribute it back out to the underlying VPOs transparently.

### 4.1 Execution Steps
1. **Read JSON Context:** For each row, read the hidden `VPO_COMPONENTS_JSON` column payload generated by the SQL View.
2. **Parse VPOs & Base Weights:** Extract the list of underlying VPOs and their base requirements ($w_i$).
   - *Requirement: $w_i = \max(0, \text{shortage}_i)$*
3. **Calculate Proportional Fractions:**
   - Determine allocation ratio for each VPO: $R_i = w_i / \sum(w_i)$
   - Baseline unrounded slice: $S_i = R_i \times Q_{BOM}$
4. **Integer Resolution (Largest Remainder Method):**
   *(App Script cannot upload fractional units to a VPO. It must be integers.)*
   - Assign integer floor to each VPO: $Q_i = \text{FLOOR}(S_i)$
   - Calculate exact remainder fragment: $Rem_i = S_i - Q_i$
   - Distribute the remaining $\Delta Q = Q_{BOM} - \sum Q_i$ by distributing $1$ unit at a time to the VPOs with the largest $Rem_i$, breaking ties by Earliest Delivery Date or alphabetically by VPO ID.
5. **Zero-Shortage Edge Case Handling:**
   - If a planner manually overrides $Q_{BOM} > 0$ but the base shortages $\sum w_i = 0$, the system will allocate the entire $Q_{BOM}$ to the VPO with the earliest requested delivery date to ensure the inventory arrives in time for the first required job.

### 4.2 Push to Staging & SP Merge
The App script iterates over the Exploded array of $Q_i$ and writes **N distinct rows** to the `PR_Staging` table. All $N$ rows will inherit the identical supplier and price from the parent BOM row. 

Finally, the script invokes the existing, unmodified `SP_M3_MERGE_PR_DECISIONS`. Because the pipeline guarantees the inputs to the SP are identical in format to the legacy pipeline, downstream PR/PO modules are insulated from any breaking changes.

---

## 5. BigQuery Data Contract Upgrades

To support the Decoupled Architecture, `Sourcing_Feed_Aggregated_VIEW` requires some final tuning to ensure the App Script has everything it needs to perform the Explode algorithm *without* querying additional tables on the frontend.

### 5.1 Required Additions to `Sourcing_Feed_Aggregated_VIEW`
- **JSON Payload Validation:** Ensure `VPO_COMPONENTS_JSON` strictly contains `DRAFT_PR_ID`, `VPO`, `NET_SHORTAGE_QTY`, and `DELIVERY_DATE`.
- **Row Grain Identifier:** Explicitly cast `'BOM_AGG' AS ROW_GRAIN` so the App Script router can definitively branch logic.
- **Supplier & Capacity:** Pull `ASSIGNED_SUPPLIER_NAME` and `KNOWN_CAPACITY_OPTIONS` using `ANY_VALUE()` grouping across the BOM to prepopulate dropdowns in the sheet.

---

## 6. System QA, Verifications & Rollout Plan

By explicitly separating the UI and algorithms, testing becomes substantially safer.

### 6.1 Staged Rollout Strategy
- **Stage 1 (Dry Run - UI Only):** Deploy `Tpl_Assign_Sourcing_Aggregated` for a pilot PIC group. Disable the Upload capability. Ask them to verify the UX, evaluate formula accuracy, and test the row-level tolerance inputs.
- **Stage 2 (Shadow Upload):** Enable the Explode algorithm but point it to a `PR_Staging_TEST` table. Submit a batch of 10 PUBLIC BOMs. Manually verify via SQL that $\sum Q_i = Q_{BOM}$ flawlessly.
- **Stage 3 (Production Pilot):** Divert 10% of PUBLIC workload to the new template. Monitor `PR_Final` and PO creation.
- **Stage 4 (Full Deployment):** Turn on the router for all users. 

### 6.2 QA Verification Matrix

| Test Scenario | Module | Expected Outcome |
| :--- | :--- | :--- |
| **Tolerance Fallback** | Sheet UI | Planner leaves `TOLERANCE_%_INPUT` blank -> `EFFECTIVE` immediately calculates as `10%`. |
| **Zero Shortage Math** | Sheet UI | `BASE_SHORTAGE` is 0. Planner sets `MANUAL_OVERRIDE` to 500. `FINAL_Q_BOM` = 500. |
| **Explode Conservation** | App Script | $Q_{BOM} = 100$, 3 VPOs inside. QA SQL Query confirms $\sum(VPO_{1..3}) = 100$. No drops. |
| **JSON Corruption** | App Script | If JSON string limits are truncated/corrupted -> Hard Error on upload. Stops immediately. |
| **Legacy Protection** | End-to-End | PRIVATE VPO processed in Legacy Tab. Upload hits `PR_Staging`. 1:1 row inserted. No regression. |

---
_End of Document V3_
