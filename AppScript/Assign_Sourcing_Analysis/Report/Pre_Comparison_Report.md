# Pre-Comparison Report: System vs. Lead Plan Discrepancies

This document outlines the core discrepancies between the ISC Supply Chain System calculations and the manual "Lead Plan" spreadsheet managed by the SC team. It provides the analytical groundwork for the final comparison report requested by management.

## 1. The Core Issues (Why the numbers don't match)

Based on the deep-dive analysis of the system architecture and BigQuery data, there are **three primary reasons** why the automated system's shortage calculations differ from the manual "Lead Plan" spreadsheet.

### P1: The Tolerance Disconnect (Demand Calculation)
The system calculates how much material is needed based on official Engineering standards. The planning team calculates based on operational buffers.

*   **System Method:** `(Order Qty - Completed Qty) * BOM Consumption * (1 + CS_BOM_TOLERANCE)`
    *   The `CS_BOM_TOLERANCE` comes directly from the master data provided by China HQ. 
    *   **The Reality:** The system data shows these tolerances are highly variable. Most are tight (3% or 4%), but some go as high as 15% to 19% depending on the specific VPO and BOM code.
*   **Lead Plan Method (Ngàn):** `(Order Qty - Completed Qty) * BOM Consumption * (1 + 10%)`
    *   The manual sheet applies a flat 10% buffer to almost all Chì materials.
*   **The Impact:** Across all active Chì orders, this difference accounts for a **20,907 unit discrepancy (a ~4% total variance)**. The system is structurally commanding less material than the planners want because the master data tolerances are significantly tighter than the operational 10% buffer.

### P2: VPO Fragmentation (Purchasing Strategy)
When placing purchasing requests (PRs), the system currently evaluates needs at the VPO level, while the planning team evaluates needs at the BOM level.

*   **System Method:** Calculates shortage *per VPO*. It then rounds that specific VPO's shortage up to the nearest Standard Package Quantity (SPQ).
*   **Lead Plan Method:** Calculates the total shortage *for the entire BOM* across all VPOs, and then rounds up.
*   **The Impact:** If a single BOM is split across 8 different VPOs, the system will apply the rounding logic 8 separate times, resulting in slight over-ordering (waste). Currently, because the Supplier Master Data is missing MOQ values for most Chì, the mathematical waste is small (0.4%). However, the **operational waste is huge**—planners have to review 8 separate PR lines instead of 1 aggregated line.

### P3: Warehouse Issuance "Laziness" (Attribution Errors)
The mechanism for tracking how much material has actually been consumed by the factory is fundamentally broken at the granular level.

*   **The Problem:** The warehouse issues stock in bulk (e.g., a full pallet of lead cores). Instead of dividing that issuance accurately across the three VPOs being produced that day, they book the entire pallet against the *first* VPO on the list to save data entry time.
*   **The Impact:** 
    *   VPO #1 looks like it has been massively over-issued (sometimes 100%+ over demand). The system thinks VPO #1 needs no more material.
    *   VPOs #2 and #3 look like they have received *zero* material, so the system recalculates their full demand as a severe shortage.
    *   **Crucial Note:** The *total* issuance for the BOM is correct. It's only the *distribution* among VPOs that is flawed.

---

## 2. Sample BOM Comparisons (The Real Numbers)

While a full live-scrape of the Lead Plan is pending, the SQL data isolated specific BOMs that perfectly illustrate these structural problems.

### Example 1: `302014740` (The Tolerance Victim - P1)
This item proves the Tolerance Disconnect. 
*   **System Calculation:** It applies tight tolerances (e.g., 3%). For VPO `V2512031C01`, the system calculates a gross demand of **5.49** units.
*   **10% Simulation (Lead Plan):** Using a flat 10%, the demand would be **5.87**.
*   The system is under-ordering compared to the manual sheet because it refuses to use the informal 10% buffer.

### Example 2: `302023503` (The Fragmentation Victim - P2)
This item proves the VPO Fragmentation issue.
*   **The Problem:** The total shortage is **~545 units**.
*   **System View:** It presents this as two separate lines to the planner:
    *   Line 1 (V2601015C01): **14.31** units short.
    *   Line 2 (V2512007C06): **531.09** units short.
*   **Lead Plan View:** Combines this into a single order decision for ~545 units, saving time and preventing multi-SPQ rounding waste.

### Example 3: `302038502` & `302038762` (The Warehouse Victims - P3)
These items prove the Issuance Attribution error.
*   **The Demand:** VPO `V2512034C03` required only **3.57** units of this BOM to complete its run.
*   **The Issuance:** The warehouse ledger (Cấp Phát) recorded an issuance of **18.75** units against this specific VPO.
*   **The Result:** The system flags this as a massive surplus for this VPO, driving the row-level shortage to zero, while other VPOs that likely consumed that material are left showing false shortages.

---

## 3. Proposed Solutions

To bring the system in line with operational reality and eliminate the need for the manual Lead Plan spreadsheet:

1.  **Solve P1 (Tolerance):** Introduce a "Tolerance Override" toggle in the Sourcing Session UI. Allow Planners to force the system to use "ISC Standard (10%)" instead of the master data "CS Tolerance" when calculating demand for a session.
2.  **Solve P2 (Fragmentation):** Implement **BOM-Level Aggregation** for PUBLIC materials (like Chì). The PR Draft and Sourcing Session should group all VPOs needing the same BOM into a single row, summing their shortages.
3.  **Solve P3 (Warehouse):** By implementing Solution 2 (BOM-Level Aggregation), we effectively neutralize the warehouse attribution error. If we evaluate shortage at the BOM level `(Total BOM Demand - Total BOM Issued)`, the VPO-level data entry mistakes no longer impact the final purchasing math.

---

## Discussion Notes for System Architect & User

Before generating the final management report, we need to decide on the presentation format:

1.  **Format:** Should this be a clean, readable Markdown document (like this one), or an attractive HTML report that can be opened in a browser or printed to PDF? Given it's for the "boss," an HTML report with styling and perhaps a chart graphic might be more impactful.
2.  **Live Inspection:** Let me know if you still want me to attempt another browser subagent run to capture screenshots or exact live cell values from Ngàn's Google Sheet, or if the SQL evidence is sufficient to make the case.
