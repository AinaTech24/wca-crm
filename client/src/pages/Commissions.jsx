// Commissions: payin (from the insurer) and payout (to an associate / agency) against each policy,
// worked out from the premium and a rate, and followed from Pending to Received / Paid.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import confirm from '../components/confirm.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import Select from '../components/Select.jsx';
import DateField, { fmt as fmtDate } from '../components/DateField.jsx';
import HistoryButton from '../components/HistoryButton.jsx';
import { Ic } from '../components/Icons.jsx';
import { useRealtime } from '../realtime.js';
import * as XLSX from 'xlsx';
import { useOpenFromUrl } from '../useOpenFromUrl.js';

const inr = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const STATUS_BADGE = { Pending: 'orange', Received: 'green', Paid: 'green', Cancelled: '' };
const done = (k) => (k === 'payin' ? 'Received' : 'Paid');

// Finds a policy by holder, number, insurer or product among the policies the person can see.
function PolicyPicker({ value, onPick }) {
  const [all, setAll] = useState(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => { api('/policies').then((d) => setAll(Array.isArray(d) ? d : d.rows || [])).catch(() => setAll([])); }, []);
  const chosen = all?.find((p) => p.id === value);
  const hits = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!all || !s) return [];
    return all.filter((p) => [p.insured_name, p.policy_number, p.company_name, p.insurance_type, p.product_name].some((x) => String(x || '').toLowerCase().includes(s))).slice(0, 30);
  }, [all, q]);
  return (
    <div className="pol-pick">
      <input value={open ? q : (chosen ? `${chosen.insured_name} · ${chosen.policy_number || 'no number'} · ${chosen.company_name || ''}` : q)}
        onFocus={() => { setOpen(true); setQ(''); }} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setQ(e.target.value)} placeholder={all ? 'Search holder, policy no, insurer…' : 'Loading policies…'} />
      {open && hits.length > 0 && (
        <div className="pol-pick-list">
          {hits.map((p) => (
            <button key={p.id} type="button" onMouseDown={() => { onPick(p); setOpen(false); }}>
              <b>{p.insured_name}</b> <span>{p.policy_number || 'no number'} · {p.company_name || '—'} · {p.insurance_type || ''} · ₹{inr(p.net_premium)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CommissionModal({ open, seed, onClose, onSaved }) {
  const [f, setF] = useState({});
  const [saving, setSaving] = useState(false);
  const [manual, setManual] = useState(false);   // the amount was typed, not worked out from the rate
  useEffect(() => { if (open) { setF({ kind: 'payin', status: 'Pending', rate: '', base_premium: '', amount: '', ...seed }); setManual(!!seed?.id); } }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const auto = Math.round(((Number(f.base_premium) || 0) * (Number(f.rate) || 0)) ) / 100;
  const amount = manual ? f.amount : auto;
  function pickPolicy(p) {
    setF((x) => ({ ...x, policy_id: p.id, base_premium: x.base_premium || p.net_premium || '', party: x.party || (x.kind === 'payout' ? p.associate : p.company_name) || '' }));
  }
  async function save() {
    setSaving(true);
    try {
      const body = { ...f, amount: manual ? f.amount : '' };
      const row = f.id ? await api('/commissions/' + f.id, { method: 'PUT', body }) : await api('/commissions', { method: 'POST', body });
      toast.success(f.id ? 'Commission updated' : 'Commission added');
      onSaved?.(row); onClose();
    } catch (e) { toast.error(e.message || 'Could not save'); }
    finally { setSaving(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title={f.id ? 'Edit commission' : 'Add commission'} subtitle="Payin is what the insurer pays the office; payout is what the office pays an associate or agency" icon="rupee" size="md" top
      footer={<>
        {f.id && <HistoryButton table="commissions" id={f.id} />}
        <span style={{ flex: 1 }} />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn blue" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </>}>
      {open && (
        <div className="form-grid two">
          <div className="form-field"><label>Type</label>
            <Select value={f.kind} onChange={(e) => setF((p) => ({ ...p, kind: e.target.value, status: p.status === 'Received' || p.status === 'Paid' ? done(e.target.value) : p.status }))}>
              <option value="payin">Payin — from the insurer</option><option value="payout">Payout — to an associate / agency</option>
            </Select></div>
          <div className="form-field"><label>Status</label>
            <Select value={f.status} onChange={(e) => set('status', e.target.value)}>
              {['Pending', done(f.kind), 'Cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
            </Select></div>
          <div className="form-field" style={{ gridColumn: '1 / -1' }}><label>Policy <span className="req">*</span></label>
            {f.lockPolicy ? <input disabled value={f.policyLabel || ''} /> : <PolicyPicker value={f.policy_id} onPick={pickPolicy} />}</div>
          <div className="form-field"><label>{f.kind === 'payin' ? 'Insurer' : 'Paid to (associate / agency)'}</label>
            <input value={f.party || ''} onChange={(e) => set('party', e.target.value)} /></div>
          <div className="form-field"><label>Premium it is worked on (₹)</label>
            <input type="number" value={f.base_premium} onChange={(e) => set('base_premium', e.target.value)} placeholder="net premium" /></div>
          <div className="form-field"><label>Rate (%)</label>
            <input type="number" step="0.01" value={f.rate} onChange={(e) => { set('rate', e.target.value); setManual(false); }} /></div>
          <div className="form-field"><label>Amount (₹)</label>
            <input type="number" value={manual ? f.amount : (auto || '')} onChange={(e) => { setManual(true); set('amount', e.target.value); }} />
            <div className="hint-line">{manual ? <button type="button" className="dt-link" onClick={() => setManual(false)}>Work it out from the rate</button> : 'Premium × rate, or type an amount'}</div></div>
          <div className="form-field"><label>Due by</label><DateField typeable value={f.due_date || ''} onChange={(e) => set('due_date', e.target.value)} /></div>
          {['Received', 'Paid'].includes(f.status) && <div className="form-field"><label>Amount actually {f.status === 'Paid' ? 'paid' : 'received'} (₹)</label><input type="number" value={f.received_amount ?? ''} onChange={(e) => set('received_amount', e.target.value)} placeholder={String(manual ? f.amount || '' : auto || '')} />
            <div className="hint-line">Leave blank if it matched the amount expected.</div></div>}
          <div className="form-field"><label>GST on it (₹)</label><input type="number" value={f.gst_amount ?? ''} onChange={(e) => set('gst_amount', e.target.value)} /></div>
          <div className="form-field"><label>TDS deducted (₹)</label><input type="number" value={f.tds_amount ?? ''} onChange={(e) => set('tds_amount', e.target.value)} /></div>
          {['Received', 'Paid'].includes(f.status) && <div className="form-field"><label>{f.status} on</label><DateField typeable value={f.settled_date || ''} onChange={(e) => set('settled_date', e.target.value)} /></div>}
          <div className="form-field"><label>Reference (UTR / cheque / statement)</label><input value={f.reference || ''} onChange={(e) => set('reference', e.target.value)} /></div>
          <div className="form-field" style={{ gridColumn: '1 / -1' }}><label>Remarks</label><input value={f.remarks || ''} onChange={(e) => set('remarks', e.target.value)} /></div>
          {Number(amount) > 0 && <p className="att-rule" style={{ gridColumn: '1 / -1', margin: 0 }}>Commission: <b>₹ {inr(amount)}</b></p>}
        </div>
      )}
    </Modal>
  );
}

// Agreed rates. When a policy is issued, its payin (and the associate's payout) is made from these.
function RatesModal({ open, onClose }) {
  const [rows, setRows] = useState([]);
  const [f, setF] = useState(null);
  const load = () => api('/commissions/rates').then(setRows).catch(() => setRows([]));
  useEffect(() => { if (open) load(); }, [open]);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  async function save() {
    try { if (f.id) await api('/commissions/rates/' + f.id, { method: 'PUT', body: f }); else await api('/commissions/rates', { method: 'POST', body: f }); toast.success('Rate saved'); setF(null); load(); }
    catch (e) { toast.error(e.message || 'Could not save'); }
  }
  async function del(r) {
    if (!(await confirm({ title: 'Delete this rate?', message: `${r.insurer || r.party || 'Any'} · ${r.product || 'any product'} · ${r.rate}%`, tone: 'danger', confirmText: 'Delete' }))) return;
    try { await api('/commissions/rates/' + r.id, { method: 'DELETE' }); load(); } catch (e) { toast.error(e.message); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Commission rates" subtitle="Used to make the payin and payout automatically when a policy is issued" icon="target" size="lg"
      footer={<><button className="btn ghost" onClick={() => setF({ kind: 'payin', insurer: '', product: '', party: '', rate: '', due_days: 30, on_od: false })}><Ic name="plus" size={14} /> Add rate</button><span style={{ flex: 1 }} /><button className="btn ghost" onClick={onClose}>Close</button></>}>
      {!rows.length && !f && <div className="hint-line">No rates yet. Add the payin rate each insurer pays (per product if it differs), and the payout rate for each associate.</div>}
      {rows.length > 0 && (
        <table className="grid dense">
          <thead><tr><th>Type</th><th>Insurer / associate</th><th>Product</th><th className="num">Rate</th><th>On</th><th className="num">Due in</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td>{r.kind === 'payin' ? 'Payin' : 'Payout'}</td><td>{r.kind === 'payout' ? r.party : (r.insurer || 'Any insurer')}</td><td>{r.product || 'Any'}</td>
              <td className="num">{r.rate}%</td><td>{r.on_od ? 'OD premium' : 'Net premium'}</td><td className="num">{r.due_days} days</td>
              <td className="dt-actions"><button className="action-btn" onClick={() => setF({ ...r, on_od: !!r.on_od })}><Ic name="edit" size={13} /></button><button className="action-btn danger" onClick={() => del(r)}><Ic name="trash" size={13} /></button></td></tr>
          ))}</tbody>
        </table>
      )}
      {f && (
        <div className="form-grid" style={{ marginTop: 12 }}>
          <div className="form-field"><label>Type</label><Select value={f.kind} onChange={(e) => set('kind', e.target.value)}><option value="payin">Payin — from the insurer</option><option value="payout">Payout — to an associate</option></Select></div>
          {f.kind === 'payout'
            ? <div className="form-field"><label>Associate / agency <span className="req">*</span></label><input value={f.party || ''} onChange={(e) => set('party', e.target.value)} placeholder="As written on the policy" /></div>
            : <div className="form-field"><label>Insurer</label><input value={f.insurer || ''} onChange={(e) => set('insurer', e.target.value)} placeholder="Blank = any insurer" /></div>}
          <div className="form-field"><label>Product</label><input value={f.product || ''} onChange={(e) => set('product', e.target.value)} placeholder="e.g. Health, Motor — blank = any" /></div>
          <div className="form-field"><label>Rate (%) <span className="req">*</span></label><input type="number" step="0.01" value={f.rate} onChange={(e) => set('rate', e.target.value)} /></div>
          <div className="form-field"><label>Worked on</label><Select value={f.on_od ? 'od' : 'net'} onChange={(e) => set('on_od', e.target.value === 'od')}><option value="net">Net premium</option><option value="od">Own-damage premium (motor)</option></Select></div>
          <div className="form-field"><label>Due in (days)</label><input type="number" value={f.due_days} onChange={(e) => set('due_days', e.target.value)} /></div>
          <div className="btn-row" style={{ gridColumn: '1 / -1' }}><button className="btn ghost sm" onClick={() => setF(null)}>Cancel</button><button className="btn blue sm" onClick={save}>Save rate</button></div>
        </div>
      )}
    </Modal>
  );
}

// An insurer's commission statement (Excel or CSV): each row is matched to the policy's pending payin, which is
// marked Received with the amount actually paid. Columns are found by name — policy no, amount, date, reference.
function StatementModal({ open, onClose, onDone }) {
  const [out, setOut] = useState(null);
  const [busy, setBusy] = useState(false);
  const [ref, setRef] = useState('');
  useEffect(() => { if (open) { setOut(null); setRef(''); } }, [open]);
  async function pick(file) {
    if (!file) return;
    setBusy(true);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
      const col = (r, re) => { const k = Object.keys(r).find((x) => re.test(x)); return k ? r[k] : ''; };
      const iso = (v) => { const s = String(v || '').trim(); const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : (/^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ''); };
      const rows = raw.map((r) => ({ policy_number: String(col(r, /polic/i)).trim(), amount: Number(String(col(r, /commission|brokerage|amount|net/i)).replace(/[^\d.-]/g, '')) || 0, date: iso(col(r, /date/i)), reference: String(col(r, /ref|utr|cheque/i)).trim() }))
        .filter((r) => r.policy_number || r.amount);
      if (!rows.length) { toast.error('No rows with a policy number and an amount were found'); return; }
      const res = await api('/commissions/statement', { method: 'POST', body: { rows, reference: ref || file.name } });
      setOut(res); onDone?.();
      toast.success(`${res.matched.length} matched, ${res.unmatched.length} not matched`);
    } catch (e) { toast.error(e.message || 'Could not read the statement'); }
    finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Match an insurer statement" subtitle="Excel or CSV with a policy number and the commission paid on each row" icon="upload" size="lg"
      footer={<button className="btn ghost" onClick={onClose}>Close</button>}>
      <div className="form-grid">
        <div className="form-field"><label>Statement reference</label><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. Care Health — October 2026" /></div>
        <div className="form-field"><label>File</label><input type="file" accept=".xlsx,.xls,.csv" disabled={busy} onChange={(e) => pick(e.target.files?.[0])} /></div>
      </div>
      {out && (
        <>
          <div className="section-head" style={{ marginTop: 12 }}>Matched ({out.matched.length})</div>
          {out.matched.length > 0 && <table className="grid dense"><thead><tr><th>Policy</th><th className="num">Expected</th><th className="num">Received</th><th className="num">Difference</th></tr></thead>
            <tbody>{out.matched.map((m) => <tr key={m.id}><td>{m.policy_number}</td><td className="num">₹ {inr(m.expected)}</td><td className="num">₹ {inr(m.received)}</td><td className={'num' + (m.variance < 0 ? ' overdue-date' : '')}>{m.variance === 0 ? '✓' : '₹ ' + inr(m.variance)}</td></tr>)}</tbody></table>}
          <div className="section-head" style={{ marginTop: 12 }}>Not matched ({out.unmatched.length})</div>
          {out.unmatched.length > 0 && <table className="grid dense"><thead><tr><th>Policy</th><th className="num">Amount</th><th>Why</th></tr></thead>
            <tbody>{out.unmatched.map((m, i) => <tr key={i}><td>{m.policy_number || '—'}</td><td className="num">₹ {inr(m.amount)}</td><td>{m.why}</td></tr>)}</tbody></table>}
        </>
      )}
    </Modal>
  );
}

export default function Commissions() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const [totals, setTotals] = useState(null);
  const [ratesOpen, setRatesOpen] = useState(false);
  const [stmt, setStmt] = useState(null);
  useOpenFromUrl(rows, loading, (r) => setEditing({ ...r }));
  const load = () => api('/commissions').then((d) => { setRows(d.rows || []); setTotals(d.totals || null); }).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  useEffect(() => {
    load();
    // ?policy=<id>&new=payin|payout — "Add commission" from a policy
    const q = new URLSearchParams(window.location.search);
    if (q.get('new')) {
      setEditing({ kind: q.get('new') === 'payout' ? 'payout' : 'payin', policy_id: Number(q.get('policy')) || undefined });
      window.history.replaceState(window.history.state, '', window.location.pathname);
    }
  }, []);
  useRealtime('commission', () => load());

  const shown = rows.filter((r) => (!kind || r.kind === kind) && (!status || (status === 'Overdue' ? r.overdue : r.status === status)));
  const sum = (fn) => rows.filter(fn).reduce((s, r) => s + Number(r.amount || 0), 0);
  // Totals come from the server, over every commission (not only the rows on screen).
  const T = totals || {};
  const kpis = [
    { key: 'in-due', label: 'Payin to receive', num: T.payin_due ?? sum((r) => r.kind === 'payin' && r.status === 'Pending'), tone: 'warning', set: () => { setKind('payin'); setStatus('Pending'); } },
    { key: 'in-got', label: 'Payin received', num: T.payin_got ?? sum((r) => r.kind === 'payin' && r.status === 'Received'), tone: 'success', set: () => { setKind('payin'); setStatus('Received'); } },
    { key: 'out-due', label: 'Payout to pay', num: T.payout_due ?? sum((r) => r.kind === 'payout' && r.status === 'Pending'), tone: 'warning', set: () => { setKind('payout'); setStatus('Pending'); } },
    { key: 'out-paid', label: 'Payout paid', num: T.payout_paid ?? sum((r) => r.kind === 'payout' && r.status === 'Paid'), tone: 'info', set: () => { setKind('payout'); setStatus('Paid'); } },
    { key: 'overdue', label: 'Overdue', num: T.overdue ?? rows.filter((r) => r.overdue).length, count: true, tone: 'danger', set: () => { setKind(''); setStatus('Overdue'); } },
  ];

  async function settle(r) {
    const ok = await confirm({ title: `Mark ${done(r.kind).toLowerCase()}?`, message: `₹ ${inr(r.amount)} · ${r.p_number || r.policy_number || ''} · ${r.party || ''}`, confirmText: `Mark ${done(r.kind)}`, icon: 'check' });
    if (!ok) return;
    try { await api('/commissions/' + r.id, { method: 'PUT', body: { status: done(r.kind) } }); toast.success(`Marked ${done(r.kind)}`); load(); }
    catch (e) { toast.error(e.message || 'Could not update'); }
  }
  async function del(r) {
    const ok = await confirm({ title: 'Delete this commission?', message: `₹ ${inr(r.amount)} · ${r.p_number || r.policy_number || ''}`, tone: 'danger', confirmText: 'Delete', icon: 'trash' });
    if (!ok) return;
    try { await api('/commissions/' + r.id, { method: 'DELETE' }); toast.success('Deleted'); load(); }
    catch (e) { toast.error(e.message || 'Could not delete'); }
  }
  function exportXlsx() {
    const sheet = XLSX.utils.json_to_sheet(shown.map((r) => ({
      Type: r.kind === 'payin' ? 'Payin' : 'Payout', 'Policy no': r.p_number || r.policy_number, Holder: r.p_insured || r.insured_name, Insurer: r.p_company || r.company_name,
      Party: r.party, Premium: Number(r.base_premium) || 0, 'Rate %': Number(r.rate) || 0, Amount: Number(r.amount) || 0, Status: r.status,
      'Due by': r.due_date ? fmtDate(r.due_date) : '', Settled: r.settled_date ? fmtDate(r.settled_date) : '', Reference: r.reference || '', Remarks: r.remarks || '',
    })));
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Commissions'); XLSX.writeFile(book, 'commissions.xlsx');
  }

  return (
    <div>
      <PageHeader title="Commissions" subtitle="Payin from insurers and payout to associates, against each policy"
        action={<>
          <button className="btn ghost" onClick={() => setStmt({})} title="Match an insurer's commission statement to the pending payins"><Ic name="upload" size={15} /> Match statement</button>
          <button className="btn ghost" onClick={() => setRatesOpen(true)} title="Agreed commission rates — payin and payout are made automatically when a policy is issued"><Ic name="target" size={15} /> Rates</button>
          <button className="btn blue" onClick={() => setEditing({ kind: 'payin' })}><Ic name="plus" size={16} /> Add commission</button>
        </>} />
      {Number(T.variance) !== 0 && T.variance !== undefined && <div className="hint-line" style={{ marginBottom: 10 }}>Received differs from expected by <b>₹ {inr(T.variance)}</b> in total — filter by Received and check the Difference column.</div>}
      <div className="kpi-grid five" style={{ marginBottom: 16 }}>
        {kpis.map((k) => (
          <div key={k.key} className="kpi-card kpi-link" data-tone={k.tone} role="button" tabIndex={0} onClick={k.set} onKeyDown={(e) => { if (e.key === 'Enter') k.set(); }}>
            <div className="kpi-card-head"><span className="kpi-card-label">{k.label}</span><span className="kpi-card-ic"><Ic name={k.count ? 'alert' : 'rupee'} size={17} /></span></div>
            <div className="kpi-card-num">{k.count ? k.num : '₹ ' + inr(Math.round(k.num))}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <DataTable
          title="Commissions"
          count={shown.length}
          loading={loading}
          rows={shown}
          onRowClick={(r) => setEditing({ ...r })}
          searchPlaceholder="Search holder, policy no, insurer, party…"
          searchKeys={['p_insured', 'insured_name', 'p_number', 'policy_number', 'p_company', 'party', 'reference']}
          onExport={exportXlsx}
          filters={[
            { key: 'kind', value: kind, onChange: (e) => setKind(e.target.value), options: [{ value: '', label: 'Payin & payout' }, { value: 'payin', label: 'Payin' }, { value: 'payout', label: 'Payout' }], predicate: () => true },
            { key: 'status', value: status, onChange: (e) => setStatus(e.target.value), options: [{ value: '', label: 'Any status' }, ...['Pending', 'Received', 'Paid', 'Overdue', 'Cancelled'].map((s) => ({ value: s, label: s }))], predicate: () => true },
          ]}
          footer={(vis) => ({ label: `Total · ${vis.length}`, amount: '₹ ' + inr(vis.reduce((s, r) => s + Number(r.amount || 0), 0)) })}
          columns={[
            { key: 'kind', label: 'Type', render: (r) => <span className={'badge ' + (r.kind === 'payin' ? 'blue' : '')}>{r.kind === 'payin' ? 'Payin' : 'Payout'}</span> },
            { key: 'p_number', label: 'Policy', render: (r) => <span><b>{r.p_insured || r.insured_name}</b><br /><span className="att-dow">{r.p_number || r.policy_number || '—'} · {r.p_company || r.company_name || ''}</span></span> },
            { key: 'party', label: 'From / to', render: (r) => r.party || '—' },
            { key: 'rate', label: 'Rate', num: true, render: (r) => (Number(r.rate) ? `${Number(r.rate)}%` : '—') },
            { key: 'amount', label: 'Amount', num: true, render: (r) => '₹ ' + inr(r.amount) },
            { key: 'variance', label: 'Difference', num: true, render: (r) => (r.variance === null || r.variance === undefined ? '—' : <span className={Number(r.variance) < 0 ? 'overdue-date' : ''}>{Number(r.variance) === 0 ? '✓' : '₹ ' + inr(r.variance)}</span>) },
            { key: 'due_date', label: 'Due by', render: (r) => (r.due_date ? <span className={r.overdue ? 'overdue-date' : ''}>{fmtDate(r.due_date)}</span> : '—') },
            { key: 'status', label: 'Status', render: (r) => <span className={'badge ' + (r.overdue ? 'red' : STATUS_BADGE[r.status] || '')}>{r.overdue ? 'Overdue' : r.status}{r.settled_date ? ` · ${fmtDate(r.settled_date)}` : ''}</span> },
          ]}
          actions={(r) => (
            <>
              {r.status === 'Pending' && <button className="action-btn" title={`Mark ${done(r.kind)}`} onClick={() => settle(r)}><Ic name="check" size={15} /></button>}
              <button className="action-btn" title="Edit" onClick={() => setEditing({ ...r })}><Ic name="edit" size={15} /></button>
              <button className="action-btn danger" title="Delete" onClick={() => del(r)}><Ic name="trash" size={15} /></button>
            </>
          )}
          empty={{ icon: 'rupee', title: 'No commissions yet', sub: 'Add the payin expected from the insurer for a policy, and any payout to an associate.' }}
        />
      </div>
      <CommissionModal open={!!editing} seed={editing} onClose={() => setEditing(null)} onSaved={load} />
      <RatesModal open={ratesOpen} onClose={() => setRatesOpen(false)} />
      <StatementModal open={!!stmt} onClose={() => setStmt(null)} onDone={load} />
    </div>
  );
}
