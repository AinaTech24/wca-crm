import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import Logo from '../components/Logo.jsx';
import { Ic } from '../components/Icons.jsx';

function genCaptcha() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export default function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('WCA_ADMIN');
  const [password, setPassword] = useState('Admin@123');
  const [captcha, setCaptcha] = useState(() => genCaptcha());
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (user) navigate('/'); }, [user, navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (code !== captcha) {
      setError('Security code does not match. Please try again.');
      setCaptcha(genCaptcha());
      setCode('');
      return;
    }
    setBusy(true);
    try {
      await login(username, password);
      navigate('/');
    } catch (err) {
      setError(err.message || 'Login failed');
      setCaptcha(genCaptcha());
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-promo">
          <div className="login-brand-chip"><Logo scale={1.1} tagline={true} /></div>
          <h2>Welcome to WeCare Assurance</h2>
          <p className="sub">Insurance with Assurance — a cloud-based platform to manage policies, clients, claims and renewals.</p>

          <div className="login-feature"><span className="ic"><Ic name="shieldcheck" /></span> Secure &amp; encrypted data storage</div>
          <div className="login-feature"><span className="ic"><Ic name="cloud" /></span> Access your workspace anywhere</div>
          <div className="login-feature"><span className="ic"><Ic name="users" /></span> Manage policies and clients in one place</div>
          <div className="login-feature"><span className="ic"><Ic name="phone" /></span> Built for desktop and mobile teams</div>

          <div className="login-stats">
            <div><div className="n">15,000+</div><div className="l">Active Users</div></div>
            <div><div className="n">1CR+</div><div className="l">Policies Managed</div></div>
          </div>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <h1>Login to Your Account</h1>
          <p className="sub">Enter your credentials to access your dashboard</p>

          {error && <div className="login-err" role="alert">{error}</div>}

          <div className="field">
            <label htmlFor="username">Username</label>
            <input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder="Enter your username" required />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="password-field">
              <input
                id="password"
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Enter your password"
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPw(!showPw)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                <Ic name={showPw ? 'eyeoff' : 'eye'} size={18} />
              </button>
            </div>
          </div>

          <div className="field">
            <label htmlFor="security-code">Security verification</label>
            <div className="captcha-row">
              <span className="captcha-box" aria-label={`Security code ${captcha}`}>{captcha}</span>
              <button type="button" className="captcha-refresh" onClick={() => setCaptcha(genCaptcha())} aria-label="Generate a new security code"><Ic name="refresh" size={18} /></button>
              <input
                id="security-code"
                placeholder="Enter code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                maxLength={4}
                required
              />
            </div>
          </div>

          <button className="btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Login to Dashboard'}</button>

          <div className="login-help">Having trouble signing in? Contact your system administrator.</div>
        </form>
      </div>
    </div>
  );
}
