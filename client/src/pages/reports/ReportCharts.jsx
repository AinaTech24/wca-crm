// The report's charts — bars, a pie of the shares, the month-by-month trend and a funnel — drawn as
// plain SVG / HTML. Every bar, slice, point and stage opens the records behind it.
import { formatMetric } from '../reportConstants.js';

export const CHART_COLORS = ['#1b6fb0', '#e9531e', '#16874e', '#8bb6dc', '#d98324', '#7a5cc4', '#5b6472', '#c2417a'];
const num = (v) => Number(v) || 0;
const monthName = (ym) => {
  const [y, m] = String(ym).split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
};

// Horizontal bars — groups are named things (users, products, insurers), and names need room.
export function BarChart({ rows, metric, kind, onPick, limit = 10 }) {
  const top = rows.slice(0, limit);
  const max = Math.max(...top.map((r) => num(r[metric])), 0);
  if (!top.length || !max) return <div className="no-data">Nothing to chart for this period</div>;
  return (
    <div className="rank-chart">
      {top.map((r, i) => (
        <div className="rank-row rank-link" key={r.label} role="button" tabIndex={0} title={`Show the records for ${r.label}`}
          onClick={() => onPick(r.label)} onKeyDown={(e) => { if (e.key === 'Enter') onPick(r.label); }}>
          <div className="rank-label" title={r.label}>{r.label}</div>
          <div className="rank-track">
            <div className="rank-bar" style={{ width: `${Math.max((num(r[metric]) / max) * 100, 1.5)}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
          </div>
          <div className="rank-value">{formatMetric(r[metric], kind)}</div>
        </div>
      ))}
    </div>
  );
}

// A donut of each group's share; past the seventh the rest are one "Others" slice (not a single group, so not a link).
export function PieChart({ rows, metric, kind, onPick }) {
  const pos = rows.filter((r) => num(r[metric]) > 0).sort((a, b) => num(b[metric]) - num(a[metric]));
  const total = pos.reduce((s, r) => s + num(r[metric]), 0);
  if (!total) return <div className="no-data">Nothing to chart for this period</div>;
  const slices = pos.slice(0, 7).map((r, i) => ({ label: r.label, value: num(r[metric]), color: CHART_COLORS[i % CHART_COLORS.length], link: true }));
  const rest = pos.slice(7).reduce((s, r) => s + num(r[metric]), 0);
  if (rest > 0) slices.push({ label: `Others (${pos.length - 7})`, value: rest, color: '#c4ccd6', link: false });
  const R = 90, r = 54, cx = 100, cy = 100;
  let a0 = -Math.PI / 2;
  const arcs = slices.map((s) => {
    const frac = s.value / total;
    const a1 = a0 + frac * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (ang, rad) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
    const [x0, y0] = p(a0, R), [x1, y1] = p(a1, R), [x2, y2] = p(a1, r), [x3, y3] = p(a0, r);
    // a lone slice of 100% can't be drawn as one arc
    const d = frac >= 0.9999
      ? `M ${cx} ${cy - R} A ${R} ${R} 0 1 1 ${cx - 0.01} ${cy - R} L ${cx - 0.01} ${cy - r} A ${r} ${r} 0 1 0 ${cx} ${cy - r} Z`
      : `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${r} ${r} 0 ${large} 0 ${x3} ${y3} Z`;
    a0 = a1;
    return { ...s, d, pct: frac * 100 };
  });
  return (
    <div className="pie-wrap">
      <svg viewBox="0 0 200 200" className="pie-svg" role="img" aria-label="Share by group">
        {arcs.map((s) => (
          <path key={s.label} d={s.d} fill={s.color} className={s.link ? 'pie-slice link' : 'pie-slice'}
            onClick={s.link ? () => onPick(s.label) : undefined}>
            <title>{`${s.label}: ${formatMetric(s.value, kind)} (${s.pct.toFixed(1)}%)`}</title>
          </path>
        ))}
        <text x="100" y="96" textAnchor="middle" className="pie-total-l">Total</text>
        <text x="100" y="116" textAnchor="middle" className="pie-total-v">{formatMetric(total, kind === 'money' ? 'money' : 'int')}</text>
      </svg>
      <div className="pie-legend">
        {arcs.map((s) => (
          <button key={s.label} type="button" className={'pie-leg' + (s.link ? '' : ' static')} onClick={s.link ? () => onPick(s.label) : undefined} disabled={!s.link}>
            <span className="pie-dot" style={{ background: s.color }} />
            <span className="pie-leg-l" title={s.label}>{s.label}</span>
            <span className="pie-leg-v">{formatMetric(s.value, kind)}</span>
            <span className="pie-leg-p">{s.pct.toFixed(1)}%</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Month by month across the period. A point opens that month's records.
export function TrendChart({ rows, metric, kind, onPick }) {
  const pts = (rows || []).filter((r) => /^\d{4}-\d{2}$/.test(r.label));
  if (!pts.length) return <div className="no-data">No dated records in this period</div>;
  const W = 760, H = 240, L = 62, Rr = 16, T = 16, B = 34;
  const max = Math.max(...pts.map((r) => num(r[metric])), 0) || 1;
  const step = pts.length > 1 ? (W - L - Rr) / (pts.length - 1) : 0;
  const x = (i) => (pts.length > 1 ? L + i * step : (L + W - Rr) / 2);
  const y = (v) => T + (H - T - B) * (1 - num(v) / max);
  const line = pts.map((r, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(r[metric])}`).join(' ');
  const area = `${line} L ${x(pts.length - 1)} ${H - B} L ${x(0)} ${H - B} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
  const every = Math.ceil(pts.length / 12);
  return (
    <div className="trend-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="trend-svg" role="img" aria-label="Month by month">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - Rr} y1={y(t)} y2={y(t)} className="trend-grid" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" className="trend-axis">{kind === 'money' ? compact(t) : formatMetric(t, kind)}</text>
          </g>
        ))}
        <path d={area} className="trend-area" />
        <path d={line} className="trend-line" />
        {pts.map((r, i) => (
          <g key={r.label} className="trend-pt" onClick={() => onPick(r.label)}>
            <circle cx={x(i)} cy={y(r[metric])} r="12" className="trend-hit" />
            <circle cx={x(i)} cy={y(r[metric])} r="4.5" className="trend-dot" />
            <title>{`${monthName(r.label)}: ${formatMetric(r[metric], kind)} — click for the records`}</title>
            {i % every === 0 && <text x={x(i)} y={H - 12} textAnchor="middle" className="trend-axis">{monthName(r.label)}</text>}
          </g>
        ))}
      </svg>
    </div>
  );
}
const compact = (n) => (n >= 1e7 ? `${(n / 1e7).toFixed(1)}Cr` : n >= 1e5 ? `${(n / 1e5).toFixed(1)}L` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(Math.round(n)));

// Stages in order, each as wide as how many sit at that stage now, with its share of the whole.
export function FunnelChart({ rows, order, metric, kind, onPick }) {
  const by = Object.fromEntries((rows || []).map((r) => [r.label, num(r[metric])]));
  const stages = order.map((s) => ({ label: s, value: by[s] || 0 }));
  const max = Math.max(...stages.map((s) => s.value), 0);
  const all = stages.reduce((t, s) => t + s.value, 0);
  if (!max) return <div className="no-data">Nothing in these stages for this period</div>;
  return (
    <div className="funnel">
      {stages.map((s, i) => {
        return (
          <div key={s.label} className="funnel-row" role="button" tabIndex={0} title={`Show the records at ${s.label}`}
            onClick={() => onPick(s.label)} onKeyDown={(e) => { if (e.key === 'Enter') onPick(s.label); }}>
            <div className="funnel-label">{s.label}</div>
            <div className="funnel-track">
              <div className="funnel-bar" style={{ width: `${Math.max((s.value / max) * 100, 2)}%`, background: CHART_COLORS[i % CHART_COLORS.length] }}>
                <span>{formatMetric(s.value, kind)}</span>
              </div>
            </div>
            <div className="funnel-step">{all ? `${Math.round((s.value / all) * 100)}%` : ''}</div>
          </div>
        );
      })}
    </div>
  );
}
