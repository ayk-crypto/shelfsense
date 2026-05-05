import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getOnboardingStatus } from "../api/onboarding";
import { getPublicPlans, previewSubscription, selectPlan } from "../api/subscriptions";
import type { PublicPlan, SubscriptionPreview } from "../types";

const RECOMMENDED_CODE = "STARTER";

const FEATURE_ICONS: Record<string, string> = {
  enableExpiryTracking: "Expiry date tracking",
  enableBarcodeScanning: "Barcode scanning",
  enableReports: "Inventory reports",
  enableAdvancedReports: "Advanced analytics",
  enablePurchases: "Purchase orders",
  enableSuppliers: "Supplier management",
  enableTeamManagement: "Team management",
  enableCustomRoles: "Custom team roles",
  enableEmailAlerts: "Email alerts",
  enableDailyOps: "Daily operations checklist",
};

function formatLimit(val: number | null, label: string): string {
  if (val === null || val === -1) return `Unlimited ${label}`;
  return `Up to ${val.toLocaleString()} ${label}`;
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );
}

function PlanCard({
  plan,
  selected,
  billingCycle,
  onSelect,
}: {
  plan: PublicPlan;
  selected: boolean;
  billingCycle: "MONTHLY" | "ANNUAL";
  onSelect: () => void;
}) {
  const isFree = plan.code === "FREE" || (plan.monthlyPrice === 0 && plan.annualPrice === 0);
  const price = isFree ? 0 : billingCycle === "ANNUAL" ? plan.annualPrice : plan.monthlyPrice;
  const monthlyEquiv = billingCycle === "ANNUAL" && !isFree ? Math.round(plan.annualPrice / 12) : price;
  const isRecommended = plan.code === RECOMMENDED_CODE;

  const enabledFeatures = Object.entries(FEATURE_ICONS)
    .filter(([key]) => plan[key as keyof PublicPlan] === true)
    .map(([, label]) => label);

  return (
    <div
      className={`plan-card ${selected ? "plan-card--selected" : ""} ${isRecommended ? "plan-card--recommended" : ""}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      aria-pressed={selected}
    >
      {isRecommended && <div className="plan-card-badge">Most Popular</div>}

      <div className="plan-card-header">
        <h3 className="plan-card-name">{plan.name}</h3>
        {plan.description && <p className="plan-card-desc">{plan.description}</p>}
      </div>

      <div className="plan-card-price">
        {isFree ? (
          <span className="plan-price-amount">Free</span>
        ) : (
          <>
            <span className="plan-price-currency">{plan.currency}</span>
            <span className="plan-price-amount">{monthlyEquiv.toLocaleString()}</span>
            <span className="plan-price-period">/mo</span>
          </>
        )}
        {billingCycle === "ANNUAL" && !isFree && (
          <div className="plan-price-annual-note">
            {plan.currency} {plan.annualPrice.toLocaleString()} billed annually
          </div>
        )}
      </div>

      <div className="plan-card-limits">
        {plan.maxItems !== null && <div className="plan-limit-item">{formatLimit(plan.maxItems, "items")}</div>}
        {plan.maxLocations !== null && <div className="plan-limit-item">{formatLimit(plan.maxLocations, "locations")}</div>}
        {plan.maxUsers !== null && <div className="plan-limit-item">{formatLimit(plan.maxUsers, "team members")}</div>}
      </div>

      <ul className="plan-card-features">
        {enabledFeatures.map((label) => (
          <li key={label} className="plan-feature-item">
            <CheckIcon className="plan-feature-check" />
            {label}
          </li>
        ))}
      </ul>

      <button
        className={`plan-card-btn ${selected ? "plan-card-btn--selected" : ""}`}
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
        type="button"
      >
        {selected ? (
          <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <CheckIcon className="plan-card-btn-check" />
            Selected
          </span>
        ) : `Choose ${plan.name}`}
      </button>
    </div>
  );
}

export function PlanSelectionPage() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<"MONTHLY" | "ANNUAL">("MONTHLY");
  const [couponCode, setCouponCode] = useState("");
  const [couponInput, setCouponInput] = useState("");
  const [preview, setPreview] = useState<SubscriptionPreview | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [couponSuccess, setCouponSuccess] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [statusRes, plansRes] = await Promise.all([
          getOnboardingStatus(),
          getPublicPlans(),
        ]);
        if (cancelled) return;
        if (statusRes.hasSelectedPlan) {
          navigate("/dashboard", { replace: true });
          return;
        }
        if (!statusRes.onboardingCompleted) {
          navigate("/onboarding", { replace: true });
          return;
        }
        const publicPlans = plansRes.plans;
        setPlans(publicPlans);
        const recommended = publicPlans.find((p) => p.code === RECOMMENDED_CODE) ?? publicPlans[0];
        if (recommended) setSelectedPlanId(recommended.id);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load plans");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void init();
    return () => { cancelled = true; };
  }, [navigate]);

  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? null;
  const isFree = selectedPlan
    ? selectedPlan.code === "FREE" || (selectedPlan.monthlyPrice === 0 && selectedPlan.annualPrice === 0)
    : false;

  async function handleApplyCoupon() {
    if (!selectedPlanId || !couponInput.trim() || isFree) return;
    setCouponLoading(true);
    setCouponError(null);
    setCouponSuccess(null);
    try {
      const result = await previewSubscription({
        planId: selectedPlanId,
        billingCycle,
        couponCode: couponInput.trim(),
      });
      if (result.couponApplied) {
        setCouponCode(couponInput.trim());
        setPreview(result);
        setCouponSuccess(result.couponMessage);
        setCouponError(null);
      } else {
        setCouponCode("");
        setPreview(null);
        setCouponError(result.couponMessage || "Invalid coupon code.");
        setCouponSuccess(null);
      }
    } catch (e) {
      setCouponError(e instanceof Error ? e.message : "Failed to apply coupon");
    } finally {
      setCouponLoading(false);
    }
  }

  function handleRemoveCoupon() {
    setCouponCode("");
    setCouponInput("");
    setCouponSuccess(null);
    setCouponError(null);
    setPreview(null);
  }

  async function handleSelectPlan(planId: string) {
    setSelectedPlanId(planId);
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    const planIsFree = plan.code === "FREE" || (plan.monthlyPrice === 0 && plan.annualPrice === 0);
    if (planIsFree) {
      handleRemoveCoupon();
    } else if (couponCode) {
      setCouponLoading(true);
      try {
        const result = await previewSubscription({ planId, billingCycle, couponCode });
        if (result.couponApplied) {
          setPreview(result);
          setCouponSuccess(result.couponMessage);
        } else {
          handleRemoveCoupon();
          setCouponError(result.couponMessage || "Coupon not applicable to this plan.");
        }
      } catch {
        handleRemoveCoupon();
      } finally {
        setCouponLoading(false);
      }
    }
  }

  function getBaseAmount(): number {
    if (!selectedPlan || isFree) return 0;
    return billingCycle === "ANNUAL" ? selectedPlan.annualPrice : selectedPlan.monthlyPrice;
  }

  function getPayableAmount(): number {
    if (preview) return preview.payableAmount;
    return getBaseAmount();
  }

  function getCtaText(): string {
    if (isFree) return "Start for Free";
    const payable = getPayableAmount();
    if (payable === 0) return "Activate Plan — No Payment Required";
    return "Continue to Billing";
  }

  function showPendingPaymentNote(): boolean {
    if (isFree) return false;
    return getPayableAmount() > 0;
  }

  async function handleConfirm() {
    if (!selectedPlanId) return;
    setConfirming(true);
    setConfirmError(null);
    try {
      await selectPlan({
        planId: selectedPlanId,
        billingCycle: isFree ? "MONTHLY" : billingCycle,
        couponCode: couponCode || undefined,
      });
      navigate("/dashboard", { replace: true });
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : "Failed to activate plan. Please try again.");
      setConfirming(false);
    }
  }

  if (loading) {
    return (
      <div className="plan-sel-loading">
        <div className="spinner" />
        <p>Loading plans…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="plan-sel-error">
        <div className="alert alert--error">{error}</div>
        <button className="btn btn--primary" onClick={() => window.location.reload()} type="button">Retry</button>
      </div>
    );
  }

  const baseAmount = getBaseAmount();
  const discountAmount = preview?.discountAmount ?? 0;
  const payableAmount = getPayableAmount();

  return (
    <div className="plan-sel-page">
      <header className="plan-sel-header">
        <div className="plan-sel-logo">
          <span className="plan-sel-logo-mark">S</span>
          <span className="plan-sel-logo-text">ShelfSense</span>
        </div>
        <div className="plan-sel-progress">
          <div className="plan-sel-progress-step plan-sel-progress-step--done">
            <span className="plan-sel-progress-icon">✓</span>
            Workspace Setup
          </div>
          <div className="plan-sel-progress-connector plan-sel-progress-connector--done" />
          <div className="plan-sel-progress-step plan-sel-progress-step--active">
            <span className="plan-sel-progress-icon plan-sel-progress-icon--active">2</span>
            Choose Plan
          </div>
          <div className="plan-sel-progress-connector" />
          <div className="plan-sel-progress-step">
            <span className="plan-sel-progress-icon">3</span>
            Dashboard
          </div>
        </div>
      </header>

      <div className="plan-sel-hero">
        <h1 className="plan-sel-title">Choose your plan</h1>
        <p className="plan-sel-subtitle">
          Start free and upgrade as you grow. No credit card required to get started.
        </p>

        <div className="plan-billing-toggle">
          <button
            type="button"
            className={`billing-toggle-btn ${billingCycle === "MONTHLY" ? "billing-toggle-btn--active" : ""}`}
            onClick={() => setBillingCycle("MONTHLY")}
          >
            Monthly
          </button>
          <button
            type="button"
            className={`billing-toggle-btn ${billingCycle === "ANNUAL" ? "billing-toggle-btn--active" : ""}`}
            onClick={() => setBillingCycle("ANNUAL")}
          >
            Annual
            <span className="billing-toggle-save">Save 17%</span>
          </button>
        </div>
      </div>

      <div className="plan-sel-body">
        <div className="plan-cards-col">
          <div className="plan-cards-grid">
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                selected={plan.id === selectedPlanId}
                billingCycle={billingCycle}
                onSelect={() => handleSelectPlan(plan.id)}
              />
            ))}
          </div>
        </div>

        <div className="plan-confirm-sidebar">
          {selectedPlan && (
          <div className="plan-confirm-inner">
            <div className="plan-confirm-selected">
              <div className="plan-confirm-selected-label">Your selection</div>
              <div className="plan-confirm-selected-name">
                {selectedPlan.name}
                {!isFree && (
                  <span className="plan-confirm-cycle">
                    {billingCycle === "ANNUAL" ? " · Billed annually" : " · Billed monthly"}
                  </span>
                )}
              </div>
            </div>

            {!isFree && (
              <div className="plan-coupon-section">
                <div className="plan-coupon-label">Promo code</div>
                {couponCode ? (
                  <div className="plan-coupon-applied">
                    <span className="plan-coupon-applied-code">{couponCode}</span>
                    <button type="button" className="plan-coupon-remove" onClick={handleRemoveCoupon}>Remove</button>
                  </div>
                ) : (
                  <div className="plan-coupon-input-row">
                    <input
                      className="plan-coupon-input"
                      type="text"
                      placeholder="e.g. LAUNCH100"
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === "Enter" && !couponLoading && void handleApplyCoupon()}
                    />
                    <button
                      type="button"
                      className="plan-coupon-apply-btn"
                      onClick={() => void handleApplyCoupon()}
                      disabled={couponLoading || !couponInput.trim()}
                    >
                      {couponLoading ? "…" : "Apply"}
                    </button>
                  </div>
                )}
                {couponSuccess && <div className="plan-coupon-success">✓ {couponSuccess}</div>}
                {couponError && <div className="plan-coupon-error">{couponError}</div>}
              </div>
            )}

            {!isFree && (
              <div className="plan-price-summary">
                <div className="plan-price-row">
                  <span>{billingCycle === "ANNUAL" ? "Annual total" : "Monthly total"}</span>
                  <span>{selectedPlan.currency} {baseAmount.toLocaleString()}</span>
                </div>
                {discountAmount > 0 && (
                  <div className="plan-price-row plan-price-row--discount">
                    <span>Promo discount</span>
                    <span>− {selectedPlan.currency} {discountAmount.toLocaleString()}</span>
                  </div>
                )}
                <div className="plan-price-row plan-price-row--total">
                  <span>Amount due</span>
                  <span>
                    {payableAmount === 0
                      ? "Free"
                      : `${selectedPlan.currency} ${payableAmount.toLocaleString()}`}
                  </span>
                </div>
              </div>
            )}

            {showPendingPaymentNote() && (
              <div className="plan-pending-note">
                <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 16, height: 16, flexShrink: 0, marginTop: 1 }}>
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <div>
                  <strong>Payment gateway not connected.</strong> Your plan will be activated in manual review mode — you'll have full dashboard access while our team processes your account. A payment link will be sent separately.
                </div>
              </div>
            )}

            {confirmError && <div className="alert alert--error">{confirmError}</div>}

            <button
              type="button"
              className={`plan-confirm-btn ${isFree ? "plan-confirm-btn--free" : payableAmount === 0 ? "plan-confirm-btn--activate" : "plan-confirm-btn--pending"}`}
              onClick={() => void handleConfirm()}
              disabled={confirming}
            >
              {confirming ? (
                <><div className="spinner spinner--sm spinner--white" /> Activating…</>
              ) : (
                getCtaText()
              )}
            </button>

            <div className="plan-confirm-trust">
              <span className="plan-confirm-trust-item">
                <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 13, height: 13 }}>
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Cancel anytime
              </span>
              <span className="plan-confirm-trust-item">
                <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 13, height: 13 }}>
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                {isFree ? "No credit card required" : "Upgrade or downgrade anytime"}
              </span>
              <span className="plan-confirm-trust-item">
                <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 13, height: 13 }}>
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Change plan from dashboard
              </span>
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
