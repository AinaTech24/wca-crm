import { useEffect, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import Select from '../components/Select.jsx';
import DateField, { fmt as fmtDate } from '../components/DateField.jsx';
import { Ic } from '../components/Icons.jsx';
import { useRealtime } from '../realtime.js';
import { STATUSES, STATUS_BADGE, PRIORITIES, TASK_STATUSES, REFERRAL_SOURCE, todayISO } from './leadConstants.js';

const TABS = [
  { key: 'task', label: 'Tasks', icon: 'checksquare' },
  { key: 'meeting', label: 'Meetings', icon: 'calendar' },
  { key: 'note', label: 'Notes', icon: 'doc' },
];

const emptyActivity = (kind) => ({
  kind, title: '', body: '', due_date: kind === 'note' ? '' : todayISO(),
  meeting_time: '', location: '', status: 'Open', priority: 'Medium', owner: '',
});

function Row({ k, v }) {
  return <div className="info-row"><span className="k">{k}</span><span className="v">{v || '—'}</span></div>;
}

export default function LeadDetail({ lead, userNames, onBack, onEdit, onDelete, onStatusChange }) {
  const [tab, setTab] = useState('task');
  const [acts, setActs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [composer, setComposer] = useState(emptyActivity('task'));
  const [open, setOpen] = useState(false); // composer visibility, Zoho-style "+ Add"

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api(`/leads/${lead.id}/activities`)
      .then((r) => { if (alive) setActs(r); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [lead.id]);

  useRealtime('lead-activity', (evt) => {
    const a = evt.data;
    if (evt.action === 'deleted') { setActs((p) => p.filter((x) => x.id !== a.id)); return; }
    if (a.lead_id !== lead.id) return;
    setActs((p) => {
      if (evt.action === 'updated') return p.map((x) => (x.id === a.id ? a : x));
      return p.some((x) => x.id === a.id) ? p : [a, ...p];
    });
  });

  const setC = (k, v) => setComposer((p) => ({ ...p, [k]: v }));
  const kindActs = acts.filter((a) => a.kind === tab);
  const countOf = (kind) => acts.filter((a) => a.kind === kind).length;

  function switchTab(k) { setTab(k); setComposer(emptyActivity(k)); setOpen(false); }

  async function addActivity() {
    const c = composer;
    const isNote = c.kind === 'note';
    if (isNote ? !c.body.trim() : !c.title.trim()) {
      toast.error(isNote ? 'Write something first' : 'A title is required');
      return;
    }
    try {
      const row = await api(`/leads/${lead.id}/activities`, { method: 'POST', body: c });
      setActs((p) => (p.some((x) => x.id === row.id) ? p : [row, ...p]));
      setComposer(emptyActivity(c.kind));
      setOpen(false);
      toast.success(isNote ? 'Note added' : c.kind === 'task' ? 'Task added' : 'Meeting scheduled');
    } catch (e) { toast.error(e.message || 'Could not save'); }
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

  const addLabel = tab === 'task' ? 'Add Task' : tab === 'note' ? 'Add Note' : 'Schedule Meeting';

  return (
    <div>
      <div className="detail-top">
        <button className="btn ghost" onClick={onBack}><Ic name="arrowleft" size={15} /> Back to Leads</button>
        <div className="detail-actions">
          <button className="btn ghost" onClick={() => onEdit(lead)}><Ic name="edit" size={15} /> Edit</button>
          <button className="btn ghost danger" onClick={() => onDelete(lead)}><Ic name="trash" size={15} /> Delete</button>
        </div>
      </div>

      <div className="detail-hero card card-pad">
        <div className="detail-hero-ic"><Ic name="target" size={22} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="detail-hero-name">{lead.lead_name}</h2>
          <div className="detail-hero-sub">
            {lead.company_name || 'No company'}
            {lead.expected_business_type ? ` · ${lead.expected_business_type}` : ''}
          </div>
        </div>
        <div className="detail-hero-status">
          <label>Status</label>
          <Select value={lead.status || 'New'} onChange={(e) => onStatusChange(lead, e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>
      </div>

      <div className="lead-detail-grid">
        <div className="card card-pad">
          <div className="section-head">Lead Information</div>
          <Row k="Lead Name" v={lead.lead_name} />
          <Row k="Date" v={fmtDate(lead.lead_date)} />
          <Row k="Expected Business Type" v={lead.expected_business_type} />
          <Row k="Mobile" v={lead.mobile} />
          <Row k="Email" v={lead.email} />
          <Row k="Company Name" v={lead.company_name} />
          <Row k="Lead Owner" v={lead.lead_owner} />
          <Row k="Lead Source" v={lead.source} />
          {lead.source === REFERRAL_SOURCE && <Row k="Referred By" v={lead.referral_client_name} />}
          <Row k="Lead Status" v={<span className={'badge ' + (STATUS_BADGE[lead.status] || '')}>{lead.status || 'New'}</span>} />
          <Row k="Next Follow-up" v={fmtDate(lead.followup_date)} />
          <Row k="Created" v={lead.created_at} />
          {lead.remarks && (
            <div style={{ marginTop: 12 }}>
              <div className="section-head" style={{ marginBottom: 6 }}>Remarks</div>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--text-2)' }}>{lead.remarks}</div>
            </div>
          )}
        </div>

        <div className="card card-pad">
          <div className="tabs">
            {TABS.map((t) => (
              <button key={t.key} className={'tab' + (tab === t.key ? ' active' : '')} onClick={() => switchTab(t.key)}>
                <Ic name={t.icon} size={14} /> {t.label}{countOf(t.key) > 0 ? ` (${countOf(t.key)})` : ''}
              </button>
            ))}
          </div>

          {!open && (
            <button className="btn blue" style={{ marginBottom: 14 }} onClick={() => setOpen(true)}>
              <Ic name="plus" size={15} /> {addLabel}
            </button>
          )}

          {open && (
            <div className="composer">
              <div className="section-head">{addLabel}</div>
              {tab === 'note' ? (
                <div className="form-field">
                  <textarea rows={3} autoFocus value={composer.body} onChange={(e) => setC('body', e.target.value)} placeholder="What happened on this lead?" />
                </div>
              ) : tab === 'task' ? (
                <div className="form-grid">
                  <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Subject</label>
                    <input autoFocus value={composer.title} onChange={(e) => setC('title', e.target.value)} placeholder="e.g. Call to confirm requirement" /></div>
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
                    <Select value={composer.owner} onChange={(e) => setC('owner', e.target.value)}>
                      <option value="">Me</option>
                      {userNames.map((u) => <option key={u} value={u}>{u}</option>)}
                    </Select></div>
                </div>
              ) : (
                <div className="form-grid">
                  <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Title</label>
                    <input autoFocus value={composer.title} onChange={(e) => setC('title', e.target.value)} placeholder="e.g. Product walkthrough" /></div>
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
                <button className="btn blue" onClick={addActivity}><Ic name="check" size={15} /> Save</button>
                <button className="btn ghost" onClick={() => { setOpen(false); setComposer(emptyActivity(tab)); }}>Cancel</button>
              </div>
            </div>
          )}

          {loading && <div className="notif-empty"><span>Loading…</span></div>}
          {!loading && kindActs.length === 0 && (
            <div className="notif-empty">
              <Ic name={TABS.find((t) => t.key === tab).icon} size={22} />
              <span>No {tab === 'task' ? 'tasks' : tab === 'note' ? 'notes' : 'meetings'} yet</span>
            </div>
          )}

          {kindActs.map((a) => (
            <div key={a.id} className="act-item">
              {a.kind === 'task' && (
                <button className="action-btn" title={a.status === 'Done' ? 'Mark open' : 'Mark done'} onClick={() => toggleTask(a)}>
                  <Ic name={a.status === 'Done' ? 'check' : 'checksquare'} size={15} />
                </button>
              )}
              {a.kind !== 'task' && <span className="act-ic"><Ic name={a.kind === 'note' ? 'doc' : 'calendar'} size={15} /></span>}
              <div style={{ flex: 1, minWidth: 0 }}>
                {a.kind !== 'note' && (
                  <div style={{ fontWeight: 650, textDecoration: a.status === 'Done' ? 'line-through' : 'none' }}>{a.title}</div>
                )}
                {a.body && <div className="act-body">{a.body}</div>}
                <div className="act-meta">
                  {a.kind === 'task' && <span className={'badge ' + (a.status === 'Done' ? 'green' : a.priority === 'High' ? 'red' : 'blue')}>{a.status === 'Done' ? 'Done' : a.priority}</span>}
                  {a.due_date && <span><Ic name="calendar" size={12} /> {fmtDate(a.due_date) || a.due_date}</span>}
                  {a.meeting_time && <span><Ic name="clock" size={12} /> {a.meeting_time}</span>}
                  {a.location && <span><Ic name="pin" size={12} /> {a.location}</span>}
                  {a.owner && <span><Ic name="user" size={12} /> {a.owner}</span>}
                  <span className="act-when">{a.created_at}</span>
                </div>
              </div>
              <button className="action-btn danger" title="Delete" onClick={() => delActivity(a)}><Ic name="trash" size={15} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
