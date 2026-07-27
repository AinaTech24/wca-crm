import { useEffect, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import { useRealtime } from '../realtime.js';
import Select from '../components/Select.jsx';
import DateField from '../components/DateField.jsx';

const pri = (p) => (p === 'High' ? 'red' : p === 'Medium' ? 'orange' : 'blue');

export default function TaskManagement() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({ title: '', priority: 'Medium', due_date: '' });
  const [flash, setFlash] = useState(() => new Set());

  function load() { setLoading(true); api('/tasks').then(setRows).finally(() => setLoading(false)); }
  useEffect(() => { load(); }, []);

  function markFlash(id) {
    if (id == null) return;
    setFlash((s) => new Set(s).add(id));
    setTimeout(() => setFlash((s) => { const n = new Set(s); n.delete(id); return n; }), 1600);
  }
  useRealtime('task', (evt) => {
    const t = evt.data;
    setRows((prev) => {
      if (evt.action === 'created') return prev.some((x) => x.id === t.id) ? prev.map((x) => (x.id === t.id ? t : x)) : [...prev, t];
      if (evt.action === 'updated') return prev.map((x) => (x.id === t.id ? t : x));
      return prev;
    });
    markFlash(t?.id);
  });

  async function add() {
    if (!f.title.trim()) { toast.error('Task title is required'); return; }
    try { await api('/tasks', { method: 'POST', body: f }); toast.success('Task added'); setF({ title: '', priority: 'Medium', due_date: '' }); }
    catch (e) { toast.error(e.message || 'Could not add task'); }
  }
  async function toggle(t) {
    const next = t.status === 'Done' ? 'Open' : 'Done';
    setRows((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: next } : x))); // optimistic
    try { await api('/tasks/' + t.id, { method: 'PUT', body: { status: next } }); }
    catch (e) { setRows((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: t.status } : x))); toast.error(e.message || 'Could not update task'); }
  }

  const columns = [
    { key: 'done', label: 'Done', width: '60px', render: (t) => (
      <input type="checkbox" checked={t.status === 'Done'} onChange={() => toggle(t)} aria-label={`Mark "${t.title}" done`} />
    ) },
    { key: 'title', label: 'Title', render: (t) => <span style={t.status === 'Done' ? { textDecoration: 'line-through', color: 'var(--text-3)' } : undefined}>{t.title}</span> },
    { key: 'assigned_to', label: 'Assigned To' },
    { key: 'priority', label: 'Priority', render: (t) => <span className={'badge ' + pri(t.priority)}>{t.priority}</span> },
    { key: 'due_date', label: 'Due Date' },
    { key: 'status', label: 'Status', render: (t) => <span className={'badge ' + (t.status === 'Done' ? 'green' : 'orange')}>{t.status}</span> },
  ];

  return (
    <div>
      <PageHeader title="Task Management" subtitle="Track your to-dos and follow-ups" />

      <div className="card card-pad" style={{ marginBottom: 20 }}>
        <div className="section-head">New Task</div>
        <div className="form-grid">
          <div className="form-field"><label>Task Title <span className="req">*</span></label><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && add()} /></div>
          <div className="form-field"><label>Priority</label><Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option>High</option><option>Medium</option><option>Low</option></Select></div>
          <div className="form-field"><label>Due Date</label><DateField value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></div>
        </div>
        <div className="btn-row"><button className="btn blue" onClick={add}>Add Task</button></div>
      </div>

      <div className="card">
        <DataTable
          title={<>Tasks <span className="sub">({rows.length})</span></>}
          searchPlaceholder="Search tasks…"
          loading={loading}
          rows={rows}
          flash={flash}
          columns={columns}
          empty={{ icon: 'checksquare', title: 'No tasks', sub: 'Add a to-do or follow-up above.' }}
        />
      </div>
    </div>
  );
}
