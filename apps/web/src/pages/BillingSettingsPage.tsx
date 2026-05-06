import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getBillingSubscription } from "../api/billing";
import type { BillingSubscription } from "../api/billing";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  ACTIVE:        { label: "Active",          color: "active" },
  TRIAL:         { label: "Trial",           color: "yellow" },
  MANUAL_REVIEW: { label: "Pending payment", color: "yellow" },
  PAST_DUE:      { label: "Past due",        color: "red" },
  EXPIRED:       { label: "Expired",         color: "gray" },
  CANCELLED:     { label: "Cancelled",       color: "gray" },
  SUSPENDED:     { label: "Suspended",       color: "red" },
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  CARD_MANUAL: "Card (manual)",
  EASYPAISA: "EasyPaisa",
  JAZZCASH: "JazzCash",
  MOCK: "Test gateway",
  PAYFAST: "PayFast",
  SAFEPAY: "Safepay",
  OTHER: "Other",
};

const PAYMENT_STATUS_COLORS: Record<string, string> = {
  PENDING:   "yellow",
  PAID:      "active",
  FAILED:    "red",
  REFUNDED:  "purple",
  CANCELLED: "gray",
};

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatAmount(amount: number, currency: string) {
  return `${currency} ${amount.toLocaleString()}`;
}

export function BillingSettingsPage() {
  const navigate = useNavigate();
  const [sub, setSub] = useState<BillingSubscription | null>(null);
  const [provider, setProvider] = useState<string>("mock");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBillingSubscription()
      .then(({ subscription, provider: p }) => {
        setSub(subscription);
        setProvider(p);
      })
      .catch(() => setError("Failed to load billing information"))
      .finally(() => setLoading(false));
  }, []);

  const statusMeta = sub ? (STATUS_LABELS[sub.status] ?? { label: sub.status, color: "gray" }) : null;

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h2 className="settings-section-title">Subscription & Billing</h2>
        <p className="settings-section-desc">Manage your subscription plan and payment history.</p>
      </div>

      {loading && (
        <div style={{ padding: 32, textAlign: "center" }}>
          <div className="spinner" />
        </div>
      )}

      {error && (
        <div className="alert alert--error">{error}</div>
      )}

      {!loading && !sub && !error && (
        <div className="billing-settings-empty">
          <div className="billing-settings-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
              <line x1="1" y1="10" x2="23" y2="10" />
            </svg>
          </div>
          <p>No active subscription found.</p>
          <Link to="/billing/checkout" className="btn btn--primary">Choose a plan</Link>
        </div>
      )}

      {!loading && sub && (
        <>
          <div className="billing-settings-plan-card">
            <div className="billing-settings-plan-top">
              <div>
                <div className="billing-settings-plan-name">{sub.plan.name}</div>
                {statusMeta && (
                  <span className={`badge badge--${statusMeta.color}`}>{statusMeta.label}</span>
                )}
              </div>
              <button
                className="btn btn--secondary"
                onClick={() => navigate("/billing/checkout")}
              >
                {sub.status === "ACTIVE" ? "Change plan" : "Upgrade"}
              </button>
            </div>

            <div className="billing-settings-meta-grid">
              <div className="billing-settings-meta-item">
                <span className="billing-settings-meta-label">Billing cycle</span>
                <span className="billing-settings-meta-val">
                  {sub.billingCycle === "MONTHLY" ? "Monthly" : sub.billingCycle === "ANNUAL" ? "Annual" : "Manual"}
                </span>
              </div>
              <div className="billing-settings-meta-item">
                <span className="billing-settings-meta-label">Amount</span>
                <span className="billing-settings-meta-val">
                  {sub.amount === 0 ? "Free" : `${formatAmount(sub.amount, sub.currency)} / ${sub.billingCycle === "ANNUAL" ? "yr" : "mo"}`}
                </span>
              </div>
              {sub.currentPeriodStart && (
                <div className="billing-settings-meta-item">
                  <span className="billing-settings-meta-label">Period started</span>
                  <span className="billing-settings-meta-val">{formatDate(sub.currentPeriodStart)}</span>
                </div>
              )}
              {sub.currentPeriodEnd && (
                <div className="billing-settings-meta-item">
                  <span className="billing-settings-meta-label">Renews on</span>
                  <span className="billing-settings-meta-val">{formatDate(sub.currentPeriodEnd)}</span>
                </div>
              )}
              {sub.coupon && (
                <div className="billing-settings-meta-item">
                  <span className="billing-settings-meta-label">Coupon applied</span>
                  <span className="billing-settings-meta-val">
                    {sub.coupon.code} — {sub.coupon.discountType === "PERCENTAGE" ? `${sub.coupon.discountValue}% off` : `${sub.coupon.discountValue} off`}
                  </span>
                </div>
              )}
              <div className="billing-settings-meta-item">
                <span className="billing-settings-meta-label">Payment gateway</span>
                <span className="billing-settings-meta-val" style={{ textTransform: "capitalize" }}>
                  {provider}
                  {provider === "mock" && (
                    <span className="billing-mock-indicator"> (test mode)</span>
                  )}
                </span>
              </div>
            </div>

            {sub.status === "MANUAL_REVIEW" && sub.manualNotes && (
              <div className="billing-pending-banner">
                <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 16, height: 16, flexShrink: 0 }} aria-hidden="true">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <span>{sub.manualNotes}</span>
                <Link to="/billing/pending" className="billing-pending-link">View status</Link>
              </div>
            )}
          </div>

          <div className="billing-settings-plan-limits">
            <h3 className="billing-settings-limits-title">Plan limits</h3>
            <div className="billing-settings-limits-grid">
              <div className="billing-settings-limit-item">
                <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 16, height: 16, color: "#6366f1" }} aria-hidden="true"><path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" /><path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" /></svg>
                <span className="billing-settings-limit-label">Items</span>
                <span className="billing-settings-limit-val">{sub.plan.maxItems === null ? "Unlimited" : sub.plan.maxItems.toLocaleString()}</span>
              </div>
              <div className="billing-settings-limit-item">
                <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 16, height: 16, color: "#6366f1" }} aria-hidden="true"><path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" /></svg>
                <span className="billing-settings-limit-label">Locations</span>
                <span className="billing-settings-limit-val">{sub.plan.maxLocations === null ? "Unlimited" : sub.plan.maxLocations}</span>
              </div>
              <div className="billing-settings-limit-item">
                <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 16, height: 16, color: "#6366f1" }} aria-hidden="true"><path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" /></svg>
                <span className="billing-settings-limit-label">Team members</span>
                <span className="billing-settings-limit-val">{sub.plan.maxUsers === null ? "Unlimited" : sub.plan.maxUsers}</span>
              </div>
            </div>
          </div>

          {sub.payments.length > 0 && (
            <div className="billing-settings-payments">
              <h3 className="billing-settings-payments-title">Payment history</h3>
              <div className="billing-settings-payment-list">
                {sub.payments.map((p) => (
                  <div key={p.id} className="billing-payment-row">
                    <div className="billing-payment-left">
                      <div className="billing-payment-method">{PAYMENT_METHOD_LABELS[p.paymentMethod] ?? p.paymentMethod}</div>
                      <div className="billing-payment-date">{formatDate(p.paidAt ?? p.createdAt)}</div>
                      {p.referenceNumber && (
                        <div className="billing-payment-ref">Ref: {p.referenceNumber}</div>
                      )}
                    </div>
                    <div className="billing-payment-right">
                      <div className="billing-payment-amount">{formatAmount(p.amount, p.currency)}</div>
                      <span className={`badge badge--${PAYMENT_STATUS_COLORS[p.status] ?? "gray"}`}>
                        {p.status.charAt(0) + p.status.slice(1).toLowerCase()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
