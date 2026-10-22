import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { Ic } from './Icons.jsx';
import { useExit } from './useExit.js';
import Select from './Select.jsx';

// Custom date picker with a themed calendar popover, replacing the native
// <input type="date"> control. Drop-in: value is an ISO `yyyy-mm-dd` string and
// onChange fires with a synthetic { target: { value } } event.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function parseISO(v) {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return isNaN(dt) ? null : dt;
}
function toISO(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
export function fmt(v) {
  const dt = parseISO(v);
  if (!dt) return '';
  return `${String(dt.getDate()).padStart(2, '0')}-${String(dt.getMonth() + 1).padStart(2, '0')}-${dt.getFullYear()}`;
}

const YEAR_MIN = 1980;

// Turns what has been typed into dd-mm-yyyy as it goes: digits only, hyphens added after the
// day and month. Any of - / . or a space also works as the separator.
function maskTyped(raw) {
  const d = String(raw).replace(/\D/g, '').slice(0, 8);
  return d.length > 4 ? d.slice(0, 2) + '-' + d.slice(2, 4) + '-' + d.slice(4) : d.length > 2 ? d.slice(0, 2) + '-' + d.slice(2) : d;
}
// A complete dd-mm-yyyy that is a real calendar date (no 31-02), as ISO; otherwise null.
function typedToISO(text) {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? toISO(dt) : null;
}

// `typeable` turns the field into a text box you can type a date into (dd-mm-yyyy), with the
// calendar still available from the icon. Without it the whole field is the calendar button.
export default function DateField({ value, onChange, disabled, className = '', placeholder = 'dd-mm-yyyy', name, style, typeable = false }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(null);   // text being typed; null when showing the saved value
  const [pos, setPos] = useState(null);
  const [pickMode, setPickMode] = useState(false);
  const { render: panelRender, closing } = useExit(open, 140);
  const ref = useRef(null);
  const triggerRef = useRef(null);
  const selDate = parseISO(value);
  const [view, setView] = useState(() => {
    const base = selDate || new Date();
    return { y: base.getFullYear(), m: base.getMonth() };
  });

  useEffect(() => {
    if (!open) return;
    const base = parseISO(value) || new Date();
    setView({ y: base.getFullYear(), m: base.getMonth() });
    setPickMode(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // Position the calendar with fixed coordinates from the trigger so it escapes
  // any scroll/overflow container (e.g. a table cell) instead of being clipped,
  // and flip above / align right when it would overflow the viewport.
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const PW = 264, PH = 328, GAP = 6, M = 8;
      let left = r.left;
      if (left + PW > window.innerWidth - M) left = Math.max(M, r.right - PW);
      let top = r.bottom + GAP;
      if (top + PH > window.innerHeight - M) top = Math.max(M, r.top - PH - GAP);
      setPos({ top, left });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);

  function commit(dt) { setTyped(null); onChange?.({ target: { value: toISO(dt), name } }); setOpen(false); }
  function onType(e) {
    const text = maskTyped(e.target.value);
    setTyped(text);
    if (!text) onChange?.({ target: { value: '', name } });
    else { const iso = typedToISO(text); if (iso) onChange?.({ target: { value: iso, name } }); }
  }
  // Leaving the box with half a date, or one that does not exist, puts the saved date back
  // rather than leaving text on screen that the form does not hold.
  function onTypedBlur() { setTyped(null); }
  function move(delta) {
    let m = view.m + delta, y = view.y;
    if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
    setView({ y, m });
  }

  const first = new Date(view.y, view.m, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const today = new Date();
  const isToday = (d) => today.getFullYear() === view.y && today.getMonth() === view.m && today.getDate() === d;
  const isSel = (d) => selDate && selDate.getFullYear() === view.y && selDate.getMonth() === view.m && selDate.getDate() === d;

  return (
    <div className={'dp' + (className ? ' ' + className : '') + (disabled ? ' dp-disabled' : '') + (open ? ' dp-open' : '')} ref={ref} style={style}>
      {typeable ? (
        <div ref={triggerRef} className="dp-trigger dp-typeable">
          <input type="text" inputMode="numeric" autoComplete="off" name={name} disabled={disabled} maxLength={10}
            placeholder={placeholder} value={typed ?? fmt(value)} onChange={onType} onBlur={onTypedBlur}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
          <button type="button" className="dp-cal" onClick={() => !disabled && setOpen((o) => !o)} disabled={disabled} aria-label="Open calendar" aria-haspopup="dialog" aria-expanded={open}>
            <Ic name="calendar" size={16} style={{ flexShrink: 0, opacity: 0.7 }} />
          </button>
        </div>
      ) : (
      <button ref={triggerRef} type="button" className="dp-trigger" onClick={() => !disabled && setOpen((o) => !o)} disabled={disabled} aria-haspopup="dialog" aria-expanded={open}>
        <span className={'dp-value' + (value ? '' : ' dp-placeholder')}>{fmt(value) || placeholder}</span>
        <Ic name="calendar" size={16} style={{ flexShrink: 0, opacity: 0.7 }} />
      </button>
      )}
      {panelRender && pos && (
        <div className={'dp-panel dp-panel-fixed' + (closing ? ' closing' : '')} role="dialog" style={{ position: 'fixed', top: pos.top, left: pos.left }}>
          <div className="dp-head">
            {pickMode ? (
              <div className="dp-myrow">
                <Select className="field-inline dp-msel" value={view.m} onChange={(e) => setView((v) => ({ ...v, m: Number(e.target.value) }))}>
                  {MONTHS.map((mn, i) => <option key={mn} value={i}>{mn}</option>)}
                </Select>
                <Select className="field-inline dp-msel" value={view.y} onChange={(e) => setView((v) => ({ ...v, y: Number(e.target.value) }))}>
                  {Array.from({ length: new Date().getFullYear() + 10 - YEAR_MIN + 1 }, (_, i) => new Date().getFullYear() + 10 - i).map((y) => <option key={y} value={y}>{y}</option>)}
                </Select>
                <button type="button" className="dp-nav" onClick={() => setPickMode(false)} aria-label="Back to calendar"><Ic name="check" size={16} /></button>
              </div>
            ) : (
              <>
                <button type="button" className="dp-nav" onClick={() => move(-1)} aria-label="Previous month"><Ic name="chevron" size={16} style={{ transform: 'rotate(90deg)' }} /></button>
                <button type="button" className="dp-title" onClick={() => setPickMode(true)}>{MONTHS[view.m]} {view.y}</button>
                <button type="button" className="dp-nav" onClick={() => move(1)} aria-label="Next month"><Ic name="chevron" size={16} style={{ transform: 'rotate(-90deg)' }} /></button>
              </>
            )}
          </div>
          <div className="dp-grid">
            {DOW.map((d) => <span key={d} className="dp-dow">{d}</span>)}
            {cells.map((d, i) => d === null
              ? <span key={i} />
              : <button type="button" key={i} className={'dp-day' + (isSel(d) ? ' sel' : '') + (isToday(d) ? ' today' : '')} onClick={() => commit(new Date(view.y, view.m, d))}>{d}</button>
            )}
          </div>
          <div className="dp-foot">
            {value && <button type="button" className="dp-clear" onClick={() => { setTyped(null); onChange?.({ target: { value: '', name } }); setOpen(false); }}>Clear</button>}
            <button type="button" className="dp-today" onClick={() => commit(new Date())}>Today</button>
          </div>
        </div>
      )}
    </div>
  );
}
