// Renewal calendar: a month of days, each showing how many renewable policies expire that day and how many
// are renewed / pending / lost. A day opens its policies.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import toast from '../../components/toast.js';
import { Ic } from '../../components/Icons.jsx';
import { formatMetric, compactMoney } from '../reportConstants.js';

const pad = (n) => String(n).padStart(2, '0');
const thisMonth = () => new Date().toLocaleDateString('sv-SE').slice(0, 7);
const shiftMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7); };
const monthName = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }); };

export default function RenewalCalendar({ filters, onOpenDay }) {
  const [month, setMonth] = useState(thisMonth());
  const [d, setD] = useState(null);
  const [y, mo] = month.split('-').map(Number);
  const last = new Date(y, mo, 0).getDate();
  const from = `${month}-01`, to = `${month}-${pad(last)}`;
  useEffect(() => {
    const q = new URLSearchParams({ from, to, g: 'day' });
    if (filters && Object.keys(filters).length) q.set('f', JSON.stringify(filters));
    setD(null);
    api('/reports/renewals?' + q).then(setD).catch((e) => toast.error(e.message || 'Could not load the calendar'));
  }, [month, JSON.stringify(filters)]);   // eslint-disable-line react-hooks/exhaustive-deps
  const byDay = useMemo(() => Object.fromEntries((d?.rows || []).map((r) => [r.label, r])), [d]);
  const today = new Date().toLocaleDateString('sv-SE');
  const lead = (new Date(y, mo - 1, 1).getDay() + 6) % 7;   // Monday first
  const cells = [...Array(lead).fill(null), ...Array.from({ length: last }, (_, i) => `${month}-${pad(i + 1)}`)];
  const t = d?.totals || {};

  return (
    <>
      <div className="card card-pad report-controls">
        <div className="tgt-head">
          <button type="button" className="btn ghost sm" onClick={() => setMonth(shiftMonth(month, -1))}><Ic name="chevron-left" size={14} /></button>
          <b className="tgt-month">{monthName(month)}</b>
          <button type="button" className="btn ghost sm" onClick={() => setMonth(shiftMonth(month, 1))}><Ic name="chevron-right" size={14} /></button>
          {month !== thisMonth() && <button type="button" className="btn ghost sm" onClick={() => setMonth(thisMonth())}>This month</button>}
          <span className="cal-legend"><i className="cal-k due" /> due <i className="cal-k ok" /> renewed <i className="cal-k lost" /> lost</span>
        </div>
        <div className="report-note">
          {d ? <>{formatMetric(t.due, 'int')} renewal{t.due === 1 ? '' : 's'} due this month · {formatMetric(t.renewed, 'int')} renewed · {formatMetric(t.pending, 'int')} pending · premium ₹ {compactMoney(t.premium_due)}. Click a day for its policies.</> : 'Loading…'}
        </div>
      </div>
      <div className="card card-pad">
        <div className="cal-grid">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => <div key={w} className="cal-wd">{w}</div>)}
          {cells.map((day, i) => {
            if (!day) return <div key={'x' + i} className="cal-cell empty" />;
            const r = byDay[day];
            const due = r?.due || 0;
            return (
              <button key={day} type="button" className={'cal-cell' + (due ? ' has' : '') + (day === today ? ' today' : '') + (day < today && r?.pending ? ' late' : '')}
                disabled={!due} onClick={() => onOpenDay(day)} title={due ? `${due} due · ${r.renewed} renewed · ${r.pending} pending · ${r.lost} lost` : ''}>
                <span className="cal-n">{Number(day.slice(8))}</span>
                {due > 0 && (
                  <span className="cal-body">
                    <b>{due}</b>
                    <span className="cal-bars">
                      {r.renewed > 0 && <i className="cal-k ok" style={{ flex: r.renewed }} />}
                      {r.pending > 0 && <i className="cal-k due" style={{ flex: r.pending }} />}
                      {(r.lost + r.elsewhere) > 0 && <i className="cal-k lost" style={{ flex: r.lost + r.elsewhere }} />}
                    </span>
                    <span className="cal-prem">₹ {compactMoney(r.premium_due)}</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
