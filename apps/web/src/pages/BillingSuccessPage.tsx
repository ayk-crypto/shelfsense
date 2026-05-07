import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getBillingSubscription } from "../api/billing";
import type { BillingSubscription } from "../api/billing";

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 30;

export function BillingSuccessPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const reason = searchParams.get("reason");
  const isPaddleReturn = searchParams.get("paddle") === "1";

  const [sub, setSub] = useState<BillingSubscription | null>(null);
  const [polling, setPolling] = useState(isPaddleReturn);
  const [pollExpired, setPollExpired] = useState(false);
  const attemptsRef = useRef(0);

  useEffect(() => {
    getBillingSubscription()
      .then(({ subscription }) => setSub(subscription))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isPaddleReturn) return;

    const interval = setInterval(async () => {
      attemptsRef.current += 1;
      try {
        const { subscription } = await getBillingSubscription();
        if (subscription && ["ACTIVE", "TRIALING", "TRIAL"].includes(subscription.status)) {
          setSub(subscription);
          setPolling(false);
          clearInterval(interval);
          window.dispatchEvent(new CustomEvent("shelfsense:plan-changed"));
          setTimeout(() => navigate("/dashboard", { replace: true }), 2500);
          return;
        }
      } catch {
        // ignore, keep polling
      }

      if (attemptsRef.current >= MAX_POLL_ATTEMPTS) {
        setPolling(false);
        setPollExpired(true);
        clearInterval(interval);
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isPaddleReturn, navigate]);

  const isConfirmed = sub && ["ACTIVE", "TRIALING", "TRIAL"].includes(sub.status);

  if (isPaddleReturn && polling) {
    return (
      <div className="billing-fullpage">
        <div className="billing-status-card">
          <div className="billing-status-icon billing-status-icon--pending">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path strokeLinecap="round" d="M12 6v6l4 2" />
            </svg>
          </div>
          <h1 className="billing-status-title">Confirming your payment…</h1>
          <p className="billing-status-desc">
            We're waiting for payment confirmation from Paddle. This usually takes a few seconds.
          </p>
          <div className="billing-status-poll-bar">
            <div className="billing-status-poll-bar-fill" />
          </div>
          <p className="billing-status-poll-note">
            Please don't close this page. You'll be redirected automatically.
          </p>
        </div>
      </div>
    );
  }

  if (isPaddleReturn && pollExpired && !isConfirmed) {
    return (
      <div className="billing-fullpage">
        <div className="billing-status-card">
          <div className="billing-status-icon billing-status-icon--pending">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path strokeLinecap="round" d="M12 8v4m0 4h.01" />
            </svg>
          </div>
          <h1 className="billing-status-title">Payment pending confirmation</h1>
          <p className="billing-status-desc">
            Your payment was received, but your subscription is still being activated.
            This can take a few minutes. You can check your billing settings for the latest status.
          </p>
          <div className="billing-status-actions">
            <Link to="/dashboard" className="btn btn--primary">Go to Dashboard</Link>
            <Link to="/settings/billing" className="btn btn--ghost">View billing settings</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="billing-fullpage">
      <div className="billing-status-card">
        <div className="billing-status-icon billing-status-icon--success">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>

        <h1 className="billing-status-title">
          {reason === "free" ? "You're all set!" : isConfirmed ? "Payment successful!" : "Payment received!"}
        </h1>
        <p className="billing-status-desc">
          {isConfirmed
            ? `Your ${sub.plan.name} plan is now active. All features are unlocked.`
            : sub
            ? `Your ${sub.plan.name} plan subscription has been processed.`
            : "Your subscription is being activated. Welcome aboard!"}
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
