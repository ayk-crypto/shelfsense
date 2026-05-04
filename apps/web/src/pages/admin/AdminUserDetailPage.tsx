import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { getAdminUser, updateUserStatus, adminResendVerification, adminForcePasswordReset } from "../../api/admin";
import type { AdminUserDetail } from "../../types";

export function AdminUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<AdminUserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  function load() {
    if (!id) return;
    setLoading(true);
    getAdminUser(id)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load user"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [id]);

  async function doAction(fn: () => Promise<unknown>, successMsg: string) {
    setActionLoading(true);
    setActionMsg(null);
    try {
      await fn();
      setActionMsg({ type: "success", text: successMsg });
      load();
    } catch (err) {
      setActionMsg({ type: "error", text: err instanceof Error ? err.message : "Action failed" });
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) return <div className="admin-page"><div className="admin-loading"><div className="spinner" /></div></div>;
  if (error) return <div className="admin-page"><div className="alert alert--error">{error}</div></div>;
  if (!data) return null;

  const user = data.user;
  const isSuperAdmin = user.platformRole === "SUPER_ADMIN";

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <button className="admin-back-btn" onClick={() => navigate("/admin/users")}>← Users</button>
        <h1 className="admin-page-title">{user.name}</h1>
        <div className="admin-header-badges">
          {user.emailVerified
            ? <span className="admin-status-badge admin-status-badge--active">Verified</span>
            : <span className="admin-status-badge admin-status-badge--pending">Unverified</span>}
          {user.isDisabled && <span className="admin-status-badge admin-status-badge--suspended">Disabled</span>}
          {user.platformRole !== "USER" && (
            <span className="admin-platform-role-badge">{user.platformRole.replace(/_/g, " ")}</span>
          )}
        </div>
      </div>

      {actionMsg && (
        <div className={`alert alert--${actionMsg.type === "success" ? "success" : "error"}`} style={{ marginBottom: 16 }}>
          {actionMsg.text}
        </div>
      )}

      <div className="admin-detail-actions">
        {!user.emailVerified && (
          <button className="btn btn--ghost btn--sm" disabled={actionLoading}
            onClick={() => doAction(() => adminResendVerification(id!), "Verification email sent.")}>
            Resend Verification
          </button>
        )}
        <button className="btn btn--ghost btn--sm" disabled={actionLoading}
          onClick={() => {
            if (window.confirm("Send a password reset email to this user?")) {
              doAction(() => adminForcePasswordReset(id!), "Password reset email sent.");
            }
          }}>
          Force Password Reset
        </button>
        {!isSuperAdmin && (
          <button
            className={`btn btn--sm ${user.isDisabled ? "btn--success" : "btn--danger"}`}
            disabled={actionLoading}
            onClick={() => {
              const msg = user.isDisabled
                ? "Enable this user? They will be able to log in again."
                : "Disable this user? They will be blocked from logging in.";
              if (window.confirm(msg)) {
                doAction(() => updateUserStatus(id!, !user.isDisabled), user.isDisabled ? "User enabled." : "User disabled.");
              }
            }}
          >
            {user.isDisabled ? "Enable Account" : "Disable Account"}
          </button>
        )}
      </div>

      <div className="admin-detail-grid">
        <div className="admin-detail-card">
          <h3 className="admin-detail-card-title">Account Info</h3>
          <dl className="admin-dl">
            <dt>ID</dt><dd className="admin-muted">{user.id}</dd>
            <dt>Name</dt><dd>{user.name}</dd>
            <dt>Email</dt><dd>{user.email}</dd>
            <dt>Verified</dt><dd>{user.emailVerified ? "Yes" : "No"}</dd>
            <dt>Platform Role</dt><dd>{user.platformRole}</dd>
            <dt>Status</dt><dd>{user.isDisabled ? "Disabled" : "Active"}</dd>
            <dt>Password Reset Required</dt><dd>{user.passwordResetRequired ? "Yes" : "No"}</dd>
            <dt>Failed Logins</dt><dd>{user.failedLoginAttempts}</dd>
            {user.lockedUntil && <><dt>Locked Until</dt><dd>{formatDate(user.lockedUntil)}</dd></>}
            <dt>Joined</dt><dd>{formatDate(user.createdAt)}</dd>
          </dl>
        </div>

        <div className="admin-detail-card">
          <h3 className="admin-detail-card-title">Workspaces ({user.memberships.length})</h3>
          {user.memberships.length === 0 ? (
            <p className="admin-empty">No workspace memberships.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table admin-table--compact">
                <thead><tr><th>Workspace</th><th>Role</th><th>Status</th></tr></thead>
                <tbody>
                  {user.memberships.map((m) => (
                    <tr key={m.id}>
                      <td><Link to={`/admin/workspaces/${m.workspace.id}`} className="admin-link">{m.workspace.name}</Link></td>
                      <td>{m.role}</td>
                      <td>{m.isActive ? "Active" : "Inactive"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="admin-section">
        <h2 className="admin-section-title">Recent Activity</h2>
        {data.recentActivity.length === 0 ? (
          <p className="admin-empty">No recent activity.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Action</th><th>Entity</th><th>Workspace</th><th>Time</th></tr></thead>
              <tbody>
                {data.recentActivity.map((log) => (
                  <tr key={log.id}>
                    <td><span className="admin-action-badge">{log.action.replace(/_/g, " ")}</span></td>
                    <td>{log.entity}</td>
                    <td>
                      {log.workspace
                        ? <Link to={`/admin/workspaces/${log.workspace.id}`} className="admin-link">{log.workspace.name}</Link>
                        : "—"}
                    </td>
                    <td className="admin-muted">{formatDate(log.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
