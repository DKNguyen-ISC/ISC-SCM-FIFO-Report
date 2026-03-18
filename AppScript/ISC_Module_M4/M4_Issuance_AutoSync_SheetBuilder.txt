/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 📋 M4_ISSUANCE_AUTOSYNC_SHEETBUILDER.gs (V1.0)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 * Creates and manages material-specific dashboard tabs for the Issuance AutoSync
 * pipeline. Each active ISSUANCE_SOURCE gets its own named tab:
 *   'Lead_Issuance_AutoSync'  — for SOURCE_ID = 'CHI_LEAD'
 *   'Paint_Issuance_AutoSync' — for SOURCE_ID = 'PAINT' (future)
 *
 * LAYOUT (mirrors ZXH Gateway pattern exactly):
 *   Row 1:     Title bar (deep teal, spans full width)
 *   Row 2-3:   Dashboard summary (Last Run, Status, Staged/Ins/Upd/Orphans)
 *   Row 4:     Zone A label (left) + Zone B label (right)
 *   Row 5:     Column headers for Zone A (cols 1-7) and Zone B (cols 9-18)
 *   Col 8:     Narrow spacer between zones
 *   Row 6+:    Zone A data (cleared + rewritten each run via batch setValues)
 *              Zone B run history (prepended, newest first, max 50 entries)
 *
 * ZONE A (7 cols — validated data committed to BQ this run):
 *   BOM_UPDATE │ VPO │ CUMULATIVE_ISSUANCE_QTY │ SNAPSHOT_DATE │
 *   SOURCE_BOM_CODE │ MAIN_GROUP │ RESOLUTION_METHOD
 *
 * ZONE B (10 cols — matches ZXH Run History exactly):
 *   Timestamp │ Session ID │ Source │ Status │ Staged │ Inserted │
 *   Updated │ Orphans │ Duration (s) │ Error
 *
 * COMPANION FILES:
 *   M4_Issuance_AutoSync_Config.gs — ISSUANCE_SOURCES, ISSUANCE_DASHBOARD_CONFIG
 *   M4_Issuance_AutoSync_Main.gs   — Calls _updateIssuanceDashboard() after each run
 *
 * VERSION: 1.0
 * DATE: March 2026
 * ═══════════════════════════════════════════════════════════════════════════════
 */


// ═══════════════════════════════════════════════════════════════════════════════
// 1. DASHBOARD WRITER — Called after each sync run per source
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Updates one material's dashboard tab after a sync run.
 *
 * 1. Fetches ALL staged rows from Material_Issuance_Staging for this SYNC_BATCH_ID
 *    → Zone A (left): cleared + rewritten via batch setValues() (1 API call)
 * 2. Updates dashboard summary rows (rows 2-3): Last Run, Status, counts
 * 3. Prepends a new row to Zone B Run History (right side, newest first)
 *
 * Notes:
 * - If the tab does not exist, auto-creates it (idempotent).
 * - Zone A shows ONLY the rows committed in the current batch (SYNC_BATCH_ID filter).
 * - Zone B is trimmed to ISSUANCE_MODULE.LOG_MAX_ROWS (default 50).
 * - Gateway update failures are NEVER allowed to crash the main pipeline.
 *
 * @param {Object} report   - { status, staged, inserted, updated, orphans, error }
 * @param {Object} source   - One entry from ISSUANCE_SOURCES[]
 * @param {string} duration - Elapsed time in seconds (e.g. '14.3')
 * @param {string} batchId  - Unique session ID for this run (e.g. 'ISU_1740880000')
 */
function _updateIssuanceDashboard(report, source, duration, batchId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(source.DASHBOARD_TAB);

    // Auto-create tab if it doesn't exist yet
    if (!sheet) {
      sheet = _buildDashboardTab(ss, source);
    }

    const D = ISSUANCE_DASHBOARD_CONFIG;
    const aColCount = D.ZONE_A_HEADERS.length;   // 7
    const bCol      = D.ZONE_B_START_COL;         // 9
    const bColCount = D.ZONE_B_HEADERS.length;    // 10

    // ── ZONE A: Validated Sync Data (Left Side, cols 1-7) ─────────────────────
    let zoneARowCount = 0;
    if (report.status !== 'FAILED' && report.status !== 'NO_DATA') {
      try {
        const config = ISC_SCM_Core_Lib.getCoreConfig();
        const fq = `${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}`;
        const sql = `
          SELECT
            BOM_UPDATE, VPO, CUMULATIVE_ISSUANCE_QTY,
            CAST(SNAPSHOT_DATE AS STRING) AS SNAPSHOT_DATE,
            SOURCE_BOM_CODE, MAIN_GROUP, RESOLUTION_METHOD
          FROM \`${fq}.${ISSUANCE_BQ_CONFIG.STAGING_TABLE}\`
          WHERE SYNC_BATCH_ID = '${batchId}'
            AND SOURCE_ID = '${source.SOURCE_ID}'
          ORDER BY BOM_UPDATE, VPO`;

        const rows = ISC_SCM_Core_Lib.runReadQueryMapped(sql);

        if (rows && rows.length > 0) {
          zoneARowCount = rows.length;

          // Map BQ results to 2D array (1 API call for all rows — ZXH pattern)
          const gridData = rows.map(r => [
            r.BOM_UPDATE         || '',
            r.VPO                || '',
            r.CUMULATIVE_ISSUANCE_QTY || 0,
            r.SNAPSHOT_DATE      || '',
            r.SOURCE_BOM_CODE    || '',
            r.MAIN_GROUP         || '',
            r.RESOLUTION_METHOD  || ''
          ]);

          // Surgical clear (data rows only, not headers)
          const oldLastRow = sheet.getLastRow();
          if (oldLastRow >= D.ZONE_A_DATA_START) {
            sheet.getRange(D.ZONE_A_DATA_START, 1,
              oldLastRow - D.ZONE_A_DATA_START + 1, aColCount)
              .clearContent().setBackground('white');
          }

          // Batch write (1 API call regardless of row count)
          sheet.getRange(D.ZONE_A_DATA_START, 1, gridData.length, aColCount)
            .setValues(gridData);

          console.log(`[${batchId}] 📊 Zone A: ${zoneARowCount} rows written to ${source.DASHBOARD_TAB}.`);
        }
      } catch (bqErr) {
        console.warn(`[${batchId}] ⚠️ Zone A BQ fetch failed: ${bqErr.message}`);
      }
    }

    // ── DASHBOARD SUMMARY (Rows 2-3) ──────────────────────────────────────────
    const timestamp = Utilities.formatDate(new Date(), ISSUANCE_MODULE.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    const statusIcon = report.status === 'FAILED' ? '⛔' : '✅';

    sheet.getRange(2, 1).setValue(`Last Run: ${timestamp}`);
    sheet.getRange(2, 3).setValue(`Source: ${source.SOURCE_ID}`);
    sheet.getRange(2, 5).setValue(`Duration: ${duration}s`);
    sheet.getRange(2, 7).setValue(`V${ISSUANCE_MODULE.VERSION}`);

    sheet.getRange(3, 1).setValue(`${statusIcon} ${report.status}`);
    sheet.getRange(3, 2).setValue(`Staged: ${report.staged || 0}`);
    sheet.getRange(3, 3).setValue(`Inserted: ${report.inserted || 0}`);
    sheet.getRange(3, 4).setValue(`Deleted: ${report.deleted || 0}`);
    sheet.getRange(3, 5).setValue('');  // Reserved (was Orphans)
    sheet.getRange(3, 6).setValue(`Zone A Rows: ${zoneARowCount}`);

    // Dashboard row color
    const dashBg = report.status === 'FAILED' ? D.COLORS.STATUS_FAIL
                 : D.COLORS.STATUS_OK;
    sheet.getRange(3, 1, 1, aColCount).setBackground(dashBg);

    // ── ZONE B: Run History Log (Right Side, cols 9-18) ───────────────────────
    const logRow = [
      timestamp,
      batchId,
      source.SOURCE_ID || '',
      report.status    || '',
      report.staged    || 0,
      report.inserted  || 0,
      report.deleted   || 0,
      '',              // Reserved (was Orphans)
      duration         || '',
      report.error     || ''
    ];

    // Read existing Zone B entries
    let existingLogs = [];
    const totalRows = sheet.getLastRow();
    if (totalRows >= D.ZONE_B_DATA_START) {
      const numExisting = totalRows - D.ZONE_B_DATA_START + 1;
      existingLogs = sheet.getRange(D.ZONE_B_DATA_START, bCol, numExisting, bColCount).getValues();
      existingLogs = existingLogs.filter(row => row.some(c => c !== '' && c !== null && c !== undefined));
    }

    // Prepend new entry (newest first)
    existingLogs.unshift(logRow);
    if (existingLogs.length > ISSUANCE_MODULE.LOG_MAX_ROWS) {
      existingLogs = existingLogs.slice(0, ISSUANCE_MODULE.LOG_MAX_ROWS);
    }

    // Clear and rewrite Zone B
    if (totalRows >= D.ZONE_B_DATA_START) {
      sheet.getRange(D.ZONE_B_DATA_START, bCol, totalRows - D.ZONE_B_DATA_START + 1, bColCount)
        .clearContent().setBackground('white');
    }
    sheet.getRange(D.ZONE_B_DATA_START, bCol, existingLogs.length, bColCount)
      .setValues(existingLogs);

    // Color-code the newest Status cell (col 12 = bCol + 3)
    const statusCell = sheet.getRange(D.ZONE_B_DATA_START, bCol + 3);
    if (report.status === 'FAILED') {
      statusCell.setBackground('#f4cccc').setFontColor('#cc0000');
    } else {
      statusCell.setBackground('#d9ead3').setFontColor('#1e7e34');
    }

    console.log(`[${batchId}] 📋 ${source.DASHBOARD_TAB} updated (Zone A: ${zoneARowCount} rows, Zone B: ${existingLogs.length} entries).`);

  } catch (gwErr) {
    // Dashboard update must NEVER crash the main pipeline
    console.warn(`[${batchId}] ⚠️ Dashboard update failed for ${source.DASHBOARD_TAB}: ${gwErr.message}`);
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// 2. TAB STRUCTURE BUILDER — Creates one material dashboard tab from scratch
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Creates (or rebuilds) one material-specific dashboard tab.
 *
 * Layout:
 *   Cols 1-7:  Zone A (validated sync data, left side)
 *   Col  8:    Narrow spacer
 *   Cols 9-18: Zone B (run history log, right side)
 *
 * @param {Spreadsheet} ss     - The active spreadsheet
 * @param {Object}      source - One entry from ISSUANCE_SOURCES[]
 * @return {Sheet} The created sheet
 */
function _buildDashboardTab(ss, source) {
  // Delete existing tab if present (safe rebuild)
  const existing = ss.getSheetByName(source.DASHBOARD_TAB);
  if (existing) ss.deleteSheet(existing);

  const sheet = ss.insertSheet(source.DASHBOARD_TAB);
  const D = ISSUANCE_DASHBOARD_CONFIG;
  const aColCount = D.ZONE_A_HEADERS.length;  // 7
  const bCol      = D.ZONE_B_START_COL;       // 9
  const bColCount = D.ZONE_B_HEADERS.length;  // 10
  const totalCols = bCol + bColCount - 1;     // 18

  // ── ROW 1: Title bar (deep teal, spans full width) ─────────────────────────
  sheet.getRange(1, 1, 1, totalCols).merge()
    .setValue(`📦 ${source.DISPLAY_NAME} Issuance AutoSync  —  V${ISSUANCE_MODULE.VERSION}`)
    .setBackground(D.COLORS.TITLE_BG)
    .setFontColor(D.COLORS.TITLE_FG)
    .setFontWeight('bold')
    .setFontSize(13)
    .setHorizontalAlignment('center');

  // ── ROWS 2-3: Dashboard summary (light teal background) ────────────────────
  sheet.getRange(2, 1, 2, aColCount).setBackground(D.COLORS.DASHBOARD_BG);
  sheet.getRange(2, 1).setValue('Last Run: —');
  sheet.getRange(2, 3).setValue(`Source: ${source.SOURCE_ID}`);
  sheet.getRange(2, 5).setValue('Duration: —');
  sheet.getRange(2, 7).setValue(`V${ISSUANCE_MODULE.VERSION}`);
  sheet.getRange(3, 1).setValue('⏳ Awaiting first sync run...');

  // ── ROW 4: Zone A label (left) ─────────────────────────────────────────────
  sheet.getRange(4, 1, 1, aColCount).merge()
    .setValue(`📊 Validated Sync Data — ${source.DISPLAY_NAME} (Zone A — refreshed each run)`)
    .setBackground(D.COLORS.ZONE_A_LABEL_BG)
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(11)
    .setHorizontalAlignment('center');

  // ── ROW 5: Zone A headers ──────────────────────────────────────────────────
  sheet.getRange(5, 1, 1, aColCount)
    .setValues([D.ZONE_A_HEADERS])
    .setBackground(D.COLORS.ZONE_A_HEADER_BG)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setBorder(true, true, true, true, true, true);

  // Zone A column widths
  D.ZONE_A_WIDTHS.forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  // ── SPACER COLUMN ──────────────────────────────────────────────────────────
  sheet.setColumnWidth(D.SPACER_COL, D.SPACER_WIDTH);

  // ── ROW 4: Zone B label (right side) ──────────────────────────────────────
  sheet.getRange(D.ZONE_B_LABEL_ROW, bCol, 1, bColCount).merge()
    .setValue(`📜 Run History (Last ${ISSUANCE_MODULE.LOG_MAX_ROWS} runs)`)
    .setBackground(D.COLORS.ZONE_B_LABEL_BG)
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(11)
    .setHorizontalAlignment('center');

  // ── ROW 5: Zone B headers (right side) ────────────────────────────────────
  sheet.getRange(D.ZONE_B_HEADER_ROW, bCol, 1, bColCount)
    .setValues([D.ZONE_B_HEADERS])
    .setBackground(D.COLORS.ZONE_B_HEADER_BG)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setBorder(true, true, true, true, true, true);

  // Zone B column widths
  D.ZONE_B_WIDTHS.forEach((w, i) => sheet.setColumnWidth(bCol + i, w));

  // ── Freeze header rows + set tab color ────────────────────────────────────
  sheet.setFrozenRows(5);
  sheet.setTabColor(D.COLORS.TITLE_BG);  // Deep teal tab

  // ── Sheet protection: admin-only editing ──────────────────────────────────
  try {
    const protection = sheet.protect().setDescription(`${source.DASHBOARD_TAB} — Admin Only`);
    protection.addEditor(ISSUANCE_EMAIL.RECIPIENTS);
    protection.removeEditors(
      protection.getEditors().filter(e => e.getEmail() !== ISSUANCE_EMAIL.RECIPIENTS)
    );
  } catch (protErr) {
    console.warn(`⚠️ Could not set sheet protection for ${source.DASHBOARD_TAB}: ${protErr.message}`);
  }

  SpreadsheetApp.flush();
  console.log(`✅ Dashboard tab created: ${source.DASHBOARD_TAB} (Zone A left, Zone B right, V1.0 layout).`);
  return sheet;
}


// ═══════════════════════════════════════════════════════════════════════════════
// 3. ADMIN: BUILD / REBUILD ALL DASHBOARD TABS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Creates (or rebuilds) dashboard tabs for ALL active ISSUANCE_SOURCES.
 * Called from the Admin Tools submenu.
 * Safe to re-run at any time — existing tabs are deleted and recreated.
 *
 * Menu: 📦 Issuance AutoSync → 🛠️ Admin Tools → 🏗️ Build / Rebuild Dashboard Tabs
 */
function admin_BuildIssuanceDashboards() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const activeSources = ISSUANCE_SOURCES.filter(s => s.ACTIVE);

  if (activeSources.length === 0) {
    SpreadsheetApp.getUi().alert(
      '⚠️ No Active Sources',
      'No active ISSUANCE_SOURCES found in config. Set ACTIVE: true for at least one source.',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    return;
  }

  const built = [];
  activeSources.forEach(source => {
    _buildDashboardTab(ss, source);
    built.push(source.DASHBOARD_TAB);
  });

  try {
    SpreadsheetApp.getUi().alert(
      '✅ Dashboards Built',
      `The following tabs have been created/rebuilt:\n• ${built.join('\n• ')}\n\nReady for sync runs.`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    // Running from script editor — no UI available
  }
}
