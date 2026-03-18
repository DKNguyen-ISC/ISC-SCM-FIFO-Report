"""
Production Order Duplicate Analysis
====================================
Purpose: Investigate why Material_Demand_SNAPSHOT has duplicate rows,
         particularly for PRODUCTION_ORDER_ID = 7576.

Key hypothesis:
  Material_Demand_SNAPSHOT is populated by SELECT * FROM Material_Demand_VIEW,
  which joins Production_Order → BOM_Order_List_Final → BOM_Data + Material_Issuance.

  If DEMAND_ID = 'DEM_29da3c32b920cf6e511d5be04c6a0c16' appears TWICE for PO 7576,
  the fan-out must come from one of:
    A) BOM_Order_List_Final has 2 active rows for same (PRODUCTION_ORDER_ID, BOM_UPDATE)
    B) Production_Order has 2 active rows with PRODUCTION_ORDER_ID = 7576 (SCD2 ghost)
    C) BOM_Data has 2 active rows for same BOM_UPDATE (302067330)

Run:
  python analyze_production_order.py

Prerequisites:
  pip install google-cloud-bigquery pandas tabulate
  gcloud auth application-default login

Results are printed to console and saved to analysis_results.txt
"""

import sys
from datetime import datetime
from google.cloud import bigquery
from google.api_core.exceptions import GoogleAPICallError

# ─── Configuration ─────────────────────────────────────────────────────────────
PROJECT_ID = "boxwood-charmer-473204-k8"
DATASET_ID = "isc_scm_ops"
FQ = f"`{PROJECT_ID}.{DATASET_ID}`"

# Focus: the PO_ID that has known duplicates
FOCUS_PO_ID = 7576
FOCUS_DEMAND_ID = "DEM_29da3c32b920cf6e511d5be04c6a0c16"
FOCUS_VPO = "V2602003C01"
FOCUS_BOMS = ["302067330", "302067501", "302067374", "302067396"]

OUTPUT_FILE = "analysis_results.txt"

# ─── Helpers ───────────────────────────────────────────────────────────────────
client = bigquery.Client(project=PROJECT_ID)
lines_out = []

def section(title):
    sep = "=" * 72
    msg = f"\n{sep}\n  {title}\n{sep}"
    print(msg)
    lines_out.append(msg)

def subsection(title):
    sep = "-" * 60
    msg = f"\n{sep}\n  {title}\n{sep}"
    print(msg)
    lines_out.append(msg)

def run_query(label, sql, expected_rows=None):
    """Run a BQ query, print results, return rows as list of dicts."""
    subsection(label)
    print(f"SQL:\n{sql}\n")
    lines_out.append(f"SQL:\n{sql}\n")
    try:
        rows = list(client.query(sql).result())
        count = len(rows)
        msg = f"→ {count} rows returned" + (f" (expected: {expected_rows})" if expected_rows is not None else "")
        print(msg)
        lines_out.append(msg)
        if rows:
            # Print column headers
            headers = list(rows[0].keys())
            header_line = " | ".join(f"{h:30s}" if i == 0 else f"{h:20s}" for i, h in enumerate(headers))
            divider = "-" * len(header_line)
            print(header_line)
            print(divider)
            lines_out.append(header_line)
            lines_out.append(divider)
            for row in rows:
                vals = list(row.values())
                row_line = " | ".join(f"{str(v)[:30]:30s}" if i == 0 else f"{str(v)[:20]:20s}" for i, v in enumerate(vals))
                print(row_line)
                lines_out.append(row_line)
        else:
            empty_msg = "→ [No data to display]"
            print(empty_msg)
            lines_out.append(empty_msg)
        return rows
    except GoogleAPICallError as e:
        err = f"ERROR: {e.message}"
        print(err)
        lines_out.append(err)
        return []

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 1: SNAPSHOT AUDIT — confirm the raw duplicates
# ══════════════════════════════════════════════════════════════════════════════
section("SECTION 1 — Material_Demand_SNAPSHOT Audit (Focus: PO 7576)")

run_query(
    "Q1.1 — All SNAPSHOT rows for PRODUCTION_ORDER_ID = 7576",
    f"""
    SELECT
      DEMAND_ID, PRODUCTION_ORDER_ID, BOM_UPDATE,
      FULFILLMENT_MODE, VPO,
      ROUND(GROSS_DEMAND_QTY, 6) AS GROSS_DEMAND_QTY,
      HAS_ISSUANCE_DATA, CALC_METHOD_USED
    FROM {FQ}.Material_Demand_SNAPSHOT
    WHERE PRODUCTION_ORDER_ID = {FOCUS_PO_ID}
    ORDER BY DEMAND_ID, BOM_UPDATE
    """
)

run_query(
    "Q1.2 — Count duplicates: how many DEMAND_IDs appear more than once in SNAPSHOT",
    f"""
    SELECT DEMAND_ID, COUNT(*) AS occurrences, ANY_VALUE(BOM_UPDATE) AS BOM_UPDATE
    FROM {FQ}.Material_Demand_SNAPSHOT
    WHERE PRODUCTION_ORDER_ID = {FOCUS_PO_ID}
    GROUP BY DEMAND_ID
    HAVING COUNT(*) > 1
    """
)

run_query(
    "Q1.3 — Full duplicate check across entire SNAPSHOT (all POs)",
    f"""
    SELECT
      COUNT(*) AS total_snapshot_rows,
      COUNT(DISTINCT DEMAND_ID) AS distinct_demand_ids,
      COUNT(*) - COUNT(DISTINCT DEMAND_ID) AS duplicate_rows
    FROM {FQ}.Material_Demand_SNAPSHOT
    """
)

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 2: Production_Order TABLE AUDIT
# Hypothesis B: Is there more than 1 active row for PRODUCTION_ORDER_ID = 7576?
# ══════════════════════════════════════════════════════════════════════════════
section("SECTION 2 — Production_Order Table Audit (Hypothesis B: SCD2 Ghost)")

run_query(
    "Q2.1 — ALL rows in Production_Order where PRODUCTION_ORDER_ID = 7576 (ignore VALID_TO_TS)",
    f"""
    SELECT
      PRODUCTION_ORDER_ID, VPO, SKU_CODE, DATA_STATE,
      VALID_FROM_TS, VALID_TO_TS,
      UPDATED_AT, UPDATED_BY
    FROM {FQ}.Production_Order
    WHERE PRODUCTION_ORDER_ID = {FOCUS_PO_ID}
    ORDER BY VALID_FROM_TS
    """
)

run_query(
    "Q2.2 — Active rows only (VALID_TO_TS IS NULL) for PO 7576",
    f"""
    SELECT
      PRODUCTION_ORDER_ID, VPO, SKU_CODE, DATA_STATE,
      VALID_FROM_TS, VALID_TO_TS, UPDATED_AT
    FROM {FQ}.Production_Order
    WHERE PRODUCTION_ORDER_ID = {FOCUS_PO_ID}
      AND VALID_TO_TS IS NULL
    """
)

run_query(
    "Q2.3 — How many active rows exist per PRODUCTION_ORDER_ID in Production_Order (find multi-row POs)",
    f"""
    SELECT PRODUCTION_ORDER_ID, VPO, COUNT(*) AS active_rows
    FROM {FQ}.Production_Order
    WHERE VALID_TO_TS IS NULL
    GROUP BY PRODUCTION_ORDER_ID, VPO
    HAVING COUNT(*) > 1
    ORDER BY active_rows DESC
    LIMIT 20
    """
)

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 3: BOM_Order_List_Final AUDIT
# Hypothesis A: Does BOM_Order_List_Final have 2 active rows for the same (PO, BOM)?
# ══════════════════════════════════════════════════════════════════════════════
section("SECTION 3 — BOM_Order_List_Final Audit (Hypothesis A: List Duplication)")

run_query(
    "Q3.1 — All ACTIVE BOM_Order_List_Final rows for PRODUCTION_ORDER_ID = 7576",
    f"""
    SELECT
      BOM_ORDER_LIST_FINAL_ID, PRODUCTION_ORDER_ID, BOM_UPDATE,
      FULFILLMENT_MODE, ORDER_LIST_NOTE, BOM_CONSUMPTION, BOM_TOLERANCE,
      VALID_FROM_TS, VALID_TO_TS, UPDATED_AT
    FROM {FQ}.BOM_Order_List_Final
    WHERE PRODUCTION_ORDER_ID = {FOCUS_PO_ID}
      AND VALID_TO_TS IS NULL
    ORDER BY BOM_UPDATE
    """
)

run_query(
    "Q3.2 — Check if DEMAND_ID 'DEM_29da3c32b920cf6e511d5be04c6a0c16' is in BOM_Order_List_Final",
    f"""
    SELECT
      BOM_ORDER_LIST_FINAL_ID, PRODUCTION_ORDER_ID, BOM_UPDATE,
      VALID_FROM_TS, VALID_TO_TS
    FROM {FQ}.BOM_Order_List_Final
    WHERE BOM_ORDER_LIST_FINAL_ID = '{FOCUS_DEMAND_ID}'
    """
)

run_query(
    "Q3.3 — Broader: any (PRODUCTION_ORDER_ID, BOM_UPDATE) with 2+ active rows in BOM_Order_List_Final",
    f"""
    SELECT PRODUCTION_ORDER_ID, BOM_UPDATE, COUNT(*) AS active_entries
    FROM {FQ}.BOM_Order_List_Final
    WHERE VALID_TO_TS IS NULL
    GROUP BY PRODUCTION_ORDER_ID, BOM_UPDATE
    HAVING COUNT(*) > 1
    ORDER BY active_entries DESC
    LIMIT 30
    """
)

run_query(
    "Q3.4 — ALL rows (including expired) for PRODUCTION_ORDER_ID=7576 BOM=302067330",
    f"""
    SELECT
      BOM_ORDER_LIST_FINAL_ID, PRODUCTION_ORDER_ID, BOM_UPDATE,
      VALID_FROM_TS, VALID_TO_TS, UPDATED_AT, UPDATED_BY
    FROM {FQ}.BOM_Order_List_Final
    WHERE PRODUCTION_ORDER_ID = {FOCUS_PO_ID}
      AND BOM_UPDATE = '302067330'
    ORDER BY VALID_FROM_TS
    """
)

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 4: BOM_Data AUDIT
# Hypothesis C: Does BOM_Data have 2 active rows for BOM 302067330?
# ══════════════════════════════════════════════════════════════════════════════
section("SECTION 4 — BOM_Data Audit (Hypothesis C: BOM Master Duplication)")

run_query(
    "Q4.1 — BOM_Data entries for the 4 focus BOMs",
    f"""
    SELECT BOM_UPDATE, BOM, BOM_STATUS, MAIN_GROUP, SUB_GROUP, PIC, UPDATED_AT
    FROM {FQ}.BOM_Data
    WHERE BOM_UPDATE IN ({', '.join([f"'{b}'" for b in FOCUS_BOMS])})
    ORDER BY BOM_UPDATE
    """
)

run_query(
    "Q4.2 — Any BOM_UPDATE with 2+ rows in BOM_Data (should be 0 — SCD1 table)",
    f"""
    SELECT BOM_UPDATE, COUNT(*) AS row_count
    FROM {FQ}.BOM_Data
    GROUP BY BOM_UPDATE
    HAVING COUNT(*) > 1
    ORDER BY row_count DESC
    LIMIT 10
    """
)

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 5: MATERIAL_DEMAND_VIEW LIVE CHECK
# Cross-check: does the VIEW itself return duplicates right now?
# ══════════════════════════════════════════════════════════════════════════════
section("SECTION 5 — Material_Demand_VIEW Live Check (Are duplicates still present in VIEW?)")

run_query(
    "Q5.1 — Current VIEW rows for PO 7576 (live, no snapshot)",
    f"""
    SELECT
      DEMAND_ID, PRODUCTION_ORDER_ID, BOM_UPDATE,
      VPO, FULFILLMENT_MODE,
      ROUND(GROSS_DEMAND_QTY, 6) AS GROSS_DEMAND_QTY,
      CALC_METHOD_USED, HAS_ISSUANCE_DATA
    FROM {FQ}.Material_Demand_VIEW
    WHERE PRODUCTION_ORDER_ID = {FOCUS_PO_ID}
    ORDER BY DEMAND_ID, BOM_UPDATE
    """
)

run_query(
    "Q5.2 — Does VIEW have any DEMAND_ID that appears more than once (global scan)",
    f"""
    SELECT DEMAND_ID, COUNT(*) AS occurrences, ANY_VALUE(PRODUCTION_ORDER_ID) AS PRODUCTION_ORDER_ID
    FROM {FQ}.Material_Demand_VIEW
    GROUP BY DEMAND_ID
    HAVING COUNT(*) > 1
    ORDER BY occurrences DESC
    LIMIT 20
    """
)

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 6: STALE SNAPSHOT CHECK
# The SNAPSHOT is frozen at time of M2 run. Check if SNAPSHOT is stale
# compared to current VIEW.
# ══════════════════════════════════════════════════════════════════════════════
section("SECTION 6 — SNAPSHOT Staleness: Compare SNAPSHOT vs VIEW row counts")

run_query(
    "Q6.1 — SNAPSHOT vs. VIEW size comparison",
    f"""
    SELECT 'SNAPSHOT' AS source, COUNT(*) AS row_count FROM {FQ}.Material_Demand_SNAPSHOT
    UNION ALL
    SELECT 'VIEW' AS source, COUNT(*) AS row_count FROM {FQ}.Material_Demand_VIEW
    """
)

run_query(
    "Q6.2 — SNAPSHOT metadata: when was it last written?",
    f"""
    SELECT
      MIN(CALCULATED_AT) AS earliest_calculated_at,
      MAX(CALCULATED_AT) AS latest_calculated_at,
      COUNT(*) AS total_rows
    FROM {FQ}.Material_Demand_SNAPSHOT
    """
)

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 7: SP_SPLIT_BATCH_GATE HISTORY CHECK
# The post-deployment analysis said SCD2 engine self-healed 7576/7577.
# But the SNAPSHOT may have been taken BEFORE the healing.
# ══════════════════════════════════════════════════════════════════════════════
section("SECTION 7 — Historical Context: When were PO 7576/7577 last modified?")

run_query(
    "Q7.1 — Production_Order history for VPO V2602003C01 (all rows, all timestamps)",
    f"""
    SELECT
      PRODUCTION_ORDER_ID, VPO, DATA_STATE,
      VALID_FROM_TS, VALID_TO_TS, UPDATED_AT, UPDATED_BY
    FROM {FQ}.Production_Order
    WHERE VPO = '{FOCUS_VPO}'
    ORDER BY VALID_FROM_TS
    """
)

run_query(
    "Q7.2 — All distinct PRODUCTION_ORDER_IDs associated with VPO V2602003C01",
    f"""
    SELECT DISTINCT PRODUCTION_ORDER_ID, DATA_STATE, VALID_FROM_TS, VALID_TO_TS
    FROM {FQ}.Production_Order
    WHERE VPO = '{FOCUS_VPO}'
    ORDER BY PRODUCTION_ORDER_ID
    """
)

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 8: TIMING ANALYSIS
# Was the M2 run (SNAPSHOT creation) BEFORE or AFTER SP_SPLIT_BATCH_GATE healed it?
# ══════════════════════════════════════════════════════════════════════════════
section("SECTION 8 — Timing Analysis: SNAPSHOT timestamp vs Production_Order update time")

run_query(
    "Q8.1 — SNAPSHOT calculated_at vs Production_Order last update for PO 7576",
    f"""
    SELECT
      snap.CALCULATED_AT AS snapshot_time,
      po.UPDATED_AT AS po_last_update,
      po.UPDATED_BY AS po_updated_by,
      po.DATA_STATE AS po_current_state,
      po.VALID_TO_TS AS po_valid_to,
      CASE
        WHEN snap.CALCULATED_AT > po.UPDATED_AT THEN 'SNAPSHOT IS NEWER THAN PO UPDATE — Ghost should be healed'
        ELSE 'PO WAS UPDATED AFTER SNAPSHOT — snapshot caught old state'
      END AS timing_verdict
    FROM (
      SELECT MAX(CALCULATED_AT) AS CALCULATED_AT
      FROM {FQ}.Material_Demand_SNAPSHOT
      WHERE PRODUCTION_ORDER_ID = {FOCUS_PO_ID}
    ) snap
    CROSS JOIN (
      SELECT UPDATED_AT, UPDATED_BY, DATA_STATE, VALID_TO_TS
      FROM {FQ}.Production_Order
      WHERE PRODUCTION_ORDER_ID = {FOCUS_PO_ID}
      ORDER BY UPDATED_AT DESC
      LIMIT 1
    ) po
    """
)

# ══════════════════════════════════════════════════════════════════════════════
# SECTION 9: SUMMARY OF FINDINGS
# ══════════════════════════════════════════════════════════════════════════════
section("SECTION 9 — Summary Interpretation Guide")

summary = """
HOW TO READ THESE RESULTS:
═══════════════════════════════════════════════════════════════════════════════

Root Cause A — BOM_Order_List_Final Duplication:
  → CHECK Q3.1 and Q3.3
  → POSITIVE SIGNAL: Q3.3 returns rows with active_entries>1 for PO 7576
  → MEANING: BOM_Order_List_Final has 2+ active rows for the same (PO, BOM) pair
  → FIX: Find and expire the extra BOM_Order_List_Final row

Root Cause B — Production_Order SCD2 Ghost:
  → CHECK Q2.2 and Q2.3
  → POSITIVE SIGNAL: Q2.2 returns 2+ rows for PO 7576 with VALID_TO_TS IS NULL
  → MEANING: Production_Order table has 2 active rows for the same PRODUCTION_ORDER_ID
  → FIX: Run SP_SPLIT_BATCH_GATE or manually expire the ghost row

Root Cause C — BOM_Data Duplication:
  → CHECK Q4.2
  → POSITIVE SIGNAL: Q4.2 returns rows (any BOM with >1 entry)
  → MEANING: BOM_Data has 2 entries for same BOM_UPDATE → doubles all demand for that BOM
  → FIX: Delete/deactivate the duplicate BOM_Data row

SNAPSHOT TIMING ISSUE:
  → CHECK Q8.1
  → If timing_verdict = 'PO WAS UPDATED AFTER SNAPSHOT':
    The snapshot was taken BEFORE the SCD2 engine healed the ghost.
    The VIEW is now clean, but the frozen snapshot is dirty.
    FIX: Re-run M2 (force allocation) to regenerate the SNAPSHOT.
═══════════════════════════════════════════════════════════════════════════════
"""
print(summary)
lines_out.append(summary)

# ─── Write results to file ─────────────────────────────────────────────────────
output_str = "\n".join(lines_out)
with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    f.write(f"Production Order Duplicate Analysis\n")
    f.write(f"Generated at: {ts}\n\n")
    f.write(output_str)

print(f"\n✅ Results saved to: {OUTPUT_FILE}")
