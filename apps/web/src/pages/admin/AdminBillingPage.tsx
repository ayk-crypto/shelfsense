import { Link } from "react-router-dom";

export function AdminBillingPage() {
  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Billing</h1>
          <p className="admin-page-subtitle">Manage subscription plans, coupons, subscriptions, and payment records</p>
        </div>
      </div>

      <div className="admin-billing-hub-grid">
        <Link to="/admin/plans" className="admin-billing-hub-card">
          <div className="admin-billing-hub-icon" style={{ background: "#eef2ff", color: "#6366f1" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 28, height: 28 }} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
          </div>
          <div className="admin-billing-hub-content">
            <h3>Plans & Packages</h3>
            <p>Define subscription tiers, pricing, and feature entitlements</p>
          </div>
          <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 18, height: 18, color: "#9ca3af", flexShrink: 0 }} aria-hidden="true">
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
        </Link>

        <Link to="/admin/coupons" className="admin-billing-hub-card">
          <div className="admin-billing-hub-icon" style={{ background: "#f0fdf4", color: "#22c55e" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 28, height: 28 }} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
            </svg>
          </div>
          <div className="admin-billing-hub-content">
            <h3>Coupons & Discounts</h3>
            <p>Create and manage promotional discount codes</p>
          </div>
          <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 18, height: 18, color: "#9ca3af", flexShrink: 0 }} aria-hidden="true">
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
        </Link>

        <Link to="/admin/subscriptions" className="admin-billing-hub-card">
          <div className="admin-billing-hub-icon" style={{ background: "#fef3c7", color: "#d97706" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 28, height: 28 }} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <div className="admin-billing-hub-content">
            <h3>Subscriptions</h3>
            <p>View and manage workspace subscription records</p>
          </div>
          <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 18, height: 18, color: "#9ca3af", flexShrink: 0 }} aria-hidden="true">
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
        </Link>

        <Link to="/admin/payments" className="admin-billing-hub-card">
          <div className="admin-billing-hub-icon" style={{ background: "#fdf2f8", color: "#a855f7" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 28, height: 28 }} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
          </div>
          <div className="admin-billing-hub-content">
            <h3>Payments</h3>
            <p>Review and mark payments — activate subscriptions on receipt</p>
          </div>
          <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 18, height: 18, color: "#9ca3af", flexShrink: 0 }} aria-hidden="true">
            <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
        </Link>
      </div>

      <div className="admin-billing-hub-note">
        <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 16, height: 16, color: "#6366f1", flexShrink: 0 }} aria-hidden="true">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
        </svg>
        <p>
          Payment gateway is currently in <strong>mock mode</strong>. To connect a live gateway,
          set <code>PAYMENT_PROVIDER=payfast</code> or <code>PAYMENT_PROVIDER=safepay</code> in the API environment variables.
        </p>
      </div>
    </div>
  );
}
