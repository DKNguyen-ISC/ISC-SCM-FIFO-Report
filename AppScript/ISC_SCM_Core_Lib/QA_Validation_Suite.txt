/**
 * 🧪 QA VALIDATION SUITE (v2.0 - Auto-Sanitizing Edition)
 * Purpose: Automated Stress Testing & Logic Verification for ISC Supply Chain.
 * Features:
 * 1. Auto-Sanitization: Wipes old test data AND resets the Matching Engine before starting.
 * 2. Mega Stress Test: 3-Scenario Parallel Execution (Partial, Backlog, Multi-Source).
 * 3. Deep Traceability: Enhanced UI logging for every decision made.
 *
 * Dependencies: BigQueryClient, Config_Schema
 */

// =========================================================
// 1. 🌪️ MEGA STRESS TEST (The "All-In-One" Validator)
// =========================================================
function qa_Run_Mega_Stress_Test() {
  const config = getCoreConfig();
  const project = config.connection.PROJECT_ID;
  const dataset = config.connection.DATASET_ID;
  const testSessionId = `MEGA_TEST_${Utilities.formatDate(new Date(), 'GMT+7', 'HHmmss')}`;
  const userEmail = Session.getActiveUser().getEmail();

  // 🛠️ HELPERS
  const safeDate = (val) => (val && val.value ? val.value : (val ? String(val) : 'N/A'));
  const safeFloat = (val) => { const n = parseFloat(val); return isNaN(n) ? 0 : n; };
  const printHeader = (t) => { Logger.log(`\n════════════════════════════════════════════════════════════════\n ${t}\n════════════════════════════════════════════════════════════════`); };
  const logStep = (msg) => Logger.log(`   • ${msg}`);

  Logger.log(`🌪️ STARTING QA MEGA SUITE (Session: ${testSessionId})`);

  try {
    // ---------------------------------------------------------
    // STEP 0: PRE-FLIGHT SANITIZATION (The "Clean Slate" Protocol)
    // ---------------------------------------------------------
    printHeader("🧹 STEP 0: SYSTEM SANITIZATION");
    logStep("Objective: Ensure clean baseline (No ghost supply).");
    
    // A. Wipe Old Test Data
    qa_Cleanup_Test_Data(); // (Calls the cleanup function defined below)
    
    // B. Force Re-Allocation (Reset Net Demand)
    // This ensures that any shortages we see in Step 1 are REAL, 
    // calculated fresh after removing the old test injections.
    logStep("Forcing Module 2 Allocation (Recalculating True Shortages)...");
    const tResetStart = new Date();
    runWriteQuery(`CALL \`${project}.${dataset}.SP_RUN_MATCHING_ENGINE\`()`);
    const tResetEnd = new Date();
    logStep(`System Baseline Restored in ${(tResetEnd.getTime() - tResetStart.getTime()) / 1000}s`);


    // ---------------------------------------------------------
    // STEP 1: SCOUTING MISSION
    // ---------------------------------------------------------
    printHeader("📋 STEP 1: SCOUTING CANDIDATES");
    logStep("Searching for 3 DISTINCT items with 'Public Shortage' > 10...");

    const scoutSql = `
      SELECT 
        D.BOM_UPDATE, 
        ANY_VALUE(SC.SUPPLIER_NAME) as SUPPLIER_NAME,
        SUM(D.NET_SHORTAGE_QTY) as TOTAL_SHORTAGE,
        MIN(D.REQUESTED_DELIVERY_DATE) as EARLIEST_DEMAND
      FROM \`${project}.${dataset}.PR_Draft\` D
      JOIN \`${project}.${dataset}.Supplier_Capacity\` SC ON D.BOM_UPDATE = SC.BOM_UPDATE
      WHERE D.REQUEST_TYPE = 'SHORTAGE' AND D.FULFILLMENT_MODE = 'PUBLIC'
      GROUP BY D.BOM_UPDATE
      HAVING TOTAL_SHORTAGE > 10
      ORDER BY TOTAL_SHORTAGE DESC
      LIMIT 3
    `;
    const candidates = runReadQueryMapped(scoutSql);
    
    if (candidates.length < 3) { 
      Logger.log("⚠️ QA ABORTED: Not enough distinct shortage items found."); 
      Logger.log(`   Found: ${candidates.length}. Run Demand Gen Module to create more traffic.`);
      return; 
    }

    const subA = { ...candidates[0], TOTAL_SHORTAGE: safeFloat(candidates[0].TOTAL_SHORTAGE) };
    const subB = { ...candidates[1], TOTAL_SHORTAGE: safeFloat(candidates[1].TOTAL_SHORTAGE) };
    const subC = { ...candidates[2], TOTAL_SHORTAGE: safeFloat(candidates[2].TOTAL_SHORTAGE) };

    Logger.log(`   🎯 TARGET ACQUIRED:`);
    Logger.log(`      🅰️ SCENARIO A (Partial Fill Logic):  ${subA.BOM_UPDATE} | Need: ${subA.TOTAL_SHORTAGE.toFixed(2)}`);
    Logger.log(`      🅱️ SCENARIO B (Backlog Logic):      ${subB.BOM_UPDATE} | Oldest: ${safeDate(subB.EARLIEST_DEMAND)}`);
    Logger.log(`      ©️ SCENARIO C (Multi-Source Logic):  ${subC.BOM_UPDATE} | Need: ${subC.TOTAL_SHORTAGE.toFixed(2)}`);

    // ---------------------------------------------------------
    // STEP 2: INJECTION PLANNING & EXECUTION
    // ---------------------------------------------------------
    printHeader("💉 STEP 2: INJECTION EXECUTION");
    const tomorrow = Utilities.formatDate(new Date(new Date().getTime() + 86400000), 'GMT', 'yyyy-MM-dd');
    const injections = [];

    // Plan A: 40% Partial Fill
    const qtyA = Math.floor(subA.TOTAL_SHORTAGE * 0.40 * 100) / 100;
    injections.push(`('${testSessionId}', 1, 'QA_Bot', '${subA.SUPPLIER_NAME}', '${subA.BOM_UPDATE}', ${qtyA}, 1.0, '${tomorrow}', '${tomorrow}', 'GENERAL_STOCK', 'QA-PARTIAL', 'PENDING', '${userEmail}', CURRENT_TIMESTAMP())`);

    // Plan B: 100% Backlog Fill
    injections.push(`('${testSessionId}', 2, 'QA_Bot', '${subB.SUPPLIER_NAME}', '${subB.BOM_UPDATE}', ${subB.TOTAL_SHORTAGE}, 1.0, '${tomorrow}', '${tomorrow}', 'GENERAL_STOCK', 'QA-BACKLOG', 'PENDING', '${userEmail}', CURRENT_TIMESTAMP())`);

    // Plan C: Multi-Source (50/50)
    const qtyC1 = Math.floor(subC.TOTAL_SHORTAGE * 0.50 * 100) / 100;
    const qtyC2 = subC.TOTAL_SHORTAGE - qtyC1;
    injections.push(`('${testSessionId}', 3, 'QA_Bot', '${subC.SUPPLIER_NAME}', '${subC.BOM_UPDATE}', ${qtyC1}, 1.0, '${tomorrow}', '${tomorrow}', 'GENERAL_STOCK', 'QA-MULTI-1', 'PENDING', '${userEmail}', CURRENT_TIMESTAMP())`);
    injections.push(`('${testSessionId}', 4, 'QA_Bot', '${subC.SUPPLIER_NAME}', '${subC.BOM_UPDATE}', ${qtyC2}, 1.0, '${tomorrow}', '${tomorrow}', 'GENERAL_STOCK', 'QA-MULTI-2', 'PENDING', '${userEmail}', CURRENT_TIMESTAMP())`);

    logStep(`Injecting 4 Test POs (Total Supply Arriving: ${tomorrow})...`);
    
    const insertSql = `INSERT INTO \`${project}.${dataset}.PO_Direct_Injection_Staging\` (SESSION_ID, ROW_NUMBER, PIC, SUPPLIER_NAME, BOM_UPDATE, ORDER_QTY, UNIT_PRICE, FINAL_REQUESTED_DELIVERY_DATE, CURRENT_ETA, VPO, LEGACY_PO_REF, VALIDATION_STATUS, UPLOADED_BY, UPLOADED_AT) VALUES ${injections.join(',\n')}`;
    runWriteQuery(insertSql);
    runWriteQuery(`CALL \`${project}.${dataset}.SP_INJECT_DIRECT_PO\`('${testSessionId}')`);
    
    // Check Commit
    const check = runReadQueryMapped(`SELECT COUNT(*) as CNT FROM \`${project}.${dataset}.PO_Direct_Injection_Staging\` WHERE SESSION_ID = '${testSessionId}' AND VALIDATION_STATUS = 'COMMITTED'`);
    if (safeFloat(check[0].CNT) < 4) { Logger.log("❌ INJECTION FAILED. Check Staging Table."); return; }
    logStep("Success: All 4 POs Committed to Tracking Table.");

    // ---------------------------------------------------------
    // STEP 3: ENGINE ACTIVATION
    // ---------------------------------------------------------
    printHeader("🧠 STEP 3: ENGINE ACTIVATION");
    logStep("Running SP_RUN_MATCHING_ENGINE to process new supply...");
    const tStart = new Date();
    runWriteQuery(`CALL \`${project}.${dataset}.SP_RUN_MATCHING_ENGINE\`()`);
    const tEnd = new Date();
    logStep(`Engine Completed Cycle in ${(tEnd.getTime() - tStart.getTime()) / 1000}s`);

    // ---------------------------------------------------------
    // STEP 4: VERIFICATION & ANALYSIS
    // ---------------------------------------------------------
    printHeader("🔍 STEP 4: FINAL SCENARIO ANALYSIS");

    // Verify A (Partial)
    const resA = runReadQueryMapped(`SELECT SUM(NET_SHORTAGE_QTY) as REMAIN FROM \`${project}.${dataset}.PR_Draft\` WHERE BOM_UPDATE='${subA.BOM_UPDATE}' AND REQUEST_TYPE='SHORTAGE'`);
    const remainA = safeFloat(resA[0].REMAIN);
    const expectA = subA.TOTAL_SHORTAGE - qtyA;
    Logger.log(`🅰️ SCENARIO A (Partial Fill Logic): ${subA.BOM_UPDATE}`);
    Logger.log(`   • Original Need: ${subA.TOTAL_SHORTAGE.toFixed(2)}`);
    Logger.log(`   • We Injected:   ${qtyA.toFixed(2)} (40%)`);
    Logger.log(`   • Expected Rem:  ${expectA.toFixed(2)}`);
    Logger.log(`   • Actual Rem:    ${remainA.toFixed(2)}`);
    Logger.log(Math.abs(remainA - expectA) < 0.1 ? "   ✅ RESULT: PASS (Math is Perfect)" : "   ❌ RESULT: FAIL (Variance Detected)");

    // Verify B (Backlog)
    const resB = runReadQueryMapped(`SELECT SUM(NET_SHORTAGE_QTY) as REMAIN FROM \`${project}.${dataset}.PR_Draft\` WHERE BOM_UPDATE='${subB.BOM_UPDATE}' AND REQUEST_TYPE='SHORTAGE'`);
    const remainB = safeFloat(resB[0].REMAIN);
    Logger.log(`\n🅱️ SCENARIO B (Backlog Logic): ${subB.BOM_UPDATE}`);
    Logger.log(`   • Oldest Date:   ${safeDate(subB.EARLIEST_DEMAND)} (In the past)`);
    Logger.log(`   • We Injected:   ${subB.TOTAL_SHORTAGE.toFixed(2)} (Arriving Tomorrow)`);
    Logger.log(`   • Actual Rem:    ${remainB.toFixed(2)}`);
    Logger.log(remainB < 1 ? "   ✅ RESULT: PASS (Engine filled backlog with future stock)" : "   ❌ RESULT: FAIL (Shortage remains)");

    // Verify C (Multi)
    const resC = runReadQueryMapped(`SELECT SUM(NET_SHORTAGE_QTY) as REMAIN FROM \`${project}.${dataset}.PR_Draft\` WHERE BOM_UPDATE='${subC.BOM_UPDATE}' AND REQUEST_TYPE='SHORTAGE'`);
    const remainC = safeFloat(resC[0].REMAIN);
    Logger.log(`\n©️ SCENARIO C (Multi-Source Logic): ${subC.BOM_UPDATE}`);
    Logger.log(`   • Total Need:    ${subC.TOTAL_SHORTAGE.toFixed(2)}`);
    Logger.log(`   • We Injected:   2 Separate POs (50% + 50%)`);
    Logger.log(`   • Actual Rem:    ${remainC.toFixed(2)}`);
    Logger.log(remainC < 1 ? "   ✅ RESULT: PASS (Engine aggregated both POs)" : "   ❌ RESULT: FAIL (Integration Error)");

  } catch (e) {
    Logger.log(`❌ QA CRITICAL FAILURE: ${e.message}`);
    console.error(e.stack);
  }
}

// =========================================================
// 2. 🧹 QA CLEANUP (Housekeeping)
// =========================================================
/**
 * Deletes all data generated by Stress Tests.
 * This is now called AUTOMATICALLY at the start of the Mega Test.
 */
function qa_Cleanup_Test_Data() {
  const config = getCoreConfig();
  const project = config.connection.PROJECT_ID;
  const dataset = config.connection.DATASET_ID;
  
  // Use a smaller log prefix to show it's a sub-step
  const log = (msg) => Logger.log(`   • [Cleanup] ${msg}`);

  const findSql = `
    SELECT DISTINCT GENERATED_PO_DOC_ID 
    FROM \`${project}.${dataset}.PO_Direct_Injection_Staging\`
    WHERE SESSION_ID LIKE 'MEGA_TEST%' OR SESSION_ID LIKE 'BAL_TEST%' OR SESSION_ID LIKE 'FIFO_TEST%'
  `;

  try {
    const rows = runReadQueryMapped(findSql);
    if (!rows.length) { 
      log("No residual test data found. Clean."); 
      return; 
    }

    log(`Purging ${rows.length} old Test PO Documents...`);

    // Cascade Delete
    const docIds = `(${findSql})`;
    
    // 1. Un-Peg (Critical to free up Allocations)
    runWriteQuery(`DELETE FROM \`${project}.${dataset}.Pegging_Allocations\` WHERE SUPPLY_SOURCE_ID IN (SELECT PO_LINE_ID FROM \`${project}.${dataset}.PO_Line\` WHERE PO_DOCUMENT_ID IN ${docIds})`);
    
    // 2. Delete PO Data
    runWriteQuery(`DELETE FROM \`${project}.${dataset}.PO_Line_Tracking\` WHERE PO_DOCUMENT_ID IN ${docIds}`);
    runWriteQuery(`DELETE FROM \`${project}.${dataset}.PO_Line\` WHERE PO_DOCUMENT_ID IN ${docIds}`);
    runWriteQuery(`DELETE FROM \`${project}.${dataset}.PO_Header\` WHERE PO_DOCUMENT_ID IN ${docIds}`);
    
    // 3. Clear Staging
    runWriteQuery(`DELETE FROM \`${project}.${dataset}.PO_Direct_Injection_Staging\` WHERE SESSION_ID LIKE 'MEGA_TEST%' OR SESSION_ID LIKE 'BAL_TEST%' OR SESSION_ID LIKE 'FIFO_TEST%'`);

    log("Cleanup Successful. Old data removed.");
    
  } catch (e) {
    log(`⚠️ CLEANUP WARNING: ${e.message}`);
  }
}