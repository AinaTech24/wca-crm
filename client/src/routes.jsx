import ClientMaster from './pages/ClientMaster.jsx';
import PolicyPurchase from './pages/PolicyPurchase.jsx';
import Claims from './pages/Claims.jsx';
import Leads from './pages/Leads.jsx';
import AgencyMaster from './pages/AgencyMaster.jsx';
import SimpleMaster from './pages/SimpleMaster.jsx';
import Endorsement from './pages/Endorsement.jsx';
import CommissionList from './pages/CommissionList.jsx';
import TaskManagement from './pages/TaskManagement.jsx';
import RenewalView from './pages/RenewalView.jsx';
import LeadFollowup from './pages/LeadFollowup.jsx';
import ReportView from './pages/ReportView.jsx';
import EventList from './pages/EventList.jsx';
import MyProfile from './pages/MyProfile.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import EventCalendar from './pages/EventCalendar.jsx';
import FDTransaction from './pages/FDTransaction.jsx';
import ClaimIntimationMaster from './pages/ClaimIntimationMaster.jsx';
import MailTemplate from './pages/MailTemplate.jsx';
import RenewalSender from './pages/RenewalSender.jsx';
import SchedulerReminder from './pages/SchedulerReminder.jsx';
import FavouriteLinks from './pages/FavouriteLinks.jsx';
import DashboardPreference from './pages/DashboardPreference.jsx';
import ExcelUpload from './pages/ExcelUpload.jsx';
import MergingClient from './pages/MergingClient.jsx';
import FupUpdate from './pages/FupUpdate.jsx';
import AssignReassign from './pages/AssignReassign.jsx';
import CrossSellUpSell from './pages/CrossSellUpSell.jsx';
import ClientAppUsers from './pages/ClientAppUsers.jsx';
import SendAppCredentials from './pages/SendAppCredentials.jsx';
import ContentManager from './pages/ContentManager.jsx';
import Help from './pages/Help.jsx';
import RenewalManager from './pages/RenewalManager.jsx';
import Quotations from './pages/Quotations.jsx';
import Rfq from './pages/Rfq.jsx';
import ClientJourney from './pages/ClientJourney.jsx';

// Simple lookup masters — one generic component, many routes.
const SIMPLE_MASTERS = {
  'make': ['make', 'Make Details', 'Make Name'],
  'model': ['model', 'Model Details', 'Model Name'],
  'risk-type': ['risk-type', 'Risk Type', 'Risk Type'],
  'occupancy': ['occupancy', 'Occupancy', 'Occupancy'],
  'add-on-master': ['add-on-master', 'Add On Master', 'Add On Name'],
  'content-master': ['content-master', 'Content Master', 'Content Type'],
  'hpa': ['hpa', 'HPA Master', 'HPA / Financier'],
  'product-master': ['product-master', 'Product Master', 'Product Name'],
  'fd-scheme-master': ['fd-scheme-master', 'FD Scheme Master', 'Scheme Name'],
};

// Report slugs -> { title, source, line, kind }
const R = (title, source = 'policies', line = '', kind = '') => ({ title, source, line, kind });
const REPORTS = {
  // Office Reports — General Insurance
  'insurance-policy-register': R('Policy Register Report', 'policies', 'GI'),
  'insurance-due-report': R('Insurance Due Report', 'policies', 'GI'),
  'lapse-policy-report': R('Lapse Policy Report', 'policies', 'GI'),
  'business-register': R('Business Register', 'policies', 'GI'),
  'policy-endo-business-register': R('Policy / Endo Business Register', 'policies', 'GI'),
  'new-renew-business-report': R('New / Renew Business Report', 'policies', 'GI'),
  'pending-proposal': R('Pending Proposal Report', 'policies', 'GI'),
  'decline-cancel': R('Decline / Cancel Report', 'policies', 'GI'),
  'renewal-summary': R('Renewal Summary', 'policies', 'GI'),
  'general-premium-calendar': R('General Premium Calendar', 'policies', 'GI'),
  'claim-report': R('Claim Report', 'claims'),
  'endorsement-report': R('Endorsement Report', 'endorsements'),
  'client-address-label': R('Client Address Label', 'clients'),
  'renewal-letter': R('Renewal Letter', 'policies', 'GI'),
  'renewal-letter-groupwise': R('Renewal Letter (Group Wise)', 'policies', 'GI'),
  'gi-client-portfolio': R('Client Portfolio (GI)', 'policies', 'GI'),
  // Office Reports — Life Insurance
  'li-policy-register': R('Policy Register (Life)', 'policies', 'LI'),
  'li-renewal-report': R('Renewal Report (Life)', 'policies', 'LI'),
  'li-transaction-report': R('Transaction Report (Life)', 'policies', 'LI'),
  'li-client-portfolio': R('Client Portfolio (Life)', 'policies', 'LI'),
  'li-premium-calendar': R('Premium Calendar (Life)', 'policies', 'LI'),
  'li-client-cash-flow': R('Client Cash Flow (Life)', 'policies', 'LI'),
  'policy-status-wise-report': R('Policy Status Wise Report', 'policies', 'LI'),
  'survival-benefit-report': R('Survival Benefit Report', 'policies', 'LI'),
  'li-lapse-report': R('Lapse Report (Life)', 'policies', 'LI'),
  // Office Reports — Fixed Deposit
  'fd-report': R('FD Report', 'fd'),
  'fd-interest-payout': R('FD Interest Payout', 'fd'),
  'fd-client-portfolio': R('FD Client Portfolio', 'fd'),
  'fd-client-cash-flow': R('FD Client Cash Flow', 'fd'),
  // Business MIS — General Insurance
  'vehicle-policy-register': R('Vehicle Policy Register', 'policies', 'GI'),
  'company-wise': R('Company Wise Report', 'policies', 'GI'),
  'city-wise': R('City Wise Report', 'policies', 'GI'),
  'area-wise': R('Area Wise Report', 'policies', 'GI'),
  'product-type': R('Product Type Report', 'policies', 'GI'),
  'ba-list': R('BA List', 'agencies'),
  'ba-department-wise-report': R('BA Department Wise Report', 'agencies'),
  'new-client': R('New Client Report', 'clients'),
  'client-credit-debit': R('Client Credit / Debit', 'commissions'),
  'commission-payin-report': R('Commission Payin Report', 'commissions', '', 'payin'),
  'commission-payout-report': R('Commission Payout Report', 'commissions', '', 'payout'),
  'payin-reconciliation': R('Payin Reconciliation', 'commissions', '', 'payin'),
  'payout-reconciliation': R('Payout Reconciliation', 'commissions', '', 'payout'),
  'policy-history-report': R('Policy History Report', 'policies', 'GI'),
  'health-check-up-report': R('Health Check Up Report', 'policies', 'GI'),
  'top-clients-report': R('Top Clients Report', 'clients'),
  // Business MIS — Life Insurance
  'company-product-wise-report': R('Company / Product Wise Report', 'policies', 'LI'),
  'li-city-wise-report': R('City Wise Report (Life)', 'policies', 'LI'),
  'li-area-wise-report': R('Area Wise Report (Life)', 'policies', 'LI'),
  'paid-up-report': R('Paid Up Report', 'policies', 'LI'),
  'maturity-report': R('Maturity Report', 'policies', 'LI'),
  'surrender-report': R('Surrender Report', 'policies', 'LI'),
  'minor-to-major-report': R('Minor To Major Report', 'policies', 'LI'),
  'death-claim-report': R('Death Claim Report', 'claims'),
  'record-only-report': R('Record Only Report', 'policies', 'LI'),
  // Combined
  'combined-client-portfolio': R('Combined Client Portfolio', 'policies'),
  'combined-insurance-due': R('Combined Insurance Due', 'policies'),
  'combined-premium-calendar': R('Combined Premium Calendar', 'policies'),
  'combined-cash-flow': R('Combined Cash Flow', 'policies'),
  // Transaction reconciliation
  'commission-reconciliation': R('Commission Reconciliation', 'commissions'),
};

// Template editor slugs -> [templateKey, title]
const TEMPLATES = {
  'gi-renewal-mail-template': ['gi-renewal-mail-template', 'GI Renewal Mail Template'],
  'li-renewal-mail-template': ['li-renewal-mail-template', 'LI Renewal Mail Template'],
  'gi-renewal-mail-group-template': ['gi-renewal-mail-group-template', 'GI Renewal Mail Group Template'],
  'li-renewal-mail-group-wise-template': ['li-renewal-mail-group-wise-template', 'LI Renewal Mail Group Wise Template'],
  'policy-copy-email-template': ['policy-copy-email-template', 'Policy Copy Email Template'],
  'welcome-mail-template': ['welcome-mail-template', 'Welcome Mail Template'],
};

// Renewal reminder sender slugs -> [title, channel, line]
const SENDERS = {
  'gi-wa-renewal': ['GI WhatsApp Renewal', 'wa', 'GI'],
  'li-wa-renewal': ['LI WhatsApp Renewal', 'wa', 'LI'],
  'gi-mail-renewal': ['GI Mail Renewal', 'mail', 'GI'],
  'li-mail-renewal': ['LI Mail Renewal', 'mail', 'LI'],
  'birthday-wa-mail': ['Birthday WhatsApp / Mail', 'wa', ''],
  'anniversary-wa-mail': ['Anniversary WhatsApp / Mail', 'wa', ''],
};

export function resolvePage(slug) {
  if (slug === 'client-master') return <ClientMaster />;
  if (slug === 'event-calendar') return <EventCalendar />;
  if (slug === 'fd-transaction') return <FDTransaction />;
  if (slug === 'claim-intimation-master') return <ClaimIntimationMaster />;
  if (slug === 'scheduler-reminder') return <SchedulerReminder />;
  if (slug === 'favourite-links') return <FavouriteLinks />;
  if (slug === 'dashboard-preference-master') return <DashboardPreference />;

  if (TEMPLATES[slug]) { const [k, t] = TEMPLATES[slug]; return <MailTemplate key={k} tkey={k} title={t} />; }
  if (SENDERS[slug]) { const [t, ch, ln] = SENDERS[slug]; return <RenewalSender key={slug} title={t} channel={ch} line={ln} />; }

  if (slug === 'policy-purchase-gi' || slug === 'policy-purchase-li') return <PolicyPurchase slug={slug} />;
  if (slug === 'claim') return <Claims />;
  if (slug === 'lead-view' || slug === 'client-lead') return <Leads />;
  if (slug === 'agency-master' || slug === 'li-agency-master' || slug === 'fd-agency-master') return <AgencyMaster />;
  if (slug === 'endorsement') return <Endorsement />;
  if (slug === 'commission-payin') return <CommissionList kind="payin" />;
  if (slug === 'commission-payout') return <CommissionList kind="payout" />;
  if (slug === 'task-management') return <TaskManagement />;
  if (slug === 'renewal-manager') return <RenewalManager />;
  if (slug === 'quotation') return <Quotations />;
  if (slug === 'rfq') return <Rfq />;
  if (slug === 'client-journey') return <ClientJourney />;
  if (slug === 'renewal-view' || slug === 'renewal-followup' || slug === 'renewal-premium-update') return <RenewalView />;
  if (slug === 'lead-followup' || slug === 'office-lead-followup') return <LeadFollowup />;
  if (slug === 'birthday-list') return <EventList kind="birthday" />;
  if (slug === 'anniversary-list') return <EventList kind="anniversary" />;
  if (slug === 'my-profile') return <MyProfile />;
  if (slug === 'change-password') return <ChangePassword />;
  if (slug === 'help') return <Help />;

  // Transaction tools
  if (slug === 'excel-upload') return <ExcelUpload key="ex" title="Excel Upload" kind="gi" />;
  if (slug === 'ld-excel-upload') return <ExcelUpload key="ld" title="LD Excel Upload" kind="ld" />;
  if (slug === 'merging-client') return <MergingClient />;
  if (slug === 'premium-due-fup-update') return <FupUpdate key="fup" title="Premium Due (FUP) Update" mode="fup" />;
  if (slug === 'pdf-fup-update') return <FupUpdate key="pdf" title="PDF FUP Update" mode="pdf" />;
  if (slug === 'assign-reassign-renewals') return <AssignReassign key="r" mode="renewals" />;
  if (slug === 'assign-reassign-lead') return <AssignReassign key="l" mode="leads" />;
  if (slug === 'cross-sell-up-sell') return <CrossSellUpSell />;

  // Client App Management
  if (slug === 'client-app-management') return <ClientAppUsers />;
  if (slug === 'send-app-credentials') return <SendAppCredentials />;
  if (slug === 'youtube-video-mgt') return <ContentManager key="yt" storeKey="wca_videos" title="Youtube Video Management" subtitle="Manage videos shown in the client app" urlLabel="Video URL" seed={[{ id: 1, title: 'How to file a claim', url: 'https://youtu.be/example1' }]} />;
  if (slug === 'client-app-slider-mgt') return <ContentManager key="sl" storeKey="wca_sliders" title="Client App Slider Management" subtitle="Manage home-screen banners in the client app" urlLabel="Image URL" seed={[{ id: 1, title: 'Welcome banner', url: 'https://cdn.example.com/banner1.jpg' }]} />;

  if (SIMPLE_MASTERS[slug]) {
    const [category, title, columnLabel] = SIMPLE_MASTERS[slug];
    return <SimpleMaster key={category} category={category} title={title} columnLabel={columnLabel} />;
  }

  if (REPORTS[slug]) {
    const { title, source, line, kind } = REPORTS[slug];
    return <ReportView key={slug} title={title} source={source} line={line} kind={kind} />;
  }

  return null;
}
