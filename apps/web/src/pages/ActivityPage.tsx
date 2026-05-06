import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getAuditLogs } from "../api/auditLogs";
import type { AuditLog, AuditLogFilters } from "../types";

// ─── Action colour palette ────────────────────────────────────────────────────

const ACTION_STYLES: Record<string, { bg: string; color: string; dot: string }> = {
  CREATE_ITEM:           { bg: "#f0fdf4", color: "#16a34a", dot: "#22c55e" },
  UPDATE_ITEM:           { bg: "#fffbeb", color: "#b45309", dot: "#f59e0b" },
  DELETE_ITEM:           { bg: "#fef2f2", color: "#dc2626", dot: "#ef4444" },
  STOCK_IN:              { bg: "#eff6ff", color: "#2563eb", dot: "#3b82f6" },
  STOCK_OUT:             { bg: "#fff7ed", color: "#ea580c", dot: "#f97316" },
  WASTAGE:               { bg: "#fdf4ff", color: "#9333ea", dot: "#c084fc" },
  ADJUSTMENT:            { bg: "#f0f9ff", color: "#0284c7", dot: "#38bdf8" },
  TRANSFER:              { bg: "#f5f3ff", color: "#7c3aed", dot: "#a78bfa" },
  CREATE_PURCHASE:       { bg: "#ecfeff", color: "#0e7490", dot: "#22d3ee" },
  UPDATE_PURCHASE:       { bg: "#fffbeb", color: "#b45309", dot: "#f59e0b" },
  RECEIVE_PURCHASE:      { bg: "#f0fdf4", color: "#16a34a", dot: "#22c55e" },
  CREATE_SUPPLIER:       { bg: "#f0f9ff", color: "#0284c7", dot: "#38bdf8" },
  UPDATE_SUPPLIER:       { bg: "#fffbeb", color: "#b45309", dot: "#f59e0b" },
  CREATE_STOCK_COUNT:    { bg: "#fdf4ff", color: "#9333ea", dot: "#c084fc" },
  FINALIZE_STOCK_COUNT:  { bg: "#f0fdf4", color: "#16a34a", dot: "#22c55e" },
};
const DEFAULT_STYLE = { bg: "#f1f5f9", color: "#475569", dot: "#94a3b8" };

function getActionStyle(action: string) {
  return ACTION_STYLES[action] ?? DEFAULT_STYLE;
}

const ACTION_OPTIONS = [
  "CREATE_ITEM", "UPDATE_ITEM", "DELETE_ITEM",
  "STOCK_IN", "STOCK_OUT", "WASTAGE", "ADJUSTMENT", "TRANSFER",
  "CREATE_PURCHASE", "UPDATE_PURCHASE", "RECEIVE_PURCHASE",
  "CREATE_SUPPLIER", "UPDATE_SUPPLIER",
  "CREATE_STOCK_COUNT", "FINALIZE_STOCK_COUNT",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatActionLabel(action: string) {
  return action.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

function formatDateTimeFull(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium", timeStyle: "short",
  }).format(new Date(iso));
}

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetaViewer({ meta }: { meta: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  const entries = Object.entries(meta).filter(([, v]) => v !== null && v !== undefined);
  if (entries.length === 0) return null;

  const PREVIEW = 3;
  const visible = expanded ? entries : entries.slice(0, PREVIEW);
  const hidden = entries.length - PREVIEW;

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
      {expanded && entries.length > PREVIEW && (
        <button className="al-meta-more" onClick={() => setExpanded(false)}>Show less</button>
      )}
    </div>
  );
}

function LogItem({ log }: { log: AuditLog }) {
  const style = getActionStyle(log.action);
  const hasMeta = Object.keys(log.meta).length > 0;
  const desc = describeLog(log);

  return (
    <div className="al-item">
      <div className="al-item-indicator">
        <span className="al-item-dot" style={{ background: style.dot }} />
        <span className="al-item-line" />
      </div>
      <div className="al-item-card">
        <div className="al-item-row al-item-row--top">
          <span className="al-action-badge" style={{ background: style.bg, color: style.color }}>
            {formatActionLabel(log.action)}
          </span>
          <span className="al-item-time" title={formatDateTimeFull(log.createdAt)}>
            {formatDateTime(log.createdAt)}
          </span>
        </div>
        <div className="al-item-row al-item-row--middle">
          <div className="al-admin">
            <div className="al-admin-avatar">{getInitials(log.user.name)}</div>
            <div className="al-admin-info">
              <span className="al-admin-name">{log.user.name}</span>
              <span className="al-admin-email">{log.user.email}</span>
            </div>
          </div>
          {log.entity && (
            <>
              <span className="al-item-sep">·</span>
              <span className="act-entity-label">{log.entity}</span>
            </>
          )}
        </div>
        {desc && <p className="act-log-desc">{desc}</p>}
        {hasMeta && <MetaViewer meta={log.meta} />}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ActivityPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [pagination, setPagination] = useState<{ page: number; total: number; pages: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const action = searchParams.get("action") ?? "";
  const search = searchParams.get("search") ?? "";
  const fromDate = searchParams.get("fromDate") ?? "";
  const toDate = searchParams.get("toDate") ?? "";

  function setParam(k: string, v: string) {
    const next = new URLSearchParams(searchParams);
    if (v) next.set(k, v); else next.delete(k);
    if (k !== "page") next.delete("page");
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
    const filters: AuditLogFilters = {};
    if (action) filters.action = action;
    if (search) filters.search = search;
    if (fromDate) filters.fromDate = fromDate;
    if (toDate) filters.toDate = toDate;
    if (page > 1) filters.page = page;

    getAuditLogs(filters)
      .then((r) => { setLogs(r.logs); setPagination(r.pagination); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load activity"))
      .finally(() => setLoading(false));
  }, [page, action, search, fromDate, toDate]);

  const hasFilters = !!(action || search || fromDate || toDate);
  const uniqueActors = new Set(logs.map((l) => l.user.id)).size;

  return (
    <div className="activity-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Activity Log</h1>
          <p className="page-subtitle">Workspace audit events — who did what and when.</p>
        </div>
      </div>

      {/* Summary strip */}
      {!loading && !error && pagination && (
        <div className="ops-metric-strip">
          <div className="ops-metric">
            <span className="ops-metric-label">Total events</span>
            <strong className="ops-metric-value">{pagination.total.toLocaleString()}</strong>
          </div>
          <div className="ops-metric">
            <span className="ops-metric-label">On this page</span>
            <strong className="ops-metric-value">{logs.length}</strong>
          </div>
          <div className="ops-metric">
            <span className="ops-metric-label">Actors</span>
            <strong className="ops-metric-value">{uniqueActors}</strong>
          </div>
          {logs[0] && (
            <div className="ops-metric">
              <span className="ops-metric-label">Latest event</span>
              <strong className="ops-metric-value ops-metric-value--small">
                {formatDateTime(logs[0].createdAt)}
              </strong>
            </div>
          )}
        </div>
      )}

      {/* ── Filter bar ── */}
      <div className="act-filter-bar">
        {/* Search */}
        <div className="act-search-wrap">
          <svg className="act-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref={searchRef}
            className="act-search-input"
            placeholder="Search by actor name or email…"
            defaultValue={search}
            onChange={(e) => handleSearchInput(e.target.value)}
          />
        </div>

        {/* Date range */}
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
      <div className="al-toolbar" style={{ marginBottom: 0 }}>
        <div className="al-action-chips">
          <button
            className={`al-chip ${!action ? "al-chip--active" : ""}`}
            onClick={() => setParam("action", "")}
          >
            All actions
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
        <div className="page-loading">
          <div className="spinner" />
          <p>Loading activity…</p>
        </div>
      ) : error ? (
        <div className="alert alert--error">{error}</div>
      ) : logs.length === 0 ? (
        <div className="al-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="al-empty-text">No activity found{hasFilters ? " for these filters" : ""}.</p>
          {hasFilters && <button className="btn btn--secondary btn--sm" style={{ marginTop: 8 }} onClick={clearFilters}>Clear filters</button>}
        </div>
      ) : (
        <>
          <div className="al-feed" style={{ marginTop: 8 }}>
            {logs.map((log) => <LogItem key={log.id} log={log} />)}
          </div>

          {pagination && pagination.pages > 1 && (
            <div className="admin-pagination">
              <button
                className="btn btn--ghost btn--sm"
                disabled={page <= 1}
                onClick={() => setParam("page", String(page - 1))}
              >
                ← Prev
              </button>
              <span className="admin-pagination-info">
                Page {page} of {pagination.pages} · {pagination.total.toLocaleString()} total
              </span>
              <button
                className="btn btn--ghost btn--sm"
                disabled={page >= pagination.pages}
                onClick={() => setParam("page", String(page + 1))}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Log descriptions ─────────────────────────────────────────────────────────

function describeLog(log: AuditLog): string | null {
  const meta = log.meta;
  const itemName = str(meta.itemName);
  const unit = str(meta.unit);
  const qty = num(meta.quantity);

  switch (log.action) {
    case "TRANSFER":
      return `Transferred ${fmtQty(qty)}${unit ? " " + unit : ""} of ${itemName} from ${str(meta.fromLocationName, "source")} to ${str(meta.toLocationName, "destination")}`;
    case "STOCK_IN":
      return `Added ${fmtQty(qty)}${unit ? " " + unit : ""} of ${itemName}`;
    case "STOCK_OUT":
      return `Deducted ${fmtQty(qty)}${unit ? " " + unit : ""} of ${itemName}`;
    case "WASTAGE":
      return `Recorded ${fmtQty(qty)}${unit ? " " + unit : ""} wastage of ${itemName}`;
    case "ADJUSTMENT":
      return `Adjusted stock for ${itemName}`;
    case "CREATE_ITEM":
      return `Created item "${itemName}"`;
    case "UPDATE_ITEM":
      return `Updated item "${itemName}"`;
    case "DELETE_ITEM":
      return `Deleted item "${itemName}"`;
    case "CREATE_PURCHASE":
      return `Created purchase from ${str(meta.supplierName, "supplier")}`;
    case "UPDATE_PURCHASE":
      return `Updated purchase order`;
    case "RECEIVE_PURCHASE":
      return `Received purchase from ${str(meta.supplierName, "supplier")}`;
    case "CREATE_SUPPLIER":
      return `Created supplier "${str(meta.supplierName)}"`;
    case "UPDATE_SUPPLIER":
      return `Updated supplier "${str(meta.supplierName)}"`;
    case "CREATE_STOCK_COUNT":
      return `Started a stock count`;
    case "FINALIZE_STOCK_COUNT":
      return `Finalized stock count`;
    default:
      return null;
  }
}

function str(val: unknown, fallback = "unknown"): string {
  return typeof val === "string" && val.trim() ? val.trim() : fallback;
}

function num(val: unknown): number {
  return typeof val === "number" && Number.isFinite(val) ? val : 0;
}

function fmtQty(n: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
}
