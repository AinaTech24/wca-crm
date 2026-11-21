// The client's own page for checking the insurer's proposal: open the PDF, then confirm it in one click or say
// what needs correcting. Public — reached only through the private link in the proposal email. The confirmation
// is recorded on the policy issuance with the date and time.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { brandLogo } from '../components/Logo.jsx';
import { Ic } from '../components/Icons.jsx';

const BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '');
async function call(path, opts = {}) {
  const r = await fetch(BASE + path, { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong — please try again');
  return j;
}

export default function ProposalPage() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [done, setDone] = useState('');
  useEffect(() => { call('/public/proposal/' + token).then(setD).catch((e) => setErr(e.message)); }, [token]);

  async function openPdf() {
    try {
      const f = await call(`/public/proposal/${token}/file`);
      const blob = await (await fetch(f.data)).blob();
      const pdf = /pdf|image/.test(blob.type) ? blob : new Blob([blob], { type: 'application/octet-stream' });
      const u = URL.createObjectURL(pdf);
      const a = document.createElement('a'); a.href = u; a.target = '_blank'; a.rel = 'noopener';
      if (!/pdf|image/.test(blob.type)) a.download = f.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 60000);
    } catch (e) { setErr(e.message); }
  }
  async function act(action) {
    setBusy(true);
    try { await call('/public/proposal/' + token, { method: 'POST', body: { action, note } }); setDone(action); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const header = <header className="ob-top"><img src={brandLogo} alt="WeCare Assurance" /><span>Insurance with Assurance</span></header>;
  if (err && !d) return <div className="ob-page">{header}<div className="ob-card ob-msg"><Ic name="alert" size={30} /><h2>Link not available</h2><p>{err}</p></div></div>;
  if (!d) return <div className="ob-page">{header}<div className="ob-card ob-msg"><p>Loading…</p></div></div>;
  if (done || d.issued) return (
    <div className="ob-page">{header}
      <div className="ob-card ob-msg ok">
        <span className="ob-tick"><Ic name="check" size={34} /></span>
        <h2>{done === 'change' ? 'Thank you — we will get it corrected' : done === 'confirm' ? 'Thank you — proposal confirmed' : 'Your policy is issued'}</h2>
        <p>{done === 'change' ? 'We have passed your correction to the insurer and will send you the corrected proposal.' : done === 'confirm' ? 'We will now take your policy forward with the insurer and keep you updated.' : 'There is nothing more to do here.'}</p>
      </div>
    </div>
  );
  return (
    <div className="ob-page">{header}
      <div className="ob-card">
        <h1 className="ob-pv-title" style={{ marginTop: 0 }}>Please check your proposal</h1>
        <p>Dear {d.client_name}, {d.insurer} has prepared the proposal form for your <b>{d.product}</b>. Please open it and check your name, date of birth, address, nominee and the other details carefully.</p>
        {d.confirmed_at && <p className="ob-help"><Ic name="check" size={13} /> You confirmed this proposal on {d.confirmed_at}.</p>}
        {d.change_note && !d.confirmed_at && <p className="ob-help"><Ic name="alert" size={13} /> You asked for: “{d.change_note}”. A corrected proposal will follow.</p>}
        <button type="button" className="btn ghost" onClick={openPdf}><Ic name="file" size={15} /> Open the proposal{d.version ? ` (version ${d.version})` : ''}</button>
        {!asking ? (
          <div className="btn-row" style={{ marginTop: 18 }}>
            {!d.confirmed_at && <button type="button" className="btn blue" disabled={busy} onClick={() => act('confirm')}><Ic name="check" size={15} /> Everything is correct — confirm</button>}
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setAsking(true)}>Something needs correcting</button>
          </div>
        ) : (
          <div style={{ marginTop: 18 }}>
            <label className="ob-label">What needs to be corrected?</label>
            <textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. My date of birth should be 12-03-1985, and the nominee is my wife Priya" style={{ width: '100%' }} />
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button type="button" className="btn ghost" onClick={() => setAsking(false)}>Back</button>
              <button type="button" className="btn blue" disabled={busy || !note.trim()} onClick={() => act('change')}>Send the correction</button>
            </div>
          </div>
        )}
        {err && <p className="ob-err" style={{ marginTop: 10 }}>{err}</p>}
      </div>
    </div>
  );
}
