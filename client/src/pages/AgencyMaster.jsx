import { useEffect, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import confirm from '../components/confirm.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import { Ic } from '../components/Icons.jsx';
import { useRealtime } from '../realtime.js';
import Select from '../components/Select.jsx';

const EMPTY = { agency_name: '', type: 'GI', contact_person: '', mobile: '', email: '', city: '' };

export default function AgencyMaster() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [f, setF] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [flash, setFlash] = useState(() => new Set());
  const [typeFilter, setTypeFilter] = useState('all');

  function load() { setLoading(true); api('/masters/agencies').then(setRows).finally(() => setLoading(false)); }
  useEffect(() => { load(); }, []);

  function markFlash(id) {
    if (id == null) return;
    setFlash((s) => new Set(s).add(id));
    setTimeout(() => setFlash((s) => { const n = new Set(s); n.delete(id); return n; }), 1600);
  }
  useRealtime('agency', (evt) => {
    setRows((prev) => {
      if (evt.action === 'deleted') return prev.filter((r) => r.id !== evt.data.id);
      const r = evt.data;
      if (evt.action === 'updated') return prev.map((x) => (x.id === r.id ? r : x));
      if (evt.action === 'created') return prev.some((x) => x.id === r.id) ? prev : [...prev, r].sort((a, b) => a.agency_name.localeCompare(b.agency_name));
      return prev;
    });
    markFlash(evt.data?.id);
  });

  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF({ ...f, [k]: v });
  function openNew() { setF(EMPTY); setEditId(null); setShow(true); }
  function openEdit(r) {
    setF({ agency_name: r.agency_name || '', type: r.type || 'GI', contact_person: r.contact_person || '', mobile: r.mobile || '', email: r.email || '', city: r.city || '' });
    setEditId(r.id); setShow(true);
  }
  async function save() {
    if (!f.agency_name.trim()) { toast.error('Agency Name is required'); return; }
    setSaving(true);
    try {
      if (editId) { await api('/agencies/' + editId, { method: 'PUT', body: f }); toast.success('Agency updated'); }
      else { await api('/agencies', { method: 'POST', body: f }); toast.success('Agency added'); }
      setF(EMPTY); setEditId(null); setShow(false);
    } catch (e) { toast.error(e.message || 'Could not save agency'); }
    finally { setSaving(false); }
  }
  async function del(r) {
    const ok = await confirm({ title: 'Delete agency?', message: `“${r.agency_name}” will be permanently removed.`, tone: 'danger', confirmText: 'Delete', icon: 'trash' });
    if (!ok) return;
    const snap = rows;
    setRows((prev) => prev.filter((x) => x.id !== r.id));
    try { await api('/agencies/' + r.id, { method: 'DELETE' }); toast.success('Agency deleted'); }
    catch (e) { setRows(snap); toast.error(e.message || 'Could not delete'); }
  }

  const columns = [
    { key: 'agency_name', label: 'Agency Name' },
    { key: 'type', label: 'Type', render: (r) => <span className="badge blue">{r.type}</span> },
    { key: 'contact_person', label: 'Contact Person', render: (r) => r.contact_person || '—' },
    { key: 'mobile', label: 'Mobile', render: (r) => r.mobile || '—' },
    { key: 'city', label: 'City', render: (r) => r.city || '—' },
  ];

  return (
    <div>
      <PageHeader
        title="Agency Master"
        subtitle="Registered insurance agencies"
        action={<button className="btn blue" onClick={openNew}><Ic name="plus" size={16} /> Add Agency</button>}
      />

      <div className="card">
          <DataTable
            title="Agencies"
            count={rows.length}
            index
            loading={loading}
            rows={rows}
            flash={flash}
            columns={columns}
            onRowClick={openEdit}
            searchPlaceholder="Search agencies…"
            filters={[{
              key: 'type', value: typeFilter, onChange: (e) => setTypeFilter(e.target.value),
              options: [{ value: 'all', label: 'All Types' }, { value: 'GI', label: 'General Insurance' }, { value: 'LI', label: 'Life Insurance' }, { value: 'FD', label: 'Fixed Deposit' }],
            }]}
            actions={(r) => (
              <>
                <button className="action-btn" title="Edit" onClick={() => openEdit(r)}><Ic name="edit" size={15} /></button>
                <button className="action-btn danger" title="Delete" onClick={() => del(r)}><Ic name="trash" size={15} /></button>
              </>
            )}
            empty={{ icon: 'user', title: 'No agencies yet', sub: 'Register your first agency with “Add Agency”.' }}
          />
      </div>

      <Modal
        open={show}
        onClose={() => setShow(false)}
        title={editId ? 'Edit Agency' : 'New Agency'}
        subtitle="Agency contact and category details"
        icon="user"
        size="md"
        footer={
          <>
            <button className="btn ghost" onClick={() => setShow(false)}>Cancel</button>
            <button className="btn blue" onClick={save} disabled={saving}>{saving ? 'Saving…' : editId ? 'Update Agency' : 'Save Agency'}</button>
          </>
        }
      >
        <div className="form-grid two">
          <div className="form-field"><label>Agency Name <span className="req">*</span></label><input autoFocus value={f.agency_name} onChange={(e) => set('agency_name', e.target.value)} /></div>
          <div className="form-field"><label>Type</label><Select value={f.type} onChange={(e) => set('type', e.target.value)}><option value="GI">General Insurance</option><option value="LI">Life Insurance</option><option value="FD">Fixed Deposit</option></Select></div>
          <div className="form-field"><label>Contact Person</label><input value={f.contact_person} onChange={(e) => set('contact_person', e.target.value)} /></div>
          <div className="form-field"><label>Mobile</label><input value={f.mobile} onChange={(e) => set('mobile', e.target.value)} /></div>
          <div className="form-field"><label>Email</label><input value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
          <div className="form-field"><label>City</label><input value={f.city} onChange={(e) => set('city', e.target.value)} /></div>
        </div>
      </Modal>
    </div>
  );
}
