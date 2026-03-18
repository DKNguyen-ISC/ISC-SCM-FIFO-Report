# Part 3: Delivery Format, Platform & Visual Design

*Kent Weekly Report Analysis — V1*
*Date: 2026-03-13*

---

## 1. Platform Options: Comprehensive Comparison

### 1.1 Evaluation Matrix

Kent said: *"Chú thảo form tổng hợp báo cáo"* — Draft the report template. The report format must be:
- **Easy for Kent to consume** (Director-level, time-limited)
- **Easy for Khánh to produce** (minimal manual effort weekly)
- **Automated where possible** (leverage existing infrastructure)
- **Professional & visually appealing** (represents ISC's digital maturity)

| Platform | Kent Experience | Khánh Effort | Automation | Professionalism | Verdict |
|---|---|---|---|---|---|
| ✉️ **Rich HTML Email** | ⭐⭐⭐⭐⭐ Arrives in inbox, no clicks | ⭐⭐⭐⭐ Template-driven | ⭐⭐⭐⭐⭐ Apps Script sends | ⭐⭐⭐⭐ Mobile-first, branded | ✅ **PRIMARY** |
| 📊 **Google Sheets** | ⭐⭐⭐ Must click link, navigate | ⭐⭐⭐⭐ Easy to update | ⭐⭐⭐ Partial automation | ⭐⭐⭐ Tabular, less visual | 🟡 SECONDARY |
| 📄 **Google Docs** | ⭐⭐⭐⭐ Readable like Word | ⭐⭐⭐ Manual formatting | ⭐⭐ Hard to automate | ⭐⭐⭐⭐ Good for narratives | ❌ LOW |
| 📋 **Google Forms** | ⭐ Not for reporting output | ⭐ Wrong tool | ⭐⭐⭐ Auto-generated | ⭐ Not professional | ❌ WRONG FIT |
| 📈 **Looker Studio** | ⭐⭐⭐⭐⭐ Beautiful dashboards | ⭐⭐⭐⭐⭐ Auto-refreshes | ⭐⭐⭐⭐⭐ Fully automated | ⭐⭐⭐⭐⭐ Executive-grade | ✅ **COMPANION** |
| 🌐 **Webpage/Sites** | ⭐⭐⭐ Extra click needed | ⭐⭐ Custom development | ⭐⭐⭐ Possible but complex | ⭐⭐⭐⭐ Modern look | ❌ OVERKILL |
| 📑 **PowerPoint/Slides** | ⭐⭐⭐⭐ Familiar format | ⭐⭐ Very manual | ⭐ Cannot automate | ⭐⭐⭐⭐⭐ Best for presentations | ❌ FOR MEETINGS, NOT WEEKLY |

---

## 2. Recommended Solution: Dual-Channel Approach

### 2.1 The Architecture

```
                         ┌──────────────────────────┐
                         │   BigQuery Data Source    │
                         │   (M2_Daily_Stats,        │
                         │    M2_Pipeline_Ledger,     │
                         │    System_Execution_Log)   │
                         └──────────┬───────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
              ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐
              │ Channel 1 │  │ Channel 2 │  │ Channel 3 │
              │ HTML Email │  │  Looker   │  │  Google   │
              │ (Primary)  │  │  Studio   │  │  Sheets   │
              │ Every Fri  │  │ (Live)    │  │ (Archive) │
              └─────┬─────┘  └─────┬─────┘  └─────┬─────┘
                    │               │               │
                    │          ┌────▼────┐          │
                    └──────────► Kent H  ◄──────────┘
                               └─────────┘
```

### 2.2 Channel Roles

| Channel | Role | Frequency | Effort |
|---|---|---|---|
| **📧 Rich HTML Email** | Push report to Kent's inbox — no action required from him | Every Friday 4 PM | 10 min (review + send) |
| **📊 Looker Studio** | Live dashboard Kent can visit anytime for real-time data | Always available | 0 (auto-refreshes) |
| **📋 Google Sheet** | Historical archive of all weekly reports + 5W-2H matrix | Updated weekly | 5 min (append row) |

---

## 3. Channel 1: Rich HTML Email (The Primary Report)

### 3.1 Why Email Is the Best Primary Channel

| Factor | Reasoning |
|---|---|
| **Zero friction for Kent** | Arrives in inbox. No links to click, no apps to open. |
| **Already proven** | M2 nightly email (with rich HTML) is already running in production. |
| **Mobile-friendly** | Kent can read on phone during meetings. |
| **Search & archive** | Gmail search by label `ISC_Weekly_Report` → instant history. |
| **Threading** | Monthly Gmail threads → organized communication. |

### 3.2 Email Design Specification

#### Header & Branding

```html
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🏭 ISC WEEKLY DIGITALIZATION REPORT                        ║
║   Week 11 | March 10-14, 2026                                ║
║   Prepared by: Nguyễn Duy Khánh                              ║
║                                                              ║
║   📊 Status: 🟢 On Track                                     ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

#### Section 1: Executive Dashboard (Visual KPI Cards)

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  📦 Shortage │  │  🎯 Coverage │  │  ⚡ Savings  │
│    Count     │  │    Rate      │  │   This Week  │
│              │  │              │  │              │
│    127       │  │    96.3%     │  │   24 hrs     │
│   (-12 WoW)  │  │  (+2.1% WoW) │  │   ($192)     │
│   ▼ 📉      │  │   ▲ 📈      │  │   = 📈       │
└──────────────┘  └──────────────┘  └──────────────┘
```

#### Section 2: Phase Progress (Visual Progress Bars)

```
SCM DATABASE − Progress Overview
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Phase 1-4: ████████████████████ 100% ✅ Backbone
Phase 5:   ████████████░░░░░░░  65% 🟡 Sourcing Dialog
Phase 6-8: ████████████████████ 100% ✅ Analytics & Dashboard
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Overall:   ████████████████░░░  91% 🟢 
```

#### Section 3: This Week's Achievements (Bullet List)

```
✅ Completed
 • Deployed auto-switch logic for Chì materials (Phase 7)
 • Fixed M4 Lead Issuance merge discrepancy (±0 variance)
 • Generated first Looker Studio executive dashboard

⚠️ In Progress
 • Assign Sourcing dialog redesign (Phase 5) — 65% complete
 • Warehouse team training materials preparation

🚫 Blockers
 • None this week
```

#### Section 4: Replication Roadmap Snapshot

```
ISC DEPARTMENT DIGITALIZATION ROADMAP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Supply Chain  ████████████████████ LIVE
🟡 Production    ██░░░░░░░░░░░░░░░░░ Discovery
⬜ QC            ░░░░░░░░░░░░░░░░░░░ Q3 2026
⬜ Warehouse     ░░░░░░░░░░░░░░░░░░░ Q3 2026
⬜ Finance       ░░░░░░░░░░░░░░░░░░░ Q4 2026
⬜ HR            ░░░░░░░░░░░░░░░░░░░ Q1 2027
⬜ Sales/CS      ░░░░░░░░░░░░░░░░░░░ Q1 2027
⬜ Maintenance   ░░░░░░░░░░░░░░░░░░░ Q2 2027
```

#### Section 5: Next Week Plan

```
📋 PLAN FOR WEEK 12 (Mar 17-21, 2026)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Complete Assign Sourcing dialog (Phase 5) → Target: 100%
2. Begin Production department discovery meeting
3. Draft QC assessment questionnaire
```

#### Footer

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Live Dashboard: [Looker Studio Link]
📁 Full Archive: [Google Sheet Link]
📧 Contact: dk@isconline.vn
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ISC Digital Transformation Office
Powered by Google Cloud (BigQuery + Apps Script)
```

### 3.3 Technical Implementation

The email can be **fully automated** using the existing M2 email architecture:

```javascript
// Kent_Weekly_Report.gs — Skeleton

function sendKentWeeklyReport() {
  // 1. Query BigQuery for this week's KPIs
  const kpis = getWeeklyKPIs();        // M2_Daily_Stats + M2_Pipeline_Ledger
  const phaseStatus = getPhaseStatus(); // Manual input or from task tracker
  
  // 2. Build HTML email from template
  const html = buildKentReportHTML(kpis, phaseStatus);
  
  // 3. Send with threading (monthly thread)
  const subject = `[ISC Weekly] 🟢 Digitalization Report — Week ${getWeekNumber()}, ${getYear()}`;
  const monthThread = `ISC_Weekly_Report_${getYearMonth()}`;
  
  GmailApp.sendEmail(
    'kent@isconline.vn',  // Kent's email
    subject,
    '',                    // Plain text fallback
    {
      htmlBody: html,
      name: 'ISC Digital Transformation',
      replyTo: 'dk@isconline.vn'
    }
  );
  
  // 4. Apply Gmail label for archiving
  applyLabel_('ISC_Weekly_Report');
}

// Trigger: Every Friday at 3:50 PM (10 min buffer before 4 PM deadline)
function setupWeeklyTrigger() {
  ScriptApp.newTrigger('sendKentWeeklyReport')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.FRIDAY)
    .atHour(15)
    .nearMinute(50)
    .create();
}
```

### 3.4 Data Sources for Automated KPIs

| KPI | BigQuery Source | Query |
|---|---|---|
| Shortage Count | `M2_Daily_Stats` | `SELECT TOTAL_SHORTAGE_COUNT WHERE RUN_DATE = CURRENT_DATE - 1` |
| Coverage Rate | `M2_Pipeline_Ledger` | `SELECT ROUND(SUM(SUPPLY_ALLOCATED_QTY) / NULLIF(SUM(GROSS_DEMAND_QTY),0) * 100, 1)` |
| System Uptime | `System_Execution_Log` | `SELECT COUNTIF(STATUS = 'Success') / COUNT(*) * 100` |
| Method Delta | `M2_Daily_Stats` | `SELECT METHOD_DELTA_COUNT WHERE RUN_DATE = CURRENT_DATE - 1` |
| Anomaly Flag | `M2_Daily_Stats` | `SELECT IS_ANOMALY, ANOMALY_REASON WHERE RUN_DATE = CURRENT_DATE - 1` |
| Week-over-Week | `M2_Daily_Stats` | `SELECT ... FROM last 14 days GROUP BY week` |

---

## 4. Channel 2: Looker Studio Dashboard (The Live Companion)

### 4.1 Dashboard Layout

The Looker Studio dashboard serves as the **"anytime" view** Kent can access:

```
┌─────────────────────────────────────────────────────────────┐
│                 ISC DIGITAL TRANSFORMATION                    │
│                    EXECUTIVE DASHBOARD                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│  │ Total Depts │ │ Processes   │ │ Monthly     │            │
│  │ Digitalized │ │ Automated   │ │ Savings     │            │
│  │    1 / 8    │ │    45+      │ │   $768      │            │
│  └─────────────┘ └─────────────┘ └─────────────┘            │
│                                                               │
│  ┌─────────────────────────────────────────────┐             │
│  │          Shortage Trend (30 days)           │             │
│  │  📈 Line chart: Daily shortage count        │             │
│  └─────────────────────────────────────────────┘             │
│                                                               │
│  ┌─────────────────────┐ ┌─────────────────────┐             │
│  │ Coverage Rate Gauge │ │ Phase Progress      │             │
│  │     🎯 96.3%        │ │ ████████████████░░░ │             │
│  └─────────────────────┘ └─────────────────────┘             │
│                                                               │
│  ┌─────────────────────────────────────────────┐             │
│  │    Department Replication Timeline          │             │
│  │  Gantt chart: Q2-Q4 2026 + Q1-Q2 2027     │             │
│  └─────────────────────────────────────────────┘             │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Advantages Over Email

| Feature | Email | Looker Studio |
|---|---|---|
| Data freshness | Snapshot (weekly) | Live (auto-refresh) |
| Interactivity | None | Filters, drill-down |
| Trending | 7-day static | 30/60/90 day dynamic |
| Sharing | Forward email | Share link |

---

## 5. Channel 3: Google Sheet Archive (The Historical Record)

### 5.1 Structure: Weekly Report Log Sheet

A Google Sheet serves as the **permanent record** of all weekly reports:

| Week | Date | Phase Progress | Shortage Count | Coverage % | Savings (hrs) | Dept Status | Key Achievement | Key Issue | Next Action |
|---|---|---|---|---|---|---|---|---|---|
| W11 | 2026-03-14 | 91% | 127 | 96.3% | 24 | SCM: Live, Prod: Discovery | Phase 7 deployed | None | Phase 5 completion |
| W12 | 2026-03-21 | 93% | 115 | 97.0% | 24 | SCM: Live, Prod: Design | Phase 5 complete | QC scheduling | Production ERD |

### 5.2 5W-2H Master Sheet (Separate Tab)

A dedicated tab maintains the **living 5W-2H matrix** that Kent requested — updated whenever a new department is assessed.

---

## 6. Email Design: Visual Style Guide

### 6.1 Color Palette (ISC Brand)

| Element | Color | Hex | Usage |
|---|---|---|---|
| Header background | ISC Blue | `#1a365d` | Report header strip |
| Success/On Track | Green | `#38a169` | ✅ KPIs, completed items |
| Warning/In Progress | Amber | `#d69e2e` | ⚠️ In-progress items |
| Alert/Blocker | Red | `#e53e3e` | 🚫 Blockers, critical issues |
| Body text | Dark grey | `#2d3748` | Main content |
| Accent/links | Teal | `#2b6cb0` | Links, interactive elements |
| Background | Light grey | `#f7fafc` | Email body background |

### 6.2 Typography

| Element | Font | Size | Weight |
|---|---|---|---|
| Report Title | Arial/Helvetica | 24px | Bold |
| Section Headers | Arial/Helvetica | 18px | Bold |
| Body Text | Arial/Helvetica | 14px | Regular |
| KPI Numbers | Arial/Helvetica | 32px | Bold |
| Footnotes | Arial/Helvetica | 12px | Light, grey |

### 6.3 Mobile Responsiveness

Since Kent may read on mobile:
- **Single-column layout** for < 600px screens
- **KPI cards stack vertically** on mobile
- **Progress bars use full width**
- **Font size minimum 14px** for readability
- **CTA buttons minimum 44px touch target**

---

## 7. Gmail Organization Strategy

### 7.1 Labeling System

```
ISC_Reports/
├── Weekly_Report/          ← Kent's weekly emails
│   ├── 2026-03/            ← Monthly threads
│   ├── 2026-04/
│   └── ...
├── M2_Nightly/             ← Existing M2 system emails
├── System_Alerts/          ← Critical system notifications
└── Maintenance/            ← Monthly cleanup notifications
```

### 7.2 Threading Strategy

| Report Type | Thread Subject Pattern | Thread Duration |
|---|---|---|
| Weekly Report | `[ISC Weekly] Digitalization Report — {Month} {Year}` | Monthly (4-5 emails/thread) |
| M2 Nightly | `[ISC M2] {Status} — {Date}` | Monthly (30 emails/thread) |
| Critical Alert | `[ISC ALERT] {Topic} — {Date}` | Per-incident |

---

## 8. Implementation Roadmap for Report System

### 8.1 Phase 1: Manual Template (Week 1-2)

| Step | What | Tool |
|---|---|---|
| 1 | Create HTML email template | Apps Script |
| 2 | Create Google Sheet archive | Google Sheets |
| 3 | Manually query BQ for KPIs | BQ Console / Apps Script |
| 4 | Manually compose email content | Khánh writes |
| 5 | Send first report | Gmail |

### 8.2 Phase 2: Semi-Automated (Week 3-4)

| Step | What | Tool |
|---|---|---|
| 1 | Automate KPI extraction from BQ | Apps Script function |
| 2 | Auto-populate email template with KPIs | Template engine |
| 3 | Khánh reviews + adds narrative | Manual |
| 4 | One-click send | Apps Script button |

### 8.3 Phase 3: Fully Automated (Week 5+)

| Step | What | Tool |
|---|---|---|
| 1 | Time-driven trigger (Friday 3:50 PM) | Apps Script Trigger |
| 2 | Auto-query all KPIs | BigQuery |
| 3 | Auto-generate full HTML email | Template engine |
| 4 | Auto-detect anomalies/blockers | SQL logic |
| 5 | Auto-send to Kent | GmailApp |
| 6 | Auto-archive to Google Sheet | Apps Script |
| 7 | Khánh only intervenes for narrative sections | Manual override |

---

## 9. Decision Summary

### 9.1 Final Recommendation

| Decision | Choice | Rationale |
|---|---|---|
| **Primary delivery** | Rich HTML Email | Zero friction for Kent, proven infrastructure, automated |
| **Live companion** | Looker Studio Dashboard | Always-available, interactive, executive-grade |
| **Historical archive** | Google Sheet | Permanent record, easy to query, 5W-2H living document |
| **Email frequency** | Every Friday, 3:50 PM (auto) | 10 min buffer before Kent's 4 PM deadline |
| **Email threading** | Monthly threads | 4-5 emails per thread, clean Gmail organization |
| **Gmail label** | `ISC_Weekly_Report` | Consistent with existing `ISC_Logs` pattern |
| **Automation level** | Start manual → semi-auto (Week 3) → full auto (Week 5) | Progressive confidence building |

### 9.2 Effort Estimate

| Phase | Khánh's Weekly Effort | Automation Level |
|---|---|---|
| **Week 1-2** (Manual) | ~2 hours/week | 20% automated |
| **Week 3-4** (Semi-auto) | ~45 minutes/week | 60% automated |
| **Week 5+** (Full auto) | ~15 minutes/week (review + narrative) | 90% automated |

### 9.3 What Kent Receives

Every Friday before 4 PM, Kent gets:

1. **📧 Email in inbox** — Rich HTML with KPI cards, progress bars, achievements, next steps
2. **📊 Link to live dashboard** — Embedded in email footer, always current
3. **📋 Link to archive sheet** — Full history + 5W-2H matrix

**No apps to install. No passwords to remember. No extra clicks. Just open Gmail.**

---

## 10. Appendix: Sample First Email Subject Line

```
[ISC Weekly] 🟢 Digitalization Report — Week 11, March 2026
```

Body preview in Gmail:
```
📊 SCM Database: 91% complete | 🎯 Coverage: 96.3% | ⚡ 24 hrs saved/week | 👷 Next: Production dept discovery...
```

---

*End of Part 3 — Delivery Format Analysis*
*Together with Part 1 (Understanding) and Part 2 (Content), this forms the complete Kent Report Analysis.*
