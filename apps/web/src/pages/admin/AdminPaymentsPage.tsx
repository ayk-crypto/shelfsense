import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getAdminPayments, updateAdminPayment } from "../../api/admin";
import type { AdminPayment, AdminPagination } from "../../types";

const STATUS_COLORS: Record<string, string> = {
  PENDING: "yellow",
  PAID: "active",
  FAILED: "red",
  REFUNDED: "purple",
  CANCELLED: "gray",
};

export function AdminPaymentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [pagination, setPagination] = useState<AdminPagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const status = searchParams.get("status") ?? "";

  function load() {
    setLoading(true);
    getAdminPayments({ page, status: status || undefined })
      .then((r) => { setPayments(r.payments); setPagination(r.pagination); })
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

  function showToast(type: "success" | "error", text: string) {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  }

  async function handleMarkPaid(p: AdminPayment) {
    if (!window.confirm(`Mark payment PKR ${p.amount.toLocaleString()} as PAID?`)) return;
    setActionLoading(p.id);
    try {
      await updateAdminPayment(p.id, { status: "PAID", paidAt: new Date().toISOString() });
      showToast("success", "Payment marked as paid.");
      load();
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Failed");
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Payments</h1>
          <p className="admin-page-subtitle">{pagination?.total.toLocaleString() ?? "—"} payment records</p>
        </div>
      </div>

      {toast && (
        <div className={`alert alert--${toast.type === "success" ? "success" : "error"}`} style={{ marginBottom: 16 }}>
          {toast.text}
        </div>
      )}

      <div className="admin-filters">
        <select className="admin-filter-select" value={status} onChange={(e) => setParam("status", e.target.value)}>
          <option value="">All statuses</option>
          {["PENDING", "PAID", "FAILED", "REFUNDED", "CANCELLED"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="admin-loading"><div className="spinner" /></div>
      ) : error ? (
        <div className="alert alert--error">{error}</div>
      ) : payments.length === 0 ? (
        <p className="admin-empty">No payments found.</p>
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Workspace</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Reference</th>
                  <th>Status</th>
                  <th>Paid At</th>
                  <th>Recorded</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/admin/workspaces/${p.workspaceId}`} className="admin-link">{p.workspace.name}</Link>
                    </td>
                    <td>{p.currency} {p.amount.toLocaleString()}</td>
                    <td className="admin-muted">{p.paymentMethod.replace(/_/g, " ")}</td>
                    <td className="admin-muted">{p.referenceNumber ?? "—"}</td>
                    <td>
                      <span className={`admin-status-badge admin-status-badge--${STATUS_COLORS[p.status] ?? "gray"}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="admin-muted">{p.paidAt ? fmtDate(p.paidAt) : "—"}</td>
                    <td className="admin-muted">{fmtDate(p.createdAt)}</td>
                    <td>
                      {p.status === "PENDING" && (
                        <button
                          className="admin-action-btn admin-action-btn--success"
                          disabled={actionLoading === p.id}
                          onClick={() => handleMarkPaid(p)}
                        >
                          Mark Paid
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
