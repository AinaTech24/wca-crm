import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Ic } from './Icons.jsx';
import { useExit } from './useExit.js';

// Generic modal with overlay, entrance + exit animation and Esc / backdrop close.
// `size` controls max-width: sm | md | lg | xl.
// `top` lifts it above other modals — for a question asked from inside another modal.
// `page` opens it as a full page beside the sidebar instead of a centred pop-up — used for every
// record's own view and form. A page has a Back button, and the browser's Back closes it too.
export default function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', icon, top = false, page = false }) {
  const { render, closing } = useExit(open, 200);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    function esc(e) { if (e.key === 'Escape' && !page) onClose?.(); }
    document.addEventListener('keydown', esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = prev; };
  }, [open, onClose, page]);

  // A page gets its own history entry, so the browser's Back button returns to the list.
  useEffect(() => {
    if (!open || !page) return undefined;
    const key = 'p' + Math.random().toString(36).slice(2);
    window.history.pushState({ ...(window.history.state || {}), modalPage: key }, '');
    const onPop = () => { if (window.history.state?.modalPage !== key) closeRef.current?.(); };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // Closed with the Back / close button: take our history entry away again. Checked a tick later so a
      // page that is only re-rendering (or has navigated elsewhere) is left alone.
      setTimeout(() => { if (window.history.state?.modalPage === key) window.history.back(); }, 0);
    };
  }, [open, page]);

  if (!render) return null;
  const node = (
    <div className={'modal-overlay' + (page ? ' as-page' : '') + (top ? ' modal-top' : '') + (closing ? ' closing' : '')}>
      <div className={'modal-panel modal-' + size + (page ? ' as-page' : '') + (closing ? ' closing' : '')} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="modal-head">
          <div className="modal-head-txt">
            {page && <button type="button" className="modal-back" onClick={onClose} aria-label="Back"><Ic name="arrowleft" size={16} /> Back</button>}
            {icon && <span className="modal-head-ic"><Ic name={icon} size={18} /></span>}
            <div>
              <h3>{title}</h3>
              {subtitle && <p>{subtitle}</p>}
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close"><Ic name="x" size={18} /></button>
        </div>
        <div className="modal-body">{page ? <div className="page-sheet">{children}</div> : children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
  // A page is placed straight in the main column (beside the sidebar), so nothing it sits inside — such as the
  // page's own entrance animation — can shift it.
  const host = page ? document.querySelector('.main') : null;
  return host ? createPortal(node, host) : node;
}
