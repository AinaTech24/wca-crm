import { useEffect, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import { Ic } from '../components/Icons.jsx';
import { useRealtime } from '../realtime.js';
import Select from '../components/Select.jsx';
import DateField from '../components/DateField.jsx';

const badge = (s) => (s === 'New' ? 'blue' : s === 'Contacted' || s === 'Converted' ? 'green' : s === 'Lost' ? 'red' : 'orange');
const EMPTY = { lead_name: '', mobile: '', email: '', product_interest: '', source: 'Website', status: 'New', assigned_to: '', followup_date: '' };
const SOURCES = ['Website', 'Referral', 'Walk-in', 'Social Media', 'Cold Call', 'Existing Client'];
const STATUSES = ['New', 'Contacted', 'Follow Up', 'Converted', 'Lost'];

export default function Leads() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [f, setF] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [flash, setFlash] = useState(() => new Set());

  function load() { setLoading(true); api('/leads').then(setRows).finally(() => setLoading(false)); }
  useEffect(() => { load(); }, []);

  function markFlash(id) {
    if (id == null) return;
    setFlash((s) => new Set(s).add(id));
    setTimeout(() => setFlash((s) => { const n = new Set(s); n.delete(id); return n; }), 1600);
  }

  useRealtime('lead', (evt) => {
    const r = evt.data;
    setRows((prev) => {
      if (evt.action === 'created') return prev.some((x) => x.id === r.id) ? prev.map((x) => (x.id === r.id ? r : x)) : [r, ...prev];
      if (evt.action === 'updated') return prev.map((x) => (x.id === r.id ? r : x));
      return prev;
    });
    markFlash(r?.id);
  });

  const set = (k, v) => setF({ ...f, [k]: v });
  function openNew() { setF(EMPTY); setEditId(null); setShow(true); }
  function openEdit(r) {
    setF({ lead_name: r.lead_name || '', mobile: r.mobile || '', email: r.email || '', product_interest: r.product_interest || '', source: r.source || 'Website', status: r.status || 'New', assigned_to: r.assigned_to || '', followup_date: r.followup_date || '' });
    setEditId(r.id); setShow(true); window.scrollTo(0, 0);
  }
  async function save() {
    if (!f.lead_name.trim()) { toast.error('Lead Name is required'); return; }
    try {
      if (editId) { await api('/leads/' + editId, { method: 'PUT', body: f }); toast.success('Lead updated'); }
      else { await api('/leads', { method: 'POST', body: f }); toast.success('Lead added'); }
      setF(EMPTY); setEditId(null); setShow(false);
    } catch (e) { toast.error(e.message || 'Could not save lead'); }
  }

  const columns = [
    { key: 'lead_name', label: 'Lead Name' },
    { key: 'mobile', label: 'Mobile' },
    { key: 'email', label: 'Email', render: (r) => r.email || '—' },
    { key: 'product_interest', label: 'Product Interest' },
    { key: 'source', label: 'Source' },
    { key: 'assigned_to', label: 'Assigned To', render: (r) => r.assigned_to || '—' },
    { key: 'followup_date', label: 'Follow Up', render: (r) => r.followup_date || '—' },
    { key: 'status', label: 'Status', render: (r) => <span className={'badge ' + badge(r.status)}>{r.status}</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Lead View"
        subtitle="Prospective clients and enquiries"
        action={<button className="btn blue" onClick={() => (show ? setShow(false) : openNew())}>{show ? <><Ic name="x" size={15} /> Close</> : <><Ic name="plus" size={15} /> Add Lead</>}</button>}
      />

      {show && (
        <div className="card card-pad" style={{ marginBottom: 20 }}>
          <div className="section-head">{editId ? 'Edit Lead' : 'New Lead'}</div>
          <div className="form-grid">
            <div className="form-field"><label>Lead Name <span className="req">*</span></label><input value={f.lead_name} onChange={(e) => set('lead_name', e.target.value)} /></div>
            <div className="form-field"><label>Mobile</label><input value={f.mobile} onChange={(e) => set('mobile', e.target.value)} /></div>
            <div className="form-field"><label>Email</label><input value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
            <div className="form-field"><label>Product Interest</label><input value={f.product_interest} onChange={(e) => set('product_interest', e.target.value)} /></div>
            <div className="form-field"><label>Source</label><Select value={f.source} onChange={(e) => set('source', e.target.value)}>{SOURCES.map((s) => <option key={s}>{s}</option>)}</Select></div>
            <div className="form-field"><label>Status</label><Select value={f.status} onChange={(e) => set('status', e.target.value)}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</Select></div>
            <div className="form-field"><label>Assigned To</label><input value={f.assigned_to} onChange={(e) => set('assigned_to', e.target.value)} placeholder="Team member" /></div>
            <div className="form-field"><label>Follow Up Date</label><DateField value={f.followup_date} onChange={(e) => set('followup_date', e.target.value)} /></div>
          </div>
          <div className="btn-row"><button className="btn blue" onClick={save}>{editId ? 'Update Lead' : 'Save Lead'}</button><button className="btn ghost" onClick={() => setShow(false)}>Cancel</button></div>
        </div>
      )}

      <div className="card">
        <DataTable
          title={<>Leads <span className="sub">({rows.length})</span></>}
          searchPlaceholder="Search leads…"
          index
          loading={loading}
          rows={rows}
          flash={flash}
          columns={columns}
          onRowClick={openEdit}
          actions={(r) => <button className="action-btn" title="Edit" onClick={() => openEdit(r)}><Ic name="edit" size={15} /></button>}
          empty={{ icon: 'target', title: 'No leads yet', sub: 'Capture your first enquiry with “Add Lead”.' }}
        />
      </div>
    </div>
  );
}
