import { useState, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import Modal from './Modal.jsx';
import Select from './Select.jsx';
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
export default function SheetImport({
  open, onClose, onDone,
  title = 'Import', noun = 'record',
  fields, guess, toRecord, endpoint,
}) {
  const [step, setStep] = useState(1);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  function reset() {
    setStep(1); setFileName(''); setHeaders([]); setRows([]);
    setMapping({}); setImporting(false); setResult(null);
  }
  function close() { reset(); onClose?.(); }

  function onFile(ev) {
    const file = ev.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        // cellDates gives real Dates for date-typed cells, which beats
        // re-deriving them from Excel's serial numbers.
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        if (!sheet) { toast.error('That workbook has no sheets'); return; }
        const data = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
        if (!data.length) { toast.error('The first sheet has no rows'); return; }
        const hdrs = Object.keys(data[0]).filter((h) => String(h).trim());
        setFileName(file.name);
        setHeaders(hdrs);
        setRows(data);
        setMapping(guess(hdrs));
        setStep(2);
      } catch (err) {
        toast.error(err.message || 'Could not read that file');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  const mapped = useMemo(() => rows.map((r) => toRecord(r, mapping)), [rows, mapping, toRecord]);
  const mappedCount = Object.values(mapping).filter(Boolean).length;
  // A row matching no mapped column would import as an empty record, so it is
  // dropped and counted rather than written.
  const usable = useMemo(() => mapped.filter((m) => Object.keys(m).length > 0), [mapped]);
  const unmappedHeaders = headers.filter((h) => !Object.values(mapping).includes(h));
  const shown = fields.filter((f) => mapping[f.key] && f.key !== 'first_name' && f.key !== 'last_name');

  async function runImport() {
    if (!usable.length) { toast.error('Nothing to import — map at least one column'); return; }
    setImporting(true);
    try {
      const r = await api(endpoint, { method: 'POST', body: { rows: usable } });
      setResult(r);
      setStep(4);
      if (r.inserted) { toast.success(`${r.inserted} ${noun}${r.inserted > 1 ? 's' : ''} imported`); onDone?.(); }
      if (r.failed?.length) toast.error(`${r.failed.length} row(s) could not be imported`);
    } catch (e) {
      toast.error(e.message || 'Import failed');
    } finally { setImporting(false); }
  }

  const footer = step === 2 ? (
    <>
      <button className="btn ghost" onClick={() => setStep(1)}>Back</button>
      <button className="btn blue" onClick={() => setStep(3)} disabled={!mappedCount}>Preview {usable.length} row{usable.length === 1 ? '' : 's'}</button>
    </>
  ) : step === 3 ? (
    <>
      <button className="btn ghost" onClick={() => setStep(2)}>Back to mapping</button>
      <button className="btn blue" onClick={runImport} disabled={importing}>{importing ? 'Importing…' : `Import ${usable.length} ${noun}${usable.length === 1 ? '' : 's'}`}</button>
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
          <button className="btn blue" onClick={() => fileRef.current?.click()}><Ic name="file" size={15} /> Choose file</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={onFile} />
          <p className="imp-note">Nothing is compulsory — import whichever columns your sheet happens to have.</p>
        </div>
      )}

      {step === 2 && (
        <>
          <div className="imp-bar">
            <span><b>{mappedCount}</b> of {fields.length} fields mapped</span>
            <span className="imp-sub">Matched on column name where possible — change anything that looks wrong. Leave a field as “Not imported” to skip it.</span>
          </div>
          <div className="imp-map">
            {fields.map((f) => (
              <div className={'imp-row' + (mapping[f.key] ? ' on' : '')} key={f.key}>
                <span className="imp-field">{f.label}<small>{f.type}</small></span>
                <Select value={mapping[f.key] || ''} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}>
                  <option value="">Not imported</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </Select>
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
