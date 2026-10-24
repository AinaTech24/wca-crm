// Every policy field an import can fill, in the order the policy form shows
// them. As with claims and clients, the mapping screen lists all of them and
// none is compulsory — policy sheets come from insurer portals and other
// systems and are rarely complete. The server fills what a policy needs
// (product, status, "with us") from what the row does carry.
//
// `aliases` are headings seen in insurer downloads and Zoho exports; they drive
// the automatic guess. The shared coercions (dates, numbers, phones) live with
// the claim importer and are reused.

export const POLICY_IMPORT_FIELDS = [
  { key: 'product_name', label: 'Product', type: 'text', aliases: ['product', 'product name', 'plan', 'plan name', 'scheme'] },
  { key: 'insured_name', label: 'Policy Holder Name', type: 'text', aliases: ['policy holder name', 'policyholder', 'insured name', 'insured', 'client name', 'customer name', 'proposer name', 'name'] },
  { key: 'client_email', label: 'Client Email', type: 'text', aliases: ['client email', 'email', 'email id', 'customer email'] },
  { key: 'insurance_line', label: 'Type (General / Life)', type: 'text', aliases: ['type', 'insurance line', 'line', 'gi/li'] },
  { key: 'insurance_type', label: 'Policy (Motor, Health…)', type: 'text', aliases: ['policy', 'class', 'class of business', 'line of business', 'lob', 'category', 'product category', 'policy category'] },
  { key: 'policy_type', label: 'Policy Type', type: 'text', aliases: ['policy type', 'cover type', 'nature of business', 'business type', 'variant'] },
  { key: 'business_type', label: 'New / Renewal', type: 'text', aliases: ['new / renewal', 'new/renewal', 'new or renewal', 'fresh / renewal', 'fresh/renewal', 'business nature', 'new business / renewal'] },
  { key: 'company_name', label: 'Insurance Company Name', type: 'text', aliases: ['insurance company name', 'insurance company', 'insurer', 'insurer name', 'company', 'company name'] },
  { key: 'policy_number', label: 'Policy No', type: 'text', aliases: ['policy no', 'policy number', 'policy no.', 'policy #', 'certificate no'] },
  { key: 'login_date', label: 'Login Date', type: 'date', aliases: ['login date', 'booking date', 'entry date', 'issue date', 'issued on'] },
  { key: 'associate', label: 'Associate', type: 'text', aliases: ['associate', 'agent', 'agent name', 'broker', 'source'] },
  { key: 'assigned_to', label: 'Insurance Owner', type: 'text', aliases: ['insurance owner', 'wcfw insurance owner', 'policy owner', 'owner', 'relationship manager', 'rm', 'handled by'] },

  { key: 'currency', label: 'Currency', type: 'text', aliases: ['currency'] },
  { key: 'exchange_rate', label: 'Exchange Rate', type: 'number', aliases: ['exchange rate'] },
  { key: 'policy_mode', label: 'Premium Mode (Life)', type: 'text', aliases: ['policy mode', 'premium mode', 'premium frequency', 'mode'] },
  { key: 'term_years', label: 'Policy Term (years)', type: 'text', aliases: ['policy term', 'term', 'term years', 'policy term years'] },
  { key: 'ppt_years', label: 'Premium Paying Term (years)', type: 'text', aliases: ['ppt', 'premium paying term', 'ppt years'] },

  { key: 'sum_assured', label: 'Sum Assured / IDV', type: 'number', aliases: ['sum assured', 'sum insured', 'idv', 'cover amount', 'si', 'sum assured / idv'] },
  { key: 'net_premium', label: 'Net / Basic Premium', type: 'number', aliases: ['net premium', 'basic premium', 'premium before gst', 'base premium'] },
  { key: 'gst_amount', label: 'GST Amount', type: 'number', aliases: ['gst', 'gst amount', 'tax', 'service tax'] },
  { key: 'final_premium', label: 'Total Premium (incl. GST)', type: 'number', aliases: ['final premium', 'total premium', 'gross premium', 'premium', 'premium amount', 'total amount'] },
  { key: 'cumulative_bonus', label: 'Cumulative Bonus (Life)', type: 'number', aliases: ['cumulative bonus', 'bonus'] },

  { key: 'period_from', label: 'Start Date', type: 'date', aliases: ['period from', 'start date', 'policy start date', 'risk start date', 'inception date', 'from date', 'effective date'] },
  { key: 'period_to', label: 'Expiry Date', type: 'date', aliases: ['period to', 'expiry date', 'end date', 'policy end date', 'to date', 'renewal date', 'due date'] },
  { key: 'commencement_date', label: 'Commencement Date (Life)', type: 'date', aliases: ['commencement date', 'date of commencement'] },
  { key: 'maturity_date', label: 'Maturity Date (Life)', type: 'date', aliases: ['maturity date', 'date of maturity'] },

  { key: 'nominee_name', label: 'Nominee Name', type: 'text', aliases: ['nominee name', 'nominee'] },
  { key: 'nominee_age', label: 'Nominee Age', type: 'text', aliases: ['nominee age'] },
  { key: 'nominee_relation', label: 'Nominee Relation', type: 'text', aliases: ['nominee relation', 'nominee relationship'] },

  { key: 'reg_no', label: 'Registration No (Motor)', type: 'text', aliases: ['registration no', 'reg no', 'vehicle no', 'vehicle number', 'registration number'] },
  { key: 'ncb_pct', label: 'NCB % (Motor)', type: 'text', aliases: ['ncb', 'ncb %', 'ncb pct', 'no claim bonus'] },
  { key: 'members_covered', label: 'Members Covered (Health)', type: 'text', aliases: ['members covered', 'members', 'lives covered'] },
  { key: 'room_rent', label: 'Room Rent Limit (Health)', type: 'text', aliases: ['room rent', 'room rent limit'] },
  { key: 'ped_waiting', label: 'PED Waiting Period (Health)', type: 'text', aliases: ['ped waiting', 'ped waiting period', 'pre existing waiting'] },
  { key: 'employee_type', label: 'Cover For (Group Health)', type: 'text', aliases: ['cover for', 'employee type', 'employee'] },

  { key: 'payment_type', label: 'Payment Mode', type: 'text', aliases: ['payment mode', 'payment type', 'mode of payment'] },
  { key: 'policy_with_us', label: 'Policy With Us (Yes / No)', type: 'text', aliases: ['policy with us', 'with us'] },
  { key: 'lost_reason', label: 'Lost Reason', type: 'text', aliases: ['lost reason', 'reason lost', 'reason for loss'] },
  { key: 'policy_status', label: 'Status', type: 'text', aliases: ['status', 'policy status'] },
  { key: 'active_status', label: 'Active / Inactive', type: 'text', aliases: ['active status', 'active/inactive', 'active'] },
  { key: 'renewable', label: 'Renewable (Yes / No)', type: 'text', aliases: ['renewable'] },
  { key: 'remarks', label: 'Remarks', type: 'text', aliases: ['remarks', 'notes', 'note', 'description', 'comments'] },
];

export { toDate, toNumber, toPhone } from './claimImportFields.js';

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Best guess at which column feeds each field. Exact normalised matches only,
 * and a column is used for one field at most — "Policy" and "Policy No" both
 * normalise near each other, and a wrong guess silently loads the wrong data.
 */
export function guessPolicyMapping(headers) {
  const byNorm = new Map();
  for (const h of headers) if (h && !byNorm.has(norm(h))) byNorm.set(norm(h), h);
  const taken = new Set();
  const map = {};
  for (const f of POLICY_IMPORT_FIELDS) {
    const candidates = [f.label, f.key.replace(/_/g, ' '), ...(f.aliases || [])];
    const hit = candidates.map(norm).find((c) => byNorm.has(c) && !taken.has(byNorm.get(c)));
    if (hit) { map[f.key] = byNorm.get(hit); taken.add(byNorm.get(hit)); }
  }
  return map;
}

/** Applies the mapping to one row, coercing by field type. */
export function rowToPolicy(row, mapping, toDateFn, toNumberFn) {
  const out = {};
  for (const f of POLICY_IMPORT_FIELDS) {
    const col = mapping[f.key];
    if (!col) continue;
    const raw = row[col];
    if (raw === undefined || raw === null || raw === '') continue;
    out[f.key] = f.type === 'date' ? toDateFn(raw) : f.type === 'number' ? toNumberFn(raw) : String(raw).trim();
  }
  return out;
}
