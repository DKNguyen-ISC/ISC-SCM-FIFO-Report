# Pre-Implementation Plan V4: 5W2H Matrix Deep Upgrade
*Date: 2026-03-13 | Status: Awaiting User Approval Before Execution*

---

## 0. Goal Summary

Transform the `5W2H_Matrix` tab from a **general planning grid** into a **high-fidelity, action-plan-level strategic document** that Kent can drill into for detailed progress, steps, owners, and timelines per department. Simultaneously fix the email engine for V5 and restrict sheet tab visibility via Sheet protection.

---

## 1. Changes to `Code.gs` (Email Engine V5)

### 1.1 Display Fixes
| # | Issue Found in V4 Review | Fix |
|---|---|---|
| **A** | "Ngàn's team" → should be generic | Replace with **"SC team"** |
| **B** | Phase 5 donut ring doesn't show 65% centered | Rebuild as an **SVG inline arc segment** — renders in Gmail, shows % in center |
| **C** | Email mentions "Phase 5" but doesn't explain what phases exist | Add a **Phase Progress mini-section** (Phase 1–8 with ✅ / 🟡 indicators) inside the SCM Dashboard section |
| **D** | AI card body emojis (🔒💰☁️) render as ◆◆ in Gmail | Replace inline emoji text with HTML entity equivalents in `_buildReportHTML()` |

### 1.2 Phase Progress Section (New in SCM Dashboard)
After the KPI cards, add a scannable phase strip:
```
Phase 1 ✅  |  Phase 2 ✅  |  Phase 3 ✅  |  Phase 4 ✅  |
Phase 5 🟡 (Active)  |  Phase 6 ✅  |  Phase 7 ✅  |  Phase 8 ✅
```
Each phase shown as a compact colored pill/badge.

---

## 2. Changes to `SheetBuilder.gs` — 5W2H Matrix Redesign

### 2.1 Column Structure (V4 → V5)

| Old V4 | New V5 | Description |
|---|---|---|
| Col A: Priority | Col A: **Index** | Changed from "Priority" to "Index" (P1, P2 etc.) |
| Col B: Department | Col B: Department | ← same |
| Col C: WHAT | Col C: **WHAT — Action Steps** | Multi-step breakdown, not a single phrase |
| Col D: WHY | Col D: **WHY — Pains & Gains** | Both the pain (current state) and gain (future benefit) |
| Col E: WHEN | Col E: **WHEN — Per-Step Timeline** | Timeline shown per action step |
| Col F: WHO | Col F: WHO | Updated owners |
| Col G: WHERE | Col G: **WHERE — Focus Area** | Restructured to Material Planning & Procurement Flow |
| Col H: HOW TO | Col H: **HOW TO — Tools + Steps** | Each step links back to WHAT steps |
| Col I: HOW MUCH | Col I: HOW MUCH | ← same |
| Col J: PROGRESS | Col J: **STEP PROGRESS** | Per-step status breakdown |
| *(new)* | Col K: **TOTAL %** | Single overall progress percentage with Unicode bar |

**Total: 11 columns**

---

## 3. Supply Chain (SC) Row — The Model Row

**Index:** 🟢 P1

### Col C — WHAT (Action Steps)
```
📐 Step 1: Schema Design & ERD (Module 1–4 tables)
⚙️ Step 2: M1 Planning — Production Order + BOM Import
🌙 Step 3: M2 Balancing — Nightly MRP + Shortage Calc
🛒 Step 4: M3 Procurement — PR→PO Flow + Supplier Hub
🔄 Step 5: M4 Execution — Lead Issuance + ZXH AutoSync
🖥️ Step 6: Phase 5 — Assign Sourcing Dialog (BOM-level aggregation)
📊 Step 7: Phase 8 — Looker Studio Executive Dashboard
🔧 Ongoing: System calibration + BOM_TOLERANCE resolution
```

### Col D — WHY (Pains & Gains)
```
❌ PAIN: Manual shortage calculation takes 60+ min/day per planner
❌ PAIN: 5+ Excel files cross-referenced daily → errors and delay
❌ PAIN: BOM_TOLERANCE mismatch vs Lead Plan causes distrust
❌ PAIN: Per-VPO over-ordering (up to 2× MOQ waste per material)
❌ PAIN: Warehouse issuance not per-VPO → attribution errors

✅ GAIN: Automated 4 AM nightly run → data ready every morning
✅ GAIN: Single source of truth (BigQuery) for all SC data
✅ GAIN: Automated CS discrepancy detection (M1 CS Protocol)
✅ GAIN: M4 Lead Issuance now ±0 variance (fixed this week)
✅ GOING: BOM-level aggregation fix → purchase 600 instead of 1,200
```

### Col E — WHEN (Per-Step Timeline)
```
✅ Steps 1–4: Complete (2025 Q3–Q4)
✅ Step 5 (M4): Complete (Mar 2026)
🟡 Step 6 (Phase 5): Mar–Apr 2026 (Active)
✅ Step 7 (Looker): Complete (Feb 2026)
🔧 BOM_TOLERANCE fix: Target end of Mar 2026
```

### Col F — WHO
```
🛠 Builder: Khánh (Digitalization)
👥 Users: Phương, Nam, Nga, Thang (SC Team)
```
> Note: Phong removed. Nam, Nga, Thang added as per user instruction.

### Col G — WHERE (Focus Area)
```
📦 Material Planning:
  - BOM demand calculation
  - MOQ/SPQ rounding logic
  - Shortage pipeline view

🛒 Procurement Flow:
  - PR → PO consolidation
  - Supplier portal + feedback
  - ZXH auto-sync
```

### Col H — HOW TO (Tools + Steps)
```
🗄 Database: BigQuery (isc_scm_ops)
📊 UI: Google Sheets (Zone A/B pattern)
⚡ Automation: Apps Script + Triggers
📬 Reports: Gmail HTML (M2 nightly)
📈 Dashboard: Looker Studio

Step order → see Col C Steps 1–7
```

### Col I — HOW MUCH
```
Infra: ~$15/month (BigQuery)
Dev: Khánh (internal)
Time: 8 months (2025Q3–2026Q2)
```

### Col J — STEP PROGRESS
```
✅ Step 1: Schema
✅ Step 2: M1 Planning
✅ Step 3: M2 Nightly
✅ Step 4: M3 Procurement
✅ Step 5: M4 Issuance
🟡 Step 6: Phase 5 (65%)
✅ Step 7: Looker
🔧 Calibration: ongoing
```

### Col K — TOTAL %
```
██████████░░ 87%
```

---

## 4. Other Department Rows (Summary)

### MPL (Master Plan) — Index P2
- **WHAT Steps:** Discover → Design → Build scheduling DB → Sync with SC demand
- **WHY Pains:** SC reads manual MPL sheets (no real-time link), capacity is unchecked when SC changes demand
- **WHY Gains:** MPL-SC auto-sync → production schedule reflects real shortage data
- **WHEN:** Phase 1 Discovery Q2 2026 (5%)
- **WHO:** Khánh (build), Dương & Cường (use)
- **WHERE:** Production scheduling, Resource allocation
- **HOW TO:** Interview → ERD → GSheet + BQ extend from M1

### CS (Customer Svc) — Index P3
- **WHAT Steps:** Formalize CS→SC data exchange → Build CS discrepancy dashboard
- **WHY Pains:** M1 CS Protocol manually chases date/qty mismatches; most common error source
- **WHEN:** Q2–Q3 2026 (2%)
- **WHO:** Khánh (build), CS Team Lead (use)

### PRD (Production) — Index P4
- **WHAT Steps:** Real-time completion entry → Auto-sync to SC/MPL/CS
- **WHY Pains:** SC/MPL/CS each wait for manual production emails to know completion status
- **WHEN:** Q3 2026 (0%)
- **WHO:** Khánh (build), Ha (digitalization execution)

### QC — Index P5
- **WHAT Steps:** Digital checklists → Defect tracking → CAPA reports
- **WHY Pains:** Paper records = data loss; defect patterns invisible without aggregation
- **WHEN:** Q4 2026 (0%)
- **WHO:** Khánh (build), Vic & Quynh (use)

### Finance — Index P6
- **WHAT Steps:** PO-Invoice reconciliation → Cost variance dashboard
- **WHEN:** Q1 2027 (0%)

### HR/Admin — Index P7
- **WHAT Steps:** Attendance tracking → KPI dashboard
- **WHEN:** Q1 2027 (0%)

---

## 5. Sheet Tab Visibility & Protection

> [!IMPORTANT]
> User request: Hide AND lock `Weekly_Input` and `Report_Log` so only `dk@isconline.vn` can view them — Kent should not even know they exist.

### Implementation Plan for Tab Lock:
```javascript
// In SheetBuilder.gs — after creating each tab:

// 1. HIDE the tab (already done)
sheet.hideSheet();

// 2. PROTECT the tab — only dk@isconline.vn can see/edit
var protection = sheet.protect();
protection.setDescription('Admin Only — dk@isconline.vn');
protection.removeEditors(protection.getEditors()); // Remove all editors
protection.addEditor('dk@isconline.vn');            // Re-add Khanh only
// Note: hideSheet() prevents view; protect() prevents edits even if found
```

> [!NOTE]
> In Google Sheets, hiding a tab via `hideSheet()` also prevents it from being viewed by users who don't have edit permission on the sheet. Since Kent likely has viewer access (you share the sheet link), the hidden tab won't be visible to him through the normal tab bar. The protection layer adds a second fence: even if someone reveals hidden sheets (via "All Sheets" button), the protected tab shows a lock icon and blocks editing.

---

## 6. Files to be Modified

| File | Action | Type |
|---|---|---|
| `SheetBuilder.gs` | Full rewrite of `_build5W2HMatrixTab()` — 11 columns, per-step rows per dept | Modify |
| `Code.gs` | Fix: SC team rename, Phase strip, SVG donut, AI card emoji entities | Modify |

---

## 7. Verification Plan

1. Run `admin_SetupAllTabs()` → Confirm 3 tabs created, Weekly_Input and Report_Log both **hidden + protected**
2. Open `5W2H_Matrix` → Verify 11 columns, SC row has all 8 steps, WHY has pains+gains, STEP PROGRESS column shows per-step status
3. Run `generateAndSendWeeklyReport()` → Verify:
   - "SC team" (not "Ngàn's team")
   - Phase strip appears in SCM Dashboard section
   - No diamond boxes in AI card
   - SVG donut renders 65% with number centered
4. Share sheet with a test viewer account → Confirm `Weekly_Input` and `Report_Log` are invisible/locked

---

## 8. Row Height & Visual Approach

Because the SC row now has 8 steps in WHAT, the row will need to be significantly taller (~180–220px). To keep the sheet scannable for Kent:
- SC row: 200px height (most detailed, most important)
- MPL, CS, PRD rows: 130px height
- QC, Finance, HR rows: 90px height (summary-level)
- Each cell uses `setWrap(true)` for proper text flow
- Each cell uses bullet points via `\n• ` prefix for scanning

---

*Awaiting your approval to proceed with execution. Once confirmed, I will rewrite both SheetBuilder.gs and Code.gs directly.*
