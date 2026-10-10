// Documents attached to an RFQ, turned into labelled email attachments.
//
// An RFQ carries its papers as data URIs inside `details`: the RC book (or, for
// other lines, whatever the line's mandatory document is), Aadhar, PAN, GST, the
// previous policy and any number of others. When an RFQ is emailed, each one
// should arrive as a separate attachment named for what it is — "RC Book Copy -
// Nitesh Dube - GJ06GF5645.pdf" — rather than as "scan0042.pdf", and the email
// should list exactly what is attached.

const MIME_EXT = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
  'image/webp': 'webp', 'image/gif': 'gif',
};

// The same labels the form shows for the line's mandatory document.
const MANDATORY_LABEL = {
  'Motor': 'RC Book Copy',
  'Workmen Compensation': 'Supporting Document',
  'Group Personal Accident': 'Member List',
  'Group Health Insurance': 'Employee Census',
  'Retail Health': 'Member / Age Details',
  'Fire & Property': 'Property / Asset Statement',
  'Householder': 'Property / Contents Statement',
  'Engineering': 'Project / Plant Details',
  'Marine Cargo': 'Invoice / Packing List',
  'Liability': 'Proposal / Exposure Details',
  'Group Term Life': 'Member Data Sheet',
};

// Characters a filesystem refuses, dropped rather than escaped.
const clean = (v) => String(v || '').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();

/** File extension from the data URI's own type, falling back to the original name. */
export function extOf(uri, originalName = '') {
  const m = /^data:([^;,]+)/.exec(uri || '');
  if (m && MIME_EXT[m[1].toLowerCase()]) return MIME_EXT[m[1].toLowerCase()];
  const e = /\.([a-z0-9]{2,5})$/i.exec(originalName || '');
  return e ? e[1].toLowerCase() : 'pdf';
}

const parse = (v) => {
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(v || '{}'); } catch { return {}; }
};

/**
 * Every document on the RFQ as { label, filename, uri }. Slots with nothing
 * attached are left out, so the email never names a document it doesn't carry.
 */
export function rfqAttachments(rfq) {
  const d = parse(rfq.details);
  const who = clean(rfq.client_name);
  const reg = clean(d.reg_no);
  const tail = [who, reg].filter(Boolean).join(' - ');
  const out = [];

  const slots = [
    ['rc', MANDATORY_LABEL[rfq.category] || 'Supporting Document'],
    ['aadhar', 'Aadhar Card'],
    ['pan', 'PAN Card'],
    ['gst', 'GST Certificate'],
    ['prev', 'Previous Policy Copy'],
  ];
  for (const [key, label] of slots) {
    const uri = d[key + '_doc'];
    if (!uri) continue;
    out.push({ label, uri, filename: `${label} - ${tail}.${extOf(uri, d[key + '_name'])}` });
  }

  // Extras keep the name they were uploaded under, since that is their label.
  (Array.isArray(d.other_docs) ? d.other_docs : []).forEach((doc, i) => {
    if (!doc?.doc) return;
    const base = clean((doc.name || '').replace(/\.[a-z0-9]{2,5}$/i, '')) || `Document ${i + 1}`;
    out.push({ label: base, uri: doc.doc, filename: `${base} - ${who}.${extOf(doc.doc, doc.name)}` });
  });
  return out;
}

/** Insurer quote documents, as labelled attachments, for the mail to the client. */
export function quoteAttachments(rfq) {
  let list = rfq.insurers;
  if (typeof list === 'string') { try { list = JSON.parse(list || '[]'); } catch { list = []; } }
  const who = clean(rfq.client_name);
  return (Array.isArray(list) ? list : [])
    .filter((i) => i && i.quote_doc && Number(i.premium) > 0)
    .map((i) => {
      const label = `Quote - ${clean(i.insurer)}`;
      return { label, uri: i.quote_doc, filename: `${label} - ${who}.${extOf(i.quote_doc, i.quote_name)}` };
    });
}

// The API accepts 20 MB of JSON and a data URI is a third larger than the file
// it carries, so about 14 MB of real attachments is the ceiling. Past that the
// request fails with a bare "Request failed" — better to say so beforehand.
export const ATTACHMENT_LIMIT_BYTES = 14 * 1024 * 1024;
export const attachmentsBytes = (list) => list.reduce((n, a) => n + Math.round(((a.uri || '').length * 3) / 4), 0);
export const mb = (bytes) => (bytes / 1048576).toFixed(1);
