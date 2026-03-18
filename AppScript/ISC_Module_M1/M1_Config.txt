/**
 * ⚙️ M1 LOCAL CONFIGURATION (Manifest)
 * Defines the Input Sheets for Module 1.
 * * STRATEGY: 
 * - INPUT_SHEETS: Defines which sheets to build.
 * - SHEET_BLUEPRINTS: Defines the specific "Zone B" (Raw) layout and "Zone A" (Logic) formulas.
 * * ✅ VERSION 5.2 - FLIGHT RECORDER EDITION (Schema-Aligned SQL)
 * - Smart Sanitizers (No more infinite 0s)
 * - Buffer Row Guards (No formulas in Row 2)
 * - Full Traffic Light Support
 * - 🆕 PUSH_NOTIFICATIONS: Flight Recorder for Admin Monitoring
 * - 🛡️ SQL Templates aligned with actual BigQuery schemas
 */
const M1_MANIFEST = {
  INPUT_SHEETS: [
    // 1. The Header Input
    'Production_Order_Draft',
    
    // 2. The Line Item Input
    'BOM_Order_List_Draft',
    
    // 3. The New Item Fixer
    'BOM_Data_Staging'
  ],

  /**
   * 🏗️ SHEET BLUEPRINTS
   * Defines the specific "Architecture" for complex sheets.
   * Used by M1_SheetBuilder to inject formulas and map headers.
   */
  SHEET_BLUEPRINTS: {
    
    // =========================================================================
    // 📄 1. HEADER INPUT (Production Orders)
    // =========================================================================
    'Production_Order_Draft': {
      
      // 🔵 ZONE B: THE RAW INPUT
      // Precise mapping based on Excel extraction
      RAW_HEADERS: [
        "Ngày nhận đơn hàng",        // V
        "工作令OrderNumber",         // W  (Key)
        "序号Line",                  // X  (Key)
        "客户Customer",              // Y
        "产品号ProductNumber",       // Z
        "物料号Product110",          // AA
        "产品名称ProductName",       // AB
        "需求数Quantity",            // AC
        "单位Unit",                  // AD
        "销售数量SalesQuantity",     // AE
        "要求完工日期FFD",           // AF
        "备注Remarks",               // AG
        "审核状态Status",            // AH
        "PI",                        // AI
        "客户订单号CustomerOrder",   // AJ
        "DATA_STATE",                // AK (System Status)
        "COMPLETION_QTY",            // AL (Calculated)
        "COMPLETION_PERCENT",        // AM (Calculated)
        "COUNTRY",                   // AN (Calculated)
        "OVERRIDE_ID"                // AO (Planner Selection — V16 NEW)
      ],

      // 🟡 ZONE B FORMULAS (Smart Inputs)
      // 🛡️ FIX: Added IF(ROW()=2, "", ...) to keep the buffer row clean.
      ZONE_B_FORMULAS: {
        "COMPLETION_QTY":     "=MAP($W$2:$W,$X$2:$X,LAMBDA(w_val,x_val,IF(w_val=\"\",\"\",SUMIF('PRODUCTION PLAN'!$B:$B,MID(w_val,1,8)&x_val,'PRODUCTION PLAN'!$M:$M))))",
        "COMPLETION_PERCENT": "=ARRAYFORMULA(IF(ROW(AC2:AC)=2,\"\",IF(AC2:AC=\"\",,IFERROR(AL2:AL/AC2:AC,0))))",
        "COUNTRY":            "=ARRAYFORMULA(IF(ROW($W$2:$W)=2,\"\",IF(LEN($W2:$W)=0,\"\",XLOOKUP(MID($W2:$W,1,8)&$X2:$X,'ID DATA'!$C:$C,'ID DATA'!$J:$J,,,1))))"
      },

      // 🎨 CONDITIONAL FORMATTING (Traffic Lights)
      CONDITIONAL_FORMATTING: [
        { header: "COMPLETION_QTY", type: 'NUMBER_LESS_THAN', value: 0 },
        { header: "COMPLETION_QTY", type: 'CUSTOM_FORMULA', value: '=AL3>AC3' }, // Red if Complete > Order
        { header: "COMPLETION_QTY", type: 'NOT_NUMBER' }
      ],

      // 🟢 ZONE A: DYNAMIC LOGIC MAP
      FORMULA_MAP: {
        // --- IDENTITY ---
        "PRODUCTION_ORDER_ID": "SMART_ID_RESOLVE",
        "CUSTOMER": "客户Customer",
        "VPO": "VPO_CALC",
        "PO": "工作令OrderNumber",
        "PO_LINE": "序号Line",
        
        // --- SKU ---
        "SKU_NAME_VERSION": "产品名称ProductName",
        "SKU_CODE": "物料号Product110",
        "SKU_DESCRIPTION": "产品号ProductNumber",
        "SKU_UNIT": "单位Unit",
        
        // --- QUANTITY & DATES ---
        "RECEIVED_VPO_DATE": "Ngày nhận đơn hàng",
        "FINISHED_GOODS_ORDER_QTY": "需求数Quantity",
        "REQUEST_FACTORY_FINISHED_DATE": "FFD_CONDITIONAL_CALC", // Checks Final_FFD vs FFD
        
        // --- LINKED DATES (Zone C) ---
        "EX_FACTORY_DATE": "Exfact date (link)",
        "EXPECTED_TIME_OF_DEPARTURE": "ETD (link)",
        "WORK_IN_PROCESS_START_DATE": "Start date WIP",
        "PACKAGE_START_DATE": "Start date package",
        "FINISHED_DATE": "End date",
        
        // --- STATUS & COMPLETION ---
        "DATA_STATE": "DATA_STATE",
        
        // 🛡️ FIX: Smart Sanitizer
        // If Order (W) is empty, stay blank. If Order exists but Qty (AL) is empty, 0.
        "COMPLETION_QTY": "=ARRAYFORMULA(IF(ROW(AL2:AL)=2,\"\",IF(W2:W=\"\",\"\",IF(AL2:AL=\"\",0,IF(ISNUMBER(AL2:AL),AL2:AL,0)))))",
        
        "COMPLETION_PERCENT": "COMPLETION_PERCENT",
        "COUNTRY": "COUNTRY"
      },

      // 🟠 ZONE C: HELPER TOOLKIT
      ZONE_C_DEFINITIONS: [
        // V16 UPGRADE: Exfact, ETD, Confirmed_FFD now cascade through $A (PRODUCTION_ORDER_ID)
        { 
          header: "Exfact date (link)", 
          formula: "=ARRAYFORMULA(IF($A2:$A=\"\",\"\",XLOOKUP($A2:$A,'ID DATA'!$A:$A,'ID DATA'!$AG:$AG,,,1)))" 
        },
        { 
          header: "ETD (link)", 
          formula: "=ARRAYFORMULA(IF($A2:$A=\"\",\"\",XLOOKUP($A2:$A,'ID DATA'!$A:$A,'ID DATA'!$AH:$AH,,,1)))" 
        },
        // PRODUCTION PLAN lookups stay VPO-based (no column shift, no cascade)
        { 
          header: "Start date WIP", 
          formula: "=ARRAYFORMULA(IF($W$2:$W<>\"\",XLOOKUP(MID($W$2:$W,1,8)&$X$2:$X,'PRODUCTION PLAN'!$B:$B,'PRODUCTION PLAN'!G:G,,,1),\"\"))" 
        },
        { 
          header: "Start date package", 
          formula: "=ARRAYFORMULA(IF($W$2:$W<>\"\",XLOOKUP(MID($W$2:$W,1,8)&$X$2:$X,'PRODUCTION PLAN'!$B:$B,'PRODUCTION PLAN'!H:H,,,1),\"\"))" 
        },
        { 
          header: "End date", 
          formula: "=ARRAYFORMULA(IF($W$2:$W<>\"\",XLOOKUP(MID($W$2:$W,1,8)&$X$2:$X,'PRODUCTION PLAN'!$B:$B,'PRODUCTION PLAN'!D:D,,,1),\"\"))" 
        },
        { 
          header: "Order status", 
          formula: "=ARRAYFORMULA(IF(AB2:AB<>\"\",\"In progress\",\"\"))" 
        },
        { 
          header: "Confirmed_FFD", 
          formula: "=ARRAYFORMULA(IF($A2:$A=\"\",\"\",XLOOKUP($A2:$A,'ID DATA'!$A:$A,'ID DATA'!$AF:$AF,,,1)))" 
        },
        // V16 NEW: Planner guidance helpers
        {
          header: "CANDIDATE_IDS",
          formula: "=MAP(C2:C,LAMBDA(vpo,IF(vpo=\"\",\"\",IFERROR(TEXTJOIN(\", \",TRUE,FILTER('ID DATA'!$A:$A,'ID DATA'!$C:$C=vpo)),\"NO MATCH\"))))"
        },
        {
          header: "ID_MATCH_COUNT",
          formula: "=ARRAYFORMULA(IF(C2:C=\"\",\"\",COUNTIF('ID DATA'!$C:$C,C2:C)))"
        }
      ]
    },

    // =========================================================================
    // 📄 2. LINE ITEM INPUT (BOM List)
    // =========================================================================
    'BOM_Order_List_Draft': {
      RAW_HEADERS: [
        "Code", "Cus 1", "Cus 2", "SKU", "SKU_Code", "Description", "SKU_Index",
        "BOM_CTX", "BOM_Type_CTX", "BOM_Des_CTX", "BOM_Viet_Des_CTX", "BOM_Unit_CTX",
        "BOM_Consumption_CTX", "BOM_Tolerance_CTX", "VPO_CTX", "BOM_UPDATE_CTX", "ORDER_LIST_NOTE_CTX"
      ],
      FORMULA_MAP: {
        "PRODUCTION_ORDER_ID": "LINKED_ORDER_ID",
        "BOM": "BOM_CTX",
        "BOM_CONSUMPTION": "BOM_Consumption_CTX",
        "BOM_TOLERANCE": "BOM_Tolerance_CTX",
        "BOM_UPDATE": "=ARRAYFORMULA(IF(ARRAYFORMULA(W2:W<>\"\"),W2:W,O2:O))",
        "ORDER_LIST_NOTE": "ORDER_LIST_NOTE_CTX",
        "FULFILLMENT_MODE": "GENERAL_STOCK"
      },
      ZONE_C_DEFINITIONS: [
        { header: "LINKED_ORDER_ID", formula: "=ArrayFormula(XLOOKUP(V2:V,'ID DATA'!C:C,'ID DATA'!A:A,,,1))" }
      ]
    },

    // =========================================================================
    // 📄 3. STAGING INPUT (Fixer)
    // =========================================================================
    'BOM_Data_Staging': {
      RAW_HEADERS: [
        "BOM_UPDATE", "BOM", "PIC", "MAIN_GROUP", "SUB_GROUP",
        "BOM_DESCRIPTION", "BOM_VIETNAMESE_DESCRIPTION", "BOM_UNIT", "BOM_STATUS",
        "SOURCE", "INGESTED_AT"
      ],
      ZONE_C_DEFINITIONS: [
        { header: "F_HELPER_1", formula: "" }, { header: "F_HELPER_2", formula: "" },
        { header: "F_HELPER_3", formula: "" }, { header: "F_HELPER_4", formula: "" },
        { header: "F_HELPER_5", formula: "" }, { header: "F_HELPER_6", formula: "" },
        { header: "F_HELPER_7", formula: "" }, { header: "F_HELPER_8", formula: "" },
        { header: "F_HELPER_9", formula: "" }, { header: "F_HELPER_10", formula: "" }
      ],
      FORMULA_MAP: {
        "BOM_UPDATE": "BOM_UPDATE", "BOM": "BOM", "PIC": "PIC", "MAIN_GROUP": "MAIN_GROUP",
        "SUB_GROUP": "SUB_GROUP", "BOM_DESCRIPTION": "BOM_DESCRIPTION",
        "BOM_VIETNAMESE_DESCRIPTION": "BOM_VIETNAMESE_DESCRIPTION", "BOM_UNIT": "BOM_UNIT",
        "BOM_STATUS": "BOM_STATUS", "SOURCE": "SOURCE", "INGESTED_AT": "INGESTED_AT"
      }
    }
  },

  // =========================================================================
  // 🆕 PUSH_NOTIFICATIONS: FLIGHT RECORDER CONFIGURATION
  // =========================================================================
  /**
   * 📧 PUSH NOTIFICATIONS (Flight Recorder)
   * Sends email reports to Admin/Developer after each Push Data action.
   * Inherited patterns from M1_PSP_AutoSync and M1_Cancel_Main.
   * 
   * FEATURES:
   * - Smart Threading: Groups emails by Month (per Sheet Type)
   * - Auto-Labeling: Applies ISC_Logs label for unified audit trail
   * - Dashboard Card UI: Visual summary of Push actions
   * - SQL Snippets: Investigator queries for BigQuery verification
   */
  PUSH_NOTIFICATIONS: {
    // Master Switch
    ENABLE_EMAILS: true,
    
    // Who receives the Push Reports? (Admin/Developer)
    RECIPIENTS: ['dk@isconline.vn'],
    
    // Email Subject Prefix (Plain Text - No Emojis for reliability)
    // Final Subject: "[ISC Push Log] Production_Order_Draft - January 2026"
    EMAIL_SUBJECT_PREFIX: '[ISC Push Log]',
    
    // Thread emails by month to keep inbox clean
    THREAD_BY_MONTH: true,
    
    // Auto-Label (Unified with M1_PSP_AutoSync and M1_Cancel_Main)
    EMAIL_LABEL: 'ISC_Logs',
    
    // Card UI Colors (Per Sheet Type)
    COLORS: {
      'Production_Order_Draft': '#34A853',  // 🟢 Green - New Orders
      'BOM_Order_List_Draft':   '#1A73E8',  // 🔵 Blue - BOM Lines
      'BOM_Data_Staging':       '#F9AB00'   // 🟡 Yellow - Master Data
    },
    
    // Sheet Type Labels (Human Readable)
    SHEET_LABELS: {
      'Production_Order_Draft': 'Production Orders',
      'BOM_Order_List_Draft':   'BOM Order Lines',
      'BOM_Data_Staging':       'Master Data (Skeletons)'
    },
    
    // =========================================================================
    // 🛡️ TOUCH LIST CONFIGURATION (Dynamic Header Lookup)
    // =========================================================================
    // Uses HEADER NAMES (not indices) for resilience to column reordering.
    // Header names must match Zone A headers exactly (from Config_Schema tempSchema).
    // =========================================================================
    TOUCH_LIST_KEYS: {
      // Production_Order_Draft: Key identifiers from Config_Schema.TABLE_SCHEMAS.Production_Order_Draft.tempSchema
      'Production_Order_Draft': [
        { header: 'PRODUCTION_ORDER_ID', label: 'Order ID' },
        { header: 'VPO', label: 'VPO' },
        { header: 'CUSTOMER', label: 'Customer' }
      ],
      // BOM_Order_List_Draft: Key identifiers from Config_Schema.TABLE_SCHEMAS.BOM_Order_List_Draft.tempSchema
      'BOM_Order_List_Draft': [
        { header: 'PRODUCTION_ORDER_ID', label: 'Order ID' },
        { header: 'BOM', label: 'BOM' }
      ],
      // BOM_Data_Staging: Key identifiers from Config_Schema.TABLE_SCHEMAS.BOM_Data_Staging.schema
      'BOM_Data_Staging': [
        { header: 'BOM_UPDATE', label: 'BOM Update' },
        { header: 'BOM', label: 'BOM' }
      ]
    },
    
    // =========================================================================
    // 🛡️ SQL QUERY TEMPLATES (Schema-Aligned)
    // =========================================================================
    // Placeholders: {PROJECT_ID}, {DATASET_ID}, {TIMESTAMP}
    // 
    // IMPORTANT: Templates must align with actual BigQuery table schemas.
    // - UPLOADED: Query to check raw/staging data (optional, can be null)
    // - PROCESSED: Query to check final/processed data
    // 
    // Reference: Config_Schema.txt for actual column names
    // =========================================================================
    SQL_TEMPLATES: {
      // -----------------------------------------------------------------------
      // Production_Order_Draft
      // -----------------------------------------------------------------------
      // NOTE: Production_Order_Draft is a TRANSIENT table (tempSchema).
      // - It has NO timestamp columns (no UPLOADED_AT, no UPDATED_AT)
      // - Data is immediately processed by SP_SPLIT_BATCH_GATE and moved to Production_Order
      // - Therefore, we skip the "Raw Upload" query and only show the destination
      // -----------------------------------------------------------------------
      'Production_Order_Draft': {
        // UPLOADED: null - Draft table is transient, no point querying it
        UPLOADED: null,
        
        // PROCESSED: Check the final destination (Production_Order has UPDATED_AT)
        PROCESSED: `SELECT PRODUCTION_ORDER_ID, VPO, CUSTOMER, DATA_STATE, COMPLETION_QTY, UPDATED_AT 
FROM \`{PROJECT_ID}.{DATASET_ID}.Production_Order\`
WHERE UPDATED_AT >= TIMESTAMP('{TIMESTAMP}')
ORDER BY UPDATED_AT DESC;`
      },
      
      // -----------------------------------------------------------------------
      // BOM_Order_List_Draft
      // -----------------------------------------------------------------------
      // Data flows: Draft -> BOM_Order_List_Staging (has UPLOADED_AT) -> Final
      // -----------------------------------------------------------------------
      'BOM_Order_List_Draft': {
        // UPLOADED: Check staging table (BOM_Order_List_Staging has UPLOADED_AT)
        UPLOADED: `SELECT STAGING_ID, PRODUCTION_ORDER_ID, BOM, BOM_UPDATE, VALIDATION_STATUS, ERROR_MESSAGE, UPLOADED_AT
FROM \`{PROJECT_ID}.{DATASET_ID}.BOM_Order_List_Staging\`
WHERE UPLOADED_AT >= TIMESTAMP('{TIMESTAMP}')
ORDER BY UPLOADED_AT DESC;`,
        
        // PROCESSED: Check for validation failures
        PROCESSED: `SELECT STAGING_ID, PRODUCTION_ORDER_ID, BOM, VALIDATION_STATUS, ERROR_MESSAGE
FROM \`{PROJECT_ID}.{DATASET_ID}.BOM_Order_List_Staging\`
WHERE UPLOADED_AT >= TIMESTAMP('{TIMESTAMP}')
  AND VALIDATION_STATUS = 'FAIL'
ORDER BY UPLOADED_AT DESC;`
      },
      
      // -----------------------------------------------------------------------
      // BOM_Data_Staging
      // -----------------------------------------------------------------------
      // Data flows: Staging (has INGESTED_AT) -> BOM_Data (has UPDATED_AT)
      // -----------------------------------------------------------------------
      'BOM_Data_Staging': {
        // UPLOADED: Check staging table (BOM_Data_Staging has INGESTED_AT)
        UPLOADED: `SELECT BOM_UPDATE, BOM, PIC, MAIN_GROUP, SUB_GROUP, SOURCE, INGESTED_AT
FROM \`{PROJECT_ID}.{DATASET_ID}.BOM_Data_Staging\`
WHERE INGESTED_AT >= TIMESTAMP('{TIMESTAMP}')
ORDER BY INGESTED_AT DESC;`,
        
        // PROCESSED: Check final master data table (BOM_Data has UPDATED_AT)
        PROCESSED: `SELECT BOM_UPDATE, BOM, PIC, MAIN_GROUP, UPDATED_BY, UPDATED_AT
FROM \`{PROJECT_ID}.{DATASET_ID}.BOM_Data\`
WHERE UPDATED_AT >= TIMESTAMP('{TIMESTAMP}')
ORDER BY UPDATED_AT DESC;`
      }
    }
  }
};

// =========================================================================
// PUBLIC ACCESSOR
// =========================================================================

function getLocalManifest() {
  return M1_MANIFEST;
}

/**
 * 🆕 Public accessor for Push Notification Config
 * Used by M1_Main.gs Flight Recorder
 */
function getPushNotificationConfig() {
  return M1_MANIFEST.PUSH_NOTIFICATIONS;
}