import { useEffect, useState, useRef, useMemo } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import confirm from '../components/confirm.js';
import PageHeader from '../components/PageHeader.jsx';
import ClientImport from './ClientImport.jsx';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import Select from '../components/Select.jsx';
import { fmt as fmtDate } from '../components/DateField.jsx';
import { Ic } from '../components/Icons.jsx';
import ClientFormFields, { EMPTY_CLIENT } from '../components/ClientFormFields.jsx';
import { CATEGORY_BADGE, CLIENT_STATUS_BADGE, parseNominees } from './clientConstants.js';
import { useRealtime } from '../realtime.js';
import ClientDetail from './ClientDetail.jsx';

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
  const [importOpen, setImportOpen] = useState(false);
  const [detailId, setDetailId] = useState(null);

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

  function openAdd() { setEditing({ id: null, form: EMPTY_CLIENT() }); }
  function openEdit(r) {
    const base = EMPTY_CLIENT();
    const clean = {};
    for (const k of Object.keys(base)) clean[k] = r[k] == null ? base[k] : r[k];
    clean.nominees = parseNominees(r.nominees);
    setEditing({ id: r.id, form: clean });
  }
  function setField2(k, v) { setEditing((e) => ({ ...e, form: { ...e.form, [k]: v } })); }

  async function save() {
    const form = editing.form;
    if (!form.client_name.trim()) { toast.error('Client Name is required'); return; }
    if (form.family_type === 'Family Member' && !form.family_head_id) { toast.error('Select the family head for a family member'); return; }
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
      toast.error(e.message || 'Could not save client');
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
    if (detailId === r.id) setDetailId(null);
    try {
      await api('/clients/' + r.id, { method: 'DELETE' });
      toast.success('Client deleted');
    } catch (e) {
      setRows(snapshot);
      toast.error(e.message || 'Could not delete client');
    }
  }

  const detailClient = detailId != null ? rows.find((r) => r.id === detailId) : null;

  // The detail view replaces the list, and keeps the edit modal mounted so
  // "Edit" works from either place.
  if (detailClient) {
    return (
      <div>
        <ClientDetail
          client={detailClient}
          onBack={() => setDetailId(null)}
          onEdit={openEdit}
          onDelete={del}
        />
        <Modal
          open={!!editing}
          onClose={() => setEditing(null)}
          title="Edit Client"
          subtitle="Capture the client's personal and contact details"
          icon="user"
          size="lg"
          footer={
            <>
              <button className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn blue" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Update Client'}</button>
            </>
          }
        >
          {editing && <ClientFormFields form={editing.form} set={setField2} selfId={editing.id} lastMeetingDate={rows.find((r) => r.id === editing.id)?.last_meeting_date} />}
        </Modal>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Client Basic Information"
        subtitle="Search, view and manage your clients"
        action={
          <>
            <button className="btn ghost" onClick={() => setImportOpen(true)}><Ic name="upload" size={15} /> Import Excel</button>
            <button className="btn blue" onClick={openAdd}><Ic name="plus" size={16} /> Add New Client</button>
          </>
        }
      />

      <ClientImport open={importOpen} onClose={() => setImportOpen(false)} onDone={load} />

      <div className="card">
          <DataTable
            title="Clients"
            count={filtered.length}
            loading={loading}
            rows={filtered}
            flash={flash}
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
              { key: 'client_name', label: 'Client Name', render: (r) => (
                <button className="link-cell" onClick={() => setDetailId(r.id)}>{r.client_name}</button>
              ) },
              { key: 'client_category', label: 'Category', render: (r) => (r.client_category ? <span className={'badge ' + (CATEGORY_BADGE[r.client_category] || '')}>{r.client_category}</span> : '—') },
              { key: 'mobile', label: 'Mobile No' },
              { key: 'email', label: 'Email Id', render: (r) => r.email || '—' },
              { key: 'family_type', label: 'Family', render: (r) => (r.family_type === 'Family Member' && r.family_head_name ? `Member · ${r.family_head_name}` : r.family_type || '—') },
              { key: 'last_meeting_date', label: 'Last Meeting', noFilter: true, render: (r) => (r.last_meeting_date ? fmtDate(r.last_meeting_date) : '—') },
              { key: 'client_status', label: 'Status', render: (r) => <span className={'badge ' + (CLIENT_STATUS_BADGE[r.client_status] || '')}>{r.client_status || 'Active'}</span> },
            ]}
            actions={(r) => (
              <>
                <button className="action-btn" title="Open client" onClick={() => setDetailId(r.id)}><Ic name="eye" size={15} /></button>
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
        {editing && <ClientFormFields form={editing.form} set={setField2} selfId={editing.id} lastMeetingDate={rows.find((r) => r.id === editing.id)?.last_meeting_date} />}
      </Modal>
    </div>
  );
}
