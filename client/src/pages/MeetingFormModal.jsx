import { useEffect, useState, useMemo, useRef } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import Modal from '../components/Modal.jsx';
import Select from '../components/Select.jsx';
import SearchSelect from '../components/SearchSelect.jsx';
import DateField from '../components/DateField.jsx';
import { Ic } from '../components/Icons.jsx';
import {
  MEETING_TYPES, MEETING_STATUSES, COMPLETED_STATUS, PARTICIPANT_KINDS,
  REMINDER_OFFSETS, offsetLabel, emptyMeeting, isRangeValid,
} from './meetingConstants.js';

// The meeting create/edit form, shared by the Meetings module and the
// Meetings related list on a lead — so scheduling from either place produces
// the same real meeting record.
//
// `seed` is read through a ref and applied only when the modal opens, so a
// parent passing an inline object can't cause a re-seed loop mid-edit.
// `lockedParticipant` pins a participant that can't be removed (the lead you
// scheduled from — dropping it would orphan the meeting from that lead).
export default function MeetingFormModal({ open, meetingId, seed, lockedParticipant, onClose, onSaved }) {
  const [f, setF] = useState(emptyMeeting);
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);
  const [leads, setLeads] = useState([]);
  const [pKind, setPKind] = useState('client');
  const [pName, setPName] = useState('');

  const seedRef = useRef(seed);
  seedRef.current = seed;

  useEffect(() => {
    if (!open) return;
    setF({ ...emptyMeeting(), ...(seedRef.current || {}) });
    setPKind('client');
    setPName('');
  }, [open]);

  // Lookups are only needed once the form is actually used.
  useEffect(() => {
    if (!open || users.length || clients.length || leads.length) return;
    api('/users').then(setUsers).catch(() => {});
    api('/clients').then(setClients).catch(() => {});
    api('/leads').then(setLeads).catch(() => {});
  }, [open]);

  const userNames = useMemo(() => users.map((u) => u.full_name || u.username).filter(Boolean), [users]);
  const pOptions = useMemo(() => {
    if (pKind === 'client') return clients.map((c) => c.client_name).filter(Boolean);
    if (pKind === 'lead') return leads.map((l) => l.lead_name).filter(Boolean);
    return userNames;
  }, [pKind, clients, leads, userNames]);

  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  function addParticipant(name) {
    if (!name) return;
    if (f.participants.some((p) => p.kind === pKind && p.name === name)) {
      toast.info(`${name} is already a participant`);
      setPName('');
      return;
    }
    const src = pKind === 'client' ? clients.find((c) => c.client_name === name)
      : pKind === 'lead' ? leads.find((l) => l.lead_name === name)
      : users.find((u) => (u.full_name || u.username) === name);
    set('participants', [...f.participants, {
      kind: pKind, ref_id: src?.id ?? null, name,
      email: src?.email || '', mobile: src?.mobile || '',
    }]);
    setPName('');
  }
  const isLocked = (p) => !!lockedParticipant && p.kind === lockedParticipant.kind && p.ref_id === lockedParticipant.ref_id;
  function removeParticipant(i) { set('participants', f.participants.filter((_, x) => x !== i)); }

  function addReminder() {
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
    if (f.status === COMPLETED_STATUS && !(f.minutes || '').trim()) {
      toast.error('Add the minutes of meeting before marking it completed'); return;
    }
    setSaving(true);
    try {
      const row = meetingId
        ? await api('/meetings/' + meetingId, { method: 'PUT', body: f })
        : await api('/meetings', { method: 'POST', body: f });
      toast.success(meetingId ? 'Meeting updated' : 'Meeting scheduled');
      onSaved?.(row);
      onClose?.();
    } catch (e) {
      toast.error(e.message || 'Could not save meeting');
    } finally { setSaving(false); }
  }

  const isCompleted = f.status === COMPLETED_STATUS;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={meetingId ? 'Edit Meeting' : 'Schedule Meeting'}
      subtitle="Set the agenda, invite participants and add reminders"
      icon="calendar"
      size="lg"
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn blue" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : meetingId ? 'Update Meeting' : 'Save Meeting'}
          </button>
        </>
      }
    >
      {open && (
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
                  <span className={'chip' + (isLocked(p) ? ' on' : '')} key={`${p.kind}-${p.name}-${i}`}>
                    <Ic name={PARTICIPANT_KINDS.find((k) => k.key === p.kind)?.icon || 'user'} size={12} />
                    {p.name}
                    <small style={{ opacity: .6, marginLeft: 4 }}>{p.kind}</small>
                    {!isLocked(p) && (
                      <button type="button" onClick={() => removeParticipant(i)} aria-label={`Remove ${p.name}`}><Ic name="x" size={12} /></button>
                    )}
                  </span>
                ))}
              </div>
            )}
            <label className="inline-check" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={!!f.notify_participants} onChange={(e) => set('notify_participants', e.target.checked ? 1 : 0)} />
              <span>Participants Reminder — include participants when reminders fire (otherwise the owner only)</span>
            </label>
          </div>

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
                <textarea rows={5} value={f.minutes || ''} onChange={(e) => set('minutes', e.target.value)}
                  placeholder="Decisions taken, action items, owners and next steps…" />
                <div className="hint-line">Captured only for completed meetings.</div>
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

// Maps a saved meeting row back into the shape the form expects.
export function meetingToForm(r) {
  return {
    ...emptyMeeting(),
    ...r,
    participants: (r.participants || []).map((p) => ({ kind: p.kind, ref_id: p.ref_id, name: p.name, email: p.email, mobile: p.mobile })),
    reminders: (r.reminders || []).map((x) => x.offset_minutes),
  };
}
