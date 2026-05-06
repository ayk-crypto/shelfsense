import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { simulateMockPayment } from "../api/billing";

export function MockCheckoutPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const token = searchParams.get("token") ?? "";
  const paymentId = searchParams.get("paymentId") ?? "";
  const subscriptionId = searchParams.get("subscriptionId") ?? "";
  const amount = searchParams.get("amount") ?? "0";
  const currency = searchParams.get("currency") ?? "USD";
  const plan = searchParams.get("plan") ?? "Plan";

  const [loading, setLoading] = useState<"pay" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!token || !paymentId || !subscriptionId) {
    return (
      <div className="billing-fullpage">
        <div className="billing-status-card">
          <div className="billing-status-icon billing-status-icon--error">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <h1>Invalid checkout link</h1>
          <p>This checkout link is missing required parameters. Please go back and try again.</p>
          <button className="btn btn--primary" onClick={() => navigate("/billing/checkout")}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  async function handleAction(action: "pay" | "cancel") {
    setLoading(action);
    setError(null);
    try {
      const result = await simulateMockPayment({ token, paymentId, subscriptionId, action });
      if (action === "pay" && result.ok) {
        navigate(`/billing/success?subscriptionId=${subscriptionId}`);
      } else {
        navigate(`/billing/failed?subscriptionId=${subscriptionId}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setLoading(null);
    }
  }

  return (
    <div className="billing-fullpage">
      <div className="billing-status-card billing-mock-checkout">
        <div className="billing-mock-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 18, height: 18 }} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          Simulated Payment Gateway — Development Only
        </div>

        <div className="billing-mock-plan-info">
          <div className="billing-mock-plan-name">{plan}</div>
          <div className="billing-mock-amount">
            {parseFloat(amount) === 0 ? "Free" : `${currency} ${parseFloat(amount).toLocaleString()}`}
          </div>
        </div>

        <p className="billing-mock-desc">
          This is the ShelfSense mock payment gateway for development testing.
          No real money is charged. Use the buttons below to simulate payment outcomes.
        </p>

        {error && (
          <div className="alert alert--error" style={{ marginBottom: 16 }}>{error}</div>
        )}

        <div className="billing-mock-actions">
          <button
            className="btn btn--primary"
            style={{ flex: 1 }}
            onClick={() => handleAction("pay")}
            disabled={loading !== null}
          >
            {loading === "pay" ? (
              <><div className="spinner spinner--sm spinner--white" /> Processing…</>
            ) : (
              <>
                <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 16, height: 16 }} aria-hidden="true">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Simulate Successful Payment
              </>
            )}
          </button>
          <button
            className="btn btn--ghost"
            style={{ flex: 1 }}
            onClick={() => handleAction("cancel")}
            disabled={loading !== null}
          >
            {loading === "cancel" ? (
              <><div className="spinner spinner--sm" /> Cancelling…</>
            ) : (
              "Cancel Payment"
            )}
          </button>
        </div>

        <div className="billing-mock-info-grid">
          <div className="billing-mock-info-item">
            <span className="billing-mock-info-label">Payment ID</span>
            <code className="billing-mock-info-val">{paymentId.slice(0, 8)}…</code>
          </div>
          <div className="billing-mock-info-item">
            <span className="billing-mock-info-label">Session token</span>
            <code className="billing-mock-info-val">{token.slice(0, 8)}…</code>
          </div>
        </div>
      </div>
    </div>
  );
}
