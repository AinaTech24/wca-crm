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
  // Only the record's own department (or someone who sees both) may change or delete it.
  async function otherDept(req, dep) {
    const sc = await scope(req);
    return !!dep && !sc.all && !!sc.department && dep !== sc.department;
  }
  async function headOrAdmin(req) {
    const u = await db.prepare('SELECT role, is_head FROM users WHERE id = ?').get(req.user.id);
    return u?.role === 'admin' || Number(u?.is_head) === 1;
  }
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
    // Totals over every matching commission, so they stay right however many there are.
    const tot = await db.prepare(`SELECT
        COALESCE(SUM(amount) FILTER (WHERE kind = 'payin' AND status = 'Pending'), 0)::float8 AS payin_due,
        COALESCE(SUM(COALESCE(received_amount, amount)) FILTER (WHERE kind = 'payin' AND status = 'Received'), 0)::float8 AS payin_got,
        COALESCE(SUM(amount) FILTER (WHERE kind = 'payout' AND status = 'Pending'), 0)::float8 AS payout_due,
        COALESCE(SUM(COALESCE(received_amount, amount)) FILTER (WHERE kind = 'payout' AND status = 'Paid'), 0)::float8 AS payout_paid,
        COALESCE(SUM(COALESCE(received_amount, amount) - amount) FILTER (WHERE status IN ('Received', 'Paid')), 0)::float8 AS variance,
        COUNT(*) FILTER (WHERE status = 'Pending' AND due_date ~ '^\\d{4}-\\d{2}-\\d{2}$' AND due_date < ?)::int AS overdue
      FROM commissions c ${where}`).get(t, ...p);
    res.json({ today: t, totals: tot, rows: rows.map((r) => ({ ...r, overdue: r.status === 'Pending' && DATE_RE.test(r.due_date || '') && r.due_date < t,
      variance: ['Received', 'Paid'].includes(r.status) && r.received_amount !== null && r.received_amount !== undefined ? round2(num(r.received_amount) - num(r.amount)) : null })) });
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
      // What actually came in (or went out) — the amount expected unless a different figure is entered.
      received_amount: ['Received', 'Paid'].includes(status) ? (b.received_amount !== undefined && b.received_amount !== '' && b.received_amount !== null ? num(b.received_amount) : (cur?.received_amount ?? amount)) : null,
      gst_amount: b.gst_amount !== undefined ? num(b.gst_amount) : num(cur?.gst_amount), tds_amount: b.tds_amount !== undefined ? num(b.tds_amount) : num(cur?.tds_amount),
      statement_ref: String(b.statement_ref ?? cur?.statement_ref ?? '').slice(0, 120),
      entry_date: cur?.entry_date || today(), department: pol?.department || cur?.department || '',
    } };
  }
  const COLS = ['kind', 'policy_id', 'policy_number', 'insured_name', 'company_name', 'agency_name', 'party', 'base_premium', 'rate', 'amount',
    'status', 'due_date', 'settled_date', 'reference', 'remarks', 'entry_date', 'department', 'received_amount', 'gst_amount', 'tds_amount', 'statement_ref'];

  // ---- agreed rates ----
  app.get('/api/commissions/rates', auth, safe(async (req, res) => {
    res.json(await db.prepare('SELECT * FROM commission_rates ORDER BY kind, insurer, product, party').all());
  }));
  function readRate(b) {
    const kind = b.kind === 'payout' ? 'payout' : 'payin';
    const rate = num(b.rate);
    if (rate <= 0 || rate > 100) return { error: 'The rate should be between 0 and 100 %' };
    const v = { kind, insurer: String(b.insurer || '').trim(), product: String(b.product || '').trim(), party: String(b.party || '').trim(), rate,
      on_od: b.on_od ? 1 : 0, due_days: Math.max(0, Math.min(365, Number(b.due_days) || 30)) };
    if (kind === 'payout' && !v.party) return { error: 'A payout rate is for an associate or agency — give the name' };
    return { value: v };
  }
  const RCOLS = ['kind', 'insurer', 'product', 'party', 'rate', 'on_od', 'due_days'];
  app.post('/api/commissions/rates', auth, safe(async (req, res) => {
    if (!(await headOrAdmin(req))) return res.status(403).json({ error: 'Only an admin or a department head can set commission rates' });
    const r = readRate(req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    const info = await db.prepare(`INSERT INTO commission_rates (${RCOLS.join(',')}, created_by) VALUES (${RCOLS.map(() => '?').join(',')}, ?)`).run(...RCOLS.map((c) => r.value[c]), req.user.name || '');
    res.json(await db.prepare('SELECT * FROM commission_rates WHERE id = ?').get(info.lastInsertRowid));
  }));
  app.put('/api/commissions/rates/:id', auth, safe(async (req, res) => {
    if (!(await headOrAdmin(req))) return res.status(403).json({ error: 'Only an admin or a department head can set commission rates' });
    const r = readRate(req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    await db.prepare(`UPDATE commission_rates SET ${RCOLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...RCOLS.map((c) => r.value[c]), Number(req.params.id));
    res.json(await db.prepare('SELECT * FROM commission_rates WHERE id = ?').get(Number(req.params.id)));
  }));
  app.delete('/api/commissions/rates/:id', auth, safe(async (req, res) => {
    if (!(await headOrAdmin(req))) return res.status(403).json({ error: 'Only an admin or a department head can set commission rates' });
    await db.prepare('DELETE FROM commission_rates WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  }));

  // The most specific agreed rate for a policy: the insurer's rate for that product, then for any product, then
  // the general rate. For a payout, the associate's own rate.
  async function rateFor(kind, p) {
    const rows = await db.prepare('SELECT * FROM commission_rates WHERE kind = ?').all(kind);
    const lc = (v) => String(v || '').trim().toLowerCase();
    const prod = [lc(p.insurance_type), lc(p.product_name)];
    const fits = rows.filter((r) => (!r.insurer || lc(r.insurer) === lc(p.company_name) || lc(p.company_name).includes(lc(r.insurer)))
      && (!r.product || prod.includes(lc(r.product)))
      && (kind !== 'payout' || lc(r.party) === lc(p.associate)));
    fits.sort((a, b) => (b.insurer ? 2 : 0) + (b.product ? 1 : 0) - ((a.insurer ? 2 : 0) + (a.product ? 1 : 0)));
    return fits[0] || null;
  }
  // When a policy is issued: the payin (and the associate's payout) at the agreed rates, once.
  async function autoCommissions(policyId) {
    try {
      const p = await db.prepare('SELECT * FROM policies WHERE id = ?').get(policyId);
      if (!p || p.policy_with_us === 'No') return [];
      const made = [];
      for (const kind of ['payin', 'payout']) {
        if (kind === 'payout' && !String(p.associate || '').trim()) continue;
        if (await db.prepare('SELECT 1 FROM commissions WHERE policy_id = ? AND kind = ?').get(p.id, kind)) continue;
        const r = await rateFor(kind, p);
        if (!r) continue;
        // Motor commission is earned on the own-damage premium where the agreed rate says so.
        const base = r.on_od && num(p.od_premium) > 0 ? num(p.od_premium) : num(p.net_premium);
        const due = new Date(Date.now() + 5.5 * 3600000 + (Number(r.due_days) || 30) * 86400000).toISOString().slice(0, 10);
        const v = { kind, policy_id: p.id, policy_number: p.policy_number || '', insured_name: p.insured_name || '', company_name: p.company_name || '',
          agency_name: kind === 'payout' ? p.associate : '', party: kind === 'payout' ? p.associate : (p.company_name || ''), base_premium: base, rate: r.rate,
          amount: round2((base * r.rate) / 100), status: 'Pending', due_date: due, settled_date: '', reference: '', remarks: 'Made from the agreed rate when the policy was issued',
          entry_date: today(), department: p.department || '', received_amount: null, gst_amount: 0, tds_amount: 0, statement_ref: '' };
        const info = await db.prepare(`INSERT INTO commissions (${COLS.join(',')}, created_by, auto_made) VALUES (${COLS.map(() => '?').join(',')}, ?, 1)`).run(...COLS.map((c) => v[c]), 'CRM');
        made.push(info.lastInsertRowid);
      }
      if (made.length) emit('commission', 'changed', { id: made[0] });
      return made;
    } catch (e) { console.error('automatic commission failed:', e.message); return []; }
  }

  // ---- matching an insurer's statement ----
  // Rows of { policy_number, amount, date, reference }: each is matched to that policy's pending payin, which is
  // marked Received with the amount actually paid. What could not be matched is listed back.
  app.post('/api/commissions/statement', auth, safe(async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 5000) : [];
    if (!rows.length) return res.status(400).json({ error: 'The statement has no rows' });
    const ref = String(req.body?.reference || ('Statement ' + today())).slice(0, 120);
    const norm = (v) => String(v || '').toUpperCase().replace(/[\s/\\-]+/g, '');
    const matched = [], unmatched = [];
    for (const r of rows) {
      const no = norm(r.policy_number);
      const amt = num(r.amount);
      if (!no || !amt) { unmatched.push({ ...r, why: !no ? 'No policy number' : 'No amount' }); continue; }
      const c = await db.prepare(`SELECT * FROM commissions WHERE kind = 'payin' AND status = 'Pending'
        AND (UPPER(regexp_replace(COALESCE(policy_number, ''), '[\\s/\\\\-]+', '', 'g')) = ?
          OR policy_id IN (SELECT id FROM policies WHERE UPPER(regexp_replace(COALESCE(policy_number, ''), '[\\s/\\\\-]+', '', 'g')) = ?))
        ORDER BY id LIMIT 1`).get(no, no);
      if (!c) { unmatched.push({ ...r, why: 'No pending payin for this policy' }); continue; }
      if (await otherDept(req, c.department)) { unmatched.push({ ...r, why: 'Another department' }); continue; }
      const date = DATE_RE.test(r.date || '') ? r.date : today();
      await db.prepare("UPDATE commissions SET status = 'Received', received_amount = ?, settled_date = ?, statement_ref = ?, reference = COALESCE(NULLIF(?, ''), reference) WHERE id = ?")
        .run(amt, date, ref, String(r.reference || '').slice(0, 120), c.id);
      matched.push({ id: c.id, policy_number: r.policy_number, expected: num(c.amount), received: amt, variance: round2(amt - num(c.amount)) });
    }
    if (matched.length) emit('commission', 'changed', { id: matched[0].id });
    res.json({ matched, unmatched });
  }));

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
    if (await otherDept(req, cur.department)) return res.status(403).json({ error: 'That commission belongs to another department.' });
    const e = await readCommission(req.body || {}, cur);
    if (e.error) return res.status(400).json({ error: e.error });
    await db.prepare(`UPDATE commissions SET ${COLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...COLS.map((c) => e.value[c]), cur.id);
    emit('commission', 'changed', { id: cur.id });
    res.json(await db.prepare(`${withPolicy} WHERE c.id = ?`).get(cur.id));
  }));
  app.delete('/api/commissions/:id', auth, safe(async (req, res) => {
    const cur = await db.prepare('SELECT department FROM commissions WHERE id = ?').get(req.params.id);
    if (await otherDept(req, cur?.department)) return res.status(403).json({ error: 'That commission belongs to another department.' });
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
    const s = await scopeSql(req, 'p.department');
    const p = [...s.params];
    let where = 'WHERE 1=1' + s.sql;
    if (req.query.policy_id) { where += ' AND e.policy_id = ?'; p.push(Number(req.query.policy_id) || 0); }
    // The insurer's endorsement copy is not sent with the list — only whether there is one.
    res.json(await db.prepare(`SELECT e.id, e.policy_id, e.policy_number, e.insured_name, e.company_name, e.endorsement_no, e.endorsement_type, e.endorsement_date, e.premium_effect, e.remarks,
        e.status, e.new_value, e.document_name, e.applied_at, (e.document IS NOT NULL AND e.document <> '') AS has_document
      FROM endorsements e LEFT JOIN policies p ON p.id = e.policy_id ${where} ORDER BY COALESCE(NULLIF(e.endorsement_date, ''), e.created_at) DESC, e.id DESC LIMIT 2000`).all(...p));
  }));
  app.get('/api/endorsements/:id/document', auth, safe(async (req, res) => {
    const e = await db.prepare('SELECT e.document, e.document_name, p.department FROM endorsements e LEFT JOIN policies p ON p.id = e.policy_id WHERE e.id = ?').get(Number(req.params.id));
    if (!e?.document) return res.status(404).json({ error: 'No document' });
    if (await otherDept(req, e.department)) return res.status(403).json({ error: 'That endorsement belongs to another department.' });
    res.json({ data: e.document, name: e.document_name || 'Endorsement' });
  }));
  async function readEndorsement(b, cur) {
    const policyId = b.policy_id !== undefined ? (Number(b.policy_id) || null) : cur?.policy_id ?? null;
    const pol = policyId ? await db.prepare('SELECT * FROM policies WHERE id = ?').get(policyId) : null;
    if (!pol && !cur) return { error: 'Choose the policy' };
    const type = String(b.endorsement_type ?? cur?.endorsement_type ?? '').trim();
    if (!type) return { error: 'Say what the endorsement changes' };
    if (b.document && !/^data:(application\/pdf|image\/(png|jpe?g|webp|gif))[;,]/i.test(String(b.document))) return { error: 'The endorsement copy must be a PDF or a picture' };
    const date = b.endorsement_date ?? cur?.endorsement_date ?? '';
    if (date && !DATE_RE.test(date)) return { error: 'The date is not a date' };
    return { value: {
      policy_id: pol?.id || cur?.policy_id || null, policy_number: pol?.policy_number || cur?.policy_number || '',
      insured_name: pol?.insured_name || cur?.insured_name || '', company_name: pol?.company_name || cur?.company_name || '',
      endorsement_no: String(b.endorsement_no ?? cur?.endorsement_no ?? '').trim(), endorsement_type: type, endorsement_date: date,
      premium_effect: b.premium_effect !== undefined ? num(b.premium_effect) : num(cur?.premium_effect), remarks: String(b.remarks ?? cur?.remarks ?? '').slice(0, 500),
      status: ['Requested', 'With insurer', 'Issued'].includes(b.status) ? b.status : (cur?.status || 'Issued'),
      new_value: String(b.new_value ?? cur?.new_value ?? '').trim().slice(0, 200),
      document: b.document !== undefined ? (b.document || null) : (cur?.document ?? null), document_name: String(b.document_name ?? cur?.document_name ?? '').slice(0, 200),
    } };
  }
  const ECOLS = ['policy_id', 'policy_number', 'insured_name', 'company_name', 'endorsement_no', 'endorsement_type', 'endorsement_date', 'premium_effect', 'remarks', 'status', 'new_value', 'document', 'document_name'];
  // An issued endorsement changes the policy, once: a cancellation closes it (no renewal, pending commission
  // cancelled, any commission already received flagged to be clawed back); a new sum insured, nominee or
  // registration number is written onto the policy.
  async function applyEndorsement(id, by) {
    const e = await db.prepare('SELECT * FROM endorsements WHERE id = ?').get(id);
    if (!e || e.status !== 'Issued' || e.applied_at || !e.policy_id) return;
    const t = String(e.endorsement_type || '').toLowerCase();
    const v = String(e.new_value || '').trim();
    let changed = false;
    if (/cancel/.test(t)) {
      await db.prepare("UPDATE policies SET policy_status = 'Cancelled', active_status = 'Inactive', renewable = 'No' WHERE id = ?").run(e.policy_id);
      await db.prepare("UPDATE commissions SET status = 'Cancelled', remarks = TRIM(COALESCE(remarks, '') || ' · policy cancelled') WHERE policy_id = ? AND status = 'Pending'").run(e.policy_id);
      const got = await db.prepare("SELECT COALESCE(SUM(COALESCE(received_amount, amount)), 0)::float8 AS s, MAX(department) AS d, MAX(policy_number) AS n, MAX(insured_name) AS i, MAX(company_name) AS c FROM commissions WHERE policy_id = ? AND kind = 'payin' AND status = 'Received'").get(e.policy_id);
      if (num(got.s) > 0) {
        await db.prepare(`INSERT INTO commissions (kind, policy_id, policy_number, insured_name, company_name, party, base_premium, rate, amount, status, due_date, remarks, entry_date, department, created_by)
          VALUES ('payin', ?, ?, ?, ?, ?, 0, 0, ?, 'Pending', '', ?, ?, ?, ?)`).run(e.policy_id, got.n || '', got.i || '', got.c || '', got.c || '', -round2(num(got.s)),
          'Clawback — the policy was cancelled. Check the amount against the insurer’s refund and adjust.', today(), got.d || '', by || 'CRM');
      }
      changed = true;
    } else if (v && /sum insured|\bsi\b|idv/.test(t) && num(v.replace(/[,\s]/g, '')) > 0) {
      await db.prepare('UPDATE policies SET sum_assured = ? WHERE id = ?').run(num(v.replace(/[,\s]/g, '')), e.policy_id); changed = true;
    } else if (v && /nominee/.test(t)) {
      await db.prepare('UPDATE policies SET nominee_name = ? WHERE id = ?').run(v, e.policy_id); changed = true;
    } else if (v && /registration|vehicle/.test(t)) {
      await db.prepare('UPDATE policies SET reg_no = ? WHERE id = ?').run(v.toUpperCase(), e.policy_id); changed = true;
    }
    await db.prepare("UPDATE endorsements SET applied_at = to_char(now(), 'YYYY-MM-DD HH24:MI') WHERE id = ?").run(id);
    if (changed) { await emitRow('policy', 'updated', 'policies', e.policy_id); emit('commission', 'changed', { id: 0 }); }
  }
  app.post('/api/endorsements', auth, safe(async (req, res) => {
    const e = await readEndorsement(req.body || {}, null);
    if (e.error) return res.status(400).json({ error: e.error });
    const info = await db.prepare(`INSERT INTO endorsements (${ECOLS.join(',')}, created_by) VALUES (${ECOLS.map(() => '?').join(',')}, ?)`)
      .run(...ECOLS.map((c) => e.value[c]), req.user.name || '');
    await applyEndorsement(info.lastInsertRowid, req.user.name);
    await emitRow('endorsement', 'created', 'endorsements', info.lastInsertRowid);
    res.json(await db.prepare('SELECT * FROM endorsements WHERE id = ?').get(info.lastInsertRowid));
  }));
  app.put('/api/endorsements/:id', auth, safe(async (req, res) => {
    const cur = await db.prepare('SELECT * FROM endorsements WHERE id = ?').get(req.params.id);
    if (!cur) return res.status(404).json({ error: 'Not found' });
    const dep = cur.policy_id ? (await db.prepare('SELECT department FROM policies WHERE id = ?').get(cur.policy_id))?.department : null;
    if (await otherDept(req, dep)) return res.status(403).json({ error: 'That endorsement belongs to another department.' });
    const e = await readEndorsement(req.body || {}, cur);
    if (e.error) return res.status(400).json({ error: e.error });
    await db.prepare(`UPDATE endorsements SET ${ECOLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...ECOLS.map((c) => e.value[c]), cur.id);
    await applyEndorsement(cur.id, req.user.name);
    await emitRow('endorsement', 'updated', 'endorsements', cur.id);
    res.json(await db.prepare('SELECT * FROM endorsements WHERE id = ?').get(cur.id));
  }));
  app.delete('/api/endorsements/:id', auth, safe(async (req, res) => {
    const cur = await db.prepare('SELECT policy_id FROM endorsements WHERE id = ?').get(req.params.id);
    const dep = cur?.policy_id ? (await db.prepare('SELECT department FROM policies WHERE id = ?').get(cur.policy_id))?.department : null;
    if (await otherDept(req, dep)) return res.status(403).json({ error: 'That endorsement belongs to another department.' });
    await db.prepare('DELETE FROM endorsements WHERE id = ?').run(req.params.id);
    emit('endorsement', 'deleted', { id: Number(req.params.id) });
    res.json({ ok: true });
  }));
  return { autoCommissions };
}
