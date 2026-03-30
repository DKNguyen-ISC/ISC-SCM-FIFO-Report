/* -------------------------------------------------------------------------
 * FILE: ISC_Module_M3/M3_Consolidation_SheetBuilder.gs
 * DESCRIPTION: Smart Cart v3.1 (Template Builder - Refined Dashboard & Formats)
 * ------------------------------------------------------------------------- */

const M3_TEMPLATE_CONSTANTS = {
  // 🔒 The Master Template (Hidden/Protected)
  TEMPLATE_NAME: 'M3_Shopping_Cart_Template',
  
  // Layout Dimensions (Fixed)
  TITLE_ROW: 1,
  HEADER_ROW: 8, 
  DATA_START_ROW: 9,

  // 🏛️ Pillars
  PILLAR_START: 'RAW_START',
  PILLAR_END:   'RAW_END',

  // 🎨 Styling
  COLOR_ZONE_A: '#b6d7a8', // 🟢 Green (Context/System)
  COLOR_ZONE_B: '#9fc5e8', // 🔵 Blue (Action/User)
  COLOR_ZONE_C: '#ffe599', // 🟡 Yellow (Helper/Validation)
  
  COLOR_PILLAR: '#000000', // ⚫ Black
  COLOR_TEXT_PILLAR: '#ffffff', // ⚪ White Text
  
  // 📅 Date Formats
  DATE_FMT_GRID: 'dd-MMM-yyyy',
  DATE_FMT_TIMESTAMP: 'dddd, dd-mmm-yyyy "at" h:mm:ss am/pm'
};

/**
 * 🛠️ MAIN BUILDER: Template Factory
 * Creates the hidden "Master Template" used for cloning.
 */
function buildConsolidationTemplate() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(M3_TEMPLATE_CONSTANTS.TEMPLATE_NAME);

  if (sheet) {
    const ui = SpreadsheetApp.getUi();
    const result = ui.alert(
      "Reset Master Template?", 
      "This will rebuild the 'M3_Shopping_Cart_Template'.\nEnsure no users are currently cloning from it.\n\nProceed?", 
      ui.ButtonSet.YES_NO
    );
    if (result !== ui.Button.YES) return;
    
    // Remove protection to allow clear
    const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    protections.forEach(p => p.remove());
    sheet.clear();
  } else {
    sheet = ss.insertSheet(M3_TEMPLATE_CONSTANTS.TEMPLATE_NAME);
  }

  // 1. Build the Dashboard (Shifted to Col C)
  _setupTemplateDashboard(sheet);
  
  // 2. Build the Grid Structure (Headers at Row 8)
  _setupTemplateGrid(sheet);
  
  // 3. Lock It Down (Template is immutable)
  _protectTemplate(sheet);
  
  ss.toast("Master Template v3.1 Built & Locked", "System");
}

/**
 * 🏗️ SECTION 1: SESSION DASHBOARD (Rows 1-7)
 * Placeholders for the Session Logic.
 */
function _setupTemplateDashboard(sheet) {
  // Title
  sheet.getRange("A1:H1").merge()
       .setValue("🛒 GLOBAL SHOPPING CART (Master Template)")
       .setFontWeight("bold").setFontSize(14)
       .setBackground("#666666").setFontColor("white")
       .setHorizontalAlignment("center");

  // Labels (Shifted to Column C)
  // Removed Batch Mode Row.
  const labels = [
    ["👤 SESSION OWNER:", ""],       // Row 2 (C2)
    ["🕒 LOADED AT:", ""],           // Row 3 (C3)
    ["📅 PO DATE OVERRIDE:", ""]     // Row 4 (C4)
  ];
  
  // Write Labels to C2:D4
  sheet.getRange("C2:D4").setValues(labels);
  sheet.getRange("C2:C4").setFontWeight("bold").setHorizontalAlignment("right");
  
  // Input Placeholders (Column D)
  
  // D2: PIC Name (Script will fill this)
  sheet.getRange("D2").setBackground("#eeeeee").setFontStyle("italic").setValue("[Waiting for Clone...]");
  
  // D3: Timestamp (Script will fill this)
  // Apply Verbose Format: "Friday, 26-Dec-2025 at 10:46:06 PM"
  sheet.getRange("D3").setBackground("#eeeeee")
       .setNumberFormat(M3_TEMPLATE_CONSTANTS.DATE_FMT_TIMESTAMP);
  
  // D4: Date Override (Input)
  sheet.getRange("D4").setNumberFormat(M3_TEMPLATE_CONSTANTS.DATE_FMT_GRID)
       .setBackground("#E6B8AF")
       .setNote("Optional: Overrides Contract Date for all items in the PO.");
  
  // Instructions (Row 7)
  sheet.getRange("A7").setValue("ℹ️ INSTRUCTIONS: Use the Filter arrows on Row 8 to sort/group your workload. Check 'INCLUDE_SELECT' to consolidate.")
       .setFontStyle("italic").setFontColor("#666666");
}

/**
 * 🏗️ SECTION 2: GRID CONSTRUCTION (Row 8 Headers)
 */
function _setupTemplateGrid(sheet) {
  // --- A. Fetch Schema ---
  const coreConfig = ISC_SCM_Core_Lib.getCoreConfig();
  const schemaObj = coreConfig.schemas['PR_Final']; 
  if (!schemaObj) throw new Error("Schema 'PR_Final' not found.");

  const zoneA_Headers = schemaObj.schema.map(f => f.name);

  // --- B. Define Zones ---
  const pillarStart = [M3_TEMPLATE_CONSTANTS.PILLAR_START];
  
  // Zone B: Only Selection Checkbox
  const zoneB_Headers = ['INCLUDE_SELECT'];
  
  const pillarEnd = [M3_TEMPLATE_CONSTANTS.PILLAR_END];
  
  // Zone C: Validation Only (Dropped PO_PREVIEW_REF)
  const zoneC_Headers = ['VALIDATION_STATUS'];

  const allHeaders = [...zoneA_Headers, ...pillarStart, ...zoneB_Headers, ...pillarEnd, ...zoneC_Headers];

  // --- C. Write Headers (Row 8) ---
  const headerRange = sheet.getRange(M3_TEMPLATE_CONSTANTS.HEADER_ROW, 1, 1, allHeaders.length);
  headerRange.setValues([allHeaders])
             .setFontWeight("bold")
             .setBorder(true, true, true, true, true, true)
             .setVerticalAlignment("middle")
             .setHorizontalAlignment("center");

  // --- D. Styling & Formatting ---
  let colIndex = 1;

  // 🟢 Zone A: Green
  const rangeA = sheet.getRange(M3_TEMPLATE_CONSTANTS.HEADER_ROW, colIndex, 1, zoneA_Headers.length);
  rangeA.setBackground(M3_TEMPLATE_CONSTANTS.COLOR_ZONE_A);
  
  // Date Formatting (Whole Column) -> dd-MMM-yyyy
  schemaObj.schema.forEach((field, i) => {
    if (field.name.includes('DATE') || field.type === 'DATE' || field.type === 'TIMESTAMP') {
       sheet.getRange(M3_TEMPLATE_CONSTANTS.DATA_START_ROW, colIndex + i, sheet.getMaxRows() - M3_TEMPLATE_CONSTANTS.DATA_START_ROW, 1)
            .setNumberFormat(M3_TEMPLATE_CONSTANTS.DATE_FMT_GRID);
    }
  });
  colIndex += zoneA_Headers.length;

  // ⚫ Pillar 1 (White Text)
  const p1 = sheet.getRange(M3_TEMPLATE_CONSTANTS.HEADER_ROW, colIndex, 1, 1);
  p1.setBackground(M3_TEMPLATE_CONSTANTS.COLOR_PILLAR).setFontColor(M3_TEMPLATE_CONSTANTS.COLOR_TEXT_PILLAR);
  sheet.setColumnWidth(colIndex, 30);
  sheet.getRange(M3_TEMPLATE_CONSTANTS.DATA_START_ROW, colIndex, sheet.getMaxRows(), 1)
       .setBackground(M3_TEMPLATE_CONSTANTS.COLOR_PILLAR);
  colIndex++;

  // 🔵 Zone B: Blue
  const rangeB = sheet.getRange(M3_TEMPLATE_CONSTANTS.HEADER_ROW, colIndex, 1, zoneB_Headers.length);
  rangeB.setBackground(M3_TEMPLATE_CONSTANTS.COLOR_ZONE_B);
  // Note: No Checkboxes here. Clone Logic will add them dynamically.
  colIndex += zoneB_Headers.length;

  // ⚫ Pillar 2 (White Text)
  const p2 = sheet.getRange(M3_TEMPLATE_CONSTANTS.HEADER_ROW, colIndex, 1, 1);
  p2.setBackground(M3_TEMPLATE_CONSTANTS.COLOR_PILLAR).setFontColor(M3_TEMPLATE_CONSTANTS.COLOR_TEXT_PILLAR);
  sheet.setColumnWidth(colIndex, 30);
  sheet.getRange(M3_TEMPLATE_CONSTANTS.DATA_START_ROW, colIndex, sheet.getMaxRows(), 1)
       .setBackground(M3_TEMPLATE_CONSTANTS.COLOR_PILLAR);
  colIndex++;

  // 🟡 Zone C: Yellow
  const rangeC = sheet.getRange(M3_TEMPLATE_CONSTANTS.HEADER_ROW, colIndex, 1, zoneC_Headers.length);
  rangeC.setBackground(M3_TEMPLATE_CONSTANTS.COLOR_ZONE_C);
  
  // 🌟 Highlight the Formula Cell (Row 9) for Validation Status
  // This indicates to the Logic Controller where to inject the MAP formula
  sheet.getRange(M3_TEMPLATE_CONSTANTS.DATA_START_ROW, colIndex, 1, 1)
       .setBackground(M3_TEMPLATE_CONSTANTS.COLOR_ZONE_C)
       .setNote("System Formula Area");

  // Freeze Row 8
  sheet.setFrozenRows(M3_TEMPLATE_CONSTANTS.HEADER_ROW);
}

/**
 * 🛡️ SECTION 3: TEMPLATE PROTECTION
 * Locks the Master Template completely.
 */
function _protectTemplate(sheet) {
  const protection = sheet.protect().setDescription("🔒 Master Template (Do Not Edit)");
  protection.setWarningOnly(false); // Hard Lock
  
  // Ensure only the Owner (Script/Me) can edit
  const me = Session.getEffectiveUser();
  protection.addEditor(me);
  
  // Remove all other editors (if applicable)
  const editors = protection.getEditors();
  protection.removeEditors(editors.filter(e => e.getEmail() !== me.getEmail()));
}