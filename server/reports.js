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

// Dates are stored as TEXT. NULLIF guards rows where the column is '' —
// casting '' to ::date errors in Postgres, the same trap the dashboard hit.
export const dateFilter = (col) => `NULLIF(${col}, '')::date BETWEEN ?::date AND ?::date`;

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
};

export const reportSpec = (kind) => REPORTS[kind] || null;
