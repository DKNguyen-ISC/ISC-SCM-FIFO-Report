/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * M1_CS_Status_SheetBuilder.gs
 * The "User Interface" for Customer Service Status Protocol (V15.1 Robust Edition)
 * ═══════════════════════════════════════════════════════════════════════════════
 * * V15.1 UPDATES (Safety Patch):
 * 1. RESOLUTION_SOURCE: Explicitly sends 'ACCEPT_CS' or 'OVERRIDE' to DB.
 * 2. SAFETY VALVE LINK: Enables Stored Procedure to block dangerous "Accepts".
 * 3. ROBUSTNESS: Restored helper functions and deep error handling.
 * 4. UX: Preserved Nuclear Rebuild, Zone C, and Dashboard Layout.
 * * @version 15.1 (Robust Edition)
 * @author CS_SYNC_AGENT
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const M1_CS_Status_SheetBuilder = {

  // ════════════════════════════════════════════════════════════════════════════
  // 1. MAIN UI BUILDER
  // ════════════════════════════════════════════════════════════════════════════
  
  build_CS_Monitor_Sheet: function() {
    const config = getM1CSMonitorConfig();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(config.MONITOR_SHEET_NAME);

    // NUCLEAR REBUILD - Delete and recreate to eliminate ghost artifacts
    // This ensures no lingering Data Validations or Notes from previous runs
    if (sheet) {
      const sheetIndex = sheet.getIndex();
      ss.deleteSheet(sheet);
      sheet = ss.insertSheet(config.MONITOR_SHEET_NAME, sheetIndex - 1);
    } else {
      sheet = ss.insertSheet(config.MONITOR_SHEET_NAME);
    }

    // B. Build Dashboard Header (Rows 1-4) - NOW IN COLUMNS C/D
    this._buildDashboardHeader(sheet, config);

    // C. Construct Column Headers (Zone A + Pillar + Zone B + Pillar + Zone C + Meta)
    const headers = this._buildHeaderRow(config);
    const headerRow = config.DASHBOARD_CONFIG.HEADER_ROW;
    sheet.getRange(headerRow, 1, 1, headers.length).setValues([headers])
          .setFontWeight("bold")
          .setVerticalAlignment("middle")
          .setHorizontalAlignment("center")
          .setWrap(true);

    // D. Apply Header Notes (Tooltips)
    this._applyHeaderNotes(sheet, headers, config, headerRow);

    // E. Apply Zone Styling to Headers
    this._applyHeaderStyles(sheet, headers, config, headerRow);

    // F. Freeze Rows and Columns
    sheet.setFrozenRows(headerRow);
    sheet.setFrozenColumns(2); // VPO and PRODUCTION_ORDER_ID stay visible

    // G. Load Data from BigQuery and Apply Formatting
    this._refresh_CS_Monitor_Data(sheet, config, headers);
    
    console.log('[CS_SheetBuilder V15.1] Sheet rebuilt successfully (Nuclear Mode).');
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 2. DASHBOARD HEADER BUILDER (V15.0 - COLUMNS C/D)
  // ════════════════════════════════════════════════════════════════════════════

  _buildDashboardHeader: function(sheet, config) {
    const dc = config.DASHBOARD_CONFIG;
    const colors = config.COLORS;

    // Row 1: Title (Merged C1:F1)
    sheet.getRange('C1:F1').merge();
    sheet.getRange(dc.CELLS.TITLE).setValue(dc.LABELS.TITLE)
          .setFontSize(16)
          .setFontWeight('bold')
          .setFontColor(colors.DASHBOARD_TITLE)
          .setBackground(colors.DASHBOARD_BG);

    // Row 2: Last Refresh (V15.0: OVERFLOW wrap for full timestamp visibility)
    sheet.getRange(dc.CELLS.REFRESH_LABEL).setValue(dc.LABELS.REFRESH_LABEL)
          .setFontWeight('bold')
          .setBackground(colors.DASHBOARD_BG);
    sheet.getRange(dc.CELLS.LAST_REFRESH).setValue(new Date())
          .setNumberFormat('dd-MMM-yyyy HH:mm')
          .setWrapStrategy(SpreadsheetApp.WrapStrategy.OVERFLOW)
          .setBackground(colors.DASHBOARD_BG);

    // Row 3: Total Alerts
    sheet.getRange(dc.CELLS.ALERTS_LABEL).setValue(dc.LABELS.ALERTS_LABEL)
          .setFontWeight('bold')
          .setBackground(colors.DASHBOARD_BG);
    sheet.getRange(dc.CELLS.TOTAL_ALERTS).setValue(0)
          .setBackground(colors.DASHBOARD_BG);

    // Row 4: Summary
    sheet.getRange(dc.CELLS.SUMMARY_LABEL).setValue(dc.LABELS.SUMMARY_PREFIX)
          .setFontWeight('bold')
          .setBackground(colors.DASHBOARD_BG);
    sheet.getRange(dc.CELLS.SUMMARY_VALUE).setValue('Loading...')
          .setWrapStrategy(SpreadsheetApp.WrapStrategy.OVERFLOW)
          .setBackground(colors.DASHBOARD_BG);
    
    // Style entire dashboard range
    sheet.getRange(dc.DASHBOARD_RANGE).setBackground(colors.DASHBOARD_BG);
    
    // Set reasonable column widths for dashboard area
    sheet.setColumnWidth(3, 100); // Column C (labels)
    sheet.setColumnWidth(4, 200); // Column D (values - wider for timestamp)
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 3. HEADER ROW BUILDER (V15.0 - INCLUDES ZONE C)
  // ════════════════════════════════════════════════════════════════════════════

  _buildHeaderRow: function(config) {
    const headers = [];
    
    // Zone A Headers (Read-Only System/CS Data)
    config.ZONE_A_HEADERS.forEach(function(h) { headers.push(h); });
    
    // RAW_START Pillar
    headers.push(config.PILLARS.RAW_START.header);

    // Zone B Headers (User Input)
    config.ZONE_B_HEADERS.forEach(function(h) { headers.push(h); });
    
    // RAW_END Pillar
    headers.push(config.PILLARS.RAW_END.header);

    // Zone C Headers (V15.0 - Validation/Calculation)
    config.ZONE_C_HEADERS.forEach(function(h) { headers.push(h); });

    // Hidden Metadata Column
    headers.push('META_ALERT_ID');
    
    return headers;
  },

  _applyHeaderNotes: function(sheet, headers, config, headerRow) {
    if (!config.HEADER_NOTES) return;
    const notes = headers.map(function(h) { return config.HEADER_NOTES[h] || null; });
    sheet.getRange(headerRow, 1, 1, headers.length).setNotes([notes]);
  },

  _applyHeaderStyles: function(sheet, headers, config, headerRow) {
    const zoneA_Len = config.ZONE_A_HEADERS.length;
    const rawStartIdx = zoneA_Len + 1;
    const zoneB_Start = rawStartIdx + 1;
    const zoneB_Len = config.ZONE_B_HEADERS.length;
    const rawEndIdx = zoneB_Start + zoneB_Len;
    const zoneC_Start = rawEndIdx + 1;
    const zoneC_Len = config.ZONE_C_HEADERS.length;
    const metaIdx = zoneC_Start + zoneC_Len;
    
    // Zone A: Green header
    sheet.getRange(headerRow, 1, 1, zoneA_Len)
          .setBackground(config.COLORS.ZONE_A_HEADER)
          .setFontColor('black');

    // RAW_START Pillar
    sheet.getRange(headerRow, rawStartIdx, 1, 1)
          .setBackground(config.PILLARS.RAW_START.bgColor)
          .setFontColor(config.PILLARS.RAW_START.textColor);
    sheet.setColumnWidth(rawStartIdx, config.PILLARS.RAW_START.width);

    // Zone B: Blue header
    sheet.getRange(headerRow, zoneB_Start, 1, zoneB_Len)
          .setBackground(config.COLORS.ZONE_B_HEADER)
          .setFontColor('black');

    // RAW_END Pillar
    sheet.getRange(headerRow, rawEndIdx, 1, 1)
          .setBackground(config.PILLARS.RAW_END.bgColor)
          .setFontColor(config.PILLARS.RAW_END.textColor);
    sheet.setColumnWidth(rawEndIdx, config.PILLARS.RAW_END.width);

    // V15.0: Zone C: Purple header
    if (zoneC_Len > 0) {
      sheet.getRange(headerRow, zoneC_Start, 1, zoneC_Len)
            .setBackground(config.COLORS.ZONE_C_HEADER)
            .setFontColor('black');
    }

    // Hide META column
    sheet.hideColumns(metaIdx);
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 4. DATA REFRESH
  // ════════════════════════════════════════════════════════════════════════════

  _refresh_CS_Monitor_Data: function(sheet, config, headers) {
    const coreConfig = ISC_SCM_Core_Lib.getCoreConfig();
    const dataStartRow = config.DASHBOARD_CONFIG.DATA_START_ROW;
    
    console.log("[CS_SheetBuilder] Step 1: Fetching Active Alerts (Granular Mode)...");
    const activeAlerts = this._fetchActiveAlerts(config, coreConfig);
    console.log("[CS_SheetBuilder] Step 2: Fetched " + activeAlerts.length + " rows.");
    
    // Update Dashboard Summary
    this._updateDashboardSummary(sheet, activeAlerts, config);

    if (activeAlerts.length === 0) {
      sheet.getRange(dataStartRow, 1).setValue("No CS Discrepancies Found. System is clean.");
      return;
    }

    // Map Data to Layout
    var self = this;
    const outputRows = activeAlerts.map(function(row, index) {
      return self._mapAlertToRow(row, config, headers, index);
    });
    const numRows = outputRows.length;

    console.log("[CS_SheetBuilder] Step 3: Mapped " + numRows + " rows for display.");

    // Write Data
    sheet.getRange(dataStartRow, 1, numRows, headers.length).setValues(outputRows);

    // Apply Formatting
    this._applyZebraPattern(sheet, numRows, headers, config, dataStartRow, activeAlerts);
    this._applyPillarStyling(sheet, numRows, headers, config, dataStartRow);
    this._applyCellHighlighting(sheet, activeAlerts, headers, config, dataStartRow);
    this._applyWidgets(sheet, numRows, headers, dataStartRow, activeAlerts);
    this._applySmartLocking(sheet, numRows, headers, config, dataStartRow, activeAlerts);
    this._applyDeltaHighlighting(sheet, numRows, headers, config, dataStartRow);  // V15.0 NEW

    // Hide Metadata Column
    const metaColIdx = headers.indexOf('META_ALERT_ID') + 1;
    if (metaColIdx > 0) {
      sheet.hideColumns(metaColIdx);
    }
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 5. DASHBOARD SUMMARY UPDATER (V15.0 - Updated Cell References)
  // ════════════════════════════════════════════════════════════════════════════

  _updateDashboardSummary: function(sheet, alerts, config) {
    const dc = config.DASHBOARD_CONFIG;
    
    // Update timestamp
    sheet.getRange(dc.CELLS.LAST_REFRESH).setValue(new Date())
          .setNumberFormat('dd-MMM-yyyy HH:mm');
    
    // Update total count
    sheet.getRange(dc.CELLS.TOTAL_ALERTS).setValue(alerts.length);
    
    // Build summary breakdown
    const breakdown = {};
    alerts.forEach(function(a) {
      const cls = a.CLASSIFICATION || a.classification || 'UNKNOWN';
      breakdown[cls] = (breakdown[cls] || 0) + 1;
    });
    const summaryParts = Object.entries(breakdown)
      .map(function(entry) { return entry[0] + ': ' + entry[1]; })
      .join(' | ');
    sheet.getRange(dc.CELLS.SUMMARY_VALUE).setValue(summaryParts || 'No alerts');
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 6. ZEBRA PATTERN (V15.0 - Includes Zone C)
  // ════════════════════════════════════════════════════════════════════════════

  _applyZebraPattern: function(sheet, numRows, headers, config, startRow, alerts) {
    if (numRows <= 0) return;

    const zoneA_Len = config.ZONE_A_HEADERS.length;
    const rawStartIdx = zoneA_Len + 1;
    const zoneB_Len = config.ZONE_B_HEADERS.length;
    const rawEndIdx = rawStartIdx + zoneB_Len + 1;
    const zoneC_Len = config.ZONE_C_HEADERS.length;
    
    const backgrounds = [];
    const white = config.COLORS.ZEBRA_WHITE;
    const grey = config.COLORS.ZEBRA_GREY;
    
    // Start with white for first group
    var currentGroupColor = config.ZEBRA_CONFIG.FIRST_ROW_WHITE ? white : grey;
    var previousVpo = null;

    // PASS 1: Generate Background Colors (Grouped by VPO)
    for (var i = 0; i < numRows; i++) {
      var currentVpo = alerts[i]['VPO'] || alerts[i]['vpo'] || 'UNKNOWN';
      
      // If VPO changes (and not the first row), flip the color switch
      if (i > 0 && currentVpo !== previousVpo) {
        currentGroupColor = (currentGroupColor === white) ? grey : white;
      }
      
      previousVpo = currentVpo;
      var rowBg = [];
      
      for (var j = 0; j < headers.length; j++) {
        var colPos = j + 1;
        // Skip pillar columns (they get styled separately)
        if (colPos === rawStartIdx || colPos === rawEndIdx) {
          rowBg.push(null);
        } else {
          rowBg.push(currentGroupColor);
        }
      }
      backgrounds.push(rowBg);
    }
    
    sheet.getRange(startRow, 1, numRows, headers.length).setBackgrounds(backgrounds);

    // PASS 2: Apply Group Separators (Bottom Border)
    for (var i = 0; i < numRows; i++) {
      var currentVpo = alerts[i]['VPO'] || alerts[i]['vpo'] || 'UNKNOWN';
      var nextVpo = (i < numRows - 1) ? (alerts[i+1]['VPO'] || alerts[i+1]['vpo']) : null;
      
      // Check if this row is the end of a group (or end of list)
      if (i === numRows - 1 || currentVpo !== nextVpo) {
        var rowNum = startRow + i;
        // Apply solid bottom border to the entire data row
        sheet.getRange(rowNum, 1, 1, headers.length)
              .setBorder(null, null, true, null, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID);
      }
    }
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 7. PILLAR STYLING
  // ════════════════════════════════════════════════════════════════════════════

  _applyPillarStyling: function(sheet, numRows, headers, config, startRow) {
    const zoneA_Len = config.ZONE_A_HEADERS.length;
    const rawStartIdx = zoneA_Len + 1;
    const zoneB_Len = config.ZONE_B_HEADERS.length;
    const rawEndIdx = rawStartIdx + zoneB_Len + 1;

    // Include header row in pillar styling
    const headerRow = config.DASHBOARD_CONFIG.HEADER_ROW;
    const totalRows = (startRow - headerRow) + numRows;
    
    // RAW_START Column
    sheet.getRange(headerRow, rawStartIdx, totalRows + 1, 1)
          .setBackground(config.PILLARS.RAW_START.bgColor)
          .setFontColor(config.PILLARS.RAW_START.textColor);

    // RAW_END Column
    sheet.getRange(headerRow, rawEndIdx, totalRows + 1, 1)
          .setBackground(config.PILLARS.RAW_END.bgColor)
          .setFontColor(config.PILLARS.RAW_END.textColor);
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 8. CELL-LEVEL HIGHLIGHTING (V14.0 GRANULAR AUDIT)
  // ════════════════════════════════════════════════════════════════════════════

  _applyCellHighlighting: function(sheet, alerts, headers, config, startRow) {
    // Get column indices
    var idx = {
      sysId:             headers.indexOf('PRODUCTION_ORDER_ID') + 1,
      csId:              headers.indexOf('CS_ID_REF') + 1,
      sysOrderQty:       headers.indexOf('SYS_ORDER_QTY') + 1,
      sysFFD:            headers.indexOf('SYS_REQ_FFD') + 1,
      csOrderQty:        headers.indexOf('CS_ORDER_QTY') + 1,
      csFFD:             headers.indexOf('CS_CONFIRMED_FFD') + 1,
      alertType:         headers.indexOf('ALERT_TYPE') + 1,
      classification:    headers.indexOf('CLASSIFICATION') + 1,
      isMultiOrder:      headers.indexOf('IS_MULTI_ORDER') + 1,
      vpo:               headers.indexOf('VPO') + 1
    };

    var colors = config.COLORS.CELL_MISMATCH;
    var qtyTolerance = config.THRESHOLDS.QTY_TOLERANCE || 0.01;
    var self = this;

    alerts.forEach(function(alert, i) {
      var rowNum = startRow + i;
      var safeGet = function(obj, key) {
        return obj[key] || obj[key.toUpperCase()] || obj[key.toLowerCase()] || null;
      };
      
      var alertType = safeGet(alert, 'ALERT_TYPE');
      var classification = safeGet(alert, 'CLASSIFICATION');
      var isMultiOrderRaw = safeGet(alert, 'IS_MULTI_ORDER');
      var isMultiOrder = isMultiOrderRaw === true || String(isMultiOrderRaw) === 'true';

      // 1. ID MISMATCH AUDIT
      var sysIdVal = String(safeGet(alert, 'PRODUCTION_ORDER_ID') || '').trim();
      var csIdVal  = String(safeGet(alert, 'CS_ID_REFS') || '').trim();
      
      if (sysIdVal && csIdVal && sysIdVal !== csIdVal) {
         if (idx.sysId > 0) sheet.getRange(rowNum, idx.sysId).setBackground(colors.ID_MISMATCH);
         if (idx.csId > 0)  sheet.getRange(rowNum, idx.csId).setBackground(colors.ID_MISMATCH);
      }

      // 2. ORDER QUANTITY MISMATCH
      var sysOrderQty = parseFloat(safeGet(alert, 'SYS_ORDER_QTY')) || 0;
      var csOrderQty  = parseFloat(safeGet(alert, 'CS_ORDER_QTY')) || 0;

      if (Math.abs(csOrderQty - sysOrderQty) > qtyTolerance) {
        var highlightColor = isMultiOrder ? colors.LOW_YIELD : colors.QTY;
        if (idx.csOrderQty > 0) sheet.getRange(rowNum, idx.csOrderQty).setBackground(highlightColor);
        if (idx.sysOrderQty > 0) sheet.getRange(rowNum, idx.sysOrderQty).setBackground(highlightColor);
      }
      
      // 3. DATE MISMATCH
      var sysDateStr = self._extractDateValue(safeGet(alert, 'SYS_REQ_FFD'));
      var csDateStr = self._extractDateValue(safeGet(alert, 'CS_CONFIRMED_FFD'));
      
      if (sysDateStr && csDateStr && sysDateStr !== csDateStr) {
        if (idx.csFFD > 0) sheet.getRange(rowNum, idx.csFFD).setBackground(colors.DATE);
        if (idx.sysFFD > 0) sheet.getRange(rowNum, idx.sysFFD).setBackground(colors.DATE);
      }
      
      // 4. ALERT TYPE HIGHLIGHTS
      if (alertType === 'ZOMBIE' || classification === 'STATE_MISMATCH') {
        if (idx.vpo > 0) sheet.getRange(rowNum, idx.vpo).setBackground(colors.COMPLETED);
        if (idx.alertType > 0) sheet.getRange(rowNum, idx.alertType).setBackground(colors.COMPLETED);
      }
      
      if (alertType === 'LOW_YIELD') {
        if (idx.vpo > 0) sheet.getRange(rowNum, idx.vpo).setBackground(colors.LOW_YIELD);
      }
      
      // 5. MULTI_ORDER / SAFETY MARKER
      if (isMultiOrder || alertType === 'MULTI_ORDER' || classification === 'SAFETY_FLAG') {
        if (idx.isMultiOrder > 0) {
          sheet.getRange(rowNum, idx.isMultiOrder)
                .setBackground('#ff8a80')
                .setFontWeight('bold');
        }
      }
    });
  },

  _extractDateValue: function(dateField) {
    if (!dateField) return null;
    if (dateField.value) return String(dateField.value).substring(0, 10);
    if (dateField instanceof Date) {
      return Utilities.formatDate(dateField, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
    }
    return String(dateField).substring(0, 10);
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 9. WIDGETS (V15.0 - Multi-Order Aware Checkboxes)
  // ════════════════════════════════════════════════════════════════════════════

  _applyWidgets: function(sheet, numRows, headers, startRow, alerts) {
    // Date Picker for OVERRIDE_DATE
    var dateIdx = headers.indexOf('OVERRIDE_DATE') + 1;
    if (dateIdx > 0) {
      var dateRule = SpreadsheetApp.newDataValidation()
          .requireDate()
          .setAllowInvalid(false)
          .setHelpText('Please enter a valid date.')
          .build();
      sheet.getRange(startRow, dateIdx, numRows, 1).setDataValidation(dateRule);
    }

    // Checkbox for ACCEPT_CS - Apply to all rows first
    var checkboxIdx = headers.indexOf('ACCEPT_CS') + 1;
    if (checkboxIdx > 0) {
      sheet.getRange(startRow, checkboxIdx, numRows, 1).insertCheckboxes();
    }
    
    // Note: Multi-order checkbox disabling is handled in _applySmartLocking
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 10. SMART LOCKING (V15.2 - BLOCKERS: MULTI, ID_MISMATCH, ZOMBIE)
  // ════════════════════════════════════════════════════════════════════════════

  _applySmartLocking: function(sheet, numRows, headers, config, startRow, alerts) {
    var multiOrderIdx = headers.indexOf('IS_MULTI_ORDER') + 1;
    var alertTypeIdx = headers.indexOf('ALERT_TYPE') + 1;
    var overrideQtyIdx = headers.indexOf('OVERRIDE_QTY') + 1;
    var acceptCsIdx = headers.indexOf('ACCEPT_CS') + 1;

    if (alerts && alerts.length > 0) {
      for (var i = 0; i < numRows; i++) {
        var alert = alerts[i];
        
        // 1. Check Multi-Order
        var isMultiRaw = alert['IS_MULTI_ORDER'] || alert['is_multi_order'];
        var isMultiOrder = isMultiRaw === true || String(isMultiRaw).toUpperCase() === 'TRUE';
        
        // 2. Check Specific Blockers
        var alertType = alert['ALERT_TYPE'] || alert['alert_type'] || '';
        var isIdMismatch = (alertType === 'ID_MISMATCH');
        var isZombie = (alertType === 'ZOMBIE' || alertType === 'STATE_MISMATCH' || alertType === 'GHOST_COMPLETION');
        
        var isBlocked = isMultiOrder || isIdMismatch || isZombie;
        var blockReason = '';

        if (isMultiOrder) blockReason = '⛔ BLOCKED: Multi-Order VPO.\nQty updates are ambiguous.\nUse M2 Planning Module.';
        else if (isIdMismatch) blockReason = '⛔ BLOCKED: ID Mismatch.\nRenaming IDs here creates orphans.\nFix Source in Production Draft.';
        else if (isZombie) blockReason = '⛔ BLOCKED: State Mismatch (Zombie).\nCommitting Qty wont fix State.\nWait for PSP Nightly Sync.';

        if (isBlocked) {
          var rowNum = startRow + i;
          
          // Block OVERRIDE_QTY
          if (overrideQtyIdx > 0) {
            var qtyCell = sheet.getRange(rowNum, overrideQtyIdx);
            qtyCell.setBackground(config.COLORS.DISABLED_CELL);
            qtyCell.setNote(blockReason);
            qtyCell.clearDataValidations();
          }
          
          // BLOCK ACCEPT_CS
          if (acceptCsIdx > 0) {
            var acceptCell = sheet.getRange(rowNum, acceptCsIdx);
            acceptCell.setBackground(config.COLORS.DISABLED_CELL);
            acceptCell.setValue(false);
            acceptCell.removeCheckboxes();
            acceptCell.setValue('🚫');
            acceptCell.setNote(blockReason);
          }
        }
      }
    }
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 11. DELTA HIGHLIGHTING (V15.0 NEW - Zone C Sanity Check)
  // ════════════════════════════════════════════════════════════════════════════

  _applyDeltaHighlighting: function(sheet, numRows, headers, config, startRow) {
    var deltaIdx = headers.indexOf('DELTA_CHECK') + 1;
    var overrideQtyIdx = headers.indexOf('OVERRIDE_QTY') + 1;
    var csOrderQtyIdx = headers.indexOf('CS_ORDER_QTY') + 1;
    
    if (deltaIdx <= 0 || overrideQtyIdx <= 0 || csOrderQtyIdx <= 0) return;
    if (numRows <= 0) return;

    // Apply ArrayFormula for DELTA_CHECK calculation
    // Formula: =IF(OVERRIDE_QTY="", "", OVERRIDE_QTY - CS_ORDER_QTY)
    var overrideCol = getCSColumnLetter(overrideQtyIdx);
    var csQtyCol = getCSColumnLetter(csOrderQtyIdx);
    var deltaCol = getCSColumnLetter(deltaIdx);
    
    // Set formula in first data row - it will calculate per-row
    for (var i = 0; i < numRows; i++) {
      var rowNum = startRow + i;
      var formula = '=IF(' + overrideCol + rowNum + '="", "", ' + 
                    overrideCol + rowNum + '-' + csQtyCol + rowNum + ')';
      sheet.getRange(rowNum, deltaIdx).setFormula(formula);
    }

    // Apply conditional formatting for delta thresholds
    var deltaRange = sheet.getRange(startRow, deltaIdx, numRows, 1);
    var rules = sheet.getConditionalFormatRules();
    
    // Get threshold percentages
    var warningPct = config.THRESHOLDS.DELTA_WARNING_PCT || 0.20;
    var cautionPct = config.THRESHOLDS.DELTA_CAUTION_PCT || 0.10;

    // Rule 1: WARNING (>20% difference) - RED
    // Custom formula: ABS(DELTA_CHECK) > ABS(CS_ORDER_QTY) * 0.20
    var warningFormula = '=AND(' + deltaCol + startRow + '<>"", ' +
                         'ABS(' + deltaCol + startRow + ') > ABS(' + csQtyCol + startRow + ')*' + warningPct + ')';
    var warningRule = SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(warningFormula)
        .setBackground(config.COLORS.DELTA.WARNING)
        .setFontColor('#ffffff')
        .setBold(true)
        .setRanges([deltaRange])
        .build();
    rules.push(warningRule);

    // Rule 2: CAUTION (>10% difference) - YELLOW
    var cautionFormula = '=AND(' + deltaCol + startRow + '<>"", ' +
                         'ABS(' + deltaCol + startRow + ') > ABS(' + csQtyCol + startRow + ')*' + cautionPct + ', ' +
                         'ABS(' + deltaCol + startRow + ') <= ABS(' + csQtyCol + startRow + ')*' + warningPct + ')';
    var cautionRule = SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(cautionFormula)
        .setBackground(config.COLORS.DELTA.CAUTION)
        .setFontColor('#000000')
        .setRanges([deltaRange])
        .build();
    rules.push(cautionRule);

    // Rule 3: OK (reasonable change) - GREEN
    var okFormula = '=AND(' + deltaCol + startRow + '<>"", ' +
                    'ABS(' + deltaCol + startRow + ') <= ABS(' + csQtyCol + startRow + ')*' + cautionPct + ')';
    var okRule = SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(okFormula)
        .setBackground(config.COLORS.DELTA.OK)
        .setRanges([deltaRange])
        .build();
    rules.push(okRule);

    sheet.setConditionalFormatRules(rules);
    
    // Set column header note
    sheet.getRange(config.DASHBOARD_CONFIG.HEADER_ROW, deltaIdx)
          .setNote(config.HEADER_NOTES['DELTA_CHECK']);
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 12. DATA FETCHER (V14.0 - GRANULAR SORT)
  // ════════════════════════════════════════════════════════════════════════════

  _fetchActiveAlerts: function(config, coreConfig) {
    var table = coreConfig.connection.PROJECT_ID + '.'
      + coreConfig.connection.DATASET_ID + '.' + config.BQ_CONFIG.ALERT_LOG_TABLE;
    
    // V15.2 Sort Strategy:
    // 1. IS_MULTI_ORDER DESC (Safety Flags first)
    // 2. BLOCKERS: ID_MISMATCH, ZOMBIE, STATE_MISMATCH (To top)
    // 3. ACTIONABLE: VERSION_CONFLICT, DATA_MISMATCH
    // 4. LOW PRIORITY: INTEL
    var sql = 'SELECT * FROM `' + table + '` ' +
      'WHERE (IS_RESOLVED = FALSE OR IS_RESOLVED IS NULL) ' +
      'ORDER BY ' +
        'IS_MULTI_ORDER DESC, ' +
        'CASE ALERT_TYPE ' +
          "WHEN 'ID_MISMATCH' THEN 1 " +
          "WHEN 'ZOMBIE' THEN 2 " +
          "WHEN 'DROP' THEN 3 " +
          "WHEN 'VERSION_CONFLICT' THEN 4 " +
          "WHEN 'DATA_MISMATCH' THEN 5 " +
          "WHEN 'LOW_YIELD' THEN 6 " +
          'ELSE 7 ' +
        'END ASC, ' +
        'VPO ASC, ' +
        'CS_ID_REFS ASC, ' +
        'ESCALATION_LEVEL DESC, ' +
        'DAYS_UNRESOLVED DESC';
    return ISC_SCM_Core_Lib.runReadQueryMapped(sql);
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 13. ROW MAPPER (V15.0 - INCLUDES ZONE C PLACEHOLDER)
  // ════════════════════════════════════════════════════════════════════════════

  _mapAlertToRow: function(bqRow, config, headers, index) {
    var row = [];
    var self = this;
    
    // Normalize keys to UPPERCASE
    var safeRow = {};
    Object.keys(bqRow).forEach(function(k) {
      safeRow[k.toUpperCase()] = bqRow[k];
    });

    // Parse Boolean for IS_MULTI_ORDER
    var isMultiRaw = safeRow['IS_MULTI_ORDER'];
    var isMulti = (isMultiRaw === true || isMultiRaw === 'true' || String(isMultiRaw).toUpperCase() === 'TRUE');
    
    // Map Zone A Headers
    config.ZONE_A_HEADERS.forEach(function(h) {
      if (h === 'IS_MULTI_ORDER') {
        row.push(isMulti);
      } 
      else if (h === 'CS_ID_REF') {
        // V14 MAPPING: BQ 'CS_ID_REFS' -> UI 'CS_ID_REF'
        row.push(safeRow['CS_ID_REFS'] || '');
      }
      else if (h.includes('FFD') || h.includes('DATE')) {
        var dateVal = safeRow[h];
        row.push(self._formatDateForDisplay(dateVal, config));
      } else {
        row.push(safeRow[h] !== null && safeRow[h] !== undefined ? safeRow[h] : '');
      }
    });

    // RAW_START Pillar
    row.push('');
    
    // Zone B Headers (empty for user input)
    config.ZONE_B_HEADERS.forEach(function(h) { row.push(''); });
    
    // RAW_END Pillar
    row.push('');

    // V15.0: Zone C Headers (formulas will be applied separately)
    config.ZONE_C_HEADERS.forEach(function(h) { row.push(''); });
    
    // META_ALERT_ID
    row.push(safeRow['ALERT_ID']);
    
    return row;
  },

  _formatDateForDisplay: function(dateVal, config) {
    if (!dateVal) return '';
    try {
      var dateObj;
      if (dateVal.value) {
        dateObj = new Date(dateVal.value);
      } else if (dateVal instanceof Date) {
        dateObj = dateVal;
      } else {
        dateObj = new Date(dateVal);
      }
      
      if (isNaN(dateObj.getTime())) return '';
      return Utilities.formatDate(
        dateObj, 
        config.DATE_FORMAT.TIMEZONE, 
        config.DATE_FORMAT.DISPLAY
      );
    } catch (e) {
      console.warn('Date format error:', e.message);
      return String(dateVal);
    }
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 14. COMMIT LOGIC (V15.1 - WITH RESOLUTION SOURCE & SAFETY BLOCK)
  // ════════════════════════════════════════════════════════════════════════════

  submit_CS_Resolutions: function() {
    var config = getM1CSMonitorConfig();
    var coreConfig = ISC_SCM_Core_Lib.getCoreConfig();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(config.MONITOR_SHEET_NAME);
    var ui = SpreadsheetApp.getUi();

    var userEmail = Session.getActiveUser().getEmail();
    if (!config.VALID_USERS[userEmail]) {
      ui.alert('ACCESS DENIED', 'You are not authorized to commit resolutions.', ui.ButtonSet.OK);
      return;
    }

    var lastRow = sheet.getLastRow();
    var dataStartRow = config.DASHBOARD_CONFIG.DATA_START_ROW;
    if (lastRow < dataStartRow) {
      ui.alert('No data to process.');
      return;
    }

    var headerRow = config.DASHBOARD_CONFIG.HEADER_ROW;
    var headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getValues()[0];
    var colMap = {};
    headers.forEach(function(h, i) { colMap[h] = i; });

    var dataRange = sheet.getRange(dataStartRow, 1, lastRow - dataStartRow + 1, sheet.getLastColumn());
    var dataValues = dataRange.getValues();
    var payloads = [];
    var rowsToUpdate = [];
    var blockedRows = [];
    var self = this;

    for (var i = 0; i < dataValues.length; i++) {
      var row = dataValues[i];
      var isAccepted = row[colMap['ACCEPT_CS']] === true;
      var overrideQty = row[colMap['OVERRIDE_QTY']];
      var overrideDate = row[colMap['OVERRIDE_DATE']];
      var note = row[colMap['RESOLUTION_NOTE']];
      var statusCell = row[colMap['RESOLUTION_STATUS']]; 
      var isMultiOrder = row[colMap['IS_MULTI_ORDER']];

      if (String(statusCell).includes('SUBMITTED')) continue;

      var hasIntent = isAccepted ||
                      (typeof overrideQty === 'number' && overrideQty >= 0) || 
                      (overrideDate instanceof Date);

      if (!hasIntent) continue;

      // V15.0: Determine if this is a Multi-Order row
      var isMulti = isMultiOrder === true ||
                    isMultiOrder === 'TRUE' || 
                    isMultiOrder === 'true' ||
                    String(isMultiOrder).toUpperCase() === 'TRUE';

      // V15.0: ENHANCED SAFETY BLOCK - Blocks BOTH Qty Override AND Accept CS
      if (isMulti) {
        // Block 1: Explicit Qty Override
        if (overrideQty !== '' && overrideQty !== null && typeof overrideQty === 'number') {
          blockedRows.push({
            row: dataStartRow + i,
            vpo: row[colMap['VPO']],
            reason: 'Qty override blocked for Multi-Order VPO'
          });
          continue;
        }
        
        // Block 2: V15.0 FIX - Accept CS (closes the loophole!)
        if (isAccepted) {
          blockedRows.push({
            row: dataStartRow + i,
            vpo: row[colMap['VPO']],
            reason: 'Accept CS blocked for Multi-Order VPO (Qty would be ambiguous)'
          });
          continue;
        }
      }

      var vpo = row[colMap['VPO']];
      var alertId = row[colMap['META_ALERT_ID']];
      var prodId = row[colMap['PRODUCTION_ORDER_ID']];
      var dateKey = Utilities.formatDate(new Date(), "GMT", "yyyyMMdd");
      var hashInput = alertId + '_' + overrideQty + '_' + overrideDate + '_' + dateKey;
      var resId = self._generateResolutionID(hashInput);
      
      // [V15.1 FIX] DETERMINE SOURCE TAG
      var resolutionSource = 'UNKNOWN';
      if (isAccepted) {
        resolutionSource = 'ACCEPT_CS';
      } else if ((overrideQty !== '' && overrideQty !== null) || (overrideDate instanceof Date)) {
        resolutionSource = 'OVERRIDE';
      }

      // Determine TARGET_ORDER_QTY
      var targetQty = null;
      if (!isMulti) {
        // Single-order: Allow both explicit override and Accept CS
        if (overrideQty !== '' && overrideQty !== null && typeof overrideQty === 'number') {
          targetQty = Number(overrideQty);
        } else if (isAccepted) {
          targetQty = Number(row[colMap['CS_ORDER_QTY']]);
        }
      }
      // Multi-order: targetQty stays null (only date is processed)

      // Determine TARGET_FFD
      var targetFFD = null;
      if (overrideDate instanceof Date) {
        targetFFD = self._formatDateForSQL(overrideDate);
      } else if (isAccepted && row[colMap['CS_CONFIRMED_FFD']]) {
        targetFFD = self._formatDateForSQL(row[colMap['CS_CONFIRMED_FFD']]);
      }

      // Only create payload if there's something to do
      if (targetQty !== null || targetFFD !== null) {
        payloads.push({
          RESOLUTION_ID: resId,
          ALERT_ID: alertId,
          VPO: vpo,
          PRODUCTION_ORDER_ID: prodId,
          TARGET_ORDER_QTY: targetQty,
          TARGET_FFD: targetFFD,
          RESOLUTION_NOTE: note || (isAccepted ? 'Accepted CS View' : 'Manual Override'),
          RESOLVED_BY: userEmail,
          IS_MULTI_ORDER: isMulti,
          VALIDATION_STATUS: 'PENDING',
          RESOLUTION_SOURCE: resolutionSource // [V15.1 FIX]
        });
        rowsToUpdate.push(dataStartRow + i);
      }
    }

    if (blockedRows.length > 0) {
      var blockedMsg = blockedRows.map(function(b) { 
        return 'Row ' + b.row + ' (' + b.vpo + '): ' + b.reason; 
      }).join('\n');
      ui.alert('⚠️ Some Actions Blocked', 
        blockedRows.length + ' row(s) were blocked due to safety rules:\n\n' + blockedMsg + 
        '\n\n📌 For Multi-Order VPOs:\n• Only Date overrides are permitted\n• Use M2 Planning Module for Qty changes',
        ui.ButtonSet.OK);
    }

    if (payloads.length === 0) {
      if (blockedRows.length === 0) {
        ui.alert('No actions selected.', "Please check 'ACCEPT_CS' or enter an Override Qty/Date.", ui.ButtonSet.OK);
      }
      return;
    }

    // [V15.1 NEW] CONFIRMATION DIALOG
    var confirmMsg = 'You are about to commit ' + payloads.length + ' resolutions.\n\n' +
                     'This action will:\n' +
                     '1. Update Production Order Data (Qty/Date)\n' +
                     '2. Resolve selected Alerts\n' +
                     '3. Auto-expire superseded "Ghost Versions" (if any)\n\n' +
                     'Are you sure?';
    var response = ui.alert('Confirm Commit', confirmMsg, ui.ButtonSet.YES_NO);
    if (response == ui.Button.NO) {
      return;
    }

    try {
      this._insertToStaging(payloads, config, coreConfig);
      rowsToUpdate.forEach(function(r) {
        var statusIdx = colMap['RESOLUTION_STATUS'] + 1;
        var acceptIdx = colMap['ACCEPT_CS'] + 1;
        
        sheet.getRange(r, statusIdx).setValue('SUBMITTED');
        sheet.getRange(r, acceptIdx).setValue(false); 
        sheet.getRange(r, 1, 1, sheet.getLastColumn()).setBackground('#e0e0e0'); 
      });
      // [V15.2 UX] ENHANCED SUCCESS MESSAGE
      ui.alert('✅ Success', 
        payloads.length + ' resolutions queued.\n\n' +
        'The System is now processing your changes.\n' +
        'Auto-Cleanup will run for any version conflicts.\n' +
        'Please wait 30 seconds before refreshing.', 
        ui.ButtonSet.OK);
      
    } catch (e) {
      console.error(e);
      ui.alert('❌ Error', 'Failed to submit: ' + e.message, ui.ButtonSet.OK);
    }
  },

  // ════════════════════════════════════════════════════════════════════════════
  // 15. HELPERS
  // ════════════════════════════════════════════════════════════════════════════

  _insertToStaging: function(payloads, config, coreConfig) {
    var table = coreConfig.connection.PROJECT_ID + '.'
      + coreConfig.connection.DATASET_ID + '.' + config.BQ_CONFIG.RESOLUTION_STAGING_TABLE;
    var esc = function(s) { return s ? String(s).replace(/'/g, "\\'") : ''; };
    var self = this;
    
    var values = payloads.map(function(p) {
      return "(" +
        "'" + esc(p.RESOLUTION_ID) + "', " +
        "'" + esc(p.ALERT_ID) + "', " +
        "'" + esc(p.VPO) + "', " +
        "'" + esc(p.PRODUCTION_ORDER_ID) + "', " +
        (p.TARGET_ORDER_QTY !== null ? p.TARGET_ORDER_QTY : 'NULL') + ", " +
        (p.TARGET_FFD ? "'" + p.TARGET_FFD + "'" : 'NULL') + ", " +
        "'" + esc(p.RESOLUTION_NOTE) + "', " +
        "'" + esc(p.RESOLVED_BY) + "', " +
        p.IS_MULTI_ORDER + ", " +
        "'PENDING', NULL, " + 
        "'" + esc(p.RESOLUTION_SOURCE) + "', " + // [V15.1 FIX] Added Column
        "CURRENT_TIMESTAMP(), NULL" +
      ")";
    }).join(',');

    var sql = "INSERT INTO `" + table + "` " +
      "(RESOLUTION_ID, ALERT_ID, VPO, PRODUCTION_ORDER_ID, TARGET_ORDER_QTY, TARGET_FFD, RESOLUTION_NOTE, RESOLVED_BY, IS_MULTI_ORDER, VALIDATION_STATUS, ERROR_MESSAGE, RESOLUTION_SOURCE, CREATED_AT, PROCESSED_AT) " +
      "VALUES " + values;
      
    ISC_SCM_Core_Lib.runWriteQuery(sql);
  },

  _generateResolutionID: function(input) {
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, input);
    var hash = '';
    for (var i = 0; i < digest.length; i++) {
      var byte = digest[i];
      if (byte < 0) byte += 256;
      var bStr = byte.toString(16);
      if (bStr.length == 1) bStr = '0' + bStr;
      hash += bStr;
    }
    return 'RES_' + hash.substring(0, 12).toUpperCase();
  },

  _formatDateForSQL: function(dateObj) {
    if (!dateObj) return null;
    var d = dateObj;
    if (typeof dateObj === 'string') {
      d = new Date(dateObj);
    }
    if (!(d instanceof Date) || isNaN(d.getTime())) return null;
    return Utilities.formatDate(d, "Asia/Ho_Chi_Minh", "yyyy-MM-dd");
  }
};

/**
 * Helper: Get column letter from index (1-based)
 * Restored here to ensure dependency-free execution for Zone C formulas
 */
function getCSColumnLetter(colIndex) {
  let temp, letter = '';
  while (colIndex > 0) {
    temp = (colIndex - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    colIndex = Math.floor((colIndex - temp - 1) / 26);
  }
  return letter;
}