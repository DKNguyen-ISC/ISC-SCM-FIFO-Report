/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 📋 M4_ZXH_PO_AUTOSYNC_SHEETBUILDER.gs (V7.4 — Gateway Edition)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * Creates and manages the ZXH_PO_AutoSync_Gateway tab — a 2-zone monitoring sheet:
 *   Zone A (Left):  Full validated staging data (refreshed every run via setValues)
 *   Zone B (Right): Run history log (last 50 runs, fixed position to the right)
 * 
 * PATTERN: Follows M1_PSP_SheetBuilder.gs batch setValues() approach
 *   — 1 BQ read + 1 batch sheet write = minimal API cost regardless of row count.
 * 
 * V7.3.1 FIX:
 *   - Zone A SQL corrected to match ZXH_PO_AutoSync_Staging schema
 *     (INV_CODE→INV, VALIDATION_STATUS→ZXH_STATUS, CURRENT_ETA→ETA, etc.)
 *   - Zone B relocated to the RIGHT of Zone A (columns 14-23) for stable layout
 *   - Removed duplicate Zone B label from _buildGatewayStructure
 * 
 * COMPANION FILE: M4_ZXH_PO_AutoSync_Main.gs
 *   Contains: PO_SYNC_CONFIG, trigger function, pipeline logic, admin tools
 * 
 * DEPENDENCIES:
 *   - PO_SYNC_CONFIG (from Main file — shared via GAS global scope)
 *   - ISC_SCM_Core_Lib (BigQuery read)
 *   - SpreadsheetApp (GAS)
 * 
 * VERSION: 7.3.1
 * DATE: February 2026
 * ═══════════════════════════════════════════════════════════════════════════════
 */


// ═══════════════════════════════════════════════════════════════════════════════
// 1. GATEWAY CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const GATEWAY_CONFIG = {
  // Zone A: Validated Staging Data (columns 1-12)
  ZONE_A_HEADERS: [
    'INV', 'BOM_CODE', 'SUPPLIER_NAME', 'GROSS_QTY',
    'PO_NUMBER_REF', 'REQUIRE_DATE', 'ETA', 'PIC',
    'ZXH_STATUS', 'REMARK', 'GENERATED_PO_DOC_ID',
    'GENERATED_PO_LINE_ID'
  ],
  ZONE_A_WIDTHS: [120, 120, 160, 80, 100, 100, 100, 80, 100, 160, 180, 180],

  // Zone B: Run History (columns 14-23, right of Zone A)
  ZONE_B_HEADERS: [
    'Timestamp', 'Session ID', 'Source', 'Status',
    'Staged', 'Inserted', 'Updated', 'Orphans', 'Duration (s)', 'Error'
  ],
  ZONE_B_WIDTHS: [150, 180, 80, 120, 70, 70, 70, 70, 90, 300],

  // Layout — Zone A (left side)
  TITLE_ROW: 1,
  DASHBOARD_ROW: 2,
  ZONE_A_LABEL_ROW: 4,
  ZONE_A_HEADER_ROW: 5,
  ZONE_A_DATA_START: 6,

  // Layout — Zone B (right side, fixed position)
  SPACER_COL: 13,             // Spacer column between zones
  SPACER_WIDTH: 20,           // Narrow spacer width
  ZONE_B_START_COL: 14,       // Zone B starts at column 14
  ZONE_B_LABEL_ROW: 4,        // Same level as Zone A label
  ZONE_B_HEADER_ROW: 5,       // Same level as Zone A headers
  ZONE_B_DATA_START: 6,       // Same level as Zone A data start

  // Styling
  COLORS: {
    TITLE_BG: '#1a237e',        // Deep indigo (premium)
    TITLE_FG: '#ffffff',
    DASHBOARD_BG: '#e8eaf6',    // Light indigo
    ZONE_A_LABEL_BG: '#283593',
    ZONE_A_HEADER_BG: '#c5cae9',
    ZONE_B_LABEL_BG: '#4c1130', // Dark cherry (matches existing log)
    ZONE_B_HEADER_BG: '#d9d2e9',
    STATUS_OK: '#d9ead3',
    STATUS_WARN: '#fff2cc',
    STATUS_FAIL: '#f4cccc'
  }
};


// ═══════════════════════════════════════════════════════════════════════════════
// 2. GATEWAY WRITER (Called after each sync run)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Updates the PO_Sync_Gateway tab after each sync run.
 * 
 * 1. Fetches ALL staged rows from BigQuery (Zone A — left side)
 * 2. Writes them via batch setValues() (1 API call for all rows)
 * 3. Updates dashboard summary (Row 2-3)
 * 4. Prepends run entry to Zone B history log (right side, fixed position)
 * 
 * @param {Object} report   - Parsed SP result or status report
 * @param {string} source   - 'ZXH', 'PO_LINK', or '' (unknown)
 * @param {string} duration - Elapsed time in seconds
 * @param {string} batchId  - Session identifier
 */
function _updateGateway(report, source, duration, batchId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(PO_SYNC_CONFIG.GATEWAY_SHEET_NAME);

    // Auto-create if tab doesn't exist
    if (!sheet) {
      sheet = _buildGatewayStructure(ss);
    }

    // ── ZONE A: Staging Data (Left Side, columns 1-12) ────────────────
    let zoneARowCount = 0;
    if (report.status !== 'FAILED' && report.status !== 'NO_DATA' && report.status !== 'ALL_FILTERED') {
      try {
        const config = ISC_SCM_Core_Lib.getCoreConfig();
        const fq = `${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}`;
        const sql = `SELECT INV, BOM_CODE, SUPPLIER_NAME, GROSS_QTY,
                     PO_NUMBER_REF, REQUIRE_DATE, ETA, PIC,
                     ZXH_STATUS, REMARK,
                     GENERATED_PO_DOC_ID, GENERATED_PO_LINE_ID
                     FROM \`${fq}.${PO_SYNC_CONFIG.STAGING_TABLE}\`
                     WHERE SESSION_ID = '${batchId}'
                     ORDER BY INV, BOM_CODE`;
        const rows = ISC_SCM_Core_Lib.runReadQueryMapped(sql);

        if (rows && rows.length > 0) {
          zoneARowCount = rows.length;

          // Map BQ results to 2D array (PSP pattern)
          const gridData = rows.map(row => [
            row.INV || '',
            row.BOM_CODE || '',
            row.SUPPLIER_NAME || '',
            row.GROSS_QTY || 0,
            row.PO_NUMBER_REF || '',
            row.REQUIRE_DATE || '',
            row.ETA || '',
            row.PIC || '',
            row.ZXH_STATUS || '',
            row.REMARK || '',
            row.GENERATED_PO_DOC_ID || '',
            row.GENERATED_PO_LINE_ID || ''
          ]);

          // Clear old Zone A data (surgical clear — only the data rows, not headers)
          const oldLastRow = sheet.getLastRow();
          if (oldLastRow >= GATEWAY_CONFIG.ZONE_A_DATA_START) {
            const clearRows = oldLastRow - GATEWAY_CONFIG.ZONE_A_DATA_START + 1;
            sheet.getRange(GATEWAY_CONFIG.ZONE_A_DATA_START, 1, clearRows, 
                          GATEWAY_CONFIG.ZONE_A_HEADERS.length).clearContent().setBackground('white');
          }

          // Batch write all rows (1 API call — same cost for 10 or 1000 rows)
          sheet.getRange(GATEWAY_CONFIG.ZONE_A_DATA_START, 1, 
                        gridData.length, gridData[0].length).setValues(gridData);

          console.log(`[${batchId}] 📊 Gateway Zone A: ${zoneARowCount} rows written.`);
        }
      } catch (bqErr) {
        console.warn(`[${batchId}] ⚠️ Gateway Zone A BQ fetch failed: ${bqErr.message}`);
      }
    }

    // ── DASHBOARD: Summary Row (Row 2-3) ─────────────────────────────
    const timestamp = Utilities.formatDate(new Date(), PO_SYNC_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    const statusIcon = report.status === 'FAILED' ? '⛔' : (report.orphans || 0) > 0 ? '⚠️' : '✅';
    
    sheet.getRange(2, 1).setValue(`Last Run: ${timestamp}`);
    sheet.getRange(2, 4).setValue(`Source: ${source || 'N/A'}`);
    sheet.getRange(2, 6).setValue(`Duration: ${duration}s`);
    sheet.getRange(2, 8).setValue(`Version: V${PO_SYNC_CONFIG.VERSION}`);
    
    sheet.getRange(3, 1).setValue(`${statusIcon} ${report.status}`);
    sheet.getRange(3, 3).setValue(`Staged: ${report.staged || 0}`);
    sheet.getRange(3, 5).setValue(`Inserted: ${report.inserted || 0}`);
    sheet.getRange(3, 6).setValue(`Updated: ${report.updated || 0}`);
    sheet.getRange(3, 7).setValue(`Orphans: ${report.orphans || 0}`);
    sheet.getRange(3, 9).setValue(`Rows: ${zoneARowCount}`);

    // Dashboard status coloring
    const dashBg = report.status === 'FAILED' ? GATEWAY_CONFIG.COLORS.STATUS_FAIL 
                 : (report.orphans || 0) > 0 ? GATEWAY_CONFIG.COLORS.STATUS_WARN 
                 : GATEWAY_CONFIG.COLORS.STATUS_OK;
    sheet.getRange(3, 1, 1, GATEWAY_CONFIG.ZONE_A_HEADERS.length).setBackground(dashBg);

    // ── ZONE B: Run History Log (Right Side, columns 14-23) ──────────
    const bCol = GATEWAY_CONFIG.ZONE_B_START_COL;
    const bDataRow = GATEWAY_CONFIG.ZONE_B_DATA_START;
    const bColCount = GATEWAY_CONFIG.ZONE_B_HEADERS.length;

    // New log entry
    const logRow = [
      timestamp, batchId, source || '', report.status || '',
      report.staged || 0, report.inserted || 0, report.updated || 0,
      report.orphans || 0, duration || '', report.error || ''
    ];

    // Read existing Zone B data (if any)
    let existingLogs = [];
    const totalRows = sheet.getLastRow();
    if (totalRows >= bDataRow) {
      const numExisting = totalRows - bDataRow + 1;
      existingLogs = sheet.getRange(bDataRow, bCol, numExisting, bColCount).getValues();
      // Filter out empty rows (rows where all cells are empty)
      existingLogs = existingLogs.filter(row => row.some(cell => cell !== '' && cell !== null && cell !== undefined));
    }

    // Prepend new entry + trim to max
    existingLogs.unshift(logRow);
    if (existingLogs.length > PO_SYNC_CONFIG.LOG_MAX_ROWS) {
      existingLogs = existingLogs.slice(0, PO_SYNC_CONFIG.LOG_MAX_ROWS);
    }

    // Clear old Zone B data and rewrite
    if (totalRows >= bDataRow) {
      sheet.getRange(bDataRow, bCol, totalRows - bDataRow + 1, bColCount)
        .clearContent().setBackground('white');
    }
    sheet.getRange(bDataRow, bCol, existingLogs.length, existingLogs[0].length)
      .setValues(existingLogs);

    // Style newest log entry
    const statusCell = sheet.getRange(bDataRow, bCol + 3); // Status is 4th column of Zone B
    if (report.status === 'FAILED') {
      statusCell.setBackground('#f4cccc').setFontColor('#cc0000');
    } else if ((report.orphans || 0) > 0) {
      statusCell.setBackground('#fff2cc').setFontColor('#b45309');
    } else {
      statusCell.setBackground('#d9ead3').setFontColor('#1e7e34');
    }

    console.log(`[${batchId}] 📋 Gateway updated (Zone A: ${zoneARowCount} rows, Zone B: ${existingLogs.length} entries).`);
  } catch (gwErr) {
    // Gateway update should never crash the main pipeline
    console.warn(`[${batchId}] ⚠️ Gateway update failed: ${gwErr.message}`);
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// 3. GATEWAY STRUCTURE BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Builds the PO_Sync_Gateway tab structure from scratch.
 * Creates: Title bar, Dashboard section, Zone A headers (left), Zone B headers (right).
 * 
 * Layout:
 *   Cols 1-12:  Zone A (staging data)
 *   Col 13:     Spacer
 *   Cols 14-23: Zone B (run history log)
 * 
 * @param {Spreadsheet} ss - The active spreadsheet
 * @return {Sheet} The created sheet
 */
function _buildGatewayStructure(ss) {
  // Delete existing sheet if present
  const existing = ss.getSheetByName(PO_SYNC_CONFIG.GATEWAY_SHEET_NAME);
  if (existing) ss.deleteSheet(existing);

  const sheet = ss.insertSheet(PO_SYNC_CONFIG.GATEWAY_SHEET_NAME);
  const aColCount = GATEWAY_CONFIG.ZONE_A_HEADERS.length;
  const bCol = GATEWAY_CONFIG.ZONE_B_START_COL;
  const bColCount = GATEWAY_CONFIG.ZONE_B_HEADERS.length;
  const totalCols = bCol + bColCount - 1; // Last column used

  // ── ROW 1: Title bar (deep indigo, spans full width) ────────────────
  sheet.getRange(1, 1, 1, totalCols).merge()
    .setValue('⚙️ PO Sync Gateway — V' + PO_SYNC_CONFIG.VERSION)
    .setBackground(GATEWAY_CONFIG.COLORS.TITLE_BG)
    .setFontColor(GATEWAY_CONFIG.COLORS.TITLE_FG)
    .setFontWeight('bold')
    .setFontSize(13)
    .setHorizontalAlignment('center');

  // ── ROW 2-3: Dashboard (pre-populated with defaults) ────────────────
  sheet.getRange(2, 1, 2, aColCount).setBackground(GATEWAY_CONFIG.COLORS.DASHBOARD_BG);
  sheet.getRange(2, 1).setValue('Last Run: —');
  sheet.getRange(2, 4).setValue('Source: —');
  sheet.getRange(2, 6).setValue('Duration: —');
  sheet.getRange(2, 8).setValue('Version: V' + PO_SYNC_CONFIG.VERSION);
  sheet.getRange(3, 1).setValue('⏳ Awaiting first sync run...');

  // ── ROW 4: Zone A label (left) ──────────────────────────────────────
  sheet.getRange(4, 1, 1, aColCount).merge()
    .setValue('📊 Validated Staging Data (Zone A — refreshed each run)')
    .setBackground(GATEWAY_CONFIG.COLORS.ZONE_A_LABEL_BG)
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(11)
    .setHorizontalAlignment('center');

  // ── ROW 5: Zone A headers ───────────────────────────────────────────
  sheet.getRange(5, 1, 1, aColCount)
    .setValues([GATEWAY_CONFIG.ZONE_A_HEADERS])
    .setBackground(GATEWAY_CONFIG.COLORS.ZONE_A_HEADER_BG)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setBorder(true, true, true, true, true, true);

  // Zone A column widths
  GATEWAY_CONFIG.ZONE_A_WIDTHS.forEach((w, i) => sheet.setColumnWidth(i + 1, w));

  // ── CLIP hash columns (32-char MD5 hashes overflow without clipping) ──
  sheet.getRange(1, 11, sheet.getMaxRows(), 2)
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);

  // ── SPACER COLUMN ───────────────────────────────────────────────────
  sheet.setColumnWidth(GATEWAY_CONFIG.SPACER_COL, GATEWAY_CONFIG.SPACER_WIDTH);

  // ── ROW 4: Zone B label (right side) ────────────────────────────────
  sheet.getRange(GATEWAY_CONFIG.ZONE_B_LABEL_ROW, bCol, 1, bColCount).merge()
    .setValue('📜 Run History (Last ' + PO_SYNC_CONFIG.LOG_MAX_ROWS + ' runs)')
    .setBackground(GATEWAY_CONFIG.COLORS.ZONE_B_LABEL_BG)
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setFontSize(11)
    .setHorizontalAlignment('center');

  // ── ROW 5: Zone B headers (right side) ──────────────────────────────
  sheet.getRange(GATEWAY_CONFIG.ZONE_B_HEADER_ROW, bCol, 1, bColCount)
    .setValues([GATEWAY_CONFIG.ZONE_B_HEADERS])
    .setBackground(GATEWAY_CONFIG.COLORS.ZONE_B_HEADER_BG)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setBorder(true, true, true, true, true, true);

  // Zone B column widths
  GATEWAY_CONFIG.ZONE_B_WIDTHS.forEach((w, i) => sheet.setColumnWidth(bCol + i, w));

  // ── FINAL: Freeze header rows + set tab color ───────────────────────
  sheet.setFrozenRows(5);
  sheet.setTabColor('#1a237e');

  // ── PROTECTION: Admin-only editing ──────────────────────────────────
  const protection = sheet.protect().setDescription('PO Sync Gateway — Admin Only');
  protection.addEditor('dk@isconline.vn');
  protection.removeEditors(
    protection.getEditors().filter(e => e !== 'dk@isconline.vn')
  );

  SpreadsheetApp.flush();
  console.log('✅ PO_Sync_Gateway tab created (V7.3.1 layout: Zone A left, Zone B right).');
  return sheet;
}


// ═══════════════════════════════════════════════════════════════════════════════
// 4. ADMIN: REBUILD GATEWAY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Creates (or rebuilds) the PO_Sync_Gateway tab.
 * Run this once before the first sync, or to reset the gateway structure.
 * Safe to re-run: deletes existing tab and recreates from scratch.
 */
function admin_RebuildPOSyncGateway() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  _buildGatewayStructure(ss);
  
  try {
    SpreadsheetApp.getUi().alert(
      '✅ Gateway Created',
      `Tab "${PO_SYNC_CONFIG.GATEWAY_SHEET_NAME}" has been created/rebuilt.\nReady for sync runs.`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    // UI not available (running from script editor directly)
  }
}
