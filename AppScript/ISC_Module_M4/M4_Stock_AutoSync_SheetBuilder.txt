/**
 * 🏗️ M4 STOCK AUTOSYNC SHEET BUILDER (v4.0 - VSTACK Edition)
 * ----------------------------------------------------------
 * RESPONSIBILITY:
 * 1. Enforce the existence of the 'Stock_AutoSync_Gateway' sheet.
 * 2. Construct the "3-Zone" ETL Layout with Black Pillars.
 * 3. Use VSTACK to creating a "Ghost Row" at Row 7, pushing data to Row 8.
 * 4. Apply Robust Regex Cleaning and Unit Conversion.
 */

const M4_AUTOSYNC_BUILDER_CONFIG = {
  // 🟢 IDENTITY
  SHEET_NAME: 'Stock_AutoSync_Gateway',
  
  // 🔗 SOURCE CONFIGURATION
  SOURCE_URL: 'https://docs.google.com/spreadsheets/d/17jYWgQXXOz8La5uo_KUpTFECo8A4Le0EAdbpgyn3D_8/edit',
  SOURCE_TAB_NAME: '1.STOCK', 
  
  // 📐 LAYOUT GEOMETRY
  DASHBOARD_ROWS: 5,        // Rows 1-5 reserved for Metadata
  HEADER_ROW: 6,            // Headers
  FORMULA_ROW: 7,           // The "Engine Room" (Ghost Row)
  DATA_START_ROW: 8,        // Visible Data starts here
  FROZEN_ROWS: 7,           // Freeze everything up to formula row
  
  // 📍 ZONES (1-Based Indexes)
  // Zone A: System Output (Cols A-H)
  ZONE_A_START_COL: 1,      
  
  // Pillar 1: Col I (9)
  PILLAR_1_COL: 9,
  
  // Zone B: Raw Import (Cols J-N)
  ZONE_B_START_COL: 10,     
  
  // Pillar 2: Col O (15)
  PILLAR_2_COL: 15,
  
  // Zone C: Conversion Logic (Col P)
  ZONE_C_START_COL: 16,     
  
  // Pillar 3: Col Q (17)
  PILLAR_3_COL: 17,
  
  // 🎨 VISUALS
  COLORS: {
    DASHBOARD: '#4c1130',   // Dark Cherry
    ZONE_A: '#d9ead3',      // Green (System)
    ZONE_B: '#cfe2f3',      // Blue (Raw Source)
    ZONE_C: '#fff2cc',      // Yellow (Logic)
    PILLAR: '#000000',      // Black Separator
    FORMULA_ROW: '#fff2cc', // Yellow Engine Room
    TEXT_LIGHT: '#ffffff',
    TEXT_DARK: '#000000'
  }
};

const M4_Stock_AutoSync_SheetBuilder = {

  /**
   * 🚀 MAIN ENTRY POINT
   * Rebuilds the Gateway Sheet with ETL logic.
   */
  buildGateway: function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const cfg = M4_AUTOSYNC_BUILDER_CONFIG;
    
    console.log(`[Builder] Starting ETL rebuild of ${cfg.SHEET_NAME}...`);
    
    // 1. NUKE: Delete existing sheet
    const existingSheet = ss.getSheetByName(cfg.SHEET_NAME);
    if (existingSheet) {
      ss.deleteSheet(existingSheet);
      console.log(`[Builder] Deleted old version.`);
    }
    
    // 2. PAVE: Create new sheet
    const sheet = ss.insertSheet(cfg.SHEET_NAME);
    
    // 3. BUILD DASHBOARD (Rows 1-5)
    _buildDashboard(sheet, cfg);
    
    // 4. BUILD PILLARS (Separators)
    _buildPillar(sheet, cfg.PILLAR_1_COL);
    _buildPillar(sheet, cfg.PILLAR_2_COL);
    _buildPillar(sheet, cfg.PILLAR_3_COL);
    
    // 5. BUILD ZONE B: RAW IMPORT (The Source)
    // 🟢 VSTACK STRATEGY:
    // We place the formula in Row 7.
    // Layer 1: {"","","","",""} -> Creates a blank "Ghost Row" at Row 7.
    // Layer 2: IMPORTRANGE -> Pushes actual data to start at Row 8.
    // Source Range: A3:E (Skipping the top 2 rows of source)
    
    const vstackFormula = `=VSTACK({"","","","",""}, IMPORTRANGE("${cfg.SOURCE_URL}", "'${cfg.SOURCE_TAB_NAME}'!A3:E"))`;
    sheet.getRange(cfg.FORMULA_ROW, cfg.ZONE_B_START_COL).setFormula(vstackFormula);
    
    // Set Headers for Zone B
    const headersB = ['SRC_WAREHOUSE', 'SRC_BOM', 'SRC_DESC', 'SRC_UNIT', 'SRC_QTY'];
    _setZoneHeader(sheet, cfg.HEADER_ROW, cfg.ZONE_B_START_COL, headersB, cfg.COLORS.ZONE_B);

    // 6. BUILD ZONE C: CONVERSION LOGIC (The Logic)
    // Col P. Default to 1.
    // Logic: IF(SRC_QTY="", "", 1)
    // SRC_QTY is Col N (14).
    // Note: Since Zone B has a "Ghost Row" at 7, N7 is "". Thus P7 becomes "".
    // This perfectly aligns the visual start to Row 8.
    const formulaRate = `=ARRAYFORMULA(IF(N${cfg.FORMULA_ROW}:N="", "", 1))`;
    sheet.getRange(cfg.FORMULA_ROW, cfg.ZONE_C_START_COL).setFormula(formulaRate);
    
    // Set Header for Zone C
    _setZoneHeader(sheet, cfg.HEADER_ROW, cfg.ZONE_C_START_COL, ['CONVERSION_RATE'], cfg.COLORS.ZONE_C);

    // 7. BUILD ZONE A: SYSTEM OUTPUT (The Result)
    // Cols A-H.
    // Structure: UPLOAD_ID | BATCH_ID | WAREHOUSE | BOM | DESC | UNIT | FINAL_QTY | EXTRACTED_SNAPSHOT_DATE
    
    const headersA = [
      'UPLOAD_ID', 'UPLOAD_BATCH_ID', 'WAREHOUSE_ID', 'RAW_BOM_UPDATE', 
      'BOM_DESCRIPTION', 'INPUT_UNIT_CODE', 'RAW_QTY', 'EXTRACTED_SNAPSHOT_DATE'
    ];
    _setZoneHeader(sheet, cfg.HEADER_ROW, cfg.ZONE_A_START_COL, headersA, cfg.COLORS.ZONE_A);
    
    // --- ArrayFormulas for Zone A ---
    // All formulas reference Row 7. Because of VSTACK ghost row, Row 7 outputs blank, data starts Row 8.
    
    // A: UPLOAD_ID (Generated) - Ref Col J (Warehouse)
    sheet.getRange(cfg.FORMULA_ROW, 1).setFormula(
      `=ARRAYFORMULA(IF(J${cfg.FORMULA_ROW}:J="", "", "AUTO_" & TEXT(NOW(), "YYYYMMDD") & "_" & J${cfg.FORMULA_ROW}:J & "_" & K${cfg.FORMULA_ROW}:K))`
    );
    
    // B: BATCH_ID (Generated)
    sheet.getRange(cfg.FORMULA_ROW, 2).setFormula(
      `=ARRAYFORMULA(IF(J${cfg.FORMULA_ROW}:J="", "", "BATCH_" & TEXT(NOW(), "YYYYMMDD")))`
    );
    
    // C: WAREHOUSE (Copy Col J)
    sheet.getRange(cfg.FORMULA_ROW, 3).setFormula(`=ARRAYFORMULA(J${cfg.FORMULA_ROW}:J)`);
    
    // D: BOM (Copy Col K)
    sheet.getRange(cfg.FORMULA_ROW, 4).setFormula(`=ARRAYFORMULA(K${cfg.FORMULA_ROW}:K)`);
    
    // E: DESC (Copy Col L)
    sheet.getRange(cfg.FORMULA_ROW, 5).setFormula(`=ARRAYFORMULA(L${cfg.FORMULA_ROW}:L)`);
    
    // F: UNIT (Clean Col M) - Robust Regex from User
    sheet.getRange(cfg.FORMULA_ROW, 6).setFormula(
      `=ARRAYFORMULA(IF(M${cfg.FORMULA_ROW}:M="", "", 
        IFS(
          REGEXMATCH(M${cfg.FORMULA_ROW}:M, "(?i)Gross"), "Gross",
          REGEXMATCH(M${cfg.FORMULA_ROW}:M, "(?i)Kg"), "Kg",
          REGEXMATCH(M${cfg.FORMULA_ROW}:M, "(?i)cuộn|roll"), "Cuộn",
          REGEXMATCH(M${cfg.FORMULA_ROW}:M, "(?i)lít"), "Lít",
          REGEXMATCH(M${cfg.FORMULA_ROW}:M, "(?i)đôi"), "Đôi",
          REGEXMATCH(M${cfg.FORMULA_ROW}:M, "(?i)quyển|cuốn"), "Quyển",
          REGEXMATCH(M${cfg.FORMULA_ROW}:M, "(?i)túi"), "Túi",
          REGEXMATCH(M${cfg.FORMULA_ROW}:M, "(?i)cục|viên"), "Viên",
          REGEXMATCH(M${cfg.FORMULA_ROW}:M, "(?i)cái|chiếc|miếng|thanh"), "Chiếc",
          TRUE, TRIM(REGEXREPLACE(M${cfg.FORMULA_ROW}:M, "[\\p{Han}\\d]", ""))
        )
      ))`
    );
    
    // G: RAW_QTY (Col N * Col P)
    sheet.getRange(cfg.FORMULA_ROW, 7).setFormula(
      `=ARRAYFORMULA(IF(N${cfg.FORMULA_ROW}:N="", "", N${cfg.FORMULA_ROW}:N * P${cfg.FORMULA_ROW}:P))`
    );
    
    // H: EXTRACTED_SNAPSHOT_DATE (From Dashboard Cell B2)
    // 🟢 Critical: Aligns with BigQuery Schema Upgrade from Phase 1
    sheet.getRange(cfg.FORMULA_ROW, 8).setFormula(
      `=ARRAYFORMULA(IF(J${cfg.FORMULA_ROW}:J="", "", $B$2))`
    );
    // Format Col H as 25-Jan-2026
    sheet.getRange(cfg.FORMULA_ROW, 8, sheet.getMaxRows()).setNumberFormat("dd-MMM-yyyy");

    // 8. FINALIZE & LOCK
    // Highlight the Engine Room
    const engineRange = sheet.getRange(cfg.FORMULA_ROW, 1, 1, cfg.PILLAR_3_COL);
    engineRange.setBackground(cfg.COLORS.FORMULA_ROW);
    
    // Gridlines ON (Data Engineer requirement)
    sheet.setHiddenGridlines(false);
    
    // Freeze rows (Up to Engine Room)
    sheet.setFrozenRows(cfg.FROZEN_ROWS);
    
    // Protect
    _protectSheet(sheet, cfg);
    
    SpreadsheetApp.flush();
    console.log(`[Builder] ETL Gateway Rebuilt (VSTACK Edition).`);
    return sheet;
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 🧱 HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function _buildDashboard(sheet, cfg) {
  // A. Header Bar
  const titleRange = sheet.getRange(1, 1, 1, 20);
  titleRange.setBackground(cfg.COLORS.DASHBOARD)
            .setFontColor(cfg.COLORS.TEXT_LIGHT)
            .setFontWeight('bold')
            .setValue('⚠️ SYSTEM GATEWAY - AUTOSYNC ENGINE');
            
  // B. Snapshot Date Extraction
  sheet.getRange('A2').setValue('SNAPSHOT DATE:').setFontWeight('bold');
  
  // The IMPORTRANGE for the Date (Source Cell B1)
  const dateFormula = `=IMPORTRANGE("${cfg.SOURCE_URL}", "'${cfg.SOURCE_TAB_NAME}'!B1")`;
  const dateCell = sheet.getRange('B2');
  dateCell.setFormula(dateFormula)
       .setBackground(cfg.COLORS.ZONE_C)
       .setFontWeight('bold')
       .setBorder(true, true, true, true, true, true)
       .setNumberFormat("dd-MMM-yyyy"); // 🟢 Force 25-Jan-2026 format
       
  // C. Wake Up Cell
  sheet.getRange('Z1').setValue('LAST_BUILD: ' + new Date().toISOString());
  
  // D. Explainer
  sheet.getRange('P2').setValue("ZONE C: CONVERSION RATE")
       .setFontWeight('bold').setFontColor('red');
  sheet.getRange('P3').setValue("Default is 1. You can edit column P below to override.")
       .setFontStyle('italic').setFontSize(8);
}

function _buildPillar(sheet, colIndex) {
  // Header part
  const header = sheet.getRange(M4_AUTOSYNC_BUILDER_CONFIG.HEADER_ROW, colIndex);
  header.setBackground(M4_AUTOSYNC_BUILDER_CONFIG.COLORS.PILLAR);
  // Body part
  const body = sheet.getRange(M4_AUTOSYNC_BUILDER_CONFIG.FORMULA_ROW, colIndex, sheet.getMaxRows() - M4_AUTOSYNC_BUILDER_CONFIG.FORMULA_ROW + 1, 1);
  body.setBackground(M4_AUTOSYNC_BUILDER_CONFIG.COLORS.PILLAR);
  // Shrink width
  sheet.setColumnWidth(colIndex, 20);
}

function _setZoneHeader(sheet, row, col, headers, color) {
  const range = sheet.getRange(row, col, 1, headers.length);
  range.setValues([headers]);
  range.setBackground(color);
  range.setFontWeight('bold');
  range.setHorizontalAlignment('center');
  range.setBorder(true, true, true, true, true, true);
}

function _protectSheet(sheet, cfg) {
  const protection = sheet.protect().setDescription('🛡️ AutoSync Gateway Protected');
  const me = Session.getEffectiveUser();
  protection.addEditor(me);
  protection.removeEditors(protection.getEditors());
  if (protection.canDomainEdit()) protection.setDomainEdit(false);
  
  // UNLOCK Zone C (Conversion Rate) - Starting from Row 8 (Visible Data)
  // We keep the formula in Row 7 locked to prevent accidental deletion.
  const rateRange = sheet.getRange(cfg.DATA_START_ROW, cfg.ZONE_C_START_COL, sheet.getMaxRows() - cfg.DATA_START_ROW + 1, 1);
  protection.setUnprotectedRanges([rateRange]);
}

/**
 * 🛠️ ADMIN RUNNER
 */
function admin_RebuildAutoSyncGateway() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.alert(
    '⚠️ Rebuild AutoSync Gateway?',
    'This will DELETE and REBUILD "Stock_AutoSync_Gateway".\n' +
    'Manual conversion rates will be reset to 1.\n\n' +
    'Proceed?',
    ui.ButtonSet.YES_NO
  );

  if (result == ui.Button.YES) {
    M4_Stock_AutoSync_SheetBuilder.buildGateway();
    ui.alert('✅ Gateway Rebuilt. Please allow access to #REF! errors.');
  }
}