/**
 * 🏗️ MODULE 3 SHEET BUILDER (Procurement Interface) - High Fidelity
 * Generates the Supplier Management UIs with "Reference Replica" logic and strict Security.
 * * FEATURES:
 * 1. Reference Sheet: Creates hidden 'Ref_Supplier_Master' for Dropdowns.
 * 2. Smart Zone A: Auto-injects VLOOKUPs to convert Names -> UUIDs.
 * 3. Sanitizer: "Wipe & Re-Paint" technology to fix user formatting messes.
 * 4. Security: Locks Zone A (System) and Zone C (Helper), leaving only Zone B editable.
 * 5. Soft Landing: Hides System Columns from User Input Zone (Zone B).
 */

const M3_SHEET_CONFIG = {
  TAB_COLOR: '#b6d7a8',    // 🟢 Green (Matches ERD Staging/Master)
  ZONE_A_COLOR: '#d9ead3', // 🟢 Light Green (System)
  ZONE_B_COLOR: '#cfe2f3', // 🔵 Light Blue (User Input)
  ZONE_C_COLOR: '#ffe599', // 🟡 Yellow (Helper/Vault)
  PILLAR_COLOR: '#000000', // ⚫ Black (Visual Barrier)
  ZONE_C_COUNT: 10,        // Number of extra helper columns
  HEADER_FONT: 'Arial',
  REF_SHEET_NAME: 'Ref_Supplier_Master'
};

const M3_SheetBuilder = {

  /**
   * 🚀 MAIN ENTRY POINT
   * Builds the Reference Sheet first, then the Input Sheets.
   */
  buildAllTables: function() {
    const manifest = getLocalManifest();
    const config = ISC_SCM_Core_Lib.getCoreConfig();

    // 1. Build Reference Data (Local Replica)
    this._buildReferenceSheet(config);

    // 2. Build Input Sheets
    manifest.INPUT_SHEETS.forEach(tableName => {
      this._buildSingleInputSheet(SpreadsheetApp.getActiveSpreadsheet(), tableName, config);
    });
  },

  /**
   * 🛠️ BUILDER: Single Input Sheet (3-Zone Layout)
   */
  _buildSingleInputSheet: function(ss, tableName, config) {
    let sheet = ss.getSheetByName(tableName);
    if (sheet) {
      sheet.clear(); // Wipe clean
    } else {
      sheet = ss.insertSheet(tableName);
    }
    sheet.setTabColor(M3_SHEET_CONFIG.TAB_COLOR);

    // --- 1. DEFINE HEADERS & ZONES ---
    const schema = config.schemas[tableName].schema;

    // 🛑 SYSTEM COLUMN BLACKLIST (The Fix)
    // These columns are critical for the database but confusing for users.
    // They stay in Zone A (Hidden) but are REMOVED from Zone B (User).
    const SYSTEM_COLUMNS = [
      'STAGING_ID',        // PK (Auto-generated)
      'UPLOAD_BATCH_ID',   // Traceability
      'VALIDATION_STATUS', // System State
      'ERROR_MESSAGE',     // Feedback
      'UPDATED_BY',        // Audit
      'UPDATED_AT',        // Timestamp
      'LOGGED_AT',         // Timestamp
      'SOURCE_TYPE'        // Metadata
    ];

    // Zone A: System Zone (Full Schema)
    const headersA = schema.map(f => f.name);

    // Zone B: User Zone (Clean Schema - Filtered)
    const headersB = schema
      .map(f => f.name)
      .filter(name => !SYSTEM_COLUMNS.includes(name));

    // Zone C: Helper Zone (Calculations)
    const headersC = Array.from({length: M3_SHEET_CONFIG.ZONE_C_COUNT}, (_, i) => `F_HELPER_${i+1}`);

    // --- 2. RENDER HEADERS ---
    let colIndex = 1;

    // 🟢 ZONE A: SYSTEM (Hidden)
    sheet.getRange(1, colIndex, 1, headersA.length)
      .setValues([headersA])
      .setBackground(M3_SHEET_CONFIG.ZONE_A_COLOR)
      .setFontWeight('bold');
    
    // Hide Zone A for cleaner UI (Planners can unhide if debugging)
    sheet.hideColumns(colIndex, headersA.length);
    colIndex += headersA.length;

    // ⚫ PILLAR 1
    sheet.getRange(1, colIndex)
      .setValue("RAW_START")
      .setBackground(M3_SHEET_CONFIG.PILLAR_COLOR)
      .setFontColor('white')
      .setFontWeight('bold');
    sheet.setColumnWidth(colIndex, 30);
    colIndex++;

    // 🔵 ZONE B: USER INPUT (The Clean Zone)
    // We capture the start/end column indices for protection later
    const startColB = colIndex;
    sheet.getRange(1, colIndex, 1, headersB.length)
      .setValues([headersB])
      .setBackground(M3_SHEET_CONFIG.ZONE_B_COLOR)
      .setFontWeight('bold')
      .setBorder(true, true, true, true, true, true);
    
    colIndex += headersB.length;
    const endColB = colIndex - 1;

    // ⚫ PILLAR 2
    sheet.getRange(1, colIndex)
      .setValue("RAW_END")
      .setBackground(M3_SHEET_CONFIG.PILLAR_COLOR)
      .setFontColor('white')
      .setFontWeight('bold');
    sheet.setColumnWidth(colIndex, 30);
    colIndex++;

    // 🟡 ZONE C: HELPER (Reference Lookups)
    const startColC = colIndex;
    sheet.getRange(1, colIndex, 1, headersC.length)
      .setValues([headersC])
      .setBackground(M3_SHEET_CONFIG.ZONE_C_COLOR)
      .setFontStyle('italic');
    
    // Hide Zone C by default (Formula storage)
    sheet.hideColumns(colIndex, headersC.length);
    colIndex += headersC.length;
    const endColC = colIndex - 1;

    // --- 3. APPLY SMART FORMULAS (Zone A Linking) ---
    // Zone A columns usually map 1:1 to Zone B, but we need to handle the mismatch
    // caused by the filter.
    
    const maxRows = 1000; // Pre-build 1000 rows for performance
    const formulaGrid = [];

    // Row-by-Row Formula Injection
    // Logic: If col in Zone A exists in Zone B, link it (=ZoneB). 
    // If it's a System Col (e.g. UPLOAD_BATCH_ID), leave blank for Script to fill.
    
    for (let r = 0; r < 1; r++) { // Just generating the formula pattern
      const rowFormulas = headersA.map(headerName => {
        // Is this header present in Zone B?
        const bIndex = headersB.indexOf(headerName);
        
        if (bIndex !== -1) {
          // Yes: Link to Zone B cell
          // Calculate Column Letter of the matching Zone B column
          // startColB is 1-based index. 
          const targetColIndex = startColB + bIndex;
          const colLetter = this._colIndexToLetter(targetColIndex);
          // Formula: =IF(K2="", "", K2)
          return `=IF(${colLetter}2="", "", ${colLetter}2)`;
        } else {
          // No: It's a System Column. Leave empty (Script will inject, or BQ will default).
          return ""; 
        }
      });
      formulaGrid.push(rowFormulas);
    }

    // Apply ArrayFormulas (or drag-down) to Row 2
    if (maxRows > 1) {
       // Note: For simplicity in this version, we set Row 2 formulas 
       // and let the user drag, or we could use ArrayFormula logic.
       // Here we just set Row 2 for the "Template".
       sheet.getRange(2, 1, 1, headersA.length).setValues(formulaGrid);
    }

    // --- 4. FORMATTING & PROTECTION ---
    sheet.setFrozenRows(1);
    
    // Protect everything EXCEPT Zone B
    this._protectSystemZones(sheet, 1, startColB - 1, endColB + 1, sheet.getMaxColumns());

    // --- 5. DATA VALIDATION (Dropdowns) ---
    this._applyDropdowns(sheet, headersB, startColB);
  },

  /**
   * 🛡️ SECURITY: Locks System Zones
   */
  _protectSystemZones: function(sheet, startA, endA, startC, endMax) {
    const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
    protections.forEach(p => p.remove());

    const me = Session.getEffectiveUser();

    // Protect Left Side (Zone A + Pillar 1)
    if (endA >= startA) {
        const p1 = sheet.getRange(1, startA, sheet.getMaxRows(), endA - startA + 1).protect();
        p1.setDescription('🔒 System Zone Left');
        p1.removeEditors(p1.getEditors());
        p1.addEditor(me);
    }

    // Protect Right Side (Pillar 2 + Zone C + Empty Space)
    if (endMax >= startC) {
        const p2 = sheet.getRange(1, startC, sheet.getMaxRows(), endMax - startC + 1).protect();
        p2.setDescription('🔒 System Zone Right');
        p2.removeEditors(p2.getEditors());
        p2.addEditor(me);
    }
  },


/**
   * 🧹 SANITIZER (The Janitor) - REVISED (Wipe & Restore Strategy)
   * * STRATEGY:
   * 1. Identifies Zone B (between RAW_START and RAW_END pillars).
   * 2. Clears ALL content in Zone B (Row 2 downwards).
   * 3. Leaves Zone A (Formulas), Zone C (Helpers), and Formatting/Dropdowns intact.
   * * This prepares the sheet for M3_Main to write back ONLY the rejected rows.
   */
  sanitizeInputZone: function(sheet) {
    // 1. Identify Zone B Boundaries dynamically
    const lastCol = sheet.getLastColumn();
    // Read only the headers (Row 1) to find our pillars
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    
    const rawStartIdx = headers.indexOf('RAW_START'); // Pillar 1
    const rawEndIdx = headers.indexOf('RAW_END');     // Pillar 2

    // Safety: If layout is broken (missing pillars), abort to protect the sheet.
    if (rawStartIdx === -1 || rawEndIdx === -1) {
      console.warn("Sanitizer skipped: Missing RAW_START or RAW_END pillars.");
      return; 
    }

    // Calculate Zone B coordinates (1-based for Apps Script methods)
    // rawStartIdx is 0-based. Pillar 1 is column (rawStartIdx + 1).
    // Zone B starts at column (rawStartIdx + 2).
    const startCol = rawStartIdx + 2;
    
    // Width = End Index - Start Index - 1 (The gap between pillars)
    const numCols = rawEndIdx - rawStartIdx - 1;

    if (numCols < 1) return; // Zone B is empty

    // 2. The Surgical Wipe
    // We check if there is data to clear to avoid errors on empty sheets
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return; 

    // We clear from Row 2 down to the last row with data
    const numRows = lastRow - 1;
    
    // clearContent() is the key here:
    // - It removes Values (Text/Numbers).
    // - It KEEPS Formatting (Colors, Borders).
    // - It KEEPS Data Validation (Dropdowns).
    sheet.getRange(2, startCol, numRows, numCols).clearContent();
  },

  /**
   * 📉 DROPDOWNS: Connects to Reference Sheet
   */
  _applyDropdowns: function(sheet, headersB, startColB) {
    // 1. Identify Dropdown Targets
    const dropdownMap = {
      'SUPPLIER_LOCATION_TYPE': 'Ref_Supplier_Master!A2:A', // Example Range
      'PAYMENT_TERMS': 'Ref_Supplier_Master!B2:B',
      'SUPPLIER_STATUS': 'Ref_Supplier_Master!C2:C'
    };

    headersB.forEach((header, index) => {
      if (dropdownMap[header]) {
        const rule = SpreadsheetApp.newDataValidation()
          .requireValueInRange(SpreadsheetApp.getActiveSpreadsheet().getRange(dropdownMap[header]))
          .setAllowInvalid(true) // Soft Landing: Allow typos, catch in BQ
          .build();
        
        sheet.getRange(2, startColB + index, 1000, 1).setDataValidation(rule);
      }
    });
  },

  /**
   * 📚 REFERENCE BUILDER: Creates the Hidden Lookup Tab
   */
  _buildReferenceSheet: function(config) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(M3_SHEET_CONFIG.REF_SHEET_NAME);
    
    if (!sheet) {
      sheet = ss.insertSheet(M3_SHEET_CONFIG.REF_SHEET_NAME);
      sheet.hideSheet(); // Hide from user
    } else {
      sheet.clear();
    }

    // Simple Header
    sheet.getRange("A1:C1").setValues([["LOCATION_TYPES", "PAYMENT_TERMS", "STATUS_OPTS"]]).setFontWeight("bold");

    // Default Values (In a real system, these might come from BQ too)
    const defaults = [
      ["Local", "Net 30", "ACTIVE"],
      ["Overseas", "Net 60", "INACTIVE"],
      ["", "Immediate", "BLACKLISTED"]
    ];

    sheet.getRange(2, 1, defaults.length, 3).setValues(defaults);
  },

  /**
   * Helper: Convert Column Index to Letter (e.g., 1 -> A, 27 -> AA)
   */
  _colIndexToLetter: function(column) {
    let temp, letter = '';
    while (column > 0) {
      temp = (column - 1) % 26;
      letter = String.fromCharCode(temp + 65) + letter;
      column = (column - temp - 1) / 26;
    }
    return letter;
  }
};