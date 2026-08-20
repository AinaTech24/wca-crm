// Vartify WhatsApp Business Platform client (REST API v1).
//
// Reference: https://vartify.in/api/v1 — Bearer token, JSON over HTTPS,
// 60 requests/min/token (sends additionally capped at 60/min).
//
// The three things the API reference warns integrators about, handled here:
//   1. Phone numbers must be E.164 with a leading '+'. Mobiles across this
//      CRM are stored bare (10 digits), so they're normalised on the way out.
//   2. POST /contacts upserts on phone number — safe to call on every save,
//      never creates duplicates, so there's no "does this contact exist?" check.
//   3. Free-form text only reaches customers who messaged in the last 24h.
//      Everything else must be an approved template, so the template path is
//      the default and free-form is the special case.

const DEFAULT_BASE = 'https://vartify.in/api/v1';
const DEFAULT_COUNTRY = '91'; // India — every mobile in this CRM is Indian

export class VartifyError extends Error {
  constructor(message, { status, body, retryAfter } = {}) {
    super(message);
    this.name = 'VartifyError';
    this.status = status;
    this.body = body;
    this.retryAfter = retryAfter;
  }
}

// "9876543210" -> "+919876543210"; "+91 98765 43210" -> "+919876543210".
// Returns null when there aren't enough digits to be a real number, so the
// caller can fail loudly instead of sending to a malformed address.
export function toE164(raw, country = DEFAULT_COUNTRY) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const hadPlus = s.startsWith('+');
  let digits = s.replace(/\D/g, '');
  if (!digits) return null;
  if (!hadPlus) {
    if (digits.length === 10) digits = country + digits;              // bare local number
    else if (digits.length === 11 && digits.startsWith('0')) digits = country + digits.slice(1);
  }
  const out = '+' + digits;
  // Same pattern the API documents: ^\+[1-9]\d{6,14}$
  return /^\+[1-9]\d{6,14}$/.test(out) ? out : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Single request wrapper. Retries 429 using the Retry-After header and 5xx
// with exponential backoff, as the reference instructs; 4xx other than 429 is
// returned to the caller as-is because retrying a validation error is futile.
async function request(settings, path, { method = 'GET', body, query, attempt = 0 } = {}) {
  const base = (settings.base || DEFAULT_BASE).replace(/\/$/, '');
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: 'Bearer ' + settings.token,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    // Network-level failure (DNS, timeout) — worth one retry.
    if (attempt < 2) { await sleep(500 * (attempt + 1)); return request(settings, path, { method, body, query, attempt: attempt + 1 }); }
    throw new VartifyError(`Could not reach Vartify: ${e.message}`, { status: 0 });
  }

  if (res.status === 429 && attempt < 3) {
    const wait = Number(res.headers.get('Retry-After')) || 2;
    await sleep(Math.min(wait, 30) * 1000);
    return request(settings, path, { method, body, query, attempt: attempt + 1 });
  }
  if (res.status >= 500 && attempt < 3) {
    await sleep(2 ** attempt * 500);
    return request(settings, path, { method, body, query, attempt: attempt + 1 });
  }

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

  if (!res.ok) {
    // The API uses `error` for most failures and `message` + `errors` for 422.
    let msg = data?.error || data?.message || `Vartify request failed (${res.status})`;
    if (res.status === 401) msg = 'Vartify rejected the API token — check it in My Profile.';
    if (res.status === 403) msg = 'That API token is missing a required scope (needs contacts:write, messages:write, conversations:read).';
    if (res.status === 422 && data?.errors) {
      const first = Object.values(data.errors)[0];
      if (Array.isArray(first) && first[0]) msg = first[0];
    }
    throw new VartifyError(msg, { status: res.status, body: data, retryAfter: res.headers.get('Retry-After') });
  }
  return data;
}

/** Connection test — returns the account the token belongs to. */
export const me = (settings) => request(settings, '/me');

/**
 * Create or update a contact. Upserts on phone, so this is safe to call on
 * every CRM save without checking for an existing record first.
 * `crmRef` lands in custom_fields so records can be matched back later.
 */
export async function upsertContact(settings, { mobile, first_name, last_name, email, crmKind, crmId, source = 'wca_crm' }) {
  const phone = toE164(mobile);
  if (!phone) throw new VartifyError(`"${mobile || ''}" is not a valid mobile number — WhatsApp needs a full number with country code.`, { status: 422 });
  const data = await request(settings, '/contacts', {
    method: 'POST',
    body: {
      phone_e164: phone,
      first_name: (first_name || '').slice(0, 100) || undefined,
      last_name: (last_name || '').slice(0, 100) || undefined,
      email: email || undefined,
      country: 'IN',
      opt_in_whatsapp: true,
      source,
      custom_fields: crmId ? { crm_record_id: String(crmId), crm_record_type: crmKind || '' } : undefined,
    },
  });
  return data?.data || data;
}

/** Approved (sendable) templates, with the variable count each one needs. */
export async function listTemplates(settings, { all = false } = {}) {
  const data = await request(settings, '/whatsapp/templates', { query: all ? { status: 'all' } : undefined });
  return data?.data || [];
}

/**
 * Send a message. Pass `template_name` (+ vars) for the template path, which
 * works at any time, or `body` for free-form — only valid inside the 24-hour
 * window, and rejected by Meta rather than Vartify when it isn't.
 */
export function sendMessage(settings, { contact_id, channel = 'whatsapp', body, template_name, template_vars, template_language, header_media_url, sent_by }) {
  return request(settings, '/messages/send', {
    method: 'POST',
    body: {
      contact_id,
      channel,
      ...(template_name
        ? { template_name, template_vars: template_vars || [], ...(template_language ? { template_language } : {}), ...(header_media_url ? { header_media_url } : {}) }
        : { body }),
      sent_by: sent_by || 'WCA CRM',
    },
  });
}

/** Conversations for one contact (cursor-paginated; first page is enough for a record view). */
export async function conversationsForContact(settings, contactId) {
  const data = await request(settings, '/conversations', { query: { contact_id: contactId } });
  return data?.data || [];
}

/**
 * Recent messages for a conversation. Page 1 is the *oldest* 50, so `latest=1`
 * is what a chat view actually wants — still in chronological order.
 */
export async function conversationMessages(settings, conversationId) {
  const data = await request(settings, `/conversations/${conversationId}/messages`, { query: { latest: 1 } });
  return data?.data || [];
}

export function markConversationRead(settings, conversationId) {
  return request(settings, `/conversations/${conversationId}/read`, { method: 'POST' });
}

/** Register our inbound webhook. The returned secret is shown once — store it. */
export function registerWebhook(settings, { url, events, description }) {
  return request(settings, '/webhooks', {
    method: 'POST',
    body: { url, events: events || ['message.received', 'message.sent'], description: description || 'WCA CRM sync' },
  });
}

export const listWebhooks = (settings) => request(settings, '/webhooks');
export const deleteWebhook = (settings, id) => request(settings, `/webhooks/${id}`, { method: 'DELETE' });

/**
 * Verifies the X-Webhook-Signature header: "t=<unix>,v1=<hmac_sha256>", where
 * the signed value is `${t}.${rawBody}`. Constant-time compared, and the
 * timestamp is age-checked so a captured delivery can't be replayed later.
 */
export function verifyWebhookSignature(crypto, header, rawBody, secret, toleranceSec = 300) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    String(header).split(',').map((p) => {
      const i = p.indexOf('=');
      return i === -1 ? [p.trim(), ''] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    })
  );
  const t = parts.t, v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(t)) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(v1), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
