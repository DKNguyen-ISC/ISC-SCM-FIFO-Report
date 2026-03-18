/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SheetBuilder.gs — Tab Creator for ISC Weekly Report (V6 — Full 5W2H Edition)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 * IaC-style sheet creator. Generates 3 polished infographic-style tabs:
 *   Tab 1: Weekly_Input  — Khanh fills this (HIDDEN & PROTECTED)
 *   Tab 2: 5W2H_Matrix   — Living 5W-2H roadmap (all 7 depts, 25 steps)
 *   Tab 3: Report_Log    — Auto-appended by report engine (HIDDEN & PROTECTED)
 *
 * V6 UPGRADES vs V5:
 * - Step icons: semantic emoji per activity type
 *     🏗️ Architecture/ERD  ⚙️ Build/Configure  🌙 Nightly/Scheduled
 *     🛒 Procurement       🔄 Sync/Integration  📊 Dashboard/Report
 *     🔧 Fix/Override      🔍 Discovery         🏃 Pilot/UAT
 *     📋 Form/Checklist    📈 Analytics chart   🔗 Link/Bridge
 * - Tools column: icon + technology name pairs for instant recognition
 *     🗄️ BigQuery   📊 GSheets   ⚙️ Apps Script   📈 Looker Studio
 *     📋 GForms     🔧 SQL SP    📧 HTML Email     🧪 UAT Protocol
 * - All steps and tools aligned with V6 Code.gs full email reader
 *
 * VERSION: 6.0
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
    SC_TINT:      '#c6f6d5',   // green  — active
    MPL_TINT:     '#ebf8ff',   // blue   — discovery
    CS_TINT:      '#ebf8ff',   // blue   — pending
    GRAY_TINT:    '#f7fafc'    // gray   — future
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

  _protectTab(ss, SB_CONFIG.TAB_NAMES.INPUT);
  _protectTab(ss, SB_CONFIG.TAB_NAMES.LOG);

  SpreadsheetApp.flush();

  try {
    SpreadsheetApp.getUi().alert(
      '\u2705 V6 Setup Complete',
      'All 3 tabs created successfully.\n\n'
      + '\u2022 Weekly_Input (HIDDEN & PROTECTED)\n'
      + '\u2022 5W2H_Matrix (Visible \u2014 7 depts, 25 steps, semantic icons)\n'
      + '\u2022 Report_Log (HIDDEN & PROTECTED)\n\n'
      + 'Next: Unhide Weekly_Input \u2192 fill data \u2192 run generateAndSendWeeklyReport()',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    Logger.log('V6 tabs created. Weekly_Input and Report_Log are protected.');
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
    ['Key Achievement #1',   'SCM Database running daily \u2014 SC team actively testing Phase 5 Assign Sourcing interface'],
    ['Key Achievement #2',   'M4 Lead Issuance merge discrepancy fixed (\u00B10 variance achieved)'],
    ['Key Blocker \u26A0\uFE0F', 'BOM_TOLERANCE divergence: CS tolerance varies per SKU (3\u201320%), ISC uses fixed 10%. Causes net shortage mismatch vs Lead Plan.']
  ];
  _writeInputRows(sheet, 8, summary);

  _writeSectionHeader(sheet, 12, '\uD83D\uDCCA SCM DATABASE STATUS');
  var scm = [
    ['Phase 5 Progress (%)',  '65'],
    ['Testing Focus \uD83D\uDD0D',  'Assign Sourcing: VPO aggregation logic being tested with \'Ch\u00EC\' (PUBLIC) materials. Per-VPO MOQ ceiling causes over-ordering.'],
    ['System Health \uD83D\uDC9A',   'M2 nightly runs: 7/7 days \u2714\uFE0F | M1 CS Monitor: 0 new alerts | M4 issuance: \u00B10 variance']
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
    ['\uD83C\uDFAF Action #1',  'Continue Phase 5 \u2014 Assign Sourcing VPO aggregation design for PUBLIC materials'],
    ['\uD83D\uDCC5 Action #2',  'Schedule MPL department discovery meeting with D\u01B0\u01A1ng & C\u01B0\u1EDDng'],
    ['\uD83D\uDD27 Action #3',  'Design BOM_TOLERANCE override feature (allow ISC custom tolerance per BOM)']
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
// 4. TAB 2: 5W2H_Matrix (V6 — Semantic Icons + Tool Badges)
// ═══════════════════════════════════════════════════════════════════════════════
//
// STEP ICON LEGEND:
//   🏗️  Architecture / Schema / ERD design
//   ⚙️  Build / Configure / Code / Engine
//   🌙  Nightly / Scheduled / Automated job
//   🛒  Procurement / PO / Purchasing flow
//   🔄  Sync / Integration / Data bridge
//   📊  Dashboard / Visualization / Report view
//   📈  Analytics / Chart / KPI tracking
//   🔧  Fix / Override / Resolve / CAPA
//   🔍  Discovery / Interview / Research
//   📐  Design / Blueprint / Wireframe
//   🚀  Pilot / Launch / UAT / Go-Live
//   📋  Form / Checklist / Structured input
//   🔗  Link / Connect / Reconcile
//
// TOOL ICON LEGEND (in Tools column):
//   🗄️  BigQuery (data warehouse + stored procedures)
//   📊  Google Sheets (GSheets / GSheet Portal)
//   ⚙️  Apps Script (automation + triggers)
//   📈  Looker Studio (dashboard + charts)
//   📋  Google Forms (data input)
//   🔧  SQL Stored Procedure (SP_*)
//   📧  HTML Email (automated alerts)
//   🧪  UAT / Testing protocol
//   ☁️  Google Cloud Platform (GCP)
//
// ═══════════════════════════════════════════════════════════════════════════════

function _build5W2HMatrixTab(ss) {
  var existing = ss.getSheetByName(SB_CONFIG.TAB_NAMES.MATRIX);
  if (existing) ss.deleteSheet(existing);

  var sheet = ss.insertSheet(SB_CONFIG.TAB_NAMES.MATRIX);
  sheet.setTabColor(SB_CONFIG.TAB_COLORS.MATRIX);

  var totalCols = 14;

  // ── Title (Row 1) ──
  sheet.getRange(1, 1, 1, totalCols).merge()
    .setValue('\uD83C\uDFE2 ISC DIGITALIZATION PLAN \u2014 5W-2H Strategic Matrix')
    .setBackground(SB_CONFIG.COLORS.HEADER_BG)
    .setFontColor(SB_CONFIG.COLORS.HEADER_FG)
    .setFontWeight('bold').setFontSize(14)
    .setHorizontalAlignment('center');
  sheet.setRowHeight(1, 40);

  // ── Subtitle (Row 2) ──
  sheet.getRange(2, 1, 1, totalCols).merge()
    .setValue('Last Updated: ' + Utilities.formatDate(new Date(), SB_CONFIG.TIMEZONE, 'yyyy-MM-dd')
    + '  |  Prepared by: Nguy\u1EC5n Duy Kh\u00E1nh  |  \uD83D\uDCE7 dk@isconline.vn')
    .setBackground('#edf2f7').setFontColor('#718096')
    .setFontSize(10).setHorizontalAlignment('center');

  // ── Column Headers (Row 3 & Row 4) ──
  // 5W: WHAT | WHY (Pain/Gain) | WHEN | WHO | WHERE
  // 2H: HOW (Steps/Tools) | HOW MUCH
  // Extra: Step Progress | Total %
  sheet.getRange(3, 1,  2, 1).merge().setValue('\uD83C\uDFE2\nDEPT');
  sheet.getRange(3, 2,  2, 1).merge().setValue('\u2753\nWHAT');
  sheet.getRange(3, 3,  1, 2).merge().setValue('\u26A1 WHY');
  sheet.getRange(3, 5,  2, 1).merge().setValue('\uD83D\uDCC5\nWHEN');
  sheet.getRange(3, 6,  2, 1).merge().setValue('\uD83D\uDC64\nWHO');
  sheet.getRange(3, 7,  2, 1).merge().setValue('\uD83D\uDCCD\nWHERE');
  sheet.getRange(3, 8,  1, 2).merge().setValue('\uD83D\uDD27 HOW TO');
  sheet.getRange(3, 10, 2, 1).merge().setValue('\uD83D\uDCC8\nStep Progress');
  sheet.getRange(3, 11, 2, 1).merge().setValue('\uD83D\uDCCA\nTotal %');
  sheet.getRange(3, 12, 2, 1).merge().setValue('\uD83D\uDCB0\nHOW MUCH');

  sheet.getRange(4, 3).setValue('\uD83E\uDD15 Pain');
  sheet.getRange(4, 4).setValue('\uD83C\uDF1F Gain');
  sheet.getRange(4, 8).setValue('\uD83D\uDD22 Steps');
  sheet.getRange(4, 9).setValue('\uD83D\uDEE0\uFE0F Tools');

  sheet.getRange(3, 1, 2, 12)
    .setBackground('#2d3748').setFontColor('#ffffff')
    .setFontWeight('bold').setFontSize(10)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true)
    .setBorder(true, true, true, true, true, true);
  sheet.setRowHeight(3, 32);
  sheet.setRowHeight(4, 24);

  // ── Column Widths ──
  var colWidths = [120, 200, 160, 160, 140, 130, 150, 250, 220, 105, 90, 100, 40, 40];
  for (var c = 0; c < colWidths.length; c++) {
    sheet.setColumnWidth(c + 1, colWidths[c]);
  }

  var currentRow = 5;

  // ── Progress bar text values ──
  var bar100 = '\u2588\u2588\u2588\u2588\u2588 \u2705';   // █████ ✅
  var bar65  = '\u2588\u2588\u2588\u2591\u2591 65%';      // ███░░ 65%
  var bar40  = '\u2588\u2588\u2591\u2591\u2591 40%';      // ██░░░ 40%
  var bar00  = '\u2591\u2591\u2591\u2591\u2591 0%';       // ░░░░░ 0%

  // ══════════════════════════════════════════════════════════════
  // 1. SUPPLY CHAIN (SC) — 8 Steps
  //    Status: Phase 5 active (87% overall)
  //    Tint: Green (most active dept)
  // ══════════════════════════════════════════════════════════════
  var scWhat = '\uD83D\uDCCB Full MRP system \u2014 4 modules covering Planning, Balancing, Procurement, and Execution';
  var scPain =
    '\u274C 60+ min/day manual shortage calculation\n'
  + '\u274C 5 Excel files cross-referenced daily\n'
  + '\u274C BOM_TOLERANCE mismatch vs Lead Plan';
  var scGain =
    '\u2705 Auto 4AM run \u2014 data ready before shift\n'
  + '\u2705 One BigQuery source of truth\n'
  + '\u2705 Custom tolerance override framework';
  var scWhen = 'Start: Q3 2025\nTarget: Q2 2026\nStatus: Phase 5';
  var scSteps = [
    // [Step name,  Tool description,  Progress bar]
    ['\uD83C\uDFD7\uFE0F Step 1: Schema Design & ERD',
     '\uD83D\uDDC4\uFE0F BigQuery  \u2022  \uD83D\uDCCF ERD Design',
     bar100],

    ['\u2699\uFE0F Step 2: M1 Planning \u2014 PO Import',
     '\uD83D\uDCCA GSheets Zone A/B  \u2022  \u2699\uFE0F Apps Script',
     bar100],

    ['\uD83C\uDF19 Step 3: M2 Nightly MRP (4 AM)',
     '\u23F0 Apps Script Trigger  \u2022  \uD83D\uDCE7 HTML Email',
     bar100],

    ['\uD83D\uDED2 Step 4: M3 PR\u2192PO + Supplier Portal',
     '\uD83D\uDDC4\uFE0F BigQuery SP  \u2022  \uD83D\uDCCA GSheet Portal',
     bar100],

    ['\uD83D\uDD04 Step 5: M4 Lead Issuance Sync',
     '\uD83D\uDD27 SP_M4_ISSUANCE_MERGE',
     bar100],

    ['\uD83D\uDCCA Step 6: Phase 5 \u2014 BOM Aggregation',
     '\uD83D\uDDC4\uFE0F BigQuery VIEW  \u2022  \uD83D\uDCAC UI Dialog',
     bar65],

    ['\uD83D\uDCC8 Step 7: Looker Studio Dashboard',
     '\uD83D\uDCC8 Looker Studio  \u2022  \uD83D\uDDC4\uFE0F BQ Views',
     bar100],

    ['\uD83D\uDD27 Step 8: BOM_TOLERANCE Resolution',
     '\u2699\uFE0F Apps Script  \u2022  \uD83D\uDDC4\uFE0F Custom BQ Override',
     bar40]
  ];
  currentRow = _insertDeptBlock(sheet, currentRow, totalCols,
    '\uD83D\uDCE6 Supply Chain\n(SC)',
    scWhat, scPain, scGain, scWhen,
    '\uD83D\uDD28 Kh\u00E1nh (build)\n\uD83D\uDC65 Ph\u01B0\u01A1ng, Nam,\nNga, Thang\n(SC team)',
    '\uD83D\uDCE6 Material Planning:\n \u2022 BOM demand\n \u2022 MOQ/SPQ\n \u2022 Shortage pipeline\n\n\uD83D\uDED2 Procurement Flow:\n \u2022 PR \u2192 PO\n \u2022 Supplier portal\n \u2022 ZXH auto-sync',
    '~$15 / month', '87%', SB_CONFIG.COLORS.SC_TINT, scSteps);

  // ══════════════════════════════════════════════════════════════
  // 2. MASTER PLAN (MPL) — 4 Steps
  //    Status: Discovery phase
  //    Tint: Blue
  // ══════════════════════════════════════════════════════════════
  var mplWhat = '\uD83D\uDCC5 Production scheduling database with real-time sync to SC demand';
  var mplPain =
    '\u274C SC reads manual MPL schedules via email\n'
  + '\u274C No real-time capacity visibility\n'
  + '\u274C Planning mismatch causes SC recalculation';
  var mplGain =
    '\u2705 Auto-sync MPL capacity with SC demand\n'
  + '\u2705 Verified scheduling before cutover\n'
  + '\u2705 End-to-end production visibility';
  var mplWhen = 'Start: Q2 2026\nTarget: Q3 2026\nStatus: Discovery';
  var mplSteps = [
    ['\uD83D\uDD0D Step 1: Discovery \u2014 Interview MPL leads',
     '\uD83D\uDCCB 5W-2H Workshop  \u2022  \uD83D\uDCDD Interview',
     bar40],

    ['\uD83C\uDFD7\uFE0F Step 2: Design \u2014 Scheduling DB & ERD',
     '\uD83D\uDDC4\uFE0F BigQuery  \u2022  \uD83D\uDCCA GSheet',
     bar00],

    ['\u2699\uFE0F Step 3: Build \u2014 Scheduling engine & SC sync',
     '\u2699\uFE0F Apps Script  \u2022  \uD83D\uDDC4\uFE0F BQ Views',
     bar00],

    ['\uD83D\uDE80 Step 4: Pilot \u2014 Run parallel with manual',
     '\uD83E\uDDEA UAT Protocol  \u2022  \uD83D\uDCCA GSheet',
     bar00]
  ];
  currentRow = _insertDeptBlock(sheet, currentRow, totalCols,
    '\uD83C\uDFE2 Master Plan\n(MPL)',
    mplWhat, mplPain, mplGain, mplWhen,
    '\uD83D\uDD28 Kh\u00E1nh & D\u01B0\u01A1ng\n(build)\n\uD83D\uDC65 D\u01B0\u01A1ng & C\u01B0\u1EDDng\n(use)',
    'Production scheduling\nResource allocation\nCapacity planning',
    '~$10 / month', '5%', SB_CONFIG.COLORS.MPL_TINT, mplSteps);

  // ══════════════════════════════════════════════════════════════
  // 3. CUSTOMER SERVICE (CS) — 3 Steps
  //    Status: Pending (depends on SC stabilization)
  //    Tint: Blue
  // ══════════════════════════════════════════════════════════════
  var csWhat = '\uD83D\uDD04 Formalized CS \u2194 SC data exchange with automated discrepancy detection';
  var csPain =
    '\u274C CS date/qty changes cause undetected SC errors\n'
  + '\u274C Manual gap detection is slow and error-prone\n'
  + '\u274C Order lifecycle is not closed-loop';
  var csGain =
    '\u2705 Auto-detect order changes vs production plan\n'
  + '\u2705 Close the order lifecycle loop completely\n'
  + '\u2705 Reduce SC-CS firefighting';
  var csWhen = 'Start: Q2 2026\nTarget: Q3 2026\nStatus: Pending';
  var csSteps = [
    ['\uD83D\uDD0D Step 1: Formalize CS \u2194 SC data exchange',
     '\uD83D\uDCCB M1 CS Protocol  \u2022  \uD83D\uDCCA GSheets',
     bar00],

    ['\uD83D\uDCCA Step 2: CS discrepancy dashboard',
     '\uD83D\uDCC8 Looker Studio  \u2022  \uD83D\uDDC4\uFE0F BigQuery',
     bar00],

    ['\uD83D\uDE80 Step 3: Extend M1 CS Protocol \u2014 full cycle',
     '\uD83D\uDCCA GSheets  \u2022  \uD83D\uDDC4\uFE0F BigQuery',
     bar00]
  ];
  currentRow = _insertDeptBlock(sheet, currentRow, totalCols,
    '\uD83E\uDD1D Customer Svc\n(CS)',
    csWhat, csPain, csGain, csWhen,
    '\uD83D\uDD28 Kh\u00E1nh (build)\n\uD83D\uDC65 CS Team Lead',
    'M1 CS Status Protocol\nOrder lifecycle\nDiscrepancy alerts',
    '~$10 / month', '2%', SB_CONFIG.COLORS.CS_TINT, csSteps);

  // ══════════════════════════════════════════════════════════════
  // 4. PRODUCTION (PRD) — 3 Steps
  //    Status: Future (Q3 2026)
  //    Tint: Gray
  // ══════════════════════════════════════════════════════════════
  var prdWhat = '\u2699\uFE0F Real-time completion dashboard with auto-sync to SC, MPL, and CS';
  var prdPain =
    '\u274C SC, MPL, CS wait for manual PRD completion emails\n'
  + '\u274C Delayed data entry causes downstream re-planning\n'
  + '\u274C No yield or efficiency data captured digitally';
  var prdGain =
    '\u2705 Real-time factory floor visibility for all depts\n'
  + '\u2705 Closed-loop visibility: SC \u2192 PRD \u2192 CS\n'
  + '\u2705 Digital yield + efficiency analysis';
  var prdWhen = 'Start: Q3 2026\nTarget: Q4 2026\nStatus: Pending';
  var prdSteps = [
    ['\uD83D\uDD0D Step 1: Map completion tracking to digital',
     '\uD83D\uDCCB Process Mapping  \u2022  \uD83D\uDCDD Workshop',
     bar00],

    ['\u2699\uFE0F Step 2: Factory floor input \u2192 BQ auto-sync',
     '\uD83D\uDCCB GForms  \u2022  \uD83D\uDDC4\uFE0F BigQuery',
     bar00],

    ['\uD83D\uDCC8 Step 3: Completion dashboard for SC & MPL',
     '\uD83D\uDCC8 Looker Studio  \u2022  \uD83D\uDDC4\uFE0F BQ Views',
     bar00]
  ];
  currentRow = _insertDeptBlock(sheet, currentRow, totalCols,
    '\u2699\uFE0F Production\n(PRD)',
    prdWhat, prdPain, prdGain, prdWhen,
    '\uD83D\uDD28 Kh\u00E1nh (build)\n\uD83D\uDC64 Ha (digitalize)',
    'Completion tracking\nYield analysis\nFactory floor input',
    '~$10 / month', '0%', SB_CONFIG.COLORS.GRAY_TINT, prdSteps);

  // ══════════════════════════════════════════════════════════════
  // 5. QUALITY CONTROL (QC) — 3 Steps
  //    Status: Future (Q4 2026)
  //    Tint: Gray
  // ══════════════════════════════════════════════════════════════
  var qcWhat = '\uD83D\uDD2C Digital inspection flows & SPC tracking directly to BigQuery';
  var qcPain =
    '\u274C Paper-based inspection = data loss risk\n'
  + '\u274C Slow defect analysis \u2014 patterns invisible\n'
  + '\u274C CAPA management is manual and ad hoc';
  var qcGain =
    '\u2705 Pattern detection across batches in real-time\n'
  + '\u2705 Defect \u2192 root cause \u2192 fix loop closed\n'
  + '\u2705 Digital CAPA records + SPC alerts';
  var qcWhen = 'Start: Q4 2026\nTarget: Q1 2027\nStatus: Pending';
  var qcSteps = [
    ['\uD83D\uDCCB Step 1: Digital inspection checklists',
     '\uD83D\uDCCB GForms  \u2022  \uD83D\uDDC4\uFE0F BigQuery',
     bar00],

    ['\uD83D\uDCCA Step 2: Defect tracking & SPC charts',
     '\uD83D\uDCC8 Looker Studio  \u2022  \uD83D\uDCCA GSheets',
     bar00],

    ['\uD83D\uDD27 Step 3: CAPA management reports',
     '\uD83D\uDD27 Stored Procedures  \u2022  \uD83D\uDCC8 Looker',
     bar00]
  ];
  currentRow = _insertDeptBlock(sheet, currentRow, totalCols,
    '\uD83D\uDD2C Quality Control\n(QC)',
    qcWhat, qcPain, qcGain, qcWhen,
    '\uD83D\uDD28 Kh\u00E1nh (build)\n\uD83D\uDC65 Vic & Quynh',
    'Inspection process\nDefect lifecycle\nSPC tracking',
    '~$10 / month', '0%', SB_CONFIG.COLORS.GRAY_TINT, qcSteps);

  // ══════════════════════════════════════════════════════════════
  // 6. FINANCE / ACCOUNTING — 2 Steps
  //    Status: Future (Q1 2027)
  //    Tint: Gray
  // ══════════════════════════════════════════════════════════════
  var finWhat = '\uD83D\uDCB0 Automated PO\u2013Invoice reconciliation and cost variance dashboards';
  var finPain =
    '\u274C Manual PO-invoice matching causes payment delays\n'
  + '\u274C Delayed cost variance tracking\n'
  + '\u274C No real-time budget visibility';
  var finGain =
    '\u2705 Instant variance reports on every PO\n'
  + '\u2705 Real-time budget tracking across depts\n'
  + '\u2705 Automated month-end reconciliation';
  var finWhen = 'Start: Q1 2027\nTarget: Q2 2027\nStatus: Pending';
  var finSteps = [
    ['\uD83D\uDD04 Step 1: PO\u2013Invoice reconciliation',
     '\uD83D\uDD27 Bridge M3 PO data  \u2022  \uD83D\uDDC4\uFE0F BigQuery',
     bar00],

    ['\uD83D\uDCCA Step 2: Cost variance dashboard',
     '\uD83D\uDCC8 Looker Studio  \u2022  \uD83D\uDDC4\uFE0F BQ Views',
     bar00]
  ];
  currentRow = _insertDeptBlock(sheet, currentRow, totalCols,
    '\uD83D\uDCB0 Finance /\nAccounting',
    finWhat, finPain, finGain, finWhen,
    '\uD83D\uDD28 Kh\u00E1nh (build)\n\uD83D\uDC64 Finance Mgr',
    'Invoice \u2192 PO matching\nCost analysis\nBudget tracking',
    '~$10 / month', '0%', SB_CONFIG.COLORS.GRAY_TINT, finSteps);

  // ══════════════════════════════════════════════════════════════
  // 7. HR / ADMIN — 2 Steps
  //    Status: Future (Q1-Q2 2027)
  //    Tint: Gray
  // ══════════════════════════════════════════════════════════════
  var hrWhat = '\uD83D\uDC65 Automated attendance & employee KPIs synced to central reporting';
  var hrPain =
    '\u274C Manual attendance tracking = frequent data errors\n'
  + '\u274C Slow monthly KPI reviews\n'
  + '\u274C Training records not centralized';
  var hrGain =
    '\u2705 Automated monthly attendance summary\n'
  + '\u2705 Error-free KPI tracking for all employees\n'
  + '\u2705 Centralized HR records in BigQuery';
  var hrWhen = 'Start: Q1 2027\nTarget: Q2 2027\nStatus: Pending';
  var hrSteps = [
    ['\uD83D\uDCCB Step 1: Attendance tracking (Form \u2192 BQ)',
     '\uD83D\uDCCB GForms  \u2022  \uD83D\uDDC4\uFE0F BigQuery',
     bar00],

    ['\uD83D\uDCC8 Step 2: Employee KPI dashboard',
     '\uD83D\uDCC8 Looker Studio  \u2022  \uD83D\uDCCA GSheets',
     bar00]
  ];
  currentRow = _insertDeptBlock(sheet, currentRow, totalCols,
    '\uD83D\uDCBC HR / Admin',
    hrWhat, hrPain, hrGain, hrWhen,
    '\uD83D\uDD28 Kh\u00E1nh (build)\n\uD83D\uDC64 HR Admin',
    'HR records\nAttendance\nTraining management',
    '~$5 / month', '0%', SB_CONFIG.COLORS.GRAY_TINT, hrSteps);

  // ── Apply borders to the whole data area ──
  sheet.getRange(5, 1, currentRow - 5, 12)
    .setBorder(true, true, true, true, true, true,
               '#e2e8f0', SpreadsheetApp.BorderStyle.SOLID);

  sheet.setFrozenRows(4);
  return sheet;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. _insertDeptBlock — Core Layout Builder
// ═══════════════════════════════════════════════════════════════════════════════
//
// COLUMN MAPPING:
//   A(1)  Dept name (merged, all step rows)
//   B(2)  What (merged)
//   C(3)  Pain (merged)
//   D(4)  Gain (merged)
//   E(5)  When (merged)
//   F(6)  Who (merged)
//   G(7)  Where (merged)
//   H(8)  Step name (per row)
//   I(9)  Tool description (per row)
//   J(10) Step progress bar (per row)
//   K(11) Cost (merged)
//   L(12) Total % (merged)
//   M,N   Spacer columns
//
function _insertDeptBlock(sheet, startRow, totalCols,
    deptName, what, pain, gain, whenText, who, where, cost, totalPct,
    bgColor, stepsArray) {

  var numRows = stepsArray.length;

  // ── Per-step rows: H, I, J ──
  for (var i = 0; i < numRows; i++) {
    var r = startRow + i;

    // Col H: Step name
    sheet.getRange(r, 8)
      .setValue(stepsArray[i][0])
      .setWrap(true).setVerticalAlignment('middle')
      .setFontSize(10).setBackground(bgColor);

    // Col I: Tool description
    sheet.getRange(r, 9)
      .setValue(stepsArray[i][1])
      .setWrap(true).setVerticalAlignment('middle')
      .setFontSize(10).setBackground(bgColor)
      .setFontColor('#4a5568');

    // Col J: Step progress bar
    sheet.getRange(r, 10)
      .setValue(stepsArray[i][2])
      .setVerticalAlignment('middle')
      .setFontColor('#2b6cb0')
      .setFontSize(10)
      .setHorizontalAlignment('right')
      .setBackground(bgColor)
      .setFontFamily('Courier New, monospace');

    sheet.setRowHeight(r, 36);
  }

  // ── Dept-level merged columns ──

  // A: Dept name
  sheet.getRange(startRow, 1, numRows, 1).merge()
    .setValue(deptName)
    .setVerticalAlignment('middle').setHorizontalAlignment('center')
    .setFontWeight('bold').setFontSize(11).setBackground(bgColor)
    .setWrap(true);

  // B: What
  sheet.getRange(startRow, 2, numRows, 1).merge()
    .setValue(what)
    .setVerticalAlignment('middle').setWrap(true)
    .setFontSize(10).setBackground(bgColor);

  // C: Pain
  sheet.getRange(startRow, 3, numRows, 1).merge()
    .setValue(pain)
    .setVerticalAlignment('middle').setWrap(true)
    .setFontSize(10).setBackground(bgColor)
    .setFontColor('#c53030');

  // D: Gain
  sheet.getRange(startRow, 4, numRows, 1).merge()
    .setValue(gain)
    .setVerticalAlignment('middle').setWrap(true)
    .setFontSize(10).setBackground(bgColor)
    .setFontColor('#276749');

  // E: When
  sheet.getRange(startRow, 5, numRows, 1).merge()
    .setValue(whenText)
    .setVerticalAlignment('middle').setWrap(true)
    .setFontSize(10).setHorizontalAlignment('center')
    .setBackground(bgColor)
    .setFontFamily('Courier New, monospace');

  // F: Who
  sheet.getRange(startRow, 6, numRows, 1).merge()
    .setValue(who)
    .setVerticalAlignment('middle').setWrap(true)
    .setFontSize(10).setBackground(bgColor);

  // G: Where / Domain
  sheet.getRange(startRow, 7, numRows, 1).merge()
    .setValue(where)
    .setVerticalAlignment('middle').setWrap(true)
    .setFontSize(10).setBackground(bgColor)
    .setFontColor('#4a5568');

  // K: Total % (overall dept progress)
  var pctNum = parseInt(totalPct) || 0;
  var pctColor = pctNum >= 70 ? '#22543d'
               : pctNum >= 20 ? '#2a4365'
               : pctNum >  0  ? '#744210'
               : '#718096';
  sheet.getRange(startRow, 11, numRows, 1).merge()
    .setValue(totalPct)
    .setVerticalAlignment('middle').setHorizontalAlignment('center')
    .setFontWeight('bold').setFontSize(18)
    .setBackground(bgColor).setFontColor(pctColor);

  // L: Cost (HOW MUCH)
  sheet.getRange(startRow, 12, numRows, 1).merge()
    .setValue(cost)
    .setVerticalAlignment('middle').setHorizontalAlignment('center')
    .setWrap(true).setFontSize(10)
    .setBackground(bgColor).setFontWeight('bold')
    .setFontColor('#2a4365');

  // ── Separator row (white, 8px height) ──
  var sepRow = startRow + numRows;
  sheet.getRange(sepRow, 1, 1, totalCols).merge()
    .setBackground('#ffffff')
    .setBorder(false, false, false, false, false, false);
  sheet.setRowHeight(sepRow, 8);

  return sepRow + 1;  // return next available row
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. TAB 3: Report_Log (Historical Record)
// ═══════════════════════════════════════════════════════════════════════════════

function _buildReportLogTab(ss) {
  var existing = ss.getSheetByName(SB_CONFIG.TAB_NAMES.LOG);
  if (existing) ss.deleteSheet(existing);

  var sheet = ss.insertSheet(SB_CONFIG.TAB_NAMES.LOG);
  sheet.setTabColor(SB_CONFIG.TAB_COLORS.LOG);

  var headers = [
    '\uD83D\uDCC5 Week',
    '\uD83D\uDD52 Date Sent',
    '\uD83D\uDEA6 Status',
    '\u2705 Key Achievement',
    '\uD83D\uDCC8 Phase %',
    '\uD83C\uDFE2 Dept Active',
    '\uD83E\uDD16 AI Tool',
    '\u26A0\uFE0F Blocker',
    '\uD83D\uDCE7 Email',
    '\uD83D\uDC64 Sent To'
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
// 7. HELPER FUNCTIONS
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
    var row   = startRow + i;
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
      .setBorder(true, true, true, true, null, null,
                 '#e2e8f0', SpreadsheetApp.BorderStyle.SOLID);

    sheet.setRowHeight(row, 35);
  }
}