# Phase 2 Implementation Plan (V4)
**Scope: Assign Sourcing (M3) — Decoupled PUBLIC BOM Aggregation & Explode Logic**
_Based on: `Implementation_Plan_V5.md`, Phase 2 V2/V3 Feedback, and M3 System Constraints_
_Date: 2026-03-17_

---

## 0. Executive Summary & Goals

### The Core Problem
In the current M3 Assign Sourcing workflow, planners assign suppliers and make purchasing decisions for each **VPO (Purchase Order) individually**. For materials shared across multiple VPOs ("PUBLIC" materials, such as packaging or wire), applying Standard Package Quantity (SPQ) rounding to each tiny VPO fragment causes **massive over-ordering and waste**.

### The Decoupled Architecture Solution (Refined for V4)
We will introduce a **BOM-Aggregated Sourcing Pipeline** to group VPO shortages by BOM before applying Tolerance and SPQ rounding. 

However, trying to force aggregated BOM rows and legacy VPO rows into the same Google Sheet template creates an unstable, monolithic codebase. The data contracts (Columns, validation logic) and upload algorithms (1:1 vs 1:N Explode) are fundamentally different.

**The Decision:** We will cleanly decouple the pipelines.
1. **Legacy Pipeline (`Tpl_Assign_Sourcing`)**: Handles all PRIVATE items and fallback workflows using a 1-to-1 UI-to-VPO mapping. Unchanged.
2. **Aggregated Pipeline (`Tpl_Assign_Sourcing_Aggregated`)**: A completely new UI template strictly designed for PUBLIC BOM rows, with its own independent upload script to safely "explode" bulk quantities back into the `PR_Staging` database.

**Definition of "Done"**:
- Two distinct Sheet Templates exist (`Tpl_Assign_Sourcing` and `Tpl_Assign_Sourcing_Aggregated`).
- A Smart Router in `M3_Sourcing_Main.gs` directs user sessions to the correct sheet context.
- The Aggregated Sheet computes Tolerance locally per row, yielding a single $Q_{BOM}$ order quantity.
- An "Explode Algorithm" cleanly slices $Q_{BOM}$ into integer fragments mapped to exact `DRAFT_PR_ID`s, pushing precisely 15 standard schema columns to `PR_Staging`.
- `SP_M3_MERGE_PR_DECISIONS` remains entirely untouched and processes the exploded rows seamlessly.

---

## 1. System Anatomy & Data Contracts

### 1.1 BigQuery Source Views
The two pipelines will ingest from two mutually exclusive database views:
- **Legacy Source:** `Sourcing_Feed_VIEW` (Grain: 1 Row = 1 Draft VPO Component).
- **Aggregated Source:** `Sourcing_Feed_Aggregated_VIEW` (Grain: 1 Row = 1 BOM).
  - *Data Contract Requirement:* The aggressive view already supplies `VPO_COMPONENTS_JSON` containing the array of `{vpo, draft_pr_id, net_shortage_qty}`.
  - *Data Contract Requirement:* `NET_SHORTAGE_QTY_AGG` provides the baseline for the planner's Tolerance computation.

### 1.2 Downstream Destination
Both pipelines eventually write CSV rows to `PR_Staging`.
The staging table strictly demands 15 columns for every individual VPO update: 
`PR_STAGING_ID`, `BOM_UPDATE`, `SUPPLIER_ID`, `SUPPLIER_NAME`, `QTY_TO_APPROVE`, `FULFILLMENT_MODE`, `FINAL_UNIT_PRICE`, `REQUESTED_DELIVERY_DATE`, `VPO`, `VALIDATION_STATUS`, `VALIDATION_LOG`, `PIC`, `DATE_CODE`, `UPDATED_BY`, `UPDATED_AT`.

The Legacy pipeline generates **1 row per UI row**.
The Aggregated pipeline will generate **$N$ rows per UI row** using the Explode algorithm.

---

## 2. M3 Layout Engine: The New Aggregated Template

The Apps Script `M3_Sourcing_SheetBuilder.gs` heavily relies on a strict Zone framework (Zone A / Pillar / Zone B). The new `Tpl_Assign_Sourcing_Aggregated` must map intuitively to this engine while exposing BOM-level logic.

### 2.1 Zone Architecture mapping for `Tpl_Assign_Sourcing_Aggregated`

#### Zone A: System Math & Core Outputs (Columns A–P, Locked)
*This zone holds the final computed Math to ensure `runSourcingUpload()` can easily locate its payload indices.*

- `Col A`: BOM_UPDATE (System Identifier instead of DRAFT_PR_ID)
- `Col B`: FULFILLMENT_MODE (Always 'PUBLIC')
- `Col C`: PIC
- `Col H`: SUPPLIER_ID (Looked up)
- `Col I`: ASSIGNED_SUPPLIER_NAME
- `Col J`: FINAL_UNIT_PRICE
- `Col K`: FINAL_LEAD_TIME
- `Col L`: **FINAL_Q_BOM** (Formula computed from Zone B variables downstream)
- `Col M`: PROJECTED_ARRIVAL_DATE
- `Col N`: EARLIEST_REQUESTED_DELIVERY_DATE
- `Col P`: SUPPLIER_CHECK

#### Pillar 1: Column Q ("RAW_START")
Delimiter for the Apps Script engine.

#### Zone B: Context & Planner Interface (Columns R–AJ)
*This replaces the legacy Zone B with BOM-aggregated contexts and editable Tolerance.*

- `Col R`: BOM_CTX (From `Sourcing_Feed_Aggregated_VIEW`)
- `Col S`: BOM_DESCRIPTION
- `Col T`: MAIN_GROUP
- `Col U`: VPO_COUNT (Read-only. E.g., "15 VPOs included")
- `Col V`: **VPO_COMPONENTS_JSON** (Hidden. Stored for the Explode Script)
- `Col W`: NET_SHORTAGE_QTY_AGG (Read-only Base math)
- `Col X`: BOM_SHORTAGE_STATUS ('OK' / 'MISMATCH')
- `Col Y`: **TOLERANCE_%_INPUT** (Editable Yellow box. User types 10 for 10%)
- `Col Z`: **TOLERANCE_%_EFFECTIVE** (Formula: `=IF(ISBLANK(Y), 10, Y)`. Ensures we always have a math base, defaulting to 10%)
- `Col AA`: DATE_CODE (Editable)
- `Col AB`: ASSIGNED_SUPPLIER_NAME (Dropdown)
- `Col AC`: KNOWN_CAPACITY_OPTIONS
- `Col AD`: STANDARD_PRICE_REF
- `Col AE`: UNIT_PRICE_OVERRIDE (Editable)
- `Col AF`: STANDARD_LEAD_TIME_REF
- `Col AH`: **SPQ_REF** (Standard Package Quantity, replacing Legacy's MOQ)
- `Col AI`: MANUAL_Q_BOM_OVERRIDE (Allows planner to bypass math entirely)
- `Col AJ`: **SAVINGS_VS_LEGACY** (Formula: Visual gamification showing how many units were saved from 1:1 rounding)

#### Pillar 2: Column AK ("RAW_END")

---

## 3. The "Explode" Algorithm (Upload Logic)

When a PIC clicks "Upload Sourcing" in the Aggregated Sheet, the App Script will trigger `uploadAggregatedExplode()`.

### 3.1 Step-by-Step Execution
1. **Identify Triggers**: Filter the active sheet rows where `SUPPLIER_CHECK` (Col P) is TRUE.
2. **Extract Final Q**: Grab `FINAL_Q_BOM` ($Q_{BOM}$) from Col L, and the hidden `VPO_COMPONENTS_JSON` from Col V.
3. **Parse JSON Requirements**: Parse the JSON to array of VPOs.
   - For each VPO $i$, its weight $w_i = \max(0, \text{net\_shortage\_qty})$.
   - Sum total weight $W = \sum(w_i)$.
4. **Fractional Slicing**:
   - For each VPO $i$, calculate theoretical raw slice $S_i = (w_i / W) \times Q_{BOM}$.
   - Integer base assignment $Q_i = \lfloor S_i \rfloor$.
   - Calculate remainder fragment $Rem_i = S_i - Q_i$.
5. **Largest Remainder Resolution (Integer Output)**:
   - Identify how many units are unassigned: $\Delta Q = Q_{BOM} - \sum Q_i$.
   - Sort the VPOs descending by their $Rem_i$ value, breaking ties by earliest delivery date or VPO name.
   - Loop and cleanly add $1$ unit to the top $\Delta Q$ number of VPOs.
   - *Result: Perfect integer allocation to all underlying VPOs where $\sum Q_i$ exactly matches $Q_{BOM}$.*
6. **Edge Case Handling**: 
   - If $\sum(w_i) = 0$ but the user manually forced $Q_{BOM} > 0$: Distribute the totality of $Q_{BOM}$ to the single VPO associated with the earliest Delivery Date to ensure baseline velocity.
7. **CSV Staging**:
   - For each VPO matched from the JSON, construct the standard 15-column schema and compile it to CSV. 
   - Inherit Supplier, Price, Date, and Date Code properties identically from the parent BOM row.
8. **Finalization**:
   - Upload CSV payload to `PR_Staging` via `ISC_SCM_Core_Lib.loadCsvData()`.
   - Call the unmodified `SP_M3_MERGE_PR_DECISIONS`.

---

## 4. UI / UX Orchestration Lifecycle

### 4.1 Creating the Session
When `loadSourcingSession()` initiates, the script must query `BOM_Data`. 
If the selected Scope is mostly PUBLIC material, it warns the user: 
*"This group supports Aggregated BOM Sourcing. Routing to Aggregated UI."*
The script creates/finds `PICName_Assign_Sourcing_Aggregated` and activates it. 
(Legacy items are safely routed to `'PICName_Assign_Sourcing'`).

### 4.2 Planner Workflow inside the Sheet
1. Planner views the number of bundled VPOs and the `NET_SHORTAGE_QTY_AGG`.
2. Planner types `5` into the Tolerance % column or leaves it blank to inherit `10%`.
3. The Sheet instantly updates `FINAL_Q_BOM` by applying the effective tolerance and rounding up to the nearest `SPQ_REF`.
4. Planner visually verifies the `SAVINGS_VS_LEGACY` (the difference between $Q_{BOM}$ and 15 disparate VPO rounding operations).
5. Planner clicks Submit.

---

## 5. Deployment & Rollout Plan

Because this is completely decoupled, production risk to the Main Business flow allows continuous legacy ops.

**Stage 1: Admin Data Verification**
- Validate `Sourcing_Feed_Aggregated_VIEW` yields 1 row per PUBLIC BOM and accurately nests `VPO_COMPONENTS_JSON`.
- Assert `NET_SHORTAGE_QTY_AGG` strictly matches `SUM(NET_SHORTAGE_QTY)` of underlying components.

**Stage 2: Sheet Builder Deployment**
- Modify `M3_Sourcing_SheetBuilder.gs` with a new method `buildAggregatedInterface()`.
- Add column structures mapped precisely as described in Section 2.

**Stage 3: Algorithm Dry Run (Shadow Test)**
- Build `uploadAggregatedExplode()`. Instead of hitting `PR_Staging` on first run, print the exploded JSON distribution map to Apps Script Logger.
- Prove mathematically that $\sum Q_i = Q_{BOM}$ natively in Javascript memory without floats mismatch.

**Stage 4: Pilot Group Release (PUBLIC "Chì" Planners)**
- Release template configuration.
- Have user "Nga" handle a BOM with 12 underlying VPOs.
- Verify that `SP_M3_MERGE_PR_DECISIONS` merges the exploded 12 records accurately into `PR_Final` and unblocks the PR upstream chain.

---
_End of Document Phase 2 Implementation Plan V4_
