import { useState, useMemo, useEffect, useRef } from 'react';
import EmptyState from './EmptyState.jsx';
import Select from './Select.jsx';
import { Ic } from './Icons.jsx';
import { useExit } from './useExit.js';

/**
 * One table for the whole CRM — consistent header, density, numeric alignment,
 * hover, sticky header, skeleton loading, empty state and real-time row highlight.
 *
 * columns: [{ key, label, align?, num?, width?, render?(row, index), th? }]
 * rows / loading / rowKey / index / actions / flash / empty / onRowClick / dense
 *
 * Table-container header (squarish fields) — when `title` is given, DataTable
 * renders the card header itself: title + count on the left, search + filter
 * dropdowns on the right. Otherwise the toolbar renders above the table.
 * title:   heading shown in the card header
 * count:   number shown next to the title
 * search:  boolean (default true) -> live search over column values
 * searchPlaceholder, searchKeys
 * filters: [{ key, value, onChange, options:[{value,label}], predicate?(row,value) }]
 * headerExtra: node rendered in the header, right of the filters
 */
export default function DataTable({
  columns, rows = [], loading = false, rowKey = (r) => r.id, index = false,
  actions, flash, empty = {}, onRowClick, dense = false, skeletonRows = 6,
  selectable = false, selected, onToggleRow, onToggleAll, hideScroll = true,
  search = true, searchPlaceholder = 'Search…', searchKeys, filters = [], headerExtra,
  title, count, pageSize, maxBodyHeight = 560, onExport, total,
}) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [colFilters, setColFilters] = useState({}); // { columnKey: selectedValue }
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef(null);
  const { render: filterRender, closing: filterClosing } = useExit(filterOpen, 140);
  const keys = searchKeys || columns.map((c) => c.key);

  // Auto-detect categorical columns (few distinct, non-numeric, not unique
  // identifiers) so every table gets a meaningful filter dropdown with no
  // per-page config. Explicitly-passed `filters` keys are skipped.
  const explicitKeys = new Set(filters.map((f) => f.key));
  const autoFilters = useMemo(() => {
    if (!rows.length) return [];
    const out = [];
    for (const c of columns) {
      if (c.num || c.noFilter || explicitKeys.has(c.key)) continue;
      const vals = new Set();
      let bail = false;
      for (const r of rows) {
        const v = r[c.key];
        if (v == null || v === '') continue;
        vals.add(String(v));
        if (vals.size > 20) { bail = true; break; }
      }
      if (bail) continue;
      if (vals.size >= 2 && vals.size < rows.length) {
        out.push({ key: c.key, label: c.label, values: [...vals].sort((a, b) => a.localeCompare(b)) });
      }
    }
    return out;
  }, [rows, columns]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!filterOpen) return;
    function onDoc(e) { if (filterRef.current && !filterRef.current.contains(e.target)) setFilterOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [filterOpen]);

  const activeColFilters = Object.entries(colFilters).filter(([, v]) => v && v !== 'all');

  const visible = useMemo(() => {
    let out = rows;
    const query = q.trim().toLowerCase();
    if (query) out = out.filter((r) => keys.some((k) => String(r[k] ?? '').toLowerCase().includes(query)));
    for (const f of filters) {
      if (f.value == null || f.value === '' || f.value === 'all') continue;
      out = out.filter((r) => f.predicate ? f.predicate(r, f.value) : String(r[f.key] ?? '') === String(f.value));
    }
    for (const [k, v] of activeColFilters) out = out.filter((r) => String(r[k] ?? '') === String(v));
    return out;
  }, [rows, q, keys, filters, colFilters]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pagination (client-side). Reset to first page whenever the filtered set shrinks past the current page.
  const pageCount = pageSize ? Math.max(1, Math.ceil(visible.length / pageSize)) : 1;
  useEffect(() => { if (page > pageCount - 1) setPage(0); }, [pageCount, page]);
  const start = pageSize ? page * pageSize : 0;
  const paged = pageSize ? visible.slice(start, start + pageSize) : visible;

  const lead = (selectable ? 1 : 0) + (index ? 1 : 0);
  const colCount = columns.length + lead + (actions ? 1 : 0);
  const allSelected = selectable && visible.length > 0 && visible.every((r) => selected?.has?.(rowKey(r)));
  const hasFilterMenu = autoFilters.length > 0;
  const showTools = search || filters.length > 0 || headerExtra || onExport || hasFilterMenu || total;
  const searching = q.trim() || filters.some((f) => f.value && f.value !== 'all') || activeColFilters.length > 0;

  const tools = showTools && (
    <div className="dt-tools">
      {search && (
        <div className="dt-search">
          <span className="dt-search-ic"><Ic name="search" size={16} /></span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} aria-label="Search table" />
          {q && <button className="dt-search-clear" onClick={() => setQ('')} aria-label="Clear search"><Ic name="x" size={14} /></button>}
        </div>
      )}
      {onExport && (
        <button className="dt-icon-btn" title="Export CSV" aria-label="Export CSV" onClick={onExport}><Ic name="file-export" size={17} /></button>
      )}
      {filters.map((f, i) => (
        <Select key={i} className="dt-filter" value={f.value} onChange={f.onChange}>
          {(f.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      ))}
      {hasFilterMenu && (
        <div className="dt-filter-menu" ref={filterRef}>
          <button className={'dt-icon-btn' + (activeColFilters.length ? ' active' : '')} title="Filter" aria-label="Filter" aria-expanded={filterOpen} onClick={() => setFilterOpen((o) => !o)}>
            <Ic name="funnel" size={16} />
            {activeColFilters.length > 0 && <span className="dt-filter-count">{activeColFilters.length}</span>}
          </button>
          {filterRender && (
            <div className={'dt-filter-panel' + (filterClosing ? ' closing' : '')}>
              <div className="dt-filter-head">
                <span>Filters</span>
                {activeColFilters.length > 0 && <button className="dt-filter-clear" onClick={() => setColFilters({})}>Clear all</button>}
              </div>
              {autoFilters.map((f) => (
                <div className="dt-filter-field" key={f.key}>
                  <label>{f.label}</label>
                  <Select value={colFilters[f.key] || 'all'} onChange={(e) => setColFilters((prev) => ({ ...prev, [f.key]: e.target.value }))}>
                    <option value="all">All</option>
                    {f.values.map((v) => <option key={v} value={v}>{v}</option>)}
                  </Select>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {headerExtra}
      {total != null && <span className="dt-total">{total}</span>}
    </div>
  );

  const tableEl = (
    <div className={'table-wrap' + (hideScroll ? ' no-scrollbar' : '')} style={maxBodyHeight ? { maxHeight: maxBodyHeight } : undefined}>
      <table className={'grid' + (dense ? ' dense' : '')}>
        <thead>
          <tr>
            {selectable && <th className="dt-check"><input type="checkbox" checked={allSelected} onChange={onToggleAll} aria-label="Select all rows" /></th>}
            {index && <th className="dt-idx">#</th>}
            {columns.map((c) => (
              <th key={c.key} className={c.num ? 'num' : ''} style={c.width ? { width: c.width } : undefined}>
                {c.label}
              </th>
            ))}
            {actions && <th className="dt-actions">Action</th>}
          </tr>
        </thead>
        <tbody>
          {loading && Array.from({ length: skeletonRows }).map((_, i) => (
            <tr key={'sk' + i} className="dt-skel">
              {selectable && <td><span className="skel skel-cell" style={{ width: 16 }} /></td>}
              {index && <td><span className="skel skel-cell" style={{ width: 18 }} /></td>}
              {columns.map((c) => (
                <td key={c.key} className={c.num ? 'num' : ''}>
                  <span className="skel skel-cell" style={{ width: c.num ? 54 : 70 + (i % 3) * 26 }} />
                </td>
              ))}
              {actions && <td><span className="skel skel-cell" style={{ width: 44 }} /></td>}
            </tr>
          ))}

          {!loading && visible.length === 0 && (
            <tr><td colSpan={colCount} className="dt-empty">
              <EmptyState
                icon={empty.icon}
                title={searching ? 'No matching records' : (empty.title || 'No records found')}
                sub={searching ? 'Try a different search or filter.' : empty.sub}
                action={searching ? undefined : empty.action}
              />
            </td></tr>
          )}

          {!loading && paged.map((r, i) => {
            const k = rowKey(r);
            const isSel = selectable && selected?.has?.(k);
            return (
              <tr key={k}
                className={(flash?.has?.(k) ? 'rt-flash' : '') + (onRowClick ? ' dt-click' : '') + (isSel ? ' dt-selected' : '')}
                onClick={onRowClick ? () => onRowClick(r) : undefined}>
                {selectable && <td className="dt-check" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={!!isSel} onChange={() => onToggleRow(k)} aria-label="Select row" /></td>}
                {index && <td className="dt-idx">{start + i + 1}</td>}
                {columns.map((c) => (
                  <td key={c.key} className={c.num ? 'num' : ''}>
                    {c.render ? c.render(r, i) : (r[c.key] ?? '—')}
                  </td>
                ))}
                {actions && <td className="dt-actions" onClick={(e) => e.stopPropagation()}>{actions(r)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const pager = pageSize && !loading && visible.length > pageSize && (
    <div className="dt-pager">
      <span className="dt-pager-info">
        {start + 1}–{Math.min(start + pageSize, visible.length)} of {visible.length}
      </span>
      <div className="dt-pager-ctrls">
        <button className="dt-page-btn" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} aria-label="Previous page"><Ic name="chevron-left" size={16} /></button>
        <span className="dt-page-now">Page {page + 1} / {pageCount}</span>
        <button className="dt-page-btn" disabled={page >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} aria-label="Next page"><Ic name="chevron-right" size={16} /></button>
      </div>
    </div>
  );

  // Header mode: DataTable renders the card header (title + tools) and body.
  if (title != null) {
    return (
      <>
        <div className="card-head dt-head">
          <span className="dt-title">{title}{count != null && <span className="sub"> ({count})</span>}</span>
          {tools}
        </div>
        <div className="card-pad">{tableEl}{pager}</div>
      </>
    );
  }

  // Standalone mode: toolbar above the table.
  return (
    <div className="dt">
      {showTools && <div className="dt-toolbar">{tools.props.children}</div>}
      {tableEl}
      {pager}
    </div>
  );
}
