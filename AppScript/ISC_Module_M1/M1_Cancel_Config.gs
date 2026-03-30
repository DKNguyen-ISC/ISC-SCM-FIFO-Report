/* -------------------------------------------------------------------------
 * FILE: ISC_Module_M1/M1_Cancel_Config.gs
 * DESCRIPTION: Configuration for Order Cancellation Admin Console
 * ARCHITECTURE: Zone A (System) -> Zone B (User) -> Zone C (Feedback)
 * VERSION: 7.13 (Plain Text Email Subject + Labeling + Unicode UI)
 * ------------------------------------------------------------------------- */

const CANCEL_CONFIG = {
  
  // ═══════════════════════════════════════════════════════════════════
  // 1. CANCELLATION REASON ENUM
  // Must match SP_ADMIN_CANCEL_ORDER validation (SQL_Vault.txt)
  // ═══════════════════════════════════════════════════════════════════
  REASONS: [
    { code: 'CUSTOMER_CANCELLED',   label: 'Customer Cancelled Order' },
    { code: 'SUPPLY_ISSUE',         label: 'Cannot Procure Materials' },
    { code: 'DESIGN_CHANGE',        label: 'Product Design Changed' },
    { code: 'QUALITY_FAILURE',      label: 'Quality Issue - Cannot Recover' },
    { code: 'CAPACITY_CONSTRAINT',  label: 'Factory Capacity Issue' },
    { code: 'DUPLICATE_ORDER',      label: 'Duplicate Entry - Cleanup' },
    { code: 'OTHER',                label: 'Other (See Notes)' }
  ],
  
  // ═══════════════════════════════════════════════════════════════════
  // 2. SESSION & LAYOUT CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════
  SESSION: {
    SUFFIX: '_Cancel_Console',  // Format: "Name_Cancel_Console"
    SEARCH_CELL: 'C2',
    DATA_START_ROW: 6,
    MAX_STAGING_ROWS: 50
  },

  // 🟢 IDENTITY MAP: Inherited from M1_PSP_Config (Name -> Email)
  // Used for reverse lookup to generate consistent Session Names (e.g. "Khánh")
  PIC_EMAILS: {
    'Khánh':  'dk@isconline.vn',
    'Thắng':  'levietthang@isconline.vn',
    'Nam':    'honam@isconline.vn',
    'Nga':    'buithinga@isconline.vn',
    'Ngàn':   'ngan@isconline.vn',
    'Phương': 'phuongbui@isconline.vn',
    'Phong':  'phong.mai@isconline.vn'
  },
  
  // ═══════════════════════════════════════════════════════════════════
  // 3. COLUMN DEFINITIONS (Aligned with Config_Schema.txt Production_Order)
  // ═══════════════════════════════════════════════════════════════════
  COLUMNS: {
    // --- 🟢 ZONE A: SYSTEM DATA (Read-Only) ---
    // Strictly following Production_Order schema order
    PRODUCTION_ORDER_ID:           { col: 1,  header: 'PRODUCTION_ORDER_ID',           width: 180, zone: 'A' },
    CUSTOMER:                      { col: 2,  header: 'CUSTOMER',                      width: 120, zone: 'A' },
    VPO:                           { col: 3,  header: 'VPO',                           width: 140, zone: 'A' },
    SKU_NAME_VERSION:              { col: 4,  header: 'SKU_NAME_VERSION',              width: 200, zone: 'A' },
    
    // Dates (Formatted as 25-Apr-2026 in SheetBuilder)
    RECEIVED_VPO_DATE:             { col: 5,  header: 'RECEIVED_VPO_DATE',             width: 130, zone: 'A' },
    FINISHED_GOODS_ORDER_QTY:      { col: 6,  header: 'FINISHED_GOODS_ORDER_QTY',      width: 120, zone: 'A' },
    REQUEST_FACTORY_FINISHED_DATE: { col: 7,  header: 'REQUEST_FACTORY_FINISHED_DATE', width: 140, zone: 'A' },
    
    // State & Completion
    DATA_STATE:                    { col: 8,  header: 'DATA_STATE',                    width: 120, zone: 'A' },
    COMPLETION_QTY:                { col: 9,  header: 'COMPLETION_QTY',                width: 130, zone: 'A' },
    
    // Metadata (Human Readable)
    LAST_SYNCED:                   { col: 10, header: 'LAST_SYNCED',                   width: 150, zone: 'A' },

    // --- ⚫ PILLAR 1: SEPARATOR ---
    RAW_START:                     { col: 11, header: 'RAW_START',                     width: 30,  zone: 'PILLAR' },

    // --- 🔵 ZONE B: USER INPUT (Editable) ---
    // \u270F\uFE0F = Pencil Emoji ✏️
    FINAL_QTY:                     { col: 12, header: 'FINAL_QTY \u270F\uFE0F',        width: 100, zone: 'B' },
    REASON:                        { col: 13, header: 'REASON \u270F\uFE0F',           width: 200, zone: 'B' },

    // --- ⚫ PILLAR 2: SEPARATOR ---
    RAW_END:                       { col: 14, header: 'RAW_END',                       width: 30,  zone: 'PILLAR' },

    // --- 🟡 ZONE C: SYSTEM FEEDBACK (Status) ---
    CONSOLE_STATUS:                { col: 15, header: 'CONSOLE_STATUS',                width: 250, zone: 'C' }
  },
  
  // ═══════════════════════════════════════════════════════════════════
  // 4. VISUAL STYLING (Inherited from M3 Modules)
  // ═══════════════════════════════════════════════════════════════════
  COLORS: {
    // Zones
    ZONE_A_BG: '#b6d7a8',       // 🟢 Green (System)
    ZONE_B_BG: '#9fc5e8',       // 🔵 Blue (Input)
    ZONE_C_BG: '#ffe599',       // 🟡 Yellow (Feedback)
    PILLAR_BG: '#000000',       // ⚫ Black
    PILLAR_TEXT: '#ffffff',     // ⚪ White
    
    // Status Logic
    AMBER_WARNING: '#FFC107',
    GREEN_SUCCESS: '#4CAF50',
    RED_ERROR: '#F44336',
    GREY_LOCKED: '#F5F5F5',     // For locked inputs after cancel
    
    // Dashboard
    TITLE_BG: '#d32f2f',        // 🔴 Red for "Danger Zone"
    SEARCH_INPUT_BG: '#E3F2FD', // Light Blue
    
    // Staleness (Last Sync Time)
    STALE_FRESH: '#C8E6C9',      // Green - synced < 2 hours
    STALE_WARNING: '#FFF9C4',    // Yellow - synced 2-12 hours
    STALE_CRITICAL: '#FFCDD2'    // Red - synced > 12 hours
  },
  
  // ═══════════════════════════════════════════════════════════════════
  // 5. STALENESS THRESHOLDS (Hours)
  // ═══════════════════════════════════════════════════════════════════
  STALENESS: {
    FRESH_HOURS: 2,
    WARNING_HOURS: 12
  },
  
  // ═══════════════════════════════════════════════════════════════════
  // 6. USER MESSAGES
  // ═══════════════════════════════════════════════════════════════════
  // NOTE: Emojis here are for the *Sheet UI* (which supports Unicode).
  // The Email Subject (in Section 8) is now Plain Text for reliability.
  MESSAGES: {
    TITLE: '\uD83D\uDED1 ORDER CANCELLATION ADMIN CONSOLE',
    SEARCH_LABEL: '\uD83D\uDD0D Search by Order ID or VPO:',
    NOT_FOUND: 'No active order found matching your search.\n\nNote: COMPLETED and CANCELLED orders cannot be cancelled.',
    ALREADY_TERMINAL: 'This order is already in a terminal state',
    DUPLICATE_VPO_WARNING: '\u26A0\uFE0F WARNING: Multiple orders found for this VPO.\nAll matching orders are shown below. Review carefully.',
    MISSING_FINAL_QTY: 'Please enter FINAL_QTY for all staged orders.',
    MISSING_REASON: 'Please select a REASON for all staged orders.',
    CONFIRM_TITLE: '\u26A0\uFE0F CONFIRM CANCELLATION',
    SUCCESS_TITLE: '\u2705 CANCELLATION COMPLETE',
    CLEAR_CONFIRM: 'Clear all staged cancellations?',
    NO_STAGED: 'No orders staged for cancellation.\n\nUse the Search function to add orders.',
    CONSOLE_READY: 'Console ready. Enter Order ID or VPO and click Fetch.'
  },
  
  // ═══════════════════════════════════════════════════════════════════
  // 7. BIGQUERY INTEGRATION
  // ═══════════════════════════════════════════════════════════════════
  QUERIES: {
    // Fetch Order Data (Excludes Terminal States in Logic Layer)
    // 🟢 UPDATED: Selects specific columns and formats timestamp in SQL
    SEARCH_ORDER: `
      SELECT 
        PRODUCTION_ORDER_ID,
        CUSTOMER,
        VPO,
        SKU_NAME_VERSION,
        RECEIVED_VPO_DATE,
        FINISHED_GOODS_ORDER_QTY,
        REQUEST_FACTORY_FINISHED_DATE,
        DATA_STATE,
        COALESCE(COMPLETION_QTY, 0) AS COMPLETION_QTY,
        FORMAT_TIMESTAMP('%d-%b-%Y %H:%M', UPDATED_AT, 'Asia/Ho_Chi_Minh') AS LAST_SYNCED
      FROM \`{PROJECT_ID}.{DATASET_ID}.Production_Order\`
      WHERE VALID_TO_TS IS NULL
        AND (UPPER(TRIM(PRODUCTION_ORDER_ID)) = UPPER(TRIM('{SEARCH_TERM}')) 
             OR UPPER(TRIM(VPO)) = UPPER(TRIM('{SEARCH_TERM}')))
      ORDER BY PRODUCTION_ORDER_ID
    `,
    
    // For Reporting Menu
    RECENT_CANCELLATIONS: `
      SELECT * FROM \`{PROJECT_ID}.{DATASET_ID}.Cancelled_Orders_Alert_VIEW\`
      ORDER BY CANCELLED_AT DESC
      LIMIT 100
    `,
    
    // For Orphaned Supply Check
    ORPHANED_SUPPLY: `
      SELECT * FROM \`{PROJECT_ID}.{DATASET_ID}.Orphaned_Supply_Report_VIEW\`
    `
  },

  // ═══════════════════════════════════════════════════════════════════
  // 8. ALERT NOTIFICATIONS (Flight Recorder)
  // ═══════════════════════════════════════════════════════════════════
  NOTIFICATIONS: {
    ENABLE_EMAILS: true,
    // Who receives the "Red Alert" for cancellations?
    RECIPIENTS: ['dk@isconline.vn'], 
    // 🟢 UPDATED: Plain text only. No Emojis in Subject Line to prevent corruption.
    EMAIL_SUBJECT_PREFIX: '[ISC ALERT] Order Cancellation',
    // Thread emails by month to keep inbox clean? (true/false)
    THREAD_BY_MONTH: true,
    // 🟢 NEW: Auto-Label to group with M1_PSP Logs
    EMAIL_LABEL: 'ISC_Logs'
  }
};

// ═══════════════════════════════════════════════════════════════════
// 9. HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

/**
 * Public accessor
 */
function getCancelConfig() {
  return CANCEL_CONFIG;
}

/**
 * Generates the personalized sheet name: "Name_Cancel_Console"
 * Uses PIC_EMAILS for explicit mapping (e.g. "dk@..." -> "Khánh")
 * @param {string} userEmail - The email of the active user
 * @return {string} The formatted sheet name
 */
function generateSessionSheetName(userEmail) {
  const config = getCancelConfig();
  if (!userEmail) return `Admin${config.SESSION.SUFFIX}`;
  
  let namePart = getPicFromEmail(userEmail);
  
  if (!namePart) {
    // Fallback: Use email prefix (e.g. "ngan.nguyen")
    namePart = userEmail.split('@')[0];
    // Capitalize first letter
    namePart = namePart.charAt(0).toUpperCase() + namePart.slice(1);
  }
  
  return `${namePart}${config.SESSION.SUFFIX}`;
}

/**
 * Reverse lookup: Finds the Name (Key) associated with an Email (Value) in PIC_EMAILS
 * @param {string} email
 * @return {string|null} The Name (e.g., 'Khánh') or null if not found
 */
function getPicFromEmail(email) {
  const config = getCancelConfig();
  const map = config.PIC_EMAILS;
  
  if (!email) return null;
  const targetEmail = email.toLowerCase().trim();
  for (const [name, storedEmail] of Object.entries(map)) {
    if (storedEmail.toLowerCase().trim() === targetEmail) {
      return name;
    }
  }
  return null;
}

/**
 * Get reason code from label
 */
function getReasonCode(label) {
  const config = getCancelConfig();
  const found = config.REASONS.find(r => r.label === label);
  return found ? found.code : null;
}

/**
 * Get reason label from code
 */
function getReasonLabel(code) {
  const config = getCancelConfig();
  const found = config.REASONS.find(r => r.code === code);
  return found ? found.label : code;
}