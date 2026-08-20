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
import LeadDetail from './LeadDetail.jsx';
import {
  BUSINESS_TYPES, SOURCES, REFERRAL_SOURCE, STATUSES, STATUS_BADGE,
  OPEN_STATUSES, emptyLead,
} from './leadConstants.js';

const BLANK_FILTERS = { status: '', source: '', business: '', owner: '', from: '', to: '', q: '' };

export default function Leads() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState(() => new Set());
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);

  const [view, setView] = useState('list');       // list | kanban
  const [detailId, setDetailId] = useState(null);  // open lead detail
  const [filters, setFilters] = useState(BLANK_FILTERS);
  const [showFilters, setShowFilters] = useState(false);

  const [editing, setEditing] = useState(null);    // { id, form }
  const [saving, setSaving] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);

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
    // If the lead currently open in detail was deleted elsewhere, fall back to the list.
    if (evt.action === 'deleted' && evt.data.id === detailId) setDetailId(null);
    markFlash(evt.data?.id);
  });

  const userNames = useMemo(() => users.map((u) => u.full_name || u.username).filter(Boolean), [users]);
  const clientNames = useMemo(() => clients.map((c) => c.client_name).filter(Boolean), [clients]);

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filters.status && r.status !== filters.status) return false;
      if (filters.source && r.source !== filters.source) return false;
      if (filters.business && r.expected_business_type !== filters.business) return false;
      if (filters.owner && r.lead_owner !== filters.owner) return false;
      if (filters.from && (!r.lead_date || r.lead_date < filters.from)) return false;
      if (filters.to && (!r.lead_date || r.lead_date > filters.to)) return false;
      if (q) {
        const hay = [r.lead_name, r.company_name, r.mobile, r.email, r.expected_business_type, r.source, r.lead_owner]
          .map((v) => String(v || '').toLowerCase()).join(' ');
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, filters]);

  const activeFilterCount = useMemo(
    () => ['status', 'source', 'business', 'owner', 'from', 'to'].filter((k) => filters[k]).length,
    [filters]
  );

  const stats = useMemo(() => ({
    open: filtered.filter((r) => OPEN_STATUSES.includes(r.status)).length,
    followUp: filtered.filter((r) => r.status === 'Follow Up').length,
    qualified: filtered.filter((r) => r.status === 'Qualified').length,
    converted: filtered.filter((r) => r.status === 'Converted').length,
  }), [filtered]);

  /* ---- create / edit ---- */
  function openAdd() { setEditing({ id: null, form: emptyLead() }); }
  function openEdit(r) {
    const form = { ...emptyLead() };
    for (const k of Object.keys(form)) if (r[k] != null) form[k] = r[k];
    setEditing({ id: r.id, form });
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
        toast.success('Lead added successfully');
        // Drop straight into the new lead's detail view so tasks/notes/
        // meetings can be logged without hunting for it in the list.
        if (created?.id) {
          setRows((prev) => (prev.some((r) => r.id === created.id) ? prev : [{ id: created.id, ...f }, ...prev]));
          setDetailId(created.id);
        }
      }
      setEditing(null);
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
    if (detailId === r.id) setDetailId(null);
    try { await api('/leads/' + r.id, { method: 'DELETE' }); toast.success('Lead deleted'); }
    catch (e) { setRows(snap); toast.error(e.message || 'Could not delete lead'); }
  }

  async function changeStatus(lead, status) {
    if (!status || status === lead.status) return;
    const snap = rows;
    setRows((prev) => prev.map((r) => (r.id === lead.id ? { ...r, status } : r)));
    try { await api('/leads/' + lead.id, { method: 'PUT', body: { status } }); }
    catch (e) { setRows(snap); toast.error(e.message || 'Could not update status'); }
  }

  /* ---- kanban drag & drop ---- */
  function onDrop(status) {
    setOverCol(null);
    const lead = rows.find((r) => r.id === dragId);
    setDragId(null);
    if (lead) changeStatus(lead, status);
  }

  const detailLead = detailId != null ? rows.find((r) => r.id === detailId) : null;

  // Detail view replaces the list entirely (Zoho-style full record page).
  if (detailLead) {
    return (
      <div>
        <LeadDetail
          lead={detailLead}
          userNames={userNames}
          onBack={() => setDetailId(null)}
          onEdit={openEdit}
          onDelete={del}
          onStatusChange={changeStatus}
        />
        <LeadFormModal
          editing={editing} setEditing={setEditing} set={set} save={save} saving={saving}
          userNames={userNames} clientNames={clientNames} pickReferralClient={pickReferralClient}
        />
      </div>
    );
  }

  const kpis = [
    { label: 'Open Leads', num: stats.open, icon: 'target', tone: 'info' },
    { label: 'Follow Up', num: stats.followUp, icon: 'clock', tone: 'warning' },
    { label: 'Qualified', num: stats.qualified, icon: 'check', tone: 'success' },
    { label: 'Converted', num: stats.converted, icon: 'checksquare', tone: 'success', hint: 'won business' },
  ];

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

      <div className="lead-toolbar">
        <div className="tabs" style={{ marginBottom: 0 }}>
          <button className={'tab' + (view === 'list' ? ' active' : '')} onClick={() => setView('list')}><Ic name="grid" size={14} /> List</button>
          <button className={'tab' + (view === 'kanban' ? ' active' : '')} onClick={() => setView('kanban')}><Ic name="chart" size={14} /> Kanban</button>
        </div>

        <div className="dt-search" style={{ flex: 1, maxWidth: 340 }}>
          <span className="dt-search-ic"><Ic name="search" size={16} /></span>
          <input placeholder="Search name, company, mobile…" value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
          {filters.q && <button className="dt-search-clear" onClick={() => setFilters((f) => ({ ...f, q: '' }))} aria-label="Clear search"><Ic name="x" size={14} /></button>}
        </div>

        <button className={'btn ghost' + (showFilters ? ' active' : '')} onClick={() => setShowFilters((s) => !s)}>
          <Ic name="filter" size={15} /> Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
        </button>
      </div>

      {showFilters && (
        <div className="card card-pad filter-panel">
          <div className="form-grid">
            <div className="form-field"><label>Status</label>
              <Select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
                <option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select></div>
            <div className="form-field"><label>Lead Source</label>
              <Select value={filters.source} onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}>
                <option value="">All</option>{SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select></div>
            <div className="form-field"><label>Business Type</label>
              <Select value={filters.business} onChange={(e) => setFilters((f) => ({ ...f, business: e.target.value }))}>
                <option value="">All</option>{BUSINESS_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select></div>
            <div className="form-field"><label>Lead Owner</label>
              <Select value={filters.owner} onChange={(e) => setFilters((f) => ({ ...f, owner: e.target.value }))}>
                <option value="">All</option>{userNames.map((u) => <option key={u} value={u}>{u}</option>)}
              </Select></div>
            <div className="form-field"><label>From Date</label>
              <DateField value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} /></div>
            <div className="form-field"><label>To Date</label>
              <DateField value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} /></div>
          </div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn ghost" onClick={() => setFilters(BLANK_FILTERS)}><Ic name="x" size={15} /> Clear all</button>
            <span className="filter-count">{filtered.length} of {rows.length} leads</span>
          </div>
        </div>
      )}

      {view === 'list' ? (
        <div className="card">
          <DataTable
            title="Leads"
            count={filtered.length}
            loading={loading}
            rows={filtered}
            flash={flash}
            search={false}
            columns={[
              { key: 'lead_date', label: 'Date', render: (r) => fmtDate(r.lead_date) || '—' },
              { key: 'lead_name', label: 'Lead Name', render: (r) => (
                <button className="link-cell" onClick={() => setDetailId(r.id)}>{r.lead_name}</button>
              ) },
              { key: 'company_name', label: 'Company', render: (r) => r.company_name || '—' },
              { key: 'mobile', label: 'Mobile', render: (r) => r.mobile || '—' },
              { key: 'expected_business_type', label: 'Business Type', render: (r) => r.expected_business_type || '—' },
              { key: 'source', label: 'Source', render: (r) => (r.source === REFERRAL_SOURCE && r.referral_client_name ? `${r.source} · ${r.referral_client_name}` : r.source || '—') },
              { key: 'lead_owner', label: 'Lead Owner', render: (r) => r.lead_owner || '—' },
              { key: 'status', label: 'Status', render: (r) => <span className={'badge ' + (STATUS_BADGE[r.status] || '')}>{r.status || 'New'}</span> },
            ]}
            actions={(r) => (
              <>
                <button className="action-btn" title="Open lead" onClick={() => setDetailId(r.id)}><Ic name="eye" size={15} /></button>
                <button className="action-btn" title="Edit" onClick={() => openEdit(r)}><Ic name="edit" size={15} /></button>
                <button className="action-btn danger" title="Delete" onClick={() => del(r)}><Ic name="trash" size={15} /></button>
              </>
            )}
            empty={{
              icon: 'userplus',
              title: rows.length ? 'No leads match these filters' : 'No leads yet',
              sub: rows.length ? 'Try clearing a filter or two.' : 'Add your first lead to start building the pipeline.',
            }}
          />
        </div>
      ) : (
        <div className="kanban">
          {STATUSES.map((st) => {
            const cards = filtered.filter((r) => (r.status || 'New') === st);
            return (
              <div
                key={st}
                className={'kanban-col' + (overCol === st ? ' over' : '')}
                onDragOver={(e) => { e.preventDefault(); setOverCol(st); }}
                onDragLeave={() => setOverCol((c) => (c === st ? null : c))}
                onDrop={() => onDrop(st)}
              >
                <div className="kanban-col-head">
                  <span><span className={'kanban-dot ' + (STATUS_BADGE[st] || '')} /> {st}</span>
                  <span className="kanban-count">{cards.length}</span>
                </div>
                {cards.length === 0 && <div className="kanban-empty">Drop a lead here</div>}
                {cards.map((r) => (
                  <div
                    key={r.id}
                    className={'kanban-card' + (dragId === r.id ? ' dragging' : '') + (flash.has(r.id) ? ' flash' : '')}
                    draggable
                    onDragStart={() => setDragId(r.id)}
                    onDragEnd={() => { setDragId(null); setOverCol(null); }}
                    onClick={() => setDetailId(r.id)}
                  >
                    <div className="kanban-name">{r.lead_name}</div>
                    {r.company_name && <div className="kanban-company">{r.company_name}</div>}
                    <div className="kanban-meta">
                      {r.expected_business_type && <span><Ic name="tag" size={11} /> {r.expected_business_type}</span>}
                      {r.mobile && <span><Ic name="phone" size={11} /> {r.mobile}</span>}
                      {r.lead_owner && <span><Ic name="user" size={11} /> {r.lead_owner}</span>}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      <LeadFormModal
        editing={editing} setEditing={setEditing} set={set} save={save} saving={saving}
        userNames={userNames} clientNames={clientNames} pickReferralClient={pickReferralClient}
      />
    </div>
  );
}

/* ---- create / edit form, shared by the list and detail views ---- */
function LeadFormModal({ editing, setEditing, set, save, saving, userNames, clientNames, pickReferralClient }) {
  const f = editing?.form;
  const isReferral = f?.source === REFERRAL_SOURCE;
  return (
    <Modal
      open={!!editing}
      onClose={() => setEditing(null)}
      title={editing?.id ? 'Edit Lead' : 'Add New Lead'}
      subtitle="Capture the enquiry details"
      icon="userplus"
      size="lg"
      footer={
        <>
          <button className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
          <button className="btn blue" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : editing?.id ? 'Update Lead' : 'Save Lead'}
          </button>
        </>
      }
    >
      {editing && (
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
              <SearchSelect value={f.referral_client_name} onChange={pickReferralClient} options={clientNames} placeholder="Select existing client…" /></div>
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
    </Modal>
  );
}
