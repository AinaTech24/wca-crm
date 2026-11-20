// Dashboard panels: the open counts behind the overview cards, the person's own schedule, premium by
// day / week / month and the team leaderboard.
//
// Premium and the leaderboard count business the way the Business Report and Targets do: policies by their
// start date (period_from), gross premium, credited to the policy owner (assigned_to). Everything is scoped
// to the person's department unless they see all departments.

const TODAY = "(now() AT TIME ZONE 'Asia/Kolkata')::date";
const dayOf = (col) => `(CASE WHEN ${col} ~ '^\\d{4}-\\d{2}-\\d{2}' THEN substr(${col}, 1, 10)::date END)`;
const DONE_RENEWAL = "('Renewed','Renewed Elsewhere','Lost')";
const DEPTS = ['Personal Lines', 'Commercial Lines'];
const istDate = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 10);
const iso = (d) => d.toISOString().slice(0, 10);

// First and last day of this month / quarter / financial year (April to March), and of the one before.
function periodRange(period, back = 0) {
  const [y, m] = istDate().split('-').map(Number);
  let start, months;
  if (period === 'year') { const fy = m >= 4 ? y : y - 1; start = new Date(Date.UTC(fy - back, 3, 1)); months = 12; }
  else if (period === 'quarter') { const q0 = Math.floor((m - 1) / 3) * 3; start = new Date(Date.UTC(y, q0 - 3 * back, 1)); months = 3; }
  else { start = new Date(Date.UTC(y, m - 1 - back, 1)); months = 1; }
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 0));
  return { from: iso(start), to: iso(end) };
}

export function registerDashboardExtras(app, { db, auth, scope }) {
  const nameOf = async (req) => (await db.prepare("SELECT COALESCE(NULLIF(full_name, ''), username) AS name FROM users WHERE id = ?").get(req.user.id))?.name || '';
  // The department filter for someone who only sees one; `want` narrows an all-departments view on request.
  async function deptFilter(req, col = 'department', want = '') {
    const sc = await scope(req);
    if (!sc.all && sc.department && sc.department !== 'Both') return { sql: ` AND (${col} = ? OR ${col} IS NULL OR ${col} = '')`, p: [sc.department], dept: sc.department, locked: true };
    if (DEPTS.includes(want)) return { sql: ` AND ${col} = ?`, p: [want], dept: want, locked: false };
    return { sql: '', p: [], dept: '', locked: false };
  }
  const route = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) { console.error(`${req.path} failed:`, e.message); res.status(500).json({ error: 'Could not load this panel' }); }
  };

  app.get('/api/dashboard/overview', auth, route(async (req) => {
    const d = await deptFilter(req);
    const me = await nameOf(req);
    const one = async (sql, p = []) => Number((await db.prepare(sql).get(...p))?.c || 0);
    const [rfqs, rfqsMine, claims, tasks, overdue] = await Promise.all([
      one(`SELECT COUNT(*) c FROM rfqs WHERE COALESCE(status,'') NOT IN ('Closed','Lost')${d.sql}`, d.p),
      one("SELECT COUNT(*) c FROM rfqs WHERE COALESCE(status,'') NOT IN ('Closed','Lost') AND assigned_to = ?", [me]).catch(() => 0),
      one(`SELECT COUNT(*) c FROM claims WHERE COALESCE(status,'') NOT IN ('Settled','Rejected','Withdrawn','Closed')${d.sql}`, d.p),
      one("SELECT COUNT(*) c FROM tasks WHERE assigned_to = ? AND COALESCE(status,'') NOT IN ('Completed','Cancelled')", [me]),
      one(`SELECT COUNT(*) c FROM tasks WHERE assigned_to = ? AND COALESCE(status,'') NOT IN ('Completed','Cancelled') AND ${dayOf('due_date')} < ${TODAY}`, [me]),
    ]);
    return { rfqs, rfqsMine, claims, tasks, overdue };
  }));

  // What the person has coming up: their open tasks (overdue first), meetings they own or attend, and
  // renewals of their own policies in the next 7 days.
  app.get('/api/dashboard/schedule', auth, route(async (req) => {
    const me = await nameOf(req);
    const [tasks, meetings, renewals, quotes] = await Promise.all([
      db.prepare(`SELECT id, title, due_date, priority, ${dayOf('due_date')} < ${TODAY} AS overdue FROM tasks
        WHERE assigned_to = ? AND COALESCE(status,'') NOT IN ('Completed','Cancelled')
        ORDER BY ${dayOf('due_date')} NULLS LAST, id LIMIT 8`).all(me),
      db.prepare(`SELECT m.id, m.title, m.from_date, m.from_time, m.location FROM meetings m
        WHERE ${dayOf('m.from_date')} >= ${TODAY} AND COALESCE(m.status,'Scheduled') IN ('Scheduled','Rescheduled')
          AND (m.owner = ? OR EXISTS (SELECT 1 FROM meeting_participants p WHERE p.meeting_id = m.id AND p.kind = 'user' AND (p.ref_id = ? OR p.name = ?)))
        ORDER BY ${dayOf('m.from_date')}, m.from_time NULLS LAST, m.id LIMIT 8`).all(me, req.user.id, me),
      db.prepare(`SELECT id, insured_name, product_name, period_to FROM policies
        WHERE assigned_to = ? AND ${dayOf('period_to')} BETWEEN ${TODAY} AND ${TODAY} + 7 AND COALESCE(renewal_status,'Pending') NOT IN ${DONE_RENEWAL}
          AND renewable = 'Yes' AND COALESCE(policy_with_us, 'Yes') <> 'No' AND COALESCE(active_status, 'Active') <> 'Inactive' AND COALESCE(policy_status, '') NOT IN ('Cancelled', 'Lost')
        ORDER BY ${dayOf('period_to')}, id LIMIT 5`).all(me),
      db.prepare(`SELECT id, quote_no, version, client_name, valid_till, selected_insurer FROM quotations
        WHERE assigned_to = ? AND status = 'Shared' ORDER BY ${dayOf('valid_till')} NULLS LAST, id LIMIT 5`).all(me),
    ]);
    const items = [
      ...tasks.map((t) => ({ kind: 'task', id: t.id, title: t.title, date: (t.due_date || '').slice(0, 10), overdue: !!t.overdue, note: t.priority ? `${t.priority} priority` : 'Task', to: `/page/task?open=${t.id}` })),
      ...meetings.map((m) => ({ kind: 'meeting', id: m.id, title: m.title, date: (m.from_date || '').slice(0, 10), time: m.from_time || '', note: m.location || 'Meeting', to: `/page/meeting?open=${m.id}` })),
      ...quotes.map((q) => ({ kind: 'quote', id: q.id, title: `Quote reply — ${q.client_name}`, date: (q.valid_till || '').slice(0, 10), note: `${q.quote_no}${q.version > 1 ? ' v' + q.version : ''}${q.selected_insurer ? ' · ' + q.selected_insurer : ''} · valid till`, to: `/page/quotation?open=${q.id}` })),
      ...renewals.map((p) => ({ kind: 'renewal', id: p.id, title: `Renewal — ${p.insured_name}`, date: (p.period_to || '').slice(0, 10), note: p.product_name || 'Policy', to: `/page/policy?open=${p.id}` })),
    ];
    // Overdue tasks first, then by date; undated last.
    items.sort((a, b) => (b.overdue - a.overdue) || (a.date || '9999').localeCompare(b.date || '9999') || (a.time || '').localeCompare(b.time || ''));
    return { name: me, items: items.slice(0, 6), more: Math.max(items.length - 6, 0) };
  }));

  // Gross premium and policies for the last seven days / weeks / months, the current one last.
  app.get('/api/dashboard/trend', auth, route(async (req) => {
    const by = ['day', 'week', 'month'].includes(req.query.by) ? req.query.by : 'week';
    const d = await deptFilter(req, 'p.department');
    const rows = await db.prepare(`WITH b AS (
        SELECT generate_series(date_trunc('${by}', ${TODAY}::timestamp) - interval '6 ${by}', date_trunc('${by}', ${TODAY}::timestamp), interval '1 ${by}')::date AS s)
      SELECT to_char(b.s, 'YYYY-MM-DD') AS start, COALESCE(SUM(p.final_premium), 0)::float8 AS premium, COUNT(p.id)::int AS policies
      FROM b LEFT JOIN policies p ON date_trunc('${by}', ${dayOf('p.period_from')}::timestamp)::date = b.s AND COALESCE(p.policy_status, '') NOT IN ('Lost', 'Cancelled')${d.sql}
      GROUP BY b.s ORDER BY b.s`).all(...d.p);
    const next = (s) => {
      const t = new Date(s + 'T00:00:00Z');
      if (by === 'day') t.setUTCDate(t.getUTCDate() + 1); else if (by === 'week') t.setUTCDate(t.getUTCDate() + 7); else t.setUTCMonth(t.getUTCMonth() + 1);
      t.setUTCDate(t.getUTCDate() - 1);
      return iso(t);
    };
    return { by, rows: rows.map((r) => ({ ...r, end: next(r.start) })) };
  }));

  // Who has written the most business this month / quarter / financial year, with each person's place in
  // the period before so the board can show who moved up.
  app.get('/api/dashboard/leaderboard', auth, route(async (req) => {
    const period = ['month', 'quarter', 'year'].includes(req.query.period) ? req.query.period : 'month';
    const d = await deptFilter(req, 'department', req.query.dept);
    const board = async ({ from, to }) => db.prepare(`SELECT assigned_to AS name, COUNT(*)::int AS policies, COALESCE(SUM(final_premium), 0)::float8 AS premium
      FROM policies WHERE NULLIF(assigned_to, '') IS NOT NULL AND ${dayOf('period_from')} BETWEEN ?::date AND ?::date AND COALESCE(policy_status, '') NOT IN ('Lost', 'Cancelled')${d.sql}
      GROUP BY assigned_to ORDER BY premium DESC, policies DESC, assigned_to`).all(from, to, ...d.p);
    const cur = periodRange(period), prev = periodRange(period, 1);
    const [now, before, people, me] = await Promise.all([
      board(cur), board(prev),
      db.prepare("SELECT COALESCE(NULLIF(full_name, ''), username) AS name, department, role FROM users").all(),
      nameOf(req),
    ]);
    const prevRank = new Map(before.map((r, i) => [r.name, i + 1]));
    const rows = now.map((r, i) => {
      const u = people.find((p) => p.name === r.name);
      return { rank: i + 1, prev: prevRank.get(r.name) || null, name: r.name, department: u?.department || '', policies: r.policies, premium: r.premium, me: r.name === me };
    });
    const top = rows.slice(0, 5);
    const mine = rows.find((r) => r.me);
    return { period, ...cur, dept: d.dept, locked: d.locked, rows: mine && mine.rank > 5 ? [...top, mine] : top, total: rows.length };
  }));
}
