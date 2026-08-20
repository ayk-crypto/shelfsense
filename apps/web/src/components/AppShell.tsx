import { type FormEvent, useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { getAlerts } from "../api/alerts";
import { getNotifications, markAllNotificationsRead, markNotificationRead } from "../api/notifications";
import { resendVerification } from "../api/auth";
import { getCurrentSubscription } from "../api/subscriptions";
import { getActiveAnnouncements, type CustomerAnnouncement } from "../api/announcements";
import { useAuth } from "../context/AuthContext";
import { useLocation } from "../context/LocationContext";
import { useWorkspaceSettings } from "../context/WorkspaceSettingsContext";
import { PlanFeaturesContext, planFeaturesFromSubscription } from "../context/PlanFeaturesContext";
import type { CurrentSubscription, Notification } from "../types";
import { hasPermission } from "../utils/permissions";

type NavIconName =
  | "today"
  | "work"
  | "alert"
  | "items"
  | "ledger"
  | "orders"
  | "suppliers"
  | "reports"
  | "audit"
  | "team"
  | "locations"
  | "settings"
  | "support";

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
  const [subscription, setSubscription] = useState<CurrentSubscription | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(true);
  const [announcements, setAnnouncements] = useState<CustomerAnnouncement[]>([]);
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("ss_dismissed_ann") ?? "[]") as string[]);
    } catch {
      return new Set<string>();
    }
  });

  const canStockIn = hasPermission(user, "stock_in");
  const canStockOut = hasPermission(user, "stock_out");
  const canViewAlerts = hasPermission(user, "alerts");
  const canViewSuppliers = hasPermission(user, "suppliers");
  const canViewPurchases = hasPermission(user, "purchases");
  const canViewReports = hasPermission(user, "reports");
  const canManageTeam = user?.role === "OWNER";
  const canAccessManagement = canStockIn || canViewSuppliers || canViewPurchases || canViewReports;
  const workspaceName = settings.name.trim() || "ShelfSense";
  const planFeatures = planFeaturesFromSubscription(subscription?.plan ?? null, subscriptionLoading);

  useEffect(() => {
    async function loadShellSignals() {
      setNotificationsLoading(true);
      if (!canViewAlerts) setAlertCount(0);

      try {
        if (canViewAlerts) {
          const alerts = await getAlerts();
          setAlertCount(alerts.lowStock.length + alerts.expiringSoon.length + alerts.expired.length);
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
    function refreshSubscription() {
      getCurrentSubscription()
        .then((res) => setSubscription(res.subscription))
        .catch(() => {});
    }

    getCurrentSubscription()
      .then((res) => setSubscription(res.subscription))
      .catch(() => {})
      .finally(() => setSubscriptionLoading(false));

    window.addEventListener("shelfsense:plan-changed", refreshSubscription);
    function handleVisibility() {
      if (!document.hidden) refreshSubscription();
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("shelfsense:plan-changed", refreshSubscription);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  useEffect(() => {
    getActiveAnnouncements()
      .then((res) => setAnnouncements(res.announcements))
      .catch(() => {});
  }, []);

  useEffect(() => {
    function handleOnline() { setIsOnline(true); }
    function handleOffline() { setIsOnline(false); }
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
        if (current !== nextIsDesktop) setNotificationsOpen(false);
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

  function dismissAnnouncement(id: string) {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem("ss_dismissed_ann", JSON.stringify([...next]));
      } catch {
        // Ignore storage failures; dismissal still works for the current session.
      }
      return next;
    });
  }

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
      current.map((notification) => notification.id === id ? { ...notification, readAt } : notification),
    );
    setUnreadNotifications((current) => Math.max(0, current - 1));

    try {
      await markNotificationRead(id);
    } catch {
      setNotifications((current) =>
        current.map((notification) => notification.id === id ? { ...notification, readAt: null } : notification),
      );
      setUnreadNotifications((current) => current + 1);
    }
  }

  async function handleMarkAllNotificationsRead() {
    const unreadIds = notifications.filter((notification) => !notification.readAt).map((notification) => notification.id);
    if (unreadIds.length === 0) return;

    const readAt = new Date().toISOString();
    setNotifications((current) =>
      current.map((notification) => notification.readAt ? notification : { ...notification, readAt }),
    );
    setUnreadNotifications(0);

    try {
      await markAllNotificationsRead();
    } catch {
      setNotifications((current) =>
        current.map((notification) => unreadIds.includes(notification.id) ? { ...notification, readAt: null } : notification),
      );
      setUnreadNotifications(unreadIds.length);
    }
  }

  return (
    <PlanFeaturesContext.Provider value={planFeatures}>
      <div className="shell">
        <aside className="sidebar">
          <div className="sidebar-header">
            <div className="sidebar-brand">
              <span className="logo-mark">S</span>
              <div className="sidebar-brand-text">
                <span className={`sidebar-workspace-name ${workspaceLoading ? "sidebar-workspace-name--loading" : ""}`}>
                  {workspaceName}
                </span>
                <span className="sidebar-brand-sub">ShelfSense</span>
              </div>
            </div>
          </div>

          <nav className="sidebar-nav" aria-label="Main navigation">
            <SidebarLink to="/dashboard" icon="today">Today</SidebarLink>

            <p className="nav-section-label">Operations</p>
            <SidebarLink to="/daily-operations" icon="work">Today's Work</SidebarLink>
            {canViewAlerts && (
              <SidebarLink to="/alerts" icon="alert" badge={alertCount}>Action Center</SidebarLink>
            )}

            <p className="nav-section-label">Inventory</p>
            <SidebarLink to="/items" icon="items">Items</SidebarLink>
            <SidebarLink to="/movements" icon="ledger">Stock Ledger</SidebarLink>

            {(canViewPurchases || canViewSuppliers) && (
              <>
                <p className="nav-section-label">Purchasing</p>
                {canViewPurchases && (
                  <SidebarLink to="/purchases" icon="orders">Purchase Orders</SidebarLink>
                )}
                {canViewSuppliers && (
                  <SidebarLink to="/suppliers" icon="suppliers">Suppliers</SidebarLink>
                )}
              </>
            )}

            {(canViewReports || canManageTeam) && (
              <>
                <p className="nav-section-label">Insights</p>
                {canViewReports && <SidebarLink to="/reports" icon="reports">Reports</SidebarLink>}
                {canManageTeam && <SidebarLink to="/activity" icon="audit">Audit Log</SidebarLink>}
              </>
            )}

            {canManageTeam && (
              <>
                <p className="nav-section-label">Admin</p>
                <SidebarLink to="/team" icon="team">Team</SidebarLink>
                <SidebarLink to="/locations" icon="locations">Locations</SidebarLink>
                <SidebarLink to="/settings" icon="settings">Settings</SidebarLink>
              </>
            )}

            <p className="nav-section-label">Help</p>
            <SidebarLink to="/support" icon="support">Support</SidebarLink>
          </nav>

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

            <form className="topbar-search" role="search" onSubmit={handleCommandSearch}>
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
                {planFeatures.enableBarcodeScanning && (
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => goToItems({ action: "scan" })}>
                    Scan
                  </button>
                )}
                {canStockOut && (
                  <button type="button" className="btn btn--topbar-stock-out btn--sm" onClick={() => navigate("/stock-out")}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
                      <path d="M12 19V5M19 12l-7-7-7 7" />
                    </svg>
                    Use Stock
                  </button>
                )}
                {canStockIn && (
                  <button type="button" className="btn btn--topbar-stock-in btn--sm" onClick={() => navigate("/stock-in")}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
                      <path d="M12 5v14M5 12l7 7 7-7" />
                    </svg>
                    Receive Stock
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
            {user && user.emailVerified === false && <EmailVerifyBanner />}

            {subscription?.status === "MANUAL_REVIEW" && (
              <div className="billing-pending-banner">
                <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 16, height: 16, flexShrink: 0 }}>
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <span>
                  <strong>{subscription.plan.name} plan selected.</strong>{" "}
                  Your plan has been saved. Our team will contact you shortly to activate billing.
                </span>
                <button className="billing-pending-banner-btn" onClick={() => navigate("/plan")}>View Plan</button>
              </div>
            )}

            {announcements
              .filter((announcement) => !dismissedIds.has(announcement.id))
              .map((announcement) => {
                const severityStyles = {
                  INFO: { bg: "#eff6ff", border: "#93c5fd", color: "#1d4ed8" },
                  SUCCESS: { bg: "#f0fdf4", border: "#86efac", color: "#15803d" },
                  WARNING: { bg: "#fffbeb", border: "#fcd34d", color: "#b45309" },
                  CRITICAL: { bg: "#fef2f2", border: "#fca5a5", color: "#b91c1c" },
                } as const;
                const style = severityStyles[announcement.severity as keyof typeof severityStyles] ?? severityStyles.INFO;
                return (
                  <div key={announcement.id} className="ann-banner" style={{ background: style.bg, borderColor: style.border, color: style.color }}>
                    <div className="ann-banner-content">
                      <strong className="ann-banner-title">{announcement.title}</strong>
                      {announcement.message && <span className="ann-banner-msg">{announcement.message}</span>}
                    </div>
                    {announcement.dismissible && (
                      <button type="button" className="ann-banner-close" onClick={() => dismissAnnouncement(announcement.id)} aria-label="Dismiss announcement">×</button>
                    )}
                  </div>
                );
              })}

            <Outlet />
          </main>
        </div>

        <nav className="bottom-nav">
          <BottomLink to="/dashboard" icon="today" label="Today" />
          <BottomLink to="/daily-operations" icon="work" label="Work" />
          <BottomLink to="/items" icon="items" label="Items" />
          <BottomLink to="/movements" icon="ledger" label="Ledger" />
          {canViewAlerts && <BottomLink to="/alerts" icon="alert" label="Tasks" badge={alertCount} />}

          {canAccessManagement && (
            <>
              {canViewSuppliers && <BottomLink to="/suppliers" icon="suppliers" label="Suppliers" />}
              {canViewPurchases && <BottomLink to="/purchases" icon="orders" label="Orders" />}
              {canViewReports && <BottomLink to="/reports" icon="reports" label="Reports" />}
              {canManageTeam && (
                <>
                  <BottomLink to="/team" icon="team" label="Team" />
                  <BottomLink to="/activity" icon="audit" label="Audit" />
                  <BottomLink to="/locations" icon="locations" label="Branches" />
                  <BottomLink to="/settings" icon="settings" label="Settings" />
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
    </PlanFeaturesContext.Provider>
  );
}

function SidebarLink({
  to,
  icon,
  badge,
  children,
}: {
  to: string;
  icon: NavIconName;
  badge?: number;
  children: ReactNode;
}) {
  return (
    <NavLink to={to} className={({ isActive }) => `nav-item ${isActive ? "nav-item--active" : ""}`}>
      <NavIcon name={icon} />
      <span className="nav-label">{children}</span>
      {badge !== undefined && badge > 0 && <span className="nav-badge">{badge > 99 ? "99+" : badge}</span>}
    </NavLink>
  );
}

function BottomLink({
  to,
  icon,
  label,
  badge,
}: {
  to: string;
  icon: NavIconName;
  label: string;
  badge?: number;
}) {
  return (
    <NavLink to={to} className={({ isActive }) => `bottom-nav-item ${isActive ? "bottom-nav-item--active" : ""}`}>
      <span className="bottom-nav-icon-wrap">
        <NavIcon name={icon} />
        {badge !== undefined && badge > 0 && <span className="bottom-nav-badge">{badge > 99 ? "99+" : badge}</span>}
      </span>
      <span>{label}</span>
    </NavLink>
  );
}

function NavIcon({ name }: { name: NavIconName }) {
  const common = {
    className: "nav-icon",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (name) {
    case "today":
      return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>;
    case "work":
      return <svg {...common}><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>;
    case "alert":
      return <svg {...common}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>;
    case "items":
      return <svg {...common}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></svg>;
    case "ledger":
      return <svg {...common}><path d="M3 7h13M13 4l3 3-3 3M21 17H8M11 14l-3 3 3 3" /></svg>;
    case "orders":
      return <svg {...common}><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>;
    case "suppliers":
      return <svg {...common}><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>;
    case "reports":
      return <svg {...common}><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></svg>;
    case "audit":
      return <svg {...common}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>;
    case "team":
      return <svg {...common}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
    case "locations":
      return <svg {...common}><path d="M21 10c0 7-9 12-9 12S3 17 3 10a9 9 0 1 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>;
    case "settings":
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.4 1.07V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-.4-1.07 1.65 1.65 0 0 0-1-.6 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1.07-.4H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.07-.4 1.65 1.65 0 0 0 .6-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .4-1.07V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 .4 1.07 1.65 1.65 0 0 0 1 .6 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 .6 1 1.65 1.65 0 0 0 1.07.4H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.07.4z" /></svg>;
    case "support":
      return <svg {...common}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>;
  }
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

function EmailVerifyBanner() {
  const [status, setStatus] = useState<ResendStatus>("idle");

  async function handleResend() {
    setStatus("loading");
    try {
      await resendVerification();
      setStatus("sent");
    } catch (err) {
      const responseStatus = (err as { status?: number }).status;
      if (responseStatus === 401) setStatus("error_auth");
      else setStatus("error_provider");
    }
  }

  if (status === "sent") {
    return (
      <div className="verify-banner verify-banner--success" role="status">
        <div className="verify-banner-icon-wrap verify-banner-icon-wrap--success">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        </div>
        <span className="verify-banner-text">Verification email sent. Check your inbox (and spam folder).</span>
      </div>
    );
  }

  if (status === "error_auth") {
    return (
      <div className="verify-banner verify-banner--error" role="alert">
        <div className="verify-banner-icon-wrap verify-banner-icon-wrap--error">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
        </div>
        <span className="verify-banner-text">Please sign in again to resend the verification email.</span>
      </div>
    );
  }

  const errorMsg = status === "error_provider" || status === "error"
    ? "Unable to send verification email right now. Please try again later."
    : null;

  return (
    <div className="verify-banner" role="status">
      <div className="verify-banner-icon-wrap">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
      </div>
      <span className="verify-banner-text">
        Please verify your email address to unlock all features.
        {errorMsg && <span className="verify-banner-error"> {errorMsg}</span>}
      </span>
      <button type="button" className="verify-banner-btn" onClick={() => { void handleResend(); }} disabled={status === "loading"}>
        {status === "loading" ? <><span className="btn-spinner btn-spinner--xs" /> Sending…</> : errorMsg ? "Try again" : "Resend email"}
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
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
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
      <button type="button" className={`notification-bell ${open ? "notification-bell--active" : ""}`} onClick={onToggle} aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`} aria-expanded={open}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
        {unreadCount > 0 && <span className="notification-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>

      {open && (
        <div className="notification-panel" role="dialog" aria-label="Notifications">
          <div className="notification-panel-header">
            <div>
              <h2 className="notification-panel-title">Notifications</h2>
              <p className="notification-panel-subtitle">{unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}</p>
            </div>
            <button type="button" className="notification-mark-all" disabled={unreadCount === 0} onClick={onMarkAllRead}>Mark all read</button>
          </div>
          <div className="notification-list">
            {loading ? (
              <p className="notification-empty">Loading notifications...</p>
            ) : notifications.length === 0 ? (
              <p className="notification-empty">No notifications yet. Alerts will appear here when ShelfSense spots risk.</p>
            ) : (
              notifications.map((notification) => (
                <article key={notification.id} className={`notification-item ${notification.readAt ? "" : "notification-item--unread"}`}>
                  <div className="notification-item-main">
                    <div className="notification-item-head"><h3>{notification.title}</h3><span>{formatNotificationTime(notification.createdAt)}</span></div>
                    <p>{notification.message}</p>
                  </div>
                  {!notification.readAt && <button type="button" className="notification-read-btn" onClick={() => onMarkRead(notification.id)}>Mark read</button>}
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
    function handlePointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (loading && locations.length === 0) return <div className="location-select-skeleton" aria-label="Loading locations" />;
  if (locations.length === 0) return null;

  const active = locations.find((location) => location.id === activeLocationId) ?? locations[0];

  return (
    <div className="loc-picker" ref={ref}>
      <button type="button" className="loc-picker-btn" onClick={() => setOpen((current) => !current)} aria-haspopup="listbox" aria-expanded={open}>
        <svg className="loc-picker-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 12-9 12S3 17 3 10a9 9 0 1 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
        <span className="loc-picker-name">{active.name}</span>
        <svg className={`loc-picker-chevron ${open ? "loc-picker-chevron--open" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9" /></svg>
      </button>

      {open && (
        <div className="loc-picker-panel" role="listbox">
          <div className="loc-picker-panel-label">Switch branch</div>
          {locations.map((location) => {
            const isActive = location.id === activeLocationId;
            return (
              <button key={location.id} type="button" role="option" aria-selected={isActive} className={`loc-picker-item ${isActive ? "loc-picker-item--active" : ""}`} onClick={() => { onChange(location.id); setOpen(false); }}>
                <span className="loc-picker-item-name">{location.name}</span>
                {isActive && <svg className="loc-picker-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
