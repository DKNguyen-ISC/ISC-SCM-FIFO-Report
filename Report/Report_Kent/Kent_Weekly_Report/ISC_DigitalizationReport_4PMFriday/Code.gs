/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Code.gs — ISC Weekly Report Engine (V5 — Action Plan Edition)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 * Reads Weekly_Input tab + active steps from 5W2H_Matrix -> builds rich 
 * infographic HTML email -> sends to dk@
 *
 * V5 UPGRADES:
 * - Reads "Active Steps" directly from the 5W2H_Matrix sheet (mirrors data)
 * - Phase strip with labels (Phase 1-8) in SCM dashboard
 * - SVG-based progress donut (replaces CSS circle) for Gmail rendering
 * - Emojis added to the Department Roadmap
 * - HTML entities used for AI card emojis to fix Gmail diamond bug
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
  var input = _readWeeklyInput(ss);
  var activeSteps = _readActiveSteps(ss); // V5 Feature
  
  var html  = _buildReportHTML(input, activeSteps);
  var subject = _buildSubject(input);

  var recipient = REPORT_CONFIG.SEND_TO_KENT ? REPORT_CONFIG.KENT_EMAIL : REPORT_CONFIG.STAGING_EMAIL;

  GmailApp.sendEmail(recipient, subject, 'Please view this email in HTML mode.', {
    htmlBody: html,
    name: 'ISC Digital Transformation',
    replyTo: REPORT_CONFIG.STAGING_EMAIL
  });

  _applyLabel(REPORT_CONFIG.LABEL_NAME);
  _appendToLog(ss, input, recipient);
  Logger.log('[V5] Report sent to: ' + recipient + ' | ' + input.weekNumber);
}

// ── READ INPUT ──────────────────────────────────────────────────
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

function _cleanDeptName(raw) {
  return raw.replace(/^[\uD800-\uDFFF\u0080-\uFFFF\s]+/, '')
            .split('\n')[0]
            .trim();
}

// ── READ ACTIVE STEPS (V6) ──────────────────────────────────────
function _readActiveSteps(ss) {
  var sheet = ss.getSheetByName(REPORT_CONFIG.MATRIX_TAB);
  if (!sheet) return [];

  var data = sheet.getRange(5, 1, 35, 10).getValues(); // Read up to Col J (Step Progress)
  var activeSteps = [];
  var currentDept = '';

  for (var i = 0; i < data.length; i++) {
    if (data[i][0] && String(data[i][0]).indexOf('#1a365d') === -1) {
      currentDept = _cleanDeptName(String(data[i][0]));
    }
    
    var what = String(data[i][7]); // Col H (Steps)
    var progress = String(data[i][9]); // Col J (Progress)
    
    // Check if it's an active step (contains % but not 0% and not 100% or tick)
    if (progress && progress.indexOf('%') > -1) {
      if (progress.indexOf('0%') === -1 && progress.indexOf('100%') === -1 && progress.indexOf('\u2705') === -1) {
        var cleanWhat = what;
        if (what.indexOf('Step') > -1) {
          cleanWhat = what.substring(what.indexOf('Step')).trim();
        }
        
        var pctStr = progress.match(/\d+%/);
        var pctVal = pctStr ? parseInt(pctStr[0]) : 0;
        var barHTML = '<table width="80" height="10" cellpadding="0" cellspacing="0">'
                    + '<tr>'
                    + '<td width="' + pctVal + '%" style="background:#3182ce;border-radius:3px 0 0 3px;height:10px;"></td>'
                    + '<td width="' + (100 - pctVal) + '%" style="background:#e2e8f0;border-radius:0 3px 3px 0;height:10px;"></td>'
                    + '</tr>'
                    + '</table>'
                    + '<span style="font-size:10px;color:#4a5568;">' + pctVal + '%</span>';

        activeSteps.push({
          dept: currentDept,
          what: cleanWhat,
          progressHTML: barHTML
        });
      }
    }
  }
  return activeSteps;
}

// (Donut generator removed for V7)

// ── BUILD HTML ──────────────────────────────────────────────────
function _buildReportHTML(input, activeSteps) {
  var sheetLink = REPORT_CONFIG.SHEET_URL;
  var pct = parseInt(input.phase5Pct) || 0;
  var noBlocker = (!input.blocker || input.blocker === 'None this week' || input.blocker === '');

  // — Status color mapping —
  var statusColor = '#48bb78'; 
  var statusLabel = '&#x2705; On Track';
  if (input.overallStatus.indexOf('Yellow') >= 0 || input.overallStatus.indexOf('Caution') >= 0) {
    statusColor = '#ecc94b';
    statusLabel = '&#x26A0;&#xFE0F; Caution';
  } else if (input.overallStatus.indexOf('Red') >= 0 || input.overallStatus.indexOf('Risk') >= 0) {
    statusColor = '#fc8181';
    statusLabel = '&#x1F534; At Risk';
  }

  // — Phase Strip (V6) —
  var phaseStrip = ''
    + '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:20px;margin-bottom:8px;">'
    + '<tr>'
    + '<td style="padding:4px;"><div style="background:#c6f6d5;color:#22543d;font-size:10px;padding:6px;border-radius:4px;"><b>&#x2705; P1 Schema Design</b><br><span style="font-weight:normal;">BigQuery isc_scm_ops</span></div></td>'
    + '<td style="padding:4px;"><div style="background:#c6f6d5;color:#22543d;font-size:10px;padding:6px;border-radius:4px;"><b>&#x2705; P2 PIC Identity</b><br><span style="font-weight:normal;">PO owner attribution</span></div></td>'
    + '<td style="padding:4px;"><div style="background:#c6f6d5;color:#22543d;font-size:10px;padding:6px;border-radius:4px;"><b>&#x2705; P3 Issuance</b><br><span style="font-weight:normal;">Material to VPO sync</span></div></td>'
    + '<td style="padding:4px;"><div style="background:#c6f6d5;color:#22543d;font-size:10px;padding:6px;border-radius:4px;"><b>&#x2705; P4 PR Cols</b><br><span style="font-weight:normal;">PR linked + shortage</span></div></td>'
    + '</tr><tr>'
    + '<td style="padding:4px;"><div style="background:#fefcbf;color:#744210;font-size:10px;padding:6px;border-radius:4px;border:1px solid #ecc94b;"><b>&#x1F7E1; P5 Assign Sourcing</b><br><span style="font-weight:normal;">VPO aggregation (' + pct + '%)</span></div></td>'
    + '<td style="padding:4px;"><div style="background:#c6f6d5;color:#22543d;font-size:10px;padding:6px;border-radius:4px;"><b>&#x2705; P6 Analytics</b><br><span style="font-weight:normal;">Nightly email summary</span></div></td>'
    + '<td style="padding:4px;"><div style="background:#c6f6d5;color:#22543d;font-size:10px;padding:6px;border-radius:4px;"><b>&#x2705; P7 Auto-Switch</b><br><span style="font-weight:normal;">Completion vs Iss.</span></div></td>'
    + '<td style="padding:4px;"><div style="background:#c6f6d5;color:#22543d;font-size:10px;padding:6px;border-radius:4px;"><b>&#x2705; P8 Dashboards</b><br><span style="font-weight:normal;">Looker exec visibility</span></div></td>'
    + '</tr></table>';

  // — Department Roadmap / 5W2H Mirror —
  var depts = [
    { icon: '&#x1F4E6;', name: 'Supply Chain',    pct: 87,  color: '#48bb78', status: 'In Testing',   badge: '#c6f6d5', badgeText: '#22543d', what: 'Full MRP system', when: 'Q3 2025 - Q2 2026' },
    { icon: '&#x1F3ED;', name: 'Master Plan',     pct: 5,   color: '#4299e1', status: input.mplStatus, badge: '#bee3f8', badgeText: '#2a4365', what: 'Production scheduling DB', when: 'Q2 2026 - Q3 2026' },
    { icon: '&#x1F91D;', name: 'Customer Svc',    pct: 2,   color: '#4299e1', status: input.csStatus,  badge: '#bee3f8', badgeText: '#2a4365', what: 'SC data exchange formalization', when: 'Q2 2026 - Q3 2026' },
    { icon: '&#x2699;&#xFE0F;', name: 'Production',      pct: 0,   color: '#a0aec0', status: input.prdStatus, badge: '#edf2f7', badgeText: '#4a5568', what: 'Real-time completion sync', when: 'Q3 2026 - Q4 2026' },
    { icon: '&#x1F52C;', name: 'Quality Control', pct: 0,   color: '#a0aec0', status: 'Q4 2026',      badge: '#edf2f7', badgeText: '#4a5568', what: 'Digital inspection & SPC', when: 'Q4 2026 - Q1 2027' },
    { icon: '&#x1F4B0;', name: 'Finance / HR',    pct: 0,   color: '#a0aec0', status: 'Q1 2027',      badge: '#edf2f7', badgeText: '#4a5568', what: 'Automated reconciliation / KPIs', when: 'Q1 2027 - Q2 2027' }
  ];

  var deptRows = '';
  for (var i = 0; i < depts.length; i++) {
    var d = depts[i];
    deptRows += ''
      + '<tr>'
      + '  <td style="padding:10px 10px;font-weight:bold;font-size:12px;color:#2d3748;border-bottom:1px solid #edf2f7;width:18%;">' + d.icon + ' ' + d.name + '</td>'
      + '  <td style="padding:10px 10px;font-size:11px;color:#4a5568;border-bottom:1px solid #edf2f7;width:30%;">' + d.what + '</td>'
      + '  <td style="padding:10px 10px;font-size:11px;color:#4a5568;border-bottom:1px solid #edf2f7;width:18%;">' + d.when + '</td>'
      + '  <td style="padding:10px 10px;border-bottom:1px solid #edf2f7;width:24%;">'
      + '    <div style="background:#e2e8f0;border-radius:6px;height:10px;width:100%;overflow:hidden;margin-bottom:4px;">'
      + '      <div style="background:' + d.color + ';height:100%;width:' + d.pct + '%;border-radius:6px;"></div>'
      + '    </div>'
      + '    <span style="font-size:10px;color:#718096;">' + d.pct + '% Complete</span>'
      + '  </td>'
      + '  <td style="padding:10px 10px;border-bottom:1px solid #edf2f7;width:10%;">'
      + '    <span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:9px;font-weight:bold;background:' + d.badge + ';color:' + d.badgeText + ';text-transform:uppercase;">' + d.status + '</span>'
      + '  </td>'
      + '</tr>';
  }

  // — Active Steps Section (V5) —
  var activeStepsHTML = '';
  if (activeSteps.length > 0) {
    activeStepsHTML += '<div style="margin-top:20px;padding:14px;background:#f7fafc;border-radius:8px;border:1px solid #e2e8f0;">'
      + '<div style="font-size:11px;font-weight:bold;color:#4a5568;text-transform:uppercase;margin-bottom:10px;letter-spacing:0.5px;">&#x1F4CC; Active Steps This Week</div>'
      + '<table cellpadding="0" cellspacing="0" border="0" width="100%">';
    
    for (var k = 0; k < activeSteps.length; k++) {
      var step = activeSteps[k];
      activeStepsHTML += '<tr>'
        + '<td style="padding:4px 0;font-size:12px;color:#2d3748;font-weight:bold;width:15%;">' + step.dept + '</td>'
        + '<td style="padding:4px 0;font-size:12px;color:#4a5568;width:55%;">' + step.what + '</td>'
        + '<td style="padding:4px 0;font-size:12px;color:#2b6cb0;text-align:right;font-family:monospace;width:30%;">' + step.progressHTML + '</td>'
        + '</tr>';
    }
    activeStepsHTML += '</table></div>';
  }

  // — Next actions —
  var actions = [input.nextAction1, input.nextAction2, input.nextAction3];
  var actionCards = '';
  var actionIcons = ['&#x1F3AF;', '&#x1F4C5;', '&#x1F527;'];
  for (var j = 0; j < actions.length; j++) {
    if (actions[j]) {
      actionCards += ''
        + '<div style="display:flex;align-items:flex-start;margin:10px 0;padding:12px 14px;background:#f7fafc;border-radius:6px;border-left:3px solid #2b6cb0;">'
        + '  <span style="font-size:18px;margin-right:10px;">' + actionIcons[j] + '</span>'
        + '  <span style="font-size:13px;color:#2d3748;line-height:1.5;">' + actions[j] + '</span>'
        + '</div>';
    }
  }

  // — Blocker section —
  var blockerHTML = '';
  if (noBlocker) {
    blockerHTML = '<div style="background:#f0fff4;border-left:4px solid #48bb78;padding:12px 16px;border-radius:0 6px 6px 0;margin:8px 0;">'
      + '<span style="font-size:14px;">&#x2705;</span> <strong style="color:#22543d;">No blockers this week</strong>'
      + '</div>';
  } else {
    blockerHTML = '<div style="background:#fffff0;border-left:4px solid #ecc94b;padding:12px 16px;border-radius:0 6px 6px 0;margin:8px 0;">'
      + '<span style="font-size:14px;">&#x26A0;&#xFE0F;</span> <strong style="color:#744210;">' + input.blocker + '</strong>'
      + '</div>';
  }

  // — AI Tool Spotlight (V5 Fix) —
  var aiSection = '';
  if (input.aiHighlight) {
    // V5 FIX: Replace raw emojis with HTML entities to avoid Gmail diamond rendering issue
    var safeAiHighlight = input.aiHighlight
      .replace(/🔒/g, '&#x1F512;')
      .replace(/💰/g, '&#x1F4B0;')
      .replace(/☁️/g, '&#x2601;&#xFE0F;')
      .replace(/💡/g, '&#x1F4A1;');

    aiSection = ''
      + '<div style="padding:20px 28px;border-bottom:1px solid #e2e8f0;">'
      + '  <h2 style="font-size:14px;color:#1a365d;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #805ad5;padding-bottom:6px;">&#x1F916; AI Tool Spotlight</h2>'
      + '  <div style="background:linear-gradient(135deg,#ebf4ff,#e9d8fd);border-radius:8px;padding:16px 18px;border:1px solid #d6bcfa;">'
      + '    <table cellpadding="0" cellspacing="0" border="0"><tr>'
      + '      <td style="vertical-align:top;padding-right:14px;"><span style="font-size:28px;">&#x1F4A1;</span></td>'
      + '      <td>'
      + '        <div style="font-weight:bold;font-size:14px;color:#553c9a;margin-bottom:4px;">Recommended Tool</div>'
      + '        <div style="font-size:13px;color:#44337a;line-height:1.5;">' + safeAiHighlight + '</div>'
      + '        <div style="margin-top:10px;">'
      + '          <span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:10px;font-weight:bold;background:#d6bcfa;color:#553c9a;border:1px solid #b794f4;">&#x1F512; Secure</span>'
      + '          <span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:10px;font-weight:bold;background:#c6f6d5;color:#22543d;border:1px solid #9ae6b4;margin-left:6px;">&#x1F4B0; Free</span>'
      + '          <span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:10px;font-weight:bold;background:#bee3f8;color:#2a4365;border:1px solid #90cdf4;margin-left:6px;">&#x2601;&#xFE0F; Cloud</span>'
      + '        </div>'
      + '      </td>'
      + '    </tr></table>'
      + '  </div>'
      + '</div>';
  }

  // ═══════════════════════════════════════════════════════════════
  // FULL HTML TEMPLATE
  // ═══════════════════════════════════════════════════════════════
  var html = '<!DOCTYPE html>'
  + '<html><head><meta charset="UTF-8"></head>'
  + '<body style="font-family:Arial,Helvetica,sans-serif;background:#f0f4f8;margin:0;padding:20px;color:#2d3748;">'
  + '<div style="width:100%;max-width:900px;margin:0 auto;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.10);">'

  // ── HEADER ──
  + '<div style="background:linear-gradient(135deg,#1a365d 0%,#2b6cb0 60%,#3182ce 100%);color:#ffffff;padding:28px 28px 22px;">'
  + '  <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;opacity:0.7;margin-bottom:6px;">ISC Digital Transformation</div>'
  + '  <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>'
  + '    <td style="vertical-align:bottom;">'
  + '      <h1 style="margin:0;font-size:22px;letter-spacing:0.3px;">&#x1F3ED; Digitalization Weekly Report</h1>'
  + '      <p style="margin:8px 0 0;font-size:13px;opacity:0.85;">' + input.weekNumber + ' &nbsp;&#x2502;&nbsp; ' + input.dateRange + '</p>'
  + '    </td>'
  + '    <td style="vertical-align:bottom;text-align:right;">'
  + '      <div style="display:inline-block;padding:4px 16px;border-radius:20px;font-size:12px;font-weight:bold;background:' + statusColor + ';color:#ffffff;margin-bottom:8px;">' + statusLabel + '</div>'
  + '      <p style="margin:0;font-size:12px;opacity:0.7;">Prepared by: Nguy&#7877;n Duy Kh&#225;nh<br><a href="mailto:dk@isconline.vn" style="color:#bee3f8;text-decoration:none;">dk@isconline.vn</a></p>'
  + '    </td>'
  + '  </tr></table>'
  + '</div>'

  // ── THIS WEEK AT A GLANCE ──
  + '<div style="padding:20px 28px;border-bottom:1px solid #e2e8f0;">'
  + '  <h2 style="font-size:14px;color:#1a365d;margin:0 0 14px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #2b6cb0;padding-bottom:6px;">&#x1F4CC; This Week at a Glance</h2>'
  + '  <table cellpadding="0" cellspacing="0" border="0" width="100%">'
  + '    <tr>'
  + '      <td style="padding:8px 0;vertical-align:top;width:26px;"><span style="font-size:16px;">&#x2705;</span></td>'
  + '      <td style="padding:8px 0;font-size:13px;color:#2d3748;line-height:1.5;">' + input.achievement1 + '</td>'
  + '    </tr>'
  + '    <tr>'
  + '      <td style="padding:8px 0;vertical-align:top;"><span style="font-size:16px;">&#x2705;</span></td>'
  + '      <td style="padding:8px 0;font-size:13px;color:#2d3748;line-height:1.5;">' + input.achievement2 + '</td>'
  + '    </tr>'
  + '  </table>'
  + blockerHTML
  + '</div>'

  // ── SCM STATUS DASHBOARD ──
  + '<div style="padding:20px 28px;border-bottom:1px solid #e2e8f0;">'
  + '  <h2 style="font-size:14px;color:#1a365d;margin:0 0 14px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #2b6cb0;padding-bottom:6px;">&#x1F4CA; SCM Database Dashboard</h2>'
  + '  <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>'
  + '    <td width="50%" style="padding:0 6px 0 0;vertical-align:top;">'
  + '      <div style="background:#f0fff4;border:1px solid #c6f6d5;border-radius:8px;padding:16px 12px;text-align:center;">'
  + '        <div style="font-size:28px;margin-bottom:6px;">&#x1F49A;</div>'
  + '        <div style="font-size:13px;font-weight:bold;color:#22543d;">' + input.systemHealth + '</div>'
  + '        <div style="font-size:11px;color:#718096;margin-top:4px;">System Health</div>'
  + '      </div>'
  + '    </td>'
  + '    <td width="50%" style="padding:0 0 0 6px;vertical-align:top;">'
  + '      <div style="background:#ebf8ff;border:1px solid #bee3f8;border-radius:8px;padding:16px 12px;text-align:center;">'
  + '        <div style="font-size:28px;margin-bottom:6px;">&#x2699;&#xFE0F;</div>'
  + '        <div style="font-size:20px;font-weight:bold;color:#2a4365;">4</div>'
  + '        <div style="font-size:11px;color:#718096;margin-top:4px;">Active Modules</div>'
  + '      </div>'
  + '    </td>'
  + '  </tr></table>'

  // Testing Note
  + '  <div style="margin-top:14px;padding:10px 14px;background:#fffaf0;border-radius:6px;border:1px solid #fefcbf;">'
  + '    <span style="font-size:13px;">&#x1F50D;</span> <strong style="font-size:12px;color:#744210;">Testing Focus:</strong> '
  + '    <span style="font-size:12px;color:#744210;">' + input.testingNote + '</span>'
  + '  </div>'

  // V5 Phase Strip
  + phaseStrip

  + '</div>'

  // ── 5W2H MATRIX SUMMARY ──
  + '<div style="padding:20px 28px;border-bottom:1px solid #e2e8f0;">'
  + '  <h2 style="font-size:14px;color:#1a365d;margin:0 0 14px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #38a169;padding-bottom:6px;">&#x1F5FA;&#xFE0F; 5W2H Matrix Summary</h2>'
  + '  <div style="overflow-x:auto;">'
  + '    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="min-width:600px;">'
  + '      <tr style="background:#2d3748;">'
  + '        <th style="padding:8px 10px;text-align:left;font-size:11px;color:#ffffff;text-transform:uppercase;border-radius:4px 0 0 0;">&#x1F3E2; DEPT</th>'
  + '        <th style="padding:8px 10px;text-align:left;font-size:11px;color:#ffffff;text-transform:uppercase;">&#x2753; WHAT</th>'
  + '        <th style="padding:8px 10px;text-align:left;font-size:11px;color:#ffffff;text-transform:uppercase;">&#x1F4C5; WHEN</th>'
  + '        <th style="padding:8px 10px;text-align:left;font-size:11px;color:#ffffff;text-transform:uppercase;">&#x1F4C8; PROGRESS</th>'
  + '        <th style="padding:8px 10px;text-align:left;font-size:11px;color:#ffffff;text-transform:uppercase;border-radius:0 4px 0 0;">STATUS</th>'
  + '      </tr>'
  + deptRows
  + '    </table>'
  + '  </div>'

  // V5 Active Steps Section
  + activeStepsHTML

  + '</div>'

  // ── AI TOOL SPOTLIGHT ──
  + aiSection

  // ── NEXT WEEK ──
  + '<div style="padding:20px 28px;border-bottom:1px solid #e2e8f0;">'
  + '  <h2 style="font-size:14px;color:#1a365d;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #dd6b20;padding-bottom:6px;">&#x1F4CB; Next Week&#39;s Actions</h2>'
  + actionCards
  + '</div>'

  // ── FOOTER ──
  + '<div style="padding:20px 28px;background:#f7fafc;font-size:12px;color:#718096;line-height:1.8;">'
  + '  <strong style="color:#2d3748;">ISC Digital Transformation</strong> &nbsp;&#x2502;&nbsp; Powered by Google Cloud<br>'
  + '  &#x1F4C1; Full Action Plan: <a href="' + sheetLink + '" style="color:#2b6cb0;text-decoration:none;">ISC_DigitalizationReport_4PMFriday</a><br>'
  + '  &#x1F4E7; Contact: <a href="mailto:dk@isconline.vn" style="color:#2b6cb0;text-decoration:none;">dk@isconline.vn</a>'
  + '</div>'

  + '</div>' // wrapper
  + '</body></html>';

  return html;
}

// ── SUBJECT LINE ────────────────────────────────────────────────
function _buildSubject(input) {
  var now = new Date();
  var monthYear = Utilities.formatDate(now, REPORT_CONFIG.TIMEZONE, 'MMMM yyyy');
  return '[ISC Weekly] Digitalization Report - ' + input.weekNumber + ', ' + monthYear;
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