import { type FormEvent, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { getAlerts } from "../api/alerts";
import { getNotifications, markAllNotificationsRead, markNotificationRead } from "../api/notifications";
import { resendVerification } from "../api/auth";
import { useAuth } from "../context/AuthContext";
import { useLocation } from "../context/LocationContext";
import { useWorkspaceSettings } from "../context/WorkspaceSettingsContext";
import type { Notification } from "../types";

export function AppShell() {
  const { user, logout } = useAuth();
  const { settings, loading: workspaceLoading } = useWorkspaceSettings();
  const {
    locations,
    activeLocation,
    activeLocationId,
    loading: locationsLoading,
    setActiveLocationId,
    switchedLocation,
    clearSwitchedLocation,
  } = useLocation();
  const navigate = useNavigate();
  const [alertCount, setAlertCount] = useState(0);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [showSwitchedToast, setShowSwitchedToast] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [isDesktopShell, setIsDesktopShell] = useState(() => window.innerWidth >= 768);
  const [commandSearch, setCommandSearch] = useState("");
  const canAccessManagement = user?.role === "OWNER" || user?.role === "MANAGER";
  const canRecordStockOut = user?.role === "OWNER" || user?.role === "MANAGER" || user?.role === "OPERATOR";
  const canViewAlerts = user?.role === "OWNER" || user?.role === "MANAGER" || user?.role === "OPERATOR";
  const canManageTeam = user?.role === "OWNER";
  const workspaceName = settings.name.trim() || "ShelfSense";

  useEffect(() => {
    async function loadShellSignals() {
      setNotificationsLoading(true);
      if (!canViewAlerts) {
        setAlertCount(0);
      }

      try {
        if (canViewAlerts) {
          const alerts = await getAlerts();
          setAlertCount(
            alerts.lowStock.length + alerts.expiringSoon.length + alerts.expired.length,
          );
        }

        const res = await getNotifications();
        setNotifications(res.notifications);
        setUnreadNotifications(res.unreadCount);
      } catch {
        if (canViewAlerts) setAlertCount(0);
        setNotifications([]);
        setUnreadNotifications(0);
      } finally {
        setNotificationsLoading(false);
      }
    }

    void loadShellSignals();
  }, [canViewAlerts, activeLocationId]);

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
    }

    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    function handleResize() {
      const nextIsDesktop = window.innerWidth >= 768;
      setIsDesktopShell((current) => {
        if (current !== nextIsDesktop) {
          setNotificationsOpen(false);
        }
        return nextIsDesktop;
      });
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!switchedLocation) return;
    setShowSwitchedToast(true);
    clearSwitchedLocation();
    const timer = setTimeout(() => setShowSwitchedToast(false), 4500);
    return () => clearTimeout(timer);
  }, [switchedLocation, clearSwitchedLocation]);

  function handleLogout() {
    logout();
    navigate("/login");
  }

  function goToItems(params?: Record<string, string>) {
    const search = new URLSearchParams(params).toString();
    navigate(`/items${search ? `?${search}` : ""}`);
  }

  function handleCommandSearch(e: FormEvent) {
    e.preventDefault();
    const query = commandSearch.trim();
    goToItems(query ? { q: query } : undefined);
  }

  async function handleMarkNotificationRead(id: string) {
    const existing = notifications.find((notification) => notification.id === id);
    if (!existing || existing.readAt) return;

    const readAt = new Date().toISOString();
    setNotifications((current) =>
      current.map((notification) =>
        notification.id === id ? { ...notification, readAt } : notification,
      ),
    );
    setUnreadNotifications((current) => Math.max(0, current - 1));

    try {
      await markNotificationRead(id);
    } catch {
      setNotifications((current) =>
        current.map((notification) =>
          notification.id === id ? { ...notification, readAt: null } : notification,
        ),
      );
      setUnreadNotifications((current) => current + 1);
    }
  }

  async function handleMarkAllNotificationsRead() {
    const unreadIds = notifications
      .filter((notification) => !notification.readAt)
      .map((notification) => notification.id);
    if (unreadIds.length === 0) return;

    const readAt = new Date().toISOString();
    setNotifications((current) =>
      current.map((notification) =>
        notification.readAt ? notification : { ...notification, readAt },
      ),
    );
    setUnreadNotifications(0);

    try {
      await markAllNotificationsRead();
    } catch {
      setNotifications((current) =>
        current.map((notification) =>
          unreadIds.includes(notification.id) ? { ...notification, readAt: null } : notification,
        ),
      );
      setUnreadNotifications(unreadIds.length);
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        {/* ── Brand header ── */}
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <span className="logo-mark">S</span>
            <div className="sidebar-brand-text">
              <span className={`sidebar-workspace-name ${workspaceLoading ? "sidebar-workspace-name--loading" : ""}`}>{workspaceName}</span>
              <span className="sidebar-brand-sub">ShelfSense</span>
            </div>
          </div>
        </div>

        {/* ── Main navigation ── */}
        <nav className="sidebar-nav" aria-label="Main navigation">
          {/* Today */}
          <NavLink to="/dashboard" className={({ isActive }) => `nav-item ${isActive ? "nav-item--active" : ""}`}>
            <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
            Today
          </NavLink>

          {/* OPERATIONS */}
          <p className="nav-section-label">Operations</p>
          <NavLink to="/daily-operations" className={({ isActive }) => `nav-item ${isActive ? "nav-item--active" : ""}`}>
            <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            Daily Ops
          </NavLink>
          {canAccessManagement && (
            <NavLink to="/stock-in" className={({ isActive }) => `nav-item nav-item--stock-in ${isActive ? "nav-item--active" : ""}`}>
              <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
              Stock In
            </NavLink>
          )}
          {canRecordStockOut && (
            <NavLink to="/stock-out" className={({ isActive }) => `nav-item nav-item--stock-out ${isActive ? "nav-item--active" : ""}`}>
              <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M19 12l-7-7-7 7" />
              </svg>
              Stock Out
            </NavLink>
          )}
          <NavLink to="/movements" className={({ isActive }) => `nav-item ${isActive ? "nav-item--active" : ""}`}>
            <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7h13M13 4l3 3-3 3M21 17H8M11 14l-3 3 3 3" />
            </svg>
            Stock Activity
          </NavLink>

          {/* INVENTORY */}
          <p className="nav-section-label">Inventory</p>
          <NavLink to="/items" className={({ isActive }) => `nav-item ${isActive ? "nav-item--active" : ""}`}>
            <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
            Items
          </NavLink>
          {canViewAlerts && (
            <NavLink to="/alerts" className={({ isActive }) => `nav-item ${isActive ? "nav-item--active" : ""}`}>
              <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span className="nav-label">Alerts</span>
              {alertCount > 0 && <span className="nav-badge">{alertCount > 99 ? "99+" : alertCount}</span>}
            </NavLink>
          )}

          {/* PURCHASING */}
          {canAccessManagement && (
            <>
              <p className="nav-section-label">Purchasing</p>
              <NavLink to="/suppliers" className={({ isActive }) => `nav-item ${isActive ? "nav-item--active" : ""}`}>
                <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
                Suppliers
              </NavLink>
              <NavLink to="/purchases" className={({ isActive }) => `nav-item ${isActive ? "nav-item--active" : ""}`}>
                <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <path d="M16 10a4 4 0 0 1-8 0" />
                </svg>
                Purchases
              </NavLink>
            </>
          )}

          {/* INSIGHTS */}
          {canAccessManagement && (
            <>
              <p className="nav-section-label">Insights</p>
              <NavLink to="/reports" className={({ isActive }) => `nav-item ${isActive ? "nav-item--active" : ""}`}>
                <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
                Reports
              </NavLink>
              {canManageTeam && (
                <NavLink to="/activity" className={({ isActive }) => `nav-item ${isActive ? "nav-item--active" : ""}`}>
                  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                  Activity
                </NavLink>
              )}
            </>
          )}

          {/* WORKSPACE */}
          {canManageTeam && (
            <>
              <p className="nav-section-label">Workspace</p>
              <NavLink to="/team" className={({ isActive }) => `nav-item ${isActive ? "nav-item--active" : ""}`}>
                <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                Team
              </NavLink>
              <NavLink to="/locations" className={({ isActive }) => `nav-item ${isActive ? "nav-item--active" : ""}`}>
                <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 12-9 12S3 17 3 10a9 9 0 1 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                Locations
              </NavLink>
              <NavLink to="/plan" className={({ isActive }) => `nav-item ${isActive ? "nav-item--active" : ""}`}>
                <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                Plan
              </NavLink>
              <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? "nav-item--active" : ""}`}>
                <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.4 1.07V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-.4-1.07 1.65 1.65 0 0 0-1-.6 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1.07-.4H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.07-.4 1.65 1.65 0 0 0 .6-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .4-1.07V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 .4 1.07 1.65 1.65 0 0 0 1 .6 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 .6 1 1.65 1.65 0 0 0 1.07.4H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.07.4z" />
                </svg>
                Settings
              </NavLink>
            </>
          )}

        </nav>


        {/* ── User / footer ── */}
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="user-avatar">{user?.name?.[0]?.toUpperCase() ?? "U"}</div>
            <div className="user-details">
              <span className="user-name">{user?.name}</span>
              <span className="user-sub">
                {user?.customRoleName
                  ? user.customRoleName
                  : user?.role
                    ? user.role.charAt(0) + user.role.slice(1).toLowerCase()
                    : null}
                {user?.customRoleName || user?.role ? " · " : ""}
                <span className="user-email">{user?.email}</span>
              </span>
            </div>
          </div>
          <div className="sidebar-footer-actions">
            {isDesktopShell && (
              <NotificationBell
                open={notificationsOpen}
                notifications={notifications}
                unreadCount={unreadNotifications}
                loading={notificationsLoading}
                onToggle={() => setNotificationsOpen((open) => !open)}
                onClose={() => setNotificationsOpen(false)}
                onMarkRead={handleMarkNotificationRead}
                onMarkAllRead={handleMarkAllNotificationsRead}
              />
            )}
            <button className="logout-btn" onClick={handleLogout} title="Sign out" aria-label="Sign out">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      <div className="shell-body">
        <header className="topbar">
          <div className="topbar-title">
            <span className="topbar-brand-text">
              <span className={`topbar-brand-name ${workspaceLoading ? "topbar-brand-name--loading" : ""}`}>
                {workspaceName}
              </span>
              <span className="topbar-brand-powered">Inventory command center</span>
            </span>
          </div>
          <form className="topbar-search" role="search" onSubmit={(e) => { handleCommandSearch(e); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              aria-label="Search inventory"
              placeholder="Search items, SKU, barcode..."
              value={commandSearch}
              onChange={(e) => setCommandSearch(e.target.value)}
            />
          </form>
          <div className="topbar-user">
            <LocationSelector
              locations={locations}
              activeLocationId={activeLocationId}
              loading={locationsLoading}
              onChange={setActiveLocationId}
            />
            <div className="topbar-actions">
              {(user?.platformRole === "SUPER_ADMIN" || user?.platformRole === "SUPPORT_ADMIN") && (
                <button
                  type="button"
                  className="btn btn--admin-return btn--sm"
                  onClick={() => navigate("/admin")}
                  title="Return to Platform Admin panel"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{width:12,height:12}}>
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                  Admin Panel
                </button>
              )}
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => goToItems({ action: "scan" })}>Scan</button>
              {canRecordStockOut && (
                <button type="button" className="btn btn--topbar-stock-out btn--sm" onClick={() => navigate("/stock-out")}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{width:13,height:13}}>
                    <path d="M12 19V5M19 12l-7-7-7 7" />
                  </svg>
                  Stock Out
                </button>
              )}
              {canAccessManagement && (
                <button type="button" className="btn btn--topbar-stock-in btn--sm" onClick={() => navigate("/stock-in")}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{width:13,height:13}}>
                    <path d="M12 5v14M5 12l7 7 7-7" />
                  </svg>
                  Stock In
                </button>
              )}
            </div>
            {!isDesktopShell && (
              <NotificationBell
                open={notificationsOpen}
                notifications={notifications}
                unreadCount={unreadNotifications}
                loading={notificationsLoading}
                onToggle={() => setNotificationsOpen((open) => !open)}
                onClose={() => setNotificationsOpen(false)}
                onMarkRead={handleMarkNotificationRead}
                onMarkAllRead={handleMarkAllNotificationsRead}
              />
            )}
            <div className="user-avatar user-avatar--sm">{user?.name?.[0]?.toUpperCase() ?? "U"}</div>
          </div>
        </header>

        <main className="page-content">
          {!isOnline && <OfflineNotice />}
          {user && user.emailVerified === false && <EmailVerifyBanner email={user.email} />}
          <Outlet />
        </main>
      </div>

      <nav className="bottom-nav">
        <NavLink to="/dashboard" className={({ isActive }) => `bottom-nav-item ${isActive ? "bottom-nav-item--active" : ""}`}>
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <span>Today</span>
        </NavLink>
        <NavLink to="/daily-operations" className={({ isActive }) => `bottom-nav-item ${isActive ? "bottom-nav-item--active" : ""}`}>
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7h16" />
            <path d="M4 12h10" />
            <path d="M4 17h7" />
            <path d="m16 15 2 2 4-5" />
          </svg>
          <span>Ops</span>
        </NavLink>
        <NavLink to="/items" className={({ isActive }) => `bottom-nav-item ${isActive ? "bottom-nav-item--active" : ""}`}>
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          </svg>
          <span>Items</span>
        </NavLink>
        <NavLink to="/movements" className={({ isActive }) => `bottom-nav-item ${isActive ? "bottom-nav-item--active" : ""}`}>
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 7h13" />
            <path d="M13 4l3 3-3 3" />
            <path d="M21 17H8" />
            <path d="M11 14l-3 3 3 3" />
          </svg>
          <span>Moves</span>
        </NavLink>
        {canViewAlerts && (
          <NavLink to="/alerts" className={({ isActive }) => `bottom-nav-item ${isActive ? "bottom-nav-item--active" : ""}`}>
            <span className="bottom-nav-icon-wrap">
              <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              {alertCount > 0 && <span className="bottom-nav-badge">{alertCount}</span>}
            </span>
            <span>Alerts</span>
          </NavLink>
        )}
        {canAccessManagement && (
          <>
            <NavLink to="/suppliers" className={({ isActive }) => `bottom-nav-item ${isActive ? "bottom-nav-item--active" : ""}`}>
              <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span>Suppliers</span>
            </NavLink>
            <NavLink to="/purchases" className={({ isActive }) => `bottom-nav-item ${isActive ? "bottom-nav-item--active" : ""}`}>
              <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <line x1="10" y1="9" x2="8" y2="9" />
              </svg>
              <span>Purchases</span>
            </NavLink>
            <NavLink to="/reports" className={({ isActive }) => `bottom-nav-item ${isActive ? "bottom-nav-item--active" : ""}`}>
              <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4h16v16H4z" />
                <path d="M8 9h8" />
                <path d="M8 13h8" />
                <path d="M8 17h5" />
              </svg>
              <span>Reports</span>
            </NavLink>
            {canManageTeam && (
              <>
                <NavLink to="/team" className={({ isActive }) => `bottom-nav-item ${isActive ? "bottom-nav-item--active" : ""}`}>
                  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  <span>Team</span>
                </NavLink>
                <NavLink to="/activity" className={({ isActive }) => `bottom-nav-item ${isActive ? "bottom-nav-item--active" : ""}`}>
                  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 3v18h18" />
                    <path d="M7 14l4-4 3 3 5-6" />
                  </svg>
                  <span>Activity</span>
                </NavLink>
                <NavLink to="/locations" className={({ isActive }) => `bottom-nav-item ${isActive ? "bottom-nav-item--active" : ""}`}>
                  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 10c0 7-9 12-9 12S3 17 3 10a9 9 0 1 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  <span>Branches</span>
                </NavLink>
                <NavLink to="/settings" className={({ isActive }) => `bottom-nav-item ${isActive ? "bottom-nav-item--active" : ""}`}>
                  <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.4 1.07V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-.4-1.07 1.65 1.65 0 0 0-1-.6 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1.07-.4H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.07-.4 1.65 1.65 0 0 0 .6-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .4-1.07V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 .4 1.07 1.65 1.65 0 0 0 1 .6 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 .6 1 1.65 1.65 0 0 0 1.07.4H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.07.4 1.65 1.65 0 0 0-.44.2z" />
                  </svg>
                  <span>Settings</span>
                </NavLink>
              </>
            )}
          </>
        )}
        <button className="bottom-nav-item" onClick={handleLogout}>
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span>Sign Out</span>
        </button>
      </nav>

      {showSwitchedToast && (
        <div className="toast-stack" aria-live="polite">
          <div className="toast toast--info">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 12-9 12S3 17 3 10a9 9 0 1 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            {activeLocation
              ? `Switched to ${activeLocation.name} — your previous location was unavailable.`
              : "Your previous location was unavailable. Switched to an active location."}
          </div>
        </div>
      )}
    </div>
  );
}

function OfflineNotice() {
  return (
    <div className="offline-notice" role="status">
      <strong>You appear offline.</strong>
      <span>Cached screens may still open, but live inventory data needs the server.</span>
    </div>
  );
}

type ResendStatus = "idle" | "loading" | "sent" | "error_auth" | "error_provider" | "error";

function EmailVerifyBanner({ email }: { email: string }) {
  const [status, setStatus] = useState<ResendStatus>("idle");

  async function handleResend() {
    setStatus("loading");
    try {
      await resendVerification();
      setStatus("sent");
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) {
        setStatus("error_auth");
      } else if (status === 503 || status === 502) {
        setStatus("error_provider");
      } else {
        setStatus("error_provider");
      }
    }
  }

  if (status === "sent") {
    return (
      <div className="verify-banner verify-banner--success" role="status">
        <div className="verify-banner-icon-wrap verify-banner-icon-wrap--success">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <span className="verify-banner-text">
          Verification email sent. Check your inbox (and spam folder).
        </span>
      </div>
    );
  }

  if (status === "error_auth") {
    return (
      <div className="verify-banner verify-banner--error" role="alert">
        <div className="verify-banner-icon-wrap verify-banner-icon-wrap--error">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <span className="verify-banner-text">
          Please sign in again to resend the verification email.
        </span>
      </div>
    );
  }

  const errorMsg = (status === "error_provider" || status === "error")
    ? "Unable to send verification email right now. Please try again later."
    : null;

  return (
    <div className="verify-banner" role="status">
      <div className="verify-banner-icon-wrap">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
      </div>
      <span className="verify-banner-text">
        Please verify your email address to unlock all features.
        {errorMsg && (
          <span className="verify-banner-error"> {errorMsg}</span>
        )}
      </span>
      <button
        type="button"
        className="verify-banner-btn"
        onClick={() => { void handleResend(); }}
        disabled={status === "loading"}
      >
        {status === "loading" ? (
          <><span className="btn-spinner btn-spinner--xs" /> Sending…</>
        ) : (
          (status === "error_provider" || status === "error") ? "Try again" : "Resend email"
        )}
      </button>
    </div>
  );
}

function NotificationBell({
  open,
  notifications,
  unreadCount,
  loading,
  onToggle,
  onClose,
  onMarkRead,
  onMarkAllRead,
}: {
  open: boolean;
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  onToggle: () => void;
  onClose: () => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  return (
    <div className="notification-menu" ref={ref}>
      <button
        type="button"
        className={`notification-bell ${open ? "notification-bell--active" : ""}`}
        onClick={onToggle}
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && <span className="notification-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>

      {open && (
        <div className="notification-panel" role="dialog" aria-label="Notifications">
          <div className="notification-panel-header">
            <div>
              <h2 className="notification-panel-title">Notifications</h2>
              <p className="notification-panel-subtitle">
                {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
              </p>
            </div>
            <button
              type="button"
              className="notification-mark-all"
              disabled={unreadCount === 0}
              onClick={onMarkAllRead}
            >
              Mark all read
            </button>
          </div>

          <div className="notification-list">
            {loading ? (
              <p className="notification-empty">Loading notifications...</p>
            ) : notifications.length === 0 ? (
              <p className="notification-empty">No notifications yet. Alerts will appear here when ShelfSense spots risk.</p>
            ) : (
              notifications.map((notification) => (
                <article
                  key={notification.id}
                  className={`notification-item ${notification.readAt ? "" : "notification-item--unread"}`}
                >
                  <div className="notification-item-main">
                    <div className="notification-item-head">
                      <h3>{notification.title}</h3>
                      <span>{formatNotificationTime(notification.createdAt)}</span>
                    </div>
                    <p>{notification.message}</p>
                  </div>
                  {!notification.readAt && (
                    <button
                      type="button"
                      className="notification-read-btn"
                      onClick={() => onMarkRead(notification.id)}
                    >
                      Mark read
                    </button>
                  )}
                </article>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatNotificationTime(value: string) {
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function LocationSelector({
  locations,
  activeLocationId,
  loading,
  onChange,
}: {
  locations: Array<{ id: string; name: string }>;
  activeLocationId: string;
  loading: boolean;
  onChange: (locationId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  if (loading && locations.length === 0) {
    return <div className="location-select-skeleton" aria-label="Loading locations" />;
  }

  if (locations.length === 0) return null;

  const active = locations.find((l) => l.id === activeLocationId) ?? locations[0];

  return (
    <div className="loc-picker" ref={ref}>
      <button
        type="button"
        className="loc-picker-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <svg className="loc-picker-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 10c0 7-9 12-9 12S3 17 3 10a9 9 0 1 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
        <span className="loc-picker-name">{active.name}</span>
        <svg className={`loc-picker-chevron ${open ? "loc-picker-chevron--open" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="loc-picker-panel" role="listbox">
          <div className="loc-picker-panel-label">Switch branch</div>
          {locations.map((loc) => {
            const isActive = loc.id === activeLocationId;
            return (
              <button
                key={loc.id}
                type="button"
                role="option"
                aria-selected={isActive}
                className={`loc-picker-item ${isActive ? "loc-picker-item--active" : ""}`}
                onClick={() => { onChange(loc.id); setOpen(false); }}
              >
                <span className="loc-picker-item-name">{loc.name}</span>
                {isActive && (
                  <svg className="loc-picker-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}


