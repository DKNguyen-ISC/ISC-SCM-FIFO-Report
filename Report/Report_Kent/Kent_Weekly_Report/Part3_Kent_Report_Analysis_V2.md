# Part 3: Delivery Format, Platform & Automation Setup

*Kent Weekly Report Analysis — V2 (Revised)*
*Date: 2026-03-13 | Replaces V1*

---

## 1. My Honest Opinion on Your Proposed Strategy

You asked for my most honest opinion on this:

> *"The thing is how can we get the information update for each weekly report while we automate the process with Appsscript trigger. Before the trigger event happens, we will use Antigravity to push updates into the designated Appscript and Google Sheet. By doing this, Appscript can help us on writing a very good Google Sheet report instead of me manually typing, Appscript can also send me an email to review. Antigravity can help me push new updates of what I am doing on my project."*

**My honest assessment: This is a smart, well-reasoned approach.** Here is why it works and where the one risk is.

### Why This Works

The strategy creates a clean separation of concerns:

| Role | Tool | Action |
|---|---|---|
| **Information source** | Antigravity + you | Push weekly updates into a designated cell range in the Google Sheet |
| **Report builder** | Apps Script | Reads those cells, formats them into a rich HTML email and appends a row to the Sheet |
| **Review gate** | Your inbox (dk@isconline.vn) | You receive the auto-generated draft every Friday morning, review it, then manually forward/send to Kent |
| **Final delivery** | Your decision | You hit send only when you are satisfied with the content |

This means: **the report is 90% automated, but the human review gate ensures nothing embarrassing reaches Kent.**

### The One Risk to Watch

The risk is **content drift** — if you forget to update the Sheet before Friday or update it too early, the report auto-generates with stale data. **Mitigation:** set a personal calendar reminder every Thursday at 5 PM: "Update the weekly report Sheet before tomorrow's trigger."

### Why Not Send Directly to Kent From Week 1

You made the right call to test with your own inbox first. Reasons:
1. Gmail threading and labeling needs to be verified working correctly before Kent's inbox sees it
2. The HTML rendering (especially on mobile) needs visual inspection
3. You may want to adjust the narrative tone after seeing the formatted output once or twice
4. It removes all risk of an embarrassing test email landing in Kent's inbox

---

## 2. Platform Decision: What We Are Building

### The Final Architecture

```
 ┌─────────────────────────────────────────────────────────────┐
 │               ANTIGRAVITY + KHÁNH (Input)                    │
 │  Push updates to Google Sheet cells before Friday trigger    │
 └───────────────────────────┬─────────────────────────────────┘
                             │ writes to
                             ▼
 ┌─────────────────────────────────────────────────────────────┐
 │    Google Sheet: ISC_WeeklyReport_DKtoKent                   │
 │    ─────────────────────────────────────                     │
 │    Tab 1: Weekly_Input   ← Khánh fills this                  │
 │    Tab 2: 5W2H_Matrix    ← Living roadmap                    │
 │    Tab 3: Report_Log     ← Auto-appended each week           │
 └───────────────────────────┬─────────────────────────────────┘
                             │ read by
                             ▼
 ┌─────────────────────────────────────────────────────────────┐
 │    Bound Apps Script: reportEngine.gs                        │
 │    ─────────────────────────────────────                     │
 │    Reads Weekly_Input cells                                  │
 │    Queries BigQuery for live KPIs                            │
 │    Builds rich HTML email                                    │
 │    Appends row to Report_Log                                 │
 │    Sends to dk@isconline.vn (staging mode)                   │
 │    Trigger: Every Friday 7:00 AM                             │
 └───────────────────────────┬─────────────────────────────────┘
                             │ sends to
                             ▼
 ┌─────────────────────────────────────────────────────────────┐
 │    Khánh's Inbox: dk@isconline.vn                            │
 │    Reviews HTML email on Friday morning                      │
 │    Forwards / re-sends to Kent when satisfied                │
 └─────────────────────────────────────────────────────────────┘
                             │ (when ready)
                             ▼
 ┌─────────────────────────────────────────────────────────────┐
 │    Kent's Inbox + Looker Studio Dashboard                    │
 └─────────────────────────────────────────────────────────────┘
```

---

## 3. Google Spreadsheet Setup

### 3.1 Recommended Sheet Name

You asked for a suggestion more formal than a shorthand. My recommendation:

```
ISC_WeeklyReport_DKtoKent
```

**Why this name works:**
- `ISC_` — company prefix, consistent with `ISC_SCM_Core_Lib` naming convention already in use
- `WeeklyReport` — function is immediately clear
- `_DKtoKent` — direction of communication (DK = Duy Khánh → Kent)
- Professional enough for Kent to see if the Sheet is ever shared with him
- Short enough for a Spreadsheet title

**Alternative if you prefer English-first:** `ISC_DigitalizationReport_Weekly`

---

### 3.2 Sheet Tab Structure

**Tab 1: `Weekly_Input`** — The staging area Khánh fills before Friday

| Cell | Field | Content |
|---|---|---|
| B2 | Week Number | e.g., `Week 12` |
| B3 | Date Range | e.g., `Mar 17–21, 2026` |
| B4 | Overall Status | `🟢 On Track` / `🟡 Attention Needed` / `🔴 Blocked` |
| B6 | Key Achievement #1 | Plain text — most important win |
| B7 | Key Achievement #2 | Plain text — second win |
| B8 | Key Blocker | Plain text — if none, write `None this week` |
| B10 | SCM Phase 5 % | Number only: `65` |
| B11 | Active Testing Status | Short text note on Chì/tolerance/VPO progress |
| B12 | System Health Note | Free text: `Nightly M2 run: all 7 days succeeded` |
| B14 | MPL Assessment Status | Text: `Not started / Meeting scheduled / In progress` |
| B15 | CS Assessment Status | Text |
| B16 | PRD Assessment Status | Text |
| B18 | Next Week Plan #1 | Expected action next week |
| B19 | Next Week Plan #2 | Expected action next week |
| B20 | Next Week Plan #3 | Expected action next week |
| B22 | AI Tool Highlight | Optional: one AI tool spotlight this week |

**Tab 2: `5W2H_Matrix`** — The living roadmap (manually edited, referenced in each report)

All 8 departments × 7 questions. Khánh updates this whenever a department progresses to a new stage.

**Tab 3: `Report_Log`** — Auto-appended by Apps Script after every send

| Week | Date | Status | Achievement | Phase % | Email Sent | Sent To |
|---|---|---|---|---|---|---|
| W11 | 2026-03-14 | 🟢 | Phase 7 deployed | 91% | ✅ | dk@isconline.vn |
| W12 | 2026-03-21 | 🟢 | Phase 5 complete | 100% | ✅ | dk@isconline.vn |

This becomes the official record Kent could audit at any time.

---

## 4. Apps Script Setup

### 4.1 How to Set It Up

**Step 1: Create the Google Sheet**
1. Go to Google Sheets → Create new → Name it `ISC_WeeklyReport_DKtoKent`
2. Create 3 tabs: `Weekly_Input`, `5W2H_Matrix`, `Report_Log`
3. Fill in the Weekly_Input structure (column A = labels, column B = values)

**Step 2: Open Apps Script**
1. In the Sheet: `Extensions` → `Apps Script`
2. This creates a bound Apps Script — it shares the same OAuth scope as the Sheet (important: this means it can also send email via GmailApp and query BigQuery using the same Google account)

**Step 3: Create the script file**
Rename the default `Code.gs` to `reportEngine.gs` and paste the code below.

**Step 4: Set up the trigger**
In Apps Script → `Triggers` → `Add Trigger`:
- Function: `generateAndSendWeeklyReport`
- Event source: Time-driven
- Type: Week timer
- Day: Friday
- Hour: 7:00–8:00 AM

---

### 4.2 The Apps Script Code Structure

```javascript
// ============================================================
// ISC_WeeklyReport_DKtoKent — reportEngine.gs
// Bound to: Google Sheet "ISC_WeeklyReport_DKtoKent"
// Trigger: Friday 7:00 AM → sends draft to dk@isconline.vn
// ============================================================

const STAGING_EMAIL = 'dk@isconline.vn';    // Review inbox — NOT Kent
const KENT_EMAIL    = 'kent@isconline.vn';   // Only used when you manually flip this switch
const SEND_TO_KENT  = false;                 // ← Flip to TRUE only when testing is complete

const REPORT_LOG_TAB  = 'Report_Log';
const INPUT_TAB       = 'Weekly_Input';

// ─────────────────────────────────────────────────────────
// MAIN FUNCTION — called by time-driven trigger
// ─────────────────────────────────────────────────────────
function generateAndSendWeeklyReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Read the weekly input cells Khánh prepared
  const input = readWeeklyInput_(ss);
  
  // 2. Query BigQuery for live system KPIs
  const kpis = queryBigQueryKPIs_();
  
  // 3. Build the HTML email body
  const html = buildReportHTML_(input, kpis);
  
  // 4. Determine subject (monthly threading)
  const subject = buildSubjectLine_(input);
  
  // 5. Send to staging or Kent depending on switch
  const recipient = SEND_TO_KENT ? KENT_EMAIL : STAGING_EMAIL;
  
  GmailApp.sendEmail(
    recipient,
    subject,
    'Please view this email in HTML mode.',
    {
      htmlBody: html,
      name: 'ISC Digital Transformation',
      replyTo: STAGING_EMAIL
    }
  );
  
  // 6. Apply Gmail label
  applyGmailLabel_('ISC_Weekly_Report');
  
  // 7. Append row to Report_Log
  appendToLog_(ss, input, recipient);
  
  Logger.log(`Report sent to: ${recipient} | Week: ${input.weekNumber}`);
}

// ─────────────────────────────────────────────────────────
// Read Weekly Input from Sheet Tab
// ─────────────────────────────────────────────────────────
function readWeeklyInput_(ss) {
  const sheet = ss.getSheetByName(INPUT_TAB);
  return {
    weekNumber:      sheet.getRange('B2').getValue(),
    dateRange:       sheet.getRange('B3').getValue(),
    overallStatus:   sheet.getRange('B4').getValue(),
    achievement1:    sheet.getRange('B6').getValue(),
    achievement2:    sheet.getRange('B7').getValue(),
    blocker:         sheet.getRange('B8').getValue(),
    phase5Pct:       sheet.getRange('B10').getValue(),
    testingNote:     sheet.getRange('B11').getValue(),
    systemHealth:    sheet.getRange('B12').getValue(),
    mplStatus:       sheet.getRange('B14').getValue(),
    csStatus:        sheet.getRange('B15').getValue(),
    prdStatus:       sheet.getRange('B16').getValue(),
    nextAction1:     sheet.getRange('B18').getValue(),
    nextAction2:     sheet.getRange('B19').getValue(),
    nextAction3:     sheet.getRange('B20').getValue(),
    aiHighlight:     sheet.getRange('B22').getValue()
  };
}

// ─────────────────────────────────────────────────────────
// Query BigQuery for Live KPIs
// Returns: { shortageCount, coveragePct, systemUptime, ... }
// ─────────────────────────────────────────────────────────
function queryBigQueryKPIs_() {
  // Uses the same BigQueryClient pattern from ISC_SCM_Core_Lib
  // Query M2_Daily_Stats for most recent run
  const query = `
    SELECT
      TOTAL_SHORTAGE_COUNT,
      ROUND(TOTAL_NET_SHORTAGE_QTY, 1) AS NET_SHORTAGE,
      IS_ANOMALY,
      ANOMALY_REASON,
      RUN_STATUS,
      RUN_DATE
    FROM \`boxwood-charmer-473204-k8.isc_scm_ops.M2_Daily_Stats\`
    ORDER BY RUN_DATE DESC
    LIMIT 1
  `;
  
  try {
    // Run via BigQuery Jobs API (same as ISC_SCM_Core_Lib pattern)
    const result = runBigQueryRead_(query);
    return result[0] || { TOTAL_SHORTAGE_COUNT: 'N/A', RUN_STATUS: 'N/A' };
  } catch(e) {
    Logger.log('BQ query failed: ' + e.message);
    return { TOTAL_SHORTAGE_COUNT: 'N/A', RUN_STATUS: 'Error' };
  }
}

// ─────────────────────────────────────────────────────────
// Build HTML Email Body
// ─────────────────────────────────────────────────────────
function buildReportHTML_(input, kpis) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body        { font-family: Arial, Helvetica, sans-serif; background: #f7fafc; margin: 0; padding: 20px; color: #2d3748; }
    .wrapper    { max-width: 650px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header     { background: #1a365d; color: white; padding: 24px 28px; }
    .header h1  { margin: 0; font-size: 20px; letter-spacing: 0.5px; }
    .header p   { margin: 6px 0 0; font-size: 14px; opacity: 0.8; }
    .status     { display: inline-block; margin-top: 10px; padding: 4px 12px; border-radius: 20px; font-size: 13px; background: rgba(255,255,255,0.15); }
    .section    { padding: 20px 28px; border-bottom: 1px solid #e2e8f0; }
    .section h2 { font-size: 15px; color: #1a365d; margin: 0 0 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .kpi-row    { display: flex; gap: 12px; margin-bottom: 4px; flex-wrap: wrap; }
    .kpi-card   { flex: 1; min-width: 140px; background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px 16px; text-align: center; }
    .kpi-num    { font-size: 26px; font-weight: bold; color: #1a365d; }
    .kpi-label  { font-size: 12px; color: #718096; margin-top: 4px; }
    .bullet-good  { color: #38a169; font-weight: bold; }
    .bullet-warn  { color: #d69e2e; font-weight: bold; }
    .bullet-block { color: #e53e3e; font-weight: bold; }
    .progress-bar { background: #e2e8f0; border-radius: 4px; height: 10px; margin: 4px 0; }
    .progress-fill { background: #2b6cb0; border-radius: 4px; height: 10px; }
    .dept-row   { display: flex; align-items: center; margin: 8px 0; font-size: 14px; }
    .dept-name  { width: 160px; font-weight: bold; }
    .dept-bar   { flex: 1; background: #e2e8f0; border-radius: 3px; height: 8px; margin: 0 10px; }
    .dept-fill  { height: 8px; border-radius: 3px; }
    .footer     { padding: 16px 28px; background: #f7fafc; font-size: 12px; color: #718096; }
    a           { color: #2b6cb0; }
    ul          { margin: 8px 0; padding-left: 20px; }
    li          { margin: 4px 0; font-size: 14px; line-height: 1.5; }
  </style>
</head>
<body>
<div class="wrapper">

  <!-- HEADER -->
  <div class="header">
    <h1>🏭 ISC Digitalization — Weekly Report</h1>
    <p>${input.weekNumber} &nbsp;|&nbsp; ${input.dateRange}</p>
    <p>Prepared by: Nguyễn Duy Khánh &nbsp;|&nbsp; dk@isconline.vn</p>
    <span class="status">${input.overallStatus}</span>
  </div>

  <!-- SECTION 1: EXECUTIVE SUMMARY -->
  <div class="section">
    <h2>📌 This Week at a Glance</h2>
    <ul>
      <li><span class="bullet-good">✅ Win:</span> ${input.achievement1}</li>
      <li><span class="bullet-good">✅ Progress:</span> ${input.achievement2}</li>
      <li><span class="${input.blocker === 'None this week' ? 'bullet-good' : 'bullet-warn'}">${input.blocker === 'None this week' ? '🟢 No Blockers' : '⚠️ ' + input.blocker}</span></li>
    </ul>
  </div>

  <!-- SECTION 2: SCM STATUS -->
  <div class="section">
    <h2>📊 SCM Database — Current Status</h2>
    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-num">${kpis.TOTAL_SHORTAGE_COUNT ?? 'N/A'}</div>
        <div class="kpi-label">Active Shortages</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num" style="font-size:18px;">${kpis.RUN_STATUS ?? 'N/A'}</div>
        <div class="kpi-label">Last M2 Run</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num">${input.phase5Pct}%</div>
        <div class="kpi-label">Phase 5 Progress</div>
      </div>
    </div>
    <div style="margin-top:12px; font-size:14px;">
      <strong>Testing note:</strong> ${input.testingNote}<br>
      <strong>System health:</strong> ${input.systemHealth}
    </div>
  </div>

  <!-- SECTION 3: DEPARTMENT ROADMAP -->
  <div class="section">
    <h2>🗺️ Digitalization Roadmap — All Departments</h2>
    <div class="dept-row">
      <span class="dept-name">✅ Supply Chain</span>
      <div class="dept-bar"><div class="dept-fill" style="width:85%; background:#38a169;"></div></div>
      <span style="font-size:12px; color:#718096;">In Testing</span>
    </div>
    <div class="dept-row">
      <span class="dept-name">🔵 Master Plan</span>
      <div class="dept-bar"><div class="dept-fill" style="width:5%; background:#4299e1;"></div></div>
      <span style="font-size:12px; color:#718096;">${input.mplStatus}</span>
    </div>
    <div class="dept-row">
      <span class="dept-name">🔵 Customer Svc</span>
      <div class="dept-bar"><div class="dept-fill" style="width:2%; background:#4299e1;"></div></div>
      <span style="font-size:12px; color:#718096;">${input.csStatus}</span>
    </div>
    <div class="dept-row">
      <span class="dept-name">🔵 Production</span>
      <div class="dept-bar"><div class="dept-fill" style="width:1%; background:#4299e1;"></div></div>
      <span style="font-size:12px; color:#718096;">${input.prdStatus}</span>
    </div>
    <div class="dept-row">
      <span class="dept-name">⬜ QC / Warehouse</span>
      <div class="dept-bar"><div class="dept-fill" style="width:0%; background:#cbd5e0;"></div></div>
      <span style="font-size:12px; color:#718096;">Q4 2026</span>
    </div>
    <div class="dept-row">
      <span class="dept-name">⬜ Finance / HR</span>
      <div class="dept-bar"><div class="dept-fill" style="width:0%; background:#cbd5e0;"></div></div>
      <span style="font-size:12px; color:#718096;">Q1 2027</span>
    </div>
  </div>

  <!-- SECTION 4: AI TOOL SPOTLIGHT -->
  ${input.aiHighlight ? `
  <div class="section">
    <h2>🤖 This Week's Tool Spotlight</h2>
    <p style="font-size:14px;">${input.aiHighlight}</p>
  </div>
  ` : ''}

  <!-- SECTION 5: NEXT WEEK PLAN -->
  <div class="section">
    <h2>📋 Next Week Plan</h2>
    <ul>
      ${input.nextAction1 ? `<li>${input.nextAction1}</li>` : ''}
      ${input.nextAction2 ? `<li>${input.nextAction2}</li>` : ''}
      ${input.nextAction3 ? `<li>${input.nextAction3}</li>` : ''}
    </ul>
  </div>

  <!-- FOOTER -->
  <div class="footer">
    <strong>ISC Digital Transformation</strong> &nbsp;|&nbsp; Powered by Google Cloud<br>
    📊 Live Dashboard: <a href="#">[Looker Studio — ISC Executive View]</a><br>
    📁 Full History: <a href="#">[ISC_WeeklyReport_DKtoKent Google Sheet]</a><br>
    📧 Contact: <a href="mailto:dk@isconline.vn">dk@isconline.vn</a>
  </div>

</div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────
// Build subject line — monthly threading
// ─────────────────────────────────────────────────────────
function buildSubjectLine_(input) {
  const now = new Date();
  const monthYear = Utilities.formatDate(now, 'Asia/Ho_Chi_Minh', 'MMMM yyyy');
  return `[ISC Weekly] 🏭 Digitalization Report — ${input.weekNumber}, ${monthYear}`;
}

// ─────────────────────────────────────────────────────────
// Apply Gmail label
// ─────────────────────────────────────────────────────────
function applyGmailLabel_(labelName) {
  let label = GmailApp.getUserLabelByName(labelName);
  if (!label) label = GmailApp.createLabel(labelName);
  const threads = GmailApp.search(`subject:[ISC Weekly]`, 0, 1);
  if (threads.length > 0) label.addToThread(threads[0]);
}

// ─────────────────────────────────────────────────────────
// Append row to Report_Log tab
// ─────────────────────────────────────────────────────────
function appendToLog_(ss, input, recipient) {
  const sheet = ss.getSheetByName(REPORT_LOG_TAB);
  const today = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
  sheet.appendRow([
    input.weekNumber,
    today,
    input.overallStatus,
    input.achievement1,
    `${input.phase5Pct}%`,
    '✅ Sent',
    recipient
  ]);
}
```

---

## 5. Testing Protocol Before Sending to Kent

### Step-by-Step Test Plan

| Step | Action | Success Criteria |
|---|---|---|
| 1 | Create the Google Sheet with 3 tabs | Sheet exists, structure is correct |
| 2 | Open bound Apps Script, paste code | No syntax errors on save |
| 3 | Fill in `Weekly_Input` tab with this week's real data | All cells populated |
| 4 | Run `generateAndSendWeeklyReport` **manually** (no trigger yet) | Function executes without error |
| 5 | Check dk@isconline.vn inbox | Email arrives with correct HTML rendering |
| 6 | Open on mobile | Layout looks good, text readable |
| 7 | Check `Report_Log` tab | One row appended correctly |
| 8 | Verify Gmail label `ISC_Weekly_Report` was created | Label visible in Gmail sidebar |
| 9 | Set up Friday 7 AM trigger | Trigger saved in Apps Script |
| 10 | Wait for next Friday OR manually trigger again | Second run produces correct second email |
| 11 | When satisfied: flip `SEND_TO_KENT = true` | Kent receives the report |

---

## 6. Email Delivery Design for Today's Report

### Subject Line for Week 11 (Today: March 13, 2026 — Thursday)

> Today is Thursday. The first report should go to Kent **today** given the 4 PM deadline.

Suggested subject:
```
[ISC Weekly] 🏭 Digitalization Report — Week 11, March 2026
```

### Today's Action Plan (Time-Boxed)

| Time | Action | Tool |
|---|---|---|
| 10:30–11:00 AM | Create Google Sheet `ISC_WeeklyReport_DKtoKent`, set up 3 tabs | Google Sheets |
| 11:00–11:30 AM | Open Apps Script, paste code, test with manual run | Apps Script |
| 11:30–12:00 PM | Review email in dk@ inbox, adjust if needed | Gmail |
| 12:00–13:00 PM | Lunch break | — |
| 13:00–14:00 PM | Fill in this week's narrative content in Weekly_Input tab | Google Sheets |
| 14:00–14:30 PM | Run one more manual test with full content | Apps Script |
| 14:30–15:00 PM | Final review of email in dk@ inbox | Gmail |
| 15:00–15:30 PM | Forward / send to Kent with personal cover note | Gmail |
| **Before 16:00** | **Report delivered to Kent** | ✅ |

---

## 7. Gmail Organization — Labels and Threading

### Label Structure

```
ISC_Weekly_Report/
└── All weekly reports thread here automatically

ISC_Logs/           ← Already exists (used by M2 nightly email)
ISC_System_Alerts/  ← For critical issues
```

### Monthly Threading Strategy

All emails with `[ISC Weekly]` in the subject are grouped by Gmail's threading logic. To force monthly threads, use the same base subject per month:

```
March 2026 thread:
  W11: [ISC Weekly] 🏭 Digitalization Report — Week 11, March 2026
  W12: [ISC Weekly] 🏭 Digitalization Report — Week 12, March 2026
  W13: [ISC Weekly] 🏭 Digitalization Report — Week 13, March 2026
```

Gmail groups these because they share the `[ISC Weekly]` prefix AND are in the same conversation reply chain if Kent replies. Kent sees one thread per month with 4–5 emails inside.

---

## 8. Attaching the Google Sheet to the Email

You confirmed: **HTML email for scanning + Google Sheet for history.** Here is how the attachment works in Apps Script:

```javascript
// In the GmailApp.sendEmail() call, add:
{
  htmlBody: html,
  name: 'ISC Digital Transformation',
  replyTo: STAGING_EMAIL,
  attachments: [
    SpreadsheetApp
      .openById(SHEET_ID)                   // same sheet ID
      .getSheetByName(REPORT_LOG_TAB)
      .getParent()
      .getAs('application/pdf')             // exports whole sheet as PDF
      .setName(`ISC_WeeklyReport_${input.weekNumber.replace(' ','')}.pdf`)
  ]
}
```

**Kent's experience:**
- Opens Gmail → sees beautiful HTML email → scans KPIs and roadmap
- Opens attached PDF → gets the full historical log formatted cleanly
- Clicks Looker Studio link in footer → sees live dashboard anytime

**Alternative (no PDF):** Include a direct link to the Google Sheet in the email footer — simpler, no PDF generation. Kent clicks to open if he wants history. Recommended for V1, attach PDF later.

---

## 9. Summary Decision Table

| Decision | Choice | Reason |
|---|---|---|
| **Primary delivery** | Rich HTML Email | Zero friction, arrives in inbox, proven in M2 system |
| **History access** | Google Sheet link in footer (later: PDF attachment) | Clean, simple, scalable |
| **Live companion** | Looker Studio link in footer | Always fresh data for Kent |
| **Sheet name** | `ISC_WeeklyReport_DKtoKent` | Company convention, clear direction |
| **Staging inbox** | dk@isconline.vn | Human review gate before Kent sees anything |
| **Trigger time** | Friday 7:00 AM | Khánh reviews between 7–3 PM before 4 PM deadline |
| **Kent switch** | `SEND_TO_KENT = false` until testing complete | Protects Kent's inbox from test emails |
| **Content source** | Weekly_Input tab (Khánh + Antigravity push updates) | Structured, predictable, automatable |
| **BQ KPIs** | Auto-queried by Apps Script | Real data, no manual entry |
| **Gmail label** | `ISC_Weekly_Report` | Consistent, searchable |
| **Threading** | Monthly base subject | 4–5 emails/thread, clean history |

---

*End of Part 3 V2 — this completes the full Kent Report Analysis revision.*
*Part 1 + Part 2 + Part 3 together form the complete foundation for the weekly report system.*
