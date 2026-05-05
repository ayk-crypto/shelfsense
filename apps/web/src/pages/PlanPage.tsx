import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { changePlan, getPlanStatus } from "../api/plan";
import type { PlanStatus, PlanTier } from "../types";

// ─── Plan metadata ────────────────────────────────────────────────────────────

const PLAN_META: Record<
  PlanTier,
  { label: string; color: string; bg: string; description: string; price: string }
> = {
  FREE:  {
    label: "Free",
    color: "#64748b",
    bg: "#f8fafc",
    description: "Get started with the essentials",
    price: "Free forever",
  },
  BASIC: {
    label: "Basic",
    color: "#3b82f6",
    bg: "#eff6ff",
    description: "Grow your inventory operations",
    price: "Coming soon",
  },
  PRO: {
    label: "Pro",
    color: "#6366f1",
    bg: "#eef2ff",
    description: "Unlimited scale for serious businesses",
    price: "Coming soon",
  },
};

const PLAN_TIERS: PlanTier[] = ["FREE", "BASIC", "PRO"];

// Differentiated feature lists per plan
const PLAN_FEATURES: Record<PlanTier, string[]> = {
  FREE: [
    "50 inventory items",
    "1 location",
    "3 team members",
    "Stock in / out tracking",
    "Expiry date alerts",
    "Basic reports",
  ],
  BASIC: [
    "500 inventory items",
    "5 locations",
    "10 team members",
    "Everything in Free",
    "Purchase orders",
    "Full reports + CSV export",
    "Custom roles & permissions",
    "Priority email support",
  ],
  PRO: [
    "Unlimited inventory items",
    "Unlimited locations",
    "Unlimited team members",
    "Everything in Basic",
    "Advanced analytics",
    "API access",
    "Dedicated account manager",
    "SLA support",
  ],
};

const PLAN_LIMITS_NEW: Record<PlanTier, { items: string; locations: string; users: string }> = {
  FREE:  { items: "50 items",        locations: "1 location",          users: "3 users"           },
  BASIC: { items: "500 items",       locations: "5 locations",         users: "10 users"          },
  PRO:   { items: "Unlimited items", locations: "Unlimited locations",  users: "Unlimited users"   },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function usagePercent(used: number, max: number): number {
  if (max === -1) return 0;
  return Math.min(100, Math.round((used / max) * 100));
}

function usageColor(pct: number, max: number): string {
  if (max === -1) return "var(--color-green)";
  if (pct >= 100) return "var(--color-danger)";
  if (pct >= 80)  return "#f59e0b";
  return "var(--color-green)";
}

// ─── Confirmation modal ───────────────────────────────────────────────────────

interface ConfirmModalProps {
  from: PlanTier;
  to: PlanTier;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}

function ConfirmModal({ from, to, onConfirm, onCancel, loading }: ConfirmModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const toMeta = PLAN_META[to];
  const toLimits = PLAN_LIMITS_NEW[to];
  const isUpgrade = PLAN_TIERS.indexOf(to) > PLAN_TIERS.indexOf(from);
  const verb = isUpgrade ? "Upgrade" : "Downgrade";

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === overlayRef.current) onCancel();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="plan-confirm-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="plan-confirm-modal" role="dialog" aria-modal="true" aria-label={`${verb} plan confirmation`}>
        <div className="plan-confirm-header">
          <span
            className="plan-confirm-tier-badge"
            style={{ background: toMeta.color }}
          >
            {toMeta.label}
          </span>
          <h2 className="plan-confirm-title">{verb} to {toMeta.label}?</h2>
        </div>

        <p className="plan-confirm-desc">
          You are switching from <strong>{PLAN_META[from].label}</strong> to{" "}
          <strong>{toMeta.label}</strong>.{" "}
          {isUpgrade
            ? "Your new limits will be available immediately."
            : "Reduced limits take effect immediately — make sure you are within the new limits before downgrading."}
        </p>

        <div className="plan-confirm-limits">
          <div className="plan-confirm-limit-row">
            <span className="plan-confirm-limit-label">Items</span>
            <span className="plan-confirm-limit-value">{toLimits.items}</span>
          </div>
          <div className="plan-confirm-limit-row">
            <span className="plan-confirm-limit-label">Locations</span>
            <span className="plan-confirm-limit-value">{toLimits.locations}</span>
          </div>
          <div className="plan-confirm-limit-row">
            <span className="plan-confirm-limit-label">Team members</span>
            <span className="plan-confirm-limit-value">{toLimits.users}</span>
          </div>
        </div>

        <p className="plan-confirm-preview-note">
          You are in preview mode. Plan upgrades are free for now. Billing will be enabled soon.
        </p>

        <div className="plan-confirm-actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            style={{ background: toMeta.color }}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? (
              <><span className="spinner spinner--sm spinner--white" /> Switching…</>
            ) : (
              `Confirm ${verb}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── UsageBar ─────────────────────────────────────────────────────────────────

interface UsageBarProps {
  label: string;
  used: number;
  max: number;
  icon: React.ReactNode;
  currentPlan: PlanTier;
  onUpgradeClick?: () => void;
}

function UsageBar({ label, used, max, icon, currentPlan, onUpgradeClick }: UsageBarProps) {
  const pct = usagePercent(used, max);
  const color = usageColor(pct, max);
  const isUnlimited = max === -1;
  const atLimit = !isUnlimited && used >= max;
  const nearLimit = !isUnlimited && pct >= 80 && !atLimit;
  const remaining = isUnlimited ? null : Math.max(0, max - used);
  const showUpgradeCta = atLimit && currentPlan !== "PRO";

  return (
    <div className={`plan-usage-row${atLimit ? " plan-usage-row--at-limit" : ""}`}>
      <div className="plan-usage-label">
        <span className="plan-usage-icon">{icon}</span>
        <span>{label}</span>
        {atLimit && (
          <span className="plan-limit-badge plan-limit-badge--danger">
            <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 10, height: 10 }}>
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            At limit
          </span>
        )}
        {nearLimit && <span className="plan-limit-badge plan-limit-badge--warn">Near limit</span>}
      </div>

      <div className="plan-usage-right">
        <span className="plan-usage-count">
          {used.toLocaleString()}
          {!isUnlimited && <span className="plan-usage-max"> / {max.toLocaleString()}</span>}
          {isUnlimited && <span className="plan-usage-max"> / ∞</span>}
        </span>
        <div className="plan-usage-track">
          <div
            className="plan-usage-fill"
            style={{ width: isUnlimited ? "8px" : `${pct}%`, background: color }}
          />
        </div>
        {!isUnlimited && (
          <span className="plan-usage-pct" style={{ color }}>{pct}%</span>
        )}
        {remaining !== null && !atLimit && (
          <span className="plan-usage-remaining">{remaining.toLocaleString()} remaining</span>
        )}
      </div>

      {showUpgradeCta && (
        <button
          type="button"
          className="plan-usage-upgrade-cta"
          onClick={onUpgradeClick}
        >
          Upgrade for more
          <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 12, height: 12 }}>
            <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ─── Check icon ───────────────────────────────────────────────────────────────

function CheckIcon({ color }: { color?: string }) {
  return (
    <svg
      className="plan-feature-check"
      viewBox="0 0 20 20"
      fill="currentColor"
      style={color ? { color } : undefined}
    >
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );
}

// ─── PlanPage ─────────────────────────────────────────────────────────────────

export function PlanPage() {
  const navigate = useNavigate();
  const [status, setStatus]           = useState<PlanStatus | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<PlanTier | null>(null);
  const [switching, setSwitching]     = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switchSuccess, setSwitchSuccess] = useState<string | null>(null);
  const plansRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getPlanStatus()
      .then(setStatus)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load plan"))
      .finally(() => setLoading(false));
  }, []);

  function scrollToPlans() {
    plansRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function requestPlanChange(tier: PlanTier) {
    if (!status || tier === status.plan) return;
    setConfirmTarget(tier);
    setSwitchError(null);
    setSwitchSuccess(null);
  }

  async function confirmPlanChange() {
    if (!confirmTarget || !status) return;
    setSwitching(true);
    try {
      const updated = await changePlan(confirmTarget);
      setStatus(updated);
      setSwitchSuccess(`Switched to ${PLAN_META[confirmTarget].label} plan successfully.`);
      setTimeout(() => setSwitchSuccess(null), 5000);
    } catch (err) {
      setSwitchError(err instanceof Error ? err.message : "Failed to change plan");
    } finally {
      setSwitching(false);
      setConfirmTarget(null);
    }
  }

  if (loading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Loading plan details…</p>
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className="page-error">
        <div className="alert alert--error">{error ?? "Unable to load plan"}</div>
      </div>
    );
  }

  const { plan, limits, usage } = status;

  const anyAtLimit =
    (limits.maxItems !== -1 && usage.items >= limits.maxItems) ||
    (limits.maxLocations !== -1 && usage.locations >= limits.maxLocations) ||
    (limits.maxUsers !== -1 && usage.users >= limits.maxUsers);

  return (
    <div className="plan-page">
      {confirmTarget && status && (
        <ConfirmModal
          from={status.plan}
          to={confirmTarget}
          onConfirm={() => void confirmPlanChange()}
          onCancel={() => setConfirmTarget(null)}
          loading={switching}
        />
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Subscription Plan</h1>
          <p className="page-subtitle">Manage your plan and view usage against your current limits.</p>
        </div>
      </div>

      {switchSuccess && (
        <div className="alert alert--success plan-switch-alert">{switchSuccess}</div>
      )}
      {switchError && (
        <div className="alert alert--error plan-switch-alert">{switchError}</div>
      )}

      {/* At-limit upgrade banner */}
      {anyAtLimit && plan !== "PRO" && (
        <div className="plan-limit-banner">
          <div className="plan-limit-banner-inner">
            <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 18, height: 18, flexShrink: 0, color: "#b45309" }}>
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div>
              <strong>You've reached a plan limit.</strong>{" "}
              Upgrade to add more items, locations, or team members.
            </div>
          </div>
          <button type="button" className="btn btn--primary btn--sm" onClick={scrollToPlans}>
            View upgrade options
          </button>
        </div>
      )}

      {/* Plan cards */}
      <div className="plan-cards" ref={plansRef}>
        {PLAN_TIERS.map((tier) => {
          const meta    = PLAN_META[tier];
          const display = PLAN_LIMITS_NEW[tier];
          const isCurrent  = tier === plan;
          const isPopular  = tier === "BASIC";
          const tierIndex  = PLAN_TIERS.indexOf(tier);
          const planIndex  = PLAN_TIERS.indexOf(plan);
          const isUpgrade  = tierIndex > planIndex;

          return (
            <div
              key={tier}
              className={`plan-card${isCurrent ? " plan-card--active" : ""}${isPopular ? " plan-card--popular" : ""}`}
              style={isCurrent ? { borderColor: meta.color } : undefined}
            >
              {isPopular && !isCurrent && (
                <div className="plan-popular-badge">Most popular</div>
              )}

              <div className="plan-card-header">
                <span className="plan-tier-badge" style={{ background: meta.color }}>
                  {meta.label}
                </span>
                {isCurrent && (
                  <span className="plan-current-pill">
                    <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 10, height: 10 }}>
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Current plan
                  </span>
                )}
              </div>

              <p className="plan-card-desc">{meta.description}</p>

              <div className="plan-price">
                {tier === "FREE" ? (
                  <span className="plan-price-value">Free</span>
                ) : (
                  <>
                    <span className="plan-price-coming">Coming soon</span>
                    <span className="plan-price-hint">Billing will be enabled shortly</span>
                  </>
                )}
              </div>

              <ul className="plan-feature-list">
                {PLAN_FEATURES[tier].map((feat) => (
                  <li className="plan-feature-item" key={feat}>
                    <CheckIcon color={meta.color} />
                    {feat}
                  </li>
                ))}
              </ul>

              {tier === "FREE" && !isCurrent && (
                <ul className="plan-feature-list plan-feature-list--excl">
                  <li className="plan-feature-item plan-feature-item--excl">
                    <svg className="plan-feature-x" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                    No purchase orders
                  </li>
                  <li className="plan-feature-item plan-feature-item--excl">
                    <svg className="plan-feature-x" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                    No CSV export
                  </li>
                </ul>
              )}

              <div className="plan-card-limits-summary">
                <span>{display.items}</span>
                <span className="plan-card-dot">·</span>
                <span>{display.locations}</span>
                <span className="plan-card-dot">·</span>
                <span>{display.users}</span>
              </div>

              {isCurrent ? (
                <div className="plan-card-action plan-card-action--current">
                  <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 15, height: 15 }}>
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Active plan
                </div>
              ) : (
                <button
                  type="button"
                  className={`btn plan-card-action${isUpgrade ? " plan-card-action--upgrade" : " plan-card-action--downgrade"}`}
                  style={isUpgrade ? { background: meta.color } : undefined}
                  onClick={() => requestPlanChange(tier)}
                  disabled={switching}
                >
                  {isUpgrade ? `Upgrade to ${meta.label}` : `Switch to ${meta.label}`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Usage section */}
      <div className="plan-usage-section">
        <h2 className="plan-section-title">Current Usage</h2>
        <p className="plan-section-sub">
          Your workspace is on the <strong>{PLAN_META[plan].label}</strong> plan.
          {limits.maxItems === -1
            ? " All limits are unlimited."
            : " Usage counts update in real time."}
        </p>

        <div className="plan-usage-list">
          <UsageBar
            label="Inventory items"
            used={usage.items}
            max={limits.maxItems}
            currentPlan={plan}
            onUpgradeClick={scrollToPlans}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              </svg>
            }
          />
          <UsageBar
            label="Locations"
            used={usage.locations}
            max={limits.maxLocations}
            currentPlan={plan}
            onUpgradeClick={scrollToPlans}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 12-9 12S3 17 3 10a9 9 0 1 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            }
          />
          <UsageBar
            label="Team members"
            used={usage.users}
            max={limits.maxUsers}
            currentPlan={plan}
            onUpgradeClick={scrollToPlans}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            }
          />
        </div>
      </div>

      <div className="plan-note">
        <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 16, height: 16, flexShrink: 0, marginTop: 1 }}>
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
        </svg>
        <span>
          You are currently in <strong>preview mode</strong>. Plan upgrades are free for now.
          Billing will be enabled soon.
        </span>
      </div>

      <div className="plan-support-card">
        <div className="plan-support-icon" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <div className="plan-support-body">
          <div className="plan-support-title">Need help with billing or your plan?</div>
          <p className="plan-support-text">
            Our team is happy to help with upgrades, invoices, or any billing questions.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--primary btn--sm plan-support-btn"
          onClick={() => navigate("/support")}
        >
          Contact Support
        </button>
      </div>
    </div>
  );
}
