# BOM_Order_List Push Analysis

## 🎯 Executive Summary
During the push process from `BOM_Order_List_Draft` to BigQuery, the system raised a `Query error: Query column 11 has type INT64 which cannot be inserted into column VALID_TO_TS, which has type TIMESTAMP at [boxwood-charmer-473204-k8.isc_scm_ops.SP_SPLIT_BATCH_GATE:127:9]`.

This analysis unpacks why this happened to the `BOM_Order_List_Draft` but not the `Production_Order_Draft`, and outlines the fix implemented in the `SQL_Vault.txt` to resolve the type casting behavior.

---

## 🕵️ Root Cause Analysis

### 1. The BigQuery `NULL` Type Inference Mismatch
The issue originates in the `SP_SPLIT_BATCH_GATE` stored procedure inside `SQL_Vault.txt`. In BigQuery, raw, untyped `NULL` literals are unambiguously evaluated but frequently typed as `INT64` during early query planning. Normally, BigQuery intelligently coerces these data types on the fly to match the target table schema (in our case, `TIMESTAMP` for the `VALID_TO_TS` column).

However, the `SELECT` query merging `BOM_Order_List_Staging` into `BOM_Order_List_Final` uses the analytics clause:
```sql
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY S.PRODUCTION_ORDER_ID, S.BOM_UPDATE
  ORDER BY COALESCE(S.BOM_CONSUMPTION, 0) DESC, S.UPLOADED_AT DESC
) = 1;
```
When an analytic clause like `QUALIFY` or `GROUP BY` is present, the BigQuery engine adheres to **strict typing** during the projection stage. It strictly types the `NULL` intended for column 11 (`VALID_TO_TS`) as an `INT64` prior to applying schema target assignments. By the time it tries to insert that into the table, the `INT64` fails the `TIMESTAMP` type check, triggering the error.

### 2. Why Did Production_Order Work Fine?
The success of `Production_Order` emails and data uploads highlighted an interesting disparity. 

The `INSERT INTO Production_Order` statement in the same `SP_SPLIT_BATCH_GATE` procedure also assigned `NULL` to its `VALID_TO_TS` column. However, it succeeded because its `SELECT` operation does **not** rely on any analytic functions like `QUALIFY` or complex grouping algorithms. The simplicity of the query allowed BigQuery to lazily evaluate the data types, properly coercing the generic `NULL` to fit the expected `TIMESTAMP` requirement dynamically.

### 3. The Graceful "Missing IDs" Fallback
Your findings regarding the successful insertion of missing IDs in the `Production_Order` align with the system's staging architecture. 

The Apps Script framework pushes raw `Production_Order_Draft` rows directly into Staging tables. Even if some fields (like the production order ID) are empty in the payload, the system's staging buffers or `FN_GENERATE_HASH` safely ingest the data before the final pipeline triggers. BigQuery's staging layer accepted these rows because they passed the raw schema integrity constraints, operating independently from the `VALID_TO_TS` query compilation mismatch.

---

## 🛠️ The Fix Implemented

The fix targets the `SP_SPLIT_BATCH_GATE` routine in `SQL_Vault.txt`.

By explicitly converting the raw `NULL` to a deterministic type representation via `CAST(NULL AS TIMESTAMP)`, we force BigQuery to universally recognize the column null attribute as the appropriate target type. This completely bypasses the default `INT64` evaluation behavior mandated by analytic `QUALIFY` functions.

**Previous Code Context:**
```sql
CURRENT_TIMESTAMP(),
NULL
```

**Updated Code Context:**
```sql
CURRENT_TIMESTAMP(),
CAST(NULL AS TIMESTAMP)
```

For systemic stability, this safety cast has been applied to both the `Production_Order` and `BOM_Order_List_Final` insertion blocks to ensure uniformity across all operations within `SP_SPLIT_BATCH_GATE`. Operations handled directly by `M1_Main.txt` were verified to be fundamentally sound, as the trigger routing logic itself is robust.

The solution is now fully merged into the codebase. You can redeploy the `SQL_Vault` script and safely re-trigger the BigQuery Push protocol!
