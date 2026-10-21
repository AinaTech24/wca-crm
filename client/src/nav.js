// Navigation map for WCA CRM.
//
// MODULES is the sidebar, in the order it appears. Adding a module here adds
// it to the sidebar, the top-bar search and the Favourite Links picker.
//
// Paths are written out rather than derived from the label, because a module's
// URL is not a display concern: /page/client-master is hardcoded in App.jsx's
// routes, in ClientForm's cancel/save navigation and in the notification links
// the server builds. Deriving the path from the label meant renaming "Client
// Master" to "Clients" would silently move the page and break all of those.

const page = (label, slug) => ({ label, path: '/page/' + slug });

export const MODULES = [
  page('Lead', 'lead'),
  page('Clients', 'client-master'),
  page('RFQ', 'rfq'),
  page('Timeline', 'timeline'),
  page('Meetings', 'meeting'),
  page('Task', 'task'),
  page('Policy', 'policy'),
  page('Claims', 'claim'),
  page('Client Journey', 'client-journey'),
  page('Reports', 'reports'),
  page('Email Template', 'email-templates'),
  page('Email Setup', 'email-setup'),
  page('Team', 'team'),
];
// Dashboard isn't listed: the sidebar pins it above this list, pointing at "/"
// rather than a /page/ route.

// The grouped shape the top-bar search and breadcrumbs read.
export const NAV = [
  {
    key: 'workspace',
    label: 'Workspace',
    icon: '🗂️',
    columns: [{ title: '', items: MODULES }],
  },
];

// Build a lookup of slug -> { label, group } for titles on placeholder pages
export const PAGE_INDEX = {};
NAV.forEach((menu) =>
  menu.columns.forEach((col) =>
    col.items.forEach((it) => {
      PAGE_INDEX[it.path.replace('/page/', '')] = { label: it.label, group: col.title, menu: menu.label };
    })
  )
);
