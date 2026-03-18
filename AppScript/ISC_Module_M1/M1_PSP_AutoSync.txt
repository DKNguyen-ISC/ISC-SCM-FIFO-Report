/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🤖 M1_PSP_AutoSync.gs
 * Headless Auto-Pilot for Production Status Portal (V6.8 - Cancellation Aware)
 * ═══════════════════════════════════════════════════════════════════════════════
 * * RESPONSIBILITIES:
 * - The "Nightly Robot" that commits production data automatically.
 * - Solves the "Cold Chain" problem by forcing Bridge Sheets to wake up (F5).
 * - Executes the exact same logic as M1_PSP_Main but without UI.
 * - Logs to BigQuery and Emails the Developer (Smart Threading + Insights).
 * * * ARCHITECTURE:
 * 1. WAKE: Touch Bridge Sheets (Write Timestamp to Z1).
 * 2. WAIT: Sleep 10s for propagation.
 * 3. SYNC: Open MASTER Session -> Extract -> Deduplicate -> Upload -> Clear.
 * 4. PROCESS: Trigger BigQuery SP -> ⭐ CAPTURE RESULT (Committed vs Blocked).
 * 5. VERIFY: Refresh Master Session to show new "Truth".
 * 6. REPORT: Log to BigQuery & Send UTF-8 Threaded Email with Blocked Stats.
 * * * @version 6.8 Cancellation Aware
 * @revision January 2026
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const AUTOSYNC_CONFIG = {
  // Identity (Must match a valid Key in PSP_CONFIG.PIC_EMAILS)
  IDENTITY_NAME: 'Khánh', 
  IDENTITY_EMAIL: 'dk@isconline.vn',
  
  // The Master Session that the Bot controls
  MASTER_SHEET_NAME: 'MASTER_Status_Portal', 
  
  // The Bridge Sheets (Factory Data) that need a "F5 Refresh"
  BRIDGE_URLS: [
    'https://docs.google.com/spreadsheets/d/1NPyHUV6wTHmeuKl-dvMUW0adOSDNlWlL5dpMFxLmCQk/edit',
    'https://docs.google.com/spreadsheets/d/1e3Mm9rsVT0B-UqjISkDwARWZ1om4CVyxZML3AHzIcMk/edit'
  ],
  
  // Settings
  WAKE_CELL: 'Z1', // The cell to touch (timestamp)
  PROPAGATION_DELAY_MS: 10000, // 10 Seconds Wait
  MODULE_ID: 'ISC_M1_PLANNING',
  
  // Email Strategy (Monthly Buckets)
  EMAIL_PREFIX: '[ISC AutoSync] Execution Report', 
  EMAIL_LABEL: 'ISC_Logs' // The Label to apply automatically
};

// ═══════════════════════════════════════════════════════════════════════════════
// 2. MAIN TRIGGER ( The Entry Point )
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ⏰ TRIGGER FUNCTION
 * This is the function called by the Time-Driven Trigger.
 */
function trigger_NightlyAutoSync() {
  const startTime = new Date().getTime();
  const batchId = 'AUTO_SYNC_' + startTime;
  const moduleId = AUTOSYNC_CONFIG.MODULE_ID;

  console.log(`[AutoSync] Starting Batch ${batchId}...`);
  
  // Stats for Report
  const report = {
    status: 'RUNNING',
    rowsCommitted: 0,
    rowsBlocked: 0, // ⭐ NEW: Track Blocked Orders
    bridgesRefreshed: 0,
    errors: [],
    logs: []
  };

  try {
    // 🟢 STEP 1: LOG START
    ISC_SCM_Core_Lib.logStep(batchId, moduleId, 1, 'START_AUTO_SYNC', 'RUNNING');

    // 🟢 STEP 2: WAKE UP BRIDGES (The F5 Trigger)
    report.logs.push('Phase 1: Waking up Bridge Sheets...');
    const wakeResult = _wakeUpBridges(batchId);
    report.bridgesRefreshed = wakeResult.count;
    if (wakeResult.errors.length > 0) report.errors.push(...wakeResult.errors);

    // 🟢 STEP 3: PROPAGATION PAUSE
    report.logs.push(`Phase 2: Waiting ${AUTOSYNC_CONFIG.PROPAGATION_DELAY_MS/1000}s for IMPORTRANGE...`);
    Utilities.sleep(AUTOSYNC_CONFIG.PROPAGATION_DELAY_MS);

    // 🟢 STEP 4: EXECUTE MASTER SYNC
    report.logs.push('Phase 3: Syncing Master Session...');
    const syncResult = _processMasterSync(batchId);
    
    // ⭐ UPDATE STATS
    report.rowsCommitted = syncResult.committed;
    report.rowsBlocked = syncResult.blocked;
    
    // 🟢 STEP 5: LOG SUCCESS
    const duration = (new Date().getTime() - startTime) / 1000;
    
    // ⭐ LOG PRECISE METRICS
    const successMsg = `Committed: ${syncResult.committed}, Blocked: ${syncResult.blocked}`;
    ISC_SCM_Core_Lib.logStep(batchId, moduleId, 4, 'FINISH_AUTO_SYNC', 'SUCCESS', duration, successMsg);
    
    report.status = 'SUCCESS';
    console.log(`[AutoSync] SUCCESS. ${successMsg}`);

  } catch (e) {
    // 🔴 HANDLE CRITICAL FAILURE
    console.error(`[AutoSync] CRITICAL FAILURE: ${e.message}`);
    const duration = (new Date().getTime() - startTime) / 1000;
    
    // Attempt to Log to BigQuery
    try {
      ISC_SCM_Core_Lib.logStep(batchId, moduleId, 99, 'AUTO_SYNC_FAILURE', 'FAILED', duration, e.message);
    } catch (logErr) {
      console.error('Failed to write failure log: ' + logErr.message);
    }
    
    report.status = 'FAILED';
    report.errors.push(`CRITICAL: ${e.message}`);

  } finally {
    // 🟢 STEP 6: SEND REPORT (Smart Threading + Insights)
    _sendDeveloperReport(report, batchId);
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// 3. INTERNAL HELPERS (The Logic)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * PHASE 1: WAKE UP
 * Opens external spreadsheets and writes a timestamp to force recalculation.
 */
function _wakeUpBridges(batchId) {
  let count = 0;
  const errors = [];
  
  AUTOSYNC_CONFIG.BRIDGE_URLS.forEach((url, index) => {
    try {
      // 1. Open Spreadsheet
      const ss = SpreadsheetApp.openByUrl(url);
      
      // 2. Get the first sheet (Safe default to trigger workbook calc)
      const sheet = ss.getSheets()[0]; 
      
      // 3. Write Timestamp (The "Touch")
      const timestamp = new Date().toISOString();
      sheet.getRange(AUTOSYNC_CONFIG.WAKE_CELL).setValue(`Last Sync Wake: ${timestamp}`);
      
      // 4. Force Flush
      SpreadsheetApp.flush();
      
      console.log(`[AutoSync] Woke up Bridge ${index + 1}: ${ss.getName()}`);
      count++;
      
    } catch (e) {
      const msg = `Failed to wake Bridge ${index + 1} (${url}): ${e.message}`;
      console.warn(msg);
      errors.push(msg);
      // Log non-fatal error to BigQuery
      ISC_SCM_Core_Lib.logStep(batchId, AUTOSYNC_CONFIG.MODULE_ID, 2, 'WAKE_BRIDGE_PARTIAL_FAIL', 'WARNING', 0, msg);
    }
  });
  
  return { count, errors };
}

/**
 * PHASE 3: MASTER SYNC
 * Reuses M1_PSP_Main logic to Extract, Upload, and Clear.
 * ⭐ UPDATED: Now captures Stored Procedure results (Committed vs Blocked).
 */
function _processMasterSync(batchId) {
  const config = getPSPConfig(); 
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Find or Create Master Session
  let sheet = ss.getSheetByName(AUTOSYNC_CONFIG.MASTER_SHEET_NAME);
  if (!sheet) {
    console.log('[AutoSync] Master Session not found. Creating new...');
    // ⭐ HEADLESS FIX: Pass 'true' (Silent Mode)
    M1_PSP_SheetBuilder.createOrRefreshSession(AUTOSYNC_CONFIG.IDENTITY_NAME, true);
    
    const tempName = getSessionSheetName(AUTOSYNC_CONFIG.IDENTITY_NAME);
    const tempSheet = ss.getSheetByName(tempName);
    if (tempSheet) {
        tempSheet.setName(AUTOSYNC_CONFIG.MASTER_SHEET_NAME);
        sheet = tempSheet;
    } else {
        throw new Error('Failed to create Master Session Sheet.');
    }
  } else {
    // Refresh with Silent Mode
    M1_PSP_SheetBuilder.refreshSessionData(sheet, AUTOSYNC_CONFIG.IDENTITY_NAME, false, true);
  }
  
  // 2. Extract Updates
  let updates = _extractUpdates(sheet, config);
  if (updates.length === 0) {
    console.log('[AutoSync] No updates found (Clean Sync).');
    return { committed: 0, blocked: 0, attempted: 0 };
  }

  // 🛡️ SAFETY PATCH: Client-Side Deduplication
  const uniqueUpdates = [];
  const idMap = new Map();
  updates.forEach(u => {
    if (u.PRODUCTION_ORDER_ID) {
      // If duplicate IDs exist, map.set overwrites with the latest one
      idMap.set(u.PRODUCTION_ORDER_ID, u);
    } else {
      // Preserve VPO-based updates (don't have IDs)
      uniqueUpdates.push(u);
    }
  });
  // Combine unique ID updates back into the array
  uniqueUpdates.push(...idMap.values());
  
  if (updates.length > uniqueUpdates.length) {
    console.warn(`[AutoSync] Deduplicated: Reduced ${updates.length} rows to ${uniqueUpdates.length} unique payloads.`);
  }
  
  // 3. Upload to BigQuery (Using Unique Data)
  const uploadResult = _uploadUpdates(uniqueUpdates, AUTOSYNC_CONFIG.IDENTITY_NAME, 'AUTO_SYNC');
  if (!uploadResult.success) {
    throw new Error(`Upload Failed: ${uploadResult.message}`);
  }
  
  // 4. Clear Input
  _clearInputColumn(sheet);

  // 5. Trigger SP (The Processing)
  const coreConfig = ISC_SCM_Core_Lib.getCoreConfig();
  const triggerSql = `CALL \`${coreConfig.connection.PROJECT_ID}.${coreConfig.connection.DATASET_ID}.${config.SP_NAME}\`('${AUTOSYNC_CONFIG.IDENTITY_EMAIL}')`;
  
  // ⭐ CAPTURE RESULT (Capture instead of Ignore)
  const spResult = ISC_SCM_Core_Lib.runReadQueryMapped(triggerSql);
  
  let committed = 0;
  let blocked = 0;
  
  if (spResult && spResult.length > 0) {
    const summary = spResult[0];
    committed = parseInt(summary.COMMITTED_COUNT || 0);
    blocked = parseInt(summary.BLOCKED_CANCELLED_ORDERS || 0);
  } else {
    // Fallback if SP returns nothing (e.g., older version)
    committed = uniqueUpdates.length; 
  }

  // 6. VERIFICATION: Post-Sync Refresh
  console.log(`[AutoSync] Phase 4: Verifying Master Session (Committed: ${committed}, Blocked: ${blocked})...`);
  Utilities.sleep(2000); // Safety buffer
  M1_PSP_SheetBuilder.refreshSessionData(sheet, AUTOSYNC_CONFIG.IDENTITY_NAME, false, true);
  
  return { committed: committed, blocked: blocked, attempted: uniqueUpdates.length };
}


// ═══════════════════════════════════════════════════════════════════════════════
// 4. REPORTING (The Professional Card UI)
// ═══════════════════════════════════════════════════════════════════════════════

function _sendDeveloperReport(report, batchId) {
  try {
    // 1. Context & Timestamps
    const timestamp = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const monthYear = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "MMMM yyyy");
    const subject = `${AUTOSYNC_CONFIG.EMAIL_PREFIX} - ${monthYear}`;
    
    // Prepare Data for SQL Hints (approximate execution window)
    const sqlTime = Utilities.formatDate(new Date(new Date().getTime() - 60000), "UTC", "yyyy-MM-dd HH:mm:ss");
    
    // Get Project ID for snippets (Safe Fetch)
    let projectId = 'YOUR_PROJECT_ID'; 
    let datasetId = 'YOUR_DATASET_ID';
    try {
       const coreConfig = ISC_SCM_Core_Lib.getCoreConfig();
       projectId = coreConfig.connection.PROJECT_ID;
       datasetId = coreConfig.connection.DATASET_ID;
    } catch(e) { console.warn('Config fetch for email failed'); }

    // 2. Build Card UI (UTF-8 Header Included)
    let htmlContent = `
      <html>
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #333; line-height: 1.6; }
          .card { border: 1px solid #ddd; border-radius: 8px; overflow: hidden; max-width: 600px; margin-bottom: 20px; }
          .header { background-color: ${report.status === 'SUCCESS' ? '#34A853' : '#EA4335'}; color: white; padding: 10px 15px; font-weight: bold; }
          .content { padding: 15px; }
          .table { width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 14px; }
          .table td { padding: 5px 0; border-bottom: 1px solid #eee; }
          .table td:first-child { font-weight: bold; color: #555; width: 140px; }
          .code-block { background: #f4f6f8; padding: 10px; border-radius: 4px; font-family: Consolas, Monaco, monospace; font-size: 12px; border: 1px solid #e1e4e8; overflow-x: auto; color: #24292e; }
          .logs { list-style-type: none; padding: 0; margin: 0; font-family: monospace; font-size: 12px; color: #555; }
          .logs li { margin-bottom: 4px; }
          .hint-title { font-size: 13px; font-weight: bold; color: #0366d6; margin-top: 15px; margin-bottom: 5px; }
          .footer { font-size: 11px; color: #999; margin-top: 15px; border-top: 1px solid #eee; padding-top: 5px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="header">
            ${report.status === 'SUCCESS' ? '✅' : '🔴'} AutoSync: ${report.status}
          </div>
          <div class="content">
            
            <table class="table">
              <tr><td>Batch ID</td><td>${batchId}</td></tr>
              <tr><td>Time</td><td>${timestamp}</td></tr>
              <tr><td>Rows Committed</td><td><strong>${report.rowsCommitted}</strong></td></tr>
              
              ${report.rowsBlocked > 0 ? 
                `<tr style="background-color: #fce8e6; color: #c5221f;">
                   <td>⛔ Blocked (Cancel)</td>
                   <td><strong>${report.rowsBlocked}</strong></td>
                 </tr>` 
              : ''}

              <tr><td>Bridges Woken</td><td>${report.bridgesRefreshed} / ${AUTOSYNC_CONFIG.BRIDGE_URLS.length}</td></tr>
            </table>

            <div class="hint-title">🕵️ Developer Clues</div>
            <div style="font-size: 12px; margin-bottom: 10px; color: #666;">
              Run these in BigQuery to verify this batch:
            </div>
            
            <div class="code-block">
              -- 1. Check Raw Input Logs (Production_Status_Log)<br>
              SELECT * FROM \`${projectId}.${datasetId}.Production_Status_Log\`<br>
              WHERE PROCESSED_AT >= TIMESTAMP('${sqlTime}')<br>
              ORDER BY LOG_ID DESC;
            </div>
            <div style="height: 8px;"></div>
            <div class="code-block">
              -- 2. Check Committed Orders (Production_Order)<br>
              SELECT * FROM \`${projectId}.${datasetId}.Production_Order\`<br>
              WHERE UPDATED_AT >= TIMESTAMP('${sqlTime}')<br>
              ORDER BY UPDATED_AT DESC;
            </div>

            <div class="hint-title">📜 Execution Logs</div>
            <ul class="logs">
              ${report.logs.map(l => `<li>${l}</li>`).join('')}
            </ul>

            ${report.errors.length > 0 ?
            `
              <div class="hint-title" style="color: #EA4335;">⚠️ Critical Errors</div>
              <ul class="logs" style="color: #EA4335;">
                ${report.errors.map(e => `<li>${e}</li>`).join('')}
              </ul>
            ` : ''}

            <div class="footer">
              Generated by M1_PSP_AutoSync.gs | ISC Supply Chain System
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    // 3. Find Thread or Create New (Monthly Buckets)
    const threads = GmailApp.search(`subject:"${subject}"`);
    let thread = null;
    
    if (threads.length > 0) {
      thread = threads[0];
      thread.reply("", { htmlBody: htmlContent });
    } else {
      GmailApp.sendEmail(AUTOSYNC_CONFIG.IDENTITY_EMAIL, subject, "", { htmlBody: htmlContent });
      Utilities.sleep(2000); 
      const newThreads = GmailApp.search(`subject:"${subject}"`);
      if (newThreads.length > 0) thread = newThreads[0];
    }

    // 4. Auto-Labeling
    if (thread && AUTOSYNC_CONFIG.EMAIL_LABEL) {
      let label = GmailApp.getUserLabelByName(AUTOSYNC_CONFIG.EMAIL_LABEL);
      if (!label) {
        label = GmailApp.createLabel(AUTOSYNC_CONFIG.EMAIL_LABEL);
      }
      label.addToThread(thread);
    }
    
  } catch (e) {
    console.error(`[AutoSync] Failed to send threaded email: ${e.message}`);
    MailApp.sendEmail({
      to: AUTOSYNC_CONFIG.IDENTITY_EMAIL,
      subject: `${AUTOSYNC_CONFIG.EMAIL_PREFIX} (Fallback)`,
      body: `Execution Report (HTML Failed). Status: ${report.status}. Error: ${e.message}`
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. ADMIN INSTALLER
// ═══════════════════════════════════════════════════════════════════════════════

function admin_InstallAutoSyncTrigger() {
  const ui = SpreadsheetApp.getUi();
  const triggerFunc = 'trigger_NightlyAutoSync';
  
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === triggerFunc) {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  try {
    // Schedule: Every Day at 00:00 (Midnight) (Vietnam Time)
    ScriptApp.newTrigger(triggerFunc)
      .timeBased()
      .everyDays(1)
      .atHour(0) 
      .inTimezone("Asia/Ho_Chi_Minh")
      .create();
      
    ui.alert('✅ Auto-Sync Installed', 'The Robot will run nightly at 00:00 (Midnight) VN Time.', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('❌ Error', `Failed to install trigger:\n${e.message}`, ui.ButtonSet.OK);
  }
}