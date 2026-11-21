// Each page is its own download, fetched the first time it is opened — the CRM starts faster, and a page
// nobody opens (Reports, Attendance…) never costs anything. The spreadsheet library goes with the pages that use it.
import { lazy, Suspense } from 'react';
const ClientMaster = lazy(() => import('./pages/ClientMaster.jsx'));
const Claims = lazy(() => import('./pages/Claims.jsx'));
const FavouriteLinks = lazy(() => import('./pages/FavouriteLinks.jsx'));
const DashboardPreference = lazy(() => import('./pages/DashboardPreference.jsx'));
const Help = lazy(() => import('./pages/Help.jsx'));
const Rfq = lazy(() => import('./pages/Rfq.jsx'));
const Quotations = lazy(() => import('./pages/Quotations.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Timeline = lazy(() => import('./pages/Timeline.jsx'));
const EmailSetup = lazy(() => import('./pages/EmailSetup.jsx'));
const Leads = lazy(() => import('./pages/Leads.jsx'));
const Meetings = lazy(() => import('./pages/Meetings.jsx'));
const Tasks = lazy(() => import('./pages/Tasks.jsx'));
const Attendance = lazy(() => import('./pages/Attendance.jsx'));
const Policies = lazy(() => import('./pages/Policies.jsx'));
const Team = lazy(() => import('./pages/Team.jsx'));
const EmailTemplates = lazy(() => import('./pages/EmailTemplates.jsx'));
const ClientJourney = lazy(() => import('./pages/ClientJourney.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Commissions = lazy(() => import('./pages/Commissions.jsx'));
const MyProfile = lazy(() => import('./pages/MyProfile.jsx'));
const ChangePassword = lazy(() => import('./pages/ChangePassword.jsx'));
const page = (C) => <Suspense fallback={<div className="page-loading">Loading…</div>}><C /></Suspense>;

export function resolvePage(slug) {
  if (slug === 'client-master') return page(ClientMaster);
  if (slug === 'claim') return page(Claims);
  if (slug === 'favourite-links') return page(FavouriteLinks);
  if (slug === 'dashboard-preference-master') return page(DashboardPreference);
  if (slug === 'rfq') return page(Rfq);
  if (slug === 'quotation') return page(Quotations);
  if (slug === 'settings') return page(Settings);
  if (slug === 'timeline') return page(Timeline);
  if (slug === 'email-setup') return page(EmailSetup);
  if (slug === 'lead') return page(Leads);
  if (slug === 'meeting') return page(Meetings);
  if (slug === 'task') return page(Tasks);
  if (slug === 'attendance') return page(Attendance);
  if (slug === 'policy') return page(Policies);
  if (slug === 'team') return page(Team);
  if (slug === 'email-templates') return page(EmailTemplates);
  if (slug === 'client-journey') return page(ClientJourney);
  if (slug === 'reports') return page(Reports);
  if (slug === 'commissions') return page(Commissions);
  if (slug === 'my-profile') return page(MyProfile);
  if (slug === 'change-password') return page(ChangePassword);
  if (slug === 'help') return page(Help);

  return null;
}
