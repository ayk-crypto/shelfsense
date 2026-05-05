import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  getAdminWorkspace,
  updateWorkspaceStatus,
  updateWorkspacePlan,
  getAdminPlans,
} from "../../api/admin";
import type { AdminWorkspaceDetail, AdminPlan } from "../../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function planColorClass(code: string) {
  const c = code.toLowerCase();
  if (c === "free") return "wsd-plan-free";
  if (c === "starter") return "wsd-plan-starter";
  if (c === "pro") return "wsd-plan-pro";
  if (c === "enterprise") return "wsd-plan-enterprise";
  return "wsd-plan-free";
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatBox({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="wsd-stat">
      <div className="wsd-stat-value">{value}</div>
      <div className="wsd-stat-label">{label}</div>
    </div>
  );
}

// ─── Change Plan Modal ────────────────────────────────────────────────────────

function ChangePlanModal({
  currentPlan, onClose, onConfirm, loading,
}: {
  currentPlan: string;
  onClose: () => void;
  onConfirm: (planCode: string) => void;
  loading: boolean;
}) {
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [selected, setSelected] = useState("");
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    getAdminPlans()
      .then((r) => setPlans(r.plans.filter((p) => p.isActive)))
      .catch(() => {})
      .finally(() => setFetching(false));
  }, []);

  return (
    <div className="wsd-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wsd-modal">
        <div className="wsd-modal-header">
          <div>
            <h2 className="wsd-modal-title">Change Plan</h2>
            <p className="wsd-modal-sub">Select the new plan for this workspace</p>
          </div>
          <button className="wsd-modal-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="wsd-modal-body">
          {fetching ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 32 }}><div className="spinner" /></div>
          ) : (
            <div className="wsd-plan-grid">
              {plans.map((plan) => {
                const isCurrent = plan.code === currentPlan;
                const isSelected = selected === plan.code;
                return (
                  <button
                    key={plan.id}
                    type="button"
                    className={`wsd-plan-card ${isSelected ? "wsd-plan-card--selected" : ""} ${isCurrent ? "wsd-plan-card--current" : ""}`}
                    onClick={() => !isCurrent && setSelected(plan.code)}
                    disabled={isCurrent}
                  >
                    {isCurrent && <div className="wsd-plan-card-current-tag">Current</div>}
                    <div className={`wsd-plan-card-badge ${planColorClass(plan.code)}`}>{plan.name}</div>
                    <div className="wsd-plan-card-price">
                      {plan.monthlyPrice === 0 ? (
                        <span className="wsd-plan-card-free">Free</span>
                      ) : (
                        <>
                          <span className="wsd-plan-card-amount">${plan.monthlyPrice}</span>
                          <span className="wsd-plan-card-period">/mo</span>
                        </>
                      )}
                    </div>
                    {plan.description && (
                      <p className="wsd-plan-card-desc">{plan.description}</p>
                    )}
                    <div className="wsd-plan-card-limits">
                      {plan.maxUsers !== null && <span>{plan.maxUsers} users</span>}
                      {plan.maxItems !== null && <span>{plan.maxItems} items</span>}
                      {plan.maxLocations !== null && <span>{plan.maxLocations} locations</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="wsd-modal-footer">
          <button className="btn btn--ghost" onClick={onClose} disabled={loading}>Cancel</button>
          <button
            className="btn btn--primary"
            disabled={!selected || loading}
            onClick={() => selected && onConfirm(selected)}
          >
            {loading ? "Updating…" : `Switch to ${selected || "selected plan"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Extend Trial Modal ───────────────────────────────────────────────────────

function ExtendTrialModal({
  onClose, onConfirm, loading,
}: {
  onClose: () => void;
  onConfirm: (days: number) => void;
  loading: boolean;
}) {
  const [days, setDays] = useState(7);

  return (
    <div className="wsd-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wsd-modal wsd-modal--sm">
        <div className="wsd-modal-header">
          <div>
            <h2 className="wsd-modal-title">Extend Trial</h2>
            <p className="wsd-modal-sub">Add days to this workspace's trial period</p>
          </div>
          <button className="wsd-modal-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="wsd-modal-body">
          <div className="wsd-trial-presets">
            {[7, 14, 30, 60].map((d) => (
              <button
                key={d}
                type="button"
                className={`wsd-trial-preset ${days === d ? "wsd-trial-preset--active" : ""}`}
                onClick={() => setDays(d)}
              >
                {d} days
              </button>
            ))}
          </div>
          <div className="wsd-trial-custom">
            <label className="form-label">Or enter custom days</label>
            <input
              className="form-input"
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(Math.max(1, parseInt(e.target.value) || 1))}
            />
          </div>
          <div className="wsd-trial-summary">
            Trial will be extended to{" "}
            <strong>{formatDate(new Date(Date.now() + days * 86400000).toISOString())}</strong>
          </div>
        </div>
        <div className="wsd-modal-footer">
          <button className="btn btn--ghost" onClick={onClose} disabled={loading}>Cancel</button>
          <button className="btn btn--primary" onClick={() => onConfirm(days)} disabled={loading || days < 1}>
            {loading ? "Extending…" : `Extend by ${days} days`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Suspend Modal ────────────────────────────────────────────────────────────

function SuspendModal({
  onClose, onConfirm, loading,
}: {
  onClose: () => void;
  onConfirm: (reason: string) => void;
  loading: boolean;
}) {
  const [reason, setReason] = useState("");

  return (
    <div className="wsd-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wsd-modal wsd-modal--sm">
        <div className="wsd-modal-header">
          <div>
            <h2 className="wsd-modal-title" style={{ color: "#dc2626" }}>Suspend Workspace</h2>
            <p className="wsd-modal-sub">The workspace owner will be blocked from logging in</p>
          </div>
          <button className="wsd-modal-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="wsd-modal-body">
          <div className="wsd-suspend-warn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            All members of this workspace will lose access immediately.
          </div>
          <div className="form-group" style={{ marginTop: 16, marginBottom: 0 }}>
            <label className="form-label">Reason (optional)</label>
            <textarea
              className="form-input"
              rows={3}
              placeholder="e.g. Payment overdue, policy violation…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <div className="wsd-modal-footer">
          <button className="btn btn--ghost" onClick={onClose} disabled={loading}>Cancel</button>
          <button className="btn btn--danger" onClick={() => onConfirm(reason.trim())} disabled={loading}>
            {loading ? "Suspending…" : "Suspend workspace"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type ModalType = "changePlan" | "extendTrial" | "suspend" | null;

export function AdminWorkspaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<AdminWorkspaceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [modal, setModal] = useState<ModalType>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  function load() {
    if (!id) return;
    setLoading(true);
    getAdminWorkspace(id)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load workspace"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [id]);

  function showToast(type: "success" | "error", text: string) {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  }

  async function handleChangePlan(planCode: string) {
    if (!id) return;
    setActionLoading(true);
    try {
      await updateWorkspacePlan(id, { plan: planCode });
      setModal(null);
      showToast("success", `Plan updated to ${planCode}.`);
      load();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleExtendTrial(days: number) {
    if (!id) return;
    const trialEndsAt = new Date(Date.now() + days * 86400000).toISOString();
    setActionLoading(true);
    try {
      await updateWorkspacePlan(id, { trialEndsAt });
      setModal(null);
      showToast("success", `Trial extended by ${days} days.`);
      load();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSuspend(reason: string) {
    if (!data || !id) return;
    setActionLoading(true);
    try {
      await updateWorkspaceStatus(id, true, reason || undefined);
      setModal(null);
      showToast("success", "Workspace suspended.");
      load();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReactivate() {
    if (!id) return;
    setActionLoading(true);
    try {
      await updateWorkspaceStatus(id, false);
      showToast("success", "Workspace reactivated.");
      load();
    } catch (err) {
      showToast("error", err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) return <div className="admin-page"><div className="admin-loading"><div className="spinner" /></div></div>;
  if (error) return <div className="admin-page"><div className="alert alert--error">{error}</div></div>;
  if (!data) return null;

  const ws = data.workspace;
  const sub = ws.subscription;
  const planCode = ws.plan;

  return (
    <div className="admin-page">
      {/* Back */}
      <button className="admin-back-btn" onClick={() => navigate("/admin/workspaces")} style={{ marginBottom: 20 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
        </svg>
        Workspaces
      </button>

      {/* Toast */}
      {toast && (
        <div className={`alert alert--${toast.type === "success" ? "success" : "error"}`} style={{ marginBottom: 20 }}>
          {toast.text}
        </div>
      )}

      {/* Header */}
      <div className="wsd-header">
        <div className="wsd-header-left">
          <div className="wsd-avatar">{ws.name.slice(0, 2).toUpperCase()}</div>
          <div>
            <h1 className="wsd-name">{ws.name}</h1>
            <div className="wsd-meta-row">
              <span className="admin-muted" style={{ fontSize: 13 }}>Created {formatDate(ws.createdAt)}</span>
              {ws.businessType && (
                <span className="wsd-meta-dot" />
              )}
              {ws.businessType && <span className="admin-muted" style={{ fontSize: 13 }}>{ws.businessType}</span>}
              <span className="wsd-meta-dot" />
              <span className="admin-muted" style={{ fontSize: 13 }}>{ws.currency}</span>
            </div>
          </div>
        </div>
        <div className="wsd-header-right">
          <span className={`wsd-plan-pill ${planColorClass(planCode)}`}>{planCode}</span>
          {ws.suspended ? (
            <span className="admin-status-badge admin-status-badge--suspended">Suspended</span>
          ) : (
            <span className="admin-status-badge admin-status-badge--active">Active</span>
          )}
        </div>
      </div>

      {/* Suspended banner */}
      {ws.suspended && (
        <div className="wsd-suspended-banner">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
          <div>
            <strong>Workspace suspended</strong>
            {ws.suspendedAt && <span> · {formatDateTime(ws.suspendedAt)}</span>}
            {ws.suspendReason && <span> — {ws.suspendReason}</span>}
          </div>
        </div>
      )}

      {/* Quick Stats */}
      <div className="wsd-stats">
        <StatBox label="Items" value={ws.itemCount} />
        <StatBox label="Members" value={ws.memberships.length} />
        <StatBox label="Locations" value={ws.locations.length} />
        <StatBox label="Stock Movements" value={ws.stockMovementCount} />
        <StatBox label="Purchases" value={ws.purchaseCount} />
        <StatBox label="Suppliers" value={ws.supplierCount} />
      </div>

      {/* Action toolbar */}
      <div className="wsd-toolbar">
        <button className="wsd-action-btn wsd-action-btn--primary" disabled={actionLoading} onClick={() => setModal("changePlan")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 014-4h14" />
            <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 01-4 4H3" />
          </svg>
          Change Plan
        </button>
        <button className="wsd-action-btn wsd-action-btn--ghost" disabled={actionLoading} onClick={() => setModal("extendTrial")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
          </svg>
          Extend Trial
        </button>
        {ws.suspended ? (
          <button className="wsd-action-btn wsd-action-btn--success" disabled={actionLoading} onClick={handleReactivate}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Reactivate
          </button>
        ) : (
          <button className="wsd-action-btn wsd-action-btn--danger" disabled={actionLoading} onClick={() => setModal("suspend")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
            Suspend
          </button>
        )}
      </div>

      {/* Info cards */}
      <div className="admin-detail-grid" style={{ marginBottom: 28 }}>
        {/* Workspace Info */}
        <div className="admin-detail-card">
          <h3 className="admin-detail-card-title">Workspace Info</h3>
          <dl className="admin-dl">
            <dt>ID</dt>
            <dd><span className="admin-code" style={{ fontSize: 11 }}>{ws.id}</span></dd>
            <dt>Onboarding</dt>
            <dd>
              {ws.onboardingCompleted
                ? <span className="admin-status-badge admin-status-badge--active" style={{ fontSize: 11 }}>Completed</span>
                : <span className="admin-status-badge admin-status-badge--yellow" style={{ fontSize: 11 }}>Incomplete</span>}
            </dd>
            <dt>Trial Ends</dt>
            <dd>{ws.trialEndsAt ? formatDate(ws.trialEndsAt) : <span className="admin-muted">—</span>}</dd>
            <dt>Sub Status</dt>
            <dd>{ws.subscriptionStatus ?? <span className="admin-muted">—</span>}</dd>
          </dl>
        </div>

        {/* Owner */}
        <div className="admin-detail-card">
          <h3 className="admin-detail-card-title">Owner</h3>
          <div className="wsd-owner-row">
            <div className="wsd-owner-avatar">{ws.owner.name.slice(0, 2).toUpperCase()}</div>
            <div>
              <Link to={`/admin/users/${ws.owner.id}`} className="admin-link" style={{ fontWeight: 600, fontSize: 14 }}>
                {ws.owner.name}
              </Link>
              <div className="admin-muted" style={{ fontSize: 12.5, marginTop: 2 }}>{ws.owner.email}</div>
            </div>
            {ws.owner.emailVerified && (
              <span className="wsd-verified-badge" title="Email verified">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            )}
          </div>
          <dl className="admin-dl" style={{ marginTop: 14 }}>
            <dt>Joined</dt><dd>{formatDate(ws.owner.createdAt)}</dd>
            <dt>Verified</dt><dd>{ws.owner.emailVerified ? "Yes" : "No"}</dd>
          </dl>
        </div>

        {/* Locations */}
        {ws.locations.length > 0 && (
          <div className="admin-detail-card">
            <h3 className="admin-detail-card-title">Locations ({ws.locations.length})</h3>
            <div className="wsd-location-list">
              {ws.locations.map((loc) => (
                <div key={loc.id} className="wsd-location-item">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  <span>{loc.name}</span>
                  <span className="admin-muted" style={{ fontSize: 11, marginLeft: "auto" }}>{formatDate(loc.createdAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Subscription */}
      {sub ? (
        <div className="admin-section">
          <div className="admin-section-header">
            <h2 className="admin-section-title">Subscription</h2>
            <Link to="/admin/subscriptions" className="admin-section-link">View all →</Link>
          </div>
          <div className="admin-detail-grid">
            <div className="admin-detail-card wsd-sub-card">
              <div className="wsd-sub-header">
                <div>
                  <div className="wsd-sub-plan-name">{sub.plan?.name ?? "Unknown Plan"}</div>
                  <div className="admin-muted" style={{ fontSize: 12 }}>{sub.plan?.code}</div>
                </div>
                <span className={`wsd-sub-status wsd-sub-status--${(sub.status ?? "").toLowerCase().replace(/_/g, "-")}`}>
                  {sub.status?.replace(/_/g, " ") ?? "—"}
                </span>
              </div>
              <dl className="admin-dl" style={{ marginTop: 14 }}>
                <dt>Billing</dt><dd>{sub.billingCycle}</dd>
                <dt>Amount</dt>
                <dd>
                  {sub.amount != null
                    ? <strong>{sub.currency} {sub.amount.toLocaleString()}/mo</strong>
                    : <span className="admin-muted">—</span>}
                </dd>
                {sub.trialEndsAt && <><dt>Trial Ends</dt><dd>{formatDate(sub.trialEndsAt)}</dd></>}
                {sub.currentPeriodEnd && <><dt>Period End</dt><dd>{formatDate(sub.currentPeriodEnd)}</dd></>}
                {sub.nextRenewalAt && <><dt>Next Renewal</dt><dd>{formatDate(sub.nextRenewalAt)}</dd></>}
                {sub.coupon && (
                  <>
                    <dt>Coupon</dt>
                    <dd><code className="admin-code">{sub.coupon.code}</code> {sub.coupon.name}</dd>
                  </>
                )}
                {sub.manualNotes && (
                  <>
                    <dt>Notes</dt>
                    <dd className="admin-muted">{sub.manualNotes}</dd>
                  </>
                )}
              </dl>
            </div>

            {ws.payments && ws.payments.length > 0 && (
              <div className="admin-detail-card">
                <h3 className="admin-detail-card-title">Recent Payments</h3>
                <div className="wsd-payment-list">
                  {ws.payments.slice(0, 5).map((p) => (
                    <div key={p.id} className="wsd-payment-row">
                      <div>
                        <div className="wsd-payment-amount">{p.currency} {p.amount?.toLocaleString() ?? "—"}</div>
                        <div className="wsd-payment-meta">{p.paymentMethod?.replace(/_/g, " ") ?? "—"} · {p.paidAt ? formatDate(p.paidAt) : "Pending"}</div>
                      </div>
                      <span className={`admin-status-badge admin-status-badge--${p.status === "PAID" ? "active" : "yellow"}`}>
                        {p.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="admin-section">
          <h2 className="admin-section-title">Subscription</h2>
          <div className="wsd-no-sub">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
              <line x1="1" y1="10" x2="23" y2="10" />
            </svg>
            <p>No active subscription</p>
          </div>
        </div>
      )}

      {/* Members */}
      <div className="admin-section">
        <h2 className="admin-section-title">Members ({ws.memberships.length})</h2>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Verified</th>
                <th>Status</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {ws.memberships.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link to={`/admin/users/${m.user.id}`} className="admin-link">{m.user.name}</Link>
                  </td>
                  <td className="admin-muted">{m.user.email}</td>
                  <td><span className="admin-badge admin-badge--gray">{m.role}</span></td>
                  <td>{m.user.emailVerified
                    ? <span style={{ color: "#16a34a", fontWeight: 600, fontSize: 12 }}>Yes</span>
                    : <span className="admin-muted" style={{ fontSize: 12 }}>No</span>}
                  </td>
                  <td>
                    {m.isActive
                      ? <span className="admin-status-badge admin-status-badge--active">Active</span>
                      : <span className="admin-status-badge admin-status-badge--suspended">Inactive</span>}
                  </td>
                  <td className="admin-muted">{formatDate(m.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="admin-section">
        <h2 className="admin-section-title">Recent Stock Activity</h2>
        {data.recentActivity.length === 0 ? (
          <p className="admin-empty">No recent activity.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr><th>Item</th><th>Type</th><th>Qty</th><th>Time</th></tr>
              </thead>
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

      {/* Modals */}
      {modal === "changePlan" && (
        <ChangePlanModal
          currentPlan={planCode}
          loading={actionLoading}
          onClose={() => setModal(null)}
          onConfirm={handleChangePlan}
        />
      )}
      {modal === "extendTrial" && (
        <ExtendTrialModal
          loading={actionLoading}
          onClose={() => setModal(null)}
          onConfirm={handleExtendTrial}
        />
      )}
      {modal === "suspend" && (
        <SuspendModal
          loading={actionLoading}
          onClose={() => setModal(null)}
          onConfirm={handleSuspend}
        />
      )}
    </div>
  );
}
