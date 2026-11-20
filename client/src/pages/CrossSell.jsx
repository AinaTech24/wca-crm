// On a client: what they already hold, and what to offer next — each a lead in one click.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import { Ic } from '../components/Icons.jsx';

export default function CrossSell({ client, compact = false }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState('');
  const load = () => api(`/clients/${client.id}/cross-sell`).then(setD).catch(() => setD(null));
  useEffect(() => { load(); }, [client.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null;
  async function makeLead(s) {
    setBusy(s.product);
    try {
      await api('/leads', { method: 'POST', body: {
        lead_name: client.client_name, client_id: client.id, mobile: client.mobile || '', email: client.email || '', expected_business_type: s.product,
        source: 'Existing Client', status: 'New', lead_owner: client.owner || '', lead_date: new Date().toLocaleDateString('sv-SE'),
        remarks: `Cross-sell: ${s.reason}.`,
      } });
      toast.success(`Lead created — ${s.product} for ${client.client_name}`);
      load();
    } catch (e) { toast.error(e.message || 'Could not create the lead'); }
    finally { setBusy(''); }
  }
  // On the client overview: what they hold as chips, and each product to offer next with a one-click lead.
  if (compact) return (
    <div className="cv-xsell">
      <div className="cv-sub">Opportunities <small>{d.business ? 'business client' : 'individual'}</small></div>
      <div className="cv-held">{d.held.length ? d.held.map((h) => <span key={h}><Ic name="check" size={11} /> {h}</span>) : <em>No cover on file yet</em>}</div>
      {!d.suggestions.length && <div className="cv-quiet">Covered for everything we would usually suggest.</div>}
      <div className="cv-opps">
        {d.suggestions.map((s) => (
          <div key={s.product} className="cv-opp" title={s.reason}>
            <span><b>{s.product}</b><small>{s.reason}</small></span>
            {s.lead
              ? <span className="badge blue" title="An open lead for this already exists">Lead {s.lead.status}</span>
              : <button type="button" className="btn ghost sm" onClick={() => makeLead(s)} disabled={busy === s.product}><Ic name="plus" size={12} /> {busy === s.product ? '…' : 'Lead'}</button>}
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <div className="card card-pad xsell">
      <div className="section-head">Cross-sell <span className="sub">{d.business ? 'business client' : 'individual'}</span></div>
      <div className="xsell-held">
        <span>Holds:</span> {d.held.length ? d.held.map((h) => <span key={h} className="badge green">{h}</span>) : <span className="att-dow">nothing on file yet</span>}
      </div>
      {!d.suggestions.length && <div className="hint-line">Covered for everything we would usually suggest.</div>}
      {d.suggestions.map((s) => (
        <div key={s.product} className="xsell-row">
          <div><b>{s.product}</b><div className="att-dow" style={{ marginLeft: 0 }}>{s.reason}</div></div>
          {s.lead
            ? <span className="badge blue" title="An open lead for this already exists">Lead open · {s.lead.status}</span>
            : <button type="button" className="btn ghost sm" onClick={() => makeLead(s)} disabled={busy === s.product}><Ic name="target" size={13} /> {busy === s.product ? 'Creating…' : 'Create lead'}</button>}
        </div>
      ))}
    </div>
  );
}
