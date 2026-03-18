# Shortage Calculation Analysis V8

## M2 Pipeline History Architecture, Cross-Check & Final Design

*Branching from V7 — M2_Daily_Stats redundancy resolution, unified M2_Pipeline_Ledger (gross+net), email consolidation, V1-V7 cross-check, and finalized architecture.*

---

## Table of Contents

1. [M2_Daily_Stats — Is It Redundant?](#1-m2-daily-stats-redundancy)
2. [The Bigger Vision: M2 Pipeline Ledger](#2-m2-pipeline-ledger)
3. [Email & Report Strategy — One Email, Not Two](#3-email-report-strategy)
4. [Cleanup — Daily vs Monthly](#4-cleanup-frequency)
5. [Ledger INSERT Timing — A Critical Detail](#5-ledger-insert-timing)
6. [V1-V7 Comprehensive Cross-Check](#6-v1-v7-cross-check)
7. [Complete Finalized Architecture — All Schemas](#7-finalized-architecture-v8)
8. [Updated Decision Registry](#8-updated-decision-registry)

---

## 1. M2_Daily_Stats — Is It Redundant?

### 1.1 Your Question

*"If you agree with me about the broader vision for Demand_Snapshot_Ledger, does the role of M2_Daily_Stats become redundant?"*

**Short answer: No — but for a very specific reason.**

### 1.2 The Two Roles of M2_Daily_Stats

```
┌─────────────────────────────────────────────────────────────────┐
│ M2_Daily_Stats                                                   │
├─────────────────────┬───────────────────────────────────────────┤
│ ROLE A:             │ ROLE B:                                    │
│ EXECUTION METADATA  │ PRE-COMPUTED AGGREGATES                    │
│                     │                                            │
│ • RUN_DATE          │ • TOTAL_SHORTAGE_COUNT                     │
│ • RUN_SOURCE        │ • TOTAL_NET_SHORTAGE_QTY                   │
│ • BATCH_ID          │ • TOTAL_ALLOCATION_COUNT                   │
│ • RUN_STATUS        │ • SHORTAGE_COUNT_COMPLETION                │
│ • RUN_DURATION_SEC  │ • SHORTAGE_TOTAL_COMPLETION_QTY            │
│ • ERROR_MESSAGE     │ • TOP_OFFENDER_BOM_UPDATE                  │
│                     │ • IS_ANOMALY, ANOMALY_REASON               │
│                     │                                            │
│ ✅ UNIQUE           │ ❓ Computable from Pipeline Ledger?        │
│ (Cannot derive from │ (YES — but at query cost)                  │
│  row-level data)    │                                            │
└─────────────────────┴───────────────────────────────────────────┘
```

### 1.3 Can Role B Be Replaced by the Ledger?

**Technically yes.** Every aggregate can be computed from M2_Pipeline_Ledger. **But should we?**

| Factor | Pre-Computed (M2_Daily_Stats) | On-Demand (from Ledger) |
|---|---|---|
| **Query speed** | ✅ Instant (1 row) | 🟡 ~300ms (scan 10K rows) |
| **Email rendering** | ✅ Single-value lookups | 🟡 Requires aggregation |
| **7-day trend** | ✅ 7 rows, trivial | 🟡 70K rows, GROUP BY |
| **Data consistency** | 🟡 Could drift from reality | ✅ Always accurate |
| **Maintenance** | 🟡 Two tables | ✅ One table |

### 1.4 Recommendation: Keep M2_Daily_Stats, Complementary Roles

**Role A (execution metadata) is irreplaceable.** The Pipeline Ledger has no concept of "how long did the M2 engine take?" or "did it fail?"

**Role B (aggregates) is a performance cache** — the `M2_Analytic_Feed_VIEW` (Protocol lines 344-559) reads directly from M2_Daily_Stats for yesterday's metrics, 7-day averages, and trend data. Forcing it to scan 70K ledger rows for every email would be wasteful.

```
M2_Daily_Stats  → "Was M2 healthy today?"        (1 row/day, fast cache)
M2_Pipeline_Ledger → "What happened to CHI-001?"  (10K rows/day, deep analytics)
```

---

## 2. The Bigger Vision: M2 Pipeline Ledger

### 2.1 Your Insight

*"If we want to trace history for the whole M2 process — from gross demand to PRs — we should do better than V7."*

V7's `Demand_Snapshot_Ledger` only captured the **input** (gross demand from SNAPSHOT). Your vision: capture the **complete pipeline** — both input AND output — in one ledger.

### 2.2 The M2 Pipeline: Input → Process → Output

```
STAGE 1: GROSS DEMAND (SNAPSHOT)     → SHORTAGE_COMPLETION, SHORTAGE_ISSUANCE, GROSS_DEMAND_QTY
STAGE 2: ALLOCATION (Matching_Engine) → ALLOCATED_QTY (intermediary, not stored)
STAGE 3: NET SHORTAGE (PR_Draft)     → NET_SHORTAGE_COMPLETION, NET_SHORTAGE_ISSUANCE, NET_SHORTAGE_QTY
```

V7 captured only Stage 1. **V8 captures Stage 1 + Stage 3 on the same row.**

### 2.3 Naming: Why "M2_Pipeline_Ledger"

| Name | Issue |
|---|---|
| `Demand_Snapshot_Ledger` (V7) | ❌ Gross or net? Snapshot of what? |
| `M2_Demand_Ledger` | 🟡 Vague on scope |
| `M2_Run_Ledger` | 🟡 Sounds like execution log |
| `M2_Balancing_Ledger` | ✅ Captures the balancing concept |
| **`M2_Pipeline_Ledger`** | ✅ **Captures full pipeline scope** |

**Winner: `M2_Pipeline_Ledger`**
- `M2_` → belongs to M2 Balancing Engine
- `Pipeline` → full data flow (gross + allocation + net)
- `Ledger` → append-only historical record

### 2.4 The Key Innovation: LEFT JOIN at Archive Time

```sql
INSERT INTO M2_Pipeline_Ledger
SELECT
  CURRENT_DATE('Asia/Ho_Chi_Minh') AS LEDGER_DATE,
  run_source AS RUN_SOURCE, batch_id AS BATCH_ID,
  S.DEMAND_ID, S.PRODUCTION_ORDER_ID, S.BOM_UPDATE, S.VPO, S.FULFILLMENT_MODE,

  -- GROSS (from SNAPSHOT = Stage 1)
  S.SHORTAGE_COMPLETION, S.SHORTAGE_ISSUANCE, S.GROSS_DEMAND_QTY,

  -- NET (from PR_Draft = Stage 3, NULLable for fully-covered demand)
  P.NET_SHORTAGE_COMPLETION, P.NET_SHORTAGE_ISSUANCE, P.NET_SHORTAGE_QTY,
  
  -- DERIVED: How much supply covered this demand
  S.GROSS_DEMAND_QTY - COALESCE(P.NET_SHORTAGE_QTY, 0) AS SUPPLY_ALLOCATED_QTY,

  -- CLASSIFICATION + CONTEXT + FLAGS
  S.MAIN_GROUP, S.SUB_GROUP, S.PIC, S.SKU_CODE,
  S.REQUESTED_DELIVERY_DATE, S.ORDER_LIST_NOTE,
  S.HAS_ISSUANCE_DATA, S.CALC_METHOD_USED,
  CASE WHEN P.NET_SHORTAGE_QTY IS NOT NULL THEN TRUE ELSE FALSE END AS HAS_SHORTAGE,
  CURRENT_TIMESTAMP() AS PRESERVED_AT

FROM Material_Demand_SNAPSHOT S
LEFT JOIN PR_Draft P ON S.DEMAND_ID = P.DEMAND_ID
WHERE S.GROSS_DEMAND_QTY > 0;
```

### 2.5 Why LEFT JOIN (Not INNER JOIN)

```
SNAPSHOT:  ~10,000 rows (ALL demand, including fully covered)
PR_Draft:  ~2,000 rows  (ONLY unsatisfied demand)

LEFT JOIN preserves the ~8,000 rows where supply fully covered demand:
  • GROSS_DEMAND_QTY = 500, NET_SHORTAGE_QTY = NULL → SUPPLY_ALLOCATED_QTY = 500
  • This enables supply coverage analysis, success pattern detection, workload analysis
```

### 2.6 What This Unlocks (V7 → V8)

| Analytics | V7 (Gross Only) | V8 (Gross + Net) |
|---|---|---|
| Method comparison | ✅ | ✅ |
| Demand trending | ✅ | ✅ |
| **Supply efficiency** | ❌ Required JOIN | ✅ **Single table!** |
| **Coverage analysis** | ❌ | ✅ `WHERE HAS_SHORTAGE = FALSE` |
| **Net vs Gross over time** | ❌ Required JOIN | ✅ **Same row!** |
| **Allocation effectiveness** | ❌ | ✅ `AVG(SUPPLY_ALLOCATED_QTY)` |

### 2.7 Answering Your Core Question

*"This Demand_Snapshot_Ledger is for gross demand statistic right? Or is this also for Net Demand?"*

**Answer: V8's `M2_Pipeline_Ledger` captures BOTH.** Every row has:
- Columns 9-11: **Gross demand** (pre-allocation)
- Columns 12-14: **Net shortage** (post-allocation, NULL if fully covered)
- Column 15: **Supply allocated** (derived: GROSS - NET)

```sql
-- Example: Gross vs Net trend for CHI-001 (single table, no JOINs needed)
SELECT LEDGER_DATE,
  SUM(GROSS_DEMAND_QTY) AS GROSS,
  SUM(NET_SHORTAGE_QTY) AS NET,
  SUM(SUPPLY_ALLOCATED_QTY) AS SUPPLY_USED,
  ROUND(SUM(SUPPLY_ALLOCATED_QTY) * 100.0 / NULLIF(SUM(GROSS_DEMAND_QTY), 0), 1) AS COVERAGE_PCT
FROM M2_Pipeline_Ledger
WHERE BOM_UPDATE = 'CHI-001' AND LEDGER_DATE >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
GROUP BY LEDGER_DATE ORDER BY LEDGER_DATE;
```

---

## 3. Email & Report Strategy — One Email, Not Two

There is exactly **ONE daily M2 email.** Already defined in the protocol:

```
Subject: [ISC M2] 🟢 Clear Skies — Mar 1, 2026

Body: Health status + key metrics + top offenders + trends + anomalies
V8 Enhancement: Add dual-method comparison section
└── Data from M2_Daily_Stats columns 10-14 (pre-computed cache)
```

The cleanup notification is a **separate monthly email** (only when rows pending deletion):
```
Monthly: [ISC System] 📦 Ledger Cleanup Notice — 365,000 rows scheduled
```

---

## 4. Cleanup — Daily vs Monthly

| Activity | Frequency | Purpose |
|---|---|---|
| M2 Nightly Run | **Daily** 4:00 AM | Recalculate demand/shortages |
| M2 Email Report | **Daily** after run | Push health status |
| Pipeline Ledger Append | **Daily** (inside M2 run) | Archive today's snapshot |
| M2_Daily_Stats Record | **Daily** (inside M2 run) | Record execution health |
| Ledger Cleanup DELETE | **Monthly** 1st at 3:00 AM | Remove rows > 12 months |
| Cleanup Email Alert | **Monthly** before DELETE | Warn Khánh |

**Why not daily cleanup?** Monthly is simpler (12 vs 365 DELETEs/year), cleaner batches, and BQ storage is charged monthly anyway.

---

## 5. Ledger INSERT Timing — A Critical Detail

### 5.1 The V7 Error: "Append Before Truncate"

V7 proposed archiving BEFORE truncating. **Problem:** at that point, SNAPSHOT has tomorrow's data but PR_Draft still has yesterday's — time mismatch.

### 5.2 V8 Fix: "Archive After Complete Run"

```
Step 1: TRUNCATE SNAPSHOT
Step 2: INSERT INTO SNAPSHOT FROM VIEW (Today's gross demand)
Step 3: TRUNCATE Pegging_Allocations + PR_Draft
Step 4: Run matching engine (Today's allocations + net shortages)
Step 5: INSERT INTO M2_Pipeline_Ledger ← AFTER BOTH are populated
Step 6: Record M2_Daily_Stats (via Apps Script)
Step 7: Send M2 Email
```

**Step 5 is the only safe position** — both SNAPSHOT and PR_Draft contain today's data.

> [!IMPORTANT]
> **PR_Draft controls the filter.** The HAVING clause uses `GROSS_DEMAND_QTY` to determine whether a PR_Draft row exists. `NET_SHORTAGE_COMPLETION` and `NET_SHORTAGE_ISSUANCE` are informational — they don't drive the filter.

---

## 6. V1-V7 Comprehensive Cross-Check

### 6.1 Naming Convention Consistency

| Column | First Agreed | Last Agreed | Status |
|---|---|---|---|
| `SHORTAGE_COMPLETION` | V4 | V8 | ✅ Consistent |
| `SHORTAGE_ISSUANCE` | V4 | V8 | ✅ Consistent |
| `GROSS_DEMAND_QTY` | V6 | V8 | ✅ Consistent |
| `CUMULATIVE_ISSUANCE_QTY` | V6 | V8 | ✅ Consistent |
| `NET_SHORTAGE_QTY` | V7 | V8 | ✅ Consistent |
| `NET_SHORTAGE_COMPLETION` | V6 | V8 | ✅ Consistent |
| `NET_SHORTAGE_ISSUANCE` | V6 | V8 | ✅ Consistent |
| `CALC_METHOD_USED` | V6 | V8 | ✅ Consistent |
| `HAS_ISSUANCE_DATA` | V6 | V8 | ✅ Consistent |
| `PIC` (kept as-is) | V7 | V8 | ✅ Consistent |

### 6.2 Decision Evolution Tracker

| Decision | V4 | V6 | V7 | V8 | Final |
|---|---|---|---|---|---|
| Method selection | Dynamic dropdown | Same | Same | Same | ✅ D1 |
| Calculate both | Confirmed | Same | Same | Same | ✅ D2 |
| Naming: ISSUED | _ISSUED | → _ISSUANCE | Same | Same | ✅ D5 |
| History table | — | Shortage_Method_Ledger | Demand_Snapshot_Ledger | **M2_Pipeline_Ledger** | ✅ D18 |
| History scope | — | Method comparison | Full SNAPSHOT (gross) | **SNAPSHOT + PR_Draft** | ✅ D18 |
| M2_Daily_Stats | — | Proposed | 9 renames | **Kept (not redundant)** | ✅ D25 |

### 6.3 Table Count Verification

| Table/View | Status | Phase |
|---|---|---|
| `Material_Demand_VIEW` | 🔄 MODIFY (add 8 columns) | 1 |
| `Material_Demand_SNAPSHOT` | 🔄 REBUILD (match VIEW) | 1 |
| `M2_Pipeline_Ledger` | 🆕 CREATE (25 cols) | 1 |
| `Identity_Registry.gs` | 🆕 CREATE | 2 |
| `Material_Issuance` | 🆕 CREATE (8 cols) | 3 |
| `PR_Draft` | 🔄 ALTER (add 5, rename 1) | 4 |
| `Sourcing_Feed_VIEW` | 🔄 MODIFY | 4 |
| `M2_Daily_Stats` | 🆕 CREATE (20 cols) | 6 |
| `M2_Analytic_Feed_VIEW` | 🆕 CREATE | 6 |

**Total: 3 new tables, 1 new view, 1 new utility, 4 modified tables/views**

### 6.4 Column Flow Verification

```
Material_Demand_VIEW.GROSS_DEMAND_QTY (was MATERIAL_DEMANDED)
    ├──► SNAPSHOT.GROSS_DEMAND_QTY
    │       ├──► M2_Pipeline_Ledger.GROSS_DEMAND_QTY (archived)
    │       └──► SP_RUN_MATCHING_ENGINE reads D.GROSS_DEMAND_QTY
    │            └──► PR_Draft.NET_SHORTAGE_QTY = GROSS - ALLOCATED
    │                 ├──► M2_Pipeline_Ledger.NET_SHORTAGE_QTY (same row!)
    │                 └──► Sourcing_Feed_VIEW → Assign_Sourcing Sheet (Col Z)
    └──► ✅ VERIFIED: GROSS_DEMAND_QTY flows through correctly
```

### 6.5 Matching_Engine_VIEW — No Changes Needed

The Matching_Engine_VIEW reads `GROSS_DEMAND_QTY` from SNAPSHOT for FIFO allocation. It doesn't care about dual-method columns. The allocation is method-agnostic.

### 6.6 SP_RUN_MATCHING_ENGINE — Updated Flow

```
Current:
  Step 1: TRUNCATE (SNAPSHOT + PR_Draft + Pegging)
  Step 2: Refresh SNAPSHOT from VIEW
  Step 3: Fill Pegging from Matching_Engine_VIEW
  Step 4: Fill PR_Draft (PUBLIC tunnel)
  Step 5: Fill PR_Draft (PRIVATE tunnel)

V8:
  Step 1: TRUNCATE SNAPSHOT
  Step 2: Refresh SNAPSHOT from VIEW (8 new columns)
  Step 3: TRUNCATE Pegging_Allocations
  Step 4: Fill Pegging from Matching_Engine_VIEW
  Step 5: TRUNCATE PR_Draft
  Step 6: Fill PR_Draft (PUBLIC, with NET_SHORTAGE_* + classification)
  Step 7: Fill PR_Draft (PRIVATE, with NET_SHORTAGE_* + classification)
  Step 8: Archive to M2_Pipeline_Ledger (JOIN SNAPSHOT + PR_Draft) ← NEW
```

---

## 7. Complete Finalized Architecture — All Schemas (V8)

### 7.1 Material_Demand_VIEW (18 columns)

| # | Column | Type | Change |
|---|---|---|---|
| 1 | `DEMAND_ID` | STRING | — |
| 2 | `PRODUCTION_ORDER_ID` | STRING | — |
| 3 | `BOM_UPDATE` | STRING | — |
| 4 | `FULFILLMENT_MODE` | STRING | — |
| 5 | `VPO` | STRING | — |
| 6 | `ORDER_LIST_NOTE` | STRING | — |
| 7 | `SKU_CODE` | STRING | — |
| 8 | `REQUESTED_DELIVERY_DATE` | DATE | — |
| 9 | `RECEIVED_VPO_DATE` | DATE | — |
| 10 | `SHORTAGE_COMPLETION` | FLOAT | 🆕 |
| 11 | `SHORTAGE_ISSUANCE` | FLOAT | 🆕 |
| 12 | `GROSS_DEMAND_QTY` | FLOAT | 🔄 was: MATERIAL_DEMANDED |
| 13 | `MAIN_GROUP` | STRING | 🆕 |
| 14 | `SUB_GROUP` | STRING | 🆕 |
| 15 | `PIC` | STRING | 🆕 |
| 16 | `HAS_ISSUANCE_DATA` | BOOL | 🆕 |
| 17 | `CALC_METHOD_USED` | STRING | 🆕 |
| 18 | `CALCULATED_AT` | TIMESTAMP | — |

### 7.2 PR_Draft (15 columns)

| # | Column | Type | Change |
|---|---|---|---|
| 1 | `DRAFT_PR_ID` | STRING | — |
| 2 | `DEMAND_ID` | STRING | — |
| 3 | `VPO` | STRING | — |
| 4 | `BOM_UPDATE` | STRING | — |
| 5 | `NET_SHORTAGE_COMPLETION` | FLOAT | 🆕 |
| 6 | `NET_SHORTAGE_ISSUANCE` | FLOAT | 🆕 |
| 7 | `NET_SHORTAGE_QTY` | FLOAT | 🔄 was: SHORTAGE_QTY |
| 8 | `FULFILLMENT_MODE` | STRING | — |
| 9 | `REQUEST_TYPE` | STRING | — |
| 10 | `MAIN_GROUP` | STRING | 🆕 |
| 11 | `SUB_GROUP` | STRING | 🆕 |
| 12 | `HAS_ISSUANCE_DATA` | BOOL | 🆕 |
| 13 | `ORDER_LIST_NOTE` | STRING | — |
| 14 | `REQUESTED_DELIVERY_DATE` | DATE | — |
| 15 | `CREATED_AT` | TIMESTAMP | — |

### 7.3 M2_Daily_Stats (20 columns)

| # | Column | Type | Change |
|---|---|---|---|
| 1 | `RUN_DATE` | DATE | 🔄 was: STAT_DATE |
| 2 | `RUN_SOURCE` | STRING | — |
| 3 | `BATCH_ID` | STRING | — |
| 4 | `RUN_STATUS` | STRING | — |
| 5 | `RUN_DURATION_SECONDS` | FLOAT | 🔄 |
| 6 | `ERROR_MESSAGE` | STRING | — |
| 7 | `TOTAL_SHORTAGE_COUNT` | INT | 🔄 |
| 8 | `TOTAL_NET_SHORTAGE_QTY` | FLOAT | 🔄 |
| 9 | `TOTAL_ALLOCATION_COUNT` | INT | 🔄 |
| 10 | `SHORTAGE_COUNT_COMPLETION` | INT | 🆕 |
| 11 | `SHORTAGE_COUNT_ISSUANCE` | INT | 🆕 |
| 12 | `SHORTAGE_TOTAL_COMPLETION_QTY` | FLOAT | 🆕 |
| 13 | `SHORTAGE_TOTAL_ISSUANCE_QTY` | FLOAT | 🆕 |
| 14 | `METHOD_DELTA_COUNT` | INT | 🆕 |
| 15 | `TOP_OFFENDER_BOM_UPDATE` | STRING | 🔄 |
| 16 | `TOP_OFFENDER_QTY` | FLOAT | — |
| 17 | `TOP_OFFENDER_SHARE_PCT` | FLOAT | 🔄 |
| 18 | `IS_ANOMALY` | BOOL | — |
| 19 | `ANOMALY_REASON` | STRING | — |
| 20 | `CREATED_AT` | TIMESTAMP | — |

### 7.4 M2_Pipeline_Ledger (25 columns — NEW in V8)

| # | Column | Type | Source | Purpose |
|---|---|---|---|---|
| 1 | `LEDGER_DATE` | DATE | System | Partition column |
| 2 | `RUN_SOURCE` | STRING | SP param | Run trigger |
| 3 | `BATCH_ID` | STRING | SP param | Links to M2_Daily_Stats |
| 4 | `DEMAND_ID` | STRING | SNAPSHOT | Row key |
| 5 | `PRODUCTION_ORDER_ID` | STRING | SNAPSHOT | Order context |
| 6 | `BOM_UPDATE` | STRING | SNAPSHOT | Material key |
| 7 | `VPO` | STRING | SNAPSHOT | Order reference |
| 8 | `FULFILLMENT_MODE` | STRING | SNAPSHOT | PUBLIC/PRIVATE |
| 9 | `SHORTAGE_COMPLETION` | FLOAT | SNAPSHOT | **Gross** (Completion) |
| 10 | `SHORTAGE_ISSUANCE` | FLOAT | SNAPSHOT | **Gross** (Issuance) |
| 11 | `GROSS_DEMAND_QTY` | FLOAT | SNAPSHOT | Active gross demand |
| 12 | `NET_SHORTAGE_COMPLETION` | FLOAT | PR_Draft | **Net** (Completion) |
| 13 | `NET_SHORTAGE_ISSUANCE` | FLOAT | PR_Draft | **Net** (Issuance) |
| 14 | `NET_SHORTAGE_QTY` | FLOAT | PR_Draft | Active net shortage |
| 15 | `SUPPLY_ALLOCATED_QTY` | FLOAT | Computed | GROSS - NET |
| 16 | `MAIN_GROUP` | STRING | SNAPSHOT | Material group |
| 17 | `SUB_GROUP` | STRING | SNAPSHOT | Sub-group |
| 18 | `PIC` | STRING | SNAPSHOT | Material owner |
| 19 | `SKU_CODE` | STRING | SNAPSHOT | Product context |
| 20 | `REQUESTED_DELIVERY_DATE` | DATE | SNAPSHOT | Urgency |
| 21 | `ORDER_LIST_NOTE` | STRING | SNAPSHOT | Strategy note |
| 22 | `HAS_ISSUANCE_DATA` | BOOL | SNAPSHOT | Issuance available? |
| 23 | `CALC_METHOD_USED` | STRING | SNAPSHOT | Active method |
| 24 | `HAS_SHORTAGE` | BOOL | Derived | Net shortage exists? |
| 25 | `PRESERVED_AT` | TIMESTAMP | System | When archived |

### 7.5 Material_Issuance (8 columns)

| # | Column | Type | Purpose |
|---|---|---|---|
| 1 | `ISSUANCE_ID` | STRING | ISU_ + MD5 |
| 2 | `BOM_UPDATE` | STRING | Material key |
| 3 | `VPO` | STRING | Order ref |
| 4 | `CUMULATIVE_ISSUANCE_QTY` | FLOAT | Total issued to date |
| 5 | `SNAPSHOT_DATE` | DATE | When captured |
| 6 | `SOURCE_BOM_CODE` | STRING | Mapping context |
| 7 | `SYNC_BATCH_ID` | STRING | Sync metadata |
| 8 | `SYNCED_AT` | TIMESTAMP | When synced |

---

## 8. Updated Decision Registry (V1 → V8)

### Core Architecture

| # | Decision | Source |
|---|---|---|
| D1 | Dynamic Dropdown (Option B) for material groups | V4 |
| D2 | Calculate both methods into Material_Demand_VIEW | V4 |
| D3 | Dialog at Assign_Sourcing level | V4 |
| D4 | `MAIN_GROUP` is the primary classifier | V4 |
| D7 | Build pipeline first (Phase 3 before Phase 5) | V6 |
| D8 | Show both methods side-by-side in sheet | V6 |
| D9 | MASTER gets cross-method comparison dashboard | V6 |

### Naming Conventions

| # | Decision | Source |
|---|---|---|
| D5 | Noun-form: `ISSUANCE` / `COMPLETION` | V6 |
| D6 | `NET_SHORTAGE_*` prefix in PR_Draft | V6 |
| D12 | `MATERIAL_DEMANDED` → `GROSS_DEMAND_QTY` | V6 |
| D13 | `CUMULATIVE_ISSUED_QTY` → `CUMULATIVE_ISSUANCE_QTY` | V6 |
| D15 | `SHORTAGE_QTY` → `NET_SHORTAGE_QTY` | V7 |
| D16 | Keep `PIC` (not `BOM_PIC`) | V7 |
| D17 | M2_Daily_Stats: 9 column renames | V7 |

### Infrastructure & Traceability

| # | Decision | Source |
|---|---|---|
| D10 | Centralize PIC identity in `Identity_Registry.gs` | V6 |
| D11 | SEPARATE `M2_Daily_Stats` + `M2_Pipeline_Ledger` | V7→V8 |
| D14 | Scheduled DELETE + email notification for retention | V7 |
| D18 | Full pipeline ledger (gross+net), named `M2_Pipeline_Ledger` | V8 |
| D19 | Khánh = `SYSTEM_ARCHITECT` | V7 |
| D20 | Monthly DELETE + Pre-delete email to Khánh | V7→V8 |
| D21 | Cleanup notification to Khánh only | V8 |
| D22 | ONE daily M2 email (not two) | V8 |
| D23 | Daily report + monthly cleanup = separate cadences | V8 |
| D24 | Ledger INSERT after complete M2 run (after PR_Draft, before email) | V8 |
| D25 | M2_Daily_Stats NOT redundant — execution metadata + cache | V8 |

### Phase Roadmap (V8 Final)

| Phase | What | Priority | Complexity |
|---|---|---|---|
| 1 | Dual-Column VIEW + Schema Migration + M2_Pipeline_Ledger | 🔴 HIGH | MEDIUM |
| 2 | PIC Identity Fix (`Identity_Registry.gs`) | 🟡 MEDIUM | LOW |
| 3 | `Material_Issuance` + `M4_Issuance_AutoSync` | 🔴 HIGH | HIGH |
| 4 | Propagate dual columns to PR_Draft + Sourcing_Feed_VIEW | 🔴 HIGH | MEDIUM |
| 5 | Assign_Sourcing Dialog Redesign (smart features) | 🟡 MEDIUM | HIGH |
| 6 | M2_Daily_Stats + M2_Analytic_Feed_VIEW + Email upgrade | 🟡 MEDIUM | MEDIUM |
| 7 | GROSS_DEMAND_QTY auto-switch logic | 🟢 LOW | LOW |
| 8 | Looker Studio dashboard + MASTER insights | 🟢 LOW | LOW |

---

*Analysis V8 — 2026-03-01*  
*Continues from V7: M2_Daily_Stats redundancy, M2_Pipeline_Ledger unified design (25 cols, gross+net), email consolidation, INSERT timing fix, V1-V7 cross-check*  
*Cross-references: M2_Email_HisAnalytic_Protocol_V2.txt (lines 1-820), SQL_Vault.txt (lines 77-118, 520-560, 1524-1785, 1920-1993)*
