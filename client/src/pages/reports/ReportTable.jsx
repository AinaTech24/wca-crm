// The report's table: a summary (one level, or two with sub-totals) whose groups open in place, or a
// matrix (rows × columns). Every number is a link to the records behind it.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { fmt as fmtDate } from '../../components/DateField.jsx';
import { Ic } from '../../components/Icons.jsx';
import { formatMetric } from '../reportConstants.js';

const num = (v) => Number(v) || 0;

/** How a figure moved against the comparison period, as a small coloured line under it. */
export function Delta({ cur, prev, kind }) {
  if (prev === undefined) return null;
  const c = num(cur), p = num(prev);
  if (kind === 'pct' || kind === 'share') {
    const d = Math.round(c - p);
    return <span className={'rep-delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : '')} title={`Earlier: ${formatMetric(p, kind)}`}>{d > 0 ? '▲' : d < 0 ? '▼' : '•'} {Math.abs(d)} pts</span>;
  }
  if (!p) return <span className="rep-delta" title={`Earlier: ${formatMetric(p, kind)}`}>{c ? 'new' : '—'}</span>;
  const pct = ((c - p) / p) * 100;
  return (
    <span className={'rep-delta ' + (pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : '')} title={`Earlier: ${formatMetric(p, kind)}`}>
      {pct > 0.05 ? '▲' : pct < -0.05 ? '▼' : '•'} {Math.abs(pct) >= 100 ? Math.round(Math.abs(pct)) : Math.abs(pct).toFixed(1)}%
    </span>
  );
}

// One number as a link. A metric that counts a condition (Lost, Renewed …) narrows the list to it.
function Cell({ value, col, onOpen, prev, showPrev }) {
  return (
    <td className="num">
      <button type="button" className="rep-cell" onClick={onOpen} title={`Show the records${col.drill ? ` — ${col.label}` : ''}`}>
        {formatMetric(value, col.kind)}
      </button>
      {showPrev && <Delta cur={value} prev={prev} kind={col.kind} />}
    </td>
  );
}

// The first records of a group, opened in place under its row.
function InlineRecords({ kind, query, group, colSpan, onAll }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    const q = new URLSearchParams({ ...query, g: group.g, v: group.v });
    api(`/reports/${kind}/records?${q}`).then(setD).catch(() => setD({ rows: [], columns: [], total: 0 }));
  }, [kind, JSON.stringify(query), group.g, group.v]);   // eslint-disable-line react-hooks/exhaustive-deps
  const show = (v, k) => (v === null || v === undefined || v === '' ? '—' : k === 'money' ? formatMetric(v, 'money') : k === 'date' ? fmtDate(String(v).slice(0, 10)) : String(v));
  return (
    <tr className="rep-inline">
      <td colSpan={colSpan}>
        {!d ? <div className="rep-inline-load">Loading records…</div> : (
          <div className="rep-inline-box">
            <table className="grid dense">
              <thead><tr>{d.columns.map((c) => <th key={c.key} className={c.kind === 'money' ? 'num' : ''}>{c.label}</th>)}</tr></thead>
              <tbody>
                {d.rows.slice(0, 10).map((r) => (
                  <tr key={r.id} className="dt-click" onClick={() => onAll(r, d.page)} title="Open this record">
                    {d.columns.map((c) => <td key={c.key} className={c.kind === 'money' ? 'num' : ''}>{show(r[c.key], c.kind)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {d.total > 10 && <button type="button" className="btn ghost sm" onClick={() => onAll(null)}>Show all {d.total.toLocaleString('en-IN')} records</button>}
          </div>
        )}
      </td>
    </tr>
  );
}

export function SummaryTable({ data, kind, query, onDrill, onOpenRecord }) {
  const cols = data.columns;
  const two = !!data.groupBy2;
  const cmp = data.compare;
  const prevBy = useMemo(() => Object.fromEntries((cmp?.rows || []).map((r) => [r.label, r])), [cmp]);
  const pairsBy = useMemo(() => {
    const m = {};
    for (const p of data.pairs || []) (m[p.label] ||= []).push(p);
    return m;
  }, [data.pairs]);
  const [open, setOpen] = useState(() => new Set());
  useEffect(() => { setOpen(new Set()); }, [data.groupBy, data.groupBy2, kind]);
  const toggle = (label) => setOpen((s) => { const n = new Set(s); n.has(label) ? n.delete(label) : n.add(label); return n; });
  const allOpen = data.rows.length > 0 && data.rows.every((r) => open.has(r.label));
  const span = cols.length + 1;

  if (!data.rows.length) return <div className="no-data" style={{ padding: 28 }}>Nothing in this period. Try a wider date range or fewer filters.</div>;
  return (
    <div className="table-wrap">
      <table className="grid rep-table">
        <thead>
          <tr>
            <th>
              <button type="button" className="rep-expand-all" onClick={() => setOpen(allOpen ? new Set() : new Set(data.rows.map((r) => r.label)))}
                title={allOpen ? 'Close every group' : two ? `Open every group to its ${data.groupLabel2}` : 'Open every group to its records'}>
                <Ic name={allOpen ? 'chevron' : 'chevron-right'} size={14} />
              </button>
              {data.groupLabel}{two ? <span className="rep-sub-h"> › {data.groupLabel2}</span> : ''}
            </th>
            {cols.map((c) => <th key={c.key} className="num">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => {
            const isOpen = open.has(r.label);
            return (
              <Fragment key={r.label}>
                <tr className={'rep-group' + (isOpen ? ' open' : '')}>
                  <td>
                    <button type="button" className="rep-caret" onClick={() => toggle(r.label)} aria-expanded={isOpen}
                      title={isOpen ? 'Close' : two ? `Show by ${data.groupLabel2}` : 'Show the records here'}>
                      <Ic name={isOpen ? 'chevron' : 'chevron-right'} size={14} />
                    </button>
                    <button type="button" className="rep-label" onClick={() => onDrill({ g: data.groupBy, v: r.label })} title="Show all the records in this group">{r.label}</button>
                    {two && <span className="rep-count">{(pairsBy[r.label] || []).length}</span>}
                  </td>
                  {cols.map((c) => (
                    <Cell key={c.key} value={r[c.key]} col={c} showPrev={!!cmp} prev={cmp ? prevBy[r.label]?.[c.key] ?? 0 : undefined}
                      onOpen={() => onDrill({ g: data.groupBy, v: r.label, metric: c.drill ? c.key : undefined })} />
                  ))}
                </tr>
                {isOpen && two && (pairsBy[r.label] || []).map((p) => (
                  <tr key={r.label + '|' + p.label2} className="rep-subrow">
                    <td><button type="button" className="rep-label sub" onClick={() => onDrill({ g: data.groupBy, v: r.label, g2: data.groupBy2, v2: p.label2 })}>{p.label2}</button></td>
                    {cols.map((c) => (
                      <Cell key={c.key} value={p[c.key]} col={c}
                        onOpen={() => onDrill({ g: data.groupBy, v: r.label, g2: data.groupBy2, v2: p.label2, metric: c.drill ? c.key : undefined })} />
                    ))}
                  </tr>
                ))}
                {isOpen && !two && (
                  <InlineRecords kind={kind} query={query} group={{ g: data.groupBy, v: r.label }} colSpan={span}
                    onAll={(rec, page) => (rec ? onOpenRecord(rec, page) : onDrill({ g: data.groupBy, v: r.label }))} />
                )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="dt-foot rep-total">
            <td><button type="button" className="rep-label" onClick={() => onDrill({})}>Total</button></td>
            {cols.map((c) => (
              <Cell key={c.key} value={data.totals?.[c.key]} col={c} showPrev={!!cmp} prev={cmp ? cmp.totals?.[c.key] ?? 0 : undefined}
                onOpen={() => onDrill({ metric: c.drill ? c.key : undefined })} />
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// Rows × columns of one metric. Past 20 columns the grid would be unreadable, so the busiest 20 show.
export function MatrixTable({ data, metric, onDrill }) {
  const col = data.columns.find((c) => c.key === metric) || data.columns[0];
  const MAXC = 20;
  const cols = (data.cols || []).slice(0, MAXC);
  const cell = useMemo(() => {
    const m = {};
    for (const p of data.pairs || []) m[p.label + '\u0000' + p.label2] = p;
    return m;
  }, [data.pairs]);
  if (!data.groupBy2) return <div className="no-data" style={{ padding: 28 }}>Choose what goes across the columns.</div>;
  if (!data.rows.length) return <div className="no-data" style={{ padding: 28 }}>Nothing in this period.</div>;
  const values = (data.pairs || []).map((p) => num(p[col.key]));
  const max = Math.max(...values, 0) || 1;
  const metricArg = col.drill ? col.key : undefined;
  return (
    <div className="table-wrap">
      <table className="grid rep-table rep-matrix">
        <thead>
          <tr>
            <th className="rep-corner">{data.groupLabel} <span className="rep-sub-h">↓</span> / {data.groupLabel2} <span className="rep-sub-h">→</span></th>
            {cols.map((c) => (
              <th key={c.label2} className="num">
                <button type="button" className="rep-label head" onClick={() => onDrill({ g: data.groupBy2, v: c.label2, metric: metricArg })} title={`All records for ${c.label2}`}>{c.label2}</button>
              </th>
            ))}
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.label}>
              <td><button type="button" className="rep-label" onClick={() => onDrill({ g: data.groupBy, v: r.label, metric: metricArg })}>{r.label}</button></td>
              {cols.map((c) => {
                const p = cell[r.label + '\u0000' + c.label2];
                const v = p ? num(p[col.key]) : 0;
                return (
                  <td key={c.label2} className="num rep-heat" style={v ? { background: `rgba(27,111,176,${0.06 + (v / max) * 0.3})` } : undefined}>
                    {p && v ? (
                      <button type="button" className="rep-cell" title={`${r.label} · ${c.label2} — show the records`}
                        onClick={() => onDrill({ g: data.groupBy, v: r.label, g2: data.groupBy2, v2: c.label2, metric: metricArg })}>
                        {formatMetric(v, col.kind)}
                      </button>
                    ) : <span className="rep-zero">·</span>}
                  </td>
                );
              })}
              <td className="num rep-rowtotal">
                <button type="button" className="rep-cell" onClick={() => onDrill({ g: data.groupBy, v: r.label, metric: metricArg })}>{formatMetric(r[col.key], col.kind)}</button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="dt-foot rep-total">
            <td>Total</td>
            {cols.map((c) => (
              <td key={c.label2} className="num"><button type="button" className="rep-cell" onClick={() => onDrill({ g: data.groupBy2, v: c.label2, metric: metricArg })}>{formatMetric(c[col.key], col.kind)}</button></td>
            ))}
            <td className="num"><button type="button" className="rep-cell" onClick={() => onDrill({ metric: metricArg })}>{formatMetric(data.totals?.[col.key], col.kind)}</button></td>
          </tr>
        </tfoot>
      </table>
      {(data.cols || []).length > MAXC && <div className="report-note" style={{ padding: '8px 14px' }}>Showing the {MAXC} largest of {data.cols.length} columns — use a filter to see others.</div>}
    </div>
  );
}
