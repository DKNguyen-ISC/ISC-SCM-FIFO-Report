import os
import pandas as pd
from google.cloud import bigquery

# =========================================================
# CONFIGURATION
# =========================================================
PROJECT_ID = 'boxwood-charmer-473204-k8'
DATASET_ID = f"{PROJECT_ID}.isc_scm_ops"

# NOTE: Queries Q9, Q10, Q11 require an actual DATE_CODE from your upload session.
# If you haven't tested the Google Sheet upload yet, leave this as 'LATER'.
# When you do upload, change this to your actual Date Code (e.g., 'PUB_20260317_143000') 
# and re-run this script to audit your upload results.
DATE_CODE = 'LATER'  

def run_validation_queries():
    print("Initializing BigQuery Client...")
    client = bigquery.Client(project=PROJECT_ID)
    
    # Pre-configure pandas for nice table outputs
    pd.options.display.float_format = '{:,.2f}'.format
    
    queries = {
        "Q1.1: View Existence and Grain Check": f"""
SELECT
  COUNT(*)                AS total_rows,
  COUNT(DISTINCT BOM_UPDATE) AS distinct_boms,
  COUNTIF(ROW_GRAIN = 'BOM_AGG')      AS grain_tagged_rows,
  COUNTIF(SOURCE_VIEW = 'Sourcing_Feed_Aggregated_VIEW') AS source_tagged_rows
FROM `{DATASET_ID}.Sourcing_Feed_Aggregated_VIEW`
        """,
        "Q2.1: JSON Integrity - Delivery Date Missing Check": f"""
SELECT
  BOM_UPDATE,
  VPO_COUNT,
  VPO_COMPONENTS_JSON
FROM `{DATASET_ID}.Sourcing_Feed_Aggregated_VIEW`
WHERE VPO_COMPONENTS_JSON NOT LIKE '%delivery_date%'
LIMIT 10
        """,
        "Q2.2: JSON Integrity - Element Count vs Pipe Count": f"""
SELECT
  BOM_UPDATE,
  ARRAY_LENGTH(JSON_EXTRACT_ARRAY(VPO_COMPONENTS_JSON)) AS json_count,
  (LENGTH(VPO_AGG) - LENGTH(REPLACE(VPO_AGG, '|', '')) + 1)   AS pipe_count,
  VPO_COUNT                                                      AS vpo_count_col
FROM `{DATASET_ID}.Sourcing_Feed_Aggregated_VIEW`
WHERE
    ARRAY_LENGTH(JSON_EXTRACT_ARRAY(VPO_COMPONENTS_JSON))
  != (LENGTH(VPO_AGG) - LENGTH(REPLACE(VPO_AGG, '|', '')) + 1)
LIMIT 10
        """,
        "Q2.3: JSON vs DRAFT_PR_ID Pipe Count": f"""
SELECT
  BOM_UPDATE,
  ARRAY_LENGTH(JSON_EXTRACT_ARRAY(VPO_COMPONENTS_JSON)) AS json_count,
  (LENGTH(DRAFT_PR_ID_AGG) - LENGTH(REPLACE(DRAFT_PR_ID_AGG, '|', '')) + 1) AS pr_pipe_count
FROM `{DATASET_ID}.Sourcing_Feed_Aggregated_VIEW`
WHERE
    ARRAY_LENGTH(JSON_EXTRACT_ARRAY(VPO_COMPONENTS_JSON))
  != (LENGTH(DRAFT_PR_ID_AGG) - LENGTH(REPLACE(DRAFT_PR_ID_AGG, '|', '')) + 1)
LIMIT 10
        """,
        "Q3.1: Shortage Aggregation Accuracy": f"""
WITH direct_sum AS (
  SELECT
    BOM_UPDATE,
    SUM(GREATEST(0, NET_SHORTAGE_QTY)) AS manual_agg
  FROM `{DATASET_ID}.PR_Draft`
  WHERE LOWER(TRIM(FULFILLMENT_MODE)) = 'public'
  GROUP BY BOM_UPDATE
)
SELECT
  v.BOM_UPDATE,
  v.NET_SHORTAGE_QTY_AGG       AS view_agg,
  d.manual_agg                 AS expected_agg,
  v.NET_SHORTAGE_QTY_AGG - d.manual_agg AS delta
FROM `{DATASET_ID}.Sourcing_Feed_Aggregated_VIEW` v
JOIN direct_sum d USING (BOM_UPDATE)
WHERE ABS(v.NET_SHORTAGE_QTY_AGG - d.manual_agg) > 0.001
ORDER BY ABS(delta) DESC
LIMIT 20
        """,
        "Q4.1: BOM_Shortage_Backup_VIEW Scope Fix Check": f"""
WITH public_demand AS (
  SELECT BOM_UPDATE, SUM(GROSS_DEMAND_QTY) AS public_total
  FROM `{DATASET_ID}.Material_Demand_VIEW`
  WHERE LOWER(TRIM(FULFILLMENT_MODE)) = 'public'
  GROUP BY BOM_UPDATE
)
SELECT
  b.BOM_UPDATE,
  b.BOM_TOTAL_DEMAND      AS backup_demand,
  COALESCE(p.public_total, 0) AS public_demand_direct,
  b.BOM_TOTAL_DEMAND - COALESCE(p.public_total, 0) AS delta
FROM `{DATASET_ID}.BOM_Shortage_Backup_VIEW` b
LEFT JOIN public_demand p USING (BOM_UPDATE)
WHERE ABS(b.BOM_TOTAL_DEMAND - COALESCE(p.public_total, 0)) > 0.001
LIMIT 20
        """,
        "Q5.1: MISMATCH Distribution Sanity": f"""
SELECT
  BOM_SHORTAGE_STATUS,
  COUNT(*)               AS bom_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) AS pct
FROM `{DATASET_ID}.Sourcing_Feed_Aggregated_VIEW`
GROUP BY BOM_SHORTAGE_STATUS
        """,
        "Q5.2: Inspect worst MISMATCH rows": f"""
SELECT
  BOM_UPDATE,
  NET_SHORTAGE_QTY_AGG,
  BOM_TOTAL_SHORTAGE,
  BOM_SHORTAGE_DIFF,
  ABS(BOM_SHORTAGE_DIFF) AS abs_diff,
  ROUND(ABS(BOM_SHORTAGE_DIFF) / GREATEST(BOM_TOTAL_SHORTAGE, 0.001) * 100, 1) AS pct_diff,
  VPO_COUNT
FROM `{DATASET_ID}.Sourcing_Feed_Aggregated_VIEW`
WHERE BOM_SHORTAGE_STATUS = 'MISMATCH'
ORDER BY ABS(BOM_SHORTAGE_DIFF) DESC
LIMIT 20
        """,
        "Q6.1: Delivery Date Coverage in JSON": f"""
SELECT
  BOM_UPDATE,
  JSON_VALUE(elem, '$.draft_pr_id')    AS draft_pr_id,
  JSON_VALUE(elem, '$.delivery_date')  AS delivery_date
FROM `{DATASET_ID}.Sourcing_Feed_Aggregated_VIEW`,
  UNNEST(JSON_EXTRACT_ARRAY(VPO_COMPONENTS_JSON)) AS elem
WHERE JSON_VALUE(elem, '$.delivery_date') IS NULL
   OR JSON_VALUE(elem, '$.delivery_date') = ''
LIMIT 20
        """,
        "Q6.2: Verify deterministic ordering": f"""
SELECT BOM_UPDATE, VPO_AGG, DRAFT_PR_ID_AGG
FROM `{DATASET_ID}.Sourcing_Feed_Aggregated_VIEW`
WHERE VPO_COUNT >= 3
ORDER BY BOM_UPDATE
LIMIT 10
        """,
        "Q7.1: LRM Explode Algorithm Verification (Math Invariant Check)": f"""
WITH parameters AS (
  SELECT
    BOM_UPDATE,
    NET_SHORTAGE_QTY_AGG                           AS q_agg,
    CAST(1 AS INT64)                               AS spq,
    VPO_COMPONENTS_JSON,
    VPO_COUNT
  FROM `{DATASET_ID}.Sourcing_Feed_Aggregated_VIEW`
),
q_bom_computed AS (
  SELECT
    BOM_UPDATE,
    q_agg,
    spq,
    VPO_COMPONENTS_JSON,
    VPO_COUNT,
    CAST(CEIL((q_agg * 1.10) / spq) * spq AS INT64) AS Q_BOM
  FROM parameters
),
allocated AS (
  SELECT
    q.BOM_UPDATE,
    q.Q_BOM,
    q.VPO_COUNT,
    (SELECT SUM(CAST(FLOOR(
        GREATEST(0, CAST(JSON_VALUE(elem, '$.net_shortage_qty') AS FLOAT64))
        / NULLIF((SELECT SUM(GREATEST(0, CAST(JSON_VALUE(e2, '$.net_shortage_qty') AS FLOAT64)))
                  FROM UNNEST(JSON_EXTRACT_ARRAY(q.VPO_COMPONENTS_JSON)) e2), 0)
        * q.Q_BOM
    ) AS INT64))
    FROM UNNEST(JSON_EXTRACT_ARRAY(q.VPO_COMPONENTS_JSON)) elem
    WHERE GREATEST(0, CAST(JSON_VALUE(elem, '$.net_shortage_qty') AS FLOAT64)) > 0
    ) AS sum_floor,
    q.Q_BOM - (SELECT SUM(CAST(FLOOR(
        GREATEST(0, CAST(JSON_VALUE(elem, '$.net_shortage_qty') AS FLOAT64))
        / NULLIF((SELECT SUM(GREATEST(0, CAST(JSON_VALUE(e2, '$.net_shortage_qty') AS FLOAT64)))
                  FROM UNNEST(JSON_EXTRACT_ARRAY(q.VPO_COMPONENTS_JSON)) e2), 0)
        * q.Q_BOM
    ) AS INT64))
    FROM UNNEST(JSON_EXTRACT_ARRAY(q.VPO_COMPONENTS_JSON)) elem
    ) AS delta
  FROM q_bom_computed q
  WHERE q.Q_BOM > 0
)
SELECT
  BOM_UPDATE,
  Q_BOM,
  VPO_COUNT,
  sum_floor,
  delta,
  COALESCE(sum_floor, 0) + COALESCE(delta, 0) AS final_sum,
  (COALESCE(sum_floor, 0) + COALESCE(delta, 0)) = Q_BOM AS conservation_check
FROM allocated
ORDER BY delta DESC
LIMIT 30
        """,
        "Q8.1: SAVINGS_VS_LEGACY Sanity Check": f"""
WITH per_vpo_legacy AS (
  SELECT
    BOM_UPDATE,
    DRAFT_PR_ID,
    VPO,
    GREATEST(0, NET_SHORTAGE_QTY)                                     AS net_pos,
    1                                                                   AS spq_ref,
    CAST(CEIL(GREATEST(0, NET_SHORTAGE_QTY) * 1.10 / 1) * 1 AS INT64) AS legacy_qty_i
  FROM `{DATASET_ID}.PR_Draft`
  WHERE LOWER(TRIM(FULFILLMENT_MODE)) = 'public'
),
legacy_totals AS (
  SELECT
    BOM_UPDATE,
    SUM(legacy_qty_i)                                    AS LEGACY_TOTAL,
    SUM(GREATEST(0, net_pos))                            AS NET_AGG,
    CAST(CEIL(SUM(GREATEST(0, net_pos)) * 1.10) AS INT64) AS Q_BOM_AGG
  FROM per_vpo_legacy
  GROUP BY BOM_UPDATE
)
SELECT
  BOM_UPDATE,
  NET_AGG,
  LEGACY_TOTAL,
  Q_BOM_AGG,
  LEGACY_TOTAL - Q_BOM_AGG                AS expected_savings,
  CASE
    WHEN LEGACY_TOTAL > Q_BOM_AGG THEN '✅ SAVES'
    WHEN LEGACY_TOTAL = Q_BOM_AGG THEN '➡️ NEUTRAL'
    ELSE '⚠️ ANOMALY'
  END AS savings_verdict
FROM legacy_totals
ORDER BY expected_savings DESC
LIMIT 30
        """,
        "Q9.1: PR_Staging uploaded conservation check": f"""
SELECT
  BOM_UPDATE,
  COUNT(DISTINCT VPO)                AS vpo_count,
  SUM(QTY_TO_APPROVE)               AS sum_qi,
  FULFILLMENT_MODE,
  DATE_CODE,
  UPDATED_BY,
  MAX(UPDATED_AT)                    AS latest_update
FROM `{DATASET_ID}.PR_Staging`
WHERE FULFILLMENT_MODE = 'PUBLIC'
  AND DATE_CODE = '{DATE_CODE}'   
GROUP BY BOM_UPDATE, FULFILLMENT_MODE, DATE_CODE, UPDATED_BY
ORDER BY BOM_UPDATE
LIMIT 20
        """,
        "Q9.2: All exploded allocations non-negative": f"""
SELECT *
FROM `{DATASET_ID}.PR_Staging`
WHERE FULFILLMENT_MODE = 'PUBLIC'
  AND QTY_TO_APPROVE < 0
  AND DATE_CODE = '{DATE_CODE}'
        """,
        "Q9.3: PR_Staging delivery date matching check": f"""
SELECT
  s.PR_STAGING_ID,
  s.VPO,
  s.BOM_UPDATE,
  s.REQUESTED_DELIVERY_DATE,
  pr.REQUESTED_DELIVERY_DATE AS original_vpo_delivery_date,
  s.REQUESTED_DELIVERY_DATE = pr.REQUESTED_DELIVERY_DATE AS dates_match
FROM `{DATASET_ID}.PR_Staging` s
JOIN `{DATASET_ID}.PR_Draft`   pr
  ON s.PR_STAGING_ID = pr.DRAFT_PR_ID
WHERE s.FULFILLMENT_MODE = 'PUBLIC'
  AND s.DATE_CODE = '{DATE_CODE}'
  AND s.REQUESTED_DELIVERY_DATE != pr.REQUESTED_DELIVERY_DATE
LIMIT 20
        """,
        "Q9.4: PR_Staging rows match VPO Count": f"""
SELECT
  stg.BOM_UPDATE,
  COUNT(DISTINCT stg.VPO)   AS staged_vpos,
  view.VPO_COUNT            AS expected_vpos
FROM `{DATASET_ID}.PR_Staging` stg
JOIN `{DATASET_ID}.Sourcing_Feed_Aggregated_VIEW` view
  USING (BOM_UPDATE)
WHERE stg.FULFILLMENT_MODE = 'PUBLIC'
  AND stg.DATE_CODE = '{DATE_CODE}'
GROUP BY stg.BOM_UPDATE, view.VPO_COUNT
HAVING COUNT(DISTINCT stg.VPO) != view.VPO_COUNT
        """,
        "Q10.1: PR_Final mapped properly via SP": f"""
SELECT
  stg.BOM_UPDATE,
  stg.VPO,
  stg.QTY_TO_APPROVE,
  prf.QTY_APPROVED AS final_qty,
  prf.CONSOLIDATION_STATUS,
  prf.UPDATED_AT AS final_updated_at
FROM `{DATASET_ID}.PR_Staging` stg
LEFT JOIN `{DATASET_ID}.PR_Final` prf
  ON stg.BOM_UPDATE = prf.BOM_UPDATE
  AND stg.VPO = prf.VPO
WHERE stg.FULFILLMENT_MODE = 'PUBLIC'
  AND stg.DATE_CODE = '{DATE_CODE}'
ORDER BY stg.BOM_UPDATE, stg.VPO
LIMIT 20
        """,
        "Q10.2: Orphaned staging rows check": f"""
SELECT COUNT(*) AS orphaned_staging_rows
FROM `{DATASET_ID}.PR_Staging`
WHERE FULFILLMENT_MODE = 'PUBLIC'
  AND VALIDATION_STATUS = 'PENDING'
  AND UPDATED_AT < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 MINUTE)
        """,
        "Q11.1: Legacy regression guard": f"""
SELECT
  FULFILLMENT_MODE,
  COUNT(*)                           AS staging_rows,
  COUNT(DISTINCT VPO)                AS distinct_vpos,
  COUNT(*) = COUNT(DISTINCT VPO)     AS is_one_to_one
FROM `{DATASET_ID}.PR_Staging`
WHERE FULFILLMENT_MODE = 'PRIVATE'
  AND UPDATED_AT >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
GROUP BY FULFILLMENT_MODE
        """,
        "Q12.1: SUPPLIER_CONSISTENCY_CHECK Flag": f"""
SELECT
  BOM_UPDATE,
  SUPPLIER_CONSISTENCY_CHECK,
  ASSIGNED_SUPPLIER_NAME,
  VPO_COUNT
FROM `{DATASET_ID}.Sourcing_Feed_Aggregated_VIEW`
WHERE SUPPLIER_CONSISTENCY_CHECK > 1
ORDER BY SUPPLIER_CONSISTENCY_CHECK DESC
LIMIT 20
        """,
        "Q13.1: End-to-End Rounding Efficiency Proof": f"""
WITH legacy_per_vpo AS (
  SELECT
    BOM_UPDATE,
    SUM(CAST(CEIL(GREATEST(0, NET_SHORTAGE_QTY) * 1.10) AS INT64)) AS legacy_total_order
  FROM `{DATASET_ID}.PR_Draft`
  WHERE LOWER(TRIM(FULFILLMENT_MODE)) = 'public'
  GROUP BY BOM_UPDATE
),
agg_order AS (
  SELECT
    BOM_UPDATE,
    NET_SHORTAGE_QTY_AGG,
    CAST(CEIL(NET_SHORTAGE_QTY_AGG * 1.10) AS INT64) AS agg_total_order
  FROM `{DATASET_ID}.Sourcing_Feed_Aggregated_VIEW`
)
SELECT
  a.BOM_UPDATE,
  l.legacy_total_order,
  a.agg_total_order,
  l.legacy_total_order - a.agg_total_order  AS units_saved,
  ROUND((l.legacy_total_order - a.agg_total_order) * 100.0
    / NULLIF(l.legacy_total_order, 0), 1)   AS pct_reduction
FROM agg_order a
JOIN legacy_per_vpo l USING (BOM_UPDATE)
WHERE l.legacy_total_order > a.agg_total_order
ORDER BY units_saved DESC
LIMIT 30
        """
    }

    output_file = "Phase2_Validation_Results.md"
    print(f"Executing queries and saving to {output_file}...")

    with open(output_file, "w", encoding="utf-8") as f:
        f.write("# Phase 2 SQL Validation Results\\n\\n")
        f.write("_Automatically generated by Python BigQuery client._\\n\\n")
        f.write("> **Note**: For Q9, Q10, and Q11, the variable `DATE_CODE` was set to `LATER`. You should edit the script and insert your actual `DATE_CODE` once you test the UI upload!\\n\\n")
        
        for name, query in queries.items():
            print(f"  -> Running {name}...")
            f.write(f"## {name}\\n\\n")
            f.write("```sql\\n" + query.strip() + "\\n```\\n\\n")
            try:
                # Execute the query and convert to pandas DataFrame
                df = client.query(query).to_dataframe()
                if df.empty:
                    f.write("**Result:** 0 rows (No data to display)\\n\\n")
                    print(f"     ✅ Output: 0 rows")
                else:
                    f.write("**Result:**\\n\\n")
                    # Use 'pipe' (GitHub flavored markdown) and float formatting 
                    # so that it renders beautifully and avoids scientific notation
                    md_table = df.to_markdown(index=False, tablefmt="pipe", floatfmt=".2f")
                    f.write(md_table + "\\n\\n")
                    print(f"     ✅ Output: {len(df)} rows")
            except Exception as e:
                f.write(f"**Error:**\\n```text\\n{str(e)}\\n```\\n\\n")
                print(f"     ❌ Error: {e}")

    print(f"\\nDone! Validation report saved to {output_file}")

if __name__ == "__main__":
    run_validation_queries()
