import { useState, useRef, useEffect, useMemo } from 'react';
import { Ic } from './Icons.jsx';
import { useExit } from './useExit.js';
import toast from './toast.js';

// Searchable dropdown with an inline "add new option" action, backed by a
// fetched string list. Drop-in for a free-text <input>: value/onChange are
// plain strings, not synthetic events.
export default function SearchSelect({ value, onChange, options = [], onAdd, placeholder = 'Select…', disabled, className = '' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const { render: panelRender, closing } = useExit(open, 140);
  const ref = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);
  const exactMatch = options.some((o) => o.toLowerCase() === query.trim().toLowerCase());

  function pick(v) { onChange?.(v); setOpen(false); }

  async function addNew() {
    const name = query.trim();
    if (!name || adding || !onAdd) return;
    setAdding(true);
    try { await onAdd(name); pick(name); }
    catch (e) { toast.error(e.message || 'Could not add'); }
    finally { setAdding(false); }
  }

  return (
    <div className={'cs ss' + (className ? ' ' + className : '') + (disabled ? ' cs-disabled' : '') + (open ? ' cs-open' : '')} ref={ref}>
      <button type="button" className="cs-trigger" onClick={() => !disabled && setOpen((o) => !o)} disabled={disabled} aria-haspopup="listbox" aria-expanded={open}>
        <span className={'cs-value' + (value ? '' : ' cs-placeholder')}>{value || placeholder}</span>
        <Ic name="chevron" size={15} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur-2) var(--ease)', flexShrink: 0, opacity: 0.7 }} />
      </button>
      {panelRender && (
        <div className={'cs-panel ss-panel' + (closing ? ' closing' : '')} role="listbox">
          <div className="ss-search">
            <Ic name="search" size={14} style={{ opacity: 0.6, flexShrink: 0 }} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              onKeyDown={(e) => { if (e.key === 'Enter' && !exactMatch && query.trim() && onAdd) addNew(); }}
            />
          </div>
          <div className="ss-list">
            {filtered.map((o) => (
              <button type="button" key={o} role="option" aria-selected={o === value}
                className={'cs-option' + (o === value ? ' selected' : '')} onClick={() => pick(o)}>
                <span className="cs-option-label">{o}</span>
                {o === value && <Ic name="check" size={15} />}
              </button>
            ))}
            {!filtered.length && <div className="ss-empty">No matches</div>}
          </div>
          {onAdd && query.trim() && !exactMatch && (
            <button type="button" className="ss-add" onClick={addNew} disabled={adding}>
              <Ic name="plus" size={14} /> {adding ? 'Adding…' : `Add "${query.trim()}"`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
