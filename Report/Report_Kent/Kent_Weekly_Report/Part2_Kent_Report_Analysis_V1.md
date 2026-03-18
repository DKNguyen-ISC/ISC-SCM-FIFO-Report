# Part 2: Weekly Report Content & Department Replication Plan

*Kent Weekly Report Analysis — V1*
*Date: 2026-03-13*

---

## 1. Weekly Report Content Structure

### 1.1 The Report Must Cover Three Horizons

Based on Kent's directives, each weekly report should address **three horizons simultaneously**:

| Horizon | Focus | Kent's Question | Cadence |
|---|---|---|---|
| **H1: This Week** | What was done / achieved this week | Accountability | Every report |
| **H2: Next Week** | What is planned for next week | Forward visibility | Every report |
| **H3: Strategic** | Roadmap progress, 5W-2H updates | Long-term tracking | Monthly deep-dive |

### 1.2 Proposed Report Sections

Each weekly report should contain these sections:

```
╔══════════════════════════════════════════════════════════╗
║  ISC WEEKLY DIGITALIZATION REPORT                        ║
║  Week of: [DATE] | Prepared by: Khánh                   ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  1️⃣  EXECUTIVE SUMMARY (2-3 bullet points)              ║
║     • Key achievement this week                          ║
║     • Key issue / blocker (if any)                       ║
║     • Key metric (KPI change)                            ║
║                                                          ║
║  2️⃣  SCM DATABASE PROJECT STATUS                         ║
║     • Phase progress (which phase, % complete)           ║
║     • Technical milestones                               ║
║     • System health metrics                              ║
║                                                          ║
║  3️⃣  DEPARTMENT REPLICATION TRACKER                      ║
║     • Which department is next in queue                  ║
║     • Assessment / discovery progress                    ║
║     • 5W-2H matrix update                                ║
║                                                          ║
║  4️⃣  KAIZEN / WASTE ELIMINATION SCOREBOARD               ║
║     • Hours saved this week (quantified)                 ║
║     • Errors prevented (quantified)                      ║
║     • Processes automated vs remaining                   ║
║                                                          ║
║  5️⃣  NEXT WEEK PLAN                                      ║
║     • Action items with owner & deadline                 ║
║     • Risks / dependencies                               ║
║                                                          ║
║  📎  APPENDIX (as needed)                                 ║
║     • Technical details, data tables, screenshots        ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
```

---

## 2. Section Deep-Dive: What Goes in Each Section

### 2.1 Executive Summary

**Rule: 3 bullets, max 2 lines each.** Kent is an ISC Director — he reads summaries first, details only if needed.

Example:
> - ✅ **Completed Phase 7** of SCM Database — auto-switch logic for Chì materials is now live, reducing daily planner workload by ~30 minutes.
> - ⚠️ **Blocker:** Warehouse team needs training on new Stock Upload procedure. Proposed training date: March 20.
> - 📊 **KPI:** Shortage report accuracy improved from 87% to 96% after Issuance method activation.

### 2.2 SCM Database Project Status

This is the **core operational section**, reporting on the system Khánh has built:

#### Current System Metrics (Real Data Points)

| Metric | Source | Reportable KPI |
|---|---|---|
| Daily shortage count | `M2_Daily_Stats.TOTAL_SHORTAGE_COUNT` | Trend line (7-day) |
| Net shortage quantity | `M2_Daily_Stats.TOTAL_NET_SHORTAGE_QTY` | Week-over-week change |
| Method delta | `M2_Daily_Stats.METHOD_DELTA_COUNT` | Items where Completion ≠ Issuance |
| System uptime | `System_Execution_Log` | % of runs with SUCCESS status |
| Anomaly count | `M2_Daily_Stats.IS_ANOMALY` | Count this week vs last week |
| Pipeline coverage | `M2_Pipeline_Ledger` | % of demand covered by supply |

#### Phase Progress Tracker

```
Phase 1: Dual-Column VIEW ████████████████████ 100% ✅
Phase 2: PIC Identity     ████████████████████ 100% ✅
Phase 3: Issuance Sync    ████████████████████ 100% ✅
Phase 4: PR Dual Columns  ████████████████████ 100% ✅
Phase 5: Sourcing Dialog  ████████████░░░░░░░  60% 🟡
Phase 6: Analytics Email  ████████████████████ 100% ✅
Phase 7: Auto-Switch      ████████████████████ 100% ✅
Phase 8: Looker Studio    ████████████████████ 100% ✅
```

### 2.3 Kaizen Scoreboard — Quantifying Waste Elimination

This is **critical for Kent**. It translates technical work into Lean language:

| Waste (Muda) | Before | After | Savings/Week |
|---|---|---|---|
| **Waiting** — Planner waits for shortage data | 2 hours/day manual Excel | 0 minutes (auto 4 AM) | **10 hours/week** |
| **Over-processing** — Multiple file comparison | 5 files cross-referenced daily | 1 automated view | **5 hours/week** |
| **Defects** — Calculation errors | ~3-5 errors/week | 0 (SP-validated) | **2 hours rework/week** |
| **Motion** — Switching between systems | 8+ file switches/day | 1 Google Sheet | **3 hours/week** |
| **Inventory** (Information) — Stale data | Monday-only stock update | Daily automated pipeline | **Real-time visibility** |
| **Transportation** — Email chain delays | Hours waiting for replies | Automated email alerts | **4 hours/week** |
| | | **Total Estimated Savings:** | **~24 hours/week** |

> **ROI Calculation:**
> - 24 hours/week × $8/hour (average planner cost) = ~$192/week = **$768/month**
> - System cost: ~$15/month (BigQuery)
> - **ROI: 5,020%** — for every $1 invested, ISC saves $50

---

## 3. The 5W-2H Matrix: Company-Wide Digitalization Plan

This is the **core deliverable Kent requested**. The matrix covers all three levels.

### 3.1 Level 1: Individual (Cá Nhân)

| W/H | Answer |
|---|---|
| **WHAT** | Personal productivity tools — Google Workspace optimization, email templates, keyboard shortcuts, data entry best practices |
| **WHY** | Reduce repetitive manual work, minimize human errors in daily tasks |
| **WHEN** | Immediate — can start Week 1 with training sessions |
| **WHO** | All employees; IT/Khánh provides training materials |
| **WHERE** | Each person's workstation — Google Docs, Sheets, Gmail |
| **HOW TO** | 1. Identify each person's top 3 repetitive tasks via survey. 2. Create personalized Google Workspace shortcuts/templates. 3. Train on Google Sheets formulas (VLOOKUP, QUERY, IMPORTRANGE). 4. Introduce basic Apps Script macros for repetitive formatting. |
| **HOW MUCH** | $0 (Google Workspace already licensed). Time: 2 hours training per person. |

### 3.2 Level 2: Department (Phòng Ban)

#### Department Priority Matrix

| Priority | Department | WHAT | WHY (Waste Targeted) | WHEN | WHO Builds | HOW TO | HOW MUCH |
|---|---|---|---|---|---|---|---|
| 🔴 **P1** | **Supply Chain** ✅ | Full MRP system (4 modules) — Production planning, shortage calc, procurement, logistics | Waiting, Over-processing, Defects, Motion | ✅ Already live | Khánh | Already built: GSheets + Apps Script + BigQuery | $15/month |
| 🔴 **P2** | **Production / Factory** | Production scheduling, output tracking, yield analysis, downtime logging | Waiting (production schedules), Defects (yield tracking), Overproduction | Q2 2026 (Apr-Jun) | Khánh + Production Manager | Replicate M1 pattern: GSheet input → BQ → Automated scheduling dashboard | $10/month (BQ queries) |
| 🟡 **P3** | **Quality Control** | Inspection checklist digitization, defect photo logging, CAPA tracking, SPC charts | Defects (data loss from paper forms), Over-processing (manual SPC) | Q3 2026 (Jul-Sep) | Khánh + QC Manager | GSheet forms for inspectors → BQ storage → Automated SPC + Pareto charts | $10/month |
| 🟡 **P4** | **Warehouse / Logistics** | Beyond Monday Protocol — real-time location tracking, cycle counting, goods receipt automation | Inventory waste, Motion, Transportation | Q3 2026 (Jul-Sep) | Khánh + Warehouse Lead | Extend M4 module: barcode integration → GSheet scanner app → BQ | $15/month + barcode hardware |
| 🟢 **P5** | **Finance / Accounting** | Automated PO-Invoice reconciliation, cost variance analysis, budget tracking dashboard | Waiting (approval cycles), Over-processing (manual reconciliation) | Q4 2026 (Oct-Dec) | Khánh + Finance Manager | Bridge PO data from M3 → Invoice matching → Automated exception report | $10/month |
| 🟢 **P6** | **HR / Admin** | Attendance digitization, training record management, KPI dashboard per employee | Motion (manual attendance), Defects (data errors) | Q1 2027 | Khánh + HR Admin | GSheet forms → BQ → Monthly KPI email | $5/month |
| 🟢 **P7** | **Sales / CS** | Customer order pipeline, delivery tracking portal, complaint management | Waiting (order status queries), Transportation (info relay) | Q1 2027 | Khánh + Sales Lead | Extend CS Protocol from M1 → External-facing portal | $10/month |
| ⚪ **P8** | **Maintenance** | Equipment maintenance scheduling (PM), downtime logging, spare parts tracking | Waiting (unplanned downtime), Inventory (spare parts) | Q2 2027 | Khánh + Maintenance Lead | GSheet form → BQ → Calendar triggers for PM schedule | $5/month |

### 3.3 Level 3: Company (Toàn Công Ty)

| W/H | Answer |
|---|---|
| **WHAT** | Enterprise Data Platform — Unified BigQuery data warehouse connecting all departments, cross-functional dashboards, company-wide KPIs |
| **WHY** | **Strategic visibility:** Kent and Board can see all departments in one Looker Studio dashboard. Enables data-driven decision-making at company level. Eliminates departmental silos. |
| **WHEN** | Phase 1 (SCM): ✅ Done. Full integration: Q4 2026 (minimum 3 departments connected) |
| **WHO** | Khánh (architect), each department head (data owner), Kent (executive sponsor) |
| **WHERE** | BigQuery project: `boxwood-charmer-473204-k8` — single source of truth for all ISC |
| **HOW TO** | 1. Each department follows the proven pattern (GSheet → Apps Script → BigQuery). 2. Shared Core Library (`ISC_SCM_Core_Lib`) expanded to `ISC_Core_Lib` (company-wide). 3. Cross-department views for Executive Dashboard. 4. Looker Studio company-wide dashboard for Kent/Board. |
| **HOW MUCH** | **Infrastructure:** $50-80/month max (all departments on same BQ project). **People:** Khánh as sole developer (60-80 hours per department). **Total 18-month estimate:** ~$1,200 infrastructure + Khánh's labor = **~$120K savings/year** (extrapolating SCM savings of $768/month × 8 departments × efficiency factor 0.65). |

---

## 4. Replication Methodology: The ISC Digital Playbook

### 4.1 The 6-Step Department Onboarding Process

Every department follows the same proven playbook:

```
Step 1: DISCOVER (Week 1-2)
├── Interview department head + 2-3 key staff
├── Map current manual processes
├── Identify top 5 wastes (7-Waste framework)
└── Document in 5W-2H matrix

Step 2: DESIGN (Week 3-4)
├── Define ERD (entities, relationships)
├── Design Google Sheet UI (Zone A/B pattern)
├── Write stored procedures
└── Review with department head

Step 3: BUILD (Week 5-8)
├── Create BigQuery tables + SPs
├── Build Apps Script modules
├── Set up automated triggers
└── Configure email reports

Step 4: PILOT (Week 9-10)
├── Run with 1-2 users in parallel
├── Collect feedback daily
├── Fix bugs + adjust UI
└── Validate data accuracy

Step 5: LAUNCH (Week 11-12)
├── Full rollout to department
├── Training session (2 hours)
├── Kill old manual process
└── Monitor first 2 weeks closely

Step 6: OPTIMIZE (Ongoing)
├── Weekly check-in with department
├── Add features based on feedback
├── Report KPIs to Kent
└── Kaizen loop: identify next improvement
```

### 4.2 Why This Order (Priority Justification)

| Priority | Department | Justification |
|---|---|---|
| **P1** SCM ✅ | Supply Chain | Highest data complexity, most manual effort, direct impact on production. **Already done.** |
| **P2** Production | Factory | Natural extension — Production Orders already in M1, just need factory-floor tracking. **Shared data with SCM.** |
| **P3** QC | Quality Control | Quality data directly affects SCM (defects → rework → demand changes). **Strong feedback loop.** |
| **P4** Warehouse | Warehouse/Logistics | M4 Monday Protocol already touches warehouse. Extension, not new build. **Lowest incremental effort.** |
| **P5** Finance | Finance | PO/Invoice reconciliation leverages M3 PO data. **Highest ROI for finance.** |
| **P6** HR | Human Resources | Simpler requirements, lower data complexity. **Quick win for morale.** |
| **P7** Sales/CS | Sales & CS | CS Protocol (M1) already captures customer-facing data. **Natural extension.** |
| **P8** Maintenance | Maintenance | Can wait — ISC's equipment base may not justify urgency. **Lowest priority.** |

---

## 5. Tools & Platform Ecosystem for Each Level

### 5.1 Recommended Technology per Level

| Level | Platform | Tools | Why |
|---|---|---|---|
| **Individual** | Google Workspace | Sheets, Docs, Gmail, Calendar | Already deployed, zero learning curve |
| **Department** | Google Workspace + BigQuery | Apps Script, BigQuery, Looker Studio | Proven in SCM project, < $15/dept/month |
| **Company** | BigQuery + Looker Studio | Company-wide data warehouse, executive dashboards | Scalable, secure, cost-effective |

### 5.2 What NOT to Use (Kent's Risk Guardrails)

Based on the OpenClaw conversation, Khánh has established clear risk boundaries:

| ❌ Don't Use | Reason |
|---|---|
| OpenClaw / AI Agents | Security risk, immature, hidden costs |
| External SaaS (SAP, Oracle) | Overkill for ISC's scale, $50K-500K/year |
| Self-hosted servers | Infrastructure cost, maintenance burden |
| Python/R scripts on laptops | No governance, person-dependent |
| Unofficial automation tools | Shadow IT risk |

### 5.3 What TO Use (Approved Stack)

| ✅ Use | For What |
|---|---|
| **Google Sheets** | User interface, data entry, reporting |
| **Google Apps Script** | Automation logic, triggers, email |
| **BigQuery** | Data warehouse, stored procedures, analytics |
| **Looker Studio** | Dashboards for management/Kent |
| **Gmail (HTML)** | Automated reports, alerts, notifications |
| **Google Forms** | Simple data collection (surveys, feedback) |

---

## 6. The First Weekly Report: What to Include

### 6.1 Week 1 (March 14, 2026) — Recommended Content

Since this is the **first report**, it should establish the baseline:

| Section | Content |
|---|---|
| **Executive Summary** | "This is the first weekly digitalization report. SCM Database project is operational with 7/8 phases complete. This report introduces the 5W-2H framework for company-wide replication." |
| **SCM Status** | Phase 5 in progress (Assign Sourcing Dialog Redesign). System healthy — M2 nightly runs successful. |
| **5W-2H Matrix** | Attach as appendix — the full matrix from Section 3 above |
| **Kaizen Scoreboard** | Initial baseline: ~24 hours/week savings, ROI calculation |
| **Next Week Plan** | Complete Phase 5 sourcing dialog. Begin Production department discovery meeting. |

---

*Next: Part 3 discusses the format, platform, delivery mechanism (HTML email, Google Sheet, form, etc.) and the visual design of the report.*
