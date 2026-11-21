// Leave: anyone asks for time off; an admin approves or rejects it.
//
// Approving writes a Leave day into attendance for every working day the request covers (Sundays
// and days already marked Holiday are skipped), each pointing back through attendance.leave_id. A day
// the person actually checked in on is left alone and reported back, never overwritten. Cancelling an
// approved request takes out the Leave days it wrote. A half-day request writes nothing to attendance,
// because the person still checks in for the other half.

import { istNow, istToday } from './attendance.js';

export const LEAVE_TYPES = ['Casual Leave', 'Sick Leave', 'Earned Leave', 'Unpaid Leave', 'Other'];
const HALVES = ['', 'First half', 'Second half'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 90;

// Every date from..to inclusive, as YYYY-MM-DD, worked out in UTC so no time zone shifts a day.
function datesBetween(from, to) {
  const out = [];
  const d = new Date(from + 'T00:00:00Z'), end = new Date(to + 'T00:00:00Z');
  while (d <= end && out.length <= MAX_DAYS + 1) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}
const isSunday = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay() === 0;
const workingDays = (from, to) => datesBetween(from, to).filter((d) => !isSunday(d));
const fmt = (iso) => { const [y, m, d] = iso.split('-'); return `${d}-${m}-${y}`; };
const span = (r) => (r.from_date === r.to_date ? fmt(r.from_date) : `${fmt(r.from_date)} to ${fmt(r.to_date)}`);

const safe = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error('leave failed:', e.message);
  if (!res.headersSent) res.status(500).json({ error: 'Something went wrong with the leave request. Please try again.' });
});

// The yearly allowance per type (financial year, April to March). An admin can change it.
const DEFAULT_ALLOWANCE = { 'Casual Leave': 12, 'Sick Leave': 7, 'Earned Leave': 15 };
const fyOf = (iso) => { const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)); const s = m >= 4 ? y : y - 1; return { from: `${s}-04-01`, to: `${s + 1}-03-31`, label: `${s}-${String(s + 1).slice(2)}` }; };

export function registerLeave(app, { db, auth, emit, notify }) {
  const isAdmin = async (req) => (await db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id))?.role === 'admin';
  // An admin decides anyone's leave; a department head decides leave for their own department (not their own).
  const me = (req) => db.prepare('SELECT id, role, is_head, department FROM users WHERE id = ?').get(req.user.id);
  async function canDecide(req, r) {
    const u = await me(req);
    if (u?.role === 'admin') return true;
    if (Number(u?.is_head) !== 1 || !u.department || u.department === 'Both' || r.user_id === u.id) return false;
    const who = await db.prepare('SELECT department FROM users WHERE id = ?').get(r.user_id);
    return who?.department === u.department;
  }
  async function allowance() {
    try { const v = JSON.parse((await db.prepare("SELECT value FROM app_settings WHERE key = 'leave_allowance'").get())?.value || 'null'); if (v && typeof v === 'object') return v; } catch { /* default */ }
    return DEFAULT_ALLOWANCE;
  }
  async function balance(userId) {
    const fy = fyOf(istToday());
    const allow = await allowance();
    const rows = await db.prepare("SELECT leave_type, status, SUM(days)::float8 AS d FROM leave_requests WHERE user_id = ? AND from_date BETWEEN ? AND ? AND status IN ('Approved', 'Pending') GROUP BY leave_type, status").all(userId, fy.from, fy.to);
    return { year: fy.label, rows: LEAVE_TYPES.filter((t) => allow[t] !== undefined).map((t) => {
      const taken = rows.filter((r) => r.leave_type === t && r.status === 'Approved').reduce((s, r) => s + Number(r.d || 0), 0);
      const pending = rows.filter((r) => r.leave_type === t && r.status === 'Pending').reduce((s, r) => s + Number(r.d || 0), 0);
      return { type: t, allowed: Number(allow[t]) || 0, taken, pending, left: Math.max(0, (Number(allow[t]) || 0) - taken) };
    }) };
  }
  app.get('/api/attendance/leave/balance', auth, safe(async (req, res) => {
    let uid = req.user.id;
    if (req.query.user_id && Number(req.query.user_id) !== req.user.id) {
      if (!(await canDecide(req, { user_id: Number(req.query.user_id) }))) return res.status(403).json({ error: 'Not your team' });
      uid = Number(req.query.user_id);
    }
    res.json({ ...(await balance(uid)), allowance: await allowance() });
  }));
  app.put('/api/attendance/leave/allowance', auth, safe(async (req, res) => {
    if (!(await isAdmin(req))) return res.status(403).json({ error: 'Only an admin can set the leave allowance' });
    const v = {};
    for (const t of LEAVE_TYPES) if (req.body?.[t] !== undefined && req.body[t] !== '') v[t] = Math.max(0, Math.min(365, Number(req.body[t]) || 0));
    await db.prepare("INSERT INTO app_settings (key, value) VALUES ('leave_allowance', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(JSON.stringify(v));
    res.json(v);
  }));
  const nameOf = async (id) => {
    const u = await db.prepare("SELECT COALESCE(NULLIF(full_name,''), username) AS n FROM users WHERE id = ?").get(id);
    return u?.n || 'Someone';
  };
  // Leave changes attendance, so the attendance pages refresh on it too.
  const changed = () => emit('attendance', 'changed', {});
  const withNames = `SELECT l.*, COALESCE(NULLIF(u.full_name,''), u.username) AS user_name, u.department
    FROM leave_requests l JOIN users u ON u.id = l.user_id`;

  // Takes out the Leave days an approved request wrote, leaving any day the person checked in on.
  const removeLeaveDays = (id) => db.prepare("DELETE FROM attendance WHERE leave_id = ? AND status = 'Leave' AND check_in IS NULL").run(id);

  app.get('/api/attendance/leave/types', auth, (req, res) => res.json({ types: LEAVE_TYPES, halves: HALVES.filter(Boolean) }));

  // ---- the signed-in person's own requests ----
  app.get('/api/attendance/leave/mine', auth, safe(async (req, res) => {
    const rows = await db.prepare(`${withNames} WHERE l.user_id = ? ORDER BY l.from_date DESC, l.id DESC LIMIT 500`).all(req.user.id);
    res.json({ today: istToday(), rows });
  }));

  app.post('/api/attendance/leave', auth, safe(async (req, res) => {
    const b = req.body || {};
    const from = String(b.from_date || ''), to = String(b.to_date || b.from_date || '');
    if (!DATE_RE.test(from)) return res.status(400).json({ error: 'Choose the first day of leave' });
    if (!DATE_RE.test(to)) return res.status(400).json({ error: 'Choose the last day of leave' });
    if (to < from) return res.status(400).json({ error: 'The last day cannot be before the first day' });
    if (datesBetween(from, to).length > MAX_DAYS) return res.status(400).json({ error: `A single request can cover at most ${MAX_DAYS} days` });
    const type = LEAVE_TYPES.includes(b.leave_type) ? b.leave_type : null;
    if (!type) return res.status(400).json({ error: 'Choose the type of leave' });
    const half = HALVES.includes(b.half_day || '') ? (b.half_day || '') : '';
    if (half && from !== to) return res.status(400).json({ error: 'A half day can only be asked for on a single date' });
    const reason = String(b.reason || '').trim().slice(0, 500);
    if (!reason) return res.status(400).json({ error: 'Give a reason for the leave' });
    const days = half ? 0.5 : workingDays(from, to).length;
    if (!days) return res.status(400).json({ error: 'Those dates are all Sundays — there is nothing to take leave from' });

    const clash = await db.prepare(`SELECT from_date, to_date, status FROM leave_requests
      WHERE user_id = ? AND status IN ('Pending', 'Approved') AND from_date <= ? AND to_date >= ? LIMIT 1`).get(req.user.id, to, from);
    if (clash) return res.status(409).json({ error: `You already have ${clash.status === 'Pending' ? 'a pending' : 'an approved'} leave request for ${span(clash)}` });

    const bal = (await balance(req.user.id)).rows.find((x) => x.type === type);
    const over = bal && days > bal.left - bal.pending ? days - Math.max(0, bal.left - bal.pending) : 0;
    const info = await db.prepare('INSERT INTO leave_requests (user_id, from_date, to_date, leave_type, half_day, days, reason) VALUES (?,?,?,?,?,?,?)')
      .run(req.user.id, from, to, type, half, days, reason);
    const who = await nameOf(req.user.id);
    // The reason stays off the bell, which everyone sees: it can be medical.
    await notify({ entity: 'leave', kind: 'requested', icon: 'calendar', tone: 'info', refTable: 'leave_requests', refId: info.lastInsertRowid,
      title: 'Leave request', body: `${who} · ${type}${half ? ` (${half})` : ''} · ${span({ from_date: from, to_date: to })}${over ? ` · ${over} day(s) over the balance` : ''}`, link: '/page/attendance' });
    changed();
    res.json({ ...(await db.prepare(`${withNames} WHERE l.id = ?`).get(info.lastInsertRowid)), over_balance: over });
  }));

  // The person withdraws their own request: any time while it is pending, and once approved only before it starts.
  app.post('/api/attendance/leave/:id/cancel', auth, safe(async (req, res) => {
    const r = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(req.params.id);
    if (!r) return res.status(404).json({ error: 'Not found' });
    const admin = r.user_id !== req.user.id ? await canDecide(req, r) : await isAdmin(req);
    if (r.user_id !== req.user.id && !admin) return res.status(403).json({ error: 'You can only cancel your own leave' });
    if (!['Pending', 'Approved'].includes(r.status)) return res.status(400).json({ error: `This request is already ${r.status.toLowerCase()}` });
    if (r.status === 'Approved' && !admin && r.from_date <= istToday()) {
      return res.status(400).json({ error: 'This leave has already started. Ask an admin to cancel it.' });
    }
    await db.prepare("UPDATE leave_requests SET status = 'Cancelled', decided_by = ?, decided_at = ? WHERE id = ?").run(req.user.name || '', istNow(), r.id);
    if (r.status === 'Approved') await removeLeaveDays(r.id);
    changed();
    res.json({ ok: true });
  }));

  // ---- admin: everyone's requests ----
  app.get('/api/attendance/leave', auth, safe(async (req, res) => {
    const u = await me(req);
    const head = Number(u?.is_head) === 1 && u.department && u.department !== 'Both';
    if (u?.role !== 'admin' && !head) return res.status(403).json({ error: 'Only an admin or a department head can see the team\'s leave' });
    const p = [];
    let where = '1=1';
    if (u.role !== 'admin') { where += ' AND u.department = ? AND l.user_id <> ?'; p.push(u.department, u.id); }
    if (req.query.status && req.query.status !== 'all') { where += ' AND l.status = ?'; p.push(String(req.query.status)); }
    if (req.query.user_id) { where += ' AND l.user_id = ?'; p.push(Number(req.query.user_id) || 0); }
    const rows = await db.prepare(`${withNames} WHERE ${where} ORDER BY (l.status = 'Pending') DESC, l.from_date DESC, l.id DESC LIMIT 1000`).all(...p);
    const pending = rows.filter((r) => r.status === 'Pending').length || Number((await db.prepare(`SELECT COUNT(*) c FROM leave_requests l JOIN users u ON u.id = l.user_id WHERE l.status = 'Pending'${u.role !== 'admin' ? ' AND u.department = ? AND l.user_id <> ?' : ''}`).get(...(u.role !== 'admin' ? [u.department, u.id] : []))).c);
    res.json({ today: istToday(), pending, rows });
  }));

  app.post('/api/attendance/leave/:id/decide', auth, safe(async (req, res) => {
    const decision = req.body?.decision;
    if (!['Approved', 'Rejected'].includes(decision)) return res.status(400).json({ error: 'Approve or reject the request' });
    const note = String(req.body?.note || '').trim().slice(0, 300);
    const r = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(req.params.id);
    if (!r) return res.status(404).json({ error: 'Not found' });
    if (!(await canDecide(req, r))) return res.status(403).json({ error: 'Only an admin, or the head of their department, can decide this leave' });
    if (r.status !== 'Pending') return res.status(409).json({ error: `This request was already ${r.status.toLowerCase()}${r.decided_by ? ' by ' + r.decided_by : ''}` });
    const by = req.user.name || '';
    // Only one admin's decision lands, even if two press at the same moment.
    const upd = await db.prepare("UPDATE leave_requests SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ? AND status = 'Pending'")
      .run(decision, by, istNow(), note, r.id);
    if (!upd.changes) return res.status(409).json({ error: 'Someone else has just decided this request' });

    const result = { ok: true, marked: 0, skipped: [] };
    if (decision === 'Approved' && !r.half_day) {
      const label = `${r.leave_type} — approved by ${by || 'admin'}`;
      for (const day of workingDays(r.from_date, r.to_date)) {
        const cur = await db.prepare('SELECT * FROM attendance WHERE user_id = ? AND work_date = ?').get(r.user_id, day);
        if (cur?.check_in) { result.skipped.push({ date: day, why: 'checked in that day' }); continue; }
        if (cur?.status === 'Holiday') { result.skipped.push({ date: day, why: 'a holiday' }); continue; }
        if (cur) {
          await db.prepare("UPDATE attendance SET status = 'Leave', note = ?, leave_id = ?, edited_by = ?, edited_at = ? WHERE id = ?").run(label, r.id, by, istNow(), cur.id);
        } else {
          await db.prepare("INSERT INTO attendance (user_id, work_date, status, note, leave_id, edited_by, edited_at) VALUES (?,?,'Leave',?,?,?,?)")
            .run(r.user_id, day, label, r.id, by, istNow());
        }
        result.marked++;
      }
    }
    const who = await nameOf(r.user_id);
    await notify({ entity: 'leave', kind: decision.toLowerCase(), icon: 'calendar', tone: decision === 'Approved' ? 'success' : 'danger',
      refTable: 'leave_requests', refId: r.id, title: `Leave ${decision.toLowerCase()}`,
      body: `${who} · ${r.leave_type}${r.half_day ? ` (${r.half_day})` : ''} · ${span(r)}${by ? ` · by ${by}` : ''}`, link: '/page/attendance' });
    changed();
    res.json(result);
  }));
}
