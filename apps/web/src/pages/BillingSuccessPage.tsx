import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getBillingSubscription } from "../api/billing";
import type { BillingSubscription } from "../api/billing";

export function BillingSuccessPage() {
  const [searchParams] = useSearchParams();
  const reason = searchParams.get("reason");
  const [sub, setSub] = useState<BillingSubscription | null>(null);

  useEffect(() => {
    getBillingSubscription()
      .then(({ subscription }) => setSub(subscription))
      .catch(() => {});
  }, []);

  return (
    <div className="billing-fullpage">
      <div className="billing-status-card">
        <div className="billing-status-icon billing-status-icon--success">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>

        <h1 className="billing-status-title">
          {reason === "free" ? "You're all set!" : "Payment successful!"}
        </h1>
        <p className="billing-status-desc">
          {sub
            ? `Your ${sub.plan.name} plan is now active. All features are unlocked.`
            : "Your subscription is now active. Welcome aboard!"}
        </p>

        {sub && (
          <div className="billing-status-plan-badge">
            <span className="billing-status-plan-name">{sub.plan.name}</span>
            {sub.billingCycle !== "MANUAL" && (
              <span className="billing-status-plan-cycle">
                {sub.billingCycle === "ANNUAL" ? "Annual" : "Monthly"}
              </span>
            )}
          </div>
        )}

        <div className="billing-status-actions">
          <Link to="/dashboard" className="btn btn--primary">Go to Dashboard</Link>
          <Link to="/settings/billing" className="btn btn--ghost">View billing details</Link>
        </div>
      </div>
    </div>
  );
}
