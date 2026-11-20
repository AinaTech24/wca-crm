// Quotations — what we offer the client, and what the client decided.
//
// The RFQ is the insurer side of a sale (what we asked insurers and what they replied); the quotation is
// the client side (the options we put in front of the client, our recommendation, how long it holds, the
// versions and the client's decision). A quotation is usually built from an RFQ and stays tied to it, but
// can also be made directly, for business quoted without an RFQ.
//
//   Draft → Shared → Approved → Converted (a policy)
//             ↘ Revised: a new version replaces it (the old one is Superseded)
//             ↘ Rejected (with a reason) / Expired (valid-till date passed)
//
// The two stay in step: sharing a quotation marks its RFQ Quoted, approving it approves the same insurer on
// the RFQ (with the RFQ's own approval mails), converting it closes the RFQ. Work done on the RFQ side —
// sharing the comparison, approving a quote, converting — is mirrored onto the RFQ's quotation by
// syncFromRfq, so neither place goes stale whichever one the team uses.

const LIVE = ['Draft', 'Shared', 'Approved', 'Expired'];          // a version still in play
const EARLY_RFQ = ['Draft', 'Sent', 'Quotes Received', 'Quoted'];
const OPT_KEYS = ['insurer', 'plan', 'net_premium', 'email', 'txn', 'ncb', 'idv', 'od_premium', 'tp_premium', 'addon_premium', 'premium',
  'wc_rate', 'wc_basic', 'wc_medical', 'addons_incl', 'quote_name', 'remark'];
const VALID_DAYS = 7;

const parseJ = (v, fb) => { if (v && typeof v === 'object') return v; try { const x = JSON.parse(v || ''); return x ?? fb; } catch { return fb; } };
const istNow = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 16);
const istToday = () => istNow().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const displayNo = (q) => (q.quote_no || '') + (Number(q.version) > 1 ? ` v${q.version}` : '');

/** One option as the quotation keeps it. Insurer documents stay on the RFQ; a direct quotation keeps its own. */
function cleanOption(o, { keepDoc = false } = {}) {
  const out = {};
  for (const k of OPT_KEYS) if (o[k] !== undefined && o[k] !== null) out[k] = o[k];
  out.insurer = String(o.insurer || '').trim();
  out.premium = Number(o.premium) || 0;
  if (Array.isArray(o.addons_incl)) out.addons_incl = o.addons_incl.map(String);
  else if (typeof o.addons_incl === 'string' && o.addons_incl.trim()) out.addons_incl = o.addons_incl.split(',').map((s) => s.trim()).filter(Boolean);
  out.recommended = !!(o.recommended ?? o.selected);
  out.approved = !!(o.approved ?? o.client_approved);
  if (o.rfq_doc) out.rfq_doc = true;
  if (keepDoc && String(o.quote_doc || '').startsWith('data:')) out.quote_doc = o.quote_doc;
  return out;
}

/** Exactly one recommended option (the one marked, else the cheapest); at most one approved. */
function settle(options, { recommended, approved } = {}) {
  const opts = options.filter((o) => o.insurer && o.premium > 0);
  if (recommended !== undefined) opts.forEach((o) => { o.recommended = same(o.insurer, recommended); });
  if (approved !== undefined) opts.forEach((o) => { o.approved = !!approved && same(o.insurer, approved); });
  if (opts.length && !opts.some((o) => o.recommended)) opts.reduce((a, b) => (b.premium < a.premium ? b : a)).recommended = true;
  let seen = false;
  opts.forEach((o) => { if (o.recommended && seen) o.recommended = false; if (o.recommended) seen = true; });
  return opts;
}

/** The insurer quotes on an RFQ (those with a premium), optionally only the named ones. */
function optionsFromRfq(rfq, pick) {
  const quoted = parseJ(rfq.insurers, []).filter((i) => (i.insurer || '').trim() && Number(i.premium) > 0);
  const chosen = Array.isArray(pick) && pick.length ? quoted.filter((i) => pick.some((p) => same(p, i.insurer))) : quoted;
  return chosen.map((i) => cleanOption({ ...i, rfq_doc: !!i.quote_doc }));
}

function summary(options) {
  const rec = options.find((o) => o.recommended) || null;
  const appr = options.find((o) => o.approved) || null;
  return {
    selected_insurer: rec?.insurer || '', selected_premium: rec?.premium || 0,
    approved_insurer: appr?.insurer || '', approved_premium: appr?.premium || 0,
  };
}

export async function registerQuotations(app, h) {
  const { db, auth, scope, applyScope, denyRecordAccess, denyCrossDepartment, emit, emitRow, notify, notifyOnce,
    recordTimeline, departmentForProduct, rfqToPolicy, directToPolicy, approvalEffects, syncLeadFromRfq } = h;

  await db.exec(`
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS email TEXT;
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS category TEXT;
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS policy_type TEXT;
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS policy_nature TEXT;
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS department TEXT;
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS root_id INTEGER;
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS prev_status TEXT;
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS client_note TEXT;
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS approved_insurer TEXT;
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS approved_premium REAL DEFAULT 0;
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS shared_at TEXT;
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS shared_via TEXT;
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS decided_at TEXT;
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS reject_reason TEXT;
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS policy_id INTEGER;
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS lead_id INTEGER;
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS client_id INTEGER;
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS created_by TEXT;
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS followup_sent INTEGER DEFAULT 0;
    -- The relationship manager looking after the client, picked from Settings → Picklists → RM Name.
    ALTER TABLE quotations ADD COLUMN IF NOT EXISTS rm_name TEXT;
    CREATE INDEX IF NOT EXISTS idx_quotations_rfq ON quotations (rfq_id);
    CREATE INDEX IF NOT EXISTS idx_quotations_root ON quotations (root_id);
  `);

  const get = (id) => db.prepare('SELECT * FROM quotations WHERE id = ?').get(id);
  const COLS = ['quote_no', 'client_name', 'mobile', 'email', 'insurance_line', 'category', 'product', 'policy_type', 'policy_nature',
    'sum_assured', 'options', 'selected_insurer', 'selected_premium', 'approved_insurer', 'approved_premium', 'status', 'valid_till',
    'assigned_to', 'rm_name', 'remarks', 'client_note', 'rfq_id', 'lead_id', 'client_id', 'department', 'version', 'root_id', 'created_by',
    'shared_at', 'shared_via', 'decided_at', 'reject_reason', 'policy_id', 'followup_sent'];

  async function insert(rec) {
    const cols = COLS.filter((c) => rec[c] !== undefined);
    const info = await db.prepare(`INSERT INTO quotations (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => rec[c]));
    const id = info.lastInsertRowid;
    // A first version gets its own number; later versions carry the first one's number.
    if (!rec.root_id) await db.prepare("UPDATE quotations SET root_id = ?, quote_no = COALESCE(NULLIF(quote_no, ''), ?) WHERE id = ?").run(id, 'QT-' + (1000 + Number(id)), id);
    return id;
  }
  async function update(id, patch) {
    const cols = Object.keys(patch).filter((c) => COLS.includes(c));
    if (!cols.length) return;
    await db.prepare(`UPDATE quotations SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => patch[c]), id);
  }
  const announce = async (id, action = 'updated') => { await emitRow('quotation', action, 'quotations', id); };

  /** The quotation in play for an RFQ: its newest version that hasn't been replaced. */
  const liveFor = (rfqId) => db.prepare("SELECT * FROM quotations WHERE rfq_id = ? AND status <> 'Superseded' ORDER BY version DESC, id DESC LIMIT 1").get(rfqId);

  function fromRfqRecord(rfq, options, extra = {}) {
    const s = summary(options);
    return {
      client_name: rfq.client_name, mobile: rfq.mobile || '', email: rfq.email || '', insurance_line: rfq.insurance_line || 'GI',
      category: rfq.category || '', product: rfq.product || rfq.category || '', policy_type: rfq.policy_type || '', policy_nature: rfq.policy_nature || '',
      sum_assured: Number(rfq.sum_assured) || Number(rfq.requested_idv) || 0, options: JSON.stringify(options), ...s,
      rfq_id: rfq.id, lead_id: rfq.lead_id || null, department: rfq.department || departmentForProduct(rfq.category || ''),
      assigned_to: rfq.assigned_to || '', ...extra,
    };
  }

  // ---------- RFQ → quotation mirror ----------
  // Called after anything changes an RFQ. Creates the RFQ's quotation once the RFQ has been shared,
  // approved or converted without one, and brings an existing one up to the RFQ's state.
  async function syncFromRfq(rfqId, actor = '') {
    try {
      const rfq = await db.prepare('SELECT * FROM rfqs WHERE id = ?').get(rfqId);
      if (!rfq) return;
      const ins = parseJ(rfq.insurers, []);
      const won = ins.find((i) => i.client_approved && Number(i.premium) > 0);
      const shared = !!(rfq.quote_sent_at || '').trim();
      let q = await liveFor(rfq.id);
      if (!q) {
        const options = settle(optionsFromRfq(rfq));
        if (!options.length || !(shared || won || rfq.policy_id)) return;
        const status = rfq.policy_id ? 'Converted' : won ? 'Approved' : 'Shared';
        const id = await insert(fromRfqRecord(rfq, options, {
          status, version: 1, created_by: actor || rfq.assigned_to || '', valid_till: shared ? addDays(String(rfq.quote_sent_at).slice(0, 10), VALID_DAYS) : '',
          shared_at: shared ? rfq.quote_sent_at : '', shared_via: shared ? 'From RFQ' : '', decided_at: won ? (won.approved_at || istNow()) : '',
          policy_id: rfq.policy_id || null, followup_sent: 1,
        }));
        await db.prepare('UPDATE rfqs SET quotation_id = ? WHERE id = ?').run(id, rfq.id);
        await announce(id, 'created');
        if (status === 'Approved' && actor) await h.onApproved?.(await get(id), null, actor);
        return;
      }
      const patch = {};
      if (rfq.policy_id && q.status !== 'Converted') Object.assign(patch, { status: 'Converted', policy_id: rfq.policy_id });
      else if (won && ['Draft', 'Shared', 'Expired', 'Rejected'].includes(q.status)) {
        let opts = parseJ(q.options, []);
        if (!opts.some((o) => same(o.insurer, won.insurer))) opts.push(cleanOption({ ...won, rfq_doc: !!won.quote_doc }));
        opts = settle(opts, { approved: won.insurer });
        Object.assign(patch, { status: 'Approved', options: JSON.stringify(opts), ...summary(opts), decided_at: won.approved_at || istNow(), reject_reason: '' });
      } else if (!won && q.status === 'Approved' && !rfq.policy_id) {
        // The approval was taken back on the RFQ.
        const opts = settle(parseJ(q.options, []), { approved: '' });
        Object.assign(patch, { status: q.shared_at ? 'Shared' : 'Draft', options: JSON.stringify(opts), ...summary(opts), decided_at: '' });
      } else if (shared && q.status === 'Draft') Object.assign(patch, { status: 'Shared', shared_at: rfq.quote_sent_at, shared_via: q.shared_via || 'From RFQ', valid_till: q.valid_till || addDays(istToday(), VALID_DAYS) });
      if (Object.keys(patch).length) { await update(q.id, patch); await announce(q.id); }
      if (patch.status === 'Approved' && actor) await h.onApproved?.(await get(q.id), null, actor);
      if (Number(rfq.quotation_id) !== Number(q.id)) await db.prepare('UPDATE rfqs SET quotation_id = ? WHERE id = ?').run(q.id, rfq.id);
    } catch (e) { console.error('quotation sync failed:', e.message); }
  }

  // ---------- one-time tidy-up of quotations made before this module ----------
  try {
    await db.exec(`
      UPDATE quotations SET status = 'Shared' WHERE status = 'Sent';
      UPDATE quotations SET status = 'Approved' WHERE status = 'Accepted';
      UPDATE quotations SET root_id = id WHERE root_id IS NULL;
      UPDATE quotations SET version = 1 WHERE version IS NULL;
      UPDATE quotations SET category = product WHERE category IS NULL AND rfq_id IS NULL;
      UPDATE quotations q SET email = COALESCE(q.email, r.email), category = COALESCE(q.category, r.category), department = COALESCE(q.department, r.department),
        policy_type = COALESCE(q.policy_type, r.policy_type), policy_nature = COALESCE(q.policy_nature, r.policy_nature), lead_id = COALESCE(q.lead_id, r.lead_id)
        FROM rfqs r WHERE r.id = q.rfq_id AND (q.department IS NULL OR q.category IS NULL);
    `);
    for (const r of await db.prepare("SELECT id, category, product FROM quotations WHERE COALESCE(department, '') = ''").all()) {
      const dept = departmentForProduct(r.category || r.product || '');
      if (dept) await db.prepare('UPDATE quotations SET department = ? WHERE id = ?').run(dept, r.id);
    }
    const done = await db.prepare("SELECT value FROM app_settings WHERE key = 'quotations_v2_backfill'").get();
    if (!done) {
      // Older quotations of one RFQ: only the newest stays in play.
      await db.exec(`UPDATE quotations q SET status = 'Superseded', prev_status = q.status FROM quotations n
        WHERE n.rfq_id = q.rfq_id AND q.rfq_id IS NOT NULL AND n.id > q.id AND q.status <> 'Superseded'`);
      await db.exec("UPDATE quotations SET followup_sent = 1, valid_till = COALESCE(valid_till, '')");
      const rfqs = await db.prepare("SELECT id FROM rfqs WHERE insurers LIKE '%premium%' OR quotation_id IS NOT NULL OR policy_id IS NOT NULL").all();
      for (const r of rfqs) await syncFromRfq(r.id, '');
      await db.prepare("INSERT INTO app_settings (key, value) VALUES ('quotations_v2_backfill', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(istNow());
      console.log(`Quotations: linked ${rfqs.length} RFQ(s) to their quotations`);
    }
  } catch (e) { console.error('quotation backfill failed:', e.message); }

  // ---------- reading ----------
  const strip = (q) => {
    const opts = parseJ(q.options, []).map((o) => { const { quote_doc, ...rest } = o; return { ...rest, has_doc: !!(quote_doc || o.rfq_doc) }; });
    return { ...q, options: opts, display_no: displayNo(q) };
  };

  // Where an approved quotation stands on its way to a policy: the onboarding form, then the insurer steps.
  // { label, step (0–7, the issuance step reached), tone } — null for a quotation not yet approved.
  function stageOf(q, iss, ob) {
    if (!['Approved', 'Converted'].includes(q.status)) return null;
    const S = (label, step, tone) => ({ label, step, tone });
    if (iss?.issued_at || (!iss && ['Issued', 'Completed'].includes(q.policy_state))) return S('Policy issued', 7, 'green');
    if (iss) {
      if (iss.paid_at) return S('Paid — awaiting policy', 6, 'blue');
      if (iss.payment_link_sent_at) return S('Awaiting payment', 5, 'orange');
      if (iss.payment_link_at) return S('Payment link to send', 5, 'orange');
      if (iss.final_at && Number(iss.medical_required) === 1 && !['Done', 'Not needed'].includes(iss.medical_status)) return S(`Medical check${iss.medical_status && iss.medical_status !== 'Pending' ? ' · ' + iss.medical_status.toLowerCase() : ''}`, 4, 'orange');
      if (iss.final_at) return S('Awaiting payment link', 3, 'blue');
      const props = parseJ(iss.proposals, []);
      if (props.length) return props[props.length - 1].status === 'Changes requested' ? S('Proposal corrections', 2, 'orange') : S('Proposal to verify', 2, 'blue');
      if (iss.sent_at) return S('With insurer', 1, 'blue');
    }
    if (ob === 'Submitted' || ob === 'Reviewed') return S('Onboarding received', 0, 'green');
    if (ob === 'Opened') return S('Onboarding opened', 0, 'orange');
    if (ob === 'Sent' || ob === 'Ready') return S('Onboarding sent', 0, '');
    if (ob === 'Expired') return S('Onboarding expired', 0, 'red');
    return S('Not started', 0, '');
  }
  async function stagesFor(rows) {
    const ids = rows.filter((q) => ['Approved', 'Converted'].includes(q.status)).map((q) => Number(q.id));
    const iss = {}, ob = {};
    if (ids.length) {
      const arr = `{${ids.join(',')}}`;
      try {
        for (const r of await db.prepare('SELECT * FROM issuance WHERE quotation_id = ANY(?::int[])').all(arr)) iss[r.quotation_id] = r;
        for (const r of await db.prepare("SELECT DISTINCT ON (quotation_id) quotation_id, status FROM onboarding_requests WHERE quotation_id = ANY(?::int[]) AND status <> 'Cancelled' ORDER BY quotation_id, id DESC").all(arr)) ob[r.quotation_id] = r.status;
      } catch { /* the tables arrive with their modules; until then there is nothing to show */ }
    }
    return (q) => stageOf(q, iss[q.id], ob[q.id]);
  }

  app.get('/api/quotations', auth, async (req, res) => {
    let sql = `SELECT q.*, r.rfq_no, r.status AS rfq_status, p.policy_number, p.policy_status AS policy_state
      FROM quotations q LEFT JOIN rfqs r ON r.id = q.rfq_id LEFT JOIN policies p ON p.id = q.policy_id WHERE 1=1`;
    const p = [];
    if (req.query.rfq_id) { sql += ' AND q.rfq_id = ?'; p.push(Number(req.query.rfq_id)); }
    sql = await applyScope(req, sql, p, 'q.department');
    const rows = await db.prepare(sql + ' ORDER BY q.id DESC').all(...p);
    const stage = await stagesFor(rows);
    res.json(rows.map((q) => ({ ...strip(q), issuance: stage(q) })));
  });

  async function denyQuote(req, id) {
    const q = await get(id);
    if (!q) return { code: 404, error: 'Quotation not found' };
    const sc = await scope(req);
    if (!sc.all && sc.department && q.department && q.department !== sc.department) return { code: 403, error: 'That quotation belongs to another department.' };
    return { q };
  }

  app.get('/api/quotations/:id', auth, async (req, res) => {
    const { q, code, error } = await denyQuote(req, req.params.id);
    if (!q) return res.status(code).json({ error });
    const rfq = q.rfq_id ? await db.prepare('SELECT id, rfq_no, status, category, product, policy_type, policy_nature, details, add_ons, requested_idv, sum_assured, due_date, insurers, client_name, mobile, email, lead_id, policy_id FROM rfqs WHERE id = ?').get(q.rfq_id) : null;
    const rfqIns = rfq ? parseJ(rfq.insurers, []) : [];
    const options = parseJ(q.options, []).map((o) => {
      if (o.quote_doc) return o;
      const src = rfqIns.find((i) => same(i.insurer, o.insurer));
      return src?.quote_doc ? { ...o, quote_doc: src.quote_doc, quote_name: o.quote_name || src.quote_name || '' } : o;
    });
    // Insurer rates on the RFQ that differ from (or are missing in) what this version offers.
    let stale = null;
    if (rfq && LIVE.includes(q.status) && q.status !== 'Approved') {
      const quoted = rfqIns.filter((i) => (i.insurer || '').trim() && Number(i.premium) > 0);
      const changed = options.filter((o) => { const s = quoted.find((i) => same(i.insurer, o.insurer)); return s && Number(s.premium) !== Number(o.premium); }).map((o) => o.insurer);
      const added = quoted.filter((i) => !options.some((o) => same(o.insurer, i.insurer))).map((i) => i.insurer);
      if (changed.length || added.length) stale = { changed, added };
    }
    const versions = await db.prepare('SELECT id, quote_no, version, status, selected_premium, approved_insurer, created_at, shared_at FROM quotations WHERE root_id = ? ORDER BY version').all(q.root_id || q.id);
    const policy = q.policy_id ? await db.prepare('SELECT id, policy_number, policy_status FROM policies WHERE id = ?').get(q.policy_id) : null;
    const lead = q.lead_id ? await db.prepare('SELECT id, lead_name FROM leads WHERE id = ?').get(q.lead_id) : null;
    if (rfq) delete rfq.insurers;
    res.json({ ...q, options, display_no: displayNo(q), rfq, versions: versions.map((v) => ({ ...v, display_no: displayNo(v) })), policy, lead, stale });
  });

  // ---------- creating ----------
  async function createFromRfq(req, rfq, b = {}) {
    if (rfq.status === 'Lost') return { code: 400, error: 'This RFQ is marked Lost — reopen it before quoting the client' };
    let options = settle(optionsFromRfq(rfq, b.insurers), { recommended: b.recommended || undefined });
    if (!options.length) return { code: 400, error: 'No insurer has quoted a premium yet' };
    const live = await liveFor(rfq.id);
    if (live?.status === 'Converted') return { code: 409, error: `${displayNo(live)} is already converted to a policy` };
    const approved = parseJ(rfq.insurers, []).find((i) => i.client_approved);
    if (approved && options.some((o) => same(o.insurer, approved.insurer))) options = settle(options, { approved: approved.insurer });
    const valid = ISO.test(b.valid_till || '') ? b.valid_till : addDays(istToday(), VALID_DAYS);
    const rec = fromRfqRecord(rfq, options, {
      status: 'Draft', valid_till: valid, client_note: b.client_note || '', rm_name: String(b.rm_name || '').trim(), created_by: req.user.name || '',
      version: live ? Number(live.version || 1) + 1 : 1, root_id: live ? (live.root_id || live.id) : undefined,
      quote_no: live ? live.quote_no : undefined, remarks: b.remarks || `From ${rfq.rfq_no}`,
    });
    const id = await insert(rec);
    if (live) { await update(live.id, { status: 'Superseded' }); await db.prepare('UPDATE quotations SET prev_status = ? WHERE id = ?').run(live.status, live.id); await announce(live.id); }
    await db.prepare('UPDATE rfqs SET quotation_id = ? WHERE id = ?').run(id, rfq.id);
    await announce(id, 'created');
    await emitRow('rfq', 'updated', 'rfqs', rfq.id);
    const q = await get(id);
    await notify({ entity: 'quotation', kind: 'created', icon: 'file', tone: 'info', refTable: 'quotations', refId: id,
      title: live ? 'Quotation revised' : 'Quotation created', body: `${displayNo(q)} — ${q.client_name} (${rfq.rfq_no})`, link: `/page/quotation?open=${id}` });
    return { id, quote_no: q.quote_no, display_no: displayNo(q) };
  }

  // "Create Quotation" on an RFQ.
  app.post('/api/rfqs/:id/convert', auth, async (req, res) => {
    const denied = await denyRecordAccess(req, 'rfqs', req.params.id);
    if (denied) return res.status(403).json({ error: denied });
    const rfq = await db.prepare('SELECT * FROM rfqs WHERE id = ?').get(req.params.id);
    if (!rfq) return res.status(404).json({ error: 'Not found' });
    const r = await createFromRfq(req, rfq, req.body || {});
    if (r.error) return res.status(r.code).json({ error: r.error });
    res.json({ ok: true, quotationId: r.id, quote_no: r.quote_no, display_no: r.display_no });
  });

  app.post('/api/quotations', auth, async (req, res) => {
    const b = req.body || {};
    if (b.rfq_id) {
      const denied = await denyRecordAccess(req, 'rfqs', b.rfq_id);
      if (denied) return res.status(403).json({ error: denied });
      const rfq = await db.prepare('SELECT * FROM rfqs WHERE id = ?').get(b.rfq_id);
      if (!rfq) return res.status(404).json({ error: 'RFQ not found' });
      const r = await createFromRfq(req, rfq, b);
      if (r.error) return res.status(r.code).json({ error: r.error });
      return res.json(r);
    }
    // A direct quotation, without an RFQ.
    const name = String(b.client_name || '').trim();
    if (!name) return res.status(400).json({ error: 'Client name is required' });
    const product = String(b.product || b.category || '').trim();
    if (!product) return res.status(400).json({ error: 'Choose the product' });
    const options = settle((Array.isArray(b.options) ? b.options : []).map((o) => cleanOption(o, { keepDoc: true })));
    if (!options.length) return res.status(400).json({ error: 'Add at least one insurer with a premium' });
    const department = departmentForProduct(b.category || product);
    const deptErr = await denyCrossDepartment(req, department);
    if (deptErr) return res.status(403).json({ error: deptErr });
    const id = await insert({
      client_name: name, mobile: b.mobile || '', email: b.email || '', insurance_line: b.insurance_line === 'LI' ? 'LI' : 'GI',
      category: b.category || product, product, policy_type: b.policy_type || '', policy_nature: b.policy_nature || 'New',
      sum_assured: Number(b.sum_assured) || 0, options: JSON.stringify(options), ...summary(options), status: 'Draft',
      valid_till: ISO.test(b.valid_till || '') ? b.valid_till : addDays(istToday(), VALID_DAYS), client_note: b.client_note || '',
      remarks: b.remarks || '', assigned_to: b.assigned_to || req.user.name || '', rm_name: String(b.rm_name || '').trim(), client_id: b.client_id || null, lead_id: b.lead_id || null,
      department, version: 1, created_by: req.user.name || '',
    });
    const q = await get(id);
    await announce(id, 'created');
    await notify({ entity: 'quotation', kind: 'created', icon: 'file', tone: 'info', refTable: 'quotations', refId: id,
      title: 'Quotation created', body: `${q.quote_no} — ${name}`, link: `/page/quotation?open=${id}` });
    res.json({ id, quote_no: q.quote_no, display_no: displayNo(q) });
  });

  // ---------- editing ----------
  app.put('/api/quotations/:id', auth, async (req, res) => {
    const { q, code, error } = await denyQuote(req, req.params.id);
    if (!q) return res.status(code).json({ error });
    if (['Converted', 'Superseded'].includes(q.status)) return res.status(400).json({ error: `A ${q.status.toLowerCase()} quotation can't be changed` });
    const b = req.body || {};
    const patch = {};
    for (const k of ['valid_till', 'client_note', 'remarks', 'assigned_to', 'rm_name']) if (b[k] !== undefined) patch[k] = String(b[k] ?? '').trim();
    if (patch.valid_till && !ISO.test(patch.valid_till)) return res.status(400).json({ error: 'Valid till must be a date' });
    // Extending an expired quotation puts it back in front of the client.
    if (q.status === 'Expired' && patch.valid_till && patch.valid_till >= istToday()) patch.status = 'Shared';
    if (!q.rfq_id) for (const k of ['client_name', 'mobile', 'email', 'product', 'category', 'policy_type', 'policy_nature']) if (b[k] !== undefined) patch[k] = String(b[k] ?? '');
    // Which client or lead a direct quotation is for (picked from the Clients / Leads list).
    if (!q.rfq_id) for (const k of ['client_id', 'lead_id']) if (b[k] !== undefined) patch[k] = Number(b[k]) > 0 ? Number(b[k]) : null;
    if (!q.rfq_id && b.sum_assured !== undefined) patch.sum_assured = Number(b.sum_assured) || 0;
    if (b.options !== undefined || b.recommended !== undefined) {
      if (q.status !== 'Draft') return res.status(400).json({ error: 'This quotation has gone to the client — revise it to change the options' });
      const src = b.options !== undefined ? (Array.isArray(b.options) ? b.options : []) : parseJ(q.options, []);
      const keep = parseJ(q.options, []);
      const opts = settle(src.map((o) => {
        const prev = keep.find((k) => same(k.insurer, o.insurer));
        return cleanOption({ ...o, quote_doc: o.quote_doc || prev?.quote_doc, rfq_doc: o.rfq_doc || prev?.rfq_doc }, { keepDoc: !q.rfq_id });
      }), { recommended: b.recommended || undefined });
      if (!opts.length) return res.status(400).json({ error: 'Keep at least one insurer with a premium' });
      Object.assign(patch, { options: JSON.stringify(opts), ...summary(opts) });
    }
    if (patch.category !== undefined || patch.product !== undefined) patch.department = departmentForProduct(patch.category || patch.product || q.category);
    await update(q.id, patch);
    await announce(q.id);
    res.json({ ok: true });
  });

  // A new version: the client asked for changes, or the insurers' rates moved.
  app.post('/api/quotations/:id/revise', auth, async (req, res) => {
    const { q, code, error } = await denyQuote(req, req.params.id);
    if (!q) return res.status(code).json({ error });
    if (['Converted', 'Superseded'].includes(q.status)) return res.status(400).json({ error: q.status === 'Converted' ? 'Already converted to a policy' : 'A newer version exists — revise that one' });
    const b = req.body || {};
    let options = parseJ(q.options, []).map((o) => ({ ...o, approved: false }));
    if (b.refresh && q.rfq_id) {
      const rfq = await db.prepare('SELECT * FROM rfqs WHERE id = ?').get(q.rfq_id);
      const fresh = rfq ? optionsFromRfq(rfq) : [];
      const rec = options.find((o) => o.recommended)?.insurer;
      // Same insurers as before plus any that have quoted since, at their current rates.
      options = fresh.filter((f) => options.some((o) => same(o.insurer, f.insurer)) || b.refresh === 'all').map((o) => ({ ...o, approved: false, recommended: same(o.insurer, rec) }));
      if (!options.length) options = fresh;
    }
    options = settle(options, { approved: '' });
    const id = await insert({
      ...Object.fromEntries(COLS.filter((c) => !['shared_at', 'shared_via', 'decided_at', 'reject_reason', 'policy_id', 'approved_insurer', 'approved_premium'].includes(c)).map((c) => [c, q[c]])),
      options: JSON.stringify(options), ...summary(options), status: 'Draft', version: Number(q.version || 1) + 1, root_id: q.root_id || q.id,
      valid_till: addDays(istToday(), VALID_DAYS), created_by: req.user.name || '', followup_sent: 0, client_note: b.client_note ?? q.client_note,
    });
    await update(q.id, { status: 'Superseded' });
    await db.prepare('UPDATE quotations SET prev_status = ? WHERE id = ?').run(q.status, q.id);
    if (q.rfq_id) {
      await db.prepare('UPDATE rfqs SET quotation_id = ? WHERE id = ?').run(id, q.rfq_id);
      // A revised offer takes back an approval of the old one on the RFQ as well.
      if (q.status === 'Approved') {
        const rfq = await db.prepare('SELECT insurers, status FROM rfqs WHERE id = ?').get(q.rfq_id);
        const ins = parseJ(rfq?.insurers, []).map((i) => ({ ...i, client_approved: false, approved_by: '', approved_at: '' }));
        await db.prepare("UPDATE rfqs SET insurers = ?, status = CASE WHEN status = 'Approved by Customer' THEN 'Quoted' ELSE status END WHERE id = ?").run(JSON.stringify(ins), q.rfq_id);
      }
      await emitRow('rfq', 'updated', 'rfqs', q.rfq_id);
    }
    await announce(q.id);
    await announce(id, 'created');
    const n = await get(id);
    res.json({ id, display_no: displayNo(n) });
  });

  // ---------- the client side of the journey ----------
  // Sharing happens in the browser (it builds the comparison PDF); this records that it went.
  app.post('/api/quotations/:id/shared', auth, async (req, res) => {
    const { q, code, error } = await denyQuote(req, req.params.id);
    if (!q) return res.status(code).json({ error });
    if (['Converted', 'Superseded'].includes(q.status)) return res.status(400).json({ error: 'This quotation is closed' });
    const via = (Array.isArray(req.body?.via) ? req.body.via : [req.body?.via]).filter(Boolean).join(', ') || 'Shared';
    const stamp = istNow();
    const patch = { shared_at: stamp, shared_via: via };
    if (['Draft', 'Expired'].includes(q.status)) Object.assign(patch, { status: 'Shared', followup_sent: 0 });
    if (!ISO.test(q.valid_till || '') || q.valid_till < istToday()) patch.valid_till = addDays(istToday(), VALID_DAYS);
    await update(q.id, patch);
    if (q.rfq_id) {
      const rfq = await db.prepare('SELECT id, status, quote_sent_at FROM rfqs WHERE id = ?').get(q.rfq_id);
      if (rfq) {
        await db.prepare(`UPDATE rfqs SET quote_sent_at = COALESCE(NULLIF(quote_sent_at, ''), ?), status = CASE WHEN status IN ('Draft','Sent','Quotes Received') THEN 'Quoted' ELSE status END WHERE id = ?`).run(stamp, rfq.id);
        if (!rfq.quote_sent_at) await recordTimeline(rfq.id, 'quote_shared', { note: `${displayNo(q)} via ${via}`, actor: req.user.name || '' });
        emit('timeline', 'updated', { rfq_id: Number(rfq.id) });
        await emitRow('rfq', 'updated', 'rfqs', rfq.id);
      }
    }
    await announce(q.id);
    res.json({ ok: true });
  });

  app.post('/api/quotations/:id/approve', auth, async (req, res) => {
    const { q, code, error } = await denyQuote(req, req.params.id);
    if (!q) return res.status(code).json({ error });
    if (!['Draft', 'Shared', 'Expired', 'Rejected', 'Approved'].includes(q.status)) return res.status(400).json({ error: `A ${q.status.toLowerCase()} quotation can't be approved` });
    const insurer = String(req.body?.insurer || '').trim();
    let opts = parseJ(q.options, []);
    const won = opts.find((o) => same(o.insurer, insurer));
    if (!won) return res.status(400).json({ error: 'Choose the option the client approved' });
    opts = settle(opts, { approved: won.insurer });
    const stamp = istNow();
    await update(q.id, { status: 'Approved', options: JSON.stringify(opts), ...summary(opts), decided_at: stamp, reject_reason: '' });
    const by = String(req.body?.approved_by || q.client_name || '').trim();
    const info = { client_name: q.client_name, email: q.email, product: q.product || q.category, category: q.category, sum_assured: q.sum_assured };
    if (q.rfq_id) {
      const rfq = await db.prepare('SELECT * FROM rfqs WHERE id = ?').get(q.rfq_id);
      if (rfq) {
        const before = parseJ(rfq.insurers, []);
        let ins = before.map((i) => (same(i.insurer, won.insurer)
          ? { ...i, client_approved: true, approved_by: by, approved_at: stamp }
          : { ...i, client_approved: false, approved_by: '', approved_at: '' }));
        // An option added on the quotation that the RFQ never had.
        if (!ins.some((i) => same(i.insurer, won.insurer))) ins = [...ins, { ...won, status: 'Quoted', selected: false, client_approved: true, approved_by: by, approved_at: stamp }];
        await db.prepare(`UPDATE rfqs SET insurers = ?, status = CASE WHEN status IN ('Draft','Sent','Quotes Received','Quoted','Lost') THEN 'Approved by Customer' ELSE status END WHERE id = ?`).run(JSON.stringify(ins), rfq.id);
        const was = before.find((i) => i.client_approved);
        if (!was || !same(was.insurer, won.insurer)) {
          await approvalEffects(req, { ...info, rfq_no: rfq.rfq_no }, { ...won, approved_by: by, approved_at: stamp }, { kind: 'rfq', id: rfq.id }, rfq.id);
        }
        await syncLeadFromRfq(req, rfq.id);
        await emitRow('rfq', 'updated', 'rfqs', rfq.id);
      }
    } else if (!same(q.approved_insurer, won.insurer)) {
      await approvalEffects(req, { ...info, rfq_no: displayNo(q) }, { ...won, approved_by: by, approved_at: stamp }, { kind: 'quotation', id: q.id }, null);
    }
    await notify({ entity: 'quotation', kind: 'approved', icon: 'check', tone: 'success', refTable: 'quotations', refId: q.id,
      title: 'Client approved a quotation', body: `${displayNo(q)} — ${q.client_name} · ${won.insurer}`, link: `/page/quotation?open=${q.id}` });
    await announce(q.id);
    // The client's onboarding form goes out now (if switched on in Settings).
    const ob = await h.onApproved?.(await get(q.id), req.user.id, req.user.name || '');
    res.json({ ok: true, onboarding: ob ? { sent: ob.mail === 'sent', form: ob.request?.form_type } : null });
  });

  app.post('/api/quotations/:id/reject', auth, async (req, res) => {
    const { q, code, error } = await denyQuote(req, req.params.id);
    if (!q) return res.status(code).json({ error });
    if (['Converted', 'Superseded'].includes(q.status)) return res.status(400).json({ error: 'This quotation is closed' });
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'Give the reason the client said no' });
    const opts = settle(parseJ(q.options, []), { approved: '' });
    await update(q.id, { status: 'Rejected', reject_reason: reason, decided_at: istNow(), options: JSON.stringify(opts), ...summary(opts) });
    await announce(q.id);
    res.json({ ok: true, rfq_id: q.rfq_id || null });
  });

  // Reopen a rejected or expired quotation (the client came back).
  app.post('/api/quotations/:id/reopen', auth, async (req, res) => {
    const { q, code, error } = await denyQuote(req, req.params.id);
    if (!q) return res.status(code).json({ error });
    if (!['Rejected', 'Expired'].includes(q.status)) return res.status(400).json({ error: 'Only a rejected or expired quotation can be reopened' });
    await update(q.id, { status: q.shared_at ? 'Shared' : 'Draft', reject_reason: '', decided_at: '', valid_till: addDays(istToday(), VALID_DAYS), followup_sent: 0 });
    await announce(q.id);
    res.json({ ok: true });
  });

  // Turns an approved quotation into a policy. Used by Convert to Policy and by the issuance tracker.
  async function convertQuote(req, q) {
    if (q.status === 'Converted' && q.policy_id) return { status: 409, body: { error: 'Already converted to a policy', policyId: q.policy_id } };
    if (q.status !== 'Approved') return { status: 400, body: { error: 'Mark the option the client approved first' } };
    const won = parseJ(q.options, []).find((o) => o.approved);
    if (!won) return { status: 400, body: { error: 'Mark the option the client approved first' } };
    let out;
    if (q.rfq_id) {
      const rfq = await db.prepare('SELECT * FROM rfqs WHERE id = ?').get(q.rfq_id);
      if (!rfq) return { status: 404, body: { error: 'The RFQ behind this quotation was deleted' } };
      const rfqWon = parseJ(rfq.insurers, []).find((i) => i.client_approved && same(i.insurer, won.insurer));
      out = await rfqToPolicy(req, rfq, { ...won, ...(rfqWon || {}), premium: won.premium }, { remarks: `Converted from ${displayNo(q)} (${rfq.rfq_no})` });
    } else {
      out = await directToPolicy(req, q, won, { remarks: `Converted from ${displayNo(q)}` });
    }
    if (out.status !== 200) return out;
    await update(q.id, { status: 'Converted', policy_id: out.body.policyId });
    try {
      const ob = await db.prepare("SELECT answers FROM onboarding_requests WHERE quotation_id = ? AND status IN ('Submitted', 'Reviewed') ORDER BY id DESC LIMIT 1").get(q.id);
      const a = parseJ(ob?.answers, null);
      if (a) {
        const nom = Array.isArray(a.nominees) && a.nominees[0] ? a.nominees[0] : a.nominee_name ? { name: a.nominee_name, relation: a.nominee_relation, dob: a.nominee_dob } : null;
        const age = nom?.dob && /^\d{4}-\d{2}-\d{2}$/.test(nom.dob) ? String(Math.max(0, Math.floor((Date.now() - Date.parse(nom.dob)) / 31557600000))) : '';
        const members = Array.isArray(a.members) && a.members.length ? String(a.members.length) : Array.isArray(a.travellers) && a.travellers.length ? String(a.travellers.length) : '';
        await db.prepare(`UPDATE policies SET nominee_name = COALESCE(NULLIF(nominee_name, ''), ?), nominee_relation = COALESCE(NULLIF(nominee_relation, ''), ?),
          nominee_age = COALESCE(NULLIF(nominee_age, ''), ?), members_covered = COALESCE(NULLIF(members_covered, ''), ?), reg_no = COALESCE(NULLIF(reg_no, ''), ?) WHERE id = ?`)
          .run(nom?.name || '', nom?.relation || '', age, members, a.reg_no || '', out.body.policyId);
      }
    } catch (e) { console.error('policy from onboarding failed:', e.message); }
    await announce(q.id);
    return { status: 200, body: { ...out.body, quotationId: q.id } };
  }
  app.post('/api/quotations/:id/to-policy', auth, async (req, res) => {
    const { q, code, error } = await denyQuote(req, req.params.id);
    if (!q) return res.status(code).json({ error });
    const r = await convertQuote(req, q);
    res.status(r.status).json(r.body);
  });

  app.delete('/api/quotations/:id', auth, async (req, res) => {
    const { q, code, error } = await denyQuote(req, req.params.id);
    if (!q) return res.status(code).json({ error });
    if (q.status !== 'Draft' && (await scope(req)).role !== 'admin') return res.status(403).json({ error: 'Only a draft can be deleted — ask an admin, or mark it rejected' });
    const pol = q.policy_id ? await db.prepare('SELECT id FROM policies WHERE id = ?').get(q.policy_id) : null;
    if (q.status === 'Converted' && pol) return res.status(400).json({ error: 'This quotation became a policy — delete the policy first if it was a mistake' });
    await db.prepare('DELETE FROM quotations WHERE id = ?').run(q.id);
    // Its onboarding link stops working and its issuance tracker goes with it (the client's own files stay on the client).
    try {
      await db.prepare('DELETE FROM onboarding_requests WHERE quotation_id = ?').run(q.id);
      const iss = await db.prepare('SELECT id FROM issuance WHERE quotation_id = ?').get(q.id);
      if (iss) {
        await db.prepare("DELETE FROM record_attachments WHERE parent_kind = 'issuance' AND parent_id = ?").run(iss.id);
        await db.prepare('DELETE FROM issuance WHERE id = ?').run(iss.id);
      }
    } catch (e) { console.error('[quotation delete] tidy-up', e.message); }
    emit('onboarding', 'deleted', { quotation_id: Number(q.id) });
    // The version it replaced comes back into play.
    const prev = await db.prepare("SELECT * FROM quotations WHERE root_id = ? AND status = 'Superseded' ORDER BY version DESC LIMIT 1").get(q.root_id || q.id);
    if (prev && q.status !== 'Superseded') {
      await update(prev.id, { status: prev.prev_status || (prev.shared_at ? 'Shared' : 'Draft') });
      if (q.rfq_id) await db.prepare('UPDATE rfqs SET quotation_id = ? WHERE id = ?').run(prev.id, q.rfq_id);
      await announce(prev.id);
    } else if (q.rfq_id) await db.prepare('UPDATE rfqs SET quotation_id = NULL WHERE id = ? AND quotation_id = ?').run(q.rfq_id, q.id);
    emit('quotation', 'deleted', { id: Number(q.id) });
    if (q.rfq_id) await emitRow('rfq', 'updated', 'rfqs', q.rfq_id);
    res.json({ ok: true });
  });

  // ---------- reminders ----------
  // A shared quotation nobody has heard back on for two days reminds its owner; one past its valid-till
  // date is marked Expired (with a reminder that it can be extended or revised).
  async function sweep() {
    try {
      const today = istToday();
      const expired = await db.prepare(`SELECT * FROM quotations WHERE status = 'Shared' AND valid_till ~ '^\\d{4}-\\d{2}-\\d{2}$' AND valid_till < ?`).all(today);
      for (const q of expired) {
        await update(q.id, { status: 'Expired' });
        await announce(q.id);
        await notifyOnce('quotation-expired', 'quotations', q.id, { entity: 'quotation', icon: 'clock', tone: 'warning',
          title: 'Quotation expired', body: `${displayNo(q)} — ${q.client_name}: no decision by ${q.valid_till.split('-').reverse().join('-')}. Extend or revise it.`, link: `/page/quotation?open=${q.id}` });
      }
      const quiet = await db.prepare(`SELECT * FROM quotations WHERE status = 'Shared' AND COALESCE(followup_sent, 0) = 0
        AND shared_at ~ '^\\d{4}-\\d{2}-\\d{2}' AND substr(shared_at, 1, 10)::date <= ?::date - 2`).all(today);
      for (const q of quiet) {
        await update(q.id, { followup_sent: 1 });
        await notify({ entity: 'quotation', kind: 'quotation-followup', icon: 'bell', tone: 'info', refTable: 'quotations', refId: q.id,
          title: 'Quotation awaiting client reply', body: `${displayNo(q)} — ${q.client_name}${q.assigned_to ? ' · ' + q.assigned_to : ''}: shared ${String(q.shared_at).slice(0, 10).split('-').reverse().join('-')}, no decision yet.`, link: `/page/quotation?open=${q.id}` });
      }
    } catch (e) { console.error('quotation sweep failed:', e.message); }
  }
  setTimeout(sweep, 60 * 1000);
  setInterval(sweep, 30 * 60 * 1000);

  return { syncFromRfq, convertQuote };
}
