// Client onboarding forms — one per kind of policy. Each form is a list of sections; each field says what
// it asks, how it is answered and, where it belongs on the client record, which column it fills (`map`).
// The same definition draws the public form, checks a submission and shows the answers in the CRM.
//
// Field types: text, email, tel, date, number, select, yesno, textarea, file, repeat (a table of rows —
// family members, travellers, nominees), declaration (the consent tick).
// `show: ['field', 'Yes']` shows a field only when another field has that answer.

const yes = (k) => ['show', [k, 'Yes']];
const f = (k, label, type = 'text', extra = {}) => ({ k, label, type, ...extra });
const GENDER = ['Male', 'Female', 'Other'];
const RELATION = ['Self', 'Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Father-in-law', 'Mother-in-law', 'Brother', 'Sister', 'Other'];
const INCOME = ['Below ₹5 lakh', '₹5–10 lakh', '₹10–25 lakh', '₹25–50 lakh', '₹50 lakh–1 crore', 'Above ₹1 crore'];
const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman & Nicobar', 'Chandigarh', 'Dadra & Nagar Haveli and Daman & Diu', 'Delhi', 'Jammu & Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'];

// ---------- building blocks ----------
const you = (title = 'Your details') => ({
  title, icon: 'user', fields: [
    f('full_name', 'Full name (as on PAN)', 'text', { req: true }),
    f('dob', 'Date of birth', 'date', { req: true, map: 'dob' }),
    f('gender', 'Gender', 'select', { options: GENDER, req: true }),
    f('marital_status', 'Marital status', 'select', { options: ['Single', 'Married', 'Widowed', 'Divorced'] }),
    f('mobile', 'Mobile number', 'tel', { req: true, map: 'mobile' }),
    f('email', 'Email', 'email', { req: true, map: 'email' }),
    f('pan', 'PAN number', 'text', { req: true, map: 'pan_no', pattern: 'pan' }),
    f('aadhaar', 'Aadhaar number', 'text', { map: 'aadhar_no', pattern: 'aadhaar' }),
    f('occupation', 'Occupation', 'text', { req: true, map: 'occupation' }),
    f('income', 'Annual income', 'select', { options: INCOME }),
  ],
});
const address = (title = 'Address') => ({
  title, icon: 'building', fields: [
    f('address', 'Address (house, street, area)', 'textarea', { req: true, map: 'address' }),
    f('city', 'City', 'text', { req: true, map: 'city' }),
    f('state', 'State', 'select', { options: STATES, req: true, map: 'state' }),
    f('pincode', 'PIN code', 'text', { req: true, map: 'pincode', pattern: 'pincode' }),
  ],
});
const nominee = (title = 'Nominee') => ({
  title, icon: 'users', help: 'The person who receives the claim amount if something happens to you.', fields: [
    f('nominee_name', 'Nominee name', 'text', { req: true }),
    f('nominee_relation', 'Relationship with you', 'select', { options: RELATION.filter((r) => r !== 'Self'), req: true }),
    f('nominee_dob', 'Nominee date of birth', 'date'),
  ],
});
const company = (title = 'Company details') => ({
  title, icon: 'building', fields: [
    f('company_name', 'Company / firm name', 'text', { req: true, map: 'company_name' }),
    f('gstin', 'GSTIN', 'text', { map: 'gstin', pattern: 'gstin' }),
    f('company_pan', 'Company PAN', 'text', { req: true, map: 'pan_no', pattern: 'pan' }),
    f('cin', 'CIN / registration number'),
    f('industry', 'Nature of business', 'text', { req: true }),
    f('contact_person', 'Contact person', 'text', { req: true }),
    f('designation', 'Designation'),
    f('mobile', 'Mobile number', 'tel', { req: true, map: 'mobile' }),
    f('email', 'Email', 'email', { req: true, map: 'email' }),
    f('address', 'Registered address', 'textarea', { req: true, map: 'address' }),
    f('city', 'City', 'text', { req: true, map: 'city' }),
    f('state', 'State', 'select', { options: STATES, req: true, map: 'state' }),
    f('pincode', 'PIN code', 'text', { req: true, map: 'pincode', pattern: 'pincode' }),
  ],
});
const health = (title = 'Health of the person insured') => ({
  title, icon: 'shieldcheck', help: 'Please answer honestly — anything not declared now can lead to a claim being refused later.', fields: [
    f('height_cm', 'Height (cm)', 'number', { req: true }),
    f('weight_kg', 'Weight (kg)', 'number', { req: true }),
    f('ped', 'Any illness or condition you already have (diabetes, BP, thyroid, heart, etc.)?', 'yesno', { req: true }),
    f('ped_details', 'Which condition, since when, and the medicines you take', 'textarea', { req: true, show: ['ped', 'Yes'] }),
    f('hospitalised', 'Hospitalised or operated in the last 4 years?', 'yesno', { req: true }),
    f('hospital_details', 'When, and for what', 'textarea', { req: true, show: ['hospitalised', 'Yes'] }),
    f('tobacco', 'Do you use tobacco in any form?', 'yesno', { req: true }),
    f('alcohol', 'Do you drink alcohol regularly?', 'yesno'),
  ],
});
const member = (extra = []) => [
  f('name', 'Name', 'text', { req: true }),
  f('relation', 'Relation', 'select', { options: RELATION, req: true }),
  f('dob', 'Date of birth', 'date', { req: true }),
  f('gender', 'Gender', 'select', { options: GENDER, req: true }),
  f('height_cm', 'Height (cm)', 'number'),
  f('weight_kg', 'Weight (kg)', 'number'),
  f('ped', 'Existing illness?', 'yesno', { req: true }),
  f('ped_details', 'Illness details', 'text', { show: ['ped', 'Yes'], req: true }),
  f('tobacco', 'Tobacco?', 'yesno'),
  ...extra,
];
const priorHealth = () => ({
  title: 'Your current insurance', icon: 'file', fields: [
    f('has_policy', 'Do you have a health policy today (personal or from an employer)?', 'yesno', { req: true }),
    f('prev_insurer', 'Insurer', 'text', { show: ['has_policy', 'Yes'], req: true }),
    f('prev_policy_no', 'Policy number', 'text', { show: ['has_policy', 'Yes'] }),
    f('prev_si', 'Sum insured (₹)', 'number', { show: ['has_policy', 'Yes'] }),
    f('insured_since', 'Insured continuously since', 'date', { show: ['has_policy', 'Yes'] }),
    f('prev_claims', 'Any claim made on it?', 'yesno', { show: ['has_policy', 'Yes'] }),
    f('prev_claim_details', 'Claim details', 'textarea', { show: ['prev_claims', 'Yes'] }),
  ],
});
const docs = (list) => ({ title: 'Documents', icon: 'upload', help: 'PDF or a clear photo, up to 6 MB each.', fields: list });
const D = {
  pan: f('doc_pan', 'PAN card', 'file', { req: true }),
  aadhaar: f('doc_aadhaar', 'Aadhaar card (front & back)', 'file', { req: true }),
  photo: f('doc_photo', 'Recent photograph', 'file'),
  prevPolicy: f('doc_prev_policy', 'Current / previous policy copy', 'file'),
  medical: f('doc_medical', 'Medical reports / prescriptions (if any)', 'file'),
  gst: f('doc_gst', 'GST certificate', 'file'),
  companyPan: f('doc_company_pan', 'Company PAN card', 'file', { req: true }),
  cheque: f('doc_cheque', 'Cancelled cheque (for claim payouts)', 'file'),
};
const declaration = () => ({
  title: 'Declaration', icon: 'check', fields: [
    f('consent', 'I confirm that the information given above is true and complete to the best of my knowledge, and I authorise WeCare Assurance to share it with the insurer to issue my policy.', 'declaration', { req: true }),
    f('signed_by', 'Your full name (as your signature)', 'text', { req: true }),
  ],
});

// ---------- the forms ----------
export const FORMS = {
  'health-individual': {
    label: 'Health — Individual', group: 'Health', blurb: 'One person covered.',
    sections: [you(), address(), health(), priorHealth(), nominee(), docs([D.pan, D.aadhaar, D.prevPolicy, D.medical]), declaration()],
  },
  'health-floater': {
    label: 'Health — Family Floater', group: 'Health', blurb: 'One sum insured shared by the family.',
    sections: [you('Proposer — the person paying'), address(),
      { title: 'Family members to be covered', icon: 'users', help: 'Add everyone who should be covered, including yourself.', fields: [
        f('members', 'Members', 'repeat', { req: true, min: 2, max: 8, fields: member() }) ] },
      priorHealth(), nominee(), docs([D.pan, D.aadhaar, D.prevPolicy, D.medical]), declaration()],
  },
  'health-senior': {
    label: 'Health — Senior Citizen', group: 'Health', blurb: 'Cover for those aged 60 and above.',
    sections: [you('Details of the person insured'), address(), health(),
      { title: 'Recent medical history', icon: 'clipboard', fields: [
        f('last_checkup', 'Date of the last full health check-up', 'date'),
        f('regular_meds', 'Taking any medicines regularly?', 'yesno', { req: true }),
        f('meds_details', 'Which medicines, and for what', 'textarea', { show: ['regular_meds', 'Yes'], req: true }),
        f('pre_medical_ok', 'Willing to take a pre-policy medical check-up if the insurer asks?', 'yesno', { req: true }) ] },
      priorHealth(), nominee(), docs([D.pan, D.aadhaar, D.prevPolicy, { ...D.medical, req: true }]), declaration()],
  },
  'health-topup': {
    label: 'Health — Super Top-up', group: 'Health', blurb: 'Extra cover above an existing policy.',
    sections: [you(), address(),
      { title: 'Members to be covered', icon: 'users', fields: [f('members', 'Members', 'repeat', { req: true, min: 1, max: 8, fields: member() })] },
      { title: 'Your base policy', icon: 'file', help: 'The policy this top-up sits on.', fields: [
        f('base_insurer', 'Base policy insurer', 'text', { req: true }),
        f('base_si', 'Base sum insured (₹)', 'number', { req: true }),
        f('deductible', 'Deductible you chose (₹)', 'number', { req: true }),
        f('base_employer', 'Is the base policy from your employer?', 'yesno') ] },
      nominee(), docs([D.pan, D.aadhaar, { ...D.prevPolicy, label: 'Base policy copy', req: true }, D.medical]), declaration()],
  },
  'group-health': {
    label: 'Group Health (Employees)', group: 'Commercial', blurb: 'Mediclaim for a company’s employees.',
    sections: [company(),
      { title: 'Cover', icon: 'users', fields: [
        f('employees', 'Number of employees', 'number', { req: true }),
        f('family_definition', 'Who is covered', 'select', { req: true, options: ['Employee only', 'Employee + spouse', 'Employee + spouse + 2 children', 'Employee + spouse + children + parents'] }),
        f('si_structure', 'Sum insured (flat, or by grade)', 'textarea', { req: true }),
        f('maternity', 'Maternity cover needed?', 'yesno'),
        f('hr_contact', 'HR contact for endorsements (name, mobile, email)', 'textarea') ] },
      { title: 'Current policy', icon: 'file', fields: [
        f('has_policy', 'Is there a group policy today?', 'yesno', { req: true }),
        f('prev_insurer', 'Insurer', 'text', { show: ['has_policy', 'Yes'], req: true }),
        f('prev_expiry', 'Expiry date', 'date', { show: ['has_policy', 'Yes'] }),
        f('doc_claims', 'Claims data for the last 3 years', 'file', { show: ['has_policy', 'Yes'] }) ] },
      docs([f('doc_census', 'Employee list (name, DOB, gender, relation, sum insured)', 'file', { req: true }), D.companyPan, D.gst, D.prevPolicy]), declaration()],
  },
  'group-pa': {
    label: 'Group Personal Accident', group: 'Commercial', blurb: 'Accident cover for employees.',
    sections: [company(),
      { title: 'Cover', icon: 'users', fields: [
        f('employees', 'Number of employees', 'number', { req: true }),
        f('cover_basis', 'Sum insured basis', 'select', { req: true, options: ['Flat amount per employee', 'Multiple of annual salary', 'By grade'] }),
        f('cover_details', 'Amount / multiple / grade-wise details', 'textarea', { req: true }),
        f('work_nature', 'Nature of work (office / field / manual)', 'text') ] },
      docs([f('doc_census', 'Employee list (name, DOB, sum insured)', 'file', { req: true }), D.companyPan, D.gst, D.prevPolicy]), declaration()],
  },
  'group-term': {
    label: 'Group Term Life', group: 'Commercial', blurb: 'Life cover for employees.',
    sections: [company(),
      { title: 'Cover', icon: 'users', fields: [
        f('employees', 'Number of employees', 'number', { req: true }),
        f('cover_basis', 'Sum assured basis', 'select', { req: true, options: ['Flat amount per employee', 'Multiple of annual salary', 'By grade'] }),
        f('cover_details', 'Amount / multiple / grade-wise details', 'textarea', { req: true }) ] },
      docs([f('doc_census', 'Member data sheet (name, DOB, gender, sum assured)', 'file', { req: true }), D.companyPan, D.gst, D.prevPolicy]), declaration()],
  },
  motor: {
    label: 'Motor — Car / Two-wheeler / Commercial vehicle', group: 'Motor', blurb: 'Vehicle and owner details.',
    sections: [
      { title: 'Owner details', icon: 'user', fields: [
        f('full_name', 'Owner name (as on RC)', 'text', { req: true }),
        f('dob', 'Date of birth', 'date', { map: 'dob' }),
        f('mobile', 'Mobile number', 'tel', { req: true, map: 'mobile' }),
        f('email', 'Email', 'email', { req: true, map: 'email' }),
        f('pan', 'PAN number', 'text', { map: 'pan_no', pattern: 'pan' }),
        f('aadhaar', 'Aadhaar number', 'text', { map: 'aadhar_no', pattern: 'aadhaar' }),
        f('gstin', 'GSTIN (if the vehicle is in a company name)', 'text', { map: 'gstin', pattern: 'gstin' }) ] },
      address('Address (as on RC)'),
      { title: 'Vehicle', icon: 'car', fields: [
        f('reg_no', 'Registration number', 'text', { req: true }),
        f('make_model', 'Make & model', 'text', { req: true }),
        f('mfg_year', 'Year of manufacture', 'number', { req: true }),
        f('fuel', 'Fuel', 'select', { options: ['Petrol', 'Diesel', 'CNG', 'LPG', 'Electric', 'Hybrid'], req: true }),
        f('chassis_no', 'Chassis number (last 6 characters)'),
        f('engine_no', 'Engine number (last 6 characters)'),
        f('loan', 'Is the vehicle on loan / hypothecated?', 'yesno', { req: true }),
        f('financier', 'Bank / financier name', 'text', { show: ['loan', 'Yes'], req: true }) ] },
      { title: 'Previous policy', icon: 'file', fields: [
        f('prev_insurer', 'Previous insurer', 'text'),
        f('prev_expiry', 'Previous policy expiry date', 'date'),
        f('prev_claim', 'Any claim in the previous policy year?', 'yesno', { req: true }),
        f('ncb', 'No Claim Bonus on the previous policy', 'select', { options: ['0%', '20%', '25%', '35%', '45%', '50%', 'Not sure'] }) ] },
      nominee('Nominee for owner-driver accident cover'),
      docs([f('doc_rc', 'RC (registration certificate) — front & back', 'file', { req: true }), D.prevPolicy, f('doc_dl', 'Driving licence', 'file'), D.pan, D.aadhaar]),
      declaration()],
  },
  'term-life': {
    label: 'Term / Life Insurance', group: 'Life', blurb: 'Life cover for an individual.',
    sections: [you(),
      { title: 'Work & income', icon: 'chart', fields: [
        f('education', 'Highest education', 'select', { req: true, options: ['Below 10th', '10th', '12th', 'Graduate', 'Post-graduate', 'Professional (CA/Doctor/etc.)'] }),
        f('employer', 'Employer / business name', 'text', { req: true }),
        f('duties', 'Nature of work / duties', 'text', { req: true }),
        f('annual_income', 'Annual income (₹)', 'number', { req: true }),
        f('existing_cover', 'Existing life cover (total, ₹)', 'number') ] },
      address(), health('Your health'),
      { title: 'Nominees', icon: 'users', help: 'Shares must add up to 100%.', fields: [
        f('nominees', 'Nominees', 'repeat', { req: true, min: 1, max: 4, fields: [
          f('name', 'Name', 'text', { req: true }), f('relation', 'Relation', 'select', { options: RELATION.filter((r) => r !== 'Self'), req: true }),
          f('dob', 'Date of birth', 'date', { req: true }), f('share', 'Share %', 'number', { req: true })] }) ] },
      docs([D.pan, D.aadhaar, { ...D.photo, req: true }, f('doc_income', 'Income proof (ITR / Form 16 / salary slips)', 'file', { req: true }), D.cheque]),
      declaration()],
  },
  pa: {
    label: 'Personal Accident', group: 'Personal', blurb: 'Accident cover for one person.',
    sections: [you(), address(),
      { title: 'Work', icon: 'chart', fields: [
        f('work_nature', 'Nature of work', 'select', { req: true, options: ['Office / desk work', 'Field / travel', 'Manual / supervisory', 'Heavy manual / hazardous'] }),
        f('existing_pa', 'Any other accident policy?', 'yesno'),
        f('existing_pa_details', 'Insurer and sum insured', 'text', { show: ['existing_pa', 'Yes'] }) ] },
      nominee(), docs([D.pan, D.aadhaar]), declaration()],
  },
  travel: {
    label: 'Travel Insurance', group: 'Personal', blurb: 'Overseas or domestic trip cover.',
    sections: [you('Proposer'), address(),
      { title: 'Trip', icon: 'calendar', fields: [
        f('destination', 'Destination country / countries', 'text', { req: true }),
        f('depart', 'Departure date', 'date', { req: true }),
        f('return', 'Return date', 'date', { req: true }),
        f('purpose', 'Purpose', 'select', { options: ['Holiday', 'Business', 'Study', 'Visiting family', 'Other'], req: true }) ] },
      { title: 'Travellers', icon: 'users', fields: [
        f('travellers', 'Travellers', 'repeat', { req: true, min: 1, max: 8, fields: [
          f('name', 'Name (as on passport)', 'text', { req: true }), f('dob', 'Date of birth', 'date', { req: true }),
          f('passport', 'Passport number', 'text', { req: true }), f('ped', 'Existing illness?', 'yesno', { req: true }),
          f('ped_details', 'Illness details', 'text', { show: ['ped', 'Yes'], req: true })] }) ] },
      docs([f('doc_passport', 'Passport copies (first & last page)', 'file', { req: true }), D.pan]), declaration()],
  },
  property: {
    label: 'Fire / Property / Householder', group: 'Commercial', blurb: 'Building, machinery, stock or home contents.',
    sections: [company('Insured — company or person'),
      { title: 'Risk location', icon: 'building', fields: [
        f('risk_address', 'Address of the property to be insured', 'textarea', { req: true }),
        f('occupancy', 'What the property is used for (shop, factory, godown, home…)', 'text', { req: true }),
        f('construction', 'Construction', 'select', { options: ['RCC / pucca', 'Mixed', 'Kutcha / temporary'] }),
        f('si_building', 'Building value (₹)', 'number'),
        f('si_plant', 'Plant & machinery (₹)', 'number'),
        f('si_stock', 'Stock (₹)', 'number'),
        f('si_contents', 'Furniture, fittings & contents (₹)', 'number'),
        f('loan', 'Is the property on loan / hypothecated?', 'yesno', { req: true }),
        f('financier', 'Bank / financier', 'text', { show: ['loan', 'Yes'], req: true }),
        f('claims_3yr', 'Any claim in the last 3 years?', 'yesno'),
        f('claims_details', 'Claim details', 'textarea', { show: ['claims_3yr', 'Yes'] }) ] },
      docs([D.companyPan, D.gst, D.prevPolicy, f('doc_valuation', 'Valuation report / stock statement (if any)', 'file')]), declaration()],
  },
  marine: {
    label: 'Marine Cargo', group: 'Commercial', blurb: 'Goods in transit.',
    sections: [company(),
      { title: 'Transit', icon: 'dispatch', fields: [
        f('commodity', 'Goods / commodity', 'text', { req: true }),
        f('packing', 'Packing', 'text'),
        f('from_to', 'From — to (cities / countries)', 'text', { req: true }),
        f('mode', 'Mode of transit', 'select', { options: ['Road', 'Rail', 'Sea', 'Air', 'Multi-modal'], req: true }),
        f('turnover', 'Estimated annual turnover / dispatches (₹)', 'number', { req: true }),
        f('per_transit', 'Largest single consignment (₹)', 'number') ] },
      docs([D.companyPan, D.gst, D.prevPolicy]), declaration()],
  },
  liability: {
    label: 'Liability', group: 'Commercial', blurb: 'Public, product, professional or D&O liability.',
    sections: [company(),
      { title: 'Business', icon: 'chart', fields: [
        f('activity', 'Business activity in detail', 'textarea', { req: true }),
        f('turnover', 'Annual turnover (₹)', 'number', { req: true }),
        f('staff', 'Number of employees', 'number'),
        f('limit', 'Limit of indemnity wanted (₹)', 'number', { req: true }),
        f('claims', 'Any liability claim in the last 5 years?', 'yesno', { req: true }),
        f('claims_details', 'Claim details', 'textarea', { show: ['claims', 'Yes'] }) ] },
      docs([D.companyPan, D.gst, D.prevPolicy]), declaration()],
  },
  wc: {
    label: "Workmen's Compensation", group: 'Commercial', blurb: 'Employees’ compensation cover.',
    sections: [company(),
      { title: 'Workers', icon: 'users', fields: [
        f('work_location', 'Work site address', 'textarea', { req: true }),
        f('work_nature', 'Nature of work', 'text', { req: true }),
        f('workers', 'Workers by category with monthly wages (e.g. 10 skilled × ₹18,000)', 'textarea', { req: true }),
        f('contractors', 'Are contract workers to be covered?', 'yesno') ] },
      docs([f('doc_workers', 'Worker list (optional)', 'file'), D.companyPan, D.gst, D.prevPolicy]), declaration()],
  },
  generic: {
    label: 'General onboarding', group: 'Other', blurb: 'KYC, address, nominee and documents.',
    sections: [you(), address(), nominee(), docs([D.pan, D.aadhaar, D.prevPolicy, f('doc_other', 'Any other document', 'file')]), declaration()],
  },
};

/** The form that suits a quotation, from its product, plan type and (for health) how many are covered. */
export function suggestForm({ category = '', product = '', policy_type = '', members = 0 } = {}) {
  const t = `${category} ${product} ${policy_type}`.toLowerCase();
  if (/group health|gmc|group mediclaim/.test(t)) return 'group-health';
  if (/group personal accident|\bgpa\b/.test(t)) return 'group-pa';
  if (/group term/.test(t)) return 'group-term';
  if (/motor|car|two wheeler|bike|vehicle|gcv|pcv/.test(t)) return 'motor';
  if (/top.?up/.test(t)) return 'health-topup';
  if (/senior/.test(t)) return 'health-senior';
  if (/floater|family/.test(t) && /health|medi/.test(t)) return 'health-floater';
  if (/health|medi|mediclaim/.test(t)) return members > 1 ? 'health-floater' : 'health-individual';
  if (/term|life|endowment|ulip/.test(t)) return 'term-life';
  if (/personal accident/.test(t)) return 'pa';
  if (/travel/.test(t)) return 'travel';
  if (/fire|property|householder|home|sookshma|laghu|bharat/.test(t)) return 'property';
  if (/marine|cargo|transit/.test(t)) return 'marine';
  if (/liability|d&o|indemnity/.test(t)) return 'liability';
  if (/workmen|employees.? comp|\bwc\b/.test(t)) return 'wc';
  return 'generic';
}

const PATTERNS = {
  pan: [/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'PAN looks like ABCDE1234F'],
  aadhaar: [/^\d{12}$/, 'Aadhaar has 12 digits'],
  pincode: [/^\d{6}$/, 'PIN code has 6 digits'],
  gstin: [/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, 'GSTIN has 15 characters, like 24ABCDE1234F1Z5'],
};
export const normalise = (field, v) => {
  let s = String(v ?? '').trim();
  if (['pan', 'gstin'].includes(field.pattern)) s = s.toUpperCase().replace(/\s/g, '');
  if (['aadhaar', 'pincode'].includes(field.pattern)) s = s.replace(/\D/g, '');
  return s;
};
const shown = (field, answers) => !field.show || String(answers[field.show[0]] ?? '') === field.show[1];

/** What is missing or wrong in a submission: [{ k, label, msg }]. Files are checked against `files`. */
export function checkAnswers(form, answers, files) {
  const out = [];
  for (const sec of form.sections) {
    for (const fl of sec.fields) {
      if (!shown(fl, answers)) continue;
      const v = answers[fl.k];
      if (fl.type === 'file') { if (fl.req && !(files[fl.k] || []).length) out.push({ k: fl.k, label: fl.label, msg: 'Please upload this' }); continue; }
      if (fl.type === 'repeat') {
        const rows = Array.isArray(v) ? v : [];
        if (fl.req && rows.length < (fl.min || 1)) { out.push({ k: fl.k, label: fl.label, msg: `Add at least ${fl.min || 1}` }); continue; }
        rows.forEach((row, i) => fl.fields.forEach((sf) => {
          if (sf.req && shown(sf, row || {}) && !String(row?.[sf.k] ?? '').trim()) out.push({ k: `${fl.k}.${i}.${sf.k}`, label: `${fl.label} ${i + 1} — ${sf.label}`, msg: 'Required' });
        }));
        if (fl.k === 'nominees' && rows.length) {
          const total = rows.reduce((n, r) => n + (Number(r?.share) || 0), 0);
          if (Math.round(total) !== 100) out.push({ k: fl.k, label: 'Nominee shares', msg: 'Shares must add up to 100%' });
        }
        continue;
      }
      if (fl.type === 'declaration') { if (fl.req && v !== true && v !== 'Yes') out.push({ k: fl.k, label: 'Declaration', msg: 'Please tick to confirm' }); continue; }
      const s = normalise(fl, v);
      if (fl.req && !s) { out.push({ k: fl.k, label: fl.label, msg: 'Required' }); continue; }
      if (s && fl.pattern && PATTERNS[fl.pattern] && !PATTERNS[fl.pattern][0].test(s)) out.push({ k: fl.k, label: fl.label, msg: PATTERNS[fl.pattern][1] });
      if (s && fl.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) out.push({ k: fl.k, label: fl.label, msg: 'Enter a valid email' });
      if (s && fl.type === 'tel' && s.replace(/\D/g, '').length < 10) out.push({ k: fl.k, label: fl.label, msg: 'Enter a 10-digit mobile number' });
    }
  }
  return out;
}

export const catalogue = () => Object.entries(FORMS).map(([key, v]) => ({ key, label: v.label, group: v.group, blurb: v.blurb }));
export { shown as fieldShown };
