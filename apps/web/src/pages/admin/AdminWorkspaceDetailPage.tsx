import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { getAdminWorkspace, updateWorkspaceStatus, updateWorkspacePlan } from "../../api/admin";
import type { AdminWorkspaceDetail } from "../../types";

export function AdminWorkspaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<AdminWorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  function load() {
    if (!id) return;
    setLoading(true);
    getAdminWorkspace(id)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load workspace"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [id]);

  async function handleToggleSuspend() {
    if (!data || !id) return;
    const newState = !data.workspace.suspended;
    let reason: string | undefined;
    if (newState) {
      const r = window.prompt("Reason for suspension (optional):");
      if (r === null) return;
      reason = r.trim() || undefined;
    }
    setActionLoading(true);
    setActionMsg(null);
    try {
      await updateWorkspaceStatus(id, newState, reason);
      setActionMsg({ type: "success", text: newState ? "Workspace suspended." : "Workspace reactivated." });
      load();
    } catch (err) {
      setActionMsg({ type: "error", text: err instanceof Error ? err.message : "Action failed" });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleChangePlan() {
    if (!id) return;
    const plan = window.prompt("New plan (FREE / BASIC / PRO):")?.trim().toUpperCase();
    if (!plan || !["FREE", "BASIC", "PRO"].includes(plan)) {
      if (plan !== null && plan !== undefined) alert("Invalid plan. Must be FREE, BASIC, or PRO.");
      return;
    }
    setActionLoading(true);
    setActionMsg(null);
    try {
      await updateWorkspacePlan(id, { plan });
      setActionMsg({ type: "success", text: `Plan updated to ${plan}.` });
      load();
    } catch (err) {
      setActionMsg({ type: "error", text: err instanceof Error ? err.message : "Action failed" });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleExtendTrial() {
    if (!id) return;
    const days = window.prompt("Extend trial by how many days?");
    const n = parseInt(days ?? "", 10);
    if (!days || isNaN(n) || n <= 0) return;
    const trialEndsAt = new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
    setActionLoading(true);
    setActionMsg(null);
    try {
      await updateWorkspacePlan(id, { trialEndsAt });
      setActionMsg({ type: "success", text: `Trial extended by ${n} days.` });
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

  const ws = data.workspace;

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <button className="admin-back-btn" onClick={() => navigate("/admin/workspaces")}>
          ← Workspaces
        </button>
        <h1 className="admin-page-title">{ws.name}</h1>
        <div className="admin-header-badges">
          <span className={`admin-plan-badge admin-plan-badge--${ws.plan.toLowerCase()}`}>{ws.plan}</span>
          {ws.suspended
            ? <span className="admin-status-badge admin-status-badge--suspended">Suspended</span>
            : <span className="admin-status-badge admin-status-badge--active">Active</span>}
        </div>
      </div>

      {actionMsg && (
        <div className={`alert alert--${actionMsg.type === "success" ? "success" : "error"}`} style={{ marginBottom: 16 }}>
          {actionMsg.text}
        </div>
      )}

      <div className="admin-detail-actions">
        <button className="btn btn--primary btn--sm" disabled={actionLoading} onClick={handleChangePlan}>Change Plan</button>
        <button className="btn btn--ghost btn--sm" disabled={actionLoading} onClick={handleExtendTrial}>Extend Trial</button>
        <button
          className={`btn btn--sm ${ws.suspended ? "btn--success" : "btn--danger"}`}
          disabled={actionLoading}
          onClick={handleToggleSuspend}
        >
          {ws.suspended ? "Reactivate" : "Suspend"}
        </button>
      </div>

      <div className="admin-detail-grid">
        <div className="admin-detail-card">
          <h3 className="admin-detail-card-title">Workspace Info</h3>
          <dl className="admin-dl">
            <dt>ID</dt><dd className="admin-muted">{ws.id}</dd>
            <dt>Name</dt><dd>{ws.name}</dd>
            <dt>Currency</dt><dd>{ws.currency}</dd>
            <dt>Business Type</dt><dd>{ws.businessType ?? "—"}</dd>
            <dt>Onboarding</dt><dd>{ws.onboardingCompleted ? "Completed" : "Incomplete"}</dd>
            <dt>Created</dt><dd>{formatDate(ws.createdAt)}</dd>
            <dt>Trial Ends</dt><dd>{ws.trialEndsAt ? formatDate(ws.trialEndsAt) : "—"}</dd>
            <dt>Subscription</dt><dd>{ws.subscriptionStatus ?? "—"}</dd>
            {ws.suspended && <><dt>Suspended At</dt><dd>{ws.suspendedAt ? formatDate(ws.suspendedAt) : "—"}</dd></>}
            {ws.suspendReason && <><dt>Suspend Reason</dt><dd>{ws.suspendReason}</dd></>}
          </dl>
        </div>

        <div className="admin-detail-card">
          <h3 className="admin-detail-card-title">Owner</h3>
          <dl className="admin-dl">
            <dt>Name</dt><dd><Link to={`/admin/users/${ws.owner.id}`} className="admin-link">{ws.owner.name}</Link></dd>
            <dt>Email</dt><dd>{ws.owner.email}</dd>
            <dt>Verified</dt><dd>{ws.owner.emailVerified ? "Yes" : "No"}</dd>
            <dt>Joined</dt><dd>{formatDate(ws.owner.createdAt)}</dd>
          </dl>
        </div>

        <div className="admin-detail-card">
          <h3 className="admin-detail-card-title">Usage</h3>
          <dl className="admin-dl">
            <dt>Items</dt><dd>{ws.itemCount}</dd>
            <dt>Stock Movements</dt><dd>{ws.stockMovementCount}</dd>
            <dt>Purchases</dt><dd>{ws.purchaseCount}</dd>
            <dt>Suppliers</dt><dd>{ws.supplierCount}</dd>
            <dt>Locations</dt><dd>{ws.locations.length}</dd>
            <dt>Members</dt><dd>{ws.memberships.length}</dd>
          </dl>
        </div>
      </div>

      <div className="admin-section">
        <h2 className="admin-section-title">Members</h2>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Verified</th><th>Status</th><th>Joined</th></tr></thead>
            <tbody>
              {ws.memberships.map((m) => (
                <tr key={m.id}>
                  <td><Link to={`/admin/users/${m.user.id}`} className="admin-link">{m.user.name}</Link></td>
                  <td>{m.user.email}</td>
                  <td>{m.role}</td>
                  <td>{m.user.emailVerified ? "Yes" : "No"}</td>
                  <td>{m.isActive ? <span className="admin-status-badge admin-status-badge--active">Active</span> : <span className="admin-status-badge admin-status-badge--suspended">Inactive</span>}</td>
                  <td className="admin-muted">{formatDate(m.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="admin-section">
        <h2 className="admin-section-title">Recent Stock Activity</h2>
        {data.recentActivity.length === 0 ? (
          <p className="admin-empty">No recent activity.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Item</th><th>Type</th><th>Qty</th><th>Time</th></tr></thead>
              <tbody>
                {data.recentActivity.map((m) => (
                  <tr key={m.id}>
                    <td>{m.item.name}</td>
                    <td><span className="admin-action-badge">{m.type.replace(/_/g, " ")}</span></td>
                    <td>{m.quantity}</td>
                    <td className="admin-muted">{formatDate(m.createdAt)}</td>
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
