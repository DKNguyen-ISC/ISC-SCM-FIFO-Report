# ImplementationPlan_V1.md

## ISC Assign_Sourcing Aggregation & Tolerance Override — Implementation Plan

### 1. Objective
Implement the aggregated Assign_Sourcing session for PUBLIC materials (e.g., "Chì"), with BOM-level shortage calculation, MOQ/SPQ waste reduction, and session-level tolerance override. Provide BOM-level shortage backup column for reliability.

---

### 2. Key Features
- **BOM-level Aggregation**: Combine all VPOs for each BOM_UPDATE into a single row for PUBLIC materials.
- **MOQ/SPQ Optimization**: Order quantity is CEILINGed only once per BOM, not per VPO, reducing waste.
- **Tolerance Override**: Allow session-level override to use ISC standard (10%) or custom value instead of CS-provided BOM_TOLERANCE.
- **Backup Column**: Display BOM-level total shortage as a cross-check against VPO-level sum.
- **UI/UX Enhancements**: Dashboard metrics for aggregation mode, savings, and shortage audit.

---

### 3. Implementation Steps

#### Step 1: Data Layer
- Add aggregation logic to Sourcing_Feed_VIEW or Apps Script (_loadPendingPRsToSheet).
- Pipe-delimit VPOs in the VPO column for aggregated rows.
- Calculate BOM_TOTAL_SHORTAGE as sum of all VPO-level shortages for each BOM.

#### Step 2: Session Logic
- Add aggregation mode selector: AUTO (PUBLIC aggregated, PRIVATE VPO-level), AGGREGATE, VPO-LEVEL.
- Implement tolerance override dropdown: CS, ISC Standard (10%), Custom.
- Recalculate shortage columns based on selected tolerance.

#### Step 3: UI/UX
- Update dashboard to show UNIQUE BOMs, AGGREGATION_MODE, TOTAL MOQ SAVINGS, BOM_CHECK, BOM_MISMATCH.
- Add menu action to toggle aggregation view and run BOM Shortage Audit.
- Display backup column alongside NET_SHORTAGE columns.

#### Step 4: Upload Logic
- Option A: Upload single PR per BOM (VPO = NULL or MULTI).
- Option B: Explode aggregated row back to VPOs for PR_Staging.
- Option C: Store pipe-delimited VPOs in PR_Staging.
- Select approach based on downstream PO consolidation requirements.

#### Step 5: Verification & Testing
- Run Python and SQL scripts from Part 2 & 3 to verify aggregation, tolerance, and issuance reliability.
- Validate savings, shortage alignment, and data quality.

---

### 4. Timeline & Roles
- **Design**: Architect (Khánh), Analyst (Antigravity AI)
- **Development**: Apps Script developer, BigQuery engineer
- **Testing**: SC team, PIC Ngàn
- **Deployment**: Staged rollout, feedback loop

---

### 5. Risks & Mitigations
- **Warehouse Data Entry**: BOM-level backup column mitigates VPO attribution errors.
- **Tolerance Divergence**: Session-level override ensures user control.
- **MOQ/SPQ Conflation**: Clarify business logic, update schema if needed.

---

### 6. References
- Part1_Assign_Sourcing_Analysis.md
- Part2_Assign_Sourcing_Analysis.md
- Part3_Assign_Sourcing_Analysis.md
- Project_Analysis_V1.md
- shortage_calculation_analysis_v8.md

---

*ImplementationPlan_V1.md Complete — Ready for review and execution.*
