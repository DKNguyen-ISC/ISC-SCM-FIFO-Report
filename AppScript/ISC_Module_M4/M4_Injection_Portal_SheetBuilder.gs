/* -------------------------------------------------------------------------
 * FILE: ISC_Module_M4/M4_Injection_Portal_SheetBuilder.gs
 * DESCRIPTION: The Architect for the "Legacy PO Injection Portal".
 * REVISION: v1.4 (Added: SUPPLIER_NAME dropdown from BigQuery)
 * ------------------------------------------------------------------------- */

const M4_INJECTION_CONSTANTS = {
  // 🔒 The Master Template (Hidden/Protected)
  TEMPLATE_NAME: 'M4_PO_Direct_Injection_Template',
  SESSION_SUFFIX: '_PO_Direct_Injection_Portal',
  
  // Layout Dimensions
  HEADER_ROW: 5,
  DATA_START_ROW: 6,

  // 🏛️ Pillars
  PILLAR_START: 'RAW_START',
  PILLAR_END: 'RAW_END',

  // 🎨 Styling
  COLORS: {
    ZONE_A_BG: '#d9ead3',      // 🟢 Green (System/Read-Only)
    ZONE_B_BG: '#cfe2f3',      // 🔵 Blue (User Input)
    ZONE_A_TEXT: '#274e13',    // Dark Green Text
    ZONE_B_TEXT: '#0b5394',    // Dark Blue Text
    
    PILLAR_BG: '#000000',      // ⚫ Black Separator
    PILLAR_TEXT: '#ffffff',    // ⚪ White Text
    
    ERROR_BG: '#f4cccc',       // 🔴 Light Red (Validation Errors)
    SUCCESS_BG: '#b6d7a8',     // 🟢 Light Green (Committed)
    PENDING_BG: '#fff2cc',     // 🟡 Light Yellow (Pending)
    
    DASHBOARD_BG: '#434343',   // Dark Grey (Title)
    DASHBOARD_TEXT: '#ffffff'
  },

  // 📅 Formats
  FMT_DATE: 'dd-MMM-yyyy',
  FMT_NUMBER: '#,##0.00',
  FMT_INTEGER: '#,##0',
  FMT_TEXT: '@',

  // 📊 Dashboard Cells (Matches v1.2 Layout)
  CELL_PIC_NAME: 'C2',
  CELL_SESSION_ID: 'E2',
  CELL_UPLOAD_TIME: 'C3',
  CELL_STATUS: 'E3'
};

/**
 * 🚀 MAIN FUNCTION: Builds the "Legacy PO Injection Portal" Template
 */
function buildInjectionPortalTemplate() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(M4_INJECTION_CONSTANTS.TEMPLATE_NAME);

  // 1. Reset or Create
  if (sheet) {
    sheet.clear();
    sheet.getDataRange().clearDataValidations().clearFormat();
  } else {
    sheet = ss.insertSheet(M4_INJECTION_CONSTANTS.TEMPLATE_NAME);
  }

  // 2. --- 📊 BUILD DASHBOARD (Rows 1-4) ---
  _buildInjectionDashboard(sheet);

  // 3. Define Headers
  // Zone A: System/Read-Only (Left side)
  const zoneA_Headers = [
    { name: 'ROW_NUMBER', width: 60 },
    { name: 'VALIDATION_STATUS', width: 110 },
    { name: 'ERROR_MESSAGE', width: 200 },
    { name: 'GENERATED_PO_LINE_ID', width: 180 },
    { name: 'DERIVED_STATUS', width: 100 }
  ];

  // Zone B: User Input (Right side)
  const zoneB_Headers = [
    { name: 'SUPPLIER_NAME', width: 150 },
    { name: 'BOM_UPDATE', width: 150 },
    { name: 'ORDER_QTY', width: 90 },
    { name: 'UNIT_PRICE', width: 90 },
    { name: 'CONFIRMED_QTY', width: 100 },
    { name: 'LOADED_QTY', width: 90 },
    { name: 'ORIGINAL_ORDER_DATE', width: 120 },
    { name: 'FINAL_REQUESTED_DELIVERY_DATE', width: 140 },
    { name: 'AGREED_DELIVERY_DATE', width: 130 },
    { name: 'CURRENT_ETA', width: 100 },
    { name: 'LEGACY_PO_REF', width: 120 },
    { name: 'VPO', width: 100 },
    { name: 'PO_LINE_NOTE', width: 200 }
  ];

  let colIndex = 1;

  // 4. --- 🟢 Build Zone A (Read-Only) ---
  zoneA_Headers.forEach(col => {
    _renderInjectionHeaderCell(sheet, colIndex, col, 
      M4_INJECTION_CONSTANTS.COLORS.ZONE_A_BG, 
      M4_INJECTION_CONSTANTS.COLORS.ZONE_A_TEXT);
    colIndex++;
  });

  // 5. --- ⚫ Pillar 1: RAW_START ---
  _buildInjectionPillar(sheet, colIndex, M4_INJECTION_CONSTANTS.PILLAR_START);
  colIndex++;

  // 6. --- 🔵 Build Zone B (User Input) ---
  const zoneB_StartIdx = colIndex;
  zoneB_Headers.forEach(col => {
    _renderInjectionHeaderCell(sheet, colIndex, col, 
      M4_INJECTION_CONSTANTS.COLORS.ZONE_B_BG, 
      M4_INJECTION_CONSTANTS.COLORS.ZONE_B_TEXT);
    colIndex++;
  });

  // 7. --- ⚫ Pillar 2: RAW_END ---
  const pillarEndIdx = colIndex;
  _buildInjectionPillar(sheet, colIndex, M4_INJECTION_CONSTANTS.PILLAR_END);

  // 8. 🧠 INJECT INTELLIGENCE (Formulas, Validations, Formatting)
  // Note: Supplier dropdown will be applied at session start (fresh data)
  _injectInjectionLogic(sheet, zoneB_StartIdx, zoneB_Headers, null);

  // 9. 🔢 ROW_NUMBER Formula
  _setupRowNumberFormula(sheet);

  // 10. 🧊 FREEZE & LAYOUT
  sheet.setFrozenRows(M4_INJECTION_CONSTANTS.HEADER_ROW);
  
  // 11. 📝 TEXT WRAPPING (Global)
  sheet.getDataRange().setWrap(true);
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).setWrap(true);

  // 12. 🛡️ PROTECT TEMPLATE
  _protectInjectionSheet(sheet, zoneB_StartIdx, pillarEndIdx - 1);

  console.log(`✅ Template Built: ${M4_INJECTION_CONSTANTS.TEMPLATE_NAME}`);
  SpreadsheetApp.getUi().alert("✅ Injection Portal Template Built Successfully!\n\nSupplier dropdown will be populated when you start a session.");
}

/* =========================================================================
 * 🏭 SUPPLIER DROPDOWN (BigQuery-Driven)
 * ========================================================================= */

/**
 * 🔍 Fetches the list of active suppliers from Supplier_Information.
 * Called at session start to ensure fresh data.
 * @returns {Array<string>} List of supplier names, sorted A-Z
 */
function fetchSupplierListFromBQ() {
  try {
    const config = ISC_SCM_Core_Lib.getCoreConfig();
    const query = `
      SELECT DISTINCT SUPPLIER_NAME 
      FROM \`${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}.Supplier_Information\`
      WHERE SUPPLIER_NAME IS NOT NULL 
        AND TRIM(SUPPLIER_NAME) != ''
      ORDER BY SUPPLIER_NAME ASC
    `;
    
    const results = ISC_SCM_Core_Lib.runReadQueryMapped(query);
    
    if (!results || results.length === 0) {
      console.warn('⚠️ No suppliers found in Supplier_Information table.');
      return [];
    }
    
    // Extract just the names into a flat array
    const supplierList = results.map(row => row.SUPPLIER_NAME);
    console.log(`✅ Fetched ${supplierList.length} suppliers from BigQuery.`);
    
    return supplierList;
    
  } catch (e) {
    console.error('❌ Failed to fetch supplier list:', e.message);
    return [];
  }
}

/**
 * 🎯 Applies SUPPLIER_NAME dropdown to the specified sheet.
 * @param {Sheet} sheet - The session sheet
 * @param {Array<string>} supplierList - List of valid supplier names
 */
function applySupplierDropdown(sheet, supplierList) {
  if (!supplierList || supplierList.length === 0) {
    console.warn('⚠️ Cannot apply dropdown: Supplier list is empty.');
    return;
  }
  
  const headers = sheet.getRange(M4_INJECTION_CONSTANTS.HEADER_ROW, 1, 1, sheet.getLastColumn()).getValues()[0];
  const supplierColIdx = headers.indexOf('SUPPLIER_NAME') + 1;
  
  if (supplierColIdx === 0) {
    console.error('❌ SUPPLIER_NAME column not found in headers.');
    return;
  }
  
  // Create data validation rule with dropdown
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(supplierList, true)  // true = show dropdown arrow
    .setAllowInvalid(true)  // Allow paste of values not in list (SP will validate)
    .setHelpText('Select a supplier from the list, or type/paste a value.')
    .build();
  
  // Apply to SUPPLIER_NAME column (rows 6 to 1000)
  const maxRows = 1000;
  const range = sheet.getRange(
    M4_INJECTION_CONSTANTS.DATA_START_ROW, 
    supplierColIdx, 
    maxRows, 
    1
  );
  range.setDataValidation(rule);
  
  console.log(`✅ Applied supplier dropdown to column ${supplierColIdx} (${supplierList.length} options).`);
}

/* =========================================================================
 * 🧠 LOGIC INJECTORS
 * ========================================================================= */

/**
 * 🟢 PUBLIC HELPER: Re-applies Validations & Formatting
 * Called after session start to restore dropdowns/date pickers.
 * @param {Sheet} sheet - The session sheet
 * @param {Array<string>|null} supplierList - Optional pre-fetched supplier list
 */
function restoreInjectionValidations(sheet, supplierList) {
  const headers = sheet.getRange(M4_INJECTION_CONSTANTS.HEADER_ROW, 1, 1, sheet.getLastColumn()).getValues()[0];
  const startIdx = headers.indexOf(M4_INJECTION_CONSTANTS.PILLAR_START);
  
  if (startIdx !== -1) {
    const zoneB_StartCol = startIdx + 2;
    
    const zoneB_Headers = [
      { name: 'SUPPLIER_NAME' }, { name: 'BOM_UPDATE' }, { name: 'ORDER_QTY' }, 
      { name: 'UNIT_PRICE' }, { name: 'CONFIRMED_QTY' }, { name: 'LOADED_QTY' }, 
      { name: 'ORIGINAL_ORDER_DATE' }, { name: 'FINAL_REQUESTED_DELIVERY_DATE' }, 
      { name: 'AGREED_DELIVERY_DATE' }, { name: 'CURRENT_ETA' }, 
      { name: 'LEGACY_PO_REF' }, { name: 'VPO' }, { name: 'PO_LINE_NOTE' }
    ];
    
    _injectInjectionLogic(sheet, zoneB_StartCol, zoneB_Headers, supplierList);
    sheet.getDataRange().setWrap(true);
  }
}

/**
 * 🧠 INTERNAL: Injects Data Validation & Conditional Formatting
 * @param {Sheet} sheet
 * @param {number} zoneB_Start - Starting column index for Zone B
 * @param {Array} zoneB_Headers - Header definitions
 * @param {Array<string>|null} supplierList - Optional supplier list for dropdown
 */
function _injectInjectionLogic(sheet, zoneB_Start, zoneB_Headers, supplierList) {
  const maxRows = 1000;
  sheet.clearConditionalFormatRules();

  // 1. 🏭 SUPPLIER DROPDOWN (If list provided)
  if (supplierList && supplierList.length > 0) {
    const supplierIdx = zoneB_Headers.findIndex(h => h.name === 'SUPPLIER_NAME');
    if (supplierIdx !== -1) {
      const absCol = zoneB_Start + supplierIdx;
      const rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(supplierList, true)
        .setAllowInvalid(true)  // Allow paste, SP validates
        .setHelpText('Select supplier or type/paste value.')
        .build();
      sheet.getRange(M4_INJECTION_CONSTANTS.DATA_START_ROW, absCol, maxRows, 1)
           .setDataValidation(rule);
    }
  }

  // 2. 📅 DATE PICKERS (Exclude 'UPDATE' columns like BOM_UPDATE)
  zoneB_Headers.forEach((h, i) => {
    const upperName = h.name.toUpperCase();
    
    // Must contain DATE or ETA, but NOT contain UPDATE
    if ((upperName.includes('DATE') || upperName.includes('ETA')) && !upperName.includes('UPDATE')) {
      const absCol = zoneB_Start + i;
      const ruleDate = SpreadsheetApp.newDataValidation()
        .requireDate()
        .setAllowInvalid(true)  // Allow paste
        .build();
      sheet.getRange(M4_INJECTION_CONSTANTS.DATA_START_ROW, absCol, maxRows, 1)
           .setDataValidation(ruleDate)
           .setNumberFormat(M4_INJECTION_CONSTANTS.FMT_DATE);
    }
  });

  // 3. 🔢 NUMBER FORMATS
  zoneB_Headers.forEach((h, i) => {
    const upperName = h.name.toUpperCase();
    if (upperName.includes('QTY') || upperName.includes('PRICE')) {
      const absCol = zoneB_Start + i;
      sheet.getRange(M4_INJECTION_CONSTANTS.DATA_START_ROW, absCol, maxRows, 1)
           .setNumberFormat(M4_INJECTION_CONSTANTS.FMT_NUMBER);
    }
  });

  // 4. 🎨 CONDITIONAL FORMATTING FOR VALIDATION_STATUS
  const statusColLetter = 'B'; 
  
  const errorFormula = `=$${statusColLetter}${M4_INJECTION_CONSTANTS.DATA_START_ROW}="ERROR"`;
  _addInjectionCFRule(sheet, errorFormula, M4_INJECTION_CONSTANTS.COLORS.ERROR_BG, false);
  
  const committedFormula = `=$${statusColLetter}${M4_INJECTION_CONSTANTS.DATA_START_ROW}="COMMITTED"`;
  _addInjectionCFRule(sheet, committedFormula, M4_INJECTION_CONSTANTS.COLORS.SUCCESS_BG, false);
  
  const pendingFormula = `=$${statusColLetter}${M4_INJECTION_CONSTANTS.DATA_START_ROW}="PENDING"`;
  _addInjectionCFRule(sheet, pendingFormula, M4_INJECTION_CONSTANTS.COLORS.PENDING_BG, false);
}

/**
 * 🔢 Setup ROW_NUMBER auto-calculation formula
 */
function _setupRowNumberFormula(sheet) {
  const maxRows = 500;
  for (let row = M4_INJECTION_CONSTANTS.DATA_START_ROW; row < M4_INJECTION_CONSTANTS.DATA_START_ROW + maxRows; row++) {
    // G is SUPPLIER_NAME (first Zone B column after pillar)
    const formula = `=IF(G${row}<>"", ROW()-${M4_INJECTION_CONSTANTS.HEADER_ROW}, "")`;
    sheet.getRange(row, 1).setFormula(formula);
  }
  sheet.getRange(M4_INJECTION_CONSTANTS.DATA_START_ROW, 1, maxRows, 1)
       .setNumberFormat(M4_INJECTION_CONSTANTS.FMT_INTEGER)
       .setHorizontalAlignment('center');
}

/* =========================================================================
 * 🛠️ UTILITIES & DASHBOARD
 * ========================================================================= */

function _buildInjectionDashboard(sheet) {
  // --- ROW 1: TITLE ---
  sheet.getRange("A1:B1").setBackground(M4_INJECTION_CONSTANTS.COLORS.DASHBOARD_BG);
  
  sheet.getRange("C1:N1").merge()
       .setValue("🏭 LEGACY PO INJECTION PORTAL")
       .setFontSize(14).setFontWeight("bold")
       .setBackground(M4_INJECTION_CONSTANTS.COLORS.DASHBOARD_BG)
       .setFontColor(M4_INJECTION_CONSTANTS.COLORS.DASHBOARD_TEXT)
       .setHorizontalAlignment('left').setVerticalAlignment('middle')
       .setWrap(true);

  // --- ROWS 2 & 3: METADATA ---
  const labelStyle = { weight: "bold", color: '#666666', align: "right" };
  
  sheet.getRange("B2").setValue("Session Owner:").setFontWeight(labelStyle.weight).setFontColor(labelStyle.color).setHorizontalAlignment(labelStyle.align);
  sheet.getRange("C2").setValue("[START SESSION]").setFontWeight("bold").setFontColor("blue");
  
  sheet.getRange("D2").setValue("Session ID:").setFontWeight(labelStyle.weight).setFontColor(labelStyle.color).setHorizontalAlignment(labelStyle.align);
  sheet.getRange("E2").setValue("[Pending...]").setFontFamily("monospace").setFontSize(9);
  
  sheet.getRange("B3").setValue("Upload Time:").setFontWeight(labelStyle.weight).setFontColor(labelStyle.color).setHorizontalAlignment(labelStyle.align);
  sheet.getRange("C3").setValue("[Timestamp]").setFontStyle("italic");
  
  sheet.getRange("D3").setValue("Status:").setFontWeight(labelStyle.weight).setFontColor(labelStyle.color).setHorizontalAlignment(labelStyle.align);
  sheet.getRange("E3").setValue("READY").setFontWeight("bold").setFontColor("green");

  sheet.getRange("B2:E3").setBorder(true, true, true, true, true, true);

  // --- ROW 4: INSTRUCTIONS ---
  const instrBg = M4_INJECTION_CONSTANTS.COLORS.PENDING_BG;
  
  sheet.getRange("A4:B4").setBackground(instrBg);
  sheet.getRange("C4:N4").merge()
       .setValue("⚠️ INSTRUCTIONS: Select SUPPLIER from dropdown. Enter BOM_UPDATE exactly as in master. Provide CURRENT_ETA if dates are old (>7 days past). VPO defaults to 'GENERAL_STOCK' if blank.")
       .setFontColor("red").setFontStyle("italic").setBackground(instrBg)
       .setWrap(true);
       
  sheet.setRowHeight(4, 40); 
}

function _renderInjectionHeaderCell(sheet, colIndex, colDef, bg, color) {
  const range = sheet.getRange(M4_INJECTION_CONSTANTS.HEADER_ROW, colIndex);
  range.setValue(colDef.name)
       .setBackground(bg)
       .setFontColor(color)
       .setFontWeight("bold")
       .setHorizontalAlignment("center")
       .setWrap(true)
       .setBorder(true, true, true, true, null, null);
  sheet.setColumnWidth(colIndex, colDef.width);
}

function _buildInjectionPillar(sheet, colIndex, name) {
  sheet.getRange(M4_INJECTION_CONSTANTS.HEADER_ROW, colIndex)
       .setValue(name)
       .setBackground(M4_INJECTION_CONSTANTS.COLORS.PILLAR_BG)
       .setFontColor(M4_INJECTION_CONSTANTS.COLORS.PILLAR_TEXT)
       .setFontWeight("bold")
       .setHorizontalAlignment("center")
       .setWrap(true);
  
  sheet.getRange(M4_INJECTION_CONSTANTS.DATA_START_ROW, colIndex, 1000, 1)
       .setBackground(M4_INJECTION_CONSTANTS.COLORS.PILLAR_BG);
  
  sheet.setColumnWidth(colIndex, 20);
}

function _addInjectionCFRule(sheet, formula, bg, strike) {
  const rangeAll = sheet.getRange(M4_INJECTION_CONSTANTS.DATA_START_ROW, 1, 1000, sheet.getLastColumn());
  const rule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(formula)
    .setBackground(bg)
    .setStrikethrough(strike)
    .setRanges([rangeAll])
    .build();
  const rules = sheet.getConditionalFormatRules();
  rules.push(rule);
  sheet.setConditionalFormatRules(rules);
}

function _protectInjectionSheet(sheet, unlockStartCol, unlockEndCol) {
  const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  protections.forEach(p => p.remove());
  
  const protection = sheet.protect().setDescription('Protected Injection Portal - Only Zone B Editable');
  const unlockedRange = sheet.getRange(
    M4_INJECTION_CONSTANTS.DATA_START_ROW, 
    unlockStartCol, 
    sheet.getMaxRows() - M4_INJECTION_CONSTANTS.DATA_START_ROW + 1, 
    (unlockEndCol - unlockStartCol + 1)
  );
  protection.setUnprotectedRanges([unlockedRange]);
  protection.addEditor(Session.getActiveUser());
}

/**
 * 🔓 PUBLIC: Re-protect sheet after operations
 */
function protectInjectionSessionSheet(sheet) {
  const headers = sheet.getRange(M4_INJECTION_CONSTANTS.HEADER_ROW, 1, 1, sheet.getLastColumn()).getValues()[0];
  const startIdx = headers.indexOf(M4_INJECTION_CONSTANTS.PILLAR_START);
  const endIdx = headers.indexOf(M4_INJECTION_CONSTANTS.PILLAR_END);
  
  if (startIdx !== -1 && endIdx !== -1) {
    _protectInjectionSheet(sheet, startIdx + 2, endIdx);
  }
}

/**
 * 🔧 PUBLIC: Get constants for Main controller
 */
function getInjectionConstants() {
  return M4_INJECTION_CONSTANTS;
}