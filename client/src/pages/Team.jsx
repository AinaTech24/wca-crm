import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import confirm from '../components/confirm.js';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';
import Select from '../components/Select.jsx';
import { Ic } from '../components/Icons.jsx';
import { useAuth } from '../auth.jsx';
import { useRealtime } from '../realtime.js';

const DEPARTMENTS = ['Personal Lines', 'Commercial Lines'];
const ASSIGNABLE = [...DEPARTMENTS, 'Both'];
const DEPT_BADGE = { 'Personal Lines': 'blue', 'Commercial Lines': 'orange', Both: 'green' };

const seesEverything = (u) => u.role === 'admin' || !!u.is_head || !u.department || u.department === 'Both';
const initialsOf = (u) => (u.full_name || u.username || '?').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();
const emptyForm = () => ({ full_name: '', username: '', password: '', role: 'user', department: 'Personal Lines', is_head: 0 });

export default function Team() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);        // { id, values } — null when closed
  const [saving, setSaving] = useState(false);
  const [pwFor, setPwFor] = useState(null);
  const [accessFor, setAccessFor] = useState(null);   // user whose modules are being edited
  const [modules, setModules] = useState([]);         // the catalogue
  const [picked, setPicked] = useState([]);           // keys ticked in the editor
  const [savingAccess, setSavingAccess] = useState(false);      // user whose password is being reset
  const [pw, setPw] = useState('');
  const isAdmin = (user?.role || '') === 'admin';

  function load() {
    setLoading(true);
    api('/users').then(setRows).catch(() => {}).finally(() => setLoading(false));
  }
  useEffect(load, []);
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
  // Opens the module editor. No recorded limits means full access, so the
  // editor starts with everything ticked — the admin removes what the person
  // shouldn't have rather than building the list up from nothing.
  async function openAccess(u) {
    setAccessFor(u);
    setSavingAccess(false);
    try {
      const list = modules.length ? modules : await api('/modules');
      if (!modules.length) setModules(list);
      setPicked(Array.isArray(u.module_access) && u.module_access.length
        ? u.module_access
        : list.map((m) => m.key));
    } catch (e) {
      toast.error(e.message || 'Could not load the module list');
      setAccessFor(null);
    }
  }

  async function saveAccess() {
    if (!accessFor) return;
    setSavingAccess(true);
    try {
      // Every module ticked is stored as "no limits", which is also what an
      // untouched account holds — so granting everything back is a true undo.
      const body = { modules: picked.length === modules.length ? [] : picked };
      const row = await api(`/users/${accessFor.id}/modules`, { method: 'PUT', body });
      setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)));
      toast.success(`Module access updated for ${row.full_name}`);
      setAccessFor(null);
    } catch (e) {
      toast.error(e.message || 'Could not save module access');
    } finally { setSavingAccess(false); }
  }

  function openEdit(u) {
    setForm({ id: u.id, values: { full_name: u.full_name || '', username: u.username, password: '', role: u.role || 'user', department: u.department || 'Both', is_head: u.is_head ? 1 : 0 } });
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
        await api(`/users/${form.id}/department`, { method: 'PUT', body: { department: v.department, is_head: v.is_head, role: v.role } });
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
                {u.role === 'admin'
                  ? 'All modules'
                  : Array.isArray(u.module_access) && u.module_access.length
                    ? `${u.module_access.length} of ${modules.length || '—'} modules`
                    : 'All modules'}
              </div>
            </div>
            {isAdmin && (
              <div className="user-card-actions">
                <button className="action-btn" title="Edit assignment" onClick={() => openEdit(u)}><Ic name="edit" size={15} /></button>
                <button className="action-btn" title="Module access" onClick={() => openAccess(u)} disabled={u.role === 'admin'}><Ic name="shieldcheck" size={15} /></button>
                <button className="action-btn" title="Reset password" onClick={() => { setPwFor(u); setPw(''); }}><Ic name="lock" size={15} /></button>
                <button className="action-btn danger" title="Remove user" onClick={() => del(u)} disabled={u.id === user?.id}><Ic name="trash" size={15} /></button>
              </div>
            )}
          </div>
        ))}
      </div>

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
        subtitle={form?.id ? 'Change department, head status and role' : 'Create a login and assign them to a department'}
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

      <Modal
        open={!!accessFor}
        onClose={() => setAccessFor(null)}
        title="Module Access"
        subtitle={accessFor ? `What ${accessFor.full_name} can open` : ''}
        icon="shieldcheck"
        footer={
          <>
            <button className="btn ghost" onClick={() => setPicked(modules.map((m) => m.key))}>Select all</button>
            <button className="btn ghost" onClick={() => setPicked([])}>Clear</button>
            <button className="btn blue" onClick={saveAccess} disabled={savingAccess}>{savingAccess ? 'Saving…' : 'Save access'}</button>
          </>
        }
      >
        <div className="hint-line" style={{ marginTop: 0 }}>
          Unticked modules disappear from their sidebar and the API refuses the data, so the
          address bar is no way around it. The Dashboard and their own profile always stay.
        </div>
        <div className="mod-grid">
          {modules.map((m) => {
            const on = picked.includes(m.key);
            return (
              <label className={'mod-pick' + (on ? ' on' : '')} key={m.key}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, m.key] : p.filter((k) => k !== m.key)))}
                />
                <span>{m.label}</span>
              </label>
            );
          })}
        </div>
        {picked.length === 0 && (
          <div className="hint-line" style={{ color: 'var(--danger)' }}>
            Nothing ticked saves as full access, not none — clearing the list removes the restriction.
            To limit someone, tick only what they should have.
          </div>
        )}
      </Modal>
    </div>
  );
}
