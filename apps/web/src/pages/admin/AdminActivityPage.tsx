import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getAdminAuditLogs } from "../../api/admin";
import type { AdminAuditLog } from "../../types";

const ACTION_STYLES: Record<string, { bg: string; color: string; dot: string }> = {
  workspace_suspended:        { bg: "#fef2f2", color: "#dc2626", dot: "#ef4444" },
  workspace_reactivated:      { bg: "#f0fdf4", color: "#16a34a", dot: "#22c55e" },
  workspace_plan_changed:     { bg: "#eff6ff", color: "#2563eb", dot: "#3b82f6" },
  user_disabled:              { bg: "#fff7ed", color: "#ea580c", dot: "#f97316" },
  user_enabled:               { bg: "#f0fdf4", color: "#16a34a", dot: "#22c55e" },
  admin_resend_verification:  { bg: "#f0f9ff", color: "#0284c7", dot: "#38bdf8" },
  admin_force_password_reset: { bg: "#fdf4ff", color: "#9333ea", dot: "#c084fc" },
};
const DEFAULT_STYLE = { bg: "#f1f5f9", color: "#475569", dot: "#94a3b8" };

function getActionStyle(action: string) {
  return ACTION_STYLES[action] ?? DEFAULT_STYLE;
}

function formatActionLabel(action: string) {
  return action.replace(/_/g, " ");
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

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
        <button className="al-meta-more" onClick={() => setExpanded(true)}>
          +{hidden} more
        </button>
      )}
      {expanded && entries.length > PREVIEW_COUNT && (
        <button className="al-meta-more" onClick={() => setExpanded(false)}>
          Show less
        </button>
      )}
    </div>
  );
}

const ENTITY_BADGE_COLORS: Record<string, { bg: string; color: string }> = {
  user:      { bg: "#eff6ff", color: "#2563eb" },
  workspace: { bg: "#f5f3ff", color: "#7c3aed" },
};

function EntityCell({ entity, entityId }: { entity: string; entityId: string }) {
  const style = ENTITY_BADGE_COLORS[entity.toLowerCase()] ?? { bg: "#f1f5f9", color: "#475569" };
  return (
    <div className="al-entity">
      <span className="al-entity-badge" style={{ background: style.bg, color: style.color }}>
        {entity}
      </span>
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

const ACTION_OPTIONS = [
  "workspace_suspended",
  "workspace_reactivated",
  "workspace_plan_changed",
  "user_disabled",
  "user_enabled",
  "admin_resend_verification",
  "admin_force_password_reset",
];

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
        <div>
          <h1 className="admin-page-title">Platform Audit Logs</h1>
          <p className="admin-page-subtitle">
            {loading ? "Loading…" : `${total.toLocaleString()} admin action${total !== 1 ? "s" : ""} recorded`}
          </p>
        </div>
      </div>

      {/* Filter bar */}
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
            return (
              <button
                key={opt}
                className={`al-chip ${action === opt ? "al-chip--active" : ""}`}
                style={action === opt ? { background: s.bg, color: s.color, borderColor: s.color + "44" } : {}}
                onClick={() => setParam("action", opt)}
              >
                <span className="al-chip-dot" style={{ background: s.dot }} />
                {formatActionLabel(opt)}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="admin-loading"><div className="spinner" /></div>
      ) : error ? (
        <div className="alert alert--error">{error}</div>
      ) : logs.length === 0 ? (
        <div className="al-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5">
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="al-empty-text">No audit logs found{action ? ` for "${formatActionLabel(action)}"` : ""}.</p>
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
                      <span
                        className="al-action-badge"
                        style={{ background: style.bg, color: style.color }}
                      >
                        {formatActionLabel(log.action)}
                      </span>
                      <span className="al-item-time">{formatDate(log.createdAt)}</span>
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
            <button
              className="btn btn--ghost btn--sm"
              disabled={page <= 1}
              onClick={() => setParam("page", String(page - 1))}
            >
              ← Prev
            </button>
            <span className="admin-pagination-info">Page {page} of {pages}</span>
            <button
              className="btn btn--ghost btn--sm"
              disabled={page >= pages}
              onClick={() => setParam("page", String(page + 1))}
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
