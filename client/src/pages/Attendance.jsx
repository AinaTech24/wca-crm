import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import toast from '../components/toast.js';
import confirm from '../components/confirm.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import Modal from '../components/Modal.jsx';
import Select from '../components/Select.jsx';
import DateField, { fmt as fmtDate } from '../components/DateField.jsx';
import { Ic } from '../components/Icons.jsx';
import { useRealtime } from '../realtime.js';
import { PRESETS, presetRange } from './reportConstants.js';

const STATUSES = ['Present', 'Absent', 'Leave', 'Holiday'];
const RESULT_BADGE = { 'Full day': 'green', 'Half day': 'orange', 'In progress': 'blue', 'No check-out': 'red', Absent: 'red', Leave: 'blue', Holiday: 'blue' };
const ARRIVAL_BADGE = { 'On time': 'green', Late: 'orange' };

// ---- small formatting helpers (times are IST text: 'YYYY-MM-DD HH:MM:SS') ----
const t12 = (s) => {
  if (!s) return '—';
  const [h, m] = String(s).slice(11, 16).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const hm = (s) => (s ? String(s).slice(11, 16) : '');
const dur = (min) => (min == null ? '—' : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`);
const dayOf = (d) => { const [y, m, dd] = String(d).split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('en-IN', { weekday: 'short' }); };
const minutesBetween = (a, b) => Math.max(0, Math.round((Date.parse(b.replace(' ', 'T') + 'Z') - Date.parse(a.replace(' ', 'T') + 'Z')) / 60000));
const mapLink = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;

// Where the browser says the person is, or null when they decline or it takes too long. Attendance
// never waits on it for long, and never fails because of it.
function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    );
  });
}

// IST "now" that keeps ticking, from the server's clock rather than the visitor's.
function useIstClock(serverNow) {
  const offset = useRef(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (serverNow) offset.current = Date.parse(serverNow.replace(' ', 'T') + 'Z') - Date.now();
    setTick((t) => t + 1);
  }, [serverNow]);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(id); }, []);
  return useMemo(() => new Date(Date.now() + offset.current).toISOString().slice(0, 19).replace('T', ' '), [tick]);   // eslint-disable-line react-hooks/exhaustive-deps
}

function Places({ r }) {
  const has = (la, lo) => la != null && lo != null;
  if (!has(r.in_lat, r.in_lng) && !has(r.out_lat, r.out_lng)) return <span title="Location was not shared">—</span>;
  return (
    <span className="att-places">
      {has(r.in_lat, r.in_lng) && <a href={mapLink(r.in_lat, r.in_lng)} target="_blank" rel="noreferrer" title={`Check-in location${r.in_acc ? ` (±${r.in_acc} m)` : ''}`}>In</a>}
      {has(r.out_lat, r.out_lng) && <a href={mapLink(r.out_lat, r.out_lng)} target="_blank" rel="noreferrer" title={`Check-out location${r.out_acc ? ` (±${r.out_acc} m)` : ''}`}>Out</a>}
    </span>
  );
}

const arrivalCell = (r) => (r.arrival ? <span className={'badge ' + (ARRIVAL_BADGE[r.arrival] || '')}>{r.arrival}{r.arrival === 'Late' ? ` · ${r.late_by} min` : ''}</span> : '—');
const resultCell = (r) => (r.result ? <span className={'badge ' + (RESULT_BADGE[r.result] || '')}>{r.result}</span> : '—');

// ---------------------------------------------------------------------------------------------
// Today: the big check-in / check-out card
// ---------------------------------------------------------------------------------------------
function TodayCard({ data, onChange }) {
  const [busy, setBusy] = useState('');
  const clock = useIstClock(data?.now);
  const t = data?.today;
  const st = data?.settings;

  async function act(kind) {
    setBusy(kind);
    try {
      const pos = await getPosition();
      const row = await api('/attendance/' + kind, { method: 'POST', body: pos || {} });
      toast.success(kind === 'check-in' ? `Checked in at ${t12(row.check_in)}${pos ? '' : ' (location not shared)'}` : `Checked out at ${t12(row.check_out)} · ${dur(row.worked_minutes)} today`);
      onChange();
    } catch (e) { toast.error(e.message || 'Could not record that'); onChange(); }
    finally { setBusy(''); }
  }

  const live = t?.check_in && !t?.check_out ? minutesBetween(t.check_in, clock) : null;
  const marked = t && t.status !== 'Present';

  return (
    <div className="card att-today">
      <div className="att-clock">
        <div className="att-date">{new Date(clock.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
        <div className="att-time">{t12(clock)}<span>{clock.slice(17, 19)}</span></div>
        {st && <div className="att-rule">Office starts {t12('0000-00-00 ' + st.office_start)}{st.grace_minutes ? ` · ${st.grace_minutes} min grace` : ''} · a full day is {st.min_hours} hours</div>}
      </div>

      <div className="att-state">
        {!data ? <div className="spinner">Loading…</div> : marked ? (
          <>
            <span className={'badge ' + (RESULT_BADGE[t.status] || '')}>{t.status}</span>
            <p className="att-line">An admin marked today as <b>{t.status}</b>{t.note ? ` — ${t.note}` : ''}.</p>
          </>
        ) : !t?.check_in ? (
          <>
            <p className="att-line">You have not checked in yet today.</p>
            <button className="btn blue att-btn" onClick={() => act('check-in')} disabled={!!busy}>
              <Ic name="check" size={17} /> {busy === 'check-in' ? 'Checking in…' : 'Check in'}
            </button>
          </>
        ) : !t.check_out ? (
          <>
            <div className="att-chips">
              <span className="att-fact">In <b>{t12(t.check_in)}</b></span>
              {arrivalCell(t)}
              <span className="att-fact">Working for <b>{dur(live)}</b></span>
            </div>
            <button className="btn att-btn att-out" onClick={() => act('check-out')} disabled={!!busy}>
              <Ic name="logout" size={17} /> {busy === 'check-out' ? 'Checking out…' : 'Check out'}
            </button>
          </>
        ) : (
          <>
            <div className="att-chips">
              <span className="att-fact">In <b>{t12(t.check_in)}</b></span>
              <span className="att-fact">Out <b>{t12(t.check_out)}</b></span>
              <span className="att-fact">Total <b>{dur(t.worked_minutes)}</b></span>
              {arrivalCell(t)} {resultCell(t)}
            </div>
            <p className="att-line">You are done for today.</p>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// A person's history
// ---------------------------------------------------------------------------------------------
const HISTORY_PRESETS = [
  { key: 'this-month', label: 'This Month' },
  { key: 'last-month', label: 'Last Month' },
  { key: 'last-30', label: 'Last 30 Days' },
  { key: 'last-90', label: 'Last 90 Days' },
];
function historyRange(key) {
  if (key === 'last-30' || key === 'last-90') {
    const to = new Date(); const from = new Date(); from.setDate(from.getDate() - (key === 'last-30' ? 29 : 89));
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { from: iso(from), to: iso(to) };
  }
  return presetRange(key);
}

function Summary({ s }) {
  const items = [
    { label: 'Days present', num: s.present, icon: 'check', tone: 'success', hint: s.completed ? `avg ${dur(s.avg_minutes)} a day` : '' },
    { label: 'Late arrivals', num: s.late, icon: 'clock', tone: 'warning' },
    { label: 'Half days', num: s.half_days, icon: 'alert', tone: 'warning', hint: s.no_checkout ? `${s.no_checkout} without check-out` : '' },
    { label: 'Leave / absent', num: s.leave + s.absent, icon: 'calendar', tone: 'neutral', hint: `${s.leave} leave · ${s.absent} absent` },
    { label: 'Hours worked', num: dur(s.minutes), icon: 'clock', tone: 'info', hint: s.holiday ? `${s.holiday} holiday${s.holiday > 1 ? 's' : ''}` : '' },
  ];
  return (
    <div className="kpi-grid att-kpis" style={{ marginBottom: 16 }}>
      {items.map((it) => (
        <div className="kpi-card" data-tone={it.tone} key={it.label}>
          <div className="kpi-card-head"><span className="kpi-card-label">{it.label}</span><span className="kpi-card-ic"><Ic name={it.icon} size={17} /></span></div>
          <div className="kpi-card-num">{it.num}</div>
          {it.hint && <div className="kpi-card-hint">{it.hint}</div>}
        </div>
      ))}
    </div>
  );
}

function RangeBar({ preset, setPreset, range, setRange }) {
  return (
    <div className="card card-pad report-controls" style={{ marginBottom: 14 }}>
      <div className="report-presets">
        {HISTORY_PRESETS.map((p) => (
          <button key={p.key} className={'chip-btn' + (preset === p.key ? ' active' : '')} onClick={() => { setPreset(p.key); setRange(historyRange(p.key)); }}>{p.label}</button>
        ))}
      </div>
      <div className="report-range">
        <div className="form-field"><label>From</label><DateField value={range.from} onChange={(e) => { setPreset(''); setRange((r) => ({ ...r, from: e.target.value })); }} /></div>
        <div className="form-field"><label>To</label><DateField value={range.to} onChange={(e) => { setPreset(''); setRange((r) => ({ ...r, to: e.target.value })); }} /></div>
      </div>
    </div>
  );
}

function MyHistory({ tick, onChange }) {
  const [preset, setPreset] = useState('this-month');
  const [range, setRange] = useState(() => historyRange('this-month'));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!range.from || !range.to) return;
    setLoading(true);
    api(`/attendance/mine?from=${range.from}&to=${range.to}`).then((d) => { setData(d); onChange?.(d); }).catch(() => {}).finally(() => setLoading(false));
  }, [range.from, range.to, tick]);   // eslint-disable-line react-hooks/exhaustive-deps

  const rows = data?.rows || [];
  return (
    <>
      <RangeBar preset={preset} setPreset={setPreset} range={range} setRange={setRange} />
      {data && <Summary s={data.summary} />}
      <div className="card">
        <DataTable
          title="My attendance"
          count={rows.length}
          loading={loading && !data}
          rows={rows}
          search={false}
          columns={[
            { key: 'work_date', label: 'Date', render: (r) => <span><b>{fmtDate(r.work_date)}</b> <span className="att-dow">{dayOf(r.work_date)}</span></span> },
            { key: 'check_in', label: 'Check in', noFilter: true, render: (r) => t12(r.check_in) },
            { key: 'check_out', label: 'Check out', noFilter: true, render: (r) => t12(r.check_out) },
            { key: 'worked_minutes', label: 'Hours', noFilter: true, render: (r) => dur(r.worked_minutes) },
            { key: 'arrival', label: 'Arrival', render: arrivalCell },
            { key: 'result', label: 'Day', render: resultCell },
            { key: 'places', label: 'Location', noFilter: true, render: (r) => <Places r={r} /> },
            { key: 'note', label: 'Note', noFilter: true, render: (r) => r.note || '—' },
          ]}
          empty={{ icon: 'calendar', title: 'No attendance in this period', sub: 'Check in from the card above and it will show here.' }}
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Admin: add / correct an entry
// ---------------------------------------------------------------------------------------------
function EntryModal({ open, seed, users, onClose, onSaved }) {
  const [f, setF] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setF({ status: 'Present', note: '', ...seed, check_in: hm(seed?.check_in), check_out: hm(seed?.check_out) }); }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const editing = !!seed?.id;
  const present = f.status === 'Present';

  async function save() {
    setSaving(true);
    try {
      const body = { status: f.status, note: f.note || '' };
      if (present) { body.check_in = f.check_in || ''; body.check_out = f.check_out || ''; }
      if (editing) await api('/attendance/' + seed.id, { method: 'PUT', body });
      else await api('/attendance', { method: 'POST', body: { ...body, user_id: f.user_id, work_date: f.work_date } });
      toast.success(editing ? 'Attendance updated' : 'Attendance added');
      onSaved(); onClose();
    } catch (e) { toast.error(e.message || 'Could not save'); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Correct attendance' : 'Add attendance'}
      subtitle={editing ? `${seed.user_name || ''} · ${seed.work_date ? fmtDate(seed.work_date) : ''}` : 'Add a day that was missed, or mark leave, absence or a holiday'}
      icon="clock" size="md"
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn blue" onClick={save} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add'}</button></>}>
      {open && (
        <div className="form-grid two">
          {!editing && (
            <>
              <div className="form-field"><label>Person <span className="req">*</span></label>
                <Select value={f.user_id || ''} onChange={(e) => set('user_id', e.target.value)}>
                  <option value="">Select…</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
                </Select></div>
              <div className="form-field"><label>Date <span className="req">*</span></label>
                <DateField typeable value={f.work_date || ''} onChange={(e) => set('work_date', e.target.value)} /></div>
            </>
          )}
          <div className="form-field"><label>Status</label>
            <Select value={f.status} onChange={(e) => set('status', e.target.value)}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></div>
          <div className="form-field" />
          {present && (
            <>
              <div className="form-field"><label>Check-in time <span className="req">*</span></label>
                <input type="time" value={f.check_in || ''} onChange={(e) => set('check_in', e.target.value)} /></div>
              <div className="form-field"><label>Check-out time</label>
                <input type="time" value={f.check_out || ''} onChange={(e) => set('check_out', e.target.value)} /></div>
            </>
          )}
          <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Note</label>
            <input value={f.note || ''} maxLength={300} onChange={(e) => set('note', e.target.value)} placeholder="e.g. Forgot to check out — confirmed by phone" /></div>
          {editing && seed.edited_by && <div className="att-edited" style={{ gridColumn: 'span 2' }}>Last changed by {seed.edited_by}{seed.edited_at ? ` on ${fmtDate(seed.edited_at.slice(0, 10))} ${t12(seed.edited_at)}` : ''}</div>}
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// Admin: who is in today
// ---------------------------------------------------------------------------------------------
function Board({ tick, users, openEntry }) {
  const [date, setDate] = useState(() => new Date().toLocaleDateString('sv-SE'));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!date) return;
    setLoading(true);
    api('/attendance/board?date=' + date).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [date, tick]);

  const list = data?.users || [];
  const count = (fn) => list.filter(fn).length;
  const kpis = [
    { label: 'Working now', num: count((u) => u.record?.check_in && !u.record.check_out && u.record.status === 'Present'), icon: 'clock', tone: 'success' },
    { label: 'Done for the day', num: count((u) => u.record?.check_out), icon: 'check', tone: 'info' },
    { label: 'Late today', num: count((u) => u.record?.arrival === 'Late'), icon: 'alert', tone: 'warning' },
    { label: 'Leave / absent', num: count((u) => ['Leave', 'Absent', 'Holiday'].includes(u.record?.status)), icon: 'calendar', tone: 'neutral' },
    { label: 'Not checked in', num: count((u) => !u.record), icon: 'users', tone: 'danger' },
  ];
  const state = (u) => {
    const r = u.record;
    if (!r) return <span className="badge red">Not checked in</span>;
    if (r.status !== 'Present') return <span className={'badge ' + (RESULT_BADGE[r.status] || '')}>{r.status}</span>;
    return resultCell(r);
  };

  return (
    <>
      <div className="lead-toolbar">
        <div className="form-field" style={{ width: 200 }}><label>Date</label><DateField typeable value={date} onChange={(e) => setDate(e.target.value)} /></div>
      </div>
      <div className="kpi-grid att-kpis" style={{ marginBottom: 16 }}>
        {kpis.map((it) => (
          <div className="kpi-card" data-tone={it.tone} key={it.label}>
            <div className="kpi-card-head"><span className="kpi-card-label">{it.label}</span><span className="kpi-card-ic"><Ic name={it.icon} size={17} /></span></div>
            <div className="kpi-card-num">{it.num}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <DataTable
          title="Team"
          count={list.length}
          loading={loading && !data}
          rows={list}
          rowKey={(u) => u.user_id}
          searchPlaceholder="Search people…"
          searchKeys={['user_name']}
          columns={[
            { key: 'user_name', label: 'Person', render: (u) => <b>{u.user_name}</b> },
            { key: 'department', label: 'Department', render: (u) => u.department || '—' },
            { key: 'state', label: 'Status', noFilter: true, render: state },
            { key: 'in', label: 'Check in', noFilter: true, render: (u) => t12(u.record?.check_in) },
            { key: 'out', label: 'Check out', noFilter: true, render: (u) => t12(u.record?.check_out) },
            { key: 'hours', label: 'Hours', noFilter: true, render: (u) => dur(u.record?.worked_minutes) },
            { key: 'arrival', label: 'Arrival', noFilter: true, render: (u) => (u.record ? arrivalCell(u.record) : '—') },
            { key: 'places', label: 'Location', noFilter: true, render: (u) => (u.record ? <Places r={u.record} /> : '—') },
          ]}
          actions={(u) => (u.record
            ? <button className="action-btn" title="Correct" onClick={() => openEntry({ ...u.record, user_name: u.user_name })}><Ic name="edit" size={15} /></button>
            : <button className="action-btn" title="Add / mark leave" onClick={() => openEntry({ user_id: u.user_id, work_date: date, user_name: u.user_name })}><Ic name="plus" size={15} /></button>)}
          empty={{ icon: 'users', title: 'No people yet' }}
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Admin: every record, with export
// ---------------------------------------------------------------------------------------------
function AllRecords({ tick, users, openEntry, onChange }) {
  const [preset, setPreset] = useState('this-month');
  const [range, setRange] = useState(() => historyRange('this-month'));
  const [userId, setUserId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!range.from || !range.to) return;
    setLoading(true);
    api(`/attendance/all?from=${range.from}&to=${range.to}${userId ? '&user_id=' + userId : ''}`).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [range.from, range.to, userId, tick]);

  const rows = data?.rows || [];

  async function del(r) {
    const ok = await confirm({ title: 'Delete this entry?', message: `${r.user_name} · ${fmtDate(r.work_date)} will be removed from attendance.`, tone: 'danger', confirmText: 'Delete', icon: 'trash' });
    if (!ok) return;
    try { await api('/attendance/' + r.id, { method: 'DELETE' }); toast.success('Entry deleted'); onChange(); }
    catch (e) { toast.error(e.message || 'Could not delete'); }
  }

  function exportXlsx() {
    if (!rows.length) { toast.info('Nothing to export for this period'); return; }
    const sheet = XLSX.utils.json_to_sheet(rows.map((r) => ({
      Date: fmtDate(r.work_date), Day: dayOf(r.work_date), Person: r.user_name, Department: r.department || '',
      Status: r.status, 'Check in': hm(r.check_in), 'Check out': hm(r.check_out),
      Hours: r.worked_minutes == null ? '' : Math.round((r.worked_minutes / 60) * 100) / 100,
      Arrival: r.arrival, 'Late by (min)': r.late_by || '', Result: r.result, Note: r.note || '',
      'Check-in location': r.in_lat != null ? mapLink(r.in_lat, r.in_lng) : '', 'Check-out location': r.out_lat != null ? mapLink(r.out_lat, r.out_lng) : '',
    })));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Attendance');
    XLSX.writeFile(book, `attendance-${range.from}-to-${range.to}.xlsx`);
  }

  const summary = useMemo(() => {
    const s = { present: 0, late: 0, half: 0, away: 0 };
    rows.forEach((r) => { if (r.check_in) s.present++; if (r.arrival === 'Late') s.late++; if (r.result === 'Half day') s.half++; if (['Leave', 'Absent'].includes(r.status)) s.away++; });
    return s;
  }, [rows]);

  return (
    <>
      <div className="card card-pad report-controls" style={{ marginBottom: 14 }}>
        <div className="report-presets">
          {HISTORY_PRESETS.map((p) => (
            <button key={p.key} className={'chip-btn' + (preset === p.key ? ' active' : '')} onClick={() => { setPreset(p.key); setRange(historyRange(p.key)); }}>{p.label}</button>
          ))}
        </div>
        <div className="report-range">
          <div className="form-field"><label>From</label><DateField value={range.from} onChange={(e) => { setPreset(''); setRange((r) => ({ ...r, from: e.target.value })); }} /></div>
          <div className="form-field"><label>To</label><DateField value={range.to} onChange={(e) => { setPreset(''); setRange((r) => ({ ...r, to: e.target.value })); }} /></div>
          <div className="form-field"><label>Person</label>
            <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Everyone</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
            </Select></div>
        </div>
        <div className="report-note">{rows.length} entries · {summary.present} check-ins · {summary.late} late · {summary.half} half days · {summary.away} on leave or absent</div>
      </div>
      <div className="card">
        <DataTable
          title="All attendance"
          count={rows.length}
          loading={loading && !data}
          rows={rows}
          searchPlaceholder="Search person, note…"
          searchKeys={['user_name', 'note', 'result', 'status']}
          headerExtra={(
            <>
              <button className="btn ghost" onClick={exportXlsx}><Ic name="file-export" size={15} /> Export Excel</button>
              <button className="btn blue" onClick={() => openEntry({ work_date: new Date().toLocaleDateString('sv-SE') })}><Ic name="plus" size={15} /> Add entry</button>
            </>
          )}
          columns={[
            { key: 'work_date', label: 'Date', render: (r) => <span><b>{fmtDate(r.work_date)}</b> <span className="att-dow">{dayOf(r.work_date)}</span></span> },
            { key: 'user_name', label: 'Person' },
            { key: 'check_in', label: 'In', noFilter: true, render: (r) => t12(r.check_in) },
            { key: 'check_out', label: 'Out', noFilter: true, render: (r) => t12(r.check_out) },
            { key: 'worked_minutes', label: 'Hours', noFilter: true, render: (r) => dur(r.worked_minutes) },
            { key: 'arrival', label: 'Arrival', render: arrivalCell },
            { key: 'result', label: 'Day', render: resultCell },
            { key: 'places', label: 'Location', noFilter: true, render: (r) => <Places r={r} /> },
            { key: 'note', label: 'Note', noFilter: true, render: (r) => (r.note || '—') + (r.edited_by ? ` · edited by ${r.edited_by}` : '') },
          ]}
          actions={(r) => (
            <>
              <button className="action-btn" title="Correct" onClick={() => openEntry(r)}><Ic name="edit" size={15} /></button>
              <button className="action-btn danger" title="Delete" onClick={() => del(r)}><Ic name="trash" size={15} /></button>
            </>
          )}
          empty={{ icon: 'calendar', title: 'No attendance in this period', sub: 'Try a wider date range.' }}
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Admin: office hours
// ---------------------------------------------------------------------------------------------
function Settings({ onChange }) {
  const [f, setF] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api('/attendance/settings').then(setF).catch(() => {}); }, []);
  if (!f) return <div className="spinner">Loading…</div>;
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  async function save() {
    setSaving(true);
    try { setF(await api('/attendance/settings', { method: 'PUT', body: f })); toast.success('Office hours saved'); onChange(); }
    catch (e) { toast.error(e.message || 'Could not save'); }
    finally { setSaving(false); }
  }
  return (
    <div className="card card-pad" style={{ maxWidth: 720 }}>
      <div className="form-grid">
        <div className="form-field"><label>Office start time</label><input type="time" value={f.office_start} onChange={(e) => set('office_start', e.target.value)} /></div>
        <div className="form-field"><label>Grace period (minutes)</label><input type="number" min="0" max="240" value={f.grace_minutes} onChange={(e) => set('grace_minutes', e.target.value)} /></div>
        <div className="form-field"><label>Hours for a full day</label><input type="number" min="1" max="16" step="0.5" value={f.min_hours} onChange={(e) => set('min_hours', e.target.value)} /></div>
      </div>
      <p className="att-rule" style={{ marginTop: 14 }}>
        Checking in after {f.office_start} plus the grace period is marked <b>Late</b>. A completed day shorter than {f.min_hours} hours is marked <b>Half day</b>.
        Changing these re-reads every past day under the new rules; nothing is rewritten.
      </p>
      <div className="btn-row"><button className="btn blue" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save office hours'}</button></div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
export default function Attendance() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState('mine');
  const [tick, setTick] = useState(0);
  const [today, setToday] = useState(null);
  const [users, setUsers] = useState([]);
  const [entry, setEntry] = useState(null);   // { seed } while the add / correct dialog is open
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // The check-in card is its own small request, so it stays current whatever range the history is showing.
  useEffect(() => { api('/attendance/mine').then(setToday).catch(() => {}); }, [tick]);
  useEffect(() => { if (isAdmin) api('/users').then(setUsers).catch(() => {}); }, [isAdmin]);

  // Anyone checking in or out, or an admin correcting a day, refreshes everyone's open page.
  const timer = useRef();
  useRealtime('attendance', () => { clearTimeout(timer.current); timer.current = setTimeout(refresh, 300); });

  const tabs = [
    { key: 'mine', label: 'My attendance', icon: 'user' },
    ...(isAdmin ? [
      { key: 'board', label: 'Team today', icon: 'users' },
      { key: 'all', label: 'All records', icon: 'clipboard' },
      { key: 'settings', label: 'Office hours', icon: 'sliders' },
    ] : []),
  ];

  return (
    <div>
      <PageHeader title="Attendance" />
      <TodayCard data={today} onChange={refresh} />

      {tabs.length > 1 && (
        <div className="report-tabs" style={{ marginTop: 18 }}>
          {tabs.map((t) => (
            <button key={t.key} className={'report-tab' + (tab === t.key ? ' active' : '')} onClick={() => setTab(t.key)}>
              <Ic name={t.icon} size={17} /><span>{t.label}</span>
            </button>
          ))}
        </div>
      )}

      <div style={{ marginTop: tabs.length > 1 ? 0 : 18 }}>
        {tab === 'mine' && <MyHistory tick={tick} />}
        {tab === 'board' && isAdmin && <Board tick={tick} users={users} openEntry={(seed) => setEntry(seed)} />}
        {tab === 'all' && isAdmin && <AllRecords tick={tick} users={users} openEntry={(seed) => setEntry(seed)} onChange={refresh} />}
        {tab === 'settings' && isAdmin && <Settings onChange={refresh} />}
      </div>

      <EntryModal open={!!entry} seed={entry} users={users} onClose={() => setEntry(null)} onSaved={refresh} />
    </div>
  );
}
