// Runs the reports defined in reports.js: grouped figures (one or two levels, or a matrix), the
// same period earlier for comparison, a month-by-month trend, a funnel, the records behind any
// number, and the values a filter can pick from. Used by the Reports page and by scheduled reports.
//
// Nothing from a request becomes SQL: dimensions, metrics and filter fields are only ever looked up
// by key in the report's own definition, and every value travels as a parameter.

import { reportSpec, recordView, dateFilter, isoDate } from './reports.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TZ = 'Asia/Kolkata';
const istToday = () => new Date().toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 10);
const iso = (d) => d.toISOString().slice(0, 10);
const day = (s) => new Date(s + 'T00:00:00Z');
const addDays = (s, n) => { const d = day(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const addYears = (s, n) => { const [y, m, dd] = s.split('-').map(Number); const d = new Date(Date.UTC(y + n, m - 1, dd)); if (d.getUTCMonth() !== m - 1) d.setUTCDate(0); return iso(d); };

/** A named period ('this-month', 'last-fy', …) as dates, in Indian time — the same names the page uses. */
export function presetRange(key, today = istToday()) {
  const [y, m] = today.split('-').map(Number);
  const monthStart = (yy, mm) => iso(new Date(Date.UTC(yy, mm - 1, 1)));
  const monthEnd = (yy, mm) => iso(new Date(Date.UTC(yy, mm, 0)));
  const fyStart = m >= 4 ? y : y - 1;
  switch (key) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const d = addDays(today, -1); return { from: d, to: d }; }
    case 'last-7': return { from: addDays(today, -6), to: today };
    case 'this-week': { const dow = (day(today).getUTCDay() + 6) % 7; return { from: addDays(today, -dow), to: addDays(today, 6 - dow) }; }
    case 'last-week': { const dow = (day(today).getUTCDay() + 6) % 7; return { from: addDays(today, -dow - 7), to: addDays(today, -dow - 1) }; }
    case 'this-month': return { from: monthStart(y, m), to: monthEnd(y, m) };
    case 'last-month': return { from: monthStart(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1), to: monthEnd(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1) };
    case 'this-quarter': { const q = Math.floor((m - 1) / 3); return { from: monthStart(y, q * 3 + 1), to: monthEnd(y, q * 3 + 3) }; }
    case 'this-fy': return { from: `${fyStart}-04-01`, to: `${fyStart + 1}-03-31` };
    case 'last-fy': return { from: `${fyStart - 1}-04-01`, to: `${fyStart}-03-31` };
    case 'last-12': return { from: monthStart(m === 12 ? y : y - 1, m === 12 ? 1 : m + 1), to: today };
    default: return null;
  }
}

/** The period a comparison is made against: the same length just before, or the same dates a year earlier. */
export function compareRange(from, to, cmp) {
  if (cmp === 'yoy') return { from: addYears(from, -1), to: addYears(to, -1) };
  if (cmp === 'prev') {
    // Whole months compare with the same number of whole months before (Apr–Jun with Jan–Mar),
    // anything else with the same number of days before.
    const isMonthStart = from.endsWith('-01');
    const isMonthEnd = addDays(to, 1).endsWith('-01');
    if (isMonthStart && isMonthEnd) {
      const [fy, fm] = from.split('-').map(Number); const [ty, tm] = to.split('-').map(Number);
      const months = (ty - fy) * 12 + (tm - fm) + 1;
      const start = new Date(Date.UTC(fy, fm - 1 - months, 1));
      const end = new Date(Date.UTC(fy, fm - 1, 0));
      return { from: iso(start), to: iso(end) };
    }
    const days = Math.round((day(to) - day(from)) / 86400000) + 1;
    return { from: addDays(from, -days), to: addDays(from, -1) };
  }
  return null;
}

// Who may open a report. An admin always may. Admin-only reports (attendance, leave) are for admins; any
// other report an admin has limited to named people (Reports → Access) is for those people only.
export async function reportAccess(db) {
  const r = await db.prepare("SELECT value FROM app_settings WHERE key = 'report_access'").get();
  try { const v = JSON.parse(r?.value || '{}'); return { kinds: v.kinds || {}, exporters: Array.isArray(v.exporters) ? v.exporters : null }; } catch { return { kinds: {}, exporters: null }; }
}
export async function canSee(db, kind, sc) {
  const spec = reportSpec(kind);
  if (!spec) return false;
  if (sc?.role === 'admin') return true;
  if (spec.adminOnly) return false;
  const acc = await reportAccess(db);
  const list = acc.kinds[kind];
  return !Array.isArray(list) || list.includes(Number(sc?.userId));
}

/** Reads and checks what a request asks for, keeping only keys the report defines. */
export function readParams(spec, q = {}) {
  let from = DATE_RE.test(q.from || '') ? q.from : null;
  let to = DATE_RE.test(q.to || '') ? q.to : null;
  if ((!from || !to) && q.preset) { const r = presetRange(q.preset); if (r) ({ from, to } = r); }
  from = from || '1900-01-01'; to = to || '2999-12-31';
  if (to < from) [from, to] = [to, from];
  const g = spec.dims[q.g || q.groupBy] ? (q.g || q.groupBy) : spec.defaultDim;
  const g2 = spec.dims[q.g2] && q.g2 !== g ? q.g2 : null;
  let raw = q.f;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = {}; } }
  const filters = {};
  for (const [k, v] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    if (!spec.dims[k]) continue;
    const vals = (Array.isArray(v) ? v : [v]).map((x) => String(x)).filter((x) => x.length <= 300).slice(0, 100);
    if (vals.length) filters[k] = vals;
  }
  const cmp = ['prev', 'yoy'].includes(q.cmp) ? q.cmp : '';
  return { from, to, g, g2, filters, cmp };
}

const val = (dim) => `COALESCE((${dim.sql}), 'Unspecified')`;

// WHERE for a report over a period: dates, the report's own fixed filter, the department limit, the filters.
function where(spec, p, sc, from = p.from, to = p.to) {
  const params = [from, to];
  let sql = `WHERE ${dateFilter(spec.dateCol)}`;
  if (spec.where) sql += ` AND (${spec.where})`;
  const scoped = spec.scoped && sc && !sc.all && !!sc.department;
  // Rows with no department predate the split, so they stay visible — the rule the rest of the app uses.
  if (scoped) { sql += " AND (department = ? OR department IS NULL OR department = '')"; params.push(sc.department); }
  for (const [k, vals] of Object.entries(p.filters)) {
    sql += ` AND ${val(spec.dims[k])} IN (${vals.map(() => '?').join(',')})`;
    params.push(...vals);
  }
  return { sql, params, scoped };
}

/** Everything the report page shows, in one call. */
export async function runReport(db, kind, q, sc) {
  const spec = reportSpec(kind);
  if (!spec) return null;
  if (!(await canSee(db, kind, sc))) return { forbidden: true };
  const p = readParams(spec, q);
  const metricSql = spec.metrics.map((m) => `${m.sql} AS ${m.key}`).join(', ');
  const d1 = spec.dims[p.g], d2 = p.g2 ? spec.dims[p.g2] : null;
  const order = `${spec.sortBy} DESC NULLS LAST`;

  async function figures(from, to) {
    const w = where(spec, p, sc, from, to);
    const rows = await db.prepare(`SELECT ${val(d1)} AS label, ${metricSql} FROM ${spec.table} ${w.sql}
      GROUP BY 1 ORDER BY ${order}, label LIMIT 1000`).all(...w.params);
    // Totals are queried, not summed from the rows: an average or a share has to be worked out over the whole set.
    const totals = await db.prepare(`SELECT ${metricSql} FROM ${spec.table} ${w.sql}`).get(...w.params);
    return { rows, totals, scoped: w.scoped };
  }

  const cur = await figures(p.from, p.to);
  const out = {
    kind, label: spec.label, dateLabel: spec.dateLabel, from: p.from, to: p.to,
    groupBy: p.g, groupLabel: d1.label, groupBy2: p.g2, groupLabel2: d2?.label || null,
    dims: Object.entries(spec.dims).map(([key, d]) => ({ key, label: d.label })),
    columns: spec.metrics.map((m) => ({ key: m.key, label: m.label, kind: m.kind, drill: !!m.cond })),
    filters: p.filters, rows: cur.rows, totals: cur.totals,
    scope: { applied: cur.scoped, department: cur.scoped ? sc.department : null },
    funnel: spec.funnel ? { dim: 'status', order: spec.funnel } : null,
  };

  const w = where(spec, p, sc);
  // Rows the date filter can't place, so a partial report is never read as a complete one.
  const und = where(spec, p, sc);
  out.undated = Number((await db.prepare(`SELECT COUNT(*) c FROM ${spec.table} ${und.sql.replace(dateFilter(spec.dateCol), `${isoDate(spec.dateCol)} IS NULL`)}`)
    .get(...und.params.slice(2))).c);

  if (d2) {
    // Second level (or the matrix's columns): each pair, and each column's own totals.
    out.pairs = await db.prepare(`SELECT ${val(d1)} AS label, ${val(d2)} AS label2, ${metricSql} FROM ${spec.table} ${w.sql}
      GROUP BY 1, 2 ORDER BY label, ${order} LIMIT 5000`).all(...w.params);
    out.cols = await db.prepare(`SELECT ${val(d2)} AS label2, ${metricSql} FROM ${spec.table} ${w.sql}
      GROUP BY 1 ORDER BY ${order}, label2 LIMIT 300`).all(...w.params);
  }
  if (q.trend === '1' && spec.dims.month) {
    out.trend = await db.prepare(`SELECT ${val(spec.dims.month)} AS label, ${metricSql} FROM ${spec.table} ${w.sql}
      GROUP BY 1 ORDER BY 1 LIMIT 240`).all(...w.params);
  }
  if (q.funnel === '1' && spec.funnel && spec.dims.status) {
    out.funnelRows = await db.prepare(`SELECT ${val(spec.dims.status)} AS label, ${metricSql} FROM ${spec.table} ${w.sql}
      GROUP BY 1`).all(...w.params);
  }
  if (p.cmp) {
    const r = compareRange(p.from, p.to, p.cmp);
    const prev = await figures(r.from, r.to);
    out.compare = { kind: p.cmp, from: r.from, to: r.to, rows: prev.rows, totals: prev.totals };
  }
  return out;
}

/** The records behind a number: a group (and sub-group / matrix cell), narrowed by a metric's own condition. */
export async function runRecords(db, kind, q, sc) {
  const spec = reportSpec(kind);
  const view = recordView(kind);
  if (!spec || !view) return null;
  if (!(await canSee(db, kind, sc))) return { forbidden: true };
  const p = readParams(spec, q);
  const w = where(spec, p, sc);
  let sql = w.sql; const params = [...w.params];
  const crumbs = [];
  for (const [dk, vk] of [['g', 'v'], ['g2', 'v2']]) {
    const key = q[dk];
    if (q[vk] === undefined || !spec.dims[key]) continue;
    // The same COALESCE the report groups on, so "Unspecified" finds the blank ones.
    sql += ` AND ${val(spec.dims[key])} = ?`; params.push(String(q[vk]));
    crumbs.push({ by: spec.dims[key].label, label: String(q[vk]) });
  }
  const metric = spec.metrics.find((m) => m.key === q.metric);
  if (metric?.cond) { sql += ` AND (${metric.cond})`; }
  const LIMIT = 5000;
  const cols = view.fields.map((x) => `${x.sql} AS "${x.key}"`).join(', ');
  const rows = await db.prepare(`SELECT id, ${cols} FROM ${spec.table} ${sql} ORDER BY ${view.order}, id DESC LIMIT ${LIMIT}`).all(...params);
  const total = Number((await db.prepare(`SELECT COUNT(*) c FROM ${spec.table} ${sql}`).get(...params)).c);
  if (view.pageBy) for (const r of rows) r._page = view.pageBy.map[r[view.pageBy.col]] || view.page;
  return {
    kind, label: spec.label, from: p.from, to: p.to, page: view.page, filters: p.filters,
    crumbs, metric: metric ? { key: metric.key, label: metric.label, narrowed: !!metric.cond } : null,
    columns: view.fields.map((x) => ({ key: x.key, label: x.label, kind: x.kind })),
    rows, total, limit: LIMIT,
  };
}

/** The values one field takes in the period, most common first, for the filter picker. */
export async function runValues(db, kind, q, sc) {
  const spec = reportSpec(kind);
  if (!spec || !spec.dims[q.dim]) return null;
  if (!(await canSee(db, kind, sc))) return { forbidden: true };
  const p = readParams(spec, q);
  delete p.filters[q.dim];   // the field's own filter shouldn't hide its other choices
  const w = where(spec, p, sc);
  const rows = await db.prepare(`SELECT ${val(spec.dims[q.dim])} AS value, COUNT(*) AS count FROM ${spec.table} ${w.sql}
    GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 500`).all(...w.params);
  return { dim: q.dim, label: spec.dims[q.dim].label, values: rows };
}
