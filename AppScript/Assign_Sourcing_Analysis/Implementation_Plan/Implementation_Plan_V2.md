# Implementation Plan V2: Assign_Sourcing Aggregation & Tolerance Override

## 0. Executive Summary
This document outlines the **Version 2 Implementation Plan** for upgrading the **Assign_Sourcing (M3)** session for PUBLIC materials (specifically the "Chì" material group). Based on the deep-dive analyses in Parts 1, 2, and 3, the current per-VPO granularity causes artificial MOQ/SPQ waste, tolerance discrepancies against the physical Lead Plan, and exposes the system to warehouse issuance attribution errors. 

This V2 plan transitions the session to a **BOM-Aggregated architecture**, resolves tolerance conflicts, and introduces robust data-entry backups.

---

## 1. Core Objectives
1. **Eliminate MOQ/SPQ Waste**: Consolidate multi-VPO shortages into a single order line per BOM to avoid duplicate CEILING rounding (addressing P2).
2. **Standardize Tolerance Application**: Provide UI controls to toggle between CS-provided tolerances and ISC standard (10%) tolerances (addressing P1).
3. **Mitigate Warehouse Attribution Errors**: Use BOM-level total issuance queries to calculate a reliable ground-truth shortage, bypassing per-VPO entry errors (addressing P3).
4. **Preserve VPO Traceability**: Ensure that even when aggregated in the UI, the final PR/PO generation accurately serves the underlying VPOs.

---

## 2. Phase 1: Data Model & View Layer (BigQuery)

### 2.1 View Adjustments
Instead of modifying `Material_Demand_VIEW` (which must remain VPO-level for PRIVATE materials), we will introduce a new aggregation layer or modify the staging pull specifically for PUBLIC groups:
- **`Sourcing_Feed_Aggregated_VIEW`**: 
  - Groups `PR_Draft` records by `BOM_UPDATE`.
  - Calculates `SUM(NET_SHORTAGE_QTY)`.
  - Concatenates VPOs using `STRING_AGG(VPO, '|')`.
  - Concatenates PR IDs using `STRING_AGG(DRAFT_PR_ID, '|')`.
  - Determines `earliest_delivery = MIN(REQUESTED_DELIVERY_DATE)`.

### 2.2 Backup Shortage Calculation
- Create a cross-check query that calculates: `BOM_TOTAL_SHORTAGE = Total BOM Demand - Total BOM Issued - (Stock + PO On Way)`.
- This calculation completely bypasses VPO-level join errors found in `Material_Issuance` and establishes a reliable ground truth.

---

## 3. Phase 2: Apps Script Sourcing UI/UX (M3)

### 3.1 Session Config & Dashboard Additions
Update the `Ngàn_Assign_Sourcing` dashboard (Rows 1-5 in the Google Sheet):
- **Aggregation Mode Indicator**: Show `[PUBLIC_AGGREGATED]` vs `[PRIVATE_VPO_LEVEL]`.
- **Tolerance Mode Selector**: A dropdown/checkbox to select `[CS Tolerance]` (default), `[ISC Standard 10%]`, or `[Custom %]`.
- **Session Savings Metric**: Display `TOTAL MOQ SAVINGS: X Units` (Difference between VPO-level CEILING logic and the new Aggregated CEILING logic).

### 3.2 Main Grid Layout Changes
For PUBLIC mode sessions, implement the following column schema:
- **VPO Column**: Display pipe-delimited values (e.g., `V2601015C01|V2512007C06`).
- **Net Shortage Qty**: Display the sum of the aggregated shortages.
- **BOM Total Shortage (Backup)**: A new column displaying the reliable BOM-level shortage (calculated in Phase 1.2). 
- **Validation Flags**: Automatically highlight rows in yellow/red where `Net Shortage Qty` ≠ `BOM Total Shortage` to alert the PIC of underlying warehouse input errors.

---

## 4. Phase 3: Upload & PR Merge Logic (Apps Script)

### 4.1 PR_Staging Explosion Strategy
When the user submits their sourcing decisions (`runSourcingUpload`), the Apps Script must handle the pipe-delimited `VPOs` and `DRAFT_PR_ID` strings:
- **Explode**: The script splits the aggregated row by the `|` delimiter.
- **Allocation**: Distribute the `FINAL_ORDER_QTY` back to the individual VPOs proportionally, based on their original shortage ratios.
- **Insert**: Write individual rows back into `PR_Staging` so downstream PO generation retains exact VPO matching and traceability.

### 4.2 SP_M3_MERGE_PR_DECISIONS
- Because the Apps Script will explode the UI rows back into VPO-level rows before insertion into `PR_Staging`, the existing stored procedure `SP_M3_MERGE_PR_DECISIONS` will require **no changes**. It will receive standard VPO-mapped rows exactly as it does today.

---

## 5. Phase 4: Validation & Rollout

### 5.1 Verification Checklist
- [ ] Run **Part 2 Python scripts (S2.2 & S2.3)** to confirm calculated savings perfectly match the new UI dashboard savings metric.
- [ ] Run **Part 3 SQL (Q13)** to verify that BOM consistency logic matches the new "BOM Total Shortage" backup column in the UI.
- [ ] Simulate PR Upload to confirm pipe-delimited records explode correctly and percentage formulas perfectly distribute the total order amount without fractional rounding errors.

### 5.2 Rollout Plan
- **Stage 1**: Deploy the parallel `Sourcing_Feed_Aggregated_VIEW` and test on the "Chì" material group with PIC Ngàn (read-only verification of data).
- **Stage 2**: Update Apps Script UI logic to populate the Aggregated layout and deploy to the DEV environment. Run a dummy session to test UI interactions and tolerance toggles.
- **Stage 3**: Push to PROD. Strictly monitor the first submitted aggregated session to ensure the PO generation engine handles the exploded `PR_Staging` rows successfully.
