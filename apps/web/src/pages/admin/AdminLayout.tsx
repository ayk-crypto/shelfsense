import { useState, useEffect, useRef } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { getAdminNotificationsSummary } from "../../api/admin";
import type { AdminNotificationSummary, TicketPriority, TicketStatus } from "../../types";

type NavItemProps = {
  to: string;
  end?: boolean;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  onClick?: () => void;
};

function NavItem({ to, end, icon, label, badge, onClick }: NavItemProps) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) => `admin-nav-item ${isActive ? "admin-nav-item--active" : ""}`}
    >
      <span className="admin-nav-icon">{icon}</span>
      {label}
      {badge != null && badge > 0 && (
        <span className="admin-nav-badge">{badge > 99 ? "99+" : badge}</span>
      )}
    </NavLink>
  );
}

const PRIORITY_CLASS: Record<TicketPriority, string> = {
  LOW: "ticket-priority--low", NORMAL: "ticket-priority--normal",
  HIGH: "ticket-priority--high", URGENT: "ticket-priority--urgent",
};
const STATUS_CLASS: Record<TicketStatus, string> = {
  OPEN: "ticket-status--open", PENDING: "ticket-status--pending",
  RESOLVED: "ticket-status--resolved", CLOSED: "ticket-status--closed",
};

function fmtTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

const icons = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  workspaces: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  plans: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  coupons: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  ),
  subscriptions: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    </svg>
  ),
  payments: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  ),
  emailTemplates: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  emailLogs: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  announcements: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  ),
  activity: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3v18h18" />
      <path d="M7 14l4-4 3 3 5-6" />
    </svg>
  ),
  team: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      <polyline points="12 14 14 16 18 12" />
    </svg>
  ),
  system: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.4 1.07V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-.4-1.07 1.65 1.65 0 0 0-1-.6 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1.07-.4H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.07-.4 1.65 1.65 0 0 0 .6-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .4-1.07V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 .4 1.07 1.65 1.65 0 0 0 1 .6 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 .6 1 1.65 1.65 0 0 0 1.07.4H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.07.4z" />
    </svg>
  ),
  inbox: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  ),
  back: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 12H5M12 5l-7 7 7 7" />
    </svg>
  ),
  menu: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  bell: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
};

export function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [summary, setSummary] = useState<AdminNotificationSummary | null>(null);
  const notifPanelRef = useRef<HTMLDivElement>(null);
  const notifBtnRef = useRef<HTMLButtonElement>(null);
  const notifRef = notifPanelRef; // kept for backwards compat in JSX below

  useEffect(() => {
    setSidebarOpen(false);
    setNotifOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [sidebarOpen]);

  useEffect(() => {
    function fetchSummary() {
      getAdminNotificationsSummary()
        .then(setSummary)
        .catch(() => {});
    }
    fetchSummary();
    const interval = setInterval(fetchSummary, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      const outsidePanel = !notifPanelRef.current?.contains(target);
      const outsideBtn = !notifBtnRef.current?.contains(target);
      if (outsidePanel && outsideBtn) setNotifOpen(false);
    }
    if (notifOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [notifOpen]);

  function handleLogout() {
    logout();
    navigate("/login");
  }

  const close = () => setSidebarOpen(false);
  const navProps = { onClick: close };
  const openCount = summary?.totalActive ?? 0;
  const urgentCount = summary?.urgentCount ?? 0;

  return (
    <div className="admin-shell">
      {/* Mobile top bar */}
      <div className="admin-mobile-topbar">
        <button className="admin-hamburger" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
          {icons.menu}
        </button>
        <div className="admin-mobile-brand">
          <span className="admin-brand-mark" style={{ width: 26, height: 26, fontSize: 13, borderRadius: 6 }}>S</span>
          <span className="admin-mobile-brand-name">ShelfSense Admin</span>
        </div>
        {/* Mobile notification bell */}
        <div className="admin-notif-wrap" style={{ position: "relative" }}>
          <button
            className={`admin-notif-btn ${notifOpen ? "admin-notif-btn--open" : ""}`}
            onClick={() => setNotifOpen((v) => !v)}
            aria-label="Notifications"
          >
            {icons.bell}
            {openCount > 0 && (
              <span className={`admin-notif-dot ${urgentCount > 0 ? "admin-notif-dot--urgent" : ""}`}>
                {openCount > 9 ? "9+" : openCount}
              </span>
            )}
          </button>
          {notifOpen && (
            <div ref={notifPanelRef} style={{ position: "fixed", top: 56, right: 8, left: 8, zIndex: 999 }}>
              <NotifPanel summary={summary} onNavigate={(id) => { navigate(id ? `/admin/inbox/${id}` : "/admin/inbox"); setNotifOpen(false); }} />
            </div>
          )}
        </div>
      </div>

      {/* Overlay backdrop */}
      {sidebarOpen && <div className="admin-sidebar-backdrop" onClick={close} />}

      <aside className={`admin-sidebar${sidebarOpen ? " admin-sidebar--open" : ""}`}>
        <div className="admin-sidebar-header">
          <div className="admin-brand">
            <span className="admin-brand-mark">S</span>
            <div className="admin-brand-text">
              <span className="admin-brand-name">ShelfSense</span>
              <span className="admin-brand-label">Platform Admin</span>
            </div>
            <button className="admin-sidebar-close-btn" onClick={close} aria-label="Close menu">
              {icons.close}
            </button>
          </div>
        </div>

        <nav className="admin-nav">
          <NavItem to="/admin" end icon={icons.dashboard} label="Overview" {...navProps} />

          <p className="admin-nav-section">Tenants</p>
          <NavItem to="/admin/workspaces" icon={icons.workspaces} label="Workspaces" {...navProps} />
          <NavItem to="/admin/users" icon={icons.users} label="Users" {...navProps} />

          <p className="admin-nav-section">Billing</p>
          <NavItem to="/admin/plans" icon={icons.plans} label="Plans" {...navProps} />
          <NavItem to="/admin/coupons" icon={icons.coupons} label="Coupons" {...navProps} />
          <NavItem to="/admin/subscriptions" icon={icons.subscriptions} label="Subscriptions" {...navProps} />
          <NavItem to="/admin/payments" icon={icons.payments} label="Payments" {...navProps} />

          <p className="admin-nav-section">Communications</p>
          <NavItem to="/admin/inbox" icon={icons.inbox} label="Support Inbox" badge={openCount} {...navProps} />
          <NavItem to="/admin/email-templates" icon={icons.emailTemplates} label="Email Templates" {...navProps} />
          <NavItem to="/admin/email-logs" icon={icons.emailLogs} label="Email Logs" {...navProps} />
          <NavItem to="/admin/announcements" icon={icons.announcements} label="Announcements" {...navProps} />

          <p className="admin-nav-section">System</p>
          <NavItem to="/admin/team" icon={icons.team} label="Admin Team" {...navProps} />
          <NavItem to="/admin/activity" icon={icons.activity} label="Audit Logs" {...navProps} />
          <NavItem to="/admin/system" icon={icons.system} label="System Health" {...navProps} />

          {user?.workspaceId && (
            <>
              <p className="admin-nav-section">Account</p>
              <NavLink to="/dashboard" onClick={close} className="admin-nav-item admin-nav-item--switch-ws">
                <span className="admin-nav-icon">{icons.back}</span>
                Switch to Workspace
              </NavLink>
            </>
          )}
        </nav>

        <div className="admin-sidebar-footer">
          <div className="admin-user-info">
            <div className="admin-user-avatar">{user?.name?.[0]?.toUpperCase() ?? "A"}</div>
            <div className="admin-user-details">
              <span className="admin-user-name">{user?.name}</span>
              <span className="admin-user-role">
                {user?.platformRole === "SUPER_ADMIN"
                  ? "Super Admin"
                  : user?.platformRole === "SUPPORT_ADMIN"
                  ? "Support Admin"
                  : "Admin"}
              </span>
            </div>
          </div>
          <div className="admin-footer-actions">
            {/* Desktop notification bell */}
            <div className="admin-notif-wrap" style={{ position: "relative" }}>
              <button
                ref={notifBtnRef}
                className={`admin-footer-link admin-notif-btn ${notifOpen ? "admin-notif-btn--open" : ""}`}
                onClick={() => setNotifOpen((v) => !v)}
                aria-label="Notifications"
                title="Support notifications"
              >
                {icons.bell}
                {openCount > 0 && (
                  <span className={`admin-notif-dot ${urgentCount > 0 ? "admin-notif-dot--urgent" : ""}`}>
                    {openCount > 9 ? "9+" : openCount}
                  </span>
                )}
              </button>
            </div>
            <button className="admin-footer-link" onClick={handleLogout} title="Sign out">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {/* Notification panel — desktop, anchored to bottom of sidebar */}
      {notifOpen && (
        <div className="admin-notif-panel-desktop" ref={notifPanelRef}>
          <NotifPanel summary={summary} onNavigate={(id) => { navigate(id ? `/admin/inbox/${id}` : "/admin/inbox"); setNotifOpen(false); }} />
        </div>
      )}

      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}

function NotifPanel({
  summary,
  onNavigate,
}: {
  summary: AdminNotificationSummary | null;
  onNavigate: (id: string) => void;
}) {
  if (!summary) {
    return (
      <div className="admin-notif-dropdown">
        <div className="admin-notif-loading"><div className="spinner spinner--sm" /></div>
      </div>
    );
  }

  return (
    <div className="admin-notif-dropdown">
      <div className="admin-notif-header">
        <span className="admin-notif-title">Support Overview</span>
        <div className="admin-notif-counts">
          <span className="admin-notif-count-chip admin-notif-count-chip--open">
            {summary.openCount} open
          </span>
          {summary.pendingCount > 0 && (
            <span className="admin-notif-count-chip admin-notif-count-chip--pending">
              {summary.pendingCount} pending
            </span>
          )}
          {summary.urgentCount > 0 && (
            <span className="admin-notif-count-chip admin-notif-count-chip--urgent">
              {summary.urgentCount} urgent
            </span>
          )}
        </div>
      </div>

      {summary.recentOpen.length === 0 ? (
        <div className="admin-notif-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 32, height: 32, color: "#94a3b8" }}>
            <path d="M22 12h-6l-2 3h-4l-2-3H2" />
            <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
          </svg>
          <p>All caught up!</p>
        </div>
      ) : (
        <div className="admin-notif-list">
          {summary.recentOpen.map((t) => (
            <button
              key={t.id}
              className="admin-notif-item"
              onClick={() => onNavigate(t.id)}
              type="button"
            >
              <div className="admin-notif-item-top">
                <span className="admin-notif-item-num">#{t.ticketNumber}</span>
                <span className={`ticket-priority ${PRIORITY_CLASS[t.priority]}`} style={{ fontSize: 10, padding: "1px 7px" }}>
                  {t.priority}
                </span>
                <span className={`ticket-status ${STATUS_CLASS[t.status]}`} style={{ fontSize: 10, padding: "1px 7px" }}>
                  {t.status}
                </span>
              </div>
              <p className="admin-notif-item-subject">{t.subject}</p>
              <div className="admin-notif-item-meta">
                <span>{t.requesterEmail}</span>
                {t.workspace && <span className="admin-notif-item-ws">{t.workspace.name}</span>}
                <span className="admin-notif-item-time">{fmtTime(t.lastMessageAt)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="admin-notif-footer">
        <button
          className="admin-notif-view-all"
          onClick={() => onNavigate("")}
          type="button"
        >
          View all tickets →
        </button>
      </div>
    </div>
  );
}
