# Part 2: Weekly Report Content & Department Replication Plan

*Kent Weekly Report Analysis — V2 (Revised)*
*Date: 2026-03-13 | Replaces V1*

---

## 1. Weekly Report Structure — Three Horizons

Every Friday report covers three time horizons simultaneously:

| Horizon | Focus | Kent's Core Question |
|---|---|---|
| **This Week** | What was done, what was solved | Did we move forward? |
| **Next Week** | What is planned | Do we have direction? |
| **Strategic** | Roadmap progress, 5W-2H update | Are we on track at company level? |

---

## 2. The Five-Section Report Template

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🏭 ISC DIGITALIZATION WEEKLY REPORT
  [Week Number] | [Date Range] | By: Nguyễn Duy Khánh
  Overall Status: 🟢 On Track / 🟡 Attention Needed / 🔴 Blocked
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  SECTION 1: EXECUTIVE SUMMARY
  Two or three short bullets — the whole story at a glance.

  SECTION 2: SCM DATABASE — CURRENT STATUS
  What is working, what is being tested, what is next.

  SECTION 3: DIGITALIZATION ROADMAP — ALL DEPARTMENTS
  The big picture: where each department stands.

  SECTION 4: WASTE REDUCTION PROGRESS
  Honest, measurable improvements this week.

  SECTION 5: TOOLS & PLATFORMS BEING EXPLORED
  AI tools, new platforms, and low-cost solutions for ISC.

  APPENDIX: Next Week's Action Plan
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 2.1 Section 1: Executive Summary

**Rule: 3 bullets max, each one sentence only.** Kent scans this first — if this is good, he reads the rest; if not, the report has failed before Section 2.

**Writing formula:**
- Bullet 1: The most important win this week
- Bullet 2: The most important challenge or open question
- Bullet 3: One forward-looking signal (what to expect next week)

**This week's example:**
> - ✅ SCM Database is fully live and running nightly calculations — Ngàn's team is now in the active testing and calibration phase.
> - ⚠️ A calculation discrepancy between the system and the existing Lead Plan sheet is being investigated and expected to resolve within 2 weeks.
> - 🔭 Next: beginning the Master Plan (MPL) department assessment — the first step toward company-wide replication.

---

## 2.2 Section 2: SCM Database — Current Status

This is the **operational heartbeat** of the report. It must be honest and precise.

### Status at a Glance

| Item | Status | Details |
|---|---|---|
| System health | 🟢 Healthy | Nightly M2 run succeeds daily at 4 AM |
| Data accuracy | 🟡 Calibrating | BOM_TOLERANCE methodology being aligned with Ngàn's Lead Plan |
| Phase 5 | 🟡 In Progress | Assign Sourcing dialog redesign — aggregating VPO-level to BOM-level |
| Looker Dashboard | 🟢 Live | Available for Kent anytime: [link] |

### What "In Progress of Testing" Means (Plain Language)

The system calculates material shortages using two methods simultaneously. Right now:
- **Method 1 (Completion):** Based on how many finished goods are still needed
- **Method 2 (Issuance):** Based on how much material has already left the warehouse

The challenge is that Ngàn's team built their manual Lead Plan using ISC's own 10% tolerance standard, while the system currently uses the tolerance data provided by the customer (which varies per SKU). This creates differences in the numbers between the two. **Neither is wrong — they use different conventions.** The fix is to allow the system to support both conventions so users can compare and choose.

**Expected resolution:** 2 weeks (before end of March 2026).

### Phase Progress

```
Phase 1 — Dual-Method Shortage   ████████████████████ 100% ✅
Phase 2 — PIC Identity           ████████████████████ 100% ✅
Phase 3 — Issuance AutoSync      ████████████████████ 100% ✅
Phase 4 — PR Dual Columns        ████████████████████ 100% ✅
Phase 5 — Sourcing Dialog        █████████████░░░░░░░  65% 🟡 Active
Phase 6 — Analytics Email        ████████████████████ 100% ✅
Phase 7 — Auto-Switch Logic      ████████████████████ 100% ✅
Phase 8 — Looker Studio          ████████████████████ 100% ✅
```

---

## 2.3 Section 3: Digitalization Roadmap — All Departments

### The Roadmap Snapshot (Designed for Scanning)

```
ISC DIGITALIZATION ROADMAP — 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ SUPPLY CHAIN     ██████████████████░░ In Progress / Testing
🔵 MASTER PLAN      ░░░░░░░░░░░░░░░░░░░░ Assessment Q2 2026
🔵 CUSTOMER SERVICE ░░░░░░░░░░░░░░░░░░░░ Assessment Q3 2026
🔵 PRODUCTION       ░░░░░░░░░░░░░░░░░░░░ Build Q3 2026
⬜ QUALITY CONTROL  ░░░░░░░░░░░░░░░░░░░░ Q4 2026
⬜ WAREHOUSE        ░░░░░░░░░░░░░░░░░░░░ Q4 2026
⬜ FINANCE          ░░░░░░░░░░░░░░░░░░░░ Q1 2027
⬜ HR / ADMIN       ░░░░░░░░░░░░░░░░░░░░ Q1 2027
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Why This Order

**SC first:** Already live. The foundation and the proof of concept.

**MPL second:** Master Plan is the upstream of Supply Chain. MPL creates production schedules that SC reads as demand. Bringing MPL into the system would make SC demand data significantly more reliable — calculated automatically instead of manually fed in.

**CS third:** Customer Service is already integrated into SC's workflow via the CS Status Protocol (M1). CS sends production orders, updates dates and quantities, and receives delivery confirmations. Digitalizing CS closes the loop on the most common source of SC data discrepancies — manual handoffs.

**PRD fourth:** Production provides the real-time completion data that all three above (SC, MPL, CS) currently receive manually. Once the upstream departments are on the system, connecting the factory floor creates a fully closed-loop visibility chain.

**QC, Warehouse, Finance, HR after:** These have value but are less tightly coupled with the core SC system. They come after the primary loop is stable.

---

## 2.4 Section 4: Waste Reduction Progress

### Guiding Principle for This Section

This section uses Lean language because that is Kent's framework. However, all numbers reported here must be **genuinely measurable** or clearly described as estimates. The goal is honest progress, not impressive-sounding claims. A solo builder who overstates savings will be asked to justify them every week — that is unsustainable.

### What We Can Honestly Claim This Week

| Waste Type (Muda) | Before | After | Measurable Difference |
|---|---|---|---|
| **Waiting** — Nightly shortage data | Manual Excel calculation: available only when planner runs it | Automated 4 AM: available every morning | Planners start the day with fresh data instead of spending first 30–60 minutes calculating |
| **Over-processing** — Multi-file cross-referencing | 5+ separate Excel files compared daily | 1 Google Sheet pulling from 1 database | One source of truth for the team |
| **Motion** — Chasing status via email | Manually asking CS or warehouse for updates | Automated CS discrepancy detection, automated supplier feedback portal | Fewer status-chase emails — hard to quantify exactly, but team reports it |
| **Defects** — Manual calculation errors | Human formula errors in Excel | SP-validated calculations in BigQuery | Zero calculation errors in the automated pipeline (user input errors still possible) |

### What Remains to Be Solved

| Problem | Impact | Being Addressed In |
|---|---|---|
| BOM_TOLERANCE mismatch | Numbers differ from Ngàn's Lead Plan sheet | Phase 5 / active testing |
| VPO non-aggregation | Risk of over-purchasing per material | Phase 5 dialog redesign |
| Warehouse issuance attribution | Per-VPO issuance sometimes combined incorrectly | BOM-level aggregation design |

> **Note:** The above remaining problems do not break the system — they represent the calibration gap between a new digital system and a team's existing manual conventions. This kind of reconciliation period is normal and expected when replacing manual processes.

---

## 2.5 Section 5: Tools & Platforms Being Explored

### The Approved ISC Technology Framework

This is the **single most important strategic message** in the report for Kent. ISC's digitalization approach is deliberately built on a trustworthy, controlled, low-cost ecosystem:

```
┌─────────────────────────────────────────────────────────────┐
│               ISC APPROVED TECHNOLOGY STACK                  │
├─────────────────────┬───────────────────────────────────────┤
│ LAYER               │ TOOLS                                  │
├─────────────────────┼───────────────────────────────────────┤
│ User Interface      │ Google Sheets (all departments)        │
│ Logic & Automation  │ Google Apps Script                     │
│ Database            │ BigQuery (Google Cloud)                │
│ Dashboards          │ Looker Studio                          │
│ Email Reports       │ Gmail (HTML threads)                   │
│ AI Assistance       │ Google NotebookLM (free, secure)       │
│ Document AI         │ Google Gemini (Workspace integration)  │
│ Research            │ Claude / Gemini (analysis only, no BQ access) │
└─────────────────────┴───────────────────────────────────────┘
```

### AI Tools — The Safe, Practical Options for ISC

Following the OpenClaw assessment, these are the AI tools that are genuinely useful and safe to introduce at ISC:

#### 🏅 NotebookLM (Google) — Recommended for Immediate Use

> **Why this is particularly relevant:** NotebookLM was not in V1. This is an oversight that should be corrected. It is arguably the most immediately useful AI tool for ISC.

**What it is:** Google NotebookLM is a free AI notebook that reads your own documents and lets you ask questions, generate summaries, and create study materials — all based only on the content you upload. It does not use external data.

**Why it is safe:** Your documents stay in your Google account. NotebookLM only knows what you give it. There is no "feeding ISC data to a public AI" concern.

**Concrete applications for ISC:**

| Who | How to Use NotebookLM | What They Get |
|---|---|---|
| **Khánh** | Upload technical docs (ERD, SQL, analysis files) → Ask questions about the system | Faster cross-checking, faster documentation |
| **Ngàn / Planners** | Upload supplier catalogues, material specs → Ask "what is the lead time for this material class?" | No more manual searching through PDF files |
| **Kent** | Upload weekly reports (all 12 months) → Ask "what has improved most in the last 3 months?" | Instant synthesis of report history |
| **CS Team** | Upload customer PO documents → Ask "what are the delivery terms for this customer?" | Reduces manual PO reading time |
| **HR** | Upload training manuals → Generate quizzes, summaries, onboarding guides | Faster training material creation |

**Cost:** $0. Included in Google Workspace.

---

#### Google Gemini (Workspace) — Already Available

ISC uses Google Workspace, which now includes **Gemini AI** integrated into Docs, Sheets, and Gmail:

| Feature | Application at ISC |
|---|---|
| **"Help me write" in Gmail** | Draft professional email replies in English or Vietnamese faster |
| **"Summarize this email thread" in Gmail** | Quickly grasp long email chains with suppliers or customers |
| **"Generate formula" in Sheets** | Planners who struggle with complex Excel formulas can describe in plain language → Gemini writes the formula |
| **"Clean up" in Docs** | Instantly reformat or improve written reports |

**Cost:** Included in Google Workspace Business Standard. Check with IT if activated.

---

#### Claude / ChatGPT — Analysis and Planning Only

These are the AI models that wrote the analysis you are now reading. Their role at ISC:

| Appropriate Use | Not Appropriate |
|---|---|
| Analyzing text-based problems and documents | Feeding BigQuery credentials or live ISC data |
| Drafting reports, templates, proposals | Automated access to production systems |
| Researching best practices | Replacing the human review step |
| Writing Apps Script logic for review | Running autonomously without oversight |

**Cost:** Free (Claude/ChatGPT basic) or ~$20/month per user (Pro plans).

---

#### Google Apps Script + Triggers — The Automation Backbone

Everything Khánh has built so far uses this. It is worth naming it explicitly here because:
- It is already deployed
- It is the engine behind every automated report, every nightly run, every email
- It is what will power the Kent Weekly Report itself

**New users in non-SC departments** can use Apps Script for:
- Automated daily/weekly data summaries
- Auto-send email reminders for deadlines
- Form submission → notification pipelines

**Cost:** $0. Included in Google Workspace.

---

#### NotebookLM Audio Overview — An Unexpected Feature

One feature of NotebookLM that is worth highlighting: it can generate a **podcast-style audio summary** of any document. For Kent:
- Upload the weekly report → NotebookLM generates a 10-minute audio version
- Listen during commute or while reviewing factory

This is not a priority but is a genuinely useful feature that makes the weekly report more accessible.

---

## 3. The Full 5W-2H Matrix

### Level 1: Individual (Cá Nhân)

| | Answer |
|---|---|
| **WHAT** | Use existing Google Workspace more effectively: Gmail templates, Sheets formulas, NotebookLM for document Q&A, Gemini for writing assistance |
| **WHY** | Reduce time spent on repetitive writing, searching, and formatting tasks |
| **WHEN** | Now — no setup required beyond awareness and training |
| **WHO** | All employees; Khánh provides short guides and tips via email |
| **WHERE** | Each employee's existing Google account |
| **HOW TO** | 1. Share NotebookLM quick-start guide (1 page). 2. Monthly "1 tool, 1 use case" email tips. 3. Optional: 30-minute session per department. |
| **HOW MUCH** | $0. Time: 30 minutes per employee per month |

### Level 2: Department (Phòng Ban)

| Priority | Dept | WHAT | WHY | WHEN | HOW MUCH |
|---|---|---|---|---|---|
| 🟢 P1 | **SC** | Full MRP system — 4 modules, nightly automation | Eliminates manual shortage calculation, automates procurement request flow | Live / In Testing | ~$15/month |
| 🔵 P2 | **MPL** | Production scheduling database, capacity planning view, auto-sync with SC demand | MPL feeds the production schedule that SC uses for demand dates — integrating the two eliminates the manual scheduling handoff | Q2 2026 | ~$10/month |
| 🔵 P3 | **CS** | Formalize the CS ↔ SC data exchange: auto-detect quantity and date changes, close the discrepancy loop | CS is already partially digital via M1 CS Protocol — formalizing this reduces the biggest source of SC data errors | Q2–Q3 2026 | ~$10/month |
| 🔵 P4 | **PRD** | Real-time production progress dashboard, completion auto-sync to SC and CS | Production data is currently manually entered — automation turns this into a live factory visibility feed | Q3 2026 | ~$10/month |
| 🟡 P5 | **QC** | Digital inspection checklists, defect tracking, CAPA management | Defect data currently lives on paper or ad-hoc Excel — digitalization creates a feedback loop into material demand | Q4 2026 | ~$10/month |
| 🟡 P6 | **Warehouse** | Extend M4 (Monday Protocol) to real-time issuance tracking | Fixes the VPO issuance attribution problem at the source | Q4 2026 | ~$5/month |
| 🟢 P7 | **Finance** | PO-Invoice reconciliation, cost variance analysis | M3 PO data is already in BigQuery — connecting invoices creates automated reconciliation | Q1 2027 | ~$10/month |
| 🟢 P8 | **HR** | Attendance tracking, training records, monthly KPI summary | Simpler needs, high visibility for employees | Q1 2027 | ~$5/month |

### Level 3: Company (Toàn Công Ty)

| | Answer |
|---|---|
| **WHAT** | A unified ISC data platform on BigQuery — all departments connected, one executive Looker Studio dashboard for Kent |
| **WHY** | Eliminate data silos. Today SC, MPL, CS, and PRD each have their own data in different formats. When all are on the same platform, cross-department analysis becomes instant |
| **WHEN** | The foundation exists now (SC is live). Full company integration: Q4 2026 when at least 3 departments are connected |
| **WHO** | Khánh (architect), each department head (data owner), Kent (executive sponsor) |
| **WHERE** | BigQuery project `boxwood-charmer-473204-k8` — already paid for, SC data already there |
| **HOW TO** | 1. Each department follows the same pattern: GSheet → Apps Script → BigQuery. 2. Shared Core Library (`ISC_SCM_Core_Lib`) expanded company-wide. 3. Cross-department views for Kent's Executive Dashboard. |
| **HOW MUCH** | Infrastructure: ~$50/month max (all departments on same BQ project). Solo developer: Khánh (no external hiring needed). |

---

## 4. The 6-Step Department Onboarding Playbook

Every department follows the same proven process:

```
Week 1–2   DISCOVER
           Interview department head + 2 key staff.
           Map top 5 manual/repetitive processes.
           Identify which of the 7 wastes apply.
           Document in 5W-2H worksheet.

Week 3–4   DESIGN
           Define what data gets stored (ERD sketch).
           Design the Google Sheet UI (Zone A/B pattern).
           Review draft with department head.

Week 5–8   BUILD
           Create BigQuery tables and stored procedures.
           Build Apps Script modules.
           Set up automated triggers and email reports.

Week 9–10  PILOT
           Run with 1–2 users alongside existing method.
           Collect feedback daily. Fix and adjust.

Week 11–12 LAUNCH
           Roll out to full team. 2-hour training session.
           Old manual process continues temporarily as backup.

Ongoing    OPTIMIZE
           Weekly check-in. Kaizen loop.
           Report KPIs to Kent each Friday.
```

---

*Next: Part 3 covers delivery format — Rich HTML email, Google Sheet, how to automate the report itself, and the strategy for testing via dk@isconline.vn before sending to Kent.*
