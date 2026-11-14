// The dashboard's own numbers: the person's target for the month, and the saved reports they pinned —
// each showing its main figures and top groups, opening the full report when clicked.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { Ic } from '../../components/Icons.jsx';
import { formatMetric, compactMoney, presetRange } from '../reportConstants.js';
import { BarChart } from './ReportCharts.jsx';

function queryOf(c = {}) {
  const r = c.preset && c.preset !== 'custom' ? presetRange(c.preset) : null;
  const q = { from: r?.from || c.from || '', to: r?.to || c.to || '' };
  if (c.g) q.g = c.g;
  if (c.f && Object.keys(c.f).length) q.f = JSON.stringify(c.f);
  return q;
}

function Pinned({ rep }) {
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  useEffect(() => { api(`/reports/${rep.kind}?${new URLSearchParams(queryOf(rep.config))}`).then(setD).catch(() => setD({ error: true })); }, [rep.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const open = () => navigate('/page/reports?saved=' + rep.id);
  const cols = (d?.columns || []).filter((c) => c.kind !== 'share');
  const metric = cols.find((c) => c.kind === 'money' && Number(d?.totals?.[c.key]) > 0) || cols[0];
  return (
    <div className="card pin-card">
      <div className="card-head pin-head">
        <button type="button" className="rep-label" onClick={open}>{rep.name}</button>
        <span className="sub">{d && !d.error ? `${d.from.split('-').reverse().join('-')} → ${d.to.split('-').reverse().join('-')}` : ''}</span>
      </div>
      <div className="card-pad">
        {!d ? <div className="no-data">Loading…</div> : d.error ? <div className="no-data">This report could not be loaded.</div> : (
          <>
            <div className="pin-kpis">
              {cols.slice(0, 3).map((c) => (
                <button key={c.key} type="button" className="pin-kpi" onClick={open}>
                  <span>{c.label}</span><b>{c.kind === 'money' ? compactMoney(d.totals?.[c.key]) : formatMetric(d.totals?.[c.key], c.kind)}</b>
                </button>
              ))}
            </div>
            {metric && <BarChart rows={d.rows} metric={metric.key} kind={metric.kind} limit={5} onPick={open} />}
          </>
        )}
      </div>
    </div>
  );
}

export function MyTarget() {
  const navigate = useNavigate();
  const [d, setD] = useState(null);
  useEffect(() => { api('/targets/me').then(setD).catch(() => {}); }, []);
  const r = d?.row;
  if (!r) return null;
  const pct = r.premium_pct ?? r.policies_pct ?? 0;
  const tone = pct >= 100 ? 'var(--success)' : pct >= 60 ? 'var(--warning)' : 'var(--danger)';
  return (
    <div className="card card-pad my-target kpi-link" role="button" tabIndex={0} onClick={() => navigate('/page/reports?tab=targets')}>
      <Ic name="target" size={20} />
      <div className="my-target-txt">
        <b>My target this month</b>
        <span>
          {r.premium_target ? <>Premium ₹ {formatMetric(r.premium_done, 'money')} of ₹ {formatMetric(r.premium_target, 'money')} ({r.premium_pct}%)</> : null}
          {r.premium_target && r.policies_target ? ' · ' : ''}
          {r.policies_target ? <>{r.policies_done} of {r.policies_target} policies ({r.policies_pct}%)</> : null}
        </span>
      </div>
      <span className="tgt-track wide"><span className="tgt-fill" style={{ width: `${Math.min(pct, 100)}%`, background: tone }} /></span>
    </div>
  );
}

export default function PinnedReports() {
  const [list, setList] = useState([]);
  useEffect(() => { api('/report-library').then((d) => setList((d.reports || []).filter((r) => r.pinned))).catch(() => {}); }, []);
  if (!list.length) return null;
  return (
    <>
      <div className="dash-overview-title">My reports <span className="dash-period">pinned from Reports → Saved reports</span></div>
      <div className="pin-grid">{list.map((r) => <Pinned key={r.id} rep={r} />)}</div>
    </>
  );
}
