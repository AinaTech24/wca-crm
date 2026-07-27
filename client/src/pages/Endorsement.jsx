import { useEffect, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import { Ic } from '../components/Icons.jsx';
import { useRealtime } from '../realtime.js';
import Select from '../components/Select.jsx';
import DateField from '../components/DateField.jsx';

const TYPES = ['Nominee Change', 'Address Change', 'Sum Insured Increase', 'Sum Insured Decrease', 'Vehicle Transfer', 'NCB Correction', 'Cancellation', 'Other'];
const EMPTY = { policy_number: '', insured_name: '', company_name: '', endorsement_no: '', endorsement_type: '', endorsement_date: '', premium_effect: '', remarks: '' };

export default function Endorsement() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [f, setF] = useState(EMPTY);
  const [flash, setFlash] = useState(() => new Set());

  function load() { setLoading(true); api('/endorsements').then(setRows).finally(() => setLoading(false)); }
  useEffect(() => { load(); }, []);

  function markFlash(id) {
    if (id == null) return;
    setFlash((s) => new Set(s).add(id));
    setTimeout(() => setFlash((s) => { const n = new Set(s); n.delete(id); return n; }), 1600);
  }
  useRealtime('endorsement', (evt) => {
    if (evt.action !== 'created') return;
    const r = evt.data;
    setRows((prev) => (prev.some((x) => x.id === r.id) ? prev.map((x) => (x.id === r.id ? r : x)) : [r, ...prev]));
    markFlash(r.id);
  });

  async function save() {
    if (!f.policy_number.trim()) { toast.error('Policy Number is required'); return; }
    try {
      await api('/endorsements', { method: 'POST', body: f });
      toast.success('Endorsement saved');
      setShow(false); setF(EMPTY);
    } catch (e) { toast.error(e.message || 'Could not save endorsement'); }
  }
  const set = (k, v) => setF({ ...f, [k]: v });

  const columns = [
    { key: 'endorsement_no', label: 'Endo No' },
    { key: 'policy_number', label: 'Policy No' },
    { key: 'insured_name', label: 'Insured Name' },
    { key: 'company_name', label: 'Company' },
    { key: 'endorsement_type', label: 'Type', render: (r) => <span className="badge blue">{r.endorsement_type}</span> },
    { key: 'endorsement_date', label: 'Date' },
    { key: 'premium_effect', label: 'Premium Effect', num: true, render: (r) => Number(r.premium_effect || 0).toLocaleString('en-IN') },
  ];

  return (
    <div>
      <PageHeader
        title="Endorsement"
        subtitle="Policy amendments and mid-term changes"
        action={<button className="btn blue" onClick={() => setShow(!show)}>{show ? <><Ic name="x" size={15} /> Close</> : <><Ic name="plus" size={15} /> Add Endorsement</>}</button>}
      />

      <div className="card card-pad" style={{ marginBottom: 22, display: show ? 'block' : 'none' }}>
        {show && (
          <>
            <div className="section-head">Endorsement Details</div>
            <div className="form-grid">
              <div className="form-field"><label>Policy Number <span className="req">*</span></label><input value={f.policy_number} onChange={(e) => set('policy_number', e.target.value)} /></div>
              <div className="form-field"><label>Insured Name</label><input value={f.insured_name} onChange={(e) => set('insured_name', e.target.value)} /></div>
              <div className="form-field"><label>Company Name</label><input value={f.company_name} onChange={(e) => set('company_name', e.target.value)} /></div>
              <div className="form-field"><label>Endorsement No</label><input value={f.endorsement_no} onChange={(e) => set('endorsement_no', e.target.value)} /></div>
              <div className="form-field"><label>Endorsement Type</label>
                <Select value={f.endorsement_type} onChange={(e) => set('endorsement_type', e.target.value)}>
                  <option value="">-Select-</option>{TYPES.map((t) => <option key={t}>{t}</option>)}
                </Select>
              </div>
              <div className="form-field"><label>Endorsement Date</label><DateField value={f.endorsement_date} onChange={(e) => set('endorsement_date', e.target.value)} /></div>
              <div className="form-field"><label>Premium Effect (₹)</label><input type="number" value={f.premium_effect} onChange={(e) => set('premium_effect', e.target.value)} /></div>
              <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Remarks</label><input value={f.remarks} onChange={(e) => set('remarks', e.target.value)} /></div>
            </div>
            <div className="btn-row"><button className="btn blue" onClick={save}>Save Endorsement</button><button className="btn ghost" onClick={() => setShow(false)}>Cancel</button></div>
          </>
        )}
      </div>

      <div className="card">
        <DataTable
          title={<>Endorsements <span className="sub">({rows.length})</span></>}
          searchPlaceholder="Search endorsements…"
          index
          loading={loading}
          rows={rows}
          flash={flash}
          columns={columns}
          empty={{ icon: 'edit', title: 'No endorsements yet', sub: 'Record a mid-term change with “Add Endorsement”.' }}
        />
      </div>
    </div>
  );
}
