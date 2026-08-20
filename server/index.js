// Loads server/.env into process.env for local dev (no-op if the file
// doesn't exist — production sets real env vars via PM2/systemd instead).
import 'dotenv/config';
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

await initDb();

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
async function emitRow(entity, action, table, id) {
  const row = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (row) emit(entity, action, row);
  return row;
}

// ---- notifications (the bell-icon feed) ----
// Every notification is a real row backing a real business event, pushed
// live to connected clients the same way every other mutation is (SSE),
// plus persisted so a fresh page load / new session sees history, not an
// empty inbox. Nothing here is seeded or fabricated.
async function notify({ entity, kind, icon, tone, title, body, link, refTable, refId }) {
  const info = await db.prepare(`INSERT INTO notifications (entity, kind, icon, tone, title, body, link, ref_table, ref_id)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(entity, kind, icon || 'bell', tone || 'info', title, body || '', link || '', refTable || null, refId || null);
  const row = await db.prepare('SELECT * FROM notifications WHERE id = ?').get(info.lastInsertRowid);
  emit('notification', 'created', row);
  return row;
}
// For date-driven notifications (renewal/task due) — nothing "mutates" at
// the moment a date arrives, so these are deduped against notification
// history instead of against a single triggering write.
async function notifyOnce(kind, refTable, refId, fields) {
  const exists = await db.prepare('SELECT 1 FROM notifications WHERE kind = ? AND ref_table = ? AND ref_id = ?').get(kind, refTable, refId);
  if (exists) return null;
  return notify({ kind, refTable, refId, ...fields });
}

// ---- renewal engine ----
// Enrich renewable policies with days-to-expiry and an aging bucket, then
// summarise the pipeline + conversion so the same numbers feed both the
// Renewal Manager page and the dashboard.
const TERMINAL = ['Renewed', 'Renewed Elsewhere', 'Lost'];
async function renewalRows(line) {
  let rows = await db.prepare("SELECT * FROM policies WHERE renewable = 'Yes'").all();
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

// ---- due-soon notifications (renewals, tasks) ----
// Unlike the mutation-driven notifications above, nothing "happens" at the
// moment a renewal window opens or a task's due date arrives — it's a fact
// about the calendar, not a write. So this runs periodically instead of
// being triggered from a route handler, and relies on notifyOnce's
// exists-check (kind + ref_table + ref_id) to fire exactly once per policy/
// task rather than re-notifying every time it runs.
async function checkDueNotifications() {
  try {
    const renewals = await renewalRows();
    for (const r of renewals) {
      if (r.bucket !== 'lapsed' && r.bucket !== 'd7') continue;
      if (TERMINAL.includes(r.renewal_status)) continue;
      await notifyOnce('renewal-due', 'policies', r.id, {
        entity: 'policy', icon: 'refresh', tone: r.bucket === 'lapsed' ? 'warning' : 'info',
        title: r.bucket === 'lapsed' ? 'Renewal overdue' : 'Renewal due within 7 days',
        body: `${r.insured_name} — ${r.product_name || r.insurance_type || 'policy'} (expires ${r.period_to})`,
        link: '/page/client-journey',
      });
    }
    const dueTasks = await db.prepare("SELECT * FROM tasks WHERE status NOT IN ('Done','Closed') AND NULLIF(due_date,'')::date <= CURRENT_DATE").all();
    for (const t of dueTasks) {
      await notifyOnce('task-due', 'tasks', t.id, {
        entity: 'task', icon: 'clock', tone: 'warning',
        title: 'Task due', body: `${t.title}${t.assigned_to ? ' — ' + t.assigned_to : ''}`,
        link: '/page/client-journey',
      });
    }
  } catch (e) {
    console.error('checkDueNotifications failed:', e.message);
  }
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
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  // Case-insensitive: usernames are display identity, not a secret, and a
  // casing slip shouldn't lock anyone out (now that Username is an editable
  // field on My Profile, this is a real everyday typo, not a theoretical one).
  const user = await db.prepare('SELECT * FROM users WHERE username ILIKE ?').get(username || '');
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

// Roster for "owner"-style picklists (Lead Owner, task assignment). Names
// and roles only — never password hashes or anything else on the row.
app.get('/api/users', auth, async (req, res) => {
  const rows = await db.prepare('SELECT id, username, full_name, role FROM users ORDER BY full_name').all();
  res.json(rows);
});

app.put('/api/me', auth, async (req, res) => {
  const full_name = (req.body.full_name || '').trim();
  const username = (req.body.username || '').trim();
  if (!full_name) return res.status(400).json({ error: 'Full name is required' });
  if (!username) return res.status(400).json({ error: 'Username is required' });
  // Case-insensitive dupe check up front — the column's UNIQUE constraint
  // alone is case-sensitive, so without this two accounts differing only
  // by case ("WCA_ADMIN" / "wca_admin") could both exist, which login's
  // case-insensitive lookup couldn't tell apart.
  const clash = await db.prepare('SELECT id FROM users WHERE username ILIKE ? AND id != ?').get(username, req.user.id);
  if (clash) return res.status(409).json({ error: 'That username is already taken' });
  try {
    await db.prepare('UPDATE users SET full_name = ?, username = ? WHERE id = ?').run(full_name, username, req.user.id);
  } catch (e) {
    // Postgres unique_violation on users.username.
    if (e.code === '23505') return res.status(409).json({ error: 'That username is already taken' });
    return res.status(500).json({ error: e.message || 'Could not update account' });
  }
  const row = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  // The old JWT still carries the old name/username, and other routes read
  // those straight off req.user (e.g. as the "owner"/"assigned_to" on newly
  // created records) — reissue one now so the rename takes effect
  // immediately instead of only after the next login.
  const token = jwt.sign(
    { id: row.id, username: row.username, name: row.full_name, org: row.org_name },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
  res.json({ token, user: { username: row.username, name: row.full_name, org: row.org_name, role: row.role } });
});

app.post('/api/change-password', auth, async (req, res) => {
  const { current, next } = req.body || {};
  if (!current || !next) return res.status(400).json({ error: 'Current and new password are required' });
  if (String(next).length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || !bcrypt.compareSync(current, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  const hash = bcrypt.hashSync(next, 10);
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  res.json({ ok: true });
});

// ---- dashboard ----
app.get('/api/dashboard', auth, async (req, res) => {
  const policyCurrentYear = (await db.prepare("SELECT COUNT(*) c FROM policies WHERE policy_status IN ('Policy','Issued')").get()).c;
  const policyPending = (await db.prepare("SELECT COUNT(*) c FROM policies WHERE policy_status IN ('Proposal','Pending')").get()).c;
  const policyIssued = (await db.prepare("SELECT COUNT(*) c FROM policies WHERE policy_status = 'Issued'").get()).c;
  const policyCancel = (await db.prepare("SELECT COUNT(*) c FROM policies WHERE policy_status IN ('Cancel','Decline')").get()).c;

  const claimTotal = (await db.prepare('SELECT COUNT(*) c FROM claims').get()).c;
  const claimPending = (await db.prepare("SELECT COUNT(*) c FROM claims WHERE status = 'Pending'").get()).c;
  const claimSettled = (await db.prepare("SELECT COUNT(*) c FROM claims WHERE status = 'Settled'").get()).c;
  const claimRejected = (await db.prepare("SELECT COUNT(*) c FROM claims WHERE status IN ('Rejected','Withdrawn')").get()).c;

  const companyWise = await db.prepare('SELECT company_name label, COUNT(*) value FROM policies GROUP BY company_name').all();
  const typeWise = await db.prepare('SELECT insurance_type label, COUNT(*) value FROM policies GROUP BY insurance_type').all();
  const businessWise = await db.prepare('SELECT insurance_line label, ROUND(SUM(final_premium)) value FROM policies GROUP BY insurance_line').all();

  const giRenewals = await db.prepare("SELECT * FROM policies WHERE insurance_line = 'GI' ORDER BY period_to LIMIT 25").all();
  const liRenewals = await db.prepare("SELECT * FROM policies WHERE insurance_line = 'LI' ORDER BY period_to LIMIT 25").all();

  const renewal = renewalSummary(await renewalRows());

  res.json({
    policySummary: { currentYear: policyCurrentYear, pending: policyPending, issued: policyIssued, cancel: policyCancel },
    claimSummary: { total: claimTotal, pending: claimPending, settled: claimSettled, rejected: claimRejected },
    charts: { companyWise, typeWise, businessWise },
    giRenewals, liRenewals,
    renewal,
  });
});

// ---- daily business (date-ranged) ----
app.get('/api/dashboard/business', auth, async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const from = req.query.from || today;
  const to = req.query.to || today;
  // NULLIF guards rows where the date column is '' (unset) — casting '' to
  // ::date errors in Postgres, unlike SQLite's lenient date('') -> NULL.
  const policyRow = await db.prepare("SELECT COUNT(*) c, ROUND(COALESCE(SUM(final_premium),0)) premium FROM policies WHERE NULLIF(login_date,'')::date BETWEEN ?::date AND ?::date").get(from, to);
  const claimRow = await db.prepare("SELECT COUNT(*) c FROM claims WHERE NULLIF(claim_date,'')::date BETWEEN ?::date AND ?::date").get(from, to);
  const byLine = await db.prepare("SELECT insurance_line label, COUNT(*) value FROM policies WHERE NULLIF(login_date,'')::date BETWEEN ?::date AND ?::date GROUP BY insurance_line").all(from, to);
  res.json({ from, to, policies: policyRow.c, premium: policyRow.premium, claims: claimRow.c, byLine });
});

// ---- renewal manager ----
app.get('/api/renewals', auth, async (req, res) => {
  const rows = await renewalRows(req.query.line || undefined);
  res.json({ rows, summary: renewalSummary(rows) });
});

// ---- clients ----
app.get('/api/clients', auth, async (req, res) => {
  const { name, mobile, pan, groupHead, email, groupCode } = req.query;
  let sql = 'SELECT * FROM clients WHERE 1=1';
  const p = [];
  // ILIKE (not LIKE) to match SQLite's default case-insensitive LIKE.
  if (name) { sql += ' AND client_name ILIKE ?'; p.push('%' + name + '%'); }
  if (mobile) { sql += ' AND mobile ILIKE ?'; p.push('%' + mobile + '%'); }
  if (pan) { sql += ' AND pan_no ILIKE ?'; p.push('%' + pan + '%'); }
  if (groupHead) { sql += ' AND group_head_name ILIKE ?'; p.push('%' + groupHead + '%'); }
  if (email) { sql += ' AND email ILIKE ?'; p.push('%' + email + '%'); }
  if (groupCode) { sql += ' AND group_code ILIKE ?'; p.push('%' + groupCode + '%'); }
  sql += ' ORDER BY id DESC';
  res.json(await db.prepare(sql).all(...p));
});

app.get('/api/clients/:id', auth, async (req, res) => {
  const c = await db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json(c);
});

app.post('/api/clients', auth, async (req, res) => {
  const f = req.body;
  const info = await db.prepare(`INSERT INTO clients
    (client_name, group_head_name, group_code, email, mobile, pan_no, dob, anniversary, address, city, state, pincode, occupation, owner)
    VALUES (@client_name,@group_head_name,@group_code,@email,@mobile,@pan_no,@dob,@anniversary,@address,@city,@state,@pincode,@occupation,@owner)`)
    .run({
      client_name: f.client_name || '', group_head_name: f.group_head_name || '', group_code: f.group_code || '',
      email: f.email || '', mobile: f.mobile || '', pan_no: f.pan_no || '', dob: f.dob || '', anniversary: f.anniversary || '',
      address: f.address || '', city: f.city || '', state: f.state || '', pincode: f.pincode || '',
      occupation: f.occupation || '', owner: req.user.name || 'Admin User',
    });
  await emitRow('client', 'created', 'clients', info.lastInsertRowid);
  await notify({ entity: 'client', kind: 'created', icon: 'user', tone: 'success', refTable: 'clients', refId: info.lastInsertRowid,
    title: 'New client added', body: f.client_name || 'A new client', link: '/page/client-master' });
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/clients/:id', auth, async (req, res) => {
  const f = req.body;
  await db.prepare(`UPDATE clients SET client_name=@client_name, group_head_name=@group_head_name, group_code=@group_code,
    email=@email, mobile=@mobile, pan_no=@pan_no, dob=@dob, anniversary=@anniversary, address=@address, city=@city,
    state=@state, pincode=@pincode, occupation=@occupation WHERE id=@id`)
    .run({ ...f, id: req.params.id,
      client_name: f.client_name || '', group_head_name: f.group_head_name || '', group_code: f.group_code || '',
      email: f.email || '', mobile: f.mobile || '', pan_no: f.pan_no || '', dob: f.dob || '', anniversary: f.anniversary || '',
      address: f.address || '', city: f.city || '', state: f.state || '', pincode: f.pincode || '', occupation: f.occupation || '' });
  await emitRow('client', 'updated', 'clients', req.params.id);
  res.json({ ok: true });
});

app.delete('/api/clients/:id', auth, async (req, res) => {
  await db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  emit('client', 'deleted', { id: Number(req.params.id) });
  res.json({ ok: true });
});

// ---- policies ----
app.get('/api/policies', auth, async (req, res) => {
  const { line, name, company, policyNo, reg } = req.query;
  let sql = 'SELECT * FROM policies WHERE 1=1';
  const p = [];
  if (line) { sql += ' AND insurance_line = ?'; p.push(line); }
  if (name) { sql += ' AND insured_name ILIKE ?'; p.push('%' + name + '%'); }
  if (company) { sql += ' AND company_name ILIKE ?'; p.push('%' + company + '%'); }
  if (policyNo) { sql += ' AND policy_number ILIKE ?'; p.push('%' + policyNo + '%'); }
  // Registration-number lookup — space/case-insensitive (both sides upper-cased, so plain LIKE is fine here).
  if (reg) { sql += " AND REPLACE(UPPER(reg_no), ' ', '') LIKE ?"; p.push('%' + String(reg).toUpperCase().replace(/\s/g, '') + '%'); }
  sql += ' ORDER BY id DESC';
  res.json(await db.prepare(sql).all(...p));
});

app.get('/api/policies/:id', auth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM policies WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

app.post('/api/policies', auth, async (req, res) => {
  const f = req.body;
  const cols = ['policy_status','policy_type','renewable','insurance_line','insured_name','group_head_name','policy_number',
    'agency_name','ba_name','sm_name','company_name','insurance_type','product_name','login_date','period_from','period_to',
    'addon_name','reg_no','sum_assured','net_premium','gst_amount','final_premium','payment_type','payment_ref','payment_date',
    'total_amount','remarks'];
  const vals = cols.map(c => f[c] ?? (['sum_assured','net_premium','gst_amount','final_premium','total_amount'].includes(c) ? 0 : ''));
  const placeholders = cols.map(() => '?').join(',');
  const info = await db.prepare(`INSERT INTO policies (${cols.join(',')}) VALUES (${placeholders})`).run(...vals);
  await emitRow('policy', 'created', 'policies', info.lastInsertRowid);
  await notify({ entity: 'policy', kind: 'created', icon: 'file', tone: 'info', refTable: 'policies', refId: info.lastInsertRowid,
    title: 'New policy added', body: `${f.insured_name || 'A client'} · ${f.product_name || 'policy'}`, link: '/page/client-journey' });
  res.json({ id: info.lastInsertRowid });
});

// ---- claims / leads (list) ----
app.get('/api/claims', auth, async (req, res) => res.json(await db.prepare('SELECT * FROM claims ORDER BY id DESC').all()));
app.get('/api/leads', auth, async (req, res) => res.json(await db.prepare('SELECT * FROM leads ORDER BY id DESC').all()));

// ---- master lookups ----
app.get('/api/masters/companies', auth, async (req, res) => {
  const line = req.query.line;
  res.json(line
    ? await db.prepare('SELECT * FROM companies WHERE type = ? ORDER BY company_name').all(line)
    : await db.prepare('SELECT * FROM companies ORDER BY company_name').all());
});
app.post('/api/masters/companies', auth, async (req, res) => {
  const company_name = (req.body.company_name || '').trim();
  if (!company_name) return res.status(400).json({ error: 'Company name is required' });
  const info = await db.prepare('INSERT INTO companies (company_name, type) VALUES (?,?)').run(company_name, req.body.type || 'GI');
  res.json({ id: info.lastInsertRowid, company_name, type: req.body.type || 'GI' });
});
app.get('/api/masters/agencies', auth, async (req, res) => res.json(await db.prepare('SELECT * FROM agencies ORDER BY agency_name').all()));

// ---- generic lookup masters (Make, Model, Risk Type, Occupancy, Add On, Content, HPA, Product, FD Scheme) ----
app.get('/api/lookups/:category', auth, async (req, res) => {
  const rows = await db.prepare('SELECT * FROM lookups WHERE category = ? ORDER BY name').all(req.params.category);
  res.json(rows);
});
app.post('/api/lookups/:category', auth, async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const info = await db.prepare('INSERT INTO lookups (category, name) VALUES (?,?)').run(req.params.category, name);
  emit('lookup', 'created', { category: req.params.category, ...(await db.prepare('SELECT * FROM lookups WHERE id = ?').get(info.lastInsertRowid)) });
  res.json({ id: info.lastInsertRowid });
});
app.put('/api/lookups/:category/:id', auth, async (req, res) => {
  await db.prepare('UPDATE lookups SET name = ? WHERE id = ? AND category = ?').run((req.body.name || '').trim(), req.params.id, req.params.category);
  emit('lookup', 'updated', { category: req.params.category, ...(await db.prepare('SELECT * FROM lookups WHERE id = ?').get(req.params.id)) });
  res.json({ ok: true });
});
app.delete('/api/lookups/:category/:id', auth, async (req, res) => {
  await db.prepare('DELETE FROM lookups WHERE id = ? AND category = ?').run(req.params.id, req.params.category);
  emit('lookup', 'deleted', { category: req.params.category, id: Number(req.params.id) });
  res.json({ ok: true });
});

// ---- endorsements ----
app.get('/api/endorsements', auth, async (req, res) => res.json(await db.prepare('SELECT * FROM endorsements ORDER BY id DESC').all()));
app.post('/api/endorsements', auth, async (req, res) => {
  const f = req.body;
  const info = await db.prepare(`INSERT INTO endorsements (policy_number, insured_name, company_name, endorsement_no, endorsement_type, endorsement_date, premium_effect, remarks)
    VALUES (?,?,?,?,?,?,?,?)`).run(f.policy_number || '', f.insured_name || '', f.company_name || '', f.endorsement_no || '', f.endorsement_type || '', f.endorsement_date || '', Number(f.premium_effect) || 0, f.remarks || '');
  await emitRow('endorsement', 'created', 'endorsements', info.lastInsertRowid);
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
app.get('/api/quotations', auth, async (req, res) => res.json(await db.prepare('SELECT * FROM quotations ORDER BY id DESC').all()));
app.post('/api/quotations', auth, async (req, res) => {
  const f = req.body;
  if (!f.client_name) return res.status(400).json({ error: 'Client name is required' });
  const options = typeof f.options === 'string' ? f.options : JSON.stringify(f.options || []);
  const sel = quoteSelected(options);
  const info = await db.prepare(`INSERT INTO quotations (quote_no, client_name, mobile, insurance_line, product, sum_assured, options, selected_insurer, selected_premium, status, valid_till, assigned_to, remarks)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('', f.client_name, f.mobile || '', f.insurance_line || 'GI', f.product || '', Number(f.sum_assured) || 0, options, sel.insurer, sel.premium, f.status || 'Draft', f.valid_till || '', req.user.name || 'Admin User', f.remarks || '');
  const quoteNo = 'QT-' + (1000 + info.lastInsertRowid);
  await db.prepare('UPDATE quotations SET quote_no = ? WHERE id = ?').run(quoteNo, info.lastInsertRowid);
  await emitRow('quotation', 'created', 'quotations', info.lastInsertRowid);
  await notify({ entity: 'quotation', kind: 'created', icon: 'file', tone: 'info', refTable: 'quotations', refId: info.lastInsertRowid,
    title: 'New quotation created', body: `${quoteNo} — ${f.client_name}`, link: '/page/client-journey' });
  res.json({ id: info.lastInsertRowid, quote_no: quoteNo });
});
app.put('/api/quotations/:id', auth, async (req, res) => {
  const cur = await db.prepare('SELECT * FROM quotations WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  const f = req.body;
  const options = f.options !== undefined ? (typeof f.options === 'string' ? f.options : JSON.stringify(f.options)) : cur.options;
  const sel = quoteSelected(options);
  await db.prepare(`UPDATE quotations SET client_name=?, mobile=?, insurance_line=?, product=?, sum_assured=?, options=?, selected_insurer=?, selected_premium=?, status=?, valid_till=?, remarks=? WHERE id=?`)
    .run(f.client_name ?? cur.client_name, f.mobile ?? cur.mobile, f.insurance_line ?? cur.insurance_line, f.product ?? cur.product,
      f.sum_assured !== undefined ? Number(f.sum_assured) : cur.sum_assured, options, sel.insurer, sel.premium,
      f.status ?? cur.status, f.valid_till ?? cur.valid_till, f.remarks ?? cur.remarks, req.params.id);
  await emitRow('quotation', 'updated', 'quotations', req.params.id);
  res.json({ ok: true });
});
app.delete('/api/quotations/:id', auth, async (req, res) => {
  await db.prepare('DELETE FROM quotations WHERE id = ?').run(req.params.id);
  emit('quotation', 'deleted', { id: Number(req.params.id) });
  res.json({ ok: true });
});
// Convert an accepted quotation into a policy proposal.
app.post('/api/quotations/:id/convert', auth, async (req, res) => {
  const q = await db.prepare('SELECT * FROM quotations WHERE id = ?').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'Not found' });
  const info = await db.prepare(`INSERT INTO policies (policy_status, policy_type, renewable, insurance_line, insured_name, company_name, insurance_type, product_name, sum_assured, final_premium, renewal_status)
    VALUES ('Proposal','Fresh','Yes',?,?,?,?,?,?,?,'Pending')`)
    .run(q.insurance_line, q.client_name, q.selected_insurer, q.product, q.product, q.sum_assured, q.selected_premium);
  await db.prepare("UPDATE quotations SET status = 'Converted' WHERE id = ?").run(req.params.id);
  await emitRow('policy', 'created', 'policies', info.lastInsertRowid);
  await emitRow('quotation', 'updated', 'quotations', req.params.id);
  res.json({ ok: true, policyId: info.lastInsertRowid });
});

// ---- RFQ (Request For Quote — the front of the client journey) ----
app.get('/api/rfqs', auth, async (req, res) => res.json(await db.prepare('SELECT * FROM rfqs ORDER BY id DESC').all()));
const asJson = (v, fb) => (v === undefined ? fb : (typeof v === 'string' ? v : JSON.stringify(v)));
app.post('/api/rfqs', auth, async (req, res) => {
  const f = req.body;
  if (!f.client_name) return res.status(400).json({ error: 'Client name is required' });
  const info = await db.prepare(`INSERT INTO rfqs (rfq_no, client_name, mobile, email, insurance_line, category, product, policy_nature, policy_type, sum_assured, requested_idv, add_ons, details, requirement, expected_premium, insurers, status, priority, due_date, assigned_to, remarks)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('', f.client_name, f.mobile || '', f.email || '', f.insurance_line || 'GI',
      f.category || 'Motor', f.product || '', f.policy_nature || 'New', f.policy_type || '', Number(f.sum_assured) || 0,
      Number(f.requested_idv) || 0, asJson(f.add_ons, '[]'), asJson(f.details, '{}'), f.requirement || '', Number(f.expected_premium) || 0,
      asJson(f.insurers, '[]'), f.status || 'Draft', f.priority || 'Medium', f.due_date || '', req.user.name || 'Admin User', f.remarks || '');
  const rfqNo = 'RFQ-' + (2000 + info.lastInsertRowid);
  await db.prepare('UPDATE rfqs SET rfq_no = ? WHERE id = ?').run(rfqNo, info.lastInsertRowid);
  await emitRow('rfq', 'created', 'rfqs', info.lastInsertRowid);
  await notify({ entity: 'rfq', kind: 'created', icon: 'file', tone: 'info', refTable: 'rfqs', refId: info.lastInsertRowid,
    title: 'New RFQ created', body: `${rfqNo} — ${f.client_name}`, link: '/page/rfq' });
  res.json({ id: info.lastInsertRowid, rfq_no: rfqNo });
});
app.put('/api/rfqs/:id', auth, async (req, res) => {
  const cur = await db.prepare('SELECT * FROM rfqs WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  const f = req.body;
  await db.prepare(`UPDATE rfqs SET client_name=?, mobile=?, email=?, insurance_line=?, category=?, product=?, policy_nature=?, policy_type=?, sum_assured=?, requested_idv=?, add_ons=?, details=?, requirement=?, expected_premium=?, insurers=?, status=?, priority=?, due_date=?, remarks=? WHERE id=?`)
    .run(f.client_name ?? cur.client_name, f.mobile ?? cur.mobile, f.email ?? cur.email, f.insurance_line ?? cur.insurance_line,
      f.category ?? cur.category, f.product ?? cur.product, f.policy_nature ?? cur.policy_nature, f.policy_type ?? cur.policy_type,
      f.sum_assured !== undefined ? Number(f.sum_assured) : cur.sum_assured, f.requested_idv !== undefined ? Number(f.requested_idv) : cur.requested_idv,
      asJson(f.add_ons, cur.add_ons), asJson(f.details, cur.details), f.requirement ?? cur.requirement,
      f.expected_premium !== undefined ? Number(f.expected_premium) : cur.expected_premium, asJson(f.insurers, cur.insurers),
      f.status ?? cur.status, f.priority ?? cur.priority, f.due_date ?? cur.due_date, f.remarks ?? cur.remarks, req.params.id);
  await emitRow('rfq', 'updated', 'rfqs', req.params.id);
  // "Quotes Received" is set by the client once every quoted insurer has
  // responded (see Rfq.jsx) — a real state transition worth surfacing,
  // not just any field edit, so this only fires on that specific change.
  if (f.status && f.status !== cur.status && f.status === 'Quotes Received') {
    await notify({ entity: 'rfq', kind: 'quotes-received', icon: 'shieldcheck', tone: 'success', refTable: 'rfqs', refId: Number(req.params.id),
      title: 'Quotes received', body: `${cur.rfq_no} — ${cur.client_name} is ready to compare`, link: '/page/rfq' });
  }
  res.json({ ok: true });
});
app.delete('/api/rfqs/:id', auth, async (req, res) => {
  await db.prepare('DELETE FROM rfqs WHERE id = ?').run(req.params.id);
  emit('rfq', 'deleted', { id: Number(req.params.id) });
  res.json({ ok: true });
});
// Convert an RFQ (with insurer responses) into a comparable Quotation.
app.post('/api/rfqs/:id/convert', auth, async (req, res) => {
  const r = await db.prepare('SELECT * FROM rfqs WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  let insurers = [];
  try { insurers = JSON.parse(r.insurers || '[]'); } catch { insurers = []; }
  const options = insurers.filter((o) => Number(o.premium) > 0).map((o) => ({ insurer: o.insurer, premium: Number(o.premium), remark: '' }));
  if (!options.length) return res.status(400).json({ error: 'No insurer has quoted a premium yet' });
  const sel = quoteSelected(JSON.stringify(options));
  const info = await db.prepare(`INSERT INTO quotations (quote_no, client_name, mobile, insurance_line, product, sum_assured, options, selected_insurer, selected_premium, status, valid_till, assigned_to, remarks, rfq_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('', r.client_name, r.mobile, r.insurance_line, r.product, r.sum_assured,
      JSON.stringify(options), sel.insurer, sel.premium, 'Sent', '', req.user.name || 'Admin User', `From ${r.rfq_no}`, r.id);
  const quoteNo = 'QT-' + (1000 + info.lastInsertRowid);
  await db.prepare('UPDATE quotations SET quote_no = ? WHERE id = ?').run(quoteNo, info.lastInsertRowid);
  await db.prepare("UPDATE rfqs SET status = 'Quoted', quotation_id = ? WHERE id = ?").run(info.lastInsertRowid, req.params.id);
  await emitRow('quotation', 'created', 'quotations', info.lastInsertRowid);
  await emitRow('rfq', 'updated', 'rfqs', req.params.id);
  res.json({ ok: true, quotationId: info.lastInsertRowid, quote_no: quoteNo });
});

// ---- client journey funnel (RFQ -> Quotation -> Proposal -> Policy -> Renewal) ----
app.get('/api/journey', auth, async (req, res) => {
  const leads = (await db.prepare('SELECT COUNT(*) c FROM leads').get()).c;
  const rfq = (await db.prepare('SELECT COUNT(*) c FROM rfqs').get()).c;
  const rfqOpen = (await db.prepare("SELECT COUNT(*) c FROM rfqs WHERE status NOT IN ('Closed','Lost','Quoted')").get()).c;
  const quotations = (await db.prepare('SELECT COUNT(*) c FROM quotations').get()).c;
  const proposals = (await db.prepare("SELECT COUNT(*) c FROM policies WHERE policy_status IN ('Proposal','Pending')").get()).c;
  const policies = (await db.prepare("SELECT COUNT(*) c FROM policies WHERE policy_status IN ('Policy','Issued')").get()).c;
  const renewalsDue = renewalSummary(await renewalRows()).dueSoon;
  res.json({ leads, rfq, rfqOpen, quotations, proposals, policies, renewalsDue });
});

// ---- commissions (payin / payout) ----
app.get('/api/commissions', auth, async (req, res) => {
  const kind = req.query.kind;
  res.json(kind
    ? await db.prepare('SELECT * FROM commissions WHERE kind = ? ORDER BY id DESC').all(kind)
    : await db.prepare('SELECT * FROM commissions ORDER BY id DESC').all());
});

// ---- tasks ----
app.get('/api/tasks', auth, async (req, res) => res.json(await db.prepare('SELECT * FROM tasks ORDER BY due_date').all()));
app.post('/api/tasks', auth, async (req, res) => {
  const f = req.body;
  if (!f.title) return res.status(400).json({ error: 'Title is required' });
  const info = await db.prepare('INSERT INTO tasks (title, assigned_to, priority, due_date, status, remarks) VALUES (?,?,?,?,?,?)')
    .run(f.title, f.assigned_to || req.user.name, f.priority || 'Medium', f.due_date || '', f.status || 'Open', f.remarks || '');
  await emitRow('task', 'created', 'tasks', info.lastInsertRowid);
  res.json({ id: info.lastInsertRowid });
});
app.put('/api/tasks/:id', auth, async (req, res) => {
  await db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(req.body.status || 'Open', req.params.id);
  await emitRow('task', 'updated', 'tasks', req.params.id);
  res.json({ ok: true });
});

// ---- birthday / anniversary lists (derived from clients) ----
app.get('/api/clients-events/:kind', auth, async (req, res) => {
  const col = req.params.kind === 'anniversary' ? 'anniversary' : 'dob';
  const rows = await db.prepare(`SELECT id, client_name, mobile, email, ${col} as event_date FROM clients WHERE ${col} IS NOT NULL AND ${col} != '' ORDER BY ${col}`).all();
  res.json(rows);
});

// ---- generic report over policies (filterable) ----
app.get('/api/reports/policies', auth, async (req, res) => {
  const { line, agency, from, to } = req.query;
  let sql = 'SELECT * FROM policies WHERE 1=1';
  const p = [];
  if (line) { sql += ' AND insurance_line = ?'; p.push(line); }
  if (agency) { sql += ' AND agency_name = ?'; p.push(agency); }
  if (from) { sql += " AND NULLIF(period_from,'')::date >= ?::date"; p.push(from); }
  if (to) { sql += " AND NULLIF(period_to,'')::date <= ?::date"; p.push(to); }
  sql += ' ORDER BY id DESC';
  res.json(await db.prepare(sql).all(...p));
});

// ---- FD transactions ----
app.get('/api/fd-transactions', auth, async (req, res) => res.json(await db.prepare('SELECT * FROM fd_transactions ORDER BY id DESC').all()));
app.post('/api/fd-transactions', auth, async (req, res) => {
  const f = req.body;
  if (!f.client_name) return res.status(400).json({ error: 'Client name is required' });
  const info = await db.prepare(`INSERT INTO fd_transactions (client_name, scheme_name, company_name, fd_number, amount, interest_rate, tenure_months, start_date, maturity_date, maturity_amount, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      f.client_name, f.scheme_name || '', f.company_name || '', f.fd_number || '',
      Number(f.amount) || 0, Number(f.interest_rate) || 0, Number(f.tenure_months) || 0,
      f.start_date || '', f.maturity_date || '', Number(f.maturity_amount) || 0, f.status || 'Active');
  await emitRow('fd', 'created', 'fd_transactions', info.lastInsertRowid);
  res.json({ id: info.lastInsertRowid });
});

// ---- company emails (claim intimation master) ----
app.get('/api/company-emails', auth, async (req, res) => res.json(await db.prepare('SELECT * FROM company_emails ORDER BY company_name').all()));
app.post('/api/company-emails', auth, async (req, res) => {
  const f = req.body;
  if (!f.company_name) return res.status(400).json({ error: 'Company name is required' });
  const info = await db.prepare('INSERT INTO company_emails (company_name, claim_email, support_phone) VALUES (?,?,?)')
    .run(f.company_name, f.claim_email || '', f.support_phone || '');
  res.json({ id: info.lastInsertRowid });
});
app.put('/api/company-emails/:id', auth, async (req, res) => {
  const f = req.body;
  await db.prepare('UPDATE company_emails SET company_name=?, claim_email=?, support_phone=? WHERE id=?')
    .run(f.company_name || '', f.claim_email || '', f.support_phone || '', req.params.id);
  res.json({ ok: true });
});
app.delete('/api/company-emails/:id', auth, async (req, res) => {
  await db.prepare('DELETE FROM company_emails WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ---- templates ----
app.get('/api/templates/:key', auth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM templates WHERE tkey = ?').get(req.params.key);
  res.json(row || { tkey: req.params.key, subject: '', body: '' });
});
app.put('/api/templates/:key', auth, async (req, res) => {
  const { subject, body } = req.body;
  const existing = await db.prepare('SELECT id FROM templates WHERE tkey = ?').get(req.params.key);
  if (existing) await db.prepare("UPDATE templates SET subject=?, body=?, updated_at=to_char(CURRENT_DATE,'YYYY-MM-DD') WHERE tkey=?").run(subject || '', body || '', req.params.key);
  else await db.prepare("INSERT INTO templates (tkey, subject, body, updated_at) VALUES (?,?,?,to_char(CURRENT_DATE,'YYYY-MM-DD'))").run(req.params.key, subject || '', body || '');
  res.json({ ok: true });
});

// ---- calendar events (tasks + renewals + client events merged) ----
app.get('/api/calendar', auth, async (req, res) => {
  const events = [];
  (await db.prepare("SELECT id, title, due_date FROM tasks WHERE due_date != ''").all())
    .forEach((t) => events.push({ date: t.due_date, type: 'task', label: t.title }));
  (await db.prepare("SELECT id, insured_name, period_to FROM policies WHERE period_to != ''").all())
    .forEach((p) => events.push({ date: p.period_to, type: 'renewal', label: 'Renewal: ' + p.insured_name }));
  (await db.prepare("SELECT client_name, dob FROM clients WHERE dob IS NOT NULL AND dob != ''").all())
    .forEach((c) => events.push({ date: c.dob, type: 'birthday', label: 'Birthday: ' + c.client_name }));
  res.json(events);
});

// ---- claims: create ----
app.post('/api/claims', auth, async (req, res) => {
  const f = req.body;
  if (!f.client_name) return res.status(400).json({ error: 'Client name is required' });
  const docs = Array.isArray(f.documents) ? JSON.stringify(f.documents) : '[]';
  const details = f.details && typeof f.details === 'object' ? JSON.stringify(f.details) : (f.details || '{}');
  const info = await db.prepare('INSERT INTO claims (client_name, company_name, claim_no, claim_date, claim_amount, status, remarks, policy_id, documents, claim_type, details) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(f.client_name, f.company_name || '', f.claim_no || '', f.claim_date || '', Number(f.claim_amount) || 0, f.status || 'Pending', f.remarks || '', f.policy_id || null, docs, f.claim_type || 'Motor', details);
  await emitRow('claim', 'created', 'claims', info.lastInsertRowid);
  await notify({ entity: 'claim', kind: 'created', icon: 'shieldcheck', tone: 'warning', refTable: 'claims', refId: info.lastInsertRowid,
    title: 'New claim registered', body: `${f.client_name} · ${f.company_name || ''}`, link: '/page/claim' });
  res.json({ id: info.lastInsertRowid });
});

// ---- leads: create / update / delete ----
// A referring client is only meaningful when the source actually is a client
// referral — clearing it otherwise stops a stale referrer lingering after the
// source is changed to something else.
const LEAD_COLS = ['lead_name', 'lead_date', 'expected_business_type', 'mobile', 'email',
  'lead_owner', 'source', 'referral_client_id', 'referral_client_name', 'company_name',
  'status', 'followup_date', 'remarks'];
function leadPayload(f, fallbackOwner) {
  const isReferral = f.source === 'Client Referral';
  return {
    lead_name: f.lead_name || '',
    lead_date: f.lead_date || '',
    expected_business_type: f.expected_business_type || '',
    mobile: f.mobile || '',
    email: f.email || '',
    lead_owner: f.lead_owner || fallbackOwner || '',
    source: f.source || '',
    referral_client_id: isReferral ? (f.referral_client_id || null) : null,
    referral_client_name: isReferral ? (f.referral_client_name || '') : '',
    company_name: f.company_name || '',
    status: f.status || 'New',
    followup_date: f.followup_date || '',
    remarks: f.remarks || '',
  };
}

app.post('/api/leads', auth, async (req, res) => {
  const f = req.body;
  if (!f.lead_name) return res.status(400).json({ error: 'Lead name is required' });
  const p = leadPayload(f, req.user.name);
  const info = await db.prepare(`INSERT INTO leads (${LEAD_COLS.join(',')}) VALUES (${LEAD_COLS.map(() => '?').join(',')})`)
    .run(...LEAD_COLS.map((c) => p[c]));
  await emitRow('lead', 'created', 'leads', info.lastInsertRowid);
  await notify({ entity: 'lead', kind: 'created', icon: 'userplus', tone: 'info', refTable: 'leads', refId: info.lastInsertRowid,
    title: 'New lead added', body: `${p.lead_name}${p.company_name ? ' · ' + p.company_name : ''}`, link: '/page/lead' });
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/leads/:id', auth, async (req, res) => {
  const cur = await db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  const p = leadPayload({ ...cur, ...req.body }, cur.lead_owner);
  await db.prepare(`UPDATE leads SET ${LEAD_COLS.map((c) => `${c}=?`).join(', ')} WHERE id=?`)
    .run(...LEAD_COLS.map((c) => p[c]), req.params.id);
  await emitRow('lead', 'updated', 'leads', req.params.id);
  if (req.body.status && req.body.status !== cur.status && req.body.status === 'Converted') {
    await notify({ entity: 'lead', kind: 'converted', icon: 'target', tone: 'success', refTable: 'leads', refId: Number(req.params.id),
      title: 'Lead converted', body: `${cur.lead_name} is now a converted lead`, link: '/page/lead' });
  }
  res.json({ ok: true });
});

app.delete('/api/leads/:id', auth, async (req, res) => {
  // lead_activities cascades on delete (see schema) — no orphan cleanup needed.
  await db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  emit('lead', 'deleted', { id: Number(req.params.id) });
  res.json({ ok: true });
});

// ---- lead activities (tasks / notes / meetings) ----
const ACT_COLS = ['kind', 'title', 'body', 'due_date', 'meeting_time', 'location', 'status', 'priority', 'owner'];
const ACT_KINDS = ['task', 'note', 'meeting'];

app.get('/api/leads/:id/activities', auth, async (req, res) => {
  res.json(await db.prepare('SELECT * FROM lead_activities WHERE lead_id = ? ORDER BY id DESC').all(req.params.id));
});

app.post('/api/leads/:id/activities', auth, async (req, res) => {
  const f = req.body || {};
  if (!ACT_KINDS.includes(f.kind)) return res.status(400).json({ error: 'Invalid activity type' });
  if (f.kind === 'note' ? !f.body?.trim() : !f.title?.trim()) {
    return res.status(400).json({ error: f.kind === 'note' ? 'Note text is required' : 'A title is required' });
  }
  const lead = await db.prepare('SELECT id FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  const vals = [f.kind, f.title || '', f.body || '', f.due_date || '', f.meeting_time || '',
    f.location || '', f.status || 'Open', f.priority || 'Medium', f.owner || req.user.name];
  const info = await db.prepare(`INSERT INTO lead_activities (lead_id, ${ACT_COLS.join(',')})
    VALUES (?,${ACT_COLS.map(() => '?').join(',')})`).run(req.params.id, ...vals);
  const row = await db.prepare('SELECT * FROM lead_activities WHERE id = ?').get(info.lastInsertRowid);
  emit('lead-activity', 'created', row);
  res.json(row);
});

app.put('/api/lead-activities/:id', auth, async (req, res) => {
  const cur = await db.prepare('SELECT * FROM lead_activities WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  const m = { ...cur, ...req.body };
  await db.prepare(`UPDATE lead_activities SET ${ACT_COLS.map((c) => `${c}=?`).join(', ')} WHERE id=?`)
    .run(...ACT_COLS.map((c) => m[c] ?? ''), req.params.id);
  const row = await db.prepare('SELECT * FROM lead_activities WHERE id = ?').get(req.params.id);
  emit('lead-activity', 'updated', row);
  res.json(row);
});

app.delete('/api/lead-activities/:id', auth, async (req, res) => {
  const cur = await db.prepare('SELECT * FROM lead_activities WHERE id = ?').get(req.params.id);
  await db.prepare('DELETE FROM lead_activities WHERE id = ?').run(req.params.id);
  emit('lead-activity', 'deleted', { id: Number(req.params.id), lead_id: cur?.lead_id });
  res.json({ ok: true });
});

// ---- agencies: create / update / delete ----
app.post('/api/agencies', auth, async (req, res) => {
  const f = req.body;
  if (!f.agency_name) return res.status(400).json({ error: 'Agency name is required' });
  const info = await db.prepare('INSERT INTO agencies (agency_name, type, contact_person, mobile, email, city) VALUES (?,?,?,?,?,?)')
    .run(f.agency_name, f.type || 'GI', f.contact_person || '', f.mobile || '', f.email || '', f.city || '');
  await emitRow('agency', 'created', 'agencies', info.lastInsertRowid);
  res.json({ id: info.lastInsertRowid });
});
app.put('/api/agencies/:id', auth, async (req, res) => {
  const f = req.body;
  await db.prepare('UPDATE agencies SET agency_name=?, type=?, contact_person=?, mobile=?, email=?, city=? WHERE id=?')
    .run(f.agency_name || '', f.type || 'GI', f.contact_person || '', f.mobile || '', f.email || '', f.city || '', req.params.id);
  await emitRow('agency', 'updated', 'agencies', req.params.id);
  res.json({ ok: true });
});
app.delete('/api/agencies/:id', auth, async (req, res) => {
  await db.prepare('DELETE FROM agencies WHERE id = ?').run(req.params.id);
  emit('agency', 'deleted', { id: Number(req.params.id) });
  res.json({ ok: true });
});

// ---- clients: merge duplicate into primary ----
app.post('/api/clients/merge', auth, async (req, res) => {
  const { primaryId, dupId } = req.body;
  if (!primaryId || !dupId || primaryId === dupId) return res.status(400).json({ error: 'Select two different clients' });
  const primary = await db.prepare('SELECT * FROM clients WHERE id = ?').get(primaryId);
  const dup = await db.prepare('SELECT * FROM clients WHERE id = ?').get(dupId);
  if (!primary || !dup) return res.status(404).json({ error: 'Client not found' });
  // Re-link the duplicate's records to the primary, then remove the duplicate.
  await db.prepare('UPDATE policies SET client_id = ?, insured_name = ? WHERE client_id = ? OR insured_name = ?')
    .run(primaryId, primary.client_name, dupId, dup.client_name);
  await db.prepare('UPDATE claims SET client_name = ? WHERE client_name = ?').run(primary.client_name, dup.client_name);
  await db.prepare('UPDATE fd_transactions SET client_name = ? WHERE client_name = ?').run(primary.client_name, dup.client_name);
  await db.prepare('DELETE FROM clients WHERE id = ?').run(dupId);
  emit('client', 'deleted', { id: Number(dupId) });
  res.json({ ok: true });
});

// ---- policies: partial update (FUP date, assignment) ----
app.put('/api/policies/:id', auth, async (req, res) => {
  const cur = await db.prepare('SELECT * FROM policies WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  const allowed = ['period_to', 'period_from', 'assigned_to', 'policy_status', 'final_premium', 'renewal_status'];
  const sets = [], vals = [];
  for (const k of allowed) if (k in req.body) { sets.push(`${k} = ?`); vals.push(req.body[k]); }
  if (sets.length === 0) return res.json({ ok: true });
  vals.push(req.params.id);
  await db.prepare(`UPDATE policies SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  await emitRow('policy', 'updated', 'policies', req.params.id);
  res.json({ ok: true });
});

// ---- integration settings (SMTP / WhatsApp credentials) ----
// Stored server-side, scoped to the logged-in user. Secrets (smtp_pass,
// wa_token) are never echoed back to the client — GET reports only whether
// one is on file (hasSmtpPass/hasWaToken) — and PUT leaves a secret
// untouched unless the caller sends a new, non-empty value for it.
async function readIntegrationSettings(userId) {
  return db.prepare('SELECT * FROM integration_settings WHERE user_id = ?').get(userId);
}

app.get('/api/integration-settings', auth, async (req, res) => {
  const s = (await readIntegrationSettings(req.user.id)) || {};
  res.json({
    emailEnabled: !!s.email_enabled,
    smtpHost: s.smtp_host || '', smtpPort: s.smtp_port || '587', smtpSecure: s.smtp_secure || 'TLS',
    smtpUser: s.smtp_user || '', smtpFromName: s.smtp_from_name || '', smtpFromEmail: s.smtp_from_email || '',
    hasSmtpPass: !!s.smtp_pass,
    waEnabled: !!s.wa_enabled,
    waProvider: s.wa_provider || 'WhatsApp Business API', waPhoneId: s.wa_phone_id || '', waBusinessId: s.wa_business_id || '',
    hasWaToken: !!s.wa_token,
  });
});

app.put('/api/integration-settings', auth, async (req, res) => {
  const b = req.body || {};
  const cur = (await readIntegrationSettings(req.user.id)) || {};
  const smtpPass = b.smtpPass ? b.smtpPass : (cur.smtp_pass || null);
  const waToken = b.waToken ? b.waToken : (cur.wa_token || null);
  await db.prepare(`
    INSERT INTO integration_settings
      (user_id, email_enabled, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, smtp_from_name, smtp_from_email,
       wa_enabled, wa_provider, wa_phone_id, wa_business_id, wa_token)
    VALUES (@user_id, @email_enabled, @smtp_host, @smtp_port, @smtp_secure, @smtp_user, @smtp_pass, @smtp_from_name, @smtp_from_email,
            @wa_enabled, @wa_provider, @wa_phone_id, @wa_business_id, @wa_token)
    ON CONFLICT(user_id) DO UPDATE SET
      email_enabled=excluded.email_enabled, smtp_host=excluded.smtp_host, smtp_port=excluded.smtp_port,
      smtp_secure=excluded.smtp_secure, smtp_user=excluded.smtp_user, smtp_pass=excluded.smtp_pass,
      smtp_from_name=excluded.smtp_from_name, smtp_from_email=excluded.smtp_from_email,
      wa_enabled=excluded.wa_enabled, wa_provider=excluded.wa_provider, wa_phone_id=excluded.wa_phone_id,
      wa_business_id=excluded.wa_business_id, wa_token=excluded.wa_token
  `).run({
    user_id: req.user.id,
    email_enabled: b.emailEnabled ? 1 : 0,
    smtp_host: b.smtpHost || '', smtp_port: b.smtpPort || '587', smtp_secure: b.smtpSecure || 'TLS',
    smtp_user: b.smtpUser || '', smtp_pass: smtpPass, smtp_from_name: b.smtpFromName || '', smtp_from_email: b.smtpFromEmail || '',
    wa_enabled: b.waEnabled ? 1 : 0,
    wa_provider: b.waProvider || 'WhatsApp Business API', wa_phone_id: b.waPhoneId || '', wa_business_id: b.waBusinessId || '',
    wa_token: waToken,
  });
  res.json({ ok: true });
});

// ---- outbound email (SMTP settings resolved server-side from the caller's saved integration settings) ----
app.post('/api/send-email', auth, async (req, res) => {
  const { to, subject, html, attachments } = req.body || {};
  const s = await readIntegrationSettings(req.user.id);
  if (!s?.email_enabled) return res.status(400).json({ error: 'Email integration is disabled — enable it in My Profile first.' });
  if (!s?.smtp_host || !s?.smtp_user || !s?.smtp_pass) return res.status(400).json({ error: 'Email integration is not configured — add SMTP settings in My Profile first.' });
  if (!to) return res.status(400).json({ error: 'No recipient email address' });
  try {
    const transporter = nodemailer.createTransport({
      host: s.smtp_host,
      port: Number(s.smtp_port) || 587,
      secure: s.smtp_secure === 'SSL',
      auth: { user: s.smtp_user, pass: s.smtp_pass },
    });
    const mailAttachments = (Array.isArray(attachments) ? attachments : []).map((a) => ({
      filename: a.filename || 'document.pdf',
      content: (a.contentBase64 || '').split(',').pop(),
      encoding: 'base64',
    }));
    await transporter.sendMail({
      from: `"${s.smtp_from_name || s.smtp_user}" <${s.smtp_from_email || s.smtp_user}>`,
      to, subject: subject || '', html: html || '', attachments: mailAttachments,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to send email' });
  }
});

// ---- outbound WhatsApp (Meta Cloud API, credentials resolved server-side from the caller's saved integration settings) ----
app.post('/api/send-whatsapp', auth, async (req, res) => {
  const { to, message, mediaBase64, filename } = req.body || {};
  const s = await readIntegrationSettings(req.user.id);
  if (!s?.wa_enabled) return res.status(400).json({ error: 'WhatsApp integration is disabled — enable it in My Profile first.' });
  if (!s?.wa_phone_id || !s?.wa_token) return res.status(400).json({ error: 'WhatsApp integration is not configured — add API credentials in My Profile first.' });
  let digits = String(to || '').replace(/\D/g, '');
  if (!digits) return res.status(400).json({ error: 'No recipient phone number' });
  // Bare 10-digit numbers (how mobiles are stored throughout the app) need the
  // country code for the Cloud API — default to India (91) same as the old wa.me links.
  if (digits.length === 10) digits = '91' + digits;
  try {
    let mediaId = null;
    if (mediaBase64) {
      const buf = Buffer.from(mediaBase64.split(',').pop(), 'base64');
      const form = new FormData();
      form.append('file', new Blob([buf], { type: 'application/pdf' }), filename || 'document.pdf');
      form.append('messaging_product', 'whatsapp');
      const upRes = await fetch(`https://graph.facebook.com/v20.0/${s.wa_phone_id}/media`, {
        method: 'POST', headers: { Authorization: `Bearer ${s.wa_token}` }, body: form,
      });
      const upData = await upRes.json();
      if (!upRes.ok) throw new Error(upData.error?.message || 'Media upload failed');
      mediaId = upData.id;
    }
    const body = mediaId
      ? { messaging_product: 'whatsapp', to: digits, type: 'document', document: { id: mediaId, filename: filename || 'document.pdf', caption: message || '' } }
      : { messaging_product: 'whatsapp', to: digits, type: 'text', text: { body: message || '' } };
    const sendRes = await fetch(`https://graph.facebook.com/v20.0/${s.wa_phone_id}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${s.wa_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const sendData = await sendRes.json();
    if (!sendRes.ok) throw new Error(sendData.error?.message || 'WhatsApp send failed');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to send WhatsApp message' });
  }
});

// ---- meetings ----
const MEETING_COLS = ['title', 'meeting_type', 'location', 'from_date', 'from_time', 'to_date', 'to_time',
  'owner', 'notify_participants', 'status', 'minutes'];
const PARTICIPANT_KINDS = ['client', 'lead', 'user'];

function meetingPayload(f, fallbackOwner) {
  return {
    title: (f.title || '').trim(),
    meeting_type: f.meeting_type === 'Existing' ? 'Existing' : 'New',
    location: f.location || '',
    from_date: f.from_date || '', from_time: f.from_time || '',
    to_date: f.to_date || '', to_time: f.to_time || '',
    owner: f.owner || fallbackOwner || '',
    notify_participants: f.notify_participants ? 1 : 0,
    status: f.status || 'Scheduled',
    // Minutes only belong on a completed meeting — clearing them otherwise
    // stops a draft MoM lingering on a meeting that was moved back to
    // Scheduled or cancelled outright.
    minutes: f.status === 'Completed' ? (f.minutes || '') : '',
  };
}

// Attach participants + reminders to a set of meetings in two extra queries
// rather than one per meeting.
async function withRelations(meetings) {
  if (!meetings.length) return meetings;
  const ids = meetings.map((m) => m.id);
  const ph = ids.map(() => '?').join(',');
  const parts = await db.prepare(`SELECT * FROM meeting_participants WHERE meeting_id IN (${ph}) ORDER BY id`).all(...ids);
  const rems = await db.prepare(`SELECT * FROM meeting_reminders WHERE meeting_id IN (${ph}) ORDER BY offset_minutes DESC`).all(...ids);
  return meetings.map((m) => ({
    ...m,
    participants: parts.filter((p) => p.meeting_id === m.id),
    reminders: rems.filter((r) => r.meeting_id === m.id),
  }));
}

async function saveParticipants(meetingId, list) {
  await db.prepare('DELETE FROM meeting_participants WHERE meeting_id = ?').run(meetingId);
  for (const p of Array.isArray(list) ? list : []) {
    if (!PARTICIPANT_KINDS.includes(p.kind) || !p.name) continue;
    await db.prepare('INSERT INTO meeting_participants (meeting_id, kind, ref_id, name, email, mobile) VALUES (?,?,?,?,?,?)')
      .run(meetingId, p.kind, p.ref_id || null, p.name, p.email || '', p.mobile || '');
  }
}

// Reminders are reconciled rather than replaced: an unchanged reminder keeps
// its row (and its `sent` flag), so editing an unrelated field on the meeting
// doesn't cause an already-fired reminder to fire a second time.
async function saveReminders(meetingId, list) {
  const wanted = [...new Set((Array.isArray(list) ? list : [])
    .map((r) => Number(r.offset_minutes ?? r))
    .filter((n) => Number.isFinite(n) && n >= 0))];
  const existing = await db.prepare('SELECT * FROM meeting_reminders WHERE meeting_id = ?').all(meetingId);
  for (const e of existing) {
    if (!wanted.includes(e.offset_minutes)) await db.prepare('DELETE FROM meeting_reminders WHERE id = ?').run(e.id);
  }
  for (const off of wanted) {
    if (!existing.some((e) => e.offset_minutes === off)) {
      await db.prepare('INSERT INTO meeting_reminders (meeting_id, offset_minutes) VALUES (?,?)').run(meetingId, off);
    }
  }
}

app.get('/api/meetings', auth, async (req, res) => {
  const rows = await db.prepare('SELECT * FROM meetings ORDER BY from_date DESC NULLS LAST, from_time DESC, id DESC').all();
  res.json(await withRelations(rows));
});

app.get('/api/meetings/:id', auth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM meetings WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json((await withRelations([row]))[0]);
});

app.post('/api/meetings', auth, async (req, res) => {
  const f = req.body || {};
  if (!f.title?.trim()) return res.status(400).json({ error: 'Title is required' });
  const p = meetingPayload(f, req.user.name);
  const info = await db.prepare(`INSERT INTO meetings (${MEETING_COLS.join(',')}) VALUES (${MEETING_COLS.map(() => '?').join(',')})`)
    .run(...MEETING_COLS.map((c) => p[c]));
  await saveParticipants(info.lastInsertRowid, f.participants);
  await saveReminders(info.lastInsertRowid, f.reminders);
  const row = (await withRelations([await db.prepare('SELECT * FROM meetings WHERE id = ?').get(info.lastInsertRowid)]))[0];
  emit('meeting', 'created', row);
  await notify({ entity: 'meeting', kind: 'created', icon: 'calendar', tone: 'info', refTable: 'meetings', refId: row.id,
    title: 'Meeting scheduled', body: `${p.title}${p.from_date ? ' · ' + p.from_date + (p.from_time ? ' ' + p.from_time : '') : ''}`, link: '/page/meeting' });
  res.json(row);
});

app.put('/api/meetings/:id', auth, async (req, res) => {
  const cur = await db.prepare('SELECT * FROM meetings WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  const f = { ...cur, ...req.body };
  if (!f.title?.trim()) return res.status(400).json({ error: 'Title is required' });
  const p = meetingPayload(f, cur.owner);
  await db.prepare(`UPDATE meetings SET ${MEETING_COLS.map((c) => `${c}=?`).join(', ')} WHERE id=?`)
    .run(...MEETING_COLS.map((c) => p[c]), req.params.id);
  if (req.body.participants !== undefined) await saveParticipants(Number(req.params.id), req.body.participants);
  if (req.body.reminders !== undefined) await saveReminders(Number(req.params.id), req.body.reminders);
  const row = (await withRelations([await db.prepare('SELECT * FROM meetings WHERE id = ?').get(req.params.id)]))[0];
  emit('meeting', 'updated', row);
  if (req.body.status && req.body.status !== cur.status && req.body.status === 'Completed') {
    await notify({ entity: 'meeting', kind: 'completed', icon: 'check', tone: 'success', refTable: 'meetings', refId: row.id,
      title: 'Meeting completed', body: row.title, link: '/page/meeting' });
  }
  res.json(row);
});

app.delete('/api/meetings/:id', auth, async (req, res) => {
  // participants + reminders cascade (see schema).
  await db.prepare('DELETE FROM meetings WHERE id = ?').run(req.params.id);
  emit('meeting', 'deleted', { id: Number(req.params.id) });
  res.json({ ok: true });
});

// ---- meeting reminder scheduler ----
// Fires any reminder whose lead time has arrived, as a real notification on
// the bell feed. Runs often (the whole point of a 15-minute reminder is that
// it lands near that mark), and marks rows sent so each fires exactly once.
// The 1-day floor stops a backlog of long-past meetings firing at once if the
// server was down or a meeting was backdated.
async function checkMeetingReminders() {
  try {
    const due = await db.prepare(`
      SELECT r.id, r.offset_minutes, m.id AS m_id, m.title, m.from_date, m.from_time, m.location, m.notify_participants
      FROM meeting_reminders r
      JOIN meetings m ON m.id = r.meeting_id
      WHERE r.sent = 0
        AND m.status NOT IN ('Cancelled', 'Completed')
        AND NULLIF(m.from_date, '') IS NOT NULL
        AND (NULLIF(m.from_date,'')::date + COALESCE(NULLIF(m.from_time,''), '00:00')::time)
            - (r.offset_minutes * INTERVAL '1 minute') <= now()
        AND (NULLIF(m.from_date,'')::date + COALESCE(NULLIF(m.from_time,''), '00:00')::time)
            >= now() - INTERVAL '1 day'
    `).all();
    for (const d of due) {
      const mins = d.offset_minutes;
      const when = mins === 0 ? 'now'
        : mins % 1440 === 0 ? `in ${mins / 1440} day${mins / 1440 > 1 ? 's' : ''}`
        : mins % 60 === 0 ? `in ${mins / 60} hour${mins / 60 > 1 ? 's' : ''}`
        : `in ${mins} minutes`;
      const parts = [];
      if (d.from_time) parts.push(d.from_time);
      if (d.location) parts.push(d.location);
      await notify({
        entity: 'meeting', kind: 'reminder', icon: 'clock', tone: 'warning',
        refTable: 'meetings', refId: d.m_id,
        title: `Meeting ${when}: ${d.title}`,
        body: parts.join(' · '),
        link: '/page/meeting',
      });
      await db.prepare("UPDATE meeting_reminders SET sent = 1, sent_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?").run(d.id);
    }
  } catch (e) {
    console.error('checkMeetingReminders failed:', e.message);
  }
}

// ---- notifications (bell-icon feed) ----
app.get('/api/notifications', auth, async (req, res) => {
  res.json(await db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT 50').all());
});
app.put('/api/notifications/:id/read', auth, async (req, res) => {
  await db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
app.put('/api/notifications/read-all', auth, async (req, res) => {
  await db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();
  res.json({ ok: true });
});

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'WCA CRM API' }));

// Always respond with JSON on error (oversized/malformed body, uncaught route
// errors) — Express's default HTML error page can't be parsed by the client,
// which then just reports a generic "Request failed".
app.use((err, req, res, next) => {
  if (!err) return next();
  res.status(err.status || err.statusCode || 500).json({ error: err.type === 'entity.too.large' ? 'File is too large to upload' : (err.message || 'Server error') });
});

// Short delay so this runs after the first request traffic settles, not
// competing with server startup; every 6h after that.
setTimeout(checkDueNotifications, 15000);
setInterval(checkDueNotifications, 6 * 60 * 60 * 1000);

// Meeting reminders need much finer granularity than the daily due-date
// sweep above — a "15 minutes before" reminder is useless on a 6h cycle.
setTimeout(checkMeetingReminders, 20000);
setInterval(checkMeetingReminders, 60 * 1000);

app.listen(PORT, () => console.log(`WCA CRM API running on http://localhost:${PORT}`));
