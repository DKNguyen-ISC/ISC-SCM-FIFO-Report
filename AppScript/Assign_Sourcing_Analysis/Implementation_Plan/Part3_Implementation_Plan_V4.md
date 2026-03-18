# Implementation Plan V4 (Part 3/3)
_Revised to reflect flexible ISC Buffer logic (5-20%)_

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
  - [ ] Switching between `CS`, `ISC Buffer (Flexible 5-20%)`, and `Custom` tolerance modes recomputes shortages, orders, and savings correctly.  
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

**Status**: *Implementation_Plan_V4 – Ready for design review, development, and phased rollout for PUBLIC (Chì) materials.*
