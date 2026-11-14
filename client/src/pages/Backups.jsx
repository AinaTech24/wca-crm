// Admin: the nightly database backups kept on the server — list, download, take one now.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import { Ic } from '../components/Icons.jsx';

const size = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const when = (n) => { const m = /(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})/.exec(n); return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}` : n; };

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
    <div className="card card-pad" style={{ marginTop: 18 }}>
      <div className="section-head">Backups
        <span className="pol-x-acts"><button type="button" className="btn ghost sm" onClick={runNow} disabled={busy}><Ic name="download" size={13} /> {busy ? 'Backing up…' : 'Back up now'}</button></span>
      </div>
      <p className="att-rule" style={{ marginTop: 0 }}>The whole database is backed up every night at about 2 AM and the last {d?.keep || 7} are kept on the server. Download one now and then to keep a copy off the server too.</p>
      {d && !d.backups.length && <div className="hint-line">No backups yet — the first is taken tonight, or press “Back up now”.</div>}
      {d?.backups.map((b) => (
        <div key={b.name} className="xsell-row">
          <div><b>{when(b.name)}</b> <span className="att-dow">{size(b.size)}</span></div>
          <button type="button" className="btn ghost sm" onClick={() => download(b.name)}><Ic name="download" size={13} /> Download</button>
        </div>
      ))}
    </div>
  );
}
