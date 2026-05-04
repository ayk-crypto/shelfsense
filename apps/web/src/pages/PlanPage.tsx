import { useEffect, useState } from "react";
import { changePlan, getPlanStatus } from "../api/plan";
import type { PlanStatus, PlanTier } from "../types";

const PLAN_META: Record<
  PlanTier,
  { label: string; color: string; bg: string; badge: string; description: string }
> = {
  FREE:  { label: "Free",  color: "#64748b", bg: "#f8fafc", badge: "bg-slate",  description: "Get started with the essentials" },
  BASIC: { label: "Basic", color: "#3b82f6", bg: "#eff6ff", badge: "bg-blue",   description: "Grow your inventory operations" },
  PRO:   { label: "Pro",   color: "#6366f1", bg: "#eef2ff", badge: "bg-indigo", description: "Unlimited scale for serious businesses" },
};

const PLAN_TIERS: PlanTier[] = ["FREE", "BASIC", "PRO"];

const PLAN_LIMITS_DISPLAY: Record<PlanTier, { items: string; locations: string; users: string }> = {
  FREE:  { items: "50 items",       locations: "1 location",   users: "3 users"      },
  BASIC: { items: "500 items",      locations: "5 locations",  users: "10 users"     },
  PRO:   { items: "Unlimited items",locations: "Unlimited locations", users: "Unlimited users" },
};

function usagePercent(used: number, max: number): number {
  if (max === -1) return 0;
  return Math.min(100, Math.round((used / max) * 100));
}

function usageColor(pct: number, max: number): string {
  if (max === -1) return "var(--color-green)";
  if (pct >= 100) return "var(--color-danger)";
  if (pct >= 80) return "#f59e0b";
  return "var(--color-green)";
}

interface UsageBarProps {
  label: string;
  used: number;
  max: number;
  icon: React.ReactNode;
}

function UsageBar({ label, used, max, icon }: UsageBarProps) {
  const pct = usagePercent(used, max);
  const color = usageColor(pct, max);
  const isUnlimited = max === -1;
  const atLimit = !isUnlimited && used >= max;
  const nearLimit = !isUnlimited && pct >= 80 && !atLimit;

  return (
    <div className="plan-usage-row">
      <div className="plan-usage-label">
        <span className="plan-usage-icon">{icon}</span>
        <span>{label}</span>
        {atLimit && <span className="plan-limit-badge plan-limit-badge--danger">At limit</span>}
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
      </div>
    </div>
  );
}

export function PlanPage() {
  const [status, setStatus] = useState<PlanStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<PlanTier | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switchSuccess, setSwitchSuccess] = useState<string | null>(null);

  useEffect(() => {
    getPlanStatus()
      .then(setStatus)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load plan"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSelectPlan(plan: PlanTier) {
    if (!status || plan === status.plan) return;
    setSwitching(plan);
    setSwitchError(null);
    setSwitchSuccess(null);
    try {
      const updated = await changePlan(plan);
      setStatus(updated);
      setSwitchSuccess(`Switched to ${PLAN_META[plan].label} plan.`);
      setTimeout(() => setSwitchSuccess(null), 4000);
    } catch (err) {
      setSwitchError(err instanceof Error ? err.message : "Failed to change plan");
    } finally {
      setSwitching(null);
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

  return (
    <div className="plan-page">
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

      {/* Plan cards */}
      <div className="plan-cards">
        {PLAN_TIERS.map((tier) => {
          const meta = PLAN_META[tier];
          const display = PLAN_LIMITS_DISPLAY[tier];
          const isCurrent = tier === plan;
          const isSwitching = switching === tier;

          return (
            <div
              key={tier}
              className={`plan-card${isCurrent ? " plan-card--active" : ""}`}
              style={isCurrent ? { borderColor: meta.color, background: meta.bg } : undefined}
            >
              <div className="plan-card-header">
                <span
                  className="plan-tier-badge"
                  style={{ background: meta.color }}
                >
                  {meta.label}
                </span>
                {isCurrent && (
                  <span className="plan-current-pill">Current plan</span>
                )}
              </div>

              <p className="plan-card-desc">{meta.description}</p>

              <ul className="plan-feature-list">
                <li className="plan-feature-item">
                  <svg className="plan-feature-check" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  {display.items}
                </li>
                <li className="plan-feature-item">
                  <svg className="plan-feature-check" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  {display.locations}
                </li>
                <li className="plan-feature-item">
                  <svg className="plan-feature-check" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  {display.users}
                </li>
                <li className="plan-feature-item">
                  <svg className="plan-feature-check" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  All core inventory features
                </li>
              </ul>

              {isCurrent ? (
                <div className="plan-card-action plan-card-action--current">
                  <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 16, height: 16 }}>
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Active
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn--primary plan-card-action"
                  style={{ background: meta.color }}
                  onClick={() => void handleSelectPlan(tier)}
                  disabled={!!switching}
                >
                  {isSwitching ? (
                    <><span className="spinner spinner--sm spinner--white" /> Switching…</>
                  ) : (
                    `Switch to ${meta.label}`
                  )}
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
        <span>Payment integration is not yet enabled. Plan changes take effect immediately at no charge during this preview period.</span>
      </div>
    </div>
  );
}
