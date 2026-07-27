import { useEffect, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import confirm from '../components/confirm.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import { Ic } from '../components/Icons.jsx';

const EMPTY = { company_name: '', claim_email: '', support_phone: '' };

export default function ClaimIntimationMaster() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  function load() { setLoading(true); api('/company-emails').then(setRows).finally(() => setLoading(false)); }
  useEffect(() => { load(); }, []);

  const set = (k, v) => setF({ ...f, [k]: v });
  function openNew() { setF(EMPTY); setEditId(null); setShow(true); }
  function openEdit(r) { setF({ company_name: r.company_name, claim_email: r.claim_email || '', support_phone: r.support_phone || '' }); setEditId(r.id); setShow(true); }

  async function save() {
    if (!f.company_name.trim()) { toast.error('Company Name is required'); return; }
    setSaving(true);
    try {
      if (editId) { await api('/company-emails/' + editId, { method: 'PUT', body: f }); toast.success('Updated'); }
      else { await api('/company-emails', { method: 'POST', body: f }); toast.success('Added'); }
      setF(EMPTY); setEditId(null); setShow(false); load();
    } catch (e) { toast.error(e.message || 'Could not save'); }
    finally { setSaving(false); }
  }
  async function del(r) {
    const ok = await confirm({ title: 'Delete this entry?', message: `Claim contact for “${r.company_name}” will be removed.`, tone: 'danger', confirmText: 'Delete', icon: 'trash' });
    if (!ok) return;
    const snap = rows;
    setRows((prev) => prev.filter((x) => x.id !== r.id));
    try { await api('/company-emails/' + r.id, { method: 'DELETE' }); toast.success('Deleted'); }
    catch (e) { setRows(snap); toast.error(e.message || 'Could not delete'); }
  }

  const columns = [
    { key: 'company_name', label: 'Company Name' },
    { key: 'claim_email', label: 'Claim Email', render: (r) => r.claim_email || '—' },
    { key: 'support_phone', label: 'Support Phone', render: (r) => r.support_phone || '—' },
  ];

  return (
    <div>
      <PageHeader
        title="Claim Intimation Master"
        subtitle="Insurer claim contact directory"
        action={<button className="btn blue" onClick={openNew}><Ic name="plus" size={16} /> Add New</button>}
      />

      <div className="card">
          <DataTable
            title="Company Claim Contacts"
            count={rows.length}
            index
            loading={loading}
            rows={rows}
            columns={columns}
            searchPlaceholder="Search company…"
            actions={(r) => (
              <>
                <button className="action-btn" title="Edit" onClick={() => openEdit(r)}><Ic name="edit" size={15} /></button>
                <button className="action-btn danger" title="Delete" onClick={() => del(r)}><Ic name="trash" size={15} /></button>
              </>
            )}
            empty={{ icon: 'mail', title: 'No claim contacts', sub: 'Add insurer claim emails and phone numbers with “Add New”.' }}
          />
      </div>

      <Modal
        open={show}
        onClose={() => setShow(false)}
        title={editId ? 'Edit Claim Contact' : 'New Claim Contact'}
        subtitle="Insurer claim intimation details"
        icon="mail"
        size="md"
        footer={
          <>
            <button className="btn ghost" onClick={() => setShow(false)}>Cancel</button>
            <button className="btn blue" onClick={save} disabled={saving}>{saving ? 'Saving…' : editId ? 'Update' : 'Save'}</button>
          </>
        }
      >
        <div className="form-grid two">
          <div className="form-field"><label>Company Name <span className="req">*</span></label><input autoFocus value={f.company_name} onChange={(e) => set('company_name', e.target.value)} /></div>
          <div className="form-field"><label>Claim Intimation Email</label><input value={f.claim_email} onChange={(e) => set('claim_email', e.target.value)} /></div>
          <div className="form-field"><label>Support Phone</label><input value={f.support_phone} onChange={(e) => set('support_phone', e.target.value)} /></div>
        </div>
      </Modal>
    </div>
  );
}
