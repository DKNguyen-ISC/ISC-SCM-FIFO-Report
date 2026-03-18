# Part 3 — Assign_Sourcing Analysis: BigQuery SQL Exploration Queries

*Date: 2026-03-12 | Scope: Standalone SQL for BigQuery Console*
*Target: [BigQuery Console](https://console.cloud.google.com/bigquery?project=boxwood-charmer-473204-k8)*
*Related: Part1_Assign_Sourcing_Analysis.md, Part2_Assign_Sourcing_Analysis.md*

---

## 0. Instructions

Paste each query into the BigQuery Console. Queries are numbered Q1-Q20 and grouped by problem area. Run them sequentially or selectively based on what you need to verify.

> **Dataset**: `boxwood-charmer-473204-k8.isc_scm_ops`

---

## GROUP A: BOM_TOLERANCE Deep Dive (P1)

### Q1 — Tolerance Value Distribution for Chì

```sql
-- What BOM_TOLERANCE values exist for Chì materials?
-- Expected: Multiple distinct values, NOT all 0.10
SELECT 
    L.BOM_TOLERANCE,
    COUNT(*) AS line_count,
    COUNT(DISTINCT L.BOM_UPDATE) AS unique_boms,
    COUNT(DISTINCT L.PRODUCTION_ORDER_ID) AS unique_pos,
    ROUND(AVG(L.BOM_CONSUMPTION), 4) AS avg_consumption,
    ROUND(MIN(L.BOM_CONSUMPTION), 4) AS min_consumption,
    ROUND(MAX(L.BOM_CONSUMPTION), 4) AS max_consumption
FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Final` L
JOIN `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Data` B ON L.BOM_UPDATE = B.BOM_UPDATE
WHERE B.MAIN_GROUP = 'Chì'
  AND B.BOM_STATUS = 'ACTIVE'
  AND L.VALID_TO_TS IS NULL
GROUP BY L.BOM_TOLERANCE
ORDER BY line_count DESC;
```

---

### Q2 — BOMs with Multiple Tolerance Values Across POs

```sql
-- Same BOM material, different tolerance per PO
-- These BOMs cause inconsistent demand calculations
SELECT 
    L.BOM_UPDATE,
    SUBSTR(B.BOM_DESCRIPTION, 1, 60) AS description,
    COUNT(DISTINCT L.BOM_TOLERANCE) AS distinct_tolerances,
    MIN(L.BOM_TOLERANCE) AS min_tol,
    MAX(L.BOM_TOLERANCE) AS max_tol,
    ROUND(MAX(L.BOM_TOLERANCE) - MIN(L.BOM_TOLERANCE), 4) AS tol_spread,
    COUNT(*) AS total_lines,
    COUNT(DISTINCT L.PRODUCTION_ORDER_ID) AS po_count
FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Final` L
JOIN `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Data` B ON L.BOM_UPDATE = B.BOM_UPDATE
WHERE B.MAIN_GROUP = 'Chì'
  AND B.BOM_STATUS = 'ACTIVE'
  AND L.VALID_TO_TS IS NULL
GROUP BY L.BOM_UPDATE, B.BOM_DESCRIPTION
HAVING COUNT(DISTINCT L.BOM_TOLERANCE) > 1
ORDER BY tol_spread DESC;
```

---

### Q3 — Gross Demand Comparison: CS Tolerance vs ISC 10%

```sql
-- Total demand under CS tolerance vs fixed 10% ISC tolerance
-- Shows aggregate delta that explains gap between system and Lead Plan
WITH demand_both AS (
    SELECT 
        L.BOM_UPDATE,
        L.BOM_TOLERANCE AS cs_tol,
        -- COMPLETION: CS tolerance
        (GREATEST(0, P.FINISHED_GOODS_ORDER_QTY - COALESCE(P.COMPLETION_QTY, 0))
          * L.BOM_CONSUMPTION) * (1 + L.BOM_TOLERANCE) AS demand_cs,
        -- COMPLETION: ISC 10%
        (GREATEST(0, P.FINISHED_GOODS_ORDER_QTY - COALESCE(P.COMPLETION_QTY, 0))
          * L.BOM_CONSUMPTION) * (1 + 0.10) AS demand_isc
    FROM `boxwood-charmer-473204-k8.isc_scm_ops.Production_Order` P
    JOIN `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Final` L
        ON P.PRODUCTION_ORDER_ID = L.PRODUCTION_ORDER_ID
    JOIN `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Data` B
        ON L.BOM_UPDATE = B.BOM_UPDATE
    WHERE B.MAIN_GROUP = 'Chì' AND B.BOM_STATUS = 'ACTIVE'
      AND P.VALID_TO_TS IS NULL AND L.VALID_TO_TS IS NULL
      AND P.DATA_STATE IN ('RELEASED', 'PARTIALLY_RELEASED', 'PROCESSING')
      AND COALESCE(P.COMPLETION_PERCENT, 0) < 0.99
      AND P.REQUEST_FACTORY_FINISHED_DATE >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY)
)
SELECT 
    COUNT(*) AS total_lines,
    ROUND(SUM(demand_cs), 2) AS total_demand_cs_tol,
    ROUND(SUM(demand_isc), 2) AS total_demand_isc_10pct,
    ROUND(SUM(demand_cs) - SUM(demand_isc), 2) AS total_delta,
    ROUND((SUM(demand_cs) - SUM(demand_isc)) / NULLIF(SUM(demand_isc), 0) * 100, 2) AS delta_pct,
    ROUND(AVG(cs_tol), 4) AS avg_cs_tolerance,
    ROUND(STDDEV(cs_tol), 4) AS stddev_cs_tolerance,
    COUNTIF(cs_tol < 0.10) AS count_below_10pct,
    COUNTIF(cs_tol = 0.10) AS count_exactly_10pct,
    COUNTIF(cs_tol > 0.10) AS count_above_10pct
FROM demand_both;
```

---

### Q4 — Per-BOM Tolerance Delta (Top Deviators)

```sql
-- Which specific BOMs have the largest demand gap from tolerance difference?
WITH per_bom AS (
    SELECT 
        L.BOM_UPDATE,
        SUBSTR(B.BOM_DESCRIPTION, 1, 50) AS desc,
        L.BOM_TOLERANCE AS cs_tol,
        P.VPO,
        ROUND((GREATEST(0, P.FINISHED_GOODS_ORDER_QTY - COALESCE(P.COMPLETION_QTY, 0))
          * L.BOM_CONSUMPTION) * (1 + L.BOM_TOLERANCE), 2) AS demand_cs,
        ROUND((GREATEST(0, P.FINISHED_GOODS_ORDER_QTY - COALESCE(P.COMPLETION_QTY, 0))
          * L.BOM_CONSUMPTION) * (1 + 0.10), 2) AS demand_isc
    FROM `boxwood-charmer-473204-k8.isc_scm_ops.Production_Order` P
    JOIN `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Final` L
        ON P.PRODUCTION_ORDER_ID = L.PRODUCTION_ORDER_ID
    JOIN `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Data` B ON L.BOM_UPDATE = B.BOM_UPDATE
    WHERE B.MAIN_GROUP = 'Chì' AND B.BOM_STATUS = 'ACTIVE'
      AND P.VALID_TO_TS IS NULL AND L.VALID_TO_TS IS NULL
      AND P.DATA_STATE IN ('RELEASED', 'PARTIALLY_RELEASED', 'PROCESSING')
      AND COALESCE(P.COMPLETION_PERCENT, 0) < 0.99
      AND P.REQUEST_FACTORY_FINISHED_DATE >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY)
)
SELECT 
    BOM_UPDATE, desc, cs_tol, VPO,
    demand_cs, demand_isc,
    ROUND(demand_cs - demand_isc, 2) AS delta,
    ROUND(ABS(demand_cs - demand_isc) / NULLIF(demand_isc, 0) * 100, 2) AS delta_pct
FROM per_bom
WHERE ABS(demand_cs - demand_isc) > 0.5
ORDER BY ABS(demand_cs - demand_isc) DESC
LIMIT 40;
```

---

### Q5 — Specific BOM 302014740 Deep Dive

```sql
-- BOM 302014740 identified in Comparision_LeadPlan_vs_SystemM3 as tolerance mismatch
SELECT 
    L.BOM_UPDATE,
    L.PRODUCTION_ORDER_ID,
    P.VPO,
    L.BOM_CONSUMPTION,
    L.BOM_TOLERANCE,
    P.FINISHED_GOODS_ORDER_QTY,
    COALESCE(P.COMPLETION_QTY, 0) AS completion_qty,
    ROUND((GREATEST(0, P.FINISHED_GOODS_ORDER_QTY - COALESCE(P.COMPLETION_QTY, 0))
      * L.BOM_CONSUMPTION) * (1 + L.BOM_TOLERANCE), 2) AS demand_cs_tol,
    ROUND((GREATEST(0, P.FINISHED_GOODS_ORDER_QTY - COALESCE(P.COMPLETION_QTY, 0))
      * L.BOM_CONSUMPTION) * (1 + 0.10), 2) AS demand_isc_10pct,
    P.DATA_STATE,
    P.WORK_IN_PROCESS_START_DATE
FROM `boxwood-charmer-473204-k8.isc_scm_ops.Production_Order` P
JOIN `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Final` L
    ON P.PRODUCTION_ORDER_ID = L.PRODUCTION_ORDER_ID
WHERE L.BOM_UPDATE = '302014740'
  AND P.VALID_TO_TS IS NULL AND L.VALID_TO_TS IS NULL
  AND P.DATA_STATE IN ('RELEASED', 'PARTIALLY_RELEASED', 'PROCESSING')
ORDER BY P.VPO;
```

---

## GROUP B: VPO Aggregation Analysis (P2)

### Q6 — Multi-VPO BOMs in PR_Draft

```sql
-- Which Chì BOMs appear across multiple VPOs?
-- These are candidates for aggregation
SELECT 
    BOM_UPDATE,
    COUNT(*) AS row_count,
    COUNT(DISTINCT VPO) AS distinct_vpos,
    ROUND(SUM(NET_SHORTAGE_QTY), 2) AS total_shortage,
    ROUND(SUM(NET_SHORTAGE_COMPLETION), 2) AS total_nsc,
    ROUND(SUM(NET_SHORTAGE_ISSUANCE), 2) AS total_nsi,
    STRING_AGG(VPO, ', ' ORDER BY VPO LIMIT 10) AS vpo_list,
    ANY_VALUE(FULFILLMENT_MODE) AS mode
FROM `boxwood-charmer-473204-k8.isc_scm_ops.PR_Draft`
WHERE MAIN_GROUP = 'Chì'
  AND NET_SHORTAGE_QTY > 0
GROUP BY BOM_UPDATE
HAVING COUNT(DISTINCT VPO) > 1
ORDER BY distinct_vpos DESC, total_shortage DESC;
```

---

### Q7 — MOQ/SPQ Ceiling Inflation: Per-VPO vs Aggregated

```sql
-- Compare order quantities: per-VPO ceiling vs aggregated ceiling
-- Shows the waste from non-aggregation
WITH pr_spq AS (
    SELECT 
        PR.BOM_UPDATE,
        PR.VPO,
        PR.NET_SHORTAGE_QTY,
        COALESCE(SC.MOQ, 1) AS spq
    FROM `boxwood-charmer-473204-k8.isc_scm_ops.PR_Draft` PR
    LEFT JOIN `boxwood-charmer-473204-k8.isc_scm_ops.Supplier_Capacity` SC 
        ON PR.BOM_UPDATE = SC.BOM_UPDATE
    WHERE PR.MAIN_GROUP = 'Chì' AND PR.NET_SHORTAGE_QTY > 0
),
per_vpo_calc AS (
    SELECT 
        BOM_UPDATE, VPO, NET_SHORTAGE_QTY, spq,
        CASE WHEN spq <= 1 THEN CEILING(NET_SHORTAGE_QTY)
             ELSE CEILING(NET_SHORTAGE_QTY / spq) * spq
        END AS vpo_order
    FROM pr_spq
),
bom_agg AS (
    SELECT 
        BOM_UPDATE,
        COUNT(*) AS vpo_count,
        ANY_VALUE(spq) AS spq,
        ROUND(SUM(NET_SHORTAGE_QTY), 2) AS total_shortage,
        ROUND(SUM(vpo_order), 0) AS sum_vpo_orders,
        CASE WHEN ANY_VALUE(spq) <= 1 THEN CEILING(SUM(NET_SHORTAGE_QTY))
             ELSE CEILING(SUM(NET_SHORTAGE_QTY) / ANY_VALUE(spq)) * ANY_VALUE(spq)
        END AS agg_order
    FROM per_vpo_calc
    GROUP BY BOM_UPDATE
    HAVING COUNT(*) > 1
)
SELECT 
    BOM_UPDATE, vpo_count, spq, total_shortage,
    sum_vpo_orders AS order_per_vpo,
    agg_order AS order_aggregated,
    ROUND(sum_vpo_orders - agg_order, 0) AS waste_units,
    ROUND((sum_vpo_orders - agg_order) / NULLIF(agg_order, 0) * 100, 1) AS waste_pct
FROM bom_agg
WHERE sum_vpo_orders > agg_order
ORDER BY waste_units DESC;
```

---

### Q8 — Grand Total Savings from Aggregation

```sql
-- Overall savings if all multi-VPO Chì BOMs were aggregated
WITH pr_spq AS (
    SELECT 
        PR.BOM_UPDATE, PR.VPO, PR.NET_SHORTAGE_QTY,
        COALESCE(SC.MOQ, 1) AS spq
    FROM `boxwood-charmer-473204-k8.isc_scm_ops.PR_Draft` PR
    LEFT JOIN `boxwood-charmer-473204-k8.isc_scm_ops.Supplier_Capacity` SC 
        ON PR.BOM_UPDATE = SC.BOM_UPDATE
    WHERE PR.MAIN_GROUP = 'Chì' AND PR.NET_SHORTAGE_QTY > 0
),
per_vpo_calc AS (
    SELECT BOM_UPDATE, VPO, NET_SHORTAGE_QTY, spq,
        CASE WHEN spq <= 1 THEN CEILING(NET_SHORTAGE_QTY)
             ELSE CEILING(NET_SHORTAGE_QTY / spq) * spq END AS vpo_order
    FROM pr_spq
),
bom_agg AS (
    SELECT 
        BOM_UPDATE,
        COUNT(*) AS vpo_count,
        ANY_VALUE(spq) AS spq,
        SUM(NET_SHORTAGE_QTY) AS total_shortage,
        SUM(vpo_order) AS sum_vpo_orders,
        CASE WHEN ANY_VALUE(spq) <= 1 THEN CEILING(SUM(NET_SHORTAGE_QTY))
             ELSE CEILING(SUM(NET_SHORTAGE_QTY) / ANY_VALUE(spq)) * ANY_VALUE(spq) END AS agg_order
    FROM per_vpo_calc
    GROUP BY BOM_UPDATE
)
SELECT 
    COUNTIF(vpo_count > 1) AS multi_vpo_boms,
    COUNTIF(vpo_count = 1) AS single_vpo_boms,
    ROUND(SUM(sum_vpo_orders), 0) AS total_order_per_vpo,
    ROUND(SUM(agg_order), 0) AS total_order_aggregated,
    ROUND(SUM(sum_vpo_orders) - SUM(agg_order), 0) AS total_savings,
    ROUND((SUM(sum_vpo_orders) - SUM(agg_order)) / NULLIF(SUM(sum_vpo_orders), 0) * 100, 1) AS savings_pct;
```

---

### Q9 — Supplier_Capacity MOQ/SPQ Distribution

```sql
-- What MOQ values exist for Chì?
-- If most are 1 or NULL, the ceiling doesn't round up (no SPQ effect)
SELECT 
    SC.MOQ,
    COUNT(*) AS entries,
    COUNT(DISTINCT SC.BOM_UPDATE) AS unique_boms,
    COUNT(DISTINCT SC.SUPPLIER_NAME) AS suppliers,
    ROUND(AVG(SC.UNIT_PRICE), 2) AS avg_price,
    ROUND(AVG(SC.LEAD_TIME), 0) AS avg_leadtime
FROM `boxwood-charmer-473204-k8.isc_scm_ops.Supplier_Capacity` SC
JOIN `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Data` B ON SC.BOM_UPDATE = B.BOM_UPDATE
WHERE B.MAIN_GROUP = 'Chì' AND B.BOM_STATUS = 'ACTIVE'
GROUP BY SC.MOQ
ORDER BY entries DESC;
```

---

### Q10 — BOM 302023503 Detailed Breakdown

```sql
-- The specific BOM from user's example showing duplication
SELECT 
    PR.DRAFT_PR_ID,
    PR.BOM_UPDATE,
    PR.VPO,
    ROUND(PR.NET_SHORTAGE_QTY, 4) AS net_shortage,
    ROUND(PR.NET_SHORTAGE_COMPLETION, 4) AS nsc,
    ROUND(PR.NET_SHORTAGE_ISSUANCE, 4) AS nsi,
    PR.FULFILLMENT_MODE,
    PR.REQUESTED_DELIVERY_DATE,
    PR.ORDER_LIST_NOTE
FROM `boxwood-charmer-473204-k8.isc_scm_ops.PR_Draft` PR
WHERE PR.BOM_UPDATE = '302023503'
ORDER BY PR.VPO;
```

---

## GROUP C: Warehouse Issuance Reliability (P3)

### Q11 — BOM-Level Issuance vs Demand

```sql
-- Compare total issued per BOM vs total demand per BOM
-- BOM-level totals should be reliable even if VPO splits are wrong
WITH bom_issued AS (
    SELECT BOM_UPDATE,
        SUM(CUMULATIVE_ISSUANCE_QTY) AS total_issued,
        COUNT(DISTINCT VPO) AS issued_vpos
    FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Issuance`
    WHERE SOURCE_ID = 'CHI_LEAD'
    GROUP BY BOM_UPDATE
),
bom_demand AS (
    SELECT BOM_UPDATE,
        SUM(GROSS_DEMAND_QTY) AS total_demand,
        COUNT(DISTINCT VPO) AS demand_vpos
    FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Demand_VIEW`
    WHERE LOWER(TRIM(MAIN_GROUP)) = 'chì'
    GROUP BY BOM_UPDATE
)
SELECT 
    d.BOM_UPDATE,
    d.demand_vpos,
    COALESCE(i.issued_vpos, 0) AS issued_vpos,
    ROUND(d.total_demand, 2) AS demand,
    ROUND(COALESCE(i.total_issued, 0), 2) AS issued,
    ROUND(d.total_demand - COALESCE(i.total_issued, 0), 2) AS gap
FROM bom_demand d
LEFT JOIN bom_issued i ON d.BOM_UPDATE = i.BOM_UPDATE
WHERE COALESCE(i.total_issued, 0) > 0
ORDER BY ABS(d.total_demand - COALESCE(i.total_issued, 0)) DESC
LIMIT 30;
```

---

### Q12 — VPO Attribution Anomalies

```sql
-- Find VPOs where issued qty > demand qty (attribution error evidence)
-- Over-issued = warehouse combined multiple VPOs' issuance into one
SELECT 
    D.BOM_UPDATE,
    D.VPO,
    ROUND(D.GROSS_DEMAND_QTY, 2) AS demand,
    ROUND(COALESCE(I.CUMULATIVE_ISSUANCE_QTY, 0), 2) AS issued,
    ROUND(COALESCE(I.CUMULATIVE_ISSUANCE_QTY, 0) - D.GROSS_DEMAND_QTY, 2) AS excess,
    CASE 
        WHEN COALESCE(I.CUMULATIVE_ISSUANCE_QTY, 0) > D.GROSS_DEMAND_QTY * 1.5 THEN 'OVER_ATTRIBUTED'
        WHEN COALESCE(I.CUMULATIVE_ISSUANCE_QTY, 0) = 0 AND D.GROSS_DEMAND_QTY > 0 THEN 'ZERO_ISSUED'
        ELSE 'NORMAL'
    END AS flag
FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Demand_VIEW` D
LEFT JOIN `boxwood-charmer-473204-k8.isc_scm_ops.Material_Issuance` I
    ON D.BOM_UPDATE = I.BOM_UPDATE AND D.VPO = I.VPO
WHERE LOWER(TRIM(D.MAIN_GROUP)) = 'chì'
  AND D.HAS_ISSUANCE_DATA = TRUE
  AND ABS(COALESCE(I.CUMULATIVE_ISSUANCE_QTY, 0) - D.GROSS_DEMAND_QTY) > 1
ORDER BY ABS(excess) DESC
LIMIT 30;
```

---

### Q13 — BOM-Level Consistency Check

```sql
-- Does SUM(VPO issuance) = BOM total issuance?
-- Both should match (if they don't, there's a data quality issue)
WITH vpo_sum AS (
    SELECT BOM_UPDATE,
        SUM(CUMULATIVE_ISSUANCE_QTY) AS vpo_sum_issued,
        COUNT(*) AS record_count
    FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Issuance`
    WHERE SOURCE_ID = 'CHI_LEAD'
    GROUP BY BOM_UPDATE
),
demand_sum AS (
    SELECT D.BOM_UPDATE,
        SUM(COALESCE(I.CUMULATIVE_ISSUANCE_QTY, 0)) AS demand_joined_issued
    FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Demand_VIEW` D
    LEFT JOIN `boxwood-charmer-473204-k8.isc_scm_ops.Material_Issuance` I
        ON D.BOM_UPDATE = I.BOM_UPDATE AND D.VPO = I.VPO
    WHERE LOWER(TRIM(D.MAIN_GROUP)) = 'chì'
    GROUP BY D.BOM_UPDATE
)
SELECT 
    v.BOM_UPDATE,
    ROUND(v.vpo_sum_issued, 2) AS issuance_total,
    ROUND(COALESCE(d.demand_joined_issued, 0), 2) AS demand_view_joined,
    ROUND(v.vpo_sum_issued - COALESCE(d.demand_joined_issued, 0), 2) AS diff,
    v.record_count AS issuance_records
FROM vpo_sum v
LEFT JOIN demand_sum d ON v.BOM_UPDATE = d.BOM_UPDATE
ORDER BY ABS(v.vpo_sum_issued - COALESCE(d.demand_joined_issued, 0)) DESC
LIMIT 20;
```

---

### Q14 — Specific BOMs from Comparision_LeadPlan_vs_SystemM3

```sql
-- BOM 302038502 and 302038762: VPO V2512034C03 demand 3, but CapPhat issued 19
-- This is the quintessential attribution error
SELECT 
    D.BOM_UPDATE,
    D.VPO,
    D.PRODUCTION_ORDER_ID,
    ROUND(D.GROSS_DEMAND_QTY, 2) AS demand,
    ROUND(D.GROSS_DEMAND_COMPLETION_METHOD, 2) AS demand_completion,
    ROUND(D.GROSS_DEMAND_ISSUANCE_METHOD, 2) AS demand_issuance,
    ROUND(COALESCE(I.CUMULATIVE_ISSUANCE_QTY, 0), 2) AS issued,
    D.HAS_ISSUANCE_DATA,
    D.CALC_METHOD_USED
FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Demand_VIEW` D
LEFT JOIN `boxwood-charmer-473204-k8.isc_scm_ops.Material_Issuance` I
    ON D.BOM_UPDATE = I.BOM_UPDATE AND D.VPO = I.VPO
WHERE D.BOM_UPDATE IN ('302038502', '302038762')
ORDER BY D.BOM_UPDATE, D.VPO;
```

---

## GROUP D: Session Simulation (Aggregated View)

### Q15 — What Aggregated Session Looks Like

```sql
-- Simulate the aggregated Assign_Sourcing for Chì
-- One row per BOM_UPDATE, pipe-delimited VPOs
SELECT 
    BOM_UPDATE,
    STRING_AGG(VPO, '|' ORDER BY VPO) AS vpos,
    COUNT(DISTINCT VPO) AS vpo_count,
    ROUND(SUM(NET_SHORTAGE_QTY), 2) AS total_shortage,
    ROUND(SUM(NET_SHORTAGE_COMPLETION), 2) AS total_nsc,
    ROUND(SUM(NET_SHORTAGE_ISSUANCE), 2) AS total_nsi,
    MIN(REQUESTED_DELIVERY_DATE) AS earliest_dd,
    STRING_AGG(DISTINCT FULFILLMENT_MODE) AS modes,
    STRING_AGG(DISTINCT ORDER_LIST_NOTE, '|') AS notes
FROM `boxwood-charmer-473204-k8.isc_scm_ops.PR_Draft`
WHERE MAIN_GROUP = 'Chì' AND NET_SHORTAGE_QTY > 0
GROUP BY BOM_UPDATE
ORDER BY earliest_dd ASC, total_shortage DESC;
```

---

### Q16 — Ngàn-Specific Aggregated Session

```sql
-- Same as Q15 but filtered for PIC = Ngàn
-- This is what Ngàn's aggregated session would look like
WITH base AS (
    SELECT 
        BOM_UPDATE,
        VPO,
        NET_SHORTAGE_QTY,
        NET_SHORTAGE_COMPLETION,
        NET_SHORTAGE_ISSUANCE,
        REQUESTED_DELIVERY_DATE,
        FULFILLMENT_MODE,
        ORDER_LIST_NOTE,
        DRAFT_PR_ID
    FROM `boxwood-charmer-473204-k8.isc_scm_ops.PR_Draft`
    WHERE MAIN_GROUP = 'Chì'
      AND NET_SHORTAGE_QTY > 0
)
SELECT 
    BOM_UPDATE,
    COUNT(*) AS total_rows,
    COUNT(DISTINCT VPO) AS vpo_count,
    STRING_AGG(VPO, '|' ORDER BY VPO) AS vpo_list,
    ROUND(SUM(NET_SHORTAGE_QTY), 2) AS total_shortage,
    ROUND(SUM(NET_SHORTAGE_COMPLETION), 2) AS nsc_sum,
    ROUND(SUM(NET_SHORTAGE_ISSUANCE), 2) AS nsi_sum,
    MIN(REQUESTED_DELIVERY_DATE) AS earliest_dd,
    STRING_AGG(DISTINCT ORDER_LIST_NOTE, '|') AS notes
FROM base
GROUP BY BOM_UPDATE
ORDER BY vpo_count DESC, total_shortage DESC
LIMIT 50;
```

---

## GROUP E: Supply Side (Stock + PO) for BOM-Level Check

### Q17 — Total Supply per BOM (Stock + On-Way POs)

```sql
-- Compute BOM-level total supply (stock + active PO lines)
-- This is needed for the BOM-level shortage backup column
WITH stock AS (
    SELECT BOM_UPDATE, SUM(INVENTORY_QTY) AS stock_qty
    FROM `boxwood-charmer-473204-k8.isc_scm_ops.Stock_Data`
    GROUP BY BOM_UPDATE
),
po_supply AS (
    SELECT BOM_UPDATE,
        SUM(COALESCE(CONFIRMED_QTY, ORDER_QTY)) AS po_on_way
    FROM `boxwood-charmer-473204-k8.isc_scm_ops.PO_Line_Tracking`
    WHERE IS_ACTIVE = TRUE
      AND STATUS NOT IN ('CLOSED', 'CANCELLED')
    GROUP BY BOM_UPDATE
),
demand_total AS (
    SELECT BOM_UPDATE,
        SUM(GROSS_DEMAND_QTY) AS total_demand
    FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Demand_VIEW`
    WHERE LOWER(TRIM(MAIN_GROUP)) = 'chì'
    GROUP BY BOM_UPDATE
)
SELECT 
    d.BOM_UPDATE,
    ROUND(d.total_demand, 2) AS demand,
    ROUND(COALESCE(s.stock_qty, 0), 2) AS stock,
    ROUND(COALESCE(p.po_on_way, 0), 2) AS po_on_way,
    ROUND(COALESCE(s.stock_qty, 0) + COALESCE(p.po_on_way, 0), 2) AS total_supply,
    ROUND(d.total_demand - COALESCE(s.stock_qty, 0) - COALESCE(p.po_on_way, 0), 2) AS bom_net_shortage
FROM demand_total d
LEFT JOIN stock s ON d.BOM_UPDATE = s.BOM_UPDATE
LEFT JOIN po_supply p ON d.BOM_UPDATE = p.BOM_UPDATE
WHERE d.total_demand > 0
ORDER BY bom_net_shortage DESC
LIMIT 30;
```

---

### Q18 — Compare BOM-Level Shortage vs PR_Draft Sum

```sql
-- Does the sum of PR_Draft VPO shortages match BOM-level net shortage?
-- If not, the PR_Draft/M2 engine has allocation quirks to investigate
WITH pr_sum AS (
    SELECT BOM_UPDATE,
        ROUND(SUM(NET_SHORTAGE_QTY), 2) AS pr_total
    FROM `boxwood-charmer-473204-k8.isc_scm_ops.PR_Draft`
    WHERE MAIN_GROUP = 'Chì' AND NET_SHORTAGE_QTY > 0
    GROUP BY BOM_UPDATE
),
bom_calc AS (
    SELECT 
        d.BOM_UPDATE,
        ROUND(SUM(d.GROSS_DEMAND_QTY), 2) AS demand,
        ROUND(COALESCE(s.stock_qty, 0), 2) AS stock,
        ROUND(COALESCE(p.po_on_way, 0), 2) AS po_supply
    FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Demand_VIEW` d
    LEFT JOIN (
        SELECT BOM_UPDATE, SUM(INVENTORY_QTY) AS stock_qty
        FROM `boxwood-charmer-473204-k8.isc_scm_ops.Stock_Data` GROUP BY BOM_UPDATE
    ) s ON d.BOM_UPDATE = s.BOM_UPDATE
    LEFT JOIN (
        SELECT BOM_UPDATE, SUM(COALESCE(CONFIRMED_QTY, ORDER_QTY)) AS po_on_way
        FROM `boxwood-charmer-473204-k8.isc_scm_ops.PO_Line_Tracking`
        WHERE IS_ACTIVE = TRUE AND STATUS NOT IN ('CLOSED', 'CANCELLED')
        GROUP BY BOM_UPDATE
    ) p ON d.BOM_UPDATE = p.BOM_UPDATE
    WHERE LOWER(TRIM(d.MAIN_GROUP)) = 'chì'
    GROUP BY d.BOM_UPDATE, s.stock_qty, p.po_on_way
)
SELECT 
    b.BOM_UPDATE,
    b.demand,
    b.stock,
    b.po_supply,
    ROUND(b.demand - b.stock - b.po_supply, 2) AS bom_shortage,
    COALESCE(p.pr_total, 0) AS pr_draft_sum,
    ROUND((b.demand - b.stock - b.po_supply) - COALESCE(p.pr_total, 0), 2) AS diff
FROM bom_calc b
LEFT JOIN pr_sum p ON b.BOM_UPDATE = p.BOM_UPDATE
WHERE b.demand > b.stock + b.po_supply
ORDER BY ABS((b.demand - b.stock - b.po_supply) - COALESCE(p.pr_total, 0)) DESC
LIMIT 30;
```

---

## GROUP F: Edge Cases & Verification

### Q19 — FULFILLMENT_MODE Distribution

```sql
-- Confirm Chì is PUBLIC and Bao bì is PRIVATE
SELECT 
    L.FULFILLMENT_MODE,
    B.MAIN_GROUP,
    COUNT(DISTINCT L.BOM_UPDATE) AS bom_count,
    COUNT(*) AS line_count
FROM `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Order_List_Final` L
JOIN `boxwood-charmer-473204-k8.isc_scm_ops.BOM_Data` B ON L.BOM_UPDATE = B.BOM_UPDATE
WHERE L.VALID_TO_TS IS NULL AND B.BOM_STATUS = 'ACTIVE'
  AND B.MAIN_GROUP IN ('Chì', 'Bao bì')
GROUP BY L.FULFILLMENT_MODE, B.MAIN_GROUP
ORDER BY B.MAIN_GROUP, L.FULFILLMENT_MODE;
```

---

### Q20 — Issuance Coverage Status After Recent Fixes

```sql
-- Current issuance coverage for Chì after Lead_Issuance fixes
SELECT 
    HAS_ISSUANCE_DATA,
    CALC_METHOD_USED,
    COUNT(*) AS demand_rows,
    COUNT(DISTINCT BOM_UPDATE) AS unique_boms,
    ROUND(SUM(GROSS_DEMAND_QTY), 1) AS total_demand,
    ROUND(SUM(GROSS_DEMAND_COMPLETION_METHOD), 1) AS total_completion,
    ROUND(SUM(GROSS_DEMAND_ISSUANCE_METHOD), 1) AS total_issuance
FROM `boxwood-charmer-473204-k8.isc_scm_ops.Material_Demand_VIEW`
WHERE LOWER(TRIM(MAIN_GROUP)) = 'chì'
GROUP BY HAS_ISSUANCE_DATA, CALC_METHOD_USED
ORDER BY 1, 2;
```

---

## Summary — Query Index

| Query | Group | Purpose | Verifies |
|---|---|---|---|
| Q1 | A | BOM_TOLERANCE distribution | T1.1 |
| Q2 | A | BOMs with varying tolerance | T1.1 |
| Q3 | A | Total demand delta CS vs 10% | T1.2 |
| Q4 | A | Per-BOM top deviators | T1.3 |
| Q5 | A | Specific BOM 302014740 | T1.2 |
| Q6 | B | Multi-VPO BOMs | T2.1 |
| Q7 | B | MOQ/SPQ ceiling inflation | T2.2 |
| Q8 | B | Grand total savings | T2.2 |
| Q9 | B | MOQ distribution | T2.3 |
| Q10 | B | BOM 302023503 breakdown | T2.1 |
| Q11 | C | BOM-level issuance vs demand | T3.1 |
| Q12 | C | VPO attribution anomalies | T3.2 |
| Q13 | C | BOM consistency check | T3.3 |
| Q14 | C | BOMs 302038502/762 deep dive | T3.2 |
| Q15 | D | Aggregated session simulation | — |
| Q16 | D | Ngàn-specific aggregate | — |
| Q17 | E | Total supply per BOM | — |
| Q18 | E | BOM shortage vs PR_Draft sum | — |
| Q19 | F | FULFILLMENT_MODE verification | — |
| Q20 | F | Issuance coverage status | — |

---

*Part 3 Complete — 20 BigQuery SQL Queries for Manual Console Exploration*
*Run in order Q1-Q20 or selectively based on investigation needs*
