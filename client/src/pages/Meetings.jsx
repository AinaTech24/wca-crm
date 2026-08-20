import { useEffect, useState, useMemo } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import confirm from '../components/confirm.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import Select from '../components/Select.jsx';
import DateField, { fmt as fmtDate } from '../components/DateField.jsx';
import { Ic } from '../components/Icons.jsx';
import { useRealtime } from '../realtime.js';
import MeetingFormModal, { meetingToForm } from './MeetingFormModal.jsx';
import {
  MEETING_TYPES, MEETING_STATUSES, MEETING_STATUS_BADGE, COMPLETED_STATUS, emptyMeeting,
} from './meetingConstants.js';

const BLANK_FILTERS = { status: '', type: '', owner: '', from: '', to: '', q: '' };

export default function Meetings() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState(() => new Set());
  const [users, setUsers] = useState([]);

  const [filters, setFilters] = useState(BLANK_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [form, setForm] = useState(null);   // { id, seed } while the modal is open

  useEffect(() => {
    setLoading(true);
    api('/meetings').then(setRows).catch(() => {}).finally(() => setLoading(false));
    api('/users').then(setUsers).catch(() => {});
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

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filters.status && r.status !== filters.status) return false;
      if (filters.type && r.meeting_type !== filters.type) return false;
      if (filters.owner && r.owner !== filters.owner) return false;
      if (filters.from && (!r.from_date || r.from_date < filters.from)) return false;
      if (filters.to && (!r.from_date || r.from_date > filters.to)) return false;
      if (q) {
        const hay = [r.title, r.location, r.owner, r.status, ...(r.participants || []).map((p) => p.name)]
          .map((v) => String(v || '').toLowerCase()).join(' ');
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

  function openAdd() { setForm({ id: null, seed: emptyMeeting() }); }
  function openEdit(r) { setForm({ id: r.id, seed: meetingToForm(r) }); }

  function onSaved(row) {
    setRows((prev) => (prev.some((r) => r.id === row.id) ? prev.map((r) => (r.id === row.id ? row : r)) : [row, ...prev]));
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
            { key: 'reminders', label: 'Reminders', noFilter: true, render: (r) => ((r.reminders || []).length ? <span className="badge blue">{r.reminders.length}</span> : '—') },
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

      <MeetingFormModal
        open={!!form}
        meetingId={form?.id}
        seed={form?.seed}
        onClose={() => setForm(null)}
        onSaved={onSaved}
      />
    </div>
  );
}
