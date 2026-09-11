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
  group_head_name: '', group_code: '', anniversary: '',
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
