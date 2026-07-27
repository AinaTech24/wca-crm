import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';

// Manage which clients have access to the mobile app.
export default function ClientAppUsers() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(() => new Set(JSON.parse(localStorage.getItem('wca_app_users') || '[]')));

  useEffect(() => { api('/clients').then(setClients).finally(() => setLoading(false)); }, []);

  function toggle(id) {
    setEnabled((prev) => {
      const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id);
      localStorage.setItem('wca_app_users', JSON.stringify([...n]));
      return n;
    });
  }

  const columns = [
    { key: 'client_name', label: 'Client Name' },
    { key: 'group_code', label: 'Group Code' },
    { key: 'mobile', label: 'Mobile' },
    { key: 'email', label: 'Email', render: (c) => c.email || '—' },
    { key: 'access', label: 'App Access', render: (c) => (
      <button className={'toggle-pill ' + (enabled.has(c.id) ? 'on' : '')} onClick={() => toggle(c.id)} role="switch" aria-checked={enabled.has(c.id)}>
        <span className="knob" />{enabled.has(c.id) ? 'Enabled' : 'Disabled'}
      </button>
    ) },
  ];

  return (
    <div>
      <PageHeader title="Client App Management" subtitle="Enable or disable mobile app access per client" />
      <div className="card">
        <DataTable
          title={<>App Users <span className="sub">({enabled.size} of {clients.length} enabled)</span></>}
          searchPlaceholder="Search app users…"
          index
          loading={loading}
          rows={clients}
          columns={columns}
          empty={{ icon: 'user', title: 'No clients', sub: 'Add clients to manage app access.' }}
        />
      </div>
    </div>
  );
}
