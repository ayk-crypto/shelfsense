import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getAdminSubscriptions } from "../../api/admin";
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

export function AdminSubscriptionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [subscriptions, setSubscriptions] = useState<AdminSubscription[]>([]);
  const [pagination, setPagination] = useState<AdminPagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="admin-page">
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
                  <th>Trial / Period End</th>
                  <th>Next Renewal</th>
                  <th>Coupon</th>
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
                      {s.trialEndsAt ? `Trial: ${fmtDate(s.trialEndsAt)}` : s.currentPeriodEnd ? fmtDate(s.currentPeriodEnd) : "—"}
                    </td>
                    <td className="admin-muted">{s.nextRenewalAt ? fmtDate(s.nextRenewalAt) : "—"}</td>
                    <td>{s.coupon ? <code className="admin-code">{s.coupon.code}</code> : <span className="admin-muted">—</span>}</td>
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
