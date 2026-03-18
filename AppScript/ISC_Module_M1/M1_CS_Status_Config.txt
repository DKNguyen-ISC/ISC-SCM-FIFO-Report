/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * M1_CS_Status_Config.gs
 * Central Configuration for Customer Service Status Protocol (V15.0 Enhanced UX Edition)
 * ═══════════════════════════════════════════════════════════════════════════════
 * V15.0 UPGRADES:
 * 1. DASHBOARD RELOCATION: Moved from A/B to C/D (past frozen columns).
 * 2. ZONE C VALIDATION: Added DELTA_CHECK column for override sanity checks.
 * 3. ENHANCED COLORS: Added DELTA_WARNING (>20%) and DELTA_CAUTION (>10%) highlights.
 * 4. PRESERVED: All V14.0 granular audit, ID verification, pillar styling.
 * 
 * @version 15.0 (Enhanced UX Edition)
 * @author CS_SYNC_AGENT
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const M1_CS_MONITOR_CONFIG = {
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. DATA SOURCE CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════
  READ_MODE: 'DIRECT',
  
  CS_SHEETS: {
    CS_2025: {
      URL: 'https://docs.google.com/spreadsheets/d/1BRBEpnfZ721Wf181YJlIvI9WrXFcKV_WvWaOShoTyg4/edit',
      TAB_NAME: '1. Master file - General',
      IS_LEGACY: true,
      HEADER_ROW: 6,
      DATA_START_ROW: 10
    },
    CS_2026: {
      URL: 'https://docs.google.com/spreadsheets/d/1TgTTIRW2fN2UKMEqxQH9xRuMxX38Luj4oFJFFWTr8wQ/edit',
      TAB_NAME: '1. Master file - General',
      IS_LEGACY: false,
      HEADER_ROW: 5,
      DATA_START_ROW: 8
    }
  },
  
  ACTIVE_CS_SHEETS: ['CS_2026'],
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 2. BIGQUERY CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════
  BQ_CONFIG: {
    ALERT_LOG_TABLE: 'CS_Status_Discrepancy_Log',
    RESOLUTION_STAGING_TABLE: 'CS_Resolution_Staging', 
    SP_RESOLUTION: 'SP_CS_RESOLUTION',
    SYSTEM_ORDER_TABLE: 'Production_Order'
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. THE "POLYGLOT" HEADER MAP
  // ═══════════════════════════════════════════════════════════════════════════
  HEADER_ALIASES: {
    VPO:           ['vPO', 'VPO No', 'Mã đơn hàng'],
    ID_REF:        ['ID #', 'ID#', 'Production Order ID', 'Mã ID'],
    STATUS:        ['Status', 'Trạng thái', 'Current State'],
    ORDER_QTY:     ['Order Qty (grs)', 'Số lượng', 'Qty', 'Order Qty', 'Sl đặt'],
    ACTUAL_QTY:    ['Actual Qty', 'Sl thực tế', 'Actual Quantity'],
    CONFIRMED_FFD: ['Confirmed FFD', 'Req. FFD', 'Chốt FFD'] 
  },
  
  LEGACY_FILTER: {
    TERMINAL_STATUSES: ['S', 'CL', 'D', 'COMPLETED', 'CANCELLED'],
    LOOKBACK_DAYS: 90
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 4. DASHBOARD CONFIGURATION (V15.0 - MOVED TO C/D)
  // ═══════════════════════════════════════════════════════════════════════════
  DASHBOARD_CONFIG: {
    // Summary Header Area (Rows 1-4, before data headers)
    HEADER_ROW: 5,        // Row where column headers appear
    DATA_START_ROW: 6,    // Row where data starts
    
    // V15.0: Metadata Cells MOVED to Columns C/D (Past Frozen Zone)
    CELLS: {
      TITLE:         'C1',   // Title spans C1 (will merge C1:F1)
      REFRESH_LABEL: 'C2',   // "Last Refresh:" label
      LAST_REFRESH:  'D2',   // Timestamp value (OVERFLOW enabled)
      ALERTS_LABEL:  'C3',   // "Active Alerts:" label
      TOTAL_ALERTS:  'D3',   // Count value
      SUMMARY_LABEL: 'C4',   // "Summary:" label
      SUMMARY_VALUE: 'D4'    // Breakdown text
    },
    
    // Summary Labels
    LABELS: {
      TITLE: '🔍 M1 CS Status Monitor',
      REFRESH_LABEL: 'Last Refresh:',
      ALERTS_LABEL: 'Active Alerts:',
      SUMMARY_PREFIX: 'Summary:'
    },
    
    // Dashboard Background Range (V15.0 - adjusted for new position)
    DASHBOARD_RANGE: 'C1:H4'
  },
  
  MONITOR_SHEET_NAME: 'M1_CS_Monitor',
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 5. ZONE DEFINITIONS (V15.0 - Added Zone C)
  // ═══════════════════════════════════════════════════════════════════════════
  
  // ZONE A: System Data (Read-Only)
  ZONE_A_HEADERS: [
    'VPO', 
    'PRODUCTION_ORDER_ID',   // ⭐ SYSTEM TRUTH
    'SYS_DATA_STATE',        
    'SYS_COMPLETION_QTY',    // Context Only
    'SYS_ORDER_QTY',         // ⭐ SYSTEM QTY (Total)
    'SYS_REQ_FFD',           // ⭐ SYSTEM DATE
    'CS_STATUS',             
    'CS_ACTUAL_QTY',         // Context Only
    'CS_ORDER_QTY',          // ⭐ CS ROW QTY (Split)
    'CS_CONFIRMED_FFD',      // ⭐ CS ROW DATE
    'CS_ID_REF',             // ⭐ CS TRUTH
    'ALERT_TYPE',
    'CLASSIFICATION',
    'IS_MULTI_ORDER',
    'DAYS_UNRESOLVED',
    'ESCALATION_LEVEL'
  ],
  
  // PILLARS: Visual Separators (Black with White text for visibility)
  PILLARS: {
    RAW_START: {
      header: 'RAW_START',
      width: 25,
      bgColor: '#000000',
      textColor: '#ffffff'
    },
    RAW_END: {
      header: 'RAW_END',
      width: 25,
      bgColor: '#000000',
      textColor: '#ffffff'
    }
  },
  
  // ZONE B: User Action (Write-Enabled)
  ZONE_B_HEADERS: [
    'ACCEPT_CS',
    'OVERRIDE_QTY',
    'OVERRIDE_DATE',
    'RESOLUTION_NOTE',
    'RESOLUTION_STATUS'
  ],

  // ZONE C: Validation/Calculation (V15.0 NEW)
  ZONE_C_HEADERS: [
    'DELTA_CHECK'   // Calculated: OVERRIDE_QTY - CS_ORDER_QTY (shows sanity check)
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. DATE FORMAT CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════
  DATE_FORMAT: {
    DISPLAY: 'dd-MMM-yyyy',    // e.g., 07-Nov-2025
    STORAGE: 'yyyy-MM-dd',     // For BigQuery/SQL
    TIMEZONE: 'Asia/Ho_Chi_Minh'
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. HEADER CONTEXT NOTES (Tooltips)
  // ═══════════════════════════════════════════════════════════════════════════
  HEADER_NOTES: {
    'VPO': 'Vendor Production Order.\nThe unique key linking CS and System.',
    'PRODUCTION_ORDER_ID': 'The specific System ID (Primary).\nShould match CS_ID_REF.',
    'SYS_DATA_STATE': 'System Lifecycle State:\n• RELEASED: Active\n• PARTIALLY_RELEASED: Partially Shipped\n• PROCESSING: In Progress\n• COMPLETED: Closed\n• CANCELLED: Dropped',
    'SYS_COMPLETION_QTY': 'Total physical quantity in System.\n📊 Context Only.',
    'SYS_ORDER_QTY': '⭐ Total Order Quantity in System.\nNote: This is the VPO Total.',
    'SYS_REQ_FFD': '⭐ System Requested Factory Finished Date.',
    'CS_STATUS': 'Status from CS Sheet:\n• C/W/P: Processing\n• S/Shipped: Completed\n• D/Cancelled: Dropped',
    'CS_ACTUAL_QTY': 'The "Good Quantity" reported by CS.\n📊 Context Only.',
    'CS_ORDER_QTY': '⭐ The Order Quantity for THIS specific split line.',
    'CS_CONFIRMED_FFD': '⭐ Date confirmed by CS/Factory for THIS split.',
    'CS_ID_REF': '⭐ Specific Reference ID in CS Sheet.\nCompared against PRODUCTION_ORDER_ID for audit.',
    'ALERT_TYPE': 'Verdict:\n• ID_MISMATCH: System ID != CS ID\n• DATA_MISMATCH: Qty/Date differs\n• ZOMBIE: CS Complete, Sys Open\n• DROP: CS Cancelled, Sys Open\n• MULTI_ORDER: Split Batch Risk',
    'CLASSIFICATION': 'Urgency:\n• SAFETY_FLAG: Split Batch/ID Risk\n• ORDER_SPEC: Spec Mismatch\n• STATE_MISMATCH: Status differs\n• BUSINESS_INTEL: Yield/Timing warning\n• GOVERNANCE: Data integrity issue',
    'IS_MULTI_ORDER': 'TRUE if System has >1 Order OR CS has >1 Row for this VPO.\n⚠️ Qty overrides are BLOCKED for safety.',
    'DAYS_UNRESOLVED': 'Alert Age (days).',
    'ESCALATION_LEVEL': 'Escalation tier (0=Standard, 1=Hypercare, 2=Governance)',
    'RAW_START': '║ Visual Separator',
    'RAW_END': '║ Visual Separator',
    'ACCEPT_CS': 'Check to accept CS values and submit resolution.\n⚠️ BLOCKED for Multi-Order VPOs.',
    'OVERRIDE_QTY': 'Force new Order Quantity.\n⚠️ BLOCKED for Multi-Order VPOs.',
    'OVERRIDE_DATE': 'Force new FFD Date.',
    'RESOLUTION_NOTE': 'Optional comment.',
    'RESOLUTION_STATUS': 'Commit Status.',
    'DELTA_CHECK': '📊 Sanity Check (V15.0):\nShows Override - CS Qty.\n🔴 RED: >20% difference (fat-finger warning)\n🟡 YELLOW: >10% difference (caution)'
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 8. COLOR CONFIGURATION (V15.0 - Added Delta Colors)
  // ═══════════════════════════════════════════════════════════════════════════
  COLORS: {
    // Zone Headers
    ZONE_A_HEADER:    '#b6d7a8',  // Green
    ZONE_B_HEADER:    '#9fc5e8',  // Blue
    ZONE_C_HEADER:    '#d9d2e9',  // Purple (V15.0 NEW)
    PILLAR:           '#000000',
    
    // Zebra Pattern (Explicit white-first for VPO grouping)
    ZEBRA_WHITE:      '#ffffff',
    ZEBRA_GREY:       '#f3f3f3',
    
    // Alert Escalation
    ALERT_STANDARD:   '#fff3e0',
    ALERT_HYPERCARE:  '#ffe0b2',
    ALERT_GOVERNANCE: '#ffcdd2',
    RESOLVED:         '#e0e0e0',
    
    // Classification Highlights
    MULTI_ORDER:      '#ffe0e0',
    SAFETY_FLAG:      '#ffccbc',
    
    // Cell-Level Mismatch Highlights
    CELL_MISMATCH: {
      QTY:            '#ef9a9a',   // Red-ish for ORDER quantity mismatch
      DATE:           '#ffcc80',   // Orange for date mismatch
      COMPLETED:      '#ce93d8',   // Purple for ZOMBIE/COMPLETED rows
      LOW_YIELD:      '#ffab91',   // Salmon for LOW_YIELD / Multi-Order context
      ID_MISMATCH:    '#ff8a80'    // Deep Salmon for ID Mismatch (Audit)
    },
    
    // V15.0: Delta Check Colors (Zone C)
    DELTA: {
      WARNING:        '#f44336',   // RED - >20% difference (fat-finger)
      CAUTION:        '#ffeb3b',   // YELLOW - >10% difference
      OK:             '#c8e6c9'    // GREEN - reasonable change
    },
    
    // Dashboard Header
    DASHBOARD_BG:     '#e8f5e9',
    DASHBOARD_TITLE:  '#1b5e20',
    
    // Disabled/Locked
    DISABLED_CELL:    '#d0d0d0'
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 9. ZEBRA CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════
  ZEBRA_CONFIG: {
    FIRST_ROW_WHITE: true,    // Ensures first VPO group is white
    APPLY_TO_ZONE_A: true,
    APPLY_TO_ZONE_B: true,
    APPLY_TO_ZONE_C: true     // V15.0: Include Zone C in zebra
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 10. DETECTION THRESHOLDS (V15.0 - Added Delta Thresholds)
  // ═══════════════════════════════════════════════════════════════════════════
  THRESHOLDS: {
    QTY_TOLERANCE: 0.01,              // Tolerance for quantity comparison
    DATE_TOLERANCE_DAYS: 0,           // Tolerance for date comparison (0 = exact match required)
    STALE_QTY_THRESHOLD: 0.90,        // Yield ratio threshold for LOW_YIELD
    COMPLETION_THRESHOLD: 0.99,       // Threshold for considering order complete
    
    // V15.0: Delta Check Thresholds
    DELTA_WARNING_PCT: 0.20,          // 20% difference = RED (fat-finger warning)
    DELTA_CAUTION_PCT: 0.10           // 10% difference = YELLOW (caution)
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 11. ALERT CLASSIFICATIONS (V14.0 Granular Edition)
  // ═══════════════════════════════════════════════════════════════════════════
  ALERT_CLASSIFICATIONS: {
    STATE_MISMATCH: {
      types: ['ZOMBIE', 'DROP'],
      allowQtyOverride: false,
      allowDateOverride: false,
      allowAcceptCS: false,           // V15.0: Explicit accept control
      description: 'Status differs between CS and System'
    },
    ORDER_SPEC: {
      types: ['DATA_MISMATCH', 'ID_MISMATCH'],
      allowQtyOverride: true,
      allowDateOverride: true,
      allowAcceptCS: true,
      description: 'Order specifications differ (Qty, Date, or ID)'
    },
    BUSINESS_INTEL: {
      types: ['STALE_QTY', 'LOW_YIELD', 'TIMING_RISK'],
      allowQtyOverride: false,
      allowDateOverride: false,
      allowAcceptCS: false,
      description: 'Under-delivery or timing warning'
    },
    GOVERNANCE: {
      types: ['GHOST_COMPLETION'],
      allowQtyOverride: false,
      allowDateOverride: false,
      allowAcceptCS: false,
      description: 'Critical data integrity issue'
    },
    SAFETY_FLAG: {
      types: ['MULTI_ORDER', 'VERSION_CONFLICT', 'VERSION_ROLLBACK'], // V15.1
      allowQtyOverride: false,
      allowDateOverride: true,
      allowAcceptCS: false,           // Default safety. VERSION_CONFLICT overrides this in logic.
      description: 'Split batch or Complex VPO - manual review required'
    }
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 12. SYSTEM IDENTIFIERS & ESCALATION
  // ═══════════════════════════════════════════════════════════════════════════
  MODULE_ID: 'ISC_M1_CS_SYNC_AGENT',
  BATCH_PREFIX: 'CSA_',
  LOG_SOURCE: 'CS_SYNC_AGENT',     
  
  ESCALATION: {
    PLANNER_EMAIL:       'phuongbui@isconline.vn',
    DEVELOPER_EMAIL:     'dk@isconline.vn',
    SC_MANAGER_EMAIL:    'honam@isconline.vn',
    CS_SUPERVISOR_EMAIL: 'kate@isconline.vn',
    
    HYPERCARE_THRESHOLD: 3,
    GOVERNANCE_THRESHOLD: 5
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 13. REPORTING
  // ═══════════════════════════════════════════════════════════════════════════
  REPORTING: {
    EMAIL_PREFIX: '[ISC CS Monitor]',
    EMAIL_LABEL: 'ISC_CS_Alerts',
    THREAD_MODE: 'MONTHLY',
    INCLUDE_DEVELOPER_CLUES: true         
  }
};

/**
 * SECURITY: CENTRALIZED VALID USERS
 */
function getCentralizedValidUsers() {
  return {
    'dk@isconline.vn':           { name: 'Khánh', role: 'ADMIN' },
    'phuongbui@isconline.vn':    { name: 'Phương', role: 'PLANNER' },
    'honam@isconline.vn':        { name: 'Nam', role: 'MANAGER' },
    'kate@isconline.vn':         { name: 'Kate', role: 'CS_SUPERVISOR' },
    'levietthang@isconline.vn':  { name: 'Thắng', role: 'PLANNER' },
    'buithinga@isconline.vn':    { name: 'Nga', role: 'PLANNER' },
    'ngan@isconline.vn':         { name: 'Ngàn', role: 'PLANNER' },
    'phong.mai@isconline.vn':    { name: 'Phong', role: 'PLANNER' }
  };
}

/**
 * Main Config Getter
 * Returns the complete configuration object with valid users merged in.
 */
function getM1CSMonitorConfig() {
  const config = { ...M1_CS_MONITOR_CONFIG };
  config.VALID_USERS = getCentralizedValidUsers();
  return config;
}
