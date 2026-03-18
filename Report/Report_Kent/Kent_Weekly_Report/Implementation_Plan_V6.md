# Implementation Plan V6: 5W2H Structural Overhaul & Email Fixes
*Date: 2026-03-13 | Status: AWAITING USER APPROVAL*

---

## 0. Summary of Changes V5 → V6

| # | Area | Change |
|---|---|---|
| 1 | Sheet | Add separator rows between department blocks |
| 2 | Sheet | WHAT → revert to one merged high-level description per dept |
| 3 | Sheet | HOW TO → split into 2 sub-columns (Steps + Tools) under merged header |
| 4 | Sheet | Step Progress → move to sit beside Steps/Tools columns |
| 5 | Sheet | WHEN → visual mini-timeline per dept |
| 6 | Sheet | WHY → split into Pain (top 3) and Gain (top 3) sub-columns, dept-level |
| 7 | Sheet | HOW MUCH → cost/money only (no WHO repetition) |
| 8 | Email | SVG donut disappeared → replace with Gmail-safe CSS ring (proven V4 method) |
| 9 | Email | Phase strip → add phase descriptions and context to support the donut |
| 10 | Email | Active Steps emoji breaking `������` → strip emoji from dept name when displaying in HTML |
| 11 | Email | Active Steps progress bar → replace Unicode blocks with an HTML table-based bar |

---

## 1. New 5W2H Sheet Column Architecture

### 1.1 Column Schema — 14 Columns

```
A           B          C        D       E       F     G       H          I       J         K           L
DEPT    │  WHAT   │  Pain  │  Gain  │ WHEN  │ WHO  │WHERE │  Steps  │ Tools  │ Prog.  │ HOW MUCH  │ Total%
(merged)│(merged) │(merged)│(merged)│(merge.)│(mrgd)│(mrgd)│ per row │per row │per row │  (merged) │(merged)
```

**Merged Headers (Row 3):**
- Cols C & D are spanned under a single header: **`⚡ WHY`**
- Cols H & I are spanned under a single header: **`🔧 HOW TO`**

This is done with a **Row 3A (header spans)** and a **Row 3B (sub-column labels)** approach:
- Row 3: mega headers merging WHY and HOW TO
- Row 4: sub-column labels (Pain | Gain under WHY; Steps | Tools under HOW TO)

### 1.2 Separator Rows

Between each department block, a full-width separator row is inserted:
- Spans all 14 columns
- Background: `#1a365d` (dark navy)
- Height: 6px
- No text

### 1.3 WHAT Column (Reverted)

WHAT returns to a **single merged cell per department** (not per step). It describes the product/outcome we build for that department at a high level. This is the "what" answer to Kent's question: *"What are we building for this team?"*

Examples:
- SC: `📋 Full MRP system — 4 modules covering Planning, Balancing, Procurement, and Execution`
- MPL: `📅 Production scheduling database with real-time sync to SC demand`
- CS: `🔄 Formalized CS ↔ SC data exchange with automated discrepancy detection`
- PRD: `⚙️ Real-time completion dashboard with auto-sync to SC, MPL, and CS`

### 1.4 WHY — Pain | Gain Sub-Columns

Each department gets **3 pains (❌)** and **3 gains (✅)** at the department level (not per step). The pain and gain are aligned so that Gain row 1 solves Pain row 1.

**Format inside the merged cells:**
```
Pain (Col C)                     │ Gain (Col D)
─────────────────────────────────┼────────────────────────────
❌ 60+ min/day manual shortage   │ ✅ Auto 4AM run — data ready
❌ 5 Excel files cross-referenced│ ✅ One BigQuery source of truth
❌ BOM_TOLERANCE mismatch        │ ✅ Override framework planned
```

### 1.5 WHEN Column — Visual Timeline

The WHEN column uses text-based visual timeline formatting:
```
2025Q3 ━━●━━━━━━━━━━━━━━━ 2026Q2
          ↑ Schema      ↑ Phase5
```
Implemented as structured text with careful Unicode arrows. For each department this shows the start point, an active milestone, and the expected completion.

### 1.6 HOW TO — Steps Sub-Column (H) + Tools Sub-Column (I)

The per-step rows from V5 WHAT column **move to Col H (Steps)**. Col I shows the corresponding tool stack for each step.

**Example SC rows under HOW TO:**

| H: Steps | I: Tools |
|---|---|
| 📐 Step 1: Schema Design & ERD | BigQuery (`isc_scm_ops`) |
| ⚙️ Step 2: M1 Planning — PO Import | GSheets Zone A/B + Apps Script |
| 🌙 Step 3: M2 Nightly MRP (4 AM) | Apps Script Trigger + HTML Email |
| 🛒 Step 4: M3 PR→PO + Supplier Hub | BigQuery SP + GSheet Portal |
| 🔄 Step 5: M4 Lead Issuance Sync | SP_M4_ISSUANCE_MERGE |
| 🖥️ Step 6: Phase 5 — BOM Aggregation | BigQuery VIEW + UI Dialog |
| 📊 Step 7: Looker Studio Dashboard | Looker Studio → BQ Views |
| 🔧 Step 8: BOM_TOLERANCE Resolution | Custom tolerance override per BOM |

### 1.7 Step Progress (Col J) — Beside Steps

Step Progress remains per-row, but now lives in **Col J**, directly after Tools (Col I). Format: Unicode bar `████░░ 65%` per step row.

### 1.8 HOW MUCH — Cost Only (Col K)

Merged per dept. Only mentions money:

| Dept | Cost |
|---|---|
| SC | ~$15 / month |
| MPL | ~$10 / month |
| CS | ~$10 / month |
| PRD | ~$10 / month |
| QC | ~$10 / month |
| Finance | ~$10 / month |
| HR | ~$5 / month |
| **Total** | **~$70 / month max** |

---

## 2. Full Row Count with Separators

| Block | Rows |
|---|---|
| Header Row 1 (Title) | 1 |
| Header Row 2 (Subtitle) | 1 |
| Header Row 3 (Column Headers — mega) | 1 |
| Header Row 4 (Sub-column labels) | 1 |
| SC: separator + 8 step rows | 9 |
| MPL: separator + 4 step rows | 5 |
| CS: separator + 3 step rows | 4 |
| PRD: separator + 3 step rows | 4 |
| QC: separator + 3 step rows | 4 |
| Finance: separator + 2 step rows | 3 |
| HR: separator + 2 step rows | 3 |
| **Total Rows** | **35** |

---

## 3. Email V6 Fixes (`Code.gs`)

### 3.1 SVG Donut Disappeared → Gmail-Safe CSS Ring

Gmail strips `<svg>` tags in most clients. The V4 approach (CSS borders) was actually correctly rendering. We will **revert to the proven CSS ring** with one improvement: the `%` is now centered using a nested `<table>` instead of CSS `display:flex` (which Gmail strips).

```html
<!-- Gmail-safe donut: table-in-table centering -->
<table width="70" height="70" cellpadding="0" cellspacing="0">
  <tr>
    <td align="center" valign="middle"
        style="border-radius:50%;
               border:6px solid #e2e8f0;
               border-top:6px solid #3182ce;
               border-right:6px solid #3182ce;
               width:58px;height:58px;">
      <span style="font-size:16px;font-weight:bold;color:#1a365d;">65%</span>
    </td>
  </tr>
</table>
```

### 3.2 Phase Strip — With Context & Description

The current pills show too little information. V6 redesign:

**4-column table, 2 rows, each phase has:**
- Phase number + short name
- Status badge (✅ or 🟡)
- One-line description

```
┌─────────────────────────────────────────────────────────────────────┐
│ ✅ P1 — Schema Design     │ ✅ P2 — PIC Identity     │ ...          │
│ BigQuery DB + ERD         │ PO owner attribution     │              │
├─────────────────────────────────────────────────────────────────────┤
│ 🟡 P5 — Assign Sourcing   │ ...                                     │
│ VPO aggregation (ACTIVE)  │                                         │
└─────────────────────────────────────────────────────────────────────┘
```

Full phase descriptions to include:

| Phase | Name | Description |
|---|---|---|
| P1 | Schema Design | BigQuery `isc_scm_ops` — all 4 module tables |
| P2 | PIC Identity | PO ownership attribution resolved |
| P3 | Issuance AutoSync | Material issuance tied to VPOs automatically |
| P4 | PR Dual Columns | Procurement request linked to shortage data |
| P5 | Assign Sourcing | VPO→BOM-level aggregation (ACTIVE — 65%) |
| P6 | Analytics Email | M2 nightly email with shortage summary |
| P7 | Auto-Switch Logic | System picks Completion vs Issuance method |
| P8 | Looker Dashboard | Executive real-time visibility |

### 3.3 Active Steps — Fix Emoji Display

**Root cause:** `_readActiveSteps()` reads the dept name from Col A of the merged cell. The stored string `📦 Supply Chain\n(SC)` contains raw emoji Unicode (surrogate pairs like `\uD83D\uDCE6`). When injected raw into HTML, Gmail renders these as `������`.

**Fix:** Strip the first emoji character and extract only the clean ASCII dept name:

```javascript
function _cleanDeptName(raw) {
  // Remove everything up to and including the first space (the emoji)
  // Also remove newline and anything after it
  return raw.replace(/^[\uD800-\uDFFF\u0080-\uFFFF\s]+/, '')
            .split('\n')[0]
            .trim();
}
```

Use named HTML entity dept icons instead of raw emoji in the HTML output.

### 3.4 Active Steps Progress Bar — HTML Table Bar

Replace the Unicode `███░░` characters with an inline-HTML bar that renders correctly in all clients:

```html
<td>
  <table width="80" height="10" cellpadding="0" cellspacing="0">
    <tr>
      <td width="65%" style="background:#3182ce;border-radius:3px 0 0 3px;height:10px;"></td>
      <td width="35%" style="background:#e2e8f0;border-radius:0 3px 3px 0;height:10px;"></td>
    </tr>
  </table>
  <span style="font-size:10px;color:#4a5568;">65%</span>
</td>
```

---

## 4. Files to Modify

| File | Changes |
|---|---|
| **`SheetBuilder.gs`** | Full rewrite: 14-col schema, 2-row merged headers, dept separator rows, WHAT reverted, WHY split Pain/Gain, HOW TO split Steps/Tools |
| **`Code.gs`** | Fix: CSS donut, Phase strip with context, Active Steps dept name cleaning, HTML progress bar |

---

## 5. Verification Plan

1. Run `admin_SetupAllTabs()` → confirm separator rows visible between dept blocks, 4-row header, 14 columns.
2. Verify SC block: WHAT is 1 merged cell, WHY has Pain col and Gain col, HOW TO has Steps and Tools cols, Step Progress is beside Tools.
3. Run `generateAndSendWeeklyReport()` → confirm:
   - CSS donut renders with % in center
   - Phase strip shows 4-column layout with descriptions
   - Active Steps shows clean dept name (not `������`)
   - Active Steps bar renders as colored HTML table bar

---

*Awaiting your approval before I write code.*
