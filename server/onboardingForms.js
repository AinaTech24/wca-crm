// Client onboarding forms — a different form for each kind of policy, asking what that insurer's proposal
// form needs. Each form is a list of sections; each field says what it asks, how it is answered and, where
// it belongs on the client record, which column it fills (`map`). The same definition draws the public
// form, checks a submission and shows the answers in the CRM. An admin can adjust any form in Settings
// (hide or require fields, rename questions, add their own) — see effectiveForm().
//
// Field types: text, email, tel, date, number, select, yesno, textarea, file, repeat (a table of rows —
// family members, travellers, nominees, vehicles), declaration (the consent tick).
// `show: ['field', 'Yes']` shows a field only when another field has that answer.

const f = (k, label, type = 'text', extra = {}) => ({ k, label, type, ...extra });
const GENDER = ['Male', 'Female', 'Other'];
const RELATION = ['Self', 'Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Father-in-law', 'Mother-in-law', 'Brother', 'Sister', 'Other'];
const NOM_REL = RELATION.filter((r) => r !== 'Self');
const INCOME = ['Below ₹5 lakh', '₹5–10 lakh', '₹10–25 lakh', '₹25–50 lakh', '₹50 lakh–1 crore', 'Above ₹1 crore'];
const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman & Nicobar', 'Chandigarh', 'Dadra & Nagar Haveli and Daman & Diu', 'Delhi', 'Jammu & Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'];
const FUEL = ['Petrol', 'Diesel', 'CNG', 'LPG', 'Electric', 'Hybrid'];
const NCB = ['0%', '20%', '25%', '35%', '45%', '50%', 'Not sure'];

// Each line of business has its own look on the client's form.
export const THEMES = {
  Health: { color: '#15925f', icon: 'shieldcheck', tagline: 'Health cover for you and your family' },
  Motor: { color: '#1b6fb0', icon: 'car', tagline: 'Your vehicle’s insurance' },
  Life: { color: '#0e3a5f', icon: 'users', tagline: 'Protection for the people who depend on you' },
  Personal: { color: '#8b5cf6', icon: 'user', tagline: 'Personal cover' },
  Property: { color: '#e9531e', icon: 'building', tagline: 'Cover for your property' },
  Commercial: { color: '#c2410c', icon: 'building', tagline: 'Business insurance' },
  Group: { color: '#0f766e', icon: 'users', tagline: 'Employee benefits' },
  Other: { color: '#475569', icon: 'doc', tagline: 'Your policy details' },
};

// ---------- building blocks ----------
const you = (title = 'Your details', { income = true } = {}) => ({
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
    ...(income ? [f('income', 'Annual income', 'select', { options: INCOME })] : []),
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
    f('nominee_relation', 'Relationship with you', 'select', { options: NOM_REL, req: true }),
    f('nominee_dob', 'Nominee date of birth', 'date'),
    f('appointee', 'Appointee (if the nominee is under 18)', 'text'),
  ],
});
const company = (title = 'Company details') => ({
  title, icon: 'building', fields: [
    f('company_name', 'Company / firm name', 'text', { req: true, map: 'company_name' }),
    f('constitution', 'Type of entity', 'select', { options: ['Proprietorship', 'Partnership / LLP', 'Private Limited', 'Public Limited', 'Trust / Society', 'Other'] }),
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
const lifestyle = (title = 'Health & lifestyle') => ({
  title, icon: 'shieldcheck', help: 'Please answer honestly — anything not declared now can lead to a claim being refused later.', fields: [
    f('height_cm', 'Height (cm)', 'number', { req: true, range: [30, 250, 'Enter height in centimetres — 5 ft 6 in is about 168 cm'], help: 'In centimetres (5 ft = 152 cm, 5 ft 6 in = 168 cm, 6 ft = 183 cm)' }),
    f('weight_kg', 'Weight (kg)', 'number', { req: true, range: [1, 250, 'Enter weight in kilograms'] }),
    f('ped', 'Any illness or condition you already have (diabetes, BP, thyroid, heart, asthma…)?', 'yesno', { req: true }),
    f('ped_details', 'Which condition, since when, and the medicines you take', 'textarea', { req: true, show: ['ped', 'Yes'] }),
    f('hospitalised', 'Hospitalised or operated in the last 4 years?', 'yesno', { req: true }),
    f('hospital_details', 'When, and for what', 'textarea', { req: true, show: ['hospitalised', 'Yes'] }),
    f('tobacco', 'Do you use tobacco in any form?', 'yesno', { req: true }),
    f('tobacco_qty', 'How much per day', 'text', { show: ['tobacco', 'Yes'] }),
    f('alcohol', 'Do you drink alcohol regularly?', 'yesno'),
  ],
});
const member = () => [
  f('name', 'Name', 'text', { req: true }),
  f('relation', 'Relation', 'select', { options: RELATION, req: true }),
  f('dob', 'Date of birth', 'date', { req: true }),
  f('gender', 'Gender', 'select', { options: GENDER, req: true }),
  f('height_cm', 'Height (cm)', 'number', { range: [30, 250, 'Enter height in centimetres — 5 ft 6 in is about 168 cm'], help: 'In centimetres (5 ft = 152 cm, 5 ft 6 in = 168 cm, 6 ft = 183 cm)' }),
  f('weight_kg', 'Weight (kg)', 'number', { range: [1, 250, 'Enter weight in kilograms'] }),
  f('ped', 'Existing illness?', 'yesno', { req: true }),
  f('ped_details', 'Illness details', 'text', { show: ['ped', 'Yes'], req: true }),
  f('tobacco', 'Tobacco?', 'yesno'),
];
// "Only me" or "me and my family", with the family table shown only when it is a family policy.
const coverWho = (memberFields, family = 'Me and my family') => ({ title: 'Who is to be covered', icon: 'users', fields: [
  f('cover_for', 'Who should this policy cover?', 'select', { req: true, options: ['Only me', family] }),
  f('members', 'Family members to be covered (include yourself)', 'repeat', { req: true, min: 2, max: 8, fields: memberFields, show: ['cover_for', family] }) ] });
// For accident cover the work each person does matters more than their health.
const paMember = () => [
  f('name', 'Name', 'text', { req: true }),
  f('relation', 'Relation', 'select', { options: RELATION, req: true }),
  f('dob', 'Date of birth', 'date', { req: true }),
  f('gender', 'Gender', 'select', { options: GENDER, req: true }),
  f('occupation', 'Occupation', 'text', { req: true }),
  f('work_nature', 'Nature of work', 'select', { options: ['Office / desk work', 'Field / travel', 'Manual / supervisory', 'Heavy manual / hazardous', 'Student', 'Homemaker', 'Retired'], req: true }),
  f('employer', 'Company / employer (if working)', 'text'),
  f('disability', 'Any physical disability?', 'yesno'),
];
const priorHealth = () => ({
  title: 'Your current health insurance', icon: 'file', help: 'Waiting periods you have already served carry over when you port.', fields: [
    f('has_policy', 'Do you have a health policy today (personal or from an employer)?', 'yesno', { req: true }),
    f('prev_insurer', 'Insurer', 'text', { show: ['has_policy', 'Yes'], req: true }),
    f('prev_policy_no', 'Policy number', 'text', { show: ['has_policy', 'Yes'] }),
    f('prev_si', 'Sum insured (₹)', 'number', { show: ['has_policy', 'Yes'] }),
    f('insured_since', 'Insured continuously since', 'date', { show: ['has_policy', 'Yes'] }),
    f('porting', 'Do you want to port (move) it to this new policy?', 'yesno', { show: ['has_policy', 'Yes'] }),
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
  medical: f('doc_medical', 'Medical reports / prescriptions', 'file'),
  gst: f('doc_gst', 'GST certificate', 'file'),
  companyPan: f('doc_company_pan', 'Company PAN card', 'file', { req: true }),
  cheque: f('doc_cheque', 'Cancelled cheque (for claim payouts)', 'file'),
  rc: f('doc_rc', 'RC (registration certificate) — front & back', 'file', { req: true }),
  dl: f('doc_dl', 'Driving licence', 'file'),
  income: f('doc_income', 'Income proof (ITR / Form 16 / salary slips)', 'file', { req: true }),
  // One upload per family member (by name) — the member's Aadhaar or other ID with date of birth.
  members: f('doc_members', 'Aadhaar / ID proof of each member to be covered', 'file', { req: true, perMember: 'members', docName: 'ID proof' }),
  // Travel: every traveller's passport — the proposer's too (their Aadhaar does not count).
  passports: f('doc_passports', 'Passport of each traveller (first & last page)', 'file', { req: true, perMember: 'travellers', docName: 'Passport', selfSkip: false, help: 'One upload per traveller — the first and last page of the passport.' }),
};
const declaration = () => ({
  title: 'Declaration', icon: 'check', fields: [
    f('consent', 'I confirm that the information given above is true and complete to the best of my knowledge, and I authorise WeCare Assurance to share it with the insurer to issue my policy.', 'declaration', { req: true }),
    f('signed_by', 'Your full name (as your signature)', 'text', { req: true }),
  ],
});
// Motor pieces
const owner = () => ({
  title: 'Owner details', icon: 'user', fields: [
    f('full_name', 'Owner name (as on RC)', 'text', { req: true }),
    f('owner_type', 'Registered in the name of', 'select', { options: ['An individual', 'A company / firm'], req: true }),
    f('dob', 'Date of birth', 'date', { map: 'dob', show: ['owner_type', 'An individual'] }),
    f('mobile', 'Mobile number', 'tel', { req: true, map: 'mobile' }),
    f('email', 'Email', 'email', { req: true, map: 'email' }),
    f('pan', 'PAN number', 'text', { map: 'pan_no', pattern: 'pan' }),
    f('aadhaar', 'Aadhaar number', 'text', { map: 'aadhar_no', pattern: 'aadhaar', show: ['owner_type', 'An individual'] }),
    f('gstin', 'GSTIN', 'text', { map: 'gstin', pattern: 'gstin', show: ['owner_type', 'A company / firm'] }),
  ],
});
const prevMotor = () => ({
  title: 'Previous policy', icon: 'file', help: 'Your No Claim Bonus can bring the premium down by up to 50%.', fields: [
    f('new_vehicle', 'Is this a brand-new vehicle?', 'yesno', { req: true }),
    f('prev_insurer', 'Previous insurer', 'text', { show: ['new_vehicle', 'No'], req: true }),
    f('prev_policy_no', 'Previous policy number', 'text', { show: ['new_vehicle', 'No'] }),
    f('prev_expiry', 'Previous policy expiry date', 'date', { show: ['new_vehicle', 'No'], req: true }),
    f('prev_claim', 'Any claim in the previous policy year?', 'yesno', { show: ['new_vehicle', 'No'], req: true }),
    f('ncb', 'No Claim Bonus on the previous policy', 'select', { options: NCB, show: ['new_vehicle', 'No'] }),
  ],
});
const loan = (what = 'vehicle') => [
  f('loan', `Is the ${what} on loan / hypothecated?`, 'yesno', { req: true }),
  f('financier', 'Bank / financier name', 'text', { show: ['loan', 'Yes'], req: true }),
  f('financier_city', 'Financier branch city', 'text', { show: ['loan', 'Yes'] }),
];

// ---------- the forms ----------
const FORM_LIST = {
  // Health
  'health-individual': { label: 'Health — Individual', group: 'Health', blurb: 'One person covered (asks for the family if it is a floater).', minutes: 6,
    sections: [you(), address(),
      { title: 'Who is to be covered', icon: 'users', fields: [
        f('cover_for', 'Who should this policy cover?', 'select', { req: true, options: ['Only me', 'Me and my family (one shared sum insured)'] }),
        f('members', 'Family members to be covered (include yourself)', 'repeat', { req: true, min: 2, max: 8, fields: member(), show: ['cover_for', 'Me and my family (one shared sum insured)'] }) ] },
      lifestyle('Your health'), nominee(), docs([D.pan, D.aadhaar, { ...D.members, show: ['cover_for', 'Me and my family (one shared sum insured)'] }, D.prevPolicy, D.medical]), declaration()] },
  'health-floater': { label: 'Health — Family Floater', group: 'Health', blurb: 'One sum insured shared by the family.', minutes: 8,
    sections: [you('Proposer — the person paying'), address(),
      { title: 'Family members to be covered', icon: 'users', help: 'Add everyone who should be covered, including yourself.', fields: [
        f('members', 'Members', 'repeat', { req: true, min: 2, max: 8, fields: member() }) ] },
      { title: 'Family health history', icon: 'shieldcheck', fields: [
        f('any_hospitalised', 'Has anyone in the list been hospitalised in the last 4 years?', 'yesno', { req: true }),
        f('any_hospital_details', 'Who, when and for what', 'textarea', { show: ['any_hospitalised', 'Yes'], req: true }),
        f('maternity', 'Is anyone expecting a baby, or planning one in the next 2 years?', 'yesno') ] },
      nominee(), docs([D.pan, D.aadhaar, D.members, D.prevPolicy, D.medical]), declaration()] },
  'health-senior': { label: 'Health — Senior Citizen', group: 'Health', blurb: 'Cover for those aged 60 and above.', minutes: 8,
    sections: [you('Details of the person insured', { income: false }), address(), lifestyle('Health'),
      { title: 'Recent medical history', icon: 'clipboard', help: 'Most insurers ask for a check-up for this age — recent reports can avoid a repeat.', fields: [
        f('last_checkup', 'Date of the last full health check-up', 'date'),
        f('regular_meds', 'Taking any medicines regularly?', 'yesno', { req: true }),
        f('meds_details', 'Which medicines, and for what', 'textarea', { show: ['regular_meds', 'Yes'], req: true }),
        f('mobility', 'Any difficulty walking, seeing or hearing?', 'yesno'),
        f('pre_medical_ok', 'Willing to take a pre-policy medical check-up if the insurer asks?', 'yesno', { req: true }),
        f('copay_ok', 'Are you fine with a co-payment (you pay 10–20% of a claim) for a lower premium?', 'yesno') ] },
      nominee(), docs([D.pan, D.aadhaar, D.prevPolicy, { ...D.medical, label: 'Medical reports of the last 12 months', req: true }]), declaration()] },
  'health-topup': { label: 'Health — Super Top-up', group: 'Health', blurb: 'Extra cover above an existing policy.', minutes: 6,
    sections: [you(), address(),
      { title: 'Members to be covered', icon: 'users', fields: [f('members', 'Members', 'repeat', { req: true, min: 1, max: 8, fields: member() })] },
      { title: 'Your base policy', icon: 'file', help: 'The top-up pays after this base cover (the deductible) is used up.', fields: [
        f('base_insurer', 'Base policy insurer', 'text', { req: true }),
        f('base_si', 'Base sum insured (₹)', 'number', { req: true }),
        f('deductible', 'Deductible you chose (₹)', 'number', { req: true }),
        f('base_employer', 'Is the base policy from your employer?', 'yesno') ] },
      nominee(), docs([D.pan, D.aadhaar, D.members, { ...D.prevPolicy, label: 'Base policy copy', req: true }, D.medical]), declaration()] },
  'health-ci': { label: 'Health — Critical Illness', group: 'Health', blurb: 'A lump sum on diagnosis of a listed illness — for you, or your family.', minutes: 8,
    sections: [you(), address(), coverWho(member()), lifestyle('Your health'),
      { title: 'Family history', icon: 'users', help: 'Critical illness cover depends a lot on family history.', fields: [
        f('fam_cancer', 'Has a parent or sibling had cancer?', 'yesno', { req: true }),
        f('fam_heart', 'Has a parent or sibling had a heart attack or stroke before 60?', 'yesno', { req: true }),
        f('fam_kidney', 'Kidney disease or diabetes in parents or siblings?', 'yesno', { req: true }),
        f('fam_details', 'Who, which illness, and at what age', 'textarea') ] },
      { title: 'Cover', icon: 'shieldcheck', fields: [
        f('ci_si', 'Lump sum wanted (₹)', 'number', { req: true }),
        f('other_ci', 'Any other critical illness or life cover today?', 'yesno'),
        f('other_ci_details', 'Insurer and amount', 'text', { show: ['other_ci', 'Yes'] }) ] },
      nominee(), docs([D.pan, D.aadhaar, { ...D.members, show: ['cover_for', 'Me and my family'] }, D.medical, { ...D.income, req: false, label: 'Income proof (for a large lump sum)' }]), declaration()] },

  // Motor
  motor: { label: 'Motor — Private Car', group: 'Motor', blurb: 'Car used privately.', minutes: 5,
    sections: [owner(), address('Address (as on RC)'),
      { title: 'Your car', icon: 'car', fields: [
        f('reg_no', 'Registration number', 'text', { req: true }),
        f('make_model', 'Make, model & variant', 'text', { req: true }),
        f('mfg_year', 'Year of manufacture', 'number', { req: true }),
        f('fuel', 'Fuel', 'select', { options: FUEL, req: true }),
        f('chassis_no', 'Chassis number (last 6 characters)'),
        f('engine_no', 'Engine number (last 6 characters)'),
        f('cng_kit', 'CNG / LPG kit fitted after purchase?', 'yesno'),
        f('cng_value', 'Kit value (₹)', 'number', { show: ['cng_kit', 'Yes'] }),
        f('accessories', 'Extra accessories to insure (music system, alloys…) with value', 'textarea'),
        f('parking', 'Usually parked', 'select', { options: ['Own garage', 'Society parking', 'Street'] }),
        f('anti_theft', 'ARAI-approved anti-theft device fitted?', 'yesno'),
        ...loan('car') ] },
      prevMotor(),
      { title: 'Driver & cover', icon: 'user', fields: [
        f('paid_driver', 'Do you have a paid driver?', 'yesno'),
        f('pa_owner', 'Do you already have ₹15 lakh personal accident cover as an owner-driver?', 'yesno', { help: 'If not, it is compulsory on the policy.' }),
        f('addons_ok', 'Add-ons you want (as in the quotation)', 'text', { help: 'e.g. Zero depreciation, Engine protect, RSA' }) ] },
      nominee('Nominee for owner-driver accident cover'),
      docs([D.rc, D.prevPolicy, D.dl, D.pan, D.aadhaar]), declaration()] },
  'motor-twowheeler': { label: 'Motor — Two-wheeler', group: 'Motor', blurb: 'Bike or scooter.', minutes: 4,
    sections: [owner(), address('Address (as on RC)'),
      { title: 'Your two-wheeler', icon: 'car', fields: [
        f('reg_no', 'Registration number', 'text', { req: true }),
        f('make_model', 'Make & model', 'text', { req: true }),
        f('mfg_year', 'Year of manufacture', 'number', { req: true }),
        f('cc', 'Engine capacity (cc)', 'number'),
        f('fuel', 'Fuel', 'select', { options: ['Petrol', 'Electric'], req: true }),
        ...loan('two-wheeler') ] },
      prevMotor(), nominee('Nominee for owner-rider accident cover'),
      docs([D.rc, D.prevPolicy, D.dl]), declaration()] },
  'motor-goods': { label: 'Motor — Goods Carrying Vehicle', group: 'Motor', blurb: 'Truck, tempo, pickup, tractor-trailer.', minutes: 6,
    sections: [owner(), address('Address (as on RC)'),
      { title: 'Vehicle', icon: 'dispatch', fields: [
        f('reg_no', 'Registration number', 'text', { req: true }),
        f('make_model', 'Make & model', 'text', { req: true }),
        f('mfg_year', 'Year of manufacture', 'number', { req: true }),
        f('gvw', 'Gross vehicle weight (kg)', 'number', { req: true }),
        f('body', 'Body type', 'select', { options: ['Open body', 'Closed body / container', 'Tanker', 'Tipper', 'Trailer', 'Other'] }),
        f('fuel', 'Fuel', 'select', { options: FUEL, req: true }),
        f('permit', 'Permit', 'select', { options: ['National permit', 'State permit', 'Local / private carrier'], req: true }),
        f('goods', 'Goods usually carried', 'text', { req: true }),
        f('hazardous', 'Does it carry hazardous goods (chemicals, gas, fuel)?', 'yesno', { req: true }),
        f('trailer', 'Trailer attached?', 'yesno'),
        f('drivers', 'Number of paid drivers / cleaners', 'number'),
        ...loan('vehicle') ] },
      prevMotor(),
      docs([D.rc, f('doc_permit', 'Permit', 'file', { req: true }), f('doc_fitness', 'Fitness certificate', 'file', { req: true }), D.prevPolicy, D.dl]), declaration()] },
  'motor-passenger': { label: 'Motor — Passenger Carrying Vehicle', group: 'Motor', blurb: 'Taxi, cab, auto, bus, school van.', minutes: 6,
    sections: [owner(), address('Address (as on RC)'),
      { title: 'Vehicle', icon: 'dispatch', fields: [
        f('reg_no', 'Registration number', 'text', { req: true }),
        f('make_model', 'Make & model', 'text', { req: true }),
        f('mfg_year', 'Year of manufacture', 'number', { req: true }),
        f('use', 'Used as', 'select', { options: ['Taxi / cab', 'Auto-rickshaw', 'Bus', 'School / staff vehicle', 'Rented (self-drive)'], req: true }),
        f('seats', 'Seating capacity (excluding driver)', 'number', { req: true }),
        f('permit', 'Permit', 'select', { options: ['All India tourist', 'State contract carriage', 'Stage carriage', 'Local'], req: true }),
        f('route', 'Usual route / area', 'text'),
        f('fuel', 'Fuel', 'select', { options: FUEL, req: true }),
        f('aggregator', 'Attached to Ola / Uber or a fleet?', 'yesno'),
        ...loan('vehicle') ] },
      prevMotor(),
      docs([D.rc, f('doc_permit', 'Permit', 'file', { req: true }), f('doc_fitness', 'Fitness certificate', 'file', { req: true }), D.prevPolicy, f('doc_badge', 'Driver licence with badge', 'file')]), declaration()] },

  // Life
  'term-life': { label: 'Life — Term Plan', group: 'Life', blurb: 'Pure life cover for an individual.', minutes: 9,
    sections: [you(),
      { title: 'Work & income', icon: 'chart', help: 'Insurers cover up to about 15–25 times your annual income.', fields: [
        f('education', 'Highest education', 'select', { req: true, options: ['Below 10th', '10th', '12th', 'Graduate', 'Post-graduate', 'Professional (CA/Doctor/etc.)'] }),
        f('employment', 'Employment', 'select', { req: true, options: ['Salaried', 'Self-employed / business', 'Professional', 'Retired', 'Homemaker', 'Student'] }),
        f('employer', 'Employer / business name', 'text', { req: true }),
        f('duties', 'Nature of work / duties', 'text', { req: true }),
        f('hazard', 'Any hazardous work or hobby (mining, diving, aviation, racing)?', 'yesno', { req: true }),
        f('annual_income', 'Annual income (₹)', 'number', { req: true }),
        f('existing_cover', 'Existing life cover (total, ₹)', 'number'),
        f('nri', 'Do you live outside India for more than 6 months a year?', 'yesno') ] },
      address(), lifestyle('Your health'),
      { title: 'Nominees', icon: 'users', help: 'Shares must add up to 100%.', fields: [
        f('nominees', 'Nominees', 'repeat', { req: true, min: 1, max: 4, fields: [
          f('name', 'Name', 'text', { req: true }), f('relation', 'Relation', 'select', { options: NOM_REL, req: true }),
          f('dob', 'Date of birth', 'date', { req: true }), f('share', 'Share %', 'number', { req: true })] }) ] },
      docs([D.pan, D.aadhaar, { ...D.photo, req: true }, D.income, D.cheque]), declaration()] },
  'life-savings': { label: 'Life — Savings / ULIP / Child Plan', group: 'Life', blurb: 'Endowment, money-back, ULIP or child plan.', minutes: 9,
    sections: [you(),
      { title: 'Your plan', icon: 'chart', fields: [
        f('goal', 'What are you saving for?', 'select', { req: true, options: ['Child’s education', 'Child’s marriage', 'Retirement', 'Wealth creation', 'Tax saving', 'Other'] }),
        f('premium_amount', 'Premium you plan to pay (₹)', 'number', { req: true }),
        f('frequency', 'How often', 'select', { req: true, options: ['Monthly', 'Quarterly', 'Half-yearly', 'Yearly', 'Single premium'] }),
        f('ppt', 'For how many years', 'number', { req: true }),
        f('risk', 'Investment risk you are comfortable with (ULIP)', 'select', { options: ['Low', 'Moderate', 'High'] }),
        f('child_name', 'Child’s name (child plan)', 'text'),
        f('child_dob', 'Child’s date of birth', 'date'),
        f('annual_income', 'Annual income (₹)', 'number', { req: true }),
        f('employer', 'Employer / business name', 'text', { req: true }) ] },
      address(), lifestyle('Your health'),
      { title: 'Nominees', icon: 'users', help: 'Shares must add up to 100%.', fields: [
        f('nominees', 'Nominees', 'repeat', { req: true, min: 1, max: 4, fields: [
          f('name', 'Name', 'text', { req: true }), f('relation', 'Relation', 'select', { options: NOM_REL, req: true }),
          f('dob', 'Date of birth', 'date', { req: true }), f('share', 'Share %', 'number', { req: true })] }) ] },
      { title: 'Bank account for payouts', icon: 'bank', fields: [
        f('bank_name', 'Bank', 'text', { req: true }), f('ifsc', 'IFSC', 'text', { req: true }), f('acct_last4', 'Account number (last 4 digits)', 'text') ] },
      docs([D.pan, D.aadhaar, { ...D.photo, req: true }, D.income, { ...D.cheque, req: true }]), declaration()] },
  'life-pension': { label: 'Life — Pension / Annuity', group: 'Life', blurb: 'Retirement income.', minutes: 7,
    sections: [you(),
      { title: 'Your pension', icon: 'chart', fields: [
        f('retire_age', 'Age you want the pension to start', 'number', { req: true }),
        f('investment', 'Amount to invest (₹)', 'number', { req: true }),
        f('mode', 'Pay in', 'select', { req: true, options: ['Single lump sum', 'Yearly', 'Monthly'] }),
        f('annuity_type', 'Pension for', 'select', { req: true, options: ['My life only', 'My life, then my spouse (joint life)', 'My life, with the money returned to the family'] }),
        f('spouse_name', 'Spouse’s name', 'text', { show: ['annuity_type', 'My life, then my spouse (joint life)'], req: true }),
        f('spouse_dob', 'Spouse’s date of birth', 'date', { show: ['annuity_type', 'My life, then my spouse (joint life)'], req: true }),
        f('payout', 'Pension paid', 'select', { options: ['Monthly', 'Quarterly', 'Half-yearly', 'Yearly'] }) ] },
      address(),
      { title: 'Bank account for the pension', icon: 'bank', fields: [
        f('bank_name', 'Bank', 'text', { req: true }), f('ifsc', 'IFSC', 'text', { req: true }), f('acct_last4', 'Account number (last 4 digits)', 'text') ] },
      nominee(), docs([D.pan, D.aadhaar, D.photo, { ...D.cheque, req: true }]), declaration()] },

  // Personal
  pa: { label: 'Personal Accident', group: 'Personal', blurb: 'Accident cover for you, or your family.', minutes: 5,
    sections: [you(), address(), coverWho(paMember()),
      { title: 'Work & cover', icon: 'chart', help: 'Accident cover is priced by how risky the work is, and the sum insured is usually limited to a multiple of income.', fields: [
        f('work_nature', 'Nature of your work', 'select', { req: true, options: ['Office / desk work', 'Field / travel', 'Manual / supervisory', 'Heavy manual / hazardous'] }),
        f('employer', 'Company / employer you work for', 'text', { req: true, help: 'Write “Self-employed” if you run your own business' }),
        f('designation', 'Your designation / role', 'text'),
        f('annual_income', 'Your annual income (₹)', 'number', { req: true }),
        f('pa_si', 'Sum insured wanted (₹)', 'number', { req: true }),
        f('two_wheeler', 'Do you ride a two-wheeler regularly?', 'yesno'),
        f('adventure', 'Any adventure sport (trekking, diving, racing)?', 'yesno'),
        f('disability', 'Any physical disability or impairment?', 'yesno', { req: true }),
        f('disability_details', 'Which, and since when', 'textarea', { show: ['disability', 'Yes'], req: true }),
        f('past_accident', 'Any accident claim in the last 3 years?', 'yesno', { req: true }),
        f('past_accident_details', 'When, and what happened', 'textarea', { show: ['past_accident', 'Yes'], req: true }),
        f('existing_pa', 'Any other accident policy?', 'yesno'),
        f('existing_pa_details', 'Insurer and sum insured', 'text', { show: ['existing_pa', 'Yes'] }) ] },
      nominee(), docs([D.pan, D.aadhaar, { ...D.members, show: ['cover_for', 'Me and my family'] }, { ...D.income, req: false, label: 'Income proof (for a higher sum insured)' }]), declaration()] },
  travel: { label: 'Travel Insurance', group: 'Personal', blurb: 'Overseas or domestic trip cover.', minutes: 5,
    sections: [you('Proposer', { income: false }), address(),
      { title: 'Trip', icon: 'calendar', fields: [
        f('destination', 'Destination country / countries', 'text', { req: true }),
        f('depart', 'Departure date', 'date', { req: true }),
        f('return', 'Return date', 'date', { req: true }),
        f('purpose', 'Purpose', 'select', { options: ['Holiday', 'Business', 'Study', 'Visiting family', 'Other'], req: true }),
        f('university', 'University and course', 'text', { show: ['purpose', 'Study'], req: true }),
        f('sponsor', 'Sponsor’s name and relation', 'text', { show: ['purpose', 'Study'] }),
        f('travel_si', 'Medical cover wanted', 'select', { options: ['USD 50,000', 'USD 1,00,000', 'USD 2,50,000', 'USD 5,00,000', 'Not sure — please suggest'], req: true }),
        f('schengen', 'Is this for a Schengen visa?', 'yesno'),
        f('multi_trip', 'Do you travel several times a year (annual multi-trip cover)?', 'yesno') ] },
      { title: 'Travellers', icon: 'users', fields: [
        f('travellers', 'Travellers', 'repeat', { req: true, min: 1, max: 8, fields: [
          f('name', 'Name (as on passport)', 'text', { req: true }), f('dob', 'Date of birth', 'date', { req: true }),
          f('gender', 'Gender', 'select', { options: GENDER, req: true }),
          f('passport', 'Passport number', 'text', { req: true }), f('ped', 'Existing illness?', 'yesno', { req: true }),
          f('ped_details', 'Illness details', 'text', { show: ['ped', 'Yes'], req: true })] }) ] },
      { title: 'Health of the travellers', icon: 'shieldcheck', help: 'Insurers ask this especially for travellers over 60.', fields: [
        f('hospitalised', 'Has any traveller been hospitalised in the last 2 years?', 'yesno', { req: true }),
        f('hospital_details', 'Who, when and for what', 'textarea', { show: ['hospitalised', 'Yes'], req: true }),
        f('treatment_abroad', 'Is anyone travelling for medical treatment?', 'yesno', { req: true }) ] },
      nominee(), docs([D.passports, f('doc_visa', 'Visa / admission letter', 'file'), { ...D.pan, req: false }, D.medical]), declaration()] },

  // Property
  home: { label: 'Home / Householder', group: 'Property', blurb: 'Your home’s building and contents.', minutes: 6,
    sections: [you('Your details', { income: false }), address('Your address'),
      { title: 'Your home', icon: 'building', fields: [
        f('same_address', 'Is the home to be insured at the address above?', 'yesno', { req: true }),
        f('home_address', 'Address of the home to be insured', 'textarea', { show: ['same_address', 'No'], req: true }),
        f('ownership', 'You are the', 'select', { req: true, options: ['Owner', 'Tenant'] }),
        f('home_type', 'Type of home', 'select', { req: true, options: ['Flat / apartment', 'Independent house / bungalow', 'Row house'] }),
        f('built_year', 'Year of construction', 'number'),
        f('carpet_area', 'Carpet area (sq ft)', 'number', { req: true }),
        f('floor', 'Floor', 'text'),
        f('security', 'Security (guard, CCTV, grills)', 'text'),
        f('vacant', 'Is the home left empty for more than 30 days at a time?', 'yesno') ] },
      { title: 'What to insure', icon: 'shieldcheck', fields: [
        f('si_building', 'Building — rebuilding cost (₹), owners only', 'number', { show: ['ownership', 'Owner'] }),
        f('si_contents', 'Furniture, appliances & electronics (₹)', 'number', { req: true }),
        f('si_jewellery', 'Jewellery & valuables (₹)', 'number'),
        f('valuables_list', 'Valuable items over ₹50,000 each (item and value)', 'textarea'),
        ...loan('home') ] },
      docs([D.pan, D.aadhaar, f('doc_ownership', 'Ownership proof / rent agreement', 'file'), f('doc_invoices', 'Invoices or valuation of valuables', 'file'), D.prevPolicy]), declaration()] },
  shop: { label: 'Shop / Office Package (SME)', group: 'Commercial', blurb: 'Shop, showroom, clinic or office.', minutes: 7,
    sections: [company('Business details'),
      { title: 'Premises', icon: 'building', fields: [
        f('premises_address', 'Address of the shop / office', 'textarea', { req: true }),
        f('premises_use', 'What the business does there', 'text', { req: true }),
        f('ownership', 'Premises are', 'select', { req: true, options: ['Owned', 'Rented'] }),
        f('area', 'Area (sq ft)', 'number'),
        f('construction', 'Construction', 'select', { options: ['RCC / pucca', 'Mixed', 'Kutcha / temporary'] }),
        f('floor', 'Floor (ground / upper / basement)', 'text'),
        f('fire_safety', 'Fire extinguishers fitted?', 'yesno'),
        f('security', 'Security (shutter locks, CCTV, alarm, guard)', 'text') ] },
      { title: 'Values to insure', icon: 'shieldcheck', fields: [
        f('si_building', 'Building (₹), owners only', 'number', { show: ['ownership', 'Owned'] }),
        f('si_furniture', 'Furniture, fixtures & fittings (₹)', 'number', { req: true }),
        f('si_stock', 'Stock (₹)', 'number'),
        f('si_electronics', 'Computers & electronic equipment (₹)', 'number'),
        f('si_cash', 'Cash kept on the premises overnight (₹)', 'number'),
        f('glass', 'Plate glass / signboard cover needed?', 'yesno'),
        f('employees', 'Number of employees', 'number'),
        ...loan('premises / stock'),
        f('claims_3yr', 'Any claim in the last 3 years?', 'yesno'),
        f('claims_details', 'Claim details', 'textarea', { show: ['claims_3yr', 'Yes'] }) ] },
      docs([D.companyPan, D.gst, f('doc_licence', 'Shop & Establishment / trade licence', 'file'), D.prevPolicy]), declaration()] },
  property: { label: 'Fire — Factory / Godown / Commercial', group: 'Commercial', blurb: 'Standard Fire & Special Perils for business premises.', minutes: 9,
    sections: [company('Insured'),
      { title: 'Risk location', icon: 'building', fields: [
        f('risk_address', 'Address of the property to be insured', 'textarea', { req: true }),
        f('occupancy', 'Occupancy — what happens there (manufacturing of …, storage of …)', 'textarea', { req: true }),
        f('construction', 'Construction', 'select', { options: ['RCC / pucca', 'Steel / PEB shed', 'Mixed', 'Kutcha / temporary'], req: true }),
        f('floors', 'Number of floors / basement', 'text'),
        f('building_age', 'Age of the building (years)', 'number'),
        f('fire_protection', 'Fire protection', 'select', { options: ['Extinguishers only', 'Extinguishers + hydrants', 'Hydrants + sprinklers', 'Full system with fire NOC'] }),
        f('fire_station_km', 'Distance to the nearest fire station (km)', 'number'),
        f('flood_area', 'Has the site ever flooded?', 'yesno') ] },
      { title: 'Sums insured', icon: 'shieldcheck', fields: [
        f('si_building', 'Building (₹)', 'number'),
        f('si_plant', 'Plant & machinery (₹)', 'number'),
        f('si_stock', 'Stock (₹)', 'number'),
        f('stock_declaration', 'Stock varies a lot — monthly declaration policy?', 'yesno'),
        f('si_furniture', 'Furniture, fixtures & fittings (₹)', 'number'),
        f('bi', 'Loss of profit (business interruption) cover needed?', 'yesno'),
        f('bi_details', 'Gross profit & indemnity period wanted', 'text', { show: ['bi', 'Yes'] }),
        f('addons', 'Add-on perils (earthquake, terrorism, burglary)', 'text'),
        ...loan('property'),
        f('claims_3yr', 'Any claim in the last 3 years?', 'yesno', { req: true }),
        f('claims_details', 'Claim details', 'textarea', { show: ['claims_3yr', 'Yes'] }) ] },
      docs([D.companyPan, D.gst, D.prevPolicy, f('doc_valuation', 'Valuation report / stock statement', 'file'), f('doc_fire_noc', 'Fire NOC', 'file'), f('doc_photos', 'Photos of the premises', 'file')]), declaration()] },
  engineering: { label: 'Engineering — CAR / EAR / Machinery', group: 'Commercial', blurb: 'Construction, erection or machinery breakdown.', minutes: 8,
    sections: [company(),
      { title: 'The project / machines', icon: 'building', fields: [
        f('eng_type', 'Cover needed', 'select', { req: true, options: ['Contractor’s All Risk (construction)', 'Erection All Risk (installation)', 'Machinery breakdown', 'Contractor’s plant & machinery'] }),
        f('project', 'Project / machinery description', 'textarea', { req: true }),
        f('site', 'Site address', 'textarea', { req: true }),
        f('contract_value', 'Contract / machinery value (₹)', 'number', { req: true }),
        f('start', 'Start date', 'date'),
        f('end', 'Expected completion', 'date'),
        f('principal', 'Principal / owner of the project', 'text'),
        f('third_party', 'Third-party liability limit wanted (₹)', 'number') ] },
      docs([D.companyPan, D.gst, f('doc_contract', 'Contract / work order / machinery list', 'file', { req: true }), D.prevPolicy]), declaration()] },
  marine: { label: 'Marine Cargo', group: 'Commercial', blurb: 'Goods in transit.', minutes: 6,
    sections: [company(),
      { title: 'Transit', icon: 'dispatch', fields: [
        f('policy_kind', 'Policy', 'select', { req: true, options: ['Open policy (all dispatches in a year)', 'Single transit'] }),
        f('commodity', 'Goods / commodity', 'text', { req: true }),
        f('packing', 'Packing', 'text'),
        f('from_to', 'From — to (cities / countries)', 'text', { req: true }),
        f('mode', 'Mode of transit', 'select', { options: ['Road', 'Rail', 'Sea', 'Air', 'Multi-modal'], req: true }),
        f('incoterm', 'Sale terms (FOB, CIF, ex-works…) for imports/exports', 'text'),
        f('turnover', 'Estimated annual turnover / dispatches (₹)', 'number', { req: true }),
        f('per_transit', 'Largest single consignment (₹)', 'number', { req: true }),
        f('claims_3yr', 'Any transit claim in the last 3 years?', 'yesno') ] },
      docs([D.companyPan, D.gst, D.prevPolicy, f('doc_invoice', 'Sample invoice / packing list', 'file')]), declaration()] },
  liability: { label: 'Liability', group: 'Commercial', blurb: 'Public, product, professional or D&O liability.', minutes: 7,
    sections: [company(),
      { title: 'Business', icon: 'chart', fields: [
        f('liab_type', 'Cover needed', 'select', { req: true, options: ['Public liability', 'Product liability', 'Professional indemnity', 'Directors & Officers', 'Cyber', 'Other'] }),
        f('activity', 'Business activity in detail', 'textarea', { req: true }),
        f('turnover', 'Annual turnover (₹)', 'number', { req: true }),
        f('export_share', 'Share of turnover from exports (%)', 'number'),
        f('staff', 'Number of employees', 'number'),
        f('limit', 'Limit of indemnity wanted (₹)', 'number', { req: true }),
        f('retro', 'Insured continuously since (retroactive date)', 'date'),
        f('claims', 'Any liability claim in the last 5 years?', 'yesno', { req: true }),
        f('claims_details', 'Claim details', 'textarea', { show: ['claims', 'Yes'] }) ] },
      docs([D.companyPan, D.gst, D.prevPolicy, f('doc_financials', 'Last audited financials (for D&O / PI)', 'file')]), declaration()] },
  wc: { label: "Workmen's Compensation", group: 'Commercial', blurb: 'Employees’ compensation cover.', minutes: 6,
    sections: [company(),
      { title: 'Workers', icon: 'users', fields: [
        f('work_location', 'Work site address', 'textarea', { req: true }),
        f('work_nature', 'Nature of work', 'text', { req: true }),
        f('workers', 'Workers by category with monthly wages', 'repeat', { req: true, min: 1, max: 10, fields: [
          f('category', 'Category (e.g. skilled, helper, driver)', 'text', { req: true }), f('count', 'Number', 'number', { req: true }), f('wages', 'Monthly wages each (₹)', 'number', { req: true })] }),
        f('medical_ext', 'Medical expenses extension needed?', 'yesno'),
        f('contractors', 'Are contract workers to be covered?', 'yesno') ] },
      docs([f('doc_workers', 'Worker list', 'file'), D.companyPan, D.gst, D.prevPolicy]), declaration()] },

  // Group
  'group-health': { label: 'Group Health (Employees)', group: 'Group', blurb: 'Mediclaim for a company’s employees.', minutes: 8,
    sections: [company(),
      { title: 'Cover', icon: 'users', fields: [
        f('employees', 'Number of employees', 'number', { req: true }),
        f('family_definition', 'Who is covered', 'select', { req: true, options: ['Employee only', 'Employee + spouse', 'Employee + spouse + 2 children', 'Employee + spouse + children + parents'] }),
        f('si_structure', 'Sum insured (flat, or by grade)', 'textarea', { req: true }),
        f('maternity', 'Maternity cover needed?', 'yesno'),
        f('ped_day1', 'Pre-existing diseases covered from day 1?', 'yesno'),
        f('room_rent', 'Room rent limit wanted', 'text'),
        f('hr_contact', 'HR contact for endorsements (name, mobile, email)', 'textarea') ] },
      { title: 'Current policy', icon: 'file', fields: [
        f('has_policy', 'Is there a group policy today?', 'yesno', { req: true }),
        f('prev_insurer', 'Insurer', 'text', { show: ['has_policy', 'Yes'], req: true }),
        f('prev_expiry', 'Expiry date', 'date', { show: ['has_policy', 'Yes'] }),
        f('doc_claims', 'Claims data for the last 3 years', 'file', { show: ['has_policy', 'Yes'] }) ] },
      docs([f('doc_census', 'Employee list (name, DOB, gender, relation, sum insured)', 'file', { req: true }), D.companyPan, D.gst, D.prevPolicy]), declaration()] },
  'group-pa': { label: 'Group Personal Accident', group: 'Group', blurb: 'Accident cover for employees.', minutes: 5,
    sections: [company(),
      { title: 'Cover', icon: 'users', fields: [
        f('employees', 'Number of employees', 'number', { req: true }),
        f('cover_basis', 'Sum insured basis', 'select', { req: true, options: ['Flat amount per employee', 'Multiple of annual salary', 'By grade'] }),
        f('cover_details', 'Amount / multiple / grade-wise details', 'textarea', { req: true }),
        f('work_nature', 'Nature of work (office / field / manual)', 'text'),
        f('ttd', 'Weekly compensation for temporary disability needed?', 'yesno') ] },
      docs([f('doc_census', 'Employee list (name, DOB, sum insured)', 'file', { req: true }), D.companyPan, D.gst, D.prevPolicy]), declaration()] },
  'group-term': { label: 'Group Term Life', group: 'Group', blurb: 'Life cover for employees.', minutes: 5,
    sections: [company(),
      { title: 'Cover', icon: 'users', fields: [
        f('employees', 'Number of employees', 'number', { req: true }),
        f('cover_basis', 'Sum assured basis', 'select', { req: true, options: ['Flat amount per employee', 'Multiple of annual salary', 'By grade'] }),
        f('cover_details', 'Amount / multiple / grade-wise details', 'textarea', { req: true }),
        f('free_cover', 'Free cover limit needed without medicals (₹)', 'number') ] },
      docs([f('doc_census', 'Member data sheet (name, DOB, gender, sum assured)', 'file', { req: true }), D.companyPan, D.gst, D.prevPolicy]), declaration()] },

  generic: { label: 'General onboarding', group: 'Other', blurb: 'KYC, address, nominee and documents.', minutes: 4,
    sections: [you(), address(), nominee(), docs([D.pan, D.aadhaar, D.prevPolicy, f('doc_other', 'Any other document', 'file')]), declaration()] },
};

// What to keep ready, worked out from each form's documents.
for (const v of Object.values(FORM_LIST)) {
  v.needs = v.sections.flatMap((s) => s.fields).filter((x) => x.type === 'file').map((x) => `${x.label}${x.req ? '' : ' (if you have it)'}`);
  v.theme = THEMES[v.group] || THEMES.Other;
}
export const FORMS = FORM_LIST;

/** The form that suits a quotation, from its product, plan type, vehicle class and (for health) how many are covered. */
export function suggestForm({ category = '', product = '', policy_type = '', members = 0, vehicle_class = '' } = {}) {
  const t = `${category} ${product} ${policy_type} ${vehicle_class}`.toLowerCase();
  if (/group health|gmc|group mediclaim/.test(t)) return 'group-health';
  if (/group personal accident|\bgpa\b/.test(t)) return 'group-pa';
  if (/group term/.test(t)) return 'group-term';
  if (/two wheeler|two-wheeler|bike|scooter|motorcycle/.test(t)) return 'motor-twowheeler';
  if (/\bgcv\b|goods|truck|tempo|tipper|tanker|pickup|tractor/.test(t)) return 'motor-goods';
  if (/\bpcv\b|taxi|cab|bus|passenger|auto.?rickshaw|school van/.test(t)) return 'motor-passenger';
  if (/motor|private car|\bcar\b|vehicle/.test(t) && !/contractor/.test(t)) return 'motor';
  if (/critical illness|\bci\b/.test(t)) return 'health-ci';
  if (/top.?up/.test(t)) return 'health-topup';
  if (/senior/.test(t)) return 'health-senior';
  if (/floater|family/.test(t) && /health|medi/.test(t)) return 'health-floater';
  if (/health|medi|mediclaim/.test(t)) return members > 1 ? 'health-floater' : 'health-individual';
  if (/pension|annuity|retirement/.test(t)) return 'life-pension';
  if (/endowment|ulip|money back|savings|child plan|guaranteed/.test(t)) return 'life-savings';
  if (/term|life/.test(t)) return 'term-life';
  if (/personal accident|\bpa\b/.test(t)) return 'pa';
  if (/travel/.test(t)) return 'travel';
  if (/householder|home|bharat griha/.test(t)) return 'home';
  if (/shop|office|sme|package|sookshma|clinic|showroom/.test(t)) return 'shop';
  if (/contractor|erection|engineering|machinery|\bcar policy\b|\bear\b/.test(t)) return 'engineering';
  if (/fire|property|laghu|factory|godown|standard fire/.test(t)) return 'property';
  if (/marine|cargo|transit/.test(t)) return 'marine';
  if (/liability|d&o|indemnity|cyber/.test(t)) return 'liability';
  if (/workmen|employees.? comp|\bwc\b/.test(t)) return 'wc';
  return 'generic';
}

// ---------- the admin's changes ----------
// Per form: { hidden: [k], required: { k: bool }, labels: { k: text }, extra: [{ section: i, field }] }.
// The declaration and the person's name can never be hidden — they are what the client signs.
const LOCKED = new Set(['consent', 'signed_by']);
export function effectiveForm(key, overrides = {}) {
  const base = FORM_LIST[key] || FORM_LIST.generic;
  const o = overrides?.[key] || {};
  const hidden = new Set((o.hidden || []).filter((k) => !LOCKED.has(k)));
  const sections = base.sections.map((s, i) => ({
    ...s,
    fields: [
      ...s.fields.filter((x) => !hidden.has(x.k)).map((x) => ({
        ...x,
        ...(o.labels?.[x.k] ? { label: o.labels[x.k] } : {}),
        ...(o.required && x.k in o.required && !LOCKED.has(x.k) ? { req: !!o.required[x.k] } : {}),
      })),
      ...(o.extra || []).filter((e) => Number(e.section) === i && e.field?.k).map((e) => ({ ...e.field, custom: true })),
    ],
  })).filter((s) => s.fields.length);
  const out = { ...base, sections };
  out.needs = sections.flatMap((s) => s.fields).filter((x) => x.type === 'file').map((x) => `${x.label}${x.req ? '' : ' (if you have it)'}`);
  return out;
}
/** The untouched form — every field, with the admin's changes marked, for the designer in Settings. */
export function designerForm(key, overrides = {}) {
  const base = FORM_LIST[key];
  if (!base) return null;
  const o = overrides?.[key] || {};
  const hidden = new Set(o.hidden || []);
  return {
    key, label: base.label, group: base.group, blurb: base.blurb, theme: base.theme,
    sections: base.sections.map((s, i) => ({
      title: s.title, icon: s.icon,
      fields: [
        ...s.fields.map((x) => ({ k: x.k, label: o.labels?.[x.k] || x.label, base_label: x.label, type: x.type, req: o.required && x.k in o.required ? !!o.required[x.k] : !!x.req,
          base_req: !!x.req, hidden: hidden.has(x.k), locked: LOCKED.has(x.k), show: x.show || null, options: x.options || null, sub: x.type === 'repeat' ? x.fields.map((sf) => sf.label) : null })),
        ...(o.extra || []).filter((e) => Number(e.section) === i).map((e) => ({ ...e.field, custom: true })),
      ],
    })),
  };
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
      if (fl.type === 'file' && fl.perMember) {
        (Array.isArray(answers[fl.perMember]) ? answers[fl.perMember] : []).forEach((row, i) => {
          if (fl.req && (fl.selfSkip === false || row?.relation !== 'Self') && !(files[`${fl.k}.${i}`] || []).length) out.push({ k: `${fl.k}.${i}`, label: `${fl.docName || fl.label} — ${row?.name || 'member ' + (i + 1)}`, msg: 'Please upload this' });
        });
        continue;
      }
      if (fl.type === 'file') { if (fl.req && !(files[fl.k] || []).length) out.push({ k: fl.k, label: fl.label, msg: 'Please upload this' }); continue; }
      if (fl.type === 'repeat') {
        const rows = Array.isArray(v) ? v : [];
        if (fl.req && rows.length < (fl.min || 1)) { out.push({ k: fl.k, label: fl.label, msg: `Add at least ${fl.min || 1}` }); continue; }
        rows.forEach((row, i) => fl.fields.forEach((sf) => {
          if (sf.req && shown(sf, row || {}) && !String(row?.[sf.k] ?? '').trim()) out.push({ k: `${fl.k}.${i}.${sf.k}`, label: `${fl.label} ${i + 1} — ${sf.label}`, msg: 'Required' });
          const sv = String(row?.[sf.k] ?? '').trim();
          if (sv && sf.range && (Number(sv) < sf.range[0] || Number(sv) > sf.range[1])) out.push({ k: `${fl.k}.${i}.${sf.k}`, label: `${fl.label} ${i + 1} — ${sf.label}`, msg: sf.range[2] });
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
      if (s && fl.range && (Number(s) < fl.range[0] || Number(s) > fl.range[1])) out.push({ k: fl.k, label: fl.label, msg: fl.range[2] });
    }
  }
  return out;
}

export const catalogue = (overrides = {}) => Object.entries(FORM_LIST).map(([key, v]) => {
  const o = overrides?.[key] || {};
  const changed = (o.hidden || []).length + Object.keys(o.required || {}).length + Object.keys(o.labels || {}).length + (o.extra || []).length;
  return { key, label: v.label, group: v.group, blurb: v.blurb, minutes: v.minutes, theme: v.theme, sections: v.sections.map((s) => s.title),
    questions: effectiveForm(key, overrides).sections.reduce((n, s) => n + s.fields.length, 0), needs: effectiveForm(key, overrides).needs, changed };
});
export { shown as fieldShown };
