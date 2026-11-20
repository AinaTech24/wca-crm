// Client onboarding — after the client approves a quotation, they get a link to a short form made for
// their kind of policy (health individual / floater / senior / top-up, motor, term life, group health,
// fire, marine…). What they fill in comes straight into the CRM: onto the client record (blank fields
// filled, differences flagged for review), their documents into the client's files, and the whole
// submission kept with the quotation.
//
// The form is public (the client has no login) and is reached only through a long random link that
// expires. A submission is checked against the same form definition the page was drawn from.

import crypto from 'crypto';
import { FORMS, suggestForm, checkAnswers, normalise, catalogue, fieldShown, effectiveForm, designerForm } from './onboardingForms.js';

const APP_URL = (process.env.APP_URL || 'https://crm.wecareassurance.com').replace(/\/+$/, '');
const istNow = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 16);
const addDays = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const parseJ = (v, fb) => { if (v && typeof v === 'object') return v; try { const x = JSON.parse(v || ''); return x ?? fb; } catch { return fb; } };
const MAX_FILE = 6 * 1024 * 1024, MAX_TOTAL = 15 * 1024 * 1024;
const FILE_TYPES = /^data:(application\/pdf|image\/(jpeg|jpg|png|webp|heic|heif));base64,/i;
const bytesOf = (uri) => Math.round((String(uri).split(',').pop() || '').length * 0.75);
const dmy = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso || '') ? iso.slice(0, 10).split('-').reverse().join('-') : '');

// The caller's address (the CRM sits behind nginx, which passes it on).
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
// A small brake on the public endpoints: per address, per minute.
const HITS = new Map();
function slowDown(ip, limit) {
  const now = Date.now(), k = ip + ':' + Math.floor(now / 60000);
  const n = (HITS.get(k) || 0) + 1;
  HITS.set(k, n);
  if (HITS.size > 5000) for (const key of HITS.keys()) if (!key.endsWith(':' + Math.floor(now / 60000))) HITS.delete(key);
  return n > limit;
}

export async function registerOnboarding(app, h) {
  const { db, auth, scope, emit, emitRow, notify, sendAuto } = h;

  await db.exec(`
    CREATE TABLE IF NOT EXISTS onboarding_requests (
      id SERIAL PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      quotation_id INTEGER,
      rfq_id INTEGER,
      client_id INTEGER,
      client_name TEXT,
      email TEXT,
      mobile TEXT,
      product TEXT,
      form_type TEXT NOT NULL,
      status TEXT DEFAULT 'Sent',
      sent_at TEXT,
      sent_via TEXT,
      opened_at TEXT,
      submitted_at TEXT,
      expires_at TEXT,
      answers TEXT DEFAULT '{}',
      files TEXT DEFAULT '[]',
      applied TEXT DEFAULT '[]',
      conflicts TEXT DEFAULT '[]',
      reminder_sent INTEGER DEFAULT 0,
      reviewed_by TEXT,
      reviewed_at TEXT,
      department TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
    );
    CREATE INDEX IF NOT EXISTS idx_onboarding_quote ON onboarding_requests (quotation_id);
    CREATE INDEX IF NOT EXISTS idx_onboarding_client ON onboarding_requests (client_id);
  `);
  const setting = async (k, fb) => (await db.prepare('SELECT value FROM app_settings WHERE key = ?').get(k))?.value ?? fb;
  const cfg = async () => ({ auto: (await setting('onboarding_auto_send', '1')) === '1', days: Math.min(Math.max(Number(await setting('onboarding_valid_days', '30')) || 30, 3), 90) });
  const linkOf = (r) => `${APP_URL}/onboard/${r.token}`;
  // The admin's changes to the forms (Settings → Onboarding form → a form).
  const overrides = async () => { try { return JSON.parse((await setting('onboarding_overrides', '{}')) || '{}') || {}; } catch { return {}; } };
  const formFor = async (type) => effectiveForm(FORMS[type] ? type : 'generic', await overrides());
  const get = (id) => db.prepare('SELECT * FROM onboarding_requests WHERE id = ?').get(id);
  const announce = (r) => emit('onboarding', 'updated', { id: r.id, quotation_id: r.quotation_id, client_id: r.client_id });

  // Who the mail goes out as: the quotation's owner, else the first admin; the category's office mailbox wins.
  async function senderFor(q, userId) {
    const owner = q?.assigned_to ? await db.prepare("SELECT id FROM users WHERE COALESCE(NULLIF(full_name, ''), username) = ?").get(q.assigned_to) : null;
    const admin = await db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
    return { id: userId || owner?.id || admin?.id, ...(q?.category ? { category: q.category } : {}) };
  }

  async function sendMail(r, q, userId, kind = 'onboarding-form') {
    if (!r.email) return 'no-email';
    const result = await sendAuto(kind, r.email, {
      client: r.client_name, product: r.product || q?.product || 'insurance', company: q?.approved_insurer || q?.selected_insurer || '',
      quote_no: q?.quote_no || '', link: linkOf(r), expiry: dmy(r.expires_at), form: FORMS[r.form_type]?.label || 'onboarding',
    }, { kind: 'client', id: r.client_id || null }, [], await senderFor(q, userId));
    return result;
  }

  /** Makes (or reuses) the request for a quotation and emails the link. */
  async function createFor(q, { formType, userId, actor = '', send = true } = {}) {
    let r = await db.prepare("SELECT * FROM onboarding_requests WHERE quotation_id = ? AND status NOT IN ('Cancelled') ORDER BY id DESC LIMIT 1").get(q.id);
    const { days } = await cfg();
    if (!r) {
      let members = 0, vehicle = '', healthType = '';
      if (q.rfq_id) {
        const rfq = await db.prepare('SELECT details FROM rfqs WHERE id = ?').get(q.rfq_id);
        const d = parseJ(rfq?.details, {});
        members = Array.isArray(d.health_members) ? d.health_members.length : Number(d.total_members) || 0;
        vehicle = d.vehicle_class || '';
        healthType = d.rh_type || d.family_def || '';
      }
      const won = parseJ(q.options, []).find((o) => o.approved) || parseJ(q.options, []).find((o) => o.recommended) || {};
      const type = FORMS[formType] ? formType : suggestForm({ category: q.category, product: `${q.product || ''} ${won.plan || ''}`, policy_type: `${q.policy_type || ''} ${healthType}`, members, vehicle_class: vehicle });
      const token = crypto.randomBytes(24).toString('hex');
      const info = await db.prepare(`INSERT INTO onboarding_requests (token, quotation_id, rfq_id, client_id, client_name, email, mobile, product, form_type, status, expires_at, department, created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(token, q.id, q.rfq_id || null, q.client_id || null, q.client_name, q.email || '', q.mobile || '',
        q.product || q.category || '', type, 'Ready', addDays(days), q.department || null, actor);
      r = await get(info.lastInsertRowid);
    } else if (formType && FORMS[formType] && formType !== r.form_type && !['Submitted', 'Reviewed'].includes(r.status)) {
      await db.prepare('UPDATE onboarding_requests SET form_type = ? WHERE id = ?').run(formType, r.id);
      r = await get(r.id);
    }
    let mail = null;
    if (send && !['Submitted', 'Reviewed'].includes(r.status)) {
      mail = await sendMail(r, q, userId);
      const via = mail === 'sent' ? 'Email' : '';
      await db.prepare(`UPDATE onboarding_requests SET status = CASE WHEN status IN ('Ready', 'Expired') THEN 'Sent' ELSE status END, sent_at = ?,
        sent_via = COALESCE(NULLIF(?, ''), sent_via), expires_at = CASE WHEN expires_at < ? THEN ? ELSE expires_at END, reminder_sent = 0 WHERE id = ?`)
        .run(istNow(), via, addDays(0), addDays(days), r.id);
      r = await get(r.id);
    }
    announce(r);
    return { request: r, mail };
  }

  // Called when a quotation is approved — by the quotation module, from either side of the journey.
  async function autoSend(q, userId, actor) {
    try {
      if (!(await cfg()).auto || !q?.id) return null;
      const exists = await db.prepare("SELECT id FROM onboarding_requests WHERE quotation_id = ? AND status <> 'Cancelled'").get(q.id);
      if (exists) return null;
      const out = await createFor(q, { userId, actor: actor || 'Automatic' });
      await notify({ entity: 'onboarding', kind: 'onboarding-sent', icon: 'send', tone: 'info', refTable: 'quotations', refId: q.id,
        title: 'Onboarding form sent', body: `${q.client_name} — ${FORMS[out.request.form_type]?.label}${out.mail === 'sent' ? ' (emailed)' : ' — no email went out; share the link'}`, link: `/page/quotation?open=${q.id}` });
      return out;
    } catch (e) { console.error('onboarding auto-send failed:', e.message); return null; }
  }

  // ---------- in the CRM ----------
  const denyDept = async (req, r) => {
    const sc = await scope(req);
    return !sc.all && sc.department && r.department && r.department !== sc.department;
  };
  const view = (r, full = false) => ({
    ...r, link: linkOf(r), form_label: FORMS[r.form_type]?.label || r.form_type,
    answers: full ? parseJ(r.answers, {}) : undefined, files: parseJ(r.files, []), applied: parseJ(r.applied, []), conflicts: parseJ(r.conflicts, []),
    expired: r.expires_at && r.expires_at < addDays(0) && !['Submitted', 'Reviewed'].includes(r.status),
  });

  app.get('/api/onboarding-forms', auth, async (req, res) => res.json(catalogue(await overrides())));
  // Settings → the form designer (admin): every field with its changes, and the form as the client will see it.
  app.get('/api/settings/onboarding-forms/:key', auth, async (req, res) => {
    const o = await overrides();
    const d = designerForm(req.params.key, o);
    if (!d) return res.status(404).json({ error: 'No such form' });
    res.json({ ...d, preview: effectiveForm(req.params.key, o), base: FORMS[req.params.key] });
  });
  app.put('/api/settings/onboarding-forms/:key', auth, async (req, res) => {
    const u = await db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id);
    if (u?.role !== 'admin') return res.status(403).json({ error: 'Only an admin can change the forms' });
    const base = FORMS[req.params.key];
    if (!base) return res.status(404).json({ error: 'No such form' });
    const b = req.body || {};
    const known = new Set(base.sections.flatMap((s) => s.fields.map((x) => x.k)));
    const TYPES = ['text', 'textarea', 'number', 'date', 'select', 'yesno', 'file'];
    const extra = (Array.isArray(b.extra) ? b.extra : []).slice(0, 30).map((e, i) => {
      const t = TYPES.includes(e?.field?.type) ? e.field.type : 'text';
      const label = String(e?.field?.label || '').trim().slice(0, 200);
      if (!label) return null;
      const options = t === 'select' ? String(Array.isArray(e.field.options) ? e.field.options.join(',') : e.field.options || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 30) : undefined;
      if (t === 'select' && !(options || []).length) return null;
      const k = /^x_[a-z0-9]{4,12}$/.test(e?.field?.k || '') ? e.field.k : 'x_' + Math.random().toString(36).slice(2, 8) + i;
      return { section: Math.max(0, Math.min(Number(e.section) || 0, base.sections.length - 1)), field: { k, label, type: t, req: !!e.field.req, ...(options ? { options } : {}) } };
    }).filter(Boolean);
    const clean = {
      hidden: (Array.isArray(b.hidden) ? b.hidden : []).filter((k) => known.has(k) && !['consent', 'signed_by'].includes(k)),
      required: Object.fromEntries(Object.entries(b.required || {}).filter(([k]) => known.has(k) && !['consent', 'signed_by'].includes(k)).map(([k, v]) => [k, !!v])),
      labels: Object.fromEntries(Object.entries(b.labels || {}).filter(([k, v]) => known.has(k) && String(v || '').trim()).map(([k, v]) => [k, String(v).trim().slice(0, 200)])),
      extra,
    };
    const all = await overrides();
    const empty = !clean.hidden.length && !Object.keys(clean.required).length && !Object.keys(clean.labels).length && !clean.extra.length;
    if (empty) delete all[req.params.key]; else all[req.params.key] = clean;
    await db.prepare("INSERT INTO app_settings (key, value) VALUES ('onboarding_overrides', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(JSON.stringify(all));
    const d = designerForm(req.params.key, all);
    res.json({ ...d, preview: effectiveForm(req.params.key, all), base: FORMS[req.params.key] });
  });
  app.get('/api/onboarding', auth, async (req, res) => {
    const where = [], p = [];
    if (req.query.quotation_id) { where.push('quotation_id = ?'); p.push(Number(req.query.quotation_id)); }
    if (req.query.client_id) { where.push('client_id = ?'); p.push(Number(req.query.client_id)); }
    const rows = await db.prepare(`SELECT * FROM onboarding_requests${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 200`).all(...p);
    const sc = await scope(req);
    res.json(rows.filter((r) => sc.all || !sc.department || !r.department || r.department === sc.department).map((r) => view(r)));
  });
  app.get('/api/onboarding/:id', auth, async (req, res) => {
    const r = await get(req.params.id);
    if (!r || await denyDept(req, r)) return res.status(404).json({ error: 'Not found' });
    res.json({ ...view(r, true), form: await formFor(r.form_type) });
  });
  // Send (or send again) for a quotation, with the form chosen.
  app.post('/api/onboarding', auth, async (req, res) => {
    const q = await db.prepare('SELECT * FROM quotations WHERE id = ?').get(req.body?.quotation_id);
    if (!q) return res.status(404).json({ error: 'Quotation not found' });
    const sc = await scope(req);
    if (!sc.all && sc.department && q.department && q.department !== sc.department) return res.status(403).json({ error: 'That quotation belongs to another department.' });
    if (!q.email && req.body?.send !== false) return res.status(400).json({ error: 'The client has no email on the quotation — add one, or copy the link and send it on WhatsApp' });
    const out = await createFor(q, { formType: req.body?.form_type, userId: req.user.id, actor: req.user.name || '', send: req.body?.send !== false });
    res.json({ ...view(out.request), mail: out.mail });
  });
  app.post('/api/onboarding/:id/cancel', auth, async (req, res) => {
    const r = await get(req.params.id);
    if (!r || await denyDept(req, r)) return res.status(404).json({ error: 'Not found' });
    await db.prepare("UPDATE onboarding_requests SET status = 'Cancelled' WHERE id = ?").run(r.id);
    announce(r);
    res.json({ ok: true });
  });
  // Take the client's value for fields that differed from the CRM.
  app.post('/api/onboarding/:id/apply', auth, async (req, res) => {
    const r = await get(req.params.id);
    if (!r || await denyDept(req, r) || !r.client_id) return res.status(404).json({ error: 'Not found' });
    const want = Array.isArray(req.body?.fields) ? req.body.fields : [];
    const conflicts = parseJ(r.conflicts, []);
    const applied = parseJ(r.applied, []);
    const left = [];
    for (const c of conflicts) {
      if (want.includes(c.column)) {
        await db.prepare(`UPDATE clients SET ${c.column} = ? WHERE id = ?`).run(c.client_value, r.client_id);
        applied.push({ column: c.column, label: c.label, value: c.client_value, was: c.crm_value, by: req.user.name || '', at: istNow() });
      } else left.push(c);
    }
    await db.prepare('UPDATE onboarding_requests SET conflicts = ?, applied = ? WHERE id = ?').run(JSON.stringify(left), JSON.stringify(applied), r.id);
    await emitRow('client', 'updated', 'clients', r.client_id);
    announce(r);
    res.json({ ok: true });
  });
  app.post('/api/onboarding/:id/review', auth, async (req, res) => {
    const r = await get(req.params.id);
    if (!r || await denyDept(req, r)) return res.status(404).json({ error: 'Not found' });
    if (r.status !== 'Submitted') return res.status(400).json({ error: 'Only a submitted form can be marked reviewed' });
    await db.prepare("UPDATE onboarding_requests SET status = 'Reviewed', reviewed_by = ?, reviewed_at = ? WHERE id = ?").run(req.user.name || '', istNow(), r.id);
    announce(r);
    res.json({ ok: true });
  });
  // Reopen a submitted form so the client can correct it.
  app.post('/api/onboarding/:id/reopen', auth, async (req, res) => {
    const r = await get(req.params.id);
    if (!r || await denyDept(req, r)) return res.status(404).json({ error: 'Not found' });
    const { days } = await cfg();
    await db.prepare("UPDATE onboarding_requests SET status = 'Sent', expires_at = ?, reviewed_by = NULL, reviewed_at = NULL WHERE id = ?").run(addDays(days), r.id);
    announce(r);
    res.json({ ok: true });
  });
  // Settings → Onboarding
  app.get('/api/settings/onboarding', auth, async (req, res) => res.json(await cfg()));
  app.put('/api/settings/onboarding', auth, async (req, res) => {
    const u = await db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id);
    if (u?.role !== 'admin') return res.status(403).json({ error: 'Only an admin can change this' });
    const up = (k, v) => db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(k, String(v));
    if (req.body?.auto !== undefined) await up('onboarding_auto_send', req.body.auto ? '1' : '0');
    if (req.body?.days !== undefined) await up('onboarding_valid_days', Math.min(Math.max(Number(req.body.days) || 30, 3), 90));
    res.json(await cfg());
  });

  // ---------- the public form (no login) ----------
  async function byToken(token) {
    if (!/^[a-f0-9]{48}$/.test(String(token || ''))) return null;
    return db.prepare('SELECT * FROM onboarding_requests WHERE token = ?').get(token);
  }
  app.get('/api/public/onboarding/:token', async (req, res) => {
    if (slowDown(clientIp(req), 120)) return res.status(429).json({ error: 'Too many requests — please wait a minute' });
    const r = await byToken(req.params.token);
    if (!r || r.status === 'Cancelled') return res.status(404).json({ error: 'This link is not valid. Please ask WeCare Assurance for a new one.' });
    const expired = r.expires_at && r.expires_at < addDays(0) && !['Submitted', 'Reviewed'].includes(r.status);
    if (!r.opened_at) {
      await db.prepare("UPDATE onboarding_requests SET opened_at = ?, status = CASE WHEN status IN ('Sent', 'Ready') THEN 'Opened' ELSE status END WHERE id = ?").run(istNow(), r.id);
      announce(r);
    }
    const c = r.client_id ? await db.prepare('SELECT city, state FROM clients WHERE id = ?').get(r.client_id) : null;
    res.json({
      status: r.status, expired, expires_at: r.expires_at, submitted_at: r.submitted_at, locked: r.status === 'Reviewed',
      client_name: r.client_name, product: r.product, form_type: r.form_type, form: await formFor(r.form_type),
      // Only what the client gave us for getting in touch — nothing else from the CRM is shown on an open link.
      prefill: { full_name: r.client_name || '', mobile: r.mobile || '', email: r.email || '', city: c?.city || '', state: c?.state || '' },
      files: parseJ(r.files, []).map((x) => ({ field: x.field, name: x.name })),
    });
  });

  app.post('/api/public/onboarding/:token', async (req, res) => {
    if (slowDown(clientIp(req), 20)) return res.status(429).json({ error: 'Too many attempts — please wait a minute' });
    const r = await byToken(req.params.token);
    if (!r || r.status === 'Cancelled') return res.status(404).json({ error: 'This link is not valid. Please ask WeCare Assurance for a new one.' });
    if (r.status === 'Reviewed') return res.status(400).json({ error: 'This form has already been reviewed by our team. Please contact us to change anything.' });
    if (r.expires_at && r.expires_at < addDays(0) && r.status !== 'Submitted') return res.status(400).json({ error: 'This link has expired. Please ask WeCare Assurance for a new one.' });
    const form = await formFor(r.form_type);
    const answersIn = req.body?.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
    const filesIn = Array.isArray(req.body?.files) ? req.body.files : [];

    // Only the form's own fields are kept, each cleaned the way its field says.
    const answers = {};
    for (const sec of form.sections) for (const fl of sec.fields) {
      if (fl.type === 'file') continue;
      const v = answersIn[fl.k];
      if (fl.type === 'repeat') {
        // A table that is not asked (e.g. family members when only one person is covered) is kept empty.
        answers[fl.k] = (Array.isArray(v) && fieldShown(fl, answers) ? v : []).slice(0, fl.max || 10).map((row) => Object.fromEntries(fl.fields.map((sf) => [sf.k, normalise(sf, row?.[sf.k]).slice(0, 500)])));
      } else if (fl.type === 'declaration') answers[fl.k] = v === true || v === 'Yes';
      else answers[fl.k] = normalise(fl, v).slice(0, 2000);
    }
    // Files: only for the form's file fields, of allowed kinds and sizes.
    const fileDefs = form.sections.flatMap((s) => s.fields).filter((x) => x.type === 'file');
    const fileFields = new Set(fileDefs.filter((x) => !x.perMember).map((x) => x.k));
    // Per-member uploads arrive as "<field>.<row>", one per family member.
    for (const x of fileDefs.filter((d) => d.perMember)) (answers[x.perMember] || []).forEach((_, i) => fileFields.add(`${x.k}.${i}`));
    const prior = parseJ(r.files, []);
    let total = 0;
    const fresh = [];
    for (const x of filesIn.slice(0, 30)) {
      if (!fileFields.has(x?.field) || !FILE_TYPES.test(String(x?.data || ''))) continue;
      const size = bytesOf(x.data);
      if (size > MAX_FILE) return res.status(400).json({ error: `“${x.name}” is larger than 6 MB — please upload a smaller file or a photo.` });
      total += size;
      fresh.push({ field: x.field, name: String(x.name || 'document').replace(/[\\/:*?"<>|]+/g, '').slice(0, 120), data: x.data, size, type: /^data:([^;]+)/.exec(x.data)[1] });
    }
    if (total > MAX_TOTAL) return res.status(400).json({ error: 'The files together are larger than 15 MB — please upload smaller files.' });
    const have = {};
    for (const x of [...prior, ...fresh]) (have[x.field] ||= []).push(x);
    const problems = checkAnswers(form, answers, have);
    if (problems.length) return res.status(400).json({ error: 'Please complete the highlighted fields', problems });

    // ---- into the CRM ----
    const q = r.quotation_id ? await db.prepare('SELECT * FROM quotations WHERE id = ?').get(r.quotation_id) : null;
    const email = answers.email || r.email, mobile = answers.mobile || r.mobile;
    let client = r.client_id ? await db.prepare('SELECT * FROM clients WHERE id = ?').get(r.client_id) : null;
    if (!client) client = await db.prepare(`SELECT * FROM clients WHERE (NULLIF(?, '') IS NOT NULL AND LOWER(email) = LOWER(?)) OR (NULLIF(?, '') IS NOT NULL AND mobile = ?) OR LOWER(TRIM(client_name)) = LOWER(TRIM(?)) ORDER BY id LIMIT 1`)
      .get(email || '', email || '', mobile || '', mobile || '', r.client_name || '');
    if (!client) {
      const info = await db.prepare(`INSERT INTO clients (client_name, email, mobile, owner, client_status, lead_source, onboarding_date, family_type) VALUES (?,?,?,?,?,?,?,?)`)
        .run(answers.company_name || r.client_name || answers.full_name, email || '', mobile || '', q?.assigned_to || 'Admin User', 'Active', 'Onboarding form', addDays(0), 'Individual');
      client = await db.prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid);
    }
    // Fill what the client record lacks; where it already says something different, keep it and flag it.
    const conflicts = [], applied = [];
    const cols = new Set((await db.prepare("SELECT column_name FROM information_schema.columns WHERE table_name = 'clients'").all()).map((x) => x.column_name));
    for (const sec of form.sections) for (const fl of sec.fields) {
      if (!fl.map || !cols.has(fl.map) || !fieldShown(fl, answers)) continue;
      const v = String(answers[fl.k] ?? '').trim();
      if (!v) continue;
      const cur = String(client[fl.map] ?? '').trim();
      if (!cur) { await db.prepare(`UPDATE clients SET ${fl.map} = ? WHERE id = ?`).run(v, client.id); client[fl.map] = v; applied.push({ column: fl.map, label: fl.label, value: v, by: 'Client (form)', at: istNow() }); }
      else if (cur.toLowerCase() !== v.toLowerCase() && !conflicts.some((c) => c.column === fl.map)) conflicts.push({ column: fl.map, label: fl.label, crm_value: cur, client_value: v });
    }
    // Nominees: from a nominee section, or a term-life nominee table.
    const noms = Array.isArray(answers.nominees) && answers.nominees.length
      ? answers.nominees.map((n) => ({ name: n.name, relation: n.relation, dob: n.dob, share_pct: n.share }))
      : answers.nominee_name ? [{ name: answers.nominee_name, relation: answers.nominee_relation, dob: answers.nominee_dob || '', share_pct: '100' }] : [];
    if (noms.length && !parseJ(client.nominees, []).length) {
      await db.prepare('UPDATE clients SET nominees = ? WHERE id = ?').run(JSON.stringify(noms), client.id);
      applied.push({ column: 'nominees', label: 'Nominees', value: noms.map((n) => n.name).join(', '), by: 'Client (form)', at: istNow() });
    }
    // Documents into the client's files, named for what they are.
    const labelOf = (k) => {
      const [base, idx] = String(k).split('.');
      const def = form.sections.flatMap((s) => s.fields).find((x) => x.k === base);
      if (def?.perMember && idx !== undefined) { const m = (answers[def.perMember] || [])[Number(idx)] || {}; return `ID proof — ${m.name || 'member ' + (Number(idx) + 1)}${m.relation ? ' (' + m.relation + ')' : ''}`; }
      return def?.label || 'Document';
    };
    const stored = [...prior];
    for (const x of fresh) {
      const name = `Onboarding · ${labelOf(x.field)} · ${x.name}`;
      const info = await db.prepare('INSERT INTO record_attachments (parent_kind, parent_id, file_name, file_type, file_size, data, owner) VALUES (?,?,?,?,?,?,?)')
        .run('client', client.id, name.slice(0, 240), x.type, x.size, x.data, `${answers.signed_by || r.client_name} (client)`);
      stored.push({ field: x.field, name: x.name, attachment_id: info.lastInsertRowid, size: x.size });
    }
    const first = !r.submitted_at;
    await db.prepare(`UPDATE onboarding_requests SET status = 'Submitted', submitted_at = ?, client_id = ?, answers = ?, files = ?, conflicts = ?, applied = ? WHERE id = ?`)
      .run(istNow(), client.id, JSON.stringify(answers), JSON.stringify(stored), JSON.stringify(conflicts),
        JSON.stringify([...parseJ(r.applied, []), ...applied]), r.id);
    if (q && !q.client_id) await db.prepare('UPDATE quotations SET client_id = ? WHERE id = ?').run(client.id, q.id);
    await db.prepare("INSERT INTO record_notes (parent_kind, parent_id, body, owner) VALUES ('client', ?, ?, ?)")
      .run(client.id, `${first ? 'Onboarding form submitted' : 'Onboarding form updated'} by the client — ${form.label}${q ? ` for ${q.quote_no}` : ''}. ${applied.length} detail(s) added to the client record, ${fresh.length} document(s) uploaded${conflicts.length ? `, ${conflicts.length} difference(s) to review` : ''}.`, 'Onboarding form')
      .catch(() => {});
    await notify({ entity: 'onboarding', kind: 'onboarding-submitted', icon: 'check', tone: 'success', refTable: 'onboarding_requests', refId: r.id,
      title: first ? 'Onboarding form received' : 'Onboarding form updated', body: `${r.client_name} — ${form.label}${conflicts.length ? ` · ${conflicts.length} to review` : ''}`,
      link: q ? `/page/quotation?open=${q.id}` : `/page/client-master?open=${client.id}` });
    await emitRow('client', 'updated', 'clients', client.id);
    if (q) await emitRow('quotation', 'updated', 'quotations', q.id);
    announce({ ...r, client_id: client.id });
    // Next step: the details and documents go to the insurer for the proposal (in the background).
    if (q) Promise.resolve(h.onSubmitted?.(q.id)).catch(() => {});
    res.json({ ok: true, submitted_at: istNow() });
  });

  // ---------- reminders ----------
  // A form not filled within 3 days is reminded once; links past their date are marked expired.
  async function sweep() {
    try {
      const today = addDays(0);
      await db.prepare("UPDATE onboarding_requests SET status = 'Expired' WHERE status IN ('Sent', 'Opened', 'Ready') AND expires_at < ?").run(today);
      const due = await db.prepare(`SELECT * FROM onboarding_requests WHERE status IN ('Sent', 'Opened') AND COALESCE(reminder_sent, 0) = 0
        AND sent_at ~ '^\\d{4}-\\d{2}-\\d{2}' AND substr(sent_at, 1, 10)::date <= ?::date - 3 AND NULLIF(email, '') IS NOT NULL`).all(today);
      for (const r of due) {
        const q = r.quotation_id ? await db.prepare('SELECT * FROM quotations WHERE id = ?').get(r.quotation_id) : null;
        await sendMail(r, q, null, 'onboarding-reminder');
        await db.prepare('UPDATE onboarding_requests SET reminder_sent = 1 WHERE id = ?').run(r.id);
      }
    } catch (e) { console.error('onboarding sweep failed:', e.message); }
  }
  setTimeout(sweep, 90 * 1000);
  setInterval(sweep, 60 * 60 * 1000);

  return { autoSend, createFor };
}
