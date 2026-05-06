import { useEffect, useState, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getAdminWorkspaces, getAdminWorkspacesStats, updateWorkspaceStatus } from "../../api/admin";
import type { AdminWorkspace, AdminWorkspacesStats } from "../../types";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function HealthBadge({ health }: { health?: string }) {
  if (!health) return <span className="admin-muted">—</span>;
  const colorMap: Record<string, string> = {
    "Healthy": "active",
    "Suspended": "suspended",
    "Payment Due": "red",
    "Trial Ending Soon": "yellow",
    "Setup Incomplete": "yellow",
    "Inactive": "gray",
  };
  const color = colorMap[health] ?? "gray";
  return <span className={`admin-status-badge admin-status-badge--${color}`}>{health}</span>;
}

function SubStatusBadge({ status }: { status?: string | null }) {
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

export function AdminWorkspacesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [stats, setStats] = useState<AdminWorkspacesStats | null>(null);
  const [workspaces, setWorkspaces] = useState<AdminWorkspace[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const search = searchParams.get("search") ?? "";
  const status = searchParams.get("status") ?? "";
  const plan = searchParams.get("plan") ?? "";

  useEffect(() => {
    setStatsLoading(true);
    getAdminWorkspacesStats()
      .then((r) => setStats(r.stats))
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, []);

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

  function toggleParam(key: string, value: string, current: string) {
    setParam(key, current === value ? "" : value);
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

  const hasFilters = !!(search || status || plan);

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Workspaces</h1>
          <p className="admin-page-subtitle">{loading ? "Loading…" : `${total.toLocaleString()} total workspaces`}</p>
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
            <StatCard label="Total" value={stats.total} color="blue" />
            <StatCard label="Active" value={stats.active} color="green"
              active={status === "active"}
              onClick={() => toggleParam("status", "active", status)} />
            <StatCard label="Suspended" value={stats.suspended} color="red"
              active={status === "suspended"}
              onClick={() => toggleParam("status", "suspended", status)} />
            <StatCard label="Free Plan" value={stats.free} color="gray"
              active={plan === "FREE"}
              onClick={() => toggleParam("plan", "FREE", plan)} />
            <StatCard label="Paid Plan" value={stats.paid} color="teal"
              active={plan === "BASIC" || plan === "PRO"} />
            <StatCard label="Pending Payment" value={stats.pendingPayment} color="yellow" />
          </>
        ) : null}
      </div>

      {/* Filters */}
      <div className="admin-filters">
        <form className="admin-search-form" onSubmit={(e) => { e.preventDefault(); setParam("search", searchInputRef.current?.value ?? ""); }}>
          <input
            ref={searchInputRef}
            type="search"
            className="admin-search-input"
            placeholder="Search name, owner email…"
            defaultValue={search}
          />
          <button type="submit" className="btn btn--primary btn--sm">Search</button>
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
      ) : workspaces.length === 0 ? (
        <p className="admin-empty">No workspaces found.</p>
      ) : (
        <>
          {/* Desktop table */}
          <div className="admin-table-wrap admin-table-wrap--desktop">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Workspace</th>
                  <th>Owner</th>
                  <th>Plan</th>
                  <th>Sub Status</th>
                  <th>Health</th>
                  <th>Users</th>
                  <th>Items</th>
                  <th>Locs</th>
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
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{ws.owner.name}</div>
                      <div className="admin-muted">{ws.owner.email}</div>
                    </td>
                    <td><span className={`admin-plan-badge admin-plan-badge--${ws.plan.toLowerCase()}`}>{ws.plan}</span></td>
                    <td>
                      <SubStatusBadge status={(ws as AdminWorkspace & { subscriptionStatus?: string }).subscriptionStatus} />
                    </td>
                    <td><HealthBadge health={(ws as AdminWorkspace & { health?: string }).health} /></td>
                    <td>{ws.memberCount}</td>
                    <td>{ws.itemCount}</td>
                    <td>{(ws as AdminWorkspace & { locationCount?: number }).locationCount ?? "—"}</td>
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

          {/* Mobile cards */}
          <div className="admin-mobile-cards">
            {workspaces.map((ws) => (
              <div key={ws.id} className={`admin-ws-card${ws.suspended ? " admin-ws-card--suspended" : ""}`}>
                <div className="admin-ws-card-top">
                  <div className="admin-ws-card-avatar">{ws.name.slice(0, 2).toUpperCase()}</div>
                  <div className="admin-ws-card-info">
                    <Link to={`/admin/workspaces/${ws.id}`} className="admin-ws-card-name">{ws.name}</Link>
                    <div className="admin-ws-card-owner">{ws.owner.name} · {ws.owner.email}</div>
                  </div>
                  <div className="admin-ws-card-badges">
                    <span className={`admin-plan-badge admin-plan-badge--${ws.plan.toLowerCase()}`}>{ws.plan}</span>
                  </div>
                </div>
                <div className="admin-ws-card-stats">
                  <span>{ws.memberCount} members</span>
                  <span>{ws.itemCount} items</span>
                  {(ws as AdminWorkspace & { locationCount?: number }).locationCount != null && (
                    <span>{(ws as AdminWorkspace & { locationCount?: number }).locationCount} locs</span>
                  )}
                </div>
                <div className="admin-ws-card-meta">
                  <HealthBadge health={(ws as AdminWorkspace & { health?: string }).health} />
                  <SubStatusBadge status={(ws as AdminWorkspace & { subscriptionStatus?: string }).subscriptionStatus} />
                  <span className="admin-muted">{formatDate(ws.createdAt)}</span>
                </div>
                <div className="admin-ws-card-actions">
                  <Link to={`/admin/workspaces/${ws.id}`} className="admin-action-btn">View</Link>
                  <button
                    className={`admin-action-btn admin-action-btn--${ws.suspended ? "success" : "danger"}`}
                    disabled={actionLoading === ws.id}
                    onClick={() => handleToggleSuspend(ws)}
                  >
                    {actionLoading === ws.id ? "…" : ws.suspended ? "Reactivate" : "Suspend"}
                  </button>
                </div>
              </div>
            ))}
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
