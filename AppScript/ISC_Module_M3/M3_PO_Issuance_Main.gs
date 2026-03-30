/* -------------------------------------------------------------------------
 * FILE: ISC_Module_M3/M3_PO_Issuance_Main.gs
 * DESCRIPTION: Logic Controller for PO Issuance (Atomic Transaction Version)
 * DEPENDENCIES: M3_PO_Issuance_SheetBuilder, ISC_SCM_Core_Lib
 * VERSION: 12.0 (Atomic, No Visual Grey-Out)
 * ------------------------------------------------------------------------- */

// ⚙️ CONFIGURATION
const M3_ISSUANCE_CONFIG = {
  // Master Template ID
  PO_TEMPLATE_ID: '1nJrbtJXFjB4cwOxNqwza63qVNsYvD8KDcOslMMVhtTs', 
  
  // Folder for saved POs
  TARGET_FOLDER_ID: '1MxV_-VriJEsVs90pRG4oaUOiOKVL8fbl', 

  // Database Tables
  TABLE_HEADER: 'PO_Header',
  TABLE_LINE: 'PO_Line',
  TABLE_BOM: 'BOM_Data',

  // Valid Users for Session
  VALID_PICS: ['Nga', 'Ngàn', 'Thắng', 'Phong', 'Phương', 'Khánh', 'Nam', 'MASTER']
};

/* =========================================================================
 * 1. 📂 MENU CREATOR
 * ========================================================================= */
function createIssuanceMenu() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('📝 PO Issuance')
    .addItem('📥 Start Issuance Session', 'startIssuanceSession')
    .addSeparator()
    .addItem('🔄 Refresh Session', 'refreshIssuanceSession')
    .addItem('🚀 Issue Selected POs', 'menu_issue_selected_pos')
    .addSeparator()
    .addItem('🛠️ Reset Master Template', 'buildIssuanceTemplate')
    .addToUi();
}

/* =========================================================================
 * 2. 🏭 SESSION FACTORY (Smart Session)
 * ========================================================================= */
function startIssuanceSession() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  // 1. Identify User
  const promptMsg = `ENTER YOUR NAME:\n(Options: ${M3_ISSUANCE_CONFIG.VALID_PICS.join(", ")})\nType 'MASTER' for all drafts.`;
  const response = ui.prompt("Start Issuance Session", promptMsg, ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  
  const inputName = response.getResponseText().trim();
  const matchedPic = M3_ISSUANCE_CONFIG.VALID_PICS.find(p => p.toLowerCase() === inputName.toLowerCase());
  
  if (!matchedPic) {
    ui.alert("❌ Invalid Name", "Please enter a valid authorized name.", ui.ButtonSet.OK);
    return;
  }

  // 2. Clone Template
  const template = ss.getSheetByName('M3_PO_Issuance_Template');
  if (!template) {
    ui.alert("❌ Error", "Master Template not found. Run 'Reset Master Template' first.", ui.ButtonSet.OK);
    return;
  }

  const sessionName = `${matchedPic}_PO_Issuance_Session`;
  const oldSession = ss.getSheetByName(sessionName);
  if (oldSession) ss.deleteSheet(oldSession);

  const sessionSheet = template.copyTo(ss).setName(sessionName);
  sessionSheet.activate();
  sessionSheet.setTabColor('#4285F4'); 
  
  const protections = sessionSheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  protections.forEach(p => p.remove());

  // 3. Load Data
  _loadSessionData(sessionSheet, matchedPic);
  
  ss.toast(`Session '${sessionName}' ready.`, "Success");
}

/**
 * 🔄 REFRESH SESSION
 * Reloads data for the current user without recreating the tab.
 */
function refreshIssuanceSession() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  
  if (!sheet.getName().includes("_PO_Issuance_Session")) {
    SpreadsheetApp.getUi().alert("Please run this on a Session Sheet.");
    return;
  }

  // Read User Name from Dashboard (C4)
  const picName = sheet.getRange("C4").getValue();
  if (!picName || picName === "") {
     SpreadsheetApp.getUi().alert("Could not identify Session Owner in Cell C4.");
     return;
  }

  _loadSessionData(sheet, picName);
  ss.toast("Session Refreshed. Issued items removed.", "Updated");
}

/**
 * 🛠️ LOAD SESSION DATA (Fixed: Protects Pillars & Banding)
 */
function _loadSessionData(sheet, picName) {
  const config = ISC_SCM_Core_Lib.getCoreConfig();
  const datasetPath = `${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}`;
  const currentUserEmail = Session.getEffectiveUser().getEmail();
  
  // PASS 1: FETCH HEADERS
  let whereClause = "WHERE PO_STATUS = 'DRAFT'";
  if (picName.toUpperCase() !== 'MASTER') {
    whereClause += ` AND CREATED_BY = '${currentUserEmail}'`;
  }

  const queryHeaders = `
    SELECT 
      PO_DOCUMENT_ID, CONSOLIDATION_BATCH_ID, SUPPLIER_ID, SUPPLIER_NAME, PO_NUMBER_REF,
      ORDER_DATE, TOTAL_AMOUNT, LINE_COUNT, PO_DUE_DATE, PO_STATUS, FILELINK, CREATED_BY,
      FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', CREATED_AT, 'Asia/Ho_Chi_Minh') as CREATED_AT,
      FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', ISSUED_AT, 'Asia/Ho_Chi_Minh') as ISSUED_AT
    FROM \`${datasetPath}.${M3_ISSUANCE_CONFIG.TABLE_HEADER}\`
    ${whereClause}
    QUALIFY ROW_NUMBER() OVER (PARTITION BY PO_DOCUMENT_ID ORDER BY CREATED_AT DESC) = 1
    ORDER BY PO_DUE_DATE ASC
  `;
  
  const headers = ISC_SCM_Core_Lib.runReadQueryMapped(queryHeaders);

  // 🧹 SURGICAL CLEANUP (Protects Pillars at Col 15 & 17)
  const startRow = 9;
  const maxRows = sheet.getMaxRows();
  if (maxRows >= startRow) {
    const rowsToClear = maxRows - startRow + 1;
    
    // Clear Zone A (Cols 1-14)
    sheet.getRange(startRow, 1, rowsToClear, 14)
         .clearContent().clearNote().setBackground(null).setFontColor(null);
         
    // Clear Zone B (Col 16 ONLY) - Skipping Col 15 (Pillar)
    sheet.getRange(startRow, 16, rowsToClear, 1)
         .clearContent().removeCheckboxes().setBackground(null);
  }

  if (!headers || headers.length === 0) {
    sheet.getRange(startRow, 1).setValue("(No Draft POs found for this user)");
    return;
  }

  // PASS 2: FETCH LINES
  const poIds = headers.map(h => `'${h.PO_DOCUMENT_ID}'`).join(",");
  const queryLines = `
    SELECT 
      l.PO_DOCUMENT_ID, l.BOM_UPDATE,
      COALESCE(b.BOM_VIETNAMESE_DESCRIPTION, b.BOM_DESCRIPTION, 'No Desc') as ITEM_NAME,
      l.FULFILLMENT_MODE, l.ORDER_QTY, l.UNIT_PRICE, l.LINE_TOTAL,
      l.SYSTEM_SUGGESTED_REQUESTED_DATE, l.BUYER_REQUESTED_DATE, l.DATE_CODE
    FROM \`${datasetPath}.${M3_ISSUANCE_CONFIG.TABLE_LINE}\` l
    LEFT JOIN \`${datasetPath}.${M3_ISSUANCE_CONFIG.TABLE_BOM}\` b ON l.BOM_UPDATE = b.BOM_UPDATE
    WHERE l.PO_DOCUMENT_ID IN (${poIds})
    ORDER BY l.PO_DOCUMENT_ID, l.BOM_UPDATE
  `;

  const lines = ISC_SCM_Core_Lib.runReadQueryMapped(queryLines);

  // Build Notes Map
  const notesMap = new Map();
  const timeZone = Session.getScriptTimeZone();
  const fmtNum = (n) => n ? parseFloat(n).toLocaleString('en-US', {maximumFractionDigits: 2}) : "null";
  const fmtDate = (d) => {
    if (!d || d === "" || d === "null") return "null";
    const dateObj = new Date(d.value || d);
    return Utilities.formatDate(dateObj, timeZone, "dd-MMM-yyyy");
  };
  const valOrNull = (v) => (v === null || v === "" || v === undefined) ? "null" : v;

  lines.forEach(line => {
    if (!notesMap.has(line.PO_DOCUMENT_ID)) notesMap.set(line.PO_DOCUMENT_ID, []);
    let name = String(line.ITEM_NAME);
    if (name.length > 20) name = name.substring(0, 20) + "..";
    
    const rowStr = [
      valOrNull(line.BOM_UPDATE), name, valOrNull(line.FULFILLMENT_MODE),
      fmtNum(line.ORDER_QTY), fmtNum(line.UNIT_PRICE), fmtNum(line.LINE_TOTAL),
      fmtDate(line.SYSTEM_SUGGESTED_REQUESTED_DATE), fmtDate(line.BUYER_REQUESTED_DATE), valOrNull(line.DATE_CODE)
    ].join(" | ");
    notesMap.get(line.PO_DOCUMENT_ID).push(rowStr);
  });

  // Render Grid
  const gridData = headers.map(r => [
    r.PO_DOCUMENT_ID, r.CONSOLIDATION_BATCH_ID, r.SUPPLIER_ID, r.SUPPLIER_NAME, r.PO_NUMBER_REF,
    r.ORDER_DATE ? new Date(r.ORDER_DATE.value || r.ORDER_DATE) : null,
    parseFloat(r.TOTAL_AMOUNT), parseInt(r.LINE_COUNT),
    r.PO_DUE_DATE ? new Date(r.PO_DUE_DATE.value || r.PO_DUE_DATE) : null,
    r.PO_STATUS, r.FILELINK, r.CREATED_BY,
    r.CREATED_AT ? new Date(r.CREATED_AT) : null, r.ISSUED_AT ? new Date(r.ISSUED_AT) : null
  ]);

  const noteData = headers.map(r => {
    const items = notesMap.get(r.PO_DOCUMENT_ID);
    if (items && items.length > 0) {
      const headerStr = "BOM | NAME | MODE | QTY | PRICE | TOTAL | SYS_DATE | BUY_DATE | DC";
      return [`📦 ${items.length} ITEMS:\n${headerStr}\n${"-".repeat(60)}\n` + items.join("\n")];
    }
    return ["(No Items Found)"];
  });

  sheet.getRange(startRow, 1, gridData.length, 14).setValues(gridData);
  sheet.getRange(startRow, 16, gridData.length, 1).insertCheckboxes();
  sheet.getRange(startRow, 1, gridData.length, 1).setNotes(noteData);

  // Apply Banding (Safe Fix)
  const range = sheet.getRange(startRow, 1, gridData.length, 14);
  range.getBandings().forEach(b => b.remove()); 
  range.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);  
  sheet.getRange("C4").setValue(picName);
  sheet.getRange("C5").setValue(`VND (₫)`);
}

/* =========================================================================
 * 4. 🚀 ATOMIC ISSUANCE EXECUTION
 * ========================================================================= */
function menu_issue_selected_pos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const ui = SpreadsheetApp.getUi();
  
  if (!sheet.getName().includes("_PO_Issuance_Session")) {
    ui.alert("⚠️ Wrong Sheet", "Please run this from a valid PO Issuance Session sheet.", ui.ButtonSet.OK);
    return;
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 9) return;
  
  const range = sheet.getRange(9, 1, lastRow - 8, 16); 
  const values = range.getValues();
  let processedCount = 0;

  for (let i = 0; i < values.length; i++) {
    const rowData = values[i];
    const poId = rowData[0];           
    const vendor = rowData[3];         
    const isChecked = rowData[15];     
    const currentRowIndex = 9 + i;

    // Only process checked rows that aren't already marked ISSUED
    if (isChecked === true && rowData[9] !== 'ISSUED') {
      let createdFiles = null;
      
      try {
        // UI: Indicate Working
        sheet.getRange(currentRowIndex, 10).setValue("⏳ Generating...");
        SpreadsheetApp.flush(); 

        // ------------------------------------------------------------------
        // STEP 1: GENERATE FILES (Drive)
        // ------------------------------------------------------------------
        createdFiles = _generatePOFiles(poId, vendor, rowData);
        const linkString = `Sheet: ${createdFiles.sheetUrl} | PDF: ${createdFiles.pdfUrl}`;

        // ------------------------------------------------------------------
        // STEP 2: ATOMIC DB CALL (The Safe Transaction)
        // ------------------------------------------------------------------
        const dbResult = _callAtomicIssueSP(poId, linkString);
        
        // ------------------------------------------------------------------
        // STEP 3: HANDLE RESULT
        // ------------------------------------------------------------------
        if (dbResult === 'SUCCESS') {
          // A. Success: Update UI
          _markRowAsIssued(sheet, currentRowIndex, createdFiles.sheetUrl, createdFiles.pdfUrl);
          processedCount++;

        } else if (dbResult === 'ALREADY_DONE') {
          // B. Idempotency: It was already done! 
          // Action: Trash duplicate files
          _trashFiles(createdFiles);
          
          // Update UI to reflect reality (Status Only)
          sheet.getRange(currentRowIndex, 10).setValue("ISSUED");
          sheet.getRange(currentRowIndex, 11).setValue("(Already Issued - Refresh to view)");

        } else {
          // C. Unknown Error from SQL
          throw new Error("DB Error: " + dbResult);
        }

      } catch (e) {
        // ------------------------------------------------------------------
        // ROLLBACK: COMPENSATION TRANSACTION
        // ------------------------------------------------------------------
        Logger.log(`❌ Error Issuing ${poId}: ${e.message}`);
        
        // 1. Delete the files we created
        if (createdFiles) _trashFiles(createdFiles);

        // 2. Show Error on Sheet
        sheet.getRange(currentRowIndex, 10).setValue("ERROR").setNote(e.message).setFontColor("red");
      }
    }
  }

  if (processedCount > 0) {
    ui.alert(`Success! Issued ${processedCount} Purchase Orders.`);
  } else {
    ui.alert("Done. No new POs were issued.");
  }
}

/**
 * 🛠️ HELPER: Calls the New Atomic Stored Procedure
 */
function _callAtomicIssueSP(poId, linkString) {
  const config = ISC_SCM_Core_Lib.getCoreConfig();
  const datasetPath = `${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}`;
  
  const query = `CALL \`${datasetPath}.SP_M3_ATOMIC_ISSUE\`('${poId}', '${linkString}')`;
  const result = ISC_SCM_Core_Lib.runReadQueryMapped(query);
  
  if (result && result.length > 0) {
    return result[0].result_message; 
  }
  throw new Error("No response from Database.");
}

/**
 * 🛠️ HELPER: Updates UI for Success
 * (Removed Visual Grey-Out Logic)
 */
function _markRowAsIssued(sheet, row, sheetUrl, pdfUrl) {
  sheet.getRange(row, 10).setValue("ISSUED"); 
  sheet.getRange(row, 14).setValue(new Date()); 
  
  const richValue = SpreadsheetApp.newRichTextValue()
    .setText("Open Sheet | Open PDF")
    .setLinkUrl(0, 10, sheetUrl)
    .setLinkUrl(13, 21, pdfUrl)
    .build();
  sheet.getRange(row, 11).setRichTextValue(richValue); 
}

/**
 * 🛠️ HELPER: Deletes Files (Rollback)
 */
function _trashFiles(filesObj) {
  if (filesObj.sheetId) DriveApp.getFileById(filesObj.sheetId).setTrashed(true);
  if (filesObj.pdfId) DriveApp.getFileById(filesObj.pdfId).setTrashed(true);
}

/**
 * 🛠️ CORE GENERATOR: Anchor & Expand Strategy
 */
function _generatePOFiles(poId, vendorName, headerData) {
  const lines = _fetchPOLines(poId); 
  
  const templateFile = DriveApp.getFileById(M3_ISSUANCE_CONFIG.PO_TEMPLATE_ID);
  const targetFolder = M3_ISSUANCE_CONFIG.TARGET_FOLDER_ID 
    ? DriveApp.getFolderById(M3_ISSUANCE_CONFIG.TARGET_FOLDER_ID) 
    : DriveApp.getRootFolder();
    
  const newSheetName = `PO_${poId}_${vendorName}`;
  const newFile = templateFile.makeCopy(newSheetName, targetFolder);
  const newSS = SpreadsheetApp.open(newFile);
  const targetSheet = newSS.getSheets()[0]; 

  targetSheet.createTextFinder("<<PO_DOCUMENT_ID>>").replaceAllWith(poId);
  targetSheet.createTextFinder("<<SUPPLIER_NAME>>").replaceAllWith(vendorName);

  if (lines.length > 0) {
    const anchorFinder = targetSheet.createTextFinder("<<ITEMS_NO>>");
    const anchorCell = anchorFinder.findNext();
    
    if (anchorCell) {
      const startRow = anchorCell.getRow();
      const lastCol = targetSheet.getLastColumn();

      if (lines.length > 1) {
        targetSheet.insertRowsAfter(startRow, lines.length - 1);
        const sourceRange = targetSheet.getRange(startRow, 1, 1, lastCol);
        const destRange = targetSheet.getRange(startRow + 1, 1, lines.length - 1, lastCol);
        sourceRange.copyTo(destRange);
      }

      const tableRange = targetSheet.getRange(startRow, 1, lines.length, lastCol);
      const tableValues = tableRange.getValues();

      for (let r = 0; r < lines.length; r++) {
        const line = lines[r];
        const rowArr = tableValues[r];
        const dateCode = line.DATE_CODE || "";
        const reqDate = line.SYSTEM_SUGGESTED_REQUESTED_DATE 
          ? Utilities.formatDate(new Date(line.SYSTEM_SUGGESTED_REQUESTED_DATE.value || line.SYSTEM_SUGGESTED_REQUESTED_DATE), Session.getScriptTimeZone(), "dd-MM-yyyy") 
          : "";

        for (let c = 0; c < rowArr.length; c++) {
          let cellVal = String(rowArr[c]);
          if (cellVal.includes("<<ITEMS_NO>>")) cellVal = cellVal.replace("<<ITEMS_NO>>", r + 1);
          if (cellVal.includes("<<BOM_UPDATE>>")) cellVal = cellVal.replace("<<BOM_UPDATE>>", line.BOM_UPDATE || "");
          if (cellVal.includes("<<BOM_VIETNAMESE_DESCRIPTION>>")) cellVal = cellVal.replace("<<BOM_VIETNAMESE_DESCRIPTION>>", line.ITEM_NAME_VN || "");
          if (cellVal.includes("<<ORDER_QTY>>")) cellVal = cellVal.replace("<<ORDER_QTY>>", line.QUANTITY || 0);
          if (cellVal.includes("<<UNIT_PRICE>>")) cellVal = cellVal.replace("<<UNIT_PRICE>>", line.UNIT_PRICE || 0);
          if (cellVal.includes("<<LINE_TOTAL>>")) cellVal = cellVal.replace("<<LINE_TOTAL>>", line.TOTAL_PRICE || 0);
          if (cellVal.includes("<<DATE_CODE>>")) cellVal = cellVal.replace("<<DATE_CODE>>", dateCode);
          if (cellVal.includes("<<SYSTEM_SUGGESTED_REQUESTED_DATE>>")) cellVal = cellVal.replace("<<SYSTEM_SUGGESTED_REQUESTED_DATE>>", reqDate);
          rowArr[c] = cellVal;
        }
      }
      tableRange.setValues(tableValues);
    }
  }
  
  SpreadsheetApp.flush();

  const pdfBlob = newFile.getAs('application/pdf');
  const pdfFile = targetFolder.createFile(pdfBlob).setName(`${newSheetName}.pdf`);

  return {
    sheetUrl: newFile.getUrl(),
    sheetId: newFile.getId(), 
    pdfUrl: pdfFile.getUrl(),
    pdfId: pdfFile.getId()   
  };
}

function _updateBigQueryStatus(poId, linkString) {
  // DEPRECATED: Replaced by SP_M3_ATOMIC_ISSUE
}

function _triggerM4Tracking(poId) {
  // DEPRECATED: Replaced by SP_M3_ATOMIC_ISSUE
}

/**
 * 🛠️ DATA FETCH: Used by the PDF Generator
 */
function _fetchPOLines(poId) {
  const config = ISC_SCM_Core_Lib.getCoreConfig();
  const datasetPath = `${config.connection.PROJECT_ID}.${config.connection.DATASET_ID}`;

  const query = `
    SELECT 
      l.BOM_UPDATE, b.BOM AS ITEM_CODE,
      COALESCE(b.BOM_VIETNAMESE_DESCRIPTION, b.BOM_DESCRIPTION) AS ITEM_NAME_VN,
      l.ORDER_QTY AS QUANTITY, l.UNIT_PRICE, l.LINE_TOTAL AS TOTAL_PRICE,
      l.DATE_CODE, l.SYSTEM_SUGGESTED_REQUESTED_DATE
    FROM \`${datasetPath}.${M3_ISSUANCE_CONFIG.TABLE_LINE}\` l
    LEFT JOIN \`${datasetPath}.${M3_ISSUANCE_CONFIG.TABLE_BOM}\` b ON l.BOM_UPDATE = b.BOM_UPDATE
    WHERE l.PO_DOCUMENT_ID = '${poId}'
    ORDER BY b.BOM
  `;
  return ISC_SCM_Core_Lib.runReadQueryMapped(query); 
}