import { useEffect, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getMyTicket, replyToTicket } from "../api/support";
import type { SupportTicket, SupportMessage, TicketStatus } from "../types";

interface TicketWithMessages extends SupportTicket {
  messages: SupportMessage[];
}

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

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SupportTicketPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const threadRef = useRef<HTMLDivElement>(null);

  const [ticket, setTicket] = useState<TicketWithMessages | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function load() {
    if (!id) return;
    setLoading(true);
    getMyTicket(id)
      .then((r) => { setTicket(r.ticket); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load ticket"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    if (ticket && threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [ticket?.messages.length]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !replyText.trim()) return;
    setReplying(true);
    setReplyError(null);
    try {
      await replyToTicket(id, replyText.trim());
      setReplyText("");
      showToast("Reply sent.");
      load();
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setReplying(false);
    }
  }

  const isClosed = ticket?.status === "CLOSED" || ticket?.status === "RESOLVED";

  if (loading) {
    return (
      <div className="sp-page">
        <div className="sp-loading"><div className="spinner" /></div>
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="sp-page">
        <button className="btn btn--secondary btn--sm sp-back-btn" onClick={() => navigate("/support")}>
          ← Back to Support
        </button>
        <div className="alert alert--error" style={{ marginTop: 16 }}>{error ?? "Ticket not found"}</div>
      </div>
    );
  }

  return (
    <div className="sp-page">
      {toast && <div className="sp-toast">{toast}</div>}

      <div className="sp-thread-header">
        <button className="btn btn--secondary btn--sm sp-back-btn" onClick={() => navigate("/support")}>
          ← Support
        </button>
        <div className="sp-thread-title-block">
          <span className="sp-ticket-num">#{ticket.ticketNumber}</span>
          <h1 className="sp-thread-title">{ticket.subject}</h1>
          <span className={`sp-status ${STATUS_CLASS[ticket.status]}`}>
            {STATUS_LABEL[ticket.status]}
          </span>
        </div>
      </div>

      <div className="sp-thread-layout">
        <div className="sp-thread-col">
          <div className="sp-thread" ref={threadRef}>
            {ticket.messages.length === 0 && (
              <p className="sp-thread-empty">No messages yet.</p>
            )}
            {ticket.messages.map((m) => {
              const isSupport = m.direction === "OUTBOUND";
              return (
                <div
                  key={m.id}
                  className={`sp-msg ${isSupport ? "sp-msg--support" : "sp-msg--customer"}`}
                >
                  <div className="sp-msg-header">
                    <div className="sp-msg-avatar">
                      {isSupport ? "S" : (m.senderName ?? m.senderEmail)[0].toUpperCase()}
                    </div>
                    <div className="sp-msg-meta">
                      <span className="sp-msg-sender">
                        {isSupport ? "ShelfSense Support" : (m.senderName ?? "You")}
                      </span>
                      <span className="sp-msg-time">{fmtDate(m.createdAt)}</span>
                    </div>
                  </div>
                  <div className="sp-msg-body">
                    {m.bodyHtml ? (
                      <div dangerouslySetInnerHTML={{ __html: m.bodyHtml }} />
                    ) : (
                      <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{m.bodyText}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {isClosed ? (
            <div className="sp-closed-notice">
              This ticket is {STATUS_LABEL[ticket.status].toLowerCase()}. If you need further help,{" "}
              <button className="sp-reopen-link" onClick={() => navigate("/support?new=1")}>
                open a new ticket
              </button>.
            </div>
          ) : (
            <form className="sp-reply-box" onSubmit={handleReply}>
              <textarea
                className="field-input sp-reply-textarea"
                placeholder="Write your reply…"
                rows={4}
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                disabled={replying}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleReply(e as unknown as React.FormEvent);
                }}
              />
              {replyError && <div className="alert alert--error" style={{ marginBottom: 8 }}>{replyError}</div>}
              <div className="sp-reply-actions">
                <span className="sp-reply-hint">⌘↵ to send</span>
                <button
                  type="submit"
                  className="btn btn--primary"
                  disabled={replying || !replyText.trim()}
                >
                  {replying ? <span className="btn-spinner" /> : "Send Reply"}
                </button>
              </div>
            </form>
          )}
        </div>

        <aside className="sp-ticket-sidebar">
          <div className="sp-sidebar-section">
            <h3 className="sp-sidebar-title">Status</h3>
            <span className={`sp-status ${STATUS_CLASS[ticket.status]}`}>
              {STATUS_LABEL[ticket.status]}
            </span>
          </div>
          <div className="sp-sidebar-section">
            <h3 className="sp-sidebar-title">Ticket</h3>
            <div className="sp-sidebar-row">
              <span className="sp-sidebar-label">Number</span>
              <span className="sp-sidebar-val">#{ticket.ticketNumber}</span>
            </div>
            <div className="sp-sidebar-row">
              <span className="sp-sidebar-label">Opened</span>
              <span className="sp-sidebar-val">{fmtDate(ticket.createdAt)}</span>
            </div>
            {ticket.resolvedAt && (
              <div className="sp-sidebar-row">
                <span className="sp-sidebar-label">Resolved</span>
                <span className="sp-sidebar-val">{fmtDate(ticket.resolvedAt)}</span>
              </div>
            )}
          </div>
          {ticket.assignedTo && (
            <div className="sp-sidebar-section">
              <h3 className="sp-sidebar-title">Handled by</h3>
              <div className="sp-sidebar-agent">
                <div className="sp-sidebar-agent-avatar">
                  {ticket.assignedTo.name[0].toUpperCase()}
                </div>
                <span>{ticket.assignedTo.name}</span>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
