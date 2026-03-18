/* -------------------------------------------------------------------------
 * FILE: ISC_Module_M4/M4_Suppliers_Portal_Main.gs
 * DESCRIPTION: Logic Controller for Logistics Control Tower (Session-Based).
 * PATTERN: Dialog-Driven Session + JSON-to-Grid + CSV Transaction
 * REVISION: v6.2 (Diagnostic Mode + Ghost Column Removed)
 * ------------------------------------------------------------------------- */

const M4_LOGIC_CONSTANTS = {
  TEMPLATE_NAME: 'M4_UI_Supplier_Portal_Template',
  SESSION_SUFFIX: '_Logistics_Portal', 
  
  // Database Connections
  VIEW_NAME: 'UI_Supplier_Portal_VIEW',
  LOG_TABLE: 'Supplier_Feedback_Log',
  SP_FEEDBACK: 'SP_M4_APPLY_FEEDBACK', 
  
  // Layout
  HEADER_ROW: 5,
  DATA_START_ROW: 6,
  
  // Dashboard Cells
  CELL_PIC_NAME: 'B2',
  CELL_TIMESTAMP: 'B3',

  // Valid PICs
  VALID_PICS: ['Nga', 'Ngàn', 'Thắng', 'Phong', 'Phương', 'Khánh', 'Nam', 'MASTER']
};

/* =========================================================================
 * 1. 🕹️ MENU CREATOR
 * ========================================================================= */
function createSupplierPortalMenu() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('✈️ Logistics Portal')
    .addItem('📥 Load My Portal (Start Session)', 'loadMyPortal')
    .addSeparator()
    .addItem('🚀 Save Feedback & Refresh', 'saveMyFeedback')
    .addToUi();
}

/* =========================================================================
 * 2. 📥 LOAD ENGINE (READ)
 * ========================================================================= */

function loadMyPortal() {
  const ui = SpreadsheetApp.getUi();
  const picListString = M4_LOGIC_CONSTANTS.VALID_PICS.join(", ");
  const result = ui.prompt(
    '🔐 Identity Verification',
    `Please enter your PIC Name.\n\nAuthorized Users: ${picListString}`,
    ui.ButtonSet.OK_CANCEL
  );

  if (result.getSelectedButton() !== ui.Button.OK) return;

  const inputPic = result.getResponseText().trim();
  const matchedPic = M4_LOGIC_CONSTANTS.VALID_PICS.find(p => p.toLowerCase() === inputPic.toLowerCase());

  if (!matchedPic) {
    ui.alert('❌ Access Denied', `User "${inputPic}" is not in the authorized list.`, ui.ButtonSet.OK);
    return;
  }

  _loadSessionForPIC(matchedPic);
}

function _loadSessionForPIC(picName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const sessionSheetName = `${picName}${M4_LOGIC_CONSTANTS.SESSION_SUFFIX}`;

  try {
    let sheet = ss.getSheetByName(sessionSheetName);
    if (!sheet) {
      const template = ss.getSheetByName(M4_LOGIC_CONSTANTS.TEMPLATE_NAME);
      if (!template) throw new Error("CRITICAL: Master Template not found.");
      sheet = template.copyTo(ss).setName(sessionSheetName);
    }
    sheet.activate();

    const maxRows = sheet.getMaxRows();
    const rowsToClear = maxRows - M4_LOGIC_CONSTANTS.DATA_START_ROW + 1;
    
    if (rowsToClear > 0) {
      sheet.getRange(M4_LOGIC_CONSTANTS.DATA_START_ROW, 1, rowsToClear, sheet.getLastColumn())
           .clearContent()
           .clearDataValidations()
           .removeCheckboxes();
    }

    const toastId = ss.toast("📡 Fetching data from Logistics Tower...", "BigQuery", -1);
    const rows = _fetchPortalData(picName);

    if (rows && rows.length > 0) {
      const headers = sheet.getRange(M4_LOGIC_CONSTANTS.HEADER_ROW, 1, 1, sheet.getLastColumn()).getValues()[0];
      
      const grid = rows.map(row => {
        return headers.map(headerName => {
          if (headerName === 'RAW_START' || headerName === 'RAW_END') return "";
          return row[headerName] !== undefined ? row[headerName] : ""; 
        });
      });

      sheet.getRange(M4_LOGIC_CONSTANTS.DATA_START_ROW, 1, grid.length, grid[0].length)
           .setValues(grid);
      
      ss.toast(`✅ Loaded ${rows.length} orders for ${picName}.`);
    } else {
      ss.toast(`ℹ️ No active orders found for ${picName}.`);
    }

    restoreValidations(sheet);

    sheet.getRange(M4_LOGIC_CONSTANTS.CELL_PIC_NAME).setValue(picName);
    const formattedDate = Utilities.formatDate(new Date(), "GMT+7", "d-MMM-yyyy");
    sheet.getRange(M4_LOGIC_CONSTANTS.CELL_TIMESTAMP).setValue(formattedDate);
    
    protectSessionSheet(sheet);

  } catch (e) {
    ISC_SCM_Core_Lib.logError('M4_LOAD_FAIL', e);
    ui.alert('❌ Error Loading Portal', e.message, ui.ButtonSet.OK);
  }
}

/* =========================================================================
 * 3. 🚀 SUBMIT ENGINE (WRITE - DIAGNOSTIC MODE)
 * ========================================================================= */

function saveMyFeedback() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const ui = SpreadsheetApp.getUi();

  // 1. Context Validation
  if (!sheet.getName().includes(M4_LOGIC_CONSTANTS.SESSION_SUFFIX)) {
    ui.alert("⚠️ Wrong Sheet", "Please run this command from your Logistics Portal session sheet.", ui.ButtonSet.OK);
    return;
  }

  const currentPIC = sheet.getRange(M4_LOGIC_CONSTANTS.CELL_PIC_NAME).getValue();
  if (!currentPIC || currentPIC === "") {
    ui.alert("⚠️ Identity Error", "Session Owner (Cell B2) is missing. Reload the portal.", ui.ButtonSet.OK);
    return;
  }

  try {
    const lastRow = sheet.getLastRow();
    if (lastRow < M4_LOGIC_CONSTANTS.DATA_START_ROW) {
      ui.alert("ℹ️ Nothing to save.");
      return;
    }

    // 2. Harvest Data
    const dataRange = sheet.getRange(
      M4_LOGIC_CONSTANTS.DATA_START_ROW, 
      1, 
      lastRow - M4_LOGIC_CONSTANTS.DATA_START_ROW + 1, 
      sheet.getLastColumn()
    );
    
    const values = dataRange.getValues();
    const headers = sheet.getRange(M4_LOGIC_CONSTANTS.HEADER_ROW, 1, 1, sheet.getLastColumn()).getValues()[0];
    const map = _getHeaderMap(headers);

    // 3. Prepare Payload
    const batchId = `BATCH_${currentPIC.toUpperCase()}_${Utilities.formatDate(new Date(), "GMT+7", "yyyyMMdd_HHmmss")}`;
    const currentUserEmail = Session.getActiveUser().getEmail();
    const nowTimestamp = Utilities.formatDate(new Date(), "GMT+7", "yyyy-MM-dd HH:mm:ss");

    const payload = [];

    values.forEach(row => {
      const poLineId = row[map.get('PO_LINE_ID')];
      
      if (poLineId) {
        
        // 🟢 SNAPSHOT STRATEGY: Strict Schema Matching (No Supplier_Name for now)
        const logEntry = {
          // --- A. IDENTITY & KEYS ---
          FEEDBACK_LOG_ID: `${batchId}_${poLineId}`, 
          FEEDBACK_BATCH_ID: batchId,
          PO_LINE_ID: poLineId,
          
          // --- B. ZONE A: CONTEXT ---
          PO_DOCUMENT_ID: "", 
          PO_NUMBER_REF: row[map.get('PO_NUMBER_REF')] || "",
          SUPPLIER_NAME: row[map.get('SUPPLIER_NAME')] || "",
          BOM_UPDATE: row[map.get('BOM_UPDATE')] || "",
          VPO: row[map.get('VPO')] || "",
          DATE_CODE: row[map.get('DATE_CODE')] || "",
          FULFILLMENT_MODE: row[map.get('FULFILLMENT_MODE')] || "",
          PIC: currentPIC, 
          
          // ⚠️ REMOVED: SUPPLIER_NAME (Not in DB Schema yet)
          // SUPPLIER_NAME: row[map.get('SUPPLIER_NAME')] || "", 

          // --- C. ZONE B: FEEDBACK ---
          CLOSURE_REASON: row[map.get('CLOSURE_REASON')] || "",
          CONFIRMED_QTY: _parseNumber(row[map.get('CONFIRMED_QTY')]),
          LOADED_QTY: _parseNumber(row[map.get('LOADED_QTY')]),
          ACTUAL_RECEIVED_QTY: _parseNumber(row[map.get('ACTUAL_RECEIVED_QTY')]),
          
          AGREED_DELIVERY_DATE: _formatDateForBQ(row[map.get('AGREED_DELIVERY_DATE')]),
          CURRENT_ETA: _formatDateForBQ(row[map.get('CURRENT_ETA')]),
          ACTUAL_ARRIVAL_DATE: _formatDateForBQ(row[map.get('ACTUAL_ARRIVAL_DATE')]),
          
          SUPPLIER_FEEDBACK_NOTE: row[map.get('SUPPLIER_FEEDBACK_NOTE')] || "",

          // --- D. META DATA ---
          FEEDBACK_STATUS: 'PENDING', 
          UPDATED_BY: currentUserEmail,
          UPDATED_AT: nowTimestamp
        };

        payload.push(logEntry);
      }
    });

    if (payload.length === 0) {
      ui.alert("ℹ️ No valid data found to save.");
      return;
    }

    // 🕵️ DEBUG LAYER A: Execution Transcript
    // View > Executions to see this!
    console.log("----- 🕵️ DEBUGGER: PAYLOAD INSPECTION -----");
    console.log("Expected Table:", M4_LOGIC_CONSTANTS.LOG_TABLE);
    console.log("Generated Headers:", Object.keys(payload[0])); 
    console.log("Row 1 Sample:", JSON.stringify(payload[0]));
    console.log("-------------------------------------------");

    // 4. The Transaction
    ss.toast("💾 Saving feedback snapshot...", "BigQuery");
    const csvString = _objectsToCsv(payload);
    
    // Upload with specialized Catch Block
    try {
      ISC_SCM_Core_Lib.loadCsvData(
        M4_LOGIC_CONSTANTS.LOG_TABLE, 
        csvString,
        'WRITE_APPEND' 
      );
    } catch (bqError) {
      // 🚨 DEBUG LAYER B: Enhanced UI Feedback
      const sentHeaders = Object.keys(payload[0]).join(", ");
      const errorMsg = `❌ BigQuery Rejected the CSV.\n\n📢 DEBUG INFO:\nWe sent these columns:\n[${sentHeaders}]\n\nCompare this list against the Schema in Config_Schema.txt.\n\nOriginal Error: ${bqError.message}`;
      
      throw new Error(errorMsg); 
    }

    // 5. Trigger Logic & Refresh
    ss.toast("⚙️ Processing updates...", "Logic Engine");
    const sql = `CALL \`${ISC_SCM_Core_Lib.getCoreConfig().connection.PROJECT_ID}.${ISC_SCM_Core_Lib.getCoreConfig().connection.DATASET_ID}.${M4_LOGIC_CONSTANTS.SP_FEEDBACK}\`()`;
    ISC_SCM_Core_Lib.runWriteQuery(sql);

    ss.toast("🔄 Refreshing view...", "Sync");
    _loadSessionForPIC(currentPIC);

    ui.alert("✅ Success", `Feedback saved (Batch: ${batchId}). Portal refreshed.`, ui.ButtonSet.OK);

  } catch (e) {
    ISC_SCM_Core_Lib.logError('M4_SAVE_FAIL', e);
    // Alert is already enhanced by the inner catch block
    ui.alert(e.message);
  }
}

/* =========================================================================
 * 4. 🛠️ HELPERS
 * ========================================================================= */

function _fetchPortalData(picName) {
  const config = ISC_SCM_Core_Lib.getCoreConfig();
  const projectId = config.connection.PROJECT_ID;
  const datasetId = config.connection.DATASET_ID;
  
  let whereClause = "";
  if (picName.toUpperCase() !== "MASTER") {
    whereClause = `WHERE LOWER(PIC) = LOWER('${picName}')`;
  }

  const query = `
    SELECT * FROM \`${projectId}.${datasetId}.${M4_LOGIC_CONSTANTS.VIEW_NAME}\`
    ${whereClause}
    ORDER BY PIC, PO_NUMBER_REF
  `;

  return ISC_SCM_Core_Lib.runReadQueryMapped(query);
}

function _getHeaderMap(headerRow) {
  const map = new Map();
  headerRow.forEach((name, i) => {
    if (name) map.set(name, i);
  });
  return map;
}

function _formatDateForBQ(dateObj) {
  if (!dateObj || dateObj === "") return null;
  try {
    return Utilities.formatDate(new Date(dateObj), "GMT+7", "yyyy-MM-dd");
  } catch (e) {
    return null; 
  }
}

function _parseNumber(val) {
  if (val === "" || val === null) return null;
  const num = Number(val);
  return isNaN(num) ? null : num;
}

function _objectsToCsv(dataArray) {
  if (!dataArray || dataArray.length === 0) return "";
  const headers = Object.keys(dataArray[0]);
  const csvRows = [headers.join(",")];

  dataArray.forEach(row => {
    const values = headers.map(header => {
      let val = row[header];
      if (val === null || val === undefined) return ""; 
      val = String(val); 
      if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        val = `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    });
    csvRows.push(values.join(","));
  });

  return csvRows.join("\n");
}