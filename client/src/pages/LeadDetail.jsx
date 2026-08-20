import { useEffect, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import Select from '../components/Select.jsx';
import DateField, { fmt as fmtDate } from '../components/DateField.jsx';
import { Ic } from '../components/Icons.jsx';
import { useRealtime } from '../realtime.js';
import MeetingFormModal, { meetingToForm } from './MeetingFormModal.jsx';
import { emptyMeeting, MEETING_STATUS_BADGE } from './meetingConstants.js';
import TaskFormModal from './TaskFormModal.jsx';
import { emptyTask, TASK_STATUS_BADGE } from './taskConstants.js';
import confirm from '../components/confirm.js';
import { STATUSES, STATUS_BADGE, REFERRAL_SOURCE } from './leadConstants.js';

// Tasks and Meetings are related lists of real records from their own
// modules, so anything logged here is the same record you see there. Only
// Notes are lightweight rows on the lead itself.
const TABS = [
  { key: 'task', label: 'Tasks', icon: 'checksquare' },
  { key: 'meeting', label: 'Meetings', icon: 'calendar' },
  { key: 'note', label: 'Notes', icon: 'doc' },
];

const emptyNote = () => ({ kind: 'note', body: '' });

function Row({ k, v }) {
  return <div className="info-row"><span className="k">{k}</span><span className="v">{v || '—'}</span></div>;
}

export default function LeadDetail({ lead, userNames, onBack, onEdit, onDelete, onStatusChange }) {
  const [tab, setTab] = useState('task');
  const [acts, setActs] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [composer, setComposer] = useState(emptyNote);
  const [open, setOpen] = useState(false);
  const [meetingForm, setMeetingForm] = useState(null); // { id, seed }
  const [taskForm, setTaskForm] = useState(null);       // { id, seed }

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      api(`/leads/${lead.id}/activities`).catch(() => []),
      api(`/leads/${lead.id}/meetings`).catch(() => []),
      api(`/tasks?relatedKind=lead&relatedId=${lead.id}`).catch(() => []),
    ]).then(([a, m, t]) => {
      if (!alive) return;
      setActs(a); setMeetings(m); setTasks(t);
    }).finally(() => { if (alive) setLoading(false); });
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

  // A meeting can gain or lose this lead as a participant from anywhere, so
  // re-check membership on every event rather than assuming the local list.
  useRealtime('meeting', (evt) => {
    const m = evt.data;
    if (evt.action === 'deleted') { setMeetings((p) => p.filter((x) => x.id !== m.id)); return; }
    const belongs = (m.participants || []).some((p) => p.kind === 'lead' && p.ref_id === lead.id);
    setMeetings((p) => {
      const without = p.filter((x) => x.id !== m.id);
      return belongs ? [m, ...without] : without;
    });
  });

  // A task can be re-pointed at a different record from anywhere, so
  // membership is re-checked on every event rather than trusted.
  useRealtime('task', (evt) => {
    const t = evt.data;
    if (evt.action === 'deleted') { setTasks((p) => p.filter((x) => x.id !== t.id)); return; }
    const belongs = t.related_kind === 'lead' && t.related_id === lead.id;
    setTasks((p) => {
      const without = p.filter((x) => x.id !== t.id);
      return belongs ? [t, ...without] : without;
    });
  });

  const setC = (k, v) => setComposer((p) => ({ ...p, [k]: v }));
  const notes = acts.filter((a) => a.kind === 'note');
  const countOf = (kind) => (kind === 'meeting' ? meetings.length : kind === 'task' ? tasks.length : notes.length);

  function switchTab(k) { setTab(k); setComposer(emptyNote()); setOpen(false); }

  async function addNote() {
    if (!composer.body.trim()) { toast.error('Write something first'); return; }
    try {
      const row = await api(`/leads/${lead.id}/activities`, { method: 'POST', body: composer });
      setActs((p) => (p.some((x) => x.id === row.id) ? p : [row, ...p]));
      setComposer(emptyNote());
      setOpen(false);
      toast.success('Note added');
    } catch (e) { toast.error(e.message || 'Could not save'); }
  }

  async function delActivity(a) {
    const snap = acts;
    setActs((p) => p.filter((x) => x.id !== a.id));
    try { await api('/lead-activities/' + a.id, { method: 'DELETE' }); }
    catch (e) { setActs(snap); toast.error(e.message || 'Could not delete'); }
  }

  async function toggleTask(t) {
    const next = t.status === 'Completed' ? 'In Progress' : 'Completed';
    setTasks((p) => p.map((x) => (x.id === t.id ? { ...x, status: next } : x)));
    try { await api('/tasks/' + t.id, { method: 'PUT', body: { status: next } }); }
    catch (e) {
      setTasks((p) => p.map((x) => (x.id === t.id ? { ...x, status: t.status } : x)));
      toast.error(e.message || 'Could not update task');
    }
  }

  // Creating from a lead pins the lead as the "Task For" record, so the task
  // is guaranteed to come back in this related list.
  const leadRelation = { related_kind: 'lead', related_id: lead.id, related_name: lead.lead_name };
  function newTask() {
    setTaskForm({ id: null, seed: { ...emptyTask(), ...leadRelation, title: '' } });
  }
  function onTaskSaved(row) {
    const belongs = row.related_kind === 'lead' && row.related_id === lead.id;
    setTasks((p) => {
      const without = p.filter((x) => x.id !== row.id);
      return belongs ? [row, ...without] : without;
    });
  }

  // Scheduling from a lead pre-fills the lead as a (locked) participant, so
  // the meeting is guaranteed to come back in this related list.
  const leadParticipant = { kind: 'lead', ref_id: lead.id, name: lead.lead_name, email: lead.email || '', mobile: lead.mobile || '' };
  function scheduleMeeting() {
    setMeetingForm({
      id: null,
      seed: {
        ...emptyMeeting(),
        title: `Meeting with ${lead.lead_name}`,
        participants: [leadParticipant],
      },
    });
  }
  function onMeetingSaved(row) {
    const belongs = (row.participants || []).some((p) => p.kind === 'lead' && p.ref_id === lead.id);
    setMeetings((p) => {
      const without = p.filter((x) => x.id !== row.id);
      return belongs ? [row, ...without] : without;
    });
  }

  const [converting, setConverting] = useState(false);
  // Creates the client record carrying the lead's source and referrer across,
  // and flips the lead to Converted. The server refuses a second conversion
  // of the same lead rather than silently making a duplicate client.
  async function convertToClient() {
    const ok = await confirm({
      title: 'Convert this lead to a client?',
      message: `A client record will be created for “${lead.lead_name}”, carrying over the lead source${lead.referral_client_name ? ' and referrer' : ''}. The lead will be marked Converted.`,
      confirmText: 'Convert', icon: 'userplus',
    });
    if (!ok) return;
    setConverting(true);
    try {
      const res = await api(`/leads/${lead.id}/convert-to-client`, { method: 'POST', body: {} });
      toast.success(`${res.client?.client_name || lead.lead_name} is now a client`);
      onStatusChange?.({ ...lead, status: lead.status }, 'Converted');
    } catch (e) {
      toast.error(e.message || 'Could not convert this lead');
    } finally { setConverting(false); }
  }

  const addLabel = tab === 'task' ? 'New Task' : tab === 'note' ? 'Add Note' : 'Schedule Meeting';

  return (
    <div>
      <div className="detail-top">
        <button className="btn ghost" onClick={onBack}><Ic name="arrowleft" size={15} /> Back to Leads</button>
        <div className="detail-actions">
          <button className="btn ghost" onClick={convertToClient} disabled={converting}>
            <Ic name="userplus" size={15} /> {converting ? 'Converting…' : 'Convert to Client'}
          </button>
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

          {/* Tasks and meetings open their real module forms; only notes use
              the inline composer. */}
          {(!open || tab !== 'note') && (
            <button
              className="btn blue"
              style={{ marginBottom: 14 }}
              onClick={() => (tab === 'meeting' ? scheduleMeeting() : tab === 'task' ? newTask() : setOpen(true))}
            >
              <Ic name="plus" size={15} /> {addLabel}
            </button>
          )}

          {open && tab === 'note' && (
            <div className="composer">
              <div className="section-head">{addLabel}</div>
              <div className="form-field">
                <textarea rows={3} autoFocus value={composer.body} onChange={(e) => setC('body', e.target.value)} placeholder="What happened on this lead?" />
              </div>
              <div className="btn-row" style={{ marginTop: 12 }}>
                <button className="btn blue" onClick={addNote}><Ic name="check" size={15} /> Save</button>
                <button className="btn ghost" onClick={() => { setOpen(false); setComposer(emptyNote()); }}>Cancel</button>
              </div>
            </div>
          )}

          {loading && <div className="notif-empty"><span>Loading…</span></div>}

          {/* ---- tasks related list ---- */}
          {!loading && tab === 'task' && (
            tasks.length === 0
              ? <div className="notif-empty"><Ic name="checksquare" size={22} /><span>No tasks for this lead</span></div>
              : tasks.map((t) => (
                <div key={t.id} className="act-item">
                  <button className="action-btn" title={t.status === 'Completed' ? 'Reopen' : 'Mark completed'} onClick={() => toggleTask(t)}>
                    <Ic name={t.status === 'Completed' ? 'check' : 'checksquare'} size={15} />
                  </button>
                  <div className="act-clickable-body" onClick={() => setTaskForm({ id: t.id, seed: { ...emptyTask(), ...t, reminder_days: t.reminder_days ?? '' } })}>
                    <div style={{ fontWeight: 650, textDecoration: t.status === 'Completed' ? 'line-through' : 'none' }}>{t.title}</div>
                    {t.remarks && <div className="act-body">{t.remarks}</div>}
                    <div className="act-meta">
                      <span className={'badge ' + (TASK_STATUS_BADGE[t.status] || '')}>{t.status || 'Not Started'}</span>
                      {t.task_type && <span><Ic name="tag" size={12} /> {t.task_type}</span>}
                      {t.due_date && <span><Ic name="calendar" size={12} /> due {fmtDate(t.due_date)}</span>}
                      {t.assigned_to && <span><Ic name="user" size={12} /> {t.assigned_to}</span>}
                      {t.reminder_days != null && <span><Ic name="bell" size={12} /></span>}
                    </div>
                  </div>
                  <span className="act-open"><Ic name="chevron-right" size={16} /></span>
                </div>
              ))
          )}

          {/* ---- meetings related list ---- */}
          {!loading && tab === 'meeting' && (
            meetings.length === 0
              ? <div className="notif-empty"><Ic name="calendar" size={22} /><span>No meetings scheduled with this lead</span></div>
              : meetings.map((m) => (
                <div key={m.id} className="act-item act-clickable" onClick={() => setMeetingForm({ id: m.id, seed: meetingToForm(m) })}>
                  <span className="act-ic"><Ic name="calendar" size={15} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 650 }}>{m.title}</div>
                    <div className="act-meta">
                      <span className={'badge ' + (MEETING_STATUS_BADGE[m.status] || '')}>{m.status || 'Scheduled'}</span>
                      {m.from_date && <span><Ic name="calendar" size={12} /> {fmtDate(m.from_date)}{m.from_time ? ` ${m.from_time}` : ''}</span>}
                      {m.location && <span><Ic name="pin" size={12} /> {m.location}</span>}
                      {m.owner && <span><Ic name="user" size={12} /> {m.owner}</span>}
                      {(m.participants || []).length > 1 && <span><Ic name="users" size={12} /> {m.participants.length} participants</span>}
                      {(m.reminders || []).length > 0 && <span><Ic name="bell" size={12} /> {m.reminders.length}</span>}
                    </div>
                    {m.minutes && <div className="act-body"><strong>MoM: </strong>{m.minutes}</div>}
                  </div>
                  <span className="act-open"><Ic name="chevron-right" size={16} /></span>
                </div>
              ))
          )}

          {/* ---- notes ---- */}
          {!loading && tab === 'note' && notes.length === 0 && (
            <div className="notif-empty"><Ic name="doc" size={22} /><span>No notes yet</span></div>
          )}
          {!loading && tab === 'note' && notes.map((a) => (
            <div key={a.id} className="act-item">
              <span className="act-ic"><Ic name="doc" size={15} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="act-body" style={{ marginTop: 0 }}>{a.body}</div>
                <div className="act-meta">
                  {a.owner && <span><Ic name="user" size={12} /> {a.owner}</span>}
                  <span className="act-when">{a.created_at}</span>
                </div>
              </div>
              <button className="action-btn danger" title="Delete" onClick={() => delActivity(a)}><Ic name="trash" size={15} /></button>
            </div>
          ))}
        </div>
      </div>

      <MeetingFormModal
        open={!!meetingForm}
        meetingId={meetingForm?.id}
        seed={meetingForm?.seed}
        lockedParticipant={leadParticipant}
        onClose={() => setMeetingForm(null)}
        onSaved={onMeetingSaved}
      />
      <TaskFormModal
        open={!!taskForm}
        taskId={taskForm?.id}
        seed={taskForm?.seed}
        lockRelation={leadRelation}
        onClose={() => setTaskForm(null)}
        onSaved={onTaskSaved}
      />
    </div>
  );
}
