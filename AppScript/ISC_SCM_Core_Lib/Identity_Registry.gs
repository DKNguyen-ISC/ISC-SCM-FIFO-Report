/* =========================================================================
 * FILE: ISC_SCM_Core_Lib/Identity_Registry.gs
 * DESCRIPTION: Centralized PIC Identity Registry (Phase 2 — Decision D10, D19)
 * 
 * PURPOSE:
 *   Single source of truth for all PIC name resolution across the ISC system.
 *   Replaces the fragmented VALID_PICS arrays previously duplicated in:
 *     - M3_Sourcing_Main.gs
 *     - M3_Consolidation_Main.gs
 *     - (Future: M3_PO_Issuance, M4_Suppliers_Portal, M4_Injection_Portal)
 *
 * PUBLIC API:
 *   resolvePicIdentity(rawInput)   → canonical name string | null
 *   getValidPicNames()             → display string for UI prompts
 *   getPicInfo(canonicalName)      → full registry object | null
 *
 * FEATURES:
 *   - Vietnamese diacritic-insensitive matching (e.g. "ngan" → "Ngàn")
 *   - Case-insensitive matching (e.g. "THANG" → "Thắng")
 *   - Safe null/undefined handling
 *   - Role-aware (PLANNER, MANAGER, SYSTEM_ARCHITECT, SPECIAL)
 *
 * VERSION: 1.0 | Phase 2
 * ========================================================================= */


// ═══════════════════════════════════════════════════════════════════════════════
// 1. THE REGISTRY — Single Source of Truth for all PICs
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * IDENTITY_REGISTRY
 * 
 * Add new PICs here. No other files need to change.
 * 
 * Roles:
 *   PLANNER          — Material planners (main users of Assign_Sourcing)
 *   MANAGER          — Management view
 *   SYSTEM_ARCHITECT — Receives system notifications (D19: Khánh)
 *   SPECIAL          — Special accounts with elevated/cross-PIC access
 */
const IDENTITY_REGISTRY = [
  {
    canonicalName: 'Ngàn',
    role:          'PLANNER',
    email:         'ngan@isconline.vn',
    aliases:       ['ngan', 'ngan']   // diacritic-stripped form handled automatically
  },
  {
    canonicalName: 'Nga',
    role:          'PLANNER',
    email:         'buithinga@isconline.vn',
    aliases:       []
  },
  {
    canonicalName: 'Thắng',
    role:          'PLANNER',
    email:         'levietthang@isconline.vn',
    aliases:       []
  },
  {
    canonicalName: 'Phương',
    role:          'PLANNER',
    email:         'phuongbui@isconline.vn',
    aliases:       []
  },
  {
    canonicalName: 'Phong',
    role:          'PLANNER',
    email:         'phong.mai@isconline.vn',
    aliases:       []
  },
  {
    canonicalName: 'Nam',
    role:          'MANAGER',
    email:         'honam@isconline.vn',
    aliases:       []
  },
  {
    canonicalName: 'Khánh',
    role:          'SYSTEM_ARCHITECT',  // D19: receives system cleanup notifications
    email:         'dk@isconline.vn',
    aliases:       []
  },
  {
    canonicalName: 'MASTER',
    role:          'SPECIAL',
    email:         null,                // No email — system-only account
    aliases:       ['master']
  }
];


// ═══════════════════════════════════════════════════════════════════════════════
// 2. PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolves a raw user input to the canonical PIC name.
 * Matching is Vietnamese diacritic-insensitive AND case-insensitive.
 *
 * @param {string|null} rawInput — The raw string from a UI prompt
 * @returns {string|null} — Canonical name (e.g. "Ngàn") or null if no match
 *
 * @example
 *   resolvePicIdentity('ngan')   → 'Ngàn'
 *   resolvePicIdentity('THANG')  → 'Thắng'
 *   resolvePicIdentity('Ngàn')   → 'Ngàn'
 *   resolvePicIdentity('xyz')    → null
 *   resolvePicIdentity(null)     → null
 */
function resolvePicIdentity(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') return null;

  const normalizedInput = _stripVietnameseDiacritics(rawInput.trim().toLowerCase());

  const match = IDENTITY_REGISTRY.find(entry => {
    // Compare stripping diacritics from the canonical name too
    const normalizedCanonical = _stripVietnameseDiacritics(entry.canonicalName.toLowerCase());
    return normalizedCanonical === normalizedInput;
  });

  return match ? match.canonicalName : null;
}


/**
 * Returns a human-readable display string of all valid PICs for use in prompts.
 *
 * @returns {string} — e.g. "Nga, Ngàn, Thắng, Phong, Phương, Nam, Khánh, MASTER"
 */
function getValidPicNames() {
  return IDENTITY_REGISTRY.map(entry => entry.canonicalName).join(', ');
}


/**
 * Returns the full registry entry for a given canonical PIC name.
 *
 * @param {string} canonicalName — Must be the exact canonical form (e.g. "Ngàn")
 * @returns {Object|null} — Registry entry object or null if not found
 *
 * @example
 *   getPicInfo('Khánh') → { canonicalName: 'Khánh', role: 'SYSTEM_ARCHITECT', email: 'dk@isconline.vn', ... }
 */
function getPicInfo(canonicalName) {
  if (!canonicalName) return null;
  return IDENTITY_REGISTRY.find(entry => entry.canonicalName === canonicalName) || null;
}


// ═══════════════════════════════════════════════════════════════════════════════
// 3. PRIVATE UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Strips Vietnamese diacritics from a string for fuzzy matching.
 * Handles the full Vietnamese character set including tone marks and đ/Đ.
 *
 * @param {string} str — Input string
 * @returns {string} — String with diacritics removed
 *
 * @example
 *   _stripVietnameseDiacritics('Ngàn')   → 'ngan'  (after .toLowerCase())
 *   _stripVietnameseDiacritics('Thắng')  → 'thang' (after .toLowerCase())
 *   _stripVietnameseDiacritics('Phương') → 'phuong'(after .toLowerCase())
 */
function _stripVietnameseDiacritics(str) {
  if (!str) return '';

  return str
    // Unicode NFD decomposition separates base chars from combining diacritics
    .normalize('NFD')
    // Remove all combining diacritical marks (U+0300 to U+036F)
    .replace(/[\u0300-\u036f]/g, '')
    // Handle Vietnamese-specific characters not covered by NFD
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}


// ═══════════════════════════════════════════════════════════════════════════════
// 4. TEST FUNCTION (Run from Apps Script editor to verify deployment)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * testIdentityRegistry()
 * Run this from the Apps Script editor after deploying this file.
 * Check the Execution Log for pass/fail results.
 */
function testIdentityRegistry() {
  const tests = [
    { input: 'Ngan',   expected: 'Ngàn',   desc: 'Accent-free, capitalized' },
    { input: 'ngan',   expected: 'Ngàn',   desc: 'Accent-free, lowercase'   },
    { input: 'NGAN',   expected: 'Ngàn',   desc: 'Accent-free, uppercase'   },
    { input: 'Ngàn',   expected: 'Ngàn',   desc: 'Full accented form'       },
    { input: 'thang',  expected: 'Thắng',  desc: 'thang → Thắng'           },
    { input: 'THANG',  expected: 'Thắng',  desc: 'THANG → Thắng'           },
    { input: 'khanh',  expected: 'Khánh',  desc: 'khanh → Khánh'           },
    { input: 'Khanh',  expected: 'Khánh',  desc: 'Khanh → Khánh'           },
    { input: 'phuong', expected: 'Phương', desc: 'phuong → Phương'         },
    { input: 'Phong',  expected: 'Phong',  desc: 'Phong (no diacritics)'    },
    { input: 'Nam',    expected: 'Nam',    desc: 'Nam'                      },
    { input: 'Nga',    expected: 'Nga',    desc: 'Nga'                      },
    { input: 'MASTER', expected: 'MASTER', desc: 'MASTER special account'   },
    { input: 'master', expected: 'MASTER', desc: 'master lowercase'         },
    { input: 'invalid',expected: null,     desc: 'Unknown name → null'      },
    { input: '',       expected: null,     desc: 'Empty string → null'      },
    { input: null,     expected: null,     desc: 'Null input → null'        },
  ];

  let passed = 0;
  let failed = 0;

  tests.forEach(t => {
    const result = resolvePicIdentity(t.input);
    const ok = result === t.expected;
    Logger.log(
      `${ok ? '✅ PASS' : '❌ FAIL'} | ${t.desc} | ` +
      `resolvePicIdentity('${t.input}') => '${result}' (expected: '${t.expected}')`
    );
    ok ? passed++ : failed++;
  });

  Logger.log(`\n${'═'.repeat(60)}`);
  Logger.log(`RESULT: ${passed}/${tests.length} tests passed.${failed > 0 ? ' ← FIX FAILURES BEFORE PROCEEDING.' : ' ✅ All good!'}`);
  Logger.log(`getValidPicNames() = "${getValidPicNames()}"`);
  Logger.log(`getPicInfo('Khánh') = ${JSON.stringify(getPicInfo('Khánh'))}`);
}
