import { useEffect, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import confirm from '../components/confirm.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import { Ic } from '../components/Icons.jsx';
import { useRealtime } from '../realtime.js';

// Generic "add + search + list" master used by Make, Model, Risk Type,
// Occupancy, Add On, Content Master, HPA, Product Master, FD Scheme, etc.
// New/Edit entries open in a popup modal.
export default function SimpleMaster({ category, title, columnLabel }) {
  const [rows, setRows] = useState([]);
  const [name, setName] = useState('');
  const [editId, setEditId] = useState(null);
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState(() => new Set());

  function load() {
    setLoading(true);
    api('/lookups/' + category).then(setRows).finally(() => setLoading(false));
  }
  useEffect(() => { load(); setName(''); setEditId(null); setShow(false); }, [category]);

  function markFlash(id) {
    if (id == null) return;
    setFlash((s) => new Set(s).add(id));
    setTimeout(() => setFlash((s) => { const n = new Set(s); n.delete(id); return n; }), 1600);
  }

  // Real-time: only this category's rows, applied incrementally.
  useRealtime('lookup', (evt) => {
    if (evt.data?.category !== category) return;
    setRows((prev) => {
      if (evt.action === 'deleted') return prev.filter((r) => r.id !== evt.data.id);
      const row = evt.data;
      if (evt.action === 'updated') return prev.map((r) => (r.id === row.id ? row : r));
      if (evt.action === 'created') return prev.some((r) => r.id === row.id) ? prev : [...prev, row].sort((a, b) => a.name.localeCompare(b.name));
      return prev;
    });
    markFlash(evt.data?.id);
  });

  function openNew() { setName(''); setEditId(null); setShow(true); }
  function openEdit(r) { setName(r.name); setEditId(r.id); setShow(true); }

  async function save() {
    if (!name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      if (editId) { await api(`/lookups/${category}/${editId}`, { method: 'PUT', body: { name } }); toast.success('Updated'); }
      else { await api('/lookups/' + category, { method: 'POST', body: { name } }); toast.success('Added'); }
      setName(''); setEditId(null); setShow(false);
    } catch (e) { toast.error(e.message || 'Could not save'); }
    finally { setSaving(false); }
  }
  async function del(r) {
    const ok = await confirm({ title: 'Delete this entry?', message: `“${r.name}” will be permanently removed.`, tone: 'danger', confirmText: 'Delete', icon: 'trash' });
    if (!ok) return;
    const snap = rows;
    setRows((prev) => prev.filter((x) => x.id !== r.id));
    try { await api(`/lookups/${category}/${r.id}`, { method: 'DELETE' }); toast.success('Deleted'); }
    catch (e) { setRows(snap); toast.error(e.message || 'Could not delete'); }
  }

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={`Manage ${columnLabel.toLowerCase()} entries`}
        action={<button className="btn blue" onClick={openNew}><Ic name="plus" size={16} /> Add New</button>}
      />

      <div className="card">
          <DataTable
            title={`${columnLabel} List`}
            count={rows.length}
            loading={loading}
            rows={rows}
            flash={flash}
            columns={[{ key: 'name', label: columnLabel }]}
            searchPlaceholder={`Search ${columnLabel.toLowerCase()}…`}
            actions={(r) => (
              <>
                <button className="action-btn" title="Edit" onClick={() => openEdit(r)}><Ic name="edit" size={15} /></button>
                <button className="action-btn danger" title="Delete" onClick={() => del(r)}><Ic name="trash" size={15} /></button>
              </>
            )}
            empty={{ icon: 'box', title: 'No entries yet', sub: `Add your first ${columnLabel.toLowerCase()} with “Add New”.` }}
          />
      </div>

      <Modal
        open={show}
        onClose={() => setShow(false)}
        title={editId ? `Edit ${columnLabel}` : `Add ${columnLabel}`}
        subtitle={`Enter the ${columnLabel.toLowerCase()} details`}
        icon="box"
        size="sm"
        footer={
          <>
            <button className="btn ghost" onClick={() => setShow(false)}>Cancel</button>
            <button className="btn blue" onClick={save} disabled={saving}>{saving ? 'Saving…' : editId ? 'Update' : 'Save'}</button>
          </>
        }
      >
        <div className="form-field">
          <label>{columnLabel} <span className="req">*</span></label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={`Enter ${columnLabel.toLowerCase()}`} onKeyDown={(e) => e.key === 'Enter' && save()} />
        </div>
      </Modal>
    </div>
  );
}
