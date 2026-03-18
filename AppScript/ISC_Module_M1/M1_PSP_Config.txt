/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🔧 M1_PSP_Config.gs
 * Configuration for the Production Status Portal (V6.1 - The "Smart Sandwich" Layout)
 * ═══════════════════════════════════════════════════════════════════════════════
 * * RESPONSIBILITIES:
 * - Defines the strict contract between the Manual Portal (Sheet) and BigQuery
 * - Controls the "Cumulative Mode" logic which is vital for Ghost Deduction
 * - Centralizes all constants for maintainability
 * - Uses GOLDEN NAMING: Column headers match VIEW columns exactly (1:1)
 * * UPDATES (V6.1):
 * - ⭐ LAYOUT: Implemented "Smart Sandwich" (Ref -> Override -> Result)
 * - ⭐ LOGIC: Added Formula definitions for Client-Side Calculation
 * - ⭐ ZONE C: Moved Helpers behind Pillars (Cols 15+)
 * * @version 6.1 Smart Sandwich
 * @revision January 2026
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const PSP_CONFIG = {
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. SESSION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════
  
  TEMPLATE_NAME: 'M1_Status_Portal_Template',
  SESSION_SUFFIX: '_Status_Portal',
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 2. DATABASE CONNECTIONS
  // ═══════════════════════════════════════════════════════════════════════════
  
  LOG_TABLE:    'Production_Status_Log',           // Staging Table
  PORTAL_VIEW:  'Production_Status_Portal_VIEW',   // Source of Truth
  GHOST_VIEW:   'Closed_Order_Ghost_VIEW',         // Helper View
  SP_NAME:      'SP_UPDATE_PRODUCTION_STATUS',     // The Logic Engine
  SP_MIGRATE:   'SP_MIGRATE_HISTORICAL_STATES',    // Migration Tool
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 3. LOGIC STRATEGY
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * CUMULATIVE_MODE: 'LIFETIME' (Default)
   * - Factory reports the TOTAL quantity ever produced.
   * - Phase 1: Direct ID updates (Simple).
   * - Phase 2: VPO updates require Ghost Deduction [New = Input - Ghost].
   */
  CUMULATIVE_MODE: 'LIFETIME',
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 4. SAFETY THRESHOLDS
  // ═══════════════════════════════════════════════════════════════════════════
  
  CAP_MULTIPLIER: 1.1,            // Reject if Input > Order Qty * 110%
  DRIFT_THRESHOLD: 0.5,           // Circuit breaker: >50% zeros
  AUTO_CLOSE_THRESHOLD: 0.99,     // Visual indicator
  OPTIMISTIC_LOCK_TOLERANCE: 0.01,
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 5. SHEET LAYOUT DEFINITIONS
  // ═══════════════════════════════════════════════════════════════════════════
  
  HEADER_ROW: 5,        
  DATA_START_ROW: 6,    
  
  CELL_PIC_NAME: 'B2',       
  CELL_TIMESTAMP: 'B3',      
  CELL_RECORD_COUNT: 'B4',   
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 6. COLUMN DEFINITIONS - GOLDEN NAMING (1:1 with VIEW)
  // ═══════════════════════════════════════════════════════════════════════════
  
  COLUMNS: {
    
    // ─────────────────────────────────────────────────────────────────────────
    // 🔒 ZONE A: READ-ONLY (The Context + The Result)
    // ─────────────────────────────────────────────────────────────────────────
    
    ZONE_A: {
      PRODUCTION_ORDER_ID: { col: 1,  header: 'PRODUCTION_ORDER_ID', width: 130, bgColor: '#E8E8E8', note: 'System ID - Do not modify' },
      VPO:                 { col: 2,  header: 'VPO',                 width: 140, bgColor: '#D9EAD3' },
      CUSTOMER:            { col: 3,  header: 'CUSTOMER',            width: 110, bgColor: '#D9EAD3' },
      SKU_NAME_VERSION:    { col: 4,  header: 'SKU_NAME_VERSION',    width: 300, bgColor: '#D9EAD3' },
      
      // ⭐ STRICT ALIGNMENT: Full Name
      FINISHED_GOODS_ORDER_QTY: { col: 5,  header: 'FINISHED_GOODS_ORDER_QTY', width: 90,  format: '#,##0', bgColor: '#D9EAD3' },
      
      CURRENT_COMPLETION_QTY:   { col: 6, header: 'CURRENT_COMPLETION_QTY',    width: 120, format: '#,##0', bgColor: '#D9EAD3' },
      CURRENT_PERCENT:          { col: 7,  header: 'CURRENT_PERCENT',          width: 90,  format: '0.0%', bgColor: '#D9EAD3' },
      FFD:                      { col: 8,  header: 'FFD',                      width: 100, format: 'yyyy-MM-dd', bgColor: '#D9EAD3', note: 'Factory Finished Date' },
      
      // ⭐ STRICT ALIGNMENT: Mapped to GHOST_CONTEXT
      GHOST_CONTEXT:            { col: 9,  header: 'GHOST_CONTEXT (Ref)',      width: 120, format: '#,##0', bgColor: '#FFF2CC', note: 'Previously Closed Qty (Ghost)' },
      
      STATUS_NOTE:              { col: 10, header: 'STATUS_NOTE',              width: 180, bgColor: '#FFF2CC' },

      // ⭐ THE RESULT (Moved to Zone A because it is System-Calculated/Locked)
      // Logic: =IF(Override<>"", Override, Ref)
      NEW_CUMULATIVE_QTY: { 
        col: 11, 
        header: 'NEW_CUMULATIVE_QTY',    
        width: 150, 
        format: '#,##0', 
        bgColor: '#E8E8E8', // Grey to indicate "Calculated/Locked"
        fontWeight: 'bold',
        note: 'FINAL VALUE: Calculated from Plan or Override.'
      }
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // 🏛️ PILLARS (The Structure)
    // ─────────────────────────────────────────────────────────────────────────
    
    PILLARS: {
      RAW_START: { 
        col: 12, 
        header: 'RAW_START', 
        width: 30, 
        bgColor: '#000000',     
        textColor: '#FFFFFF',
        hidden: false 
      },
      
      RAW_END: { 
        col: 14, 
        header: 'RAW_END', 
        width: 30, 
        bgColor: '#000000', 
        textColor: '#FFFFFF',
        hidden: false 
      }
    },
    
    // ─────────────────────────────────────────────────────────────────────────
    // ✏️ ZONE B: EDITABLE (The Override)
    // ─────────────────────────────────────────────────────────────────────────
    ZONE_B: {
      OVERRIDE_CUMULATIVE_QTY: { 
        col: 13, 
        header: 'OVERRIDE_CUMULATIVE_QTY',    
        width: 150, 
        format: '#,##0', 
        bgColor: '#C9DAF8', // Blue = Editable  
        fontWeight: 'bold',
        note: 'Only type here if you disagree with the Plan Ref.'
      }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // 🔒 ZONE C: HELPERS (Behind the Pillars)
    // ─────────────────────────────────────────────────────────────────────────
    ZONE_C: {
      // ⭐ THE SUGGESTION (Fetched via Formula)
      REF_CUMULATIVE_QTY: { 
        col: 15, 
        header: 'REF_CUMULATIVE_QTY', 
        width: 120, 
        format: '#,##0', 
        bgColor: '#EFEFEF', 
        note: 'System Suggestion from Plan' 
      },

      // DEBUG COLUMN (Hidden)
      DATA_STATE: { 
        col: 16, 
        header: 'DATA_STATE',          
        width: 100, 
        bgColor: '#EFEFEF', 
        hidden: true 
      } 
    }
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 7. FORMULA DEFINITIONS (The Brain)
  // ═══════════════════════════════════════════════════════════════════════════
  
  LOGIC_FORMULAS: {
    // 1. SUGGESTION: Look up VPO in 'PRODUCTION PLAN' Tab
    // Maps VPO (Col 2) -> Plan Sheet
    // Formula: =MAP(B6:B, LAMBDA(vpo, IF(vpo="", "", SUMIF('PRODUCTION PLAN'!$B:$B, vpo, 'PRODUCTION PLAN'!$M:$M))))
    REF_GENERATOR: (vpoRange) => 
      `=MAP(${vpoRange}, LAMBDA(vpo, IF(vpo="", "", SUMIF('PRODUCTION PLAN'!$B:$B, vpo, 'PRODUCTION PLAN'!$M:$M))))`,
    
    // 2. RESULT: Priority Logic
    // Logic: If Override exists, use it. Else use Ref.
    // Formula: =MAP(O6:O, M6:M, LAMBDA(ref, over, IF(over<>"", over, ref)))
    RESULT_GENERATOR: (refRange, overrideRange) => 
      `=MAP(${refRange}, ${overrideRange}, LAMBDA(ref, over, IF(over<>"", over, ref)))`
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 8. AUTHORIZATION & SECURITY
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * VALID_PICS: Whitelist of authorized PIC names for Session Tabs.
   */
  VALID_PICS: ['Nga', 'Ngàn', 'Thắng', 'Phong', 'Phương', 'Khánh', 'Nam'],

  /**
   * PIC_EMAILS: Maps Session Name -> Database Identity.
   * Used for "Targeted Triggering" (Only flush my own data).
   */
  PIC_EMAILS: {
    'Khánh':  'dk@isconline.vn',
    'Thắng':  'levietthang@isconline.vn',
    'Nam':    'honam@isconline.vn',
    'Nga':    'buithinga@isconline.vn',
    'Ngàn':   'ngan@isconline.vn',
    'Phương': 'phuongbui@isconline.vn',
    'Phong':  'phong.mai@isconline.vn'
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 9. UI/UX CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════
  
  COLORS: {
    ERROR_RED: '#EA4335',       // > 110%
    WARNING_YELLOW: '#FBBC04',  // < Current
    SUCCESS_GREEN: '#34A853',   // Valid
    NEAR_COMPLETE: '#B7E1CD',   // > 90%
    
    ZONE_A_HEADER: '#E8E8E8', 
    ZONE_A_DATA: '#D9EAD3',     
    ZONE_B_HEADER: '#4285F4',   
    ZONE_B_DATA: '#C9DAF8',     
    
    TAB_COLOR: '#4285F4'
  },
  
  MESSAGES: {
    LOADING: '📡 Fetching active orders from BigQuery...',
    PROCESSING: '⚙️ Processing updates (Ghost Deduction, FIFO)...',
    UPLOADING: '💾 Uploading updates to staging table...',
    REFRESHING: '🔄 Refreshing portal data...',
    SUCCESS: '✅ Portal loaded successfully.',
    COMMIT_SUCCESS: '✅ Updates committed successfully!',
    TRIGGER_SUCCESS: '✅ Data Processed. Production Status Updated.',
    NO_DATA: 'ℹ️ No active orders found in the system.',
    NO_UPDATES: 'ℹ️ No new quantities found in the Blue column.',
    AUTH_DENIED: '❌ Access Denied: You are not authorized to use this portal.',
    TEMPLATE_MISSING: '❌ Critical: Master Template not found.',
    WRONG_SHEET: '⚠️ Please run this command from your "_Status_Portal" session sheet.',
    SYSTEM_BUSY: '⚠️ System is busy. Another update is processing.',
    SESSION_CREATED: '✅ Session created. Loading production orders...'
  },
  
  DEBUG_MODE: false,
  SHOW_DEBUG_ALERTS: false
};

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC ACCESSOR FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function getPSPConfig() {
  return PSP_CONFIG;
}

function validatePIC(inputPic) {
  if (!inputPic || typeof inputPic !== 'string') {
    return { isValid: false, matchedPic: null };
  }
  
  const trimmedInput = inputPic.trim();
  const matchedPic = PSP_CONFIG.VALID_PICS.find(
    pic => pic.toLowerCase() === trimmedInput.toLowerCase()
  );
  
  return {
    isValid: !!matchedPic,
    matchedPic: matchedPic || null
  };
}

function getSessionSheetName(picName) {
  return `${picName}${PSP_CONFIG.SESSION_SUFFIX}`;
}

function getColumnLetter(colIndex) {
  let temp, letter = '';
  while (colIndex > 0) {
    temp = (colIndex - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    colIndex = Math.floor((colIndex - temp - 1) / 26);
  }
  return letter;
}

function getTotalColumnCount() {
  const allCols = { 
    ...PSP_CONFIG.COLUMNS.ZONE_A, 
    ...PSP_CONFIG.COLUMNS.ZONE_B,
    ...PSP_CONFIG.COLUMNS.PILLARS,
    ...PSP_CONFIG.COLUMNS.ZONE_C
  };
  return Math.max(...Object.values(allCols).map(c => c.col));
}

function getLastEditableColumn() {
  return Math.max(...Object.values(PSP_CONFIG.COLUMNS.ZONE_B).map(c => c.col));
}

function getZoneAHeaders() {
  return Object.values(PSP_CONFIG.COLUMNS.ZONE_A)
    .sort((a, b) => a.col - b.col)
    .map(c => c.header);
}

function getHeaderMap(headerRow) {
  const map = new Map();
  headerRow.forEach((name, idx) => {
    if (name && name !== '') {
      map.set(name, idx);
    }
  });
  return map;
}