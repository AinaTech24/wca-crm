// Saved reports (in folders, private or for everyone), each person's favourites, and reports emailed on
// a schedule with an Excel file attached.
//
// A scheduled report runs as the person who set it up: their department limit, their mailbox. Every
// minute the due ones are claimed (one row update, so a run never happens twice) and then sent.

import * as XLSX from 'xlsx';
import { reportSpec } from './reports.js';
import { runReport, runRecords, presetRange } from './reportEngine.js';

const TZ = 'Asia/Kolkata';
const istNow = () => new Date().toLocaleString('sv-SE', { timeZone: TZ });   // 2026-11-14 15:04:05
const APP_URL = (process.env.APP_URL || 'https://crm.wecareassurance.com').replace(/\/+$/, '');
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FREQS = ['daily', 'weekly', 'monthly'];
const WEEKDAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const PERIOD_NAMES = { today: 'Today', yesterday: 'Yesterday', 'last-7': 'Last 7 days', 'this-week': 'This week', 'last-week': 'Last week',
  'this-month': 'This month', 'last-month': 'Last month', 'this-quarter': 'This quarter', 'this-fy': 'This financial year',
  'last-fy': 'Last financial year', 'last-12': 'Last 12 months' };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}` : s || '');
const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const fmtVal = (v, kind) => {
  if (v === null || v === undefined || v === '') return kind === 'days' ? '—' : '0';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (kind === 'pct' || kind === 'share') return `${Math.round(n)}%`;
  if (kind === 'days') return `${inr.format(n)}d`;
  return inr.format(Math.round(n));
};

/** The query a saved configuration stands for — a named period is worked out afresh each time it runs. */
export function configQuery(cfg = {}) {
  const q = {};
  const r = cfg.preset && cfg.preset !== 'custom' ? presetRange(cfg.preset) : null;
  q.from = r?.from || cfg.from || ''; q.to = r?.to || cfg.to || '';
  if (cfg.g) q.g = cfg.g;
  if (cfg.g2) q.g2 = cfg.g2;
  if (cfg.f && Object.keys(cfg.f).length) q.f = cfg.f;
  if (cfg.cmp) q.cmp = cfg.cmp;
  return q;
}

/** When a schedule next sends, as 'YYYY-MM-DD HH:MM' (Indian time). */
export function nextRun(s, now = istNow()) {
  const today = now.slice(0, 10), hm = now.slice(11, 16);
  for (let i = 0; i < 400; i++) {
    const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    if (!fallsOn(s, dateStr)) continue;
    if (i === 0 && (hm >= s.send_time || s.last_run_date === dateStr)) continue;
    return `${dateStr} ${s.send_time}`;
  }
  return null;
}
function fallsOn(s, dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  if (s.frequency === 'daily') return true;
  if (s.frequency === 'weekly') return ((d.getUTCDay() + 6) % 7) + 1 === Number(s.weekday);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return d.getUTCDate() === Math.min(Number(s.monthday) || 1, last);
}
export function describeSchedule(s) {
  const at = ` at ${s.send_time}`;
  if (s.frequency === 'daily') return `Every day${at}`;
  if (s.frequency === 'weekly') return `Every ${WEEKDAYS[s.weekday] || 'Monday'}${at}`;
  return `Monthly on day ${s.monthday}${Number(s.monthday) > 28 ? ' (or the last day)' : ''}${at}`;
}

// ---- building the email and the Excel file ----
async function buildMail(db, report, owner, scopeFor) {
  const cfg = JSON.parse(report.config || '{}');
  const q = configQuery(cfg);
  const sc = await scopeFor(owner.id);
  const data = await runReport(db, report.kind, q, sc);
  const recs = await runRecords(db, report.kind, q, sc);
  const cols = data.columns;

  // Workbook: the figures as shown, then every record counted.
  const book = XLSX.utils.book_new();
  const head = [data.groupLabel, ...(data.groupBy2 ? [data.groupLabel2] : []), ...cols.map((c) => c.label)];
  const lines = [];
  const pairsOf = (label) => (data.pairs || []).filter((p) => p.label === label);
  for (const r of data.rows) {
    lines.push([r.label, ...(data.groupBy2 ? ['All'] : []), ...cols.map((c) => Number(r[c.key]) || 0)]);
    if (data.groupBy2) for (const p of pairsOf(r.label)) lines.push([r.label, p.label2, ...cols.map((c) => Number(p[c.key]) || 0)]);
  }
  lines.push(['Total', ...(data.groupBy2 ? [''] : []), ...cols.map((c) => Number(data.totals?.[c.key]) || 0)]);
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([head, ...lines]), 'Summary');
  const recHead = recs.columns.map((c) => c.label);
  const recLines = recs.rows.map((r) => recs.columns.map((c) => (c.kind === 'money' ? Number(r[c.key]) || 0 : c.kind === 'date' ? fmtDate(r[c.key]) : r[c.key] ?? '')));
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([recHead, ...recLines]), 'Records');
  const xlsx = XLSX.write(book, { type: 'base64', bookType: 'xlsx' });

  const period = `${cfg.preset && PERIOD_NAMES[cfg.preset] ? PERIOD_NAMES[cfg.preset] + ' · ' : ''}${fmtDate(data.from)} to ${fmtDate(data.to)}`;
  const filterText = Object.entries(data.filters || {}).map(([k, v]) => `${data.dims.find((d) => d.key === k)?.label || k}: ${v.join(', ')}`).join(' · ');
  const link = `${APP_URL}/page/reports?${new URLSearchParams({ saved: String(report.id) })}`;
  const show = cols.filter((c) => c.kind !== 'share').slice(0, 6);
  const th = 'style="text-align:left;padding:7px 10px;background:#f1f5fa;border-bottom:1px solid #dde4ee;font-size:12px;color:#44546a"';
  const td = 'style="padding:7px 10px;border-bottom:1px solid #edf1f6;font-size:13px"';
  const tdn = 'style="padding:7px 10px;border-bottom:1px solid #edf1f6;font-size:13px;text-align:right"';
  const kpis = show.map((c) => `<td style="padding:10px 14px;border:1px solid #dde4ee;border-radius:6px"><div style="font-size:11px;color:#6b7a90;text-transform:uppercase">${esc(c.label)}</div><div style="font-size:20px;font-weight:700;color:#1a2230">${esc(fmtVal(data.totals?.[c.key], c.kind))}</div></td>`).join('');
  const body = data.rows.slice(0, 30).map((r) => `<tr><td ${td}>${esc(r.label)}</td>${show.map((c) => `<td ${tdn}>${esc(fmtVal(r[c.key], c.kind))}</td>`).join('')}</tr>`).join('');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a2230;max-width:760px">
    <h2 style="margin:0 0 4px;font-size:19px">${esc(report.name)}</h2>
    <div style="color:#6b7a90;font-size:13px;margin-bottom:14px">${esc(data.label)} · ${esc(period)}${filterText ? ' · ' + esc(filterText) : ''}${data.scope?.applied ? ' · ' + esc(data.scope.department) : ''}</div>
    <table style="border-collapse:separate;border-spacing:8px 0;margin:0 -8px 16px"><tr>${kpis}</tr></table>
    <table style="border-collapse:collapse;width:100%"><tr><th ${th}>${esc(data.groupLabel)}</th>${show.map((c) => `<th ${th} align="right">${esc(c.label)}</th>`).join('')}</tr>${body}</table>
    ${data.rows.length > 30 ? `<p style="font-size:12px;color:#6b7a90">The first 30 of ${data.rows.length} groups. Every group and record is in the attached Excel file.</p>` : ''}
    <p style="margin-top:18px"><a href="${esc(link)}" style="background:#1b6fb0;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none;font-size:13px">Open the report in WCA CRM</a></p>
    <p style="font-size:11px;color:#8a97a8">Sent by WCA CRM on the schedule ${esc(owner.full_name || owner.username)} set up.</p>
  </div>`;
  const safe = report.name.replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-') || 'report';
  return {
    subject: `${report.name} — ${period}`,
    html,
    attachments: [{ filename: `${safe}-${data.from}-to-${data.to}.xlsx`, contentBase64: xlsx }],
  };
}

export function registerReportStore(app, { db, auth, scopeFor, mailboxFor, deliverMail, logAutoEmail }) {
  const me = async (req) => db.prepare('SELECT id, role, username, full_name FROM users WHERE id = ?').get(req.user.id);
  const visible = (u) => (u.role === 'admin' ? '1=1' : `(r.owner_id = ${Number(u.id)} OR r.shared = 'everyone')`);
  const canEdit = (u, r) => u.role === 'admin' || r.owner_id === u.id;
  const safe = (fn) => (req, res) => fn(req, res).catch((e) => {
    console.error('report library failed:', e.message);
    if (!res.headersSent) res.status(500).json({ error: 'Something went wrong with saved reports. Please try again.' });
  });

  function readReport(b, cur) {
    const name = String(b.name ?? cur?.name ?? '').trim().slice(0, 120);
    if (!name) return { error: 'Give the report a name' };
    const folder = String(b.folder ?? cur?.folder ?? '').trim().slice(0, 60);
    const kind = b.kind ?? cur?.kind;
    if (!reportSpec(kind)) return { error: 'Unknown report' };
    const shared = (b.shared ?? cur?.shared) === 'everyone' ? 'everyone' : 'private';
    let config = b.config ?? (cur ? JSON.parse(cur.config || '{}') : {});
    if (typeof config === 'string') { try { config = JSON.parse(config); } catch { return { error: 'The report settings could not be read' }; } }
    const text = JSON.stringify(config || {});
    if (text.length > 20000) return { error: 'The report settings are too large' };
    return { value: { name, folder, kind, shared, config: text } };
  }

  async function list(u) {
    const rows = await db.prepare(`SELECT r.*, COALESCE(NULLIF(o.full_name,''), o.username) AS owner_name,
        EXISTS (SELECT 1 FROM saved_report_favs f WHERE f.report_id = r.id AND f.user_id = ?) AS fav
      FROM saved_reports r LEFT JOIN users o ON o.id = r.owner_id WHERE ${visible(u)} ORDER BY LOWER(r.folder), LOWER(r.name)`).all(u.id);
    const ids = rows.map((r) => r.id);
    const sched = ids.length ? await db.prepare(`SELECT * FROM report_schedules WHERE report_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(...ids) : [];
    return rows.map((r) => ({
      id: r.id, name: r.name, folder: r.folder, kind: r.kind, config: JSON.parse(r.config || '{}'),
      shared: r.shared, owner_id: r.owner_id, owner_name: r.owner_name, fav: !!r.fav, mine: r.owner_id === u.id,
      can_edit: canEdit(u, r), created_at: r.created_at, updated_at: r.updated_at,
      schedules: sched.filter((s) => s.report_id === r.id).map((s) => ({ ...s, active: !!s.active, describe: describeSchedule(s), next_run: s.active ? nextRun(s) : null })),
    }));
  }

  app.get('/api/report-library', auth, safe(async (req, res) => {
    const u = await me(req);
    const reports = await list(u);
    res.json({ reports, folders: [...new Set(reports.map((r) => r.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b)) });
  }));

  app.post('/api/report-library', auth, safe(async (req, res) => {
    const u = await me(req);
    const e = readReport(req.body || {}, null);
    if (e.error) return res.status(400).json({ error: e.error });
    const v = e.value;
    const info = await db.prepare('INSERT INTO saved_reports (name, folder, kind, config, owner_id, shared, updated_at) VALUES (?,?,?,?,?,?,?)')
      .run(v.name, v.folder, v.kind, v.config, u.id, v.shared, istNow());
    res.json((await list(u)).find((r) => r.id === info.lastInsertRowid));
  }));

  app.put('/api/report-library/:id', auth, safe(async (req, res) => {
    const u = await me(req);
    const cur = await db.prepare('SELECT * FROM saved_reports WHERE id = ?').get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    if (!canEdit(u, cur)) return res.status(403).json({ error: 'Only the person who saved this report (or an admin) can change it' });
    const e = readReport(req.body || {}, cur);
    if (e.error) return res.status(400).json({ error: e.error });
    const v = e.value;
    await db.prepare('UPDATE saved_reports SET name = ?, folder = ?, kind = ?, config = ?, shared = ?, updated_at = ? WHERE id = ?')
      .run(v.name, v.folder, v.kind, v.config, v.shared, istNow(), cur.id);
    res.json((await list(u)).find((r) => r.id === cur.id));
  }));

  app.delete('/api/report-library/:id', auth, safe(async (req, res) => {
    const u = await me(req);
    const cur = await db.prepare('SELECT * FROM saved_reports WHERE id = ?').get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    if (!canEdit(u, cur)) return res.status(403).json({ error: 'Only the person who saved this report (or an admin) can delete it' });
    await db.prepare('DELETE FROM saved_reports WHERE id = ?').run(cur.id);
    res.json({ ok: true });
  }));

  app.post('/api/report-library/:id/favourite', auth, safe(async (req, res) => {
    const u = await me(req);
    const r = await db.prepare(`SELECT r.* FROM saved_reports r WHERE r.id = ? AND ${visible(u)}`).get(req.params.id);
    if (!r) return res.status(404).json({ error: 'Not found' });
    if (req.body?.on) await db.prepare('INSERT INTO saved_report_favs (user_id, report_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(u.id, r.id);
    else await db.prepare('DELETE FROM saved_report_favs WHERE user_id = ? AND report_id = ?').run(u.id, r.id);
    res.json({ ok: true, fav: !!req.body?.on });
  }));

  // ---- schedules ----
  function readSchedule(b, cur) {
    const frequency = b.frequency ?? cur?.frequency ?? 'weekly';
    if (!FREQS.includes(frequency)) return { error: 'Choose daily, weekly or monthly' };
    const weekday = Number(b.weekday ?? cur?.weekday ?? 1);
    if (!(weekday >= 1 && weekday <= 7)) return { error: 'Choose the day of the week' };
    const monthday = Number(b.monthday ?? cur?.monthday ?? 1);
    if (!(monthday >= 1 && monthday <= 31)) return { error: 'The day of the month should be 1 to 31' };
    const send_time = String(b.send_time ?? cur?.send_time ?? '09:00');
    if (!TIME_RE.test(send_time)) return { error: 'The time should look like 09:00' };
    const list = String(b.recipients ?? cur?.recipients ?? '').split(/[;,\s]+/).map((x) => x.trim()).filter(Boolean);
    if (!list.length) return { error: 'Add at least one email address' };
    const bad = list.find((x) => !EMAIL_RE.test(x));
    if (bad) return { error: `“${bad}” is not an email address` };
    if (list.length > 25) return { error: 'Send to at most 25 addresses' };
    const active = b.active === undefined ? (cur ? !!cur.active : true) : !!b.active;
    return { value: { frequency, weekday, monthday, send_time, recipients: [...new Set(list)].join(', '), active: active ? 1 : 0 } };
  }
  async function editableReport(u, id) {
    const r = await db.prepare('SELECT * FROM saved_reports WHERE id = ?').get(id);
    if (!r) return { status: 404, error: 'Not found' };
    if (!canEdit(u, r)) return { status: 403, error: 'Only the person who saved this report (or an admin) can schedule it' };
    return { r };
  }

  app.post('/api/report-library/:id/schedules', auth, safe(async (req, res) => {
    const u = await me(req);
    const x = await editableReport(u, req.params.id);
    if (x.error) return res.status(x.status).json({ error: x.error });
    const e = readSchedule(req.body || {}, null);
    if (e.error) return res.status(400).json({ error: e.error });
    const v = e.value;
    const info = await db.prepare('INSERT INTO report_schedules (report_id, frequency, weekday, monthday, send_time, recipients, active, created_by) VALUES (?,?,?,?,?,?,?,?)')
      .run(x.r.id, v.frequency, v.weekday, v.monthday, v.send_time, v.recipients, v.active, u.id);
    const s = await db.prepare('SELECT * FROM report_schedules WHERE id = ?').get(info.lastInsertRowid);
    res.json({ ...s, active: !!s.active, describe: describeSchedule(s), next_run: s.active ? nextRun(s) : null });
  }));

  async function editableSchedule(req, res) {
    const u = await me(req);
    const s = await db.prepare('SELECT * FROM report_schedules WHERE id = ?').get(req.params.id);
    if (!s) { res.status(404).json({ error: 'Not found' }); return null; }
    const x = await editableReport(u, s.report_id);
    if (x.error) { res.status(x.status).json({ error: x.error }); return null; }
    return { u, s, r: x.r };
  }
  app.put('/api/report-schedules/:id', auth, safe(async (req, res) => {
    const c = await editableSchedule(req, res); if (!c) return;
    const e = readSchedule(req.body || {}, c.s);
    if (e.error) return res.status(400).json({ error: e.error });
    const v = e.value;
    await db.prepare('UPDATE report_schedules SET frequency = ?, weekday = ?, monthday = ?, send_time = ?, recipients = ?, active = ? WHERE id = ?')
      .run(v.frequency, v.weekday, v.monthday, v.send_time, v.recipients, v.active, c.s.id);
    const s = await db.prepare('SELECT * FROM report_schedules WHERE id = ?').get(c.s.id);
    res.json({ ...s, active: !!s.active, describe: describeSchedule(s), next_run: s.active ? nextRun(s) : null });
  }));
  app.delete('/api/report-schedules/:id', auth, safe(async (req, res) => {
    const c = await editableSchedule(req, res); if (!c) return;
    await db.prepare('DELETE FROM report_schedules WHERE id = ?').run(c.s.id);
    res.json({ ok: true });
  }));
  // Sends it now, whatever the schedule says — to see what the recipients will get.
  app.post('/api/report-schedules/:id/send-now', auth, safe(async (req, res) => {
    const c = await editableSchedule(req, res); if (!c) return;
    const out = await sendSchedule(c.s, c.r);
    if (!out.ok) return res.status(400).json({ error: out.error });
    res.json(out);
  }));

  // ---- sending ----
  async function sendSchedule(s, report) {
    const ownerId = s.created_by || report.owner_id;
    const owner = ownerId ? await db.prepare('SELECT id, username, full_name FROM users WHERE id = ?').get(ownerId) : null;
    const stamp = istNow();
    const finish = async (status) => db.prepare('UPDATE report_schedules SET last_run_at = ?, last_status = ? WHERE id = ?').run(stamp.slice(0, 16), status, s.id);
    if (!owner) { await finish('Not sent: the person who set this up no longer exists'); return { ok: false, error: 'The person who set this schedule up no longer exists' }; }
    const box = await mailboxFor(db, { id: owner.id });
    if (!box.s) { await finish('Not sent: ' + box.skip); return { ok: false, error: box.skip }; }
    let mail;
    try { mail = await buildMail(db, report, owner, scopeFor); }
    catch (e) { await finish('Not sent: could not build the report'); console.error('scheduled report build failed:', e.message); return { ok: false, error: 'Could not build the report' }; }
    try {
      await deliverMail(box, { to: s.recipients, subject: mail.subject, html: mail.html, attachments: mail.attachments });
      await logAutoEmail({ to: s.recipients, subject: mail.subject, html: mail.html, status: 'Sent', tkey: 'scheduled-report', parent: {}, by: box });
      await finish('Sent');
      return { ok: true, to: s.recipients, subject: mail.subject };
    } catch (e) {
      await logAutoEmail({ to: s.recipients, subject: mail.subject, html: mail.html, status: 'Failed', error: e.message, tkey: 'scheduled-report', parent: {}, by: box });
      await finish('Failed: ' + String(e.message || '').slice(0, 200));
      return { ok: false, error: e.message || 'Could not send' };
    }
  }

  async function tick() {
    const now = istNow();
    const today = now.slice(0, 10), hm = now.slice(11, 16);
    const due = await db.prepare(`SELECT s.*, r.name, r.kind, r.config, r.owner_id FROM report_schedules s JOIN saved_reports r ON r.id = s.report_id
      WHERE s.active = 1 AND s.send_time <= ? AND COALESCE(s.last_run_date, '') <> ?`).all(hm, today);
    for (const s of due) {
      if (!fallsOn(s, today)) continue;
      // Claim today's run first, so a slow send or a second server never sends it twice.
      const claim = await db.prepare("UPDATE report_schedules SET last_run_date = ? WHERE id = ? AND COALESCE(last_run_date, '') <> ?").run(today, s.id, today);
      if (!claim.changes) continue;
      await sendSchedule(s, { id: s.report_id, name: s.name, kind: s.kind, config: s.config, owner_id: s.owner_id })
        .catch((e) => console.error('scheduled report failed:', e.message));
    }
  }
  setInterval(() => { tick().catch((e) => console.error('report schedule tick failed:', e.message)); }, 60 * 1000);
}
