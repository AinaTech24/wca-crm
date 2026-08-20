export const MEETING_TYPES = ['New', 'Existing'];

export const MEETING_STATUSES = ['Scheduled', 'Rescheduled', 'In Progress', 'Completed', 'Cancelled', 'No Show'];
export const MEETING_STATUS_BADGE = {
  Scheduled: 'blue', Rescheduled: 'orange', 'In Progress': 'orange',
  Completed: 'green', Cancelled: 'red', 'No Show': 'red',
};
// Minutes of meeting are only captured (and only shown) once it's done.
export const COMPLETED_STATUS = 'Completed';

export const PARTICIPANT_KINDS = [
  { key: 'client', label: 'Client', icon: 'user' },
  { key: 'lead', label: 'Lead', icon: 'target' },
  { key: 'user', label: 'User', icon: 'users' },
];

// Lead times offered for reminders, in minutes before the start.
export const REMINDER_OFFSETS = [
  { v: 0, label: 'At start time' },
  { v: 5, label: '5 minutes before' },
  { v: 15, label: '15 minutes before' },
  { v: 30, label: '30 minutes before' },
  { v: 60, label: '1 hour before' },
  { v: 120, label: '2 hours before' },
  { v: 1440, label: '1 day before' },
  { v: 2880, label: '2 days before' },
  { v: 10080, label: '1 week before' },
];
export const offsetLabel = (m) => REMINDER_OFFSETS.find((o) => o.v === Number(m))?.label || `${m} minutes before`;

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const roundedNow = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() + (30 - (d.getMinutes() % 30)), 0, 0);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const plusHour = (t) => {
  const [h, m] = (t || '00:00').split(':').map(Number);
  return `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export const emptyMeeting = () => {
  const from = roundedNow();
  return {
    title: '', meeting_type: 'New', location: '',
    from_date: todayISO(), from_time: from,
    to_date: todayISO(), to_time: plusHour(from),
    owner: '', notify_participants: 1, status: 'Scheduled', minutes: '',
    participants: [], reminders: [15],
  };
};

// Compares "YYYY-MM-DD" + "HH:MM" pairs without constructing Dates, so it
// can't be thrown off by timezone parsing.
export const isRangeValid = (fd, ft, td, tt) => {
  if (!fd || !td) return true;
  return `${td} ${tt || '00:00'}` >= `${fd} ${ft || '00:00'}`;
};
