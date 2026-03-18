from google.cloud import bigquery

PROJECT = "boxwood-charmer-473204-k8"
DS = "isc_scm_ops"
FQ = PROJECT + "." + DS

client = bigquery.Client(project=PROJECT)

results = []

def q(sql, label):
    results.append("=" * 60)
    results.append("Q: " + label)
    results.append("=" * 60)
    try:
        rows = list(client.query(sql).result())
        if not rows:
            results.append("(no rows)")
        else:
            hdrs = list(rows[0].keys())
            results.append("\t".join(hdrs))
            for r in rows:
                results.append("\t".join(
                    "" if r[h] is None else str(r[h])
                    for h in hdrs
                ))
    except Exception as e:
        results.append("ERROR: " + str(e))
    results.append("")

q(
    "SELECT SOURCE_ID, COUNT(*) cnt, COUNT(DISTINCT BOM_UPDATE) boms,"
    " COUNT(DISTINCT VPO) vpos, ROUND(SUM(CUMULATIVE_ISSUANCE_QTY),1) qty,"
    " CAST(MIN(SNAPSHOT_DATE) AS STRING) earliest,"
    " CAST(MAX(SNAPSHOT_DATE) AS STRING) latest"
    " FROM `" + FQ + ".Material_Issuance` GROUP BY SOURCE_ID",
    "1. Material_Issuance State"
)

q(
    "SELECT MIN(BOM_UPDATE) mn, MAX(BOM_UPDATE) mx,"
    " COUNT(DISTINCT BOM_UPDATE) boms, COUNT(*) total_rows"
    " FROM `" + FQ + ".Material_Issuance` WHERE SOURCE_ID='CHI_LEAD'",
    "2. BOM_UPDATE Range"
)

q(
    "SELECT BOM_STATUS, COUNT(DISTINCT BOM_UPDATE) cnt"
    " FROM `" + FQ + ".BOM_Data`"
    " WHERE LOWER(TRIM(MAIN_GROUP)) = 'ch\u00ec'"
    " GROUP BY BOM_STATUS",
    "3. BOM_Data Chì by Status"
)

q(
    "SELECT BOM_UPDATE, VPO, ROUND(CUMULATIVE_ISSUANCE_QTY,4) qty,"
    " CAST(SNAPSHOT_DATE AS STRING) snap"
    " FROM `" + FQ + ".Material_Issuance`"
    " WHERE SOURCE_ID='CHI_LEAD'"
    " ORDER BY BOM_UPDATE, VPO",
    "4. All Material_Issuance rows (CHI_LEAD)"
)

q(
    "SELECT VPO, COUNT(DISTINCT BOM_UPDATE) boms,"
    " ROUND(SUM(CUMULATIVE_ISSUANCE_QTY),1) qty"
    " FROM `" + FQ + ".Material_Issuance`"
    " WHERE SOURCE_ID='CHI_LEAD'"
    " GROUP BY VPO ORDER BY qty DESC",
    "5. VPO Breakdown"
)

q(
    "SELECT HAS_ISSUANCE_DATA, COUNT(*) rows,"
    " COUNT(DISTINCT BOM_UPDATE) boms,"
    " ROUND(SUM(NET_SHORTAGE_QTY),1) net_shortage"
    " FROM `" + FQ + ".PR_Draft`"
    " WHERE LOWER(TRIM(MAIN_GROUP)) = 'ch\u00ec'"
    " GROUP BY HAS_ISSUANCE_DATA",
    "6. PR_Draft Chì by HAS_ISSUANCE_DATA"
)

q(
    "SELECT CALC_METHOD_USED, HAS_ISSUANCE_DATA,"
    " COUNT(*) demand_rows, COUNT(DISTINCT BOM_UPDATE) boms,"
    " ROUND(SUM(SHORTAGE_ISSUANCE),1) shortage_issuance,"
    " ROUND(SUM(SHORTAGE_COMPLETION),1) shortage_completion"
    " FROM `" + FQ + ".Material_Demand_VIEW`"
    " WHERE LOWER(TRIM(MAIN_GROUP)) = 'ch\u00ec'"
    " GROUP BY CALC_METHOD_USED, HAS_ISSUANCE_DATA"
    " ORDER BY 1, 2",
    "7. Material_Demand_VIEW Chì breakdown"
)

q(
    "SELECT"
    " CASE WHEN d.BOM_UPDATE IS NOT NULL AND i.BOM_UPDATE IS NOT NULL THEN 'IN_BOTH'"
    " WHEN d.BOM_UPDATE IS NOT NULL AND i.BOM_UPDATE IS NULL THEN 'DEMAND_ONLY'"
    " WHEN d.BOM_UPDATE IS NULL AND i.BOM_UPDATE IS NOT NULL THEN 'ISSUANCE_ONLY' END coverage,"
    " COUNT(*) cnt"
    " FROM (SELECT DISTINCT BOM_UPDATE FROM `" + FQ + ".Material_Demand_VIEW`"
    " WHERE LOWER(TRIM(MAIN_GROUP)) = 'ch\u00ec') d"
    " FULL OUTER JOIN (SELECT DISTINCT BOM_UPDATE FROM `" + FQ + ".Material_Issuance`) i"
    " ON d.BOM_UPDATE = i.BOM_UPDATE"
    " GROUP BY 1 ORDER BY 1",
    "8. Demand vs Issuance Coverage"
)

q(
    "SELECT HAS_ISSUANCE_DATA, HAS_SHORTAGE,"
    " COUNT(DISTINCT BOM_UPDATE) boms,"
    " ROUND(SUM(SHORTAGE_ISSUANCE),1) shortage_issuance,"
    " ROUND(SUM(SHORTAGE_COMPLETION),1) shortage_completion"
    " FROM `" + FQ + ".M2_Pipeline_Ledger`"
    " WHERE LOWER(TRIM(MAIN_GROUP)) = 'ch\u00ec'"
    " AND LEDGER_DATE = (SELECT MAX(LEDGER_DATE) FROM `" + FQ + ".M2_Pipeline_Ledger`)"
    " GROUP BY HAS_ISSUANCE_DATA, HAS_SHORTAGE ORDER BY 1, 2",
    "9. M2_Pipeline_Ledger latest Chì snapshot"
)

q(
    "SELECT COUNT(*) AS total_chi_boms_in_demand,"
    " COUNTIF(HAS_ISSUANCE_DATA) AS with_issuance,"
    " COUNTIF(NOT HAS_ISSUANCE_DATA) AS without_issuance,"
    " ROUND(SUM(IF(NOT HAS_ISSUANCE_DATA, GROSS_DEMAND_QTY, 0)),1) AS demand_without_issuance_qty"
    " FROM (SELECT BOM_UPDATE, HAS_ISSUANCE_DATA, GROSS_DEMAND_QTY"
    " FROM `" + FQ + ".Material_Demand_VIEW`"
    " WHERE LOWER(TRIM(MAIN_GROUP)) = 'ch\u00ec'"
    " QUALIFY ROW_NUMBER() OVER (PARTITION BY BOM_UPDATE ORDER BY GROSS_DEMAND_QTY DESC) = 1)",
    "10. Unique BOM coverage summary"
)

# Write results
with open("bq_results.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(results))

print("DONE. Written to bq_results.txt")
print("\n".join(results[:50]))
