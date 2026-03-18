/* -------------------------------------------------------------------------
 * FILE: ISC_Module_M4/M4_Injection_Portal_Main.gs
 * DESCRIPTION: Logic Controller for Direct PO Injection Portal (Session-Based).
 * PATTERN: Dialog-Driven Session + CSV Upload + SP Execution + Result Sync
 * REVISION: v1.3 (Added: Supplier dropdown fetch at session start)
 * ------------------------------------------------------------------------- */

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const INJECTION_CONFIG = {
  // Template & Session
  TEMPLATE_NAME: 'M4_PO_Direct_Injection_Template',
  SESSION_SUFFIX: '_PO_Direct_Injection_Portal',
  
  // Database
  STAGING_TABLE: 'PO_Direct_Injection_Staging',
  SP_INJECT: 'SP_INJECT_DIRECT_PO',
  
  // Layout Dimensions
  HEADER_ROW: 5,
  DATA_START_ROW: 6,
  
  // 📊 Dashboard Cells (MUST MATCH SheetBuilder v1.4)
  CELL_PIC_NAME: 'C2',
  CELL_SESSION_ID: 'E2',
  CELL_UPLOAD_TIME: 'C3',
  CELL_STATUS: 'E3',
  
  // Authorization
  VALID_PICS: ['Nga', 'Ngàn', 'Thắng', 'Phong', 'Phương', 'Khánh', 'Nam', 'MASTER'],
  
  // Zone B Column Names (For mapping)
  ZONE_B_COLUMNS: [
    'SUPPLIER_NAME', 'BOM_UPDATE', 'ORDER_QTY', 'UNIT_PRICE',
    'CONFIRMED_QTY', 'LOADED_QTY', 'ORIGINAL_ORDER_DATE',
    'FINAL_REQUESTED_DELIVERY_DATE', 'AGREED_DELIVERY_DATE', 'CURRENT_ETA',
    'LEGACY_PO_REF', 'VPO', 'PO_LINE_NOTE'
  ]
};

// ═══════════════════════════════════════════════════════════════════════════
// 1. 🕹️ MENU CREATOR (Standalone)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Creates the dedicated PO Injection Portal menu.
 * Call this from onOpen() or run manually.
 */
function createInjectionPortalMenu() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🏭 PO Injection Portal')
    .addItem('🔑 Start New Session', 'startInjectionSession')
    .addSeparator()
    .addItem('🚀 Upload & Validate', 'uploadAndValidateInjection')
    .addSeparator()
    .addItem('🔄 Refresh Results', 'refreshInjectionResults')
    .addItem('🧹 Clear Committed Rows', 'clearCommittedRows')
    .addSeparator()
    .addItem('⚙️ Admin: Build Template', 'buildInjectionPortalTemplate')
    .addToUi();
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. 📥 SESSION INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 🔑 Entry point: Prompts for PIC and creates session sheet.
 */
function startInjectionSession() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const picListString = INJECTION_CONFIG.VALID_PICS.join(", ");
  
  const result = ui.prompt(
    '🏭 Direct PO Injection',
    `Enter your name to start a new injection session.\n\nAuthorized Users: ${picListString}\n\n⚠️ You will be the owner (PIC) of all POs in this session.`,
    ui.ButtonSet.OK_CANCEL
  );
  
  if (result.getSelectedButton() !== ui.Button.OK) return;

  const inputPic = result.getResponseText().trim();
  const matchedPic = INJECTION_CONFIG.VALID_PICS.find(
    p => p.toLowerCase() === inputPic.toLowerCase()
  );
  
  if (!matchedPic) {
    ui.alert('❌ Access Denied', `User "${inputPic}" is not in the authorized list.`, ui.ButtonSet.OK);
    return;
  }

  // Show loading message while fetching supplier list
  ss.toast('🔄 Fetching supplier list from database...', 'Initializing', -1);
  
  _createInjectionSession(matchedPic);
}

/**
 * Creates or resets the injection session sheet for a PIC.
 * @param {string} picName - The validated PIC name
 */
function _createInjectionSession(picName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const sessionSheetName = `${picName}${INJECTION_CONFIG.SESSION_SUFFIX}`;

  try {
    // 1. 🏭 Fetch fresh supplier list from BigQuery
    ss.toast('📦 Loading supplier master data...', 'Setup', -1);
    const supplierList = fetchSupplierListFromBQ();
    
    if (supplierList.length === 0) {
      ui.alert('⚠️ Warning', 
        'Could not fetch supplier list from database.\nDropdown will not be available, but you can still type supplier names.\nSP will validate against master data.',
        ui.ButtonSet.OK);
    } else {
      ss.toast(`✅ Loaded ${supplierList.length} suppliers`, 'Setup', 2);
    }

    // 2. Get or create session sheet from template
    let sheet = ss.getSheetByName(sessionSheetName);
    
    if (!sheet) {
      const template = ss.getSheetByName(INJECTION_CONFIG.TEMPLATE_NAME);
      if (!template) {
        throw new Error("CRITICAL: Template not found.\nRun: '🏭 PO Injection Portal > ⚙️ Admin: Build Template'");
      }
      sheet = template.copyTo(ss).setName(sessionSheetName);
    } else {
      // Clear existing data from data rows
      const maxRows = sheet.getMaxRows();
      const rowsToClear = maxRows - INJECTION_CONFIG.DATA_START_ROW + 1;
      
      if (rowsToClear > 0) {
        sheet.getRange(INJECTION_CONFIG.DATA_START_ROW, 1, rowsToClear, sheet.getLastColumn()).clearContent();
      }
    }
    
    sheet.activate();
    
    // 3. Generate Session ID
    const timestamp = Utilities.formatDate(new Date(), 'GMT+7', 'yyyyMMdd_HHmmss');
    const sessionId = `INJ_${picName.toUpperCase()}_${timestamp}`;
    
    // 4. Populate Dashboard
    sheet.getRange(INJECTION_CONFIG.CELL_PIC_NAME).setValue(picName).setFontColor('blue');
    sheet.getRange(INJECTION_CONFIG.CELL_SESSION_ID).setValue(sessionId).setFontFamily('monospace');
    sheet.getRange(INJECTION_CONFIG.CELL_UPLOAD_TIME).setValue(
      Utilities.formatDate(new Date(), 'GMT+7', 'dd-MMM-yyyy HH:mm:ss')
    );
    sheet.getRange(INJECTION_CONFIG.CELL_STATUS).setValue('READY').setFontColor('green');

    // 5. 🎯 Apply validations WITH supplier dropdown
    ss.toast('🎨 Applying validations and dropdown...', 'Setup', -1);
    restoreInjectionValidations(sheet, supplierList);
    protectInjectionSessionSheet(sheet);

    // 6. Success message
    const dropdownMsg = supplierList.length > 0 
      ? `\n\n✅ Supplier dropdown loaded with ${supplierList.length} options.`
      : '\n\n⚠️ Supplier dropdown not available (type values manually).';
    
    ui.alert(
      '✅ Session Started',
      `Session: ${sessionId}\nOwner: ${picName}${dropdownMsg}\n\nEnter data in the BLUE columns (Zone B).\nThen click "🚀 Upload & Validate".`,
      ui.ButtonSet.OK
    );
    
    ss.toast('Ready for data entry!', 'Session Ready', 3);
    
  } catch (e) {
    console.error('Session creation failed:', e);
    ui.alert('❌ Error', e.message, ui.ButtonSet.OK);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. 🚀 UPLOAD & VALIDATE ENGINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Main upload function: Reads sheet data, uploads to staging, calls SP, refreshes results.
 */
function uploadAndValidateInjection() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const ui = SpreadsheetApp.getUi();

  // 1. Validate context
  if (!sheet.getName().includes(INJECTION_CONFIG.SESSION_SUFFIX)) {
    ui.alert("⚠️ Wrong Sheet", "Please run this from your Injection Portal session sheet.", ui.ButtonSet.OK);
    return;
  }

  const currentPIC = sheet.getRange(INJECTION_CONFIG.CELL_PIC_NAME).getValue();
  const sessionId = sheet.getRange(INJECTION_CONFIG.CELL_SESSION_ID).getValue();
  
  if (!currentPIC || !sessionId || sessionId === '[Pending...]') {
    ui.alert("⚠️ Session Error", "Session not properly initialized. Please start a new session.", ui.ButtonSet.OK);
    return;
  }

  try {
    // 2. Update status
    sheet.getRange(INJECTION_CONFIG.CELL_STATUS).setValue('PROCESSING...').setFontColor('orange');
    SpreadsheetApp.flush();

    // 3. Harvest data from Zone B
    const lastRow = _findLastDataRow(sheet);
    
    if (lastRow < INJECTION_CONFIG.DATA_START_ROW) {
      ui.alert("ℹ️ No Data", "Please enter legacy PO data in the blue columns before uploading.", ui.ButtonSet.OK);
      sheet.getRange(INJECTION_CONFIG.CELL_STATUS).setValue('READY').setFontColor('green');
      return;
    }

    const headers = sheet.getRange(INJECTION_CONFIG.HEADER_ROW, 1, 1, sheet.getLastColumn()).getValues()[0];
    const dataRange = sheet.getRange(
      INJECTION_CONFIG.DATA_START_ROW,
      1,
      lastRow - INJECTION_CONFIG.DATA_START_ROW + 1,
      sheet.getLastColumn()
    );
    const values = dataRange.getValues();
    const headerMap = _buildHeaderMap(headers);

    // 4. Build payload
    ss.toast("📦 Preparing data for upload...", "Processing", -1);
    const currentUserEmail = Session.getActiveUser().getEmail();
    const nowTimestamp = Utilities.formatDate(new Date(), 'GMT+7', 'yyyy-MM-dd HH:mm:ss');
    
    const payload = [];
    let rowNumber = 0;
    
    values.forEach((row, idx) => {
      // Check if row has data (SUPPLIER_NAME is required)
      const supplierName = _getCellValue(row, headerMap, 'SUPPLIER_NAME');
      if (!supplierName || supplierName.toString().trim() === '') return;
      
      rowNumber++;
      
      const record = {
        // Section A: Keys
        SESSION_ID: sessionId,
        ROW_NUMBER: rowNumber,
        
        // Section B: Session Context
        PIC: currentPIC,
        
        // Section C: Identity
        SUPPLIER_NAME: supplierName,
        BOM_UPDATE: _getCellValue(row, headerMap, 'BOM_UPDATE'),
        
        // Section D: Quantities
        ORDER_QTY: _parseNumber(_getCellValue(row, headerMap, 'ORDER_QTY')),
        UNIT_PRICE: _parseNumber(_getCellValue(row, headerMap, 'UNIT_PRICE')),
        CONFIRMED_QTY: _parseNumber(_getCellValue(row, headerMap, 'CONFIRMED_QTY')),
        LOADED_QTY: _parseNumber(_getCellValue(row, headerMap, 'LOADED_QTY')),
        
        // Section E: Dates
        ORIGINAL_ORDER_DATE: _formatDateForBQ(_getCellValue(row, headerMap, 'ORIGINAL_ORDER_DATE')),
        FINAL_REQUESTED_DELIVERY_DATE: _formatDateForBQ(_getCellValue(row, headerMap, 'FINAL_REQUESTED_DELIVERY_DATE')),
        AGREED_DELIVERY_DATE: _formatDateForBQ(_getCellValue(row, headerMap, 'AGREED_DELIVERY_DATE')),
        CURRENT_ETA: _formatDateForBQ(_getCellValue(row, headerMap, 'CURRENT_ETA')),
        
        // Section F: Context
        LEGACY_PO_REF: _getCellValue(row, headerMap, 'LEGACY_PO_REF'),
        VPO: _getCellValue(row, headerMap, 'VPO'),
        PO_LINE_NOTE: _getCellValue(row, headerMap, 'PO_LINE_NOTE'),
        
        // Section G: Validation (SP will populate)
        VALIDATION_STATUS: 'PENDING',
        ERROR_MESSAGE: null,
        
        // Section H: System Derived (SP will populate)
        RESOLVED_SUPPLIER_ID: null,
        DERIVED_FULFILLMENT_MODE: null,
        GENERATED_PO_DOC_ID: null,
        GENERATED_PO_LINE_ID: null,
        DERIVED_STATUS: null,
        
        // Section I: Audit
        UPLOADED_BY: currentUserEmail,
        UPLOADED_AT: nowTimestamp
      };
      
      payload.push(record);
    });

    if (payload.length === 0) {
      ui.alert("ℹ️ No Valid Data", "No rows with SUPPLIER_NAME found. Please enter data and try again.", ui.ButtonSet.OK);
      sheet.getRange(INJECTION_CONFIG.CELL_STATUS).setValue('READY').setFontColor('green');
      return;
    }

    // 5. Debug log
    console.log("===== INJECTION UPLOAD DEBUG =====");
    console.log("Session ID:", sessionId);
    console.log("PIC:", currentPIC);
    console.log("Row Count:", payload.length);
    console.log("Sample Row:", JSON.stringify(payload[0]));
    console.log("==================================");

    // 6. Upload to BigQuery
    ss.toast(`💾 Uploading ${payload.length} rows to staging...`, "BigQuery", -1);
    const csvString = _objectsToCsv(payload);
    
    ISC_SCM_Core_Lib.loadCsvData(
      INJECTION_CONFIG.STAGING_TABLE,
      csvString,
      'WRITE_APPEND'
    );

    // 7. Execute Stored Procedure
    ss.toast("⚙️ Running validation & injection (BigQuery SP)...", "Processing", -1);
    const config = ISC_SCM_Core_Lib.getCoreConfig();
    const spCall = `CALL \`${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}.${INJECTION_CONFIG.SP_INJECT}\`('${sessionId}')`;
    
    console.log("Executing SP:", spCall);
    ISC_SCM_Core_Lib.runWriteQuery(spCall);

    // 8. Refresh results
    ss.toast("🔄 Refreshing results...", "Sync", -1);
    _refreshResultsFromStaging(sheet, sessionId);

    // 9. Show summary
    const summary = _getSummary(sheet);
    sheet.getRange(INJECTION_CONFIG.CELL_STATUS).setValue('COMPLETE').setFontColor('blue');
    sheet.getRange(INJECTION_CONFIG.CELL_UPLOAD_TIME).setValue(
      Utilities.formatDate(new Date(), 'GMT+7', 'dd-MMM-yyyy HH:mm:ss')
    );

    ui.alert(
      '✅ Upload Complete',
      `Session: ${sessionId}\n\n✅ Committed: ${summary.committed}\n❌ Errors: ${summary.errors}\n⏳ Pending: ${summary.pending}\n\nCommitted POs are now visible in the Supplier Portal.\nFix any errors and click "Upload & Validate" again.`,
      ui.ButtonSet.OK
    );

  } catch (e) {
    console.error('Upload failed:', e);
    sheet.getRange(INJECTION_CONFIG.CELL_STATUS).setValue('ERROR').setFontColor('red');
    ui.alert('❌ Upload Failed', e.message, ui.ButtonSet.OK);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. 🔄 REFRESH & SYNC ENGINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Refreshes the sheet with latest results from staging table.
 */
function refreshInjectionResults() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const ui = SpreadsheetApp.getUi();

  if (!sheet.getName().includes(INJECTION_CONFIG.SESSION_SUFFIX)) {
    ui.alert("⚠️ Wrong Sheet", "Please run this from your Injection Portal session sheet.", ui.ButtonSet.OK);
    return;
  }

  const sessionId = sheet.getRange(INJECTION_CONFIG.CELL_SESSION_ID).getValue();
  if (!sessionId || sessionId === '[Pending...]') {
    ui.alert("⚠️ No Session", "No active session found.", ui.ButtonSet.OK);
    return;
  }

  try {
    ss.toast("🔄 Refreshing from database...", "Sync", -1);
    _refreshResultsFromStaging(sheet, sessionId);
    ss.toast("✅ Refresh complete!", "Done", 3);
  } catch (e) {
    ui.alert('❌ Refresh Failed', e.message, ui.ButtonSet.OK);
  }
}

/**
 * Internal: Fetches results from staging and updates Zone A.
 */
function _refreshResultsFromStaging(sheet, sessionId) {
  const config = ISC_SCM_Core_Lib.getCoreConfig();
  const query = `
    SELECT 
      ROW_NUMBER,
      VALIDATION_STATUS,
      ERROR_MESSAGE,
      GENERATED_PO_LINE_ID,
      DERIVED_STATUS
    FROM \`${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}.${INJECTION_CONFIG.STAGING_TABLE}\`
    WHERE SESSION_ID = '${sessionId}'
    ORDER BY ROW_NUMBER ASC
  `;
  
  const results = ISC_SCM_Core_Lib.runReadQueryMapped(query);
  
  if (!results || results.length === 0) return;

  const resultMap = new Map();
  results.forEach(r => resultMap.set(parseInt(r.ROW_NUMBER), r));
  
  const headers = sheet.getRange(INJECTION_CONFIG.HEADER_ROW, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  // Identify column indices (1-based)
  const cols = {
    status: headers.indexOf('VALIDATION_STATUS') + 1,
    error: headers.indexOf('ERROR_MESSAGE') + 1,
    lineId: headers.indexOf('GENERATED_PO_LINE_ID') + 1,
    derived: headers.indexOf('DERIVED_STATUS') + 1
  };
  
  if (cols.status === 0) return; // Safety check

  const lastRow = sheet.getLastRow();
  
  // Iterate and update
  for (let row = INJECTION_CONFIG.DATA_START_ROW; row <= lastRow; row++) {
    const rowNum = row - INJECTION_CONFIG.HEADER_ROW; // matches ROW()-5
    const result = resultMap.get(rowNum);
    
    if (result) {
      if (cols.status) sheet.getRange(row, cols.status).setValue(result.VALIDATION_STATUS || '');
      if (cols.error) sheet.getRange(row, cols.error).setValue(result.ERROR_MESSAGE || '');
      if (cols.lineId) sheet.getRange(row, cols.lineId).setValue(result.GENERATED_PO_LINE_ID || '');
      if (cols.derived) sheet.getRange(row, cols.derived).setValue(result.DERIVED_STATUS || '');
    }
  }
}

/**
 * Clears rows that have been committed.
 */
function clearCommittedRows() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const ui = SpreadsheetApp.getUi();

  if (!sheet.getName().includes(INJECTION_CONFIG.SESSION_SUFFIX)) {
    ui.alert("⚠️ Wrong Sheet", "Please run this from your Injection Portal session sheet.", ui.ButtonSet.OK);
    return;
  }

  const confirm = ui.alert(
    '🧹 Clear Committed Rows?',
    'This will remove all rows with VALIDATION_STATUS = "COMMITTED" from the sheet.\nThe data remains in BigQuery.\n\nContinue?',
    ui.ButtonSet.YES_NO
  );
  
  if (confirm !== ui.Button.YES) return;

  try {
    const headers = sheet.getRange(INJECTION_CONFIG.HEADER_ROW, 1, 1, sheet.getLastColumn()).getValues()[0];
    const statusColIdx = headers.indexOf('VALIDATION_STATUS') + 1;
    
    if (statusColIdx === 0) return;

    const lastRow = sheet.getLastRow();
    let clearedCount = 0;
    
    // Iterate bottom-up to avoid index shifting
    for (let row = lastRow; row >= INJECTION_CONFIG.DATA_START_ROW; row--) {
      const status = sheet.getRange(row, statusColIdx).getValue();
      if (status === 'COMMITTED') {
        sheet.deleteRow(row);
        clearedCount++;
      }
    }

    ui.alert('✅ Cleanup Complete', `Removed ${clearedCount} committed rows.`, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('❌ Error', e.message, ui.ButtonSet.OK);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. 🛠️ HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function _buildHeaderMap(headerRow) {
  const map = new Map();
  headerRow.forEach((name, i) => {
    if (name && name !== 'RAW_START' && name !== 'RAW_END') {
      map.set(name, i);
    }
  });
  return map;
}

function _getCellValue(row, headerMap, columnName) {
  const idx = headerMap.get(columnName);
  if (idx === undefined) return null;
  const val = row[idx];
  if (val === '' || val === null || val === undefined) return null;
  return val;
}

function _parseNumber(val) {
  if (val === null || val === '' || val === undefined) return null;
  const num = Number(val);
  return isNaN(num) ? null : num;
}

function _formatDateForBQ(dateObj) {
  if (!dateObj || dateObj === '' || dateObj === null) return null;
  try {
    const d = new Date(dateObj);
    if (isNaN(d.getTime())) return null;
    return Utilities.formatDate(d, 'GMT+7', 'yyyy-MM-dd');
  } catch (e) {
    return null;
  }
}

function _findLastDataRow(sheet) {
  const headers = sheet.getRange(INJECTION_CONFIG.HEADER_ROW, 1, 1, sheet.getLastColumn()).getValues()[0];
  const supplierColIdx = headers.indexOf('SUPPLIER_NAME') + 1;
  
  if (supplierColIdx === 0) return INJECTION_CONFIG.DATA_START_ROW - 1;
  
  const lastRow = sheet.getLastRow();
  // Reverse search for first non-empty Supplier
  for (let row = lastRow; row >= INJECTION_CONFIG.DATA_START_ROW; row--) {
    const val = sheet.getRange(row, supplierColIdx).getValue();
    if (val && val.toString().trim() !== '') {
      return row;
    }
  }
  return INJECTION_CONFIG.DATA_START_ROW - 1;
}

function _getSummary(sheet) {
  const headers = sheet.getRange(INJECTION_CONFIG.HEADER_ROW, 1, 1, sheet.getLastColumn()).getValues()[0];
  const statusColIdx = headers.indexOf('VALIDATION_STATUS') + 1;
  
  let committed = 0, errors = 0, pending = 0;
  
  if (statusColIdx > 0) {
    const lastRow = sheet.getLastRow();
    for (let row = INJECTION_CONFIG.DATA_START_ROW; row <= lastRow; row++) {
      const status = sheet.getRange(row, statusColIdx).getValue();
      if (status === 'COMMITTED') committed++;
      else if (status === 'ERROR') errors++;
      else if (status === 'PENDING' || status === 'VALIDATED') pending++;
    }
  }
  
  return { committed, errors, pending };
}

function _objectsToCsv(dataArray) {
  if (!dataArray || dataArray.length === 0) return '';
  
  const headers = Object.keys(dataArray[0]);
  const csvRows = [headers.join(',')];

  dataArray.forEach(row => {
    const values = headers.map(header => {
      let val = row[header];
      if (val === null || val === undefined) return '';
      val = String(val);
      // Escape CSV specials
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        val = `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    });
    csvRows.push(values.join(','));
  });

  return csvRows.join('\n');
}