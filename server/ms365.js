// Sending mail through Microsoft 365 (Microsoft Graph), without SMTP.
//
// Microsoft is retiring password sign-in for SMTP, and many organisations have it
// switched off already. Graph is the supported route: the organisation registers the CRM
// once as an application (tenant id, application id, a client secret) and grants it
// the Mail.Send permission. The CRM then asks Microsoft to send as a person's own
// mailbox — no per-user password, and the message lands in that person's Sent Items.
//
// Nothing here knows about users or templates; it takes a configuration and a mailbox
// address and sends. The configuration lives in the app_settings table.

import crypto from 'crypto';

// Overridable only so tests can point at a stand-in for Microsoft.
const LOGIN = () => process.env.MS_LOGIN_BASE || 'https://login.microsoftonline.com';
const GRAPH = () => process.env.MS_GRAPH_BASE || 'https://graph.microsoft.com/v1.0';

// What goes inline in one request. Graph rejects requests over about 4 MB, and base64
// adds a third, so anything bigger goes through a draft with attachments added one by one.
const INLINE_LIMIT = 2 * 1024 * 1024;
const SMALL_ATTACHMENT = 3 * 1024 * 1024;       // above this an attachment needs an upload session
const UPLOAD_CHUNK = 12 * 327680;               // Graph wants multiples of 320 KiB; about 3.75 MB

export class MsError extends Error {
  constructor(message, stage, detail) { super(message); this.stage = stage; this.detail = detail; }
}

// ---- the client secret is encrypted at rest ----------------------------------------
// It can send mail as anyone the app is allowed to, so it is not left readable in the
// database. If the server's secret ever changes it cannot be decrypted; the admin then
// types it in again, which is said plainly rather than failing mysteriously.
const keyBytes = () => crypto.createHash('sha256').update('wca-crm-ms365|' + (process.env.JWT_SECRET || 'wca-crm-dev-secret-change-in-prod')).digest();
export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyBytes(), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['enc1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}
export function decryptSecret(stored) {
  try {
    const [tag, iv, auth, ct] = String(stored || '').split(':');
    if (tag !== 'enc1') return null;
    const d = crypto.createDecipheriv('aes-256-gcm', keyBytes(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(auth, 'base64'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
  } catch { return null; }
}

// ---- stored configuration -----------------------------------------------------------
const KEYS = ['ms365_enabled', 'ms365_tenant_id', 'ms365_client_id', 'ms365_client_secret'];
export async function getConfig(db) {
  const rows = await db.prepare(`SELECT key, value FROM app_settings WHERE key IN (${KEYS.map(() => '?').join(',')})`).all(...KEYS);
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const secret = m.ms365_client_secret ? decryptSecret(m.ms365_client_secret) : null;
  return {
    enabled: m.ms365_enabled === '1',
    tenantId: (m.ms365_tenant_id || '').trim(),
    clientId: (m.ms365_client_id || '').trim(),
    secret,
    hasSecret: !!m.ms365_client_secret,
    secretReadable: !m.ms365_client_secret || !!secret,
  };
}
async function put(db, key, value) {
  await db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
}
export async function saveConfig(db, { enabled, tenantId, clientId, clientSecret }) {
  await put(db, 'ms365_enabled', enabled ? '1' : '0');
  await put(db, 'ms365_tenant_id', String(tenantId || '').trim());
  await put(db, 'ms365_client_id', String(clientId || '').trim());
  // Left alone when blank, as every other secret in the CRM is.
  if (clientSecret && String(clientSecret).trim()) await put(db, 'ms365_client_secret', encryptSecret(String(clientSecret).trim()));
}

// ---- Microsoft's error codes, in words a person can act on ----------------------------
function tokenErrorText(j) {
  const d = String(j?.error_description || j?.error || 'Microsoft refused the sign-in').split('\r\n')[0].split('\n')[0];
  if (/AADSTS7000215|AADSTS7000216/.test(d)) return 'Microsoft says the client secret is wrong. Copy the secret\'s Value (not its ID) from Entra ID → App registrations → Certificates & secrets, and paste it again.';
  if (/AADSTS7000222/.test(d)) return 'Microsoft says the client secret has expired. Create a new secret in Entra ID → App registrations → Certificates & secrets and paste its Value here.';
  if (/AADSTS700016/.test(d)) return 'Microsoft does not know this Application (client) ID in this tenant. Check the Application ID and the Tenant ID.';
  if (/AADSTS90002|AADSTS900023|AADSTS50034|invalid tenant/i.test(d)) return 'Microsoft does not recognise this Tenant ID. Copy the Directory (tenant) ID from the app\'s Overview page.';
  return d;
}
function graphErrorText(status, j, mailbox) {
  const code = j?.error?.code || '';
  const msg = j?.error?.message || '';
  if (status === 401) return 'Microsoft rejected the CRM\'s access token. Disconnect and reconnect, or check the client secret. (' + (msg || code) + ')';
  if (status === 403 || /AccessDenied|Authorization_RequestDenied/i.test(code)) {
    return 'Microsoft 365 will not let the CRM send as ' + mailbox + '. Check that the app has the Mail.Send permission with admin consent, and that no access policy leaves this mailbox out. (' + (msg || code) + ')';
  }
  if (status === 404 || /ErrorInvalidUser|MailboxNotEnabledForRESTAPI|ResourceNotFound|MailboxNotFound/i.test(code)) {
    return 'Microsoft 365 has no mailbox for ' + mailbox + '. Check the address on the Team page — it must be a real, licensed mailbox in your organisation. (' + (msg || code) + ')';
  }
  if (status === 429 || status === 503) return 'Microsoft is busy at the moment. Try again in a minute. (' + (msg || code) + ')';
  return (code ? code + ': ' : '') + (msg || 'HTTP ' + status);
}

// ---- access token (application permission, cached until shortly before it expires) --------
const cache = new Map();
async function tokenFor(cfg) {
  if (!cfg?.tenantId || !cfg?.clientId || !cfg?.secret) throw new MsError('The Microsoft 365 connection is not complete: tenant ID, application ID and client secret are all needed.', 'connect');
  const k = [cfg.tenantId, cfg.clientId, crypto.createHash('sha1').update(cfg.secret).digest('hex')].join('|');
  const hit = cache.get(k);
  if (hit && hit.exp > Date.now() + 60000) return hit.token;
  let r, j;
  try {
    r = await fetch(LOGIN() + '/' + encodeURIComponent(cfg.tenantId) + '/oauth2/v2.0/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.secret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
      signal: AbortSignal.timeout(15000),
    });
    j = await r.json().catch(() => ({}));
  } catch (e) { throw new MsError('Could not reach Microsoft to sign in (' + (e.cause?.code || e.message) + '). Check the server\'s internet connection.', 'connect'); }
  if (!r.ok || !j.access_token) throw new MsError(tokenErrorText(j), 'connect', j);
  cache.set(k, { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3000) * 1000 });
  return j.access_token;
}
export function clearTokenCache() { cache.clear(); }

// The application permissions that were actually granted are written into the token itself.
function rolesOf(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).roles || []; } catch { return null; }
}

/** Signs in and reports whether Mail.Send was granted, without sending anything. */
export async function testConnection(cfg) {
  const token = await tokenFor(cfg);
  const roles = rolesOf(token);
  // roles is null only if the token could not be read, in which case sending decides.
  return { ok: true, roles: roles || [], hasMailSend: roles ? roles.includes('Mail.Send') : null };
}

async function graph(token, method, path, body, mailbox) {
  let r, text;
  try {
    r = await fetch(GRAPH() + path, {
      method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000),
    });
    text = await r.text();
  } catch (e) { throw new MsError('Could not reach Microsoft to send (' + (e.cause?.code || e.message) + ').', 'send'); }
  let j = null; try { j = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!r.ok) throw new MsError(graphErrorText(r.status, j, mailbox), 'send', j || text);
  return j;
}

const MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', txt: 'text/plain', csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
const mimeOf = (name) => MIME[String(name || '').split('.').pop().toLowerCase()] || 'application/octet-stream';
const recipients = (v) => String(v || '').split(/[;,]/).map((s) => s.trim()).filter(Boolean).map((a) => ({ emailAddress: { address: a } }));

/**
 * Sends one message as the mailbox `from`. attachments: [{ filename, contentBase64 }].
 * Small messages go in one request. Large ones are built as a draft — attachments added
 * one by one, the big ones through an upload session — and then sent, because that is the
 * only way Graph accepts files over a few megabytes.
 */
export async function sendGraphMail(cfg, from, { to, cc, subject, html, attachments = [] }) {
  const token = await tokenFor(cfg);
  const toList = recipients(to);
  if (!toList.length) throw new MsError('No recipient address.', 'send');
  const msg = { subject: subject || '', body: { contentType: 'HTML', content: html || '' }, toRecipients: toList };
  if (recipients(cc).length) msg.ccRecipients = recipients(cc);
  const files = (attachments || []).map((a) => ({
    name: a.filename || 'document.pdf', contentType: a.contentType || mimeOf(a.filename),
    bytes: Buffer.from(String(a.contentBase64 || '').split(',').pop(), 'base64'),
  }));
  const total = files.reduce((n, f) => n + f.bytes.length, 0);
  const base = '/users/' + encodeURIComponent(from);
  const asFile = (f) => ({ '@odata.type': '#microsoft.graph.fileAttachment', name: f.name, contentType: f.contentType, contentBytes: f.bytes.toString('base64') });

  if (total <= INLINE_LIMIT) {
    if (files.length) msg.attachments = files.map(asFile);
    await graph(token, 'POST', base + '/sendMail', { message: msg, saveToSentItems: true }, from);
    return { via: 'sendMail', attachments: files.length };
  }

  const draft = await graph(token, 'POST', base + '/messages', msg, from);
  try {
    for (const f of files) {
      if (f.bytes.length <= SMALL_ATTACHMENT) {
        await graph(token, 'POST', base + '/messages/' + draft.id + '/attachments', asFile(f), from);
        continue;
      }
      const s = await graph(token, 'POST', base + '/messages/' + draft.id + '/attachments/createUploadSession',
        { AttachmentItem: { attachmentType: 'file', name: f.name, size: f.bytes.length, contentType: f.contentType } }, from);
      for (let off = 0; off < f.bytes.length; off += UPLOAD_CHUNK) {
        const end = Math.min(off + UPLOAD_CHUNK, f.bytes.length) - 1;
        // The upload address is already authorised, so no bearer token goes with it.
        const r = await fetch(s.uploadUrl, {
          method: 'PUT', headers: { 'Content-Range': 'bytes ' + off + '-' + end + '/' + f.bytes.length, 'Content-Type': 'application/octet-stream' },
          body: f.bytes.subarray(off, end + 1), signal: AbortSignal.timeout(120000),
        });
        if (!r.ok) throw new MsError('Microsoft refused part of the attachment "' + f.name + '" (HTTP ' + r.status + ').', 'send');
      }
    }
    await graph(token, 'POST', base + '/messages/' + draft.id + '/send', undefined, from);
  } catch (e) {
    // A half-built draft would sit in the person's Drafts folder for ever.
    try { await graph(token, 'DELETE', base + '/messages/' + draft.id, undefined, from); } catch { /* best effort */ }
    throw e;
  }
  return { via: 'draft', attachments: files.length };
}
