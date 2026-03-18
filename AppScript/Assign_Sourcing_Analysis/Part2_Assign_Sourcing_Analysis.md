# Part 2 — Assign_Sourcing Analysis: Python Exploration Methods

*Date: 2026-03-12 | Scope: BigQuery Python exploration for verifying Part 1 theories*
*Execution Target: Gemini 3.1 Pro (next chat session after approval)*
*Related: Part1_Assign_Sourcing_Analysis.md, Part3_Assign_Sourcing_Analysis.md*

---

## 0. Execution Instructions

> **⚠️ IMPORTANT**: This Python code is **NOT** to be executed in this session. It is designed to be run by **Gemini 3.1 Pro** in a separate chat window after:
> 1. All three analysis files have been generated and saved
> 2. The user (Khánh) has reviewed and approved the analysis
> 3. A new chat session is started with Gemini 3.1 Pro

### Environment Requirements
- Python 3.8+
- `google-cloud-bigquery` library (pip install google-cloud-bigquery)
- Service account credentials with BigQuery read access to `boxwood-charmer-473204-k8.isc_scm_ops`
- Or: Run from Google Cloud Shell / Colab with authenticated gcloud

### BigQuery Project Details
```
PROJECT_ID = "boxwood-charmer-473204-k8"
DATASET_ID = "isc_scm_ops"
```

---

## 1. Master Exploration Script

```python
#!/usr/bin/env python3
"""
Assign_Sourcing Analysis — Master Exploration Script
=====================================================
Verifies theories T1.1-T3.3 from Part1_Assign_Sourcing_Analysis.md
Run on Gemini 3.1 Pro with BigQuery access.

Sections:
  S1: BOM_TOLERANCE Distribution Analysis (T1.1, T1.2, T1.3)
  S2: VPO Aggregation Impact Analysis (T2.1, T2.2)
  S3: MOQ/SPQ Analysis (T2.3)
  S4: Warehouse Issuance Reliability (T3.1, T3.2, T3.3)
  S5: Lead Plan Comparison Simulation
  S6: Aggregated Session Prototype Query
  S7: Summary Report

Author: Antigravity AI
Date: 2026-03-12
"""

from google.cloud import bigquery
import json
import sys
from collections import defaultdict

# ============================================================
# CONFIG
# ============================================================
PROJECT_ID = "boxwood-charmer-473204-k8"
DATASET_ID = "isc_scm_ops"
FULL_DATASET = f"{PROJECT_ID}.{DATASET_ID}"

client = bigquery.Client(project=PROJECT_ID)

def run_query(sql, label=""):
    """Execute a BigQuery SQL query and return results as list of dicts."""
    print(f"\n{'='*70}")
    print(f"📊 {label}")
    print(f"{'='*70}")
    try:
        result = client.query(sql).result()
        rows = [dict(row) for row in result]
        print(f"   Returned {len(rows)} rows")
        return rows
    except Exception as e:
        print(f"   ❌ ERROR: {e}")
        return []

def print_table(rows, max_rows=20, columns=None):
    """Pretty-print query results as a table."""
    if not rows:
        print("   (no data)")
        return
    cols = columns or list(rows[0].keys())
    # Calculate widths
    widths = {c: max(len(str(c)), max(len(str(r.get(c, ''))) for r in rows[:max_rows])) for c in cols}
    header = " | ".join(str(c).ljust(widths[c]) for c in cols)
    separator = "-+-".join("-" * widths[c] for c in cols)
    print(f"   {header}")
    print(f"   {separator}")
    for i, row in enumerate(rows[:max_rows]):
        line = " | ".join(str(row.get(c, '')).ljust(widths[c]) for c in cols)
        print(f"   {line}")
    if len(rows) > max_rows:
        print(f"   ... ({len(rows) - max_rows} more rows)")


# ============================================================
# SECTION 1: BOM_TOLERANCE Distribution (T1.1, T1.2, T1.3)
# ============================================================
print("\n" + "█"*70)
print("█ SECTION 1: BOM_TOLERANCE DISTRIBUTION FOR CHÌ MATERIALS")
print("█"*70)

# --- S1.1: What BOM_TOLERANCE values exist for Chì BOMs? ---
s1_1 = run_query(f"""
    SELECT 
        L.BOM_TOLERANCE,
        COUNT(*) AS line_count,
        COUNT(DISTINCT L.BOM_UPDATE) AS unique_boms,
        COUNT(DISTINCT L.PRODUCTION_ORDER_ID) AS unique_pos,
        ROUND(AVG(L.BOM_CONSUMPTION), 4) AS avg_consumption
    FROM `{FULL_DATASET}.BOM_Order_List_Final` L
    JOIN `{FULL_DATASET}.BOM_Data` B ON L.BOM_UPDATE = B.BOM_UPDATE
    WHERE B.MAIN_GROUP = 'Chì'
      AND B.BOM_STATUS = 'ACTIVE'
      AND L.VALID_TO_TS IS NULL
    GROUP BY L.BOM_TOLERANCE
    ORDER BY line_count DESC
""", "S1.1 — BOM_TOLERANCE value distribution for Chì")
print_table(s1_1)

# --- S1.2: For each BOM, how much does tolerance vary across POs? ---
s1_2 = run_query(f"""
    SELECT 
        L.BOM_UPDATE,
        B.BOM_DESCRIPTION,
        COUNT(DISTINCT L.BOM_TOLERANCE) AS distinct_tolerances,
        ARRAY_AGG(DISTINCT L.BOM_TOLERANCE ORDER BY L.BOM_TOLERANCE) AS tolerance_values,
        MIN(L.BOM_TOLERANCE) AS min_tol,
        MAX(L.BOM_TOLERANCE) AS max_tol,
        ROUND(MAX(L.BOM_TOLERANCE) - MIN(L.BOM_TOLERANCE), 4) AS tol_range,
        COUNT(*) AS total_lines
    FROM `{FULL_DATASET}.BOM_Order_List_Final` L
    JOIN `{FULL_DATASET}.BOM_Data` B ON L.BOM_UPDATE = B.BOM_UPDATE
    WHERE B.MAIN_GROUP = 'Chì'
      AND B.BOM_STATUS = 'ACTIVE'
      AND L.VALID_TO_TS IS NULL
    GROUP BY L.BOM_UPDATE, B.BOM_DESCRIPTION
    HAVING COUNT(DISTINCT L.BOM_TOLERANCE) > 1
    ORDER BY tol_range DESC
    LIMIT 30
""", "S1.2 — BOMs with VARYING tolerance across different POs")
print_table(s1_2)

# --- S1.3: Simulate 10% tolerance vs CS tolerance impact on GROSS_DEMAND ---
s1_3 = run_query(f"""
    WITH demand_calc AS (
        SELECT 
            D.BOM_UPDATE,
            D.VPO,
            D.PRODUCTION_ORDER_ID,
            L.BOM_TOLERANCE AS cs_tolerance,
            0.10 AS isc_tolerance,
            
            -- COMPLETION METHOD with CS tolerance (current system)
            (GREATEST(0, P.FINISHED_GOODS_ORDER_QTY - COALESCE(P.COMPLETION_QTY, 0))
              * L.BOM_CONSUMPTION) * (1 + L.BOM_TOLERANCE) AS gross_demand_cs,
            
            -- COMPLETION METHOD with ISC 10% tolerance (Ngàn's method)
            (GREATEST(0, P.FINISHED_GOODS_ORDER_QTY - COALESCE(P.COMPLETION_QTY, 0))
              * L.BOM_CONSUMPTION) * (1 + 0.10) AS gross_demand_isc,
            
            -- ISSUANCE METHOD with CS tolerance
            GREATEST(0,
              (P.FINISHED_GOODS_ORDER_QTY * L.BOM_CONSUMPTION * (1 + L.BOM_TOLERANCE))
              - COALESCE(I.CUMULATIVE_ISSUANCE_QTY, 0)
            ) AS gross_demand_issuance_cs,
            
            -- ISSUANCE METHOD with ISC 10% tolerance
            GREATEST(0,
              (P.FINISHED_GOODS_ORDER_QTY * L.BOM_CONSUMPTION * (1 + 0.10))
              - COALESCE(I.CUMULATIVE_ISSUANCE_QTY, 0)
            ) AS gross_demand_issuance_isc
            
        FROM `{FULL_DATASET}.Production_Order` P
        JOIN `{FULL_DATASET}.BOM_Order_List_Final` L
            ON P.PRODUCTION_ORDER_ID = L.PRODUCTION_ORDER_ID
        JOIN `{FULL_DATASET}.BOM_Data` B
            ON L.BOM_UPDATE = B.BOM_UPDATE
        LEFT JOIN `{FULL_DATASET}.Material_Issuance` I
            ON L.BOM_UPDATE = I.BOM_UPDATE AND P.VPO = I.VPO
        WHERE B.MAIN_GROUP = 'Chì'
          AND B.BOM_STATUS = 'ACTIVE'
          AND P.VALID_TO_TS IS NULL
          AND L.VALID_TO_TS IS NULL
          AND P.DATA_STATE IN ('RELEASED', 'PARTIALLY_RELEASED', 'PROCESSING')
          AND COALESCE(P.COMPLETION_PERCENT, 0) < 0.99
          AND P.REQUEST_FACTORY_FINISHED_DATE >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY)
    )
    SELECT 
        'COMPLETION' AS method,
        COUNT(*) AS total_demand_lines,
        ROUND(SUM(gross_demand_cs), 2) AS total_cs_demand,
        ROUND(SUM(gross_demand_isc), 2) AS total_isc_demand,
        ROUND(SUM(gross_demand_cs) - SUM(gross_demand_isc), 2) AS total_delta,
        ROUND((SUM(gross_demand_cs) - SUM(gross_demand_isc)) / NULLIF(SUM(gross_demand_isc), 0) * 100, 2) AS delta_percent,
        ROUND(AVG(cs_tolerance), 4) AS avg_cs_tolerance,
        MIN(cs_tolerance) AS min_cs_tolerance,
        MAX(cs_tolerance) AS max_cs_tolerance
    FROM demand_calc
    
    UNION ALL
    
    SELECT 
        'ISSUANCE' AS method,
        COUNT(*) AS total_demand_lines,
        ROUND(SUM(gross_demand_issuance_cs), 2) AS total_cs_demand,
        ROUND(SUM(gross_demand_issuance_isc), 2) AS total_isc_demand,
        ROUND(SUM(gross_demand_issuance_cs) - SUM(gross_demand_issuance_isc), 2) AS total_delta,
        ROUND((SUM(gross_demand_issuance_cs) - SUM(gross_demand_issuance_isc)) / NULLIF(SUM(gross_demand_issuance_isc), 0) * 100, 2) AS delta_percent,
        ROUND(AVG(cs_tolerance), 4) AS avg_cs_tolerance,
        MIN(cs_tolerance) AS min_cs_tolerance,
        MAX(cs_tolerance) AS max_cs_tolerance
    FROM demand_calc
""", "S1.3 — Total demand comparison: CS tolerance vs ISC 10% tolerance")
print_table(s1_3)

# --- S1.4: Per-BOM delta analysis (Top deviators) ---
s1_4 = run_query(f"""
    WITH per_bom AS (
        SELECT 
            L.BOM_UPDATE,
            B.BOM_DESCRIPTION,
            L.BOM_TOLERANCE AS cs_tol,
            COUNT(*) AS vpo_count,
            ROUND(SUM(
                (GREATEST(0, P.FINISHED_GOODS_ORDER_QTY - COALESCE(P.COMPLETION_QTY, 0))
                  * L.BOM_CONSUMPTION) * (1 + L.BOM_TOLERANCE)
            ), 2) AS demand_cs,
            ROUND(SUM(
                (GREATEST(0, P.FINISHED_GOODS_ORDER_QTY - COALESCE(P.COMPLETION_QTY, 0))
                  * L.BOM_CONSUMPTION) * (1 + 0.10)
            ), 2) AS demand_isc
        FROM `{FULL_DATASET}.Production_Order` P
        JOIN `{FULL_DATASET}.BOM_Order_List_Final` L ON P.PRODUCTION_ORDER_ID = L.PRODUCTION_ORDER_ID
        JOIN `{FULL_DATASET}.BOM_Data` B ON L.BOM_UPDATE = B.BOM_UPDATE
        WHERE B.MAIN_GROUP = 'Chì' AND B.BOM_STATUS = 'ACTIVE'
          AND P.VALID_TO_TS IS NULL AND L.VALID_TO_TS IS NULL
          AND P.DATA_STATE IN ('RELEASED', 'PARTIALLY_RELEASED', 'PROCESSING')
          AND COALESCE(P.COMPLETION_PERCENT, 0) < 0.99
          AND P.REQUEST_FACTORY_FINISHED_DATE >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY)
        GROUP BY L.BOM_UPDATE, B.BOM_DESCRIPTION, L.BOM_TOLERANCE
    )
    SELECT 
        BOM_UPDATE,
        SUBSTR(BOM_DESCRIPTION, 1, 50) AS description,
        cs_tol,
        vpo_count,
        demand_cs,
        demand_isc,
        ROUND(demand_cs - demand_isc, 2) AS delta,
        ROUND(ABS(demand_cs - demand_isc) / NULLIF(demand_isc, 0) * 100, 2) AS delta_pct
    FROM per_bom
    WHERE ABS(demand_cs - demand_isc) > 1
    ORDER BY ABS(demand_cs - demand_isc) DESC
    LIMIT 30
""", "S1.4 — Top 30 BOMs with largest CS-vs-ISC tolerance delta")
print_table(s1_4)


# ============================================================
# SECTION 2: VPO AGGREGATION IMPACT (T2.1, T2.2)
# ============================================================
print("\n" + "█"*70)
print("█ SECTION 2: VPO AGGREGATION IMPACT ANALYSIS")
print("█"*70)

# --- S2.1: How many BOMs appear in multiple VPOs? ---
s2_1 = run_query(f"""
    WITH pr_data AS (
        SELECT 
            BOM_UPDATE,
            VPO,
            NET_SHORTAGE_QTY,
            FULFILLMENT_MODE
        FROM `{FULL_DATASET}.PR_Draft`
        WHERE MAIN_GROUP = 'Chì'
          AND NET_SHORTAGE_QTY > 0
    )
    SELECT 
        BOM_UPDATE,
        COUNT(*) AS vpo_count,
        COUNT(DISTINCT VPO) AS distinct_vpos,
        ROUND(SUM(NET_SHORTAGE_QTY), 2) AS total_shortage,
        ARRAY_AGG(DISTINCT VPO ORDER BY VPO) AS vpo_list,
        ARRAY_AGG(ROUND(NET_SHORTAGE_QTY, 2) ORDER BY VPO) AS shortage_per_vpo,
        ANY_VALUE(FULFILLMENT_MODE) AS mode
    FROM pr_data
    GROUP BY BOM_UPDATE
    HAVING COUNT(DISTINCT VPO) > 1
    ORDER BY vpo_count DESC
    LIMIT 30
""", "S2.1 — BOMs appearing in MULTIPLE VPOs (Chì, positive shortage)")
print_table(s2_1, columns=['BOM_UPDATE', 'vpo_count', 'distinct_vpos', 'total_shortage', 'mode'])

# --- S2.2: MOQ/SPQ ceiling inflation calculation ---
# NOTE: This query simulates what Ngàn sees. It requires the
# Supplier_Capacity MOQ value.
s2_2 = run_query(f"""
    WITH pr_data AS (
        SELECT 
            PR.BOM_UPDATE,
            PR.VPO,
            PR.NET_SHORTAGE_QTY,
            PR.FULFILLMENT_MODE,
            COALESCE(SC.MOQ, 1) AS spq  -- SPQ from Supplier_Capacity (labeled MOQ)
        FROM `{FULL_DATASET}.PR_Draft` PR
        LEFT JOIN `{FULL_DATASET}.Supplier_Capacity` SC 
            ON PR.BOM_UPDATE = SC.BOM_UPDATE
        WHERE PR.MAIN_GROUP = 'Chì'
          AND PR.NET_SHORTAGE_QTY > 0
    ),
    per_vpo_ceiling AS (
        SELECT 
            BOM_UPDATE,
            VPO,
            NET_SHORTAGE_QTY,
            spq,
            -- CEILING to nearest SPQ (mimics CEILING formula in Zone A)
            CASE WHEN spq <= 1 THEN CEILING(NET_SHORTAGE_QTY)
                 ELSE CEILING(NET_SHORTAGE_QTY / spq) * spq
            END AS vpo_order_qty
        FROM pr_data
    ),
    aggregated AS (
        SELECT 
            BOM_UPDATE,
            COUNT(*) AS vpo_count,
            ANY_VALUE(spq) AS spq,
            SUM(NET_SHORTAGE_QTY) AS total_shortage,
            SUM(vpo_order_qty) AS sum_vpo_ceilings,
            -- Ceiling of the TOTAL shortage
            CASE WHEN ANY_VALUE(spq) <= 1 THEN CEILING(SUM(NET_SHORTAGE_QTY))
                 ELSE CEILING(SUM(NET_SHORTAGE_QTY) / ANY_VALUE(spq)) * ANY_VALUE(spq)
            END AS aggregated_ceiling
        FROM per_vpo_ceiling
        GROUP BY BOM_UPDATE
        HAVING COUNT(*) > 1  -- Only multi-VPO BOMs
    )
    SELECT 
        BOM_UPDATE,
        vpo_count,
        spq,
        ROUND(total_shortage, 2) AS total_shortage,
        ROUND(sum_vpo_ceilings, 0) AS order_qty_per_vpo_method,
        ROUND(aggregated_ceiling, 0) AS order_qty_aggregated_method,
        ROUND(sum_vpo_ceilings - aggregated_ceiling, 0) AS waste_qty,
        ROUND((sum_vpo_ceilings - aggregated_ceiling) / NULLIF(aggregated_ceiling, 0) * 100, 1) AS waste_pct
    FROM aggregated
    WHERE sum_vpo_ceilings > aggregated_ceiling
    ORDER BY waste_qty DESC
    LIMIT 30
""", "S2.2 — MOQ/SPQ ceiling inflation: per-VPO vs aggregated ordering")
print_table(s2_2)

# --- S2.3: Total savings summary ---
s2_3 = run_query(f"""
    WITH pr_data AS (
        SELECT 
            PR.BOM_UPDATE,
            PR.VPO,
            PR.NET_SHORTAGE_QTY,
            COALESCE(SC.MOQ, 1) AS spq
        FROM `{FULL_DATASET}.PR_Draft` PR
        LEFT JOIN `{FULL_DATASET}.Supplier_Capacity` SC 
            ON PR.BOM_UPDATE = SC.BOM_UPDATE
        WHERE PR.MAIN_GROUP = 'Chì'
          AND PR.NET_SHORTAGE_QTY > 0
    ),
    per_vpo AS (
        SELECT 
            BOM_UPDATE, VPO, NET_SHORTAGE_QTY, spq,
            CASE WHEN spq <= 1 THEN CEILING(NET_SHORTAGE_QTY)
                 ELSE CEILING(NET_SHORTAGE_QTY / spq) * spq
            END AS vpo_order
        FROM pr_data
    ),
    bom_agg AS (
        SELECT 
            BOM_UPDATE,
            COUNT(*) AS vpo_count,
            COUNT(DISTINCT VPO) AS distinct_vpos,
            SUM(NET_SHORTAGE_QTY) AS total_shortage,
            SUM(vpo_order) AS sum_vpo_orders,
            ANY_VALUE(spq) AS spq,
            CASE WHEN ANY_VALUE(spq) <= 1 THEN CEILING(SUM(NET_SHORTAGE_QTY))
                 ELSE CEILING(SUM(NET_SHORTAGE_QTY) / ANY_VALUE(spq)) * ANY_VALUE(spq)
            END AS agg_order
        FROM per_vpo
        GROUP BY BOM_UPDATE
    )
    SELECT 
        -- Multi-VPO BOMs
        COUNTIF(vpo_count > 1) AS multi_vpo_bom_count,
        -- Single-VPO BOMs (no savings)
        COUNTIF(vpo_count = 1) AS single_vpo_bom_count,
        -- Total order qty under per-VPO method
        ROUND(SUM(sum_vpo_orders), 0) AS total_order_per_vpo,
        -- Total order qty under aggregated method  
        ROUND(SUM(agg_order), 0) AS total_order_aggregated,
        -- Savings
        ROUND(SUM(sum_vpo_orders) - SUM(agg_order), 0) AS total_savings_qty,
        ROUND((SUM(sum_vpo_orders) - SUM(agg_order)) / NULLIF(SUM(sum_vpo_orders), 0) * 100, 1) AS savings_pct
    FROM bom_agg
""", "S2.3 — Total ordering savings: per-VPO vs aggregated (all Chì)")
print_table(s2_3)


# ============================================================
# SECTION 3: MOQ vs SPQ ANALYSIS (T2.3)
# ============================================================
print("\n" + "█"*70)
print("█ SECTION 3: MOQ / SPQ ANALYSIS")
print("█"*70)

# --- S3.1: What MOQ values exist in Supplier_Capacity for Chì? ---
s3_1 = run_query(f"""
    SELECT 
        SC.MOQ,
        COUNT(*) AS capacity_entries,
        COUNT(DISTINCT SC.BOM_UPDATE) AS unique_boms,
        COUNT(DISTINCT SC.SUPPLIER_NAME) AS unique_suppliers
    FROM `{FULL_DATASET}.Supplier_Capacity` SC
    JOIN `{FULL_DATASET}.BOM_Data` B ON SC.BOM_UPDATE = B.BOM_UPDATE
    WHERE B.MAIN_GROUP = 'Chì'
      AND B.BOM_STATUS = 'ACTIVE'
    GROUP BY SC.MOQ
    ORDER BY capacity_entries DESC
""", "S3.1 — MOQ values in Supplier_Capacity for Chì BOMs")
print_table(s3_1)

# --- S3.2: BOMs with MOQ > typical shortage (would trigger ceiling) ---
s3_2 = run_query(f"""
    WITH bom_shortage AS (
        SELECT 
            BOM_UPDATE,
            SUM(NET_SHORTAGE_QTY) AS total_shortage,
            COUNT(*) AS vpo_count
        FROM `{FULL_DATASET}.PR_Draft`
        WHERE MAIN_GROUP = 'Chì' AND NET_SHORTAGE_QTY > 0
        GROUP BY BOM_UPDATE
    ),
    bom_moq AS (
        SELECT 
            BOM_UPDATE,
            MAX(MOQ) AS max_moq  -- Take highest MOQ if multiple suppliers
        FROM `{FULL_DATASET}.Supplier_Capacity`
        GROUP BY BOM_UPDATE
    )
    SELECT 
        s.BOM_UPDATE,
        s.total_shortage,
        s.vpo_count,
        m.max_moq,
        CASE 
            WHEN m.max_moq IS NULL OR m.max_moq <= 1 THEN 'NO_MOQ'
            WHEN s.total_shortage < m.max_moq THEN 'BELOW_MOQ'
            ELSE 'ABOVE_MOQ'
        END AS moq_status,
        CASE 
            WHEN m.max_moq IS NOT NULL AND m.max_moq > 1 
            THEN ROUND(CEILING(s.total_shortage / m.max_moq) * m.max_moq, 0)
            ELSE ROUND(CEILING(s.total_shortage), 0)
        END AS order_qty
    FROM bom_shortage s
    LEFT JOIN bom_moq m ON s.BOM_UPDATE = m.BOM_UPDATE
    ORDER BY moq_status, total_shortage ASC
    LIMIT 30
""", "S3.2 — BOMs where shortage < MOQ/SPQ (ceiling has big impact)")
print_table(s3_2)


# ============================================================
# SECTION 4: WAREHOUSE ISSUANCE RELIABILITY (T3.1, T3.2, T3.3)
# ============================================================
print("\n" + "█"*70)
print("█ SECTION 4: WAREHOUSE ISSUANCE RELIABILITY")
print("█"*70)

# --- S4.1: BOM-level issuance totals vs demand ---
s4_1 = run_query(f"""
    WITH bom_issuance AS (
        SELECT 
            BOM_UPDATE,
            COUNT(DISTINCT VPO) AS issued_vpo_count,
            SUM(CUMULATIVE_ISSUANCE_QTY) AS total_issued
        FROM `{FULL_DATASET}.Material_Issuance`
        WHERE SOURCE_ID = 'CHI_LEAD'
        GROUP BY BOM_UPDATE
    ),
    bom_demand AS (
        SELECT 
            BOM_UPDATE,
            COUNT(DISTINCT VPO) AS demand_vpo_count,
            SUM(GROSS_DEMAND_QTY) AS total_demand,
            SUM(GROSS_DEMAND_COMPLETION_METHOD) AS total_demand_completion,
            SUM(GROSS_DEMAND_ISSUANCE_METHOD) AS total_demand_issuance
        FROM `{FULL_DATASET}.Material_Demand_VIEW`
        WHERE LOWER(TRIM(MAIN_GROUP)) = 'chì'
        GROUP BY BOM_UPDATE
    )
    SELECT 
        d.BOM_UPDATE,
        d.demand_vpo_count,
        COALESCE(i.issued_vpo_count, 0) AS issued_vpo_count,
        ROUND(d.total_demand, 2) AS total_demand,
        ROUND(COALESCE(i.total_issued, 0), 2) AS total_issued,
        ROUND(d.total_demand - COALESCE(i.total_issued, 0), 2) AS unissued_demand,
        CASE 
            WHEN i.total_issued IS NULL THEN 'NO_ISSUANCE'
            WHEN d.demand_vpo_count != i.issued_vpo_count THEN 'VPO_MISMATCH'
            ELSE 'OK'
        END AS status
    FROM bom_demand d
    LEFT JOIN bom_issuance i ON d.BOM_UPDATE = i.BOM_UPDATE
    ORDER BY 
        CASE WHEN i.total_issued IS NULL THEN 0 ELSE 1 END,
        ABS(d.total_demand - COALESCE(i.total_issued, 0)) DESC
    LIMIT 30
""", "S4.1 — BOM-level issuance totals vs demand")
print_table(s4_1)

# --- S4.2: Detect VPO attribution anomalies ---
# Look for BOMs where one VPO has MORE issuance than its demand
# (suggesting warehouse combined issuance from multiple VPOs into one)
s4_2 = run_query(f"""
    WITH vpo_detail AS (
        SELECT 
            D.BOM_UPDATE,
            D.VPO,
            ROUND(D.GROSS_DEMAND_QTY, 2) AS demand,
            ROUND(COALESCE(I.CUMULATIVE_ISSUANCE_QTY, 0), 2) AS issued,
            ROUND(COALESCE(I.CUMULATIVE_ISSUANCE_QTY, 0) - D.GROSS_DEMAND_QTY, 2) AS excess,
            D.HAS_ISSUANCE_DATA
        FROM `{FULL_DATASET}.Material_Demand_VIEW` D
        LEFT JOIN `{FULL_DATASET}.Material_Issuance` I
            ON D.BOM_UPDATE = I.BOM_UPDATE AND D.VPO = I.VPO
        WHERE LOWER(TRIM(D.MAIN_GROUP)) = 'chì'
          AND D.HAS_ISSUANCE_DATA = TRUE
    )
    SELECT 
        BOM_UPDATE,
        VPO,
        demand,
        issued,
        excess,
        CASE 
            WHEN excess > demand * 0.5 THEN '🔴 OVER-ISSUED (>50%)'
            WHEN excess > 0 THEN '🟡 SLIGHT EXCESS'
            WHEN issued = 0 AND demand > 0 THEN '⚪ ZERO ISSUED'
            ELSE '🟢 OK'
        END AS quality_flag
    FROM vpo_detail
    WHERE ABS(excess) > 1
    ORDER BY ABS(excess) DESC
    LIMIT 30
""", "S4.2 — VPO-level issuance anomalies (over-issued = attribution error?)")
print_table(s4_2)

# --- S4.3: BOM-level sanity check (aggregate vs VPO-sum) ---
s4_3 = run_query(f"""
    WITH vpo_level AS (
        SELECT 
            D.BOM_UPDATE,
            SUM(D.GROSS_DEMAND_QTY) AS vpo_sum_demand,
            SUM(COALESCE(I.CUMULATIVE_ISSUANCE_QTY, 0)) AS vpo_sum_issued,
            COUNT(*) AS vpo_count
        FROM `{FULL_DATASET}.Material_Demand_VIEW` D
        LEFT JOIN `{FULL_DATASET}.Material_Issuance` I
            ON D.BOM_UPDATE = I.BOM_UPDATE AND D.VPO = I.VPO
        WHERE LOWER(TRIM(D.MAIN_GROUP)) = 'chì'
        GROUP BY D.BOM_UPDATE
    ),
    bom_total AS (
        SELECT 
            BOM_UPDATE,
            SUM(CUMULATIVE_ISSUANCE_QTY) AS bom_total_issued
        FROM `{FULL_DATASET}.Material_Issuance`
        WHERE SOURCE_ID = 'CHI_LEAD'
        GROUP BY BOM_UPDATE
    )
    SELECT 
        v.BOM_UPDATE,
        v.vpo_count,
        ROUND(v.vpo_sum_demand, 2) AS vpo_sum_demand,
        ROUND(v.vpo_sum_issued, 2) AS vpo_sum_issued,
        ROUND(COALESCE(b.bom_total_issued, 0), 2) AS bom_total_issued,
        ROUND(v.vpo_sum_issued - COALESCE(b.bom_total_issued, 0), 2) AS join_diff,
        CASE 
            WHEN ABS(v.vpo_sum_issued - COALESCE(b.bom_total_issued, 0)) > 0.01 
            THEN '🔴 MISMATCH'
            ELSE '🟢 MATCH'
        END AS consistency_check
    FROM vpo_level v
    LEFT JOIN bom_total b ON v.BOM_UPDATE = b.BOM_UPDATE
    WHERE COALESCE(b.bom_total_issued, 0) > 0
    ORDER BY ABS(v.vpo_sum_issued - COALESCE(b.bom_total_issued, 0)) DESC
    LIMIT 20
""", "S4.3 — BOM-level total issuance consistency check")
print_table(s4_3)


# ============================================================
# SECTION 5: LEAD PLAN COMPARISON SIMULATION
# ============================================================
print("\n" + "█"*70)
print("█ SECTION 5: LEAD PLAN COMPARISON SIMULATION")
print("█"*70)

# --- S5.1: Simulate what the session would look like with 10% tolerance ---
s5_1 = run_query(f"""
    WITH demand_10pct AS (
        SELECT 
            D.BOM_UPDATE,
            D.VPO,
            D.NET_SHORTAGE_QTY AS system_shortage,
            -- Recalculate using 10% tolerance (ISSUANCE method)
            GREATEST(0,
              (P.FINISHED_GOODS_ORDER_QTY * L.BOM_CONSUMPTION * (1 + 0.10))
              - COALESCE(I.CUMULATIVE_ISSUANCE_QTY, 0)
            ) AS isc_shortage_issuance,
            -- Recalculate using 10% tolerance (COMPLETION method)
            (GREATEST(0, P.FINISHED_GOODS_ORDER_QTY - COALESCE(P.COMPLETION_QTY, 0))
              * L.BOM_CONSUMPTION) * (1 + 0.10) AS isc_shortage_completion,
            L.BOM_TOLERANCE AS cs_tol
        FROM `{FULL_DATASET}.Material_Demand_VIEW` D
        JOIN `{FULL_DATASET}.Production_Order` P ON D.PRODUCTION_ORDER_ID = P.PRODUCTION_ORDER_ID AND P.VALID_TO_TS IS NULL
        JOIN `{FULL_DATASET}.BOM_Order_List_Final` L ON P.PRODUCTION_ORDER_ID = L.PRODUCTION_ORDER_ID AND D.BOM_UPDATE = L.BOM_UPDATE AND L.VALID_TO_TS IS NULL
        LEFT JOIN `{FULL_DATASET}.Material_Issuance` I ON D.BOM_UPDATE = I.BOM_UPDATE AND D.VPO = I.VPO
        WHERE LOWER(TRIM(D.MAIN_GROUP)) = 'chì'
          AND D.PIC = 'Ngàn'
    )
    SELECT 
        COUNT(*) AS total_lines,
        ROUND(SUM(system_shortage), 2) AS system_total_shortage,
        ROUND(SUM(isc_shortage_issuance), 2) AS isc_issuance_shortage,
        ROUND(SUM(isc_shortage_completion), 2) AS isc_completion_shortage,
        ROUND(SUM(system_shortage) - SUM(isc_shortage_issuance), 2) AS delta_issuance,
        ROUND(SUM(system_shortage) - SUM(isc_shortage_completion), 2) AS delta_completion,
        ROUND(AVG(cs_tol), 4) AS avg_cs_tolerance
    FROM demand_10pct
""", "S5.1 — Simulated session shortage with 10% ISC tolerance vs CS tolerance")
print_table(s5_1)


# ============================================================
# SECTION 6: AGGREGATED SESSION PROTOTYPE
# ============================================================
print("\n" + "█"*70)
print("█ SECTION 6: AGGREGATED SESSION PROTOTYPE")
print("█"*70)

# --- S6.1: What the aggregated Ngàn_Assign_Sourcing would look like ---
s6_1 = run_query(f"""
    WITH pr_data AS (
        SELECT 
            BOM_UPDATE,
            VPO,
            NET_SHORTAGE_QTY,
            NET_SHORTAGE_COMPLETION,
            NET_SHORTAGE_ISSUANCE,
            REQUESTED_DELIVERY_DATE,
            DRAFT_PR_ID,
            FULFILLMENT_MODE,
            ORDER_LIST_NOTE
        FROM `{FULL_DATASET}.PR_Draft`
        WHERE MAIN_GROUP = 'Chì'
          AND NET_SHORTAGE_QTY > 0
    )
    SELECT 
        BOM_UPDATE,
        STRING_AGG(VPO, '|' ORDER BY VPO) AS vpos,
        COUNT(*) AS vpo_count,
        STRING_AGG(DRAFT_PR_ID, '|' ORDER BY VPO) AS draft_pr_ids,
        ROUND(SUM(NET_SHORTAGE_QTY), 2) AS total_shortage,
        ROUND(SUM(NET_SHORTAGE_COMPLETION), 2) AS total_nsc,
        ROUND(SUM(NET_SHORTAGE_ISSUANCE), 2) AS total_nsi,
        MIN(REQUESTED_DELIVERY_DATE) AS earliest_delivery,
        STRING_AGG(DISTINCT ORDER_LIST_NOTE, '|') AS notes,
        ANY_VALUE(FULFILLMENT_MODE) AS mode
    FROM pr_data
    GROUP BY BOM_UPDATE
    ORDER BY earliest_delivery ASC, total_shortage DESC
    LIMIT 30
""", "S6.1 — Aggregated session prototype (one row per BOM)")
print_table(s6_1, columns=['BOM_UPDATE', 'vpo_count', 'total_shortage', 'total_nsc', 'total_nsi', 'earliest_delivery', 'mode'])


# ============================================================
# SECTION 7: SUMMARY REPORT
# ============================================================
print("\n" + "█"*70)
print("█ SECTION 7: SUMMARY REPORT")
print("█"*70)

def summarize():
    """Print a summary of all findings."""
    print("""
╔══════════════════════════════════════════════════════════════════════╗
║                    EXPLORATION SUMMARY REPORT                       ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  INSTRUCTIONS FOR ANALYST:                                           ║
║  After running all sections above, review the output and fill in:    ║
║                                                                      ║
║  T1.1 BOM_TOLERANCE Distribution:                                    ║
║    → Check S1.1 results                                              ║
║    → Are tolerances clustered around 10%? Widely spread?             ║
║    → Report min/max/avg tolerance values                             ║
║                                                                      ║
║  T1.2 10% Tolerance Impact:                                         ║
║    → Check S1.3 total_delta column                                   ║
║    → Positive delta = CS demands MORE than ISC 10%                  ║
║    → Negative delta = CS demands LESS than ISC 10%                  ║
║                                                                      ║
║  T2.1 Multi-VPO BOMs:                                               ║
║    → Check S2.1 results                                              ║
║    → How many BOMs have 2+ VPOs? What's the max?                    ║
║                                                                      ║
║  T2.2 MOQ/SPQ Waste:                                                ║
║    → Check S2.2 total savings                                        ║
║    → Report total_savings_qty and savings_pct from S2.3              ║
║                                                                      ║
║  T3.1-T3.3 Issuance Reliability:                                    ║
║    → Check S4.1, S4.2, S4.3 results                                 ║
║    → Count anomalies, mismatch flags                                ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
    """)

summarize()
print("\n✅ EXPLORATION COMPLETE")
print(f"   Total queries executed: 11")
print(f"   Project: {PROJECT_ID}")
print(f"   Dataset: {DATASET_ID}")
```

---

## 2. Individual Section Breakdown

The script above runs all sections sequentially. Here is a breakdown of what each section verifies:

### Section 1: BOM_TOLERANCE Distribution (T1.1, T1.2, T1.3)
- **S1.1**: Groups all `BOM_Order_List_Final` entries for Chì by `BOM_TOLERANCE` value → reveals how many discrete tolerance values exist
- **S1.2**: Identifies BOMs where tolerance VARIES across different POs (same BOM, different tolerance depending on which customer order)
- **S1.3**: Simulates total demand under CS tolerance vs ISC 10% tolerance → quantifies the aggregate delta
- **S1.4**: Top 30 individual BOMs with the largest demand delta between CS and ISC tolerance

### Section 2: VPO Aggregation Impact (T2.1, T2.2)
- **S2.1**: Counts multi-VPO BOMs in current PR_Draft → lists which BOMs would benefit from aggregation
- **S2.2**: Calculates per-VPO CEILING sum vs aggregated CEILING for each multi-VPO BOM → shows the waste
- **S2.3**: Grand total savings across all Chì BOMs if aggregated ordering was used

### Section 3: MOQ/SPQ Analysis (T2.3)
- **S3.1**: Distribution of MOQ values in `Supplier_Capacity` for Chì → confirms whether these are true MOQs or SPQs
- **S3.2**: BOMs where total shortage is below MOQ → maximum ceiling impact

### Section 4: Warehouse Issuance Reliability (T3.1-T3.3)
- **S4.1**: BOM-level issuance totals vs demand → how much is covered at the BOM level
- **S4.2**: VPO-level issuance anomalies → finds over-issued VPOs (attribution errors)
- **S4.3**: BOM-level consistency check → validates that VPO-sum issuance equals BOM-total issuance

### Section 5: Lead Plan Comparison Simulation
- **S5.1**: Recalculates the entire Ngàn session shortage using 10% tolerance → simulates "what would the session look like if we used Lead Plan tolerance"

### Section 6: Aggregated Session Prototype
- **S6.1**: Generates what the aggregated session would look like (one row per BOM, pipe-delimited VPOs)

### Section 7: Summary Report
- Prints a template for the analyst to fill in after reviewing outputs

---

## 3. Expected Outputs & Interpretation Guide

### What "Good Results" Look Like

| Query | Expected Good Result | Red Flag |
|---|---|---|
| S1.1 | Multiple distinct BOM_TOLERANCE values (not all 0.10) | All values are 0.10 (theory T1.1 would be wrong) |
| S1.3 | `total_delta` is non-zero and explains observed discrepancy | Delta is negligible (tolerance is not the cause) |
| S2.2 | `waste_qty` > 0 for many BOMs, especially those with SPQ > 100 | All waste_qty = 0 (aggregation doesn't help) |
| S2.3 | `total_savings_qty` > 100 and `savings_pct` > 5% | Savings are negligible |
| S4.2 | Some VPOs show excess > 50% of demand (attribution error) | All excess = 0 (warehouse is accurate) |

---

## 4. Running Instructions for Gemini 3.1 Pro

When running this script in a new session:

1. Copy the entire Section 1 script above
2. Ensure BigQuery credentials are available (gcloud auth or service account)
3. Run section by section, saving output to a text file
4. If any query fails due to schema changes, adjust the column names based on the latest `Config_Schema.txt`
5. After all sections complete, copy the summary output and paste into a new conversation for analysis

### Alternative: Run as Individual SQL Queries

If Python is not available, each query inside `run_query()` can be extracted and run directly in the [BigQuery Console](https://console.cloud.google.com/bigquery?project=boxwood-charmer-473204-k8). Part 3 provides these as standalone SQL queries.

---

*Part 2 Complete — Python Exploration Methods*
*To be executed in Gemini 3.1 Pro session after approval*
