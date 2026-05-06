import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { activateAdminSubscription, getAdminSubscriptions } from "../../api/admin";
import type { AdminSubscription, AdminPagination } from "../../types";

const STATUS_COLORS: Record<string, string> = {
  TRIAL: "yellow",
  ACTIVE: "active",
  PAST_DUE: "warning",
  EXPIRED: "red",
  SUSPENDED: "suspended",
  CANCELLED: "gray",
  MANUAL_REVIEW: "purple",
};

interface ActivateModalProps {
  sub: AdminSubscription;
  onClose: () => void;
  onActivated: (updated: AdminSubscription) => void;
}

function ActivateModal({ sub, onClose, onActivated }: ActivateModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [billingCycle, setBillingCycle] = useState("MONTHLY");
  const [expiryDate, setExpiryDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultExpiry = (() => {
    const d = new Date();
    if (billingCycle === "ANNUAL") d.setFullYear(d.getFullYear() + 1);
    else d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  })();

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === overlayRef.current) onClose();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleActivate() {
    setLoading(true);
    setError(null);
    try {
      const result = await activateAdminSubscription(sub.id, {
        billingCycle,
        expiryDate: expiryDate || defaultExpiry,
      });
      onActivated(result.subscription);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to activate subscription");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="admin-modal-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="admin-modal" role="dialog" aria-modal="true">
        <div className="admin-modal-header">
          <h2 className="admin-modal-title">Activate Subscription</h2>
          <button className="admin-modal-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="admin-modal-body">
          <div className="admin-form-row">
            <div className="admin-info-chip" style={{ marginBottom: 16 }}>
              <span className="admin-muted">Workspace:</span>{" "}
              <strong>{sub.workspace.name}</strong>
              <span className="admin-muted" style={{ marginLeft: 8 }}>{sub.workspace.owner.email}</span>
            </div>
            <div className="admin-info-chip">
              <span className="admin-muted">Plan:</span>{" "}
              <strong>{sub.plan.name}</strong>
              <span className="admin-muted" style={{ marginLeft: 8 }}>({sub.plan.code})</span>
            </div>
          </div>

          <div className="admin-form-group" style={{ marginTop: 20 }}>
            <label className="admin-form-label">Billing Cycle</label>
            <select
              className="admin-filter-select"
              style={{ width: "100%" }}
              value={billingCycle}
              onChange={(e) => setBillingCycle(e.target.value)}
            >
              <option value="MONTHLY">Monthly</option>
              <option value="ANNUAL">Annual</option>
              <option value="MANUAL">Manual (no auto-renewal)</option>
            </select>
          </div>

          <div className="admin-form-group" style={{ marginTop: 14 }}>
            <label className="admin-form-label">Subscription Expiry Date</label>
            <input
              type="date"
              className="admin-filter-select"
              style={{ width: "100%" }}
              value={expiryDate || defaultExpiry}
              onChange={(e) => setExpiryDate(e.target.value)}
            />
            <p className="admin-form-hint">Leave at default to use a standard {billingCycle === "ANNUAL" ? "1-year" : "30-day"} period from today.</p>
          </div>

          {error && <div className="alert alert--error" style={{ marginTop: 12 }}>{error}</div>}
        </div>

        <div className="admin-modal-footer">
          <button className="btn btn--ghost" onClick={onClose} disabled={loading}>Cancel</button>
          <button className="btn btn--primary" onClick={() => void handleActivate()} disabled={loading}>
            {loading ? <><span className="spinner spinner--sm spinner--white" /> Activating…</> : "Activate Subscription"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AdminSubscriptionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [subscriptions, setSubscriptions] = useState<AdminSubscription[]>([]);
  const [pagination, setPagination] = useState<AdminPagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activateTarget, setActivateTarget] = useState<AdminSubscription | null>(null);

  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const status = searchParams.get("status") ?? "";

  function load() {
    setLoading(true);
    getAdminSubscriptions({ page, status: status || undefined })
      .then((r) => { setSubscriptions(r.subscriptions); setPagination(r.pagination); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [page, status]);

  function setParam(k: string, v: string) {
    const next = new URLSearchParams(searchParams);
    if (v) next.set(k, v); else next.delete(k);
    if (k !== "page") next.delete("page");
    setSearchParams(next);
  }

  function handleActivated(updated: AdminSubscription) {
    setSubscriptions((prev) => prev.map((s) => s.id === updated.id ? updated : s));
    setActivateTarget(null);
  }

  return (
    <div className="admin-page">
      {activateTarget && (
        <ActivateModal
          sub={activateTarget}
          onClose={() => setActivateTarget(null)}
          onActivated={handleActivated}
        />
      )}

      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Subscriptions</h1>
          <p className="admin-page-subtitle">{pagination?.total.toLocaleString() ?? "—"} total subscriptions</p>
        </div>
      </div>

      <div className="admin-filters">
        <select className="admin-filter-select" value={status} onChange={(e) => setParam("status", e.target.value)}>
          <option value="">All statuses</option>
          {["TRIAL", "ACTIVE", "PAST_DUE", "EXPIRED", "SUSPENDED", "CANCELLED", "MANUAL_REVIEW"].map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="admin-loading"><div className="spinner" /></div>
      ) : error ? (
        <div className="alert alert--error">{error}</div>
      ) : subscriptions.length === 0 ? (
        <p className="admin-empty">No subscriptions found.</p>
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Workspace</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Billing</th>
                  <th>Amount</th>
                  <th>Period End</th>
                  <th>Coupon</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link to={`/admin/workspaces/${s.workspaceId}`} className="admin-link">{s.workspace.name}</Link>
                      <div className="admin-muted">{s.workspace.owner.email}</div>
                    </td>
                    <td>{s.plan.name} <span className="admin-muted">({s.plan.code})</span></td>
                    <td>
                      <span className={`admin-status-badge admin-status-badge--${STATUS_COLORS[s.status] ?? "gray"}`}>
                        {s.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="admin-muted">{s.billingCycle}</td>
                    <td>{s.currency} {s.amount.toLocaleString()}</td>
                    <td className="admin-muted">
                      {s.currentPeriodEnd ? fmtDate(s.currentPeriodEnd) : s.trialEndsAt ? `Trial: ${fmtDate(s.trialEndsAt)}` : "—"}
                    </td>
                    <td>{s.coupon ? <code className="admin-code">{s.coupon.code}</code> : <span className="admin-muted">—</span>}</td>
                    <td>
                      {s.status === "MANUAL_REVIEW" && (
                        <button
                          className="btn btn--sm btn--primary"
                          onClick={() => setActivateTarget(s)}
                          type="button"
                        >
                          Activate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pagination && pagination.pages > 1 && (
            <div className="admin-pagination">
              <button className="btn btn--ghost btn--sm" disabled={page <= 1} onClick={() => setParam("page", String(page - 1))}>← Prev</button>
              <span className="admin-pagination-info">Page {page} of {pagination.pages}</span>
              <button className="btn btn--ghost btn--sm" disabled={page >= pagination.pages} onClick={() => setParam("page", String(page + 1))}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
