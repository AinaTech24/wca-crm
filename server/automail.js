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

import { getConfig } from './ms365.js';

export const AUTO_EVENTS = [
  { tkey: 'rfq-created', label: 'RFQ created', to: 'client', desc: 'Acknowledges the enquiry when an RFQ is raised.' },
  { tkey: 'lead-created', label: 'Lead created', to: 'lead', desc: 'Thanks a new enquiry for getting in touch.' },
  { tkey: 'lead-converted', label: 'Lead converted to client', to: 'client', desc: 'Welcomes a lead once they become a client.' },
  { tkey: 'referral-thanks', label: 'Referral received', to: 'referrer', desc: 'Thanks the existing client who referred a lead.' },
  { tkey: 'quote-requested', label: 'Sent to insurers for quotes', to: 'client', desc: 'Tells the client their requirement has gone to the insurers.' },
  { tkey: 'quote-received', label: 'Insurer quote received', to: 'client', desc: 'Tells the client an insurer has responded, and how long it took.' },
  { tkey: 'quote-received-insurer', label: 'Insurer quote received — thanks', to: 'insurer', desc: 'Acknowledges the quote to the insurer who sent it.' },
  { tkey: 'quote-shared', label: 'Quote sent to client', to: 'client', desc: 'Covering note for the premium comparison.' },
  { tkey: 'quote-approved', label: 'Client approved a quote', to: 'client', desc: 'Confirms which quote the client selected.' },
  { tkey: 'quote-approved-internal', label: 'Client approved — internal copy', to: 'office', desc: 'Tells the office which quote the client took, with the full details.' },
  { tkey: 'payment-link', label: 'Payment link sent', to: 'client', desc: 'Sends the insurer payment link once the client has approved.' },
  { tkey: 'payment-received', label: 'Payment received', to: 'client', desc: 'Confirms payment and what happens next.' },
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
  'quote-requested': {
    subject: 'Your requirement has gone to the insurers — {rfq_no}',
    body: p('Dear {client},',
      'We have sent your requirement for <b>{product}</b> ({rfq_no}) to <b>{insurers}</b> on {sent_at} and are waiting for their quotes.',
      'We will update you the moment they respond.',
      'Regards,<br>{org}'),
  },
  'quote-received': {
    subject: 'Quote received from {company} — {rfq_no}',
    body: p('Dear {client},',
      '<b>{company}</b> has responded to your requirement for {product} ({rfq_no}) with a premium of <b>{premium}</b>.{took_bit}',
      'We will put the quotes side by side and share the comparison with you.',
      'Regards,<br>{org}'),
  },
  'quote-received-insurer': {
    subject: 'Quote received — {client} ({rfq_no})',
    body: p('Dear {insurer} team,',
      'Thank you — we have received your quote of <b>{premium}</b> for {client} ({product}, {rfq_no}).{took_bit}',
      'We will revert once the client decides.',
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
  'quote-approved-internal': {
    subject: 'APPROVED — {client} took {company} ({rfq_no})',
    body: p('{client} has approved a quote.',
      'RFQ: <b>{rfq_no}</b><br>Insurer: <b>{company}</b><br>Product: {product}<br>Premium: {premium}<br>IDV / Sum insured: {sum_assured}<br>Approved by: {approved_by}<br>Approved on: {approved_at}',
      'Next: request the proposal from the insurer, then send the payment link.'),
  },
  'payment-link': {
    subject: 'Payment link for your {product} policy',
    body: p('Dear {client},',
      'Thank you for confirming <b>{company}</b> for {product}{premium_bit}.',
      'You can complete the payment here:<br><a href="{payment_link}">{payment_link}</a>',
      'Cover starts only once payment is received and the insurer issues the policy, so please do complete it at your earliest.',
      'Regards,<br>{org}'),
  },
  'payment-received': {
    subject: 'Payment received — {product}',
    body: p('Dear {client},',
      'We have received your payment{premium_bit} for {product} with {company}. Thank you.',
      'The insurer is now issuing the policy. We will send you the policy document and a summary of your cover as soon as it is out.',
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
  String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null && (vars[k] !== '' || k.endsWith('_bit')) ? String(vars[k]) : m));

/** The saved template for an event, or the built-in copy if none is saved yet. */
export async function loadTemplate(db, tkey) {
  try {
    const row = await db.prepare('SELECT subject, body FROM templates WHERE tkey = ?').get(tkey);
    if (row && (row.subject || row.body)) return row;
  } catch { /* fall through to the default */ }
  return DEFAULT_TEMPLATES[tkey] || null;
}

/**
 * Which mailbox a person's mail goes out through, and whether it can: the
 * organisation's Microsoft 365 connection when that is switched on (it sends as the
 * person's own address), otherwise the person's own SMTP settings. Either way it is
 * theirs only — there is no fallback to anyone else's mailbox, because mail that
 * reads as coming from one person must not leave through another's account.
 *
 * `user` is { id } or { name }: requests know the id, background sweeps only know the
 * record owner's display name. Returns { mode, s, user, addr, from, cfg? } or { skip }.
 */
// The office address set up for an RFQ category, if there is an active one.
export async function accountForCategory(db, category) {
  if (!category) return null;
  try {
    const rows = await db.prepare('SELECT * FROM mail_accounts WHERE is_active = 1').all();
    return rows.find((r) => { try { return JSON.parse(r.categories || '[]').includes(category); } catch { return false; } }) || null;
  } catch { return null; }
}

export async function mailboxFor(db, user) {
  if (!user || (!user.id && !user.name)) return { skip: 'No sending user' };
  const u = user.id
    ? await db.prepare('SELECT id, full_name, username, email FROM users WHERE id = ?').get(user.id)
    : await db.prepare('SELECT id, full_name, username, email FROM users WHERE full_name = ? OR username = ? LIMIT 1').get(user.name, user.name);
  if (!u) return { skip: 'Sending user not found' };
  const who = u.full_name || u.username;
  const s = await db.prepare('SELECT * FROM integration_settings WHERE user_id = ?').get(u.id);

  const org = await getConfig(db);
  if (org.enabled) {
    if (!org.secret) return { mode: 'ms365', skip: 'The Microsoft 365 client secret cannot be read — an admin needs to enter it again on the Team page' };
    // Mail about an RFQ goes out as the address set up for its category (Email Setup), if there is one.
    const acct = await accountForCategory(db, user.category);
    if (acct) return { mode: 'ms365', cfg: org, s: s || {}, user: u, addr: acct.email, account: acct, from: '"' + (acct.display_name || acct.email) + '" <' + acct.email + '>' };
    if (!u.email) return { mode: 'ms365', skip: who + ' has no email address — add it on the Team page' };
    return { mode: 'ms365', cfg: org, s: s || {}, user: u, addr: u.email, from: '"' + who + '" <' + u.email + '>' };
  }

  if (!s || Number(s.email_enabled) !== 1 || !s.smtp_host || !s.smtp_user || !s.smtp_pass) {
    return { mode: 'smtp', skip: who + ' has no email set up in My Profile' };
  }
  const addr = s.smtp_from_email || u.email || s.smtp_user;
  return { mode: 'smtp', s, user: u, addr, from: '"' + (s.smtp_from_name || who || s.smtp_user) + '" <' + addr + '>' };
}

/** The same, for an automatic mail: also needs this person's automatic-mail switch on. */
export async function senderFor(db, user) {
  const m = await mailboxFor(db, user);
  if (!m.s) return m;
  if (Number(m.s.auto_mail_enabled) !== 1) return { ...m, s: null, skip: 'Automatic email is off for ' + (m.user.full_name || m.user.username), quiet: true };
  return m;
}

/** Whether this user has automatic mail switched on (and a working mailbox). */
export async function autoMailEnabled(db, user) {
  try { return !!(await senderFor(db, user)).s; } catch { return false; }
}
