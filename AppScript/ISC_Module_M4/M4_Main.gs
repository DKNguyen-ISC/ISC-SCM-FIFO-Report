/**
 * 📦 MODULE 4 MAIN: EXECUTION ENGINE (Orchestrator)
 * Version: 3.5 (ATOMIC SESSION EDITION)
 * 
 * RESPONSIBILITIES:
 * 1. UI: Creates the "ISC Module 4" Menu.
 * 2. MONDAY PROTOCOL: Orchestrates the synchronous chain.
 * 3. UPLOAD: Handles the "Trash Bin" ingestion with Atomic Session IDs.
 * 
 * CRITICAL CHANGES (V3.5):
 * 1. 🛡️ ATOMIC SESSION IDs: Replaces Day-Based Batch IDs with Unique Session IDs.
 *    - Prevents data duplication if manual upload is run twice on the same day.
 * 2. 🌍 UTC TIMESTAMPS: Enforces GMT for BigQuery audit trails.
 *    - Prevents 7-hour timezone drift in history logs.
 * 3. 📅 EXTRACTED_SNAPSHOT_DATE: Added support for snapshot date column.
 *    - Aligns with Config_Schema.txt and SP_M4_FILTER requirements.
 */

// =========================================================
// 1. UI & MENUS
// =========================================================

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('📦 Stock Control')
    .addItem('📤 Upload Stock Count', 'runStockUpload')
    .addSeparator()
    .addItem('📅 Run Monday Protocol', 'runMondayProtocol')
    .addSeparator()
    .addSubMenu(ui.createMenu('🔧 Admin Tools')
      .addItem('Re-Build Stock Sheet', 'menu_RebuildStockSheet')
      .addItem('Clear Input Zone', 'menu_ClearInput')
    )
    .addToUi();
  
  createSupplierPortalMenu();
  createInjectionPortalMenu();
  createZXHAutoSyncMenu();
}

function menu_RebuildStockSheet() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Re-Build Sheet?', 'This will DELETE and Re-Create "Stock_Count_Upload". Proceed?', ui.ButtonSet.YES_NO) == ui.Button.YES) {
    M4_SheetBuilder.buildStockCountSheet();
    ui.alert('✅ Sheet Re-Built successfully.');
  }
}

/**
 * 🧹 Dynamic Cleaner
 */
function menu_ClearInput() {
  const sheet = SpreadsheetApp.getActiveSheet();
  if (sheet.getName() !== 'Stock_Count_Upload') {
    SpreadsheetApp.getUi().alert('⚠️ Please run this on "Stock_Count_Upload".');
    return;
  }
  _clearZoneB(sheet);
}

// =========================================================
// 2. STOCK UPLOAD (The Smart "Trash Bin" Loader)
// =========================================================

/**
 * 🔧 V3.5 FIX: Implements Atomic Session Pattern
 * - Each upload gets a unique Session ID (SYNC_timestamp)
 * - Prevents same-day upload duplication
 * - Uses UTC timestamps for BigQuery accuracy
 */
function runStockUpload() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  
  // Generate unique session ID at the start
  const SESSION_ID = `SYNC_${Date.now()}`;
  
  // 1. Validation
  if (sheet.getName() !== 'Stock_Count_Upload') {
    ui.alert('⚠️ Wrong Sheet', 'Please switch to "Stock_Count_Upload".', ui.ButtonSet.OK);
    return;
  }

  // 2. Confirmation
  if (ui.alert('Confirm Upload', 'Push raw counts to BigQuery?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    ui.alert('⚠️ System Busy', 'Try again in a few seconds.', ui.ButtonSet.OK);
    return;
  }

  try {
    // 3. READ HEADERS & BUILD MAP
    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    
    // Map Header Name -> Index (0-based)
    // 🟢 STRATEGY: "First Match Wins" 
    // This ensures we map to Zone A (Left side) and ignore duplicates in Zone B.
    const colMap = {};
    headers.forEach((h, i) => {
      const key = h.toString().trim();
      if (key !== "" && !(key in colMap)) {
        colMap[key] = i;
      }
    });

    // Verify Critical Columns exist
    // Note: We don't check UPLOADED_AT anymore because we generate it ourselves.
    const CRITICAL_COLS = ['UPLOAD_ID', 'RAW_BOM_UPDATE', 'RAW_START', 'RAW_QTY', 'UPLOADED_BY'];
    const missingCols = CRITICAL_COLS.filter(c => colMap[c] === undefined);
    
    if (missingCols.length > 0) {
      throw new Error(`Critical Columns Missing: ${missingCols.join(', ')}. Please Rebuild Sheet.`);
    }

    // 4. READ ZONE A DATA
    // We read up to the 'RAW_START' pillar.
    const rawStartIndex = colMap['RAW_START']; // This is the column index of the pillar
    const lastRow = sheet.getLastRow();
    
    if (lastRow < 2) throw new Error("Sheet is empty.");
    
    // Get all data in Zone A (Rows 2 to End, Cols 1 to RAW_START)
    const data = sheet.getRange(2, 1, lastRow - 1, rawStartIndex).getValues();

    // 5. FILTER: BOM-ONLY Logic
    // We ONLY reject rows where BOM_UPDATE is missing. Empty QTY is allowed (NULL).
    const bomIdx = colMap['RAW_BOM_UPDATE'];
    
    const validRows = data.filter(r => {
      const bom = r[bomIdx];
      // Check if BOM exists and is not just whitespace
      return bom && String(bom).trim() !== "";
    });

    if (validRows.length === 0) throw new Error("No valid data found (Check BOM_UPDATE column in Zone A).");

    // 6. TRANSFORM & CSV GENERATION
    const currentUser = Session.getActiveUser().getEmail();
    
    // 🌍 FIX: UTC TIMESTAMP (V3.5)
    // Ensures BigQuery stores the exact absolute time, preventing the "7-hour drift".
    const scriptTimestamp = Utilities.formatDate(new Date(), 'GMT', "yyyy-MM-dd HH:mm:ss");
    
    // 📅 SNAPSHOT DATE: Try to get from sheet, fallback to today
    // Check if there's a designated snapshot date cell (e.g., a header area)
    // For manual upload, we'll use today's date as the snapshot date
    const snapshotDate = Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', "yyyy-MM-dd");
    
    // Helper to extract by name
    const getVal = (row, name) => colMap[name] !== undefined ? row[colMap[name]] : null;

    const csvLines = validRows.map((row, idx) => {
      
      // ═══════════════════════════════════════════════════════════════════════════
      // 🛡️ FIX 1: ATOMIC UPLOAD_ID (V3.5)
      // ═══════════════════════════════════════════════════════════════════════════
      // OLD: Used Sheet formula which was day-scoped, or fallback to UUID
      // NEW: Use session ID + row index for guaranteed uniqueness
      const atomicUploadId = `${SESSION_ID}_${String(idx).padStart(5, '0')}`;

      // ═══════════════════════════════════════════════════════════════════════════
      // 🛡️ FIX 2: ATOMIC BATCH_ID (V3.5)
      // ═══════════════════════════════════════════════════════════════════════════
      // OLD: BATCH_YYYYMMDD (day-scoped, caused duplication on same-day re-uploads)
      // NEW: Use session ID for guaranteed uniqueness
      const atomicBatchId = SESSION_ID;

      // C. TIMESTAMP PROTOCOL (Overridden)
      // We completely ignore getVal(row, 'UPLOADED_AT')
      const tStamp = scriptTimestamp; 

      // D. CONSTRUCT ROW (Strict Schema Order - V3.5 includes EXTRACTED_SNAPSHOT_DATE)
      const orderedRow = [
        atomicUploadId,                              // UPLOAD_ID (Atomic)
        atomicBatchId,                               // UPLOAD_BATCH_ID (Atomic)
        getVal(row, 'WAREHOUSE_ID'),                 // WAREHOUSE_ID
        getVal(row, 'RAW_BOM_UPDATE'),               // RAW_BOM_UPDATE
        getVal(row, 'BOM_VIETNAMESE_DESCRIPTION'),   // BOM_VIETNAMESE_DESCRIPTION
        getVal(row, 'INPUT_UNIT_CODE'),              // INPUT_UNIT_CODE
        getVal(row, 'RAW_QTY'),                      // RAW_QTY
        snapshotDate,                                // EXTRACTED_SNAPSHOT_DATE (V3.5 NEW)
        currentUser,                                 // UPLOADED_BY (Strict Override)
        tStamp                                       // UPLOADED_AT (Strict Override)
      ];

      // E. CSV FORMATTING
      return orderedRow.map((cell, cellIdx) => {
         if (cell === null || cell === undefined) return "";
         // RAW_QTY (index 6) should be numeric, not quoted
         if (cellIdx === 6) {
           const numVal = Number(cell);
           return isNaN(numVal) ? 0 : numVal;
         }
         return `"${String(cell).replace(/"/g, '""')}"`;
      }).join(",");
    });

    const csvContent = csvLines.join("\n");

    // 7. UPLOAD TO BIGQUERY
    // 📅 V3.5: Updated header to include EXTRACTED_SNAPSHOT_DATE
    const headerString = "UPLOAD_ID,UPLOAD_BATCH_ID,WAREHOUSE_ID,RAW_BOM_UPDATE,BOM_VIETNAMESE_DESCRIPTION,INPUT_UNIT_CODE,RAW_QTY,EXTRACTED_SNAPSHOT_DATE,UPLOADED_BY,UPLOADED_AT";
    const finalCsv = headerString + "\n" + csvContent;
    
    ISC_SCM_Core_Lib.loadCsvData('Stock_Count_Upload', finalCsv, 'WRITE_APPEND');

    // 8. CLEANUP ZONE B
    _clearZoneB(sheet);
    
    SpreadsheetApp.flush();
    
    console.log(`[${SESSION_ID}] ✅ Manual upload completed: ${validRows.length} rows`);
    
    ui.alert('✅ Upload Successful', 
      `Session: ${SESSION_ID}\n` +
      `Uploaded ${validRows.length} rows to the Trash Bin.\n\n` +
      `Note: Run "Monday Protocol" to process into Stock_Data.`, 
      ui.ButtonSet.OK);

  } catch (e) {
    console.error(e);
    ui.alert('❌ Upload Failed', e.message, ui.ButtonSet.OK);
  } finally {
    lock.releaseLock();
  }
}

// =========================================================
// 🔒 PRIVATE HELPERS
// =========================================================

/**
 * Robust Zone B Cleaner (Fixed Width)
 * Finds columns between "RAW_START" and "RAW_END" and clears them.
 */
function _clearZoneB(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  // 1. Find the Pillars
  const rawStartIndex = headers.indexOf('RAW_START');
  const rawEndIndex = headers.indexOf('RAW_END');
  
  if (rawStartIndex === -1 || rawEndIndex === -1 || rawEndIndex <= rawStartIndex) return;

  // 2. Calculate Range
  // Width = End Index - Start Index - 1
  const width = rawEndIndex - rawStartIndex - 1;
  const DATA_START_ROW = 3; // Based on SheetBuilder v4.0

  if (width > 0) {
    const lastRow = sheet.getMaxRows();
    if (lastRow >= DATA_START_ROW) {
       sheet.getRange(DATA_START_ROW, rawStartIndex + 2, lastRow - DATA_START_ROW + 1, width).clearContent();
    }
  }
}

// =========================================================
// 3. THE MONDAY PROTOCOL (Synchronous Chain)
// =========================================================

function runMondayProtocol() {
  const ui = SpreadsheetApp.getUi();
  const config = ISC_SCM_Core_Lib.getCoreConfig();

  if (ui.alert('🚨 RUN MONDAY PROTOCOL?', 'This will RESET Inventory Truth. Proceed?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    
    spreadsheet.toast('Step 1/4: Aggregating Trash Bin...', 'ISC Engine');
    ISC_SCM_Core_Lib.runWriteQuery(`CALL \`${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}.SP_M4_FILTER\`()`);
    
    spreadsheet.toast('Step 2/4: Calculating Variance...', 'ISC Engine');
    ISC_SCM_Core_Lib.runWriteQuery(`CALL \`${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}.SP_M4_VARIANCE_CALC\`()`);
    
    spreadsheet.toast('Step 3/4: Closing Old POs...', 'ISC Engine');
    ISC_SCM_Core_Lib.runWriteQuery(`CALL \`${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}.SP_M4_JANITOR\`()`);
    
    spreadsheet.toast('Step 4/4: Resetting Stock Data...', 'ISC Engine');
    ISC_SCM_Core_Lib.runWriteQuery(`CALL \`${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}.SP_M4_RESET_STOCK\`()`);

    ui.alert('✅ Monday Protocol Complete', 'Inventory has been synchronized.', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('❌ Failed', e.message, ui.ButtonSet.OK);
  }
}