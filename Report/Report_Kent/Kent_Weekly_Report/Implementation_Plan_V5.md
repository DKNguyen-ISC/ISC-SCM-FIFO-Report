# Implementation Plan V5: 5W2H Action-Plan Matrix & Email V5
*Date: 2026-03-13 | Status: AWAITING USER APPROVAL*

---

## 0. Summary of Changes from V4 → V5

| # | V4 | V5 Change | Rationale |
|---|---|---|---|
| 1 | Phase strip: `Phase 1 ✅` (no description) | Each phase gets a **label**: `Phase 1 — Schema ✅` | Kent needs to know *what* each phase is |
| 2 | WHAT column: all steps in one cell via `\n` | **Separate row per step** — Department cell merged | Each step aligns its own WHY, WHEN, PROGRESS horizontally |
| 3 | STEP PROGRESS: ✅/🟡 checkmarks | **Mini progress bars** (Unicode `████░░` per step) | Visual scan → no reading required |
| 4 | Column A: "Index" (P1, P2…) | **Column removed entirely** | User request — department column is sufficient |
| 5 | WHO MPL: "Khánh (build), Dương & Cường (use)" | **"Khánh & Dương (build), Dương & Cường (use)"** | User correction |
| 6 | Dashboard email: generic dept list | **Emoji-illustrated** departments + email mirrors 5W2H structure | Email = visual summary of the sheet |

---

## 1. 5W2H Matrix — New Architecture

### 1.1 Column Schema (10 Columns — Index removed)

| Col | Header | Content | Merge? |
|---|---|---|---|
| A | 🏢 **Department** | Dept name + emoji icon | ↕ Merged across all step rows |
| B | ❓ **WHAT — Action Steps** | One step per row (numbered with emoji) | One per row |
| C | ⚡ **WHY — Pains & Gains** | ❌ Pain or ✅ Gain for that specific step | One per row |
| D | 📅 **WHEN — Timeline** | Specific date/quarter for that step | One per row |
| E | 👤 **WHO (Owner)** | Builder + Users | ↕ Merged |
| F | 📍 **WHERE — Focus Area** | Material Planning / Procurement etc. | ↕ Merged |
| G | 🔧 **HOW TO — Tools + Steps** | Tech approach for that specific step | One per row |
| H | 💰 **HOW MUCH (Cost)** | Monthly infra cost | ↕ Merged |
| I | 📊 **Step Progress** | Mini progress bar per step: `████████░░ 80%` | One per row |
| J | 📈 **Total %** | Single bar + number for entire department | ↕ Merged |

### 1.2 Merged Cell Design

For Supply Chain (8 steps), the sheet would look like this in structure:

```
┌─────────────┬──────────────────────┬────────────────┬──────────┬──────────┬──────────┬──────────┬──────┬─────────────┬──────────┐
│  Dept       │  WHAT                │  WHY           │  WHEN    │  WHO     │  WHERE   │  HOW TO  │ COST │ Step Prog.  │ Total %  │
│  (MERGED)   │                      │                │          │ (MERGED) │ (MERGED) │          │(MRGD)│             │ (MERGED) │
├─────────────┼──────────────────────┼────────────────┼──────────┤          │          ├──────────┤      ├─────────────┤          │
│             │ 📐 Step 1: Schema    │ ❌ No structure │ 2025 Q3  │          │          │ BigQuery │      │ ██████████ ✅│          │
│  📦         │ ⚙️ Step 2: M1 Plan   │ ❌ Manual chase │ 2025 Q3  │ Khánh    │ Material │ GSheet+  │ ~$15 │ ██████████ ✅│ ████████ │
│  Supply     │ 🌙 Step 3: M2 MRP    │ ✅ Auto 4AM    │ 2025 Q4  │ (build)  │Planning  │ Apps     │ /mo  │ ██████████ ✅│ ░░       │
│  Chain      │ 🛒 Step 4: M3 Procure│ ✅ PR→PO auto  │ 2025 Q4  │          │    +     │ Script   │      │ ██████████ ✅│          │
│  (SC)       │ 🔄 Step 5: M4 Issue  │ ✅ ±0 variance │ 2026 Mar │ Phương,  │Procure-  │ + BQ SP  │      │ ██████████ ✅│  87%     │
│             │ 🖥️ Step 6: Phase 5   │ 🟡 BOM_TOL fix│ 2026 Apr │ Nam,Nga, │ ment     │ + Looker │      │ ██████░░░░ 65│          │
│             │ 📊 Step 7: Looker    │ ✅ Dashboard   │ 2026 Feb │ Thang    │ Flow     │ Studio   │      │ ██████████ ✅│          │
│             │ 🔧 Step 8: Calibrate │ 🟡 Testing     │ Ongoing  │ (use)    │          │ Testing  │      │ ████░░░░░░ 40│          │
└─────────────┴──────────────────────┴────────────────┴──────────┴──────────┴──────────┴──────────┴──────┴─────────────┴──────────┘
```

**Key design principle:** Each row is one `WHAT` step. The columns WHY, WHEN, HOW TO, and Step Progress are **per-step** (not merged). The columns Department, WHO, WHERE, COST, and Total % are **merged** across all steps for that department.

### 1.3 Step Progress vs Total% — Smart Design

> [!IMPORTANT]
> The user raised the concern that progress bars might overlap with Total%. Here is the design solution:

- **Col I (Step Progress):** Uses a **narrow horizontal bar** (5 chars wide): `█████ ✅` or `███░░ 65%`
  - Color: **blue** fill (neutral per-step)
  - Width: 100px column
- **Col J (Total%):** Uses a **tall vertical merged cell** with one large number + a colored background band
  - SC: `87%` with green-tinted cell background
  - MPL: `5%` with blue-tinted cell background
  - Others: `0%` with gray-tinted cell background
  - Font size: **16pt bold** — visually dominant, clearly the summary number

This creates a clear **detail → summary** reading flow: scan all step bars left → see the final number right.

---

## 2. Supply Chain (SC) Row — Complete Content

### Col A — Department (Merged, 8 rows)
```
📦 Supply Chain
(SC)
```

### Col B–C–D–G–I — Per-Step Rows (8 rows)

| Row | B: WHAT | C: WHY | D: WHEN | G: HOW TO | I: Step Progress |
|---|---|---|---|---|---|
| 1 | 📐 Schema Design (ERD + BigQuery tables) | ❌ No structured database for MRP data | ✅ 2025 Q3 | BigQuery `isc_scm_ops` dataset | ██████████ 100% |
| 2 | ⚙️ M1 Planning — PO Import + BOM Mastering | ❌ Manual PO chase via email/phone | ✅ 2025 Q3 | GSheets Zone A/B + Apps Script | ██████████ 100% |
| 3 | 🌙 M2 Balancing — Nightly MRP + Shortage Calc | ❌ 60+ min/day manual shortage Excel | ✅ 2025 Q4 | Apps Script trigger (4 AM) + HTML email | ██████████ 100% |
| 4 | 🛒 M3 Procurement — PR→PO + Supplier Hub | ❌ PR/PO in separate files, no consolidation | ✅ 2025 Q4 | BigQuery SP + GSheet injection portal | ██████████ 100% |
| 5 | 🔄 M4 Execution — Lead Issuance + ZXH Sync | ❌ Issuance data mismatch per VPO | ✅ 2026 Mar | SP_M4_ISSUANCE_MERGE + weekly protocol | ██████████ 100% |
| 6 | 🖥️ Phase 5 — Assign Sourcing (BOM aggregation) | 🟡 VPO non-aggregation → over-ordering risk | 🟡 2026 Q1–Q2 | BigQuery VIEW redesign + UI dialog | ██████░░░░ 65% |
| 7 | 📊 Looker Studio Executive Dashboard | ✅ Kent real-time visibility | ✅ 2026 Feb | Looker Studio → BigQuery views | ██████████ 100% |
| 8 | 🔧 Calibration — BOM_TOLERANCE resolution | 🟡 CS 3–20% vs ISC 10% mismatch | 🟡 Ongoing | Custom tolerance override per BOM | ████░░░░░░ 40% |

### Col E — WHO (Merged)
```
🛠 Khánh (build)
👥 Phương, Nam, Nga, Thang (SC team)
```

### Col F — WHERE (Merged)
```
📦 Material Planning:
 • BOM demand calculation
 • MOQ/SPQ rounding
 • Shortage pipeline

🛒 Procurement Flow:
 • PR → PO consolidation
 • Supplier portal
 • ZXH auto-sync
```

### Col H — HOW MUCH (Merged)
```
💰 ~$15/month (BigQuery)
👤 Dev: Khánh (internal)
⏱ 8 months total
```

### Col J — Total % (Merged)
```
87%
```
Cell BG: `#c6f6d5` (green tint), Font: 16pt bold, Unicode bar above: `████████░░`

---

## 3. Other Department Rows

### MPL (Master Plan) — 4 Steps

| Row | WHAT | WHY | WHEN | HOW TO | Step Prog |
|---|---|---|---|---|---|
| 1 | 🔍 Discovery — Interview MPL leads | ❌ SC reads manual MPL schedules | 🟡 2026 Q2 | 5W-2H worksheet | ████░░░░░░ 40% |
| 2 | 📝 Design — Scheduling DB + ERD | ❌ No real-time capacity view | ⬜ 2026 Q2 | BigQuery schema + GSheet | ░░░░░░░░░░ 0% |
| 3 | ⚙️ Build — Scheduling engine + SC sync | ✅ Auto-sync with SC demand | ⬜ 2026 Q3 | Apps Script + BQ views | ░░░░░░░░░░ 0% |
| 4 | 🚀 Pilot — Run parallel with manual | ✅ Verified before cutover | ⬜ 2026 Q3 | User testing protocol | ░░░░░░░░░░ 0% |

**WHO:** `🛠 Khánh & Dương (build) | 👥 Dương & Cường (use)`
**WHERE:** Production scheduling, Resource allocation
**Total:** `5%` (blue tint)

### CS (Customer Service) — 3 Steps

| Row | WHAT | WHY | WHEN |
|---|---|---|---|
| 1 | 🔍 Formalize CS↔SC data exchange protocol | ❌ CS date/qty changes cause most SC errors | ⬜ Q2–Q3 2026 |
| 2 | 📊 Build CS discrepancy dashboard | ✅ Auto-detect order changes | ⬜ Q3 2026 |
| 3 | 🚀 Extend M1 CS Protocol to full lifecycle | ✅ Close order lifecycle loop | ⬜ Q3 2026 |

**WHO:** `🛠 Khánh (build) | 👥 CS Team Lead (use)`
**Total:** `2%` (blue tint)

### PRD (Production) — 3 Steps

| Row | WHAT | WHY | WHEN |
|---|---|---|---|
| 1 | 🔍 Map completion reporting → digital entry | ❌ 3 depts wait for manual production emails | ⬜ Q3 2026 |
| 2 | ⚙️ Floor form → BQ auto-sync | ✅ Real-time factory visibility | ⬜ Q3 2026 |
| 3 | 📊 Completion dashboard for SC/MPL/CS | ✅ Closed-loop visibility chain | ⬜ Q4 2026 |

**WHO:** `🛠 Khánh (build) | 👤 Ha (digit. execution)`
**Total:** `0%` (gray)

### QC — 3 Steps

| Row | WHAT | WHY | WHEN |
|---|---|---|---|
| 1 | 📝 Digital inspection checklists | ❌ Paper = data loss risk | ⬜ Q4 2026 |
| 2 | 📊 Defect tracking + SPC charts | ✅ Pattern detection across batches | ⬜ Q4 2026 |
| 3 | 📋 CAPA management reports | ✅ Defect → root cause → fix loop | ⬜ Q1 2027 |

**WHO:** `🛠 Khánh (build) | 👥 Vic & Quynh (use)`
**Total:** `0%` (gray)

### Finance — 2 Steps

| Row | WHAT | WHY | WHEN |
|---|---|---|---|
| 1 | 🔗 PO-Invoice reconciliation (bridge M3) | ❌ Manual PO-invoice matching delays | ⬜ Q1 2027 |
| 2 | 📊 Cost variance dashboard | ✅ Budget tracking in real-time | ⬜ Q1 2027 |

**Total:** `0%` (gray)

### HR/Admin — 2 Steps

| Row | WHAT | WHY | WHEN |
|---|---|---|---|
| 1 | 📝 Attendance tracking (GForm → BQ) | ❌ Manual attendance = data errors | ⬜ Q1 2027 |
| 2 | 📊 Employee KPI dashboard + monthly email | ✅ Automated monthly summary | ⬜ Q2 2027 |

**Total:** `0%` (gray)

---

## 4. Total Row Count in 5W2H_Matrix

| Dept | Steps | Rows |
|---|---|---|
| SC | 8 | 8 |
| MPL | 4 | 4 |
| CS | 3 | 3 |
| PRD | 3 | 3 |
| QC | 3 | 3 |
| Finance | 2 | 2 |
| HR | 2 | 2 |
| **Total** | **25** | **25 data rows** |

Plus: 1 title row + 1 subtitle row + 1 header row = **28 rows total**.

---

## 5. Email V5 Changes (`Code.gs`)

### 5.1 Phase Strip with Descriptions

Replace the generic `Phase 1 ✅` with labeled pills:

```
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐
│ ✅ P1 — Schema       │  │ ✅ P2 — PIC Identity │  │ ✅ P3 — Issuance │
└──────────────────────┘  └──────────────────────┘  └──────────────────┘
┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐
│ ✅ P4 — PR Columns   │  │ 🟡 P5 — Sourcing    │  │ ✅ P6 — Analytics│
└──────────────────────┘  └──────────────────────┘  └──────────────────┘
┌──────────────────────┐  ┌──────────────────────┐
│ ✅ P7 — Auto-Switch  │  │ ✅ P8 — Looker      │
└──────────────────────┘  └──────────────────────┘
```

Each pill: `background: #c6f6d5` (green) for complete, `background: #fefcbf` (yellow) for active.

### 5.2 Department Roadmap with Emojis

| Email Dept Row | Emoji |
|---|---|
| 📦 Supply Chain | 📦 |
| 🏭 Master Plan | 🏭 |
| 🤝 Customer Service | 🤝 |
| ⚙️ Production | ⚙️ |
| 🔬 Quality Control | 🔬 |
| 💰 Finance / HR | 💰 |

### 5.3 Email Dashboard = Visual Mirror of 5W2H

After the dept roadmap, add a compact **"What's Active"** section that shows only steps currently in progress (pulled from the 5W2H logic):

```
📌 ACTIVE STEPS THIS WEEK
───────────────────────────────────────
📦 SC  │ Step 6: Assign Sourcing Dialog  │ ██████░░ 65%
📦 SC  │ Step 8: BOM_TOLERANCE fix       │ ████░░░░ 40%
🏭 MPL │ Step 1: Discovery interviews    │ ████░░░░ 40%
```

This directly mirrors the 5W2H sheet's Step Progress column, so Kent sees the same data in both email and spreadsheet. Only non-100%/non-0% steps appear.

### 5.4 Other V5 Fixes (Carried from V4)

- "Ngàn's team" → **"SC team"**
- AI card body emojis → HTML entities
- SVG donut for 65% centered

---

## 6. Tab Protection (Same as V4)

- `Weekly_Input` → `hideSheet()` + `protect()` → only `dk@isconline.vn`
- `Report_Log` → `hideSheet()` + `protect()` → only `dk@isconline.vn`
- `5W2H_Matrix` → **visible** (Kent's primary view)

---

## 7. Implementation Approach for Merged Cells in Apps Script

> [!NOTE]
> Google Apps Script merge cells via `sheet.getRange(startRow, col, numRows, 1).merge()`. For SC with 8 steps, columns A, E, F, H, J will each call `.merge()` across 8 rows.

```javascript
// Pseudocode for SC block:
var scStartRow = 4;
var scSteps = 8;

// Merge: Department (Col A)
sheet.getRange(scStartRow, 1, scSteps, 1).merge()
  .setValue('📦 Supply Chain\n(SC)')
  .setVerticalAlignment('middle');

// Merge: WHO (Col E)
sheet.getRange(scStartRow, 5, scSteps, 1).merge()
  .setValue('🛠 Khánh (build)\n👥 Phương, Nam, Nga,\nThang (SC team)');

// Merge: WHERE (Col F)
sheet.getRange(scStartRow, 6, scSteps, 1).merge()
  .setValue('📦 Material Planning:\n • BOM demand\n • MOQ/SPQ\n\n🛒 Procurement Flow:\n • PR → PO\n • Supplier portal');

// Merge: HOW MUCH (Col H)
sheet.getRange(scStartRow, 8, scSteps, 1).merge()
  .setValue('💰 ~$15/month\n👤 Khánh\n⏱ 8 months');

// Merge: Total % (Col J)
sheet.getRange(scStartRow, 10, scSteps, 1).merge()
  .setValue('87%')
  .setFontSize(16).setFontWeight('bold');

// Per-step rows: WHAT (B), WHY (C), WHEN (D), HOW TO (G), Step Progress (I)
for (var i = 0; i < scSteps; i++) {
  sheet.getRange(scStartRow + i, 2).setValue(scWhatData[i]);
  sheet.getRange(scStartRow + i, 3).setValue(scWhyData[i]);
  // ... etc
}
```

---

## 8. Visual Styling Rules

| Element | Style |
|---|---|
| Department merged cell | Large font (12pt), bold, emoji prefix, **vertical-align center** |
| WHAT step text | 10pt, emoji prefix per step, wrap text |
| WHY cell | Green font for ✅ GAIN, Red font for ❌ PAIN, Amber for 🟡 |
| WHEN cell | Green BG for ✅, Yellow BG for 🟡, Gray BG for ⬜ |
| Step Progress bar | Unicode `████░░` in blue, right-aligned % |
| Total % cell | 16pt bold, colored background band matching dept status |
| Row heights | 32px per step row (consistent, compact) |
| Dept separator | 2px bottom border between department blocks |

---

## 9. Files to Modify

| File | Changes |
|---|---|
| **`SheetBuilder.gs`** | Full rewrite of `_build5W2HMatrixTab()` — 25 data rows, merged cells, progress bars, 10 columns |
| **`Code.gs`** | Phase strip with labels, dept emoji icons, "Active Steps" section, SC team rename, AI emoji fix |

---

## 10. Verification Plan

1. Run `admin_SetupAllTabs()` → Confirm 3 tabs, 2 hidden+protected, 5W2H visible
2. 5W2H_Matrix: verify 25 step rows, merged Department/WHO/WHERE/COST/Total cells, per-step progress bars
3. Run `generateAndSendWeeklyReport()` → Verify:
   - Phase strip with 8 labeled pills
   - Dept roadmap with 📦🏭🤝⚙️🔬💰 emojis
   - "Active Steps" section showing only in-progress items
   - No emoji diamonds in AI card
4. Share sheet with test viewer → confirm hidden tabs are invisible

---

*Awaiting your approval before I write the code. Please review carefully — this is a significant structural change to the 5W2H Matrix.*
