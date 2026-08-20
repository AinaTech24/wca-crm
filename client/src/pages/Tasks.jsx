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
import TaskFormModal from './TaskFormModal.jsx';
import {
  TASK_TYPES, TASK_STATUSES, TASK_STATUS_BADGE, TASK_PRIORITIES, TASK_DONE,
  TASK_RELATED_KINDS, reminderLabel, emptyTask, todayISO,
} from './taskConstants.js';

const BLANK_FILTERS = { status: '', type: '', priority: '', assignedTo: '', related: '', from: '', to: '', q: '' };

export default function Tasks() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [flash, setFlash] = useState(() => new Set());
  const [users, setUsers] = useState([]);

  const [view, setView] = useState('list');      // list | kanban
  const [filters, setFilters] = useState(BLANK_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [form, setForm] = useState(null);        // { id, seed }
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);

  useEffect(() => {
    setLoading(true);
    api('/tasks').then(setRows).catch(() => {}).finally(() => setLoading(false));
    api('/users').then(setUsers).catch(() => {});
  }, []);

  function markFlash(id) {
    if (id == null) return;
    setFlash((s) => new Set(s).add(id));
    setTimeout(() => setFlash((s) => { const n = new Set(s); n.delete(id); return n; }), 1600);
  }

  useRealtime('task', (evt) => {
    setRows((prev) => {
      if (evt.action === 'deleted') return prev.filter((r) => r.id !== evt.data.id);
      const t = evt.data;
      if (evt.action === 'updated') return prev.map((r) => (r.id === t.id ? t : r));
      if (evt.action === 'created') return prev.some((r) => r.id === t.id) ? prev : [t, ...prev];
      return prev;
    });
    markFlash(evt.data?.id);
  });

  const userNames = useMemo(() => users.map((u) => u.full_name || u.username).filter(Boolean), [users]);

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filters.status && r.status !== filters.status) return false;
      if (filters.type && r.task_type !== filters.type) return false;
      if (filters.priority && r.priority !== filters.priority) return false;
      if (filters.assignedTo && r.assigned_to !== filters.assignedTo) return false;
      if (filters.related && r.related_kind !== filters.related) return false;
      if (filters.from && (!r.due_date || r.due_date < filters.from)) return false;
      if (filters.to && (!r.due_date || r.due_date > filters.to)) return false;
      if (q) {
        const hay = [r.title, r.task_type, r.assigned_to, r.assigned_by, r.related_name, r.remarks]
          .map((v) => String(v || '').toLowerCase()).join(' ');
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, filters]);

  const activeFilterCount = useMemo(
    () => ['status', 'type', 'priority', 'assignedTo', 'related', 'from', 'to'].filter((k) => filters[k]).length,
    [filters]
  );

  const stats = useMemo(() => {
    const today = todayISO();
    const isOpen = (r) => !TASK_DONE.includes(r.status);
    return {
      open: filtered.filter(isOpen).length,
      today: filtered.filter((r) => isOpen(r) && r.due_date === today).length,
      overdue: filtered.filter((r) => isOpen(r) && r.due_date && r.due_date < today).length,
      completed: filtered.filter((r) => r.status === 'Completed').length,
    };
  }, [filtered]);

  function openAdd() { setForm({ id: null, seed: emptyTask() }); }
  function openEdit(r) { setForm({ id: r.id, seed: { ...emptyTask(), ...r, reminder_days: r.reminder_days ?? '' } }); }
  function onSaved(row) {
    setRows((prev) => (prev.some((r) => r.id === row.id) ? prev.map((r) => (r.id === row.id ? row : r)) : [row, ...prev]));
  }

  async function changeStatus(task, status) {
    if (!status || status === task.status) return;
    const snap = rows;
    setRows((prev) => prev.map((r) => (r.id === task.id ? { ...r, status } : r)));
    try { await api('/tasks/' + task.id, { method: 'PUT', body: { status } }); }
    catch (e) { setRows(snap); toast.error(e.message || 'Could not update status'); }
  }

  async function del(r) {
    const ok = await confirm({
      title: 'Delete task?', message: `“${r.title}” will be permanently removed.`,
      tone: 'danger', confirmText: 'Delete', icon: 'trash',
    });
    if (!ok) return;
    const snap = rows;
    setRows((prev) => prev.filter((x) => x.id !== r.id));
    try { await api('/tasks/' + r.id, { method: 'DELETE' }); toast.success('Task deleted'); }
    catch (e) { setRows(snap); toast.error(e.message || 'Could not delete task'); }
  }

  function onDrop(status) {
    setOverCol(null);
    const t = rows.find((r) => r.id === dragId);
    setDragId(null);
    if (t) changeStatus(t, status);
  }

  const today = todayISO();
  const isOverdue = (r) => !TASK_DONE.includes(r.status) && r.due_date && r.due_date < today;

  const kpis = [
    { label: 'Open Tasks', num: stats.open, icon: 'checksquare', tone: 'info' },
    { label: 'Due Today', num: stats.today, icon: 'clock', tone: 'warning' },
    { label: 'Overdue', num: stats.overdue, icon: 'alert', tone: 'danger' },
    { label: 'Completed', num: stats.completed, icon: 'check', tone: 'success' },
  ];

  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle="Assign work, track progress and get reminded before it's due"
        action={<button className="btn blue" onClick={openAdd}><Ic name="plus" size={16} /> New Task</button>}
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
        <div className="tabs" style={{ marginBottom: 0 }}>
          <button className={'tab' + (view === 'list' ? ' active' : '')} onClick={() => setView('list')}><Ic name="grid" size={14} /> List</button>
          <button className={'tab' + (view === 'kanban' ? ' active' : '')} onClick={() => setView('kanban')}><Ic name="chart" size={14} /> Kanban</button>
        </div>
        <div className="dt-search" style={{ flex: 1, maxWidth: 340 }}>
          <span className="dt-search-ic"><Ic name="search" size={16} /></span>
          <input placeholder="Search subject, assignee, related…" value={filters.q} onChange={(e) => setFilters((x) => ({ ...x, q: e.target.value }))} />
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
                <option value="">All</option>{TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select></div>
            <div className="form-field"><label>Task Type</label>
              <Select value={filters.type} onChange={(e) => setFilters((x) => ({ ...x, type: e.target.value }))}>
                <option value="">All</option>{TASK_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select></div>
            <div className="form-field"><label>Priority</label>
              <Select value={filters.priority} onChange={(e) => setFilters((x) => ({ ...x, priority: e.target.value }))}>
                <option value="">All</option>{TASK_PRIORITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select></div>
            <div className="form-field"><label>Assigned To</label>
              <Select value={filters.assignedTo} onChange={(e) => setFilters((x) => ({ ...x, assignedTo: e.target.value }))}>
                <option value="">All</option>{userNames.map((u) => <option key={u} value={u}>{u}</option>)}
              </Select></div>
            <div className="form-field"><label>Task For</label>
              <Select value={filters.related} onChange={(e) => setFilters((x) => ({ ...x, related: e.target.value }))}>
                <option value="">All</option>{TASK_RELATED_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
              </Select></div>
            <div className="form-field"><label>Due From</label>
              <DateField value={filters.from} onChange={(e) => setFilters((x) => ({ ...x, from: e.target.value }))} /></div>
            <div className="form-field"><label>Due To</label>
              <DateField value={filters.to} onChange={(e) => setFilters((x) => ({ ...x, to: e.target.value }))} /></div>
          </div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn ghost" onClick={() => setFilters(BLANK_FILTERS)}><Ic name="x" size={15} /> Clear all</button>
            <span className="filter-count">{filtered.length} of {rows.length} tasks</span>
          </div>
        </div>
      )}

      {view === 'list' ? (
        <div className="card">
          <DataTable
            title="Tasks"
            count={filtered.length}
            loading={loading}
            rows={filtered}
            flash={flash}
            search={false}
            onRowClick={openEdit}
            columns={[
              { key: 'start_date', label: 'Start', render: (r) => fmtDate(r.start_date) || '—' },
              { key: 'due_date', label: 'Due', render: (r) => (
                r.due_date
                  ? <span className={isOverdue(r) ? 'overdue-date' : undefined}>{fmtDate(r.due_date)}</span>
                  : '—'
              ) },
              { key: 'title', label: 'Task Subject' },
              { key: 'task_type', label: 'Type', render: (r) => r.task_type || '—' },
              { key: 'related_name', label: 'Task For', render: (r) => (
                r.related_name
                  ? <span><Ic name={TASK_RELATED_KINDS.find((k) => k.key === r.related_kind)?.icon || 'user'} size={12} /> {r.related_name}</span>
                  : '—'
              ) },
              { key: 'assigned_by', label: 'Assigned By', render: (r) => r.assigned_by || '—' },
              { key: 'assigned_to', label: 'Assign To', render: (r) => r.assigned_to || '—' },
              { key: 'priority', label: 'Priority', render: (r) => <span className={'badge ' + (r.priority === 'High' ? 'red' : r.priority === 'Low' ? '' : 'blue')}>{r.priority || 'Medium'}</span> },
              { key: 'reminder_days', label: 'Reminder', noFilter: true, render: (r) => (r.reminder_days == null ? '—' : reminderLabel(r.reminder_days)) },
              { key: 'status', label: 'Status', render: (r) => <span className={'badge ' + (TASK_STATUS_BADGE[r.status] || '')}>{r.status || 'Not Started'}</span> },
            ]}
            actions={(r) => (
              <>
                <button className="action-btn" title="Edit" onClick={() => openEdit(r)}><Ic name="edit" size={15} /></button>
                <button className="action-btn danger" title="Delete" onClick={() => del(r)}><Ic name="trash" size={15} /></button>
              </>
            )}
            empty={{
              icon: 'checksquare',
              title: rows.length ? 'No tasks match these filters' : 'No tasks yet',
              sub: rows.length ? 'Try clearing a filter or two.' : 'Create your first task to get started.',
            }}
          />
        </div>
      ) : (
        <div className="kanban">
          {TASK_STATUSES.map((st) => {
            const cards = filtered.filter((r) => (r.status || 'Not Started') === st);
            return (
              <div
                key={st}
                className={'kanban-col' + (overCol === st ? ' over' : '')}
                onDragOver={(e) => { e.preventDefault(); setOverCol(st); }}
                onDragLeave={() => setOverCol((c) => (c === st ? null : c))}
                onDrop={() => onDrop(st)}
              >
                <div className="kanban-col-head">
                  <span><span className={'kanban-dot ' + (TASK_STATUS_BADGE[st] || '')} /> {st}</span>
                  <span className="kanban-count">{cards.length}</span>
                </div>
                {cards.length === 0 && <div className="kanban-empty">Drop a task here</div>}
                {cards.map((r) => (
                  <div
                    key={r.id}
                    className={'kanban-card' + (dragId === r.id ? ' dragging' : '') + (flash.has(r.id) ? ' flash' : '')}
                    draggable
                    onDragStart={() => setDragId(r.id)}
                    onDragEnd={() => { setDragId(null); setOverCol(null); }}
                    onClick={() => openEdit(r)}
                  >
                    <div className="kanban-name">{r.title}</div>
                    {r.related_name && <div className="kanban-company">{r.related_name}</div>}
                    <div className="kanban-meta">
                      {r.due_date && <span className={isOverdue(r) ? 'overdue-date' : undefined}><Ic name="calendar" size={11} /> {fmtDate(r.due_date)}</span>}
                      {r.assigned_to && <span><Ic name="user" size={11} /> {r.assigned_to}</span>}
                      {r.priority === 'High' && <span className="badge red">High</span>}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      <TaskFormModal
        open={!!form}
        taskId={form?.id}
        seed={form?.seed}
        onClose={() => setForm(null)}
        onSaved={onSaved}
      />
    </div>
  );
}
