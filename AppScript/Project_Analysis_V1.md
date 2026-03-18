# ISC Supply Chain Management System — Project Analysis V1

*Comprehensive reference for AI assistants and developers. Last updated: 2026-03-11*

---

## 1. Project Identity

| Field | Value |
|---|---|
| **Organization** | ISC (International Stationery Company) — Pencil Manufacturing |
| **System Name** | ISC SCM Ops (Supply Chain Management Operations) |
| **Technology** | Google Apps Script (frontend) + BigQuery (backend) |
| **BQ Project** | `boxwood-charmer-473204-k8` |
| **BQ Dataset** | `isc_scm_ops` |
| **Architecture** | Modular — 4 Modules + 1 Core Library |
| **Current Version** | Diagrams Version 127 — Shortage Calculation Refinement |
| **System Architect** | Khánh (dk@isconline.vn) |

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                     ISC_SCM_Core_Lib (Shared)                    │
│  Config_Env │ Config_Schema │ BigQueryClient │ SQL_Vault │       │
│  Identity_Registry │ Logger │ QA_Validation_Suite │              │
│  Admin_Infrastructure                                            │
└──────────┬──────────┬──────────┬──────────┬──────────────────────┘
           │          │          │          │
     ┌─────┴──┐ ┌─────┴──┐ ┌────┴───┐ ┌───┴─────┐
     │ M1     │ │ M2     │ │ M3     │ │ M4      │
     │Planning│ │Balance │ │Procure │ │Execution│
     └────────┘ └────────┘ └────────┘ └─────────┘
```

### Google Sheets as UI Layer
Each module runs as a **bound Apps Script** on a separate Google Spreadsheet:
- **M1 Sheet**: Production_Order_Draft, BOM_Order_List_Draft, BOM_Data_Staging
- **M2 Sheet**: Nightly automated + manual emergency runs
- **M3 Sheet**: Supplier_Information, Supplier_Capacity, PR_Staging, Assign_Sourcing, PO Consolidation
- **M4 Sheet**: Stock_Count_Upload, PO_Line_Tracking, Supplier Portal, Direct Injection, ZXH PO AutoSync, **Lead_Issuance_AutoSync**

### Data Flow Pattern
```
User → Google Sheet (Zone A/B) → Apps Script → CSV/SQL → BigQuery (Staging)
    → Stored Procedure (SP) → BigQuery (Final Tables) → Views → Sheets/Looker
```

---

## 3. Module Breakdown

### 📘 Module 1: PLANNING (`ISC_Module_M1`)
**Purpose**: Production order management, BOM data mastering, order list ingestion.

| File | Role |
|---|---|
| `M1_Main.txt` | Orchestrator — push data, triggers SPs, Flight Recorder email |
| `M1_Config.txt` | Sheet manifests, push notification config |
| `M1_SheetBuilder.txt` | Zone A/B sheet builder |
| `M1_PSP_Main.txt` | Production Status Protocol — completion tracking |
| `M1_PSP_AutoSync.txt` | Auto-sync production status from CS (customer) sheets |
| `M1_PSP_Config.txt` | PSP configuration |
| `M1_PSP_SheetBuilder.txt` | PSP sheet builder |
| `M1_CS_Status_Main.txt` | Discrepancy detection between CS status and system |
| `M1_CS_Status_Config.txt` | CS Status Monitor config |
| `M1_CS_Status_SheetBuilder.txt` | CS Status sheet builder |
| `M1_Cancel_Main.txt` | Order cancellation protocol |
| `M1_Cancel_Config.txt` | Cancellation config |
| `M1_Cancel_SheetBuilder.txt` | Cancellation sheet builder |

**Key Tables**: `BOM_Data`, `Production_Order`, `BOM_Order_List_Final`, `Production_Status_Log`, `CS_Status_Discrepancy_Log`

**Key SPs**: `SP_SPLIT_BATCH_GATE`, `SP_M1_MASTER_MERGE`

---

### ⚖️ Module 2: BALANCING (`ISC_Module_M2`)
**Purpose**: Nightly MRP engine — calculates shortages, allocates supply, generates PR drafts.

| File | Role |
|---|---|
| `M2_Main.txt` | Nightly 04:00 AM trigger, matching engine, analytics email, ledger health |

**Pipeline**:
1. `SP_RUN_MATCHING_ENGINE` — truncates + recalculates SNAPSHOT, Pegging, PR_Draft
2. `SP_M2_RECORD_DAILY_STATS` — records health metrics
3. `M2_Analytic_Feed_VIEW` — pre-computed KPIs for email
4. Email report (mobile-first HTML, monthly threading, dual-method comparison)
5. `M2_Pipeline_Ledger` — append-only archive (gross + net demand per day)

**Key Tables**: `Material_Demand_VIEW`, `Material_Demand_SNAPSHOT`, `Stock_Data`, `Pegging_Allocations`, `PR_Draft`, `M2_Pipeline_Ledger`, `M2_Daily_Stats`

**Dual-Method Shortage**: Both **Completion** (factory output) and **Issuance** (warehouse material issued) methods calculated. `CALC_METHOD_USED` determines active method per material group.

---

### 🧑‍💼 Module 3: PROCUREMENT (`ISC_Module_M3`)
**Purpose**: Supplier management, sourcing decisions, PO creation.

| File | Role |
|---|---|
| `M3_Main.txt` | Upload + validation + boomerang error return |
| `M3_Config.txt` | M3 configuration |
| `M3_SheetBuilder.txt` | Input/output sheet builder |
| `M3_Sourcing_Main.txt` | Assign_Sourcing: PIC-based material assignment with dialog |
| `M3_Sourcing_SheetBuilder.txt` | Sourcing sheet builder |
| `M3_Consolidation_Main.txt` | PO consolidation engine |
| `M3_Consolidation_SheetBuilder.txt` | Consolidation sheet builder |
| `M3_PO_Issuance_Main.txt` | PO issuance/printing workflow |
| `M3_PO_Issuance_SheetBuilder.txt` | PO issuance sheet builder |

**Key Tables**: `Supplier_Information`, `Supplier_Capacity`, `PR_Staging`, `PR_Final`, `PO_Header`, `PO_Line`, `PO_Consolidation_Event`, `PR_PO_Consolidation`

**Key SPs**: `SP_M3_MERGE_SUPPLIER_INFO`, `SP_M3_MERGE_SUPPLIER_CAPACITY`, `SP_M3_MERGE_PR_DECISIONS`

---

### 🚚 Module 4: EXECUTION (`ISC_Module_M4`)
**Purpose**: Stock control, PO tracking, supplier portal, auto-sync pipelines.

| File | Role |
|---|---|
| `M4_Main.txt` | Stock upload, Monday Protocol (SP chain) |
| `M4_SheetBuilder.txt` | Stock count sheet builder |
| `M4_Suppliers_Portal_Main.txt` | Supplier feedback portal |
| `M4_Suppliers_Portal_SheetBuilder.txt` | Portal sheet builder |
| `M4_Injection_Portal_Main.txt` | Direct PO injection (cold start) |
| `M4_Injection_Portal_SheetBuilder.txt` | Injection sheet builder |
| `M4_ZXH_PO_AutoSync_Main.gs` | Legacy ZXH PO auto-sync from external system |
| `M4_ZXH_PO_AutoSync_SheetBuilder.gs` | ZXH dashboard builder |
| **`M4_Issuance_AutoSync_Config.txt`** | **Lead Issuance pipeline config** |
| **`M4_Issuance_AutoSync_Main.txt`** | **Lead Issuance sync engine** |
| **`M4_Issuance_AutoSync_SheetBuilder.txt`** | **Lead Issuance dashboard builder** |

**Key Tables**: `Stock_Data`, `Stock_Count_Upload`, `PO_Line_Tracking`, `Material_Issuance`, `Inventory_Variance_Log`, `Supplier_Feedback_Log`

**Key SPs**: `SP_M4_FILTER`, `SP_M4_VARIANCE_CALC`, `SP_M4_JANITOR`, `SP_M4_RESET_STOCK`, `SP_M4_ISSUANCE_MERGE`

**Monday Protocol**: Sequential SP chain: Filter → Variance → Janitor → Reset Stock

---

## 4. Core Library (`ISC_SCM_Core_Lib`)

| File | Purpose |
|---|---|
| `Config_Env.txt` | BQ connection: project + dataset IDs |
| `Config_Schema.txt` | All table schemas (1108 lines), field types, primary keys |
| `BigQueryClient.txt` | BQ API wrapper: read, write, CSV load, job polling |
| `SQL_Vault.txt` | All stored procedures + views (225K bytes, massive) |
| `Identity_Registry.txt` | PIC name resolution (Vietnamese diacritics) |
| `Logger.txt` | System execution logging |
| `QA_Validation_Suite.txt` | Data quality checks |
| `Admin_Infrastructure.txt` | Admin tools, trigger management |

---

## 5. Key Design Patterns

| Pattern | Description |
|---|---|
| **Zone A/B** | Zone A = calculated/clean data (left), Zone B = raw input (right), separated by `RAW_START`/`RAW_END` pillars |
| **Staging → SP → Final** | All data goes through staging tables, validated by stored procedures, then merged to final tables |
| **WRITE_TRUNCATE vs APPEND** | Staging tables use TRUNCATE (fresh each run), upload tables use APPEND |
| **Email Threading** | Monthly Gmail threads with ISC_Logs label, rich HTML reports |
| **Atomic Session IDs** | `SYNC_{timestamp}` pattern prevents same-day duplicates |
| **BOM_UPDATE Resolution** | Primary key for materials; resolved via exact match then short-code fallback against `BOM_Data` |
| **Dual-Method Shortage** | Completion (factory output) vs Issuance (warehouse material) methods calculated side-by-side |

---

## 6. Key Personnel (PIC Registry)

| Name | Role | Email |
|---|---|---|
| Khánh | SYSTEM_ARCHITECT | dk@isconline.vn |
| Ngàn | PLANNER | ngan@isconline.vn |
| Nga | PLANNER | buithinga@isconline.vn |
| Thắng | PLANNER | levietthang@isconline.vn |
| Phương | PLANNER | phuongbui@isconline.vn |
| Phong | PLANNER | phong.mai@isconline.vn |
| Nam | MANAGER | honam@isconline.vn |

---

## 7. M4 Lead Issuance AutoSync — Deep Reference

### Pipeline Architecture
```
[Warehouse Spreadsheet: '5. Link Lead plan']
    → SpreadsheetApp.openById('1fz_I_FwXT3vi9XUCkUt1GIpYmDDlzqrKxfJmkUadTi0')
    → Read BOM×VPO matrix (Row 2=VPO headers, Row 10+=BOM data)
    → Extract (BOM, VPO, qty) triples where qty > 0
    → Resolve BOM_UPDATE via BQ lookup (EXACT → SHORTCODE fallback)
    → Filter by MAIN_GROUP = 'Chì' + BOM_STATUS = 'ACTIVE'
    → Build CSV → Material_Issuance_Staging (WRITE_TRUNCATE)
    → SP_M4_ISSUANCE_MERGE (MERGE into Material_Issuance)
    → Update Dashboard (Zone A + Zone B)
    → Email Report
```

### Source Data Layout ('5. Link Lead plan')
```
Row 1:    Date label — skip
Row 2:    VPO headers horizontal (B2='VPO', C2+ = VPO codes)
Row 3-9:  Summary rows — skip
Row 10+:  BOM data rows
  Col A:  BOM_UPDATE (9-digit codes like 302000040)
  Col B:  BOM-level totals — skip
  Col C+: Issuance quantities at BOM × VPO intersection
```

### Config Parameters
```javascript
SPREADSHEET_ID:  '1fz_I_FwXT3vi9XUCkUt1GIpYmDDlzqrKxfJmkUadTi0'
TAB_NAME:        '5. Link Lead plan'
VPO_HEADER_ROW:  2
BOM_COL:         1 (Column A)
VPO_DATA_COL:    3 (Column C — first VPO data column)
DATA_START_ROW:  10
MAX_ROWS:        600
MAX_COLS:        300
MAIN_GROUP_FILTER: 'Chì'
TRIGGER_HOUR:    22 (10 PM HCM)
```

### BQ Target
- **Staging**: `Material_Issuance_Staging` (WRITE_TRUNCATE each run)
- **Final**: `Material_Issuance` (MERGE via SP_M4_ISSUANCE_MERGE)

### Data Sources Referenced
1. **Original**: `1fz_I_FwXT3vi9XUCkUt1GIpYmDDlzqrKxfJmkUadTi0` — Tab: '5. Link Lead plan'
2. **ImportRange Bridge**: `1XU6MYx-FNCzLKnAfSHYVWFthTRSxGEXJ2bvBxMsvj08` — Tab: '6. Link Cấp Phát'

---

## 8. Phase Roadmap (from shortage_calculation_analysis_v8.md)

| Phase | What | Status |
|---|---|---|
| 1 | Dual-Column VIEW + Schema Migration + M2_Pipeline_Ledger | ✅ Complete |
| 2 | PIC Identity Fix (Identity_Registry.gs) | ✅ Complete |
| 3 | Material_Issuance + M4_Issuance_AutoSync | ✅ Complete |
| 4 | Propagate dual columns to PR_Draft + Sourcing_Feed_VIEW | ✅ Complete |
| 5 | Assign_Sourcing Dialog Redesign | 🟡 In Progress |
| 6 | M2_Daily_Stats + M2_Analytic_Feed_VIEW + Email upgrade | ✅ Complete |
| 7 | GROSS_DEMAND_QTY auto-switch logic | ✅ Complete |
| 8 | Looker Studio dashboard + MASTER insights | ✅ Complete |

---

## 9. Key Google Sheet Links

| Sheet | URL |
|---|---|
| M4 Execution Sheet | `https://docs.google.com/spreadsheets/d/1VHN7uOiEuAImISd45rl13_yDUQRbvSQR9yNuyNXQzWs/` |
| Lead Plan (Original) | `https://docs.google.com/spreadsheets/d/1fz_I_FwXT3vi9XUCkUt1GIpYmDDlzqrKxfJmkUadTi0/` |
| Lead Plan (Bridge) | `https://docs.google.com/spreadsheets/d/1XU6MYx-FNCzLKnAfSHYVWFthTRSxGEXJ2bvBxMsvj08/` |

---

*This document exists to save tokens in future conversations. Read this first before reading source files.*
