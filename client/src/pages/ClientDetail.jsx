import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmt as fmtDate } from '../components/DateField.jsx';
import { Ic } from '../components/Icons.jsx';
import { useRealtime } from '../realtime.js';
import MeetingFormModal, { meetingToForm } from './MeetingFormModal.jsx';
import { emptyMeeting, MEETING_STATUS_BADGE } from './meetingConstants.js';
import TaskFormModal from './TaskFormModal.jsx';
import PolicyFormModal from './PolicyFormModal.jsx';
import { emptyPolicy, POLICY_STATUS_BADGE } from './policyConstants.js';
import { emptyTask, TASK_STATUS_BADGE } from './taskConstants.js';
import { STATUS_BADGE as LEAD_STATUS_BADGE } from './leadConstants.js';

// A client is the target of five lookups — policies, claims, referred leads,
// meetings and tasks all point at it. Each gets a related list here so the
// link is navigable from both ends.
const TABS = [
  { key: 'policies', label: 'Policies', icon: 'file' },
  { key: 'claims', label: 'Claims', icon: 'shieldcheck' },
  { key: 'leads', label: 'Referred Leads', icon: 'target' },
  { key: 'meetings', label: 'Meetings', icon: 'calendar' },
  { key: 'tasks', label: 'Tasks', icon: 'checksquare' },
];

const inr = (v) => Number(v || 0).toLocaleString('en-IN');
const EMPTY = { policies: [], claims: [], leads: [], meetings: [], tasks: [] };

function Row({ k, v }) {
  return <div className="info-row"><span className="k">{k}</span><span className="v">{v || '—'}</span></div>;
}

export default function ClientDetail({ client, onBack, onEdit, onDelete }) {
  const [tab, setTab] = useState('policies');
  const [rel, setRel] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [meetingForm, setMeetingForm] = useState(null);
  const [taskForm, setTaskForm] = useState(null);
  const [policyForm, setPolicyForm] = useState(null);

  function load() {
    return api(`/clients/${client.id}/related`).then(setRel).catch(() => setRel(EMPTY));
  }

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api(`/clients/${client.id}/related`)
      .then((r) => { if (alive) setRel(r); })
      .catch(() => { if (alive) setRel(EMPTY); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [client.id]);

  // Membership of these lists depends on fields that can change anywhere, so
  // rather than patching locally, re-pull the (single, cheap) related payload.
  useRealtime('meeting', () => load());
  useRealtime('task', () => load());
  useRealtime('lead', () => load());
  useRealtime('policy', () => load());
  useRealtime('claim', () => load());

  const clientParticipant = { kind: 'client', ref_id: client.id, name: client.client_name, email: client.email || '', mobile: client.mobile || '' };
  const clientRelation = { related_kind: 'client', related_id: client.id, related_name: client.client_name };

  function scheduleMeeting() {
    setMeetingForm({
      id: null,
      seed: { ...emptyMeeting(), title: `Meeting with ${client.client_name}`, participants: [clientParticipant] },
    });
  }
  function newTask() {
    setTaskForm({ id: null, seed: { ...emptyTask(), ...clientRelation, title: '' } });
  }
  function newPolicy() {
    setPolicyForm({
      id: null,
      seed: { ...emptyPolicy(), insured_name: client.client_name, client_id: client.id, client_email: client.email || '' },
    });
  }

  const count = (k) => rel[k]?.length || 0;
  const list = rel[tab] || [];

  return (
    <div>
      <div className="detail-top">
        <button className="btn ghost" onClick={onBack}><Ic name="arrowleft" size={15} /> Back to Clients</button>
        <div className="detail-actions">
          <button className="btn ghost" onClick={scheduleMeeting}><Ic name="calendar" size={15} /> Schedule Meeting</button>
          <button className="btn ghost" onClick={newTask}><Ic name="checksquare" size={15} /> New Task</button>
          <button className="btn ghost" onClick={() => onEdit(client)}><Ic name="edit" size={15} /> Edit</button>
          <button className="btn ghost danger" onClick={() => onDelete(client)}><Ic name="trash" size={15} /> Delete</button>
        </div>
      </div>

      <div className="detail-hero card card-pad">
        <div className="detail-hero-ic"><Ic name="user" size={22} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="detail-hero-name">{client.client_name}</h2>
          <div className="detail-hero-sub">
            {client.group_head_name || 'No group head'}
            {client.city ? ` · ${client.city}` : ''}
            {client.mobile ? ` · ${client.mobile}` : ''}
          </div>
        </div>
      </div>

      <div className="lead-detail-grid">
        <div className="card card-pad">
          <div className="section-head">Client Information</div>
          <Row k="Client Name" v={client.client_name} />
          <Row k="Group Head" v={client.group_head_name} />
          <Row k="Group Code" v={client.group_code} />
          <Row k="Mobile" v={client.mobile} />
          <Row k="Email" v={client.email} />
          <Row k="PAN No" v={client.pan_no} />
          <Row k="Date of Birth" v={fmtDate(client.dob)} />
          <Row k="Anniversary" v={fmtDate(client.anniversary)} />
          <Row k="Occupation" v={client.occupation} />
          <Row k="City" v={client.city} />
          <Row k="State" v={client.state} />
          <Row k="Pincode" v={client.pincode} />
          <Row k="Address" v={client.address} />
          <Row k="Owner" v={client.owner} />
        </div>

        <div className="card card-pad">
          <div className="tabs">
            {TABS.map((t) => (
              <button key={t.key} className={'tab' + (tab === t.key ? ' active' : '')} onClick={() => setTab(t.key)}>
                <Ic name={t.icon} size={14} /> {t.label}{count(t.key) > 0 ? ` (${count(t.key)})` : ''}
              </button>
            ))}
          </div>

          {tab === 'policies' && (
            <button className="btn blue" style={{ marginBottom: 14 }} onClick={newPolicy}>
              <Ic name="plus" size={15} /> New Policy
            </button>
          )}
          {tab === 'meetings' && (
            <button className="btn blue" style={{ marginBottom: 14 }} onClick={scheduleMeeting}>
              <Ic name="plus" size={15} /> Schedule Meeting
            </button>
          )}
          {tab === 'tasks' && (
            <button className="btn blue" style={{ marginBottom: 14 }} onClick={newTask}>
              <Ic name="plus" size={15} /> New Task
            </button>
          )}

          {loading && <div className="notif-empty"><span>Loading…</span></div>}

          {!loading && list.length === 0 && (
            <div className="notif-empty">
              <Ic name={TABS.find((t) => t.key === tab).icon} size={22} />
              <span>No {TABS.find((t) => t.key === tab).label.toLowerCase()} for this client</span>
            </div>
          )}

          {!loading && tab === 'policies' && list.map((p) => (
            <div key={p.id} className="act-item act-clickable" onClick={() => setPolicyForm({ id: p.id, seed: { ...emptyPolicy(), ...p } })}>
              <span className="act-ic"><Ic name="file" size={15} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 650 }}>{p.product_name || p.insurance_type || 'Policy'}</div>
                <div className="act-meta">
                  <span className={'badge ' + (POLICY_STATUS_BADGE[p.policy_status] || 'blue')}>{p.policy_status || 'Policy'}</span>
                  {p.policy_number && <span><Ic name="tag" size={12} /> {p.policy_number}</span>}
                  {p.company_name && <span><Ic name="building" size={12} /> {p.company_name}</span>}
                  {p.period_to && <span><Ic name="calendar" size={12} /> expires {fmtDate(p.period_to)}</span>}
                  {p.final_premium > 0 && <span><Ic name="rupee" size={12} /> {inr(p.final_premium)}</span>}
                </div>
              </div>
              <span className="act-open"><Ic name="chevron-right" size={16} /></span>
            </div>
          ))}

          {!loading && tab === 'claims' && list.map((c) => (
            <div key={c.id} className="act-item">
              <span className="act-ic"><Ic name="shieldcheck" size={15} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 650 }}>{c.claim_no || 'Claim'}</div>
                <div className="act-meta">
                  <span className="badge orange">{c.status || 'Pending'}</span>
                  {c.claim_type && <span><Ic name="tag" size={12} /> {c.claim_type}</span>}
                  {c.company_name && <span><Ic name="building" size={12} /> {c.company_name}</span>}
                  {c.claim_date && <span><Ic name="calendar" size={12} /> {fmtDate(c.claim_date)}</span>}
                  {c.claim_amount > 0 && <span><Ic name="rupee" size={12} /> {inr(c.claim_amount)}</span>}
                </div>
              </div>
            </div>
          ))}

          {!loading && tab === 'leads' && list.map((l) => (
            <div key={l.id} className="act-item">
              <span className="act-ic"><Ic name="target" size={15} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 650 }}>{l.lead_name}</div>
                <div className="act-meta">
                  <span className={'badge ' + (LEAD_STATUS_BADGE[l.status] || '')}>{l.status || 'New'}</span>
                  {l.expected_business_type && <span><Ic name="tag" size={12} /> {l.expected_business_type}</span>}
                  {l.company_name && <span><Ic name="building" size={12} /> {l.company_name}</span>}
                  {l.lead_date && <span><Ic name="calendar" size={12} /> {fmtDate(l.lead_date)}</span>}
                  {l.lead_owner && <span><Ic name="user" size={12} /> {l.lead_owner}</span>}
                </div>
              </div>
            </div>
          ))}

          {!loading && tab === 'meetings' && list.map((m) => (
            <div key={m.id} className="act-item act-clickable" onClick={() => setMeetingForm({ id: m.id, seed: meetingToForm(m) })}>
              <span className="act-ic"><Ic name="calendar" size={15} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 650 }}>{m.title}</div>
                <div className="act-meta">
                  <span className={'badge ' + (MEETING_STATUS_BADGE[m.status] || '')}>{m.status || 'Scheduled'}</span>
                  {m.from_date && <span><Ic name="calendar" size={12} /> {fmtDate(m.from_date)}{m.from_time ? ` ${m.from_time}` : ''}</span>}
                  {m.location && <span><Ic name="pin" size={12} /> {m.location}</span>}
                  {(m.participants || []).length > 1 && <span><Ic name="users" size={12} /> {m.participants.length}</span>}
                </div>
                {m.minutes && <div className="act-body"><strong>MoM: </strong>{m.minutes}</div>}
              </div>
              <span className="act-open"><Ic name="chevron-right" size={16} /></span>
            </div>
          ))}

          {!loading && tab === 'tasks' && list.map((t) => (
            <div key={t.id} className="act-item act-clickable" onClick={() => setTaskForm({ id: t.id, seed: { ...emptyTask(), ...t, reminder_days: t.reminder_days ?? '' } })}>
              <span className="act-ic"><Ic name="checksquare" size={15} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 650, textDecoration: t.status === 'Completed' ? 'line-through' : 'none' }}>{t.title}</div>
                {t.remarks && <div className="act-body">{t.remarks}</div>}
                <div className="act-meta">
                  <span className={'badge ' + (TASK_STATUS_BADGE[t.status] || '')}>{t.status || 'Not Started'}</span>
                  {t.task_type && <span><Ic name="tag" size={12} /> {t.task_type}</span>}
                  {t.due_date && <span><Ic name="calendar" size={12} /> due {fmtDate(t.due_date)}</span>}
                  {t.assigned_to && <span><Ic name="user" size={12} /> {t.assigned_to}</span>}
                </div>
              </div>
              <span className="act-open"><Ic name="chevron-right" size={16} /></span>
            </div>
          ))}
        </div>
      </div>

      <MeetingFormModal
        open={!!meetingForm}
        meetingId={meetingForm?.id}
        seed={meetingForm?.seed}
        lockedParticipant={clientParticipant}
        onClose={() => setMeetingForm(null)}
        onSaved={() => load()}
      />
      <PolicyFormModal
        open={!!policyForm}
        policyId={policyForm?.id}
        seed={policyForm?.seed}
        lockClient
        onClose={() => setPolicyForm(null)}
        onSaved={() => load()}
      />
      <TaskFormModal
        open={!!taskForm}
        taskId={taskForm?.id}
        seed={taskForm?.seed}
        lockRelation={clientRelation}
        onClose={() => setTaskForm(null)}
        onSaved={() => load()}
      />
    </div>
  );
}
