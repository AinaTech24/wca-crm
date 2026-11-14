// Monthly targets per person (premium and number of policies) and how far each has got.
//
// Achievement is counted the way the Business Report counts: policies owned by the person whose start date
// falls in the month, gross premium. An admin sets targets; a department head sees their department; anyone
// else sees their own line.

const MONTH_RE = /^\d{4}-\d{2}$/;
const monthRange = (m) => { const [y, mo] = m.split('-').map(Number); return { from: `${m}-01`, to: new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10) }; };
const thisMonth = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 7);

export function registerTargets(app, { db, auth, scope }) {
  const me = async (req) => db.prepare("SELECT id, role, is_head, department, COALESCE(NULLIF(full_name, ''), username) AS name FROM users WHERE id = ?").get(req.user.id);

  async function rowsFor(month, u) {
    const { from, to } = monthRange(month);
    let people = await db.prepare("SELECT COALESCE(NULLIF(full_name, ''), username) AS name, department FROM users ORDER BY 1").all();
    if (u.role !== 'admin') people = Number(u.is_head) === 1 && u.department && u.department !== 'Both' ? people.filter((p) => p.department === u.department || p.name === u.name) : people.filter((p) => p.name === u.name);
    const targets = await db.prepare('SELECT * FROM targets WHERE month = ?').all(month);
    const done = await db.prepare(`SELECT assigned_to AS name, COUNT(*) AS policies, COALESCE(SUM(final_premium), 0)::float8 AS premium FROM policies
      WHERE period_from ~ '^\\d{4}-\\d{2}-\\d{2}' AND substr(period_from, 1, 10) BETWEEN ? AND ? GROUP BY assigned_to`).all(from, to);
    return people.map((p) => {
      const t = targets.find((x) => x.user_name === p.name) || {};
      const d = done.find((x) => x.name === p.name) || {};
      const pt = Number(t.premium_target) || 0, ct = Number(t.policies_target) || 0;
      return {
        user_name: p.name, department: p.department || '',
        premium_target: pt, policies_target: ct, premium_done: Number(d.premium) || 0, policies_done: Number(d.policies) || 0,
        premium_pct: pt ? Math.round(((Number(d.premium) || 0) / pt) * 100) : null, policies_pct: ct ? Math.round(((Number(d.policies) || 0) / ct) * 100) : null,
      };
    });
  }

  app.get('/api/targets', auth, async (req, res) => {
    const month = MONTH_RE.test(req.query.month || '') ? req.query.month : thisMonth();
    const u = await me(req);
    res.json({ month, ...monthRange(month), canEdit: u.role === 'admin', rows: await rowsFor(month, u) });
  });
  // The signed-in person's own month, for the dashboard.
  app.get('/api/targets/me', auth, async (req, res) => {
    const month = thisMonth();
    const u = await me(req);
    const row = (await rowsFor(month, { ...u, role: 'user', is_head: 0 }))[0] || null;
    res.json({ month, ...monthRange(month), row: row && (row.premium_target || row.policies_target) ? row : null });
  });
  app.put('/api/targets', auth, async (req, res) => {
    const u = await me(req);
    if (u.role !== 'admin') return res.status(403).json({ error: 'Only an admin can set targets' });
    const b = req.body || {};
    if (!MONTH_RE.test(b.month || '')) return res.status(400).json({ error: 'Choose the month' });
    const name = String(b.user_name || '').trim();
    if (!name) return res.status(400).json({ error: 'Choose the person' });
    const prem = Number(b.premium_target) || 0, pols = Math.round(Number(b.policies_target) || 0);
    if (prem < 0 || pols < 0) return res.status(400).json({ error: 'Targets cannot be negative' });
    await db.prepare(`INSERT INTO targets (month, user_name, premium_target, policies_target) VALUES (?, ?, ?, ?)
      ON CONFLICT (month, user_name) DO UPDATE SET premium_target = excluded.premium_target, policies_target = excluded.policies_target`).run(b.month, name, prem, pols);
    res.json({ ok: true });
  });
  // Next month's targets usually start from this month's.
  app.post('/api/targets/copy', auth, async (req, res) => {
    const u = await me(req);
    if (u.role !== 'admin') return res.status(403).json({ error: 'Only an admin can set targets' });
    const { from, to } = req.body || {};
    if (!MONTH_RE.test(from || '') || !MONTH_RE.test(to || '')) return res.status(400).json({ error: 'Choose both months' });
    const r = await db.prepare(`INSERT INTO targets (month, user_name, premium_target, policies_target)
      SELECT ?, user_name, premium_target, policies_target FROM targets WHERE month = ?
      ON CONFLICT (month, user_name) DO NOTHING`).run(to, from);
    res.json({ copied: r.changes });
  });
}
