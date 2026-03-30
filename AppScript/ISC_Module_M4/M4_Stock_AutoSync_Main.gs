/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🧠 M4_STOCK_AUTOSYNC_MAIN.gs (V6.5 - ATOMIC SESSION EDITION)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * Headless automation for Stock Count synchronization.
 * Detects inventory changes, commits to BigQuery, triggers Monday Protocol SPs.
 * 
 * CRITICAL ARCHITECTURE CHANGES (V6.5):
 * 1. 🛡️ ATOMIC SESSION IDs: Replaces Day-Based Batch IDs with Unique Session IDs.
 *    - Prevents data duplication if multiple syncs happen on the same day.
 * 2. 🔇 STABLE HASHING: Uses BOM Data instead of Volatile IDs for change detection.
 *    - Prevents "Midnight Phantom" triggers when Sheet formulas update.
 * 3. 🌍 UTC TIMESTAMPS: Enforces GMT for BigQuery audit trails.
 *    - Prevents 7-hour timezone drift in history logs.
 * 
 * VERIFIED AGAINST:
 * - M4_Stock_AutoSync_SheetBuilder.txt (Gateway layout, Zone A columns)
 * - Config_Schema.txt (Stock_Count_Upload BigQuery schema)
 * - SQL_Vault.txt (SP_M4_FILTER, SP_M4_RESET_STOCK with Circuit Breaker)
 * - M1_PSP_AutoSync.txt (Email threading pattern)
 * - M2_Main.txt (runNightlyAllocation function)
 * 
 * GATEWAY ZONE A COLUMN MAP (0-indexed):
 * ┌─────┬──────────────────────────┬─────────────────────────────┐
 * │ Idx │ Gateway Column           │ BigQuery Column             │
 * ├─────┼──────────────────────────┼─────────────────────────────┤
 * │  0  │ UPLOAD_ID                │ UPLOAD_ID                   │
 * │  1  │ UPLOAD_BATCH_ID          │ UPLOAD_BATCH_ID             │
 * │  2  │ WAREHOUSE_ID             │ WAREHOUSE_ID                │
 * │  3  │ RAW_BOM_UPDATE           │ RAW_BOM_UPDATE              │
 * │  4  │ BOM_DESCRIPTION          │ BOM_VIETNAMESE_DESCRIPTION  │
 * │  5  │ INPUT_UNIT_CODE          │ INPUT_UNIT_CODE             │
 * │  6  │ RAW_QTY                  │ RAW_QTY                     │
 * │  7  │ EXTRACTED_SNAPSHOT_DATE  │ EXTRACTED_SNAPSHOT_DATE     │
 * └─────┴──────────────────────────┴─────────────────────────────┘
 * 
 * VERSION: 6.5
 * DATE: February 2026
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const M4_AUTOSYNC_CONFIG = {
  // ─────────────────────────────────────────────────────────────────────────────
  // IDENTITY
  // ─────────────────────────────────────────────────────────────────────────────
  VERSION: '6.5',
  MODULE_ID: 'ISC_M4_STOCK_AUTOSYNC',
  
  // ─────────────────────────────────────────────────────────────────────────────
  // GATEWAY SHEET (Verified: SheetBuilder line 13)
  // ─────────────────────────────────────────────────────────────────────────────
  GATEWAY_SHEET_NAME: 'Stock_AutoSync_Gateway',
  WAKE_CELL: 'Z1',
  
  // ─────────────────────────────────────────────────────────────────────────────
  // DATA MAPPING (Verified: SheetBuilder lines 19-24, 118-121)
  // ─────────────────────────────────────────────────────────────────────────────
  DATE_CELL: 'B2',           // Master date from IMPORTRANGE
  DATA_START_ROW: 8,         // Data starts after headers/dashboard
  TOTAL_COLUMNS: 8,          // Columns A-H
  WAREHOUSE_COL_IDX: 2,      // Column C (0-indexed) for row validation
  
  // ─────────────────────────────────────────────────────────────────────────────
  // TIMING
  // ─────────────────────────────────────────────────────────────────────────────
  TIMEZONE: 'Asia/Ho_Chi_Minh',
  STABILITY_BUFFER_MS: 60000,   // ⚠️ 60 seconds (NOT 6s!)
  WAKE_PROPAGATION_MS: 5000,    // 5 seconds for IMPORTRANGE refresh
  DRIFT_WARNING_DAYS: 30,
  
  // ─────────────────────────────────────────────────────────────────────────────
  // EMAIL (M1 Threading Pattern)
  // ─────────────────────────────────────────────────────────────────────────────
  EMAIL_RECIPIENTS: ['dk@isconline.vn'],
  EMAIL_PREFIX: '[ISC AutoSync] Stock Report',
  EMAIL_LABEL: 'ISC_Logs',
  
  // ─────────────────────────────────────────────────────────────────────────────
  // STATE PERSISTENCE
  // ─────────────────────────────────────────────────────────────────────────────
  PROP_LAST_HASH: 'M4_LAST_COMMITTED_HASH',
  PROP_LAST_DATE: 'M4_LAST_COMMITTED_DATE'
};

// ═══════════════════════════════════════════════════════════════════════════════
// 2. MAIN TRIGGER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ⏰ TRIGGER FUNCTION - Schedule every 5 minutes
 * This script must be BOUND to the M4 Master Spreadsheet.
 */
function trigger_M4StockAutoSync() {
  const LOG_ID = `SYNC_${Date.now()}`;
  console.log(`[${LOG_ID}] 🚀 Starting Stock AutoSync V${M4_AUTOSYNC_CONFIG.VERSION}...`);
  
  try {
    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 1: GET SPREADSHEET
    // ═══════════════════════════════════════════════════════════════════════════
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      throw new Error('BINDING_ERROR: Script must be bound to a spreadsheet.');
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 2: GET OR CREATE GATEWAY SHEET
    // ═══════════════════════════════════════════════════════════════════════════
    let sheet = ss.getSheetByName(M4_AUTOSYNC_CONFIG.GATEWAY_SHEET_NAME);
    
    if (!sheet) {
      console.warn(`[${LOG_ID}] ⚠️ Gateway sheet missing. Attempting auto-heal...`);
      
      // Check if SheetBuilder is available
      if (typeof M4_Stock_AutoSync_SheetBuilder !== 'undefined' &&
          typeof M4_Stock_AutoSync_SheetBuilder.buildGateway === 'function') {
        
        // Build the gateway
        M4_Stock_AutoSync_SheetBuilder.buildGateway();
        
        // ⭐ CRITICAL FIX: Force flush and re-fetch by name
        // The returned sheet reference can become stale after structure changes
        SpreadsheetApp.flush();
        Utilities.sleep(1000);  // Brief pause for propagation
        
        // Re-fetch the sheet by name (this is the key fix!)
        sheet = ss.getSheetByName(M4_AUTOSYNC_CONFIG.GATEWAY_SHEET_NAME);
        
        if (sheet) {
          console.log(`[${LOG_ID}] ✅ Gateway rebuilt and verified.`);
        } else {
          throw new Error('AUTO_HEAL_FAILED: Gateway created but cannot be accessed. Check SheetBuilder.');
        }
      } else {
        throw new Error(`SHEET_MISSING: "${M4_AUTOSYNC_CONFIG.GATEWAY_SHEET_NAME}" not found and SheetBuilder unavailable.`);
      }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 3: WAKE UP IMPORTRANGE
    // ═══════════════════════════════════════════════════════════════════════════
    sheet.getRange(M4_AUTOSYNC_CONFIG.WAKE_CELL).setValue(`POLL_${LOG_ID}`);
    SpreadsheetApp.flush();
    Utilities.sleep(M4_AUTOSYNC_CONFIG.WAKE_PROPAGATION_MS);
    
    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 4: EXECUTE POLLING
    // ═══════════════════════════════════════════════════════════════════════════
    _performPolling(sheet, LOG_ID);
    
  } catch (e) {
    console.error(`[${LOG_ID}] ❌ CRITICAL FAILURE: ${e.message}`);
    _sendNotification('FAILURE', {
      batchId: LOG_ID,
      snapshotDate: 'UNKNOWN',
      error: e.message,
      rowCount: 0,
      m2Status: 'NOT_RUN'
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. CORE POLLING LOGIC
// ═══════════════════════════════════════════════════════════════════════════════

function _performPolling(sheet, batchId) {
  const props = PropertiesService.getScriptProperties();
  const LAST_HASH = props.getProperty(M4_AUTOSYNC_CONFIG.PROP_LAST_HASH);
  
  // ─────────────────────────────────────────────────────────────────────────────
  // PASS 1: Initial Scan
  // ─────────────────────────────────────────────────────────────────────────────
  const scanResult = _scanGateway(sheet, batchId);
  
  if (!scanResult.hasData) {
    console.log(`[${batchId}] 💤 IDLE: Gateway is empty or loading.`);
    return;
  }
  
  if (scanResult.hash === LAST_HASH) {
    console.log(`[${batchId}] 💤 IDLE: No changes detected. Hash: ${scanResult.hash.substring(0, 8)}...`);
    return;
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // CHANGE DETECTED - Enter Stability Buffer
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`[${batchId}] ✨ CHANGE DETECTED! Hash: ${scanResult.hash.substring(0, 8)}... Entering ${M4_AUTOSYNC_CONFIG.STABILITY_BUFFER_MS/1000}s buffer...`);
  Utilities.sleep(M4_AUTOSYNC_CONFIG.STABILITY_BUFFER_MS);
  
  // ─────────────────────────────────────────────────────────────────────────────
  // PASS 2: Verification Scan
  // ─────────────────────────────────────────────────────────────────────────────
  const reScanResult = _scanGateway(sheet, batchId);
  
  if (reScanResult.hash !== scanResult.hash) {
    console.warn(`[${batchId}] ⚠️ UNSTABLE: Data changed during buffer. Aborting.`);
    _sendNotification('UNSTABLE', {
      batchId: batchId,
      snapshotDate: scanResult.dateStr || 'UNKNOWN',
      error: 'Data changed during stability window. Will retry next cycle.',
      rowCount: 0,
      m2Status: 'NOT_RUN'
    });
    return;
  }
  
  console.log(`[${batchId}] ✅ STABLE: Data verified. Proceeding to commit.`);
  
  // ─────────────────────────────────────────────────────────────────────────────
  // DATE VALIDATION
  // ─────────────────────────────────────────────────────────────────────────────
  const dateValidation = _validateSnapshotDate(reScanResult.dateStr, batchId);
  
  if (!dateValidation.isValid) {
    console.error(`[${batchId}] ❌ DATE ERROR: ${dateValidation.error}`);
    _sendNotification('FAILURE', {
      batchId: batchId,
      snapshotDate: reScanResult.dateStr || 'INVALID',
      error: `DATE_ERROR: ${dateValidation.error}`,
      rowCount: 0,
      m2Status: 'NOT_RUN'
    });
    return;
  }
  
  if (dateValidation.warnings && dateValidation.warnings.length > 0) {
    dateValidation.warnings.forEach(w => console.warn(`[${batchId}] ⚠️ ${w}`));
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // COMMIT TO BIGQUERY
  // ─────────────────────────────────────────────────────────────────────────────
  try {
    _commitToBigQuery(reScanResult.cleanRows, dateValidation.dateStr, batchId);
    
    // Update state on success
    props.setProperty(M4_AUTOSYNC_CONFIG.PROP_LAST_HASH, reScanResult.hash);
    props.setProperty(M4_AUTOSYNC_CONFIG.PROP_LAST_DATE, dateValidation.dateStr);
    
    console.log(`[${batchId}] ✅ Committed ${reScanResult.cleanRows.length} rows.`);
    
  } catch (commitError) {
    console.error(`[${batchId}] ❌ COMMIT_FAILED: ${commitError.message}`);
    
    const isCircuitBreaker = commitError.message.includes('CIRCUIT_BREAKER');
    _sendNotification(isCircuitBreaker ? 'CIRCUIT_BREAKER' : 'FAILURE', {
      batchId: batchId,
      snapshotDate: dateValidation.dateStr,
      error: commitError.message,
      rowCount: 0,
      m2Status: 'NOT_RUN'
    });
    return;
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // CHAIN REACTION: M2 Balancing Engine
  // ─────────────────────────────────────────────────────────────────────────────
  let m2Status = 'SKIPPED';
  
  try {
    console.log(`[${batchId}] ⚖️ Triggering M2 Balancing Engine...`);
    
    // Method 1: Direct call (if M2_Main.gs is in same project)
    if (typeof runNightlyAllocation === 'function') {
      runNightlyAllocation('CHAIN');
      m2Status = 'SUCCESS';
      console.log(`[${batchId}] ✅ M2 (direct) completed.`);
    }
    // Method 2: Library call (if M2 is added as library)
    else if (typeof ISC_Module_M2_Balancing !== 'undefined' &&
             typeof ISC_Module_M2_Balancing.runNightlyAllocation === 'function') {
      ISC_Module_M2_Balancing.runNightlyAllocation('CHAIN');
      m2Status = 'SUCCESS';
      console.log(`[${batchId}] ✅ M2 (library) completed.`);
    }
    else {
      m2Status = 'SKIPPED (Module not found)';
      console.warn(`[${batchId}] ⚠️ M2 module not available.`);
    }
    
  } catch (m2Error) {
    m2Status = `FAILED: ${m2Error.message}`;
    console.error(`[${batchId}] ⚠️ M2 Failed: ${m2Error.message}`);
    // Don't throw - M4 upload was successful
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // SUCCESS NOTIFICATION
  // ─────────────────────────────────────────────────────────────────────────────
  _sendNotification('SUCCESS', {
    batchId: batchId,
    snapshotDate: dateValidation.dateStr,
    rowCount: reScanResult.cleanRows.length,
    m2Status: m2Status,
    warnings: dateValidation.warnings
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. GATEWAY SCANNER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Scans the Gateway sheet and extracts data with hash for change detection.
 * 
 * V6.5 FIX: Hash now uses STABLE columns (BOM_UPDATE at index 3) instead of
 * VOLATILE columns (UPLOAD_ID at index 0) to prevent "Midnight Phantom" triggers.
 */
function _scanGateway(sheet, batchId) {
  // ─────────────────────────────────────────────────────────────────────────────
  // EXTRACT DATE FROM B2 (SheetBuilder format: dd-MMM-yyyy, e.g., "02-Feb-2026")
  // ─────────────────────────────────────────────────────────────────────────────
  const rawDateValue = sheet.getRange(M4_AUTOSYNC_CONFIG.DATE_CELL).getValue();
  
  let dateStr = '';
  
  if (rawDateValue instanceof Date && !isNaN(rawDateValue.getTime())) {
    // Native Date object - format to ISO
    dateStr = Utilities.formatDate(rawDateValue, M4_AUTOSYNC_CONFIG.TIMEZONE, 'yyyy-MM-dd');
  } 
  else if (rawDateValue) {
    const rawStr = String(rawDateValue).trim();
    
    // Try native Date parsing first (handles "02-Feb-2026", "2026-02-02", etc.)
    const parsed = new Date(rawStr);
    if (!isNaN(parsed.getTime())) {
      dateStr = Utilities.formatDate(parsed, M4_AUTOSYNC_CONFIG.TIMEZONE, 'yyyy-MM-dd');
    }
    // Fallback: DD-MM format (e.g., "25-01")
    else {
      const ddmmMatch = rawStr.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
      if (ddmmMatch) {
        const day = ddmmMatch[1].padStart(2, '0');
        const month = ddmmMatch[2].padStart(2, '0');
        const year = new Date().getFullYear();
        dateStr = `${year}-${month}-${day}`;
      } else {
        // Keep as-is for validation to catch
        console.warn(`[${batchId}] ⚠️ Unparseable date in B2: "${rawStr}"`);
        dateStr = rawStr;
      }
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // EXTRACT DATA ROWS (From Row 8)
  // ─────────────────────────────────────────────────────────────────────────────
  const lastRow = sheet.getLastRow();
  
  if (lastRow < M4_AUTOSYNC_CONFIG.DATA_START_ROW) {
    return { hasData: false, dateStr: dateStr };
  }
  
  const numRows = lastRow - M4_AUTOSYNC_CONFIG.DATA_START_ROW + 1;
  const range = sheet.getRange(
    M4_AUTOSYNC_CONFIG.DATA_START_ROW,
    1,
    numRows,
    M4_AUTOSYNC_CONFIG.TOTAL_COLUMNS
  );
  const rawValues = range.getValues();
  
  // ─────────────────────────────────────────────────────────────────────────────
  // FILTER VALID ROWS (WAREHOUSE_ID at index 2 must be non-empty)
  // ─────────────────────────────────────────────────────────────────────────────
  const cleanRows = rawValues.filter(row => {
    const warehouseId = row[M4_AUTOSYNC_CONFIG.WAREHOUSE_COL_IDX];
    return warehouseId && String(warehouseId).trim() !== '';
  });
  
  if (cleanRows.length === 0) {
    return { hasData: false, dateStr: dateStr };
  }
  
  // ─────────────────────────────────────────────────────────────────────────────
  // GENERATE HASH (V6.5: STABLE HASH using BOM_UPDATE, not volatile UPLOAD_ID)
  // ─────────────────────────────────────────────────────────────────────────────
  // 🔇 FIX: Uses index [3] (RAW_BOM_UPDATE) instead of index [0] (UPLOAD_ID)
  // This prevents the "Midnight Phantom" trigger when NOW() flips the date.
  
  const firstBom = cleanRows[0] && cleanRows[0][3] ? String(cleanRows[0][3]) : '';
  const lastBom = cleanRows[cleanRows.length - 1] && cleanRows[cleanRows.length - 1][3] ? String(cleanRows[cleanRows.length - 1][3]) : '';
  
  const signature = [
    cleanRows.length,
    dateStr,
    firstBom,
    lastBom
  ].join('|');
  
  const hashBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, signature);
  const hash = hashBytes.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
  
  return {
    hasData: true,
    hash: hash,
    cleanRows: cleanRows,
    dateStr: dateStr
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. DATE VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

function _validateSnapshotDate(dateStr, batchId) {
  const warnings = [];
  
  // Empty check
  if (!dateStr || dateStr.trim() === '') {
    return { isValid: false, error: 'Snapshot date (B2) is empty.' };
  }
  
  // Parse check
  const snapshotDate = new Date(dateStr);
  if (isNaN(snapshotDate.getTime())) {
    return { isValid: false, error: `Cannot parse date: "${dateStr}"` };
  }
  
  snapshotDate.setHours(0, 0, 0, 0);
  
  // Get "today" in Vietnam timezone
  const nowVN = new Date(new Date().toLocaleString('en-US', { timeZone: M4_AUTOSYNC_CONFIG.TIMEZONE }));
  const todayEndVN = new Date(nowVN);
  todayEndVN.setHours(23, 59, 59, 999);
  
  const todayStartVN = new Date(nowVN);
  todayStartVN.setHours(0, 0, 0, 0);
  
  // Future date rejection
  if (snapshotDate > todayEndVN) {
    const todayStr = Utilities.formatDate(todayStartVN, M4_AUTOSYNC_CONFIG.TIMEZONE, 'yyyy-MM-dd');
    return { isValid: false, error: `Future date rejected: "${dateStr}". Today: ${todayStr}` };
  }
  
  // Drift warning
  const ageDays = Math.floor((todayStartVN - snapshotDate) / (1000 * 60 * 60 * 24));
  if (ageDays > M4_AUTOSYNC_CONFIG.DRIFT_WARNING_DAYS) {
    warnings.push(`DATE_DRIFT: Snapshot is ${ageDays} days old.`);
  }
  
  return { isValid: true, dateStr: dateStr, warnings: warnings };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. BIGQUERY COMMIT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Commits data to BigQuery and executes Monday Protocol stored procedures.
 * 
 * V6.5 FIXES:
 * 1. 🛡️ ATOMIC SESSION: Uses batchId for UPLOAD_ID and UPLOAD_BATCH_ID
 * 2. 🌍 UTC TIMESTAMP: Uses GMT to prevent 7-hour timezone drift
 * 
 * Column mapping (verified against SheetBuilder lines 118-121):
 *   row[0] = UPLOAD_ID, row[1] = UPLOAD_BATCH_ID, row[2] = WAREHOUSE_ID
 *   row[3] = RAW_BOM_UPDATE, row[4] = BOM_DESCRIPTION, row[5] = INPUT_UNIT_CODE
 *   row[6] = RAW_QTY, row[7] = EXTRACTED_SNAPSHOT_DATE (ignored, use validatedDateStr)
 */
function _commitToBigQuery(rows, validatedDateStr, batchId) {
  const currentUser = Session.getEffectiveUser().getEmail() || 'AUTOSYNC_BOT';
  
  // 🌍 FIX: Timezone Correction (Force UTC/GMT)
  // Ensures BigQuery stores the exact absolute time, preventing the "7-hour drift".
  const timestamp = Utilities.formatDate(new Date(), 'GMT', 'yyyy-MM-dd HH:mm:ss');
  
  console.log(`[${batchId}] 📦 Preparing CSV for ${rows.length} rows...`);
  
  // ─────────────────────────────────────────────────────────────────────────────
  // BUILD CSV (ATOMIC SESSION PATTERN)
  // ─────────────────────────────────────────────────────────────────────────────
  const csvLines = rows.map((row, idx) => {
    
    // 🛡️ FIX 1: Generate a truly unique UPLOAD_ID per row based on Session ID
    // Format: SYNC_Timestamp_RowIndex (e.g., SYNC_1738580000_00001)
    // This ensures that even if we upload the same BOM twice, the IDs are distinct.
    const atomicUploadId = `${batchId}_${String(idx).padStart(5, '0')}`;
    
    // 🛡️ FIX 2: Force the Batch ID to be the unique Session ID (batchId)
    // This isolates this specific run from any other run on the same day.
    const atomicBatchId = batchId;
    
    // Escape quotes in description
    const description = String(row[4] || '').replace(/"/g, '""');
    
    return [
      `"${atomicUploadId}"`,                    // UPLOAD_ID (Unique)
      `"${atomicBatchId}"`,                     // UPLOAD_BATCH_ID (Unique Session)
      `"${row[2] || ''}"`,                      // WAREHOUSE_ID
      `"${row[3] || ''}"`,                      // RAW_BOM_UPDATE
      `"${description}"`,                       // BOM_VIETNAMESE_DESCRIPTION
      `"${row[5] || ''}"`,                      // INPUT_UNIT_CODE
      Number(row[6]) || 0,                      // RAW_QTY (numeric)
      `"${validatedDateStr}"`,                  // EXTRACTED_SNAPSHOT_DATE
      `"${currentUser}"`,                       // UPLOADED_BY
      `"${timestamp}"`                          // UPLOADED_AT
    ].join(',');
  });
  
  const header = 'UPLOAD_ID,UPLOAD_BATCH_ID,WAREHOUSE_ID,RAW_BOM_UPDATE,BOM_VIETNAMESE_DESCRIPTION,INPUT_UNIT_CODE,RAW_QTY,EXTRACTED_SNAPSHOT_DATE,UPLOADED_BY,UPLOADED_AT';
  const csv = header + '\n' + csvLines.join('\n');
  
  // ─────────────────────────────────────────────────────────────────────────────
  // UPLOAD TO BIGQUERY
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`[${batchId}] 🚚 Uploading to Stock_Count_Upload...`);
  ISC_SCM_Core_Lib.loadCsvData('Stock_Count_Upload', csv, 'WRITE_APPEND');
  
  // ─────────────────────────────────────────────────────────────────────────────
  // EXECUTE MONDAY PROTOCOL (SQL_Vault.txt lines 2305-2434)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log(`[${batchId}] ⚙️ Executing Monday Protocol...`);
  
  const config = ISC_SCM_Core_Lib.getCoreConfig();
  const fqDataset = `${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}`;
  
  console.log(`[${batchId}] → SP_M4_FILTER`);
  ISC_SCM_Core_Lib.runWriteQuery(`CALL \`${fqDataset}.SP_M4_FILTER\`()`);
  
  console.log(`[${batchId}] → SP_M4_VARIANCE_CALC`);
  ISC_SCM_Core_Lib.runWriteQuery(`CALL \`${fqDataset}.SP_M4_VARIANCE_CALC\`()`);
  
  console.log(`[${batchId}] → SP_M4_JANITOR`);
  ISC_SCM_Core_Lib.runWriteQuery(`CALL \`${fqDataset}.SP_M4_JANITOR\`()`);
  
  console.log(`[${batchId}] → SP_M4_RESET_STOCK (Circuit Breaker)`);
  ISC_SCM_Core_Lib.runWriteQuery(`CALL \`${fqDataset}.SP_M4_RESET_STOCK\`()`);
  
  console.log(`[${batchId}] 🏁 Monday Protocol complete.`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. EMAIL NOTIFICATION (M1 Threading + Refined SQL)
// ═══════════════════════════════════════════════════════════════════════════════

function _sendNotification(status, details) {
  try {
    const timeStr = Utilities.formatDate(new Date(), M4_AUTOSYNC_CONFIG.TIMEZONE, 'HH:mm:ss dd/MM/yyyy');
    const monthYear = Utilities.formatDate(new Date(), M4_AUTOSYNC_CONFIG.TIMEZONE, 'MMMM yyyy');
    const subject = `${M4_AUTOSYNC_CONFIG.EMAIL_PREFIX} - ${monthYear}`;
    
    // Status styling
    const statusConfig = {
      'SUCCESS':        { icon: '✅', color: '#34A853', title: 'Success' },
      'FAILURE':        { icon: '⛔', color: '#EA4335', title: 'Failure' },
      'UNSTABLE':       { icon: '⚠️', color: '#F9AB00', title: 'Unstable' },
      'CIRCUIT_BREAKER':{ icon: '🛡️', color: '#9E9E9E', title: 'Circuit Breaker' }
    };
    const cfg = statusConfig[status] || statusConfig['FAILURE'];
    
    // Get BigQuery identifiers
    let projectId = 'PROJECT_ID';
    let datasetId = 'DATASET_ID';
    try {
      const coreConfig = ISC_SCM_Core_Lib.getCoreConfig();
      projectId = coreConfig.connection.PROJECT_ID;
      datasetId = coreConfig.connection.DATASET_ID;
    } catch (e) { /* Ignore */ }
    
    // ─────────────────────────────────────────────────────────────────────────────
    // SQL VERIFICATION QUERIES (Gemini Contribution - Refined)
    // ─────────────────────────────────────────────────────────────────────────────
    const sqlClue = status === 'SUCCESS' ? `
      <div style="margin-top:15px; font-size:11px; color:#555;">
        <strong style="color:#0366d6;">🕵️ Verification Queries</strong>
        
        <div style="margin-top:8px;">
          <strong>1️⃣ Upload Audit (Group by Snapshot Date):</strong>
          <div style="background:#f4f6f8; padding:8px; border-radius:4px; font-family:Consolas,monospace; font-size:10px; margin-top:4px; overflow-x:auto;">
            SELECT UPLOAD_BATCH_ID, COUNT(*) as Num_ROWS, MAX(UPLOADED_AT) as TIME<br>
            FROM \`${projectId}.${datasetId}.Stock_Count_Upload\`<br>
            WHERE EXTRACTED_SNAPSHOT_DATE = '${details.snapshotDate}'<br>
            GROUP BY 1 ORDER BY 3 DESC;
          </div>
        </div>
        
        <div style="margin-top:8px;">
          <strong>2️⃣ Final Stock Data (Top 5 by Qty):</strong>
          <div style="background:#f4f6f8; padding:8px; border-radius:4px; font-family:Consolas,monospace; font-size:10px; margin-top:4px; overflow-x:auto;">
            SELECT BOM_UPDATE, BOM_VIETNAMESE_DESCRIPTION, INVENTORY_QTY<br>
            FROM \`${projectId}.${datasetId}.Stock_Data\`<br>
            WHERE SNAPSHOT_DATE = '${details.snapshotDate}'<br>
            ORDER BY INVENTORY_QTY DESC LIMIT 5;
          </div>
        </div>
      </div>` : '';
    
    // ─────────────────────────────────────────────────────────────────────────────
    // BUILD HTML
    // ─────────────────────────────────────────────────────────────────────────────
    const htmlBody = `
<html>
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #333; }
    .card { border: 1px solid #ddd; border-radius: 8px; max-width: 600px; overflow: hidden; margin-bottom: 20px; }
    .header { background: ${cfg.color}; color: white; padding: 10px 15px; font-weight: bold; }
    .content { padding: 15px; }
    .table { width: 100%; border-collapse: collapse; font-size: 14px; }
    .table td { padding: 6px 0; border-bottom: 1px solid #eee; }
    .table td:first-child { font-weight: bold; color: #555; width: 130px; }
    .error-box { background: #fce8e6; border: 1px solid #f5c6cb; padding: 10px; border-radius: 4px; margin-top: 10px; color: #c5221f; }
    .warning-box { background: #fff3cd; border: 1px solid #ffc107; padding: 10px; border-radius: 4px; margin-top: 10px; color: #856404; }
    .circuit-box { background: #e8f5e9; border: 1px solid #4caf50; padding: 10px; border-radius: 4px; margin-top: 10px; }
    .footer { font-size: 10px; color: #999; margin-top: 15px; padding-top: 10px; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">${cfg.icon} M4 Stock AutoSync: ${cfg.title}</div>
    <div class="content">
      <table class="table">
        <tr><td>Batch ID</td><td>${details.batchId}</td></tr>
        <tr><td>Time (VN)</td><td>${timeStr}</td></tr>
        <tr><td>Snapshot Date</td><td><strong>${details.snapshotDate || 'N/A'}</strong></td></tr>
        ${details.rowCount !== undefined ? `<tr><td>Rows Processed</td><td>${details.rowCount}</td></tr>` : ''}
        ${details.m2Status ? `<tr><td>M2 Reaction</td><td>${details.m2Status}</td></tr>` : ''}
      </table>
      
      ${details.error ? `<div class="error-box"><strong>Error:</strong><br>${details.error}</div>` : ''}
      
      ${status === 'CIRCUIT_BREAKER' ? `
      <div class="circuit-box">
        <strong>🛡️ Circuit Breaker Activated</strong><br>
        Stock_Data has been PROTECTED from wipe.<br>
        Check: Stock_Count_Staging may be empty.
      </div>` : ''}
      
      ${details.warnings && details.warnings.length > 0 ? `
      <div class="warning-box">
        <strong>⚠️ Warnings:</strong><br>
        ${details.warnings.join('<br>')}
      </div>` : ''}
      
      ${sqlClue}
      
      <div class="footer">
        Generated by M4_Stock_AutoSync V${M4_AUTOSYNC_CONFIG.VERSION}
      </div>
    </div>
  </div>
</body>
</html>`;

    // ─────────────────────────────────────────────────────────────────────────────
    // SEND WITH THREADING (M1 Pattern)
    // ─────────────────────────────────────────────────────────────────────────────
    const threads = GmailApp.search(`subject:"${subject}"`);
    let thread = null;
    
    if (threads.length > 0) {
      thread = threads[0];
      thread.reply('', { htmlBody: htmlBody });
      console.log(`[NOTIFY] Replied to existing thread.`);
    } else {
      GmailApp.sendEmail(
        M4_AUTOSYNC_CONFIG.EMAIL_RECIPIENTS.join(','),
        subject,
        '',
        { htmlBody: htmlBody }
      );
      Utilities.sleep(2000);
      const newThreads = GmailApp.search(`subject:"${subject}"`);
      if (newThreads.length > 0) thread = newThreads[0];
      console.log(`[NOTIFY] Created new thread.`);
    }
    
    // Apply label
    if (thread && M4_AUTOSYNC_CONFIG.EMAIL_LABEL) {
      let label = GmailApp.getUserLabelByName(M4_AUTOSYNC_CONFIG.EMAIL_LABEL);
      if (!label) label = GmailApp.createLabel(M4_AUTOSYNC_CONFIG.EMAIL_LABEL);
      label.addToThread(thread);
    }
    
  } catch (e) {
    console.error(`[NOTIFY] Email failed: ${e.message}`);
    try {
      MailApp.sendEmail({
        to: M4_AUTOSYNC_CONFIG.EMAIL_RECIPIENTS[0],
        subject: `${M4_AUTOSYNC_CONFIG.EMAIL_PREFIX} ${status} (Fallback)`,
        body: `Status: ${status}\nBatch: ${details.batchId}\nSnapshot: ${details.snapshotDate}\nError: ${details.error || 'None'}`
      });
    } catch (fallbackErr) {
      console.error(`[NOTIFY] Fallback failed: ${fallbackErr.message}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. ADMIN TOOLS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Installs the 5-minute time-driven trigger.
 */
function admin_InstallAutoSyncTrigger() {
  const ui = SpreadsheetApp.getUi();
  const triggerFunc = 'trigger_M4StockAutoSync';
  
  // Remove existing triggers
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === triggerFunc) {
      ScriptApp.deleteTrigger(t);
    }
  });
  
  try {
    ScriptApp.newTrigger(triggerFunc)
      .timeBased()
      .everyMinutes(5)
      .inTimezone(M4_AUTOSYNC_CONFIG.TIMEZONE)
      .create();
    
    ui.alert(
      '✅ AutoSync Trigger Installed',
      `Function: ${triggerFunc}\nInterval: Every 5 minutes\nTimezone: ${M4_AUTOSYNC_CONFIG.TIMEZONE}\nVersion: ${M4_AUTOSYNC_CONFIG.VERSION}`,
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert('❌ Error', e.message, ui.ButtonSet.OK);
  }
}

/**
 * Removes all AutoSync triggers.
 */
function admin_RemoveAutoSyncTrigger() {
  const triggerFunc = 'trigger_M4StockAutoSync';
  
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === triggerFunc) {
      ScriptApp.deleteTrigger(t);
    }
  });
  
  SpreadsheetApp.getUi().alert('🚫 AutoSync triggers removed.');
}

/**
 * Manual test - runs sync immediately.
 */
function admin_TestAutoSync() {
  trigger_M4StockAutoSync();
}

/**
 * Resets state to force re-sync on next poll.
 */
function admin_ResetState() {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty(M4_AUTOSYNC_CONFIG.PROP_LAST_HASH);
  props.deleteProperty(M4_AUTOSYNC_CONFIG.PROP_LAST_DATE);
  
  SpreadsheetApp.getUi().alert(
    '🔄 State Reset',
    'Committed hash cleared. Next poll will trigger a sync if data exists.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * Shows current state for debugging.
 */
function admin_ShowState() {
  const props = PropertiesService.getScriptProperties();
  const hash = props.getProperty(M4_AUTOSYNC_CONFIG.PROP_LAST_HASH) || '(none)';
  const date = props.getProperty(M4_AUTOSYNC_CONFIG.PROP_LAST_DATE) || '(none)';
  
  SpreadsheetApp.getUi().alert(
    '📊 AutoSync State',
    `Version: ${M4_AUTOSYNC_CONFIG.VERSION}\n` +
    `Gateway: ${M4_AUTOSYNC_CONFIG.GATEWAY_SHEET_NAME}\n` +
    `Last Hash: ${hash.substring(0, 16)}...\n` +
    `Last Date: ${date}`,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * Force rebuilds the Gateway sheet.
 */
function admin_RebuildGateway() {
  const ui = SpreadsheetApp.getUi();
  
  const response = ui.alert(
    '⚠️ Rebuild Gateway?',
    'This will DELETE and REBUILD the Stock_AutoSync_Gateway sheet.\n\nProceed?',
    ui.ButtonSet.YES_NO
  );
  
  if (response !== ui.Button.YES) return;
  
  try {
    if (typeof M4_Stock_AutoSync_SheetBuilder !== 'undefined') {
      M4_Stock_AutoSync_SheetBuilder.buildGateway();
      SpreadsheetApp.flush();
      ui.alert('✅ Gateway rebuilt successfully.');
    } else {
      ui.alert('❌ SheetBuilder not available.');
    }
  } catch (e) {
    ui.alert('❌ Error', e.message, ui.ButtonSet.OK);
  }
}