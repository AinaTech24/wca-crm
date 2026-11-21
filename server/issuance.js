// Policy issuance — from the client's approval to the policy in their inbox, on the quotation.
//
//   1. Sent to insurer      the approved quote, the client's onboarding details and documents, by email
//                           (automatically once the onboarding form is in, if switched on)
//   2. Proposal received    the insurer's proposal form, kept with every version
//      Changes requested    what we asked the insurer to correct, emailed to them
//   3. Final proposal       confirmed (optionally sent to the client to check first)
//   4. Payment link         from the insurer, sent on to the client
//   5. Payment              the client's payment proof, sent on to the insurer
//   6. Medical check        optional — when the insurer calls the client for a medical (health), after payment
//   7. Underwriting         optional — the insurer's underwriter: query, accepted, accepted with conditions
//                           (extra premium / exclusions, with the client's consent) or declined
//   8. Policy issued        the policy PDF and number — the policy record is updated and mailed to the client
//
// Every document is kept (record_attachments, parent 'issuance'); every step leaves an event with who and when.

import { isTravel, tripForQuote, daysUntil } from './travel.js';
import { FORMS, fieldShown, effectiveForm } from './onboardingForms.js';
import { bmiOf, bmiText } from './bmi.js';

const istNow = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 16);
const today = () => istNow().slice(0, 10);
const parseJ = (v, fb) => { if (v && typeof v === 'object') return v; try { const x = JSON.parse(v || ''); return x ?? fb; } catch { return fb; } };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const inr = (n) => (Number(n) > 0 ? 'Rs. ' + Number(n).toLocaleString('en-IN') : '');
const FILE_TYPES = /^data:(application\/pdf|image\/(jpeg|jpg|png|webp|heic|heif));base64,/i;
const bytesOf = (uri) => Math.round((String(uri).split(',').pop() || '').length * 0.75);
const MAX_MAIL = 13 * 1024 * 1024;
const emailsOf = (v) => String(v || '').split(/[,;\s]+/).map((x) => x.trim()).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const short = (n) => String(n || '').toLowerCase().replace(/general|insurance|company|co\.|ltd\.?|limited|&|the|allied|health/g, ' ').replace(/\s+/g, ' ').trim();

export const STEPS = [
  { key: 'sent', label: 'Sent to insurer' },
  { key: 'proposal', label: 'Proposal received', canSkip: true },
  { key: 'final', label: 'Final proposal' },
  { key: 'link', label: 'Payment link', canSkip: true },
  { key: 'paid', label: 'Payment' },
  { key: 'medical', label: 'Medical check', optional: true, flag: 'medical_required' },
  { key: 'underwriting', label: 'Underwriting', optional: true, flag: 'uw_required' },
  { key: 'issued', label: 'Policy issued' },
];

export async function registerIssuance(app, h) {
  const { db, auth, scope, emit, emitRow, notify, sendAuto, sendPolicyMails, getQuoteApi } = h;

  await db.exec(`
    CREATE TABLE IF NOT EXISTS issuance (
      id SERIAL PRIMARY KEY,
      quotation_id INTEGER UNIQUE NOT NULL,
      insurer TEXT,
      insurer_email TEXT,
      sent_at TEXT, sent_by TEXT,
      proposals TEXT DEFAULT '[]',
      changes TEXT DEFAULT '[]',
      final_at TEXT, final_by TEXT,
      client_verify_at TEXT,
      medical_required INTEGER DEFAULT 0,
      medical_status TEXT, medical_date TEXT, medical_note TEXT,
      payment_link TEXT, payment_link_at TEXT, payment_link_sent_at TEXT,
      proofs TEXT DEFAULT '[]',
      paid_at TEXT, payment_ref TEXT, payment_amount REAL,
      proof_sent_at TEXT,
      policy_id INTEGER, policy_no TEXT, issued_at TEXT, policy_doc_id INTEGER, policy_mailed_at TEXT,
      events TEXT DEFAULT '[]',
      department TEXT,
      created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
    );
  `);
  // Not every insurer sends a proposal form to verify — the step (and the final-proposal one with it) can be skipped.
  await db.exec('ALTER TABLE issuance ADD COLUMN IF NOT EXISTS proposal_skipped TEXT; ALTER TABLE issuance ADD COLUMN IF NOT EXISTS proposal_skipped_by TEXT;');
  // Often the insurer sends the payment link straight to the client — then that step is skipped too.
  await db.exec('ALTER TABLE issuance ADD COLUMN IF NOT EXISTS link_skipped TEXT; ALTER TABLE issuance ADD COLUMN IF NOT EXISTS link_skipped_by TEXT;');
  // Underwriting (optional): not every policy goes to the insurer's underwriter.
  await db.exec(`ALTER TABLE issuance ADD COLUMN IF NOT EXISTS uw_required INTEGER DEFAULT 0; ALTER TABLE issuance ADD COLUMN IF NOT EXISTS uw_status TEXT;
    ALTER TABLE issuance ADD COLUMN IF NOT EXISTS uw_note TEXT; ALTER TABLE issuance ADD COLUMN IF NOT EXISTS uw_loading REAL; ALTER TABLE issuance ADD COLUMN IF NOT EXISTS uw_conditions TEXT;
    ALTER TABLE issuance ADD COLUMN IF NOT EXISTS uw_client_ok_at TEXT; ALTER TABLE issuance ADD COLUMN IF NOT EXISTS uw_updated_at TEXT;`);
  // Extra premium asked by the underwriter, and the refund when they decline.
  await db.exec(`ALTER TABLE issuance ADD COLUMN IF NOT EXISTS uw_extra_link TEXT; ALTER TABLE issuance ADD COLUMN IF NOT EXISTS uw_extra_link_sent_at TEXT;
    ALTER TABLE issuance ADD COLUMN IF NOT EXISTS uw_extra_paid_at TEXT; ALTER TABLE issuance ADD COLUMN IF NOT EXISTS uw_extra_ref TEXT;
    ALTER TABLE issuance ADD COLUMN IF NOT EXISTS uw_refund_amount REAL; ALTER TABLE issuance ADD COLUMN IF NOT EXISTS uw_refund_date TEXT;
    ALTER TABLE issuance ADD COLUMN IF NOT EXISTS uw_refund_ref TEXT; ALTER TABLE issuance ADD COLUMN IF NOT EXISTS uw_refund_mailed_at TEXT;`);
  const setting = async (k, fb) => (await db.prepare('SELECT value FROM app_settings WHERE key = ?').get(k))?.value ?? fb;

  // ---------- helpers ----------
  async function quoteOf(req, qid) {
    const q = await db.prepare('SELECT * FROM quotations WHERE id = ?').get(qid);
    if (!q) return { code: 404, error: 'Quotation not found' };
    if (req) {
      const sc = await scope(req);
      if (!sc.all && sc.department && q.department && q.department !== sc.department) return { code: 403, error: 'That quotation belongs to another department.' };
    }
    if (!['Approved', 'Converted'].includes(q.status)) return { code: 400, error: 'Policy issuance starts once the client approves the quotation' };
    return { q };
  }
  const wonOf = (q) => parseJ(q.options, []).find((o) => o.approved) || null;

  /** The insurer's address for this business: the RFQ's, the quotation option's, or the insurer contact list's. */
  async function insurerEmail(q, won) {
    if (q.rfq_id) {
      const rfq = await db.prepare('SELECT insurers FROM rfqs WHERE id = ?').get(q.rfq_id);
      const i = parseJ(rfq?.insurers, []).find((x) => same(x.insurer, won?.insurer));
      if (emailsOf(i?.email).length) return emailsOf(i.email).join(', ');
    }
    if (emailsOf(won?.email).length) return emailsOf(won.email).join(', ');
    const motor = /motor/i.test(`${q.category} ${q.product}`);
    for (const c of await db.prepare('SELECT * FROM insurer_contacts').all()) {
      if (same(c.name, won?.insurer) || (short(c.name) && short(c.name) === short(won?.insurer))) {
        const list = emailsOf(motor ? c.motor_emails : c.non_motor_emails);
        if (list.length) return list.join(', ');
      }
    }
    return '';
  }

  async function rowFor(q) {
    let r = await db.prepare('SELECT * FROM issuance WHERE quotation_id = ?').get(q.id);
    if (!r) {
      const won = wonOf(q);
      // Health and critical illness: medical check and underwriting on by default. Personal accident and travel: off
      // (switch on for a policy that needs them — e.g. a senior traveller, or hazardous work).
      const health = /health|medi|critical/i.test(`${q.category} ${q.product} ${won?.plan || ''}`) && !/personal accident|travel/i.test(`${q.category} ${q.product}`);
      await db.prepare(`INSERT INTO issuance (quotation_id, insurer, insurer_email, medical_required, uw_required, department, policy_id) VALUES (?,?,?,?,?,?,?) ON CONFLICT (quotation_id) DO NOTHING`)
        .run(q.id, won?.insurer || q.approved_insurer || '', await insurerEmail(q, won), health ? 1 : 0, health ? 1 : 0, q.department || null, q.policy_id || null);
      r = await db.prepare('SELECT * FROM issuance WHERE quotation_id = ?').get(q.id);
    }
    return r;
  }
  async function patch(r, fields, event) {
    const cols = Object.keys(fields);
    const events = parseJ(r.events, []);
    if (event) events.push({ at: istNow(), ...event });
    await db.prepare(`UPDATE issuance SET ${[...cols.map((c) => `${c} = ?`), 'events = ?'].join(', ')} WHERE id = ?`)
      .run(...cols.map((c) => fields[c]), JSON.stringify(events), r.id);
    const fresh = await db.prepare('SELECT * FROM issuance WHERE id = ?').get(r.id);
    emit('issuance', 'updated', { id: fresh.id, quotation_id: fresh.quotation_id });
    return fresh;
  }
  async function storeFile(r, kind, file, by) {
    if (!file?.data || !FILE_TYPES.test(file.data)) throw Object.assign(new Error('Upload a PDF or an image'), { code: 400 });
    const size = bytesOf(file.data);
    if (size > 10 * 1024 * 1024) throw Object.assign(new Error('The file is larger than 10 MB'), { code: 400 });
    const name = `${kind} · ${String(file.name || 'document').replace(/[\\/:*?"<>|]+/g, '').slice(0, 120)}`;
    const info = await db.prepare('INSERT INTO record_attachments (parent_kind, parent_id, file_name, file_type, file_size, data, owner) VALUES (?,?,?,?,?,?,?)')
      .run('issuance', r.id, name, /^data:([^;]+)/.exec(file.data)[1], size, file.data, by || '');
    return { id: info.lastInsertRowid, name, size };
  }
  const fileData = async (id) => db.prepare('SELECT file_name, data FROM record_attachments WHERE id = ?').get(id);
  const by = (req) => ({ id: req?.user?.id });
  const sender = (req, q) => ({ ...(req ? { id: req.user.id } : {}), ...(q.category ? { category: q.category } : {}) });
  async function senderFallback(q) {
    const owner = q.assigned_to ? await db.prepare("SELECT id FROM users WHERE COALESCE(NULLIF(full_name, ''), username) = ?").get(q.assigned_to) : null;
    const admin = await db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
    return { id: owner?.id || admin?.id, ...(q.category ? { category: q.category } : {}) };
  }

  /** The client's onboarding answers as an HTML block for the insurer, and the documents that came with them. */
  async function onboardingPack(q) {
    const ob = await db.prepare("SELECT * FROM onboarding_requests WHERE quotation_id = ? AND status IN ('Submitted', 'Reviewed') ORDER BY id DESC LIMIT 1").get(q.id);
    if (!ob) return { html: '', files: [], ok: false };
    let o = {};
    try { o = JSON.parse((await setting('onboarding_overrides', '{}')) || '{}') || {}; } catch { o = {}; }
    const form = effectiveForm(FORMS[ob.form_type] ? ob.form_type : 'generic', o);
    const a = parseJ(ob.answers, {});
    const parts = [];
    for (const sec of form.sections) {
      const rows = [];
      for (const f of sec.fields) {
        if (!fieldShown(f, a) || ['file', 'declaration'].includes(f.type)) continue;
        if (f.type === 'repeat') {
          const withBmi = f.fields.some((sf) => sf.k === 'weight_kg');
          const cols = withBmi ? [...f.fields, { k: '_bmi', label: 'BMI' }] : f.fields;
          const list = (Array.isArray(a[f.k]) ? a[f.k] : []).map((row) => (withBmi ? { ...row, _bmi: bmiText(bmiOf(row?.height_cm, row?.weight_kg, row?.dob)) } : row));
          if (!list.length) continue;
          rows.push(`<tr><td colspan="2" style="padding:6px 8px"><table style="border-collapse:collapse;width:100%;font-size:12px"><tr>${cols.map((sf) => `<th style="border:1px solid #d8dee8;padding:4px 6px;background:#f2f5f9;text-align:left">${esc(sf.label)}</th>`).join('')}</tr>${list.map((row) => `<tr>${cols.map((sf) => `<td style="border:1px solid #d8dee8;padding:4px 6px">${esc(row[sf.k] || '')}</td>`).join('')}</tr>`).join('')}</table></td></tr>`);
          continue;
        }
        if (!String(a[f.k] ?? '').trim()) continue;
        rows.push(`<tr><td style="padding:5px 8px;border-bottom:1px solid #eef1f5;color:#5b6b80;width:42%">${esc(f.label)}</td><td style="padding:5px 8px;border-bottom:1px solid #eef1f5"><b>${esc(a[f.k])}</b></td></tr>`);
        if (f.k === 'weight_kg') { const b = bmiOf(a.height_cm, a.weight_kg, a.dob); if (b) rows.push(`<tr><td style="padding:5px 8px;border-bottom:1px solid #eef1f5;color:#5b6b80">BMI</td><td style="padding:5px 8px;border-bottom:1px solid #eef1f5"><b>${esc(bmiText(b))}</b></td></tr>`); }
      }
      if (rows.length) parts.push(`<tr><td colspan="2" style="padding:10px 8px 4px;font-weight:bold;color:#0e3a5f;border-bottom:2px solid #e9531e">${esc(sec.title)}</td></tr>${rows.join('')}`);
    }
    const files = [];
    for (const x of parseJ(ob.files, [])) {
      const att = x.attachment_id ? await fileData(x.attachment_id) : null;
      const [base, idx] = String(x.field).split('.');
      const def = form.sections.flatMap((s) => s.fields).find((f) => f.k === base);
      const member = def?.perMember && idx !== undefined ? (a[def.perMember] || [])[Number(idx)] : null;
      const label = member ? `${def.docName || 'ID proof'} - ${member.name || 'member ' + (Number(idx) + 1)}` : (def?.label || 'Document');
      if (att?.data) files.push({ filename: x.name ? `${label.replace(/[\\/:*?"<>|]+/g, '')} - ${x.name}` : att.file_name, uri: att.data });
    }
    return { html: `<table style="border-collapse:collapse;width:100%;max-width:640px;font-size:13px">${parts.join('')}</table>`, files, ok: true, form: form.label };
  }
  async function quoteDoc(q, won) {
    if (won?.quote_doc) return { filename: `Quote - ${won.insurer}.pdf`, uri: won.quote_doc };
    if (q.rfq_id) {
      const rfq = await db.prepare('SELECT insurers FROM rfqs WHERE id = ?').get(q.rfq_id);
      const i = parseJ(rfq?.insurers, []).find((x) => same(x.insurer, won?.insurer));
      if (i?.quote_doc) return { filename: `Quote - ${won.insurer}.${/pdf/.test(i.quote_doc.slice(0, 30)) ? 'pdf' : 'jpg'}`, uri: i.quote_doc };
    }
    return null;
  }
  const trim = (files) => { let n = 0; return files.filter((f) => { n += bytesOf(f.uri); return n <= MAX_MAIL; }); };
  const quoteBlock = (q, won) => `<table style="border-collapse:collapse;font-size:13px"><tr><td style="padding:3px 10px 3px 0;color:#5b6b80">Quotation</td><td><b>${esc(q.quote_no)}${q.version > 1 ? ' v' + q.version : ''}</b></td></tr>
    <tr><td style="padding:3px 10px 3px 0;color:#5b6b80">Product</td><td><b>${esc(q.product || q.category)}</b></td></tr>
    <tr><td style="padding:3px 10px 3px 0;color:#5b6b80">Approved premium</td><td><b>${esc(inr(won?.premium))}</b></td></tr>
    ${Number(won?.idv || q.sum_assured) ? `<tr><td style="padding:3px 10px 3px 0;color:#5b6b80">Sum insured / IDV</td><td><b>${esc(inr(won?.idv || q.sum_assured))}</b></td></tr>` : ''}
    ${(won?.addons_incl || []).length ? `<tr><td style="padding:3px 10px 3px 0;color:#5b6b80">Add-ons</td><td>${esc(won.addons_incl.join(', '))}</td></tr>` : ''}</table>`;

  // ---------- step 1: to the insurer ----------
  async function sendToInsurer(q, r, { req, to, note } = {}) {
    const won = wonOf(q);
    const addr = emailsOf(to || r.insurer_email);
    if (!addr.length) return { status: 400, body: { error: `No email for ${won?.insurer || 'the insurer'} — add it to send` } };
    const pack = await onboardingPack(q);
    const qd = await quoteDoc(q, won);
    const files = trim([...(qd ? [qd] : []), ...pack.files]);
    const result = await sendAuto('insurer-proposal-request', addr.join(', '), {
      client: q.client_name, company: won?.insurer || '', product: q.product || q.category, quote_no: q.quote_no,
      quote_block: quoteBlock(q, won), details_block: pack.ok ? pack.html : '<i>The client’s onboarding details will follow.</i>',
      note_bit: note ? `<br><br><b>Note:</b> ${esc(note)}` : '', documents: files.map((f) => esc(f.filename)).join('<br>') || 'None attached',
    }, { kind: 'quotation', id: q.id }, files, req ? sender(req, q) : await senderFallback(q));
    if (result !== 'sent') return { status: 400, body: { error: result === 'skipped' ? 'The email could not go out — check the mailbox in Email Setup (or switch automatic email on)' : 'The email failed — see the email log' } };
    const fresh = await patch(r, { sent_at: istNow(), sent_by: req?.user?.name || 'Automatic', insurer_email: addr.join(', ') },
      { step: 'sent', text: `Sent to ${won?.insurer || 'insurer'} (${addr.join(', ')}) with ${files.length} document(s)${pack.ok ? ' and the onboarding details' : ''}`, by: req?.user?.name || 'Automatic' });
    return { status: 200, body: { ok: true, files: files.length, row: fresh } };
  }

  // Called when the client's onboarding form comes in.
  async function onOnboardingSubmitted(quotationId) {
    try {
      if ((await setting('issuance_auto_insurer', '1')) !== '1') return;
      const q = await db.prepare('SELECT * FROM quotations WHERE id = ?').get(quotationId);
      if (!q || !['Approved', 'Converted'].includes(q.status)) return;
      const r = await rowFor(q);
      if (r.sent_at) return;
      const out = await sendToInsurer(q, r, {});
      await notify({ entity: 'issuance', kind: 'issuance-sent', icon: out.status === 200 ? 'send' : 'alert', tone: out.status === 200 ? 'info' : 'warning', refTable: 'quotations', refId: q.id,
        title: out.status === 200 ? 'Sent to insurer for the proposal' : 'Could not send to the insurer',
        body: `${q.client_name} — ${out.status === 200 ? r.insurer : out.body.error}`, link: `/page/quotation?open=${q.id}` });
    } catch (e) { console.error('issuance auto-send failed:', e.message); }
  }

  // ---------- reading ----------
  function view(r, q, trip = null) {
    const proposals = parseJ(r.proposals, []);
    const medicalDone = !r.medical_required || ['Done', 'Not needed'].includes(r.medical_status);
    const done = {
      sent: !!r.sent_at, proposal: proposals.length > 0 || !!r.proposal_skipped, final: !!r.final_at || !!r.proposal_skipped, medical: medicalDone,
      link: !!r.payment_link_sent_at || !!r.link_skipped, paid: !!r.paid_at, issued: !!r.issued_at,
      underwriting: !r.uw_required || r.uw_status === 'Accepted' || (r.uw_status === 'Accepted with conditions' && !!r.uw_client_ok_at && !(Number(r.uw_loading) > 0 && !r.uw_extra_paid_at)),
    };
    const next = STEPS.find((s) => !done[s.key] && !(s.flag && !r[s.flag]));
    return {
      ...r, proposals, changes: parseJ(r.changes, []), proofs: parseJ(r.proofs, []), events: parseJ(r.events, []).slice().reverse(),
      done, next: next?.key || null, steps: STEPS, trip: trip ? { ...trip, to_depart: daysUntil(trip.depart) } : null, quote: { id: q.id, quote_no: q.quote_no, status: q.status, policy_id: q.policy_id, email: q.email, mobile: q.mobile, client_name: q.client_name },
    };
  }
  async function load(req, res, qid) {
    const { q, code, error } = await quoteOf(req, qid);
    if (!q) { res.status(code).json({ error }); return null; }
    return { q, r: await rowFor(q) };
  }
  app.get('/api/issuance/:qid', auth, async (req, res) => {
    const x = await load(req, res, req.params.qid); if (!x) return;
    const ob = await db.prepare("SELECT status FROM onboarding_requests WHERE quotation_id = ? AND status <> 'Cancelled' ORDER BY id DESC LIMIT 1").get(x.q.id);
    res.json({ ...view(x.r, x.q, await tripForQuote(db, x.q)), onboarding: ob?.status || null });
  });

  const act = (fn) => async (req, res) => {
    try {
      const x = await load(req, res, req.params.qid); if (!x) return;
      const out = await fn(req, x.q, x.r);
      if (out?.status && out.status !== 200) return res.status(out.status).json(out.body);
      const r = await db.prepare('SELECT * FROM issuance WHERE id = ?').get(x.r.id);
      const q = await db.prepare('SELECT * FROM quotations WHERE id = ?').get(x.q.id);
      await emitRow('quotation', 'updated', 'quotations', q.id);
      res.json({ ...view(r, q, await tripForQuote(db, q)), ...(out?.extra || {}) });
    } catch (e) {
      if (e.code === 400) return res.status(400).json({ error: e.message });
      console.error('issuance step failed:', e.message);
      res.status(500).json({ error: 'Could not complete this step' });
    }
  };

  app.post('/api/issuance/:qid/insurer-email', auth, act(async (req, q, r) => {
    const list = emailsOf(req.body?.email);
    if (!list.length) return { status: 400, body: { error: 'Enter a valid email' } };
    await patch(r, { insurer_email: list.join(', ') }, null);
  }));
  app.post('/api/issuance/:qid/send-insurer', auth, act(async (req, q, r) => sendToInsurer(q, r, { req, to: req.body?.to, note: req.body?.note })));

  // ---------- step 2/3: proposals ----------
  app.post('/api/issuance/:qid/proposal', auth, act(async (req, q, r) => {
    const final = !!req.body?.final;
    const f = await storeFile(r, final ? 'Final proposal' : 'Proposal', req.body?.file, req.user.name);
    const list = parseJ(r.proposals, []);
    list.push({ v: list.length + 1, attachment_id: f.id, name: req.body?.file?.name || f.name, at: istNow(), by: req.user.name || '', status: final ? 'Final' : 'For verification', note: String(req.body?.note || '').slice(0, 500) });
    await patch(r, { proposals: JSON.stringify(list), proposal_skipped: null, proposal_skipped_by: null, ...(final ? { final_at: istNow(), final_by: req.user.name || '' } : {}) },
      { step: final ? 'final' : 'proposal', text: `${final ? 'Final proposal' : 'Proposal'} v${list.length} received from the insurer`, by: req.user.name || '' });
  }));
  // Skip the proposal step (no proposal form from this insurer), or undo the skip.
  app.post('/api/issuance/:qid/skip-proposal', auth, act(async (req, q, r) => {
    const skip = req.body?.skip !== false;
    if (skip && parseJ(r.proposals, []).length) return { status: 400, body: { error: 'A proposal is already uploaded — confirm it as final instead' } };
    await patch(r, skip ? { proposal_skipped: istNow(), proposal_skipped_by: req.user.name || '' } : { proposal_skipped: null, proposal_skipped_by: null },
      { step: 'proposal', text: skip ? 'Proposal step skipped — no proposal needed from the insurer' : 'Proposal step back on — waiting for the insurer’s proposal', by: req.user.name || '' });
  }));
  app.post('/api/issuance/:qid/changes', auth, act(async (req, q, r) => {
    const note = String(req.body?.note || '').trim();
    if (!note) return { status: 400, body: { error: 'Write what needs to change' } };
    const list = parseJ(r.proposals, []);
    const last = list[list.length - 1];
    if (!last) return { status: 400, body: { error: 'Upload the proposal first' } };
    let mailed = false;
    if (req.body?.mail !== false && emailsOf(r.insurer_email).length) {
      const doc = await fileData(last.attachment_id);
      mailed = (await sendAuto('insurer-proposal-changes', emailsOf(r.insurer_email).join(', '), {
        client: q.client_name, company: r.insurer, product: q.product || q.category, quote_no: q.quote_no, version: `v${last.v}`, changes: esc(note).replace(/\n/g, '<br>'),
      }, { kind: 'quotation', id: q.id }, doc ? [{ filename: last.name, uri: doc.data }] : [], sender(req, q))) === 'sent';
    }
    last.status = 'Changes requested';
    const changes = parseJ(r.changes, []);
    changes.push({ at: istNow(), by: req.user.name || '', note, v: last.v, mailed });
    await patch(r, { proposals: JSON.stringify(list), changes: JSON.stringify(changes), final_at: null },
      { step: 'proposal', text: `Changes requested on proposal v${last.v}${mailed ? ' — emailed to the insurer' : ''}: ${note.slice(0, 140)}`, by: req.user.name || '' });
  }));
  app.post('/api/issuance/:qid/final', auth, act(async (req, q, r) => {
    const list = parseJ(r.proposals, []);
    const last = list[list.length - 1];
    if (!last) return { status: 400, body: { error: 'Upload the proposal first' } };
    last.status = 'Final';
    await patch(r, { proposals: JSON.stringify(list), final_at: istNow(), final_by: req.user.name || '' },
      { step: 'final', text: `Proposal v${last.v} confirmed as final`, by: req.user.name || '' });
  }));
  // Send the latest proposal to the client to check their details.
  app.post('/api/issuance/:qid/client-verify', auth, act(async (req, q, r) => {
    const list = parseJ(r.proposals, []);
    const last = list[list.length - 1];
    if (!last) return { status: 400, body: { error: 'Upload the proposal first' } };
    if (!q.email) return { status: 400, body: { error: 'No client email on the quotation' } };
    const doc = await fileData(last.attachment_id);
    const sent = await sendAuto('proposal-verify', q.email, { client: q.client_name, company: r.insurer, product: q.product || q.category },
      { kind: 'quotation', id: q.id }, doc ? [{ filename: last.name, uri: doc.data }] : [], sender(req, q));
    if (sent !== 'sent') return { status: 400, body: { error: 'The email could not go out — check the email setup' } };
    await patch(r, { client_verify_at: istNow() }, { step: 'proposal', text: `Proposal v${last.v} sent to the client to check`, by: req.user.name || '' });
  }));

  // ---------- step 6: medical (optional, after payment) ----------
  app.post('/api/issuance/:qid/medical', auth, act(async (req, q, r) => {
    const b = req.body || {};
    const fields = {};
    if (b.required !== undefined) fields.medical_required = b.required ? 1 : 0;
    if (b.status !== undefined) fields.medical_status = ['Pending', 'Scheduled', 'Done', 'Not needed'].includes(b.status) ? b.status : 'Pending';
    if (b.date !== undefined) fields.medical_date = /^\d{4}-\d{2}-\d{2}/.test(b.date || '') ? b.date : null;
    if (b.note !== undefined) fields.medical_note = String(b.note || '').slice(0, 500);
    if (b.file?.data) {
      const f = await storeFile(r, 'Medical report', b.file, req.user.name);
      const list = parseJ(r.proofs, []);
      fields.proofs = JSON.stringify([...list, { kind: 'medical', attachment_id: f.id, name: b.file.name, at: istNow() }]);
    }
    let mailed = false;
    if (b.notify_client && q.email && (fields.medical_status === 'Scheduled' || b.status === 'Scheduled')) {
      mailed = (await sendAuto('medical-check', q.email, { client: q.client_name, company: r.insurer, product: q.product || q.category, date_bit: fields.medical_date ? ` on ${fields.medical_date.split('-').reverse().join('-')}` : '' },
        { kind: 'quotation', id: q.id }, [], sender(req, q))) === 'sent';
    }
    const text = fields.medical_required === 0 ? 'Medical check not needed' : `Medical check: ${fields.medical_status || r.medical_status || 'Pending'}${fields.medical_date ? ' on ' + fields.medical_date : ''}${mailed ? ' — client informed' : ''}`;
    await patch(r, fields, { step: 'medical', text, by: req.user.name || '' });
  }));

  // ---------- step 7: underwriting (optional) ----------
  const UW = ['With underwriter', 'Query raised', 'Accepted', 'Accepted with conditions', 'Declined'];
  app.post('/api/issuance/:qid/underwriting', auth, act(async (req, q, r) => {
    const b = req.body || {};
    const fields = { uw_updated_at: istNow() };
    let text = '';
    if (b.required !== undefined) { fields.uw_required = b.required ? 1 : 0; text = b.required ? 'Underwriting added — the policy goes to the insurer’s underwriter' : 'Underwriting not needed'; }
    if (b.status !== undefined) {
      if (!UW.includes(b.status)) return { status: 400, body: { error: 'Choose the underwriting status' } };
      fields.uw_status = b.status;
      if (b.status !== 'Accepted with conditions') fields.uw_client_ok_at = null;
    }
    if (b.note !== undefined) fields.uw_note = String(b.note || '').slice(0, 1000);
    if (b.loading !== undefined) fields.uw_loading = Number(b.loading) > 0 ? Number(b.loading) : null;
    if (b.conditions !== undefined) fields.uw_conditions = String(b.conditions || '').slice(0, 1000);
    const status = fields.uw_status || r.uw_status;
    if ((status === 'Query raised') && b.status !== undefined && !String(fields.uw_note ?? r.uw_note ?? '').trim()) return { status: 400, body: { error: 'Write what the underwriter asked for' } };
    if (b.client_ok) {
      if (status !== 'Accepted with conditions') return { status: 400, body: { error: 'Only conditions need the client’s consent' } };
      fields.uw_client_ok_at = istNow();
      text = 'Client accepted the underwriter’s conditions';
    }
    if (b.file?.data) {
      const f = await storeFile(r, 'Underwriter letter', b.file, req.user.name);
      fields.proofs = JSON.stringify([...parseJ(r.proofs, []), { kind: 'underwriting', attachment_id: f.id, name: b.file.name, at: istNow() }]);
    }
    // Tell the client: what the underwriter needs, or the conditions they are asked to accept.
    let mailed = false;
    if (b.notify_client && q.email && b.status !== undefined && ['Query raised', 'Accepted with conditions'].includes(status)) {
      const vars = { client: q.client_name, company: r.insurer, product: q.product || q.category, uw_note: String(fields.uw_note ?? r.uw_note ?? '').trim() || '—',
        conditions: String(fields.uw_conditions ?? r.uw_conditions ?? '').trim() || '—',
        loading_bit: Number(fields.uw_loading ?? r.uw_loading) > 0 ? ` and an extra premium of ${inr(fields.uw_loading ?? r.uw_loading)}` : '' };
      mailed = (await sendAuto(status === 'Query raised' ? 'uw-query' : 'uw-conditions', q.email, vars, { kind: 'quotation', id: q.id }, [], sender(req, q))) === 'sent';
    }
    if (b.status !== undefined) {
      const loading = Number(fields.uw_loading ?? r.uw_loading) > 0 ? ` · extra premium ${inr(fields.uw_loading ?? r.uw_loading)}` : '';
      text = `Underwriting: ${status}${status === 'Accepted with conditions' ? loading : ''}${String(fields.uw_note ?? '').trim() ? ' — ' + String(fields.uw_note).trim().slice(0, 140) : ''}${mailed ? ' (client emailed)' : ''}`;
    }
    await patch(r, fields, text ? { step: 'underwriting', text, by: req.user.name || '' } : null);
    if (status === 'Declined' && b.status === 'Declined') {
      await notify({ entity: 'quotation', kind: 'uw-declined', icon: 'alert', tone: 'danger', refTable: 'quotations', refId: q.id,
        title: 'Underwriter declined', body: `${q.client_name} — ${r.insurer}${fields.uw_note ? ': ' + fields.uw_note.slice(0, 100) : ''}`, link: `/page/quotation?open=${q.id}` }).catch(() => {});
    }
    return { extra: { mailed } };
  }));

  // Extra premium from the underwriter's conditions: a link to the client, then the payment (proof to the insurer).
  app.post('/api/issuance/:qid/uw-extra-link', auth, act(async (req, q, r) => {
    const link = String(req.body?.link || '').trim();
    if (!(r.uw_status === 'Accepted with conditions' && Number(r.uw_loading) > 0)) return { status: 400, body: { error: 'No extra premium is due' } };
    if (!/^https?:\/\/\S+$/i.test(link)) return { status: 400, body: { error: 'Paste the full payment link (starting with https://)' } };
    let sent = false;
    if (q.email) sent = (await sendAuto('uw-extra-payment', q.email, { client: q.client_name, company: r.insurer, product: q.product || q.category, amount: inr(r.uw_loading), payment_link: link },
      { kind: 'quotation', id: q.id }, [], sender(req, q))) === 'sent';
    await patch(r, { uw_extra_link: link, ...(sent ? { uw_extra_link_sent_at: istNow() } : {}) },
      { step: 'underwriting', text: `Extra premium link (${inr(r.uw_loading)}) ${sent ? 'emailed to the client' : 'saved'}`, by: req.user.name || '' });
    return { extra: { emailed: sent } };
  }));
  app.post('/api/issuance/:qid/uw-extra-paid', auth, act(async (req, q, r) => {
    const b = req.body || {};
    if (!(r.uw_status === 'Accepted with conditions' && Number(r.uw_loading) > 0)) return { status: 400, body: { error: 'No extra premium is due' } };
    const proofs = parseJ(r.proofs, []);
    const files = [];
    for (const file of (Array.isArray(b.files) ? b.files : []).slice(0, 3)) {
      const f = await storeFile(r, 'Extra premium proof', file, req.user.name);
      proofs.push({ kind: 'uw-extra', attachment_id: f.id, name: file.name, at: istNow() });
      files.push({ filename: file.name, uri: file.data });
    }
    if (!files.length && !String(b.ref || '').trim()) return { status: 400, body: { error: 'Upload the payment proof or enter the payment reference' } };
    const paidAt = /^\d{4}-\d{2}-\d{2}/.test(b.paid_at || '') ? b.paid_at : today();
    let toInsurer = false;
    if (b.notify_insurer !== false && emailsOf(r.insurer_email).length) {
      toInsurer = (await sendAuto('insurer-payment-done', emailsOf(r.insurer_email).join(', '), {
        client: q.client_name, company: r.insurer, product: q.product || q.category, quote_no: q.quote_no,
        payment_ref: b.ref || '—', paid_on: paidAt.split('-').reverse().join('-'), amount: inr(r.uw_loading) + ' (extra premium as per the underwriter’s terms)',
      }, { kind: 'quotation', id: q.id }, trim(files), sender(req, q))) === 'sent';
    }
    await patch(r, { proofs: JSON.stringify(proofs), uw_extra_paid_at: paidAt, uw_extra_ref: String(b.ref || '').slice(0, 100) },
      { step: 'underwriting', text: `Extra premium ${inr(r.uw_loading)} paid${b.ref ? ' (ref ' + b.ref + ')' : ''}${toInsurer ? ' — proof sent to the insurer' : ''}`, by: req.user.name || '' });
    return { extra: { toInsurer } };
  }));
  // Declined: the premium comes back from the insurer — record it and tell the client.
  app.post('/api/issuance/:qid/refund', auth, act(async (req, q, r) => {
    const b = req.body || {};
    if (r.uw_status !== 'Declined') return { status: 400, body: { error: 'A refund is recorded when the underwriter declines' } };
    const amount = Number(b.amount);
    if (!(amount > 0)) return { status: 400, body: { error: 'Enter the refund amount' } };
    const date = /^\d{4}-\d{2}-\d{2}/.test(b.date || '') ? b.date : today();
    let mailed = false;
    if (b.notify_client && q.email) mailed = (await sendAuto('uw-refund', q.email, { client: q.client_name, company: r.insurer, product: q.product || q.category, amount: inr(amount),
      date_bit: ` on ${date.split('-').reverse().join('-')}`, ref_bit: b.ref ? ` (reference ${String(b.ref).slice(0, 60)})` : '' }, { kind: 'quotation', id: q.id }, [], sender(req, q))) === 'sent';
    await patch(r, { uw_refund_amount: amount, uw_refund_date: date, uw_refund_ref: String(b.ref || '').slice(0, 100), ...(mailed ? { uw_refund_mailed_at: istNow() } : {}) },
      { step: 'underwriting', text: `Refund of ${inr(amount)} from the insurer on ${date.split('-').reverse().join('-')}${b.ref ? ' (ref ' + b.ref + ')' : ''}${mailed ? ' — client informed' : ''}`, by: req.user.name || '' });
    return { extra: { mailed } };
  }));

  // ---------- step 4/5: payment ----------
  app.post('/api/issuance/:qid/payment-link', auth, act(async (req, q, r) => {
    const link = String(req.body?.link || '').trim();
    if (!/^https?:\/\/\S+$/i.test(link)) return { status: 400, body: { error: 'Paste the full payment link (starting with https://)' } };
    let sent = false;
    if (req.body?.send !== false && q.email) {
      const won = wonOf(q);
      sent = (await sendAuto('payment-link', q.email, {
        client: q.client_name, company: r.insurer, product: q.product || q.category, payment_link: link,
        premium: inr(won?.premium), premium_bit: Number(won?.premium) > 0 ? ` at ${inr(won.premium)}` : '',
      }, { kind: 'quotation', id: q.id }, [], sender(req, q))) === 'sent';
    }
    if (q.rfq_id) await db.prepare('UPDATE rfqs SET payment_link = ? WHERE id = ?').run(link, q.rfq_id);
    await patch(r, { payment_link: link, payment_link_at: istNow(), link_skipped: null, link_skipped_by: null, ...(sent ? { payment_link_sent_at: istNow() } : {}) },
      { step: 'link', text: `Payment link received${sent ? ' and emailed to the client' : ''}`, by: req.user.name || '' });
    return { extra: { emailed: sent } };
  }));
  // The insurer sends the payment link to the client themselves: skip the step (or undo that).
  app.post('/api/issuance/:qid/skip-link', auth, act(async (req, q, r) => {
    const skip = req.body?.skip !== false;
    if (skip && r.payment_link_sent_at) return { status: 400, body: { error: 'The payment link has already been sent to the client' } };
    await patch(r, skip ? { link_skipped: istNow(), link_skipped_by: req.user.name || '' } : { link_skipped: null, link_skipped_by: null },
      { step: 'link', text: skip ? 'Payment link step skipped — the insurer sends it to the client directly' : 'Payment link step back on', by: req.user.name || '' });
  }));
  app.post('/api/issuance/:qid/payment-link-shared', auth, act(async (req, q, r) => {
    if (!r.payment_link) return { status: 400, body: { error: 'Add the payment link first' } };
    await patch(r, { payment_link_sent_at: istNow() }, { step: 'link', text: `Payment link shared with the client${req.body?.via ? ' on ' + req.body.via : ''}`, by: req.user.name || '' });
  }));
  app.post('/api/issuance/:qid/payment', auth, act(async (req, q, r) => {
    const b = req.body || {};
    const proofs = parseJ(r.proofs, []);
    const files = [];
    for (const file of (Array.isArray(b.files) ? b.files : []).slice(0, 5)) {
      const f = await storeFile(r, 'Payment proof', file, req.user.name);
      proofs.push({ kind: 'payment', attachment_id: f.id, name: file.name, at: istNow() });
      files.push({ filename: file.name, uri: file.data });
    }
    if (!proofs.some((x) => x.kind === 'payment') && !b.ref) return { status: 400, body: { error: 'Upload the payment proof or enter the payment reference' } };
    const paidAt = /^\d{4}-\d{2}-\d{2}/.test(b.paid_at || '') ? b.paid_at : today();
    const won = wonOf(q);
    let toInsurer = false, toClient = false;
    if (b.notify_insurer !== false && emailsOf(r.insurer_email).length) {
      toInsurer = (await sendAuto('insurer-payment-done', emailsOf(r.insurer_email).join(', '), {
        client: q.client_name, company: r.insurer, product: q.product || q.category, quote_no: q.quote_no,
        payment_ref: b.ref || '—', paid_on: paidAt.split('-').reverse().join('-'), amount: inr(b.amount || won?.premium) || '—',
      }, { kind: 'quotation', id: q.id }, trim(files), sender(req, q))) === 'sent';
    }
    if (b.notify_client !== false && q.email) {
      toClient = (await sendAuto('payment-received', q.email, {
        client: q.client_name, company: r.insurer, product: q.product || q.category, premium_bit: Number(b.amount || won?.premium) > 0 ? ` of ${inr(b.amount || won?.premium)}` : '',
      }, { kind: 'quotation', id: q.id }, [], sender(req, q))) === 'sent';
    }
    if (q.rfq_id) await db.prepare("UPDATE rfqs SET paid_at = COALESCE(NULLIF(paid_at, ''), ?) WHERE id = ?").run(istNow(), q.rfq_id);
    // Paid: a lead becomes a client now (with the onboarding details and documents).
    const conv = await Promise.resolve(h.ensureClient?.(q.id, req.user.name || '')).catch((e) => { console.error('[issuance] lead to client', e.message); return null; });
    await patch(r, { proofs: JSON.stringify(proofs), paid_at: paidAt, payment_ref: b.ref || r.payment_ref || '', payment_amount: Number(b.amount) || r.payment_amount || null, ...(toInsurer ? { proof_sent_at: istNow() } : {}) },
      { step: 'paid', text: `Payment received${b.ref ? ' (ref ' + b.ref + ')' : ''}${toInsurer ? ' — proof sent to the insurer' : ''}${toClient ? ', client thanked' : ''}${conv?.made ? ' · lead converted to client' : ''}`, by: req.user.name || '' });
    return { extra: { toInsurer, toClient, clientMade: !!conv?.made, clientId: conv?.clientId || null } };
  }));

  // ---------- step 7: the policy ----------
  app.post('/api/issuance/:qid/policy', auth, act(async (req, q, r) => {
    const b = req.body || {};
    const no = String(b.policy_no || '').trim();
    if (!no) return { status: 400, body: { error: 'Enter the policy number' } };
    if (r.uw_required && r.uw_status === 'Declined') return { status: 400, body: { error: 'The underwriter declined this proposal — change the underwriting status first if that has changed' } };
    if (!b.file?.data) return { status: 400, body: { error: 'Upload the policy PDF from the insurer' } };
    const iso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '');
    // The quotation becomes a policy now if it has not already.
    let policyId = q.policy_id;
    if (!policyId) {
      const out = await getQuoteApi().convertQuote(req, q);
      if (out.status !== 200) return out;
      policyId = out.body.policyId;
    }
    const f = await storeFile(r, 'Policy', b.file, req.user.name);
    const from = iso(b.period_from), to = iso(b.period_to);
    await db.prepare(`UPDATE policies SET policy_number = ?, policy_status = 'Issued', policy_doc = ?, policy_doc_name = ?,
      period_from = COALESCE(NULLIF(?, ''), period_from), period_to = COALESCE(NULLIF(?, ''), period_to),
      payment_date = COALESCE(NULLIF(payment_date, ''), ?) WHERE id = ?`)
      .run(no, b.file.data, `Policy ${no}.pdf`, from, to, r.paid_at || '', policyId);
    // The policy copy also goes into the client's files.
    const p = await db.prepare('SELECT * FROM policies WHERE id = ?').get(policyId);
    if (p.client_id) await db.prepare('INSERT INTO record_attachments (parent_kind, parent_id, file_name, file_type, file_size, data, owner) VALUES (?,?,?,?,?,?,?)')
      .run('client', p.client_id, `Policy ${no} · ${b.file.name || 'policy.pdf'}`.slice(0, 240), /^data:([^;]+)/.exec(b.file.data)[1], f.size, b.file.data, req.user.name || '');
    if (q.rfq_id) await db.prepare("UPDATE rfqs SET policy_status = 'Issued', policy_no = ? WHERE id = ?").run(no, q.rfq_id);
    // Mailed to the client once, with the policy attached.
    let mailed = false;
    if (b.send_client !== false) {
      const claim = await db.prepare("UPDATE policies SET issued_mail_sent = ? WHERE id = ? AND COALESCE(issued_mail_sent, '') = ''").run(istNow(), policyId);
      if (claim.changes) mailed = (await sendPolicyMails(req, await db.prepare('SELECT * FROM policies WHERE id = ?').get(policyId))).sent === 'sent';
    }
    await patch(r, { policy_id: policyId, policy_no: no, issued_at: istNow(), policy_doc_id: f.id, ...(mailed ? { policy_mailed_at: istNow() } : {}) },
      { step: 'issued', text: `Policy ${no} issued${mailed ? ' — sent to the client' : ''}`, by: req.user.name || '' });
    await emitRow('policy', 'updated', 'policies', policyId);
    // Payin (and the associate's payout) at the agreed rates, now that the policy is issued.
    await h.autoCommissions?.(policyId);
    await notify({ entity: 'policy', kind: 'issued', icon: 'file', tone: 'success', refTable: 'policies', refId: policyId,
      title: 'Policy issued', body: `${q.client_name} · ${no} · ${r.insurer}`, link: `/page/policy?open=${policyId}` });
    return { extra: { policyId, mailed } };
  }));

  // Settings → Onboarding & issuance
  app.get('/api/settings/issuance', auth, async (req, res) => res.json({ auto_insurer: (await setting('issuance_auto_insurer', '1')) === '1' }));
  app.put('/api/settings/issuance', auth, async (req, res) => {
    const u = await db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id);
    if (u?.role !== 'admin') return res.status(403).json({ error: 'Only an admin can change this' });
    await db.prepare("INSERT INTO app_settings (key, value) VALUES ('issuance_auto_insurer', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(req.body?.auto_insurer ? '1' : '0');
    res.json({ auto_insurer: !!req.body?.auto_insurer });
  });

  // ---------- reminders to the team ----------
  async function sweep() {
    try {
      const rows = await db.prepare('SELECT i.*, q.client_name, q.quote_no, q.id AS qid, q.category, q.product, q.rfq_id FROM issuance i JOIN quotations q ON q.id = i.quotation_id WHERE i.issued_at IS NULL').all();
      // Dates are stored as 'YYYY-MM-DD HH:MM' or just 'YYYY-MM-DD' (payment dates) — both count.
      const days = (t) => { if (!t) return 0; const s = String(t); const ms = Date.parse(s.length <= 10 ? s + 'T00:00:00+05:30' : s.replace(' ', 'T').slice(0, 16) + ':00+05:30'); return Number.isFinite(ms) ? (Date.now() - ms) / 86400000 : 0; };
      for (const r of rows) {
        let why = '', kind = '';
        // Travel: the policy has to be in the client's hands before they fly.
        const trip = isTravel(r.category, r.product) ? await tripForQuote(db, { id: r.qid, category: r.category, product: r.product, rfq_id: r.rfq_id }) : null;
        const left = trip?.depart ? daysUntil(trip.depart) : null;
        if (left !== null && left < 0 && r.uw_status !== 'Declined') { why = 'Client has already departed — travel policy not issued'; kind = 'issuance-travel-departed'; }
        else if (left !== null && left <= 3 && r.uw_status !== 'Declined') { why = `Departs in ${left <= 0 ? 'less than a day' : left + ' day' + (left === 1 ? '' : 's')} — travel policy not issued`; kind = 'issuance-travel-depart'; }
        if (kind) { /* travel deadline */ }
        else {
        // Underwriting that has not moved for 3 days.
        if (Number(r.uw_required) === 1 && r.paid_at) {
          const since = r.uw_updated_at || r.paid_at;
          if ((!r.uw_status || r.uw_status === 'With underwriter') && days(since) >= 3) { why = 'With the underwriter for 3+ days'; kind = 'issuance-uw-wait'; }
          else if (r.uw_status === 'Query raised' && days(since) >= 3) { why = 'Underwriter query open for 3+ days'; kind = 'issuance-uw-query'; }
          else if (r.uw_status === 'Accepted with conditions' && !r.uw_client_ok_at && days(since) >= 3) { why = 'Client has not accepted the underwriter’s conditions'; kind = 'issuance-uw-consent'; }
          else if (r.uw_status === 'Accepted with conditions' && r.uw_client_ok_at && Number(r.uw_loading) > 0 && !r.uw_extra_paid_at && days(r.uw_client_ok_at) >= 3) { why = 'Extra premium not paid yet'; kind = 'issuance-uw-extra'; }
          else if (r.uw_status === 'Declined' && !r.uw_refund_date && days(since) >= 3) { why = 'Refund from the insurer not recorded'; kind = 'issuance-uw-refund'; }
          else if (r.uw_status === 'Declined') continue;
        }
        if (why) { /* underwriting reminder */ }
        else if (r.sent_at && !r.proposal_skipped && parseJ(r.proposals, []).length === 0 && days(r.sent_at) >= 2) why = 'No proposal from the insurer yet';
        else if ((r.payment_link_sent_at || r.link_skipped) && !r.paid_at && days(r.payment_link_sent_at || r.link_skipped) >= 2) why = 'Client has not paid yet';
        else if (r.paid_at && !r.issued_at && days(r.paid_at) >= 3) why = 'Paid, policy not issued yet';
        }
        if (!why) continue;
        if (!kind) kind = 'issuance-wait-' + why.split(' ')[0].toLowerCase();
        const seen = await db.prepare('SELECT 1 FROM notifications WHERE kind = ? AND ref_table = ? AND ref_id = ?').get(kind, 'issuance', r.id);
        if (seen) continue;
        await notify({ entity: 'issuance', kind, icon: 'clock', tone: 'warning', refTable: 'issuance', refId: r.id,
          title: why, body: `${r.client_name} · ${r.quote_no} · ${r.insurer}`, link: `/page/quotation?open=${r.quotation_id}` });
      }
    } catch (e) { console.error('issuance sweep failed:', e.message); }
  }
  setTimeout(sweep, 2 * 60 * 1000);
  setInterval(sweep, 3 * 60 * 60 * 1000);

  return { onOnboardingSubmitted };
}
