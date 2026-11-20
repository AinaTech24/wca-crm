// Settings → Onboarding form: the forms by line of business, and a designer for each — see it as the client
// will, show or hide questions, make them required or optional, rename them, and add your own.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';
import Select from '../components/Select.jsx';
import { Ic } from '../components/Icons.jsx';
import toast from '../components/toast.js';
import confirm from '../components/confirm.js';
import { FormPreview } from './OnboardPage.jsx';

const TYPE_LABEL = { text: 'Short answer', textarea: 'Long answer', number: 'Number', date: 'Date', select: 'Choice list', yesno: 'Yes / No', file: 'Document upload', email: 'Email', tel: 'Phone', repeat: 'Table (rows)', declaration: 'Consent tick' };
const GROUP_ORDER = ['Health', 'Motor', 'Life', 'Personal', 'Property', 'Commercial', 'Group', 'Other'];

/** The forms, grouped by line of business. */
export function FormGallery({ forms, onOpen }) {
  const groups = useMemo(() => GROUP_ORDER.map((g) => [g, forms.filter((f) => f.group === g)]).filter(([, l]) => l.length), [forms]);
  return groups.map(([g, list]) => (
    <div key={g} className="fg-group">
      <div className="set-sub">{g}</div>
      <div className="fg-grid">
        {list.map((f) => (
          <button key={f.key} type="button" className="fg-card" style={{ '--fc': f.theme?.color }} onClick={() => onOpen(f.key)}>
            <span className="fg-top"><span className="fg-ic"><Ic name={f.theme?.icon || 'doc'} size={16} /></span>{f.changed > 0 && <span className="badge orange">{f.changed} change{f.changed === 1 ? '' : 's'}</span>}</span>
            <b>{f.label}</b>
            <small>{f.blurb}</small>
            <span className="fg-meta">{f.sections.length} sections · {f.questions} questions · ~{f.minutes} min · {f.needs.length} documents</span>
          </button>
        ))}
      </div>
    </div>
  ));
}

export default function FormDesigner({ formKey, onClose, onSaved }) {
  const [d, setD] = useState(null);
  const [tab, setTab] = useState('design');
  const [hidden, setHidden] = useState([]);
  const [required, setRequired] = useState({});
  const [labels, setLabels] = useState({});
  const [extra, setExtra] = useState([]);
  const [adding, setAdding] = useState(null);   // { section, label, type, options, req }
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const take = (x) => {
    setD(x);
    setHidden(x.sections.flatMap((s) => s.fields.filter((f) => f.hidden).map((f) => f.k)));
    setRequired(Object.fromEntries(x.sections.flatMap((s) => s.fields.filter((f) => !f.custom && f.req !== f.base_req).map((f) => [f.k, f.req]))));
    setLabels(Object.fromEntries(x.sections.flatMap((s) => s.fields.filter((f) => !f.custom && f.label !== f.base_label).map((f) => [f.k, f.label]))));
    setExtra(x.sections.flatMap((s, i) => s.fields.filter((f) => f.custom).map(({ custom, ...field }) => ({ section: i, field }))));
    setDirty(false);
  };
  useEffect(() => { api('/settings/onboarding-forms/' + formKey).then(take).catch((e) => { toast.error(e.message || 'Could not open the form'); onClose(); }); }, [formKey]);   // eslint-disable-line react-hooks/exhaustive-deps

  const touch = (fn) => { fn(); setDirty(true); };
  async function save(reset) {
    if (reset && !(await confirm({ title: 'Back to the standard form?', message: 'Your changes to this form are removed — hidden questions come back and your own questions are deleted.', confirmText: 'Reset', tone: 'danger', icon: 'refresh' }))) return;
    setBusy(true);
    try {
      const body = reset ? {} : { hidden, required, labels, extra };
      take(await api('/settings/onboarding-forms/' + formKey, { method: 'PUT', body }));
      toast.success(reset ? 'Form reset to standard' : 'Form saved — new forms sent to clients use it');
      onSaved?.();
    } catch (e) { toast.error(e.message || 'Could not save'); } finally { setBusy(false); }
  }
  function addQuestion() {
    const a = adding;
    if (!a.label.trim()) { toast.error('Write the question'); return; }
    if (a.type === 'select' && !String(a.options || '').split(',').map((x) => x.trim()).filter(Boolean).length) { toast.error('Add the choices, separated by commas'); return; }
    touch(() => setExtra((x) => [...x, { section: a.section, field: { k: 'x_' + Math.random().toString(36).slice(2, 9), label: a.label.trim(), type: a.type, req: !!a.req, ...(a.type === 'select' ? { options: a.options.split(',').map((o) => o.trim()).filter(Boolean) } : {}) } }]));
    setAdding(null);
  }

  // The preview reflects unsaved changes too.
  const preview = useMemo(() => {
    if (!d) return null;
    const h = new Set(hidden);
    const sections = d.preview.sections.map((s) => s);
    // Rebuild from the designer data so unsaved edits show.
    const secs = d.sections.map((s, i) => ({
      title: s.title, icon: s.icon, help: d.base.sections[i]?.help,
      fields: [
        ...s.fields.filter((f) => !f.custom && !h.has(f.k)).map((f) => {
          const orig = d.base.sections.flatMap((p) => p.fields).find((p) => p.k === f.k) || f;
          return { ...orig, label: labels[f.k] || f.base_label, req: f.k in required ? required[f.k] : f.base_req };
        }),
        ...extra.filter((e) => e.section === i).map((e) => ({ ...e.field, custom: true })),
      ],
    })).filter((s) => s.fields.length);
    void sections;
    return { ...d.preview, sections: secs, needs: secs.flatMap((s) => s.fields).filter((f) => f.type === 'file').map((f) => `${f.label}${f.req ? '' : ' (if you have it)'}`) };
  }, [d, hidden, required, labels, extra]);

  if (!d) return <Modal open page onClose={onClose} title="Form" size="xl"><div className="spinner">Loading…</div></Modal>;
  const changes = hidden.length + Object.keys(required).length + Object.keys(labels).length + extra.length;
  return (
    <Modal open page onClose={async () => { if (!dirty || await confirm({ title: 'Leave without saving?', message: 'Your changes to this form are not saved.', confirmText: 'Leave', tone: 'danger' })) onClose(); }}
      title={d.label} subtitle={`${d.group} · ${changes ? `${changes} change${changes === 1 ? '' : 's'} from the standard form` : 'the standard form'}`} icon={d.theme?.icon || 'doc'} size="xl"
      footer={<div className="qt-actions">
        <button className="btn ghost" disabled={busy} onClick={() => save(true)}><Ic name="refresh" size={15} /> Reset to standard</button>
        <span style={{ flex: 1 }} />
        {dirty && <span className="fd-unsaved">Unsaved changes</span>}
        <button className="btn blue" disabled={busy || !dirty} onClick={() => save(false)}><Ic name="check" size={15} /> Save form</button>
      </div>}>
      <div className="tabs" style={{ marginBottom: 14 }}>
        <button className={'tab' + (tab === 'design' ? ' active' : '')} onClick={() => setTab('design')}><Ic name="edit" size={14} /> Design</button>
        <button className={'tab' + (tab === 'preview' ? ' active' : '')} onClick={() => setTab('preview')}><Ic name="eye" size={14} /> Preview — as the client sees it</button>
      </div>

      {tab === 'preview' ? <FormPreview form={preview} /> : (
        <div className="fd">
          <p className="fd-help">Untick <b>Show</b> to leave a question out, tick <b>Required</b> to make it compulsory, click a question to rename it, and add your own questions to any section. Fields that fill the client record (name, PAN, address…) keep doing so after renaming.</p>
          {d.sections.map((s, i) => (
            <div key={s.title} className="fd-sec">
              <div className="fd-sec-head"><Ic name={s.icon || 'doc'} size={15} /> <b>{i + 1}. {s.title}</b>
                <button type="button" className="btn ghost sm" onClick={() => setAdding({ section: i, label: '', type: 'text', options: '', req: false })}><Ic name="plus" size={13} /> Add question</button>
              </div>
              <div className="fd-rows">
                <div className="fd-row fd-th"><span>Question</span><span>Answer type</span><span>Show</span><span>Required</span></div>
                {s.fields.filter((f) => !f.custom).map((f) => {
                  const off = hidden.includes(f.k);
                  const req = f.k in required ? required[f.k] : f.base_req;
                  return (
                    <div key={f.k} className={'fd-row' + (off ? ' off' : '')}>
                      <span className="fd-q">
                        <input value={labels[f.k] ?? f.base_label} disabled={off} onChange={(e) => touch(() => setLabels((x) => { const n = { ...x }; if (e.target.value === f.base_label) delete n[f.k]; else n[f.k] = e.target.value; return n; }))} />
                        {f.show && <small>only when “{d.sections.flatMap((x) => x.fields).find((x) => x.k === f.show[0])?.base_label || f.show[0]}” is {f.show[1]}</small>}
                        {f.sub && <small>Columns: {f.sub.join(', ')}</small>}
                      </span>
                      <span className="fd-type">{TYPE_LABEL[f.type] || f.type}</span>
                      <span><input type="checkbox" checked={!off} disabled={f.locked} title={f.locked ? 'Always asked' : ''} onChange={(e) => touch(() => setHidden((h) => (e.target.checked ? h.filter((k) => k !== f.k) : [...h, f.k])))} /></span>
                      <span><input type="checkbox" checked={req} disabled={f.locked || off} onChange={(e) => touch(() => setRequired((r) => { const n = { ...r }; if (e.target.checked === f.base_req) delete n[f.k]; else n[f.k] = e.target.checked; return n; }))} /></span>
                    </div>
                  );
                })}
                {extra.filter((e) => e.section === i).map((e) => (
                  <div key={e.field.k} className="fd-row custom">
                    <span className="fd-q"><input value={e.field.label} onChange={(ev) => touch(() => setExtra((x) => x.map((y) => (y.field.k === e.field.k ? { ...y, field: { ...y.field, label: ev.target.value } } : y))))} />
                      <small>Your question{e.field.options ? ` · ${e.field.options.join(', ')}` : ''}</small></span>
                    <span className="fd-type">{TYPE_LABEL[e.field.type]}</span>
                    <span><button type="button" className="action-btn danger" title="Remove" onClick={() => touch(() => setExtra((x) => x.filter((y) => y.field.k !== e.field.k)))}><Ic name="trash" size={13} /></button></span>
                    <span><input type="checkbox" checked={!!e.field.req} onChange={(ev) => touch(() => setExtra((x) => x.map((y) => (y.field.k === e.field.k ? { ...y, field: { ...y.field, req: ev.target.checked } } : y))))} /></span>
                  </div>
                ))}
              </div>
              {adding?.section === i && (
                <div className="fd-add">
                  <input autoFocus placeholder="Your question, e.g. Preferred hospital" value={adding.label} onChange={(e) => setAdding((a) => ({ ...a, label: e.target.value }))} />
                  <Select value={adding.type} onChange={(e) => setAdding((a) => ({ ...a, type: e.target.value }))}>
                    {['text', 'textarea', 'number', 'date', 'yesno', 'select', 'file'].map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                  </Select>
                  {adding.type === 'select' && <input placeholder="Choices, separated by commas" value={adding.options} onChange={(e) => setAdding((a) => ({ ...a, options: e.target.value }))} />}
                  <label className="is-check"><input type="checkbox" checked={adding.req} onChange={(e) => setAdding((a) => ({ ...a, req: e.target.checked }))} /> Required</label>
                  <button type="button" className="btn blue sm" onClick={addQuestion}>Add</button>
                  <button type="button" className="btn ghost sm" onClick={() => setAdding(null)}>Cancel</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
