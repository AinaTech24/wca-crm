import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import Select from '../components/Select.jsx';
import Toggle from '../components/Toggle.jsx';
import { Ic } from '../components/Icons.jsx';
import toast from '../components/toast.js';

const STORE = 'wca_company_profile';
const BIRTHDAY_IMAGES = ['Birthday1.jpg', 'Birthday2.jpg', 'Birthday3.jpg'];
const ANNIVERSARY_IMAGES = ['Anniversary1.jpg', 'Anniversary2.jpg', 'Anniversary3.jpg'];

const DEFAULTS = {
  name: 'WeCare Assurance',
  address1: 'Insurance, Investment & Financing for Individuals, Institutes & Industries',
  address2: 'Novem Square, Office No. 307-308, Third Floor, 150 Feet Ring Road',
  city: 'Rajkot', pincode: '360005', state: 'Gujarat', country: 'INDIA',
  email1: 'support@wecareassurance.in', email2: '', phone1: '9409016849', phone2: '',
  logo: '',
  autoPolicy: false, autoBirthday: false, autoAnniversary: false,
  birthdayImg: 'Birthday1.jpg', anniversaryImg: 'Anniversary1.jpg',
};

// SMTP password / WhatsApp access token are saved and read entirely
// server-side (see /api/integration-settings) — never stored in localStorage
// and never echoed back by the server, so these fields start blank on every
// load; hasSmtpPass/hasWaToken just tell us whether one is already on file.
const INTEGRATION_DEFAULTS = {
  emailEnabled: false, smtpHost: '', smtpPort: '587', smtpSecure: 'TLS', smtpUser: '', smtpPass: '', smtpFromName: '', smtpFromEmail: '', hasSmtpPass: false,
  autoMailEnabled: false,
  waEnabled: false, waProvider: 'WhatsApp Business API', waPhoneId: '', waBusinessId: '', waToken: '', hasWaToken: false,
  // Vartify — the token is write-only, like every other secret here.
  waVartifyToken: '', waVartifyBase: 'https://vartify.in/api/v1', hasVartifyToken: false,
  hasWebhookSecret: false, waWebhookId: '',
};

function load() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE) || '{}')) }; }
  catch { return { ...DEFAULTS }; }
}

function loadIntegrationSettings() {
  return api('/integration-settings').then((data) => ({ ...INTEGRATION_DEFAULTS, ...data, smtpPass: '', waToken: '', waVartifyToken: '' }));
}

// Decorative placeholder preview for the greeting images (no binary assets).
function GreetingPreview({ kind, name }) {
  const grad = kind === 'birthday'
    ? 'linear-gradient(150deg, #3b2a80, #6d4bd6 60%, #b06fe0)'
    : 'linear-gradient(150deg, #cfe0f5, #8bb6dc 70%, #6d9fd0)';
  return (
    <div className="greeting-preview" style={{ background: grad }}>
      <Ic name={kind === 'birthday' ? 'gift' : 'star'} size={26} />
      <span className="greeting-title">{kind === 'birthday' ? 'Happy Birthday' : 'Happy Anniversary'}</span>
      <span className="greeting-file">{name}</span>
    </div>
  );
}

export default function MyProfile() {
  const { user, updateSession } = useAuth();
  const [p, setP] = useState(load);
  const [s, setS] = useState(INTEGRATION_DEFAULTS);
  const [account, setAccount] = useState({ full_name: user?.name || '', username: user?.username || '', email: '' });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [waAccount, setWaAccount] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => { localStorage.setItem(STORE, JSON.stringify(p)); }, [p]);
  useEffect(() => { loadIntegrationSettings().then(setS).catch(() => {}); }, []);
  // The session only carries the name, so the address is read from the server.
  const loadEmail = () => api('/me').then((me) => setAccount((a) => ({ ...a, email: me.email || '' }))).catch(() => {});
  useEffect(() => { loadEmail(); }, []);

  const set = (k, v) => setP((prev) => ({ ...prev, [k]: v }));
  const setInt = (k, v) => setS((prev) => ({ ...prev, [k]: v }));
  const setAcct = (k, v) => setAccount((prev) => ({ ...prev, [k]: v }));

  function onLogo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please choose an image file'); return; }
    const reader = new FileReader();
    reader.onload = () => set('logo', reader.result);
    reader.readAsDataURL(file);
  }

  async function save() {
    if (!p.name.trim()) { toast.error('Name is required'); return; }
    if (!account.full_name.trim()) { toast.error('Full name is required'); return; }
    if (!account.username.trim()) { toast.error('Username is required'); return; }
    setSaving(true);
    localStorage.setItem(STORE, JSON.stringify(p));
    try {
      const data = await api('/me', { method: 'PUT', body: { full_name: account.full_name.trim(), username: account.username.trim(), email: account.email.trim() } });
      updateSession(data); // reissues the session token so the rename is live immediately, not just after next login
      await api('/integration-settings', { method: 'PUT', body: s });
      // Blank out the secret fields again and remember they're now on file,
      // so a second save without retyping them doesn't accidentally clear them.
      setS((prev) => ({
        ...prev, smtpPass: '', waToken: '', waVartifyToken: '',
        hasSmtpPass: prev.hasSmtpPass || !!prev.smtpPass,
        hasWaToken: prev.hasWaToken || !!prev.waToken,
        hasVartifyToken: prev.hasVartifyToken || !!prev.waVartifyToken,
      }));
      toast.success('Profile updated');
    } catch (e) {
      toast.error(e.message || 'Could not save profile');
    } finally {
      setSaving(false);
    }
  }
  const isVartify = s.waProvider === 'Vartify';
  const webhookUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/whatsapp/webhook` : '/api/whatsapp/webhook';

  // Both actions read the *saved* settings server-side, so the token has to
  // be saved before they can work.
  async function testVartify() {
    setTesting(true); setWaAccount(null);
    try {
      const acc = await api('/whatsapp/account');
      setWaAccount(acc?.data || acc || {});
      toast.success('Vartify connection is working');
    } catch (e) {
      toast.error(e.message || 'Could not reach Vartify — save the token first, then retry.');
    } finally { setTesting(false); }
  }

  async function registerWebhook() {
    setTesting(true);
    try {
      const r = await api('/whatsapp/register-webhook', { method: 'POST', body: { url: webhookUrl } });
      setS((prev) => ({ ...prev, hasWebhookSecret: !!r.storedSecret, waWebhookId: String(r.id || '') }));
      toast.success(r.storedSecret ? 'Webhook registered — replies will now reach the CRM' : 'Webhook registered, but no secret was returned');
    } catch (e) {
      toast.error(e.message || 'Could not register the webhook');
    } finally { setTesting(false); }
  }

  function cancel() {
    setP(load());
    setAccount({ full_name: user?.name || '', username: user?.username || '', email: '' });
    loadEmail();
    loadIntegrationSettings().then(setS).catch(() => {});
    toast.info('Changes discarded');
  }

  return (
    <div>
      <PageHeader title="My Profile" />

      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="section-head">Account</div>
        <div className="form-grid">
          <div className="form-field"><label>Full Name <span className="req">*</span></label><input value={account.full_name} onChange={(e) => setAcct('full_name', e.target.value)} /></div>
          <div className="form-field"><label>Username <span className="req">*</span></label><input value={account.username} onChange={(e) => setAcct('username', e.target.value)} /></div>
          <div className="form-field"><label>Email</label><input type="email" value={account.email} onChange={(e) => setAcct('email', e.target.value)} placeholder="you@wecareassurance.com" autoComplete="off" /></div>
          <div className="form-field"><label>Role</label><input value={user?.role || 'Administrator'} readOnly /></div>
        </div>
        <div className="hint-line">Your own address. Every email sent on your behalf — including the automatic ones — goes out from your mailbox only, never anyone else's.</div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="section-head">Company / Business Profile</div>
        <div className="form-grid">
          <div className="form-field"><label>Name <span className="req">*</span></label><input value={p.name} onChange={(e) => set('name', e.target.value)} /></div>
          <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Address Line 1</label><input value={p.address1} onChange={(e) => set('address1', e.target.value)} /></div>
          <div className="form-field" style={{ gridColumn: 'span 2' }}><label>Address Line 2</label><input value={p.address2} onChange={(e) => set('address2', e.target.value)} /></div>
          <div className="form-field"><label>City</label><input value={p.city} onChange={(e) => set('city', e.target.value)} /></div>
          <div className="form-field"><label>Pincode</label><input value={p.pincode} onChange={(e) => set('pincode', e.target.value)} /></div>
          <div className="form-field"><label>State</label><input value={p.state} onChange={(e) => set('state', e.target.value)} /></div>
          <div className="form-field"><label>Country</label><input value={p.country} onChange={(e) => set('country', e.target.value)} /></div>
          <div className="form-field"><label>Email Id 1</label><input value={p.email1} onChange={(e) => set('email1', e.target.value)} placeholder="Email Id 1" /></div>
          <div className="form-field"><label>Email Id 2</label><input value={p.email2} onChange={(e) => set('email2', e.target.value)} placeholder="Email Id 2" /></div>
          <div className="form-field"><label>Contact Number 1</label><input value={p.phone1} onChange={(e) => set('phone1', e.target.value)} placeholder="Contact Number" /></div>
          <div className="form-field"><label>Contact Number 2</label><input value={p.phone2} onChange={(e) => set('phone2', e.target.value)} placeholder="Contact Number" /></div>
        </div>

        <div className="form-field" style={{ marginTop: 16 }}>
          <label>Logo</label>
          <div className="logo-row">
            <div className="logo-preview">
              {p.logo ? <img src={p.logo} alt="Company logo" /> : <span className="logo-empty"><Ic name="building" size={22} /></span>}
            </div>
            <div className="logo-actions">
              <button type="button" className="icon-btn edit" title="Change logo" onClick={() => fileRef.current?.click()}><Ic name="edit" size={15} /></button>
              {p.logo && <button type="button" className="icon-btn danger" title="Remove logo" onClick={() => set('logo', '')}><Ic name="trash" size={15} /></button>}
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onLogo} />
          </div>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="section-head">
          <span>Email Integration</span>
          <label className="im-rec" style={{ textTransform: 'none', letterSpacing: 'normal', fontWeight: 650, marginLeft: 'auto' }}>
            <Toggle checked={s.emailEnabled} onChange={(v) => setInt('emailEnabled', v)} label="Enable email integration" /> Enabled
          </label>
        </div>
        <div className="form-grid">
          <div className="form-field"><label>SMTP Host</label><input value={s.smtpHost} onChange={(e) => setInt('smtpHost', e.target.value)} placeholder="smtp.example.com" /></div>
          <div className="form-field"><label>SMTP Port</label><input value={s.smtpPort} onChange={(e) => setInt('smtpPort', e.target.value)} placeholder="587" /></div>
          <div className="form-field"><label>Security</label>
            <Select value={s.smtpSecure} onChange={(e) => setInt('smtpSecure', e.target.value)}><option>TLS</option><option>SSL</option><option>None</option></Select>
          </div>
          <div className="form-field"><label>Username</label><input value={s.smtpUser} onChange={(e) => setInt('smtpUser', e.target.value)} placeholder="user@example.com" /></div>
          <div className="form-field">
            <label>Password / App Key</label>
            <input type="password" value={s.smtpPass} onChange={(e) => setInt('smtpPass', e.target.value)} placeholder={s.hasSmtpPass ? 'Saved — leave blank to keep' : ''} autoComplete="new-password" />
          </div>
          <div className="form-field"><label>From Name</label><input value={s.smtpFromName} onChange={(e) => setInt('smtpFromName', e.target.value)} placeholder={p.name} /></div>
          <div className="form-field"><label>From Email</label><input value={s.smtpFromEmail} onChange={(e) => setInt('smtpFromEmail', e.target.value)} placeholder={account.email || p.email1} /></div>
        </div>

        <div className="switch-row" style={{ marginTop: 14 }}>
          <span className="sr-label">Send automatic emails</span>
          <Toggle checked={s.autoMailEnabled} onChange={(v) => setInt('autoMailEnabled', v)} label="Send automatic emails" />
        </div>
        <div className="hint-line">
          Sends the acknowledgements, welcome notes, policy documents and renewal reminders listed under
          Email Template — to real customers, on their own. Read those templates before switching this on.
          Off by default; everything else on this page keeps working either way.
          These go out from this mailbox, for the records you create or look after. A teammate who has not set
          up their own mailbox sends nothing — it is logged as skipped rather than borrowing yours.
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="section-head">
          <span>WhatsApp Integration</span>
          <label className="im-rec" style={{ textTransform: 'none', letterSpacing: 'normal', fontWeight: 650, marginLeft: 'auto' }}>
            <Toggle checked={s.waEnabled} onChange={(v) => setInt('waEnabled', v)} label="Enable WhatsApp integration" /> Enabled
          </label>
        </div>
        <div className="form-grid">
          <div className="form-field"><label>Provider</label>
            <Select value={s.waProvider} onChange={(e) => setInt('waProvider', e.target.value)}>
              <option>Vartify</option><option>WhatsApp Business API</option><option>Twilio</option><option>Gupshup</option>
            </Select>
          </div>
          <div className="form-field" /><div className="form-field" />
        </div>

        {/* Vartify talks to WhatsApp on our behalf, so it needs an API token
            rather than Meta phone/business ids. */}
        {isVartify ? (
          <>
            <div className="form-grid">
              <div className="form-field" style={{ gridColumn: 'span 2' }}>
                <label>Vartify API Token</label>
                <input type="password" value={s.waVartifyToken} onChange={(e) => setInt('waVartifyToken', e.target.value)}
                  placeholder={s.hasVartifyToken ? 'Saved — leave blank to keep' : 'Paste the token from Vartify → Settings → API Tokens'} autoComplete="new-password" />
                <div className="hint-line">
                  Needs the scopes <code>contacts:read</code>, <code>contacts:write</code>, <code>messages:write</code>, <code>conversations:read</code>.
                  The token is shown once in Vartify — copy it before closing that screen.
                </div>
              </div>
              <div className="form-field"><label>API Base URL</label>
                <input value={s.waVartifyBase} onChange={(e) => setInt('waVartifyBase', e.target.value)} placeholder="https://vartify.in/api/v1" /></div>
            </div>

            <div className="btn-row" style={{ marginTop: 12 }}>
              <button type="button" className="btn ghost sm" onClick={testVartify} disabled={testing}>
                <Ic name="cloud" size={14} /> {testing ? 'Checking…' : 'Test Connection'}
              </button>
              <button type="button" className="btn ghost sm" onClick={registerWebhook} disabled={testing}>
                <Ic name="send" size={14} /> {s.hasWebhookSecret ? 'Re-register Webhook' : 'Register Webhook'}
              </button>
            </div>
            {waAccount && <div className="hint-line" style={{ color: 'var(--success)' }}>Connected{waAccount.name ? ` — ${waAccount.name}` : ''}.</div>}
            <div className="hint-line">
              Replies are received at <code>{webhookUrl}</code>. Registering stores the signing secret so
              inbound events can be verified — without it, replies won't reach the CRM.
              {s.hasWebhookSecret ? ' A secret is on file.' : ' No secret on file yet.'}
            </div>
          </>
        ) : (
          <div className="form-grid">
            <div className="form-field"><label>Phone Number ID</label><input value={s.waPhoneId} onChange={(e) => setInt('waPhoneId', e.target.value)} /></div>
            <div className="form-field"><label>Business Account ID</label><input value={s.waBusinessId} onChange={(e) => setInt('waBusinessId', e.target.value)} /></div>
            <div className="form-field" />
            <div className="form-field" style={{ gridColumn: 'span 2' }}>
              <label>Access Token</label>
              <input type="password" value={s.waToken} onChange={(e) => setInt('waToken', e.target.value)} placeholder={s.hasWaToken ? 'Saved — leave blank to keep' : ''} autoComplete="new-password" />
            </div>
          </div>
        )}
      </div>

      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="section-head">WhatsApp Auto Scheduler Setup</div>
        <div className="scheduler-toggles">
          <label className="sched-toggle"><Toggle checked={p.autoPolicy} onChange={(v) => set('autoPolicy', v)} label="Auto Policy Copy Send" /><span>Auto Policy Copy Send</span></label>
          <label className="sched-toggle"><Toggle checked={p.autoBirthday} onChange={(v) => set('autoBirthday', v)} label="Auto Birthday Send" /><span>Auto Birthday Send</span></label>
          <label className="sched-toggle"><Toggle checked={p.autoAnniversary} onChange={(v) => set('autoAnniversary', v)} label="Auto Anniversary Send" /><span>Auto Anniversary Send</span></label>
        </div>

        <div className="form-grid two" style={{ marginTop: 22 }}>
          <div className="form-field">
            <label>Birthday Default Image</label>
            <Select value={p.birthdayImg} onChange={(e) => set('birthdayImg', e.target.value)}>
              {BIRTHDAY_IMAGES.map((f) => <option key={f} value={f}>{f}</option>)}
            </Select>
            <GreetingPreview kind="birthday" name={p.birthdayImg} />
          </div>
          <div className="form-field">
            <label>Anniversary Default Image</label>
            <Select value={p.anniversaryImg} onChange={(e) => set('anniversaryImg', e.target.value)}>
              {ANNIVERSARY_IMAGES.map((f) => <option key={f} value={f}>{f}</option>)}
            </Select>
            <GreetingPreview kind="anniversary" name={p.anniversaryImg} />
          </div>
        </div>
      </div>

      <div className="btn-row">
        <button className="btn blue" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Update'}</button>
        <button className="btn ghost" onClick={cancel}>Cancel</button>
      </div>
    </div>
  );
}
