// Attendance: check in / check out, each person's history, and the admin's control over everyone's.
//
// One record per person per day. A day is Present (with a check-in and, later, a check-out) or one
// the admin marked Absent, Leave or Holiday. Times are Indian Standard Time and stored as plain
// 'YYYY-MM-DD HH:MM:SS' text like the rest of the app's dates, whatever zone the server runs in.
//
// Late and Half day are worked out when a row is read, from the office hours the admin has set, never
// stored: change the office start time and the history reads differently straight away.

const TZ = 'Asia/Kolkata';
const stamp = (d = new Date()) => d.toLocaleString('sv-SE', { timeZone: TZ });   // 2026-11-05 14:03:11
export const istNow = () => stamp();
export const istToday = () => stamp().slice(0, 10);

export const STATUSES = ['Present', 'Absent', 'Leave', 'Holiday'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const DEFAULTS = { office_start: '09:30', grace_minutes: 15, min_hours: 8, require_location: true };
const KEY = { office_start: 'attendance_office_start', grace_minutes: 'attendance_grace_minutes', min_hours: 'attendance_min_hours', require_location: 'attendance_require_location' };

export async function getSettings(db) {
  const rows = await db.prepare(`SELECT key, value FROM app_settings WHERE key IN (${Object.values(KEY).map(() => '?').join(',')})`).all(...Object.values(KEY));
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const start = TIME_RE.test(m[KEY.office_start] || '') ? m[KEY.office_start] : DEFAULTS.office_start;
  const grace = Number(m[KEY.grace_minutes]);
  const hours = Number(m[KEY.min_hours]);
  return {
    office_start: start,
    grace_minutes: Number.isFinite(grace) && grace >= 0 ? grace : DEFAULTS.grace_minutes,
    min_hours: Number.isFinite(hours) && hours > 0 ? hours : DEFAULTS.min_hours,
    // On unless an admin has switched it off: no check-in or check-out without the person's location.
    require_location: m[KEY.require_location] === undefined ? DEFAULTS.require_location : m[KEY.require_location] !== '0',
  };
}

// The address for a position, from OpenStreetMap's Nominatim, or '' when it can't be had in a few
// seconds. Only coordinates are sent. GEOCODE_URL points it elsewhere; "off" turns lookups off.
const GEOCODE_URL = (process.env.GEOCODE_URL ?? 'https://nominatim.openstreetmap.org/reverse').trim();
export async function placeName(lat, lng) {
  if (!GEOCODE_URL || GEOCODE_URL === 'off') return '';
  try {
    const url = `${GEOCODE_URL}?format=jsonv2&zoom=18&addressdetails=0&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'WCA-CRM attendance (crm.wecareassurance.com)', 'Accept-Language': 'en' }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return '';
    const j = await r.json();
    return String(j?.display_name || '').replace(/, India$/, '').slice(0, 240);
  } catch { return ''; }
}

const toMin = (hhmm) => { const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number); return h * 60 + m; };
const minOfStamp = (s) => toMin(String(s).slice(11, 16));
const hhmm = (s) => String(s || '').slice(11, 16);

/** A stored row with what it means under the current office hours. */
export function decorate(r, st, today) {
  const out = { ...r, arrival: '', late_by: 0, worked_minutes: null, result: '' };
  if (r.status !== 'Present') { out.result = r.status; return out; }
  if (r.check_in) {
    const after = minOfStamp(r.check_in) - toMin(st.office_start);
    out.arrival = after > st.grace_minutes ? 'Late' : 'On time';
    out.late_by = out.arrival === 'Late' ? after : 0;
  }
  if (r.check_in && r.check_out) {
    out.worked_minutes = Math.max(0, minOfStamp(r.check_out) - minOfStamp(r.check_in));
    out.result = out.worked_minutes >= st.min_hours * 60 ? 'Full day' : 'Half day';
  } else if (r.check_in) {
    out.result = r.work_date < today ? 'No check-out' : 'In progress';
  }
  return out;
}

/** Totals for a set of decorated rows (one person's, normally). */
export function summarise(rows) {
  const s = { present: 0, late: 0, half_days: 0, no_checkout: 0, absent: 0, leave: 0, holiday: 0, minutes: 0, completed: 0 };
  for (const r of rows) {
    if (r.status === 'Absent') s.absent++;
    else if (r.status === 'Leave') s.leave++;
    else if (r.status === 'Holiday') s.holiday++;
    else if (r.check_in) {
      s.present++;
      if (r.arrival === 'Late') s.late++;
      if (r.result === 'Half day') s.half_days++;
      if (r.result === 'No check-out') s.no_checkout++;
      if (r.worked_minutes != null) { s.minutes += r.worked_minutes; s.completed++; }
    }
  }
  s.avg_minutes = s.completed ? Math.round(s.minutes / s.completed) : 0;
  return s;
}

// A position the browser reported, or null when there is none or it is not believable.
function readLocation(b) {
  if (b?.lat == null || b?.lng == null || b.lat === '' || b.lng === '') return null;
  const lat = Number(b.lat), lng = Number(b.lng), acc = Number(b.accuracy);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, acc: Number.isFinite(acc) ? Math.round(acc) : null };
}

// Express 4 does not catch a rejected async handler, and one bad request must not stop the API.
const safe = (fn) => (req, res) => fn(req, res).catch((e) => {
  console.error('attendance failed:', e.message);
  if (!res.headersSent) res.status(500).json({ error: 'Something went wrong with attendance. Please try again.' });
});

export function registerAttendance(app, { db, auth, emit }) {
  // Admin-only routes say so in attendance's own words.
  async function requireAdmin(req, res) {
    const me = await db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id);
    if (me?.role === 'admin') return true;
    res.status(403).json({ error: 'Only an admin can do that.' });
    return false;
  }
  const changed = (user_id, work_date) => emit('attendance', 'changed', { user_id, work_date });   // no row: it carries locations
  const range = (q) => {
    const today = istToday();
    const d = new Date(); d.setDate(d.getDate() - 30);
    const from = DATE_RE.test(q.from || '') ? q.from : stamp(d).slice(0, 10);
    const to = DATE_RE.test(q.to || '') ? q.to : today;
    return { from, to };
  };
  const mapRows = (rows, st) => { const today = istToday(); return rows.map((r) => decorate(r, st, today)); };

  // ---- settings ----
  app.get('/api/attendance/settings', auth, safe(async (req, res) => res.json(await getSettings(db))));
  app.put('/api/attendance/settings', auth, safe(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const b = req.body || {};
    const cur = await getSettings(db);
    const start = b.office_start ?? cur.office_start;
    const grace = b.grace_minutes === '' || b.grace_minutes == null ? cur.grace_minutes : Number(b.grace_minutes);
    const hours = b.min_hours === '' || b.min_hours == null ? cur.min_hours : Number(b.min_hours);
    if (!TIME_RE.test(start)) return res.status(400).json({ error: 'Office start time should look like 09:30' });
    if (!Number.isFinite(grace) || grace < 0 || grace > 240) return res.status(400).json({ error: 'Grace period should be between 0 and 240 minutes' });
    if (!Number.isFinite(hours) || hours <= 0 || hours > 16) return res.status(400).json({ error: 'Minimum hours should be between 1 and 16' });
    const put = (k, v) => db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(k, String(v));
    await put(KEY.office_start, start); await put(KEY.grace_minutes, Math.round(grace)); await put(KEY.min_hours, hours);
    if (b.require_location !== undefined) await put(KEY.require_location, b.require_location ? '1' : '0');
    emit('attendance', 'changed', {});
    res.json(await getSettings(db));
  }));

  // ---- the signed-in person's own day and history ----
  app.get('/api/attendance/mine', auth, safe(async (req, res) => {
    const st = await getSettings(db);
    const today = istToday();
    const { from, to } = range(req.query);
    const rows = mapRows(await db.prepare('SELECT * FROM attendance WHERE user_id = ? AND work_date BETWEEN ? AND ? ORDER BY work_date DESC').all(req.user.id, from, to), st);
    const todayRow = await db.prepare('SELECT * FROM attendance WHERE user_id = ? AND work_date = ?').get(req.user.id, today);
    res.json({ settings: st, now: istNow(), today: todayRow ? decorate(todayRow, st, today) : null, from, to, rows, summary: summarise(rows) });
  }));

  // A missing location, in words the person can act on.
  const NO_LOCATION = 'Your location is needed. Allow location access for this site in the browser (the pin or lock icon in the address bar), turn on location on your phone or laptop, then try again.';
  // Looks the address up after the reply has gone, so checking in never waits on it, then tells open pages.
  const fillAddress = (id, col, loc, userId, day) => {
    if (!loc) return;
    placeName(loc.lat, loc.lng).then(async (addr) => {
      if (!addr) return;
      await db.prepare(`UPDATE attendance SET ${col} = ? WHERE id = ?`).run(addr, id);
      changed(userId, day);
    }).catch((e) => console.error('attendance address failed:', e.message));
  };

  app.post('/api/attendance/check-in', auth, safe(async (req, res) => {
    const today = istToday(), now = istNow();
    const loc = readLocation(req.body);
    if (!loc && (await getSettings(db)).require_location) return res.status(400).json({ error: NO_LOCATION, needLocation: true });
    const cur = await db.prepare('SELECT * FROM attendance WHERE user_id = ? AND work_date = ?').get(req.user.id, today);
    if (cur && cur.status !== 'Present') return res.status(400).json({ error: cur.leave_id
      ? 'You are on approved leave today. Ask an admin to cancel the leave if you are working.'
      : `Today is marked ${cur.status} by an admin. Ask them if that is wrong.` });
    if (cur?.check_in) return res.status(409).json({ error: `You already checked in today at ${hhmm(cur.check_in)}.` });
    try {
      if (cur) {
        await db.prepare('UPDATE attendance SET check_in = ?, in_lat = ?, in_lng = ?, in_acc = ?, in_address = NULL WHERE id = ?').run(now, loc?.lat ?? null, loc?.lng ?? null, loc?.acc ?? null, cur.id);
      } else {
        await db.prepare('INSERT INTO attendance (user_id, work_date, status, check_in, in_lat, in_lng, in_acc) VALUES (?,?,?,?,?,?,?)')
          .run(req.user.id, today, 'Present', now, loc?.lat ?? null, loc?.lng ?? null, loc?.acc ?? null);
      }
    } catch (e) {
      if (e.code === '23505') return res.status(409).json({ error: 'You already checked in today.' });   // a double click
      throw e;
    }
    changed(req.user.id, today);
    const st = await getSettings(db);
    const row = await db.prepare('SELECT * FROM attendance WHERE user_id = ? AND work_date = ?').get(req.user.id, today);
    res.json(decorate(row, st, today));
    fillAddress(row.id, 'in_address', loc, req.user.id, today);
  }));

  app.post('/api/attendance/check-out', auth, safe(async (req, res) => {
    const today = istToday(), now = istNow();
    const loc = readLocation(req.body);
    if (!loc && (await getSettings(db)).require_location) return res.status(400).json({ error: NO_LOCATION, needLocation: true });
    const cur = await db.prepare('SELECT * FROM attendance WHERE user_id = ? AND work_date = ?').get(req.user.id, today);
    if (!cur?.check_in) return res.status(400).json({ error: 'You have not checked in today.' });
    if (cur.check_out) return res.status(409).json({ error: `You already checked out today at ${hhmm(cur.check_out)}.` });
    await db.prepare('UPDATE attendance SET check_out = ?, out_lat = ?, out_lng = ?, out_acc = ?, out_address = NULL WHERE id = ?').run(now, loc?.lat ?? null, loc?.lng ?? null, loc?.acc ?? null, cur.id);
    changed(req.user.id, today);
    const st = await getSettings(db);
    res.json(decorate(await db.prepare('SELECT * FROM attendance WHERE id = ?').get(cur.id), st, today));
    fillAddress(cur.id, 'out_address', loc, req.user.id, today);
  }));

  // ---- admin: everyone ----
  app.get('/api/attendance/all', auth, safe(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const st = await getSettings(db);
    const { from, to } = range(req.query);
    const p = [from, to];
    let where = 'a.work_date BETWEEN ? AND ?';
    if (req.query.user_id) { where += ' AND a.user_id = ?'; p.push(Number(req.query.user_id) || 0); }
    const rows = await db.prepare(`SELECT a.*, COALESCE(NULLIF(u.full_name,''), u.username) AS user_name, u.department
      FROM attendance a JOIN users u ON u.id = a.user_id WHERE ${where} ORDER BY a.work_date DESC, user_name LIMIT 5000`).all(...p);
    res.json({ settings: st, from, to, rows: mapRows(rows, st) });
  }));

  // Who is in, who is out and who has not turned up on a day (today unless asked), every user listed.
  app.get('/api/attendance/board', auth, safe(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const st = await getSettings(db);
    const date = DATE_RE.test(req.query.date || '') ? req.query.date : istToday();
    const rows = await db.prepare(`SELECT u.id AS uid, COALESCE(NULLIF(u.full_name,''), u.username) AS user_name, u.department, a.*
      FROM users u LEFT JOIN attendance a ON a.user_id = u.id AND a.work_date = ? ORDER BY user_name`).all(date);
    const today = istToday();
    res.json({ settings: st, date, now: istNow(), users: rows.map((r) => ({
      user_id: r.uid, user_name: r.user_name, department: r.department,
      record: r.id ? decorate({ ...r, user_id: r.uid }, st, today) : null,
    })) });
  }));

  // Reads and checks the fields an admin can set on a day.
  function readEntry(b, existing) {
    const status = b.status ?? existing?.status ?? 'Present';
    if (!STATUSES.includes(status)) return { error: 'Status should be Present, Absent, Leave or Holiday' };
    const date = existing?.work_date || b.work_date;
    if (!DATE_RE.test(date || '')) return { error: 'Choose the date' };
    const note = String(b.note ?? existing?.note ?? '').slice(0, 300);
    if (status !== 'Present') return { value: { status, work_date: date, check_in: null, check_out: null, note } };
    const tIn = b.check_in !== undefined ? b.check_in : hhmm(existing?.check_in);
    const tOut = b.check_out !== undefined ? b.check_out : hhmm(existing?.check_out);
    if (!TIME_RE.test(tIn || '')) return { error: 'Give the check-in time, like 09:40' };
    if (tOut && !TIME_RE.test(tOut)) return { error: 'Check-out time should look like 18:05' };
    if (tOut && toMin(tOut) <= toMin(tIn)) return { error: 'Check-out has to be after check-in' };
    return { value: { status, work_date: date, check_in: `${date} ${tIn}:00`, check_out: tOut ? `${date} ${tOut}:00` : null, note } };
  }

  app.post('/api/attendance', auth, safe(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const b = req.body || {};
    const user = await db.prepare('SELECT id FROM users WHERE id = ?').get(Number(b.user_id) || 0);
    if (!user) return res.status(400).json({ error: 'Choose who this is for' });
    const e = readEntry(b, null);
    if (e.error) return res.status(400).json({ error: e.error });
    const v = e.value;
    try {
      const info = await db.prepare('INSERT INTO attendance (user_id, work_date, status, check_in, check_out, note, edited_by, edited_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(user.id, v.work_date, v.status, v.check_in, v.check_out, v.note, req.user.name || '', istNow());
      changed(user.id, v.work_date);
      res.json({ id: info.lastInsertRowid });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'That person already has an entry for this date. Edit it instead.' });
      throw err;
    }
  }));

  app.put('/api/attendance/:id', auth, safe(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const cur = await db.prepare('SELECT * FROM attendance WHERE id = ?').get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    const e = readEntry(req.body || {}, cur);
    if (e.error) return res.status(400).json({ error: e.error });
    const v = e.value;
    // A day turned into Absent / Leave / Holiday carries no times or places any more.
    const clearPlaces = v.status !== 'Present';
    await db.prepare(`UPDATE attendance SET status = ?, check_in = ?, check_out = ?, note = ?, edited_by = ?, edited_at = ?${clearPlaces ? ', in_lat = NULL, in_lng = NULL, in_acc = NULL, out_lat = NULL, out_lng = NULL, out_acc = NULL, in_address = NULL, out_address = NULL' : ''} WHERE id = ?`)
      .run(v.status, v.check_in, v.check_out, v.note, req.user.name || '', istNow(), cur.id);
    changed(cur.user_id, cur.work_date);
    res.json({ ok: true });
  }));

  app.delete('/api/attendance/:id', auth, safe(async (req, res) => {
    if (!(await requireAdmin(req, res))) return;
    const cur = await db.prepare('SELECT user_id, work_date FROM attendance WHERE id = ?').get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    await db.prepare('DELETE FROM attendance WHERE id = ?').run(req.params.id);
    changed(cur.user_id, cur.work_date);
    res.json({ ok: true });
  }));
}
