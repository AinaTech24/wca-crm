// Quotation module — the client side of the sale. An RFQ collects the insurers' quotes; a quotation is
// what goes to the client (the chosen options, our recommendation, how long it holds) and records what the
// client decided, through to the policy. A quotation can also be made directly, without an RFQ.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import Modal from '../components/Modal.jsx';
import Select from '../components/Select.jsx';
import DateField from '../components/DateField.jsx';
import DataTable from '../components/DataTable.jsx';
import HistoryButton from '../components/HistoryButton.jsx';
import WhatsAppButton from '../components/WhatsAppButton.jsx';
import { Ic } from '../components/Icons.jsx';
import toast from '../components/toast.js';
import confirm from '../components/confirm.js';
import { useRealtime } from '../realtime.js';
import { useOpenFromUrl } from '../useOpenFromUrl.js';
import { printHTML, buildCompareDoc, htmlToPdfBase64, comparisonDocName, shortIns } from '../components/printDoc.js';
import { quoteAttachments, attachmentsBytes, ATTACHMENT_LIMIT_BYTES, mb } from './rfqDocs.js';
import { sendEmailWith, sendWhatsApp } from './quoteShare.js';

export const QUOTE_STATUSES = ['Draft', 'Shared', 'Approved', 'Converted', 'Rejected', 'Expired'];
export const QUOTE_BADGE = { Draft: '', Shared: 'blue', Approved: 'green', Converted: 'green', Rejected: 'red', Expired: 'orange', Superseded: '' };
const CATEGORIES = ['Motor', 'Workmen Compensation', 'Group Personal Accident', 'Group Health Insurance', 'Retail Health', 'Fire & Property',
  'Householder', 'Marine Cargo', 'Liability', 'Group Term Life', 'Life Insurance', 'Personal Accident', 'Travel', 'Other'];
const NATURES = ['New', 'Renewal', 'Rollover'];
const REJECT_REASONS = ['Premium too high', 'Went with another insurer / broker', 'Not buying now', 'Cover not suitable', 'No response from client', 'Other'];

const inr = (v) => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const istToday = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dmy = (iso) => (/^\d{4}-\d{2}-\d{2}/.test(iso || '') ? iso.slice(0, 10).split('-').reverse().join('-') : '—');
const parse = (v, fb) => { if (Array.isArray(v) || (v && typeof v === 'object')) return v; try { return JSON.parse(v || ''); } catch { return fb; } };
const blankOption = () => ({ insurer: '', premium: '', od_premium: '', tp_premium: '', addon_premium: '', idv: '', ncb: '', addons_incl: '', remark: '', recommended: false, quote_doc: '', quote_name: '' });
function viewDoc(uri) {
  if (!uri) return;
  fetch(uri).then((r) => r.blob()).then((b) => { const u = URL.createObjectURL(b); window.open(u, '_blank'); setTimeout(() => URL.revokeObjectURL(u), 60000); })
    .catch(() => toast.error('Could not open the file'));
}
const readFile = (file) => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(file); });

/** The quotation in the shape the comparison document is built from. */
function docOf(q) {
  return {
    ...(q.rfq || {}), rfq_no: q.rfq?.rfq_no || q.display_no, client_name: q.client_name, mobile: q.mobile, email: q.email,
    category: q.category || q.rfq?.category || q.product, product: q.product || q.category, policy_type: q.policy_type || q.rfq?.policy_type || '',
    policy_nature: q.policy_nature || q.rfq?.policy_nature || 'New', sum_assured: q.sum_assured, details: q.rfq?.details || '{}',
    add_ons: q.rfq?.add_ons || '[]', requested_idv: q.rfq?.requested_idv || q.sum_assured, due_date: istToday(),
    insurers: (q.options || []).map((o) => ({ ...o, status: 'Quoted', selected: !!o.recommended, client_approved: !!o.approved })),
  };
}

/* ======================================================================
   The page
   ====================================================================== */
export default function Quotations() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState(() => { try { return localStorage.getItem('wca_quote_view') || 'list'; } catch { return 'list'; } });
  const [card, setCard] = useState('');
  const [status, setStatus] = useState('');
  const [openId, setOpenId] = useState(null);
  const [editor, setEditor] = useState(null);       // { quote? } — direct quotation, new or draft
  const [chooser, setChooser] = useState(false);
  const [fromRfq, setFromRfq] = useState(null);
  const load = () => api('/quotations').then(setRows).catch((e) => toast.error(e.message || 'Could not load quotations')).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);
  useRealtime('quotation', () => load());
  useOpenFromUrl(rows, loading, (r) => setOpenId(r.id), () => setChooser(true));
  const switchView = (v) => { setView(v); try { localStorage.setItem('wca_quote_view', v); } catch { /* fine */ } };

  const today = istToday();
  const live = rows.filter((r) => r.status !== 'Superseded');
  const month = today.slice(0, 7);
  const decidedThisMonth = live.filter((r) => (r.decided_at || '').slice(0, 7) === month);
  const convertedThisMonth = live.filter((r) => r.status === 'Converted' && (r.decided_at || r.created_at || '').slice(0, 7) === month);
  const CARDS = [
    { key: 'draft', label: 'Draft', icon: 'edit', tone: 'neutral', test: (r) => r.status === 'Draft', hint: 'not yet sent to the client' },
    { key: 'shared', label: 'Awaiting reply', icon: 'send', tone: 'info', test: (r) => r.status === 'Shared', hint: 'with the client' },
    { key: 'expiring', label: 'Expiring in 3 days', icon: 'clock', tone: 'warning', test: (r) => r.status === 'Shared' && r.valid_till && r.valid_till <= addDays(today, 3), hint: 'chase or extend' },
    { key: 'approved', label: 'Approved — awaiting policy', icon: 'check', tone: 'success', test: (r) => r.status === 'Approved', hint: 'convert to policy' },
    { key: 'converted', label: 'Converted this month', icon: 'file', tone: 'success', test: (r) => r.status === 'Converted' && (r.decided_at || r.created_at || '').slice(0, 7) === month,
      hint: decidedThisMonth.length ? `${Math.round((convertedThisMonth.length / decidedThisMonth.length) * 100)}% of decided quotes` : 'quote to policy' },
  ];
  const cardDef = CARDS.find((c) => c.key === card);
  const shown = useMemo(() => {
    let list = status === 'Superseded' ? rows.filter((r) => r.status === 'Superseded') : live;
    if (status && status !== 'Superseded') list = list.filter((r) => r.status === status);
    if (cardDef) list = list.filter(cardDef.test);
    return list;
  }, [rows, status, card]);   // eslint-disable-line react-hooks/exhaustive-deps

  const recOf = (r) => (r.options || []).find((o) => o.recommended);
  return (
    <div>
      <PageHeader title="Quotations" action={
        <button className="btn blue" onClick={() => setChooser(true)}><Ic name="plus" size={15} /> New Quotation</button>
      } />

      <div className="kpi-grid five" style={{ marginBottom: 18 }}>
        {CARDS.map((c) => (
          <div key={c.key} className={'kpi-card kpi-link' + (card === c.key ? ' kpi-active' : '')} data-tone={c.tone} role="button" tabIndex={0}
            onClick={() => setCard((k) => (k === c.key ? '' : c.key))}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCard((k) => (k === c.key ? '' : c.key)); } }}>
            <div className="kpi-card-top"><span className="kpi-card-ic"><Ic name={c.icon} size={16} /></span><span className="kpi-card-label">{c.label}</span></div>
            <div className="kpi-card-num">{live.filter(c.test).length}</div>
            <div className="kpi-card-hint">{c.hint}</div>
          </div>
        ))}
      </div>

      <div className="lead-toolbar">
        <div className="tabs" style={{ marginBottom: 0 }}>
          <button className={'tab' + (view === 'list' ? ' active' : '')} onClick={() => switchView('list')}><Ic name="grid" size={14} /> List</button>
          <button className={'tab' + (view === 'kanban' ? ' active' : '')} onClick={() => switchView('kanban')}><Ic name="chart" size={14} /> Kanban</button>
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 200 }} aria-label="Status">
          <option value="">All current quotations</option>
          {QUOTE_STATUSES.map((s) => <option key={s}>{s}</option>)}
          <option value="Superseded">Old versions (superseded)</option>
        </Select>
        {(card || status) && <button className="btn ghost" onClick={() => { setCard(''); setStatus(''); }}><Ic name="x" size={14} /> Show all</button>}
      </div>

      {view === 'kanban' ? (
        <div className="kanban">
          {QUOTE_STATUSES.map((st) => {
            const cards = shown.filter((r) => r.status === st);
            return (
              <div key={st} className="kanban-col">
                <div className="kanban-col-head"><span><span className={'kanban-dot ' + (QUOTE_BADGE[st] || '')} /> {st}</span><span className="kanban-count">{cards.length}</span></div>
                {cards.length === 0 && <div className="kanban-empty">{loading ? 'Loading…' : 'None'}</div>}
                {cards.map((r) => {
                  const rec = recOf(r);
                  return (
                    <div key={r.id} className="kanban-card" onClick={() => setOpenId(r.id)} title="Open this quotation">
                      <div className="kanban-rfq-top"><b>{r.display_no}</b>{r.rfq_no ? <span className="badge">{r.rfq_no}</span> : <span className="badge orange">Direct</span>}</div>
                      <div className="kanban-name">{r.client_name}</div>
                      <div className="kanban-company">{r.product || r.category}</div>
                      <div className="kanban-meta">
                        <span><Ic name="doc" size={11} /> {(r.options || []).length} option{(r.options || []).length === 1 ? '' : 's'}</span>
                        {rec && <span title="Recommended"><Ic name="star" size={11} /> {shortIns(rec.insurer)} ₹{inr(rec.premium)}</span>}
                        {r.approved_insurer && <span title="Client chose"><Ic name="check" size={11} /> {shortIns(r.approved_insurer)}</span>}
                        {r.status === 'Shared' && r.valid_till && <span className={r.valid_till < today ? 'overdue-date' : undefined}><Ic name="calendar" size={11} /> till {dmy(r.valid_till)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <DataTable
            title={cardDef ? `Quotations — ${cardDef.label}` : 'Quotations'}
            count={shown.length}
            loading={loading}
            rows={shown}
            onRowClick={(r) => setOpenId(r.id)}
            searchPlaceholder="Search client, quotation or RFQ no…"
            searchKeys={['display_no', 'client_name', 'product', 'rfq_no', 'selected_insurer']}
            columns={[
              { key: 'display_no', label: 'Quotation', render: (r) => <b>{r.display_no}</b> },
              { key: 'client_name', label: 'Client' },
              { key: 'product', label: 'Product', render: (r) => r.product || r.category || '—' },
              { key: 'rfq_no', label: 'RFQ', render: (r) => (r.rfq_no ? <span className="badge">{r.rfq_no}</span> : <span className="badge orange">Direct</span>) },
              { key: 'selected_insurer', label: 'Recommended', render: (r) => (r.selected_insurer ? `${shortIns(r.selected_insurer)} · ₹${inr(r.selected_premium)}` : '—') },
              { key: 'options', label: 'Options', noFilter: true, num: true, render: (r) => (r.options || []).length },
              { key: 'valid_till', label: 'Valid till', render: (r) => <span className={r.status === 'Shared' && r.valid_till && r.valid_till < today ? 'overdue-date' : undefined}>{dmy(r.valid_till)}</span> },
              { key: 'status', label: 'Status', render: (r) => <span className="rfq-status-cell"><span className={'badge ' + (QUOTE_BADGE[r.status] || '')}>{r.status}</span>{r.approved_insurer && ['Approved', 'Converted'].includes(r.status) ? <span className="badge green">{shortIns(r.approved_insurer)}</span> : null}</span> },
              { key: 'assigned_to', label: 'Owner' },
            ]}
            actions={(r) => (
              <>
                <button className="action-btn" title="Open" onClick={() => setOpenId(r.id)}><Ic name="eye" size={15} /></button>
                {r.status === 'Approved' && <button className="action-btn" title="Convert to policy" onClick={() => setOpenId(r.id)}><Ic name="file" size={15} /></button>}
                {r.policy_id && <button className="action-btn done" title="Open the policy" onClick={() => navigate('/page/policy?open=' + r.policy_id)}><Ic name="file" size={15} /></button>}
              </>
            )}
            empty={{ icon: 'doc', title: 'No quotations yet', sub: 'Create one from an RFQ once insurers have quoted, or make a direct quotation.' }}
          />
        </div>
      )}

      {chooser && <NewChooser onClose={() => setChooser(false)} onDirect={() => { setChooser(false); setEditor({}); }} onRfq={(r) => { setChooser(false); setFromRfq(r); }} />}
      {fromRfq && <FromRfqModal rfq={fromRfq} onClose={() => setFromRfq(null)} onDone={(id) => { setFromRfq(null); load(); setOpenId(id); }} />}
      {editor && <QuoteEditor quote={editor.quote} onClose={() => setEditor(null)} onSaved={(id) => { setEditor(null); load(); setOpenId(id); }} />}
      {openId && <QuoteDetail id={openId} onClose={() => setOpenId(null)} onChanged={load} onSwitch={setOpenId} onEdit={(q) => { setOpenId(null); setEditor({ quote: q }); }} />}
    </div>
  );
}

/* ---------- New: from an RFQ, or direct ---------- */
function NewChooser({ onClose, onDirect, onRfq }) {
  const [rfqs, setRfqs] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => { api('/rfqs').then((list) => setRfqs(list.filter((r) => !['Lost', 'Closed'].includes(r.status) && parse(r.insurers, []).some((i) => Number(i.premium) > 0)))).catch(() => setRfqs([])); }, []);
  const list = (rfqs || []).filter((r) => !q || `${r.rfq_no} ${r.client_name} ${r.product}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal open onClose={onClose} title="New quotation" subtitle="Build it from an RFQ's insurer quotes, or quote directly without an RFQ" icon="doc" size="md">
      <button type="button" className="qt-choice" onClick={onDirect}>
        <span className="qt-choice-ic"><Ic name="edit" size={18} /></span>
        <span><b>Direct quotation</b><small>Enter the client and each insurer&apos;s premium yourself — no RFQ needed</small></span>
        <Ic name="arrowright" size={16} />
      </button>
      <div className="qt-sub">Or from an RFQ that has insurer quotes</div>
      <div className="dt-search" style={{ marginBottom: 10 }}>
        <span className="dt-search-ic"><Ic name="search" size={16} /></span>
        <input placeholder="Search RFQ no or client…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="qt-rfq-list">
        {rfqs === null ? <div className="no-data">Loading…</div> : list.length === 0 ? <div className="no-data">No open RFQ has insurer quotes yet.</div> : list.map((r) => (
          <button key={r.id} type="button" className="qt-rfq" onClick={() => onRfq(r)}>
            <b>{r.rfq_no}</b><span>{r.client_name}</span><small>{r.product || r.category} · {parse(r.insurers, []).filter((i) => Number(i.premium) > 0).length} quote(s)</small>
          </button>
        ))}
      </div>
    </Modal>
  );
}

/* ---------- From an RFQ: pick the options, the recommendation, validity ---------- */
export function FromRfqModal({ rfq, onClose, onDone }) {
  const quoted = parse(rfq.insurers, []).filter((i) => (i.insurer || '').trim() && Number(i.premium) > 0);
  const cheapest = quoted.reduce((a, b) => (!a || Number(b.premium) < Number(a.premium) ? b : a), null);
  const [picked, setPicked] = useState(() => quoted.map((i) => i.insurer));
  const [rec, setRec] = useState((quoted.find((i) => i.selected) || cheapest)?.insurer || '');
  const [valid, setValid] = useState(addDays(istToday(), 7));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = (n) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));
  async function create() {
    if (!picked.length) { toast.error('Choose at least one insurer quote'); return; }
    setBusy(true);
    try {
      const d = await api('/rfqs/' + rfq.id + '/convert', { method: 'POST', body: { insurers: picked, recommended: picked.includes(rec) ? rec : picked[0], valid_till: valid, client_note: note } });
      toast.success(`Quotation ${d.display_no} created`);
      onDone(d.quotationId);
    } catch (e) { toast.error(e.message || 'Could not create the quotation'); setBusy(false); }
  }
  return (
    <Modal open top onClose={onClose} title={`Quotation from ${rfq.rfq_no}`} subtitle={`${rfq.client_name} · ${rfq.product || rfq.category}`} icon="doc" size="md"
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn blue" disabled={busy} onClick={create}><Ic name="doc" size={15} /> Create Quotation</button></>}>
      <div className="qt-sub" style={{ marginTop: 0 }}>Options to show the client — ★ marks our recommendation</div>
      {quoted.length === 0 ? <div className="no-data">No insurer has quoted a premium yet.</div> : quoted.map((i) => (
        <div key={i.insurer} className={'pick-quote-opt' + (picked.includes(i.insurer) ? ' on' : '')}>
          <input type="checkbox" checked={picked.includes(i.insurer)} onChange={() => toggle(i.insurer)} aria-label={'Include ' + i.insurer} />
          <span><b>{i.insurer}</b>{cheapest?.insurer === i.insurer ? <small className="qt-tag cheap">Lowest</small> : null}{i.remark ? <small className="muted"> · {i.remark}</small> : null}</span>
          <span className="qt-pick-right">₹ {inr(i.premium)}
            <button type="button" className={'qt-star' + (rec === i.insurer ? ' on' : '')} title="Recommend this one" onClick={() => { setRec(i.insurer); if (!picked.includes(i.insurer)) toggle(i.insurer); }}>★</button>
          </span>
        </div>
      ))}
      <div className="form-grid two" style={{ marginTop: 14 }}>
        <div className="form-field"><label>Valid till</label><DateField value={valid} onChange={(e) => setValid(e.target.value)} /></div>
        <div className="form-field"><label>Note for the client (optional)</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Includes zero depreciation" /></div>
      </div>
    </Modal>
  );
}

/* ---------- Direct quotation: create, or edit a draft ---------- */
function QuoteEditor({ quote, onClose, onSaved }) {
  const linked = !!quote?.rfq_id;
  const [f, setF] = useState(() => ({
    client_name: quote?.client_name || '', mobile: quote?.mobile || '', email: quote?.email || '', category: quote?.category || 'Motor',
    product: quote?.product || '', policy_type: quote?.policy_type || '', policy_nature: quote?.policy_nature || 'New',
    sum_assured: quote?.sum_assured || '', valid_till: quote?.valid_till || addDays(istToday(), 7), client_note: quote?.client_note || '',
    assigned_to: quote?.assigned_to || '',
  }));
  const [opts, setOpts] = useState(() => (quote?.options?.length ? quote.options.map((o) => ({ ...blankOption(), ...o, addons_incl: Array.isArray(o.addons_incl) ? o.addons_incl.join(', ') : (o.addons_incl || '') })) : [blankOption(), blankOption()]));
  const [companies, setCompanies] = useState([]);
  const [users, setUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api('/masters/companies').then((l) => setCompanies(l.map((c) => c.company_name).filter(Boolean))).catch(() => {});
    api('/users').then((l) => setUsers(l.map((u) => u.full_name || u.username).filter(Boolean))).catch(() => {});
  }, []);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setOpt = (i, k, v) => setOpts((list) => list.map((o, j) => (j === i ? { ...o, [k]: v } : k === 'recommended' && v ? { ...o, recommended: false } : o)));
  async function attach(i, file) {
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) { toast.error('Keep the quote file under 6 MB'); return; }
    setOpt(i, 'quote_doc', await readFile(file)); setOpt(i, 'quote_name', file.name);
  }
  async function save() {
    const options = opts.filter((o) => String(o.insurer).trim() && Number(o.premium) > 0);
    if (!f.client_name.trim()) { toast.error('Client name is required'); return; }
    if (!options.length) { toast.error('Add at least one insurer with a premium'); return; }
    setBusy(true);
    const body = { ...f, product: f.product || f.category, options, recommended: (options.find((o) => o.recommended) || {}).insurer };
    try {
      if (quote?.id) {
        await api('/quotations/' + quote.id, { method: 'PUT', body: linked ? { options, recommended: body.recommended, valid_till: f.valid_till, client_note: f.client_note, assigned_to: f.assigned_to } : body });
        toast.success('Quotation saved'); onSaved(quote.id);
      } else {
        const d = await api('/quotations', { method: 'POST', body });
        toast.success(`Quotation ${d.display_no} created`); onSaved(d.id);
      }
    } catch (e) { toast.error(e.message || 'Could not save'); setBusy(false); }
  }
  const motor = f.category === 'Motor';
  return (
    <Modal page open onClose={onClose} title={quote?.id ? `Edit ${quote.display_no}` : 'Direct quotation'} subtitle={linked ? `From ${quote.rfq?.rfq_no || 'RFQ'} — client details come from the RFQ` : 'A quotation without an RFQ — enter what each insurer quoted'} icon="doc" size="xl"
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn blue" disabled={busy} onClick={save}><Ic name="check" size={15} /> {quote?.id ? 'Save' : 'Create Quotation'}</button></>}>
      <div className="qt-section">Client &amp; cover</div>
      <div className="form-grid">
        <div className="form-field"><label>Client name *</label><input value={f.client_name} disabled={linked} onChange={(e) => set('client_name', e.target.value)} /></div>
        <div className="form-field"><label>Mobile</label><input value={f.mobile} disabled={linked} onChange={(e) => set('mobile', e.target.value)} /></div>
        <div className="form-field"><label>Email</label><input value={f.email} disabled={linked} onChange={(e) => set('email', e.target.value)} /></div>
        <div className="form-field"><label>Category *</label><Select value={f.category} disabled={linked} onChange={(e) => set('category', e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></div>
        <div className="form-field"><label>Product / plan</label><input value={f.product} disabled={linked} placeholder={f.category} onChange={(e) => set('product', e.target.value)} /></div>
        <div className="form-field"><label>New / Renewal</label><Select value={f.policy_nature} disabled={linked} onChange={(e) => set('policy_nature', e.target.value)}>{NATURES.map((c) => <option key={c}>{c}</option>)}</Select></div>
        <div className="form-field"><label>{motor ? 'IDV' : 'Sum insured'}</label><input type="number" value={f.sum_assured} disabled={linked} onChange={(e) => set('sum_assured', e.target.value)} /></div>
        <div className="form-field"><label>Valid till</label><DateField value={f.valid_till} onChange={(e) => set('valid_till', e.target.value)} /></div>
        <div className="form-field"><label>Owner</label>
          {users.length ? <Select value={f.assigned_to} onChange={(e) => set('assigned_to', e.target.value)}><option value="">Me</option>{users.map((u) => <option key={u}>{u}</option>)}</Select>
            : <input value={f.assigned_to} onChange={(e) => set('assigned_to', e.target.value)} placeholder="Me" />}
        </div>
      </div>
      <div className="form-field"><label>Note for the client</label><input value={f.client_note} onChange={(e) => set('client_note', e.target.value)} placeholder="Shown with the comparison" /></div>

      <div className="qt-section" style={{ marginTop: 16 }}>Insurer options <small className="muted">— ★ is our recommendation</small></div>
      <datalist id="qt-insurers">{companies.map((c) => <option key={c} value={c} />)}</datalist>
      <div className="qt-opt-edit">
        {opts.map((o, i) => (
          <div key={i} className="qt-opt-row">
            <button type="button" className={'qt-star' + (o.recommended ? ' on' : '')} title="Recommend" onClick={() => setOpt(i, 'recommended', true)}>★</button>
            <input list="qt-insurers" placeholder="Insurer" value={o.insurer} onChange={(e) => setOpt(i, 'insurer', e.target.value)} className="qt-ins" />
            <input type="number" placeholder="Total premium" value={o.premium} onChange={(e) => setOpt(i, 'premium', e.target.value)} />
            {motor && <input type="number" placeholder="OD" value={o.od_premium} onChange={(e) => setOpt(i, 'od_premium', e.target.value)} />}
            {motor && <input type="number" placeholder="TP" value={o.tp_premium} onChange={(e) => setOpt(i, 'tp_premium', e.target.value)} />}
            <input type="number" placeholder="Add-on premium" value={o.addon_premium} onChange={(e) => setOpt(i, 'addon_premium', e.target.value)} />
            <input type="number" placeholder={motor ? 'IDV' : 'Sum insured'} value={o.idv} onChange={(e) => setOpt(i, 'idv', e.target.value)} />
            <input placeholder="Add-ons / covers included (comma separated)" value={o.addons_incl} onChange={(e) => setOpt(i, 'addons_incl', e.target.value)} className="qt-wide" />
            <input placeholder="Remark" value={o.remark} onChange={(e) => setOpt(i, 'remark', e.target.value)} />
            <span className="qt-opt-tools">
              {o.quote_doc || o.has_doc ? <button type="button" className="btn ghost sm" onClick={() => viewDoc(o.quote_doc)} disabled={!o.quote_doc} title={o.quote_name || 'Quote'}><Ic name="file" size={13} /> Quote</button>
                : <label className="btn ghost sm"><Ic name="upload" size={13} /> Quote PDF<input type="file" accept=".pdf,image/*" hidden onChange={(e) => attach(i, e.target.files?.[0])} /></label>}
              <button type="button" className="action-btn danger" title="Remove" onClick={() => setOpts((l) => l.filter((_, j) => j !== i))}><Ic name="trash" size={14} /></button>
            </span>
          </div>
        ))}
        <button type="button" className="btn ghost sm" onClick={() => setOpts((l) => [...l, blankOption()])}><Ic name="plus" size={14} /> Add insurer</button>
      </div>
    </Modal>
  );
}

/* ---------- One quotation ---------- */
export function QuoteDetail({ id, onClose, onChanged, onSwitch, onEdit }) {
  const navigate = useNavigate();
  const [q, setQ] = useState(null);
  const [busy, setBusy] = useState(false);
  const [approve, setApprove] = useState(null);     // { insurer, by }
  const [reject, setReject] = useState(null);       // { reason, note }
  const [share, setShare] = useState(null);         // { email, wa, msg }
  const [extend, setExtend] = useState(null);
  const load = () => api('/quotations/' + id).then(setQ).catch((e) => { toast.error(e.message || 'Could not open the quotation'); onClose(); });
  useEffect(() => { setQ(null); load(); }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useRealtime('quotation', (e) => { if (Number(e?.data?.id) === Number(id)) load(); });
  if (!q) return <Modal page open onClose={onClose} title="Quotation" size="xl"><div className="spinner">Loading…</div></Modal>;

  const opts = q.options || [];
  const cheapest = opts.reduce((a, b) => (!a || Number(b.premium) < Number(a.premium) ? b : a), null);
  const won = opts.find((o) => o.approved);
  const rec = opts.find((o) => o.recommended) || cheapest;
  const after = () => { load(); onChanged?.(); };
  const run = async (fn, ok) => { setBusy(true); try { await fn(); if (ok) toast.success(ok); after(); } catch (e) { toast.error(e.message || 'Something went wrong'); } finally { setBusy(false); } };

  const doc = docOf(q);
  const pdfName = `${comparisonDocName(doc)} - ${q.display_no}`;
  async function doShare() {
    const s = share; setShare(null);
    setBusy(true);
    let pdf = null;
    try { pdf = await htmlToPdfBase64(pdfName, buildCompareDoc(doc)); } catch { /* still try without */ }
    const sent = [], failed = [];
    if (s.wa && q.mobile) { try { await sendWhatsApp(q.mobile, s.msg, pdf, `${pdfName}.pdf`); sent.push('WhatsApp'); } catch (e) { failed.push(`WhatsApp (${e.message || 'failed'})`); } }
    if (s.email && q.email) {
      try {
        const files = [...(pdf ? [{ filename: `${pdfName}.pdf`, uri: pdf }] : []), ...quoteAttachments(doc)];
        const size = attachmentsBytes(files);
        const trimmed = size > ATTACHMENT_LIMIT_BYTES ? files.slice(0, 1) : files;
        await sendEmailWith(q.email, `Insurance quotation ${q.display_no} — ${q.product || q.category}`, s.msg, trimmed, { rfqId: q.rfq_id || undefined, quotationId: q.id });
        sent.push('Email');
        if (trimmed.length < files.length) toast.info(`Insurer quotes came to ${mb(size)} MB, too large to attach — sent the comparison only.`);
      } catch (e) { failed.push(`Email (${e.message || 'failed'})`); }
    }
    if (sent.length) {
      try { await api(`/quotations/${q.id}/shared`, { method: 'POST', body: { via: sent } }); } catch { /* the send happened */ }
      toast.success(`${q.display_no} sent via ${sent.join(' & ')}`);
    }
    if (failed.length) toast.error(`Could not send via ${failed.join(', ')}`);
    setBusy(false); after();
  }
  function openShare() {
    if (!q.email && !q.mobile) { toast.error('Add the client\'s email or mobile first'); return; }
    const best = rec ? `Our recommendation: ${rec.insurer} at ₹${inr(rec.premium)}.` : '';
    setShare({ email: !!q.email, wa: !!q.mobile, msg: `Dear ${q.client_name},\n\nPlease find our quotation ${q.display_no} for your ${q.product || q.category} insurance, comparing ${opts.length} option${opts.length === 1 ? '' : 's'}. ${best}${q.client_note ? '\n\n' + q.client_note : ''}\n\nThe quotation is valid till ${dmy(q.valid_till)}. Reply to let us know which option you would like to go ahead with.` });
  }
  async function toPolicy() {
    if (q.policy_id) { navigate('/page/policy?open=' + q.policy_id); return; }
    const ok = await confirm({ title: 'Convert to policy?', icon: 'file', confirmText: 'Convert to Policy',
      message: `A policy will be created for ${q.client_name} with ${won.insurer} at ₹${inr(won.premium)}${q.rfq ? `, carrying over everything on ${q.rfq.rfq_no}` : ''}. You can then add the policy number and dates.` });
    if (!ok) return;
    setBusy(true);
    try {
      const d = await api(`/quotations/${q.id}/to-policy`, { method: 'POST' });
      toast.success(`Policy created from ${q.display_no}`);
      if (!d.clientLinked) toast.info('No matching client was found — choose the policy holder on the policy');
      if (!d.datesFilled) toast.info('Add the policy number and dates from the insurer, then set it to Issued');
      onChanged?.(); onClose();
      navigate('/page/policy?open=' + d.policyId);
    } catch (e) { toast.error(e.message || 'Could not create the policy'); setBusy(false); }
  }
  async function revise(refresh) {
    const ok = await confirm({ title: `Revise ${q.display_no}?`, icon: 'refresh', confirmText: 'Create new version',
      message: refresh ? 'A new version is made with the insurers\' current rates from the RFQ. This version is kept as history.' : 'A new draft version is made from this one for you to change. This version is kept as history.' });
    if (!ok) return;
    setBusy(true);
    try { const d = await api(`/quotations/${q.id}/revise`, { method: 'POST', body: { refresh: refresh ? 'all' : false } }); toast.success(`${d.display_no} created`); onChanged?.(); onSwitch?.(d.id); }
    catch (e) { toast.error(e.message || 'Could not revise'); } finally { setBusy(false); }
  }
  async function doReject() {
    const r = reject; const reason = r.reason === 'Other' ? (r.note || '').trim() : [r.reason, (r.note || '').trim()].filter(Boolean).join(' — ');
    if (!reason) { toast.error('Give the reason'); return; }
    setReject(null);
    setBusy(true);
    try {
      await api(`/quotations/${q.id}/reject`, { method: 'POST', body: { reason } });
      toast.success(`${q.display_no} marked rejected`);
      if (q.rfq && !['Lost', 'Closed'].includes(q.rfq.status)) {
        const lose = await confirm({ title: `Mark ${q.rfq.rfq_no} Lost as well?`, message: `The RFQ will be closed as lost with the same reason: “${reason}”.`, confirmText: 'Mark RFQ Lost', cancelText: 'Keep RFQ open', tone: 'danger', icon: 'alert' });
        if (lose) await api('/rfqs/' + q.rfq.id, { method: 'PUT', body: { status: 'Lost', not_approved_reason: reason } });
      }
    } catch (e) { toast.error(e.message || 'Could not update'); }
    setBusy(false); after();
  }
  async function del() {
    const ok = await confirm({ title: `Delete ${q.display_no}?`, message: q.version > 1 ? 'The previous version comes back into play.' : 'The quotation will be removed.', tone: 'danger', confirmText: 'Delete', icon: 'trash' });
    if (!ok) return;
    try { await api('/quotations/' + q.id, { method: 'DELETE' }); toast.success('Quotation deleted'); onChanged?.(); onClose(); } catch (e) { toast.error(e.message || 'Could not delete'); }
  }

  const s = q.status;
  const open = ['Draft', 'Shared', 'Expired'].includes(s);
  const newest = (q.versions || [])[q.versions.length - 1];
  const footer = (
    <div className="qt-actions">
      <HistoryButton table="quotations" id={q.id} />
      {q.mobile && <WhatsAppButton mobile={q.mobile} messages={[{ label: 'Quotation follow-up', text: `Dear ${q.client_name}, following up on our quotation ${q.display_no} for your ${q.product || q.category}. Please let us know which option you would like to go ahead with.` }]} />}
      <button className="btn ghost" onClick={() => printHTML(pdfName, buildCompareDoc(doc))}><Ic name="file-export" size={15} /> PDF</button>
      <span style={{ flex: 1 }} />
      {s === 'Draft' && <button className="btn ghost danger" onClick={del} disabled={busy}><Ic name="trash" size={15} /> Delete</button>}
      {s === 'Draft' && <button className="btn ghost" onClick={() => onEdit(q)} disabled={busy}><Ic name="edit" size={15} /> Edit</button>}
      {['Shared', 'Expired', 'Approved', 'Rejected'].includes(s) && <button className="btn ghost" onClick={() => revise(false)} disabled={busy}><Ic name="refresh" size={15} /> Revise</button>}
      {['Shared', 'Expired'].includes(s) && <button className="btn ghost" onClick={() => setExtend(q.valid_till && q.valid_till >= istToday() ? addDays(q.valid_till, 7) : addDays(istToday(), 7))} disabled={busy}><Ic name="calendar" size={15} /> Extend</button>}
      {['Rejected', 'Expired'].includes(s) && s === 'Rejected' && <button className="btn ghost" onClick={() => run(() => api(`/quotations/${q.id}/reopen`, { method: 'POST' }), 'Quotation reopened')} disabled={busy}><Ic name="refresh" size={15} /> Reopen</button>}
      {open && <button className="btn ghost danger" onClick={() => setReject({ reason: REJECT_REASONS[0], note: '' })} disabled={busy}><Ic name="x" size={15} /> Rejected</button>}
      {open && <button className="btn ghost" onClick={() => setApprove({ insurer: (rec || opts[0])?.insurer || '', by: q.client_name })} disabled={busy}><Ic name="check" size={15} /> Client approved</button>}
      {['Draft', 'Shared', 'Expired'].includes(s) && <button className={'btn ' + (s === 'Draft' ? 'blue' : 'ghost')} onClick={openShare} disabled={busy}><Ic name="send" size={15} /> {s === 'Draft' ? 'Share with client' : 'Share again'}</button>}
      {s === 'Approved' && <button className="btn ghost" onClick={() => setApprove({ insurer: won?.insurer || '', by: q.client_name })} disabled={busy}><Ic name="edit" size={15} /> Change choice</button>}
      {s === 'Approved' && <button className="btn blue" onClick={toPolicy} disabled={busy}><Ic name="file" size={15} /> Convert to Policy</button>}
      {s === 'Converted' && q.policy_id && <button className="btn blue" onClick={toPolicy}><Ic name="file" size={15} /> Open Policy</button>}
      {s === 'Superseded' && newest && newest.id !== q.id && <button className="btn blue" onClick={() => onSwitch?.(newest.id)}>Open {newest.display_no}</button>}
    </div>
  );

  return (
    <Modal page open onClose={onClose} title={`${q.display_no} — ${q.client_name}`} subtitle={`${q.product || q.category}${q.policy_nature ? ' · ' + q.policy_nature : ''} · valid till ${dmy(q.valid_till)}`} icon="doc" size="xl" footer={footer}>
      {/* The journey this quotation sits in */}
      <div className="qt-journey">
        {q.lead && <><button type="button" className="qt-step done" onClick={() => navigate('/page/lead?open=' + q.lead.id)}><small>Lead</small>{q.lead.lead_name}</button><span className="qt-arrow">›</span></>}
        {q.rfq ? <button type="button" className="qt-step done" onClick={() => navigate('/page/rfq?open=' + q.rfq.id)}><small>RFQ</small>{q.rfq.rfq_no}</button>
          : <span className="qt-step muted"><small>RFQ</small>Direct quotation</span>}
        <span className="qt-arrow">›</span>
        <span className="qt-step cur"><small>Quotation</small>{q.display_no} <span className={'badge ' + (QUOTE_BADGE[s] || '')}>{s}</span></span>
        <span className="qt-arrow">›</span>
        {q.policy ? <button type="button" className="qt-step done" onClick={() => navigate('/page/policy?open=' + q.policy.id)}><small>Policy</small>{q.policy.policy_number || q.policy.policy_status || 'Created'}</button>
          : <span className="qt-step muted"><small>Policy</small>Not yet</span>}
      </div>

      {q.stale && (
        <div className="qt-banner">
          <Ic name="alert" size={16} />
          <span>Newer insurer rates on {q.rfq?.rfq_no}: {[q.stale.changed.length ? `${q.stale.changed.map(shortIns).join(', ')} changed` : '', q.stale.added.length ? `${q.stale.added.map(shortIns).join(', ')} quoted since` : ''].filter(Boolean).join('; ')}.</span>
          {s === 'Draft' ? <button className="btn sm" onClick={() => revise(true)}>Rebuild with current rates</button> : <button className="btn sm" onClick={() => revise(true)}>Revise with current rates</button>}
        </div>
      )}
      {s === 'Rejected' && q.reject_reason && <div className="qt-banner red"><Ic name="x" size={16} /><span>Client said no: {q.reject_reason}</span></div>}
      {s === 'Expired' && <div className="qt-banner"><Ic name="clock" size={16} /><span>Valid till {dmy(q.valid_till)} passed without a decision — extend it, revise it, or record the client&apos;s answer.</span></div>}

      <div className="qt-facts">
        <span><small>Client</small>{q.client_name}</span>
        <span><small>Mobile</small>{q.mobile || '—'}</span>
        <span><small>Email</small>{q.email || '—'}</span>
        <span><small>{q.category === 'Motor' ? 'IDV' : 'Sum insured'}</small>{Number(q.sum_assured) ? '₹ ' + inr(q.sum_assured) : '—'}</span>
        <span><small>Owner</small>{q.assigned_to || '—'}</span>
        <span><small>Shared</small>{q.shared_at ? `${dmy(q.shared_at)} · ${q.shared_via || ''}` : 'Not yet'}</span>
        {q.decided_at && <span><small>Decided</small>{dmy(q.decided_at)}</span>}
      </div>

      <div className="qt-opts">
        {opts.map((o) => {
          const addons = Array.isArray(o.addons_incl) ? o.addons_incl : [];
          return (
            <div key={o.insurer} className={'qt-opt' + (o.approved ? ' won' : o.recommended ? ' rec' : '')}>
              <div className="qt-opt-tags">
                {o.approved && <span className="qt-tag won">Client chose</span>}
                {o.recommended && <span className="qt-tag rec">Recommended</span>}
                {cheapest && cheapest.insurer === o.insurer && <span className="qt-tag cheap">Lowest</span>}
              </div>
              <div className="qt-opt-ins" title={o.insurer}>{shortIns(o.insurer)}</div>
              <div className="qt-opt-prem">₹ {inr(o.premium)}</div>
              <div className="qt-opt-lines">
                {Number(o.od_premium) > 0 && <span>OD ₹{inr(o.od_premium)}</span>}
                {Number(o.tp_premium) > 0 && <span>TP ₹{inr(o.tp_premium)}</span>}
                {Number(o.addon_premium) > 0 && <span>Add-ons ₹{inr(o.addon_premium)}</span>}
                {Number(o.wc_basic) > 0 && <span>Basic ₹{inr(o.wc_basic)}</span>}
                {o.wc_rate ? <span>Rate {o.wc_rate}</span> : null}
                {Number(o.idv) > 0 && <span>{q.category === 'Motor' ? 'IDV' : 'SI'} ₹{inr(o.idv)}</span>}
                {o.ncb ? <span>NCB {String(o.ncb).replace('%', '')}%</span> : null}
              </div>
              {addons.length > 0 && <div className="qt-chips">{addons.slice(0, 8).map((a) => <span key={a}>{a}</span>)}{addons.length > 8 && <span>+{addons.length - 8}</span>}</div>}
              {o.remark && <div className="qt-opt-remark">{o.remark}</div>}
              {o.quote_doc && <button type="button" className="btn ghost sm" onClick={() => viewDoc(o.quote_doc)}><Ic name="file" size={13} /> Insurer&apos;s quote</button>}
            </div>
          );
        })}
      </div>
      {q.client_note && <div className="qt-note"><small>Note for the client</small>{q.client_note}</div>}

      {(q.versions || []).length > 1 && (
        <div className="qt-versions">
          <small>Versions</small>
          {q.versions.map((v) => (
            <button key={v.id} type="button" className={'qt-ver' + (v.id === q.id ? ' on' : '')} onClick={() => onSwitch?.(v.id)}>
              {v.display_no} <span className={'badge ' + (QUOTE_BADGE[v.status] || '')}>{v.status}</span>{Number(v.selected_premium) ? <em>₹{inr(v.selected_premium)}</em> : null}
            </button>
          ))}
        </div>
      )}

      {approve && (
        <Modal open top onClose={() => setApprove(null)} title="Which option did the client approve?" subtitle="Recorded as the client's choice; the RFQ is updated and the confirmation mail goes out" icon="checksquare" size="sm"
          footer={<><button className="btn ghost" onClick={() => setApprove(null)}>Cancel</button><button className="btn blue" disabled={!approve.insurer || busy} onClick={() => { const a = approve; setApprove(null); run(() => api(`/quotations/${q.id}/approve`, { method: 'POST', body: { insurer: a.insurer, approved_by: a.by } }), 'Marked approved'); }}><Ic name="check" size={15} /> Approved</button></>}>
          {opts.map((o) => (
            <label key={o.insurer} className={'pick-quote-opt' + (approve.insurer === o.insurer ? ' on' : '')}>
              <input type="radio" name="qt-approve" checked={approve.insurer === o.insurer} onChange={() => setApprove((a) => ({ ...a, insurer: o.insurer }))} />
              <span><b>{o.insurer}</b>{o.recommended ? <small className="qt-tag rec">Recommended</small> : null}</span>
              <span>₹ {inr(o.premium)}</span>
            </label>
          ))}
          <div className="form-field" style={{ marginTop: 12 }}><label>Approved by</label><input value={approve.by} onChange={(e) => setApprove((a) => ({ ...a, by: e.target.value }))} /></div>
        </Modal>
      )}
      {reject && (
        <Modal open top onClose={() => setReject(null)} title="Client said no" subtitle="The reason feeds the Lost Business and Quotation reports" icon="alert" size="sm"
          footer={<><button className="btn ghost" onClick={() => setReject(null)}>Cancel</button><button className="btn red" onClick={doReject}>Mark rejected</button></>}>
          <div className="form-field"><label>Reason</label><Select value={reject.reason} onChange={(e) => setReject((r) => ({ ...r, reason: e.target.value }))}>{REJECT_REASONS.map((r) => <option key={r}>{r}</option>)}</Select></div>
          <div className="form-field"><label>{reject.reason === 'Other' ? 'Reason *' : 'Details (optional)'}</label><input value={reject.note} onChange={(e) => setReject((r) => ({ ...r, note: e.target.value }))} /></div>
        </Modal>
      )}
      {share && (
        <Modal open top onClose={() => setShare(null)} title={`Share ${q.display_no}`} subtitle="The comparison PDF goes with it, plus each insurer's own quote by email" icon="send" size="md"
          footer={<><button className="btn ghost" onClick={() => { setShare(null); run(() => api(`/quotations/${q.id}/shared`, { method: 'POST', body: { via: ['In person / other'] } }), 'Marked as shared'); }}>Mark shared without sending</button><button className="btn blue" disabled={!share.email && !share.wa} onClick={doShare}><Ic name="send" size={15} /> Send</button></>}>
          <div className="qt-channels">
            <label><input type="checkbox" checked={share.email} disabled={!q.email} onChange={(e) => setShare((x) => ({ ...x, email: e.target.checked }))} /> Email {q.email ? `(${q.email})` : '— no email on file'}</label>
            <label><input type="checkbox" checked={share.wa} disabled={!q.mobile} onChange={(e) => setShare((x) => ({ ...x, wa: e.target.checked }))} /> WhatsApp {q.mobile ? `(${q.mobile})` : '— no mobile on file'}</label>
          </div>
          <div className="form-field"><label>Message</label><textarea rows={7} value={share.msg} onChange={(e) => setShare((x) => ({ ...x, msg: e.target.value }))} /></div>
        </Modal>
      )}
      {extend && (
        <Modal open top onClose={() => setExtend(null)} title="Extend validity" icon="calendar" size="sm"
          footer={<><button className="btn ghost" onClick={() => setExtend(null)}>Cancel</button><button className="btn blue" onClick={() => { const v = extend; setExtend(null); run(() => api('/quotations/' + q.id, { method: 'PUT', body: { valid_till: v } }), 'Validity extended'); }}>Save</button></>}>
          <div className="form-field"><label>Valid till</label><DateField value={extend} onChange={(e) => setExtend(e.target.value)} /></div>
        </Modal>
      )}
    </Modal>
  );
}

/* ---------- On the RFQ: its quotations ---------- */
export function RfqQuotations({ rfq, onCreate }) {
  const navigate = useNavigate();
  const [list, setList] = useState(null);
  const load = () => api('/quotations?rfq_id=' + rfq.id).then(setList).catch(() => setList([]));
  useEffect(() => { load(); }, [rfq.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useRealtime('quotation', () => load());
  if (!list) return null;
  return (
    <div className="qt-rfq-box">
      <div className="qt-rfq-head">
        <b><Ic name="doc" size={15} /> Quotations to the client</b>
        <button type="button" className="btn ghost sm" onClick={onCreate}><Ic name="plus" size={13} /> {list.some((x) => x.status !== 'Superseded') ? 'New version' : 'Create Quotation'}</button>
      </div>
      {list.length === 0 ? <div className="muted" style={{ fontSize: 12.5 }}>None yet — once insurers have quoted, create the quotation that goes to the client.</div> : (
        <div className="qt-rfq-rows">
          {list.map((x) => (
            <button key={x.id} type="button" className={'qt-rfq-row' + (x.status === 'Superseded' ? ' old' : '')} onClick={() => navigate('/page/quotation?open=' + x.id)}>
              <b>{x.display_no}</b>
              <span className={'badge ' + (QUOTE_BADGE[x.status] || '')}>{x.status}</span>
              <span>{x.approved_insurer ? `Client chose ${shortIns(x.approved_insurer)}` : x.selected_insurer ? `Recommended ${shortIns(x.selected_insurer)}` : ''}</span>
              <span className="muted">{x.status === 'Shared' ? `valid till ${dmy(x.valid_till)}` : x.shared_at ? `shared ${dmy(x.shared_at)}` : ''}</span>
              <Ic name="arrowright" size={14} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
