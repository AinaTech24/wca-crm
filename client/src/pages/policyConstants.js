// Field visibility is driven by Type (GI/LI) and then by the product, so the
// form only ever shows what applies to the policy being written. The server
// mirrors these rules and blanks hidden fields (see policyPayload), so
// switching a policy's type can't leave stale invisible values behind.

export const INSURANCE_LINES = [
  { v: 'GI', label: 'General Insurance' },
  { v: 'LI', label: 'Life Insurance' },
];

// "Policy" — the product category, per line.
export const PRODUCTS = {
  GI: ['Motor', 'Health', 'Group Health', 'Personal Accident', 'Group Personal Accident',
    'Workmen Compensation', 'Fire & Property', 'Marine Cargo', 'Engineering', 'Liability',
    'Householder', 'Travel', 'Other'],
  LI: ['Term', 'Endowment', 'ULIP', 'Money Back', 'Whole Life', 'Pension / Annuity',
    'Child Plan', 'Group Term Life', 'Other'],
};

// "Policy Type" — the variant, per product. Anything not listed falls back to
// the generic nature of business.
const GENERIC_POLICY_TYPES = ['Fresh', 'Renewal', 'Rollover', 'Portability'];
export const POLICY_TYPES = {
  Motor: ['Package (Comprehensive)', 'Own Damage Only', 'Third Party Only', 'Bundled (1+3)', 'Bundled (1+5)'],
  Health: ['Individual', 'Family Floater', 'Top-up', 'Super Top-up'],
  'Group Health': ['Group Mediclaim', 'Group Floater'],
  'Fire & Property': ['Standard Fire & Special Perils', 'Burglary', 'Bharat Griha Raksha'],
  'Marine Cargo': ['Open Policy (Annual)', 'Single Transit', 'Sales Turnover Policy'],
  Engineering: ['Contractors All Risks (CAR)', 'Erection All Risks (EAR)', 'Machinery Breakdown'],
  Liability: ['Professional Indemnity', 'Public Liability', 'Product Liability', 'D&O'],
  Term: ['Level Term', 'Increasing Term', 'Return of Premium'],
  Endowment: ['With Profit', 'Without Profit'],
  ULIP: ['Equity', 'Balanced', 'Debt'],
};
export const policyTypesFor = (product) => POLICY_TYPES[product] || GENERIC_POLICY_TYPES;

export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED'];
// Premium frequency — a life-side concept.
export const POLICY_MODES = ['Single', 'Monthly', 'Quarterly', 'Half-Yearly', 'Yearly'];
export const PAYMENT_MODES = ['Cash', 'Cheque', 'NEFT / RTGS', 'UPI', 'Credit Card', 'Debit Card', 'Online', 'Auto Debit'];

export const POLICY_STATUSES = ['Draft', 'In Progress', 'Issued', 'Completed', 'Lost', 'Cancelled'];
export const POLICY_STATUS_BADGE = {
  Draft: '', 'In Progress': 'orange', Issued: 'blue', Completed: 'green', Lost: 'red', Cancelled: 'red',
};
export const ACTIVE_STATUSES = ['Active', 'Inactive'];
export const POLICY_WITH_US = ['Yes', 'No'];
export const NOMINEE_RELATIONS = ['Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Brother', 'Sister', 'Other'];
export const NCB_PCTS = ['0', '20', '25', '35', '45', '50'];

/* ---- the visibility rules, in one place ---- */
export const isLife = (f) => f.insurance_line === 'LI';
export const isMotor = (f) => !isLife(f) && f.insurance_type === 'Motor';
export const isHealth = (f) => !isLife(f) && ['Health', 'Group Health'].includes(f.insurance_type);
export const isLost = (f) => f.policy_with_us === 'No';
// INR is the base currency, so its rate is fixed at 1 and not editable.
export const rateEditable = (f) => (f.currency || 'INR') !== 'INR';
// Sum Assured is called IDV on a motor policy.
export const sumAssuredLabel = (f) => (isMotor(f) ? 'IDV (Insured Declared Value)' : 'Sum Assured');

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const emptyPolicy = () => ({
  product_name: '', insured_name: '', client_id: null, client_email: '',
  insurance_line: 'GI', insurance_type: '', policy_type: '',
  company_name: '', policy_number: '', login_date: todayISO(), associate: '', assigned_to: '',
  currency: 'INR', exchange_rate: 1, policy_mode: '', term_years: '', ppt_years: '',
  sum_assured: '', net_premium: '', gst_amount: '', final_premium: '', cumulative_bonus: '',
  period_from: '', period_to: '', commencement_date: '', maturity_date: '',
  nominee_name: '', nominee_age: '', nominee_relation: '',
  reg_no: '', ncb_pct: '', members_covered: '', room_rent: '', ped_waiting: '',
  payment_type: '', policy_with_us: '', lost_reason: '',
  policy_status: 'Draft', active_status: 'Active',
  policy_doc: '', policy_doc_name: '', remarks: '',
});

export const inr = (v) => Number(v || 0).toLocaleString('en-IN');
