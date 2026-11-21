// Admin: the nightly database backups kept on the server — list, download, take one now — and the recycle bin.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import { Ic } from '../components/Icons.jsx';

const size = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const when = (n) => { const m = /(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})/.exec(n); return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}` : n; };

// Deleted clients, policies, claims, leads, RFQs, tasks and meetings — kept 180 days, restorable.
const KIND = { clients: 'Client', policies: 'Policy', claims: 'Claim', leads: 'Lead', rfqs: 'RFQ', tasks: 'Task', meetings: 'Meeting' };
function RecycleBin() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const load = () => api('/recycle-bin').then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);
  async function restore(r) {
    try { await api('/recycle-bin/' + r.id + '/restore', { method: 'POST' }); toast.success(`${KIND[r.table_name] || 'Record'} restored`); load(); }
    catch (e) { toast.error(e.message || 'Could not restore it'); }
  }
  const list = (rows || []).filter((r) => !q || `${r.label} ${KIND[r.table_name]} ${r.deleted_by}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="card card-pad" style={{ marginTop: 18 }}>
      <div className="section-head">Recycle bin</div>
      <p className="att-rule" style={{ marginTop: 0 }}>Deleted records are kept here for 180 days. Restore puts the record back as it was — notes and files attached to it are still with it.</p>
      {rows && rows.length > 8 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search deleted records" style={{ marginBottom: 10, width: '100%' }} />}
      {rows && !rows.length && <div className="hint-line">Nothing has been deleted.</div>}
      {list.slice(0, 200).map((r) => (
        <div key={r.id} className="xsell-row">
          <div><span className="badge">{KIND[r.table_name] || r.table_name}</span> <b>{r.label || '#' + r.record_id}</b> <span className="att-dow">deleted {r.deleted_at}{r.deleted_by ? ' by ' + r.deleted_by : ''}</span></div>
          <button type="button" className="btn ghost sm" onClick={() => restore(r)}><Ic name="refresh" size={13} /> Restore</button>
        </div>
      ))}
    </div>
  );
}

// Sign-ins, users, roles, access, passwords and restores — who did what, when, from where.
function AdminLog() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => { const t = setTimeout(() => api('/admin-log?q=' + encodeURIComponent(q)).then(setRows).catch(() => setRows([])), 300); return () => clearTimeout(t); }, [q]);
  return (
    <div className="card card-pad" style={{ marginTop: 18 }}>
      <div className="section-head">Activity log</div>
      <p className="att-rule" style={{ marginTop: 0 }}>Sign-ins (and failed ones), users added, removed or switched off, role, department, access and password changes, and restores. Kept for a year.</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by person, action or user" style={{ marginBottom: 10, width: '100%' }} />
      {rows && !rows.length && <div className="hint-line">Nothing recorded yet.</div>}
      {rows && rows.length > 0 && (
        <table className="grid dense">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>About</th><th>From</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td>{r.at}</td><td>{r.actor || '—'}</td><td className={/fail|refused|removed|off/i.test(r.action) ? 'overdue-date' : ''}>{r.action}</td><td>{[r.target, r.detail].filter(Boolean).join(' · ') || '—'}</td><td className="att-dow">{r.ip || '—'}</td></tr>)}</tbody>
        </table>
      )}
    </div>
  );
}

export default function Backups() {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api('/backups').then(setD).catch(() => setD({ backups: [] }));
  useEffect(() => { load(); }, []);
  async function runNow() {
    setBusy(true);
    try { const r = await api('/backups/run', { method: 'POST' }); toast.success(`Backup taken — ${r.rows.toLocaleString('en-IN')} records`); load(); }
    catch (e) { toast.error(e.message || 'The backup failed'); }
    finally { setBusy(false); }
  }
  async function download(name) {
    try {
      const token = localStorage.getItem('wca_token');
      const r = await fetch('/api/backups/' + encodeURIComponent(name), { headers: { Authorization: 'Bearer ' + token } });
      if (!r.ok) throw new Error('Could not download it');
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
    } catch (e) { toast.error(e.message); }
  }
  return (
    <>
      <div className="card card-pad" style={{ marginTop: 18 }}>
        <div className="section-head">Backups
          <span className="pol-x-acts"><button type="button" className="btn ghost sm" onClick={runNow} disabled={busy}><Ic name="download" size={13} /> {busy ? 'Backing up…' : 'Back up now'}</button></span>
        </div>
        <p className="att-rule" style={{ marginTop: 0 }}>The whole database is backed up every night at about 2 AM and the last {d?.keep || 7} are kept on the server{d?.offsite ? ', and each one is also copied off the server automatically' : '. No off-server copy is set up yet — download one now and then, or ask for BACKUP_COPY_CMD to be set on the server'}. If a backup fails, admins get a notification.</p>
        {d && !d.backups.length && <div className="hint-line">No backups yet — the first is taken tonight, or press “Back up now”.</div>}
        {d?.backups.map((b) => (
          <div key={b.name} className="xsell-row">
            <div><b>{when(b.name)}</b> <span className="att-dow">{size(b.size)}</span></div>
            <button type="button" className="btn ghost sm" onClick={() => download(b.name)}><Ic name="download" size={13} /> Download</button>
          </div>
        ))}
      </div>
      <RecycleBin />
      <AdminLog />
    </>
  );
}
