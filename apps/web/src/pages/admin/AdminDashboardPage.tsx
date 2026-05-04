import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getAdminOverview } from "../../api/admin";
import type { AdminOverview } from "../../types";

export function AdminDashboardPage() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getAdminOverview()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load overview"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="admin-page">
        <div className="admin-page-header"><h1 className="admin-page-title">Platform Overview</h1></div>
        <div className="admin-loading"><div className="spinner" /></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-page">
        <div className="admin-page-header"><h1 className="admin-page-title">Platform Overview</h1></div>
        <div className="alert alert--error">{error}</div>
      </div>
    );
  }

  const ov = data?.overview;

  const workspaceCards = [
    { label: "Total Workspaces", value: ov?.totalWorkspaces ?? 0, href: "/admin/workspaces", color: "blue" },
    { label: "Active", value: ov?.activeWorkspaces ?? 0, href: "/admin/workspaces?status=active", color: "green" },
    { label: "On Trial", value: ov?.trialWorkspaces ?? 0, href: "/admin/workspaces?status=trial", color: "yellow" },
    { label: "Trial Ending Soon", value: ov?.trialEndingSoon ?? 0, href: "/admin/workspaces?status=trial", color: "orange" },
    { label: "Paid", value: ov?.paidWorkspaces ?? 0, href: "/admin/subscriptions?status=ACTIVE", color: "purple" },
    { label: "Expired", value: ov?.expiredWorkspaces ?? 0, href: "/admin/subscriptions?status=EXPIRED", color: "red" },
    { label: "Suspended", value: ov?.suspendedWorkspaces ?? 0, href: "/admin/workspaces?status=suspended", color: "red" },
    { label: "Setup Incomplete", value: ov?.setupIncomplete ?? 0, href: "/admin/workspaces", color: "gray" },
  ];

  const userCards = [
    { label: "Total Users", value: ov?.totalUsers ?? 0, href: "/admin/users", color: "blue" },
    { label: "Verified", value: ov?.verifiedUsers ?? 0, href: "/admin/users?verified=true", color: "green" },
    { label: "Unverified", value: ov?.unverifiedUsers ?? 0, href: "/admin/users?verified=false", color: "yellow" },
    { label: "New (7d)", value: ov?.newSignupsThisWeek ?? 0, href: "/admin/users", color: "teal" },
  ];

  const alerts: string[] = [];
  if ((ov?.failedEmails24h ?? 0) > 0) alerts.push(`${ov?.failedEmails24h} email(s) failed in the last 24h`);
  if ((ov?.trialEndingSoon ?? 0) > 0) alerts.push(`${ov?.trialEndingSoon} trial(s) expiring in 7 days`);

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Platform Overview</h1>
          <p className="admin-page-subtitle">SaaS-wide metrics and recent admin activity</p>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="admin-alerts-bar">
          {alerts.map((a) => (
            <div key={a} className="admin-alert-notice">
              <span className="admin-alert-dot admin-alert-dot--warn" />
              {a}
            </div>
          ))}
        </div>
      )}

      {/* MRR Banner */}
      <div className="admin-mrr-banner">
        <div className="admin-mrr-main">
          <span className="admin-mrr-label">Estimated MRR</span>
          <span className="admin-mrr-value">PKR {(ov?.estimatedMrr ?? 0).toLocaleString()}</span>
        </div>
        <Link to="/admin/subscriptions" className="admin-mrr-link">View subscriptions →</Link>
      </div>

      {/* Workspace stats */}
      <h2 className="admin-section-title" style={{ marginBottom: 10 }}>Workspaces</h2>
      <div className="admin-stat-grid">
        {workspaceCards.map((card) => (
          <Link key={card.label} to={card.href} className={`admin-stat-card admin-stat-card--${card.color}`}>
            <span className="admin-stat-value">{card.value.toLocaleString()}</span>
            <span className="admin-stat-label">{card.label}</span>
          </Link>
        ))}
      </div>

      {/* User stats */}
      <h2 className="admin-section-title" style={{ marginTop: 28, marginBottom: 10 }}>Users</h2>
      <div className="admin-stat-grid admin-stat-grid--4">
        {userCards.map((card) => (
          <Link key={card.label} to={card.href} className={`admin-stat-card admin-stat-card--${card.color}`}>
            <span className="admin-stat-value">{card.value.toLocaleString()}</span>
            <span className="admin-stat-label">{card.label}</span>
          </Link>
        ))}
      </div>

      {/* Recent sections */}
      <div className="admin-dashboard-grid">
        {/* Recent Workspaces */}
        <div className="admin-section">
          <div className="admin-section-header">
            <h2 className="admin-section-title">Recent Workspaces</h2>
            <Link to="/admin/workspaces" className="admin-section-link">View all →</Link>
          </div>
          {data?.recentWorkspaces && data.recentWorkspaces.length > 0 ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr><th>Name</th><th>Owner</th><th>Plan</th><th>Joined</th></tr>
                </thead>
                <tbody>
                  {data.recentWorkspaces.map((w) => (
                    <tr key={w.id}>
                      <td><Link to={`/admin/workspaces/${w.id}`} className="admin-link">{w.name}</Link></td>
                      <td className="admin-muted">{w.owner.email}</td>
                      <td><span className="admin-badge admin-badge--gray">{w.plan}</span></td>
                      <td className="admin-muted">{formatDate(w.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="admin-empty">No workspaces yet.</p>
          )}
        </div>

        {/* Recent Admin Activity */}
        <div className="admin-section">
          <div className="admin-section-header">
            <h2 className="admin-section-title">Recent Admin Activity</h2>
            <Link to="/admin/activity" className="admin-section-link">View all →</Link>
          </div>
          {data?.recentActivity && data.recentActivity.length > 0 ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr><th>Action</th><th>By</th><th>Time</th></tr>
                </thead>
                <tbody>
                  {data.recentActivity.map((log) => (
                    <tr key={log.id}>
                      <td><span className="admin-action-badge">{log.action.replace(/_/g, " ")}</span></td>
                      <td className="admin-muted">{log.admin.name}</td>
                      <td className="admin-muted">{formatDate(log.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="admin-empty">No admin actions recorded yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
