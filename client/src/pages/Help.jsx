import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import { Ic } from '../components/Icons.jsx';

const FAQS = [
  { q: 'How do I add a new client?', a: 'Go to Master Data → Client Master and click “Add New Client”. Fill in the details in the popup and click Save. The client appears in the list instantly.' },
  { q: 'How do I record a new policy?', a: 'Open Transaction Data → Policy Purchase (GI or LI), complete the three-step form (policy details, related information, documents) and click Save Policy.' },
  { q: 'Where can I see upcoming renewals?', a: 'The Dashboard shows renewal lists for GI and LI. For the full list use Transaction Data → Renewal Premium Update, or the Office Reports renewal reports.' },
  { q: 'How do I change which widgets show on my dashboard?', a: 'Go to Master Data → Dashboard Preference Master and toggle each widget on or off. Preferences are saved to this device automatically.' },
  { q: 'How do I pin my most-used screens?', a: 'Open Master Data → Favourite Links and toggle on the modules you use most.' },
  { q: 'How do I update my profile or password?', a: 'Click your name in the top-right, then choose “My Profile” or “Change Password”.' },
];

const CHANNELS = [
  { icon: 'mail', tone: 'info', label: 'Email support', value: 'support@wecareassurance.in', href: 'mailto:support@wecareassurance.in' },
  { icon: 'phone', tone: 'success', label: 'Call us', value: '1800-123-4567 (Mon–Sat, 9am–6pm)' },
  { icon: 'clock', tone: 'warning', label: 'Response time', value: 'Typically within 4 business hours' },
];

const QUICK = [
  { label: 'Client Master', to: '/page/client-master', icon: 'user' },
  { label: 'Policies', to: '/page/policy', icon: 'file' },
  { label: 'Claim Register', to: '/page/claim', icon: 'shieldcheck' },
  { label: 'Dashboard Preference', to: '/page/dashboard-preference-master', icon: 'sliders' },
];

export default function Help() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(0);

  return (
    <div>
      <PageHeader title="Help & Support" />

      <div className="help-hero card">
        <div className="help-hero-ic"><Ic name="help" size={26} /></div>
        <div>
          <h2>How can we help you?</h2>
          <p>Browse common questions below, jump to a module, or reach our support team directly.</p>
        </div>
      </div>

      <div className="help-grid">
        <div className="card">
          <div className="card-head">Frequently asked questions</div>
          <div className="card-pad">
            <div className="faq-list">
              {FAQS.map((f, i) => (
                <div className={'faq' + (open === i ? ' open' : '')} key={i}>
                  <button className="faq-q" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>
                    <span>{f.q}</span>
                    <Ic name="chevron" size={16} style={{ transform: open === i ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur-2) var(--ease)', flexShrink: 0 }} />
                  </button>
                  {open === i && <div className="faq-a">{f.a}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="help-side">
          <div className="card">
            <div className="card-head">Contact support</div>
            <div className="card-pad help-channels">
              {CHANNELS.map((c) => (
                <div className="help-channel" key={c.label}>
                  <span className="help-channel-ic" data-tone={c.tone}><Ic name={c.icon} size={17} /></span>
                  <div>
                    <div className="help-channel-label">{c.label}</div>
                    {c.href ? <a href={c.href} className="help-channel-value link">{c.value}</a> : <div className="help-channel-value">{c.value}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head">Quick links</div>
            <div className="card-pad help-quick">
              {QUICK.map((q) => (
                <button className="help-quick-btn" key={q.to} onClick={() => navigate(q.to)}>
                  <Ic name={q.icon} size={16} /> {q.label}
                  <Ic name="arrowright" size={15} style={{ marginLeft: 'auto', opacity: 0.6 }} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
