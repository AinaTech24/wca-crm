// WeCare Assurance brand wordmark, rendered as a scalable CSS/SVG lockup
// so it themes crisply at any size without a binary asset. If the user has
// uploaded a company logo in My Profile, that image is used instead.

function uploadedLogo() {
  try { return JSON.parse(localStorage.getItem('wca_company_profile') || '{}').logo || ''; }
  catch { return ''; }
}

export function LogoMark({ size = 34 }) {
  const logo = uploadedLogo();
  if (logo) return <span className="wc-mark-img" style={{ width: size, height: size }}><img src={logo} alt="Logo" /></span>;
  // Compact square mark: blue rounded tile with the brand checkmark.
  return (
    <span className="wc-mark" style={{ width: size, height: size }} aria-label="WeCare Assurance">
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="none">
        <path d="M4 12.5 L10 18 L20 6" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export default function Logo({ tagline = true, scale = 1, onDark = false }) {
  const logo = uploadedLogo();
  if (logo) return <span className="wc-logo-img" style={{ '--wc-scale': scale }}><img src={logo} alt="Company logo" /></span>;
  return (
    <span className="wc-logo" style={{ '--wc-scale': scale }}>
      <span className="wc-word">
        <span className="wc-we">WE</span>
        <span className="wc-care">
          C<span className="wc-a-wrap">A<svg className="wc-check" viewBox="0 0 40 40" width="1em" height="1em" fill="none"><path d="M7 21 L16 30 L34 8" stroke="var(--brand-blue)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" /></svg></span>RE
        </span>
      </span>
      <span className="wc-assurance" style={onDark ? { color: 'rgba(255,255,255,.85)' } : null}>ASSURANCE</span>
      {tagline && <span className="wc-tag" style={onDark ? { color: 'rgba(255,255,255,.9)' } : null}>Insurance with Assurance</span>}
    </span>
  );
}
