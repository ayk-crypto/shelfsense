import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getSupportTickets, getAdminNotificationsSummary } from "../../api/admin";
import type {
  SupportTicket, TicketStatus, TicketPriority, TicketCategory,
  AdminNotificationSummary,
} from "../../types";
import { TICKET_CATEGORIES } from "../../types";

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_META: Record<TicketStatus, { label: string; cls: string; icon: string }> = {
  OPEN:     { label: "Open",     cls: "ticket-status--open",     icon: "🔵" },
  PENDING:  { label: "Pending",  cls: "ticket-status--pending",  icon: "🟡" },
  RESOLVED: { label: "Resolved", cls: "ticket-status--resolved", icon: "🟢" },
  CLOSED:   { label: "Closed",   cls: "ticket-status--closed",   icon: "⚪" },
};

const PRIORITY_META: Record<TicketPriority, { label: string; cls: string }> = {
  LOW:    { label: "Low",    cls: "ticket-priority--low" },
  NORMAL: { label: "Normal", cls: "ticket-priority--normal" },
  HIGH:   { label: "High",   cls: "ticket-priority--high" },
  URGENT: { label: "Urgent", cls: "ticket-priority--urgent" },
};

const CATEGORY_CLASS: Record<TicketCategory, string> = {
  billing:   "tc-cat--billing",
  technical: "tc-cat--technical",
  account:   "tc-cat--account",
  feature:   "tc-cat--feature",
  general:   "tc-cat--general",
};

function fmtTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000)     return "just now";
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function initials(email: string, name?: string | null) {
  if (name) return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

function avatarColor(str: string) {
  const colors = [
    "#6366f1","#8b5cf6","#ec4899","#f59e0b","#10b981","#3b82f6","#f97316","#14b8a6",
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label, count, icon, accent, active, onClick, loading,
}: {
  label: string; count: number; icon: React.ReactNode;
  accent: string; active: boolean; onClick: () => void; loading: boolean;
}) {
  return (
    <button
      className={`inbox-stat-card${active ? " inbox-stat-card--active" : ""}`}
      style={{ "--accent": accent } as React.CSSProperties}
      onClick={onClick}
      type="button"
    >
      <div className="inbox-stat-icon">{icon}</div>
      <div className="inbox-stat-body">
        {loading
          ? <div className="inbox-stat-skeleton" />
          : <div className="inbox-stat-count">{count.toLocaleString()}</div>
        }
        <div className="inbox-stat-label">{label}</div>
      </div>
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function AdminInboxPage() {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<AdminNotificationSummary | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TicketStatus | "">("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  const loadStats = useCallback(() => {
    setStatsLoading(true);
    getAdminNotificationsSummary()
      .then(setStats)
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    getSupportTickets({
      page,
      limit: 25,
      search: search || undefined,
      status: statusFilter || undefined,
      priority: priorityFilter || undefined,
      category: categoryFilter || undefined,
    })
      .then((r) => { setTickets(r.tickets); setTotal(r.total); setPages(r.pages); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load tickets"))
      .finally(() => setLoading(false));
  }, [page, search, statusFilter, priorityFilter, categoryFilter]);

  useEffect(() => { load(); loadStats(); }, [load, loadStats]);
  useEffect(() => { setPage(1); }, [search, statusFilter, priorityFilter, categoryFilter]);

  function handleRefresh() { load(); loadStats(); }

  const hasFilters = search || statusFilter || priorityFilter || categoryFilter;
  function clearFilters() {
    setSearch(""); setStatusFilter(""); setPriorityFilter(""); setCategoryFilter("");
  }

  function setStatCard(status: TicketStatus | "") {
    setStatusFilter((prev) => prev === status ? "" : status);
  }

  const statCards = [
    {
      label: "Open",
      count: stats?.openCount ?? 0,
      status: "OPEN" as TicketStatus,
      accent: "#3b82f6",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8 19.79 19.79 0 01.1 1.2 2 2 0 012.11 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.09a16 16 0 006 6l.46-.46a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92z" />
        </svg>
      ),
    },
    {
      label: "Pending",
      count: stats?.pendingCount ?? 0,
      status: "PENDING" as TicketStatus,
      accent: "#f59e0b",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      ),
    },
    {
      label: "Urgent",
      count: stats?.urgentCount ?? 0,
      status: "" as "",
      accent: "#ef4444",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      ),
    },
    {
      label: "Resolved",
      count: stats?.resolvedCount ?? 0,
      status: "RESOLVED" as TicketStatus,
      accent: "#10b981",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      ),
    },
  ];

  return (
    <div className="admin-page">
      {/* Header */}
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Support Inbox</h1>
          <p className="admin-page-subtitle">
            Manage inbound support requests from workspace users
            {!loading && <span className="inbox-total-badge">{total.toLocaleString()} ticket{total !== 1 ? "s" : ""}</span>}
          </p>
        </div>
        <button className="inbox-refresh-btn" onClick={handleRefresh} title="Refresh" type="button">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Stat cards */}
      <div className="inbox-stats">
        {statCards.map((s) => (
          <StatCard
            key={s.label}
            label={s.label}
            count={s.count}
            icon={s.icon}
            accent={s.accent}
            active={s.status !== "" && statusFilter === s.status}
            onClick={() => s.status !== "" ? setStatCard(s.status) : undefined}
            loading={statsLoading}
          />
        ))}
      </div>

      {/* Status tabs */}
      <div className="inbox-status-tabs">
        {([
          { value: "" as TicketStatus | "", label: "All tickets" },
          { value: "OPEN" as TicketStatus, label: "Open" },
          { value: "PENDING" as TicketStatus, label: "Pending" },
          { value: "RESOLVED" as TicketStatus, label: "Resolved" },
          { value: "CLOSED" as TicketStatus, label: "Closed" },
        ] as { value: TicketStatus | ""; label: string }[]).map((tab) => (
          <button
            key={tab.value}
            type="button"
            className={`inbox-status-tab${statusFilter === tab.value ? " inbox-status-tab--active" : ""}`}
            onClick={() => setStatusFilter(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filter row */}
      <div className="inbox-filter-row">
        <div className="inbox-search-wrap">
          <svg className="inbox-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="inbox-search-input"
            placeholder="Search subject, email, workspace…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="inbox-search-clear" onClick={() => setSearch("")} type="button">✕</button>
          )}
        </div>

        <select
          className="inbox-select"
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
        >
          <option value="">All priorities</option>
          <option value="URGENT">🔴 Urgent</option>
          <option value="HIGH">🟠 High</option>
          <option value="NORMAL">🔵 Normal</option>
          <option value="LOW">⚪ Low</option>
        </select>

        <select
          className="inbox-select"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">All categories</option>
          {TICKET_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>

        {hasFilters && (
          <button className="admin-clear-filters" onClick={clearFilters} type="button">
            Clear filters
          </button>
        )}
      </div>

      {/* Category pills */}
      <div className="inbox-cat-pills">
        <button
          className={`inbox-cat-pill${!categoryFilter ? " inbox-cat-pill--active" : ""}`}
          onClick={() => setCategoryFilter("")}
          type="button"
        >
          All
        </button>
        {TICKET_CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            className={`inbox-cat-pill inbox-cat-pill--${c.value}${categoryFilter === c.value ? " inbox-cat-pill--active" : ""}`}
            onClick={() => setCategoryFilter(categoryFilter === c.value ? "" : c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="inbox-skeleton-list">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="inbox-skeleton-row">
              <div className="inbox-skeleton-cell" style={{ width: 48 }} />
              <div className="inbox-skeleton-cell" style={{ flex: 2 }} />
              <div className="inbox-skeleton-cell" style={{ width: 90 }} />
              <div className="inbox-skeleton-cell" style={{ width: 140 }} />
              <div className="inbox-skeleton-cell" style={{ width: 72 }} />
              <div className="inbox-skeleton-cell" style={{ width: 72 }} />
              <div className="inbox-skeleton-cell" style={{ width: 80 }} />
              <div className="inbox-skeleton-cell" style={{ width: 70 }} />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="alert alert--error">{error}</div>
      ) : tickets.length === 0 ? (
        <div className="inbox-empty">
          <div className="inbox-empty-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8 19.79 19.79 0 01.1 1.2 2 2 0 012.11 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.09a16 16 0 006 6l.46-.46a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92z" />
            </svg>
          </div>
          <p className="inbox-empty-title">No tickets found</p>
          <p className="inbox-empty-sub">
            {hasFilters ? "Try adjusting your filters." : "No support requests yet."}
          </p>
          {hasFilters && (
            <button className="btn btn--secondary btn--sm" onClick={clearFilters}>Clear filters</button>
          )}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="inbox-table-wrap">
            <table className="admin-table inbox-table">
              <thead>
                <tr>
                  <th style={{ width: 56 }}>#</th>
                  <th>Subject</th>
                  <th style={{ width: 140 }}>Category</th>
                  <th style={{ width: 180 }}>Requester</th>
                  <th style={{ width: 100 }}>Status</th>
                  <th style={{ width: 90 }}>Priority</th>
                  <th style={{ width: 130 }}>Assigned</th>
                  <th style={{ width: 100 }}>Activity</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => {
                  const isUrgent = t.priority === "URGENT";
                  const isHigh   = t.priority === "HIGH";
                  const priMeta  = PRIORITY_META[t.priority];
                  const statMeta = STATUS_META[t.status];
                  const reqInitials = initials(t.requesterEmail, t.requesterName);
                  const avatarBg = avatarColor(t.requesterEmail);

                  return (
                    <tr
                      key={t.id}
                      className={`inbox-row${isUrgent ? " inbox-row--urgent" : isHigh ? " inbox-row--high" : ""}`}
                      onClick={() => navigate(`/admin/inbox/${t.id}`)}
                    >
                      <td>
                        <span className="inbox-num">#{t.ticketNumber}</span>
                      </td>
                      <td className="inbox-subject-cell">
                        {(isUrgent || isHigh) && (
                          <span className={`inbox-urgency-dot inbox-urgency-dot--${t.priority.toLowerCase()}`} />
                        )}
                        <div>
                          <span className="inbox-subject-text">{t.subject}</span>
                          {t._count && t._count.messages > 0 && (
                            <span className="inbox-msg-count">{t._count.messages}</span>
                          )}
                        </div>
                      </td>
                      <td>
                        {t.category ? (
                          <span className={`tc-cat-badge ${CATEGORY_CLASS[t.category]}`}>
                            {TICKET_CATEGORIES.find((c) => c.value === t.category)?.label ?? t.category}
                          </span>
                        ) : (
                          <span className="inbox-dash">—</span>
                        )}
                      </td>
                      <td>
                        <div className="inbox-requester-cell">
                          <div className="inbox-avatar" style={{ background: avatarBg }}>
                            {reqInitials}
                          </div>
                          <div className="inbox-requester-text">
                            <div className="inbox-requester-email">{t.requesterEmail}</div>
                            {t.workspace && (
                              <div className="inbox-requester-ws">{t.workspace.name}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`ticket-status ${statMeta.cls}`}>
                          {statMeta.label}
                        </span>
                      </td>
                      <td>
                        <span className={`ticket-priority ${priMeta.cls}`}>
                          {priMeta.label}
                        </span>
                      </td>
                      <td>
                        {t.assignedTo ? (
                          <div className="inbox-assignee-cell">
                            <div
                              className="inbox-avatar inbox-avatar--sm"
                              style={{ background: avatarColor(t.assignedTo.email) }}
                            >
                              {initials(t.assignedTo.email, t.assignedTo.name)}
                            </div>
                            <span className="inbox-assignee-name">{t.assignedTo.name}</span>
                          </div>
                        ) : (
                          <span className="inbox-unassigned-chip">Unassigned</span>
                        )}
                      </td>
                      <td className="inbox-time">{fmtTime(t.lastMessageAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="inbox-mobile-cards">
            {tickets.map((t) => {
              const isUrgent = t.priority === "URGENT";
              const isHigh   = t.priority === "HIGH";
              const priMeta  = PRIORITY_META[t.priority];
              const statMeta = STATUS_META[t.status];
              const avatarBg = avatarColor(t.requesterEmail);

              return (
                <div
                  key={t.id}
                  className={`inbox-mobile-card${isUrgent ? " inbox-mobile-card--urgent" : isHigh ? " inbox-mobile-card--high" : ""}`}
                  onClick={() => navigate(`/admin/inbox/${t.id}`)}
                >
                  <div className="inbox-mobile-card-top">
                    <span className="inbox-num">#{t.ticketNumber}</span>
                    <div className="inbox-mobile-card-badges">
                      <span className={`ticket-status ${statMeta.cls}`}>{statMeta.label}</span>
                      <span className={`ticket-priority ${priMeta.cls}`}>{priMeta.label}</span>
                    </div>
                    <span className="inbox-time">{fmtTime(t.lastMessageAt)}</span>
                  </div>
                  <div className="inbox-subject-text" style={{ marginBottom: 8 }}>{t.subject}</div>
                  <div className="inbox-mobile-card-bottom">
                    <div className="inbox-requester-cell">
                      <div className="inbox-avatar inbox-avatar--sm" style={{ background: avatarBg }}>
                        {initials(t.requesterEmail, t.requesterName)}
                      </div>
                      <div>
                        <div className="inbox-requester-email">{t.requesterEmail}</div>
                        {t.workspace && <div className="inbox-requester-ws">{t.workspace.name}</div>}
                      </div>
                    </div>
                    {t.category && (
                      <span className={`tc-cat-badge ${CATEGORY_CLASS[t.category]}`}>
                        {TICKET_CATEGORIES.find((c) => c.value === t.category)?.label ?? t.category}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {pages > 1 && (
            <div className="admin-pagination">
              <button className="btn btn--ghost btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
              <span className="admin-pagination-info">Page {page} of {pages} · {total.toLocaleString()} total</span>
              <button className="btn btn--ghost btn--sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
