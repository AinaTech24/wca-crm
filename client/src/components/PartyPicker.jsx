// Who a record is for: search the Clients and Leads modules by name, mobile or email and pick one — its
// mobile and email come with it and the record is linked to it — or type a new name.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { Ic } from './Icons.jsx';

let cache = null;            // { at, list } — shared by every picker on the page for a minute
async function loadParties() {
  if (cache && Date.now() - cache.at < 60000) return cache.list;
  const [clients, leads] = await Promise.all([
    api('/clients').then((x) => (Array.isArray(x) ? x : x.rows || [])).catch(() => []),
    api('/leads').then((x) => (Array.isArray(x) ? x : x.rows || [])).catch(() => []),
  ]);
  const list = [
    ...clients.map((c) => ({ kind: 'client', id: c.id, name: c.client_name || '', mobile: c.mobile || '', email: c.email || '',
      sub: [c.city, c.client_category ? 'Category ' + c.client_category : '', c.client_status].filter(Boolean).join(' · ') })),
    // A lead that has become a client is offered as the client.
    ...leads.filter((l) => l.status !== 'Converted' && !['Lost', 'Junk'].includes(l.status)).map((l) => ({ kind: 'lead', id: l.id, name: l.lead_name || '', mobile: l.mobile || '', email: l.email || '',
      product: l.expected_business_type || l.product_interest || '', sub: [l.expected_business_type || l.product_interest, l.status].filter(Boolean).join(' · ') })),
  ].filter((x) => x.name.trim());
  cache = { at: Date.now(), list };
  return list;
}

export default function PartyPicker({ value, linked, onPick, onType, disabled, placeholder = 'Search a client or lead, or type a new name' }) {
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const ref = useRef(null);
  useEffect(() => { loadParties().then(setList); }, []);
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const q = String(value || '').trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  const matches = useMemo(() => {
    const hit = (p) => !q || p.name.toLowerCase().includes(q) || (digits.length >= 3 && p.mobile.replace(/\D/g, '').includes(digits)) || (q.length >= 3 && p.email.toLowerCase().includes(q));
    const out = list.filter(hit);
    // Exact and starts-with matches first, clients before leads.
    out.sort((a, b) => (Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q))) || (a.kind === b.kind ? 0 : a.kind === 'client' ? -1 : 1) || a.name.localeCompare(b.name));
    return out.slice(0, 40);
  }, [list, q, digits]);
  const exact = list.some((p) => p.name.toLowerCase() === q);

  const pick = (p) => { onPick(p); setOpen(false); };
  const onKey = (e) => {
    if (!open && ['ArrowDown', 'Enter'].includes(e.key)) { setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && matches[hi]) { e.preventDefault(); pick(matches[hi]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="pp" ref={ref}>
      <div className={'pp-box' + (linked ? ' linked' : '')}>
        <Ic name="search" size={15} />
        <input value={value || ''} disabled={disabled} placeholder={placeholder} autoComplete="off"
          onFocus={() => setOpen(true)} onKeyDown={onKey}
          onChange={(e) => { onType(e.target.value); setOpen(true); setHi(0); }} />
        {linked && <span className={'pp-tag ' + linked.kind}>{linked.kind === 'client' ? 'Client' : 'Lead'} · linked</span>}
      </div>
      {open && !disabled && (
        <div className="pp-panel">
          {matches.length === 0 && <div className="pp-empty">{list.length ? 'No client or lead matches' : 'Loading clients and leads…'}</div>}
          {matches.map((p, i) => (
            <button key={p.kind + p.id} type="button" className={'pp-opt' + (i === hi ? ' hi' : '')} onMouseEnter={() => setHi(i)} onClick={() => pick(p)}>
              <span className={'pp-ic ' + p.kind}><Ic name={p.kind === 'client' ? 'user' : 'target'} size={14} /></span>
              <span className="pp-txt"><b>{p.name}</b><small>{[p.mobile, p.email, p.sub].filter(Boolean).join(' · ')}</small></span>
              <em className={p.kind}>{p.kind === 'client' ? 'Client' : 'Lead'}</em>
            </button>
          ))}
          {q && !exact && (
            <button type="button" className="pp-opt pp-new" onClick={() => { onPick({ kind: 'new', name: value.trim() }); }}>
              <span className="pp-ic new"><Ic name="plus" size={14} /></span>
              <span className="pp-txt"><b>Use “{value.trim()}” as a new client</b><small>A client record is made when the client fills the onboarding form or the policy is created</small></span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
