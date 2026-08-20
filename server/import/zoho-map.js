// Field mapping and value coercion for the one-off Zoho CRM migration.
//
// Zoho's CSV export headers vary by org (renamed fields, custom modules), so
// every target column lists several candidate headers instead of one. Matching
// is done on a normalised form (lowercase, alphanumerics only), which makes it
// immune to the spacing and punctuation differences between exports.
//
// Nothing here guesses at a relationship. When a lookup can't be resolved to
// exactly one record the importer stores the display name and reports it,
// rather than attaching the row to the wrong client.

import { departmentForProduct, departmentForClaimType } from '../departments.js';

/** Header/value normaliser: "Mailing  Zip" and "mailing_zip" both become "mailingzip". */
export const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const digits = (s) => String(s ?? '').replace(/\D/g, '');
const trim = (s) => String(s ?? '').trim();

/* ------------------------------------------------------------------ dates */

/**
 * Works out whether a column of dates is day-first or month-first by looking
 * for a value that can only be read one way (a 13+ in either position).
 *
 * This matters more than it looks: "03/04/2025" is a valid date under both
 * readings, so a wrong guess silently shifts dates by months across the whole
 * migration and nothing ever errors. The importer refuses to run on
 * AMBIGUOUS or CONFLICT and asks for --date-format instead of picking.
 */
export function sniffDateFormat(samples) {
  let dayFirst = false, monthFirst = false, iso = false, seen = false;
  for (const raw of samples) {
    const m = trim(raw).match(/^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})/);
    if (!m) continue;
    seen = true;
    if (m[1].length === 4) { iso = true; continue; }
    const a = +m[1], b = +m[2];
    if (a > 12 && b <= 12) dayFirst = true;
    else if (b > 12 && a <= 12) monthFirst = true;
  }
  if (!seen) return 'NONE';
  if (dayFirst && monthFirst) return 'CONFLICT';   // the column mixes both — needs a human
  if (dayFirst) return 'DMY';
  if (monthFirst) return 'MDY';
  if (iso) return 'ISO';
  return 'AMBIGUOUS';                              // every value reads both ways
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** Returns "YYYY-MM-DD", or null if the value isn't a date we recognise. */
export function parseDate(value, fmt = 'DMY') {
  const s = trim(value);
  if (!s) return null;

  // ISO / Zoho datetime: 2025-01-05, 2025-01-05T14:30:00+05:30
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);

  // "Jan 5, 2025" / "5 Jan 2025"
  m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return iso(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return iso(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);

  // Numeric, read according to the sniffed/forced format.
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += y < 70 ? 2000 : 1900;   // 2-digit years: 00-69 => 2000s
    const [d, mo] = fmt === 'MDY' ? [+m[2], +m[1]] : [+m[1], +m[2]];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return iso(y, mo, d);
  }
  return null;
}

/** Splits a Zoho datetime into { date: "YYYY-MM-DD", time: "HH:MM" }. */
export function parseDateTime(value, fmt = 'DMY') {
  const s = trim(value);
  if (!s) return { date: null, time: null };
  const date = parseDate(s, fmt);

  let time = null;
  const m = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/);
  if (m) {
    let h = +m[1];
    const ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    time = `${pad(h)}:${m[2]}`;
  }
  return { date, time };
}

/* ----------------------------------------------------------------- values */

/** Indian mobiles are stored bare (10 digits) throughout this CRM. */
export function normPhone(value) {
  const d = digits(value);
  if (!d) return '';
  if (d.length === 10) return d;
  if (d.length > 10 && d.length <= 13) return d.slice(-10);  // strip 91 / 091 / +91
  return d;                                                   // keep anything unusual intact
}

export const normEmail = (v) => trim(v).toLowerCase();

/** Money/number columns arrive as "Rs. 12,500.00" often enough to matter. */
export function normNumber(value) {
  const s = trim(value).replace(/[^0-9.\-]/g, '');
  if (!s || s === '-' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Maps a Zoho picklist value onto the CRM's option list.
 * Unknown values are kept verbatim (never blanked — losing data is worse than
 * an off-list value) and reported so they can be added or corrected.
 */
export function mapEnum(value, allowed, synonyms = {}) {
  const s = trim(value);
  if (!s) return { value: '', unknown: false };
  const syn = synonyms[norm(s)];
  if (syn !== undefined) return { value: syn, unknown: false };
  const hit = allowed.find((a) => norm(a) === norm(s));
  if (hit) return { value: hit, unknown: false };
  return { value: s, unknown: true };
}

/* --------------------------------------------------------- option tables */
// Kept in step with client/src/pages/*Constants.js.

const CLIENT_CATEGORIES = ['A', 'B', 'C', 'D'];
const CLIENT_STATUSES = ['Active', 'Inactive', 'Prospect', 'Dormant', 'Closed'];
const FAMILY_TYPES = ['Individual', 'Family Head', 'Family Member'];
const REVIEW_FREQUENCIES = ['Monthly', 'Quarterly', 'Half-Yearly', 'Yearly', 'On Renewal', 'None'];
const TASK_TYPES = ['Call', 'Email', 'Follow-up', 'Site Visit', 'Documentation', 'Payment Collection',
  'Policy Issuance', 'Claim Follow-up', 'Renewal Reminder', 'Other'];
const TASK_STATUSES = ['Not Started', 'In Progress', 'Waiting', 'Deferred', 'Completed', 'Cancelled'];
const TASK_PRIORITIES = ['Low', 'Medium', 'High'];
const MEETING_TYPES = ['New', 'Existing'];
const MEETING_STATUSES = ['Scheduled', 'Rescheduled', 'In Progress', 'Completed', 'Cancelled', 'No Show'];
const POLICY_STATUSES = ['Draft', 'In Progress', 'Issued', 'Completed', 'Lost', 'Cancelled'];
const INSURANCE_LINE_SYN = { generalinsurance: 'GI', general: 'GI', gi: 'GI', nonlife: 'GI',
  lifeinsurance: 'LI', life: 'LI', li: 'LI' };
const GI_PRODUCTS = ['Motor', 'Health', 'Super Top Up', 'SISO', 'Critical Illness', 'Group Health',
  'Personal Accident', 'Group Personal Accident', 'Workmen Compensation', 'Fire & Property',
  'Marine Cargo', 'Engineering', 'Liability', 'Householder', 'Travel', 'Other'];
const LI_PRODUCTS = ['Term', 'Endowment', 'ULIP', 'Money Back', 'Whole Life', 'Pension / Annuity',
  'Child Plan', 'Group Term Life', 'Other'];
const ALL_PRODUCTS = [...GI_PRODUCTS, ...LI_PRODUCTS];

// Zoho wording that differs from ours. Keys are normalised.
const STATUS_SYN = {
  open: 'Not Started', notstarted: 'Not Started', inprogress: 'In Progress',
  completed: 'Completed', closed: 'Completed', done: 'Completed',
  deferred: 'Deferred', waiting: 'Waiting', waitingoninput: 'Waiting', cancelled: 'Cancelled', canceled: 'Cancelled',
};
const CLIENT_STATUS_SYN = { active: 'Active', inactive: 'Inactive', prospect: 'Prospect',
  lead: 'Prospect', dormant: 'Dormant', closed: 'Closed', lost: 'Closed' };
const PRODUCT_SYN = {
  motorinsurance: 'Motor', vehicle: 'Motor', car: 'Motor', twowheeler: 'Motor',
  healthinsurance: 'Health', mediclaim: 'Health', supertopup: 'Super Top Up', topup: 'Super Top Up',
  criticalillness: 'Critical Illness', personalaccident: 'Personal Accident', pa: 'Personal Accident',
  fire: 'Fire & Property', fireproperty: 'Fire & Property', marine: 'Marine Cargo',
  workmencompensation: 'Workmen Compensation', wc: 'Workmen Compensation', wcpolicy: 'Workmen Compensation',
  travelinsurance: 'Travel', householderpolicy: 'Householder', termplan: 'Term', termlife: 'Term',
  ulipplan: 'ULIP', moneyback: 'Money Back', wholelife: 'Whole Life', pension: 'Pension / Annuity',
  annuity: 'Pension / Annuity', childplan: 'Child Plan',
};

/* ---------------------------------------------------------------- modules */
// Order is load-bearing: each module may reference the ones above it.

export const MODULES = [
  {
    key: 'clients',
    label: 'Clients',
    table: 'clients',
    zohoModule: 'Contacts',
    // Used to spot a re-import when the export has no Record Id column.
    naturalKey: (r) => `${norm(r.client_name)}|${digits(r.mobile)}`,
    fields: [
      { col: 'client_name', from: ['Client Name', 'Contact Name', 'Full Name', 'Name', 'Account Name'],
        compose: ['First Name', 'Last Name'], required: true },
      { col: 'mobile', from: ['Mobile', 'Mobile No', 'Phone', 'Contact Number'], type: 'phone' },
      { col: 'email', from: ['Email', 'Email ID', 'Primary Email'], type: 'email' },
      { col: 'client_category', from: ['Client Category', 'Category', 'Rating'], enum: CLIENT_CATEGORIES },
      { col: 'client_status', from: ['Client Status', 'Status'], enum: CLIENT_STATUSES, synonyms: CLIENT_STATUS_SYN, default: 'Active' },
      { col: 'owner', from: ['Client Owner', 'Contact Owner', 'Owner', 'Record Owner'] },
      { col: 'lead_source', from: ['Lead Source', 'Source'] },
      { col: 'onboarding_date', from: ['Date of Onboarding', 'Onboarding Date', 'Created Time'], type: 'date' },
      { col: 'dob', from: ['Date of Birth', 'DOB', 'Birth Date'], type: 'date' },
      { col: 'anniversary', from: ['Anniversary', 'Wedding Anniversary'], type: 'date' },
      { col: 'pan_no', from: ['PAN', 'PAN No', 'PAN Card No', 'Pan Number'] },
      { col: 'aadhar_no', from: ['Aadhar', 'Aadhar No', 'Aadhar Card No', 'Aadhaar No'] },
      { col: 'occupation', from: ['Profession', 'Occupation', 'Title', 'Designation'] },
      { col: 'review_frequency', from: ['Review Frequency'], enum: REVIEW_FREQUENCIES },
      { col: 'family_type', from: ['Family or Individual', 'Family Type'], enum: FAMILY_TYPES, default: 'Individual' },
      { col: 'family_head_name', from: ['Family Head', 'Family Head Name'] },
      { col: 'referred_by_client_name', from: ['Referred By', 'Reffered Client Name', 'Referred Client Name', 'Referral'] },
      { col: 'group_head_name', from: ['Group Head Name', 'Group Head'] },
      { col: 'group_code', from: ['Group Code'] },
      { col: 'address', from: ['Address', 'Mailing Street', 'Street', 'Mailing Address'] },
      { col: 'city', from: ['City', 'Mailing City'] },
      { col: 'state', from: ['State', 'Mailing State'] },
      { col: 'pincode', from: ['Pincode', 'Pin Code', 'Mailing Zip', 'Zip Code', 'Zip'] },
      { col: 'country', from: ['Country', 'Mailing Country'], default: 'INDIA' },
      { col: 'created_at', from: ['Created Time', 'Created On'], type: 'date' },
    ],
    // Nominee details are flat in Zoho but stored as a JSON array here.
    post: (row, get) => {
      const name = get(['Nominee Name', 'Nominee']);
      if (!name) return;
      row.nominees = JSON.stringify([{
        name,
        relation: get(['Nominee Relation', 'Nominee Relationship']) || '',
        dob: '', share_pct: get(['Nominee Share', 'Nominee Percentage']) || '',
        mobile: normPhone(get(['Nominee Mobile'])) || '',
      }]);
    },
  },

  {
    key: 'policies',
    label: 'Policies',
    table: 'policies',
    zohoModule: 'Policies',
    naturalKey: (r) => norm(r.policy_number),
    fields: [
      { col: 'policy_number', from: ['Policy Number', 'Policy No', 'Policy #'], required: true },
      { col: 'insured_name', from: ['Insured Name', 'Client Name', 'Customer Name', 'Name'] },
      { col: 'insurance_line', from: ['Insurance Line', 'Line of Business', 'LOB', 'Insurance Category'],
        enum: ['GI', 'LI'], synonyms: INSURANCE_LINE_SYN },
      { col: 'insurance_type', from: ['Product', 'Product Name', 'Insurance Type', 'Policy Category'],
        enum: ALL_PRODUCTS, synonyms: PRODUCT_SYN },
      { col: 'policy_type', from: ['Policy Type', 'Type of Policy', 'Nature of Business'] },
      { col: 'product_name', from: ['Plan Name', 'Scheme Name'] },
      { col: 'company_name', from: ['Insurance Company', 'Company Name', 'Insurer'] },
      { col: 'policy_status', from: ['Policy Status', 'Status'], enum: POLICY_STATUSES },
      { col: 'active_status', from: ['Active Status'], enum: ['Active', 'Inactive'] },
      { col: 'renewable', from: ['Renewable'], enum: ['Yes', 'No'] },
      { col: 'policy_with_us', from: ['Policy With Us'], enum: ['Yes', 'No'] },
      { col: 'period_from', from: ['Period From', 'Policy Start Date', 'Start Date', 'Risk Start Date'], type: 'date' },
      { col: 'period_to', from: ['Period To', 'Policy End Date', 'End Date', 'Expiry Date', 'Renewal Date'], type: 'date' },
      { col: 'login_date', from: ['Login Date'], type: 'date' },
      { col: 'commencement_date', from: ['Commencement Date', 'Date of Commencement'], type: 'date' },
      { col: 'maturity_date', from: ['Maturity Date'], type: 'date' },
      { col: 'sum_assured', from: ['Sum Assured', 'IDV', 'Sum Insured'], type: 'number' },
      { col: 'net_premium', from: ['Net Premium', 'Basic Premium'], type: 'number' },
      { col: 'gst_amount', from: ['GST', 'GST Amount', 'Tax Amount', 'Service Tax'], type: 'number' },
      { col: 'final_premium', from: ['Final Premium', 'Gross Premium', 'Total Premium', 'Premium'], type: 'number' },
      { col: 'total_amount', from: ['Total Amount'], type: 'number' },
      { col: 'currency', from: ['Currency'], default: 'INR' },
      { col: 'policy_mode', from: ['Premium Mode', 'Policy Mode', 'Mode'] },
      { col: 'term_years', from: ['Policy Term', 'Term'], type: 'number' },
      { col: 'ppt_years', from: ['PPT', 'Premium Paying Term'], type: 'number' },
      { col: 'reg_no', from: ['Registration Number', 'Vehicle Number', 'Reg No', 'Vehicle No'] },
      { col: 'nominee_name', from: ['Nominee Name', 'Nominee'] },
      { col: 'nominee_relation', from: ['Nominee Relation', 'Nominee Relationship'] },
      { col: 'nominee_age', from: ['Nominee Age'], type: 'number' },
      { col: 'agency_name', from: ['Agency Name', 'Agency'] },
      { col: 'ba_name', from: ['BA Name', 'Business Associate'] },
      { col: 'sm_name', from: ['SM Name', 'Sales Manager'] },
      { col: 'assigned_to', from: ['Policy Owner', 'Owner', 'Assigned To'] },
      { col: 'payment_type', from: ['Payment Mode', 'Payment Type'] },
      { col: 'payment_ref', from: ['Payment Reference', 'Cheque No', 'Transaction ID'] },
      { col: 'payment_date', from: ['Payment Date'], type: 'date' },
      { col: 'remarks', from: ['Remarks', 'Description', 'Notes'] },
      { col: 'created_at', from: ['Created Time', 'Created On'], type: 'date' },
    ],
    // Client link, then the Personal/Commercial split the rest of the CRM
    // keys access control off.
    links: [{ col: 'client_id', nameCol: 'group_head_name', target: 'clients',
      from: ['Client Name', 'Client', 'Contact Name', 'Customer Name', 'Insured Name'] }],
    post: (row) => { row.department = departmentForProduct(row.insurance_type || ''); },
  },

  {
    key: 'claims',
    label: 'Claims',
    table: 'claims',
    zohoModule: 'Claims',
    naturalKey: (r) => norm(r.claim_no) || `${norm(r.claim_title)}|${r.claim_date || ''}`,
    fields: [
      { col: 'claim_no', from: ['Claim Number', 'Claim No', 'Claim #'] },
      { col: 'claim_title', from: ['Claim Title', 'Subject', 'Name', 'Claim Name'] },
      { col: 'claim_type', from: ['Claim Type', 'Type of Claim', 'Product'], enum: ALL_PRODUCTS, synonyms: PRODUCT_SYN },
      { col: 'claim_category', from: ['Claim Category', 'Category'] },
      { col: 'policy_no', from: ['Policy Number', 'Policy No'] },
      { col: 'policy_type', from: ['Policy Type'] },
      { col: 'client_name', from: ['Client Name', 'Insured Name', 'Customer Name'] },
      { col: 'company_name', from: ['Insurance Company', 'Company Name', 'Insurer'] },
      { col: 'status', from: ['Claim Status', 'Status'] },
      { col: 'claim_date', from: ['Claim Date', 'Date of Loss', 'Loss Date', 'Incident Date'], type: 'date' },
      { col: 'intimation_no', from: ['Intimation Number', 'Intimation No'] },
      { col: 'claim_amount', from: ['Claim Amount', 'Claimed Amount'], type: 'number' },
      { col: 'approved_amount', from: ['Approved Amount'], type: 'number' },
      { col: 'settlement_amount', from: ['Settlement Amount', 'Settled Amount'], type: 'number' },
      { col: 'deduction', from: ['Deduction', 'Deductions'], type: 'number' },
      { col: 'approval_date', from: ['Approval Date'], type: 'date' },
      { col: 'settlement_date', from: ['Settlement Date'], type: 'date' },
      { col: 'file_received_date', from: ['File Received Date'], type: 'date' },
      { col: 'process_date', from: ['Process Date', 'Processing Date'], type: 'date' },
      { col: 'survey_date', from: ['Survey Date'], type: 'date' },
      { col: 'surveyor_name', from: ['Surveyor Name', 'Surveyor'] },
      { col: 'vehicle_no', from: ['Vehicle Number', 'Vehicle No', 'Registration Number'] },
      { col: 'patient_name', from: ['Patient Name'] },
      { col: 'doctor_name', from: ['Doctor Name'] },
      { col: 'hospital_name', from: ['Hospital Name', 'Hospital'] },
      { col: 'admission_date', from: ['Admission Date', 'Date of Admission'], type: 'date' },
      { col: 'discharge_date', from: ['Discharge Date', 'Date of Discharge'], type: 'date' },
      { col: 'owner', from: ['Claim Owner', 'Owner', 'Assigned To'] },
      { col: 'remarks', from: ['Remarks', 'Description', 'Notes'] },
      { col: 'created_at', from: ['Created Time', 'Created On'], type: 'date' },
    ],
    links: [
      { col: 'client_id', nameCol: 'client_name', target: 'clients',
        from: ['Client Name', 'Insured Name', 'Customer Name', 'Contact Name'] },
      { col: 'policy_id', nameCol: null, target: 'policies', matchOn: 'policy_number',
        from: ['Policy Number', 'Policy No'] },
    ],
    post: (row) => { row.department = departmentForClaimType(row.claim_type || ''); },
  },

  {
    key: 'tasks',
    label: 'Tasks',
    table: 'tasks',
    zohoModule: 'Tasks',
    naturalKey: (r) => `${norm(r.title)}|${r.due_date || ''}`,
    fields: [
      { col: 'title', from: ['Subject', 'Task Subject', 'Title', 'Task Name'], required: true },
      { col: 'task_type', from: ['Task Type', 'Type', 'Activity Type'], enum: TASK_TYPES },
      { col: 'status', from: ['Status', 'Task Status'], enum: TASK_STATUSES, synonyms: STATUS_SYN, default: 'Not Started' },
      { col: 'priority', from: ['Priority'], enum: TASK_PRIORITIES, default: 'Medium' },
      { col: 'assigned_to', from: ['Task Owner', 'Assigned To', 'Owner'] },
      { col: 'assigned_by', from: ['Assigned By', 'Created By'] },
      { col: 'start_date', from: ['Start Date', 'Start DateTime'], type: 'date' },
      { col: 'due_date', from: ['Due Date', 'End Date'], type: 'date' },
      { col: 'remarks', from: ['Description', 'Remarks', 'Notes'] },
      { col: 'created_at', from: ['Created Time', 'Created On'], type: 'date' },
    ],
    // "Task For" is polymorphic here (client or lead), so the link resolver
    // writes related_kind alongside related_id.
    links: [{ col: 'related_id', kindCol: 'related_kind', nameCol: 'related_name',
      target: 'clients', altTarget: 'leads',
      from: ['Task For', 'Related To', 'Contact Name', 'Client Name', 'Account Name'] }],
  },

  {
    key: 'meetings',
    label: 'Meetings',
    table: 'meetings',
    zohoModule: 'Meetings',
    naturalKey: (r) => `${norm(r.title)}|${r.from_date || ''}|${r.from_time || ''}`,
    fields: [
      { col: 'title', from: ['Title', 'Subject', 'Meeting Name', 'Event Title'], required: true },
      { col: 'meeting_type', from: ['Meeting Type', 'Type'], enum: MEETING_TYPES, default: 'New' },
      { col: 'location', from: ['Location', 'Venue'] },
      { col: 'status', from: ['Meeting Status', 'Status'], enum: MEETING_STATUSES, default: 'Scheduled' },
      { col: 'owner', from: ['Meeting Owner', 'Host', 'Owner', 'Organiser', 'Organizer'] },
      { col: 'minutes', from: ['Minutes of Meeting', 'Minutes', 'Description', 'Notes'] },
      { col: ['from_date', 'from_time'], from: ['From', 'Start DateTime', 'Start Time', 'From Date'], type: 'datetime' },
      { col: ['to_date', 'to_time'], from: ['To', 'End DateTime', 'End Time', 'To Date'], type: 'datetime' },
      { col: 'created_at', from: ['Created Time', 'Created On'], type: 'date' },
    ],
    // Participants land in meeting_participants; the importer resolves each
    // name against clients then leads, and keeps unmatched ones as plain names.
    participantsFrom: ['Participants', 'Attendees', 'Invitees', 'Contact Name'],
  },
];

export const moduleByKey = (k) => MODULES.find((m) => m.key === k);
