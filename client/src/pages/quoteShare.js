// Sending a comparison to the client: the branded email body and the email / WhatsApp calls. The SMTP and
// WhatsApp credentials are never held by the browser — the server picks the mailbox itself.
import { api } from '../api.js';
import { brandLogo } from '../components/Logo.jsx';

const escHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function companyProfile() {
  try { return JSON.parse(localStorage.getItem('wca_company_profile') || '{}'); } catch { return {}; }
}

export function emailHtmlBody(bodyText, profile = companyProfile()) {
  const brand = profile.logo
    ? `<img src="${profile.logo}" alt="${escHtml(profile.name || 'WeCare Assurance')}" style="height:44px;display:block;margin-bottom:14px">`
    : `<img src="${new URL(brandLogo, window.location.origin).href}" alt="WeCare Assurance" width="128" style="height:55px;width:auto;display:block;margin-bottom:14px">`;
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a2230;max-width:560px">${brand}<div style="white-space:pre-wrap;line-height:1.6;font-size:14px">${escHtml(bodyText)}</div></div>`;
}

/** Email with any number of attachments ({ filename, uri }). rfqId / quotationId pick the office mailbox. */
export function sendEmailWith(to, subject, bodyText, files, { rfqId, quotationId } = {}) {
  const attachments = (files || []).map((a) => ({ filename: a.filename, contentBase64: a.uri }));
  return api('/send-email', { method: 'POST', body: { to, subject, html: emailHtmlBody(bodyText), attachments, rfqId, quotationId } });
}

export function sendWhatsApp(to, message, pdfDataUri, pdfFilename) {
  return api('/send-whatsapp', { method: 'POST', body: { to, message, mediaBase64: pdfDataUri || undefined, filename: pdfFilename } });
}
