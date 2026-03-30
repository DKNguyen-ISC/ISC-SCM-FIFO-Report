/* -------------------------------------------------------------------------
 * FILE: ISC_Module_M3/M3_Consolidation_Main.gs
 * DESCRIPTION: Logic Controller for Smart Cart v3.3 (Session-Based Workspace).
 * IMPLEMENTS: 
 * - Full Name Identity
 * - SQL Power Sort (6 Levels)
 * - Session Continuity (Smart Leftover Handling)
 * - Aggressive Cleanup (Preserves Pillars)
 * ------------------------------------------------------------------------- */

const M3_LOGIC_CONSTANTS = {
  TEMPLATE_NAME: 'M3_Shopping_Cart_Template',
  SESSION_SUFFIX: '_Shopping_Cart', // e.g., "Nga_Shopping_Cart"
  
  // Header/Data Locations (Must match Template Builder v3.1)
  HEADER_ROW: 8,
  DATA_START_ROW: 9,
  
  // Dashboard Cells (Col D)
  CELL_PIC_NAME: 'D2',
  CELL_TIMESTAMP: 'D3',
  CELL_DATE_OVERRIDE: 'D4'
  // Valid PICs removed — Phase 2: use ISC_SCM_Core_Lib.resolvePicIdentity()
};

/**
 * 🛒 MENU CREATOR
 */
function createConsolidationMenu() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🛍️ PO Consolidation')
    .addItem('📥 Load Active Workload (Start Session)', 'loadShoppingCart')
    .addItem('🚀 Generate Purchase Order (Finish Session)', 'executeConsolidation')
    .addSeparator()
    .addItem('🛠️ Reset Master Template', 'buildConsolidationTemplate')
    .addToUi();
}

/**
 * 📥 LOAD SHOPPING CART (The Session Factory)
 * 1. Asks for Name.
 * 2. Clones Template.
 * 3. Injects Data (Sorted & Auto-Table).
 */
function loadShoppingCart() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  // 1. Full Name Prompt — Phase 2: Uses Identity_Registry for accent-insensitive resolution
  const promptMsg = `
    ENTER YOUR NAME TO START:
    (Options: ${ISC_SCM_Core_Lib.getValidPicNames()})
    
    Type 'MASTER' to load everything.
  `;
  
  const response = ui.prompt("Start New Session", promptMsg, ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  
  const inputName = response.getResponseText().trim();
  
  // Phase 2: accent-insensitive + case-insensitive resolution
  const matchedPic = ISC_SCM_Core_Lib.resolvePicIdentity(inputName);
  
  if (!matchedPic) {
    ui.alert("❌ Invalid Name", `Please enter one of the following:\n${ISC_SCM_Core_Lib.getValidPicNames()}`, ui.ButtonSet.OK);
    return;
  }

  // 2. Session Management (Delete Old -> Clone New)
  const sessionName = `${matchedPic}${M3_LOGIC_CONSTANTS.SESSION_SUFFIX}`;
  const template = ss.getSheetByName(M3_LOGIC_CONSTANTS.TEMPLATE_NAME);
  
  if (!template) {
    ui.alert("❌ System Error", "Master Template not found. Run 'Reset Master Template' first.", ui.ButtonSet.OK);
    return;
  }

  // Delete existing session (Fresh Start)
  const oldSession = ss.getSheetByName(sessionName);
  if (oldSession) ss.deleteSheet(oldSession);

  // Clone & Rename
  const sessionSheet = template.copyTo(ss).setName(sessionName);
  sessionSheet.activate(); 
  sessionSheet.setTabColor(null); 
  
  // Unlock Completely
  const protections = sessionSheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  protections.forEach(p => p.remove());

  // 3. Update Dashboard (Col D)
  sessionSheet.getRange(M3_LOGIC_CONSTANTS.CELL_PIC_NAME).setValue(matchedPic).setFontStyle("normal");
  sessionSheet.getRange(M3_LOGIC_CONSTANTS.CELL_TIMESTAMP).setValue(new Date());

  // 4. Data Injection
  _injectSessionData(sessionSheet, matchedPic);
  
  ss.toast(`Session '${sessionName}' started.`, "Ready");
}

/**
 * 💉 HELPER: Inject Data into Session Sheet
 */
function _injectSessionData(sheet, picName) {
  const config = ISC_SCM_Core_Lib.getCoreConfig();
  
  // A. Construct SQL with Verbose Timestamp
  // Format: "Friday, 26-Dec-2025 at 10:46:06 PM"
  let sql = `
    SELECT 
      * REPLACE (
        FORMAT_TIMESTAMP('%A, %d-%b-%Y at %I:%M:%S %p', UPDATED_AT) AS UPDATED_AT
      )
    FROM \`${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}.PR_Final\`
    WHERE CONSOLIDATION_STATUS = 'OPEN'
  `;
  
  // Apply PIC Filter (Unless MASTER)
  if (picName !== "MASTER") {
    sql += ` AND PIC = '${picName}'`;
  }
  
  // B. SQL POWER SORT (6-Level Hierarchy)
  sql += ` ORDER BY SUPPLIER_NAME, BOM_UPDATE, PIC, FULFILLMENT_MODE, VPO, REQUESTED_DELIVERY_DATE ASC`;

  // C. Run Query
  const rows = ISC_SCM_Core_Lib.runReadQueryMapped(sql);
  
  if (!rows || rows.length === 0) {
    sheet.getRange(M3_LOGIC_CONSTANTS.DATA_START_ROW, 1).setValue("(No Open Items found for this user)");
    return;
  }

  // D. Map to Grid
  const headers = sheet.getRange(M3_LOGIC_CONSTANTS.HEADER_ROW, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  const grid = rows.map(row => {
    return headers.map(headerName => {
      if (headerName === 'RAW_START' || headerName === 'RAW_END') return null;
      if (headerName === 'INCLUDE_SELECT') return false; 
      if (headerName === 'VALIDATION_STATUS') return null; // Reserved for formula
      return row[headerName] !== undefined ? row[headerName] : "";
    });
  });

  // E. Write to Sheet
  const dataRange = sheet.getRange(M3_LOGIC_CONSTANTS.DATA_START_ROW, 1, grid.length, grid[0].length);
  dataRange.setValues(grid);

  // F. Restore Logic (Checkboxes, Filters, Formulas)
  _restoreSmartLogic(sheet, headers, grid.length);
}

/**
 * 🔧 HELPER: Restore UI Logic
 * Adds Checkboxes, Creates Filter Table, Injects MAP Formula.
 */
function _restoreSmartLogic(sheet, headers, rowCount) {
  const map = _getHeaderMap(headers);
  const startRow = M3_LOGIC_CONSTANTS.DATA_START_ROW;

  // 1. Dynamic Checkboxes
  if (map.has('INCLUDE_SELECT')) {
    const colIdx = map.get('INCLUDE_SELECT') + 1;
    sheet.getRange(startRow, colIdx, rowCount, 1).insertCheckboxes();
  }

  // 2. Auto-Create Filter (Table Mode)
  // Check if filter exists, if not create one
  if (sheet.getFilter() === null) {
    const fullRange = sheet.getRange(
      M3_LOGIC_CONSTANTS.HEADER_ROW, 
      1, 
      sheet.getMaxRows() - M3_LOGIC_CONSTANTS.HEADER_ROW + 1, 
      headers.length
    );
    fullRange.createFilter();
  }

  // 3. Inject Validation Formula (MAP)
  // Yellow background + Formula for logic
  if (map.has('VALIDATION_STATUS') && map.has('INCLUDE_SELECT')) {
    const validColIdx = map.get('VALIDATION_STATUS') + 1;
    const checkColLetter = _colIndexToLetter(map.get('INCLUDE_SELECT') + 1);
    
    // Formula: =MAP(Range, LAMBDA(x, IF(x=TRUE, "Ready", "-")))
    const formula = `
      =MAP(${checkColLetter}${startRow}:${checkColLetter}, 
        LAMBDA(sel, IF(sel=TRUE, "Ready", "-"))
      )
    `;
    
    const formulaCell = sheet.getRange(startRow, validColIdx);
    formulaCell.setFormula(formula.trim());
    formulaCell.setBackground('#ffe599'); // Ensure Yellow
  }
}

/**
 * 🚀 EXECUTE CONSOLIDATION (The Disposer with Continuity)
 * Handles "Leftover Items" logic by filtering strictly for valid IDs.
 */
function executeConsolidation() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const ui = SpreadsheetApp.getUi();

  // 1. Context Validation
  if (!sheet.getName().endsWith(M3_LOGIC_CONSTANTS.SESSION_SUFFIX) || 
       sheet.getName() === M3_LOGIC_CONSTANTS.TEMPLATE_NAME) {
    ui.alert("⚠️ Invalid Context", "Please run this command from your active 'Shopping Cart' session sheet.", ui.ButtonSet.OK);
    return;
  }

  // 2. Read Headers & Data
  const headers = sheet.getRange(M3_LOGIC_CONSTANTS.HEADER_ROW, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = _getHeaderMap(headers);
  
  if (!map.has('INCLUDE_SELECT') || !map.has('PR_FINAL_ID') || !map.has('SUPPLIER_ID') || !map.has('FULFILLMENT_MODE')) {
    ui.alert("❌ Sheet Structure Error. Critical columns missing.");
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < M3_LOGIC_CONSTANTS.DATA_START_ROW) {
    ui.alert("⚠️ No data found to process.");
    return;
  }

  // Read ALL data (Row 9 to Bottom)
  const allData = sheet.getRange(
    M3_LOGIC_CONSTANTS.DATA_START_ROW, 
    1, 
    lastRow - M3_LOGIC_CONSTANTS.DATA_START_ROW + 1, 
    headers.length
  ).getValues();

  // 3. Separate Selected vs Remaining (Logic Fix: Exclude Blanks)
  const selectedItems = [];
  const remainingRows = []; 
  
  const idxSelect = map.get('INCLUDE_SELECT');
  const idxId = map.get('PR_FINAL_ID');
  const idxSupplier = map.get('SUPPLIER_ID');
  const idxBatch = map.get('FULFILLMENT_MODE');

  const supplierSet = new Set();
  const batchModeSet = new Set();

  allData.forEach(row => {
    const id = row[idxId];
    // ONLY process rows that actually have an ID (ignore blank bottom rows)
    if (id && id !== "") {
      if (row[idxSelect] === true) {
        // Selected for PO
        selectedItems.push(`'${id}'`); 
        supplierSet.add(row[idxSupplier]);
        batchModeSet.add(row[idxBatch]);
      } else {
        // Unselected -> Keep for later
        remainingRows.push(row);
      }
    }
  });

  if (selectedItems.length === 0) {
    ui.alert("⚠️ No items selected.");
    return;
  }

  // 4. Validation Checks
  if (supplierSet.size > 1) {
    ui.alert("❌ Multi-Supplier Error", "You selected items from multiple suppliers.\nPlease select only ONE supplier.", ui.ButtonSet.OK);
    return;
  }
  if (batchModeSet.size > 1) {
    ui.alert("❌ Mixed Batch Mode", "You selected both PUBLIC and PRIVATE items.\nPlease select only one type.", ui.ButtonSet.OK);
    return;
  }

  // 5. Read Date Override (Cell D4)
  const rawDate = sheet.getRange(M3_LOGIC_CONSTANTS.CELL_DATE_OVERRIDE).getValue();
  let dateParam = "NULL";
  if (rawDate instanceof Date) {
    const yyyy = rawDate.getFullYear();
    const mm = String(rawDate.getMonth() + 1).padStart(2, '0');
    const dd = String(rawDate.getDate()).padStart(2, '0');
    dateParam = `'${yyyy}-${mm}-${dd}'`;
  }

  // 6. Confirm & Execute
  const supplierId = [...supplierSet][0];
  const confirm = ui.alert(
    "Confirm Generation", 
    `Supplier: ${supplierId}\nItems: ${selectedItems.length}\nBatch: ${[...batchModeSet][0]}\nDate: ${dateParam === "NULL" ? "Auto" : dateParam}\n\nProceed?`,
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) return;

  const config = ISC_SCM_Core_Lib.getCoreConfig();
  const userEmail = Session.getActiveUser().getEmail();
  
  const sql = `
    CALL \`${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}.SP_M3_CONSOLIDATE_BATCH\`(
      [${selectedItems.join(",")}], 
      '${supplierId}', 
      ${dateParam}, 
      '${userEmail}'
    )
  `;

  try {
    const result = ISC_SCM_Core_Lib.runReadQueryMapped(sql);
    
    if (result && result.length > 0) {
      const poNum = result[0].GENERATED_PO || "Unknown";
      
      // 7. SESSION CONTINUITY LOGIC
      if (remainingRows.length === 0) {
        // Case A: Cart Empty -> Delete Session
        ui.alert("✅ Success", `Purchase Order ${poNum} created.\n\nAll items processed. Session closed.`, ui.ButtonSet.OK);
        ss.deleteSheet(sheet);
      } else {
        // Case B: Items Left -> Instant Repopulate
        ui.alert("✅ Success", `Purchase Order ${poNum} created.\n\n${remainingRows.length} items remaining in cart.`, ui.ButtonSet.OK);
        
        // 1. Aggressive Cleanup (Row 9 to Bottom)
        // clearContent() preserves Backgrounds (Pillars/Zones) but removes Data & Checkboxes
        const maxRows = sheet.getMaxRows();
        const rowsToClear = maxRows - M3_LOGIC_CONSTANTS.DATA_START_ROW + 1;
        
        if (rowsToClear > 0) {
          sheet.getRange(M3_LOGIC_CONSTANTS.DATA_START_ROW, 1, rowsToClear, sheet.getLastColumn())
               .clearContent()
               .removeCheckboxes();
        }
        
        // 2. Write Remaining Rows (From Memory)
        sheet.getRange(M3_LOGIC_CONSTANTS.DATA_START_ROW, 1, remainingRows.length, headers.length)
             .setValues(remainingRows);
             
        // 3. Restore UI Logic (Checkboxes & Formulas)
        _restoreSmartLogic(sheet, headers, remainingRows.length);
      }
      
    } else {
      ui.alert("⚠️ Processed, but no PO Number returned.");
    }
  } catch (e) {
    ISC_SCM_Core_Lib.logError("M3_CONSOLIDATION_FAIL", e);
    ui.alert("❌ Error", e.message, ui.ButtonSet.OK);
  }
}

/**
 * 🧠 HELPER: Header Map
 */
function _getHeaderMap(headerArray) {
  const map = new Map();
  headerArray.forEach((name, index) => {
    map.set(name, index);
  });
  return map;
}

/**
 * 🧮 UTILITY: Column Index to Letter
 */
function _colIndexToLetter(column) {
  let temp, letter = '';
  while (column > 0) {
    temp = (column - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    column = (column - temp - 1) / 26;
  }
  return letter;
}