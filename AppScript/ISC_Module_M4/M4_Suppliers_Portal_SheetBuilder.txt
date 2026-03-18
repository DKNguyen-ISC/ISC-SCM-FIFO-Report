/* -------------------------------------------------------------------------
 * FILE: ISC_Module_M4/M4_Suppliers_Portal_SheetBuilder.gs
 * DESCRIPTION: The Architect for the "Logistics Control Tower" (UI_Supplier_Portal).
 * ROLE: Pure Rendering. Creates a dynamic 2-Zone Interface with "Mid-Pillar" Architecture.
 * REVISION: v6.0 (Restore Validations, Soft Rejection Highlight, Hybrid Dates)
 * ------------------------------------------------------------------------- */

const M4_PORTAL_CONSTANTS = {
  // 🔒 The Master Template (Hidden/Protected)
  TEMPLATE_NAME: 'M4_UI_Supplier_Portal_Template',
  
  // Layout Dimensions
  HEADER_ROW: 5, 
  DATA_START_ROW: 6,

  // 🏛️ Pillars (The Edit Zone Delimiters)
  PILLAR_START: 'RAW_START',
  PILLAR_END:   'RAW_END',

  // 🎨 Styling
  COLORS: {
    ZONE_A_BG: '#d9ead3',     // 🟢 Green (Context/System - Read Only)
    ZONE_B_BG: '#cfe2f3',     // 🔵 Blue (Feedback - Editable)
    ZONE_A_TEXT: '#274e13',   // Dark Green Text
    ZONE_B_TEXT: '#0b5394',   // Dark Blue Text
    
    PILLAR_BG: '#000000',     // ⚫ Black Separator
    PILLAR_TEXT: '#ffffff',   // ⚪ White Text
    
    EXECUTIONER_BG: '#ea9999', // 🔴 Light Red (For Cancellation Highlight)
    WARNING_BG: '#fce5cd',     // 🟠 Light Orange (For Zero Qty / Soft Rejection)
    
    DASHBOARD_BG: '#fff2cc',   // 🟡 Light Yellow for Dashboard Context
    DASHBOARD_LABEL: '#999999' // Grey Label
  },

  // 📅 Formats
  FMT_DATE: 'dd-MMM-yyyy', // "07-Feb-2026"
  FMT_NUMBER: '#,##0.00',
  FMT_TEXT: '@',

  // ⚔️ "The Executioner" Logic
  EXECUTIONER_OPTIONS: [
    'CUSTOMER_CANCELLED',
    'SUPPLIER_DECLINED',
    'QUALITY_ISSUE',
    'BUYER_REVOKED',
    'LOGISTICS_DELAY'
  ]
};

/**
 * 🚀 MAIN FUNCTION: Builds the "Logistics Control Tower" Template
 */
function buildSupplierPortalTemplate() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(M4_PORTAL_CONSTANTS.TEMPLATE_NAME);

  // 1. Reset or Create
  if (sheet) {
    sheet.clear();
    sheet.getDataRange().clearDataValidations().clearFormat();
  } else {
    sheet = ss.insertSheet(M4_PORTAL_CONSTANTS.TEMPLATE_NAME);
  }

  // 2. --- 📊 BUILD DASHBOARD (Rows 1-4) ---
  _buildDashboard(sheet);

  // 3. Define Headers
  const keyHeaders = [
    { name: 'PO_LINE_ID', width: 100 },
    { name: 'FEEDBACK_BATCH_ID', width: 100 },
    { name: 'PIC', width: 80 }
  ];

  const zoneA_Headers = [
    { name: 'PO_NUMBER_REF', width: 120 },
    { name: 'SUPPLIER_NAME', width: 150 },
    { name: 'BOM_UPDATE', width: 150 },
    { name: 'VPO', width: 80 },
    { name: 'DATE_CODE', width: 80 },
    { name: 'FULFILLMENT_MODE', width: 100 },
    { name: 'ORDER_QTY', width: 90 },
    { name: 'FINAL_REQUESTED_DELIVERY_DATE', width: 110 },
    { name: 'PO_LINE_NOTE', width: 200 }
  ];

  const zoneB_Headers = [
    { name: 'CLOSURE_REASON', width: 160 }, 
    { name: 'CONFIRMED_QTY', width: 90 },
    { name: 'AGREED_DELIVERY_DATE', width: 110 },
    { name: 'CURRENT_ETA', width: 110 },          
    { name: 'LOADED_QTY', width: 90 },
    { name: 'ACTUAL_ARRIVAL_DATE', width: 110 },  
    { name: 'ACTUAL_RECEIVED_QTY', width: 90 },
    { name: 'SUPPLIER_FEEDBACK_NOTE', width: 200 }
  ];

  let colIndex = 1;

  // 4. --- 🟢 Build Keys ---
  keyHeaders.forEach(col => {
    _renderHeaderCell(sheet, colIndex, col, M4_PORTAL_CONSTANTS.COLORS.ZONE_A_BG, M4_PORTAL_CONSTANTS.COLORS.ZONE_A_TEXT);
    colIndex++;
  });

  // 5. --- 🟢 Build Zone A ---
  zoneA_Headers.forEach(col => {
    _renderHeaderCell(sheet, colIndex, col, M4_PORTAL_CONSTANTS.COLORS.ZONE_A_BG, M4_PORTAL_CONSTANTS.COLORS.ZONE_A_TEXT);
    colIndex++;
  });

  // 6. --- ⚫ Pillar 1: RAW_START ---
  const pillarStartIdx = colIndex;
  _buildPillar(sheet, colIndex, M4_PORTAL_CONSTANTS.PILLAR_START);
  colIndex++;

  // 7. --- 🔵 Build Zone B ---
  const zoneB_StartIdx = colIndex; 
  zoneB_Headers.forEach(col => {
    _renderHeaderCell(sheet, colIndex, col, M4_PORTAL_CONSTANTS.COLORS.ZONE_B_BG, M4_PORTAL_CONSTANTS.COLORS.ZONE_B_TEXT);
    colIndex++;
  });
  
  // 8. --- ⚫ Pillar 2: RAW_END ---
  const pillarEndIdx = colIndex;
  _buildPillar(sheet, colIndex, M4_PORTAL_CONSTANTS.PILLAR_END);

  // 9. 🧠 INJECT INTELLIGENCE
  _injectPortalLogic(sheet, zoneB_StartIdx, zoneB_Headers);

  // 10. 🧊 FREEZE & LAYOUT
  sheet.setFrozenRows(M4_PORTAL_CONSTANTS.HEADER_ROW);
  
  // 11. 🛡️ PROTECT TEMPLATE
  _protectSheetStrict(sheet, zoneB_StartIdx, colIndex - 1);

  console.log(`✅ Template Built: ${M4_PORTAL_CONSTANTS.TEMPLATE_NAME}`);
  SpreadsheetApp.getUi().alert("✅ Template Built Successfully");
}

/* =========================================================================
 * 🧠 LOGIC INJECTORS (Public & Private)
 * ========================================================================= */

/**
 * 🟢 PUBLIC HELPER: Re-applies Validations & Formatting
 * Called by Controller after wiping the sheet to restore Dropdowns/Date Pickers.
 */
function restoreValidations(sheet) {
  const headers = sheet.getRange(M4_PORTAL_CONSTANTS.HEADER_ROW, 1, 1, sheet.getLastColumn()).getValues()[0];
  const startIdx = headers.indexOf(M4_PORTAL_CONSTANTS.PILLAR_START);
  
  if (startIdx !== -1) {
    const zoneB_StartCol = startIdx + 2; // Zone B starts 1 col after Pillar 1 (1-based index)
    
    // Re-construct the Zone B Headers list to map columns correctly
    // We assume the standard layout. For robust mapping, we could scan headers, 
    // but standard template structure is sufficient here.
    const zoneB_Headers = [
      { name: 'CLOSURE_REASON' }, 
      { name: 'CONFIRMED_QTY' },
      { name: 'AGREED_DELIVERY_DATE' },
      { name: 'CURRENT_ETA' },          
      { name: 'LOADED_QTY' },
      { name: 'ACTUAL_ARRIVAL_DATE' },  
      { name: 'ACTUAL_RECEIVED_QTY' },
      { name: 'SUPPLIER_FEEDBACK_NOTE' }
    ];

    _injectPortalLogic(sheet, zoneB_StartCol, zoneB_Headers);
  }
}

/**
 * 🧠 INTERNAL: Injects Data Validation & Conditional Formatting
 */
function _injectPortalLogic(sheet, zoneB_Start, zoneB_Headers) {
  const maxRows = 1000;
  // Clear old rules first to avoid duplication pile-up on restore
  sheet.clearConditionalFormatRules();

  // 1. ⚔️ THE EXECUTIONER DROPDOWN (CLOSURE_REASON)
  const closureReasonIdx = zoneB_Headers.findIndex(h => h.name === 'CLOSURE_REASON');
  if (closureReasonIdx !== -1) {
    const absCol = zoneB_Start + closureReasonIdx;
    
    // Dropdown Rule
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(M4_PORTAL_CONSTANTS.EXECUTIONER_OPTIONS)
      .setAllowInvalid(true) // Allow legacy data
      .build();
    sheet.getRange(M4_PORTAL_CONSTANTS.DATA_START_ROW, absCol, maxRows, 1).setDataValidation(rule);
    
    // 🔴 CF: Red Strikethrough if Cancelled
    const colLetter = _colIndexToLetter(absCol);
    const formula = `=$${colLetter}${M4_PORTAL_CONSTANTS.DATA_START_ROW}<>""`;
    _addConditionalRule(sheet, formula, M4_PORTAL_CONSTANTS.COLORS.EXECUTIONER_BG, true);
  }

  // 2. 🟠 SOFT REJECTION HIGHLIGHT (CONFIRMED_QTY = 0)
  const confirmedQtyIdx = zoneB_Headers.findIndex(h => h.name === 'CONFIRMED_QTY');
  if (confirmedQtyIdx !== -1) {
    const absCol = zoneB_Start + confirmedQtyIdx;
    const colLetter = _colIndexToLetter(absCol);
    // Formula: Value is 0 AND not blank
    const formula = `=AND($${colLetter}${M4_PORTAL_CONSTANTS.DATA_START_ROW}=0, $${colLetter}${M4_PORTAL_CONSTANTS.DATA_START_ROW}<>"")`;
    _addConditionalRule(sheet, formula, M4_PORTAL_CONSTANTS.COLORS.WARNING_BG, false);
  }

  // 3. 📅 HYBRID DATE PICKER (Allow Copy-Paste)
  zoneB_Headers.forEach((h, i) => {
    if (h.name.toUpperCase().includes('DATE') || h.name.toUpperCase().includes('ETA')) {
      const absCol = zoneB_Start + i;
      const ruleDate = SpreadsheetApp.newDataValidation()
        .requireDate()
        .setAllowInvalid(true) // <--- CRITICAL: Allows Paste while keeping Calendar UI
        .build();
      
      const range = sheet.getRange(M4_PORTAL_CONSTANTS.DATA_START_ROW, absCol, maxRows, 1);
      range.setDataValidation(ruleDate);
      range.setNumberFormat(M4_PORTAL_CONSTANTS.FMT_DATE);
    }
  });
}

/* =========================================================================
 * 🛠️ UTILITIES
 * ========================================================================= */

function _renderHeaderCell(sheet, colIndex, colDef, bg, color) {
  const range = sheet.getRange(M4_PORTAL_CONSTANTS.HEADER_ROW, colIndex);
  range.setValue(colDef.name)
       .setBackground(bg)
       .setFontColor(color)
       .setFontWeight("bold")
       .setBorder(true, true, true, true, null, null);
  sheet.setColumnWidth(colIndex, colDef.width);
  _applyDateFormatIfApplicable(sheet, colIndex, colDef.name);
}

function _buildDashboard(sheet) {
  // Title Row
  sheet.getRange("A1:H1").merge()
       .setValue("LOGISTICS CONTROL TOWER (M4)")
       .setFontSize(14).setFontWeight("bold")
       .setBackground('#434343').setFontColor('#ffffff')
       .setHorizontalAlignment('left').setVerticalAlignment('middle');

  // Metadata Cells
  const labelStyle = { weight: "bold", color: M4_PORTAL_CONSTANTS.COLORS.DASHBOARD_LABEL, align: "right" };
  
  sheet.getRange("A2").setValue("Session Owner:").setFontWeight(labelStyle.weight).setFontColor(labelStyle.color).setHorizontalAlignment(labelStyle.align);
  sheet.getRange("B2").setValue("[WAITING FOR SESSION]").setFontWeight("bold").setFontColor("blue"); 
  
  sheet.getRange("A3").setValue("Last Updated:").setFontWeight(labelStyle.weight).setFontColor(labelStyle.color).setHorizontalAlignment(labelStyle.align);
  sheet.getRange("B3").setValue("[Timestamp]").setFontStyle("italic");

  sheet.getRange("C2").setValue("Feedback Batch ID:").setFontWeight(labelStyle.weight).setFontColor(labelStyle.color).setHorizontalAlignment(labelStyle.align);
  sheet.getRange("D2").setValue("Pending...").setFontFamily("monospace");

  // Instructions
  sheet.getRange("A4:H4").merge()
       .setValue("⚠️ INSTRUCTIONS: Verify 'Supplier Name'. Select 'Closure Reason' to cancel. Enter '0' Qty for Soft Rejection (Orange).")
       .setFontColor("red").setFontStyle("italic").setBackground(M4_PORTAL_CONSTANTS.COLORS.DASHBOARD_BG);
  
  sheet.getRange("A2:D3").setBorder(true, true, true, true, true, true);
}

function _buildPillar(sheet, colIndex, name) {
  sheet.getRange(M4_PORTAL_CONSTANTS.HEADER_ROW, colIndex)
       .setValue(name).setBackground(M4_PORTAL_CONSTANTS.COLORS.PILLAR_BG)
       .setFontColor(M4_PORTAL_CONSTANTS.COLORS.PILLAR_TEXT).setFontWeight("bold").setHorizontalAlignment("center");
  sheet.getRange(M4_PORTAL_CONSTANTS.DATA_START_ROW, colIndex, 1000, 1)
       .setBackground(M4_PORTAL_CONSTANTS.COLORS.PILLAR_BG);
  sheet.setColumnWidth(colIndex, 20);
}

function _applyDateFormatIfApplicable(sheet, colIndex, colName) {
  const upper = colName.toUpperCase();
  const dateColumns = ['AGREED_DELIVERY_DATE', 'CURRENT_ETA', 'ACTUAL_ARRIVAL_DATE', 'FINAL_REQUESTED_DELIVERY_DATE'];
  if (dateColumns.some(dc => upper.includes(dc)) || upper.includes('DATE') || upper.includes('ETA')) {
    sheet.getRange(M4_PORTAL_CONSTANTS.DATA_START_ROW, colIndex, 1000, 1)
         .setNumberFormat(M4_PORTAL_CONSTANTS.FMT_DATE);
  }
}

function _addConditionalRule(sheet, formula, bg, strike) {
  const rangeAll = sheet.getRange(M4_PORTAL_CONSTANTS.DATA_START_ROW, 1, 1000, sheet.getLastColumn());
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

function _colIndexToLetter(col) {
  let temp, letter = '';
  while (col > 0) {
    temp = (col - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    col = (col - temp - 1) / 26;
  }
  return letter;
}

function _protectSheetStrict(sheet, unlockStartCol, unlockEndCol) {
  const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  protections.forEach(p => p.remove());
  const protection = sheet.protect().setDescription('Protected Logistics Portal');
  const unlockedRange = sheet.getRange(M4_PORTAL_CONSTANTS.DATA_START_ROW, unlockStartCol, 
    sheet.getMaxRows() - M4_PORTAL_CONSTANTS.DATA_START_ROW + 1, (unlockEndCol - unlockStartCol + 1));
  protection.removeEditors(protection.getEditors());
  protection.addEditor(Session.getActiveUser()); 
  protection.setUnprotectedRanges([unlockedRange]);
}

/**
 * 🔓 PUBLIC ACCESSOR for Controller
 */
function protectSessionSheet(sheet) {
  const headers = sheet.getRange(M4_PORTAL_CONSTANTS.HEADER_ROW, 1, 1, sheet.getLastColumn()).getValues()[0];
  const startIdx = headers.indexOf(M4_PORTAL_CONSTANTS.PILLAR_START);
  const endIdx = headers.indexOf(M4_PORTAL_CONSTANTS.PILLAR_END);
  if (startIdx !== -1 && endIdx !== -1) {
    _protectSheetStrict(sheet, startIdx + 2, endIdx); 
  }
}