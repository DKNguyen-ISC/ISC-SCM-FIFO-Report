# Implementaion Plan V5 — Assign_Sourcing (M3) Upgrade (PUBLIC Aggregation + Flexible ISC Buffer)
_Date: 2026-03-16 | Source basis: Implementation Plan V4 (Parts 1–3), Part1–Part3 Assign_Sourcing Analysis, Report V3_

---

## 0. Executive Summary (What changes, why it’s safe)

This document is the **validated blueprint** for upgrading the **Assign_Sourcing (M3)** session to support **PUBLIC materials** (starting with `"Chì"`) using a **BOM-aggregated workflow** while **preserving VPO-level traceability** for downstream PR/PO processes.

The plan is grounded in the verified analysis of three root causes:

- **P1 — Tolerance divergence**: system uses **CS/HQ `BOM_TOLERANCE`** while Lead Plan uses **ISC 10%** (with a small set of 20% exceptions).
- **P2 — VPO fragmentation**: per-VPO rows cause repeated **CEILING-to-package** rounding, generating significant over-ordering for multi-VPO BOMs.
- **P3 — issuance attribution noise**: warehouse issuance is **reliable at BOM total** but can be unreliable at **VPO split**, so the UI must show a BOM-level “ground truth” check.

V5 consolidates V4 and **tightens the logic contracts** (terminology, deterministic ordering, and allocation rules) so development and future upgrades remain stable and auditable.

---

## 1. Objectives & Success Criteria

### 1.1 Core objectives

1. **Eliminate package-rounding waste for PUBLIC**
   - For PUBLIC groups, apply package rounding **once per BOM**, not once per VPO.
2. **Allow controlled tolerance modes**
   - Session-level tolerance mode supports:
     - **CS tolerance** (per line `BOM_TOLERANCE` from CS/HQ),
     - **ISC Buffer (Flexible 5–20%)**,
     - **Custom %** (explicit user input).
3. **Make shortage robust to issuance attribution**
   - Display **BOM-level ground-truth shortage** (BOM total demand – BOM total issued – supply).
4. **Preserve VPO traceability**
   - Even if operators work on BOM-aggregated rows, upload must produce **VPO-level records** for `PR_Staging` to keep the existing merge pipeline stable.

### 1.2 Success criteria (must pass)

- **Data**: Aggregated rows represent exactly the same underlying VPO set as the base feed (for PUBLIC).
- **Math**: Total ordered qty under aggregated approach equals CEILING applied to BOM total shortage (under chosen tolerance + packaging rules).
- **Explosion**: Uploaded VPO-level order quantities sum exactly to the BOM-level final order quantity; no negative allocations; deterministic results.
- **Audit**: BOM mismatch flags correctly identify cases where VPO-level view is unreliable (issuance attribution), without blocking valid orders.
- **Compatibility**: Existing stored procedure `SP_M3_MERGE_PR_DECISIONS` remains unchanged (receives VPO-level rows).

---

## 2. Scope

### 2.1 In scope (V5 blueprint)

- PUBLIC materials (initially `"Chì"`) in Assign_Sourcing (M3).
- BigQuery aggregated feed design (view + backup shortage join).
- M3 sheet UI design (dashboard selectors + aggregated grid columns).
- Upload / explosion algorithm to write VPO-level rows to `PR_Staging`.
- Verification queries and rollout approach.

### 2.2 Out of scope (explicit)

- Changing PRIVATE material handling (remains VPO-level).
- Refactoring the downstream PR/PO engine and `SP_M3_MERGE_PR_DECISIONS`.
- Redesigning M2 matching engine allocation behavior (stock + PO matching remains as-is).

---

## 3. Definitions (to remove ambiguity)

### 3.1 PUBLIC vs PRIVATE

- **PUBLIC**: fungible materials usable across VPOs; correct planning unit is **BOM total**.
- **PRIVATE**: VPO-dedicated / package-unique materials; correct planning unit stays **VPO-level**.

### 3.2 MOQ vs SPQ (critical terminology fix)

The current session uses a “MOQ” value as the **rounding increment** inside `CEILING(…, increment)`.

- **SPQ (Standard Package Quantity)**: the **increment** for order rounding (e.g., 600 means order 600/1200/1800…).
- **MOQ (Minimum Order Quantity)**: a **minimum acceptable order** (a different business rule).

**V5 rule**:
- Treat the existing “MOQ” used by the CEILING logic as **SPQ** in all calculation specs and UI labels.
- If true MOQ enforcement is later required, it becomes a distinct field and a separate rule (future enhancement, not required for V5).

### 3.3 Shortage concepts

There are two different “shortage” ideas and they must not be conflated:

1. **Aggregated session shortage (from PR_Draft sums)**  
   - `NET_SHORTAGE_QTY_AGG = SUM(PR_Draft.NET_SHORTAGE_QTY)` across VPOs for the BOM.
   - This reflects M2 allocation outputs (stock + PO matching) at VPO granularity.

2. **BOM ground-truth shortage (issuance-robust check)**  
   - `BOM_TOTAL_SHORTAGE = BOM_TOTAL_DEMAND - BOM_TOTAL_ISSUED - (BOM_STOCK + BOM_PO_ON_WAY)`
   - This is designed to be reliable even if issuance attribution by VPO is noisy.

**V5 rule**:
- Use (1) for operational flow / compatibility with existing pipeline.
- Use (2) for **audit + protection**, with explicit mismatch flags and workflow rules for exceptions.

---

## 4. Target Architecture Overview

### 4.1 Modes (runtime behavior)

- **AUTO**
  - PUBLIC → BOM-aggregated UI rows.
  - PRIVATE → VPO-level UI rows (current behavior).
- **AGGREGATED_ONLY**
  - Force BOM aggregation (diagnostic / controlled pilot).
- **VPO_LEVEL_ONLY**
  - Force legacy VPO-level view (fallback / troubleshooting).

### 4.2 Core components

- **BigQuery**
  - `Sourcing_Feed_Aggregated_VIEW` for PUBLIC BOM aggregation.
  - A BOM-level backup shortage join feeding `BOM_TOTAL_SHORTAGE` and status.
- **M3 Sheet UI**
  - Dashboard selectors: Aggregation mode + Tolerance mode.
  - Aggregated grid: one row per BOM with pipe-delimited VPO + PR IDs.
- **Upload**
  - Explosion back into **VPO-level** rows written to `PR_Staging`.

---

## 5. Phase 1 — BigQuery Data Layer (Verified logic)

### 5.1 Aggregated view: `Sourcing_Feed_Aggregated_VIEW`

**Goal**: Provide BOM-aggregated sourcing feed for PUBLIC without breaking PRIVATE.

**Inputs (conceptual)**:
- Base feed at VPO granularity (e.g., `PR_Draft`-based sourcing feed).

**Grouping key** (minimum):
- `BOM_UPDATE`

**Deterministic ordering rule (must)**
- Any concatenated list fields must be aggregated with a stable ordering:
  - `STRING_AGG(VPO, '|' ORDER BY VPO)`
  - `STRING_AGG(DRAFT_PR_ID, '|' ORDER BY VPO)`  
This guarantees VPO index aligns with PR-ID index after splitting.

**Aggregations per BOM** (PUBLIC rows):
- `NET_SHORTAGE_QTY_AGG = SUM(NET_SHORTAGE_QTY)`
- `NET_SHORTAGE_COMPLETION_AGG = SUM(NET_SHORTAGE_COMPLETION)` (if available)
- `NET_SHORTAGE_ISSUANCE_AGG = SUM(NET_SHORTAGE_ISSUANCE)` (if available)
- `VPO_AGG = STRING_AGG(VPO, '|' ORDER BY VPO)`
- `DRAFT_PR_ID_AGG = STRING_AGG(DRAFT_PR_ID, '|' ORDER BY VPO)`
- `EARLIEST_DELIVERY_DATE = MIN(REQUESTED_DELIVERY_DATE)`

**Pass-through attributes**
- Attributes that must be consistent for a BOM row (e.g., `Material`, `Plant`, `Main_Group`, public flag) are passed via `ANY_VALUE()` only if data constraints guarantee equality; otherwise provide a validation flag:
  - `INCONSISTENT_DIMENSION_FLAG` if a BOM aggregates multiple distinct values for a dimension that should be unique.

**Allocation support (recommended)**
To avoid re-joining during upload, expose per-VPO shortages in a machine-usable format:
- Option 1 (preferred in BigQuery): `ARRAY_AGG(STRUCT(VPO, DRAFT_PR_ID, NET_SHORTAGE_QTY) ORDER BY VPO) AS VPO_COMPONENTS`
- Option 2 (sheet-friendly fallback): add a JSON string column `VPO_COMPONENTS_JSON` containing the ordered list.

> The sheet UI can still display pipe-delimited strings; the upload logic can read JSON/array if present for correctness.

### 5.2 BOM-level ground-truth shortage join

**Definition (from analysis P3 / Part1)**
\[
\text{BOM\_TOTAL\_SHORTAGE}=
\text{BOM\_TOTAL\_DEMAND} - \text{BOM\_TOTAL\_ISSUED} - (\text{BOM\_STOCK}+\text{BOM\_PO\_ON\_WAY})
\]

**Key rules**
- Issuance is aggregated **by BOM** (not by VPO).
- Supply is aggregated **by BOM** (stock + active on-way POs).
- Demand is aggregated **by BOM** using the same base demand definition used by the system for that group/session (completion/issuance method is still allowed; the important part is that the backup is BOM-total consistent).

**Mismatch flags**
Expose:
- `BOM_SHORTAGE_STATUS` in `{OK, MISMATCH, MISSING_DATA}`
- `BOM_SHORTAGE_DIFF = NET_SHORTAGE_QTY_AGG - BOM_TOTAL_SHORTAGE` (signed)
- `BOM_SHORTAGE_DIFF_ABS = ABS(BOM_SHORTAGE_DIFF)`

**Threshold policy**
- `OK` if `BOM_SHORTAGE_DIFF_ABS <= max(absolute_threshold, relative_threshold * max(1, BOM_TOTAL_SHORTAGE))`
- Use conservative defaults first; tune after pilot.

---

## 6. Phase 2 — M3 Session UI/UX + Session Logic

### 6.1 Dashboard (header rows)

Add/standardize these controls:

- **Aggregation Mode Selector**: `AUTO | AGGREGATED_ONLY | VPO_LEVEL_ONLY`
- **Tolerance Mode Selector**: `CS | ISC_BUFFER | CUSTOM`
- **ISC Buffer % input**:
  - Allowed range: **5–20** (percent)
  - Default: **10**
- **Custom % input**:
  - Allowed range: **0–100** (percent)

Add these indicators:

- `MODE_INDICATOR`: `[PUBLIC_AGGREGATED]` / `[PRIVATE_VPO_LEVEL]` plus override tag.
- `TOTAL_MOQ/SPQ_SAVINGS_UNITS`:
  - Baseline = sum of per-VPO CEILING quantities (computed for comparison only).
  - New = sum of aggregated BOM CEILING quantities.
  - Savings = baseline – new.
- `BOM_MISMATCH_COUNT` and `BOM_OK_COUNT`.

### 6.2 Aggregated grid columns (PUBLIC)

Minimum columns for PUBLIC aggregated view:

1. `BOM_UPDATE`
2. Key descriptors (`Material`, `Description`, `Plant`, supplier dims as required)
3. `VPO_AGG` (pipe-delimited, ordered)
4. `DRAFT_PR_ID_AGG` (pipe-delimited, ordered to match VPO list)
5. `NET_SHORTAGE_QTY_AGG`
6. `BOM_TOTAL_SHORTAGE`
7. `BOM_SHORTAGE_STATUS` + `BOM_SHORTAGE_DIFF`
8. `TOLERANCE_MODE_APPLIED` and `EFFECTIVE_TOLERANCE_%`
9. `SHORTAGE_AFTER_TOLERANCE` (see rule below)
10. `SPQ` (rounding increment; rename in UI)
11. `FINAL_ORDER_QTY` (user editable or recommended)
12. `CEILING_APPLIED_QTY` (final order after SPQ rounding, if separate)
13. `SAVINGS_VS_VPO_MODEL` (optional per-row metric)
14. `VALIDATION_FLAGS`

### 6.3 Tolerance application rule (explicit)

Resolve effective tolerance:

- If `TOLERANCE_MODE = CS`:
  - Use row’s CS tolerance (or aggregated representation; if mixed tolerances exist across VPO components, flag `MIXED_CS_TOLERANCE` and use a defined policy such as `MAX` or `WEIGHTED_AVG` — **recommended: use `WEIGHTED_AVG by demand` if available, else `MAX`**; do not silently pick `ANY_VALUE`).
- If `TOLERANCE_MODE = ISC_BUFFER`:
  - Use session ISC buffer % in [5,20].
- If `TOLERANCE_MODE = CUSTOM`:
  - Use session custom % in [0,100].

**Important**: In the current ecosystem, `NET_SHORTAGE_QTY` already embeds tolerance logic upstream (in demand calculations). Therefore V5 treats tolerance mode as a **session-level simulation/override** applied consistently for decisioning and comparison. The chosen implementation can be:

- **A. View-driven**: BigQuery returns shortage measures under multiple tolerance assumptions (CS vs ISC buffer vs custom) and the sheet selects which column to use.
- **B. Recompute-driven**: Apps Script recomputes demand/shortage using base quantities and selected tolerance.

V5 allows either A or B; but whichever approach is chosen, the session must:
- display **which tolerance mode produced the numbers**, and
- recompute order recommendations and savings when the mode changes.

---

## 7. Phase 3 — Upload + Explosion into `PR_Staging` (Verified algorithm)

### 7.1 Objective

Users decide at **BOM level**, but `PR_Staging` must receive **VPO-level rows** compatible with `SP_M3_MERGE_PR_DECISIONS`.

### 7.2 Inputs per aggregated row

- Ordered `VPO_LIST` and ordered `DRAFT_PR_ID_LIST`
- Component shortages per VPO (preferred): `SHORTAGE_PER_VPO[i]` from `VPO_COMPONENTS` / JSON.
- BOM final quantity: `Q_BOM = CEILING_APPLIED_QTY` (the quantity the user commits to order for the BOM).

### 7.3 Explosion / allocation rule

**Weighting basis** (default):
- Allocate by each VPO’s original shortage weight:
  - \(w_i = \max(0, SHORTAGE\_PER\_VPO[i])\)

**Edge case**:
- If \(\sum w_i = 0\):
  - If `Q_BOM = 0`: allocate all zeros.
  - If `Q_BOM > 0`: require explicit rule:
    - allocate evenly across VPOs, or allocate all to earliest-delivery VPO, and flag `ZERO_WEIGHT_MANUAL_ALLOCATION_REQUIRED`.

**Allocation method (deterministic + sum-preserving)**

1. Compute raw allocations: \(a_i = Q_{BOM} \times \frac{w_i}{\sum w_i}\)
2. Convert to integers:
   - `floor_i = FLOOR(a_i)`
   - `remainder_i = a_i - floor_i`
3. Distribute remaining units:
   - `remaining = Q_BOM - SUM(floor_i)`
   - Add 1 to the `remaining` VPOs with the largest `remainder_i` (tie-break by VPO ascending).

This guarantees:
- \( \sum Q_i = Q_{BOM} \)
- Deterministic outputs
- Minimal distortion versus proportional weights

**Write to `PR_Staging`**
- For each VPO component \(i\):
  - `VPO = VPO_LIST[i]`
  - `DRAFT_PR_ID = DRAFT_PR_ID_LIST[i]`
  - `ORDER_QTY = Q_i`
  - Carry common dims from BOM row (material, plant, supplier decision, tolerance mode, etc.)

### 7.4 Validation rules (upload-time)

Reject row (hard error) if:
- Missing/empty `VPO_LIST`
- `VPO_LIST.length != DRAFT_PR_ID_LIST.length` (unless explicit mapping policy exists)
- `Q_BOM` is not a valid non-negative number

Warn + require confirmation if:
- `BOM_SHORTAGE_STATUS = MISMATCH` and `Q_BOM > 0`
- `Q_BOM` is far above `SHORTAGE_AFTER_TOLERANCE` (configurable)

---

## 8. Verification & Test Plan (Traceable to analysis)

### 8.1 Pre-build verification (data correctness)

Run / confirm using Part3 SQL (or Part2 Python):

- **Tolerance distribution** (P1): Q1–Q5
  - Confirms `BOM_TOLERANCE` varies; explains CS vs ISC difference.
- **Multi-VPO BOM frequency + savings** (P2): Q6–Q10
  - Confirms aggregation yields material savings for Chì.
- **Issuance reliability** (P3): Q11–Q14, Q20
  - Confirms BOM totals are reliable while VPO attribution can be noisy.
- **Supply side inputs** for BOM backup: Q17–Q18

### 8.2 Build verification (implementation correctness)

#### A. View correctness (PUBLIC aggregation)

- [ ] For PUBLIC, `Sourcing_Feed_Aggregated_VIEW` produces **exactly one row per `BOM_UPDATE`**.
- [ ] `VPO_AGG` and `DRAFT_PR_ID_AGG` are **ordered deterministically** and align index-by-index after split.
- [ ] `NET_SHORTAGE_QTY_AGG` equals the sum of underlying VPO rows for the same BOM.
- [ ] `INCONSISTENT_DIMENSION_FLAG` triggers if any “should-be-unique” dimension differs within the same BOM group.

#### B. BOM backup shortage correctness

- [ ] `BOM_TOTAL_SHORTAGE` computes from BOM totals (demand/issued/supply) and is not dependent on VPO-level issuance attribution.
- [ ] `BOM_SHORTAGE_STATUS` is `OK` for clean BOMs and `MISMATCH` for known attribution-noise BOMs.
- [ ] Threshold policy is documented and configurable (absolute + relative).

#### C. UI correctness (M3 sheet)

- [ ] Dashboard shows aggregation mode, tolerance mode, and buffer/custom inputs with correct validation ranges.
- [ ] Switching aggregation mode refreshes the grid layout appropriately (aggregated vs legacy).
- [ ] Switching tolerance mode causes shortage/order/savings cells to recompute consistently (either via view-driven columns or recompute-driven logic).
- [ ] Conditional formatting highlights mismatch BOMs and other validation flags without producing false positives at high volume.

#### D. Upload / explosion correctness

- [ ] Splitting pipe-delimited fields preserves VPO↔PR alignment due to the ORDER BY guarantee.
- [ ] Allocation uses shortage weights, creates integer `Q_i`, and ensures:
  - [ ] \( \sum_i Q_i = Q_{BOM} \)
  - [ ] No negative quantities
  - [ ] Deterministic tie-breaks (VPO ascending)
- [ ] `PR_Staging` rows match the legacy schema shape exactly (VPO-level), so `SP_M3_MERGE_PR_DECISIONS` runs unchanged.

#### E. Regression checks (must not change)

- [ ] PRIVATE flow remains VPO-level and unchanged (data feed, UI, upload).
- [ ] Existing end-to-end PR/PO pipeline works with uploaded decisions from both PRIVATE and PUBLIC sessions.

---

## 9. Rollout Plan

### 9.1 Environments

- **DEV / Sandbox**
  - Deploy aggregated view + backup shortage join.
  - Deploy M3 UI changes and upload explosion logic.
  - Validate using known `"Chì"` sessions and the Part3 SQL checklist.

- **UAT / Pilot**
  - Enable **PUBLIC aggregation** for `"Chì"` only.
  - Run **parallel comparison** for 1–2 full cycles:
    - Legacy VPO-level session (reference)
    - Aggregated BOM-level session (candidate)
  - Sign-off criteria:
    - Savings metrics are consistent with analysis (directionally and numerically).
    - No PR/PO regressions.

- **PROD**
  - Default aggregation mode = **AUTO**.
  - Keep `VPO_LEVEL_ONLY` toggle available for rapid fallback during early adoption.

### 9.2 Stage gates (stop/go)

- **Gate 1 — Data-only**
  - Aggregated view outputs validated (counts, sums, mismatch flags).
- **Gate 2 — UI-only**
  - M3 sheet loads correctly and shows accurate savings/mismatch signals.
- **Gate 3 — End-to-end**
  - Upload → `PR_Staging` → merge procedure produces correct `PR_Final` outputs.
- **Gate 4 — Pilot success**
  - PIC acceptance + stable operations.

---

## 10. Roles & Responsibilities

- **Architecture / Business rule ownership**: Khánh
- **Analysis / Verification**: Analytics (use Part2 Python + Part3 SQL as the verification contract)
- **BigQuery development**: Data engineer
- **Apps Script / Sheet UI**: Apps Script developer
- **UAT + Operational sign-off**: PIC Ngàn + SC team
- **Release management**: SC IT / Ops

---

## 11. Risks & Mitigations (V5-specific)

- **R1 — MOQ vs SPQ confusion**
  - **Mitigation**: Rename UI label to **SPQ** and keep true MOQ out of this iteration.

- **R2 — Misaligned VPO↔PR ID lists**
  - **Mitigation**: Enforce deterministic ORDER BY in `STRING_AGG` and validate list lengths at upload.

- **R3 — Mixed CS tolerance across a BOM**
  - **Mitigation**: Flag `MIXED_CS_TOLERANCE`; define and implement a consistent aggregation policy (prefer weighted average by demand if available).

- **R4 — Over-reliance on noisy issuance attribution**
  - **Mitigation**: Always display `BOM_TOTAL_SHORTAGE` + mismatch flags; enforce warnings on upload for mismatched BOMs when ordering > 0.

- **R5 — Performance in Apps Script (large sessions)**
  - **Mitigation**: Prefer view-driven aggregation; batch reads/writes; avoid per-row API calls; use array operations.

---

## 12. References (source of truth)

- `Part1_Assign_Sourcing_Analysis.md` (P1–P3 theory and definitions)
- `Part2_Assign_Sourcing_Analysis.md` (Python verification contract)
- `Part3_Assign_Sourcing_Analysis.md` (SQL verification contract, Q1–Q20)
- `Report/Report_V3/Assign_Sourcing_Analysis_Report_VN.md` (executive Vietnamese report; quantified deltas)
- `Implementation_Plan/Part1_Implementation_Plan_V4.md`
- `Implementation_Plan/Part2_Implementation_Plan_V4.md`
- `Implementation_Plan/Part3_Implementation_Plan_V4.md`

---

## 13. Change Log (V4 → V5)

- Clarified and standardized **SPQ vs MOQ** terminology and rules.
- Formalized deterministic **ordering contract** for concatenated VPO/PR-ID lists.
- Upgraded explosion algorithm to **sum-preserving, deterministic largest-remainder allocation** (instead of “adjust last VPO”).
- Added explicit policies for:
  - mixed CS tolerance within one BOM,
  - zero-weight allocation,
  - upload validations and warnings.
- Completed a traceable verification checklist tied directly to Part3 SQL queries.

