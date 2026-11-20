// The client's onboarding form — opened from the link we email after they approve a quotation. No login:
// the long link is the key. One section at a time, works on a phone, keeps a draft on the device, and
// photos are shrunk before upload. Everything submitted goes straight into the CRM.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { brandLogo } from '../components/Logo.jsx';
import { Ic } from '../components/Icons.jsx';
import { bmiOf } from './bmi.js';

const BASE = (import.meta.env.VITE_API_BASE || '/api').replace(/\/$/, '');
const PATTERNS = {
  pan: [/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'PAN looks like ABCDE1234F'],
  aadhaar: [/^\d{12}$/, 'Aadhaar has 12 digits'],
  pincode: [/^\d{6}$/, 'PIN code has 6 digits'],
  gstin: [/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, 'GSTIN has 15 characters, like 24ABCDE1234F1Z5'],
};
const MAX_FILE = 6 * 1024 * 1024;
const shown = (f, a) => !f.show || String(a?.[f.show[0]] ?? '') === f.show[1];
const norm = (f, v) => {
  let s = String(v ?? '').trim();
  if (['pan', 'gstin'].includes(f.pattern)) s = s.toUpperCase().replace(/\s/g, '');
  if (['aadhaar', 'pincode'].includes(f.pattern)) s = s.replace(/\D/g, '');
  return s;
};
const today = () => new Date().toISOString().slice(0, 10);

// Photos from a phone are often 5–10 MB; they are shrunk to a sharp ~2000px JPEG before upload.
function readFile(file) {
  return new Promise((ok, bad) => {
    const r = new FileReader();
    r.onerror = () => bad(new Error('Could not read the file'));
    r.onload = () => {
      const uri = r.result;
      if (!/^data:image\/(jpeg|jpg|png|webp)/i.test(uri) || file.size < 1.5 * 1024 * 1024) return ok({ uri, size: file.size });
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 2000 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const out = c.toDataURL('image/jpeg', 0.82);
        ok({ uri: out, size: Math.round((out.length * 3) / 4) });
      };
      img.onerror = () => ok({ uri, size: file.size });
      img.src = uri;
    };
    r.readAsDataURL(file);
  });
}

function check(sec, a, files) {
  const errs = {};
  for (const f of sec.fields) {
    if (!shown(f, a)) continue;
    const v = a[f.k];
    if (f.type === 'file' && f.perMember) {
      (Array.isArray(a[f.perMember]) ? a[f.perMember] : []).forEach((row, i) => { if (f.req && (f.selfSkip === false || row?.relation !== 'Self') && !(files[`${f.k}.${i}`] || []).length) errs[`${f.k}.${i}`] = 'Please upload this'; });
      continue;
    }
    if (f.type === 'file') { if (f.req && !(files[f.k] || []).length) errs[f.k] = 'Please upload this'; continue; }
    if (f.type === 'declaration') { if (f.req && v !== true) errs[f.k] = 'Please tick to confirm'; continue; }
    if (f.type === 'repeat') {
      const rows = Array.isArray(v) ? v : [];
      if (f.req && rows.length < (f.min || 1)) errs[f.k] = `Add at least ${f.min || 1}`;
      rows.forEach((row, i) => f.fields.forEach((sf) => {
        const sv = String(row?.[sf.k] ?? '').trim();
        if (sf.req && shown(sf, row) && !sv) errs[`${f.k}.${i}.${sf.k}`] = 'Required';
        else if (sv && sf.range && (Number(sv) < sf.range[0] || Number(sv) > sf.range[1])) errs[`${f.k}.${i}.${sf.k}`] = sf.range[2];
      }));
      if (f.k === 'nominees' && rows.length && Math.round(rows.reduce((n, r) => n + (Number(r.share) || 0), 0)) !== 100) errs[f.k] = 'Shares must add up to 100%';
      continue;
    }
    const s = norm(f, v);
    if (f.req && !s) { errs[f.k] = 'Required'; continue; }
    if (s && f.pattern && PATTERNS[f.pattern] && !PATTERNS[f.pattern][0].test(s)) errs[f.k] = PATTERNS[f.pattern][1];
    else if (s && f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) errs[f.k] = 'Enter a valid email';
    else if (s && f.type === 'tel' && s.replace(/\D/g, '').length < 10) errs[f.k] = 'Enter a 10-digit mobile number';
    else if (s && f.range && (Number(s) < f.range[0] || Number(s) > f.range[1])) errs[f.k] = f.range[2];
  }
  return errs;
}

/** Worked out as soon as height and weight are in (age from the date of birth). */
function BmiChip({ h, w, dob }) {
  const b = bmiOf(h, w, dob);
  if (!b) return null;
  return <div className={'ob-bmi ' + b.tone}><Ic name="shieldcheck" size={14} /><span>BMI</span><b>{b.bmi}</b><small>{b.label}</small></div>;
}

function Field({ f, value, onChange, error, files, onFiles, onRemoveFile, prior }) {
  const id = 'f-' + f.k;
  const input = (type) => <input id={id} type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)} max={type === 'date' && /dob/.test(f.k) ? today() : undefined} />;
  let control;
  if (f.type === 'textarea') control = <textarea id={id} rows={3} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  else if (f.type === 'select') control = (
    <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose…</option>{f.options.map((o) => <option key={o}>{o}</option>)}
    </select>
  );
  else if (f.type === 'yesno') control = (
    <div className="ob-yn">{['Yes', 'No'].map((o) => <button key={o} type="button" className={value === o ? 'on' : ''} onClick={() => onChange(o)}>{o}</button>)}</div>
  );
  else if (f.type === 'declaration') control = (
    <label className="ob-decl"><input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} /><span>{f.label}</span></label>
  );
  else if (f.type === 'file') control = (
    <div className="ob-files">
      {(prior || []).map((p) => <span key={'p' + p.name} className="ob-file done"><Ic name="check" size={13} /> {p.name} <small>uploaded earlier</small></span>)}
      {(files || []).map((x, i) => (
        <span key={i} className="ob-file"><Ic name="file" size={13} /> {x.name}<button type="button" onClick={() => onRemoveFile(i)} aria-label="Remove">×</button></span>
      ))}
      {(files || []).length < 4 && (
        <label className="ob-upload"><Ic name="upload" size={16} /> {(files || []).length ? 'Add another' : 'Upload PDF or photo'}
          <input type="file" accept="application/pdf,image/*" capture={undefined} hidden onChange={(e) => { onFiles(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      )}
    </div>
  );
  else control = input(f.type === 'tel' ? 'tel' : f.type === 'email' ? 'email' : f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text');
  return (
    <div className={'ob-field' + (error ? ' bad' : '') + (['textarea', 'file', 'declaration'].includes(f.type) ? ' wide' : '')} data-k={f.k}>
      {f.type !== 'declaration' && <label htmlFor={id}>{f.label}{f.req && <b>*</b>}</label>}
      {f.help && <small className="ob-fhelp">{f.help}</small>}
      {control}
      {error && <small className="ob-err">{error}</small>}
    </div>
  );
}

/** Every section of a form, as the client sees it — the preview in Settings. */
export function FormPreview({ form }) {
  const [a, setA] = useState({});
  const theme = form.theme || {};
  return (
    <div className="ob-preview" style={{ '--ob-c': theme.color || '#1b6fb0' }}>
      <div className="ob-intro-band"><Ic name={theme.icon || 'doc'} size={18} /> <span>{theme.tagline}</span></div>
      <h1 className="ob-pv-title">{form.label}</h1>
      {form.needs?.length > 0 && (
        <div className="ob-needs"><b>Keep these ready</b><ul>{form.needs.map((n) => <li key={n}><Ic name="check" size={13} /> {n}</li>)}</ul></div>
      )}
      {form.sections.map((sec, si) => (
        <div key={si} className="ob-card ob-pv-sec">
          <h2><Ic name={sec.icon || 'doc'} size={18} /> {si + 1}. {sec.title}</h2>
          {sec.help && <p className="ob-help">{sec.help}</p>}
          <div className="ob-grid">
            {sec.fields.filter((f) => shown(f, a)).map((f) => f.type === 'repeat' ? (
              <div key={f.k} className="ob-repeat"><div className="ob-row"><div className="ob-row-head"><b>{f.label} — row 1</b></div>
                <div className="ob-grid">{f.fields.filter((sf) => !sf.show).map((sf) => <Field key={sf.k} f={sf} value="" onChange={() => {}} />)}</div></div></div>
            ) : (
              <div key={f.k} className={f.custom ? 'ob-custom' : undefined} style={{ display: 'contents' }}>
                <Field f={f} value={a[f.k]} onChange={(v) => setA((x) => ({ ...x, [f.k]: v }))} files={[]} onFiles={() => {}} onRemoveFile={() => {}} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function OnboardPage() {
  const { token } = useParams();
  const draftKey = 'wca_onboard_' + token;
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [step, setStep] = useState(0);
  const [intro, setIntro] = useState(true);   // the "before you start" page
  const [a, setA] = useState({});
  const [files, setFiles] = useState({});
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch(`${BASE}/public/onboarding/${token}`).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'This link could not be opened');
      setD(j);
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem(draftKey) || '{}'); } catch { saved = {}; }
      const start = {};
      j.form.sections.forEach((s) => s.fields.forEach((f) => {
        if (f.type === 'repeat') start[f.k] = Array.from({ length: f.min || 1 }, () => ({}));
        if (j.prefill[f.k]) start[f.k] = j.prefill[f.k];
      }));
      if (j.form.sections.some((s) => s.fields.some((f) => f.k === 'company_name'))) start.company_name = j.prefill.full_name;
      setA({ ...start, ...saved });
    }).catch((e) => setErr(e.message));
  }, [token]);   // eslint-disable-line react-hooks/exhaustive-deps
  // The draft stays on this device (without the files), so closing the page loses nothing.
  useEffect(() => { if (d && !done) { try { localStorage.setItem(draftKey, JSON.stringify(a)); } catch { /* full */ } } }, [a]);   // eslint-disable-line react-hooks/exhaustive-deps

  const sections = d?.form?.sections || [];
  const sec = sections[step];
  const prior = useMemo(() => (d?.files || []).reduce((m, x) => { (m[x.field] ||= []).push(x); return m; }, {}), [d]);
  const filesAll = useMemo(() => Object.fromEntries(Object.keys({ ...prior, ...files }).map((k) => [k, [...(prior[k] || []), ...(files[k] || [])]])), [prior, files]);
  const set = (k, v) => { setA((x) => ({ ...x, [k]: v })); setErrs((e) => { const n = { ...e }; delete n[k]; if (!Object.keys(n).length) setMsg(''); return n; }); };
  const setRow = (k, i, sk, v) => { setA((x) => ({ ...x, [k]: (x[k] || []).map((r, j) => (j === i ? { ...r, [sk]: v } : r)) })); setErrs((e) => { const n = { ...e }; delete n[`${k}.${i}.${sk}`]; if (!Object.keys(n).length) setMsg(''); return n; }); };

  async function addFile(k, file) {
    if (!file) return;
    if (!/pdf|image/i.test(file.type)) { setErrs((e) => ({ ...e, [k]: 'Please upload a PDF or a photo' })); return; }
    try {
      const { uri, size } = await readFile(file);
      if (size > MAX_FILE) { setErrs((e) => ({ ...e, [k]: 'This file is larger than 6 MB — please upload a smaller one' })); return; }
      setFiles((x) => ({ ...x, [k]: [...(x[k] || []), { name: file.name, data: uri }] }));
      setErrs((e) => { const n = { ...e }; delete n[k]; return n; });
    } catch (e) { setErrs((x) => ({ ...x, [k]: e.message })); }
  }
  function next() {
    const e = check(sec, a, filesAll);
    setErrs(e);
    if (Object.keys(e).length) { setMsg('Please complete the highlighted fields'); setTimeout(() => document.querySelector('.ob-field.bad, .ob-row.bad')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); return; }
    setMsg('');
    setStep((s) => Math.min(s + 1, sections.length));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function submit() {
    setBusy(true); setMsg('');
    try {
      const body = { answers: a, files: Object.entries(files).flatMap(([field, list]) => list.map((x) => ({ field, name: x.name, data: x.data }))) };
      const r = await fetch(`${BASE}/public/onboarding/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (Array.isArray(j.problems) && j.problems.length) {
          const e = Object.fromEntries(j.problems.map((p) => [p.k, p.msg]));
          setErrs(e);
          const at = sections.findIndex((s) => s.fields.some((f) => j.problems.some((p) => p.k === f.k || p.k.startsWith(f.k + '.'))));
          if (at >= 0) setStep(at);
        }
        throw new Error(j.error || 'Could not submit — please try again');
      }
      try { localStorage.removeItem(draftKey); } catch { /* fine */ }
      setDone(true);
      window.scrollTo({ top: 0 });
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }

  const header = (
    <header className="ob-top">
      <img src={brandLogo} alt="WeCare Assurance" />
      <span>Insurance with Assurance</span>
    </header>
  );
  if (err) return <div className="ob-page">{header}<div className="ob-card ob-msg"><Ic name="alert" size={30} /><h2>Link not available</h2><p>{err}</p></div></div>;
  if (!d) return <div className="ob-page">{header}<div className="ob-card ob-msg"><p>Loading your form…</p></div></div>;
  if (done || d.locked) return (
    <div className="ob-page">{header}
      <div className="ob-card ob-msg ok">
        <span className="ob-tick"><Ic name="check" size={34} /></span>
        <h2>{done ? 'Thank you — we have your details' : 'Already received'}</h2>
        <p>{done ? 'Your onboarding form and documents have reached WeCare Assurance. Our team will review them and get your policy issued. We will contact you if anything else is needed.' : 'Our team has already reviewed this form. Please contact us if you need to change anything.'}</p>
      </div>
    </div>
  );
  if (d.expired) return <div className="ob-page">{header}<div className="ob-card ob-msg"><Ic name="clock" size={30} /><h2>This link has expired</h2><p>Please ask WeCare Assurance to send you a new one.</p></div></div>;

  const review = step >= sections.length;
  const theme = d.form.theme || {};
  if (intro && d.status !== 'Submitted') return (
    <div className="ob-page" style={{ '--ob-c': theme.color || '#1b6fb0' }}>
      {header}
      <div className="ob-card ob-intro">
        <div className="ob-intro-band"><Ic name={theme.icon || 'doc'} size={18} /> <span>{theme.tagline || 'Your policy details'}</span></div>
        <h1>{d.form.label}</h1>
        <p className="ob-intro-sub">Hello <b>{d.client_name}</b> — a few details for your {d.product || 'policy'}, so the insurer can issue it. It takes about <b>{d.form.minutes || 5} minutes</b>, and your answers are saved on this device as you go.</p>
        {d.form.needs?.length > 0 && (
          <div className="ob-needs"><b>Before you start, keep these ready</b><ul>{d.form.needs.map((n) => <li key={n}><Ic name="check" size={13} /> {n}</li>)}</ul>
            <small>A clear photo from your phone is fine.</small></div>
        )}
        <div className="ob-plan"><b>What we will ask</b><ol>{sections.map((s) => <li key={s.title}>{s.title}</li>)}</ol></div>
        <div className="ob-nav"><button type="button" className="ob-btn" onClick={() => { setIntro(false); window.scrollTo({ top: 0 }); }}>Start</button></div>
      </div>
      <footer className="ob-foot">Your details go only to WeCare Assurance and the insurer issuing your policy.</footer>
    </div>
  );
  return (
    <div className="ob-page" style={{ '--ob-c': theme.color || '#1b6fb0' }}>
      {header}
      <div className="ob-hero">
        <div className="ob-intro-band"><Ic name={theme.icon || 'doc'} size={16} /> <span>{theme.tagline}</span></div>
        <h1>{d.form.label}</h1>
        <p>For <b>{d.client_name}</b>{d.product ? ` · ${d.product}` : ''}. About {d.form.minutes || 5} minutes — your answers are saved on this device as you go.</p>
        {d.status === 'Submitted' && <p className="ob-note">You have already sent this form. Sending it again updates your details.</p>}
      </div>
      <div className="ob-steps">
        {sections.map((s, i) => (
          <button key={s.title} type="button" className={'ob-step' + (i === step ? ' on' : '') + (i < step ? ' done' : '')} onClick={() => i < step && setStep(i)} disabled={i > step}>
            <span>{i < step ? <Ic name="check" size={12} /> : i + 1}</span><em>{s.title}</em>
          </button>
        ))}
        <button type="button" className={'ob-step' + (review ? ' on' : '')} disabled={!review}><span>{sections.length + 1}</span><em>Submit</em></button>
      </div>

      <div className="ob-card">
        {!review ? (
          <>
            <h2><Ic name={sec.icon || 'doc'} size={18} /> {sec.title}</h2>
            {sec.help && <p className="ob-help">{sec.help}</p>}
            <div className="ob-grid">
              {sec.fields.filter((f) => shown(f, a)).map((f) => f.type === 'repeat' ? (
                <div key={f.k} className={'ob-repeat' + (errs[f.k] ? ' bad' : '')}>
                  {(a[f.k] || []).map((row, i) => (
                    <div key={i} className={'ob-row' + (Object.keys(errs).some((k) => k.startsWith(`${f.k}.${i}.`)) ? ' bad' : '')}>
                      <div className="ob-row-head"><b>{f.k === 'nominees' ? 'Nominee' : f.k === 'travellers' ? 'Traveller' : 'Member'} {i + 1}</b>
                        {(a[f.k] || []).length > (f.min || 1) && <button type="button" onClick={() => setA((x) => ({ ...x, [f.k]: x[f.k].filter((_, j) => j !== i) }))}>Remove</button>}
                      </div>
                      <div className="ob-grid">
                        {f.fields.filter((sf) => shown(sf, row)).map((sf) => (
                          <Fragment key={sf.k}>
                            <Field f={sf} value={row[sf.k]} error={errs[`${f.k}.${i}.${sf.k}`]} onChange={(v) => setRow(f.k, i, sf.k, v)} />
                            {sf.k === 'weight_kg' && <BmiChip h={row.height_cm} w={row.weight_kg} dob={row.dob} />}
                          </Fragment>
                        ))}
                      </div>
                    </div>
                  ))}
                  {(a[f.k] || []).length < (f.max || 8) && (
                    <button type="button" className="ob-add" onClick={() => setA((x) => ({ ...x, [f.k]: [...(x[f.k] || []), {}] }))}><Ic name="plus" size={14} /> Add {f.k === 'nominees' ? 'nominee' : f.k === 'travellers' ? 'traveller' : 'member'}</button>
                  )}
                  {errs[f.k] && <small className="ob-err">{errs[f.k]}</small>}
                </div>
              ) : f.type === 'file' && f.perMember ? (
                <div key={f.k} className="ob-repeat ob-mdocs">
                  <div className="ob-mdocs-head"><b>{f.label}</b><small>{f.help || 'One for each person — Aadhaar, or another ID that shows the date of birth (birth certificate for a child).'}</small></div>
                  {(a[f.perMember] || []).length === 0 && <small className="ob-err">{f.perMember === 'travellers' ? 'Add the travellers first (in the travellers step).' : 'Add the family members first (in the members step).'}</small>}
                  {(a[f.perMember] || []).map((row, i) => {
                    const k = `${f.k}.${i}`;
                    const self = f.selfSkip !== false && row?.relation === 'Self';
                    return (
                      <Field key={k} f={{ ...f, k, label: `${row?.name || 'Member ' + (i + 1)}${row?.relation ? ' (' + row.relation + ')' : ''}${self ? ' — your Aadhaar above is used' : ''}`, req: f.req && !self, help: undefined }}
                        error={errs[k]} files={files[k]} prior={prior[k]} onFiles={(file) => addFile(k, file)}
                        onRemoveFile={(j) => setFiles((x) => ({ ...x, [k]: x[k].filter((_, n) => n !== j) }))} />
                    );
                  })}
                </div>
              ) : (
                <Fragment key={f.k}>
                  <Field f={f} value={a[f.k]} error={errs[f.k]} onChange={(v) => set(f.k, v)}
                    files={files[f.k]} prior={prior[f.k]} onFiles={(file) => addFile(f.k, file)}
                    onRemoveFile={(i) => setFiles((x) => ({ ...x, [f.k]: x[f.k].filter((_, j) => j !== i) }))} />
                  {f.k === 'weight_kg' && <BmiChip h={a.height_cm} w={a.weight_kg} dob={a.dob} />}
                </Fragment>
              ))}
            </div>
          </>
        ) : (
          <>
            <h2><Ic name="check" size={18} /> Check and submit</h2>
            <p className="ob-help">Please check your answers. Tap a section above to change it.</p>
            {sections.map((s, i) => (
              <div key={s.title} className="ob-review">
                <div className="ob-review-head"><b>{s.title}</b><button type="button" onClick={() => setStep(i)}>Edit</button></div>
                {s.fields.filter((f) => shown(f, a) && f.type !== 'declaration').map((f) => {
                  if (f.type === 'file' && f.perMember) return (a[f.perMember] || []).map((row, j) => { const n = (filesAll[`${f.k}.${j}`] || []).map((x) => x.name).join(', '); return n ? <div key={f.k + j} className="ob-kv"><span>{f.docName || 'ID proof'} — {row?.name || 'Member ' + (j + 1)}</span><b>{n}</b></div> : null; });
                  if (f.type === 'file') { const n = (filesAll[f.k] || []).map((x) => x.name).join(', '); return n ? <div key={f.k} className="ob-kv"><span>{f.label}</span><b>{n}</b></div> : null; }
                  if (f.type === 'repeat') return (a[f.k] || []).map((row, j) => (
                    <div key={f.k + j} className="ob-kv"><span>{f.k === 'nominees' ? 'Nominee' : f.k === 'travellers' ? 'Traveller' : 'Member'} {j + 1}</span>
                      <b>{f.fields.filter((sf) => shown(sf, row) && row[sf.k]).map((sf) => row[sf.k]).join(' · ')}</b></div>
                  ));
                  return a[f.k] ? <div key={f.k} className="ob-kv"><span>{f.label}</span><b>{String(a[f.k])}</b></div> : null;
                })}
              </div>
            ))}
          </>
        )}
        {msg && <div className="ob-alert">{msg}</div>}
        <div className="ob-nav">
          {step > 0 && <button type="button" className="ob-btn ghost" onClick={() => { setStep((s) => s - 1); window.scrollTo({ top: 0 }); }}>Back</button>}
          {!review ? <button type="button" className="ob-btn" onClick={next}>{step === sections.length - 1 ? 'Review' : 'Next'}</button>
            : <button type="button" className="ob-btn" onClick={submit} disabled={busy}>{busy ? 'Sending…' : 'Submit form'}</button>}
        </div>
      </div>
      <footer className="ob-foot">Your details go only to WeCare Assurance and the insurer issuing your policy. Questions? Reply to the email we sent you.</footer>
    </div>
  );
}
