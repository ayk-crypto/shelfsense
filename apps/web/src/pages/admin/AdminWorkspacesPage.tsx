import { useEffect, useState, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getAdminWorkspaces, updateWorkspaceStatus } from "../../api/admin";
import type { AdminWorkspace } from "../../types";

export function AdminWorkspacesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [workspaces, setWorkspaces] = useState<AdminWorkspace[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const search = searchParams.get("search") ?? "";
  const status = searchParams.get("status") ?? "";
  const plan = searchParams.get("plan") ?? "";

  function load() {
    setLoading(true);
    setError(null);
    getAdminWorkspaces({ page, search: search || undefined, status: status || undefined, plan: plan || undefined })
      .then((res) => {
        setWorkspaces(res.workspaces);
        setTotal(res.pagination.total);
        setPages(res.pagination.pages);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load workspaces"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [page, search, status, plan]);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "page") next.delete("page");
    setSearchParams(next);
  }

  async function handleToggleSuspend(ws: AdminWorkspace) {
    const newState = !ws.suspended;
    let reason: string | undefined;
    if (newState) {
      const r = window.prompt("Reason for suspension (optional):");
      if (r === null) return;
      reason = r.trim() || undefined;
    }
    setActionLoading(ws.id);
    setActionError(null);
    try {
      await updateWorkspaceStatus(ws.id, newState, reason);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1 className="admin-page-title">Workspaces</h1>
        <p className="admin-page-subtitle">{total.toLocaleString()} total workspaces</p>
      </div>

      <div className="admin-filters">
        <form className="admin-search-form" onSubmit={(e) => { e.preventDefault(); setParam("search", searchInputRef.current?.value ?? ""); }}>
          <input
            ref={searchInputRef}
            type="search"
            className="admin-search-input"
            placeholder="Search name, owner email…"
            defaultValue={search}
          />
          <button type="submit" className="btn btn--primary">Search</button>
        </form>
        <select className="admin-filter-select" value={status} onChange={(e) => setParam("status", e.target.value)}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <select className="admin-filter-select" value={plan} onChange={(e) => setParam("plan", e.target.value)}>
          <option value="">All plans</option>
          <option value="FREE">Free</option>
          <option value="BASIC">Basic</option>
          <option value="PRO">Pro</option>
        </select>
      </div>

      {actionError && <div className="alert alert--error" style={{ marginBottom: 12 }}>{actionError}</div>}

      {loading ? (
        <div className="admin-loading"><div className="spinner" /></div>
      ) : error ? (
        <div className="alert alert--error">{error}</div>
      ) : workspaces.length === 0 ? (
        <p className="admin-empty">No workspaces found.</p>
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Workspace</th>
                  <th>Owner</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Users</th>
                  <th>Items</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {workspaces.map((ws) => (
                  <tr key={ws.id} className={ws.suspended ? "admin-row--suspended" : ""}>
                    <td>
                      <Link to={`/admin/workspaces/${ws.id}`} className="admin-link">{ws.name}</Link>
                    </td>
                    <td>
                      <div>{ws.owner.name}</div>
                      <div className="admin-muted">{ws.owner.email}</div>
                    </td>
                    <td><span className={`admin-plan-badge admin-plan-badge--${ws.plan.toLowerCase()}`}>{ws.plan}</span></td>
                    <td>
                      {ws.suspended
                        ? <span className="admin-status-badge admin-status-badge--suspended">Suspended</span>
                        : <span className="admin-status-badge admin-status-badge--active">Active</span>}
                    </td>
                    <td>{ws.memberCount}</td>
                    <td>{ws.itemCount}</td>
                    <td className="admin-muted">{formatDate(ws.createdAt)}</td>
                    <td>
                      <div className="admin-actions">
                        <Link to={`/admin/workspaces/${ws.id}`} className="admin-action-btn">View</Link>
                        <button
                          className={`admin-action-btn admin-action-btn--${ws.suspended ? "success" : "danger"}`}
                          disabled={actionLoading === ws.id}
                          onClick={() => handleToggleSuspend(ws)}
                        >
                          {actionLoading === ws.id ? "…" : ws.suspended ? "Reactivate" : "Suspend"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="admin-pagination">
            <button className="btn btn--ghost btn--sm" disabled={page <= 1} onClick={() => setParam("page", String(page - 1))}>
              ← Prev
            </button>
            <span className="admin-pagination-info">Page {page} of {pages}</span>
            <button className="btn btn--ghost btn--sm" disabled={page >= pages} onClick={() => setParam("page", String(page + 1))}>
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
