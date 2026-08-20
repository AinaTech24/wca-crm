import ClientMaster from './pages/ClientMaster.jsx';
import Claims from './pages/Claims.jsx';
import FavouriteLinks from './pages/FavouriteLinks.jsx';
import DashboardPreference from './pages/DashboardPreference.jsx';
import Help from './pages/Help.jsx';
import Rfq from './pages/Rfq.jsx';
import Leads from './pages/Leads.jsx';
import Meetings from './pages/Meetings.jsx';
import Tasks from './pages/Tasks.jsx';
import Policies from './pages/Policies.jsx';
import Team from './pages/Team.jsx';
import ClientJourney from './pages/ClientJourney.jsx';
import MyProfile from './pages/MyProfile.jsx';
import ChangePassword from './pages/ChangePassword.jsx';

export function resolvePage(slug) {
  if (slug === 'client-master') return <ClientMaster />;
  if (slug === 'claim') return <Claims />;
  if (slug === 'favourite-links') return <FavouriteLinks />;
  if (slug === 'dashboard-preference-master') return <DashboardPreference />;
  if (slug === 'rfq') return <Rfq />;
  if (slug === 'lead') return <Leads />;
  if (slug === 'meeting') return <Meetings />;
  if (slug === 'task') return <Tasks />;
  if (slug === 'policy') return <Policies />;
  if (slug === 'team') return <Team />;
  if (slug === 'client-journey') return <ClientJourney />;
  if (slug === 'my-profile') return <MyProfile />;
  if (slug === 'change-password') return <ChangePassword />;
  if (slug === 'help') return <Help />;

  return null;
}
