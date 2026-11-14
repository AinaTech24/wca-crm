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
          {['Received', 'Paid'].includes(f.status) && <div className="form-field"><label>{f.status} on</label><DateField typeable value={f.settled_date || ''} onChange={(e) => set('settled_date', e.target.value)} /></div>}
          <div className="form-field"><label>Reference (UTR / cheque / statement)</label><input value={f.reference || ''} onChange={(e) => set('reference', e.target.value)} /></div>
          <div className="form-field" style={{ gridColumn: '1 / -1' }}><label>Remarks</label><input value={f.remarks || ''} onChange={(e) => set('remarks', e.target.value)} /></div>
          {Number(amount) > 0 && <p className="att-rule" style={{ gridColumn: '1 / -1', margin: 0 }}>Commission: <b>₹ {inr(amount)}</b></p>}
        </div>
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
  useOpenFromUrl(rows, loading, (r) => setEditing({ ...r }));
  const load = () => api('/commissions').then((d) => setRows(d.rows || [])).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
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
  const kpis = [
    { key: 'in-due', label: 'Payin to receive', num: sum((r) => r.kind === 'payin' && r.status === 'Pending'), tone: 'warning', set: () => { setKind('payin'); setStatus('Pending'); } },
    { key: 'in-got', label: 'Payin received', num: sum((r) => r.kind === 'payin' && r.status === 'Received'), tone: 'success', set: () => { setKind('payin'); setStatus('Received'); } },
    { key: 'out-due', label: 'Payout to pay', num: sum((r) => r.kind === 'payout' && r.status === 'Pending'), tone: 'warning', set: () => { setKind('payout'); setStatus('Pending'); } },
    { key: 'out-paid', label: 'Payout paid', num: sum((r) => r.kind === 'payout' && r.status === 'Paid'), tone: 'info', set: () => { setKind('payout'); setStatus('Paid'); } },
    { key: 'overdue', label: 'Overdue', num: rows.filter((r) => r.overdue).length, count: true, tone: 'danger', set: () => { setKind(''); setStatus('Overdue'); } },
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
        action={<button className="btn blue" onClick={() => setEditing({ kind: 'payin' })}><Ic name="plus" size={16} /> Add commission</button>} />
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
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
    </div>
  );
}
