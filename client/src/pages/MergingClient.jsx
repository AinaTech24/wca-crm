import { useEffect, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import PageHeader from '../components/PageHeader.jsx';
import Select from '../components/Select.jsx';

// Merge two client records into one (keeps the primary, absorbs the duplicate).
export default function MergingClient() {
  const [clients, setClients] = useState([]);
  const [primary, setPrimary] = useState('');
  const [dup, setDup] = useState('');

  useEffect(() => { api('/clients').then(setClients).catch(() => {}); }, []);

  const p = clients.find((c) => String(c.id) === primary);
  const d = clients.find((c) => String(c.id) === dup);

  async function merge() {
    if (!primary || !dup) { toast.error('Select both a primary and a duplicate client.'); return; }
    if (primary === dup) { toast.error('Primary and duplicate must be different clients.'); return; }
    if (!confirm(`Merge "${d.client_name}" into "${p.client_name}"? The duplicate will be removed.`)) return;
    try {
      await api('/clients/merge', { method: 'POST', body: { primaryId: Number(primary), dupId: Number(dup) } });
      toast.success(`"${d.client_name}" was merged into "${p.client_name}" — all policies, claims and FDs re-linked.`);
      setDup(''); setPrimary('');
      api('/clients').then(setClients);
    } catch (e) {
      toast.error(e.message || 'Merge failed');
    }
  }

  return (
    <div>
      <PageHeader title="Merging Client" subtitle="Combine duplicate client records into one" />
      <div className="card card-pad" style={{ maxWidth: 860 }}>
        <div className="section-head">Select Clients</div>
        <div className="form-grid two">
          <div className="form-field"><label>Primary Client (keep)</label>
            <Select value={primary} onChange={(e) => setPrimary(e.target.value)}>
              <option value="">-Select-</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.client_name} — {c.group_code}</option>)}
            </Select>
          </div>
          <div className="form-field"><label>Duplicate Client (merge &amp; remove)</label>
            <Select value={dup} onChange={(e) => setDup(e.target.value)}>
              <option value="">-Select-</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.client_name} — {c.group_code}</option>)}
            </Select>
          </div>
        </div>

        {p && d && (
          <div className="table-wrap" style={{ marginTop: 18 }}>
            <table className="grid">
              <thead><tr><th>Field</th><th>Primary (keep)</th><th>Duplicate (merge)</th></tr></thead>
              <tbody>
                {[['Name', 'client_name'], ['Group Head', 'group_head_name'], ['Group Code', 'group_code'], ['Mobile', 'mobile'], ['Email', 'email'], ['City', 'city']].map(([label, key]) => (
                  <tr key={key}><td><b>{label}</b></td><td>{p[key] || '—'}</td><td>{d[key] || '—'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="btn-row"><button className="btn blue" onClick={merge}>Merge Clients</button></div>
      </div>
    </div>
  );
}
