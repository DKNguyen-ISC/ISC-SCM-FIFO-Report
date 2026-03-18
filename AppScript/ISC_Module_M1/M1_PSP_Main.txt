/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🎮 M1_PSP_Main.gs
 * Main Controller for Production Status Portal (V6.1 - Smart Sandwich Edition)
 * ═══════════════════════════════════════════════════════════════════════════════
 * * RESPONSIBILITIES:
 * - Orchestrates session creation, data refresh, and commit operations.
 * - Handles identity resolution (Auto-Login via Email).
 * - Manages the "Feedback Loop" (Read-after-Write) for data integrity.
 * - AUTOMATION: Runs the 'Nightly Janitor' at 02:00 AM to close Zombie Orders.
 * - AUDIT: Logs automated execution to BigQuery 'System_Execution_Log'.
 * * * LOGIC UPDATES (V6.1):
 * - ⭐ EXTRACTION: Reads 'NEW_CUMULATIVE_QTY' from Zone A (Result Formula).
 * - ⭐ CLEANUP: Clears 'OVERRIDE_CUMULATIVE_QTY' in Zone B after commit.
 * - ⭐ SOURCE TRACKING: Now accepts 'source' param to distinguish Manual vs Auto.
 * * @version 6.1 Smart Sandwich
 * @revision January 2026
 * ═══════════════════════════════════════════════════════════════════════════════
 */


// ═══════════════════════════════════════════════════════════════════════════════
// 1. MENU FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 🚀 PUBLIC MENU HOOK
 * Call this function from your main project's onOpen() trigger.
 * Example: function onOpen() { addPSPMenu(); }
 */
function addPSPMenu() {
  const ui = SpreadsheetApp.getUi();
  // We use a specific menu name to avoid cluttering the bar
  ui.createMenu('🏭 ISC Production Portal')
    .addItem('🚀 Start / Refresh Session', 'menu_M1_PSP_CreateSession')
    .addSeparator()
    .addItem('💾 Commit Changes', 'menu_M1_PSP_Commit')
    .addSeparator()
    .addSubMenu(ui.createMenu('🔧 Admin Tools')
        .addItem('🛠️ Rebuild Master Template', 'menu_Admin_RebuildTemplate')
        .addItem('🧹 Check Migration Status (Manual)', 'menu_CheckMigrationStatus')
        .addSeparator()
        .addItem('⏰ Install Nightly Janitor (02:00)', 'admin_InstallTrigger')
        .addItem('🚫 Remove All Triggers', 'admin_RemoveTriggers')
        .addSeparator()
        // ⭐ NEW AUTO-SYNC CONTROLS (Functions located in M1_PSP_AutoSync.gs)
        .addItem('⚡ Force Auto-Sync Run (Manual)', 'trigger_NightlyAutoSync')
        .addItem('📅 Install Nightly Auto-Sync (00:00)', 'admin_InstallAutoSyncTrigger'))
    .addToUi();
}


// ═══════════════════════════════════════════════════════════════════════════════
// 2. INTERACTIVE ACTIONS (The Human Part)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 🚀 MENU ACTION: Create or Refresh Session
 */
function menu_M1_PSP_CreateSession() {
  const ui = SpreadsheetApp.getUi();
  try {
    const userEmail = Session.getActiveUser().getEmail();
    const picInfo = _getPicNameFromEmail(userEmail);

    if (!picInfo.isValid) {
      ui.alert('⛔ Access Denied', `Email '${userEmail}' is not linked to a valid PIC configuration.`, ui.ButtonSet.OK);
      return;
    }

    // Delegate UI building to the dedicated module
    M1_PSP_SheetBuilder.createOrRefreshSession(picInfo.picName);

  } catch (e) {
    _handleError('menu_M1_PSP_CreateSession', e, ui);
  }
}

/**
 * 💾 MENU ACTION: Commit Changes
 * ⭐ UPGRADED (V6.1): Now handles 'BLOCKED_CANCELLED_ORDERS' with Toast Notification
 */
function menu_M1_PSP_Commit() {
  const ui = SpreadsheetApp.getUi();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getActiveSheet();
  const config = getPSPConfig();

  // 1. Validate Context
  if (!sheet.getName().endsWith(config.SESSION_SUFFIX)) {
    ui.alert('⚠️ Wrong Sheet', 'Please run this command from your active Session sheet.', ui.ButtonSet.OK);
    return;
  }

  // 2. Identify User
  const userEmail = Session.getActiveUser().getEmail();
  const picInfo = _getPicNameFromEmail(userEmail);

  if (!picInfo.isValid) {
    ui.alert('⛔ Access Denied', 'You are not authorized to commit data.', ui.ButtonSet.OK);
    return;
  }

  // 3. Confirm Action
  const confirm = ui.alert(
    '💾 Confirm Commit',
    'Are you sure you want to save these changes to the System?',
    ui.ButtonSet.YES_NO
  );

  if (confirm !== ui.Button.YES) return;

  try {
    // 4. Extract Updates
    spreadsheet.toast('📤 Uploading Data...', 'Step 1/3');
    const updates = _extractUpdates(sheet, config);
    
    if (updates.length === 0) {
      ui.alert('ℹ️ No Changes', 'No valid quantities found in the result column.', ui.ButtonSet.OK);
      return;
    }

    // 5. Upload to Staging (CSV)
    const uploadResult = _uploadUpdates(updates, picInfo.picName, 'MANUAL_PORTAL');

    if (!uploadResult.success) {
      throw new Error(`Upload Failed: ${uploadResult.message}`);
    }

    // 6. Trigger Processing & READ RESULTS (The Feedback Loop)
    spreadsheet.toast('⚙️ Processing Rules...', 'Step 2/3');
    const coreConfig = ISC_SCM_Core_Lib.getCoreConfig();
    const projectId = coreConfig.connection.PROJECT_ID;
    const datasetId = coreConfig.connection.DATASET_ID;
    
    // Call the SP and map the results
    const triggerSql = `CALL \`${projectId}.${datasetId}.${config.SP_NAME}\`('${userEmail}')`;
    const spResult = ISC_SCM_Core_Lib.runReadQueryMapped(triggerSql);
    
    // 7. Auto-Refresh (Always do this to show current state)
    spreadsheet.toast('🔄 Refreshing View...', 'Step 3/3');
    _clearInputColumn(sheet);
    M1_PSP_SheetBuilder.refreshSessionData(sheet, picInfo.picName);

    // 8. Analyze Results & Display Feedback
    if (!spResult || spResult.length === 0) {
      // Fallback if SP didn't return a row
      ui.alert('✅ Success', 'Updates committed. (No audit summary returned)', ui.ButtonSet.OK);
    } else {
      const summary = spResult[0];
      const committed = parseInt(summary.COMMITTED_COUNT || 0);
      const errors = parseInt(summary.ERROR_COUNT || 0);
      const conflicts = parseInt(summary.CONFLICT_COUNT || 0);
      const anomalies = parseInt(summary.ANOMALY_COUNT || 0);
      const ignored = parseInt(summary.IGNORED_COUNT || 0);
      
      // ⭐ V6.1 PATCH: Extract Blocked Count
      const blocked = parseInt(summary.BLOCKED_CANCELLED_ORDERS || 0);

      // ⭐ V6.1 PATCH: Toast Notification (Priority Alert)
      if (blocked > 0) {
        spreadsheet.toast(
          `⛔ ${blocked} update(s) rejected: Order(s) have been CANCELLED.\n` +
          `Your input was not saved. Contact your supervisor.`,
          '🛑 Orders Cancelled',
          15 // Show for 15 seconds
        );
        console.warn(`PSP Sync: ${blocked} updates blocked due to CANCELLED orders`);
      }

      // Construct the Intelligent Message
      let title = '✅ Success';
      let message = `${committed} rows updated successfully.`;
      
      // Check for ANY non-success outcomes (including blocked)
      if (conflicts > 0 || errors > 0 || anomalies > 0 || blocked > 0) {
        title = '⚠️ Partial Success / Errors Detected';
        message = `Processed: ${committed} successful.\n\n`;
        
        if (blocked > 0) message += `⛔ BLOCKED: ${blocked} order(s) are CANCELLED. Updates rejected.\n`;
        if (conflicts > 0) message += `✋ Conflicts: ${conflicts} (Data changed by others while you worked.)\n`;
        if (errors > 0) message += `❌ Validation Errors: ${errors} (Check 110% Cap or ID validity)\n`;
        if (anomalies > 0) message += `⛔ Circuit Breaker: ${anomalies} (Suspicious Zero-Wipe blocked)\n`;
        if (ignored > 0) message += `ℹ️ Ignored: ${ignored} (Sample products excluded)\n`;
        
        message += `\nYour sheet has been refreshed with the latest system data.`;
      }

      // Only show alert if it's NOT just a pure success, OR if the user expects confirmation
      // (Standard behavior: Always show alert for manual actions)
      ui.alert(title, message, ui.ButtonSet.OK);
    }

  } catch (e) {
    _handleError('menu_M1_PSP_Commit', e, ui);
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// 3. SILENT AUTOMATIONS (The Robot Part)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 🤖 HEADLESS TRIGGER: Nightly Janitor
 * Runs at 02:00 AM via Time-Driven Trigger.
 * Closes "Zombie Orders" (Finished physically but marked Released).
 * ⭐ V5.3 UPGRADE: Uses correct 'logStep' to write to 'System_Execution_Log'.
 */
function trigger_M1_NightlyJanitor() {
  const config = getPSPConfig();
  const startTime = new Date().getTime();
  const batchId = 'M1_JANITOR_' + startTime;
  const moduleId = 'ISC_M1_PLANNING';
  
  console.log(`[NightlyJanitor] Starting Batch ${batchId}...`);

  try {
    // 1. LOG START
    // Arguments: batchId, moduleId, stepId, stepName, status
    ISC_SCM_Core_Lib.logStep(batchId, moduleId, 1, 'SP_MIGRATE_HISTORICAL_STATES', 'RUNNING');

    // 2. EXECUTE SP
    const janitorIdentity = 'SYSTEM_JANITOR'; 
    const coreConfig = ISC_SCM_Core_Lib.getCoreConfig();
    const sql = `CALL \`${coreConfig.connection.PROJECT_ID}.${coreConfig.connection.DATASET_ID}.${config.SP_MIGRATE}\`('${janitorIdentity}')`;
    const result = ISC_SCM_Core_Lib.runReadQueryMapped(sql);
    
    let message = 'No pending migrations.';
    if (result && result.length > 0) {
      message = `Migrated/Closed: ${result[0].ORDERS_MIGRATED} orders.`;
    }

    // 3. LOG SUCCESS
    const duration = (new Date().getTime() - startTime) / 1000;
    // Note: We pass 'null' for errorMessage to keep the log clean (M2 Standard)
    ISC_SCM_Core_Lib.logStep(batchId, moduleId, 2, 'SP_MIGRATE_HISTORICAL_STATES', 'SUCCESS', duration, null);
    
    console.log(`[NightlyJanitor] SUCCESS. ${message}`);

  } catch (e) {
    // 4. LOG FAILURE
    const duration = (new Date().getTime() - startTime) / 1000;
    console.error(`[NightlyJanitor] FAILED: ${e.message}`);
    
    try {
      ISC_SCM_Core_Lib.logStep(batchId, moduleId, 2, 'SP_MIGRATE_HISTORICAL_STATES', 'FAILED', duration, e.message);
    } catch (logErr) {
      console.error('Failed to write failure log to BigQuery:', logErr);
    }

    // ⭐ RE-THROW TO ALERT ADMIN (Email Notification)
    throw e;
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// 4. ADMIN INFRASTRUCTURE (The Tools)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * 🛠️ ADMIN ACTION: Rebuild Master Template
 */
function menu_Admin_RebuildTemplate() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert('🛠️ Rebuild Template', 
    'This will DELETE and RECREATE the Master Template based on M1_PSP_Config.\nAre you sure?', 
    ui.ButtonSet.YES_NO);
    
  if (response === ui.Button.YES) {
    try {
      M1_PSP_SheetBuilder.createMasterTemplate();
      ui.alert('✅ Template Rebuilt', 'The Master Template has been updated to V6.0 specs.', ui.ButtonSet.OK);
    } catch (e) {
      _handleError('menu_Admin_RebuildTemplate', e, ui);
    }
  }
}

/**
 * 🧹 ADMIN ACTION: Check Migration Status (Manual)
 * Runs the Janitor manually and reports back with UI Alert.
 * ⭐ UPGRADED (V5.3):
 * 1. Logs execution using 'logStep' (Matches M2).
 * 2. Auto-detects BigQuery Seconds vs Milliseconds for accurate Timestamps.
 */
function menu_CheckMigrationStatus() {
  const ui = SpreadsheetApp.getUi();
  const config = getPSPConfig();
  
  // 1. SETUP LOGGING CONTEXT
  const startTime = new Date().getTime();
  const batchId = 'M1_MANUAL_' + startTime; 
  const moduleId = 'ISC_M1_PLANNING';

  try {
    const userEmail = Session.getActiveUser().getEmail();
    const coreConfig = ISC_SCM_Core_Lib.getCoreConfig();
    
    // 2. LOG START (Step 1: START_RUN)
    ISC_SCM_Core_Lib.logStep(batchId, moduleId, 1, 'START_RUN', 'RUNNING');
    
    ui.alert('⏳ Running Migration Check...');
    
    // 3. EXECUTE SP
    const sql = `CALL \`${coreConfig.connection.PROJECT_ID}.${coreConfig.connection.DATASET_ID}.${config.SP_MIGRATE}\`('${userEmail}')`;
    const result = ISC_SCM_Core_Lib.runReadQueryMapped(sql);
    
    // 4. PREPARE LOG DETAILS
    let ordersMigrated = 0;
    if (result && result.length > 0) {
      ordersMigrated = result[0].ORDERS_MIGRATED;
    }

    // 5. LOG SUCCESS (Step 2: SP_MIGRATE_HISTORICAL_STATES)
    const duration = (new Date().getTime() - startTime) / 1000;
    ISC_SCM_Core_Lib.logStep(batchId, moduleId, 2, 'SP_MIGRATE_HISTORICAL_STATES', 'SUCCESS', duration, null);
    
    // 6. UI REPORT & TIMESTAMP FIX
    if (result && result.length > 0) {
      const row = result[0];
      const rawValue = row.COMPLETED_AT && row.COMPLETED_AT.value ? row.COMPLETED_AT.value : row.COMPLETED_AT;
      let timeNum = Number(rawValue);
      
      // Timestamp logic: If < 100 Billion (Year 1973), it's Seconds -> Convert to Ms
      if (!isNaN(timeNum) && timeNum < 100000000000) {
        timeNum *= 1000;
      }
      
      let formattedTime = 'Unknown';
      try {
        const dateObj = new Date(timeNum); 
        formattedTime = Utilities.formatDate(dateObj, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
      } catch (err) {
        console.warn('Date parsing failed:', err);
        formattedTime = rawValue;
      }
      
      ui.alert('📊 Migration Report', 
        `Orders Migrated/Closed: ${ordersMigrated}\nTimestamp: ${formattedTime}`, 
        ui.ButtonSet.OK);
    } else {
      ui.alert('✅ System Clean', 'No pending migrations found.', ui.ButtonSet.OK);
    }
    
  } catch (e) {
    // 7. LOG FAILURE
    const duration = (new Date().getTime() - startTime) / 1000;
    console.error(`[ManualJanitor] FAILED: ${e.message}`);
    
    try {
      ISC_SCM_Core_Lib.logStep(batchId, moduleId, 2, 'SP_MIGRATE_HISTORICAL_STATES', 'FAILED', duration, e.message);
    } catch (logErr) {
      console.error('Failed to log error to BigQuery:', logErr);
    }

    _handleError('menu_CheckMigrationStatus', e, ui);
  }
}

/**
 * ⏰ ADMIN ACTION: Install Nightly Janitor
 * Schedules trigger_M1_NightlyJanitor at 02:00 AM VN Time.
 */
function admin_InstallTrigger() {
  const ui = SpreadsheetApp.getUi();
  const triggerFunc = 'trigger_M1_NightlyJanitor';
  
  // 1. Clean up old triggers first to avoid duplicates
  admin_RemoveTriggers(false); // false = suppress UI alert

  try {
    // 2. Create New Trigger
    // Schedule: Every Day at 02:00 AM (Vietnam Time)
    ScriptApp.newTrigger(triggerFunc)
      .timeBased()
      .everyDays(1)
      .atHour(2) 
      .inTimezone("Asia/Ho_Chi_Minh")
      .create();

    ui.alert('✅ Trigger Installed', 'The M1 Migration Janitor will now run automatically at 02:00 AM VN Time.', ui.ButtonSet.OK);
  } catch (e) {
    _handleError('admin_InstallTrigger', e, ui);
  }
}

/**
 * 🚫 ADMIN ACTION: Remove All Triggers
 * Wipes triggers for this project.
 */
function admin_RemoveTriggers(showAlert = true) {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    ScriptApp.deleteTrigger(trigger);
  }
  
  if (showAlert) {
    SpreadsheetApp.getUi().alert('🚫 Triggers Removed', 'All automated triggers for this project have been deleted.', SpreadsheetApp.getUi().ButtonSet.OK);
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// 5. DATA PROCESSING & UTILS
// ═══════════════════════════════════════════════════════════════════════════════

function _extractUpdates(sheet, config) {
  const lastRow = sheet.getLastRow();
  if (lastRow < config.DATA_START_ROW) return [];

  const dataRange = sheet.getRange(
    config.DATA_START_ROW, 
    1, 
    lastRow - config.DATA_START_ROW + 1, 
    sheet.getLastColumn()
  );
  const values = dataRange.getValues();
  
  const updates = [];
  const timestamp = new Date().toISOString();
  
  values.forEach(row => {
    // ⭐ CRITICAL CHANGE: Extract from ZONE A (Column 11 - Result Formula)
    // Why: We must capture the Final Calculated Value (whether it came from Plan or Override).
    const inputVal = row[config.COLUMNS.ZONE_A.NEW_CUMULATIVE_QTY.col - 1];
    
    // 2. Filter: Only process valid numeric inputs
    if (inputVal === '' || inputVal === null || isNaN(inputVal)) return;

    // 3. Get Identifiers (Using V6 Strict Keys)
    const prodOrderId = row[config.COLUMNS.ZONE_A.PRODUCTION_ORDER_ID.col - 1];
    const vpo = row[config.COLUMNS.ZONE_A.VPO.col - 1];
    
    // ⭐ STRICT CHANGE: Use 'FINISHED_GOODS_ORDER_QTY' directly
    const finishedGoodsQty = row[config.COLUMNS.ZONE_A.FINISHED_GOODS_ORDER_QTY.col - 1]; 
    
    const currentQty = row[config.COLUMNS.ZONE_A.CURRENT_COMPLETION_QTY.col - 1]; // Used for Optimistic Locking

    if (!prodOrderId && !vpo) return; // Skip invalid rows

    updates.push({
      PRODUCTION_ORDER_ID: prodOrderId,
      VPO: vpo,
      FINISHED_GOODS_ORDER_QTY: finishedGoodsQty, // Matches DB Schema directly
      NEW_CUMULATIVE_QTY: inputVal,
      EXPECTED_OLD_QTY: currentQty, // ⭐ OPTIMISTIC LOCKING KEY
      LOGGED_AT: timestamp,
      LOGGED_BY: Session.getActiveUser().getEmail()
    });
  });
  
  return updates;
}

/**
 * ⭐ UPGRADED: Accepts 'source' parameter
 * source: 'MANUAL_PORTAL' (default) or 'AUTO_SYNC'
 */
function _uploadUpdates(updates, picName, source = 'MANUAL_PORTAL') {
  try {
    const config = getPSPConfig();
    
    // 1. Header Row (Critical for BigQuery CSV mapping)
    // Must match the Schema of Production_Status_Log TABLE
    const headerRow = [
      'LOG_ID',
      'PRODUCTION_ORDER_ID',
      'VPO',
      'FINISHED_GOODS_ORDER_QTY', // ⭐ STRICT MATCH
      'NEW_CUMULATIVE_QTY',
      'EXPECTED_OLD_QTY',         
      'SOURCE',
      'VALIDATION_STATUS',
      'ERROR_MESSAGE',
      'GHOST_DEDUCTION_APPLIED',
      'EFFECTIVE_QTY_FOR_FIFO',
      'LOGGED_AT',
      'LOGGED_BY',
      'PROCESSED_AT'
    ].join(',');
    
    // 2. Map Data Rows (⭐ V6.0 SECURE MAPPING)
    const csvRows = updates.map((update, i) => {
      // Unique Log ID: TIME + USER + INDEX
      const logId = `LOG_${new Date().getTime()}_${i}`; 

      return [
        _toCsvValue(logId),                        
        _toCsvValue(update.PRODUCTION_ORDER_ID),
        _toCsvValue(update.VPO),
        _toCsvValue(update.FINISHED_GOODS_ORDER_QTY), // Direct Map
        _toCsvValue(update.NEW_CUMULATIVE_QTY),
        _toCsvValue(update.EXPECTED_OLD_QTY),
        // ⭐ SOURCE: Uses dynamic source (Auto vs Manual)
        _toCsvValue(source),
        _toCsvValue('PENDING'),                        
        '', // ERROR_MESSAGE (Blank)
        '', // GHOST_DEDUCTION (Blank)
        '', // EFFECTIVE_QTY (Blank)
        _toCsvValue(update.LOGGED_AT),
        _toCsvValue(update.LOGGED_BY),
        ''  // PROCESSED_AT (Blank)
      ].join(',');
    });

    // 3. Combine Header + Data
    const csvContent = [headerRow, ...csvRows].join('\n');
    
    _logDebug(`Generated CSV for ${updates.length} rows.`);

    // 4. Send to BigQuery
    ISC_SCM_Core_Lib.loadCsvData(config.LOG_TABLE, csvContent, 'WRITE_APPEND');
    
    return { success: true, message: `${updates.length} uploaded.` };

  } catch (error) {
    _logError('_uploadUpdates', error, { picName, count: updates.length });
    return { success: false, message: error.message };
  }
}

function _clearInputColumn(sheet) {
  const config = getPSPConfig();
  const lastRow = sheet.getLastRow();
  if (lastRow >= config.DATA_START_ROW) {
    // ⭐ CRITICAL CHANGE: Clear the OVERRIDE Column (Zone B)
    // We do NOT clear Zone A (Col 11) because it contains the Logic Formula.
    sheet.getRange(
      config.DATA_START_ROW, 
      config.COLUMNS.ZONE_B.OVERRIDE_CUMULATIVE_QTY.col, 
      lastRow - config.DATA_START_ROW + 1, 
      1
    ).clearContent();
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// 6. LOGGING & HELPER UTILS
// ═══════════════════════════════════════════════════════════════════════════════

function _handleError(func, error, ui) {
  console.error(`❌ [${func}] Failed: ${error.message}`);
  if (ui) {
    ui.alert('❌ Error', `Operation Failed:\n${error.message}`, ui.ButtonSet.OK);
  }
}

function _logDebug(message) {
  const config = getPSPConfig();
  if (config.DEBUG_MODE) console.log(`[PSP_Main] ${message}`);
}

function _logError(context, error, data) {
  console.error(`[${context}] ${error.message}`, data);
}

function _getPicNameFromEmail(email) {
  const config = getPSPConfig();
  
  // 1. Direct Mapping Check
  for (const [picName, picEmail] of Object.entries(config.PIC_EMAILS)) {
    if (picEmail.toLowerCase() === email.toLowerCase()) {
      return { isValid: true, picName: picName };
    }
  }
  
  return { isValid: false, picName: null };
}

/**
 * ⭐ CSV SAFETY HELPER (RFC 4180 Compliant)
 * Escapes values to prevent CSV injection or structure breaking.
 * Wraps in quotes if contains comma, newline, or quotes. Escapes internal quotes.
 */
function _toCsvValue(value) {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  
  // Check if value contains special CSV characters
  if (stringValue.search(/("|,|\n|\r)/g) >= 0) {
    // Escape double quotes by doubling them (" -> "")
    // And wrap the whole string in double quotes
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  
  return stringValue;
}