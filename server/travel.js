// Travel insurance: the trip behind a quotation or a policy.
//
// A trip is known from two places — the RFQ (what the client asked us to quote) and the onboarding
// form (what the client confirmed, with passports). The form wins where it has an answer, because it
// is the client's own final word. From the trip follow the policy period, whether the policy renews
// (a single trip does not; an annual multi-trip or a student policy does) and the mails around the
// trip itself (bon voyage before departure, welcome back after return).

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const parseJ = (v, d) => { try { const x = JSON.parse(v || ''); return x ?? d; } catch { return d; } };

export const TRIP_TYPES = ['Single Trip', 'Annual Multi-Trip', 'Student Travel'];
export const isTravel = (...parts) => /travel/i.test(parts.filter(Boolean).join(' '));
/** An annual multi-trip or a student policy runs for a year (or the course) and is renewed. */
export const renewsTrip = (type) => /annual|multi|student/i.test(type || '');

const shift = (iso, days, years = 0) => { const t = new Date(iso + 'T00:00:00Z'); t.setUTCFullYear(t.getUTCFullYear() + years); t.setUTCDate(t.getUTCDate() + days); return t.toISOString().slice(0, 10); };
/** Whole calendar days from today (India time) to a date: 1 = tomorrow, 0 = today, negative = past. */
export const daysUntil = (iso) => { if (!ISO.test(iso || '')) return null; const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10); return Math.round((Date.parse(iso) - Date.parse(today)) / 86400000); };
export const tripDays = (from, to) => (ISO.test(from || '') && ISO.test(to || '') && to >= from ? Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1 : 0);

/**
 * The trip from an RFQ's details and/or the client's onboarding answers.
 * Returns { type, depart, ret, destination, purpose, travellers, days, from, to, renewable } — any of them may be empty.
 */
export function tripFrom(details = {}, answers = null) {
  const d = details || {};
  const a = answers || {};
  const pick = (x, y) => (x !== undefined && x !== null && String(x).trim() !== '' ? x : y);
  let type = d.trip_type || '';
  if (a.multi_trip === 'Yes') type = 'Annual Multi-Trip';
  else if (a.purpose === 'Study' && !type) type = 'Student Travel';
  if (!type) type = 'Single Trip';
  const depart = ISO.test(a.depart || '') ? a.depart : ISO.test(d.depart_date || '') ? d.depart_date : '';
  const ret = ISO.test(a.return || '') ? a.return : ISO.test(d.return_date || '') ? d.return_date : '';
  const travellers = Array.isArray(a.travellers) && a.travellers.length ? a.travellers.length
    : Array.isArray(d.travellers) && d.travellers.length ? d.travellers.length : Number(d.total_members) || 0;
  // The policy period: the trip itself, or a year from departure for an annual multi-trip policy.
  let from = depart, to = '';
  if (depart) to = /annual|multi/i.test(type) ? shift(depart, -1, 1) : ret;
  return {
    type, depart, ret, destination: pick(a.destination, d.destination || ''), purpose: pick(a.purpose, d.purpose || ''),
    travellers, days: tripDays(depart, ret), from, to: to || '', renewable: renewsTrip(type) ? 'Yes' : 'No',
  };
}

/** The trip behind a quotation: its RFQ's details plus the client's latest submitted onboarding answers. */
export async function tripForQuote(db, q) {
  if (!q || !isTravel(q.category, q.product)) return null;
  const rfq = q.rfq_id ? await db.prepare('SELECT details FROM rfqs WHERE id = ?').get(q.rfq_id) : null;
  const ob = await db.prepare("SELECT answers FROM onboarding_requests WHERE quotation_id = ? AND status IN ('Submitted', 'Reviewed') ORDER BY id DESC LIMIT 1").get(q.id);
  return tripFrom(parseJ(rfq?.details, {}), parseJ(ob?.answers, null));
}

/** What the onboarding form can start with, from the RFQ's trip (the client still checks it). */
export function tripPrefill(details = {}) {
  const d = details || {};
  const out = {};
  if (d.destination) out.destination = d.destination;
  if (ISO.test(d.depart_date || '')) out.depart = d.depart_date;
  if (ISO.test(d.return_date || '')) out.return = d.return_date;
  if (d.purpose) out.purpose = d.purpose === 'Study' || ['Holiday', 'Business', 'Visiting family'].includes(d.purpose) ? d.purpose : 'Other';
  const usd = Number(d.si_usd) || 0;
  const SI = { 50000: 'USD 50,000', 100000: 'USD 1,00,000', 250000: 'USD 2,50,000', 500000: 'USD 5,00,000' };
  if (SI[usd]) out.travel_si = SI[usd];
  if (d.schengen) out.schengen = d.schengen;
  if (d.trip_type) out.multi_trip = /annual|multi/i.test(d.trip_type) ? 'Yes' : 'No';
  return out;
}
