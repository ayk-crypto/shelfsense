import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getAdminAuditLogs } from "../../api/admin";
import type { AdminAuditLog } from "../../types";

// ─── Colour palette ───────────────────────────────────────────────────────────

const ACTION_STYLES: Record<string, { bg: string; color: string; dot: string }> = {
  workspace_suspended:         { bg: "#fef2f2", color: "#dc2626", dot: "#ef4444" },
  workspace_reactivated:       { bg: "#f0fdf4", color: "#16a34a", dot: "#22c55e" },
  workspace_plan_changed:      { bg: "#eff6ff", color: "#2563eb", dot: "#3b82f6" },
  workspace_status_changed:    { bg: "#fffbeb", color: "#b45309", dot: "#f59e0b" },
  user_disabled:               { bg: "#fff7ed", color: "#ea580c", dot: "#f97316" },
  user_enabled:                { bg: "#f0fdf4", color: "#16a34a", dot: "#22c55e" },
  admin_resend_verification:   { bg: "#f0f9ff", color: "#0284c7", dot: "#38bdf8" },
  admin_force_password_reset:  { bg: "#fdf4ff", color: "#9333ea", dot: "#c084fc" },
  plan_created:                { bg: "#f0fdf4", color: "#16a34a", dot: "#22c55e" },
  plan_updated:                { bg: "#fffbeb", color: "#b45309", dot: "#f59e0b" },
  plan_activated:              { bg: "#f0fdf4", color: "#16a34a", dot: "#22c55e" },
  plan_archived:               { bg: "#f1f5f9", color: "#475569", dot: "#94a3b8" },
  subscription_created:        { bg: "#ecfeff", color: "#0e7490", dot: "#22d3ee" },
  subscription_updated:        { bg: "#fffbeb", color: "#b45309", dot: "#f59e0b" },
  subscription_activated:      { bg: "#f0fdf4", color: "#16a34a", dot: "#22c55e" },
  payment_recorded:            { bg: "#eff6ff", color: "#2563eb", dot: "#3b82f6" },
  payment_updated:             { bg: "#fffbeb", color: "#b45309", dot: "#f59e0b" },
  payment_marked_paid:         { bg: "#f0fdf4", color: "#16a34a", dot: "#22c55e" },
};
const DEFAULT_STYLE = { bg: "#f1f5f9", color: "#475569", dot: "#94a3b8" };

function getActionStyle(action: string) {
  return ACTION_STYLES[action] ?? DEFAULT_STYLE;
}

const ACTION_OPTIONS = Object.keys(ACTION_STYLES);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatActionLabel(action: string) { return action.replace(/_/g, " "); }

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function formatDateFull(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium", timeStyle: "short",
  });
}

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetaViewer({ meta }: { meta: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  const entries = Object.entries(meta).filter(([, v]) => v !== null && v !== undefined);
  if (entries.length === 0) return null;

  const PREVIEW_COUNT = 4;
  const visible = expanded ? entries : entries.slice(0, PREVIEW_COUNT);
  const hidden = entries.length - PREVIEW_COUNT;

  return (
    <div className="al-meta">
      {visible.map(([k, v]) => {
        const val = typeof v === "object" ? JSON.stringify(v) : String(v);
        return (
          <div key={k} className="al-meta-pill">
            <span className="al-meta-key">{k}</span>
            <span className="al-meta-sep">·</span>
            <span className="al-meta-val" title={val}>{val.length > 40 ? val.slice(0, 40) + "…" : val}</span>
          </div>
        );
      })}
      {!expanded && hidden > 0 && (
        <button className="al-meta-more" onClick={() => setExpanded(true)}>+{hidden} more</button>
      )}
      {expanded && entries.length > PREVIEW_COUNT && (
        <button className="al-meta-more" onClick={() => setExpanded(false)}>Show less</button>
      )}
    </div>
  );
}

function EntityCell({ entity, entityId }: { entity: string; entityId: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    user:         { bg: "#eff6ff", color: "#2563eb" },
    workspace:    { bg: "#f5f3ff", color: "#7c3aed" },
    plan:         { bg: "#f0fdf4", color: "#16a34a" },
    subscription: { bg: "#ecfeff", color: "#0e7490" },
    payment:      { bg: "#fffbeb", color: "#b45309" },
  };
  const style = colors[entity.toLowerCase()] ?? { bg: "#f1f5f9", color: "#475569" };
  return (
    <div className="al-entity">
      <span className="al-entity-badge" style={{ background: style.bg, color: style.color }}>{entity}</span>
      <code className="al-entity-id" title={entityId}>{entityId.slice(0, 8)}…</code>
    </div>
  );
}

function AdminAvatar({ admin }: { admin: { name: string; email: string } }) {
  return (
    <div className="al-admin">
      <div className="al-admin-avatar">{getInitials(admin.name)}</div>
      <div className="al-admin-info">
        <span className="al-admin-name">{admin.name}</span>
        <span className="al-admin-email">{admin.email}</span>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function AdminActivityPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [logs, setLogs] = useState<AdminAuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const page     = parseInt(searchParams.get("page") ?? "1", 10);
  const action   = searchParams.get("action") ?? "";
  const search   = searchParams.get("search") ?? "";
  const fromDate = searchParams.get("fromDate") ?? "";
  const toDate   = searchParams.get("toDate") ?? "";

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "page") next.delete("page");
    setSearchParams(next, { replace: true });
  }

  function handleSearchInput(val: string) {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => setParam("search", val), 300);
  }

  function clearFilters() {
    setSearchParams({}, { replace: true });
    if (searchRef.current) searchRef.current.value = "";
  }

  useEffect(() => {
    setLoading(true);
    getAdminAuditLogs({
      page,
      action: action || undefined,
      search: search || undefined,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
    })
      .then((res) => {
        setLogs(res.logs);
        setTotal(res.pagination.total);
        setPages(res.pagination.pages);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load audit logs"))
      .finally(() => setLoading(false));
  }, [page, action, search, fromDate, toDate]);

  const hasFilters = !!(action || search || fromDate || toDate);

  return (
    <div className="admin-page">
      {/* Header */}
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Platform Audit Logs</h1>
          <p className="admin-page-subtitle">
            {loading ? "Loading…" : `${total.toLocaleString()} admin action${total !== 1 ? "s" : ""} recorded`}
          </p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="act-filter-bar">
        <div className="act-search-wrap">
          <svg className="act-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref={searchRef}
            className="act-search-input"
            placeholder="Search admin name or email…"
            defaultValue={search}
            onChange={(e) => handleSearchInput(e.target.value)}
          />
        </div>

        <div className="act-date-range">
          <input
            type="date"
            className="act-date-input"
            value={fromDate}
            onChange={(e) => setParam("fromDate", e.target.value)}
            title="From date"
          />
          <span className="act-date-sep">→</span>
          <input
            type="date"
            className="act-date-input"
            value={toDate}
            onChange={(e) => setParam("toDate", e.target.value)}
            title="To date"
          />
        </div>

        {hasFilters && (
          <button className="act-clear-btn" onClick={clearFilters} type="button">
            Clear all
          </button>
        )}
      </div>

      {/* Action chips */}
      <div className="al-toolbar">
        <div className="al-action-chips">
          <button
            className={`al-chip ${!action ? "al-chip--active" : ""}`}
            onClick={() => setParam("action", "")}
          >
            All
          </button>
          {ACTION_OPTIONS.map((opt) => {
            const s = getActionStyle(opt);
            const isActive = action === opt;
            return (
              <button
                key={opt}
                className={`al-chip ${isActive ? "al-chip--active" : ""}`}
                style={isActive ? { background: s.bg, color: s.color, borderColor: s.color + "44" } : {}}
                onClick={() => setParam("action", isActive ? "" : opt)}
              >
                <span className="al-chip-dot" style={{ background: s.dot }} />
                {formatActionLabel(opt)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="admin-loading"><div className="spinner" /></div>
      ) : error ? (
        <div className="alert alert--error">{error}</div>
      ) : logs.length === 0 ? (
        <div className="al-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="al-empty-text">No audit logs found{action ? ` for "${formatActionLabel(action)}"` : ""}.</p>
          {hasFilters && <button className="btn btn--secondary btn--sm" style={{ marginTop: 8 }} onClick={clearFilters}>Clear filters</button>}
        </div>
      ) : (
        <>
          <div className="al-feed">
            {logs.map((log) => {
              const style = getActionStyle(log.action);
              const hasMeta = Object.keys(log.meta).length > 0;
              return (
                <div key={log.id} className="al-item">
                  <div className="al-item-indicator">
                    <span className="al-item-dot" style={{ background: style.dot }} />
                    <span className="al-item-line" />
                  </div>
                  <div className="al-item-card">
                    <div className="al-item-row al-item-row--top">
                      <span className="al-action-badge" style={{ background: style.bg, color: style.color }}>
                        {formatActionLabel(log.action)}
                      </span>
                      <span className="al-item-time" title={formatDateFull(log.createdAt)}>
                        {formatDate(log.createdAt)}
                      </span>
                    </div>
                    <div className="al-item-row al-item-row--middle">
                      <EntityCell entity={log.entity} entityId={log.entityId} />
                      <span className="al-item-sep">by</span>
                      <AdminAvatar admin={log.admin} />
                    </div>
                    {hasMeta && <MetaViewer meta={log.meta} />}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="admin-pagination">
            <button className="btn btn--ghost btn--sm" disabled={page <= 1} onClick={() => setParam("page", String(page - 1))}>
              ← Prev
            </button>
            <span className="admin-pagination-info">Page {page} of {pages} · {total.toLocaleString()} total</span>
            <button className="btn btn--ghost btn--sm" disabled={page >= pages} onClick={() => setParam("page", String(page + 1))}>
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
