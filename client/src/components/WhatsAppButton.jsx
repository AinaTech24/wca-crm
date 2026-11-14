// "WhatsApp" — opens WhatsApp (app or web) with the client's number and a ready message to send. Nothing is
// sent by the CRM: the person checks the message and presses send, so no WhatsApp Business account or
// approved templates are needed. With several messages on offer it is a small menu.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import toast from './toast.js';
import { Ic } from './Icons.jsx';

// Indian mobile numbers without a country code get +91.
export function waNumber(raw) {
  const d = String(raw || '').replace(/\D/g, '').replace(/^0+/, '');
  if (!d) return '';
  return d.length === 10 ? '91' + d : d;
}
export const waLink = (mobile, text) => `https://wa.me/${waNumber(mobile)}?text=${encodeURIComponent(text || '')}`;

export default function WhatsAppButton({ mobile, clientId, messages = [], className = 'btn ghost', label = 'WhatsApp' }) {
  const [open, setOpen] = useState(false);
  const [num, setNum] = useState(mobile || '');
  const ref = useRef(null);
  useEffect(() => { setNum(mobile || ''); }, [mobile]);
  // The number from the client record when only the client is known (a policy).
  useEffect(() => {
    if (mobile || !clientId) return;
    api('/clients/' + clientId).then((c) => setNum(c?.mobile || c?.client?.mobile || '')).catch(() => {});
  }, [mobile, clientId]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const go = (text) => {
    if (!waNumber(num)) { toast.error('No mobile number on file for this client'); return; }
    window.open(waLink(num, text), '_blank', 'noopener');
    setOpen(false);
  };
  const list = messages.filter((m) => m && m.text);
  return (
    <div className="rep-menu" ref={ref}>
      <button type="button" className={className + ' wa-btn'} title={waNumber(num) ? `WhatsApp +${waNumber(num)}` : 'No mobile number on file'}
        onClick={() => (list.length > 1 ? setOpen((o) => !o) : go(list[0]?.text || ''))}>
        <Ic name="phone" size={15} /> {label}
      </button>
      {open && (
        <div className="rep-menu-panel" style={{ minWidth: 230 }}>
          {list.map((m) => <button key={m.label} type="button" onClick={() => go(m.text)}>{m.label}</button>)}
        </div>
      )}
    </div>
  );
}
