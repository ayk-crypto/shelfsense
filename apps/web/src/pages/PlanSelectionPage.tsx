import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getOnboardingStatus } from "../api/onboarding";
import { getPublicPlans, previewSubscription, selectPlan } from "../api/subscriptions";
import type { PublicPlan, SubscriptionPreview } from "../types";
import { LegalFooterLinks } from "./LegalPage";
import { isPaddleConfigured } from "../lib/paddle";

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

const PLAN_BUTTON_TEXT: Record<string, string> = {
  FREE: "Start Free",
  STARTER: "Choose Basic",
  PRO: "Choose Pro",
  BUSINESS: "Choose Business",
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

  const btnText = PLAN_BUTTON_TEXT[plan.code] ?? `Choose ${plan.name}`;

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
            <span className="plan-price-currency">$</span>
            <span className="plan-price-amount">{monthlyEquiv.toLocaleString()}</span>
            <span className="plan-price-period">/mo</span>
          </>
        )}
        {billingCycle === "ANNUAL" && !isFree && (
          <div className="plan-price-annual-note">
            $ {plan.annualPrice.toLocaleString()} billed annually
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
        ) : btnText}
      </button>
    </div>
  );
}

function PlanSelectedSuccess({ plan }: { plan: PublicPlan }) {
  const navigate = useNavigate();
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
          <div className="plan-sel-progress-step plan-sel-progress-step--done">
            <span className="plan-sel-progress-icon">✓</span>
            Choose Plan
          </div>
          <div className="plan-sel-progress-connector plan-sel-progress-connector--done" />
          <div className="plan-sel-progress-step plan-sel-progress-step--active">
            <span className="plan-sel-progress-icon plan-sel-progress-icon--active">3</span>
            Dashboard
          </div>
        </div>
      </header>

      <div className="plan-sel-success">
        <div className="plan-sel-success-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        </div>
        <h1 className="plan-sel-success-title">Plan Selected!</h1>
        <p className="plan-sel-success-plan-name">{plan.name} Plan</p>
        <p className="plan-sel-success-msg">
          Thank you for choosing the <strong>{plan.name}</strong> plan. Your selection has been saved.
          Since online payment isn't enabled yet, our team will reach out to you shortly to activate billing.
          You can access your dashboard right away — your account is ready to use.
        </p>
        <div className="plan-sel-success-note">
          <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 15, height: 15, flexShrink: 0, marginTop: 1 }}>
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          <span>Paid features will be unlocked once our team activates your subscription.</span>
        </div>
        <button
          type="button"
          className="plan-sel-success-btn"
          onClick={() => navigate("/dashboard", { replace: true })}
        >
          Continue to Dashboard →
        </button>
      </div>
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
  const [planConfirmed, setPlanConfirmed] = useState(false);
  const [confirmedPlan, setConfirmedPlan] = useState<PublicPlan | null>(null);

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
    if (!selectedPlan) return "Continue";
    if (isFree) return "Start Free";
    const payable = getPayableAmount();
    if (payable === 0) return "Activate Plan — No Payment Required";
    if (isPaddleConfigured()) return "Continue to Checkout";
    return "Save Plan & Continue";
  }

  function showPendingPaymentNote(): boolean {
    if (isFree) return false;
    if (isPaddleConfigured()) return false;
    return getPayableAmount() > 0;
  }

  async function handleConfirm() {
    if (!selectedPlanId || !selectedPlan) return;
    setConfirming(true);
    setConfirmError(null);

    const payable = getPayableAmount();
    const isPayable = !isFree && payable > 0;

    // Paid plan + Paddle configured → redirect to full checkout page
    if (isPayable && isPaddleConfigured()) {
      navigate(`/billing/checkout?plan=${selectedPlan.code}&cycle=${billingCycle}`);
      return;
    }

    // Paid plan + Paddle NOT configured → block.
    // Do not allow a direct paid-plan activation bypass when Paddle is the
    // expected payment provider but the client token is absent.
    if (isPayable) {
      setConfirmError("Online payment is currently unavailable. Please contact support to activate your plan.");
      setConfirming(false);
      return;
    }

    // Free plan or 100%-discounted coupon → activate directly.
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

  if (planConfirmed && confirmedPlan) {
    return <PlanSelectedSuccess plan={confirmedPlan} />;
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
        <p className="plan-sel-billing-note">
          ShelfSense subscription plans are billed in USD. Your workspace currency can be configured later for inventory and reporting.
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

      <div className="plan-sel-cards-section">
        <div className="plan-cards-grid">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              selected={plan.id === selectedPlanId}
              billingCycle={billingCycle}
              onSelect={() => void handleSelectPlan(plan.id)}
            />
          ))}
        </div>
      </div>

      {selectedPlan && (
        <div className="plan-sel-cta-section">
          <div className="plan-confirm-inner">
            <div className="plan-confirm-top-row">
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
                    <span>$ {baseAmount.toLocaleString()}</span>
                  </div>
                  {discountAmount > 0 && (
                    <div className="plan-price-row plan-price-row--discount">
                      <span>Promo discount</span>
                      <span>− $ {discountAmount.toLocaleString()}</span>
                    </div>
                  )}
                  <div className="plan-price-row plan-price-row--total">
                    <span>Amount due</span>
                    <span>
                      {payableAmount === 0
                        ? "Free"
                        : `$ ${payableAmount.toLocaleString()}`}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="plan-confirm-actions-col">
              {showPendingPaymentNote() && (
                <div className="plan-pending-note">
                  <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 16, height: 16, flexShrink: 0, marginTop: 1 }}>
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                  <div>
                    <strong>Your plan will be saved.</strong> Our team will contact you to activate billing. You'll have full dashboard access in the meantime.
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
                  <><div className="spinner spinner--sm spinner--white" /> Saving…</>
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
          </div>
        </div>
      )}
      <LegalFooterLinks />
    </div>
  );
}
