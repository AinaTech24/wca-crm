// Leave on the Attendance page: each person's own requests, and the admin's approval queue.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import confirm from '../components/confirm.js';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import Select from '../components/Select.jsx';
import DateField, { fmt as fmtDate } from '../components/DateField.jsx';
import { Ic } from '../components/Icons.jsx';

const LEAVE_TYPES = ['Casual Leave', 'Sick Leave', 'Earned Leave', 'Unpaid Leave', 'Other'];
const HALVES = ['First half', 'Second half'];
export const LEAVE_BADGE = { Pending: 'orange', Approved: 'green', Rejected: 'red', Cancelled: '' };

const span = (r) => (r.from_date === r.to_date ? fmtDate(r.from_date) : `${fmtDate(r.from_date)} → ${fmtDate(r.to_date)}`);
const daysText = (n) => (Number(n) === 0.5 ? 'Half day' : `${Number(n)} day${Number(n) === 1 ? '' : 's'}`);
const statusCell = (r) => <span className={'badge ' + (LEAVE_BADGE[r.status] || '')}>{r.status}</span>;
const decisionCell = (r) => (r.decided_by && r.status !== 'Pending'
  ? <span className="att-dow">{r.status === 'Cancelled' ? 'Cancelled' : r.status} by {r.decided_by}{r.decision_note ? ` — ${r.decision_note}` : ''}</span>
  : '—');
const typeCell = (r) => <span>{r.leave_type}{r.half_day ? <span className="att-dow"> · {r.half_day}</span> : null}</span>;

// ---------------------------------------------------------------------------------------------
// Asking for leave
// ---------------------------------------------------------------------------------------------
function RequestModal({ open, onClose, onSaved }) {
  const blank = () => { const d = new Date().toLocaleDateString('sv-SE'); return { from_date: d, to_date: d, leave_type: 'Casual Leave', half: false, half_day: 'First half', reason: '' }; };
  const [f, setF] = useState(blank);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setF(blank()); }, [open]);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const oneDay = f.from_date && f.from_date === f.to_date;

  async function save() {
    setSaving(true);
    try {
      await api('/attendance/leave', { method: 'POST', body: {
        from_date: f.from_date, to_date: f.to_date || f.from_date, leave_type: f.leave_type,
        half_day: oneDay && f.half ? f.half_day : '', reason: f.reason,
      } });
      toast.success('Leave request sent for approval');
      onSaved(); onClose();
    } catch (e) { toast.error(e.message || 'Could not send the request'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Request leave" subtitle="An admin will approve or reject it" icon="calendar" size="md"
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn blue" onClick={save} disabled={saving}>{saving ? 'Sending…' : 'Send request'}</button></>}>
      {open && (
        <div className="form-grid two">
          <div className="form-field"><label>From <span className="req">*</span></label>
            <DateField typeable value={f.from_date} onChange={(e) => setF((p) => ({ ...p, from_date: e.target.value, to_date: !p.to_date || p.to_date < e.target.value ? e.target.value : p.to_date }))} /></div>
          <div className="form-field"><label>To <span className="req">*</span></label>
            <DateField typeable value={f.to_date} onChange={(e) => set('to_date', e.target.value)} /></div>
          <div className="form-field"><label>Type of leave <span className="req">*</span></label>
            <Select value={f.leave_type} onChange={(e) => set('leave_type', e.target.value)}>{LEAVE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></div>
          <div className="form-field"><label>Half day</label>
            {oneDay ? (
              <Select value={f.half ? f.half_day : ''} onChange={(e) => setF((p) => ({ ...p, half: !!e.target.value, half_day: e.target.value || p.half_day }))}>
                <option value="">No — full day</option>
                {HALVES.map((h) => <option key={h} value={h}>{h}</option>)}
              </Select>
            ) : <input disabled value="Only for a single date" />}
          </div>
          <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Reason <span className="req">*</span></label>
            <textarea rows={3} maxLength={500} value={f.reason} onChange={(e) => set('reason', e.target.value)} placeholder="e.g. Family function out of town" /></div>
          <p className="att-rule" style={{ gridColumn: 'span 2', margin: 0 }}>Sundays inside the dates are not counted. Once approved, the days show as Leave in attendance.</p>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// My leave
// ---------------------------------------------------------------------------------------------
export function MyLeave({ tick, onChange }) {
  const [data, setData] = useState(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => { api('/attendance/leave/mine').then(setData).catch(() => {}); }, [tick]);
  const rows = data?.rows || [];
  const today = data?.today || '';

  // Days approved this calendar year, by type, and what is still waiting.
  const stats = useMemo(() => {
    const year = (today || new Date().toISOString()).slice(0, 4);
    const by = {}; let pending = 0, taken = 0;
    for (const r of rows) {
      if (r.status === 'Pending') pending++;
      if (r.status === 'Approved' && r.from_date.startsWith(year)) { by[r.leave_type] = (by[r.leave_type] || 0) + Number(r.days); taken += Number(r.days); }
    }
    return { year, by, pending, taken };
  }, [rows, today]);

  async function cancel(r) {
    const ok = await confirm({ title: 'Cancel this leave request?', message: `${r.leave_type} · ${span(r)}${r.status === 'Approved' ? ' — the leave days will be taken off your attendance.' : ''}`, tone: 'danger', confirmText: 'Cancel request', icon: 'calendar' });
    if (!ok) return;
    try { await api(`/attendance/leave/${r.id}/cancel`, { method: 'POST' }); toast.success('Leave request cancelled'); onChange(); }
    catch (e) { toast.error(e.message || 'Could not cancel'); }
  }
  const canCancel = (r) => r.status === 'Pending' || (r.status === 'Approved' && r.from_date > today);

  return (
    <>
      <div className="kpi-grid att-kpis" style={{ marginBottom: 16 }}>
        <div className="kpi-card" data-tone="info">
          <div className="kpi-card-head"><span className="kpi-card-label">Leave taken in {stats.year}</span><span className="kpi-card-ic"><Ic name="calendar" size={17} /></span></div>
          <div className="kpi-card-num">{stats.taken}</div>
          <div className="kpi-card-hint">{Object.entries(stats.by).map(([t, n]) => `${n} ${t.replace(' Leave', '').toLowerCase()}`).join(' · ') || 'approved days'}</div>
        </div>
        <div className="kpi-card" data-tone="warning">
          <div className="kpi-card-head"><span className="kpi-card-label">Waiting for approval</span><span className="kpi-card-ic"><Ic name="clock" size={17} /></span></div>
          <div className="kpi-card-num">{stats.pending}</div>
        </div>
      </div>
      <div className="card">
        <DataTable
          title="My leave"
          count={rows.length}
          loading={!data}
          rows={rows}
          search={false}
          headerExtra={<button className="btn blue" onClick={() => setAsking(true)}><Ic name="plus" size={15} /> Request leave</button>}
          columns={[
            { key: 'from_date', label: 'Dates', render: (r) => <b>{span(r)}</b> },
            { key: 'days', label: 'Days', noFilter: true, render: (r) => daysText(r.days) },
            { key: 'leave_type', label: 'Type', render: typeCell },
            { key: 'reason', label: 'Reason', noFilter: true },
            { key: 'status', label: 'Status', render: statusCell },
            { key: 'decided_by', label: 'Decision', noFilter: true, render: decisionCell },
          ]}
          actions={(r) => (canCancel(r)
            ? <button className="action-btn danger" title="Cancel request" onClick={() => cancel(r)}><Ic name="x" size={15} /></button>
            : null)}
          empty={{ icon: 'calendar', title: 'No leave requests yet', sub: 'Use “Request leave” to ask for time off.' }}
        />
      </div>
      <RequestModal open={asking} onClose={() => setAsking(false)} onSaved={onChange} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Admin: approve / reject
// ---------------------------------------------------------------------------------------------
function DecideModal({ req, decision, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setNote(''); }, [req, decision]);
  const approve = decision === 'Approved';

  async function save() {
    setSaving(true);
    try {
      const r = await api(`/attendance/leave/${req.id}/decide`, { method: 'POST', body: { decision, note } });
      if (approve) {
        const skipped = (r.skipped || []).map((s) => `${fmtDate(s.date)} (${s.why})`).join(', ');
        toast.success(req.half_day ? 'Half-day leave approved' : `Leave approved · ${r.marked} day${r.marked === 1 ? '' : 's'} marked in attendance`);
        if (skipped) toast.info('Not marked as leave: ' + skipped);
      } else toast.success('Leave rejected');
      onDone(); onClose();
    } catch (e) { toast.error(e.message || 'Could not save the decision'); onDone(); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={!!req} onClose={onClose} title={approve ? 'Approve leave' : 'Reject leave'}
      subtitle={req ? `${req.user_name} · ${req.leave_type}${req.half_day ? ` (${req.half_day})` : ''} · ${span(req)} · ${daysText(req.days)}` : ''}
      icon="calendar" size="md"
      footer={<><button className="btn ghost" onClick={onClose}>Back</button><button className={'btn ' + (approve ? 'blue' : 'red')} onClick={save} disabled={saving}>{saving ? 'Saving…' : approve ? 'Approve' : 'Reject'}</button></>}>
      {req && (
        <div className="form-grid">
          <div className="form-field" style={{ gridColumn: '1 / -1' }}><label>Their reason</label><div className="att-reason">{req.reason || '—'}</div></div>
          <div className="form-field" style={{ gridColumn: '1 / -1' }}><label>Note to {req.user_name?.split(' ')[0] || 'them'} {approve ? '(optional)' : ''}</label>
            <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={approve ? 'e.g. Hand over the pending renewals first' : 'e.g. Quarter-end — please pick another week'} /></div>
          {approve && !req.half_day && <p className="att-rule" style={{ gridColumn: '1 / -1', margin: 0 }}>Each working day in these dates will be marked Leave in attendance. Days they already checked in on are left as they are.</p>}
        </div>
      )}
    </Modal>
  );
}

export function LeaveRequests({ tick, users, onChange }) {
  const [status, setStatus] = useState('Pending');
  const [userId, setUserId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState(null);   // { req, decision }

  useEffect(() => {
    setLoading(true);
    api(`/attendance/leave?status=${status}${userId ? '&user_id=' + userId : ''}`).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [status, userId, tick]);

  const rows = data?.rows || [];
  const today = data?.today || '';

  async function revoke(r) {
    const ok = await confirm({ title: 'Cancel this approved leave?', message: `${r.user_name} · ${span(r)}. The leave days will be taken off their attendance.`, tone: 'danger', confirmText: 'Cancel leave', icon: 'calendar' });
    if (!ok) return;
    try { await api(`/attendance/leave/${r.id}/cancel`, { method: 'POST' }); toast.success('Leave cancelled'); onChange(); }
    catch (e) { toast.error(e.message || 'Could not cancel'); }
  }

  return (
    <>
      <div className="card card-pad report-controls" style={{ marginBottom: 14 }}>
        <div className="report-presets">
          {['Pending', 'Approved', 'Rejected', 'Cancelled', 'all'].map((s) => (
            <button key={s} className={'chip-btn' + (status === s ? ' active' : '')} onClick={() => setStatus(s)}>
              {s === 'all' ? 'All' : s}{s === 'Pending' && data?.pending ? ` (${data.pending})` : ''}
            </button>
          ))}
        </div>
        <div className="report-range">
          <div className="form-field"><label>Person</label>
            <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Everyone</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
            </Select></div>
        </div>
      </div>
      <div className="card">
        <DataTable
          title={status === 'all' ? 'All leave requests' : `${status} leave requests`}
          count={rows.length}
          loading={loading && !data}
          rows={rows}
          searchPlaceholder="Search person, reason…"
          searchKeys={['user_name', 'reason', 'leave_type']}
          columns={[
            { key: 'user_name', label: 'Person', render: (r) => <b>{r.user_name}</b> },
            { key: 'from_date', label: 'Dates', render: (r) => span(r) },
            { key: 'days', label: 'Days', noFilter: true, render: (r) => daysText(r.days) },
            { key: 'leave_type', label: 'Type', render: typeCell },
            { key: 'reason', label: 'Reason', noFilter: true },
            { key: 'created_at', label: 'Asked on', noFilter: true, render: (r) => (r.created_at ? fmtDate(r.created_at.slice(0, 10)) : '—') },
            { key: 'status', label: 'Status', render: statusCell },
            { key: 'decided_by', label: 'Decision', noFilter: true, render: decisionCell },
          ]}
          actions={(r) => (r.status === 'Pending' ? (
            <>
              <button className="action-btn" title="Approve" onClick={() => setDeciding({ req: r, decision: 'Approved' })}><Ic name="check" size={15} /></button>
              <button className="action-btn danger" title="Reject" onClick={() => setDeciding({ req: r, decision: 'Rejected' })}><Ic name="x" size={15} /></button>
            </>
          ) : r.status === 'Approved' && r.to_date >= today ? (
            <button className="action-btn danger" title="Cancel this leave" onClick={() => revoke(r)}><Ic name="trash" size={15} /></button>
          ) : null)}
          empty={{ icon: 'calendar', title: status === 'Pending' ? 'No leave waiting for approval' : 'No leave requests here', sub: status === 'Pending' ? 'New requests show up here and on the bell.' : 'Try another status.' }}
        />
      </div>
      <DecideModal req={deciding?.req} decision={deciding?.decision} onClose={() => setDeciding(null)} onDone={onChange} />
    </>
  );
}
