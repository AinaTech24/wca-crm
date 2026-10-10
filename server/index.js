// Loads server/.env into process.env for local dev (no-op if the file
// doesn't exist — production sets real env vars via PM2/systemd instead).
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import db, { initDb } from './db.js';
import * as vartify from './vartify.js';
import {
  DEPARTMENTS, PERSONAL, COMMERCIAL, BOTH, PERSONAL_PRODUCTS,
  departmentForProduct, departmentForClaimType, seesAllDepartments,
} from './departments.js';
import { reportSpec, dateFilter } from './reports.js';
import { AUTO_EVENTS, DEFAULT_TEMPLATES, fillTokens, loadTemplate, anySmtp, autoMailEnabled } from './automail.js';
import { MODULES as ACCESS_MODULES, MODULE_KEYS, parseAccess, canAccessPath } from './modules.js';

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'wca-crm-dev-secret-change-in-prod';

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
// Default 100kb is far too small for base64-encoded PDF/image attachments
// (RFQ documents, claim photos, profile pictures) sent as part of the JSON body.
// The Vartify webhook signature is computed over the *raw* body, so it has
// to be captured before JSON parsing replaces it.
app.use(express.json({ limit: '20mb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));

// Top-level await, so nothing below this line — including app.listen at the
// bottom of the file — runs until it resolves. That is a trap worth guarding:
// if Postgres is briefly unreachable at boot, an unguarded await here leaves
// the process alive and idle, never binding the port. PM2 reports "online",
// nginx serves the static site normally, and every /api call returns 502 with
// nothing in the logs. That is the failure this retry exists to prevent.
//
// So: bounded retries with backoff, then exit non-zero. Exiting is the useful
// outcome — PM2 restarts a dead process and eventually flags it unstable,
// whereas a hung one looks healthy forever.
async function initWithRetry(attempts = 10) {
  for (let i = 1; i <= attempts; i++) {
    try {
      // Each attempt is capped, because a pool waiting on an unreachable host
      // hangs rather than throwing, which is the case that bit us.
      await Promise.race([
        initDb(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('initDb timed out after 20s')), 20000)),
      ]);
      if (i > 1) console.log(`Database ready after ${i} attempts`);
      return;
    } catch (e) {
      const wait = Math.min(2 ** i, 30);
      console.error(`Database not ready (attempt ${i}/${attempts}): ${e.message}`);
      if (i === attempts) {
        console.error('Giving up on the database — exiting so the process manager restarts us rather than sitting here not listening.');
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, wait * 1000));
    }
  }
}
await initWithRetry();

// Stamps a department on any record created before departments existed (or
// saved without a product). Idempotent — only touches rows still unset, so
// it's a no-op on every boot after the first.
async function backfillDepartments() {
  try {
    const jobs = [
      ['policies', 'insurance_type', departmentForProduct],
      ['leads', 'expected_business_type', departmentForProduct],
      ['rfqs', 'category', departmentForProduct],
      ['claims', 'claim_type', departmentForClaimType],
    ];
    let stamped = 0;
    for (const [table, col, fn] of jobs) {
      const rows = await db.prepare(`SELECT id, ${col} AS src FROM ${table} WHERE department IS NULL OR department = ''`).all();
      for (const r of rows) {
        const dept = fn(r.src);
        if (!dept) continue;                       // nothing to classify from
        await db.prepare(`UPDATE ${table} SET department = ? WHERE id = ?`).run(dept, r.id);
        stamped++;
      }
    }
    if (stamped) console.log(`Departments backfilled on ${stamped} record(s)`);
  } catch (e) {
    console.error('backfillDepartments failed:', e.message);
  }
}
await backfillDepartments();

// ---- auth middleware ----
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
  // Module access is checked here rather than route by route, so every
  // authenticated endpoint is covered by construction — including any added
  // later, which is the failure mode a per-route guard invites. Public routes
  // (login, health, the provider webhook) don't use auth and are unaffected.
  moduleGuard(req, res, next);
}

// Enforces module access on every authenticated request. Hiding a module in
// the sidebar is a convenience, not a control — without this, a limited user
// could still reach the data by typing the URL or calling the API directly.
async function moduleGuard(req, res, next) {
  try {
    const me = await db.prepare('SELECT role, module_access FROM users WHERE id = ?').get(req.user.id);
    if (!me) return res.status(401).json({ error: 'Account no longer exists' });
    req.access = me;
    if (canAccessPath(me, req.path)) return next();
    res.status(403).json({ error: "You don't have access to that module. Ask an admin if you need it." });
  } catch (e) {
    console.error('moduleGuard failed:', e.message);
    next();
  }
}

// ---- department scoping ----
// Read from the users table rather than the JWT: tokens issued before
// departments existed have no department claim, and a role change should
// take effect without forcing a re-login.
async function scope(req) {
  const u = await db.prepare('SELECT role, department, is_head FROM users WHERE id = ?').get(req.user.id);
  return { all: seesAllDepartments(u), department: u?.department || null, isHead: Number(u?.is_head) === 1, role: u?.role };
}

// Appends a department filter to a WHERE-building query, unless the caller
// sees everything. `col` is qualified where the query uses a table alias.
async function applyScope(req, sql, params, col = 'department') {
  const sc = await scope(req);
  if (!sc.all && sc.department) {
    sql += ` AND (${col} = ? OR ${col} IS NULL OR ${col} = '')`;
    params.push(sc.department);
  }
  return sql;
}

// Rejects touching an existing record that belongs to another department.
// Returns an error message, or null when it's allowed.
async function denyRecordAccess(req, table, id) {
  const sc = await scope(req);
  if (sc.all || !sc.department) return null;
  const row = await db.prepare(`SELECT department FROM ${table} WHERE id = ?`).get(id);
  if (!row) return null;                       // let the route return its own 404
  if (row.department && row.department !== sc.department) return 'That record belongs to another department.';
  return null;
}

// Blocks writing a record into a department the user isn't part of, so a
// Personal Lines user can't create Commercial business that then vanishes
// from their own list.
async function denyCrossDepartment(req, department) {
  if (!department) return null;
  const sc = await scope(req);
  if (sc.all || !sc.department) return null;
  if (department !== sc.department) return `This is ${department} business — you're in ${sc.department}.`;
  return null;
}

// The classification rule, so the UI can show which department a product
// lands in without keeping its own copy of the list.
app.get('/api/departments', auth, async (req, res) => {
  const sc = await scope(req);
  res.json({ departments: DEPARTMENTS, personalProducts: PERSONAL_PRODUCTS, scope: sc });
});

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
async function renewalRows(line, sc) {
  let rows = sc && !sc.all && sc.department
    ? await db.prepare("SELECT * FROM policies WHERE renewable = 'Yes' AND (department = ? OR department IS NULL OR department = '')").all(sc.department)
    : await db.prepare("SELECT * FROM policies WHERE renewable = 'Yes'").all();
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
    // Task due-dates are handled by checkTaskReminders() now, which respects
    // each task's own reminder lead time — notifying here as well would
    // double up on the same task.
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
  const rows = await db.prepare('SELECT id, username, full_name, role, department, is_head, module_access FROM users ORDER BY full_name').all();
  res.json(rows.map((r) => ({ ...r, module_access: parseAccess(r.module_access) })));
});

// What the signed-in user may open. The sidebar and routes read this, so the
// UI shows exactly what the server would allow rather than guessing.
app.get('/api/my-access', auth, async (req, res) => {
  const me = await db.prepare('SELECT role, module_access FROM users WHERE id = ?').get(req.user.id);
  const allowed = parseAccess(me?.module_access);
  res.json({
    role: me?.role || 'user',
    modules: me?.role === 'admin' || !allowed ? MODULE_KEYS : allowed,
    all: me?.role === 'admin' || !allowed,
  });
});

// Set which modules a user may open. Admin only, and an admin's own access is
// never narrowed — losing Team would leave nobody able to hand it back.
app.put('/api/users/:id/modules', auth, async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const target = await db.prepare('SELECT id, role, full_name FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Not found' });
  if (target.role === 'admin') return res.status(400).json({ error: 'An admin always has every module' });
  const list = Array.isArray(req.body?.modules) ? req.body.modules.filter((k) => MODULE_KEYS.includes(k)) : [];
  // Empty means "no limits" everywhere else, so an admin clearing the list is
  // storing exactly that rather than silently locking the user out.
  await db.prepare('UPDATE users SET module_access = ? WHERE id = ?')
    .run(list.length ? JSON.stringify(list) : null, req.params.id);
  const row = await db.prepare('SELECT id, username, full_name, role, department, is_head, module_access FROM users WHERE id = ?').get(req.params.id);
  const out = { ...row, module_access: parseAccess(row.module_access) };
  emit('user', 'updated', out);
  res.json(out);
});

// The catalogue the permission editor renders.
app.get('/api/modules', auth, (req, res) => res.json(ACCESS_MODULES.map(({ key, label }) => ({ key, label }))));

// Admin-only guard for the team-management routes below.
async function requireAdmin(req, res) {
  const me = await db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id);
  if (me?.role !== 'admin') { res.status(403).json({ error: 'Only an admin can manage users' }); return false; }
  return true;
}

// Create a teammate. Login matches usernames case-insensitively, so
// uniqueness is checked the same way — otherwise "Priya" and "priya" would
// both exist and the login lookup couldn't tell them apart.
app.post('/api/users', auth, async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const username = (req.body?.username || '').trim();
  const full_name = (req.body?.full_name || '').trim();
  const password = req.body?.password || '';
  const { role, department, is_head } = req.body || {};
  if (!username) return res.status(400).json({ error: 'Username is required' });
  if (!full_name) return res.status(400).json({ error: 'Full name is required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (department && ![...DEPARTMENTS, BOTH].includes(department)) return res.status(400).json({ error: 'Unknown department' });
  const clash = await db.prepare('SELECT id FROM users WHERE username ILIKE ?').get(username);
  if (clash) return res.status(409).json({ error: 'That username is already taken' });

  const hash = bcrypt.hashSync(password, 10);
  const info = await db.prepare('INSERT INTO users (username, password_hash, full_name, role, department, is_head) VALUES (?,?,?,?,?,?)')
    .run(username, hash, full_name, role === 'admin' ? 'admin' : 'user', department || BOTH, is_head ? 1 : 0);
  const row = await db.prepare('SELECT id, username, full_name, role, department, is_head FROM users WHERE id = ?').get(info.lastInsertRowid);
  emit('user', 'created', row);
  await notify({ entity: 'user', kind: 'created', icon: 'userplus', tone: 'info', refTable: 'users', refId: row.id,
    title: 'New user added', body: `${full_name} · ${row.department}`, link: '/page/team' });
  res.json(row);
});

// Admin password reset. Deliberately does not require the old password —
// the point is to recover an account whose password nobody knows.
app.put('/api/users/:id/password', auth, async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const password = req.body?.password || '';
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const target = await db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), req.params.id);
  res.json({ ok: true });
});

app.delete('/api/users/:id', auth, async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  if (Number(req.params.id) === Number(req.user.id)) return res.status(400).json({ error: "You can't delete your own account" });
  const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.role === 'admin') {
    const admins = (await db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin'").get()).c;
    if (Number(admins) <= 1) return res.status(400).json({ error: 'This is the only admin — promote someone else first' });
  }
  // integration_settings references users(id), so it goes first.
  await db.prepare('DELETE FROM integration_settings WHERE user_id = ?').run(req.params.id);
  await db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  emit('user', 'deleted', { id: Number(req.params.id) });
  res.json({ ok: true });
});

// Team administration: who belongs to which department, and who heads it.
// Admin-only — this is what decides what everyone else can see.
app.put('/api/users/:id/department', auth, async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { department, is_head, role } = req.body || {};
  if (department && ![...DEPARTMENTS, BOTH].includes(department)) return res.status(400).json({ error: 'Unknown department' });
  const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  // Refuse to strip the last admin, which would lock everyone out of this
  // very screen.
  if (role && role !== 'admin' && target.role === 'admin') {
    const admins = (await db.prepare("SELECT COUNT(*) c FROM users WHERE role = 'admin'").get()).c;
    if (Number(admins) <= 1) return res.status(400).json({ error: 'This is the only admin — promote someone else first' });
  }
  await db.prepare('UPDATE users SET department = ?, is_head = ?, role = ? WHERE id = ?')
    .run(department || target.department || BOTH, is_head ? 1 : 0, role || target.role, req.params.id);
  const row = await db.prepare('SELECT id, username, full_name, role, department, is_head FROM users WHERE id = ?').get(req.params.id);
  emit('user', 'updated', row);
  res.json(row);
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
  // Every aggregate below is department-scoped, otherwise the headline
  // numbers would include business the user can't open.
  const sc = await scope(req);
  const dq = sc.all || !sc.department ? '' : ' AND department = ?';
  const dw = sc.all || !sc.department ? '' : ' WHERE department = ?';
  const dp = sc.all || !sc.department ? [] : [sc.department];
  // Status buckets span both the Policy module's values (Draft / In Progress /
  // Issued / Completed / Lost / Cancelled) and the older ones already on the
  // table, so a policy counts no matter which vocabulary created it.
  const policyCurrentYear = (await db.prepare("SELECT COUNT(*) c FROM policies WHERE policy_status IN ('Policy','Issued','Completed')" + dq).get(...dp)).c;
  const policyPending = (await db.prepare("SELECT COUNT(*) c FROM policies WHERE policy_status IN ('Proposal','Pending','Draft','In Progress')" + dq).get(...dp)).c;
  const policyIssued = (await db.prepare("SELECT COUNT(*) c FROM policies WHERE policy_status IN ('Issued','Completed')" + dq).get(...dp)).c;
  const policyCancel = (await db.prepare("SELECT COUNT(*) c FROM policies WHERE policy_status IN ('Cancel','Decline','Cancelled','Lost')" + dq).get(...dp)).c;

  const claimTotal = (await db.prepare('SELECT COUNT(*) c FROM claims' + dw).get(...dp)).c;
  const claimPending = (await db.prepare("SELECT COUNT(*) c FROM claims WHERE status IN ('Pending','Intimated','Documents Pending','Under Process','Surveyor Appointed','Under Investigation','Under Assessment','Under Defense','Approved')" + dq).get(...dp)).c;
  const claimSettled = (await db.prepare("SELECT COUNT(*) c FROM claims WHERE status = 'Settled'" + dq).get(...dp)).c;
  const claimRejected = (await db.prepare("SELECT COUNT(*) c FROM claims WHERE status IN ('Rejected','Withdrawn','Closed')" + dq).get(...dp)).c;

  const companyWise = await db.prepare('SELECT company_name label, COUNT(*) value FROM policies' + dw + ' GROUP BY company_name').all(...dp);
  const typeWise = await db.prepare('SELECT insurance_type label, COUNT(*) value FROM policies' + dw + ' GROUP BY insurance_type').all(...dp);
  const businessWise = await db.prepare('SELECT insurance_line label, ROUND(SUM(final_premium)) value FROM policies' + dw + ' GROUP BY insurance_line').all(...dp);
  // Department split — only meaningful for someone who can see both.
  const departmentWise = sc.all
    ? await db.prepare("SELECT COALESCE(NULLIF(department,''),'Unclassified') label, COUNT(*) value FROM policies GROUP BY 1").all()
    : [];

  const giRenewals = await db.prepare("SELECT * FROM policies WHERE insurance_line = 'GI'" + dq + ' ORDER BY period_to LIMIT 25').all(...dp);
  const liRenewals = await db.prepare("SELECT * FROM policies WHERE insurance_line = 'LI'" + dq + ' ORDER BY period_to LIMIT 25').all(...dp);

  const renewal = renewalSummary(await renewalRows(undefined, sc));

  // Whole-business totals, for admins only. They are deliberately not scoped
  // to a department: an admin sees every record, and a head or user shown a
  // company-wide count would be shown business they cannot open.
  let totals = null;
  if (sc.role === 'admin') {
    const n = async (sql) => Number((await db.prepare(sql).get())?.c || 0);
    const [leads, leadsOpen, rfqs, rfqsOpen, clients, clientsActive, policies, policiesActive, claims, claimsOpen,
      tasks, tasksOpen, meetings, meetingsUpcoming, team, admins] = await Promise.all([
      n('SELECT COUNT(*) c FROM leads'),
      n("SELECT COUNT(*) c FROM leads WHERE COALESCE(status,'') NOT IN ('Converted','Lost','Junk')"),
      n('SELECT COUNT(*) c FROM rfqs'),
      n("SELECT COUNT(*) c FROM rfqs WHERE COALESCE(status,'') NOT IN ('Closed','Lost')"),
      n('SELECT COUNT(*) c FROM clients'),
      n("SELECT COUNT(*) c FROM clients WHERE COALESCE(client_status,'Active') = 'Active'"),
      n('SELECT COUNT(*) c FROM policies'),
      n("SELECT COUNT(*) c FROM policies WHERE COALESCE(active_status,'Active') <> 'Inactive'"),
      n('SELECT COUNT(*) c FROM claims'),
      n("SELECT COUNT(*) c FROM claims WHERE COALESCE(status,'') NOT IN ('Settled','Rejected','Withdrawn','Closed')"),
      n('SELECT COUNT(*) c FROM tasks'),
      n("SELECT COUNT(*) c FROM tasks WHERE COALESCE(status,'') NOT IN ('Completed','Cancelled')"),
      n('SELECT COUNT(*) c FROM meetings'),
      // NULLIF guards the empty-string dates a cast would otherwise choke on.
      n("SELECT COUNT(*) c FROM meetings WHERE NULLIF(from_date,'')::date >= CURRENT_DATE AND COALESCE(status,'') IN ('Scheduled','Rescheduled')"),
      n('SELECT COUNT(*) c FROM users'),
      n("SELECT COUNT(*) c FROM users WHERE role = 'admin'"),
    ]);
    totals = {
      leads: { total: leads, open: leadsOpen }, rfqs: { total: rfqs, open: rfqsOpen },
      clients: { total: clients, active: clientsActive }, policies: { total: policies, active: policiesActive },
      claims: { total: claims, open: claimsOpen }, tasks: { total: tasks, open: tasksOpen },
      meetings: { total: meetings, upcoming: meetingsUpcoming }, team: { total: team, admins },
    };
  }

  res.json({
    totals,
    policySummary: { currentYear: policyCurrentYear, pending: policyPending, issued: policyIssued, cancel: policyCancel },
    claimSummary: { total: claimTotal, pending: claimPending, settled: claimSettled, rejected: claimRejected },
    charts: { companyWise, typeWise, businessWise, departmentWise },
    scope: { all: sc.all, department: sc.department },
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

// ---- reports ----
// One endpoint for every report: the spec supplies the table, the date column,
// the dimension and the metrics, so a new report is a definition in
// reports.js rather than another route here.
app.get('/api/reports/:kind', auth, async (req, res) => {
  const spec = reportSpec(req.params.kind);
  if (!spec) return res.status(404).json({ error: 'Unknown report' });

  // groupBy is looked up by key, never interpolated from the request.
  const dimKey = spec.dims[req.query.groupBy] ? req.query.groupBy : spec.defaultDim;
  const dim = spec.dims[dimKey];
  const from = req.query.from || '1900-01-01';
  const to = req.query.to || '2999-12-31';

  const sc = await scope(req);
  const scoped = spec.scoped && !sc.all && !!sc.department;
  // Rows with no department predate the split, so they stay visible rather
  // than vanishing from a head's report — same rule the rest of the app uses.
  const scopeSql = scoped ? " AND (department = ? OR department IS NULL OR department = '')" : '';
  const scopeParams = scoped ? [sc.department] : [];

  const where = `WHERE ${dateFilter(spec.dateCol)}${scopeSql}`;
  const params = [from, to, ...scopeParams];
  const metricSql = spec.metrics.map((m) => `${m.sql} AS ${m.key}`).join(', ');

  try {
    const rows = await db.prepare(
      `SELECT COALESCE(${dim.sql}, 'Unspecified') AS label, ${metricSql}
       FROM ${spec.table} ${where}
       GROUP BY 1 ORDER BY ${spec.sortBy} DESC NULLS LAST, label`).all(...params);

    // Totals are queried, not summed from the rows: an average (Avg TAT) has
    // to be computed across the whole set, not averaged from group averages.
    const totals = await db.prepare(`SELECT ${metricSql} FROM ${spec.table} ${where}`).get(...params);

    // Rows the date filter can't place. Reporting the number keeps a partial
    // report from reading as a complete one.
    const undated = (await db.prepare(
      `SELECT COUNT(*) c FROM ${spec.table} WHERE NULLIF(${spec.dateCol}, '') IS NULL${scopeSql}`)
      .get(...scopeParams)).c;

    res.json({
      kind: req.params.kind, label: spec.label,
      groupBy: dimKey, groupLabel: dim.label,
      dims: Object.entries(spec.dims).map(([key, d]) => ({ key, label: d.label })),
      columns: spec.metrics.map((m) => ({ key: m.key, label: m.label, kind: m.kind })),
      dateLabel: spec.dateLabel, from, to,
      rows, totals, undated,
      scope: { applied: scoped, department: scoped ? sc.department : null },
    });
  } catch (e) {
    console.error('report failed:', e.message);
    res.status(500).json({ error: 'Could not build the report' });
  }
});

// Payment is a two-step the broker drives: send the insurer's link, then stamp
// it paid when the money lands. No gateway involved — a gateway webhook could
// later call the second one with the same effect.
app.post('/api/rfqs/:id/send-payment-link', auth, async (req, res) => {
  const r = await db.prepare('SELECT * FROM rfqs WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  // A lost RFQ raises nothing, and a payment link to a client who walked away is the clearest case.
  if (r.status === 'Lost') return res.status(400).json({ error: 'This RFQ is marked Lost — reopen it before sending a payment link' });
  const link = (req.body?.payment_link || r.payment_link || '').trim();
  if (!link) return res.status(400).json({ error: 'Add the payment link first' });
  if (!r.email) return res.status(400).json({ error: 'No client email on this RFQ' });
  const won = (JSON.parse(r.insurers || '[]') || []).find((i) => i.client_approved) || {};
  await db.prepare('UPDATE rfqs SET payment_link = ? WHERE id = ?').run(link, req.params.id);
  await sendAuto('payment-link', r.email, {
    client: r.client_name, company: won.insurer || '', product: r.product || r.category,
    payment_link: link, premium: inrText(won.premium),
    premium_bit: Number(won.premium) > 0 ? ` at ${inrText(won.premium)}` : '',
  }, { kind: 'rfq', id: Number(req.params.id) });
  await emitRow('rfq', 'updated', 'rfqs', req.params.id);
  res.json({ ok: true, sent: !!(await autoMailEnabled(db)) });
});

app.post('/api/rfqs/:id/mark-paid', auth, async (req, res) => {
  const r = await db.prepare('SELECT * FROM rfqs WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (r.status === 'Lost') return res.status(400).json({ error: 'This RFQ is marked Lost — reopen it before recording a payment' });
  const won = (JSON.parse(r.insurers || '[]') || []).find((i) => i.client_approved) || {};
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  await db.prepare('UPDATE rfqs SET paid_at = ? WHERE id = ?').run(stamp, req.params.id);
  if (r.email) {
    await sendAuto('payment-received', r.email, {
      client: r.client_name, company: won.insurer || '', product: r.product || r.category,
      premium: inrText(won.premium),
      premium_bit: Number(won.premium) > 0 ? ` of ${inrText(won.premium)}` : '',
    }, { kind: 'rfq', id: Number(req.params.id) });
  }
  await notify({ entity: 'rfq', kind: 'paid', icon: 'dollar', tone: 'success', refTable: 'rfqs', refId: Number(req.params.id),
    title: 'Payment received', body: `${r.rfq_no} — ${r.client_name}`, link: '/page/rfq' });
  await emitRow('rfq', 'updated', 'rfqs', req.params.id);
  res.json({ ok: true, paid_at: stamp });
});

// ---- renewal manager ----
app.get('/api/renewals', auth, async (req, res) => {
  const rows = await renewalRows(req.query.line || undefined, await scope(req));
  res.json({ rows, summary: renewalSummary(rows) });
});

// ---- clients ----
// Last Meeting Date is derived, never stored — a stored copy would drift the
// moment a meeting is rescheduled or deleted. Counts only meetings that have
// actually happened (dated today or earlier, not cancelled).
const LAST_MEETING_SQL = `(
  SELECT MAX(m.from_date) FROM meetings m
  JOIN meeting_participants mp ON mp.meeting_id = m.id
  WHERE mp.kind = 'client' AND mp.ref_id = c.id
    AND NULLIF(m.from_date,'') IS NOT NULL
    AND m.from_date <= to_char(now(), 'YYYY-MM-DD')
    AND COALESCE(m.status,'') <> 'Cancelled'
) AS last_meeting_date`;

app.get('/api/clients', auth, async (req, res) => {
  const { name, mobile, pan, groupHead, email, groupCode, category, status, familyType, owner } = req.query;
  let sql = `SELECT c.*, ${LAST_MEETING_SQL} FROM clients c WHERE 1=1`;
  const p = [];
  // ILIKE (not LIKE) to match SQLite's default case-insensitive LIKE.
  if (name) { sql += ' AND c.client_name ILIKE ?'; p.push('%' + name + '%'); }
  if (mobile) { sql += ' AND c.mobile ILIKE ?'; p.push('%' + mobile + '%'); }
  if (pan) { sql += ' AND c.pan_no ILIKE ?'; p.push('%' + pan + '%'); }
  if (groupHead) { sql += ' AND c.group_head_name ILIKE ?'; p.push('%' + groupHead + '%'); }
  if (email) { sql += ' AND c.email ILIKE ?'; p.push('%' + email + '%'); }
  if (groupCode) { sql += ' AND c.group_code ILIKE ?'; p.push('%' + groupCode + '%'); }
  if (category) { sql += ' AND c.client_category = ?'; p.push(category); }
  if (status) { sql += ' AND c.client_status = ?'; p.push(status); }
  if (familyType) { sql += ' AND c.family_type = ?'; p.push(familyType); }
  if (owner) { sql += ' AND c.owner = ?'; p.push(owner); }
  sql += ' ORDER BY c.id DESC';
  res.json(await db.prepare(sql).all(...p));
});

app.get('/api/clients/:id', auth, async (req, res) => {
  const c = await db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json(c);
});

// Everything that points at this client, in one round trip. A client is the
// target of five separate lookups, and five sequential fetches from the
// detail page would be five waterfalls for one screen.
app.get('/api/clients/:id/related', auth, async (req, res) => {
  const c = await db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const id = Number(req.params.id);
  const [
    referredLeads, referredClients, meetingRows, tasks, policies, claims,
    notes, attachments, emails, familyHead, familyMembers,
  ] = await Promise.all([
    db.prepare('SELECT * FROM leads WHERE referral_client_id = ? ORDER BY id DESC').all(id),
    db.prepare('SELECT * FROM clients WHERE referred_by_client_id = ? ORDER BY id DESC').all(id),
    db.prepare(`SELECT * FROM meetings
                WHERE id IN (SELECT meeting_id FROM meeting_participants WHERE kind = 'client' AND ref_id = ?)
                ORDER BY from_date DESC NULLS LAST, from_time DESC, id DESC`).all(id),
    db.prepare("SELECT * FROM tasks WHERE related_kind = 'client' AND related_id = ? ORDER BY (NULLIF(due_date,'') IS NULL), due_date, id DESC").all(id),
    // Policies link by id where set, but older/imported rows only carry the
    // insured name, so match either.
    db.prepare('SELECT * FROM policies WHERE client_id = ? OR insured_name = ? ORDER BY id DESC').all(id, c.client_name),
    db.prepare('SELECT * FROM claims WHERE client_name = ? OR client_id = ? ORDER BY id DESC').all(c.client_name, id),
    db.prepare("SELECT * FROM record_notes WHERE parent_kind = 'client' AND parent_id = ? ORDER BY id DESC").all(id),
    // The base64 payload is deliberately excluded from the list — it's only
    // fetched when a file is actually opened.
    db.prepare("SELECT id, parent_kind, parent_id, file_name, file_type, file_size, owner, created_at FROM record_attachments WHERE parent_kind = 'client' AND parent_id = ? ORDER BY id DESC").all(id),
    // Matched by linkage first, falling back to the address so mail sent
    // before the client record existed still shows up.
    c.email
      ? db.prepare("SELECT * FROM email_log WHERE (parent_kind = 'client' AND parent_id = ?) OR to_addr ILIKE ? ORDER BY id DESC LIMIT 100").all(id, '%' + c.email + '%')
      : db.prepare("SELECT * FROM email_log WHERE parent_kind = 'client' AND parent_id = ? ORDER BY id DESC LIMIT 100").all(id),
    c.family_head_id ? db.prepare('SELECT * FROM clients WHERE id = ?').get(c.family_head_id) : null,
    db.prepare('SELECT * FROM clients WHERE family_head_id = ? ORDER BY client_name').all(id),
  ]);

  // The tree is rooted at this client's head if they have one, otherwise at
  // this client — so a member sees the whole family, not just themselves.
  const rootId = c.family_head_id || id;
  const family = {
    head: c.family_head_id ? familyHead : (c.family_type === 'Family Head' ? c : null),
    members: c.family_head_id
      ? await db.prepare('SELECT * FROM clients WHERE family_head_id = ? ORDER BY client_name').all(rootId)
      : familyMembers,
  };

  res.json({
    leads: referredLeads,
    referrals: [
      ...referredLeads.map((l) => ({ kind: 'lead', id: l.id, name: l.lead_name, status: l.status, extra: l.expected_business_type, date: l.lead_date })),
      ...referredClients.map((x) => ({ kind: 'client', id: x.id, name: x.client_name, status: x.client_status, extra: x.client_category ? 'Category ' + x.client_category : '', date: x.onboarding_date })),
    ],
    meetings: await withRelations(meetingRows),
    tasks, policies, claims, notes, attachments, emails, family,
  });
});

// ---- generic notes / attachments (parent_kind + parent_id) ----
const PARENT_KINDS = ['client', 'lead', 'policy', 'claim'];

app.post('/api/:kind/:id/notes', auth, async (req, res) => {
  if (!PARENT_KINDS.includes(req.params.kind)) return res.status(400).json({ error: 'Unsupported record type' });
  const body = (req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Note text is required' });
  const info = await db.prepare('INSERT INTO record_notes (parent_kind, parent_id, body, owner) VALUES (?,?,?,?)')
    .run(req.params.kind, req.params.id, body, req.user.name || '');
  const row = await db.prepare('SELECT * FROM record_notes WHERE id = ?').get(info.lastInsertRowid);
  emit('record-note', 'created', row);
  res.json(row);
});

app.delete('/api/notes/:id', auth, async (req, res) => {
  const cur = await db.prepare('SELECT * FROM record_notes WHERE id = ?').get(req.params.id);
  await db.prepare('DELETE FROM record_notes WHERE id = ?').run(req.params.id);
  emit('record-note', 'deleted', { id: Number(req.params.id), parent_kind: cur?.parent_kind, parent_id: cur?.parent_id });
  res.json({ ok: true });
});

app.post('/api/:kind/:id/attachments', auth, async (req, res) => {
  if (!PARENT_KINDS.includes(req.params.kind)) return res.status(400).json({ error: 'Unsupported record type' });
  const { file_name, file_type, data } = req.body || {};
  if (!data || !file_name) return res.status(400).json({ error: 'A file is required' });
  // Rough decode of the base64 payload to a byte count, so the stored size
  // reflects the file rather than the encoded string.
  const size = Math.round((String(data).split(',').pop() || '').length * 0.75);
  if (size > 8 * 1024 * 1024) return res.status(400).json({ error: 'File must be under 8 MB' });
  const info = await db.prepare('INSERT INTO record_attachments (parent_kind, parent_id, file_name, file_type, file_size, data, owner) VALUES (?,?,?,?,?,?,?)')
    .run(req.params.kind, req.params.id, file_name, file_type || '', size, data, req.user.name || '');
  const row = await db.prepare('SELECT id, parent_kind, parent_id, file_name, file_type, file_size, owner, created_at FROM record_attachments WHERE id = ?').get(info.lastInsertRowid);
  emit('record-attachment', 'created', row);
  res.json(row);
});

// Payload is served separately so listing attachments stays cheap.
app.get('/api/attachments/:id', auth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM record_attachments WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

app.delete('/api/attachments/:id', auth, async (req, res) => {
  const cur = await db.prepare('SELECT parent_kind, parent_id FROM record_attachments WHERE id = ?').get(req.params.id);
  await db.prepare('DELETE FROM record_attachments WHERE id = ?').run(req.params.id);
  emit('record-attachment', 'deleted', { id: Number(req.params.id), parent_kind: cur?.parent_kind, parent_id: cur?.parent_id });
  res.json({ ok: true });
});

// ---- convert a lead into a client ----
// Carries the origin across (lead source, referrer) so the client record
// remembers where it came from, and links both ways.
app.post('/api/leads/:id/convert-to-client', auth, async (req, res) => {
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  const existing = await db.prepare('SELECT id FROM clients WHERE lead_id = ?').get(lead.id);
  if (existing) return res.status(409).json({ error: 'This lead has already been converted', clientId: existing.id });

  const p = clientPayload({
    client_name: lead.lead_name,
    mobile: lead.mobile,
    email: lead.email,
    occupation: '',
    owner: lead.lead_owner || req.user.name,
    client_status: 'Active',
    client_category: req.body?.client_category || '',
    onboarding_date: req.body?.onboarding_date || new Date().toISOString().slice(0, 10),
    lead_source: lead.source || '',
    lead_id: lead.id,
    referred_by_client_id: lead.referral_client_id || null,
    referred_by_client_name: lead.referral_client_name || '',
    family_type: 'Individual',
  }, req.user.name);
  const err = await validateClient(p, null);
  if (err) return res.status(400).json({ error: err });

  const info = await db.prepare(`INSERT INTO clients (${CLIENT_COLS.join(',')}) VALUES (${CLIENT_COLS.map(() => '?').join(',')})`)
    .run(...CLIENT_COLS.map((c) => p[c]));
  await db.prepare("UPDATE leads SET status = 'Converted' WHERE id = ?").run(lead.id);
  const client = await emitRow('client', 'created', 'clients', info.lastInsertRowid);
  await emitRow('lead', 'updated', 'leads', lead.id);
  await notify({ entity: 'client', kind: 'converted', icon: 'user', tone: 'success', refTable: 'clients', refId: info.lastInsertRowid,
    title: 'Lead converted to client', body: `${p.client_name}${p.lead_source ? ' · from ' + p.lead_source : ''}`, link: '/page/client-master' });
  await sendAuto('lead-converted', p.email, { client: p.client_name }, { kind: 'client', id: info.lastInsertRowid });
  res.json({ ok: true, client });
});

const CLIENT_COLS = [
  'client_name', 'mobile', 'email', 'client_category', 'owner', 'client_status',
  'lead_source', 'lead_id', 'referred_by_client_id', 'referred_by_client_name',
  'onboarding_date', 'family_type', 'family_head_id', 'family_head_name',
  'aadhar_no', 'pan_no', 'gstin', 'dob', 'occupation', 'review_frequency', 'nominees',
  'address', 'city', 'state', 'pincode', 'country',
  'group_head_name', 'group_code', 'anniversary',
  'salutation', 'can_iin_no', 'finnsys_id', 'added_by', 'risk_profile',
  'company_name', 'social_lead_id', 'exchange_rate', 'send_goal_sheet', 'tin_number',
  'currency', 'file_email', 'client_code', 'tin_updated', 'client_record_id',
  'guardian_name', 'nominee_minor_guardian', 'other_city', 'other_state', 'other_zip',
  'other_country', 'courier_ok', 'sip', 'lumpsum', 'life_insurance',
  'super_top_up', 'personal_accident', 'health_insurance', 'ulip', 'travel_insurance',
  'siso', 'corporate_insurance', 'vehicle_insurance', 'pms', 'critical_illness',
  'goal_gps', 'demat_account', 'fhp_qualified', 'iifl_account', 'model_portfolio',
  'description',
];
const FAMILY_TYPES = ['Individual', 'Family Head', 'Family Member'];

// Walks up the family chain from `headId`; if it reaches `selfId` the link
// would create a loop (A's head is B, B's head is A), which would make the
// family tree infinite. Depth-capped as a belt-and-braces guard.
async function wouldCycle(selfId, headId) {
  let cur = headId, depth = 0;
  while (cur && depth < 25) {
    if (Number(cur) === Number(selfId)) return true;
    const row = await db.prepare('SELECT family_head_id FROM clients WHERE id = ?').get(cur);
    cur = row?.family_head_id || null;
    depth++;
  }
  return false;
}

function clientPayload(f, user) {
  const famType = FAMILY_TYPES.includes(f.family_type) ? f.family_type : 'Individual';
  // An Individual has no family head, so the link is cleared rather than
  // left dangling when the type changes.
  const inFamily = famType !== 'Individual';
  let nominees = f.nominees;
  if (Array.isArray(nominees)) nominees = JSON.stringify(nominees);
  else if (typeof nominees !== 'string') nominees = '[]';
  return {
    client_name: (f.client_name || '').trim(),
    mobile: f.mobile || '',
    email: f.email || '',
    client_category: f.client_category || '',
    owner: f.owner || user || 'Admin User',
    client_status: f.client_status || 'Active',
    gstin: (f.gstin || '').trim().toUpperCase(),
    salutation: f.salutation || '',
    can_iin_no: f.can_iin_no || '',
    finnsys_id: f.finnsys_id || '',
    added_by: f.added_by || '',
    risk_profile: f.risk_profile || '',
    company_name: f.company_name || '',
    social_lead_id: f.social_lead_id || '',
    exchange_rate: (f.exchange_rate === '' || f.exchange_rate == null ? '1' : String(f.exchange_rate)),
    send_goal_sheet: f.send_goal_sheet || '',
    tin_number: f.tin_number || '',
    currency: (f.currency || 'INR'),
    file_email: f.file_email || '',
    client_code: f.client_code || '',
    tin_updated: f.tin_updated || '',
    client_record_id: f.client_record_id || '',
    guardian_name: f.guardian_name || '',
    nominee_minor_guardian: f.nominee_minor_guardian || '',
    other_city: f.other_city || '',
    other_state: f.other_state || '',
    other_zip: f.other_zip || '',
    other_country: f.other_country || '',
    courier_ok: f.courier_ok || '',
    sip: f.sip || '',
    lumpsum: f.lumpsum || '',
    life_insurance: f.life_insurance || '',
    super_top_up: f.super_top_up || '',
    personal_accident: f.personal_accident || '',
    health_insurance: f.health_insurance || '',
    ulip: f.ulip || '',
    travel_insurance: f.travel_insurance || '',
    siso: f.siso || '',
    corporate_insurance: f.corporate_insurance || '',
    vehicle_insurance: f.vehicle_insurance || '',
    pms: f.pms || '',
    critical_illness: f.critical_illness || '',
    goal_gps: f.goal_gps || '',
    demat_account: f.demat_account || '',
    fhp_qualified: f.fhp_qualified || '',
    iifl_account: f.iifl_account || '',
    model_portfolio: f.model_portfolio || '',
    description: f.description || '',
    lead_source: f.lead_source || '',
    lead_id: f.lead_id || null,
    referred_by_client_id: f.referred_by_client_id || null,
    referred_by_client_name: f.referred_by_client_id ? (f.referred_by_client_name || '') : '',
    onboarding_date: f.onboarding_date || '',
    family_type: famType,
    family_head_id: inFamily ? (f.family_head_id || null) : null,
    family_head_name: inFamily && f.family_head_id ? (f.family_head_name || '') : '',
    aadhar_no: f.aadhar_no || '',
    pan_no: f.pan_no || '',
    dob: f.dob || '',
    occupation: f.occupation || '',
    review_frequency: f.review_frequency || '',
    nominees,
    address: f.address || '',
    city: f.city || '',
    state: f.state || '',
    pincode: f.pincode || '',
    country: f.country || '',
    group_head_name: f.group_head_name || '',
    group_code: f.group_code || '',
    anniversary: f.anniversary || '',
  };
}

// Shared validation for both create and update.
async function validateClient(p, selfId) {
  if (!p.client_name) return 'Client name is required';
  if (p.family_type === 'Family Member' && !p.family_head_id) return 'Select the family head for a family member';
  if (p.family_head_id && selfId && Number(p.family_head_id) === Number(selfId)) return 'A client cannot be their own family head';
  if (p.referred_by_client_id && selfId && Number(p.referred_by_client_id) === Number(selfId)) return 'A client cannot refer themselves';
  if (p.family_head_id && selfId && await wouldCycle(selfId, p.family_head_id)) return 'That would create a loop in the family tree';
  return null;
}

app.post('/api/clients', auth, async (req, res) => {
  const p = clientPayload(req.body || {}, req.user.name);
  const err = await validateClient(p, null);
  if (err) return res.status(400).json({ error: err });
  const info = await db.prepare(`INSERT INTO clients (${CLIENT_COLS.join(',')}) VALUES (${CLIENT_COLS.map(() => '?').join(',')})`)
    .run(...CLIENT_COLS.map((c) => p[c]));
  const row = await emitRow('client', 'created', 'clients', info.lastInsertRowid);
  await notify({ entity: 'client', kind: 'created', icon: 'user', tone: 'success', refTable: 'clients', refId: info.lastInsertRowid,
    title: 'New client added', body: p.client_name, link: '/page/client-master' });
  res.json(row);
});

app.put('/api/clients/:id', auth, async (req, res) => {
  const cur = await db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  const p = clientPayload({ ...cur, ...req.body }, cur.owner);
  const err = await validateClient(p, req.params.id);
  if (err) return res.status(400).json({ error: err });
  await db.prepare(`UPDATE clients SET ${CLIENT_COLS.map((c) => `${c}=?`).join(', ')} WHERE id=?`)
    .run(...CLIENT_COLS.map((c) => p[c]), req.params.id);
  const row = await emitRow('client', 'updated', 'clients', req.params.id);
  res.json(row);
});

// Bulk client import. Like the claim import, it deliberately does not enforce
// what single creation does: a sheet from another system is rarely complete,
// and the instruction was that nothing be compulsory. A row that maps to
// nothing is still refused, since that would write an empty client.
//
// Rows are independent, so one bad row is reported by its sheet position and
// the rest still import.
app.post('/api/clients/import', auth, async (req, res) => {
  const list = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!list.length) return res.status(400).json({ error: 'No rows to import' });
  if (list.length > 5000) return res.status(400).json({ error: 'Too many rows in a single request (5000 max). The import screen sends large files in batches automatically, so this only appears for a hand-built request.' });

  const failed = [];
  const ids = [];
  for (const [i, raw] of list.entries()) {
    try {
      if (!raw || typeof raw !== 'object' || !Object.keys(raw).length) { failed.push({ row: i + 2, error: 'Empty row' }); continue; }
      const p = clientPayload(raw, req.user.name);
      // clientPayload clears the family link for an Individual, which is right
      // for the form but would drop a value the sheet actually carries.
      for (const c of CLIENT_COLS) if (raw[c] !== undefined && raw[c] !== '' && (p[c] === '' || p[c] === null)) p[c] = raw[c];
      const info = await db.prepare(`INSERT INTO clients (${CLIENT_COLS.join(',')}) VALUES (${CLIENT_COLS.map(() => '?').join(',')})`)
        .run(...CLIENT_COLS.map((c) => p[c]));
      ids.push(info.lastInsertRowid);
    } catch (e) {
      failed.push({ row: i + 2, error: e.message });
    }
  }
  // The importer sends large files in batches, so one notification per batch
  // would post a hundred and more "imported" alerts for a single file. The
  // client marks the final batch and says how many went in before it, and the
  // alert is raised once, with the true total.
  if (ids.length) emit('client', 'imported', { count: ids.length });
  const total = (Number(req.body?.previously_inserted) || 0) + ids.length;
  if (total && (req.body?.last === true || req.body?.last === undefined)) {
    await notify({ entity: 'client', kind: 'imported', icon: 'upload', tone: 'info', refTable: 'clients', refId: ids[0] || null,
      title: `${total.toLocaleString('en-IN')} client${total > 1 ? 's' : ''} imported`, body: 'from a spreadsheet', link: '/page/client-master' });
  }
  res.json({ inserted: ids.length, failed });
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
  sql = await applyScope(req, sql, p);
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
  const denied = await denyRecordAccess(req, 'policies', req.params.id);
  if (denied) return res.status(403).json({ error: denied });
  const row = await db.prepare('SELECT * FROM policies WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

// Columns the Policy form owns. Everything else on the table (agency_name,
// ba_name, addon_name, payment_ref, …) predates the module and is left alone.
const POLICY_COLS = [
  'product_name', 'insured_name', 'client_id', 'client_email', 'insurance_line', 'insurance_type',
  'policy_type', 'company_name', 'policy_number', 'login_date', 'associate', 'assigned_to',
  'currency', 'exchange_rate', 'policy_mode', 'term_years', 'ppt_years',
  'sum_assured', 'net_premium', 'gst_amount', 'final_premium', 'total_amount', 'cumulative_bonus',
  'period_from', 'period_to', 'commencement_date', 'maturity_date',
  'nominee_name', 'nominee_age', 'nominee_relation',
  'reg_no', 'ncb_pct', 'members_covered', 'room_rent', 'ped_waiting',
  'payment_type', 'policy_with_us', 'lost_reason', 'policy_status', 'active_status',
  'policy_doc', 'policy_doc_name', 'renewable', 'remarks', 'department',
];
const POLICY_NUMS = ['sum_assured', 'net_premium', 'gst_amount', 'final_premium', 'total_amount', 'cumulative_bonus', 'exchange_rate'];

// The form hides fields that don't apply to the chosen Type/product, so the
// server clears them too — otherwise switching a policy from Life to General
// would leave an invisible nominee or maturity date behind on the record.
// What a stored document is, from its own data URI, falling back to the name it
// was uploaded under. The extension is taken from the content, not trusted from
// the original name, which can be anything.
const DOC_EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
function docExtension(uri, originalName = '') {
  const m = /^data:([^;,]+)/.exec(uri || '');
  if (m && DOC_EXT[m[1].toLowerCase()]) return DOC_EXT[m[1].toLowerCase()];
  const e = /\.([a-z0-9]{2,5})$/i.exec(originalName || '');
  return e ? e[1].toLowerCase() : 'pdf';
}

// A policy document is named for the policy it belongs to — insured, policy
// number, product — instead of whatever the scan happened to be called. The
// name is set when the policy is saved so it is the same everywhere the
// document is later opened, downloaded or emailed.
function policyDocName(pol) {
  // Characters a filesystem refuses, dropped. Backslash goes through its char
  // code so no layer of tooling can eat it.
  const clean = (v) => String(v || '').replace(/[/:*?"<>|]+/g, '').split(String.fromCharCode(92)).join('').replace(/\s+/g, ' ').trim();
  const parts = [clean(pol.insured_name), clean(pol.policy_number), clean(pol.product_name || pol.insurance_type)].filter(Boolean);
  const base = parts.length ? parts.join(' - ') : 'Policy';
  return `${base}.${docExtension(pol.policy_doc, pol.policy_doc_name)}`;
}

function policyPayload(f, user) {
  const isLI = f.insurance_line === 'LI';
  const cat = f.insurance_type || '';
  const isMotor = !isLI && cat === 'Motor';
  const isHealth = !isLI && ['Health', 'Group Health', 'Retail Health'].includes(cat);
  const lost = f.policy_with_us === 'No';
  const num = (v) => (v === '' || v == null ? 0 : Number(v) || 0);
  const keepIf = (cond, v) => (cond ? (v ?? '') : '');

  const out = {
    product_name: (f.product_name || '').trim(),
    insured_name: f.insured_name || '',
    client_id: f.client_id || null,
    client_email: f.client_email || '',
    insurance_line: isLI ? 'LI' : 'GI',
    insurance_type: cat,
    policy_type: f.policy_type || '',
    company_name: f.company_name || '',
    policy_number: f.policy_number || '',
    login_date: f.login_date || '',
    associate: f.associate || '',
    assigned_to: f.assigned_to || user || '',
    currency: f.currency || 'INR',
    // INR is the base currency, so its rate is fixed rather than user input.
    exchange_rate: (f.currency || 'INR') === 'INR' ? 1 : (num(f.exchange_rate) || 1),
    policy_mode: keepIf(isLI, f.policy_mode),
    term_years: keepIf(isLI, f.term_years),
    ppt_years: keepIf(isLI, f.ppt_years),
    sum_assured: num(f.sum_assured),
    net_premium: num(f.net_premium),
    gst_amount: num(f.gst_amount),
    final_premium: num(f.final_premium),
    total_amount: num(f.final_premium),
    cumulative_bonus: isLI ? num(f.cumulative_bonus) : 0,
    period_from: f.period_from || '',
    period_to: f.period_to || '',
    commencement_date: keepIf(isLI, f.commencement_date),
    maturity_date: keepIf(isLI, f.maturity_date),
    nominee_name: keepIf(isLI, f.nominee_name),
    nominee_age: keepIf(isLI, f.nominee_age),
    nominee_relation: keepIf(isLI, f.nominee_relation),
    reg_no: keepIf(isMotor, f.reg_no),
    ncb_pct: keepIf(isMotor, f.ncb_pct),
    members_covered: keepIf(isHealth, f.members_covered),
    room_rent: keepIf(isHealth, f.room_rent),
    ped_waiting: keepIf(isHealth, f.ped_waiting),
    payment_type: f.payment_type || '',
    policy_with_us: f.policy_with_us || '',
    lost_reason: keepIf(lost, f.lost_reason),
    policy_status: f.policy_status || 'Draft',
    active_status: f.active_status || 'Active',
    // Derived from the product, never typed in.
    department: departmentForProduct(cat),
    policy_doc: f.policy_doc || '',
    policy_doc_name: f.policy_doc_name || '',
    renewable: f.renewable || 'Yes',
    remarks: f.remarks || '',
  };
  for (const k of POLICY_NUMS) out[k] = num(out[k]);
  // Named for the policy, not for the upload. Done last because the name is
  // built from fields that were only just resolved above.
  out.policy_doc_name = out.policy_doc ? policyDocName(out) : '';
  return out;
}

app.post('/api/policies', auth, async (req, res) => {
  const f = req.body || {};
  if (!f.product_name?.trim()) return res.status(400).json({ error: 'Product is required' });
  if (!f.policy_with_us) return res.status(400).json({ error: 'Policy with Us is required' });
  const p = policyPayload(f, req.user.name);
  const deptErr = await denyCrossDepartment(req, p.department);
  if (deptErr) return res.status(403).json({ error: deptErr });
  const info = await db.prepare(`INSERT INTO policies (${POLICY_COLS.join(',')}) VALUES (${POLICY_COLS.map(() => '?').join(',')})`)
    .run(...POLICY_COLS.map((c) => p[c]));
  const row = await emitRow('policy', 'created', 'policies', info.lastInsertRowid);
  await notify({ entity: 'policy', kind: 'created', icon: 'file', tone: 'info', refTable: 'policies', refId: info.lastInsertRowid,
    title: 'New policy added', body: `${p.insured_name || 'A client'} · ${p.product_name}`, link: '/page/policy' });
  // Policy paperwork goes to the client's own address where we have one on the
  // client record, falling back to whatever was typed on the policy.
  const holder = p.client_id ? await db.prepare('SELECT email FROM clients WHERE id = ?').get(p.client_id) : null;
  const to = holder?.email || p.client_email || '';
  const policyVars = {
    client: p.insured_name || 'Customer', policy_no: p.policy_number, company: p.company_name,
    product: p.product_name || p.insurance_type, premium: inrText(p.final_premium),
    sum_assured: inrText(p.sum_assured), expiry: p.period_to || '',
    period: [p.period_from, p.period_to].filter(Boolean).join(' to '),
    coverages: [p.product_name, p.addon_name].filter(Boolean).join(' · ') || 'as per policy schedule',
  };
  const parent = { kind: 'client', id: p.client_id || null };
  // Three separate templates rather than one long mail, so each can be
  // reworded or emptied without touching the others.
  // The policy itself travels with the mail that announces it, named for the
  // policy. The coverage and claim-guide mails are explanations and don't need it.
  const policyFiles = p.policy_doc ? [{ filename: p.policy_doc_name, uri: p.policy_doc }] : [];
  await sendAuto('policy-issued', to, policyVars, parent, policyFiles);
  await sendAuto('policy-coverages', to, policyVars, parent);
  await sendAuto('claim-guide', to, policyVars, parent);
  res.json(row);
});

// ---- claims / leads (list) ----
app.get('/api/claims', auth, async (req, res) => {
  let sql = 'SELECT * FROM claims WHERE 1=1';
  const p = [];
  sql = await applyScope(req, sql, p);
  res.json(await db.prepare(sql + ' ORDER BY id DESC').all(...p));
});
app.get('/api/leads', auth, async (req, res) => {
  let sql = 'SELECT * FROM leads WHERE 1=1';
  const p = [];
  sql = await applyScope(req, sql, p);
  res.json(await db.prepare(sql + ' ORDER BY id DESC').all(...p));
});

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
app.get('/api/rfqs', auth, async (req, res) => {
  let sql = 'SELECT * FROM rfqs WHERE 1=1';
  const p = [];
  sql = await applyScope(req, sql, p);
  res.json(await db.prepare(sql + ' ORDER BY id DESC').all(...p));
});
const asJson = (v, fb) => (v === undefined ? fb : (typeof v === 'string' ? v : JSON.stringify(v)));
// Raising an RFQ for someone the CRM doesn't know is, in substance, a new
// enquiry — so it is recorded as a lead too. Best-effort: a failure here must
// not cost the user the RFQ they just saved.
async function leadFromRfq(req, f) {
  try {
    const name = (f.client_name || '').trim();
    if (!name) return;
    const digits10 = (v) => String(v || '').replace(/\D/g, '').slice(-10);
    const mob = digits10(f.mobile);

    // An existing client is not a reason to skip. A renewal or rollover is
    // almost always for someone already on the books, so skipping clients is
    // exactly what kept renewals from ever becoming leads. They still get one,
    // marked as coming from an existing client rather than as a new enquiry.
    const client = await db.prepare(`SELECT id FROM clients
      WHERE client_name ILIKE ? OR (? <> '' AND regexp_replace(COALESCE(mobile,''), '\\D', '', 'g') LIKE ?)
      LIMIT 1`).get(name, mob, '%' + mob);
    const renewal = ['Renewal', 'Rollover'].includes(f.policy_nature);

    // What is skipped is a duplicate: an open lead for the same person and the
    // same line of business already covers this RFQ. Matching on the business
    // type as well means a motor lead does not swallow a later health RFQ.
    const lead = await db.prepare(`SELECT id FROM leads
      WHERE (lead_name ILIKE ? OR (? <> '' AND regexp_replace(COALESCE(mobile,''), '\\D', '', 'g') LIKE ?))
        AND COALESCE(expected_business_type,'') = ?
        AND COALESCE(status,'') NOT IN ('Converted','Lost','Junk')
      LIMIT 1`).get(name, mob, '%' + mob, f.category || '');
    if (lead) return;

    const p = leadPayload({
      lead_name: name, mobile: f.mobile || '', email: f.email || '',
      expected_business_type: f.category || '', company_name: f.details?.business || '',
      source: client ? 'Existing Client' : 'Phone Enquiry', status: 'New',
      remarks: renewal
        ? `${f.policy_nature} lead, created automatically from ${f.rfq_no}.`
        : `Created automatically from ${f.rfq_no}.`,
    }, req.user.name);
    const ins = await db.prepare(`INSERT INTO leads (${LEAD_COLS.join(',')}) VALUES (${LEAD_COLS.map(() => '?').join(',')})`)
      .run(...LEAD_COLS.map((c) => p[c]));
    await db.prepare('UPDATE rfqs SET lead_id = ? WHERE id = ?').run(ins.lastInsertRowid, f.id);
    await emitRow('lead', 'created', 'leads', ins.lastInsertRowid);
    await notify({ entity: 'lead', kind: 'created', icon: 'userplus', tone: 'info',
      refTable: 'leads', refId: ins.lastInsertRowid,
      title: 'Lead created from RFQ', body: `${name} · ${f.rfq_no}`, link: '/page/lead' });
  } catch (e) {
    console.error('leadFromRfq failed:', e.message);
  }
}

app.post('/api/rfqs', auth, async (req, res) => {
  const f = req.body;
  if (!f.client_name) return res.status(400).json({ error: 'Client name is required' });
  if (f.status === 'Lost' && !String(f.not_approved_reason || '').trim()) {
    return res.status(400).json({ error: 'Give the reason this RFQ was lost' });
  }
  const info = await db.prepare(`INSERT INTO rfqs (rfq_no, client_name, mobile, email, insurance_line, category, product, policy_nature, policy_type, sum_assured, requested_idv, add_ons, details, requirement, expected_premium, insurers, status, priority, due_date, assigned_to, remarks, quote_send_date)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('', f.client_name, f.mobile || '', f.email || '', f.insurance_line || 'GI',
      f.category || 'Motor', f.product || '', f.policy_nature || 'New', f.policy_type || '', Number(f.sum_assured) || 0,
      Number(f.requested_idv) || 0, asJson(f.add_ons, '[]'), asJson(f.details, '{}'), f.requirement || '', Number(f.expected_premium) || 0,
      asJson(f.insurers, '[]'), f.status || 'Draft', f.priority || 'Medium', f.due_date || '', req.user.name || 'Admin User', f.remarks || '', f.quote_send_date || '');
  await db.prepare('UPDATE rfqs SET department = ? WHERE id = ?')
    .run(departmentForProduct(f.category || ''), info.lastInsertRowid);
  const rfqNo = 'RFQ-' + (2000 + info.lastInsertRowid);
  await db.prepare('UPDATE rfqs SET rfq_no = ? WHERE id = ?').run(rfqNo, info.lastInsertRowid);
  if (f.not_approved_reason) await db.prepare('UPDATE rfqs SET not_approved_reason = ? WHERE id = ?').run(f.not_approved_reason, info.lastInsertRowid);
  await emitRow('rfq', 'created', 'rfqs', info.lastInsertRowid);
  // A lost RFQ raises nothing: no alert, no acknowledgement to the client, and
  // no lead to chase. Creating one already lost is unusual, but the rule is
  // about the state, not how it was reached.
  if (f.status !== 'Lost') {
    await notify({ entity: 'rfq', kind: 'created', icon: 'file', tone: 'info', refTable: 'rfqs', refId: info.lastInsertRowid,
      title: 'New RFQ created', body: `${rfqNo} — ${f.client_name}`, link: '/page/rfq' });
    await sendAuto('rfq-created', f.email, { client: f.client_name, rfq_no: rfqNo, product: f.product || f.category || 'insurance' },
      { kind: 'rfq', id: info.lastInsertRowid });
    await leadFromRfq(req, { ...f, id: info.lastInsertRowid, rfq_no: rfqNo });
  }
  res.json({ id: info.lastInsertRowid, rfq_no: rfqNo });
});
app.put('/api/rfqs/:id', auth, async (req, res) => {
  const denied = await denyRecordAccess(req, 'rfqs', req.params.id);
  if (denied) return res.status(403).json({ error: denied });
  const cur = await db.prepare('SELECT * FROM rfqs WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  const f = req.body;

  // Marking an RFQ lost has to say why, or "lost" tells nobody anything later.
  // Only checked when the request actually sets Lost, so an unrelated partial
  // update to an RFQ that was lost before this rule existed is not refused.
  const nextStatus = f.status ?? cur.status;
  const nextReason = String(f.not_approved_reason ?? cur.not_approved_reason ?? '').trim();
  if (f.status === 'Lost' && !nextReason) {
    return res.status(400).json({ error: 'Give the reason this RFQ was lost' });
  }
  const isLost = nextStatus === 'Lost';

  // Moving the send date re-arms the reminder; otherwise a rescheduled quote
  // would stay silent because the first reminder had already fired.
  const sendDate = f.quote_send_date ?? cur.quote_send_date;
  const reArm = (sendDate || '') !== (cur.quote_send_date || '') ? 0 : (cur.quote_reminder_sent || 0);
  await db.prepare(`UPDATE rfqs SET client_name=?, mobile=?, email=?, insurance_line=?, category=?, product=?, policy_nature=?, policy_type=?, sum_assured=?, requested_idv=?, add_ons=?, details=?, requirement=?, expected_premium=?, insurers=?, status=?, priority=?, due_date=?, remarks=?, quote_send_date=?, quote_sent_at=?, quote_reminder_sent=?, payment_link=?, not_approved_reason=? WHERE id=?`)
    .run(f.client_name ?? cur.client_name, f.mobile ?? cur.mobile, f.email ?? cur.email, f.insurance_line ?? cur.insurance_line,
      f.category ?? cur.category, f.product ?? cur.product, f.policy_nature ?? cur.policy_nature, f.policy_type ?? cur.policy_type,
      f.sum_assured !== undefined ? Number(f.sum_assured) : cur.sum_assured, f.requested_idv !== undefined ? Number(f.requested_idv) : cur.requested_idv,
      asJson(f.add_ons, cur.add_ons), asJson(f.details, cur.details), f.requirement ?? cur.requirement,
      f.expected_premium !== undefined ? Number(f.expected_premium) : cur.expected_premium, asJson(f.insurers, cur.insurers),
      f.status ?? cur.status, f.priority ?? cur.priority, f.due_date ?? cur.due_date, f.remarks ?? cur.remarks,
      sendDate || '', f.quote_sent_at ?? cur.quote_sent_at, reArm, f.payment_link ?? cur.payment_link, f.not_approved_reason ?? cur.not_approved_reason, req.params.id);

  // The client confirming a quote is a state change worth mailing about, so
  // it's detected here rather than trusted to a separate call the UI might not
  // make. Only a newly-approved insurer fires it — re-saving an RFQ whose
  // approval already stood would otherwise mail the client again every time.
  try {
    const before = (JSON.parse(cur.insurers || '[]') || []).find((i) => i.client_approved);
    const after = (Array.isArray(f.insurers) ? f.insurers : JSON.parse(f.insurers || '[]') || []).find((i) => i.client_approved);
    if (after && after.insurer !== before?.insurer && !isLost) {
      const vars = {
        client: f.client_name ?? cur.client_name,
        company: after.insurer,
        product: f.product ?? cur.product ?? cur.category,
        premium: inrText(after.premium),
        sum_assured: inrText(after.idv || cur.sum_assured),
        rfq_no: cur.rfq_no,
        approved_by: after.approved_by || '',
        approved_at: after.approved_at || '',
      };
      await sendAuto('quote-approved', f.email ?? cur.email, vars, { kind: 'rfq', id: Number(req.params.id) });
      // The office copy goes to the configured from-address: users have no
      // email of their own on the record, and that address is the one the
      // business already sends and receives on.
      const office = await anySmtp(db);
      const officeTo = office?.smtp_from_email || office?.smtp_user || '';
      if (officeTo) await sendAuto('quote-approved-internal', officeTo, vars, { kind: 'rfq', id: Number(req.params.id) });
    }
  } catch { /* a malformed insurers blob shouldn't fail the save */ }
  await emitRow('rfq', 'updated', 'rfqs', req.params.id);
  // "Quotes Received" is set by the client once every quoted insurer has
  // responded (see Rfq.jsx) — a real state transition worth surfacing,
  // not just any field edit, so this only fires on that specific change.
  if (f.status && f.status !== cur.status && f.status === 'Quotes Received' && !isLost) {
    await notify({ entity: 'rfq', kind: 'quotes-received', icon: 'shieldcheck', tone: 'success', refTable: 'rfqs', refId: Number(req.params.id),
      title: 'Quotes received', body: `${cur.rfq_no} — ${cur.client_name} is ready to compare`, link: '/page/rfq' });
  }
  res.json({ ok: true });
});
app.delete('/api/rfqs/:id', auth, async (req, res) => {
  const denied = await denyRecordAccess(req, 'rfqs', req.params.id);
  if (denied) return res.status(403).json({ error: denied });
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
  const sc = await scope(req);
  const dq = sc.all || !sc.department ? '' : ' AND department = ?';
  const dw = sc.all || !sc.department ? '' : ' WHERE department = ?';
  const dp = sc.all || !sc.department ? [] : [sc.department];
  const leads = (await db.prepare('SELECT COUNT(*) c FROM leads' + dw).get(...dp)).c;
  const rfq = (await db.prepare('SELECT COUNT(*) c FROM rfqs' + dw).get(...dp)).c;
  const rfqOpen = (await db.prepare("SELECT COUNT(*) c FROM rfqs WHERE status NOT IN ('Closed','Lost','Quoted')" + dq).get(...dp)).c;
  const quotations = (await db.prepare('SELECT COUNT(*) c FROM quotations').get()).c;
  const proposals = (await db.prepare("SELECT COUNT(*) c FROM policies WHERE policy_status IN ('Proposal','Pending','Draft','In Progress')" + dq).get(...dp)).c;
  const policies = (await db.prepare("SELECT COUNT(*) c FROM policies WHERE policy_status IN ('Policy','Issued','Completed')" + dq).get(...dp)).c;
  const renewalsDue = renewalSummary(await renewalRows(undefined, sc)).dueSoon;
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
const TASK_COLS = ['title', 'task_type', 'start_date', 'due_date', 'assigned_by', 'assigned_to',
  'related_kind', 'related_id', 'related_name', 'status', 'priority', 'remarks', 'reminder_days'];
const TASK_RELATED_KINDS = ['client', 'lead'];
const TASK_DONE = ['Completed', 'Cancelled'];

function taskPayload(f, user) {
  const kind = TASK_RELATED_KINDS.includes(f.related_kind) ? f.related_kind : '';
  const days = f.reminder_days === '' || f.reminder_days == null ? null : Number(f.reminder_days);
  return {
    title: (f.title || '').trim(),
    task_type: f.task_type || '',
    start_date: f.start_date || '',
    due_date: f.due_date || '',
    // Whoever created the task is the default "assigned by" — it records
    // who asked for the work, so it shouldn't silently follow later edits.
    assigned_by: f.assigned_by || user || '',
    assigned_to: f.assigned_to || '',
    // A dangling related_id with no kind would be unqueryable, so the two
    // are cleared together.
    related_kind: kind,
    related_id: kind ? (f.related_id || null) : null,
    related_name: kind ? (f.related_name || '') : '',
    status: f.status || 'Not Started',
    priority: f.priority || 'Medium',
    remarks: f.remarks || '',
    reminder_days: Number.isFinite(days) && days >= 0 ? days : null,
  };
}

app.get('/api/tasks', auth, async (req, res) => {
  // Optional relation filter, so a lead (or later a client) can list just
  // its own tasks off the same endpoint.
  const { relatedKind, relatedId } = req.query;
  let sql = 'SELECT * FROM tasks WHERE 1=1';
  const p = [];
  if (relatedKind && relatedId) { sql += ' AND related_kind = ? AND related_id = ?'; p.push(relatedKind, relatedId); }
  sql += " ORDER BY (NULLIF(due_date,'') IS NULL), due_date, id DESC";
  res.json(await db.prepare(sql).all(...p));
});

app.post('/api/tasks', auth, async (req, res) => {
  const f = req.body || {};
  if (!f.title?.trim()) return res.status(400).json({ error: 'Task subject is required' });
  const p = taskPayload(f, req.user.name);
  const info = await db.prepare(`INSERT INTO tasks (${TASK_COLS.join(',')}) VALUES (${TASK_COLS.map(() => '?').join(',')})`)
    .run(...TASK_COLS.map((c) => p[c]));
  const row = await emitRow('task', 'created', 'tasks', info.lastInsertRowid);
  await notify({ entity: 'task', kind: 'created', icon: 'checksquare', tone: 'info', refTable: 'tasks', refId: info.lastInsertRowid,
    title: 'New task created', body: `${p.title}${p.assigned_to ? ' → ' + p.assigned_to : ''}`, link: '/page/task' });
  res.json(row);
});

app.put('/api/tasks/:id', auth, async (req, res) => {
  const cur = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  const p = taskPayload({ ...cur, ...req.body }, cur.assigned_by);
  if (!p.title) return res.status(400).json({ error: 'Task subject is required' });
  await db.prepare(`UPDATE tasks SET ${TASK_COLS.map((c) => `${c}=?`).join(', ')} WHERE id=?`)
    .run(...TASK_COLS.map((c) => p[c]), req.params.id);
  // Changing the due date or the reminder lead time means the old reminder
  // no longer describes the task, so let it fire again on the new schedule.
  if (p.due_date !== cur.due_date || p.reminder_days !== cur.reminder_days) {
    await db.prepare('UPDATE tasks SET reminder_sent = 0, reminder_sent_at = NULL WHERE id = ?').run(req.params.id);
  }
  const row = await emitRow('task', 'updated', 'tasks', req.params.id);
  if (req.body.status && req.body.status !== cur.status && req.body.status === 'Completed') {
    await notify({ entity: 'task', kind: 'completed', icon: 'check', tone: 'success', refTable: 'tasks', refId: Number(req.params.id),
      title: 'Task completed', body: cur.title, link: '/page/task' });
  }
  res.json(row);
});

app.delete('/api/tasks/:id', auth, async (req, res) => {
  await db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  emit('task', 'deleted', { id: Number(req.params.id) });
  res.json({ ok: true });
});

// ---- task reminder scheduler ----
// Tasks carry dates but no times, so a reminder fires at 09:00 on the day it
// lands rather than at midnight — a "1 day before" nudge is only useful
// during working hours. Shares the meeting scheduler's once-only + recent
// window guarantees.
async function checkTaskReminders() {
  try {
    const due = await db.prepare(`
      SELECT id, title, due_date, reminder_days, assigned_to, related_name
      FROM tasks
      WHERE reminder_days IS NOT NULL
        AND COALESCE(reminder_sent, 0) = 0
        AND COALESCE(status, '') NOT IN ('Completed', 'Cancelled')
        AND NULLIF(due_date, '') IS NOT NULL
        AND (NULLIF(due_date,'')::date - (reminder_days * INTERVAL '1 day') + INTERVAL '9 hours') <= now()
        AND NULLIF(due_date,'')::date >= CURRENT_DATE - INTERVAL '7 days'
    `).all();
    for (const t of due) {
      const d = t.reminder_days;
      const when = d === 0 ? 'due today' : d === 1 ? 'due tomorrow' : `due in ${d} days`;
      const bits = [];
      if (t.assigned_to) bits.push(t.assigned_to);
      if (t.related_name) bits.push(t.related_name);
      await notify({
        entity: 'task', kind: 'reminder', icon: 'clock', tone: 'warning',
        refTable: 'tasks', refId: t.id,
        title: `Task ${when}: ${t.title}`,
        body: bits.join(' · '),
        link: '/page/task',
      });
      await db.prepare("UPDATE tasks SET reminder_sent = 1, reminder_sent_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?").run(t.id);
    }
  } catch (e) {
    console.error('checkTaskReminders failed:', e.message);
  }
}

// Reminds that an RFQ's comparison is due to go to the client. Fires once per
// send date, from 09:00 on the day, and only while the quote hasn't actually
// been shared — sharing stamps quote_sent_at, which takes the RFQ out of the
// sweep so a sent quote can't keep nagging. The 30-day floor stops a long-dead
// RFQ from raising a reminder the first time this ever runs.
async function checkQuoteSendReminders() {
  try {
    const due = await db.prepare(`
      SELECT id, rfq_no, client_name, product, quote_send_date
      FROM rfqs
      WHERE COALESCE(quote_reminder_sent, 0) = 0
        AND NULLIF(quote_send_date, '') IS NOT NULL
        AND NULLIF(quote_sent_at, '') IS NULL
        AND COALESCE(status, '') NOT IN ('Closed', 'Lost')
        AND (NULLIF(quote_send_date,'')::date + INTERVAL '9 hours') <= now()
        AND NULLIF(quote_send_date,'')::date >= CURRENT_DATE - INTERVAL '30 days'
    `).all();
    for (const r of due) {
      const overdue = r.quote_send_date < new Date().toISOString().slice(0, 10);
      await notify({
        entity: 'rfq', kind: 'reminder', icon: 'clock', tone: 'warning',
        refTable: 'rfqs', refId: r.id,
        title: `${overdue ? 'Quote overdue' : 'Quote due today'}: ${r.rfq_no}`,
        body: [r.client_name, r.product].filter(Boolean).join(' · '),
        link: '/page/rfq',
      });
      await db.prepare('UPDATE rfqs SET quote_reminder_sent = 1 WHERE id = ?').run(r.id);
    }
  } catch (e) {
    console.error('checkQuoteSendReminders failed:', e.message);
  }
}

// Mails the client as a policy approaches expiry. Fires once per expiry date:
// renewal_mail_sent stores the period_to it went out for, so renewing the
// policy (which moves period_to) arms the next one automatically, while
// re-running this never sends twice for the same date.
//
// Bounded to policies expiring within the lead time and not already past by
// more than a week, so switching automation on doesn't mail years of history.
const RENEWAL_LEAD_DAYS = 30;
async function checkRenewalMails() {
  try {
    if (!(await autoMailEnabled(db))) return;
    const due = await db.prepare(`
      SELECT p.id, p.policy_number, p.insured_name, p.company_name, p.product_name, p.insurance_type,
             p.period_to, p.final_premium, p.client_id, p.client_email, c.email AS client_row_email
      FROM policies p
      LEFT JOIN clients c ON c.id = p.client_id
      WHERE NULLIF(p.period_to, '') IS NOT NULL
        AND COALESCE(p.renewal_mail_sent, '') <> p.period_to
        AND COALESCE(p.active_status, 'Active') <> 'Inactive'
        AND NULLIF(p.period_to,'')::date BETWEEN CURRENT_DATE - INTERVAL '7 days'
                                             AND CURRENT_DATE + (? * INTERVAL '1 day')
    `).all(RENEWAL_LEAD_DAYS);
    for (const r of due) {
      const to = r.client_row_email || r.client_email || '';
      // Stamped even with no address on file: without it every sweep would
      // re-examine the same unmailable policy forever.
      if (to) {
        await sendAuto('renewal-due', to, {
          client: r.insured_name || 'Customer', policy_no: r.policy_number, company: r.company_name,
          product: r.product_name || r.insurance_type, expiry: r.period_to, premium: inrText(r.final_premium),
        }, { kind: 'client', id: r.client_id });
      }
      await db.prepare('UPDATE policies SET renewal_mail_sent = ? WHERE id = ?').run(r.period_to, r.id);
    }
  } catch (e) {
    console.error('checkRenewalMails failed:', e.message);
  }
}

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
// ---- email templates ----
// Placeholders are {curly} tokens filled in at send time. Kept as a literal
// list so the editor can offer them rather than the user guessing.
const TEMPLATE_TOKENS = [
  { token: '{client}', label: 'Client / recipient name' },
  { token: '{policy_no}', label: 'Policy number' },
  { token: '{company}', label: 'Insurance company' },
  { token: '{product}', label: 'Product / plan' },
  { token: '{expiry}', label: 'Expiry / due date' },
  { token: '{premium}', label: 'Premium amount' },
  { token: '{claim_no}', label: 'Claim number' },
  { token: '{owner}', label: 'Your name' },
  { token: '{org}', label: 'Your organisation' },
  { token: '{rfq_no}', label: 'RFQ number' },
  { token: '{lead_name}', label: 'Referred lead name' },
  { token: '{sum_assured}', label: 'Sum assured / cover' },
  { token: '{period}', label: 'Policy period' },
  { token: '{coverages}', label: 'Covers included' },
];

app.get('/api/templates', auth, async (req, res) => {
  const rows = await db.prepare('SELECT * FROM templates ORDER BY tkey').all();
  // Automation events are listed even before anyone saves a template for them,
  // with the built-in copy shown, so the editor reveals what the CRM can send
  // rather than leaving it to be discovered by a customer receiving one.
  const saved = new Set(rows.map((r) => r.tkey));
  const auto = AUTO_EVENTS.map((e) => ({
    ...e, saved: saved.has(e.tkey),
    subject: DEFAULT_TEMPLATES[e.tkey]?.subject || '',
    body: DEFAULT_TEMPLATES[e.tkey]?.body || '',
  }));
  res.json({ templates: rows, tokens: TEMPLATE_TOKENS, autoEvents: auto });
});

app.post('/api/templates', auth, async (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Template name is required' });
  // Derive a stable key from the name; the key is what send-time lookups use.
  const tkey = (req.body?.tkey || name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!tkey) return res.status(400).json({ error: 'Template name must contain letters or numbers' });
  const clash = await db.prepare('SELECT id FROM templates WHERE tkey = ?').get(tkey);
  if (clash) return res.status(409).json({ error: 'A template with that name already exists' });
  const info = await db.prepare("INSERT INTO templates (tkey, subject, body, updated_at) VALUES (?,?,?,to_char(CURRENT_DATE,'YYYY-MM-DD'))")
    .run(tkey, req.body?.subject || '', req.body?.body || '');
  const row = await db.prepare('SELECT * FROM templates WHERE id = ?').get(info.lastInsertRowid);
  emit('template', 'created', row);
  res.json(row);
});

app.delete('/api/templates/:key', auth, async (req, res) => {
  await db.prepare('DELETE FROM templates WHERE tkey = ?').run(req.params.key);
  emit('template', 'deleted', { tkey: req.params.key });
  res.json({ ok: true });
});

app.get('/api/templates/:key', auth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM templates WHERE tkey = ?').get(req.params.key);
  res.json(row || { tkey: req.params.key, subject: '', body: '' });
});
app.put('/api/templates/:key', auth, async (req, res) => {
  const { subject, body } = req.body;
  const existing = await db.prepare('SELECT id FROM templates WHERE tkey = ?').get(req.params.key);
  if (existing) await db.prepare("UPDATE templates SET subject=?, body=?, updated_at=to_char(CURRENT_DATE,'YYYY-MM-DD') WHERE tkey=?").run(subject || '', body || '', req.params.key);
  else await db.prepare("INSERT INTO templates (tkey, subject, body, updated_at) VALUES (?,?,?,to_char(CURRENT_DATE,'YYYY-MM-DD'))").run(req.params.key, subject || '', body || '');
  const row = await db.prepare('SELECT * FROM templates WHERE tkey = ?').get(req.params.key);
  emit('template', 'updated', row);
  res.json(row);
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
const CLAIM_COLS = [
  'claim_title', 'claim_category', 'client_name', 'client_id', 'company_name', 'policy_id', 'policy_no', 'policy_type',
  'claim_no', 'intimation_no', 'intimation_date', 'claim_type', 'vehicle_no',
  'patient_name', 'doctor_name', 'hospital_name', 'admission_date', 'discharge_date',
  'associates', 'owner', 'claim_date', 'file_received_date', 'process_date', 'settlement_date',
  'claim_amount', 'settlement_amount', 'deduction', 'currency', 'exchange_rate',
  'approved_amount', 'approval_date', 'survey_date', 'surveyor_name',
  'reinspection_date', 'reinspection_reason', 'delivery_location', 'delivery_date',
  'pending_documents', 'required_documents', 'mode_of_transfer',
  'status', 'remarks', 'department', 'documents', 'details',
];
const CLAIM_NUMS = ['claim_amount', 'settlement_amount', 'deduction', 'approved_amount', 'exchange_rate'];
// Health-shaped claim types get the patient/hospital block; motor gets the
// vehicle. Anything else keeps neither.
const HEALTH_CLAIM_TYPES = ['GHI', 'Health', 'Personal'];

// Mirrors the form's conditional visibility, so a claim switched from (say)
// Motor to Health doesn't keep an invisible vehicle number.
function claimPayload(f, user) {
  const personal = f.claim_category === 'Personal';
  const type = f.claim_type || 'Motor';
  const health = personal || HEALTH_CLAIM_TYPES.includes(type);
  const motor = !personal && type === 'Motor';
  const num = (v) => (v === '' || v == null ? 0 : Number(v) || 0);
  const keepIf = (cond, v) => (cond ? (v ?? '') : '');

  const out = {
    claim_title: (f.claim_title || '').trim(),
    claim_category: personal ? 'Personal' : 'Corporate',
    client_name: f.client_name || '',
    client_id: f.client_id || null,
    company_name: f.company_name || '',
    policy_id: f.policy_id || null,
    policy_no: f.policy_no || '',
    policy_type: f.policy_type || '',
    claim_no: f.claim_no || '',
    intimation_no: f.intimation_no || '',
    intimation_date: f.intimation_date || '',
    claim_type: type,
    vehicle_no: keepIf(motor, f.vehicle_no),
    patient_name: keepIf(health, f.patient_name),
    doctor_name: keepIf(health, f.doctor_name),
    hospital_name: keepIf(health, f.hospital_name),
    admission_date: keepIf(health, f.admission_date),
    discharge_date: keepIf(health, f.discharge_date),
    associates: f.associates || '',
    owner: f.owner || user || '',
    claim_date: f.claim_date || '',
    file_received_date: f.file_received_date || '',
    process_date: f.process_date || '',
    settlement_date: f.settlement_date || '',
    claim_amount: num(f.claim_amount),
    settlement_amount: num(f.settlement_amount),
    deduction: num(f.deduction),
    currency: f.currency || 'INR',
    exchange_rate: (f.currency || 'INR') === 'INR' ? 1 : (num(f.exchange_rate) || 1),
    approved_amount: num(f.approved_amount),
    approval_date: f.approval_date || '',
    // Survey / reinspection / delivery is the corporate claim flow; mode of
    // transfer and the required-documents list belong to the personal one.
    survey_date: keepIf(!personal, f.survey_date),
    surveyor_name: keepIf(!personal, f.surveyor_name),
    reinspection_date: keepIf(!personal, f.reinspection_date),
    reinspection_reason: keepIf(!personal, f.reinspection_reason),
    delivery_location: keepIf(!personal, f.delivery_location),
    delivery_date: keepIf(!personal, f.delivery_date),
    pending_documents: f.pending_documents || '',
    required_documents: keepIf(personal, f.required_documents),
    mode_of_transfer: keepIf(personal, f.mode_of_transfer),
    status: f.status || 'Pending',
    remarks: f.remarks || '',
    department: departmentForClaimType(type),
    documents: Array.isArray(f.documents) ? JSON.stringify(f.documents) : (f.documents || '[]'),
    details: f.details && typeof f.details === 'object' ? JSON.stringify(f.details) : (f.details || '{}'),
  };
  for (const k of CLAIM_NUMS) out[k] = num(out[k]);
  return out;
}

app.post('/api/claims', auth, async (req, res) => {
  const f = req.body || {};
  if (!f.client_name) return res.status(400).json({ error: 'Insured name is required' });
  const p = claimPayload(f, req.user.name);
  const info = await db.prepare(`INSERT INTO claims (${CLAIM_COLS.join(',')}) VALUES (${CLAIM_COLS.map(() => '?').join(',')})`)
    .run(...CLAIM_COLS.map((c) => p[c]));
  const row = await emitRow('claim', 'created', 'claims', info.lastInsertRowid);
  await notify({ entity: 'claim', kind: 'created', icon: 'shieldcheck', tone: 'warning', refTable: 'claims', refId: info.lastInsertRowid,
    title: 'New claim registered', body: `${p.client_name} · ${p.company_name || p.claim_type}`, link: '/page/claim' });
  res.json(row);
});

// Bulk import. Deliberately does not require client_name the way single
// creation does: these sheets come from other systems and are rarely complete,
// and the user's instruction was that nothing be compulsory. A row that maps
// to nothing at all is still rejected, since that would write an empty claim.
//
// Rows are independent — one bad row is reported by its sheet position and the
// rest still import, rather than losing the whole file to a single bad cell.
app.post('/api/claims/import', auth, async (req, res) => {
  const list = Array.isArray(req.body?.rows) ? req.body.rows : (Array.isArray(req.body?.claims) ? req.body.claims : []);
  if (!list.length) return res.status(400).json({ error: 'No rows to import' });
  if (list.length > 5000) return res.status(400).json({ error: 'Too many rows in a single request (5000 max). The import screen sends large files in batches automatically, so this only appears for a hand-built request.' });

  const failed = [];
  const ids = [];
  for (const [i, raw] of list.entries()) {
    try {
      if (!raw || typeof raw !== 'object' || !Object.keys(raw).length) { failed.push({ row: i + 2, error: 'Empty row' }); continue; }
      const p = claimPayload(raw, req.user.name);
      // claimPayload blanks fields that don't apply to the claim type, which
      // is right for the form but would quietly drop imported values. An
      // import takes the sheet at its word.
      for (const c of CLAIM_COLS) if (raw[c] !== undefined && raw[c] !== '' && (p[c] === '' || p[c] === null)) p[c] = raw[c];
      // A department column is honoured when it names one of the two; anything
      // else (blank, or a value that isn't a department) falls back to deriving
      // it from the claim type, as every other claim does.
      const asked = String(raw.department || '').toLowerCase();
      p.department = asked.includes('personal') ? PERSONAL
        : asked.includes('commercial') ? COMMERCIAL
        : departmentForClaimType(p.claim_type || '');
      const info = await db.prepare(`INSERT INTO claims (${CLAIM_COLS.join(',')}) VALUES (${CLAIM_COLS.map(() => '?').join(',')})`)
        .run(...CLAIM_COLS.map((c) => p[c]));
      ids.push(info.lastInsertRowid);
    } catch (e) {
      failed.push({ row: i + 2, error: e.message });
    }
  }
  // One notification per file, not per batch — see the client import.
  if (ids.length) emit('claim', 'imported', { count: ids.length });
  const total = (Number(req.body?.previously_inserted) || 0) + ids.length;
  if (total && (req.body?.last === true || req.body?.last === undefined)) {
    await notify({ entity: 'claim', kind: 'imported', icon: 'upload', tone: 'info', refTable: 'claims', refId: ids[0] || null,
      title: `${total.toLocaleString('en-IN')} claim${total > 1 ? 's' : ''} imported`, body: 'from a spreadsheet', link: '/page/claim' });
  }
  res.json({ inserted: ids.length, failed });
});

app.put('/api/claims/:id', auth, async (req, res) => {
  const denied = await denyRecordAccess(req, 'claims', req.params.id);
  if (denied) return res.status(403).json({ error: denied });
  const cur = await db.prepare('SELECT * FROM claims WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const p = claimPayload({ ...cur, ...b }, cur.owner);

  // claimPayload blanks fields that don't suit the claim type — right when the
  // form switches a claim from Motor to Health, wrong when someone merely edits
  // a claim. An imported claim can carry a survey date on a personal claim, or
  // a vehicle number on a health one, and saving an unrelated change should not
  // quietly wipe it. So unless the type or category is actually being changed,
  // those fields keep what the request sent, or else what was already saved.
  const typeChanged = (b.claim_type !== undefined && b.claim_type !== cur.claim_type)
    || (b.claim_category !== undefined && b.claim_category !== cur.claim_category);
  if (!typeChanged) {
    for (const k of ['vehicle_no', 'patient_name', 'doctor_name', 'hospital_name', 'admission_date', 'discharge_date',
      'survey_date', 'surveyor_name', 'reinspection_date', 'reinspection_reason', 'delivery_location', 'delivery_date',
      'required_documents', 'mode_of_transfer']) {
      p[k] = b[k] !== undefined ? (b[k] ?? '') : (cur[k] ?? '');
    }
  }

  // Department is derived from the claim type, except where one was stated:
  // an imported claim can carry its own, and an edit that doesn't touch the
  // type shouldn't replace it with the derived value.
  const asked = String(b.department || '').toLowerCase();
  if (asked.includes('personal')) p.department = PERSONAL;
  else if (asked.includes('commercial')) p.department = COMMERCIAL;
  else if (!typeChanged && cur.department) p.department = cur.department;

  await db.prepare(`UPDATE claims SET ${CLAIM_COLS.map((c) => `${c}=?`).join(', ')} WHERE id=?`)
    .run(...CLAIM_COLS.map((c) => p[c]), req.params.id);
  const row = await emitRow('claim', 'updated', 'claims', req.params.id);
  if (req.body.status && req.body.status !== cur.status && req.body.status === 'Settled') {
    await notify({ entity: 'claim', kind: 'settled', icon: 'check', tone: 'success', refTable: 'claims', refId: Number(req.params.id),
      title: 'Claim settled', body: `${cur.client_name} · ₹${p.settlement_amount || p.claim_amount}`, link: '/page/claim' });
  }
  res.json(row);
});

app.delete('/api/claims/:id', auth, async (req, res) => {
  const denied = await denyRecordAccess(req, 'claims', req.params.id);
  if (denied) return res.status(403).json({ error: denied });
  await db.prepare('DELETE FROM claims WHERE id = ?').run(req.params.id);
  emit('claim', 'deleted', { id: Number(req.params.id) });
  res.json({ ok: true });
});

// ---- leads: create / update / delete ----
// A referring client is only meaningful when the source actually is a client
// referral — clearing it otherwise stops a stale referrer lingering after the
// source is changed to something else.
const LEAD_COLS = ['lead_name', 'lead_date', 'expected_business_type', 'mobile', 'email',
  'lead_owner', 'source', 'referral_client_id', 'referral_client_name', 'company_name',
  'status', 'followup_date', 'remarks', 'department'];
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
    department: departmentForProduct(f.expected_business_type),
  };
}

app.post('/api/leads', auth, async (req, res) => {
  const f = req.body;
  if (!f.lead_name) return res.status(400).json({ error: 'Lead name is required' });
  const p = leadPayload(f, req.user.name);
  const deptErr = await denyCrossDepartment(req, p.department);
  if (deptErr) return res.status(403).json({ error: deptErr });
  const info = await db.prepare(`INSERT INTO leads (${LEAD_COLS.join(',')}) VALUES (${LEAD_COLS.map(() => '?').join(',')})`)
    .run(...LEAD_COLS.map((c) => p[c]));
  await emitRow('lead', 'created', 'leads', info.lastInsertRowid);
  await notify({ entity: 'lead', kind: 'created', icon: 'userplus', tone: 'info', refTable: 'leads', refId: info.lastInsertRowid,
    title: 'New lead added', body: `${p.lead_name}${p.company_name ? ' · ' + p.company_name : ''}`, link: '/page/lead' });
  await sendAuto('lead-created', p.email, { client: p.lead_name, product: p.expected_business_type || 'insurance' },
    { kind: 'lead', id: info.lastInsertRowid });
  // A referred lead means an existing client put their name to us — worth a
  // thank-you to the referrer, not just a welcome to the lead.
  if (p.referral_client_id) {
    const ref = await db.prepare('SELECT client_name, email FROM clients WHERE id = ?').get(p.referral_client_id);
    if (ref?.email) {
      await sendAuto('referral-thanks', ref.email, { client: ref.client_name, lead_name: p.lead_name },
        { kind: 'client', id: p.referral_client_id });
    }
  }
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/leads/:id', auth, async (req, res) => {
  const denied = await denyRecordAccess(req, 'leads', req.params.id);
  if (denied) return res.status(403).json({ error: denied });
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
  const denied = await denyRecordAccess(req, 'leads', req.params.id);
  if (denied) return res.status(403).json({ error: denied });
  // lead_activities cascades on delete (see schema) — no orphan cleanup needed.
  await db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  emit('lead', 'deleted', { id: Number(req.params.id) });
  res.json({ ok: true });
});

// ---- lead activities (tasks / notes / meetings) ----
const ACT_COLS = ['kind', 'title', 'body', 'due_date', 'meeting_time', 'location', 'status', 'priority', 'owner'];
// Only notes live here now. A lead's meetings and tasks are real records in
// their own modules (GET /api/leads/:id/meetings, GET /api/tasks?relatedKind
// =lead&relatedId=…) — competing notions of the same thing would drift apart.
const ACT_KINDS = ['note'];

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
  const denied = await denyRecordAccess(req, 'policies', req.params.id);
  if (denied) return res.status(403).json({ error: denied });
  const cur = await db.prepare('SELECT * FROM policies WHERE id = ?').get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  // Merge over the current row, so the renewal manager's partial writes
  // ({renewal_status} on its own) keep working alongside the full form.
  const p = policyPayload({ ...cur, ...req.body }, cur.assigned_to);
  if (!p.product_name) return res.status(400).json({ error: 'Plan is required' });
  await db.prepare(`UPDATE policies SET ${POLICY_COLS.map((c) => `${c}=?`).join(', ')} WHERE id=?`)
    .run(...POLICY_COLS.map((c) => p[c]), req.params.id);
  // renewal_status isn't part of the form, so it's applied separately.
  if ('renewal_status' in req.body) {
    await db.prepare('UPDATE policies SET renewal_status = ? WHERE id = ?').run(req.body.renewal_status, req.params.id);
  }
  const row = await emitRow('policy', 'updated', 'policies', req.params.id);
  res.json(row);
});

app.delete('/api/policies/:id', auth, async (req, res) => {
  const denied = await denyRecordAccess(req, 'policies', req.params.id);
  if (denied) return res.status(403).json({ error: denied });
  await db.prepare('DELETE FROM policies WHERE id = ?').run(req.params.id);
  emit('policy', 'deleted', { id: Number(req.params.id) });
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
    // Vartify — same rule as every other secret: report that one exists,
    // never send it back.
    waVartifyBase: s.wa_vartify_base || 'https://vartify.in/api/v1',
    hasVartifyToken: !!s.wa_vartify_token,
    hasWebhookSecret: !!s.wa_webhook_secret,
    waWebhookId: s.wa_webhook_id || '',
    autoMailEnabled: !!s.auto_mail_enabled,
  });
});

app.put('/api/integration-settings', auth, async (req, res) => {
  const b = req.body || {};
  const cur = (await readIntegrationSettings(req.user.id)) || {};
  const smtpPass = b.smtpPass ? b.smtpPass : (cur.smtp_pass || null);
  const waToken = b.waToken ? b.waToken : (cur.wa_token || null);
  const vartifyToken = b.waVartifyToken ? b.waVartifyToken : (cur.wa_vartify_token || null);
  await db.prepare(`
    INSERT INTO integration_settings
      (user_id, email_enabled, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, smtp_from_name, smtp_from_email,
       wa_enabled, wa_provider, wa_phone_id, wa_business_id, wa_token, auto_mail_enabled)
    VALUES (@user_id, @email_enabled, @smtp_host, @smtp_port, @smtp_secure, @smtp_user, @smtp_pass, @smtp_from_name, @smtp_from_email,
            @wa_enabled, @wa_provider, @wa_phone_id, @wa_business_id, @wa_token, @auto_mail_enabled)
    ON CONFLICT(user_id) DO UPDATE SET
      email_enabled=excluded.email_enabled, smtp_host=excluded.smtp_host, smtp_port=excluded.smtp_port,
      smtp_secure=excluded.smtp_secure, smtp_user=excluded.smtp_user, smtp_pass=excluded.smtp_pass,
      smtp_from_name=excluded.smtp_from_name, smtp_from_email=excluded.smtp_from_email,
      wa_enabled=excluded.wa_enabled, wa_provider=excluded.wa_provider, wa_phone_id=excluded.wa_phone_id,
      wa_business_id=excluded.wa_business_id, wa_token=excluded.wa_token,
      auto_mail_enabled=excluded.auto_mail_enabled
  `).run({
    user_id: req.user.id,
    email_enabled: b.emailEnabled ? 1 : 0,
    auto_mail_enabled: b.autoMailEnabled ? 1 : 0,
    smtp_host: b.smtpHost || '', smtp_port: b.smtpPort || '587', smtp_secure: b.smtpSecure || 'TLS',
    smtp_user: b.smtpUser || '', smtp_pass: smtpPass, smtp_from_name: b.smtpFromName || '', smtp_from_email: b.smtpFromEmail || '',
    wa_enabled: b.waEnabled ? 1 : 0,
    wa_provider: b.waProvider || 'WhatsApp Business API', wa_phone_id: b.waPhoneId || '', wa_business_id: b.waBusinessId || '',
    wa_token: waToken,
  });
  // Vartify columns aren't part of the upsert above (which predates them), so
  // they're written separately.
  await db.prepare('UPDATE integration_settings SET wa_vartify_token = ?, wa_vartify_base = ? WHERE user_id = ?')
    .run(vartifyToken, b.waVartifyBase || 'https://vartify.in/api/v1', req.user.id);
  res.json({ ok: true });
});

// ---- Vartify WhatsApp ----
// Resolves the caller's provider config. Returns null when Vartify isn't the
// selected provider or isn't configured, so callers can fall back to Meta.
async function vartifyConfig(userId) {
  const s = await db.prepare('SELECT * FROM integration_settings WHERE user_id = ?').get(userId);
  if (!s?.wa_enabled) return null;
  if ((s.wa_provider || '') !== 'Vartify') return null;
  if (!s.wa_vartify_token) return null;
  return { token: s.wa_vartify_token, base: s.wa_vartify_base || undefined, webhookSecret: s.wa_webhook_secret || '' };
}

// Any user's Vartify config — the webhook has no session, so inbound events
// are matched against whichever workspace is configured.
async function anyVartifyConfig() {
  const s = await db.prepare("SELECT * FROM integration_settings WHERE wa_vartify_token IS NOT NULL AND wa_vartify_token <> '' LIMIT 1").get();
  return s ? { token: s.wa_vartify_token, base: s.wa_vartify_base || undefined, webhookSecret: s.wa_webhook_secret || '', userId: s.user_id } : null;
}

function requireVartify(cfg, res) {
  if (!cfg) { res.status(400).json({ error: 'Vartify is not configured — set it up in My Profile → WhatsApp Integration.' }); return false; }
  return true;
}

// Connection test: GET /me tells you the token is valid and which account it belongs to.
app.get('/api/whatsapp/account', auth, async (req, res) => {
  const cfg = await vartifyConfig(req.user.id);
  if (!requireVartify(cfg, res)) return;
  try { res.json(await vartify.me(cfg)); }
  catch (e) { res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.message }); }
});

app.get('/api/whatsapp/templates', auth, async (req, res) => {
  const cfg = await vartifyConfig(req.user.id);
  if (!requireVartify(cfg, res)) return;
  try { res.json(await vartify.listTemplates(cfg, { all: req.query.all === '1' })); }
  catch (e) { res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.message }); }
});

// Looks up the CRM record, syncs it to Vartify as a contact (upsert), and
// caches the returned contact id so later sends skip the round trip.
async function resolveContact(cfg, kind, id) {
  const table = kind === 'lead' ? 'leads' : 'clients';
  const row = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) throw new vartify.VartifyError('That record no longer exists.', { status: 404 });
  const name = kind === 'lead' ? row.lead_name : row.client_name;
  const [first, ...rest] = String(name || '').trim().split(/\s+/);
  const contact = await vartify.upsertContact(cfg, {
    mobile: row.mobile, first_name: first, last_name: rest.join(' '),
    email: row.email, crmKind: kind, crmId: id,
  });
  if (contact?.id && contact.id !== row.vartify_contact_id) {
    await db.prepare(`UPDATE ${table} SET vartify_contact_id = ? WHERE id = ?`).run(contact.id, id);
  }
  return { contact, row, name };
}

app.post('/api/whatsapp/send', auth, async (req, res) => {
  const cfg = await vartifyConfig(req.user.id);
  if (!requireVartify(cfg, res)) return;
  const { kind, id, body, template_name, template_vars, template_language } = req.body || {};
  if (!['client', 'lead'].includes(kind)) return res.status(400).json({ error: 'Send to a client or a lead.' });
  if (!body && !template_name) return res.status(400).json({ error: 'Provide a template, or free-form text if the customer messaged in the last 24 hours.' });
  try {
    const { contact, name } = await resolveContact(cfg, kind, id);
    const sent = await vartify.sendMessage(cfg, {
      contact_id: contact.id, channel: 'whatsapp',
      body, template_name, template_vars, template_language,
      sent_by: req.user.name || 'WCA CRM',
    });
    await db.prepare(`INSERT INTO wa_messages (direction, phone_e164, contact_id, provider_message_id, body, template_name, status, parent_kind, parent_id, sent_by)
      VALUES ('out',?,?,?,?,?,?,?,?,?)`)
      .run(contact.phone_e164 || '', contact.id, sent?.provider_message_id || null,
        body || '', template_name || '', sent?.status || 'sent', kind, id, req.user.name || '');
    emit('wa-message', 'created', { parent_kind: kind, parent_id: Number(id) });
    await notify({ entity: 'whatsapp', kind: 'sent', icon: 'send', tone: 'success', refTable: kind === 'lead' ? 'leads' : 'clients', refId: Number(id),
      title: 'WhatsApp sent', body: `${name} · ${template_name || 'message'}`, link: kind === 'lead' ? '/page/lead' : '/page/client-master' });
    res.json({ ok: true, ...sent });
  } catch (e) {
    await db.prepare(`INSERT INTO wa_messages (direction, body, template_name, status, error, parent_kind, parent_id, sent_by)
      VALUES ('out',?,?, 'failed', ?, ?, ?, ?)`)
      .run(body || '', template_name || '', e.message, kind, id, req.user.name || '');
    res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.message });
  }
});

// A record's WhatsApp thread: locally logged messages, plus live history from
// Vartify when the contact is known.
app.get('/api/whatsapp/thread', auth, async (req, res) => {
  const { kind, id } = req.query;
  if (!['client', 'lead'].includes(kind)) return res.status(400).json({ error: 'Unsupported record type' });
  const local = await db.prepare('SELECT * FROM wa_messages WHERE parent_kind = ? AND parent_id = ? ORDER BY id').all(kind, id);
  const cfg = await vartifyConfig(req.user.id);
  if (!cfg) return res.json({ messages: local, remote: [], configured: false });
  try {
    const table = kind === 'lead' ? 'leads' : 'clients';
    const row = await db.prepare(`SELECT vartify_contact_id FROM ${table} WHERE id = ?`).get(id);
    if (!row?.vartify_contact_id) return res.json({ messages: local, remote: [], configured: true });
    const convos = await vartify.conversationsForContact(cfg, row.vartify_contact_id);
    const remote = convos.length ? await vartify.conversationMessages(cfg, convos[0].id) : [];
    res.json({ messages: local, remote, conversation: convos[0] || null, configured: true });
  } catch (e) {
    // History is a nice-to-have; never fail the record view over it.
    res.json({ messages: local, remote: [], configured: true, warning: e.message });
  }
});

// Registers this server's public webhook URL with Vartify and stores the
// returned secret — it's shown once and can't be retrieved again.
app.post('/api/whatsapp/register-webhook', auth, async (req, res) => {
  const cfg = await vartifyConfig(req.user.id);
  if (!requireVartify(cfg, res)) return;
  const url = (req.body?.url || '').trim();
  if (!/^https:\/\//.test(url)) return res.status(400).json({ error: 'The webhook URL must be https.' });
  try {
    const created = await vartify.registerWebhook(cfg, { url, events: ['message.received', 'message.sent'] });
    const d = created?.data || created;
    const secret = d?.secret || d?.signing_secret || '';
    await db.prepare('UPDATE integration_settings SET wa_webhook_secret = ?, wa_webhook_id = ? WHERE user_id = ?')
      .run(secret, String(d?.id || ''), req.user.id);
    res.json({ ok: true, id: d?.id, storedSecret: !!secret });
  } catch (e) {
    res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.message });
  }
});

// PUBLIC endpoint — Vartify posts here. Authentication is the HMAC signature,
// not a session, so it deliberately sits outside the auth middleware.
app.post('/api/whatsapp/webhook', async (req, res) => {
  try {
    const cfg = await anyVartifyConfig();
    const sig = req.get('X-Webhook-Signature');
    if (!cfg?.webhookSecret) return res.status(503).json({ error: 'Webhook not configured' });
    if (!vartify.verifyWebhookSignature(crypto, sig, req.rawBody || '', cfg.webhookSecret)) {
      return res.status(400).json({ error: 'Bad signature' });
    }
    const event = req.get('X-Webhook-Event') || req.body?.event || '';
    const d = req.body?.data || req.body || {};
    const phone = d.phone_e164 || d.contact?.phone_e164 || d.from || '';
    const contactId = d.contact_id || d.contact?.id || null;

    // Match the message back to a CRM record by Vartify contact id first,
    // falling back to the phone number for contacts created outside the CRM.
    let parentKind = null, parentId = null;
    const find = async (table, kind) => {
      if (parentId) return;
      let row = contactId ? await db.prepare(`SELECT id FROM ${table} WHERE vartify_contact_id = ?`).get(contactId) : null;
      if (!row && phone) {
        const last10 = String(phone).replace(/\D/g, '').slice(-10);
        row = await db.prepare(`SELECT id FROM ${table} WHERE regexp_replace(COALESCE(mobile,''), '\\D', '', 'g') LIKE ?`).get('%' + last10);
      }
      if (row) { parentKind = kind; parentId = row.id; }
    };
    await find('clients', 'client');
    await find('leads', 'lead');

    if (event === 'message.received') {
      // Vartify retries anything non-2xx, so the same message can arrive twice.
      // The WHERE repeats the unique index's own predicate — without it Postgres
      // won't match a *partial* index and the insert errors instead of skipping.
      const ins = await db.prepare(`INSERT INTO wa_messages (direction, phone_e164, contact_id, conversation_id, provider_message_id, body, status, parent_kind, parent_id)
        VALUES ('in',?,?,?,?,?, 'received',?,?)
        ON CONFLICT (provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING`)
        .run(phone, contactId, String(d.conversation_id || ''), d.message_id || d.provider_message_id || null,
          d.body || d.text || '', parentKind, parentId);
      // A skipped insert means we already have this message, so stay quiet —
      // otherwise a single retried delivery notifies the user twice.
      if (ins.changes) {
        emit('wa-message', 'created', { parent_kind: parentKind, parent_id: parentId });
        await notify({ entity: 'whatsapp', kind: 'received', icon: 'mail', tone: 'info',
          refTable: parentKind === 'lead' ? 'leads' : 'clients', refId: parentId,
          title: 'WhatsApp reply received', body: `${phone}: ${String(d.body || d.text || '').slice(0, 120)}`,
          link: parentKind === 'lead' ? '/page/lead' : '/page/client-master' });
      }
    } else if (event === 'message.sent' && (d.message_id || d.provider_message_id)) {
      await db.prepare('UPDATE wa_messages SET status = ? WHERE provider_message_id = ?')
        .run(d.status || 'sent', d.message_id || d.provider_message_id);
    }
    // Acknowledge as soon as it's stored — anything non-2xx is retried.
    res.json({ ok: true });
  } catch (e) {
    console.error('vartify webhook failed:', e.message);
    res.status(500).json({ error: 'Webhook handling failed' });
  }
});

// Records an outbound send so the Sent Emails list on a record is a real
// audit trail. Never throws — a logging failure must not fail the send.
async function logEmail(req, { to, subject, html, status, error }) {
  try {
    const preview = String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    const first = String(to || '').split(',')[0].trim();
    // Link it to a client when the address matches one, so it also appears
    // under that client even if it was sent from elsewhere in the app.
    const client = first ? await db.prepare('SELECT id FROM clients WHERE email ILIKE ? LIMIT 1').get(first) : null;
    await db.prepare('INSERT INTO email_log (to_addr, subject, body_preview, parent_kind, parent_id, status, error, sent_by) VALUES (?,?,?,?,?,?,?,?)')
      .run(to || '', subject || '', preview, client ? 'client' : (req.body?.parent_kind || null), client ? client.id : (req.body?.parent_id || null), status, error || '', req.user?.name || '');
  } catch (e) {
    console.error('logEmail failed:', e.message);
  }
}

const inrText = (n) => (Number(n) > 0 ? 'Rs. ' + Number(n).toLocaleString('en-IN') : '');

// Sends one automatic mail. Swallows every failure on purpose: an automation
// must never break the action that triggered it, and the attempt is written to
// email_log either way so there's a record of what went out and what didn't.
async function sendAuto(tkey, to, vars = {}, parent = {}, files = []) {
  try {
    if (!to || !String(to).includes('@')) return;
    if (!(await autoMailEnabled(db))) return;
    const s = await anySmtp(db);
    if (!s) return;
    const tpl = await loadTemplate(db, tkey);
    if (!tpl) return;
    const org = s.smtp_from_name || 'WeCare Assurance';
    const merged = { org, owner: org, ...vars };
    const subject = fillTokens(tpl.subject, merged);
    const html = fillTokens(tpl.body, merged);
    const transporter = nodemailer.createTransport({
      host: s.smtp_host, port: Number(s.smtp_port) || 587,
      secure: s.smtp_secure === 'SSL',
      auth: { user: s.smtp_user, pass: s.smtp_pass },
    });
    try {
      // Each file is { filename, uri }, a name and a data URI. Anything that is
      // not a usable data URI is dropped rather than failing the whole mail.
      const attachments = (Array.isArray(files) ? files : [])
        .filter((a) => a && a.filename && String(a.uri || '').startsWith('data:'))
        .map((a) => ({ filename: a.filename, content: String(a.uri).split(',').pop(), encoding: 'base64' }));
      await transporter.sendMail({
        from: `"${s.smtp_from_name || s.smtp_user}" <${s.smtp_from_email || s.smtp_user}>`,
        to, subject, html, attachments,
      });
      await logAutoEmail({ to, subject, html: html + (attachments.length ? ` [${attachments.length} attached: ${attachments.map((a) => a.filename).join(', ')}]` : ''), status: 'Sent', tkey, parent });
    } catch (e) {
      await logAutoEmail({ to, subject, html, status: 'Failed', error: e.message, tkey, parent });
    }
  } catch (e) {
    console.error(`sendAuto(${tkey}) failed:`, e.message);
  }
}

// Same audit trail as a hand-sent mail, minus the request object automations
// don't have.
async function logAutoEmail({ to, subject, html, status, error, tkey, parent }) {
  try {
    const preview = String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    await db.prepare('INSERT INTO email_log (to_addr, subject, body_preview, parent_kind, parent_id, status, error, sent_by) VALUES (?,?,?,?,?,?,?,?)')
      .run(to || '', subject || '', preview, parent.kind || null, parent.id || null, status, error || '', `Automation (${tkey})`);
  } catch (e) {
    console.error('logAutoEmail failed:', e.message);
  }
}

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
    await logEmail(req, { to, subject, html, status: 'Sent' });
    res.json({ ok: true });
  } catch (e) {
    // Failures are logged too — "we tried and it bounced" is exactly what
    // you want to see on the record later.
    await logEmail(req, { to, subject, html, status: 'Failed', error: e.message });
    res.status(500).json({ error: e.message || 'Failed to send email' });
  }
});

// ---- outbound WhatsApp (Meta Cloud API, credentials resolved server-side from the caller's saved integration settings) ----
app.post('/api/send-whatsapp', auth, async (req, res) => {
  const { to, message, mediaBase64, filename } = req.body || {};
  const s = await readIntegrationSettings(req.user.id);
  if (!s?.wa_enabled) return res.status(400).json({ error: 'WhatsApp integration is disabled — enable it in My Profile first.' });

  // Vartify path: resolve the number to a contact (upsert) and send through
  // the platform rather than talking to Meta directly.
  if ((s.wa_provider || '') === 'Vartify') {
    const cfg = await vartifyConfig(req.user.id);
    if (!cfg) return res.status(400).json({ error: 'Vartify is selected but no API token is saved — add it in My Profile.' });
    try {
      const contact = await vartify.upsertContact(cfg, { mobile: to, source: 'wca_crm' });
      const sent = await vartify.sendMessage(cfg, {
        contact_id: contact.id, channel: 'whatsapp', body: message, sent_by: req.user.name || 'WCA CRM',
      });
      await db.prepare(`INSERT INTO wa_messages (direction, phone_e164, contact_id, provider_message_id, body, status, sent_by)
        VALUES ('out',?,?,?,?,?,?)`)
        .run(contact.phone_e164 || '', contact.id, sent?.provider_message_id || null, message || '', sent?.status || 'sent', req.user.name || '');
      return res.json({ ok: true, ...sent });
    } catch (e) {
      return res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.message });
    }
  }
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

// Meetings related to a lead — i.e. meetings this lead is a participant of.
// Uses a subquery rather than a join so a lead listed twice on the same
// meeting can't duplicate the row.
app.get('/api/leads/:id/meetings', auth, async (req, res) => {
  const rows = await db.prepare(`
    SELECT * FROM meetings
    WHERE id IN (SELECT meeting_id FROM meeting_participants WHERE kind = 'lead' AND ref_id = ?)
    ORDER BY from_date DESC NULLS LAST, from_time DESC, id DESC
  `).all(req.params.id);
  res.json(await withRelations(rows));
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

// Answers whether the API can actually serve, not merely whether a process is
// running — it round-trips the database, since "up but can't reach Postgres"
// is the state that previously looked healthy while every login failed.
// Unauthenticated on purpose: a monitor shouldn't need a session.
app.get('/api/health', async (req, res) => {
  try {
    await db.prepare('SELECT 1 AS ok').get();
    res.json({ ok: true, service: 'WCA CRM API', db: 'up' });
  } catch (e) {
    res.status(503).json({ ok: false, service: 'WCA CRM API', db: 'down', error: e.message });
  }
});

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

// Task reminders are day-grained, so a 5-minute cadence is plenty to land
// close to the 09:00 mark without polling every minute.
setTimeout(checkTaskReminders, 25000);
setInterval(checkTaskReminders, 5 * 60 * 1000);
checkQuoteSendReminders();
setInterval(checkQuoteSendReminders, 5 * 60 * 1000);
checkRenewalMails();
setInterval(checkRenewalMails, 6 * 60 * 60 * 1000);

app.listen(PORT, () => console.log(`WCA CRM API running on http://localhost:${PORT}`));
