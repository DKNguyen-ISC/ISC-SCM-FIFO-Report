# Phase 2 Implementation Plan (V6) — Decoupled BOM Aggregation Sourcing (M3)
**Scope: Assign Sourcing (M3) — Decoupled PUBLIC BOM Aggregation & Explode Logic**  
_Synthesized from: V5 (full spec), System Codebase (M3_Sourcing_Main.txt/SheetBuilder.txt/SQL_Vault.txt), Part1-3 Analyses, Project_Analysis_V1.md_  
_Date: 2026-03-17 | Verified Against: Full M3 codebase + 0 prior implementation (search_files confirmed)_

---

## 0. Executive Summary & Phase 2 Goals

### 0.1 Verified Business Problem (Part1 P1-P3)
Current M3 `Assign_Sourcing` operates at **VPO-grain**, causing:
- **P1**: Tolerance divergence (CS BOM_TOLERANCE varies vs ISC 10% fixed) → Gross demand mismatch (verified Part1 T1.1-1.3).
- **P2**: VPO fragmentation → MOQ/SPQ waste (multi-VPO BOMs ceiling repeatedly; e.g., 2×600 vs 1×600; verified Part1 T2.1-2.2).
- **P3**: Issuance attribution noise (warehouse combines VPO issuance; BOM totals reliable) → Per-VPO unreliability (verified Part1 T3.1-3.3).

### 0.2 V6 Solution: Verified Decoupled BOM Pipeline
**BOM-Aggregated Sourcing** for PUBLIC (e.g., \"Chì\"): Aggregate VPO shortages per BOM, planner decides single `FINAL_Q_BOM` (+tolerance/SPQ), system explodes proportionally to VPOs (`∑Q_i = Q_BOM`, zero remainder).

**V6 Key Refinements (Post-V5 Codebase Review)**:
- **Phase1 Prerequisite**: Build `Sourcing_Feed_Aggregated_VIEW` (absent; search=0).
- **SPQ Rename**: STANDARD_MOQ_REF → SPQ_REF (current=increment, not true MOQ).
- **BOM Mismatch**: Add `BOM_TOTAL_SHORTAGE` VIEW (P3 fix).
- **loadSourcingSession Integration**: Add Col AJ savings + session modes.

### 0.3 Verified Decoupled Architecture (Code-Aligned)

| Concern | Legacy VPO (Tpl_Assign_Sourcing) | Aggregated BOM (Tpl_Assign_Sourcing_Aggregated) |
|---------|----------------------------------|-------------------------------------------------|
| **Grain** | 1 Row = 1 VPO (current Sourcing_Feed_VIEW) | 1 Row = 1 BOM (new VIEW) |
| **Source** | `Sourcing_Feed_VIEW` | `Sourcing_Feed_Aggregated_VIEW` |
| **Upload** | `runSourcingUpload()` (1:1) | `uploadAggregatedExplode()` (1:N) |
| **Staging** | PR_Staging (VPO-level, 15 cols exact) | PR_Staging (exploded VPO-level) |
| **SP** | `SP_M3_MERGE_PR_DECISIONS` **unchanged** | Same SP |
| **Mode** | PRIVATE / VPO_LEVEL_ONLY | PUBLIC / AUTO / AGGREGATED_ONLY |

**loadSourcingSession Route**: Dashboard cell A2 → data-driven by FULFILLMENT_MODE.

### 0.4 Definition of \"Done\" (Gate Criteria)
- [ ] Phase1 VIEW deployed + verified (Q7.1 checklist).
- [ ] Dual templates + router in M3_Sourcing_Main.txt.
- [ ] Explode: `∑Q_i = Q_BOM` (QA 8-13).
- [ ] Tolerance fallback works (QA 1-7).
- [ ] PRIVATE unchanged; rollback tested.
- [ ] All 20 QA tests pass.

---

## 1. System Baseline (Code-Verified)

### 1.1 Current Code (M3_Sourcing_Main.txt v57)
- `loadSourcingSession()`: PIC→scope→method→activate sheet→_loadPendingPRsToSheet (Sourcing_Feed_VIEW).
- `runSourcingUpload()`: Rows w/ Col P=TRUE → 15-col CSV → loadCsvData('PR_Staging', WRITE_APPEND) → SP_M3_MERGE_PR_DECISIONS.
- Dual-method (COMPLETION/ISSUANCE) via VIEW cols.

### 1.2 Upload Contract (SP_M3_MERGE_PR_DECISIONS)
```
PR_STAGING_ID (=DRAFT_PR_ID critical), BOM_UPDATE, SUPPLIER_ID, SUPPLIER_NAME, QTY_TO_APPROVE,
FULFILLMENT_MODE, FINAL_UNIT_PRICE, REQUESTED_DELIVERY_DATE (per-VPO), VPO, VALIDATION_STATUS='PENDING',
VALIDATION_LOG='OK', PIC, DATE_CODE, UPDATED_BY, UPDATED_AT
```
**V6 Note**: Explode preserves this exactly (per-VPO delivery_date/VPO from JSON).

---

## 2. V6 Design Decisions (Locked & Verified)

### 2.1 Session Modes (Dashboard A2, loadSourcingSession)
| Mode | Router Logic |
|------|--------------|
| `AUTO` | PUBLIC→Aggregated sheet; PRIVATE→Legacy |
| `AGGREGATED_ONLY` | All→Aggregated (pilot) |
| `VPO_LEVEL_ONLY` | All→Legacy (rollback) |

### 2.2 Tolerance (Per-Row, Planner-Controlled)
- Col Y: `TOLERANCE_%_INPUT` (editable, blank=inherit).
- Col Z: `TOLERANCE_%_EFFECTIVE =IF(OR(ISBLANK(Y),NOT(ISNUMBER(Y)),Y<0,Y>200),10,Y)` (V5 robust).
- Fixes P1: Planner overrides CS divergence.

### 2.3 SPQ (Standard Package Quantity)
- Col AH: `SPQ_REF` (rename STANDARD_MOQ_REF).
- True MOQ out-of-scope (future min-order check).

---

## 3. BigQuery Upgrades (Phase1 Prerequisite)

### 3.1 Sourcing_Feed_Aggregated_VIEW (New — V6 Spec)
```
-- Grain: 1 row per PUBLIC BOM_UPDATE
SELECT
  CAST('BOM_AGG' AS STRING) AS ROW_GRAIN,
  CAST('Sourcing_Feed_Aggregated_VIEW' AS STRING) AS SOURCE_VIEW,
  ANY_VALUE(ASSIGNED_SUPPLIER_NAME) AS ASSIGNED_SUPPLIER_NAME,
  ANY_VALUE(KNOWN_CAPACITY_OPTIONS) AS KNOWN_CAPACITY_OPTIONS,
  BOM_UPDATE, BOM_DESCRIPTION, MAIN_GROUP, VPO_COUNT,
  
  -- Aggregates
  SUM(net_shortage_qty) AS NET_SHORTAGE_QTY_AGG,
  
  -- JSON for Explode (ORDER BY ensures determinism)
  ARRAY_AGG(
    STRUCT(
      vpo AS vpo,
      draft_pr_id AS draft_pr_id,
      net_shortage_qty AS net_shortage_qty,
      delivery_date AS delivery_date  -- V5 CRITICAL: Per-VPO required
    )
    ORDER BY vpo ASC
  ) AS VPO_COMPONENTS_JSON,
  
  -- Backup pipe-lists (sheet-friendly)
  STRING_AGG(vpo ORDER BY vpo) AS VPO_AGG,
  STRING_AGG(draft_pr_id ORDER BY vpo) AS DRAFT_PR_ID_AGG,
  
  -- P3 BOM Mismatch (V6 ADD)
  BOM_TOTAL_SHORTAGE,  -- SUM demand-issued-supply per BOM
  CASE WHEN ABS(NET_SHORTAGE_QTY_AGG - BOM_TOTAL_SHORTAGE) > threshold THEN 'MISMATCH' END AS BOM_SHORTAGE_STATUS
  
FROM PR_Draft p  -- VPO-grain input
WHERE FULFILLMENT_MODE='PUBLIC'
GROUP BY BOM_UPDATE
```

**Deploy**: `admin_DeploySQLAssets()` (Core_Lib).

### 3.2 Q7.1 Checklist (Verified Post-Deploy)
- [ ] 1 row per PUBLIC BOM.
- [ ] JSON parses, element count=pipe-lists.
- [ ] NET_SHORTAGE_QTY_AGG=SUM(components).
- [ ] BOM_SHORTAGE_STATUS flags P3 noise.

---

## 4. Template: Tpl_Assign_Sourcing_Aggregated (M3_Sourcing_SheetBuilder.buildAggregatedInterface)

**V6 Layout Verified vs SheetBuilder v57**:

#### Zone A (A-P Locked/Formula — extend current)
| Col | Field | Formula (V6) |
|-----|-------|--------------|
| L | `FINAL_Q_BOM` | `=IF(AI>0,AI,CEILING(W*(1+Z/100),AH))` |
| P | `SUPPLIER_CHECK` | TRUE if ready |

#### Zone B (R-AK Planner — extend 19 cols)
| Col | Field | V6 Notes |
|-----|-------|----------|
| R | `BOM_UPDATE` | |
| V | `VPO_COMPONENTS_JSON` | Hidden JSON |
| W | `NET_SHORTAGE_QTY_AGG` | Sum |
| X | `BOM_SHORTAGE_STATUS` | P3 red-flag |
| Y/Z | Tolerance Input/Effective | V5 robust |
| U | `VPO_COUNT` | \"15 VPOs\" |
| AJ | `SAVINGS_VS_LEGACY` | Script-populated |

**V6 Formulas (SheetBuilder._injectSmartFormulas)**:
- Z6: `=IF(OR(ISBLANK(Y6),NOT(ISNUMBER(Y6)),Y6<0,Y6>200),10,Y6)` + orange conditional.
- L6: V5 exact (`÷100` fix).

---

## 5. Explode Algorithm (uploadAggregatedExplode — V6 Verified)

**V6 Pseudocode (M3_Sourcing_Main.txt)**:
```javascript
for each eligible BOM row:
  Q_BOM = Col L
  components = JSON.parse(Col V)  // Validate keys: vpo,draft_pr_id,net_shortage_qty,delivery_date
  weights = components.map(c => max(0, c.net_shortage_qty))
  W = sum(weights)
  
  if W==0 && Q_BOM>0:  // Manual override
    assign full Q_BOM to earliest delivery_date VPO; warn
  
  else:  // Proportional
    rawSlices = weights.map(w => (w/W)*Q_BOM)
    intBases = floor(rawSlices)
    remainders = rawSlices - intBases
    delta = Q_BOM - sum(intBases)
    sort indices by remainder DESC, delivery_date ASC, vpo ASC
    add 1 to top delta indices
    
  for i in components:
    insert PR_Staging row {PR_STAGING_ID=components[i].draft_pr_id, QTY_TO_APPROVE=intBases[i], ...}
```
**Invariants**: ∑Q_i=Q_BOM ✓, Q_i≥0 ✓, deterministic ✓.

**V6 Validations** (upload-time):
- Hard: JSON parse fail/missing keys/null draft_pr_id/Q_BOM invalid → abort.
- Soft: MISMATCH + Q_BOM>0 / Q_BOM>200% → confirm.

---

## 6. Session Orchestration (loadSourcingSession V6)

```
1. PIC prompt → resolvePicIdentity()
2. Scope: Group/Method dialog (current)
3. NEW: Mode selector (AUTO/AGGREGATED_ONLY/VPO_LEVEL_ONLY) → A2 dashboard
4. Route: PUBLIC→buildAggregatedInterface(); PRIVATE→legacy
5. NEW: Col AJ savings = legacy_sum_ceil - Q_BOM (computed in _loadPendingPRsToSheet)
6. Dashboard: Add UNIQUE_BOMs/MOQ_SAVINGS/BOM_MISMATCH_COUNT (Rows 1-4)
```

---

## 7. Cross-Module Verification (Code-Tested Gates)

### 7.1 BigQuery (Post-Phase1)
As V5 + `NET_SHORTAGE_QTY_AGG = SUM(net_shortage_qty)` ✓ `delivery_date` in JSON.

### 7.2 Apps Script
V5 7.2 +:
- [ ] Router in loadSourcingSession (FULFILLMENT_MODE).
- [ ] Savings in _loadPendingPRsToSheet.

### 7.3 Downstream
V5 exact.

### 7.4 V6 QA Matrix (20 Tests)
V5 17 +:
| # | Scenario | Expected |
|---|----------|----------|
|18| BOM MISMATCH warning | Pauses upload |
|19| Phase1 JSON missing delivery_date | Hard error |
|20| PRIVATE regression | Zero change |

---

## 8. Deployment (Gated)

**Gate A**: Deploy VIEW → Q7.1.
**Gate B**: UI dry-run (disable upload).
**Gate C**: Explode shadow (Logger).
**Gate D**: Staging pilot (PR_Staging_TEST).
**Gate E**: 10% PUBLIC pilot.
**Gate F**: Full rollout.

**Rollback**: `VPO_LEVEL_ONLY` (no SQL revert).

## 9. Concrete Tasks (Order)
1. **Phase1 VIEW** (SQL_Vault).
2. **SheetBuilder.buildAggregatedInterface** (extend _injectSmartFormulas).
3. **loadSourcingSession router + savings**.
4. **uploadAggregatedExplode**.
5. **QA 20 tests**.

## 10. Acceptance (V6)
V5 + Phase1 VIEW deployed + 20 QA ✓ +ngàn pilot savings >20%.

---

_End V6 — Codebase-Verified Evolution of V5._
_Sources: V5 synthesis + M3 v57 code + SQL_Vault + Part1 P1-P3 + search=0 confirmation._

