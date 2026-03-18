# Part 1 — Assign_Sourcing Analysis: Problem Statement & Theory

*Date: 2026-03-12 | Scope: Assign_Sourcing Session Redesign for PUBLIC Materials*
*Analyst: Antigravity AI + System Architect Khánh*
*Related: Lead_Issuance_Analysis_V3.md, Production_Order_Analysis_V1.md, Project_Analysis_V1.md*

---

## 0. Executive Summary

The `Ngan_Assign_Sourcing` session for "Chì" (Lead/Pencil Core) materials — currently the most tested PUBLIC material group — produces shortage numbers that **do not fully match** the manual "2. LEAD Plan" spreadsheet maintained by PIC Ngàn. Two root causes and one UX/design issue have been identified:

| # | Problem | Impact | Category |
|---|---|---|---|
| **P1** | **BOM_TOLERANCE Divergence** — System uses CS-provided tolerance (varies per SKU), while Lead Plan uses ISC's own fixed tolerance (typically 10%) | Gross demand qty differs → net shortage differs | Data / Calculation |
| **P2** | **VPO Non-Aggregation** — Same BOM_UPDATE appears multiple times (once per VPO), preventing correct MOQ/SPQ rounding and cross-VPO shortage netting | Over-ordering due to per-VPO MOQ ceiling; no BOM-level shortage sanity check | UX / Architecture |
| **P3** | **Warehouse Issuance Reliability** — "Cấp Phát" sheet records issuance per-VPO but warehouse staff may combine entries for same-SKU/same-day VPOs | Issuance data correct at BOM-level total but unreliable at VPO-level; needs backup check | Data Quality |

---

## 1. Problem P1 — BOM_TOLERANCE Divergence

### 1.1 How the System Currently Calculates Gross Demand

The `Material_Demand_VIEW` in `SQL_Vault.txt` computes gross demand using the formula:

```
GROSS_DEMAND_COMPLETION_METHOD =
  (FINISHED_GOODS_ORDER_QTY - COMPLETION_QTY) × BOM_CONSUMPTION × (1 + BOM_TOLERANCE)

GROSS_DEMAND_ISSUANCE_METHOD =
  GREATEST(0, (FINISHED_GOODS_ORDER_QTY × BOM_CONSUMPTION × (1 + BOM_TOLERANCE)) - CUMULATIVE_ISSUANCE_QTY)
```

Where:
- `FINISHED_GOODS_ORDER_QTY` = Total finished goods ordered for this VPO
- `COMPLETION_QTY` = How many finished goods have been produced
- `BOM_CONSUMPTION` = How much of this material (BOM) is needed per finished good
- **`BOM_TOLERANCE`** = Excess factor (e.g., 0.05 = 5% extra material over theoretical need)
- `CUMULATIVE_ISSUANCE_QTY` = How much material has been issued from warehouse

### 1.2 Where BOM_TOLERANCE Comes From

The data flow for `BOM_TOLERANCE` is:

```
China Corporation (HQ) → determines BOM + tolerance per SKU
    → Customer (CS) receives this data
        → CS sends Order List to ISC including BOM_TOLERANCE per line
            → M1 ingests BOM_TOLERANCE into BOM_Order_List_Draft
                → SP_SPLIT_BATCH_GATE promotes to BOM_Order_List_Final
                    → Material_Demand_VIEW reads L.BOM_TOLERANCE in demand formula
```

The `BOM_TOLERANCE` is stored as a `FLOAT` in `BOM_Order_List_Final` (Config_Schema line 229) and varies per (PRODUCTION_ORDER_ID, BOM_UPDATE) pair. This means **different SKUs/VPOs can have different tolerances for the same BOM material**.

### 1.3 How the Lead Plan Sheet (Ngàn's Method) Differs

PIC Ngàn and the SC team do **NOT** use the BOM_TOLERANCE from CS to calculate their actual material demand. Instead, they apply:

| Parameter | System (BOM_TOLERANCE from CS) | Lead Plan (Ngàn's Method) |
|---|---|---|
| **Tolerance Value** | Varies per SKU/VPO (e.g., 3%, 5%, 7%, 12%) | **Fixed 10%** for most materials |
| **Source** | CS → derived from China HQ BOM spec | ISC internal convention |
| **Outliers** | Some SKUs have 15-20% tolerance from CS | **20% for specific outlier BOMs** (manually identified) |
| **Granularity** | Per (PRODUCTION_ORDER_ID, BOM_UPDATE) pair | Per BOM material (flat rate) |

### 1.4 Quantified Impact

Consider BOM_UPDATE `302014740` (identified in `Comparision_LeadPlan_vs_SystemM3`):

```
System:     Demand = OrderQty × Consumption × (1 + CS_Tolerance)
Lead Plan:  Demand = OrderQty × Consumption × (1 + 0.10)

If CS_Tolerance = 0.05:  System demand is LOWER than Lead Plan by ~4.5%
If CS_Tolerance = 0.15:  System demand is HIGHER than Lead Plan by ~4.5%
If CS_Tolerance = 0.03:  System demand is LOWER than Lead Plan by ~6.8%
```

The cumulative effect across 97+ items in a single session can be significant:
- Some BOMs will show **lower** system shortage than Lead Plan (CS tolerance < 10%)
- Some BOMs will show **higher** system shortage than Lead Plan (CS tolerance > 10%)
- The net effect depends on the distribution of CS tolerances across the BOM catalog

### 1.5 Why Both Methods Exist (Business Context)

- **CS BOM_TOLERANCE** is technically correct — it represents the official engineering tolerance from the product design authority (China HQ). CS expects ISC to procure materials with this tolerance.
- **ISC 10% Convention** is operationally practical — ISC's procurement team uses a simplified, conservative buffer. 10% covers most materials with a comfortable safety margin and aligns with how Lead Plan sheet formulas are built.
- Neither method is "wrong" — they serve different purposes. The system should support both and let the user choose or see the comparison.

### 1.6 Key Theory for Verification

> **T1.1**: The `BOM_TOLERANCE` values in `BOM_Order_List_Final` for "Chì" materials are NOT uniformly 0.10 — they vary significantly per (PO, BOM) pair.
>
> **T1.2**: Using a fixed 10% tolerance instead of the CS-provided tolerance would bring system shortages closer to (but not identical with) the Lead Plan sheet.
>
> **T1.3**: The difference between system and Lead Plan shortage quantities is proportional to `|BOM_TOLERANCE_CS - 0.10|` for each line item.

---

## 2. Problem P2 — VPO Non-Aggregation & Session Redesign

### 2.1 Current Behavior (VPO-Level Granularity)

The current `Assign_Sourcing` session displays one row per **DRAFT_PR_ID** which maps to one `(BOM_UPDATE, VPO)` pair. This means:

```
BOM_UPDATE 302023503 appears TWICE in the Ngàn session:

Row 1:  VPO = V2601015C01   NET_SHORTAGE = 14.3157    (small VPO demand)
Row 2:  VPO = V2512007C06   NET_SHORTAGE = 531.0976   (large VPO demand)

Total BOM-level shortage: 14.3157 + 531.0976 = 545.4133
```

Each row gets its own:
- `FINAL_ORDER_QTY` = `CEILING(NET_SHORTAGE, MOQ_or_SPQ)`
- `SUPPLIER_ID` lookup
- `FINAL_UNIT_PRICE` calculation
- `PROJECTED_ARRIVAL_DATE`

### 2.2 The MOQ/SPQ Over-Ordering Problem

The formula for `FINAL_ORDER_QTY` in Zone A (Column L) is:

```
=ARRAYFORMULA(IF(R6:R="", "", CEILING(Z6:Z, IF((AH6:AH="")+(AH6:AH=0), 1, AH6:AH))))
```

This CEILINGs each shortage to the nearest SPQ (labeled `STANDARD_MOQ_REF` in column AH but actually behaves as SPQ — see Section 2.3).

**Example with SPQ = 600:**

```
VPO-level approach (CURRENT):
  Row 1: CEILING(14.3157, 600)   = 600   ← buys 600 for 14 shortage
  Row 2: CEILING(531.0976, 600)  = 600   ← buys 600 for 531 shortage
  TOTAL ORDER: 1,200 units

BOM-aggregated approach (PROPOSED):
  Combined: CEILING(545.4133, 600) = 600  ← buys 600 for 545 shortage
  TOTAL ORDER: 600 units
  SAVINGS: 600 units (50% reduction in this example!)
```

This is the core waste: **per-VPO MOQ/SPQ ceiling doubles or triples the order when the combined shortage fits within a single package quantity.**

### 2.3 MOQ vs SPQ — Terminology Clarification

The current `Supplier_Capacity` table schema shows:

```
Supplier_Capacity: {
  CAPACITY_ID, SUPPLIER_ID, SUPPLIER_NAME, BOM_UPDATE,
  LEAD_TIME (FLOAT), UNIT_PRICE (FLOAT), MOQ (FLOAT)
}
```

The column labeled `MOQ` in the schema and `STANDARD_MOQ_REF` in the sourcing sheet is actually used as **SPQ (Standard Package Quantity)** — the rounding increment for order quantities. The XLOOKUP formula CEILINGs the shortage to this value.

True MOQ and SPQ have different business meanings:
- **MOQ (Minimum Order Quantity)**: The minimum amount a supplier will accept for a single PO. If total order is below MOQ, either don't order or find alternative supplier.
- **SPQ (Standard Package Quantity)**: The rounding increment — orders must be in multiples of this quantity. E.g., SPQ=600 means you can order 600, 1200, 1800, etc.

> **The current system conflates MOQ and SPQ.** The `Supplier_Capacity.MOQ` field is used as SPQ in the CEILING formula. True MOQ validation (reject orders below minimum) is not implemented.

### 2.4 The FULFILMENT_MODE Split — PUBLIC vs PRIVATE

The team has discussed and agreed on a two-stream approach:

| Aspect | PUBLIC Mode (e.g., "Chì") | PRIVATE Mode (e.g., "Bao bì") |
|---|---|---|
| **Material Nature** | Standard, interchangeable across VPOs | Custom/packaged, dedicated to specific VPO |
| **Balancing** | Goes through M2 matching engine (Stock + PO allocation) | Skips balancing; flows directly from demand to PR |
| **VPO Tracking** | Less meaningful per-VPO; material is fungible | Critical per-VPO; each package is unique |
| **Proposed Session** | **Aggregate VPOs** — one row per BOM_UPDATE | Keep VPO-level rows (current behavior) |
| **MOQ/SPQ Impact** | High — aggregation prevents wasteful per-VPO ceiling | Low — VPO-specific ordering is correct |

### 2.5 Proposed Session Structure for PUBLIC Mode

When a user selects a material group with `FULFILLMENT_MODE = PUBLIC`, the session should aggregate VPOs:

**Current Structure (VPO-level):**
```
DRAFT_PR_ID | BOM_UPDATE | VPO         | SHORTAGE | FINAL_ORDER_QTY
PRD_7f40... | 302023503  | V2601015C01 | 14.32    | 600
PRD_eb8d... | 302023503  | V2512007C06 | 531.10   | 600
                                         TOTAL:     1,200
```

**Proposed Structure (BOM-aggregated):**
```
DRAFT_PR_ID     | BOM_UPDATE | VPOs (pipe-delimited)        | TOTAL_SHORTAGE | FINAL_ORDER_QTY
AGG_302023503   | 302023503  | V2601015C01|V2512007C06      | 545.42         | 600
                                                              TOTAL:           600
```

Key changes to the sheet:
1. **VPO column** would contain pipe-delimited VPO codes (e.g., `V2601015C01|V2512007C06`) — similar to how `KNOWN_CAPACITY_OPTIONS` already stores pipe-delimited supplier options.
2. **NET_SHORTAGE_QTY** would be the **sum** of all VPO-level shortages for that BOM.
3. **DRAFT_PR_ID** could use a new prefix like `AGG_` or contain the composite of original PR IDs.
4. **REQUESTED_DELIVERY_DATE** would be the **earliest** (MIN) of all VPO delivery dates — because the most urgent VPO drives the timeline.

### 2.6 Proposed Backup Column — BOM-Level Total Shortage

As proposed by the architect, an extra column should display the **BOM-level total shortage** calculated as:

```
BOM_TOTAL_SHORTAGE = TOTAL_DEMAND - TOTAL_ISSUED - TOTAL_SUPPLY
                   = SUM(GROSS_DEMAND per BOM) - SUM(ISSUANCE per BOM) - (STOCK + SUM(PO_ON_WAY per BOM))
```

This serves as a **sanity check / backup** against VPO-level issuance inaccuracies. Even if the warehouse enters issuance against the wrong VPO (combining two VPOs into one), the BOM-level total remains correct.

### 2.7 Impact on Upload Logic

The `runSourcingUpload()` function currently maps each row to a `PR_Staging` record with a single VPO. For the aggregated approach:

**Option A — Single PR per BOM (Simplest):**
The uploaded PR would have `VPO = NULL` or `VPO = 'MULTI'` indicating it covers multiple VPOs. Downstream PO consolidation treats this as a generic PUBLIC order.

**Option B — Explode back to VPOs (Preserve Traceability):**
On submit, the system splits the aggregated row back into individual PR_Staging rows per VPO, distributing the order quantity proportionally. This preserves the VPO→PO traceability chain.

**Option C — Pipe-delimited VPOs in PR_Staging:**
Store the pipe-delimited VPOs in `PR_Staging.VPO` field as-is. The PO consolidation engine can then handle multi-VPO PRs.

Each option has trade-offs discussed in Part 2.

---

## 3. Problem P3 — Warehouse Issuance Reliability

### 3.1 The "Cấp Phát" Sheet Architecture

The M4 `Lead_Issuance_AutoSync` reads from the warehouse's "5. Link Lead plan" spreadsheet:

```
Source: 1fz_I_FwXT3vi9XUCkUt1GIpYmDDlzqrKxfJmkUadTi0 (Tab: '5. Link Lead plan')
Bridge: 1XU6MYx-FNCzLKnAfSHYVWFthTRSxGEXJ2bvBxMsvj08 (Tab: '6. Link Cấp Phát')

Layout:
  Row 2:   VPO headers (horizontal: V2601015C01, V2512007C06, ...)
  Row 10+: BOM_UPDATE (column A) × VPO (col C+) = issuance quantities
```

The system reads this matrix and creates `(BOM_UPDATE, VPO, CUMULATIVE_ISSUANCE_QTY)` triples.

### 3.2 The Warehouse Data Entry Problem

Warehouse staff (statistician / worker) enter material issuance into the "Cấp Phát" sheet. The observed behavior:

```
CORRECT behavior (expected):
  VPO V2601015C01:  BOM 302023503 issued = 14 units
  VPO V2512007C06:  BOM 302023503 issued = 530 units
  → Separate entries, correct per-VPO issuance

ACTUAL behavior (observed):
  VPO V2601015C01:  BOM 302023503 issued = 0 units    ← entered as zero
  VPO V2512007C06:  BOM 302023503 issued = 544 units  ← combined total
  → Total is correct (544), but VPO attribution is wrong
```

**Why this happens:**
1. Multiple VPOs for the same SKU may be produced on the same day
2. Warehouse issues material in bulk (e.g., a pallet of lead cores)
3. The statistician enters the total quantity against **whichever VPO they process first** or against a single VPO rather than splitting across multiple VPOs
4. This saves data entry time and the total per BOM remains mathematically correct

### 3.3 Organizational Response

The system architect (Khánh) raised this issue with SC Manager Nam, who agreed with the root cause. The person in charge (Phong) was instructed to tell the warehouse team to enter issuance correctly per VPO.

**However**, changing warehouse behavior is unreliable because:
- It requires extra work for data entry personnel
- The current habit is entrenched
- There is no systemic enforcement (no validation check on per-VPO accuracy)
- The sum total remains correct regardless of VPO distribution

### 3.4 Proposed Backup — BOM-Level Aggregated Shortage Check

Since per-VPO issuance is unreliable but **BOM-level total issuance is reliable**, the system should provide a **BOM-aggregated shortage column** as a cross-check:

```
BOM_LEVEL_TOTAL_SHORTAGE =
  SUM(GROSS_DEMAND for all VPOs of this BOM)
  - SUM(CUMULATIVE_ISSUANCE for all VPOs of this BOM)
  - (STOCK_QTY for this BOM + SUM(PO_ON_WAY for this BOM))
```

This value should be displayed alongside the VPO-level NET_SHORTAGE columns (AI/AJ: NET_SHORTAGE_COMPLETION / NET_SHORTAGE_ISSUANCE) as a sanity check.

### 3.5 Connection to VPO Aggregation (P2 ↔ P3)

Problems P2 and P3 reinforce each other:
- **P2 says**: Aggregate VPOs for PUBLIC materials to avoid MOQ waste → this also eliminates the VPO attribution problem
- **P3 says**: Per-VPO issuance is unreliable → BOM-level aggregation is the reliable ground truth

**If we implement the aggregated session for PUBLIC mode, the warehouse issuance reliability issue (P3) is largely solved** because:
1. The session shows BOM-level shortage (sum across all VPOs)
2. The total issuance per BOM is correct (warehouse gets this right)
3. Individual VPO attribution errors become irrelevant since we're operating at BOM level

---

## 4. UI/UX Implications — Dashboard & Menu Redesign

### 4.1 Current Dashboard (Rows 1-4)

```
📊 SOURCING SESSION DASHBOARD
👤 PIC: Ngàn   📦 GROUP: Chì   🔬 METHOD: ISSUANCE   📋 ITEMS: 97   ⏱️ LOADED: 12/03/2026
⚠️ PHANTOMS: 0   🟡 DIVERGENT: 0   🟢 ALIGNED: 97   📊 TOTAL SHORTAGE: 5,625   📌 HAS ISSUANCE: 0
```

### 4.2 Proposed Dashboard Additions

For PUBLIC-mode aggregated sessions, the dashboard should include:

| New Metric | Description |
|---|---|
| **📦 UNIQUE BOMs** | Number of distinct BOM_UPDATE codes (previously 97 rows = VPO-level, now fewer after aggregation) |
| **🔄 AGGREGATION_MODE** | `PUBLIC_AGGREGATED` or `PRIVATE_VPO_LEVEL` |
| **📊 TOTAL MOQ SAVINGS** | `SUM(per_VPO_ceiling) - SUM(aggregated_ceiling)` — quantifies the savings from aggregation |
| **✅ BOM_CHECK** | Count of BOMs where VPO-sum shortage ≈ BOM-level shortage (within tolerance) |
| **⚠️ BOM_MISMATCH** | Count of BOMs where VPO-sum and BOM-level shortage diverge (flags issuance errors) |

### 4.3 New Menu Actions

The `🛒 ISC Sourcing` menu should add:

```
📥 Start Sourcing Session         → existing (add mode selection)
🔄 Refresh Current Session        → existing
🚀 Submit Sourcing Decisions      → existing
───
📊 Toggle BOM Aggregation View    → NEW: switch between VPO-level and BOM-aggregated view
🔍 BOM Shortage Audit             → NEW: compare VPO-sum vs BOM-level for each BOM
```

### 4.4 Material Scope Dialog Changes (Phase 5 — D1, D3)

The existing dialog flow is:
1. Enter PIC name → validated via Identity_Registry
2. Select Material Group (e.g., Chì) → filtered from BOM_Data
3. Select Method (COMPLETION or ISSUANCE) → suggested per group

Proposed additions:
4. **Select Aggregation Mode** — AUTO (system decides based on FULFILLMENT_MODE), AGGREGATE, or VPO-LEVEL
   - AUTO: PUBLIC materials get aggregated, PRIVATE stays VPO-level
   - AGGREGATE: Force BOM-level aggregation regardless of mode
   - VPO-LEVEL: Force VPO-level rows (current behavior)

### 4.5 Tolerance Override Option

For P1 (BOM_TOLERANCE divergence), the session could offer:
- **Use CS Tolerance** = Current behavior, reads `BOM_TOLERANCE` from `BOM_Order_List_Final`
- **Use ISC Standard (10%)** = Override tolerance to 0.10 for all items
- **Use ISC Custom** = Override tolerance to user-specified value per session

This could be a **session-level setting** displayed in the dashboard (Row 2/3) and applied when computing the display shortage.

---

## 5. Data Flow — Current vs Proposed

### 5.1 Current Flow (VPO-Level)

```
Material_Demand_VIEW (per VPO×BOM)
  → SP_RUN_MATCHING_ENGINE (M2 nightly, stock + PO allocation per VPO×BOM)
    → PR_Draft (one row per VPO×BOM shortage)
      → Sourcing_Feed_VIEW (joins PR_Draft + BOM_Data + Supplier data)
        → M3 Assign_Sourcing Session (one row per VPO×BOM)
          → User edits (supplier, price, date, qty) per VPO×BOM
            → PR_Staging upload (one row per VPO×BOM)
              → SP_M3_MERGE_PR_DECISIONS → PR_Final
                → PO Consolidation → PO_Header + PO_Line
```

### 5.2 Proposed Flow (BOM-Aggregated for PUBLIC)

```
Material_Demand_VIEW (per VPO×BOM — unchanged)
  → SP_RUN_MATCHING_ENGINE (unchanged — still per VPO×BOM)
    → PR_Draft (unchanged — still per VPO×BOM)
      → Sourcing_Feed_VIEW (NEW: aggregation layer for PUBLIC)
        → M3 Assign_Sourcing Session (one row per BOM for PUBLIC)
          → User edits (supplier, price, date, qty) per BOM
            → PR_Staging upload (explode back to VPO-level or store as MULTI-VPO)
              → SP_M3_MERGE_PR_DECISIONS → PR_Final
                → PO Consolidation → PO_Header + PO_Line
```

The aggregation can happen at the **VIEW level** (new `Sourcing_Feed_Aggregated_VIEW`) or in the **Apps Script layer** (`_loadPendingPRsToSheet`). Part 2 explores both approaches.

---

## 6. Summary of Theories to Verify

| ID | Theory | Verification Method | Priority |
|---|---|---|---|
| T1.1 | BOM_TOLERANCE varies significantly for Chì BOMs | Query BOM_Order_List_Final for Chì tolerance distribution | 🔴 HIGH |
| T1.2 | Replacing CS tolerance with 10% brings system closer to Lead Plan | Compare GROSS_DEMAND under both tolerances | 🔴 HIGH |
| T1.3 | Delta is proportional to `|CS_tolerance - 0.10|` | Scatter plot of tolerance vs shortage delta | 🟡 MEDIUM |
| T2.1 | BOM_UPDATE appears multiple times per session due to multiple VPOs | Count distinct BOMs vs total rows in PR_Draft for Chì | 🔴 HIGH |
| T2.2 | MOQ/SPQ ceiling inflation is significant for multi-VPO BOMs | Calculate per-VPO ceiling sum vs aggregated ceiling for typical session | 🔴 HIGH |
| T2.3 | The `Supplier_Capacity.MOQ` column is used as SPQ (rounding increment) not true MOQ | Inspect CEILING formula + data values | 🟢 LOW (confirmed by code) |
| T3.1 | Warehouse total issuance per BOM is accurate | Compare BOM-level issuance total vs expected demand | 🟡 MEDIUM |
| T3.2 | Per-VPO issuance has attribution errors | Find BOMs where one VPO has excess issuance and another has zero | 🟡 MEDIUM |
| T3.3 | BOM-level aggregated shortage is a reliable sanity check | Cross-validate BOM-sum vs VPO-sum shortages | 🟡 MEDIUM |

---

## 7. Scope & Next Steps

- **Part 2** (`Part2_Assign_Sourcing_Analysis.md`): Python exploration scripts to run on Gemini 3.1 Pro against BigQuery, verifying each theory quantitatively.
- **Part 3** (`Part3_Assign_Sourcing_Analysis.md`): Standalone BigQuery SQL queries for manual console exploration, deep dives into specific BOMs, and verification of edge cases.
- **Implementation Phase** (future): After verification, implement the aggregated session, tolerance override, and BOM-level check column.

---

*Part 1 Complete — Problem Statement & Theory*
*This document preserves the full business context for future sessions, models, and accounts.*
