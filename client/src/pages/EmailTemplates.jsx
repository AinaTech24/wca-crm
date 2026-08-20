import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import toast from '../components/toast.js';
import confirm from '../components/confirm.js';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';
import { Ic } from '../components/Icons.jsx';
import { useNavigate } from 'react-router-dom';

// Stand-in values so the preview reads like a real email rather than a page
// of raw {tokens}.
const SAMPLE = {
  '{client}': 'Rahul Mehta',
  '{policy_no}': 'RH/2026/0912',
  '{company}': 'Star Health & Allied Insurance',
  '{product}': 'Family Health Optima',
  '{expiry}': '30-06-2027',
  '{premium}': '28,500',
  '{claim_no}': 'RH-CLM-1001',
  '{owner}': 'Admin User',
  '{org}': 'WeCare Assurance',
};
const fill = (text) =>
  Object.entries(SAMPLE).reduce((out, [k, v]) => out.split(k).join(v), String(text || ''));

const prettyName = (tkey) =>
  String(tkey || '').split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

export default function EmailTemplates() {
  const [rows, setRows] = useState([]);
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeKey, setActiveKey] = useState(null);
  const [draft, setDraft] = useState({ subject: '', body: '' });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(null);   // { name, subject }
  const [testTo, setTestTo] = useState(null);   // recipient address while the test modal is open
  const bodyRef = useRef(null);
  const navigate = useNavigate();

  function load(selectKey) {
    setLoading(true);
    api('/templates').then((r) => {
      setRows(r.templates || []);
      setTokens(r.tokens || []);
      const key = selectKey || activeKey || r.templates?.[0]?.tkey || null;
      const t = (r.templates || []).find((x) => x.tkey === key);
      setActiveKey(key);
      setDraft({ subject: t?.subject || '', body: t?.body || '' });
      setDirty(false);
    }).catch(() => {}).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  const active = useMemo(() => rows.find((r) => r.tkey === activeKey) || null, [rows, activeKey]);

  async function pick(t) {
    if (dirty && !(await confirm({ title: 'Discard unsaved changes?', message: 'Your edits to this template will be lost.', tone: 'danger', confirmText: 'Discard' }))) return;
    setActiveKey(t.tkey);
    setDraft({ subject: t.subject || '', body: t.body || '' });
    setDirty(false);
  }

  const set = (k, v) => { setDraft((d) => ({ ...d, [k]: v })); setDirty(true); };

  // Insert at the caret rather than appending, so a token lands where the
  // user is actually writing.
  function insertToken(token) {
    const el = bodyRef.current;
    if (!el) { set('body', (draft.body || '') + token); return; }
    const start = el.selectionStart ?? draft.body.length;
    const end = el.selectionEnd ?? start;
    const next = draft.body.slice(0, start) + token + draft.body.slice(end);
    set('body', next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function save() {
    if (!activeKey) return;
    setSaving(true);
    try {
      const row = await api('/templates/' + encodeURIComponent(activeKey), { method: 'PUT', body: draft });
      setRows((prev) => prev.map((r) => (r.tkey === activeKey ? row : r)));
      setDirty(false);
      toast.success('Template saved');
    } catch (e) { toast.error(e.message || 'Could not save template'); }
    finally { setSaving(false); }
  }

  async function create() {
    const name = (adding.name || '').trim();
    if (!name) { toast.error('Give the template a name'); return; }
    setSaving(true);
    try {
      const row = await api('/templates', { method: 'POST', body: { name, subject: adding.subject || '', body: '' } });
      setAdding(null);
      load(row.tkey);
      toast.success('Template created');
    } catch (e) { toast.error(e.message || 'Could not create template'); }
    finally { setSaving(false); }
  }

  async function del(t) {
    const ok = await confirm({
      title: 'Delete template?', message: `“${prettyName(t.tkey)}” will be permanently removed.`,
      tone: 'danger', confirmText: 'Delete', icon: 'trash',
    });
    if (!ok) return;
    try {
      await api('/templates/' + encodeURIComponent(t.tkey), { method: 'DELETE' });
      setActiveKey(null);
      load();
      toast.success('Template deleted');
    } catch (e) { toast.error(e.message || 'Could not delete'); }
  }

  // Sends the filled-in preview through the configured SMTP account, so the
  // template can be checked end-to-end before it's used for real.
  async function sendTest() {
    if (!testTo || !testTo.trim()) { toast.error('Enter an email address'); return; }
    setSaving(true);
    try {
      await api('/send-email', {
        method: 'POST',
        body: {
          to: testTo.trim(),
          subject: '[Test] ' + fill(draft.subject),
          html: `<div style="font-family:Arial,Helvetica,sans-serif;white-space:pre-wrap;line-height:1.6">${fill(draft.body)}</div>`,
        },
      });
      toast.success('Test email sent');
      setTestTo(null);
    } catch (e) {
      toast.error(e.message || 'Could not send — check Email Integration in My Profile');
    } finally { setSaving(false); }
  }

  return (
    <div>
      <PageHeader
        title="Email Templates"
        subtitle="Reusable subject and body text, with placeholders filled in at send time"
        action={
          <>
            <button className="btn ghost" onClick={() => navigate('/page/my-profile')}>
              <Ic name="sliders" size={15} /> SMTP Settings
            </button>
            <button className="btn blue" onClick={() => setAdding({ name: '', subject: '' })}>
              <Ic name="plus" size={16} /> New Template
            </button>
          </>
        }
      />

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="hint-line" style={{ marginTop: 0, fontSize: 12.5 }}>
          <Ic name="mail" size={13} />{' '}
          Sending uses the SMTP account saved under <strong>My Profile → Email Integration</strong>
          (host, port, security, username and app password). Set it there once, and everything that sends
          mail — RFQs to insurers, client comparisons and these templates — uses it.
        </div>
      </div>

      {loading && <div className="notif-empty"><span>Loading…</span></div>}

      {!loading && (
        <div className="tpl-layout">
          <div className="card card-pad tpl-list">
            <div className="section-head">Templates ({rows.length})</div>
            {rows.length === 0 && <div className="empty-inline">No templates yet — create your first one.</div>}
            {rows.map((t) => (
              <button
                key={t.tkey}
                className={'tpl-item' + (t.tkey === activeKey ? ' active' : '')}
                onClick={() => pick(t)}
              >
                <span className="tpl-item-ic"><Ic name="mail" size={15} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="tpl-item-name">{prettyName(t.tkey)}</span>
                  <span className="tpl-item-sub">{t.subject || 'No subject yet'}</span>
                </span>
              </button>
            ))}
          </div>

          {!active ? (
            <div className="card card-pad">
              <div className="notif-empty"><Ic name="mail" size={22} /><span>Select a template to edit</span></div>
            </div>
          ) : (
            <div className="card card-pad">
              <div className="tpl-head">
                <div>
                  <div className="section-head" style={{ marginBottom: 2 }}>{prettyName(active.tkey)}</div>
                  <div className="hint-line" style={{ marginTop: 0 }}>
                    Key <code>{active.tkey}</code>{active.updated_at ? ` · updated ${active.updated_at}` : ''}
                    {dirty && <strong style={{ color: 'var(--warning)' }}> · unsaved changes</strong>}
                  </div>
                </div>
                <div className="tpl-actions">
                  <button className="btn ghost sm" onClick={() => setTestTo('')}><Ic name="send" size={14} /> Send Test</button>
                  <button className="action-btn danger" title="Delete template" onClick={() => del(active)}><Ic name="trash" size={15} /></button>
                </div>
              </div>

              <div className="form-field" style={{ marginTop: 14 }}>
                <label>Subject</label>
                <input value={draft.subject} onChange={(e) => set('subject', e.target.value)} placeholder="e.g. Your {product} policy is due for renewal" />
              </div>

              <div className="form-field" style={{ marginTop: 12 }}>
                <label>Body</label>
                <textarea ref={bodyRef} rows={12} value={draft.body} onChange={(e) => set('body', e.target.value)}
                  placeholder={'Dear {client},\n\nYour policy {policy_no} with {company} expires on {expiry}.\n\nRegards,\n{org}'} />
              </div>

              <div className="tpl-tokens">
                <span className="tpl-tokens-label">Insert placeholder:</span>
                {tokens.map((t) => (
                  <button key={t.token} type="button" className="chip" title={t.label} onClick={() => insertToken(t.token)}>
                    {t.token}
                  </button>
                ))}
              </div>

              <div className="btn-row" style={{ marginTop: 14 }}>
                <button className="btn blue" onClick={save} disabled={saving || !dirty}>
                  {saving ? 'Saving…' : dirty ? 'Save Template' : 'Saved'}
                </button>
              </div>

              <div className="sub-section">
                <div className="section-head">Preview</div>
                <div className="hint-line" style={{ marginTop: 0 }}>Placeholders filled with sample data, so you can see how it reads.</div>
                <div className="tpl-preview">
                  <div className="tpl-preview-subject">{fill(draft.subject) || '(no subject)'}</div>
                  <div className="tpl-preview-body">{fill(draft.body) || '(empty body)'}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <Modal
        open={!!adding}
        onClose={() => setAdding(null)}
        title="New Email Template"
        subtitle="Give it a name — the key is generated from it"
        icon="mail"
        size="sm"
        footer={
          <>
            <button className="btn ghost" onClick={() => setAdding(null)}>Cancel</button>
            <button className="btn blue" onClick={create} disabled={saving}>{saving ? 'Creating…' : 'Create'}</button>
          </>
        }
      >
        {adding && (
          <>
            <div className="form-field">
              <label>Template Name <span className="req">*</span></label>
              <input value={adding.name} autoFocus onChange={(e) => setAdding((a) => ({ ...a, name: e.target.value }))} placeholder="e.g. Renewal Reminder" />
              {adding.name.trim() && (
                <div className="hint-line">Key: <code>{adding.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}</code></div>
              )}
            </div>
            <div className="form-field" style={{ marginTop: 12 }}>
              <label>Subject</label>
              <input value={adding.subject} onChange={(e) => setAdding((a) => ({ ...a, subject: e.target.value }))} placeholder="Optional — you can add it after" />
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={testTo !== null}
        onClose={() => setTestTo(null)}
        title="Send Test Email"
        subtitle="Sends this template, with sample data filled in"
        icon="send"
        size="sm"
        footer={
          <>
            <button className="btn ghost" onClick={() => setTestTo(null)}>Cancel</button>
            <button className="btn blue" onClick={sendTest} disabled={saving}>{saving ? 'Sending…' : 'Send Test'}</button>
          </>
        }
      >
        <div className="form-field">
          <label>Send to</label>
          <input value={testTo || ''} autoFocus onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" />
          <div className="hint-line">Uses the SMTP account from My Profile → Email Integration.</div>
        </div>
      </Modal>
    </div>
  );
}
