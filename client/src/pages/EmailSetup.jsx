import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import toast from '../components/toast.js';
import confirm from '../components/confirm.js';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';
import Select from '../components/Select.jsx';
import Toggle from '../components/Toggle.jsx';
import { Ic } from '../components/Icons.jsx';
import { MAIL_PRESETS, presetOf } from './mailPresets.js';

// The addresses the office sends from. Each one is a mailbox in its own right — its own mail
// server, login and password — and is used for the RFQ categories ticked against it: mail about
// a motor RFQ goes out from motor.support@..., logged in as that mailbox, not as whoever pressed
// the button and not through a shared mailbox. A category with no address set up still goes out
// from the person's own address.

const blank = () => {
  const p = MAIL_PRESETS[2];   // Microsoft 365: the office's own mail is there
  return { email: '', display_name: '', categories: [], is_active: true, smtpHost: p.host, smtpPort: p.port, smtpSecure: p.secure, smtpUser: '', smtpPass: '', hasPass: false };
};

export default function EmailSetup() {
  const [data, setData] = useState(null);           // { accounts, categories, ms365 }
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);           // { id?, values } — null when closed
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(null);     // { acct, to, busy, result }

  function load() {
    api('/mail-accounts').then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message || 'Could not load'));
  }
  useEffect(load, []);

  // Which address each category currently sends from.
  const routing = useMemo(() => {
    const map = {};
    for (const a of data?.accounts || []) if (a.is_active) for (const c of a.categories) map[c] = a.email;
    return map;
  }, [data]);
  // Active addresses that cannot send yet, because they have no login of their own.
  const stuck = (data?.accounts || []).filter((a) => a.is_active && a.categories.length && a.mailbox !== 'own' && !data.ms365);

  function openAdd() { setForm({ values: blank() }); }
  function openEdit(a) {
    setForm({ id: a.id, values: { email: a.email, display_name: a.display_name, categories: [...a.categories], is_active: a.is_active, smtpHost: a.smtpHost || MAIL_PRESETS[2].host, smtpPort: a.smtpPort || '587', smtpSecure: a.smtpSecure || 'TLS', smtpUser: a.smtpUser || a.email, smtpPass: '', hasPass: a.hasPass } });
  }
  const setV = (k, v) => setForm((f) => ({ ...f, values: { ...f.values, [k]: v } }));

  async function save() {
    setSaving(true);
    try {
      const { hasPass, ...body } = form.values;
      await api(form.id ? '/mail-accounts/' + form.id : '/mail-accounts', { method: form.id ? 'PUT' : 'POST', body });
      toast.success(form.id ? 'Saved' : 'Address added');
      setForm(null); load();
    } catch (e) { toast.error(e.message || 'Could not save'); }
    finally { setSaving(false); }
  }
  async function toggleActive(a, on) {
    try { await api('/mail-accounts/' + a.id, { method: 'PUT', body: { is_active: on } }); load(); }
    catch (e) { toast.error(e.message || 'Could not change it'); }
  }
  async function remove(a) {
    const ok = await confirm({
      title: 'Remove ' + a.email + '?',
      message: a.categories.length ? a.categories.join(', ') + ' will go back to sending from each person\'s own address. Its saved login is deleted.' : 'Its saved login is deleted.',
      tone: 'danger', confirmText: 'Remove', icon: 'trash',
    });
    if (!ok) return;
    try { await api('/mail-accounts/' + a.id, { method: 'DELETE' }); toast.success('Removed'); load(); }
    catch (e) { toast.error(e.message || 'Could not remove'); }
  }
  async function runTest() {
    setTesting((t) => ({ ...t, busy: true, result: null }));
    try {
      const r = await api('/mail-accounts/' + testing.acct.id + '/test', { method: 'POST', body: { to: testing.to } });
      setTesting((t) => ({ ...t, busy: false, result: r }));
    } catch (e) { setTesting((t) => ({ ...t, busy: false, result: { ok: false, error: e.message || 'Test failed' } })); }
  }

  // A category held by another active address cannot be ticked here.
  const heldByOther = (cat) => (data?.accounts || []).find((a) => a.is_active && a.id !== form?.id && a.categories.includes(cat));
  const preset = form ? MAIL_PRESETS.find((p) => p.label === presetOf(form.values.smtpHost)) : null;

  return (
    <div>
      <PageHeader title="Email Setup" action={<button className="btn blue" onClick={openAdd}><Ic name="plus" size={16} /> Add email</button>} />

      {error && <div className="card card-pad" style={{ marginBottom: 14, color: 'var(--danger)' }}>{error}</div>}

      {stuck.length > 0 && (
        <div className="card card-pad es-warn">
          <b>{stuck.map((a) => a.email).join(', ')} {stuck.length === 1 ? 'has' : 'have'} no login yet, so RFQ mail for {stuck.length === 1 ? 'its' : 'their'} categories cannot be sent.</b>{' '}
          Press the pencil on {stuck.length === 1 ? 'it' : 'each'} and add the mail server, the login and the password of that mailbox.
        </div>
      )}

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">Sender addresses <span className="sub">each is its own mailbox, used for the categories ticked</span></div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tl-table">
            <thead><tr><th>Email address</th><th>Name shown</th><th>Mailbox</th><th>Used for</th><th>Active</th><th /></tr></thead>
            <tbody>
              {(data?.accounts || []).map((a) => (
                <tr key={a.id}>
                  <td><b>{a.email}</b></td>
                  <td>{a.display_name || <span className="tl-wait">—</span>}</td>
                  <td>
                    {a.mailbox === 'own'
                      ? <span className="badge green" title={'Logs in as ' + a.smtpUser + ' on ' + a.smtpHost}>Own login</span>
                      : data?.ms365 ? <span className="badge blue">Via Microsoft 365</span> : <span className="badge orange">No login yet</span>}
                  </td>
                  <td style={{ whiteSpace: 'normal' }}>
                    {a.categories.length ? a.categories.map((c) => <span className="badge blue" style={{ marginRight: 4 }} key={c}>{c}</span>) : <span className="tl-wait">No category yet</span>}
                  </td>
                  <td><Toggle checked={a.is_active} onChange={(v) => toggleActive(a, v)} label={'Active: ' + a.email} /></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="action-btn" title="Send a test" onClick={() => setTesting({ acct: a, to: '', busy: false, result: null })}><Ic name="send" size={15} /></button>
                    <button className="action-btn" title="Edit" onClick={() => openEdit(a)}><Ic name="edit" size={15} /></button>
                    <button className="action-btn danger" title="Remove" onClick={() => remove(a)}><Ic name="trash" size={15} /></button>
                  </td>
                </tr>
              ))}
              {data && data.accounts.length === 0 && (
                <tr><td colSpan={6} className="tl-empty" style={{ textAlign: 'center', whiteSpace: 'normal' }}>
                  No office addresses yet. Press <b>Add email</b>, for example motor.support@yourdomain.com for Motor.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {data && (
        <div className="card card-pad">
          <div className="section-head">What goes out as what</div>
          <div className="es-routes">
            {data.categories.map((c) => (
              <div className="es-route" key={c}>
                <span>{c}</span>
                {routing[c]
                  ? <b>{routing[c]}</b>
                  : <span className="tl-wait">The sender's own address</span>}
              </div>
            ))}
          </div>
          <div className="hint-line">
            This covers email sent from an RFQ — to insurers, the comparison to the client — and the automatic mails about that RFQ
            (acknowledgement, quote requested and received, approval, payment). Other mail, such as policy documents and renewals, still goes out as the person.
            {data.ms365 && <> An address with no login of its own sends through the Microsoft 365 connection on the <Link to="/page/team">Team page</Link>.</>}
          </div>
        </div>
      )}

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? 'Edit email' : 'Add email'}
        subtitle="This address's own mailbox, and the RFQ categories it is used for"
        icon="mail"
        size="md"
        footer={(
          <>
            <button className="btn ghost" onClick={() => setForm(null)}>Cancel</button>
            <button className="btn blue" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </>
        )}
      >
        {form && (
          <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="form-field"><label>Email address <span className="req">*</span></label>
              <input type="email" value={form.values.email} autoComplete="off" placeholder="motor.support@yourdomain.com"
                onChange={(e) => { const val = e.target.value; setForm((f) => ({ ...f, values: { ...f.values, email: val, smtpUser: !f.values.smtpUser || f.values.smtpUser === f.values.email ? val : f.values.smtpUser } })); }} /></div>
            <div className="form-field"><label>Name shown to the recipient</label>
              <input value={form.values.display_name} onChange={(e) => setV('display_name', e.target.value)} placeholder="e.g. WeCare Motor Support" /></div>

            <div className="section-head" style={{ gridColumn: '1 / -1', margin: '8px 0 0' }}>This address's mailbox</div>
            <div className="form-field"><label>Mail provider</label>
              <Select value={presetOf(form.values.smtpHost)} onChange={(e) => {
                const p = MAIL_PRESETS.find((x) => x.label === e.target.value);
                if (p) setForm((f) => ({ ...f, values: { ...f.values, smtpHost: p.host, smtpPort: p.port, smtpSecure: p.secure } }));
              }}>
                {MAIL_PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
                <option value="Custom">Other (enter below)</option>
              </Select></div>
            <div className="form-field"><label>SMTP server</label>
              <input value={form.values.smtpHost} onChange={(e) => setV('smtpHost', e.target.value)} placeholder="smtp.example.com" /></div>
            <div className="form-field"><label>Port</label>
              <input value={form.values.smtpPort} onChange={(e) => setV('smtpPort', e.target.value.replace(/[^0-9]/g, ''))} placeholder="587" /></div>
            <div className="form-field"><label>Security</label>
              <Select value={form.values.smtpSecure} onChange={(e) => setV('smtpSecure', e.target.value)}><option>TLS</option><option>SSL</option><option>None</option></Select></div>
            <div className="form-field"><label>Login (username)</label>
              <input value={form.values.smtpUser} onChange={(e) => setV('smtpUser', e.target.value)} placeholder="usually the email address" autoComplete="off" /></div>
            <div className="form-field"><label>Password / App key</label>
              <input type="password" value={form.values.smtpPass} onChange={(e) => setV('smtpPass', e.target.value)} placeholder={form.values.hasPass ? 'Saved — leave blank to keep' : ''} autoComplete="new-password" /></div>
            {preset?.note && <div className="hint-line" style={{ gridColumn: '1 / -1', marginTop: -4 }}>{preset.note}</div>}

            <div className="form-field" style={{ gridColumn: '1 / -1' }}>
              <label>Use for these RFQ categories</label>
              <div className="es-cats">
                {(data?.categories || []).map((c) => {
                  const other = heldByOther(c);
                  const on = form.values.categories.includes(c);
                  return (
                    <label key={c} className={'es-cat' + (on ? ' on' : '') + (other ? ' taken' : '')} title={other ? 'Already sends from ' + other.email : ''}>
                      <input type="checkbox" checked={on} disabled={!!other}
                        onChange={(e) => setV('categories', e.target.checked ? [...form.values.categories, c] : form.values.categories.filter((x) => x !== c))} />
                      <span>{c}</span>
                      {other && <small>{other.email}</small>}
                    </label>
                  );
                })}
              </div>
              <div className="hint-line">A category can send from one address only. Leave a category unticked and it keeps sending as each person.</div>
            </div>
            <div className="switch-row" style={{ gridColumn: '1 / -1' }}>
              <span className="sr-label">Active</span>
              <Toggle checked={form.values.is_active} onChange={(v) => setV('is_active', v)} label="Active" />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!testing}
        onClose={() => setTesting(null)}
        title={testing ? 'Test ' + testing.acct.email : ''}
        subtitle="Logs in to this mailbox and sends a short message from it"
        icon="send"
        size="md"
        footer={(
          <>
            <button className="btn ghost" onClick={() => setTesting(null)}>Close</button>
            <button className="btn blue" onClick={runTest} disabled={testing?.busy}>{testing?.busy ? 'Sending…' : 'Send test'}</button>
          </>
        )}
      >
        {testing && (
          <>
            <div className="form-field"><label>Send the test to</label>
              <input type="email" value={testing.to} onChange={(e) => setTesting((t) => ({ ...t, to: e.target.value }))} placeholder="leave blank to send to your own address" /></div>
            {testing.result && (
              <div className={'mb-result ' + (testing.result.ok ? 'ok' : 'bad')}>
                {testing.result.ok
                  ? <>Sent from <b>{testing.result.from}</b>{testing.result.via ? <> (login: {testing.result.via})</> : null} to <b>{testing.result.to}</b>. Check that inbox (and spam).</>
                  : <>{testing.result.stage === 'connect' ? 'Could not log in. ' : testing.result.stage === 'send' ? 'Logged in, but the send failed. ' : ''}{testing.result.error}</>}
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
