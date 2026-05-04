import { useEffect, useState, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getAdminUsers, updateUserStatus } from "../../api/admin";
import type { AdminUser } from "../../types";

export function AdminUsersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const search = searchParams.get("search") ?? "";
  const verified = searchParams.get("verified") ?? "";
  const disabled = searchParams.get("disabled") ?? "";

  function load() {
    setLoading(true);
    setError(null);
    getAdminUsers({ page, search: search || undefined, verified: verified || undefined, disabled: disabled || undefined })
      .then((res) => {
        setUsers(res.users);
        setTotal(res.pagination.total);
        setPages(res.pagination.pages);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load users"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [page, search, verified, disabled]);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "page") next.delete("page");
    setSearchParams(next);
  }

  async function handleToggleDisable(user: AdminUser) {
    if (user.platformRole === "SUPER_ADMIN") return;
    const newState = !user.isDisabled;
    if (newState && !window.confirm(`Disable ${user.name}? They will be blocked from logging in.`)) return;
    setActionLoading(user.id);
    setActionError(null);
    try {
      await updateUserStatus(user.id, newState);
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
        <h1 className="admin-page-title">Users</h1>
        <p className="admin-page-subtitle">{total.toLocaleString()} total users</p>
      </div>

      <div className="admin-filters">
        <form className="admin-search-form" onSubmit={(e) => { e.preventDefault(); setParam("search", searchInputRef.current?.value ?? ""); }}>
          <input
            ref={searchInputRef}
            type="search"
            className="admin-search-input"
            placeholder="Search name or email…"
            defaultValue={search}
          />
          <button type="submit" className="btn btn--primary">Search</button>
        </form>
        <select className="admin-filter-select" value={verified} onChange={(e) => setParam("verified", e.target.value)}>
          <option value="">All verification</option>
          <option value="true">Verified</option>
          <option value="false">Unverified</option>
        </select>
        <select className="admin-filter-select" value={disabled} onChange={(e) => setParam("disabled", e.target.value)}>
          <option value="">All statuses</option>
          <option value="false">Active</option>
          <option value="true">Disabled</option>
        </select>
      </div>

      {actionError && <div className="alert alert--error" style={{ marginBottom: 12 }}>{actionError}</div>}

      {loading ? (
        <div className="admin-loading"><div className="spinner" /></div>
      ) : error ? (
        <div className="alert alert--error">{error}</div>
      ) : users.length === 0 ? (
        <p className="admin-empty">No users found.</p>
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Verified</th>
                  <th>Status</th>
                  <th>Role</th>
                  <th>Workspaces</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className={user.isDisabled ? "admin-row--suspended" : ""}>
                    <td><Link to={`/admin/users/${user.id}`} className="admin-link">{user.name}</Link></td>
                    <td>{user.email}</td>
                    <td>
                      {user.emailVerified
                        ? <span className="admin-status-badge admin-status-badge--active">Verified</span>
                        : <span className="admin-status-badge admin-status-badge--pending">Unverified</span>}
                    </td>
                    <td>
                      {user.isDisabled
                        ? <span className="admin-status-badge admin-status-badge--suspended">Disabled</span>
                        : <span className="admin-status-badge admin-status-badge--active">Active</span>}
                    </td>
                    <td>
                      {user.platformRole !== "USER"
                        ? <span className="admin-platform-role-badge">{user.platformRole.replace(/_/g, " ")}</span>
                        : <span className="admin-muted">User</span>}
                    </td>
                    <td>{user.workspaceCount}</td>
                    <td className="admin-muted">{formatDate(user.createdAt)}</td>
                    <td>
                      <div className="admin-actions">
                        <Link to={`/admin/users/${user.id}`} className="admin-action-btn">View</Link>
                        {user.platformRole !== "SUPER_ADMIN" && (
                          <button
                            className={`admin-action-btn admin-action-btn--${user.isDisabled ? "success" : "danger"}`}
                            disabled={actionLoading === user.id}
                            onClick={() => handleToggleDisable(user)}
                          >
                            {actionLoading === user.id ? "…" : user.isDisabled ? "Enable" : "Disable"}
                          </button>
                        )}
                      </div>
                    </td>
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
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
