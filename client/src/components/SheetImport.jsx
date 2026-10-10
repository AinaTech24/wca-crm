import { useState, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import Modal from './Modal.jsx';
import SearchSelect from './SearchSelect.jsx';
import { Ic } from './Icons.jsx';
import toast from './toast.js';
import { api } from '../api.js';

// Bulk import from a spreadsheet: pick a sheet, confirm how its columns line
// up with the module's fields, look at what will be written, then import.
//
// Shared by the claim and client importers — the only differences between them
// are the field list, the endpoint, and how a row becomes a record, so those
// are props rather than a second copy of this file.
//
// Nothing is ever compulsory. Every field is listed on the mapping screen
// whether the sheet has a column for it or not, because these sheets come from
// other systems and are rarely complete.
// Offered as the first option so a mapped field can be unset again.
const NOT_IMPORTED = 'Not imported';

export default function SheetImport({
  open, onClose, onDone,
  title = 'Import', noun = 'record',
  fields, guess, toRecord, endpoint, duplicateOption,
}) {
  const [step, setStep] = useState(1);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(null);   // { done, total } while importing
  const [reading, setReading] = useState(false);    // parsing the file, which can take several seconds
  const [result, setResult] = useState(null);
  // Only some importers have a record that can already exist (a policy number).
  const [dupMode, setDupMode] = useState(duplicateOption?.def || '');
  const fileRef = useRef(null);

  function reset() {
    setStep(1); setFileName(''); setHeaders([]); setRows([]);
    setMapping({}); setImporting(false); setResult(null);
  }
  function close() { reset(); onClose?.(); }

  function onFile(ev) {
    const file = ev.target.files?.[0];
    if (!file) return;
    setReading(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      // XLSX.read is synchronous: on a large sheet it takes several seconds
      // (about 6s for 60,000 rows) with the page frozen. Yielding once lets
      // the "Reading..." message paint first, so it doesn't look like a hang.
      setTimeout(() => {
      try {
        // cellDates gives real Dates for date-typed cells, which beats
        // re-deriving them from Excel's serial numbers.
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        if (!sheet) { toast.error('That workbook has no sheets'); return; }
        // raw: true keeps a cell's underlying value — a mobile stays a full
        // precision number instead of arriving as the "9.6E+09" the sheet
        // happens to display, which cannot be turned back into a phone number.
        // Dates still come through as Date objects because of cellDates, and
        // every coercion below already handles numbers, Dates and strings.
        const data = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
        if (!data.length) { toast.error('The first sheet has no rows'); return; }
        const hdrs = Object.keys(data[0]).filter((h) => String(h).trim());
        setFileName(file.name);
        setHeaders(hdrs);
        setRows(data);
        setMapping(guess(hdrs));
        setStep(2);
      } catch (err) {
        toast.error(err.message || 'Could not read that file');
      } finally {
        setReading(false);
      }
      }, 30);
    };
    reader.onerror = () => { setReading(false); toast.error('Could not read that file'); };
    reader.readAsArrayBuffer(file);
  }

  // Turning every row into a record is cheap per row but not free over tens of
  // thousands (about half a second at 60,000), and the mapping step changes the
  // mapping on every dropdown. It is only needed for the preview and the
  // import, so it is not computed until then.
  const mapped = useMemo(() => (step >= 3 ? rows.map((r) => toRecord(r, mapping)) : []), [rows, mapping, toRecord, step]);
  const mappedCount = Object.values(mapping).filter(Boolean).length;
  // A row matching no mapped column would import as an empty record, so it is
  // dropped and counted rather than written.
  const usable = useMemo(() => mapped.filter((m) => Object.keys(m).length > 0), [mapped]);
  const unmappedHeaders = headers.filter((h) => !Object.values(mapping).includes(h));
  const shown = fields.filter((f) => mapping[f.key] && f.key !== 'first_name' && f.key !== 'last_name');

  // Sent in batches rather than as one request. Six thousand rows is several
  // megabytes of JSON, which the proxy in front of the API rejected outright —
  // and its rejection is an HTML page, so the client could only report a bare
  // "Request failed" with nothing to act on. Batching keeps every request well
  // inside any limit, lets the user watch it move, and means a failure costs
  // one batch rather than the whole file.
  const BATCH = 300;

  async function runImport() {
    if (!usable.length) { toast.error('Nothing to import — map at least one column'); return; }
    setImporting(true);
    setProgress({ done: 0, total: usable.length });
    const all = { inserted: 0, updated: 0, failed: [] };
    try {
      for (let i = 0; i < usable.length; i += BATCH) {
        const slice = usable.slice(i, i + BATCH);
        try {
          const isLast = i + BATCH >= usable.length;
          const r = await api(endpoint, { method: 'POST', body: { rows: slice, last: isLast, previously_inserted: all.inserted, ...(duplicateOption ? { on_duplicate: dupMode } : {}) } });
          all.inserted += r.inserted || 0;
          all.updated += r.updated || 0;
          // Row numbers come back relative to the batch, so shift them to the
          // sheet's own numbering — otherwise every batch reports "row 2".
          for (const f of r.failed || []) all.failed.push({ ...f, row: f.row + i });
        } catch (e) {
          // One batch failing is recorded against its rows rather than
          // abandoning everything after it.
          all.failed.push({ row: i + 2, error: `${e.message || 'Request failed'} (rows ${i + 2}–${i + slice.length + 1})` });
        }
        setProgress({ done: Math.min(i + BATCH, usable.length), total: usable.length });
      }
      setResult(all);
      setStep(4);
      if (all.inserted || all.updated) {
        toast.success([all.inserted && `${all.inserted} ${noun}${all.inserted > 1 ? 's' : ''} imported`, all.updated && `${all.updated} updated`].filter(Boolean).join(', '));
        onDone?.();
      }
      if (all.failed.length) toast.error(`${all.failed.length} row(s) could not be imported`);
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }

  const footer = step === 2 ? (
    <>
      <button className="btn ghost" onClick={() => setStep(1)}>Back</button>
      <button className="btn blue" onClick={() => setStep(3)} disabled={!mappedCount}>Preview</button>
    </>
  ) : step === 3 ? (
    <>
      <button className="btn ghost" onClick={() => setStep(2)}>Back to mapping</button>
      <button className="btn blue" onClick={runImport} disabled={importing}>{importing ? (progress ? `Importing ${progress.done} of ${progress.total}…` : 'Importing…') : `Import ${usable.length} ${noun}${usable.length === 1 ? '' : 's'}`}</button>
    </>
  ) : (
    <button className="btn ghost" onClick={close}>Close</button>
  );

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      subtitle={fileName ? `${fileName} · ${rows.length} row${rows.length === 1 ? '' : 's'}` : 'From an Excel or CSV file'}
      icon="upload"
      size="lg"
      footer={footer}
    >
      {step === 1 && (
        <div className="imp-drop">
          <Ic name="upload" size={30} />
          <h3>Choose a spreadsheet</h3>
          <p>Excel (.xlsx, .xls) or CSV. The first sheet is used, and its first row is treated as the column headings.</p>
          <button className="btn blue" onClick={() => fileRef.current?.click()} disabled={reading}>
            <Ic name="file" size={15} /> {reading ? 'Reading file…' : 'Choose file'}
          </button>
          {reading && <p className="imp-note">Large files take a few seconds to read — 60,000 rows is about six. The page may pause briefly.</p>}
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={onFile} />
          <p className="imp-note">Nothing is compulsory, and there is no limit on rows — large files are sent in batches.</p>
        </div>
      )}

      {step === 2 && (
        <>
          <div className="imp-bar">
            <div className="imp-bar-top">
              <span><b>{mappedCount}</b> of {fields.length} fields mapped · {headers.length} columns in the file</span>
              <span className="imp-bar-actions">
                <button type="button" className="btn ghost sm" onClick={() => setMapping(guess(headers))}><Ic name="refresh" size={13} /> Auto map</button>
                <button type="button" className="btn ghost sm" onClick={() => setMapping({})}>Clear all</button>
              </span>
            </div>
            <span className="imp-sub">Matched on column name where possible — change anything that looks wrong. Leave a field as “Not imported” to skip it.</span>
          </div>
          <div className="imp-map">
            {fields.map((f) => (
              <div className={'imp-row' + (mapping[f.key] ? ' on' : '')} key={f.key}>
                <span className="imp-field">{f.label}<small>{f.type}</small></span>
                <SearchSelect
                  value={mapping[f.key] || ''}
                  onChange={(v) => setMapping((m) => ({ ...m, [f.key]: v === NOT_IMPORTED ? '' : v }))}
                  options={[NOT_IMPORTED, ...headers]}
                  placeholder={NOT_IMPORTED}
                />
              </div>
            ))}
          </div>
          {unmappedHeaders.length > 0 && (
            <div className="hint-line">Columns in the file with nowhere to go: {unmappedHeaders.join(', ')}</div>
          )}
        </>
      )}

      {step === 3 && (
        <>
          <div className="imp-bar">
            <span><b>{usable.length}</b> row{usable.length === 1 ? '' : 's'} will be imported</span>
            {mapped.length !== usable.length && (
              <span className="imp-sub">{mapped.length - usable.length} row(s) matched no mapped column and will be skipped.</span>
            )}
          </div>
          {duplicateOption && (
            <div className="imp-dup">
              <span>{duplicateOption.label}</span>
              {duplicateOption.choices.map((c) => (
                <label key={c.v}><input type="radio" name="dupmode" checked={dupMode === c.v} onChange={() => setDupMode(c.v)} /> {c.label}</label>
              ))}
            </div>
          )}
          <div className="imp-preview">
            <table>
              <thead><tr>{shown.map((f) => <th key={f.key}>{f.label}</th>)}</tr></thead>
              <tbody>
                {usable.slice(0, 20).map((m, i) => (
                  <tr key={i}>{shown.map((f) => <td key={f.key}>{m[f.key] === '' || m[f.key] === undefined ? '—' : String(m[f.key])}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          {usable.length > 20 && <div className="hint-line">Showing the first 20 of {usable.length}.</div>}
        </>
      )}

      {step === 4 && result && (
        <div className="imp-done">
          <div className="imp-stat ok"><b>{result.inserted}</b> imported</div>
          {result.updated > 0 && <div className="imp-stat ok"><b>{result.updated}</b> updated</div>}
          {result.failed?.length > 0 && <div className="imp-stat bad"><b>{result.failed.length}</b> failed</div>}
          {result.failed?.length > 0 && (
            <div className="imp-fail">
              {result.failed.slice(0, 10).map((f, i) => <div key={i}>Row {f.row}: {f.error}</div>)}
              {result.failed.length > 10 && <div>…and {result.failed.length - 10} more.</div>}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
