/* -------------------------------------------------------------------------
 * FILE: ISC_Module_M3/M3_PO_Issuance_SheetBuilder.gs
 * DESCRIPTION: PO Issuance Control Tower (Template Builder)
 * VERSION: 7.1 (Stability Fix - Removed Invalid API Call)
 * ------------------------------------------------------------------------- */

const M3_ISSUANCE_CONSTANTS = {
  // 🔒 The Master Template (Hidden/Protected)
  TEMPLATE_NAME: 'M3_PO_Issuance_Template',
  
  // Layout Dimensions
  TITLE_ROW: 1,
  HEADER_ROW: 8, 
  DATA_START_ROW: 9,

  // 🎨 Styling
  COLOR_ZONE_A: '#b6d7a8', // 🟢 Green (Context/System - PO_Header)
  COLOR_ZONE_B: '#9fc5e8', // 🔵 Blue (Action/User - Issue Select)
  
  COLOR_PILLAR: '#000000',      // ⚫ Black Separator
  COLOR_TEXT_PILLAR: '#ffffff', // ⚪ White Text
  
  // 📅 Formats
  FMT_DATE: 'dd-MMM-yyyy',
  FMT_TIMESTAMP: 'yyyy-mm-dd hh:mm:ss',
  FMT_CURRENCY: '#,##0 "₫"', // 🇻🇳 VND
  FMT_TEXT: '@'
};

/**
 * 🚀 MAIN FUNCTION: Builds the "Control Tower" Master Template
 * Run this once to generate the sheet that Sessions will clone.
 */
function buildIssuanceTemplate() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(M3_ISSUANCE_CONSTANTS.TEMPLATE_NAME);

  // 1. Reset or Create
  if (sheet) {
    sheet.clear(); 
    // 🛑 FIXED: Removed 'sheet.clearFormatting()' (Invalid API call). 
    // sheet.clear() already removes all content and formatting.
    
    sheet.getDataRange().removeCheckboxes();
    sheet.getDataRange().clearDataValidations();
  } else {
    sheet = ss.insertSheet(M3_ISSUANCE_CONSTANTS.TEMPLATE_NAME);
  }

  // 2. Fetch Schema (1:1 MATCH with Config_Schema PO_Header)
  const schemaMap = {
    // ZONE A: All PO_Header Columns (14 Columns)
    zoneA: [
      { header: 'PO_DOCUMENT_ID', width: 220 }, // Widened for Hover visibility
      { header: 'CONSOLIDATION_BATCH_ID', width: 140 },
      { header: 'SUPPLIER_ID', width: 100 },
      { header: 'SUPPLIER_NAME', width: 200 },
      { header: 'PO_NUMBER_REF', width: 120 },
      { header: 'ORDER_DATE', width: 100, format: M3_ISSUANCE_CONSTANTS.FMT_DATE },
      { header: 'TOTAL_AMOUNT', width: 120, format: M3_ISSUANCE_CONSTANTS.FMT_CURRENCY },
      { header: 'LINE_COUNT', width: 80 },
      { header: 'PO_DUE_DATE', width: 100, format: M3_ISSUANCE_CONSTANTS.FMT_DATE },
      { header: 'PO_STATUS', width: 100 },
      { header: 'FILELINK', width: 150 },
      { header: 'CREATED_BY', width: 150 },
      { header: 'CREATED_AT', width: 150, format: M3_ISSUANCE_CONSTANTS.FMT_TIMESTAMP },
      { header: 'ISSUED_AT', width: 150, format: M3_ISSUANCE_CONSTANTS.FMT_TIMESTAMP }
    ],
    // ZONE B: Input (Action)
    zoneB: [
      { header: 'ISSUE_SELECT', width: 100 }
    ]
  };

  // 3. Build Dashboard (Rows 1-7)
  _constructDashboard(sheet);

  // 4. Build Grid (Rows 8+)
  _constructHeaders(sheet, schemaMap);

  // 5. Final Protection
  _protectTemplate(sheet);

  Logger.log("✅ M3 PO Issuance Template (V7.1 - Clean) built successfully.");
}

/**
 * 🏗️ SECTION 1: DASHBOARD
 */
function _constructDashboard(sheet) {
  // Title
  sheet.getRange("A1").setValue("📝 PO ISSUANCE CONTROL TOWER")
       .setFontSize(16).setFontWeight("bold");
  sheet.getRange("A2").setValue("Role: Procurement Manager / Lead")
       .setFontStyle("italic").setFontColor("gray");

  // Dashboard Info Box
  sheet.getRange("B4").setValue("Session Owner:");
  sheet.getRange("C4").setValue("=USEREMAIL()") // Dynamic Formula
       .setFontWeight("bold");

  sheet.getRange("B5").setValue("Currency:");
  sheet.getRange("C5").setValue("VND (₫)");

  // Updated Instructions for Cell Note Logic
  sheet.getRange("E4").setValue("Instructions:");
  sheet.getRange("E5").setValue("1. Hover over 'PO_DOCUMENT_ID' to view Line Items.");
  sheet.getRange("E6").setValue("2. Check 'ISSUE_SELECT' for POs you want to finalize.");
  sheet.getRange("E7").setValue("3. Use Menu > Issue Selected POs to generate files.");
}

/**
 * 🎨 SECTION 2: HEADERS & ZONES (With Blackout Pillars)
 */
function _constructHeaders(sheet, map) {
  let colIndex = 1;

  // --- 🟢 Zone A: Full DB Schema ---
  map.zoneA.forEach(col => {
    const range = sheet.getRange(M3_ISSUANCE_CONSTANTS.HEADER_ROW, colIndex);
    range.setValue(col.header)
         .setBackground(M3_ISSUANCE_CONSTANTS.COLOR_ZONE_A)
         .setFontWeight("bold")
         .setBorder(true, true, true, true, null, null);
    
    sheet.setColumnWidth(colIndex, col.width);

    // Apply Format to Data Rows
    if (col.format) {
      sheet.getRange(M3_ISSUANCE_CONSTANTS.DATA_START_ROW, colIndex, 900)
           .setNumberFormat(col.format);
    }
    colIndex++;
  });

  // --- ⚫ Pillar 1: RAW_START ---
  _buildPillar(sheet, colIndex, "RAW_START");
  colIndex++;

  // --- 🔵 Zone B: Action ---
  map.zoneB.forEach(col => {
    const range = sheet.getRange(M3_ISSUANCE_CONSTANTS.HEADER_ROW, colIndex);
    range.setValue(col.header)
         .setBackground(M3_ISSUANCE_CONSTANTS.COLOR_ZONE_B)
         .setFontWeight("bold")
         .setBorder(true, true, true, true, null, null);
    
    sheet.setColumnWidth(colIndex, col.width);
    colIndex++;
  });

  // --- ⚫ Pillar 2: RAW_END (Closes the table) ---
  _buildPillar(sheet, colIndex, "RAW_END");
  colIndex++;

  // Freeze the header
  sheet.setFrozenRows(M3_ISSUANCE_CONSTANTS.HEADER_ROW);
  sheet.setFrozenColumns(4); 
}

/**
 * 🧱 HELPER: Builds a Blackout Pillar Column
 */
function _buildPillar(sheet, colIndex, name) {
  // Header
  sheet.getRange(M3_ISSUANCE_CONSTANTS.HEADER_ROW, colIndex)
       .setValue(name)
       .setBackground(M3_ISSUANCE_CONSTANTS.COLOR_PILLAR)
       .setFontColor(M3_ISSUANCE_CONSTANTS.COLOR_TEXT_PILLAR)
       .setFontWeight("bold")
       .setHorizontalAlignment("center");

  // Body (Blackout all the way down)
  sheet.getRange(M3_ISSUANCE_CONSTANTS.DATA_START_ROW, colIndex, sheet.getMaxRows() - M3_ISSUANCE_CONSTANTS.DATA_START_ROW + 1)
       .setBackground(M3_ISSUANCE_CONSTANTS.COLOR_PILLAR);
  
  sheet.setColumnWidth(colIndex, 30); // Narrow width for pillar
}

/**
 * 🛡️ SECTION 3: TEMPLATE PROTECTION
 */
function _protectTemplate(sheet) {
  const protection = sheet.protect().setDescription('System Template Protection');
  if (sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).length > 1) {
    protection.remove(); 
  }
  
  const me = Session.getEffectiveUser();
  protection.addEditor(me);
}