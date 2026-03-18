/**
 * 🔐 CONFIG ENVIRONMENT
 * Stores infrastructure credentials and connection details.
 */
const ENV = {
  PROJECT_ID: 'boxwood-charmer-473204-k8',
  DATASET_ID: 'isc_scm_ops', // Updated to the one you just created
};

/**
 * Public Accessor
 * Merges Environment with Schema to provide a single config object to other scripts.
 */
function getCoreConfig() {
  return {
    connection: ENV,
    tables: SCHEMA_DEFINITIONS.TABLE_IDS,
    schemas: SCHEMA_DEFINITIONS.TABLE_SCHEMAS,
    layouts: SCHEMA_DEFINITIONS.SHEET_LAYOUTS
  };
}