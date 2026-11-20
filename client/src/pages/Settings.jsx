// Settings (admin): the picklists the CRM's dropdowns are filled from. RM Name is kept only here; the
// others can also be added to from the forms that use them, and are tidied here.
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import { Ic } from '../components/Icons.jsx';
import toast from '../components/toast.js';
import confirm from '../components/confirm.js';
import { useRealtime } from '../realtime.js';

const LISTS = [
  { key: 'rm-name', label: 'RM Name', icon: 'user', used: 'Quotations — the relationship manager looking after the client', adminOnly: true },
  { key: 'associate', label: 'Associates', icon: 'users', used: 'Policies — the associate / sub-broker on a policy' },
  { key: 'claim-loss-type', label: 'Claim loss types', icon: 'shieldcheck', used: 'Claims — the type of loss' },
  { key: 'make', label: 'Vehicle makes', icon: 'car', used: 'RFQ (Motor) — vehicle make' },
];

function OnboardingSettings() {
  const [c, setC] = useState(null);
  const [forms, setForms] = useState([]);
  const [iss, setIss] = useState(null);
  useEffect(() => { api('/settings/issuance').then(setIss).catch(() => setIss({ auto_insurer: true })); }, []);
  const saveIss = async (v) => { try { setIss(await api('/settings/issuance', { method: 'PUT', body: { auto_insurer: v } })); toast.success('Saved'); } catch (e) { toast.error(e.message || 'Could not save'); } };
  useEffect(() => { api('/settings/onboarding').then(setC).catch(() => setC({ auto: true, days: 30 })); api('/onboarding-forms').then(setForms).catch(() => {}); }, []);
  const save = async (patch) => { try { setC(await api('/settings/onboarding', { method: 'PUT', body: patch })); toast.success('Saved'); } catch (e) { toast.error(e.message || 'Could not save'); } };
  if (!c) return <div className="no-data">Loading…</div>;
  return (
    <>
      <div className="set-head"><div><h3>Onboarding form</h3><p>A short form for the client to fill — their details, family members, nominee and documents — chosen for their kind of policy. What they send comes straight into the CRM.</p></div></div>
      <label className="set-toggle">
        <input type="checkbox" checked={c.auto} onChange={(e) => save({ auto: e.target.checked })} />
        <span><b>Send automatically when the client approves a quotation</b><small>Emailed from the office mailbox for the product (or the quotation owner’s). The team can also send or resend it from the quotation.</small></span>
      </label>
      <div className="set-inline">
        <label>Link valid for</label>
        <select value={c.days} onChange={(e) => save({ days: Number(e.target.value) })}>{[7, 15, 30, 45, 60, 90].map((n) => <option key={n} value={n}>{n} days</option>)}</select>
        <small>A reminder goes once if it is not filled in 3 days.</small>
      </div>
      {iss && (
        <label className="set-toggle" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={iss.auto_insurer} onChange={(e) => saveIss(e.target.checked)} />
          <span><b>Send to the insurer automatically once the form is filled</b><small>The approved quote, the client’s details and their documents go to the insurer for the proposal (Policy issuance on the quotation).</small></span>
        </label>
      )}
      <div className="set-sub">Forms ({forms.length})</div>
      <div className="set-forms">{forms.map((f) => <div key={f.key}><b>{f.label}</b><small>{f.group} · {f.blurb}</small></div>)}</div>
    </>
  );
}

export default function Settings() {
  const [cur, setCur] = useState(LISTS[0].key);
  const [items, setItems] = useState(null);
  const [counts, setCounts] = useState({});
  const [name, setName] = useState('');
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');
  const [q, setQ] = useState('');
  const def = LISTS.find((l) => l.key === cur) || LISTS[0];

  const load = (key = cur) => api('/lookups/' + key).then((l) => { if (key === cur) setItems(l); setCounts((c) => ({ ...c, [key]: l.length })); }).catch(() => setItems([]));
  useEffect(() => { if (cur === 'onboarding') return; setItems(null); setQ(''); setEditId(null); load(cur); }, [cur]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { LISTS.forEach((l) => api('/lookups/' + l.key).then((x) => setCounts((c) => ({ ...c, [l.key]: x.length }))).catch(() => {})); }, []);
  useRealtime('lookup', (e) => { if (e?.data?.category === cur) load(cur); });

  async function add(e) {
    e?.preventDefault();
    const n = name.trim();
    if (!n) return;
    try { await api('/lookups/' + cur, { method: 'POST', body: { name: n } }); setName(''); toast.success(`Added “${n}”`); load(); }
    catch (err) { toast.error(err.message || 'Could not add'); }
  }
  async function save(it) {
    const n = editName.trim();
    if (!n || n === it.name) { setEditId(null); return; }
    try { await api(`/lookups/${cur}/${it.id}`, { method: 'PUT', body: { name: n } }); setEditId(null); toast.success('Renamed'); load(); }
    catch (err) { toast.error(err.message || 'Could not rename'); }
  }
  async function del(it) {
    const ok = await confirm({ title: `Remove “${it.name}”?`, message: `It is taken off the ${def.label} list. Records that already have it keep it.`, tone: 'danger', confirmText: 'Remove', icon: 'trash' });
    if (!ok) return;
    try { await api(`/lookups/${cur}/${it.id}`, { method: 'DELETE' }); toast.success('Removed'); load(); }
    catch (err) { toast.error(err.message || 'Could not remove'); }
  }

  const shown = (items || []).filter((it) => !q || it.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <PageHeader title="Settings" />
      <div className="set-grid">
        <div className="card set-nav">
          <div className="set-nav-head">Picklists</div>
          {LISTS.map((l) => (
            <button key={l.key} type="button" className={'set-nav-item' + (cur === l.key ? ' on' : '')} onClick={() => setCur(l.key)}>
              <Ic name={l.icon} size={15} /><span>{l.label}</span><i>{counts[l.key] ?? '…'}</i>
            </button>
          ))}
          <div className="set-nav-head" style={{ marginTop: 10 }}>Clients</div>
          <button type="button" className={'set-nav-item' + (cur === 'onboarding' ? ' on' : '')} onClick={() => setCur('onboarding')}>
            <Ic name="clipboard" size={15} /><span>Onboarding form</span>
          </button>
        </div>

        <div className="card set-main">
          {cur === 'onboarding' ? <OnboardingSettings /> : (<>
          <div className="set-head">
            <div>
              <h3>{def.label}</h3>
              <p>Used in {def.used}.{def.adminOnly ? ' Only an admin can change this list.' : ''}</p>
            </div>
          </div>
          <form className="set-add" onSubmit={add}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Add to ${def.label}…`} />
            <button type="submit" className="btn blue" disabled={!name.trim()}><Ic name="plus" size={15} /> Add</button>
          </form>
          {(items || []).length > 8 && (
            <div className="dt-search" style={{ maxWidth: 'none', margin: '0 0 10px' }}>
              <span className="dt-search-ic"><Ic name="search" size={15} /></span>
              <input placeholder="Search the list…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          )}
          {items === null ? <div className="no-data">Loading…</div> : shown.length === 0 ? (
            <div className="notif-empty"><Ic name={def.icon} size={22} /><span>{items.length ? 'Nothing matches' : `No ${def.label.toLowerCase()} yet — add the first one above`}</span></div>
          ) : (
            <div className="set-list">
              {shown.map((it, i) => (
                <div key={it.id} className="set-row">
                  <span className="set-n">{i + 1}</span>
                  {editId === it.id ? (
                    <input autoFocus className="set-edit" value={editName} onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') save(it); if (e.key === 'Escape') setEditId(null); }} onBlur={() => save(it)} />
                  ) : <b>{it.name}</b>}
                  <span className="set-tools">
                    <button type="button" className="action-btn" title="Rename" onClick={() => { setEditId(it.id); setEditName(it.name); }}><Ic name="edit" size={14} /></button>
                    <button type="button" className="action-btn danger" title="Remove" onClick={() => del(it)}><Ic name="trash" size={14} /></button>
                  </span>
                </div>
              ))}
            </div>
          )}
          </>)}
        </div>
      </div>
    </div>
  );
}
