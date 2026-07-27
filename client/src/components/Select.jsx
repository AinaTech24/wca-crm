import { useState, useRef, useEffect, Children, isValidElement } from 'react';
import { Ic } from './Icons.jsx';
import { useExit } from './useExit.js';

// Custom dropdown that renders its own themed options panel instead of the
// native OS listbox. It's a drop-in replacement for <select>: it reads its
// <option> children and calls onChange with a synthetic { target: { value } }
// event, so existing `onChange={e => set(e.target.value)}` handlers work as-is.
function collectOptions(children) {
  const out = [];
  Children.forEach(children, (ch) => {
    if (!isValidElement(ch)) return;
    if (ch.type === 'optgroup') {
      out.push({ group: ch.props.label });
      collectOptions(ch.props.children).forEach((o) => out.push(o));
      return;
    }
    if (ch.type !== 'option') return;
    const label = Array.isArray(ch.props.children) ? ch.props.children.join('') : ch.props.children;
    out.push({
      value: ch.props.value !== undefined ? ch.props.value : label,
      label,
      disabled: ch.props.disabled,
    });
  });
  return out;
}

export default function Select({ value, onChange, children, className = '', disabled, placeholder, name, id, style }) {
  const [open, setOpen] = useState(false);
  const { render: panelRender, closing } = useExit(open, 140);
  const ref = useRef(null);
  const panelRef = useRef(null);
  const options = collectOptions(children);
  const selected = options.find((o) => !o.group && String(o.value) === String(value ?? ''));
  const display = selected ? selected.label : (placeholder ?? (options.find((o) => !o.group)?.label || 'Select'));

  useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    // Keep the selected option in view when the panel opens.
    const el = panelRef.current?.querySelector('.cs-option.selected');
    el?.scrollIntoView({ block: 'nearest' });
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  function pick(v) { onChange?.({ target: { value: v, name } }); setOpen(false); }

  return (
    <div className={'cs' + (className ? ' ' + className : '') + (disabled ? ' cs-disabled' : '') + (open ? ' cs-open' : '')} ref={ref} id={id} style={style}>
      <button type="button" className="cs-trigger" onClick={() => !disabled && setOpen((o) => !o)} disabled={disabled} aria-haspopup="listbox" aria-expanded={open}>
        <span className={'cs-value' + (selected ? '' : ' cs-placeholder')}>{display}</span>
        <Ic name="chevron" size={15} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur-2) var(--ease)', flexShrink: 0, opacity: 0.7 }} />
      </button>
      {panelRender && (
        <div className={'cs-panel' + (closing ? ' closing' : '')} role="listbox" ref={panelRef}>
          {options.map((o, i) => o.group ? (
            <div className="cs-group" key={'g' + i}>{o.group}</div>
          ) : (
            <button
              type="button"
              key={i}
              role="option"
              aria-selected={String(o.value) === String(value ?? '')}
              className={'cs-option' + (String(o.value) === String(value ?? '') ? ' selected' : '')}
              disabled={o.disabled}
              onClick={() => pick(o.value)}
            >
              <span className="cs-option-label">{o.label}</span>
              {String(o.value) === String(value ?? '') && <Ic name="check" size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
