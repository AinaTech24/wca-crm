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

// `cond` is the condition a metric counts (COUNT(*) FILTER (WHERE …), SUM(CASE WHEN … THEN …)), read
// off its own SQL here. Clicking that number lists only the records meeting it — the 12 Lost, not
// every RFQ in the group. A metric without one (a plain count or sum) lists the whole group.
const condOf = (sql) => (/^COUNT\(\*\) FILTER \(WHERE ([\s\S]+)\)$/.exec(sql) || /^CASE WHEN ([\s\S]+) THEN \w+ END$/.exec(sql) || [])[1] || null;
const money = (key, label, col) => ({ key, label, kind: 'money', sql: `COALESCE(SUM(${col}), 0)`, cond: condOf(col) });
const int = (key, label, sql) => ({ key, label, kind: 'int', sql, cond: condOf(sql) });
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
// A group's slice of the premium in the whole report. In the totals query (no
// GROUP BY) the window runs over the single row, so the total reads 100%.
const share = (key, label, col) => ({ key, label, kind: 'share',
  sql: `ROUND(100.0 * COALESCE(SUM(${col}), 0) / NULLIF(SUM(SUM(${col})) OVER (), 0))::int` });

// New Business and Renewal Business are the same report over a different slice
// of the policies, so they share one definition.
const businessReport = (label, type) => ({
  label,
  table: 'policies',
  where: `business_type = '${type}'`,
  dateCol: 'period_from',
  dateLabel: 'Policy start date',
  scoped: true,
  defaultDim: 'product',
  dims: {
    product: { label: 'Product', sql: "NULLIF(insurance_type, '')" },
    plan: { label: 'Plan', sql: "COALESCE(NULLIF(product_name, ''), NULLIF(insurance_type, ''))" },
    insurer: { label: 'Insurer', sql: "NULLIF(company_name, '')" },
    owner: { label: 'User', sql: "NULLIF(assigned_to, '')" },
    department: { label: 'Department', sql: "NULLIF(department, '')" },
    month: { label: 'Month', sql: 'substr(period_from, 1, 7)' },
  },
  metrics: [
    int('policies', 'Policies', 'COUNT(*)'),
    money('net_premium', 'Net Premium', 'net_premium'),
    money('gst_amount', 'GST', 'gst_amount'),
    money('final_premium', 'Gross Premium', 'final_premium'),
    share('premium_share', 'Share of Premium', 'final_premium'),
    { key: 'avg_premium', label: 'Avg Premium', kind: 'money', sql: 'ROUND(AVG(NULLIF(final_premium, 0)))::bigint' },
    money('sum_assured', 'Sum Assured', 'sum_assured'),
  ],
  sortBy: 'final_premium',
});

// Attendance: the office start time and grace period as set on the Attendance page, and a day's worked seconds.
const OFFICE_START = "(SELECT COALESCE(MAX(value) FILTER (WHERE key = 'attendance_office_start'), '09:30') FROM app_settings)";
const GRACE_MIN = "(SELECT COALESCE(MAX(value) FILTER (WHERE key = 'attendance_grace_minutes'), '15') FROM app_settings)::int";
const WORKED = "CASE WHEN check_in IS NOT NULL AND check_out IS NOT NULL THEN EXTRACT(EPOCH FROM (check_out::timestamp - check_in::timestamp)) END";

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
        status: { label: 'Policy Status', sql: "NULLIF(policy_status, '')" },
      business: { label: 'New / Renewal', sql: "CASE business_type WHEN 'New' THEN 'New Business' WHEN 'Renewal' THEN 'Renewal Business' END" },
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

  'new-business': businessReport('New Business Report', 'New'),
  'renewal-business': businessReport('Renewal Business Report', 'Renewal'),

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
    // The stages a lead moves through, in order, for the funnel chart (grouped by the status dimension).
    funnel: ['New', 'Contacted', 'Follow Up', 'Qualified', 'Proposal Sent', 'Converted'],
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
    funnel: ['Draft', 'Sent', 'Quotes Received', 'Quoted', 'Approved by Customer', 'Proposal Requested', 'Closed'],
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

  quotations: {
    label: 'Quotation Report',
    table: 'quotations',
    where: "status <> 'Superseded'",
    funnel: ['Draft', 'Shared', 'Approved', 'Converted'],
    dateCol: 'created_at',
    dateLabel: 'Quotation date',
    scoped: true,
    defaultDim: 'status',
    dims: {
      status: { label: 'Status', sql: "NULLIF(status, '')" },
      owner: { label: 'User', sql: "NULLIF(assigned_to, '')" },
      product: { label: 'Product', sql: "COALESCE(NULLIF(category, ''), NULLIF(product, ''))" },
      insurer: { label: 'Insurer chosen by client', sql: "NULLIF(approved_insurer, '')" },
      recommended: { label: 'Insurer we recommended', sql: "NULLIF(selected_insurer, '')" },
      source: { label: 'From RFQ / Direct', sql: "CASE WHEN rfq_id IS NULL THEN 'Direct' ELSE 'From RFQ' END" },
      reason: { label: 'Reason rejected', sql: "CASE WHEN status = 'Rejected' THEN COALESCE(NULLIF(TRIM(reject_reason), ''), 'No reason given') END" },
      department: { label: 'Department', sql: "NULLIF(department, '')" },
      month: { label: 'Month', sql: 'substr(created_at, 1, 7)' },
    },
    metrics: [
      int('quotations', 'Quotations', 'COUNT(*)'),
      int('shared', 'Shared', "COUNT(*) FILTER (WHERE NULLIF(shared_at, '') IS NOT NULL)"),
      int('approved', 'Approved', "COUNT(*) FILTER (WHERE status IN ('Approved', 'Converted'))"),
      int('converted', 'Converted to policy', "COUNT(*) FILTER (WHERE status = 'Converted')"),
      int('rejected', 'Rejected', "COUNT(*) FILTER (WHERE status = 'Rejected')"),
      int('expired', 'Expired', "COUNT(*) FILTER (WHERE status = 'Expired')"),
      pct('conversion', 'Quote to Policy', "status = 'Converted'"),
      money('offered', 'Premium offered', 'selected_premium'),
      money('won_premium', 'Premium approved', "CASE WHEN status IN ('Approved', 'Converted') THEN approved_premium END"),
      { key: 'days_to_decide', label: 'Avg days to decision', kind: 'int',
        sql: "ROUND(AVG(CASE WHEN decided_at ~ '^\\d{4}-\\d{2}-\\d{2}' AND created_at ~ '^\\d{4}-\\d{2}-\\d{2}' THEN substr(decided_at, 1, 10)::date - substr(created_at, 1, 10)::date END))::int" },
    ],
    sortBy: 'quotations',
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
      day: { label: 'Expiry Date', sql: 'substr(period_to, 1, 10)' },
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
  commissions: {
    label: 'Commission Report',
    table: 'commissions',
    dateCol: 'entry_date',
    dateLabel: 'Date entered',
    scoped: true,
    defaultDim: 'insurer',
    dims: {
      insurer: { label: 'Insurer', sql: "NULLIF(company_name, '')" },
      type: { label: 'Payin / Payout', sql: "CASE kind WHEN 'payin' THEN 'Payin' WHEN 'payout' THEN 'Payout' END" },
      party: { label: 'From / To', sql: "NULLIF(party, '')" },
      status: { label: 'Status', sql: "NULLIF(status, '')" },
      product: { label: 'Product', sql: '(SELECT NULLIF(p.insurance_type, \'\') FROM policies p WHERE p.id = commissions.policy_id)' },
      owner: { label: 'User', sql: '(SELECT NULLIF(p.assigned_to, \'\') FROM policies p WHERE p.id = commissions.policy_id)' },
      month: { label: 'Month', sql: 'substr(entry_date, 1, 7)' },
    },
    metrics: [
      int('entries', 'Entries', 'COUNT(*)'),
      money('payin', 'Payin', "CASE WHEN kind = 'payin' AND status <> 'Cancelled' THEN amount END"),
      money('payin_received', 'Payin Received', "CASE WHEN kind = 'payin' AND status = 'Received' THEN amount END"),
      money('payin_due', 'Payin Outstanding', "CASE WHEN kind = 'payin' AND status = 'Pending' THEN amount END"),
      money('payout', 'Payout', "CASE WHEN kind = 'payout' AND status <> 'Cancelled' THEN amount END"),
      money('payout_paid', 'Payout Paid', "CASE WHEN kind = 'payout' AND status = 'Paid' THEN amount END"),
      { key: 'net', label: 'Net Commission', kind: 'money', sql: "COALESCE(SUM(CASE WHEN status <> 'Cancelled' THEN CASE WHEN kind = 'payin' THEN amount ELSE -amount END END), 0)" },
      int('overdue', 'Overdue', "COUNT(*) FILTER (WHERE status = 'Pending' AND due_date ~ '^\\d{4}-\\d{2}-\\d{2}$' AND due_date < to_char(now(), 'YYYY-MM-DD'))"),
    ],
    sortBy: 'payin',
  },

  'insurer-response': {
    label: 'Insurer Response Report',
    table: 'insurer_quotes',
    dateCol: 'created_at',
    dateLabel: 'RFQ date',
    scoped: true,
    defaultDim: 'insurer',
    dims: {
      insurer: { label: 'Insurer', sql: "NULLIF(insurer, '')" },
      category: { label: 'Category', sql: "NULLIF(category, '')" },
      status: { label: 'Reply', sql: "NULLIF(quote_status, '')" },
      owner: { label: 'Assigned To', sql: "NULLIF(assigned_to, '')" },
      month: { label: 'Month', sql: 'substr(created_at, 1, 7)' },
    },
    metrics: [
      int('asked', 'Asked', 'COUNT(*)'),
      int('quoted', 'Quoted', "COUNT(*) FILTER (WHERE premium IS NOT NULL OR quote_status = 'Quoted')"),
      int('declined', 'Declined', "COUNT(*) FILTER (WHERE quote_status = 'Declined')"),
      int('awaited', 'No reply', "COUNT(*) FILTER (WHERE quote_status = 'Awaited' AND premium IS NULL)"),
      int('won', 'Chosen by client', 'COUNT(*) FILTER (WHERE approved)'),
      { key: 'response_rate', label: 'Reply rate', kind: 'pct', sql: "ROUND(100.0 * COUNT(*) FILTER (WHERE quote_status IN ('Quoted', 'Declined') OR premium IS NOT NULL) / NULLIF(COUNT(*), 0))::int" },
      { key: 'win_rate', label: 'Win rate', kind: 'pct', sql: "ROUND(100.0 * COUNT(*) FILTER (WHERE approved) / NULLIF(COUNT(*) FILTER (WHERE premium IS NOT NULL OR quote_status = 'Quoted'), 0))::int" },
      { key: 'avg_hours', label: 'Avg reply time', kind: 'hours', sql: 'ROUND(AVG(response_hours), 1)::float8' },
      { key: 'avg_premium', label: 'Avg premium quoted', kind: 'money', sql: 'ROUND(AVG(premium))::bigint' },
    ],
    sortBy: 'asked',
  },

  'lost-business': {
    label: 'Lost Business Report',
    table: 'lost_business',
    dateCol: 'lost_date',
    dateLabel: 'Date lost (renewals: expiry date)',
    scoped: true,
    defaultDim: 'reason',
    dims: {
      reason: { label: 'Reason', sql: "NULLIF(reason, '')" },
      kind: { label: 'RFQ / Renewal', sql: 'kind' },
      owner: { label: 'User', sql: "NULLIF(owner, '')" },
      product: { label: 'Product', sql: "NULLIF(product, '')" },
      insurer: { label: 'Insurer (renewals)', sql: "NULLIF(insurer, '')" },
      month: { label: 'Month', sql: 'substr(lost_date, 1, 7)' },
    },
    metrics: [
      int('lost', 'Lost', 'COUNT(*)'),
      int('rfqs', 'RFQs lost', "COUNT(*) FILTER (WHERE kind = 'RFQ')"),
      int('renewals', 'Renewals lost', "COUNT(*) FILTER (WHERE kind = 'Renewal')"),
      money('premium', 'Premium lost', 'premium'),
      share('premium_share', 'Share of premium lost', 'premium'),
    ],
    sortBy: 'lost',
  },

  attendance: {
    label: 'Attendance Report',
    table: 'attendance',
    dateCol: 'work_date',
    dateLabel: 'Date',
    scoped: false,
    adminOnly: true,
    defaultDim: 'person',
    dims: {
      person: { label: 'Person', sql: "(SELECT COALESCE(NULLIF(u.full_name, ''), u.username) FROM users u WHERE u.id = attendance.user_id)" },
      department: { label: 'Department', sql: '(SELECT NULLIF(u.department, \'\') FROM users u WHERE u.id = attendance.user_id)' },
      status: { label: 'Status', sql: "NULLIF(status, '')" },
      weekday: { label: 'Day of week', sql: "to_char(work_date::date, 'Dy')" },
      month: { label: 'Month', sql: 'substr(work_date, 1, 7)' },
    },
    metrics: [
      int('days', 'Days recorded', 'COUNT(*)'),
      int('present', 'Present', "COUNT(*) FILTER (WHERE status = 'Present' AND check_in IS NOT NULL)"),
      int('late', 'Late', `COUNT(*) FILTER (WHERE status = 'Present' AND check_in IS NOT NULL AND substr(check_in, 12, 5)::time > (${OFFICE_START}::time + make_interval(mins => ${GRACE_MIN})))`),
      int('leave', 'Leave', "COUNT(*) FILTER (WHERE status = 'Leave')"),
      int('absent', 'Absent', "COUNT(*) FILTER (WHERE status = 'Absent')"),
      int('holiday', 'Holiday', "COUNT(*) FILTER (WHERE status = 'Holiday')"),
      { key: 'hours', label: 'Hours worked', kind: 'hours', sql: `ROUND((COALESCE(SUM(${WORKED}), 0) / 3600.0)::numeric, 1)::float8` },
      { key: 'avg_hours', label: 'Avg hours a day', kind: 'hours', sql: `ROUND((AVG(${WORKED}) / 3600.0)::numeric, 1)::float8` },
    ],
    sortBy: 'days',
  },

  leave: {
    label: 'Leave Report',
    table: 'leave_requests',
    dateCol: 'from_date',
    dateLabel: 'Leave start',
    scoped: false,
    adminOnly: true,
    defaultDim: 'person',
    dims: {
      person: { label: 'Person', sql: "(SELECT COALESCE(NULLIF(u.full_name, ''), u.username) FROM users u WHERE u.id = leave_requests.user_id)" },
      type: { label: 'Type of leave', sql: "NULLIF(leave_type, '')" },
      status: { label: 'Status', sql: "NULLIF(status, '')" },
      month: { label: 'Month', sql: 'substr(from_date, 1, 7)' },
    },
    metrics: [
      int('requests', 'Requests', 'COUNT(*)'),
      { key: 'days', label: 'Days asked', kind: 'int', sql: 'COALESCE(SUM(days), 0)::float8' },
      { key: 'approved_days', label: 'Days approved', kind: 'int', sql: "COALESCE(SUM(days) FILTER (WHERE status = 'Approved'), 0)::float8", cond: "status = 'Approved'" },
      int('pending', 'Waiting', "COUNT(*) FILTER (WHERE status = 'Pending')"),
      int('rejected', 'Rejected', "COUNT(*) FILTER (WHERE status = 'Rejected')"),
    ],
    sortBy: 'requests',
  },
};

export const reportSpec = (kind) => REPORTS[kind] || null;

// ---- drill-down: the records behind a number ----
// Clicking a row, bar or card in a report lists the records it counted. Each table says which
// columns that list shows and which page opens one record (as /page/…?open=<id>).
// [key, label, sql, kind]; kind 'money' | 'date' | '' — and, as with dims, only ever reached by key.
const f = (key, label, sql = key, kind = '') => ({ key, label, sql, kind });
const POLICY_FIELDS = [
  f('insured_name', 'Policy Holder'), f('policy_number', 'Policy No'), f('insurance_type', 'Product'),
  f('company_name', 'Insurer'), f('period_from', 'Start', 'period_from', 'date'), f('period_to', 'Expiry', 'period_to', 'date'),
  f('final_premium', 'Gross Premium', 'final_premium', 'money'), f('assigned_to', 'User'),
];
const RECORDS = {
  policies: { page: '/page/policy', order: 'period_from DESC NULLS LAST', fields: POLICY_FIELDS },
  renewals: { page: '/page/policy', order: 'period_to ASC NULLS LAST',
    fields: [...POLICY_FIELDS, f('renewal_status', 'Renewal Status', "COALESCE(NULLIF(renewal_status, ''), 'Pending')")] },
  meetings: { page: '/page/meeting', order: 'from_date DESC NULLS LAST', fields: [
    f('title', 'Meeting'), f('from_date', 'Date', 'from_date', 'date'), f('owner', 'Owner'), f('meeting_type', 'Type'),
    f('location', 'Location'), f('status', 'Status')] },
  claims: { page: '/page/claim', order: 'claim_date DESC NULLS LAST', fields: [
    f('claim_no', 'Claim No'), f('client_name', 'Client'), f('claim_type', 'Type'), f('company_name', 'Insurer'),
    f('claim_date', 'Claim Date', 'claim_date', 'date'), f('status', 'Status'),
    f('claim_amount', 'Claimed', 'claim_amount', 'money'), f('settlement_amount', 'Settled', 'settlement_amount', 'money')] },
  leads: { page: '/page/lead', order: `${LEAD_DATE} DESC NULLS LAST`, fields: [
    f('lead_name', 'Lead'), f('lead_date', 'Lead Date', LEAD_DATE, 'date'),
    f('owner', 'Owner', "COALESCE(NULLIF(lead_owner, ''), NULLIF(assigned_to, ''))"), f('source', 'Source'),
    f('product_interest', 'Product'), f('status', 'Status'), f('mobile', 'Mobile')] },
  rfqs: { page: '/page/rfq', order: 'created_at DESC NULLS LAST', fields: [
    f('rfq_no', 'RFQ No'), f('client_name', 'Client'), f('category', 'Category'), f('product', 'Product / Risk'),
    f('created_at', 'Raised', 'created_at', 'date'), f('status', 'Status'), f('assigned_to', 'Assigned To'),
    f('expected_premium', 'Expected Premium', 'expected_premium', 'money')] },
  tasks: { page: '/page/task', order: 'due_date ASC NULLS LAST', fields: [
    f('title', 'Task'), f('assigned_to', 'Assigned To'), f('due_date', 'Due', 'due_date', 'date'),
    f('status', 'Status'), f('priority', 'Priority'), f('task_type', 'Type')] },
  clients: { page: '/page/client-master', order: `${CLIENT_DATE} DESC NULLS LAST`, fields: [
    f('client_name', 'Client'), f('client_category', 'Category'), f('client_status', 'Status'), f('owner', 'Owner'),
    f('city', 'City'), f('onboarded', 'Onboarded', CLIENT_DATE, 'date'), f('mobile', 'Mobile')] },
  commissions: { page: '/page/commissions', order: 'entry_date DESC NULLS LAST', fields: [
    f('kind', 'Type', "CASE kind WHEN 'payin' THEN 'Payin' ELSE 'Payout' END"), f('policy_number', 'Policy No'), f('insured_name', 'Holder'),
    f('company_name', 'Insurer'), f('party', 'From / To'), f('rate', 'Rate %'), f('amount', 'Amount', 'amount', 'money'),
    f('status', 'Status'), f('due_date', 'Due', 'due_date', 'date'), f('settled_date', 'Settled', 'settled_date', 'date')] },
  insurer_quotes: { page: '/page/rfq', order: 'created_at DESC NULLS LAST', fields: [
    f('rfq_no', 'RFQ No'), f('client_name', 'Client'), f('category', 'Category'), f('insurer', 'Insurer'), f('quote_status', 'Reply'),
    f('premium', 'Premium', 'premium', 'money'), f('approved', 'Chosen', "CASE WHEN approved THEN 'Yes' ELSE '' END"),
    f('response_hours', 'Reply time (hrs)', 'response_hours'), f('created_at', 'RFQ date', 'created_at', 'date')] },
  quotations: { page: '/page/quotation', order: 'created_at DESC NULLS LAST', fields: [
    f('quote_no', 'Quotation No', "quote_no || CASE WHEN version > 1 THEN ' v' || version ELSE '' END"), f('client_name', 'Client'),
    f('product', 'Product', "COALESCE(NULLIF(category, ''), product)"), f('selected_insurer', 'Recommended'), f('selected_premium', 'Premium', 'selected_premium', 'money'),
    f('status', 'Status'), f('approved_insurer', 'Client chose'), f('valid_till', 'Valid till', 'valid_till', 'date'),
    f('assigned_to', 'User'), f('created_at', 'Created', 'created_at', 'date')] },
  lost_business: { page: '/page/rfq', pageBy: { col: 'kind', map: { RFQ: '/page/rfq', Renewal: '/page/policy', Quotation: '/page/quotation' } }, order: 'lost_date DESC NULLS LAST', fields: [
    f('kind', 'Type'), f('ref', 'RFQ / Policy No'), f('client_name', 'Client'), f('product', 'Product'), f('reason', 'Reason'),
    f('owner', 'User'), f('insurer', 'Insurer'), f('premium', 'Premium', 'premium', 'money'), f('lost_date', 'Date', 'lost_date', 'date')] },
  attendance: { page: '/page/attendance', order: 'work_date DESC', fields: [
    f('work_date', 'Date', 'work_date', 'date'), f('person', 'Person', "(SELECT COALESCE(NULLIF(u.full_name, ''), u.username) FROM users u WHERE u.id = attendance.user_id)"),
    f('status', 'Status'), f('check_in', 'In', 'substr(check_in, 12, 5)'), f('check_out', 'Out', 'substr(check_out, 12, 5)'),
    f('in_address', 'Check-in location'), f('note', 'Note')] },
  leave_requests: { page: '/page/attendance', order: 'from_date DESC', fields: [
    f('person', 'Person', "(SELECT COALESCE(NULLIF(u.full_name, ''), u.username) FROM users u WHERE u.id = leave_requests.user_id)"),
    f('from_date', 'From', 'from_date', 'date'), f('to_date', 'To', 'to_date', 'date'), f('leave_type', 'Type'), f('days', 'Days'),
    f('status', 'Status'), f('reason', 'Reason'), f('decided_by', 'Decided by')] },
};
/** How a report's records are listed: the renewal report has its own columns, the rest go by table. */
export const recordView = (kind) => (kind === 'renewals' ? RECORDS.renewals : RECORDS[REPORTS[kind]?.table] || null);
