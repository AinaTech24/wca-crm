// One client, everything about them: who they are, what they hold, what is coming up, where the sale
// stands (RFQs, quotations), and every related record — each one a click away.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import toast from '../components/toast.js';
import confirm from '../components/confirm.js';
import { fmt as fmtDate } from '../components/DateField.jsx';
import { Ic } from '../components/Icons.jsx';
import HistoryButton from '../components/HistoryButton.jsx';
import { useRealtime } from '../realtime.js';
import MeetingFormModal, { meetingToForm } from './MeetingFormModal.jsx';
import { emptyMeeting, MEETING_STATUS_BADGE } from './meetingConstants.js';
import TaskFormModal from './TaskFormModal.jsx';
import { emptyTask, TASK_STATUS_BADGE } from './taskConstants.js';
import PolicyFormModal from './PolicyFormModal.jsx';
import { emptyPolicy, POLICY_STATUS_BADGE } from './policyConstants.js';
import { STATUS_BADGE as LEAD_STATUS_BADGE } from './leadConstants.js';
import { CATEGORY_BADGE, CLIENT_STATUS_BADGE, parseNominees, BUSINESS_FIELDS } from './clientConstants.js';
import WhatsAppButton from '../components/WhatsAppButton.jsx';
import CrossSell from './CrossSell.jsx';
import { ClientOnboarding } from './OnboardingPanel.jsx';
import Modal from '../components/Modal.jsx';
import { showBlob } from '../components/openFile.js';

const TABS = [
  { key: 'overview', label: 'Overview', icon: 'grid' },
  { key: 'policies', label: 'Policies', icon: 'file' },
  { key: 'quotations', label: 'Quotations', icon: 'doc' },
  { key: 'rfqs', label: 'RFQs', icon: 'clipboard' },
  { key: 'claims', label: 'Claims', icon: 'shieldcheck' },
  { key: 'meetings', label: 'Meetings', icon: 'calendar' },
  { key: 'tasks', label: 'Tasks', icon: 'checksquare' },
  { key: 'notes', label: 'Notes', icon: 'edit' },
  { key: 'attachments', label: 'Files', icon: 'upload' },
  { key: 'emails', label: 'Emails', icon: 'mail' },
  { key: 'family', label: 'Family', icon: 'users' },
  { key: 'referrals', label: 'Referrals', icon: 'target' },
  { key: 'onboarding', label: 'Onboarding', icon: 'clipboard' },
];
const QUOTE_BADGE = { Draft: '', Shared: 'blue', Approved: 'green', Converted: 'green', Rejected: 'red', Expired: 'orange' };
const RFQ_BADGE = { Draft: '', Sent: 'blue', 'Quotes Received': 'orange', Quoted: 'green', 'Approved by Customer': 'green', 'Proposal Requested': 'blue', Closed: '', Lost: 'red' };
const CLAIM_CLOSED = ['Settled', 'Rejected', 'Withdrawn', 'Closed'];
const TASK_DONE = ['Completed', 'Cancelled'];
const POLICY_GONE = ['Cancelled', 'Lost', 'Draft'];

const inr = (v) => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const compact = (n) => { const v = Number(n) || 0; return v >= 1e7 ? `${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(2)} L` : inr(v); };
const EMPTY = { policies: [], claims: [], meetings: [], tasks: [], notes: [], attachments: [], emails: [], referrals: [], rfqs: [], quotations: [], family: { head: null, members: [] } };
const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const iso = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : '');
const today = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 10);
const daysTo = (d) => Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse(today() + 'T00:00:00Z')) / 86400000);
const initials = (n) => String(n || '?').replace(/[^A-Za-z0-9 ]/g, ' ').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
// 18 Nov, or 18 Nov 2025 when it is not this year — short enough for a figure tile.
const shortDate = (d) => { if (!d) return '—'; const t = new Date(d + 'T00:00:00Z'); return t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC', ...(d.slice(0, 4) !== today().slice(0, 4) ? { year: 'numeric' } : {}) }); };
const mask = (v, keep = 4) => { const s = String(v || '').replace(/\s/g, ''); return s.length > keep ? '•••• ' + s.slice(-keep) : s; };

// Everything else a client record can hold — shown only where there is a value.
const MORE_FIELDS = [
  ['Tag', 'tag'], ['Salutation', 'salutation'], ['GSTIN', 'gstin'], ['Anniversary', 'anniversary', true],
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
// The details worth chasing when they are missing.
const KEY_FIELDS = [['mobile', 'Mobile'], ['email', 'Email'], ['pan_no', 'PAN'], ['dob', 'Date of birth'], ['address', 'Address'], ['city', 'City'], ['client_category', 'Category']];
const ageOf = (c) => {
  if (c.age_in_years) return String(c.age_in_years);
  const d = c.dob ? new Date(c.dob) : null;
  if (!d || isNaN(d)) return '';
  const t = new Date();
  let a = t.getFullYear() - d.getFullYear();
  if (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate())) a -= 1;
  return a >= 0 && a < 130 ? String(a) : '';
};
const isYes = (v) => ['yes', 'y', 'true', '1'].includes(String(v ?? '').trim().toLowerCase());

function Rows({ rows }) {
  const shown = rows.filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '');
  if (!shown.length) return null;
  return shown.map(([k, v]) => <div className="info-row" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>);
}
function Group({ title, icon, children }) {
  const kids = Array.isArray(children) ? children.flat().filter(Boolean) : children;
  if (!kids || (Array.isArray(kids) && !kids.length)) return null;
  return (
    <div className="cv-group">
      <div className="cv-group-head"><Ic name={icon} size={14} /> {title}</div>
      {kids}
    </div>
  );
}

export default function ClientDetail({ client, onBack, onEdit, onDelete }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState('overview');
  const [rel, setRel] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [meetingForm, setMeetingForm] = useState(null);
  const [taskForm, setTaskForm] = useState(null);
  const [policyForm, setPolicyForm] = useState(null);
  const [note, setNote] = useState('');
  const [moreOpen, setMoreOpen] = useState(false);
  const [mailId, setMailId] = useState(null);   // the sent email being read
  const fileRef = useRef(null);
  const tabsRef = useRef(null);

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
  ['policy', 'claim', 'meeting', 'task', 'lead', 'client', 'record-note', 'record-attachment', 'rfq', 'quotation']
    .forEach((e) => useRealtime(e, () => load()));   // eslint-disable-line react-hooks/rules-of-hooks

  const clientParticipant = { kind: 'client', ref_id: client.id, name: client.client_name, email: client.email || '', mobile: client.mobile || '' };
  const clientRelation = { related_kind: 'client', related_id: client.id, related_name: client.client_name };
  const scheduleMeeting = () => setMeetingForm({ id: null, seed: { ...emptyMeeting(), title: `Meeting with ${client.client_name}`, participants: [clientParticipant] } });
  const newTask = () => setTaskForm({ id: null, seed: { ...emptyTask(), ...clientRelation, title: '' } });
  const newPolicy = () => setPolicyForm({ id: null, seed: { ...emptyPolicy(), insured_name: client.client_name, client_id: client.id, client_email: client.email || '' } });
  const openPolicy = (p) => setPolicyForm({ id: p.id, seed: { ...emptyPolicy(), ...p } });
  const go = (k) => { setTab(k); tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  async function addNote() {
    if (!note.trim()) { toast.error('Write something first'); return; }
    try { await api(`/client/${client.id}/notes`, { method: 'POST', body: { body: note } }); setNote(''); load(); toast.success('Note added'); }
    catch (e) { toast.error(e.message || 'Could not add note'); }
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
      try { await api(`/client/${client.id}/attachments`, { method: 'POST', body: { file_name: file.name, file_type: file.type, data: reader.result } }); load(); toast.success('Attachment added'); }
      catch (err) { toast.error(err.message || 'Could not upload'); }
      finally { if (fileRef.current) fileRef.current.value = ''; }
    };
    reader.readAsDataURL(file);
  }
  async function openAttachment(a) {
    try {
      const full = await api('/attachments/' + a.id);
      const blob = await (await fetch(full.data)).blob();
      showBlob(blob, full.file_name);
    } catch { toast.error('Could not open the file'); }
  }
  async function delAttachment(a) {
    const ok = await confirm({ title: 'Delete attachment?', message: `“${a.file_name}” will be permanently removed.`, tone: 'danger', confirmText: 'Delete', icon: 'trash' });
    if (!ok) return;
    try { await api('/attachments/' + a.id, { method: 'DELETE' }); load(); }
    catch (e) { toast.error(e.message || 'Could not delete'); }
  }

  const list = (k) => rel[k] || [];
  const count = (k) => (k === 'family' ? (rel.family?.members?.length || 0) : k === 'overview' ? 0 : (rel[k]?.length || 0));
  const nominees = parseNominees(client.nominees);
  const t0 = today();

  // ---- the numbers at the top ----
  const s = useMemo(() => {
    const pols = rel.policies || [];
    const live = pols.filter((p) => !POLICY_GONE.includes(p.policy_status) && (!iso(p.period_to) || iso(p.period_to) >= t0));
    const upcoming = pols.filter((p) => p.renewable !== 'No' && iso(p.period_to) && iso(p.period_to) >= t0 && !['Renewed', 'Renewed Elsewhere', 'Lost'].includes(p.renewal_status))
      .sort((a, b) => iso(a.period_to).localeCompare(iso(b.period_to)));
    const openClaims = (rel.claims || []).filter((c) => !CLAIM_CLOSED.includes(c.status));
    const openTasks = (rel.tasks || []).filter((t) => !TASK_DONE.includes(t.status));
    const touches = [
      ...(rel.meetings || []).filter((m) => iso(m.from_date) && iso(m.from_date) <= t0).map((m) => ({ d: iso(m.from_date), what: 'Meeting' })),
      ...(rel.emails || []).map((e) => ({ d: iso(e.created_at), what: 'Email' })),
      ...(rel.notes || []).map((n) => ({ d: iso(n.created_at), what: 'Note' })),
    ].filter((x) => x.d).sort((a, b) => b.d.localeCompare(a.d));
    return { pols, live, upcoming, openClaims, openTasks, premium: live.reduce((n, p) => n + (Number(p.final_premium) || 0), 0), last: touches[0] || null };
  }, [rel, t0]);

  // ---- recent activity, newest first ----
  const activity = useMemo(() => [
    ...list('policies').map((p) => ({ k: 'p' + p.id, d: iso(p.created_at) || iso(p.period_from), icon: 'file', tone: 'blue', title: `Policy · ${p.product_name || p.insurance_type || ''}`, sub: [p.company_name, p.policy_status].filter(Boolean).join(' · '), on: () => openPolicy(p) })),
    ...list('quotations').map((q) => ({ k: 'q' + q.id, d: iso(q.created_at), icon: 'doc', tone: 'orange', title: `Quotation ${q.quote_no}${q.version > 1 ? ' v' + q.version : ''}`, sub: [q.status, q.selected_insurer && `₹${inr(q.selected_premium)}`].filter(Boolean).join(' · '), on: () => navigate('/page/quotation?open=' + q.id) })),
    ...list('rfqs').map((r) => ({ k: 'r' + r.id, d: iso(r.created_at), icon: 'clipboard', tone: 'navy', title: `RFQ ${r.rfq_no}`, sub: [r.category, r.status].filter(Boolean).join(' · '), on: () => navigate('/page/rfq?open=' + r.id) })),
    ...list('claims').map((c) => ({ k: 'c' + c.id, d: iso(c.claim_date) || iso(c.created_at), icon: 'shieldcheck', tone: 'red', title: `Claim · ${c.claim_title || c.claim_no || ''}`, sub: c.status || '', on: () => go('claims') })),
    ...list('meetings').map((m) => ({ k: 'm' + m.id, d: iso(m.from_date), icon: 'calendar', tone: 'green', title: m.title, sub: m.status || '', on: () => setMeetingForm({ id: m.id, seed: meetingToForm(m) }) })),
    ...list('notes').map((n) => ({ k: 'n' + n.id, d: iso(n.created_at), icon: 'edit', tone: 'grey', title: 'Note', sub: String(n.body || '').slice(0, 90), on: () => go('notes') })),
    ...list('emails').map((e) => ({ k: 'e' + e.id, d: iso(e.created_at), icon: 'mail', tone: 'grey', title: e.subject || 'Email', sub: e.status || '', on: () => setMailId(e.id) })),
  ].filter((a) => a.d).sort((a, b) => b.d.localeCompare(a.d)).slice(0, 10), [rel]);   // eslint-disable-line react-hooks/exhaustive-deps

  const missing = KEY_FIELDS.filter(([k]) => !String(client[k] || '').trim());
  const nextRen = s.upcoming[0];
  const nextDays = nextRen ? daysTo(iso(nextRen.period_to)) : null;
  const STATS = [
    { k: 'policies', label: 'Active policies', value: s.live.length, sub: `${s.pols.length} on file`, icon: 'file', tone: 'blue' },
    { k: 'policies', label: 'Annual premium', value: '₹ ' + compact(s.premium), sub: 'active policies', icon: 'rupee', tone: 'navy' },
    { k: 'policies', label: 'Next renewal', value: nextRen ? shortDate(iso(nextRen.period_to)) : '—', sub: nextRen ? `${nextDays === 0 ? 'today' : `in ${nextDays} day${nextDays === 1 ? '' : 's'}`} · ${nextRen.product_name || nextRen.insurance_type || ''}` : 'nothing due', icon: 'refresh', tone: nextRen && nextDays <= 30 ? 'orange' : 'grey' },
    { k: 'claims', label: 'Open claims', value: s.openClaims.length, sub: `${list('claims').length} in all`, icon: 'shieldcheck', tone: s.openClaims.length ? 'red' : 'grey' },
    { k: 'tasks', label: 'Open tasks', value: s.openTasks.length, sub: `${list('tasks').length} in all`, icon: 'checksquare', tone: s.openTasks.length ? 'orange' : 'grey' },
    { k: 'meetings', label: 'Last contact', value: s.last ? shortDate(s.last.d) : '—', sub: s.last ? s.last.what : 'no contact logged', icon: 'phone', tone: 'green' },
  ];

  const empty = (k) => (
    <div className="notif-empty"><Ic name={TABS.find((t) => t.key === k).icon} size={22} /><span>No {k === 'rfqs' ? 'RFQs' : TABS.find((t) => t.key === k).label.toLowerCase()} for this client yet</span></div>
  );
  const since = iso(client.onboarding_date) || iso(client.created_at);

  return (
    <div className="cv">
      <div className="detail-top">
        <button className="btn ghost" onClick={onBack}><Ic name="arrowleft" size={15} /> Back to Clients</button>
        <div className="detail-actions">
          <HistoryButton table="clients" id={client.id} />
          <button className="btn ghost" onClick={() => onEdit(client)}><Ic name="edit" size={15} /> Edit</button>
          <button className="btn ghost danger" onClick={() => onDelete(client)}><Ic name="trash" size={15} /> Delete</button>
        </div>
      </div>

      {/* Who they are */}
      <div className="cv-hero card">
        <div className="cv-avatar">{initials(client.client_name)}</div>
        <div className="cv-id">
          <h2>{client.client_name}</h2>
          <div className="cv-badges">
            <span className={'badge ' + (CLIENT_STATUS_BADGE[client.client_status] || 'green')}>{client.client_status || 'Active'}</span>
            {client.client_category && <span className={'badge ' + (CATEGORY_BADGE[client.client_category] || '')}>Category {client.client_category}</span>}
            <span className="badge">{client.family_type || 'Individual'}{client.family_head_name ? ` · ${client.family_head_name}` : ''}</span>
          </div>
          <div className="cv-contact">
            {client.mobile && <a href={`tel:${client.mobile}`}><Ic name="phone" size={14} /> {client.mobile}</a>}
            {client.email && <a href={`mailto:${client.email}`}><Ic name="mail" size={14} /> {client.email}</a>}
            {client.city && <span><Ic name="building" size={14} /> {[client.city, client.state].filter(Boolean).join(', ')}</span>}
            {client.owner && <span><Ic name="user" size={14} /> {client.owner}</span>}
            {since && <span><Ic name="calendar" size={14} /> Client since {fmtDate(since)}</span>}
          </div>
        </div>
        <div className="cv-actions">
          <button className="btn blue" onClick={() => navigate('/page/quotation?new=1')}><Ic name="doc" size={15} /> New Quotation</button>
          <button className="btn ghost" onClick={newPolicy}><Ic name="file" size={15} /> Policy</button>
          <button className="btn ghost" onClick={scheduleMeeting}><Ic name="calendar" size={15} /> Meeting</button>
          <button className="btn ghost" onClick={newTask}><Ic name="checksquare" size={15} /> Task</button>
          <WhatsAppButton mobile={client.mobile} messages={[
            { label: 'Hello', text: `Dear ${client.client_name}, greetings from WeCare Assurance.` },
            nextRen && { label: 'Renewal reminder', text: `Dear ${client.client_name}, your ${nextRen.product_name || nextRen.insurance_type || 'policy'}${nextRen.policy_number ? ` (${nextRen.policy_number})` : ''} is due for renewal on ${fmtDate(iso(nextRen.period_to))}. Shall we share renewal quotes?` },
          ].filter(Boolean)} />
        </div>
      </div>

      {/* The numbers that matter, each opening its list */}
      <div className="cv-stats">
        {STATS.map((x) => (
          <button key={x.label} type="button" className={'cv-stat ' + x.tone} onClick={() => go(x.k)}>
            <span className="cv-stat-ic"><Ic name={x.icon} size={17} /></span>
            <span className="cv-stat-txt"><small>{x.label}</small><b>{loading ? '…' : x.value}</b><em>{loading ? '' : x.sub}</em></span>
          </button>
        ))}
      </div>

      <div className="cv-grid">
        {/* Profile */}
        <div className="card cv-profile">
          <div className="cv-card-head"><b>Profile</b><button type="button" className="btn ghost sm" onClick={() => onEdit(client)}><Ic name="edit" size={13} /> Edit</button></div>
          {missing.length > 0 && (
            <button type="button" className="cv-missing" onClick={() => onEdit(client)}>
              <Ic name="alert" size={15} /><span><b>{missing.length} key detail{missing.length === 1 ? '' : 's'} missing</b><small>{missing.map(([, l]) => l).join(', ')}</small></span>
            </button>
          )}
          <Group title="Contact" icon="phone">
            <Rows rows={[['Mobile', client.mobile], ['Email', client.email], ['Address', [client.address, client.city, client.state, client.pincode, client.country].filter(Boolean).join(', ')]]} />
          </Group>
          <Group title="Relationship" icon="user">
            <Rows rows={[['Client owner', client.owner], ['Category', client.client_category], ['Lead source', client.lead_source], ['Referred by', client.referred_by_client_name],
              ['Onboarded', client.onboarding_date ? fmtDate(client.onboarding_date) : ''], ['Review', client.review_frequency], ['Last meeting', client.last_meeting_date ? fmtDate(client.last_meeting_date) : '']]} />
          </Group>
          <Group title="Personal & KYC" icon="shieldcheck">
            <Rows rows={[['Date of birth', client.dob ? `${fmtDate(client.dob)}${ageOf(client) ? ` · ${ageOf(client)} yrs` : ''}` : ''], ['Profession', client.occupation],
              ['PAN', client.pan_no], ['Aadhaar', client.aadhar_no ? mask(client.aadhar_no) : ''], ['Family', client.family_type], ['Family head', client.family_head_name]]} />
          </Group>
          {nominees.length > 0 && (
            <Group title="Nominees" icon="users">
              {nominees.map((n, i) => (
                <div className="info-row" key={i}><span className="k">{n.relation || 'Nominee'}</span><span className="v">{n.name}{n.share_pct ? ` · ${n.share_pct}%` : ''}{n.dob ? ` · ${fmtDate(n.dob)}` : ''}</span></div>
              ))}
            </Group>
          )}
          {BUSINESS_FIELDS.some((b) => client[b.key]) && (
            <Group title="Business with us" icon="chart">
              <div className="cv-chips">{BUSINESS_FIELDS.filter((b) => isYes(client[b.key])).map((b) => <span key={b.key}>{b.label}</span>)}</div>
              <Rows rows={BUSINESS_FIELDS.filter((b) => client[b.key] && !isYes(client[b.key]) && String(client[b.key]).toLowerCase() !== 'no').map((b) => [b.label, String(client[b.key])])} />
            </Group>
          )}
          {MORE_FIELDS.some(([, key]) => client[key]) && (
            <>
              <button type="button" className="cv-more" onClick={() => setMoreOpen((o) => !o)}>
                <Ic name={moreOpen ? 'chevron' : 'chevron-right'} size={14} /> {moreOpen ? 'Fewer details' : `More details (${MORE_FIELDS.filter(([, key]) => client[key]).length})`}
              </button>
              {moreOpen && <Rows rows={MORE_FIELDS.filter(([, key]) => client[key]).map(([label, key, isDate]) => [label, isDate ? fmtDate(client[key]) : String(client[key])])} />}
            </>
          )}
        </div>

        {/* Everything related */}
        <div className="card cv-main" ref={tabsRef}>
          <div className="cv-tabs">
            {TABS.map((t) => (
              <button key={t.key} type="button" className={'cv-tab' + (tab === t.key ? ' on' : '')} onClick={() => setTab(t.key)}>
                <Ic name={t.icon} size={14} /> {t.label}{count(t.key) > 0 && <i>{count(t.key)}</i>}
              </button>
            ))}
          </div>

          <div className="cv-pane">
            {loading && <div className="notif-empty"><span>Loading…</span></div>}

            {!loading && tab === 'overview' && (
              <div className="cv-overview">
                <div className="cv-ov-col">
                  <div className="cv-sub">Coming up</div>
                  {s.upcoming.slice(0, 3).map((p) => {
                    const d = daysTo(iso(p.period_to));
                    return (
                      <button key={'u' + p.id} type="button" className="cv-up" onClick={() => openPolicy(p)}>
                        <span className={'cv-up-ic ' + (d <= 15 ? 'orange' : 'blue')}><Ic name="refresh" size={15} /></span>
                        <span><b>Renewal · {p.product_name || p.insurance_type}</b><small>{p.company_name || ''}{p.policy_number ? ` · ${p.policy_number}` : ''}</small></span>
                        <em className={d <= 15 ? 'hot' : ''}>{d === 0 ? 'Today' : `${d} days`}</em>
                      </button>
                    );
                  })}
                  {s.openTasks.slice(0, 3).map((t) => (
                    <button key={'t' + t.id} type="button" className="cv-up" onClick={() => setTaskForm({ id: t.id, seed: { ...emptyTask(), ...t, reminder_days: t.reminder_days ?? '' } })}>
                      <span className="cv-up-ic navy"><Ic name="checksquare" size={15} /></span>
                      <span><b>{t.title}</b><small>{t.assigned_to || ''}</small></span>
                      <em className={iso(t.due_date) && iso(t.due_date) < t0 ? 'hot' : ''}>{t.due_date ? fmtDate(t.due_date) : '—'}</em>
                    </button>
                  ))}
                  {list('meetings').filter((m) => iso(m.from_date) >= t0 && ['Scheduled', 'Rescheduled'].includes(m.status || 'Scheduled')).slice(0, 2).map((m) => (
                    <button key={'m' + m.id} type="button" className="cv-up" onClick={() => setMeetingForm({ id: m.id, seed: meetingToForm(m) })}>
                      <span className="cv-up-ic green"><Ic name="calendar" size={15} /></span>
                      <span><b>{m.title}</b><small>{m.location || 'Meeting'}</small></span>
                      <em>{fmtDate(m.from_date)}</em>
                    </button>
                  ))}
                  {!s.upcoming.length && !s.openTasks.length && <div className="cv-quiet">Nothing due — a good time to review cover or ask for a referral.</div>}
                  <CrossSell client={client} compact />
                </div>
                <div className="cv-ov-col">
                  <div className="cv-sub">Recent activity</div>
                  {activity.length === 0 ? <div className="cv-quiet">No activity recorded yet.</div> : (
                    <div className="cv-feed">
                      {activity.map((a) => (
                        <button key={a.k} type="button" className="cv-feed-item" onClick={a.on}>
                          <span className={'cv-dot ' + a.tone}><Ic name={a.icon} size={13} /></span>
                          <span className="cv-feed-txt"><b>{a.title}</b>{a.sub && <small>{a.sub}</small>}</span>
                          <em>{fmtDate(a.d)}</em>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {!loading && tab === 'policies' && (
              <>
                <div className="cv-pane-head"><span>{s.live.length} active · ₹ {inr(s.premium)} premium</span><button className="btn blue sm" onClick={newPolicy}><Ic name="plus" size={14} /> New Policy</button></div>
                {list('policies').length === 0 ? empty('policies') : list('policies').map((p) => {
                  const d = iso(p.period_to) ? daysTo(iso(p.period_to)) : null;
                  return (
                    <div key={p.id} className="act-item act-clickable" onClick={() => openPolicy(p)}>
                      <span className="act-ic"><Ic name="file" size={15} /></span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 650 }}>{p.product_name || p.insurance_type || 'Policy'}{p.department ? <small className="cv-dept"> · {p.department}</small> : null}</div>
                        <div className="act-meta">
                          <span className={'badge ' + (POLICY_STATUS_BADGE[p.policy_status] || 'blue')}>{p.policy_status || 'Policy'}</span>
                          {p.policy_number && <span><Ic name="tag" size={12} /> {p.policy_number}</span>}
                          {p.company_name && <span><Ic name="building" size={12} /> {p.company_name}</span>}
                          {p.period_to && <span className={d !== null && d < 0 ? 'overdue-date' : undefined}><Ic name="calendar" size={12} /> {d !== null && d < 0 ? 'expired' : 'expires'} {fmtDate(p.period_to)}</span>}
                          {d !== null && d >= 0 && d <= 45 && <span className="badge orange">Renews in {d} d</span>}
                          {p.final_premium > 0 && <span><Ic name="rupee" size={12} /> {inr(p.final_premium)}</span>}
                        </div>
                      </div>
                      <span className="act-open"><Ic name="chevron-right" size={16} /></span>
                    </div>
                  );
                })}
              </>
            )}

            {!loading && tab === 'quotations' && (
              <>
                <div className="cv-pane-head"><span>What this client has been offered</span><button className="btn blue sm" onClick={() => navigate('/page/quotation?new=1')}><Ic name="plus" size={14} /> New Quotation</button></div>
                {list('quotations').length === 0 ? empty('quotations') : list('quotations').map((q) => (
                  <div key={q.id} className="act-item act-clickable" onClick={() => navigate('/page/quotation?open=' + q.id)}>
                    <span className="act-ic"><Ic name="doc" size={15} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 650 }}>{q.quote_no}{q.version > 1 ? ` v${q.version}` : ''} · {q.product || q.category}</div>
                      <div className="act-meta">
                        <span className={'badge ' + (QUOTE_BADGE[q.status] || '')}>{q.status}</span>
                        {q.approved_insurer ? <span><Ic name="check" size={12} /> {q.approved_insurer} · ₹{inr(q.approved_premium)}</span>
                          : q.selected_insurer && <span><Ic name="star" size={12} /> {q.selected_insurer} · ₹{inr(q.selected_premium)}</span>}
                        {q.valid_till && <span><Ic name="calendar" size={12} /> valid till {fmtDate(q.valid_till)}</span>}
                      </div>
                    </div>
                    <span className="act-open"><Ic name="chevron-right" size={16} /></span>
                  </div>
                ))}
              </>
            )}

            {!loading && tab === 'rfqs' && (list('rfqs').length === 0 ? empty('rfqs') : list('rfqs').map((r) => (
              <div key={r.id} className="act-item act-clickable" onClick={() => navigate('/page/rfq?open=' + r.id)}>
                <span className="act-ic"><Ic name="clipboard" size={15} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 650 }}>{r.rfq_no} · {r.product || r.category}</div>
                  <div className="act-meta">
                    <span className={'badge ' + (RFQ_BADGE[r.status] || '')}>{r.status}</span>
                    {r.category && <span><Ic name="tag" size={12} /> {r.category}</span>}
                    {r.created_at && <span><Ic name="calendar" size={12} /> {fmtDate(iso(r.created_at))}</span>}
                    {r.policy_id && <span className="badge green">Policy made</span>}
                  </div>
                </div>
                <span className="act-open"><Ic name="chevron-right" size={16} /></span>
              </div>
            )))}

            {!loading && tab === 'claims' && (list('claims').length === 0 ? empty('claims') : list('claims').map((c) => (
              <div key={c.id} className="act-item act-clickable" onClick={() => navigate('/page/claim')}>
                <span className="act-ic"><Ic name="shieldcheck" size={15} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 650 }}>{c.claim_title || c.claim_no || 'Claim'}</div>
                  <div className="act-meta">
                    <span className={'badge ' + (CLAIM_CLOSED.includes(c.status) ? (c.status === 'Settled' ? 'green' : '') : 'orange')}>{c.status || 'Pending'}</span>
                    {c.claim_type && <span><Ic name="tag" size={12} /> {c.claim_type}</span>}
                    {c.claim_date && <span><Ic name="calendar" size={12} /> {fmtDate(c.claim_date)}</span>}
                    {c.claim_amount > 0 && <span><Ic name="rupee" size={12} /> {inr(c.claim_amount)}</span>}
                  </div>
                </div>
              </div>
            )))}

            {!loading && tab === 'meetings' && (
              <>
                <div className="cv-pane-head"><span /><button className="btn blue sm" onClick={scheduleMeeting}><Ic name="plus" size={14} /> Schedule Meeting</button></div>
                {list('meetings').length === 0 ? empty('meetings') : list('meetings').map((m) => (
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
              </>
            )}

            {!loading && tab === 'tasks' && (
              <>
                <div className="cv-pane-head"><span>{s.openTasks.length} open</span><button className="btn blue sm" onClick={newTask}><Ic name="plus" size={14} /> New Task</button></div>
                {list('tasks').length === 0 ? empty('tasks') : list('tasks').map((t) => (
                  <div key={t.id} className="act-item act-clickable" onClick={() => setTaskForm({ id: t.id, seed: { ...emptyTask(), ...t, reminder_days: t.reminder_days ?? '' } })}>
                    <span className="act-ic"><Ic name="checksquare" size={15} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 650, textDecoration: t.status === 'Completed' ? 'line-through' : 'none' }}>{t.title}</div>
                      <div className="act-meta">
                        <span className={'badge ' + (TASK_STATUS_BADGE[t.status] || '')}>{t.status || 'Not Started'}</span>
                        {t.due_date && <span className={iso(t.due_date) < t0 && !TASK_DONE.includes(t.status) ? 'overdue-date' : undefined}><Ic name="calendar" size={12} /> due {fmtDate(t.due_date)}</span>}
                        {t.assigned_to && <span><Ic name="user" size={12} /> {t.assigned_to}</span>}
                      </div>
                    </div>
                    <span className="act-open"><Ic name="chevron-right" size={16} /></span>
                  </div>
                ))}
              </>
            )}

            {!loading && tab === 'notes' && (
              <>
                <div className="composer">
                  <div className="form-field"><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened with this client?" /></div>
                  <div className="btn-row" style={{ marginTop: 10 }}><button className="btn blue" onClick={addNote}><Ic name="plus" size={15} /> Add Note</button></div>
                </div>
                {list('notes').length === 0 ? empty('notes') : list('notes').map((n) => (
                  <div key={n.id} className="act-item">
                    <span className="act-ic"><Ic name="edit" size={15} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="act-body" style={{ marginTop: 0 }}>{n.body}</div>
                      <div className="act-meta">{n.owner && <span><Ic name="user" size={12} /> {n.owner}</span>}<span className="act-when">{n.created_at}</span></div>
                    </div>
                    <button className="action-btn danger" title="Delete" onClick={() => delNote(n)}><Ic name="trash" size={15} /></button>
                  </div>
                ))}
              </>
            )}

            {!loading && tab === 'attachments' && (
              <>
                <div className="cv-pane-head"><span>Documents kept on the client</span><button className="btn blue sm" onClick={() => fileRef.current?.click()}><Ic name="upload" size={14} /> Upload File</button></div>
                <input ref={fileRef} type="file" hidden onChange={onFile} />
                {list('attachments').length === 0 ? empty('attachments') : list('attachments').map((a) => (
                  <div key={a.id} className="act-item">
                    <span className="act-ic"><Ic name="file" size={15} /></span>
                    <div className="act-clickable-body" onClick={() => openAttachment(a)}>
                      <div style={{ fontWeight: 650 }}>{a.file_name}</div>
                      <div className="act-meta">{a.file_size > 0 && <span>{kb(a.file_size)}</span>}{a.owner && <span><Ic name="user" size={12} /> {a.owner}</span>}<span className="act-when">{a.created_at}</span></div>
                    </div>
                    <button className="action-btn danger" title="Delete" onClick={() => delAttachment(a)}><Ic name="trash" size={15} /></button>
                  </div>
                ))}
              </>
            )}

            {!loading && tab === 'emails' && (list('emails').length === 0 ? empty('emails') : list('emails').map((e) => (
              <div key={e.id} className="act-item act-clickable" onClick={() => setMailId(e.id)} title="Open this email">
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
                <span className="act-open"><Ic name="chevron-right" size={16} /></span>
              </div>
            )))}

            {!loading && tab === 'onboarding' && <ClientOnboarding clientId={client.id} />}

            {!loading && tab === 'referrals' && (list('referrals').length === 0 ? empty('referrals') : list('referrals').map((r) => (
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
            )))}

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
      </div>

      {mailId && <EmailPreview clientId={client.id} id={mailId} onClose={() => setMailId(null)} />}
      <PolicyFormModal open={!!policyForm} policyId={policyForm?.id} seed={policyForm?.seed} lockClient
        onClose={() => setPolicyForm(null)} onSaved={() => load()} />
      <MeetingFormModal open={!!meetingForm} meetingId={meetingForm?.id} seed={meetingForm?.seed} lockedParticipant={clientParticipant}
        onClose={() => setMeetingForm(null)} onSaved={() => load()} />
      <TaskFormModal open={!!taskForm} taskId={taskForm?.id} seed={taskForm?.seed} lockRelation={clientRelation}
        onClose={() => setTaskForm(null)} onSaved={() => load()} />
    </div>
  );
}

// A sent email as it went out: who it was from and to, the copy, the attachments and the message itself.
// The message is shown in a sandboxed frame, so nothing in it can run or reach the CRM.
function EmailPreview({ clientId, id, onClose }) {
  const [m, setM] = useState(null);
  useEffect(() => {
    api(`/clients/${clientId}/emails/${id}`).then(setM).catch((e) => { toast.error(e.message || 'Could not open the email'); onClose(); });
  }, [clientId, id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const body = m && (m.body_html
    ? '<base target="_blank"><style>body{font-family:Arial,Helvetica,sans-serif;margin:16px;color:#1a2230}img{max-width:100%;height:auto}</style>' + m.body_html
    : null);
  const files = String(m?.attachment_names || '').split(',').map((x) => x.trim()).filter(Boolean);
  return (
    <Modal open onClose={onClose} title={m ? (m.subject || '(no subject)') : 'Email'} subtitle={m ? `${m.status} · ${m.created_at}` : ''} icon="mail" size="lg"
      footer={<button className="btn ghost" onClick={onClose}>Close</button>}>
      {!m ? <div className="spinner">Loading…</div> : (
        <div className="mail-view">
          <div className="mail-meta">
            {m.from_addr && <div><span>From</span><b>{m.from_addr}</b></div>}
            <div><span>To</span><b>{m.to_addr}</b></div>
            {m.cc_addr && <div><span>Cc</span><b>{m.cc_addr}</b></div>}
            {m.sent_by && <div><span>Sent by</span><b>{m.sent_by}</b></div>}
            <div><span>Status</span><b><span className={'badge ' + (m.status === 'Sent' ? 'green' : m.status === 'Failed' ? 'red' : '')}>{m.status}</span></b></div>
          </div>
          {m.status === 'Failed' && m.error && <div className="qt-banner red"><Ic name="alert" size={15} /><span>{m.error}</span></div>}
          {files.length > 0 && (
            <div className="mail-files">{files.map((n) => <span key={n}><Ic name="file" size={13} /> {n}</span>)}</div>
          )}
          {body
            ? <iframe className="mail-frame" title="Email message" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={body} />
            : (
              <div className="mail-plain">
                <p>{m.body_preview || 'No message text was kept.'}</p>
                <small>Only the first lines were kept for emails sent before the full message was saved.</small>
              </div>
            )}
        </div>
      )}
    </Modal>
  );
}
