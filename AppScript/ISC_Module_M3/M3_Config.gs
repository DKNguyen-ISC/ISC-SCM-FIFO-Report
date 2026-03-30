/**
 * ⚙️ M3 LOCAL CONFIGURATION (Manifest)
 * Defines the Input Sheets for Module 3 (Procurement & Supplier Management).
 * * STRATEGY:
 * - Maps strictly to the Staging Tables defined in Config_Schema.
 * - Used by M3_SheetBuilder to generate the 3-Zone Layouts.
 */
const M3_MANIFEST = {
  INPUT_SHEETS: [
    // 1. Supplier Master Data (Who are they?)
    'Supplier_Information_Staging',
    
    // 2. Supplier Capacity (What do they sell & How much?)
    'Supplier_Capacity_Staging'
  ]
};

function getLocalManifest() {
  return M3_MANIFEST;
}