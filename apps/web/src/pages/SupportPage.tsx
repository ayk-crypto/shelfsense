import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getMyTickets, createSupportTicket } from "../api/support";
import type { SupportTicket, TicketStatus } from "../types";

const STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: "Open",
  PENDING: "Pending",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};
const STATUS_CLASS: Record<TicketStatus, string> = {
  OPEN: "sp-status--open",
  PENDING: "sp-status--pending",
  RESOLVED: "sp-status--resolved",
  CLOSED: "sp-status--closed",
};

function fmtTime(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString();
}

export function SupportPage() {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");

  const [showNew, setShowNew] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getMyTickets({ page, limit: 10, status: statusFilter || undefined })
      .then((r) => {
        setTickets(r.tickets);
        setTotal(r.total);
        setPages(r.pages);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load tickets"))
      .finally(() => setLoading(false));
  }, [page, statusFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [statusFilter]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await createSupportTicket({ subject: subject.trim(), message: message.trim() });
      setShowNew(false);
      setSubject("");
      setMessage("");
      navigate(`/support/${r.ticket.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to submit ticket");
    } finally {
      setSubmitting(false);
    }
  }

  function closeModal() {
    if (submitting) return;
    setShowNew(false);
    setSubject("");
    setMessage("");
    setSubmitError(null);
  }

  return (
    <div className="sp-page">
      <div className="sp-header">
        <div className="sp-header-text">
          <h1 className="sp-title">Support</h1>
          <p className="sp-subtitle">
            {total > 0
              ? `${total} ticket${total !== 1 ? "s" : ""} · we typically respond within a few hours`
              : "Submit a ticket and our team will get back to you"}
          </p>
        </div>
        <button className="btn btn--primary" onClick={() => setShowNew(true)}>
          New Ticket
        </button>
      </div>

      {total > 0 && (
        <div className="sp-filters">
          <select
            className="field-input sp-filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="OPEN">Open</option>
            <option value="PENDING">Pending</option>
            <option value="RESOLVED">Resolved</option>
            <option value="CLOSED">Closed</option>
          </select>
        </div>
      )}

      {loading ? (
        <div className="sp-loading"><div className="spinner" /></div>
      ) : error ? (
        <div className="alert alert--error">{error}</div>
      ) : tickets.length === 0 ? (
        <div className="sp-empty">
          <div className="sp-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <p className="sp-empty-title">No tickets yet</p>
          <p className="sp-empty-body">Have a question or issue? Open a ticket and we'll help you out.</p>
          <button className="btn btn--primary" onClick={() => setShowNew(true)}>
            Open a ticket
          </button>
        </div>
      ) : (
        <>
          <div className="sp-ticket-list">
            {tickets.map((t) => (
              <div
                key={t.id}
                className="sp-ticket-card"
                onClick={() => navigate(`/support/${t.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && navigate(`/support/${t.id}`)}
              >
                <div className="sp-ticket-card-main">
                  <div className="sp-ticket-card-top">
                    <span className="sp-ticket-num">#{t.ticketNumber}</span>
                    <span className={`sp-status ${STATUS_CLASS[t.status]}`}>
                      {STATUS_LABEL[t.status]}
                    </span>
                  </div>
                  <p className="sp-ticket-subject">{t.subject}</p>
                </div>
                <div className="sp-ticket-card-meta">
                  {t._count && t._count.messages > 0 && (
                    <span className="sp-ticket-msg-count">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                      {t._count.messages}
                    </span>
                  )}
                  <span className="sp-ticket-time">{fmtTime(t.lastMessageAt)}</span>
                  <svg className="sp-ticket-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </div>
            ))}
          </div>

          {pages > 1 && (
            <div className="sp-pagination">
              <button className="btn btn--secondary btn--sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Prev
              </button>
              <span className="sp-pagination-info">Page {page} of {pages}</span>
              <button className="btn btn--secondary btn--sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          )}
        </>
      )}

      {showNew && (
        <div className="sp-modal-overlay" onClick={closeModal}>
          <div className="sp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sp-modal-header">
              <h2 className="sp-modal-title">New Support Ticket</h2>
              <button className="sp-modal-close" onClick={closeModal} aria-label="Close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <form className="sp-modal-form" onSubmit={handleSubmit}>
              <div className="sp-field">
                <label className="sp-label" htmlFor="sp-subject">Subject</label>
                <input
                  id="sp-subject"
                  className="field-input"
                  type="text"
                  placeholder="Brief description of your issue"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  required
                  autoFocus
                  disabled={submitting}
                />
              </div>
              <div className="sp-field">
                <label className="sp-label" htmlFor="sp-message">Message</label>
                <textarea
                  id="sp-message"
                  className="field-input sp-textarea"
                  placeholder="Describe your issue in detail…"
                  rows={5}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                  disabled={submitting}
                />
              </div>
              {submitError && (
                <div className="alert alert--error">{submitError}</div>
              )}
              <div className="sp-modal-actions">
                <button type="button" className="btn btn--secondary" onClick={closeModal} disabled={submitting}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={submitting || !subject.trim() || !message.trim()}
                >
                  {submitting ? <span className="btn-spinner" /> : "Submit Ticket"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
