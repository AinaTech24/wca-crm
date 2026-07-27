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
      group('General Insurance', ['Agency Master', 'Add On Master', 'Content Master', 'Claim Intimation Master', 'Make', 'Model', 'Risk Type', 'Occupancy', 'HPA']),
      group('Life Insurance', ['LI Agency Master', 'Excel Upload', 'LD Excel Upload', 'Product Master']),
      group('Fixed Deposit', ['FD Agency Master', 'FD Scheme Master']),
    ],
  },
  {
    key: 'transaction',
    label: 'Transaction Data',
    icon: '💳',
    columns: [
      group('General Insurance', ['Policy Purchase GI', 'Claim', 'Endorsement', 'Commission Payin', 'Commission Payout', 'Commission Reconciliation', 'Renewal Premium Update', 'Merging Client', 'Cross Sell - Up Sell']),
      group('Life Insurance', ['Policy Purchase LI', 'Premium Due FUP Update', 'PDF FUP Update']),
      group('Fixed Deposit', ['FD Transaction']),
      group('Lead & Renewal', ['Client Journey', 'Lead View', 'RFQ', 'Quotation', 'Renewal Manager', 'Renewal View', 'Assign Reassign Renewals', 'Assign Reassign Lead', 'Lead Followup', 'Task Management', 'Event Calendar']),
    ],
  },
  {
    key: 'office',
    label: 'Office Reports',
    icon: '📄',
    columns: [
      group('General Insurance', ['Insurance Policy Register', 'Insurance Due Report', 'Lapse Policy Report', 'Business Register', 'Policy Endo Business Register', 'GI Client Portfolio', 'General Premium Calendar', 'New Renew Business Report', 'Claim Report', 'Endorsement Report', 'Pending Proposal', 'Client Address Label', 'Decline Cancel', 'Renewal Letter', 'Renewal Letter GroupWise', 'Office Lead Followup', 'Renewal Followup', 'Renewal Summary']),
      group('Life Insurance', ['LI Policy Register', 'LI Renewal Report', 'LI Transaction Report', 'LI Client Portfolio', 'LI Premium Calendar', 'LI Client Cash Flow', 'Policy Status Wise Report', 'Survival Benefit Report', 'LI Lapse Report']),
      group('Fixed Deposit', ['FD Report', 'FD Interest Payout', 'FD Client Portfolio', 'FD Client Cash Flow']),
    ],
  },
  {
    key: 'mis',
    label: 'Business MIS Reports',
    icon: '📊',
    columns: [
      group('General Insurance', ['Vehicle Policy Register', 'Company Wise', 'City Wise', 'Area Wise', 'Product Type', 'BA List', 'BA Department Wise Report', 'New Client', 'Client Credit Debit', 'Commission Payin Report', 'Commission Payout Report', 'Payin Reconciliation', 'Payout Reconciliation', 'Policy History Report', 'Health Check Up Report', 'Top Clients Report']),
      group('Life Insurance', ['Company Product Wise Report', 'LI City Wise Report', 'LI Area Wise Report', 'Paid Up Report', 'Maturity Report', 'Minor To Major Report', 'Surrender Report', 'Death Claim Report', 'Record Only Report']),
      group('Combined Reports', ['Combined Client Portfolio', 'Combined Premium Calendar', 'Combined Insurance Due', 'Combined Cash Flow']),
    ],
  },
  {
    key: 'misc',
    label: 'Miscellaneous / Utility',
    icon: '⚙️',
    columns: [
      group('SMS / Mail Management', ['LI WA Renewal', 'GI WA Renewal', 'LI Mail Renewal', 'GI Mail Renewal', 'Birthday WA Mail', 'Anniversary WA Mail', 'Scheduler Reminder']),
      group('Template Management', ['LI Renewal Mail Template', 'GI Renewal Mail Template', 'GI Renewal Mail Group Template', 'LI Renewal Mail Group Wise Template', 'Policy Copy Email Template']),
      group('Client App Management', ['Client App Management', 'Send App Credentials', 'Welcome Mail Template', 'Client Lead', 'Youtube Video Mgt', 'Client App Slider Mgt']),
      group('Utility', ['Birthday List', 'Anniversary List']),
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
