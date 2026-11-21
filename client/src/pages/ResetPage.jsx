// Choosing a new password from the emailed reset link. Public: the link itself is the proof.
import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import Logo from '../components/Logo.jsx';
import { api } from '../api.js';

export default function ResetPage() {
  const { token } = useParams();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (pw.length < 8) { setErr('The new password must be at least 8 characters.'); return; }
    if (pw !== pw2) { setErr('The two passwords do not match.'); return; }
    setBusy(true);
    try { await api('/password-reset/confirm', { method: 'POST', body: { token, password: pw }, auth: false }); setDone(true); }
    catch (x) { setErr(x.message || 'Could not reset the password'); }
    finally { setBusy(false); }
  }
  return (
    <div className="login-wrap">
      <div className="login-card" style={{ maxWidth: 460, gridTemplateColumns: '1fr' }}>
        <form className="login-form" onSubmit={submit}>
          <div style={{ marginBottom: 14 }}><Logo scale={1} tagline={false} /></div>
          <h1>{done ? 'Password changed' : 'Choose a new password'}</h1>
          {done ? (
            <>
              <p className="sub">Your password has been changed and any old sessions were signed out.</p>
              <Link className="btn-primary" to="/login" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>Sign in</Link>
            </>
          ) : (
            <>
              <p className="sub">At least 8 characters. The link works once.</p>
              {err && <div className="login-err" role="alert">{err}</div>}
              <div className="field"><label htmlFor="pw">New password</label><input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required /></div>
              <div className="field"><label htmlFor="pw2">Type it again</label><input id="pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required /></div>
              <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save the new password'}</button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
