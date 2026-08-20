import { useEffect, useState, useMemo } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import confirm from '../components/confirm.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import Select from '../components/Select.jsx';
import SearchSelect from '../components/SearchSelect.jsx';
import DateField, { fmt as fmtDate } from '../components/DateField.jsx';
import { Ic } from '../components/Icons.jsx';
import { useRealtime } from '../realtime.js';

const BUSINESS_TYPES = ['Motor', 'Retail Health', 'Group Health Insurance', 'Life / Term', 'Group Term Life',
  'Personal Accident', 'Group Personal Accident', 'Workmen Compensation', 'Fire & Property', 'Marine Cargo',
  'Engineering', 'Liability', 'Householder', 'Travel', 'Fixed Deposit', 'Other'];

// 'Client Referral' is special-cased below — picking it reveals a picker for
// the existing client who made the referral.
const REFERRAL_SOURCE = 'Client Referral';
const SOURCES = ['Website', REFERRAL_SOURCE, 'Agent / Partner Referral', 'Walk-in', 'Phone Enquiry',
  'Social Media', 'Email Campaign', 'Existing Client', 'Cold Call', 'Advertisement', 'Other'];

const STATUSES = ['New', 'Contacted', 'Follow Up', 'Qualified', 'Proposal Sent', 'Converted', 'Lost', 'Junk'];
const STATUS_BADGE = {
  New: 'blue', Contacted: 'blue', 'Follow Up': 'orange', Qualified: 'green',
  'Proposal Sent': 'orange', Converted: 'green', Lost: 'red', Junk: 'red',
};
const OPEN_STATUSES = ['New', 'Contacted', 'Follow Up', 'Qualified', 'Proposal Sent'];

const PRIORITIES = ['Low', 'Medium', 'High'];
const TASK_STATUSES = ['Open', 'In Progress', 'Done'];

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const emptyLead = () => ({
  lead_name: '', lead_date: todayISO(), expected_business_type: '', mobile: '', email: '',
  lead_owner: '', source: '', referral_client_id: null, referral_client_name: '',
  company_name: '', status: 'New', followup_date: '', remarks: '',
});

// Blank composer state per activity kind.
const emptyActivity = (kind) => ({
  kind, title: '', body: '', due_date: kind === 'note' ? '' : todayISO(),
  meeting_time: '', location: '', status: 'Open', priority: 'Medium',
});

const TABS = [
  { key: 'details', label: 'Details', icon: 'user' },
  { key: 'task', label: 'Tasks', icon: 'checksquare' },
  { key: 'note', label: 'Notes', icon: 'doc' },
  { key: 'meeting', label: 'Meetings', icon: 'calendar' },
];

export default function Leads() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState(() => new Set());
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);

  // editing: null when closed; { id, form } while adding/editing.
  const [editing, setEditing] = useState(null);
  const [tab, setTab] = useState('details');
  const [saving, setSaving] = useState(false);

  // Activity state for the currently open lead.
  const [acts, setActs] = useState([]);
  const [actsLoading, setActsLoading] = useState(false);
  const [composer, setComposer] = useState(emptyActivity('task'));

  function load() {
    setLoading(true);
    api('/leads').then(setRows).catch(() => {}).finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    api('/users').then(setUsers).catch(() => {});
    api('/clients').then(setClients).catch(() => {});
  }, []);

  function markFlash(id) {
    if (id == null) return;
    setFlash((s) => new Set(s).add(id));
    setTimeout(() => setFlash((s) => { const n = new Set(s); n.delete(id); return n; }), 1600);
  }

  useRealtime('lead', (evt) => {
    setRows((prev) => {
      if (evt.action === 'deleted') return prev.filter((r) => r.id !== evt.data.id);
      const l = evt.data;
      if (evt.action === 'updated') return prev.map((r) => (r.id === l.id ? l : r));
      if (evt.action === 'created') return prev.some((r) => r.id === l.id) ? prev : [l, ...prev];
      return prev;
    });
    markFlash(evt.data?.id);
  });

  // Keep the open lead's activity list live too (another user adding a note
  // shows up without reopening the lead).
  useRealtime('lead-activity', (evt) => {
    const a = evt.data;
    if (!editing?.id) return;
    if (evt.action === 'deleted') { setActs((p) => p.filter((x) => x.id !== a.id)); return; }
    if (a.lead_id !== editing.id) return;
    setActs((p) => {
      if (evt.action === 'updated') return p.map((x) => (x.id === a.id ? a : x));
      return p.some((x) => x.id === a.id) ? p : [a, ...p];
    });
  });

  const stats = useMemo(() => ({
    open: rows.filter((r) => OPEN_STATUSES.includes(r.status)).length,
    followUp: rows.filter((r) => r.status === 'Follow Up').length,
    qualified: rows.filter((r) => r.status === 'Qualified').length,
    converted: rows.filter((r) => r.status === 'Converted').length,
  }), [rows]);

  const userNames = useMemo(() => users.map((u) => u.full_name || u.username).filter(Boolean), [users]);
  const clientNames = useMemo(() => clients.map((c) => c.client_name).filter(Boolean), [clients]);

  function openAdd() {
    setEditing({ id: null, form: emptyLead() });
    setTab('details'); setActs([]); setComposer(emptyActivity('task'));
  }
  async function openEdit(r) {
    const form = { ...emptyLead() };
    for (const k of Object.keys(form)) if (r[k] != null) form[k] = r[k];
    setEditing({ id: r.id, form });
    setTab('details'); setComposer(emptyActivity('task'));
    setActsLoading(true); setActs([]);
    try { setActs(await api(`/leads/${r.id}/activities`)); }
    catch { /* the tabs just show their empty state */ }
    finally { setActsLoading(false); }
  }
  const set = (k, v) => setEditing((e) => ({ ...e, form: { ...e.form, [k]: v } }));

  function pickReferralClient(name) {
    const c = clients.find((x) => x.client_name === name);
    setEditing((e) => ({ ...e, form: { ...e.form, referral_client_name: name, referral_client_id: c?.id ?? null } }));
  }

  async function save() {
    const f = editing.form;
    if (!f.lead_name.trim()) { toast.error('Lead Name is required'); return; }
    if (f.source === REFERRAL_SOURCE && !f.referral_client_name) { toast.error('Select the client who referred this lead'); return; }
    setSaving(true);
    try {
      if (editing.id) {
        await api('/leads/' + editing.id, { method: 'PUT', body: f });
        setRows((prev) => prev.map((r) => (r.id === editing.id ? { ...r, ...f } : r)));
        toast.success('Lead updated');
      } else {
        const created = await api('/leads', { method: 'POST', body: f });
        if (created?.id) {
          // Stay open on the new lead so tasks/notes/meetings can be added
          // right away instead of forcing a save-then-reopen round trip.
          setEditing({ id: created.id, form: f });
          setActs([]);
        }
        toast.success('Lead added successfully');
      }
    } catch (e) {
      toast.error(e.message || 'Could not save lead');
    } finally {
      setSaving(false);
    }
  }

  async function del(r) {
    const ok = await confirm({
      title: 'Delete lead?',
      message: `“${r.lead_name}” and all its tasks, notes and meetings will be permanently removed.`,
      tone: 'danger', confirmText: 'Delete', icon: 'trash',
    });
    if (!ok) return;
    const snap = rows;
    setRows((prev) => prev.filter((x) => x.id !== r.id));
    try { await api('/leads/' + r.id, { method: 'DELETE' }); toast.success('Lead deleted'); }
    catch (e) { setRows(snap); toast.error(e.message || 'Could not delete lead'); }
  }

  /* ---- activities ---- */
  async function addActivity() {
    const c = composer;
    const isNote = c.kind === 'note';
    if (isNote ? !c.body.trim() : !c.title.trim()) {
      toast.error(isNote ? 'Write something first' : 'A title is required');
      return;
    }
    try {
      const row = await api(`/leads/${editing.id}/activities`, { method: 'POST', body: c });
      setActs((p) => (p.some((x) => x.id === row.id) ? p : [row, ...p]));
      setComposer(emptyActivity(c.kind));
      toast.success(isNote ? 'Note added' : c.kind === 'task' ? 'Task added' : 'Meeting scheduled');
    } catch (e) {
      toast.error(e.message || 'Could not save');
    }
  }
  async function toggleTask(a) {
    const next = a.status === 'Done' ? 'Open' : 'Done';
    setActs((p) => p.map((x) => (x.id === a.id ? { ...x, status: next } : x)));
    try { await api('/lead-activities/' + a.id, { method: 'PUT', body: { ...a, status: next } }); }
    catch (e) {
      setActs((p) => p.map((x) => (x.id === a.id ? { ...x, status: a.status } : x)));
      toast.error(e.message || 'Could not update task');
    }
  }
  async function delActivity(a) {
    const snap = acts;
    setActs((p) => p.filter((x) => x.id !== a.id));
    try { await api('/lead-activities/' + a.id, { method: 'DELETE' }); }
    catch (e) { setActs(snap); toast.error(e.message || 'Could not delete'); }
  }

  const kpis = [
    { label: 'Open Leads', num: stats.open, icon: 'target', tone: 'info' },
    { label: 'Follow Up', num: stats.followUp, icon: 'clock', tone: 'warning' },
    { label: 'Qualified', num: stats.qualified, icon: 'check', tone: 'success' },
    { label: 'Converted', num: stats.converted, icon: 'checksquare', tone: 'success', hint: 'won business' },
  ];

  const f = editing?.form;
  const isReferral = f?.source === REFERRAL_SOURCE;
  const kindActs = acts.filter((a) => a.kind === tab);
  const setC = (k, v) => setComposer((p) => ({ ...p, [k]: v }));
  const countOf = (kind) => acts.filter((a) => a.kind === kind).length;

  return (
    <div>
      <PageHeader
        title="Leads"
        subtitle="Capture enquiries and work them through to conversion"
        action={<button className="btn blue" onClick={openAdd}><Ic name="plus" size={16} /> Add New Lead</button>}
      />

      <div className="kpi-grid" style={{ marginBottom: 18 }}>
        {kpis.map((it) => (
          <div className="kpi-card" data-tone={it.tone} key={it.label}>
            <div className="kpi-card-top"><span className="kpi-card-ic"><Ic name={it.icon} size={16} /></span><span className="kpi-card-label">{it.label}</span></div>
            <div className="kpi-card-num">{it.num}</div>
            {it.hint && <div className="kpi-card-hint">{it.hint}</div>}
          </div>
        ))}
      </div>

      <div className="card">
        <DataTable
          title="Leads"
          count={rows.length}
          loading={loading}
          rows={rows}
          flash={flash}
          onRowClick={openEdit}
          searchPlaceholder="Search name, company, mobile…"
          searchKeys={['lead_name', 'company_name', 'mobile', 'email', 'expected_business_type', 'source', 'lead_owner']}
          columns={[
            { key: 'lead_date', label: 'Date', render: (r) => fmtDate(r.lead_date) || '—' },
            { key: 'lead_name', label: 'Lead Name' },
            { key: 'company_name', label: 'Company', render: (r) => r.company_name || '—' },
            { key: 'mobile', label: 'Mobile', render: (r) => r.mobile || '—' },
            { key: 'expected_business_type', label: 'Business Type', render: (r) => r.expected_business_type || '—' },
            { key: 'source', label: 'Source', render: (r) => (r.source === REFERRAL_SOURCE && r.referral_client_name ? `${r.source} · ${r.referral_client_name}` : r.source || '—') },
            { key: 'lead_owner', label: 'Lead Owner', render: (r) => r.lead_owner || '—' },
            { key: 'status', label: 'Status', render: (r) => <span className={'badge ' + (STATUS_BADGE[r.status] || '')}>{r.status || 'New'}</span> },
          ]}
          actions={(r) => (
            <>
              <button className="action-btn" title="Open lead" onClick={() => openEdit(r)}><Ic name="edit" size={15} /></button>
              <button className="action-btn danger" title="Delete" onClick={() => del(r)}><Ic name="trash" size={15} /></button>
            </>
          )}
          empty={{ icon: 'userplus', title: 'No leads yet', sub: 'Add your first lead to start building the pipeline.' }}
        />
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? f?.lead_name || 'Lead' : 'Add New Lead'}
        subtitle={editing?.id ? 'Update details, or log a task, note or meeting' : 'Capture the enquiry details'}
        icon="userplus"
        size="lg"
        footer={
          tab === 'details' ? (
            <>
              <button className="btn ghost" onClick={() => setEditing(null)}>Close</button>
              <button className="btn blue" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : editing?.id ? 'Update Lead' : 'Save Lead'}
              </button>
            </>
          ) : <button className="btn ghost" onClick={() => setEditing(null)}>Close</button>
        }
      >
        {editing && (
          <>
            <div className="tabs">
              {TABS.map((t) => {
                // Activities need a saved lead to attach to.
                const locked = t.key !== 'details' && !editing.id;
                const n = t.key !== 'details' ? countOf(t.key) : 0;
                return (
                  <button
                    key={t.key}
                    className={'tab' + (tab === t.key ? ' active' : '')}
                    disabled={locked}
                    title={locked ? 'Save the lead first' : undefined}
                    style={locked ? { opacity: .45, cursor: 'not-allowed' } : undefined}
                    onClick={() => { if (locked) return; setTab(t.key); if (t.key !== 'details') setComposer(emptyActivity(t.key)); }}
                  >
                    <Ic name={t.icon} size={14} /> {t.label}{n > 0 ? ` (${n})` : ''}
                  </button>
                );
              })}
            </div>

            {tab === 'details' && (
              <div className="form-grid">
                <div className="form-field"><label>Lead Name <span className="req">*</span></label>
                  <input value={f.lead_name} onChange={(e) => set('lead_name', e.target.value)} placeholder="Contact person's name" /></div>
                <div className="form-field"><label>Date</label>
                  <DateField value={f.lead_date} onChange={(e) => set('lead_date', e.target.value)} /></div>
                <div className="form-field"><label>Expected Business Type</label>
                  <Select value={f.expected_business_type} onChange={(e) => set('expected_business_type', e.target.value)}>
                    <option value="">Select…</option>
                    {BUSINESS_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
                  </Select></div>

                <div className="form-field"><label>Mobile</label>
                  <input value={f.mobile} onChange={(e) => set('mobile', e.target.value)} placeholder="10-digit mobile" /></div>
                <div className="form-field"><label>Email</label>
                  <input value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="name@example.com" /></div>
                <div className="form-field"><label>Company Name</label>
                  <input value={f.company_name} onChange={(e) => set('company_name', e.target.value)} placeholder="Business / firm name" /></div>

                <div className="form-field"><label>Lead Owner</label>
                  <Select value={f.lead_owner} onChange={(e) => set('lead_owner', e.target.value)}>
                    <option value="">Unassigned</option>
                    {userNames.map((u) => <option key={u} value={u}>{u}</option>)}
                  </Select></div>
                <div className="form-field"><label>Lead Source</label>
                  <Select value={f.source} onChange={(e) => set('source', e.target.value)}>
                    <option value="">Select…</option>
                    {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select></div>
                {isReferral ? (
                  <div className="form-field"><label>Referred By <span className="req">*</span></label>
                    <SearchSelect
                      value={f.referral_client_name}
                      onChange={pickReferralClient}
                      options={clientNames}
                      placeholder="Select existing client…"
                    /></div>
                ) : <div className="form-field" />}

                <div className="form-field"><label>Lead Status</label>
                  <Select value={f.status} onChange={(e) => set('status', e.target.value)}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select></div>
                <div className="form-field"><label>Next Follow-up</label>
                  <DateField value={f.followup_date} onChange={(e) => set('followup_date', e.target.value)} /></div>
                <div className="form-field" />

                <div className="form-field" style={{ gridColumn: '1 / -1' }}><label>Remarks</label>
                  <textarea rows={3} value={f.remarks} onChange={(e) => set('remarks', e.target.value)} placeholder="Requirement, budget, context…" /></div>
              </div>
            )}

            {tab !== 'details' && (
              <div>
                {/* composer */}
                <div className="card card-pad" style={{ marginBottom: 16 }}>
                  <div className="section-head">
                    {tab === 'task' ? 'Add Task' : tab === 'note' ? 'Add Note' : 'Schedule Meeting'}
                  </div>
                  {tab === 'note' ? (
                    <div className="form-field">
                      <textarea rows={3} value={composer.body} onChange={(e) => setC('body', e.target.value)} placeholder="What happened on this lead?" />
                    </div>
                  ) : tab === 'task' ? (
                    <div className="form-grid">
                      <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Subject</label>
                        <input value={composer.title} onChange={(e) => setC('title', e.target.value)} placeholder="e.g. Call to confirm requirement" /></div>
                      <div className="form-field"><label>Due Date</label>
                        <DateField value={composer.due_date} onChange={(e) => setC('due_date', e.target.value)} /></div>
                      <div className="form-field"><label>Priority</label>
                        <Select value={composer.priority} onChange={(e) => setC('priority', e.target.value)}>
                          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                        </Select></div>
                      <div className="form-field"><label>Status</label>
                        <Select value={composer.status} onChange={(e) => setC('status', e.target.value)}>
                          {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </Select></div>
                      <div className="form-field"><label>Owner</label>
                        <Select value={composer.owner || ''} onChange={(e) => setC('owner', e.target.value)}>
                          <option value="">Me</option>
                          {userNames.map((u) => <option key={u} value={u}>{u}</option>)}
                        </Select></div>
                    </div>
                  ) : (
                    <div className="form-grid">
                      <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Title</label>
                        <input value={composer.title} onChange={(e) => setC('title', e.target.value)} placeholder="e.g. Product walkthrough" /></div>
                      <div className="form-field"><label>Date</label>
                        <DateField value={composer.due_date} onChange={(e) => setC('due_date', e.target.value)} /></div>
                      <div className="form-field"><label>Time</label>
                        <input type="time" value={composer.meeting_time} onChange={(e) => setC('meeting_time', e.target.value)} /></div>
                      <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Location</label>
                        <input value={composer.location} onChange={(e) => setC('location', e.target.value)} placeholder="Office / video call / client site" /></div>
                      <div className="form-field" style={{ gridColumn: '1 / -1' }}><label>Agenda</label>
                        <textarea rows={2} value={composer.body} onChange={(e) => setC('body', e.target.value)} placeholder="What will be covered?" /></div>
                    </div>
                  )}
                  <div className="btn-row" style={{ marginTop: 12 }}>
                    <button className="btn blue" onClick={addActivity}>
                      <Ic name="plus" size={15} /> {tab === 'task' ? 'Add Task' : tab === 'note' ? 'Add Note' : 'Add Meeting'}
                    </button>
                  </div>
                </div>

                {/* list */}
                {actsLoading && <div className="notif-empty"><span>Loading…</span></div>}
                {!actsLoading && kindActs.length === 0 && (
                  <div className="notif-empty">
                    <Ic name={TABS.find((t) => t.key === tab).icon} size={22} />
                    <span>No {tab === 'task' ? 'tasks' : tab === 'note' ? 'notes' : 'meetings'} yet</span>
                  </div>
                )}
                {kindActs.map((a) => (
                  <div key={a.id} className="card card-pad" style={{ marginBottom: 10, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    {a.kind === 'task' && (
                      <button className="action-btn" title={a.status === 'Done' ? 'Mark open' : 'Mark done'} onClick={() => toggleTask(a)}>
                        <Ic name={a.status === 'Done' ? 'check' : 'checksquare'} size={15} />
                      </button>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {a.kind !== 'note' && (
                        <div style={{ fontWeight: 650, textDecoration: a.status === 'Done' ? 'line-through' : 'none' }}>{a.title}</div>
                      )}
                      {a.body && <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-2)', fontSize: 13, marginTop: a.kind === 'note' ? 0 : 4 }}>{a.body}</div>}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 6, fontSize: 12, color: 'var(--text-3)' }}>
                        {a.kind === 'task' && <span className={'badge ' + (a.status === 'Done' ? 'green' : a.priority === 'High' ? 'red' : 'blue')}>{a.status === 'Done' ? 'Done' : a.priority}</span>}
                        {a.due_date && <span><Ic name="calendar" size={12} /> {fmtDate(a.due_date) || a.due_date}</span>}
                        {a.meeting_time && <span><Ic name="clock" size={12} /> {a.meeting_time}</span>}
                        {a.location && <span><Ic name="pin" size={12} /> {a.location}</span>}
                        {a.owner && <span><Ic name="user" size={12} /> {a.owner}</span>}
                      </div>
                    </div>
                    <button className="action-btn danger" title="Delete" onClick={() => delActivity(a)}><Ic name="trash" size={15} /></button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
