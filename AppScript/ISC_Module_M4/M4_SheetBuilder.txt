/**
 * 🏗️ MODULE 4 SHEET BUILDER (Inventory Interface)
 * Version: 4.5 (SCHEMA ALIGNED EDITION)
 * 
 * UPDATES V4.5:
 * - Added EXTRACTED_SNAPSHOT_DATE to Zone A for schema alignment with Config_Schema.txt
 * - Maintained backward compatibility with existing workflows
 * - Zone A now matches BigQuery Stock_Count_Upload schema exactly
 */

const M4_SHEET_CONFIG = {
  SHEET_NAME: 'Stock_Count_Upload',
  
  // 🎨 VISUALS
  COLORS: {
    ZONE_A: '#d9ead3',     // Green (System)
    ZONE_B: '#cfe2f3',     // Blue (User Input)
    ZONE_C: '#fff2cc',     // Yellow (Validation/Master)
    PILLAR: '#000000',     // Black Separator
    PILLAR_TEXT: '#ffffff',
    FORMULA_ROW: '#ffff00', // 🟡 Yellow Background for Row 2
    HEADER_TEXT: '#000000'
  },
  
  // 📐 LAYOUT
  HEADER_ROW: 1,
  FORMULA_ROW: 2,
  DATA_START_ROW: 3 // Data pasting starts here
};

const M4_SheetBuilder = {

  buildStockCountSheet: function() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(M4_SHEET_CONFIG.SHEET_NAME);
    
    // 1. RESET SHEET
    if (sheet) ss.deleteSheet(sheet);
    sheet = ss.insertSheet(M4_SHEET_CONFIG.SHEET_NAME);
    sheet.setTabColor('#ea9999'); // Module 4 Red

    // 2. DEFINE STRUCTURE (The Blueprint)
    // ---------------------------------------------------------
    
    // ZONE A: System Columns (Calculated/Mapped)
    // 📅 V4.5: Added EXTRACTED_SNAPSHOT_DATE for schema alignment
    const zoneA_Headers = [
      'UPLOAD_ID', 
      'UPLOAD_BATCH_ID', 
      'WAREHOUSE_ID', 
      'RAW_BOM_UPDATE', 
      'BOM_VIETNAMESE_DESCRIPTION', 
      'INPUT_UNIT_CODE', 
      'RAW_QTY', 
      'EXTRACTED_SNAPSHOT_DATE',  // V4.5 NEW - Aligns with Config_Schema.txt
      'UPLOADED_BY', 
      'UPLOADED_AT'
    ];

    // ZONE B: Input Columns (The "Paste Zone")
    const zoneB_Headers = [
      'WAREHOUSE_ID', 
      'RAW_BOM_UPDATE', 
      'BOM_VIETNAMESE_DESCRIPTION', 
      'INPUT_UNIT_CODE', 
      'RAW_QTY'
    ];

    // ZONE C: Helper/Validation Columns
    const zoneC_Headers = [
      'SYS_BOM_UNIT' // Checks Master Data for the correct unit
    ];

    // 3. BUILDER LOOP (Dynamic Rendering)
    // ---------------------------------------------------------
    let colIndex = 1;

    // --- BUILD ZONE A ---
    _buildZone(sheet, colIndex, zoneA_Headers, M4_SHEET_CONFIG.COLORS.ZONE_A);
    const zoneA_Start = colIndex;
    const zoneA_Width = zoneA_Headers.length;
    colIndex += zoneA_Width;

    // --- PILLAR 1: RAW_START ---
    _buildPillar(sheet, colIndex, "RAW_START");
    colIndex++;

    // --- BUILD ZONE B ---
    _buildZone(sheet, colIndex, zoneB_Headers, M4_SHEET_CONFIG.COLORS.ZONE_B);
    const zoneB_Start = colIndex; 
    const zoneB_Width = zoneB_Headers.length;
    colIndex += zoneB_Width;

    // --- PILLAR 2: RAW_END ---
    _buildPillar(sheet, colIndex, "RAW_END");
    colIndex++;

    // --- BUILD ZONE C ---
    _buildZone(sheet, colIndex, zoneC_Headers, M4_SHEET_CONFIG.COLORS.ZONE_C);
    const zoneC_Start = colIndex;
    colIndex += zoneC_Headers.length;

    // 4. INJECT LOGIC (Row 2 Engine)
    // ---------------------------------------------------------
    // Helper: Get Column Letter
    const getColLet = (idx) => sheet.getRange(1, idx).getA1Notation().replace(/\d+/g, '');

    // Map Zone B Coordinates (Source)
    const col_Wh    = getColLet(zoneB_Start);     
    const col_Bom   = getColLet(zoneB_Start + 1); 
    const col_Desc  = getColLet(zoneB_Start + 2); 
    const col_Unit  = getColLet(zoneB_Start + 3); 
    const col_Qty   = getColLet(zoneB_Start + 4); 

    // Map Zone A Column Indices (for formulas)
    // Index in zoneA_Headers: 0=UPLOAD_ID, 1=BATCH_ID, 2=WAREHOUSE, 3=BOM, 4=DESC, 5=UNIT, 6=QTY, 7=SNAPSHOT_DATE, 8=UPLOADED_BY, 9=UPLOADED_AT
    
    // A2: UPLOAD_ID
    // Note: This formula generates a visual ID in the sheet, but M4_Main.gs will override it
    // with an atomic session ID during actual upload. This is for display purposes only.
    const col_Batch_A = getColLet(zoneA_Start + 1); // B column
    sheet.getRange(2, zoneA_Start).setFormula(
      `=ARRAYFORMULA(IF(${col_Bom}2:${col_Bom}="", "", ${col_Batch_A}2:${col_Batch_A} & "_" & ${col_Wh}2:${col_Wh} & "_" & ${col_Bom}2:${col_Bom}))`
    );

    // B2: BATCH_ID
    // Note: This formula generates a day-based ID for display, but M4_Main.gs will override it
    // with an atomic session ID during actual upload. This is for display purposes only.
    sheet.getRange(2, zoneA_Start + 1).setFormula(
      `=ARRAYFORMULA(IF(${col_Bom}2:${col_Bom}="", "", "BATCH_" & TEXT(TODAY(), "YYYYMMDD")))`
    );

    // C2 - G2: Direct Mappings
    // C2: WAREHOUSE_ID
    sheet.getRange(2, zoneA_Start + 2).setFormula(`=ARRAYFORMULA(${col_Wh}2:${col_Wh})`); 
    
    // D2: RAW_BOM_UPDATE
    sheet.getRange(2, zoneA_Start + 3).setFormula(`=ARRAYFORMULA(${col_Bom}2:${col_Bom})`); 
    
    // E2: BOM_VIETNAMESE_DESCRIPTION
    sheet.getRange(2, zoneA_Start + 4).setFormula(`=ARRAYFORMULA(${col_Desc}2:${col_Desc})`); 
    
    // F2: INPUT_UNIT_CODE (UNIT CLEANER)
    const f_Unit = `=ARRAYFORMULA(IF(${col_Unit}2:${col_Unit}="", "", 
      IFS(
        REGEXMATCH(${col_Unit}2:${col_Unit}, "(?i)Gross"), "Gross",
        REGEXMATCH(${col_Unit}2:${col_Unit}, "(?i)Kg"), "Kg",
        REGEXMATCH(${col_Unit}2:${col_Unit}, "(?i)cuộn|roll"), "Cuộn",
        REGEXMATCH(${col_Unit}2:${col_Unit}, "(?i)lít"), "Lít",
        REGEXMATCH(${col_Unit}2:${col_Unit}, "(?i)đôi"), "Đôi",
        REGEXMATCH(${col_Unit}2:${col_Unit}, "(?i)quyển|cuốn"), "Quyển",
        REGEXMATCH(${col_Unit}2:${col_Unit}, "(?i)túi"), "Túi",
        REGEXMATCH(${col_Unit}2:${col_Unit}, "(?i)cục|viên"), "Viên",
        REGEXMATCH(${col_Unit}2:${col_Unit}, "(?i)cái|chiếc|miếng|thanh"), "Chiếc",
        TRUE, TRIM(REGEXREPLACE(${col_Unit}2:${col_Unit}, "[\\p{Han}\\d]", ""))
      )
    ))`;
    sheet.getRange(2, zoneA_Start + 5).setFormula(f_Unit);

    // G2: RAW_QTY
    sheet.getRange(2, zoneA_Start + 6).setFormula(`=ARRAYFORMULA(${col_Qty}2:${col_Qty})`); 

    // H2: EXTRACTED_SNAPSHOT_DATE (V4.5 NEW)
    // This displays today's date in the sheet. M4_Main.gs may override this during upload.
    sheet.getRange(2, zoneA_Start + 7).setFormula(
      `=ARRAYFORMULA(IF(${col_Bom}2:${col_Bom}="", "", TODAY()))`
    );
    sheet.getRange(2, zoneA_Start + 7, sheet.getMaxRows()).setNumberFormat("yyyy-mm-dd");

    // I2: UPLOADED_BY (Blank - will be filled by script)
    // J2: UPLOADED_AT (Blank - will be filled by script)
    // These are intentionally left blank as they are script-generated

    // ZONE C: SYS_BOM_UNIT (Master Data Check)
    sheet.getRange(2, zoneC_Start).setFormula(
      `=ARRAYFORMULA(IF(${col_Bom}2:${col_Bom}="",, XLOOKUP(${col_Bom}2:${col_Bom}, Ref_BOM_Master!A:A, Ref_BOM_Master!H:H, "")))`
    );

    // 5. FINISHING TOUCHES
    // ---------------------------------------------------------
    
    // A. Highlight Row 2 (The Formula Engine)
    sheet.getRange(M4_SHEET_CONFIG.FORMULA_ROW, 1, 1, colIndex - 1)
         .setBackground(M4_SHEET_CONFIG.COLORS.FORMULA_ROW)
         .setFontWeight('bold');

    // B. Freeze Row 2 Only
    sheet.setFrozenRows(M4_SHEET_CONFIG.FORMULA_ROW);

    // C. Protect System Areas
    const protection = sheet.protect().setDescription('System Columns Protected');
    
    // Unprotect Zone B (Row 3 onwards) - The Input Area
    const inputRange = sheet.getRange(
      M4_SHEET_CONFIG.DATA_START_ROW, 
      zoneB_Start, 
      sheet.getMaxRows() - M4_SHEET_CONFIG.DATA_START_ROW + 1, 
      zoneB_Width
    );
    protection.setUnprotectedRanges([inputRange]);

    // D. Auto-Fit Zone B
    sheet.autoResizeColumns(zoneB_Start, zoneB_Width);
    
    console.log(`[M4_SheetBuilder] Stock_Count_Upload sheet rebuilt (V4.5 - Schema Aligned)`);
  }
};

/**
 * 🧱 HELPER: Build a Header Zone
 */
function _buildZone(sheet, startCol, headers, color) {
  if (!headers || headers.length === 0) return;
  const range = sheet.getRange(M4_SHEET_CONFIG.HEADER_ROW, startCol, 1, headers.length);
  range.setValues([headers]);
  range.setBackground(color);
  range.setFontWeight('bold');
  range.setHorizontalAlignment('center');
  range.setBorder(true, true, true, true, true, true);
}

/**
 * 🧱 HELPER: Build a Black Pillar
 */
function _buildPillar(sheet, colIndex, title) {
  const header = sheet.getRange(M4_SHEET_CONFIG.HEADER_ROW, colIndex);
  header.setValue(title);
  header.setBackground(M4_SHEET_CONFIG.COLORS.PILLAR);
  header.setFontColor(M4_SHEET_CONFIG.COLORS.PILLAR_TEXT);
  header.setFontWeight('bold');
  header.setHorizontalAlignment('center');

  // Paint the pillar all the way down
  sheet.getRange(2, colIndex, sheet.getMaxRows() - 1, 1)
       .setBackground(M4_SHEET_CONFIG.COLORS.PILLAR);
  
  // Set narrow width
  sheet.setColumnWidth(colIndex, 25);
}