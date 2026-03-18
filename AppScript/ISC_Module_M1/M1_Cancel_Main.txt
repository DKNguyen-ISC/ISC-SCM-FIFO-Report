/* -------------------------------------------------------------------------
 * FILE: ISC_Module_M1/M1_Cancel_Main.gs
 * DESCRIPTION: Business Logic Controller for Order Cancellation Admin Console
 * ARCHITECTURE: Search -> Stage -> Atomic Execute -> Zone C Feedback
 * VERSION: 7.13 (Menu Bootstrap Restored + All Robust Features)
 * DEPENDENCIES: M1_Cancel_Config, M1_Cancel_SheetBuilder, ISC_SCM_Core_Lib
 * ------------------------------------------------------------------------- */

const M1_Cancel_Main = {

  // ═══════════════════════════════════════════════════════════════════
  // 1. MENU HANDLERS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * \uD83D\uDCCB (Clipboard) Menu: Open or Reset the Console
   */
  menu_OpenConsole: function() {
    M1_Cancel_SheetBuilder.buildConsole();
  },

  /**
   * \uD83D\uDD0D (Magnifying Glass) Menu: Fetch Order(s) to Staging
   */
  menu_FetchOrder: function() {
    const config = getCancelConfig();
    const ui = SpreadsheetApp.getUi();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 1. Resolve Session Sheet (Dynamic User Mapping)
    const currentUser = Session.getEffectiveUser().getEmail();
    const sessionSheetName = generateSessionSheetName(currentUser);
    let sheet = ss.getSheetByName(sessionSheetName);
    
    // If sheet doesn't exist, build it first
    if (!sheet) {
      sheet = M1_Cancel_SheetBuilder.buildConsole();
    } else {
      sheet.activate();
    }
    
    // 2. Read Search Value from "Control Pod"
    const searchCell = sheet.getRange(config.SESSION.SEARCH_CELL);
    const searchValue = searchCell.getValue();
    
    // 3. Execute Search Logic (Builder handles SQL & UI)
    try {
      ss.toast('Querying Database...', '\uD83D\uDD0D Searching', 3);
      const result = M1_Cancel_SheetBuilder.loadOrdersToStaging(searchValue);
      
      if (result.success) {
        ss.toast(result.message, '\u2705 Search Complete', 5);
      } else {
        ui.alert('Search Result', result.message, ui.ButtonSet.OK);
      }
    } catch (e) {
      ui.alert('\u274C System Error', `Failed to fetch data: ${e.message}`, ui.ButtonSet.OK);
      console.error(e.stack);
    }
  },

  /**
   * \u26A1 (Zap) Menu: Execute Cancellation (The Core Transaction)
   */
  menu_ExecuteCancel: function() {
    const config = getCancelConfig();
    const ui = SpreadsheetApp.getUi();
    
    // 1. Read Staged Data
    const stagedOrders = M1_Cancel_SheetBuilder.readStagedOrders();
    if (stagedOrders.length === 0) {
      ui.alert('No Orders Staged', config.MESSAGES.NO_STAGED, ui.ButtonSet.OK);
      return;
    }
    
    // 2. Validate Inputs
    const validationErrors = this._validateStagedOrders(stagedOrders);
    if (validationErrors.length > 0) {
      ui.alert('\u26A0\uFE0F Validation Error', validationErrors.join('\n'), ui.ButtonSet.OK);
      return;
    }
    
    // 3. Confirm Intent (Uses Unicode-Safe UI builder)
    const confirmMsg = this._buildConfirmationMessage(stagedOrders);
    if (confirmMsg === "NOTHING_TO_DO") {
      SpreadsheetApp.getActiveSpreadsheet().toast('All staged orders are already cancelled.', '\u2139\uFE0F Done', 3);
      return;
    }

    const response = ui.alert(
      config.MESSAGES.CONFIRM_TITLE,
      confirmMsg,
      ui.ButtonSet.YES_NO
    );
    if (response !== ui.Button.YES) {
      SpreadsheetApp.getActiveSpreadsheet().toast('Cancellation aborted.', '\u274C Cancelled', 3);
      return;
    }
    
    // 4. Atomic Execution Loop
    const executionUser = Session.getActiveUser().getEmail();
    const results = this._executeAtomicLoop(stagedOrders, executionUser);
    
    // 5. POST-OP: Send Flight Recorder Email (V7.12 Labeling Enabled)
    // This runs silently in the background
    this._sendCancellationReport(results, executionUser, stagedOrders);

    // 6. Show Final Summary
    this._showExecutionSummary(results, ui);
  },

  /**
   * \uD83D\uDDD1\uFE0F (Trash) Menu: Clear Staging Area
   */
  menu_ClearStaging: function() {
    const config = getCancelConfig();
    const ui = SpreadsheetApp.getUi();
    
    const response = ui.alert(
      'Confirm Clear',
      config.MESSAGES.CLEAR_CONFIRM,
      ui.ButtonSet.YES_NO
    );
    if (response === ui.Button.YES) {
      M1_Cancel_SheetBuilder.clearStaging();
      SpreadsheetApp.getActiveSpreadsheet().toast('Staging cleared.', '\uD83D\uDDD1\uFE0F Cleared', 3);
    }
  },

  /**
   * \uD83D\uDCCA (Chart) Menu: View Recent Cancellations Report
   */
  menu_ViewRecentCancellations: function() {
    this._generateReport('_Recent_Cancellations', 'RECENT_CANCELLATIONS', '#D32F2F', 'Recent Cancellations');
  },

  /**
   * \uD83D\uDCE6 (Box) Menu: View Orphaned Supply Report
   */
  menu_ViewOrphanedSupply: function() {
    this._generateReport('_Orphaned_Supply', 'ORPHANED_SUPPLY', '#FF5722', 'Orphaned Supply');
  },

  // ═══════════════════════════════════════════════════════════════════
  // 2. PRIVATE LOGIC METHODS
  // ═══════════════════════════════════════════════════════════════════

  _validateStagedOrders: function(orders) {
    const errors = [];
    orders.forEach((order) => {
      // Idempotency: Skip already green rows (\u2705)
      if (order.currentStatus && order.currentStatus.includes('\u2705')) return;

      const rowNum = order.row;
      
      // Strict Number Check
      if (order.finalQty === '' || order.finalQty === null || isNaN(order.finalQty)) {
        errors.push(`Row ${rowNum} (${order.orderId}): Missing FINAL_QTY`);
      }
      
      if (!order.reasonLabel || order.reasonLabel === '') {
        errors.push(`Row ${rowNum} (${order.orderId}): Missing REASON`);
      }
    });
    return errors;
  },

  /**
   * \uD83C\uDFA8 UI HELPER: Builds a clean, aligned confirmation message
   * V7.10 Update: Uses Unicode Escape Sequences to prevent corruption
   */
  _buildConfirmationMessage: function(orders) {
    const pending = orders.filter(o => !o.currentStatus || !o.currentStatus.includes('\u2705'));
    if (pending.length === 0) return "NOTHING_TO_DO";

    var count = pending.length;
    // \u26A0\uFE0F Warning
    var msg = "\u26A0\uFE0F YOU ARE ABOUT TO CANCEL " + count + " ORDER(S)\n";
    msg += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n";

    pending.forEach(function(o) {
      // Truncate SKU if it's too long (over 60 chars)
      var cleanSku = String(o.sku || "N/A");
      if (cleanSku.length > 60) cleanSku = cleanSku.substring(0, 57) + "...";

      // \uD83C\uDD94 ID | \uD83D\uDCE6 Box | \uD83D\uDCCA Chart | \u2753 Question
      msg += "\uD83C\uDD94 " + o.orderId + " | VPO: " + o.vpo + "\n";
      msg += "\uD83D\uDCE6 " + cleanSku + "\n";
      msg += "\uD83D\uDCCA Progress: " + o.finalQty + " / " + o.orderQty + " (FG)\n";
      msg += "\u2753 Reason:   " + o.reasonLabel + "\n";
      msg += "──────────────────────────────────\n";
    });

    // \u26D4 No Entry
    msg += "\n\u26D4 ACTION CANNOT BE UNDONE.\n";
    msg += "Are you sure you want to proceed?";

    return msg;
  },

  _executeAtomicLoop: function(orders, executionUser) {
    const config = getCancelConfig();
    const coreConfig = ISC_SCM_Core_Lib.getCoreConfig();
    const projectId = coreConfig.connection.PROJECT_ID;
    const datasetId = coreConfig.connection.DATASET_ID;
    
    const results = {
      success: [],
      failed: [],
      warnings: []
    };
    // \uD83D\uDE80 Rocket
    SpreadsheetApp.getActiveSpreadsheet().toast(`Processing ${orders.length} orders...`, '\uD83D\uDE80 Executing', 60);

    orders.forEach(order => {
      if (order.currentStatus && order.currentStatus.includes('\u2705')) return;

      try {
        const reasonCode = getReasonCode(order.reasonLabel);
        
        // FIX: Ensure orderId is a string to prevent .replace error
        var safeOrderId = String(order.orderId);
        var cleanOrderId = safeOrderId.replace(/'/g, "\\'");

        // Construct SP Call
        const spCall = `CALL \`${projectId}.${datasetId}.SP_ADMIN_CANCEL_ORDER\`(` +
          `'${cleanOrderId}', ` +
          `${parseFloat(order.finalQty)}, ` +
          `'${reasonCode}', ` +
          `'${executionUser.replace(/'/g, "\\'")}')`;
        
        // \u23F3 Hourglass
        M1_Cancel_SheetBuilder.updateRowStatus(order.row, '\u23F3 Processing...', config.COLORS.ZONE_C_BG);
        SpreadsheetApp.flush(); 
        
        const spResult = ISC_SCM_Core_Lib.runReadQueryMapped(spCall);
        
        if (spResult && spResult.length > 0 && spResult[0].STATUS === 'SUCCESS') {
          const spWarnings = spResult[0].WARNINGS || [];
          
          if (spWarnings.length > 0) {
            // \u26A0\uFE0F Warning
            M1_Cancel_SheetBuilder.updateRowStatus(order.row, '\u26A0\uFE0F DONE (See Warnings)', config.COLORS.AMBER_WARNING);
            spWarnings.forEach(w => results.warnings.push(`${order.orderId}: ${w}`));
            results.success.push(order.orderId);
          } else {
            // \u2705 Check Mark
            M1_Cancel_SheetBuilder.updateRowStatus(order.row, '\u2705 CANCELLED', config.COLORS.GREEN_SUCCESS);
            results.success.push(order.orderId);
          }
        } else {
          const errorMsg = spResult && spResult.length > 0 
            ? `${spResult[0].CODE}: ${spResult[0].MESSAGE}` 
            : 'Unknown DB Error';
          // \u274C Cross Mark
          M1_Cancel_SheetBuilder.updateRowStatus(order.row, `\u274C ${errorMsg}`, config.COLORS.RED_ERROR);
          results.failed.push({ orderId: order.orderId, error: errorMsg });
        }
        
      } catch (e) {
        M1_Cancel_SheetBuilder.updateRowStatus(order.row, `\u274C SYS ERROR`, config.COLORS.RED_ERROR);
        results.failed.push({ orderId: order.orderId, error: e.message });
        console.error(`Error processing ${order.orderId}: ${e.stack}`);
      }
    });
    
    return results;
  },

  /**
   * \uD83D\uDCE7 FLIGHT RECORDER: Sends "Red Alert" email with Smart Revert SQL
   * V7.12 Upgrade: Implements "Send, Hunt, & Label" Logic + Web Safe Bodies
   */
  _sendCancellationReport: function(results, user, orders) {
    const config = getCancelConfig();
    
    // 1. Check Feature Flag
    if (!config.NOTIFICATIONS || !config.NOTIFICATIONS.ENABLE_EMAILS) return;
    if (results.success.length === 0) return; // Don't spam if nothing happened

    try {
      const coreConfig = ISC_SCM_Core_Lib.getCoreConfig();
      const projectId = coreConfig.connection.PROJECT_ID;
      const datasetId = coreConfig.connection.DATASET_ID;
      
      const timestamp = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      const monthYear = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "MMMM yyyy");
      
      // 2. Build Smart Revert SQL (Using CASE Statement for Mixed States)
      const idsList = results.success.map(id => `'${id}'`).join(', ');
      
      // Generate CASE WHEN lines for each successful order
      let caseWhenLines = '';
      results.success.forEach(id => {
        const details = orders.find(o => String(o.orderId) === String(id));
        const originalState = details ? details.originalState : 'PARTIALLY_RELEASED'; // Fallback safe
        caseWhenLines += `    WHEN PRODUCTION_ORDER_ID = '${id}' THEN '${originalState}'\n`;
      });

      const revertSql = `
UPDATE \`${projectId}.${datasetId}.Production_Order\`
SET 
  DATA_STATE = CASE 
${caseWhenLines}    ELSE DATA_STATE 
  END,
  CANCELLED_AT = NULL,
  CANCELLED_BY = NULL,
  CANCELLATION_REASON = NULL,
  FORCE_CLOSE_QTY = NULL,
  UPDATED_BY = 'ADMIN_REVERT_SCRIPT',
  UPDATED_AT = CURRENT_TIMESTAMP()
WHERE 
  PRODUCTION_ORDER_ID IN (${idsList})
  AND VALID_TO_TS IS NULL;
      `.trim();

      // 3. Build HTML Body (Using Decimal Entities to be 100% Safe)
      let orderListHtml = results.success.map(id => {
        const details = orders.find(o => String(o.orderId) === String(id));
        return `<li><b>${id}</b> | VPO: ${details ? details.vpo : '?'} | Reason: ${details ? details.reasonLabel : '?'}</li>`;
      }).join('');

      let htmlContent = `
        <html>
        <head>
          <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
        </head>
        <body style="font-family: sans-serif; color: #333;">
          <div style="border: 1px solid #ddd; border-radius: 8px; overflow: hidden; max-width: 600px;">
            <div style="background-color: #D32F2F; color: white; padding: 10px 15px; font-weight: bold;">
              &#128721; CANCELLED: ${results.success.length} Order(s)
            </div>
            <div style="padding: 15px;">
              <p><b>User:</b> ${user}<br><b>Time:</b> ${timestamp}</p>
              
              <div style="background: #FFF3E0; padding: 10px; border-left: 4px solid #FF9800; margin-bottom: 15px;">
                <b>Details:</b>
                <ul style="margin: 5px 0 0 0; padding-left: 20px; font-size: 13px;">
                  ${orderListHtml}
                </ul>
              </div>

              <div style="font-size: 13px; font-weight: bold; color: #0366d6; margin-bottom: 5px;">
                &#128373; Developer Actions (Emergency Undo)
              </div>
              <div style="background: #f4f6f8; padding: 10px; border: 1px solid #e1e4e8; 
                          font-family: monospace; font-size: 11px; overflow-x: auto; color: #24292e;">
                ${revertSql.replace(/\n/g, '<br>')}
              </div>
              
              <div style="font-size: 11px; color: #999; margin-top: 15px; border-top: 1px solid #eee; padding-top: 5px;">
                Generated by M1_Cancel_Main.gs | ISC Admin Console
              </div>
            </div>
          </div>
        </body>
        </html>
      `;

      // 4. Send Email (Send & Hunt Logic)
      const subject = config.NOTIFICATIONS.THREAD_BY_MONTH 
        ? `${config.NOTIFICATIONS.EMAIL_SUBJECT_PREFIX} - ${monthYear}`
        : `${config.NOTIFICATIONS.EMAIL_SUBJECT_PREFIX} - ${timestamp}`;

      const recipients = config.NOTIFICATIONS.RECIPIENTS.join(',');
      let thread = null;

      // Threading Magic
      const threads = GmailApp.search(`subject:"${subject}"`);
      if (threads.length > 0 && config.NOTIFICATIONS.THREAD_BY_MONTH) {
        // Reply to existing thread
        thread = threads[0];
        thread.reply("", { htmlBody: htmlContent, cc: recipients });
      } else {
        // Send new email
        GmailApp.sendEmail(recipients, subject, "", { htmlBody: htmlContent });
        
        // HUNT: Wait 2s for Gmail Indexing, then find the new thread
        Utilities.sleep(2000);
        const newThreads = GmailApp.search(`subject:"${subject}"`);
        if (newThreads.length > 0) {
          thread = newThreads[0];
        }
      }

      // 5. Auto-Labeling (Unified Audit Trail)
      if (thread && config.NOTIFICATIONS.EMAIL_LABEL) {
        let label = GmailApp.getUserLabelByName(config.NOTIFICATIONS.EMAIL_LABEL);
        // Create label if it doesn't exist
        if (!label) {
          label = GmailApp.createLabel(config.NOTIFICATIONS.EMAIL_LABEL);
        }
        label.addToThread(thread);
      }

    } catch (e) {
      console.error(`[M1 Cancel] Failed to send email report: ${e.message}`);
    }
  },

  _showExecutionSummary: function(results, ui) {
    const config = getCancelConfig();
    if (results.success.length === 0 && results.failed.length === 0 && results.warnings.length === 0) return; 

    let message = '';
    if (results.success.length > 0) {
      // \u2705 Check
      message += `\u2705 Cancelled: ${results.success.length} orders.\n`;
    }
    
    if (results.failed.length > 0) {
      // \u274C Cross
      message += `\u274C Failed: ${results.failed.length} orders.\n`;
      results.failed.forEach(f => message += `   • ${f.orderId}: ${f.error}\n`);
      message += '\n';
    }
    
    if (results.warnings.length > 0) {
      // \u26A0\uFE0F Warning
      message += `\n\u26A0\uFE0F CRITICAL WARNINGS:\n`;
      results.warnings.forEach(w => message += `   • ${w}\n`);
      
      // \uD83D\uDCCB Clipboard
      message += '\n\uD83D\uDCCB ACTION REQUIRED:\n';
      if (results.warnings.some(w => w.includes('ORPHANED_PRS'))) {
        message += '   • Check M3 Sourcing for Orphaned PRs.\n';
      }
      if (results.warnings.some(w => w.includes('PRIVATE_DEAD_STOCK'))) {
        message += '   • URGENT: Check "Orphaned Supply" report. Private materials at risk!\n';
      }
    }
    
    if (results.failed.length > 0 || results.warnings.length > 0) {
      ui.alert(config.MESSAGES.SUCCESS_TITLE, message, ui.ButtonSet.OK);
    } else {
      SpreadsheetApp.getActiveSpreadsheet().toast(
        `${results.success.length} order(s) cancelled successfully.`, 
        '\u2705 Complete', 
        5
      );
    }
  },

  _generateReport: function(sheetName, queryKey, tabColor, title) {
    const config = getCancelConfig();
    const ui = SpreadsheetApp.getUi();
    const coreConfig = ISC_SCM_Core_Lib.getCoreConfig();
    
    // Note: Reports don't need {SEARCH_TERM} replacement
    const query = config.QUERIES[queryKey]
      .replace('{PROJECT_ID}', coreConfig.connection.PROJECT_ID)
      .replace('{DATASET_ID}', coreConfig.connection.DATASET_ID);
    
    // \uD83D\uDCCA Chart
    SpreadsheetApp.getActiveSpreadsheet().toast(`Generating ${title}...`, '\uD83D\uDCCA Reporting', 3);
      
    const results = ISC_SCM_Core_Lib.runReadQueryMapped(query);
    
    if (!results || results.length === 0) {
      ui.alert('No Data', `No records found for ${title}.`, ui.ButtonSet.OK);
      return;
    }
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(sheetName);
    if (sheet) sheet.clear();
    else sheet = ss.insertSheet(sheetName);
    
    const headers = Object.keys(results[0]);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers])
         .setFontWeight('bold').setBackground('#1a1a2e').setFontColor('#ffffff');
    
    const rows = results.map(r => headers.map(h => r[h]));
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    
    sheet.setTabColor(tabColor);
    sheet.autoResizeColumns(1, headers.length);
    sheet.activate();
    
    if (queryKey === 'ORPHANED_SUPPLY') {
      const modeIdx = headers.indexOf('FULFILLMENT_MODE');
      if (modeIdx > -1) {
        const letter = this._colToLetter(modeIdx + 1);
        const range = sheet.getRange(2, 1, rows.length, headers.length);
        const rule = SpreadsheetApp.newConditionalFormatRule()
          .whenFormulaSatisfied(`=$${letter}2="PRIVATE"`)
          .setBackground('#FFCDD2')
          .setRanges([range])
          .build();
        sheet.setConditionalFormatRules([rule]);
      }
    }
    
    ss.toast(`Generated ${title} with ${rows.length} rows.`, 'Report Ready', 3);
  },

  _colToLetter: function(colIndex) {
    let temp, letter = '';
    while (colIndex > 0) {
      temp = (colIndex - 1) % 26;
      letter = String.fromCharCode(temp + 65) + letter;
      colIndex = (colIndex - temp - 1) / 26;
    }
    return letter;
  }
};

// ═══════════════════════════════════════════════════════════════════
// 🚀 BOOTSTRAP: Register the Menu
// This function MUST exist for onOpen() to find it
// ═══════════════════════════════════════════════════════════════════

function registerCancelAdminMenu() {
  SpreadsheetApp.getUi()
    .createMenu('🛑 Order Cancellation')
    .addItem('📋 Open Console', 'M1_Cancel_Main.menu_OpenConsole')
    .addSeparator()
    .addItem('🔍 Fetch Order', 'M1_Cancel_Main.menu_FetchOrder')
    .addItem('⚡ Execute Cancellation', 'M1_Cancel_Main.menu_ExecuteCancel')
    .addItem('🗑️ Clear Staging', 'M1_Cancel_Main.menu_ClearStaging')
    .addSeparator()
    .addItem('📊 View Recent Cancellations', 'M1_Cancel_Main.menu_ViewRecentCancellations')
    .addItem('📦 View Orphaned Supply', 'M1_Cancel_Main.menu_ViewOrphanedSupply')
    .addToUi();
}