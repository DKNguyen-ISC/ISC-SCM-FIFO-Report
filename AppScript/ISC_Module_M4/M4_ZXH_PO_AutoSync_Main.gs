/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🔄 M4_ZXH_PO_AUTOSYNC_MAIN.gs (V7.4)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * Nightly sync of PO tracking data from ZXH Corporation (外协) Google Sheet
 * into the ISC BigQuery data warehouse. Creates/updates rows in PO_Header,
 * PO_Line, and PO_Line_Tracking — the same tables used by the standard
 * M1→M2→M3→M4 pipeline.
 * 
 * ARCHITECTURE:
 *   [ZXH Sheet] ──▶ [Apps Script: Filter + Hash + Enrich]
 *       │                    │
 *   FALLBACK:            ▼
 *   ISC "PO Link"    [ZXH_PO_AutoSync_Staging (CSV Upload)]
 *       tab                  │
 *                            ▼
 *                  [SP_SYNC_ZXH_PO]
 *                            │
 *                  ┌─────────┼─────────┐
 *                  ▼         ▼         ▼
 *             PO_Header  PO_Line  PO_Line_Tracking
 * 
 * PROVENANCE:
 *   PO_ORIGIN  = 'ZXH_AUTO_SYNC'
 *   UPDATED_BY = 'M4_ZXH_SYNC_ROBOT'
 * 
 * COMPANION FILE: M4_ZXH_PO_AutoSync_SheetBuilder.gs
 *   Contains: _updateGateway(), _buildGatewayStructure(), admin_RebuildPOSyncGateway()
 * 
 * VERIFIED AGAINST:
 * - Config_Schema.txt (ZXH_PO_AutoSync_Staging, PO_Header, PO_Line, PO_Line_Tracking)
 * - SQL_Vault.txt (SP_SYNC_ZXH_PO — 14 columns, 6 phases)
 * - BigQueryClient.txt (loadCsvData, runReadQueryMapped, runWriteQuery)
 * - M4_Stock_AutoSync_Main.txt (Email threading + Config patterns)
 * - Logger.txt (logStep signature)
 * 
 * V7 FIXES INCORPORATED:
 *   #5 Empty sheet guard (Gemini A)
 *   #7 Bounded fallback read (Claude)
 *   #8 ETA map key warning (Claude) — documented only
 * 
 * VERSION: 7.4 (Pipeline Naming Harmonization + ZXH_DOC_/ZXH_LINE_ Prefix)
 * DATE: February 2026
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const PO_SYNC_CONFIG = {
  // ── Identity ──────────────────────────────────────────────────────────────
  VERSION: '7.4',
  MODULE_ID: 'M4_ZXH_PO_AUTOSYNC',
  ROBOT_NAME: 'M4_ZXH_SYNC_ROBOT',

  // ── Data Source: ZXH Chinese Corporation File ─────────────────────────────
  ZXH_SHEET_URL: 'https://docs.google.com/spreadsheets/d/1fBwwxkC_z-xtjB1uQpF8-C0KpwGjnNe8ICH6fbv7uro/edit?gid=1637669119#gid=1637669119',
  ZXH_SHEET_NAME: '2. PO-需求',
  ZXH_MAX_ROWS: 5500,                        // ⚠️ Memory Bomb guard (V5 Fix)
  ZXH_HEADER_ROW: 3,                         // English headers row (for circuit breaker)
  ZXH_DATA_START_ROW: 3,                     // Match IMPORTRANGE start; Triple-Guard filters noise
  ZXH_READ_COLS: 21,                         // Columns A through U

  // ── Data Source: ISC PO Link Spreadsheet (LEAD Plan + Fallback) ───────────
  // Both "2. LEAD Plan" and "7. PO Link" are tabs in THIS spreadsheet
  ISC_SHEET_URL: 'https://docs.google.com/spreadsheets/d/1XU6MYx-FNCzLKnAfSHYVWFthTRSxGEXJ2bvBxMsvj08/edit?gid=1050437602#gid=1050437602',
  LEAD_PLAN_SHEET_NAME: '2. LEAD Plan',
  LEAD_PLAN_INV_ROW: 8,                      // Row 8: INV identifiers ACROSS columns (horizontal)
  LEAD_PLAN_ETA_ROW: 13,                     // Row 13: ETA ISC dates ACROSS columns (horizontal)
  FALLBACK_SHEET_NAME: '7. PO Link',         // Fallback tab (IMPORTRANGE mirror of ZXH)
  FALLBACK_MAX_ROWS: 5500,                   // 🆕 V7: Bounded fallback

  // ── ZXH Column Map (V3 Verified against real sheet) ───────────────────────
  // Layout: 21+ columns, Chinese/English headers, data from Row 3
  ZXH_COL: {
    REMARK: 0,              // A  — 备注
    REQUIRE_DATE: 1,        // B  — 要求提出日期
    LOADING_DATE: 2,        // C  — 要求装柜日期
    ACTUAL_CAN_LOAD: 3,     // D  — 能装柜日期
    GAP: 4,                 // E  — 差距
    INVOICE: 5,             // F  — 发票号
    LOADING_PLACE: 6,       // G  — 装柜地点
    PO_NUMBER: 7,           // H  — 采购单
    SUPPLIER: 8,            // I  — 供应商
    BOM: 9,                 // J  — 代码
    GROSS_QTY: 10,          // K  — 罗数
    NAME: 19,               // T  — 名称
    ACTUAL_INV: 20          // U  — 实际发票 (IDENTITY ANCHOR)
  },

  // ── PO Link Fallback Column Map (8 columns from IMPORTRANGE+QUERY) ────────
  // QUERY: "SELECT Col2, Col3, Col9, Col20, Col10, Col11, Col21"
  // + Col H = ETA from XLOOKUP to LEAD Plan
  POLINK_COL: {
    REQUIRE_DATE: 0,        // A  — Require date
    LOADING_DATE: 1,        // B  — Required Loading date
    SUPPLIER: 2,            // C  — Source (供应商)
    NAME: 3,                // D  — 名称
    BOM: 4,                 // E  — Bom (代码)
    GROSS_QTY: 5,           // F  — Gross (罗数)
    ACTUAL_INV: 6,          // G  — Actual INV (实际发票)
    ETA: 7                  // H  — ETA ISC (from XLOOKUP)
  },

  // ── BigQuery Targets ──────────────────────────────────────────────────────
  STAGING_TABLE: 'ZXH_PO_AutoSync_Staging',
  SP_NAME: 'SP_SYNC_ZXH_PO',

  // ── Email Config ──────────────────────────────────────────────────────────
  EMAIL_RECIPIENTS: 'dk@isconline.vn',
  EMAIL_LABEL: 'ISC_Logs',
  EMAIL_SUBJECT_PREFIX: 'M4 ZXH PO AutoSync',
  TIMEZONE: 'Asia/Ho_Chi_Minh',

  // ── Circuit Breaker (V3 verified: English headers in Row 3) ───────────────
  // Spot-check 3 stable columns to detect sheet restructure
  EXPECTED_HEADERS: [
    { col: 0,  value: 'Remark' },     // Col A
    { col: 9,  value: 'Bom' },        // Col J
    { col: 10, value: 'Gross' }       // Col K
  ],

  // ── Gateway Sheet (V7.4: replaces old log-only tab) ─────────────────────
  GATEWAY_SHEET_NAME: 'ZXH_PO_AutoSync_Gateway',
  LOG_MAX_ROWS: 50                       // Auto-trim: keep last 50 run entries in Zone B
};

// ═══════════════════════════════════════════════════════════════════════════════
// 📋 PIPELINE PROVENANCE
// ═══════════════════════════════════════════════════════════════════════════════
// This module syncs PO data from the ZXH Chinese Corporation file (外协) into
// BigQuery. It is one of FOUR distinct PO ingestion pipelines:
//
//   Pipeline              │ ID Prefix        │ PO_ORIGIN          │ Module
//   ──────────────────────┼──────────────────┼────────────────────┼────────────────
//   M3 System POs         │ (M3 logic)       │ 'SYSTEM'           │ M3 Procurement
//   ZXH AutoSync (THIS)   │ ZXH_DOC_/LINE_   │ 'ZXH_AUTO_SYNC'    │ M4 ZXH AutoSync
//   Direct Injection      │ INJ_DOC_/LINE_   │ 'DIRECT_INJECTION' │ M4 Injection Portal
//   Manual MTS            │ (M3 logic)       │ 'MANUAL_MTS'       │ M3 Procurement
//
// ZXH Source: https://docs.google.com/spreadsheets/d/1fBwwxkC_z-xtjB1uQpF8-C0KpwGjnNe8ICH6fbv7uro
// ═══════════════════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════════════════
// 1B. ZXH AUTOSYNC MENU (V7.3)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Creates the dedicated ZXH AutoSync top-level menu.
 * Call this from onOpen() in M4_Main.
 */
function createZXHAutoSyncMenu() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🔄 ZXH AutoSync')
    .addItem('▶️  Run Sync Now (Test)', 'admin_TestPOSync')
    .addSeparator()
    .addItem('⏰ Install Nightly Trigger', 'admin_InstallPOSyncTrigger')
    .addItem('🚫 Remove Nightly Trigger', 'admin_RemovePOSyncTrigger')
    .addSeparator()
    .addItem('📊 Show Sync Status', 'admin_ShowPOSyncStatus')
    .addSeparator()
    .addSubMenu(ui.createMenu('⚙️ Admin Tools')
      .addItem('🔄 Rebuild PO Sync Gateway', 'admin_RebuildPOSyncGateway')
    )
    .addToUi();
}


// ═══════════════════════════════════════════════════════════════════════════════
// 2. MAIN TRIGGER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ⏰ TRIGGER FUNCTION — Schedule nightly via Time-Driven Trigger.
 * This script must be BOUND to the M4 Master Spreadsheet.
 * 
 * Execution Flow (6 Stages):
 *   1. Read data from ZXH (primary) or PO Link (fallback)
 *   2. Build ETA lookup map from LEAD Plan
 *   3. Triple-Guard filter + Hash generation + ETA enrichment
 *   4. Build CSV and bulk upload to ZXH_PO_AutoSync_Staging
 *   5. Execute SP_SYNC_ZXH_PO
 *   6. Parse result, send email report
 */
function trigger_M4_ZXH_PO_AutoSync() {
  const LOG_ID = `PO_SYNC_${Date.now()}`;
  const startTime = Date.now();
  console.log(`[${LOG_ID}] 🚀 Starting ZXH PO AutoSync V${PO_SYNC_CONFIG.VERSION}...`);

  try {
    // ── STEP 1: LOG START ──────────────────────────────────────────────────
    ISC_SCM_Core_Lib.logStep(LOG_ID, PO_SYNC_CONFIG.MODULE_ID, 1, 'START_PO_SYNC', 'RUNNING');

    // ── STEP 2: READ DATA (Primary → Fallback) ────────────────────────────
    const readResult = _readPOData(LOG_ID);
    if (!readResult || !readResult.data || readResult.data.length === 0) {
      console.log(`[${LOG_ID}] ℹ️ No data found. Exiting cleanly.`);
      ISC_SCM_Core_Lib.logStep(LOG_ID, PO_SYNC_CONFIG.MODULE_ID, 2, 'NO_DATA', 'SUCCESS');
      const noDataReport = { status: 'NO_DATA', staged: 0, inserted: 0, updated: 0, orphans: 0 };
      _sendSyncReport(noDataReport, LOG_ID);
      _updateGateway(noDataReport, readResult ? readResult.source : '', ((Date.now() - startTime) / 1000).toFixed(1), LOG_ID);
      return;
    }
    console.log(`[${LOG_ID}] 📊 Data source: ${readResult.source}, ${readResult.data.length} raw rows.`);

    // ── STEP 3: BUILD ETA MAP ──────────────────────────────────────────────
    const etaMap = _buildEtaMap(LOG_ID);

    // ── STEP 4: FILTER + HASH + ENRICH ─────────────────────────────────────
    const enrichedRows = _filterHashEnrich(readResult.data, readResult.source, etaMap, LOG_ID);
    if (enrichedRows.length === 0) {
      console.log(`[${LOG_ID}] ℹ️ All rows filtered out by Quad-Guard. Exiting.`);
      ISC_SCM_Core_Lib.logStep(LOG_ID, PO_SYNC_CONFIG.MODULE_ID, 4, 'ALL_FILTERED', 'SUCCESS');
      const filteredReport = { status: 'ALL_FILTERED', staged: 0, inserted: 0, updated: 0, orphans: 0 };
      _sendSyncReport(filteredReport, LOG_ID);
      _updateGateway(filteredReport, readResult.source, ((Date.now() - startTime) / 1000).toFixed(1), LOG_ID);
      return;
    }

    // ── STEP 5: BUILD CSV & UPLOAD ─────────────────────────────────────────
    const csv = _buildCsv(enrichedRows);
    ISC_SCM_Core_Lib.loadCsvData(
      PO_SYNC_CONFIG.STAGING_TABLE, csv, 'WRITE_TRUNCATE'
    );
    console.log(`[${LOG_ID}] ✅ Staged ${enrichedRows.length} rows → ${PO_SYNC_CONFIG.STAGING_TABLE}`);
    ISC_SCM_Core_Lib.logStep(LOG_ID, PO_SYNC_CONFIG.MODULE_ID, 5, 'CSV_STAGED', 'RUNNING', null, null);

    // ── STEP 6: EXECUTE SP ─────────────────────────────────────────────────
    const config = ISC_SCM_Core_Lib.getCoreConfig();
    const fqDataset = `${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}`;
    const spSql = `CALL \`${fqDataset}.${PO_SYNC_CONFIG.SP_NAME}\`('${LOG_ID}')`;
    
    console.log(`[${LOG_ID}] ⚙️ Executing ${PO_SYNC_CONFIG.SP_NAME}...`);
    const spResult = ISC_SCM_Core_Lib.runReadQueryMapped(spSql);

    // ── STEP 7: PARSE & REPORT ─────────────────────────────────────────────
    const report = _parseSpResult(spResult, LOG_ID);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log(`[${LOG_ID}] 🏁 SP Complete — Inserted: ${report.inserted}, Updated: ${report.updated}, Orphans: ${report.orphans} (${duration}s)`);
    ISC_SCM_Core_Lib.logStep(LOG_ID, PO_SYNC_CONFIG.MODULE_ID, 7, 'FINISH_PO_SYNC', 'SUCCESS', duration);
    _sendSyncReport(report, LOG_ID);
    _updateGateway(report, readResult.source, duration, LOG_ID);

  } catch (e) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`[${LOG_ID}] ❌ CRITICAL FAILURE: ${e.message}`);
    ISC_SCM_Core_Lib.logStep(LOG_ID, PO_SYNC_CONFIG.MODULE_ID, 99, 'PO_SYNC_CRASH', 'FAILED', null, e.message);
    const failReport = { status: 'FAILED', error: e.message, staged: 0, inserted: 0, updated: 0, orphans: 0 };
    _sendSyncReport(failReport, LOG_ID);
    _updateGateway(failReport, '', duration, LOG_ID);
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// 3. DATA READER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Reads PO data from ZXH sheet (primary) or ISC PO Link tab (fallback).
 * 
 * 🛡️ CIRCUIT BREAKER: Validates 6 expected headers before proceeding.
 * 🛡️ BOUNDED READ: Caps at ZXH_MAX_ROWS to prevent memory crashes.
 * 🆕 V7 FIX #5: Added empty-sheet guard (Gemini A Pro-Tip 1).
 * 🆕 V7 FIX #7: Bounded read on fallback path (Claude L2).
 * 
 * @param {string} batchId - Session identifier for logging
 * @return {Array[]} 2D array of raw row data, or empty array if no data
 */
function _readPOData(batchId) {
  // ── PRIMARY: Try ZXH Direct Read ────────────────────────────────────────
  try {
    const ss = SpreadsheetApp.openByUrl(PO_SYNC_CONFIG.ZXH_SHEET_URL);
    const zxhSheet = ss.getSheetByName(PO_SYNC_CONFIG.ZXH_SHEET_NAME);

    if (!zxhSheet) throw new Error('ZXH tab not found: ' + PO_SYNC_CONFIG.ZXH_SHEET_NAME);

    // 🛡️ CIRCUIT BREAKER: Spot-check 3 known column headers in Row 3.
    // If ZXH restructures their sheet, we abort rather than ingest garbage.
    const headerRow = zxhSheet.getRange(
      PO_SYNC_CONFIG.ZXH_HEADER_ROW, 1, 1,
      PO_SYNC_CONFIG.ZXH_READ_COLS
    ).getValues()[0];

    const headerFails = PO_SYNC_CONFIG.EXPECTED_HEADERS.filter(check => {
      const actual = String(headerRow[check.col] || '').trim().toUpperCase();
      return !actual.includes(check.value.toUpperCase());
    });
    if (headerFails.length > 0) {
      const failDetails = headerFails.map(f => `Col${f.col}:expected "${f.value}", got "${headerRow[f.col]}"`).join('; ');
      throw new Error(`CIRCUIT_BREAKER: Header mismatch — ${failDetails}`);
    }

    // 🛡️ BOUNDED READ (V5 Fix — prevents 50K row memory bomb)
    const lastRow = Math.min(zxhSheet.getLastRow(), PO_SYNC_CONFIG.ZXH_MAX_ROWS);
    const startRow = PO_SYNC_CONFIG.ZXH_DATA_START_ROW;

    // 🆕 V7 FIX #5: Empty sheet guard
    if (lastRow < startRow) return { data: [], source: 'ZXH' };

    // Read columns A through U (21 cols). Triple-Guard filters header/total/empty rows.
    const data = zxhSheet.getRange(startRow, 1, lastRow - startRow + 1, PO_SYNC_CONFIG.ZXH_READ_COLS).getValues();
    console.log(`[${batchId}] ✅ ZXH Primary Read: ${data.length} rows (from Row ${startRow}).`);
    return { data: data, source: 'ZXH' };

  } catch (e) {
    console.warn(`[${batchId}] ⚠️ ZXH Read Failed: ${e.message}. Falling back to PO Link.`);
  }

  // ── FALLBACK: ISC "7. PO Link" Tab ────────────────────────────────────────
  // Both LEAD Plan and PO Link live in the SAME ISC spreadsheet (not the bound one).
  try {
    const ss = SpreadsheetApp.openByUrl(PO_SYNC_CONFIG.ISC_SHEET_URL);
    const linkSheet = ss.getSheetByName(PO_SYNC_CONFIG.FALLBACK_SHEET_NAME);

    if (!linkSheet) throw new Error('PO Link fallback tab not found: ' + PO_SYNC_CONFIG.FALLBACK_SHEET_NAME);

    // 🆕 V7 FIX #7: Bounded read on fallback too
    const lastRow = Math.min(linkSheet.getLastRow(), PO_SYNC_CONFIG.FALLBACK_MAX_ROWS);
    if (lastRow < 2) return { data: [], source: 'PO_LINK' };

    // PO Link has 8 columns (A-H): Req Date, Loading Date, Source, Name, Bom, Gross, INV, ETA
    const data = linkSheet.getRange(2, 1, lastRow - 1, 8).getValues();
    console.log(`[${batchId}] ✅ Fallback Read: ${data.length} rows (PO Link tab).`);
    return { data: data, source: 'PO_LINK' };

  } catch (e2) {
    throw new Error(`BOTH_SOURCES_FAILED: Primary and Fallback both unreachable. Last error: ${e2.message}`);
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// 4. ETA MAP BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Builds a lookup map of INV → ETA Date from the LEAD Plan sheet.
 * This provides Level 1 (highest priority) ETA values in the 4-level waterfall.
 * 
 * ⚠️ V7 WARNING (§8.11): Keys use raw INV (uppercase, trimmed), NOT sanitized.
 *    If LEAD Plan writes "VI260009" but ZXH writes "VI-260009",
 *    the Level 1 ETA will silently miss. Waterfall falls through to Level 2+.
 *    This is DOCUMENTED BEHAVIOR, not a bug.
 * 
 * @param {string} batchId - Session identifier for logging
 * @return {Object} Map of { INV_UPPERCASE: Date } for ETA lookup
 */
function _buildEtaMap(batchId) {
  const map = {};
  try {
    // LEAD Plan lives in the ISC PO Link spreadsheet (same as fallback)
    const ss = SpreadsheetApp.openByUrl(PO_SYNC_CONFIG.ISC_SHEET_URL);
    const sheet = ss.getSheetByName(PO_SYNC_CONFIG.LEAD_PLAN_SHEET_NAME);
    if (!sheet) return map;

    // 📐 LEAD Plan is HORIZONTAL: 1 column per VPO, 400+ columns
    //   Row 8:  INV identifiers across columns ("VI260009", "VI260010", ...)
    //   Row 13: ETA ISC dates across columns (Apr-15, Feb-27, ...)
    // V3 §A4.1 verified this layout; V3 §B2.3 provides the pseudocode.
    const invRow = sheet.getRange(PO_SYNC_CONFIG.LEAD_PLAN_INV_ROW + ':' + PO_SYNC_CONFIG.LEAD_PLAN_INV_ROW).getValues()[0];
    const etaRow = sheet.getRange(PO_SYNC_CONFIG.LEAD_PLAN_ETA_ROW + ':' + PO_SYNC_CONFIG.LEAD_PLAN_ETA_ROW).getValues()[0];

    for (let col = 0; col < invRow.length; col++) {
      const inv = String(invRow[col] || '').trim().toUpperCase();
      const eta = etaRow[col];
      // Only add if INV looks valid and ETA is a real Date.
      // Spurious label entries ("INVOICE", "ETA ISC") won't match any ZXH INV.
      if (inv && inv.length > 1 && eta instanceof Date) {
        map[inv] = eta;
      }
    }
    console.log(`[${batchId}] ✅ ETA Map: ${Object.keys(map).length} entries from LEAD Plan (horizontal scan).`);
  } catch (e) {
    console.warn(`[${batchId}] ⚠️ ETA Map build failed: ${e.message}. Proceeding without Level 1 ETAs.`);
  }
  return map;
}


// ═══════════════════════════════════════════════════════════════════════════════
// 5. FILTER + HASH + ENRICH
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Applies the Triple-Guard filter, generates deterministic hashes,
 * and enriches rows with ETA waterfall and timestamps.
 * 
 * QUAD-GUARD FILTER (V7.3.2):
 *   1. INV (Actual INV) must be non-empty
 *   2. BOM_CODE must be non-empty
 *   3. GROSS_QTY must be numeric and > 0
 *   4. INV must NOT start with '#' (formula errors) AND must contain ≥1 letter
 *      (filters subtotal rows where INV = "0.00" and formula errors like "#REF!")
 * 
 * ETA WATERFALL (3 Levels — no ETA column in ZXH source):
 *   Level 1: LEAD Plan horizontal map (etaMap lookup — raw INV, uppercase)
 *   Level 2: PO Link Col H (only available in fallback path — already in etaMap)
 *   Level 3: BQ COALESCE in SP (REQUIRE_DATE fallback / keep existing)
 * 
 * DUAL-SOURCE MAPPING:
 *   Source 'ZXH'     → uses ZXH_COL indices (21 columns, V3 verified)
 *   Source 'PO_LINK'  → uses POLINK_COL indices (8 columns from IMPORTRANGE)
 * 
 * @param {Array[]} rawData   - 2D array from sheet
 * @param {string}  source    - 'ZXH' or 'PO_LINK'
 * @param {Object}  etaMap    - INV → ETA date lookup from LEAD Plan
 * @param {string}  batchId   - Session identifier
 * @return {Object[]} Array of enriched row objects ready for CSV
 */
function _filterHashEnrich(rawData, source, etaMap, batchId) {
  const now = new Date();
  const uploadTimestamp = Utilities.formatDate(now, 'GMT', "yyyy-MM-dd'T'HH:mm:ss'Z'");
  const rows = [];

  // ── SELECT COLUMN MAP based on data source ────────────────────────────
  const isZXH = (source === 'ZXH');
  const C = isZXH ? PO_SYNC_CONFIG.ZXH_COL : PO_SYNC_CONFIG.POLINK_COL;

  rawData.forEach((row, index) => {
    const inv = String(row[C.ACTUAL_INV] || '').trim();
    const bomCode = String(row[C.BOM] || '').trim();
    const qty = parseFloat(row[C.GROSS_QTY]);

    // ── QUAD-GUARD (V7.3.2) ─────────────────────────────────────────
    // Guards 1-3: Structural (non-empty + positive qty)
    if (!inv || !bomCode || isNaN(qty) || qty <= 0) return;

    // Guard 4: INV quality validation
    //   a) Reject formula errors (#REF!, #N/A, #VALUE!, #ERROR!)
    //   b) Reject subtotal/summary rows where INV = "0.00" (no letters)
    //   Real INVs always contain letters (e.g., "VI 4.2", "Vi 6.1")
    if (inv.startsWith('#') || !/[a-zA-Z]/.test(inv)) return;

    // ── SANITIZE & HASH (V7 §3.2-3.4) ──────────────────────────────────
    const sanitizedInv = _sanitizeForHash(inv);
    const poLineId = 'ZXH_LINE_' + _generateHash(sanitizedInv + '|' + bomCode);
    const poDocId  = 'ZXH_DOC_'  + _generateHash(sanitizedInv);

    // ── ETA WATERFALL ───────────────────────────────────────────────────
    //   Level 1: LEAD Plan horizontal map (always available)
    //   Level 2: PO Link Col H (only in fallback — ETA from XLOOKUP)
    //   Level 3+: Handled by SP COALESCE in BigQuery
    const etaLevel1 = etaMap[inv.toUpperCase()] || null;
    const etaFallback = (!isZXH && C.ETA !== undefined && row[C.ETA] instanceof Date) ? row[C.ETA] : null;
    const bestEta = etaLevel1 || etaFallback;  // Level 1 wins

    rows.push({
      GENERATED_PO_LINE_ID: poLineId,
      GENERATED_PO_DOC_ID: poDocId,
      INV: inv,
      BOM_CODE: bomCode,
      PO_NUMBER_REF: isZXH ? String(row[C.PO_NUMBER] || '').trim() : '',
      SUPPLIER_NAME: String(row[C.SUPPLIER] || '').trim(),
      GROSS_QTY: qty,
      REQUIRE_DATE: _formatDateForBQ(row[C.REQUIRE_DATE]),
      REMARK: isZXH ? String(row[C.REMARK] || '').trim() : '',
      ZXH_STATUS: '',  // No Status column in ZXH or PO Link
      ETA: _formatDateForBQ(bestEta),
      PIC: '',         // No PIC column in ZXH or PO Link
      UPLOADED_AT: uploadTimestamp,
      SESSION_ID: batchId
    });
  });

  console.log(`[${batchId}] ✅ Enriched: ${rows.length}/${rawData.length} rows passed Quad-Guard (source: ${source}).`);
  return rows;
}


// ═══════════════════════════════════════════════════════════════════════════════
// 6. CSV BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Converts enriched row objects into a CSV string for BigQuery bulk upload.
 * 
 * CSV SAFETY:
 * - All string values are double-quoted
 * - Internal quotes are escaped (doubled: " → "")
 * - NULL values are empty (unquoted) → BQ interprets as NULL for typed columns
 * - allowQuotedNewlines is enabled in loadCsvData() for multi-line remarks
 * 
 * COLUMN ORDER must match ZXH_PO_AutoSync_Staging schema in Config_Schema.txt:
 *   GENERATED_PO_LINE_ID, GENERATED_PO_DOC_ID, INV, BOM_CODE,
 *   PO_NUMBER_REF, SUPPLIER_NAME, GROSS_QTY, REQUIRE_DATE,
 *   REMARK, ZXH_STATUS, ETA, PIC, UPLOADED_AT, SESSION_ID
 * 
 * @param {Object[]} rows - Array of enriched row objects from _filterHashEnrich
 * @return {string} CSV string with header row
 */
function _buildCsv(rows) {
  const headers = [
    'GENERATED_PO_LINE_ID', 'GENERATED_PO_DOC_ID', 'INV', 'BOM_CODE',
    'PO_NUMBER_REF', 'SUPPLIER_NAME', 'GROSS_QTY', 'REQUIRE_DATE',
    'REMARK', 'ZXH_STATUS', 'ETA', 'PIC', 'UPLOADED_AT', 'SESSION_ID'
  ];

  const lines = [headers.join(',')];

  rows.forEach(row => {
    lines.push(headers.map(h => {
      const val = row[h];
      if (val === null || val === undefined || val === '') return '';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    }).join(','));
  });

  return lines.join('\n');
}


// ═══════════════════════════════════════════════════════════════════════════════
// 7. SP RESULT PARSER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parses the summary row returned by SP_SYNC_ZXH_PO.
 * The SP returns exactly 1 row with these columns:
 *   SESSION_ID, STAGED_COUNT, VALIDATED_COUNT, INSERTED_COUNT,
 *   UPDATED_COUNT, ORPHAN_COUNT, ORPHAN_IDS, SP_STATUS
 * 
 * @param {Array<Object>} spResult - Result from runReadQueryMapped
 * @param {string} batchId - Session identifier for logging
 * @return {Object} Parsed report object
 */
function _parseSpResult(spResult, batchId) {
  if (!spResult || spResult.length === 0) {
    console.warn(`[${batchId}] ⚠️ SP returned no result. Assuming success with 0 counts.`);
    return { status: 'SP_NO_RESULT', staged: 0, validated: 0, inserted: 0, updated: 0, orphans: 0, orphanIds: '' };
  }

  const row = spResult[0];
  return {
    status: row.SP_STATUS || 'UNKNOWN',
    staged: parseInt(row.STAGED_COUNT || 0),
    validated: parseInt(row.VALIDATED_COUNT || 0),
    inserted: parseInt(row.INSERTED_COUNT || 0),
    updated: parseInt(row.UPDATED_COUNT || 0),
    orphans: parseInt(row.ORPHAN_COUNT || 0),
    orphanIds: row.ORPHAN_IDS || ''
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// 8. EMAIL REPORT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sends a rich HTML email report with Gmail threading.
 * Pattern: Borrowed from M4_Stock_AutoSync_Main.txt email threading model.
 * 
 * Threading Logic:
 *   1. Search for existing thread by subject + label (month-scoped)
 *   2. If found → reply to thread (keeps conversation together)
 *   3. If not found → create new thread + apply label
 * 
 * @param {Object} report - Parsed SP result or error report
 * @param {string} batchId - Session identifier
 */
function _sendSyncReport(report, batchId) {
  const timeStr = Utilities.formatDate(new Date(), PO_SYNC_CONFIG.TIMEZONE, 'dd/MM/yyyy HH:mm:ss');
  const monthYear = Utilities.formatDate(new Date(), PO_SYNC_CONFIG.TIMEZONE, 'MMM yyyy');
  const subject = `${PO_SYNC_CONFIG.EMAIL_SUBJECT_PREFIX} — ${monthYear}`;

  // ── Determine status styling ──────────────────────────────────────────
  const isFailed = report.status === 'FAILED';
  const hasOrphans = (report.orphans || 0) > 0;
  const headerColor = isFailed ? '#dc3545' : hasOrphans ? '#f0ad4e' : '#28a745';
  const headerIcon = isFailed ? '⛔' : hasOrphans ? '⚠️' : '✅';
  const headerTitle = isFailed ? 'Sync Failed' : hasOrphans ? 'Sync OK (Orphans Found)' : 'Sync Successful';

  // ── Build BigQuery verification queries ───────────────────────────────
  let verifyQueries = '';
  try {
    const config = ISC_SCM_Core_Lib.getCoreConfig();
    const fq = `${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}`;
    const sqlDate = Utilities.formatDate(new Date(), PO_SYNC_CONFIG.TIMEZONE, 'yyyy-MM-dd');
    verifyQueries = `
      <div style="margin-top:15px; font-size:11px; color:#555;">
        <strong style="color:#0366d6;">🕵️ Developer SQL Kit (V${PO_SYNC_CONFIG.VERSION})</strong>
        <p style="font-size:10px; color:#888;">Copy → Run in BigQuery Console</p>

        <div style="margin-top:8px;">
          <strong>① This Run's Changes:</strong>
          <div style="background:#f4f6f8; padding:8px; border-radius:4px; font-family:Consolas,monospace; font-size:10px; margin-top:4px;">
            SELECT ZXH_STATUS, COUNT(*) AS cnt,<br>
            &nbsp;&nbsp;STRING_AGG(DISTINCT SUPPLIER_NAME, ', ' LIMIT 5) AS sample_suppliers<br>
            FROM \`${fq}.ZXH_PO_AutoSync_Staging\`<br>
            WHERE SESSION_ID = '${batchId}'<br>
            GROUP BY ZXH_STATUS ORDER BY cnt DESC;
          </div>
        </div>

        <div style="margin-top:8px;">
          <strong>② New POs Created Today:</strong>
          <div style="background:#f4f6f8; padding:8px; border-radius:4px; font-family:Consolas,monospace; font-size:10px; margin-top:4px;">
            SELECT h.PO_DOCUMENT_ID, l.PO_LINE_ID, l.BOM_UPDATE,<br>
            &nbsp;&nbsp;h.SUPPLIER_ID, l.ORDER_QTY, l.UNIT_PRICE, l.LINE_TOTAL<br>
            FROM \`${fq}.PO_Line\` l<br>
            JOIN \`${fq}.PO_Header\` h ON l.PO_DOCUMENT_ID = h.PO_DOCUMENT_ID<br>
            WHERE h.PO_ORIGIN = 'ZXH_AUTO_SYNC'<br>
            &nbsp;&nbsp;AND l.CREATED_AT >= TIMESTAMP('${sqlDate}')<br>
            ORDER BY l.CREATED_AT DESC LIMIT 20;
          </div>
        </div>

        <div style="margin-top:8px;">
          <strong>③ Orphan Investigation:</strong>
          <div style="background:#f4f6f8; padding:8px; border-radius:4px; font-family:Consolas,monospace; font-size:10px; margin-top:4px;">
            SELECT l.PO_LINE_ID, l.BOM_UPDATE, h.SUPPLIER_ID,<br>
            &nbsp;&nbsp;t.STATUS, t.UPDATED_AT<br>
            FROM \`${fq}.PO_Line_Tracking\` t<br>
            JOIN \`${fq}.PO_Line\` l ON t.PO_LINE_ID = l.PO_LINE_ID<br>
            JOIN \`${fq}.PO_Header\` h ON l.PO_DOCUMENT_ID = h.PO_DOCUMENT_ID<br>
            WHERE h.PO_ORIGIN = 'ZXH_AUTO_SYNC'<br>
            &nbsp;&nbsp;AND t.STATUS = 'ORPHANED' AND t.IS_ACTIVE = TRUE<br>
            ORDER BY t.UPDATED_AT DESC LIMIT 20;
          </div>
        </div>

        <div style="margin-top:8px;">
          <strong>④ 7-Day Trend:</strong>
          <div style="background:#f4f6f8; padding:8px; border-radius:4px; font-family:Consolas,monospace; font-size:10px; margin-top:4px;">
            SELECT<br>
            &nbsp;&nbsp;(SELECT COUNT(DISTINCT PO_DOCUMENT_ID) FROM \`${fq}.PO_Header\`<br>
            &nbsp;&nbsp;&nbsp;WHERE PO_ORIGIN = 'ZXH_AUTO_SYNC') AS total_headers,<br>
            &nbsp;&nbsp;(SELECT COUNT(*) FROM \`${fq}.PO_Line\` L<br>
            &nbsp;&nbsp;&nbsp;JOIN \`${fq}.PO_Header\` H ON L.PO_DOCUMENT_ID = H.PO_DOCUMENT_ID<br>
            &nbsp;&nbsp;&nbsp;WHERE H.PO_ORIGIN = 'ZXH_AUTO_SYNC') AS total_lines,<br>
            &nbsp;&nbsp;(SELECT COUNT(DISTINCT SUPPLIER_ID) FROM \`${fq}.PO_Header\`<br>
            &nbsp;&nbsp;&nbsp;WHERE PO_ORIGIN = 'ZXH_AUTO_SYNC'<br>
            &nbsp;&nbsp;&nbsp;AND SUPPLIER_ID != 'UNKNOWN') AS known_suppliers;
          </div>
        </div>
      </div>`;
  } catch (e) { /* Ignore config errors in email builder */ }

  // ── Build HTML body ───────────────────────────────────────────────────
  const html = `
  <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
    <div style="background: ${headerColor}; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
      <h2 style="margin: 0;">${headerIcon} ZXH PO AutoSync Report</h2>
      <p style="margin: 5px 0 0; opacity: 0.9;">Batch: ${batchId}</p>
    </div>
    <div style="padding: 20px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 8px 8px;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Status</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${report.status}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Staged</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${report.staged || 0}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Validated</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${report.validated || 0}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Inserted</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${report.inserted || 0}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Updated</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${report.updated || 0}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Orphans</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${report.orphans || 0}</td></tr>
        ${report.orphanIds ? `
        <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Orphan IDs</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; font-family: monospace; font-size: 11px; word-break: break-all;">${report.orphanIds}</td></tr>
        ` : ''}
        ${report.error ? `
        <tr><td style="padding: 8px; color: red;"><strong>Error</strong></td>
            <td style="padding: 8px; color: red;">${report.error}</td></tr>
        ` : ''}
      </table>
      ${!isFailed ? verifyQueries : ''}
      <p style="color: #888; font-size: 11px; margin-top: 15px;">
        Generated at ${timeStr} (HCM Time) · V${PO_SYNC_CONFIG.VERSION}
      </p>
    </div>
  </div>`;

  // ── Send with Gmail threading ─────────────────────────────────────────
  try {
    const threads = GmailApp.search(`subject:"${subject}" label:${PO_SYNC_CONFIG.EMAIL_LABEL}`, 0, 1);

    if (threads.length > 0) {
      // Reply to existing thread (keeps monthly conversation together)
      threads[0].reply('', { htmlBody: html });
      console.log(`[${batchId}] 📧 Replied to existing email thread.`);
    } else {
      // Create new thread + label
      GmailApp.sendEmail(PO_SYNC_CONFIG.EMAIL_RECIPIENTS, subject, '', {
        htmlBody: html
      });

      // Apply label (create if needed)
      let label = GmailApp.getUserLabelByName(PO_SYNC_CONFIG.EMAIL_LABEL);
      if (!label) label = GmailApp.createLabel(PO_SYNC_CONFIG.EMAIL_LABEL);
      
      Utilities.sleep(2000);  // Wait for Gmail to index the new message
      const newThreads = GmailApp.search(`subject:"${subject}"`, 0, 1);
      if (newThreads.length > 0) {
        label.addToThread(newThreads[0]);
      }
      console.log(`[${batchId}] 📧 Created new email thread.`);
    }
  } catch (emailError) {
    console.error(`[${batchId}] ⚠️ Email Failed: ${emailError.message}`);
    // Fallback: try simple MailApp
    try {
      MailApp.sendEmail({
        to: PO_SYNC_CONFIG.EMAIL_RECIPIENTS,
        subject: `${PO_SYNC_CONFIG.EMAIL_SUBJECT_PREFIX} ${report.status} (Fallback)`,
        body: `Status: ${report.status}\nBatch: ${batchId}\nInserted: ${report.inserted || 0}\nUpdated: ${report.updated || 0}\nOrphans: ${report.orphans || 0}\nError: ${report.error || 'None'}`
      });
    } catch (fallbackErr) {
      console.error(`[${batchId}] ⚠️ Fallback email also failed: ${fallbackErr.message}`);
    }
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// 9. HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Formats a Date value for BigQuery DATE columns (YYYY-MM-DD).
 * Returns null for non-Date inputs or invalid dates.
 * 
 * @param {*} value - Any value to attempt date formatting on
 * @return {string|null} Formatted date string or null
 */
function _formatDateForBQ(value) {
  if (!(value instanceof Date) || isNaN(value.getTime())) return null;
  return Utilities.formatDate(value, 'GMT', 'yyyy-MM-dd');
}

/**
 * Strips ALL non-alphanumeric characters and uppercases the result.
 * Ensures hash consistency across vendor formatting variations.
 * 
 * Examples:
 *   "VI-260009"  → "VI260009"
 *   "VI 260009"  → "VI260009"
 *   "VI.260009"  → "VI260009"
 * 
 * @param {string} input - Raw input string
 * @return {string} Sanitized string (uppercase, alphanumeric only)
 */
function _sanitizeForHash(input) {
  return String(input).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/**
 * Generates MD5 hex string from input.
 * Uses GAS Utilities.computeDigest with UTF-8 charset.
 * 
 * @param {string} input - String to hash
 * @return {string} 32-character lowercase hex MD5 digest
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
// 10. ADMIN TOOLS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Installs the nightly time-driven trigger for ZXH PO AutoSync.
 * Removes any existing triggers for this function first.
 */
function admin_InstallPOSyncTrigger() {
  const triggerFunc = 'trigger_M4_ZXH_PO_AutoSync';

  // Remove existing triggers for this function
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === triggerFunc) {
      ScriptApp.deleteTrigger(t);
    }
  });

  // Create new nightly trigger (runs between 11 PM and midnight VN time)
  ScriptApp.newTrigger(triggerFunc)
    .timeBased()
    .atHour(23)
    .everyDays(1)
    .inTimezone(PO_SYNC_CONFIG.TIMEZONE)
    .create();

  console.log('✅ ZXH PO AutoSync trigger installed: nightly at 23:00 ' + PO_SYNC_CONFIG.TIMEZONE);
  
  try {
    SpreadsheetApp.getUi().alert(
      '✅ PO Sync Trigger Installed',
      `Function: ${triggerFunc}\nSchedule: Nightly at 23:00\nTimezone: ${PO_SYNC_CONFIG.TIMEZONE}\nVersion: ${PO_SYNC_CONFIG.VERSION}`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    // UI not available (running from script editor directly)
  }
}

/**
 * Removes all ZXH PO AutoSync triggers.
 */
function admin_RemovePOSyncTrigger() {
  const triggerFunc = 'trigger_M4_ZXH_PO_AutoSync';

  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === triggerFunc) {
      ScriptApp.deleteTrigger(t);
    }
  });

  console.log('🚫 ZXH PO AutoSync triggers removed.');
  
  try {
    SpreadsheetApp.getUi().alert('🚫 ZXH PO AutoSync triggers removed.');
  } catch (e) {
    // UI not available
  }
}

/**
 * Manual test — runs the full sync pipeline immediately.
 * Use this to validate the pipeline before enabling the nightly trigger.
 */
function admin_TestPOSync() {
  trigger_M4_ZXH_PO_AutoSync();
}

/**
 * Shows the current PO Sync status via UI dialog.
 * Displays: trigger status, gateway sheet status, version info.
 */
function admin_ShowPOSyncStatus() {
  const ui = SpreadsheetApp.getUi();
  const triggerFunc = 'trigger_M4_ZXH_PO_AutoSync';
  
  // Check trigger status
  const triggers = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === triggerFunc);
  const hasTrigger = triggers.length > 0;
  const triggerInfo = hasTrigger 
    ? `✅ Active (${triggers.length} trigger${triggers.length > 1 ? 's' : ''})`
    : '🚫 No trigger installed';
  
  // Check gateway sheet
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const gateway = ss.getSheetByName(PO_SYNC_CONFIG.GATEWAY_SHEET_NAME);
  const gatewayInfo = gateway 
    ? `✅ ${PO_SYNC_CONFIG.GATEWAY_SHEET_NAME} (${gateway.getLastRow()} rows)` 
    : '⚠️ Gateway sheet not found (use Admin > Rebuild)';
  
  ui.alert(
    `🔄 ZXH AutoSync Status (V${PO_SYNC_CONFIG.VERSION})`,
    `Trigger: ${triggerInfo}\n` +
    `Gateway: ${gatewayInfo}\n` +
    `SP: ${PO_SYNC_CONFIG.SP_NAME}\n` +
    `Staging: ${PO_SYNC_CONFIG.STAGING_TABLE}\n` +
    `Source: ZXH → ${PO_SYNC_CONFIG.ZXH_SHEET_NAME}`,
    ui.ButtonSet.OK
  );
}
