// Policy issuance on an approved quotation — every step from the insurer's proposal to the policy in the
// client's inbox, with the documents kept at each step and the emails sent for you.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Ic } from '../components/Icons.jsx';
import DateField from '../components/DateField.jsx';
import Select from '../components/Select.jsx';
import toast from '../components/toast.js';
import { useRealtime } from '../realtime.js';
import { waLink } from '../components/WhatsAppButton.jsx';

const dmy = (v) => (/^\d{4}-\d{2}-\d{2}/.test(v || '') ? String(v).slice(0, 10).split('-').reverse().join('-') + (String(v).length > 10 ? ' ' + String(v).slice(11, 16) : '') : '');
const readFile = (file) => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok({ name: file.name, data: r.result }); r.onerror = bad; r.readAsDataURL(file); });
async function openFile(id) {
  try {
    const full = await api('/attachments/' + id);
    const blob = await (await fetch(full.data)).blob();
    const u = URL.createObjectURL(blob);
    window.open(u, '_blank');
    setTimeout(() => URL.revokeObjectURL(u), 60000);
  } catch { toast.error('Could not open the file'); }
}

function Pick({ label, onFile, file, multiple }) {
  const ref = useRef(null);
  return (
    <span className="is-pick">
      <button type="button" className="btn ghost sm" onClick={() => ref.current?.click()}><Ic name="upload" size={13} /> {label}</button>
      <input ref={ref} type="file" hidden accept="application/pdf,image/*" multiple={multiple}
        onChange={async (e) => { const list = [...(e.target.files || [])]; e.target.value = ''; if (!list.length) return;
          for (const f of list) if (f.size > 10 * 1024 * 1024) { toast.error(`${f.name} is larger than 10 MB`); return; }
          const out = await Promise.all(list.map(readFile)); onFile(multiple ? out : out[0]); }} />
      {file && (Array.isArray(file) ? file : [file]).map((f) => <em key={f.name}><Ic name="file" size={12} /> {f.name}</em>)}
    </span>
  );
}

export default function IssuancePanel({ quote }) {
  const [d, setD] = useState(null);
  const [open, setOpen] = useState(null);       // which step is expanded
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({});               // the inputs of the step being worked on
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const load = () => api('/issuance/' + quote.id).then((x) => { setD(x); setOpen((o) => o ?? x.next); setF((cur) => ({ insurer_email: x.insurer_email || '', link: x.payment_link || '', medical_status: x.medical_status || 'Pending', medical_date: x.medical_date || '', period_from: x.trip?.from || '', period_to: x.trip?.to || '', ...cur })); }).catch(() => setD(null));
  useEffect(() => { load(); }, [quote.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useRealtime('issuance', (e) => { if (Number(e?.data?.quotation_id) === Number(quote.id)) load(); });
  if (!d) return null;

  const step = async (path, body, ok) => {
    setBusy(true);
    try {
      const x = await api(`/issuance/${quote.id}/${path}`, { method: 'POST', body });
      setD(x); setOpen(x.next); setF({ insurer_email: x.insurer_email || '', link: x.payment_link || '', medical_status: x.medical_status || 'Pending', medical_date: x.medical_date || '', period_from: x.trip?.from || '', period_to: x.trip?.to || '' });
      if (ok) toast.success(typeof ok === 'function' ? ok(x) : ok);
    } catch (e) { toast.error(e.message || 'Could not complete this step'); }
    finally { setBusy(false); }
  };
  const last = d.proposals[d.proposals.length - 1];
  const propSkipped = !!d.proposal_skipped && !d.proposals.length;
  const linkSkipped = !!d.link_skipped && !d.payment_link_sent_at;
  const stepState = (s) => ((s.flag && !d[s.flag]) || (propSkipped && ['proposal', 'final'].includes(s.key)) || (linkSkipped && s.key === 'link') ? 'skip' : d.done[s.key] ? 'done' : d.next === s.key ? 'now' : 'todo');
  const summary = {
    sent: d.sent_at ? `Sent ${dmy(d.sent_at)} to ${d.insurer_email}` : d.onboarding && !['Submitted', 'Reviewed'].includes(d.onboarding) ? 'Goes automatically once the client’s onboarding form is in' : 'Not sent yet',
    proposal: last ? `v${last.v} · ${last.status} · ${dmy(last.at)}` : propSkipped ? `Skipped — not needed${d.proposal_skipped_by ? ' (' + d.proposal_skipped_by + ')' : ''}` : 'Waiting for the insurer’s proposal — or skip if none',
    final: propSkipped ? 'Skipped with the proposal' : d.final_at ? `Confirmed ${dmy(d.final_at)}${d.final_by ? ' by ' + d.final_by : ''}` : 'Not confirmed',
    underwriting: !d.uw_required ? 'Not needed' : d.uw_status === 'Declined' ? `Declined${d.uw_refund_date ? ' · refunded ' + dmy(d.uw_refund_date) : ' · refund to record'}` : d.uw_status === 'Accepted with conditions' && d.uw_client_ok_at && Number(d.uw_loading) > 0 ? `Client accepted · extra ₹${Number(d.uw_loading).toLocaleString('en-IN')} ${d.uw_extra_paid_at ? 'paid' : 'due'}` : `${d.uw_status || 'Waiting for the underwriter'}${d.uw_status === 'Accepted with conditions' ? (d.uw_client_ok_at ? ' · client accepted' : ' · client to accept') : ''}${Number(d.uw_loading) > 0 && d.uw_status === 'Accepted with conditions' ? ' · extra ₹' + Number(d.uw_loading).toLocaleString('en-IN') : ''}`,
    medical: !d.medical_required ? 'Not needed' : `${d.medical_status || 'Pending'}${d.medical_date ? ' · ' + dmy(d.medical_date) : ''}`,
    link: linkSkipped ? `Skipped — the insurer sends it to the client${d.link_skipped_by ? ' (' + d.link_skipped_by + ')' : ''}` : d.payment_link_sent_at ? `Sent to the client ${dmy(d.payment_link_sent_at)}` : d.payment_link ? 'Received — not yet sent to the client' : 'Waiting for the insurer',
    paid: d.paid_at ? `Paid ${dmy(d.paid_at)}${d.payment_ref ? ' · ref ' + d.payment_ref : ''}${d.proof_sent_at ? ' · proof sent to insurer' : ''}` : 'Waiting for the client',
    issued: d.issued_at ? `Policy ${d.policy_no} · ${dmy(d.issued_at)}${d.policy_mailed_at ? ' · mailed to the client' : ''}` : 'Waiting for the insurer',
  };

  return (
    <div className="is-card">
      <div className="is-head">
        <b><Ic name="file" size={16} /> Policy issuance</b>
        <span className="is-ins">{d.insurer}</span>
        {d.issued_at ? <span className="badge green">Issued</span> : <span className="badge blue">{d.steps.find((s) => s.key === d.next)?.label || 'In progress'}</span>}
      </div>
      {d.trip && (d.trip.depart || d.trip.destination) && (
        <div className={'is-trip' + (!d.issued_at && d.trip.to_depart !== null && d.trip.to_depart <= 3 ? ' urgent' : '')}>
          <Ic name="calendar" size={14} />
          <span>
            <b>{d.trip.type}</b>{d.trip.destination ? ` to ${d.trip.destination}` : ''}
            {d.trip.depart ? ` · departs ${dmy(d.trip.depart)}` : ''}{d.trip.ret && !/annual|multi/i.test(d.trip.type) ? ` · returns ${dmy(d.trip.ret)}` : ''}
            {d.trip.days && !/annual|multi/i.test(d.trip.type) ? ` (${d.trip.days} days)` : ''}{d.trip.travellers ? ` · ${d.trip.travellers} traveller${d.trip.travellers === 1 ? '' : 's'}` : ''}
          </span>
          {!d.issued_at && d.trip.to_depart !== null && (
            <em>{d.trip.to_depart < 0 ? 'Already departed — issue the policy now' : d.trip.to_depart === 0 ? 'Departs today — the policy must be issued now' : `Departs in ${d.trip.to_depart} day${d.trip.to_depart === 1 ? '' : 's'} — the policy must be issued before then`}</em>
          )}
        </div>
      )}
      <div className="is-track">
        {d.steps.map((s, i) => (
          <button key={s.key} type="button" className={'is-dot ' + stepState(s) + (open === s.key ? ' open' : '')} onClick={() => setOpen(open === s.key ? null : s.key)} title={summary[s.key]}>
            <span>{stepState(s) === 'done' ? <Ic name="check" size={12} /> : i + 1}</span><em>{s.label}{s.optional || s.canSkip ? ' (optional)' : ''}</em>
          </button>
        ))}
      </div>

      <div className="is-steps">
        {d.steps.map((s, i) => (
          <div key={s.key} className={'is-step ' + stepState(s) + (open === s.key ? ' open' : '')}>
            <button type="button" className="is-step-head" onClick={() => setOpen(open === s.key ? null : s.key)}>
              <span className="is-n">{stepState(s) === 'done' ? <Ic name="check" size={12} /> : i + 1}</span>
              <b>{s.label}</b><small>{summary[s.key]}</small>
              <Ic name={open === s.key ? 'chevron' : 'chevron-right'} size={14} />
            </button>
            {open === s.key && (
              <div className="is-body">
                {s.key === 'sent' && (
                  <>
                    <p className="is-help">Emails {d.insurer} the approved quote, the client’s onboarding details and every document they uploaded, and asks for the proposal form.</p>
                    {d.onboarding && !['Submitted', 'Reviewed'].includes(d.onboarding) && <p className="is-warn"><Ic name="alert" size={13} /> The client has not filled the onboarding form yet — it is sent automatically once they do. You can also send now without it.</p>}
                    <div className="is-row">
                      <label>Insurer email</label>
                      <input value={f.insurer_email || ''} onChange={(e) => set('insurer_email', e.target.value)} placeholder="underwriting@insurer.com" />
                    </div>
                    <div className="is-row"><label>Note (optional)</label><input value={f.note || ''} onChange={(e) => set('note', e.target.value)} placeholder="e.g. Please apply the corporate discount" /></div>
                    <button className="btn blue sm" disabled={busy} onClick={() => step('send-insurer', { to: f.insurer_email, note: f.note }, (x) => `Sent to ${x.insurer}`)}><Ic name="send" size={14} /> {d.sent_at ? 'Send again' : 'Send to insurer'}</button>
                  </>
                )}
                {s.key === 'proposal' && (
                  <>
                    {d.proposals.length > 0 && (
                      <div className="is-files">
                        {d.proposals.map((p) => (
                          <button key={p.v} type="button" className={'is-file ' + (p.status === 'Final' ? 'ok' : p.status === 'Changes requested' ? 'warn' : '')} onClick={() => openFile(p.attachment_id)}>
                            <Ic name="file" size={13} /> v{p.v} · {p.status} <small>{dmy(p.at)}</small>
                          </button>
                        ))}
                      </div>
                    )}
                    {d.changes.length > 0 && <div className="is-changes">{d.changes.map((c, j) => <div key={j}><b>v{c.v} — changes asked {dmy(c.at)}{c.mailed ? ' (emailed)' : ''}:</b> {c.note}</div>)}</div>}
                    {propSkipped ? (
                      <div className="is-skipnote">
                        <Ic name="check" size={14} /> <span>Skipped on {dmy(d.proposal_skipped)}{d.proposal_skipped_by ? ' by ' + d.proposal_skipped_by : ''} — no proposal from the insurer for this policy. Uploading one below puts the step back.</span>
                        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => step('skip-proposal', { skip: false }, 'Proposal step back on')}>Undo</button>
                      </div>
                    ) : !last && (
                      <div className="is-skipnote">
                        <span>This step is optional. If the insurer does not send a proposal form for this policy, skip it and go straight to the payment link.</span>
                        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => step('skip-proposal', { skip: true }, 'Proposal step skipped')}><Ic name="chevron-right" size={14} /> Skip this step</button>
                      </div>
                    )}
                    <div className="is-row"><label>{last ? 'Revised proposal from the insurer' : 'Proposal form from the insurer'}</label><Pick label="Choose file" file={f.proposal} onFile={(x) => set('proposal', x)} /></div>
                    <label className="is-check"><input type="checkbox" checked={!!f.final} onChange={(e) => set('final', e.target.checked)} /> This is the final proposal (no changes needed)</label>
                    <div className="is-actions">
                      <button className="btn blue sm" disabled={busy || !f.proposal} onClick={() => step('proposal', { file: f.proposal, final: !!f.final }, 'Proposal saved')}><Ic name="upload" size={14} /> Save proposal</button>
                      {last && last.status !== 'Final' && <button className="btn ghost sm" disabled={busy} onClick={() => step('client-verify', {}, 'Sent to the client to check')}><Ic name="mail" size={14} /> Send to client to check{d.client_verify_at ? ' again' : ''}</button>}
                    </div>
                    {last && last.status !== 'Final' && (
                      <div className="is-sub">
                        <div className="is-row"><label>Changes needed on v{last.v}</label><textarea rows={2} value={f.changes || ''} onChange={(e) => set('changes', e.target.value)} placeholder="e.g. Correct the nominee’s date of birth to 01-07-1988" /></div>
                        <div className="is-actions">
                          <button className="btn ghost sm" disabled={busy || !String(f.changes || '').trim()} onClick={() => step('changes', { note: f.changes }, 'Changes sent to the insurer')}><Ic name="send" size={14} /> Ask insurer to correct</button>
                          <button className="btn blue sm" disabled={busy} onClick={() => step('final', {}, 'Proposal confirmed')}><Ic name="check" size={14} /> Confirm v{last.v} as final</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
                {s.key === 'final' && (
                  <p className="is-help">{propSkipped ? 'Skipped together with the proposal step.' : d.final_at ? `Proposal v${last?.v} was confirmed as final on ${dmy(d.final_at)}.` : 'Confirm the proposal in the step above once it is correct — or upload the final version there.'}</p>
                )}
                {s.key === 'medical' && (
                  <>
                    <label className="is-check"><input type="checkbox" checked={!!d.medical_required} onChange={(e) => step('medical', { required: e.target.checked }, e.target.checked ? 'Medical check added' : 'Marked not needed')} /> The insurer needs a medical check for this policy</label>
                    {!!d.medical_required && (
                      <>
                        <div className="is-grid">
                          <div className="is-row"><label>Status</label><Select value={f.medical_status || 'Pending'} onChange={(e) => set('medical_status', e.target.value)}>{['Pending', 'Scheduled', 'Done', 'Not needed'].map((x) => <option key={x}>{x}</option>)}</Select></div>
                          <div className="is-row"><label>Date</label><DateField value={f.medical_date || ''} onChange={(e) => set('medical_date', e.target.value)} /></div>
                        </div>
                        <div className="is-row"><label>Note</label><input value={f.medical_note ?? (d.medical_note || '')} onChange={(e) => set('medical_note', e.target.value)} placeholder="e.g. Home visit by the insurer’s lab" /></div>
                        <div className="is-row"><label>Medical report (optional)</label><Pick label="Choose file" file={f.medical_file} onFile={(x) => set('medical_file', x)} /></div>
                        {f.medical_status === 'Scheduled' && <label className="is-check"><input type="checkbox" checked={f.notify !== false} onChange={(e) => set('notify', e.target.checked)} /> Email the client that the insurer will call for the medical</label>}
                        <button className="btn blue sm" disabled={busy} onClick={() => step('medical', { status: f.medical_status, date: f.medical_date, note: f.medical_note ?? d.medical_note, file: f.medical_file, notify_client: f.medical_status === 'Scheduled' && f.notify !== false }, 'Medical check updated')}><Ic name="check" size={14} /> Save</button>
                      </>
                    )}
                  </>
                )}
                {s.key === 'underwriting' && (
                  <>
                    <label className="is-check"><input type="checkbox" checked={!!d.uw_required} onChange={(e) => step('underwriting', { required: e.target.checked }, e.target.checked ? 'Underwriting added' : 'Marked not needed')} /> This policy goes to the insurer’s underwriter</label>
                    {!!d.uw_required && (
                      <>
                        {d.uw_status === 'Declined' && <p className="is-warn"><Ic name="alert" size={13} /> Declined by the underwriter — the policy cannot be issued. Talk to the client about another insurer, and the premium refund.</p>}
                        <div className="is-grid">
                          <div className="is-row"><label>Status</label><Select value={f.uw_status || d.uw_status || 'With underwriter'} onChange={(e) => set('uw_status', e.target.value)}>{['With underwriter', 'Query raised', 'Accepted', 'Accepted with conditions', 'Declined'].map((x) => <option key={x}>{x}</option>)}</Select></div>
                          {(f.uw_status || d.uw_status) === 'Accepted with conditions' && <div className="is-row"><label>Extra premium (₹, if any)</label><input type="number" min="0" value={f.uw_loading ?? (d.uw_loading || '')} onChange={(e) => set('uw_loading', e.target.value)} placeholder="e.g. 2500" /></div>}
                        </div>
                        {(f.uw_status || d.uw_status) === 'Accepted with conditions' && <div className="is-row"><label>Conditions</label><textarea rows={2} value={f.uw_conditions ?? (d.uw_conditions || '')} onChange={(e) => set('uw_conditions', e.target.value)} placeholder="e.g. Diabetes excluded for 2 years · 20% co-pay · 25% loading on premium" /></div>}
                        <div className="is-row"><label>{(f.uw_status || d.uw_status) === 'Query raised' ? 'What the underwriter asked for' : 'Note'}</label><textarea rows={2} value={f.uw_note ?? (d.uw_note || '')} onChange={(e) => set('uw_note', e.target.value)} placeholder={(f.uw_status || d.uw_status) === 'Query raised' ? 'e.g. Last 2 years’ diabetes reports and current prescription' : 'e.g. Accepted at standard rates'} /></div>
                        <div className="is-row"><label>Underwriter’s letter (optional)</label><Pick label="Choose file" file={f.uw_file} onFile={(x) => set('uw_file', x)} /></div>
                        {['Query raised', 'Accepted with conditions'].includes(f.uw_status || d.uw_status) && <label className="is-check"><input type="checkbox" checked={f.uw_notify !== false} onChange={(e) => set('uw_notify', e.target.checked)} /> {(f.uw_status || d.uw_status) === 'Query raised' ? 'Email the client what the underwriter needs' : 'Email the client the conditions to accept'}</label>}
                        <div className="is-actions">
                          <button className="btn blue sm" disabled={busy} onClick={() => step('underwriting', { status: f.uw_status || d.uw_status || 'With underwriter', note: f.uw_note ?? d.uw_note, loading: f.uw_loading ?? d.uw_loading, conditions: f.uw_conditions ?? d.uw_conditions, file: f.uw_file, notify_client: ['Query raised', 'Accepted with conditions'].includes(f.uw_status || d.uw_status) && f.uw_notify !== false }, (x) => (x.mailed ? 'Underwriting updated — client emailed' : 'Underwriting updated'))}><Ic name="check" size={14} /> Save</button>
                          {d.uw_status === 'Accepted with conditions' && !d.uw_client_ok_at && <button className="btn ghost sm" disabled={busy} onClick={() => step('underwriting', { client_ok: true }, 'Client’s acceptance recorded')}><Ic name="check" size={14} /> Client accepted the conditions</button>}
                        </div>
                        {d.uw_client_ok_at && d.uw_status === 'Accepted with conditions' && <p className="is-help">Client accepted the conditions on {dmy(d.uw_client_ok_at)}.</p>}
                        {d.uw_status === 'Accepted with conditions' && d.uw_client_ok_at && Number(d.uw_loading) > 0 && (
                          <div className="is-sub">
                            <b className="is-subh">Extra premium — ₹{Number(d.uw_loading).toLocaleString('en-IN')}</b>
                            {d.uw_extra_paid_at ? (
                              <p className="is-help"><Ic name="check" size={13} /> Paid on {dmy(d.uw_extra_paid_at)}{d.uw_extra_ref ? ' · ref ' + d.uw_extra_ref : ''}.</p>
                            ) : (
                              <>
                                <div className="is-row"><label>Payment link for the extra premium (skip if the insurer sends it)</label><input value={f.uw_extra_link ?? (d.uw_extra_link || '')} onChange={(e) => set('uw_extra_link', e.target.value)} placeholder="https://…" /></div>
                                <div className="is-actions">
                                  <button className="btn ghost sm" disabled={busy || !String(f.uw_extra_link ?? d.uw_extra_link ?? '').trim()} onClick={() => step('uw-extra-link', { link: f.uw_extra_link ?? d.uw_extra_link }, (x) => (x.emailed ? 'Link emailed to the client' : 'Link saved'))}><Ic name="send" size={14} /> {d.uw_extra_link_sent_at ? 'Email the link again' : 'Email the link to the client'}</button>
                                </div>
                                <div className="is-grid">
                                  <div className="is-row"><label>Payment reference</label><input value={f.uw_extra_ref || ''} onChange={(e) => set('uw_extra_ref', e.target.value)} placeholder="UTR / transaction no." /></div>
                                  <div className="is-row"><label>Paid on</label><DateField value={f.uw_extra_date || ''} onChange={(e) => set('uw_extra_date', e.target.value)} /></div>
                                </div>
                                <div className="is-row"><label>Payment proof (optional)</label><Pick label="Choose file" file={f.uw_extra_file} onFile={(x) => set('uw_extra_file', x)} /></div>
                                <button className="btn blue sm" disabled={busy} onClick={() => step('uw-extra-paid', { ref: f.uw_extra_ref, paid_at: f.uw_extra_date, files: f.uw_extra_file ? [f.uw_extra_file] : [] }, (x) => (x.toInsurer ? 'Extra premium recorded — proof sent to the insurer' : 'Extra premium recorded'))}><Ic name="check" size={14} /> Record extra payment</button>
                              </>
                            )}
                          </div>
                        )}
                        {d.uw_status === 'Declined' && (
                          <div className="is-sub">
                            <b className="is-subh">Premium refund from the insurer</b>
                            {d.uw_refund_date ? (
                              <p className="is-help"><Ic name="check" size={13} /> ₹{Number(d.uw_refund_amount).toLocaleString('en-IN')} refunded on {dmy(d.uw_refund_date)}{d.uw_refund_ref ? ' · ref ' + d.uw_refund_ref : ''}{d.uw_refund_mailed_at ? ' · client informed' : ''}.</p>
                            ) : (
                              <>
                                <div className="is-grid">
                                  <div className="is-row"><label>Refund amount (₹)</label><input type="number" min="0" value={f.refund_amount ?? (d.payment_amount || '')} onChange={(e) => set('refund_amount', e.target.value)} /></div>
                                  <div className="is-row"><label>Refund date</label><DateField value={f.refund_date || ''} onChange={(e) => set('refund_date', e.target.value)} /></div>
                                </div>
                                <div className="is-row"><label>Reference (optional)</label><input value={f.refund_ref || ''} onChange={(e) => set('refund_ref', e.target.value)} placeholder="UTR / cheque no." /></div>
                                <label className="is-check"><input type="checkbox" checked={f.refund_notify !== false} onChange={(e) => set('refund_notify', e.target.checked)} /> Email the client about the refund</label>
                                <button className="btn blue sm" disabled={busy || !(Number(f.refund_amount ?? d.payment_amount) > 0)} onClick={() => step('refund', { amount: f.refund_amount ?? d.payment_amount, date: f.refund_date, ref: f.refund_ref, notify_client: f.refund_notify !== false }, (x) => (x.mailed ? 'Refund recorded — client informed' : 'Refund recorded'))}><Ic name="check" size={14} /> Record refund</button>
                              </>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
                {s.key === 'link' && (
                  <>
                    {linkSkipped ? (
                      <div className="is-skipnote">
                        <Ic name="check" size={14} /> <span>Skipped on {dmy(d.link_skipped)}{d.link_skipped_by ? ' by ' + d.link_skipped_by : ''} — the insurer sends the payment link to the client directly. Saving a link below puts the step back.</span>
                        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => step('skip-link', { skip: false }, 'Payment link step back on')}>Undo</button>
                      </div>
                    ) : !d.payment_link_sent_at && (
                      <div className="is-skipnote">
                        <span>This step is optional. If the insurer sends the payment link to the client themselves, skip it and wait for the payment.</span>
                        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => step('skip-link', { skip: true }, 'Payment link step skipped')}><Ic name="chevron-right" size={14} /> Skip — insurer sends it</button>
                      </div>
                    )}
                    <div className="is-row"><label>Payment link from the insurer</label><input value={f.link || ''} onChange={(e) => set('link', e.target.value)} placeholder="https://…" /></div>
                    <div className="is-actions">
                      <button className="btn blue sm" disabled={busy || !String(f.link || '').trim()} onClick={() => step('payment-link', { link: f.link }, (x) => (x.emailed ? 'Payment link emailed to the client' : 'Payment link saved'))}><Ic name="send" size={14} /> Save & email the client</button>
                      {quote.mobile && (f.link || d.payment_link) && (
                        <button className="btn ghost sm" onClick={() => {
                          window.open(waLink(quote.mobile, `Dear ${quote.client_name}, please complete the payment for your ${quote.product || quote.category} here: ${f.link || d.payment_link}`), '_blank', 'noopener');
                          if (d.payment_link) step('payment-link-shared', { via: 'WhatsApp' });
                        }}><Ic name="phone" size={14} /> Share on WhatsApp</button>
                      )}
                    </div>
                  </>
                )}
                {s.key === 'paid' && (
                  <>
                    {d.proofs.filter((x) => x.kind === 'payment').length > 0 && (
                      <div className="is-files">{d.proofs.filter((x) => x.kind === 'payment').map((x) => <button key={x.attachment_id} type="button" className="is-file ok" onClick={() => openFile(x.attachment_id)}><Ic name="file" size={13} /> {x.name}</button>)}</div>
                    )}
                    <div className="is-row"><label>Payment proof from the client</label><Pick label="Choose files" multiple file={f.proofs} onFile={(x) => set('proofs', x)} /></div>
                    <div className="is-grid">
                      <div className="is-row"><label>Paid on</label><DateField value={f.paid_at || ''} onChange={(e) => set('paid_at', e.target.value)} /></div>
                      <div className="is-row"><label>Reference / UTR</label><input value={f.ref || ''} onChange={(e) => set('ref', e.target.value)} /></div>
                      <div className="is-row"><label>Amount (₹)</label><input type="number" value={f.amount || ''} onChange={(e) => set('amount', e.target.value)} /></div>
                    </div>
                    <label className="is-check"><input type="checkbox" checked={f.to_insurer !== false} onChange={(e) => set('to_insurer', e.target.checked)} /> Email the proof to {d.insurer} and ask for the policy</label>
                    <label className="is-check"><input type="checkbox" checked={f.to_client !== false} onChange={(e) => set('to_client', e.target.checked)} /> Thank the client for the payment</label>
                    <button className="btn blue sm" disabled={busy} onClick={() => step('payment', { files: f.proofs || [], paid_at: f.paid_at, ref: f.ref, amount: f.amount, notify_insurer: f.to_insurer !== false, notify_client: f.to_client !== false }, 'Payment recorded')}><Ic name="check" size={14} /> Record payment</button>
                  </>
                )}
                {s.key === 'issued' && (d.issued_at ? (
                  <div className="is-files">
                    <button type="button" className="is-file ok" onClick={() => openFile(d.policy_doc_id)}><Ic name="file" size={13} /> Policy {d.policy_no}</button>
                    {d.policy_id && <a className="is-file" href={'/page/policy?open=' + d.policy_id}><Ic name="externallink" size={13} /> Open the policy</a>}
                  </div>
                ) : (
                  <>
                    <p className="is-help">Saves the policy number, dates and PDF on the policy record{quote.policy_id ? '' : ' (the quotation is converted to a policy now)'}, marks it Issued and emails it to the client.</p>
                    <div className="is-grid">
                      <div className="is-row"><label>Policy number</label><input value={f.policy_no || ''} onChange={(e) => set('policy_no', e.target.value)} /></div>
                      <div className="is-row"><label>Start date</label><DateField value={f.period_from || ''} onChange={(e) => set('period_from', e.target.value)} /></div>
                      <div className="is-row"><label>End date</label><DateField value={f.period_to || ''} onChange={(e) => set('period_to', e.target.value)} /></div>
                    </div>
                    <div className="is-row"><label>Policy PDF from the insurer</label><Pick label="Choose file" file={f.policy_file} onFile={(x) => set('policy_file', x)} /></div>
                    <label className="is-check"><input type="checkbox" checked={f.send_client !== false} onChange={(e) => set('send_client', e.target.checked)} /> Email the policy to the client</label>
                    <button className="btn blue sm" disabled={busy || !f.policy_no || !f.policy_file} onClick={() => step('policy', { policy_no: f.policy_no, period_from: f.period_from, period_to: f.period_to, file: f.policy_file, send_client: f.send_client !== false }, (x) => (x.mailed ? 'Policy issued and sent to the client' : 'Policy issued'))}><Ic name="file" size={14} /> Policy issued</button>
                  </>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {d.events.length > 0 && (
        <details className="is-log">
          <summary>Activity ({d.events.length})</summary>
          {d.events.map((e, j) => <div key={j}><small>{dmy(e.at)}</small> {e.text}{e.by ? <em> — {e.by}</em> : null}</div>)}
        </details>
      )}
    </div>
  );
}
