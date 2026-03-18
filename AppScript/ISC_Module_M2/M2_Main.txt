/**
 * ⚖️ MODULE 2 MAIN: BALANCING ENGINE (Orchestrator V2.0)
 *
 * RESPONSIBILITIES:
 * 1. AUTOMATION: Runs the 'Nightly Freeze' (Regenerative MRP) at 04:00 AM.
 * 2. MANUAL OVERRIDE: Allows forced re-calculation for emergencies.
 * 3. LOGGING: Writes execution state to 'System_Execution_Log'.
 * 4. STATS RECORDING: Saves dual-method metrics to M2_Daily_Stats (Phase 6).
 * 5. ANALYTICS EMAIL: Mobile-first "Weather Report" with health status (Phase 6).
 * 6. LEDGER HEALTH: Monthly notification on M2_Pipeline_Ledger data lifecycle.
 *
 * DEPENDENCIES:
 * - ISC_SCM_Core_Lib (logStep, getCoreConfig, runWriteQuery, runReadQueryMapped, getSQLVault)
 *
 * V2.0 CHANGES (Phase 6):
 * - Added M2_ANALYTICS_CONFIG block (replacing old M2_CONFIG)
 * - runNightlyAllocation() now accepts 'source' parameter
 * - New: _recordDailyStats(), _fetchAnalyticFeed(), _sendAnalyticReport(),
 *        _sendFallbackEmail(), trigger_runNightlyAllocation()
 * - New: monthlyLedgerHealthCheck() — monthly data lifecycle notification
 * - Updated: admin_InstallTrigger() points to trigger_runNightlyAllocation
 * - Updated: menu_ForceRunAllocation() passes 'MANUAL' source
 *
 * Ref: M2_Email_HisAnalytic_Protocol_V2.txt (Part F)
 * Ref: shortage_calculation_implementation_plan.md (Phase 6, lines 519-678)
 */

// ═══════════════════════════════════════════════════════════════════════════
// M2 ANALYTICS CONFIGURATION (V2.0 - Hybrid Architecture)
// ═══════════════════════════════════════════════════════════════════════════

const M2_ANALYTICS_CONFIG = {
  // ─────────────────────────────────────────────────────────────────────────
  // IDENTITY
  // ─────────────────────────────────────────────────────────────────────────
  VERSION: '2.0',
  MODULE_ID: 'ISC_M2_BALANCING',

  // ─────────────────────────────────────────────────────────────────────────
  // EMAIL (Following M1/M4 Pattern)
  // ─────────────────────────────────────────────────────────────────────────
  EMAIL_RECIPIENTS: ['dk@isconline.vn'],
  EMAIL_PREFIX: '[ISC M2]',
  EMAIL_LABEL: 'ISC_Logs',

  // ─────────────────────────────────────────────────────────────────────────
  // TIMING
  // ─────────────────────────────────────────────────────────────────────────
  TIMEZONE: 'Asia/Ho_Chi_Minh',
  TRIGGER_FUNC: 'trigger_runNightlyAllocation',

  // ─────────────────────────────────────────────────────────────────────────
  // LOOKER STUDIO INTEGRATION
  LOOKER_DASHBOARD_URL: 'https://lookerstudio.google.com/reporting/6ddd2453-fa58-44df-8375-8255f5cc62d6',

  // ─────────────────────────────────────────────────────────────────────────
  // RUN SOURCE CONSTANTS
  // ─────────────────────────────────────────────────────────────────────────
  SOURCE: {
    NIGHTLY: 'NIGHTLY',
    MANUAL: 'MANUAL',
    CHAIN: 'CHAIN'
  },

  // ─────────────────────────────────────────────────────────────────────────
  // HEALTH STATUS DISPLAY
  // ─────────────────────────────────────────────────────────────────────────
  HEALTH_ICONS: {
    'CLEAR': '🟢',
    'CLOUDY': '🟡',
    'STORM': '🔴'
  },
  HEALTH_LABELS: {
    'CLEAR': 'Clear Skies',
    'CLOUDY': 'Cloudy',
    'STORM': 'Storm Warning'
  }
};


// =========================================================
// 1. UI & MENUS (The Manual Override)
// =========================================================

function onOpen() {
  const ui = SpreadsheetApp.getUi();

  const menu = ui.createMenu('⚖️ ISC Module 2');

  menu.addItem('⚡ Force Run Allocation (Emergency)', 'menu_ForceRunAllocation')
      .addSeparator();

  menu.addSubMenu(ui.createMenu('🔧 Admin Tools')
      .addItem('⏰ Install Nightly Trigger', 'admin_InstallTrigger')
      .addItem('🚫 Remove All Triggers', 'admin_RemoveTriggers')
  );

  menu.addToUi();
}

/**
 * ⚡ MANUAL OVERRIDE (Menu Action)
 * Wraps the engine execution with UI alerts and confirmation.
 * V2.0: Now passes 'MANUAL' source parameter.
 */
function menu_ForceRunAllocation() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.alert(
    '⚡ FORCE ALLOCATION RUN?',
    'WARNING: This will WIPEOUT the current Shortage List (PR_Draft) and re-calculate based on live data.\n\n' +
    '• Any "Draft" work not yet booked will be reset.\n' +
    '• This process takes about 30-60 seconds.\n\n' +
    'Are you sure you want to proceed?',
    ui.ButtonSet.YES_NO
  );

  if (response !== ui.Button.YES) return;

  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    spreadsheet.toast('🚀 Starting Matching Engine...', 'ISC System');

    runNightlyAllocation(M2_ANALYTICS_CONFIG.SOURCE.MANUAL);

    spreadsheet.toast('✅ Calculation Complete.', 'ISC System');
    ui.alert('✅ Success', 'The Matching Engine has successfully refreshed the Shortage List.', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('❌ Execution Failed', e.message, ui.ButtonSet.OK);
  }
}


// =========================================================
// 2. THE WORKER (The Engine — V2.0 Hybrid Architecture)
// =========================================================

/**
 * 🌙 MAIN ENTRY POINT (V2.0 - Hybrid Architecture)
 *
 * This function:
 * 1. Executes SP_RUN_MATCHING_ENGINE (existing logic)
 * 2. Records stats via SP_M2_RECORD_DAILY_STATS (Phase 6)
 * 3. Fetches pre-computed analytics from M2_Analytic_Feed_VIEW
 * 4. Renders and sends minimal email with Looker link
 *
 * @param {string} source - Run source: 'NIGHTLY', 'MANUAL', 'CHAIN'
 */
function runNightlyAllocation(source) {
  const runSource = source || M2_ANALYTICS_CONFIG.SOURCE.MANUAL;
  const batchId = Utilities.getUuid();
  const startTime = new Date();

  console.log(`[${batchId}] Starting M2 Balancing Engine (Source: ${runSource})...`);
  ISC_SCM_Core_Lib.logStep(batchId, M2_ANALYTICS_CONFIG.MODULE_ID, 1, 'START_RUN', 'RUNNING');

  let runStatus = 'SUCCESS';
  let errorMessage = null;
  let duration = 0;

  try {
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: EXECUTE THE ENGINE (Existing Logic - Unchanged)
    // ═══════════════════════════════════════════════════════════════════════
    const config = ISC_SCM_Core_Lib.getCoreConfig();
    const project = config.connection.PROJECT_ID;
    const dataset = config.connection.DATASET_ID;

    const sql = `CALL \`${project}.${dataset}.SP_RUN_MATCHING_ENGINE\`()`;
    ISC_SCM_Core_Lib.runWriteQuery(sql);

    duration = (new Date() - startTime) / 1000;
    console.log(`[${batchId}] Engine completed in ${duration}s`);

    ISC_SCM_Core_Lib.logStep(batchId, M2_ANALYTICS_CONFIG.MODULE_ID, 2,
      'SP_RUN_MATCHING_ENGINE', 'SUCCESS', duration);

  } catch (e) {
    // ═══════════════════════════════════════════════════════════════════════
    // HANDLE ENGINE FAILURE
    // ═══════════════════════════════════════════════════════════════════════
    runStatus = 'FAILED';
    errorMessage = e.message;
    duration = (new Date() - startTime) / 1000;

    console.error(`[${batchId}] Engine FAILED: ${e.message}`);
    ISC_SCM_Core_Lib.logStep(batchId, M2_ANALYTICS_CONFIG.MODULE_ID, 2,
      'SP_RUN_MATCHING_ENGINE', 'FAILED', duration, e.message);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 2: RECORD STATS TO HISTORY (Always runs, even on failure)
  // Non-fatal — if this fails, we still send email.
  // ═══════════════════════════════════════════════════════════════════════
  try {
    _recordDailyStats(batchId, runSource, runStatus, duration, errorMessage);
    console.log(`[${batchId}] Stats recorded to M2_Daily_Stats`);
  } catch (recordError) {
    console.warn(`[${batchId}] Failed to record stats: ${recordError.message}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 3: FETCH ANALYTICS & SEND EMAIL (Always runs)
  // Non-fatal — if analytics fails, we send fallback email.
  // ═══════════════════════════════════════════════════════════════════════
  try {
    const analytics = _fetchAnalyticFeed();
    _sendAnalyticReport(analytics, batchId, runSource, runStatus, duration, errorMessage);
    console.log(`[${batchId}] Email sent successfully`);
  } catch (emailError) {
    console.error(`[${batchId}] Email failed: ${emailError.message}`);
    _sendFallbackEmail(batchId, runSource, runStatus, errorMessage);
  }

  // Re-throw original error if engine failed (so Google notifies script owner)
  if (runStatus === 'FAILED') {
    throw new Error(errorMessage);
  }
}


// =========================================================
// 3. ANALYTICS HELPER FUNCTIONS (Phase 6)
// =========================================================

/**
 * 🔢 FORMAT NUMBER with thousand separators
 * e.g., 3392597.125 → "3,392,597"
 * @param {number} num - Number to format
 * @return {string} Formatted string with commas
 */
function _fmtNum(num) {
  if (num === null || num === undefined || isNaN(num)) return '0';
  return Math.round(Number(num)).toLocaleString('en-US');
}

/**
 * 📊 RECORD DAILY STATS
 * Calls SP_M2_RECORD_DAILY_STATS to MERGE execution metrics into M2_Daily_Stats.
 * Ref: SQL_Vault.txt SP_M2_RECORD_DAILY_STATS
 */
function _recordDailyStats(batchId, runSource, runStatus, duration, errorMessage) {
  const config = ISC_SCM_Core_Lib.getCoreConfig();
  const project = config.connection.PROJECT_ID;
  const dataset = config.connection.DATASET_ID;

  const safeError = errorMessage ? `'${errorMessage.replace(/'/g, "''")}'` : 'NULL';

  const sql = `CALL \`${project}.${dataset}.SP_M2_RECORD_DAILY_STATS\`(
    '${batchId}',
    '${runSource}',
    '${runStatus}',
    ${duration},
    ${safeError}
  )`;

  ISC_SCM_Core_Lib.runWriteQuery(sql);
}

/**
 * 📈 FETCH ANALYTIC FEED
 * Reads pre-computed analytics from M2_Analytic_Feed_VIEW.
 * The VIEW does ALL computation — this function just reads.
 * Returns a single object with ~35 pre-computed fields.
 * Ref: SQL_Vault.txt M2_Analytic_Feed_VIEW
 */
function _fetchAnalyticFeed() {
  const config = ISC_SCM_Core_Lib.getCoreConfig();
  const project = config.connection.PROJECT_ID;
  const dataset = config.connection.DATASET_ID;

  const sql = `SELECT * FROM \`${project}.${dataset}.M2_Analytic_Feed_VIEW\``;
  const results = ISC_SCM_Core_Lib.runReadQueryMapped(sql);

  if (results && results.length > 0) {
    const row = results[0];

    // ─── FIX: BQ REST API returns all values as strings in cell.v ───
    // Boolean 'false' becomes string "false" which is truthy in JS.
    // Coerce known boolean fields to actual booleans.
    row.is_anomaly = (row.is_anomaly === true || row.is_anomaly === 'true');
    row.is_first_run = (row.is_first_run === true || row.is_first_run === 'true');
    row.should_alert = (row.should_alert === true || row.should_alert === 'true');

    // ─── FIX: Coerce numeric strings to numbers ───
    // BQ REST API also returns numbers as strings (e.g., "4803").
    const numericFields = [
      'shortage_count', 'shortage_total_qty', 'allocation_count',
      'yesterday_shortage_count', 'yesterday_shortage_qty', 'yesterday_allocation_count',
      'shortage_delta', 'shortage_delta_percent',
      'allocation_delta', 'allocation_delta_percent',
      'top1_qty', 'top1_percent', 'top2_qty', 'top2_percent',
      'top3_qty', 'top3_percent', 'top3_combined_percent',
      'sc_completion', 'sc_issuance', 'stc_qty', 'sti_qty', 'method_delta',
      'history_days_available'
    ];
    numericFields.forEach(f => {
      if (row[f] !== null && row[f] !== undefined) {
        row[f] = Number(row[f]);
      }
    });

    return row;
  }

  // Fallback: return minimal analytics if VIEW returns empty
  return {
    shortage_count: 0,
    allocation_count: 0,
    health_status: 'STORM',
    is_anomaly: true,
    anomaly_reason: 'NO_DATA: Analytics view returned empty.',
    is_first_run: true,
    sc_completion: 0,
    sc_issuance: 0,
    stc_qty: 0,
    sti_qty: 0,
    method_delta: 0,
    method_comparison_insight: 'No data available'
  };
}

/**
 * 📧 SEND ANALYTIC REPORT (Mobile-First HTML Email)
 *
 * Design Principles:
 * - Minimal height (~400px visible without scrolling)
 * - Instant-read health status (Weather Report pattern)
 * - Dual-method comparison section (Phase 6 enhancement)
 * - One clear call-to-action (Looker link)
 * - SQL clues at bottom for developers
 * - Monthly threading + ISC_Logs label
 *
 * Ref: M2_Email_HisAnalytic_Protocol_V2.txt Part F.5, Part I
 */
function _sendAnalyticReport(analytics, batchId, runSource, runStatus, duration, errorMessage) {
  const cfg = M2_ANALYTICS_CONFIG;
  const timeStr = Utilities.formatDate(new Date(), cfg.TIMEZONE, 'HH:mm:ss dd/MM/yyyy');
  const monthYear = Utilities.formatDate(new Date(), cfg.TIMEZONE, 'MMMM yyyy');
  const dateStr = Utilities.formatDate(new Date(), cfg.TIMEZONE, 'MMM d');

  // Determine health status
  const healthStatus = runStatus === 'FAILED' ? 'FAILED' : (analytics.health_status || 'CLOUDY');
  const healthIcon = runStatus === 'FAILED' ? '⛔' : (cfg.HEALTH_ICONS[healthStatus] || '🟡');
  const healthLabel = runStatus === 'FAILED' ? 'Engine Failure' : (cfg.HEALTH_LABELS[healthStatus] || 'Unknown');

  // Subject with health status
  const subject = `${cfg.EMAIL_PREFIX} ${healthIcon} ${healthLabel} – ${dateStr}`;

  // Build delta display
  let deltaDisplay = '';
  if (analytics.is_first_run) {
    deltaDisplay = '<span style="color:#666;">(First run – baseline established)</span>';
  } else if (analytics.shortage_delta_percent !== null && analytics.shortage_delta_percent !== undefined) {
    const arrow = analytics.shortage_delta_percent > 0 ? '↑' : (analytics.shortage_delta_percent < 0 ? '↓' : '→');
    const color = analytics.shortage_delta_percent > 0 ? '#EA4335' : (analytics.shortage_delta_percent < 0 ? '#34A853' : '#666');
    deltaDisplay = `<span style="color:${color};">${arrow} ${Math.abs(analytics.shortage_delta_percent)}% from yesterday</span>`;
  }

  // Build top offender display
  let topOffenderDisplay = '';
  if (analytics.top1_bom) {
    topOffenderDisplay = `
      <div style="margin-top:12px; padding:10px; background:#f8f9fa; border-radius:6px;">
        <div style="font-size:11px; color:#666; margin-bottom:4px;">🎯 TOP ISSUE</div>
        <div style="font-size:14px; font-weight:bold;">${analytics.top1_bom}</div>
        <div style="font-size:12px; color:#666;">${_fmtNum(analytics.top1_qty)} units (${analytics.top1_percent}% of total)</div>
      </div>
    `;
  }

  // Build dual-method comparison section (Phase 6 Enhancement)
  let dualMethodDisplay = '';
  if (runStatus === 'SUCCESS' && analytics.sc_completion !== undefined) {
    const phantomCount = (analytics.sc_completion || 0) - (analytics.sc_issuance || 0);
    dualMethodDisplay = `
      <div style="margin-top:12px; padding:10px; background:#e8f0fe; border:1px solid #c6dafc; border-radius:6px;">
        <div style="font-size:11px; font-weight:bold; color:#1a73e8; margin-bottom:6px;">📊 DUAL-METHOD COMPARISON</div>
        <table style="width:100%; font-size:12px; border-collapse:collapse;">
          <tr><td style="padding:2px 0;">Completion shortages</td><td style="text-align:right;">${_fmtNum(analytics.sc_completion || 0)} items (${_fmtNum(Math.round(analytics.stc_qty || 0))} qty)</td></tr>
          <tr><td style="padding:2px 0;">Issuance shortages</td><td style="text-align:right;">${_fmtNum(analytics.sc_issuance || 0)} items (${_fmtNum(Math.round(analytics.sti_qty || 0))} qty)</td></tr>
          <tr><td style="padding:2px 0;">Method delta</td><td style="text-align:right;">${_fmtNum(analytics.method_delta || 0)} items disagree by >10%</td></tr>
          <tr><td style="padding:2px 0;">Phantom shortages</td><td style="text-align:right;">${_fmtNum(Math.max(0, phantomCount))} (Completion > 0, Issuance = 0)</td></tr>
        </table>
        <div style="font-size:11px; color:#5f6368; margin-top:4px; font-style:italic;">${analytics.method_comparison_insight || ''}</div>
      </div>
    `;
  }

  // Build anomaly warning
  let anomalyDisplay = '';
  if (analytics.is_anomaly) {
    anomalyDisplay = `
      <div style="margin-top:12px; padding:10px; background:#fff3cd; border:1px solid #ffc107; border-radius:6px;">
        <div style="font-weight:bold; color:#856404;">⚠️ ANOMALY DETECTED</div>
        <div style="font-size:12px; color:#856404;">${analytics.anomaly_reason || 'Unusual pattern detected.'}</div>
      </div>
    `;
  }

  // Build error display
  let errorDisplay = '';
  if (runStatus === 'FAILED') {
    errorDisplay = `
      <div style="margin-top:12px; padding:10px; background:#fce8e6; border:1px solid #f5c6cb; border-radius:6px;">
        <div style="font-weight:bold; color:#c5221f;">⛔ ENGINE FAILED</div>
        <div style="font-size:12px; color:#c5221f; font-family:monospace;">${errorMessage || 'Unknown error'}</div>
      </div>
    `;
  }

  // Get BigQuery identifiers for SQL clues
  let projectId = 'PROJECT_ID';
  let datasetId = 'DATASET_ID';
  try {
    const coreConfig = ISC_SCM_Core_Lib.getCoreConfig();
    projectId = coreConfig.connection.PROJECT_ID;
    datasetId = coreConfig.connection.DATASET_ID;
  } catch (e) { /* Ignore */ }

  // Determine header color
  const headerColors = {
    'CLEAR': '#34A853',
    'CLOUDY': '#F9AB00',
    'STORM': '#EA4335',
    'FAILED': '#EA4335'
  };
  const headerColor = headerColors[healthStatus] || '#F9AB00';

  // Build HTML (Mobile-First Design)
  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 0; background: #f5f5f5; }
    .container { max-width: 400px; margin: 0 auto; background: #fff; }
    .header { background: ${headerColor}; color: white; padding: 16px; text-align: center; }
    .header-icon { font-size: 32px; }
    .header-title { font-size: 18px; font-weight: bold; margin-top: 4px; }
    .content { padding: 16px; }
    .metric-box { text-align: center; padding: 16px 0; }
    .metric-value { font-size: 36px; font-weight: bold; color: #333; }
    .metric-label { font-size: 12px; color: #666; text-transform: uppercase; }
    .metric-delta { font-size: 14px; margin-top: 4px; }
    .cta-button { display: block; background: #1a73e8; color: white; text-align: center; padding: 14px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 16px 0; }
    .meta-table { width: 100%; font-size: 11px; color: #666; border-collapse: collapse; }
    .meta-table td { padding: 4px 0; border-bottom: 1px solid #eee; }
    .sql-section { margin-top: 16px; padding: 12px; background: #f8f9fa; border-radius: 6px; }
    .sql-title { font-size: 11px; font-weight: bold; color: #666; margin-bottom: 8px; }
    .sql-code { font-family: Consolas, monospace; font-size: 10px; color: #333; word-break: break-all; }
    .footer { font-size: 10px; color: #999; text-align: center; padding: 12px; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="container">
    <!-- HEADER -->
    <div class="header">
      <div class="header-icon">${healthIcon}</div>
      <div class="header-title">${healthLabel}</div>
    </div>

    <!-- CONTENT -->
    <div class="content">
      <!-- KEY METRIC -->
      <div class="metric-box">
        <div class="metric-label">Shortages</div>
        <div class="metric-value">${runStatus === 'FAILED' ? '—' : _fmtNum(analytics.shortage_count)}</div>
        <div class="metric-delta">${deltaDisplay}</div>
      </div>

      <!-- SECONDARY METRICS -->
      ${runStatus === 'SUCCESS' ? `
      <table class="meta-table">
        <tr><td>Allocations Reserved</td><td style="text-align:right;">${_fmtNum(analytics.allocation_count)}</td></tr>
        <tr><td>Trigger Source</td><td style="text-align:right;">${runSource}</td></tr>
        <tr><td>Duration</td><td style="text-align:right;">${duration.toFixed(1)}s</td></tr>
        <tr><td>Time (VN)</td><td style="text-align:right;">${timeStr}</td></tr>
      </table>
      ` : ''}

      <!-- TOP OFFENDER -->
      ${topOffenderDisplay}

      <!-- DUAL-METHOD COMPARISON (Phase 6) -->
      ${dualMethodDisplay}

      <!-- ANOMALY WARNING -->
      ${anomalyDisplay}

      <!-- ERROR DISPLAY -->
      ${errorDisplay}

      <!-- CTA BUTTONS (Phase 8.3 Enhancements) -->
      <a href="${cfg.LOOKER_DASHBOARD_URL}" class="cta-button">📊 Open Executive Dashboard</a>
      
      <div style="display:flex; gap:10px; margin-bottom:16px;">
        <a href="${cfg.LOOKER_DASHBOARD_URL}/page/p_3th7t68rmd" class="cta-button" style="flex:1; margin:0; background:#f1f3f4; color:#1a73e8; border:1px solid #dadce0; font-size:12px;">🔍 Shortage Deep Dive</a>
        <a href="${cfg.LOOKER_DASHBOARD_URL}/page/p_66o7t68rmd" class="cta-button" style="flex:1; margin:0; background:#f1f3f4; color:#1a73e8; border:1px solid #dadce0; font-size:12px;">📦 Supply Coverage</a>
      </div>

      <!-- SQL CLUES (for developers) -->
      <div class="sql-section">
        <div class="sql-title">🕵️ Developer Queries</div>
        <div class="sql-code">
          SELECT * FROM \`${projectId}.${datasetId}.PR_Draft\` LIMIT 20;<br><br>
          SELECT * FROM \`${projectId}.${datasetId}.M2_Daily_Stats\` ORDER BY RUN_DATE DESC LIMIT 7;
        </div>
      </div>
    </div>

    <!-- FOOTER -->
    <div class="footer">
      Generated by M2_Main.gs V${cfg.VERSION} | Batch: ${batchId.substring(0, 8)}
    </div>
  </div>
</body>
</html>
  `;

  // ═══════════════════════════════════════════════════════════════════════
  // SEND WITH THREADING (M1/M4 Pattern)
  // Monthly thread grouping + ISC_Logs label
  // ═══════════════════════════════════════════════════════════════════════
  const threadSubject = `${cfg.EMAIL_PREFIX} Balancing Engine Report – ${monthYear}`;
  const threads = GmailApp.search(`subject:"${threadSubject}"`);
  let thread = null;

  if (threads.length > 0) {
    thread = threads[0];
    thread.reply('', { htmlBody: htmlBody, subject: subject });
    console.log(`[M2] Replied to existing thread.`);
  } else {
    GmailApp.sendEmail(
      cfg.EMAIL_RECIPIENTS.join(','),
      subject,
      '',
      { htmlBody: htmlBody }
    );
    Utilities.sleep(2000);
    const newThreads = GmailApp.search(`subject:"${threadSubject}"`);
    if (newThreads.length > 0) thread = newThreads[0];
    console.log(`[M2] Created new thread.`);
  }

  // Apply label
  if (thread && cfg.EMAIL_LABEL) {
    let label = GmailApp.getUserLabelByName(cfg.EMAIL_LABEL);
    if (!label) label = GmailApp.createLabel(cfg.EMAIL_LABEL);
    label.addToThread(thread);
  }
}

/**
 * 📧 FALLBACK EMAIL (Plain Text)
 * Sent when the main HTML email rendering fails.
 * Uses MailApp instead of GmailApp for maximum reliability.
 */
function _sendFallbackEmail(batchId, runSource, runStatus, errorMessage) {
  try {
    MailApp.sendEmail({
      to: M2_ANALYTICS_CONFIG.EMAIL_RECIPIENTS[0],
      subject: `${M2_ANALYTICS_CONFIG.EMAIL_PREFIX} ${runStatus} (Fallback)`,
      body: `M2 Balancing Engine Report (Fallback — HTML rendering failed)\n\n` +
            `Status: ${runStatus}\n` +
            `Source: ${runSource}\n` +
            `Batch: ${batchId}\n` +
            `Error: ${errorMessage || 'None'}\n\n` +
            `Check BigQuery M2_Daily_Stats and M2_Analytic_Feed_VIEW for details.`
    });
  } catch (e) {
    console.error(`[M2] Fallback email also failed: ${e.message}`);
  }
}


// =========================================================
// 4. TRIGGER MANAGEMENT (Admin Tools)
// =========================================================

/**
 * 🌙 NIGHTLY TRIGGER TARGET (V2.0)
 * Time-driven trigger calls this wrapper, which passes 'NIGHTLY' source.
 * Install with: admin_InstallTrigger()
 */
function trigger_runNightlyAllocation() {
  runNightlyAllocation(M2_ANALYTICS_CONFIG.SOURCE.NIGHTLY);
}

/**
 * ⏰ SETUP: Install the 04:00 AM Trigger
 * Run this ONCE when deploying the system.
 * V2.0: Now points to trigger_runNightlyAllocation (wrapper with source).
 */
function admin_InstallTrigger() {
  const ui = SpreadsheetApp.getUi();

  // 1. Clean up old triggers first to avoid duplicates
  admin_RemoveTriggers(false);

  // 2. Create New Trigger — points to V2.0 wrapper
  ScriptApp.newTrigger(M2_ANALYTICS_CONFIG.TRIGGER_FUNC)
    .timeBased()
    .everyDays(1)
    .atHour(4)
    .inTimezone(M2_ANALYTICS_CONFIG.TIMEZONE)
    .create();

  ui.alert('✅ Trigger Installed',
    'The Matching Engine will now run automatically at 04:00 AM VN Time.\n' +
    'Trigger target: trigger_runNightlyAllocation (V2.0 with analytics)',
    ui.ButtonSet.OK);
}

/**
 * 🚫 TEARDOWN: Remove All M2 Triggers
 */
function admin_RemoveTriggers(showAlert = true) {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  for (const trigger of triggers) {
    const handler = trigger.getHandlerFunction();
    // Remove both old (runNightlyAllocation) and new (trigger_runNightlyAllocation) triggers
    if (handler === M2_ANALYTICS_CONFIG.TRIGGER_FUNC || handler === 'runNightlyAllocation') {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  }

  if (showAlert) {
    const ui = SpreadsheetApp.getUi();
    ui.alert('🚫 Triggers Removed', `Removed ${removed} trigger(s). Automation is now disabled.`, ui.ButtonSet.OK);
  }
}


// =========================================================
// 5. MONTHLY LEDGER HEALTH CHECK (Phase 6)
// =========================================================

/**
 * 📅 MONTHLY LEDGER HEALTH CHECK
 *
 * Purpose: Sends a monthly notification email about M2_Pipeline_Ledger data lifecycle.
 * Does NOT delete data — deletion uses SQL_Vault M2_Pipeline_Ledger_Cleanup
 * (deployed as BQ Scheduled Query or called manually).
 *
 * Trigger: Time-driven, 1st of each month
 * Install: ScriptApp.newTrigger('monthlyLedgerHealthCheck').timeBased().onMonthDay(1).atHour(8).create();
 *
 * Ref: shortage_calculation_implementation_plan.md (Phase 6, lines 608-623)
 */
function monthlyLedgerHealthCheck() {
  const cfg = M2_ANALYTICS_CONFIG;

  try {
    const config = ISC_SCM_Core_Lib.getCoreConfig();
    const project = config.connection.PROJECT_ID;
    const dataset = config.connection.DATASET_ID;

    // Query ledger statistics
    const sql = `
      SELECT
        COUNT(*) AS total_rows,
        MIN(LEDGER_DATE) AS earliest_date,
        MAX(LEDGER_DATE) AS latest_date,
        DATE_DIFF(MAX(LEDGER_DATE), MIN(LEDGER_DATE), DAY) AS days_captured,
        COUNTIF(LEDGER_DATE < DATE_SUB(CURRENT_DATE('Asia/Ho_Chi_Minh'), INTERVAL 12 MONTH)) AS rows_pending_cleanup
      FROM \`${project}.${dataset}.M2_Pipeline_Ledger\`
    `;

    const results = ISC_SCM_Core_Lib.runReadQueryMapped(sql);
    const stats = results && results.length > 0 ? results[0] : {};

    const dateStr = Utilities.formatDate(new Date(), cfg.TIMEZONE, 'MMMM yyyy');

    const body = `📅 M2 Pipeline Ledger — Monthly Health Check (${dateStr})\n\n` +
      `Total Rows: ${stats.total_rows || 0}\n` +
      `Date Range: ${stats.earliest_date || 'N/A'} → ${stats.latest_date || 'N/A'}\n` +
      `Days Captured: ${stats.days_captured || 0}\n` +
      `Rows Pending Cleanup (>12 months): ${stats.rows_pending_cleanup || 0}\n\n` +
      `Retention Policy: 12 months\n` +
      `Cleanup SQL: SQL_Vault.M2_Pipeline_Ledger_Cleanup\n\n` +
      `This is an automated notification. No action required unless rows_pending_cleanup > 0.\n` +
      `To run cleanup: Execute M2_Pipeline_Ledger_Cleanup from SQL_Vault via admin_DeploySQLAssets or BQ Console.`;

    MailApp.sendEmail({
      to: cfg.EMAIL_RECIPIENTS[0],
      subject: `${cfg.EMAIL_PREFIX} 📅 Ledger Health Check – ${dateStr}`,
      body: body
    });

    console.log(`[M2] Monthly ledger health check sent. Rows: ${stats.total_rows}, Pending cleanup: ${stats.rows_pending_cleanup}`);

  } catch (e) {
    console.error(`[M2] Monthly ledger health check failed: ${e.message}`);
  }
}