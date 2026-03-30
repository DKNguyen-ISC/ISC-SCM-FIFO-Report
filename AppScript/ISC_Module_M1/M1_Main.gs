/**
 * 📦 MODULE 1 MAIN: PLANNING ENGINE (Orchestrator)
 * * RESPONSIBILITIES:
 * 1. UI: Creates the "SCM Tool" Menu.
 * 2. DISPATCHER: Identifies the Active Sheet and routes to the correct BQ Table.
 * 3. WORKER: Reads Zone A (Clean), Pushes to BQ, Clears Zone B (Raw).
 * 4. 🆕 FLIGHT RECORDER: Sends Push Reports to Admin/Developer.
 * * DEPENDENCIES:
 * - ISC_SCM_Core_Lib (BigQueryClient, Config)
 * - M1_Config (getLocalManifest, getPushNotificationConfig)
 * * ✅ VERSION 5.2 - FLIGHT RECORDER EDITION (Schema-Aligned SQL)
 */

// =========================================================
// 1. CONFIGURATION & PERMISSIONS
// =========================================================

// 🔒 Security: List of emails allowed to run Admin tools
const ADMIN_USERS = [
  'admin@isc-stationery.com', 
  'dk@isconline.vn',                  
  Session.getActiveUser().getEmail()  // Auto-include current dev
];

/**
 * 🗺️ LOGIC MAP
 * Defines which SQL Procedure triggers after a successful upload.
 * Key: Sheet Name -> Value: Stored Procedure Name (in BigQuery)
 */
const POST_UPLOAD_TRIGGERS = {
  // When Line Items are uploaded, run the Split Batch Gate
  'BOM_Order_List_Draft': 'SP_SPLIT_BATCH_GATE',
  
  // FIX: Headers must ALSO trigger the Gate now!
  'Production_Order_Draft': 'SP_SPLIT_BATCH_GATE',
  
  // [CHANGED] Now triggers the Merge Logic immediately after upload
  'BOM_Data_Staging': 'SP_M1_MASTER_MERGE' 
};

// =========================================================
// 2. UI & MENUS
// =========================================================

/**
 * 🚀 MAIN TRIGGER: Builds the Custom Menu on File Open
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const userEmail = Session.getActiveUser().getEmail();
  const ADMIN_USERS = ['dk@isconline.vn']; 

  // --- A. Error Tools SubMenu ---
  const errorMenu = ui.createMenu('⚠️ Error Tools')
    .addItem('💡 Highlight Last Errors', 'highlightErrorRowsFromStorage') 
    .addSeparator()
    .addItem('🎨 Clear Highlighting', 'clearHighlighting');

  // --- B. Main ISC Menu ---
  ui.createMenu('📝 ISC Menu')
    .addItem('🚀 Push Data to BigQuery', 'runActiveSheetPush')
    .addItem('🧹 Clear Raw Data', 'runClearSheet')
    .addSeparator()
    .addItem('📥 Fetch Pending Skeletons', 'menu_FetchSkeletons') 
    .addSeparator()
    .addSubMenu(errorMenu)
    .addToUi();

  // --- C. Sync Tools ---
  ui.createMenu('🔄 Sync Tools')
    .addItem('🔧 Re-Build Current Sheet', 'menu_RebuildCurrentSheet')
    .addItem('🏗️ Re-Build ALL Sheets (Admin)', 'menu_RebuildAllSheets')
    .addToUi();

  // --- D. Admin Menu (Secured) ---
  if (ADMIN_USERS.includes(userEmail)) {
    ui.createMenu('⚙️ Admin')
      .addItem('📡 Test Connection', 'admin_TestConnection')
      .addItem('📊 PSP Migration Check', 'menu_M1_PSP_CheckMigration') 
      .addToUi();
  }

  // --- E. PSP Menu Integration ---
  if (typeof addPSPMenu === 'function') {
    addPSPMenu(ui);
  } else if (typeof M1_PSP_Main !== 'undefined' && M1_PSP_Main.registerMenu) {
    M1_PSP_Main.registerMenu();
  } else {
    console.warn("⚠️ Warning: PSP Menu function not found.");
  }

  // --- F. Order Cancellation Admin Console ---
  if (typeof registerCancelAdminMenu === 'function') {
    registerCancelAdminMenu();
  }

  // 🟢 G. NEW: CS STATUS MONITOR (V9.2 Decoupled)
  // Calls the registration function we just added to M1_CS_Status_Main.gs
  if (typeof addCSMonitorMenu === 'function') {
    addCSMonitorMenu();
  } else {
    console.warn("⚠️ Warning: CS Monitor Menu function not found. Check M1_CS_Status_Main.gs");
  }
}

// =========================================================
// 3. THE DISPATCHER (Controller)
// =========================================================

/**
 * 🚀 MAIN ENTRY POINT
 * Identifies the Active Sheet and attempts to push Zone A to BigQuery.
 * 🆕 V5.1: Now includes Flight Recorder integration.
 */
function runActiveSheetPush() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  const sheetName = sheet.getName();

  // 1. Validation: Is this a mapped system sheet?
  const coreConfig = ISC_SCM_Core_Lib.getCoreConfig();
  if (!coreConfig.tables[sheetName]) {
    ui.alert('⚠️ Unknown Sheet', 
      `The sheet "${sheetName}" is not mapped in the System Configuration.\n` +
      `Please switch to a valid Input Sheet (e.g., Production_Order_Draft).`, 
      ui.ButtonSet.OK);
    return;
  }

  // 2. Confirmation
  const response = ui.alert(
    `🚀 Confirm Upload: ${sheetName}`,
    'Are you sure you want to push this data to BigQuery?\n\n' +
    '• Zone A (Clean Data) will be uploaded.\n' +
    '• Zone B (Raw Input) will be CLEARED upon success.\n' +
    '• System Logic (Splitting/Validation) will run immediately.',
    ui.ButtonSet.YES_NO
  );
  if (response !== ui.Button.YES) return;

  // 3. Capture User Context (for Flight Recorder)
  const userEmail = Session.getActiveUser().getEmail();
  const pushTimestamp = new Date();

  // 4. Execution (The "Delivery Guy" Work)
  try {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) throw new Error("System is busy. Try again.");
    
    // --- CALL THE WORKER (Part 2) ---
    const result = _processSheetUpload(sheet, sheetName, coreConfig);

    // --- 🆕 FLIGHT RECORDER: Send Push Report (Silent, Non-Blocking) ---
    try {
      _sendPushReport(result, sheetName, userEmail, pushTimestamp);
    } catch (reportErr) {
      // Flight Recorder errors should NOT block the main flow
      console.error(`[Flight Recorder] Failed to send report: ${reportErr.message}`);
    }

    // --- SMART ALERT LOGIC ---
    if (result.failed > 0) {
      // ⚠️ CASE A: PARTIAL FAILURE (Yellow Alert)
      ui.alert('⚠️ Upload Complete (With Failures)', 
        `Uploaded: ${result.uploaded} rows.\n` +
        `❌ REJECTED: ${result.failed} rows failed validation.\n\n` +
        `Action: Check the 'Validation Debugger' report or fetch skeletons to define missing items.`, 
        ui.ButtonSet.OK);
    } else {
      // ✅ CASE B: CLEAN SUCCESS (Green Alert)
      ui.alert('✅ Upload Successful', 
        `Uploaded ${result.uploaded} rows from ${sheetName}.\n` +
        `All lines passed validation.\n` +
        `Zone B has been cleared.`, 
        ui.ButtonSet.OK);
    }

  } catch (e) {
    console.error(e);
    ui.alert('❌ Upload Failed', e.message, ui.ButtonSet.OK);
  } finally {
    LockService.getScriptLock().releaseLock();
  }
}

/**
 * 🧹 Helper: Clear Raw Data Button
 */
function runClearSheet() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  
  if (ui.alert('Clear Input?', 'This will wipe all data in Zone B (Blue). Proceed?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  try {
    _clearZoneB(sheet); // Defined in Part 2
    
    // 🛡️ FIX: Reset cursor to Row 3 (Data Start) instead of A1
    sheet.getRange(3, 1).activate(); 
    
  } catch (e) {
    ui.alert('Error: ' + e.message);
  }
}

// =========================================================
// 🔄 SYNC TOOLS (Rebuild Logic)
// =========================================================

/**
 * 🔧 Rebuild Current Sheet
 * Now smarter: Fetches the 'Blueprint' from Config before calling Builder.
 * Includes Safety Check for Schema Definition.
 */
function menu_RebuildCurrentSheet() { 
  const sheetName = SpreadsheetApp.getActiveSheet().getName();
  console.time(`Build_${sheetName}`); 
  
  // 1. Fetch the Manifest
  const manifest = getLocalManifest();
  
  // Safety: Ensure manifest exists
  if (!manifest) {
    SpreadsheetApp.getUi().alert("❌ Critical Error: M1_Config not found or invalid.");
    return;
  }
  
  // 2. Find the Blueprint (Safely)
  const blueprint = (manifest.SHEET_BLUEPRINTS) 
                    ? manifest.SHEET_BLUEPRINTS[sheetName] 
                    : null;

  // 3. Pre-flight Check: Ensure Core Config is valid
  // This catches the 'undefined' error before crashing the builder
  try {
    const coreConfig = ISC_SCM_Core_Lib.getCoreConfig();
    const allSchemas = coreConfig.schemas || coreConfig.TABLE_SCHEMAS; // 🛡️ Robust Check
    
    if (!allSchemas) throw new Error("Schema Configuration is missing.");
    if (!allSchemas[sheetName]) throw new Error(`Schema for '${sheetName}' is not defined.`);
    
  } catch (e) {
    SpreadsheetApp.getUi().alert(`❌ Config Error: ${e.message}`);
    return;
  }

  // 4. Call the Builder
  M1_SheetBuilder.buildInputSheet(sheetName, blueprint); 
  console.timeEnd(`Build_${sheetName}`);
}

/**
 * 🏗️ Rebuild ALL Sheets
 */
function menu_RebuildAllSheets() { 
  M1_SheetBuilder.buildAllTables();
}

// =========================================================
// 4. THE WORKER (Heavy Lifting)
// =========================================================

/**
 * ⚙️ PROCESS UPLOAD
 * Reads Zone A, converts to CSV, uploads to BQ, runs Triggers, clears Zone B.
 * 🆕 V5.1: Now extracts Touch List for Flight Recorder.
 */
function _processSheetUpload(sheet, sheetName, coreConfig) {
  // A. GEOMETRY: Find where Zone A ends and Zone B begins
  const bounds = _findZoneBoundaries(sheet);
  if (!bounds.rawStartCol) throw new Error("Critical: Column 'RAW_START' not found. Re-build sheet.");

  // B. READ ZONE A (The Clean Data)
  const lastRow = sheet.getLastRow();
  
  // 🛡️ FIX 1: Start reading from Row 3 (Skipping Header + Ghost Row)
  if (lastRow < 3) throw new Error("Sheet is empty (No data in Row 3+).");
  
  const zoneA_Width = bounds.rawStartCol - 1;
  
  // 1. Fetch Headers (Row 1) - Preserved
  const headers = sheet.getRange(1, 1, 1, zoneA_Width).getValues()[0];
  
  // 2. Fetch Data (Row 3 -> End)
  // Calculate correct height: Total - 2 (Header + Ghost)
  const numDataRows = lastRow - 2; 
  const dataRange = sheet.getRange(3, 1, numDataRows, zoneA_Width);
  const rawValues = dataRange.getValues();
  
  // C. TRANSFORM TO CSV
  // We filter out completely empty rows to prevent uploading NULLs
  const cleanRows = rawValues.filter(row => row.some(cell => cell !== ""));
  if (cleanRows.length === 0) throw new Error("No valid data found in Zone A.");

  // 🆕 C2. EXTRACT TOUCH LIST (For Flight Recorder)
  const touchList = _extractTouchList(cleanRows, sheetName, headers);

  // FIX 1: Prepend headers to the data array
  const csvString = _convertToCSV([headers, ...cleanRows]);

  // D. LOAD TO BIGQUERY
  Logger.log(`📤 Uploading ${cleanRows.length} rows to ${sheetName}...`);
  ISC_SCM_Core_Lib.loadCsvData(sheetName, csvString, 'WRITE_APPEND');

  // E. RUN POST-UPLOAD TRIGGER (The Brain)
  const triggerProc = POST_UPLOAD_TRIGGERS[sheetName];
  if (triggerProc) {
    Logger.log(`🧠 Triggering Logic: ${triggerProc}...`);
    // 1. Capture User Email
    const userEmail = Session.getActiveUser().getEmail();
    // 2. Pass it to the Stored Procedure
    const sql = `CALL \`${coreConfig.connection.PROJECT_ID}.${coreConfig.connection.DATASET_ID}.${triggerProc}\`('${userEmail}')`;
    ISC_SCM_Core_Lib.runWriteQuery(sql);
  } else {
    Logger.log(`ℹ️ No post-upload trigger defined for ${sheetName}. Upload only.`);
  }

  // --- NEW: CHECK FOR FAILURES ---
  let failureCount = 0;
  // Only check for failures if we just ran the Split Batch Gate on Lines
  if (sheetName === 'BOM_Order_List_Draft') {
    failureCount = _countRecentFailures(coreConfig);
  }

  // F. CLEANUP (Zone B)
  _clearZoneB(sheet, bounds);

  // ✅ FIX: Force UI Update
  SpreadsheetApp.flush();
  
  // Return an object with all data for Flight Recorder
  return { 
    uploaded: cleanRows.length, 
    failed: failureCount,
    touchList: touchList  // 🆕 Added for Flight Recorder
  };
}

/**
 * 🧹 CLEANUP HELPER
 * Clears the "Paste Bin" (Zone B) to enforce Transient Form logic.
 * 🛡️ UPGRADED: Now clears starting from Row 3 (Preserves Ghost Row)
 */
function _clearZoneB(sheet, preCalcBounds = null) {
  const bounds = preCalcBounds || _findZoneBoundaries(sheet);
  
  if (!bounds.rawStartCol || !bounds.rawEndCol) return;
  
  const startCol = bounds.rawStartCol + 1;
  const width = bounds.rawEndCol - startCol;
  
  // 🛡️ FIX: Start clearing at Row 3
  const maxRows = sheet.getMaxRows();
  
  if (width > 0 && maxRows > 2) {
    // Clear from Row 3 to End
    sheet.getRange(3, startCol, maxRows - 2, width).clearContent();
  }
}

// =========================================================
// 5. UTILITIES & PARSERS
// =========================================================

/**
 * 📐 GEOMETRY FINDER
 * Scans Row 1 to find the black pillars (RAW_START / RAW_END).
 */
function _findZoneBoundaries(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const config = ISC_SCM_Core_Lib.getCoreConfig().layouts.DEFAULT;
  return {
    rawStartCol: headers.indexOf(config.startDelimiterHeader) + 1, // 1-based index
    rawEndCol: headers.indexOf(config.endDelimiterHeader) + 1
  };
}

/**
 * 📄 CSV CONVERTER
 * transforms 2D array into BigQuery-compatible CSV string.
 * Handles Dates and escaping quotes.
 */
function _convertToCSV(rows) {
  return rows.map(row => row.map(cell => {
    // FIX 2: Handle Empty Strings properly
    if (cell === "" || cell === null || cell === undefined) {
      return ''; 
    }

    // 1. Handle Dates (JS Date -> YYYY-MM-DD HH:mm:ss)
    if (cell instanceof Date) {
      return Utilities.formatDate(cell, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    }
  
    // 2. Handle Strings (Escape quotes)
    if (typeof cell === 'string') {
      return `"${cell.replace(/"/g, '""')}"`; 
    }
    
    return cell;
  }).join(",")).join("\n");
}

/**
 * 🕵️ FAILURE DETECTOR
 * Checks if the Logic Gate rejected any rows in the last minute.
 */
function _countRecentFailures(coreConfig) {
  // Query the Staging Log for 'FAIL' status created just now
  const sql = `
    SELECT COUNT(*) as cnt 
    FROM \`${coreConfig.connection.PROJECT_ID}.${coreConfig.connection.DATASET_ID}.BOM_Order_List_Staging\` 
    WHERE VALIDATION_STATUS = 'FAIL' 
      AND UPLOADED_AT > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 MINUTE)
  `;
  // Execute Read
  const rows = ISC_SCM_Core_Lib.runReadQueryMapped(sql);
  return rows.length > 0 ? parseInt(rows[0].cnt) : 0;
}

// =========================================================
// 👇 FETCH LOGIC (Part 2)
// =========================================================

/**
 * 📥 MENU ACTION: Fetch Skeletons
 * Wrapper to ensure safety checks before running the worker.
 */
function menu_FetchSkeletons() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const ui = SpreadsheetApp.getUi();

  // 1. Safety Check: Wrong Sheet
  if (sheet.getName() !== 'BOM_Data_Staging') {
    ui.alert("⚠️ Wrong Sheet", 
      "This feature only works on the 'BOM_Data_Staging' sheet.\n\nPlease switch tabs and try again.", 
      ui.ButtonSet.OK);
    return;
  }

  // 2. Confirmation (Since we are about to clear data)
  const response = ui.alert(
    '📥 Fetch Skeletons?',
    'This will CLEAR the current Blue Zone (Zone B) and load pending items from the system.\n\nAre you sure?',
    ui.ButtonSet.YES_NO
  );
  if (response === ui.Button.YES) {
    fetchPendingSkeletons();
  }
}

/**
 * ⚙️ WORKER: Fetch Pending Skeletons
 * Reads 'View_Skeleton_Feed' and populates Zone B using "Golden Naming" matching.
 */
function fetchPendingSkeletons() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const ui = SpreadsheetApp.getUi();
  const lock = LockService.getScriptLock();

  // 1. Lock & Load (Prevent collision with Pushes)
  if (!lock.tryLock(10000)) {
    ui.alert("⚠️ System Busy", "Another process is running. Please wait.", ui.ButtonSet.OK);
    return;
  }

  try {
    // 2. Geometry: Reuse existing helper to find Zone B
    const bounds = _findZoneBoundaries(sheet);
    if (!bounds.rawStartCol) throw new Error("Critical: 'RAW_START' column missing. Please Re-build Sheet.");

    // 3. Clear Zone B First (Clean Slate)
    // 🛡️ FIX: Updated to clear from Row 3
    _clearZoneB(sheet, bounds);

    // 4. Fetch Data from BigQuery
    const config = ISC_SCM_Core_Lib.getCoreConfig();
    const sql = `SELECT * FROM \`${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}.View_Skeleton_Feed\``;
    
    // Use the Library's mapper to get clean JSON objects
    const bqData = ISC_SCM_Core_Lib.runReadQueryMapped(sql);

    if (!bqData || bqData.length === 0) {
      // Async UI Pattern: Flush -> Release -> Alert
      SpreadsheetApp.flush();
      lock.releaseLock();
      ui.alert("✅ Good News", "No pending skeletons found. Your Master Data is clean!", ui.ButtonSet.OK);
      return;
    }

    // 5. THE MATCHING LOGIC (The Smart Part) 🧠
    // We map BQ columns to Sheet Headers dynamically.
    const startCol = bounds.rawStartCol + 1;
    const endCol = bounds.rawEndCol - 1;
    const numCols = endCol - startCol + 1;
    
    // Get Sheet Headers from Zone B (Row 1)
    const sheetHeaders = sheet.getRange(1, startCol, 1, numCols).getValues()[0];
    
    // Transform BQ Objects -> 2D Array aligned with Sheet Headers
    const outputGrid = bqData.map(rowObj => {
      return sheetHeaders.map(header => {
        // Golden Naming Rule: Sheet Header must match BQ Column Name
        return rowObj[header] || ""; 
      });
    });

    // 6. Write to Sheet
    // 🛡️ FIX: Start writing at Row 3 (Skipping Ghost Row)
    if (outputGrid.length > 0) {
      sheet.getRange(3, startCol, outputGrid.length, outputGrid[0].length).setValues(outputGrid);
    }

    // 7. Async UI Fix (Release -> Repaint -> Alert)
    SpreadsheetApp.flush();
    lock.releaseLock();
    
    // 🛡️ FIX: Focus cursor on Row 3
    sheet.getRange(3, startCol).activate(); 
    
    ui.alert("✅ Fetch Complete", `Loaded ${outputGrid.length} skeletons.\n\n1. Review the auto-filled columns (PIC, Group).\n2. Fill in remaining details.\n3. Click 'Push Data' to merge.`, ui.ButtonSet.OK);

  } catch (e) {
    console.error(e);
    ui.alert("❌ Fetch Failed", e.message, ui.ButtonSet.OK);
  } finally {
    // Always release the lock
    lock.releaseLock();
  }
}

// =========================================================
// 🆕 6. FLIGHT RECORDER (Push Report System)
// =========================================================

/**
 * 🆕 TOUCH LIST EXTRACTOR (Dynamic Header Lookup)
 * Extracts key identifiers from uploaded rows for Flight Recorder summary.
 * Uses TOUCH_LIST_KEYS configuration from M1_Config.
 * 
 * 🛡️ RESILIENCE: Uses header NAMES (not indices) so column reordering
 * in Zone A won't break the extraction logic.
 * 
 * @param {Array<Array>} cleanRows - The uploaded data rows (2D array)
 * @param {string} sheetName - The sheet being uploaded
 * @param {Array<string>} headers - The Zone A headers (Row 1)
 * @returns {Array<Object>} - Array of objects with key identifiers
 */
function _extractTouchList(cleanRows, sheetName, headers) {
  const touchList = [];
  
  // Safety: Get config
  let config = null;
  try {
    config = getPushNotificationConfig();
  } catch (e) {
    console.warn('[Flight Recorder] getPushNotificationConfig not available');
    return touchList;
  }
  
  if (!config || !config.TOUCH_LIST_KEYS || !config.TOUCH_LIST_KEYS[sheetName]) {
    // No touch list config for this sheet, return empty
    return touchList;
  }
  
  const keyDefs = config.TOUCH_LIST_KEYS[sheetName];
  
  // 🧠 PRE-CALCULATE INDICES (Dynamic Header Lookup)
  // Map header names to actual column positions in the current sheet layout.
  // This makes the system resilient to column reordering.
  const activeKeys = keyDefs.map(def => ({
    label: def.label,
    index: headers.indexOf(def.header)  // Dynamic lookup by header name
  })).filter(k => k.index !== -1);  // Filter out headers that weren't found
  
  // If no valid keys found, return empty
  if (activeKeys.length === 0) {
    console.warn(`[Flight Recorder] No matching headers found for ${sheetName}. Check TOUCH_LIST_KEYS config.`);
    return touchList;
  }
  
  // Extract keys from each row
  cleanRows.forEach((row, rowIdx) => {
    const touchItem = {};
    let hasValue = false;
    
    activeKeys.forEach(key => {
      let value = row[key.index];  // Use the dynamically looked-up index
      
      // Convert to string and handle various types
      if (value === null || value === undefined) {
        value = '';
      } else if (value instanceof Date) {
        // Format dates nicely
        value = Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
      } else {
        value = String(value).trim();
      }
      
      // Truncate if too long (prevent huge emails)
      if (value.length > 50) {
        value = value.substring(0, 47) + '...';
      }
      
      if (value !== '') {
        hasValue = true;
      }
      
      touchItem[key.label] = value;
    });
    
    // Only add if we have at least one non-empty key
    if (hasValue) {
      touchList.push(touchItem);
    }
  });
  
  return touchList;
}

/**
 * 🆕 FLIGHT RECORDER: Send Push Report Email
 * Implements "Send, Hunt, & Label" Logic with Card UI.
 * Inherited patterns from M1_PSP_AutoSync and M1_Cancel_Main.
 * 
 * @param {Object} result - { uploaded, failed, touchList }
 * @param {string} sheetName - The sheet that was uploaded
 * @param {string} userEmail - The user who triggered the push
 * @param {Date} pushTimestamp - When the push was initiated
 */
function _sendPushReport(result, sheetName, userEmail, pushTimestamp) {
  // 1. Get Configuration
  let config = null;
  try {
    config = getPushNotificationConfig();
  } catch (e) {
    console.warn('[Flight Recorder] Config not available, skipping report');
    return;
  }
  
  // Check Feature Flag
  if (!config || !config.ENABLE_EMAILS) {
    console.log('[Flight Recorder] Email notifications disabled');
    return;
  }
  
  // Don't send if nothing was uploaded
  if (!result || result.uploaded === 0) {
    console.log('[Flight Recorder] No rows uploaded, skipping report');
    return;
  }
  
  try {
    // 2. Gather Context
    const coreConfig = ISC_SCM_Core_Lib.getCoreConfig();
    const projectId = coreConfig.connection.PROJECT_ID;
    const datasetId = coreConfig.connection.DATASET_ID;
    
    const timestamp = pushTimestamp.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const monthYear = Utilities.formatDate(pushTimestamp, "Asia/Ho_Chi_Minh", "MMMM yyyy");
    
    // SQL Timestamp (1 minute before push to catch all related records)
    const sqlTimestamp = Utilities.formatDate(
      new Date(pushTimestamp.getTime() - 60000), 
      "UTC", 
      "yyyy-MM-dd HH:mm:ss"
    );
    
    // 3. Build Subject (Per Sheet Type + Monthly Threading)
    const subject = config.THREAD_BY_MONTH
      ? `${config.EMAIL_SUBJECT_PREFIX} ${sheetName} - ${monthYear}`
      : `${config.EMAIL_SUBJECT_PREFIX} ${sheetName} - ${timestamp}`;
    
    // 4. Get Card Color & Label
    const cardColor = config.COLORS[sheetName] || '#666666';
    const sheetLabel = config.SHEET_LABELS[sheetName] || sheetName;
    
    // 5. Build Touch List HTML (Lean Summary)
    let touchListHtml = '';
    if (result.touchList && result.touchList.length > 0) {
      // Limit to first 20 items to prevent huge emails
      const displayItems = result.touchList.slice(0, 20);
      const hasMore = result.touchList.length > 20;
      
      touchListHtml = `
        <div style="margin-top: 15px;">
          <div style="font-size: 13px; font-weight: bold; color: #333; margin-bottom: 8px;">
            &#128203; Touch List (${result.touchList.length} items)
          </div>
          <div style="background: #f8f9fa; border: 1px solid #e1e4e8; border-radius: 4px; padding: 10px; font-size: 12px;">
            <table style="width: 100%; border-collapse: collapse;">
              ${displayItems.map((item, idx) => {
                const cells = Object.entries(item).map(([key, val]) => 
                  `<td style="padding: 3px 8px; border-bottom: 1px solid #eee;"><b>${key}:</b> ${val}</td>`
                ).join('');
                return `<tr>${cells}</tr>`;
              }).join('')}
            </table>
            ${hasMore ? `<div style="color: #666; margin-top: 8px; font-style: italic;">... and ${result.touchList.length - 20} more items</div>` : ''}
          </div>
        </div>
      `;
    }
    
    // 6. Build SQL Snippets (Investigator Queries)
    // 🛡️ V5.2: Handles optional UPLOADED template (can be null for transient tables)
    let sqlSnippetsHtml = '';
    if (config.SQL_TEMPLATES && config.SQL_TEMPLATES[sheetName]) {
      const templates = config.SQL_TEMPLATES[sheetName];
      
      // Build UPLOADED query only if template exists (not null)
      let uploadedSql = null;
      if (templates.UPLOADED) {
        uploadedSql = templates.UPLOADED
          .replace(/{PROJECT_ID}/g, projectId)
          .replace(/{DATASET_ID}/g, datasetId)
          .replace(/{TIMESTAMP}/g, sqlTimestamp);
      }
      
      // Build PROCESSED query only if template exists (not null)
      let processedSql = null;
      if (templates.PROCESSED) {
        processedSql = templates.PROCESSED
          .replace(/{PROJECT_ID}/g, projectId)
          .replace(/{DATASET_ID}/g, datasetId)
          .replace(/{TIMESTAMP}/g, sqlTimestamp);
      }
      
      // Only show SQL section if at least one query exists
      if (uploadedSql || processedSql) {
        // Build individual query blocks
        let queryNumber = 1;
        let uploadedBlock = '';
        let processedBlock = '';
        
        if (uploadedSql) {
          uploadedBlock = `
          <div style="margin-bottom: 10px;">
            <div style="font-size: 11px; color: #555; margin-bottom: 3px;">${queryNumber}. Check Raw Upload:</div>
            <div style="background: #f4f6f8; padding: 8px; border-radius: 4px; font-family: Consolas, Monaco, monospace; font-size: 11px; border: 1px solid #e1e4e8; overflow-x: auto; color: #24292e; white-space: pre-wrap;">
${uploadedSql}
            </div>
          </div>`;
          queryNumber++;
        }
        
        if (processedSql) {
          processedBlock = `
          <div>
            <div style="font-size: 11px; color: #555; margin-bottom: 3px;">${queryNumber}. Check Processed Results:</div>
            <div style="background: #f4f6f8; padding: 8px; border-radius: 4px; font-family: Consolas, Monaco, monospace; font-size: 11px; border: 1px solid #e1e4e8; overflow-x: auto; color: #24292e; white-space: pre-wrap;">
${processedSql}
            </div>
          </div>`;
        }
        
        sqlSnippetsHtml = `
        <div style="margin-top: 15px;">
          <div style="font-size: 13px; font-weight: bold; color: #0366d6; margin-bottom: 5px;">
            &#128373; Developer Clues (SQL)
          </div>
          <div style="font-size: 12px; margin-bottom: 8px; color: #666;">
            Run these in BigQuery to verify this push:
          </div>
          ${uploadedBlock}
          ${processedBlock}
        </div>
      `;
      }
    }
    
    // 7. Determine Status Display
    const hasFailures = result.failed > 0;
    const statusIcon = hasFailures ? '&#9888;' : '&#9989;';  // ⚠️ or ✅
    const statusText = hasFailures ? 'PARTIAL (Failures Detected)' : 'SUCCESS';
    const headerBgColor = hasFailures ? '#F9AB00' : cardColor;
    
    // 8. Build Complete HTML Email
    const htmlContent = `
      <html>
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #333; line-height: 1.6; }
          .card { border: 1px solid #ddd; border-radius: 8px; overflow: hidden; max-width: 650px; margin-bottom: 20px; }
          .header { color: white; padding: 12px 15px; font-weight: bold; font-size: 14px; }
          .content { padding: 15px; }
          .table { width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 13px; }
          .table td { padding: 6px 0; border-bottom: 1px solid #eee; }
          .table td:first-child { font-weight: bold; color: #555; width: 150px; }
          .footer { font-size: 11px; color: #999; margin-top: 15px; border-top: 1px solid #eee; padding-top: 8px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="header" style="background-color: ${headerBgColor};">
            ${statusIcon} Push Report: ${sheetLabel} - ${statusText}
          </div>
          <div class="content">
            
            <table class="table">
              <tr><td>User</td><td>${userEmail}</td></tr>
              <tr><td>Sheet</td><td>${sheetName}</td></tr>
              <tr><td>Time</td><td>${timestamp}</td></tr>
              <tr><td>Rows Uploaded</td><td><strong>${result.uploaded}</strong></td></tr>
              ${hasFailures ? `
              <tr style="background-color: #fce8e6; color: #c5221f;">
                <td>&#10060; Validation Failures</td>
                <td><strong>${result.failed}</strong></td>
              </tr>
              ` : ''}
              <tr><td>Post-Upload Trigger</td><td>${POST_UPLOAD_TRIGGERS[sheetName] || 'None'}</td></tr>
            </table>

            ${touchListHtml}
            
            ${sqlSnippetsHtml}

            <div class="footer">
              Generated by M1_Main.gs Flight Recorder | ISC Planning Engine v5.1
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
    
    // 9. Send Email (Send & Hunt Logic)
    const recipients = config.RECIPIENTS.join(',');
    let thread = null;
    
    // Search for existing thread
    const threads = GmailApp.search(`subject:"${subject}"`);
    
    if (threads.length > 0 && config.THREAD_BY_MONTH) {
      // Reply to existing thread
      thread = threads[0];
      thread.reply("", { htmlBody: htmlContent });
      console.log(`[Flight Recorder] Replied to existing thread: ${subject}`);
    } else {
      // Send new email
      GmailApp.sendEmail(recipients, subject, "", { htmlBody: htmlContent });
      console.log(`[Flight Recorder] Sent new email: ${subject}`);
      
      // HUNT: Wait 2s for Gmail Indexing, then find the new thread
      Utilities.sleep(2000);
      const newThreads = GmailApp.search(`subject:"${subject}"`);
      if (newThreads.length > 0) {
        thread = newThreads[0];
      }
    }
    
    // 10. Auto-Labeling (Unified Audit Trail)
    // This ensures the label is applied to the sender's mailbox
    if (thread && config.EMAIL_LABEL) {
      let label = GmailApp.getUserLabelByName(config.EMAIL_LABEL);
      // Create label if it doesn't exist
      if (!label) {
        label = GmailApp.createLabel(config.EMAIL_LABEL);
        console.log(`[Flight Recorder] Created new label: ${config.EMAIL_LABEL}`);
      }
      label.addToThread(thread);
      console.log(`[Flight Recorder] Applied label '${config.EMAIL_LABEL}' to thread`);
    }
    
    console.log(`[Flight Recorder] Report sent successfully for ${sheetName}`);
    
  } catch (e) {
    console.error(`[Flight Recorder] Failed to send push report: ${e.message}`);
    console.error(e.stack);
    
    // Fallback: Try simple email without threading/labeling
    try {
      const fallbackRecipients = config.RECIPIENTS ? config.RECIPIENTS.join(',') : 'dk@isconline.vn';
      MailApp.sendEmail({
        to: fallbackRecipients,
        subject: `${config.EMAIL_SUBJECT_PREFIX || '[ISC Push Log]'} ${sheetName} (Fallback)`,
        body: `Push Report (HTML Failed)\n\nSheet: ${sheetName}\nUser: ${userEmail}\nRows: ${result.uploaded}\nFailed: ${result.failed}\nError: ${e.message}`
      });
      console.log('[Flight Recorder] Fallback email sent');
    } catch (fallbackErr) {
      console.error(`[Flight Recorder] Fallback email also failed: ${fallbackErr.message}`);
    }
  }
}