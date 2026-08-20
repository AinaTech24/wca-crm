export const TASK_TYPES = ['Call', 'Email', 'Follow-up', 'Site Visit', 'Documentation',
  'Payment Collection', 'Policy Issuance', 'Claim Follow-up', 'Renewal Reminder', 'Other'];

export const TASK_STATUSES = ['Not Started', 'In Progress', 'Waiting', 'Deferred', 'Completed', 'Cancelled'];
export const TASK_STATUS_BADGE = {
  'Not Started': 'blue', 'In Progress': 'orange', Waiting: 'orange',
  Deferred: '', Completed: 'green', Cancelled: 'red',
};
export const TASK_DONE = ['Completed', 'Cancelled'];

export const TASK_PRIORITIES = ['Low', 'Medium', 'High'];

// "Task For" — the record the task is about.
export const TASK_RELATED_KINDS = [
  { key: 'client', label: 'Client', icon: 'user' },
  { key: 'lead', label: 'Lead', icon: 'target' },
];

// Reminder lead times, in days before the due date. Fires at 09:00 that day.
export const TASK_REMINDERS = [
  { v: '', label: 'No reminder' },
  { v: 0, label: 'On the due date' },
  { v: 1, label: '1 day before' },
  { v: 2, label: '2 days before' },
  { v: 3, label: '3 days before' },
  { v: 7, label: '1 week before' },
];
export const reminderLabel = (d) =>
  (d === null || d === undefined || d === '' ? 'No reminder'
    : TASK_REMINDERS.find((r) => r.v === Number(d))?.label || `${d} days before`);

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const emptyTask = () => ({
  title: '', task_type: '', start_date: todayISO(), due_date: addDays(todayISO(), 1),
  assigned_by: '', assigned_to: '',
  related_kind: '', related_id: null, related_name: '',
  status: 'Not Started', priority: 'Medium', remarks: '', reminder_days: 1,
});

// Plain string compare — "YYYY-MM-DD" sorts correctly and can't be thrown
// off by timezone parsing the way Date construction can.
export const isTaskRangeValid = (start, due) => !start || !due || due >= start;
