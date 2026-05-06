import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getPublicPlans } from "../api/subscriptions";
import type { PublicPlan } from "../types";

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
              <Link to="/signup" className="lp-btn lp-btn--primary">Start free</Link>
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
    <div className="lp-mockup-wrap">
      {/* Floating alert notification */}
      <div className="lp-mockup-float lp-mockup-float--alert">
        <span className="lp-mf-pulse" />
        <div className="lp-mf-content">
          <div className="lp-mf-title">3 items expiring soon</div>
          <div className="lp-mf-sub">Coffee Beans · Vanilla Extract · Milk</div>
        </div>
        <span className="lp-mf-badge lp-mf-badge--danger">Urgent</span>
      </div>

      {/* Floating restock card */}
      <div className="lp-mockup-float lp-mockup-float--restock">
        <div className="lp-mf-icon">📦</div>
        <div className="lp-mf-content">
          <div className="lp-mf-title">Olive Oil — Low stock</div>
          <div className="lp-mf-sub">9 units left · Reorder point: 20</div>
        </div>
      </div>

      <div className="lp-mockup">
        <div className="lp-mockup-chrome">
          <div className="lp-mockup-chrome-bar">
            <span className="lp-mockup-dot lp-mockup-dot--red" />
            <span className="lp-mockup-dot lp-mockup-dot--yellow" />
            <span className="lp-mockup-dot lp-mockup-dot--green" />
            <div className="lp-mockup-url">app.shelfsense.com/inventory</div>
          </div>
          <div className="lp-mockup-body">
            {/* Sidebar */}
            <aside className="lp-ms-sidebar">
              <div className="lp-ms-logo-wrap">
                <span className="lp-ms-logo">S</span>
                <span className="lp-ms-workspace">My Workspace</span>
              </div>
              {[
                { label: "Dashboard",  active: false, badge: null },
                { label: "Inventory",  active: true,  badge: null },
                { label: "Receive",    active: false, badge: null },
                { label: "Alerts",     active: false, badge: "9"  },
                { label: "Reports",    active: false, badge: null },
              ].map((item) => (
                <div key={item.label} className={`lp-ms-item ${item.active ? "lp-ms-item--active" : ""}`}>
                  <span className="lp-ms-item-label">{item.label}</span>
                  {item.badge && <span className="lp-ms-item-badge">{item.badge}</span>}
                </div>
              ))}
            </aside>

            {/* Main content */}
            <main className="lp-ms-main">
              <div className="lp-ms-topbar">
                <span className="lp-ms-title">Inventory</span>
                <div className="lp-ms-topbar-right">
                  <span className="lp-ms-filter-btn">Filter</span>
                  <span className="lp-ms-add">+ Add Item</span>
                </div>
              </div>

              <div className="lp-ms-stats">
                <div className="lp-ms-stat">
                  <span className="lp-ms-stat-n">48</span>
                  <span className="lp-ms-stat-l">Total items</span>
                </div>
                <div className="lp-ms-stat">
                  <span className="lp-ms-stat-n lp-ms-stat-n--ok">39</span>
                  <span className="lp-ms-stat-l">In stock</span>
                </div>
                <div className="lp-ms-stat">
                  <span className="lp-ms-stat-n lp-ms-stat-n--warn">6</span>
                  <span className="lp-ms-stat-l">Low stock</span>
                </div>
                <div className="lp-ms-stat">
                  <span className="lp-ms-stat-n lp-ms-stat-n--danger">3</span>
                  <span className="lp-ms-stat-l">Expiring</span>
                </div>
              </div>

              <div className="lp-ms-table">
                <div className="lp-ms-thead">
                  <span>Item</span><span>Category</span><span>Stock</span><span>Status</span>
                </div>
                {[
                  { name: "Pasta Sauce",    cat: "Food",     stock: "42 units",  badge: "low",  badgeLabel: "Low stock" },
                  { name: "Coffee Beans",   cat: "Beverage", stock: "15 units",  badge: "warn", badgeLabel: "Expiring"  },
                  { name: "Hand Sanitizer", cat: "Medical",  stock: "128 units", badge: null,   badgeLabel: ""          },
                  { name: "Paper Towels",   cat: "Supplies", stock: "320 units", badge: null,   badgeLabel: ""          },
                  { name: "Olive Oil",      cat: "Food",     stock: "9 units",   badge: "low",  badgeLabel: "Low stock" },
                ].map((row) => (
                  <div key={row.name} className="lp-ms-row">
                    <span className="lp-ms-row-name">{row.name}</span>
                    <span className="lp-ms-row-cat">{row.cat}</span>
                    <span className="lp-ms-row-stock">{row.stock}</span>
                    <span>
                      {row.badge === "low"  && <span className="lp-ms-badge lp-ms-badge--low">{row.badgeLabel}</span>}
                      {row.badge === "warn" && <span className="lp-ms-badge lp-ms-badge--warn">{row.badgeLabel}</span>}
                      {!row.badge           && <span className="lp-ms-badge lp-ms-badge--ok">In stock</span>}
                    </span>
                  </div>
                ))}
              </div>
            </main>
          </div>
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
    color: "#6366f1", bg: "#eef2ff",
    title: "Always know what you have",
    desc: "Stock levels update the moment your team records a movement, purchase, or adjustment — no more guessing, no end-of-day reconciliation.",
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
    color: "#ef4444", bg: "#fef2f2",
    title: "Catch expiry before it costs you",
    desc: "Automatic alerts days or weeks before items expire. Stop writing off stock you didn't know was about to go bad.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 10c0 7-9 12-9 12S3 17 3 10a9 9 0 1 1 18 0z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    ),
    color: "#10b981", bg: "#ecfdf5",
    title: "Manage every site from one place",
    desc: "Run multiple stores, warehouses, or kitchens from a single dashboard. Transfer stock between locations in seconds — no emails, no calls.",
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
    color: "#f59e0b", bg: "#fffbeb",
    title: "Restock without the back-and-forth",
    desc: "Create purchase orders, track them from draft to received, and watch stock levels update automatically when deliveries arrive.",
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
    color: "#3b82f6", bg: "#eff6ff",
    title: "Your team, with the right access",
    desc: "Invite staff and set their role — Owner, Manager, or Operator. Everyone sees what they need, nothing they don't.",
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
    color: "#8b5cf6", bg: "#f5f3ff",
    title: "See where money is being lost",
    desc: "8 built-in reports covering wastage costs, supplier spend, stock aging, and expiry losses — exportable to CSV in one click.",
  },
];

const WHO_FOR = [
  {
    emoji: "🍽️",
    title: "Restaurants & cafes",
    desc: "Track ingredients by batch, catch expiry before service, and stop over-ordering. ShelfSense is built around the way food businesses actually work.",
  },
  {
    emoji: "🛒",
    title: "Retail stores",
    desc: "Know your stock levels across every shelf and location. Get low-stock alerts before customers notice, and reorder with a single purchase order.",
  },
  {
    emoji: "🏭",
    title: "Warehouses & suppliers",
    desc: "Manage high volumes across multiple storage areas. Transfer stock between locations, track inbound deliveries, and keep your team in sync.",
  },
];

const PLAN_VISUAL: Record<string, { color: string; bg: string; highlight: boolean }> = {
  FREE:       { color: "#64748b", bg: "#f8fafc", highlight: false },
  STARTER:    { color: "#6366f1", bg: "#eef2ff", highlight: true  },
  PRO:        { color: "#7c3aed", bg: "#f5f3ff", highlight: false },
  GROWTH:     { color: "#7c3aed", bg: "#f5f3ff", highlight: false },
  BUSINESS:   { color: "#0ea5e9", bg: "#f0f9ff", highlight: false },
  ENTERPRISE: { color: "#0f172a", bg: "#f8fafc", highlight: false },
};

type PricingFeature = { label: string; included: boolean };

type PricingCard = {
  id?: string;
  tier: string;
  price: string;
  period: string;
  desc: string;
  color: string;
  bg: string;
  highlight: boolean;
  limits: string[];
  features: PricingFeature[];
  currency: string;
  isCustom?: boolean;
};

function limitLabel(val: number | null, unit: string, singular?: string): string {
  if (val === null) return `Unlimited ${unit}`;
  if (val === -1)   return `Unlimited ${unit}`;
  const u = val === 1 && singular ? singular : unit;
  return `${val.toLocaleString()} ${u}`;
}

function isCustomPricing(plan: PublicPlan): boolean {
  if (plan.priceDisplayMode === "CUSTOM") return true;
  if (plan.priceDisplayMode === "FIXED") return false;
  const n = (plan.name + " " + plan.code).toLowerCase();
  return n.includes("business") || n.includes("enterprise");
}

function planToCard(plan: PublicPlan): PricingCard {
  const visual = PLAN_VISUAL[plan.code] ?? { color: "#64748b", bg: "#f8fafc", highlight: false };
  const custom = isCustomPricing(plan);
  const isFree = !custom && plan.monthlyPrice === 0 && plan.annualPrice === 0;

  const limits: string[] = [
    limitLabel(plan.maxUsers, "users", "user"),
    limitLabel(plan.maxLocations, "locations", "location"),
    limitLabel(plan.maxItems, "items", "item"),
  ];

  const features: PricingFeature[] = [
    { label: "Expiry tracking",      included: plan.enableExpiryTracking  },
    { label: "Barcode scanning",     included: plan.enableBarcodeScanning },
    { label: "Inventory reports",    included: plan.enableReports         },
    { label: "Advanced analytics",   included: plan.enableAdvancedReports },
    { label: "Purchase orders",      included: plan.enablePurchases       },
    { label: "Supplier management",  included: plan.enableSuppliers       },
    { label: "Team management",      included: plan.enableTeamManagement  },
    { label: "Custom roles",         included: plan.enableCustomRoles     },
    { label: "Email alerts",         included: plan.enableEmailAlerts     },
    { label: "Daily ops digest",     included: plan.enableDailyOps        },
  ];

  return {
    id: plan.id,
    tier: plan.name,
    price: isFree ? "0" : String(plan.monthlyPrice),
    period: isFree ? "forever" : "/ mo",
    desc: plan.description ?? "",
    color: visual.color,
    bg: visual.bg,
    highlight: visual.highlight,
    limits,
    features,
    currency: "$",
    isCustom: custom,
  };
}

const STATIC_PRICING: PricingCard[] = [
  {
    tier: "Free",
    price: "0",
    period: "forever",
    desc: "For testing and very small teams replacing spreadsheets.",
    color: "#64748b", bg: "#f8fafc", highlight: false, currency: "$",
    limits: ["3 users", "1 location", "50 items"],
    features: [
      { label: "Expiry tracking",      included: true  },
      { label: "Barcode scanning",     included: true  },
      { label: "Inventory reports",    included: true  },
      { label: "Advanced analytics",   included: false },
      { label: "Purchase orders",      included: false },
      { label: "Supplier management",  included: false },
      { label: "Team management",      included: false },
      { label: "Custom roles",         included: false },
      { label: "Email alerts",         included: false },
      { label: "Daily ops digest",     included: false },
    ],
  },
  {
    tier: "Basic",
    price: "19",
    period: "/ mo",
    desc: "For growing teams that need real inventory control across multiple locations.",
    color: "#6366f1", bg: "#eef2ff", highlight: true, currency: "$",
    limits: ["10 users", "5 locations", "500 items"],
    features: [
      { label: "Expiry tracking",      included: true  },
      { label: "Barcode scanning",     included: true  },
      { label: "Inventory reports",    included: true  },
      { label: "Advanced analytics",   included: false },
      { label: "Purchase orders",      included: true  },
      { label: "Supplier management",  included: true  },
      { label: "Team management",      included: true  },
      { label: "Custom roles",         included: false },
      { label: "Email alerts",         included: true  },
      { label: "Daily ops digest",     included: true  },
    ],
  },
  {
    tier: "Pro",
    price: "49",
    period: "/ mo",
    desc: "For multi-location operations needing advanced tracking and custom roles.",
    color: "#7c3aed", bg: "#f5f3ff", highlight: false, currency: "$",
    limits: ["Unlimited users", "Unlimited locations", "Unlimited items"],
    features: [
      { label: "Expiry tracking",      included: true },
      { label: "Barcode scanning",     included: true },
      { label: "Inventory reports",    included: true },
      { label: "Advanced analytics",   included: true },
      { label: "Purchase orders",      included: true },
      { label: "Supplier management",  included: true },
      { label: "Team management",      included: true },
      { label: "Custom roles",         included: true },
      { label: "Email alerts",         included: true },
      { label: "Daily ops digest",     included: true },
    ],
  },
  {
    tier: "Business",
    price: "0",
    period: "/ mo",
    desc: "Enterprise-grade inventory management with dedicated support and custom onboarding.",
    color: "#0ea5e9", bg: "#f0f9ff", highlight: false, currency: "$",
    isCustom: true,
    limits: ["Unlimited users", "Unlimited locations", "Unlimited items"],
    features: [
      { label: "Everything in Pro",      included: true },
      { label: "Custom onboarding",      included: true },
      { label: "Priority phone support", included: true },
      { label: "SLA guarantee",          included: true },
      { label: "Bulk data import",       included: true },
      { label: "Custom integrations",    included: true },
      { label: "Quarterly reviews",      included: true },
      { label: "Negotiated pricing",     included: true },
    ],
  },
];

const CHECK_ICON = (
  <svg className="lp-pricing-check" viewBox="0 0 16 16" fill="currentColor">
    <path fillRule="evenodd" d="M13.707 4.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-3-3a1 1 0 011.414-1.414L6 10.586l6.293-6.293a1 1 0 011.414 0z" />
  </svg>
);

const CROSS_ICON = (
  <svg className="lp-pricing-cross" viewBox="0 0 16 16" fill="currentColor">
    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L8 6.586l2.293-2.293a1 1 0 111.414 1.414L9.414 8l2.293 2.293a1 1 0 01-1.414 1.414L8 9.414l-2.293 2.293a1 1 0 01-1.414-1.414L6.586 8 4.293 5.707a1 1 0 010-1.414z" />
  </svg>
);

export function LandingPage() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [pricing, setPricing] = useState<PricingCard[]>(STATIC_PRICING);

  useEffect(() => {
    getPublicPlans()
      .then(({ plans }) => {
        if (plans.length > 0) setPricing(plans.map(planToCard));
      })
      .catch(() => { /* keep static fallback */ });
  }, []);

  function handlePrimaryCta() {
    navigate(isAuthenticated ? "/dashboard" : "/signup");
  }

  return (
    <div className="lp-root">
      <Navbar />

      {/* ── Hero ─────────────────────────────────────── */}
      <section className="lp-hero">
        <div className="lp-hero-bg" aria-hidden />
        <div className="lp-hero-glow" aria-hidden />
        <div className="lp-container lp-hero-inner">
          <div className="lp-hero-copy">
            <div className="lp-hero-eyebrow">Inventory management, simplified</div>
            <h1 className="lp-hero-headline">
              Stop expiry losses, stockouts, and
              <span className="lp-hero-headline-accent"> inventory blind spots.</span>
            </h1>
            <p className="lp-hero-sub">
              ShelfSense gives restaurants, retail stores, and warehouses a real-time view of their stock, expiry dates, and team activity — across every location, without the spreadsheets.
            </p>
            <div className="lp-hero-actions">
              <button type="button" className="lp-btn lp-btn--hero-primary" onClick={handlePrimaryCta}>
                {isAuthenticated ? "Go to app →" : "Start free →"}
              </button>
              <button type="button" className="lp-btn lp-btn--hero-ghost" onClick={() => scrollTo("features")}>
                See how it works ↓
              </button>
            </div>
            <div className="lp-hero-trust">
              <span className="lp-hero-trust-item">✓ No credit card required</span>
              <span className="lp-hero-trust-item">✓ Free during preview</span>
              <span className="lp-hero-trust-item">✓ Set up in minutes</span>
            </div>
          </div>

          <div className="lp-hero-visual">
            <AppMockup />
          </div>
        </div>
      </section>

      {/* ── Stats bar ─────────────────────────────────── */}
      <section className="lp-stats-bar">
        <div className="lp-container lp-stats-inner">
          {[
            { value: "8",      label: "Built-in analytics reports" },
            { value: "CSV",    label: "One-click data export" },
            { value: "Free",   label: "During the preview period" },
            { value: "< 5 min", label: "To set up your workspace" },
          ].map((s) => (
            <div key={s.label} className="lp-stat">
              <span className="lp-stat-value">{s.value}</span>
              <span className="lp-stat-label">{s.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ──────────────────────────────────── */}
      <section className="lp-features" id="features">
        <div className="lp-container">
          <div className="lp-section-header">
            <div className="lp-section-eyebrow">How it works</div>
            <h2 className="lp-section-title">Everything you need to run a tighter operation</h2>
            <p className="lp-section-sub">
              From a single shop to a multi-site operation — ShelfSense gives you the visibility to make better decisions, faster.
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

      {/* ── Who it's for ──────────────────────────────── */}
      <section className="lp-showcase" id="who">
        <div className="lp-container">
          <div className="lp-section-header">
            <div className="lp-section-eyebrow">Who it's for</div>
            <h2 className="lp-section-title">Built for businesses that live and die by their stock</h2>
            <p className="lp-section-sub">
              If expired products, empty shelves, or missed reorders cost you time or money, ShelfSense was made for you.
            </p>
          </div>

          <div className="lp-features-grid lp-features-grid--3">
            {WHO_FOR.map((w) => (
              <div key={w.title} className="lp-feature-card">
                <div className="lp-feature-icon" style={{ background: "#f8fafc", color: "#334155", fontSize: "1.5rem" }}>
                  {w.emoji}
                </div>
                <h3 className="lp-feature-title">{w.title}</h3>
                <p className="lp-feature-desc">{w.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Product showcase — alerts ─────────────────── */}
      <section className="lp-showcase lp-showcase--light">
        <div className="lp-container lp-showcase-inner">
          <div className="lp-showcase-copy">
            <div className="lp-section-eyebrow">See it in action</div>
            <h2 className="lp-showcase-title">Alerts before problems become losses</h2>
            <p className="lp-showcase-desc">
              ShelfSense watches your stock around the clock. When something needs attention — a low-stock item, a batch about to expire — you hear about it before it becomes a problem.
            </p>
            <ul className="lp-showcase-list">
              {[
                "Color-coded stock status so issues are obvious at a glance",
                "Expiry alerts days or weeks before the date hits",
                "Low-stock warnings with your own reorder thresholds",
                "Daily or instant email digests for your whole team",
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
              {isAuthenticated ? "Open your dashboard" : "Try it free — no card needed"}
            </button>
          </div>
          <div className="lp-showcase-visual">
            <div className="lp-showcase-card">
              <div className="lp-sc-header">
                <span className="lp-sc-title">Active Alerts</span>
                <span className="lp-sc-count">9 active</span>
              </div>
              {[
                { icon: "📦", name: "Pasta Sauce",     msg: "Only 3 units left — reorder point is 10",  tag: "low",    tagLabel: "Critical" },
                { icon: "⏰", name: "Coffee Beans",    msg: "5 batches expire within 7 days",            tag: "expiry", tagLabel: "Expiring" },
                { icon: "📦", name: "Olive Oil",       msg: "9 units remaining — below minimum",         tag: "low",    tagLabel: "Low stock" },
                { icon: "⏰", name: "Vanilla Extract", msg: "2 batches expire in 3 days",                tag: "expiry", tagLabel: "Urgent"   },
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

      {/* ── Trust section ─────────────────────────────── */}
      <section className="lp-trust-section">
        <div className="lp-container">
          <div className="lp-trust-inner">
            <div className="lp-trust-heading">Built for real inventory teams</div>
            <div className="lp-trust-grid">
              {[
                { icon: "✓", text: "No credit card required" },
                { icon: "✓", text: "Setup in under 5 minutes" },
                { icon: "✓", text: "Export your data anytime" },
                { icon: "✓", text: "Workspace-based access control" },
                { icon: "✓", text: "Works for restaurants, retail, warehouses & suppliers" },
              ].map((item) => (
                <div key={item.text} className="lp-trust-item">
                  <span className="lp-trust-icon">{item.icon}</span>
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Pricing ────────────────────────────────────── */}
      <section className="lp-pricing" id="pricing">
        <div className="lp-container">
          <div className="lp-section-header">
            <div className="lp-section-eyebrow">Simple pricing</div>
            <h2 className="lp-section-title">Start free. Pay only when you're ready to grow.</h2>
            <p className="lp-section-sub">
              No credit card required. No setup fees. No contracts. Upgrade when you need more items, locations, or team members.
            </p>
          </div>

          <div className="lp-pricing-usd-note">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Subscription plans are billed in <strong>USD</strong>. Your workspace currency is configured separately for inventory costs and reports.
          </div>

          <div className="lp-pricing-note">
            <span className="lp-pricing-note-icon">💬</span>
            Online payment not live yet? No problem — select your plan and our team will reach out to activate your account manually.
          </div>

          <div className="lp-pricing-grid">
            {pricing.map((plan) => (
              <div
                key={plan.id ?? plan.tier}
                className={`lp-pricing-card ${plan.highlight ? "lp-pricing-card--highlight" : ""}`}
              >
                {plan.highlight && <div className="lp-pricing-popular">Most popular</div>}
                <div className="lp-pricing-tier" style={{ color: plan.color }}>{plan.tier}</div>
                {plan.isCustom ? (
                  <div className="lp-pricing-price lp-pricing-price--custom">
                    <span className="lp-pricing-custom-label">Custom pricing</span>
                    <span className="lp-pricing-custom-sub">Tailored for larger teams</span>
                  </div>
                ) : (
                  <div className="lp-pricing-price">
                    <span className="lp-pricing-currency">$</span>
                    <span className="lp-pricing-amount">{plan.price}</span>
                    <span className="lp-pricing-period">{plan.period}</span>
                  </div>
                )}
                <p className="lp-pricing-desc">{plan.desc}</p>
                {plan.limits.length > 0 && (
                  <div className="lp-pricing-limits">
                    {plan.limits.map((l) => (
                      <span key={l} className="lp-pricing-limit-chip">{l}</span>
                    ))}
                  </div>
                )}
                <ul className="lp-pricing-features">
                  {plan.features.map((f) => (
                    <li key={f.label} className={`lp-pricing-feature${f.included ? "" : " lp-pricing-feature--dim"}`}>
                      {f.included ? CHECK_ICON : CROSS_ICON}
                      {f.label}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className={`lp-pricing-cta ${plan.highlight ? "lp-pricing-cta--primary" : "lp-pricing-cta--outline"}`}
                  style={plan.highlight ? { background: plan.color } : { borderColor: plan.color, color: plan.color }}
                  onClick={handlePrimaryCta}
                >
                  {isAuthenticated
                    ? "Open dashboard"
                    : plan.isCustom
                    ? "Contact Sales"
                    : plan.tier === "Free"
                    ? "Start free"
                    : `Choose ${plan.tier}`}
                </button>
                {!isAuthenticated && (
                  <p className="lp-pricing-footnote">
                    {plan.isCustom
                      ? "Custom quotation available"
                      : plan.tier === "Free"
                      ? "No credit card required"
                      : "Manual activation available"}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA banner ─────────────────────────────────── */}
      <section className="lp-cta">
        <div className="lp-cta-bg" aria-hidden />
        <div className="lp-container lp-cta-inner">
          <h2 className="lp-cta-title">Your stock is costing you more than you think.</h2>
          <p className="lp-cta-sub">
            Every expired product, every emergency reorder, every stockout is a cost ShelfSense helps you avoid. Set up your workspace in minutes — free, no card needed.
          </p>
          <div className="lp-cta-actions">
            <button type="button" className="lp-btn lp-btn--cta-primary" onClick={handlePrimaryCta}>
              {isAuthenticated ? "Go to app →" : "Create your free workspace →"}
            </button>
            {!isAuthenticated && (
              <Link to="/login" className="lp-btn lp-btn--cta-ghost">Sign in</Link>
            )}
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────── */}
      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div className="lp-footer-brand">
            <div className="lp-footer-brand-row">
              <span className="lp-nav-logo-mark lp-footer-logo-mark">S</span>
              <span className="lp-nav-logo-text lp-footer-logo-text">ShelfSense</span>
            </div>
            <p className="lp-footer-tagline">Inventory management for businesses that cannot afford blind spots.</p>
          </div>
          <div className="lp-footer-links">
            <div className="lp-footer-col">
              <span className="lp-footer-col-title">Product</span>
              <button type="button" className="lp-footer-link" onClick={() => scrollTo("features")}>Features</button>
              <button type="button" className="lp-footer-link" onClick={() => scrollTo("pricing")}>Pricing</button>
              <button type="button" className="lp-footer-link" onClick={() => scrollTo("who")}>Who it's for</button>
            </div>
            <div className="lp-footer-col">
              <span className="lp-footer-col-title">Account</span>
              <Link to="/signup" className="lp-footer-link">Sign up free</Link>
              <Link to="/login" className="lp-footer-link">Sign in</Link>
            </div>
            <div className="lp-footer-col">
              <span className="lp-footer-col-title">Legal</span>
              <Link to="/privacy" className="lp-footer-link">Privacy policy</Link>
              <Link to="/terms" className="lp-footer-link">Terms of service</Link>
              <a href="mailto:hello@shelfsense.com" className="lp-footer-link">Contact us</a>
            </div>
          </div>
        </div>
        <div className="lp-footer-bottom">
          <div className="lp-container lp-footer-bottom-inner">
            <span>© {new Date().getFullYear()} ShelfSense. All rights reserved.</span>
            <span className="lp-footer-bottom-tagline">Built for real inventory teams.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
