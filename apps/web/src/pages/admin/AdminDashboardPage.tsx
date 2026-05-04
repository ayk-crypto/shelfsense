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
        <div className="admin-page-header">
          <h1 className="admin-page-title">Platform Overview</h1>
        </div>
        <div className="admin-loading"><div className="spinner" /></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-page">
        <div className="admin-page-header">
          <h1 className="admin-page-title">Platform Overview</h1>
        </div>
        <div className="alert alert--error">{error}</div>
      </div>
    );
  }

  const ov = data?.overview;

  const statCards = [
    { label: "Total Workspaces", value: ov?.totalWorkspaces ?? 0, href: "/admin/workspaces", color: "blue" },
    { label: "Active Workspaces", value: ov?.activeWorkspaces ?? 0, href: "/admin/workspaces?status=active", color: "green" },
    { label: "Total Users", value: ov?.totalUsers ?? 0, href: "/admin/users", color: "blue" },
    { label: "Verified Users", value: ov?.verifiedUsers ?? 0, href: "/admin/users?verified=true", color: "green" },
    { label: "Trial Accounts", value: ov?.trialWorkspaces ?? 0, href: "/admin/workspaces", color: "yellow" },
    { label: "Paid Accounts", value: ov?.paidWorkspaces ?? 0, href: "/admin/workspaces", color: "purple" },
    { label: "Suspended", value: ov?.suspendedWorkspaces ?? 0, href: "/admin/workspaces?status=suspended", color: "red" },
    { label: "New Signups (7d)", value: ov?.newSignupsThisWeek ?? 0, href: "/admin/users", color: "teal" },
  ];

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1 className="admin-page-title">Platform Overview</h1>
        <p className="admin-page-subtitle">SaaS-wide metrics and recent admin activity</p>
      </div>

      <div className="admin-stat-grid">
        {statCards.map((card) => (
          <Link key={card.label} to={card.href} className={`admin-stat-card admin-stat-card--${card.color}`}>
            <span className="admin-stat-value">{card.value.toLocaleString()}</span>
            <span className="admin-stat-label">{card.label}</span>
          </Link>
        ))}
      </div>

      <div className="admin-section">
        <h2 className="admin-section-title">Recent Admin Activity</h2>
        {data?.recentActivity && data.recentActivity.length > 0 ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Admin</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {data.recentActivity.map((log) => (
                  <tr key={log.id}>
                    <td><span className="admin-action-badge">{log.action.replace(/_/g, " ")}</span></td>
                    <td>{log.entity} <span className="admin-entity-id">{log.entityId.slice(0, 8)}…</span></td>
                    <td>{log.admin.name} <span className="admin-muted">{log.admin.email}</span></td>
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
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
