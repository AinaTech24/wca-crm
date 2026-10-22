import { useState, useRef, useEffect, useMemo } from 'react';
import { Ic } from './Icons.jsx';
import { useExit } from './useExit.js';
import toast from './toast.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const splitEmails = (v) => String(v || '').split(/[;,]/).map((s) => s.trim()).filter(Boolean);
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

// Several addresses in one field: the known ones for this insurer are listed to
// tick (with search), a new one can be typed and added, and what is ticked shows
// as chips. value/onChange are a plain comma-separated string, so it drops in
// where a single email input was and the mailer needs no change.
export default function EmailPicker({ value, onChange, options = [], onAdd, placeholder = 'Add email', disabled }) {
  const selected = useMemo(() => splitEmails(value), [value]);
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

  const isOn = (e) => selected.some((s) => same(s, e));
  const write = (list) => onChange?.(list.join(', '));
  const toggle = (e) => write(isOn(e) ? selected.filter((s) => !same(s, e)) : [...selected, e]);

  // Ticked addresses that are not in the insurer's list stay visible and removable.
  const all = useMemo(() => {
    const extra = selected.filter((s) => !options.some((o) => same(o, s)));
    return [...options, ...extra];
  }, [options, selected]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? all.filter((o) => o.toLowerCase().includes(q)) : all;
  }, [all, query]);

  const typed = query.trim();
  const canAdd = !!typed && !all.some((o) => same(o, typed));

  async function addNew() {
    if (adding || !canAdd) return;
    if (!EMAIL_RE.test(typed)) { toast.error('That does not look like an email address'); return; }
    setAdding(true);
    try {
      if (onAdd) await onAdd(typed);
      if (!isOn(typed)) write([...selected, typed]);
      setQuery('');
    } catch (e) { toast.error(e.message || 'Could not add'); }
    finally { setAdding(false); }
  }

  return (
    <div className={'cs ss ep' + (disabled ? ' cs-disabled' : '') + (open ? ' cs-open' : '')} ref={ref}>
      <div className="cs-trigger ep-trigger" role="button" tabIndex={disabled ? -1 : 0} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); setOpen((o) => !o); } }}>
        <span className="ep-chips">
          {selected.length
            ? selected.map((s) => (
              <span className="ep-chip" key={s} title={s}>
                <span className="ep-chip-text">{s}</span>
                {!disabled && (
                  <button type="button" aria-label={'Remove ' + s} onClick={(e) => { e.stopPropagation(); toggle(s); }}><Ic name="x" size={11} /></button>
                )}
              </span>
            ))
            : <span className="cs-placeholder">{placeholder}</span>}
        </span>
        <Ic name="chevron" size={15} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur-2) var(--ease)', flexShrink: 0, opacity: 0.7 }} />
      </div>
      {panelRender && (
        <div className={'cs-panel ss-panel' + (closing ? ' closing' : '')} role="listbox" aria-multiselectable="true">
          <div className="ss-search">
            <Ic name="search" size={14} style={{ opacity: 0.6, flexShrink: 0 }} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search or type a new email…"
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (canAdd) addNew();
                else if (filtered.length === 1) toggle(filtered[0]);
              }}
            />
          </div>
          <div className="ss-list">
            {filtered.map((o) => (
              <button type="button" key={o} role="option" aria-selected={isOn(o)}
                className={'cs-option' + (isOn(o) ? ' selected' : '')} onClick={() => toggle(o)}>
                <span className="cs-option-label">{o}</span>
                {isOn(o) && <Ic name="check" size={15} />}
              </button>
            ))}
            {!filtered.length && <div className="ss-empty">{all.length ? 'No matches' : 'No emails saved for this insurer yet'}</div>}
          </div>
          {canAdd && (
            <button type="button" className="ss-add" onClick={addNew} disabled={adding}>
              <Ic name="plus" size={14} /> {adding ? 'Adding…' : `Add "${typed}"`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
