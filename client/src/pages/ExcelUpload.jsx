import { useState } from 'react';
import toast from '../components/toast.js';
import PageHeader from '../components/PageHeader.jsx';
import { Ic } from '../components/Icons.jsx';

// Bulk data import screen (Excel Upload / LD Excel Upload).
export default function ExcelUpload({ title, kind }) {
  const [file, setFile] = useState(null);

  function onFile(e) {
    const f = e.target.files?.[0];
    setFile(f || null);
  }
  function upload() {
    if (!file) { toast.error('Please choose a file first.'); return; }
    toast.success(`"${file.name}" queued for import (demo — parsing/validation runs server-side in production).`);
  }

  const template = kind === 'ld'
    ? ['Policy No', 'Client Name', 'Company', 'Plan', 'Sum Assured', 'Premium', 'FUP Date', 'Mode']
    : ['Policy No', 'Insured Name', 'Company', 'Product', 'Type', 'Sum Assured', 'Net Premium', 'GST', 'Period From', 'Period To'];

  return (
    <div>
      <PageHeader title={title} subtitle="Import records in bulk from a spreadsheet" />

      <div className="card card-pad" style={{ marginBottom: 22 }}>
        <div className="section-head">Upload File</div>
        <div style={{ border: '2px dashed var(--border-strong)', borderRadius: 'var(--r)', padding: 34, textAlign: 'center', background: 'var(--surface-2)' }}>
          <div style={{ color: 'var(--primary)', marginBottom: 12, display: 'flex', justifyContent: 'center' }}><Ic name="upload" size={40} /></div>
          <input type="file" accept=".xls,.xlsx,.csv" onChange={onFile} style={{ marginBottom: 8 }} />
          <div style={{ color: 'var(--text-3)', fontSize: 12 }}>Accepted formats: .xlsx, .xls, .csv</div>
          {file && <div style={{ marginTop: 10, fontWeight: 600 }}>{file.name} <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>({Math.round(file.size / 1024)} KB)</span></div>}
        </div>
        <div className="btn-row"><button className="btn blue" onClick={upload}>Upload &amp; Import</button></div>
      </div>

      <div className="card">
        <div className="card-head">Expected Columns</div>
        <div className="card-pad">
          <div className="table-wrap">
            <table className="grid">
              <thead><tr>{template.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody><tr>{template.map((c) => <td key={c} style={{ color: 'var(--text-3)' }}>—</td>)}</tr></tbody>
            </table>
          </div>
          <p style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 12 }}>Match your spreadsheet headers to the columns above before uploading.</p>
        </div>
      </div>
    </div>
  );
}
