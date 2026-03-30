/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ⚙️ M4_ISSUANCE_AUTOSYNC_CONFIG.gs (V1.0)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 * Configuration constants for the Material Issuance AutoSync pipeline.
 * Defines ISSUANCE_SOURCES[] — each entry describes one material pipeline
 * (one warehouse spreadsheet, one BQ target, one dashboard tab).
 *
 * DESIGN PRINCIPLE (D-P3-2):
 * All code files are GENERAL. All material-specific config lives HERE.
 * Adding a new material in the future = add one entry to ISSUANCE_SOURCES[].
 * Zero code change in Main or SheetBuilder.
 *
 * COMPANION FILES:
 *   M4_Issuance_AutoSync_Main.gs       — Sync engine + menu + email
 *   M4_Issuance_AutoSync_SheetBuilder.gs — Dashboard tab builder
 *
 * DEPENDENCIES:
 *   ISC_SCM_Core_Lib (BigQuery, logging)
 *   SQL_Vault.txt (SP_M4_ISSUANCE_MERGE)
 *
 * VERSION: 1.0
 * DATE: March 2026
 * ═══════════════════════════════════════════════════════════════════════════════
 */


// ═══════════════════════════════════════════════════════════════════════════════
// 1. ISSUANCE SOURCES — Multi-Material Pipeline Config
// ═══════════════════════════════════════════════════════════════════════════════
// Each entry describes one material issuance pipeline.
// Main module loops through ALL active sources every sync run.
//
// ISSUANCE_SOURCES naming convention for DASHBOARD_TAB:
//   Lead:   'Lead_Issuance_AutoSync'
//   Paint:  'Paint_Issuance_AutoSync'   (future)
//   Ink:    'Ink_Issuance_AutoSync'     (future)
// ═══════════════════════════════════════════════════════════════════════════════

const ISSUANCE_SOURCES = [
  {
    SOURCE_ID:          'CHI_LEAD',
    DISPLAY_NAME:       'Chì (Lead Pencil Cores)',
    // Warehouse spreadsheet — Tab: '5. Link Lead plan'
    // REAL MATRIX ORIENTATION (verified 2026-03-02):
    //   ROW 1:  Date label (Feb-22) — skip
    //   ROW 2:  VPO headers horizontal → B2='VPO', then V2512021C09, V2511004C01... from col C
    //   ROW 3:  'Order Qty (grs)' summary row — skip
    //   ROW 4:  'Finished Qty (grs)' summary row — skip
    //   ROW 5:  'GAP (grs)' summary row — skip
    //   ROW 6:  'Sum' summary row — skip
    //   ROWS 7-9: additional summary rows — skip
    //   ROW 10+: BOM data rows → Col A = BOM code, Col B = BOM total, Col C+ = issued qty per VPO
    //   COL A:  BOM_UPDATE vertical (9-digit codes like 302000040)
    //   COL B:  BOM-level totals (skip for qty extraction)
    //   COL C+: Issuance quantities at BOM × VPO intersection
    SPREADSHEET_ID:     '1fz_I_FwXT3vi9XUCkUt1GIpYmDDlzqrKxfJmkUadTi0',
    TAB_NAME:           '5. Link Lead plan',
    // Layout parameters (1-based row/col numbers, matching getRange() convention)
    VPO_HEADER_ROW:     2,     // Row 2 contains VPO codes horizontally (starting from VPO_DATA_COL)
    BOM_COL:            1,     // Column A (index 1, 0-based=0) contains BOM codes
    VPO_DATA_COL:       3,     // Column C (index 3, 0-based=2) — first column with VPO codes + qty data
    DATA_START_ROW:     10,    // Row 10 = first BOM data row (rows 1-9 are headers/summaries)
    MAX_ROWS:           600,   // Bounded read safety limit
    MAX_COLS:           300,   // Bounded column scan safety limit
    // BQ classification filter
    MAIN_GROUP_FILTER:  'Chì',
    // Dashboard tab name
    DASHBOARD_TAB:      'Lead_Issuance_AutoSync',
    ACTIVE:             true
  }

  // ── Future entries (add when needed, zero code change required): ──────────
  // {
  //   SOURCE_ID: 'PAINT',
  //   DISPLAY_NAME: 'Sơn (Paint/Lacquer)',
  //   SPREADSHEET_ID: '...',
  //   TAB_NAME: '...',
  //   VPO_HEADER_ROW: 2, BOM_COL: 1, VPO_DATA_COL: 3,
  //   DATA_START_ROW: 4, MAX_ROWS: 2000, MAX_COLS: 100,
  //   MAIN_GROUP_FILTER: 'Sơn',
  //   DASHBOARD_TAB: 'Paint_Issuance_AutoSync',
  //   ACTIVE: false   // ← set to true when warehouse data is available
  // }
];


// ═══════════════════════════════════════════════════════════════════════════════
// 2. BIGQUERY CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const ISSUANCE_BQ_CONFIG = {
  STAGING_TABLE:    'Material_Issuance_Staging',   // Truncated each run (WRITE_TRUNCATE)
  TARGET_TABLE:     'Material_Issuance',            // Upserted via SP_M4_ISSUANCE_MERGE
  SP_NAME:          'SP_M4_ISSUANCE_MERGE',
};


// ═══════════════════════════════════════════════════════════════════════════════
// 3. MODULE IDENTITY
// ═══════════════════════════════════════════════════════════════════════════════

const ISSUANCE_MODULE = {
  VERSION:              '1.0',
  MODULE_ID:            'M4_ISSUANCE_AUTOSYNC',
  ROBOT_NAME:           'M4_ISSUANCE_ROBOT',
  TRIGGER_FUNC:         'trigger_IssuanceAutoSync',
  TRIGGER_HOUR:         22,     // 10 PM HCM — 30 min before M2 nightly run at 22:30
  TIMEZONE:             'Asia/Ho_Chi_Minh',
  LOG_MAX_ROWS:         50,     // Zone B: keep last 50 sync runs per dashboard tab
};


// ═══════════════════════════════════════════════════════════════════════════════
// 4. EMAIL CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const ISSUANCE_EMAIL = {
  RECIPIENTS:     'dk@isconline.vn',
  LABEL:          'ISC_Logs',
  SUBJECT_PREFIX: 'M4 Issuance AutoSync',
};


// ═══════════════════════════════════════════════════════════════════════════════
// 5. DASHBOARD UI CONFIG (mirrors ZXH SheetBuilder pattern)
// ═══════════════════════════════════════════════════════════════════════════════

const ISSUANCE_DASHBOARD_CONFIG = {
  // Zone A: Validated Sync Data (columns 1-7)
  ZONE_A_HEADERS: [
    'BOM_UPDATE', 'VPO', 'CUMULATIVE_ISSUANCE_QTY',
    'SNAPSHOT_DATE', 'SOURCE_BOM_CODE', 'MAIN_GROUP', 'RESOLUTION_METHOD'
  ],
  ZONE_A_WIDTHS: [200, 120, 150, 110, 130, 110, 130],

  // Zone B: Run History (columns 9-18, same 10-col ZXH pattern)
  ZONE_B_HEADERS: [
    'Timestamp', 'Session ID', 'Source', 'Status',
    'Staged', 'Inserted', 'Deleted', 'Reserved', 'Duration (s)', 'Error'
  ],
  ZONE_B_WIDTHS: [150, 180, 100, 120, 70, 70, 70, 70, 90, 300],

  // Layout (same row structure as ZXH Gateway)
  TITLE_ROW:          1,
  DASHBOARD_ROW:      2,
  ZONE_A_LABEL_ROW:   4,
  ZONE_A_HEADER_ROW:  5,
  ZONE_A_DATA_START:  6,
  SPACER_COL:         8,    // Narrow spacer between Zone A and Zone B
  SPACER_WIDTH:       20,
  ZONE_B_START_COL:   9,
  ZONE_B_LABEL_ROW:   4,
  ZONE_B_HEADER_ROW:  5,
  ZONE_B_DATA_START:  6,

  // Color palette (deep teal theme — distinct from ZXH indigo)
  COLORS: {
    TITLE_BG:         '#004D40',   // Deep teal
    TITLE_FG:         '#ffffff',
    DASHBOARD_BG:     '#E0F2F1',   // Light teal
    ZONE_A_LABEL_BG:  '#00695C',   // Medium teal
    ZONE_A_HEADER_BG: '#B2DFDB',
    ZONE_B_LABEL_BG:  '#4c1130',   // Dark cherry (same as ZXH for visual consistency)
    ZONE_B_HEADER_BG: '#d9d2e9',
    STATUS_OK:        '#d9ead3',
    STATUS_WARN:      '#fff2cc',
    STATUS_FAIL:      '#f4cccc'
  }
};
