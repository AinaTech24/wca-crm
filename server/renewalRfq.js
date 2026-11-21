// Renewals that start themselves. A set number of days before a renewable policy expires, a renewal RFQ is
// raised for it — the client, the product, the previous insurer, policy number, expiry, registration and
// sum insured already filled in — and given to the policy's owner. The RFQ points back at the policy
// (rfqs.renewal_of); when it is converted, the old policy is marked Renewed, and if it is lost, Lost.
//
// Off until an admin switches it on: with years of imported policies, switching it on blindly could raise
// thousands of RFQs at once. The settings show how many it would raise first, and one run raises at most
// MAX_PER_RUN, the soonest-expiring first.

const KEY = 'renewal_rfq_days';
const MAX_PER_RUN = 100;
const today = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const TERMINAL = ['Renewed', 'Renewed Elsewhere', 'Lost'];
// Policy product → the RFQ category it is quoted under.
const CATEGORY = {
  Motor: 'Motor', Health: 'Retail Health', 'Super Top Up': 'Retail Health', SISO: 'Retail Health', 'Critical Illness': 'Retail Health',
  'Group Health': 'Group Health Insurance', 'Group Personal Accident': 'Group Personal Accident', 'Workmen Compensation': 'Workmen Compensation',
  'Fire & Property': 'Fire & Property', Householder: 'Householder', 'Marine Cargo': 'Marine Cargo', Liability: 'Liability',
  'Group Term Life': 'Group Term Life', Engineering: 'Engineering',
};

export function registerRenewalRfq(app, { db, auth, emitRow, notify, recordTimeline, departmentForProduct }) {
  async function getDays() {
    const r = await db.prepare('SELECT value FROM app_settings WHERE key = ?').get(KEY);
    const n = Number(r?.value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  // The policies a run would pick up for a given window.
  const DUE_SQL = `FROM policies p
    WHERE p.renewable = 'Yes' AND COALESCE(p.policy_with_us, 'Yes') <> 'No' AND COALESCE(p.active_status, 'Active') <> 'Inactive'
      AND COALESCE(p.insurance_line, 'GI') <> 'LI'
      AND COALESCE(p.policy_status, '') NOT IN ('Cancelled', 'Lost', 'Draft')
      AND COALESCE(NULLIF(p.renewal_status, ''), 'Pending') NOT IN ('Renewed', 'Renewed Elsewhere', 'Lost')
      AND p.period_to ~ '^\\d{4}-\\d{2}-\\d{2}' AND substr(p.period_to, 1, 10) BETWEEN ? AND ?
      AND NOT EXISTS (SELECT 1 FROM rfqs r WHERE r.renewal_of = p.id)`;

  async function raise(p, actor) {
    const client = p.client_id ? await db.prepare('SELECT mobile, email, owner FROM clients WHERE id = ?').get(p.client_id) : null;
    const category = CATEGORY[p.insurance_type] || 'Other';
    const days = Math.round((Date.parse(String(p.period_to).slice(0, 10)) - Date.parse(today())) / 86400000);
    // Motor NCB for the renewal: no claim in the year steps it up (0 → 20 → 25 → 35 → 45 → 50); a claim resets it.
    let ncb = p.ncb_pct || '';
    let ncbNote = '';
    if (category === 'Motor') {
      const claimed = await db.prepare(`SELECT 1 FROM claims WHERE (policy_id = ? OR (NULLIF(policy_no, '') IS NOT NULL AND policy_no = ?))
        AND COALESCE(status, '') NOT IN ('Rejected', 'Withdrawn') LIMIT 1`).get(p.id, p.policy_number || '');
      const STEP = { 0: 20, 20: 25, 25: 35, 35: 45, 45: 50, 50: 50 };
      const cur = Number(String(p.ncb_pct || '0').replace('%', '')) || 0;
      ncb = claimed ? '0' : String(STEP[cur] ?? cur);
      ncbNote = claimed ? 'A claim was made on the expiring policy — NCB resets to 0%.' : `No claim on the expiring policy — NCB steps up from ${cur}% to ${ncb}%.`;
    }
    const details = {
      prev_insurer: p.company_name || '', prev_policy_no: p.policy_number || '', prev_expiry: String(p.period_to || '').slice(0, 10),
      reg_no: p.reg_no || '', ncb_pct: ncb, prev_ncb_pct: p.ncb_pct || '', ncb_note: ncbNote,
    };
    const owner = p.assigned_to || client?.owner || actor || '';
    const info = await db.prepare(`INSERT INTO rfqs (rfq_no, client_name, mobile, email, insurance_line, category, product, policy_nature, policy_type,
        sum_assured, requested_idv, add_ons, details, requirement, expected_premium, insurers, status, priority, due_date, assigned_to, remarks, quote_send_date, renewal_of, department)
      VALUES ('',?,?,?,?,?,?,'Renewal',?,?,?,'[]',?,?,?,'[]','Draft',?,?,?,?,'',?,?)`).run(
      p.insured_name, client?.mobile || '', p.client_email || client?.email || '', p.insurance_line || 'GI', category, p.product_name || p.insurance_type || '',
      p.policy_type || '', Number(p.sum_assured) || 0, category === 'Motor' ? Number(p.sum_assured) || 0 : 0, JSON.stringify(details),
      `Renewal of ${p.policy_number || 'policy'} with ${p.company_name || 'the current insurer'}, expiring ${String(p.period_to).slice(0, 10)}.`,
      Number(p.final_premium) || 0, days <= 15 ? 'High' : 'Medium', addDays(String(p.period_to).slice(0, 10), -7), owner,
      `Raised for the renewal of policy ${p.policy_number || '#' + p.id}`, p.id, p.department || departmentForProduct(category));
    const id = info.lastInsertRowid;
    const rfqNo = 'RFQ-' + (2000 + id);
    await db.prepare('UPDATE rfqs SET rfq_no = ? WHERE id = ?').run(rfqNo, id);
    await recordTimeline(id, 'rfq_created', { note: `Renewal of ${p.policy_number || 'policy'} (expires ${String(p.period_to).slice(0, 10)})`, actor: actor || 'Automatic' });
    await notify({ entity: 'rfq', kind: 'renewal', icon: 'refresh', tone: 'info', refTable: 'rfqs', refId: id,
      title: 'Renewal RFQ raised', body: `${rfqNo} — ${p.insured_name} · ${p.insurance_type || ''} · expires ${String(p.period_to).slice(0, 10)}${owner ? ' · ' + owner : ''}`, link: '/page/rfq' });
    await emitRow('rfq', 'created', 'rfqs', id);
    return { id, rfq_no: rfqNo };
  }

  async function sweep() {
    try {
      const days = await getDays();
      if (!days) return;
      const t = today();
      const due = await db.prepare(`SELECT p.* ${DUE_SQL} ORDER BY substr(p.period_to, 1, 10), p.id LIMIT ${MAX_PER_RUN}`).all(t, addDays(t, days));
      for (const p of due) await raise(p, '');
      if (due.length) console.log(`renewal RFQs raised: ${due.length}`);
    } catch (e) { console.error('renewal RFQ sweep failed:', e.message); }
  }
  setTimeout(sweep, 60 * 1000);
  setInterval(sweep, 6 * 60 * 60 * 1000);

  // ---- settings (admin) ----
  const isAdmin = async (req) => (await db.prepare('SELECT role FROM users WHERE id = ?').get(req.user.id))?.role === 'admin';
  app.get('/api/renewal-rfq-settings', auth, async (req, res) => {
    const days = await getDays();
    const t = today();
    // How many each window would pick up right now, so switching it on is never a surprise.
    const count = async (n) => Number((await db.prepare(`SELECT COUNT(*) c ${DUE_SQL}`).get(t, addDays(t, n))).c);
    res.json({ days, max_per_run: MAX_PER_RUN, preview: { 15: await count(15), 30: await count(30), 45: await count(45), 60: await count(60), ...(days && ![15, 30, 45, 60].includes(days) ? { [days]: await count(days) } : {}) } });
  });
  app.put('/api/renewal-rfq-settings', auth, async (req, res) => {
    if (!(await isAdmin(req))) return res.status(403).json({ error: 'Only an admin can change this' });
    const n = Number(req.body?.days);
    if (!Number.isFinite(n) || n < 0 || n > 120) return res.status(400).json({ error: 'Days before expiry should be between 1 and 120, or 0 for off' });
    await db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(KEY, String(Math.round(n)));
    if (n > 0) setTimeout(sweep, 500);
    res.json({ days: Math.round(n) });
  });

  // ---- one policy ----
  app.get('/api/policies/:id/renewal-rfq', auth, async (req, res) => {
    const r = await db.prepare('SELECT id, rfq_no, status, policy_id, policy_status FROM rfqs WHERE renewal_of = ? ORDER BY id DESC LIMIT 1').get(req.params.id);
    res.json({ rfq: r || null });
  });
  app.post('/api/policies/:id/renewal-rfq', auth, async (req, res) => {
    try {
      const p = await db.prepare('SELECT * FROM policies WHERE id = ?').get(req.params.id);
      if (!p) return res.status(404).json({ error: 'Not found' });
      const existing = await db.prepare('SELECT id, rfq_no FROM rfqs WHERE renewal_of = ? ORDER BY id DESC LIMIT 1').get(p.id);
      if (existing) return res.status(409).json({ error: `A renewal RFQ already exists: ${existing.rfq_no}`, rfq: existing });
      if (TERMINAL.includes(p.renewal_status)) return res.status(400).json({ error: `This policy is already marked ${p.renewal_status}` });
      res.json(await raise(p, req.user.name || ''));
    } catch (e) {
      console.error('renewal RFQ failed:', e.message);
      res.status(500).json({ error: 'Could not raise the renewal RFQ' });
    }
  });
}
