import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getAdminAuditLogs } from "../../api/admin";
import type { AdminAuditLog } from "../../types";

export function AdminActivityPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [logs, setLogs] = useState<AdminAuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const action = searchParams.get("action") ?? "";

  useEffect(() => {
    setLoading(true);
    getAdminAuditLogs({ page, action: action || undefined })
      .then((res) => {
        setLogs(res.logs);
        setTotal(res.pagination.total);
        setPages(res.pagination.pages);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load audit logs"))
      .finally(() => setLoading(false));
  }, [page, action]);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "page") next.delete("page");
    setSearchParams(next);
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1 className="admin-page-title">Platform Audit Logs</h1>
        <p className="admin-page-subtitle">{total.toLocaleString()} admin actions recorded</p>
      </div>

      <div className="admin-filters">
        <select className="admin-filter-select" value={action} onChange={(e) => setParam("action", e.target.value)}>
          <option value="">All actions</option>
          <option value="workspace_suspended">workspace_suspended</option>
          <option value="workspace_reactivated">workspace_reactivated</option>
          <option value="workspace_plan_changed">workspace_plan_changed</option>
          <option value="user_disabled">user_disabled</option>
          <option value="user_enabled">user_enabled</option>
          <option value="admin_resend_verification">admin_resend_verification</option>
          <option value="admin_force_password_reset">admin_force_password_reset</option>
        </select>
      </div>

      {loading ? (
        <div className="admin-loading"><div className="spinner" /></div>
      ) : error ? (
        <div className="alert alert--error">{error}</div>
      ) : logs.length === 0 ? (
        <p className="admin-empty">No audit logs found.</p>
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Admin</th>
                  <th>Details</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td><span className="admin-action-badge">{log.action.replace(/_/g, " ")}</span></td>
                    <td>{log.entity} <span className="admin-muted">{log.entityId.slice(0, 8)}…</span></td>
                    <td>
                      <div>{log.admin.name}</div>
                      <div className="admin-muted">{log.admin.email}</div>
                    </td>
                    <td>
                      <pre className="admin-meta">{JSON.stringify(log.meta, null, 2)}</pre>
                    </td>
                    <td className="admin-muted">{formatDate(log.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="admin-pagination">
            <button className="btn btn--ghost btn--sm" disabled={page <= 1} onClick={() => setParam("page", String(page - 1))}>← Prev</button>
            <span className="admin-pagination-info">Page {page} of {pages}</span>
            <button className="btn btn--ghost btn--sm" disabled={page >= pages} onClick={() => setParam("page", String(page + 1))}>Next →</button>
          </div>
        </>
      )}
    </div>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
