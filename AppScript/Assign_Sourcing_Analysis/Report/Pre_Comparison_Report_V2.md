# Pre-Comparison Report V2: System vs. Lead Plan Discrepancies

**Date:** March 2026
**Subject:** Root Cause Analysis of Demand Calculation Variances
**Target Audience:** Supply Chain Management & Planning Teams

---

## Executive Summary

An intensive audit of the ISC Supply Chain System (M3 / BigQuery) versus the manual "Lead Plan" workflows has revealed that the discrepancies in Shortage/Demand calculations are **structural, not random**. The automated system strictly follows Master Data parameters and distinct VPO isolation, while the manual Lead Plan spreadsheet employs operational heuristics (buffers and aggregation) to save time and prevent stockouts. 

This report outlines the three mathematically proven reasons for calculating mismatches, supported by system database exports.

---

## 1. The Tolerance Disconnect (Demand Calculation)

The most significant driver of mismatched numbers (accounting for a ~4% overall variance, or ~20,900 units roughly across Chì materials) is the difference in safety buffering.

### The System Math
The system calculates demand based strictly on the Master Data `BOM_TOLERANCE` imported from HQ:
**Formula:** `[ (Order Qty - Completed Qty) * BOM Consumption ] * (1 + CS_BOM_TOLERANCE)`

*Reality:* BigQuery data shows that HQ Master Data tolerances for Chì are incredibly tight—mostly **3% or 4%**. Worse, a single BOM can have fluctuating tolerances (from 3% to 15%) depending on which VPO it is attached to.

### The Lead Plan Math
The planning team overrides the system's strict master data to ensure production safety buffers.
**Formula:** `[ (Order Qty - Completed Qty) * BOM Consumption ] * (1 + 10%)`

### Case Study: BOM `302014740` (The Tolerance Victim)
For VPO `V2512031C01` (Order Qty: 32, Consumption: 0.166667):
*   **System Calculation:** `(32 - 0) * 0.166667 * 1.03` = **5.49 units**
*   **Lead Plan Calculation:** `(32 - 0) * 0.166667 * 1.10` = **~5.87 units**
*   **Result:** The system structurally under-orders compared to the planner's physical expectations.

---

## 2. VPO Fragmentation vs. Aggregation (Purchasing Strategy)

The system isolates demand line-by-line per VPO. The Lead Plan spreadsheet groups demand by BOM across all active VPOs to simplify the purchasing (PR) view.

### The Problem
When the system calculates shortages per VPO, it rounds up to the nearest Standard Package Quantity (SPQ) per VPO. If a BOM is split across 8 VPOs, the system rounds up 8 times. The manual Lead Plan aggregates the total raw demand first, and *then* rounds up once. 

### Case Study: BOM `302023503` (The Fragmentation Victim)
*   **System View:** Generates two heavily fragmented PR lines.
    *   Line 1 (V2601015C01): **14.31** units short.
    *   Line 2 (V2512007C06): **531.09** units short.
*   **Lead Plan View:** The planner mechanically combines these rows in the spreadsheet, identifying a single aggregated shortage of **~545 units**, dramatically reducing PO complexity.

---

## 3. Warehouse Issuance "Laziness" (Attribution Errors)

The tracking of material dispatched to the factory floor (Issuance / Cấp Phát) is causing severe calculation distortions. 

### The Problem
When the warehouse delivers a bulk pallet of material (e.g., Lead Cores), they are supposed to distribute that issuance proportionally across the VPOs being produced. Instead, to save data entry time, warehouse staff frequently attribute the *entire shipment* to the very first VPO on the documentation.

### Case Study: BOM `302038502` / `302038762` (The Warehouse Victims)
*   **The System Reality:** VPO `V2512034C03` required exactly **3.57** units of lead. 
*   **Warehouse Entry:** The warehouse booked a massive **18.75** units against this single VPO, completely ignoring the other VPOs on the factory floor that actually consumed the rest.
*   **The Lead Plan Workaround:** The manual spreadsheet handles this logically by looking at the *Macro BOM level*: `(Total Issued - Total Consumed)`. The planner ignores the botched VPO-level distribution, effectively neutralizing the warehouse's data entry error—something the strict M3 calculation engine cannot currently do.

---

## Conclusion & Strategic Recommendations

To sunset the manual Lead Plan spreadsheet and rely purely on the ISC System, we must update the software to replicate the operational intelligence of the planners:

1.  **Tolerance Override Toggle (UI Feature):** Update the `Assign_Sourcing` interface to allow planners to explicitly apply a "Global 10% Buffer" that overrides the HQ `BOM_TOLERANCE` master data during shortage calculations.
2.  **BOM-Level Aggregation (System Core):** For `PUBLIC` materials like Chì, restructure the MRP engine to aggregate all demand and all issuance at the **BOM level** across active VPOs before calculating the net shortage. This physically prevents the warehouse's lazy attribution habits from breaking the purchasing math.
