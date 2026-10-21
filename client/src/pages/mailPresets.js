// Common mail servers, so whoever sets up a mailbox doesn't need the host and port to hand.
export const MAIL_PRESETS = [
  { label: 'Hostinger', host: 'smtp.hostinger.com', port: '465', secure: 'SSL' },
  { label: 'Google Workspace / Gmail', host: 'smtp.gmail.com', port: '587', secure: 'TLS', note: 'Google needs an App Password (Google Account → Security → App passwords), not the normal password.' },
  { label: 'Microsoft 365 / Outlook', host: 'smtp.office365.com', port: '587', secure: 'TLS', note: 'The mailbox needs "Authenticated SMTP" switched on in Microsoft 365, and an app password if it uses multi-factor sign-in.' },
];
export const presetOf = (host) => MAIL_PRESETS.find((p) => p.host === (host || '').trim().toLowerCase())?.label || 'Custom';
