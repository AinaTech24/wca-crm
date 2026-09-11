// Automatic outbound email.
//
// Every automatic mail is a template the user can edit in Email Templates,
// keyed by the event that triggers it. The copy below is only the starting
// point — once a template with the matching key exists in the database, that
// wins, so changing what customers receive never means changing this file.
//
// Nothing here throws. An automation failing must never take down the action
// that triggered it: a client is still created even if the welcome mail
// bounces, and the attempt is written to email_log either way so there's a
// record of what went out and what didn't.

export const AUTO_EVENTS = [
  { tkey: 'rfq-created', label: 'RFQ created', to: 'client', desc: 'Acknowledges the enquiry when an RFQ is raised.' },
  { tkey: 'lead-created', label: 'Lead created', to: 'lead', desc: 'Thanks a new enquiry for getting in touch.' },
  { tkey: 'lead-converted', label: 'Lead converted to client', to: 'client', desc: 'Welcomes a lead once they become a client.' },
  { tkey: 'referral-thanks', label: 'Referral received', to: 'referrer', desc: 'Thanks the existing client who referred a lead.' },
  { tkey: 'quote-shared', label: 'Quote sent to client', to: 'client', desc: 'Covering note for the premium comparison.' },
  { tkey: 'quote-approved', label: 'Client approved a quote', to: 'client', desc: 'Confirms which quote the client selected.' },
  { tkey: 'policy-issued', label: 'Policy created', to: 'client', desc: 'Policy details once the policy is on the books.' },
  { tkey: 'policy-coverages', label: 'Policy coverages', to: 'client', desc: 'What the policy covers, in plain terms.' },
  { tkey: 'claim-guide', label: 'How to claim', to: 'client', desc: 'Claim process, documents and checklist.' },
  { tkey: 'renewal-due', label: 'Renewal due', to: 'client', desc: 'Sent automatically as a policy approaches expiry.' },
];

const p = (...lines) => lines.join('<br><br>');

// Starting copy. Deliberately plain — it goes out under the user's name, and
// anything clever here is something they'd have to undo.
export const DEFAULT_TEMPLATES = {
  'rfq-created': {
    subject: 'We have received your requirement — {rfq_no}',
    body: p('Dear {client},',
      'Thank you for your enquiry for <b>{product}</b>. We have raised reference <b>{rfq_no}</b> and are approaching insurers for the most competitive terms.',
      'We will come back to you with a comparison shortly.',
      'Regards,<br>{org}'),
  },
  'lead-created': {
    subject: 'Thank you for getting in touch',
    body: p('Dear {client},',
      'Thank you for your interest in <b>{product}</b>. One of our advisers will contact you shortly to understand your requirement.',
      'Regards,<br>{org}'),
  },
  'lead-converted': {
    subject: 'Welcome to {org}',
    body: p('Dear {client},',
      'Welcome aboard. Your account is now active with us and we will look after your insurance requirements from here on.',
      'Do keep this address handy — renewals, policy documents and claim support all come from here.',
      'Regards,<br>{org}'),
  },
  'referral-thanks': {
    subject: 'Thank you for the referral',
    body: p('Dear {client},',
      'Thank you for referring <b>{lead_name}</b> to us. We appreciate the trust, and we will look after them properly.',
      'Regards,<br>{org}'),
  },
  'quote-shared': {
    subject: 'Your premium comparison — {product}',
    body: p('Dear {client},',
      'Please find attached the premium comparison for <b>{product}</b>.',
      'Do let us know which option you would like to proceed with and we will take it forward.',
      'Regards,<br>{org}'),
  },
  'quote-approved': {
    subject: 'Confirmed — {company} for {product}',
    body: p('Dear {client},',
      'Thank you for confirming <b>{company}</b> at <b>{premium}</b> for {product}.',
      'We are requesting the proposal from the insurer and will share the payment details shortly.',
      'Regards,<br>{org}'),
  },
  'policy-issued': {
    subject: 'Your policy {policy_no} is issued',
    body: p('Dear {client},',
      'Your policy is now in force. The details are below.',
      'Policy Number: <b>{policy_no}</b><br>Insurer: {company}<br>Product: {product}<br>Cover: {sum_assured}<br>Premium: {premium}<br>Period: {period}',
      'Please keep this for your records. We will remind you well before renewal.',
      'Regards,<br>{org}'),
  },
  'policy-coverages': {
    subject: 'What your policy {policy_no} covers',
    body: p('Dear {client},',
      'A quick summary of what <b>{policy_no}</b> with {company} covers:',
      '{coverages}',
      'If anything here is not what you expected, tell us now rather than at claim time.',
      'Regards,<br>{org}'),
  },
  'claim-guide': {
    subject: 'How to claim on policy {policy_no}',
    body: p('Dear {client},',
      'If you ever need to claim on <b>{policy_no}</b>, here is what to do.',
      '1. Call us first — before anything else, so we can guide the intimation.<br>'
      + '2. Intimate the insurer within the time limit stated in your policy.<br>'
      + '3. Keep the loss as it is until the surveyor has seen it, where one is appointed.',
      '<b>Documents usually required</b><br>Policy copy · Claim form · Photo ID · Proof of loss (bills, FIR, medical papers as applicable) · Payment proof · Bank details for settlement',
      'Regards,<br>{org}'),
  },
  'renewal-due': {
    subject: 'Renewal due — {policy_no} expires {expiry}',
    body: p('Dear {client},',
      'Your policy <b>{policy_no}</b> with {company} for {product} expires on <b>{expiry}</b>.',
      'Let us know and we will get renewal terms for you. Cover must be continuous — a lapse can mean losing your no-claim benefit and leaves you uninsured in between.',
      'Regards,<br>{org}'),
  },
};

/** Replaces {token} with its value; an unknown token is left visible rather than blanked. */
export const fillTokens = (text, vars) =>
  String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null && vars[k] !== '' ? String(vars[k]) : m));

/** The saved template for an event, or the built-in copy if none is saved yet. */
export async function loadTemplate(db, tkey) {
  try {
    const row = await db.prepare('SELECT subject, body FROM templates WHERE tkey = ?').get(tkey);
    if (row && (row.subject || row.body)) return row;
  } catch { /* fall through to the default */ }
  return DEFAULT_TEMPLATES[tkey] || null;
}

/**
 * SMTP for an automation, which has no logged-in user behind it. Takes the
 * first enabled, fully-configured mailbox — in a single-office CRM there is
 * only one, and sending from "whoever happens to be logged in" would be worse.
 */
export async function anySmtp(db) {
  const s = await db.prepare(`SELECT * FROM integration_settings
    WHERE COALESCE(email_enabled,0) = 1
      AND NULLIF(smtp_host,'') IS NOT NULL
      AND NULLIF(smtp_user,'') IS NOT NULL
      AND NULLIF(smtp_pass,'') IS NOT NULL
    ORDER BY user_id LIMIT 1`).get();
  return s || null;
}

/** Whether automatic mail is switched on at all. Off unless explicitly enabled. */
export async function autoMailEnabled(db) {
  try {
    const s = await db.prepare('SELECT COALESCE(auto_mail_enabled, 0) AS on FROM integration_settings ORDER BY user_id LIMIT 1').get();
    return Number(s?.on) === 1;
  } catch { return false; }
}
