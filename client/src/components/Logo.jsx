// WeCare Assurance brand logo — the official artwork (transparent PNG, with the
// "Insurance with Assurance" tagline). If the user has uploaded a company logo in
// My Profile, that image is used instead.
import brandLogo from '../assets/wecare-logo.png';

export { brandLogo };

function uploadedLogo() {
  try { return JSON.parse(localStorage.getItem('wca_company_profile') || '{}').logo || ''; }
  catch { return ''; }
}

export function LogoMark({ size = 34 }) {
  const logo = uploadedLogo();
  if (logo) return <span className="wc-mark-img" style={{ width: size, height: size }}><img src={logo} alt="Logo" /></span>;
  // Compact square mark for the collapsed sidebar: blue rounded tile with the brand checkmark.
  return (
    <span className="wc-mark" style={{ width: size, height: size }} aria-label="WeCare Assurance">
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="none">
        <path d="M4 12.5 L10 18 L20 6" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

// `tagline` and `onDark` are kept for callers; the artwork carries its own tagline
// and is always shown on a light surface (the sidebar, the login page's white chip).
export default function Logo({ scale = 1 }) {
  const logo = uploadedLogo();
  if (logo) return <span className="wc-logo-img" style={{ '--wc-scale': scale }}><img src={logo} alt="Company logo" /></span>;
  return (
    <span className="wc-logo-img wc-brand" style={{ '--wc-scale': scale }}>
      <img src={brandLogo} alt="WeCare Assurance — Insurance with Assurance" />
    </span>
  );
}
