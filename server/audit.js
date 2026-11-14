// Who changed what. One middleware in front of the record routes: before any change to a policy, RFQ,
// lead, client, claim, task, commission or endorsement it snapshots the record, and once the response has
// gone out it compares and writes one audit row per field that changed (or "created" / "deleted").
//
// It never stands in the way: a failure to record history is logged and the change itself still stands.

const TABLES = {
  policies: 'policies', rfqs: 'rfqs', leads: 'leads', clients: 'clients', claims: 'claims',
  tasks: 'tasks', commissions: 'commissions', endorsements: 'endorsements',
};
// Bookkeeping columns that move on their own and say nothing to a person reading the history.
const SKIP = new Set(['updated_at', 'edited_at', 'quote_reminder_sent', 'reminder_sent', 'reminder_sent_at', 'renewal_mail_sent',
  'issued_mail_sent', 'last_activity', 'created_at']);
const NAME = { policies: ['policy_number', 'insured_name'], rfqs: ['rfq_no', 'client_name'], leads: ['lead_name'], clients: ['client_name'],
  claims: ['claim_no', 'client_name'], tasks: ['title'], commissions: ['policy_number', 'kind'], endorsements: ['endorsement_no', 'insured_name'] };

// Files (data URIs) and long JSON are summarised rather than copied into the history.
function show(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (s.startsWith('data:')) return '(file)';
  if (s.length > 300) return s.replace(/data:[^"]{40,}/g, '(file)').slice(0, 300) + '…';
  return s;
}
const same = (a, b) => (a ?? '') === (b ?? '') || String(a ?? '') === String(b ?? '') || (Number(a) === Number(b) && a !== '' && b !== '' && a !== null && b !== null);

export function registerAudit(app, { db, auth, denyRecordAccess }) {
  async function write(rows) {
    for (const r of rows) {
      await db.prepare('INSERT INTO audit_log (table_name, record_id, action, field, old_value, new_value, user_id, user_name) VALUES (?,?,?,?,?,?,?,?)')
        .run(r.table, r.id, r.action, r.field || null, r.old ?? null, r.new ?? null, r.user?.id || null, r.user?.name || r.user?.username || '');
    }
  }
  const nameOf = (table, row) => (NAME[table] || []).map((k) => row?.[k]).filter(Boolean).join(' · ');

  // /api/<table>/<id>[/<action>] for a change, /api/<table> for a new record.
  app.use(async (req, res, next) => {
    if (req.method === 'GET' || req.method === 'OPTIONS') return next();
    const m = /^\/api\/([a-z]+)(?:\/(\d+))?(?:\/[\w-]+)?\/?$/.exec(req.path);
    const table = m && TABLES[m[1]];
    if (!table) return next();
    const id = m[2] ? Number(m[2]) : null;
    try {
      if (id) {
        const before = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
        if (!before) return next();
        res.on('finish', () => {
          if (res.statusCode >= 300) return;
          (async () => {
            const after = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
            if (!after) { await write([{ table, id, action: 'deleted', field: null, old: nameOf(table, before), user: req.user }]); return; }
            const rows = [];
            for (const k of Object.keys(after)) {
              if (SKIP.has(k) || same(before[k], after[k])) continue;
              rows.push({ table, id, action: 'updated', field: k, old: show(before[k]), new: show(after[k]), user: req.user });
            }
            if (rows.length) await write(rows);
          })().catch((e) => console.error('audit failed:', e.message));
        });
      } else if (req.method === 'POST' && !m[0].replace(/\/$/, '').split('/')[3]) {
        // A new record: the id comes back in the reply.
        const json = res.json.bind(res);
        res.json = (body) => {
          const newId = Number(body?.id || body?.policyId);
          if (res.statusCode < 300 && newId) {
            write([{ table, id: newId, action: 'created', field: null, new: '', user: req.user }]).catch((e) => console.error('audit failed:', e.message));
          }
          return json(body);
        };
      }
    } catch (e) { console.error('audit snapshot failed:', e.message); }
    next();
  });

  // The history of one record, newest first, for people who may see the record.
  app.get('/api/history/:table/:id', auth, async (req, res) => {
    const table = TABLES[req.params.table];
    if (!table) return res.status(404).json({ error: 'Unknown record type' });
    if (['policies', 'rfqs', 'leads', 'claims'].includes(table)) {
      const denied = await denyRecordAccess(req, table, req.params.id);
      if (denied) return res.status(403).json({ error: denied });
    }
    const rows = await db.prepare('SELECT * FROM audit_log WHERE table_name = ? AND record_id = ? ORDER BY at DESC, id DESC LIMIT 500').all(table, Number(req.params.id));
    res.json({ rows });
  });
}
