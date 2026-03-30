/**
 * 📖 CONFIG SCHEMA (v3.0 - STRICT TYPING EDITION)
 * The Single Source of Truth for Table Names, Field Types, and Sheet Layouts.
 * Ref: ERD Module 1, 2, 3, 4 (Strict Date/Timestamp Protocol).
 */
const SCHEMA_DEFINITIONS = {
  
  // =========================================================
  // 1. TABLE ID DICTIONARY
  // Rule: Key === BQ Table Name === ERD Entity Name
  // =========================================================
  TABLE_IDS: {
    // --- 📘 MODULE 1: PLANNING ---
    BOM_Data:               'BOM_Data',
    BOM_Data_Staging:       'BOM_Data_Staging',   
    Production_Order:       'Production_Order',
    Production_Order_Draft: 'Production_Order_Draft',
    BOM_Order_List_Draft:   'BOM_Order_List_Draft',
    BOM_Order_List_Staging: 'BOM_Order_List_Staging',
    BOM_Order_List_Final:   'BOM_Order_List_Final',
    Material_Demand_VIEW:   'Material_Demand_VIEW',
    Production_Status_Log:  'Production_Status_Log',
    CS_Status_Discrepancy_Log: 'CS_Status_Discrepancy_Log',

    // --- ⚖️ MODULE 2: BALANCING ---
    Stock_Data:             'Stock_Data',
    Pegging_Allocations:    'Pegging_Allocations',
    PR_Draft:               'PR_Draft',
    Unified_Supply_Stack_VIEW: 'Unified_Supply_Stack_VIEW',

    // --- 🧑‍💼 MODULE 3: PROCUREMENT ---
    Supplier_Information:         'Supplier_Information',
    Supplier_Information_Staging: 'Supplier_Information_Staging',
    Supplier_Capacity:            'Supplier_Capacity',
    Supplier_Capacity_Staging:    'Supplier_Capacity_Staging',
    // Assign_Sourcing:              'Assign_Sourcing',
    PR_Staging:                   'PR_Staging',
    PR_Final:                     'PR_Final',
    PO_Consolidation_Event:       'PO_Consolidation_Event',
    PR_PO_Consolidation:          'PR_PO_Consolidation',
    PO_Header:                    'PO_Header',
    PO_Line:                      'PO_Line',

    // --- 🚚 MODULE 4: EXECUTION ---
    Stock_Count_Upload:     'Stock_Count_Upload',
    Stock_Count_Staging:    'Stock_Count_Staging',
    // Stock_Data is shared with M2
    PO_Line_Tracking:       'PO_Line_Tracking',
    Inventory_Variance_Log: 'Inventory_Variance_Log',
    UI_Supplier_Portal:     'UI_Supplier_Portal',
    Supplier_Feedback_Log:  'Supplier_Feedback_Log',

    // --- 🏭 DIRECT INJECTION MODULE (NEW) ---
    PO_Direct_Injection_Staging: 'PO_Direct_Injection_Staging',

    // --- 🔄 M4 ZXH PO AUTO SYNC ---
    ZXH_PO_AutoSync_Staging:     'ZXH_PO_AutoSync_Staging',

    // --- 📦 M4 ISSUANCE AutoSync ---
    Material_Issuance:           'Material_Issuance',

    // --- 📊 M2 PIPELINE ANALYTICS ---
    M2_Pipeline_Ledger:          'M2_Pipeline_Ledger',
    M2_Daily_Stats:              'M2_Daily_Stats',
    
    // --- 🛠️ SYSTEM ---
    System_Execution_Log:   'System_Execution_Log'
  },

  // =========================================================
  // 2. TABLE SCHEMAS (Strict Typing from ERDs)
  // =========================================================
  TABLE_SCHEMAS: {
    
    // =========================================================
    // 📘 MODULE 1: PLANNING
    // =========================================================
    
    BOM_Data: {
      primaryKey: ['BOM_UPDATE'],
      schema: [
        { name: 'BOM_UPDATE', type: 'STRING' },
        { name: 'BOM', type: 'STRING' },
        { name: 'PIC', type: 'STRING' },
        { name: 'MAIN_GROUP', type: 'STRING' },
        { name: 'SUB_GROUP', type: 'STRING' },
        { name: 'BOM_DESCRIPTION', type: 'STRING' },
        { name: 'BOM_VIETNAMESE_DESCRIPTION', type: 'STRING' },
        { name: 'BOM_UNIT', type: 'STRING' },
        { name: 'BOM_STATUS', type: 'STRING' },
        // Audit
        { name: 'UPDATED_BY', type: 'STRING' },
        { name: 'UPDATED_AT', type: 'TIMESTAMP' }
      ]
    },

    Production_Order_Draft: { 
      // Input Table: All Strings for Robust Ingestion
      tempSchema: [
        { name: 'PRODUCTION_ORDER_ID', type: 'STRING' },
        { name: 'CUSTOMER', type: 'STRING' },
        { name: 'VPO', type: 'STRING' },
        { name: 'PO', type: 'STRING' },
        { name: 'SKU_NAME_VERSION', type: 'STRING' },
        { name: 'SKU_CODE', type: 'STRING' },
        { name: 'SKU_DESCRIPTION', type: 'STRING' },
        { name: 'SKU_UNIT', type: 'STRING' },
        // Dates (String)
        { name: 'RECEIVED_VPO_DATE', type: 'STRING' },
        { name: 'FINISHED_GOODS_ORDER_QTY', type: 'STRING' },
        { name: 'REQUEST_FACTORY_FINISHED_DATE', type: 'STRING' },
        { name: 'EX_FACTORY_DATE', type: 'STRING' },
        { name: 'EXPECTED_TIME_OF_DEPARTURE', type: 'STRING' },
        { name: 'WORK_IN_PROCESS_START_DATE', type: 'STRING' },
        { name: 'PACKAGE_START_DATE', type: 'STRING' },
        { name: 'FINISHED_DATE', type: 'STRING' },
        // Status
        { name: 'DATA_STATE', type: 'STRING' },
        { name: 'COMPLETION_QTY', type: 'STRING' },
        { name: 'COMPLETION_PERCENT', type: 'STRING' },
        { name: 'COUNTRY', type: 'STRING' }
      ]
    },

    BOM_Order_List_Draft: {
      tempSchema: [
        { name: 'PRODUCTION_ORDER_ID', type: 'STRING' },
        { name: 'BOM', type: 'STRING' },
        { name: 'BOM_CONSUMPTION', type: 'STRING' },
        { name: 'BOM_TOLERANCE', type: 'STRING' },
        { name: 'BOM_UPDATE', type: 'STRING' },
        
        // 🔴 CHANGE: Removed DATE_CODE
        // 🟡 CHANGE: Renamed NOTE -> ORDER_LIST_NOTE
        { name: 'ORDER_LIST_NOTE', type: 'STRING' }
      ]
    },

    BOM_Order_List_Staging: {
      schema: [
        { name: 'STAGING_ID', type: 'STRING' },
        { name: 'PRODUCTION_ORDER_ID', type: 'STRING' },
        { name: 'BOM_UPDATE', type: 'STRING' },
        { name: 'BOM', type: 'STRING' },
        { name: 'BOM_CONSUMPTION', type: 'FLOAT' },
        { name: 'BOM_TOLERANCE', type: 'FLOAT' },
        
        // 🔴 CHANGE: Removed DATE_CODE
        // 🟡 CHANGE: Renamed NOTE -> ORDER_LIST_NOTE
        { name: 'ORDER_LIST_NOTE', type: 'STRING' },
        
        // Tech Flags
        { name: 'IS_NEW_ITEM', type: 'STRING' },
        { name: 'UPLOAD_BATCH_ID', type: 'STRING' },
        { name: 'UPLOADED_AT', type: 'TIMESTAMP' },
        { name: 'VALIDATION_STATUS', type: 'STRING' },
        { name: 'ERROR_MESSAGE', type: 'STRING' }
      ]
    },

    BOM_Data_Staging: {
      schema: [
        { name: 'BOM_UPDATE', type: 'STRING' },
        { name: 'BOM', type: 'STRING' },
        { name: 'PIC', type: 'STRING' },
        { name: 'MAIN_GROUP', type: 'STRING' },
        { name: 'SUB_GROUP', type: 'STRING' },
        { name: 'BOM_DESCRIPTION', type: 'STRING' },
        { name: 'BOM_VIETNAMESE_DESCRIPTION', type: 'STRING' },
        { name: 'BOM_UNIT', type: 'STRING' },
        { name: 'BOM_STATUS', type: 'STRING' },
        { name: 'SOURCE', type: 'STRING' },
        { name: 'INGESTED_AT', type: 'TIMESTAMP' }
      ]
    },

    Production_Order: { 
      // Final Table: Strict DATE for business days
      primaryKey: ['PRODUCTION_ORDER_ID'],
      schema: [
        { name: 'PRODUCTION_ORDER_ID', type: 'STRING' },
        { name: 'CUSTOMER', type: 'STRING' },
        { name: 'VPO', type: 'STRING' },
        { name: 'PO', type: 'STRING' },
        { name: 'SKU_NAME_VERSION', type: 'STRING' },
        { name: 'SKU_CODE', type: 'STRING' },
        { name: 'SKU_DESCRIPTION', type: 'STRING' },
        { name: 'SKU_UNIT', type: 'STRING' },
        
        // --- STRICT DATES ---
        { name: 'RECEIVED_VPO_DATE', type: 'DATE' },
        { name: 'FINISHED_GOODS_ORDER_QTY', type: 'FLOAT' },
        { name: 'REQUEST_FACTORY_FINISHED_DATE', type: 'DATE' },
        { name: 'EX_FACTORY_DATE', type: 'DATE' },
        { name: 'EXPECTED_TIME_OF_DEPARTURE', type: 'DATE' },
        { name: 'WORK_IN_PROCESS_START_DATE', type: 'DATE' },
        { name: 'PACKAGE_START_DATE', type: 'DATE' },
        { name: 'FINISHED_DATE', type: 'DATE' },

        // --- STATUS & FLAGS ---
        { name: 'DATA_STATE', type: 'STRING' },
        { name: 'COMPLETION_QTY', type: 'FLOAT' },
        { name: 'COMPLETION_PERCENT', type: 'FLOAT' },
        { name: 'COUNTRY', type: 'STRING' },

        // --- CANCELLATION PROTOCOL ---

        { name: 'FORCE_CLOSE_QTY', type: 'FLOAT' },       // The final "Truth" qty for cancelled orders
        { name: 'CANCELLATION_REASON', type: 'STRING' },   // Why it was killed (Enum)
        { name: 'CANCELLED_BY', type: 'STRING' },          // Who killed it
        { name: 'CANCELLED_AT', type: 'TIMESTAMP' },       // When it died

        // --- AUDIT TRAIL (TIMESTAMP) ---
        { name: 'UPDATED_BY', type: 'STRING' },
        { name: 'UPDATED_AT', type: 'TIMESTAMP' },
        { name: 'VALID_FROM_TS', type: 'TIMESTAMP' },
        { name: 'VALID_TO_TS', type: 'TIMESTAMP' }
      ]
    },

    BOM_Order_List_Final: {
      // 🟢 Logic Note: This ID will now be 'DEM_' + MD5 (Handled by SP)
      primaryKey: ['BOM_ORDER_LIST_FINAL_ID'],
      schema: [
        { name: 'BOM_ORDER_LIST_FINAL_ID', type: 'STRING' },
        { name: 'PRODUCTION_ORDER_ID', type: 'STRING' },
        { name: 'BOM_UPDATE', type: 'STRING' },
        { name: 'BOM_CONSUMPTION', type: 'FLOAT' },
        { name: 'BOM_TOLERANCE', type: 'FLOAT' },
        { name: 'FULFILLMENT_MODE', type: 'STRING' },
        
        // 🔴 CHANGE: Removed DATE_CODE
        // 🟡 CHANGE: Renamed NOTE -> ORDER_LIST_NOTE (Strategy)
        { name: 'ORDER_LIST_NOTE', type: 'STRING' },
        
        // Audit
        { name: 'UPDATED_BY', type: 'STRING' },
        { name: 'UPDATED_AT', type: 'TIMESTAMP' },
        { name: 'VALID_FROM_TS', type: 'TIMESTAMP' },
        { name: 'VALID_TO_TS', type: 'TIMESTAMP' }
      ]
    },



    // =========================================================
    // 📢 MODULE 1: CS STATUS PROTOCOL (V9 Aligned)
    // =========================================================
    CS_Status_Discrepancy_Log: {
      primaryKey: ['ALERT_ID'], 
      schema: [
        // 1. IDENTITY
        { name: 'ALERT_ID', type: 'STRING', mode: 'REQUIRED' }, // Key: ALERT_{VPO}_{TYPE}
        { name: 'VPO', type: 'STRING', mode: 'REQUIRED' },
        { name: 'PRODUCTION_ORDER_ID', type: 'STRING' },
        
        // 2. ALERT METADATA
        { name: 'ALERT_TYPE', type: 'STRING', mode: 'REQUIRED' }, // ZOMBIE | DROP | QTY_MISMATCH | ...
        
        // 🟢 V12 NEW: Intelligence & Classification
        { name: 'CLASSIFICATION', type: 'STRING' },     // STATE_MISMATCH | ORDER_SPEC | SAFETY_FLAG...
        { name: 'IS_MULTI_ORDER', type: 'BOOLEAN' },    // True if VPO has >1 active order (Split Batch)
        { name: 'ORDER_COUNT', type: 'INTEGER' },       // Total number of orders in this VPO
        { name: 'CS_ROW_COUNT',        type: 'INTEGER' }, // [V15 NEW]
        
        { name: 'FIRST_DETECTED_AT', type: 'TIMESTAMP' },
        { name: 'LAST_DETECTED_AT', type: 'TIMESTAMP' },
        
        // 3. CS SNAPSHOT (Explicit Types for Logic)
        { name: 'CS_STATUS', type: 'STRING' },
        { name: 'CS_ACTUAL_QTY', type: 'FLOAT' },       // ⭐ Math capable
        { name: 'CS_ORDER_QTY', type: 'FLOAT' },        // ⭐ Math capable
        { name: 'CS_CONFIRMED_FFD', type: 'DATE' },     // ⭐ Date Logic capable
        { name: 'CS_ID_REFS', type: 'STRING' },         // "ID# 4995.1, 4995.2"
        
        // 4. SYSTEM SNAPSHOT
        { name: 'SYS_DATA_STATE', type: 'STRING' },
        { name: 'SYS_COMPLETION_QTY', type: 'FLOAT' },  // ⭐ Math capable
        { name: 'SYS_ORDER_QTY', type: 'FLOAT' },       // ⭐ Math capable
        { name: 'SYS_REQ_FFD', type: 'DATE' },          // ⭐ Date Logic capable
        
        // 5. WORKFLOW / ESCALATION
        { name: 'DAYS_UNRESOLVED', type: 'INTEGER' },
        { name: 'ESCALATION_LEVEL', type: 'INTEGER' },  // 0, 1, 2
        { name: 'ESCALATION_NOTIFIED_AT', type: 'TIMESTAMP' },
        
        // 6. RESOLUTION
        { name: 'IS_RESOLVED', type: 'BOOLEAN' },       // Helper flag
        { name: 'RESOLVED_AT', type: 'TIMESTAMP' },
        { name: 'RESOLVED_BY', type: 'STRING' },
        { name: 'RESOLUTION_TYPE', type: 'STRING' },
        { name: 'RESOLUTION_NOTE', type: 'STRING' },
        
        // 7. AUDIT
        { name: 'LOG_SOURCE', type: 'STRING' },
        { name: 'CREATED_AT', type: 'TIMESTAMP' },
        { name: 'UPDATED_AT', type: 'TIMESTAMP' }
      ]
    },


    CS_Resolution_Staging: {
      description: "Transactional queue for Planner decisions (Date/Qty fixes) before merging to Master Data.",
      type: "STAGING",
      schema: [
        // 1. IDENTITY & TRACEABILITY
        { name: "RESOLUTION_ID",       type: "STRING" },    // ID (RES_ + MD5( ALERT_ID + TARGET_QTY + TARGET_FFD + CURRENT_DATE ))
        { name: "ALERT_ID",            type: "STRING" },    // Link to the Discrepancy (Whistleblower)
        { name: "VPO",                 type: "STRING" },    // Human Readable Key
        { name: "PRODUCTION_ORDER_ID", type: "STRING" },    // System Key (Required for Updates)

        // 2. THE INTENT (Nullable for Partial Updates)
        { name: "TARGET_ORDER_QTY",    type: "FLOAT" },     // New Qty (If Planner overrides)
        { name: "TARGET_FFD",          type: "DATE" },      // New Date (If Planner overrides)

        // 3. CONTEXT & AUDIT
        { name: "RESOLUTION_NOTE",     type: "STRING" },    // "Factory confirmed delay..."
        { name: "RESOLVED_BY",         type: "STRING" },    // Email (phuongbui@...)

        // 🟢 V12 NEW: Safety Flag for SP
        { name: "IS_MULTI_ORDER",      type: "BOOLEAN" },

        // 4. PROCESS CONTROL (System Standard)
        { name: "VALIDATION_STATUS",   type: "STRING" },    // 'PENDING', 'PROCESSED', 'ERROR'
        { name: "ERROR_MESSAGE",       type: "STRING" },    // Feedback from SP
        { name: 'RESOLUTION_SOURCE',   type: 'STRING' }, // [V15 NEW]
        
        { name: "CREATED_AT",          type: "TIMESTAMP" }, // When User clicked Commit
        { name: "PROCESSED_AT",        type: "TIMESTAMP" }  // When SP finished execution
      ]
    },

    // =========================================================
    // 📊 MODULE 1: PRODUCTION STATUS (V5.1)
    // =========================================================
    Production_Status_Log: {
      primaryKey: ['LOG_ID'],
      schema: [
        // SECTION A: PRIMARY KEY
        { name: 'LOG_ID', type: 'STRING' },
        
        // SECTION B: DUAL IDENTITY (Either/Or)
        { name: 'PRODUCTION_ORDER_ID', type: 'STRING' }, // For Manual Portal
        { name: 'VPO', type: 'STRING' },                 // For Digital Bridge
        
        // SECTION C: PAYLOAD
        { name: 'FINISHED_GOODS_ORDER_QTY', type: 'FLOAT' }, // ⭐ NEW: The Target Context
        { name: 'NEW_CUMULATIVE_QTY', type: 'FLOAT' },       // Lifetime Cumulative
        { name: 'EXPECTED_OLD_QTY', type: 'FLOAT' },         // Optimistic Locking
        
        // SECTION D: SOURCE
        { name: 'SOURCE', type: 'STRING' },              // 'MANUAL_PORTAL' | 'AUTO_BRIDGE'
        
        // SECTION E: VALIDATION
        { name: 'VALIDATION_STATUS', type: 'STRING' },   // 'PENDING' | 'COMMITTED' | 'ERROR'
        { name: 'ERROR_MESSAGE', type: 'STRING' },
        
        // SECTION F: PROCESSING METADATA (Ghost Logic Audit)
        { name: 'GHOST_DEDUCTION_APPLIED', type: 'FLOAT' },
        { name: 'EFFECTIVE_QTY_FOR_FIFO', type: 'FLOAT' },
        
        // SECTION G: AUDIT TRAIL
        { name: 'LOGGED_AT', type: 'TIMESTAMP' },
        { name: 'LOGGED_BY', type: 'STRING' },
        { name: 'PROCESSED_AT', type: 'TIMESTAMP' }
      ]
    },

    // =========================================================
    // ⚖️ MODULE 2: BALANCING
    // =========================================================

    Stock_Data: {
      // 🟢 Logic Note: This ID will now be 'STK_' + MD5 (Handled by SP)
      primaryKey: ['STOCK_ID'],
      schema: [
        { name: 'STOCK_ID', type: 'STRING' },
        { name: 'BOM_UPDATE', type: 'STRING' },
        { name: 'BOM_VIETNAMESE_DESCRIPTION', type: 'STRING' },
        { name: 'INVENTORY_QTY', type: 'FLOAT' },
        
        // STRICT DATE (The Monday)
        { name: 'SNAPSHOT_DATE', type: 'DATE' },
        { name: 'FULFILLMENT_MODE', type: 'STRING' },
        { name: 'UPDATED_BY', type: 'STRING' },
        { name: 'UPDATED_AT', type: 'TIMESTAMP' }
      ]
    },

    Pegging_Allocations: {
      primaryKey: ['ALLOCATION_ID'],
      schema: [
        { name: 'ALLOCATION_ID', type: 'STRING' },
        { name: 'CALCULATION_BATCH_ID', type: 'STRING' },
        { name: 'DEMAND_ID', type: 'STRING' },
        { name: 'BOM_UPDATE', type: 'STRING' },
        { name: 'SUPPLY_SOURCE_ID', type: 'STRING' },
        { name: 'ALLOCATION_TYPE', type: 'STRING' },
        { name: 'ALLOCATED_QTY', type: 'FLOAT' },
        { name: 'ALLOCATED_AT', type: 'TIMESTAMP' }
      ]
    },

    PR_Draft: {
      // 🟢 Logic Note: This ID will now be 'PRD_' + MD5 (Handled by SP)
      primaryKey: ['DRAFT_PR_ID'],
      schema: [
        { name: 'DRAFT_PR_ID', type: 'STRING' },
        { name: 'DEMAND_ID', type: 'STRING' },
        
        // 🟢 CHANGE: Added VPO for Traceability
        { name: 'VPO', type: 'STRING' },

        { name: 'BOM_UPDATE', type: 'STRING' },
        { name: 'NET_SHORTAGE_COMPLETION', type: 'FLOAT' },
        { name: 'NET_SHORTAGE_ISSUANCE', type: 'FLOAT' },
        { name: 'NET_SHORTAGE_QTY', type: 'FLOAT' },
        { name: 'FULFILLMENT_MODE', type: 'STRING' },
        { name: 'REQUEST_TYPE', type: 'STRING' },
        { name: 'MAIN_GROUP', type: 'STRING' },
        { name: 'SUB_GROUP', type: 'STRING' },
        { name: 'HAS_ISSUANCE_DATA', type: 'BOOLEAN' },
        
        // 🟡 CHANGE: Added ORDER_LIST_NOTE to carry Strategy
        { name: 'ORDER_LIST_NOTE', type: 'STRING' },
        
        // 🔴 CHANGE: Removed DATE_CODE (M2 is now quantity-driven only)
        { name: 'REQUESTED_DELIVERY_DATE', type: 'DATE' },
        { name: 'CREATED_AT', type: 'TIMESTAMP' }
      ]
    },

    // =========================================================
    // 🧑‍💼 MODULE 3: PROCUREMENT
    // =========================================================

    Supplier_Information: {
      primaryKey: ['SUPPLIER_ID'],
      schema: [
        { name: 'SUPPLIER_ID', type: 'STRING' },
        { name: 'SUPPLIER_NAME', type: 'STRING' },
        { name: 'SUPPLIER_LOCATION_TYPE', type: 'STRING' },
        { name: 'ADDRESS', type: 'STRING' },
        { name: 'PRIMARY_CONTACT_NAME', type: 'STRING' },
        { name: 'PRIMARY_CONTACT_TITLE', type: 'STRING' },
        { name: 'MOBILE', type: 'STRING' },
        { name: 'LANDPHONE', type: 'STRING' },
        { name: 'TAX_ID', type: 'STRING' },
        { name: 'BANK_NAME', type: 'STRING' },
        { name: 'BANK_ACCOUNT_NUMBER', type: 'STRING' },
        { name: 'CONTRACT_ID', type: 'STRING' },
        
        // STRICT DATES (Legal Contracts)
        { name: 'CONTRACT_DATE', type: 'DATE' },
        { name: 'CONTRACT_EXPIRATION_DATE', type: 'DATE' },
        
        { name: 'PAYMENT_TERMS', type: 'STRING' },
        { name: 'SUPPLIER_STATUS', type: 'STRING' },
        // Audit
        { name: 'UPDATED_BY', type: 'STRING' },
        { name: 'UPDATED_AT', type: 'TIMESTAMP' }
      ]
    },

    Supplier_Information_Staging: {
      schema: [
        { name: 'SUPPLIER_ID', type: 'STRING' },
        { name: 'SUPPLIER_NAME', type: 'STRING' },
        { name: 'SUPPLIER_LOCATION_TYPE', type: 'STRING' },
        { name: 'ADDRESS', type: 'STRING' },
        { name: 'PRIMARY_CONTACT_NAME', type: 'STRING' },
        { name: 'PRIMARY_CONTACT_TITLE', type: 'STRING' },
        { name: 'MOBILE', type: 'STRING' },
        { name: 'LANDPHONE', type: 'STRING' },
        { name: 'TAX_ID', type: 'STRING' },
        { name: 'BANK_NAME', type: 'STRING' },
        { name: 'BANK_ACCOUNT_NUMBER', type: 'STRING' },
        { name: 'CONTRACT_ID', type: 'STRING' },
        { name: 'CONTRACT_DATE', type: 'STRING' }, 
        { name: 'CONTRACT_EXPIRATION_DATE', type: 'STRING' }, 
        { name: 'PAYMENT_TERMS', type: 'STRING' },
        { name: 'SUPPLIER_STATUS', type: 'STRING' },
        // Staging Specifics
        { name: 'VALIDATION_STATUS', type: 'STRING' },
        { name: 'ERROR_MESSAGE', type: 'STRING' },
        { name: 'UPDATED_BY', type: 'STRING' },
        { name: 'UPDATED_AT', type: 'TIMESTAMP' }
      ]
    },

    Supplier_Capacity: {
      primaryKey: ['CAPACITY_ID'],
      schema: [
        { name: 'CAPACITY_ID', type: 'STRING' },
        { name: 'SUPPLIER_ID', type: 'STRING' },
        { name: 'SUPPLIER_NAME', type: 'STRING' },
        { name: 'BOM_UPDATE', type: 'STRING' },
        { name: 'LEAD_TIME', type: 'FLOAT' },
        { name: 'UNIT_PRICE', type: 'FLOAT' },
        { name: 'MOQ', type: 'FLOAT' },
        // Audit
        { name: 'UPDATED_BY', type: 'STRING' },
        { name: 'UPDATED_AT', type: 'TIMESTAMP' }
      ]
    },

    Supplier_Capacity_Staging: {
      schema: [
        { name: 'SUPPLIER_ID', type: 'STRING' },
        { name: 'SUPPLIER_NAME', type: 'STRING' },
        { name: 'BOM_UPDATE', type: 'STRING' },
        { name: 'LEAD_TIME', type: 'STRING' },
        { name: 'UNIT_PRICE', type: 'STRING' },
        { name: 'MOQ', type: 'STRING' },
        { name: 'VALIDATION_STATUS', type: 'STRING' },
        { name: 'ERROR_MESSAGE', type: 'STRING' },
        { name: 'UPDATED_BY', type: 'STRING' },
        { name: 'UPDATED_AT', type: 'TIMESTAMP' }
      ]
    },

    PR_Staging: {
      primaryKey: ['PR_STAGING_ID'], 
      schema: [
        { name: 'PR_STAGING_ID', type: 'STRING' }, 
        { name: 'BOM_UPDATE', type: 'STRING' },
        { name: 'SUPPLIER_ID', type: 'STRING' },
        { name: 'SUPPLIER_NAME', type: 'STRING' },
        { name: 'QTY_TO_APPROVE', type: 'FLOAT' },
        { name: 'FULFILLMENT_MODE', type: 'STRING' },
        { name: 'FINAL_UNIT_PRICE', type: 'FLOAT' },
        
        { name: 'REQUESTED_DELIVERY_DATE', type: 'DATE' },
        { name: 'VPO', type: 'STRING' },
        
        { name: 'VALIDATION_STATUS', type: 'STRING' },
        { name: 'VALIDATION_LOG', type: 'STRING' },
        
        { name: 'PIC', type: 'STRING' },
        { name: 'DATE_CODE', type: 'STRING' },
        { name: 'UPDATED_BY', type: 'STRING' },
        { name: 'UPDATED_AT', type: 'TIMESTAMP' }
      ]
    },

    PR_Final: {
      primaryKey: ['PR_FINAL_ID'],
      schema: [
        { name: 'PR_FINAL_ID', type: 'STRING' },
        { name: 'SUPPLIER_ID', type: 'STRING' },
        { name: 'SUPPLIER_NAME', type: 'STRING' },
        { name: 'BOM_UPDATE', type: 'STRING' },
        { name: 'QTY_APPROVED', type: 'FLOAT' },
        { name: 'FULFILLMENT_MODE', type: 'STRING' },
        { name: 'FINAL_UNIT_PRICE', type: 'FLOAT' }, 
        
        // STRICT DATE
        { name: 'REQUESTED_DELIVERY_DATE', type: 'DATE' },
        
        { name: 'VPO', type: 'STRING' },

        // 🟡 CHANGE: Added ORDER_LIST_NOTE (Strategy Context)
        { name: 'ORDER_LIST_NOTE', type: 'STRING' },

        { name: 'CONSOLIDATION_STATUS', type: 'STRING' },
        
        { name: 'PIC', type: 'STRING' },
        { name: 'DATE_CODE', type: 'STRING' },
        { name: 'UPDATED_BY', type: 'STRING' },
        { name: 'UPDATED_AT', type: 'TIMESTAMP' } 
      ]
    },

    PO_Consolidation_Event: {
      primaryKey: ['CONSOLIDATION_BATCH_ID'],
      schema: [
        { name: 'CONSOLIDATION_BATCH_ID', type: 'STRING' },
        { name: 'BUYER_PIC', type: 'STRING' },
        { name: 'CONSOLIDATION_RULE', type: 'STRING' },
        { name: 'CONSOLIDATED_AT', type: 'TIMESTAMP' },
        { name: 'TOTAL_PR_COUNT', type: 'INTEGER' },
        { name: 'TOTAL_PO_COUNT', type: 'INTEGER' }
      ]
    },

    PR_PO_Consolidation: {
      primaryKey: ['CONSOLIDATION_LINK_ID'],
      schema: [
        { name: 'CONSOLIDATION_LINK_ID', type: 'STRING' },
        { name: 'CONSOLIDATION_BATCH_ID', type: 'STRING' },
        { name: 'PR_FINAL_ID', type: 'STRING' },
        { name: 'PO_DOCUMENT_ID', type: 'STRING' },
        { name: 'CONSOLIDATION_REASON', type: 'STRING' },
        { name: 'QTY_ALLOCATED_TO_PO', type: 'FLOAT' },
        { name: 'LINKED_AT', type: 'TIMESTAMP' }
      ]
    },

    PO_Header: {
      primaryKey: ['PO_DOCUMENT_ID'],
      schema: [
        { name: 'PO_DOCUMENT_ID', type: 'STRING' },
        { name: 'CONSOLIDATION_BATCH_ID', type: 'STRING' },
        { name: 'SUPPLIER_ID', type: 'STRING' },
        { name: 'SUPPLIER_NAME', type: 'STRING' },
        { name: 'PO_NUMBER_REF', type: 'STRING' },
        
        // STRICT DATES (Legal)
        { name: 'ORDER_DATE', type: 'DATE' },
        
        { name: 'TOTAL_AMOUNT', type: 'FLOAT' },
        { name: 'LINE_COUNT', type: 'INTEGER' },
        
        // STRICT DATE (Calculated)
        { name: 'PO_DUE_DATE', type: 'DATE' },
        
        { name: 'PO_STATUS', type: 'STRING' },

        // 🟢 NEW: Data Provenance (Cold Start Support)
        { name: 'PO_ORIGIN', type: 'STRING' },  // 'SYSTEM' | 'DIRECT_INJECTION' | 'MANUAL_MTS' | 'ZXH_AUTO_SYNC'

        { name: 'FILELINK', type: 'STRING' },
        { name: 'CREATED_BY', type: 'STRING' },
        { name: 'CREATED_AT', type: 'TIMESTAMP' },
        { name: 'ISSUED_AT', type: 'TIMESTAMP' }
      ]
    },

    PO_Line: {
      primaryKey: ['PO_LINE_ID'],
      schema: [
        { name: 'PO_LINE_ID', type: 'STRING' },
        { name: 'PO_DOCUMENT_ID', type: 'STRING' },
        
        // 🟢 NEW: Persistence of Ownership
        { name: 'PIC', type: 'STRING' },

        { name: 'BOM_UPDATE', type: 'STRING' },
        { name: 'FULFILLMENT_MODE', type: 'STRING' },
        { name: 'PR_FINAL_ID', type: 'STRING' },
        { name: 'ORDER_QTY', type: 'FLOAT' },
        { name: 'UNIT_PRICE', type: 'FLOAT' },
        { name: 'LINE_TOTAL', type: 'FLOAT' },
        
        // 🟢 CHANGE: Added VPO (Part E)
        { name: 'VPO', type: 'STRING' },
        
        // 🟡 CHANGE: Added PO_LINE_NOTE (External Instruction - Part C)
        { name: 'PO_LINE_NOTE', type: 'STRING' },

        { name: 'SYSTEM_SUGGESTED_REQUESTED_DATE', type: 'DATE' },
        { name: 'BUYER_REQUESTED_DATE', type: 'DATE' },
        
        // 🟢 Retained DATE_CODE (Part D)
        { name: 'DATE_CODE', type: 'STRING' },

        { name: 'LINE_NUMBER', type: 'INTEGER' },
        { name: 'CREATED_AT', type: 'TIMESTAMP' }
      ]
    },

    // =========================================================
    // 🚚 MODULE 4: EXECUTION
    // =========================================================

    Stock_Count_Upload: {
      // Input Table ("Trash Bin")
      tempSchema: [
        { name: 'UPLOAD_ID', type: 'STRING' },
        { name: 'UPLOAD_BATCH_ID', type: 'STRING' },
        { name: 'WAREHOUSE_ID', type: 'STRING' },
        { name: 'RAW_BOM_UPDATE', type: 'STRING' },
        { name: 'BOM_VIETNAMESE_DESCRIPTION', type: 'STRING' },
        { name: 'INPUT_UNIT_CODE', type: 'STRING' },
        { name: 'RAW_QTY', type: 'FLOAT' },
        
        // 🟢 V4 UPGRADE: The Anchor for the Stability Protocol
        { name: 'EXTRACTED_SNAPSHOT_DATE', type: 'DATE' },
        
        { name: 'UPLOADED_BY', type: 'STRING' },
        { name: 'UPLOADED_AT', type: 'TIMESTAMP' }
      ]
    },

    Stock_Count_Staging: {
      schema: [
        { name: 'STAGING_ID', type: 'STRING' },
        { name: 'UPLOAD_BATCH_ID', type: 'STRING' },
        { name: 'BOM_UPDATE', type: 'STRING' },
        { name: 'BOM_VIETNAMESE_DESCRIPTION', type: 'STRING' },
        { name: 'TOTAL_COUNT_QTY', type: 'FLOAT' },
        { name: 'SNAPSHOT_DATE', type: 'DATE' }
      ]
    },


    PO_Line_Tracking: {
      primaryKey: ['PO_LINE_ID'],
      schema: [
        { name: 'PO_LINE_ID', type: 'STRING' },
        { name: 'PO_DOCUMENT_ID', type: 'STRING' },
        { name: 'BOM_UPDATE', type: 'STRING' },
        { name: 'FULFILLMENT_MODE', type: 'STRING' },
        { name: 'VPO', type: 'STRING' },
        
        // 🟢 NEW: Session Owner (Critical for Portal Filter)
        { name: 'PIC', type: 'STRING' },
        
        // 🟢 CONTEXT: The Instruction (Buyer's Voice)
        { name: 'PO_LINE_NOTE', type: 'STRING' },

        // 🟢 QUANTITY WATERFALL (The Gradient)
        { name: 'ORDER_QTY', type: 'FLOAT' },           // Level 1: What we asked
        { name: 'CONFIRMED_QTY', type: 'FLOAT' },       // Level 2: What they promised
        { name: 'LOADED_QTY', type: 'FLOAT' },          // Level 3: What is on the boat
        { name: 'ACTUAL_RECEIVED_QTY', type: 'FLOAT' }, // Level 4: What we got

        // 🟢 TIME WATERFALL
        { name: 'FINAL_REQUESTED_DELIVERY_DATE', type: 'DATE' },
        { name: 'AGREED_DELIVERY_DATE', type: 'DATE' },
        { name: 'CURRENT_ETA', type: 'DATE' },
        { name: 'ACTUAL_ARRIVAL_DATE', type: 'DATE' },  // <--- NEW: Triggers Closure Timer

        // 🟢 FEEDBACK: The Conversation (Supplier's Voice)
        { name: 'SUPPLIER_FEEDBACK_NOTE', type: 'STRING' },

        // 🟢 SYSTEM STATUS
        { name: 'STATUS', type: 'STRING' },
        { name: 'CLOSURE_REASON', type: 'STRING' },
        { name: 'IS_ACTIVE', type: 'BOOLEAN' },
        
        { name: 'DATE_CODE', type: 'STRING' },
        { name: 'INITIALIZED_AT', type: 'TIMESTAMP' },
        
        // 🟡 RENAMED: Standardized Audit Columns
        { name: 'UPDATED_BY', type: 'STRING' },
        { name: 'UPDATED_AT', type: 'TIMESTAMP' },

        // 🆕 M4 PO Legacy AutoSync: Orphan detection timestamp
        { name: 'LAST_SEEN_IN_SYNC', type: 'TIMESTAMP' }
      ]
    },

    Inventory_Variance_Log: {
      primaryKey: ['VARIANCE_ID'],
      schema: [
        { name: 'VARIANCE_ID', type: 'STRING' },
        { name: 'SNAPSHOT_DATE', type: 'DATE' },
        { name: 'BOM_UPDATE', type: 'STRING' },
        { name: 'IMPLIED_RECEIPTS', type: 'FLOAT' },
        { name: 'PO_PROMISE_QTY', type: 'FLOAT' },
        { name: 'VARIANCE_GAP', type: 'FLOAT' },
        { name: 'VARIANCE_CATEGORY', type: 'STRING' },
        { name: 'LOGGED_AT', type: 'TIMESTAMP' }
      ]
    },

    Supplier_Feedback_Log: {
      // Immutable Audit Trail (Self-Contained History)
      primaryKey: ['FEEDBACK_LOG_ID'],
      schema: [
        { name: 'FEEDBACK_LOG_ID', type: 'STRING' },
        { name: 'FEEDBACK_BATCH_ID', type: 'STRING' },
        
        // Context
        { name: 'PO_LINE_ID', type: 'STRING' },
        { name: 'PO_DOCUMENT_ID', type: 'STRING' },
        { name: 'PO_NUMBER_REF', type: 'STRING' },
        { name: 'SUPPLIER_NAME', type: 'STRING' },
        { name: 'BOM_UPDATE', type: 'STRING' },       
        { name: 'VPO', type: 'STRING' },              
        { name: 'DATE_CODE', type: 'STRING' },
        { name: 'FULFILLMENT_MODE', type: 'STRING' }, 
        { name: 'PIC', type: 'STRING' },

        // 🟢 NEW: Capture the Intent
        { name: 'CLOSURE_REASON', type: 'STRING' },

        // Feedback Data
        { name: 'CONFIRMED_QTY', type: 'FLOAT' },
        { name: 'LOADED_QTY', type: 'FLOAT' },
        { name: 'ACTUAL_RECEIVED_QTY', type: 'FLOAT' },
        
        { name: 'AGREED_DELIVERY_DATE', type: 'DATE' },
        { name: 'CURRENT_ETA', type: 'DATE' },
        { name: 'ACTUAL_ARRIVAL_DATE', type: 'DATE' },
        
        { name: 'SUPPLIER_FEEDBACK_NOTE', type: 'STRING' },
        
        // Meta
        { name: 'FEEDBACK_STATUS', type: 'STRING' },
        { name: 'UPDATED_BY', type: 'STRING' },
        { name: 'UPDATED_AT', type: 'TIMESTAMP' }
      ]
    },

    // =========================================================
    // 🏭 DIRECT INJECTION MODULE
    // Purpose: Validation buffer / Air Lock for manual PO injection
    // Pipeline: Direct Injection │ ID Prefix: INJ_DOC_ / INJ_LINE_
    // Type: Transactional Staging (Ephemeral, Full Audit Retention)
    // =========================================================

    PO_Direct_Injection_Staging: {
      primaryKey: ['SESSION_ID', 'ROW_NUMBER'],
      schema: [
        // ═══════════════════════════════════════════════════════════════════
        // SECTION A: COMPOSITE KEY
        // ═══════════════════════════════════════════════════════════════════
        { name: 'SESSION_ID', type: 'STRING' },
        { name: 'ROW_NUMBER', type: 'INTEGER' },
        
        // ═══════════════════════════════════════════════════════════════════
        // SECTION B: SESSION CONTEXT (From Dialog/Script - Same for all rows)
        // ═══════════════════════════════════════════════════════════════════
        { name: 'PIC', type: 'STRING' },
        
        // ═══════════════════════════════════════════════════════════════════
        // SECTION C: USER INPUTS - IDENTITY (Required)
        // ═══════════════════════════════════════════════════════════════════
        { name: 'SUPPLIER_NAME', type: 'STRING' },
        { name: 'BOM_UPDATE', type: 'STRING' },
        
        // ═══════════════════════════════════════════════════════════════════
        // SECTION D: USER INPUTS - QUANTITIES
        // ═══════════════════════════════════════════════════════════════════
        { name: 'ORDER_QTY', type: 'FLOAT' },
        { name: 'UNIT_PRICE', type: 'FLOAT' },
        { name: 'CONFIRMED_QTY', type: 'FLOAT' },
        { name: 'LOADED_QTY', type: 'FLOAT' },
        
        // ═══════════════════════════════════════════════════════════════════
        // SECTION E: USER INPUTS - DATES
        // ═══════════════════════════════════════════════════════════════════
        { name: 'ORIGINAL_ORDER_DATE', type: 'DATE' },
        { name: 'FINAL_REQUESTED_DELIVERY_DATE', type: 'DATE' },
        { name: 'AGREED_DELIVERY_DATE', type: 'DATE' },
        { name: 'CURRENT_ETA', type: 'DATE' },
        
        // ═══════════════════════════════════════════════════════════════════
        // SECTION F: USER INPUTS - CONTEXT
        // ═══════════════════════════════════════════════════════════════════
        { name: 'LEGACY_PO_REF', type: 'STRING' },
        { name: 'VPO', type: 'STRING' },
        { name: 'PO_LINE_NOTE', type: 'STRING' },
        
        // ═══════════════════════════════════════════════════════════════════
        // SECTION G: VALIDATION FEEDBACK (SP → User)
        // ═══════════════════════════════════════════════════════════════════
        { name: 'VALIDATION_STATUS', type: 'STRING' },
        { name: 'ERROR_MESSAGE', type: 'STRING' },
        
        // ═══════════════════════════════════════════════════════════════════
        // SECTION H: SYSTEM DERIVED (Populated by SP_INJECT_DIRECT_PO)
        // ═══════════════════════════════════════════════════════════════════
        { name: 'RESOLVED_SUPPLIER_ID', type: 'STRING' },
        { name: 'DERIVED_FULFILLMENT_MODE', type: 'STRING' },
        { name: 'GENERATED_PO_DOC_ID', type: 'STRING' },
        { name: 'GENERATED_PO_LINE_ID', type: 'STRING' },
        { name: 'DERIVED_STATUS', type: 'STRING' },
        
        // ═══════════════════════════════════════════════════════════════════
        // SECTION I: AUDIT TRAIL (System Generated - End of Schema)
        // ═══════════════════════════════════════════════════════════════════
        { name: 'UPLOADED_BY', type: 'STRING' },
        { name: 'UPLOADED_AT', type: 'TIMESTAMP' }
      ]
    },

    // ═════════════════════════════════════════════════════════════════════
    // 🔄 M4 ZXH PO AUTO SYNC
    // Purpose: Nightly staging table for ZXH Corporation (外协) → BQ sync
    // Pipeline: ZXH AutoSync │ ID Prefix: ZXH_DOC_ / ZXH_LINE_
    // Source: https://docs.google.com/spreadsheets/d/1fBwwxkC_z-xtjB1uQpF8-C0KpwGjnNe8ICH6fbv7uro
    // ═════════════════════════════════════════════════════════════════════

    ZXH_PO_AutoSync_Staging: {
      schema: [
        { name: 'GENERATED_PO_LINE_ID', type: 'STRING' },
        { name: 'GENERATED_PO_DOC_ID', type: 'STRING' },
        { name: 'INV', type: 'STRING' },
        { name: 'BOM_CODE', type: 'STRING' },
        { name: 'PO_NUMBER_REF', type: 'STRING' },
        { name: 'SUPPLIER_NAME', type: 'STRING' },
        { name: 'GROSS_QTY', type: 'FLOAT' },
        { name: 'REQUIRE_DATE', type: 'DATE' },
        { name: 'REMARK', type: 'STRING' },
        { name: 'ZXH_STATUS', type: 'STRING' },
        { name: 'ETA', type: 'DATE' },
        { name: 'PIC', type: 'STRING' },
        { name: 'UPLOADED_AT', type: 'TIMESTAMP' },
        { name: 'SESSION_ID', type: 'STRING' }
      ]
    },

    // =========================================================
    // 📦 M4 ISSUANCE AUTOSYNC (Dual-Method Upgrade — Phase 3)
    // Purpose: Stores cumulative warehouse issuance data (Lead plan data)
    //          Used by Material_Demand_VIEW for GROSS_DEMAND_ISSUANCE_METHOD calculation.
    // =========================================================
    Material_Issuance: {
      primaryKey: ['ISSUANCE_ID'],
      schema: [
        // SECTION A: IDENTITY
        { name: 'ISSUANCE_ID', type: 'STRING' },            // ISU_ + MD5(BOM_UPDATE|VPO|SOURCE_ID)
        { name: 'BOM_UPDATE', type: 'STRING' },             // Material key (joined to Material_Demand_VIEW)
        { name: 'VPO', type: 'STRING' },                    // Order reference

        // SECTION B: ISSUANCE DATA
        { name: 'CUMULATIVE_ISSUANCE_QTY', type: 'FLOAT' }, // Total qty issued from warehouse to date
        { name: 'SNAPSHOT_DATE', type: 'DATE' },            // When this snapshot was captured

        // SECTION C: MAPPING CONTEXT
        { name: 'SOURCE_BOM_CODE', type: 'STRING' },        // Original warehouse BOM code (pre-mapping)

        // SECTION D: SYNC METADATA
        { name: 'SYNC_BATCH_ID', type: 'STRING' },          // Links to System_Execution_Log
        { name: 'SYNCED_AT', type: 'TIMESTAMP' },           // When the sync ran

        // SECTION E: CLASSIFICATION (V1.0 Phase 3 — enables multi-source pipeline)
        { name: 'SOURCE_ID', type: 'STRING' },              // e.g. 'CHI_LEAD', 'PAINT' (ISSUANCE_SOURCES key)
        { name: 'MAIN_GROUP', type: 'STRING' },             // e.g. 'Chì', 'Sơn' — from BOM_Data
        { name: 'RESOLUTION_METHOD', type: 'STRING' }       // 'EXACT' | 'SHORTCODE'
      ]
    },

    // =========================================================
    // 📦 M4 ISSUANCE STAGING (Phase 3 — transient, WRITE_TRUNCATE per run)
    // Purpose: Landing table for CSV upload before MERGE into Material_Issuance.
    //          Truncated at the start of each sync run (one source at a time).
    // IMPORTANT: Schema must be a superset of Material_Issuance schema.
    // =========================================================
    Material_Issuance_Staging: {
      schema: [
        { name: 'ISSUANCE_ID', type: 'STRING' },
        { name: 'BOM_UPDATE', type: 'STRING' },
        { name: 'VPO', type: 'STRING' },
        { name: 'CUMULATIVE_ISSUANCE_QTY', type: 'FLOAT' },
        { name: 'SNAPSHOT_DATE', type: 'DATE' },
        { name: 'SOURCE_BOM_CODE', type: 'STRING' },
        { name: 'SYNC_BATCH_ID', type: 'STRING' },
        { name: 'SYNCED_AT', type: 'TIMESTAMP' },
        { name: 'SOURCE_ID', type: 'STRING' },
        { name: 'MAIN_GROUP', type: 'STRING' },
        { name: 'RESOLUTION_METHOD', type: 'STRING' }
      ]
    },

    // =========================================================
    // ⚙️ METHOD OVERRIDE CONFIG (Phase 7 — Auto-Switch)
    // Purpose: Configurable table controlling which GROSS_DEMAND method
    //          is used for specific material groups.
    // Grain: 1 row per MAIN_GROUP override.
    // Consumer: Material_Demand_VIEW (LEFT JOIN on B.MAIN_GROUP = MOC.MAIN_GROUP)
    // =========================================================
    Method_Override_Config: {
      primaryKey: ['CONFIG_ID'],
      schema: [
        { name: 'CONFIG_ID', type: 'STRING' },           // e.g., 'MOC_chi'
        { name: 'MAIN_GROUP', type: 'STRING' },           // e.g., 'Chì' — matches BOM_Data.MAIN_GROUP
        { name: 'PREFERRED_METHOD', type: 'STRING' },     // 'ISSUANCE' or 'COMPLETION'
        { name: 'IS_ACTIVE', type: 'BOOLEAN' },           // Toggle on/off without deleting
        { name: 'VALIDATED_BY', type: 'STRING' },         // PIC who confirmed accuracy (NULL until validated)
        { name: 'VALIDATED_AT', type: 'TIMESTAMP' },      // When validation happened
        { name: 'NOTES', type: 'STRING' },                // Reason / context
        { name: 'CREATED_AT', type: 'TIMESTAMP' },
        { name: 'UPDATED_AT', type: 'TIMESTAMP' }
      ]
    },

    // =========================================================
    // 📊 M2 PIPELINE LEDGER (Dual-Method Upgrade — Phase 1)
    // Purpose: Append-only archive of the full M2 pipeline run per day.
    //          Captures BOTH gross demand (from SNAPSHOT) and net shortage
    //          (from PR_Draft) on the SAME ROW for complete traceability.
    // Grain: 1 row per DEMAND_ID per day. ~10K rows/day.
    // Partition: LEDGER_DATE (monthly cleanup after 12 months).
    // =========================================================
    M2_Pipeline_Ledger: {
      schema: [
        // SECTION A: LEDGER IDENTITY (Partition + Run Linkage)
        { name: 'LEDGER_DATE', type: 'DATE' },              // Partition column (1 per day)
        { name: 'RUN_SOURCE', type: 'STRING' },             // 'NIGHTLY' | 'MANUAL' | 'CHAIN'
        { name: 'BATCH_ID', type: 'STRING' },               // Links to M2_Daily_Stats

        // SECTION B: DEMAND IDENTITY (From SNAPSHOT)
        { name: 'DEMAND_ID', type: 'STRING' },              // Row key from Material_Demand_SNAPSHOT
        { name: 'PRODUCTION_ORDER_ID', type: 'STRING' },    // Order context
        { name: 'BOM_UPDATE', type: 'STRING' },             // Material key
        { name: 'VPO', type: 'STRING' },                    // Order reference
        { name: 'FULFILLMENT_MODE', type: 'STRING' },       // 'PUBLIC' | 'PRIVATE'

        // SECTION C: DUAL-METHOD DEMAND VALUES (The Core)
        { name: 'GROSS_DEMAND_COMPLETION_METHOD', type: 'FLOAT' },  // Gross demand — Completion method
        { name: 'GROSS_DEMAND_ISSUANCE_METHOD', type: 'FLOAT' },    // Gross demand — Issuance method
        { name: 'GROSS_DEMAND_QTY', type: 'FLOAT' },        // Active gross demand (what ME allocated against)
        { name: 'NET_SHORTAGE_COMPLETION', type: 'FLOAT' }, // Net shortage — Completion (from PR_Draft)
        { name: 'NET_SHORTAGE_ISSUANCE', type: 'FLOAT' },   // Net shortage — Issuance (from PR_Draft)
        { name: 'NET_SHORTAGE_QTY', type: 'FLOAT' },        // Active net shortage (from PR_Draft)
        { name: 'SUPPLY_ALLOCATED_QTY', type: 'FLOAT' },    // Derived: GROSS_DEMAND_QTY - NET_SHORTAGE_QTY

        // SECTION D: CLASSIFICATION (From SNAPSHOT)
        { name: 'MAIN_GROUP', type: 'STRING' },             // e.g. 'Chì', 'Bao bì'
        { name: 'SUB_GROUP', type: 'STRING' },
        { name: 'PIC', type: 'STRING' },                    // Material owner
        { name: 'SKU_CODE', type: 'STRING' },               // Product context

        // SECTION E: CONTEXT (From SNAPSHOT)
        { name: 'REQUESTED_DELIVERY_DATE', type: 'DATE' },  // Urgency indicator
        { name: 'ORDER_LIST_NOTE', type: 'STRING' },        // Strategy note

        // SECTION F: FLAGS (From SNAPSHOT)
        { name: 'HAS_ISSUANCE_DATA', type: 'BOOLEAN' },    // Is issuance data available?
        { name: 'CALC_METHOD_USED', type: 'STRING' },       // 'COMPLETION' | 'ISSUANCE'
        { name: 'HAS_SHORTAGE', type: 'BOOLEAN' },          // Derived: net shortage exists?

        // SECTION G: AUDIT
        { name: 'PRESERVED_AT', type: 'TIMESTAMP' }         // When archived in this ledger
      ]
    },

    // =========================================================
    // 📊 M2 DAILY STATS (Dual-Method Upgrade — Phase 6)
    // Purpose: One row per nightly run — execution health + pre-computed
    //          aggregate metrics (performance cache for email/dashboard).
    // Grain: 1 row per (RUN_DATE, RUN_SOURCE). ~365 rows/year (no expiry).
    // =========================================================
    M2_Daily_Stats: {
      primaryKey: ['RUN_DATE', 'RUN_SOURCE'],
      schema: [
        // SECTION A: IDENTITY (Composite Key)
        { name: 'RUN_DATE', type: 'DATE' },                 // Date of the M2 run
        { name: 'RUN_SOURCE', type: 'STRING' },             // 'NIGHTLY' | 'MANUAL' | 'CHAIN'

        // SECTION B: EXECUTION METADATA (Unique — cannot derive from Ledger)
        { name: 'BATCH_ID', type: 'STRING' },               // Links to M2_Pipeline_Ledger rows
        { name: 'RUN_STATUS', type: 'STRING' },             // 'SUCCESS' | 'FAILED'
        { name: 'RUN_DURATION_SECONDS', type: 'FLOAT' },    // How long the M2 run took
        { name: 'ERROR_MESSAGE', type: 'STRING' },          // First error if STATUS = 'FAILED'

        // SECTION C: CORE AGGREGATE METRICS (from PR_Draft + Pegging)
        { name: 'TOTAL_SHORTAGE_COUNT', type: 'INTEGER' },  // COUNT(*) from PR_Draft
        { name: 'TOTAL_NET_SHORTAGE_QTY', type: 'FLOAT' },  // SUM(NET_SHORTAGE_QTY) from PR_Draft
        { name: 'TOTAL_ALLOCATION_COUNT', type: 'INTEGER' },// COUNT(*) from Pegging_Allocations

        // SECTION D: DUAL-METHOD METRICS (from SNAPSHOT)
        { name: 'GROSS_DEMAND_COUNT_COMPLETION_METHOD', type: 'INTEGER' },  // Items where GROSS_DEMAND_COMPLETION_METHOD > 0
        { name: 'GROSS_DEMAND_COUNT_ISSUANCE_METHOD', type: 'INTEGER' },    // Items where GROSS_DEMAND_ISSUANCE_METHOD > 0
        { name: 'GROSS_DEMAND_TOTAL_COMPLETION_METHOD_QTY', type: 'FLOAT' },// SUM(GROSS_DEMAND_COMPLETION_METHOD)
        { name: 'GROSS_DEMAND_TOTAL_ISSUANCE_METHOD_QTY', type: 'FLOAT' },  // SUM(GROSS_DEMAND_ISSUANCE_METHOD)
        { name: 'METHOD_DELTA_COUNT', type: 'INTEGER' },    // Items where methods disagree >10%

        // SECTION E: TOP OFFENDER
        { name: 'TOP_OFFENDER_BOM_UPDATE', type: 'STRING' },// BOM_UPDATE with highest shortage
        { name: 'TOP_OFFENDER_QTY', type: 'FLOAT' },
        { name: 'TOP_OFFENDER_SHARE_PCT', type: 'FLOAT' },  // Share of total shortage

        // SECTION F: ANOMALY FLAGS
        { name: 'IS_ANOMALY', type: 'BOOLEAN' },
        { name: 'ANOMALY_REASON', type: 'STRING' },

        // SECTION G: AUDIT
        { name: 'CREATED_AT', type: 'TIMESTAMP' }
      ]
    },

    // =========================================================
    // 🛠️ SYSTEM
    // =========================================================
    System_Execution_Log: {
      schema: [
        { name: 'BATCH_ID', type: 'STRING' },
        { name: 'MODULE_ID', type: 'STRING' },
        { name: 'STEP_ID', type: 'INTEGER' },
        { name: 'STEP_NAME', type: 'STRING' },
        { name: 'STATUS', type: 'STRING' },
        { name: 'DURATION_SEC', type: 'FLOAT' },
        { name: 'ERROR_MESSAGE', type: 'STRING' },
        { name: 'LOGGED_AT', type: 'TIMESTAMP' }
      ]
    }
  },

  // =========================================================
  // 3. SHEET LAYOUTS (Standard)
  // =========================================================
  SHEET_LAYOUTS: {
    DEFAULT: {
      startDelimiterHeader: 'RAW_START',
      endDelimiterHeader: 'RAW_END'
    }
  }
};


// =========================================================
// 4. PUBLIC ACCESSORS (DUAL MODE)
// =========================================================

// // New Standard (Matches Admin_Infrastructure)
// function getCoreConfig() {
//   return SCHEMA_DEFINITIONS;
// }

// Legacy Support (Matches older Modules)
function getCoreSchema() {
  return SCHEMA_DEFINITIONS;
}