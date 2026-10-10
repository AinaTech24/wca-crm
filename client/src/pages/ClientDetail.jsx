import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import confirm from '../components/confirm.js';
import { fmt as fmtDate } from '../components/DateField.jsx';
import { Ic } from '../components/Icons.jsx';
import { useRealtime } from '../realtime.js';
import MeetingFormModal, { meetingToForm } from './MeetingFormModal.jsx';
import { emptyMeeting, MEETING_STATUS_BADGE } from './meetingConstants.js';
import TaskFormModal from './TaskFormModal.jsx';
import { emptyTask, TASK_STATUS_BADGE } from './taskConstants.js';
import PolicyFormModal from './PolicyFormModal.jsx';
import { emptyPolicy, POLICY_STATUS_BADGE } from './policyConstants.js';
import { STATUS_BADGE as LEAD_STATUS_BADGE } from './leadConstants.js';
import { CATEGORY_BADGE, CLIENT_STATUS_BADGE, parseNominees, BUSINESS_FIELDS } from './clientConstants.js';

// Every module that points at a client gets a related list here, so each
// lookup is navigable from both ends.
const TABS = [
  { key: 'policies', label: 'Policies', icon: 'file' },
  { key: 'claims', label: 'Claims', icon: 'shieldcheck' },
  { key: 'meetings', label: 'Meetings', icon: 'calendar' },
  { key: 'tasks', label: 'Tasks', icon: 'checksquare' },
  { key: 'notes', label: 'Notes', icon: 'doc' },
  { key: 'attachments', label: 'Attachments', icon: 'clipboard' },
  { key: 'emails', label: 'Sent Emails', icon: 'mail' },
  { key: 'family', label: 'Family Tree', icon: 'users' },
  { key: 'referrals', label: 'Given Referrals', icon: 'target' },
];

const inr = (v) => Number(v || 0).toLocaleString('en-IN');
const EMPTY = { policies: [], claims: [], meetings: [], tasks: [], notes: [], attachments: [], emails: [], referrals: [], family: { head: null, members: [] } };
const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// Everything else a client record can hold. Shown only where there is a value, so
// a client entered by hand is not buried in dashes while an imported one, which
// carries many of these, shows all of it.
const MORE_FIELDS = [
  ['Salutation', 'salutation'], ['GSTIN', 'gstin'], ['Anniversary', 'anniversary', true],
  ['Company Name', 'company_name'], ['Group Head Name', 'group_head_name'], ['Group Code', 'group_code'],
  ['Client Code', 'client_code'], ['CAN / IIN No', 'can_iin_no'], ['Finnsys ID', 'finnsys_id'],
  ['Social Lead ID', 'social_lead_id'], ['Client Record ID', 'client_record_id'], ['Added By', 'added_by'],
  ['TIN Number', 'tin_number'], ['Is TIN Updated?', 'tin_updated'], ['Risk Profile', 'risk_profile'],
  ['Currency', 'currency'], ['Exchange Rate', 'exchange_rate'], ['File / Email', 'file_email'],
  ['Send Goal Sheet', 'send_goal_sheet'], ['Guardian Name', 'guardian_name'],
  ['If Nominee Minor — Guardian', 'nominee_minor_guardian'],
  ['Other City', 'other_city'], ['Other State', 'other_state'], ['Other Zip', 'other_zip'], ['Other Country', 'other_country'],
  ['Courier on this Address?', 'courier_ok'], ['Description', 'description'],
];
const isYes = (v) => ['yes', 'y', 'true', '1'].includes(String(v ?? '').trim().toLowerCase());

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
  const [note, setNote] = useState('');
  const fileRef = useRef(null);

  function load() {
    return api(`/clients/${client.id}/related`).then((r) => setRel({ ...EMPTY, ...r })).catch(() => setRel(EMPTY));
  }

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api(`/clients/${client.id}/related`)
      .then((r) => { if (alive) setRel({ ...EMPTY, ...r }); })
      .catch(() => { if (alive) setRel(EMPTY); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [client.id]);

  // Membership of these lists depends on fields that can change anywhere, so
  // rather than patching locally, re-pull the (single) related payload.
  useRealtime('policy', () => load());
  useRealtime('claim', () => load());
  useRealtime('meeting', () => load());
  useRealtime('task', () => load());
  useRealtime('lead', () => load());
  useRealtime('client', () => load());
  useRealtime('record-note', () => load());
  useRealtime('record-attachment', () => load());

  const clientParticipant = { kind: 'client', ref_id: client.id, name: client.client_name, email: client.email || '', mobile: client.mobile || '' };
  const clientRelation = { related_kind: 'client', related_id: client.id, related_name: client.client_name };

  const scheduleMeeting = () => setMeetingForm({ id: null, seed: { ...emptyMeeting(), title: `Meeting with ${client.client_name}`, participants: [clientParticipant] } });
  const newTask = () => setTaskForm({ id: null, seed: { ...emptyTask(), ...clientRelation, title: '' } });
  const newPolicy = () => setPolicyForm({ id: null, seed: { ...emptyPolicy(), insured_name: client.client_name, client_id: client.id, client_email: client.email || '' } });

  async function addNote() {
    if (!note.trim()) { toast.error('Write something first'); return; }
    try {
      await api(`/client/${client.id}/notes`, { method: 'POST', body: { body: note } });
      setNote(''); load(); toast.success('Note added');
    } catch (e) { toast.error(e.message || 'Could not add note'); }
  }
  async function delNote(n) {
    try { await api('/notes/' + n.id, { method: 'DELETE' }); load(); }
    catch (e) { toast.error(e.message || 'Could not delete note'); }
  }

  function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast.error('File must be under 8 MB'); e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api(`/client/${client.id}/attachments`, { method: 'POST', body: { file_name: file.name, file_type: file.type, data: reader.result } });
        load(); toast.success('Attachment added');
      } catch (err) { toast.error(err.message || 'Could not upload'); }
      finally { if (fileRef.current) fileRef.current.value = ''; }
    };
    reader.readAsDataURL(file);
  }
  async function openAttachment(a) {
    try {
      const full = await api('/attachments/' + a.id);
      const blob = await (await fetch(full.data)).blob();
      const u = URL.createObjectURL(blob);
      window.open(u, '_blank');
      setTimeout(() => URL.revokeObjectURL(u), 60000);
    } catch { toast.error('Could not open the file'); }
  }
  async function delAttachment(a) {
    const ok = await confirm({ title: 'Delete attachment?', message: `“${a.file_name}” will be permanently removed.`, tone: 'danger', confirmText: 'Delete', icon: 'trash' });
    if (!ok) return;
    try { await api('/attachments/' + a.id, { method: 'DELETE' }); load(); }
    catch (e) { toast.error(e.message || 'Could not delete'); }
  }

  const count = (k) => (k === 'family' ? (rel.family?.members?.length || 0) : (rel[k]?.length || 0));
  const list = k => rel[k] || [];
  const nominees = parseNominees(client.nominees);

  return (
    <div>
      <div className="detail-top">
        <button className="btn ghost" onClick={onBack}><Ic name="arrowleft" size={15} /> Back to Clients</button>
        <div className="detail-actions">
          <button className="btn ghost" onClick={newPolicy}><Ic name="file" size={15} /> New Policy</button>
          <button className="btn ghost" onClick={scheduleMeeting}><Ic name="calendar" size={15} /> Meeting</button>
          <button className="btn ghost" onClick={newTask}><Ic name="checksquare" size={15} /> Task</button>
          <button className="btn ghost" onClick={() => onEdit(client)}><Ic name="edit" size={15} /> Edit</button>
          <button className="btn ghost danger" onClick={() => onDelete(client)}><Ic name="trash" size={15} /> Delete</button>
        </div>
      </div>

      <div className="detail-hero card card-pad">
        <div className="detail-hero-ic"><Ic name="user" size={22} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="detail-hero-name">
            {client.client_name}
            {client.client_category && <span className={'badge ' + (CATEGORY_BADGE[client.client_category] || '')} style={{ marginLeft: 10 }}>Category {client.client_category}</span>}
          </h2>
          <div className="detail-hero-sub">
            {client.family_type || 'Individual'}
            {client.family_head_name ? ` of ${client.family_head_name}` : ''}
            {client.city ? ` · ${client.city}` : ''}
            {client.mobile ? ` · ${client.mobile}` : ''}
          </div>
        </div>
        <div className="detail-hero-status">
          <label>Status</label>
          <span className={'badge ' + (CLIENT_STATUS_BADGE[client.client_status] || '')}>{client.client_status || 'Active'}</span>
        </div>
      </div>

      <div className="lead-detail-grid">
        <div className="card card-pad">
          <div className="section-head">Client Information</div>
          <Row k="Name" v={client.client_name} />
          <Row k="Mobile" v={client.mobile} />
          <Row k="Email" v={client.email} />
          <Row k="Client Category" v={client.client_category} />
          <Row k="Client Owner" v={client.owner} />
          <Row k="Lead Source" v={client.lead_source} />
          <Row k="Referred By" v={client.referred_by_client_name} />
          <Row k="Date of Onboarding" v={fmtDate(client.onboarding_date)} />
          <Row k="Family / Individual" v={client.family_type} />
          {client.family_head_name && <Row k="Family Head" v={client.family_head_name} />}
          <Row k="Aadhar Card No" v={client.aadhar_no} />
          <Row k="Pan Card No" v={client.pan_no} />
          <Row k="Date of Birth" v={fmtDate(client.dob)} />
          <Row k="Profession" v={client.occupation} />
          <Row k="Review Frequency" v={client.review_frequency} />
          <Row k="Last Meeting Date" v={client.last_meeting_date ? fmtDate(client.last_meeting_date) : ''} />
          <Row k="Client Status" v={client.client_status} />

          {nominees.length > 0 && (
            <>
              <div className="section-head" style={{ marginTop: 16 }}>Nominee Information</div>
              {nominees.map((n, i) => (
                <div className="info-row" key={i}>
                  <span className="k">{n.relation || 'Nominee'}</span>
                  <span className="v">{n.name}{n.share_pct ? ` · ${n.share_pct}%` : ''}{n.dob ? ` · ${fmtDate(n.dob)}` : ''}</span>
                </div>
              ))}
            </>
          )}

          <div className="section-head" style={{ marginTop: 16 }}>Address Information</div>
          <Row k="Address" v={client.address} />
          <Row k="City" v={client.city} />
          <Row k="State" v={client.state} />
          <Row k="Pincode" v={client.pincode} />
          <Row k="Country" v={client.country} />

          {MORE_FIELDS.some(([, key]) => client[key]) && (
            <>
              <div className="section-head" style={{ marginTop: 16 }}>More Details</div>
              {MORE_FIELDS.filter(([, key]) => client[key]).map(([label, key, isDate]) => (
                <Row key={key} k={label} v={isDate ? fmtDate(client[key]) : String(client[key])} />
              ))}
            </>
          )}
          {BUSINESS_FIELDS.some((b) => client[b.key]) && (
            <>
              <div className="section-head" style={{ marginTop: 16 }}>Business Information</div>
              <Row k="Has" v={BUSINESS_FIELDS.filter((b) => isYes(client[b.key])).map((b) => b.label).join(', ') || 'None'} />
              {BUSINESS_FIELDS.filter((b) => client[b.key] && !isYes(client[b.key]) && String(client[b.key]).toLowerCase() !== 'no')
                .map((b) => <Row key={b.key} k={b.label} v={String(client[b.key])} />)}
            </>
          )}
        </div>

        <div className="card card-pad">
          <div className="tabs">
            {TABS.map((t) => (
              <button key={t.key} className={'tab' + (tab === t.key ? ' active' : '')} onClick={() => setTab(t.key)}>
                <Ic name={t.icon} size={14} /> {t.label}{count(t.key) > 0 ? ` (${count(t.key)})` : ''}
              </button>
            ))}
          </div>

          {tab === 'policies' && <button className="btn blue" style={{ marginBottom: 14 }} onClick={newPolicy}><Ic name="plus" size={15} /> New Policy</button>}
          {tab === 'meetings' && <button className="btn blue" style={{ marginBottom: 14 }} onClick={scheduleMeeting}><Ic name="plus" size={15} /> Schedule Meeting</button>}
          {tab === 'tasks' && <button className="btn blue" style={{ marginBottom: 14 }} onClick={newTask}><Ic name="plus" size={15} /> New Task</button>}
          {tab === 'attachments' && (
            <>
              <button className="btn blue" style={{ marginBottom: 14 }} onClick={() => fileRef.current?.click()}><Ic name="upload" size={15} /> Upload File</button>
              <input ref={fileRef} type="file" hidden onChange={onFile} />
            </>
          )}
          {tab === 'notes' && (
            <div className="composer">
              <div className="form-field">
                <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened with this client?" />
              </div>
              <div className="btn-row" style={{ marginTop: 10 }}>
                <button className="btn blue" onClick={addNote}><Ic name="plus" size={15} /> Add Note</button>
              </div>
            </div>
          )}

          {loading && <div className="notif-empty"><span>Loading…</span></div>}

          {!loading && tab !== 'family' && list(tab).length === 0 && (
            <div className="notif-empty">
              <Ic name={TABS.find((t) => t.key === tab).icon} size={22} />
              <span>No {TABS.find((t) => t.key === tab).label.toLowerCase()} for this client</span>
            </div>
          )}

          {!loading && tab === 'policies' && list('policies').map((p) => (
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

          {!loading && tab === 'claims' && list('claims').map((c) => (
            <div key={c.id} className="act-item">
              <span className="act-ic"><Ic name="shieldcheck" size={15} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 650 }}>{c.claim_title || c.claim_no || 'Claim'}</div>
                <div className="act-meta">
                  <span className="badge orange">{c.status || 'Pending'}</span>
                  {c.claim_type && <span><Ic name="tag" size={12} /> {c.claim_type}</span>}
                  {c.claim_date && <span><Ic name="calendar" size={12} /> {fmtDate(c.claim_date)}</span>}
                  {c.claim_amount > 0 && <span><Ic name="rupee" size={12} /> {inr(c.claim_amount)}</span>}
                </div>
              </div>
            </div>
          ))}

          {!loading && tab === 'meetings' && list('meetings').map((m) => (
            <div key={m.id} className="act-item act-clickable" onClick={() => setMeetingForm({ id: m.id, seed: meetingToForm(m) })}>
              <span className="act-ic"><Ic name="calendar" size={15} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 650 }}>{m.title}</div>
                <div className="act-meta">
                  <span className={'badge ' + (MEETING_STATUS_BADGE[m.status] || '')}>{m.status || 'Scheduled'}</span>
                  {m.from_date && <span><Ic name="calendar" size={12} /> {fmtDate(m.from_date)}{m.from_time ? ` ${m.from_time}` : ''}</span>}
                  {m.location && <span><Ic name="pin" size={12} /> {m.location}</span>}
                </div>
                {m.minutes && <div className="act-body"><strong>MoM: </strong>{m.minutes}</div>}
              </div>
              <span className="act-open"><Ic name="chevron-right" size={16} /></span>
            </div>
          ))}

          {!loading && tab === 'tasks' && list('tasks').map((t) => (
            <div key={t.id} className="act-item act-clickable" onClick={() => setTaskForm({ id: t.id, seed: { ...emptyTask(), ...t, reminder_days: t.reminder_days ?? '' } })}>
              <span className="act-ic"><Ic name="checksquare" size={15} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 650, textDecoration: t.status === 'Completed' ? 'line-through' : 'none' }}>{t.title}</div>
                <div className="act-meta">
                  <span className={'badge ' + (TASK_STATUS_BADGE[t.status] || '')}>{t.status || 'Not Started'}</span>
                  {t.due_date && <span><Ic name="calendar" size={12} /> due {fmtDate(t.due_date)}</span>}
                  {t.assigned_to && <span><Ic name="user" size={12} /> {t.assigned_to}</span>}
                </div>
              </div>
              <span className="act-open"><Ic name="chevron-right" size={16} /></span>
            </div>
          ))}

          {!loading && tab === 'notes' && list('notes').map((n) => (
            <div key={n.id} className="act-item">
              <span className="act-ic"><Ic name="doc" size={15} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="act-body" style={{ marginTop: 0 }}>{n.body}</div>
                <div className="act-meta">
                  {n.owner && <span><Ic name="user" size={12} /> {n.owner}</span>}
                  <span className="act-when">{n.created_at}</span>
                </div>
              </div>
              <button className="action-btn danger" title="Delete" onClick={() => delNote(n)}><Ic name="trash" size={15} /></button>
            </div>
          ))}

          {!loading && tab === 'attachments' && list('attachments').map((a) => (
            <div key={a.id} className="act-item">
              <span className="act-ic"><Ic name="clipboard" size={15} /></span>
              <div className="act-clickable-body" onClick={() => openAttachment(a)}>
                <div style={{ fontWeight: 650 }}>{a.file_name}</div>
                <div className="act-meta">
                  {a.file_size > 0 && <span>{kb(a.file_size)}</span>}
                  {a.owner && <span><Ic name="user" size={12} /> {a.owner}</span>}
                  <span className="act-when">{a.created_at}</span>
                </div>
              </div>
              <button className="action-btn danger" title="Delete" onClick={() => delAttachment(a)}><Ic name="trash" size={15} /></button>
            </div>
          ))}

          {!loading && tab === 'emails' && list('emails').map((e) => (
            <div key={e.id} className="act-item">
              <span className="act-ic"><Ic name="mail" size={15} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 650 }}>{e.subject || '(no subject)'}</div>
                {e.body_preview && <div className="act-body">{e.body_preview}</div>}
                <div className="act-meta">
                  <span className={'badge ' + (e.status === 'Sent' ? 'green' : 'red')}>{e.status}</span>
                  <span><Ic name="send" size={12} /> {e.to_addr}</span>
                  {e.sent_by && <span><Ic name="user" size={12} /> {e.sent_by}</span>}
                  <span className="act-when">{e.created_at}</span>
                </div>
                {e.status === 'Failed' && e.error && <div className="act-body" style={{ color: 'var(--danger)' }}>{e.error}</div>}
              </div>
            </div>
          ))}

          {!loading && tab === 'referrals' && list('referrals').map((r) => (
            <div key={`${r.kind}-${r.id}`} className="act-item">
              <span className="act-ic"><Ic name={r.kind === 'client' ? 'user' : 'target'} size={15} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 650 }}>{r.name}</div>
                <div className="act-meta">
                  <span className={'badge ' + (r.kind === 'client' ? (CLIENT_STATUS_BADGE[r.status] || '') : (LEAD_STATUS_BADGE[r.status] || ''))}>{r.status || '—'}</span>
                  <span>{r.kind === 'client' ? 'Became a client' : 'Lead'}</span>
                  {r.extra && <span><Ic name="tag" size={12} /> {r.extra}</span>}
                  {r.date && <span><Ic name="calendar" size={12} /> {fmtDate(r.date)}</span>}
                </div>
              </div>
            </div>
          ))}

          {/* Family tree: the head at the top, then everyone under it. */}
          {!loading && tab === 'family' && (
            (!rel.family?.head && !(rel.family?.members || []).length)
              ? <div className="notif-empty"><Ic name="users" size={22} /><span>Not part of a family group</span></div>
              : (
                <div className="family-tree">
                  {rel.family.head && (
                    <div className={'family-node head' + (rel.family.head.id === client.id ? ' self' : '')}>
                      <span className="act-ic"><Ic name="user" size={15} /></span>
                      <div>
                        <div style={{ fontWeight: 700 }}>{rel.family.head.client_name} {rel.family.head.id === client.id && <small>(this client)</small>}</div>
                        <div className="act-meta"><span className="badge blue">Family Head</span>{rel.family.head.mobile && <span>{rel.family.head.mobile}</span>}</div>
                      </div>
                    </div>
                  )}
                  {(rel.family.members || []).map((m) => (
                    <div className={'family-node member' + (m.id === client.id ? ' self' : '')} key={m.id}>
                      <span className="act-ic"><Ic name="user" size={15} /></span>
                      <div>
                        <div style={{ fontWeight: 650 }}>{m.client_name} {m.id === client.id && <small>(this client)</small>}</div>
                        <div className="act-meta">
                          <span>{m.family_type || 'Family Member'}</span>
                          {m.mobile && <span>{m.mobile}</span>}
                          {m.client_category && <span className={'badge ' + (CATEGORY_BADGE[m.client_category] || '')}>{m.client_category}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
          )}
        </div>
      </div>

      <PolicyFormModal open={!!policyForm} policyId={policyForm?.id} seed={policyForm?.seed} lockClient
        onClose={() => setPolicyForm(null)} onSaved={() => load()} />
      <MeetingFormModal open={!!meetingForm} meetingId={meetingForm?.id} seed={meetingForm?.seed} lockedParticipant={clientParticipant}
        onClose={() => setMeetingForm(null)} onSaved={() => load()} />
      <TaskFormModal open={!!taskForm} taskId={taskForm?.id} seed={taskForm?.seed} lockRelation={clientRelation}
        onClose={() => setTaskForm(null)} onSaved={() => load()} />
    </div>
  );
}
