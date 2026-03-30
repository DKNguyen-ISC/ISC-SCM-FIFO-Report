/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🏗️ M1_PSP_SheetBuilder.gs
 * Sheet Builder for Production Status Portal (V6.2 - Headless Compatible)
 * ═══════════════════════════════════════════════════════════════════════════════
 * * RESPONSIBILITIES:
 * - Clone sessions from the master template.
 * - Load active production orders from BigQuery VIEW.
 * - Apply "Zebra" formatting while preserving Black Pillars.
 * - ⭐ INJECTION: Inject MAP formulas for Ref (Suggestion) and Result (Calculation).
 * - ⭐ PROTECTION: Unlock ONLY the Override column.
 * - ⭐ HEADLESS: Supports 'Silent Mode' for Nightly AutoSync.
 * * @version 6.2 Headless Edition
 * @revision January 2026
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const M1_PSP_SheetBuilder = {

  // ═══════════════════════════════════════════════════════════════════════════════
  // 1. PUBLIC METHODS (Session Management)
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Creates or refreshes a user session for the Production Status Portal.
   * @param {string} picName - The authorized user name (e.g., 'Khánh')
   * @param {boolean} silentMode - If true, suppresses UI alerts (For AutoSync)
   */
  createOrRefreshSession: function(picName, silentMode = false) {
    const config = getPSPConfig();
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = getSessionSheetName(picName);
    let sheet = spreadsheet.getSheetByName(sheetName);
    let isNewSession = false;
    
    // ⭐ HEADLESS SAFETY: Only get UI if we are NOT in silent mode
    let ui = null;
    if (!silentMode) {
      try { ui = SpreadsheetApp.getUi(); } catch(e) { console.warn('UI Unavailable'); }
    }

    if (!sheet) {
      // 1. Clone from Master Template
      const template = spreadsheet.getSheetByName(config.TEMPLATE_NAME);
      if (!template) {
        // 🔴 CRITICAL BRANCH:
        // If Silent (Robot) -> THROW Error so AutoSync fails hard and reports it.
        // If UI (Human) -> ALERT User and stop gracefully.
        if (silentMode) {
            throw new Error(`CRITICAL: ${config.MESSAGES.TEMPLATE_MISSING}`);
        } else {
            if (ui) ui.alert(config.MESSAGES.TEMPLATE_MISSING);
            return;
        }
      }
      
      sheet = template.copyTo(spreadsheet).setName(sheetName);
      sheet.setTabColor(config.COLORS.TAB_COLOR);
      // 2. Set Metadata (PIC Name)
      sheet.getRange(config.CELL_PIC_NAME).setValue(picName);
      isNewSession = true;
      
      if (!silentMode) spreadsheet.toast(config.MESSAGES.SESSION_CREATED);
    } else {
      if (!silentMode) spreadsheet.toast(config.MESSAGES.REFRESHING);
    }

    // 3. Activate
    // Note: 'activate()' is safe in headless, it just does nothing useful.
    sheet.activate();
    
    // 4. Refresh Data & Format
    // ⭐ Pass strict silentMode down the chain
    this.refreshSessionData(sheet, picName, isNewSession, silentMode);
  },

  /**
   * Refreshes the data in a session sheet from BigQuery.
   * Uses "Surgical Clear" to preserve structure while updating values.
   * @param {Sheet} sheet - The target sheet
   * @param {string} picName - The user identity
   * @param {boolean} isNewSession - Context flag
   * @param {boolean} silentMode - If true, re-throws errors instead of alerting
   */
  refreshSessionData: function(sheet, picName, isNewSession = false, silentMode = false) {
    const config = getPSPConfig();
    
    // ⭐ HEADLESS SAFETY: Context Isolation
    let ui = null;
    if (!silentMode) {
      try { ui = SpreadsheetApp.getUi(); } catch(e) { console.warn('UI Unavailable'); }
    }

    try {
      // 1. Surgical Clear (Reset to White, Keep Pillars Black, Clear old Data/Formulas)
      this._surgicalClear(sheet);

      // 2. Fetch Data from View
      const activeOrders = this._fetchActiveOrders(picName);

      // 3. Update Header Meta
      sheet.getRange(config.CELL_TIMESTAMP).setValue(new Date());
      sheet.getRange(config.CELL_RECORD_COUNT).setValue(activeOrders.length);

      if (activeOrders.length === 0) {
        if (!silentMode) SpreadsheetApp.getActiveSpreadsheet().toast(config.MESSAGES.NO_DATA);
        return;
      }

      // 4. Map & Write Data (Static Context)
      const gridData = this._mapRowToSheetData(activeOrders, config);
      const startRow = config.DATA_START_ROW;
      sheet.getRange(startRow, 1, gridData.length, gridData[0].length).setValues(gridData);

      // 5. ⭐ FORMULA INJECTION (The Brain)
      // Must happen AFTER setValues to ensure formulas aren't overwritten by empty strings
      this._injectFormulas(sheet);

      // 6. Paint Session (Zebra + Highlights + Pillars)
      this._paintSession(sheet, gridData.length, gridData);

      // 7. Apply Conditional Formatting (Red/Yellow/Green rules on RESULT column)
      this._applyConditionalFormatting(sheet, gridData.length);

      // 8. Apply Protection (Unlock ONLY Override)
      this._applyProtection(sheet);

    } catch (e) {
      console.error(e);
      
      // 🔴 CRITICAL ERROR HANDLING:
      // If we are in Silent Mode, we MUST throw the error.
      // Otherwise, the AutoSync script will think the refresh succeeded (swallowing the error).
      if (silentMode || !ui) {
        throw e; 
      } else {
        ui.alert('❌ Refresh Failed', e.message, ui.ButtonSet.OK);
      }
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // 2. ADMIN METHODS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Rebuilds the Master Template from scratch based on M1_PSP_Config.
   */
  createMasterTemplate: function() {
    const config = getPSPConfig();
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. Delete Old Template
    const oldTemp = ss.getSheetByName(config.TEMPLATE_NAME);
    if (oldTemp) ss.deleteSheet(oldTemp);

    // 2. Create New
    const sheet = ss.insertSheet(config.TEMPLATE_NAME);
    sheet.setTabColor('#000000'); // Admin Black

    // 3. Setup Headers
    const headerRow = config.HEADER_ROW;
    // Combine all columns for iteration
    const allColumns = { 
      ...config.COLUMNS.ZONE_A, 
      ...config.COLUMNS.PILLARS, 
      ...config.COLUMNS.ZONE_B,
      ...config.COLUMNS.ZONE_C 
    };

    // Iterate definitions
    Object.values(allColumns).forEach(def => {
      const cell = sheet.getRange(headerRow, def.col);
      cell.setValue(def.header);
      sheet.setColumnWidth(def.col, def.width || 100);
      
      // Apply Header Color
      if (def.bgColor) cell.setBackground(def.bgColor);
      if (def.textColor) cell.setFontColor(def.textColor);
      cell.setFontWeight('bold');
      
      // Apply Note
      if (def.note) cell.setNote(def.note);

      // Handle Hidden (e.g. DATA_STATE)
      if (def.hidden) sheet.hideColumns(def.col);
      
      // Handle Pillars (Paint all the way down for Template)
      if (def.header.includes('RAW')) {
        const maxRows = sheet.getMaxRows();
        sheet.getRange(headerRow, def.col, maxRows - headerRow + 1, 1)
             .setBackground('#000000')
             .setFontColor('#FFFFFF');
      }
    });

    // 4. Setup Metadata Area
    sheet.getRange('A1').setValue('🏭 ISC PRODUCTION STATUS PORTAL');
    sheet.getRange('A1').setFontSize(14).setFontWeight('bold');
    sheet.getRange('A2').setValue('👤 PIC:');
    sheet.getRange(config.CELL_PIC_NAME).setValue('[TEMPLATE]');
    sheet.getRange('A3').setValue('🕒 Updated:');
    sheet.getRange('A4').setValue('📊 Records:');

    // 5. Freeze & Hide
    sheet.setFrozenRows(config.DATA_START_ROW - 1);
    sheet.hideSheet();
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // 3. INTERNAL HELPERS (Data & Paint)
  // ═══════════════════════════════════════════════════════════════════════════════

  _fetchActiveOrders: function(picName) {
    const config = getPSPConfig();
    const coreConfig = ISC_SCM_Core_Lib.getCoreConfig();
    
    const sql = `
      SELECT * FROM \`${coreConfig.connection.PROJECT_ID}.${coreConfig.connection.DATASET_ID}.${config.PORTAL_VIEW}\`
      ORDER BY VPO ASC, SKU_NAME_VERSION ASC
    `;
    return ISC_SCM_Core_Lib.runReadQueryMapped(sql);
  },

  _mapRowToSheetData: function(rows, config) {
    const totalCols = getTotalColumnCount();
    return rows.map(row => {
      const sheetRow = new Array(totalCols).fill('');
      const setVal = (colDef, val) => {
        if (colDef && colDef.col) sheetRow[colDef.col - 1] = (val === null || val === undefined) ? '' : val;
      };

      // Zone A (Static Context)
      setVal(config.COLUMNS.ZONE_A.PRODUCTION_ORDER_ID, row.PRODUCTION_ORDER_ID);
      setVal(config.COLUMNS.ZONE_A.VPO, row.VPO);
      setVal(config.COLUMNS.ZONE_A.CUSTOMER, row.CUSTOMER);
      setVal(config.COLUMNS.ZONE_A.SKU_NAME_VERSION, row.SKU_NAME_VERSION);
      
      // ⭐ STRICT KEYS
      setVal(config.COLUMNS.ZONE_A.FINISHED_GOODS_ORDER_QTY, row.FINISHED_GOODS_ORDER_QTY);
      setVal(config.COLUMNS.ZONE_A.CURRENT_COMPLETION_QTY, row.CURRENT_COMPLETION_QTY);
      setVal(config.COLUMNS.ZONE_A.CURRENT_PERCENT, row.CURRENT_PERCENT ? row.CURRENT_PERCENT / 100 : 0);
      setVal(config.COLUMNS.ZONE_A.FFD, row.FFD ? new Date(row.FFD) : '');
      setVal(config.COLUMNS.ZONE_A.GHOST_CONTEXT, row.GHOST_CONTEXT);
      setVal(config.COLUMNS.ZONE_A.STATUS_NOTE, row.STATUS_NOTE);
      
      // ⭐ IMPORTANT: We DO NOT write to NEW_CUMULATIVE_QTY (Col 11).
      // That column is reserved for the RESULT FORMULA.
      
      // Zone C (Hidden State)
      setVal(config.COLUMNS.ZONE_C.DATA_STATE, row.DATA_STATE);
      return sheetRow;
    });
  },

  /**
   * ⭐ INJECTS THE SMART SANDWICH FORMULAS
   * 1. Ref (Suggestion) = SUMIF(Plan)
   * 2. Result (New Cumul) = IF(Override, Override, Ref)
   */
  _injectFormulas: function(sheet) {
    const config = getPSPConfig();
    const startRow = config.DATA_START_ROW;
    
    // 1. Get Column Letters for the formula construction
    const vpoColLetter      = getColumnLetter(config.COLUMNS.ZONE_A.VPO.col);
    const refColLetter      = getColumnLetter(config.COLUMNS.ZONE_C.REF_CUMULATIVE_QTY.col);
    const overrideColLetter = getColumnLetter(config.COLUMNS.ZONE_B.OVERRIDE_CUMULATIVE_QTY.col);
    
    // 2. Define Ranges for MAP (e.g., B6:B)
    const vpoRange      = `${vpoColLetter}${startRow}:${vpoColLetter}`;
    const refRange      = `${refColLetter}${startRow}:${refColLetter}`;
    const overrideRange = `${overrideColLetter}${startRow}:${overrideColLetter}`;
    
    // 3. Generate Formulas
    const refFormula    = config.LOGIC_FORMULAS.REF_GENERATOR(vpoRange);
    const resultFormula = config.LOGIC_FORMULAS.RESULT_GENERATOR(refRange, overrideRange);

    // 4. Inject REF Formula (Zone C)
    sheet.getRange(startRow, config.COLUMNS.ZONE_C.REF_CUMULATIVE_QTY.col).setFormula(refFormula);

    // 5. Inject RESULT Formula (Zone A)
    sheet.getRange(startRow, config.COLUMNS.ZONE_A.NEW_CUMULATIVE_QTY.col).setFormula(resultFormula);
  },

  _surgicalClear: function(sheet) {
    const config = getPSPConfig();
    const lastRow = sheet.getLastRow();
    
    if (lastRow >= config.DATA_START_ROW) {
      const numRows = lastRow - config.DATA_START_ROW + 1;
      const totalCols = getTotalColumnCount();

      // Clear the entire data block content (Rows 6+)
      // This is safer than clearing ranges because it wipes old array formulas
      sheet.getRange(config.DATA_START_ROW, 1, numRows, totalCols).clearContent();

      // Reset formats (Zone A & B) - but strictly preserve Pillars if we can
      // For simplicity, we can reset backgrounds to white and let _paintSession restore them
      sheet.getRange(config.DATA_START_ROW, 1, numRows, totalCols)
           .setBackground('white')
           .setFontColor('black')
           .setFontWeight('normal');
    }
  },

  _paintSession: function(sheet, rowCount, gridData) {
    const config = getPSPConfig();
    const startRow = config.DATA_START_ROW;

    if (rowCount <= 0) return;

    // 1. Apply Zebra Banding (Zone A)
    // Range: 1 to 11 (Includes the Result Column)
    const zoneARange = sheet.getRange(startRow, 1, rowCount, 11);
    zoneARange.getBandings().forEach(b => b.remove()); 
    zoneARange.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);

    // 2. Highlight "Near Complete" Orders (>90%)
    const percentColIndex = config.COLUMNS.ZONE_A.CURRENT_PERCENT.col - 1;
    gridData.forEach((row, i) => {
      const percent = row[percentColIndex];
      if (typeof percent === 'number' && percent >= 0.9) {
        const currentRow = startRow + i;
        // Paint Zone A (Context + Result)
        sheet.getRange(currentRow, 1, 1, 11).setBackground(config.COLORS.NEAR_COMPLETE);
        // Paint Zone B (Override)
        sheet.getRange(currentRow, config.COLUMNS.ZONE_B.OVERRIDE_CUMULATIVE_QTY.col, 1, 1)
             .setBackground(config.COLORS.NEAR_COMPLETE);
      }
    });

    // 3. RE-ENFORCE PILLARS (The Safety Net)
    if (config.COLUMNS.PILLARS) {
      Object.values(config.COLUMNS.PILLARS).forEach(def => {
        sheet.getRange(startRow, def.col, rowCount, 1)
             .setBackground('#000000')
             .setFontColor('#FFFFFF');
      });
    }

    // 4. Borders
    sheet.getRange(startRow, 1, rowCount, getTotalColumnCount())
         .setBorder(true, true, true, true, true, true, '#E0E0E0', SpreadsheetApp.BorderStyle.SOLID);
         
    // 5. Zone B Highlight (Blue) for Empty Overrides
    const overrideCol = config.COLUMNS.ZONE_B.OVERRIDE_CUMULATIVE_QTY.col;
    sheet.getRange(startRow, overrideCol, rowCount, 1)
         .setBackground(config.COLORS.ZONE_B_DATA)
         .setFontWeight('bold');
  },

  _applyConditionalFormatting: function(sheet, rowCount) {
    const config = getPSPConfig();
    
    // ⭐ TARGET: The Result Column (Zone A), NOT the Override
    const resultCol = config.COLUMNS.ZONE_A.NEW_CUMULATIVE_QTY.col;
    const orderQtyCol = config.COLUMNS.ZONE_A.FINISHED_GOODS_ORDER_QTY.col;
    const currentQtyCol = config.COLUMNS.ZONE_A.CURRENT_COMPLETION_QTY.col;

    const startRow = config.DATA_START_ROW;
    const maxRow = Math.max(startRow + rowCount + 100, 1000);

    const resultColLetter = getColumnLetter(resultCol);
    const orderQtyColLetter = getColumnLetter(orderQtyCol);
    const currentQtyColLetter = getColumnLetter(currentQtyCol);
    
    // Apply rules to the Result Column
    const targetRange = sheet.getRange(`${resultColLetter}${startRow}:${resultColLetter}${maxRow}`);
    
    sheet.clearConditionalFormatRules();
    const rules = [];

    // Rule 1: RED - Exceeds 110% Cap
    // Formula: =AND(Result<>"", Result > Order * 1.1)
    const capFormula = `=AND(${resultColLetter}${startRow}<>"", ${resultColLetter}${startRow} > ${orderQtyColLetter}${startRow} * ${config.CAP_MULTIPLIER})`;
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(capFormula)
      .setBackground(config.COLORS.ERROR_RED)
      .setFontColor('#FFFFFF')
      .setRanges([targetRange])
      .build());

    // Rule 2: YELLOW - Less than Current (Backward Movement)
    // Formula: =AND(Result<>"", Result < Current)
    const backwardFormula = `=AND(${resultColLetter}${startRow}<>"", ${resultColLetter}${startRow} < ${currentQtyColLetter}${startRow})`;
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(backwardFormula)
      .setBackground(config.COLORS.WARNING_YELLOW)
      .setRanges([targetRange])
      .build());

    // Rule 3: GREEN - Valid
    // Formula: =AND(Result<>"", Result >= Current, Result <= Cap)
    const validFormula = `=AND(${resultColLetter}${startRow}<>"", ${resultColLetter}${startRow} >= ${currentQtyColLetter}${startRow}, ${resultColLetter}${startRow} <= ${orderQtyColLetter}${startRow} * ${config.CAP_MULTIPLIER})`;
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(validFormula)
      .setBackground(config.COLORS.SUCCESS_GREEN)
      .setFontColor('#FFFFFF')
      .setRanges([targetRange])
      .build());

    sheet.setConditionalFormatRules(rules);
  },

  _applyProtection: function(sheet) {
    const config = getPSPConfig();
    
    const existing = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    existing.forEach(p => p.remove());
    
    const protection = sheet.protect().setDescription('Session Protection');
    const startRow = config.DATA_START_ROW;
    const maxRows = sheet.getMaxRows();
    
    // ⭐ STRICT: Unlock ONLY the Override Column (Zone B)
    const overrideCol = config.COLUMNS.ZONE_B.OVERRIDE_CUMULATIVE_QTY.col;
    const inputRange = sheet.getRange(startRow, overrideCol, maxRows - startRow + 1, 1);

    protection.removeEditors(protection.getEditors());
    protection.addEditor(Session.getEffectiveUser());
    protection.setUnprotectedRanges([inputRange]);
    
    // Note: Zone A (Result) and Zone C (Ref) are naturally locked by the sheet protection
  }
};