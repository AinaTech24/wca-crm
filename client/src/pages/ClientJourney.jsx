import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import { Ic } from '../components/Icons.jsx';
import { subscribe } from '../realtime.js';

// The end-to-end journey a client travels, starting at the RFQ.
const STAGES = [
  { key: 'leads', label: 'Lead', icon: 'target', color: '#1b6fb0', to: '/page/lead', desc: 'Prospect enquiry captured — the first touch.' },
  { key: 'rfq', label: 'RFQ', icon: 'clipboard', color: '#2c86bf', to: '/page/rfq', desc: 'Requirement raised and floated to insurers for quotes.' },
  { key: 'quotations', label: 'Quotation', icon: 'doc', color: '#3f8fbf', to: '/page/quotation', desc: 'Insurer quotes compared and presented to the client.' },
  { key: 'proposals', label: 'Proposal', icon: 'send', color: '#d98324', to: '/page/policy', desc: 'Client accepts; proposal submitted to the insurer.' },
  { key: 'policies', label: 'Policy', icon: 'shieldcheck', color: '#16874e', to: '/page/policy', desc: 'Policy issued, documents dispatched, cover active.' },
  { key: 'renewalsDue', label: 'Renewal', icon: 'refresh', color: '#e9531e', to: '/page/policy', desc: 'Policy nears expiry — retain and repeat the journey.' },
];

export default function ClientJourney() {
  const navigate = useNavigate();
  const [d, setD] = useState(null);

  function load() { api('/journey').then(setD).catch(() => setD({})); }
  useEffect(() => {
    load();
    const un = ['lead', 'rfq', 'quotation', 'policy'].map((t) => subscribe(t, load));
    return () => un.forEach((u) => u());
  }, []);

  const counts = STAGES.map((s) => (d ? (d[s.key] || 0) : 0));
  const max = Math.max(...counts, 1);

  return (
    <div>
      <PageHeader
        title="Client Journey"
        action={<button className="btn blue" onClick={() => navigate('/page/rfq')}><Ic name="plus" size={16} /> Start New RFQ</button>}
      />

      {/* Journey rail — the path every client follows, starting at RFQ intake */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">The Journey <span className="sub">enquiry → RFQ → quote → policy → renewal</span></div>
        <div className="card-pad">
          <div className="journey-rail">
            {STAGES.map((s, i) => (
              <div className="jr-wrap" key={s.key}>
                <button className="jr-node" onClick={() => navigate(s.to)} title={`Open ${s.label}`}>
                  <span className="jr-ic" style={{ background: s.color }}><Ic name={s.icon} size={17} /></span>
                  <span className="jr-count">{counts[i]}</span>
                  <span className="jr-label">{s.label}</span>
                </button>
                {i < STAGES.length - 1 && <span className="jr-arrow"><Ic name="arrowright" size={16} /></span>}
              </div>
            ))}
          </div>
          <div className="journey-headline">
            <span><b>{counts[0]}</b> leads</span><span className="jh-sep">·</span>
            <span><b>{d?.rfqOpen ?? counts[1]}</b> open RFQs</span><span className="jh-sep">·</span>
            <span><b>{counts[2]}</b> quotations</span><span className="jh-sep">·</span>
            <span><b>{counts[4]}</b> active policies</span><span className="jh-sep">·</span>
            <span><b>{counts[5]}</b> renewals due</span>
          </div>
        </div>
      </div>

      {/* Funnel — volume at each stage */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head">Pipeline Funnel <span className="sub">volume by stage</span></div>
        <div className="card-pad">
          <div className="journey-funnel">
            {STAGES.map((s, i) => {
              const pct = Math.max((counts[i] / max) * 100, 6);
              return (
                <div className="jf-row" key={s.key}>
                  <div className="jf-head"><span className="jf-dot" style={{ background: s.color }} />{s.label}</div>
                  <div className="jf-track">
                    <div className="jf-bar" style={{ width: pct + '%', background: s.color }}>
                      <span className="jf-count">{counts[i]}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Stage guide + jump-in */}
      <div className="journey-stages">
        {STAGES.map((s, i) => (
          <div className="jstage" key={s.key}>
            <div className="jstage-top">
              <span className="jstage-ic" style={{ background: s.color }}><Ic name={s.icon} size={16} /></span>
              <span className="jstage-step">Step {i + 1}</span>
            </div>
            <div className="jstage-name">{s.label} <span className="jstage-num">{counts[i]}</span></div>
            <p className="jstage-desc">{s.desc}</p>
            <button className="btn ghost jstage-btn" onClick={() => navigate(s.to)}>Open {s.label} <Ic name="arrowright" size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
