// Report definitions for the Reports module.
//
// Each report is a table, a date column to filter on, a set of dimensions it
// can be grouped by, and a set of metrics. The endpoint builds one GROUP BY
// query from a spec — so adding a dimension or a metric is a line here, with
// no endpoint or UI change.
//
// The `sql` strings are interpolated into the query, so dimensions are only
// ever reached through these maps by key. Nothing from the request ever
// becomes SQL.

const money = (key, label, col) => ({ key, label, kind: 'money', sql: `COALESCE(SUM(${col}), 0)` });
const int = (key, label, sql) => ({ key, label, kind: 'int', sql });
// A share of the group's rows, worked out per group and again over the whole set for the total.
const pct = (key, label, cond) => ({ key, label, kind: 'pct',
  sql: `ROUND(100.0 * COUNT(*) FILTER (WHERE ${cond}) / NULLIF(COUNT(*), 0))::int` });

// Dates are stored as TEXT, and imported rows don't always hold an ISO date.
// Casting '' or '24/10/2026' to ::date errors in Postgres and would take the
// whole report down, so anything that isn't YYYY-MM-DD… counts as undated.
export const isoDate = (col) => `(CASE WHEN ${col} ~ '^\\d{4}-\\d{2}-\\d{2}' THEN substr(${col}, 1, 10)::date END)`;
export const dateFilter = (col) => `${isoDate(col)} BETWEEN ?::date AND ?::date`;

const LEAD_DATE = "COALESCE(NULLIF(lead_date, ''), created_at)";
const CLIENT_DATE = "COALESCE(NULLIF(onboarding_date, ''), created_at)";
const RFQ_QUOTED = "status IN ('Quoted', 'Approved by Customer', 'Proposal Requested', 'Closed')";
const RFQ_WON = "status IN ('Approved by Customer', 'Proposal Requested', 'Closed')";
const OVERDUE = `status <> 'Done' AND ${isoDate('due_date')} < CURRENT_DATE`;

export const REPORTS = {
  business: {
    label: 'Business Report',
    table: 'policies',
    dateCol: 'period_from',
    dateLabel: 'Policy start date',
    scoped: true,
    defaultDim: 'owner',
    dims: {
      owner: { label: 'User', sql: "NULLIF(assigned_to, '')" },
      product: { label: 'Product', sql: "NULLIF(insurance_type, '')" },
      insurer: { label: 'Insurer', sql: "NULLIF(company_name, '')" },
      line: { label: 'Insurance Line', sql: "CASE insurance_line WHEN 'GI' THEN 'General Insurance' WHEN 'LI' THEN 'Life Insurance' END" },
      status: { label: 'Policy Status', sql: "NULLIF(policy_status, '')" },
      department: { label: 'Department', sql: "NULLIF(department, '')" },
      month: { label: 'Month', sql: 'substr(period_from, 1, 7)' },
    },
    metrics: [
      int('policies', 'Policies', 'COUNT(*)'),
      money('net_premium', 'Net Premium', 'net_premium'),
      money('gst_amount', 'GST', 'gst_amount'),
      money('final_premium', 'Gross Premium', 'final_premium'),
      money('sum_assured', 'Sum Assured', 'sum_assured'),
    ],
    sortBy: 'final_premium',
  },

  meetings: {
    label: 'Meetings Report',
    table: 'meetings',
    dateCol: 'from_date',
    dateLabel: 'Meeting date',
    // The meetings table carries no department, and the Meetings module itself
    // shows every meeting to every user. Scoping the report but not the module
    // it reports on would just make the two disagree.
    scoped: false,
    defaultDim: 'owner',
    dims: {
      owner: { label: 'Owner', sql: "NULLIF(owner, '')" },
      status: { label: 'Status', sql: "NULLIF(status, '')" },
      type: { label: 'Type', sql: "NULLIF(meeting_type, '')" },
      location: { label: 'Location', sql: "NULLIF(location, '')" },
      month: { label: 'Month', sql: 'substr(from_date, 1, 7)' },
    },
    metrics: [
      int('meetings', 'Meetings', 'COUNT(*)'),
      int('completed', 'Completed', "COUNT(*) FILTER (WHERE status = 'Completed')"),
      int('cancelled', 'Cancelled / No Show', "COUNT(*) FILTER (WHERE status IN ('Cancelled', 'No Show'))"),
      // ::int because SUM() over a bigint yields numeric, which node-postgres
      // hands back as a string to protect precision it doesn't know it can
      // drop. Every other count here arrives as a number, and a lone string
      // in the metrics would sort and total as text.
      int('participants', 'Participants',
        'COALESCE(SUM((SELECT COUNT(*) FROM meeting_participants p WHERE p.meeting_id = meetings.id)), 0)::int'),
    ],
    sortBy: 'meetings',
  },

  claims: {
    label: 'Claim Report',
    table: 'claims',
    dateCol: 'claim_date',
    dateLabel: 'Claim date',
    scoped: true,
    defaultDim: 'status',
    dims: {
      status: { label: 'Claim Status', sql: "NULLIF(status, '')" },
      type: { label: 'Claim Type', sql: "NULLIF(claim_type, '')" },
      insurer: { label: 'Insurer', sql: "NULLIF(company_name, '')" },
      owner: { label: 'Owner', sql: "NULLIF(owner, '')" },
      department: { label: 'Department', sql: "NULLIF(department, '')" },
      month: { label: 'Month', sql: 'substr(claim_date, 1, 7)' },
    },
    metrics: [
      int('claims', 'Claims', 'COUNT(*)'),
      int('settled', 'Settled', "COUNT(*) FILTER (WHERE status = 'Settled')"),
      money('claim_amount', 'Claimed', 'claim_amount'),
      money('approved_amount', 'Approved', 'approved_amount'),
      money('settlement_amount', 'Settled Amount', 'settlement_amount'),
      money('deduction', 'Deduction', 'deduction'),
      // Turnaround in days, over claims that actually settled. The regex guard
      // keeps a malformed date from erroring the whole report — one bad row
      // shouldn't take the report down with it.
      { key: 'avg_tat', label: 'Avg TAT (days)', kind: 'days',
        sql: `ROUND(AVG(CASE WHEN settlement_date ~ '^\\d{4}-\\d{2}-\\d{2}$' AND claim_date ~ '^\\d{4}-\\d{2}-\\d{2}$'
                             THEN settlement_date::date - claim_date::date END))::int` },
    ],
    sortBy: 'claims',
  },

  leads: {
    label: 'Lead Report',
    table: 'leads',
    dateCol: LEAD_DATE,
    dateLabel: 'Lead date',
    scoped: true,
    defaultDim: 'owner',
    dims: {
      // lead_owner superseded assigned_to; older rows only have the latter.
      owner: { label: 'Lead Owner', sql: "COALESCE(NULLIF(lead_owner, ''), NULLIF(assigned_to, ''))" },
      source: { label: 'Source', sql: "NULLIF(source, '')" },
      status: { label: 'Status', sql: "NULLIF(status, '')" },
      product: { label: 'Product Interest', sql: "NULLIF(product_interest, '')" },
      business: { label: 'Business Type', sql: "NULLIF(expected_business_type, '')" },
      department: { label: 'Department', sql: "NULLIF(department, '')" },
      month: { label: 'Month', sql: `substr(${LEAD_DATE}, 1, 7)` },
    },
    metrics: [
      int('leads', 'Leads', 'COUNT(*)'),
      int('open', 'Open', "COUNT(*) FILTER (WHERE status IN ('New', 'Contacted', 'Follow Up', 'Qualified', 'Proposal Sent'))"),
      int('converted', 'Converted', "COUNT(*) FILTER (WHERE status = 'Converted')"),
      int('lost', 'Lost / Junk', "COUNT(*) FILTER (WHERE status IN ('Lost', 'Junk'))"),
      pct('conversion', 'Conversion', "status = 'Converted'"),
    ],
    sortBy: 'leads',
  },

  rfqs: {
    label: 'RFQ Report',
    table: 'rfqs',
    dateCol: 'created_at',
    dateLabel: 'RFQ date',
    scoped: true,
    defaultDim: 'category',
    dims: {
      category: { label: 'Category', sql: "NULLIF(category, '')" },
      owner: { label: 'Assigned To', sql: "NULLIF(assigned_to, '')" },
      status: { label: 'Status', sql: "NULLIF(status, '')" },
      nature: { label: 'New / Renewal', sql: "NULLIF(policy_nature, '')" },
      priority: { label: 'Priority', sql: "NULLIF(priority, '')" },
      department: { label: 'Department', sql: "NULLIF(department, '')" },
      month: { label: 'Month', sql: 'substr(created_at, 1, 7)' },
    },
    metrics: [
      int('rfqs', 'RFQs', 'COUNT(*)'),
      int('quoted', 'Quoted', `COUNT(*) FILTER (WHERE ${RFQ_QUOTED})`),
      int('won', 'Approved', `COUNT(*) FILTER (WHERE ${RFQ_WON})`),
      int('lost', 'Lost', "COUNT(*) FILTER (WHERE status = 'Lost')"),
      int('paid', 'Paid', "COUNT(*) FILTER (WHERE NULLIF(paid_at, '') IS NOT NULL)"),
      pct('win_rate', 'Win Rate', RFQ_WON),
      money('expected_premium', 'Expected Premium', 'expected_premium'),
    ],
    sortBy: 'rfqs',
  },

  renewals: {
    label: 'Renewal Report',
    table: 'policies',
    where: "renewable = 'Yes'",
    dateCol: 'period_to',
    dateLabel: 'Policy expiry date',
    scoped: true,
    defaultDim: 'status',
    dims: {
      status: { label: 'Renewal Status', sql: "COALESCE(NULLIF(renewal_status, ''), 'Pending')" },
      owner: { label: 'User', sql: "NULLIF(assigned_to, '')" },
      insurer: { label: 'Insurer', sql: "NULLIF(company_name, '')" },
      product: { label: 'Product', sql: "NULLIF(insurance_type, '')" },
      department: { label: 'Department', sql: "NULLIF(department, '')" },
      month: { label: 'Expiry Month', sql: 'substr(period_to, 1, 7)' },
    },
    metrics: [
      int('due', 'Due', 'COUNT(*)'),
      int('renewed', 'Renewed', "COUNT(*) FILTER (WHERE renewal_status = 'Renewed')"),
      int('elsewhere', 'Renewed Elsewhere', "COUNT(*) FILTER (WHERE renewal_status = 'Renewed Elsewhere')"),
      int('lost', 'Lost', "COUNT(*) FILTER (WHERE renewal_status = 'Lost')"),
      int('pending', 'Pending', "COUNT(*) FILTER (WHERE COALESCE(renewal_status, '') NOT IN ('Renewed', 'Renewed Elsewhere', 'Lost'))"),
      pct('retention', 'Retention', "renewal_status = 'Renewed'"),
      money('premium_due', 'Premium Due', 'final_premium'),
      money('premium_retained', 'Premium Retained', "CASE WHEN renewal_status = 'Renewed' THEN final_premium END"),
    ],
    sortBy: 'due',
  },

  tasks: {
    label: 'Task Report',
    table: 'tasks',
    dateCol: 'due_date',
    dateLabel: 'Due date',
    // Tasks carry no department, the same as meetings.
    scoped: false,
    defaultDim: 'owner',
    dims: {
      owner: { label: 'Assigned To', sql: "NULLIF(assigned_to, '')" },
      by: { label: 'Assigned By', sql: "NULLIF(assigned_by, '')" },
      status: { label: 'Status', sql: "NULLIF(status, '')" },
      priority: { label: 'Priority', sql: "NULLIF(priority, '')" },
      type: { label: 'Task Type', sql: "NULLIF(task_type, '')" },
      month: { label: 'Month', sql: 'substr(due_date, 1, 7)' },
    },
    metrics: [
      int('tasks', 'Tasks', 'COUNT(*)'),
      int('done', 'Done', "COUNT(*) FILTER (WHERE status = 'Done')"),
      int('open', 'Open / In Progress', "COUNT(*) FILTER (WHERE status <> 'Done')"),
      int('overdue', 'Overdue', `COUNT(*) FILTER (WHERE ${OVERDUE})`),
      pct('completion', 'Completion', "status = 'Done'"),
    ],
    sortBy: 'tasks',
  },

  clients: {
    label: 'Client Report',
    table: 'clients',
    dateCol: CLIENT_DATE,
    dateLabel: 'Onboarding date',
    scoped: false,
    defaultDim: 'category',
    dims: {
      category: { label: 'Client Category', sql: "NULLIF(client_category, '')" },
      status: { label: 'Client Status', sql: "NULLIF(client_status, '')" },
      owner: { label: 'Owner', sql: "NULLIF(owner, '')" },
      source: { label: 'Lead Source', sql: "NULLIF(lead_source, '')" },
      city: { label: 'City', sql: "NULLIF(city, '')" },
      month: { label: 'Month', sql: `substr(${CLIENT_DATE}, 1, 7)` },
    },
    metrics: [
      int('clients', 'Clients', 'COUNT(*)'),
      int('active', 'Active', "COUNT(*) FILTER (WHERE client_status = 'Active')"),
      int('with_policy', 'With a Policy', 'COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM policies p WHERE p.client_id = clients.id))'),
      // ::int / plain SUM for the same reason as meeting participants above.
      int('policies', 'Policies', 'COALESCE(SUM((SELECT COUNT(*) FROM policies p WHERE p.client_id = clients.id)), 0)::int'),
      money('premium', 'Gross Premium', '(SELECT SUM(final_premium) FROM policies p WHERE p.client_id = clients.id)'),
    ],
    sortBy: 'clients',
  },
};

export const reportSpec = (kind) => REPORTS[kind] || null;
