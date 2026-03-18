/**
 * 📦 MODULE 3 MAIN: PROCUREMENT MASTER DATA (Orchestrator)
 * * STRATEGY:
 * 1. READ: Extract calculated data from Zone A (Green Zone).
 * 2. PUSH: Send to BigQuery (Soft Landing).
 * 3. TRIGGER: Run SQL Logic (Validation & Merge).
 * 4. FEEDBACK: Fetch 'FAIL' rows and write back to Zone B (Boomerang).
 */

const M3_MAIN_CONFIG = {
  MODULE_ID: 'ISC_M3_PROCUREMENT',
  LOCK_TIMEOUT_MS: 30000
};

/**
 * 🗺️ LOGIC MAP
 * Key: Sheet Name -> Value: Stored Procedure Name
 */
const POST_UPLOAD_TRIGGERS = {
  'Supplier_Information_Staging': 'SP_M3_MERGE_SUPPLIER_INFO',
  'Supplier_Capacity_Staging':    'SP_M3_MERGE_SUPPLIER_CAPACITY',
  'PR_Staging':                   'SP_M3_MERGE_PR_DECISIONS' // <--- ADD THIS LINE
};

// =========================================================
// 1. UI & MENUS
// =========================================================

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🏢 ISC Procurement')
    .addItem('📤 Upload Active Sheet', 'runActiveM3Upload')
    .addSeparator()
    .addItem('📥 Fetch Validation Errors (Inbox)', 'fetchValidationErrors')
    .addItem('🔄 Refresh Supplier Dropdowns', 'menu_RefreshDropdowns')
    .addSubMenu(ui.createMenu('🔧 Admin Tools')
        .addItem('Re-Build Current Sheet', 'menu_RebuildCurrent')
        .addItem('Re-Build All M3 Tools', 'menu_RebuildAll')
    )
    .addToUi();

  createSourcingMenu();
  createConsolidationMenu();
  createIssuanceMenu();
}

/**
 * 🔄 REFRESHER: Hydrates the Hidden Reference Sheet
 */
function menu_RefreshDropdowns() {
  const ui = SpreadsheetApp.getUi();
  const config = ISC_SCM_Core_Lib.getCoreConfig();
  
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('Fetching Supplier List...', 'M3 Sync');
    const sql = `SELECT SUPPLIER_NAME, SUPPLIER_ID FROM \`${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}.Supplier_Information\` WHERE SUPPLIER_STATUS = 'ACTIVE' ORDER BY SUPPLIER_NAME ASC`;
    const rows = ISC_SCM_Core_Lib.runReadQueryMapped(sql);
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const refSheet = ss.getSheetByName('Ref_Supplier_Master');
    if (!refSheet) throw new Error("Reference Sheet missing.");
    
    if (refSheet.getLastRow() > 1) refSheet.getRange(2, 1, refSheet.getLastRow() - 1, 2).clearContent();
    if (rows.length > 0) refSheet.getRange(2, 1, rows.length, 2).setValues(rows.map(r => [r.SUPPLIER_NAME, r.SUPPLIER_ID]));
    
    ui.alert('✅ Sync Complete', `Updated dropdowns with ${rows.length} suppliers.`, ui.ButtonSet.OK);
  } catch (e) {
    ISC_SCM_Core_Lib.logError('M3_REFRESH', e);
    ui.alert('❌ Sync Failed', e.message, ui.ButtonSet.OK);
  }
}

// =========================================================
// 2. UPLOAD LOGIC (Zone A Read + Boomerang Return)
// =========================================================

/**
 * 2. UPLOAD LOGIC (Zone A Read + Boomerang Return)
 * REPLACED: runActiveM3Upload
 * CHANGE: Strictly reads Zone A (including your Formula ID) and pushes to BigQuery.
 * Does NOT generate UUIDs for business keys.
 */
// [FILE: M3_Main.gs]

function runActiveM3Upload() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  const sheetName = sheet.getName();
  const manifest = getLocalManifest();

  // 1. Validate Context
  if (!manifest.INPUT_SHEETS.includes(sheetName)) {
    ui.alert('⚠️ Invalid Context', 'This is not an M3 Staging Sheet.', ui.ButtonSet.OK);
    return;
  }

  // 2. Confirm
  if (ui.alert(`📤 Upload ${sheetName}?`, 'Zone A data will be pushed to BigQuery.\nZone B will be cleared/reset.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(M3_MAIN_CONFIG.LOCK_TIMEOUT_MS)) throw new Error("System is busy.");

    const coreConfig = ISC_SCM_Core_Lib.getCoreConfig();
    SpreadsheetApp.getActiveSpreadsheet().toast('Reading Zone A...', 'Step 1/4');

    // --- STEP A: READ ZONE A ---
    const rawData = _extractZoneAData(sheet);
    if (rawData.length === 0) throw new Error("Zone A is empty (Did you fill Zone B?).");

    // --- STEP B: PREPARE PAYLOAD ---
    const timestamp = new Date();
    const userEmail = Session.getActiveUser().getEmail();

    const payload = rawData.map(row => {
      // 🟢 CLEANUP: No STAGING_ID generated here.
      // We rely strictly on Business Keys (SUPPLIER_ID, BOM_UPDATE)
      row.UPDATED_BY = userEmail;
      row.UPDATED_AT = timestamp;
      row.VALIDATION_STATUS = 'PENDING';
      return row;
    });

    // --- STEP C: PUSH TO BIGQUERY ---
    SpreadsheetApp.getActiveSpreadsheet().toast('Pushing to Staging...', 'Step 2/4');
    _insertToStaging(sheetName, payload, coreConfig);

    // --- STEP D: TRIGGER SQL (Active) ---
    const triggerSP = POST_UPLOAD_TRIGGERS[sheetName];
    if (triggerSP) {
      SpreadsheetApp.getActiveSpreadsheet().toast('Validating in SQL...', 'Step 3/4');
      ISC_SCM_Core_Lib.runWriteQuery(`CALL \`${coreConfig.connection.PROJECT_ID}.${coreConfig.connection.DATASET_ID}.${triggerSP}\`()`);
    }

    // --- STEP E: BOOMERANG CHECK (Feedback Loop) ---
    SpreadsheetApp.getActiveSpreadsheet().toast('Checking for Rejects...', 'Step 4/4');
    const failures = _fetchErrorsForSheet(sheetName, coreConfig);

    // --- STEP F: SANITIZE (Wipe the Slate) ---
    M3_SheetBuilder.sanitizeInputZone(sheet);

    // --- STEP G: RETURN REJECTS ---
    if (failures.length > 0) {
      _writeRowsToZoneB(sheet, failures);
      SpreadsheetApp.flush();
      ui.alert('⚠️ Upload Complete (With Rejects)', 
        `✅ Accepted: ${payload.length - failures.length}\n` +
        `❌ RETURNED: ${failures.length} rows failed validation.\n\n` +
        `They have been written back to Zone B. Please fix and re-upload.`, 
        ui.ButtonSet.OK);
    } else {
      SpreadsheetApp.flush();
      ui.alert('✅ Upload Successful', `Uploaded ${payload.length} rows.\nAll checks passed.`, ui.ButtonSet.OK);
    }

  } catch (e) {
    ISC_SCM_Core_Lib.logError(M3_MAIN_CONFIG.MODULE_ID, e);
    ui.alert('❌ Upload Failed', e.message, ui.ButtonSet.OK);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 📥 MANUAL FETCH: Pulls errors on demand
 */
function fetchValidationErrors() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  const sheetName = sheet.getName();
  const config = ISC_SCM_Core_Lib.getCoreConfig();

  try {
    const failures = _fetchErrorsForSheet(sheetName, config);
    if (failures.length === 0) {
      ui.alert('✅ Clean', 'No validation errors found in Staging.', ui.ButtonSet.OK);
      return;
    }
    
    M3_SheetBuilder.sanitizeInputZone(sheet);
    _writeRowsToZoneB(sheet, failures);
    ui.alert('⚠️ Errors Fetched', `Loaded ${failures.length} failed rows for correction.`, ui.ButtonSet.OK);
    
  } catch (e) {
    ui.alert('Error', e.message, ui.ButtonSet.OK);
  }
}

// =========================================================
// 3. HELPERS (Extract, Insert, & Feedback)
// =========================================================

/**
 * 📖 ZONE A EXTRACTOR (Robust)
 * Reads ONLY the Green Zone. Ignores Zone B user input directly.
 */
function _extractZoneAData(sheet) {
  const data = sheet.getDataRange().getValues(); 
  if (data.length < 2) return [];

  const headers = data[0];
  const rawStartIdx = headers.indexOf('RAW_START');
  
  if (rawStartIdx === -1) throw new Error("Corrupt Layout: Missing RAW_START.");

  // Zone A is everything BEFORE 'RAW_START'
  const zoneAHeaders = headers.slice(0, rawStartIdx);
  
  const results = [];
  
  for (let r = 1; r < data.length; r++) {
    const rowValues = data[r];
    const zoneAValues = rowValues.slice(0, rawStartIdx);
    
    // Check if empty: We look at the first few columns of Zone A (usually IDs/Names)
    const isEmpty = zoneAValues.slice(0, 3).every(val => val === "" || val === null);
    
    if (isEmpty) continue;

    // Build Object
    const record = {};
    zoneAHeaders.forEach((header, i) => {
      record[header] = zoneAValues[i];
    });
    
    results.push(record);
  }
  
  return results;
}

/**
 * 🔎 Query BigQuery for 'FAIL' rows
 */
function _fetchErrorsForSheet(tableName, config) {
  const sql = `
    SELECT * FROM \`${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}.${tableName}\`
    WHERE VALIDATION_STATUS = 'FAIL'
    ORDER BY UPDATED_AT DESC
    LIMIT 1000
  `;
  return ISC_SCM_Core_Lib.runReadQueryMapped(sql);
}

/**
 * 🖊️ Writer: Maps BQ Rows back to Zone B Headers (The Heal)
 */
function _writeRowsToZoneB(sheet, rows) {
  if (!rows || rows.length === 0) return;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rawStartIdx = headers.indexOf('RAW_START');
  const rawEndIdx = headers.indexOf('RAW_END');

  if (rawStartIdx === -1) return;

  // Identify Headers in Zone B
  const zoneBHeaders = [];
  const startCol = rawStartIdx + 2; // +1 index, +1 pillar
  
  for (let i = rawStartIdx + 1; i < rawEndIdx; i++) {
    zoneBHeaders.push(headers[i]);
  }

  // Map Data
  const output = rows.map(row => {
    return zoneBHeaders.map(h => row[h] || ""); 
  });

  // Write
  sheet.getRange(2, startCol, output.length, output[0].length).setValues(output);
}

/**
 * 🚀 Safe Insert (Soft Landing + Smart Date Fix)
 * REPLACED: _insertToStaging
 * FIX: Distinguishes between DATE (yyyy-MM-dd) and TIMESTAMP (yyyy-MM-dd HH:mm:ss)
 */
function _insertToStaging(tableName, rows, config) {
  if (rows.length === 0) return;
  const dataset = `${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}`;
  
  const tableDef = config.schemas[tableName];
  if (!tableDef) throw new Error(`Schema missing for ${tableName}`);
  const tableSchema = tableDef.schema || tableDef.tempSchema || tableDef;
  if (!Array.isArray(tableSchema)) throw new Error("Invalid Schema Format");

  const sampleRow = rows[0];
  // Filter to ensure we only upload columns that actually exist in the BigQuery Schema
  const columns = Object.keys(sampleRow).filter(k => tableSchema.some(f => f.name === k));
  
  const CHUNK_SIZE = 100;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const valuesList = chunk.map(row => {
      const vals = columns.map(col => {
        let val = row[col];
        const fieldDef = tableSchema.find(f => f.name === col);

        // Handle Nulls
        if (val === null || val === undefined || val === '') return 'NULL';

        // 🟢 SMART DATE FIX: Check Schema Type
        if (val instanceof Date) {
          // If the BigQuery Column is TIMESTAMP or DATETIME, keep the time!
          if (fieldDef.type === 'TIMESTAMP' || fieldDef.type === 'DATETIME') {
            val = Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
          } else {
            // Otherwise (DATE), strip the time to avoid confusion
            val = Utilities.formatDate(val, Session.getScriptTimeZone(), "yyyy-MM-dd");
          }
        }

        // String Escape
        if (['STRING', 'DATE', 'TIMESTAMP', 'DATETIME'].includes(fieldDef.type)) {
          const cleanVal = String(val).replace(/'/g, "\\'").replace(/\n/g, " ");
          return `'${cleanVal}'`;
        }
        return val;
      });
      return `(${vals.join(',')})`;
    });
    
    const sql = `INSERT INTO \`${dataset}.${tableName}\` (${columns.join(',')}) VALUES ${valuesList.join(',')}`;
    ISC_SCM_Core_Lib.runWriteQuery(sql);
  }
}

// =========================================================
// 4. ADMIN UTILS
// =========================================================

function menu_RebuildCurrent() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Re-Build?', 'Data will be lost.', ui.ButtonSet.YES_NO) === ui.Button.YES) {
    M3_SheetBuilder._buildSingleInputSheet(SpreadsheetApp.getActiveSpreadsheet(), SpreadsheetApp.getActiveSheet().getName(), ISC_SCM_Core_Lib.getCoreConfig());
  }
}

function menu_RebuildAll() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Re-Build ALL?', 'Resetting M3 Tools...', ui.ButtonSet.YES_NO) === ui.Button.YES) {
    M3_SheetBuilder.buildSupplierTools();
  }
}

