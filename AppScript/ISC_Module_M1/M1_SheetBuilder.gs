/**
 * 🏗️ SHEET BUILDER ENGINE (M1 - Production Edition)
 * Automates the creation of the 3-Zone Layout.
 * * FEATURES:
 * - Dynamic Formula Mapping: Finds columns by Name in Zone B OR Zone C.
 * - Granular Security: Locks Zone A & C for Admin only.
 * - Enhanced UI: Zebra Striping, Yellow Warnings, Wrapped Text.
 * - 🛡️ FIX 5.3: Robust Schema Linking (Fixes 'undefined' error) + Zone B Formulas
 */

// --- VISUAL CONFIGURATION ---
const SHEET_CONFIG = {
  COLORS: {
    ZONE_A_HEADER: '#b6d7a8', // 🟢 Green System
    ZONE_B_HEADER: '#9fc5e8', // 🔵 Blue Input
    ZONE_C_HEADER: '#e69138', // 🟠 Dark Orange (Helper)
    
    FORMULA_ROW:   '#ffff00', // 🟡 Bright Yellow (Warning: Don't Touch)
    GHOST_ROW:     '#d9d9d9', // 🌫️ Grey (Visual Block for Row 2)
    PILLAR:        '#000000', // ⚫ Black Separator
    BODY_WHITE:    '#ffffff', // ⚪ Clean White
    ZEBRA_GREY:    '#f3f3f3', // 🌑 Light Grey for Banding
    
    // 🚦 Traffic Lights
    ALERT_RED:     '#ea9999', // Red
    ALERT_YELLOW:  '#ffe599', // Yellow
    ALERT_ORANGE:  '#f9cb9c'  // Orange
  },
  PILLAR_WIDTH: 30,
  FROZEN_ROWS: 2,
  ADMIN_EMAIL: 'dk@isconline.vn'
};

const M1_SheetBuilder = {

  buildAllTables: function() {
    const manifest = getLocalManifest(); 
    if (!manifest.INPUT_SHEETS) {
      Logger.log("❌ Error: INPUT_SHEETS missing in M1_Config.");
      return;
    }
    
    Logger.log(`🏗️ Starting Build for ${manifest.INPUT_SHEETS.length} sheets...`);
    manifest.INPUT_SHEETS.forEach(tableName => {
      const blueprint = (manifest.SHEET_BLUEPRINTS) ? manifest.SHEET_BLUEPRINTS[tableName] : null;
      this.buildInputSheet(tableName, blueprint);
    });
    Logger.log(`✅ Build Complete.`);
  },

  buildInputSheet: function(tableName, blueprint) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const coreConfig = ISC_SCM_Core_Lib.getCoreConfig(); 
    
    Logger.log(`🔨 Building: ${tableName}...`);

    let sheet = ss.getSheetByName(tableName);
    if (sheet) ss.deleteSheet(sheet);
    sheet = ss.insertSheet(tableName);
    sheet.setTabColor('#ffffff');

    // 🛡️ FIX 5.3: ROBUST SCHEMA CHECK
    // We check for 'schemas' (Standard) OR 'TABLE_SCHEMAS' (Legacy)
    // This prevents the "Cannot read properties of undefined" crash.
    const allSchemas = coreConfig.schemas || coreConfig.TABLE_SCHEMAS;

    if (!allSchemas) {
        Logger.log("❌ CRITICAL: No Schemas found in Core Config. Check ISC_SCM_Core_Lib.");
        throw new Error("Core Configuration Error: Schemas not found.");
    }

    const schemaObj = allSchemas[tableName];
    if (!schemaObj) {
      Logger.log(`❌ Schema missing for ${tableName}. Available: ${Object.keys(allSchemas).join(', ')}`);
      return;
    }
    
    const fields = schemaObj.tempSchema || schemaObj.schema;
    const sysHeaders = fields.map(f => f.name);
    
    let colIndex = 1;

    // =========================================================
    // 🏗️ PHASE 1: BUILD THE SKELETON
    // =========================================================
    
    // --- ZONE A: SYSTEM ---
    const zoneA_Start = colIndex;
    const zoneA_Count = sysHeaders.length;
    
    sheet.getRange(1, colIndex, 1, zoneA_Count)
         .setValues([sysHeaders])
         .setFontWeight('bold')
         .setBackground(SHEET_CONFIG.COLORS.ZONE_A_HEADER)
         .setHorizontalAlignment('center');
         
    colIndex += zoneA_Count;

    // --- DIVIDER 1 ---
    const pillar1_Col = colIndex;
    this._drawPillar(sheet, colIndex, "RAW_START");
    colIndex++;

    // --- ZONE B: RAW INPUT ---
    const rawHeaders = (blueprint && blueprint.RAW_HEADERS) ? blueprint.RAW_HEADERS : sysHeaders;
    const zoneB_StartColIndex = colIndex; 
    
    sheet.getRange(1, colIndex, 1, rawHeaders.length)
         .setValues([rawHeaders])
         .setFontWeight('bold')
         .setBackground(SHEET_CONFIG.COLORS.ZONE_B_HEADER)
         .setHorizontalAlignment('center');

    // Ghost Row (Default)
    sheet.getRange(2, colIndex, 1, rawHeaders.length)
         .setBackground(SHEET_CONFIG.COLORS.GHOST_ROW)
         .setFontColor('#808080')      
         .setFontStyle('italic')
         .setValue("(Buffer)");        
         
    // Inject Zone B Formulas (Overwrites Ghost Row if needed)
    this._injectZoneBFormulas(sheet, 2, zoneB_StartColIndex, rawHeaders, blueprint);

    colIndex += rawHeaders.length;

    // --- DIVIDER 2 ---
    const pillar2_Col = colIndex;
    this._drawPillar(sheet, colIndex, "RAW_END");
    colIndex++;

    // --- ZONE C: HELPERS ---
    const zoneC_Start = colIndex;
    let cCount = 0;
    
    if (blueprint && blueprint.ZONE_C_DEFINITIONS) {
      const defs = blueprint.ZONE_C_DEFINITIONS;
      const cHeaders = defs.map(d => d.header);
      cCount = cHeaders.length;

      sheet.getRange(1, colIndex, 1, cCount)
           .setValues([cHeaders])
           .setBackground(SHEET_CONFIG.COLORS.ZONE_C_HEADER)
           .setFontColor('#000000') 
           .setFontWeight('bold');
           
      // Visual Fix: Transparency
      sheet.getRange(3, colIndex, sheet.getMaxRows()-2, cCount)
           .setFontColor('#000000')
           .setBackground('#ffffff');
           
      colIndex += cCount;
    }

    // =========================================================
    // 🧪 PHASE 2: INJECT FORMULAS (Zone A & C)
    // =========================================================
    const findTargetColLetter = (targetHeaderName) => {
      if (!blueprint) return null;
      if (blueprint.RAW_HEADERS) {
        const idxB = blueprint.RAW_HEADERS.indexOf(targetHeaderName);
        if (idxB !== -1) return this._getColLetter(zoneB_StartColIndex + idxB);
      }
      if (blueprint.ZONE_C_DEFINITIONS) {
        const cHeaders = blueprint.ZONE_C_DEFINITIONS.map(d => d.header);
        const idxC = cHeaders.indexOf(targetHeaderName);
        if (idxC !== -1) return this._getColLetter(zoneC_Start + idxC);
      }
      return null;
    };

    if (blueprint && blueprint.FORMULA_MAP) {
      const formulas = sysHeaders.map(sysHeader => {
        const target = blueprint.FORMULA_MAP[sysHeader];
        if (!target) return "";

        // Special Flags
        if (target === "ID_DATA_LOOKUP") return `=ARRAYFORMULA(XLOOKUP(C2:C,'ID DATA'!C:C,'ID DATA'!A:A,,,1))`;
        // V16: Smart Match with Picker — Override priority, fallback to auto-lookup
        if (target === "SMART_ID_RESOLVE") {
          const colOverride = findTargetColLetter("OVERRIDE_ID");
          if (colOverride) {
            return `=ARRAYFORMULA(IF(${colOverride}2:${colOverride}<>"",${colOverride}2:${colOverride},XLOOKUP(C2:C,'ID DATA'!C:C,'ID DATA'!A:A,,,1)))`;
          }
          // Fallback if OVERRIDE_ID not found in blueprint
          return `=ARRAYFORMULA(XLOOKUP(C2:C,'ID DATA'!C:C,'ID DATA'!A:A,,,1))`;
        }
        if (target === "VPO_CALC") {
          const colW = findTargetColLetter("工作令OrderNumber") || "W";
          const colX = findTargetColLetter("序号Line") || "X";
          return `=ARRAYFORMULA(MID(${colW}2:${colW},1,8)&${colX}2:${colX})`;
        }
        
        // FFD Conditional Logic (V16 FIX: Aligned with live REGEXMATCH formula)
        // Logic: If Confirmed_FFD is "N/A" or "NA", use original FFD. Otherwise use Confirmed_FFD.
        if (target === "FFD_CONDITIONAL_CALC") {
          const colFFD = findTargetColLetter("要求完工日期FFD") || "AF";
          const colFinalFFD = findTargetColLetter("Confirmed_FFD");
          if (colFinalFFD) {
            return `=ARRAYFORMULA(IF(REGEXMATCH(${colFinalFFD}2:${colFinalFFD}&"", "(?i)^(N/A|NA)$"), ${colFFD}2:${colFFD}, ${colFinalFFD}2:${colFinalFFD}))`;
          }
          return `=ARRAYFORMULA(${colFFD}2:${colFFD})`;
        }

        // Completion Qty Sanitizer (Reads from Zone B)
        if (target === "COMPLETION_QTY_VALIDATED") {
          const colAL = findTargetColLetter("COMPLETION_QTY"); // Looks for header in Zone B
          if (colAL) {
            return `=ARRAYFORMULA(IF(ROW(${colAL}2:${colAL})=2,"",IF(${colAL}2:${colAL}="",0,IF(ISNUMBER(${colAL}2:${colAL}),${colAL}2:${colAL},0))))`;
          }
          return "";
        }

        const letter = findTargetColLetter(target);
        if (letter) return `=ARRAYFORMULA(${letter}2:${letter})`;

        if (target.startsWith("=")) return target;
        return "";
      });

      const r = sheet.getRange(2, zoneA_Start, 1, zoneA_Count);
      r.setValues([formulas]);
      formulas.forEach((f, i) => { if(f && f.startsWith('=')) sheet.getRange(2, zoneA_Start+i).setFormula(f); });
      r.setBackground(SHEET_CONFIG.COLORS.FORMULA_ROW).setFontStyle('italic').setFontWeight('bold');
    }

    // Zone C Formulas
    if (blueprint && blueprint.ZONE_C_DEFINITIONS) {
      const cFormulas = blueprint.ZONE_C_DEFINITIONS.map(d => d.formula);
      const r = sheet.getRange(2, zoneC_Start, 1, cCount);
      cFormulas.forEach((f, i) => { if(f && f.startsWith('=')) sheet.getRange(2, zoneC_Start+i).setFormula(f); });
      r.setBackground(SHEET_CONFIG.COLORS.FORMULA_ROW).setFontStyle('italic');
    }

    // V16: Apply Data Validation to OVERRIDE_ID column (reject invalid IDs)
    if (blueprint && blueprint.RAW_HEADERS) {
      const overrideIdx = blueprint.RAW_HEADERS.indexOf("OVERRIDE_ID");
      if (overrideIdx !== -1) {
        try {
          const overrideCol = zoneB_StartColIndex + overrideIdx;
          const idDataSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('ID DATA');
          if (idDataSheet) {
            const validationRange = sheet.getRange(3, overrideCol, sheet.getMaxRows() - 2, 1);
            const rule = SpreadsheetApp.newDataValidation()
              .requireValueInRange(idDataSheet.getRange('A:A'), true)
              .setAllowInvalid(false)
              .build();
            validationRange.setDataValidation(rule);
            Logger.log('✅ V16: Data Validation applied to OVERRIDE_ID column.');
          } else {
            Logger.log('⚠️ V16: ID DATA sheet not found. Skipping OVERRIDE_ID validation.');
          }
        } catch (valErr) {
          Logger.log(`⚠️ V16: Data Validation for OVERRIDE_ID failed: ${valErr.message}`);
        }
      }
    }


    // =========================================================
    // 📅 PHASE 3: FORMATTING
    // =========================================================
    const TARGET_DATE_HEADERS = [
      "RECEIVED_VPO_DATE", "REQUEST_FACTORY_FINISHED_DATE", "EX_FACTORY_DATE", 
      "EXPECTED_TIME_OF_DEPARTURE", "WORK_IN_PROCESS_START_DATE", "PACKAGE_START_DATE", 
      "FINISHED_DATE", "Exfact date (link)", "ETD (link)", "Start date WIP", 
      "Start date package", "End date", "Confirmed_FFD"
    ];

    fields.forEach((field, index) => {
      if (field.name.endsWith('_DATE') || field.type === 'DATE' || field.type === 'TIMESTAMP' || TARGET_DATE_HEADERS.includes(field.name)) {
        sheet.getRange(2, zoneA_Start + index, sheet.getMaxRows() - 1, 1).setNumberFormat("dd-MMM-yyyy"); 
      }
    });

    if (blueprint && blueprint.ZONE_C_DEFINITIONS) {
      const cHeaders = blueprint.ZONE_C_DEFINITIONS.map(d => d.header);
      cHeaders.forEach((header, index) => {
         if (TARGET_DATE_HEADERS.includes(header)) {
           sheet.getRange(2, zoneC_Start + index, sheet.getMaxRows() - 1, 1).setNumberFormat("dd-MMM-yyyy");
         }
      });
    }

    // =========================================================
    // 🎨 PHASE 4: FINAL POLISH & SECURITY
    // =========================================================
    const zoneARange = sheet.getRange(3, zoneA_Start, sheet.getMaxRows() - 2, zoneA_Count);
    try { 
      const banding = zoneARange.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
      banding.setFirstRowColor(SHEET_CONFIG.COLORS.BODY_WHITE); 
      banding.setSecondRowColor(SHEET_CONFIG.COLORS.ZEBRA_GREY); 
    } catch(e) {}

    sheet.setFrozenRows(SHEET_CONFIG.FROZEN_ROWS);
    const allData = sheet.getDataRange();
    allData.setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
    allData.setVerticalAlignment("middle");
    // V16 FIX: Override row 2 (formula row) to CLIP — prevents WRAP from expanding it
    sheet.getRange(2, 1, 1, colIndex - 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    sheet.autoResizeColumns(1, colIndex - 1);

    this._applyProtection(sheet, 1, pillar1_Col, "🔒 Zone A (System)"); 
    this._applyProtection(sheet, pillar2_Col, colIndex - 1, "🔒 Zone C (Helpers)");

    // 🚦 APPLY TRAFFIC LIGHTS
    this._applyConditionalFormatting(sheet, zoneB_StartColIndex, rawHeaders, blueprint);

    // V16 FIX: Collapse buffer row to standard height (MUST be after setWrapStrategy)
    sheet.setRowHeight(2, 21);

    Logger.log(`✅ Input Sheet '${tableName}' built successfully.`);
  },

  _injectZoneBFormulas: function(sheet, row, startCol, headers, blueprint) {
    if (!blueprint || !blueprint.ZONE_B_FORMULAS) return;
    headers.forEach((header, index) => {
      const formula = blueprint.ZONE_B_FORMULAS[header];
      if (formula) {
        const cell = sheet.getRange(row, startCol + index);
        cell.setValue(""); 
        cell.setFormula(formula);
        cell.setBackground(SHEET_CONFIG.COLORS.FORMULA_ROW);
      }
    });
  },

  _applyConditionalFormatting: function(sheet, startCol, headers, blueprint) {
    if (!blueprint || !blueprint.CONDITIONAL_FORMATTING) return;
    const rules = sheet.getConditionalFormatRules(); 
    blueprint.CONDITIONAL_FORMATTING.forEach(config => {
      const colIndex = headers.indexOf(config.header);
      if (colIndex === -1) return;
      const range = sheet.getRange(3, startCol + colIndex, sheet.getMaxRows() - 2, 1);
      
      let ruleBuilder = SpreadsheetApp.newConditionalFormatRule().setRanges([range]);
      
      if (config.type === 'NUMBER_LESS_THAN') {
        ruleBuilder.whenNumberLessThan(config.value).setBackground(SHEET_CONFIG.COLORS.ALERT_RED).setFontColor('#ffffff').setBold(true);
      } else if (config.type === 'CUSTOM_FORMULA') {
        ruleBuilder.whenFormulaSatisfied(config.value).setBackground(SHEET_CONFIG.COLORS.ALERT_YELLOW).setFontColor('#000000').setBold(true);
      } else if (config.type === 'NOT_NUMBER') {
         const colLetter = this._getColLetter(startCol + colIndex);
         const formula = `=AND(LEN(${colLetter}3)>0, NOT(ISNUMBER(${colLetter}3)))`;
         ruleBuilder.whenFormulaSatisfied(formula).setBackground(SHEET_CONFIG.COLORS.ALERT_ORANGE).setFontColor('#000000');
      }
      rules.push(ruleBuilder.build());
    });
    sheet.setConditionalFormatRules(rules);
  },

  _applyProtection: function(sheet, startCol, endCol, description) {
    if (startCol > endCol) return;
    const range = sheet.getRange(1, startCol, sheet.getMaxRows(), endCol - startCol + 1);
    const protection = range.protect().setDescription(description);
    const editors = protection.getEditors();
    protection.removeEditors(editors); 
    protection.addEditor(SHEET_CONFIG.ADMIN_EMAIL); 
  },

  _drawPillar: function(sheet, colIndex, label) {
    sheet.getRange(1, colIndex, sheet.getMaxRows(), 1)
         .setBackground(SHEET_CONFIG.COLORS.PILLAR)
         .setValue(label)
         .setFontColor('white')
         .setFontWeight('bold')
         .setHorizontalAlignment('center')
         .setVerticalAlignment('middle');
    sheet.setColumnWidth(colIndex, SHEET_CONFIG.PILLAR_WIDTH);
  },

  _getColLetter: function(colIndex) {
    let temp, letter = '';
    while (colIndex > 0) {
      temp = (colIndex - 1) % 26;
      letter = String.fromCharCode(temp + 65) + letter;
      colIndex = (colIndex - temp - 1) / 26;
    }
    return letter;
  }
};