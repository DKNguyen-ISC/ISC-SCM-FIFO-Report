/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SheetBuilder.gs — Tab Creator for ISC Weekly Report (V5 — Action Plan Edition)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 * IaC-style sheet creator. Generates 3 polished, infographic-style tabs:
 *   Tab 1: Weekly_Input  — Khanh fills this (HIDDEN & PROTECTED)
 *   Tab 2: 5W2H_Matrix   — Living 5W-2H roadmap (25 step-by-step rows, 7 Depts)
 *   Tab 3: Report_Log    — Auto-appended by report engine (HIDDEN & PROTECTED)
 *
 * V5 UPGRADES:
 * - 5W2H Matrix fundamentally redesigned into a 25-row, 10-column schema
 * - Multi-step rows per department (merged left/right columns)
 * - Pains/Gains in WHY column
 * - Mini progress bars per step
 * - Tab protection logic so only dk@isconline.vn can edit/view input & log tabs
 *
 * VERSION: 5.0
 * DATE: March 2026
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

var SB_CONFIG = {
  TIMEZONE: 'Asia/Ho_Chi_Minh',
  ADMIN_EMAIL: 'dk@isconline.vn',

  TAB_NAMES: {
    INPUT:  'Weekly_Input',
    MATRIX: '5W2H_Matrix',
    LOG:    'Report_Log'
  },

  TAB_COLORS: {
    INPUT:  '#1a365d',
    MATRIX: '#2b6cb0',
    LOG:    '#38a169'
  },

  COLORS: {
    HEADER_BG:    '#1a365d',
    HEADER_FG:    '#ffffff',
    SECTION_BG:   '#edf2f7',
    SECTION_FG:   '#1a365d',
    INPUT_CELL:   '#fffff0',
    LOG_HEADER:   '#2d3748',
    LOG_HEADER_FG:'#ffffff',
    BAND_EVEN:    '#f7fafc',
    BAND_ODD:     '#ffffff',
    SC_TINT:      '#c6f6d5', 
    MPL_TINT:     '#ebf8ff', 
    CS_TINT:      '#ebf8ff',
    GRAY_TINT:    '#f7fafc'
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 2. ADMIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════════════════

function admin_SetupAllTabs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  _buildWeeklyInputTab(ss);
  _build5W2HMatrixTab(ss);
  _buildReportLogTab(ss);

  var sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1) {
    try { ss.deleteSheet(sheet1); } catch (e) { /* ignore if only sheet */ }
  }

  // Hide and Protect Admin Tabs
  _protectTab(ss, SB_CONFIG.TAB_NAMES.INPUT);
  _protectTab(ss, SB_CONFIG.TAB_NAMES.LOG);

  SpreadsheetApp.flush();

  try {
    SpreadsheetApp.getUi().alert(
      '\u2705 V5 Setup Complete',
      'All 3 tabs created successfully.\n\n'
      + '\u2022 Weekly_Input (HIDDEN & PROTECTED)\n'
      + '\u2022 5W2H_Matrix (Visible - 25 row schema)\n'
      + '\u2022 Report_Log (HIDDEN & PROTECTED)\n\n'
      + 'Next: Unhide Weekly_Input temporarily \u2192 fill data \u2192 run generateAndSendWeeklyReport()',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    Logger.log('V5 tabs created. Weekly_Input and Report_Log are protected.');
  }
}

function _protectTab(ss, tabName) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return;
  
  sheet.hideSheet(); 
  
  var protection = sheet.protect().setDescription('Admin Only \u2014 ' + SB_CONFIG.ADMIN_EMAIL);
  var me = Session.getEffectiveUser();
  protection.addEditor(me);
  protection.removeEditors(protection.getEditors());
  if (protection.canDomainEdit()) {
    protection.setDomainEdit(false);
  }
  protection.addEditor(SB_CONFIG.ADMIN_EMAIL);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. TAB 1: Weekly_Input (Premium Layout)
// ═══════════════════════════════════════════════════════════════════════════════

function _buildWeeklyInputTab(ss) {
  var existing = ss.getSheetByName(SB_CONFIG.TAB_NAMES.INPUT);
  if (existing) ss.deleteSheet(existing);

  var sheet = ss.insertSheet(SB_CONFIG.TAB_NAMES.INPUT);
  sheet.setTabColor(SB_CONFIG.TAB_COLORS.INPUT);
  sheet.setColumnWidth(1, 240);
  sheet.setColumnWidth(2, 520);

  sheet.getRange('A1:B1').merge()
    .setValue('\uD83D\uDCDD ISC WEEKLY REPORT \u2014 Input Form')
    .setBackground(SB_CONFIG.COLORS.HEADER_BG)
    .setFontColor(SB_CONFIG.COLORS.HEADER_FG)
    .setFontWeight('bold').setFontSize(14)
    .setHorizontalAlignment('center');
  sheet.setRowHeight(1, 38);

  _writeSectionHeader(sheet, 2, '\uD83D\uDCCC REPORT IDENTITY');
  var identity = [
    ['Week Number',    'Week 11'],
    ['Date Range',     'Mar 10\u201314, 2026'],
    ['Overall Status', '\uD83D\uDFE2 On Track']
  ];
  _writeInputRows(sheet, 3, identity);

  _writeSectionHeader(sheet, 7, '\u2705 EXECUTIVE SUMMARY');
  var summary = [
    ['Key Achievement #1',    'SCM Database running daily \u2014 SC team actively testing Phase 5 Assign Sourcing interface'],
    ['Key Achievement #2',    'M4 Lead Issuance merge discrepancy fixed (\u00B10 variance achieved)'],
    ['Key Blocker \u26A0\uFE0F',  'BOM_TOLERANCE divergence: CS tolerance varies per SKU (3\u201320%), ISC uses fixed 10%. Causes net shortage mismatch vs Lead Plan.']
  ];
  _writeInputRows(sheet, 8, summary);

  _writeSectionHeader(sheet, 12, '\uD83D\uDCCA SCM DATABASE STATUS');
  var scm = [
    ['Phase 5 Progress (%)',   '65'],
    ['Testing Focus \uD83D\uDD0D',   'Assign Sourcing: VPO aggregation logic being tested with \'Ch\u00EC\' (PUBLIC) materials. Per-VPO MOQ ceiling causes over-ordering.'],
    ['System Health \uD83D\uDC9A',    'M2 nightly runs: 7/7 days \u2714\uFE0F | M1 CS Monitor: 0 new alerts | M4 issuance: \u00B10 variance']
  ];
  _writeInputRows(sheet, 13, scm);

  _writeSectionHeader(sheet, 17, '\uD83D\uDDFA\uFE0F DEPARTMENT ROADMAP');
  var depts = [
    ['MPL Status',   'Phase 1 \u2014 Discovery'],
    ['CS Status',    'Not started'],
    ['PRD Status',   'Not started']
  ];
  _writeInputRows(sheet, 18, depts);

  _writeSectionHeader(sheet, 22, '\uD83D\uDCCB NEXT WEEK\'S ACTIONS');
  var plan = [
    ['\uD83C\uDFAF Action #1',   'Continue Phase 5 \u2014 Assign Sourcing VPO aggregation design for PUBLIC materials'],
    ['\uD83D\uDCC5 Action #2',   'Schedule MPL department discovery meeting with D\u01B0\u01A1ng & C\u01B0\u1EDDng'],
    ['\uD83D\uDD27 Action #3',   'Design BOM_TOLERANCE override feature (allow ISC custom tolerance per BOM)']
  ];
  _writeInputRows(sheet, 23, plan);

  _writeSectionHeader(sheet, 27, '\uD83E\uDD16 AI TOOL SPOTLIGHT');
  var tool = [
    ['AI Tool \uD83D\uDCA1', 'NotebookLM \u2014 free Google Workspace tool. Upload department manuals, ask questions, generate audio summaries. \uD83D\uDD12 Secure: data stays in your Google account. \uD83D\uDCB0 Free. \u2601\uFE0F Cloud-native.']
  ];
  _writeInputRows(sheet, 28, tool);

  sheet.setFrozenRows(1);
  return sheet;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. TAB 2: 5W2H_Matrix (V6 35-Row Architecture)
// ═══════════════════════════════════════════════════════════════════════════════

function _build5W2HMatrixTab(ss) {
  var existing = ss.getSheetByName(SB_CONFIG.TAB_NAMES.MATRIX);
  if (existing) ss.deleteSheet(existing);

  var sheet = ss.insertSheet(SB_CONFIG.TAB_NAMES.MATRIX);
  sheet.setTabColor(SB_CONFIG.TAB_COLORS.MATRIX);

  var totalCols = 14;

  // ── Title (Row 1) ──
  sheet.getRange(1, 1, 1, totalCols).merge()
    .setValue('🏢 ISC DIGITALIZATION PLAN — 5W-2H Strategic Matrix')
    .setBackground(SB_CONFIG.COLORS.HEADER_BG)
    .setFontColor(SB_CONFIG.COLORS.HEADER_FG)
    .setFontWeight('bold').setFontSize(14)
    .setHorizontalAlignment('center');
  sheet.setRowHeight(1, 40);

  // ── Subtitle (Row 2) ──
  sheet.getRange(2, 1, 1, totalCols).merge()
    .setValue('Last Updated: ' + Utilities.formatDate(new Date(), SB_CONFIG.TIMEZONE, 'yyyy-MM-dd') + '  |  Prepared by: Nguyễn Duy Khánh  |  📧 dk@isconline.vn')
    .setBackground('#edf2f7').setFontColor('#718096')
    .setFontSize(10).setHorizontalAlignment('center');

  // ── Headers (Row 3 & Row 4) ──
  sheet.getRange(3, 1, 2, 1).merge().setValue('🏢\nDEPT');
  sheet.getRange(3, 2, 2, 1).merge().setValue('❓\nWHAT');
  sheet.getRange(3, 3, 1, 2).merge().setValue('⚡ WHY');
  sheet.getRange(3, 5, 2, 1).merge().setValue('📅\nWHEN');
  sheet.getRange(3, 6, 2, 1).merge().setValue('👤\nWHO');
  sheet.getRange(3, 7, 2, 1).merge().setValue('📍\nWHERE');
  sheet.getRange(3, 8, 1, 2).merge().setValue('🔧 HOW TO');
  sheet.getRange(3, 10, 2, 1).merge().setValue('📈\nStep Progress');
  sheet.getRange(3, 11, 2, 1).merge().setValue('💰\nHOW MUCH');
  sheet.getRange(3, 12, 2, 1).merge().setValue('📊\nTotal %');
  
  sheet.getRange(4, 3).setValue('Pain');
  sheet.getRange(4, 4).setValue('Gain');
  sheet.getRange(4, 8).setValue('Steps');
  sheet.getRange(4, 9).setValue('Tools');

  sheet.getRange(3, 1, 2, 12)
    .setBackground('#2d3748').setFontColor('#ffffff')
    .setFontWeight('bold').setFontSize(10)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true)
    .setBorder(true, true, true, true, true, true);
  sheet.setRowHeight(3, 30);
  sheet.setRowHeight(4, 22);

  // Column Widths
  var colWidths = [120, 200, 160, 160, 140, 120, 140, 240, 200, 100, 100, 90, 40, 40]; 
  for (var c = 0; c < colWidths.length; c++) {
    sheet.setColumnWidth(c + 1, colWidths[c]);
  }

  var currentRow = 5;

  // ── Data Blocks Definition ──
  var bar100 = '█████ ✅';
  var bar65  = '███░░ 65%';
  var bar40  = '██░░░ 40%';
  var bar00  = '░░░░░ 0%';

  // 1. Supply Chain (8 steps)
  var scWhat = '📋 Full MRP system — 4 modules covering Planning, Balancing, Procurement, and Execution';
  var scPain = '❌ 60+ min/day manual shortage\n❌ 5 Excel files cross-referenced\n❌ BOM_TOLERANCE mismatch';
  var scGain = '✅ Auto 4AM run — data ready\n✅ One BigQuery source of truth\n✅ Override framework planned';
  var scWhen = 'Start: Q3 2025\nTarget: Q2 2026\nStatus: Phase 5';
  var scSteps = [
    ['📐 Step 1: Schema Design & ERD', 'BigQuery (isc_scm_ops)', bar100],
    ['⚙️ Step 2: M1 Planning — PO Import', 'GSheets Zone A/B + Apps Script', bar100],
    ['🌙 Step 3: M2 Nightly MRP (4 AM)', 'Apps Script Trigger + HTML Email', bar100],
    ['🛒 Step 4: M3 PR→PO + Supplier Hub', 'BigQuery SP + GSheet Portal', bar100],
    ['🔄 Step 5: M4 Lead Issuance Sync', 'SP_M4_ISSUANCE_MERGE', bar100],
    ['🖥️ Step 6: Phase 5 — BOM Aggregation', 'BigQuery VIEW + UI Dialog', bar65],
    ['📊 Step 7: Looker Studio Dashboard', 'Looker Studio → BQ Views', bar100],
    ['🔧 Step 8: BOM_TOLERANCE Resolution', 'Custom tolerance override per BOM', bar40]
  ];
  currentRow = _insertDeptBlock(sheet, currentRow, totalCols, '📦 Supply Chain\n(SC)',
    scWhat, scPain, scGain, scWhen,
    '🛠️ Khánh (build)\n👥 Phương, Nam,\nNga, Thang\n(SC team)',
    '📦 Material Planning:\n • BOM demand\n • MOQ/SPQ\n • Shortage pipeline\n\n🛒 Procurement Flow:\n • PR → PO\n • Supplier portal\n • ZXH auto-sync',
    '~$15 / month', '87%', SB_CONFIG.COLORS.SC_TINT, scSteps);

  // 2. Master Plan (4 steps)
  var mplWhat = '📅 Production scheduling database with real-time sync to SC demand';
  var mplPain = '❌ SC reads manual MPL schedules\n❌ No real-time capacity view';
  var mplGain = '✅ Auto-sync with SC demand\n✅ Verified before cutover';
  var mplWhen = 'Start: Q2 2026\nTarget: Q3 2026\nStatus: Discovery';
  var mplSteps = [
    ['🔍 Step 1: Discovery — Interview MPL leads', '5W-2H worksheet', bar40],
    ['📝 Step 2: Design — Scheduling DB + ERD', 'BigQuery schema + GSheet', bar00],
    ['⚙️ Step 3: Build — Scheduling engine & SC sync', 'Apps Script + BQ views', bar00],
    ['🚀 Step 4: Pilot — Run parallel with manual', 'User testing protocol', bar00]
  ];
  currentRow = _insertDeptBlock(sheet, currentRow, totalCols, '🏢 Master Plan\n(MPL)',
    mplWhat, mplPain, mplGain, mplWhen,
    '🛠️ Khánh & Dương\n(build)\n👥 Dương & Cường\n(use)',
    'Production scheduling\nResource allocation',
    '~$10 / month', '5%', SB_CONFIG.COLORS.MPL_TINT, mplSteps);

  // 3. Customer Service (3 steps)
  var csWhat = '🔄 Formalized CS ↔ SC data exchange with automated discrepancy detection';
  var csPain = '❌ CS date/qty changes cause SC errors\n❌ Manual gap detection';
  var csGain = '✅ Auto-detect order changes instantly\n✅ Close order lifecycle loop completely';
  var csWhen = 'Start: Q2 2026\nTarget: Q3 2026\nStatus: Pending';
  var csSteps = [
    ['🔍 Step 1: Formalize CS↔SC data exchange', 'M1 CS Protocol expansion', bar00],
    ['📊 Step 2: Build CS discrepancy dashboard', 'Looker Studio Dashboard', bar00],
    ['🚀 Step 3: Extend M1 CS Protocol to full cycle', 'Google Sheets + BigQuery', bar00]
  ];
  currentRow = _insertDeptBlock(sheet, currentRow, totalCols, '🤝 Customer Svc\n(CS)',
    csWhat, csPain, csGain, csWhen,
    '🛠️ Khánh (build)\n👥 CS Team Lead',
    'M1 CS Status Protocol\nOrder lifecycle',
    '~$10 / month', '2%', SB_CONFIG.COLORS.CS_TINT, csSteps);

  // 4. Production (3 steps)
  var prdWhat = '⚙️ Real-time completion dashboard with auto-sync to SC, MPL, and CS';
  var prdPain = '❌ 3 depts wait for manual PRD emails\n❌ Delayed data entry';
  var prdGain = '✅ Real-time factory visibility\n✅ Closed-loop visibility chain';
  var prdWhen = 'Start: Q3 2026\nTarget: Q4 2026\nStatus: Pending';
  var prdSteps = [
    ['🔍 Step 1: Map completion tracking to digital', 'Process mapping', bar00],
    ['⚙️ Step 2: Factory floor form → BQ auto-sync', 'GForms/GSheet → BQ', bar00],
    ['📊 Step 3: Completion dashboard for SC/MPL', 'Looker Studio', bar00]
  ];
  currentRow = _insertDeptBlock(sheet, currentRow, totalCols, '⚙️ Production\n(PRD)',
    prdWhat, prdPain, prdGain, prdWhen,
    '🛠️ Khánh (build)\n👤 Ha (digitalize)',
    'Completion tracking\nYield analysis',
    '~$10 / month', '0%', SB_CONFIG.COLORS.GRAY_TINT, prdSteps);

  // 5. QC (3 steps)
  var qcWhat = '🔬 Digital inspection flows & SPC tracking directly to BigQuery';
  var qcPain = '❌ Paper records = data loss risk\n❌ Slow defect analysis';
  var qcGain = '✅ Pattern detection across batches\n✅ Defect → root cause → fix';
  var qcWhen = 'Start: Q4 2026\nTarget: Q1 2027\nStatus: Pending';
  var qcSteps = [
    ['📝 Step 1: Digital inspection checklists', 'Google Forms → BQ', bar00],
    ['📊 Step 2: Defect tracking + SPC charts', 'Looker Studio charts', bar00],
    ['📋 Step 3: CAPA management reports', 'Stored Procedures', bar00]
  ];
  currentRow = _insertDeptBlock(sheet, currentRow, totalCols, '🔬 Quality Control\n(QC)',
    qcWhat, qcPain, qcGain, qcWhen,
    '🛠️ Khánh (build)\n👥 Vic & Quynh',
    'Inspection process\nDefect lifecycle',
    '~$10 / month', '0%', SB_CONFIG.COLORS.GRAY_TINT, qcSteps);

  // 6. Finance (2 steps)
  var finWhat = '💰 Automated PO-Invoice reconciliation and cost variance dashboards';
  var finPain = '❌ Manual PO-invoice matching delays\n❌ Delayed variance tracking';
  var finGain = '✅ Instant variance reports\n✅ Budget tracking real-time';
  var finWhen = 'Start: Q1 2027\nTarget: Q1 2027\nStatus: Pending';
  var finSteps = [
    ['🔗 Step 1: PO-Invoice reconciliation', 'Bridge M3 PO data', bar00],
    ['📊 Step 2: Cost variance dashboard', 'Looker Studio', bar00]
  ];
  currentRow = _insertDeptBlock(sheet, currentRow, totalCols, '💰 Finance /\nAccounting',
    finWhat, finPain, finGain, finWhen,
    '🛠️ Khánh (build)\n👤 Finance Mgr',
    'Invoice → PO matching\nCost analysis',
    '~$10 / month', '0%', SB_CONFIG.COLORS.GRAY_TINT, finSteps);

  // 7. HR / Admin (2 steps)
  var hrWhat = '👥 Automated attendance & employee KPIs synced to central reporting';
  var hrPain = '❌ Manual attendance = data errors\n❌ Slow KPI reviews';
  var hrGain = '✅ Automated monthly summary\n✅ Error-free tracking';
  var hrWhen = 'Start: Q1 2027\nTarget: Q2 2027\nStatus: Pending';
  var hrSteps = [
    ['📝 Step 1: Attendance tracking (Form → BQ)', 'Google Forms → BQ', bar00],
    ['📊 Step 2: Employee KPI dashboard', 'Looker Studio', bar00]
  ];
  currentRow = _insertDeptBlock(sheet, currentRow, totalCols, '💼 HR / Admin',
    hrWhat, hrPain, hrGain, hrWhen,
    '🛠️ Khánh (build)\n👤 HR Admin',
    'HR records\nTraining management',
    '~$5 / month', '0%', SB_CONFIG.COLORS.GRAY_TINT, hrSteps);

  // Apply borders for the entire data area
  sheet.getRange(5, 1, currentRow - 5, 12)
    .setBorder(true, true, true, true, true, true, '#e2e8f0', SpreadsheetApp.BorderStyle.SOLID);
    
  sheet.setFrozenRows(4);
  return sheet;
}

function _insertDeptBlock(sheet, startRow, totalCols, deptName, what, pain, gain, whenText, who, where, cost, totalPct, bgColor, stepsArray) {
  var numRows = stepsArray.length;
  
  // 1. Write the per-step data (Cols H, I, J)
  for (var i = 0; i < numRows; i++) {
    var r = startRow + i;
    sheet.getRange(r, 8).setValue(stepsArray[i][0]).setWrap(true).setVerticalAlignment('middle').setFontSize(10).setBackground(bgColor); // H
    sheet.getRange(r, 9).setValue(stepsArray[i][1]).setWrap(true).setVerticalAlignment('middle').setFontSize(10).setBackground(bgColor); // I
    sheet.getRange(r, 10).setValue(stepsArray[i][2]).setVerticalAlignment('middle').setFontColor('#2b6cb0').setFontSize(10).setHorizontalAlignment('right').setBackground(bgColor); // J
    sheet.setRowHeight(r, 35); // Set reliable row height for steps
  }

  // 2. Merge Columns that are at department level
  // A: Dept
  sheet.getRange(startRow, 1, numRows, 1).merge().setValue(deptName)
    .setVerticalAlignment('middle').setHorizontalAlignment('center')
    .setFontWeight('bold').setFontSize(11).setBackground(bgColor);

  // B: What
  sheet.getRange(startRow, 2, numRows, 1).merge().setValue(what)
    .setVerticalAlignment('middle').setWrap(true).setFontSize(10).setBackground(bgColor);

  // C: Pain
  sheet.getRange(startRow, 3, numRows, 1).merge().setValue(pain)
    .setVerticalAlignment('middle').setWrap(true).setFontSize(10).setBackground(bgColor).setFontColor('#c53030');

  // D: Gain
  sheet.getRange(startRow, 4, numRows, 1).merge().setValue(gain)
    .setVerticalAlignment('middle').setWrap(true).setFontSize(10).setBackground(bgColor).setFontColor('#276749');

  // E: When
  sheet.getRange(startRow, 5, numRows, 1).merge().setValue(whenText)
    .setVerticalAlignment('middle').setWrap(true).setFontSize(10).setHorizontalAlignment('center').setBackground(bgColor).setFontFamily('monospace');

  // F: Who
  sheet.getRange(startRow, 6, numRows, 1).merge().setValue(who)
    .setVerticalAlignment('middle').setWrap(true).setFontSize(10).setBackground(bgColor);

  // G: Where
  sheet.getRange(startRow, 7, numRows, 1).merge().setValue(where)
    .setVerticalAlignment('middle').setWrap(true).setFontSize(10).setBackground(bgColor);

  // K: Cost
  sheet.getRange(startRow, 11, numRows, 1).merge().setValue(cost)
    .setVerticalAlignment('middle').setHorizontalAlignment('center').setWrap(true).setFontSize(10).setBackground(bgColor);

  // L: Total %
  sheet.getRange(startRow, 12, numRows, 1).merge().setValue(totalPct)
    .setVerticalAlignment('middle').setHorizontalAlignment('center')
    .setFontWeight('bold').setFontSize(16).setBackground(bgColor);

  // Separator Row (white spacing, 8px height)
  var sepRow = startRow + numRows;
  sheet.getRange(sepRow, 1, 1, totalCols).merge()
    .setBackground('#ffffff').setBorder(false, false, false, false, false, false);
  sheet.setRowHeight(sepRow, 8);

  return sepRow + 1;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. TAB 3: Report_Log (Historical Record)
// ═══════════════════════════════════════════════════════════════════════════════

function _buildReportLogTab(ss) {
  var existing = ss.getSheetByName(SB_CONFIG.TAB_NAMES.LOG);
  if (existing) ss.deleteSheet(existing);

  var sheet = ss.insertSheet(SB_CONFIG.TAB_NAMES.LOG);
  sheet.setTabColor(SB_CONFIG.TAB_COLORS.LOG);

  var headers = [
    '\uD83D\uDCC5 Week', '\uD83D\uDD52 Date Sent', '\uD83D\uDEA6 Status',
    '\u2705 Key Achievement', '\uD83D\uDCC8 Phase %',
    '\uD83C\uDFE2 Dept Active', '\uD83E\uDD16 AI Tool',
    '\u26A0\uFE0F Blocker', '\uD83D\uDCE7 Email', '\uD83D\uDC64 Sent To'
  ];

  sheet.getRange(1, 1, 1, headers.length).merge()
    .setValue('\uD83D\uDCCB ISC WEEKLY REPORT LOG \u2014 Historical Record')
    .setBackground(SB_CONFIG.COLORS.HEADER_BG)
    .setFontColor(SB_CONFIG.COLORS.HEADER_FG)
    .setFontWeight('bold').setFontSize(14)
    .setHorizontalAlignment('center');
  sheet.setRowHeight(1, 38);

  sheet.getRange(2, 1, 1, headers.length)
    .setValues([headers])
    .setBackground(SB_CONFIG.COLORS.LOG_HEADER)
    .setFontColor(SB_CONFIG.COLORS.LOG_HEADER_FG)
    .setFontWeight('bold').setFontSize(10)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true)
    .setBorder(true, true, true, true, true, true);
  sheet.setRowHeight(2, 36);

  var widths = [85, 110, 120, 280, 75, 160, 200, 220, 80, 160];
  for (var i = 0; i < widths.length; i++) {
    sheet.setColumnWidth(i + 1, widths[i]);
  }

  sheet.setFrozenRows(2);
  return sheet;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function _writeSectionHeader(sheet, row, text) {
  sheet.getRange(row, 1, 1, 2).merge()
    .setValue(text)
    .setBackground(SB_CONFIG.COLORS.SECTION_BG)
    .setFontColor(SB_CONFIG.COLORS.SECTION_FG)
    .setFontWeight('bold').setFontSize(11);
  sheet.setRowHeight(row, 28);
}

function _writeInputRows(sheet, startRow, pairs) {
  for (var i = 0; i < pairs.length; i++) {
    var row = startRow + i;
    var bgColor = (i % 2 === 0) ? SB_CONFIG.COLORS.BAND_EVEN : SB_CONFIG.COLORS.BAND_ODD;

    sheet.getRange(row, 1)
      .setValue(pairs[i][0])
      .setBackground(bgColor)
      .setFontWeight('bold').setFontSize(10)
      .setVerticalAlignment('middle');
    sheet.getRange(row, 2)
      .setValue(pairs[i][1])
      .setBackground(SB_CONFIG.COLORS.INPUT_CELL)
      .setFontSize(10)
      .setVerticalAlignment('middle')
      .setWrap(true)
      .setBorder(true, true, true, true, null, null, '#e2e8f0', SpreadsheetApp.BorderStyle.SOLID);
    sheet.setRowHeight(row, 35);
  }
}