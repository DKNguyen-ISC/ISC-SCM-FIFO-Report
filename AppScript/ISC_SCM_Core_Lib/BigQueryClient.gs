/**
 * 🔌 BIGQUERY CLIENT
 * A generic, robust wrapper for the BigQuery API.
 * * RESPONSIBILITIES:
 * 1. Execute SQL (Read/Write) with Parameterization (Security).
 * 2. Handle Asynchronous Job Polling (Stability).
 * 3. Map complex BQ responses to clean JSON objects (Usability).
 * 4. Handle Bulk CSV Loads (Performance).
 * * DEPENDENCIES:
 * - Config_Env.gs (getCoreConfig)
 * - BigQuery Advanced Service (Must be enabled in Editor)
 */

const BQ_CLIENT_CONFIG = {
  MAX_RETRIES: 3,
  MAX_WAIT_TIME_MS: 300000, // 5 Minutes
  POLL_INTERVAL_MS: 1000
};

/**
 * Executes a Write Operation (INSERT, UPDATE, DELETE, MERGE, CREATE).
 * Blocks until the job is COMPLETE.
 * * @param {string} sql - Standard SQL query.
 * @param {Array} params - (Optional) Array of parameter objects for safety.
 * Format: [{name: 'id', parameterType: {type: 'STRING'}, parameterValue: {value: '123'}}]
 * @return {Object} The completed Job Resource.
 */
// function runWriteQuery(sql, params = []) {
//   const config = getCoreConfig();
//   const request = {
//     query: sql,
//     useLegacySql: false,
//     queryParameters: params
//   };

//   try {
//     const job = BigQuery.Jobs.query(request, config.connection.PROJECT_ID);
//     const jobId = job.jobReference.jobId;
    
//     // ⏳ Critical: Wait for BQ to actually finish
//     _waitForJob(jobId, config.connection.PROJECT_ID);
    
//     return job;
//   } catch (e) {
//     console.error(`❌ Write Query Failed: ${e.message}`);
//     throw new Error(`BigQuery Write Error: ${e.message}`);
//   }
// }


/**
 * Executes a Write Operation (INSERT, UPDATE, DELETE, MERGE, CREATE).
 * Blocks until the job is COMPLETE.
 * 🟢 PATCHED: Now includes Retry Logic for "Empty response" errors.
 */
function runWriteQuery(sql, params = []) {
  const config = getCoreConfig();
  const request = {
    query: sql,
    useLegacySql: false,
    queryParameters: params
  };

  let lastError = null;

  // 🔄 RETRY LOOP
  for (let attempt = 1; attempt <= BQ_CLIENT_CONFIG.MAX_RETRIES; attempt++) {
    try {
      const job = BigQuery.Jobs.query(request, config.connection.PROJECT_ID);
      const jobId = job.jobReference.jobId;
      
      // ⏳ Critical: Wait for BQ to actually finish
      _waitForJob(jobId, config.connection.PROJECT_ID);
      
      return job; // ✅ Success!

    } catch (e) {
      console.warn(`⚠️ Write Attempt ${attempt} failed: ${e.message}`);
      lastError = e;
      
      // If it's the last attempt, don't sleep, just fail
      if (attempt < BQ_CLIENT_CONFIG.MAX_RETRIES) {
        Utilities.sleep(2000 * attempt); // Wait 2s, then 4s, then 6s
      }
    }
  }

  // If we get here, all retries failed
  console.error(`❌ Write Query Failed after ${BQ_CLIENT_CONFIG.MAX_RETRIES} attempts: ${lastError.message}`);
  throw new Error(`BigQuery Write Error: ${lastError.message}`);
}

/**
 * Executes a Read Operation (SELECT) and returns clean JSON objects.
 * * @param {string} sql - Standard SQL query.
 * @param {Array} params - (Optional) Query parameters.
 * @return {Array<Object>} Array of objects, e.g., [{CUSTOMER: "ISC", QTY: 100}, ...]
 */
function runReadQueryMapped(sql, params = []) {
  const config = getCoreConfig();
  const request = {
    query: sql,
    useLegacySql: false,
    queryParameters: params
  };

  try {
    // 1. Submit Query
    let queryJob = BigQuery.Jobs.query(request, config.connection.PROJECT_ID);
    const jobId = queryJob.jobReference.jobId;

    // 2. Wait for Completion
    _waitForJob(jobId, config.connection.PROJECT_ID);

    // 3. Fetch Results (Handles basic pagination for standard datasets)
    // Note: For massive exports (>10MB), use Table Exports instead.
    const queryResults = BigQuery.Jobs.getQueryResults(config.connection.PROJECT_ID, jobId);
    
    const rows = queryResults.rows || [];
    const schema = queryResults.schema.fields || [];

    // 4. Map Rows to Objects
    return rows.map(row => {
      const obj = {};
      row.f.forEach((cell, index) => {
        const header = schema[index].name;
        obj[header] = cell.v; // Value
      });
      return obj;
    });

  } catch (e) {
    console.error(`❌ Read Query Failed: ${e.message}`);
    throw new Error(`BigQuery Read Error: ${e.message}`);
  }
}

/**
 * Loads a CSV string directly into a Table (Bulk Upload).
 * Much faster than INSERT for >100 rows.
 * * @param {string} tableId - Target Table Name (must match Dictionary).
 * @param {string} csvString - The raw CSV content string.
 * @param {string} writeDisposition - 'WRITE_TRUNCATE', 'WRITE_APPEND', or 'WRITE_EMPTY'.
 */
function loadCsvData(tableId, csvString, writeDisposition = 'WRITE_APPEND') {
  const config = getCoreConfig();
  const blob = Utilities.newBlob(csvString, 'application/octet-stream');
  
  const jobConfig = {
    configuration: {
      load: {
        destinationTable: {
          projectId: config.connection.PROJECT_ID,
          datasetId: config.connection.DATASET_ID,
          tableId: tableId
        },
        sourceFormat: 'CSV',
        skipLeadingRows: 1, // Assumes Header Row exists
        writeDisposition: writeDisposition,
        allowQuotedNewlines: true,
        autodetect: false // We use the predefined Schema in BQ
      }
    }
  };

  try {
    const job = BigQuery.Jobs.insert(jobConfig, config.connection.PROJECT_ID, blob);
    const jobId = job.jobReference.jobId;
    
    // ⏳ Wait for Upload to finish
    _waitForJob(jobId, config.connection.PROJECT_ID);
    
    Logger.log(`✅ Bulk Load to ${tableId} successful.`);
  } catch (e) {
    console.error(`❌ Bulk Load Failed: ${e.message}`);
    throw new Error(`BigQuery Load Error: ${e.message}`);
  }
}

// ==========================================
// 🔒 PRIVATE HELPERS
// ==========================================

/**
 * Polls the Job status until DONE or Timeout.
 * Prevents "Race Conditions" where scripts continue before BQ is ready.
 */
function _waitForJob(jobId, projectId) {
  let sleepTimeMs = 500;
  let totalWaitTimeMs = 0;
  
  while (totalWaitTimeMs < BQ_CLIENT_CONFIG.MAX_WAIT_TIME_MS) {
    const job = BigQuery.Jobs.get(projectId, jobId);
    const state = job.status.state;

    if (state === 'DONE') {
      if (job.status.errorResult) {
        throw new Error(`Job Failed: ${job.status.errorResult.message}`);
      }
      return; // Success
    }

    // Exponential Backoff (Wait longer each time, max 5s)
    Utilities.sleep(sleepTimeMs);
    totalWaitTimeMs += sleepTimeMs;
    sleepTimeMs = Math.min(sleepTimeMs * 2, 5000); 
  }

  throw new Error(`Job ${jobId} Timed Out after ${BQ_CLIENT_CONFIG.MAX_WAIT_TIME_MS}ms`);
}

/**
 * Helper to build Parameter Objects for runWriteQuery/runReadQueryMapped.
 * Usage: buildParams({ email: 'user@test.com', id: 123 })
 */
function buildParams(simpleObj) {
  return Object.keys(simpleObj).map(key => {
    const val = simpleObj[key];
    let type = 'STRING';
    
    if (typeof val === 'number') type = Number.isInteger(val) ? 'INT64' : 'FLOAT64';
    if (typeof val === 'boolean') type = 'BOOL';
    
    return {
      name: key,
      parameterType: { type: type },
      parameterValue: { value: String(val) }
    };
  });
}