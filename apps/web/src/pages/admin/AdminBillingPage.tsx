export function AdminBillingPage() {
  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1 className="admin-page-title">Billing</h1>
        <p className="admin-page-subtitle">Subscription and payment overview across all workspaces</p>
      </div>
      <div className="admin-coming-soon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
          <line x1="1" y1="10" x2="23" y2="10" />
        </svg>
        <p>Billing management coming soon.</p>
      </div>
    </div>
  );
}
