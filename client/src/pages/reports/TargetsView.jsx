// Targets: each person's premium and policy-count target for a month, what they have done, and the %.
// An admin edits targets in place and can copy last month's. Achieved figures open the policies behind them.
import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import toast from '../../components/toast.js';
import { Ic } from '../../components/Icons.jsx';
import { formatMetric } from '../reportConstants.js';

const thisMonth = () => new Date().toLocaleDateString('sv-SE').slice(0, 7);
const shiftMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const monthName = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); };

function Bar({ pct }) {
  if (pct === null || pct === undefined) return <span className="att-dow">no target</span>;
  const tone = pct >= 100 ? 'var(--success)' : pct >= 60 ? 'var(--warning)' : 'var(--danger)';
  return (
    <span className="tgt-bar" title={`${pct}% of target`}>
      <span className="tgt-track"><span className="tgt-fill" style={{ width: `${Math.min(pct, 100)}%`, background: tone }} /></span>
      <b style={{ color: tone }}>{pct}%</b>
    </span>
  );
}

export default function TargetsView({ onOpenPolicies }) {
  const [month, setMonth] = useState(thisMonth());
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState({});   // user_name → { premium_target, policies_target } being typed
  const load = () => api('/targets?month=' + month).then((x) => { setD(x); setEdit({}); }).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, [month]);   // eslint-disable-line react-hooks/exhaustive-deps

  async function save(r) {
    const e = edit[r.user_name] || {};
    try {
      await api('/targets', { method: 'PUT', body: { month, user_name: r.user_name, premium_target: e.premium_target ?? r.premium_target, policies_target: e.policies_target ?? r.policies_target } });
      toast.success(`Target saved for ${r.user_name}`); load();
    } catch (err) { toast.error(err.message || 'Could not save'); }
  }
  async function copyLast() {
    try { const r = await api('/targets/copy', { method: 'POST', body: { from: shiftMonth(month, -1), to: month } }); toast.success(r.copied ? `Copied ${r.copied} target${r.copied === 1 ? '' : 's'} from ${monthName(shiftMonth(month, -1))}` : 'Nothing new to copy'); load(); }
    catch (err) { toast.error(err.message); }
  }
  const rows = d?.rows || [];
  const tot = rows.reduce((t, r) => ({ pt: t.pt + r.premium_target, pd: t.pd + r.premium_done, ct: t.ct + r.policies_target, cd: t.cd + r.policies_done }), { pt: 0, pd: 0, ct: 0, cd: 0 });
  const set = (name, k, v) => setEdit((e) => ({ ...e, [name]: { ...e[name], [k]: v } }));

  return (
    <>
      <div className="card card-pad report-controls">
        <div className="tgt-head">
          <button type="button" className="btn ghost sm" onClick={() => setMonth(shiftMonth(month, -1))}><Ic name="chevron-left" size={14} /></button>
          <b className="tgt-month">{monthName(month)}</b>
          <button type="button" className="btn ghost sm" onClick={() => setMonth(shiftMonth(month, 1))}><Ic name="chevron-right" size={14} /></button>
          {month !== thisMonth() && <button type="button" className="btn ghost sm" onClick={() => setMonth(thisMonth())}>This month</button>}
          {d?.canEdit && <button type="button" className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={copyLast}><Ic name="refresh" size={13} /> Copy last month&apos;s targets</button>}
        </div>
        <div className="report-note">Achieved = gross premium and number of policies owned by the person, starting in the month (as in the Business Report).{d?.canEdit ? ' Type a target and press Save.' : ''}</div>
      </div>
      <div className="report-kpis">
        <div className="kpi-card" data-tone="neutral"><div className="kpi-card-head"><span className="kpi-card-label">Premium target</span></div><div className="kpi-card-num">₹ {formatMetric(tot.pt, 'money')}</div></div>
        <div className="kpi-card kpi-link" data-tone="neutral" role="button" tabIndex={0} onClick={() => d && onOpenPolicies(d.from, d.to, null)}><div className="kpi-card-head"><span className="kpi-card-label">Premium achieved</span></div><div className="kpi-card-num">₹ {formatMetric(tot.pd, 'money')}</div><div className="kpi-card-hint">{tot.pt ? `${Math.round((tot.pd / tot.pt) * 100)}% of target` : ''}</div></div>
        <div className="kpi-card" data-tone="neutral"><div className="kpi-card-head"><span className="kpi-card-label">Policies target</span></div><div className="kpi-card-num">{tot.ct}</div></div>
        <div className="kpi-card kpi-link" data-tone="neutral" role="button" tabIndex={0} onClick={() => d && onOpenPolicies(d.from, d.to, null)}><div className="kpi-card-head"><span className="kpi-card-label">Policies achieved</span></div><div className="kpi-card-num">{tot.cd}</div><div className="kpi-card-hint">{tot.ct ? `${Math.round((tot.cd / tot.ct) * 100)}% of target` : ''}</div></div>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="grid rep-table">
            <thead><tr><th>Person</th><th className="num">Premium target</th><th className="num">Achieved</th><th>Progress</th><th className="num">Policies target</th><th className="num">Achieved</th><th>Progress</th>{d?.canEdit && <th />}</tr></thead>
            <tbody>
              {!d && <tr><td colSpan={8} className="no-data">Loading…</td></tr>}
              {rows.map((r) => {
                const e = edit[r.user_name] || {};
                const dirty = e.premium_target !== undefined || e.policies_target !== undefined;
                return (
                  <tr key={r.user_name}>
                    <td><b>{r.user_name}</b>{r.department ? <span className="att-dow"> {r.department}</span> : null}</td>
                    <td className="num">{d.canEdit ? <input className="tgt-in" type="number" min="0" value={e.premium_target ?? (r.premium_target || '')} placeholder="0" onChange={(x) => set(r.user_name, 'premium_target', x.target.value)} /> : `₹ ${formatMetric(r.premium_target, 'money')}`}</td>
                    <td className="num"><button type="button" className="rep-cell" onClick={() => onOpenPolicies(d.from, d.to, r.user_name)}>₹ {formatMetric(r.premium_done, 'money')}</button></td>
                    <td><Bar pct={r.premium_pct} /></td>
                    <td className="num">{d.canEdit ? <input className="tgt-in sm" type="number" min="0" value={e.policies_target ?? (r.policies_target || '')} placeholder="0" onChange={(x) => set(r.user_name, 'policies_target', x.target.value)} /> : r.policies_target}</td>
                    <td className="num"><button type="button" className="rep-cell" onClick={() => onOpenPolicies(d.from, d.to, r.user_name)}>{r.policies_done}</button></td>
                    <td><Bar pct={r.policies_pct} /></td>
                    {d.canEdit && <td>{dirty && <button type="button" className="btn blue sm" onClick={() => save(r)}>Save</button>}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
