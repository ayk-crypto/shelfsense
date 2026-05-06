import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getSupportTickets } from "../../api/admin";
import type { SupportTicket, TicketStatus, TicketPriority, TicketCategory } from "../../types";
import { TICKET_CATEGORIES } from "../../types";

const STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: "Open", PENDING: "Pending", RESOLVED: "Resolved", CLOSED: "Closed",
};
const STATUS_CLASS: Record<TicketStatus, string> = {
  OPEN: "ticket-status--open", PENDING: "ticket-status--pending",
  RESOLVED: "ticket-status--resolved", CLOSED: "ticket-status--closed",
};
const PRIORITY_LABELS: Record<TicketPriority, string> = {
  LOW: "Low", NORMAL: "Normal", HIGH: "High", URGENT: "Urgent",
};
const PRIORITY_CLASS: Record<TicketPriority, string> = {
  LOW: "ticket-priority--low", NORMAL: "ticket-priority--normal",
  HIGH: "ticket-priority--high", URGENT: "ticket-priority--urgent",
};
const CATEGORY_CLASS: Record<TicketCategory, string> = {
  billing:   "tc-cat--billing",
  technical: "tc-cat--technical",
  account:   "tc-cat--account",
  feature:   "tc-cat--feature",
  general:   "tc-cat--general",
};

function fmtTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString();
}

export function AdminInboxPage() {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

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

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, statusFilter, priorityFilter, categoryFilter]);

  const hasFilters = search || statusFilter || priorityFilter || categoryFilter;

  function clearFilters() {
    setSearch(""); setStatusFilter(""); setPriorityFilter(""); setCategoryFilter("");
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Support Inbox</h1>
          <p className="admin-page-subtitle">
            Manage inbound support requests from workspace users · {total} ticket{total !== 1 ? "s" : ""} total
          </p>
        </div>
        <button className="btn btn--secondary btn--sm" onClick={load}>Refresh</button>
      </div>

      <div className="inbox-filters">
        <input
          className="field-input inbox-search"
          placeholder="Search tickets, email, subject…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="field-input inbox-filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="PENDING">Pending</option>
          <option value="RESOLVED">Resolved</option>
          <option value="CLOSED">Closed</option>
        </select>
        <select className="field-input inbox-filter-select" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
          <option value="">All priorities</option>
          <option value="URGENT">Urgent</option>
          <option value="HIGH">High</option>
          <option value="NORMAL">Normal</option>
          <option value="LOW">Low</option>
        </select>
        <select className="field-input inbox-filter-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">All categories</option>
          {TICKET_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        {hasFilters && (
          <button className="btn btn--ghost btn--sm" onClick={clearFilters}>Clear</button>
        )}
      </div>

      {/* Category quick-filter pills */}
      <div className="inbox-cat-pills">
        <button
          className={`inbox-cat-pill ${!categoryFilter ? "inbox-cat-pill--active" : ""}`}
          onClick={() => setCategoryFilter("")}
        >
          All
        </button>
        {TICKET_CATEGORIES.map((c) => (
          <button
            key={c.value}
            className={`inbox-cat-pill inbox-cat-pill--${c.value} ${categoryFilter === c.value ? "inbox-cat-pill--active" : ""}`}
            onClick={() => setCategoryFilter(categoryFilter === c.value ? "" : c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="admin-loading"><div className="spinner" /></div>
      ) : error ? (
        <div className="alert alert--error">{error}</div>
      ) : tickets.length === 0 ? (
        <div className="inbox-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2z"/>
            <polyline points="22,6 12,13 2,6"/>
          </svg>
          <p>No tickets found</p>
          {hasFilters && (
            <button className="btn btn--secondary btn--sm" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table inbox-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Subject</th>
                  <th>Category</th>
                  <th>Requester</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Assigned</th>
                  <th>Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr
                    key={t.id}
                    className="inbox-row"
                    onClick={() => navigate(`/admin/inbox/${t.id}`)}
                  >
                    <td className="inbox-num">#{t.ticketNumber}</td>
                    <td className="inbox-subject">
                      <span className="inbox-subject-text">{t.subject}</span>
                      {t._count && t._count.messages > 0 && (
                        <span className="inbox-msg-count">{t._count.messages}</span>
                      )}
                    </td>
                    <td>
                      {t.category ? (
                        <span className={`tc-cat-badge ${CATEGORY_CLASS[t.category]}`}>
                          {TICKET_CATEGORIES.find((c) => c.value === t.category)?.label ?? t.category}
                        </span>
                      ) : (
                        <span className="inbox-unassigned">—</span>
                      )}
                    </td>
                    <td className="inbox-requester">
                      <div className="inbox-requester-email">{t.requesterEmail}</div>
                      {t.workspace && <div className="inbox-requester-ws">{t.workspace.name}</div>}
                    </td>
                    <td><span className={`ticket-status ${STATUS_CLASS[t.status]}`}>{STATUS_LABELS[t.status]}</span></td>
                    <td><span className={`ticket-priority ${PRIORITY_CLASS[t.priority]}`}>{PRIORITY_LABELS[t.priority]}</span></td>
                    <td className="inbox-assignee">
                      {t.assignedTo ? (
                        <span className="inbox-assignee-name">{t.assignedTo.name}</span>
                      ) : (
                        <span className="inbox-unassigned">—</span>
                      )}
                    </td>
                    <td className="inbox-time">{fmtTime(t.lastMessageAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className="admin-pagination">
              <button className="btn btn--secondary btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
              <span className="admin-pagination-info">Page {page} of {pages}</span>
              <button className="btn btn--secondary btn--sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
