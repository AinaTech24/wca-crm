import { useEffect, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import PageHeader from '../components/PageHeader.jsx';
import Select from '../components/Select.jsx';

// Send mobile-app login credentials to a client via SMS / email.
export default function SendAppCredentials() {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [channel, setChannel] = useState('SMS');

  useEffect(() => { api('/clients').then(setClients).catch(() => {}); }, []);
  const c = clients.find((x) => String(x.id) === clientId);

  function send() {
    if (!clientId) { toast.error('Please select a client.'); return; }
    toast.success(`Credentials sent to ${c.client_name} via ${channel} (demo — a username & temporary password are generated server-side).`);
  }

  return (
    <div>
      <PageHeader title="Send App Credentials" subtitle="Issue mobile-app login details to a client" />
      <div className="card card-pad" style={{ maxWidth: 620 }}>
        <div className="section-head">Send Credentials</div>
        <div className="form-grid two">
          <div className="form-field"><label>Client</label>
            <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">-Select-</option>
              {clients.map((x) => <option key={x.id} value={x.id}>{x.client_name} — {x.mobile}</option>)}
            </Select>
          </div>
          <div className="form-field"><label>Channel</label>
            <Select value={channel} onChange={(e) => setChannel(e.target.value)}><option>SMS</option><option>Email</option><option>WhatsApp</option></Select>
          </div>
        </div>
        {c && (
          <div style={{ marginTop: 14, padding: 14, background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', fontSize: 13 }}>
            <div>Username: <b>{(c.client_name || '').split(' ')[0].toLowerCase()}{c.id}</b></div>
            <div>Delivery to: <b>{channel === 'Email' ? (c.email || 'no email on file') : c.mobile}</b></div>
          </div>
        )}
        <div className="btn-row"><button className="btn blue" onClick={send}>Send Credentials</button></div>
      </div>
    </div>
  );
}
