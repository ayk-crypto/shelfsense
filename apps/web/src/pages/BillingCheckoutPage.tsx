import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getPublicPlans, previewSubscription } from "../api/subscriptions";
import { initiateCheckout, initiatePaddleCheckout } from "../api/billing";
import { isPaddleConfigured, getPaddle } from "../lib/paddle";
import type { PublicPlan, SubscriptionPreview } from "../types";
import { LegalFooterLinks } from "./LegalPage";

const RECOMMENDED_CODE = "STARTER";

const FEATURE_LABELS: Record<string, string> = {
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

const PLAN_COLORS: Record<string, string> = {
  FREE: "#64748b",
  STARTER: "#6366f1",
  PRO: "#7c3aed",
  BUSINESS: "#0f172a",
};

function FeatureCheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" style={{ width: 13, height: 13, flexShrink: 0 }} aria-hidden="true">
      <path fillRule="evenodd" d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
    </svg>
  );
}

function PlanCard({ plan, selected, billingCycle, onSelect }: {
  plan: PublicPlan; selected: boolean; billingCycle: "MONTHLY" | "ANNUAL"; onSelect: () => void;
}) {
  const isContactSales = plan.code === "BUSINESS" || plan.priceDisplayMode === "CUSTOM";
  const isFree = !isContactSales && (plan.code === "FREE" || (plan.monthlyPrice === 0 && plan.annualPrice === 0));
  const price = isFree || isContactSales ? 0 : billingCycle === "ANNUAL" ? Math.round(plan.annualPrice / 12) : plan.monthlyPrice;
  const isRecommended = plan.code === RECOMMENDED_CODE;
  const color = PLAN_COLORS[plan.code] ?? "#6366f1";

  return (
    <div
      className={`bco-plan-card${selected ? " bco-plan-card--selected" : ""}${isRecommended ? " bco-plan-card--recommended" : ""}`}
      style={selected ? ({ "--bco-color": color } as React.CSSProperties) : undefined}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      aria-pressed={selected}
    >
      {isRecommended && (
        <div className="bco-plan-badge" style={{ background: color }}>Most Popular</div>
      )}
      {selected && (
        <div className="bco-plan-check-mark" style={{ background: color }}>
          <svg viewBox="0 0 12 12" fill="currentColor" style={{ width: 8, height: 8 }}>
            <path fillRule="evenodd" d="M10.28 1.72a.75.75 0 010 1.06l-5.5 5.5a.75.75 0 01-1.06 0l-2.5-2.5a.75.75 0 011.06-1.06L4.25 6.69l4.97-4.97a.75.75 0 011.06 0z" />
          </svg>
        </div>
      )}
      <div className="bco-plan-card-name">{plan.name}</div>
      <div className="bco-plan-card-price">
        {isContactSales ? (
          <span className="bco-plan-price-text" style={{ fontSize: 16 }}>Custom</span>
        ) : isFree ? (
          <span className="bco-plan-price-text">Free</span>
        ) : (
          <>
            <span className="bco-plan-price-curr">$</span>
            <span className="bco-plan-price-text">{price}</span>
            <span className="bco-plan-price-period">/mo</span>
          </>
        )}
      </div>
      {!isFree && !isContactSales && billingCycle === "ANNUAL" && (
        <div className="bco-plan-annual-note">Billed ${plan.annualPrice}/yr</div>
      )}
    </div>
  );
}

export function BillingCheckoutPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedCode = searchParams.get("plan") ?? "";
  const preselectedCycle = (searchParams.get("cycle") ?? "") as "MONTHLY" | "ANNUAL" | "";

  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [billingCycle, setBillingCycle] = useState<"MONTHLY" | "ANNUAL">(
    preselectedCycle === "ANNUAL" ? "ANNUAL" : "MONTHLY",
  );
  const [couponCode, setCouponCode] = useState("");
  const [preview, setPreview] = useState<SubscriptionPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paddleInitialized = useRef(false);

  useEffect(() => {
    if (!paddleInitialized.current && isPaddleConfigured()) {
      paddleInitialized.current = true;
      void getPaddle().catch(() => {});
    }
  }, []);

  useEffect(() => {
    getPublicPlans()
      .then(({ plans: p }) => {
        setPlans(p);
        if (preselectedCode) {
          const match = p.find((pl) => pl.code === preselectedCode.toUpperCase());
          if (match) { setSelectedPlanId(match.id); return; }
        }
        const starter = p.find((pl) => pl.code === RECOMMENDED_CODE);
        if (starter) setSelectedPlanId(starter.id);
        else if (p.length > 0) setSelectedPlanId(p[0].id);
      })
      .catch(() => setError("Failed to load plans"))
      .finally(() => setLoading(false));
  }, [preselectedCode]);

  useEffect(() => {
    if (!selectedPlanId) return;
    setPreviewLoading(true);
    previewSubscription({ planId: selectedPlanId, billingCycle, couponCode: couponCode.trim() || undefined })
      .then(setPreview)
      .catch(() => setPreview(null))
      .finally(() => setPreviewLoading(false));
  }, [selectedPlanId, billingCycle, couponCode]);

  const selectedPlan = plans.find((p) => p.id === selectedPlanId);
  const isContactSales = selectedPlan?.code === "BUSINESS" || selectedPlan?.priceDisplayMode === "CUSTOM";
  const planColor = PLAN_COLORS[selectedPlan?.code ?? ""] ?? "#6366f1";

  const enabledFeatures = selectedPlan
    ? Object.entries(FEATURE_LABELS)
        .filter(([key]) => selectedPlan[key as keyof PublicPlan] === true)
        .map(([, label]) => label)
    : [];
  const SHOW_N = 5;
  const visibleFeatures = enabledFeatures.slice(0, SHOW_N);
  const hiddenCount = enabledFeatures.length - SHOW_N;

  async function handleCheckout() {
    if (!selectedPlanId || !selectedPlan) return;
    if (isContactSales) {
      window.location.href = "mailto:sales@shelfsenseapp.com?subject=ShelfSense Business Plan Inquiry";
      return;
    }
    setSubmitting(true);
    setError(null);

    const isFreeOrZero = selectedPlan.code === "FREE" ||
      (preview ? preview.payableAmount === 0 : (selectedPlan.monthlyPrice === 0 && selectedPlan.annualPrice === 0));

    if (isFreeOrZero) {
      try {
        const result = await initiateCheckout({ planId: selectedPlanId, billingCycle, couponCode: couponCode.trim() || undefined });
        navigate(result.isFree ? "/billing/success?reason=free" : "/billing/pending");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Checkout failed. Please try again.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (isPaddleConfigured()) {
      try {
        const data = await initiatePaddleCheckout({ planCode: selectedPlan.code, billingCycle });
        const paddle = await getPaddle();
        if (!paddle) throw new Error("Paddle failed to initialize. Please refresh and try again.");
        paddle.Checkout.open({
          items: [{ priceId: data.priceId, quantity: 1 }],
          customer: { email: data.customerEmail },
          customData: data.customData as Record<string, unknown>,
          settings: { successUrl: `${window.location.origin}/billing/success?paddle=1` },
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Checkout failed. Please try again.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setError("Payment is unavailable right now. Please refresh and try again, or contact support.");
    setSubmitting(false);
  }

  if (loading) {
    return (
      <div className="billing-fullpage">
        <div className="billing-loading">
          <div className="spinner" />
          <p>Loading plans…</p>
        </div>
      </div>
    );
  }

  const basePrice = selectedPlan && !isContactSales
    ? (billingCycle === "ANNUAL" ? selectedPlan.annualPrice : selectedPlan.monthlyPrice)
    : 0;
  const displayTotal = preview
    ? preview.payableAmount
    : basePrice;
  const isFreeTotal = displayTotal === 0 && !isContactSales;

  const ctaLabel = isContactSales
    ? "Contact Sales"
    : isFreeTotal
    ? "Activate Free Plan"
    : isPaddleConfigured()
    ? `Upgrade to ${selectedPlan?.name ?? "Selected Plan"}`
    : "Continue to Payment";

  return (
    <div className="billing-fullpage">
      <div className="bco-wrap">

        {/* ── Header ── */}
        <div className="bco-header">
          <div className="bco-logo-mark">S</div>
          <h1 className="bco-title">Choose your plan</h1>
          <p className="bco-sub">Upgrade anytime. Cancel or change plans from your billing settings.</p>
        </div>

        {/* ── Billing cycle toggle ── */}
        <div className="billing-cycle-toggle">
          <button
            className={`billing-cycle-btn${billingCycle === "MONTHLY" ? " billing-cycle-btn--active" : ""}`}
            onClick={() => setBillingCycle("MONTHLY")}
          >Monthly</button>
          <button
            className={`billing-cycle-btn${billingCycle === "ANNUAL" ? " billing-cycle-btn--active" : ""}`}
            onClick={() => setBillingCycle("ANNUAL")}
          >
            Annual
            <span className="billing-cycle-save">Save ~17%</span>
          </button>
        </div>

        {/* ── Two-column layout ── */}
        <div className="bco-cols">

          {/* Left: 2×2 plan cards */}
          <div className="bco-plan-grid">
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                selected={plan.id === selectedPlanId}
                billingCycle={billingCycle}
                onSelect={() => setSelectedPlanId(plan.id)}
              />
            ))}
          </div>

          {/* Right: Order summary */}
          {selectedPlan && (
            <div className="bco-order-card">
              <h2 className="bco-order-title">Order summary</h2>

              {/* Plan indicator */}
              <div className="bco-order-plan-row" style={{ "--bco-color": planColor } as React.CSSProperties}>
                <div className="bco-order-plan-dot" />
                <div>
                  <div className="bco-order-plan-name">{selectedPlan.name} plan</div>
                  <div className="bco-order-plan-cycle">
                    {billingCycle === "ANNUAL" ? "Annual billing" : "Monthly billing"}
                  </div>
                </div>
              </div>

              {/* Features included */}
              {enabledFeatures.length > 0 && (
                <div className="bco-order-features">
                  <div className="bco-order-features-label">What's included</div>
                  <ul className="bco-order-feature-list">
                    {visibleFeatures.map((f) => (
                      <li key={f} className="bco-order-feature-item">
                        <FeatureCheckIcon />
                        <span>{f}</span>
                      </li>
                    ))}
                    {hiddenCount > 0 && (
                      <li className="bco-order-feature-more">+{hiddenCount} more features</li>
                    )}
                  </ul>
                </div>
              )}

              {/* Pricing breakdown */}
              {!isContactSales && (
                <div className="bco-order-pricing">
                  <div className="bco-order-price-row">
                    <span>{selectedPlan.name} plan</span>
                    <span>{isFreeTotal ? "Free" : `$${basePrice.toFixed(2)}`}</span>
                  </div>
                  {preview && preview.discountAmount > 0 && (
                    <div className="bco-order-price-row bco-order-price-row--discount">
                      <span>Coupon discount</span>
                      <span>−${preview.discountAmount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="bco-order-total-row">
                    <span>Total</span>
                    <span>
                      {isFreeTotal
                        ? "Free"
                        : `$${displayTotal.toFixed(2)} / ${billingCycle === "ANNUAL" ? "yr" : "mo"}`}
                    </span>
                  </div>

                  {/* Coupon */}
                  <div className="bco-coupon-row">
                    <input
                      className="input"
                      placeholder="Coupon code (optional)"
                      value={couponCode}
                      onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                      style={{ fontSize: 13.5 }}
                    />
                    {previewLoading && <div className="spinner spinner--sm" style={{ flexShrink: 0 }} />}
                  </div>
                  {preview?.couponApplied && (
                    <div className="alert alert--success" style={{ padding: "7px 12px", fontSize: 13 }}>
                      {preview.couponMessage}
                    </div>
                  )}
                  {preview?.couponMessage && !preview.couponApplied && couponCode.trim() && (
                    <div className="alert alert--error" style={{ padding: "7px 12px", fontSize: 13 }}>
                      {preview.couponMessage}
                    </div>
                  )}
                </div>
              )}

              {isContactSales && (
                <div className="billing-contact-sales-note">
                  <p>The Business plan is designed for larger teams with custom pricing, dedicated support, and tailored feature access.</p>
                  <p>Reach out and we'll set up your account personally.</p>
                </div>
              )}

              {error && (
                <div className="alert alert--error" style={{ fontSize: 13 }}>{error}</div>
              )}

              <button
                className="btn btn--primary bco-cta-btn"
                onClick={handleCheckout}
                disabled={submitting || !selectedPlanId}
              >
                {submitting ? "Processing…" : ctaLabel}
              </button>

              {!isContactSales && (
                <p className="bco-secure-note">
                  <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 13, height: 13 }} aria-hidden="true">
                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                  </svg>
                  Secure payment. No card details stored by ShelfSense.
                </p>
              )}

              <LegalFooterLinks />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
