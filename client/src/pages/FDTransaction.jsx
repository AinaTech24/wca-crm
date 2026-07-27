import { useEffect, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import { Ic } from '../components/Icons.jsx';
import { useRealtime } from '../realtime.js';
import Select from '../components/Select.jsx';
import DateField from '../components/DateField.jsx';

const EMPTY = { client_name: '', scheme_name: '', company_name: '', fd_number: '', amount: '', interest_rate: '', tenure_months: '', start_date: '', maturity_date: '', maturity_amount: '', status: 'Active' };
const inr = (v) => Number(v || 0).toLocaleString('en-IN');

export default function FDTransaction() {
  const [rows, setRows] = useState([]);
  const [schemes, setSchemes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [f, setF] = useState(EMPTY);
  const [flash, setFlash] = useState(() => new Set());

  function load() { setLoading(true); api('/fd-transactions').then(setRows).finally(() => setLoading(false)); }
  useEffect(() => { load(); api('/lookups/fd-scheme-master').then(setSchemes).catch(() => {}); }, []);

  function markFlash(id) {
    if (id == null) return;
    setFlash((s) => new Set(s).add(id));
    setTimeout(() => setFlash((s) => { const n = new Set(s); n.delete(id); return n; }), 1600);
  }
  useRealtime('fd', (evt) => {
    if (evt.action !== 'created') return;
    const r = evt.data;
    setRows((prev) => (prev.some((x) => x.id === r.id) ? prev.map((x) => (x.id === r.id ? r : x)) : [r, ...prev]));
    markFlash(r.id);
  });

  const set = (k, v) => setF({ ...f, [k]: v });
  async function save() {
    if (!f.client_name.trim()) { toast.error('Client Name is required'); return; }
    try { await api('/fd-transactions', { method: 'POST', body: f }); toast.success('FD saved'); setShow(false); setF(EMPTY); }
    catch (e) { toast.error(e.message || 'Could not save FD'); }
  }

  const columns = [
    { key: 'fd_number', label: 'FD No' },
    { key: 'client_name', label: 'Client Name' },
    { key: 'scheme_name', label: 'Scheme' },
    { key: 'company_name', label: 'Company / Bank' },
    { key: 'amount', label: 'Amount', num: true, render: (r) => inr(r.amount) },
    { key: 'interest_rate', label: 'Rate %', num: true },
    { key: 'tenure_months', label: 'Tenure', num: true, render: (r) => `${r.tenure_months}m` },
    { key: 'maturity_date', label: 'Maturity Date' },
    { key: 'maturity_amount', label: 'Maturity Amt', num: true, render: (r) => inr(r.maturity_amount) },
    { key: 'status', label: 'Status', render: (r) => <span className="badge green">{r.status}</span> },
  ];

  return (
    <div>
      <PageHeader
        title="FD Transaction"
        subtitle="Fixed deposit register and maturities"
        action={<button className="btn blue" onClick={() => setShow(!show)}>{show ? <><Ic name="x" size={15} /> Close</> : <><Ic name="plus" size={15} /> Add New FD</>}</button>}
      />

      <div className="card card-pad" style={{ marginBottom: 22, display: show ? 'block' : 'none' }}>
        {show && (
          <>
            <div className="section-head">Fixed Deposit Details</div>
            <div className="form-grid">
              <div className="form-field"><label>Client Name <span className="req">*</span></label><input value={f.client_name} onChange={(e) => set('client_name', e.target.value)} /></div>
              <div className="form-field"><label>Scheme Name</label>
                <Select value={f.scheme_name} onChange={(e) => set('scheme_name', e.target.value)}>
                  <option value="">-Select-</option>{schemes.map((s) => <option key={s.id}>{s.name}</option>)}
                </Select>
              </div>
              <div className="form-field"><label>Company / Bank</label><input value={f.company_name} onChange={(e) => set('company_name', e.target.value)} /></div>
              <div className="form-field"><label>FD Number</label><input value={f.fd_number} onChange={(e) => set('fd_number', e.target.value)} /></div>
              <div className="form-field"><label>Amount (₹)</label><input type="number" value={f.amount} onChange={(e) => set('amount', e.target.value)} /></div>
              <div className="form-field"><label>Interest Rate (%)</label><input type="number" value={f.interest_rate} onChange={(e) => set('interest_rate', e.target.value)} /></div>
              <div className="form-field"><label>Tenure (months)</label><input type="number" value={f.tenure_months} onChange={(e) => set('tenure_months', e.target.value)} /></div>
              <div className="form-field"><label>Start Date</label><DateField value={f.start_date} onChange={(e) => set('start_date', e.target.value)} /></div>
              <div className="form-field"><label>Maturity Date</label><DateField value={f.maturity_date} onChange={(e) => set('maturity_date', e.target.value)} /></div>
              <div className="form-field"><label>Maturity Amount (₹)</label><input type="number" value={f.maturity_amount} onChange={(e) => set('maturity_amount', e.target.value)} /></div>
            </div>
            <div className="btn-row"><button className="btn blue" onClick={save}>Save FD</button><button className="btn ghost" onClick={() => setShow(false)}>Cancel</button></div>
          </>
        )}
      </div>

      <div className="card">
        <DataTable
          title={<>Fixed Deposits <span className="sub">({rows.length})</span></>}
          searchPlaceholder="Search fixed deposits…"
          index
          loading={loading}
          rows={rows}
          flash={flash}
          columns={columns}
          empty={{ icon: 'bank', title: 'No fixed deposits', sub: 'Record a new FD with “Add New FD”.' }}
        />
      </div>
    </div>
  );
}
