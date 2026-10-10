// Every client field an import can fill, in the order the contact layout
// presents them. As with claims, the mapping screen lists all of them and none
// is compulsory — these sheets come from other systems and are rarely complete.
//
// Name is the one special case: the layout splits it into Salutation / First /
// Last, while a client here has a single name. The importer maps all three and
// joins whatever it finds, so either shape of sheet works.

export const CLIENT_IMPORT_FIELDS = [
  { key: 'salutation', label: 'Salutation', type: 'text', aliases: ['salutation', 'title'] },
  { key: 'first_name', label: 'First Name', type: 'text', aliases: ['first name', 'firstname'] },
  { key: 'last_name', label: 'Last Name', type: 'text', aliases: ['last name', 'lastname', 'surname'] },
  { key: 'client_name', label: 'Full Name (if not split)', type: 'text', aliases: ['client name', 'full name', 'contact name', 'name', 'insured name'] },
  { key: 'mobile', label: 'Mobile', type: 'phone', aliases: ['mobile', 'phone', 'contact number', 'mobile no'] },
  { key: 'email', label: 'Email', type: 'text', aliases: ['email', 'email id', 'primary email'] },
  { key: 'owner', label: 'Contact Owner', type: 'text', aliases: ['contact owner', 'client owner', 'owner'] },
  { key: 'added_by', label: 'Added By', type: 'text', aliases: ['added by', 'created by'] },
  { key: 'client_category', label: 'Client Category', type: 'text', aliases: ['client category', 'category', 'rating'] },
  { key: 'client_status', label: 'Status', type: 'text', aliases: ['status', 'client status'] },
  { key: 'onboarding_date', label: 'Date of Onboarding', type: 'date', aliases: ['date of onboarding', 'onboarding date'] },
  { key: 'lead_source', label: 'Lead Source', type: 'text', aliases: ['lead source', 'source'] },
  { key: 'referred_by_client_name', label: 'Referral Client Name', type: 'text', aliases: ['referal client name', 'referral client name', 'referred by'] },
  { key: 'family_type', label: 'Family or Individual', type: 'text', aliases: ['family or individual', 'family type'] },
  { key: 'family_head_name', label: 'Family Owner / Head', type: 'text', aliases: ['family owner', 'family head', 'family head name'] },
  { key: 'dob', label: 'Date of Birth', type: 'date', aliases: ['date of birth', 'dob', 'birth date'] },
  { key: 'anniversary', label: 'Anniversary', type: 'date', aliases: ['anniversary', 'wedding anniversary'] },
  { key: 'aadhar_no', label: 'Adhaar Card', type: 'text', aliases: ['adhaar card', 'aadhar card', 'aadhar', 'aadhaar no'] },
  { key: 'pan_no', label: 'Pan Card No', type: 'text', aliases: ['pan card no', 'pan', 'pan no'] },
  { key: 'gstin', label: 'GSTIN', type: 'text', aliases: ['gstin', 'gst no', 'gst number'] },
  { key: 'occupation', label: 'Profession', type: 'text', aliases: ['profession', 'occupation'] },
  { key: 'company_name', label: 'Company Name', type: 'text', aliases: ['company name', 'company'] },
  { key: 'risk_profile', label: 'Risk Profile', type: 'text', aliases: ['risk profile'] },
  { key: 'review_frequency', label: 'Review Type / Frequency', type: 'text', aliases: ['review type', 'review frequency'] },

  { key: 'can_iin_no', label: 'CAN / IIN No', type: 'text', aliases: ['can/iin no', 'can iin no', 'can no', 'iin no'] },
  { key: 'finnsys_id', label: 'Finnsys ID', type: 'text', aliases: ['finnsys id', 'finnsys'] },
  { key: 'social_lead_id', label: 'Social Lead ID', type: 'text', aliases: ['social lead id'] },
  { key: 'client_code', label: 'Client Code', type: 'text', aliases: ['client code'] },
  { key: 'client_record_id', label: 'Client Record ID', type: 'text', aliases: ['client record id', 'record id'] },
  { key: 'tin_number', label: 'TIN Number', type: 'text', aliases: ['tin number', 'tin no'] },
  { key: 'tin_updated', label: 'Is TIN Updated?', type: 'text', aliases: ['is tin number updated?', 'is tin number updated', 'tin updated'] },
  { key: 'currency', label: 'Currency', type: 'text', aliases: ['currency'] },
  { key: 'exchange_rate', label: 'Exchange Rate', type: 'text', aliases: ['exchange rate'] },
  { key: 'file_email', label: 'File / Email', type: 'text', aliases: ['file/email', 'file email'] },
  { key: 'send_goal_sheet', label: 'Send Goal Sheet', type: 'text', aliases: ['send goal sheet'] },

  { key: 'group_head_name', label: 'Group Head Name', type: 'text', aliases: ['group head name', 'group head'] },
  { key: 'group_code', label: 'Group Code', type: 'text', aliases: ['group code'] },

  // A client holds a list of nominees, but a spreadsheet row carries one set
  // of columns. These five are folded into a single nominee entry on import.
  { key: 'nominee_name', label: 'Nominee Name / Details', type: 'text', aliases: ['nominee details', 'nominee name', 'nominee'] },
  { key: 'nominee_dob', label: 'Nominee Date of Birth', type: 'date', aliases: ['nominee date of birth', 'nominee dob'] },
  { key: 'nominee_relation', label: 'Nominee Relation', type: 'text', aliases: ['nominee relation', 'nominee relationship'] },
  { key: 'nominee_share_pct', label: 'Nominee Share %', type: 'text', aliases: ['nominee share', 'nominee share %', 'nominee percentage'] },
  { key: 'nominee_mobile', label: 'Nominee Mobile', type: 'phone', aliases: ['nominee mobile', 'nominee phone'] },

  { key: 'guardian_name', label: 'Guardian Name', type: 'text', aliases: ['guardian name'] },
  { key: 'nominee_minor_guardian', label: 'If Nominee Minor, Guardian Name', type: 'text', aliases: ['if nominee minor, guardian name', 'nominee guardian'] },

  { key: 'address', label: 'Mailing Street', type: 'text', aliases: ['mailing street', 'address', 'street'] },
  { key: 'city', label: 'Mailing City', type: 'text', aliases: ['mailing city', 'city'] },
  { key: 'state', label: 'Mailing State', type: 'text', aliases: ['mailing state', 'state'] },
  { key: 'pincode', label: 'Mailing Zip', type: 'text', aliases: ['mailing zip', 'pincode', 'pin code', 'zip'] },
  { key: 'country', label: 'Mailing Country', type: 'text', aliases: ['mailing country', 'country'] },
  { key: 'other_city', label: 'Other City', type: 'text', aliases: ['other city'] },
  { key: 'other_state', label: 'Other State', type: 'text', aliases: ['other state'] },
  { key: 'other_zip', label: 'Other Zip', type: 'text', aliases: ['other zip'] },
  { key: 'other_country', label: 'Other Country', type: 'text', aliases: ['other country'] },
  { key: 'courier_ok', label: 'Can We Send Courier on this Address?', type: 'text', aliases: ['can we send curier on this address?', 'can we send courier on this address?', 'courier'] },

  { key: 'sip', label: 'SIP', type: 'text', aliases: ['sip'] },
  { key: 'lumpsum', label: 'Lumpsum', type: 'text', aliases: ['lumpsum', 'lump sum'] },
  { key: 'life_insurance', label: 'Life Insurance', type: 'text', aliases: ['life insurance'] },
  { key: 'super_top_up', label: 'Super Top Up', type: 'text', aliases: ['super top up', 'super topup'] },
  { key: 'personal_accident', label: 'Personal Accident', type: 'text', aliases: ['personal accident'] },
  { key: 'health_insurance', label: 'Health Insurance', type: 'text', aliases: ['health insurance'] },
  { key: 'ulip', label: 'ULIP', type: 'text', aliases: ['ulip'] },
  { key: 'travel_insurance', label: 'Travel Insurance', type: 'text', aliases: ['travel insurance'] },
  { key: 'siso', label: 'SISO', type: 'text', aliases: ['siso'] },
  { key: 'corporate_insurance', label: 'Corporate Insurance', type: 'text', aliases: ['corporate insurance'] },
  { key: 'vehicle_insurance', label: 'Vehicle Insurance', type: 'text', aliases: ['vehicle insurance'] },
  { key: 'pms', label: 'PMS', type: 'text', aliases: ['pms'] },
  { key: 'critical_illness', label: 'Critical Illness', type: 'text', aliases: ['critical illness'] },
  { key: 'goal_gps', label: 'Goal GPS', type: 'text', aliases: ['goal gps'] },
  { key: 'demat_account', label: 'Demat Account', type: 'text', aliases: ['demat account', 'demat'] },
  { key: 'fhp_qualified', label: 'FHP Qualified', type: 'text', aliases: ['fhp qualified', 'fhp'] },
  { key: 'iifl_account', label: 'IIFL Account', type: 'text', aliases: ['iifl account', 'iifl'] },
  { key: 'model_portfolio', label: 'Model Portfolio', type: 'text', aliases: ['model portfolio'] },

  { key: 'tag', label: 'Tag', type: 'text', aliases: ['tag', 'tags', 'label'] },
  { key: 'age_in_years', label: 'Age (years)', type: 'text', aliases: ['age in yrs', 'age in years', 'age', 'age yrs'] },
  { key: 'description', label: 'Description', type: 'text', aliases: ['description', 'notes', 'remarks'] },
];

// The coercion and guessing rules are identical to the claim importer's, so
// they live there and are reused rather than copied.
export { guessMapping as guessClientMappingBase, toDate, toNumber, toPhone } from './claimImportFields.js';

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function guessClientMapping(headers) {
  const byNorm = new Map();
  for (const h of headers) if (h && !byNorm.has(norm(h))) byNorm.set(norm(h), h);
  const map = {};
  for (const f of CLIENT_IMPORT_FIELDS) {
    const candidates = [f.label, f.key.replace(/_/g, ' '), ...(f.aliases || [])];
    const hit = candidates.map(norm).find((c) => byNorm.has(c));
    if (hit) map[f.key] = byNorm.get(hit);
  }
  return map;
}

/**
 * Applies the mapping to one row. Salutation / first / last are folded into
 * the single client_name this CRM keeps, unless the sheet already has a whole
 * name — in which case that wins, since it's the more complete value.
 */
export function rowToClient(row, mapping, toDateFn, toPhoneFn) {
  const out = {};
  for (const f of CLIENT_IMPORT_FIELDS) {
    const col = mapping[f.key];
    if (!col) continue;
    const raw = row[col];
    if (raw === undefined || raw === null || raw === '') continue;
    out[f.key] = f.type === 'date' ? toDateFn(raw) : f.type === 'phone' ? toPhoneFn(raw) : String(raw).trim();
  }
  const whole = (out.client_name || '').trim();
  if (!whole) {
    const joined = [out.salutation, out.first_name, out.last_name].filter(Boolean).join(' ').trim();
    if (joined) out.client_name = joined;
  }
  // first_name / last_name exist only to build the name; they aren't columns.
  delete out.first_name;
  delete out.last_name;

  // The nominee columns become one entry in the client's nominee list, the
  // shape the client form and detail page already read.
  const nomineeKeys = ['nominee_name', 'nominee_dob', 'nominee_relation', 'nominee_share_pct', 'nominee_mobile'];
  if (nomineeKeys.some((k) => out[k])) {
    out.nominees = [{
      name: out.nominee_name || '', relation: out.nominee_relation || '',
      dob: out.nominee_dob || '', share_pct: out.nominee_share_pct || '', mobile: out.nominee_mobile || '',
    }];
  }
  for (const k of nomineeKeys) delete out[k];
  return out;
}
