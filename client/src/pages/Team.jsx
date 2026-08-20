import { useEffect, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import Select from '../components/Select.jsx';
import { Ic } from '../components/Icons.jsx';
import { useAuth } from '../auth.jsx';

const DEPARTMENTS = ['Personal Lines', 'Commercial Lines', 'Both'];
const ROLES = ['admin', 'user'];
const DEPT_BADGE = { 'Personal Lines': 'blue', 'Commercial Lines': 'orange', Both: 'green' };

// Who belongs to which department, and who heads it — this is what decides
// what everyone else can see, so it's admin-only.
export default function Team() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const isAdmin = (user?.role || '') === 'admin';

  function load() {
    setLoading(true);
    api('/users').then(setRows).catch(() => {}).finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function update(u, patch) {
    setSaving(u.id);
    const snap = rows;
    setRows((prev) => prev.map((r) => (r.id === u.id ? { ...r, ...patch } : r)));
    try {
      const row = await api(`/users/${u.id}/department`, {
        method: 'PUT',
        body: { department: u.department, is_head: u.is_head, role: u.role, ...patch },
      });
      setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)));
      toast.success('Team updated');
    } catch (e) {
      setRows(snap);
      toast.error(e.message || 'Could not update');
    } finally { setSaving(null); }
  }

  const counts = DEPARTMENTS.map((d) => ({ d, n: rows.filter((r) => r.department === d).length }));

  return (
    <div>
      <PageHeader
        title="Team & Departments"
        subtitle="Personal Lines and Commercial Lines — who sits where, and who heads each"
      />

      {!isAdmin && (
        <div className="card card-pad" style={{ marginBottom: 18 }}>
          <div className="empty-inline">Only an admin can change team assignments. You can view them here.</div>
        </div>
      )}

      <div className="kpi-grid" style={{ marginBottom: 18 }}>
        {counts.map(({ d, n }) => (
          <div className="kpi-card" data-tone={d === 'Personal Lines' ? 'info' : d === 'Commercial Lines' ? 'warning' : 'success'} key={d}>
            <div className="kpi-card-top"><span className="kpi-card-ic"><Ic name="users" size={16} /></span><span className="kpi-card-label">{d}</span></div>
            <div className="kpi-card-num">{n}</div>
            <div className="kpi-card-hint">{rows.filter((r) => r.department === d && r.is_head).map((r) => r.full_name || r.username).join(', ') || 'no head set'}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <DataTable
          title="Users"
          count={rows.length}
          loading={loading}
          rows={rows}
          search={false}
          columns={[
            { key: 'full_name', label: 'Name', render: (r) => r.full_name || r.username },
            { key: 'username', label: 'Username' },
            { key: 'department', label: 'Department', render: (r) => (
              isAdmin
                ? <Select value={r.department || 'Both'} onChange={(e) => update(r, { department: e.target.value })} disabled={saving === r.id}>
                    {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </Select>
                : <span className={'badge ' + (DEPT_BADGE[r.department] || '')}>{r.department || 'Both'}</span>
            ) },
            { key: 'is_head', label: 'Department Head', noFilter: true, render: (r) => (
              isAdmin
                ? <label className="inline-check" style={{ margin: 0 }}>
                    <input type="checkbox" checked={!!r.is_head} disabled={saving === r.id}
                      onChange={(e) => update(r, { is_head: e.target.checked ? 1 : 0 })} />
                    <span>{r.is_head ? 'Head' : '—'}</span>
                  </label>
                : (r.is_head ? <span className="badge green">Head</span> : '—')
            ) },
            { key: 'role', label: 'Role', render: (r) => (
              isAdmin
                ? <Select value={r.role || 'user'} onChange={(e) => update(r, { role: e.target.value })} disabled={saving === r.id}>
                    {ROLES.map((x) => <option key={x} value={x}>{x}</option>)}
                  </Select>
                : r.role
            ) },
            { key: 'sees', label: 'Sees', noFilter: true, render: (r) => (
              r.role === 'admin' || r.is_head || !r.department || r.department === 'Both'
                ? <span className="badge green">Both departments</span>
                : <span className={'badge ' + (DEPT_BADGE[r.department] || '')}>{r.department} only</span>
            ) },
          ]}
          empty={{ icon: 'users', title: 'No users', sub: 'Users will appear here once created.' }}
        />
      </div>

      <div className="card card-pad" style={{ marginTop: 18 }}>
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
    </div>
  );
}
