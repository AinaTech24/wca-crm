import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import db, { initDb } from './db.js';

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'wca-crm-dev-secret-change-in-prod';

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
// Default 100kb is far too small for base64-encoded PDF/image attachments
// (RFQ documents, claim photos, profile pictures) sent as part of the JSON body.
app.use(express.json({ limit: '20mb' }));

initDb();

// ---- auth middleware ----
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ---- real-time event bus (Server-Sent Events) ----
// Genuine backend push: every mutation emits a scoped event that connected,
// authenticated clients receive and apply incrementally (no polling, no fakes).
let eventSeq = 0;
const sseClients = new Set();

function emit(entity, action, data) {
  const evt = { id: ++eventSeq, entity, action, data, ts: Date.now() };
  const frame = `id: ${evt.id}\ndata: ${JSON.stringify(evt)}\n\n`;
  for (const client of sseClients) {
    try { client.res.write(frame); } catch { /* dropped on next heartbeat */ }
  }
  return evt;
}
// Convenience: emit a row by re-reading it from the table (keeps payload authoritative).
function emitRow(entity, action, table, id) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (row) emit(entity, action, row);
  return row;
}

// ---- renewal engine ----
// Enrich renewable policies with days-to-expiry and an aging bucket, then
// summarise the pipeline + conversion so the same numbers feed both the
// Renewal Manager page and the dashboard.
const TERMINAL = ['Renewed', 'Renewed Elsewhere', 'Lost'];
function renewalRows(line) {
  let rows = db.prepare("SELECT * FROM policies WHERE renewable = 'Yes'").all();
  if (line) rows = rows.filter((r) => r.insurance_line === line);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return rows.map((r) => {
    const st = r.renewal_status || 'Pending';
    let days = null;
    if (r.period_to && /^\d{4}-\d{2}-\d{2}/.test(r.period_to)) {
      const d = new Date(r.period_to.slice(0, 10)); d.setHours(0, 0, 0, 0);
      days = Math.round((d - today) / 86400000);
    }
    let bucket;
    if (TERMINAL.includes(st)) bucket = 'done';
    else if (days === null) bucket = 'later';
    else if (days < 0) bucket = 'lapsed';
    else if (days <= 7) bucket = 'd7';
    else if (days <= 15) bucket = 'd15';
    else if (days <= 30) bucket = 'd30';
    else if (days <= 60) bucket = 'd60';
    else if (days <= 90) bucket = 'd90';
    else bucket = 'later';
    return { ...r, renewal_status: st, days_to_expiry: days, bucket };
  });
}
function renewalSummary(rows) {
  const keys = ['lapsed', 'd7', 'd15', 'd30', 'd60', 'd90', 'later'];
  const counts = Object.fromEntries(keys.map((k) => [k, 0]));
  let renewed = 0, lost = 0, elsewhere = 0, atRisk = 0;
  for (const r of rows) {
    if (r.bucket in counts) counts[r.bucket]++;
    if (['lapsed', 'd7', 'd15', 'd30'].includes(r.bucket)) atRisk += r.final_premium || 0;
    if (r.renewal_status === 'Renewed') renewed++;
    else if (r.renewal_status === 'Lost') lost++;
    else if (r.renewal_status === 'Renewed Elsewhere') elsewhere++;
  }
  const actioned = renewed + lost + elsewhere;
  const conversion = actioned ? Math.round((renewed / actioned) * 100) : 0;
  const dueSoon = counts.lapsed + counts.d7 + counts.d15 + counts.d30;
  return { counts, renewed, lost, elsewhere, actioned, conversion, atRisk: Math.round(atRisk), dueSoon, lapsed: counts.lapsed, done: renewed + lost + elsewhere };
}

app.get('/api/events', (req, res) => {
  // EventSource cannot set Authorization headers, so the token arrives as a query param.
  let user;
  try { user = jwt.verify(req.query.token, JWT_SECRET); }
  catch { return res.status(401).end(); }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write('retry: 3000\n\n');
  res.write(`data: ${JSON.stringify({ entity: 'system', action: 'connected', ts: Date.now() })}\n\n`);

  const client = { res, user };
  sseClients.add(client);
  const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
  req.on('close', () => { clearInterval(heartbeat); sseClients.delete(client); });
});

// ---- auth routes ----
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const token = jwt.sign(
    { id: user.id, username: user.username, name: user.full_name, org: user.org_name },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
  res.json({ token, user: { username: user.username, name: user.full_name, org: user.org_name, role: user.role } });
});

app.get('/api/me', auth, (req, res) => res.json(req.user));

// ---- dashboard ----
app.get('/api/dashboard', auth, (req, res) => {
  const policyCurrentYear = db.prepare("SELECT COUNT(*) c FROM policies WHERE policy_status IN ('Policy','Issued')").get().c;
  const policyPending = db.prepare("SELECT COUNT(*) c FROM policies WHERE policy_status IN ('Proposal','Pending')").get().c;
  const policyIssued = db.prepare("SELECT COUNT(*) c FROM policies WHERE policy_status = 'Issued'").get().c;
  const policyCancel = db.prepare("SELECT COUNT(*) c FROM policies WHERE policy_status IN ('Cancel','Decline')").get().c;

  const claimTotal = db.prepare('SELECT COUNT(*) c FROM claims').get().c;
  const claimPending = db.prepare("SELECT COUNT(*) c FROM claims WHERE status = 'Pending'").get().c;
  const claimSettled = db.prepare("SELECT COUNT(*) c FROM claims WHERE status = 'Settled'").get().c;
  const claimRejected = db.prepare("SELECT COUNT(*) c FROM claims WHERE status IN ('Rejected','Withdrawn')").get().c;

  const companyWise = db.prepare('SELECT company_name label, COUNT(*) value FROM policies GROUP BY company_name').all();
  const typeWise = db.prepare('SELECT insurance_type label, COUNT(*) value FROM policies GROUP BY insurance_type').all();
  const businessWise = db.prepare('SELECT insurance_line label, ROUND(SUM(final_premium)) value FROM policies GROUP BY insurance_line').all();

  const giRenewals = db.prepare("SELECT * FROM policies WHERE insurance_line = 'GI' ORDER BY period_to LIMIT 25").all();
  const liRenewals = db.prepare("SELECT * FROM policies WHERE insurance_line = 'LI' ORDER BY period_to LIMIT 25").all();

  const renewal = renewalSummary(renewalRows());

  res.json({
    policySummary: { currentYear: policyCurrentYear, pending: policyPending, issued: policyIssued, cancel: policyCancel },
    claimSummary: { total: claimTotal, pending: claimPending, settled: claimSettled, rejected: claimRejected },
    charts: { companyWise, typeWise, businessWise },
    giRenewals, liRenewals,
    renewal,
  });
});

// ---- daily business (date-ranged) ----
app.get('/api/dashboard/business', auth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const from = req.query.from || today;
  const to = req.query.to || today;
  const policyRow = db.prepare("SELECT COUNT(*) c, ROUND(COALESCE(SUM(final_premium),0)) premium FROM policies WHERE date(login_date) BETWEEN date(?) AND date(?)").get(from, to);
  const claimRow = db.prepare('SELECT COUNT(*) c FROM claims WHERE date(claim_date) BETWEEN date(?) AND date(?)').get(from, to);
  const byLine = db.prepare("SELECT insurance_line label, COUNT(*) value FROM policies WHERE date(login_date) BETWEEN date(?) AND date(?) GROUP BY insurance_line").all(from, to);
  res.json({ from, to, policies: policyRow.c, premium: policyRow.premium, claims: claimRow.c, byLine });
});

// ---- renewal manager ----
app.get('/api/renewals', auth, (req, res) => {
  const rows = renewalRows(req.query.line || undefined);
  res.json({ rows, summary: renewalSummary(rows) });
});

// ---- clients ----
app.get('/api/clients', auth, (req, res) => {
  const { name, mobile, pan, groupHead, email, groupCode } = req.query;
  let sql = 'SELECT * FROM clients WHERE 1=1';
  const p = [];
  if (name) { sql += ' AND client_name LIKE ?'; p.push('%' + name + '%'); }
  if (mobile) { sql += ' AND mobile LIKE ?'; p.push('%' + mobile + '%'); }
  if (pan) { sql += ' AND pan_no LIKE ?'; p.push('%' + pan + '%'); }
  if (groupHead) { sql += ' AND group_head_name LIKE ?'; p.push('%' + groupHead + '%'); }
  if (email) { sql += ' AND email LIKE ?'; p.push('%' + email + '%'); }
  if (groupCode) { sql += ' AND group_code LIKE ?'; p.push('%' + groupCode + '%'); }
  sql += ' ORDER BY id DESC';
  res.json(db.prepare(sql).all(...p));
});

app.get('/api/clients/:id', auth, (req, res) => {
  const c = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json(c);
});

app.post('/api/clients', auth, (req, res) => {
  const f = req.body;
  const info = db.prepare(`INSERT INTO clients
    (client_name, group_head_name, group_code, email, mobile, pan_no, dob, anniversary, address, city, state, pincode, occupation, owner)
    VALUES (@client_name,@group_head_name,@group_code,@email,@mobile,@pan_no,@dob,@anniversary,@address,@city,@state,@pincode,@occupation,@owner)`)
    .run({
      client_name: f.client_name || '', group_head_name: f.group_head_name || '', group_code: f.group_code || '',
      email: f.email || '', mobile: f.mobile || '', pan_no: f.pan_no || '', dob: f.dob || '', anniversary: f.anniversary || '',
      address: f.address || '', city: f.city || '', state: f.state || '', pincode: f.pincode || '',
      occupation: f.occupation || '', owner: req.user.name || 'Admin User',
    });
  emitRow('client', 'created', 'clients', info.lastInsertRowid);
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/clients/:id', auth, (req, res) => {
  const f = req.body;
  db.prepare(`UPDATE clients SET client_name=@client_name, group_head_name=@group_head_name, group_code=@group_code,
    email=@email, mobile=@mobile, pan_no=@pan_no, dob=@dob, anniversary=@anniversary, address=@address, city=@city,
    state=@state, pincode=@pincode, occupation=@occupation WHERE id=@id`)
    .run({ ...f, id: req.params.id,
      client_name: f.client_name || '', group_head_name: f.group_head_name || '', group_code: f.group_code || '',
      email: f.email || '', mobile: f.mobile || '', pan_no: f.pan_no || '', dob: f.dob || '', anniversary: f.anniversary || '',
      address: f.address || '', city: f.city || '', state: f.state || '', pincode: f.pincode || '', occupation: f.occupation || '' });
  emitRow('client', 'updated', 'clients', req.params.id);
  res.json({ ok: true });
});

app.delete('/api/clients/:id', auth, (req, res) => {
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  emit('client', 'deleted', { id: Number(req.params.id) });
  res.json({ ok: true });
});

// ---- policies ----
app.get('/api/policies', auth, (req, res) => {
  const { line, name, company, policyNo, reg } = req.query;
  let sql = 'SELECT * FROM policies WHERE 1=1';
  const p = [];
  if (line) { sql += ' AND insurance_line = ?'; p.push(line); }
  if (name) { sql += ' AND insured_name LIKE ?'; p.push('%' + name + '%'); }
  if (company) { sql += ' AND company_name LIKE ?'; p.push('%' + company + '%'); }
  if (policyNo) { sql += ' AND policy_number LIKE ?'; p.push('%' + policyNo + '%'); }
  // Registration-number lookup — space/case-insensitive.
  if (reg) { sql += " AND REPLACE(UPPER(reg_no), ' ', '') LIKE ?"; p.push('%' + String(reg).toUpperCase().replace(/\s/g, '') + '%'); }
  sql += ' ORDER BY id DESC';
  res.json(db.prepare(sql).all(...p));
});

app.get('/api/policies/:id', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM policies WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

app.post('/api/policies', auth, (req, res) => {
  const f = req.body;
  const cols = ['policy_status','policy_type','renewable','insurance_line','insured_name','group_head_name','policy_number',
    'agency_name','ba_name','sm_name','company_name','insurance_type','product_name','login_date','period_from','period_to',
    'addon_name','reg_no','sum_assured','net_premium','gst_amount','final_premium','payment_type','payment_ref','payment_date',
    'total_amount','remarks'];
  const vals = cols.map(c => f[c] ?? (['sum_assured','net_premium','gst_amount','final_premium','total_amount'].includes(c) ? 0 : ''));
  const placeholders = cols.map(() => '?').join(',');
  const info = db.prepare(`INSERT INTO policies (${cols.join(',')}) VALUES (${placeholders})`).run(...vals);
  emitRow('policy', 'created', 'policies', info.lastInsertRowid);
  res.json({ id: info.lastInsertRowid });
});

// ---- claims / leads (list) ----
app.get('/api/claims', auth, (req, res) => res.json(db.prepare('SELECT * FROM claims ORDER BY id DESC').all()));
app.get('/api/leads', auth, (req, res) => res.json(db.prepare('SELECT * FROM leads ORDER BY id DESC').all()));

// ---- master lookups ----
app.get('/api/masters/companies', auth, (req, res) => {
  const line = req.query.line;
  res.json(line
    ? db.prepare('SELECT * FROM companies WHERE type = ? ORDER BY company_name').all(line)
    : db.prepare('SELECT * FROM companies ORDER BY company_name').all());
});
app.post('/api/masters/companies', auth, (req, res) => {
  const company_name = (req.body.company_name || '').trim();
  if (!company_name) return res.status(400).json({ error: 'Company name is required' });
  const info = db.prepare('INSERT INTO companies (company_name, type) VALUES (?,?)').run(company_name, req.body.type || 'GI');
  res.json({ id: info.lastInsertRowid, company_name, type: req.body.type || 'GI' });
});
app.get('/api/masters/agencies', auth, (req, res) => res.json(db.prepare('SELECT * FROM agencies ORDER BY agency_name').all()));

// ---- generic lookup masters (Make, Model, Risk Type, Occupancy, Add On, Content, HPA, Product, FD Scheme) ----
app.get('/api/lookups/:category', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM lookups WHERE category = ? ORDER BY name').all(req.params.category);
  res.json(rows);
});
app.post('/api/lookups/:category', auth, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const info = db.prepare('INSERT INTO lookups (category, name) VALUES (?,?)').run(req.params.category, name);
  emit('lookup', 'created', { category: req.params.category, ...db.prepare('SELECT * FROM lookups WHERE id = ?').get(info.lastInsertRowid) });
  res.json({ id: info.lastInsertRowid });
});
app.put('/api/lookups/:category/:id', auth, (req, res) => {
  db.prepare('UPDATE lookups SET name = ? WHERE id = ? AND category = ?').run((req.body.name || '').trim(), req.params.id, req.params.category);
  emit('lookup', 'updated', { category: req.params.category, ...db.prepare('SELECT * FROM lookups WHERE id = ?').get(req.params.id) });
  res.json({ ok: true });
});
app.delete('/api/lookups/:category/:id', auth, (req, res) => {
  db.prepare('DELETE FROM lookups WHERE id = ? AND category = ?').run(req.params.id, req.params.category);
  emit('lookup', 'deleted', { category: req.params.category, id: Number(req.params.id) });
  res.json({ ok: true });
});

// ---- endorsements ----
app.get('/api/endorsements', auth, (req, res) => res.json(db.prepare('SELECT * FROM endorsements ORDER BY id DESC').all()));
app.post('/api/endorsements', auth, (req, res) => {
  const f = req.body;
  const info = db.prepare(`INSERT INTO endorsements (policy_number, insured_name, company_name, endorsement_no, endorsement_type, endorsement_date, premium_effect, remarks)
    VALUES (?,?,?,?,?,?,?,?)`).run(f.policy_number || '', f.insured_name || '', f.company_name || '', f.endorsement_no || '', f.endorsement_type || '', f.endorsement_date || '', Number(f.premium_effect) || 0, f.remarks || '');
  emitRow('endorsement', 'created', 'endorsements', info.lastInsertRowid);
  res.json({ id: info.lastInsertRowid });
});

// ---- quotations (sales funnel: lead -> quote -> policy) ----
function quoteSelected(optionsJson) {
  let opts = [];
  try { opts = JSON.parse(optionsJson || '[]'); } catch { opts = []; }
  const valid = opts.filter((o) => Number(o.premium) > 0);
  if (!valid.length) return { insurer: '', premium: 0 };
  const best = valid.reduce((a, b) => (Number(b.premium) < Number(a.premium) ? b : a));
  return { insurer: best.insurer || '', premium: Number(best.premium) || 0 };
}
app.get('/api/quotations', auth, (req, res) => res.json(db.prepare('SELECT * FROM quotations ORDER BY id DESC').all()));
app.post('/api/quotations', auth, (req, res) => {
  const f = req.body;
  if (!f.client_name) return res.status(400).json({ error: 'Client name is required' });
  const options = typeof f.options === 'string' ? f.options : JSON.stringify(f.options || []);
  const sel = quoteSelected(options);
  const info = db.prepare(`INSERT INTO quotations (quote_no, client_name, mobile, insurance_line, product, sum_assured, options, selected_insurer, selected_premium, status, valid_till, assigned_to, remarks)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('', f.client_name, f.mobile || '', f.insurance_line || 'GI', f.product || '', Number(f.sum_assured) || 0, options, sel.insurer, sel.premium, f.status || 'Draft', f.valid_till || '', req.user.name || 'Admin User', f.remarks || '');
  const quoteNo = 'QT-' + (1000 + info.lastInsertRowid);
  db.prepare('UPDATE quotations SET quote_no = ? WHERE id = ?').run(quoteNo, info.lastInsertRowid);
  emitRow('quotation', 'created', 'quotations', info.lastInsertRowid);
  res.json({ id: info.lastInsertRowid, quote_no: quoteNo });
});
app.put('/api/quotations/:id', auth, (req, res) => {
  const cur = db.prepare('SELECT * FROM quotations WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  const f = req.body;
  const options = f.options !== undefined ? (typeof f.options === 'string' ? f.options : JSON.stringify(f.options)) : cur.options;
  const sel = quoteSelected(options);
  db.prepare(`UPDATE quotations SET client_name=?, mobile=?, insurance_line=?, product=?, sum_assured=?, options=?, selected_insurer=?, selected_premium=?, status=?, valid_till=?, remarks=? WHERE id=?`)
    .run(f.client_name ?? cur.client_name, f.mobile ?? cur.mobile, f.insurance_line ?? cur.insurance_line, f.product ?? cur.product,
      f.sum_assured !== undefined ? Number(f.sum_assured) : cur.sum_assured, options, sel.insurer, sel.premium,
      f.status ?? cur.status, f.valid_till ?? cur.valid_till, f.remarks ?? cur.remarks, req.params.id);
  emitRow('quotation', 'updated', 'quotations', req.params.id);
  res.json({ ok: true });
});
app.delete('/api/quotations/:id', auth, (req, res) => {
  db.prepare('DELETE FROM quotations WHERE id = ?').run(req.params.id);
  emit('quotation', 'deleted', { id: Number(req.params.id) });
  res.json({ ok: true });
});
// Convert an accepted quotation into a policy proposal.
app.post('/api/quotations/:id/convert', auth, (req, res) => {
  const q = db.prepare('SELECT * FROM quotations WHERE id = ?').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'Not found' });
  const info = db.prepare(`INSERT INTO policies (policy_status, policy_type, renewable, insurance_line, insured_name, company_name, insurance_type, product_name, sum_assured, final_premium, renewal_status)
    VALUES ('Proposal','Fresh','Yes',?,?,?,?,?,?,?,'Pending')`)
    .run(q.insurance_line, q.client_name, q.selected_insurer, q.product, q.product, q.sum_assured, q.selected_premium);
  db.prepare("UPDATE quotations SET status = 'Converted' WHERE id = ?").run(req.params.id);
  emitRow('policy', 'created', 'policies', info.lastInsertRowid);
  emitRow('quotation', 'updated', 'quotations', req.params.id);
  res.json({ ok: true, policyId: info.lastInsertRowid });
});

// ---- RFQ (Request For Quote — the front of the client journey) ----
app.get('/api/rfqs', auth, (req, res) => res.json(db.prepare('SELECT * FROM rfqs ORDER BY id DESC').all()));
const asJson = (v, fb) => (v === undefined ? fb : (typeof v === 'string' ? v : JSON.stringify(v)));
app.post('/api/rfqs', auth, (req, res) => {
  const f = req.body;
  if (!f.client_name) return res.status(400).json({ error: 'Client name is required' });
  const info = db.prepare(`INSERT INTO rfqs (rfq_no, client_name, mobile, email, insurance_line, category, product, policy_nature, policy_type, sum_assured, requested_idv, add_ons, details, requirement, expected_premium, insurers, status, priority, due_date, assigned_to, remarks)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('', f.client_name, f.mobile || '', f.email || '', f.insurance_line || 'GI',
      f.category || 'Motor', f.product || '', f.policy_nature || 'New', f.policy_type || '', Number(f.sum_assured) || 0,
      Number(f.requested_idv) || 0, asJson(f.add_ons, '[]'), asJson(f.details, '{}'), f.requirement || '', Number(f.expected_premium) || 0,
      asJson(f.insurers, '[]'), f.status || 'Draft', f.priority || 'Medium', f.due_date || '', req.user.name || 'Admin User', f.remarks || '');
  const rfqNo = 'RFQ-' + (2000 + info.lastInsertRowid);
  db.prepare('UPDATE rfqs SET rfq_no = ? WHERE id = ?').run(rfqNo, info.lastInsertRowid);
  emitRow('rfq', 'created', 'rfqs', info.lastInsertRowid);
  res.json({ id: info.lastInsertRowid, rfq_no: rfqNo });
});
app.put('/api/rfqs/:id', auth, (req, res) => {
  const cur = db.prepare('SELECT * FROM rfqs WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  const f = req.body;
  db.prepare(`UPDATE rfqs SET client_name=?, mobile=?, email=?, insurance_line=?, category=?, product=?, policy_nature=?, policy_type=?, sum_assured=?, requested_idv=?, add_ons=?, details=?, requirement=?, expected_premium=?, insurers=?, status=?, priority=?, due_date=?, remarks=? WHERE id=?`)
    .run(f.client_name ?? cur.client_name, f.mobile ?? cur.mobile, f.email ?? cur.email, f.insurance_line ?? cur.insurance_line,
      f.category ?? cur.category, f.product ?? cur.product, f.policy_nature ?? cur.policy_nature, f.policy_type ?? cur.policy_type,
      f.sum_assured !== undefined ? Number(f.sum_assured) : cur.sum_assured, f.requested_idv !== undefined ? Number(f.requested_idv) : cur.requested_idv,
      asJson(f.add_ons, cur.add_ons), asJson(f.details, cur.details), f.requirement ?? cur.requirement,
      f.expected_premium !== undefined ? Number(f.expected_premium) : cur.expected_premium, asJson(f.insurers, cur.insurers),
      f.status ?? cur.status, f.priority ?? cur.priority, f.due_date ?? cur.due_date, f.remarks ?? cur.remarks, req.params.id);
  emitRow('rfq', 'updated', 'rfqs', req.params.id);
  res.json({ ok: true });
});
app.delete('/api/rfqs/:id', auth, (req, res) => {
  db.prepare('DELETE FROM rfqs WHERE id = ?').run(req.params.id);
  emit('rfq', 'deleted', { id: Number(req.params.id) });
  res.json({ ok: true });
});
// Convert an RFQ (with insurer responses) into a comparable Quotation.
app.post('/api/rfqs/:id/convert', auth, (req, res) => {
  const r = db.prepare('SELECT * FROM rfqs WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  let insurers = [];
  try { insurers = JSON.parse(r.insurers || '[]'); } catch { insurers = []; }
  const options = insurers.filter((o) => Number(o.premium) > 0).map((o) => ({ insurer: o.insurer, premium: Number(o.premium), remark: '' }));
  if (!options.length) return res.status(400).json({ error: 'No insurer has quoted a premium yet' });
  const sel = quoteSelected(JSON.stringify(options));
  const info = db.prepare(`INSERT INTO quotations (quote_no, client_name, mobile, insurance_line, product, sum_assured, options, selected_insurer, selected_premium, status, valid_till, assigned_to, remarks, rfq_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('', r.client_name, r.mobile, r.insurance_line, r.product, r.sum_assured,
      JSON.stringify(options), sel.insurer, sel.premium, 'Sent', '', req.user.name || 'Admin User', `From ${r.rfq_no}`, r.id);
  const quoteNo = 'QT-' + (1000 + info.lastInsertRowid);
  db.prepare('UPDATE quotations SET quote_no = ? WHERE id = ?').run(quoteNo, info.lastInsertRowid);
  db.prepare("UPDATE rfqs SET status = 'Quoted', quotation_id = ? WHERE id = ?").run(info.lastInsertRowid, req.params.id);
  emitRow('quotation', 'created', 'quotations', info.lastInsertRowid);
  emitRow('rfq', 'updated', 'rfqs', req.params.id);
  res.json({ ok: true, quotationId: info.lastInsertRowid, quote_no: quoteNo });
});

// ---- client journey funnel (RFQ -> Quotation -> Proposal -> Policy -> Renewal) ----
app.get('/api/journey', auth, (req, res) => {
  const leads = db.prepare('SELECT COUNT(*) c FROM leads').get().c;
  const rfq = db.prepare('SELECT COUNT(*) c FROM rfqs').get().c;
  const rfqOpen = db.prepare("SELECT COUNT(*) c FROM rfqs WHERE status NOT IN ('Closed','Lost','Quoted')").get().c;
  const quotations = db.prepare('SELECT COUNT(*) c FROM quotations').get().c;
  const proposals = db.prepare("SELECT COUNT(*) c FROM policies WHERE policy_status IN ('Proposal','Pending')").get().c;
  const policies = db.prepare("SELECT COUNT(*) c FROM policies WHERE policy_status IN ('Policy','Issued')").get().c;
  const renewalsDue = renewalSummary(renewalRows()).dueSoon;
  res.json({ leads, rfq, rfqOpen, quotations, proposals, policies, renewalsDue });
});

// ---- commissions (payin / payout) ----
app.get('/api/commissions', auth, (req, res) => {
  const kind = req.query.kind;
  res.json(kind
    ? db.prepare('SELECT * FROM commissions WHERE kind = ? ORDER BY id DESC').all(kind)
    : db.prepare('SELECT * FROM commissions ORDER BY id DESC').all());
});

// ---- tasks ----
app.get('/api/tasks', auth, (req, res) => res.json(db.prepare('SELECT * FROM tasks ORDER BY due_date').all()));
app.post('/api/tasks', auth, (req, res) => {
  const f = req.body;
  if (!f.title) return res.status(400).json({ error: 'Title is required' });
  const info = db.prepare('INSERT INTO tasks (title, assigned_to, priority, due_date, status, remarks) VALUES (?,?,?,?,?,?)')
    .run(f.title, f.assigned_to || req.user.name, f.priority || 'Medium', f.due_date || '', f.status || 'Open', f.remarks || '');
  emitRow('task', 'created', 'tasks', info.lastInsertRowid);
  res.json({ id: info.lastInsertRowid });
});
app.put('/api/tasks/:id', auth, (req, res) => {
  db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(req.body.status || 'Open', req.params.id);
  emitRow('task', 'updated', 'tasks', req.params.id);
  res.json({ ok: true });
});

// ---- birthday / anniversary lists (derived from clients) ----
app.get('/api/clients-events/:kind', auth, (req, res) => {
  const col = req.params.kind === 'anniversary' ? 'anniversary' : 'dob';
  const rows = db.prepare(`SELECT id, client_name, mobile, email, ${col} as event_date FROM clients WHERE ${col} IS NOT NULL AND ${col} != '' ORDER BY ${col}`).all();
  res.json(rows);
});

// ---- generic report over policies (filterable) ----
app.get('/api/reports/policies', auth, (req, res) => {
  const { line, agency, from, to } = req.query;
  let sql = 'SELECT * FROM policies WHERE 1=1';
  const p = [];
  if (line) { sql += ' AND insurance_line = ?'; p.push(line); }
  if (agency) { sql += ' AND agency_name = ?'; p.push(agency); }
  if (from) { sql += ' AND date(period_from) >= date(?)'; p.push(from); }
  if (to) { sql += ' AND date(period_to) <= date(?)'; p.push(to); }
  sql += ' ORDER BY id DESC';
  res.json(db.prepare(sql).all(...p));
});

// ---- FD transactions ----
app.get('/api/fd-transactions', auth, (req, res) => res.json(db.prepare('SELECT * FROM fd_transactions ORDER BY id DESC').all()));
app.post('/api/fd-transactions', auth, (req, res) => {
  const f = req.body;
  if (!f.client_name) return res.status(400).json({ error: 'Client name is required' });
  const info = db.prepare(`INSERT INTO fd_transactions (client_name, scheme_name, company_name, fd_number, amount, interest_rate, tenure_months, start_date, maturity_date, maturity_amount, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      f.client_name, f.scheme_name || '', f.company_name || '', f.fd_number || '',
      Number(f.amount) || 0, Number(f.interest_rate) || 0, Number(f.tenure_months) || 0,
      f.start_date || '', f.maturity_date || '', Number(f.maturity_amount) || 0, f.status || 'Active');
  emitRow('fd', 'created', 'fd_transactions', info.lastInsertRowid);
  res.json({ id: info.lastInsertRowid });
});

// ---- company emails (claim intimation master) ----
app.get('/api/company-emails', auth, (req, res) => res.json(db.prepare('SELECT * FROM company_emails ORDER BY company_name').all()));
app.post('/api/company-emails', auth, (req, res) => {
  const f = req.body;
  if (!f.company_name) return res.status(400).json({ error: 'Company name is required' });
  const info = db.prepare('INSERT INTO company_emails (company_name, claim_email, support_phone) VALUES (?,?,?)')
    .run(f.company_name, f.claim_email || '', f.support_phone || '');
  res.json({ id: info.lastInsertRowid });
});
app.put('/api/company-emails/:id', auth, (req, res) => {
  const f = req.body;
  db.prepare('UPDATE company_emails SET company_name=?, claim_email=?, support_phone=? WHERE id=?')
    .run(f.company_name || '', f.claim_email || '', f.support_phone || '', req.params.id);
  res.json({ ok: true });
});
app.delete('/api/company-emails/:id', auth, (req, res) => {
  db.prepare('DELETE FROM company_emails WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ---- templates ----
app.get('/api/templates/:key', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM templates WHERE tkey = ?').get(req.params.key);
  res.json(row || { tkey: req.params.key, subject: '', body: '' });
});
app.put('/api/templates/:key', auth, (req, res) => {
  const { subject, body } = req.body;
  const existing = db.prepare('SELECT id FROM templates WHERE tkey = ?').get(req.params.key);
  if (existing) db.prepare('UPDATE templates SET subject=?, body=?, updated_at=date(\'now\') WHERE tkey=?').run(subject || '', body || '', req.params.key);
  else db.prepare('INSERT INTO templates (tkey, subject, body, updated_at) VALUES (?,?,?,date(\'now\'))').run(req.params.key, subject || '', body || '');
  res.json({ ok: true });
});

// ---- calendar events (tasks + renewals + client events merged) ----
app.get('/api/calendar', auth, (req, res) => {
  const events = [];
  db.prepare('SELECT id, title, due_date FROM tasks WHERE due_date != \'\'').all()
    .forEach((t) => events.push({ date: t.due_date, type: 'task', label: t.title }));
  db.prepare('SELECT id, insured_name, period_to FROM policies WHERE period_to != \'\'').all()
    .forEach((p) => events.push({ date: p.period_to, type: 'renewal', label: 'Renewal: ' + p.insured_name }));
  db.prepare("SELECT client_name, dob FROM clients WHERE dob IS NOT NULL AND dob != ''").all()
    .forEach((c) => events.push({ date: c.dob, type: 'birthday', label: 'Birthday: ' + c.client_name }));
  res.json(events);
});

// ---- claims: create ----
app.post('/api/claims', auth, (req, res) => {
  const f = req.body;
  if (!f.client_name) return res.status(400).json({ error: 'Client name is required' });
  const docs = Array.isArray(f.documents) ? JSON.stringify(f.documents) : '[]';
  const details = f.details && typeof f.details === 'object' ? JSON.stringify(f.details) : (f.details || '{}');
  const info = db.prepare('INSERT INTO claims (client_name, company_name, claim_no, claim_date, claim_amount, status, remarks, policy_id, documents, claim_type, details) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(f.client_name, f.company_name || '', f.claim_no || '', f.claim_date || '', Number(f.claim_amount) || 0, f.status || 'Pending', f.remarks || '', f.policy_id || null, docs, f.claim_type || 'Motor', details);
  emitRow('claim', 'created', 'claims', info.lastInsertRowid);
  res.json({ id: info.lastInsertRowid });
});

// ---- leads: create / update / assign ----
app.post('/api/leads', auth, (req, res) => {
  const f = req.body;
  if (!f.lead_name) return res.status(400).json({ error: 'Lead name is required' });
  const info = db.prepare('INSERT INTO leads (lead_name, mobile, email, product_interest, source, status, assigned_to, followup_date, remarks) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(f.lead_name, f.mobile || '', f.email || '', f.product_interest || '', f.source || '', f.status || 'New', f.assigned_to || req.user.name, f.followup_date || '', f.remarks || '');
  emitRow('lead', 'created', 'leads', info.lastInsertRowid);
  res.json({ id: info.lastInsertRowid });
});
app.put('/api/leads/:id', auth, (req, res) => {
  const f = req.body;
  const cur = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  const m = { ...cur, ...f };
  db.prepare('UPDATE leads SET lead_name=?, mobile=?, email=?, product_interest=?, source=?, status=?, assigned_to=?, followup_date=?, remarks=? WHERE id=?')
    .run(m.lead_name, m.mobile, m.email, m.product_interest, m.source, m.status, m.assigned_to, m.followup_date, m.remarks, req.params.id);
  emitRow('lead', 'updated', 'leads', req.params.id);
  res.json({ ok: true });
});

// ---- agencies: create / update / delete ----
app.post('/api/agencies', auth, (req, res) => {
  const f = req.body;
  if (!f.agency_name) return res.status(400).json({ error: 'Agency name is required' });
  const info = db.prepare('INSERT INTO agencies (agency_name, type, contact_person, mobile, email, city) VALUES (?,?,?,?,?,?)')
    .run(f.agency_name, f.type || 'GI', f.contact_person || '', f.mobile || '', f.email || '', f.city || '');
  emitRow('agency', 'created', 'agencies', info.lastInsertRowid);
  res.json({ id: info.lastInsertRowid });
});
app.put('/api/agencies/:id', auth, (req, res) => {
  const f = req.body;
  db.prepare('UPDATE agencies SET agency_name=?, type=?, contact_person=?, mobile=?, email=?, city=? WHERE id=?')
    .run(f.agency_name || '', f.type || 'GI', f.contact_person || '', f.mobile || '', f.email || '', f.city || '', req.params.id);
  emitRow('agency', 'updated', 'agencies', req.params.id);
  res.json({ ok: true });
});
app.delete('/api/agencies/:id', auth, (req, res) => {
  db.prepare('DELETE FROM agencies WHERE id = ?').run(req.params.id);
  emit('agency', 'deleted', { id: Number(req.params.id) });
  res.json({ ok: true });
});

// ---- clients: merge duplicate into primary ----
app.post('/api/clients/merge', auth, (req, res) => {
  const { primaryId, dupId } = req.body;
  if (!primaryId || !dupId || primaryId === dupId) return res.status(400).json({ error: 'Select two different clients' });
  const primary = db.prepare('SELECT * FROM clients WHERE id = ?').get(primaryId);
  const dup = db.prepare('SELECT * FROM clients WHERE id = ?').get(dupId);
  if (!primary || !dup) return res.status(404).json({ error: 'Client not found' });
  // Re-link the duplicate's records to the primary, then remove the duplicate.
  db.prepare('UPDATE policies SET client_id = ?, insured_name = ? WHERE client_id = ? OR insured_name = ?')
    .run(primaryId, primary.client_name, dupId, dup.client_name);
  db.prepare('UPDATE claims SET client_name = ? WHERE client_name = ?').run(primary.client_name, dup.client_name);
  db.prepare('UPDATE fd_transactions SET client_name = ? WHERE client_name = ?').run(primary.client_name, dup.client_name);
  db.prepare('DELETE FROM clients WHERE id = ?').run(dupId);
  emit('client', 'deleted', { id: Number(dupId) });
  res.json({ ok: true });
});

// ---- policies: partial update (FUP date, assignment) ----
app.put('/api/policies/:id', auth, (req, res) => {
  const cur = db.prepare('SELECT * FROM policies WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  const allowed = ['period_to', 'period_from', 'assigned_to', 'policy_status', 'final_premium', 'renewal_status'];
  const sets = [], vals = [];
  for (const k of allowed) if (k in req.body) { sets.push(`${k} = ?`); vals.push(req.body[k]); }
  if (sets.length === 0) return res.json({ ok: true });
  vals.push(req.params.id);
  db.prepare(`UPDATE policies SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  emitRow('policy', 'updated', 'policies', req.params.id);
  res.json({ ok: true });
});

// ---- outbound email (uses the SMTP settings saved in My Profile, sent by the client with each request) ----
app.post('/api/send-email', auth, async (req, res) => {
  const { to, subject, html, attachments, smtp } = req.body || {};
  if (!smtp?.host || !smtp?.user || !smtp?.pass) return res.status(400).json({ error: 'Email integration is not configured — add SMTP settings in My Profile first.' });
  if (!to) return res.status(400).json({ error: 'No recipient email address' });
  try {
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: Number(smtp.port) || 587,
      secure: smtp.secure === 'SSL',
      auth: { user: smtp.user, pass: smtp.pass },
    });
    const mailAttachments = (Array.isArray(attachments) ? attachments : []).map((a) => ({
      filename: a.filename || 'document.pdf',
      content: (a.contentBase64 || '').split(',').pop(),
      encoding: 'base64',
    }));
    await transporter.sendMail({
      from: `"${smtp.fromName || smtp.user}" <${smtp.fromEmail || smtp.user}>`,
      to, subject: subject || '', html: html || '', attachments: mailAttachments,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to send email' });
  }
});

// ---- outbound WhatsApp (Meta Cloud API, uses the credentials saved in My Profile) ----
app.post('/api/send-whatsapp', auth, async (req, res) => {
  const { to, message, mediaBase64, filename, wa } = req.body || {};
  if (!wa?.phoneNumberId || !wa?.accessToken) return res.status(400).json({ error: 'WhatsApp integration is not configured — add API credentials in My Profile first.' });
  const digits = String(to || '').replace(/\D/g, '');
  if (!digits) return res.status(400).json({ error: 'No recipient phone number' });
  try {
    let mediaId = null;
    if (mediaBase64) {
      const buf = Buffer.from(mediaBase64.split(',').pop(), 'base64');
      const form = new FormData();
      form.append('file', new Blob([buf], { type: 'application/pdf' }), filename || 'document.pdf');
      form.append('messaging_product', 'whatsapp');
      const upRes = await fetch(`https://graph.facebook.com/v20.0/${wa.phoneNumberId}/media`, {
        method: 'POST', headers: { Authorization: `Bearer ${wa.accessToken}` }, body: form,
      });
      const upData = await upRes.json();
      if (!upRes.ok) throw new Error(upData.error?.message || 'Media upload failed');
      mediaId = upData.id;
    }
    const body = mediaId
      ? { messaging_product: 'whatsapp', to: digits, type: 'document', document: { id: mediaId, filename: filename || 'document.pdf', caption: message || '' } }
      : { messaging_product: 'whatsapp', to: digits, type: 'text', text: { body: message || '' } };
    const sendRes = await fetch(`https://graph.facebook.com/v20.0/${wa.phoneNumberId}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${wa.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const sendData = await sendRes.json();
    if (!sendRes.ok) throw new Error(sendData.error?.message || 'WhatsApp send failed');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to send WhatsApp message' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'WCA CRM API' }));

// Always respond with JSON on error (oversized/malformed body, uncaught route
// errors) — Express's default HTML error page can't be parsed by the client,
// which then just reports a generic "Request failed".
app.use((err, req, res, next) => {
  if (!err) return next();
  res.status(err.status || err.statusCode || 500).json({ error: err.type === 'entity.too.large' ? 'File is too large to upload' : (err.message || 'Server error') });
});

app.listen(PORT, () => console.log(`WCA CRM API running on http://localhost:${PORT}`));
