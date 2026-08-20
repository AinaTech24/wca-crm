// Department classification. This is the single source of truth — the client
// fetches it from GET /api/departments rather than keeping its own copy, so
// the rule can't drift between the two.

export const PERSONAL = 'Personal Lines';
export const COMMERCIAL = 'Commercial Lines';
export const BOTH = 'Both';
export const DEPARTMENTS = [PERSONAL, COMMERCIAL];

// Everything NOT in this list falls to Commercial Lines. Group/employer
// products stay Commercial even where the retail equivalent is Personal —
// Group Health is bought by a company, Health by a person.
//
// To move a product between departments, change this list; nothing else
// needs editing. Existing records keep the department stamped at save time
// until they're next saved, so re-run a backfill if you change it.
export const PERSONAL_PRODUCTS = [
  // Life — retail only. Group Term Life is Commercial.
  'Life Insurance', 'Life / Term', 'Term', 'Endowment', 'Money Back', 'Whole Life',
  'Child Plan', 'Pension / Annuity',
  'ULIP', 'ULIP Plan',
  // Health — retail only. Group Health is Commercial.
  'Health', 'Health Insurance', 'Retail Health',
  'Super Top Up', 'SISO', 'Critical Illness',
  // Personal Accident — retail only. Group Personal Accident is Commercial.
  'Personal Accident',
  'Travel', 'Travel Insurance',
];

// Claim types use their own short vocabulary, so they're mapped explicitly
// rather than hoping the strings line up.
const PERSONAL_CLAIM_TYPES = ['Health', 'Personal', 'Personal Accident', 'Travel', 'Critical Illness', 'Life'];

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const PERSONAL_SET = new Set(PERSONAL_PRODUCTS.map(norm));
const PERSONAL_CLAIM_SET = new Set(PERSONAL_CLAIM_TYPES.map(norm));

// A product name decides the department. Blank input stays blank rather than
// defaulting to Commercial, so an unclassified record is visible as such
// instead of silently landing in one team's queue.
export function departmentForProduct(product) {
  const p = norm(product);
  if (!p) return '';
  return PERSONAL_SET.has(p) ? PERSONAL : COMMERCIAL;
}

export function departmentForClaimType(claimType) {
  const c = norm(claimType);
  if (!c) return '';
  return PERSONAL_CLAIM_SET.has(c) ? PERSONAL : COMMERCIAL;
}

// Who can see across both departments: admins, department heads (per the
// agreed rule), and anyone explicitly set to Both.
export function seesAllDepartments(user) {
  if (!user) return true;
  return user.role === 'admin' || Number(user.is_head) === 1 || !user.department || user.department === BOTH;
}
