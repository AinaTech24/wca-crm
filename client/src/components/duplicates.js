// Before a new lead or client is saved: is this someone already on the books (same mobile, email or PAN)?
// Shows who, and lets the person save anyway or go back.
import { api } from '../api.js';
import confirm from './confirm.js';

export async function okIfDuplicate({ mobile, email, pan_no } = {}) {
  const q = new URLSearchParams({ mobile: mobile || '', email: email || '', pan: pan_no || '' });
  const r = await api('/duplicates?' + q.toString()).catch(() => null);
  const list = [
    ...(r?.clients || []).map((c) => `client ${c.client_name}${c.mobile ? ' (' + c.mobile + ')' : ''}`),
    ...(r?.leads || []).map((l) => `open lead ${l.lead_name}${l.status ? ' (' + l.status + ')' : ''}`),
  ];
  if (!list.length) return true;
  return confirm({
    title: 'Already on the books?',
    message: `The same mobile, email or PAN belongs to ${list.join(', ')}. Save this as a new record anyway?`,
    confirmText: 'Save anyway', cancelText: 'Go back', icon: 'alert',
  });
}
