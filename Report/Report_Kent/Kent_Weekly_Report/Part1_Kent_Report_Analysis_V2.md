# Part 1: Understanding Kent's Requirements & Project Insights

*Kent Weekly Report Analysis — V2 (Revised)*
*Date: 2026-03-13 | Replaces V1*

---

## 1. Context Summary: The Conversation with Kent

### 1.1 The OpenClaw Trigger

Kent shared a VnExpress article about **OpenClaw** — an open-source AI agent platform praised by Nvidia CEO Jensen Huang as "the most important software ever." Kent asked Khánh to evaluate it for ISC.

**Khánh's Assessment — 3 Key Risks:**

| # | Risk | Core Issue |
|---|---|---|
| 1 | **Data Security** | Granting deep system access to a new automation tool with no enterprise security guarantee = a data leak waiting to happen |
| 2 | **Dedicated Hardware Needed** | Requires isolated (air-gapped) servers — cannot run on regular office PCs |
| 3 | **Hidden API Costs** | OpenClaw itself is free, but it needs an LLM "brain" (GPT-4/Claude = expensive 24/7 billing; Llama/Mistral = insufficient for business logic) |

**Conclusion:** OpenClaw is unsuitable for ISC now. Observe only until enterprise-grade security is available.

### 1.2 Kent's Strategic Pivot

Kent's response shifted the conversation from a specific tool to the broader strategy:

> *"Vậy giá trị sử dụng cho cá nhân, cho từng bộ phận để Kaizen, 5S, 7-wastes, tăng hiệu suất?"*

This is not a question about OpenClaw — it is a **Lean Manufacturing question**: how can technology reduce waste at every level of the organization? Kent thinks in:
- **Kaizen** (Continuous Improvement)
- **5S** (Workplace Organization)
- **7 Wastes / Muda** (Eliminate non-value-adding activities)

### 1.3 Khánh's Counter-Proposal: Structured Data Automation

Khánh redirected to what is already proven to work at ISC: **the ISC SCM Database** — a structured, controlled data automation system that eliminates manual processes without the risks of open AI agents.

The key examples given:
- **Automated Shortage Calculation:** `Demand - Stock + On-the-way POs` → eliminates daily Excel cross-referencing
- **Automated Email Reports:** Results sent directly to Purchasing team on schedule → eliminates manual chasing

### 1.4 Kent's Four Clear Directives

| # | Directive | My Understanding |
|---|---|---|
| 1 | **5W-2H Solution Matrix** | Comprehensive framework covering WHAT, WHY, WHEN, WHO, WHERE, HOW TO, HOW MUCH — across 3 levels: Individual, Department, Company |
| 2 | **Draft the Report Template First** | Form before content — design the structure, then populate it |
| 3 | **Clear Roadmap per ISC Department** | A digitalization plan covering every department at ISC, not just Supply Chain |
| 4 | **Weekly Report — Friday, 4 PM** | Consistent cadence sent to his email |

---

## 2. Honest Assessment of the ISC SCM Project — Where We Really Are

### 2.1 What Has Been Built

The Supply Chain Database is a **serious, production-architected system** with 4 modules, 8 phases, and real users. This is not a prototype or a student project.

```
MODULE 1: PLANNING          │  MODULE 2: BALANCING
─━─━─━─━─━─━─━─━─━─━─━─━─  │  ─━─━─━─━─━─━─━─━─━─━─━─━─
Production Order Management │  Nightly MRP Engine (4 AM)
BOM Data Mastering          │  FIFO Supply Matching (ATP)
Self-Healing Loop           │  Dual-Method Shortage Calc
CS Status Sync              │  Pipeline Ledger Analytics
Cancel Protocol             │  Automated HTML Email Report
────────────────────────────┼────────────────────────────
MODULE 3: PROCUREMENT       │  MODULE 4: EXECUTION
─━─━─━─━─━─━─━─━─━─━─━─━─  │  ─━─━─━─━─━─━─━─━─━─━─━─━─
Supplier Master Data        │  Monday Stock Protocol
PR → PO Consolidation       │  PO Tracking & Supplier Hub
Split-Brain Firewall        │  ZXH PO Auto-Sync
Direct Injection Portal     │  Lead Issuance AutoSync
Sourcing Intelligence View  │  Inventory Variance Analysis
```

**Technology stack:** Google Sheets (UI) + Google Apps Script (logic) + BigQuery (database + stored procedures) + Looker Studio (dashboards). Running cost: approximately $10–15/month.

### 2.2 The Honest Phase Status

| Phase | Delivered | Status |
|---|---|---|
| Phase 1 | Dual-Method Shortage + Schema + Pipeline Ledger | ✅ Complete |
| Phase 2 | PIC Identity Resolution | ✅ Complete |
| Phase 3 | Material Issuance AutoSync | ✅ Complete |
| Phase 4 | Dual columns in PR_Draft + Sourcing_Feed_VIEW | ✅ Complete |
| **Phase 5** | **Assign Sourcing Dialog Redesign** | **🟡 In Progress** |
| Phase 6 | M2 Daily Stats + Analytics Email | ✅ Complete |
| Phase 7 | Auto-switch logic (Completion ↔ Issuance) | ✅ Complete |
| Phase 8 | Looker Studio Dashboard | ✅ Complete |

7 of 8 phases technically complete. **The system is live and processing real data every day.**

### 2.3 The Obstacles — What's Being Tested Right Now

This is where the honest reporting matters. Based on the **`Assign_Sourcing_Analysis`** folder (active testing by Ngàn's team), the system is facing three real obstacles that must be reported to Kent truthfully:

#### Obstacle 1: BOM_TOLERANCE Mismatch (Calculation Discrepancy)

| Factor | System Calculation | Ngàn's Lead Plan Sheet |
|---|---|---|
| **Tolerance Source** | CS-provided per SKU (varies: 3%–15%+) | ISC internal fixed rate: 10% |
| **Origin** | China HQ design spec → CS → M1 ingestion | ISC operational convention |
| **Effect** | Some materials demand higher than Lead Plan; some demand lower | Stable, predictable calculation |

**Impact:** Shortage numbers in the database do not perfectly match Ngàn's manual Excel-based Lead Plan. Both are technically "correct" — they just use different tolerance conventions. This needs resolution before users can fully trust the system.

#### Obstacle 2: VPO Non-Aggregation (Over-Purchasing Risk)

The current Assign_Sourcing session shows one row **per VPO per material**, which causes the MOQ/SPQ ceiling to be applied separately per VPO instead of across all VPOs combined.

Real example from the data:
```
Current (per-VPO):
  BOM 302023503 | VPO V2601015C01 → shortage 14 → order CEILING(14, 600) = 600
  BOM 302023503 | VPO V2512007C06 → shortage 531 → order CEILING(531, 600) = 600
  Total ordered: 1,200 units

Correct (aggregated):
  BOM 302023503 | All VPOs → shortage 545 → order CEILING(545, 600) = 600
  Total ordered: 600 units

  Over-purchase prevented: 600 units per material
```

This is a UX and architecture issue currently being investigated in Phase 5.

#### Obstacle 3: Warehouse Issuance Attribution (Data Quality)

Warehouse staff enter material issuance against VPOs in the "5. Link Lead plan" sheet. Observed pattern: when the same material is issued for multiple VPOs on the same day, staff often enter the combined total against one VPO instead of splitting correctly. The BOM-level total is correct, but per-VPO attribution is sometimes wrong.

**Current status:** Raised with SC Manager Nam. Phong instructed warehouse team. Behavioral change is slow — systemic solution being designed (BOM-level aggregation removes the dependency on per-VPO accuracy).

**Summary for Kent:** The system is live, running, and generating real value. These obstacles are being actively worked and are expected to be resolved in the next 2–4 weeks. They do not break the system — they are accuracy improvement items.

---

## 3. Understanding Kent's Mindset

### 3.1 Kent Thinks at Company Level

Evidence from his messages:
- *"Lộ trình rõ ràng cho phòng ban nào của ISC"* = Which ISC department gets digitalized next, and when
- *"cấp độ (1) cá nhân, (2) phòng ban, (3) Cty"* = He wants 3 levels covered simultaneously
- *"Chú thảo form tổng hợp báo cáo"* = Design the form first, populate second

This is strategic thinking, not operational. Kent is not asking "how many shortages today?" — he is asking "what is our enterprise digitalization roadmap?"

### 3.2 The 5W-2H Framework Is His Business Language

Kent uses **5W-2H** because it is the standard Lean/ISO project justification format. This is likely what he uses when presenting upward to the Board or laterally to other Directors:

| Question | What Kent Needs |
|---|---|
| **WHAT** | What digitalization initiatives can be done? |
| **WHY** | What waste/pain does each solve? (Kaizen language) |
| **WHEN** | Start date and expected value delivery date |
| **WHO** | Who owns it, who benefits, who builds it |
| **WHERE** | Which department, which process |
| **HOW TO** | Implementation approach and tools |
| **HOW MUCH** | Money and time cost |

### 3.3 The Weekly Report Is a Management Control Mechanism

By fixing a Friday 4PM deadline, Kent is:
1. **Establishing accountability** — digital transformation is now officially tracked
2. **Building a paper trail** — email threads become the ISC digitalization record
3. **Enabling course correction** — weekly check-ins so he can redirect priorities quickly
4. **Creating the company's digital transformation story** — cumulative reports over months tell the ISC journey

---

## 4. The Real Department Priority Order for ISC

### 4.1 Correction from V1

V1 proposed SC → Production → QC → Warehouse → Finance. This was based on general logic, not ISC's specific organizational reality. After reviewing the project context and cross-checking:

**The correct priority order for ISC digitalization is:**

| Priority | Department | Rationale |
|---|---|---|
| ✅ **P1** | **Supply Chain (SC)** | Already live, in testing. The foundation. |
| 🔵 **P2** | **Master Plan (MPL)** | Directly shares material data with SC. MPL handles capacity planning, production scheduling, and material allocation — the natural upstream of SC's demand engine. Bringing MPL into the system would make SC's demand data significantly more accurate. |
| 🔵 **P3** | **Customer Service (CS)** | CS is already deeply embedded in the SC system — M1 receives production order status, CS date changes, and quantity adjustments FROM the CS team. The CS Status Protocol (M1) already handles discrepancy detection between CS and system data. Formalizing CS digitalization would close this loop cleanly. |
| 🔵 **P4** | **Production (PRD)** | Production provides real-time completion data that feeds SC (M1 Production Status Protocol), MPL (scheduling), and CS (delivery confirmation). Once SC, MPL, and CS are digitalized, Production becomes the final piece for real-time factory-floor integration. |
| 🟡 **P5** | **Quality Control (QC)** | Important but less integrated with current system. Defect data eventually feeds back into material demand calculations. |
| 🟡 **P6** | **Warehouse/Logistics** | M4 Monday Protocol already touches warehouse data. Extension rather than new build. |
| 🟢 **P7** | **Finance/Accounting** | M3 PO/Invoice data is the bridge. High ROI once procurement data is clean. |
| 🟢 **P8** | **HR/Admin** | Simpler requirements, lower interdependency. |
| 🟢 **P9** | **Sales/CS External** | External-facing portal; can leverage CS work in P3. |
| ⚪ **P10** | **Maintenance** | Lowest interdependency. |

### 4.2 Why MPL and CS Before Production

**MPL (Master Plan)** comes second because:
- MPL determines production schedules → SC uses these as the source of demand dates
- MPL allocates resources across multiple production lines → needs to see SC shortage data
- Without MPL digitalization, SC is working with manually-fed scheduling data

**CS (Customer Service)** comes third because:
- CS sends Production Orders → already feeds M1
- CS updates dates and quantities → M1 CS Status Protocol handles discrepancies
- CS receives delivery confirmations → closes the order lifecycle loop
- Digitalizing CS = eliminating the manual handoff that causes most M1 CS discrepancies

**Production (PRD)** comes fourth because:
- Production sends completion data → M1 Production Status Protocol (PSP) already handles this
- But PRD real-time data would make M1 completion tracking automatic instead of manual
- SC, MPL, CS all benefit from PRD real-time visibility

---

## 5. Summary: What Part 1 Establishes

| Insight | How It Colors the Weekly Report |
|---|---|
| SC is **live but in testing** with real active obstacles | Report must be candid — "we're solving X problem now" |
| Kent thinks in **Lean/5W-2H** | Every section needs Kaizen language |
| Department order is **MPL → CS → PRD → others** | Roadmap must reflect organizational reality |
| System is **Google Cloud only** (no exotic tools) | Trusted, auditable, ISC-controlled |
| Kent wants **company-wide** scope | SC is the proof of concept, not the endpoint |
| Khánh is a **solo builder** | Numbers and claims must be realistic and defensible each week |

---

*Next: Part 2 covers the report content structure and the 5W-2H matrix.*
