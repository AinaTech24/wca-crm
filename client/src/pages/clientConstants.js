// A/B/C/D grading — the usual "how valuable is this relationship" tiering.
export const CLIENT_CATEGORIES = ['A', 'B', 'C', 'D'];
export const CATEGORY_BADGE = { A: 'green', B: 'blue', C: 'orange', D: '' };

export const CLIENT_STATUSES = ['Active', 'Inactive', 'Prospect', 'Dormant', 'Closed'];
export const CLIENT_STATUS_BADGE = {
  Active: 'green', Prospect: 'blue', Inactive: 'orange', Dormant: 'orange', Closed: 'red',
};

// An Individual has no family link; the other two do (a Member must name a
// head, a Head may optionally sit under a senior head).
export const FAMILY_TYPES = ['Individual', 'Family Head', 'Family Member'];
export const inFamily = (t) => t === 'Family Head' || t === 'Family Member';

export const REVIEW_FREQUENCIES = ['Monthly', 'Quarterly', 'Half-Yearly', 'Yearly', 'On Renewal', 'None'];
// Product interests. Yes/No for most; the few that are a plan choice rather
// than a yes-or-no keep their own options.
export const BUSINESS_FIELDS = [
  { key: 'sip', label: 'SIP' },
  { key: 'lumpsum', label: 'Lumpsum' },
  { key: 'life_insurance', label: 'Life Insurance' },
  { key: 'super_top_up', label: 'Super Top Up' },
  { key: 'personal_accident', label: 'Personal Accident' },
  { key: 'health_insurance', label: 'Health Insurance' },
  { key: 'ulip', label: 'ULIP' },
  { key: 'travel_insurance', label: 'Travel Insurance' },
  { key: 'siso', label: 'SISO' },
  { key: 'corporate_insurance', label: 'Corporate Insurance' },
  { key: 'vehicle_insurance', label: 'Vehicle Insurance' },
  { key: 'pms', label: 'PMS' },
  { key: 'critical_illness', label: 'Critical Illness' },
  { key: 'goal_gps', label: 'Goal GPS' },
  { key: 'demat_account', label: 'Demat Account' },
  { key: 'fhp_qualified', label: 'FHP Qualified' },
  { key: 'iifl_account', label: 'IIFL Account' },
  { key: 'model_portfolio', label: 'Model Portfolio' },
];
export const YES_NO = ['No', 'Yes'];
export const SALUTATIONS = ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'M/s'];
export const RISK_PROFILES = ['Conservative', 'Moderately Conservative', 'Moderate', 'Moderately Aggressive', 'Aggressive'];
export const CLIENT_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED'];
export const FILE_EMAIL_OPTS = ['File', 'Email', 'Both'];

export const NOMINEE_RELATIONS = ['Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Brother', 'Sister', 'Other'];

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const EMPTY_NOMINEE = { name: '', relation: '', dob: '', share_pct: '', mobile: '' };

export const emptyClient = () => ({
  client_name: '', mobile: '', email: '',
  client_category: '', owner: '', client_status: 'Active',
  lead_source: '', lead_id: null,
  referred_by_client_id: null, referred_by_client_name: '',
  onboarding_date: todayISO(),
  family_type: 'Individual', family_head_id: null, family_head_name: '',
  aadhar_no: '', pan_no: '', gstin: '', dob: '', occupation: '', review_frequency: '',
  nominees: [],
  address: '', city: '', state: '', pincode: '', country: 'INDIA',
  group_head_name: '', group_code: '', anniversary: '', tag: '', age_in_years: '',
  // Identifiers carried from the other systems this office runs.
  salutation: '', can_iin_no: '', finnsys_id: '', added_by: '', risk_profile: '',
  company_name: '', social_lead_id: '', client_code: '', client_record_id: '',
  tin_number: '', tin_updated: '', file_email: '', send_goal_sheet: 'No',
  currency: 'INR', exchange_rate: '1',
  guardian_name: '', nominee_minor_guardian: '',
  other_city: '', other_state: '', other_zip: '', other_country: '', courier_ok: '',
  // One per product line, so "who has no health cover" is a query rather than a read-through.
  ...Object.fromEntries(BUSINESS_FIELDS.map((b) => [b.key, 'No'])),
  description: '',
});

// Nominee shares shouldn't quietly exceed 100% — surfaced as a warning
// rather than a hard block, since a part-filled form is a normal in-between
// state while typing.
export const nomineeShareTotal = (list) =>
  (list || []).reduce((sum, n) => sum + (Number(n.share_pct) || 0), 0);

export const parseNominees = (v) => {
  if (Array.isArray(v)) return v;
  try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
};
