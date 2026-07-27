import { useEffect, useState, useRef, useMemo } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import confirm from '../components/confirm.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import Select from '../components/Select.jsx';
import { Ic } from '../components/Icons.jsx';
import ClientFormFields, { EMPTY_CLIENT } from '../components/ClientFormFields.jsx';
import { useRealtime } from '../realtime.js';

// Fields the toolbar search can target.
const SEARCH_FIELDS = [
  { value: 'all', label: 'All Fields', keys: ['client_name', 'mobile', 'pan_no', 'group_head_name', 'email', 'group_code'] },
  { value: 'client_name', label: 'Client Name', keys: ['client_name'] },
  { value: 'mobile', label: 'Mobile No', keys: ['mobile'] },
  { value: 'pan_no', label: 'PAN No', keys: ['pan_no'] },
  { value: 'group_head_name', label: 'Group Head', keys: ['group_head_name'] },
  { value: 'email', label: 'Email Id', keys: ['email'] },
  { value: 'group_code', label: 'Group Code', keys: ['group_code'] },
];

export default function ClientMaster() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState(() => new Set());
  const [field, setField] = useState('all');
  const [query, setQuery] = useState('');

  // Modal state: null when closed; { id?, form } while adding/editing.
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    api('/clients').then(setRows).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  function markFlash(id) {
    if (id == null) return;
    setFlash((s) => new Set(s).add(id));
    setTimeout(() => setFlash((s) => { const n = new Set(s); n.delete(id); return n; }), 1600);
  }

  useRealtime('client', (evt) => {
    setRows((prev) => {
      if (evt.action === 'deleted') return prev.filter((r) => r.id !== evt.data.id);
      const c = evt.data;
      if (evt.action === 'updated') return prev.map((r) => (r.id === c.id ? c : r));
      if (evt.action === 'created') return prev.some((r) => r.id === c.id) ? prev : [c, ...prev];
      return prev;
    });
    markFlash(evt.data?.id);
  });

  // Live client-side filter — updates as the user types, no submit needed.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    const keys = (SEARCH_FIELDS.find((s) => s.value === field) || SEARCH_FIELDS[0]).keys;
    return rows.filter((r) => keys.some((k) => String(r[k] || '').toLowerCase().includes(q)));
  }, [rows, query, field]);

  function openAdd() { setEditing({ id: null, form: { ...EMPTY_CLIENT } }); }
  function openEdit(r) {
    const clean = {};
    for (const k of Object.keys(EMPTY_CLIENT)) clean[k] = r[k] == null ? '' : r[k];
    setEditing({ id: r.id, form: clean });
  }
  function setField2(k, v) { setEditing((e) => ({ ...e, form: { ...e.form, [k]: v } })); }

  async function save() {
    const form = editing.form;
    if (!form.client_name.trim()) { toast.error('Client Name is required'); return; }
    setSaving(true);
    try {
      if (editing.id) {
        const updated = await api('/clients/' + editing.id, { method: 'PUT', body: form });
        setRows((prev) => prev.map((r) => (r.id === editing.id ? { ...r, ...form, ...(updated || {}) } : r)));
        toast.success('Client updated');
      } else {
        const created = await api('/clients', { method: 'POST', body: form });
        if (created?.id) setRows((prev) => prev.some((r) => r.id === created.id) ? prev : [created, ...prev]);
        toast.success('Client added successfully');
      }
      setEditing(null);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function del(r) {
    const ok = await confirm({
      title: 'Delete client?',
      message: `“${r.client_name}” will be permanently removed. This cannot be undone.`,
      tone: 'danger', confirmText: 'Delete', icon: 'trash',
    });
    if (!ok) return;
    const snapshot = rows;
    setRows((prev) => prev.filter((x) => x.id !== r.id)); // optimistic
    try {
      await api('/clients/' + r.id, { method: 'DELETE' });
      toast.success('Client deleted');
    } catch (e) {
      setRows(snapshot);
      toast.error(e.message || 'Could not delete client');
    }
  }

  return (
    <div>
      <PageHeader
        title="Client Basic Information"
        subtitle="Search, view and manage your clients"
        action={<button className="btn blue" onClick={openAdd}><Ic name="plus" size={16} /> Add New Client</button>}
      />

      <div className="card">
          <DataTable
            title="Clients"
            count={filtered.length}
            loading={loading}
            rows={filtered}
            flash={flash}
            hideScroll
            search={false}
            headerExtra={
              <>
                <Select className="dt-filter" value={field} onChange={(e) => setField(e.target.value)}>
                  {SEARCH_FIELDS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </Select>
                <div className="dt-search">
                  <span className="dt-search-ic"><Ic name="search" size={16} /></span>
                  <input placeholder="Search clients…" value={query} onChange={(e) => setQuery(e.target.value)} />
                  {query && <button className="dt-search-clear" onClick={() => setQuery('')} aria-label="Clear search"><Ic name="x" size={14} /></button>}
                </div>
              </>
            }
            columns={[
              { key: 'owner', label: 'User' },
              { key: 'client_name', label: 'Client Name' },
              { key: 'group_head_name', label: 'Group Head Name' },
              { key: 'group_code', label: 'Group Code' },
              { key: 'email', label: 'Email Id', render: (r) => r.email || '—' },
              { key: 'mobile', label: 'Mobile No' },
            ]}
            actions={(r) => (
              <>
                <button className="action-btn" title="Edit" onClick={() => openEdit(r)}><Ic name="edit" size={15} /></button>
                <button className="action-btn danger" title="Delete" onClick={() => del(r)}><Ic name="trash" size={15} /></button>
              </>
            )}
            empty={{ icon: 'user', title: 'No clients found', sub: query ? 'No clients match your search.' : 'Add a client to get started.' }}
          />
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit Client' : 'Add New Client'}
        subtitle="Capture the client's personal and contact details"
        icon="user"
        size="lg"
        footer={
          <>
            <button className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn blue" onClick={save} disabled={saving}>{saving ? 'Saving…' : editing?.id ? 'Update Client' : 'Save Client'}</button>
          </>
        }
      >
        {editing && <ClientFormFields form={editing.form} set={setField2} />}
      </Modal>
    </div>
  );
}
