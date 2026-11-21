// The parts of a saved policy below its form: its renewal RFQ, its commissions and its endorsements.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import toast from '../components/toast.js';
import confirm from '../components/confirm.js';
import DateField, { fmt as fmtDate } from '../components/DateField.jsx';
import { Ic } from '../components/Icons.jsx';
import Modal from '../components/Modal.jsx';
import { CommissionModal } from './Commissions.jsx';
import { showBlob } from '../components/openFile.js';
import Select from '../components/Select.jsx';

const inr = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

function RenewalLine({ policy }) {
  const navigate = useNavigate();
  const [rfq, setRfq] = useState(undefined);
  useEffect(() => { api(`/policies/${policy.id}/renewal-rfq`).then((d) => setRfq(d.rfq)).catch(() => setRfq(null)); }, [policy.id]);
  if (policy.renewable !== 'Yes' || rfq === undefined) return null;
  async function raise() {
    try { const r = await api(`/policies/${policy.id}/renewal-rfq`, { method: 'POST' }); toast.success(`Renewal RFQ ${r.rfq_no} raised`); navigate('/page/rfq?open=' + r.id); }
    catch (e) { toast.error(e.message || 'Could not raise it'); }
  }
  return (
    <div className="pol-x-line">
      <Ic name="refresh" size={15} />
      {rfq
        ? <span>Renewal RFQ <button type="button" className="dt-link" onClick={() => navigate('/page/rfq?open=' + rfq.id)}>{rfq.rfq_no}</button> · {rfq.status}{rfq.policy_id ? ` · renewed as a new policy` : ''}</span>
        : <span>No renewal RFQ yet{policy.period_to ? ` (expires ${fmtDate(String(policy.period_to).slice(0, 10))})` : ''}.</span>}
      {!rfq && <button type="button" className="btn ghost sm" onClick={raise}><Ic name="plus" size={13} /> Raise renewal RFQ</button>}
    </div>
  );
}

function Commissions({ policy }) {
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);
  const load = () => api(`/commissions?policy_id=${policy.id}`).then((d) => setRows(d.rows || [])).catch(() => setRows([]));
  useEffect(() => { load(); }, [policy.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const seed = (kind) => ({ kind, policy_id: policy.id, lockPolicy: true, policyLabel: `${policy.insured_name} · ${policy.policy_number || 'no number'} · ${policy.company_name || ''}`,
    base_premium: policy.net_premium || '', party: kind === 'payin' ? policy.company_name : policy.associate });
  return (
    <div className="sub-section">
      <div className="section-head">Commissions
        <span className="pol-x-acts">
          <button type="button" className="btn ghost sm" onClick={() => setEditing(seed('payin'))}><Ic name="plus" size={13} /> Payin</button>
          <button type="button" className="btn ghost sm" onClick={() => setEditing(seed('payout'))}><Ic name="plus" size={13} /> Payout</button>
        </span>
      </div>
      {rows && !rows.length && <div className="hint-line">None yet — add the payin expected from {policy.company_name || 'the insurer'}{policy.associate ? `, and the payout to ${policy.associate}` : ''}.</div>}
      {rows && rows.length > 0 && (
        <table className="grid dense">
          <thead><tr><th>Type</th><th>From / to</th><th className="num">Rate</th><th className="num">Amount</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="dt-click" onClick={() => setEditing({ ...r, lockPolicy: true, policyLabel: seed(r.kind).policyLabel })}>
                <td>{r.kind === 'payin' ? 'Payin' : 'Payout'}</td><td>{r.party || '—'}</td><td className="num">{Number(r.rate) ? `${Number(r.rate)}%` : '—'}</td>
                <td className="num">₹ {inr(r.amount)}</td><td>{r.due_date ? fmtDate(r.due_date) : '—'}</td>
                <td><span className={'badge ' + (r.overdue ? 'red' : r.status === 'Pending' ? 'orange' : r.status === 'Cancelled' ? '' : 'green')}>{r.overdue ? 'Overdue' : r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <CommissionModal open={!!editing} seed={editing} onClose={() => setEditing(null)} onSaved={load} />
    </div>
  );
}

// Standard endorsement kinds — a Cancellation closes the policy; a new sum insured, nominee or registration number
// is written onto the policy once the endorsement is Issued.
const ENDO_KINDS = ['Cancellation', 'Sum Insured Change', 'Nominee Change', 'Registration No Update', 'Vehicle Transfer', 'Address Change', 'Hypothecation Addition', 'Hypothecation Removal', 'NCB Correction', 'Nil Endorsement'];
const readAsData = (file) => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(file); });

function Endorsements({ policy }) {
  const [rows, setRows] = useState(null);
  const [f, setF] = useState(null);
  const load = () => api(`/endorsements?policy_id=${policy.id}`).then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, [policy.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  async function save() {
    try {
      if (f.id) await api('/endorsements/' + f.id, { method: 'PUT', body: f });
      else await api('/endorsements', { method: 'POST', body: { ...f, policy_id: policy.id } });
      toast.success('Endorsement saved'); setF(null); load();
    } catch (e) { toast.error(e.message || 'Could not save'); }
  }
  async function del(r) {
    const ok = await confirm({ title: 'Delete this endorsement?', message: `${r.endorsement_type}${r.endorsement_no ? ' · ' + r.endorsement_no : ''}`, tone: 'danger', confirmText: 'Delete', icon: 'trash' });
    if (!ok) return;
    try { await api('/endorsements/' + r.id, { method: 'DELETE' }); load(); } catch (e) { toast.error(e.message || 'Could not delete'); }
  }
  const effect = (rows || []).reduce((s, r) => s + Number(r.premium_effect || 0), 0);
  return (
    <div className="sub-section">
      <div className="section-head">Endorsements
        <span className="pol-x-acts"><button type="button" className="btn ghost sm" onClick={() => setF({ endorsement_type: '', endorsement_date: new Date().toLocaleDateString('sv-SE'), premium_effect: '' })}><Ic name="plus" size={13} /> Endorsement</button></span>
      </div>
      {rows && !rows.length && !f && <div className="hint-line">No changes since the policy was issued.</div>}
      {rows && rows.length > 0 && (
        <table className="grid dense">
          <thead><tr><th>Date</th><th>No</th><th>What changed</th><th>Status</th><th className="num">Premium effect</th><th>Remarks</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.endorsement_date ? fmtDate(r.endorsement_date) : '—'}</td><td>{r.endorsement_no || '—'}</td><td>{r.endorsement_type}{r.new_value ? ` → ${r.new_value}` : ''}{r.has_document && <> · <button type="button" className="dt-link" onClick={() => api(`/endorsements/${r.id}/document`).then((d) => fetch(d.data)).then((x) => x.blob()).then((b) => showBlob(b, r.document_name)).catch(() => toast.error('Could not open it'))}>copy</button></>}</td>
                <td><span className={'badge ' + (r.status === 'Issued' ? 'green' : 'orange')}>{r.status || 'Issued'}</span>{r.applied_at ? <span className="att-dow"> · applied</span> : ''}</td>
                <td className="num">{Number(r.premium_effect) ? `₹ ${inr(r.premium_effect)}` : '—'}</td><td>{r.remarks || '—'}</td>
                <td className="dt-actions"><button type="button" className="action-btn" title="Edit" onClick={() => setF({ ...r })}><Ic name="edit" size={13} /></button>
                  <button type="button" className="action-btn danger" title="Delete" onClick={() => del(r)}><Ic name="trash" size={13} /></button></td>
              </tr>
            ))}
          </tbody>
          {effect !== 0 && <tfoot><tr className="dt-foot"><td colSpan={4}>Premium after endorsements: ₹ {inr(Number(policy.final_premium || 0) + effect)}</td><td className="num">₹ {inr(effect)}</td><td colSpan={2} /></tr></tfoot>}
        </table>
      )}
      <datalist id="endo-kinds">{ENDO_KINDS.map((k) => <option key={k} value={k} />)}</datalist>
      {f && (
        <div className="form-grid endo-form">
          <div className="form-field"><label>Status</label><Select value={f.status || 'Issued'} onChange={(e) => set('status', e.target.value)}>{['Requested', 'With insurer', 'Issued'].map((s) => <option key={s} value={s}>{s}</option>)}</Select></div>
          {/sum insured|nominee|registration|vehicle/i.test(f.endorsement_type || '') && <div className="form-field"><label>New {/sum insured/i.test(f.endorsement_type) ? 'sum insured (₹)' : /nominee/i.test(f.endorsement_type) ? 'nominee' : 'registration no'}</label><input value={f.new_value || ''} onChange={(e) => set('new_value', e.target.value)} /></div>}
          {/cancel/i.test(f.endorsement_type || '') && <p className="doc-hint" style={{ gridColumn: '1 / -1', margin: 0 }}><Ic name="alert" size={13} /> Once Issued, the policy is marked Cancelled and inactive, its renewal stops, pending commission is cancelled, and any commission already received is flagged for clawback.</p>}
          <div className="form-field"><label>Insurer's endorsement copy</label><input type="file" accept="application/pdf,image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (file) { if (file.size > 8 * 1024 * 1024) { toast.error('Larger than 8 MB'); return; } set('document', await readAsData(file)); set('document_name', file.name); } }} />{f.document_name && <div className="hint-line">{f.document_name}</div>}</div>
          <div className="form-field"><label>What changed <span className="req">*</span></label><input list="endo-kinds" value={f.endorsement_type} onChange={(e) => set('endorsement_type', e.target.value)} placeholder="e.g. Vehicle change, SI increase, address" /></div>
          <div className="form-field"><label>Endorsement no</label><input value={f.endorsement_no || ''} onChange={(e) => set('endorsement_no', e.target.value)} /></div>
          <div className="form-field"><label>Date</label><DateField typeable value={f.endorsement_date || ''} onChange={(e) => set('endorsement_date', e.target.value)} /></div>
          <div className="form-field"><label>Premium effect (₹, minus for a refund)</label><input type="number" value={f.premium_effect} onChange={(e) => set('premium_effect', e.target.value)} /></div>
          <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Remarks</label><input value={f.remarks || ''} onChange={(e) => set('remarks', e.target.value)} /></div>
          <div className="btn-row" style={{ gridColumn: '1 / -1' }}><button type="button" className="btn ghost sm" onClick={() => setF(null)}>Cancel</button><button type="button" className="btn blue sm" onClick={save}>Save endorsement</button></div>
        </div>
      )}
    </div>
  );
}

export default function PolicyExtras({ policy }) {
  if (!policy?.id) return null;
  return (
    <>
      <RenewalLine policy={policy} />
      <Commissions policy={policy} />
      <Endorsements policy={policy} />
    </>
  );
}

// Admin: raise renewal RFQs automatically, and how far ahead. Shows how many each choice would raise now.
export function RenewalRfqSettings({ open, onClose }) {
  const [s, setS] = useState(null);
  const [days, setDays] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) api('/renewal-rfq-settings').then((d) => { setS(d); setDays(String(d.days || 0)); }).catch(() => setS({ days: 0, preview: {} })); }, [open]);
  async function save() {
    setSaving(true);
    try { const d = await api('/renewal-rfq-settings', { method: 'PUT', body: { days: Number(days) || 0 } }); toast.success(d.days ? `Renewal RFQs will be raised ${d.days} days before expiry` : 'Automatic renewal RFQs are off'); onClose(); }
    catch (e) { toast.error(e.message || 'Could not save'); }
    finally { setSaving(false); }
  }
  const n = Number(days) || 0;
  const preview = s?.preview?.[n];
  return (
    <Modal open={open} onClose={onClose} title="Renewal RFQs" subtitle="Raise the renewal RFQ by itself before a policy expires" icon="refresh" size="md"
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn blue" onClick={save} disabled={saving || !s}>{saving ? 'Saving…' : 'Save'}</button></>}>
      {!s ? <div className="no-data">Loading…</div> : (
        <>
          <div className="report-presets">
            {[['0', 'Off'], ['15', '15 days'], ['30', '30 days'], ['45', '45 days'], ['60', '60 days']].map(([v, l]) => (
              <button key={v} type="button" className={'chip-btn' + (String(n) === v ? ' active' : '')} onClick={() => setDays(v)}>{l}{v !== '0' && s.preview?.[v] !== undefined ? ` · ${s.preview[v]}` : ''}</button>
            ))}
          </div>
          <p className="att-rule" style={{ marginTop: 12 }}>
            {n ? <>A renewal RFQ is raised for each renewable policy <b>{n} days</b> before it expires — client, product, previous insurer, policy no, expiry, registration and sum insured filled in — and given to the policy&apos;s owner.
              {preview !== undefined && <> Right now that would raise <b>{preview}</b> RFQ{preview === 1 ? '' : 's'}{preview > s.max_per_run ? `, ${s.max_per_run} at a time, soonest expiry first` : ''}.</>}
              {' '}Converting it renews the old policy; losing it marks the renewal Lost.</>
              : 'Off — renewal RFQs are raised only by hand, from a policy (“Raise renewal RFQ”).'}
          </p>
        </>
      )}
    </Modal>
  );
}
