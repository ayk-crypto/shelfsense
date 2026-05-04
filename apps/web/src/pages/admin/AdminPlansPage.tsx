export function AdminPlansPage() {
  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1 className="admin-page-title">Plans</h1>
        <p className="admin-page-subtitle">Manage subscription plans and pricing</p>
      </div>
      <div className="admin-coming-soon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        <p>Plans management coming soon.</p>
      </div>
    </div>
  );
}
