/**
 * 🏦 SQL VAULT (v3.3 - GRAND UNIFIED MANIFEST EDITION)
 * Stores Complex Business Logic (Views & Stored Procedures).
 * Ref: Database_Infrastructure_Fix_Implementation_Plan.txt
 */
const SQL_VAULT = {

  // =========================================================
  // 🛠️ UTILITIES (Global Helpers)
  // =========================================================
  FN_GENERATE_HASH: `
      CREATE OR REPLACE FUNCTION \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.FN_GENERATE_HASH\`(key1 STRING, key2 STRING) AS (
        -- 🛡️ Safety Protocol: 
        -- Creates a deterministic ID based on inputs (MD5 HEX String).
        -- Usage: CONCAT('PREFIX_', FN_GENERATE_HASH(ColA, ColB))
        TO_HEX(MD5(CONCAT(
          COALESCE(TRIM(UPPER(key1)), 'MISSING'), 
          '|', 
          COALESCE(TRIM(UPPER(key2)), 'MISSING')
        )))
      );
  `,
  
  // =========================================================
  // M2: THE BRAIN (Virtual Views)
  // =========================================================
  Unified_Supply_Stack_VIEW: `
      CREATE OR REPLACE VIEW \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Unified_Supply_Stack_VIEW\` AS
      
      /* PART A: STOCK (The Monday Snapshot) */
      SELECT 
        'STOCK' AS SOURCE_TYPE,
        STOCK_ID AS UNIFIED_ID,
        BOM_UPDATE,
        INVENTORY_QTY AS QTY_AVAILABLE,
        
        /* STRICT DATE: Already Date in Stock_Data */
        SNAPSHOT_DATE AS SUPPLY_DATE, 
        UPDATED_AT
      FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Stock_Data\`
      WHERE FULFILLMENT_MODE = 'PUBLIC'
        AND INVENTORY_QTY > 0
      
      UNION ALL
      
      /* PART B: POs (The In-Transit Pipeline) */
      SELECT
        'PO' AS SOURCE_TYPE,
        PO_LINE_ID AS UNIFIED_ID,
        BOM_UPDATE,
        
        /* 🧠 SMART LOGIC 1: The Quantity Waterfall (Corrected)
           Hierarchy: Received (Truth) > Loaded (Transit) > Confirmed (Promise) > Ordered (Ask) */
        COALESCE(ACTUAL_RECEIVED_QTY, LOADED_QTY, CONFIRMED_QTY, ORDER_QTY) AS QTY_AVAILABLE,
        
        /* 🧠 SMART LOGIC 2: The Time Waterfall
           Trust Actuals > ETA > Agreement > Request. */
        COALESCE(ACTUAL_ARRIVAL_DATE, CURRENT_ETA, AGREED_DELIVERY_DATE, FINAL_REQUESTED_DELIVERY_DATE) AS SUPPLY_DATE,
        
        UPDATED_AT
      FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line_Tracking\`
      WHERE IS_ACTIVE = TRUE 
        /* 🛡️ SAFETY: Include all valid downstream statuses */
        AND STATUS IN ('ISSUED', 'CONFIRMED', 'DELAYED', 'IN_TRANSIT', 'ARRIVED')
        AND FULFILLMENT_MODE = 'PUBLIC'
        
        /* 🛡️ CRITICAL: The "Lazy User" Protection (Double Count Prevention)
           Rule: If the Effective Supply Date is ON or BEFORE the last Stock Count, 
           we assume it is physically in the warehouse (Part A). So we exclude it here.
           Note: '1990-01-01' handles the "Empty Stock Table" edge case. */
        AND COALESCE(ACTUAL_ARRIVAL_DATE, CURRENT_ETA, AGREED_DELIVERY_DATE, FINAL_REQUESTED_DELIVERY_DATE) > (
           SELECT COALESCE(MAX(SNAPSHOT_DATE), DATE('1990-01-01')) 
           FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Stock_Data\`
        )
  `,
  
  Matching_Engine_VIEW: `
      CREATE OR REPLACE VIEW \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Matching_Engine_VIEW\` AS
      WITH Supply_Ranges AS (
          SELECT 
            -- 🛡️ SAFETY: Sanitize IDs
            TRIM(REPLACE(BOM_UPDATE, '\\r', '')) AS BOM_UPDATE, 
            UNIFIED_ID AS SUPPLY_SOURCE_ID, 
            QTY_AVAILABLE,
            -- FIFO Logic
            SUM(QTY_AVAILABLE) OVER (PARTITION BY TRIM(REPLACE(BOM_UPDATE, '\\r', '')) ORDER BY SUPPLY_DATE ASC, UNIFIED_ID ASC) AS Range_End,
            SUM(QTY_AVAILABLE) OVER (PARTITION BY TRIM(REPLACE(BOM_UPDATE, '\\r', '')) ORDER BY SUPPLY_DATE ASC, UNIFIED_ID ASC) - QTY_AVAILABLE AS Range_Start
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Unified_Supply_Stack_VIEW\`
          WHERE QTY_AVAILABLE > 0 
        ),
        Demand_Ranges AS (
          SELECT 
            TRIM(REPLACE(BOM_UPDATE, '\\r', '')) AS BOM_UPDATE, 
            DEMAND_ID, 
            -- 🟢 ADDED: Pass through VPO for context (Plan Phase 2.1)
            VPO, 
            GROSS_DEMAND_QTY,                                                              -- 🔄 was MATERIAL_DEMANDED
            -- FIFO Logic
            SUM(GROSS_DEMAND_QTY) OVER (PARTITION BY TRIM(REPLACE(BOM_UPDATE, '\\r', '')) ORDER BY REQUESTED_DELIVERY_DATE ASC, DEMAND_ID ASC) AS Range_End,
            SUM(GROSS_DEMAND_QTY) OVER (PARTITION BY TRIM(REPLACE(BOM_UPDATE, '\\r', '')) ORDER BY REQUESTED_DELIVERY_DATE ASC, DEMAND_ID ASC) - GROSS_DEMAND_QTY AS Range_Start
          
          -- 🟢 CRITICAL: Read from the Frozen Snapshot
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Demand_SNAPSHOT\`
          
          WHERE FULFILLMENT_MODE = 'PUBLIC' 
        )
      SELECT 
        D.DEMAND_ID, 
        S.SUPPLY_SOURCE_ID,
        D.BOM_UPDATE, 
        D.VPO, -- 🟢 Persist VPO
        -- Intersection Logic
        GREATEST(0, LEAST(S.Range_End, D.Range_End) - GREATEST(S.Range_Start, D.Range_Start)) AS ALLOCATED_QTY
      FROM Demand_Ranges D
      JOIN Supply_Ranges S
        ON D.BOM_UPDATE = S.BOM_UPDATE
        AND S.Range_Start < D.Range_End
        AND S.Range_End > D.Range_Start;
  `,
  

  // =========================================================
  // 📘 M1: PLANNING LOGIC (The Split Batch Gate)
  // =========================================================
  /* -------------------------------------------------------------------------
  * STORED PROCEDURE: SP_SPLIT_BATCH_GATE
  * -------------------------------------------------------------------------
  * Description: 
  * The Core Traffic Controller. Ingests Drafts (Headers & Lines), 
  * applies SCD Type 2 Versioning, and enforces "Safe Merge" for status.
  * * Changes (Safe Merge Update):
  * - Added 'Current_Status_Snapshot' temp table in Block A.
  * - Modified Block A INSERT to use COALESCE() for COMPLETION_QTY.
  * - Modified Block A INSERT to Auto-Calculate COMPLETION_PERCENT.
  * ------------------------------------------------------------------------- */

  SP_SPLIT_BATCH_GATE: `
    CREATE OR REPLACE PROCEDURE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.SP_SPLIT_BATCH_GATE\`(execution_user STRING)
    BEGIN
      -------------------------------------------------------------------------
      -- BLOCK A: HEADER VERSIONING (SCD Type 2) + SAFE MERGE PROTOCOL 🛡️
      -------------------------------------------------------------------------
      IF EXISTS (SELECT 1 FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order_Draft\`) THEN
        
        -- 1. 🛡️ LIFE RAFT: Capture "Dying" Status before we expire them
        -- This prevents "Empty Draft" uploads from wiping out Production Progress.
        CREATE TEMP TABLE Current_Status_Snapshot AS
        SELECT 
          P.PRODUCTION_ORDER_ID,
          P.COMPLETION_QTY
        FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\` P
        WHERE P.VALID_TO_TS IS NULL -- Only active records
          AND P.PRODUCTION_ORDER_ID IN (SELECT DISTINCT PRODUCTION_ORDER_ID FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order_Draft\`);

        -- 2. Expire Old Active Headers
        UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\`
        SET 
          VALID_TO_TS = CURRENT_TIMESTAMP(),
          UPDATED_BY = execution_user,
          UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE VALID_TO_TS IS NULL
          AND PRODUCTION_ORDER_ID IN (SELECT DISTINCT PRODUCTION_ORDER_ID FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order_Draft\`);

        -- 3. Insert New Active Headers (With Safe Merge Logic)
        INSERT INTO \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\`
        (
          PRODUCTION_ORDER_ID, CUSTOMER, VPO, PO, 
          SKU_NAME_VERSION, SKU_CODE, SKU_DESCRIPTION, SKU_UNIT, 
          RECEIVED_VPO_DATE, 
          FINISHED_GOODS_ORDER_QTY,
          REQUEST_FACTORY_FINISHED_DATE, FINISHED_DATE, EX_FACTORY_DATE, 
          EXPECTED_TIME_OF_DEPARTURE, WORK_IN_PROCESS_START_DATE, PACKAGE_START_DATE, 
          COMPLETION_QTY, COMPLETION_PERCENT, COUNTRY,
          DATA_STATE, UPDATED_BY, UPDATED_AT, VALID_FROM_TS, VALID_TO_TS
        )
        SELECT 
          D.PRODUCTION_ORDER_ID, D.CUSTOMER, D.VPO, D.PO, 
          D.SKU_NAME_VERSION, D.SKU_CODE, D.SKU_DESCRIPTION, D.SKU_UNIT, 
          
          -- Date Parsing (Robust)
          COALESCE(SAFE_CAST(LEFT(D.RECEIVED_VPO_DATE, 10) AS DATE), SAFE.PARSE_DATE('%d-%b-%Y', D.RECEIVED_VPO_DATE), SAFE.PARSE_DATE('%d/%m/%Y', D.RECEIVED_VPO_DATE), SAFE.PARSE_DATE('%Y-%m-%d', D.RECEIVED_VPO_DATE), SAFE_CAST(D.RECEIVED_VPO_DATE AS DATE)),
          SAFE_CAST(REPLACE(CAST(D.FINISHED_GOODS_ORDER_QTY AS STRING), ',', '') AS FLOAT64),
          COALESCE(SAFE_CAST(LEFT(D.REQUEST_FACTORY_FINISHED_DATE, 10) AS DATE), SAFE.PARSE_DATE('%d-%b-%Y', D.REQUEST_FACTORY_FINISHED_DATE), SAFE.PARSE_DATE('%d/%m/%Y', D.REQUEST_FACTORY_FINISHED_DATE), SAFE.PARSE_DATE('%Y-%m-%d', D.REQUEST_FACTORY_FINISHED_DATE), SAFE_CAST(D.REQUEST_FACTORY_FINISHED_DATE AS DATE)),
          COALESCE(SAFE_CAST(LEFT(D.FINISHED_DATE, 10) AS DATE), SAFE.PARSE_DATE('%d-%b-%Y', D.FINISHED_DATE), SAFE.PARSE_DATE('%d/%m/%Y', D.FINISHED_DATE), SAFE.PARSE_DATE('%Y-%m-%d', D.FINISHED_DATE), SAFE_CAST(D.FINISHED_DATE AS DATE)),
          COALESCE(SAFE_CAST(LEFT(D.EX_FACTORY_DATE, 10) AS DATE), SAFE.PARSE_DATE('%d-%b-%Y', D.EX_FACTORY_DATE), SAFE.PARSE_DATE('%d/%m/%Y', D.EX_FACTORY_DATE), SAFE.PARSE_DATE('%Y-%m-%d', D.EX_FACTORY_DATE), SAFE_CAST(D.EX_FACTORY_DATE AS DATE)),
          COALESCE(SAFE_CAST(LEFT(D.EXPECTED_TIME_OF_DEPARTURE, 10) AS DATE), SAFE.PARSE_DATE('%d-%b-%Y', D.EXPECTED_TIME_OF_DEPARTURE), SAFE.PARSE_DATE('%d/%m/%Y', D.EXPECTED_TIME_OF_DEPARTURE), SAFE.PARSE_DATE('%Y-%m-%d', D.EXPECTED_TIME_OF_DEPARTURE), SAFE_CAST(D.EXPECTED_TIME_OF_DEPARTURE AS DATE)),
          COALESCE(SAFE_CAST(LEFT(D.WORK_IN_PROCESS_START_DATE, 10) AS DATE), SAFE.PARSE_DATE('%d-%b-%Y', D.WORK_IN_PROCESS_START_DATE), SAFE.PARSE_DATE('%d/%m/%Y', D.WORK_IN_PROCESS_START_DATE), SAFE.PARSE_DATE('%Y-%m-%d', D.WORK_IN_PROCESS_START_DATE), SAFE_CAST(D.WORK_IN_PROCESS_START_DATE AS DATE)),
          COALESCE(SAFE_CAST(LEFT(D.PACKAGE_START_DATE, 10) AS DATE), SAFE.PARSE_DATE('%d-%b-%Y', D.PACKAGE_START_DATE), SAFE.PARSE_DATE('%d/%m/%Y', D.PACKAGE_START_DATE), SAFE.PARSE_DATE('%Y-%m-%d', D.PACKAGE_START_DATE), SAFE_CAST(D.PACKAGE_START_DATE AS DATE)),
          
          -- 🛡️ COMPLETION QTY LOGIC:
          -- 1. If Draft has explicit number (0 or 500), use it.
          -- 2. If Draft is blank/null, use Snapshot (Previous Value).
          -- 3. If neither, default to 0.
          COALESCE(
             SAFE_CAST(REPLACE(CAST(D.COMPLETION_QTY AS STRING), ',', '') AS FLOAT64), 
             S.COMPLETION_QTY, 
             0
          ) AS FINAL_QTY,

          -- 🛡️ COMPLETION PERCENT LOGIC:
          -- Always Recalculate based on the FINAL_QTY to ensure mathematical truth.
          -- (Don't trust the Excel % column if Qty was merged).
          SAFE_DIVIDE(
             COALESCE(SAFE_CAST(REPLACE(CAST(D.COMPLETION_QTY AS STRING), ',', '') AS FLOAT64), S.COMPLETION_QTY, 0),
             SAFE_CAST(REPLACE(CAST(D.FINISHED_GOODS_ORDER_QTY AS STRING), ',', '') AS FLOAT64)
          ) AS FINAL_PERCENT,

          D.COUNTRY,
          'PROCESSING', 
          execution_user, 
          CURRENT_TIMESTAMP(), 
          CURRENT_TIMESTAMP(), -- VALID_FROM
          CAST(NULL AS TIMESTAMP) -- VALID_TO
        FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order_Draft\` D
        LEFT JOIN Current_Status_Snapshot S ON D.PRODUCTION_ORDER_ID = S.PRODUCTION_ORDER_ID;
      END IF;

      -------------------------------------------------------------------------
      -- BLOCK B: LINE VERSIONING (SCD Type 2)
      -------------------------------------------------------------------------
      IF EXISTS (SELECT 1 FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Order_List_Draft\`) THEN
        
        -- 1. Capture the "Current Batch" of IDs
        CREATE TEMP TABLE Current_Batch_IDs AS
        SELECT DISTINCT 
          REGEXP_REPLACE(PRODUCTION_ORDER_ID, r'[^a-zA-Z0-9-._]', '') AS CLEAN_ID,
          PRODUCTION_ORDER_ID AS RAW_ID
        FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Order_List_Draft\`;

        -- 2. Insert into Staging (With Cleaning)
        INSERT INTO \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Order_List_Staging\`
        (STAGING_ID, PRODUCTION_ORDER_ID, BOM, BOM_UPDATE, BOM_CONSUMPTION, BOM_TOLERANCE, ORDER_LIST_NOTE, VALIDATION_STATUS, UPLOADED_AT)
        SELECT 
          \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.FN_GENERATE_HASH\`(PRODUCTION_ORDER_ID, BOM),
          REGEXP_REPLACE(PRODUCTION_ORDER_ID, r'[^a-zA-Z0-9-._]', ''), 
          TRIM(BOM), 
          TRIM(BOM_UPDATE), 
          SAFE_CAST(BOM_CONSUMPTION AS FLOAT64), 
          SAFE_CAST(BOM_TOLERANCE AS FLOAT64), 
          ORDER_LIST_NOTE, 
          'PENDING', 
          CURRENT_TIMESTAMP()
        FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Order_List_Draft\`;

        -- 3. Validation Logic
        UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Order_List_Staging\` S
        SET VALIDATION_STATUS = CASE WHEN EXISTS (SELECT 1 FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Data\` M WHERE M.BOM_UPDATE = S.BOM_UPDATE) THEN 'PASS' ELSE 'FAIL' END
        WHERE VALIDATION_STATUS = 'PENDING';

        -- 4. Expire Old Active Lines
        UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Order_List_Final\`
        SET 
          VALID_TO_TS = CURRENT_TIMESTAMP(),
          UPDATED_BY = execution_user,
          UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE VALID_TO_TS IS NULL
          AND PRODUCTION_ORDER_ID IN (SELECT CLEAN_ID FROM Current_Batch_IDs);

        -- 5. Promote New Valid Lines
        -- 🛡️ V2 DEDUP GUARD: QUALIFY ensures at most 1 row per (PO, BOM_UPDATE) reaches Final.
        --    Prevents upstream sheet duplicates (repeated BOM rows) from fan-out in demand.
        --    Tie-break: prefer highest BOM_CONSUMPTION, then latest UPLOADED_AT.
        INSERT INTO \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Order_List_Final\`
        (BOM_ORDER_LIST_FINAL_ID, PRODUCTION_ORDER_ID, BOM_UPDATE, BOM_CONSUMPTION, BOM_TOLERANCE, FULFILLMENT_MODE, ORDER_LIST_NOTE, UPDATED_BY, UPDATED_AT, VALID_FROM_TS, VALID_TO_TS)
        SELECT 
          CONCAT('DEM_', \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.FN_GENERATE_HASH\`(S.PRODUCTION_ORDER_ID, M.BOM)), 
          S.PRODUCTION_ORDER_ID, 
          S.BOM_UPDATE, 
          S.BOM_CONSUMPTION, 
          S.BOM_TOLERANCE, 
          CASE 
              WHEN EXISTS (
                  SELECT 1 FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Data\` M 
                  WHERE M.BOM_UPDATE = S.BOM_UPDATE 
                  AND LOWER(TRIM(M.MAIN_GROUP)) = 'bao bì'
              ) THEN 'PRIVATE' 
              ELSE 'PUBLIC' 
          END, 
          S.ORDER_LIST_NOTE, 
          execution_user, 
          CURRENT_TIMESTAMP(), 
          CURRENT_TIMESTAMP(), 
          CAST(NULL AS TIMESTAMP)                 
        FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Order_List_Staging\` S
        LEFT JOIN \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Data\` M 
           ON S.BOM_UPDATE = M.BOM_UPDATE
        WHERE S.VALIDATION_STATUS = 'PASS' 
          AND S.PRODUCTION_ORDER_ID IN (SELECT CLEAN_ID FROM Current_Batch_IDs)
          AND S.UPLOADED_AT > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 5 MINUTE)
        QUALIFY ROW_NUMBER() OVER (
          PARTITION BY S.PRODUCTION_ORDER_ID, S.BOM_UPDATE
          ORDER BY COALESCE(S.BOM_CONSUMPTION, 0) DESC, S.UPLOADED_AT DESC
        ) = 1;

        -- 6. Create Skeletons
        INSERT INTO \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Data_Staging\`
        (BOM_UPDATE, BOM, SOURCE, INGESTED_AT, BOM_STATUS)
        SELECT DISTINCT S.BOM_UPDATE, S.BOM, 'AUTO_SKELETON', CURRENT_TIMESTAMP(), 'PENDING_DEFINITION'
        FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Order_List_Staging\` S
        WHERE S.VALIDATION_STATUS = 'FAIL'
          AND NOT EXISTS (SELECT 1 FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Data\` M WHERE M.BOM_UPDATE = S.BOM_UPDATE)
          AND NOT EXISTS (SELECT 1 FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Data_Staging\` SK WHERE SK.BOM_UPDATE = S.BOM_UPDATE);
      END IF;

      -------------------------------------------------------------------------
      -- BLOCK C: STATUS RE-EVALUATION
      -------------------------------------------------------------------------
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\` Target
      SET 
          DATA_STATE = Source.Calculated_State,
          UPDATED_AT = CURRENT_TIMESTAMP(),
          UPDATED_BY = execution_user
      FROM (
          SELECT 
              Touched.PRODUCTION_ORDER_ID,
              CASE 
                  WHEN COUNT(True_Failures.BOM_UPDATE) > 0 THEN 'PARTIALLY_RELEASED'
                  ELSE 'RELEASED'
              END AS Calculated_State
          FROM (
              SELECT DISTINCT PRODUCTION_ORDER_ID FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Order_List_Draft\`
              UNION DISTINCT 
              SELECT DISTINCT PRODUCTION_ORDER_ID FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order_Draft\`
          ) Touched
          LEFT JOIN (
             SELECT S.PRODUCTION_ORDER_ID, S.BOM_UPDATE
             FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Order_List_Staging\` S
             LEFT JOIN \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Order_List_Final\` F
               ON S.PRODUCTION_ORDER_ID = F.PRODUCTION_ORDER_ID
               AND S.BOM_UPDATE = F.BOM_UPDATE
               AND F.VALID_TO_TS IS NULL 
             WHERE S.VALIDATION_STATUS = 'FAIL'
               AND F.BOM_UPDATE IS NULL
          ) True_Failures
          ON Touched.PRODUCTION_ORDER_ID = True_Failures.PRODUCTION_ORDER_ID
          GROUP BY Touched.PRODUCTION_ORDER_ID
      ) Source
      WHERE Target.PRODUCTION_ORDER_ID = Source.PRODUCTION_ORDER_ID
        AND Target.VALID_TO_TS IS NULL;

      -------------------------------------------------------------------------
      -- BLOCK D: CLEANUP
      -------------------------------------------------------------------------
      TRUNCATE TABLE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order_Draft\`;
      TRUNCATE TABLE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Order_List_Draft\`;
    END;
  `,
  // =========================================================
  // 🔭 M1: DATA STEWARD VIEWS (The Fetch Feeds)
  // =========================================================
  View_Skeleton_Feed: `
      CREATE OR REPLACE VIEW \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.View_Skeleton_Feed\` AS
      WITH Family_Template AS (
        SELECT 
          BOM, 
          ANY_VALUE(PIC) AS Suggested_PIC,
          ANY_VALUE(MAIN_GROUP) AS Suggested_MAIN_GROUP,
          ANY_VALUE(SUB_GROUP) AS Suggested_SUB_GROUP,
          ANY_VALUE(BOM_UNIT) AS Suggested_BOM_UNIT
        FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Data\`
        GROUP BY BOM
      )
      SELECT 
        S.BOM_UPDATE,
        S.BOM,
        COALESCE(S.PIC, T.Suggested_PIC) AS PIC,
        COALESCE(S.MAIN_GROUP, T.Suggested_MAIN_GROUP) AS MAIN_GROUP,
        COALESCE(S.SUB_GROUP, T.Suggested_SUB_GROUP) AS SUB_GROUP,
        COALESCE(S.BOM_UNIT, T.Suggested_BOM_UNIT) AS BOM_UNIT,
        S.SOURCE,
        S.BOM_DESCRIPTION,
        S.BOM_VIETNAMESE_DESCRIPTION
      FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Data_Staging\` S
      LEFT JOIN Family_Template T
        ON S.BOM = T.BOM
      WHERE S.SOURCE = 'AUTO_SKELETON'
      ORDER BY S.INGESTED_AT ASC
  `,

  SP_M1_MASTER_MERGE: `
      CREATE OR REPLACE PROCEDURE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.SP_M1_MASTER_MERGE\`(execution_user STRING)
      BEGIN
        -- ========================================================================================
        -- PART 1: HEAL THE MASTER DATA (SCD1 - Update In Place)
        -- ========================================================================================
        MERGE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Data\` T
        USING (
          SELECT * EXCEPT(rn)
          FROM (
            SELECT *,
              ROW_NUMBER() OVER (
                PARTITION BY BOM_UPDATE
                ORDER BY CASE WHEN BOM_DESCRIPTION IS NOT NULL AND BOM_DESCRIPTION != '' THEN 1 ELSE 2 END ASC,
                  INGESTED_AT ASC 
              ) as rn
            FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Data_Staging\`
          )
          WHERE rn = 1
        ) S
        ON T.BOM_UPDATE = S.BOM_UPDATE
      
        WHEN MATCHED THEN
          UPDATE SET
            T.BOM = S.BOM,
            T.PIC = S.PIC,
            T.MAIN_GROUP = S.MAIN_GROUP,
            T.SUB_GROUP = S.SUB_GROUP,
            T.BOM_DESCRIPTION = S.BOM_DESCRIPTION,
            T.BOM_VIETNAMESE_DESCRIPTION = S.BOM_VIETNAMESE_DESCRIPTION,
            T.BOM_UNIT = S.BOM_UNIT,
            T.BOM_STATUS = 'ACTIVE',
            T.UPDATED_BY = execution_user,
            T.UPDATED_AT = CURRENT_TIMESTAMP()
            
        WHEN NOT MATCHED THEN
          INSERT (
            BOM_UPDATE, BOM, PIC, MAIN_GROUP, SUB_GROUP, 
            BOM_DESCRIPTION, BOM_VIETNAMESE_DESCRIPTION, BOM_UNIT, BOM_STATUS,
            UPDATED_BY, UPDATED_AT
          )
          VALUES (
            S.BOM_UPDATE, S.BOM, S.PIC, S.MAIN_GROUP, S.SUB_GROUP, 
            S.BOM_DESCRIPTION, S.BOM_VIETNAMESE_DESCRIPTION, S.BOM_UNIT, 'ACTIVE',
            execution_user, 
            CURRENT_TIMESTAMP()
          );

        -- ========================================================================================
        -- PART 2: RESURRECT THE DEAD ORDERS (The Reactive Fix)
        -- ========================================================================================
        
        -- A. Find Staging Rows that failed before but are VALID now
        CREATE TEMP TABLE Resurrected_Items AS
        SELECT *
        FROM (
            SELECT 
                S.STAGING_ID, 
                S.PRODUCTION_ORDER_ID, 
                S.BOM_UPDATE,
                S.BOM_CONSUMPTION,
                S.BOM_TOLERANCE,
                -- 🟡 RENAMED from NOTE
                S.ORDER_LIST_NOTE 
            FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Order_List_Staging\` S
            WHERE S.VALIDATION_STATUS = 'FAIL'
              AND EXISTS (SELECT 1 FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Data\` M WHERE M.BOM_UPDATE = S.BOM_UPDATE)
              AND NOT EXISTS (
                SELECT 1 FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Order_List_Final\` F 
                WHERE F.PRODUCTION_ORDER_ID = S.PRODUCTION_ORDER_ID AND F.BOM_UPDATE = S.BOM_UPDATE
                  AND F.VALID_TO_TS IS NULL  -- 🛡️ V2 FIX: Only block if an ACTIVE row exists (not expired ones)
              )
        )
        QUALIFY ROW_NUMBER() OVER (PARTITION BY PRODUCTION_ORDER_ID, BOM_UPDATE ORDER BY STAGING_ID DESC) = 1;

        -- B. Promote them to Final
        -- 🟢 UPDATED: Uses MD5 Identity, Order List Note, Removed DateCode
        INSERT INTO \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Order_List_Final\`
        (BOM_ORDER_LIST_FINAL_ID, PRODUCTION_ORDER_ID, BOM_UPDATE, BOM_CONSUMPTION, BOM_TOLERANCE, FULFILLMENT_MODE, ORDER_LIST_NOTE, UPDATED_BY, UPDATED_AT, VALID_FROM_TS)
        SELECT 
            -- 🟢 Identity Generation (Matching Batch Gate)
            CONCAT('DEM_', \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.FN_GENERATE_HASH\`(R.PRODUCTION_ORDER_ID, M.BOM)), 
            R.PRODUCTION_ORDER_ID, 
            R.BOM_UPDATE, 
            R.BOM_CONSUMPTION, 
            R.BOM_TOLERANCE, 
            CASE WHEN EXISTS (SELECT 1 FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Data\` M WHERE M.BOM_UPDATE = R.BOM_UPDATE AND M.MAIN_GROUP = 'Bao Bì') THEN 'PRIVATE' ELSE 'PUBLIC' END, 
            R.ORDER_LIST_NOTE, 
            execution_user, 
            CURRENT_TIMESTAMP(), 
            CURRENT_TIMESTAMP()
        FROM Resurrected_Items R
        LEFT JOIN \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Data\` M 
             ON R.BOM_UPDATE = M.BOM_UPDATE;

        -- C. Update Staging Status (Audit Trail)
        UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Order_List_Staging\` S
        SET VALIDATION_STATUS = 'PASS_RETROACTIVE'
        WHERE STAGING_ID IN (SELECT STAGING_ID FROM Resurrected_Items);

        -- ========================================================================================
        -- PART 3: FLIP THE HEADER STATUS (De-Correlated Update)
        -- ========================================================================================
        
        UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\` Target
        SET 
            DATA_STATE = Source.Calculated_State,
            UPDATED_AT = CURRENT_TIMESTAMP(),
            UPDATED_BY = execution_user
        FROM (
            SELECT 
                Touched.PRODUCTION_ORDER_ID,
                CASE 
                    WHEN COUNT(True_Failures.BOM_UPDATE) > 0 THEN 'PARTIALLY_RELEASED'
                    ELSE 'RELEASED'
                END AS Calculated_State
            FROM (
                SELECT DISTINCT PRODUCTION_ORDER_ID FROM Resurrected_Items
            ) Touched
            LEFT JOIN (
               SELECT S.PRODUCTION_ORDER_ID, S.BOM_UPDATE
                FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Order_List_Staging\` S
                LEFT JOIN \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Order_List_Final\` F
                  ON S.PRODUCTION_ORDER_ID = F.PRODUCTION_ORDER_ID
                  AND S.BOM_UPDATE = F.BOM_UPDATE
                WHERE S.VALIDATION_STATUS = 'FAIL'
                  AND F.BOM_UPDATE IS NULL
            ) True_Failures
            ON Touched.PRODUCTION_ORDER_ID = True_Failures.PRODUCTION_ORDER_ID
            GROUP BY Touched.PRODUCTION_ORDER_ID
        ) Source
        WHERE Target.PRODUCTION_ORDER_ID = Source.PRODUCTION_ORDER_ID;

        -- ========================================================================================
        -- PART 4: CLEANUP
        -- ========================================================================================
        TRUNCATE TABLE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Data_Staging\`;
      END;
  `,

  // =========================================================
  // 🔭 M1: VIRTUAL DEMAND ENGINE (SCD2 Ready)
  // =========================================================
  Material_Demand_VIEW: `
    CREATE OR REPLACE VIEW \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Demand_VIEW\` AS
    SELECT
        -- ═══════════════════════════════════════════════════════════════════
        -- SECTION A: IDENTITY (Unchanged)
        -- ═══════════════════════════════════════════════════════════════════
        L.BOM_ORDER_LIST_FINAL_ID AS DEMAND_ID,
        P.PRODUCTION_ORDER_ID,
        L.BOM_UPDATE,
        L.FULFILLMENT_MODE,

        -- 🟢 EXPOSED: VPO & Note for Engine
        P.VPO,
        L.ORDER_LIST_NOTE,

        P.SKU_CODE,

        -- 🟢 FIX: Material must arrive 7 days BEFORE production starts
        DATE_SUB(P.WORK_IN_PROCESS_START_DATE, INTERVAL 7 DAY) AS REQUESTED_DELIVERY_DATE,
        P.RECEIVED_VPO_DATE,

        -- ═══════════════════════════════════════════════════════════════════
        -- SECTION B: CLASSIFICATION (From BOM_Data JOIN — Phase 1 Addition)
        -- ═══════════════════════════════════════════════════════════════════
        B.MAIN_GROUP,
        B.SUB_GROUP,
        B.PIC,

        -- ═══════════════════════════════════════════════════════════════════
        -- SECTION C: DUAL-METHOD DEMAND (The Core of Phase 1)
        -- ═══════════════════════════════════════════════════════════════════

        -- METHOD 1: COMPLETION (existing logic — unchanged)
        -- Formula: (Ordered - Built) × Consumption × (1 + Tolerance)
        (GREATEST(0, P.FINISHED_GOODS_ORDER_QTY - COALESCE(P.COMPLETION_QTY, 0))
          * L.BOM_CONSUMPTION) * (1 + L.BOM_TOLERANCE) AS GROSS_DEMAND_COMPLETION_METHOD,

        -- METHOD 2: ISSUANCE (new — reads from Material_Issuance)
        -- Formula: Full_MRP_Qty - Already_Issued_Qty
        -- Falls back to ZERO (not null) if no issuance data available yet.
        GREATEST(0,
          (P.FINISHED_GOODS_ORDER_QTY * L.BOM_CONSUMPTION * (1 + L.BOM_TOLERANCE))
          - COALESCE(I.CUMULATIVE_ISSUANCE_QTY, 0)
        ) AS GROSS_DEMAND_ISSUANCE_METHOD,

        -- ACTIVE COLUMN: GROSS_DEMAND_QTY
        -- Phase 7: Auto-switches to ISSUANCE for configured material groups
        --          when issuance data exists. Defaults to COMPLETION otherwise.
        CASE
          WHEN MOC.IS_ACTIVE = TRUE
           AND MOC.PREFERRED_METHOD = 'ISSUANCE'
           AND I.CUMULATIVE_ISSUANCE_QTY IS NOT NULL
          THEN GREATEST(0,
            (P.FINISHED_GOODS_ORDER_QTY * L.BOM_CONSUMPTION * (1 + L.BOM_TOLERANCE))
            - COALESCE(I.CUMULATIVE_ISSUANCE_QTY, 0)
          )
          ELSE (GREATEST(0, P.FINISHED_GOODS_ORDER_QTY - COALESCE(P.COMPLETION_QTY, 0))
            * L.BOM_CONSUMPTION) * (1 + L.BOM_TOLERANCE)
        END AS GROSS_DEMAND_QTY,

        -- ═══════════════════════════════════════════════════════════════════
        -- SECTION D: SYSTEM FLAGS
        -- ═══════════════════════════════════════════════════════════════════

        -- HAS_ISSUANCE_DATA: TRUE when Material_Issuance has a record for this BOM+VPO.
        -- Used by dialog (Phase 5) to warn PICs when issuance data is missing.
        (I.ISSUANCE_ID IS NOT NULL) AS HAS_ISSUANCE_DATA,

        -- CALC_METHOD_USED: Which method GROSS_DEMAND_QTY is currently using.
        -- Phase 7: Auto-detects per material group via Method_Override_Config.
        CASE
          WHEN MOC.IS_ACTIVE = TRUE
           AND MOC.PREFERRED_METHOD = 'ISSUANCE'
           AND I.CUMULATIVE_ISSUANCE_QTY IS NOT NULL
          THEN 'ISSUANCE'
          ELSE 'COMPLETION'
        END AS CALC_METHOD_USED,

        CURRENT_TIMESTAMP() AS CALCULATED_AT

    FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\` P
    JOIN \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Order_List_Final\` L
      ON P.PRODUCTION_ORDER_ID = L.PRODUCTION_ORDER_ID

    -- 🆕 CLASSIFICATION JOIN: Read MAIN_GROUP, SUB_GROUP, PIC from BOM master
    LEFT JOIN \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Data\` B
      ON L.BOM_UPDATE = B.BOM_UPDATE

    -- 🆕 ISSUANCE JOIN: Bring in warehouse issuance data (NULL until Phase 3 syncs)
    LEFT JOIN \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Issuance\` I
      ON L.BOM_UPDATE = I.BOM_UPDATE
     AND P.VPO        = I.VPO

    -- 🆕 PHASE 7: METHOD CONFIG JOIN — Override default method per material group
    LEFT JOIN \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Method_Override_Config\` MOC
      ON B.MAIN_GROUP = MOC.MAIN_GROUP
      AND MOC.IS_ACTIVE = TRUE

    -- ═══════════════════════════════════════════════════════════════════
    -- 🛡️ ACTIVE SHIELD (Unchanged from previous version)
    -- ═══════════════════════════════════════════════════════════════════
    WHERE P.VALID_TO_TS IS NULL
      AND L.VALID_TO_TS IS NULL

    -- 🛡️ V6 CRITICAL FIX: Exclude terminal states from demand calculation
    -- Only these specific Active states generate demand.
    -- CANCELLED and COMPLETED are strictly excluded.
    AND P.DATA_STATE IN ('RELEASED', 'PARTIALLY_RELEASED', 'PROCESSING')

    -- 🛡️ GATE 2: PHYSICAL COMPLETION (Belt-and-Suspenders)
    AND COALESCE(P.COMPLETION_PERCENT, 0) < 0.99

    -- 🛡️ GATE 3: ZOMBIE PROTECTION (The Dead Order Check)
    AND P.REQUEST_FACTORY_FINISHED_DATE >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY)
  `,


  // =========================================================
  // 🔭 M1: Material Demand Snapshot
  // =========================================================
  Material_Demand_SNAPSHOT: `
      CREATE OR REPLACE TABLE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Demand_SNAPSHOT\`
      AS SELECT * FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Demand_VIEW\`
      LIMIT 0;
  `,


  // =========================================================
  // 📊 MODULE 1: PRODUCTION STATUS (V5.0)
  // =========================================================

  // VIEW 1: The "Ghost Calculator"
  // Purpose: Sums up all "Finished" or "Cancelled" quantities by VPO.
  // Logic: This tells the system "How many units have we already made for this VPO in the past?"
  Closed_Order_Ghost_VIEW: `
      CREATE OR REPLACE VIEW \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Closed_Order_Ghost_VIEW\` AS
      SELECT 
        VPO,
        SUM(COALESCE(COMPLETION_QTY, 0)) AS GHOST_QUANTITY,
        COUNT(*) AS CLOSED_ORDER_COUNT,
        MAX(UPDATED_AT) AS LAST_CLOSED_AT
      FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\`
      WHERE VALID_TO_TS IS NULL
        AND DATA_STATE IN ('COMPLETED', 'CANCELLED')
        AND COALESCE(COMPLETION_QTY, 0) > 0
      GROUP BY VPO;
  `,

  // VIEW 2: The "Portal Feed"
  // Purpose: Shows ONLY active orders to the Manual Portal.
  // Logic: 
  // 1. Filters out 'COMPLETED' orders (>= 99%).
  // 2. Adds the 'GHOST_CONTEXT' column so managers can see context ("Oh, we already made 1000 of these").
  Production_Status_Portal_VIEW: `
      CREATE OR REPLACE VIEW \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Status_Portal_VIEW\` AS
      SELECT 
        P.PRODUCTION_ORDER_ID,
        P.VPO,
        P.CUSTOMER,
        P.SKU_NAME_VERSION,
        P.SKU_CODE,
        P.FINISHED_GOODS_ORDER_QTY, -- ⭐ STRICT CONSISTENCY: Was aliased as ORDER_QTY
        COALESCE(P.COMPLETION_QTY, 0) AS CURRENT_COMPLETION_QTY,
        ROUND(COALESCE(P.COMPLETION_PERCENT, 0) * 100, 1) AS CURRENT_PERCENT,
        P.REQUEST_FACTORY_FINISHED_DATE AS FFD,
        P.EX_FACTORY_DATE,
        P.DATA_STATE,
        
        -- Visual Status Notes for the User
        CASE 
          WHEN P.DATA_STATE = 'PARTIALLY_RELEASED' THEN '⚠️ Missing BOM Items'
          WHEN P.DATA_STATE = 'PROCESSING' THEN '🔄 Processing'
          ELSE ''
        END AS STATUS_NOTE,
        
        -- ⭐ GHOST CONTEXT: Subquery to show previously closed quantities
        (
          SELECT COALESCE(SUM(COMPLETION_QTY), 0)
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\` C
          WHERE C.VPO = P.VPO
            AND C.DATA_STATE IN ('COMPLETED', 'CANCELLED')
            AND COALESCE(C.COMPLETION_QTY, 0) > 0
            AND C.VALID_TO_TS IS NULL
        ) AS GHOST_CONTEXT, -- ⭐ STRICT CONSISTENCY: Was aliased as VPO_CLOSED_QTY
        
        P.UPDATED_AT AS LAST_SYSTEM_UPDATE

      FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\` P
      WHERE P.VALID_TO_TS IS NULL
        AND P.DATA_STATE IN ('RELEASED', 'PARTIALLY_RELEASED', 'PROCESSING')
        -- Logic: Only show orders that are NOT yet complete
        AND COALESCE(P.COMPLETION_PERCENT, 0) < 0.99
      ORDER BY VPO ASC, SKU_NAME_VERSION ASC, FFD ASC;
  `,


  // =========================================================
  // 🛑 ADMIN REPORTING VIEWS (V6.0)
  // =========================================================
  
  // VIEW 1: Full History of Cancellations
  Cancelled_Orders_Alert_VIEW: `
      CREATE OR REPLACE VIEW \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Cancelled_Orders_Alert_VIEW\` AS
      SELECT 
        -- Order Identity
        P.PRODUCTION_ORDER_ID,
        P.VPO,
        P.CUSTOMER,
        P.SKU_NAME_VERSION,
        P.SKU_CODE,
        
        -- Quantities
        P.FINISHED_GOODS_ORDER_QTY AS ORIGINAL_ORDER_QTY,
        P.FORCE_CLOSE_QTY AS FINAL_COMPLETION_QTY,
        ROUND(SAFE_DIVIDE(P.FORCE_CLOSE_QTY, P.FINISHED_GOODS_ORDER_QTY) * 100, 1) AS PERCENT_AT_CANCEL,
        
        -- Cancellation Details
        P.CANCELLATION_REASON,
        P.CANCELLED_BY,
        P.CANCELLED_AT,
        
        TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), P.CANCELLED_AT, HOUR) AS HOURS_SINCE_CANCEL,
        
        -- Downstream Impact Indicators (Live Count)
        (
          SELECT COUNT(*) 
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_Final\` PR
          WHERE PR.VPO = P.VPO 
            AND PR.CONSOLIDATION_STATUS = 'OPEN'
        ) AS ORPHANED_PR_COUNT,
        
        (
          SELECT COUNT(*) 
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line_Tracking\` PLT
          WHERE PLT.VPO = P.VPO 
            AND PLT.IS_ACTIVE = TRUE
        ) AS ACTIVE_PO_LINES_COUNT,
        
        (
          SELECT COUNT(*) 
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line_Tracking\` PLT
          WHERE PLT.VPO = P.VPO 
            AND PLT.IS_ACTIVE = TRUE 
            AND PLT.FULFILLMENT_MODE = 'PRIVATE'
        ) AS PRIVATE_PO_LINES_COUNT
        
      FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\` P
      WHERE P.VALID_TO_TS IS NULL
        AND P.DATA_STATE = 'CANCELLED'
      ORDER BY P.CANCELLED_AT DESC
  `,



  Orphaned_Supply_Report_VIEW: `
    CREATE OR REPLACE VIEW \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Orphaned_Supply_Report_VIEW\` AS
    SELECT 
      -- PO Line Identity
      PLT.PO_LINE_ID,
      PLT.PO_DOCUMENT_ID,
      PLT.BOM_UPDATE,
      PLT.VPO,
      PLT.FULFILLMENT_MODE,
      PLT.PIC,
      
      -- Quantities
      PLT.ORDER_QTY,
      COALESCE(PLT.CONFIRMED_QTY, PLT.ORDER_QTY) AS EXPECTED_QTY,
      PLT.LOADED_QTY,
      PLT.ACTUAL_RECEIVED_QTY,
      
      -- PO Status
      PLT.STATUS AS PO_STATUS,
      PLT.CURRENT_ETA,
      PLT.AGREED_DELIVERY_DATE,
      
      -- Linked Order Context
      P.PRODUCTION_ORDER_ID,
      P.SKU_CODE,
      P.SKU_NAME_VERSION,
      P.DATA_STATE AS ORDER_STATE,
      P.CANCELLATION_REASON,
      P.CANCELLED_AT,
      P.CANCELLED_BY,
      
      -- ═══════════════════════════════════════════════════════════════════
      -- Risk Assessment Logic
      -- ═══════════════════════════════════════════════════════════════════
      CASE 
        WHEN PLT.FULFILLMENT_MODE = 'PRIVATE' AND PLT.STATUS = 'IN_TRANSIT' 
          THEN '🔴 CRITICAL: PRIVATE in-transit, cannot reallocate'
        WHEN PLT.FULFILLMENT_MODE = 'PRIVATE' AND PLT.STATUS IN ('ISSUED', 'CONFIRMED') 
          THEN '🔴 HIGH: PRIVATE not shipped, cancel with supplier'
        WHEN PLT.FULFILLMENT_MODE = 'PRIVATE' AND PLT.STATUS = 'ARRIVED' 
          THEN '🔴 HIGH: PRIVATE arrived, dead stock or return'
        WHEN PLT.STATUS = 'IN_TRANSIT' 
          THEN '🟡 MEDIUM: PUBLIC in-transit, can reallocate on arrival'
        WHEN PLT.STATUS IN ('ISSUED', 'CONFIRMED') 
          THEN '🟢 LOW: PUBLIC not shipped, can cancel or reallocate'
        WHEN PLT.STATUS = 'ARRIVED' 
          THEN '🟢 LOW: PUBLIC arrived, will auto-reallocate in M2'
        ELSE '⚪ ASSESS: Manual review required'
      END AS RISK_LEVEL,
      
      CASE 
        WHEN PLT.FULFILLMENT_MODE = 'PRIVATE' 
          THEN 'Contact supplier: CANCEL / RETURN / ACCEPT_DEAD_STOCK'
        WHEN PLT.STATUS IN ('ISSUED', 'CONFIRMED') 
          THEN 'Option: Cancel PO line OR let arrive for general stock'
        WHEN PLT.STATUS = 'IN_TRANSIT' 
          THEN 'Let arrive, M2 will reallocate to other demand'
        WHEN PLT.STATUS = 'ARRIVED' 
          THEN 'No action needed, M2 handles reallocation'
        ELSE 'Manual review required'
      END AS RECOMMENDED_ACTION
      
    FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line_Tracking\` PLT
    JOIN \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\` P 
      ON PLT.VPO = P.VPO
    WHERE P.VALID_TO_TS IS NULL
      AND P.DATA_STATE = 'CANCELLED'
      AND PLT.IS_ACTIVE = TRUE
    ORDER BY 
      -- PRIVATE first (highest risk)
      CASE WHEN PLT.FULFILLMENT_MODE = 'PRIVATE' THEN 0 ELSE 1 END,
      -- Then by urgency (in-transit before issued)
      CASE PLT.STATUS 
        WHEN 'IN_TRANSIT' THEN 1 
        WHEN 'ARRIVED' THEN 2 
        WHEN 'CONFIRMED' THEN 3 
        WHEN 'ISSUED' THEN 4 
        ELSE 5 
      END,
      PLT.CURRENT_ETA ASC
  `,

  // =========================================================
  // 🧹 MIGRATION UTILITIES (Phase -1)
  // =========================================================
  SP_MIGRATE_HISTORICAL_STATES: `
    CREATE OR REPLACE PROCEDURE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.SP_MIGRATE_HISTORICAL_STATES\`(
      p_execution_user STRING
    )
    BEGIN
      DECLARE v_migrated_count INT64;
      DECLARE v_completion_threshold FLOAT64 DEFAULT 0.99;
      
      -- UPDATE: Transition 99%+ orders to COMPLETED
      -- SAFETY: Explicitly ignores "Zombie Orders" (0% completion)
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\`
      SET 
        DATA_STATE = 'COMPLETED',
        UPDATED_BY = CONCAT('MIGRATION:', p_execution_user),
        UPDATED_AT = CURRENT_TIMESTAMP()
      WHERE VALID_TO_TS IS NULL
        AND DATA_STATE IN ('RELEASED', 'PARTIALLY_RELEASED', 'PROCESSING')
        AND SAFE_DIVIDE(COMPLETION_QTY, FINISHED_GOODS_ORDER_QTY) >= v_completion_threshold;

      SET v_migrated_count = @@row_count;
      
      -- OUTPUT: Summary of what happened
      SELECT 
        'SP_MIGRATE_HISTORICAL_STATES' AS PROCEDURE_NAME,
        'V5.0' AS VERSION,
        v_migrated_count AS ORDERS_MIGRATED,
        CURRENT_TIMESTAMP() AS COMPLETED_AT;
    END;
  `,

  // =========================================================
  // 🧹 CLEANUP: SUPERSEDED ORDERS (V15.0 Ghostbuster)
  // =========================================================
  SP_CLEANUP_SUPERSEDED_ORDERS: `
      CREATE OR REPLACE PROCEDURE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.SP_CLEANUP_SUPERSEDED_ORDERS\`(target_vpo STRING)
      BEGIN
        -- Safe Scope: Only touches the specific VPO being resolved
        -- Logic: Expire 'Parent' ID if a 'Child' ID exists
        
        UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\` Parent
        SET 
          VALID_TO_TS = CURRENT_TIMESTAMP(), 
          UPDATED_BY = 'AUTO_CLEANUP',
          UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE VPO = target_vpo
          AND VALID_TO_TS IS NULL
          AND EXISTS (
            SELECT 1 FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\` Child
            WHERE Child.VPO = target_vpo
              AND Child.VALID_TO_TS IS NULL
              -- STRICT PARENT CHECK: Child must start with Parent + '.'
              AND Child.PRODUCTION_ORDER_ID LIKE CONCAT(Parent.PRODUCTION_ORDER_ID, '.%')
          );
      END;
  `,

  // =========================================================
  // 🧩 M1: CS RESOLUTION ENGINE (V15.0 Sniper Edition)
  // * RESPONSIBILITY: 
  //   1. Reads Planner intent from CS_Resolution_Staging.
  //   2. Updates Master Data (Production_Order) with ID Precision.
  //   3. Closes the associated Alert (CS_Status_Discrepancy_Log).
  // =========================================================
  SP_CS_RESOLUTION: `
    CREATE OR REPLACE PROCEDURE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.SP_CS_RESOLUTION\`()
    BEGIN
      -- ════════════════════════════════════════════════════════════════════════════
      -- SP_CS_RESOLUTION V15.1 — "Sniper + Ghostbuster" Edition
      -- 
      -- KEY V15 UPGRADES:
      -- 1. SAFETY VALVE: Blocks 'ACCEPT_CS' on Multi-Order VPOs (Prevents Data Loss).
      -- 2. SNIPER TARGETING: Updates are joined by PRODUCTION_ORDER_ID, not VPO.
      -- 3. SPLIT UNLOCK: Allows Qty updates on Multi-Order IF a specific ID is targeted.
      -- 4. GHOSTBUSTER: Auto-cleans superseded version parents after resolution.
      -- ════════════════════════════════════════════════════════════════════════════

      -- STEP 1: IDENTIFY BATCH (Deduplication Layer)
      CREATE TEMP TABLE Resolution_Batch AS
      SELECT * EXCEPT(rn)
      FROM (
        SELECT *, ROW_NUMBER() OVER(PARTITION BY RESOLUTION_ID ORDER BY CREATED_AT DESC) as rn
        FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.CS_Resolution_Staging\`
        WHERE VALIDATION_STATUS = 'PENDING'
      ) WHERE rn = 1;

      -- STEP 2: VALIDATION GATE (V15 Safety Logic)
      CREATE TEMP TABLE Resolution_Validated AS
      SELECT 
        S.*,
        -- Count active orders for context (Log only, logic uses IS_MULTI_ORDER)
        (SELECT COUNT(*) 
         FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\` P 
         WHERE P.VPO = S.VPO AND P.VALID_TO_TS IS NULL 
           AND P.DATA_STATE IN ('RELEASED', 'PARTIALLY_RELEASED', 'PROCESSING')
        ) as ORDER_COUNT,
        CASE 
          -- Rule 1: Quantity cannot be negative
          WHEN S.TARGET_ORDER_QTY IS NOT NULL AND S.TARGET_ORDER_QTY < 0 
            THEN 'ERROR: Negative Quantity'
          
          -- Rule 2: Date sanity check
          WHEN S.TARGET_FFD IS NOT NULL AND S.TARGET_FFD < DATE('2024-01-01') 
            THEN 'ERROR: Date too old (Must be > 2024)'
          
          -- [V15 NEW] Rule 3: THE SAFETY VALVE
          -- Block "Accept CS" on Split Batches because it is ambiguous which split to map to.
          WHEN S.RESOLUTION_SOURCE = 'ACCEPT_CS' AND S.IS_MULTI_ORDER = TRUE 
            THEN 'ERROR: Ambiguous Action. Cannot "Accept CS" on Split Batch. Use Manual Override to target specific ID.'
          
          -- [V15 NEW] Rule 4: SNIPER REQUIREMENT
          -- If updating a Multi-Order VPO, we MUST have a valid System ID.
          WHEN S.IS_MULTI_ORDER = TRUE AND (S.PRODUCTION_ORDER_ID IS NULL OR S.PRODUCTION_ORDER_ID = 'MISMATCH')
            THEN 'ERROR: Target Lost. Cannot update Multi-Order VPO without a valid System link.'

          ELSE 'VALID'
        END as CHECK_RESULT
      FROM Resolution_Batch S;

      -- STEP 3: REJECT BAD DATA
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.CS_Resolution_Staging\` T
      SET 
        VALIDATION_STATUS = 'ERROR', 
        ERROR_MESSAGE = V.CHECK_RESULT, 
        PROCESSED_AT = CURRENT_TIMESTAMP()
      FROM Resolution_Validated V
      WHERE T.RESOLUTION_ID = V.RESOLUTION_ID AND V.CHECK_RESULT != 'VALID';

      -- ════════════════════════════════════════════════════════════════════════════
      -- STEP 4A: EXECUTE - UPDATE DATE (V15: SNIPER MODE)
      -- Logic: Update ONLY the specific Production Order ID targeted by the resolution.
      -- Prevents "Broadcasting" dates across Mixed Mode (Air/Sea) splits.
      -- ════════════════════════════════════════════════════════════════════════════
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\` T
      SET 
        REQUEST_FACTORY_FINISHED_DATE = S.TARGET_FFD,
        UPDATED_BY = CONCAT('CS_RES_DATE:', S.RESOLVED_BY),
        UPDATED_AT = CURRENT_TIMESTAMP()
      FROM Resolution_Validated S
      WHERE T.PRODUCTION_ORDER_ID = S.PRODUCTION_ORDER_ID -- 👈 V15: EXACT ID MATCH
        AND T.VALID_TO_TS IS NULL
        AND T.DATA_STATE IN ('RELEASED', 'PARTIALLY_RELEASED', 'PROCESSING')
        AND S.CHECK_RESULT = 'VALID'
        AND S.TARGET_FFD IS NOT NULL;

      -- ════════════════════════════════════════════════════════════════════════════
      -- STEP 4B: EXECUTE - UPDATE QTY (V15: PRECISION UNLOCK)
      -- Logic: Allow Qty updates on Multi-Order VPOs *IF* ID is validated.
      -- ════════════════════════════════════════════════════════════════════════════
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\` T
      SET 
        FINISHED_GOODS_ORDER_QTY = S.TARGET_ORDER_QTY,
        UPDATED_BY = CONCAT('CS_RES_QTY:', S.RESOLVED_BY),
        UPDATED_AT = CURRENT_TIMESTAMP()
      FROM Resolution_Validated S
      WHERE T.PRODUCTION_ORDER_ID = S.PRODUCTION_ORDER_ID -- 👈 V15: EXACT ID MATCH
        AND T.VALID_TO_TS IS NULL
        AND S.CHECK_RESULT = 'VALID'
        AND S.TARGET_ORDER_QTY IS NOT NULL;
        -- V15 CHANGE: Removed "AND S.ORDER_COUNT = 1" constraint.
        -- We trust the ID match + Rule 3/4 Validation above.

      -- STEP 5: CLOSE THE ALERT (Whistleblower)
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.CS_Status_Discrepancy_Log\` L
      SET 
        IS_RESOLVED = TRUE,
        RESOLVED_AT = CURRENT_TIMESTAMP(),
        RESOLVED_BY = S.RESOLVED_BY,
        RESOLUTION_TYPE = S.RESOLUTION_SOURCE, -- V15: Track Source (ACCEPT_CS vs OVERRIDE)
        RESOLUTION_NOTE = S.RESOLUTION_NOTE,
        UPDATED_AT = CURRENT_TIMESTAMP()
      FROM Resolution_Validated S
      WHERE L.ALERT_ID = S.ALERT_ID
        AND S.CHECK_RESULT = 'VALID';

      -- STEP 6: CLOSE STAGING (Success)
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.CS_Resolution_Staging\` T
      SET 
        VALIDATION_STATUS = 'PROCESSED', 
        PROCESSED_AT = CURRENT_TIMESTAMP()
      FROM Resolution_Validated V
      WHERE T.RESOLUTION_ID = V.RESOLUTION_ID AND V.CHECK_RESULT = 'VALID';

      -- ════════════════════════════════════════════════════════════════════════════
      -- STEP 7: AUTO-CLEANUP SUPERSEDED VERSIONS (V15.1 NEW)
      -- Call the cleanup procedure for every VPO touched by a valid resolution
      -- ════════════════════════════════════════════════════════════════════════════
      FOR record IN (
        SELECT DISTINCT VPO 
        FROM Resolution_Validated 
        WHERE CHECK_RESULT = 'VALID'
      )
      DO
        CALL \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.SP_CLEANUP_SUPERSEDED_ORDERS\`(record.VPO);
      END FOR;

    END;
  `,

  // =========================================================
  // SP: THE BRAIN (V5.2 Transactional Engine - CS Protocol Patch)
  // =========================================================
  SP_UPDATE_PRODUCTION_STATUS: `
    CREATE OR REPLACE PROCEDURE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.SP_UPDATE_PRODUCTION_STATUS\`(
      p_execution_user STRING
    )
    BEGIN
      -- ═══════════════════════════════════════════════════════════════════════════
      -- VARIABLE DECLARATIONS
      -- ═══════════════════════════════════════════════════════════════════════════
      DECLARE v_pending_count INT64;
      DECLARE v_zero_count INT64;
      DECLARE v_anomaly_threshold FLOAT64 DEFAULT 0.5;  -- 50% zeros = anomaly
      DECLARE v_cap_multiplier FLOAT64 DEFAULT 1.1;     -- 110% cap
      DECLARE v_auto_close_threshold FLOAT64 DEFAULT 0.99; -- 99% = complete
      DECLARE v_process_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP();
      DECLARE v_blocked_count INT64 DEFAULT 0;

      -- ═══════════════════════════════════════════════════════════════════════════
      -- PHASE 0: PRE-FLIGHT CHECK
      -- ═══════════════════════════════════════════════════════════════════════════
      SET v_pending_count = (
        SELECT COUNT(*) FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Status_Log\`
        WHERE VALIDATION_STATUS = 'PENDING'
      );

      IF v_pending_count = 0 THEN
        RETURN; -- Nothing to process
      END IF;

      -- ═══════════════════════════════════════════════════════════════════════════
      -- PHASE 1: CIRCUIT BREAKER (Drift Guard)
      -- Prevents mass data wipe from Bridge failures
      -- ═══════════════════════════════════════════════════════════════════════════
      SET v_zero_count = (
        SELECT COUNT(*) FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Status_Log\`
        WHERE VALIDATION_STATUS = 'PENDING'
          AND SOURCE = 'AUTO_BRIDGE'
          AND NEW_CUMULATIVE_QTY = 0
      );

      -- If more than 50% of Bridge records are zeros, likely a source failure
      IF v_zero_count > 10 AND 
          SAFE_DIVIDE(v_zero_count, v_pending_count) > v_anomaly_threshold THEN
        
        UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Status_Log\`
        SET 
          VALIDATION_STATUS = 'ANOMALY_DETECTED',
          ERROR_MESSAGE = CONCAT(
            'Circuit Breaker Triggered: ', 
            CAST(v_zero_count AS STRING), ' of ', 
            CAST(v_pending_count AS STRING), 
            ' records are zero (>', 
            CAST(CAST(v_anomaly_threshold * 100 AS INT64) AS STRING), 
            '%). Requires manual review.'
          ),
          PROCESSED_AT = v_process_timestamp
        WHERE VALIDATION_STATUS = 'PENDING'
          AND SOURCE = 'AUTO_BRIDGE';
        -- Continue processing only MANUAL_PORTAL and CS_SYNC_AGENT records
      END IF;

      -- ═══════════════════════════════════════════════════════════════════════════
      -- PHASE 2: SAMPLE PRODUCT FILTER
      -- ═══════════════════════════════════════════════════════════════════════════
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Status_Log\`
      SET 
        VALIDATION_STATUS = 'IGNORED',
        ERROR_MESSAGE = 'Sample Product excluded from status updates',
        PROCESSED_AT = v_process_timestamp
      WHERE VALIDATION_STATUS = 'PENDING'
        AND (
          VPO LIKE 'SP %' 
          OR VPO LIKE '% SP' 
          OR VPO LIKE 'SP%'
          OR UPPER(VPO) LIKE '%SAMPLE%'
        );

      -- ═══════════════════════════════════════════════════════════════════════════
      -- PHASE 3: IDENTITY RESOLUTION
      -- ═══════════════════════════════════════════════════════════════════════════
      
      -- 3A: Mark records with invalid identity
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Status_Log\`
      SET 
        VALIDATION_STATUS = 'ERROR_NO_IDENTITY',
        ERROR_MESSAGE = 'Record has neither PRODUCTION_ORDER_ID nor VPO',
        PROCESSED_AT = v_process_timestamp
      WHERE VALIDATION_STATUS = 'PENDING'
        AND PRODUCTION_ORDER_ID IS NULL
        AND VPO IS NULL;

      -- 3B: Mark VPO-only records that don't match ANY order (active or closed)
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Status_Log\` L
      SET 
        VALIDATION_STATUS = 'ERROR_VPO_NOT_FOUND',
        ERROR_MESSAGE = CONCAT('No Production_Order found for VPO: ', L.VPO),
        PROCESSED_AT = v_process_timestamp
      WHERE L.VALIDATION_STATUS = 'PENDING'
        AND L.PRODUCTION_ORDER_ID IS NULL
        AND L.VPO IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\` P
          WHERE P.VPO = L.VPO
            AND P.VALID_TO_TS IS NULL
        );

      -- 3C: Mark ID-based records that don't match any active order
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Status_Log\` L
      SET 
        VALIDATION_STATUS = 'ERROR_ID_NOT_FOUND',
        ERROR_MESSAGE = CONCAT('No active Production_Order found for ID: ', L.PRODUCTION_ORDER_ID),
        PROCESSED_AT = v_process_timestamp
      WHERE L.VALIDATION_STATUS = 'PENDING'
        AND L.PRODUCTION_ORDER_ID IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\` P
          WHERE P.PRODUCTION_ORDER_ID = L.PRODUCTION_ORDER_ID
            AND P.VALID_TO_TS IS NULL
        );

      -- 3D: BLOCKED STATE CHECK (Preserved from V6.0)
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Status_Log\` L
      SET 
        VALIDATION_STATUS = 'ERROR',
        ERROR_MESSAGE = CONCAT(
          'BLOCKED: Order ', L.PRODUCTION_ORDER_ID, ' is CANCELLED. ',
          'Reason: ', COALESCE(P.CANCELLATION_REASON, 'Unknown'), '. ',
          'Cancelled at: ', FORMAT_TIMESTAMP('%Y-%m-%d %H:%M', P.CANCELLED_AT), '. ',
          'Your update has been rejected. Contact your supervisor.'
        )
      FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\` P
      WHERE L.PRODUCTION_ORDER_ID = P.PRODUCTION_ORDER_ID
        AND P.VALID_TO_TS IS NULL
        AND P.DATA_STATE = 'CANCELLED'
        AND L.VALIDATION_STATUS = 'PENDING';

      -- Track how many were blocked for the Toast notification
      SET v_blocked_count = @@row_count;

      -- ═══════════════════════════════════════════════════════════════════════════
      -- PHASE 4: GHOST DEDUCTION CALCULATION (⭐ V5 CRITICAL)
      -- ═══════════════════════════════════════════════════════════════════════════
      
      -- 4A: Calculate ghost deduction using the Closed_Order_Ghost_VIEW logic
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Status_Log\` L
      SET 
        GHOST_DEDUCTION_APPLIED = COALESCE((
          SELECT SUM(COALESCE(P.COMPLETION_QTY, 0))
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\` P
          WHERE P.VPO = L.VPO
            AND P.VALID_TO_TS IS NULL
            AND P.DATA_STATE IN ('COMPLETED', 'CANCELLED')
            AND COALESCE(P.COMPLETION_QTY, 0) > 0
        ), 0),
        EFFECTIVE_QTY_FOR_FIFO = GREATEST(0, 
          L.NEW_CUMULATIVE_QTY - COALESCE((
            SELECT SUM(COALESCE(P.COMPLETION_QTY, 0))
            FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\` P
            WHERE P.VPO = L.VPO
              AND P.VALID_TO_TS IS NULL
              AND P.DATA_STATE IN ('COMPLETED', 'CANCELLED')
              AND COALESCE(P.COMPLETION_QTY, 0) > 0
          ), 0)
        )
      WHERE L.VALIDATION_STATUS = 'PENDING'
        AND L.PRODUCTION_ORDER_ID IS NULL
        AND L.VPO IS NOT NULL;

      -- 4B: For ID-based records, no ghost deduction needed
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Status_Log\` L
      SET 
        GHOST_DEDUCTION_APPLIED = 0,
        EFFECTIVE_QTY_FOR_FIFO = L.NEW_CUMULATIVE_QTY
      WHERE L.VALIDATION_STATUS = 'PENDING'
        AND L.PRODUCTION_ORDER_ID IS NOT NULL;

      -- 4C: ANOMALY DETECTION (Historical Poison Guard)
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Status_Log\` L
      SET 
        VALIDATION_STATUS = 'ERROR_NEGATIVE_EFFECTIVE',
        ERROR_MESSAGE = CONCAT(
          'Ghost deduction exceeds reported qty. ',
          'Reported: ', CAST(L.NEW_CUMULATIVE_QTY AS STRING),
          ', Ghost: ', CAST(L.GHOST_DEDUCTION_APPLIED AS STRING),
          '. Check historical COMPLETION_QTY accuracy.'
        ),
        PROCESSED_AT = v_process_timestamp
      WHERE L.VALIDATION_STATUS = 'PENDING'
        AND L.NEW_CUMULATIVE_QTY < L.GHOST_DEDUCTION_APPLIED;

      -- ═══════════════════════════════════════════════════════════════════════════
      -- PHASE 5: 110% CAP VALIDATION (⭐ WITH SAFETY FIX)
      -- ═══════════════════════════════════════════════════════════════════════════
      
      -- 5A: Direct ID match
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Status_Log\` L
      SET 
        VALIDATION_STATUS = 'ERROR_CAP_EXCEEDED',
        ERROR_MESSAGE = CONCAT(
          'Input qty (', CAST(L.NEW_CUMULATIVE_QTY AS STRING), 
          ') exceeds 110% of order target.'
        ),
        PROCESSED_AT = v_process_timestamp
      WHERE L.VALIDATION_STATUS = 'PENDING'
        AND L.PRODUCTION_ORDER_ID IS NOT NULL
        AND L.NEW_CUMULATIVE_QTY > (
          SELECT P.FINISHED_GOODS_ORDER_QTY * v_cap_multiplier
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\` P
          WHERE P.PRODUCTION_ORDER_ID = L.PRODUCTION_ORDER_ID
            AND P.VALID_TO_TS IS NULL
        );

      -- 5B: VPO match - check EFFECTIVE qty against SUM of ACTIVE orders
      -- 🛡️ SAFETY FIX: COALESCE(SUM(...), 0) catches cases where ALL orders are closed
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Status_Log\` L
      SET 
        VALIDATION_STATUS = 'ERROR_CAP_EXCEEDED',
        ERROR_MESSAGE = CONCAT(
          'Effective qty (', 
          CAST(L.EFFECTIVE_QTY_FOR_FIFO AS STRING), 
          ') exceeds 110% of active order capacity. (Did orders Auto-Close?)'
        ),
        PROCESSED_AT = v_process_timestamp
      WHERE L.VALIDATION_STATUS = 'PENDING'
        AND L.PRODUCTION_ORDER_ID IS NULL
        AND L.VPO IS NOT NULL
        AND L.EFFECTIVE_QTY_FOR_FIFO > (
          SELECT COALESCE(SUM(P.FINISHED_GOODS_ORDER_QTY), 0) * v_cap_multiplier
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\` P
          WHERE P.VPO = L.VPO
            AND P.VALID_TO_TS IS NULL
            AND P.DATA_STATE IN ('PROCESSING', 'PARTIALLY_RELEASED', 'RELEASED')
        );

      -- ═══════════════════════════════════════════════════════════════════════════
      -- PHASE 6: OPTIMISTIC LOCKING (⭐ V9 UPDATE)
      -- ═══════════════════════════════════════════════════════════════════════════
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Status_Log\` L
      SET 
        VALIDATION_STATUS = 'CONFLICT_DETECTED',
        ERROR_MESSAGE = 'Data changed since you loaded the portal. Please refresh.',
        PROCESSED_AT = v_process_timestamp
      WHERE L.VALIDATION_STATUS = 'PENDING'
        -- 🟢 V9 CRITICAL CHANGE: Allow CS_SYNC_AGENT into the safety check
        AND L.SOURCE IN ('MANUAL_PORTAL', 'CS_SYNC_AGENT')
        AND L.PRODUCTION_ORDER_ID IS NOT NULL
        AND L.EXPECTED_OLD_QTY IS NOT NULL
        AND ABS(L.EXPECTED_OLD_QTY - (
          SELECT COALESCE(P.COMPLETION_QTY, 0)
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\` P
          WHERE P.PRODUCTION_ORDER_ID = L.PRODUCTION_ORDER_ID
            AND P.VALID_TO_TS IS NULL
        )) > 0.01;

      -- ═══════════════════════════════════════════════════════════════════════════
      -- PHASE 7A: DIRECT UPDATE (ID-based records)
      -- ⭐ V6.5 SELF-HEALING PATCH: DEDUPLICATION LOGIC
      -- ═══════════════════════════════════════════════════════════════════════════
      MERGE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\` T
      USING (
        -- 🛡️ Deduplication Wrapper: Pick the LATEST Log ID per Order
        -- This logic ensures even if 1.8k duplicates exist, only the 'Winner' is merged.
        SELECT * EXCEPT(rn)
        FROM (
          SELECT 
            L.PRODUCTION_ORDER_ID,
            L.NEW_CUMULATIVE_QTY,
            L.SOURCE,
            L.LOG_ID,
            ROW_NUMBER() OVER(
              PARTITION BY L.PRODUCTION_ORDER_ID 
              ORDER BY L.LOG_ID DESC -- Latest Log Wins
            ) as rn
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Status_Log\` L
          WHERE L.VALIDATION_STATUS = 'PENDING'
            AND L.PRODUCTION_ORDER_ID IS NOT NULL
        )
        WHERE rn = 1
      ) S
      ON T.PRODUCTION_ORDER_ID = S.PRODUCTION_ORDER_ID 
         AND T.VALID_TO_TS IS NULL
      WHEN MATCHED THEN
        UPDATE SET
          T.COMPLETION_QTY = S.NEW_CUMULATIVE_QTY,
          T.COMPLETION_PERCENT = SAFE_DIVIDE(S.NEW_CUMULATIVE_QTY, T.FINISHED_GOODS_ORDER_QTY),
          T.UPDATED_BY = S.SOURCE,
          T.UPDATED_AT = v_process_timestamp;

      -- 🧹 FLUSH: Mark ALL pending ID-based records as COMMITTED (Winner + Losers)
      -- This ensures the queue is cleared even for the skipped duplicates.
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Status_Log\`
      SET 
        VALIDATION_STATUS = 'COMMITTED',
        PROCESSED_AT = v_process_timestamp
      WHERE VALIDATION_STATUS = 'PENDING'
        AND PRODUCTION_ORDER_ID IS NOT NULL;

      -- ═══════════════════════════════════════════════════════════════════════════
      -- PHASE 7B: FIFO ALLOCATION (VPO-based records)
      -- ⭐ V6.5 SELF-HEALING PATCH: VPO DEDUPLICATION
      -- ═══════════════════════════════════════════════════════════════════════════
      CREATE TEMP TABLE FIFO_Allocation AS
      WITH VPO_Inputs AS (
        -- 🛡️ Deduplication Wrapper: Pick Latest VPO Log
        SELECT * EXCEPT(rn)
        FROM (
          SELECT 
            L.VPO,
            L.EFFECTIVE_QTY_FOR_FIFO AS AVAILABLE_QTY,
            L.LOG_ID,
            L.SOURCE,
            ROW_NUMBER() OVER(
              PARTITION BY L.VPO 
              ORDER BY L.LOG_ID DESC
            ) as rn
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Status_Log\` L
          WHERE L.VALIDATION_STATUS = 'PENDING'
            AND L.PRODUCTION_ORDER_ID IS NULL
            AND L.VPO IS NOT NULL
        ) WHERE rn = 1
      ),
      Active_Order_Queue AS (
        SELECT 
          P.PRODUCTION_ORDER_ID,
          P.VPO,
          P.FINISHED_GOODS_ORDER_QTY,
          P.RECEIVED_VPO_DATE,
          -- FIFO Logic: Oldest VPO Date first
          COALESCE(SUM(P.FINISHED_GOODS_ORDER_QTY) OVER (
            PARTITION BY P.VPO 
            ORDER BY P.RECEIVED_VPO_DATE ASC, P.PRODUCTION_ORDER_ID ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ), 0) AS CAPACITY_BEFORE
        FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\` P
        WHERE P.VALID_TO_TS IS NULL
          AND P.DATA_STATE IN ('PROCESSING', 'PARTIALLY_RELEASED', 'RELEASED')
          AND P.VPO IN (SELECT VPO FROM VPO_Inputs)
      )
      SELECT 
        Q.PRODUCTION_ORDER_ID,
        I.SOURCE,
        -- The Core FIFO Formula
        LEAST(
          Q.FINISHED_GOODS_ORDER_QTY,
          GREATEST(0, I.AVAILABLE_QTY - Q.CAPACITY_BEFORE)
        ) AS ALLOCATED_QTY
      FROM Active_Order_Queue Q
      JOIN VPO_Inputs I ON Q.VPO = I.VPO;

      -- Apply FIFO allocations
      MERGE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\` T
      USING FIFO_Allocation A
      ON T.PRODUCTION_ORDER_ID = A.PRODUCTION_ORDER_ID 
         AND T.VALID_TO_TS IS NULL
      WHEN MATCHED THEN
        UPDATE SET
          T.COMPLETION_QTY = A.ALLOCATED_QTY,
          T.COMPLETION_PERCENT = SAFE_DIVIDE(A.ALLOCATED_QTY, T.FINISHED_GOODS_ORDER_QTY),
          T.UPDATED_BY = A.SOURCE,
          T.UPDATED_AT = v_process_timestamp;

      -- Mark as Committed
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Status_Log\`
      SET 
        VALIDATION_STATUS = 'COMMITTED',
        PROCESSED_AT = v_process_timestamp
      WHERE VALIDATION_STATUS = 'PENDING'
        AND PRODUCTION_ORDER_ID IS NULL
        AND VPO IS NOT NULL;

      DROP TABLE FIFO_Allocation;

      -- ═══════════════════════════════════════════════════════════════════════════
      -- PHASE 8: AUTO-CLOSE COMPLETED ORDERS
      -- ═══════════════════════════════════════════════════════════════════════════
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\`
      SET 
        DATA_STATE = 'COMPLETED',
        UPDATED_BY = CONCAT('AUTO_CLOSE:', p_execution_user),
        UPDATED_AT = v_process_timestamp
      WHERE VALID_TO_TS IS NULL
        AND DATA_STATE IN ('RELEASED', 'PARTIALLY_RELEASED', 'PROCESSING')
        AND COALESCE(COMPLETION_PERCENT, 0) >= v_auto_close_threshold;

      -- ═══════════════════════════════════════════════════════════════════════════
      -- PHASE 9: AUDIT SUMMARY (⭐ V5.1 UPGRADE: TRUTH REVEALED)
      -- ═══════════════════════════════════════════════════════════════════════════
      SELECT 
        'SP_UPDATE_PRODUCTION_STATUS' AS PROCEDURE_NAME,
        v_process_timestamp AS COMPLETED_AT,
        
        -- 1. Successes
        (SELECT COUNT(*) FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Status_Log\` 
         WHERE VALIDATION_STATUS = 'COMMITTED' AND PROCESSED_AT = v_process_timestamp) AS COMMITTED_COUNT,
        
        -- 2. Validation Errors (110% Cap, Missing ID, etc.)
        (SELECT COUNT(*) FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Status_Log\` 
         WHERE VALIDATION_STATUS LIKE 'ERROR%' AND PROCESSED_AT = v_process_timestamp) AS ERROR_COUNT,

        -- 3. Optimistic Locking Failures (Data changed by someone else)
        (SELECT COUNT(*) FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Status_Log\` 
         WHERE VALIDATION_STATUS = 'CONFLICT_DETECTED' AND PROCESSED_AT = v_process_timestamp) AS CONFLICT_COUNT,

        -- 4. Circuit Breaker Trips (Too many zeros)
        (SELECT COUNT(*) FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Status_Log\` 
         WHERE VALIDATION_STATUS = 'ANOMALY_DETECTED' AND PROCESSED_AT = v_process_timestamp) AS ANOMALY_COUNT,

        -- 5. Intentional Exclusions (Sample Products)
        (SELECT COUNT(*) FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Status_Log\` 
         WHERE VALIDATION_STATUS = 'IGNORED' AND PROCESSED_AT = v_process_timestamp) AS IGNORED_COUNT,
    
        -- 6. INJECTION: Return the blocked count for UI Toast
        v_blocked_count AS BLOCKED_CANCELLED_ORDERS;
    END;
  `,


  // =========================================================
  // 🛑 ADMIN: ORDER CANCELLATION PROTOCOL (V6.0)
  // =========================================================

  SP_ADMIN_CANCEL_ORDER: `
  CREATE OR REPLACE PROCEDURE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.SP_ADMIN_CANCEL_ORDER\`(
    p_production_order_id STRING,
    p_final_completion_qty FLOAT64,
    p_cancellation_reason STRING,
    p_execution_user STRING
  )
  BEGIN
    -- ═══════════════════════════════════════════════════════════════════
    -- VARIABLE DECLARATIONS
    -- ═══════════════════════════════════════════════════════════════════
    DECLARE v_current_state STRING;
    DECLARE v_db_completion_qty FLOAT64;
    DECLARE v_order_qty FLOAT64;
    DECLARE v_vpo STRING;
    DECLARE v_customer STRING;
    DECLARE v_sku STRING;
    DECLARE v_last_updated_at TIMESTAMP;
    DECLARE v_orphaned_pr_count INT64;
    DECLARE v_active_po_count INT64;
    DECLARE v_private_po_count INT64;
    DECLARE v_process_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP();
    DECLARE v_warnings ARRAY<STRING> DEFAULT [];

    -- ═══════════════════════════════════════════════════════════════════
    -- PHASE 1: VALIDATION
    -- ═══════════════════════════════════════════════════════════════════
    
    -- 1A: Fetch current order state
    SET (v_current_state, v_db_completion_qty, v_order_qty, v_vpo, 
         v_customer, v_sku, v_last_updated_at) = (
      SELECT AS STRUCT 
        DATA_STATE, 
        COALESCE(COMPLETION_QTY, 0),
        FINISHED_GOODS_ORDER_QTY,
        VPO, 
        CUSTOMER, 
        SKU_NAME_VERSION,
        UPDATED_AT
      FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\`
      WHERE PRODUCTION_ORDER_ID = p_production_order_id
        AND VALID_TO_TS IS NULL
    );
    
    -- 1B: Order not found
    IF v_current_state IS NULL THEN
      SELECT 
        'ERROR' AS STATUS, 
        'ORDER_NOT_FOUND' AS CODE,
        CONCAT('Order not found: ', p_production_order_id) AS MESSAGE,
        CAST(NULL AS STRING) AS VPO,
        CAST(NULL AS STRING) AS CUSTOMER,
        CAST(NULL AS STRING) AS SKU,
        CAST(NULL AS STRING) AS PREVIOUS_STATE,
        CAST(NULL AS FLOAT64) AS FINAL_QTY,
        CAST(NULL AS FLOAT64) AS ORIGINAL_QTY,
        CAST(NULL AS FLOAT64) AS PERCENT_AT_CANCEL,
        CAST(NULL AS STRING) AS REASON,
        CAST(NULL AS TIMESTAMP) AS CANCELLED_AT,
        CAST(NULL AS INT64) AS ORPHANED_PRS,
        CAST(NULL AS INT64) AS ACTIVE_PO_LINES,
        CAST(NULL AS INT64) AS PRIVATE_PO_LINES,
        CAST(NULL AS ARRAY<STRING>) AS WARNINGS;
      RETURN;
    END IF;
    
    -- 1C: Already in terminal state
    IF v_current_state IN ('COMPLETED', 'CANCELLED') THEN
      SELECT 
        'ERROR' AS STATUS, 
        'INVALID_STATE' AS CODE,
        CONCAT('Order already in terminal state: ', v_current_state) AS MESSAGE,
        v_vpo AS VPO,
        v_customer AS CUSTOMER,
        v_sku AS SKU,
        v_current_state AS PREVIOUS_STATE,
        CAST(NULL AS FLOAT64) AS FINAL_QTY,
        v_order_qty AS ORIGINAL_QTY,
        CAST(NULL AS FLOAT64) AS PERCENT_AT_CANCEL,
        CAST(NULL AS STRING) AS REASON,
        CAST(NULL AS TIMESTAMP) AS CANCELLED_AT,
        CAST(NULL AS INT64) AS ORPHANED_PRS,
        CAST(NULL AS INT64) AS ACTIVE_PO_LINES,
        CAST(NULL AS INT64) AS PRIVATE_PO_LINES,
        CAST(NULL AS ARRAY<STRING>) AS WARNINGS;
      RETURN;
    END IF;
    
    -- 1D: Validate cancellation reason enum
    IF p_cancellation_reason NOT IN (
      'CUSTOMER_CANCELLED', 'SUPPLY_ISSUE', 'DESIGN_CHANGE', 
      'QUALITY_FAILURE', 'CAPACITY_CONSTRAINT', 'DUPLICATE_ORDER', 'OTHER'
    ) THEN
      SELECT 
        'ERROR' AS STATUS, 
        'INVALID_REASON' AS CODE,
        CONCAT('Invalid cancellation reason: ', p_cancellation_reason, 
               '. Valid: CUSTOMER_CANCELLED, SUPPLY_ISSUE, DESIGN_CHANGE, ',
               'QUALITY_FAILURE, CAPACITY_CONSTRAINT, DUPLICATE_ORDER, OTHER') AS MESSAGE,
        v_vpo AS VPO,
        v_customer AS CUSTOMER,
        v_sku AS SKU,
        v_current_state AS PREVIOUS_STATE,
        CAST(NULL AS FLOAT64) AS FINAL_QTY,
        v_order_qty AS ORIGINAL_QTY,
        CAST(NULL AS FLOAT64) AS PERCENT_AT_CANCEL,
        CAST(NULL AS STRING) AS REASON,
        CAST(NULL AS TIMESTAMP) AS CANCELLED_AT,
        CAST(NULL AS INT64) AS ORPHANED_PRS,
        CAST(NULL AS INT64) AS ACTIVE_PO_LINES,
        CAST(NULL AS INT64) AS PRIVATE_PO_LINES,
        CAST(NULL AS ARRAY<STRING>) AS WARNINGS;
      RETURN;
    END IF;
    
    -- 1E: Validate quantity bounds (0 to 110% of order qty)
    IF p_final_completion_qty < 0 OR p_final_completion_qty > v_order_qty * 1.1 THEN
      SELECT 
        'ERROR' AS STATUS, 
        'INVALID_QTY' AS CODE,
        CONCAT('Final qty must be between 0 and ', 
               CAST(ROUND(v_order_qty * 1.1, 2) AS STRING), 
               ' (110% of order qty: ', CAST(v_order_qty AS STRING), ')') AS MESSAGE,
        v_vpo AS VPO,
        v_customer AS CUSTOMER,
        v_sku AS SKU,
        v_current_state AS PREVIOUS_STATE,
        p_final_completion_qty AS FINAL_QTY,
        v_order_qty AS ORIGINAL_QTY,
        CAST(NULL AS FLOAT64) AS PERCENT_AT_CANCEL,
        CAST(NULL AS STRING) AS REASON,
        CAST(NULL AS TIMESTAMP) AS CANCELLED_AT,
        CAST(NULL AS INT64) AS ORPHANED_PRS,
        CAST(NULL AS INT64) AS ACTIVE_PO_LINES,
        CAST(NULL AS INT64) AS PRIVATE_PO_LINES,
        CAST(NULL AS ARRAY<STRING>) AS WARNINGS;
      RETURN;
    END IF;

    -- ═══════════════════════════════════════════════════════════════════
    -- PHASE 2: WARNING COLLECTION
    -- ═══════════════════════════════════════════════════════════════════
    
    -- 2A: Quantity variance warning (Ghost trap prevention)
    -- If admin-provided qty differs from DB, warn about potential staleness
    IF ABS(p_final_completion_qty - v_db_completion_qty) > 1 THEN
      SET v_warnings = ARRAY_CONCAT(v_warnings, [
        CONCAT('⚠️ QTY_VARIANCE: You entered ', 
               CAST(ROUND(p_final_completion_qty, 2) AS STRING),
               ' but database shows ', 
               CAST(ROUND(v_db_completion_qty, 2) AS STRING),
               '. Last PSP sync: ', 
               FORMAT_TIMESTAMP('%Y-%m-%d %H:%M', v_last_updated_at),
               '. Verify PSP is current before confirming.')
      ]);
    END IF;
    
    -- 2B: M3 orphan warning (Open PRs for this VPO)
    SET v_orphaned_pr_count = (
      SELECT COUNT(*)
      FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_Final\`
      WHERE VPO = v_vpo 
        AND CONSOLIDATION_STATUS = 'OPEN'
    );
    
    IF v_orphaned_pr_count > 0 THEN
      SET v_warnings = ARRAY_CONCAT(v_warnings, [
        CONCAT('⚠️ ORPHANED_PRS: ', CAST(v_orphaned_pr_count AS STRING),
               ' open Purchase Requisitions exist for VPO "', v_vpo, '". ',
               'Action: Review M3 Sourcing Portal. Cancel or reassign before issuing POs.')
      ]);
    END IF;
    
    -- 2C: M4 active PO lines warning
    SET v_active_po_count = (
      SELECT COUNT(*)
      FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line_Tracking\`
      WHERE VPO = v_vpo 
        AND IS_ACTIVE = TRUE
    );
    
    IF v_active_po_count > 0 THEN
      -- Check specifically for PRIVATE (high risk - dead stock)
      SET v_private_po_count = (
        SELECT COUNT(*)
        FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line_Tracking\`
        WHERE VPO = v_vpo 
          AND IS_ACTIVE = TRUE 
          AND FULFILLMENT_MODE = 'PRIVATE'
      );
      
      IF v_private_po_count > 0 THEN
        SET v_warnings = ARRAY_CONCAT(v_warnings, [
          CONCAT('🔴 PRIVATE_DEAD_STOCK: ', CAST(v_private_po_count AS STRING),
                 ' PRIVATE (Bao Bì) PO lines are in-flight for VPO "', v_vpo, '". ',
                 'These are SKU-specific and CANNOT be reallocated to other orders. ',
                 'Action: Contact supplier immediately to cancel, return, or accept as dead stock. ',
                 'See: Orphaned Supply Report for details.')
        ]);
      END IF;
      
      IF v_active_po_count - COALESCE(v_private_po_count, 0) > 0 THEN
        SET v_warnings = ARRAY_CONCAT(v_warnings, [
          CONCAT('⚠️ ACTIVE_PO_LINES: ', 
                 CAST(v_active_po_count - COALESCE(v_private_po_count, 0) AS STRING),
                 ' PUBLIC PO lines are in-flight for VPO "', v_vpo, '". ',
                 'These can be reallocated to other orders when they arrive. ',
                 'Action: Review M4 Tracking Portal. No urgent action required.')
        ]);
      END IF;
    ELSE
      SET v_private_po_count = 0;
    END IF;

    -- ═══════════════════════════════════════════════════════════════════
    -- PHASE 3: EXECUTE CANCELLATION (Direct UPDATE)
    -- ═══════════════════════════════════════════════════════════════════
    
    UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Production_Order\`
    SET 
      -- State transition to terminal
      DATA_STATE = 'CANCELLED',
      
      -- Update COMPLETION_QTY for Ghost VIEW calculation
      -- This ensures Closed_Order_Ghost_VIEW correctly accounts for built qty
      COMPLETION_QTY = p_final_completion_qty,
      COMPLETION_PERCENT = SAFE_DIVIDE(p_final_completion_qty, FINISHED_GOODS_ORDER_QTY),
      
      -- Cancellation audit trail
      CANCELLATION_REASON = p_cancellation_reason,
      CANCELLED_AT = v_process_timestamp,
      CANCELLED_BY = p_execution_user,
      FORCE_CLOSE_QTY = p_final_completion_qty,
      
      -- Standard audit fields
      UPDATED_BY = CONCAT('CANCEL:', p_execution_user),
      UPDATED_AT = v_process_timestamp
      
    WHERE PRODUCTION_ORDER_ID = p_production_order_id
      AND VALID_TO_TS IS NULL;

    -- ═══════════════════════════════════════════════════════════════════
    -- PHASE 4: RETURN SUCCESS RESULT
    -- ═══════════════════════════════════════════════════════════════════
    
    SELECT 
      'SUCCESS' AS STATUS,
      'CANCELLED' AS CODE,
      CONCAT('Order ', p_production_order_id, ' cancelled successfully.') AS MESSAGE,
      v_vpo AS VPO,
      v_customer AS CUSTOMER,
      v_sku AS SKU,
      v_current_state AS PREVIOUS_STATE,
      p_final_completion_qty AS FINAL_QTY,
      v_order_qty AS ORIGINAL_QTY,
      ROUND(SAFE_DIVIDE(p_final_completion_qty, v_order_qty) * 100, 1) AS PERCENT_AT_CANCEL,
      p_cancellation_reason AS REASON,
      v_process_timestamp AS CANCELLED_AT,
      v_orphaned_pr_count AS ORPHANED_PRS,
      v_active_po_count AS ACTIVE_PO_LINES,
      v_private_po_count AS PRIVATE_PO_LINES,
      v_warnings AS WARNINGS;
      
  END;
`,

  // =========================================================
  // ⚖️ M2: THE FREEZE (Nightly Job)
  // =========================================================
  SP_RUN_MATCHING_ENGINE: `
      CREATE OR REPLACE PROCEDURE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.SP_RUN_MATCHING_ENGINE\`()
      BEGIN
          -- ==============================================================================
          -- STEP 0: FREEZE THE TRUTH (The Snapshot Fix)
          -- ==============================================================================
          -- 1. Wipe the old snapshot data
          TRUNCATE TABLE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Demand_SNAPSHOT\`;
          
          -- 2. Insert fresh data.
          INSERT INTO \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Demand_SNAPSHOT\`
          SELECT * FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Demand_VIEW\`;

          -- ==============================================================================
          -- STEP 1: CLEAN SLATE (Outputs)
          -- ==============================================================================
          TRUNCATE TABLE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_Draft\`;
          TRUNCATE TABLE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Pegging_Allocations\`;

          -- ==============================================================================
          -- PART A: THE PUBLIC ENGINE (Allocations & Shortages)
          -- ==============================================================================
          
          -- 2. FREEZE ALLOCATIONS
          INSERT INTO \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Pegging_Allocations\`
          (ALLOCATION_ID, CALCULATION_BATCH_ID, DEMAND_ID, BOM_UPDATE, SUPPLY_SOURCE_ID, ALLOCATION_TYPE, ALLOCATED_QTY, ALLOCATED_AT)
          SELECT
            -- 🟢 Deterministic Allocation ID (ALG_ + Hash)
            CONCAT('ALG_', \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.FN_GENERATE_HASH\`(DEMAND_ID, SUPPLY_SOURCE_ID)),
            'BATCH_' || FORMAT_DATE('%Y%m%d', CURRENT_DATE()),
            DEMAND_ID,
            BOM_UPDATE,
            SUPPLY_SOURCE_ID,
            CASE WHEN LENGTH(SUPPLY_SOURCE_ID) > 20 THEN 'HARD_RESERVE' ELSE 'SOFT_LINK' END, 
            ALLOCATED_QTY,
            CURRENT_TIMESTAMP()
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Matching_Engine_VIEW\`;

          -- 3. CALCULATE PUBLIC SHORTAGES
          INSERT INTO \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_Draft\`
          (DRAFT_PR_ID, DEMAND_ID, VPO, BOM_UPDATE, NET_SHORTAGE_COMPLETION, NET_SHORTAGE_ISSUANCE, NET_SHORTAGE_QTY, FULFILLMENT_MODE, REQUEST_TYPE, MAIN_GROUP, SUB_GROUP, HAS_ISSUANCE_DATA, ORDER_LIST_NOTE, REQUESTED_DELIVERY_DATE, CREATED_AT)
          SELECT
            -- 🟢 Deterministic PR ID (PRD_ + Hash)
            CONCAT('PRD_', \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.FN_GENERATE_HASH\`(D.DEMAND_ID, 'SHORTAGE')),
            D.DEMAND_ID,
            
            -- 🟢 VPO Handling: The Placeholder Protocol (Plan Part 3.3)
            COALESCE(D.VPO, 'GENERAL_STOCK'), 
            
            D.BOM_UPDATE,
            ROUND(D.GROSS_DEMAND_COMPLETION_METHOD - COALESCE(SUM(A.ALLOCATED_QTY), 0), 4),
            ROUND(D.GROSS_DEMAND_ISSUANCE_METHOD - COALESCE(SUM(A.ALLOCATED_QTY), 0), 4),
            ROUND(D.GROSS_DEMAND_QTY - COALESCE(SUM(A.ALLOCATED_QTY), 0), 4) AS NET_SHORTAGE_QTY,  -- 🔄 was MATERIAL_DEMANDED
            'PUBLIC',
            'SHORTAGE',
            D.MAIN_GROUP,
            D.SUB_GROUP,
            D.HAS_ISSUANCE_DATA,
            
            -- 🟡 Added ORDER_LIST_NOTE (Strategy Context)
            D.ORDER_LIST_NOTE,
            
            D.REQUESTED_DELIVERY_DATE,
            CURRENT_TIMESTAMP()
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Demand_SNAPSHOT\` D
          LEFT JOIN \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Pegging_Allocations\` A
            ON D.DEMAND_ID = A.DEMAND_ID
          WHERE D.FULFILLMENT_MODE = 'PUBLIC'
          
          -- Grouping required for Aggregation
          GROUP BY D.DEMAND_ID, D.VPO, D.BOM_UPDATE, D.GROSS_DEMAND_COMPLETION_METHOD, D.GROSS_DEMAND_ISSUANCE_METHOD, D.GROSS_DEMAND_QTY, D.REQUESTED_DELIVERY_DATE, D.ORDER_LIST_NOTE, D.MAIN_GROUP, D.SUB_GROUP, D.HAS_ISSUANCE_DATA
          HAVING NET_SHORTAGE_QTY > 0.0001;

          -- ==============================================================================
          -- PART B: THE PRIVATE TUNNEL (Now with Smart Netting)
          -- ==============================================================================
          
          INSERT INTO \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_Draft\`
          (DRAFT_PR_ID, DEMAND_ID, VPO, BOM_UPDATE, NET_SHORTAGE_COMPLETION, NET_SHORTAGE_ISSUANCE, NET_SHORTAGE_QTY, FULFILLMENT_MODE, REQUEST_TYPE, MAIN_GROUP, SUB_GROUP, HAS_ISSUANCE_DATA, ORDER_LIST_NOTE, REQUESTED_DELIVERY_DATE, CREATED_AT)
          
          SELECT
            CONCAT('PRD_', \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.FN_GENERATE_HASH\`(D.DEMAND_ID, 'PRIVATE')),
            D.DEMAND_ID,
            COALESCE(D.VPO, 'GENERAL_STOCK'),
            D.BOM_UPDATE,
            
            -- 🟢 THE FIX: Subtract Existing Private Supply for this VPO
            ROUND(D.GROSS_DEMAND_COMPLETION_METHOD - COALESCE(S.EXISTING_SUPPLY_QTY, 0), 4),
            ROUND(D.GROSS_DEMAND_ISSUANCE_METHOD - COALESCE(S.EXISTING_SUPPLY_QTY, 0), 4),
            ROUND(D.GROSS_DEMAND_QTY - COALESCE(S.EXISTING_SUPPLY_QTY, 0), 4) AS NET_SHORTAGE_QTY,  -- 🔄 was MATERIAL_DEMANDED
            
            'PRIVATE',
            'PRIVATE_ORDER',
            D.MAIN_GROUP,
            D.SUB_GROUP,
            D.HAS_ISSUANCE_DATA,
            D.ORDER_LIST_NOTE,
            D.REQUESTED_DELIVERY_DATE,
            CURRENT_TIMESTAMP()
          
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Demand_SNAPSHOT\` D
          
          -- 🔗 JOIN: Look for matching supply in the Tracking Table
          LEFT JOIN (
            SELECT 
              VPO, 
              BOM_UPDATE, 
              SUM(COALESCE(LOADED_QTY, CONFIRMED_QTY, ORDER_QTY)) as EXISTING_SUPPLY_QTY
            FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line_Tracking\`
            WHERE IS_ACTIVE = TRUE
              AND FULFILLMENT_MODE = 'PRIVATE' -- Only count Private Supply
            GROUP BY VPO, BOM_UPDATE
          ) S
          ON D.BOM_UPDATE = S.BOM_UPDATE
             -- Strict VPO Matching (The "Sniper" Check)
             AND COALESCE(D.VPO, 'GENERAL_STOCK') = COALESCE(S.VPO, 'GENERAL_STOCK')

          WHERE D.FULFILLMENT_MODE = 'PRIVATE'
            -- 🛡️ Filter: Only insert if we still have a shortage
            AND ROUND(D.GROSS_DEMAND_QTY - COALESCE(S.EXISTING_SUPPLY_QTY, 0), 4) > 0;  -- 🔄 was MATERIAL_DEMANDED

          -- ==============================================================================
          -- STEP 8: ARCHIVE TO M2_PIPELINE_LEDGER (V8 Addition — Dual-Method Traceability)
          -- TIMING: Must run AFTER Steps 3 & 4 (both PR_Draft tunnels complete).
          -- GRAIN: 1 row per DEMAND_ID — LEFT JOIN brings in today's PR_Draft net values.
          -- SELF-HEALING: If PR_Draft has no row for a DEMAND_ID, net values default to 0
          --   (meaning all demand was allocated — no shortage). This is correct behavior.
          -- ==============================================================================
          INSERT INTO \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.M2_Pipeline_Ledger\`
          (
            LEDGER_DATE, RUN_SOURCE, BATCH_ID,
            DEMAND_ID, PRODUCTION_ORDER_ID, BOM_UPDATE, VPO, FULFILLMENT_MODE,
            GROSS_DEMAND_COMPLETION_METHOD, GROSS_DEMAND_ISSUANCE_METHOD, GROSS_DEMAND_QTY,
            NET_SHORTAGE_COMPLETION, NET_SHORTAGE_ISSUANCE, NET_SHORTAGE_QTY,
            SUPPLY_ALLOCATED_QTY,
            MAIN_GROUP, SUB_GROUP, PIC, SKU_CODE,
            REQUESTED_DELIVERY_DATE, ORDER_LIST_NOTE,
            HAS_ISSUANCE_DATA, CALC_METHOD_USED, HAS_SHORTAGE,
            PRESERVED_AT
          )
          SELECT
            CURRENT_DATE('Asia/Ho_Chi_Minh'),
            'NIGHTLY',
            'BATCH_' || FORMAT_DATE('%Y%m%d', CURRENT_DATE()),

            -- Demand identity from SNAPSHOT
            D.DEMAND_ID, D.PRODUCTION_ORDER_ID, D.BOM_UPDATE,
            COALESCE(D.VPO, 'GENERAL_STOCK'), D.FULFILLMENT_MODE,

            -- Dual-method gross demand from SNAPSHOT
            D.GROSS_DEMAND_COMPLETION_METHOD, D.GROSS_DEMAND_ISSUANCE_METHOD, D.GROSS_DEMAND_QTY,

            -- Net shortage from PR_Draft (NULL if fully allocated — coerce to 0)
            COALESCE(PR.NET_SHORTAGE_COMPLETION, 0) AS NET_SHORTAGE_COMPLETION,
            COALESCE(PR.NET_SHORTAGE_ISSUANCE, 0) AS NET_SHORTAGE_ISSUANCE,
            COALESCE(PR.NET_SHORTAGE_QTY, 0) AS NET_SHORTAGE_QTY,

            -- Supply allocated = gross demand minus net shortage
            ROUND(D.GROSS_DEMAND_QTY - COALESCE(PR.NET_SHORTAGE_QTY, 0), 4) AS SUPPLY_ALLOCATED_QTY,

            -- Classification from SNAPSHOT
            D.MAIN_GROUP, D.SUB_GROUP, D.PIC, D.SKU_CODE,

            -- Context
            D.REQUESTED_DELIVERY_DATE, D.ORDER_LIST_NOTE,

            -- Flags
            D.HAS_ISSUANCE_DATA, D.CALC_METHOD_USED,
            (COALESCE(PR.NET_SHORTAGE_QTY, 0) > 0.0001) AS HAS_SHORTAGE,

            CURRENT_TIMESTAMP()  -- PRESERVED_AT

          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Demand_SNAPSHOT\` D
          -- LEFT JOIN: DEMAND_IDs with no shortage in PR_Draft get HAS_SHORTAGE = FALSE
          LEFT JOIN \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_Draft\` PR
            ON D.DEMAND_ID = PR.DEMAND_ID;

      END;
  `,

  // =========================================================
  // 🏢 MODULE 3: PROCUREMENT (Master Data & Sourcing)
  // naming_convention: SP_{MODULE}_{ACTION}_{ENTITY}
  // =========================================================
  SP_M3_MERGE_SUPPLIER_INFO: `
    CREATE OR REPLACE PROCEDURE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.SP_M3_MERGE_SUPPLIER_INFO\`()
    BEGIN
      -- 1. Validation (Smart Gate)
      -- 🛡️ UX: Detailed error message to help user fix the Sheet formula
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Supplier_Information_Staging\`
      SET VALIDATION_STATUS = 'FAIL', ERROR_MESSAGE = 'Missing Supplier ID (Check Formula)'
      WHERE VALIDATION_STATUS = 'PENDING'
        AND (SUPPLIER_ID IS NULL OR SUPPLIER_ID = '');

      -- 2. MERGE (SCD Type 1 - Update In Place)
      MERGE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Supplier_Information\` T
      USING (
        SELECT * FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Supplier_Information_Staging\`
        WHERE VALIDATION_STATUS = 'PENDING'
      ) S
      ON T.SUPPLIER_ID = S.SUPPLIER_ID
      
      -- CASE A: ID Exists -> UPDATE
      WHEN MATCHED THEN
        UPDATE SET 
          T.SUPPLIER_NAME = S.SUPPLIER_NAME,
          T.SUPPLIER_LOCATION_TYPE = S.SUPPLIER_LOCATION_TYPE,
          T.ADDRESS = S.ADDRESS,
          T.TAX_ID = S.TAX_ID,
          T.PRIMARY_CONTACT_NAME = S.PRIMARY_CONTACT_NAME,
          T.PRIMARY_CONTACT_TITLE = S.PRIMARY_CONTACT_TITLE,
          T.MOBILE = S.MOBILE,
          T.LANDPHONE = S.LANDPHONE,
          T.PAYMENT_TERMS = S.PAYMENT_TERMS,
          T.BANK_NAME = S.BANK_NAME,
          T.BANK_ACCOUNT_NUMBER = S.BANK_ACCOUNT_NUMBER,
          T.CONTRACT_ID = S.CONTRACT_ID,
          T.CONTRACT_DATE = SAFE_CAST(S.CONTRACT_DATE AS DATE),
          T.CONTRACT_EXPIRATION_DATE = SAFE_CAST(S.CONTRACT_EXPIRATION_DATE AS DATE),
          T.UPDATED_BY = S.UPDATED_BY,
          T.UPDATED_AT = CURRENT_TIMESTAMP()

      -- CASE B: New ID -> INSERT
      WHEN NOT MATCHED THEN
        INSERT (
          SUPPLIER_ID, SUPPLIER_NAME, SUPPLIER_LOCATION_TYPE, ADDRESS, TAX_ID, 
          PRIMARY_CONTACT_NAME, PRIMARY_CONTACT_TITLE, MOBILE, LANDPHONE,
          PAYMENT_TERMS, BANK_NAME, BANK_ACCOUNT_NUMBER, 
          CONTRACT_ID, CONTRACT_DATE, CONTRACT_EXPIRATION_DATE,
          UPDATED_BY, UPDATED_AT, SUPPLIER_STATUS
        )
        VALUES (
          S.SUPPLIER_ID, 
          S.SUPPLIER_NAME, S.SUPPLIER_LOCATION_TYPE, S.ADDRESS, S.TAX_ID, 
          S.PRIMARY_CONTACT_NAME, S.PRIMARY_CONTACT_TITLE, S.MOBILE, S.LANDPHONE,
          S.PAYMENT_TERMS, S.BANK_NAME, S.BANK_ACCOUNT_NUMBER,
          S.CONTRACT_ID, SAFE_CAST(S.CONTRACT_DATE AS DATE), SAFE_CAST(S.CONTRACT_EXPIRATION_DATE AS DATE),
          S.UPDATED_BY, CURRENT_TIMESTAMP(), 'ACTIVE'
        );

      -- 3. Cleanup
      DELETE FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Supplier_Information_Staging\`
      WHERE VALIDATION_STATUS = 'PENDING';
    END;
  `,

  SP_M3_MERGE_SUPPLIER_CAPACITY: `
    CREATE OR REPLACE PROCEDURE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.SP_M3_MERGE_SUPPLIER_CAPACITY\`()
    BEGIN
      -- 0. SELF-CLEANING
      -- Removes duplicates in the same batch, treating NULLs as matches
      DELETE FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Supplier_Capacity_Staging\` AS Target
      WHERE Target.VALIDATION_STATUS = 'FAIL'
        AND EXISTS (
          SELECT 1 FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Supplier_Capacity_Staging\` AS Incoming
          WHERE Incoming.VALIDATION_STATUS = 'PENDING'
            AND COALESCE(Incoming.SUPPLIER_ID, 'MISSING') = COALESCE(Target.SUPPLIER_ID, 'MISSING')
            AND Incoming.BOM_UPDATE = Target.BOM_UPDATE
        );

      -- 1. VALIDATION GATE
      -- 🛡️ UX: Helpful error telling user exactly what to fix (Master Data)
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Supplier_Capacity_Staging\` S
      SET VALIDATION_STATUS = 'FAIL', ERROR_MESSAGE = 'Unknown Supplier: Please create the Supplier in Master Data first.'
      WHERE S.VALIDATION_STATUS = 'PENDING'
        AND NOT EXISTS (
          SELECT 1 FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Supplier_Information\` M
          WHERE M.SUPPLIER_ID = S.SUPPLIER_ID
        );

      -- 2. MERGE
      MERGE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Supplier_Capacity\` T
      USING (
        SELECT 
           -- Deterministic ID: HASH(Supplier + BOM)
           TO_HEX(MD5(CONCAT(SUPPLIER_ID, BOM_UPDATE))) as CALCULATED_CAPACITY_ID,
           * FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Supplier_Capacity_Staging\`
        WHERE VALIDATION_STATUS = 'PENDING'
        QUALIFY ROW_NUMBER() OVER(PARTITION BY SUPPLIER_ID, BOM_UPDATE ORDER BY UPDATED_AT DESC) = 1
      ) S
      ON T.SUPPLIER_ID = S.SUPPLIER_ID AND T.BOM_UPDATE = S.BOM_UPDATE
      
      WHEN MATCHED THEN
        UPDATE SET 
          T.UNIT_PRICE = SAFE_CAST(REGEXP_REPLACE(CAST(S.UNIT_PRICE AS STRING), r'[^0-9.]', '') AS FLOAT64),
          T.LEAD_TIME  = SAFE_CAST(REGEXP_REPLACE(CAST(S.LEAD_TIME AS STRING), r'[^0-9.]', '') AS FLOAT64),
          T.MOQ        = SAFE_CAST(REGEXP_REPLACE(CAST(S.MOQ AS STRING), r'[^0-9.]', '') AS FLOAT64),
          T.UPDATED_BY = S.UPDATED_BY,
          T.UPDATED_AT = CURRENT_TIMESTAMP()
          
      WHEN NOT MATCHED THEN
        INSERT (
          CAPACITY_ID, SUPPLIER_ID, SUPPLIER_NAME, BOM_UPDATE, 
          UNIT_PRICE, LEAD_TIME, MOQ, 
          UPDATED_BY, UPDATED_AT
        )
        VALUES (
          S.CALCULATED_CAPACITY_ID, S.SUPPLIER_ID, S.SUPPLIER_NAME, S.BOM_UPDATE,
          SAFE_CAST(REGEXP_REPLACE(CAST(S.UNIT_PRICE AS STRING), r'[^0-9.]', '') AS FLOAT64),
          SAFE_CAST(REGEXP_REPLACE(CAST(S.LEAD_TIME AS STRING), r'[^0-9.]', '') AS FLOAT64),
          SAFE_CAST(REGEXP_REPLACE(CAST(S.MOQ AS STRING), r'[^0-9.]', '') AS FLOAT64),
          S.UPDATED_BY, CURRENT_TIMESTAMP()
        );

      -- 3. CLEANUP
      DELETE FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Supplier_Capacity_Staging\`
      WHERE VALIDATION_STATUS = 'PENDING';
    END;
  `,

  // =========================================================
  // 🧑‍💼 M3: SOURCING INTELLIGENCE (The "Feedback Loop" Edition)
  // =========================================================
  Sourcing_Feed_VIEW: `
      CREATE OR REPLACE VIEW \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Sourcing_Feed_VIEW\` AS
      
      /* STEP 1: CAPACITIES (System Suggestion) */
      WITH Ranked_Capacities AS (
        SELECT 
          BOM_UPDATE,
          SUPPLIER_NAME,
          UNIT_PRICE,
          LEAD_TIME,
          ROW_NUMBER() OVER(PARTITION BY BOM_UPDATE ORDER BY UNIT_PRICE ASC, LEAD_TIME ASC) as price_rank
        FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Supplier_Capacity\`
      ),
      Aggregated_Options AS (
        SELECT 
          BOM_UPDATE,
          MAX(CASE WHEN price_rank = 1 THEN SUPPLIER_NAME END) as BEST_SUPPLIER_NAME,
          STRING_AGG(
            FORMAT('%s: $%.2f (%dd)', SUPPLIER_NAME, UNIT_PRICE, CAST(LEAD_TIME AS INT64)), 
            ' | ' ORDER BY price_rank ASC
          ) as KNOWN_CAPACITY_OPTIONS
        FROM Ranked_Capacities
        GROUP BY BOM_UPDATE
      )

      /* STEP 2: THE FEEDBACK LOOP JOIN */
      SELECT 
        P.DRAFT_PR_ID,
        P.BOM_UPDATE,
        P.VPO,
        
        -- 🟢 1. FEEDBACK: Mode (User Decision > System Draft)
        COALESCE(F.FULFILLMENT_MODE, P.FULFILLMENT_MODE) AS FULFILLMENT_MODE,

        COALESCE(B.BOM_VIETNAMESE_DESCRIPTION, B.BOM_DESCRIPTION, P.BOM_UPDATE) AS BOM_DESCRIPTION,
        P.NET_SHORTAGE_COMPLETION,
        P.NET_SHORTAGE_ISSUANCE,
        P.NET_SHORTAGE_QTY,
        P.MAIN_GROUP,
        P.SUB_GROUP,
        P.HAS_ISSUANCE_DATA,

        -- 🟢 2. FEEDBACK: Date (User Decision > System Draft)
        COALESCE(F.REQUESTED_DELIVERY_DATE, P.REQUESTED_DELIVERY_DATE) AS REQUESTED_DELIVERY_DATE,
        
        -- 🟢 3. FEEDBACK: Supplier (User Decision > System Suggestion > "No Source")
        COALESCE(F.SUPPLIER_NAME, C.BEST_SUPPLIER_NAME, '⚠️ NO SOURCE') AS ASSIGNED_SUPPLIER_NAME,
        
        -- System Context
        COALESCE(C.KNOWN_CAPACITY_OPTIONS, 'No suppliers found in Master Data.\\nPlease add capacity.') AS KNOWN_CAPACITY_OPTIONS,
        
        -- 🟢 4. FEEDBACK: PIC (User Reassignment > System BOM Owner > 'Unassigned')
        COALESCE(F.PIC, B.PIC, 'Unassigned') AS PIC,
        
        -- 🟢 5. FEEDBACK: Strategy Note (User Context > Planner Context)
        COALESCE(F.ORDER_LIST_NOTE, P.ORDER_LIST_NOTE) AS ORDER_LIST_NOTE,

        -- 🟢 6. FEEDBACK: Inputs (For Zone B persistence)
        F.DATE_CODE,        -- Populates the "Date Code" Input
        F.FINAL_UNIT_PRICE  -- Populates the "Price Override" Input

      FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_Draft\` P
      
      -- 🔗 THE GOLDEN LINK
      LEFT JOIN \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_Final\` F 
        ON P.DRAFT_PR_ID = F.PR_FINAL_ID
      
      LEFT JOIN \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Data\` B 
        ON P.BOM_UPDATE = B.BOM_UPDATE
      LEFT JOIN Aggregated_Options C 
        ON P.BOM_UPDATE = C.BOM_UPDATE
      
      -- 🛡️ THE WORKFLOW GUARD
      -- Hide items that have already been Consolidated (Moved to PO)
      WHERE (F.CONSOLIDATION_STATUS IS NULL OR F.CONSOLIDATION_STATUS = 'OPEN')

      ORDER BY P.REQUESTED_DELIVERY_DATE ASC
  `,

  SP_M3_MERGE_PR_DECISIONS: `
    CREATE OR REPLACE PROCEDURE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.SP_M3_MERGE_PR_DECISIONS\`()
    BEGIN
      -- 1. IDENTIFY BATCH (Latest updates per ID)
      CREATE TEMP TABLE Batch_Staging AS
      SELECT * FROM (
        SELECT *, ROW_NUMBER() OVER(PARTITION BY PR_STAGING_ID ORDER BY UPDATED_AT DESC) as rn
        FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_Staging\`
        WHERE VALIDATION_STATUS = 'PENDING'
      ) WHERE rn = 1;

      -- 2. VALIDATION GATE
      CREATE TEMP TABLE Batch_Validated AS
      SELECT S.*,
        CASE 
          WHEN M.SUPPLIER_ID IS NULL THEN 'ERROR: Supplier ID not found in Master.'
          WHEN S.QTY_TO_APPROVE <= 0 THEN 'ERROR: Quantity must be positive.'
          ELSE 'VALID'
        END as CHECK_RESULT
      FROM Batch_Staging S
      LEFT JOIN \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Supplier_Information\` M
        ON S.SUPPLIER_ID = M.SUPPLIER_ID;

      -- 3. REJECT BAD DATA
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_Staging\` T
      SET VALIDATION_STATUS = 'ERROR', VALIDATION_LOG = V.CHECK_RESULT, UPDATED_AT = CURRENT_TIMESTAMP()
      FROM Batch_Validated V
      WHERE T.PR_STAGING_ID = V.PR_STAGING_ID AND V.CHECK_RESULT != 'VALID';

      -- 4. MERGE TO FINAL (Upsert)
      MERGE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_Final\` T
      USING (
          SELECT 
            V.*,
            -- 🟢 JOIN FIX: Recover ORDER_LIST_NOTE from PR_Draft
            D.ORDER_LIST_NOTE
          FROM Batch_Validated V
          LEFT JOIN \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_Draft\` D
            ON V.PR_STAGING_ID = D.DRAFT_PR_ID
          WHERE V.CHECK_RESULT = 'VALID'
      ) S
      ON T.PR_FINAL_ID = S.PR_STAGING_ID 

      WHEN MATCHED THEN
        UPDATE SET 
          T.SUPPLIER_ID = S.SUPPLIER_ID,
          T.SUPPLIER_NAME = S.SUPPLIER_NAME,
          T.BOM_UPDATE = S.BOM_UPDATE,
          T.QTY_APPROVED = S.QTY_TO_APPROVE,
          T.FULFILLMENT_MODE = S.FULFILLMENT_MODE,
          T.FINAL_UNIT_PRICE = S.FINAL_UNIT_PRICE,
          T.REQUESTED_DELIVERY_DATE = S.REQUESTED_DELIVERY_DATE,
          T.VPO = S.VPO,
          
          -- 🟡 NOTE: Persist the Planner's Note
          T.ORDER_LIST_NOTE = COALESCE(S.ORDER_LIST_NOTE, T.ORDER_LIST_NOTE),

          T.PIC = S.PIC,
          T.DATE_CODE = S.DATE_CODE,  -- 🟢 NEW: Update Date Code
          T.UPDATED_BY = S.UPDATED_BY,
          T.UPDATED_AT = S.UPDATED_AT, 
          T.CONSOLIDATION_STATUS = 'OPEN' 

      WHEN NOT MATCHED THEN
        INSERT (
          PR_FINAL_ID, 
          SUPPLIER_ID, SUPPLIER_NAME, BOM_UPDATE, QTY_APPROVED, 
          FULFILLMENT_MODE, FINAL_UNIT_PRICE, REQUESTED_DELIVERY_DATE, 
          VPO, ORDER_LIST_NOTE, -- 🟡 Insert Note
          CONSOLIDATION_STATUS, 
          PIC, 
          DATE_CODE,            -- 🟢 NEW: Insert Date Code
          UPDATED_BY, UPDATED_AT
        )
        VALUES (
          S.PR_STAGING_ID, 
          S.SUPPLIER_ID, S.SUPPLIER_NAME, S.BOM_UPDATE, S.QTY_TO_APPROVE,
          S.FULFILLMENT_MODE, S.FINAL_UNIT_PRICE, S.REQUESTED_DELIVERY_DATE,
          S.VPO, S.ORDER_LIST_NOTE,
          'OPEN', 
          S.PIC, 
          S.DATE_CODE,          -- 🟢 NEW: Map Value
          S.UPDATED_BY, S.UPDATED_AT
        );

      -- 5. CLOSE STAGING
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_Staging\` T
      SET VALIDATION_STATUS = 'PROCESSED', VALIDATION_LOG = 'Promoted to Final'
      FROM Batch_Validated V
      WHERE T.PR_STAGING_ID = V.PR_STAGING_ID AND V.CHECK_RESULT = 'VALID';
    END;
  `,
  

  // =========================================================
  // 🏭 M3: CONSOLIDATION ENGINE (Transactional & Idempotent)
  // =========================================================
  SP_M3_CONSOLIDATE_BATCH: `
    CREATE OR REPLACE PROCEDURE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.SP_M3_CONSOLIDATE_BATCH\`(
      pr_ids_array ARRAY<STRING>,
      target_supplier_id STRING,
      global_override_date DATE, 
      user_email STRING
    )
    BEGIN
      -- 1. Generate Stable Batch ID
      DECLARE batch_id STRING DEFAULT TO_HEX(MD5(ARRAY_TO_STRING(
        (SELECT ARRAY_AGG(x ORDER BY x) FROM UNNEST(pr_ids_array) AS x), 
        ','
      )));
      DECLARE po_doc_id STRING;
      DECLARE po_number STRING;
      
      -- Header Metadata Containers
      DECLARE v_total_amount FLOAT64;
      DECLARE v_line_count INT64;
      DECLARE v_due_date DATE;
      DECLARE v_supplier_name STRING;

      -- 2. Validation: PRs must be OPEN and match Supplier
      IF EXISTS (
        SELECT 1 FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_Final\`
        WHERE PR_FINAL_ID IN UNNEST(pr_ids_array)
          AND (CONSOLIDATION_STATUS != 'OPEN' OR SUPPLIER_ID != target_supplier_id)
      ) THEN
        RAISE USING MESSAGE = 'Validation Failed: PRs must be OPEN and belong to the same Supplier.';
      END IF;

      -- 3. Pre-Calculate IDs (Moved up for Idempotency)
      SET po_doc_id = TO_HEX(MD5(CONCAT(target_supplier_id, CURRENT_DATE(), batch_id)));
      SET po_number = CONCAT('PO-', FORMAT_DATE('%Y%m%d', CURRENT_DATE()), '-', SUBSTR(batch_id, 1, 4));

      -- 🛡️ 3.5 IDEMPOTENCY CHECK (Prevent Duplicates)
      -- If this PO ID already exists, we stop immediately and return the existing number.
      IF EXISTS (SELECT 1 FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Header\` WHERE PO_DOCUMENT_ID = po_doc_id) THEN
         SELECT po_number AS GENERATED_PO;
         RETURN;
      END IF;

      -- 4. Calculate Header Totals (Preserves original logic)
      SET (v_total_amount, v_line_count, v_due_date, v_supplier_name) = (
        SELECT AS STRUCT
          SUM(P.QTY_APPROVED * P.FINAL_UNIT_PRICE),
          COUNT(DISTINCT CONCAT(
              P.BOM_UPDATE, 
              CAST(P.FINAL_UNIT_PRICE AS STRING), 
              P.VPO, -- 🟢 Preserves VPO Grouping
              COALESCE(NULLIF(TRIM(P.DATE_CODE), ''), 'NULL')
          )),
          COALESCE(global_override_date, MIN(P.REQUESTED_DELIVERY_DATE)),
          COALESCE(ANY_VALUE(S.SUPPLIER_NAME), ANY_VALUE(P.SUPPLIER_NAME))
        FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_Final\` P
        LEFT JOIN \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Supplier_Information\` S
          ON P.SUPPLIER_ID = S.SUPPLIER_ID
        WHERE P.PR_FINAL_ID IN UNNEST(pr_ids_array)
      );

      -- 🛡️ 5. BEGIN TRANSACTION (The All-or-Nothing Safety Net)
      BEGIN TRANSACTION;
      BEGIN
          -- A. Event Logging
          INSERT INTO \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Consolidation_Event\` 
          (CONSOLIDATION_BATCH_ID, BUYER_PIC, CONSOLIDATION_RULE, CONSOLIDATED_AT, TOTAL_PR_COUNT, TOTAL_PO_COUNT)
          VALUES 
          (batch_id, user_email, IF(global_override_date IS NOT NULL, 'MANUAL_OVERRIDE', 'AUTO_GROUP'), CURRENT_TIMESTAMP(), ARRAY_LENGTH(pr_ids_array), 1);

          -- B. Header Generation
          INSERT INTO \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Header\` 
          (PO_DOCUMENT_ID, CONSOLIDATION_BATCH_ID, SUPPLIER_ID, PO_NUMBER_REF, ORDER_DATE, PO_STATUS, CREATED_BY, CREATED_AT, TOTAL_AMOUNT, LINE_COUNT, PO_DUE_DATE, SUPPLIER_NAME)
          SELECT DISTINCT
            po_doc_id, batch_id, target_supplier_id, po_number, CURRENT_DATE(), 'DRAFT', user_email, CURRENT_TIMESTAMP(), v_total_amount, v_line_count, v_due_date, v_supplier_name
          FROM UNNEST([1]);

          -- C. Line Generation (Critical VPO & PIC Logic)
          INSERT INTO \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line\` 
          (
            PO_LINE_ID, PO_DOCUMENT_ID, 
            PIC, -- 🟢 NEW: Persistence of Ownership
            BOM_UPDATE, FULFILLMENT_MODE, ORDER_QTY, UNIT_PRICE, LINE_TOTAL, SYSTEM_SUGGESTED_REQUESTED_DATE, BUYER_REQUESTED_DATE, DATE_CODE, VPO, PO_LINE_NOTE, LINE_NUMBER, CREATED_AT, PR_FINAL_ID
          )
          SELECT
            -- 🟢 ID Gen includes VPO and Date Code (Matches Group By)
            TO_HEX(MD5(CONCAT(po_doc_id, BOM_UPDATE, CAST(FINAL_UNIT_PRICE AS STRING), ANY_VALUE(VPO), COALESCE(NULLIF(TRIM(ANY_VALUE(DATE_CODE)), ''), 'NULL')))),
            po_doc_id, 
            
            ANY_VALUE(PIC), -- 🟢 NEW: Capture the Session Owner
            
            BOM_UPDATE, ANY_VALUE(FULFILLMENT_MODE), SUM(QTY_APPROVED), FINAL_UNIT_PRICE, SUM(QTY_APPROVED) * FINAL_UNIT_PRICE,
            MIN(REQUESTED_DELIVERY_DATE), global_override_date, COALESCE(NULLIF(TRIM(ANY_VALUE(DATE_CODE)), ''), NULL),
            
            ANY_VALUE(VPO),       -- 🟢 VPO Pass-through
            CAST(NULL AS STRING), -- 🟢 FIX: Strict Type Casting
            
            ROW_NUMBER() OVER (ORDER BY ANY_VALUE(VPO), BOM_UPDATE),
            CURRENT_TIMESTAMP(), ANY_VALUE(PR_FINAL_ID)
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_Final\`
          WHERE PR_FINAL_ID IN UNNEST(pr_ids_array)
          
          -- 🟢 CRITICAL GROUPING (Must match ID Gen)
          GROUP BY BOM_UPDATE, FINAL_UNIT_PRICE, VPO, COALESCE(NULLIF(TRIM(DATE_CODE), ''), NULL);

          -- D. Junction & Closure
          INSERT INTO \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_PO_Consolidation\` 
          (CONSOLIDATION_LINK_ID, CONSOLIDATION_BATCH_ID, PR_FINAL_ID, PO_DOCUMENT_ID, CONSOLIDATION_REASON, QTY_ALLOCATED_TO_PO, LINKED_AT)
          SELECT TO_HEX(MD5(CONCAT(batch_id, PR_FINAL_ID))), batch_id, PR_FINAL_ID, po_doc_id, IF(global_override_date IS NOT NULL, 'MANUAL_OVERRIDE', 'AUTO_GROUP'), QTY_APPROVED, CURRENT_TIMESTAMP()
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_Final\` WHERE PR_FINAL_ID IN UNNEST(pr_ids_array);

          UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_Final\`
          SET CONSOLIDATION_STATUS = 'CONSOLIDATED', UPDATED_BY = user_email, UPDATED_AT = CURRENT_TIMESTAMP()
          WHERE PR_FINAL_ID IN UNNEST(pr_ids_array);

          -- E. Commit Transaction (Only if everything above worked)
          COMMIT TRANSACTION;

          -- Output
          SELECT po_number AS GENERATED_PO;
          
      EXCEPTION WHEN ERROR THEN
          -- 🛑 ROLLBACK: Removes the Header if Lines fail
          ROLLBACK TRANSACTION;
          RAISE USING MESSAGE = @@error.message;
      END;
    END;
  `,


  // =========================================================
  // M3: ATOMIC ISSUANCE (The "Safe" Transaction)
  // =========================================================
  SP_M3_ATOMIC_ISSUE: `
    CREATE OR REPLACE PROCEDURE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.SP_M3_ATOMIC_ISSUE\`(
      doc_id STRING, 
      link_str STRING
    )
    BEGIN
      -- 1. Variable to catch errors
      DECLARE current_status STRING;

      -- 2. Idempotency Check: Don't run if already issued
      SET current_status = (
        SELECT PO_STATUS FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Header\` 
        WHERE PO_DOCUMENT_ID = doc_id
      );

      IF current_status = 'ISSUED' THEN
        SELECT 'ALREADY_DONE' as result_message;
      ELSE
        
        -- 3. The Atomic Block
        BEGIN TRANSACTION;
          BEGIN
            -- A. Update Header (Mark as Issued)
            UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Header\`
            SET PO_STATUS = 'ISSUED',
                FILELINK = link_str,
                ISSUED_AT = CURRENT_TIMESTAMP()
            WHERE PO_DOCUMENT_ID = doc_id;

            -- B. Handover to Logistics (Call existing SP)
            CALL \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.SP_M4_INITIALIZE_TRACKING\`(doc_id);

            -- C. Commit if both succeeded
            COMMIT TRANSACTION;
            
            SELECT 'SUCCESS' as result_message;
          
          EXCEPTION WHEN ERROR THEN
            -- D. Rollback everything if EITHER fails
            ROLLBACK TRANSACTION;
            
            -- Re-throw the error so Apps Script knows it failed
            SELECT @@error.message as result_message;
            RAISE USING MESSAGE = @@error.message;
          END;
      END IF;
    END;
  `,

  // =========================================================
  // 🚚 M4: HANDOVER LOGIC (From M3)
  // =========================================================
  SP_M4_INITIALIZE_TRACKING: `
    CREATE OR REPLACE PROCEDURE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.SP_M4_INITIALIZE_TRACKING\`(doc_id STRING)
    BEGIN
      INSERT INTO \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line_Tracking\`
      (
        PO_LINE_ID, PO_DOCUMENT_ID, BOM_UPDATE, FULFILLMENT_MODE, ORDER_QTY,
        
        -- 🟢 Pass Context to Logistics
        VPO,
        PO_LINE_NOTE,
        
        -- 🟢 NEW: Ownership Persistence (The Baton Pass)
        PIC,
        
        FINAL_REQUESTED_DELIVERY_DATE,
        STATUS, IS_ACTIVE, INITIALIZED_AT, 
        
        -- 🟡 RENAMED: Standardized Audit Columns
        UPDATED_AT,
        UPDATED_BY
      )
      SELECT
        L.PO_LINE_ID, L.PO_DOCUMENT_ID, L.BOM_UPDATE, L.FULFILLMENT_MODE, L.ORDER_QTY,
        
        -- 🟢 Context Handover
        L.VPO,
        L.PO_LINE_NOTE,
        
        -- 🟢 Capture Owner from PO Line
        L.PIC,
        
        -- The Logic: Buyer Override > System Suggestion
        COALESCE(L.BUYER_REQUESTED_DATE, L.SYSTEM_SUGGESTED_REQUESTED_DATE),
        
        'ISSUED', TRUE, CURRENT_TIMESTAMP(), 
        
        -- Audit: System action uses strict timestamp and System Identity
        CURRENT_TIMESTAMP(),
        'SYSTEM_HANDOVER' 
      FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line\` L
      LEFT JOIN \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line_Tracking\` T
        ON L.PO_LINE_ID = T.PO_LINE_ID
      WHERE L.PO_DOCUMENT_ID = doc_id
        AND T.PO_LINE_ID IS NULL;
    END;
  `,

  SP_M4_APPLY_FEEDBACK: `
      CREATE OR REPLACE PROCEDURE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.SP_M4_APPLY_FEEDBACK\`()
      BEGIN
        -- ========================================================================================
        -- STEP 1: CAPTURE THE LATEST "PENDING" FEEDBACK
        -- Logic: If a user updated the same line twice in one batch, take the latest timestamp.
        -- ========================================================================================
        CREATE TEMP TABLE Latest_Feedback AS
        SELECT * EXCEPT(rn)
        FROM (
          SELECT 
            *,
            ROW_NUMBER() OVER (PARTITION BY PO_LINE_ID ORDER BY UPDATED_AT DESC) as rn
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Supplier_Feedback_Log\`
          WHERE FEEDBACK_STATUS = 'PENDING'
        )
        WHERE rn = 1;

        -- ========================================================================================
        -- STEP 2: APPLY UPDATES TO TRACKING (The Merge)
        -- Logic: "The Executioner" - Explicit Intent (Reason) overrides Implicit Intent (Qty).
        -- ========================================================================================
        UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line_Tracking\` T
        SET 
          -- 🟢 1. QUANTITY WATERFALL (With Executioner Override)
          -- Rule: If Closure Reason is set, Force Qty to 0. Otherwise use standard input.
          T.CONFIRMED_QTY       = CASE 
                                    WHEN S.CLOSURE_REASON IS NOT NULL AND S.CLOSURE_REASON != '' THEN 0.0
                                    ELSE COALESCE(S.CONFIRMED_QTY, T.CONFIRMED_QTY)
                                  END,

          T.LOADED_QTY          = COALESCE(S.LOADED_QTY, T.LOADED_QTY),
          T.ACTUAL_RECEIVED_QTY = COALESCE(S.ACTUAL_RECEIVED_QTY, T.ACTUAL_RECEIVED_QTY),

          -- 🟢 2. TIME WATERFALL
          T.AGREED_DELIVERY_DATE = COALESCE(S.AGREED_DELIVERY_DATE, T.AGREED_DELIVERY_DATE),
          T.CURRENT_ETA          = COALESCE(S.CURRENT_ETA, T.CURRENT_ETA),
          T.ACTUAL_ARRIVAL_DATE  = COALESCE(S.ACTUAL_ARRIVAL_DATE, T.ACTUAL_ARRIVAL_DATE),

          -- 🟢 3. CONTEXT
          T.SUPPLIER_FEEDBACK_NOTE = COALESCE(S.SUPPLIER_FEEDBACK_NOTE, T.SUPPLIER_FEEDBACK_NOTE),
          
          -- 🟢 4. AUDIT BRIDGE (Assigned EXACTLY ONCE here)
          T.UPDATED_BY = S.UPDATED_BY,
          T.UPDATED_AT = CURRENT_TIMESTAMP(),

          -- 🟢 5. CLOSURE LOGIC (The Executioner)
          -- Priority 1: Explicit Code (User Selected "CUSTOMER_CANCELLED")
          -- Priority 2: Implicit Code (User typed 0 -> "SUPPLIER_DECLINED")
          T.CLOSURE_REASON = CASE
            WHEN S.CLOSURE_REASON IS NOT NULL AND S.CLOSURE_REASON != '' THEN S.CLOSURE_REASON
            WHEN S.CONFIRMED_QTY = 0 THEN 'SUPPLIER_DECLINED'
            ELSE T.CLOSURE_REASON
          END,

          -- 🟢 6. STATUS AUTOMATION
          T.STATUS = CASE
             -- Level 0: Cancellation (Explicit Reason OR Implicit Zero)
             WHEN (S.CLOSURE_REASON IS NOT NULL AND S.CLOSURE_REASON != '') OR S.CONFIRMED_QTY = 0 THEN 'CANCELLED'

             -- Level 1: Physical Arrival (Highest Priority)
             WHEN COALESCE(S.ACTUAL_ARRIVAL_DATE, T.ACTUAL_ARRIVAL_DATE) IS NOT NULL THEN 'ARRIVED'
             
             -- Level 2: Physically Moving (Loaded)
             WHEN COALESCE(S.LOADED_QTY, T.LOADED_QTY) IS NOT NULL THEN 'IN_TRANSIT'
              
             -- Level 3: The Delay Check
             WHEN COALESCE(S.CURRENT_ETA, T.CURRENT_ETA) > COALESCE(S.AGREED_DELIVERY_DATE, T.AGREED_DELIVERY_DATE, T.FINAL_REQUESTED_DELIVERY_DATE) THEN 'DELAYED'

             -- Level 4: In Transit (Has ETA)
             WHEN COALESCE(S.CURRENT_ETA, T.CURRENT_ETA) IS NOT NULL THEN 'IN_TRANSIT'
             
             -- Level 5: Confirmed
             WHEN COALESCE(S.CONFIRMED_QTY, T.CONFIRMED_QTY) IS NOT NULL THEN 'CONFIRMED'
             WHEN COALESCE(S.AGREED_DELIVERY_DATE, T.AGREED_DELIVERY_DATE) IS NOT NULL THEN 'CONFIRMED'
             
             -- Fallback
             ELSE COALESCE(T.STATUS, 'ISSUED')
          END

        FROM Latest_Feedback S
        WHERE T.PO_LINE_ID = S.PO_LINE_ID;

        -- ========================================================================================
        -- STEP 3: CLOSE THE LOOP (Mark Logs as Applied)
        -- ========================================================================================
        UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Supplier_Feedback_Log\`
        SET 
          FEEDBACK_STATUS = 'APPLIED',
          UPDATED_BY = 'SYSTEM_PROCESSOR',
          UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE FEEDBACK_STATUS = 'PENDING';
      END;
  `,

  // =========================================================
  // 🔭 M4: UI SUPPLIER PORTAL VIEW (The Interface Lens)
  // =========================================================
  UI_Supplier_Portal_VIEW: `
      CREATE OR REPLACE VIEW \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.UI_Supplier_Portal_VIEW\` AS
      SELECT
        -- 1. THE KEYS (Hidden Anchors)
        T.PO_LINE_ID,
        CAST(NULL AS STRING) AS FEEDBACK_BATCH_ID, -- Placeholder for future Write-Back
        T.PIC,

        -- 2. ZONE A: CONTEXT (Read-Only)
        -- Joined from Header to give Human Context
        COALESCE(H.PO_NUMBER_REF, 'MISSING_PO') AS PO_NUMBER_REF,
        COALESCE(H.SUPPLIER_NAME, 'UNKNOWN_SUPPLIER') AS SUPPLIER_NAME,
        
        T.BOM_UPDATE,
        T.VPO,
        T.DATE_CODE,
        T.FULFILLMENT_MODE,
        T.ORDER_QTY,
        T.FINAL_REQUESTED_DELIVERY_DATE,
        T.PO_LINE_NOTE,

        -- 3. ZONE B: FEEDBACK (The Living State)
        -- This pre-fills the sheet with the latest known status
        T.CLOSURE_REASON, 
        T.CONFIRMED_QTY,
        T.AGREED_DELIVERY_DATE,
        T.CURRENT_ETA,
        T.LOADED_QTY,
        T.ACTUAL_ARRIVAL_DATE,
        T.ACTUAL_RECEIVED_QTY,
        T.SUPPLIER_FEEDBACK_NOTE,

        -- 4. META (System Fields)
        T.STATUS,
        CAST(NULL AS STRING) AS VALIDATION_STATUS, -- Placeholder for UI logic
        T.UPDATED_BY,
        T.UPDATED_AT

      FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line_Tracking\` T
      LEFT JOIN \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Header\` H
        ON T.PO_DOCUMENT_ID = H.PO_DOCUMENT_ID
      
      -- 🛡️ SECURITY FILTER
      -- Only show Active lines. "Janitor-cleaned" lines (Archived) are hidden.
      WHERE T.IS_ACTIVE = TRUE
  `,

  // ==========================================================================
  // 🚚 MODULE 4: EXECUTION (V4.0 - STABILITY PROTOCOL)
  // ==========================================================================

  SP_M4_FILTER: `
    CREATE OR REPLACE PROCEDURE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.SP_M4_FILTER\`()
    BEGIN
      -- 1. CLEAN SLATE
      TRUNCATE TABLE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Stock_Count_Staging\`;

      -- 2. ATOMIC SNAPSHOT AGGREGATION (Last Batch Wins)
      INSERT INTO \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Stock_Count_Staging\` 
      (STAGING_ID, UPLOAD_BATCH_ID, BOM_UPDATE, BOM_VIETNAMESE_DESCRIPTION, TOTAL_COUNT_QTY, SNAPSHOT_DATE)
      SELECT
        \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.FN_GENERATE_HASH\`(ANY_VALUE(U.UPLOAD_BATCH_ID), U.RAW_BOM_UPDATE),
        ANY_VALUE(U.UPLOAD_BATCH_ID), 
        U.RAW_BOM_UPDATE,
        ANY_VALUE(U.BOM_VIETNAMESE_DESCRIPTION),
        SUM(CAST(U.RAW_QTY AS FLOAT64)), 
        
        -- 🟢 V4 FIX: Trust Extracted Date, fallback to Upload Date (for legacy compatibility)
        COALESCE(
          ANY_VALUE(U.EXTRACTED_SNAPSHOT_DATE), 
          CAST(MAX(U.UPLOADED_AT) AS DATE)
        )
        
      FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Stock_Count_Upload\` U
      WHERE U.UPLOAD_BATCH_ID = (
          SELECT UPLOAD_BATCH_ID 
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Stock_Count_Upload\` 
          ORDER BY UPLOADED_AT DESC 
          LIMIT 1
      )
      AND U.RAW_BOM_UPDATE IS NOT NULL 
      AND U.RAW_BOM_UPDATE != ''
      GROUP BY U.RAW_BOM_UPDATE;
    END;
  `,

  SP_M4_VARIANCE_CALC: `
      CREATE OR REPLACE PROCEDURE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.SP_M4_VARIANCE_CALC\`()
      BEGIN
         -- 1. LOGGING THE TRUTH
         INSERT INTO \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Inventory_Variance_Log\`
         (VARIANCE_ID, SNAPSHOT_DATE, BOM_UPDATE, VARIANCE_CATEGORY, LOGGED_AT)
         SELECT
           -- 🟢 Deterministic ID: VAR_ + Hash(BOM + Date)
           CONCAT('VAR_', \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.FN_GENERATE_HASH\`(BOM_UPDATE, CAST(SNAPSHOT_DATE AS STRING))),
           
           SNAPSHOT_DATE,
           BOM_UPDATE,
           'NORMAL', -- Default verdict for Phase 2
           CURRENT_TIMESTAMP()
         FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Stock_Count_Staging\`;
      END;
  `,

  SP_M4_JANITOR: `
    CREATE OR REPLACE PROCEDURE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.SP_M4_JANITOR\`()
    BEGIN
      -- Close items that are > 7 days past their FINAL known date
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line_Tracking\`
      SET 
        STATUS = 'ASSUMED_RECEIVED',
        IS_ACTIVE = FALSE,
        CLOSURE_REASON = 'AUTO_JANITOR_OVERDUE',
        
        -- 🟢 Audit Standardization
        UPDATED_BY = 'SYSTEM_JANITOR',
        UPDATED_AT = CURRENT_TIMESTAMP()
      WHERE 
        IS_ACTIVE = TRUE
        
        -- 🧠 SMART LOGIC: The Closure Waterfall
        -- Rule: If the effective date was > 7 days ago, we archive it.
        -- Matches the hierarchy in Unified_Supply_Stack_VIEW for consistency.
        AND COALESCE(ACTUAL_ARRIVAL_DATE, CURRENT_ETA, AGREED_DELIVERY_DATE, FINAL_REQUESTED_DELIVERY_DATE) <= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY);
    END;
  `,

  SP_M4_RESET_STOCK: `
    CREATE OR REPLACE PROCEDURE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.SP_M4_RESET_STOCK\`()
    BEGIN
      -- ═══════════════════════════════════════════════════════════════════════
      -- 🛡️ CIRCUIT BREAKER (V4 NEW)
      -- Prevent catastrophic data loss if Staging is empty
      -- ═══════════════════════════════════════════════════════════════════════
      DECLARE staging_count INT64;
      
      SET staging_count = (
        SELECT COUNT(*) 
        FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Stock_Count_Staging\`
      );

      IF staging_count = 0 THEN
        RAISE USING MESSAGE = 'CIRCUIT_BREAKER_TRIGGERED: Stock_Count_Staging is empty. Refusing to truncate Stock_Data to prevent false shortages. Check upstream upload process.';
      END IF;

      -- ═══════════════════════════════════════════════════════════════════════
      -- 1. WIPE THE SLATE (Only if Circuit Breaker passed)
      -- ═══════════════════════════════════════════════════════════════════════
      TRUNCATE TABLE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Stock_Data\`;

      -- ═══════════════════════════════════════════════════════════════════════
      -- 2. INSERT NEW TRUTH
      -- ═══════════════════════════════════════════════════════════════════════
      INSERT INTO \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Stock_Data\`
      (
        STOCK_ID, 
        BOM_UPDATE, 
        BOM_VIETNAMESE_DESCRIPTION,
        INVENTORY_QTY, 
        SNAPSHOT_DATE, 
        FULFILLMENT_MODE, 
        UPDATED_BY,
        UPDATED_AT
      )
      SELECT
        CONCAT('STK_', \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.FN_GENERATE_HASH\`(S.BOM_UPDATE, CAST(S.SNAPSHOT_DATE AS STRING))),
        S.BOM_UPDATE,
        S.BOM_VIETNAMESE_DESCRIPTION,
        S.TOTAL_COUNT_QTY,
        S.SNAPSHOT_DATE, 
        CASE 
          WHEN LOWER(TRIM(M.MAIN_GROUP)) = 'bao bì' THEN 'PRIVATE'
          ELSE 'PUBLIC'
        END,
        'MONDAY_PROTOCOL',
        CURRENT_TIMESTAMP()
      FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Stock_Count_Staging\` S
      LEFT JOIN \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Data\` M 
        ON S.BOM_UPDATE = M.BOM_UPDATE;
    END;
  `,

  // ═══════════════════════════════════════════════════════════════════════════
  // 🏭 SP_INJECT_DIRECT_PO (V7.4: INJ_ prefix harmonization)
  // Purpose: Safely inject manual/external POs via the Direct Injection Portal
  //   Pipeline: Direct Injection │ ID Prefix: INJ_DOC_ / INJ_LINE_
  //   PO_ORIGIN: 'DIRECT_INJECTION' │ Session: INJ_SESSION_ + id
  //   UI: M4_Injection_Portal_Main.gs → PO_Direct_Injection_Staging → this SP
  // ═══════════════════════════════════════════════════════════════════════════

  SP_INJECT_DIRECT_PO: `
    CREATE OR REPLACE PROCEDURE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.SP_INJECT_DIRECT_PO\`(
      IN p_session_id STRING
    )
    BEGIN
      -- ═══════════════════════════════════════════════════════════════════════════
      -- DECLARATION
      -- ═══════════════════════════════════════════════════════════════════════════
      DECLARE v_pending_count INT64;
      DECLARE v_error_count INT64;
      DECLARE v_validated_count INT64;
      DECLARE v_committed_count INT64;
      DECLARE v_current_date DATE DEFAULT CURRENT_DATE();
      DECLARE v_janitor_threshold DATE DEFAULT DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY);

      -- ═══════════════════════════════════════════════════════════════════════════
      -- PHASE 0: INITIALIZATION
      -- Reset any previous validation attempts for this session
      -- ═══════════════════════════════════════════════════════════════════════════
      
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Direct_Injection_Staging\`
      SET 
        VALIDATION_STATUS = 'PENDING',
        ERROR_MESSAGE = NULL,
        RESOLVED_SUPPLIER_ID = NULL,
        DERIVED_FULFILLMENT_MODE = NULL,
        GENERATED_PO_DOC_ID = NULL,
        GENERATED_PO_LINE_ID = NULL,
        DERIVED_STATUS = NULL
      WHERE SESSION_ID = p_session_id;

      -- Count pending rows
      SET v_pending_count = (
        SELECT COUNT(*) 
        FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Direct_Injection_Staging\`
        WHERE SESSION_ID = p_session_id AND VALIDATION_STATUS = 'PENDING'
      );

      IF v_pending_count = 0 THEN
        RAISE USING MESSAGE = CONCAT('No pending rows found for session: ', p_session_id);
      END IF;

      -- ═══════════════════════════════════════════════════════════════════════════
      -- PHASE 1: VALIDATION (The Firewall)
      -- ═══════════════════════════════════════════════════════════════════════════

      -- ─────────────────────────────────────────────────────────────────────────────
      -- 1A. Validate BOM_UPDATE exists in BOM_Data
      -- ─────────────────────────────────────────────────────────────────────────────
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Direct_Injection_Staging\` S
      SET 
        VALIDATION_STATUS = 'ERROR',
        ERROR_MESSAGE = CONCAT('Invalid Item: "', COALESCE(S.BOM_UPDATE, 'NULL'), '" not found in BOM_Data master.')
      WHERE S.SESSION_ID = p_session_id
        AND S.VALIDATION_STATUS = 'PENDING'
        AND (
          S.BOM_UPDATE IS NULL 
          OR TRIM(S.BOM_UPDATE) = ''
          OR NOT EXISTS (
            SELECT 1 FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Data\` B 
            WHERE B.BOM_UPDATE = TRIM(S.BOM_UPDATE)
              AND B.BOM_STATUS = 'ACTIVE' 
          )
        );

      -- ─────────────────────────────────────────────────────────────────────────────
      -- 1B. Validate SUPPLIER_NAME exists in Supplier_Information
      -- ─────────────────────────────────────────────────────────────────────────────
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Direct_Injection_Staging\` S
      SET 
        VALIDATION_STATUS = 'ERROR',
        ERROR_MESSAGE = CONCAT('Invalid Supplier: "', COALESCE(S.SUPPLIER_NAME, 'NULL'), '" not found in Supplier master.')
      WHERE S.SESSION_ID = p_session_id
        AND S.VALIDATION_STATUS = 'PENDING'
        AND (
          S.SUPPLIER_NAME IS NULL 
          OR TRIM(S.SUPPLIER_NAME) = ''
          OR NOT EXISTS (
            SELECT 1 FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Supplier_Information\` I 
            WHERE LOWER(TRIM(I.SUPPLIER_NAME)) = LOWER(TRIM(S.SUPPLIER_NAME))
          )
        );

      -- ─────────────────────────────────────────────────────────────────────────────
      -- 1C. Validate QUANTITY > 0  AND  PRICE >= 0
      -- ─────────────────────────────────────────────────────────────────────────────
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Direct_Injection_Staging\` S
      SET 
        VALIDATION_STATUS = 'ERROR',
        ERROR_MESSAGE = CASE 
          WHEN S.ORDER_QTY <= 0 THEN CONCAT('Invalid Quantity: Must be > 0. Got: ', CAST(COALESCE(S.ORDER_QTY, 0) AS STRING))
          WHEN S.UNIT_PRICE < 0 THEN CONCAT('Invalid Price: Must be >= 0. Got: ', CAST(COALESCE(S.UNIT_PRICE, 0) AS STRING))
        END
      WHERE S.SESSION_ID = p_session_id
        AND S.VALIDATION_STATUS = 'PENDING'
        AND (
             (S.ORDER_QTY IS NULL OR S.ORDER_QTY <= 0)
          OR (S.UNIT_PRICE IS NOT NULL AND S.UNIT_PRICE < 0)
        );

      -- ─────────────────────────────────────────────────────────────────────────────
      -- 1D. Validate PIC is not empty
      -- ─────────────────────────────────────────────────────────────────────────────
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Direct_Injection_Staging\` S
      SET 
        VALIDATION_STATUS = 'ERROR',
        ERROR_MESSAGE = 'Missing Owner: PIC is required to prevent ghost records.'
      WHERE S.SESSION_ID = p_session_id
        AND S.VALIDATION_STATUS = 'PENDING'
        AND (S.PIC IS NULL OR TRIM(S.PIC) = '');

      -- ─────────────────────────────────────────────────────────────────────────────
      -- 1E. Validate Date Logic (Janitor Defense)
      -- ─────────────────────────────────────────────────────────────────────────────
      -- 1E-i: At least one date must exist
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Direct_Injection_Staging\` S
      SET 
        VALIDATION_STATUS = 'ERROR',
        ERROR_MESSAGE = 'Missing Date: At least one date (FINAL_REQUESTED, AGREED, or CURRENT_ETA) is required.'
      WHERE S.SESSION_ID = p_session_id
        AND S.VALIDATION_STATUS = 'PENDING'
        AND S.FINAL_REQUESTED_DELIVERY_DATE IS NULL
        AND S.AGREED_DELIVERY_DATE IS NULL
        AND S.CURRENT_ETA IS NULL;

      -- 1E-ii: If best available date is too old, reject
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Direct_Injection_Staging\` S
      SET 
        VALIDATION_STATUS = 'ERROR',
        ERROR_MESSAGE = CONCAT('Janitor Defense: Dates are too old (Threshold: ', CAST(v_janitor_threshold AS STRING), '). Provide future CURRENT_ETA.')
      WHERE S.SESSION_ID = p_session_id
        AND S.VALIDATION_STATUS = 'PENDING'
        AND COALESCE(S.CURRENT_ETA, S.AGREED_DELIVERY_DATE, S.FINAL_REQUESTED_DELIVERY_DATE) <= v_janitor_threshold;


      -- ═══════════════════════════════════════════════════════════════════════════
      -- PHASE 2: DERIVATION (The Enrichment)
      -- ═══════════════════════════════════════════════════════════════════════════

      -- ─────────────────────────────────────────────────────────────────────────────
      -- 2A. Resolve SUPPLIER_ID (Critical for next step)
      -- ─────────────────────────────────────────────────────────────────────────────
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Direct_Injection_Staging\` S
      SET RESOLVED_SUPPLIER_ID = I.SUPPLIER_ID
      FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Supplier_Information\` I
      WHERE LOWER(TRIM(I.SUPPLIER_NAME)) = LOWER(TRIM(S.SUPPLIER_NAME))
        AND S.SESSION_ID = p_session_id
        AND S.VALIDATION_STATUS = 'PENDING';

      -- ─────────────────────────────────────────────────────────────────────────────
      -- 2B. Derive FULFILLMENT_MODE (🟢 FIXED: Based on BOM_Data Product Group)
      -- ─────────────────────────────────────────────────────────────────────────────
      -- Logic: If BOM MAIN_GROUP = 'Bao Bì' -> PRIVATE (specific packaging)
      --        All other items -> PUBLIC (general allocation)
      -- This aligns with ERD Module4 Line 73 and M1/M2 system logic.
      -- ─────────────────────────────────────────────────────────────────────────────
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Direct_Injection_Staging\` S
      SET DERIVED_FULFILLMENT_MODE = 
        CASE 
          WHEN EXISTS (
            SELECT 1 
            FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Data\` B
            WHERE B.BOM_UPDATE = TRIM(S.BOM_UPDATE) 
              AND LOWER(TRIM(B.MAIN_GROUP)) = 'bao bì'
          ) THEN 'PRIVATE'
          ELSE 'PUBLIC'
        END
      WHERE S.SESSION_ID = p_session_id
        AND S.VALIDATION_STATUS = 'PENDING';

      -- ─────────────────────────────────────────────────────────────────────────────
      -- 2C. Derive STATUS from inputs
      -- ─────────────────────────────────────────────────────────────────────────────
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Direct_Injection_Staging\` S
      SET DERIVED_STATUS = CASE
        WHEN S.LOADED_QTY IS NOT NULL AND S.LOADED_QTY > 0 THEN 'IN_TRANSIT'
        WHEN S.CONFIRMED_QTY IS NOT NULL OR S.AGREED_DELIVERY_DATE IS NOT NULL THEN 'CONFIRMED'
        ELSE 'ISSUED'
      END
      WHERE S.SESSION_ID = p_session_id
        AND S.VALIDATION_STATUS = 'PENDING';

      -- ─────────────────────────────────────────────────────────────────────────────
      -- 2D. Generate Deterministic IDs
      -- ─────────────────────────────────────────────────────────────────────────────
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Direct_Injection_Staging\` S
      SET 
        GENERATED_PO_DOC_ID = CONCAT(
          'INJ_DOC_',
          TO_HEX(MD5(CONCAT(S.SESSION_ID, '|', LOWER(TRIM(S.SUPPLIER_NAME)))))
        ),
        GENERATED_PO_LINE_ID = CONCAT(
          'INJ_LINE_',
          TO_HEX(MD5(CONCAT(S.SESSION_ID, '|', CAST(S.ROW_NUMBER AS STRING), '|', TRIM(S.BOM_UPDATE))))
        )
      WHERE S.SESSION_ID = p_session_id
        AND S.VALIDATION_STATUS = 'PENDING';

      -- ─────────────────────────────────────────────────────────────────────────────
      -- 2E. Mark as VALIDATED (ready for commit)
      -- ─────────────────────────────────────────────────────────────────────────────
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Direct_Injection_Staging\` S
      SET VALIDATION_STATUS = 'VALIDATED'
      WHERE S.SESSION_ID = p_session_id
        AND S.VALIDATION_STATUS = 'PENDING'
        AND S.RESOLVED_SUPPLIER_ID IS NOT NULL
        AND S.DERIVED_FULFILLMENT_MODE IS NOT NULL
        AND S.GENERATED_PO_DOC_ID IS NOT NULL
        AND S.GENERATED_PO_LINE_ID IS NOT NULL;

      -- Check if we have anything to commit
      SET v_validated_count = (
        SELECT COUNT(*) 
        FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Direct_Injection_Staging\`
        WHERE SESSION_ID = p_session_id AND VALIDATION_STATUS = 'VALIDATED'
      );

      IF v_validated_count = 0 THEN
        RETURN; -- Exit if nothing passed validation
      END IF;

      -- ═══════════════════════════════════════════════════════════════════════════
      -- PHASE 3: COMMIT (The Transaction)
      -- ═══════════════════════════════════════════════════════════════════════════

      -- 3A. INSERT PO_Header (Uses GROUP BY - naturally handles duplicates)
      INSERT INTO \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Header\` (
        PO_DOCUMENT_ID, CONSOLIDATION_BATCH_ID, SUPPLIER_ID, SUPPLIER_NAME, PO_NUMBER_REF,
        ORDER_DATE, TOTAL_AMOUNT, LINE_COUNT, PO_DUE_DATE, PO_STATUS, PO_ORIGIN,
        FILELINK, CREATED_BY, CREATED_AT, ISSUED_AT
      )
      SELECT 
        S.GENERATED_PO_DOC_ID,
        CONCAT('INJ_SESSION_', S.SESSION_ID),
        S.RESOLVED_SUPPLIER_ID,
        INITCAP(TRIM(S.SUPPLIER_NAME)),
        COALESCE(MAX(S.LEGACY_PO_REF), CONCAT('INJ-', FORMAT_DATE('%Y%m%d', CURRENT_DATE()), '-', SUBSTR(S.GENERATED_PO_DOC_ID, 9, 8))),
        COALESCE(MAX(S.ORIGINAL_ORDER_DATE), CURRENT_DATE()),
        SUM(S.ORDER_QTY * COALESCE(S.UNIT_PRICE, 0)),
        COUNT(*),
        MIN(COALESCE(S.CURRENT_ETA, S.AGREED_DELIVERY_DATE, S.FINAL_REQUESTED_DELIVERY_DATE)),
        'ISSUED',
        'DIRECT_INJECTION',
        CAST(NULL AS STRING),
        MAX(S.UPLOADED_BY),
        CURRENT_TIMESTAMP(),
        CURRENT_TIMESTAMP()
      FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Direct_Injection_Staging\` S
      WHERE S.SESSION_ID = p_session_id AND S.VALIDATION_STATUS = 'VALIDATED'
      GROUP BY S.GENERATED_PO_DOC_ID, S.RESOLVED_SUPPLIER_ID, S.SUPPLIER_NAME, S.SESSION_ID
      HAVING NOT EXISTS (SELECT 1 FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Header\` H WHERE H.PO_DOCUMENT_ID = S.GENERATED_PO_DOC_ID);

      -- ─────────────────────────────────────────────────────────────────────────────
      -- 3B. INSERT PO_Line (🟢 FIXED: Highlander Deduplication)
      -- ─────────────────────────────────────────────────────────────────────────────
      -- The "Highlander Rule": When multiple staging rows have the same GENERATED_PO_LINE_ID
      -- (due to re-uploads with WRITE_APPEND), we pick only the LATEST one (by UPLOADED_AT).
      -- This prevents duplicate inserts into the target table.
      -- ─────────────────────────────────────────────────────────────────────────────
      INSERT INTO \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line\` (
        PO_LINE_ID, PO_DOCUMENT_ID, PIC, BOM_UPDATE, FULFILLMENT_MODE, PR_FINAL_ID,
        ORDER_QTY, UNIT_PRICE, LINE_TOTAL, VPO, PO_LINE_NOTE,
        SYSTEM_SUGGESTED_REQUESTED_DATE, BUYER_REQUESTED_DATE, DATE_CODE, LINE_NUMBER, CREATED_AT
      )
      SELECT 
        S.GENERATED_PO_LINE_ID,
        S.GENERATED_PO_DOC_ID,
        INITCAP(TRIM(S.PIC)),
        TRIM(S.BOM_UPDATE),
        S.DERIVED_FULFILLMENT_MODE,
        NULL,
        S.ORDER_QTY,
        COALESCE(S.UNIT_PRICE, 0),
        ROUND(S.ORDER_QTY * COALESCE(S.UNIT_PRICE, 0), 2),  -- V7.3: float precision
        COALESCE(NULLIF(TRIM(S.VPO), ''), 'GENERAL_STOCK'),
        S.PO_LINE_NOTE,
        COALESCE(S.CURRENT_ETA, S.AGREED_DELIVERY_DATE, S.FINAL_REQUESTED_DELIVERY_DATE),
        NULL, NULL, S.ROW_NUMBER, CURRENT_TIMESTAMP()
      FROM (
          -- 🛡️ HIGHLANDER RULE: Pick only the LATEST upload per Line ID
          SELECT * EXCEPT(rn) FROM (
            SELECT *, ROW_NUMBER() OVER(PARTITION BY GENERATED_PO_LINE_ID ORDER BY UPLOADED_AT DESC) as rn
            FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Direct_Injection_Staging\`
            WHERE SESSION_ID = p_session_id AND VALIDATION_STATUS = 'VALIDATED'
          ) WHERE rn = 1
      ) S
      WHERE NOT EXISTS (SELECT 1 FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line\` L WHERE L.PO_LINE_ID = S.GENERATED_PO_LINE_ID);

      -- ─────────────────────────────────────────────────────────────────────────────
      -- 3C. INSERT PO_Line_Tracking (🟢 FIXED: Highlander Deduplication)
      -- ─────────────────────────────────────────────────────────────────────────────
      -- Same "Highlander Rule" applied here to prevent duplicate tracking records.
      -- ─────────────────────────────────────────────────────────────────────────────
      INSERT INTO \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line_Tracking\` (
        PO_LINE_ID, PO_DOCUMENT_ID, BOM_UPDATE, FULFILLMENT_MODE, VPO, PIC, PO_LINE_NOTE,
        ORDER_QTY, CONFIRMED_QTY, LOADED_QTY, ACTUAL_RECEIVED_QTY,
        FINAL_REQUESTED_DELIVERY_DATE, AGREED_DELIVERY_DATE, CURRENT_ETA, ACTUAL_ARRIVAL_DATE,
        SUPPLIER_FEEDBACK_NOTE, STATUS, CLOSURE_REASON, IS_ACTIVE, DATE_CODE,
        INITIALIZED_AT, UPDATED_BY, UPDATED_AT
      )
      SELECT 
        S.GENERATED_PO_LINE_ID,
        S.GENERATED_PO_DOC_ID,
        TRIM(S.BOM_UPDATE),
        S.DERIVED_FULFILLMENT_MODE,
        COALESCE(NULLIF(TRIM(S.VPO), ''), 'GENERAL_STOCK'),
        INITCAP(TRIM(S.PIC)),
        S.PO_LINE_NOTE,
        S.ORDER_QTY, S.CONFIRMED_QTY, S.LOADED_QTY, NULL,
        S.FINAL_REQUESTED_DELIVERY_DATE, S.AGREED_DELIVERY_DATE, S.CURRENT_ETA, NULL,
        NULL, S.DERIVED_STATUS, NULL, TRUE, NULL,
        CURRENT_TIMESTAMP(), S.UPLOADED_BY, CURRENT_TIMESTAMP()
      FROM (
          -- 🛡️ HIGHLANDER RULE: Pick only the LATEST upload per Line ID
          SELECT * EXCEPT(rn) FROM (
            SELECT *, ROW_NUMBER() OVER(PARTITION BY GENERATED_PO_LINE_ID ORDER BY UPLOADED_AT DESC) as rn
            FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Direct_Injection_Staging\`
            WHERE SESSION_ID = p_session_id AND VALIDATION_STATUS = 'VALIDATED'
          ) WHERE rn = 1
      ) S
      WHERE NOT EXISTS (SELECT 1 FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line_Tracking\` T WHERE T.PO_LINE_ID = S.GENERATED_PO_LINE_ID);

      -- 3D. Mark COMMITTED
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Direct_Injection_Staging\` S
      SET VALIDATION_STATUS = 'COMMITTED'
      WHERE S.SESSION_ID = p_session_id
        AND S.VALIDATION_STATUS = 'VALIDATED'
        AND EXISTS (SELECT 1 FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line_Tracking\` T WHERE T.PO_LINE_ID = S.GENERATED_PO_LINE_ID);

      -- ═══════════════════════════════════════════════════════════════════════════
      -- PHASE 4: SUMMARY
      -- ═══════════════════════════════════════════════════════════════════════════
      SET v_committed_count = (SELECT COUNT(*) FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Direct_Injection_Staging\` WHERE SESSION_ID = p_session_id AND VALIDATION_STATUS = 'COMMITTED');
      SET v_error_count = (SELECT COUNT(*) FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Direct_Injection_Staging\` WHERE SESSION_ID = p_session_id AND VALIDATION_STATUS = 'ERROR');

      SELECT p_session_id AS session_id, v_pending_count AS total_rows, v_committed_count AS committed_rows, v_error_count AS error_rows, CURRENT_TIMESTAMP() AS completed_at;

    END;
  `,

  // ═══════════════════════════════════════════════════════════════════════════
  // 🔄 M4: ZXH PO AUTO SYNC
  // Purpose: Nightly sync of PO tracking data from ZXH Corporation (外协) file
  //   Pipeline: ZXH AutoSync │ ID Prefix: ZXH_DOC_ / ZXH_LINE_
  //   PO_ORIGIN: 'ZXH_AUTO_SYNC' │ ROBOT: 'M4_ZXH_SYNC_ROBOT'
  //   Source: https://docs.google.com/spreadsheets/d/1fBwwxkC_z-xtjB1uQpF8-C0KpwGjnNe8ICH6fbv7uro
  // ═══════════════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════════
  // 📦 SP_M4_ISSUANCE_MERGE (V1.0 — Phase 3 Material Issuance Pipeline)
  // Purpose: MERGE cumulative issued-qty data from Material_Issuance_Staging
  //   into Material_Issuance (the live BQ table read by Material_Demand_VIEW).
  //   Pipeline: M4 Issuance AutoSync │ Robot: M4_ISSUANCE_ROBOT
  //   Key: BOM_UPDATE + VPO (compound natural key, one row per BOM × VPO pair)
  //   Strategy: REPLACE on match (cumulative data → latest value wins)
  //             INSERT on no match (new BOM/VPO combination)
  // ═══════════════════════════════════════════════════════════════════════════
  SP_M4_ISSUANCE_MERGE: `
    CREATE OR REPLACE PROCEDURE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.SP_M4_ISSUANCE_MERGE\`(
      IN p_session_id STRING,
      IN p_source_id  STRING
    )
    BEGIN
      -- ════════════════════════════════════════════════════════════════
      -- VARIABLE DECLARATIONS
      -- ════════════════════════════════════════════════════════════════
      DECLARE v_staged       INT64 DEFAULT 0;
      DECLARE v_inserted     INT64 DEFAULT 0;
      DECLARE v_updated      INT64 DEFAULT 0;
      DECLARE v_orphan_count INT64 DEFAULT 0;
      DECLARE v_status       STRING DEFAULT 'RUNNING';

      -- ════════════════════════════════════════════════════════════════
      -- PHASE 1: COUNT STAGED ROWS
      -- ════════════════════════════════════════════════════════════════
      SET v_staged = (
        SELECT COUNT(*)
        FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Issuance_Staging\`
        WHERE SYNC_BATCH_ID = p_session_id
          AND SOURCE_ID = p_source_id
      );

      IF v_staged = 0 THEN
        SELECT
          p_session_id  AS SESSION_ID,
          0             AS STAGED_COUNT,
          0             AS INSERTED_COUNT,
          0             AS UPDATED_COUNT,
          0             AS ORPHAN_COUNT,
          'NO_DATA'     AS SP_STATUS;
        RETURN;
      END IF;

      -- ════════════════════════════════════════════════════════════════
      -- PHASE 2: MERGE — Upsert into Material_Issuance
      --   Key: BOM_UPDATE + VPO (compound natural key)
      --   MATCHED:     Update CUMULATIVE_ISSUANCE_QTY + metadata
      --   NOT MATCHED: Insert full row
      -- Note: CUMULATIVE data → latest value REPLACES existing.
      --   This is intentional: warehouse always has the running total.
      --   Self-correcting: if warehouse corrects a value, next sync fixes BQ.
      -- ════════════════════════════════════════════════════════════════
      MERGE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Issuance\` T
      USING (
        SELECT
          ISSUANCE_ID,
          BOM_UPDATE,
          VPO,
          CUMULATIVE_ISSUANCE_QTY,
          CAST(SNAPSHOT_DATE AS DATE) AS SNAPSHOT_DATE,
          SOURCE_BOM_CODE,
          SYNC_BATCH_ID,
          CAST(SYNCED_AT AS TIMESTAMP) AS SYNCED_AT,
          SOURCE_ID,
          MAIN_GROUP,
          RESOLUTION_METHOD
        FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Issuance_Staging\`
        WHERE SYNC_BATCH_ID = p_session_id
          AND SOURCE_ID = p_source_id
      ) S
      ON T.BOM_UPDATE = S.BOM_UPDATE
        AND T.VPO = S.VPO
        AND T.SOURCE_ID = S.SOURCE_ID

      WHEN MATCHED THEN
        UPDATE SET
          T.CUMULATIVE_ISSUANCE_QTY = S.CUMULATIVE_ISSUANCE_QTY,
          T.SNAPSHOT_DATE           = S.SNAPSHOT_DATE,
          T.SOURCE_BOM_CODE         = S.SOURCE_BOM_CODE,
          T.SYNC_BATCH_ID           = S.SYNC_BATCH_ID,
          T.SYNCED_AT               = S.SYNCED_AT,
          T.RESOLUTION_METHOD       = S.RESOLUTION_METHOD

      WHEN NOT MATCHED THEN
        INSERT (
          ISSUANCE_ID, BOM_UPDATE, VPO, CUMULATIVE_ISSUANCE_QTY,
          SNAPSHOT_DATE, SOURCE_BOM_CODE, SYNC_BATCH_ID, SYNCED_AT,
          SOURCE_ID, MAIN_GROUP, RESOLUTION_METHOD
        )
        VALUES (
          S.ISSUANCE_ID, S.BOM_UPDATE, S.VPO, S.CUMULATIVE_ISSUANCE_QTY,
          S.SNAPSHOT_DATE, S.SOURCE_BOM_CODE, S.SYNC_BATCH_ID, S.SYNCED_AT,
          S.SOURCE_ID, S.MAIN_GROUP, S.RESOLUTION_METHOD
        );

      -- Note: BQ MERGE does not expose per-operation @@row_count natively.
      -- We derive counts from post-MERGE state comparing to staging.
      SET v_inserted = (
        SELECT COUNT(*)
        FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Issuance\` T
        INNER JOIN \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Issuance_Staging\` S
          ON T.BOM_UPDATE = S.BOM_UPDATE AND T.VPO = S.VPO AND T.SOURCE_ID = S.SOURCE_ID
        WHERE S.SYNC_BATCH_ID = p_session_id
          AND S.SOURCE_ID = p_source_id
          AND T.SYNC_BATCH_ID = p_session_id   -- Only rows inserted/updated in this run
      );

      -- Updated = rows where SYNC_BATCH_ID matches (they existed before this run AND were updated)
      SET v_updated = v_inserted; -- Conservative: count all merged rows as updated (exact split not needed)

      -- ════════════════════════════════════════════════════════════════
      -- PHASE 3: ORPHAN DETECTION
      --   Orphans = rows in Material_Issuance for this SOURCE_ID that
      --   were NOT seen in the latest staging batch.
      --   These are stale BOM×VPO pairs (completed or cancelled).
      -- ════════════════════════════════════════════════════════════════
      SET v_orphan_count = (
        SELECT COUNT(*)
        FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Issuance\` T
        WHERE T.SOURCE_ID = p_source_id
          AND NOT EXISTS (
            SELECT 1
            FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Issuance_Staging\` S
            WHERE S.BOM_UPDATE = T.BOM_UPDATE
              AND S.VPO = T.VPO
              AND S.SOURCE_ID = T.SOURCE_ID
              AND S.SYNC_BATCH_ID = p_session_id
          )
      );

      -- ════════════════════════════════════════════════════════════════
      -- PHASE 4: SUMMARY RESULT
      -- Returns 1 row matching the standard SP result contract used
      -- by Apps Script _parseIssuanceSpResult()
      -- ════════════════════════════════════════════════════════════════
      SET v_status = 'SUCCESS';

      SELECT
        p_session_id    AS SESSION_ID,
        v_staged        AS STAGED_COUNT,
        v_inserted      AS INSERTED_COUNT,
        v_updated       AS UPDATED_COUNT,
        v_orphan_count  AS ORPHAN_COUNT,
        v_status        AS SP_STATUS;

    EXCEPTION WHEN ERROR THEN
      SELECT
        p_session_id                          AS SESSION_ID,
        v_staged                              AS STAGED_COUNT,
        0                                     AS INSERTED_COUNT,
        0                                     AS UPDATED_COUNT,
        0                                     AS ORPHAN_COUNT,
        CONCAT('SP_ERROR: ', @@error.message) AS SP_STATUS;
    END;
  `,

  SP_SYNC_ZXH_PO: `
    CREATE OR REPLACE PROCEDURE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.SP_SYNC_ZXH_PO\`(
      IN p_session_id STRING
    )
    BEGIN
      -- ════════════════════════════════════════════════════════════════
      -- VARIABLE DECLARATIONS
      -- ════════════════════════════════════════════════════════════════
      DECLARE v_staged INT64 DEFAULT 0;
      DECLARE v_validated INT64 DEFAULT 0;
      DECLARE v_inserted INT64 DEFAULT 0;
      DECLARE v_updated INT64 DEFAULT 0;
      DECLARE v_orphan_count INT64 DEFAULT 0;
      DECLARE v_orphan_ids STRING DEFAULT '';
      DECLARE v_status STRING DEFAULT 'RUNNING';

      -- ════════════════════════════════════════════════════════════════
      -- PHASE 1: COUNT STAGED ROWS
      -- ════════════════════════════════════════════════════════════════
      SET v_staged = (
        SELECT COUNT(*) FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.ZXH_PO_AutoSync_Staging\`
        WHERE SESSION_ID = p_session_id
      );

      -- ════════════════════════════════════════════════════════════════
      -- PHASE 2: VALIDATE — Build Validated_Staging temp table
      --   Filters:
      --   ✅ BOM_CODE must exist in BOM_Data with BOM_STATUS = 'ACTIVE'
      --   ✅ Joins to BOM_Data for FULFILLMENT_MODE derivation
      --   ✅ Joins to Supplier_Information for SUPPLIER_ID resolution
      -- ════════════════════════════════════════════════════════════════
      CREATE TEMP TABLE Validated_Staging AS
      SELECT
        s.GENERATED_PO_LINE_ID,
        s.GENERATED_PO_DOC_ID,
        s.INV,
        s.BOM_CODE,
        s.PO_NUMBER_REF,
        s.SUPPLIER_NAME,
        s.GROSS_QTY,
        s.REQUIRE_DATE,
        s.REMARK,
        s.ZXH_STATUS,
        s.ETA,
        -- ── DERIVED: PIC (BOM_Data owner > staging fallback > 'Unassigned') ──
        COALESCE(NULLIF(TRIM(s.PIC), ''), b.PIC, 'Unassigned') AS PIC,
        -- ── DERIVED: UNIT_PRICE (best-effort from Supplier_Capacity) ──
        COALESCE(sc.UNIT_PRICE, 0) AS DERIVED_UNIT_PRICE,
        s.UPLOADED_AT,
        s.SESSION_ID,
        -- ── DERIVED: FULFILLMENT_MODE ─────────────────────────────
        CASE
          WHEN LOWER(TRIM(b.MAIN_GROUP)) = 'bao bì' THEN 'PRIVATE'
          ELSE 'PUBLIC'
        END AS DERIVED_FULFILLMENT_MODE,
        -- ── DERIVED: SUPPLIER_ID (via LEFT JOIN — avoids correlated subquery) ──
        COALESCE(si.SUPPLIER_ID, 'UNKNOWN') AS RESOLVED_SUPPLIER_ID
      FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.ZXH_PO_AutoSync_Staging\` s
      INNER JOIN \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Data\` b
        ON s.BOM_CODE = b.BOM_UPDATE
        AND b.BOM_STATUS = 'ACTIVE'
      LEFT JOIN (
        SELECT LOWER(TRIM(SUPPLIER_NAME)) AS NORM_NAME, MIN(SUPPLIER_ID) AS SUPPLIER_ID
        FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Supplier_Information\`
        GROUP BY LOWER(TRIM(SUPPLIER_NAME))
      ) si ON LOWER(TRIM(s.SUPPLIER_NAME)) = si.NORM_NAME
      LEFT JOIN (
        SELECT BOM_UPDATE, MIN(UNIT_PRICE) AS UNIT_PRICE
        FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Supplier_Capacity\`
        WHERE UNIT_PRICE IS NOT NULL AND UNIT_PRICE > 0
        GROUP BY BOM_UPDATE
      ) sc ON s.BOM_CODE = sc.BOM_UPDATE
      WHERE s.SESSION_ID = p_session_id;

      SET v_validated = (SELECT COUNT(*) FROM Validated_Staging);

      -- ════════════════════════════════════════════════════════════════
      -- PHASE 2B: DEDUPLICATE LINES (Aggregate Batches)
      --   Same INV+BOM_CODE → same PO_LINE_ID hash but multiple
      --   shipment batches. SUM quantities, use earliest date.
      --   Follows Highlander Rule convention from SP_INJECT_DIRECT_PO.
      -- ════════════════════════════════════════════════════════════════
      CREATE TEMP TABLE Deduplicated_Lines AS
      SELECT
        GENERATED_PO_LINE_ID,
        ANY_VALUE(GENERATED_PO_DOC_ID) AS GENERATED_PO_DOC_ID,
        ANY_VALUE(PIC) AS PIC,
        ANY_VALUE(BOM_CODE) AS BOM_CODE,
        ANY_VALUE(DERIVED_FULFILLMENT_MODE) AS DERIVED_FULFILLMENT_MODE,
        ROUND(SUM(GROSS_QTY), 4) AS GROSS_QTY,
        MIN(REQUIRE_DATE) AS REQUIRE_DATE,
        STRING_AGG(NULLIF(REMARK, ''), ' | ') AS REMARK,
        ANY_VALUE(ETA) AS ETA,
        ANY_VALUE(SUPPLIER_NAME) AS SUPPLIER_NAME,
        ANY_VALUE(RESOLVED_SUPPLIER_ID) AS RESOLVED_SUPPLIER_ID,
        ANY_VALUE(DERIVED_UNIT_PRICE) AS DERIVED_UNIT_PRICE
      FROM Validated_Staging
      GROUP BY GENERATED_PO_LINE_ID;

      -- ════════════════════════════════════════════════════════════════
      -- PHASE 3: AGGREGATE PO_NUMBER_REF
      -- ════════════════════════════════════════════════════════════════
      CREATE TEMP TABLE Aggregated_PO_Numbers AS
      SELECT
        GENERATED_PO_DOC_ID,
        STRING_AGG(DISTINCT NULLIF(TRIM(PO_NUMBER_REF), ''), ', ') AS AGG_PO_NUMBER_REF
      FROM Validated_Staging
      GROUP BY GENERATED_PO_DOC_ID;

      -- ════════════════════════════════════════════════════════════════
      -- TRANSACTION START: All-or-nothing for Phases 4A → 4F
      --   If any DML fails, all changes roll back atomically.
      -- ════════════════════════════════════════════════════════════════
      BEGIN TRANSACTION;

      -- ════════════════════════════════════════════════════════════════
      -- PHASE 4A: INSERT NEW PO HEADERS (15 columns)
      --   Guard: NOT EXISTS
      --   V7 FIX: SUPPLIER_NAME in GROUP BY
      -- ════════════════════════════════════════════════════════════════
      INSERT INTO \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Header\` (
        PO_DOCUMENT_ID, CONSOLIDATION_BATCH_ID, SUPPLIER_ID, SUPPLIER_NAME,
        PO_NUMBER_REF, ORDER_DATE, TOTAL_AMOUNT, LINE_COUNT, PO_DUE_DATE,
        PO_STATUS, PO_ORIGIN, FILELINK, CREATED_BY, CREATED_AT, ISSUED_AT
      )
      SELECT
        vs.GENERATED_PO_DOC_ID,
        p_session_id,
        vs.RESOLVED_SUPPLIER_ID,
        INITCAP(TRIM(vs.SUPPLIER_NAME)),
        CAST(NULL AS STRING),                      -- PO_NUMBER_REF: set by Phase 4F
        CURRENT_DATE(),
        COALESCE((                                 -- TOTAL_AMOUNT: from deduped lines
          SELECT SUM(dl2.GROSS_QTY * dl2.DERIVED_UNIT_PRICE)
          FROM Deduplicated_Lines dl2
          WHERE dl2.GENERATED_PO_DOC_ID = vs.GENERATED_PO_DOC_ID
        ), 0),
        COALESCE((                                 -- LINE_COUNT: from deduped lines
          SELECT COUNT(*)
          FROM Deduplicated_Lines dl2
          WHERE dl2.GENERATED_PO_DOC_ID = vs.GENERATED_PO_DOC_ID
        ), 0),
        MAX(vs.REQUIRE_DATE),
        'ISSUED',
        'ZXH_AUTO_SYNC',
        CAST(NULL AS STRING),
        'M4_ZXH_SYNC_ROBOT',
        CURRENT_TIMESTAMP(),
        CURRENT_TIMESTAMP()
      FROM Validated_Staging vs
      WHERE NOT EXISTS (
        SELECT 1 FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Header\` H
        WHERE H.PO_DOCUMENT_ID = vs.GENERATED_PO_DOC_ID
      )
      GROUP BY vs.GENERATED_PO_DOC_ID, vs.SUPPLIER_NAME, vs.RESOLVED_SUPPLIER_ID;

      -- ════════════════════════════════════════════════════════════════
      -- PHASE 4B: INSERT NEW PO LINES (16 columns)
      --   Guard: NOT EXISTS
      -- ════════════════════════════════════════════════════════════════
      INSERT INTO \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line\` (
        PO_LINE_ID, PO_DOCUMENT_ID, PIC, BOM_UPDATE, FULFILLMENT_MODE,
        PR_FINAL_ID, ORDER_QTY, UNIT_PRICE, LINE_TOTAL, VPO,
        PO_LINE_NOTE, SYSTEM_SUGGESTED_REQUESTED_DATE, BUYER_REQUESTED_DATE,
        DATE_CODE, LINE_NUMBER, CREATED_AT
      )
      SELECT
        dl.GENERATED_PO_LINE_ID,
        dl.GENERATED_PO_DOC_ID,
        dl.PIC,
        dl.BOM_CODE,
        dl.DERIVED_FULFILLMENT_MODE,
        CAST(NULL AS STRING),
        dl.GROSS_QTY,
        dl.DERIVED_UNIT_PRICE,                            -- UNIT_PRICE
        ROUND(dl.GROSS_QTY * dl.DERIVED_UNIT_PRICE, 2),    -- LINE_TOTAL = QTY × PRICE (V7.3: float precision)
        CAST(NULL AS STRING),
        dl.REMARK,
        dl.REQUIRE_DATE,
        dl.REQUIRE_DATE,
        CAST(NULL AS STRING),
        ROW_NUMBER() OVER (
          PARTITION BY dl.GENERATED_PO_DOC_ID 
          ORDER BY dl.BOM_CODE ASC
        ),
        CURRENT_TIMESTAMP()
      FROM Deduplicated_Lines dl
      WHERE NOT EXISTS (
        SELECT 1 FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line\` L
        WHERE L.PO_LINE_ID = dl.GENERATED_PO_LINE_ID
      );

      -- ════════════════════════════════════════════════════════════════
      -- PHASE 4C: INSERT NEW PO_LINE_TRACKING ROWS (24 columns)
      --   Guard: NOT EXISTS
      --   NOTE: LEGACY_PO_REF NOT in PO_Line_Tracking schema
      -- ════════════════════════════════════════════════════════════════
      INSERT INTO \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line_Tracking\` (
        PO_LINE_ID, PO_DOCUMENT_ID, BOM_UPDATE, FULFILLMENT_MODE, VPO,
        PIC, PO_LINE_NOTE, ORDER_QTY, CONFIRMED_QTY, LOADED_QTY,
        ACTUAL_RECEIVED_QTY, FINAL_REQUESTED_DELIVERY_DATE,
        AGREED_DELIVERY_DATE, CURRENT_ETA, ACTUAL_ARRIVAL_DATE,
        SUPPLIER_FEEDBACK_NOTE, STATUS, CLOSURE_REASON, IS_ACTIVE,
        DATE_CODE, INITIALIZED_AT, UPDATED_BY, UPDATED_AT,
        LAST_SEEN_IN_SYNC
      )
      SELECT
        dl.GENERATED_PO_LINE_ID,
        dl.GENERATED_PO_DOC_ID,
        dl.BOM_CODE,
        dl.DERIVED_FULFILLMENT_MODE,
        CAST(NULL AS STRING),
        dl.PIC,
        dl.REMARK,
        dl.GROSS_QTY,
        CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64), CAST(NULL AS FLOAT64),
        dl.REQUIRE_DATE,
        CAST(NULL AS DATE),
        COALESCE(dl.ETA, dl.REQUIRE_DATE),
        CAST(NULL AS DATE), CAST(NULL AS STRING),
        'ISSUED',
        CAST(NULL AS STRING),
        TRUE,
        CAST(NULL AS STRING),
        CURRENT_TIMESTAMP(),
        'M4_ZXH_SYNC_ROBOT',
        CURRENT_TIMESTAMP(),
        CURRENT_TIMESTAMP()
      FROM Deduplicated_Lines dl
      WHERE NOT EXISTS (
        SELECT 1 FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line_Tracking\` T
        WHERE T.PO_LINE_ID = dl.GENERATED_PO_LINE_ID
      );

      -- V7 FIX: Capture row count AFTER Phase 4C (not 4B)
      SET v_inserted = @@row_count;

      -- ════════════════════════════════════════════════════════════════
      -- PHASE 4D: UPDATE EXISTING PO_LINE_TRACKING (STATUS = 'ISSUED' only)
      --   V7 FIX: Removed LEGACY_PO_REF update (column does not exist)
      -- ════════════════════════════════════════════════════════════════
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line_Tracking\` t
      SET
        t.PIC = dl.PIC,
        t.CURRENT_ETA = COALESCE(dl.ETA, dl.REQUIRE_DATE, t.CURRENT_ETA),
        t.ORDER_QTY = dl.GROSS_QTY,
        t.FINAL_REQUESTED_DELIVERY_DATE = COALESCE(dl.REQUIRE_DATE, t.FINAL_REQUESTED_DELIVERY_DATE),
        t.PO_LINE_NOTE = CASE
          WHEN dl.REMARK IS NOT NULL 
            AND dl.REMARK != ''
            AND (t.PO_LINE_NOTE IS NULL OR STRPOS(t.PO_LINE_NOTE, dl.REMARK) = 0)
          THEN CONCAT(COALESCE(t.PO_LINE_NOTE, ''), ' | ', dl.REMARK)
          ELSE t.PO_LINE_NOTE
        END,
        t.LAST_SEEN_IN_SYNC = CURRENT_TIMESTAMP(),
        t.UPDATED_BY = 'M4_ZXH_SYNC_ROBOT',
        t.UPDATED_AT = CURRENT_TIMESTAMP()
      FROM Deduplicated_Lines dl
      WHERE t.PO_LINE_ID = dl.GENERATED_PO_LINE_ID
        AND t.STATUS = 'ISSUED';

      SET v_updated = @@row_count;

      -- ════════════════════════════════════════════════════════════════
      -- PHASE 4E: TOUCH LAST_SEEN FOR NON-ISSUED ACTIVE LINES
      -- ════════════════════════════════════════════════════════════════
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line_Tracking\` t
      SET
        t.LAST_SEEN_IN_SYNC = CURRENT_TIMESTAMP()
      FROM Deduplicated_Lines dl
      WHERE t.PO_LINE_ID = dl.GENERATED_PO_LINE_ID
        AND t.STATUS != 'ISSUED'
        AND t.IS_ACTIVE = TRUE;

      -- ════════════════════════════════════════════════════════════════
      -- PHASE 4F: UPDATE PO_HEADER PO_NUMBER_REF (Aggregate Refresh)
      -- ════════════════════════════════════════════════════════════════
      UPDATE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Header\` h
      SET
        h.PO_NUMBER_REF = apn.AGG_PO_NUMBER_REF,
        h.LINE_COUNT = COALESCE(lc.LINE_CNT, 0),
        h.TOTAL_AMOUNT = COALESCE(lc.LINE_SUM, 0)
      FROM Aggregated_PO_Numbers apn
      LEFT JOIN (
        SELECT PO_DOCUMENT_ID, COUNT(*) AS LINE_CNT, SUM(LINE_TOTAL) AS LINE_SUM
        FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line\`
        GROUP BY PO_DOCUMENT_ID
      ) lc ON lc.PO_DOCUMENT_ID = apn.GENERATED_PO_DOC_ID
      WHERE h.PO_DOCUMENT_ID = apn.GENERATED_PO_DOC_ID
        AND h.PO_ORIGIN = 'ZXH_AUTO_SYNC';

      -- ════════════════════════════════════════════════════════════════
      -- TRANSACTION END: Commit all Phase 4 changes atomically
      -- ════════════════════════════════════════════════════════════════
      COMMIT TRANSACTION;

      -- ════════════════════════════════════════════════════════════════
      -- PHASE 5: ORPHAN DETECTION
      --   V7 FIX: JOINed to PO_Header for SUPPLIER_NAME
      --   V7 FIX: Filter by PO_ORIGIN, not CREATED_BY
      -- ════════════════════════════════════════════════════════════════
      CREATE TEMP TABLE Orphan_Alerts AS
      SELECT
        t.PO_LINE_ID,
        t.PO_DOCUMENT_ID,
        t.BOM_UPDATE,
        h.SUPPLIER_NAME,
        t.STATUS,
        t.LAST_SEEN_IN_SYNC
      FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line_Tracking\` t
      INNER JOIN \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Header\` h
        ON h.PO_DOCUMENT_ID = t.PO_DOCUMENT_ID
      WHERE h.PO_ORIGIN = 'ZXH_AUTO_SYNC'
        AND t.IS_ACTIVE = TRUE
        AND t.LAST_SEEN_IN_SYNC IS NOT NULL
        AND t.LAST_SEEN_IN_SYNC < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 3 DAY);

      SET v_orphan_count = (SELECT COUNT(*) FROM Orphan_Alerts);

      -- ════════════════════════════════════════════════════════════════
      -- PHASE 6: SUMMARY RESULT
      --   V7 FIX: STRING_AGG limited to 50 IDs
      -- ════════════════════════════════════════════════════════════════
      SET v_orphan_ids = COALESCE(
        (SELECT STRING_AGG(PO_LINE_ID, ', ' LIMIT 50) FROM Orphan_Alerts),
        ''
      );

      SET v_status = 'SUCCESS';

      SELECT
        p_session_id    AS SESSION_ID,
        v_staged        AS STAGED_COUNT,
        v_validated     AS VALIDATED_COUNT,
        v_inserted      AS INSERTED_COUNT,
        v_updated       AS UPDATED_COUNT,
        v_orphan_count  AS ORPHAN_COUNT,
        v_orphan_ids    AS ORPHAN_IDS,
        v_status        AS SP_STATUS;

    EXCEPTION WHEN ERROR THEN
      -- Roll back any partial DML from the transaction
      ROLLBACK TRANSACTION;

      -- Return error info to caller (Apps Script) instead of crashing
      SELECT
        p_session_id          AS SESSION_ID,
        v_staged              AS STAGED_COUNT,
        v_validated           AS VALIDATED_COUNT,
        0                     AS INSERTED_COUNT,
        0                     AS UPDATED_COUNT,
        0                     AS ORPHAN_COUNT,
        ''                    AS ORPHAN_IDS,
        CONCAT('SP_ERROR: ', @@error.message) AS SP_STATUS;
    END;
  `,

  // ═══════════════════════════════════════════════════════════════════════════
  // 📊 M2 PHASE 6: DAILY STATS + ANALYTIC FEED + LEDGER CLEANUP
  // Purpose: M2 monitoring infrastructure — execution health, dual-method
  //   metrics, email analytics, and monthly ledger data lifecycle management.
  //   Ref: shortage_calculation_implementation_plan.md (Phase 6, lines 519-678)
  //   Ref: M2_Email_HisAnalytic_Protocol_V2.txt (Part D, lines 270-687)
  // ═══════════════════════════════════════════════════════════════════════════

  // ─────────────────────────────────────────────────────────────────────────────
  // SP_M2_RECORD_DAILY_STATS (V1.0 — Phase 6)
  // Purpose: Record execution health + dual-method metrics to M2_Daily_Stats
  //   after each M2 nightly run. Uses MERGE (upsert by RUN_DATE + RUN_SOURCE).
  //   Column names aligned to Config_Schema.txt M2_Daily_Stats definition.
  //   Sections: A(Identity) B(Execution) C(Core) D(Dual-Method) E(TopOffender) F(Anomaly)
  // Called by: M2_Main.gs _recordDailyStats() after SP_RUN_MATCHING_ENGINE
  // ─────────────────────────────────────────────────────────────────────────────
  SP_M2_RECORD_DAILY_STATS: `
    CREATE OR REPLACE PROCEDURE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.SP_M2_RECORD_DAILY_STATS\`(
      p_batch_id STRING,
      p_run_source STRING,
      p_run_status STRING,
      p_duration_seconds FLOAT64,
      p_error_message STRING
    )
    BEGIN
      -- ════════════════════════════════════════════════════════════════
      -- VARIABLE DECLARATIONS (Sections C-F)
      -- ════════════════════════════════════════════════════════════════
      DECLARE v_total_shortage_count INT64 DEFAULT 0;
      DECLARE v_total_net_shortage_qty FLOAT64 DEFAULT 0;
      DECLARE v_total_allocation_count INT64 DEFAULT 0;
      -- Section D: Dual-Method
      DECLARE v_sc_completion INT64 DEFAULT 0;
      DECLARE v_sc_issuance INT64 DEFAULT 0;
      DECLARE v_stc_qty FLOAT64 DEFAULT 0;
      DECLARE v_sti_qty FLOAT64 DEFAULT 0;
      DECLARE v_method_delta INT64 DEFAULT 0;
      -- Section E: Top Offender
      DECLARE v_top_bom STRING DEFAULT NULL;
      DECLARE v_top_qty FLOAT64 DEFAULT 0;
      DECLARE v_top_pct FLOAT64 DEFAULT 0;
      -- Section F: Anomaly
      DECLARE v_is_anomaly BOOL DEFAULT FALSE;
      DECLARE v_anomaly_reason STRING DEFAULT NULL;
      DECLARE v_avg_allocation FLOAT64;

      -- ════════════════════════════════════════════════════════════════
      -- STEP 1: Calculate metrics (only if SUCCESS)
      -- ════════════════════════════════════════════════════════════════
      IF p_run_status = 'SUCCESS' THEN
        -- Section C: Core metrics from PR_Draft + Pegging_Allocations
        SET v_total_shortage_count = (
          SELECT COUNT(*) FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_Draft\`
        );
        SET v_total_net_shortage_qty = (
          SELECT COALESCE(SUM(NET_SHORTAGE_QTY), 0) FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_Draft\`
        );
        SET v_total_allocation_count = (
          SELECT COUNT(*) FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Pegging_Allocations\`
        );

        -- Section D: Dual-method metrics from Material_Demand_SNAPSHOT
        SET v_sc_completion = (
          SELECT COUNT(*) FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Demand_SNAPSHOT\`
          WHERE GROSS_DEMAND_COMPLETION_METHOD > 0.0001
        );
        SET v_sc_issuance = (
          SELECT COUNT(*) FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Demand_SNAPSHOT\`
          WHERE GROSS_DEMAND_ISSUANCE_METHOD > 0.0001
        );
        SET v_stc_qty = (
          SELECT COALESCE(SUM(GROSS_DEMAND_COMPLETION_METHOD), 0)
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Demand_SNAPSHOT\`
        );
        SET v_sti_qty = (
          SELECT COALESCE(SUM(GROSS_DEMAND_ISSUANCE_METHOD), 0)
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Demand_SNAPSHOT\`
        );
        SET v_method_delta = (
          SELECT COUNT(*)
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Demand_SNAPSHOT\`
          WHERE GROSS_DEMAND_ISSUANCE_METHOD > 0.0001
            AND ABS(GROSS_DEMAND_COMPLETION_METHOD - GROSS_DEMAND_ISSUANCE_METHOD) /
                GREATEST(GROSS_DEMAND_COMPLETION_METHOD, 0.001) > 0.10
        );

        -- Section E: Top offender
        SET (v_top_bom, v_top_qty, v_top_pct) = (
          SELECT AS STRUCT
            BOM_UPDATE,
            SUM(NET_SHORTAGE_QTY),
            ROUND(SUM(NET_SHORTAGE_QTY) * 100.0 / NULLIF(t.grand_total, 0), 1)
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_Draft\`,
               (SELECT SUM(NET_SHORTAGE_QTY) as grand_total
                FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_Draft\`) t
          GROUP BY BOM_UPDATE, t.grand_total
          ORDER BY SUM(NET_SHORTAGE_QTY) DESC
          LIMIT 1
        );

        -- Section F: Anomaly detection (7-day average comparison)
        SET v_avg_allocation = (
          SELECT AVG(TOTAL_ALLOCATION_COUNT)
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.M2_Daily_Stats\`
          WHERE RUN_STATUS = 'SUCCESS'
            AND RUN_DATE >= DATE_SUB(CURRENT_DATE('Asia/Ho_Chi_Minh'), INTERVAL 7 DAY)
        );

        IF v_total_shortage_count = 0 AND v_total_allocation_count = 0 THEN
          SET v_is_anomaly = TRUE;
          SET v_anomaly_reason = 'ZERO_DATA: Both metrics are zero. Check data sources.';
        ELSEIF v_avg_allocation > 0
          AND ((v_avg_allocation - v_total_allocation_count) / v_avg_allocation) > 0.5 THEN
          SET v_is_anomaly = TRUE;
          SET v_anomaly_reason = CONCAT('ALLOCATION_CRASH: Dropped ',
            CAST(ROUND(((v_avg_allocation - v_total_allocation_count) / v_avg_allocation) * 100) AS STRING),
            '% from 7-day average.');
        END IF;
      END IF;

      -- ════════════════════════════════════════════════════════════════
      -- STEP 2: MERGE (Upsert by RUN_DATE + RUN_SOURCE)
      -- ════════════════════════════════════════════════════════════════
      MERGE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.M2_Daily_Stats\` T
      USING (
        SELECT
          CURRENT_DATE('Asia/Ho_Chi_Minh') AS RUN_DATE,
          p_run_source AS RUN_SOURCE,
          p_batch_id AS BATCH_ID,
          p_run_status AS RUN_STATUS,
          p_duration_seconds AS RUN_DURATION_SECONDS,
          p_error_message AS ERROR_MESSAGE,
          v_total_shortage_count AS TOTAL_SHORTAGE_COUNT,
          v_total_net_shortage_qty AS TOTAL_NET_SHORTAGE_QTY,
          v_total_allocation_count AS TOTAL_ALLOCATION_COUNT,
          v_sc_completion AS GROSS_DEMAND_COUNT_COMPLETION_METHOD,
          v_sc_issuance AS GROSS_DEMAND_COUNT_ISSUANCE_METHOD,
          v_stc_qty AS GROSS_DEMAND_TOTAL_COMPLETION_METHOD_QTY,
          v_sti_qty AS GROSS_DEMAND_TOTAL_ISSUANCE_METHOD_QTY,
          v_method_delta AS METHOD_DELTA_COUNT,
          v_top_bom AS TOP_OFFENDER_BOM_UPDATE,
          v_top_qty AS TOP_OFFENDER_QTY,
          v_top_pct AS TOP_OFFENDER_SHARE_PCT,
          v_is_anomaly AS IS_ANOMALY,
          v_anomaly_reason AS ANOMALY_REASON
      ) S
      ON T.RUN_DATE = S.RUN_DATE AND T.RUN_SOURCE = S.RUN_SOURCE

      WHEN MATCHED THEN UPDATE SET
        BATCH_ID = S.BATCH_ID,
        RUN_STATUS = S.RUN_STATUS,
        RUN_DURATION_SECONDS = S.RUN_DURATION_SECONDS,
        ERROR_MESSAGE = S.ERROR_MESSAGE,
        TOTAL_SHORTAGE_COUNT = S.TOTAL_SHORTAGE_COUNT,
        TOTAL_NET_SHORTAGE_QTY = S.TOTAL_NET_SHORTAGE_QTY,
        TOTAL_ALLOCATION_COUNT = S.TOTAL_ALLOCATION_COUNT,
        GROSS_DEMAND_COUNT_COMPLETION_METHOD = S.GROSS_DEMAND_COUNT_COMPLETION_METHOD,
        GROSS_DEMAND_COUNT_ISSUANCE_METHOD = S.GROSS_DEMAND_COUNT_ISSUANCE_METHOD,
        GROSS_DEMAND_TOTAL_COMPLETION_METHOD_QTY = S.GROSS_DEMAND_TOTAL_COMPLETION_METHOD_QTY,
        GROSS_DEMAND_TOTAL_ISSUANCE_METHOD_QTY = S.GROSS_DEMAND_TOTAL_ISSUANCE_METHOD_QTY,
        METHOD_DELTA_COUNT = S.METHOD_DELTA_COUNT,
        TOP_OFFENDER_BOM_UPDATE = S.TOP_OFFENDER_BOM_UPDATE,
        TOP_OFFENDER_QTY = S.TOP_OFFENDER_QTY,
        TOP_OFFENDER_SHARE_PCT = S.TOP_OFFENDER_SHARE_PCT,
        IS_ANOMALY = S.IS_ANOMALY,
        ANOMALY_REASON = S.ANOMALY_REASON,
        CREATED_AT = CURRENT_TIMESTAMP()

      WHEN NOT MATCHED THEN INSERT (
        RUN_DATE, RUN_SOURCE, BATCH_ID, RUN_STATUS, RUN_DURATION_SECONDS, ERROR_MESSAGE,
        TOTAL_SHORTAGE_COUNT, TOTAL_NET_SHORTAGE_QTY, TOTAL_ALLOCATION_COUNT,
        GROSS_DEMAND_COUNT_COMPLETION_METHOD, GROSS_DEMAND_COUNT_ISSUANCE_METHOD,
        GROSS_DEMAND_TOTAL_COMPLETION_METHOD_QTY, GROSS_DEMAND_TOTAL_ISSUANCE_METHOD_QTY, METHOD_DELTA_COUNT,
        TOP_OFFENDER_BOM_UPDATE, TOP_OFFENDER_QTY, TOP_OFFENDER_SHARE_PCT,
        IS_ANOMALY, ANOMALY_REASON, CREATED_AT
      ) VALUES (
        S.RUN_DATE, S.RUN_SOURCE, S.BATCH_ID, S.RUN_STATUS, S.RUN_DURATION_SECONDS, S.ERROR_MESSAGE,
        S.TOTAL_SHORTAGE_COUNT, S.TOTAL_NET_SHORTAGE_QTY, S.TOTAL_ALLOCATION_COUNT,
        S.GROSS_DEMAND_COUNT_COMPLETION_METHOD, S.GROSS_DEMAND_COUNT_ISSUANCE_METHOD,
        S.GROSS_DEMAND_TOTAL_COMPLETION_METHOD_QTY, S.GROSS_DEMAND_TOTAL_ISSUANCE_METHOD_QTY, S.METHOD_DELTA_COUNT,
        S.TOP_OFFENDER_BOM_UPDATE, S.TOP_OFFENDER_QTY, S.TOP_OFFENDER_SHARE_PCT,
        S.IS_ANOMALY, S.ANOMALY_REASON, CURRENT_TIMESTAMP()
      );
    END;
  `,

  // ─────────────────────────────────────────────────────────────────────────────
  // M2_Analytic_Feed_VIEW (V1.0 — Phase 6)
  // Purpose: "The Brain" — pre-calculates ALL analytics for the M2 email.
  //   Apps Script becomes a "dumb client" that just reads and renders.
  //   Returns exactly 1 row with ~35 pre-computed fields.
  //   Column names: VIEW output uses snake_case aliases (JS-friendly).
  //   Input columns from M2_Daily_Stats use Config_Schema.txt names.
  // Consumers: M2_Main.gs _fetchAnalyticFeed(), Looker Studio (optional)
  // Ref: M2_Email_HisAnalytic_Protocol_V2.txt Part D.2 (lines 330-559)
  // ─────────────────────────────────────────────────────────────────────────────
  M2_Analytic_Feed_VIEW: `
    CREATE OR REPLACE VIEW \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.M2_Analytic_Feed_VIEW\` AS

    WITH
    -- ═══════════════════════════════════════════════════════════════════════════
    -- CTE 1: Today's Raw Metrics (from live tables)
    -- ═══════════════════════════════════════════════════════════════════════════
    today_metrics AS (
      SELECT
        CURRENT_DATE('Asia/Ho_Chi_Minh') as today_date,
        (SELECT COUNT(*) FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_Draft\`) as shortage_count,
        (SELECT COALESCE(SUM(NET_SHORTAGE_QTY), 0) FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_Draft\`) as shortage_total_qty,
        (SELECT COUNT(*) FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Pegging_Allocations\`) as allocation_count
    ),

    -- ═══════════════════════════════════════════════════════════════════════════
    -- CTE 2: Yesterday's Metrics (most recent SUCCESS before today)
    -- ═══════════════════════════════════════════════════════════════════════════
    yesterday_metrics AS (
      SELECT
        TOTAL_SHORTAGE_COUNT as shortage_count,
        TOTAL_NET_SHORTAGE_QTY as shortage_total_qty,
        TOTAL_ALLOCATION_COUNT as allocation_count,
        RUN_DATE as stat_date
      FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.M2_Daily_Stats\`
      WHERE RUN_STATUS = 'SUCCESS'
        AND RUN_DATE < CURRENT_DATE('Asia/Ho_Chi_Minh')
      ORDER BY RUN_DATE DESC
      LIMIT 1
    ),

    -- ═══════════════════════════════════════════════════════════════════════════
    -- CTE 3: 7-Day History (for trend + anomaly detection)
    -- ═══════════════════════════════════════════════════════════════════════════
    seven_day_history AS (
      SELECT
        TOTAL_SHORTAGE_COUNT AS shortage_count,
        TOTAL_ALLOCATION_COUNT AS allocation_count,
        RUN_DATE AS stat_date
      FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.M2_Daily_Stats\`
      WHERE RUN_STATUS = 'SUCCESS'
      ORDER BY RUN_DATE DESC
      LIMIT 7
    ),

    -- ═══════════════════════════════════════════════════════════════════════════
    -- CTE 4: 7-Day Averages (for anomaly detection)
    -- ═══════════════════════════════════════════════════════════════════════════
    seven_day_avg AS (
      SELECT
        AVG(shortage_count) as avg_shortage,
        AVG(allocation_count) as avg_allocation,
        COUNT(*) as days_with_data
      FROM seven_day_history
    ),

    -- ═══════════════════════════════════════════════════════════════════════════
    -- CTE 5: Top 3 Offenders (by shortage volume, from live PR_Draft)
    -- ═══════════════════════════════════════════════════════════════════════════
    top_offenders AS (
      SELECT
        BOM_UPDATE as bom,
        SUM(NET_SHORTAGE_QTY) as total_qty,
        ROUND(SUM(NET_SHORTAGE_QTY) * 100.0 / NULLIF(t.grand_total, 0), 1) as percent_of_total,
        ROW_NUMBER() OVER (ORDER BY SUM(NET_SHORTAGE_QTY) DESC) as rank
      FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_Draft\`,
           (SELECT SUM(NET_SHORTAGE_QTY) as grand_total FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_Draft\`) t
      GROUP BY BOM_UPDATE, t.grand_total
      HAVING SUM(NET_SHORTAGE_QTY) > 0
    ),

    -- ═══════════════════════════════════════════════════════════════════════════
    -- CTE 6: Trend Array (for sparkline, oldest to newest)
    -- ═══════════════════════════════════════════════════════════════════════════
    trend_array AS (
      SELECT
        ARRAY_AGG(shortage_count ORDER BY stat_date ASC) as trend_values,
        ARRAY_AGG(FORMAT_DATE('%m/%d', stat_date) ORDER BY stat_date ASC) as trend_dates
      FROM seven_day_history
    ),

    -- ═══════════════════════════════════════════════════════════════════════════
    -- CTE 7: Dual-Method Snapshot (Phase 6 — from latest M2_Daily_Stats)
    -- ═══════════════════════════════════════════════════════════════════════════
    dual_method_snapshot AS (
      SELECT
        GROSS_DEMAND_COUNT_COMPLETION_METHOD as sc_completion,
        GROSS_DEMAND_COUNT_ISSUANCE_METHOD as sc_issuance,
        GROSS_DEMAND_TOTAL_COMPLETION_METHOD_QTY as stc_qty,
        GROSS_DEMAND_TOTAL_ISSUANCE_METHOD_QTY as sti_qty,
        METHOD_DELTA_COUNT as method_delta
      FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.M2_Daily_Stats\`
      WHERE RUN_STATUS = 'SUCCESS'
      ORDER BY RUN_DATE DESC
      LIMIT 1
    )

    -- ═══════════════════════════════════════════════════════════════════════════
    -- MAIN SELECT: The Complete Analytic Feed
    -- ═══════════════════════════════════════════════════════════════════════════
    SELECT
      -- TODAY'S METRICS
      t.today_date,
      t.shortage_count,
      t.shortage_total_qty,
      t.allocation_count,

      -- YESTERDAY'S METRICS (for comparison)
      y.shortage_count as yesterday_shortage_count,
      y.shortage_total_qty as yesterday_shortage_qty,
      y.allocation_count as yesterday_allocation_count,
      y.stat_date as yesterday_date,

      -- DELTA CALCULATIONS (Pre-computed)
      t.shortage_count - COALESCE(y.shortage_count, 0) as shortage_delta,
      CASE
        WHEN y.shortage_count IS NULL THEN NULL
        WHEN y.shortage_count = 0 THEN
          CASE WHEN t.shortage_count > 0 THEN 100.0 ELSE 0 END
        ELSE ROUND((t.shortage_count - y.shortage_count) * 100.0 / y.shortage_count, 1)
      END as shortage_delta_percent,

      t.allocation_count - COALESCE(y.allocation_count, 0) as allocation_delta,
      CASE
        WHEN y.allocation_count IS NULL THEN NULL
        WHEN y.allocation_count = 0 THEN
          CASE WHEN t.allocation_count > 0 THEN 100.0 ELSE 0 END
        ELSE ROUND((t.allocation_count - y.allocation_count) * 100.0 / y.allocation_count, 1)
      END as allocation_delta_percent,

      -- FIRST RUN FLAG
      (y.shortage_count IS NULL) as is_first_run,

      -- TOP 3 OFFENDERS (Pre-ranked)
      (SELECT bom FROM top_offenders WHERE rank = 1) as top1_bom,
      (SELECT total_qty FROM top_offenders WHERE rank = 1) as top1_qty,
      (SELECT percent_of_total FROM top_offenders WHERE rank = 1) as top1_percent,

      (SELECT bom FROM top_offenders WHERE rank = 2) as top2_bom,
      (SELECT total_qty FROM top_offenders WHERE rank = 2) as top2_qty,
      (SELECT percent_of_total FROM top_offenders WHERE rank = 2) as top2_percent,

      (SELECT bom FROM top_offenders WHERE rank = 3) as top3_bom,
      (SELECT total_qty FROM top_offenders WHERE rank = 3) as top3_qty,
      (SELECT percent_of_total FROM top_offenders WHERE rank = 3) as top3_percent,

      (SELECT SUM(percent_of_total) FROM top_offenders WHERE rank <= 3) as top3_combined_percent,

      -- TREND DATA (For sparkline)
      tr.trend_values,
      tr.trend_dates,

      -- ANOMALY DETECTION
      CASE
        WHEN t.shortage_count = 0 AND t.allocation_count = 0 THEN TRUE
        WHEN avg.avg_allocation > 0
             AND ((avg.avg_allocation - t.allocation_count) / avg.avg_allocation) > 0.5 THEN TRUE
        WHEN avg.avg_shortage > 0
             AND ((t.shortage_count - avg.avg_shortage) / avg.avg_shortage) > 2.0 THEN TRUE
        ELSE FALSE
      END as is_anomaly,

      CASE
        WHEN t.shortage_count = 0 AND t.allocation_count = 0
          THEN 'ZERO_DATA: Both metrics are zero. Check data sources.'
        WHEN avg.avg_allocation > 0
             AND ((avg.avg_allocation - t.allocation_count) / avg.avg_allocation) > 0.5
          THEN CONCAT('ALLOCATION_CRASH: Dropped ',
                      CAST(ROUND(((avg.avg_allocation - t.allocation_count) / avg.avg_allocation) * 100) AS STRING),
                      '% from 7-day average.')
        WHEN avg.avg_shortage > 0
             AND ((t.shortage_count - avg.avg_shortage) / avg.avg_shortage) > 2.0
          THEN CONCAT('SHORTAGE_EXPLOSION: Increased ',
                      CAST(ROUND(((t.shortage_count - avg.avg_shortage) / avg.avg_shortage) * 100) AS STRING),
                      '% from 7-day average.')
        ELSE NULL
      END as anomaly_reason,

      -- HEALTH STATUS (The "Weather Report")
      -- Uses RELATIVE thresholds (% change) instead of absolute counts,
      -- because ISC's normal operating level is ~4000-5000 shortages.
      CASE
        -- STORM: Zero data = system failure
        WHEN t.shortage_count = 0 AND t.allocation_count = 0 THEN 'STORM'
        -- STORM: Allocation crash (>50% drop from 7-day avg)
        WHEN avg.avg_allocation > 0
             AND ((avg.avg_allocation - t.allocation_count) / avg.avg_allocation) > 0.5 THEN 'STORM'
        -- STORM: Shortage explosion (>50% spike vs yesterday)
        WHEN y.shortage_count IS NOT NULL
             AND y.shortage_count > 0
             AND ((t.shortage_count - y.shortage_count) * 100.0 / y.shortage_count) > 50 THEN 'STORM'
        -- STORM: Shortage explosion (>100% spike vs 7-day avg)
        WHEN avg.avg_shortage > 0
             AND ((t.shortage_count - avg.avg_shortage) / avg.avg_shortage) > 1.0 THEN 'STORM'
        -- CLEAR: Stable or improving (<=10% change from yesterday)
        WHEN y.shortage_count IS NOT NULL
             AND y.shortage_count > 0
             AND ((t.shortage_count - y.shortage_count) * 100.0 / y.shortage_count) <= 10 THEN 'CLEAR'
        -- CLEAR: First run (no baseline = establishing)
        WHEN y.shortage_count IS NULL THEN 'CLEAR'
        -- CLOUDY: Everything else (moderate changes)
        ELSE 'CLOUDY'
      END as health_status,

      -- ALERT FLAG (Currently: Always TRUE. Change to conditional later.)
      TRUE as should_alert,

      -- DUAL-METHOD COMPARISON (Phase 6 Enhancement)
      dm.sc_completion,
      dm.sc_issuance,
      dm.stc_qty,
      dm.sti_qty,
      dm.method_delta,

      CASE
        WHEN dm.stc_qty > dm.sti_qty * 1.2
          THEN 'Completion shows 20%+ more shortages than Issuance'
        WHEN dm.sti_qty > dm.stc_qty * 1.2
          THEN 'Issuance shows 20%+ more shortages than Completion'
        ELSE 'Methods broadly aligned'
      END as method_comparison_insight,

      -- METADATA
      avg.days_with_data as history_days_available,
      CURRENT_TIMESTAMP() as generated_at

    FROM today_metrics t
    LEFT JOIN yesterday_metrics y ON TRUE
    LEFT JOIN seven_day_avg avg ON TRUE
    LEFT JOIN trend_array tr ON TRUE
    LEFT JOIN dual_method_snapshot dm ON TRUE;
  `,

  // ─────────────────────────────────────────────────────────────────────────────
  // M2_Pipeline_Ledger_Cleanup (V1.0 — Phase 6)
  // Purpose: Monthly cleanup SQL for M2_Pipeline_Ledger.
  //   Deletes rows older than 12 months to manage storage costs.
  //   Designed to be called from Apps Script monthlyLedgerHealthCheck() or
  //   deployed as a BigQuery Scheduled Query (1st of month, 03:00 AM VN).
  //   Infrastructure-as-Code pattern: SQL lives here, not in BQ Console.
  // Ref: shortage_calculation_implementation_plan.md (Phase 6, lines 619-623)
  // ─────────────────────────────────────────────────────────────────────────────
  M2_Pipeline_Ledger_Cleanup: `
    DELETE FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.M2_Pipeline_Ledger\`
    WHERE LEDGER_DATE < DATE_SUB(CURRENT_DATE('Asia/Ho_Chi_Minh'), INTERVAL 12 MONTH);
  `,

  // ═══════════════════════════════════════════════════════════════════════════
  // 📊 M2 PHASE 8: DASHBOARD ANALYTICS VIEWS
  // Purpose: Analytics-optimized views for Looker Studio dashboard.
  //   Decoupled from M2_Analytic_Feed_VIEW (which serves the email only).
  //   These views expose time-series rows needed by Looker Studio charts,
  //   which M2_Analytic_Feed_VIEW cannot provide (it always returns 1 row).
  //   All column names follow the Phase 7 naming convention (GROSS_DEMAND_*).
  //   Consumers: Looker Studio + MASTER sheet Connected Sheets
  //   Ref: Phase8_Implementation_Plan_V1_Part1.md (Phase 8.1)
  // ═══════════════════════════════════════════════════════════════════════════

  // ─────────────────────────────────────────────────────────────────────────────
  // Dashboard_Shortage_Trend_VIEW (V1.0 — Phase 8)
  // Purpose: Daily time series read from M2_Daily_Stats.
  //   Adds day-over-day deltas and 7-day moving averages as pre-computed
  //   Looker-ready columns so the dashboard needs no custom formulas.
  //   Returns 1 row per NIGHTLY run per date. Only includes SUCCESS runs.
  // Consumers: Looker Studio Page 1 (scorecards + trend line), Page 2
  // ─────────────────────────────────────────────────────────────────────────────
  Dashboard_Shortage_Trend_VIEW: `
    CREATE OR REPLACE VIEW \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Dashboard_Shortage_Trend_VIEW\` AS

    SELECT
      ds.RUN_DATE,
      ds.RUN_SOURCE,
      ds.RUN_STATUS,
      ds.RUN_DURATION_SECONDS,

      -- ─── Core Metrics ───────────────────────────────────────────────────────
      ds.TOTAL_SHORTAGE_COUNT,
      ds.TOTAL_NET_SHORTAGE_QTY,
      ds.TOTAL_ALLOCATION_COUNT,

      -- ─── Dual-Method Metrics (Phase 7 column names) ─────────────────────────
      ds.GROSS_DEMAND_COUNT_COMPLETION_METHOD,
      ds.GROSS_DEMAND_COUNT_ISSUANCE_METHOD,
      ds.GROSS_DEMAND_TOTAL_COMPLETION_METHOD_QTY,
      ds.GROSS_DEMAND_TOTAL_ISSUANCE_METHOD_QTY,
      ds.METHOD_DELTA_COUNT,

      -- ─── Top Offender ────────────────────────────────────────────────────────
      ds.TOP_OFFENDER_BOM_UPDATE,
      ds.TOP_OFFENDER_QTY,
      ds.TOP_OFFENDER_SHARE_PCT,

      -- ─── Anomaly ─────────────────────────────────────────────────────────────
      ds.IS_ANOMALY,
      ds.ANOMALY_REASON,

      -- ─── Derived: Day-over-day delta (pre-computed for Looker scorecards) ────
      ds.TOTAL_SHORTAGE_COUNT
        - LAG(ds.TOTAL_SHORTAGE_COUNT)
            OVER (PARTITION BY ds.RUN_SOURCE ORDER BY ds.RUN_DATE)
        AS SHORTAGE_DELTA,

      ROUND(
        SAFE_DIVIDE(
          ds.TOTAL_SHORTAGE_COUNT
            - LAG(ds.TOTAL_SHORTAGE_COUNT)
                OVER (PARTITION BY ds.RUN_SOURCE ORDER BY ds.RUN_DATE),
          NULLIF(
            LAG(ds.TOTAL_SHORTAGE_COUNT)
              OVER (PARTITION BY ds.RUN_SOURCE ORDER BY ds.RUN_DATE),
            0
          )
        ) * 100, 1
      ) AS SHORTAGE_DELTA_PCT,

      -- ─── Derived: 7-day moving averages (smooth trendlines) ─────────────────
      ROUND(
        AVG(ds.TOTAL_SHORTAGE_COUNT)
          OVER (
            PARTITION BY ds.RUN_SOURCE
            ORDER BY ds.RUN_DATE
            ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
          ),
        0
      ) AS SHORTAGE_7DAY_AVG,

      ROUND(
        AVG(ds.TOTAL_ALLOCATION_COUNT)
          OVER (
            PARTITION BY ds.RUN_SOURCE
            ORDER BY ds.RUN_DATE
            ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
          ),
        0
      ) AS ALLOCATION_7DAY_AVG

    FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.M2_Daily_Stats\` ds
    WHERE ds.RUN_STATUS = 'SUCCESS'
    ORDER BY ds.RUN_DATE DESC, ds.RUN_SOURCE;
  `,

  // ─────────────────────────────────────────────────────────────────────────────
  // Dashboard_Coverage_Analysis_VIEW (V1.0 — Phase 8)
  // Purpose: Daily supply coverage analysis aggregated from M2_Pipeline_Ledger.
  //   Groups by LEDGER_DATE + MAIN_GROUP + CALC_METHOD_USED.
  //   Surfaces gross demand, net shortage, supply allocated, and coverage %.
  //   Powers Page 3 (Supply Coverage) charts in Looker Studio.
  // Consumers: Looker Studio Page 3, MASTER Connected Sheets
  // ─────────────────────────────────────────────────────────────────────────────
  Dashboard_Coverage_Analysis_VIEW: `
    CREATE OR REPLACE VIEW \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Dashboard_Coverage_Analysis_VIEW\` AS

    SELECT
      pl.LEDGER_DATE,
      pl.MAIN_GROUP,
      pl.CALC_METHOD_USED,

      -- ─── Demand Counts ───────────────────────────────────────────────────────
      COUNT(*)                              AS TOTAL_DEMAND_ROWS,
      COUNTIF(pl.HAS_SHORTAGE = TRUE)       AS SHORTAGE_ROWS,
      COUNTIF(pl.HAS_SHORTAGE = FALSE)      AS FULLY_COVERED_ROWS,

      -- ─── Demand Quantities (Gross — dual method columns) ─────────────────────
      SUM(pl.GROSS_DEMAND_QTY)              AS TOTAL_GROSS_DEMAND,
      SUM(pl.GROSS_DEMAND_COMPLETION_METHOD) AS TOTAL_GROSS_COMPLETION,
      SUM(pl.GROSS_DEMAND_ISSUANCE_METHOD)   AS TOTAL_GROSS_ISSUANCE,

      -- ─── Shortage Quantities (Net — post-allocation) ─────────────────────────
      SUM(COALESCE(pl.NET_SHORTAGE_QTY, 0)) AS TOTAL_NET_SHORTAGE,

      -- ─── Supply Allocated ────────────────────────────────────────────────────
      SUM(COALESCE(pl.SUPPLY_ALLOCATED_QTY, 0)) AS TOTAL_SUPPLY_ALLOCATED,

      -- ─── Coverage Percentage: ALLOCATED / GROSS_DEMAND ───────────────────────
      ROUND(
        SAFE_DIVIDE(
          SUM(COALESCE(pl.SUPPLY_ALLOCATED_QTY, 0)),
          NULLIF(SUM(pl.GROSS_DEMAND_QTY), 0)
        ) * 100, 1
      ) AS SUPPLY_COVERAGE_PCT,

      -- ─── Shortage Rate: What % of demand rows had a net shortage? ────────────
      ROUND(
        SAFE_DIVIDE(
          COUNTIF(pl.HAS_SHORTAGE = TRUE),
          COUNT(*)
        ) * 100, 1
      ) AS SHORTAGE_RATE_PCT

    FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.M2_Pipeline_Ledger\` pl
    GROUP BY pl.LEDGER_DATE, pl.MAIN_GROUP, pl.CALC_METHOD_USED
    ORDER BY pl.LEDGER_DATE DESC, pl.MAIN_GROUP;
  `,

  // ─────────────────────────────────────────────────────────────────────────────
  // Dashboard_Method_Comparison_VIEW (V1.0 — Phase 8)
  // Purpose: Tracks the Phase 7 auto-switch impact per day and material group.
  //   Computes "phantom demand eliminated" = COMPLETION - ISSUANCE quantity.
  //   This quantifies the real-world business value of the ISSUANCE override.
  //   Enables Ngàn to validate Chì numbers against the traditional Lead Plan.
  // Consumers: Looker Studio Page 3 (Chì dual-line + phantom demand bar),
  //   MASTER sheet comparison section
  // ─────────────────────────────────────────────────────────────────────────────
  Dashboard_Method_Comparison_VIEW: `
    CREATE OR REPLACE VIEW \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Dashboard_Method_Comparison_VIEW\` AS

    SELECT
      pl.LEDGER_DATE,
      pl.MAIN_GROUP,
      pl.CALC_METHOD_USED,

      -- ─── Row counts ──────────────────────────────────────────────────────────
      COUNT(*)                                     AS ROW_COUNT,

      -- ─── Active demand (the method actually chosen for GROSS_DEMAND_QTY) ─────
      SUM(pl.GROSS_DEMAND_QTY)                     AS ACTIVE_DEMAND_QTY,

      -- ─── Both methods side-by-side (what WOULD have happened) ────────────────
      SUM(pl.GROSS_DEMAND_COMPLETION_METHOD)        AS COMPLETION_METHOD_QTY,
      SUM(pl.GROSS_DEMAND_ISSUANCE_METHOD)          AS ISSUANCE_METHOD_QTY,

      -- ─── Phantom demand eliminated = Completion - Issuance ───────────────────
      --   Positive value = Completion overstated demand vs Issuance
      --   (i.e., the ISSUANCE switch prevented phantom PRs)
      SUM(pl.GROSS_DEMAND_COMPLETION_METHOD)
        - SUM(pl.GROSS_DEMAND_ISSUANCE_METHOD)
        AS PHANTOM_DEMAND_ELIMINATED,

      -- ─── Phantom reduction as % of Completion method ─────────────────────────
      ROUND(
        SAFE_DIVIDE(
          SUM(pl.GROSS_DEMAND_COMPLETION_METHOD)
            - SUM(pl.GROSS_DEMAND_ISSUANCE_METHOD),
          NULLIF(SUM(pl.GROSS_DEMAND_COMPLETION_METHOD), 0)
        ) * 100, 1
      ) AS PHANTOM_REDUCTION_PCT,

      -- ─── Issuance data availability ──────────────────────────────────────────
      COUNTIF(pl.HAS_ISSUANCE_DATA = TRUE)          AS ROWS_WITH_ISSUANCE_DATA,
      COUNTIF(pl.HAS_ISSUANCE_DATA = FALSE)          AS ROWS_WITHOUT_ISSUANCE_DATA

    FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.M2_Pipeline_Ledger\` pl
    GROUP BY pl.LEDGER_DATE, pl.MAIN_GROUP, pl.CALC_METHOD_USED
    ORDER BY pl.LEDGER_DATE DESC, pl.MAIN_GROUP;
  `,

  // =========================================================
  // 📦 MODULE M4: ISSUANCE AUTOSYNC (Option B — Clean Slate)
  // Added: 2026-03-11 | Ref: Lead_Issuance_Analysis_V3.md
  // =========================================================

  /**
   * SP_M4_ISSUANCE_MERGE — Clean-slate stored procedure for Lead Issuance sync.
   *
   * STRATEGY: Option B — DELETE + INSERT (replaces orphaned MERGE approach)
   *
   * WHY:
   *   The previous MERGE-only SP accumulated "orphan" rows from past sync runs
   *   that were no longer present in the source sheet. Over time this caused
   *   stale issuance quantities to remain in Material_Issuance indefinitely.
   *
   * HOW:
   *   1. Accept session_id + source_id from the Apps Script caller.
   *   2. Count staged rows for this session (abort if 0 — source had no data).
   *   3. Record how many existing rows will be replaced (for reporting).
   *   4. DELETE all existing rows for this SOURCE_ID (clean slate).
   *   5. INSERT fresh deduplicated rows from staging (ROW_NUMBER deduplication
   *      on BOM_UPDATE + VPO, keeping latest SYNCED_AT per pair).
   *   6. Return counts: STAGED_COUNT, INSERTED_COUNT, DELETED_COUNT, SP_STATUS.
   *
   * TRANSACTION SAFETY:
   *   BQ stored procedures run inside an implicit transaction. If the INSERT
   *   fails after DELETE, both operations roll back — no data is lost.
   *   The EXCEPTION handler returns error details without crashing the pipeline.
   *
   * RETURNS (1 row):
   *   SESSION_ID, STAGED_COUNT, INSERTED_COUNT, DELETED_COUNT, SP_STATUS
   *   SP_STATUS = 'SUCCESS' | 'NO_DATA' | 'SP_ERROR: <message>'
   *
   * DEPLOYED VIA: admin_DeploySQLAssets() in Admin_Infrastructure.gs
   */
  SP_M4_ISSUANCE_MERGE: `
    CREATE OR REPLACE PROCEDURE \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.SP_M4_ISSUANCE_MERGE\`(
      IN p_session_id STRING,
      IN p_source_id  STRING
    )
    BEGIN
      DECLARE v_staged    INT64 DEFAULT 0;
      DECLARE v_deleted   INT64 DEFAULT 0;
      DECLARE v_inserted  INT64 DEFAULT 0;

      -- ── STEP 1: Count staged rows for this session ────────────────────────────
      SET v_staged = (
        SELECT COUNT(*)
        FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Issuance_Staging\`
        WHERE SYNC_BATCH_ID = p_session_id
          AND SOURCE_ID     = p_source_id
      );

      -- Guard: abort early if Apps Script sent us nothing
      IF v_staged = 0 THEN
        SELECT
          p_session_id AS SESSION_ID,
          0            AS STAGED_COUNT,
          0            AS INSERTED_COUNT,
          0            AS DELETED_COUNT,
          'NO_DATA'    AS SP_STATUS;
        RETURN;
      END IF;

      -- ── STEP 2: Record pre-delete count (for report) ──────────────────────────
      SET v_deleted = (
        SELECT COUNT(*)
        FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Issuance\`
        WHERE SOURCE_ID = p_source_id
      );

      -- ── STEP 3: Clean slate — delete ALL rows for this source ─────────────────
      -- (Purges orphan rows from previous runs that no longer exist in source sheet)
      DELETE FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Issuance\`
      WHERE SOURCE_ID = p_source_id;

      -- ── STEP 4: Insert fresh deduplicated rows from staging ───────────────────
      -- ROW_NUMBER deduplication keeps only the latest SYNCED_AT per (BOM,VPO) pair
      -- in case Apps Script batched the same pair more than once per session.
      INSERT INTO \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Issuance\`
      SELECT
        ISSUANCE_ID,
        BOM_UPDATE,
        VPO,
        CUMULATIVE_ISSUANCE_QTY,
        CAST(SNAPSHOT_DATE AS DATE),
        SOURCE_BOM_CODE,
        SYNC_BATCH_ID,
        CAST(SYNCED_AT AS TIMESTAMP),
        SOURCE_ID,
        MAIN_GROUP,
        RESOLUTION_METHOD
      FROM (
        SELECT *,
          ROW_NUMBER() OVER (
            PARTITION BY BOM_UPDATE, VPO, SOURCE_ID
            ORDER BY SYNCED_AT DESC
          ) AS rn
        FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Issuance_Staging\`
        WHERE SYNC_BATCH_ID = p_session_id
          AND SOURCE_ID     = p_source_id
      )
      WHERE rn = 1;

      -- ── STEP 5: Count what we actually inserted ───────────────────────────────
      SET v_inserted = (
        SELECT COUNT(*)
        FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Issuance\`
        WHERE SOURCE_ID = p_source_id
      );

      -- ── STEP 6: Return summary row to Apps Script ─────────────────────────────
      SELECT
        p_session_id AS SESSION_ID,
        v_staged     AS STAGED_COUNT,
        v_inserted   AS INSERTED_COUNT,
        v_deleted    AS DELETED_COUNT,
        'SUCCESS'    AS SP_STATUS;

    EXCEPTION WHEN ERROR THEN
      -- Implicit transaction rollback: DELETE + INSERT are both reverted on error.
      -- Return error details so the Apps Script caller can log and alert.
      SELECT
        p_session_id                               AS SESSION_ID,
        v_staged                                   AS STAGED_COUNT,
        0                                          AS INSERTED_COUNT,
        0                                          AS DELETED_COUNT,
        CONCAT('SP_ERROR: ', @@error.message)      AS SP_STATUS;
    END;
  `,

  // =========================================================
  // 🧑‍💼 M3: PROCUREMENT (Assign Sourcing)
  // BOM-Aggregated Views for PHASE 1 Upgrade
  // =========================================================
  BOM_Shortage_Backup_VIEW: `
      CREATE OR REPLACE VIEW \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Shortage_Backup_VIEW\` AS
      WITH stock AS (
          SELECT BOM_UPDATE, SUM(INVENTORY_QTY) AS stock_qty
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Stock_Data\`
          GROUP BY BOM_UPDATE
      ),
      po_supply AS (
          SELECT BOM_UPDATE,
              SUM(COALESCE(CONFIRMED_QTY, ORDER_QTY)) AS po_on_way
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PO_Line_Tracking\`
          WHERE IS_ACTIVE = TRUE
            AND STATUS NOT IN ('CLOSED', 'CANCELLED')
          GROUP BY BOM_UPDATE
      ),
      bom_demand AS (
          SELECT BOM_UPDATE,
              SUM(GROSS_DEMAND_QTY) AS total_demand
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Demand_VIEW\`
          WHERE LOWER(TRIM(FULFILLMENT_MODE)) = 'public'
          GROUP BY BOM_UPDATE
      ),
      bom_issued AS (
          SELECT BOM_UPDATE,
              SUM(CUMULATIVE_ISSUANCE_QTY) AS total_issued
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Material_Issuance\`
          GROUP BY BOM_UPDATE
      )
      SELECT 
          d.BOM_UPDATE,
          COALESCE(d.total_demand, 0) AS BOM_TOTAL_DEMAND,
          COALESCE(i.total_issued, 0) AS BOM_TOTAL_ISSUED,
          COALESCE(s.stock_qty, 0) AS BOM_STOCK,
          COALESCE(p.po_on_way, 0) AS BOM_PO_ON_WAY,
          GREATEST(0, COALESCE(d.total_demand, 0) - COALESCE(i.total_issued, 0) - COALESCE(s.stock_qty, 0) - COALESCE(p.po_on_way, 0)) AS BOM_TOTAL_SHORTAGE
      FROM bom_demand d
      LEFT JOIN stock s ON d.BOM_UPDATE = s.BOM_UPDATE
      LEFT JOIN po_supply p ON d.BOM_UPDATE = p.BOM_UPDATE
      LEFT JOIN bom_issued i ON d.BOM_UPDATE = i.BOM_UPDATE;
  `,

  // =========================================================
  // 📦 M3: BOM-AGGREGATED SOURCING VIEW (Phase 2 — V7)
  // =========================================================
  Sourcing_Feed_Aggregated_VIEW: `
      -- ═══════════════════════════════════════════════════════════════
      -- Sourcing_Feed_Aggregated_VIEW (Phase 2 V7)
      -- Grain: 1 row per PUBLIC BOM_UPDATE
      -- Supersedes Phase 1 version: adds delivery_date to JSON,
      --   ROW_GRAIN/SOURCE_VIEW metadata, ASSIGNED_SUPPLIER_NAME,
      --   KNOWN_CAPACITY_OPTIONS, SUPPLIER_CONSISTENCY_CHECK.
      -- ═══════════════════════════════════════════════════════════════
      CREATE OR REPLACE VIEW \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Sourcing_Feed_Aggregated_VIEW\` AS
      WITH M2_Output AS (
          SELECT
              PR.BOM_UPDATE,
              PR.DRAFT_PR_ID,
              PR.VPO,
              PR.NET_SHORTAGE_QTY,
              PR.NET_SHORTAGE_COMPLETION,
              PR.NET_SHORTAGE_ISSUANCE,
              PR.FULFILLMENT_MODE,
              PR.REQUESTED_DELIVERY_DATE   AS DELIVERY_DATE,  -- ← aliased for JSON clarity
              PR.ORDER_LIST_NOTE,
              PR.MAIN_GROUP,
              B.BOM_DESCRIPTION,
              B.BOM_UNIT,
              B.PIC,
              -- These fields are planner inputs / populated downstream; they don't exist in PR_Draft
              CAST(NULL AS STRING) AS ASSIGNED_SUPPLIER_NAME,
              CAST(NULL AS STRING) AS KNOWN_CAPACITY_OPTIONS
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.PR_Draft\` PR
          LEFT JOIN \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Data\` B
              ON PR.BOM_UPDATE = B.BOM_UPDATE
      ),
      Supplier_Agg AS (
          SELECT 
            BOM_UPDATE,
            -- Get the "top" supplier deterministically (alphabetically first if multiple exist)
            MIN(SUPPLIER_NAME) AS ASSIGNED_SUPPLIER_NAME_HINT,
            STRING_AGG(DISTINCT SUPPLIER_NAME, ' | ' ORDER BY SUPPLIER_NAME) AS KNOWN_CAPACITY_OPTIONS_HINT
          FROM \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.Supplier_Capacity\`
          GROUP BY BOM_UPDATE
      ),
      Aggregated_Base AS (
          SELECT
              -- ── Metadata ──────────────────────────────────────────
              CAST('BOM_AGG' AS STRING)                                           AS ROW_GRAIN,
              CAST('Sourcing_Feed_Aggregated_VIEW' AS STRING)                     AS SOURCE_VIEW,

              BOM_UPDATE,
              ANY_VALUE(BOM_DESCRIPTION)                                          AS BOM_DESCRIPTION,
              ANY_VALUE(BOM_UNIT)                                                 AS BOM_UNIT,
              ANY_VALUE(PIC)                                                      AS PIC,
              ANY_VALUE(SA.ASSIGNED_SUPPLIER_NAME_HINT)                           AS ASSIGNED_SUPPLIER_NAME,
              ANY_VALUE(SA.KNOWN_CAPACITY_OPTIONS_HINT)                           AS KNOWN_CAPACITY_OPTIONS,

              -- ── Aggregated shortage (floor at 0 per VPO before summing) ──
              SUM(GREATEST(0, NET_SHORTAGE_QTY))                                 AS NET_SHORTAGE_QTY_AGG,
              SUM(GREATEST(0, NET_SHORTAGE_COMPLETION))                           AS NET_SHORTAGE_COMPLETION_AGG,
              SUM(GREATEST(0, NET_SHORTAGE_ISSUANCE))                             AS NET_SHORTAGE_ISSUANCE_AGG,

              -- ── Delivery window ────────────────────────────────────
              MIN(DELIVERY_DATE)                                                   AS EARLIEST_REQUESTED_DELIVERY_DATE,

              COUNT(DISTINCT VPO)                                                 AS VPO_COUNT,

              -- ── Deterministic pipe-delimited backup lists ──────────
              STRING_AGG(VPO,         '|' ORDER BY VPO ASC)                      AS VPO_AGG,
              STRING_AGG(DRAFT_PR_ID, '|' ORDER BY VPO ASC)                      AS DRAFT_PR_ID_AGG,

              -- ── JSON payload for Explode algorithm (JSON.parse compatible) ──
              -- V7 CRITICAL: Use CONCAT+STRING_AGG+TO_JSON_STRING (NOT ARRAY_AGG).
              -- ARRAY_AGG produces a BigQuery native ARRAY — not a JSON string.
              -- delivery_date is REQUIRED for tie-break in Explode Step 6.
              CONCAT('[', STRING_AGG(
                TO_JSON_STRING(STRUCT(
                  VPO              AS vpo,
                  DRAFT_PR_ID      AS draft_pr_id,
                  NET_SHORTAGE_QTY AS net_shortage_qty,
                  DELIVERY_DATE    AS delivery_date
                )), ',' ORDER BY VPO ASC
              ), ']')                                                              AS VPO_COMPONENTS_JSON,

              -- ── Diagnostics ────────────────────────────────────────
              COUNT(DISTINCT ASSIGNED_SUPPLIER_NAME)                              AS SUPPLIER_CONSISTENCY_CHECK,
              CASE
                WHEN COUNT(DISTINCT FULFILLMENT_MODE) > 1 THEN 'MIXED_MODE'
                WHEN COUNT(DISTINCT PIC) > 1             THEN 'MIXED_PIC'
                ELSE 'OK'
              END                                                                 AS INCONSISTENT_DIMENSION_FLAG

          FROM M2_Output SRC
          LEFT JOIN Supplier_Agg SA ON SRC.BOM_UPDATE = SA.BOM_UPDATE
          -- 🛡️ Aggregated pipeline: PUBLIC only. PRIVATE stays 1-to-1 in legacy.
          WHERE LOWER(TRIM(SRC.FULFILLMENT_MODE)) = 'public'
          GROUP BY SRC.BOM_UPDATE
      )

      SELECT
          A.*,
          B.BOM_TOTAL_SHORTAGE,
          B.BOM_TOTAL_DEMAND,
          B.BOM_TOTAL_ISSUED,
          B.BOM_STOCK,
          B.BOM_PO_ON_WAY,
          (A.NET_SHORTAGE_QTY_AGG - B.BOM_TOTAL_SHORTAGE)  AS BOM_SHORTAGE_DIFF,

          CASE
            WHEN A.NET_SHORTAGE_QTY_AGG = 0 AND B.BOM_TOTAL_SHORTAGE = 0 THEN 'OK'
            -- MISMATCH threshold: > 5 units OR > 5% of ground truth (whichever is larger)
            WHEN ABS(A.NET_SHORTAGE_QTY_AGG - B.BOM_TOTAL_SHORTAGE)
                   > GREATEST(5, B.BOM_TOTAL_SHORTAGE * 0.05)                   THEN 'MISMATCH'
            ELSE 'OK'
          END                                                                    AS BOM_SHORTAGE_STATUS

      FROM Aggregated_Base A
      LEFT JOIN \`${ENV.PROJECT_ID}.${ENV.DATASET_ID}.BOM_Shortage_Backup_VIEW\` B
          ON A.BOM_UPDATE = B.BOM_UPDATE;
  `,

};

/**
 * Public Accessor
 */
function getSQLVault() {
  return SQL_VAULT;
}