import { useEffect } from 'react';
import { Ic } from './Icons.jsx';
import { useExit } from './useExit.js';

// Generic centered modal with overlay, entrance + exit animation and Esc /
// backdrop close. `size` controls max-width: sm | md | lg.
// `top` lifts it above other modals — for a question asked from inside another modal.
export default function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', icon, top = false }) {
  const { render, closing } = useExit(open, 200);

  useEffect(() => {
    if (!open) return;
    function esc(e) { if (e.key === 'Escape') onClose?.(); }
    document.addEventListener('keydown', esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = prev; };
  }, [open, onClose]);

  if (!render) return null;
  return (
    <div className={'modal-overlay' + (top ? ' modal-top' : '') + (closing ? ' closing' : '')}>
      <div className={'modal-panel modal-' + size + (closing ? ' closing' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div className="modal-head-txt">
            {icon && <span className="modal-head-ic"><Ic name={icon} size={18} /></span>}
            <div>
              <h3>{title}</h3>
              {subtitle && <p>{subtitle}</p>}
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close"><Ic name="x" size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
