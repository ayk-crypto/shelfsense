import { useEffect, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getSupportTicket,
  replySupportTicket,
  updateTicketStatus,
  updateTicketPriority,
  updateTicketCategory,
  addTicketNote,
  assignTicket,
  getAdminUsers,
} from "../../api/admin";
import type { SupportTicketDetail, SupportMessage, SupportInternalNote, TicketStatus, TicketPriority } from "../../types";
import { TICKET_CATEGORIES } from "../../types";

const STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: "Open", PENDING: "Pending", RESOLVED: "Resolved", CLOSED: "Closed",
};
const STATUS_CLASS: Record<TicketStatus, string> = {
  OPEN: "ticket-status--open", PENDING: "ticket-status--pending",
  RESOLVED: "ticket-status--resolved", CLOSED: "ticket-status--closed",
};
const PRIORITY_CLASS: Record<TicketPriority, string> = {
  LOW: "ticket-priority--low", NORMAL: "ticket-priority--normal",
  HIGH: "ticket-priority--high", URGENT: "ticket-priority--urgent",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

type AdminUserMin = { id: string; name: string; email: string };

export function AdminTicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const threadRef = useRef<HTMLDivElement>(null);

  const [ticket, setTicket] = useState<SupportTicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUserMin[]>([]);

  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const [noteText, setNoteText] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [showNoteBox, setShowNoteBox] = useState(false);

  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  function showToast(type: "success" | "error", text: string) {
    setToast({ type, text });
    setTimeout(() => setToast(null), 3500);
  }

  function loadTicket() {
    if (!id) return;
    setLoading(true);
    getSupportTicket(id)
      .then((r) => { setTicket(r.ticket); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load ticket"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadTicket();
    getAdminUsers({ limit: 100 })
      .then((r) => setAdminUsers(r.users.map((u) => ({ id: u.id, name: u.name, email: u.email }))))
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    if (ticket && threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [ticket?.messages.length]);

  async function handleReply() {
    if (!id || !replyText.trim()) return;
    setReplying(true);
    setReplyError(null);
    try {
      await replySupportTicket(id, { bodyText: replyText.trim() });
      setReplyText("");
      showToast("success", "Reply sent.");
      loadTicket();
    } catch (e) {
      setReplyError(e instanceof Error ? e.message : "Failed to send reply");
    } finally {
      setReplying(false);
    }
  }

  async function handleStatusChange(status: string) {
    if (!id || !ticket) return;
    setActionLoading(true);
    try {
      const r = await updateTicketStatus(id, status);
      setTicket((prev) => prev ? { ...prev, ...r.ticket } : prev);
      showToast("success", `Status set to ${STATUS_LABELS[status as TicketStatus]}.`);
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function handlePriorityChange(priority: string) {
    if (!id) return;
    setActionLoading(true);
    try {
      const r = await updateTicketPriority(id, priority);
      setTicket((prev) => prev ? { ...prev, ...r.ticket } : prev);
      showToast("success", "Priority updated.");
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleAssign(assignedToUserId: string) {
    if (!id) return;
    setActionLoading(true);
    try {
      const val = assignedToUserId === "" ? null : assignedToUserId;
      const r = await assignTicket(id, val);
      setTicket((prev) => prev ? { ...prev, ...r.ticket } : prev);
      showToast("success", val ? "Ticket assigned." : "Assignment removed.");
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleAddNote() {
    if (!id || !noteText.trim()) return;
    setAddingNote(true);
    try {
      await addTicketNote(id, noteText.trim());
      setNoteText("");
      setShowNoteBox(false);
      showToast("success", "Note added.");
      loadTicket();
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Failed");
    } finally {
      setAddingNote(false);
    }
  }

  if (loading) return <div className="admin-loading"><div className="spinner" /></div>;
  if (error || !ticket) return (
    <div className="admin-page">
      <button className="btn btn--secondary btn--sm" onClick={() => navigate("/admin/inbox")}>← Back</button>
      <div className="alert alert--error" style={{ marginTop: 16 }}>{error ?? "Ticket not found"}</div>
    </div>
  );

  const allThread: Array<{ type: "message"; data: SupportMessage } | { type: "note"; data: SupportInternalNote }> = [
    ...ticket.messages.map((m) => ({ type: "message" as const, data: m })),
    ...ticket.notes.map((n) => ({ type: "note" as const, data: n })),
  ].sort((a, b) => new Date(a.data.createdAt).getTime() - new Date(b.data.createdAt).getTime());

  return (
    <div className="admin-page ticket-detail-page">
      {toast && (
        <div className={`alert alert--${toast.type === "success" ? "success" : "error"} ticket-toast`}>
          {toast.text}
        </div>
      )}

      <div className="ticket-detail-header">
        <button className="btn btn--secondary btn--sm" onClick={() => navigate("/admin/inbox")}>← Inbox</button>
        <div className="ticket-detail-title-block">
          <span className="ticket-detail-num">#{ticket.ticketNumber}</span>
          <h1 className="ticket-detail-subject">{ticket.subject}</h1>
        </div>
        <div className="ticket-detail-badges">
          <span className={`ticket-status ${STATUS_CLASS[ticket.status]}`}>{STATUS_LABELS[ticket.status]}</span>
          <span className={`ticket-priority ${PRIORITY_CLASS[ticket.priority]}`}>{ticket.priority}</span>
        </div>
      </div>

      <div className="ticket-detail-body">
        {/* ── Thread + Reply ── */}
        <div className="ticket-thread-col">
          <div className="ticket-thread" ref={threadRef}>
            {allThread.length === 0 && (
              <p className="ticket-thread-empty">No messages yet.</p>
            )}
            {allThread.map((item) => {
              if (item.type === "note") {
                const n = item.data;
                return (
                  <div key={`note-${n.id}`} className="thread-note">
                    <div className="thread-note-header">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      <span>Internal note — {n.createdBy.name}</span>
                      <span className="thread-time">{fmtDate(n.createdAt)}</span>
                    </div>
                    <p className="thread-note-body">{n.note}</p>
                  </div>
                );
              }
              const m = item.data;
              const isOutbound = m.direction === "OUTBOUND";
              const isInternal = m.direction === "INTERNAL";
              return (
                <div key={`msg-${m.id}`} className={`thread-message thread-message--${isOutbound ? "outbound" : isInternal ? "internal" : "inbound"}`}>
                  <div className="thread-message-meta">
                    <div className="thread-avatar">
                      {(m.senderName ?? m.senderEmail)[0].toUpperCase()}
                    </div>
                    <div className="thread-meta-text">
                      <span className="thread-sender">{m.senderName ?? m.senderEmail}</span>
                      <span className="thread-email">{m.senderEmail}</span>
                    </div>
                    <span className="thread-time">{fmtDate(m.createdAt)}</span>
                    <span className="thread-dir-badge">{m.direction}</span>
                  </div>
                  <div className="thread-message-body">
                    {m.bodyHtml ? (
                      <div className="thread-html-body" dangerouslySetInnerHTML={{ __html: m.bodyHtml }} />
                    ) : (
                      <p className="thread-text-body">{m.bodyText}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Internal note box ── */}
          {showNoteBox && (
            <div className="ticket-note-box">
              <div className="ticket-note-box-header">
                <span>Add internal note</span>
                <button className="ticket-note-close" onClick={() => { setShowNoteBox(false); setNoteText(""); }}>×</button>
              </div>
              <textarea
                className="field-input ticket-note-textarea"
                placeholder="Visible to admins only…"
                rows={3}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
              />
              <div className="ticket-note-actions">
                <button className="btn btn--secondary btn--sm" onClick={() => { setShowNoteBox(false); setNoteText(""); }}>Cancel</button>
                <button className="btn btn--primary btn--sm" disabled={addingNote || !noteText.trim()} onClick={handleAddNote}>
                  {addingNote ? <span className="btn-spinner" /> : "Add Note"}
                </button>
              </div>
            </div>
          )}

          {/* ── Reply composer ── */}
          <div className="ticket-reply-box">
            <div className="ticket-reply-header">
              <span>Reply to {ticket.requesterEmail}</span>
              {!showNoteBox && (
                <button className="btn btn--secondary btn--sm" onClick={() => setShowNoteBox(true)}>
                  + Internal Note
                </button>
              )}
            </div>
            {replyError && <div className="alert alert--error" style={{ marginBottom: 8 }}>{replyError}</div>}
            <textarea
              className="field-input ticket-reply-textarea"
              placeholder="Type your reply…"
              rows={4}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleReply();
              }}
            />
            <div className="ticket-reply-actions">
              <span className="ticket-reply-hint">⌘↵ to send</span>
              <button
                className="btn btn--primary"
                disabled={replying || !replyText.trim()}
                onClick={handleReply}
              >
                {replying ? <span className="btn-spinner" /> : "Send Reply"}
              </button>
            </div>
          </div>
        </div>

        {/* ── Info sidebar ── */}
        <aside className="ticket-sidebar">
          <div className="ticket-sidebar-section">
            <h3 className="ticket-sidebar-title">Status</h3>
            <select
              className="field-input"
              value={ticket.status}
              disabled={actionLoading}
              onChange={(e) => handleStatusChange(e.target.value)}
            >
              <option value="OPEN">Open</option>
              <option value="PENDING">Pending</option>
              <option value="RESOLVED">Resolved</option>
              <option value="CLOSED">Closed</option>
            </select>
          </div>

          <div className="ticket-sidebar-section">
            <h3 className="ticket-sidebar-title">Priority</h3>
            <select
              className="field-input"
              value={ticket.priority}
              disabled={actionLoading}
              onChange={(e) => handlePriorityChange(e.target.value)}
            >
              <option value="LOW">Low</option>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </div>

          <div className="ticket-sidebar-section">
            <h3 className="ticket-sidebar-title">Category</h3>
            <select
              className="field-input"
              value={ticket.category ?? ""}
              disabled={actionLoading}
              onChange={async (e) => {
                if (!id) return;
                setActionLoading(true);
                try {
                  const r = await updateTicketCategory(id, e.target.value || null);
                  setTicket((prev) => prev ? { ...prev, ...r.ticket } : prev);
                  showToast("success", "Category updated.");
                } catch {
                  showToast("error", "Failed to update category.");
                } finally {
                  setActionLoading(false);
                }
              }}
            >
              <option value="">— No category —</option>
              {TICKET_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          <div className="ticket-sidebar-section">
            <h3 className="ticket-sidebar-title">Assigned To</h3>
            <select
              className="field-input"
              value={ticket.assignedToUserId ?? ""}
              disabled={actionLoading}
              onChange={(e) => handleAssign(e.target.value)}
            >
              <option value="">Unassigned</option>
              {adminUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

          <div className="ticket-sidebar-section">
            <h3 className="ticket-sidebar-title">Requester</h3>
            <div className="ticket-sidebar-info">
              <div className="ticket-sidebar-info-row">
                <span className="ticket-sidebar-label">Email</span>
                <span className="ticket-sidebar-val">{ticket.requesterEmail}</span>
              </div>
              {ticket.requesterName && (
                <div className="ticket-sidebar-info-row">
                  <span className="ticket-sidebar-label">Name</span>
                  <span className="ticket-sidebar-val">{ticket.requesterName}</span>
                </div>
              )}
              {ticket.user && (
                <div className="ticket-sidebar-info-row">
                  <span className="ticket-sidebar-label">Account</span>
                  <span className="ticket-sidebar-val">{ticket.user.name}</span>
                </div>
              )}
            </div>
          </div>

          {ticket.workspace && (
            <div className="ticket-sidebar-section">
              <h3 className="ticket-sidebar-title">Workspace</h3>
              <div className="ticket-sidebar-info">
                <div className="ticket-sidebar-info-row">
                  <span className="ticket-sidebar-label">Name</span>
                  <a
                    className="ticket-sidebar-link"
                    onClick={() => navigate(`/admin/workspaces/${ticket.workspaceId}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && navigate(`/admin/workspaces/${ticket.workspaceId}`)}
                  >
                    {ticket.workspace.name}
                  </a>
                </div>
              </div>
            </div>
          )}

          <div className="ticket-sidebar-section">
            <h3 className="ticket-sidebar-title">Details</h3>
            <div className="ticket-sidebar-info">
              <div className="ticket-sidebar-info-row">
                <span className="ticket-sidebar-label">Source</span>
                <span className="ticket-sidebar-val">{ticket.source}</span>
              </div>
              <div className="ticket-sidebar-info-row">
                <span className="ticket-sidebar-label">Created</span>
                <span className="ticket-sidebar-val">{fmtDate(ticket.createdAt)}</span>
              </div>
              {ticket.resolvedAt && (
                <div className="ticket-sidebar-info-row">
                  <span className="ticket-sidebar-label">Resolved</span>
                  <span className="ticket-sidebar-val">{fmtDate(ticket.resolvedAt)}</span>
                </div>
              )}
              {ticket.closedAt && (
                <div className="ticket-sidebar-info-row">
                  <span className="ticket-sidebar-label">Closed</span>
                  <span className="ticket-sidebar-val">{fmtDate(ticket.closedAt)}</span>
                </div>
              )}
            </div>
          </div>

          <div className="ticket-sidebar-section">
            <h3 className="ticket-sidebar-title">Activity ({ticket.events.length})</h3>
            <div className="ticket-events">
              {ticket.events.slice().reverse().slice(0, 10).map((ev) => (
                <div key={ev.id} className="ticket-event">
                  <span className="ticket-event-type">{ev.eventType.replace(/_/g, " ")}</span>
                  {ev.actor && <span className="ticket-event-actor">by {ev.actor.name}</span>}
                  <span className="ticket-event-time">{fmtDate(ev.createdAt)}</span>
                </div>
              ))}
              {ticket.events.length === 0 && <p className="ticket-event-empty">No activity yet.</p>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
