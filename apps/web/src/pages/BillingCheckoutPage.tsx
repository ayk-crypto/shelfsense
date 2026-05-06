import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getPublicPlans, previewSubscription } from "../api/subscriptions";
import { initiateCheckout, initiatePaddleCheckout } from "../api/billing";
import { isPaddleConfigured, getPaddle } from "../lib/paddle";
import type { PublicPlan, SubscriptionPreview } from "../types";
import { LegalFooterLinks } from "./LegalPage";

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

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 16, height: 16, color: "#6366f1", flexShrink: 0 }} aria-hidden="true">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );
}

function PlanCard({ plan, selected, billingCycle, onSelect }: {
  plan: PublicPlan; selected: boolean; billingCycle: "MONTHLY" | "ANNUAL"; onSelect: () => void;
}) {
  const isFree = plan.code === "FREE" || (plan.monthlyPrice === 0 && plan.annualPrice === 0);
  const isContactSales = plan.code === "BUSINESS" || plan.priceDisplayMode === "CUSTOM";
  const price = isFree || isContactSales ? 0 : billingCycle === "ANNUAL" ? plan.annualPrice : plan.monthlyPrice;
  const monthlyEquiv = billingCycle === "ANNUAL" && !isFree && !isContactSales ? Math.round(plan.annualPrice / 12) : price;
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
        {isContactSales ? (
          <span className="plan-price-amount" style={{ fontSize: 22 }}>Contact Sales</span>
        ) : isFree ? (
          <span className="plan-price-amount">Free</span>
        ) : (
          <>
            <span className="plan-price-currency">$</span>
            <span className="plan-price-amount">{monthlyEquiv.toLocaleString()}</span>
            <span className="plan-price-period">/mo</span>
          </>
        )}
      </div>
      {billingCycle === "ANNUAL" && !isFree && !isContactSales && (
        <div className="plan-price-annual-note">Billed ${plan.annualPrice}/yr</div>
      )}
      <ul className="plan-feature-list">
        {enabledFeatures.map((f) => (
          <li key={f} className="plan-feature-item">
            <CheckIcon />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <div className="plan-card-select-indicator">{selected ? "Selected" : isContactSales ? "Contact us" : "Select plan"}</div>
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

  // Pre-initialize Paddle as early as possible
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
        const result = await initiateCheckout({
          planId: selectedPlanId,
          billingCycle,
          couponCode: couponCode.trim() || undefined,
        });
        if (result.isFree) {
          navigate("/billing/success?reason=free");
        } else {
          navigate("/billing/pending");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Checkout failed. Please try again.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Paid plan — use Paddle overlay if configured
    if (isPaddleConfigured()) {
      try {
        const data = await initiatePaddleCheckout({
          planCode: selectedPlan.code,
          billingCycle,
        });

        const paddle = await getPaddle();
        if (!paddle) throw new Error("Paddle failed to initialize. Please refresh and try again.");

        const successUrl = `${window.location.origin}/billing/success?paddle=1`;

        paddle.Checkout.open({
          items: [{ priceId: data.priceId, quantity: 1 }],
          customer: { email: data.customerEmail },
          customData: data.customData as Record<string, unknown>,
          settings: { successUrl },
        });
        // The overlay handles everything — no further action needed here
      } catch (e) {
        setError(e instanceof Error ? e.message : "Checkout failed. Please try again.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Fallback: existing provider checkout flow
    try {
      const result = await initiateCheckout({
        planId: selectedPlanId,
        billingCycle,
        couponCode: couponCode.trim() || undefined,
      });
      if (result.isFree) {
        navigate("/billing/success?reason=free");
      } else if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
      } else {
        navigate("/billing/pending");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
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

  return (
    <div className="billing-fullpage">
      <div className="billing-checkout-wrap">
        <div className="billing-checkout-header">
          <div className="billing-logo-mark" />
          <h1 className="billing-checkout-title">Choose your plan</h1>
          <p className="billing-checkout-sub">Upgrade anytime. Cancel or change plans from your billing settings.</p>
        </div>

        <div className="billing-cycle-toggle">
          <button
            className={`billing-cycle-btn ${billingCycle === "MONTHLY" ? "billing-cycle-btn--active" : ""}`}
            onClick={() => setBillingCycle("MONTHLY")}
          >Monthly</button>
          <button
            className={`billing-cycle-btn ${billingCycle === "ANNUAL" ? "billing-cycle-btn--active" : ""}`}
            onClick={() => setBillingCycle("ANNUAL")}
          >
            Annual
            <span className="billing-cycle-save">Save ~17%</span>
          </button>
        </div>

        <div className="plan-cards-grid">
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

        {selectedPlan && (
          <div className="billing-summary-card">
            {!isContactSales && (
              <>
                <div className="billing-summary-row">
                  <span>Plan</span>
                  <span>{selectedPlan.name} ({billingCycle === "ANNUAL" ? "Annual" : "Monthly"})</span>
                </div>
                {preview && (
                  <>
                    {preview.discountAmount > 0 && (
                      <div className="billing-summary-row billing-summary-row--discount">
                        <span>Coupon discount</span>
                        <span>-${preview.discountAmount.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="billing-summary-row billing-summary-row--total">
                      <span>Total</span>
                      <span>
                        {preview.payableAmount === 0
                          ? "Free"
                          : `$${preview.payableAmount.toFixed(2)} / ${billingCycle === "ANNUAL" ? "year" : "month"}`}
                      </span>
                    </div>
                  </>
                )}

                <div className="billing-coupon-row">
                  <input
                    className="input"
                    placeholder="Coupon code (optional)"
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                    style={{ flex: 1, fontSize: 14 }}
                  />
                  {previewLoading && <div className="spinner spinner--sm" />}
                </div>
                {preview?.couponApplied && (
                  <div className="alert alert--success" style={{ padding: "8px 12px", fontSize: 13 }}>
                    {preview.couponMessage}
                  </div>
                )}
                {preview?.couponMessage && !preview.couponApplied && couponCode.trim() && (
                  <div className="alert alert--error" style={{ padding: "8px 12px", fontSize: 13 }}>
                    {preview.couponMessage}
                  </div>
                )}
              </>
            )}

            {isContactSales && (
              <div className="billing-contact-sales-note">
                <p>The Business plan is designed for larger teams and comes with custom pricing, dedicated support, and tailored feature access.</p>
                <p>Reach out to our team and we'll set up your account personally.</p>
              </div>
            )}

            {error && (
              <div className="alert alert--error" style={{ marginTop: 8 }}>{error}</div>
            )}

            <button
              className="btn btn--primary billing-checkout-cta"
              onClick={handleCheckout}
              disabled={submitting || !selectedPlanId}
            >
              {submitting
                ? "Processing…"
                : isContactSales
                ? "Contact Sales"
                : preview?.payableAmount === 0
                ? "Activate — Free"
                : isPaddleConfigured()
                ? "Pay with Paddle"
                : "Continue to Payment"}
            </button>

            {!isContactSales && (
              <p className="billing-secure-note">
                <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 14, height: 14 }} aria-hidden="true"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg>
                Secure payment. No card details stored by ShelfSense.
              </p>
            )}
            <LegalFooterLinks />
          </div>
        )}
      </div>
    </div>
  );
}
