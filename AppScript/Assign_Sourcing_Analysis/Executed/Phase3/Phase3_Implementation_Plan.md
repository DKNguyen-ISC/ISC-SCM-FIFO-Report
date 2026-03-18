# Phase 3 Implementation Plan (V1) — Full Production Rollout + Extensions

**Scope:** Assign Sourcing (M3) — Production Deployment, Monitoring, & Phase 2 Extensions  
**Synthesized from:** Phase2_Implementation_Plan_V7.md, Phase2_Executed_Part2.md, Phase2_Validation_Results.md, Production_Order_Analysis Walkthroughs (recovery precedent)  
**Date:** 2026-03-18  
**Status:** Authoritative rollout specification — grounded in Phase 2 live validation success

---

## V1 Changelog (vs Phase 2 V7)

| # | Addition / Lock-in | Category |
|---|---|---|
| E1 | SQL blocker fix (delivery_date in VPO_COMPONENTS_JSON) prioritized as Day 0 | **Critical Prerequisite** |
| E2 | 6-Gate rollout with pilot traffic control + instant rollback | **Safe Deployment** |
| E3 | Production KPIs: savings units, BOM mismatch handling rate, upload success | **Observability** |
| E4 | Extension roadmap: true MOQ, CS tolerance aggregation, PRIVATE aggregation pilot | **Future-Proof** |
| E5 | Full 30-test QA matrix (Phase2 20 + 10 Phase3 prod tests) | **Production QA** |
| E6 | M4 integration hooks for PO issuance post-merge | **End-to-End** |

---

## 0. Executive Summary & Phase 3 Goals

### 0.1 Phase 2 Success Baseline (Verified Live)

**Phase 2 is production-ready post-1 SQL fix:**
- **Data:** 357 PUBLIC BOMs perfect aggregation (Q1.1); JSON integrity 100% (Q2); aggregation math exact (Q3.1).
- **UI:** Full spec impl (V7 §4 verified in M3_Sourcing_SheetBuilder.txt).
- **Algorithm:** Explode LRM math invariant (Q7.1, ∑Qᵢ=Q_BOM 100%); soft warnings impl.
- **Value:** Real savings proven (Q13): 64u BOM 300029134 (0.02%), 75% BOM 350000645; avg 1-3% reduction.

**Remaining Phase2 blocker (1 fix):** Add `DELIVERY_DATE AS delivery_date` to VPO_COMPONENTS_JSON in SQL_Vault.txt (Q6.1: 20 null rows).

### 0.2 Phase 3 Objectives

1. **Safe Production Rollout:** Deploy to all PICs for PUBLIC materials (`AUTO` mode default).
2. **Live Monitoring:** Track Phase2 KPIs + prod anomalies (mismatch suppression rate, error logs).
3. **Blocker Resolution:** Fix delivery_date + revalidate.
4. **Regression Free:** PRIVATE unchanged; downstream M4 PO issuance intact.
5. **Extensibility:** Add true MOQ enforcement, CS tolerance, PRIVATE aggregation hooks.

### 0.3 Architecture Lock-in (No Changes)

| Layer | Status |
|---|---|
| **BigQuery** | `Sourcing_Feed_Aggregated_VIEW` + BOM backup live & verified |
| **M3 UI** | Aggregated template + tolerance/SPQ formulas + explode upload ready |
| **Downstream** | `PR_Staging`→`SP_M3_MERGE_PR_DECISIONS`→`PR_Final` unchanged |
| **Controls** | Dashboard `AUTO/AGG_ONLY/VPO_ONLY`; tolerance effective guard |

### 0.4 Definition of \"Done\"

Phase 3 complete when **all** verified:

- [ ] SQL fix deployed + Q6.1=0 rows.
- [ ] 10% pilot: 100+ BOMs end-to-end (upload→merge→M4 PO preview).
- [ ] Full rollout: 100% PUBLIC traffic routed; 2-week stability.
- [ ] KPIs: ≥80% BOMs OK status; savings >0 for ≥50% multi-VPO BOMs.
- [ ] All 30 QA tests pass; rollback drill success.
- [ ] Phase4 extension hooks documented (MOQ, PRIVATE).

---

## 1. Blocker Resolution (Day 0 — SQL Fix)

### 1.1 Critical Fix: delivery_date in JSON

**Location:** `AppScript/ISC_SCM_Core_Lib/SQL_Vault.txt` → `VPO_COMPONENTS_JSON`

**Current (broken):**
```sql
TO_JSON_STRING(STRUCT(VPO AS vpo, DRAFT_PR_ID AS draft_pr_id, NET_SHORTAGE_QTY AS net_shortage_qty))
```

**Fixed (add delivery_date):**
```sql
TO_JSON_STRING(STRUCT(
  VPO AS vpo,
  DRAFT_PR_ID AS draft_pr_id,
  NET_SHORTAGE_QTY AS net_shortage_qty,
  DELIVERY_DATE AS delivery_date  -- Enables explode tie-break (V7 §5.2 Step 6)
))
```

**Deploy:** `admin_DeploySQLAssets()`.

**Post-Fix Verification (run_validation.py):**
- Q6.1: 0 rows (delivery_date coverage 100%).
- Q2.1: Still 0 rows (JSON integrity).

---

## 2. Rollout Architecture: Controlled Traffic + Rollback

### 2.1 Traffic Controls (No Hardcode)

**Dashboard E2 (persists per session):**
| Mode | % PUBLIC Traffic | Behavior |
|---|---|---|
| `AUTO` | 100% (post-pilot) | PUBLIC→Aggregated; PRIVATE→Legacy |
| `AGGREGATED_ONLY` | 100% PUBLIC | Force aggregated (pilot/debug) |
| `VPO_LEVEL_ONLY` | 0% | Full legacy (rollback) |

**PIC Rollout Waves:**
- Wave 1 (pilot): Ngàn (Chì focus).
- Wave 2: All PICs.

### 2.2 Rollback (Instant, No SQL Revert)

1. Set Dashboard E2=`VPO_LEVEL_ONLY`.
2. All sessions refresh→legacy feed.
3. `Sourcing_Feed_Aggregated_VIEW` unused (additive).

**Guaranteed:** No data loss; merge SP unchanged.

---

## 3. Production Deployment Gates

### Gate A — SQL Fix & Data Revalidation (Day 1 AM)
- [ ] Edit SQL_Vault.txt + deploy.
- [ ] run_validation.py: Q1-Q8 all pass (esp Q6.1=0).
- [ ] Test session load: 50 BOMs, verify Col V JSON parses in Apps Script Logger.

### Gate B — UI Dry-Run Pilot (Day 1 PM)
- [ ] Ngàn loads `AGGREGATED_ONLY` session: 20 BOMs.
- [ ] Verify formulas: tolerance fallback, FINAL_Q_BOM, SUPPLIER_CHECK.
- [ ] Shadow upload (Logger only): verify ∑Qᵢ=Q_BOM per BOM.
- [ ] QA Matrix Tests 1-15 pass.

### Gate C — Staging Pilot (Day 2 AM)
- [ ] Ngàn uploads 10 BOMs to `PR_Staging_TEST`.
- [ ] Manual `SP_M3_MERGE_PR_DECISIONS`.
- [ ] Q9-Q11: staging→final correct; no orphans.
- [ ] QA 16-25 pass.

### Gate D — 10% Prod Pilot (Day 2 PM)
- [ ] Dashboard default=`AUTO` for Ngàn.
- [ ] Monitor 50 BOMs end-to-end (PR_Final→M4 preview).
- [ ] KPIs: Upload success 100%; mismatch confirm rate ≤20%.

### Gate E — 100% Rollout (Day 3)
- [ ] All PICs `AUTO` default.
- [ ] Monitor 300+ BOMs / week.
- [ ] 2-week stability: error rate <1%; savings logged.

### Gate F — Production Hardening (Week 2)
- [ ] Extension hooks live (see §8).
- [ ] Full 30-QA monthly.
- [ ] Rollback drill quarterly.

---

## 4. Production Monitoring & KPIs

### 4.1 Core Metrics (BQ Dashboard)

| KPI | Target | Query |
|---|---|---|
| **Savings Units (Q13)** | >0 for ≥50% multi-VPO BOMs | SUM(LEGACY_TOTAL - AGG_Q_BOM) |
| **BOM Mismatch Rate (Q5.1)** | ≤15% | COUNTIF(MISMATCH)/total |
| **Upload Success** | ≥99% | 1 - (hard_errors / uploads) |
| **Explode Conservation** | 100% | AVG(∑Qᵢ == Q_BOM) |
| **Merge Latency** | <5s avg | SP exec time |

### 4.2 Alerts (Logger + BQ Scheduled)

- Hard error rate >1%.
- Mismatch suppress rate >30% (workflow smell).
- PR_Final orphans >0 (merge fail).

### 4.3 Weekly Report (Automated)

- BOMs processed; savings total.
- Top 10 savings BOMs.
- Mismatch investigation list.

---

## 5. Phase 3 QA Matrix (30 Tests)

**Phase2 20 Tests** (V7 §7.4): All pass per Phase2_Executed_Part2.

**Phase3 10 Prod Tests:**

| # | Scenario | Expected |
|---|---|---|
| 21 | Pilot 10% traffic: No downstream M4 errors | PR_Final→PO preview clean |
| 22 | Rollback drill: E2=VPO_ONLY → legacy flow | Instant, 100% PRIVATE success |
| 23 | High-volume session (100+ BOMs): timeout-free | Load/upload <30s |
| 24 | Multi-PIC concurrent: No session conflicts | Dashboard persists per sheet |
| 25 | Mismatch row upload (confirm): rows written | Soft warning respected |
| 26 | Zero-shortage override: Allocates to earliest VPO | Warning logged, ∑=Q_BOM |
| 27 | JSON edge (delivery_date tie-break): deterministic | Same input → same Qᵢ |
| 28 | SP_MERGE with mixed legacy+exploded: succeeds | PR_Final correct both paths |
| 29 | 2-week stability: KPIs stable | Error <1%, savings trend up |
| 30 | Extension hook: Col AG LEAD_TIME_OVERRIDE works | M4 PO preview reflects |

---

## 6. Extensions Roadmap (Phase 4 Hooks)

### 6.1 True MOQ Enforcement

- Add Col AH=MOQ_REF (separate from SPQ).
- Upload validation: Qᵢ ≥ MOQ or zero.
- Soft warning if violated.

### 6.2 CS Tolerance Aggregation

- Per-BOM CS_TOLERANCE_AGG = WEIGHTED_AVG(BOM_TOLERANCE by demand).
- Tolerance Mode=`CS` → use AGG vs row-level MAX.

### 6.3 PRIVATE Aggregation Pilot

- `Sourcing_Feed_PRIVATE_Aggregated_VIEW`.
- Wave 2 rollout.

### 6.4 M4 PO Issuance Integration

- Post-merge trigger: `M4_Issuance_AutoSync_Main.gs`.
- Preview column in dashboard.

---

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **PIC Adoption** | Ngàn pilot + savings proof (Q13); `AUTO` default |
| **Merge/SP Errors** | Q10 regression tests; `PR_Staging_TEST` shadow |
| **High Mismatch** | Workflow: confirm→order or escalate; weekly list |
| **Delivery_Date Fix Fails** | Manual tie-break by VPO asc; revalidate Q6 |

---

## 8. Concrete Day 0 Tasks

1. **SQL Fix:** Edit SQL_Vault.txt + `admin_DeploySQLAssets()`.
2. **Revalidate:** `cd AppScript/Assign_Sourcing_Analysis/Executed/Phase2 && python run_validation.py`.
3. **Pilot Session:** Ngàn `AGGREGATED_ONLY` load+shadow upload.
4. **Gate A Sign-off:** Q6.1=0; Logs clean.

**Phase 3: Production Lift-Off → Phase 2 Value Unlocked at Scale**


