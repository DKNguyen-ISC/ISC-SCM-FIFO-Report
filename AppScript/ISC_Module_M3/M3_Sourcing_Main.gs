/* -------------------------------------------------------------------------
 * FILE: ISC_Module_M3/M3_Sourcing_Main.gs
 * DESCRIPTION: Logic Controller for Sourcing (Session-Based Workspace v57).
 * FEATURES: 
 * - Session Management (Private Sheets per PIC)
 * - Smart Filtering (MASTER sees all, PICs see theirs)
 * - Feedback Loop (Loads User Decisions from PR_Final back to Zone B)
 * - Decoupled Date Logic (Zone B Input)
 * - Phase 5: Material Scope Dialog (Group + Method Selection)
 * - Phase 5: MASTER Cross-Method Dashboard (D9)
 * - Phase 5.1: Session Dashboard (Rows 1-4), Header Wrapping, Dual Columns
 * ------------------------------------------------------------------------- */

const SOURCING_CONSTANTS = {
  TEMPLATE_NAME: 'Assign_Sourcing', // The Locked Master Template
  SESSION_SUFFIX: '_Assign_Sourcing', // Naming Convention
  VIEW_NAME: 'Sourcing_Feed_VIEW',
  REF_MASTER: 'Ref_Supplier_Master',
  REF_CAPACITY: 'Ref_Supplier_Capacity'
  // 👥 Identity List removed — Phase 2: use ISC_SCM_Core_Lib.resolvePicIdentity()
};

/**
 * 🛒 MENU CREATOR
 */
function createSourcingMenu() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🛒 ISC Sourcing')
    .addItem('📥 Start Sourcing Session', 'loadSourcingSession')
    .addSeparator()
    .addItem('🔄 Refresh Current Session', 'refreshSourcingDashboard')
    .addItem('🚀 Submit Sourcing Decisions', 'runSourcingUpload')
    .addSeparator()
    .addItem('🔧 Admin: Rebuild Template', 'launchSourcingBuilder')
    .addToUi();
}

/**
 * 🏗️ ADMIN TRIGGER
 */
function launchSourcingBuilder() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('⚠️ Rebuild Template?', 'This will wipe and rebuild ALL Sourcing templates. Ensure no one is using them.', ui.ButtonSet.YES_NO) === ui.Button.YES) {
    M3_Sourcing_SheetBuilder.buildSourcingInterface();
    M3_Agg_SheetBuilder.getOrBuildSheet(SpreadsheetApp.getActiveSpreadsheet(), 'Tpl_Assign_Sourcing_Aggregated');
  }
}

/* =========================================================================
 * 1. 📥 SESSION MANAGEMENT
 * ========================================================================= */

/**
 * Starts or Resumes a User's Private Session
 */
function loadSourcingSession() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  // ── STEP 1: Identify User — Phase 2: Uses Identity_Registry for accent-insensitive resolution
  const p = ui.prompt(
    '👤 Identity Check', 
    `Enter your PIC Name.\nValid Options: ${ISC_SCM_Core_Lib.getValidPicNames()}`, 
    ui.ButtonSet.OK_CANCEL
  );
  if (p.getSelectedButton() !== ui.Button.OK) return;
  
  const rawInput = p.getResponseText().trim();
  const picName = ISC_SCM_Core_Lib.resolvePicIdentity(rawInput);
  if (!picName) {
    ui.alert('❌ Invalid Identity', `"${rawInput}" is not recognized.\nValid Options: ${ISC_SCM_Core_Lib.getValidPicNames()}`, ui.ButtonSet.OK);
    return;
  }

  // ── STEP 2: Material Scope Dialog (Phase 5 — D1, D3)
  let selectedGroup = 'ALL';
  let selectedMethod = 'COMPLETION';

  if (picName === 'MASTER') {
    // MASTER always sees everything — skip Material Scope, show cross-method dashboard
    selectedGroup = 'ALL';
    selectedMethod = 'MASTER';  // Special flag for MASTER cross-method view
  } else {
    const groups = _getAvailableMaterialGroups(picName);
    if (!groups || groups.length === 0) {
      ui.alert('ℹ️ No Items', `No active materials found for "${picName}".`, ui.ButtonSet.OK);
      return;
    }

    // Build dropdown options
    const groupList = groups.map(g => `• ${g.MAIN_GROUP} (${g.material_count} items)`).join('\n');
    const groupNames = groups.map(g => g.MAIN_GROUP);

    const scopePrompt = ui.prompt(
      '📦 Material Scope (Step 2)',
      `Select a Material Group to load, or type "ALL" for everything:\n\n${groupList}\n\nEnter group name:`,
      ui.ButtonSet.OK_CANCEL
    );
    if (scopePrompt.getSelectedButton() !== ui.Button.OK) return;

    const scopeInput = scopePrompt.getResponseText().trim();
    if (scopeInput.toUpperCase() === 'ALL') {
      selectedGroup = 'ALL';
    } else {
      // Fuzzy match: case-insensitive
      const matchedGroup = groupNames.find(g => g.toLowerCase() === scopeInput.toLowerCase());
      if (!matchedGroup) {
        ui.alert('❌ Invalid Group', `"${scopeInput}" not found.\nValid options: ALL, ${groupNames.join(', ')}`, ui.ButtonSet.OK);
        return;
      }
      selectedGroup = matchedGroup;
    }

    // Method suggestion
    if (selectedGroup !== 'ALL') {
      const suggested = _getSuggestedMethod(selectedGroup);
      const methodMsg = suggested === 'ISSUANCE'
        ? `💡 Recommended: ISSUANCE method\n\nReason: ${selectedGroup} has a WIP gap — material is issued from warehouse before production completion is reported. The Issuance method eliminates phantom shortages.\n\nProceed with ISSUANCE method?\n(YES = Issuance, NO = Completion)`
        : `💡 Recommended: COMPLETION method\n\nReason: ${selectedGroup} follows the standard production-to-demand flow. Completion tracking is accurate for this group.\n\nProceed with COMPLETION method?\n(YES = Completion, NO = Issuance)`;

      const methodChoice = ui.alert('🔬 Shortage Method', methodMsg, ui.ButtonSet.YES_NO);
      selectedMethod = (methodChoice === ui.Button.YES) ? suggested : (suggested === 'ISSUANCE' ? 'COMPLETION' : 'ISSUANCE');
    } else {
      selectedMethod = 'COMPLETION';  // Default for ALL
    }
  }

  // ── STEP 3: Route Session (Phase 2 Aggregation vs Legacy)
  const routingMode = _readRoutingMode();
  let useAggregated = false;
  
  if (routingMode === AGG_ROUTING.MODES.AGGREGATED_ONLY || routingMode === AGG_ROUTING.MODES.AUTO) {
    useAggregated = true;
  }

  let sessionSheetName, templateName;
  if (useAggregated) {
    sessionSheetName = `${picName}${AGG_ROUTING.AGG_SHEET_SUFFIX}`;
    templateName = 'Tpl_Assign_Sourcing_Aggregated';
  } else {
    sessionSheetName = `${picName}${SOURCING_CONSTANTS.SESSION_SUFFIX}`;
    templateName = SOURCING_CONSTANTS.TEMPLATE_NAME;
  }

  let sessionSheet = ss.getSheetByName(sessionSheetName);

  if (!sessionSheet) {
    const template = ss.getSheetByName(templateName);
    if (!template) {
      ui.alert('❌ Error', `Master Template "${templateName}" is missing. Please run Admin Rebuild.`, ui.ButtonSet.OK);
      return;
    }
    
    sessionSheet = template.copyTo(ss).setName(sessionSheetName);
    sessionSheet.setTabColor(picName === 'MASTER' ? '#ff0000' : '#00ff00');
    ss.toast(`Created new session: ${sessionSheetName}`);
  }

  sessionSheet.activate();

  // ── STEP 4: Load Data with Scope
  const scopeLabel = selectedGroup === 'ALL' ? 'All Groups' : selectedGroup;
  const methodLabel = selectedMethod === 'MASTER' ? 'Cross-Method Dashboard' : selectedMethod;
  const modeLabel = useAggregated ? 'AGGREGATED' : 'VPO LEVEL';
  
  if (ui.alert('🔄 Load Data?', `Load pending items for "${picName}"?\n\n📦 Scope: ${scopeLabel}\n🔬 Method: ${methodLabel}\n🧭 Routing: ${modeLabel}`, ui.ButtonSet.YES_NO) === ui.Button.YES) {
    if (useAggregated) {
      _clearZoneB(sessionSheet, {startCol: 18, width: 20});
      _loadAggregatedPRsToSheet(sessionSheet, picName, selectedGroup, routingMode);
    } else {
      _executeRefresh(sessionSheet, picName, selectedGroup, selectedMethod);
    }
  }
}

/**
 * Refreshes the *Active* Session Sheet
 */
function refreshSourcingDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const ui = SpreadsheetApp.getUi();

  // 1. Validate Session Context
  const sheetName = sheet.getName();
  let isAgg = false;
  let rawPicName = "";

  if (sheetName.endsWith(AGG_ROUTING.AGG_SHEET_SUFFIX)) {
    isAgg = true;
    rawPicName = sheetName.replace(AGG_ROUTING.AGG_SHEET_SUFFIX, '');
  } else if (sheetName.endsWith(SOURCING_CONSTANTS.SESSION_SUFFIX)) {
    isAgg = false;
    rawPicName = sheetName.replace(SOURCING_CONSTANTS.SESSION_SUFFIX, '');
  } else {
    ui.alert('⚠️ Invalid Context', 'Please run this command from a valid Session Sheet.', ui.ButtonSet.OK);
    return;
  }

  // 2. Extract Identity from Tab Name — Phase 2: validates via Identity_Registry
  const picName = ISC_SCM_Core_Lib.resolvePicIdentity(rawPicName);
  if (!picName) {
    ui.alert('❌ Error', `Could not derive a valid PIC from "${sheetName}".`, ui.ButtonSet.OK);
    return;
  }

  // 3. Confirm & Execute
  if (ui.alert('🔄 Refresh Session?', `This will CLEAR Zone B and reload items for "${picName}".\n(Your saved Price/Date decisions will be preserved).`, ui.ButtonSet.YES_NO) === ui.Button.YES) {
    if (isAgg) {
      _clearZoneB(sheet, {startCol: 18, width: 20});
      _loadAggregatedPRsToSheet(sheet, picName, 'ALL', _readRoutingMode());
    } else {
      _executeRefresh(sheet, picName);
    }
  }
}

/**
 * Core Execution Logic for Refresh
 */
function _executeRefresh(sheet, targetPic, mainGroup, method) {
  // Default to ALL / COMPLETION if called from refreshSourcingDashboard (no scope)
  mainGroup = mainGroup || 'ALL';
  method = method || 'COMPLETION';

  try {
    // 1. Calculate dynamic layout based on Pillars
    const zoneConfig = _getDynamicZoneConfig(sheet);

    // 2. Clear old data
    _clearZoneB(sheet, zoneConfig);

    // 3. Load fresh data (Filtered by PIC, Group & Method — Phase 5)
    _loadPendingPRsToSheet(sheet, zoneConfig, targetPic, mainGroup, method);

    // 4. Re-inject Formulas (Repair)
    _repairFormulasAndFormatting(sheet);
    
    const scopeMsg = mainGroup === 'ALL' ? '' : ` | 📦 ${mainGroup} | 🔬 ${method}`;
    SpreadsheetApp.getActiveSpreadsheet().toast(`Session refreshed for ${targetPic}.${scopeMsg}`, "Sourcing System");

  } catch (e) {
    SpreadsheetApp.getUi().alert('❌ Error', e.message, SpreadsheetApp.getUi().ButtonSet.OK);
    ISC_SCM_Core_Lib.logError('M3_SOURCING_REFRESH', e);
  }
}

/* =========================================================================
 * 2. 🚀 UPLOAD LOGIC
 * ========================================================================= */

function runSourcingUpload() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const ui = SpreadsheetApp.getUi();
  const userEmail = Session.getActiveUser().getEmail();

  // 1. VALIDATE SESSION
  const sheetName = sheet.getName();
  const isAgg = sheetName.endsWith(AGG_ROUTING.AGG_SHEET_SUFFIX);
  const isLegacy = sheetName.endsWith(SOURCING_CONSTANTS.SESSION_SUFFIX);

  if (!isAgg && !isLegacy) {
    ui.alert('🛑 Stop', 'You can only submit from a valid Session Sheet.', ui.ButtonSet.OK);
    return;
  }

  // 2. ROUTE TO AGGREGATED EXPLODE (Phase 2 V7)
  if (isAgg) {
    uploadAggregatedExplode();
    return;
  }

  // 3. LEGACY VPO UPLOAD (Phase 1 / Private)
  if (ui.alert('🚀 Submit Sourcing?', 'This will upload ALL rows where "Check" is TRUE.\nProceed?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  try {
    const lastRow = sheet.getLastRow();
    if (lastRow < 3) throw new Error("No data to upload.");

    // 🟢 READ EXTENDED RANGE (Cols 1 to 37 to capture all Zone B inputs)
    // Matches 16-Col Zone A layout + Zone B (Starts at 18) + NSC/NSI
    const startRow = 7; // Phase 5.1: Dashboard rows shifted data to row 7
    const maxCols = 37; 
    const dataRange = sheet.getRange(startRow, 1, lastRow - startRow + 1, maxCols); 
    const values = dataRange.getValues();

    // 3. PREPARE CSV CONTENT
    const csvHeader = "PR_STAGING_ID,BOM_UPDATE,SUPPLIER_ID,SUPPLIER_NAME,QTY_TO_APPROVE,FULFILLMENT_MODE,FINAL_UNIT_PRICE,REQUESTED_DELIVERY_DATE,VPO,VALIDATION_STATUS,VALIDATION_LOG,PIC,DATE_CODE,UPDATED_BY,UPDATED_AT";
    const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

    const validCsvRows = values
      .filter(row => String(row[15]).toUpperCase() === 'TRUE') // Check Col P (Index 15) -> Supplier Check
      .map(row => {
        // A. Extract Data (0-based indices)
        const draftId         = row[0];  // A
        const bomUpdate       = row[1];  // B
        const vpo             = row[2];  // C
        const fulfillmentMode = row[3];  // D
        const pic             = row[4];  // E
        
        // 🟢 DATE CODE comes from ZONE B (Col X -> Index 23)
        // We ignore Col G (Index 6) because that is just a mirror formula.
        const dateCode        = row[23]; // X
        
        const supplierId      = row[7];  // H
        const supplierName    = row[8];  // I
        const finalPrice      = row[9];  // J (Zone A Formula or Override)
        const finalQty        = row[11]; // L
        const reqDate         = row[13]; // N
        
        // B. Format Date (Strict YYYY-MM-DD for Database)
        let formattedReqDate = "";
        if (reqDate instanceof Date) {
          formattedReqDate = Utilities.formatDate(reqDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
        } else if (reqDate && String(reqDate).trim() !== "") {
          try { formattedReqDate = Utilities.formatDate(new Date(reqDate), Session.getScriptTimeZone(), "yyyy-MM-dd"); } catch(e) {}
        }

        // C. Map to Schema Order
        return [
          _escapeCsv(draftId),           // 1. PR_STAGING_ID
          _escapeCsv(bomUpdate),         // 2. BOM_UPDATE
          _escapeCsv(supplierId),        // 3. SUPPLIER_ID
          _escapeCsv(supplierName),      // 4. SUPPLIER_NAME
          Number(finalQty) || 0,         // 5. QTY_TO_APPROVE
          _escapeCsv(fulfillmentMode),   // 6. FULFILLMENT_MODE
          Number(finalPrice) || 0,       // 7. FINAL_UNIT_PRICE
          formattedReqDate,              // 8. REQUESTED_DELIVERY_DATE
          _escapeCsv(vpo),               // 9. VPO
          "PENDING",                     // 10. VALIDATION_STATUS
          "OK",                          // 11. VALIDATION_LOG
          _escapeCsv(pic),               // 12. PIC
          _escapeCsv(dateCode),          // 13. DATE_CODE (User Input)
          _escapeCsv(userEmail),         // 14. UPDATED_BY
          timestamp                      // 15. UPDATED_AT
        ].join(",");
      });

    if (validCsvRows.length === 0) {
      ui.alert('⚠️ No Valid Rows', 'No visible rows marked "TRUE" found.', ui.ButtonSet.OK);
      return;
    }

    // 4. BULK UPLOAD
    const finalCsv = csvHeader + "\n" + validCsvRows.join("\n");
    ISC_SCM_Core_Lib.loadCsvData('PR_Staging', finalCsv, 'WRITE_APPEND');

    // 5. TRIGGER MERGE
    const config = ISC_SCM_Core_Lib.getCoreConfig();
    const spName = 'SP_M3_MERGE_PR_DECISIONS';
    const sqlQuery = `CALL \`${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}.${spName}\`()`;
    ISC_SCM_Core_Lib.runWriteQuery(sqlQuery);

    ss.toast(`🚀 Uploaded ${validCsvRows.length} decisions successfully.`, "Sourcing System");

  } catch (e) {
    ISC_SCM_Core_Lib.logError('M3_UPLOAD_FAIL', e);
    ui.alert('❌ Upload Failed', e.message, ui.ButtonSet.OK);
  }
}

/* =========================================================================
 * 3. 🛠️ HELPERS & LOADERS
 * ========================================================================= */

function _loadPendingPRsToSheet(sheet, config, targetPic, mainGroup, method) {
  const coreConfig = ISC_SCM_Core_Lib.getCoreConfig();
  
  // 🟢 SMART FILTER LOGIC (Phase 5: + Material Group filter)
  let whereClause = "TRUE";
  
  if (targetPic === 'MASTER') {
    whereClause = "TRUE";
  } else {
    whereClause = `PIC = '${targetPic}'`;
  }

  // Phase 5: Add material group filter
  if (mainGroup && mainGroup !== 'ALL') {
    whereClause += ` AND MAIN_GROUP = '${mainGroup}'`;
  }

  // 🟢 Phase 5: Enhanced SQL — dual-method columns + MASTER analytics
  const isMaster = (method === 'MASTER');
  const masterExtraCols = isMaster ? `,
      ROUND(NET_SHORTAGE_COMPLETION - NET_SHORTAGE_ISSUANCE, 2) AS METHOD_DELTA,
      CASE 
        WHEN NET_SHORTAGE_ISSUANCE <= 0 AND NET_SHORTAGE_COMPLETION > 0 
          THEN 'PHANTOM'
        WHEN ABS(NET_SHORTAGE_COMPLETION - NET_SHORTAGE_ISSUANCE) / 
             GREATEST(NET_SHORTAGE_COMPLETION, 0.001) > 0.20
          THEN 'DIVERGENT'
        ELSE 'ALIGNED'
      END AS METHOD_STATUS` : '';

  const sql = `
    SELECT 
      DRAFT_PR_ID, BOM_UPDATE, VPO, FULFILLMENT_MODE, PIC, 
      ORDER_LIST_NOTE, 
      BOM_DESCRIPTION, NET_SHORTAGE_QTY,
      NET_SHORTAGE_COMPLETION,
      NET_SHORTAGE_ISSUANCE,
      MAIN_GROUP, SUB_GROUP, HAS_ISSUANCE_DATA,
      REQUESTED_DELIVERY_DATE,
      ASSIGNED_SUPPLIER_NAME, KNOWN_CAPACITY_OPTIONS,
      DATE_CODE,
      FINAL_UNIT_PRICE
      ${masterExtraCols}
    FROM \`${coreConfig.connection.PROJECT_ID}.${coreConfig.connection.DATASET_ID}.${SOURCING_CONSTANTS.VIEW_NAME}\`
    WHERE ${whereClause}
    ORDER BY ${isMaster ? 'MAIN_GROUP, PIC, ' : ''}REQUESTED_DELIVERY_DATE ASC
  `;
  
  const queryRows = ISC_SCM_Core_Lib.runReadQueryMapped(sql);
  
  if (!queryRows || queryRows.length === 0) {
    SpreadsheetApp.getActiveSpreadsheet().toast(`No pending items found for ${targetPic}.`, "Sourcing");
    return;
  }

  // 🟢 Phase 5: Select the ACTIVE shortage value based on method
  const _getActiveShortage = (row) => {
    if (isMaster) return Number(row.NET_SHORTAGE_QTY);  // MASTER sees default pipeline value
    if (method === 'ISSUANCE') return Number(row.NET_SHORTAGE_ISSUANCE);
    return Number(row.NET_SHORTAGE_COMPLETION);  // COMPLETION (default)
  };

  // 🟢 WRITING DATA (Matches Zone B Order R-AJ) — Phase 5.1: Extended with NSC/NSI
  // Columns: R, S, T, U, V, W, X, Y, Z, AA, AB, AC, AD, AE, AF, AG, AH, AI, AJ
  const writeData = queryRows.map(row => [
    row.DRAFT_PR_ID,
    row.BOM_UPDATE,
    row.VPO || "",              
    row.FULFILLMENT_MODE || "", 
    row.PIC || "", 
    row.ORDER_LIST_NOTE || "",
    row.DATE_CODE || "",
    row.BOM_DESCRIPTION,
    _getActiveShortage(row),     // Z = method-selected value
    row.REQUESTED_DELIVERY_DATE ? new Date(row.REQUESTED_DELIVERY_DATE) : "", 
    row.ASSIGNED_SUPPLIER_NAME || "", 
    row.KNOWN_CAPACITY_OPTIONS || "",
    "",                          // AD (Price Ref - Formula)
    Number(row.FINAL_UNIT_PRICE) || "",
    "",                          // AF (Lead Ref - Formula)
    "",                          // AG (Lead Override)
    "",                          // AH (MOQ Ref - Formula)
    Number(row.NET_SHORTAGE_COMPLETION) || 0,  // AI: NSC 🆕
    Number(row.NET_SHORTAGE_ISSUANCE) || 0     // AJ: NSI 🆕
  ]);

  const startRow = 7; // Phase 5.1: Dashboard rows shifted data to row 7
  sheet.getRange(startRow, config.startCol, writeData.length, writeData[0].length).setValues(writeData);

  // 🟢 Phase 5.1: Write session dashboard to Rows 1-4
  _writeSessionDashboard(sheet, targetPic, mainGroup, method, queryRows);
}

function _repairFormulasAndFormatting(sheet) {
  const REF = SOURCING_CONSTANTS.REF_MASTER;
  const CAP = SOURCING_CONSTANTS.REF_CAPACITY;
  const YELLOW = "#ffff00";
  const FR = 6; // Phase 5.1: Formula Row

  // --- ZONE A FORMULAS (Row 6, referencing R6:R downward) ---
  sheet.getRange(`A${FR}`).setFormula(`=ARRAYFORMULA(IF(R${FR}:R="", "", R${FR}:R))`);
  sheet.getRange(`B${FR}`).setFormula(`=ARRAYFORMULA(IF(R${FR}:R="", "", S${FR}:S))`);
  sheet.getRange(`C${FR}`).setFormula(`=ARRAYFORMULA(IF(R${FR}:R="", "", T${FR}:T))`);
  sheet.getRange(`D${FR}`).setFormula(`=ARRAYFORMULA(IF(R${FR}:R="", "", U${FR}:U))`);
  sheet.getRange(`E${FR}`).setFormula(`=ARRAYFORMULA(IF(R${FR}:R="", "", V${FR}:V))`);
  sheet.getRange(`F${FR}`).setFormula(`=ARRAYFORMULA(IF(R${FR}:R="", "", W${FR}:W))`);
  sheet.getRange(`G${FR}`).setFormula(`=ARRAYFORMULA(IF(R${FR}:R="", "", X${FR}:X))`);
  sheet.getRange(`H${FR}`).setFormula(`=ARRAYFORMULA(IF(R${FR}:R="", "", IFNA(XLOOKUP(AB${FR}:AB, ${REF}!B:B, ${REF}!A:A), "MISSING_ID")))`);
  sheet.getRange(`I${FR}`).setFormula(`=ARRAYFORMULA(IF(R${FR}:R="", "", AB${FR}:AB))`);
  sheet.getRange(`J${FR}`).setFormula(`=ARRAYFORMULA(IF(R${FR}:R="", "", IF(ISNUMBER(AE${FR}:AE), AE${FR}:AE, AD${FR}:AD)))`);
  sheet.getRange(`K${FR}`).setFormula(`=ARRAYFORMULA(IF(R${FR}:R="", "", IF(ISNUMBER(AG${FR}:AG), AG${FR}:AG, AF${FR}:AF)))`);
  sheet.getRange(`L${FR}`).setFormula(`=ARRAYFORMULA(IF(R${FR}:R="", "", CEILING(Z${FR}:Z, IF((AH${FR}:AH="")+(AH${FR}:AH=0), 1, AH${FR}:AH))))`);
  sheet.getRange(`M${FR}`).setFormula(`=ARRAYFORMULA(IF(R${FR}:R="", "", TODAY() + K${FR}:K))`);
  sheet.getRange(`N${FR}`).setFormula(`=ARRAYFORMULA(IF(R${FR}:R="", "", AA${FR}:AA))`);
  sheet.getRange(`O${FR}`).setFormula(`=ARRAYFORMULA(IF(R${FR}:R="", "", IF(M${FR}:M > N${FR}:N, "LATE", "OK")))`);
  sheet.getRange(`P${FR}`).setFormula(`=ARRAYFORMULA(IF(R${FR}:R="", "", IF((H${FR}:H="MISSING_ID") + (H${FR}:H=""), "FALSE", "TRUE")))`);

  // Highlight Formula Row
  sheet.getRange(FR, 1, 1, 16).setBackground(YELLOW);

  // --- ZONE B LOOKUPS ---
  const lookupKey = `AB${FR}:AB & S${FR}:S`;
  
  const f_Price = `=ARRAYFORMULA(IF(R${FR}:R="", "", IFNA(XLOOKUP(${lookupKey}, ${CAP}!C:C & ${CAP}!D:D, ${CAP}!F:F), 0)))`;
  sheet.getRange(`AD${FR}`).setFormula(f_Price).setBackground(YELLOW);

  const f_Lead = `=ARRAYFORMULA(IF(R${FR}:R="", "", IFNA(XLOOKUP(${lookupKey}, ${CAP}!C:C & ${CAP}!D:D, ${CAP}!E:E), 0)))`;
  sheet.getRange(`AF${FR}`).setFormula(f_Lead).setBackground(YELLOW);

  const f_MOQ = `=ARRAYFORMULA(IF(R${FR}:R="", "", IFNA(XLOOKUP(${lookupKey}, ${CAP}!C:C & ${CAP}!D:D, ${CAP}!G:G), 1)))`;
  sheet.getRange(`AH${FR}`).setFormula(f_MOQ).setBackground(YELLOW);

  // --- DROPDOWNS ---
  const refSheet = sheet.getParent().getSheetByName(SOURCING_CONSTANTS.REF_MASTER);
  if (refSheet) {
    const rule = SpreadsheetApp.newDataValidation().requireValueInRange(refSheet.getRange("B2:B")).setAllowInvalid(true).build();
    sheet.getRange(FR, 28, sheet.getMaxRows() - FR, 1).setDataValidation(rule);
  }
}

function _escapeCsv(cellData) {
  if (cellData === null || cellData === undefined) return "";
  const str = String(cellData);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/* =========================================================================
 * 4. 📦 PHASE 5: MATERIAL SCOPE HELPERS (D1, D3)
 * ========================================================================= */

/**
 * Queries BOM_Data for distinct MAIN_GROUP values available to a PIC.
 * MASTER sees all groups; PICs see only their assigned materials.
 * @param {string} picName - Canonical PIC name (e.g., 'Ngàn', 'MASTER')
 * @returns {Array<{MAIN_GROUP: string, material_count: number}>}
 */
function _getAvailableMaterialGroups(picName) {
  const config = ISC_SCM_Core_Lib.getCoreConfig();
  const sql = `
    SELECT DISTINCT MAIN_GROUP, COUNT(*) as material_count
    FROM \`${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}.BOM_Data\`
    WHERE BOM_STATUS = 'ACTIVE'
      ${picName !== 'MASTER' ? `AND PIC = '${picName}'` : ''}
    GROUP BY MAIN_GROUP
    ORDER BY material_count DESC
  `;
  return ISC_SCM_Core_Lib.runReadQueryMapped(sql);
}

/**
 * Returns the recommended shortage calculation method for a material group.
 * Groups with WIP gap (material issued before completion) → ISSUANCE.
 * All other groups → COMPLETION (standard).
 * @param {string} mainGroup - Material group name (e.g., 'Chì', 'Bao bì')
 * @returns {'ISSUANCE'|'COMPLETION'}
 */
function _getSuggestedMethod(mainGroup) {
  // Groups where Issuance method is recommended (WIP gap materials)
  // Expand this list as business logic evolves
  const issuanceGroups = ['Chì'];
  return issuanceGroups.includes(mainGroup) ? 'ISSUANCE' : 'COMPLETION';
}

/* =========================================================================
 * 5. 📊 PHASE 5.1: SESSION DASHBOARD WRITER
 * ========================================================================= */

/**
 * Writes a rich session dashboard to Rows 1-4 with per-cell metrics.
 * Called after data is loaded to populate session metadata and analytics.
 */
function _writeSessionDashboard(sheet, picName, mainGroup, method, queryRows) {
  const isMaster = (method === 'MASTER');
  const scopeLabel = mainGroup === 'ALL' ? 'All Groups' : mainGroup;
  const methodLabel = isMaster ? 'Cross-Method Dashboard' : method;
  const timestamp = new Date().toLocaleString('en-GB', {timeZone: 'Asia/Ho_Chi_Minh'});
  const itemCount = queryRows.length;

  // Compute method analysis stats from query data
  let phantomCount = 0, divergentCount = 0, totalShortage = 0, hasIssuanceCount = 0;
  queryRows.forEach(row => {
    const nsc = Number(row.NET_SHORTAGE_COMPLETION) || 0;
    const nsi = Number(row.NET_SHORTAGE_ISSUANCE) || 0;
    const nsq = Number(row.NET_SHORTAGE_QTY) || 0;
    totalShortage += isMaster ? nsq : (method === 'ISSUANCE' ? nsi : nsc);
    if (nsi <= 0 && nsc > 0) phantomCount++;
    else if (nsc > 0 && Math.abs(nsc - nsi) / Math.max(nsc, 0.001) > 0.20) divergentCount++;
    if (row.HAS_ISSUANCE_DATA === true || row.HAS_ISSUANCE_DATA === 'true') hasIssuanceCount++;
  });
  const alignedCount = itemCount - phantomCount - divergentCount;

  // Row 1: Title Banner
  const totalCols = sheet.getLastColumn() || 37;
  const titleRange = sheet.getRange(1, 1, 1, totalCols);
  titleRange.merge()
    .setValue('📊 SOURCING SESSION DASHBOARD')
    .setFontSize(12).setFontWeight('bold')
    .setFontColor('#ffffff').setBackground('#1a73e8')
    .setHorizontalAlignment('left').setVerticalAlignment('middle');
  sheet.setRowHeight(1, 30);

  // Row 2: Session Identity (label-value pairs in separate cells)
  const row2Data = [
    '👤 PIC', picName, '',
    '📦 GROUP', scopeLabel, '',
    '🔬 METHOD', methodLabel, '',
    '📋 ITEMS', itemCount, '',
    '⏱️ LOADED', timestamp
  ];
  sheet.getRange(2, 1, 1, row2Data.length).setValues([row2Data]);

  // Row 3: Method Analysis (label-value pairs)
  const row3Data = [
    '⚠️ PHANTOMS', phantomCount, '',
    '🟡 DIVERGENT', divergentCount, '',
    '🟢 ALIGNED', alignedCount, '',
    '📊 TOTAL SHORTAGE', Math.round(totalShortage).toLocaleString(), '',
    '📌 HAS ISSUANCE', hasIssuanceCount
  ];
  sheet.getRange(3, 1, 1, row3Data.length).setValues([row3Data]);

  // Style: Dashboard background
  sheet.getRange(2, 1, 2, totalCols).setBackground('#e8f0fe');

  // Style: Labels (odd positions) bold grey, Values (even positions) bold blue
  [1, 4, 7, 10, 13].forEach(col => {
    sheet.getRange(2, col).setFontWeight('bold').setFontSize(9).setFontColor('#5f6368');
    sheet.getRange(3, col).setFontWeight('bold').setFontSize(9).setFontColor('#5f6368');
  });
  [2, 5, 8, 11, 14].forEach(col => {
    sheet.getRange(2, col).setFontWeight('bold').setFontSize(10).setFontColor('#1a73e8');
    sheet.getRange(3, col).setFontWeight('bold').setFontSize(10).setFontColor('#1a73e8');
  });

  // Highlight phantoms in red if > 0
  if (phantomCount > 0) {
    sheet.getRange(3, 2).setFontColor('#d93025');
  }

  // Wrap text in dashboard area
  sheet.getRange(2, 1, 2, 14).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);

  // Row 4: Separator line
  sheet.getRange(4, 1, 1, totalCols).setBackground('#e0e0e0');
  sheet.setRowHeight(4, 4);
}

function _getDynamicZoneConfig(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) throw new Error("Sheet is empty.");
  // Phase 5.1: Headers are at Row 5 (was Row 1)
  const headers = sheet.getRange(5, 1, 1, lastCol).getValues()[0];
  const rawStartIdx = headers.indexOf('RAW_START');
  const rawEndIdx = headers.indexOf('RAW_END');

  if (rawStartIdx === -1 || rawEndIdx === -1) throw new Error("Critical Error: Missing 'RAW_START' or 'RAW_END' pillars.");
  return {
    startCol: rawStartIdx + 2, 
    width: rawEndIdx - rawStartIdx - 1
  };
}

function _clearZoneB(sheet, config) {
  const lastRow = sheet.getMaxRows();
  // Phase 5.1: Data starts at row 7 (was row 3)
  if (lastRow > 6) {
    sheet.getRange(7, config.startCol, lastRow - 6, config.width).clearContent();
  }
}

/* =========================================================================
 * PHASE 2: AGGREGATED BOM SOURCING — SESSION ROUTING & UPLOAD
 * -------------------------------------------------------------------------
 * All code below is new in Phase 2. It does NOT modify or call any of the
 * legacy VPO-level functions above. Both pipelines coexist independently.
 * ========================================================================= */

/**
 * Session routing modes — read from dashboard mode control cell (Row 2, Col 5)
 * on the main dashboard sheet, or persisted per session sheet.
 */
const AGG_ROUTING = {
  MODE_CELL_SHEET: 'Dashboard',   // The sheet that holds the master mode control
  MODE_CELL:       'E2',          // Cell address for mode control value
  MODES: {
    AUTO:            'AUTO',
    AGGREGATED_ONLY: 'AGGREGATED_ONLY',
    VPO_LEVEL_ONLY:  'VPO_LEVEL_ONLY'
  },
  AGG_VIEW_NAME:    'Sourcing_Feed_Aggregated_VIEW',
  AGG_SHEET_SUFFIX: '_Assign_Sourcing_Aggregated'
};

/**
 * Reads the session routing mode from the Dashboard control cell.
 * Falls back to AUTO if the cell is blank or unrecognised.
 * @returns {'AUTO'|'AGGREGATED_ONLY'|'VPO_LEVEL_ONLY'}
 */
function _readRoutingMode() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const dashSheet = ss.getSheetByName(AGG_ROUTING.MODE_CELL_SHEET);
    if (!dashSheet) return AGG_ROUTING.MODES.AUTO;
    const raw = String(dashSheet.getRange(AGG_ROUTING.MODE_CELL).getValue()).trim().toUpperCase();
    return Object.values(AGG_ROUTING.MODES).includes(raw) ? raw : AGG_ROUTING.MODES.AUTO;
  } catch (e) {
    return AGG_ROUTING.MODES.AUTO;
  }
}

/* =========================================================================
 * AGGREGATED SESSION LOADER
 * ========================================================================= */

/**
 * Loads PUBLIC BOM rows from Sourcing_Feed_Aggregated_VIEW into the aggregated
 * session sheet. Computes SAVINGS_VS_LEGACY at load time (V7 §4.4).
 *
 * @param {Sheet}  aggSheet   The aggregated session sheet
 * @param {string} picName    Canonical PIC name
 * @param {string} mainGroup  'ALL' or specific group name
 * @param {string} mode       Routing mode ('AUTO', 'AGGREGATED_ONLY', etc.)
 */
function _loadAggregatedPRsToSheet(aggSheet, picName, mainGroup, mode) {
  const coreConfig = ISC_SCM_Core_Lib.getCoreConfig();
  const isMaster   = (picName === 'MASTER');

  // — Build WHERE clause ——————————————————————————————————————————————————
  let where = `1=1`;
  if (!isMaster) {
    where += ` AND PIC = '${picName}'`;
  }
  if (mainGroup && mainGroup !== 'ALL') {
    where += ` AND MAIN_GROUP = '${mainGroup}'`;
  }

  const sql = `
    SELECT
      BOM_UPDATE,
      BOM_DESCRIPTION,
      MAIN_GROUP,
      PIC,
      VPO_COUNT,
      VPO_COMPONENTS_JSON,
      DRAFT_PR_ID_AGG,
      NET_SHORTAGE_QTY_AGG,
      BOM_SHORTAGE_STATUS,
      EARLIEST_REQUESTED_DELIVERY_DATE,
      ASSIGNED_SUPPLIER_NAME,
      KNOWN_CAPACITY_OPTIONS
    FROM \`${coreConfig.connection.PROJECT_ID}.${coreConfig.connection.DATASET_ID}.${AGG_ROUTING.AGG_VIEW_NAME}\`
    WHERE ${where}
    ORDER BY EARLIEST_REQUESTED_DELIVERY_DATE ASC, BOM_UPDATE ASC
  `;

  const rows = ISC_SCM_Core_Lib.runReadQueryMapped(sql);

  if (!rows || rows.length === 0) {
    Logger.log(`[AGG_LOADER] No aggregated rows found for PIC=${picName}, Group=${mainGroup}`);
    SpreadsheetApp.getActiveSpreadsheet().toast(
      `No PUBLIC BOM items found for "${picName}".`, 'Aggregated Sourcing');
    return;
  }

  Logger.log(`[AGG_LOADER] Loaded ${rows.length} aggregated BOM rows for ${picName}`);

  // — Compute SAVINGS_VS_LEGACY at load time (V7 §4.4) ——————————————————
  // Load-time tolerance = 10% (default, since planner hasn't entered yet)
  const LOAD_TIME_TOLERANCE = 10;

  // — Write Zone B data —————————————————————————————————————————————————
  const DR = AGG_COL.DATA_START;  // 7
  const writeData = rows.map(row => {
    const spq         = Number(row.SPQ_REF) || 1;
    const qAgg        = Number(row.NET_SHORTAGE_QTY_AGG) || 0;
    const finalQBom   = Math.ceil((qAgg * (1 + LOAD_TIME_TOLERANCE / 100)) / spq) * spq;

    // Compute LEGACY_TOTAL: sum of per-VPO CEILING(max(0,qty)*(1+10%), SPQ)
    let legacyTotal = 0;
    try {
      const comps = JSON.parse(row.VPO_COMPONENTS_JSON || '[]');
      comps.forEach(c => {
        const qty = Math.max(0, Number(c.net_shortage_qty) || 0);
        legacyTotal += Math.ceil((qty * 1.10) / spq) * spq;
      });
    } catch (e) {
      Logger.log(`[AGG_LOADER] JSON parse error for BOM ${row.BOM_UPDATE}: ${e.message}`);
    }

    const savings = legacyTotal - finalQBom;
    if (savings < 0) {
      Logger.log(`[AGG_LOADER] Savings anomaly on BOM row ${row.BOM_UPDATE}: savings=${savings} — investigate`);
    }

    // Columns map to Zone B (18=R through 37=AK), written as array
    // Order: R(BOM_CTX), S(BOM_DESC), T(MAIN_GROUP), U(VPO_COUNT), V(JSON), W(NET_AGG),
    //        X(STATUS), Y(blank=planner), Z(blank=formula), AA(blank=planner), AB(supplier),
    //        AC(capacity), AD(blank=formula), AE(blank=planner), AF(blank=formula),
    //        AG(blank=planner), AH(blank=formula), AI(blank=planner), AJ(DRAFT_PR_ID_AGG), AK(savings)
    return [
      row.BOM_UPDATE           || '',   // R (18) BOM_CTX
      row.BOM_DESCRIPTION      || '',   // S (19)
      row.MAIN_GROUP           || '',   // T (20)
      `${row.VPO_COUNT} VPOs included`, // U (21)
      row.VPO_COMPONENTS_JSON  || '[]', // V (22) hidden JSON
      Number(row.NET_SHORTAGE_QTY_AGG) || 0,  // W (23)
      row.BOM_SHORTAGE_STATUS  || 'OK', // X (24)
      '',                               // Y (25) TOLERANCE_%_INPUT — planner fills
      '',                               // Z (26) TOLERANCE_%_EFFECTIVE — formula
      '',                               // AA (27) DATE_CODE — planner fills
      row.ASSIGNED_SUPPLIER_NAME || '', // AB (28)
      row.KNOWN_CAPACITY_OPTIONS || '', // AC (29)
      '',                               // AD (30) STANDARD_PRICE_REF — formula
      '',                               // AE (31) UNIT_PRICE_OVERRIDE — planner
      '',                               // AF (32) STANDARD_LEAD_TIME_REF — formula
      '',                               // AG (33) LEAD_TIME_OVERRIDE — planner
      '',                               // AH (34) SPQ_REF — formula
      '',                               // AI (35) MANUAL_Q_BOM_OVERRIDE — planner
      row.DRAFT_PR_ID_AGG      || '',   // AJ (36) hidden cross-validation
      savings                           // AK (37) SAVINGS_VS_LEGACY
    ];
  });

  // Write Zone B data (20 cols, from col 18 = R)
  aggSheet.getRange(DR, 18, writeData.length, 20).setValues(writeData);

  // Write EARLIEST_DELIVERY_DATE to Col N (Zone A — filled by script not formula)
  const deliveryDates = rows.map(row => [
    row.EARLIEST_REQUESTED_DELIVERY_DATE
      ? new Date(row.EARLIEST_REQUESTED_DELIVERY_DATE)
      : ''
  ]);
  aggSheet.getRange(DR, AGG_COL.EARLIEST_DELIVERY_DATE, deliveryDates.length, 1)
    .setValues(deliveryDates);

  // Write PIC to Col C (Zone A)
  const picData = rows.map(() => [picName]);
  aggSheet.getRange(DR, AGG_COL.PIC, picData.length, 1).setValues(picData);

  // — Update dashboard with session metrics ————————————————————————————
  const mismatchCount = rows.filter(r => r.BOM_SHORTAGE_STATUS === 'MISMATCH').length;
  const totalSavings  = writeData.reduce((sum, r) => sum + (Number(r[19]) || 0), 0);
  const timestamp     = new Date().toLocaleString('en-GB', {timeZone: 'Asia/Ho_Chi_Minh'});

  const row2 = [
    '👤 PIC', picName, '', '📦 MODE', mode, '', '📋 BOM ROWS', rows.length, '',
    '⚠️ MISMATCH', mismatchCount, '', '💰 TOTAL SAVINGS', Math.round(totalSavings).toLocaleString()
  ];
  aggSheet.getRange(2, 1, 1, row2.length).setValues([row2]);

  Logger.log(`[AGG_LOADER] Session loaded. Rows=${rows.length}, Mismatches=${mismatchCount}, TotalSavings=${totalSavings}`);
  SpreadsheetApp.getActiveSpreadsheet().toast(
    `✅ Loaded ${rows.length} PUBLIC BOM rows (${mismatchCount} MISMATCH, Savings: ${Math.round(totalSavings)})`,
    'Aggregated Sourcing');
}

/* =========================================================================
 * AGGREGATED EXPLODE UPLOAD — uploadAggregatedExplode()
 * V7 §5: Steps 1–9, all edge cases, hard errors, soft warnings
 * ========================================================================= */

/**
 * Upload handler for the Aggregated BOM session sheet.
 * "Explodes" each BOM row's Q_BOM back into per-VPO staging rows using
 * the Largest Remainder Method (LRM) — guarantees ∑Qᵢ = Q_BOM exactly.
 *
 * Called from the "Submit Sourcing" menu when active sheet is aggregated.
 */
function uploadAggregatedExplode() {
  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const sheet     = ss.getActiveSheet();
  const ui        = SpreadsheetApp.getUi();
  const userEmail = Session.getActiveUser().getEmail();

  // ── Guard: must be on an aggregated session sheet ──────────────────────
  if (!sheet.getName().endsWith(AGG_ROUTING.AGG_SHEET_SUFFIX)) {
    ui.alert('🛑 Stop',
      'Run this from an Aggregated session sheet (e.g., "Nga_Assign_Sourcing_Aggregated").',
      ui.ButtonSet.OK);
    return;
  }

  if (ui.alert('🚀 Submit Aggregated Sourcing?',
    'This will explode each BOM row into per-VPO staging records.\n\nProceed?',
    ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  try {
    const lastRow    = sheet.getLastRow();
    const DR         = AGG_COL.DATA_START;  // 7
    if (lastRow < DR) throw new Error('No data rows found.');

    const numRows    = lastRow - DR + 1;
    const numCols    = AGG_COL.TOTAL_COLS;
    const allValues  = sheet.getRange(DR, 1, numRows, numCols).getValues();

    // ── Pre-flight: filter eligible rows (SUPPLIER_CHECK === "TRUE") ─────
    const eligibleRows = allValues.filter(row => {
      return String(row[AGG_COL.SUPPLIER_CHECK - 1]).toUpperCase() === 'TRUE';
    });

    if (eligibleRows.length === 0) {
      ui.alert('⚠️ No eligible rows',
        'No rows have SUPPLIER_CHECK = TRUE.\nFill supplier name, date code, and verify Q_BOM ≥ 0.',
        ui.ButtonSet.OK);
      return;
    }

    Logger.log(`[AGG_UPLOAD] ${eligibleRows.length} eligible BOM rows found for explode.`);

    const allStagingRows = [];
    const timestamp = new Date().toISOString();

    for (let rowIdx = 0; rowIdx < eligibleRows.length; rowIdx++) {
      const row        = eligibleRows[rowIdx];
      const sheetRow   = DR + allValues.indexOf(row);  // actual row number for error messages

      // ── Step 1 — Extract Inputs ────────────────────────────────────────
      const Q_BOM      = Number(row[AGG_COL.FINAL_Q_BOM - 1]);
      const jsonStr    = String(row[AGG_COL.VPO_COMPONENTS_JSON - 1] || '').trim();
      const bomUpdate  = String(row[AGG_COL.BOM_UPDATE - 1] || '').trim();
      const supplierId = String(row[AGG_COL.SUPPLIER_ID - 1] || '').trim();
      const supplierNm = String(row[AGG_COL.ASSIGNED_SUPPLIER_NAME_MIRROR - 1] || '').trim();
      const finalPrice = Number(row[AGG_COL.FINAL_UNIT_PRICE - 1]) || 0;
      const pic        = String(row[AGG_COL.PIC - 1] || '').trim();
      const dateCode   = String(row[AGG_COL.DATE_CODE - 1] || '').trim();
      const netAgg     = Number(row[AGG_COL.NET_SHORTAGE_QTY_AGG - 1]) || 0;
      const bomStatus  = String(row[AGG_COL.BOM_SHORTAGE_STATUS - 1] || 'OK').trim();
      const draftPrIdAgg = String(row[AGG_COL.DRAFT_PR_ID_AGG - 1] || '').trim();

      // Hard guard: Q_BOM must be a non-negative number
      if (isNaN(Q_BOM) || Q_BOM < 0) {
        throw new Error(`Row ${sheetRow}: FINAL_Q_BOM is invalid (value: "${Q_BOM}"). Upload aborted.`);
      }

      // ── Step 2 — Parse & Validate JSON ────────────────────────────────
      let components;
      try {
        components = JSON.parse(jsonStr);
      } catch (e) {
        throw new Error(`Row ${sheetRow}: VPO_COMPONENTS_JSON is corrupted or truncated. Upload aborted.`);
      }
      if (!Array.isArray(components) || components.length === 0) {
        throw new Error(`Row ${sheetRow}: VPO_COMPONENTS_JSON parsed to empty array. Upload aborted.`);
      }

      // Validate required keys on every element
      const REQUIRED_KEYS = ['vpo', 'draft_pr_id', 'net_shortage_qty'];
      components.forEach((c, idx) => {
        REQUIRED_KEYS.forEach(key => {
          if (c[key] === undefined || c[key] === null || c[key] === '') {
            throw new Error(
              `Row ${sheetRow}, element ${idx}: Missing key '${key}'. Upload aborted.`);
          }
        });
        // Defensive fallback for missing delivery date (V7 Gate A mitigation)
        c.delivery_date = c.delivery_date || '9999-12-31';
      });

      // Cross-validate element count vs pipe-list
      const pipeCount = draftPrIdAgg ? draftPrIdAgg.split('|').length : 0;
      if (pipeCount > 0 && components.length !== pipeCount) {
        throw new Error(
          `Row ${sheetRow}: JSON element count (${components.length}) ≠ pipe-list count (${pipeCount}). Upload aborted.`);
      }

      // ── Step 3 — Compute Weights ───────────────────────────────────────
      const weights = components.map(c => Math.max(0, Number(c.net_shortage_qty) || 0));
      const W       = weights.reduce((sum, w) => sum + w, 0);

      // ── Soft Warnings ─────────────────────────────────────────────────
      // Warning 1: MISMATCH status + Q_BOM > 0
      if (bomStatus === 'MISMATCH' && Q_BOM > 0) {
        const ans = ui.alert('⚠️ BOM Shortage Mismatch',
          `Row ${sheetRow} (BOM: ${bomUpdate}): Aggregated total differs from M2 master.\n\n` +
          `NET_SHORTAGE_QTY_AGG vs BOM_TOTAL_SHORTAGE — investigate before confirming.\n\nProceed?`,
          ui.ButtonSet.YES_NO);
        if (ans !== ui.Button.YES) {
          Logger.log(`[AGG_UPLOAD] User aborted at MISMATCH warning for BOM ${bomUpdate}.`);
          return;
        }
      }

      // Warning 2: Q_BOM > 3× NET_SHORTAGE_QTY_AGG (200%+ above shortage)
      if (netAgg > 0 && Q_BOM > netAgg * 3.0) {
        const ans = ui.alert('⚠️ Large Order Quantity',
          `Row ${sheetRow} (BOM: ${bomUpdate}): Order quantity (${Q_BOM}) is >200% above shortage (${netAgg}).\n` +
          `This may indicate a manual override anomaly.\n\nProceed?`,
          ui.ButtonSet.YES_NO);
        if (ans !== ui.Button.YES) {
          Logger.log(`[AGG_UPLOAD] User aborted at 200%+ overorder warning for BOM ${bomUpdate}.`);
          return;
        }
      }

      // Warning 3: Zero-shortage override (W=0 and Q_BOM>0)
      if (W === 0 && Q_BOM > 0) {
        const ans = ui.alert('⚠️ Zero-Shortage Override',
          `Row ${sheetRow} (BOM: ${bomUpdate}): All underlying VPOs show zero shortage, ` +
          `but Q_BOM=${Q_BOM} is set.\n\nEntire quantity will be assigned to the VPO with ` +
          `the earliest delivery date.\n\nProceed?`,
          ui.ButtonSet.YES_NO);
        if (ans !== ui.Button.YES) {
          Logger.log(`[AGG_UPLOAD] User aborted at zero-shortage override warning for BOM ${bomUpdate}.`);
          return;
        }
      }

      // ── Step 4 — Four Edge Case Branches ──────────────────────────────
      let intBases;

      if (W > 0 && Q_BOM > 0) {
        // ── Step 5 — Fractional Slicing (Normal Path) ──────────────────
        const rawSlices = weights.map(w => (w / W) * Q_BOM);
        intBases        = rawSlices.map(s => Math.floor(s));
        const remainders = rawSlices.map((s, i) => s - intBases[i]);

        // ── Step 6 — Largest Remainder Resolution ───────────────────────
        const allocated = intBases.reduce((sum, q) => sum + q, 0);
        let delta       = Q_BOM - allocated;  // always ≥ 0, ≤ N-1

        // Sort: largest remainder first; tie → earliest delivery_date; tie → vpo ASC
        const sortedIdx = components.map((_, i) => i).sort((a, b) => {
          if (Math.abs(remainders[b] - remainders[a]) > 1e-9) return remainders[b] - remainders[a];
          const dateA = new Date(components[a].delivery_date);
          const dateB = new Date(components[b].delivery_date);
          if (dateA - dateB !== 0) return dateA - dateB;
          return String(components[a].vpo).localeCompare(String(components[b].vpo));
        });

        for (let k = 0; k < delta; k++) {
          intBases[sortedIdx[k]] += 1;
        }
        // INVARIANT: intBases.reduce((s,q)=>s+q,0) === Q_BOM  ✓
        // INVARIANT: all intBases[i] >= 0                       ✓

      } else if (W > 0 && Q_BOM === 0) {
        // Planner chose not to order — clear all drafts
        intBases = components.map(() => 0);

      } else if (W === 0 && Q_BOM === 0) {
        // Nothing to order
        intBases = components.map(() => 0);

      } else {
        // W=0, Q_BOM>0 — manual override on zero-shortage BOM
        // Assign entire Q_BOM to VPO with earliest delivery_date (tie: vpo ASC)
        intBases = components.map(() => 0);
        const targetIdx = components.reduce((bestIdx, c, i) => {
          const dateI    = new Date(c.delivery_date);
          const dateBest = new Date(components[bestIdx].delivery_date);
          if (dateI < dateBest) return i;
          if (dateI > dateBest) return bestIdx;
          return String(c.vpo).localeCompare(String(components[bestIdx].vpo)) < 0 ? i : bestIdx;
        }, 0);
        intBases[targetIdx] = Q_BOM;
        Logger.log(`[AGG_UPLOAD] Zero-shortage override: BOM=${bomUpdate}, Q_BOM=${Q_BOM} → VPO=${components[targetIdx].vpo}`);
      }

      // ── Step 7 — Construct Staging Rows ───────────────────────────────
      components.forEach((c, i) => {
        // Format delivery_date to YYYY-MM-DD
        let formattedDate = '';
        try {
          formattedDate = Utilities.formatDate(
            new Date(c.delivery_date), Session.getScriptTimeZone(), 'yyyy-MM-dd');
        } catch (e) {
          formattedDate = String(c.delivery_date);
        }

        allStagingRows.push({
          PR_STAGING_ID:            c.draft_pr_id,        // per-VPO, not BOM-level
          BOM_UPDATE:               bomUpdate,
          SUPPLIER_ID:              supplierId,
          SUPPLIER_NAME:            supplierNm,
          QTY_TO_APPROVE:           intBases[i],           // Qᵢ (integer, ≥ 0)
          FULFILLMENT_MODE:         'PUBLIC',
          FINAL_UNIT_PRICE:         finalPrice,
          REQUESTED_DELIVERY_DATE:  formattedDate,         // per-VPO, not BOM-level Col N
          VPO:                      c.vpo,
          VALIDATION_STATUS:        'PENDING',
          VALIDATION_LOG:           'OK',
          PIC:                      pic,
          DATE_CODE:                dateCode,
          UPDATED_BY:               userEmail,
          UPDATED_AT:               timestamp
        });
      });

      // Log per-BOM explode result
      Logger.log(`[AGG_UPLOAD] BOM=${bomUpdate}, Q_BOM=${Q_BOM}, N_VPOs=${components.length}, sum_Qi=${intBases.reduce((s,q)=>s+q,0)}`);
    }

    // ── Step 8 — Compile CSV and Batch Upload ──────────────────────────
    const csvHeader = 'PR_STAGING_ID,BOM_UPDATE,SUPPLIER_ID,SUPPLIER_NAME,QTY_TO_APPROVE,' +
      'FULFILLMENT_MODE,FINAL_UNIT_PRICE,REQUESTED_DELIVERY_DATE,VPO,' +
      'VALIDATION_STATUS,VALIDATION_LOG,PIC,DATE_CODE,UPDATED_BY,UPDATED_AT';

    const csvRows = allStagingRows.map(r => [
      _escapeCsv(r.PR_STAGING_ID),
      _escapeCsv(r.BOM_UPDATE),
      _escapeCsv(r.SUPPLIER_ID),
      _escapeCsv(r.SUPPLIER_NAME),
      Number(r.QTY_TO_APPROVE) || 0,
      'PUBLIC',
      Number(r.FINAL_UNIT_PRICE) || 0,
      r.REQUESTED_DELIVERY_DATE,
      _escapeCsv(r.VPO),
      'PENDING',
      'OK',
      _escapeCsv(r.PIC),
      _escapeCsv(r.DATE_CODE),
      _escapeCsv(r.UPDATED_BY),
      r.UPDATED_AT
    ].join(','));

    const finalCsv = csvHeader + '\n' + csvRows.join('\n');

    Logger.log(`[AGG_UPLOAD] Writing ${allStagingRows.length} staging rows across ${eligibleRows.length} BOM(s).`);
    ISC_SCM_Core_Lib.loadCsvData('PR_Staging', finalCsv, 'WRITE_APPEND');

    // ── Step 9 — Invoke Merge SP (ONCE per batch, NOT once per BOM row) ──
    const config   = ISC_SCM_Core_Lib.getCoreConfig();
    const spQuery  = `CALL \`${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}.SP_M3_MERGE_PR_DECISIONS\`()`;
    ISC_SCM_Core_Lib.runWriteQuery(spQuery);

    Logger.log(`[AGG_UPLOAD] SP_M3_MERGE_PR_DECISIONS invoked. Upload complete.`);
    ss.toast(
      `🚀 Uploaded ${allStagingRows.length} VPO-level records from ${eligibleRows.length} BOM rows.`,
      'Aggregated Sourcing');

  } catch (e) {
    ISC_SCM_Core_Lib.logError('AGG_UPLOAD_FAIL', e);
    ui.alert('❌ Upload Failed', e.message, ui.ButtonSet.OK);
  }
}