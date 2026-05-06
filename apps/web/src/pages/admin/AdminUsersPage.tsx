import { useEffect, useState, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getAdminUsers, getAdminUsersStats, updateUserStatus } from "../../api/admin";
import { useAuth } from "../../context/AuthContext";
import type { AdminUser, AdminUsersStats } from "../../types";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateShort(iso: string | null) {
  if (!iso) return "Never";
  const d = new Date(iso);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 30) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function PlanBadge({ plan }: { plan: string }) {
  return <span className={`admin-plan-badge admin-plan-badge--${plan.toLowerCase()}`}>{plan}</span>;
}

function SubStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="admin-muted">—</span>;
  const cls = status === "ACTIVE" ? "active" : status === "MANUAL_REVIEW" ? "pending" : "gray";
  const label = status === "MANUAL_REVIEW" ? "Pending" : status.replace(/_/g, " ");
  return <span className={`admin-status-badge admin-status-badge--${cls}`}>{label}</span>;
}

function StatCard({
  label, value, active, onClick, color,
}: {
  label: string; value: number; active?: boolean; onClick?: () => void; color: string;
}) {
  return (
    <div
      className={`admin-stat-card admin-stat-card--${color}${active ? " admin-stat-card--active" : ""}${onClick ? " admin-stat-card--clickable" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") onClick(); } : undefined}
    >
      <div className="admin-stat-card-value">{value.toLocaleString()}</div>
      <div className="admin-stat-card-label">{label}</div>
      {active && <div className="admin-stat-card-active-dot" />}
    </div>
  );
}

export function AdminUsersPage() {
  const { user: authUser } = useAuth();
  const isSuperAdmin = authUser?.platformRole === "SUPER_ADMIN";

  const [searchParams, setSearchParams] = useSearchParams();
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const search = searchParams.get("search") ?? "";
  const verified = searchParams.get("verified") ?? "";
  const disabled = searchParams.get("disabled") ?? "";
  const role = searchParams.get("role") ?? "";
  const plan = searchParams.get("plan") ?? "";
  const subscriptionStatus = searchParams.get("subscriptionStatus") ?? "";
  const includePlatformAdmins = searchParams.get("includePlatformAdmins") === "true";

  const [stats, setStats] = useState<AdminUsersStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setStatsLoading(true);
    getAdminUsersStats()
      .then((r) => setStats(r.stats))
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, []);

  function load() {
    setLoading(true);
    setError(null);
    getAdminUsers({
      page,
      search: search || undefined,
      verified: verified || undefined,
      disabled: disabled || undefined,
      role: role || undefined,
      plan: plan || undefined,
      subscriptionStatus: subscriptionStatus || undefined,
      includePlatformAdmins: includePlatformAdmins ? "true" : undefined,
    })
      .then((res) => {
        setUsers(res.users);
        setTotal(res.pagination.total);
        setPages(res.pagination.pages);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load users"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, [page, search, verified, disabled, role, plan, subscriptionStatus, includePlatformAdmins]);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "page") next.delete("page");
    setSearchParams(next);
  }

  function toggleParam(key: string, value: string, current: string) {
    setParam(key, current === value ? "" : value);
  }

  const [disableTarget, setDisableTarget] = useState<AdminUser | null>(null);

  async function execToggleDisable(user: AdminUser) {
    if (user.platformRole === "SUPER_ADMIN") return;
    setDisableTarget(null);
    setActionLoading(user.id);
    setActionError(null);
    try {
      await updateUserStatus(user.id, !user.isDisabled);
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading(null);
    }
  }

  function handleToggleDisable(user: AdminUser) {
    if (user.platformRole === "SUPER_ADMIN") return;
    if (!user.isDisabled) { setDisableTarget(user); return; }
    void execToggleDisable(user);
  }

  const hasFilters = !!(search || verified || disabled || role || plan || subscriptionStatus || includePlatformAdmins);

  return (
    <div className="admin-page">
      {disableTarget && (
        <div className="ud-confirm-overlay" onClick={() => setDisableTarget(null)}>
          <div className="ud-confirm-box" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 className="ud-confirm-title">Disable User Account</h3>
            <p className="ud-confirm-message">
              Disable <strong>{disableTarget.name}</strong> ({disableTarget.email})?
              They will be immediately blocked from logging in. You can re-enable them at any time.
            </p>
            <div className="ud-confirm-actions">
              <button className="btn btn--ghost btn--sm" onClick={() => setDisableTarget(null)}>Cancel</button>
              <button className="btn btn--danger btn--sm" onClick={() => void execToggleDisable(disableTarget)}>
                Disable Account
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Users</h1>
          <p className="admin-page-subtitle">
            {loading ? "Loading…" : `${total.toLocaleString()} ${includePlatformAdmins ? "total users" : "customer accounts"}`}
          </p>
        </div>
      </div>

      {/* Stats strip */}
      <div className="admin-stat-grid admin-stat-grid--6">
        {statsLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="admin-stat-card admin-stat-card--skeleton" />
          ))
        ) : stats ? (
          <>
            <StatCard label="Total Customers" value={stats.total} color="blue" />
            <StatCard label="Verified" value={stats.verified} color="green"
              active={verified === "true"}
              onClick={() => toggleParam("verified", "true", verified)} />
            <StatCard label="Unverified" value={stats.unverified} color="yellow"
              active={verified === "false"}
              onClick={() => toggleParam("verified", "false", verified)} />
            <StatCard label="Active" value={stats.active} color="teal"
              active={disabled === "false"}
              onClick={() => toggleParam("disabled", "false", disabled)} />
            <StatCard label="Disabled" value={stats.disabled} color="red"
              active={disabled === "true"}
              onClick={() => toggleParam("disabled", "true", disabled)} />
            <StatCard label="New This Month" value={stats.newThisMonth} color="purple" />
          </>
        ) : null}
      </div>

      {/* Filters */}
      <div className="admin-filters admin-filters--wrap">
        <form
          className="admin-search-form"
          onSubmit={(e) => { e.preventDefault(); setParam("search", searchInputRef.current?.value ?? ""); }}
        >
          <input
            ref={searchInputRef}
            type="search"
            className="admin-search-input"
            placeholder="Search name or email…"
            defaultValue={search}
          />
          <button type="submit" className="btn btn--primary btn--sm">Search</button>
        </form>

        <select className="admin-filter-select" value={role} onChange={(e) => setParam("role", e.target.value)}>
          <option value="">All roles</option>
          <option value="OWNER">Owner</option>
          <option value="MANAGER">Manager</option>
          <option value="OPERATOR">Operator</option>
        </select>

        <select className="admin-filter-select" value={plan} onChange={(e) => setParam("plan", e.target.value)}>
          <option value="">All plans</option>
          <option value="FREE">Free</option>
          <option value="BASIC">Basic</option>
          <option value="PRO">Pro</option>
        </select>

        <select className="admin-filter-select" value={subscriptionStatus} onChange={(e) => setParam("subscriptionStatus", e.target.value)}>
          <option value="">All sub statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="MANUAL_REVIEW">Pending Payment</option>
          <option value="CANCELLED">Cancelled</option>
        </select>

        <select className="admin-filter-select" value={verified} onChange={(e) => setParam("verified", e.target.value)}>
          <option value="">All verification</option>
          <option value="true">Verified</option>
          <option value="false">Unverified</option>
        </select>

        <select className="admin-filter-select" value={disabled} onChange={(e) => setParam("disabled", e.target.value)}>
          <option value="">All statuses</option>
          <option value="false">Active only</option>
          <option value="true">Disabled only</option>
        </select>

        {isSuperAdmin && (
          <label className="admin-toggle-label">
            <input
              type="checkbox"
              className="admin-toggle-checkbox"
              checked={includePlatformAdmins}
              onChange={(e) => setParam("includePlatformAdmins", e.target.checked ? "true" : "")}
            />
            Include platform admins
          </label>
        )}

        {hasFilters && (
          <button className="admin-clear-filters" onClick={() => setSearchParams({})}>
            Clear filters
          </button>
        )}
      </div>

      {actionError && <div className="alert alert--error" style={{ marginBottom: 12 }}>{actionError}</div>}

      {loading ? (
        <div className="admin-loading"><div className="spinner" /></div>
      ) : error ? (
        <div className="alert alert--error">{error}</div>
      ) : users.length === 0 ? (
        <p className="admin-empty">No users found matching your filters.</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="admin-table-wrap admin-table-wrap--desktop">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name / Email</th>
                  <th>Workspace</th>
                  <th>Role</th>
                  <th>Plan</th>
                  <th>Sub</th>
                  <th>Verified</th>
                  <th>Status</th>
                  <th>Last Login</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className={user.isDisabled ? "admin-row--suspended" : ""}>
                    <td>
                      <Link to={`/admin/users/${user.id}`} className="admin-link" style={{ fontWeight: 600 }}>
                        {user.name}
                      </Link>
                      <div className="admin-muted" style={{ fontSize: 12 }}>{user.email}</div>
                      {user.platformRole !== "USER" && (
                        <span className="admin-platform-role-badge" style={{ marginTop: 2 }}>
                          {user.platformRole.replace(/_/g, " ")}
                        </span>
                      )}
                    </td>
                    <td>
                      {user.primaryWorkspace ? (
                        <>
                          <Link to={`/admin/workspaces/${user.primaryWorkspace.id}`} className="admin-link" style={{ fontSize: 12.5 }}>
                            {user.primaryWorkspace.name}
                          </Link>
                          {user.workspaceCount > 1 && (
                            <span className="admin-muted" style={{ fontSize: 11, marginLeft: 4 }}>
                              +{user.workspaceCount - 1} more
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="admin-muted">—</span>
                      )}
                    </td>
                    <td>
                      {user.primaryWorkspace ? (
                        <span className="admin-badge admin-badge--gray">{user.primaryWorkspace.role}</span>
                      ) : (
                        <span className="admin-muted">—</span>
                      )}
                    </td>
                    <td>
                      {user.primaryWorkspace ? (
                        <PlanBadge plan={user.primaryWorkspace.plan} />
                      ) : (
                        <span className="admin-muted">—</span>
                      )}
                    </td>
                    <td>
                      <SubStatusBadge status={user.primaryWorkspace?.subscriptionStatus ?? null} />
                    </td>
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
                    <td className="admin-muted">{formatDateShort(user.lastLoginAt)}</td>
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

          {/* Mobile cards */}
          <div className="admin-mobile-cards">
            {users.map((user) => (
              <div key={user.id} className={`admin-user-card${user.isDisabled ? " admin-user-card--disabled" : ""}`}>
                <div className="admin-user-card-top">
                  <div className="admin-user-card-avatar">{user.name.slice(0, 2).toUpperCase()}</div>
                  <div className="admin-user-card-info">
                    <Link to={`/admin/users/${user.id}`} className="admin-user-card-name">{user.name}</Link>
                    <div className="admin-user-card-email">{user.email}</div>
                  </div>
                  <div className="admin-user-card-badges">
                    {user.isDisabled
                      ? <span className="admin-status-badge admin-status-badge--suspended">Disabled</span>
                      : <span className="admin-status-badge admin-status-badge--active">Active</span>}
                  </div>
                </div>
                <div className="admin-user-card-row">
                  {user.primaryWorkspace ? (
                    <>
                      <span className="admin-user-card-ws">
                        <Link to={`/admin/workspaces/${user.primaryWorkspace.id}`} className="admin-link" style={{ fontSize: 12.5 }}>
                          {user.primaryWorkspace.name}
                        </Link>
                        {user.workspaceCount > 1 && <span className="admin-muted" style={{ fontSize: 11 }}> +{user.workspaceCount - 1}</span>}
                      </span>
                      <span className="admin-badge admin-badge--gray" style={{ fontSize: 11 }}>{user.primaryWorkspace.role}</span>
                      <PlanBadge plan={user.primaryWorkspace.plan} />
                    </>
                  ) : (
                    <span className="admin-muted">No workspace</span>
                  )}
                </div>
                <div className="admin-user-card-meta">
                  {user.emailVerified
                    ? <span className="admin-status-badge admin-status-badge--active" style={{ fontSize: 11 }}>Verified</span>
                    : <span className="admin-status-badge admin-status-badge--pending" style={{ fontSize: 11 }}>Unverified</span>}
                  <span className="admin-muted">Last login: {formatDateShort(user.lastLoginAt)}</span>
                  <span className="admin-muted">Joined {formatDate(user.createdAt)}</span>
                </div>
                <div className="admin-user-card-actions">
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
              </div>
            ))}
          </div>

          {/* Pagination */}
          <div className="admin-pagination">
            <button className="btn btn--ghost btn--sm" disabled={page <= 1} onClick={() => setParam("page", String(page - 1))}>
              ← Prev
            </button>
            <span className="admin-pagination-info">Page {page} of {pages} · {total.toLocaleString()} users</span>
            <button className="btn btn--ghost btn--sm" disabled={page >= pages} onClick={() => setParam("page", String(page + 1))}>
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
