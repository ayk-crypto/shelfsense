import { Link, useSearchParams } from "react-router-dom";

export function BillingFailedPage() {
  const [searchParams] = useSearchParams();
  const reason = searchParams.get("reason");

  return (
    <div className="billing-fullpage">
      <div className="billing-status-card">
        <div className="billing-status-icon billing-status-icon--error">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>

        <h1 className="billing-status-title">Payment cancelled</h1>
        <p className="billing-status-desc">
          {reason === "failed"
            ? "Your payment could not be processed. Please check your payment details and try again."
            : "You cancelled the payment. No charges were made. Your previous plan remains active."}
        </p>

        <div className="billing-status-actions">
          <Link to="/billing/checkout" className="btn btn--primary">Try again</Link>
          <Link to="/dashboard" className="btn btn--ghost">Back to Dashboard</Link>
        </div>

        <p className="billing-status-help">
          Need help?{" "}
          <Link to="/support" style={{ color: "#6366f1" }}>Contact support</Link>
        </p>
      </div>
    </div>
  );
}
