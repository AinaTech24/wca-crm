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
import {
  MEETING_TYPES, MEETING_STATUSES, MEETING_STATUS_BADGE, COMPLETED_STATUS,
  PARTICIPANT_KINDS, REMINDER_OFFSETS, offsetLabel, emptyMeeting, isRangeValid,
} from './meetingConstants.js';

const BLANK_FILTERS = { status: '', type: '', owner: '', from: '', to: '', q: '' };

export default function Meetings() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState(() => new Set());
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);
  const [leads, setLeads] = useState([]);

  const [filters, setFilters] = useState(BLANK_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [editing, setEditing] = useState(null);   // { id, form }
  const [saving, setSaving] = useState(false);

  // Participant picker state (kind + selected name, before it's added).
  const [pKind, setPKind] = useState('client');
  const [pName, setPName] = useState('');

  function load() {
    setLoading(true);
    api('/meetings').then(setRows).catch(() => {}).finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    api('/users').then(setUsers).catch(() => {});
    api('/clients').then(setClients).catch(() => {});
    api('/leads').then(setLeads).catch(() => {});
  }, []);

  function markFlash(id) {
    if (id == null) return;
    setFlash((s) => new Set(s).add(id));
    setTimeout(() => setFlash((s) => { const n = new Set(s); n.delete(id); return n; }), 1600);
  }

  useRealtime('meeting', (evt) => {
    setRows((prev) => {
      if (evt.action === 'deleted') return prev.filter((r) => r.id !== evt.data.id);
      const m = evt.data;
      if (evt.action === 'updated') return prev.map((r) => (r.id === m.id ? m : r));
      if (evt.action === 'created') return prev.some((r) => r.id === m.id) ? prev : [m, ...prev];
      return prev;
    });
    markFlash(evt.data?.id);
  });

  const userNames = useMemo(() => users.map((u) => u.full_name || u.username).filter(Boolean), [users]);

  // Options for the participant picker, per kind.
  const pOptions = useMemo(() => {
    if (pKind === 'client') return clients.map((c) => c.client_name).filter(Boolean);
    if (pKind === 'lead') return leads.map((l) => l.lead_name).filter(Boolean);
    return userNames;
  }, [pKind, clients, leads, userNames]);

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filters.status && r.status !== filters.status) return false;
      if (filters.type && r.meeting_type !== filters.type) return false;
      if (filters.owner && r.owner !== filters.owner) return false;
      if (filters.from && (!r.from_date || r.from_date < filters.from)) return false;
      if (filters.to && (!r.from_date || r.from_date > filters.to)) return false;
      if (q) {
        const hay = [r.title, r.location, r.owner, r.status,
          ...(r.participants || []).map((p) => p.name)].map((v) => String(v || '').toLowerCase()).join(' ');
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, filters]);

  const activeFilterCount = useMemo(
    () => ['status', 'type', 'owner', 'from', 'to'].filter((k) => filters[k]).length, [filters]
  );

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return {
      upcoming: filtered.filter((r) => ['Scheduled', 'Rescheduled'].includes(r.status) && (r.from_date || '') >= today).length,
      today: filtered.filter((r) => r.from_date === today && r.status !== 'Cancelled').length,
      completed: filtered.filter((r) => r.status === COMPLETED_STATUS).length,
      cancelled: filtered.filter((r) => ['Cancelled', 'No Show'].includes(r.status)).length,
    };
  }, [filtered]);

  /* ---- form ---- */
  function openAdd() {
    const f = emptyMeeting();
    setEditing({ id: null, form: f });
    setPKind('client'); setPName('');
  }
  function openEdit(r) {
    setEditing({
      id: r.id,
      form: {
        ...emptyMeeting(),
        ...r,
        participants: (r.participants || []).map((p) => ({ kind: p.kind, ref_id: p.ref_id, name: p.name, email: p.email, mobile: p.mobile })),
        reminders: (r.reminders || []).map((x) => x.offset_minutes),
      },
    });
    setPKind('client'); setPName('');
  }
  const set = (k, v) => setEditing((e) => ({ ...e, form: { ...e.form, [k]: v } }));
  const f = editing?.form;

  function addParticipant(name) {
    if (!name) return;
    const src = pKind === 'client' ? clients.find((c) => c.client_name === name)
      : pKind === 'lead' ? leads.find((l) => l.lead_name === name)
      : users.find((u) => (u.full_name || u.username) === name);
    if (f.participants.some((p) => p.kind === pKind && p.name === name)) {
      toast.info(`${name} is already a participant`);
      setPName('');
      return;
    }
    const entry = {
      kind: pKind,
      ref_id: src?.id ?? null,
      name,
      email: src?.email || '',
      mobile: src?.mobile || '',
    };
    set('participants', [...f.participants, entry]);
    setPName('');
  }
  function removeParticipant(i) { set('participants', f.participants.filter((_, x) => x !== i)); }

  function addReminder() {
    // Offer the first lead time that isn't already on the meeting.
    const next = REMINDER_OFFSETS.find((o) => !f.reminders.includes(o.v));
    if (!next) { toast.info('All reminder times are already set'); return; }
    set('reminders', [...f.reminders, next.v]);
  }
  function setReminder(i, v) {
    const val = Number(v);
    if (f.reminders.includes(val) && f.reminders[i] !== val) { toast.info('That reminder is already set'); return; }
    set('reminders', f.reminders.map((r, x) => (x === i ? val : r)));
  }
  function removeReminder(i) { set('reminders', f.reminders.filter((_, x) => x !== i)); }

  async function save() {
    if (!f.title.trim()) { toast.error('Title is required'); return; }
    if (!isRangeValid(f.from_date, f.from_time, f.to_date, f.to_time)) {
      toast.error('The meeting cannot end before it starts'); return;
    }
    if (f.status === COMPLETED_STATUS && !f.minutes.trim()) {
      toast.error('Add the minutes of meeting before marking it completed'); return;
    }
    setSaving(true);
    try {
      if (editing.id) {
        const updated = await api('/meetings/' + editing.id, { method: 'PUT', body: f });
        setRows((prev) => prev.map((r) => (r.id === editing.id ? updated : r)));
        toast.success('Meeting updated');
      } else {
        const created = await api('/meetings', { method: 'POST', body: f });
        setRows((prev) => (prev.some((r) => r.id === created.id) ? prev : [created, ...prev]));
        toast.success('Meeting scheduled');
      }
      setEditing(null);
    } catch (e) {
      toast.error(e.message || 'Could not save meeting');
    } finally { setSaving(false); }
  }

  async function del(r) {
    const ok = await confirm({
      title: 'Delete meeting?',
      message: `“${r.title}” and its participants and reminders will be permanently removed.`,
      tone: 'danger', confirmText: 'Delete', icon: 'trash',
    });
    if (!ok) return;
    const snap = rows;
    setRows((prev) => prev.filter((x) => x.id !== r.id));
    try { await api('/meetings/' + r.id, { method: 'DELETE' }); toast.success('Meeting deleted'); }
    catch (e) { setRows(snap); toast.error(e.message || 'Could not delete meeting'); }
  }

  const kpis = [
    { label: 'Upcoming', num: stats.upcoming, icon: 'calendar', tone: 'info' },
    { label: 'Today', num: stats.today, icon: 'clock', tone: 'warning' },
    { label: 'Completed', num: stats.completed, icon: 'check', tone: 'success' },
    { label: 'Cancelled / No Show', num: stats.cancelled, icon: 'x', tone: 'danger' },
  ];

  const isCompleted = f?.status === COMPLETED_STATUS;

  return (
    <div>
      <PageHeader
        title="Meetings"
        subtitle="Schedule meetings, invite participants and capture minutes"
        action={<button className="btn blue" onClick={openAdd}><Ic name="plus" size={16} /> Schedule Meeting</button>}
      />

      <div className="kpi-grid" style={{ marginBottom: 18 }}>
        {kpis.map((it) => (
          <div className="kpi-card" data-tone={it.tone} key={it.label}>
            <div className="kpi-card-top"><span className="kpi-card-ic"><Ic name={it.icon} size={16} /></span><span className="kpi-card-label">{it.label}</span></div>
            <div className="kpi-card-num">{it.num}</div>
          </div>
        ))}
      </div>

      <div className="lead-toolbar">
        <div className="dt-search" style={{ flex: 1, maxWidth: 360 }}>
          <span className="dt-search-ic"><Ic name="search" size={16} /></span>
          <input placeholder="Search title, location, participant…" value={filters.q} onChange={(e) => setFilters((x) => ({ ...x, q: e.target.value }))} />
          {filters.q && <button className="dt-search-clear" onClick={() => setFilters((x) => ({ ...x, q: '' }))} aria-label="Clear search"><Ic name="x" size={14} /></button>}
        </div>
        <button className={'btn ghost' + (showFilters ? ' active' : '')} onClick={() => setShowFilters((s) => !s)}>
          <Ic name="filter" size={15} /> Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
        </button>
      </div>

      {showFilters && (
        <div className="card card-pad filter-panel">
          <div className="form-grid">
            <div className="form-field"><label>Status</label>
              <Select value={filters.status} onChange={(e) => setFilters((x) => ({ ...x, status: e.target.value }))}>
                <option value="">All</option>{MEETING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select></div>
            <div className="form-field"><label>Meeting Type</label>
              <Select value={filters.type} onChange={(e) => setFilters((x) => ({ ...x, type: e.target.value }))}>
                <option value="">All</option>{MEETING_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select></div>
            <div className="form-field"><label>Owner</label>
              <Select value={filters.owner} onChange={(e) => setFilters((x) => ({ ...x, owner: e.target.value }))}>
                <option value="">All</option>{userNames.map((u) => <option key={u} value={u}>{u}</option>)}
              </Select></div>
            <div className="form-field"><label>From Date</label>
              <DateField value={filters.from} onChange={(e) => setFilters((x) => ({ ...x, from: e.target.value }))} /></div>
            <div className="form-field"><label>To Date</label>
              <DateField value={filters.to} onChange={(e) => setFilters((x) => ({ ...x, to: e.target.value }))} /></div>
          </div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn ghost" onClick={() => setFilters(BLANK_FILTERS)}><Ic name="x" size={15} /> Clear all</button>
            <span className="filter-count">{filtered.length} of {rows.length} meetings</span>
          </div>
        </div>
      )}

      <div className="card">
        <DataTable
          title="Meetings"
          count={filtered.length}
          loading={loading}
          rows={filtered}
          flash={flash}
          search={false}
          onRowClick={openEdit}
          columns={[
            { key: 'from_date', label: 'From', render: (r) => (r.from_date ? `${fmtDate(r.from_date)}${r.from_time ? ' ' + r.from_time : ''}` : '—') },
            { key: 'to_date', label: 'To', render: (r) => (r.to_date ? `${fmtDate(r.to_date)}${r.to_time ? ' ' + r.to_time : ''}` : '—') },
            { key: 'title', label: 'Title' },
            { key: 'meeting_type', label: 'Type' },
            { key: 'location', label: 'Location', render: (r) => r.location || '—' },
            { key: 'participants', label: 'Participants', noFilter: true, render: (r) => (
              (r.participants || []).length
                ? <span title={r.participants.map((p) => `${p.name} (${p.kind})`).join(', ')}>
                    {r.participants.length} · {r.participants[0].name}{r.participants.length > 1 ? ` +${r.participants.length - 1}` : ''}
                  </span>
                : '—'
            ) },
            { key: 'owner', label: 'Owner', render: (r) => r.owner || '—' },
            { key: 'reminders', label: 'Reminders', noFilter: true, render: (r) => ((r.reminders || []).length ? <span className="badge blue"><Ic name="clock" size={11} />&nbsp;{r.reminders.length}</span> : '—') },
            { key: 'status', label: 'Status', render: (r) => <span className={'badge ' + (MEETING_STATUS_BADGE[r.status] || '')}>{r.status || 'Scheduled'}</span> },
          ]}
          actions={(r) => (
            <>
              <button className="action-btn" title="Edit" onClick={() => openEdit(r)}><Ic name="edit" size={15} /></button>
              <button className="action-btn danger" title="Delete" onClick={() => del(r)}><Ic name="trash" size={15} /></button>
            </>
          )}
          empty={{
            icon: 'calendar',
            title: rows.length ? 'No meetings match these filters' : 'No meetings yet',
            sub: rows.length ? 'Try clearing a filter or two.' : 'Schedule your first meeting to get started.',
          }}
        />
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit Meeting' : 'Schedule Meeting'}
        subtitle="Set the agenda, invite participants and add reminders"
        icon="calendar"
        size="lg"
        footer={
          <>
            <button className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn blue" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : editing?.id ? 'Update Meeting' : 'Save Meeting'}
            </button>
          </>
        }
      >
        {editing && (
          <>
            <div className="form-grid">
              <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Title <span className="req">*</span></label>
                <input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Policy renewal discussion" /></div>
              <div className="form-field"><label>Meeting Type</label>
                <Select value={f.meeting_type} onChange={(e) => set('meeting_type', e.target.value)}>
                  {MEETING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select></div>

              <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Location</label>
                <input value={f.location} onChange={(e) => set('location', e.target.value)} placeholder="Office / client site / video call link" /></div>
              <div className="form-field"><label>Owner</label>
                <Select value={f.owner} onChange={(e) => set('owner', e.target.value)}>
                  <option value="">Me</option>
                  {userNames.map((u) => <option key={u} value={u}>{u}</option>)}
                </Select></div>

              <div className="form-field"><label>From Date</label>
                <DateField value={f.from_date} onChange={(e) => set('from_date', e.target.value)} /></div>
              <div className="form-field"><label>From Time</label>
                <input type="time" value={f.from_time} onChange={(e) => set('from_time', e.target.value)} /></div>
              <div className="form-field" />
              <div className="form-field"><label>To Date</label>
                <DateField value={f.to_date} onChange={(e) => set('to_date', e.target.value)} /></div>
              <div className="form-field"><label>To Time</label>
                <input type="time" value={f.to_time} onChange={(e) => set('to_time', e.target.value)} /></div>
              <div className="form-field" />
            </div>

            {/* ---- participants ---- */}
            <div className="sub-section">
              <div className="section-head">Participants</div>
              <div className="participant-add">
                <Select value={pKind} onChange={(e) => { setPKind(e.target.value); setPName(''); }} style={{ maxWidth: 130 }}>
                  {PARTICIPANT_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                </Select>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <SearchSelect
                    value={pName}
                    onChange={(v) => { setPName(v); addParticipant(v); }}
                    options={pOptions}
                    placeholder={`Select a ${pKind}…`}
                  />
                </div>
              </div>
              {f.participants.length === 0 && <div className="empty-inline">No participants added yet</div>}
              {f.participants.length > 0 && (
                <div className="chips" style={{ marginTop: 10 }}>
                  {f.participants.map((p, i) => (
                    <span className="chip" key={`${p.kind}-${p.name}-${i}`}>
                      <Ic name={PARTICIPANT_KINDS.find((k) => k.key === p.kind)?.icon || 'user'} size={12} />
                      {p.name}
                      <small style={{ opacity: .6, marginLeft: 4 }}>{p.kind}</small>
                      <button type="button" onClick={() => removeParticipant(i)} aria-label={`Remove ${p.name}`}><Ic name="x" size={12} /></button>
                    </span>
                  ))}
                </div>
              )}
              <label className="inline-check" style={{ marginTop: 12 }}>
                <input type="checkbox" checked={!!f.notify_participants} onChange={(e) => set('notify_participants', e.target.checked ? 1 : 0)} />
                <span>Participants Reminder — include participants when reminders fire (otherwise the owner only)</span>
              </label>
            </div>

            {/* ---- reminders ---- */}
            <div className="sub-section">
              <div className="section-head">
                <span>Reminders</span>
                <button type="button" className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={addReminder}>
                  <Ic name="plus" size={14} /> Add Reminder
                </button>
              </div>
              {f.reminders.length === 0 && <div className="empty-inline">No reminders set</div>}
              {f.reminders.map((r, i) => (
                <div className="reminder-row" key={i}>
                  <span className="reminder-ic"><Ic name="bell" size={14} /></span>
                  <Select value={String(r)} onChange={(e) => setReminder(i, e.target.value)}>
                    {REMINDER_OFFSETS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
                  </Select>
                  <button type="button" className="action-btn danger" title="Remove reminder" onClick={() => removeReminder(i)}><Ic name="trash" size={14} /></button>
                </div>
              ))}
              {f.reminders.length > 0 && (
                <div className="hint-line">
                  Fires as a notification on the bell feed at {f.reminders.map((r) => offsetLabel(r).toLowerCase()).join(', ')}.
                </div>
              )}
            </div>

            {/* ---- status + minutes ---- */}
            <div className="sub-section">
              <div className="section-head">Status</div>
              <div className="form-grid">
                <div className="form-field"><label>Meeting Status</label>
                  <Select value={f.status} onChange={(e) => set('status', e.target.value)}>
                    {MEETING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select></div>
              </div>
              {isCompleted && (
                <div className="form-field" style={{ marginTop: 12 }}>
                  <label>Minutes of Meeting <span className="req">*</span></label>
                  <textarea rows={5} value={f.minutes} onChange={(e) => set('minutes', e.target.value)}
                    placeholder="Decisions taken, action items, owners and next steps…" />
                  <div className="hint-line">Captured only for completed meetings.</div>
                </div>
              )}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
