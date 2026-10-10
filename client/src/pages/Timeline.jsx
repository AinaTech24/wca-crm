import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import { Ic } from '../components/Icons.jsx';
import { subscribe } from '../realtime.js';

// Where every RFQ is in its journey, measured in real time: when it went to
// each insurer, when they answered, and how long each leg took — or, for the
// ones still open, how long they have been waiting right now.

const EVENTS = {
  rfq_created: { label: 'RFQ created', icon: 'clipboard', tone: 'blue' },
  sent_for_quote: { label: 'Sent for quote', icon: 'send', tone: 'orange' },
  quote_received: { label: 'Quote received', icon: 'shieldcheck', tone: 'green' },
  quote_shared: { label: 'Comparison sent to client', icon: 'mail', tone: 'blue' },
  client_approved: { label: 'Client approved', icon: 'checksquare', tone: 'green' },
  paid: { label: 'Payment received', icon: 'dollar', tone: 'green' },
  lost: { label: 'Marked lost', icon: 'x', tone: 'red' },
};

/** 93,600,000 ms -> "1d 2h". Minutes only matter while the whole span is under a day. */
export function span(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 1) return '< 1 min';
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mi = m % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${mi}m`;
  return `${mi}m`;
}

const when = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

export default function Timeline() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [view, setView] = useState('all');          // all | waiting
  const [tick, setTick] = useState(0);
  // Server clock minus browser clock, so a wrong laptop clock doesn't show
  // negative or inflated waiting times.
  const skew = useRef(0);

  function load() {
    api('/timeline').then((d) => {
      skew.current = Date.parse(d.now) - Date.now();
      setData(d); setError('');
    }).catch((e) => setError(e.message || 'Could not load the timeline'));
  }
  useEffect(() => {
    load();
    const un = [subscribe('timeline', load), subscribe('rfq', load)];
    // Waiting times tick forward without any server round trip.
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => { un.forEach((u) => u()); clearInterval(t); };
  }, []);

  const now = Date.now() + skew.current;
  void tick;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.rfqs || []).filter((r) => {
      if (view === 'waiting' && !r.legs.some((l) => !l.received_at)) return false;
      if (!needle) return true;
      return [r.rfq_no, r.client_name, r.product, r.category, r.status, ...r.legs.map((l) => l.insurer)]
        .some((v) => String(v || '').toLowerCase().includes(needle));
    });
  }, [data, q, view]);

  const waitingLegs = (data?.rfqs || []).flatMap((r) => r.legs).filter((l) => !l.received_at);
  const doneLegs = (data?.rfqs || []).flatMap((r) => r.legs).filter((l) => l.received_at);
  const avg = doneLegs.length ? doneLegs.reduce((a, l) => a + l.ms, 0) / doneLegs.length : null;
  const longest = waitingLegs.reduce((m, l) => Math.max(m, now - Date.parse(l.sent_at)), 0);

  return (
    <div>
      <PageHeader title="Timeline" />

      {error && <div className="card card-pad" style={{ marginBottom: 14, color: 'var(--danger)' }}>{error}</div>}

      <div className="kpi-grid" style={{ marginBottom: 18 }}>
        <Tile label="Waiting on insurers" value={waitingLegs.length} sub={waitingLegs.length ? `longest ${span(longest)}` : 'nothing pending'} />
        <Tile label="Quotes received" value={doneLegs.length} sub="since tracking began" />
        <Tile label="Average turnaround" value={avg === null ? '—' : span(avg)} sub="sent → quote received" />
        <Tile label="RFQs tracked" value={data?.rfqs.length ?? 0} sub="with at least one event" />
      </div>

      {data?.insurers?.length > 0 && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-head">Insurer turnaround <span className="sub">how quickly each insurer answers</span></div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tl-table">
              <thead><tr><th>Insurer</th><th>Answered</th><th>Waiting</th><th>Average</th><th>Fastest</th><th>Slowest</th></tr></thead>
              <tbody>
                {data.insurers.map((i) => (
                  <tr key={i.insurer}>
                    <td><b>{i.insurer}</b></td>
                    <td>{i.responded}</td>
                    <td>{i.waiting || '—'}</td>
                    <td>{i.avg_ms === null ? '—' : span(i.avg_ms)}</td>
                    <td>{i.fastest_ms === null ? '—' : span(i.fastest_ms)}</td>
                    <td>{i.slowest_ms === null ? '—' : span(i.slowest_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="dt-toolbar">
        <div className="dt-search">
          <span className="dt-search-ic"><Ic name="search" size={15} /></span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search RFQ, client or insurer" />
        </div>
        <div className="tl-seg">
          <button className={view === 'all' ? 'on' : ''} onClick={() => setView('all')}>All</button>
          <button className={view === 'waiting' ? 'on' : ''} onClick={() => setView('waiting')}>Waiting on a quote</button>
        </div>
      </div>

      {data && rows.length === 0 && (
        <div className="card card-pad tl-empty">
          {data.rfqs.length === 0
            ? 'Nothing tracked yet. The clock starts when an RFQ is emailed to insurers from the RFQ page.'
            : 'No RFQs match.'}
        </div>
      )}

      {rows.map((r) => (
        <div className="card tl-rfq" key={r.id}>
          <div className="tl-rfq-head">
            <div>
              <b>{r.rfq_no}</b> <span className="tl-client">{r.client_name}</span>
              <div className="tl-sub">{[r.product || r.category, r.assigned_to].filter(Boolean).join(' · ')}</div>
            </div>
            <span className="badge blue">{r.status}</span>
          </div>

          {r.legs.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table className="tl-table">
                <thead><tr><th>Insurer</th><th>Sent</th><th>Quote received</th><th>Time</th></tr></thead>
                <tbody>
                  {r.legs.map((l) => (
                    <tr key={l.insurer}>
                      <td><b>{l.insurer}</b></td>
                      <td>{when(l.sent_at)}</td>
                      <td>{l.received_at ? when(l.received_at) : <span className="tl-wait">Awaited</span>}</td>
                      <td>
                        {l.received_at
                          ? <span className="badge green">took {span(l.ms)}</span>
                          : <span className="badge orange">waiting {span(now - Date.parse(l.sent_at))}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <ol className="tl-log">
            {r.events.map((e) => {
              const meta = EVENTS[e.event] || { label: e.event, icon: 'clock', tone: 'blue' };
              return (
                <li key={e.id}>
                  <span className={'tl-dot ' + meta.tone}><Ic name={meta.icon} size={13} /></span>
                  <div className="tl-body">
                    <div><b>{meta.label}</b>{e.insurer ? <> · {e.insurer}</> : null}</div>
                    <div className="tl-meta">{when(e.at)}{e.actor ? ` · ${e.actor}` : ''}{e.note ? ` · ${e.note}` : ''}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

function Tile({ label, value, sub }) {
  return (
    <div className="kpi-card">
      <div className="kpi-card-head"><span className="kpi-card-label">{label}</span></div>
      <div className="tl-tile-v">{value}</div>
      <div className="tl-sub">{sub}</div>
    </div>
  );
}
