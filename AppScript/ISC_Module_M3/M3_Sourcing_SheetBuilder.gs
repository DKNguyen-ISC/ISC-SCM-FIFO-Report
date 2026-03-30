/* -------------------------------------------------------------------------
 * FILE: ISC_Module_M3/M3_Sourcing_SheetBuilder.gs
 * DESCRIPTION: Builds the "Assign_Sourcing" interface (Version 57 - Phase 5.1 Dashboard).
 * UPDATED: 
 * - Phase 5.1: Dashboard area (Rows 1-4) with session metadata per cell.
 * - Phase 5.1: Header text wrapping for readability.
 * - Phase 5.1: Added NET_SHORTAGE_COMPLETION & NET_SHORTAGE_ISSUANCE to Zone B.
 * - Zone A: 16 Cols. Zone B: 19 Cols (was 17). PILLAR_2: Col 37 (AK).
 * - Data starts at Row 7 (was Row 3). Headers at Row 5. Formulas at Row 6.
 * ------------------------------------------------------------------------- */

const SOURCING_CONFIG = {
  SHEET_NAME: 'Assign_Sourcing',
  REF_MASTER_SHEET: 'Ref_Supplier_Master',
  REF_CAPACITY_SHEET: 'Ref_Supplier_Capacity',

  // 🎨 VISUALS
  COLORS: {
    HEADER_ZONE_A: '#d9ead3',
    HEADER_ZONE_B: '#cfe2f3',
    HEADER_INPUT: '#b4a7d6',
    HEADER_TEXT: '#000000',
    PILLAR: '#000000',
    PILLAR_TEXT: '#ffffff',
    LOCKED_BG: '#f3f3f3',
    INPUT_BG: '#ffffff',
    WARNING_BG: '#fff2cc',
    ERROR_BG: '#f4cccc',
    FORMULA_BG: '#ffff00',
    DASHBOARD_BG: '#e8f0fe',
    DASHBOARD_TITLE_BG: '#1a73e8'
  },

  // 📐 COLUMN MAP (1-based Index)
  // ZONE A (16) -> PILLAR (17) -> ZONE B (19) -> PILLAR (37)
  LAYOUT: {
    ZONE_A_START: 1,
    ZONE_A_COUNT: 16,
    PILLAR_1_COL: 17,
    ZONE_B_START: 18, 
    ZONE_B_COUNT: 19,      // 🆕 +2 for NSC & NSI (was 17)
    PILLAR_2_COL: 37,      // 🆕 shifted from 35 → 37

    // Row Layout (Phase 5.1)
    DASHBOARD_ROWS: 4,     // Rows 1-4: Dashboard area
    HEADER_ROW: 5,         // 🆕 was 1
    FORMULA_ROW: 6,        // 🆕 was 2
    DATA_START_ROW: 7,     // 🆕 was 3

    // 🔑 Key User Input Columns (unchanged positions)
    INPUT_COLS: [
      24, // X:  DATE_CODE
      28, // AB: ASSIGNED_SUPPLIER_NAME
      31, // AE: UNIT_PRICE_OVERRIDE
      33  // AG: APPLIED_LEAD_TIME_OVERRIDE
    ],

    // 📅 Date Columns
    DATE_COLS: [13, 14, 27],

    // 🟣 Purple Header Columns
    PURPLE_HEADERS: [24, 31, 33],

    // 🕵️ Ref Sheet Column Map
    REF_MAP: {
      NAME_COL: 'C',
      BOM_COL: 'D',
      PRICE_COL: 'F',
      LEAD_COL: 'E',
      MOQ_COL: 'G'
    }
  }
};

var M3_Sourcing_SheetBuilder = {

  buildSourcingInterface: function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SOURCING_CONFIG.SHEET_NAME);
    if (!sheet) sheet = ss.insertSheet(SOURCING_CONFIG.SHEET_NAME);

    Logger.log("🏗️ Starting Build: Assign_Sourcing (v57 Phase 5.1 Dashboard)");

    this._resetSheet(sheet);
    this._buildDashboardTemplate(sheet);
    this._buildHeaders(sheet);
    this._injectSmartFormulas(sheet);
    this._applyDropdowns(ss, sheet);
    this._applyFormatting(sheet);
    this._applyProtection(sheet);

    Logger.log("✅ Build Complete: Assign_Sourcing");
  },

  _resetSheet: function(sheet) {
    sheet.clear();
    sheet.clearNotes();
    sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(p => p.remove());
    sheet.setFrozenRows(6);   // 🆕 Freeze: Dashboard(1-4) + Header(5) + Formula(6)
    sheet.setFrozenColumns(0);
  },

  // 🆕 Phase 5.1: Dashboard Template (placeholder — filled per session)
  _buildDashboardTemplate: function(sheet) {
    const totalCols = SOURCING_CONFIG.LAYOUT.PILLAR_2_COL;

    // Row 1: Title Banner
    sheet.getRange(1, 1, 1, totalCols).merge()
      .setValue('📊 SOURCING SESSION DASHBOARD')
      .setFontSize(12).setFontWeight('bold')
      .setFontColor('#ffffff')
      .setBackground(SOURCING_CONFIG.COLORS.DASHBOARD_TITLE_BG)
      .setHorizontalAlignment('left').setVerticalAlignment('middle');
    sheet.setRowHeight(1, 30);

    // Row 2-3: Dashboard data area (labels + values)
    const row2Labels = ['👤 PIC', '—', '', '📦 GROUP', '—', '', '🔬 METHOD', '—', '', '📋 ITEMS', '—', '', '⏱️ LOADED', '—'];
    const row3Labels = ['⚠️ PHANTOMS', '—', '', '🟡 DIVERGENT', '—', '', '🟢 ALIGNED', '—', '', '📊 TOTAL SHORTAGE', '—', '', '📌 HAS ISSUANCE', '—'];
    sheet.getRange(2, 1, 1, row2Labels.length).setValues([row2Labels]);
    sheet.getRange(3, 1, 1, row3Labels.length).setValues([row3Labels]);

    // Style: labels bold grey, values bold blue
    [1, 4, 7, 10, 13].forEach(col => {
      sheet.getRange(2, col).setFontWeight('bold').setFontSize(9).setFontColor('#5f6368');
      sheet.getRange(3, col).setFontWeight('bold').setFontSize(9).setFontColor('#5f6368');
    });
    [2, 5, 8, 11, 14].forEach(col => {
      sheet.getRange(2, col).setFontWeight('bold').setFontSize(10).setFontColor('#1a73e8');
      sheet.getRange(3, col).setFontWeight('bold').setFontSize(10).setFontColor('#1a73e8');
    });
    sheet.getRange(2, 1, 2, totalCols).setBackground(SOURCING_CONFIG.COLORS.DASHBOARD_BG);
    sheet.getRange(2, 1, 2, 14).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);

    // Row 4: Separator
    sheet.getRange(4, 1, 1, totalCols).setBackground('#e0e0e0');
    sheet.setRowHeight(4, 4);
  },

  _buildHeaders: function(sheet) {
    const L = SOURCING_CONFIG.LAYOUT;
    const HR = L.HEADER_ROW; // Row 5

    const headers = [
      // ZONE A: SYSTEM (Cols 1-16)
      "DRAFT_PR_ID",                // A (1)
      "BOM_UPDATE",                 // B (2)
      "VPO",                        // C (3)
      "FULFILLMENT_MODE",           // D (4)
      "PIC",                        // E (5)
      "ORDER_LIST_NOTE",            // F (6)
      "DATE_CODE",                  // G (7)
      "SUPPLIER_ID",                // H (8)
      "SUPPLIER_NAME",              // I (9)
      "FINAL_UNIT_PRICE",           // J (10)
      "FINAL_LEAD_TIME",            // K (11)
      "FINAL_ORDER_QTY",            // L (12)
      "PROJECTED_ARRIVAL_DATE",     // M (13)
      "REQUESTED_DELIVERY_DATE",    // N (14)
      "DELIVERY_RISK_FLAG",         // O (15)
      "SUPPLIER_CHECK",             // P (16)
      
      // PILLAR 1 (Col 17)
      "RAW_START",

      // ZONE B (Cols 18-36)
      "DRAFT_PR_ID_LNK",            // R (18)
      "BOM_CTX",                    // S (19)
      "VPO_CTX",                    // T (20)
      "FULFILLMENT_MODE_CTX",       // U (21)
      "PIC_CTX",                    // V (22)
      "ORDER_LIST_NOTE_CTX",        // W (23)
      "DATE_CODE",                  // X (24) 🟣 Input
      "BOM_DESCRIPTION",            // Y (25)
      "NET_SHORTAGE_QTY",           // Z (26)
      "REQUESTED_DELIVERY_DATE",    // AA (27)
      "ASSIGNED_SUPPLIER_NAME",     // AB (28)
      "KNOWN_CAPACITY_OPTIONS",     // AC (29)
      "STANDARD_PRICE_REF",         // AD (30)
      "UNIT_PRICE_OVERRIDE",        // AE (31) 🟣 Input
      "STANDARD_LEAD_TIME_REF",     // AF (32)
      "APPLIED_LEAD_TIME_OVERRIDE", // AG (33) 🟣 Input
      "STANDARD_MOQ_REF",           // AH (34)
      "NET_SHORTAGE_COMPLETION",    // AI (35) 🆕
      "NET_SHORTAGE_ISSUANCE",      // AJ (36) 🆕

      // PILLAR 2 (Col 37)
      "RAW_END"
    ];

    const headerRange = sheet.getRange(HR, 1, 1, headers.length);
    headerRange.setValues([headers])
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle")
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP); // 🆕 Phase 5.1: Text Wrapping

    sheet.setRowHeight(HR, 45); // Enough height for wrapped text

    // --- COLOR LOGIC ---
    sheet.getRange(HR, 1, 1, 16).setBackground(SOURCING_CONFIG.COLORS.HEADER_ZONE_A);
    sheet.getRange(HR, 17).setBackground(SOURCING_CONFIG.COLORS.PILLAR).setFontColor(SOURCING_CONFIG.COLORS.PILLAR_TEXT);
    sheet.getRange(HR, 18, 1, 19).setBackground(SOURCING_CONFIG.COLORS.HEADER_ZONE_B);
    
    L.PURPLE_HEADERS.forEach(col => {
      sheet.getRange(HR, col).setBackground(SOURCING_CONFIG.COLORS.HEADER_INPUT);
    });

    sheet.getRange(HR, 37).setBackground(SOURCING_CONFIG.COLORS.PILLAR).setFontColor(SOURCING_CONFIG.COLORS.PILLAR_TEXT);

    // 🟢 HIDE TECHNICAL COLUMNS
    sheet.hideColumns(1);
    sheet.hideColumns(18, 6);
  },

  _injectSmartFormulas: function(sheet) {
    const maxRows = sheet.getMaxRows();
    const REF = SOURCING_CONFIG.REF_MASTER_SHEET;
    const CAP = SOURCING_CONFIG.REF_CAPACITY_SHEET;
    const MAP = SOURCING_CONFIG.LAYOUT.REF_MAP;
    const FR = SOURCING_CONFIG.LAYOUT.FORMULA_ROW;   // 6
    const DR = SOURCING_CONFIG.LAYOUT.DATA_START_ROW; // 7

    const formulas = {};

    // --- ZONE A: SYSTEM LOGIC (Row 6, references expand downward) ---
    formulas[`A${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="", "", R${FR}:R))`;
    formulas[`B${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="", "", S${FR}:S))`;
    formulas[`C${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="", "", T${FR}:T))`;
    formulas[`D${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="", "", U${FR}:U))`;
    formulas[`E${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="", "", V${FR}:V))`;
    formulas[`F${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="", "", W${FR}:W))`;
    formulas[`G${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="", "", X${FR}:X))`;
    formulas[`H${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="", "", IFNA(XLOOKUP(AB${FR}:AB, ${REF}!B:B, ${REF}!A:A), "MISSING_ID")))`;
    formulas[`I${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="", "", AB${FR}:AB))`;
    formulas[`J${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="", "", IF(ISNUMBER(AE${FR}:AE), AE${FR}:AE, AD${FR}:AD)))`;
    formulas[`K${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="", "", IF(ISNUMBER(AG${FR}:AG), AG${FR}:AG, AF${FR}:AF)))`;
    formulas[`L${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="", "", CEILING(Z${FR}:Z, IF((AH${FR}:AH="")+(AH${FR}:AH=0), 1, AH${FR}:AH))))`;
    formulas[`M${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="", "", TODAY() + K${FR}:K))`;
    formulas[`N${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="", "", AA${FR}:AA))`;
    formulas[`O${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="", "", IF(M${FR}:M > N${FR}:N, "LATE", "OK")))`;
    formulas[`P${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="", "", IF((H${FR}:H="MISSING_ID") + (H${FR}:H=""), "FALSE", "TRUE")))`;

    // --- ZONE B LOOKUPS ---
    const lookupKey = `AB${FR}:AB & S${FR}:S`;
    const refKey = `${CAP}!${MAP.NAME_COL}:${MAP.NAME_COL} & ${CAP}!${MAP.BOM_COL}:${MAP.BOM_COL}`;

    formulas[`AD${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="", "", IFNA(XLOOKUP(${lookupKey}, ${refKey}, ${CAP}!${MAP.PRICE_COL}:${MAP.PRICE_COL}), 0)))`;
    formulas[`AF${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="", "", IFNA(XLOOKUP(${lookupKey}, ${refKey}, ${CAP}!${MAP.LEAD_COL}:${MAP.LEAD_COL}), 0)))`;
    formulas[`AH${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="", "", IFNA(XLOOKUP(${lookupKey}, ${refKey}, ${CAP}!${MAP.MOQ_COL}:${MAP.MOQ_COL}), 1)))`;

    // --- CLEAR PATH ---
    const formulaCols = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16, 30, 32, 34];
    if (maxRows > DR) {
      formulaCols.forEach(colIndex => {
        sheet.getRange(DR, colIndex, maxRows - DR + 1).clearContent();
      });
    }

    // --- INJECT ---
    for (let cellKey in formulas) {
      sheet.getRange(cellKey).setFormula(formulas[cellKey]);
    }
  },

  _applyDropdowns: function(ss, sheet) {
    const refSheet = ss.getSheetByName(SOURCING_CONFIG.REF_MASTER_SHEET);
    if (!refSheet) return;

    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInRange(refSheet.getRange("B2:B"))
      .setAllowInvalid(true)
      .build();

    const FR = SOURCING_CONFIG.LAYOUT.FORMULA_ROW;
    sheet.getRange(FR, 28, 1000, 1).setDataValidation(rule);
  },

  _applyFormatting: function(sheet) {
    const rows = 1000;
    const L = SOURCING_CONFIG.LAYOUT;
    const HR = L.HEADER_ROW;
    const FR = L.FORMULA_ROW;
    const YELLOW = SOURCING_CONFIG.COLORS.FORMULA_BG;

    // 1. BLACKOUT THE PILLARS (from header row down)
    sheet.getRange(HR, 17, rows, 1).setBackground(SOURCING_CONFIG.COLORS.PILLAR); 
    sheet.getRange(HR, L.PILLAR_2_COL, rows, 1).setBackground(SOURCING_CONFIG.COLORS.PILLAR);

    // 2. GREY OUT LOCKED COLUMNS IN ZONE B
    sheet.getRange(FR, 18, rows, 6).setBackground(SOURCING_CONFIG.COLORS.LOCKED_BG);

    // 3. WHITELIST INPUT ISLANDS
    L.INPUT_COLS.forEach(col => {
      sheet.getRange(FR, col, rows, 1).setBackground(SOURCING_CONFIG.COLORS.INPUT_BG);
    });

    // 4. HIGHLIGHT FORMULA ROW
    sheet.getRange(FR, 1, 1, 16).setBackground(YELLOW);
    sheet.getRange(FR, 30).setBackground(YELLOW);
    sheet.getRange(FR, 32).setBackground(YELLOW);
    sheet.getRange(FR, 34).setBackground(YELLOW);

    // 5. 📅 DATE FORMATTING
    L.DATE_COLS.forEach(col => {
      sheet.getRange(FR, col, rows, 1).setNumberFormat("d-mmm-yyyy");
    });

    // 6. Conditional Formatting
    const rangeName = sheet.getRange(FR, 28, rows, 1);
    const rulePrice = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(`=AD${FR}=0`) 
      .setBackground(SOURCING_CONFIG.COLORS.WARNING_BG)
      .setFontColor('#bf9000')
      .setRanges([rangeName])
      .build();

    sheet.setConditionalFormatRules([rulePrice]);
  },

  _applyProtection: function(sheet) {
    const protection = sheet.protect().setDescription('System Locked');
    const FR = SOURCING_CONFIG.LAYOUT.FORMULA_ROW;
    
    const editableRanges = SOURCING_CONFIG.LAYOUT.INPUT_COLS.map(col => {
      return sheet.getRange(FR, col, 1000, 1);
    });

    protection.setUnprotectedRanges(editableRanges);
  }
};

/* ==========================================================================
 * PHASE 2: AGGREGATED BOM TEMPLATE BUILDER
 * --------------------------------------------------------------------------
 * CRITICAL: AGG_COL is a SEPARATE column map from SOURCING_CONFIG.LAYOUT.
 * The two templates are architecturally incompatible. Never reference
 * SOURCING_CONFIG.LAYOUT constants inside buildAggregatedInterface().
 * ========================================================================== */

/**
 * 📐 AGG_COL — 1-based column indices for Tpl_Assign_Sourcing_Aggregated
 *
 * Zone A (System / Locked): Cols 1–16
 * Pillar 1:                 Col  17  (RAW_START)
 * Zone B (Planner inputs):  Cols 18–37
 * Pillar 2:                 Col  38  (RAW_END)
 */
const AGG_COL = {
  // — Zone A (upload payload, formula-driven) ——————————————————————————
  BOM_UPDATE:                    1,   // A — from Aggregated_VIEW
  FULFILLMENT_MODE:              2,   // B — hardcoded 'PUBLIC'
  PIC:                           3,   // C — session context
  // D–G reserved / system
  SUPPLIER_ID:                   8,   // H — XLOOKUP name→ID
  ASSIGNED_SUPPLIER_NAME_MIRROR: 9,   // I — mirror of AB
  FINAL_UNIT_PRICE:             10,   // J — =IF(AE>0, AE, AD)
  FINAL_LEAD_TIME:              11,   // K — =IF(AG>0, AG, AF)
  FINAL_Q_BOM:                  12,   // L — primary explode input
  PROJECTED_ARRIVAL_DATE:       13,   // M — =N+K
  EARLIEST_DELIVERY_DATE:       14,   // N — from view (MIN delivery)
  // O — reserved
  SUPPLIER_CHECK:               16,   // P — auto-set by script ("TRUE"/"FALSE" string)

  // — Pillar ———————————————————————————————————————————————————————————
  PILLAR_1:                     17,   // Q — RAW_START delimiter

  // — Zone B (context + planner editable) —————————————————————————————
  BOM_CTX:                      18,   // R — BOM_UPDATE (read-only context, grey)
  BOM_DESCRIPTION:              19,   // S — description (grey)
  MAIN_GROUP:                   20,   // T — classification (grey)
  VPO_COUNT:                    21,   // U — count label (blue, read-only)
  VPO_COMPONENTS_JSON:          22,   // V — hidden JSON payload
  NET_SHORTAGE_QTY_AGG:         23,   // W — aggregated base shortage (blue, read-only)
  BOM_SHORTAGE_STATUS:          24,   // X — 'OK'/'MISMATCH' (blue, conditional red)
  TOLERANCE_PCT_INPUT:          25,   // Y — planner input (yellow, editable)
  TOLERANCE_PCT_EFFECTIVE:      26,   // Z — formula (yellow, calc)
  DATE_CODE:                    27,   // AA — planner input (yellow, editable)
  ASSIGNED_SUPPLIER_NAME:       28,   // AB — dropdown (yellow)
  KNOWN_CAPACITY_OPTIONS:       29,   // AC — reference list (grey)
  STANDARD_PRICE_REF:           30,   // AD — reference (grey)
  UNIT_PRICE_OVERRIDE:          31,   // AE — planner input (yellow)
  STANDARD_LEAD_TIME_REF:       32,   // AF — reference (grey)
  LEAD_TIME_OVERRIDE:           33,   // AG — planner input (yellow) [was "Reserved" in V5]
  SPQ_REF:                      34,   // AH — Standard Package Quantity (blue, formula)
  MANUAL_Q_BOM_OVERRIDE:        35,   // AI — planner hard-override (yellow)
  DRAFT_PR_ID_AGG:              36,   // AJ — pipe-list (hidden, used for cross-validation)
  SAVINGS_VS_LEGACY:            37,   // AK — script-populated at load (purple)

  // — Pillar ———————————————————————————————————————————————————————————
  PILLAR_2:                     38,   // AL — RAW_END delimiter

  // — Layout ————————————————————————————————————————————————————————————
  HEADER_ROW:   5,
  FORMULA_ROW:  6,
  DATA_START:   7,
  TOTAL_COLS:  38
};

// 🎨 Colours for aggregated template
const AGG_COLORS = {
  ZONE_A_HEADER:   '#d9ead3',  // green
  ZONE_B_HEADER:   '#cfe2f3',  // blue
  PILLAR:          '#000000',
  PILLAR_TEXT:     '#ffffff',
  GREY:            '#f3f3f3',
  BLUE:            '#dae8fc',
  YELLOW:          '#fff2cc',
  PURPLE:          '#e1d4f4',
  FORMULA_BG:      '#ffff00',
  MISMATCH_RED:    '#f4cccc',
  ORANGE:          '#ffe599',
  TITLE_BG:        '#1a73e8',
  DASHBOARD_BG:    '#e8f0fe',
};

/**
 * Aggregated Template Builder — builds Tpl_Assign_Sourcing_Aggregated.
 * Called by loadSourcingSession() when PUBLIC materials require aggregated UI.
 * NEVER modifies the legacy Assign_Sourcing template.
 */
var M3_Agg_SheetBuilder = {

  /**
   * Entry point: finds or creates the aggregated template sheet, then builds it.
   * @param {Spreadsheet} ss
   * @param {string} sheetName  e.g. 'Nga_Assign_Sourcing_Aggregated'
   * @returns {Sheet}
   */
  getOrBuildSheet: function(ss, sheetName) {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      Logger.log(`[AGG_BUILDER] Created new aggregated sheet: ${sheetName}`);
    }
    this._buildAggregatedInterface(sheet);
    return sheet;
  },

  _buildAggregatedInterface: function(sheet) {
    Logger.log('[AGG_BUILDER] Building aggregated interface...');
    this._resetSheet(sheet);
    this._buildDashboardArea(sheet);
    this._buildHeaders(sheet);
    this._injectFormulas(sheet);
    this._applyDropdowns(sheet);
    this._applyFormatting(sheet);
    this._applyConditionalFormatting(sheet);
    Logger.log('[AGG_BUILDER] Build complete.');
  },

  _resetSheet: function(sheet) {
    sheet.clear();
    sheet.clearNotes();
    sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(p => p.remove());
    // Freeze: dashboard(1-4) + header(5) + formula(6)
    sheet.setFrozenRows(6);
    sheet.setFrozenColumns(0);
  },

  _buildDashboardArea: function(sheet) {
    const tc = AGG_COL.TOTAL_COLS;
    // Row 1: title banner
    sheet.getRange(1, 1, 1, tc).merge()
      .setValue('📦 AGGREGATED BOM SOURCING — SESSION DASHBOARD')
      .setFontSize(12).setFontWeight('bold')
      .setFontColor('#ffffff').setBackground(AGG_COLORS.TITLE_BG)
      .setHorizontalAlignment('left').setVerticalAlignment('middle');
    sheet.setRowHeight(1, 30);

    // Row 2: session identity (filled at load time)
    const row2 = ['👤 PIC', '—', '', '📦 MODE', '—', '', '📋 BOM ROWS', '—', '',
                  '⚠️ MISMATCH', '—', '', '💰 TOTAL SAVINGS', '—'];
    sheet.getRange(2, 1, 1, row2.length).setValues([row2]);

    // Row 3: staleness disclaimer (always visible)
    sheet.getRange(3, 1, 1, tc).merge()
      .setValue('ℹ️ Savings figures reflect values at load time. Re-load session to refresh.')
      .setFontStyle('italic').setFontSize(9).setFontColor('#5f6368')
      .setBackground(AGG_COLORS.DASHBOARD_BG);

    // Row 2 label/value styling
    [1,4,7,10,13].forEach(col => {
      sheet.getRange(2, col).setFontWeight('bold').setFontSize(9).setFontColor('#5f6368');
    });
    [2,5,8,11,14].forEach(col => {
      sheet.getRange(2, col).setFontWeight('bold').setFontSize(10).setFontColor('#1a73e8');
    });
    sheet.getRange(2, 1, 1, tc).setBackground(AGG_COLORS.DASHBOARD_BG);
    sheet.getRange(2, 1, 1, 14).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);

    // Row 4: separator
    sheet.getRange(4, 1, 1, tc).setBackground('#e0e0e0');
    sheet.setRowHeight(4, 4);
  },

  _buildHeaders: function(sheet) {
    const HR = AGG_COL.HEADER_ROW;
    const headers = [
      // Zone A (1–16)
      'BOM_UPDATE',               // A(1)
      'FULFILLMENT_MODE',         // B(2)
      'PIC',                      // C(3)
      '',                         // D(4) reserved
      '',                         // E(5) reserved
      '',                         // F(6) reserved
      '',                         // G(7) reserved
      'SUPPLIER_ID',              // H(8)
      'SUPPLIER_NAME',            // I(9)
      'FINAL_UNIT_PRICE',         // J(10)
      'FINAL_LEAD_TIME',          // K(11)
      'FINAL_Q_BOM',              // L(12)  ← explode input
      'PROJECTED_ARRIVAL_DATE',   // M(13)
      'EARLIEST_DELIVERY_DATE',   // N(14)
      '',                         // O(15) reserved
      'SUPPLIER_CHECK',           // P(16)
      // Pillar 1
      'RAW_START',                // Q(17)
      // Zone B (18–37)
      'BOM_CTX',                  // R(18)
      'BOM_DESCRIPTION',          // S(19)
      'MAIN_GROUP',               // T(20)
      'VPO_COUNT',                // U(21)
      'VPO_COMPONENTS_JSON',      // V(22) hidden
      'NET_SHORTAGE_QTY_AGG',     // W(23)
      'BOM_SHORTAGE_STATUS',      // X(24)
      'TOLERANCE_%_INPUT',        // Y(25)
      'TOLERANCE_%_EFFECTIVE',    // Z(26)
      'DATE_CODE',                // AA(27)
      'ASSIGNED_SUPPLIER_NAME',   // AB(28)
      'KNOWN_CAPACITY_OPTIONS',   // AC(29)
      'STANDARD_PRICE_REF',       // AD(30)
      'UNIT_PRICE_OVERRIDE',      // AE(31)
      'STANDARD_LEAD_TIME_REF',   // AF(32)
      'LEAD_TIME_OVERRIDE',       // AG(33)
      'SPQ_REF',                  // AH(34)
      'MANUAL_Q_BOM_OVERRIDE',    // AI(35)
      'DRAFT_PR_ID_AGG',          // AJ(36) hidden — cross-validation
      'SAVINGS_VS_LEGACY',        // AK(37)
      // Pillar 2
      'RAW_END'                   // AL(38)
    ];

    sheet.getRange(HR, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle')
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
    sheet.setRowHeight(HR, 50);

    // Colour-code header bands
    sheet.getRange(HR, 1, 1, 16).setBackground(AGG_COLORS.ZONE_A_HEADER);
    sheet.getRange(HR, 17).setBackground(AGG_COLORS.PILLAR).setFontColor(AGG_COLORS.PILLAR_TEXT);
    sheet.getRange(HR, 18, 1, 20).setBackground(AGG_COLORS.ZONE_B_HEADER);
    sheet.getRange(HR, 38).setBackground(AGG_COLORS.PILLAR).setFontColor(AGG_COLORS.PILLAR_TEXT);

    // Purple for planner-editable input columns
    [25, 27, 28, 31, 33, 35].forEach(col => {
      sheet.getRange(HR, col).setBackground('#b4a7d6');
    });
    // Purple for savings column header
    sheet.getRange(HR, 37).setBackground('#9e7cc1').setFontColor('#ffffff');

    // Hide technical columns (VPO_COMPONENTS_JSON + DRAFT_PR_ID_AGG)
    sheet.hideColumns(AGG_COL.VPO_COMPONENTS_JSON);   // V (22)
    sheet.hideColumns(AGG_COL.DRAFT_PR_ID_AGG);       // AJ (36)
  },

  _injectFormulas: function(sheet) {
    const FR = AGG_COL.FORMULA_ROW;   // 6
    const REF = SOURCING_CONFIG.REF_MASTER_SHEET;
    const CAP = SOURCING_CONFIG.REF_CAPACITY_SHEET;
    const formulas = {};

    // ── Zone A formulas (ARRAYFORMULA, row 6 downward) ──────────────────

    // A: BOM_UPDATE mirror from R
    formulas[`A${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="","",R${FR}:R))`;

    // B: FULFILLMENT_MODE — hardcoded PUBLIC
    formulas[`B${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="","","PUBLIC"))`;

    // C: PIC mirror from session context written to Zone B
    formulas[`C${FR}`] = ``;

    // H: SUPPLIER_ID — lookup from AB (supplier name) against Ref_Supplier_Master
    formulas[`H${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="","",IFNA(XLOOKUP(AB${FR}:AB,${REF}!B:B,${REF}!A:A),"MISSING_ID")))`;

    // I: SUPPLIER_NAME mirror of AB
    formulas[`I${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="","",AB${FR}:AB))`;

    // J: FINAL_UNIT_PRICE — override if AE>0 else standard ref AD
    formulas[`J${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="","",IF((ISNUMBER(AE${FR}:AE))*(AE${FR}:AE>0),AE${FR}:AE,AD${FR}:AD)))`;

    // K: FINAL_LEAD_TIME — override if AG>0 else standard ref AF
    formulas[`K${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="","",IF((ISNUMBER(AG${FR}:AG))*(AG${FR}:AG>0),AG${FR}:AG,AF${FR}:AF)))`;

    // L: FINAL_Q_BOM — manual override wins; else CEILING(W*(1+Z/100), AH)
    //    V7 Spec §4.3: TOLERANCE_%_EFFECTIVE (Z) stores e.g. "10" for 10% → must ÷100
    formulas[`L${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="","",IF((ISNUMBER(AI${FR}:AI))*(AI${FR}:AI>0),AI${FR}:AI,CEILING(W${FR}:W*(1+Z${FR}:Z/100),IF((AH${FR}:AH="")+(AH${FR}:AH=0),1,AH${FR}:AH)))))`;

    // M: PROJECTED_ARRIVAL_DATE = EARLIEST_DELIVERY_DATE + FINAL_LEAD_TIME
    formulas[`M${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="","",N${FR}:N+K${FR}:K))`;

    // N: EARLIEST_DELIVERY_DATE — read from Zone B (AA col holds delivery date written by loader)
    // Note: N mirrors the view column; planner sees this as read-only reference
    formulas[`N${FR}`] = ``;  // filled by loader script, not formula

    // P: SUPPLIER_CHECK — set as string "TRUE"/"FALSE" by script; formula is a read-only guard
    //    Condition: AB not blank AND AA not blank AND L is non-negative number
    //    V7 Issue 2 fix: writes string "TRUE" consistent with upload filter (String(row[15]).toUpperCase()==='TRUE')
    formulas[`P${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="","",IF((H${FR}:H="MISSING_ID")+(H${FR}:H="")+(AA${FR}:AA=""),"FALSE","TRUE")))`;

    // Z: TOLERANCE_%_EFFECTIVE — V7 §4.2 robust guard
    //    Blank | non-numeric | negative | >200 → default 10
    formulas[`Z${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="","",IF(((Y${FR}:Y="")+(NOT(ISNUMBER(Y${FR}:Y)))+(Y${FR}:Y<0)+(Y${FR}:Y>200))>0,10,Y${FR}:Y)))`;

    // ── Zone B reference lookups ─────────────────────────────────────────
    const lookupKey = `AB${FR}:AB&R${FR}:R`;  // supplier_name + BOM_UPDATE composite key
    const refKey    = `${CAP}!C:C&${CAP}!D:D`;

    formulas[`AD${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="","",IFNA(XLOOKUP(${lookupKey},${refKey},${CAP}!F:F),0)))`;  // price
    formulas[`AF${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="","",IFNA(XLOOKUP(${lookupKey},${refKey},${CAP}!E:E),0)))`;  // lead time
    formulas[`AH${FR}`] = `=ARRAYFORMULA(IF(R${FR}:R="","",IFNA(XLOOKUP(${lookupKey},${refKey},${CAP}!G:G),1)))`;  // SPQ

    // Inject all formulas
    for (const cellKey in formulas) {
      sheet.getRange(cellKey).setFormula(formulas[cellKey]);
    }

    // Highlight formula row (Zone A)
    sheet.getRange(FR, 1, 1, 16).setBackground(AGG_COLORS.FORMULA_BG);
    sheet.getRange(FR, AGG_COL.STANDARD_PRICE_REF).setBackground(AGG_COLORS.FORMULA_BG);
    sheet.getRange(FR, AGG_COL.STANDARD_LEAD_TIME_REF).setBackground(AGG_COLORS.FORMULA_BG);
    sheet.getRange(FR, AGG_COL.SPQ_REF).setBackground(AGG_COLORS.FORMULA_BG);
    sheet.getRange(FR, AGG_COL.TOLERANCE_PCT_EFFECTIVE).setBackground(AGG_COLORS.FORMULA_BG);
  },

  _applyDropdowns: function(sheet) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const refSheet = ss.getSheetByName(SOURCING_CONFIG.REF_MASTER_SHEET);
    if (!refSheet) {
      Logger.log('[AGG_BUILDER] Warning: Ref_Supplier_Master not found — dropdown skipped.');
      return;
    }
    const FR = AGG_COL.FORMULA_ROW;
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInRange(refSheet.getRange('B2:B'))
      .setAllowInvalid(true)
      .build();
    // Apply to AB column (ASSIGNED_SUPPLIER_NAME) from formula row down
    sheet.getRange(FR, AGG_COL.ASSIGNED_SUPPLIER_NAME, sheet.getMaxRows() - FR + 1, 1)
      .setDataValidation(rule);
  },

  _applyFormatting: function(sheet) {
    const FR    = AGG_COL.FORMULA_ROW;
    const rows  = 1000;
    const tc    = AGG_COL.TOTAL_COLS;

    // Pillar blackout
    sheet.getRange(AGG_COL.HEADER_ROW, 17, rows, 1).setBackground(AGG_COLORS.PILLAR);
    sheet.getRange(AGG_COL.HEADER_ROW, 38, rows, 1).setBackground(AGG_COLORS.PILLAR);

    // Zone B base colour bands
    const greyReadOnlyCols = [
      AGG_COL.BOM_CTX, AGG_COL.BOM_DESCRIPTION, AGG_COL.MAIN_GROUP,
      AGG_COL.VPO_COUNT, AGG_COL.NET_SHORTAGE_QTY_AGG, AGG_COL.BOM_SHORTAGE_STATUS,
      AGG_COL.KNOWN_CAPACITY_OPTIONS, AGG_COL.STANDARD_PRICE_REF,
      AGG_COL.STANDARD_LEAD_TIME_REF, AGG_COL.SPQ_REF
    ];
    greyReadOnlyCols.forEach(col => {
      sheet.getRange(FR, col, rows, 1).setBackground(AGG_COLORS.GREY);
    });

    // Planner-editable (yellow)
    const yellowInputCols = [
      AGG_COL.TOLERANCE_PCT_INPUT, AGG_COL.DATE_CODE,
      AGG_COL.ASSIGNED_SUPPLIER_NAME, AGG_COL.UNIT_PRICE_OVERRIDE,
      AGG_COL.LEAD_TIME_OVERRIDE, AGG_COL.MANUAL_Q_BOM_OVERRIDE
    ];
    yellowInputCols.forEach(col => {
      sheet.getRange(FR, col, rows, 1).setBackground(AGG_COLORS.YELLOW);
    });

    // Savings column (purple)
    sheet.getRange(FR, AGG_COL.SAVINGS_VS_LEGACY, rows, 1).setBackground(AGG_COLORS.PURPLE);

    // Date formatting for delivery date ref
    sheet.getRange(FR, AGG_COL.EARLIEST_DELIVERY_DATE, rows, 1).setNumberFormat('d-mmm-yyyy');
    sheet.getRange(FR, AGG_COL.PROJECTED_ARRIVAL_DATE,  rows, 1).setNumberFormat('d-mmm-yyyy');
  },

  _applyConditionalFormatting: function(sheet) {
    const FR   = AGG_COL.FORMULA_ROW;
    const rows = 1000;
    const rules = [];

    // Rule 1: BOM_SHORTAGE_STATUS = 'MISMATCH' → red highlight on Col X
    const mismatchRange = sheet.getRange(FR, AGG_COL.BOM_SHORTAGE_STATUS, rows, 1);
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('MISMATCH')
        .setBackground(AGG_COLORS.MISMATCH_RED)
        .setFontColor('#cc0000')
        .setRanges([mismatchRange])
        .build()
    );

    // Rule 2: TOLERANCE_%_INPUT (Y) non-blank but TOLERANCE_%_EFFECTIVE forced to 10
    //         (i.e., invalid input was overridden) → orange on Y
    const toleranceRange = sheet.getRange(FR, AGG_COL.TOLERANCE_PCT_INPUT, rows, 1);
    // Formula: Y is non-blank AND (not a number OR negative OR >200) → orange
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(
          `=AND(${String.fromCharCode(64 + AGG_COL.TOLERANCE_PCT_INPUT)}${FR}<>"",` +
          `OR(NOT(ISNUMBER(${String.fromCharCode(64 + AGG_COL.TOLERANCE_PCT_INPUT)}${FR})),` +
          `${String.fromCharCode(64 + AGG_COL.TOLERANCE_PCT_INPUT)}${FR}<0,` +
          `${String.fromCharCode(64 + AGG_COL.TOLERANCE_PCT_INPUT)}${FR}>200))`
        )
        .setBackground(AGG_COLORS.ORANGE)
        .setFontColor('#783f04')
        .setRanges([toleranceRange])
        .build()
    );

    sheet.setConditionalFormatRules(rules);
  }
};