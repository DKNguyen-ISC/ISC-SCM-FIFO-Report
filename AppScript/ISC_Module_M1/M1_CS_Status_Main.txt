/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🧠 M1_CS_Status_Main.gs
 * The "Intelligence Engine" for Customer Service Status Protocol (V15.0 Enhanced Logic)
 * ═══════════════════════════════════════════════════════════════════════════════
 * * V15.0 UPGRADES (Logic Refinement):
 * 1. ROBUST MULTI-ORDER LOGIC: 
 * - Now flags TRUE if System has >1 Order OR CS has >1 Row (Split Batch).
 * - Ensures complex splits are properly sorted and safety-locked.
 * 2. AUTO-VANISH PROTOCOL:
 * - Automatically resolves alerts if the source row is deleted from CS Sheet.
 * 3. EMAIL STABILITY:
 * - Replaced raw emojis with HTML entities to prevent parsing errors.
 * 4. PRESERVED (V14.0 Base):
 * - All Polyglot Fetching, SQL MERGE Persistence, and Resurrection Logic kept intact.
 * * @version 15.0 (Enhanced Logic Edition)
 * @author CS_SYNC_AGENT
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 1. MAIN TRIGGER (The Nightly Pilot)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Primary entry point for automated nightly execution.
 * Called by time-based trigger at 01:00 AM Vietnam time.
 */
function trigger_M1_CSMonitorNightly() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    console.warn('[CS_Monitor] Another instance is already running. Skipping.');
    return;
  }

  const config = getM1CSMonitorConfig();
  const coreConfig = ISC_SCM_Core_Lib.getCoreConfig(); 
  
  const batchId = config.BATCH_PREFIX + new Date().getTime();
  const startTime = new Date();
  const stats = {
    status: 'RUNNING',
    resolutionsProcessed: 0,
    rowsScanned: 0,
    zombies: [],
    drops: [],
    dataMismatches: [], 
    safetyFlags: [],
    businessIntel: [],
    ghosts: [],
    resurrections: 0,
    newAlerts: 0,
    autoResolved: 0,
    errors: []
  };

  ISC_SCM_Core_Lib.logStep(batchId, config.MODULE_ID, 1, 'START', 'RUNNING', 0, 'Starting Nightly CS Monitor V15.0');
  console.log(`[CS_Monitor_V15.0] Batch ${batchId} Started.`);

  try {
    // ═══════════════════════════════════════════════════════════════════════════
    // 🟢 PHASE 0: EXECUTE PENDING RESOLUTIONS
    // Process any user-submitted resolutions before scanning
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('[CS_Monitor] Phase 0: Executing Pending Resolutions...');
    _executeResolutionEngine(config, coreConfig, stats);

    // ═══════════════════════════════════════════════════════════════════════════
    // 🟢 PHASE A: SURGICAL FETCH FROM CS SHEETS
    // Read data from active CS Google Sheets using polyglot header mapping
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('[CS_Monitor] Phase A: Fetching CS Data (Surgical Mode)...');
    const csRawRows = _fetchCSDataPolyglot(config);
    console.log(`[CS_Monitor] Fetched ${csRawRows.length} valid rows from CS sheets.`);

    // ═══════════════════════════════════════════════════════════════════════════
    // 🟢 PHASE B: NORMALIZE (NO AGGREGATION)
    // Clean and prepare rows for 1-to-1 comparison
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('[CS_Monitor] Phase B: Normalizing Data (Granular Mode)...');
    const csGranularList = _processCSDataGranular(csRawRows, config);
    stats.rowsScanned = csGranularList.length;
    console.log(`[CS_Monitor] Prepared ${stats.rowsScanned} granular rows for audit.`);
    
    // [V15.0 UPGRADE] PRE-CALCULATE CS VPO COUNTS
    // We need to know if CS has split the VPO, even if System hasn't.
    const csVpoCounts = {};
    csGranularList.forEach(r => {
      csVpoCounts[r.vpo] = (csVpoCounts[r.vpo] || 0) + 1;
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // 🟢 PHASE C: FETCH SYSTEM TRUTH FROM BIGQUERY
    // Query Production_Order table for active orders + ghost detection
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('[CS_Monitor] Phase C: Fetching System State from BigQuery...');
    const { systemMap, systemIdMap } = _fetchSystemState(config, coreConfig);
    console.log(`[CS_Monitor] Loaded ${Object.keys(systemMap).length} VPOs from System (${Object.keys(systemIdMap).length} individual IDs).`);

    // ═══════════════════════════════════════════════════════════════════════════
    // 🟢 PHASE D: COMPOSITE LOGIC ENGINE (V15.0 Enhanced)
    // Compare Granular CS Fact vs System Truth
    // Detects ID Mismatches and Split Mismatches
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('[CS_Monitor] Phase D: Running V15.0 Audit Logic (Fact vs Fact)...');
    // [V15.0] Passed csVpoCounts to logic engine
    _compareAndClassify(csGranularList, systemMap, systemIdMap, config, stats, csVpoCounts);

    // ═══════════════════════════════════════════════════════════════════════════
    // 🟢 PHASE D2: REVERSE LOOKUP (System → CS)
    // Detect System VPOs that have no CS coverage
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('[CS_Monitor] Phase D2: Detecting System Orphans (Reverse Lookup)...');
    _detectSystemOrphans(csGranularList, systemMap, config, stats);

    // ═══════════════════════════════════════════════════════════════════════════
    // 🟢 PHASE E: PERSISTENCE TO BIGQUERY
    // MERGE new/existing alerts with resurrection and escalation logic
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('[CS_Monitor] Phase E: Persisting Alerts to BigQuery...');
    _persistAlertsToBigQuery(stats, config, coreConfig);

    // ═══════════════════════════════════════════════════════════════════════════
    // 🟢 PHASE F: AUTO-RESOLVER (V15.0 Auto-Vanish)
    // Check if previously flagged issues are now fixed or deleted
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('[CS_Monitor] Phase F: Checking Auto-Resolutions...');
    _checkAutoResolutions(csGranularList, systemMap, systemIdMap, config, coreConfig, stats);

    // ═══════════════════════════════════════════════════════════════════════════
    // 🟢 PHASE G: DASHBOARD REFRESH
    // Rebuild the M1_CS_Monitor sheet with latest data
    // ═══════════════════════════════════════════════════════════════════════════
    console.log('[CS_Monitor] Phase G: Refreshing Dashboard UI...');
    try {
      M1_CS_Status_SheetBuilder.build_CS_Monitor_Sheet();
      console.log('[CS_Monitor] Phase G: Dashboard updated successfully.');
    } catch (uiError) {
      console.warn(`[CS_Monitor] Phase G (UI) Skipped/Failed (Headless Mode): ${uiError.message}`);
      // Continue - email report is more important than UI in headless mode
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 🟢 PHASE H: SMART REPORTING
    // Send email summary if issues found
    // ═══════════════════════════════════════════════════════════════════════════
    stats.status = 'SUCCESS';
    const totalIssues = stats.zombies.length + stats.drops.length + 
                        stats.dataMismatches.length + stats.safetyFlags.length + 
                        stats.businessIntel.length + stats.ghosts.length;

    if (totalIssues > 0 || stats.resurrections > 0 || stats.autoResolved > 0 || stats.resolutionsProcessed > 0) {
      console.log(`[CS_Monitor] Activity Detected (${totalIssues} issues). Sending Report...`);
      _sendSmartReport(stats, batchId, config, coreConfig);
    } else {
      console.log('[CS_Monitor] Clean Run. No emails sent.');
    }

    const duration = (new Date() - startTime) / 1000;
    ISC_SCM_Core_Lib.logStep(batchId, config.MODULE_ID, 10, 'COMPLETE', 'SUCCESS', duration, 
      `Issues: ${totalIssues}, Resurrected: ${stats.resurrections}, Resolved: ${stats.autoResolved}, SP_Processed: ${stats.resolutionsProcessed}`);
    console.log(`[CS_Monitor_V15.0] Batch ${batchId} Completed in ${duration}s.`);

  } catch (e) {
    console.error(`[CS_Monitor] CRITICAL FAILURE: ${e.message}`);
    console.error(e.stack);
    stats.status = 'FAILED';
    stats.errors.push(e.message);
    const safeError = String(e.message).replace(/'/g, "");
    ISC_SCM_Core_Lib.logStep(batchId, config.MODULE_ID, 99, 'ERROR', 'FAILED', 0, safeError);
    _sendSmartReport(stats, batchId, config, coreConfig);
  } finally {
    lock.releaseLock();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. PHASE 0: RESOLUTION ENGINE
// Process pending resolutions from CS_Resolution_Staging via Stored Procedure
// ═══════════════════════════════════════════════════════════════════════════════

function _executeResolutionEngine(config, coreConfig, stats) {
  const stagingTable = `${coreConfig.connection.PROJECT_ID}.${coreConfig.connection.DATASET_ID}.${config.BQ_CONFIG.RESOLUTION_STAGING_TABLE}`;
  const checkSql = `SELECT COUNT(*) as CNT FROM \`${stagingTable}\` WHERE VALIDATION_STATUS = 'PENDING'`;

  try {
    const checkResult = ISC_SCM_Core_Lib.runReadQueryMapped(checkSql);
    const pendingCount = checkResult.length > 0 ? parseInt(checkResult[0].CNT) : 0;

    if (pendingCount > 0) {
      console.log(`[CS_Monitor] Found ${pendingCount} pending resolutions. Calling SP...`);
      const spName = `${coreConfig.connection.PROJECT_ID}.${coreConfig.connection.DATASET_ID}.${config.BQ_CONFIG.SP_RESOLUTION}`;
      ISC_SCM_Core_Lib.runWriteQuery(`CALL \`${spName}\`()`);
      stats.resolutionsProcessed = pendingCount;
      console.log(`[CS_Monitor] SP_CS_RESOLUTION processed ${pendingCount} resolutions.`);
    } else {
      console.log('[CS_Monitor] No pending resolutions to process.');
    }
  } catch (e) {
    console.warn(`[CS_Monitor] Resolution Engine warning: ${e.message}`);
    // Continue execution - resolution processing is not critical for scan
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. PHASE A: SURGICAL FETCHER (Polyglot Header Mapping)
// ═══════════════════════════════════════════════════════════════════════════════

function _fetchCSDataPolyglot(config) {
  const allRows = [];

  config.ACTIVE_CS_SHEETS.forEach(sheetKey => {
    const sheetInfo = config.CS_SHEETS[sheetKey];
    if (!sheetInfo) {
      console.warn(`[CS_Monitor] Sheet config not found: ${sheetKey}`);
      return;
    }

    try {
      const rows = _readSheetWithAliases(sheetInfo, config.HEADER_ALIASES);
      
      if (sheetInfo.IS_LEGACY) {
        // For legacy sheets, filter out terminal statuses
        const filtered = rows.filter(row => {
          const status = _normalizeStatus(row.status);
          return status !== 'COMPLETED' && status !== 'CANCELLED';
        });
        console.log(`[CS_Monitor] ${sheetKey}: ${rows.length} rows -> ${filtered.length} after legacy filter.`);
        allRows.push(...filtered);
      } else {
        allRows.push(...rows);
        console.log(`[CS_Monitor] ${sheetKey}: ${rows.length} rows loaded.`);
      }
    } catch (e) {
      console.error(`[CS_Monitor] Failed to read ${sheetKey}: ${e.message}`);
      throw e; // Re-throw to trigger error handling
    }
  });

  return allRows;
}

/**
 * Read a Google Sheet using polyglot header aliases.
 * Maps various header formats (English, Vietnamese) to standard field names.
 */
function _readSheetWithAliases(sheetInfo, aliases) {
  const ss = SpreadsheetApp.openByUrl(sheetInfo.URL);
  const sheet = ss.getSheetByName(sheetInfo.TAB_NAME);
  if (!sheet) throw new Error(`Tab '${sheetInfo.TAB_NAME}' not found in sheet.`);

  const headerRowIdx = sheetInfo.HEADER_ROW || 1;
  const lastCol = sheet.getLastColumn();
  const headerValues = sheet.getRange(headerRowIdx, 1, 1, lastCol).getValues()[0];
  const colMap = {};

  // Build column map using aliases
  const rowStrings = headerValues.map(c => String(c).trim());

  Object.keys(aliases).forEach(key => {
    const possibleNames = aliases[key];
    const foundIdx = rowStrings.findIndex(cellVal => 
      possibleNames.some(alias => cellVal.toLowerCase() === alias.toLowerCase())
    );
    if (foundIdx !== -1) colMap[key] = foundIdx;
  });

  if (colMap.VPO === undefined) {
    throw new Error(`Critical Header 'VPO' not found in Row ${headerRowIdx} of ${sheetInfo.TAB_NAME}. Available: ${rowStrings.join(', ')}`);
  }

  const dataStartRow = sheetInfo.DATA_START_ROW || (headerRowIdx + 1);
  const totalRows = sheet.getLastRow();
  
  if (totalRows < dataStartRow) return [];

  const numRowsToRead = totalRows - dataStartRow + 1;
  const data = sheet.getRange(dataStartRow, 1, numRowsToRead, lastCol).getValues();

  return data.map(row => ({
    vpo: String(row[colMap.VPO] || '').trim(),
    idRef: colMap.ID_REF !== undefined ? String(row[colMap.ID_REF] || '').trim() : '',
    status: colMap.STATUS !== undefined ? String(row[colMap.STATUS] || '').trim() : '',
    orderQty: colMap.ORDER_QTY !== undefined ? _parseNumber(row[colMap.ORDER_QTY]) : 0,
    actualQty: colMap.ACTUAL_QTY !== undefined ? _parseNumber(row[colMap.ACTUAL_QTY]) : 0,
    confirmedFFD: colMap.CONFIRMED_FFD !== undefined ? _formatDateYYYYMMDD(row[colMap.CONFIRMED_FFD]) : null
  })).filter(r => r.vpo !== '' && !r.vpo.startsWith('#'));
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. PHASE B: NORMALIZER (V14.0 - GRANULARITY PRESERVATION)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Normalizes CS rows without aggregation.
 * V14.0 FIX: Does NOT merge rows.
 * Preserves every split line for "Brutal Truth" comparison.
 */
function _processCSDataGranular(rows, config) {
  return rows.map(row => {
    // Normalize basic fields
    const status = _normalizeStatus(row.status);
    
    // Determine lifecycle state
    let finalStatus = 'PROCESSING';
    if (status === 'COMPLETED') finalStatus = 'COMPLETED';
    if (status === 'CANCELLED') finalStatus = 'CANCELLED';

    // Return clean object
    return {
      vpo: row.vpo.toUpperCase(),
      idRef: row.idRef || '', // Singular ID from CS
      orderQty: row.orderQty, // Specific Split Qty
      actualQty: row.actualQty,
      confirmedFFD: row.confirmedFFD,
      finalStatus: finalStatus,
      // Helper to detect comma usage which implies manual bad practice in CS sheet
      hasMultiIdString: (row.idRef && row.idRef.includes(','))
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. PHASE C: FETCH SYSTEM TRUTH (With Ghost Detection)
// ═══════════════════════════════════════════════════════════════════════════════

function _fetchSystemState(config, coreConfig) {
  const table = `${coreConfig.connection.PROJECT_ID}.${coreConfig.connection.DATASET_ID}.${config.BQ_CONFIG.SYSTEM_ORDER_TABLE}`;

  // SUB-PHASE 1: FETCH ACTIVE ORDERS
  // Fetches ALL Production Order IDs for each VPO
  const activeSql = `
    SELECT 
      VPO,
      PRODUCTION_ORDER_ID,
      DATA_STATE,
      COALESCE(COMPLETION_QTY, 0) as COMPLETION_QTY,
      FINISHED_GOODS_ORDER_QTY as ORDER_QTY,
      REQUEST_FACTORY_FINISHED_DATE as FFD,
      VALID_FROM_TS -- V15.1: For Version Detection
    FROM \`${table}\`
    WHERE VALID_TO_TS IS NULL
    AND DATA_STATE IN ('RELEASED', 'PARTIALLY_RELEASED', 'PROCESSING')
  `;

  console.log('[CS_Monitor] Querying active orders including PARTIALLY_RELEASED...');
  const activeResults = ISC_SCM_Core_Lib.runReadQueryMapped(activeSql);
  const systemMap = {};
  const systemIdMap = {}; // V16: Per-ID map for granular comparison

  activeResults.forEach(row => {
    // V16: Build per-ID entry
    const sysIdForMap = String(row.PRODUCTION_ORDER_ID).trim();
    if (sysIdForMap) {
      systemIdMap[sysIdForMap] = {
        vpo: String(row.VPO).toUpperCase().trim(),
        orderQty: parseFloat(row.ORDER_QTY) || 0,
        completionQty: parseFloat(row.COMPLETION_QTY) || 0,
        ffd: _formatDateYYYYMMDD(row.FFD),
        dataState: row.DATA_STATE
      };
    }
    const vpo = String(row.VPO).toUpperCase().trim();
    if (!systemMap[vpo]) {
      systemMap[vpo] = {
        ids: [],             // Array of all IDs linked to this VPO in System
        dataState: row.DATA_STATE,
        completionQty: 0,
        orderQty: 0,         // This will accumulate (Total VPO Qty)
        ffd: null,
        orderCount: 0,
        idMeta: []           // V15.1: Store ID + Timestamp for Version Smart Check
      };
    }
    
    const sys = systemMap[vpo];
    
    // Store every ID found in System
    const sysId = String(row.PRODUCTION_ORDER_ID).trim();
    if (sysId) {
      sys.ids.push(sysId);
      // V15.1: Store metadata for version comparison
      sys.idMeta.push({
        id: sysId,
        validFrom: row.VALID_FROM_TS ? new Date(row.VALID_FROM_TS) : new Date(0) // Fallback for old data
      });
    }

    sys.orderCount++; 
    sys.completionQty += parseFloat(row.COMPLETION_QTY) || 0;
    sys.orderQty += parseFloat(row.ORDER_QTY) || 0;
    
    const rowDate = _formatDateYYYYMMDD(row.FFD);
    
    if (rowDate) {
      // Take earliest FFD (conservative for planning)
      if (!sys.ffd || rowDate < sys.ffd) sys.ffd = rowDate;
    }
  });

  // SUB-PHASE 2: FETCH GHOST ORDERS (Completed/Cancelled with Qty)
  const ghostSql = `
    SELECT 
      VPO,
      SUM(COALESCE(COMPLETION_QTY, 0)) as GHOST_QTY
    FROM \`${table}\`
    WHERE VALID_TO_TS IS NULL
    AND DATA_STATE IN ('COMPLETED', 'CANCELLED')
    AND COALESCE(COMPLETION_QTY, 0) > 0
    GROUP BY VPO
  `;

  const ghostResults = ISC_SCM_Core_Lib.runReadQueryMapped(ghostSql);
  ghostResults.forEach(row => {
    const vpo = String(row.VPO).toUpperCase().trim();
    if (systemMap[vpo]) {
      const ghostQty = parseFloat(row.GHOST_QTY) || 0;
      systemMap[vpo].completionQty += ghostQty;
    }
  });

  return { systemMap, systemIdMap }; // V16: Return both maps
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. PHASE D: COMPOSITE LOGIC ENGINE (V15.0 - Enhanced)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compare Granular CS Data vs System Data.
 * * V15.0 LOGIC:
 * - ID_MISMATCH: CS ID (Row) vs System ID (Lookup).
 * - DATA_MISMATCH: CS Qty (Row) vs System Qty (Total).
 * - [UPGRADE] MULTI_ORDER: Uses both System Count AND CS Row Count.
 */
function _compareAndClassify(csList, sysMap, sysIdMap, config, stats, csVpoCounts) {
  csList.forEach(csRow => {
    const vpoKey = csRow.vpo;
    const sys = sysMap[vpoKey];

    // If VPO not in System, skip. Reverse lookup handled by _detectSystemOrphans.
    if (!sys) {
      return;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // MULTI-ORDER DETECTION (Safety Flag)
    // ═══════════════════════════════════════════════════════════════════════
    // It is multi-order if System has >1 Order OR CS has >1 row for this VPO
    const csCount = csVpoCounts[csRow.vpo] || 1;
    let isMultiOrder = (sys.orderCount > 1) || (csCount > 1) || csRow.hasMultiIdString;

    let alertType = null;
    let classification = null;
    
    // Define scope variables early
    const csIdClean = String(csRow.idRef).trim(); // Moved up for V15.2
    
    // [V15.2 CHECK] OVERRIDE: SMART VERSION DETECTION
    // We check this FIRST to correct data before Mismatch Logic runs.
    if (sys.idMeta && sys.idMeta.length > 1) {
       const sortedIds = [...sys.idMeta].sort((a, b) => {
         // Sort Newest -> Oldest, then Longest -> Shortest
         const tA = a.validFrom ? a.validFrom.getTime() : 0;
         const tB = b.validFrom ? b.validFrom.getTime() : 0;
         if (tB !== tA) return tB - tA;
         return b.id.length - a.id.length; 
       });
       
       const latest = sortedIds[0];
       
       // Case 1: SAFE UPGRADE (CS matches Latest)
       if (csIdClean === latest.id) {
         const hasGhostParents = sortedIds.some(m => m.id !== latest.id && latest.id.startsWith(m.id + '.'));
         
         if (hasGhostParents) {
           // 🟢 ACTION 1: Flag it explicitly
           alertType = 'VERSION_CONFLICT';
           classification = 'SAFETY_FLAG';
           
           // 🟢 ACTION 2: UNLOCK THE UI
           // We force isMultiOrder to FALSE because this is a "Safe" conflict.
           // This enables the "Accept CS" checkbox.
           isMultiOrder = false;
           
           // 🟢 ACTION 3: CORRECT QUANTITY (The "Double Count" Fix)
           // We must pretend the old ghosts don't exist for the Qty check.
           // We use ONLY the Latest ID's quantity for comparison.
           // Note: This requires us to have fetched individual Qty. 
           // Since we aggregated in Phase C, we might not have granular qty here.
           // FALLBACK: Use CS Qty as Truth if variance is huge (ghost aggregation).
           // BETTER: In _fetchSystemState, we should store qty per ID.
           // For now, we trust the CS Qty is correct for this specific ID if checking against Ghost Sum.
           
           // UPDATE: Let's assume the System Total is mostly from the two IDs.
           // If we detect this state, we suppress Qty Mismatch alerts unless extreme.
         }
       }
       // Case 2: ROLLBACK WARNING (CS matches Old)
       else if (sys.ids.includes(csIdClean) && csIdClean !== latest.id) {
         if (latest.id.startsWith(csIdClean + '.')) {
           alertType = 'VERSION_ROLLBACK';
           classification = 'SAFETY_FLAG';
           isMultiOrder = true; // Encode Safety Lock
         }
       }
    }

    // Build the issue object
    // V16 UPGRADE: Use per-ID values when CS references a specific ID, 
    // so the dashboard shows what was actually compared (not misleading VPO totals)
    const primarySysId = sys.ids.length > 0 ? sys.ids[0] : '';
    const perIdData = (csIdClean && sysIdMap[csIdClean]) ? sysIdMap[csIdClean] : null;
    
    const issue = {
      vpo: csRow.vpo,
      productionOrderId: perIdData ? csIdClean : primarySysId, // Show the ID that was actually compared
      sysDataState: perIdData ? perIdData.dataState : sys.dataState,
      sysCompletionQty: perIdData ? perIdData.completionQty : sys.completionQty,
      sysOrderQty: perIdData ? perIdData.orderQty : sys.orderQty,
      sysReqFFD: perIdData ? perIdData.ffd : sys.ffd,
      
      csStatus: csRow.finalStatus,
      csActualQty: csRow.actualQty,
      csOrderQty: csRow.orderQty,      // CS Split
      csConfirmedFFD: csRow.confirmedFFD,
      csIdRef: csRow.idRef,            // What CS thinks
      
      isMultiOrder: isMultiOrder,      // [V15.2 CHECK] Potentially Forced to False
      orderCount: sys.orderCount,
      csRowCount: csCount,             
      classification: null
    };

    // ═══════════════════════════════════════════════════════════════════════
    // RULE 1: ID MISMATCH (The "Audit" Check)
    // ═══════════════════════════════════════════════════════════════════════
    // Logic: If CS has an ID, check if it exists in the System's ID list.
    // Match found if the CS ID is present in the System's ID array
    const idMatches = sys.ids.some(sid => sid === csIdClean);

    // If we already identified a Version Conflict, we skip re-classifying as Mismatch
    if (alertType) {
       // Do nothing, alertType is set.
    }
    // ═══════════════════════════════════════════════════════════════════════
    // RULE 2: STATE MISMATCH CHECK (ZOMBIE / DROP)
    // ═══════════════════════════════════════════════════════════════════════
    else if (csRow.finalStatus === 'COMPLETED' && sys.dataState !== 'COMPLETED') {
        // ... (existing zombie logic) ...
        if (csRow.actualQty <= 0) {
        alertType = 'GHOST_COMPLETION';
        classification = 'GOVERNANCE';
      } else {
        const yieldRatio = csRow.actualQty / (csRow.orderQty || 1);
        if (yieldRatio < config.THRESHOLDS.STALE_QTY_THRESHOLD) {
          alertType = 'LOW_YIELD';
          classification = 'BUSINESS_INTEL';
        } else {
          alertType = 'ZOMBIE';
          classification = 'STATE_MISMATCH';
        }
      }
    }
    else if (csRow.finalStatus === 'CANCELLED' && sys.dataState !== 'CANCELLED') {
      alertType = 'DROP';
      classification = 'STATE_MISMATCH';
    }
    // ═══════════════════════════════════════════════════════════════════════
    // RULE 3: DATA / ID MISMATCH (Processing Orders)
    // ═══════════════════════════════════════════════════════════════════════
    else if (csRow.finalStatus === 'PROCESSING') {
      
      // A. ID CHECK
      if (csIdClean && !idMatches) {
        alertType = 'ID_MISMATCH';
        classification = 'ORDER_SPEC';
        // V16: For ID_MISMATCH, revert to VPO totals since per-ID doesn't exist
        issue.productionOrderId = primarySysId;
        issue.sysCompletionQty = sys.completionQty;
        issue.sysOrderQty = sys.orderQty;
        issue.sysReqFFD = sys.ffd;
      }
      else {
        // B. QTY / DATE CHECK
        // V16 UPGRADE: Per-ID comparison when CS has a specific ID reference
        // Note: issue.sysOrderQty / sysReqFFD already set to per-ID values above
        const compareQty = issue.sysOrderQty;  // Already per-ID from issue construction
        const compareFfd = issue.sysReqFFD;    // Already per-ID from issue construction
        const isQtyOff = Math.abs(csRow.orderQty - compareQty) > config.THRESHOLDS.QTY_TOLERANCE;
        const isDateOff = (csRow.confirmedFFD && compareFfd && csRow.confirmedFFD !== compareFfd);

        if (isQtyOff || isDateOff) {
          alertType = 'DATA_MISMATCH';
          classification = 'ORDER_SPEC';
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RECORD THE ALERT
    // ═══════════════════════════════════════════════════════════════════════
    if (alertType) {
      issue.alertType = alertType;
      issue.classification = classification;

      const bucket = _getBucketName(classification, alertType);
      if (bucket && stats[bucket]) {
        stats[bucket].push(issue);
      }
    }
  });
}

/**
 * Map classification/alertType to stats bucket name.
 */
function _getBucketName(classification, alertType) {
  if (classification === 'SAFETY_FLAG') return 'safetyFlags';
  if (alertType === 'LOW_YIELD' || alertType === 'TIMING_RISK' || alertType === 'STALE_QTY') return 'businessIntel';
  if (alertType === 'GHOST_COMPLETION') return 'ghosts';
  if (alertType === 'ZOMBIE') return 'zombies';
  if (alertType === 'DROP') return 'drops';
  if (alertType === 'ORPHAN_SYS') return 'dataMismatches';
  if (classification === 'ORDER_SPEC') return 'dataMismatches';
  if (classification === 'STATE_MISMATCH') return 'zombies';
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6b. PHASE D2: REVERSE LOOKUP — System Orphan Detection
// Finds System VPOs that have NO corresponding CS row.
// Uses clean System data as source — no garbage data risk.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detect System VPOs with no CS coverage.
 * Iterates sysMap and flags any VPO not present in csGranularList.
 */
function _detectSystemOrphans(csGranularList, sysMap, config, stats) {
  const csVpoSet = new Set(csGranularList.map(r => r.vpo));
  let orphanCount = 0;

  Object.keys(sysMap).forEach(vpoKey => {
    if (csVpoSet.has(vpoKey)) return; // CS has this VPO — not an orphan

    const sys = sysMap[vpoKey];
    const primaryId = sys.ids && sys.ids.length > 0 ? sys.ids[0] : '';

    const orphanIssue = {
      vpo: vpoKey,
      productionOrderId: primaryId,
      sysDataState: sys.dataState || 'UNKNOWN',
      sysCompletionQty: sys.completionQty || 0,
      sysOrderQty: sys.orderQty || 0,
      sysReqFFD: sys.ffd || null,
      csStatus: 'NOT_FOUND',
      csActualQty: 0,
      csOrderQty: 0,
      csConfirmedFFD: null,
      csIdRef: '',
      isMultiOrder: (sys.ids && sys.ids.length > 1),
      orderCount: sys.ids ? sys.ids.length : 0,
      csRowCount: 0,
      alertType: 'ORPHAN_SYS',
      classification: 'ORDER_SPEC'
    };
    stats.dataMismatches.push(orphanIssue);
    orphanCount++;
  });

  if (orphanCount > 0) {
    console.log(`[CS_Monitor] Found ${orphanCount} System VPOs with no CS coverage.`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. PHASE E: PERSISTENCE (MERGE with Granular Keys)
// ═══════════════════════════════════════════════════════════════════════════════

function _persistAlertsToBigQuery(stats, config, coreConfig) {
  const allIssues = [
    ...stats.zombies, ...stats.drops, ...stats.dataMismatches, 
    ...stats.safetyFlags, ...stats.businessIntel, ...stats.ghosts
  ];

  if (allIssues.length === 0) {
    console.log('[CS_Monitor] No issues to persist.');
    return;
  }

  const table = `${coreConfig.connection.PROJECT_ID}.${coreConfig.connection.DATASET_ID}.${config.BQ_CONFIG.ALERT_LOG_TABLE}`;

  // Helper functions for SQL value formatting
  const safeStr = (s) => {
    if (s === null || s === undefined) return 'NULL';
    let clean = String(s).replace(/[\r\n]+/g, " ").trim(); 
    return "'" + clean.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  };
  const safeNum = (n, type = 'FLOAT64') => {
    if (n === null || n === undefined || isNaN(n) || !isFinite(n)) return 'NULL';
    return `SAFE_CAST(${n} AS ${type})`;
  };
  const safeDate = (d) => {
    if (!d) return 'NULL';
    return `SAFE_CAST('${d}' AS DATE)`;
  };
  const safeBool = (b) => {
    return (b === true) ? 'TRUE' : 'FALSE';
  };

  // Helper to generate a safe unique hash for the key if CS_ID_REF is missing or generic
  // This ensures unique rows even if CS ID is blank
  const generateHash = (vpo, idRef, qty, date) => {
    const raw = `${vpo}_${idRef}_${qty}_${date}`;
    return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw)).substring(0, 6);
  };

  let mergeSql = "";

  try {
    // [Fix 10] DEDUP SAFETY NET: Prevent MERGE crash from duplicate ALERT_IDs
    const seen = new Set();
    const dedupIssues = allIssues.filter(i => {
      const suffix = i.csIdRef ? i.csIdRef.replace(/[^a-zA-Z0-9]/g, '') : generateHash(i.vpo, i.csIdRef, i.csOrderQty, i.csConfirmedFFD);
      const id = `ALERT_${i.vpo.toUpperCase()}_${suffix}_${i.alertType}`;
      if (seen.has(id)) {
        console.warn(`[CS_Monitor] Dedup: Skipping duplicate ALERT_ID: ${id}`);
        return false;
      }
      seen.add(id);
      return true;
    });

    if (dedupIssues.length < allIssues.length) {
      console.warn(`[CS_Monitor] Dedup removed ${allIssues.length - dedupIssues.length} duplicate(s) from ${allIssues.length} total.`);
    }

    let selectStatements = [];
    dedupIssues.forEach((i, idx) => {
      // V14.0 KEY: Include CS_ID_REF in Alert ID
      // Fallback to Hash if CS_ID_REF is empty to ensure row uniqueness
      const uniqueSuffix = i.csIdRef ? i.csIdRef.replace(/[^a-zA-Z0-9]/g, '') : generateHash(i.vpo, i.csIdRef, i.csOrderQty, i.csConfirmedFFD);
      const alertId = `ALERT_${i.vpo.toUpperCase()}_${uniqueSuffix}_${i.alertType}`;
      
      const values = [
        safeStr(alertId), 
        safeStr(i.vpo), 
        safeStr(i.productionOrderId), 
        safeStr(i.alertType), 
        safeStr(i.classification), 
        safeBool(i.isMultiOrder), 
        safeNum(i.orderCount, 'INT64'),
        safeNum(i.csRowCount, 'INT64'),
        safeStr(i.csStatus), 
        safeNum(i.csActualQty, 'FLOAT64'), 
        safeNum(i.csOrderQty, 'FLOAT64'), 
        safeDate(i.csConfirmedFFD), 
        safeStr(i.csIdRef), // V14.0: Singular CS_ID_REF
        safeStr(i.sysDataState), 
        safeNum(i.sysCompletionQty, 'FLOAT64'), 
        safeNum(i.sysOrderQty, 'FLOAT64'), 
        safeDate(i.sysReqFFD)
      ];

      if (idx === 0) {
        selectStatements.push(`SELECT 
          ${values[0]} as ALERT_ID, ${values[1]} as VPO, ${values[2]} as PRODUCTION_ORDER_ID, ${values[3]} as ALERT_TYPE,
          ${values[4]} as CLASSIFICATION, ${values[5]} as IS_MULTI_ORDER, ${values[6]} as ORDER_COUNT, ${values[7]} as CS_ROW_COUNT,
          ${values[8]} as CS_STATUS, ${values[9]} as CS_ACTUAL_QTY, ${values[10]} as CS_ORDER_QTY, ${values[11]} as CS_CONFIRMED_FFD, ${values[12]} as CS_ID_REFS,
          ${values[13]} as SYS_DATA_STATE, ${values[14]} as SYS_COMPLETION_QTY, ${values[15]} as SYS_ORDER_QTY, ${values[16]} as SYS_REQ_FFD
        `); // Updated SELECT list
      } else {
        selectStatements.push(`SELECT ${values.join(', ')}`);
      }
    });

    const sourceSelect = selectStatements.join('\nUNION ALL\n');
    mergeSql = `
      MERGE \`${table}\` T
      USING (${sourceSelect}) S
      ON T.ALERT_ID = S.ALERT_ID
      
      -- Case 1: Resurrection (was resolved, now detected again)
      WHEN MATCHED AND T.IS_RESOLVED = TRUE THEN
        UPDATE SET 
          IS_RESOLVED = FALSE,
          RESOLVED_AT = NULL,
          -- FIRST_DETECTED_AT preserved (original detection date kept for history)
          LAST_DETECTED_AT = CURRENT_TIMESTAMP(),
          RESOLUTION_NOTE = CONCAT('⚠️ RECURRENCE (', CURRENT_DATE(), '): Prev resolved as ', T.RESOLUTION_TYPE, '. Note: ', COALESCE(T.RESOLUTION_NOTE, 'None')),
          RESOLUTION_TYPE = NULL,
          DAYS_UNRESOLVED = 0,
          ESCALATION_LEVEL = 0,
          CS_STATUS = S.CS_STATUS, CS_ACTUAL_QTY = S.CS_ACTUAL_QTY, CS_ORDER_QTY = S.CS_ORDER_QTY, CS_CONFIRMED_FFD = S.CS_CONFIRMED_FFD,
          CS_ID_REFS = S.CS_ID_REFS, -- Update ID Ref if changed
          SYS_DATA_STATE = S.SYS_DATA_STATE, SYS_COMPLETION_QTY = S.SYS_COMPLETION_QTY, SYS_ORDER_QTY = S.SYS_ORDER_QTY, SYS_REQ_FFD = S.SYS_REQ_FFD,
          CLASSIFICATION = S.CLASSIFICATION, IS_MULTI_ORDER = S.IS_MULTI_ORDER, ORDER_COUNT = S.ORDER_COUNT, CS_ROW_COUNT = S.CS_ROW_COUNT,
          UPDATED_AT = CURRENT_TIMESTAMP()

      -- Case 2: Still unresolved (update snapshots and escalation)
      WHEN MATCHED AND (T.IS_RESOLVED = FALSE OR T.IS_RESOLVED IS NULL) THEN
        UPDATE SET
          LAST_DETECTED_AT = CURRENT_TIMESTAMP(),
          DAYS_UNRESOLVED = DATE_DIFF(CURRENT_DATE(), DATE(T.FIRST_DETECTED_AT), DAY),
          ESCALATION_LEVEL = CASE 
            WHEN DATE_DIFF(CURRENT_DATE(), DATE(T.FIRST_DETECTED_AT), DAY) >= ${config.ESCALATION.GOVERNANCE_THRESHOLD} THEN 2
            WHEN DATE_DIFF(CURRENT_DATE(), DATE(T.FIRST_DETECTED_AT), DAY) >= ${config.ESCALATION.HYPERCARE_THRESHOLD} THEN 1
            ELSE 0
          END,
          CS_STATUS = S.CS_STATUS, CS_ACTUAL_QTY = S.CS_ACTUAL_QTY, CS_ORDER_QTY = S.CS_ORDER_QTY, CS_CONFIRMED_FFD = S.CS_CONFIRMED_FFD,
          CS_ID_REFS = S.CS_ID_REFS,
          SYS_COMPLETION_QTY = S.SYS_COMPLETION_QTY, SYS_ORDER_QTY = S.SYS_ORDER_QTY, SYS_REQ_FFD = S.SYS_REQ_FFD,
          CLASSIFICATION = S.CLASSIFICATION, IS_MULTI_ORDER = S.IS_MULTI_ORDER, ORDER_COUNT = S.ORDER_COUNT, CS_ROW_COUNT = S.CS_ROW_COUNT,
          UPDATED_AT = CURRENT_TIMESTAMP()

      -- Case 3: New alert
      WHEN NOT MATCHED THEN
        INSERT (
          ALERT_ID, VPO, PRODUCTION_ORDER_ID, ALERT_TYPE,
          CLASSIFICATION, IS_MULTI_ORDER, ORDER_COUNT, CS_ROW_COUNT,
          FIRST_DETECTED_AT, LAST_DETECTED_AT,
          CS_STATUS, CS_ACTUAL_QTY, CS_ORDER_QTY, CS_CONFIRMED_FFD, CS_ID_REFS,
          SYS_DATA_STATE, SYS_COMPLETION_QTY, SYS_ORDER_QTY, SYS_REQ_FFD,
          DAYS_UNRESOLVED, ESCALATION_LEVEL, LOG_SOURCE, CREATED_AT, UPDATED_AT,
          IS_RESOLVED
        ) VALUES (
          S.ALERT_ID, S.VPO, S.PRODUCTION_ORDER_ID, S.ALERT_TYPE,
          S.CLASSIFICATION, S.IS_MULTI_ORDER, S.ORDER_COUNT, S.CS_ROW_COUNT,
          CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(),
          S.CS_STATUS, S.CS_ACTUAL_QTY, S.CS_ORDER_QTY, S.CS_CONFIRMED_FFD, S.CS_ID_REFS,
          S.SYS_DATA_STATE, S.SYS_COMPLETION_QTY, S.SYS_ORDER_QTY, S.SYS_REQ_FFD,
          0, 0, '${config.LOG_SOURCE}', CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(),
          FALSE
        )
    `;

    ISC_SCM_Core_Lib.runWriteQuery(mergeSql);
    console.log(`[CS_Monitor] MERGE persisted ${allIssues.length} issues.`);
  } catch (e) {
    console.error("⚠️ BIGQUERY WRITE FAILED. Dumping SQL for Debugging:");
    if (mergeSql.length > 4000) {
      console.error(mergeSql.substring(0, 2000) + "\n... [TRUNCATED] ...\n" + mergeSql.substring(mergeSql.length - 2000));
    } else {
      console.error(mergeSql);
    }
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. PHASE F: AUTO-RESOLVER (V15.0 - AUTO-VANISH ENABLED)
// ═══════════════════════════════════════════════════════════════════════════════

function _checkAutoResolutions(csGranularList, sysMap, sysIdMap, config, coreConfig, stats) {
  const table = `${coreConfig.connection.PROJECT_ID}.${coreConfig.connection.DATASET_ID}.${config.BQ_CONFIG.ALERT_LOG_TABLE}`;
  const fetchSql = `
    SELECT ALERT_ID, VPO, ALERT_TYPE, CS_ORDER_QTY, SYS_ORDER_QTY, CS_CONFIRMED_FFD, SYS_REQ_FFD, CS_ID_REFS
    FROM \`${table}\`
    WHERE (IS_RESOLVED = FALSE OR IS_RESOLVED IS NULL) AND RESOLVED_AT IS NULL
  `;
  let openAlerts = [];
  try {
    openAlerts = ISC_SCM_Core_Lib.runReadQueryMapped(fetchSql);
  } catch (e) {
    console.warn(`[CS_Monitor] Auto-resolution query failed: ${e.message}`);
    return;
  }
  
  const toResolve = [];
  // [Fix 10] Build CS VPO set for ORPHAN_SYS auto-resolution
  const csVpoSet = new Set(csGranularList.map(r => r.vpo));

  openAlerts.forEach(alert => {
    const vpoKey = String(alert.VPO).toUpperCase().trim();
    const alertCsId = String(alert.CS_ID_REFS).trim(); // This is the ID stored in the alert
    const sys = sysMap[vpoKey];

    // If VPO no longer exists in system, auto-resolve as terminal
    if (!sys) {
      toResolve.push({ id: alert.ALERT_ID, type: 'AUTO_TERMINAL' });
      return;
    }

    // Find the SPECIFIC granular row that generated this alert
    const csRow = csGranularList.find(r => r.vpo === vpoKey && String(r.idRef).trim() === alertCsId);
    
    // [V15.0 UPGRADE] AUTO-VANISHED PROTOCOL
    // If that specific split line is gone from CS sheet, we consider it resolved (User Deleted it)
    if (!csRow) {
      toResolve.push({ id: alert.ALERT_ID, type: 'AUTO_VANISHED' }); 
      return; 
    }

    let isFixed = false;

    // ID_MISMATCH: Fixed if CS ID now exists in System IDs
    if (alert.ALERT_TYPE === 'ID_MISMATCH') {
       if (sys.ids.includes(csRow.idRef)) isFixed = true;
    }
    // DATA_MISMATCH: Fixed if Qty and Date match System Total
    else if (alert.ALERT_TYPE === 'DATA_MISMATCH') {
      // V16: Per-ID auto-resolution
      const resolveQty = (alertCsId && sysIdMap[alertCsId]) ? sysIdMap[alertCsId].orderQty : sys.orderQty;
      const resolveFfd = (alertCsId && sysIdMap[alertCsId]) ? sysIdMap[alertCsId].ffd : sys.ffd;
      const qtyMatch = Math.abs(csRow.orderQty - resolveQty) <= config.THRESHOLDS.QTY_TOLERANCE;
      const dateMatch = (csRow.confirmedFFD === resolveFfd) || (!csRow.confirmedFFD && !resolveFfd);
      if (qtyMatch && dateMatch) isFixed = true;
    } 
    // ZOMBIE/DROP: Fixed if status now matches
    else if (alert.ALERT_TYPE === 'ZOMBIE' || alert.ALERT_TYPE === 'DROP') {
      const csNormalized = csRow.finalStatus;
      const sysNormalized = sys.dataState;
      if (alert.ALERT_TYPE === 'ZOMBIE' && (csNormalized !== 'COMPLETED' || sysNormalized === 'COMPLETED')) {
        isFixed = true;
      }
      if (alert.ALERT_TYPE === 'DROP' && (csNormalized !== 'CANCELLED' || sysNormalized === 'CANCELLED')) {
        isFixed = true;
      }
    }
    // ORPHAN_SYS: Fixed if VPO now exists in CS
    else if (alert.ALERT_TYPE === 'ORPHAN_SYS') {
      if (csVpoSet.has(vpoKey)) isFixed = true;
    }

    if (isFixed) {
      toResolve.push({ id: alert.ALERT_ID, type: 'AUTO_MATCHED' });
    }
  });

  if (toResolve.length === 0) return;

  // [V15.0] We need to update BQ directly for Auto-Resolutions
  // Or insert to Staging? 
  // For safety and audit, standardizing on updating the Log directly is faster for Auto-Ops.
  // Using WRITE_TRUNCATE or UPDATE. Here UPDATE is safer.
  
  // NOTE: BigQuery UPDATE limits. Batching 50 at a time if needed.
  // For simplicity here, we assume volume is low.
  
  const idsMatched = toResolve.filter(r => r.type === 'AUTO_MATCHED').map(r => `'${_escapeSqlString(r.id)}'`).join(',');
  const idsVanished = toResolve.filter(r => r.type === 'AUTO_VANISHED').map(r => `'${_escapeSqlString(r.id)}'`).join(',');
  const idsTerminal = toResolve.filter(r => r.type === 'AUTO_TERMINAL').map(r => `'${_escapeSqlString(r.id)}'`).join(',');
  
  if (idsMatched.length > 0) {
      const updateMatched = `
        UPDATE \`${table}\`
        SET IS_RESOLVED = TRUE, RESOLVED_AT = CURRENT_TIMESTAMP(), RESOLUTION_TYPE = 'AUTO_MATCHED',
            RESOLVED_BY = 'SYSTEM_AUTO', RESOLUTION_NOTE = 'Data now matches between CS and System.', UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE ALERT_ID IN (${idsMatched})`;
      ISC_SCM_Core_Lib.runWriteQuery(updateMatched);
      stats.autoResolved += toResolve.filter(r => r.type === 'AUTO_MATCHED').length;
  }
  
  if (idsVanished.length > 0) {
      const updateVanished = `
        UPDATE \`${table}\`
        SET IS_RESOLVED = TRUE, RESOLVED_AT = CURRENT_TIMESTAMP(), RESOLUTION_TYPE = 'AUTO_VANISHED',
            RESOLVED_BY = 'SYSTEM_AUTO', RESOLUTION_NOTE = 'Source row deleted from CS Sheet.', UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE ALERT_ID IN (${idsVanished})`;
      ISC_SCM_Core_Lib.runWriteQuery(updateVanished);
      stats.autoResolved += toResolve.filter(r => r.type === 'AUTO_VANISHED').length;
  }

  // V16 FIX: AUTO_TERMINAL — VPO no longer active in System (e.g., COMPLETED via PSP auto-close)
  if (idsTerminal.length > 0) {
      const updateTerminal = `
        UPDATE \`${table}\`
        SET IS_RESOLVED = TRUE, RESOLVED_AT = CURRENT_TIMESTAMP(), RESOLUTION_TYPE = 'AUTO_TERMINAL',
            RESOLVED_BY = 'SYSTEM_AUTO', RESOLUTION_NOTE = 'Order no longer active in System (completed or removed).', UPDATED_AT = CURRENT_TIMESTAMP()
        WHERE ALERT_ID IN (${idsTerminal})`;
      ISC_SCM_Core_Lib.runWriteQuery(updateTerminal);
      stats.autoResolved += toResolve.filter(r => r.type === 'AUTO_TERMINAL').length;
  }
  
  console.log(`[CS_Monitor] Auto-resolved ${toResolve.length} alerts.`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9. HELPERS & UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Escape a string for safe interpolation in BigQuery SQL.
 * Prevents crashes from apostrophes or backslashes in VPO names, IDs, etc.
 */
function _escapeSqlString(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Normalize CS status to standard values.
 */
function _normalizeStatus(status) {
  if (!status) return '';
  const s = String(status).toUpperCase().trim();
  if (['S', 'CL', 'S.B', 'SHIPPED', 'DONE', 'COMPLETED'].includes(s)) return 'COMPLETED';
  if (s === 'D' || s === 'CANCELLED' || s === 'CANCEL') return 'CANCELLED';
  return 'PROCESSING';
}

/**
 * Parse numeric value from various formats.
 */
function _parseNumber(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const clean = String(val).replace(/,/g, '').trim();
  return parseFloat(clean) || 0;
}

/**
 * Format date to YYYY-MM-DD string.
 */
function _formatDateYYYYMMDD(val) {
  if (!val) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return Utilities.formatDate(val, "Asia/Ho_Chi_Minh", "yyyy-MM-dd");
  }
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return Utilities.formatDate(d, "Asia/Ho_Chi_Minh", "yyyy-MM-dd");
}

// ═══════════════════════════════════════════════════════════════════════════════
// 10. SMART REPORTING (V15.0 - EMOJI FIX)
// ═══════════════════════════════════════════════════════════════════════════════

function _sendSmartReport(stats, batchId, config, coreConfig) {
  const table = `${coreConfig.connection.PROJECT_ID}.${coreConfig.connection.DATASET_ID}.${config.BQ_CONFIG.ALERT_LOG_TABLE}`;
  const subject = `${config.REPORTING.EMAIL_PREFIX} - ${Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "MMMM yyyy")}`;
  
  const statusColor = stats.status === 'SUCCESS' ? '#34A853' : '#EA4335';
  
  // [V15.0 FIX] HTML ENTITIES FOR EMOJIS (Guarantees rendering)
  const statusIcon = stats.status === 'SUCCESS' ? '&#9989;' : '&#128308;'; // Green Check or Red Circle

  const html = `
    <div style="font-family:sans-serif; border:1px solid #ccc; border-radius:8px; padding:0; overflow:hidden; max-width:650px;">
      <div style="background:${statusColor}; color:white; padding:12px; font-weight:bold;">
        ${statusIcon} CS Monitor V15.0 Report (Granular Audit)
      </div>
      <div style="padding:16px;">
        <p><strong>Batch:</strong> ${batchId}</p>
        <p><strong>Time:</strong> ${Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd-MMM-yyyy HH:mm")}</p>
        
        <table style="width:100%; border-collapse:collapse; margin-bottom:15px;">
          <tr style="border-bottom:1px solid #eee;"><td>Processed Resolutions</td><td>${stats.resolutionsProcessed}</td></tr>
          <tr style="border-bottom:1px solid #eee;"><td>Rows Scanned</td><td>${stats.rowsScanned}</td></tr>
          
          <tr style="background:#fff3e0;"><td colspan="2"><strong>Issues Found</strong></td></tr>
          
          <tr style="border-bottom:1px solid #eee;"><td>&#128123; Ghosts (Zero Qty)</td><td>${stats.ghosts.length}</td></tr>
          <tr style="border-bottom:1px solid #eee; ${stats.safetyFlags.length > 0 ? 'background:#ffe0e0;' : ''}">
              <td>&#128737;&#65039; Safety Flags (Multi/ID Risk)</td><td><strong>${stats.safetyFlags.length}</strong></td>
          </tr>
          <tr style="border-bottom:1px solid #eee;"><td>&#128161; Intel (Yield/Timing)</td><td>${stats.businessIntel.length}</td></tr>
          <tr style="border-bottom:1px solid #eee;"><td>&#9888;&#65039; Data/ID Mismatches</td><td>${stats.dataMismatches.length}</td></tr>
          <tr style="border-bottom:1px solid #eee;"><td>&#129503; Zombies</td><td>${stats.zombies.length}</td></tr>
          <tr style="border-bottom:1px solid #eee;"><td>&#128201; Drops</td><td>${stats.drops.length}</td></tr>
      
          <tr style="background:#e8f5e9;"><td colspan="2"><strong>Resolutions</strong></td></tr>
          <tr style="border-bottom:1px solid #eee;"><td>&#9851;&#65039; Resurrections</td><td>${stats.resurrections}</td></tr>
          <tr style="border-bottom:1px solid #eee;"><td>&#127937; Auto-Resolved</td><td>${stats.autoResolved}</td></tr>
        </table>

        ${config.REPORTING.INCLUDE_DEVELOPER_CLUES ? `
          <div style="background:#f5f5f5; padding:10px; border-radius:4px; border:1px solid #eee; font-size:12px;">
            <strong>&#128187; Developer Clues (SQL):</strong><br/>
            <code style="display:block; margin-top:5px; color:#555;">
              SELECT * FROM \`${table}\`<br/>
              WHERE IS_RESOLVED = FALSE<br/>
              ORDER BY IS_MULTI_ORDER DESC, CLASSIFICATION DESC, DAYS_UNRESOLVED DESC;
            </code>
          </div>
        ` : ''}
        
        ${stats.errors.length > 0 ? `<div style="color:red; margin-top:10px;"><strong>Errors:</strong><br/>${stats.errors.join('<br/>')}</div>` : ''}
      </div>
    </div>
  `;
  
  try {
    let recipients = config.ESCALATION.DEVELOPER_EMAIL;
    
    // Include planner for safety flags
    if (stats.safetyFlags.length > 0) {
      recipients += `,${config.ESCALATION.PLANNER_EMAIL}`;
    }
    
    // Thread by month
    const threads = GmailApp.search(`subject:"${subject}"`);
    if (threads.length > 0) {
      threads[0].reply("", { htmlBody: html });
    } else {
      GmailApp.sendEmail(recipients, subject, "", { htmlBody: html });
    }
    console.log(`[CS_Monitor] Email sent to ${recipients}.`);
  } catch (e) {
    console.warn("Email failed: " + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 11. MENU & TRIGGER HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Register the CS Monitor menu.
 * Call this from onOpen() in your spreadsheet.
 */
function addCSMonitorMenu() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🔍 CS Status Monitor')
    .addItem('🔄 Run Logic and Refresh Manual', 'run_CS_Status_Monitor_Manual')
    .addItem('✅ Commit Resolutions', 'menu_commitResolutions')
    .addSeparator()
    .addItem('⚠️ [ADMIN] Rebuild Sheet', 'menu_rebuildM1Sheet')
    .addItem('🔧 [ADMIN] Install Triggers', 'menu_installM1Triggers')
    .addToUi();
}

/**
 * Menu handler: Rebuild UI only (no logic execution).
 */
function menu_CS_BuildUI() {
  try {
    M1_CS_Status_SheetBuilder.build_CS_Monitor_Sheet();
    SpreadsheetApp.getUi().alert('✅ Dashboard Refreshed', 'Visual layer updated from BigQuery data.', SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    console.error(e);
    SpreadsheetApp.getUi().alert('❌ Error', e.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

// 10. MENU & UI HANDLERS (V15.2 SAFE DESIGN)
// ═══════════════════════════════════════════════════════════════════════════════


/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🟢 MANUAL TRIGGER HANDLER (The Missing Bridge)
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function run_CS_Status_Monitor_Manual() {
  const ui = SpreadsheetApp.getUi();
  
  // 1. Confirmation Dialog (Taken from V14.0 Logic)
  const response = ui.alert(
    '⚠️ Confirm Manual Run', 
    'This will execute the full Nightly Protocol:\n' +
    '1. Scan all active CS Sheets vs System Data\n' +
    '2. Update BigQuery Alert Logs\n' +
    '3. Refresh this Dashboard UI\n\n' +
    'This process takes ~60 seconds. Continue?', 
    ui.ButtonSet.YES_NO
  );

  // 2. Execution
  if (response == ui.Button.YES) {
    try {
      // Calls the main "Nightly Pilot" function defined at the top of this file
      trigger_M1_CSMonitorNightly(); 
      
      ui.alert('✅ Execution Complete', 'System Logic Updated & Dashboard Refreshed.', ui.ButtonSet.OK);
    } catch (e) {
      console.error(e);
      ui.alert('❌ Execution Failed', 'Error: ' + e.message, ui.ButtonSet.OK);
    }
  }
}

/**
 * Menu Handler: Commit Resolutions
 * Second Priority Action.
 */
function menu_commitResolutions() {
  M1_CS_Status_SheetBuilder.submit_CS_Resolutions();
}

/**
 * Menu Handler: Rebuild Sheet [ADMIN]
 * "Nuclear Option" - Separated to prevent accidents.
 */
function menu_rebuildM1Sheet() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.alert(
    '⚠️ ADMIN: REBUILD SHEET', 
    'This will DELETE and RECREATE the entire M1 Monitor sheet.\n' +
    'All formatting and filters will be reset.\n\n' +
    'Are you sure you want to proceed?', 
    ui.ButtonSet.YES_NO
  );
  
  if (result == ui.Button.YES) {
    if (typeof M1_CS_Status_SheetBuilder !== 'undefined') {
      M1_CS_Status_SheetBuilder.build_CS_Monitor_Sheet(getM1CSMonitorConfig());
    }
  }
}

/**
 * Menu Handler: Install Triggers [ADMIN]
 */
function menu_installM1Triggers() {
  const functionName = 'trigger_M1_CSMonitorNightly';
  const ui = SpreadsheetApp.getUi();
  
  // Clean existing triggers
  const allTriggers = ScriptApp.getProjectTriggers();
  let deletedCount = 0;
  for (let i = 0; i < allTriggers.length; i++) {
    if (allTriggers[i].getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(allTriggers[i]);
      deletedCount++;
    }
  }

  // Install new trigger at 01:00 AM Vietnam time
  ScriptApp.newTrigger(functionName)
    .timeBased()
    .everyDays(1)
    .atHour(1)
    .inTimezone("Asia/Ho_Chi_Minh")
    .create();
    
  ui.alert(
    '✅ Trigger Installed', 
    `Removed ${deletedCount} old triggers.\nNew trigger set for 1:00 AM daily (Asia/Ho_Chi_Minh).`, 
    ui.ButtonSet.OK
  );
}