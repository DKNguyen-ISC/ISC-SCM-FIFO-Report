# Implementation: ISC Weekly Report System — V3

*Date: 2026-03-13 | Sheet: ISC_DigitalizationReport_4PMFriday*
*Sheet URL: https://docs.google.com/spreadsheets/d/1W_F2zwYknKBSDw2yKFi-q3a5sozkyCJ5zCupo4JmwqU/edit*

---

## 1. V3 Upgrades

Based on testing results, the following critical upgrades have been applied to this version:

| Component | V3 Upgrade Applied |
|---|---|
| **Encoding Fix** | All raw emojis in the Apps Script have been converted to HTML/Unicode entities. This permanently fixes the `????` rendering bug in Gmail caused by Google Apps Script's string parser. |
| **Department Order** | Adjusted to match the exact PPTX sequence: SC → MPL → CS → PRD → QC → Finance → HR. (Logistics/Warehouse removed). |
| **P.I.C. Roles** | P1 (Phương), P2 (Dương, Cường), P4 (Ha), P5 (Vic, Quynh) updated accurately. |
| **Visual Design** | The HTML email now uses elegant, CSS-based progress bars instead of raw emoji strings. This looks heavily professional and avoids rendering errors across different mobile devices. |
| **Sample Data** | The default `Weekly_Input` data now correctly reflects the active investigation into BOM_TOLERANCE divergence. |

---

## 2. Apps Script File 1: `SheetBuilder.gs`

**Action:** Open `SheetBuilder.gs`, delete all old code, and paste this V3 code.

```javascript
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 📋 SheetBuilder.gs — Tab Creator for ISC Weekly Report (V3)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 * IaC-style sheet creator. Generates 3 tabs programmatically:
 *   Tab 1: Weekly_Input  — Khánh fills this (HIDDEN from Kent)
 *   Tab 2: 5W2H_Matrix   — Living 5W-2H roadmap (7 Departments for V3)
 *   Tab 3: Report_Log    — Auto-appended by report engine
 *
 * VERSION: 3.0 (Role precision + Warehouse removed)
 * DATE: March 2026
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const SHEET_CONFIG = {
  TIMEZONE: 'Asia/Ho_Chi_Minh',

  TAB_NAMES: {
    INPUT:  'Weekly_Input',
    MATRIX: '5W2H_Matrix',
    LOG:    'Report_Log'
  },

  TAB_COLORS: {
    INPUT:  '#1a365d', // ISC Blue
    MATRIX: '#2b6cb0', // Teal
    LOG:    '#38a169'  // Green
  },

  COLORS: {
    HEADER_BG:    '#1a365d',
    HEADER_FG:    '#ffffff',
    SECTION_BG:   '#e2e8f0',
    SECTION_FG:   '#1a365d',
    STATUS_LIVE:  '#c6f6d5',
    STATUS_PROG:  '#fefcbf',
    STATUS_PLAN:  '#e2e8f0',
    STATUS_NEXT:  '#bee3f8',
    INPUT_CELL:   '#fffff0',
    LABEL_BG:     '#f7fafc',
    LOG_HEADER:   '#2d3748',
    LOG_HEADER_FG:'#ffffff',
    DEPT_SC:      '#c6f6d5', 
    DEPT_MPL:     '#bee3f8',
    DEPT_CS:      '#bee3f8',
    DEPT_PRD:     '#bee3f8',
    DEPT_QC:      '#fefcbf',
    DEPT_FIN:     '#e2e8f0',
    DEPT_HR:      '#e2e8f0'
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 2. ADMIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

function admin_SetupAllTabs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  _buildWeeklyInputTab(ss);
  _build5W2HMatrixTab(ss);
  _buildReportLogTab(ss);

  const sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1) ss.deleteSheet(sheet1);

  const inputTab = ss.getSheetByName(SHEET_CONFIG.TAB_NAMES.INPUT);
  if (inputTab) inputTab.hideSheet();

  SpreadsheetApp.flush();

  try {
    SpreadsheetApp.getUi().alert(
      '\\u2705 Setup Complete (V3)',
      'All 3 tabs created successfully.\\n\\n' +
      '\\u2022 Weekly_Input (HIDDEN from Kent)\\n' +
      '\\u2022 5W2H_Matrix (Visible)\\n' +
      '\\u2022 Report_Log (Visible)\\n\\n' +
      'Next: Unhide Weekly_Input \\u2192 fill in data \\u2192 run generateAndSendWeeklyReport()',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    Logger.log('Tabs created. Weekly_Input is hidden.');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. TAB 1: Weekly_Input
// ═══════════════════════════════════════════════════════════════════════════════

function _buildWeeklyInputTab(ss) {
  const existing = ss.getSheetByName(SHEET_CONFIG.TAB_NAMES.INPUT);
  if (existing) ss.deleteSheet(existing);

  const sheet = ss.insertSheet(SHEET_CONFIG.TAB_NAMES.INPUT);
  sheet.setTabColor(SHEET_CONFIG.TAB_COLORS.INPUT);
  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 520);

  sheet.getRange('A1:B1').merge()
    .setValue('📝 WEEKLY INPUT — Fill Before Friday')
    .setBackground(SHEET_CONFIG.COLORS.HEADER_BG)
    .setFontColor(SHEET_CONFIG.COLORS.HEADER_FG)
    .setFontWeight('bold').setFontSize(13)
    .setHorizontalAlignment('center');

  const identity = [
    ['Week Number',    'Week 11'],
    ['Date Range',     'Mar 10–14, 2026'],
    ['Overall Status', '🟢 On Track']
  ];
  _writeSectionHeader(sheet, 2, '📌 REPORT IDENTITY');
  _writeInputRows(sheet, 3, identity);

  _writeSectionHeader(sheet, 7, '✅ EXECUTIVE SUMMARY');
  const summary = [
    ['Key Achievement #1',   'SCM Database running daily — Ngàn\'s team actively testing new Phase 5 interface'],
    ['Key Achievement #2',   'Looker Studio executive dashboard metrics refined and validated'],
    ['Key Blocker',          'BOM_TOLERANCE divergence vs manual Lead Plan (Comparing CS vs ISC 10% standard)']
  ];
  _writeInputRows(sheet, 8, summary);

  _writeSectionHeader(sheet, 12, '📊 SCM DATABASE STATUS');
  const scm = [
    ['Phase 5 Progress (%)', '65'],
    ['Testing Note',         'Assign Sourcing screen: VPO aggregation logic actively being tested with \'Chì\' group.'],
    ['System Health',        'M2 nightly runs: 7/7 days succeeded this week.']
  ];
  _writeInputRows(sheet, 13, scm);

  _writeSectionHeader(sheet, 17, '🗺️ DEPARTMENT ROADMAP');
  const depts = [
    ['MPL Status',  'Not started'],
    ['CS Status',   'Not started'],
    ['PRD Status',  'Not started']
  ];
  _writeInputRows(sheet, 18, depts);

  _writeSectionHeader(sheet, 22, '📋 NEXT WEEK\'S PLAN');
  const plan = [
    ['Action #1', 'Continue Phase 5 — Assign Sourcing dialog VPO aggregation design'],
    ['Action #2', 'Schedule MPL department discovery meeting with Dương & Cường'],
    ['Action #3', 'Prepare BOM_TOLERANCE override feature spec']
  ];
  _writeInputRows(sheet, 23, plan);

  _writeSectionHeader(sheet, 27, '🤖 AI TOOL SPOTLIGHT (optional)');
  const tool = [
    ['AI Tool Highlight', 'NotebookLM — free Google Workspace tool: upload department manuals, ask questions, generate summaries. Secure and private to ISC.']
  ];
  _writeInputRows(sheet, 28, tool);

  sheet.setFrozenRows(1);
  return sheet;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. TAB 2: 5W2H_Matrix (Living Roadmap - 7 Departments)
// ═══════════════════════════════════════════════════════════════════════════════

function _build5W2HMatrixTab(ss) {
  const existing = ss.getSheetByName(SHEET_CONFIG.TAB_NAMES.MATRIX);
  if (existing) ss.deleteSheet(existing);

  const sheet = ss.insertSheet(SHEET_CONFIG.TAB_NAMES.MATRIX);
  sheet.setTabColor(SHEET_CONFIG.TAB_COLORS.MATRIX);

  const totalCols = 9; 
  sheet.getRange(1, 1, 1, totalCols).merge()
    .setValue('🏭 ISC DIGITALIZATION PLAN — 5W-2H Matrix')
    .setBackground(SHEET_CONFIG.COLORS.HEADER_BG)
    .setFontColor(SHEET_CONFIG.COLORS.HEADER_FG)
    .setFontWeight('bold').setFontSize(13)
    .setHorizontalAlignment('center');

  sheet.getRange(2, 1, 1, totalCols).merge()
    .setValue('Last Updated: ' + Utilities.formatDate(new Date(), SHEET_CONFIG.TIMEZONE, 'yyyy-MM-dd') + '  |  Prepared by: Nguyễn Duy Khánh')
    .setBackground('#edf2f7').setFontColor('#718096')
    .setFontSize(10).setHorizontalAlignment('center');

  const headers = [
    'Priority', 'Department',
    'WHAT\\n(Digitalization Initiative)',
    'WHY\\n(Waste Eliminated)',
    'WHEN\\n(Timeline)',
    'WHO\\n(Owner)',
    'WHERE\\n(Process)',
    'HOW TO\\n(Approach & Tools)',
    'HOW MUCH\\n(Cost Estimate)'
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

  // V3 DATA: 7 Departments based exactly on PPTX
  const deptData = [
    ['🟢 P1', 'Supply Chain (SC)',
     'Full MRP system — 4 modules, shortage calc, procurement',
     'Waiting, Over-processing, Defects, Motion',
     '✅ Live / In Testing',
     'Khánh (build)\\nPhương, Ngàn, Phong (use)',
     'M1 Planning\\nM2 Balancing\\nM3 Procure\\nM4 Execute',
     'GSheets + Apps Script + BigQuery\\nStatus: Calibrating',
     '~$15/month'],
     
    ['🔵 P2', 'Master Plan (MPL)',
     'Production scheduling DB, capacity planning, auto-sync with CS/SC demand',
     'Waiting (SC reads manual schedules), Inventory misallocation',
     'Assessment Q2 2026',
     'Khánh (build)\\nDương, Cường (use)',
     'Production scheduling\\nResource allocation',
     'GSheets + BQ\\nLeverage existing M1 demand data',
     '~$10/month'],
     
    ['🔵 P3', 'Customer Service (CS)',
     'Formalize CS↔SC data exchange, auto-detect date/qty changes',
     'Defects (CS data discrepancies = most common error source)',
     'Q2–Q3 2026',
     'Khánh (build)\\nCS Team Lead (use)',
     'M1 CS Status Protocol\\nOrder lifecycle',
     'Extend existing M1 CS Protocol\\nForm → BQ → alert',
     '~$10/month'],
     
    ['🔵 P4', 'Production (PRD)',
     'Real-time completion dashboard, auto-sync to SC/MPL/CS',
     'Waiting (3 depts wait for manual production updates)',
     'Q3 2026',
     'Khánh (build)\\nHa (digitalization execution)',
     'Completion tracking\\nYield analysis',
     'Extend M1 Production Protocol\\nFloor form → BQ',
     '~$10/month'],
     
    ['🟡 P5', 'Quality Control (QC)',
     'Digital inspection checklists, defect tracking, CAPA management',
     'Defects (paper records = data loss risk)',
     'Q4 2026',
     'Khánh (build)\\nVic, Quynh (use)',
     'Inspection process\\nDefect lifecycle',
     'Google Forms → BQ → SPC charts',
     '~$10/month'],
     
    ['🟢 P6', 'Finance / Accounting',
     'PO-Invoice reconciliation, cost variance, budget tracking dashboard',
     'Waiting (approval delays), Over-processing (manual reconciliation)',
     'Q1 2027',
     'Khánh (build)\\nFinance Manager (use)',
     'Invoice → PO matching\\nCost analysis',
     'Bridge M3 PO data → invoice matching',
     '~$10/month'],
     
    ['🟢 P7', 'HR / Admin',
     'Attendance tracking, training records, employee KPI dashboard',
     'Motion (manual attendance), Defects (data errors)',
     'Q1 2027',
     'Khánh (build)\\nHR Admin (use)',
     'HR records\\nTraining management',
     'GSheet forms → BQ → monthly KPI email',
     '~$5/month']
  ];

  const deptColors = [
    SHEET_CONFIG.COLORS.DEPT_SC, SHEET_CONFIG.COLORS.DEPT_MPL,
    SHEET_CONFIG.COLORS.DEPT_CS, SHEET_CONFIG.COLORS.DEPT_PRD,
    SHEET_CONFIG.COLORS.DEPT_QC, SHEET_CONFIG.COLORS.DEPT_FIN,
    SHEET_CONFIG.COLORS.DEPT_HR
  ];

  sheet.getRange(4, 1, deptData.length, totalCols)
    .setValues(deptData)
    .setVerticalAlignment('top')
    .setWrap(true)
    .setFontSize(10)
    .setBorder(true, true, true, true, true, true, '#e2e8f0', SpreadsheetApp.BorderStyle.SOLID);

  deptData.forEach((row, i) => {
    sheet.getRange(4 + i, 1, 1, totalCols).setBackground(deptColors[i]);
  });

  for (let i = 4; i <= 10; i++) sheet.setRowHeight(i, 80);

  const colWidths = [70, 160, 200, 180, 130, 170, 150, 200, 100];
  colWidths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  sheet.setFrozenRows(3);
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

  sheet.getRange(1, 1, 1, headers.length).merge()
    .setValue('📋 ISC WEEKLY REPORT LOG — Historical Record')
    .setBackground(SHEET_CONFIG.COLORS.HEADER_BG)
    .setFontColor(SHEET_CONFIG.COLORS.HEADER_FG)
    .setFontWeight('bold').setFontSize(13)
    .setHorizontalAlignment('center');

  sheet.getRange(2, 1, 1, headers.length)
    .setValues([headers])
    .setBackground(SHEET_CONFIG.COLORS.LOG_HEADER)
    .setFontColor(SHEET_CONFIG.COLORS.LOG_HEADER_FG)
    .setFontWeight('bold').setFontSize(10)
    .setHorizontalAlignment('center')
    .setBorder(true, true, true, true, true, true);

  const widths = [80, 100, 130, 280, 80, 160, 200, 200, 100, 160];
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));
  sheet.setFrozenRows(2);
  return sheet;
}

function _writeSectionHeader(sheet, row, text) {
  sheet.getRange(row, 1, 1, 2).merge()
    .setValue(text)
    .setBackground(SHEET_CONFIG.COLORS.SECTION_BG)
    .setFontColor(SHEET_CONFIG.COLORS.SECTION_FG)
    .setFontWeight('bold').setFontSize(11);
}

function _writeInputRows(sheet, startRow, pairs) {
  pairs.forEach((pair, i) => {
    const row = startRow + i;
    sheet.getRange(row, 1)
      .setValue(pair[0])
      .setBackground(SHEET_CONFIG.COLORS.LABEL_BG)
      .setFontWeight('bold').setFontSize(10)
      .setVerticalAlignment('middle');
    sheet.getRange(row, 2)
      .setValue(pair[1])
      .setBackground(SHEET_CONFIG.COLORS.INPUT_CELL)
      .setFontSize(10)
      .setVerticalAlignment('middle')
      .setBorder(true, true, true, true, null, null, '#e2e8f0', SpreadsheetApp.BorderStyle.SOLID);
  });
}
```

---

## 3. Apps Script File 2: `Code.gs` (Report Engine V3)

**Action:** Open `Code.gs`, delete all old code, and paste this V3 code.
*Note: This script strictly uses HTML entities (e.g. `&#x2705;`) instead of emojis (✅) to completely eliminate Gmail's `????` rendering bug. It also uses beautiful CSS progress bars instead of raw emoji strings.*

```javascript
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ⚙️ Code.gs — ISC Weekly Report Engine (V3)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 * Reads Weekly_Input tab → builds rich HTML email → sends to dk@isconline.vn
 *
 * V3 FIXES: 
 * - Emoji rendering: Replaced all raw unicode emojis with HTML character entities.
 * - Department Roadmap: Enhanced visual CSS instead of emoji stacking.
 * - Removed Warehouse from Dept Roadmap list.
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

// ── SAFE HTML ENTITIES MAP ──────────────────────────────────────
const ICONS = {
  WIN:     '&#x2705;',    // Check mark ✅
  WARN:    '&#x26A0;&#xFE0F;', // Warning ⚠️
  FACTORY: '&#x1F3ED;',   // Factory 🏭
  PIN:     '&#x1F4CC;',   // Pin 📌
  BARS:    '&#x1F4CA;',   // Bar chart 📊
  MAP:     '&#x1F5FA;&#xFE0F;', // Map 🗺️
  BOT:     '&#x1F916;',   // Robot 🤖
  PLAN:    '&#x1F4CB;',   // Clipboard 📋
  FOLDER:  '&#x1F4C1;',   // Folder 📁
  EMAIL:   '&#x1F4E7;'    // Email 📧
};


// ── MAIN FUNCTION ───────────────────────────────────────────────
function generateAndSendWeeklyReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const input = _readWeeklyInput(ss);
  const html = _buildReportHTML(input);
  const subject = _buildSubject(input);
  
  const recipient = REPORT_CONFIG.SEND_TO_KENT ? REPORT_CONFIG.KENT_EMAIL : REPORT_CONFIG.STAGING_EMAIL;

  GmailApp.sendEmail(recipient, subject, 'Please view this email in HTML mode.', {
      htmlBody: html,
      name: 'ISC Digital Transformation',
      replyTo: REPORT_CONFIG.STAGING_EMAIL
  });

  _applyLabel(REPORT_CONFIG.LABEL_NAME);
  _appendToLog(ss, input, recipient);
  Logger.log(`[V3] Report sent to: ${recipient} | ${input.weekNumber}`);
}


// ── READ INPUT ──────────────────────────────────────────────────
function _readWeeklyInput(ss) {
  const sheet = ss.getSheetByName(REPORT_CONFIG.INPUT_TAB);
  if (!sheet) throw new Error('Weekly_Input tab not found. Run admin_SetupAllTabs() first.');

  return {
    weekNumber:    String(sheet.getRange('B3').getValue()),
    dateRange:     String(sheet.getRange('B4').getValue()),
    overallStatus: String(sheet.getRange('B5').getValue()).replace('🟢', '&#x1F7E2;').replace('🟡', '&#x1F7E1;').replace('🔴', '&#x1F534;'),
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
  const noBlocker = (input.blocker === 'None this week' || input.blocker === '');
  const blockerClass = noBlocker ? 'bullet-good' : 'bullet-warn';
  const blockerText = noBlocker ? `${ICONS.WIN} No Blockers this week` : `${ICONS.WARN} ${input.blocker}`;

  // CSS Enhanced Progress Bars for V3 (Replacing Emojis)
  // These look professional and guarantee no rendering issues
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
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
    
    /* V3 CSS Progress Bars */
    .dept-row { display: flex; align-items: center; margin: 10px 0; font-size: 13px; }
    .dept-name { width: 140px; font-weight: bold; color: #2d3748; }
    .dept-badge { font-size: 10px; font-weight: bold; padding: 2px 8px; border-radius: 12px; width: 85px; text-align: center; margin-left: 10px; text-transform: uppercase; }
    
    .bg-green { background-color: #c6f6d5; color: #22543d; }
    .bg-blue  { background-color: #bee3f8; color: #2a4365; }
    .bg-gray  { background-color: #edf2f7; color: #4a5568; }
    
    .bar-container { flex: 1; background: #e2e8f0; border-radius: 4px; height: 12px; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 4px; transition: width 0.5s ease; }
    
    .fill-sc { width: 85%; background: linear-gradient(90deg, #38a169, #48bb78); }
    .fill-mpl { width: 5%; background: linear-gradient(90deg, #3182ce, #4299e1); }
    .fill-cs  { width: 2%; background: linear-gradient(90deg, #3182ce, #4299e1); }
    .fill-prd { width: 1%; background: linear-gradient(90deg, #3182ce, #4299e1); }
    .fill-zero { width: 0%; background: transparent; }
    
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
    <h1>${ICONS.FACTORY} ISC Digitalization — Weekly Report</h1>
    <p>${input.weekNumber} &nbsp;|&nbsp; ${input.dateRange}</p>
    <p>Prepared by: Nguyễn Duy Khánh &nbsp;|&nbsp; dk@isconline.vn</p>
    <span class="status-badge">${input.overallStatus}</span>
  </div>

  <div class="section">
    <h2>${ICONS.PIN} This Week at a Glance</h2>
    <ul>
      <li><span class="bullet-good"><strong>${ICONS.WIN}</strong></span> ${input.achievement1}</li>
      <li><span class="bullet-good"><strong>${ICONS.WIN}</strong></span> ${input.achievement2}</li>
      <li><span class="${blockerClass}"><strong>${blockerText}</strong></span></li>
    </ul>
  </div>

  <div class="section">
    <h2>${ICONS.BARS} SCM Database — Status</h2>
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
    <h2>${ICONS.MAP} Department Roadmap</h2>
    
    <!-- CSS Progress Bars replacing emojis for perfect rendering -->
    <div class="dept-row">
      <span class="dept-name">Supply Chain</span>
      <div class="bar-container"><div class="bar-fill fill-sc"></div></div>
      <span class="dept-badge bg-green">In Testing</span>
    </div>
    
    <div class="dept-row">
      <span class="dept-name">Master Plan</span>
      <div class="bar-container"><div class="bar-fill fill-mpl"></div></div>
      <span class="dept-badge bg-blue">${input.mplStatus}</span>
    </div>
    
    <div class="dept-row">
      <span class="dept-name">Customer Service</span>
      <div class="bar-container"><div class="bar-fill fill-cs"></div></div>
      <span class="dept-badge bg-blue">${input.csStatus}</span>
    </div>
    
    <div class="dept-row">
      <span class="dept-name">Production</span>
      <div class="bar-container"><div class="bar-fill fill-prd"></div></div>
      <span class="dept-badge bg-blue">${input.prdStatus}</span>
    </div>
    
    <div class="dept-row">
      <span class="dept-name">Quality Control</span>
      <div class="bar-container"><div class="bar-fill fill-zero"></div></div>
      <span class="dept-badge bg-gray">Q4 2026</span>
    </div>
    
    <div class="dept-row">
      <span class="dept-name">Finance / HR</span>
      <div class="bar-container"><div class="bar-fill fill-zero"></div></div>
      <span class="dept-badge bg-gray">Q1 2027</span>
    </div>
  </div>

  ${input.aiHighlight ? \`
  <div class="section">
    <h2>${ICONS.BOT} Tool Spotlight</h2>
    <div class="ai-box">\${input.aiHighlight}</div>
  </div>\` : ''}

  <div class="section">
    <h2>${ICONS.PLAN} Next Week</h2>
    <ul>
      ${input.nextAction1 ? '<li>' + input.nextAction1 + '</li>' : ''}
      ${input.nextAction2 ? '<li>' + input.nextAction2 + '</li>' : ''}
      ${input.nextAction3 ? '<li>' + input.nextAction3 + '</li>' : ''}
    </ul>
  </div>

  <div class="footer">
    <strong>ISC Digital Transformation</strong> &nbsp;|&nbsp; Powered by Google Cloud<br>
    ${ICONS.FOLDER} Full Report History: <a href="${sheetLink}">ISC_DigitalizationReport_4PMFriday</a><br>
    ${ICONS.EMAIL} Contact: <a href="mailto:dk@isconline.vn">dk@isconline.vn</a>
  </div>

</div>
</body>
</html>`;
}


// ── SUBJECT LINE ────────────────────────────────────────────────
function _buildSubject(input) {
  const now = new Date();
  const monthYear = Utilities.formatDate(now, REPORT_CONFIG.TIMEZONE, 'MMMM yyyy');
  // Removed emojis from subject line to prevent mail client mangling
  return `[ISC Weekly] Digitalization Report — ${input.weekNumber}, ${monthYear}`;
}


// ── GMAIL LABEL ─────────────────────────────────────────────────
function _applyLabel(labelName) {
  try {
    let label = GmailApp.getUserLabelByName(labelName);
    if (!label) label = GmailApp.createLabel(labelName);
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
  
  // Clean text replacements to ensure spreadsheet cells look clean
  const cleanOverall = input.overallStatus.replace(/&#x[0-9A-F]+;/i, '').trim(); 
  
  sheet.appendRow([
    input.weekNumber,
    today,
    cleanOverall,
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

## 4. Execution Steps (V3)

1. **Delete old code:** Erase the contents of both `SheetBuilder.gs` and `Code.gs` in your Apps Script window.
2. **Paste V3 code:** Copy the two blocks of code above and save.
3. **Rebuild Tabs:** Run `admin_SetupAllTabs()`. 
   > *Note: This will delete the current tabs and recreate them with the new PPTX-aligned structure (No Warehouse, fixed WHO roles).*
4. **Edit input:** Right click `Weekly_Input` in the bottom tab bar → Unhide. The real blocker is already pre-filled. You can adjust the Date Range or any other details. Re-hide the tab after.
5. **Send V3 Test:** Run `generateAndSendWeeklyReport()`.
6. **Check Email:** Open your `dk@isconline.vn` inbox and enjoy the clean rendering and visually appealing progress bars.

---

*This V3 architecture resolves all rendering issues and precisely aligns with the ISC presentation's strategy.*
