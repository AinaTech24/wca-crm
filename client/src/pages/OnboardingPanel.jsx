// Client onboarding inside the CRM: the panel on a quotation (send the form, its status, the link), the
// submission as the client filled it (answers, documents, what went onto the client record and what
// differs), and the list on a client's page.
import { Fragment, useEffect, useState } from 'react';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';
import Select from '../components/Select.jsx';
import { Ic } from '../components/Icons.jsx';
import toast from '../components/toast.js';
import confirm from '../components/confirm.js';
import { useRealtime } from '../realtime.js';
import { waLink } from '../components/WhatsAppButton.jsx';
import { bmiOf, bmiText } from './bmi.js';

export const OB_BADGE = { Ready: '', Sent: 'blue', Opened: 'orange', Submitted: 'green', Reviewed: 'green', Expired: 'red', Cancelled: '' };
const dmy = (v) => (/^\d{4}-\d{2}-\d{2}/.test(v || '') ? String(v).slice(0, 10).split('-').reverse().join('-') + (String(v).length > 10 ? ' ' + String(v).slice(11, 16) : '') : '—');
const shown = (f, a) => !f.show || String(a?.[f.show[0]] ?? '') === f.show[1];

async function openFile(id) {
  try {
    const full = await api('/attachments/' + id);
    const blob = await (await fetch(full.data)).blob();
    const u = URL.createObjectURL(blob);
    window.open(u, '_blank');
    setTimeout(() => URL.revokeObjectURL(u), 60000);
  } catch { toast.error('Could not open the file'); }
}

/** On a quotation: send the onboarding form, see where it stands, open what the client sent. */
export function OnboardingPanel({ quote }) {
  const [list, setList] = useState(null);
  const [forms, setForms] = useState([]);
  const [type, setType] = useState('');
  const [busy, setBusy] = useState(false);
  const [viewId, setViewId] = useState(null);
  const load = () => api('/onboarding?quotation_id=' + quote.id).then(setList).catch(() => setList([]));
  useEffect(() => { load(); api('/onboarding-forms').then(setForms).catch(() => {}); }, [quote.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useRealtime('onboarding', (e) => { if (Number(e?.data?.quotation_id) === Number(quote.id)) load(); });
  const r = (list || []).find((x) => x.status !== 'Cancelled');
  useEffect(() => { if (r) setType(r.form_type); }, [r?.form_type]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!list) return null;
  const canSend = ['Approved', 'Converted'].includes(quote.status);
  const submitted = r && ['Submitted', 'Reviewed'].includes(r.status);

  async function send(again) {
    if (!quote.email) { toast.error('Add the client’s email to send it — or copy the link and share it on WhatsApp'); return; }
    setBusy(true);
    try {
      const d = await api('/onboarding', { method: 'POST', body: { quotation_id: quote.id, form_type: type || undefined } });
      if (d.mail === 'sent') toast.success(`${again ? 'Sent again' : 'Onboarding form sent'} to ${quote.email}`);
      else toast.info('The form is ready, but no email went out (check the email setup) — copy the link to share it');
      load();
    } catch (e) { toast.error(e.message || 'Could not send'); } finally { setBusy(false); }
  }
  async function makeLink() {
    setBusy(true);
    try { await api('/onboarding', { method: 'POST', body: { quotation_id: quote.id, form_type: type || undefined, send: false } }); load(); }
    catch (e) { toast.error(e.message || 'Could not create the link'); } finally { setBusy(false); }
  }
  // With a link already out, picking another form switches that same link to it — Copy link / WhatsApp then open the new form.
  async function changeForm(v) {
    setType(v);
    if (!r || !v || v === r.form_type) return;
    setBusy(true);
    try {
      await api('/onboarding', { method: 'POST', body: { quotation_id: quote.id, form_type: v, send: false } });
      toast.success(`Form changed to ${forms.find((f) => f.key === v)?.label || v} — the same link now opens it`);
      load();
    } catch (e) { toast.error(e.message || 'Could not change the form'); setType(r.form_type); } finally { setBusy(false); }
  }
  const copy = () => { navigator.clipboard?.writeText(r.link).then(() => toast.success('Link copied')).catch(() => toast.info(r.link)); };
  const wa = () => window.open(waLink(quote.mobile, `Dear ${quote.client_name}, please fill in this short onboarding form for your ${quote.product || quote.category} so we can issue your policy: ${r.link}`), '_blank', 'noopener');

  return (
    <div className="ob-panel">
      <div className="ob-panel-head">
        <b><Ic name="clipboard" size={15} /> Client onboarding form</b>
        {r && <span className={'badge ' + (OB_BADGE[r.status] || '')}>{r.status}</span>}
      </div>
      {!r && !canSend && <p className="ob-panel-txt">Sent automatically when the client approves this quotation (Settings → Onboarding form).</p>}
      {!r && canSend && <p className="ob-panel-txt">Not sent yet. Choose the form and send it, or create a link to share.</p>}
      {r && (
        <p className="ob-panel-txt">
          {r.form_label}
          {r.sent_at && ` · sent ${dmy(r.sent_at)}${r.sent_via ? ' by ' + r.sent_via : ''}`}
          {r.opened_at && ` · opened ${dmy(r.opened_at)}`}
          {r.submitted_at && ` · filled ${dmy(r.submitted_at)}`}
          {!submitted && r.expires_at && ` · link valid till ${dmy(r.expires_at)}`}
          {r.conflicts?.length > 0 && <b className="ob-warn"> · {r.conflicts.length} difference{r.conflicts.length === 1 ? '' : 's'} to review</b>}
        </p>
      )}
      <div className="ob-panel-actions">
        {(!submitted && (canSend || r)) && (
          <Select value={type} onChange={(e) => changeForm(e.target.value)} disabled={busy}>
            <option value="">Form: suggested for this product</option>
            {[...new Set(forms.map((f) => f.group))].map((g) => <optgroup key={g} label={g}>{forms.filter((f) => f.group === g).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</optgroup>)}
          </Select>
        )}
        {submitted && <button type="button" className="btn blue sm" onClick={() => setViewId(r.id)}><Ic name="eye" size={14} /> View what the client filled</button>}
        {!submitted && (canSend || r) && <button type="button" className="btn blue sm" disabled={busy} onClick={() => send(!!r?.sent_at)}><Ic name="send" size={14} /> {r?.sent_at ? 'Send again' : 'Send by email'}</button>}
        {!submitted && (canSend || r) && !r && <button type="button" className="btn ghost sm" disabled={busy} onClick={makeLink}><Ic name="externallink" size={14} /> Create link</button>}
        {r && <button type="button" className="btn ghost sm" onClick={copy}><Ic name="clipboard" size={14} /> Copy link</button>}
        {r && quote.mobile && <button type="button" className="btn ghost sm" onClick={wa}><Ic name="phone" size={14} /> WhatsApp link</button>}
      </div>
      {viewId && <OnboardingView id={viewId} onClose={() => { setViewId(null); load(); }} />}
    </div>
  );
}

/** What the client filled in, as a full page. */
export function OnboardingView({ id, onClose }) {
  const [r, setR] = useState(null);
  const [pick, setPick] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = () => api('/onboarding/' + id).then((x) => { setR(x); setPick([]); }).catch((e) => { toast.error(e.message || 'Could not open'); onClose(); });
  useEffect(() => { load(); }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (path, body, ok) => { setBusy(true); try { await api(`/onboarding/${id}/${path}`, { method: 'POST', body }); toast.success(ok); load(); } catch (e) { toast.error(e.message || 'Could not update'); } finally { setBusy(false); } };
  if (!r) return <Modal open page onClose={onClose} title="Onboarding form" size="xl"><div className="spinner">Loading…</div></Modal>;
  const a = r.answers || {};
  const filesOf = (k) => (r.files || []).filter((x) => x.field === k);
  return (
    <Modal open page onClose={onClose} icon="clipboard" size="xl"
      title={`${r.form_label} — ${r.client_name}`}
      subtitle={`${r.status}${r.submitted_at ? ' · filled ' + dmy(r.submitted_at) : ''}${r.reviewed_by ? ` · reviewed by ${r.reviewed_by}` : ''}`}
      footer={<div className="qt-actions">
        <span style={{ flex: 1 }} />
        {r.status === 'Submitted' && <button className="btn ghost" disabled={busy} onClick={async () => { if (await confirm({ title: 'Let the client change it?', message: 'The same link opens the form again for the client to correct and resend.', confirmText: 'Reopen', icon: 'refresh' })) act('reopen', {}, 'Reopened for the client'); }}><Ic name="refresh" size={15} /> Reopen for the client</button>}
        {r.status === 'Submitted' && <button className="btn blue" disabled={busy} onClick={() => act('review', {}, 'Marked reviewed')}><Ic name="check" size={15} /> Mark reviewed</button>}
      </div>}>
      {(r.applied || []).length > 0 && (
        <div className="ob-sum ok"><Ic name="check" size={16} /><span><b>Added to the client record:</b> {r.applied.map((x) => x.label).join(', ')}</span></div>
      )}
      {(r.conflicts || []).length > 0 && (
        <div className="ob-conf">
          <div className="ob-conf-head"><Ic name="alert" size={16} /> <b>The client gave different details from the CRM</b> — tick the ones to update on the client record.</div>
          <table>
            <thead><tr><th /><th>Field</th><th>In the CRM</th><th>Client says</th></tr></thead>
            <tbody>{r.conflicts.map((c) => (
              <tr key={c.column}>
                <td><input type="checkbox" checked={pick.includes(c.column)} onChange={(e) => setPick((p) => (e.target.checked ? [...p, c.column] : p.filter((x) => x !== c.column)))} /></td>
                <td>{c.label}</td><td>{c.crm_value}</td><td><b>{c.client_value}</b></td>
              </tr>
            ))}</tbody>
          </table>
          <button className="btn blue sm" disabled={!pick.length || busy} onClick={() => act('apply', { fields: pick }, 'Client record updated')}>Use the client’s values</button>
        </div>
      )}
      {r.form.sections.map((s) => (
        <div key={s.title} className="ob-vsec">
          <div className="ob-vsec-head"><Ic name={s.icon || 'doc'} size={15} /> {s.title}</div>
          <div className="ob-vgrid">
            {s.fields.filter((f) => shown(f, a)).map((f) => {
              if (f.type === 'file' && f.perMember) return (
                <div key={f.k} className="ob-v wide"><span>{f.label}</span>
                  <div className="ob-vfiles">
                    {(a[f.perMember] || []).map((row, j) => {
                      const list = filesOf(`${f.k}.${j}`);
                      return list.length ? list.map((x) => <button key={x.attachment_id} type="button" onClick={() => openFile(x.attachment_id)}><Ic name="file" size={13} /> {row?.name || 'Member ' + (j + 1)}: {x.name}</button>)
                        : <b key={j} className="muted">{row?.name || 'Member ' + (j + 1)}: {f.selfSkip !== false && row?.relation === 'Self' ? 'uses the proposer’s Aadhaar' : 'not uploaded'}</b>;
                    })}
                  </div>
                </div>
              );
              if (f.type === 'file') {
                const list = filesOf(f.k);
                return (
                  <div key={f.k} className="ob-v wide"><span>{f.label}</span>
                    {list.length ? <div className="ob-vfiles">{list.map((x) => <button key={x.attachment_id} type="button" onClick={() => openFile(x.attachment_id)}><Ic name="file" size={13} /> {x.name}</button>)}</div> : <b className="muted">Not uploaded</b>}
                  </div>
                );
              }
              if (f.type === 'repeat') return (
                <div key={f.k} className="ob-v wide"><span>{f.label}</span>
                  <div className="table-wrap"><table className="ob-vtable">
                    <thead><tr>{f.fields.map((sf) => <th key={sf.k}>{sf.label}</th>)}{f.fields.some((sf) => sf.k === 'weight_kg') && <th>BMI</th>}</tr></thead>
                    <tbody>{(a[f.k] || []).map((row, i) => <tr key={i}>{f.fields.map((sf) => <td key={sf.k}>{row[sf.k] || '—'}</td>)}{f.fields.some((sf) => sf.k === 'weight_kg') && <td>{bmiText(bmiOf(row.height_cm, row.weight_kg, row.dob)) || '—'}</td>}</tr>)}</tbody>
                  </table></div>
                </div>
              );
              if (f.type === 'declaration') return <div key={f.k} className="ob-v wide"><span>Declaration</span><b>{a[f.k] ? '✓ Confirmed by the client' : 'Not confirmed'}</b></div>;
              const cell = <div key={f.k} className={'ob-v' + (f.type === 'textarea' ? ' wide' : '')}><span>{f.label}</span><b>{String(a[f.k] ?? '') || '—'}</b></div>;
              const b = f.k === 'weight_kg' ? bmiOf(a.height_cm, a.weight_kg, a.dob) : null;
              return b ? <Fragment key={f.k}>{cell}<div className="ob-v"><span>BMI</span><b>{bmiText(b)}</b></div></Fragment> : cell;
            })}
          </div>
        </div>
      ))}
    </Modal>
  );
}

/** On a client's page: every onboarding form sent to them. */
export function ClientOnboarding({ clientId }) {
  const [list, setList] = useState(null);
  const [viewId, setViewId] = useState(null);
  const load = () => api('/onboarding?client_id=' + clientId).then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, [clientId]);   // eslint-disable-line react-hooks/exhaustive-deps
  useRealtime('onboarding', () => load());
  if (!list) return <div className="notif-empty"><span>Loading…</span></div>;
  if (!list.length) return <div className="notif-empty"><Ic name="clipboard" size={22} /><span>No onboarding form sent to this client yet — it goes out when they approve a quotation</span></div>;
  return (
    <>
      {list.map((r) => (
        <div key={r.id} className={'act-item' + (['Submitted', 'Reviewed'].includes(r.status) ? ' act-clickable' : '')} onClick={() => ['Submitted', 'Reviewed'].includes(r.status) && setViewId(r.id)}>
          <span className="act-ic"><Ic name="clipboard" size={15} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 650 }}>{r.form_label}{r.product ? ` · ${r.product}` : ''}</div>
            <div className="act-meta">
              <span className={'badge ' + (OB_BADGE[r.status] || '')}>{r.status}</span>
              {r.sent_at && <span><Ic name="send" size={12} /> sent {dmy(r.sent_at)}</span>}
              {r.submitted_at && <span><Ic name="check" size={12} /> filled {dmy(r.submitted_at)}</span>}
              {(r.files || []).length > 0 && <span><Ic name="file" size={12} /> {r.files.length} document{r.files.length === 1 ? '' : 's'}</span>}
              {r.conflicts?.length > 0 && <span className="overdue-date">{r.conflicts.length} to review</span>}
            </div>
          </div>
          {['Submitted', 'Reviewed'].includes(r.status) && <span className="act-open"><Ic name="chevron-right" size={16} /></span>}
        </div>
      ))}
      {viewId && <OnboardingView id={viewId} onClose={() => { setViewId(null); load(); }} />}
    </>
  );
}
