// Filters on a report: chips for what is applied (click to change, × to remove), and "Add filter" to
// pick a field and tick its values. The values offered are the ones in the period, most common first.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import { Ic } from '../../components/Icons.jsx';

function ValuePicker({ kind, query, dim, dimLabel, chosen, onApply, onClose }) {
  const [vals, setVals] = useState(null);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(() => new Set(chosen || []));
  useEffect(() => {
    const p = new URLSearchParams({ ...query, dim });
    api(`/reports/${kind}/values?${p}`).then((d) => setVals(d.values || [])).catch(() => setVals([]));
  }, [kind, dim, JSON.stringify(query)]);   // eslint-disable-line react-hooks/exhaustive-deps
  const shown = (vals || []).filter((v) => !q || String(v.value).toLowerCase().includes(q.toLowerCase()));
  const toggle = (v) => setPick((s) => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); return n; });
  return (
    <div className="rep-pick">
      <div className="rep-pick-head"><b>{dimLabel}</b><button type="button" className="rep-x" onClick={onClose} aria-label="Close"><Ic name="x" size={14} /></button></div>
      <input className="rep-pick-search" autoFocus placeholder={`Search ${dimLabel.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="rep-pick-list">
        {!vals && <div className="rep-pick-empty">Loading…</div>}
        {vals && !shown.length && <div className="rep-pick-empty">Nothing in this period</div>}
        {shown.map((v) => (
          <label key={v.value} className="rep-pick-opt">
            <input type="checkbox" checked={pick.has(v.value)} onChange={() => toggle(v.value)} />
            <span className="rep-pick-l">{v.value}</span><span className="rep-pick-n">{Number(v.count).toLocaleString('en-IN')}</span>
          </label>
        ))}
      </div>
      <div className="rep-pick-foot">
        <button type="button" className="btn ghost sm" onClick={() => setPick(new Set())}>Clear</button>
        <button type="button" className="btn blue sm" onClick={() => onApply([...pick])}>Apply{pick.size ? ` (${pick.size})` : ''}</button>
      </div>
    </div>
  );
}

export default function ReportFilters({ kind, dims, filters, query, onChange }) {
  const [open, setOpen] = useState(null);   // null | 'fields' | <dim key>
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(null); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const label = (k) => dims.find((d) => d.key === k)?.label || k;
  const set = (k, vals) => { const n = { ...filters }; if (vals.length) n[k] = vals; else delete n[k]; onChange(n); setOpen(null); };
  // A field's own filter is left out of the values it offers, so its other choices stay visible.
  const others = (k) => { const f = { ...filters }; delete f[k]; return { ...query, f: JSON.stringify(f) }; };
  const active = Object.entries(filters);

  return (
    <div className="rep-filters" ref={ref}>
      <span className="rep-filters-l"><Ic name="funnel" size={14} /> Filters</span>
      {active.map(([k, v]) => (
        <span key={k} className="rep-chip">
          <button type="button" className="rep-chip-b" onClick={() => setOpen(open === k ? null : k)} title="Change">
            <b>{label(k)}:</b> {v.length > 2 ? `${v.slice(0, 2).join(', ')} +${v.length - 2}` : v.join(', ')}
          </button>
          <button type="button" className="rep-x" onClick={() => set(k, [])} aria-label={`Remove the ${label(k)} filter`}><Ic name="x" size={12} /></button>
          {open === k && <ValuePicker kind={kind} query={others(k)} dim={k} dimLabel={label(k)} chosen={v} onApply={(vals) => set(k, vals)} onClose={() => setOpen(null)} />}
        </span>
      ))}
      <span className="rep-chip-add">
        <button type="button" className="btn ghost sm" onClick={() => setOpen(open === 'fields' ? null : 'fields')}><Ic name="plus" size={13} /> Add filter</button>
        {open === 'fields' && (
          <div className="rep-pick fields">
            <div className="rep-pick-head"><b>Filter by</b></div>
            <div className="rep-pick-list">
              {dims.filter((d) => !filters[d.key]).map((d) => (
                <button key={d.key} type="button" className="rep-pick-field" onClick={() => setOpen('new:' + d.key)}>{d.label}</button>
              ))}
            </div>
          </div>
        )}
        {String(open).startsWith('new:') && (() => {
          const k = open.slice(4);
          return <ValuePicker kind={kind} query={others(k)} dim={k} dimLabel={label(k)} chosen={[]} onApply={(vals) => set(k, vals)} onClose={() => setOpen(null)} />;
        })()}
      </span>
      {active.length > 0 && <button type="button" className="rep-clear" onClick={() => onChange({})}>Clear all</button>}
    </div>
  );
}
