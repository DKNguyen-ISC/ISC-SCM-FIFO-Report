/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Code.gs — ISC Weekly Report Engine (V6 — Full 5W2H Edition)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 * Reads Weekly_Input + FULL 5W2H_Matrix → rich infographic HTML email →
 * sends to dk@ / kent@
 *
 * V6 UPGRADES vs V5:
 * - _read5W2HData()  : reads ALL columns (What/Pain/Gain/When/Who/Steps/Tools/
 *                      Progress/Cost/Total%) dynamically from sheet
 * - _build5W2HSection() : 2-column dept card layout — no more summary-only table
 * - _buildDeptCard()  : full card: WHAT → WHY (pain/gain) → HOW (steps+tools)
 *                       → WHO + COST footer
 * - PC-adaptive layout: max-width 1050px, 3-col stat cards, 3-col action cards
 * - Removed hardcoded depts[] array — everything is live from the sheet
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ── CONFIG ──────────────────────────────────────────────────────
var REPORT_CONFIG = {
  STAGING_EMAIL:  'dk@isconline.vn',
  KENT_EMAIL:     'kent@isconline.vn',
  SEND_TO_KENT:   false,
  LABEL_NAME:     'ISC_Weekly_Report',
  TIMEZONE:       'Asia/Ho_Chi_Minh',
  SHEET_URL:      'https://docs.google.com/spreadsheets/d/1W_F2zwYknKBSDw2yKFi-q3a5sozkyCJ5zCupo4JmwqU/edit',
  INPUT_TAB:      'Weekly_Input',
  MATRIX_TAB:     '5W2H_Matrix',
  LOG_TAB:        'Report_Log'
};

// ── MAIN FUNCTION ───────────────────────────────────────────────
function generateAndSendWeeklyReport() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var input       = _readWeeklyInput(ss);
  var departments = _read5W2HData(ss);          // V6: full matrix reader

  var html    = _buildReportHTML(input, departments);
  var subject = _buildSubject(input);

  var recipient = REPORT_CONFIG.SEND_TO_KENT
    ? REPORT_CONFIG.KENT_EMAIL
    : REPORT_CONFIG.STAGING_EMAIL;

  GmailApp.sendEmail(recipient, subject, 'Please view this email in HTML mode.', {
    htmlBody: html,
    name: 'ISC Digital Transformation',
    replyTo: REPORT_CONFIG.STAGING_EMAIL
  });

  _applyLabel(REPORT_CONFIG.LABEL_NAME);
  _appendToLog(ss, input, recipient);
  Logger.log('[V6] Report sent to: ' + recipient + ' | ' + input.weekNumber);
}

// ── READ WEEKLY INPUT ───────────────────────────────────────────
function _readWeeklyInput(ss) {
  var sheet = ss.getSheetByName(REPORT_CONFIG.INPUT_TAB);
  if (!sheet) throw new Error('Weekly_Input tab not found. Run admin_SetupAllTabs() first.');

  return {
    weekNumber:    String(sheet.getRange('B3').getValue()),
    dateRange:     String(sheet.getRange('B4').getValue()),
    overallStatus: String(sheet.getRange('B5').getValue()),
    achievement1:  String(sheet.getRange('B8').getValue()),
    achievement2:  String(sheet.getRange('B9').getValue()),
    blocker:       String(sheet.getRange('B10').getValue()),
    phase5Pct:     String(sheet.getRange('B13').getValue()),
    testingNote:   String(sheet.getRange('B14').getValue()),
    systemHealth:  String(sheet.getRange('B15').getValue()),
    mplStatus:     String(sheet.getRange('B18').getValue()),
    csStatus:      String(sheet.getRange('B19').getValue()),
    prdStatus:     String(sheet.getRange('B20').getValue()),
    nextAction1:   String(sheet.getRange('B23').getValue()),
    nextAction2:   String(sheet.getRange('B24').getValue()),
    nextAction3:   String(sheet.getRange('B25').getValue()),
    aiHighlight:   String(sheet.getRange('B28').getValue())
  };
}

// ── HELPER: CLEAN DEPT NAME (strips emoji surrogates) ──────────
function _cleanDeptName(raw) {
  return raw.replace(/^[\uD800-\uDFFF\u0080-\uFFFF\s]+/, '')
            .split('\n')[0]
            .trim();
}

// ── HELPER: SAFE HTML TEXT (escape & < > only, keep emoji) ─────
function _safeText(text) {
  if (!text) return '';
  var s = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
    
  // Explicitly encode astral plane characters (emojis) to HTML entities
  // to avoid the Gmail "diamond" bug when sending via Apps Script Mailer.
  var encoded = '';
  for (var i = 0; i < s.length; i++) {
    var charCode = s.charCodeAt(i);
    // If it's a high surrogate pair (start of an emoji)
    if (charCode >= 0xD800 && charCode <= 0xDBFF) {
      if (i + 1 < s.length) {
        var lowSurrogate = s.charCodeAt(i + 1);
        if (lowSurrogate >= 0xDC00 && lowSurrogate <= 0xDFFF) {
          var codePoint = ((charCode - 0xD800) * 0x400) + (lowSurrogate - 0xDC00) + 0x10000;
          encoded += '&#x' + codePoint.toString(16).toUpperCase() + ';';
          i++; // Skip the low surrogate
          continue;
        }
      }
    }
    // Standard emoji/symbol ranges that sometimes get mangled
    if (charCode > 127) {
      encoded += '&#x' + charCode.toString(16).toUpperCase() + ';';
    } else {
      encoded += s.charAt(i);
    }
  }
  return encoded;
}

// ── HELPER: PARSE STEP PROGRESS PERCENTAGE ─────────────────────
function _parseStepPct(progressText) {
  if (!progressText) return 0;
  var s = String(progressText);
  if (s.indexOf('\u2705') > -1) return 100;            // ✅ emoji
  if (s.indexOf('100%') > -1)  return 100;
  var m = s.match(/(\d+)%/);
  return m ? parseInt(m[1]) : 0;
}

// ── HELPER: EXTRACT COMPACT DATE RANGE FROM WHEN TEXT ──────────
// Input: "Start: Q3 2025\nTarget: Q2 2026\nStatus: Phase 5"
// Output: "Q3 2025 &#x2192; Q2 2026 (Phase 5)"
function _extractDateRange(whenText) {
  var start = '', target = '', status = '';
  var lines = (whenText || '').split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if      (line.indexOf('Start:')  === 0) start  = line.replace('Start:',  '').trim();
    else if (line.indexOf('Target:') === 0) target = line.replace('Target:', '').trim();
    else if (line.indexOf('Status:') === 0) status = line.replace('Status:', '').trim();
  }
  if (start && target) {
    return _safeText(start) + ' &#x2192; ' + _safeText(target)
         + (status ? ' &nbsp;<span style="color:#718096;">(' + _safeText(status) + ')</span>' : '');
  }
  return _safeText((whenText || '').split('\n')[0] || whenText);
}

// ── HELPER: EMAIL PROGRESS BAR (Gmail-safe table-based bar) ────
function _buildEmailProgressBar(pct, isDone) {
  if (isDone || pct >= 100) {
    return '<span style="display:inline-block;background:#c6f6d5;color:#22543d;'
         + 'font-size:9px;font-weight:bold;padding:2px 7px;border-radius:10px;">&#x2705; Done</span>';
  }
  if (pct === 0) {
    return '<span style="font-size:9px;color:#a0aec0;">&#x23F3; Pending</span>';
  }
  // Bar color: blue for > 50%, yellow for ≤ 50%
  var fillColor = pct >= 50 ? '#4299e1' : '#ecc94b';
  var totalW  = 72;
  var fillW   = Math.max(4, Math.round(totalW * pct / 100));
  var emptyW  = totalW - fillW;
  return '<table cellpadding="0" cellspacing="0" border="0" width="' + totalW + '" style="display:inline-table;vertical-align:middle;">'
       + '<tr>'
       + '<td width="' + fillW  + '" height="8" style="background:' + fillColor + ';'
       + 'border-radius:4px 0 0 4px;font-size:1px;">&nbsp;</td>'
       + '<td width="' + emptyW + '" height="8" style="background:#e2e8f0;'
       + 'border-radius:0 4px 4px 0;font-size:1px;">&nbsp;</td>'
       + '</tr></table>'
       + '<span style="font-size:9px;color:#4a5568;margin-left:4px;">' + pct + '%</span>';
}

// ══════════════════════════════════════════════════════════════════
// V6 CORE: READ FULL 5W2H MATRIX FROM SHEET
// ══════════════════════════════════════════════════════════════════
function _read5W2HData(ss) {
  var sheet = ss.getSheetByName(REPORT_CONFIG.MATRIX_TAB);
  if (!sheet) return [];

  var lastRow = sheet.getLastRow();
  var numRows = Math.min(lastRow - 4, 90); // rows starting at row 5, max 90
  if (numRows <= 0) return [];

  // Columns A(1) through L(12):
  // A=Dept, B=What, C=Pain, D=Gain, E=When, F=Who, G=Where,
  // H=Step, I=Tool, J=StepProgress, K=Cost, L=TotalPct
  var data = sheet.getRange(5, 1, numRows, 12).getDisplayValues(); // FIX: getDisplayValues to capture '87%' string correctly
  var departments = [];
  var currentDept = null;

  for (var i = 0; i < data.length; i++) {
    var row     = data[i];
    var colA    = String(row[0]  || '').trim();
    var colB    = String(row[1]  || '').trim();
    var colC    = String(row[2]  || '').trim();
    var colD    = String(row[3]  || '').trim();
    var colE    = String(row[4]  || '').trim();
    var colF    = String(row[5]  || '').trim();
    var colG    = String(row[6]  || '').trim();
    var colH    = String(row[7]  || '').trim();
    var colI    = String(row[8]  || '').trim();
    var colJ    = String(row[9]  || '').trim();
    var colK    = String(row[10] || '').trim();
    var colL    = String(row[11] || '').trim();

    // New dept block: Col A is non-empty (merged cell top row)
    if (colA !== '') {
      var nameParts = colA.split('\n');
      currentDept = {
        nameRaw:  colA,
        name:     nameParts[0].trim(),
        nameAbbr: nameParts[1] ? nameParts[1].trim() : '',
        what:     colB,
        pain:     colC,
        gain:     colD,
        when:     colE,
        who:      colF,
        where:    colG,
        cost:     colL,
        totalPct: colK,
        steps:    []
      };
      departments.push(currentDept);
    }

    // Step row: Col H is non-empty (step names live in Col H)
    if (currentDept && colH !== '') {
      var pct    = _parseStepPct(colJ);
      var isDone = (pct >= 100);
      currentDept.steps.push({
        name:     colH,
        tool:     colI,
        progress: colJ,
        pct:      pct,
        done:     isDone
      });
    }
  }

  return departments;
}

// ══════════════════════════════════════════════════════════════════
// V6 CORE: BUILD SINGLE DEPARTMENT CARD (Gmail-safe inline HTML)
// ══════════════════════════════════════════════════════════════════
function _buildDeptCard(dept) {
  var totalPct = parseInt(dept.totalPct) || 0;

  // ── Color scheme based on total progress ──
  var headerBg, headerColor, progressBg, progressColor, cardBorder;
  if (totalPct >= 70) {
    headerBg = '#c6f6d5'; headerColor = '#22543d';
    progressBg = '#48bb78'; progressColor = '#ffffff'; cardBorder = '#9ae6b4';
  } else if (totalPct >= 20) {
    headerBg = '#ebf8ff'; headerColor = '#2a4365';
    progressBg = '#4299e1'; progressColor = '#ffffff'; cardBorder = '#90cdf4';
  } else if (totalPct > 0) {
    headerBg = '#fefcbf'; headerColor = '#744210';
    progressBg = '#ecc94b'; progressColor = '#ffffff'; cardBorder = '#f6e05e';
  } else {
    headerBg = '#f7fafc'; headerColor = '#4a5568';
    progressBg = '#a0aec0'; progressColor = '#ffffff'; cardBorder = '#e2e8f0';
  }

  // ── Pain lines ──
  var painLines = (dept.pain || '').split('\n')
    .map(function(l){ return l.trim(); })
    .filter(function(l){ return l !== ''; });

  // ── Gain lines ──
  var gainLines = (dept.gain || '').split('\n')
    .map(function(l){ return l.trim(); })
    .filter(function(l){ return l !== ''; });

  // ── WHO: full multilines ──
  var whoLines = (dept.who || '').split('\n')
    .map(function(l){ return l.trim(); })
    .filter(function(l){ return l !== ''; });
  var whoDisplay = whoLines.map(_safeText).join('<br>');

  // ── Steps rows ──
  var stepsHTML = '';
  for (var s = 0; s < dept.steps.length; s++) {
    var step   = dept.steps[s];
    var rowBg  = (s % 2 === 0) ? '#f7fafc' : '#ffffff';
    var barHTML = _buildEmailProgressBar(step.pct, step.done);
    stepsHTML +=
        '<tr style="background:' + rowBg + ';">'
      + '<td style="padding:8px 10px;font-size:11px;color:#2d3748;'
      + 'width:52%;border-bottom:1px solid #e2e8f0;">' + _safeText(step.name) + '</td>'
      + '<td style="padding:8px 10px;font-size:10px;color:#718096;'
      + 'width:28%;border-bottom:1px solid #e2e8f0;white-space:nowrap;">' + _safeText(step.tool) + '</td>'
      + '<td style="padding:8px 10px;width:20%;text-align:right;'
      + 'border-bottom:1px solid #e2e8f0;">' + barHTML + '</td>'
      + '</tr>';
  }

  // ── Pain block ──
  var painBlock = '';
  for (var p = 0; p < painLines.length; p++) {
    painBlock += '<div style="font-size:10px;color:#c53030;line-height:1.5;margin-bottom:1px;">'
               + _safeText(painLines[p]) + '</div>';
  }

  // ── Gain block ──
  var gainBlock = '';
  for (var g = 0; g < gainLines.length; g++) {
    gainBlock += '<div style="font-size:10px;color:#276749;line-height:1.5;margin-bottom:1px;">'
               + _safeText(gainLines[g]) + '</div>';
  }

  // ── Assemble card ──
  var card =
    // Outer border
    '<div style="border:1px solid ' + cardBorder + ';border-radius:10px;'
  + 'overflow:hidden;margin-bottom:24px;box-shadow:0 2px 8px rgba(0,0,0,0.05);">'

    // ── Card Header ──
  + '<div style="background:' + headerBg + ';padding:14px 18px;">'
  + '<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>'
  + '<td style="vertical-align:middle;">'
  + '<span style="font-size:15px;font-weight:bold;color:' + headerColor + ';">'
  + _safeText(dept.name) + '</span>'
  + (dept.nameAbbr
      ? ' <span style="font-size:11px;color:#718096;font-weight:normal;">'
      + _safeText(dept.nameAbbr) + '</span>'
      : '')
  + '<br>'
  + '<span style="font-size:11px;color:#718096;">'
  + _extractDateRange(dept.when) + '</span>'
  + '</td>'
  + '<td style="vertical-align:middle;text-align:right;">'
  + '<span style="display:inline-block;padding:4px 14px;border-radius:14px;'
  + 'font-size:14px;font-weight:bold;background:' + progressBg + ';color:' + progressColor + ';">'
  + totalPct + '%</span>'
  + '</td>'
  + '</tr></table>'
  + '</div>'

    // ── WHAT ──
  + '<div style="padding:14px 18px;border-bottom:1px solid #e2e8f0;background:#ffffff;">'
  + '<div style="font-size:12px;font-weight:bold;color:#2c5282;text-transform:uppercase;'
  + 'letter-spacing:0.5px;margin-bottom:6px;">&#x2753; WHAT</div>'
  + '<div style="font-size:13px;color:#2d3748;line-height:1.6;">'
  + _safeText(dept.what) + '</div>'
  + '</div>'

    // ── WHY: Pain | Gain ──
  + '<div style="padding:14px 18px;border-bottom:1px solid #e2e8f0;background:#faf5ff;">'
  + '<div style="font-size:12px;font-weight:bold;color:#553c9a;text-transform:uppercase;'
  + 'letter-spacing:0.5px;margin-bottom:10px;">&#x1F4A1; WHY</div>'
  + '<table cellpadding="0" cellspacing="0" border="0" width="100%">'
  + '<tr>'
  + '<td width="50%" style="padding-right:12px;vertical-align:top;'
  + 'border-right:1px solid #e9d8fd;">'
  + '<div style="font-size:10px;font-weight:bold;color:#c53030;'
  + 'text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">&#x26A1; PAIN</div>'
  + painBlock
  + '</td>'
  + '<td width="50%" style="padding-left:12px;vertical-align:top;">'
  + '<div style="font-size:10px;font-weight:bold;color:#276749;'
  + 'text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">&#x2728; GAIN</div>'
  + gainBlock
  + '</td>'
  + '</tr></table>'
  + '</div>'

    // ── HOW TO: Steps table ──
  + '<div style="padding:14px 18px;background:#ffffff;">'
  + '<div style="font-size:12px;font-weight:bold;color:#2b6cb0;text-transform:uppercase;'
  + 'letter-spacing:0.5px;margin-bottom:10px;">&#x1F6E0;&#xFE0F; HOW TO</div>'
  + '<table cellpadding="0" cellspacing="0" border="0" width="100%">'
  + '<tr style="background:#edf2f7;">'
  + '<th style="padding:6px 10px;font-size:10px;color:#4a5568;text-align:left;'
  + 'font-weight:bold;text-transform:uppercase;width:52%;">&#x1F527; Steps</th>'
  + '<th style="padding:6px 10px;font-size:10px;color:#4a5568;text-align:left;'
  + 'font-weight:bold;text-transform:uppercase;width:28%;">&#x1F6E0;&#xFE0F; Tools</th>'
  + '<th style="padding:6px 10px;font-size:10px;color:#4a5568;text-align:right;'
  + 'font-weight:bold;text-transform:uppercase;width:20%;">Progress</th>'
  + '</tr>'
  + stepsHTML
  + '</table>'
  + '</div>'

    // ── Footer: WHO + Cost ──
  + '<div style="padding:14px 18px;background:#f7fafc;border-top:1px solid #e2e8f0;">'
  + '<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>'
  + '<td style="vertical-align:top;">'
  + '<div style="font-size:12px;font-weight:bold;color:#4a5568;margin-bottom:8px;'
  + 'text-transform:uppercase;letter-spacing:0.5px;">&#x1F464; WHO</div>'
  + '<div style="font-size:12px;color:#2d3748;line-height:1.6;">' + whoDisplay + '</div>'
  + '</td>'
  + '<td style="vertical-align:top;text-align:right;">'
  + '<div style="font-size:12px;font-weight:bold;color:#38a169;margin-bottom:8px;'
  + 'text-transform:uppercase;letter-spacing:0.5px;">&#x1F4B0; HOW MUCH</div>'
  + '<span style="display:inline-block;padding:5px 14px;border-radius:12px;'
  + 'font-size:13px;font-weight:bold;background:#f0fff4;color:#22543d;'
  + 'border:1px solid #c6f6d5;">' + _safeText(dept.cost) + '</span>'
  + '</td>'
  + '</tr></table>'
  + '</div>'

  + '</div>'; // end card

  return card;
}

// ══════════════════════════════════════════════════════════════════
// V6 CORE: ASSEMBLE 1-COLUMN DEPT CARD LAYOUT (Mobile Safe)
// ══════════════════════════════════════════════════════════════════
function _build5W2HSection(departments, sheetLink) {
  if (!departments || departments.length === 0) {
    return '<div style="padding:16px;font-size:12px;color:#718096;text-align:center;">'
         + '5W2H data not available. '
         + '<a href="' + sheetLink + '" style="color:#2b6cb0;">View in Google Sheet</a>'
         + '</div>';
  }

  // ── Legend ──
  var legend =
    '<div style="margin-bottom:14px;padding:8px 12px;background:#f7fafc;'
  + 'border-radius:6px;border:1px solid #e2e8f0;">'
  + '<table cellpadding="0" cellspacing="0" border="0"><tr>'
  + '<td style="padding-right:14px;font-size:10px;color:#22543d;">'
  + '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;'
  + 'background:#48bb78;margin-right:4px;vertical-align:middle;"></span>&#x2265;70% Active</td>'
  + '<td style="padding-right:14px;font-size:10px;color:#2a4365;">'
  + '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;'
  + 'background:#4299e1;margin-right:4px;vertical-align:middle;"></span>&#x2265;20% In Progress</td>'
  + '<td style="padding-right:14px;font-size:10px;color:#744210;">'
  + '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;'
  + 'background:#ecc94b;margin-right:4px;vertical-align:middle;"></span>&gt;0% Started</td>'
  + '<td style="font-size:10px;color:#4a5568;">'
  + '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;'
  + 'background:#a0aec0;margin-right:4px;vertical-align:middle;"></span>0% Pending</td>'
  + '</tr></table>'
  + '</div>';

  // ── 1-column cards (Mobile Safe & Legible) ──
  var cardsHTML = '';
  for (var i = 0; i < departments.length; i++) {
    cardsHTML += _buildDeptCard(departments[i]);
  }

  return legend + cardsHTML;
}

// ══════════════════════════════════════════════════════════════════
// MAIN HTML BUILDER (V6 — PC-adaptive, Full 5W2H)
// ══════════════════════════════════════════════════════════════════
function _buildReportHTML(input, departments) {
  var sheetLink = REPORT_CONFIG.SHEET_URL;
  var pct       = parseInt(input.phase5Pct) || 0;
  var noBlocker = (!input.blocker || input.blocker === 'None this week' || input.blocker === '');

  // ── Status badge ──
  var statusColor = '#48bb78';
  var statusLabel = '&#x2705; On Track';
  if (input.overallStatus.indexOf('Yellow') >= 0 || input.overallStatus.indexOf('Caution') >= 0) {
    statusColor = '#ecc94b';
    statusLabel = '&#x26A0;&#xFE0F; Caution';
  } else if (input.overallStatus.indexOf('Red') >= 0 || input.overallStatus.indexOf('Risk') >= 0) {
    statusColor = '#fc8181';
    statusLabel = '&#x1F534; At Risk';
  }

  // ── Phase Strip (8 phases, 2 rows × 4) ──
  var phaseStrip =
    '<table cellpadding="0" cellspacing="4" border="0" width="100%"'
  + ' style="margin-top:18px;margin-bottom:6px;">'
  + '<tr>'
  + '<td style="width:12.5%"><div style="background:#c6f6d5;color:#22543d;font-size:10px;'
  + 'padding:7px 8px;border-radius:6px;"><b>&#x2705; P1</b><br>'
  + '<span style="font-weight:normal;">Schema Design</span></div></td>'
  + '<td style="width:12.5%"><div style="background:#c6f6d5;color:#22543d;font-size:10px;'
  + 'padding:7px 8px;border-radius:6px;"><b>&#x2705; P2</b><br>'
  + '<span style="font-weight:normal;">PIC Identity</span></div></td>'
  + '<td style="width:12.5%"><div style="background:#c6f6d5;color:#22543d;font-size:10px;'
  + 'padding:7px 8px;border-radius:6px;"><b>&#x2705; P3</b><br>'
  + '<span style="font-weight:normal;">Issuance Sync</span></div></td>'
  + '<td style="width:12.5%"><div style="background:#c6f6d5;color:#22543d;font-size:10px;'
  + 'padding:7px 8px;border-radius:6px;"><b>&#x2705; P4</b><br>'
  + '<span style="font-weight:normal;">PR Cols + Shortage</span></div></td>'
  + '</tr><tr>'
  + '<td><div style="background:#fefcbf;color:#744210;font-size:10px;'
  + 'padding:7px 8px;border-radius:6px;border:1px solid #ecc94b;">'
  + '<b>&#x1F7E1; P5</b><br><span style="font-weight:normal;">Assign Sourcing ('
  + pct + '%)</span></div></td>'
  + '<td><div style="background:#c6f6d5;color:#22543d;font-size:10px;'
  + 'padding:7px 8px;border-radius:6px;"><b>&#x2705; P6</b><br>'
  + '<span style="font-weight:normal;">Analytics Email</span></div></td>'
  + '<td><div style="background:#c6f6d5;color:#22543d;font-size:10px;'
  + 'padding:7px 8px;border-radius:6px;"><b>&#x2705; P7</b><br>'
  + '<span style="font-weight:normal;">Auto-Switch</span></div></td>'
  + '<td><div style="background:#c6f6d5;color:#22543d;font-size:10px;'
  + 'padding:7px 8px;border-radius:6px;"><b>&#x2705; P8</b><br>'
  + '<span style="font-weight:normal;">Exec Dashboards</span></div></td>'
  + '</tr></table>';

  // ── Blocker block ──
  var blockerHTML = '';
  if (noBlocker) {
    blockerHTML =
      '<div style="background:#f0fff4;border-left:4px solid #48bb78;'
    + 'padding:10px 16px;border-radius:0 6px 6px 0;margin-top:10px;">'
    + '<span style="font-size:14px;">&#x2705;</span> '
    + '<strong style="color:#22543d;">No blockers this week</strong>'
    + '</div>';
  } else {
    blockerHTML =
      '<div style="background:#fffff0;border-left:4px solid #ecc94b;'
    + 'padding:10px 16px;border-radius:0 6px 6px 0;margin-top:10px;">'
    + '<span style="font-size:14px;">&#x26A0;&#xFE0F;</span> '
    + '<strong style="color:#744210;">' + _safeText(input.blocker) + '</strong>'
    + '</div>';
  }

  // ── AI Tool Section ──
  var aiSection = '';
  if (input.aiHighlight) {
    var safeAI = _safeText(input.aiHighlight);
    aiSection =
      '<div style="padding:20px 32px;border-bottom:1px solid #e2e8f0;">'
    + '<h2 style="font-size:13px;color:#1a365d;margin:0 0 12px;text-transform:uppercase;'
    + 'letter-spacing:0.5px;border-bottom:2px solid #805ad5;padding-bottom:6px;">'
    + '&#x1F916; AI Tool Spotlight</h2>'
    + '<div style="background:linear-gradient(135deg,#ebf4ff,#e9d8fd);border-radius:8px;'
    + 'padding:16px 18px;border:1px solid #d6bcfa;">'
    + '<table cellpadding="0" cellspacing="0" border="0"><tr>'
    + '<td style="vertical-align:top;padding-right:14px;"><span style="font-size:28px;">&#x1F4A1;</span></td>'
    + '<td>'
    + '<div style="font-weight:bold;font-size:13px;color:#553c9a;margin-bottom:4px;">Recommended Tool</div>'
    + '<div style="font-size:12px;color:#44337a;line-height:1.5;">' + safeAI + '</div>'
    + '<div style="margin-top:10px;">'
    + '<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:10px;'
    + 'font-weight:bold;background:#d6bcfa;color:#553c9a;border:1px solid #b794f4;">&#x1F512; Secure</span>'
    + '<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:10px;'
    + 'font-weight:bold;background:#c6f6d5;color:#22543d;border:1px solid #9ae6b4;'
    + 'margin-left:6px;">&#x1F4B0; Free</span>'
    + '<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:10px;'
    + 'font-weight:bold;background:#bee3f8;color:#2a4365;border:1px solid #90cdf4;'
    + 'margin-left:6px;">&#x2601;&#xFE0F; Cloud</span>'
    + '</div></td></tr></table>'
    + '</div></div>';
  }

  // ── Next Week action cards (3-column table layout for PC) ──
  var actions     = [input.nextAction1, input.nextAction2, input.nextAction3];
  var actionIcons = ['&#x1F3AF;', '&#x1F4C5;', '&#x1F527;'];
  var actionCards =
    '<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>';
  for (var j = 0; j < 3; j++) {
    if (actions[j]) {
      actionCards +=
        '<td width="33%" style="vertical-align:top;padding:0 ' + (j < 2 ? '5px 0 0' : '0 0 0') + ';">'
      + '<div style="padding:12px 14px;background:#f7fafc;border-radius:8px;'
      + 'border-top:3px solid #2b6cb0;height:100%;">'
      + '<div style="font-size:18px;margin-bottom:6px;">' + actionIcons[j] + '</div>'
      + '<div style="font-size:11px;color:#2d3748;line-height:1.5;">'
      + _safeText(actions[j]) + '</div>'
      + '</div></td>';
    }
  }
  actionCards += '</tr></table>';

  // ══════════════════════════════════════════════════════════════
  // FULL HTML
  // ══════════════════════════════════════════════════════════════
  var html =
    '<!DOCTYPE html>'
  + '<html><head><meta charset="UTF-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1">'
  + '</head>'
  + '<body style="font-family:Arial,Helvetica,sans-serif;background:#e8edf3;'
  + 'margin:0;padding:24px 16px;color:#2d3748;">'
  
  // ── Custom Vietnamese Greeting ──
  + '<div style="width:100%;max-width:1050px;margin:0 auto 16px;padding:0 8px;'
  + 'font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#2d3748;line-height:1.6;">'
  + '<p style="margin:0 0 8px;">Dear anh Kent,</p>'
  + '<p style="margin:0;">Em g&#7917;i anh b&#225;o c&#225;o 5W2H cho ti&#7871;n tr&#236;nh s&#7889; h&#243;a, '
  + 'Chi ti&#7871;t &#273;&#432;&#7907;c &#273;&#237;nh k&#232;m trong file Google Sheet b&#234;n d&#432;&#7899;i &#7841;.</p>'
  + '</div>'

  // ── Outer wrapper — 1050px max for PC ──
  + '<div style="width:100%;max-width:1050px;margin:0 auto;background:#ffffff;'
  + 'border-radius:12px;overflow:hidden;box-shadow:0 6px 24px rgba(0,0,0,0.10);">'

  // ════════════════ HEADER ════════════════
  + '<div style="background:linear-gradient(135deg,#1a365d 0%,#2b6cb0 60%,#3182ce 100%);'
  + 'color:#ffffff;padding:30px 36px 24px;">'
  + '<div style="font-size:10px;text-transform:uppercase;letter-spacing:2px;'
  + 'opacity:0.65;margin-bottom:8px;">ISC Digital Transformation &nbsp;&#x2502;&nbsp; '
  + 'Hai Phong Vietnam</div>'
  + '<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>'
  + '<td style="vertical-align:bottom;">'
  + '<h1 style="margin:0;font-size:24px;letter-spacing:0.3px;">'
  + '&#x1F3ED; Digitalization Weekly Report</h1>'
  + '<p style="margin:8px 0 0;font-size:13px;opacity:0.85;">'
  + _safeText(input.weekNumber) + ' &nbsp;&#x2502;&nbsp; ' + _safeText(input.dateRange)
  + '</p>'
  + '</td>'
  + '<td style="vertical-align:bottom;text-align:right;">'
  + '<div style="display:inline-block;padding:5px 18px;border-radius:20px;'
  + 'font-size:12px;font-weight:bold;background:' + statusColor
  + ';color:#ffffff;margin-bottom:10px;">' + statusLabel + '</div><br>'
  + '<span style="font-size:11px;opacity:0.7;">Prepared by: Nguy&#7877;n Duy Kh&#225;nh'
  + '<br><a href="mailto:dk@isconline.vn" style="color:#bee3f8;text-decoration:none;">'
  + 'dk@isconline.vn</a></span>'
  + '</td>'
  + '</tr></table>'
  + '</div>'

  // ════════════════ THIS WEEK AT A GLANCE ════════════════
  + '<div style="padding:22px 36px;border-bottom:1px solid #e2e8f0;">'
  + '<h2 style="font-size:13px;color:#1a365d;margin:0 0 14px;text-transform:uppercase;'
  + 'letter-spacing:0.5px;border-bottom:2px solid #2b6cb0;padding-bottom:6px;">'
  + '&#x1F4CC; This Week at a Glance</h2>'
  + '<table cellpadding="0" cellspacing="0" border="0" width="100%">'
  + '<tr><td style="padding:7px 0;vertical-align:top;width:24px;">'
  + '<span style="font-size:15px;">&#x2705;</span></td>'
  + '<td style="padding:7px 0;font-size:12px;color:#2d3748;line-height:1.5;">'
  + _safeText(input.achievement1) + '</td></tr>'
  + '<tr><td style="padding:7px 0;vertical-align:top;">'
  + '<span style="font-size:15px;">&#x2705;</span></td>'
  + '<td style="padding:7px 0;font-size:12px;color:#2d3748;line-height:1.5;">'
  + _safeText(input.achievement2) + '</td></tr>'
  + '</table>'
  + blockerHTML
  + '</div>'

  // ════════════════ SCM STATUS — 3-column stat cards ════════════════
  + '<div style="padding:22px 36px;border-bottom:1px solid #e2e8f0;">'
  + '<h2 style="font-size:13px;color:#1a365d;margin:0 0 16px;text-transform:uppercase;'
  + 'letter-spacing:0.5px;border-bottom:2px solid #2b6cb0;padding-bottom:6px;">'
  + '&#x1F4CA; SCM Database Dashboard</h2>'

  // 3 stat cards
  + '<table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>'

  // Card 1: System Health
  + '<td width="33%" style="padding:0 5px 0 0;vertical-align:top;">'
  + '<div style="background:#f0fff4;border:1px solid #c6f6d5;border-radius:8px;'
  + 'padding:16px 12px;text-align:center;">'
  + '<div style="font-size:26px;margin-bottom:6px;">&#x1F49A;</div>'
  + '<div style="font-size:12px;font-weight:bold;color:#22543d;">'
  + _safeText(input.systemHealth) + '</div>'
  + '<div style="font-size:10px;color:#718096;margin-top:4px;">System Health</div>'
  + '</div></td>'

  // Card 2: Phase 5 Progress
  + '<td width="33%" style="padding:0 5px;vertical-align:top;">'
  + '<div style="background:#fefcbf;border:1px solid #f6e05e;border-radius:8px;'
  + 'padding:16px 12px;text-align:center;">'
  + '<div style="font-size:26px;margin-bottom:6px;">&#x1F7E1;</div>'
  + '<div style="font-size:22px;font-weight:bold;color:#744210;">' + pct + '%</div>'
  + '<div style="font-size:10px;color:#718096;margin-top:4px;">Phase 5 — Assign Sourcing</div>'
  + '<div style="background:#e2e8f0;border-radius:6px;height:8px;width:80%;margin:6px auto 0;">'
  + '<div style="background:#ecc94b;height:100%;width:' + pct + '%;'
  + 'border-radius:6px;"></div>'
  + '</div>'
  + '</div></td>'

  // Card 3: Active Modules
  + '<td width="33%" style="padding:0 0 0 5px;vertical-align:top;">'
  + '<div style="background:#ebf8ff;border:1px solid #bee3f8;border-radius:8px;'
  + 'padding:16px 12px;text-align:center;">'
  + '<div style="font-size:26px;margin-bottom:6px;">&#x2699;&#xFE0F;</div>'
  + '<div style="font-size:22px;font-weight:bold;color:#2a4365;">4</div>'
  + '<div style="font-size:10px;color:#718096;margin-top:4px;">Active Modules</div>'
  + '</div></td>'

  + '</tr></table>'

  // Testing note
  + '<div style="margin-top:14px;padding:10px 14px;background:#fffaf0;'
  + 'border-radius:6px;border:1px solid #fefcbf;">'
  + '<span style="font-size:13px;">&#x1F50D;</span> '
  + '<strong style="font-size:11px;color:#744210;">Testing Focus:</strong> '
  + '<span style="font-size:11px;color:#744210;">'
  + _safeText(input.testingNote) + '</span>'
  + '</div>'

  // Phase strip
  + phaseStrip
  + '</div>'

  // ════════════════ 5W2H MATRIX — FULL DETAIL ════════════════
  + '<div style="padding:22px 36px;border-bottom:1px solid #e2e8f0;">'
  + '<h2 style="font-size:13px;color:#1a365d;margin:0 0 6px;text-transform:uppercase;'
  + 'letter-spacing:0.5px;border-bottom:2px solid #38a169;padding-bottom:6px;">'
  + '&#x1F5FA;&#xFE0F; 5W2H Action Matrix &mdash; Full Detail</h2>'
  + '<p style="font-size:11px;color:#718096;margin:0 0 14px;line-height:1.5;">'
  + 'Each department&#39;s complete plan: What &rsaquo; Why (Pain &#x2192; Gain) &rsaquo; '
  + 'How (Steps + Tools) &rsaquo; When &rsaquo; Who &rsaquo; Budget.</p>'
  + _build5W2HSection(departments, sheetLink)
  + '</div>'

  // ════════════════ AI TOOL SPOTLIGHT ════════════════
  + aiSection

  // ════════════════ NEXT WEEK'S ACTIONS ════════════════
  + '<div style="padding:22px 36px;border-bottom:1px solid #e2e8f0;">'
  + '<h2 style="font-size:13px;color:#1a365d;margin:0 0 14px;text-transform:uppercase;'
  + 'letter-spacing:0.5px;border-bottom:2px solid #dd6b20;padding-bottom:6px;">'
  + '&#x1F4CB; Next Week&#39;s Actions</h2>'
  + actionCards
  + '</div>'

  // ════════════════ FOOTER ════════════════
  + '<div style="padding:20px 36px;background:#f7fafc;'
  + 'font-size:11px;color:#718096;line-height:1.9;">'
  + '<strong style="color:#2d3748;">ISC Digital Transformation</strong>'
  + ' &nbsp;&#x2502;&nbsp; Powered by Google Cloud &amp; BigQuery<br>'
  + '&#x1F4C1; Full Action Plan: <a href="' + sheetLink
  + '" style="color:#2b6cb0;text-decoration:none;">'
  + 'ISC_DigitalizationReport_4PMFriday</a><br>'
  + '&#x1F4E7; Contact: <a href="mailto:dk@isconline.vn"'
  + ' style="color:#2b6cb0;text-decoration:none;">dk@isconline.vn</a>'
  + '</div>'

  + '</div>' // end wrapper
  
  // ── Custom Vietnamese Sign-off ──
  + '<div style="width:100%;max-width:1050px;margin:16px auto 0;padding:0 8px;'
  + 'font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#2d3748;">'
  + '<p style="margin:0;">Th&#226;n &#225;i.</p>'
  + '</div>'
  
  + '</body></html>';

  return html;
}

// ── SUBJECT LINE ────────────────────────────────────────────────
function _buildSubject(input) {
  var now = new Date();
  var monthYear = Utilities.formatDate(now, REPORT_CONFIG.TIMEZONE, 'MMMM yyyy');
  return '[ISC Weekly] Digitalization Report - '
       + input.weekNumber + ', ' + monthYear;
}

// ── GMAIL LABEL ─────────────────────────────────────────────────
function _applyLabel(labelName) {
  try {
    var label = GmailApp.getUserLabelByName(labelName);
    if (!label) label = GmailApp.createLabel(labelName);
    var threads = GmailApp.search('subject:[ISC Weekly] newer_than:1d', 0, 1);
    if (threads.length > 0) label.addToThread(threads[0]);
  } catch (e) {
    Logger.log('Label application failed (non-critical): ' + e.message);
  }
}

// ── APPEND TO LOG ───────────────────────────────────────────────
function _appendToLog(ss, input, recipient) {
  var sheet = ss.getSheetByName(REPORT_CONFIG.LOG_TAB);
  if (!sheet) return;

  var today = Utilities.formatDate(new Date(), REPORT_CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm');
  var deptSummary = [input.mplStatus, input.csStatus, input.prdStatus]
    .filter(function(s) { return s && s !== 'Not started'; })
    .join(', ') || 'SC only';

  sheet.appendRow([
    input.weekNumber,
    today,
    input.overallStatus,
    input.achievement1,
    input.phase5Pct + '%',
    deptSummary,
    input.aiHighlight || '-',
    input.blocker || 'None',
    'Sent',
    recipient
  ]);
}