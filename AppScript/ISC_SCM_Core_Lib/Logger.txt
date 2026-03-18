/**
 * 📝 SYSTEM LOGGER & STATE MACHINE TRACKER
 * * RESPONSIBILITIES:
 * 1. Defines the 'System_Execution_Log' Schema (Source of Truth).
 * 2. Writes audit logs for every workflow step.
 * 3. Provides the "Self-Healing" setup function to create the log table.
 * * DEPENDENCIES:
 * - Config_Env.gs (getCoreConfig)
 * - BigQueryClient.gs (runWriteQuery)
 */

// ==========================================
// 1. SOURCE OF TRUTH (DDL)
// ==========================================
function getLogTableDDL() {
  const config = getCoreConfig();
  const fullTableName = `\`${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}.${config.tables.System_Execution_Log}\``;
  
  // Defines the Schema for the State Machine Log [cite: 160-162]
  return `
    CREATE TABLE IF NOT EXISTS ${fullTableName} (
      BATCH_ID STRING NOT NULL,         -- UUID for the run
      MODULE_ID STRING NOT NULL,        -- 'M4_MONDAY_PROTOCOL', etc
      STEP_ID INT64 NOT NULL,           -- Sequence number
      STEP_NAME STRING NOT NULL,        -- 'RUN_JANITOR'
      STATUS STRING NOT NULL,           -- 'SUCCESS', 'FAILED', 'RUNNING'
      DURATION_SEC FLOAT64,             -- Performance monitoring
      ERROR_MESSAGE STRING,             -- Stack trace if failed
      LOGGED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
    );
  `;
}

// ==========================================
// 2. INFRASTRUCTURE SETUP (Run Once)
// ==========================================
/**
 * Executes the DDL to create the Log Table.
 * Run this function manually from the Apps Script Editor to finish Phase 0.
 */
function setupLogInfrastructure() {
  const sql = getLogTableDDL();
  Logger.log("🛠️ Ensuring System_Execution_Log table exists...");
  
  try {
    runWriteQuery(sql);
    Logger.log("✅ Log Infrastructure Verified. Phase 0 Complete.");
  } catch (e) {
    Logger.log("❌ Setup Failed: " + e.message);
  }
}

// ==========================================
// 3. LOGGING UTILITY (Public)
// ==========================================
/**
 * Logs a step execution to BigQuery.
 * Used by State Machines to track progress.
 * * @param {string} batchId - The Unique ID of the current run.
 * @param {string} moduleId - The Module Name (e.g., 'ISC_M4').
 * @param {number} stepId - The Step Number (1, 2, 3...).
 * @param {string} stepName - The Step Name (e.g., 'FILTER_DATA').
 * @param {string} status - 'RUNNING', 'SUCCESS', 'FAILED'.
 * @param {number} durationSec - (Optional) Time taken.
 * @param {string} errorMessage - (Optional) Error details.
 */
/* [Update in Logger.gs] */
function logStep(batchId, moduleId, stepId, stepName, status, durationSec = 0, errorMessage = null) {
  const config = getCoreConfig();
  const fullTableName = `\`${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}.${config.tables.System_Execution_Log}\``;
  
  const safeError = errorMessage ? `'${errorMessage.replace(/'/g, "\\'")}'` : 'NULL';
  const safeDuration = durationSec || 0;

  // 🟢 FIX: Added LOGGED_AT to the INSERT statement explicitly
  const sql = `
    INSERT INTO ${fullTableName} 
    (BATCH_ID, MODULE_ID, STEP_ID, STEP_NAME, STATUS, DURATION_SEC, ERROR_MESSAGE, LOGGED_AT)
    VALUES (
      '${batchId}', 
      '${moduleId}', 
      ${stepId}, 
      '${stepName}', 
      '${status}', 
      ${safeDuration}, 
      ${safeError},
      CURRENT_TIMESTAMP()
    )
  `;

  try {
    runWriteQuery(sql);
  } catch (e) {
    console.error("CRITICAL: Failed to write to System Log. " + e.message);
  }
}


/**
 * 🚨 ERROR WRAPPER (Add this to Logger.gs)
 * Quick helper to log exceptions without needing full step details.
 * Used by M3_Main and future modules.
 */
function logError(moduleId, error) {
  // Generate a temporary Batch ID for the error
  const batchId = 'ERR_' + Utilities.getUuid().slice(0,8);
  
  // Use the existing logStep function to record the failure
  logStep(
    batchId, 
    moduleId, 
    999,             // Step ID 999 = Exception
    'ERROR_CATCH',   // Step Name
    'FAILED',        // Status
    0,               // Duration
    error.message || error.toString() // The actual error text
  );
  
  // Also print to the Apps Script console for immediate debugging
  console.error(`[${moduleId}] Error: ${error.message}`);
}