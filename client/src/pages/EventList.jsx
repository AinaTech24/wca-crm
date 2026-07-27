import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import { Ic } from '../components/Icons.jsx';

// Birthday List / Anniversary List — derived from client dates.
export default function EventList({ kind }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const label = kind === 'anniversary' ? 'Anniversary' : 'Birthday';

  useEffect(() => {
    setLoading(true);
    api('/clients-events/' + kind).then(setRows).finally(() => setLoading(false));
  }, [kind]);

  const columns = [
    { key: 'client_name', label: 'Client Name' },
    { key: 'event_date', label: `${label} Date`, render: (r) => <b>{r.event_date}</b> },
    { key: 'mobile', label: 'Mobile', render: (r) => r.mobile || '—' },
    { key: 'email', label: 'Email', render: (r) => r.email || '—' },
  ];

  return (
    <div>
      <PageHeader title={`${label} List`} subtitle={`Clients with upcoming ${label.toLowerCase()}s`} />
      <div className="card">
        <DataTable
          title={<>{label}s <span className="sub">({rows.length})</span></>}
          searchPlaceholder={`Search ${label.toLowerCase()}s…`}
          index
          loading={loading}
          rows={rows}
          columns={columns}
          actions={() => <button className="action-btn" title="Send wishes"><Ic name="mail" size={15} /></button>}
          empty={{ icon: 'gift', title: `No ${label.toLowerCase()} records`, sub: 'Add dates of birth / anniversary in Client Master.' }}
        />
      </div>
    </div>
  );
}
