// Full navigation map for WCA CRM, mirroring the module structure of a
// cloud insurance-data-management platform. Each leaf has a slug used for routing.

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function group(title, items) {
  return { title, items: items.map((label) => ({ label, path: '/page/' + slug(label) })) };
}

export const NAV = [
  {
    key: 'master',
    label: 'Master Data',
    icon: '🗂️',
    columns: [
      group('Primary Master', ['Client Master', 'Dashboard Preference Master', 'Favourite Links']),
    ],
  },
  {
    key: 'transaction',
    label: 'Transaction Data',
    icon: '💳',
    columns: [
      group('General Insurance', ['Claim']),
      group('Lead & Renewal', ['Lead', 'Meeting', 'Client Journey', 'RFQ']),
    ],
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
