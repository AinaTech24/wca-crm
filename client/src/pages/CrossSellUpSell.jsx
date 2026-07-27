import { useEffect, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';

const SUGGESTIONS = ['Health Optima', 'Personal Accident', 'Term Life Plan', 'Home Shield', 'Two Wheeler Package', 'Travel Secure'];

// Identify cross-sell / up-sell opportunities from the client base.
export default function CrossSellUpSell() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api('/clients').then(setClients).finally(() => setLoading(false)); }, []);

  const columns = [
    { key: 'client_name', label: 'Client Name' },
    { key: 'group_code', label: 'Group Code' },
    { key: 'mobile', label: 'Mobile' },
    { key: 'suggested', label: 'Suggested Product', render: (c, i) => <span className="badge blue">{SUGGESTIONS[i % SUGGESTIONS.length]}</span> },
  ];

  return (
    <div>
      <PageHeader title="Cross Sell / Up Sell" subtitle="Product opportunities across your client base" />
      <div className="card">
        <DataTable
          title={<>Opportunities <span className="sub">({clients.length})</span></>}
          searchPlaceholder="Search opportunities…"
          index
          loading={loading}
          rows={clients}
          columns={columns}
          actions={(c) => (
            <button className="btn blue" style={{ padding: '6px 12px', fontSize: 12.5 }}
              onClick={() => toast.success(`Opportunity created for ${c.client_name}`)}>Create Lead</button>
          )}
          empty={{ icon: 'target', title: 'No opportunities', sub: 'Add clients to surface cross-sell suggestions.' }}
        />
      </div>
    </div>
  );
}
