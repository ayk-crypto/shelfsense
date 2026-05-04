import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getAdminEmailLogs } from "../../api/admin";
import type { AdminEmailLog, AdminPagination } from "../../types";

const STATUS_COLORS: Record<string, string> = {
  SENT: "active",
  FAILED: "suspended",
  QUEUED: "yellow",
};

export function AdminEmailLogsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [logs, setLogs] = useState<AdminEmailLog[]>([]);
  const [pagination, setPagination] = useState<AdminPagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const status = searchParams.get("status") ?? "";
  const type = searchParams.get("type") ?? "";

  function load() {
    setLoading(true);
    getAdminEmailLogs({ page, status: status || undefined, type: type || undefined })
      .then((r) => { setLogs(r.logs); setPagination(r.pagination); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [page, status, type]);

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
          <h1 className="admin-page-title">Email Logs</h1>
          <p className="admin-page-subtitle">{pagination?.total.toLocaleString() ?? "—"} total emails logged</p>
        </div>
      </div>

      <div className="admin-filters">
        <select className="admin-filter-select" value={status} onChange={(e) => setParam("status", e.target.value)}>
          <option value="">All statuses</option>
          <option value="SENT">Sent</option>
          <option value="FAILED">Failed</option>
          <option value="QUEUED">Queued</option>
        </select>
        <select className="admin-filter-select" value={type} onChange={(e) => setParam("type", e.target.value)}>
          <option value="">All types</option>
          {["EMAIL_VERIFICATION", "PASSWORD_RESET", "WELCOME", "TRIAL_ENDING_SOON", "LOW_STOCK_ALERT", "EXPIRING_STOCK_ALERT"].map((t) => (
            <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="admin-loading"><div className="spinner" /></div>
      ) : error ? (
        <div className="alert alert--error">{error}</div>
      ) : logs.length === 0 ? (
        <p className="admin-empty">No email logs found.</p>
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Recipient</th>
                  <th>Subject</th>
                  <th>Status</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="admin-muted">{fmtDate(l.createdAt)}</td>
                    <td><code className="admin-code" style={{ fontSize: 11 }}>{l.type.replace(/_/g, " ")}</code></td>
                    <td>{l.recipient}</td>
                    <td className="admin-muted" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.subject}</td>
                    <td>
                      <span className={`admin-status-badge admin-status-badge--${STATUS_COLORS[l.status] ?? "gray"}`}>
                        {l.status}
                      </span>
                    </td>
                    <td>
                      {l.errorMessage
                        ? <span className="admin-muted" style={{ fontSize: 11, color: "var(--color-red)" }}>{l.errorMessage.slice(0, 60)}</span>
                        : <span className="admin-muted">—</span>}
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
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
