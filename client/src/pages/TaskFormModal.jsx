import { useEffect, useState, useMemo, useRef } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import Modal from '../components/Modal.jsx';
import Select from '../components/Select.jsx';
import SearchSelect from '../components/SearchSelect.jsx';
import DateField from '../components/DateField.jsx';
import { Ic } from '../components/Icons.jsx';
import {
  TASK_TYPES, TASK_STATUSES, TASK_PRIORITIES, TASK_RELATED_KINDS,
  TASK_REMINDERS, reminderLabel, emptyTask, isTaskRangeValid,
} from './taskConstants.js';

// Shared by the Tasks module and the Tasks related list on a lead, so a task
// created from either place is the same record.
//
// `seed` is read through a ref and applied only when the modal opens, so an
// inline object from a parent can't re-seed the form mid-edit.
// `lockRelation` pins the "Task For" record (the lead you created it from).
export default function TaskFormModal({ open, taskId, seed, lockRelation, onClose, onSaved }) {
  const [f, setF] = useState(emptyTask);
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);
  const [leads, setLeads] = useState([]);

  const seedRef = useRef(seed);
  seedRef.current = seed;

  useEffect(() => {
    if (!open) return;
    setF({ ...emptyTask(), ...(seedRef.current || {}) });
  }, [open]);

  useEffect(() => {
    if (!open || users.length || clients.length || leads.length) return;
    api('/users').then(setUsers).catch(() => {});
    api('/clients').then(setClients).catch(() => {});
    api('/leads').then(setLeads).catch(() => {});
  }, [open]);

  const userNames = useMemo(() => users.map((u) => u.full_name || u.username).filter(Boolean), [users]);
  const relatedOptions = useMemo(() => {
    if (f.related_kind === 'client') return clients.map((c) => c.client_name).filter(Boolean);
    if (f.related_kind === 'lead') return leads.map((l) => l.lead_name).filter(Boolean);
    return [];
  }, [f.related_kind, clients, leads]);

  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  // Switching the lookup type invalidates whatever was picked under the old one.
  function setRelatedKind(kind) {
    setF((p) => ({ ...p, related_kind: kind, related_id: null, related_name: '' }));
  }
  function pickRelated(name) {
    const src = f.related_kind === 'client'
      ? clients.find((c) => c.client_name === name)
      : leads.find((l) => l.lead_name === name);
    setF((p) => ({ ...p, related_name: name, related_id: src?.id ?? null }));
  }

  async function save() {
    if (!f.title.trim()) { toast.error('Task Subject is required'); return; }
    if (!isTaskRangeValid(f.start_date, f.due_date)) { toast.error('Due date cannot be before the start date'); return; }
    if (f.related_kind && !f.related_name) { toast.error(`Select the ${f.related_kind} this task is for`); return; }
    setSaving(true);
    try {
      const row = taskId
        ? await api('/tasks/' + taskId, { method: 'PUT', body: f })
        : await api('/tasks', { method: 'POST', body: f });
      toast.success(taskId ? 'Task updated' : 'Task created');
      onSaved?.(row);
      onClose?.();
    } catch (e) {
      toast.error(e.message || 'Could not save task');
    } finally { setSaving(false); }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={taskId ? 'Edit Task' : 'New Task'}
      subtitle="Assign the work, set dates and add a reminder"
      icon="checksquare"
      size="lg"
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn blue" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : taskId ? 'Update Task' : 'Save Task'}
          </button>
        </>
      }
    >
      {open && (
        <>
          <div className="form-grid">
            <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Task Subject <span className="req">*</span></label>
              <input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Collect KYC documents" /></div>
            <div className="form-field"><label>Task Type</label>
              <Select value={f.task_type} onChange={(e) => set('task_type', e.target.value)}>
                <option value="">Select…</option>
                {TASK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select></div>

            <div className="form-field"><label>Start Date</label>
              <DateField value={f.start_date} onChange={(e) => set('start_date', e.target.value)} /></div>
            <div className="form-field"><label>Due Date</label>
              <DateField value={f.due_date} onChange={(e) => set('due_date', e.target.value)} /></div>
            <div className="form-field"><label>Priority</label>
              <Select value={f.priority} onChange={(e) => set('priority', e.target.value)}>
                {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </Select></div>

            <div className="form-field"><label>Assigned By</label>
              <Select value={f.assigned_by} onChange={(e) => set('assigned_by', e.target.value)}>
                <option value="">Me</option>
                {userNames.map((u) => <option key={u} value={u}>{u}</option>)}
              </Select></div>
            <div className="form-field"><label>Assign To</label>
              <Select value={f.assigned_to} onChange={(e) => set('assigned_to', e.target.value)}>
                <option value="">Unassigned</option>
                {userNames.map((u) => <option key={u} value={u}>{u}</option>)}
              </Select></div>
            <div className="form-field" />
          </div>

          <div className="sub-section">
            <div className="section-head">Task For</div>
            {lockRelation ? (
              <div className="chips">
                <span className="chip on">
                  <Ic name={TASK_RELATED_KINDS.find((k) => k.key === lockRelation.related_kind)?.icon || 'user'} size={12} />
                  {lockRelation.related_name}
                  <small style={{ opacity: .6, marginLeft: 4 }}>{lockRelation.related_kind}</small>
                </span>
              </div>
            ) : (
              <div className="participant-add">
                <Select value={f.related_kind} onChange={(e) => setRelatedKind(e.target.value)} style={{ maxWidth: 140 }}>
                  <option value="">Not linked</option>
                  {TASK_RELATED_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                </Select>
                {f.related_kind && (
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <SearchSelect
                      value={f.related_name}
                      onChange={pickRelated}
                      options={relatedOptions}
                      placeholder={`Select a ${f.related_kind}…`}
                    />
                  </div>
                )}
              </div>
            )}
            {!lockRelation && !f.related_kind && (
              <div className="empty-inline">Not linked to a client or lead — it'll just be a standalone task.</div>
            )}
          </div>

          <div className="sub-section">
            <div className="section-head">Status &amp; Reminder</div>
            <div className="form-grid">
              <div className="form-field"><label>Task Status</label>
                <Select value={f.status} onChange={(e) => set('status', e.target.value)}>
                  {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select></div>
              <div className="form-field"><label>Task Reminder</label>
                <Select value={String(f.reminder_days ?? '')} onChange={(e) => set('reminder_days', e.target.value === '' ? '' : Number(e.target.value))}>
                  {TASK_REMINDERS.map((r) => <option key={String(r.v)} value={String(r.v)}>{r.label}</option>)}
                </Select></div>
              <div className="form-field" />
            </div>
            {f.reminder_days !== '' && f.reminder_days != null && (
              <div className="hint-line">
                Notifies on the bell feed at 09:00, {reminderLabel(f.reminder_days).toLowerCase()}
                {f.due_date ? ` (due ${f.due_date})` : ''}. Changing the due date re-arms it.
              </div>
            )}
            <div className="form-field" style={{ marginTop: 12 }}>
              <label>Remarks</label>
              <textarea rows={3} value={f.remarks} onChange={(e) => set('remarks', e.target.value)}
                placeholder="Context, blockers, what done looks like…" />
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
