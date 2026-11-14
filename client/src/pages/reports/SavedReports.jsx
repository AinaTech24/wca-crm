// Saved reports: the library (favourites first, then folders), saving the current view under a name,
// and emailing a saved report on a schedule with an Excel file attached.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import Modal from '../../components/Modal.jsx';
import Select from '../../components/Select.jsx';
import confirm from '../../components/confirm.js';
import toast from '../../components/toast.js';
import { Ic } from '../../components/Icons.jsx';
import { REPORT_TABS } from '../reportConstants.js';

const kindLabel = (k) => REPORT_TABS.find((t) => t.key === k)?.label || k;
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const when = (s) => (s ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)} ${s.slice(11, 16)}` : '');

// ---------------------------------------------------------------------------------------------
export function SaveModal({ open, onClose, initial, folders, onSave }) {
  const [f, setF] = useState({ name: '', folder: '', shared: 'private' });
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setF({ name: initial?.name || '', folder: initial?.folder || '', shared: initial?.shared || 'private' }); }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  async function save() {
    setSaving(true);
    try { await onSave(f); onClose(); }
    catch (e) { toast.error(e.message || 'Could not save the report'); }
    finally { setSaving(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title={initial?.id ? 'Rename or move this report' : 'Save this report'}
      subtitle={initial?.id ? '' : 'Saves the report, period, grouping, filters and chart as they are now'} icon="star" size="md"
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn blue" onClick={save} disabled={saving || !f.name.trim()}>{saving ? 'Saving…' : 'Save'}</button></>}>
      {open && (
        <div className="form-grid two">
          <div className="form-field" style={{ gridColumn: '1 / -1' }}><label>Name <span className="req">*</span></label>
            <input autoFocus value={f.name} maxLength={120} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Motor renewals due this month" /></div>
          <div className="form-field"><label>Folder</label>
            <input list="rep-folders" value={f.folder} maxLength={60} onChange={(e) => set('folder', e.target.value)} placeholder="e.g. Renewals — or leave empty" />
            <datalist id="rep-folders">{folders.map((x) => <option key={x} value={x} />)}</datalist></div>
          <div className="form-field"><label>Who can see it</label>
            <Select value={f.shared} onChange={(e) => set('shared', e.target.value)}>
              <option value="private">Only me</option>
              <option value="everyone">Everyone</option>
            </Select></div>
          <p className="att-rule" style={{ gridColumn: '1 / -1', margin: 0 }}>A named period such as “This month” moves with the calendar each time the report is opened or emailed. People who open a shared report still see only their own department’s records.</p>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
export function ScheduleModal({ report, onClose, onChanged }) {
  const blank = { frequency: 'weekly', weekday: 1, monthday: 1, send_time: '09:00', recipients: '' };
  const [f, setF] = useState(blank);
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState('');
  useEffect(() => { if (report) { setList(report.schedules || []); setF(blank); } }, [report]);   // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  async function add() {
    setBusy('add');
    try {
      const s = await api(`/report-library/${report.id}/schedules`, { method: 'POST', body: f });
      setList((l) => [...l, s]); setF(blank); toast.success(`Scheduled — ${s.describe}`); onChanged();
    } catch (e) { toast.error(e.message || 'Could not schedule it'); }
    finally { setBusy(''); }
  }
  async function toggle(s) {
    try {
      const n = await api(`/report-schedules/${s.id}`, { method: 'PUT', body: { active: !s.active } });
      setList((l) => l.map((x) => (x.id === s.id ? n : x))); onChanged();
    } catch (e) { toast.error(e.message || 'Could not change it'); }
  }
  async function remove(s) {
    const ok = await confirm({ title: 'Stop this schedule?', message: `${s.describe} to ${s.recipients}`, tone: 'danger', confirmText: 'Delete', icon: 'trash' });
    if (!ok) return;
    try { await api(`/report-schedules/${s.id}`, { method: 'DELETE' }); setList((l) => l.filter((x) => x.id !== s.id)); onChanged(); }
    catch (e) { toast.error(e.message || 'Could not delete it'); }
  }
  async function sendNow(s) {
    setBusy('send' + s.id);
    try { const r = await api(`/report-schedules/${s.id}/send-now`, { method: 'POST' }); toast.success(`Sent to ${r.to}`); onChanged(); }
    catch (e) { toast.error(e.message || 'Could not send it'); }
    finally { setBusy(''); }
  }

  return (
    <Modal open={!!report} onClose={onClose} title="Email this report on a schedule" subtitle={report ? `${report.name} · ${kindLabel(report.kind)}` : ''} icon="mail" size="lg"
      footer={<button className="btn ghost" onClick={onClose}>Done</button>}>
      {report && (
        <>
          {list.length > 0 && (
            <div className="sched-list">
              {list.map((s) => (
                <div key={s.id} className={'sched-row' + (s.active ? '' : ' off')}>
                  <div className="sched-main">
                    <b>{s.describe}</b>
                    <span className="sched-to"><Ic name="mail" size={12} /> {s.recipients}</span>
                    <span className="sched-meta">
                      {s.active ? <>Next: {when(s.next_run)}</> : 'Paused'}
                      {s.last_run_at && <> · Last: {when(s.last_run_at)} — {s.last_status}</>}
                    </span>
                  </div>
                  <div className="sched-acts">
                    <button className="btn ghost sm" onClick={() => sendNow(s)} disabled={busy === 'send' + s.id}>{busy === 'send' + s.id ? 'Sending…' : 'Send now'}</button>
                    <button className="btn ghost sm" onClick={() => toggle(s)}>{s.active ? 'Pause' : 'Resume'}</button>
                    <button className="action-btn danger" title="Delete" onClick={() => remove(s)}><Ic name="trash" size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="section-head" style={{ marginTop: list.length ? 16 : 0 }}>Add a schedule</div>
          <div className="form-grid">
            <div className="form-field"><label>How often</label>
              <Select value={f.frequency} onChange={(e) => set('frequency', e.target.value)}>
                <option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option>
              </Select></div>
            {f.frequency === 'weekly' && (
              <div className="form-field"><label>On</label>
                <Select value={String(f.weekday)} onChange={(e) => set('weekday', Number(e.target.value))}>
                  {WEEKDAYS.map((d, i) => <option key={d} value={String(i + 1)}>{d}</option>)}
                </Select></div>
            )}
            {f.frequency === 'monthly' && (
              <div className="form-field"><label>Day of the month</label>
                <input type="number" min="1" max="31" value={f.monthday} onChange={(e) => set('monthday', Number(e.target.value))} /></div>
            )}
            <div className="form-field"><label>Time (India)</label><input type="time" value={f.send_time} onChange={(e) => set('send_time', e.target.value)} /></div>
            <div className="form-field" style={{ gridColumn: '1 / -1' }}><label>Send to <span className="req">*</span></label>
              <input value={f.recipients} onChange={(e) => set('recipients', e.target.value)} placeholder="nishith@wcfw.in, accounts@wcfw.in" /></div>
          </div>
          <p className="att-rule" style={{ margin: '10px 0 0' }}>
            The email has the figures in it, an Excel file with the summary and every record, and a link back to the report. It goes out from your
            mailbox, with your department access, and, like all CRM mail, with the admin in copy.
          </p>
          <div className="btn-row" style={{ marginTop: 12 }}><button className="btn blue" onClick={add} disabled={busy === 'add' || !f.recipients.trim()}>{busy === 'add' ? 'Saving…' : 'Add schedule'}</button></div>
        </>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
export function LibraryModal({ open, onClose, library, onOpenReport, onEdit, onSchedule, onChanged, currentId }) {
  const [q, setQ] = useState('');
  const reports = library?.reports || [];
  const shown = reports.filter((r) => !q || `${r.name} ${r.folder} ${kindLabel(r.kind)} ${r.owner_name}`.toLowerCase().includes(q.toLowerCase()));
  const groups = useMemo(() => {
    const g = [];
    const favs = shown.filter((r) => r.fav);
    if (favs.length) g.push({ name: 'Favourites', icon: 'star', items: favs });
    const by = {};
    for (const r of shown) (by[r.folder || ''] ||= []).push(r);
    for (const k of Object.keys(by).sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))) g.push({ name: k || 'No folder', icon: 'box', items: by[k] });
    return g;
  }, [shown]);

  async function fav(r) {
    try { await api(`/report-library/${r.id}/favourite`, { method: 'POST', body: { on: !r.fav } }); onChanged(); }
    catch (e) { toast.error(e.message || 'Could not change it'); }
  }
  async function del(r) {
    const ok = await confirm({ title: 'Delete this saved report?', message: `“${r.name}”${r.schedules.length ? ' and its email schedules' : ''} will be removed${r.shared === 'everyone' ? ' for everyone' : ''}.`, tone: 'danger', confirmText: 'Delete', icon: 'trash' });
    if (!ok) return;
    try { await api(`/report-library/${r.id}`, { method: 'DELETE' }); toast.success('Report deleted'); onChanged(); }
    catch (e) { toast.error(e.message || 'Could not delete it'); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Saved reports" subtitle="Yours, and the ones shared with everyone" icon="star" size="lg"
      footer={<button className="btn ghost" onClick={onClose}>Close</button>}>
      <div className="dt-search" style={{ marginBottom: 12 }}>
        <span className="dt-search-ic"><Ic name="search" size={16} /></span>
        <input placeholder="Search saved reports…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!library && <div className="no-data">Loading…</div>}
      {library && !reports.length && <div className="no-data">No saved reports yet. Set a report up the way you like it and press “Save”.</div>}
      {groups.map((g) => (
        <div key={g.name} className="lib-group">
          <div className="lib-group-h"><Ic name={g.icon} size={14} /> {g.name} <span>{g.items.length}</span></div>
          {g.items.map((r) => (
            <div key={g.name + r.id} className={'lib-row' + (r.id === currentId ? ' current' : '')}>
              <button type="button" className={'lib-star' + (r.fav ? ' on' : '')} onClick={() => fav(r)} title={r.fav ? 'Remove from favourites' : 'Add to favourites'}>
                <Ic name="star" size={15} />
              </button>
              <button type="button" className="lib-main" onClick={() => { onOpenReport(r); onClose(); }}>
                <span className="lib-name">{r.name}</span>
                <span className="lib-meta">
                  {kindLabel(r.kind)} · {r.mine ? 'You' : r.owner_name}{r.shared === 'everyone' ? ' · shared with everyone' : ' · only you'}
                  {r.schedules.some((s) => s.active) && <> · <Ic name="mail" size={11} /> emailed</>}
                </span>
              </button>
              <div className="lib-acts">
                {r.can_edit && <button className="action-btn" title="Email on a schedule" onClick={() => onSchedule(r)}><Ic name="mail" size={14} /></button>}
                {r.can_edit && <button className="action-btn" title="Rename, move or share" onClick={() => onEdit(r)}><Ic name="edit" size={14} /></button>}
                {r.can_edit && <button className="action-btn danger" title="Delete" onClick={() => del(r)}><Ic name="trash" size={14} /></button>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </Modal>
  );
}
