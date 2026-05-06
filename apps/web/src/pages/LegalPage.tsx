import { Link } from "react-router-dom";

export interface LegalSection {
  title: string;
  body: React.ReactNode;
}

interface LegalPageProps {
  title: string;
  effectiveDate: string;
  intro?: React.ReactNode;
  sections: LegalSection[];
}

export function LegalPage({ title, effectiveDate, intro, sections }: LegalPageProps) {
  return (
    <div className="legal-root">
      <header className="legal-header">
        <div className="legal-header-inner">
          <Link to="/" className="legal-logo">
            <span className="lp-nav-logo-mark" style={{ width: 30, height: 30, fontSize: 14 }}>S</span>
            <span className="lp-nav-logo-text">ShelfSense</span>
          </Link>
          <nav className="legal-header-nav">
            <Link to="/terms" className="legal-nav-link">Terms</Link>
            <Link to="/privacy" className="legal-nav-link">Privacy</Link>
            <Link to="/refund" className="legal-nav-link">Refund Policy</Link>
          </nav>
        </div>
      </header>

      <main className="legal-main">
        <div className="legal-container">
          <div className="legal-hero">
            <h1 className="legal-title">{title}</h1>
            <p className="legal-date">Effective date: {effectiveDate}</p>
            {intro && <div className="legal-intro">{intro}</div>}
          </div>

          <div className="legal-body">
            {sections.map((s, i) => (
              <section key={i} className="legal-section">
                <h2 className="legal-section-title">{s.title}</h2>
                <div className="legal-section-body">{s.body}</div>
              </section>
            ))}
          </div>
        </div>
      </main>

      <footer className="legal-footer">
        <div className="legal-container legal-footer-inner">
          <span>© {new Date().getFullYear()} SenseStack Technologies. All rights reserved.</span>
          <div className="legal-footer-links">
            <Link to="/terms" className="legal-footer-link">Terms</Link>
            <Link to="/privacy" className="legal-footer-link">Privacy</Link>
            <Link to="/refund" className="legal-footer-link">Refund Policy</Link>
            <a href="mailto:hello@shelfsense.com" className="legal-footer-link">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function LegalFooterLinks() {
  return (
    <div className="auth-legal-links">
      <Link to="/terms">Terms of Service</Link>
      <span>·</span>
      <Link to="/privacy">Privacy Policy</Link>
      <span>·</span>
      <Link to="/refund">Refund Policy</Link>
    </div>
  );
}
