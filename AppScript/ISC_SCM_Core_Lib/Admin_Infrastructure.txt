/**
 * 🏗️ ADMIN INFRASTRUCTURE (System Installer)
 * * RESPONSIBILITIES:
 * 1. Read the Schema Truth (Config_Schema).
 * 2. Generate DDL (CREATE TABLE) statements dynamically.
 * 3. Execute creation for ALL tables.
 * * USAGE:
 * Run `admin_InitializeDatabase()` once to set up the BigQuery environment.
 */

// Mapping JS/Config Types to BigQuery Types
const TYPE_MAP = {
  'STRING': 'STRING',
  'INTEGER': 'INT64',
  'FLOAT': 'FLOAT64',
  'BOOLEAN': 'BOOL',
  'DATE': 'DATE',
  'TIMESTAMP': 'TIMESTAMP'
};

/**
 * 🚀 MAIN INSTALLER
 * Iterates through every table in Config_Schema and creates it in BigQuery.
 */
function admin_InitializeDatabase() {
  const config = getCoreConfig();
  const project = config.connection.PROJECT_ID;
  const dataset = config.connection.DATASET_ID;
  
  Logger.log(`🏗️ Initializing Database: ${project}.${dataset}...`);

  // Loop through all defined tables
  Object.keys(config.schemas).forEach(tableName => {
    const tableDef = config.schemas[tableName];
    
    // Some tables (like Inputs) use 'tempSchema', others use 'schema'
    const fields = tableDef.schema || tableDef.tempSchema;

    if (!fields) {
      Logger.log(`⚠️ Skipping ${tableName} (No schema defined)`);
      return;
    }

    // 1. Generate Column Definitions
    const columnsSQL = fields.map(f => {
      const bqType = TYPE_MAP[f.type] || 'STRING';
      return `${f.name} ${bqType}`;
    }).join(",\n  ");

    // 2. Build the CREATE TABLE statement
    let sql = `CREATE TABLE IF NOT EXISTS \`${project}.${dataset}.${tableName}\` (\n  ${columnsSQL}\n)`;

    // 3. Execute
    try {
      Logger.log(`🔨 Creating ${tableName}...`);
      // FIX: Call the global function directly (removed BigQueryClient prefix)
      runWriteQuery(sql); 
    } catch (e) {
      Logger.log(`❌ Failed to create ${tableName}: ${e.message}`);
    }
  });

  Logger.log("✅ Database Initialization Complete.");
}


/**
 * ☢️ HARD RESET (The Nuclear Option)
 * * PURPOSE:
 * 1. DROPS every table defined in Config_Schema.
 * 2. Re-creates them from scratch using the current definition.
 * * * WARNING:
 * THIS WILL DELETE ALL DATA. USE ONLY DURING DEVELOPMENT.
 */
function admin_HardResetDatabase() {
  const config = getCoreConfig();
  const project = config.connection.PROJECT_ID;
  const dataset = config.connection.DATASET_ID;
  
  Logger.log("🚨 STARTING HARD RESET. HOLD ON...");

  // --- STEP 1: DESTROY (Drop All Tables) ---
  const tables = Object.keys(config.schemas);
  
  tables.forEach(tableName => {
    try {
      const dropSql = `DROP TABLE IF EXISTS \`${project}.${dataset}.${tableName}\``;
      Logger.log(`🔥 Dropping ${tableName}...`);
      runWriteQuery(dropSql);
    } catch (e) {
      Logger.log(`⚠️ Could not drop ${tableName}: ${e.message}`);
    }
  });

  // --- STEP 2: REBUILD (Call the Standard Installer) ---
  Logger.log("🏗️ Rebuilding Database from clean schema...");
  admin_InitializeDatabase();
  
  Logger.log("✅ HARD RESET COMPLETE. Your database is now a perfect mirror of Config_Schema.");
}

/**
 * 🧠 DEPLOY SQL ASSETS (The Brain Installer)
 * * RESPONSIBILITIES:
 * 1. Reads every Stored Procedure & View defined in SQL_Vault.
 * 2. Executes the "CREATE OR REPLACE" SQL in BigQuery.
 * * USAGE:
 * Run this whenever you update SQL_Vault.gs.
 */
function admin_DeploySQLAssets() {
  const vault = getSQLVault();
  const keys = Object.keys(vault);
  
  Logger.log(`🧠 Deploying ${keys.length} SQL Assets...`);
  
  keys.forEach(key => {
    const sql = vault[key];
    try {
      Logger.log(`⚙️ Installing: ${key}...`);
      runWriteQuery(sql); 
    } catch (e) {
      // FIX: Logger.error is not a function. Use console.error or Logger.log
      console.error(`❌ Failed to install ${key}: ${e.message}`);
      Logger.log(`❌ Failed to install ${key}: ${e.message}`);
    }
  });
  
  Logger.log("✅ SQL Deployment Complete.");
}

/**
 * 🚀 PHASE 1 (Assign_Sourcing Aggregation) SAFE DEPLOY
 *
 * Purpose:
 * Deploys ONLY the Phase 1 BOM-aggregation assets in a dependency-safe order,
 * and ensures required base tables exist first (non-destructive).
 *
 * Why:
 * `BOM_Shortage_Backup_VIEW` depends on:
 * - Stock_Data
 * - PO_Line_Tracking
 * - Material_Demand_VIEW
 * - Material_Issuance
 *
 * If any are missing, a bulk deploy can fail silently among many assets.
 *
 * How to use:
 * 1) Run `run_Phase1_AssignSourcing_AggregationDeploy()` from Apps Script editor.
 * 2) Then run the verification queries in the Phase1 review.
 */
function run_Phase1_AssignSourcing_AggregationDeploy() {
  const vault = getSQLVault();
  const config = getCoreConfig();
  const project = config.connection.PROJECT_ID;
  const dataset = config.connection.DATASET_ID;

  Logger.log('');
  Logger.log('═══════════════════════════════════════════════════════════════');
  Logger.log('🚀 PHASE 1 SAFE DEPLOY — Assign_Sourcing Aggregation Views');
  Logger.log('═══════════════════════════════════════════════════════════════');

  // Step 1: Ensure schema tables exist (CREATE IF NOT EXISTS; non-destructive)
  Logger.log('');
  Logger.log('▶ Step 1/4: Ensuring required tables exist (safe create)...');
  try {
    admin_InitializeDatabase();
    Logger.log('  ✅ Base tables verified/created.');
  } catch (e) {
    Logger.log(`  ❌ FAILED: ${e.message}`);
    Logger.log('  🛑 Deploy halted — schema verification failed.');
    return;
  }

  // Step 2: Material_Issuance dependency note (NON-DESTRUCTIVE)
  // We intentionally DO NOT DROP/RECREATE any tables here.
  // admin_InitializeDatabase() already ran CREATE TABLE IF NOT EXISTS for all configured tables.
  Logger.log('');
  Logger.log('▶ Step 2/4: Material_Issuance dependency check (non-destructive)...');
  Logger.log('  ✅ Material_Issuance should exist (created-if-missing in Step 1).');

  // Step 3: Deploy Material_Demand_VIEW if present (BOM backup depends on it)
  Logger.log('');
  Logger.log('▶ Step 3/4: Deploying Material_Demand_VIEW (dependency for BOM backup)...');
  try {
    if (!vault['Material_Demand_VIEW']) throw new Error('Material_Demand_VIEW not found in SQL_Vault.');
    runWriteQuery(vault['Material_Demand_VIEW']);
    Logger.log('  ✅ Material_Demand_VIEW deployed.');
  } catch (e) {
    Logger.log(`  ❌ FAILED: ${e.message}`);
    Logger.log('  🛑 Deploy halted — cannot proceed without Material_Demand_VIEW.');
    return;
  }

  // Step 4: Deploy the Phase 1 aggregation views in correct order
  Logger.log('');
  Logger.log('▶ Step 4/4: Deploying aggregation views (BOM backup → aggregated feed)...');
  try {
    if (!vault['BOM_Shortage_Backup_VIEW']) throw new Error('BOM_Shortage_Backup_VIEW not found in SQL_Vault.');
    runWriteQuery(vault['BOM_Shortage_Backup_VIEW']);
    Logger.log('  ✅ BOM_Shortage_Backup_VIEW deployed.');

    if (!vault['Sourcing_Feed_Aggregated_VIEW']) throw new Error('Sourcing_Feed_Aggregated_VIEW not found in SQL_Vault.');
    runWriteQuery(vault['Sourcing_Feed_Aggregated_VIEW']);
    Logger.log('  ✅ Sourcing_Feed_Aggregated_VIEW deployed.');

  } catch (e) {
    Logger.log(`  ❌ FAILED: ${e.message}`);
    Logger.log('  🛑 Deploy halted — fix the SQL error above and re-run this deploy.');
    return;
  }

  Logger.log('');
  Logger.log('═══════════════════════════════════════════════════════════════');
  Logger.log('✅ PHASE 1 SAFE DEPLOY COMPLETE — Assign_Sourcing Aggregation');
  Logger.log(`Verify in BigQuery: \`${project}.${dataset}.BOM_Shortage_Backup_VIEW\` and \`${project}.${dataset}.Sourcing_Feed_Aggregated_VIEW\``);
  Logger.log('═══════════════════════════════════════════════════════════════');
  Logger.log('');
}

function run_Manual_Schema_Update() {
  // 🔄 M4 PO Legacy AutoSync — Phase 0: Drop & Recreate PO tables
  // This allows PO_Line_Tracking to get the new LAST_SEEN_IN_SYNC column
  // and clears all legacy test data so AutoSync starts fresh.
  const tablesToUpdate = [
    'PR_Draft',
    'PR_Staging',
    'PR_Final'
  ];
  
  admin_RecreateSpecificTables(tablesToUpdate);
}

/**
 * 🚀 PHASE 1 SMART DEPLOY (Dependency-Ordered SQL Installer)
 *
 * WHY THIS EXISTS:
 *   admin_DeploySQLAssets() deploys all SQL assets at once without
 *   respecting the dependency chain, which causes two cascading errors:
 *
 *   Error 1: Material_Demand_VIEW → "Table Material_Issuance not found"
 *            (The VIEW JOINs Material_Issuance, but the table didn't exist yet)
 *
 *   Error 2: Matching_Engine_VIEW + SP_RUN_MATCHING_ENGINE → "GROSS_DEMAND_QTY not found"
 *            (Both read from Material_Demand_SNAPSHOT which still has old schema
 *             with MATERIAL_DEMANDED, not GROSS_DEMAND_QTY)
 *
 * WHAT THIS FUNCTION DOES (in strict dependency order):
 *
 *   Step 1 → Create Material_Issuance table
 *            (clears Error 1 — the table now exists before the VIEW is deployed)
 *
 *   Step 2 → Deploy Material_Demand_VIEW to BigQuery
 *            (now succeeds because Material_Issuance exists)
 *
 *   Step 3 → Rebuild Material_Demand_SNAPSHOT with new schema
 *            (clears Error 2 — SNAPSHOT now has GROSS_DEMAND_QTY column)
 *
 *   Step 4 → Deploy Matching_Engine_VIEW
 *            (now succeeds because SNAPSHOT has GROSS_DEMAND_QTY)
 *
 *   Step 5 → Deploy SP_RUN_MATCHING_ENGINE
 *            (now succeeds — all column names resolve correctly)
 *
 *   Step 6 → Create M2_Pipeline_Ledger table
 *            (needed by Step 5's SP to INSERT into)
 *
 *   Step 7 → Create M2_Daily_Stats table
 *            (for Phase 6, created now, populated later)
 *
 * HOW TO USE:
 *   Run this function ONCE after copying the updated code to Apps Script.
 *   Do NOT run admin_DeploySQLAssets() for Phase 1 — use this instead.
 *   After this completes, trigger a manual M2 run for end-to-end verification.
 */
function run_Phase1_SmartDeploy() {
  const vault = getSQLVault();
  const config = getCoreConfig();
  const project = config.connection.PROJECT_ID;
  const dataset = config.connection.DATASET_ID;

  Logger.log('');
  Logger.log('═══════════════════════════════════════════════════════════════');
  Logger.log('🚀 PHASE 1 SMART DEPLOY — Dual-Method Shortage Upgrade');
  Logger.log('═══════════════════════════════════════════════════════════════');

  // ─────────────────────────────────────────────────────────────────
  // STEP 1: Create Material_Issuance table FIRST
  // (Must exist before Material_Demand_VIEW can be deployed)
  // ─────────────────────────────────────────────────────────────────
  Logger.log('');
  Logger.log('▶ Step 1/7: Creating Material_Issuance table...');
  try {
    admin_BuildMaterialIssuanceTable();
    Logger.log('  ✅ Material_Issuance table ready.');
  } catch (e) {
    Logger.log(`  ❌ FAILED: ${e.message}`);
    Logger.log('  🛑 Deploy halted — cannot proceed without Material_Issuance.');
    return;
  }

  // ─────────────────────────────────────────────────────────────────
  // STEP 2: Deploy Material_Demand_VIEW
  // (Can now resolve the Material_Issuance LEFT JOIN)
  // ─────────────────────────────────────────────────────────────────
  Logger.log('');
  Logger.log('▶ Step 2/7: Deploying Material_Demand_VIEW...');
  try {
    runWriteQuery(vault['Material_Demand_VIEW']);
    Logger.log('  ✅ Material_Demand_VIEW deployed with 8 new columns.');
  } catch (e) {
    Logger.log(`  ❌ FAILED: ${e.message}`);
    Logger.log('  🛑 Deploy halted — cannot proceed without Material_Demand_VIEW.');
    return;
  }

  // ─────────────────────────────────────────────────────────────────
  // STEP 3: Rebuild Material_Demand_SNAPSHOT
  // (Critical: refresh schema so GROSS_DEMAND_QTY exists in snapshot)
  // ─────────────────────────────────────────────────────────────────
  Logger.log('');
  Logger.log('▶ Step 3/7: Rebuilding Material_Demand_SNAPSHOT schema...');
  try {
    admin_RebuildMaterialDemandSnapshot();
    Logger.log('  ✅ SNAPSHOT schema updated with GROSS_DEMAND_QTY and new columns.');
  } catch (e) {
    Logger.log(`  ❌ FAILED: ${e.message}`);
    Logger.log('  🛑 Deploy halted — SNAPSHOT must match VIEW before deploying engine.');
    return;
  }

  // ─────────────────────────────────────────────────────────────────
  // STEP 4: Deploy Matching_Engine_VIEW
  // (Now reads GROSS_DEMAND_QTY from SNAPSHOT — column exists)
  // ─────────────────────────────────────────────────────────────────
  Logger.log('');
  Logger.log('▶ Step 4/7: Deploying Matching_Engine_VIEW...');
  try {
    runWriteQuery(vault['Matching_Engine_VIEW']);
    Logger.log('  ✅ Matching_Engine_VIEW deployed.');
  } catch (e) {
    Logger.log(`  ❌ FAILED: ${e.message}`);
    Logger.log('  🛑 Deploy halted.');
    return;
  }

  // ─────────────────────────────────────────────────────────────────
  // STEP 5: Create M2_Pipeline_Ledger table
  // (Must exist before SP_RUN_MATCHING_ENGINE is deployed —
  //  BigQuery validates the INSERT INTO at compile time)
  // ─────────────────────────────────────────────────────────────────
  Logger.log('');
  Logger.log('▶ Step 5/7: Creating M2_Pipeline_Ledger table...');
  try {
    admin_BuildM2PipelineLedger();
    Logger.log('  ✅ M2_Pipeline_Ledger table ready.');
  } catch (e) {
    Logger.log(`  ❌ FAILED: ${e.message}`);
    Logger.log('  🛑 Deploy halted — SP_RUN_MATCHING_ENGINE will fail without Ledger table.');
    return;
  }

  // ─────────────────────────────────────────────────────────────────
  // STEP 6: Deploy SP_RUN_MATCHING_ENGINE
  // (All dependencies now exist)
  // ─────────────────────────────────────────────────────────────────
  Logger.log('');
  Logger.log('▶ Step 6/7: Deploying SP_RUN_MATCHING_ENGINE...');
  try {
    runWriteQuery(vault['SP_RUN_MATCHING_ENGINE']);
    Logger.log('  ✅ SP_RUN_MATCHING_ENGINE deployed with Step 8 (M2_Pipeline_Ledger INSERT).');
  } catch (e) {
    Logger.log(`  ❌ FAILED: ${e.message}`);
    Logger.log('  🛑 SP deploy failed. Check BigQuery console for details.');
    return;
  }

  // ─────────────────────────────────────────────────────────────────
  // STEP 7: Create M2_Daily_Stats table (Phase 6 prep)
  // ─────────────────────────────────────────────────────────────────
  Logger.log('');
  Logger.log('▶ Step 7/7: Creating M2_Daily_Stats table...');
  try {
    admin_BuildM2DailyStats();
    Logger.log('  ✅ M2_Daily_Stats table ready (empty until Phase 6 activates recording).');
  } catch (e) {
    // Non-fatal — Phase 6 table, not needed for Phase 1 M2 run
    Logger.log(`  ⚠️ Warning: M2_Daily_Stats creation failed: ${e.message}`);
    Logger.log('  (Non-critical — continuing anyway, retry in Phase 6)');
  }

  // ─────────────────────────────────────────────────────────────────
  // DONE
  // ─────────────────────────────────────────────────────────────────
  Logger.log('');
  Logger.log('═══════════════════════════════════════════════════════════════');
  Logger.log('✅ PHASE 1 SMART DEPLOY COMPLETE');
  Logger.log('');
  Logger.log('Next: Trigger a manual M2 run from the main menu, then verify:');
  Logger.log('  1. BigQuery → Material_Demand_SNAPSHOT has GROSS_DEMAND_COMPLETION_METHOD column');
  Logger.log('  2. BigQuery → M2_Pipeline_Ledger has rows after the M2 run');
  Logger.log('  3. BigQuery → PR_Draft row count is same as before');
  Logger.log('═══════════════════════════════════════════════════════════════');
  Logger.log('');
}


/**
 * 🎯 SURGICAL SCHEMA UPDATE (Precision Tool)
 * * PURPOSE:
 * Drops and Re-creates ONLY the specific tables listed in the argument.
 * Use this when you update Config_Schema for specific modules (e.g., Removing VPO from PO_Line).
 * * * USAGE:
 * admin_RecreateSpecificTables(['PO_Line', 'PR_Final']);
 * * * WARNING:
 * This deletes all data in the specified tables.
 * * @param {Array<string>} targetTables - List of Table IDs to recreate (e.g. ['PO_Line'])
 */
function admin_RecreateSpecificTables(targetTables) {
  if (!targetTables || !Array.isArray(targetTables) || targetTables.length === 0) {
    Logger.log("⚠️ No tables specified. Usage: admin_RecreateSpecificTables(['Table_Name'])");
    return;
  }

  const config = getCoreConfig();
  const project = config.connection.PROJECT_ID;
  const dataset = config.connection.DATASET_ID;

  Logger.log(`🎯 Starting Surgical Update for: ${targetTables.join(', ')}...`);

  targetTables.forEach(tableName => {
    // 1. Validation: Does this table exist in our Schema Config?
    const tableDef = config.schemas[tableName];
    if (!tableDef) {
      Logger.log(`❌ Skipping '${tableName}': Not found in Config_Schema.`);
      return;
    }

    try {
      // 2. DROP the existing table
      Logger.log(`🔥 Dropping ${tableName}...`);
      const dropSql = `DROP TABLE IF EXISTS \`${project}.${dataset}.${tableName}\``;
      runWriteQuery(dropSql);

      // 3. GENERATE the new Create SQL
      const fields = tableDef.schema || tableDef.tempSchema;
      const columnsSQL = fields.map(f => {
        const bqType = TYPE_MAP[f.type] || 'STRING';
        return `${f.name} ${bqType}`;
      }).join(",\n  ");

      const createSql = `CREATE TABLE \`${project}.${dataset}.${tableName}\` (\n  ${columnsSQL}\n)`;

      // 4. CREATE the table
      Logger.log(`🔨 Re-creating ${tableName} with new schema...`);
      runWriteQuery(createSql);

      Logger.log(`✅ ${tableName} Updated Successfully.`);

    } catch (e) {
      Logger.log(`❌ Failed to update ${tableName}: ${e.message}`);
    }
  });

  Logger.log("🎯 Surgical Update Complete.");
}


// =========================================================
// ⚡ DYNAMIC SCHEMA UPGRADE ENGINE (V6.0)
// =========================================================

/**
 * 🚀 CONTROLLER: Upgrade Specific Tables
 * Usage: admin_UpgradeSpecificTables(['Production_Order'])
 * * Logic:
 * 1. Reads the latest schema from Config_Schema.
 * 2. Compares it against the live BigQuery table.
 * 3. runs the 'Atomic Swap' to inject new columns safely.
 */
function admin_UpgradeSpecificTables(targetTables) {
  const config = getCoreConfig();

  Logger.log(`🔄 Starting Dynamic Upgrade for: ${targetTables.join(', ')}...`);

  targetTables.forEach(tableName => {
    // 1. Validation
    const tableDef = config.schemas[tableName];
    if (!tableDef) {
      Logger.log(`❌ Skipping '${tableName}': Definition not found in Config_Schema.`);
      return;
    }

    try {
      // 2. Run the Worker
      run_Atomic_Schema_Upgrade(tableName, tableDef);
      
    } catch (e) {
      Logger.log(`❌ FAILED to upgrade ${tableName}: ${e.message}`);
      // Continue to next table if one fails
    }
  });
}

/**
 * ⚙️ WORKER: The Atomic Swap Logic (Robust Edition)
 * Dynamically builds the CREATE OR REPLACE statement.
 * * HANDLES PARTITIONING CHANGES:
 * If BigQuery blocks the swap due to partition spec changes,
 * it automatically switches to "Migration Mode" (Temp -> Drop -> Rename).
 */
function run_Atomic_Schema_Upgrade(tableName, tableDef) {
  const config = getCoreConfig();
  const project = config.connection.PROJECT_ID;
  const dataset = config.connection.DATASET_ID;
  
  // 1. Fetch Current Columns from BigQuery (The Reality)
  const currentColumns = _getBigQueryColumns(project, dataset, tableName);
  if (currentColumns.size === 0) {
    throw new Error(`Table '${tableName}' does not exist in BigQuery. Please use 'Recreate' instead.`);
  }

  // 2. Build the Bridge (Code vs Reality)
  const targetFields = tableDef.schema || tableDef.tempSchema;
  
  const selectClauses = targetFields.map(field => {
    const fieldName = field.name;
    const fieldType = TYPE_MAP[field.type] || 'STRING';
    
    if (currentColumns.has(fieldName)) {
      // Case A: Column exists -> Keep Data
      return `      ${fieldName}`; 
    } else {
      // Case B: New Column -> Inject NULL (Safe)
      Logger.log(`   ✨ Detected New Column in '${tableName}': ${fieldName} (${fieldType})`);
      return `      CAST(NULL AS ${fieldType}) AS ${fieldName}`;
    }
  });

  // 3. Smart Partitioning Logic
  let partitionClause = '';
  const hasUpdatedAt = targetFields.some(f => f.name === 'UPDATED_AT');
  const hasSnapshot = targetFields.some(f => f.name === 'SNAPSHOT_DATE');
  
  if (hasUpdatedAt) {
    partitionClause = 'PARTITION BY DATE(UPDATED_AT)';
  } else if (hasSnapshot) {
    partitionClause = 'PARTITION BY SNAPSHOT_DATE'; 
  }

  // 4. Clustering
  const clusterClause = `CLUSTER BY ${targetFields[0].name}`;

  // 5. Construct the Query Base
  // We build the SELECT part separately so we can reuse it
  const selectQuery = `
    SELECT
${selectClauses.join(',\n')}
    FROM \`${project}.${dataset}.${tableName}\`
  `;

  const standardSql = `
    CREATE OR REPLACE TABLE \`${project}.${dataset}.${tableName}\`
    ${partitionClause}
    ${clusterClause}
    AS ${selectQuery}
  `;

  // 6. Execute with Fallback
  try {
    Logger.log(`⚡ Executing Atomic Swap on ${tableName}...`);
    runWriteQuery(standardSql);
    Logger.log(`✅ SUCCESS: ${tableName} upgraded to V6 Schema.`);

  } catch (e) {
    // 7. HANDLE PARTITIONING CHANGE (The "Migration Mode")
    if (e.message.includes("partitioning spec")) {
      Logger.log(`⚠️ Partitioning Change Detected. Switching to Migration Mode (Temp -> Drop -> Rename)...`);
      
      const tempTableName = `${tableName}_MIGRATION_TEMP`;
      
      // Step A: Create Temp Table with New Structure
      const migrationSql = `
        CREATE OR REPLACE TABLE \`${project}.${dataset}.${tempTableName}\`
        ${partitionClause}
        ${clusterClause}
        AS ${selectQuery}
      `;
      
      try {
        Logger.log(`   1. Creating Temp Table: ${tempTableName}...`);
        runWriteQuery(migrationSql);
        
        Logger.log(`   2. Dropping Old Table...`);
        runWriteQuery(`DROP TABLE \`${project}.${dataset}.${tableName}\``);
        
        Logger.log(`   3. Renaming Temp to Final...`);
        runWriteQuery(`ALTER TABLE \`${project}.${dataset}.${tempTableName}\` RENAME TO \`${tableName}\``);
        
        Logger.log(`✅ SUCCESS: ${tableName} migrated to Partitioned Schema.`);
        
      } catch (migrationErr) {
        Logger.log(`❌ MIGRATION FAILED: ${migrationErr.message}`);
        Logger.log(`🛡️ DATA SAFETY: Check if '${tempTableName}' exists. Your data might be there.`);
        throw migrationErr;
      }
      
    } else {
      // If it's another error (like syntax), throw it normally
      throw e;
    }
  }
}

/**
 * 🕵️ HELPER: Fetch existing columns from BigQuery
 * Uses INFORMATION_SCHEMA to see what currently exists.
 */
function _getBigQueryColumns(project, dataset, tableName) {
  const sql = `
    SELECT column_name 
    FROM \`${project}.${dataset}.INFORMATION_SCHEMA.COLUMNS\` 
    WHERE table_name = '${tableName}'
  `;
  
  // Assumes runReadQueryMapped is available in the library scope
  // If strict mode, use ISC_SCM_Core_Lib.runReadQueryMapped(sql)
  const rows = runReadQueryMapped(sql); 
  
  const colSet = new Set();
  if (rows && rows.length > 0) {
    rows.forEach(r => colSet.add(r.column_name));
  }
  return colSet;
}


// =========================================================
// 🆕 PHASE 1 ADMIN FUNCTIONS (Dual-Method Upgrade)
// Added: 2026-03-01 | Ref: shortage_calculation_implementation_plan.md
// =========================================================

/**
 * 🔁 REBUILD MATERIAL DEMAND SNAPSHOT
 *
 * PURPOSE: Drops and recreates Material_Demand_SNAPSHOT so its schema
 * exactly matches the current Material_Demand_VIEW definition.
 *
 * ⚠️ WHEN TO RUN:
 *   - After deploying the updated Material_Demand_VIEW to BigQuery
 *   - Before the next M2 nightly run (M2 tries to INSERT * into SNAPSHOT)
 *   - If you see "Schema mismatch" errors in M2 logs
 *
 * 🛡️ SAFETY: This table is a transient cache — it is fully
 *   re-populated on every M2 run. Dropping it loses nothing.
 *
 * HOW TO USE: Run this function once from Apps Script editor after
 *   deploying SQL_Vault updates to BigQuery.
 */
function admin_RebuildMaterialDemandSnapshot() {
  const config = getCoreConfig();
  const project = config.connection.PROJECT_ID;
  const dataset = config.connection.DATASET_ID;
  const fq = `\`${project}.${dataset}\``;

  Logger.log('🔁 Rebuilding Material_Demand_SNAPSHOT...');

  try {
    // Drop the old schema
    const dropSql = `DROP TABLE IF EXISTS ${fq}.Material_Demand_SNAPSHOT`;
    runWriteQuery(dropSql);
    Logger.log('  ✅ Old SNAPSHOT dropped.');

    // Recreate from VIEW (captures new + old columns, 0 rows)
    const createSql = `
      CREATE TABLE ${fq}.Material_Demand_SNAPSHOT
      AS SELECT * FROM ${fq}.Material_Demand_VIEW
      LIMIT 0
    `;
    runWriteQuery(createSql);
    Logger.log('  ✅ New SNAPSHOT created with upgraded schema (0 rows).');
    Logger.log('🎯 Material_Demand_SNAPSHOT rebuild complete. Run M2 to populate it.');

  } catch (e) {
    Logger.log(`❌ FAILED to rebuild SNAPSHOT: ${e.message}`);
    throw e;
  }
}


/**
 * 📦 BUILD MATERIAL_ISSUANCE TABLE
 *
 * PURPOSE: Creates the Material_Issuance table in BigQuery using the
 * schema defined in Config_Schema (8 columns).
 *
 * CONTEXT: This table is the data source for the GROSS_DEMAND_ISSUANCE_METHOD column
 * in Material_Demand_VIEW. It remains EMPTY until Phase 3 (M4_Issuance_AutoSync).
 * The Material_Demand_VIEW handles this gracefully — HAS_ISSUANCE_DATA will be
 * FALSE and GROSS_DEMAND_ISSUANCE_METHOD will be 0 for all rows until Phase 3 syncs data.
 *
 * HOW TO USE: Run once during Phase 1 deployment sequence.
 */
function admin_BuildMaterialIssuanceTable() {
  Logger.log('📦 Building Material_Issuance table...');
  try {
    admin_RecreateSpecificTables(['Material_Issuance']);
    Logger.log('✅ Material_Issuance table created (empty — Phase 3 will populate via AutoSync).');
  } catch (e) {
    Logger.log(`❌ FAILED to build Material_Issuance: ${e.message}`);
    throw e;
  }
}


/**
 * 📊 BUILD M2_PIPELINE_LEDGER TABLE
 *
 * PURPOSE: Creates the M2_Pipeline_Ledger table in BigQuery.
 * This is the append-only archive table with 25 columns.
 *
 * IMPORTANT: This is a persistent DATA table (not a transient cache).
 * Do NOT drop and recreate unless intentionally clearing history.
 * Use admin_UpgradeSpecificTables(['M2_Pipeline_Ledger']) to add columns safely.
 *
 * HOW TO USE: Run ONCE during Phase 1 deployment. After first run,
 * the table will accumulate one snapshot per M2 run per day.
 */
function admin_BuildM2PipelineLedger() {
  Logger.log('📊 Building M2_Pipeline_Ledger table...');
  const config = getCoreConfig();
  const project = config.connection.PROJECT_ID;
  const dataset = config.connection.DATASET_ID;
  const tableName = 'M2_Pipeline_Ledger';

  // Check if it already exists to avoid wiping historical data
  try {
    const checkSql = `SELECT COUNT(*) as row_count FROM \`${project}.${dataset}.${tableName}\``;
    const rows = runReadQueryMapped(checkSql);
    if (rows && rows.length > 0) {
      const count = rows[0].row_count;
      Logger.log(`⚠️ ${tableName} already exists with ${count} rows. NOT dropping to protect history.`);
      Logger.log('   To force rebuild, call admin_RecreateSpecificTables([\'M2_Pipeline_Ledger\']) explicitly.');
      return;
    }
  } catch (e) {
    // Table doesn't exist yet — safe to create
    Logger.log(`   Table does not exist yet. Creating fresh...`);
  }

  try {
    admin_RecreateSpecificTables([tableName]);
    Logger.log(`✅ ${tableName} created successfully.`);
  } catch (e) {
    Logger.log(`❌ FAILED to build ${tableName}: ${e.message}`);
    throw e;
  }
}


/**
 * 📊 BUILD M2_DAILY_STATS TABLE
 *
 * PURPOSE: Creates the M2_Daily_Stats table in BigQuery (Phase 6 table).
 * This can be created now although it won't be populated until Phase 6
 * deploys the recording logic.
 *
 * HOW TO USE: Run ONCE during Phase 1 deployment sequence.
 */
function admin_BuildM2DailyStats() {
  Logger.log('📊 Building M2_Daily_Stats table...');
  try {
    admin_RecreateSpecificTables(['M2_Daily_Stats']);
    Logger.log('✅ M2_Daily_Stats table created (empty — Phase 6 will activate recording).');
  } catch (e) {
    Logger.log(`❌ FAILED to build M2_Daily_Stats: ${e.message}`);
    throw e;
  }
}


// =========================================================
// ⚙️ PHASE 7 ADMIN FUNCTIONS (Auto-Switch Config)
// Added: 2026-03-10 | Ref: Phase7/Phase7_Implementation_Plan_V2.md
// =========================================================

/**
 * ⚙️ BUILD METHOD_OVERRIDE_CONFIG TABLE + SEED DATA
 *
 * PURPOSE: Creates the Method_Override_Config table and inserts
 * the initial override for 'Chì' (Lead) materials, directing the
 * system to use the ISSUANCE method for GROSS_DEMAND_QTY calculation.
 *
 * HOW IT WORKS:
 *   1. Creates the table from Config_Schema definition.
 *   2. Inserts seed row: Chì → ISSUANCE method → IS_ACTIVE = TRUE.
 *      VALIDATED_BY / VALIDATED_AT start as NULL — to be populated
 *      after Ngàn confirms issuance values match the Lead Plan.
 *
 * SAFETY: The seed INSERT uses a NOT EXISTS guard to prevent duplicates
 * if this function is accidentally run twice.
 *
 * HOW TO USE: Run ONCE during Phase 7 deployment sequence (Step 1.3).
 */
function admin_BuildMethodOverrideConfig() {
  const config = getCoreConfig();
  const project = config.connection.PROJECT_ID;
  const dataset = config.connection.DATASET_ID;
  const fq = `\`${project}.${dataset}\``;

  Logger.log('⚙️ Building Method_Override_Config table...');

  // Step 1: Create the table from Config_Schema definition
  try {
    admin_RecreateSpecificTables(['Method_Override_Config']);
    Logger.log('  ✅ Method_Override_Config table created.');
  } catch (e) {
    Logger.log(`  ❌ FAILED to create table: ${e.message}`);
    throw e;
  }

  // Step 2: Seed the initial Chì override row
  try {
    const seedSql = `
      INSERT INTO ${fq}.Method_Override_Config
      (CONFIG_ID, MAIN_GROUP, PREFERRED_METHOD, IS_ACTIVE, VALIDATED_BY, VALIDATED_AT, NOTES, CREATED_AT, UPDATED_AT)
      SELECT
        'MOC_chi', 'Chì', 'ISSUANCE', TRUE,
        NULL, NULL,
        'Lead materials: Issuance method eliminates WIP-gap phantom shortages. Pending validation by Ngàn vs Lead Plan.',
        CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP()
      FROM unnest([1])
      WHERE NOT EXISTS (
        SELECT 1 FROM ${fq}.Method_Override_Config WHERE CONFIG_ID = 'MOC_chi'
      )
    `;
    runWriteQuery(seedSql);
    Logger.log('  ✅ Seed row inserted: Chì → ISSUANCE, IS_ACTIVE = TRUE.');
  } catch (e) {
    Logger.log(`  ⚠️ Seed insert failed (may already exist): ${e.message}`);
  }

  Logger.log('⚙️ Method_Override_Config ready. Verify: SELECT * FROM Method_Override_Config');
}


/**
 * 🚀 PHASE 1 BOOTSTRAP (Run-All Installer)
 *
 * PURPOSE: Runs the complete Phase 1 setup sequence in the correct order.
 * Run ONCE after deploying updated SQL_Vault and Config_Schema to BigQuery.
 *
 * ═══════════════════════════════════════════════════════════════
 * DEPLOYMENT ORDER (IMPORTANT — do not change the sequence):
 * ═══════════════════════════════════════════════════════════════
 * 1. Deploy updated SQL_Vault to BigQuery (admin_DeploySQLAssets runs Material_Demand_VIEW)
 * 2. Run THIS function (admin_Phase1_Bootstrap) AFTER #1
 * 3. Trigger a manual M2 run to verify the full pipeline
 *
 * WHAT IT DOES:
 *   Step A: Creates Material_Issuance    (empty, Phase 3 will populate)
 *   Step B: Creates M2_Pipeline_Ledger   (empty, M2 will populate from now on)
 *   Step C: Creates M2_Daily_Stats       (empty, Phase 6 will populate)
 *   Step D: Rebuilds Material_Demand_SNAPSHOT (schema update — drops and recreates)
 *
 * IDEMPOTENT: Steps A-C check for existing data before dropping tables.
 *   Step D always rebuilds SNAPSHOT (it's a transient cache, data-loss is safe).
 */
function admin_Phase1_Bootstrap() {
  Logger.log('');
  Logger.log('═══════════════════════════════════════════════════════');
  Logger.log('🚀 PHASE 1 BOOTSTRAP: Dual-Method Shortage Upgrade');
  Logger.log('═══════════════════════════════════════════════════════');
  Logger.log('');

  Logger.log('▶ Step A: Creating Material_Issuance table...');
  admin_BuildMaterialIssuanceTable();

  Logger.log('');
  Logger.log('▶ Step B: Creating M2_Pipeline_Ledger table...');
  admin_BuildM2PipelineLedger();

  Logger.log('');
  Logger.log('▶ Step C: Creating M2_Daily_Stats table...');
  admin_BuildM2DailyStats();

  Logger.log('');
  Logger.log('▶ Step D: Rebuilding Material_Demand_SNAPSHOT (schema refresh)...');
  admin_RebuildMaterialDemandSnapshot();

  Logger.log('');
  Logger.log('═══════════════════════════════════════════════════════');
  Logger.log('✅ PHASE 1 BOOTSTRAP COMPLETE');
  Logger.log('');
  Logger.log('Next steps:');
  Logger.log('  1. Trigger a manual M2 run from the main menu');
  Logger.log('  2. Check BigQuery: Material_Demand_SNAPSHOT should have new columns');
  Logger.log('     (GROSS_DEMAND_COMPLETION_METHOD, GROSS_DEMAND_ISSUANCE_METHOD, GROSS_DEMAND_QTY, MAIN_GROUP...)');
  Logger.log('  3. Check BigQuery: M2_Pipeline_Ledger should have rows from this run');
  Logger.log('  4. Run verification queries from the Implementation Plan (Step 1.8)');
  Logger.log('═══════════════════════════════════════════════════════');
  Logger.log('');
}


// =========================================================
// 📦 PHASE 3 ADMIN FUNCTIONS (Material Issuance AutoSync)
// Added: 2026-03-02 | Ref: M4_Issuance_AutoSync pipeline
// =========================================================

/**
 * 🚀 PHASE 3 SMART DEPLOY
 *
 * PURPOSE: Deploys M4 Issuance AutoSync pipeline assets to BigQuery
 * in the correct dependency order:
 *
 *   Step 1 → Create Material_Issuance_Staging table
 *   Step 2 → Upgrade Material_Issuance schema (add SOURCE_ID, MAIN_GROUP, RESOLUTION_METHOD)
 *   Step 3 → Deploy SP_M4_ISSUANCE_MERGE stored procedure
 *
 * HOW TO USE:
 *   1. Paste all M4_Issuance_AutoSync_*.gs files into Apps Script.
 *   2. Run run_Phase3_SmartDeploy() from the script editor.
 *   3. Spreadsheet: 📦 Issuance AutoSync → Admin Tools → Build Dashboard Tabs.
 *   4. Spreadsheet: 📦 Issuance AutoSync → ▶️ Run Sync Now.
 *   5. Spreadsheet: 📦 Issuance AutoSync → ⏰ Install Nightly Trigger.
 */
function run_Phase3_SmartDeploy() {
  const vault = getSQLVault();
  const config = getCoreConfig();
  const project = config.connection.PROJECT_ID;
  const dataset = config.connection.DATASET_ID;

  Logger.log('');
  Logger.log('═══════════════════════════════════════════════════════════════');
  Logger.log('🚀 PHASE 3 SMART DEPLOY — M4 Issuance AutoSync');
  Logger.log('═══════════════════════════════════════════════════════════════');

  Logger.log('');
  Logger.log('▶ Step 1/3: Creating Material_Issuance_Staging table...');
  try {
    admin_BuildMaterialIssuanceStagingTable();
    Logger.log('  ✅ Material_Issuance_Staging ready.');
  } catch (e) {
    Logger.log(`  ❌ FAILED: ${e.message}`);
    return;
  }

  Logger.log('');
  Logger.log('▶ Step 2/3: Upgrading Material_Issuance schema (Phase 3 columns)...');
  try {
    const miTableDef = config.schemas['Material_Issuance'];
    if (miTableDef) {
      run_Atomic_Schema_Upgrade('Material_Issuance', miTableDef);
      Logger.log('  ✅ Material_Issuance upgraded with SOURCE_ID, MAIN_GROUP, RESOLUTION_METHOD.');
    } else {
      Logger.log('  ⚠️ Material_Issuance not in Config_Schema. Skipping schema upgrade.');
    }
  } catch (e) {
    Logger.log(`  ⚠️ Schema upgrade warning (non-fatal): ${e.message}`);
  }

  Logger.log('');
  Logger.log('▶ Step 3/3: Deploying SP_M4_ISSUANCE_MERGE...');
  try {
    if (!vault['SP_M4_ISSUANCE_MERGE']) {
      throw new Error('SP_M4_ISSUANCE_MERGE not found in SQL_Vault. Check SQL_Vault.txt.');
    }
    runWriteQuery(vault['SP_M4_ISSUANCE_MERGE']);
    Logger.log('  ✅ SP_M4_ISSUANCE_MERGE deployed successfully.');
  } catch (e) {
    Logger.log(`  ❌ FAILED: ${e.message}`);
    return;
  }

  Logger.log('');
  Logger.log('═══════════════════════════════════════════════════════════════');
  Logger.log('✅ PHASE 3 SMART DEPLOY COMPLETE');
  Logger.log('');
  Logger.log('Next steps:');
  Logger.log('  1. Spreadsheet → 📦 Issuance AutoSync → Admin Tools → Build Dashboard Tabs');
  Logger.log('  2. Spreadsheet → 📦 Issuance AutoSync → ▶️ Run Sync Now');
  Logger.log('  3. BigQuery verification:');
  Logger.log(`     SELECT SOURCE_ID, COUNT(*) rows, SUM(CUMULATIVE_ISSUANCE_QTY) total`);
  Logger.log(`     FROM \`${project}.${dataset}.Material_Issuance\` GROUP BY SOURCE_ID;`);
  Logger.log('  4. Spreadsheet → 📦 Issuance AutoSync → ⏰ Install Nightly Trigger');
  Logger.log('═══════════════════════════════════════════════════════════════');
  Logger.log('');
}


/**
 * 📦 BUILD MATERIAL_ISSUANCE_STAGING TABLE
 * Creates the ephemeral staging/landing table for Issuance AutoSync.
 * WRITE_TRUNCATE per run — safe to recreate at any time.
 */
function admin_BuildMaterialIssuanceStagingTable() {
  Logger.log('📦 Building Material_Issuance_Staging table...');
  try {
    admin_RecreateSpecificTables(['Material_Issuance_Staging']);
    Logger.log('✅ Material_Issuance_Staging created (ephemeral — WRITE_TRUNCATE per sync run).');
  } catch (e) {
    Logger.log(`❌ FAILED to build Material_Issuance_Staging: ${e.message}`);
    throw e;
  }
}


