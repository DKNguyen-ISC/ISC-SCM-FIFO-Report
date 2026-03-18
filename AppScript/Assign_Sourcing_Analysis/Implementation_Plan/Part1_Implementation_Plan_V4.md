# Implementation Plan V4 (Part 1/3)
_Revised to reflect flexible ISC Buffer logic (5-20%)_

## 0. Executive Summary  

This document defines **Implementation Plan V4** for upgrading the **Assign_Sourcing (M3)** session for **PUBLIC materials** (initially the `"Chì"` material group). It consolidates and extends previous versions by specifying a **BOM-aggregated sourcing architecture**, **MOQ/SPQ waste elimination**, **flexible tolerance override controls (5-20% ISC buffer)**, and **BOM-level backup calculations** to protect against warehouse issuance attribution errors, while **preserving VPO traceability** for downstream PR/PO generation.  

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
     - `ISC Buffer (Flexible 5-20%)`,  
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

- **Out of Scope (for V4)**  
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
