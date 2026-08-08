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
      group('Lead & Renewal', ['Client Journey', 'RFQ']),
    ],
  },
];

// Pages that have real, custom-built implementations (route -> component key)
export const CUSTOM_ROUTES = {
  'client-master': 'ClientMaster',
  'policy-purchase-gi': 'PolicyPurchase',
  'policy-purchase-li': 'PolicyPurchase',
  'claim': 'Claims',
  'lead-view': 'Leads',
  'agency-master': 'AgencyMaster',
};

// Build a lookup of slug -> { label, group } for titles on placeholder pages
export const PAGE_INDEX = {};
NAV.forEach((menu) =>
  menu.columns.forEach((col) =>
    col.items.forEach((it) => {
      PAGE_INDEX[it.path.replace('/page/', '')] = { label: it.label, group: col.title, menu: menu.label };
    })
  )
);
