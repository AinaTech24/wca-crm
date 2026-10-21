import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import confirm from '../components/confirm.js';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';
import Select from '../components/Select.jsx';
import Toggle from '../components/Toggle.jsx';
import { Ic } from '../components/Icons.jsx';
import { useAuth } from '../auth.jsx';
import { useRealtime } from '../realtime.js';

const DEPARTMENTS = ['Personal Lines', 'Commercial Lines'];
const ASSIGNABLE = [...DEPARTMENTS, 'Both'];
const DEPT_BADGE = { 'Personal Lines': 'blue', 'Commercial Lines': 'orange', Both: 'green' };

const seesEverything = (u) => u.role === 'admin' || !!u.is_head || !u.department || u.department === 'Both';
const initialsOf = (u) => (u.full_name || u.username || '?').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();
// Common mail servers, so the person setting one up doesn't need the host and port to hand.
const MAIL_PRESETS = [
  { label: 'Hostinger', host: 'smtp.hostinger.com', port: '465', secure: 'SSL' },
  { label: 'Google Workspace / Gmail', host: 'smtp.gmail.com', port: '587', secure: 'TLS', note: 'Google needs an App Password (Google Account → Security → App passwords), not the normal password.' },
  { label: 'Microsoft 365 / Outlook', host: 'smtp.office365.com', port: '587', secure: 'TLS' },
];
const presetOf = (host) => MAIL_PRESETS.find((p) => p.host === (host || '').trim().toLowerCase())?.label || 'Custom';
const MAILBOX_CHIP = { ready: ['green', 'Mailbox ready'], off: ['orange', 'Mailbox off'], none: ['', 'No mailbox'] };
const emptyForm = () => ({ full_name: '', username: '', email: '', password: '', role: 'user', department: 'Personal Lines', is_head: 0 });

export default function Team() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);        // { id, values } — null when closed
  const [saving, setSaving] = useState(false);
  const [pwFor, setPwFor] = useState(null);           // user whose password is being reset
  const [modules, setModules] = useState([]);         // the module catalogue the access grid is built from
  const [busy, setBusy] = useState(null);             // 'userId:moduleKey' while a switch is saving
  const [pw, setPw] = useState('');
  const [mb, setMb] = useState(null);                 // { user, v } while a mailbox is being set up
  const [mbSaving, setMbSaving] = useState(false);
  const [mbTest, setMbTest] = useState(null);         // { to, busy, result }
  const isAdmin = (user?.role || '') === 'admin';

  function load() {
    setLoading(true);
    api('/users').then(setRows).catch(() => {}).finally(() => setLoading(false));
  }
  useEffect(load, []);
  useEffect(() => {
    if (isAdmin) api('/modules').then(setModules).catch(() => {});
  }, [isAdmin]);
  useRealtime('user', () => load());

  const byDept = useMemo(() => {
    const map = {};
    for (const d of DEPARTMENTS) {
      map[d] = {
        members: rows.filter((r) => r.department === d),
        head: rows.find((r) => r.department === d && r.is_head) || null,
      };
    }
    return map;
  }, [rows]);
  const fullAccess = useMemo(() => rows.filter(seesEverything), [rows]);

  const set = (k, v) => setForm((f) => ({ ...f, values: { ...f.values, [k]: v } }));

  function openAdd() { setForm({ id: null, values: emptyForm() }); }
  // A user's modules, resolved. No recorded limits means every module, so
  // that is what a user with an empty list is shown as having.
  const accessOf = (u) => (u.role === 'admin' || !Array.isArray(u.module_access) || !u.module_access.length
    ? modules.map((m) => m.key)
    : u.module_access);

  // One switch, saved the moment it is flipped. Each flip sends the user's full
  // list, so two quick flips cannot overwrite each other with a stale one.
  async function toggleModule(u, key, on) {
    const current = accessOf(u);
    const next = on ? [...new Set([...current, key])] : current.filter((k) => k !== key);

    // An empty list is stored as "no limits", which is full access. Letting the
    // last switch go off would therefore grant the user everything, the exact
    // opposite of what turning it off means — so it is refused instead.
    if (!next.length) {
      toast.error(`${u.full_name} needs at least one module. To remove their access entirely, delete the user.`);
      return;
    }
    setBusy(u.id + ':' + key);
    try {
      // Every module on is stored as "no limits" too, so switching everything
      // back on is a true undo rather than a list that must be kept in step
      // with future modules.
      const body = { modules: next.length === modules.length ? [] : next };
      const row = await api(`/users/${u.id}/modules`, { method: 'PUT', body });
      setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)));
    } catch (e) {
      toast.error(e.message || 'Could not change module access');
    } finally { setBusy(null); }
  }

  async function openMailbox(u) {
    try {
      const v = await api('/users/' + u.id + '/mailbox');
      // A fresh mailbox starts from the person's own address as login, and from the
      // first server in the list so most of it is already right.
      if (!v.smtpHost) { const p = MAIL_PRESETS[0]; Object.assign(v, { smtpHost: p.host, smtpPort: p.port, smtpSecure: p.secure }); }
      if (!v.smtpUser) v.smtpUser = v.email || '';
      v.smtpPass = '';
      setMb({ user: u, v });
      setMbTest({ to: v.email || '', busy: false, result: null });
    } catch (e) { toast.error(e.message || 'Could not open the mailbox settings'); }
  }
  const setMbv = (k, val) => setMb((m) => ({ ...m, v: { ...m.v, [k]: val } }));
  async function saveMailbox() {
    setMbSaving(true);
    try {
      await api('/users/' + mb.user.id + '/mailbox', { method: 'PUT', body: mb.v });
      load();
      return true;
    } catch (e) { toast.error(e.message || 'Could not save the mailbox'); return false; }
    finally { setMbSaving(false); }
  }
  async function saveAndTest() {
    setMbTest((t) => ({ ...t, busy: true, result: null }));
    if (!(await saveMailbox())) { setMbTest((t) => ({ ...t, busy: false })); return; }
    try {
      const r = await api('/users/' + mb.user.id + '/mailbox/test', { method: 'POST', body: { to: mbTest.to } });
      setMbTest((t) => ({ ...t, busy: false, result: r }));
      setMb((m) => ({ ...m, v: { ...m.v, smtpPass: '', hasSmtpPass: true } }));
    } catch (e) { setMbTest((t) => ({ ...t, busy: false, result: { ok: false, error: e.message || 'Test failed' } })); }
  }

  function openEdit(u) {
    setForm({ id: u.id, values: { full_name: u.full_name || '', username: u.username, email: u.email || '', password: '', role: u.role || 'user', department: u.department || 'Both', is_head: u.is_head ? 1 : 0 } });
  }

  async function save() {
    const v = form.values;
    if (!v.full_name.trim()) { toast.error('Full name is required'); return; }
    if (!form.id) {
      if (!v.username.trim()) { toast.error('Username is required'); return; }
      if ((v.password || '').length < 6) { toast.error('Password must be at least 6 characters'); return; }
    }
    setSaving(true);
    try {
      if (form.id) {
        await api(`/users/${form.id}/department`, { method: 'PUT', body: { department: v.department, is_head: v.is_head, role: v.role, email: v.email } });
        toast.success('Team updated');
      } else {
        await api('/users', { method: 'POST', body: v });
        toast.success(`${v.full_name} added`);
      }
      setForm(null);
      load();
    } catch (e) {
      toast.error(e.message || 'Could not save');
    } finally { setSaving(false); }
  }

  async function resetPassword() {
    if ((pw || '').length < 6) { toast.error('Password must be at least 6 characters'); return; }
    setSaving(true);
    try {
      await api(`/users/${pwFor.id}/password`, { method: 'PUT', body: { password: pw } });
      toast.success(`Password reset for ${pwFor.full_name || pwFor.username}`);
      setPwFor(null); setPw('');
    } catch (e) { toast.error(e.message || 'Could not reset password'); }
    finally { setSaving(false); }
  }

  async function del(u) {
    const ok = await confirm({
      title: 'Remove this user?',
      message: `“${u.full_name || u.username}” will lose access immediately. Records they created stay in place.`,
      tone: 'danger', confirmText: 'Remove', icon: 'trash',
    });
    if (!ok) return;
    try { await api('/users/' + u.id, { method: 'DELETE' }); toast.success('User removed'); load(); }
    catch (e) { toast.error(e.message || 'Could not remove user'); }
  }

  const v = form?.values;

  return (
    <div>
      <PageHeader
        title="Team & Departments"
        subtitle="Personal Lines and Commercial Lines — who sits where, and who heads each"
        action={isAdmin ? <button className="btn blue" onClick={openAdd}><Ic name="userplus" size={16} /> Add User</button> : null}
      />

      {!isAdmin && (
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <div className="empty-inline">Only an admin can add users or change assignments. You can view the team here.</div>
        </div>
      )}

      {/* Two real departments, plus who can see across both. "Both" is a
          visibility setting, not a third department, so it's shown apart. */}
      <div className="dept-cards">
        {DEPARTMENTS.map((d) => (
          <div className={'dept-card ' + (DEPT_BADGE[d] || '')} key={d}>
            <div className="dept-card-head">
              <span className="dept-dot" />
              <span className="dept-name">{d}</span>
              <span className="dept-count">{byDept[d].members.length}</span>
            </div>
            <div className="dept-head-row">
              {byDept[d].head
                ? <><span className="avatar sm">{initialsOf(byDept[d].head)}</span><span><strong>{byDept[d].head.full_name || byDept[d].head.username}</strong><small>Department head</small></span></>
                : <span className="dept-nohead"><Ic name="alert" size={14} /> No head assigned</span>}
            </div>
            <div className="dept-members">
              {byDept[d].members.length === 0
                ? <span className="dept-nohead">No members yet</span>
                : byDept[d].members.map((m) => (
                    <span className="chip" key={m.id}>{m.full_name || m.username}</span>
                  ))}
            </div>
          </div>
        ))}
        <div className="dept-card green">
          <div className="dept-card-head">
            <span className="dept-dot" />
            <span className="dept-name">Full access</span>
            <span className="dept-count">{fullAccess.length}</span>
          </div>
          <div className="hint-line" style={{ marginTop: 0 }}>Admins, department heads and anyone set to <strong>Both</strong> — they see every record.</div>
          <div className="dept-members">
            {fullAccess.map((m) => <span className="chip" key={m.id}>{m.full_name || m.username}</span>)}
          </div>
        </div>
      </div>

      <div className="section-head" style={{ marginTop: 24 }}>Users ({rows.length})</div>
      {loading && <div className="notif-empty"><span>Loading…</span></div>}
      <div className="user-grid">
        {rows.map((u) => (
          <div className="user-card" key={u.id}>
            <span className="avatar">{initialsOf(u)}</span>
            <div className="user-card-body">
              <div className="user-card-name">
                {u.full_name || u.username}
                {u.id === user?.id && <small> (you)</small>}
              </div>
              <div className="user-card-sub">@{u.username}</div>
              {isAdmin && (
                <div style={{ marginTop: 4 }}>
                  <span className={'badge ' + MAILBOX_CHIP[u.mailbox || 'none'][0]}>{MAILBOX_CHIP[u.mailbox || 'none'][1]}</span>
                  {u.mailbox === 'ready' && !u.auto_mail && <span className="badge" style={{ marginLeft: 6 }}>Auto-mail off</span>}
                </div>
              )}
              <div className="user-card-mail" title="Automatic and manual emails for this user go out from this mailbox"><Ic name="mail" size={12} /> {u.email || <span className="user-card-nomail">No email set</span>}</div>
              <div className="user-card-tags">
                <span className={'badge ' + (DEPT_BADGE[u.department] || '')}>{u.department || 'Both'}</span>
                {!!u.is_head && <span className="badge green">Head</span>}
                {u.role === 'admin' && <span className="badge red">Admin</span>}
              </div>
              <div className="user-card-sees">
                <Ic name="eye" size={12} />{' '}
                {seesEverything(u) ? 'Sees both departments' : `Sees ${u.department} only`}
              </div>
              <div className="user-card-scope">
                <Ic name="shieldcheck" size={12} />{' '}
                {u.role === 'admin' || !Array.isArray(u.module_access) || !u.module_access.length
                  ? 'All modules'
                  : `${u.module_access.length} of ${modules.length || '—'} modules`}
              </div>
            </div>
            {isAdmin && (
              <div className="user-card-actions">
                <button className="action-btn" title="Edit assignment" onClick={() => openEdit(u)}><Ic name="edit" size={15} /></button>
                <button className="action-btn" title="Email setup" onClick={() => openMailbox(u)}><Ic name="mail" size={15} /></button>
                <button className="action-btn" title="Reset password" onClick={() => { setPwFor(u); setPw(''); }}><Ic name="lock" size={15} /></button>
                <button className="action-btn danger" title="Remove user" onClick={() => del(u)} disabled={u.id === user?.id}><Ic name="trash" size={15} /></button>
              </div>
            )}
          </div>
        ))}
      </div>

      {isAdmin && modules.length > 0 && (
        <div className="card card-pad" style={{ marginTop: 22 }}>
          <div className="section-head">Module Access</div>
          <div className="hint-line" style={{ marginTop: 0, marginBottom: 12 }}>
            Switch a module off and it disappears from that person's menu, and the system refuses the data
            if they try the address directly. Changes apply at once, no re-login. The Dashboard and a user's
            own profile always stay. Admins always have everything.
          </div>
          <div className="acl-wrap">
            <table className="acl">
              <thead>
                <tr>
                  <th className="acl-user">User</th>
                  {modules.map((m) => <th key={m.key}>{m.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => {
                  const mine = accessOf(u);
                  const locked = u.role === 'admin';
                  return (
                    <tr key={u.id}>
                      <td className="acl-user">
                        <b>{u.full_name}</b>
                        <small>{locked ? 'Admin — all modules' : `@${u.username}`}</small>
                      </td>
                      {modules.map((m) => (
                        <td key={m.key}>
                          <Toggle
                            checked={mine.includes(m.key)}
                            disabled={locked || busy === u.id + ':' + m.key}
                            onChange={(on) => toggleModule(u, m.key, on)}
                            label={`${m.label} for ${u.full_name}`}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card card-pad" style={{ marginTop: 22 }}>
        <div className="section-head">How the split works</div>
        <div className="hint-line" style={{ fontSize: 12.5 }}>
          A record's department is derived from its product, never typed in — Life, Health, Super Top&nbsp;Up,
          ULIP, SISO, Critical Illness, Personal Accident and Travel are <strong>Personal Lines</strong>;
          everything else, including all Group/employer products, is <strong>Commercial Lines</strong>.
          Admins, department heads and anyone set to <strong>Both</strong> see every record; everyone else
          sees only their own department. Records with no product yet stay visible to everyone so nothing
          gets stranded.
        </div>
      </div>

      {/* Assignment lives in a modal rather than inline dropdowns in a table —
          the table clips any open dropdown, and there's no room to explain
          what each choice does. */}
      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? 'Edit User' : 'Add User'}
        subtitle={form?.id ? 'Change email, department, head status and role' : 'Create a login and assign them to a department'}
        icon="userplus"
        size="md"
        footer={
          <>
            <button className="btn ghost" onClick={() => setForm(null)}>Cancel</button>
            <button className="btn blue" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : form?.id ? 'Save Changes' : 'Create User'}
            </button>
          </>
        }
      >
        {form && (
          <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="form-field"><label>Full Name <span className="req">*</span></label>
              <input value={v.full_name} onChange={(e) => set('full_name', e.target.value)} placeholder="e.g. Priya Sharma" /></div>
            <div className="form-field"><label>Username {!form.id && <span className="req">*</span>}</label>
              <input value={v.username} onChange={(e) => set('username', e.target.value)} placeholder="login name" readOnly={!!form.id} />
              {form.id && <div className="hint-line">Usernames can't be changed here — the user can rename themselves in My Profile.</div>}
            </div>

            <div className="form-field" style={{ gridColumn: '1 / -1' }}><label>Email</label>
              <input type="email" value={v.email} onChange={(e) => set('email', e.target.value)} placeholder="name@wecareassurance.com" autoComplete="off" />
              <div className="hint-line">Emails sent for this user come from this address. Their mailbox login is set in My Profile.</div>
            </div>

            {!form.id && (
              <div className="form-field" style={{ gridColumn: '1 / -1' }}>
                <label>Temporary Password <span className="req">*</span></label>
                <input type="text" value={v.password} onChange={(e) => set('password', e.target.value)} placeholder="At least 6 characters" autoComplete="new-password" />
                <div className="hint-line">Share this with them; they can change it from My Profile once they log in.</div>
              </div>
            )}

            <div className="form-field"><label>Department</label>
              <Select value={v.department} onChange={(e) => set('department', e.target.value)}>
                {ASSIGNABLE.map((d) => <option key={d} value={d}>{d}</option>)}
              </Select></div>
            <div className="form-field"><label>Role</label>
              <Select value={v.role} onChange={(e) => set('role', e.target.value)}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </Select></div>

            <div className="form-field" style={{ gridColumn: '1 / -1' }}>
              <label className="inline-check">
                <input type="checkbox" checked={!!v.is_head} onChange={(e) => set('is_head', e.target.checked ? 1 : 0)} />
                <span>Department head</span>
              </label>
              <div className="hint-line">
                {v.role === 'admin'
                  ? 'Admins see every record regardless of department.'
                  : v.is_head || v.department === 'Both'
                    ? 'This person will see records from both departments.'
                    : `This person will see ${v.department} records only.`}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!mb}
        onClose={() => setMb(null)}
        title={mb ? 'Email setup — ' + (mb.user.full_name || mb.user.username) : ''}
        subtitle="Emails sent for this person go out from this mailbox only"
        icon="mail"
        size="md"
        footer={(
          <>
            <button className="btn ghost" onClick={() => setMb(null)}>Close</button>
            <button className="btn blue" onClick={async () => { if (await saveMailbox()) toast.success('Mailbox saved'); }} disabled={mbSaving || mbTest?.busy}>{mbSaving && !mbTest?.busy ? 'Saving…' : 'Save'}</button>
          </>
        )}
      >
        {mb && (
          <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="form-field" style={{ gridColumn: '1 / -1' }}><label>Email address</label>
              <input type="email" value={mb.v.email} onChange={(e) => { const val = e.target.value; setMb((m) => ({ ...m, v: { ...m.v, email: val, smtpUser: !m.v.smtpUser || m.v.smtpUser === m.v.email ? val : m.v.smtpUser } })); }} placeholder="name@yourdomain.com" autoComplete="off" />
              <div className="hint-line">Their own address — it is the "From" on everything they send.</div></div>
            <div className="form-field"><label>Mail provider</label>
              <Select value={presetOf(mb.v.smtpHost)} onChange={(e) => {
                const p = MAIL_PRESETS.find((x) => x.label === e.target.value);
                if (p) setMb((m) => ({ ...m, v: { ...m.v, smtpHost: p.host, smtpPort: p.port, smtpSecure: p.secure } }));
              }}>
                {MAIL_PRESETS.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
                <option value="Custom">Other (enter below)</option>
              </Select></div>
            <div className="form-field"><label>SMTP server</label>
              <input value={mb.v.smtpHost} onChange={(e) => setMbv('smtpHost', e.target.value)} placeholder="smtp.example.com" /></div>
            <div className="form-field"><label>Port</label>
              <input value={mb.v.smtpPort} onChange={(e) => setMbv('smtpPort', e.target.value.replace(/[^0-9]/g, ''))} placeholder="587" /></div>
            <div className="form-field"><label>Security</label>
              <Select value={mb.v.smtpSecure} onChange={(e) => setMbv('smtpSecure', e.target.value)}><option>TLS</option><option>SSL</option><option>None</option></Select></div>
            <div className="form-field"><label>Login (username)</label>
              <input value={mb.v.smtpUser} onChange={(e) => setMbv('smtpUser', e.target.value)} placeholder="usually the email address" autoComplete="off" /></div>
            <div className="form-field"><label>Password / App key</label>
              <input type="password" value={mb.v.smtpPass} onChange={(e) => setMbv('smtpPass', e.target.value)} placeholder={mb.v.hasSmtpPass ? 'Saved — leave blank to keep' : ''} autoComplete="new-password" /></div>
            {MAIL_PRESETS.find((p) => p.label === presetOf(mb.v.smtpHost))?.note && (
              <div className="hint-line" style={{ gridColumn: '1 / -1', marginTop: -4 }}>{MAIL_PRESETS.find((p) => p.label === presetOf(mb.v.smtpHost)).note}</div>
            )}
            <div className="form-field"><label>From name</label>
              <input value={mb.v.smtpFromName} onChange={(e) => setMbv('smtpFromName', e.target.value)} placeholder={mb.user.full_name || ''} /></div>
            <div className="form-field" />
            <div className="switch-row" style={{ gridColumn: '1 / -1' }}>
              <span className="sr-label">Mailbox switched on</span>
              <Toggle checked={mb.v.emailEnabled} onChange={(v) => setMbv('emailEnabled', v)} label="Mailbox switched on" />
            </div>
            <div className="switch-row" style={{ gridColumn: '1 / -1' }}>
              <span className="sr-label">Send automatic emails from it (quotes, policy documents, renewals)</span>
              <Toggle checked={mb.v.autoMailEnabled} onChange={(v) => setMbv('autoMailEnabled', v)} label="Send automatic emails" />
            </div>

            <div className="form-field" style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <label>Send a test email to</label>
              <div className="fetch-row">
                <input style={{ flex: 1, minWidth: 200 }} type="email" value={mbTest?.to || ''} onChange={(e) => setMbTest((t) => ({ ...t, to: e.target.value }))} placeholder="where the test should arrive" />
                <button type="button" className="btn ghost" onClick={saveAndTest} disabled={mbSaving || mbTest?.busy}>{mbTest?.busy ? 'Testing…' : 'Save & send test'}</button>
              </div>
              {mbTest?.result && (
                <div className={'mb-result ' + (mbTest.result.ok ? 'ok' : 'bad')}>
                  {mbTest.result.ok
                    ? <>Sent from <b>{mbTest.result.from}</b> to <b>{mbTest.result.to}</b>. Check that inbox (and spam).</>
                    : <>{mbTest.result.stage === 'connect' ? 'Could not log in. ' : mbTest.result.stage === 'send' ? 'Logged in, but the send failed. ' : ''}{mbTest.result.error}</>}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!pwFor}
        onClose={() => setPwFor(null)}
        title="Reset Password"
        subtitle={pwFor ? `Set a new password for ${pwFor.full_name || pwFor.username}` : ''}
        icon="lock"
        size="sm"
        footer={
          <>
            <button className="btn ghost" onClick={() => setPwFor(null)}>Cancel</button>
            <button className="btn blue" onClick={resetPassword} disabled={saving}>{saving ? 'Saving…' : 'Reset Password'}</button>
          </>
        }
      >
        <div className="form-field">
          <label>New Password</label>
          <input type="text" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="At least 6 characters" autoComplete="new-password" />
          <div className="hint-line">They'll use this to log in, and can change it afterwards from My Profile.</div>
        </div>
      </Modal>

    </div>
  );
}
