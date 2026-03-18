## Phase 2 Implementation Plan (V2) — Assign_Sourcing (M3) PUBLIC BOM Aggregation UI + Verified End-to-End Logic
_Based on: `Implementation_Plan/Implementation_Plan_V5.md` (Section 6 + Phase 3 algorithm contract)_
_Grounded in current system: `ISC_SCM_Core_Lib/*` and `ISC_Module_M3/*` as of this workspace_
_Date: 2026-03-16_

---

## 0. Phase 2 goal (what “done” means)

Phase 2 upgrades the **M3 Assign_Sourcing session** so planners can work on **PUBLIC materials at BOM-aggregated level** (to eliminate per-VPO package rounding waste), while the system still writes **VPO-level decisions** to `PR_Staging` so downstream merge (`SP_M3_MERGE_PR_DECISIONS`) and the PR/PO pipeline remain stable.

“Done” means all Phase 2 behaviors are **verified across the whole system**, not just the sheet:

- BigQuery views compile and return correct math (aggregation + backup shortage + flags)
- Sheet UI supports aggregation mode + tolerance mode without ambiguity
- Upload explodes BOM rows → deterministic VPO rows that sum correctly
- PRIVATE flow remains unchanged and regression-tested
- Logs/QA queries provide clear pass/fail and are repeatable

---

## 1. Current-state baseline (verified from code in this workspace)

### 1.1 Data sources currently used by M3 sourcing UI

`ISC_Module_M3/M3_Sourcing_Main.txt` reads from:

- `SOURCING_CONSTANTS.VIEW_NAME = 'Sourcing_Feed_VIEW'`
- That view is defined in `ISC_SCM_Core_Lib/SQL_Vault.txt` and is **VPO-level**.

Therefore Phase 2 must introduce a **controlled routing**:

- PUBLIC → `Sourcing_Feed_Aggregated_VIEW` (Phase 1 output)
- PRIVATE → keep using `Sourcing_Feed_VIEW` or a PRIVATE-only filtered view (optional)

### 1.2 Upload contract in the system today

Upload in `M3_Sourcing_Main.txt` currently **writes one row per visible VPO row** directly into `PR_Staging` and then calls:

- `SP_M3_MERGE_PR_DECISIONS` (defined in `ISC_SCM_Core_Lib/SQL_Vault.txt`)

Phase 2 must preserve this downstream interface:

- `PR_Staging` must still receive **VPO-level** rows (even if the UI row is BOM-aggregated).

---

## 2. Phase 2 design decisions (locked for implementation)

### 2.1 Aggregation Mode Selector (runtime)

Add a session control with values:

- `AUTO`: PUBLIC aggregated + PRIVATE VPO (recommended default)
- `AGGREGATED_ONLY`: force aggregated feed (pilot/debug)
- `VPO_LEVEL_ONLY`: force legacy feed (fallback)

### 2.2 Tolerance input model (row-level, not session-level)

#### 2.2.1 Why the tolerance is row-level

For the Phase 2 aggregated Assign_Sourcing UI, **PIC will fill tolerance per BOM row** (manually).
Because aggregation reduces the number of rows, this is operationally feasible and is the correct workflow for now.

Therefore Phase 2 must **NOT** implement tolerance as a “session control selector” that switches the entire sheet between CS / ISC / Custom modes.

Instead:

- Each BOM row has its own **Tolerance % input** (PIC-owned).
- The sheet computes the **effective demand / shortage after tolerance** using **Google Sheets formulas**.
- `ISC_BUFFER = 10%` is only a **default / fallback** used when the user leaves tolerance blank (or enters invalid data).

#### 2.2.2 Practical spec (sheet columns)

For each aggregated BOM row add:

- `TOLERANCE_%_INPUT` (editable numeric, percent)
- `TOLERANCE_%_EFFECTIVE` (formula):
  - If input is blank → 10
  - If input is non-numeric or out of range → 10 + flag (or clamp, per policy)
- `SHORTAGE_AFTER_TOLERANCE` (formula):
  - computed from base shortage/demand measures already present on the row
  - exact formula depends on the agreed definition (see 2.2.3)

#### 2.2.3 Which base number tolerance applies to (must be explicit)

V5 highlights that `NET_SHORTAGE_*` values are produced upstream by M2 and may already embed tolerance logic.
So Phase 2 must choose one of these (and document it in the sheet header):

- **Option A (recommended, minimal system disruption)**:
  - Tolerance is treated as a **planner decisioning overlay**.
  - The sheet applies tolerance to `NET_SHORTAGE_QTY_AGG` (or another declared base) purely for deciding \(Q_{BOM}\).
  - Upload uses the chosen \(Q_{BOM}\) and explodes it; it does not attempt to “recompute PR_Draft”.

- **Option B (more correct but higher scope)**:
  - Introduce a tolerance-neutral base demand/shortage measure and compute tolerance from that.

Phase 2 will proceed with **Option A** unless the business requires full upstream recalculation.

### 2.3 PUBLIC “SPQ” terminology alignment

In the current sheet formulas, column `STANDARD_MOQ_REF` (AH) is used as the `CEILING(…, increment)` rounding increment.

Phase 2 must:

- Rename UI label (and docs) to **SPQ** for the rounding increment.
- Keep “true MOQ” out of Phase 2 unless explicitly required later.

---

## 3. BigQuery work (Phase 2 data contract upgrades)

Phase 1 already defines:

- `Sourcing_Feed_Aggregated_VIEW`
- `BOM_Shortage_Backup_VIEW`
- mismatch fields (`BOM_SHORTAGE_DIFF`, `BOM_SHORTAGE_STATUS`)
- ordered lists + JSON (`VPO_AGG`, `DRAFT_PR_ID_AGG`, `VPO_COMPONENTS_JSON`)

Phase 2 requires the aggregated view to be **sheet-ready** with all columns needed for UI and upload.

Important: in V2, **tolerance is computed in the sheet** row-by-row, so the aggregated view does **not** need “tolerance mode” columns.

### 3.1 Extend aggregated view output columns (if not already present)

Verify whether the aggregated view contains these dimensions required by the sheet:

- **Supplier suggestion** + known options (similar to `Sourcing_Feed_VIEW`)
- **PIC ownership** (already `PIC` from `BOM_Data` in Phase 1 definition)
- **SPQ source** (currently comes from supplier capacity lookups in the sheet, not from the view)
- **Material descriptors** (BOM description/unit already present)

Recommended additions for Phase 2 (only if missing from the current UI requirements):

- `ASSIGNED_SUPPLIER_NAME` and `KNOWN_CAPACITY_OPTIONS` for the BOM row
  - **V2 rule**: do **not** do a new join/aggregation. In the current system these two fields are derived from the same source per BOM (capacity ranking) and are effectively constant within a BOM.
  - So, if added to the aggregated view, we can safely use:
    - `ANY_VALUE(ASSIGNED_SUPPLIER_NAME)` and `ANY_VALUE(KNOWN_CAPACITY_OPTIONS)`
    - (and optionally a diagnostic `COUNT(DISTINCT ...)` flag to detect violations, but it should normally be 1)

### 3.2 Add explicit “row type” and compatibility fields

Add to aggregated view:

- `ROW_GRAIN = 'BOM_AGG'`
- `SOURCE_VIEW = 'Sourcing_Feed_Aggregated_VIEW'`

This gives the Apps Script layer a deterministic way to branch without relying on fragile heuristics.

### 3.3 Deployment

Deploy all SQL assets after changes using the system deploy mechanism:

- `admin_DeploySQLAssets()` (in `ISC_SCM_Core_Lib/Admin_Infrastructure.txt`)

Then run the Phase 1 runtime checks again plus Phase 2 added-column checks.

---

## 4. M3 UI/UX work (Assign_Sourcing sheet + session logic)

There are two implementation paths; Phase 2 should pick one and fully commit to it.

### 4.1 Recommended UI architecture (minimize disruption)

**Approach**: Keep one session sheet per PIC, but support **two render modes**:

- **VPO Mode (legacy)**: current layout remains, sourced from `Sourcing_Feed_VIEW`
- **BOM Aggregated Mode (PUBLIC)**: a second grid layout region in the same sheet (or a separate “Aggregated” template) built by the builder

Reason: the current sheet formulas and column positions are tightly coupled to VPO-level rows. For aggregated mode we need different columns and different upload logic (explode).

### 4.2 Dashboard controls (where to store them)

Implement controls in the session dashboard area (Rows 1–4 already exist in v57):

- Aggregation Mode selector (data validation dropdown)
- (Optional) a small reminder indicator: “Tolerance default = 10% if blank”
- Read-only indicators:
  - mode indicator (PUBLIC aggregated vs legacy)
  - mismatch counts (OK/MISMATCH)
  - savings metric (baseline vs new, see 4.4)

Persist these values per session sheet so refresh preserves the operator’s choices.

### 4.3 Data loading logic changes (`M3_Sourcing_Main`)

Modify `_loadPendingPRsToSheet()` to:

- Read dashboard control values
- Choose data source:
  - If `VPO_LEVEL_ONLY` → query `Sourcing_Feed_VIEW`
  - If `AGGREGATED_ONLY` → query `Sourcing_Feed_Aggregated_VIEW`
  - If `AUTO`:
    - PRIVATE: query `Sourcing_Feed_VIEW` (filtered)
    - PUBLIC: query `Sourcing_Feed_Aggregated_VIEW`

**Key requirement**: Mode decision must be **data-driven**, not hardcoded to “Chì”.

### 4.4 Savings metric (baseline vs aggregated)

Phase 2 should compute and display:

- Baseline: “what would we order if rounding per VPO row”
- New: “round once per BOM (aggregated)”

This requires:

- SPQ for each VPO (baseline) and for BOM (aggregated)
- Shortage measure for each row under chosen tolerance

In V2, the “chosen tolerance” is **row-level**:

- Baseline per-VPO model uses each VPO row’s shortage and a reference tolerance (if you want an apples-to-apples comparison, you can apply the aggregated row’s tolerance to the BOM total for comparison only).
- Aggregated model uses the row’s `TOLERANCE_%_EFFECTIVE` and the aggregated shortage base to compute \(Q_{BOM}\).

If SPQ only exists in sheet lookups (supplier capacity), Phase 2 must define a stable rule:

- Either “SPQ by chosen supplier for that BOM”
- Or “SPQ as a BOM/material property” (preferred if available)

---

## 5. Upload “explode” algorithm (core Phase 2 logic)

### 5.1 Inputs (per aggregated row)

For each BOM aggregated UI row, gather:

- `VPO_COMPONENTS_JSON` (preferred) OR (`VPO_AGG` + `DRAFT_PR_ID_AGG`)
- Per-VPO weights: `net_shortage_qty` from the JSON
- BOM final committed qty: \(Q_{BOM}\) (computed by **sheet formulas** using row-level tolerance + SPQ rounding)
- Common decision fields: supplier, price, requested delivery date, PIC, fulfillment mode, date code, updated_by/at

### 5.2 Allocation rule (deterministic, sum-preserving)

Use the V5 algorithm:

- Weight basis: \(w_i = \max(0, shortage_i)\)
- If \(\sum w_i = 0\):
  - If \(Q_{BOM}=0\): allocate zeros
  - If \(Q_{BOM}>0\): enforce an explicit policy (Phase 2 decision)

**Recommended policy**:

- Allocate to earliest-requested VPO first (requires earliest date per component), else allocate to smallest VPO (deterministic).
- Flag the row for manual review if this path is used.

Integer conversion:

- Largest remainder distribution with tie-break by VPO ascending
- Guarantees \(\sum Q_i = Q_{BOM}\)

### 5.3 Output rows to `PR_Staging`

Write one row per VPO component with:

- `PR_STAGING_ID = DRAFT_PR_ID` (existing contract in `M3_Sourcing_Main`)
- `BOM_UPDATE`, `VPO`
- `QTY_TO_APPROVE = Q_i`
- `SUPPLIER_ID`, `SUPPLIER_NAME`, `FINAL_UNIT_PRICE`, `REQUESTED_DELIVERY_DATE`, `FULFILLMENT_MODE`, `PIC`, `DATE_CODE`
- `VALIDATION_STATUS = PENDING`, `VALIDATION_LOG = OK`, plus audit columns

Then call `SP_M3_MERGE_PR_DECISIONS` unchanged.

### 5.4 Upload-time validations (must implement)

Hard errors:

- Missing/invalid JSON and cannot recover lists
- List length mismatch between VPOs and draft ids
- Negative or non-numeric quantities

Warnings (require explicit user confirmation):

- `BOM_SHORTAGE_STATUS = MISMATCH` and \(Q_{BOM}>0\)
- Ordering far above shortage-after-tolerance threshold

---

## 6. Cross-module verification plan (system-wide)

Phase 2 must prove that the logic is consistent across:

- `ISC_SCM_Core_Lib` (SQL assets, BigQuery client, deployment helpers, logging)
- `ISC_Module_M3` (sourcing sheet builder, session load/refresh/upload)
- Downstream procedure `SP_M3_MERGE_PR_DECISIONS` (unchanged)
- Any module that reads `PR_Final`/`PR_Draft` outputs (consolidation, PO issuance)

### 6.1 BigQuery verification checklist (required)

- `Sourcing_Feed_Aggregated_VIEW`:
  - One row per BOM
  - `VPO_COMPONENTS_JSON` parses and matches the pipe lists
  - `NET_SHORTAGE_QTY_AGG` equals sum underlying PUBLIC VPO shortages
- `BOM_Shortage_Backup_VIEW`:
  - `BOM_TOTAL_SHORTAGE` computed from BOM totals
  - mismatch distribution makes sense (not all mismatched)
- Performance: view queries return within acceptable time for session loads

### 6.2 Apps Script verification checklist (required)

- Session controls persist and influence refresh behavior
- Aggregated-mode grid renders correct columns and values
- Upload generates VPO-level staging rows whose quantities:
  - sum to BOM committed qty
  - never negative
  - deterministic across repeated uploads with same inputs
- PRIVATE unaffected:
  - legacy sheet layout still works
  - upload remains one row → one staging record

### 6.3 Downstream regression checks (required)

- `SP_M3_MERGE_PR_DECISIONS` succeeds for both:
  - legacy VPO upload
  - exploded aggregated upload
- `PR_Final` rows:
  - created/updated at VPO-level keys
  - consolidation status workflow unchanged
- Consolidation and PO issuance modules (M3 consolidation / PO issuance) continue to work with `PR_Final` keys unchanged

---

## 7. Release / rollout (safe deployment)

### 7.1 Stage gates

- **Gate A — Data**: BigQuery assets deployed and verified
- **Gate B — UI**: aggregated session loads for PUBLIC and displays mismatch + savings
- **Gate C — Upload**: exploded VPO staging rows validated and merge succeeds
- **Gate D — Pilot**: one full cycle parallel run (legacy vs aggregated) for a controlled PUBLIC group

### 7.2 Rollback plan

Rollback must be immediate by switching session control to:

- `VPO_LEVEL_ONLY`

No SQL rollback needed if the aggregated view is additive and legacy views remain.

---

## 8. Concrete build tasks (what to implement, in order)

### 8.1 BigQuery

- Update/extend `Sourcing_Feed_Aggregated_VIEW` to include any missing sheet-required fields (supplier suggestion/options, etc.)
- Deploy via `admin_DeploySQLAssets()`
- Run verification queries (Section 6.1)

### 8.2 M3 sheet builder

- Add dashboard control cells + dropdowns + numeric validation
- Add aggregated grid headers and formatting (new layout region or new template)
- Add conditional formatting for mismatch flags

### 8.3 M3 sourcing main logic

- Read dashboard controls
- Route query to aggregated vs legacy source
- Write results to the correct grid
- Implement aggregated upload path:
  - parse JSON / lists
  - allocate \(Q_{BOM}\) to \(Q_i\)
  - write exploded CSV rows to `PR_Staging`
  - call merge SP

### 8.4 System QA / logging

- Add explicit log points around:
  - load mode chosen
  - number of aggregated rows loaded
  - explode row counts + validation failures
- (Optional) extend QA suite with a deterministic explode test case using synthetic data

---

## 9. Final acceptance criteria (Phase 2)

Phase 2 is accepted only if all are true:

- PUBLIC aggregated sessions reduce rounding waste vs baseline (directionally and measurably)
- Exploded VPO uploads always preserve totals and do not break merge SP
- Mismatch flags are visible and enforced via warnings
- PRIVATE sessions show no behavioral regression
- All verification checklists in Section 6 pass

