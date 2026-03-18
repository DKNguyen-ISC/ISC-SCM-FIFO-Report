# Implementation: ISC Weekly Report System — V2

*Date: 2026-03-13 | Sheet: ISC_DigitalizationReport_4PMFriday*
*Sheet URL: https://docs.google.com/spreadsheets/d/1W_F2zwYknKBSDw2yKFi-q3a5sozkyCJ5zCupo4JmwqU/edit*

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│        ISC_DigitalizationReport_4PMFriday (Google Sheet)          │
│                                                                    │
│  📝 Tab 1: Weekly_Input (HIDDEN from Kent)                        │
│     → Khánh + Antigravity push updates here before Friday          │
│     → Labeled cells B2-B22 with color-coded sections               │
│                                                                    │
│  📊 Tab 2: 5W2H_Matrix (VISIBLE)                                  │
│     → Living 5W-2H roadmap — 8 departments × 7 questions           │
│     → Updated gradually as departments progress                    │
│                                                                    │
│  📋 Tab 3: Report_Log (VISIBLE)                                    │
│     → Auto-appended each week when email is sent                   │
│     → Historical record Kent can browse                            │
│                                                                    │
│  ⚙️ Bound Apps Script (2 files):                                   │
│     SheetBuilder.gs → admin_SetupAllTabs()                         │
│     Code.gs         → generateAndSendWeeklyReport()                │
│                                                                    │
└───────────────────────┬──────────────────────────────────────────┘
                        │ reads + sends
                        ▼
              📧 dk@isconline.vn (review inbox)
                        │ (human review)
                        ▼ forward when ready
              📧 Kent's inbox (after approval)
```

---

## 2. Apps Script File 1: `SheetBuilder.gs`

**How to add this file:**
1. Open the Sheet → `Extensions` → `Apps Script`
2. Click `+` next to `Files` in the sidebar → `Script` → Name it `SheetBuilder`
3. Delete any default content and paste the entire code below

```javascript
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 📋 SheetBuilder.gs — Tab Creator for ISC Weekly Report
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 * IaC-style sheet creator (same pattern as M4_ZXH_PO_AutoSync_SheetBuilder.gs).
 * Creates 3 tabs programmatically with styling, labels, and structure.
 *
 * ENTRY POINT: admin_SetupAllTabs()
 *   — Run once from Script Editor to create all tabs
 *   — Safe to re-run: will delete and recreate all tabs
 *
 * TABS CREATED:
 *   Tab 1: Weekly_Input  — Khánh fills this (HIDDEN from Kent)
 *   Tab 2: 5W2H_Matrix   — Living 5W-2H roadmap
 *   Tab 3: Report_Log    — Auto-appended by report engine
 *
 * VERSION: 1.0
 * DATE: March 2026
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const SHEET_CONFIG = {
  TIMEZONE: 'Asia/Ho_Chi_Minh',

  TAB_NAMES: {
    INPUT:      'Weekly_Input',
    MATRIX:     '5W2H_Matrix',
    LOG:        'Report_Log'
  },

  TAB_COLORS: {
    INPUT:      '#1a365d',    // ISC Blue — primary input
    MATRIX:     '#2b6cb0',    // Teal — strategic roadmap
    LOG:        '#38a169'     // Green — historical record
  },

  COLORS: {
    HEADER_BG:    '#1a365d',  // ISC Blue
    HEADER_FG:    '#ffffff',
    SECTION_BG:   '#e2e8f0',  // Light grey
    SECTION_FG:   '#1a365d',
    STATUS_LIVE:  '#c6f6d5',  // Light green
    STATUS_PROG:  '#fefcbf',  // Light yellow
    STATUS_PLAN:  '#e2e8f0',  // Light grey
    STATUS_NEXT:  '#bee3f8',  // Light blue
    INPUT_CELL:   '#fffff0',  // Very light ivory — indicates editable
    LABEL_BG:     '#f7fafc',  // Off-white
    LOG_HEADER:   '#2d3748',  // Dark grey
    LOG_HEADER_FG:'#ffffff',
    DEPT_SC:      '#c6f6d5',
    DEPT_MPL:     '#bee3f8',
    DEPT_CS:      '#bee3f8',
    DEPT_PRD:     '#bee3f8',
    DEPT_QC:      '#fefcbf',
    DEPT_WH:      '#fefcbf',
    DEPT_FIN:     '#e2e8f0',
    DEPT_HR:      '#e2e8f0'
  }
};


// ═══════════════════════════════════════════════════════════════════════════════
// 2. ADMIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Creates (or rebuilds) all 3 tabs in the Weekly Report sheet.
 * Run from Script Editor: Run → admin_SetupAllTabs
 * Safe to re-run: deletes existing tabs and recreates from scratch.
 */
function admin_SetupAllTabs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Build all 3 tabs
  _buildWeeklyInputTab(ss);
  _build5W2HMatrixTab(ss);
  _buildReportLogTab(ss);

  // Delete default "Sheet1" if it still exists
  const sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1) {
    // Must have at least 1 visible sheet before deleting — all 3 are now visible
    ss.deleteSheet(sheet1);
  }

  // Hide the Weekly_Input tab from Kent
  const inputTab = ss.getSheetByName(SHEET_CONFIG.TAB_NAMES.INPUT);
  if (inputTab) inputTab.hideSheet();

  SpreadsheetApp.flush();

  try {
    SpreadsheetApp.getUi().alert(
      '✅ Setup Complete',
      'All 3 tabs created successfully.\n\n' +
      '• Weekly_Input (HIDDEN — right-click tab bar → "Show sheet" to edit)\n' +
      '• 5W2H_Matrix (visible to Kent)\n' +
      '• Report_Log (visible to Kent)\n\n' +
      'Next: Unhide Weekly_Input → fill in data → run generateAndSendWeeklyReport()',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    // UI not available if running from trigger
    Logger.log('✅ All 3 tabs created. Weekly_Input is hidden.');
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// 3. TAB 1: Weekly_Input (HIDDEN — Khánh fills before Friday)
// ═══════════════════════════════════════════════════════════════════════════════

function _buildWeeklyInputTab(ss) {
  // Delete existing
  const existing = ss.getSheetByName(SHEET_CONFIG.TAB_NAMES.INPUT);
  if (existing) ss.deleteSheet(existing);

  const sheet = ss.insertSheet(SHEET_CONFIG.TAB_NAMES.INPUT);
  sheet.setTabColor(SHEET_CONFIG.TAB_COLORS.INPUT);

  // Column widths: A = labels (200px), B = values (500px)
  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 520);

  // ── ROW 1: Title ─────────────────────────────────────────────
  sheet.getRange('A1:B1').merge()
    .setValue('📝 WEEKLY INPUT — Fill Before Friday')
    .setBackground(SHEET_CONFIG.COLORS.HEADER_BG)
    .setFontColor(SHEET_CONFIG.COLORS.HEADER_FG)
    .setFontWeight('bold').setFontSize(13)
    .setHorizontalAlignment('center');

  // ── ROW 2-4: Report Identity ─────────────────────────────────
  const identity = [
    ['Week Number',    'Week 11'],
    ['Date Range',     'Mar 10–14, 2026'],
    ['Overall Status', '🟢 On Track']
  ];
  _writeSectionHeader(sheet, 2, '📌 REPORT IDENTITY');
  _writeInputRows(sheet, 3, identity);

  // ── ROW 7-9: Executive Summary ───────────────────────────────
  _writeSectionHeader(sheet, 7, '✅ EXECUTIVE SUMMARY');
  const summary = [
    ['Key Achievement #1',   'SCM Database running daily — Ngàn\'s team completing testing phase'],
    ['Key Achievement #2',   'M4 Lead Issuance merge discrepancy fixed (±0 variance)'],
    ['Key Blocker',          'None this week']
  ];
  _writeInputRows(sheet, 8, summary);

  // ── ROW 12-14: SCM System Status ─────────────────────────────
  _writeSectionHeader(sheet, 12, '📊 SCM DATABASE STATUS');
  const scm = [
    ['Phase 5 Progress (%)', '65'],
    ['Testing Note',         'BOM_TOLERANCE mismatch investigation — comparing CS vs ISC 10% convention'],
    ['System Health',        'M2 nightly runs: 7/7 days succeeded this week']
  ];
  _writeInputRows(sheet, 13, scm);

  // ── ROW 17-19: Department Roadmap Status ─────────────────────
  _writeSectionHeader(sheet, 17, '🗺️ DEPARTMENT ROADMAP');
  const depts = [
    ['MPL Status',  'Not started'],
    ['CS Status',   'Not started'],
    ['PRD Status',  'Not started']
  ];
  _writeInputRows(sheet, 18, depts);

  // ── ROW 22-24: Next Week Plan ────────────────────────────────
  _writeSectionHeader(sheet, 22, '📋 NEXT WEEK\'S PLAN');
  const plan = [
    ['Action #1', 'Continue Phase 5 — Assign Sourcing dialog VPO aggregation design'],
    ['Action #2', 'Schedule MPL department discovery meeting with relevant team'],
    ['Action #3', 'Prepare BOM_TOLERANCE override feature spec']
  ];
  _writeInputRows(sheet, 23, plan);

  // ── ROW 27: Tool Spotlight ───────────────────────────────────
  _writeSectionHeader(sheet, 27, '🤖 AI TOOL SPOTLIGHT (optional)');
  const tool = [
    ['AI Tool Highlight', 'NotebookLM — free Google tool: upload docs, ask questions, generate audio summaries. No data leaves your Google account.']
  ];
  _writeInputRows(sheet, 28, tool);

  // ── Freeze top row + protect ─────────────────────────────────
  sheet.setFrozenRows(1);

  Logger.log('✅ Weekly_Input tab created.');
  return sheet;
}


// ═══════════════════════════════════════════════════════════════════════════════
// 4. TAB 2: 5W2H_Matrix (Living Roadmap)
// ═══════════════════════════════════════════════════════════════════════════════

function _build5W2HMatrixTab(ss) {
  const existing = ss.getSheetByName(SHEET_CONFIG.TAB_NAMES.MATRIX);
  if (existing) ss.deleteSheet(existing);

  const sheet = ss.insertSheet(SHEET_CONFIG.TAB_NAMES.MATRIX);
  sheet.setTabColor(SHEET_CONFIG.TAB_COLORS.MATRIX);

  // ── ROW 1: Title ─────────────────────────────────────────────
  const totalCols = 9; // Priority + Dept + 7 questions
  sheet.getRange(1, 1, 1, totalCols).merge()
    .setValue('🏭 ISC DIGITALIZATION PLAN — 5W-2H Matrix')
    .setBackground(SHEET_CONFIG.COLORS.HEADER_BG)
    .setFontColor(SHEET_CONFIG.COLORS.HEADER_FG)
    .setFontWeight('bold').setFontSize(13)
    .setHorizontalAlignment('center');

  // ── ROW 2: Subtitle ──────────────────────────────────────────
  sheet.getRange(2, 1, 1, totalCols).merge()
    .setValue('Last Updated: ' + Utilities.formatDate(new Date(), SHEET_CONFIG.TIMEZONE, 'yyyy-MM-dd') + '  |  Prepared by: Nguyễn Duy Khánh')
    .setBackground('#edf2f7').setFontColor('#718096')
    .setFontSize(10).setHorizontalAlignment('center');

  // ── ROW 3: Headers ───────────────────────────────────────────
  const headers = [
    'Priority', 'Department',
    'WHAT\n(Digitalization Initiative)',
    'WHY\n(Waste Eliminated)',
    'WHEN\n(Timeline)',
    'WHO\n(Owner)',
    'WHERE\n(Process)',
    'HOW TO\n(Approach & Tools)',
    'HOW MUCH\n(Cost Estimate)'
  ];
  sheet.getRange(3, 1, 1, totalCols)
    .setValues([headers])
    .setBackground('#2d3748').setFontColor('#ffffff')
    .setFontWeight('bold').setFontSize(10)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true)
    .setBorder(true, true, true, true, true, true);
  sheet.setRowHeight(3, 50);

  // ── ROW 4-11: Department Data ────────────────────────────────
  const deptData = [
    ['🟢 P1', 'Supply Chain (SC)',
     'Full MRP system — 4 modules, shortage calc, procurement, logistics',
     'Waiting, Over-processing, Defects, Motion',
     '✅ Live / In Testing',
     'Khánh (build)\nNgàn, Phong (use)',
     'M1 Planning\nM2 Balancing\nM3 Procurement\nM4 Execution',
     'GSheets + Apps Script + BigQuery\nStatus: In Testing / Calibrating',
     '~$15/month'],
    ['🔵 P2', 'Master Plan (MPL)',
     'Production scheduling DB, capacity planning, auto-sync with SC demand',
     'Waiting (SC reads manual schedules), Inventory misallocation',
     'Assessment Q2 2026',
     'Khánh (build)\nMPL Manager (data)',
     'Production scheduling\nResource allocation',
     'Same stack: GSheets + BQ\nLeverage existing M1 demand data',
     '~$10/month'],
    ['🔵 P3', 'Customer Service (CS)',
     'Formalize CS↔SC data exchange, auto-detect date/qty changes',
     'Defects (CS data discrepancies = most common SC data error source)',
     'Q2–Q3 2026',
     'Khánh (build)\nCS Team Lead',
     'M1 CS Status Protocol\nOrder lifecycle',
     'Extend existing M1 CS Protocol\nForm → BQ → auto-discrepancy alert',
     '~$10/month'],
    ['🔵 P4', 'Production (PRD)',
     'Real-time completion dashboard, auto-sync to SC/MPL/CS',
     'Waiting (3 depts wait for manual production updates)',
     'Q3 2026',
     'Khánh (build)\nFactory Head',
     'Completion tracking\nYield analysis',
     'Extend M1 Production Status Protocol\nFactory floor form → BQ → real-time view',
     '~$10/month'],
    ['🟡 P5', 'Quality Control (QC)',
     'Digital inspection checklists, defect tracking, CAPA management',
     'Defects (paper records = data loss risk)',
     'Q4 2026',
     'Khánh\nQC Manager',
     'Inspection process\nDefect lifecycle',
     'Google Forms → BQ → SPC charts',
     '~$10/month'],
    ['🟡 P6', 'Warehouse / Logistics',
     'Extend M4 Monday Protocol to real-time issuance & cycle count',
     'Motion, Inventory waste',
     'Q4 2026',
     'Khánh\nWarehouse Lead',
     'Stock management\nIssuance tracking',
     'Extend M4 module with barcode input',
     '~$5–15/month'],
    ['🟢 P7', 'Finance / Accounting',
     'PO-Invoice reconciliation, cost variance, budget tracking dashboard',
     'Waiting (approval delays), Over-processing (manual reconciliation)',
     'Q1 2027',
     'Khánh\nFinance Manager',
     'Invoice → PO matching\nCost analysis',
     'Bridge M3 PO data → invoice matching',
     '~$10/month'],
    ['🟢 P8', 'HR / Admin',
     'Attendance tracking, training records, employee KPI dashboard',
     'Motion (manual attendance), Defects (data errors)',
     'Q1 2027',
     'Khánh\nHR Admin',
     'HR records\nTraining management',
     'GSheet forms → BQ → monthly KPI email',
     '~$5/month']
  ];

  const deptColors = [
    SHEET_CONFIG.COLORS.DEPT_SC, SHEET_CONFIG.COLORS.DEPT_MPL,
    SHEET_CONFIG.COLORS.DEPT_CS, SHEET_CONFIG.COLORS.DEPT_PRD,
    SHEET_CONFIG.COLORS.DEPT_QC, SHEET_CONFIG.COLORS.DEPT_WH,
    SHEET_CONFIG.COLORS.DEPT_FIN, SHEET_CONFIG.COLORS.DEPT_HR
  ];

  sheet.getRange(4, 1, deptData.length, totalCols)
    .setValues(deptData)
    .setVerticalAlignment('top')
    .setWrap(true)
    .setFontSize(10)
    .setBorder(true, true, true, true, true, true,
               '#e2e8f0', SpreadsheetApp.BorderStyle.SOLID);

  // Apply row-level colors
  deptData.forEach((row, i) => {
    sheet.getRange(4 + i, 1, 1, totalCols).setBackground(deptColors[i]);
  });

  // Row heights for readability
  for (let i = 4; i <= 11; i++) sheet.setRowHeight(i, 80);

  // Column widths
  const colWidths = [70, 160, 200, 180, 130, 140, 150, 200, 100];
  colWidths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  // Freeze top 3 rows
  sheet.setFrozenRows(3);

  Logger.log('✅ 5W2H_Matrix tab created with 8 departments.');
  return sheet;
}


// ═══════════════════════════════════════════════════════════════════════════════
// 5. TAB 3: Report_Log (Historical Record)
// ═══════════════════════════════════════════════════════════════════════════════

function _buildReportLogTab(ss) {
  const existing = ss.getSheetByName(SHEET_CONFIG.TAB_NAMES.LOG);
  if (existing) ss.deleteSheet(existing);

  const sheet = ss.insertSheet(SHEET_CONFIG.TAB_NAMES.LOG);
  sheet.setTabColor(SHEET_CONFIG.TAB_COLORS.LOG);

  const headers = [
    'Week', 'Date Sent', 'Overall Status',
    'Key Achievement', 'Phase 5 %',
    'Dept in Progress', 'AI Tool Highlight',
    'Blocker', 'Email Status', 'Sent To'
  ];
  const colCount = headers.length;

  // ── ROW 1: Title ─────────────────────────────────────────────
  sheet.getRange(1, 1, 1, colCount).merge()
    .setValue('📋 ISC WEEKLY REPORT LOG — Historical Record')
    .setBackground(SHEET_CONFIG.COLORS.HEADER_BG)
    .setFontColor(SHEET_CONFIG.COLORS.HEADER_FG)
    .setFontWeight('bold').setFontSize(13)
    .setHorizontalAlignment('center');

  // ── ROW 2: Headers ───────────────────────────────────────────
  sheet.getRange(2, 1, 1, colCount)
    .setValues([headers])
    .setBackground(SHEET_CONFIG.COLORS.LOG_HEADER)
    .setFontColor(SHEET_CONFIG.COLORS.LOG_HEADER_FG)
    .setFontWeight('bold').setFontSize(10)
    .setHorizontalAlignment('center')
    .setBorder(true, true, true, true, true, true);

  // Column widths
  const widths = [80, 100, 130, 280, 80, 160, 200, 200, 100, 160];
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  // Freeze header rows
  sheet.setFrozenRows(2);

  Logger.log('✅ Report_Log tab created.');
  return sheet;
}


// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Writes a grey section header bar spanning columns A-B.
 */
function _writeSectionHeader(sheet, row, text) {
  sheet.getRange(row, 1, 1, 2).merge()
    .setValue(text)
    .setBackground(SHEET_CONFIG.COLORS.SECTION_BG)
    .setFontColor(SHEET_CONFIG.COLORS.SECTION_FG)
    .setFontWeight('bold').setFontSize(11);
}

/**
 * Writes label-value pairs starting from startRow.
 * Each pair: Column A = label (grey bg), Column B = value (ivory bg, editable feel).
 */
function _writeInputRows(sheet, startRow, pairs) {
  pairs.forEach((pair, i) => {
    const row = startRow + i;
    // Label (Column A)
    sheet.getRange(row, 1)
      .setValue(pair[0])
      .setBackground(SHEET_CONFIG.COLORS.LABEL_BG)
      .setFontWeight('bold').setFontSize(10)
      .setVerticalAlignment('middle');
    // Value (Column B)
    sheet.getRange(row, 2)
      .setValue(pair[1])
      .setBackground(SHEET_CONFIG.COLORS.INPUT_CELL)
      .setFontSize(10)
      .setVerticalAlignment('middle')
      .setBorder(true, true, true, true, null, null,
                 '#e2e8f0', SpreadsheetApp.BorderStyle.SOLID);
  });
}
```

---

## 3. Apps Script File 2: `Code.gs` (Report Engine — Refined)

**This replaces the Code.gs content already in the Apps Script.**
The changes from Part 3 V2:
- Removed BigQuery dependency (all data comes from `Weekly_Input` tab)
- Added Google Sheet link in the email
- Simplified `appendToLog_` to match the `Report_Log` tab structure above
- Ensured `SEND_TO_KENT = false` for staging mode

```javascript
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ⚙️ Code.gs — ISC Weekly Report Engine
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 * Reads Weekly_Input tab → builds rich HTML email → sends to dk@isconline.vn
 * Also appends a summary row to Report_Log tab.
 *
 * ENTRY POINT: generateAndSendWeeklyReport()
 *   — Manual or trigger-driven
 *
 * TRIGGER SETUP:
 *   Event: Time-driven → Week timer → Friday → 7:00-8:00 AM
 *   Function: generateAndSendWeeklyReport
 *
 * VERSION: 2.0
 * DATE: March 2026
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ── CONFIG ──────────────────────────────────────────────────────
const REPORT_CONFIG = {
  STAGING_EMAIL:  'dk@isconline.vn',
  KENT_EMAIL:     'kent@isconline.vn',
  SEND_TO_KENT:   false,                // ← Flip to TRUE only when ready
  LABEL_NAME:     'ISC_Weekly_Report',
  TIMEZONE:       'Asia/Ho_Chi_Minh',
  SHEET_URL:      'https://docs.google.com/spreadsheets/d/1W_F2zwYknKBSDw2yKFi-q3a5sozkyCJ5zCupo4JmwqU/edit',
  INPUT_TAB:      'Weekly_Input',
  LOG_TAB:        'Report_Log'
};


// ── MAIN FUNCTION ───────────────────────────────────────────────
function generateAndSendWeeklyReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Read input
  const input = _readWeeklyInput(ss);

  // 2. Build HTML
  const html = _buildReportHTML(input);

  // 3. Subject line (monthly threading)
  const subject = _buildSubject(input);

  // 4. Send
  const recipient = REPORT_CONFIG.SEND_TO_KENT
    ? REPORT_CONFIG.KENT_EMAIL
    : REPORT_CONFIG.STAGING_EMAIL;

  GmailApp.sendEmail(recipient, subject,
    'Please view this email in HTML mode.', {
      htmlBody: html,
      name: 'ISC Digital Transformation',
      replyTo: REPORT_CONFIG.STAGING_EMAIL
    });

  // 5. Apply Gmail label
  _applyLabel(REPORT_CONFIG.LABEL_NAME);

  // 6. Append to Report_Log
  _appendToLog(ss, input, recipient);

  Logger.log(`✅ Report sent to: ${recipient} | ${input.weekNumber}`);
}


// ── READ INPUT ──────────────────────────────────────────────────
function _readWeeklyInput(ss) {
  const sheet = ss.getSheetByName(REPORT_CONFIG.INPUT_TAB);
  if (!sheet) throw new Error('Weekly_Input tab not found. Run admin_SetupAllTabs() first.');

  return {
    weekNumber:    String(sheet.getRange('B3').getValue()),
    dateRange:     String(sheet.getRange('B4').getValue()),
    overallStatus: String(sheet.getRange('B5').getValue()),
    achievement1:  String(sheet.getRange('B8').getValue()),
    achievement2:  String(sheet.getRange('B9').getValue()),
    blocker:       String(sheet.getRange('B10').getValue()),
    phase5Pct:     String(sheet.getRange('B13').getValue()),
    testingNote:   String(sheet.getRange('B14').getValue()),
    systemHealth:  String(sheet.getRange('B15').getValue()),
    mplStatus:     String(sheet.getRange('B18').getValue()),
    csStatus:      String(sheet.getRange('B19').getValue()),
    prdStatus:     String(sheet.getRange('B20').getValue()),
    nextAction1:   String(sheet.getRange('B23').getValue()),
    nextAction2:   String(sheet.getRange('B24').getValue()),
    nextAction3:   String(sheet.getRange('B25').getValue()),
    aiHighlight:   String(sheet.getRange('B28').getValue())
  };
}


// ── BUILD HTML ──────────────────────────────────────────────────
function _buildReportHTML(input) {
  const sheetLink = REPORT_CONFIG.SHEET_URL;
  const blockerClass = (input.blocker === 'None this week' || input.blocker === '')
    ? 'bullet-good' : 'bullet-warn';
  const blockerText = (input.blocker === 'None this week' || input.blocker === '')
    ? '🟢 No Blockers this week' : '⚠️ ' + input.blocker;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: Arial, Helvetica, sans-serif; background: #f7fafc; margin: 0; padding: 20px; color: #2d3748; }
    .wrapper { max-width: 650px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #1a365d, #2b6cb0); color: white; padding: 24px 28px; }
    .header h1 { margin: 0; font-size: 20px; letter-spacing: 0.5px; }
    .header p { margin: 6px 0 0; font-size: 13px; opacity: 0.85; }
    .status-badge { display: inline-block; margin-top: 10px; padding: 4px 14px; border-radius: 20px; font-size: 13px; font-weight: bold; background: rgba(255,255,255,0.2); }
    .section { padding: 20px 28px; border-bottom: 1px solid #e2e8f0; }
    .section h2 { font-size: 14px; color: #1a365d; margin: 0 0 12px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 2px solid #2b6cb0; padding-bottom: 6px; }
    .kpi-row { display: flex; gap: 10px; margin-bottom: 4px; flex-wrap: wrap; }
    .kpi-card { flex: 1; min-width: 130px; background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px 12px; text-align: center; }
    .kpi-num { font-size: 24px; font-weight: bold; color: #1a365d; }
    .kpi-label { font-size: 11px; color: #718096; margin-top: 4px; }
    .bullet-good { color: #38a169; }
    .bullet-warn { color: #d69e2e; }
    .dept-row { display: flex; align-items: center; margin: 6px 0; font-size: 13px; }
    .dept-name { width: 150px; font-weight: bold; }
    .dept-bar { flex: 1; background: #e2e8f0; border-radius: 3px; height: 8px; margin: 0 10px; }
    .dept-fill { height: 8px; border-radius: 3px; }
    .footer { padding: 18px 28px; background: #f7fafc; font-size: 12px; color: #718096; line-height: 1.6; }
    a { color: #2b6cb0; text-decoration: none; }
    a:hover { text-decoration: underline; }
    ul { margin: 8px 0; padding-left: 20px; }
    li { margin: 4px 0; font-size: 13px; line-height: 1.5; }
    .ai-box { background: #ebf8ff; border-left: 4px solid #2b6cb0; padding: 12px 16px; margin: 8px 0; border-radius: 0 6px 6px 0; font-size: 13px; }
  </style>
</head>
<body>
<div class="wrapper">

  <div class="header">
    <h1>🏭 ISC Digitalization — Weekly Report</h1>
    <p>${input.weekNumber} &nbsp;|&nbsp; ${input.dateRange}</p>
    <p>Prepared by: Nguyễn Duy Khánh &nbsp;|&nbsp; dk@isconline.vn</p>
    <span class="status-badge">${input.overallStatus}</span>
  </div>

  <div class="section">
    <h2>📌 This Week at a Glance</h2>
    <ul>
      <li><span class="bullet-good"><strong>✅</strong></span> ${input.achievement1}</li>
      <li><span class="bullet-good"><strong>✅</strong></span> ${input.achievement2}</li>
      <li><span class="${blockerClass}"><strong>${blockerText}</strong></span></li>
    </ul>
  </div>

  <div class="section">
    <h2>📊 SCM Database — Status</h2>
    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-num">${input.phase5Pct}%</div>
        <div class="kpi-label">Phase 5 Progress</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num" style="font-size:16px;">${input.systemHealth}</div>
        <div class="kpi-label">System Health</div>
      </div>
    </div>
    <p style="font-size:13px; margin-top:12px; color:#4a5568;">
      <strong>Testing note:</strong> ${input.testingNote}
    </p>
  </div>

  <div class="section">
    <h2>🗺️ Department Roadmap</h2>
    <div class="dept-row">
      <span class="dept-name">✅ Supply Chain</span>
      <div class="dept-bar"><div class="dept-fill" style="width:85%; background:#38a169;"></div></div>
      <span style="font-size:11px; color:#718096;">In Testing</span>
    </div>
    <div class="dept-row">
      <span class="dept-name">🔵 Master Plan</span>
      <div class="dept-bar"><div class="dept-fill" style="width:5%; background:#4299e1;"></div></div>
      <span style="font-size:11px; color:#718096;">${input.mplStatus}</span>
    </div>
    <div class="dept-row">
      <span class="dept-name">🔵 Customer Svc</span>
      <div class="dept-bar"><div class="dept-fill" style="width:2%; background:#4299e1;"></div></div>
      <span style="font-size:11px; color:#718096;">${input.csStatus}</span>
    </div>
    <div class="dept-row">
      <span class="dept-name">🔵 Production</span>
      <div class="dept-bar"><div class="dept-fill" style="width:1%; background:#4299e1;"></div></div>
      <span style="font-size:11px; color:#718096;">${input.prdStatus}</span>
    </div>
    <div class="dept-row">
      <span class="dept-name">⬜ QC / Warehouse</span>
      <div class="dept-bar"><div class="dept-fill" style="width:0%; background:#cbd5e0;"></div></div>
      <span style="font-size:11px; color:#718096;">Q4 2026</span>
    </div>
    <div class="dept-row">
      <span class="dept-name">⬜ Finance / HR</span>
      <div class="dept-bar"><div class="dept-fill" style="width:0%; background:#cbd5e0;"></div></div>
      <span style="font-size:11px; color:#718096;">Q1 2027</span>
    </div>
  </div>

  ${input.aiHighlight ? `
  <div class="section">
    <h2>🤖 Tool Spotlight</h2>
    <div class="ai-box">${input.aiHighlight}</div>
  </div>` : ''}

  <div class="section">
    <h2>📋 Next Week</h2>
    <ul>
      ${input.nextAction1 ? '<li>' + input.nextAction1 + '</li>' : ''}
      ${input.nextAction2 ? '<li>' + input.nextAction2 + '</li>' : ''}
      ${input.nextAction3 ? '<li>' + input.nextAction3 + '</li>' : ''}
    </ul>
  </div>

  <div class="footer">
    <strong>ISC Digital Transformation</strong> &nbsp;|&nbsp; Powered by Google Cloud<br>
    📁 Full Report History: <a href="${sheetLink}">ISC_DigitalizationReport_4PMFriday</a><br>
    📧 Contact: <a href="mailto:dk@isconline.vn">dk@isconline.vn</a>
  </div>

</div>
</body>
</html>`;
}


// ── SUBJECT LINE ────────────────────────────────────────────────
function _buildSubject(input) {
  const now = new Date();
  const monthYear = Utilities.formatDate(now, REPORT_CONFIG.TIMEZONE, 'MMMM yyyy');
  return `[ISC Weekly] 🏭 Digitalization Report — ${input.weekNumber}, ${monthYear}`;
}


// ── GMAIL LABEL ─────────────────────────────────────────────────
function _applyLabel(labelName) {
  try {
    let label = GmailApp.getUserLabelByName(labelName);
    if (!label) label = GmailApp.createLabel(labelName);
    // Find the most recent thread matching our subject
    const threads = GmailApp.search('subject:[ISC Weekly] newer_than:1d', 0, 1);
    if (threads.length > 0) label.addToThread(threads[0]);
  } catch (e) {
    Logger.log('Label application failed (non-critical): ' + e.message);
  }
}


// ── APPEND TO LOG ───────────────────────────────────────────────
function _appendToLog(ss, input, recipient) {
  const sheet = ss.getSheetByName(REPORT_CONFIG.LOG_TAB);
  if (!sheet) return;

  const today = Utilities.formatDate(new Date(), REPORT_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm');
  sheet.appendRow([
    input.weekNumber,
    today,
    input.overallStatus,
    input.achievement1,
    input.phase5Pct + '%',
    [input.mplStatus, input.csStatus, input.prdStatus].filter(s => s && s !== 'Not started').join(', ') || 'SC only',
    input.aiHighlight || '—',
    input.blocker || 'None',
    '✅ Sent',
    recipient
  ]);
}
```

---

## 4. Execution Steps — What to Do Right Now

### Step-by-step:

| # | Action | Where | Time |
|---|---|---|---|
| 1 | Open the Google Sheet | [ISC_DigitalizationReport_4PMFriday](https://docs.google.com/spreadsheets/d/1W_F2zwYknKBSDw2yKFi-q3a5sozkyCJ5zCupo4JmwqU/edit) | — |
| 2 | Go to `Extensions` → `Apps Script` | Sheet | 30s |
| 3 | Click `+` next to Files → `Script` → Name it `SheetBuilder` | Apps Script | 30s |
| 4 | Paste the **SheetBuilder.gs** code from Section 2 above | Apps Script | 1 min |
| 5 | Open the existing `Code.gs` file | Apps Script | 10s |
| 6 | **Replace all content** with the **Code.gs** code from Section 3 above | Apps Script | 1 min |
| 7 | Click ▶️ Run → Select `admin_SetupAllTabs` → Authorize when prompted | Apps Script | 2 min |
| **✓** | **3 tabs created, Weekly_Input is hidden** | Sheet | — |
| 8 | In the Sheet, right-click tab bar → `Show sheet` → `Weekly_Input` | Sheet | 10s |
| 9 | **Edit the Weekly_Input cells** (Column B) with this week's real data | Sheet | 10 min |
| 10 | Re-hide `Weekly_Input`: right-click tab → `Hide sheet` | Sheet | 5s |
| 11 | Back in Apps Script → Run `generateAndSendWeeklyReport` | Apps Script | 1 min |
| 12 | Check dk@isconline.vn inbox | Gmail | — |
| **✓** | **Email received — review the HTML rendering** | Gmail | — |
| 13 | If satisfied → forward to Kent before 4 PM | Gmail | 1 min |

### First-Time Authorization

When you run `admin_SetupAllTabs()` for the first time, Google will ask for permissions:
- **See, edit, create, and delete spreadsheets** (for tab creation)
- **Send email** (for GmailApp)
- **Manage Gmail labels** (for label creation)

Click `Advanced` → `Go to ISC_DigitalizationReport_4PMFriday (unsafe)` → `Allow`

This only happens once.

---

## 5. Cell Address Mapping

The `_readWeeklyInput()` function reads from these exact cells. This map ensures consistency:

| Cell | SheetBuilder writes | Code.gs reads | Content |
|---|---|---|---|
| B3 | `'Week 11'` | `input.weekNumber` | Week number |
| B4 | `'Mar 10–14, 2026'` | `input.dateRange` | Date range |
| B5 | `'🟢 On Track'` | `input.overallStatus` | Status badge |
| B8 | Achievement text | `input.achievement1` | Win #1 |
| B9 | Achievement text | `input.achievement2` | Win #2 |
| B10 | Blocker text | `input.blocker` | Blocker |
| B13 | `'65'` | `input.phase5Pct` | Phase 5 % |
| B14 | Testing note text | `input.testingNote` | Testing note |
| B15 | System health text | `input.systemHealth` | System health |
| B18 | `'Not started'` | `input.mplStatus` | MPL status |
| B19 | `'Not started'` | `input.csStatus` | CS status |
| B20 | `'Not started'` | `input.prdStatus` | PRD status |
| B23 | Action text | `input.nextAction1` | Plan #1 |
| B24 | Action text | `input.nextAction2` | Plan #2 |
| B25 | Action text | `input.nextAction3` | Plan #3 |
| B28 | AI spotlight text | `input.aiHighlight` | Tool tip |

> [!IMPORTANT]
> The cell addresses in this table are the **source of truth**. If the SheetBuilder layout changes, this table AND the `_readWeeklyInput()` function MUST be updated together.

---

## 6. Future Automation: Antigravity Push Workflow

Once the manual flow is working, the Antigravity → Sheet push cycle would look like:

```
Thursday evening (or earlier):
  1. Khánh tells Antigravity: "Update weekly report with these points: ..."
  2. Antigravity opens the Google Sheet browser
  3. Antigravity unhides Weekly_Input tab
  4. Antigravity fills in cells B3-B28 with the provided data
  5. Antigravity re-hides the tab

Friday 7:00 AM:
  6. Apps Script trigger fires
  7. Reads Weekly_Input → builds HTML → sends to dk@isconline.vn
  8. Appends row to Report_Log

Friday morning:
  9. Khánh opens inbox → reviews the email
  10. Forwards to Kent before 4 PM
```

This step is **not needed today** — today we test the manual flow. But the architecture supports it.

---

*End of Implementation Plan — V2*
*Ready for immediate execution.*
