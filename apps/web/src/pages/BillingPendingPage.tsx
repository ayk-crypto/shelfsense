import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getBillingSubscription } from "../api/billing";
import type { BillingSubscription } from "../api/billing";

export function BillingPendingPage() {
  const [sub, setSub] = useState<BillingSubscription | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getBillingSubscription()
      .then(({ subscription }) => setSub(subscription))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="billing-fullpage">
      <div className="billing-status-card">
        <div className="billing-status-icon billing-status-icon--pending">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>

        <h1 className="billing-status-title">Payment pending</h1>
        <p className="billing-status-desc">
          Your subscription request has been received and is pending payment confirmation.
          You can continue using ShelfSense while we process your payment.
        </p>

        {!loading && sub && (
          <div className="billing-pending-details">
            <div className="billing-pending-row">
              <span>Plan</span>
              <strong>{sub.plan.name}</strong>
            </div>
            <div className="billing-pending-row">
              <span>Amount</span>
              <strong>
                {sub.amount === 0 ? "Free" : `${sub.currency} ${sub.amount.toLocaleString()} / ${sub.billingCycle === "ANNUAL" ? "year" : "month"}`}
              </strong>
            </div>
            <div className="billing-pending-row">
              <span>Status</span>
              <span className="badge badge--yellow">Pending review</span>
            </div>
            {sub.manualNotes && (
              <div className="billing-pending-notes">
                <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 14, height: 14, color: "#d97706" }} aria-hidden="true">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                {sub.manualNotes}
              </div>
            )}
          </div>
        )}

        <div className="billing-status-actions">
          <Link to="/dashboard" className="btn btn--primary">Go to Dashboard</Link>
          <Link to="/settings/billing" className="btn btn--ghost">Billing details</Link>
        </div>

        <p className="billing-status-help">
          Questions about your payment?{" "}
          <Link to="/support" style={{ color: "#6366f1" }}>Contact support</Link>
        </p>
      </div>
    </div>
  );
}
