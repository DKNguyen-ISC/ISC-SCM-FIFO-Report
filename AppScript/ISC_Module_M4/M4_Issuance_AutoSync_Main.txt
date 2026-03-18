/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🔄 M4_ISSUANCE_AUTOSYNC_MAIN.gs (V1.0)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 * Nightly sync of material issuance data from warehouse spreadsheets into
 * the BigQuery Material_Issuance table. Enables the "Issuance Method" for
 * Lead (Chì) materials in the dual-method shortage engine.
 *
 * ARCHITECTURE (D-P3-3: Headless direct-read, no gateway sheet):
 *   [Warehouse SS] → SpreadsheetApp.openById() → BOM×VPO matrix parse
 *       → BOM_UPDATE resolution (D-P3-1: BOM_UPDATE primary, BOM fallback)
 *       → CSV → Material_Issuance_Staging (WRITE_TRUNCATE)
 *       → SP_M4_ISSUANCE_MERGE (MERGE into Material_Issuance)
 *       → _updateIssuanceDashboard() (Zone A + Zone B)
 *       → Email report (ZXH threading pattern)
 *
 * MULTI-SOURCE DESIGN (D-P3-2):
 *   Loops through ALL active ISSUANCE_SOURCES[] entries.
 *   Adding a new material = one config entry. Zero code change here.
 *
 * COMPANION FILES:
 *   M4_Issuance_AutoSync_Config.gs     — ISSUANCE_SOURCES, all constants
 *   M4_Issuance_AutoSync_SheetBuilder.gs — Dashboard tab builder
 *   SQL_Vault.txt                      — SP_M4_ISSUANCE_MERGE
 *
 * DEPENDENCIES:
 *   ISC_SCM_Core_Lib (loadCsvData, runReadQueryMapped, runWriteQuery, logStep)
 *
 * PROVENANCE:
 *   ROBOT_NAME    = 'M4_ISSUANCE_ROBOT'
 *   SOURCE_SYSTEM = 'M4_ISSUANCE_AUTOSYNC'
 *
 * VERSION: 1.0
 * DATE: March 2026
 * ═══════════════════════════════════════════════════════════════════════════════
 */


// ═══════════════════════════════════════════════════════════════════════════════
// 1. MENU CREATOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Creates the dedicated Issuance AutoSync top-level menu.
 * Call this from onOpen() in M4_Main.gs.
 */
function createIssuanceAutoSyncMenu() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('📦 Issuance AutoSync')
    .addItem('▶️  Run Sync Now (All Active Sources)', 'admin_TestIssuanceSync')
    .addSeparator()
    .addItem('⏰ Install Nightly Trigger', 'admin_InstallIssuanceTrigger')
    .addItem('🚫 Remove Nightly Trigger', 'admin_RemoveIssuanceTrigger')
    .addSeparator()
    .addItem('📊 Show Trigger Status', 'admin_ShowIssuanceTriggerStatus')
    .addSeparator()
    .addSubMenu(ui.createMenu('⚙️ Admin Tools')
      .addItem('🏗️ Build / Rebuild Dashboard Tabs', 'admin_BuildIssuanceDashboards')
      .addItem('🔄 Reset Last-Run State', 'admin_ResetIssuanceState')
    )
    .addToUi();
}


// ═══════════════════════════════════════════════════════════════════════════════
// 2. MAIN TRIGGER — Nightly Scheduler Entry Point
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ⏰ TRIGGER FUNCTION — Scheduled nightly via Time-Driven Trigger.
 *
 * Execution flow (per active source):
 *   1. Read BOM×VPO matrix from warehouse spreadsheet (direct openById)
 *   2. Resolve BOM_UPDATE → BOM_Data (pass 1: exact, pass 2: short-code fallback)
 *   3. Validate MAIN_GROUP matches source filter (cross-contamination guard)
 *   4. Build CSV → upload to Material_Issuance_Staging (WRITE_TRUNCATE)
 *   5. Call SP_M4_ISSUANCE_MERGE → MERGE into Material_Issuance
 *   6. Update dashboard tab (Zone A + Zone B) and send email report
 *
 * Error handling: per-source failures do NOT abort other sources.
 *   The overall run is PARTIAL if any source fails, FAILED if all fail.
 */
function trigger_IssuanceAutoSync() {
  const LOG_ID = `ISU_${Date.now()}`;
  const startTime = Date.now();
  console.log(`[${LOG_ID}] 🚀 Starting Issuance AutoSync V${ISSUANCE_MODULE.VERSION}...`);

  const activeSources = ISSUANCE_SOURCES.filter(s => s.ACTIVE);
  if (activeSources.length === 0) {
    console.log(`[${LOG_ID}] ℹ️ No active ISSUANCE_SOURCES found. Exiting.`);
    return;
  }

  ISC_SCM_Core_Lib.logStep(LOG_ID, ISSUANCE_MODULE.MODULE_ID, 1, 'START_ISSUANCE_SYNC', 'RUNNING');

  const sourceReports = [];
  let anySuccess = false;

  activeSources.forEach(source => {
    const sourceStart = Date.now();
    const sourceBatchId = `${LOG_ID}_${source.SOURCE_ID}`;
    console.log(`[${sourceBatchId}] 🔄 Processing source: ${source.DISPLAY_NAME}`);

    let report = { status: 'FAILED', staged: 0, inserted: 0, updated: 0, deleted: 0, error: '' };

    try {
      // ── STEP 1: READ FROM WAREHOUSE ───────────────────────────────────────
      const rawTriples = _readIssuanceMatrix(source, sourceBatchId);

      if (!rawTriples || rawTriples.length === 0) {
        console.log(`[${sourceBatchId}] ℹ️ No data found for ${source.SOURCE_ID}. Skipping.`);
        report = { status: 'NO_DATA', staged: 0, inserted: 0, updated: 0, deleted: 0 };
        sourceReports.push({ source, report, duration: ((Date.now() - sourceStart)/1000).toFixed(1) });
        _updateIssuanceDashboard(report, source, ((Date.now() - sourceStart)/1000).toFixed(1), sourceBatchId);
        return; // Continue to next source
      }

      console.log(`[${sourceBatchId}] 📊 Raw triples extracted: ${rawTriples.length}`);

      // ── STEP 2: RESOLVE BOM_UPDATE + VALIDATE GROUP ──────────────────────
      const resolvedRows = _resolveBomUpdate(rawTriples, source, sourceBatchId);

      if (resolvedRows.length === 0) {
        console.log(`[${sourceBatchId}] ⚠️ All rows failed BOM resolution or group validation.`);
        report = { status: 'ALL_FILTERED', staged: 0, inserted: 0, updated: 0, deleted: 0 };
        sourceReports.push({ source, report, duration: ((Date.now() - sourceStart)/1000).toFixed(1) });
        _updateIssuanceDashboard(report, source, ((Date.now() - sourceStart)/1000).toFixed(1), sourceBatchId);
        return;
      }

      // ── STEP 3: CSV → STAGING ─────────────────────────────────────────────
      const now = new Date();
      const snapshotDate = Utilities.formatDate(now, 'GMT', 'yyyy-MM-dd');
      const uploadedAt = Utilities.formatDate(now, 'GMT', "yyyy-MM-dd'T'HH:mm:ss'Z'");

      const csv = _buildIssuanceCsv(resolvedRows, source, sourceBatchId, snapshotDate, uploadedAt);
      ISC_SCM_Core_Lib.loadCsvData(ISSUANCE_BQ_CONFIG.STAGING_TABLE, csv, 'WRITE_TRUNCATE');
      console.log(`[${sourceBatchId}] ✅ Staged ${resolvedRows.length} rows → ${ISSUANCE_BQ_CONFIG.STAGING_TABLE}`);

      // ── STEP 4: CALL SP_M4_ISSUANCE_MERGE ────────────────────────────────
      const config = ISC_SCM_Core_Lib.getCoreConfig();
      const fqDataset = `${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}`;
      const spSql = `CALL \`${fqDataset}.${ISSUANCE_BQ_CONFIG.SP_NAME}\`('${sourceBatchId}', '${source.SOURCE_ID}')`;

      console.log(`[${sourceBatchId}] ⚙️ Executing ${ISSUANCE_BQ_CONFIG.SP_NAME}...`);
      const spResult = ISC_SCM_Core_Lib.runReadQueryMapped(spSql);
      report = _parseIssuanceSpResult(spResult, sourceBatchId);

      const duration = ((Date.now() - sourceStart)/1000).toFixed(1);
      console.log(`[${sourceBatchId}] 🏁 SP Complete — Inserted: ${report.inserted}, Deleted: ${report.deleted} (${duration}s)`);
      ISC_SCM_Core_Lib.logStep(sourceBatchId, ISSUANCE_MODULE.MODULE_ID, 5, 'SP_COMPLETE', 'SUCCESS', duration);

      anySuccess = true;
      sourceReports.push({ source, report, duration });
      _updateIssuanceDashboard(report, source, duration, sourceBatchId);

    } catch (srcErr) {
      const duration = ((Date.now() - sourceStart)/1000).toFixed(1);
      console.error(`[${sourceBatchId}] ❌ Source ${source.SOURCE_ID} failed: ${srcErr.message}`);
      ISC_SCM_Core_Lib.logStep(sourceBatchId, ISSUANCE_MODULE.MODULE_ID, 99, 'SOURCE_CRASH', 'FAILED', null, srcErr.message);
      report = { status: 'FAILED', staged: 0, inserted: 0, updated: 0, deleted: 0, error: srcErr.message };
      sourceReports.push({ source, report, duration });
      _updateIssuanceDashboard(report, source, duration, sourceBatchId);
    }
  });

  // ── STEP 5: SEND COMBINED EMAIL REPORT ─────────────────────────────────────
  const totalDuration = ((Date.now() - startTime)/1000).toFixed(1);
  const overallStatus = anySuccess ? (sourceReports.some(r => r.report.status === 'FAILED') ? 'PARTIAL' : 'SUCCESS') : 'FAILED';
  ISC_SCM_Core_Lib.logStep(LOG_ID, ISSUANCE_MODULE.MODULE_ID, 6, 'FINISH_ISSUANCE_SYNC', overallStatus, totalDuration);
  _sendIssuanceReport(sourceReports, overallStatus, LOG_ID, totalDuration);
}


// ═══════════════════════════════════════════════════════════════════════════════
// 3. WAREHOUSE MATRIX READER (corrected for BOM-vertical / VPO-horizontal layout)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Reads the BOM×VPO matrix from the warehouse spreadsheet.
 *
 * REAL MATRIX LAYOUT (verified 2026-03-02 for '5. Link Lead plan'):
 *   Row 1:         Date label (Feb-22) — skip
 *   Row 2:         VPO headers HORIZONTAL → B2='VPO', VPO codes C2, D2, E2... (onwards)
 *   Rows 3-9:      Summary rows (Order Qty, Finished Qty, GAP, Sum) — skip
 *   Row 10+:       BOM data rows
 *     Col A (col 1): BOM code (9-digit, e.g. 302000040)
 *     Col B (col 2): BOM-level total — skip (not a VPO qty)
 *     Col C+ (col 3+): Issued qty at [BOM row] × [VPO col] intersection
 *
 * Reading strategy:
 *   1. Read the VPO header row (row 2) to build a map: col_index → VPO code
 *   2. Read each BOM data row (row 10+), extract BOM from col A
 *   3. For each VPO column, read the qty at [BOM row][VPO col]
 *
 * @param {Object} source   - One entry from ISSUANCE_SOURCES[]
 * @param {string} batchId  - Session identifier for logging
 * @return {Array} Array of { bomKey, vpo, issuedQty } raw triples
 */
function _readIssuanceMatrix(source, batchId) {
  const triples = [];

  const ss = SpreadsheetApp.openById(source.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(source.TAB_NAME);
  if (!sheet) throw new Error(`Tab not found: '${source.TAB_NAME}' in SS ${source.SPREADSHEET_ID}`);

  // Dynamic read: use actual sheet dimensions to avoid truncation
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if (lastRow < source.DATA_START_ROW || lastCol < source.VPO_DATA_COL) {
    console.log(`[${batchId}] ℹ️ Sheet has no data in expected range (lastRow=${lastRow}, lastCol=${lastCol}).`);
    return triples;
  }

  // Read the FULL matrix in ONE call (minimize API round-trips)
  const allData = sheet.getRange(1, 1, lastRow, lastCol).getValues();

  // ── STEP 1: Extract VPO header row — build col_index → VPO map ────────────
  // VPOs are horizontal across Row VPO_HEADER_ROW (2), starting from VPO_DATA_COL (3)
  const vpoHeaderRow = allData[source.VPO_HEADER_ROW - 1];  // 0-based index for row 2
  const vpoMap = {};  // { colIndex: 'V2512021C09', ... }
  let vpoCount = 0;

  for (let c = source.VPO_DATA_COL - 1; c < vpoHeaderRow.length; c++) {
    const rawVpo = String(vpoHeaderRow[c] || '').trim();
    if (!rawVpo || rawVpo === '') continue;
    // VPO codes start with 'V' in this warehouse, but also accept alphanumeric codes
    // Skip obvious non-VPO cells (pure numbers = totals/counts, labels)
    if (!isNaN(parseFloat(rawVpo)) && isFinite(rawVpo)) continue;  // skip pure numbers
    vpoMap[c] = rawVpo;
    vpoCount++;
  }

  console.log(`[${batchId}] 📋 VPO header scan: ${vpoCount} VPO columns found (cols ${source.VPO_DATA_COL}–${lastCol}).`);

  if (vpoCount === 0) {
    console.warn(`[${batchId}] ⚠️ No VPO codes found in row ${source.VPO_HEADER_ROW}. Check VPO_HEADER_ROW config.`);
    return triples;
  }

  // ── STEP 2: Read BOM data rows — extract (BOM, VPO, qty) triples ───────────
  // BOMs are vertical down Col A (source.BOM_COL = 1, 0-based = 0), rows DATA_START_ROW+
  const bomColIdx = source.BOM_COL - 1;  // 0-based

  for (let r = source.DATA_START_ROW - 1; r < allData.length; r++) {
    const row = allData[r];
    const rawBom = String(row[bomColIdx] || '').trim();

    // Skip empty BOM cells and non-code values
    if (!rawBom || rawBom === '') continue;
    if (_isBomRowSkippable(rawBom)) continue;

    // For each VPO column, read the issuance qty
    Object.entries(vpoMap).forEach(([colIdxStr, vpo]) => {
      const c = parseInt(colIdxStr);
      const rawQty = row[c];
      const issuedQty = parseFloat(rawQty);

      // Only include rows with a real positive qty
      if (!isNaN(issuedQty) && isFinite(issuedQty) && issuedQty > 0) {
        triples.push({ bomKey: rawBom, vpo, issuedQty });
      }
    });
  }

  console.log(`[${batchId}] ✅ Matrix read complete: ${triples.length} (BOM, VPO, qty) triples extracted.`);
  return triples;
}

/**
 * Detects BOM rows that should be skipped.
 * Applied to Column A values (BOM codes).
 *
 * Skip criteria:
 *   - Empty or whitespace-only
 *   - Contains 'total', 'sum', 'qty', 'gap' (label rows that leaked past DATA_START_ROW)
 *   - Longer than 15 chars (not a real BOM code)
 *   - Starts with a known label pattern
 *
 * Note: BOM codes CAN be pure numeric (e.g. 302000040) — do NOT filter pure numerics.
 */
function _isBomRowSkippable(rawBom) {
  // Guard 1: formula error
  if (rawBom.startsWith('#')) return true;
  // Guard 2: too long to be a BOM code (label row leaked in)
  if (rawBom.length > 20) return true;
  // Guard 3: contains label keywords (case-insensitive)
  const lower = rawBom.toLowerCase();
  if (lower.includes('total') || lower.includes('sum') || lower.includes('qty')
      || lower.includes('gap') || lower.includes('finished') || lower.includes('order')) {
    return true;
  }
  return false;
}


// ═══════════════════════════════════════════════════════════════════════════════
// 4. BOM_UPDATE RESOLUTION (D-P3-1)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolves raw BOM keys from the warehouse to canonical BOM_UPDATE values.
 * Also validates MAIN_GROUP matches the source filter (cross-contamination guard).
 *
 * Resolution strategy:
 *   Pass 1: Exact match against BOM_Data.BOM_UPDATE
 *   Pass 2: Short-code match against BOM_Data.BOM
 *   Pass 3: Log unresolved — warn but don't fail the batch
 *
 * @param {Array}  rawTriples  - Array of { bomKey, vpo, issuedQty }
 * @param {Object} source      - One entry from ISSUANCE_SOURCES[]
 * @param {string} batchId     - Session identifier
 * @return {Array} Resolved rows with { bomUpdate, vpo, issuedQty, sourceBomCode, mainGroup, resolutionMethod }
 */
function _resolveBomUpdate(rawTriples, source, batchId) {
  // Build a BQ lookup for all unique BOM keys in one query
  const uniqueBomKeys = [...new Set(rawTriples.map(t => t.bomKey))];

  if (uniqueBomKeys.length === 0) return [];

  // Sanitize keys for SQL IN clause
  const keyList = uniqueBomKeys.map(k => `'${k.replace(/'/g, "\\'")}'`).join(', ');

  const config = ISC_SCM_Core_Lib.getCoreConfig();
  const fq = `${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}`;

  // Single BQ query: try exact BOM_UPDATE match AND BOM short-code match
  const sql = `
    SELECT
      b.BOM_UPDATE,
      b.BOM         AS BOM_CODE,
      b.MAIN_GROUP,
      'EXACT'       AS RESOLUTION_METHOD,
      1             AS PRIORITY
    FROM \`${fq}.BOM_Data\` b
    WHERE b.BOM_UPDATE IN (${keyList})
      AND b.BOM_STATUS = 'ACTIVE'
      AND LOWER(TRIM(b.MAIN_GROUP)) = LOWER('${source.MAIN_GROUP_FILTER}')

    UNION ALL

    SELECT
      b.BOM_UPDATE,
      b.BOM         AS BOM_CODE,
      b.MAIN_GROUP,
      'SHORTCODE'   AS RESOLUTION_METHOD,
      2             AS PRIORITY
    FROM \`${fq}.BOM_Data\` b
    WHERE b.BOM IN (${keyList})
      AND b.BOM_STATUS = 'ACTIVE'
      AND LOWER(TRIM(b.MAIN_GROUP)) = LOWER('${source.MAIN_GROUP_FILTER}')

    ORDER BY PRIORITY, BOM_UPDATE`;

  const bomLookupRows = ISC_SCM_Core_Lib.runReadQueryMapped(sql);

  // Build a map: original warehouse key → { bomUpdate, mainGroup, resolutionMethod }
  // Priority: EXACT wins over SHORTCODE if both match
  const resolvedMap = {};
  (bomLookupRows || []).forEach(row => {
    const key = row.RESOLUTION_METHOD === 'EXACT' ? row.BOM_UPDATE : row.BOM_CODE;
    if (!resolvedMap[key]) {
      resolvedMap[key] = {
        bomUpdate:         row.BOM_UPDATE,
        mainGroup:         row.MAIN_GROUP,
        resolutionMethod:  row.RESOLUTION_METHOD
      };
    }
  });

  // Apply resolution to each raw triple
  const resolved = [];
  let unresolved = 0;
  let groupReject = 0;

  rawTriples.forEach(({ bomKey, vpo, issuedQty }) => {
    const match = resolvedMap[bomKey];
    if (!match) {
      unresolved++;
      if (unresolved <= 5) {
        console.warn(`[${batchId}] ⚠️ Unresolved BOM key: '${bomKey}' (not found in BOM_Data for group '${source.MAIN_GROUP_FILTER}')`);
      }
      return;
    }

    // Cross-contamination guard: double-check MAIN_GROUP (should already be filtered in SQL)
    if (match.mainGroup.toLowerCase().trim() !== source.MAIN_GROUP_FILTER.toLowerCase().trim()) {
      groupReject++;
      return;
    }

    resolved.push({
      bomUpdate:        match.bomUpdate,
      vpo:              vpo,
      issuedQty:        issuedQty,
      sourceBomCode:    bomKey,
      mainGroup:        match.mainGroup,
      resolutionMethod: match.resolutionMethod
    });
  });

  console.log(`[${batchId}] ✅ BOM Resolution: ${resolved.length} resolved, ${unresolved} unresolved, ${groupReject} group-rejected.`);
  if (unresolved > 5) {
    console.warn(`[${batchId}] ⚠️ ${unresolved} total unresolved BOM keys. Check warehouse BOM codes vs BOM_Data.`);
  }

  return resolved;
}


// ═══════════════════════════════════════════════════════════════════════════════
// 5. CSV BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Converts resolved rows into a CSV string for BigQuery bulk upload.
 *
 * Column order matches Material_Issuance_Staging schema:
 *   ISSUANCE_ID, BOM_UPDATE, VPO, CUMULATIVE_ISSUANCE_QTY,
 *   SNAPSHOT_DATE, SOURCE_BOM_CODE, SYNC_BATCH_ID, SYNCED_AT,
 *   SOURCE_ID, MAIN_GROUP, RESOLUTION_METHOD
 *
 * @param {Array}  resolvedRows - From _resolveBomUpdate()
 * @param {Object} source       - One entry from ISSUANCE_SOURCES[]
 * @param {string} batchId      - Unique batch session ID
 * @param {string} snapshotDate - DATE string (yyyy-MM-dd)
 * @param {string} uploadedAt   - TIMESTAMP string (ISO 8601 UTC)
 * @return {string} CSV string with header row
 */
function _buildIssuanceCsv(resolvedRows, source, batchId, snapshotDate, uploadedAt) {
  const headers = [
    'ISSUANCE_ID', 'BOM_UPDATE', 'VPO', 'CUMULATIVE_ISSUANCE_QTY',
    'SNAPSHOT_DATE', 'SOURCE_BOM_CODE', 'SYNC_BATCH_ID', 'SYNCED_AT',
    'SOURCE_ID', 'MAIN_GROUP', 'RESOLUTION_METHOD'
  ];

  const lines = [headers.join(',')];

  resolvedRows.forEach(row => {
    // Deterministic ID: ISU_ + MD5(BOM_UPDATE|VPO|SOURCE_ID)
    const issuanceId = 'ISU_' + _generateHash(`${row.bomUpdate}|${row.vpo}|${source.SOURCE_ID}`);

    const values = [
      issuanceId,
      row.bomUpdate,
      row.vpo,
      row.issuedQty,
      snapshotDate,
      row.sourceBomCode,
      batchId,
      uploadedAt,
      source.SOURCE_ID,
      row.mainGroup,
      row.resolutionMethod
    ];

    lines.push(values.map(v => {
      if (v === null || v === undefined || v === '') return '';
      const str = String(v).replace(/"/g, '""');
      return `"${str}"`;
    }).join(','));
  });

  return lines.join('\n');
}


// ═══════════════════════════════════════════════════════════════════════════════
// 6. SP RESULT PARSER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parses the summary row returned by SP_M4_ISSUANCE_MERGE.
 * SP returns 1 row: SESSION_ID, STAGED_COUNT, INSERTED_COUNT,
 *                   DELETED_COUNT, SP_STATUS
 */
function _parseIssuanceSpResult(spResult, batchId) {
  if (!spResult || spResult.length === 0) {
    console.warn(`[${batchId}] ⚠️ SP returned no result. Assuming success with 0 counts.`);
    return { status: 'SP_NO_RESULT', staged: 0, inserted: 0, updated: 0, deleted: 0 };
  }
  const row = spResult[0];
  return {
    status:   row.SP_STATUS    || 'UNKNOWN',
    staged:   parseInt(row.STAGED_COUNT   || 0),
    inserted: parseInt(row.INSERTED_COUNT || 0),
    updated:  0, // Not tracked in Option B
    deleted:  parseInt(row.DELETED_COUNT  || 0),
    error:    row.SP_STATUS && row.SP_STATUS.startsWith('SP_ERROR') ? row.SP_STATUS : ''
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// 7. EMAIL REPORT (ZXH threading pattern)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sends a rich HTML email report with Gmail threading.
 * Groups all source results in one email (one thread per month).
 *
 * @param {Array}  sourceReports - Array of { source, report, duration }
 * @param {string} overallStatus - 'SUCCESS', 'PARTIAL', or 'FAILED'
 * @param {string} batchId       - Master session ID
 * @param {string} duration      - Total duration in seconds
 */
function _sendIssuanceReport(sourceReports, overallStatus, batchId, duration) {
  const timeStr = Utilities.formatDate(new Date(), ISSUANCE_MODULE.TIMEZONE, 'dd/MM/yyyy HH:mm:ss');
  const monthYear = Utilities.formatDate(new Date(), ISSUANCE_MODULE.TIMEZONE, 'MMM yyyy');
  const subject = `${ISSUANCE_EMAIL.SUBJECT_PREFIX} — ${monthYear}`;

  const isFailed = overallStatus === 'FAILED';
  const isPartial = overallStatus === 'PARTIAL';
  const headerColor = isFailed ? '#dc3545' : isPartial ? '#f0ad4e' : '#28a745';
  const headerIcon = isFailed ? '⛔' : isPartial ? '⚠️' : '✅';
  const headerTitle = isFailed ? 'Sync Failed' : isPartial ? 'Sync Partial — Some Sources Failed' : 'Sync Successful';

  // Build per-source result rows
  const sourceRows = sourceReports.map(({ source, report, duration: d }) => {
    const rowColor = report.status === 'FAILED' ? '#f4cccc' : '#d9ead3';
    return `
      <tr style="background:${rowColor}">
        <td style="padding:6px 8px; border:1px solid #ddd;">${source.DISPLAY_NAME}</td>
        <td style="padding:6px 8px; border:1px solid #ddd;">${report.status}</td>
        <td style="padding:6px 8px; border:1px solid #ddd; text-align:right;">${report.staged || 0}</td>
        <td style="padding:6px 8px; border:1px solid #ddd; text-align:right;">${report.inserted || 0}</td>
        <td style="padding:6px 8px; border:1px solid #ddd; text-align:right;">${report.deleted || 0}</td>
        <td style="padding:6px 8px; border:1px solid #ddd; text-align:right;">${d}s</td>
        <td style="padding:6px 8px; border:1px solid #ddd; color:#cc0000; font-size:10px;">${report.error || ''}</td>
      </tr>`;
  }).join('');

  // Verification SQL block in email body
  let verifyBlock = '';
  try {
    const config = ISC_SCM_Core_Lib.getCoreConfig();
    const fq = `${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}`;
    verifyBlock = `
      <div style="margin-top:15px; font-size:11px; color:#555;">
        <strong style="color:#0366d6;">🕵️ Developer SQL Kit (V${ISSUANCE_MODULE.VERSION})</strong>
        <p style="font-size:10px; color:#888;">Copy → Run in BigQuery Console</p>
        <div style="margin-top:8px;">
          <strong>① This Run — Material_Issuance totals:</strong>
          <div style="background:#f4f6f8; padding:8px; border-radius:4px; font-family:Consolas,monospace; font-size:10px; margin-top:4px;">
            SELECT SOURCE_ID, COUNT(*) AS row_count, SUM(CUMULATIVE_ISSUANCE_QTY) AS total_qty,<br>
            &nbsp;&nbsp;MAX(SYNCED_AT) AS synced_at<br>
            FROM \`${fq}.Material_Issuance\`<br>
            WHERE SYNC_BATCH_ID LIKE '${batchId}%'<br>
            GROUP BY SOURCE_ID;
          </div>
        </div>
        <div style="margin-top:8px;">
          <strong>② Cross-check SHORTAGE_ISSUANCE activated:</strong>
          <div style="background:#f4f6f8; padding:8px; border-radius:4px; font-family:Consolas,monospace; font-size:10px; margin-top:4px;">
            SELECT BOM_UPDATE, MAIN_GROUP,<br>
            &nbsp;&nbsp;ROUND(SHORTAGE_COMPLETION, 2) AS shortage_completion,<br>
            &nbsp;&nbsp;ROUND(SHORTAGE_ISSUANCE, 2) AS shortage_issuance,<br>
            &nbsp;&nbsp;HAS_ISSUANCE_DATA<br>
            FROM \`${fq}.Material_Demand_VIEW\`<br>
            WHERE LOWER(TRIM(MAIN_GROUP)) = 'chì'<br>
            ORDER BY BOM_UPDATE LIMIT 20;
          </div>
        </div>
      </div>`;
  } catch (e) { /* Ignore config errors in email builder */ }

  const html = `
  <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 700px; margin: 0 auto;">
    <div style="background: ${headerColor}; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
      <h2 style="margin: 0;">${headerIcon} Issuance AutoSync Report — ${headerTitle}</h2>
      <p style="margin: 5px 0 0; opacity: 0.9;">Master Batch: ${batchId} · Total Duration: ${duration}s</p>
    </div>
    <div style="padding: 20px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px;">
      <table style="width:100%; border-collapse:collapse;">
        <thead>
          <tr style="background:#f0f0f0;">
            <th style="padding:6px 8px; border:1px solid #ddd; text-align:left;">Source</th>
            <th style="padding:6px 8px; border:1px solid #ddd; text-align:left;">Status</th>
            <th style="padding:6px 8px; border:1px solid #ddd; text-align:right;">Staged</th>
            <th style="padding:6px 8px; border:1px solid #ddd; text-align:right;">Inserted</th>
            <th style="padding:6px 8px; border:1px solid #ddd; text-align:right;">Deleted</th>
            <th style="padding:6px 8px; border:1px solid #ddd; text-align:right;">Duration</th>
            <th style="padding:6px 8px; border:1px solid #ddd; text-align:left;">Error</th>
          </tr>
        </thead>
        <tbody>${sourceRows}</tbody>
      </table>
      ${!isFailed ? verifyBlock : ''}
      <p style="color: #888; font-size: 11px; margin-top: 15px;">
        Generated at ${timeStr} (HCM Time) · V${ISSUANCE_MODULE.VERSION}
      </p>
    </div>
  </div>`;

  // Gmail threading (ZXH pattern: reply to existing month thread)
  try {
    const threads = GmailApp.search(`subject:"${subject}" label:${ISSUANCE_EMAIL.LABEL}`, 0, 1);
    if (threads.length > 0) {
      threads[0].reply('', { htmlBody: html });
      console.log(`[${batchId}] 📧 Replied to existing email thread.`);
    } else {
      GmailApp.sendEmail(ISSUANCE_EMAIL.RECIPIENTS, subject, '', { htmlBody: html });
      Utilities.sleep(2000);
      const newThreads = GmailApp.search(`subject:"${subject}"`, 0, 1);
      if (newThreads.length > 0) {
        let label = GmailApp.getUserLabelByName(ISSUANCE_EMAIL.LABEL);
        if (!label) label = GmailApp.createLabel(ISSUANCE_EMAIL.LABEL);
        label.addToThread(newThreads[0]);
      }
      console.log(`[${batchId}] 📧 Created new email thread.`);
    }
  } catch (emailErr) {
    console.error(`[${batchId}] ⚠️ Email failed: ${emailErr.message}`);
    try {
      MailApp.sendEmail({
        to: ISSUANCE_EMAIL.RECIPIENTS,
        subject: `${ISSUANCE_EMAIL.SUBJECT_PREFIX} ${overallStatus} (Fallback)`,
        body: `Status: ${overallStatus}\nBatch: ${batchId}\nDuration: ${duration}s`
      });
    } catch (e2) {
      console.error(`[${batchId}] ⚠️ Fallback email also failed: ${e2.message}`);
    }
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// 8. HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generates MD5 hex string. Same pattern as ZXH AutoSync.
 */
function _generateHash(input) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    input,
    Utilities.Charset.UTF_8
  );
  return digest.map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}


// ═══════════════════════════════════════════════════════════════════════════════
// 9. ADMIN TOOLS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Manual trigger for testing — runs the full sync immediately.
 * Menu: 📦 Issuance AutoSync → ▶️ Run Sync Now
 */
function admin_TestIssuanceSync() {
  trigger_IssuanceAutoSync();
}

/**
 * Installs the nightly time-driven trigger.
 * Menu: 📦 Issuance AutoSync → ⏰ Install Nightly Trigger
 */
function admin_InstallIssuanceTrigger() {
  const triggerFunc = ISSUANCE_MODULE.TRIGGER_FUNC;

  // Remove any existing triggers for this function first
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === triggerFunc) ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger(triggerFunc)
    .timeBased()
    .atHour(ISSUANCE_MODULE.TRIGGER_HOUR)
    .everyDays(1)
    .inTimezone(ISSUANCE_MODULE.TIMEZONE)
    .create();

  console.log(`✅ Issuance trigger installed: nightly at ${ISSUANCE_MODULE.TRIGGER_HOUR}:00 ${ISSUANCE_MODULE.TIMEZONE}`);
  try {
    SpreadsheetApp.getUi().alert(
      '✅ Trigger Installed',
      `Nightly Issuance AutoSync scheduled at ${ISSUANCE_MODULE.TRIGGER_HOUR}:00 ${ISSUANCE_MODULE.TIMEZONE}.`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) { /* Script editor — no UI */ }
}

/**
 * Removes the nightly trigger.
 * Menu: 📦 Issuance AutoSync → 🚫 Remove Nightly Trigger
 */
function admin_RemoveIssuanceTrigger() {
  const triggerFunc = ISSUANCE_MODULE.TRIGGER_FUNC;
  let count = 0;
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === triggerFunc) {
      ScriptApp.deleteTrigger(t);
      count++;
    }
  });
  console.log(`✅ Removed ${count} Issuance AutoSync trigger(s).`);
  try {
    SpreadsheetApp.getUi().alert('✅ Trigger Removed', `${count} trigger(s) removed.`, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) { /* Script editor */ }
}

/**
 * Shows trigger status.
 * Menu: 📦 Issuance AutoSync → 📊 Show Trigger Status
 */
function admin_ShowIssuanceTriggerStatus() {
  const triggerFunc = ISSUANCE_MODULE.TRIGGER_FUNC;
  const triggers = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === triggerFunc);
  const msg = triggers.length === 0
    ? '⚠️ No active trigger found. Use "Install Nightly Trigger" to schedule.'
    : `✅ ${triggers.length} trigger(s) active for ${triggerFunc}.`;
  console.log(msg);
  try {
    SpreadsheetApp.getUi().alert('📊 Trigger Status', msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) { /* Script editor */ }
}

/**
 * Resets last-run state (for debugging / retry after failure).
 * Menu: 📦 Issuance AutoSync → ⚙️ Admin Tools → 🔄 Reset Last-Run State
 * Currently a no-op: state is fully driven by BQ timestamps (no local state to reset).
 */
function admin_ResetIssuanceState() {
  console.log('ℹ️ Reset: Issuance AutoSync has no local state. Re-run sync to refresh BQ data.');
  try {
    SpreadsheetApp.getUi().alert(
      '✅ State Reset',
      'No local state to reset. The next sync run will refresh BigQuery data automatically.',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) { /* Script editor */ }
}
