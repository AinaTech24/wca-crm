import { useEffect, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import Select from '../components/Select.jsx';
import DateField, { fmt as fmtDate } from '../components/DateField.jsx';
import { Ic } from '../components/Icons.jsx';
import { useRealtime } from '../realtime.js';
import MeetingFormModal, { meetingToForm } from './MeetingFormModal.jsx';
import { emptyMeeting, MEETING_STATUS_BADGE } from './meetingConstants.js';
import { STATUSES, STATUS_BADGE, PRIORITIES, TASK_STATUSES, REFERRAL_SOURCE, todayISO } from './leadConstants.js';

// Tasks and Notes are lightweight rows on the lead itself; Meetings is a
// related list of real records from the Meeting module, so a meeting booked
// here is the same record you see under Meetings.
const TABS = [
  { key: 'task', label: 'Tasks', icon: 'checksquare' },
  { key: 'meeting', label: 'Meetings', icon: 'calendar' },
  { key: 'note', label: 'Notes', icon: 'doc' },
];

const emptyActivity = (kind) => ({
  kind, title: '', body: '', due_date: kind === 'note' ? '' : todayISO(),
  status: 'Open', priority: 'Medium', owner: '',
});

function Row({ k, v }) {
  return <div className="info-row"><span className="k">{k}</span><span className="v">{v || '—'}</span></div>;
}

export default function LeadDetail({ lead, userNames, onBack, onEdit, onDelete, onStatusChange }) {
  const [tab, setTab] = useState('task');
  const [acts, setActs] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [composer, setComposer] = useState(emptyActivity('task'));
  const [open, setOpen] = useState(false);
  const [meetingForm, setMeetingForm] = useState(null); // { id, seed }

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      api(`/leads/${lead.id}/activities`).catch(() => []),
      api(`/leads/${lead.id}/meetings`).catch(() => []),
    ]).then(([a, m]) => {
      if (!alive) return;
      setActs(a); setMeetings(m);
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

  const setC = (k, v) => setComposer((p) => ({ ...p, [k]: v }));
  const kindActs = acts.filter((a) => a.kind === tab);
  const countOf = (kind) => (kind === 'meeting' ? meetings.length : acts.filter((a) => a.kind === kind).length);

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
      toast.success(isNote ? 'Note added' : 'Task added');
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

          {/* Meetings open the real Meeting form; tasks/notes use the inline composer. */}
          {(!open || tab === 'meeting') && (
            <button
              className="btn blue"
              style={{ marginBottom: 14 }}
              onClick={() => (tab === 'meeting' ? scheduleMeeting() : setOpen(true))}
            >
              <Ic name="plus" size={15} /> {addLabel}
            </button>
          )}

          {open && tab !== 'meeting' && (
            <div className="composer">
              <div className="section-head">{addLabel}</div>
              {tab === 'note' ? (
                <div className="form-field">
                  <textarea rows={3} autoFocus value={composer.body} onChange={(e) => setC('body', e.target.value)} placeholder="What happened on this lead?" />
                </div>
              ) : (
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
              )}
              <div className="btn-row" style={{ marginTop: 12 }}>
                <button className="btn blue" onClick={addActivity}><Ic name="check" size={15} /> Save</button>
                <button className="btn ghost" onClick={() => { setOpen(false); setComposer(emptyActivity(tab)); }}>Cancel</button>
              </div>
            </div>
          )}

          {loading && <div className="notif-empty"><span>Loading…</span></div>}

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

          {/* ---- tasks / notes ---- */}
          {!loading && tab !== 'meeting' && kindActs.length === 0 && (
            <div className="notif-empty">
              <Ic name={TABS.find((t) => t.key === tab).icon} size={22} />
              <span>No {tab === 'task' ? 'tasks' : 'notes'} yet</span>
            </div>
          )}
          {!loading && tab !== 'meeting' && kindActs.map((a) => (
            <div key={a.id} className="act-item">
              {a.kind === 'task' && (
                <button className="action-btn" title={a.status === 'Done' ? 'Mark open' : 'Mark done'} onClick={() => toggleTask(a)}>
                  <Ic name={a.status === 'Done' ? 'check' : 'checksquare'} size={15} />
                </button>
              )}
              {a.kind === 'note' && <span className="act-ic"><Ic name="doc" size={15} /></span>}
              <div style={{ flex: 1, minWidth: 0 }}>
                {a.kind !== 'note' && (
                  <div style={{ fontWeight: 650, textDecoration: a.status === 'Done' ? 'line-through' : 'none' }}>{a.title}</div>
                )}
                {a.body && <div className="act-body">{a.body}</div>}
                <div className="act-meta">
                  {a.kind === 'task' && <span className={'badge ' + (a.status === 'Done' ? 'green' : a.priority === 'High' ? 'red' : 'blue')}>{a.status === 'Done' ? 'Done' : a.priority}</span>}
                  {a.due_date && <span><Ic name="calendar" size={12} /> {fmtDate(a.due_date) || a.due_date}</span>}
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
    </div>
  );
}
