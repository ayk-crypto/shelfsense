import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

function useScrolled(threshold = 20) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > threshold);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, [threshold]);
  return scrolled;
}

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

function Navbar() {
  const scrolled = useScrolled();
  const { isAuthenticated } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className={`lp-nav ${scrolled ? "lp-nav--scrolled" : ""}`}>
      <div className="lp-container lp-nav-inner">
        <a href="/" className="lp-nav-logo">
          <span className="lp-nav-logo-mark">S</span>
          <span className="lp-nav-logo-text">ShelfSense</span>
        </a>

        <nav className={`lp-nav-links ${menuOpen ? "lp-nav-links--open" : ""}`}>
          <button type="button" className="lp-nav-link" onClick={() => { scrollTo("features"); setMenuOpen(false); }}>Features</button>
          <button type="button" className="lp-nav-link" onClick={() => { scrollTo("pricing"); setMenuOpen(false); }}>Pricing</button>
          <div className="lp-nav-divider" />
          {isAuthenticated ? (
            <Link to="/dashboard" className="lp-btn lp-btn--primary">Go to app →</Link>
          ) : (
            <>
              <Link to="/login" className="lp-btn lp-btn--ghost">Sign in</Link>
              <Link to="/signup" className="lp-btn lp-btn--primary">Get started free</Link>
            </>
          )}
        </nav>

        <button
          type="button"
          className={`lp-nav-burger ${menuOpen ? "lp-nav-burger--open" : ""}`}
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          <span /><span /><span />
        </button>
      </div>
    </header>
  );
}

function AppMockup() {
  return (
    <div className="lp-mockup">
      <div className="lp-mockup-chrome">
        <div className="lp-mockup-chrome-bar">
          <span className="lp-mockup-dot lp-mockup-dot--red" />
          <span className="lp-mockup-dot lp-mockup-dot--yellow" />
          <span className="lp-mockup-dot lp-mockup-dot--green" />
          <div className="lp-mockup-url">app.shelfsense.com/items</div>
        </div>
        <div className="lp-mockup-body">
          <aside className="lp-ms-sidebar">
            <div className="lp-ms-logo-wrap">
              <span className="lp-ms-logo">S</span>
              <span className="lp-ms-workspace">My Workspace</span>
            </div>
            {[
              { label: "Today", active: false },
              { label: "Inventory", active: true },
              { label: "Stock In", active: false },
              { label: "Alerts", active: false },
              { label: "Reports", active: false },
            ].map((item) => (
              <div key={item.label} className={`lp-ms-item ${item.active ? "lp-ms-item--active" : ""}`}>
                {item.label}
              </div>
            ))}
          </aside>

          <main className="lp-ms-main">
            <div className="lp-ms-topbar">
              <span className="lp-ms-title">Inventory</span>
              <span className="lp-ms-add">+ Add Item</span>
            </div>

            <div className="lp-ms-stats">
              <div className="lp-ms-stat">
                <span className="lp-ms-stat-n">48</span>
                <span className="lp-ms-stat-l">Items</span>
              </div>
              <div className="lp-ms-stat">
                <span className="lp-ms-stat-n" style={{ color: "#f59e0b" }}>6</span>
                <span className="lp-ms-stat-l">Low stock</span>
              </div>
              <div className="lp-ms-stat">
                <span className="lp-ms-stat-n" style={{ color: "#ef4444" }}>3</span>
                <span className="lp-ms-stat-l">Expiring</span>
              </div>
            </div>

            <div className="lp-ms-table">
              <div className="lp-ms-thead">
                <span>Item</span><span>Category</span><span>Stock</span><span>Status</span>
              </div>
              {[
                { name: "Pasta Sauce", cat: "Food", stock: "42 units", badge: "low", badgeLabel: "Low stock" },
                { name: "Coffee Beans", cat: "Beverage", stock: "15 units", badge: "warn", badgeLabel: "Expiring" },
                { name: "Hand Sanitizer", cat: "Medical", stock: "128 units", badge: null, badgeLabel: "" },
                { name: "Paper Towels", cat: "Supplies", stock: "320 units", badge: null, badgeLabel: "" },
                { name: "Olive Oil", cat: "Food", stock: "9 units", badge: "low", badgeLabel: "Low stock" },
              ].map((row) => (
                <div key={row.name} className="lp-ms-row">
                  <span className="lp-ms-row-name">{row.name}</span>
                  <span className="lp-ms-row-cat">{row.cat}</span>
                  <span className="lp-ms-row-stock">{row.stock}</span>
                  <span>
                    {row.badge === "low" && <span className="lp-ms-badge lp-ms-badge--low">{row.badgeLabel}</span>}
                    {row.badge === "warn" && <span className="lp-ms-badge lp-ms-badge--warn">{row.badgeLabel}</span>}
                    {!row.badge && <span className="lp-ms-badge lp-ms-badge--ok">In stock</span>}
                  </span>
                </div>
              ))}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

const FEATURES = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
    color: "#6366f1",
    bg: "#eef2ff",
    title: "Real-time inventory",
    desc: "Always know exactly what you have. Stock levels update instantly as your team records movements, purchases, and adjustments.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <path d="M9 16l2 2 4-4" />
      </svg>
    ),
    color: "#ef4444",
    bg: "#fef2f2",
    title: "Expiry date tracking",
    desc: "Never let stock expire unnoticed. Get automatic alerts before items reach their best-before date — days or weeks in advance.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 10c0 7-9 12-9 12S3 17 3 10a9 9 0 1 1 18 0z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    ),
    color: "#10b981",
    bg: "#ecfdf5",
    title: "Multi-location",
    desc: "Run multiple stores, warehouses, or storage rooms from a single dashboard. Transfer stock between locations in seconds.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
    color: "#f59e0b",
    bg: "#fffbeb",
    title: "Purchase orders",
    desc: "Create POs, track them from draft to received, and have stock levels update automatically when deliveries arrive.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    color: "#3b82f6",
    bg: "#eff6ff",
    title: "Team access control",
    desc: "Invite your team and assign roles — Owner, Manager, or Operator. Control exactly who can view, record, or manage stock.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
        <polyline points="3 20 21 20" />
      </svg>
    ),
    color: "#8b5cf6",
    bg: "#f5f3ff",
    title: "Reports & analytics",
    desc: "8 built-in reports covering wastage costs, supplier spend, stock aging, expiry losses, and more — all exportable to CSV.",
  },
];

const PRICING = [
  {
    tier: "Free",
    price: "0",
    period: "forever",
    desc: "Perfect for getting started with inventory basics.",
    color: "#64748b",
    bg: "#f8fafc",
    highlight: false,
    features: ["Up to 50 items", "1 location", "Up to 3 users", "All core features", "CSV export"],
  },
  {
    tier: "Basic",
    price: "19",
    period: "/ month",
    desc: "For growing businesses with more complex needs.",
    color: "#6366f1",
    bg: "#eef2ff",
    highlight: true,
    features: ["Up to 500 items", "Up to 5 locations", "Up to 10 users", "Everything in Free", "Purchase orders", "Priority support"],
  },
  {
    tier: "Pro",
    price: "49",
    period: "/ month",
    desc: "Unlimited scale for serious inventory operations.",
    color: "#7c3aed",
    bg: "#f5f3ff",
    highlight: false,
    features: ["Unlimited items", "Unlimited locations", "Unlimited users", "Everything in Basic", "Advanced reports", "Dedicated support"],
  },
];

export function LandingPage() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  function handlePrimaryCta() {
    if (isAuthenticated) {
      navigate("/dashboard");
    } else {
      navigate("/signup");
    }
  }

  return (
    <div className="lp-root">
      <Navbar />

      {/* ── Hero ───────────────────────────────────── */}
      <section className="lp-hero">
        <div className="lp-hero-bg" aria-hidden />
        <div className="lp-container lp-hero-inner">
          <div className="lp-hero-copy">
            <div className="lp-hero-eyebrow">Inventory management, simplified</div>
            <h1 className="lp-hero-headline">
              Know exactly what you have,
              <span className="lp-hero-headline-accent"> before it runs out.</span>
            </h1>
            <p className="lp-hero-sub">
              ShelfSense tracks your stock, expiry dates, and team access across all your locations — in real time, without the spreadsheet chaos.
            </p>
            <div className="lp-hero-actions">
              <button type="button" className="lp-btn lp-btn--hero-primary" onClick={handlePrimaryCta}>
                {isAuthenticated ? "Go to dashboard →" : "Start for free →"}
              </button>
              <button type="button" className="lp-btn lp-btn--hero-ghost" onClick={() => scrollTo("features")}>
                See features ↓
              </button>
            </div>
            <div className="lp-hero-trust">
              <span className="lp-hero-trust-item">✓ No credit card required</span>
              <span className="lp-hero-trust-item">✓ Setup in 2 minutes</span>
              <span className="lp-hero-trust-item">✓ Free tier always free</span>
            </div>
          </div>

          <div className="lp-hero-visual">
            <AppMockup />
          </div>
        </div>
      </section>

      {/* ── Stats bar ──────────────────────────────── */}
      <section className="lp-stats-bar">
        <div className="lp-container lp-stats-inner">
          {[
            { value: "50+", label: "Businesses using ShelfSense" },
            { value: "10k+", label: "Items tracked daily" },
            { value: "8", label: "Built-in analytics reports" },
            { value: "99.9%", label: "Uptime SLA" },
          ].map((s) => (
            <div key={s.label} className="lp-stat">
              <span className="lp-stat-value">{s.value}</span>
              <span className="lp-stat-label">{s.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ──────────────────────────────── */}
      <section className="lp-features" id="features">
        <div className="lp-container">
          <div className="lp-section-header">
            <div className="lp-section-eyebrow">Everything you need</div>
            <h2 className="lp-section-title">Built for the way real businesses work</h2>
            <p className="lp-section-sub">
              From corner shops to multi-site operations — ShelfSense adapts to your workflow, not the other way around.
            </p>
          </div>

          <div className="lp-features-grid">
            {FEATURES.map((f) => (
              <div key={f.title} className="lp-feature-card">
                <div className="lp-feature-icon" style={{ background: f.bg, color: f.color }}>
                  {f.icon}
                </div>
                <h3 className="lp-feature-title">{f.title}</h3>
                <p className="lp-feature-desc">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Product deep-dive ─────────────────────── */}
      <section className="lp-showcase">
        <div className="lp-container lp-showcase-inner">
          <div className="lp-showcase-copy">
            <div className="lp-section-eyebrow">See it in action</div>
            <h2 className="lp-showcase-title">Everything on one screen</h2>
            <p className="lp-showcase-desc">
              Your entire inventory, low-stock alerts, and expiry warnings — visible at a glance. No hunting through tabs or scrolling endless reports.
            </p>
            <ul className="lp-showcase-list">
              {[
                "Color-coded stock status badges",
                "Inline expiry date display per batch",
                "Instant low-stock alert count in the nav",
                "Quick stock-in and stock-out from any row",
              ].map((item) => (
                <li key={item} className="lp-showcase-list-item">
                  <span className="lp-showcase-check">
                    <svg viewBox="0 0 16 16" fill="currentColor">
                      <path fillRule="evenodd" d="M13.707 4.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-3-3a1 1 0 011.414-1.414L6 10.586l6.293-6.293a1 1 0 011.414 0z" />
                    </svg>
                  </span>
                  {item}
                </li>
              ))}
            </ul>
            <button type="button" className="lp-btn lp-btn--outline" onClick={handlePrimaryCta}>
              {isAuthenticated ? "Open your dashboard" : "Try it free"}
            </button>
          </div>
          <div className="lp-showcase-visual">
            <div className="lp-showcase-card">
              <div className="lp-sc-header">
                <span className="lp-sc-title">Alerts</span>
                <span className="lp-sc-count">9 active</span>
              </div>
              {[
                { icon: "📦", name: "Pasta Sauce", msg: "Only 3 units left — reorder point is 10", tag: "low", tagLabel: "Critical" },
                { icon: "⏰", name: "Coffee Beans", msg: "5 batches expire within 7 days", tag: "expiry", tagLabel: "Expiring" },
                { icon: "📦", name: "Olive Oil", msg: "9 units remaining — below minimum", tag: "low", tagLabel: "Low stock" },
                { icon: "⏰", name: "Vanilla Extract", msg: "2 batches expire in 3 days", tag: "expiry", tagLabel: "Urgent" },
              ].map((a) => (
                <div key={a.name} className="lp-sc-alert-row">
                  <span className="lp-sc-alert-icon">{a.icon}</span>
                  <div className="lp-sc-alert-body">
                    <span className="lp-sc-alert-name">{a.name}</span>
                    <span className="lp-sc-alert-msg">{a.msg}</span>
                  </div>
                  <span className={`lp-sc-alert-tag lp-sc-alert-tag--${a.tag}`}>{a.tagLabel}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Pricing ───────────────────────────────── */}
      <section className="lp-pricing" id="pricing">
        <div className="lp-container">
          <div className="lp-section-header">
            <div className="lp-section-eyebrow">Simple pricing</div>
            <h2 className="lp-section-title">Plans that grow with your business</h2>
            <p className="lp-section-sub">
              Start free, no card needed. Upgrade when you need more items, locations, or team members.
            </p>
          </div>

          <div className="lp-pricing-note">
            <span className="lp-pricing-note-icon">🎉</span>
            All plans are free during our preview period — billing activates when payments go live.
          </div>

          <div className="lp-pricing-grid">
            {PRICING.map((plan) => (
              <div
                key={plan.tier}
                className={`lp-pricing-card ${plan.highlight ? "lp-pricing-card--highlight" : ""}`}
              >
                {plan.highlight && <div className="lp-pricing-popular">Most popular</div>}
                <div className="lp-pricing-tier" style={{ color: plan.color }}>{plan.tier}</div>
                <div className="lp-pricing-price">
                  <span className="lp-pricing-currency">$</span>
                  <span className="lp-pricing-amount">{plan.price}</span>
                  <span className="lp-pricing-period">{plan.period}</span>
                </div>
                <p className="lp-pricing-desc">{plan.desc}</p>
                <ul className="lp-pricing-features">
                  {plan.features.map((f) => (
                    <li key={f} className="lp-pricing-feature">
                      <svg className="lp-pricing-check" viewBox="0 0 16 16" fill="currentColor">
                        <path fillRule="evenodd" d="M13.707 4.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-3-3a1 1 0 011.414-1.414L6 10.586l6.293-6.293a1 1 0 011.414 0z" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className={`lp-pricing-cta ${plan.highlight ? "lp-pricing-cta--primary" : "lp-pricing-cta--outline"}`}
                  style={plan.highlight ? { background: plan.color } : { borderColor: plan.color, color: plan.color }}
                  onClick={handlePrimaryCta}
                >
                  {isAuthenticated ? "Open dashboard" : plan.price === "0" ? "Get started free" : "Start free trial"}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA banner ────────────────────────────── */}
      <section className="lp-cta">
        <div className="lp-cta-bg" aria-hidden />
        <div className="lp-container lp-cta-inner">
          <h2 className="lp-cta-title">Ready to take control of your inventory?</h2>
          <p className="lp-cta-sub">Join businesses that have replaced their spreadsheets with ShelfSense. No setup fees, no contracts.</p>
          <div className="lp-cta-actions">
            <button type="button" className="lp-btn lp-btn--cta-primary" onClick={handlePrimaryCta}>
              {isAuthenticated ? "Back to dashboard →" : "Create your free account →"}
            </button>
            {!isAuthenticated && (
              <Link to="/login" className="lp-btn lp-btn--cta-ghost">Sign in</Link>
            )}
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────── */}
      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div className="lp-footer-brand">
            <span className="lp-nav-logo-mark lp-footer-logo-mark">S</span>
            <span className="lp-nav-logo-text lp-footer-logo-text">ShelfSense</span>
            <p className="lp-footer-tagline">Smart inventory for modern businesses.</p>
          </div>
          <div className="lp-footer-links">
            <div className="lp-footer-col">
              <span className="lp-footer-col-title">Product</span>
              <button type="button" className="lp-footer-link" onClick={() => scrollTo("features")}>Features</button>
              <button type="button" className="lp-footer-link" onClick={() => scrollTo("pricing")}>Pricing</button>
            </div>
            <div className="lp-footer-col">
              <span className="lp-footer-col-title">Account</span>
              <Link to="/signup" className="lp-footer-link">Sign up</Link>
              <Link to="/login" className="lp-footer-link">Sign in</Link>
            </div>
          </div>
        </div>
        <div className="lp-footer-bottom">
          <div className="lp-container">
            © {new Date().getFullYear()} ShelfSense. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
