// Two things that hang off an issued policy:
//   - commissions: payin (what the insurer pays the office) and payout (what the office pays an associate
//     or agency), worked out from the premium and a rate, followed from Pending to Received / Paid, with
//     a bell alert once one is overdue;
//   - endorsements: changes to the policy after issue (vehicle, sum insured, address …) and what each did
//     to the premium.

const KINDS = ['payin', 'payout'];
const STATUSES = ['Pending', 'Received', 'Paid', 'Cancelled'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 10);
const num = (v) => (v === '' || v == null ? 0 : Number(v) || 0);
const round2 = (n) => Math.round(n * 100) / 100;

export function registerPolicyExtras(app, { db, auth, emit, emitRow, notifyOnce, scope }) {
  const safe = (fn) => (req, res) => fn(req, res).catch((e) => {
    console.error('policy extras failed:', e.message);
    if (!res.headersSent) res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  // A department head sees their own department's commissions (and the ones with none).
  async function scopeSql(req, col = 'c.department') {
    const sc = await scope(req);
    return !sc.all && sc.department ? { sql: ` AND (${col} = ? OR ${col} IS NULL OR ${col} = '')`, params: [sc.department] } : { sql: '', params: [] };
  }
  const withPolicy = `SELECT c.*, p.policy_number AS p_number, p.insured_name AS p_insured, p.company_name AS p_company,
      p.insurance_type AS p_product, p.associate AS p_associate, p.net_premium AS p_net, p.assigned_to AS p_owner
    FROM commissions c LEFT JOIN policies p ON p.id = c.policy_id`;

  // ---- commissions ----
  app.get('/api/commissions', auth, safe(async (req, res) => {
    const s = await scopeSql(req);
    const p = [...s.params];
    let where = 'WHERE 1=1' + s.sql;
    if (KINDS.includes(req.query.kind)) { where += ' AND c.kind = ?'; p.push(req.query.kind); }
    if (STATUSES.includes(req.query.status)) { where += ' AND c.status = ?'; p.push(req.query.status); }
    if (req.query.policy_id) { where += ' AND c.policy_id = ?'; p.push(Number(req.query.policy_id) || 0); }
    const rows = await db.prepare(`${withPolicy} ${where} ORDER BY c.id DESC LIMIT 5000`).all(...p);
    const t = today();
    res.json({ today: t, rows: rows.map((r) => ({ ...r, overdue: r.status === 'Pending' && DATE_RE.test(r.due_date || '') && r.due_date < t })) });
  }));

  async function readCommission(b, cur) {
    const kind = b.kind ?? cur?.kind ?? 'payin';
    if (!KINDS.includes(kind)) return { error: 'Choose payin or payout' };
    const policyId = b.policy_id !== undefined ? (Number(b.policy_id) || null) : (cur?.policy_id ?? null);
    const pol = policyId ? await db.prepare('SELECT * FROM policies WHERE id = ?').get(policyId) : null;
    if (policyId && !pol) return { error: 'That policy no longer exists' };
    if (!pol && !(b.policy_number ?? cur?.policy_number)) return { error: 'Choose the policy' };
    const base = b.base_premium !== undefined ? num(b.base_premium) : (cur ? num(cur.base_premium) : num(pol?.net_premium));
    const rate = b.rate !== undefined ? num(b.rate) : num(cur?.rate);
    if (rate < 0 || rate > 100) return { error: 'The rate should be between 0 and 100 %' };
    // The amount follows the rate unless one is typed in.
    const amount = b.amount !== undefined && b.amount !== '' && b.amount !== null ? num(b.amount) : round2((base * rate) / 100);
    const status = b.status ?? cur?.status ?? 'Pending';
    if (!STATUSES.includes(status)) return { error: 'Unknown status' };
    if (status === 'Received' && kind !== 'payin') return { error: 'A payout is Paid, not Received' };
    if (status === 'Paid' && kind !== 'payout') return { error: 'A payin is Received, not Paid' };
    const due = b.due_date ?? cur?.due_date ?? '';
    if (due && !DATE_RE.test(due)) return { error: 'The due date is not a date' };
    let settled = b.settled_date ?? cur?.settled_date ?? '';
    if (['Received', 'Paid'].includes(status) && !settled) settled = today();
    if (!['Received', 'Paid'].includes(status)) settled = '';
    const party = String(b.party ?? cur?.party ?? (kind === 'payin' ? pol?.company_name : pol?.associate) ?? '').trim();
    return { value: {
      kind, policy_id: pol?.id || null, policy_number: pol?.policy_number || b.policy_number || cur?.policy_number || '',
      insured_name: pol?.insured_name || b.insured_name || cur?.insured_name || '', company_name: pol?.company_name || cur?.company_name || '',
      agency_name: kind === 'payout' ? party : (cur?.agency_name || ''), party,
      base_premium: base, rate, amount, status, due_date: due, settled_date: settled,
      reference: String(b.reference ?? cur?.reference ?? '').slice(0, 120), remarks: String(b.remarks ?? cur?.remarks ?? '').slice(0, 500),
      entry_date: cur?.entry_date || today(), department: pol?.department || cur?.department || '',
    } };
  }
  const COLS = ['kind', 'policy_id', 'policy_number', 'insured_name', 'company_name', 'agency_name', 'party', 'base_premium', 'rate', 'amount',
    'status', 'due_date', 'settled_date', 'reference', 'remarks', 'entry_date', 'department'];

  app.post('/api/commissions', auth, safe(async (req, res) => {
    const e = await readCommission(req.body || {}, null);
    if (e.error) return res.status(400).json({ error: e.error });
    const info = await db.prepare(`INSERT INTO commissions (${COLS.join(',')}, created_by) VALUES (${COLS.map(() => '?').join(',')}, ?)`)
      .run(...COLS.map((c) => e.value[c]), req.user.name || '');
    emit('commission', 'changed', { id: info.lastInsertRowid });
    res.json(await db.prepare(`${withPolicy} WHERE c.id = ?`).get(info.lastInsertRowid));
  }));
  app.put('/api/commissions/:id', auth, safe(async (req, res) => {
    const cur = await db.prepare('SELECT * FROM commissions WHERE id = ?').get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    const e = await readCommission(req.body || {}, cur);
    if (e.error) return res.status(400).json({ error: e.error });
    await db.prepare(`UPDATE commissions SET ${COLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...COLS.map((c) => e.value[c]), cur.id);
    emit('commission', 'changed', { id: cur.id });
    res.json(await db.prepare(`${withPolicy} WHERE c.id = ?`).get(cur.id));
  }));
  app.delete('/api/commissions/:id', auth, safe(async (req, res) => {
    await db.prepare('DELETE FROM commissions WHERE id = ?').run(req.params.id);
    emit('commission', 'changed', { id: Number(req.params.id) });
    res.json({ ok: true });
  }));

  // Overdue commissions raise one bell alert each.
  async function overdueSweep() {
    try {
      const rows = await db.prepare(`SELECT * FROM commissions WHERE status = 'Pending' AND due_date ~ '^\\d{4}-\\d{2}-\\d{2}$' AND due_date < ?`).all(today());
      for (const c of rows) {
        await notifyOnce('commission_overdue', 'commissions', c.id, {
          entity: 'commission', icon: 'rupee', tone: 'warning', link: '/page/commissions',
          title: c.kind === 'payin' ? 'Commission not yet received' : 'Commission payout overdue',
          body: `${c.policy_number || c.insured_name} · ${c.party || c.company_name || ''} · Rs. ${Number(c.amount || 0).toLocaleString('en-IN')} · due ${c.due_date}`,
        });
      }
    } catch (e) { console.error('commission sweep failed:', e.message); }
  }
  setTimeout(overdueSweep, 30 * 1000);
  setInterval(overdueSweep, 6 * 60 * 60 * 1000);

  // ---- endorsements ----
  app.get('/api/endorsements', auth, safe(async (req, res) => {
    const p = [];
    let where = 'WHERE 1=1';
    if (req.query.policy_id) { where += ' AND policy_id = ?'; p.push(Number(req.query.policy_id) || 0); }
    res.json(await db.prepare(`SELECT * FROM endorsements ${where} ORDER BY COALESCE(NULLIF(endorsement_date, ''), created_at) DESC, id DESC LIMIT 2000`).all(...p));
  }));
  async function readEndorsement(b, cur) {
    const policyId = b.policy_id !== undefined ? (Number(b.policy_id) || null) : cur?.policy_id ?? null;
    const pol = policyId ? await db.prepare('SELECT * FROM policies WHERE id = ?').get(policyId) : null;
    if (!pol && !cur) return { error: 'Choose the policy' };
    const type = String(b.endorsement_type ?? cur?.endorsement_type ?? '').trim();
    if (!type) return { error: 'Say what the endorsement changes' };
    const date = b.endorsement_date ?? cur?.endorsement_date ?? '';
    if (date && !DATE_RE.test(date)) return { error: 'The date is not a date' };
    return { value: {
      policy_id: pol?.id || cur?.policy_id || null, policy_number: pol?.policy_number || cur?.policy_number || '',
      insured_name: pol?.insured_name || cur?.insured_name || '', company_name: pol?.company_name || cur?.company_name || '',
      endorsement_no: String(b.endorsement_no ?? cur?.endorsement_no ?? '').trim(), endorsement_type: type, endorsement_date: date,
      premium_effect: b.premium_effect !== undefined ? num(b.premium_effect) : num(cur?.premium_effect), remarks: String(b.remarks ?? cur?.remarks ?? '').slice(0, 500),
    } };
  }
  const ECOLS = ['policy_id', 'policy_number', 'insured_name', 'company_name', 'endorsement_no', 'endorsement_type', 'endorsement_date', 'premium_effect', 'remarks'];
  app.post('/api/endorsements', auth, safe(async (req, res) => {
    const e = await readEndorsement(req.body || {}, null);
    if (e.error) return res.status(400).json({ error: e.error });
    const info = await db.prepare(`INSERT INTO endorsements (${ECOLS.join(',')}, created_by) VALUES (${ECOLS.map(() => '?').join(',')}, ?)`)
      .run(...ECOLS.map((c) => e.value[c]), req.user.name || '');
    await emitRow('endorsement', 'created', 'endorsements', info.lastInsertRowid);
    res.json(await db.prepare('SELECT * FROM endorsements WHERE id = ?').get(info.lastInsertRowid));
  }));
  app.put('/api/endorsements/:id', auth, safe(async (req, res) => {
    const cur = await db.prepare('SELECT * FROM endorsements WHERE id = ?').get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    const e = await readEndorsement(req.body || {}, cur);
    if (e.error) return res.status(400).json({ error: e.error });
    await db.prepare(`UPDATE endorsements SET ${ECOLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...ECOLS.map((c) => e.value[c]), cur.id);
    await emitRow('endorsement', 'updated', 'endorsements', cur.id);
    res.json(await db.prepare('SELECT * FROM endorsements WHERE id = ?').get(cur.id));
  }));
  app.delete('/api/endorsements/:id', auth, safe(async (req, res) => {
    await db.prepare('DELETE FROM endorsements WHERE id = ?').run(req.params.id);
    emit('endorsement', 'deleted', { id: Number(req.params.id) });
    res.json({ ok: true });
  }));
}
