// Module access control.
//
// A user may be limited to a subset of modules. The list below is the single
// source of truth for what a module is: its key (which matches the sidebar
// path), its label, and the API paths that belong to it.
//
// Two rules that matter:
//   - No permissions recorded means every module. An empty list would be the
//     obvious encoding for "nothing", but it is also what every existing row
//     holds, and locking out the whole office on deploy is not an acceptable
//     default. Access is removed deliberately, never by omission.
//   - An admin always has everything. Otherwise an admin could remove their
//     own access to Team and leave nobody able to grant it back.

export const MODULES = [
  { key: 'lead', label: 'Lead', paths: ['/api/leads', '/api/lead-activities'] },
  { key: 'client-master', label: 'Clients', paths: ['/api/clients', '/api/clients-events'] },
  { key: 'rfq', label: 'RFQ', paths: ['/api/rfqs'] },
  { key: 'meeting', label: 'Meetings', paths: ['/api/meetings'] },
  { key: 'task', label: 'Task', paths: ['/api/tasks'] },
  { key: 'policy', label: 'Policy', paths: ['/api/policies', '/api/renewals', '/api/endorsements'] },
  { key: 'claim', label: 'Claims', paths: ['/api/claims'] },
  { key: 'client-journey', label: 'Client Journey', paths: ['/api/client-journey'] },
  { key: 'reports', label: 'Reports', paths: ['/api/reports'] },
  { key: 'email-templates', label: 'Email Template', paths: ['/api/templates'] },
  { key: 'team', label: 'Team', paths: ['/api/users'] },
];

export const MODULE_KEYS = MODULES.map((m) => m.key);

// Paths every signed-in user reaches regardless of module access: their own
// profile, the dashboard, notifications, the realtime stream, shared pickers.
// Locking these would break the shell the app is rendered in.
const ALWAYS_ALLOWED = [
  '/api/login', '/api/health', '/api/me', '/api/dashboard', '/api/notifications',
  '/api/events', '/api/integration-settings', '/api/masters', '/api/lookups',
  '/api/company-emails', '/api/send-email', '/api/send-whatsapp', '/api/whatsapp',
  '/api/record-notes', '/api/record-attachments', '/api/quotations', '/api/commissions',
  '/api/fd-transactions', '/api/agencies', '/api/companies',
];

/** Parses the stored list; anything unreadable is treated as "no limits set". */
export function parseAccess(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  try {
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(list) || !list.length) return null;
    const clean = list.filter((k) => MODULE_KEYS.includes(k));
    return clean.length ? clean : null;
  } catch { return null; }
}

/** The module a request belongs to, or null when it isn't module-specific. */
export function moduleForPath(path) {
  for (const m of MODULES) {
    for (const p of m.paths) {
      if (path === p || path.startsWith(p + '/') || path.startsWith(p + '?')) return m.key;
    }
  }
  return null;
}

export const isAlwaysAllowed = (path) =>
  ALWAYS_ALLOWED.some((p) => path === p || path.startsWith(p + '/') || path.startsWith(p + '?'));

/**
 * Whether a user may reach a path. Admins and users with no recorded limits
 * get everything; otherwise the path's module must be on their list. A path
 * belonging to no module is allowed — module access limits modules, it is not
 * a general-purpose deny list.
 */
export function canAccessPath(user, path) {
  if (user?.role === 'admin') return true;
  if (isAlwaysAllowed(path)) return true;
  const allowed = parseAccess(user?.module_access);
  if (!allowed) return true;
  const mod = moduleForPath(path);
  if (!mod) return true;
  return allowed.includes(mod);
}
