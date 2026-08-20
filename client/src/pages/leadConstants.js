// Shared between the Leads list/kanban and the lead detail view.

export const BUSINESS_TYPES = ['Motor', 'Retail Health', 'Group Health Insurance', 'Life / Term', 'Group Term Life',
  'Personal Accident', 'Group Personal Accident', 'Workmen Compensation', 'Fire & Property', 'Marine Cargo',
  'Engineering', 'Liability', 'Householder', 'Travel', 'Fixed Deposit', 'Other'];

// Picking this source reveals a picker for the existing client who referred
// the lead; any other source clears it (enforced server-side too).
export const REFERRAL_SOURCE = 'Client Referral';
export const SOURCES = ['Website', REFERRAL_SOURCE, 'Agent / Partner Referral', 'Walk-in', 'Phone Enquiry',
  'Social Media', 'Email Campaign', 'Existing Client', 'Cold Call', 'Advertisement', 'Other'];

export const STATUSES = ['New', 'Contacted', 'Follow Up', 'Qualified', 'Proposal Sent', 'Converted', 'Lost', 'Junk'];
export const STATUS_BADGE = {
  New: 'blue', Contacted: 'blue', 'Follow Up': 'orange', Qualified: 'green',
  'Proposal Sent': 'orange', Converted: 'green', Lost: 'red', Junk: 'red',
};
// Statuses still in play — everything except the closed-out ones.
export const OPEN_STATUSES = ['New', 'Contacted', 'Follow Up', 'Qualified', 'Proposal Sent'];

export const PRIORITIES = ['Low', 'Medium', 'High'];
export const TASK_STATUSES = ['Open', 'In Progress', 'Done'];

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const emptyLead = () => ({
  lead_name: '', lead_date: todayISO(), expected_business_type: '', mobile: '', email: '',
  lead_owner: '', source: '', referral_client_id: null, referral_client_name: '',
  company_name: '', status: 'New', followup_date: '', remarks: '',
});
