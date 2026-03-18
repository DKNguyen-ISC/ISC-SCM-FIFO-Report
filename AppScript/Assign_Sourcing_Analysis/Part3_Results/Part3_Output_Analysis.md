# Part 3 Output Analysis: Sourcing, Tolerance, and Aggregation Insights

*Based on BigQuery execution results provided in `Part3_run_output.txt`*

This document breaks down the findings from the 20 BigQuery exploratory queries (Part 3) regarding the `Assign_Sourcing` logic, Master Data tolerances, and the feasibility of VPO aggregation in the PR Draft. 

---

## 1. Tolerance Mismatches: The Root of Demand Discrepancies (Q1-Q5)

### Findings
*   **Widespread Variance:** `BOM_TOLERANCE` is far from standardized. Query 1 reveals that 0.04 (4%) and 0.03 (3%) are the most common values, NOT the 10% (0.10) that is typically assumed by system standard calculations (ISC flat 10%).
*   **Data Inconsistencies:** Across 100 distinct BOMs, a single BOM can have multiple different tolerance margins depending on the PO it's tied to (Q2). For instance, **BOM 302014364** spans **five different tolerances** ranging from 3% to 15% across 113 line items.
*   **The Quantitative Gap (Q3 & Q4):** 
    *   Total demand calculated via CS tolerance is `490,293.91`.
    *   Total demand calculated via a standardized ISC 10% flat tolerance is `511,201.17`.
    *   This equates to a strict **20,907 unit shortfall (-4.09%)**. The completion logic is systematically under-ordering if the physical factory consumes at 10% tolerance while standard Data sets it to 4% or 3%. 

### Why this matters
The `Comparision_LeadPlan_vs_SystemM3` issues where the Lead Plan requires slightly more material than the system calculates is directly proven here. The manual Lead Plan likely pads demand by an informal 10%, while the system strictly adheres to the flawed, un-updated `<10%` Master Data `BOM_TOLERANCE`.

---

## 2. The Case for VPO Aggregation (Q6-Q10)

### Findings
*   **High Fragmentation (Q6):** Dozens of Chì BOMs are split across multiple VPOs. E.g., `302016019` is split across 8 distinct VPOs, generating 8 different rows in the PR_Draft that the PIC must manually process!
*   **Per-VPO Fractional Yields (Q7, Q8):** Comparing the "order quantities" (rounded up via `CEILING` functions per VPO) versus "aggregated rounding", there is a small layer of fractional waste. However, Q8 shows total savings equal only **37 units (0.4%)** across all multi-VPO BOMs.
*   **Missing MOQs (Q9):** Why is the savings only 0.4%? Because **2,051 out of 2,051 Chì Supplier_Capacity entries are missing (NULL) MOQs**. The system effectively defaults MOQ to `1.0`. Thus, rounding up `16.1` to `17` wastes `0.9` units. If MOQs were `100`, ordering per VPO would cause catastrophic purchasing waste, but currently, it masks the issue.

### Why this matters
VPO aggregation isn't primarily about saving PO volume waste right now (due to missing MOQs). Rather, **it is about UX (User Experience)**. A planner like Ngàn has to look at 8 tiny PR lines for the exact same BOM (Q16). Consolidating these to a single decision row would dramatically reduce clicks and cognitive load in the `Assign_Sourcing` interface.

---

## 3. The Issuance "Over-Attribution" Phenomenon (Q11-Q14)

### Findings
*   **Vast Coverage Gaps (Q11):** BOM `302014364` has a demand of `118,650` units but only `8,800` units issued. 
*   **The "Zero-Demand, High-Issuance" Anomaly (Q12 & Q14):**
    *   Queries confirm that the warehouse frequently issues vast quantities of a material against **a single VPO**, even when that specific VPO demands zero or minimal quantities. 
    *   For example, `302012073` against VPO `V2511002C13` has a demand of `0.0` but an issuance of `361.11`.
    *   `302038502` against VPO `V2512034C03` requires only `3.57` units, but the warehouse issued `18.75` units against it, completely skipping the other 6 VPOs that needed the material.

### Why this matters
This definitively isolates the issue with the `ISSUANCE` calculation methodology. Because the warehouse "lazily" attributes a truckload of Chì to the first VPO on the paperwork, a strict `Demand - Issuance` calculation at the VPO level will yield massive negative numbers (surpluses) for the lucky VPO, and full shortages for the remaining VPOs that physically received the goods but didn't get system credit. **This completely validates the need to aggregate demand to the BOM level before netting against total BOM-level issuance.**

---

## 4. Method Selection and Phase 8 Status (Q19-Q20)

### Findings
*   **Distribution:** `Chì` is 100% `PUBLIC` mode (1,294 BOMs) and `Bao bì` is `PRIVATE` (544 BOMs).
*   **Adoption Rate:** Out of 2,954 demand rows for Chì, **only 102 rows** have transitioned to the `ISSUANCE` calculation method. The vast majority (2,852) are still relying on `COMPLETION`-based calculations. 

### Why this matters
The M4 Lead Issuance tracking is functional but heavily underutilized. Moving forward, either:
1. The warehouse must fix attribution rules (very hard).
2. The MRP engine (Module 2) must shift to a BOM-level aggregation model for `ISSUANCE` calculations (software-side fix). 

---

## Conclusion & Next Action Steps

1.  **System/Master Data Fix:** Master Data planners must align `BOM_TOLERANCE` in the system to match the strict Lead Plan spreadsheets, or the system needs a configuration toggle to enforce a global `10%` pad explicitly overriding Master Data.
2.  **Assign Sourcing Redesign:** Move forward with the `Assign_Sourcing` "VPO Aggregation" UI. While it won't save massive MOQ cash today, it will reduce spreadsheet clutter for the planning team by exactly 36 redundant PR lines per session.
3.  **Module 2 Refactor Priority:** The MRP engine needs an architectural update. When `HAS_ISSUANCE_DATA` is true, the system MUST combine all VPO demand into a `TOTAL_BOM_DEMAND`, subtract `TOTAL_BOM_ISSUANCE`, and then distribute the resulting shortage proportionally. Doing it at row-level is breaking the math due to warehouse habits.
