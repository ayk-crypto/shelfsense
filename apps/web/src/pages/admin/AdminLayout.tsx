import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

export function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-header">
          <div className="admin-brand">
            <span className="admin-brand-mark">S</span>
            <div className="admin-brand-text">
              <span className="admin-brand-name">ShelfSense</span>
              <span className="admin-brand-label">Platform Admin</span>
            </div>
          </div>
        </div>

        <nav className="admin-nav">
          <NavLink to="/admin" end className={({ isActive }) => `admin-nav-item ${isActive ? "admin-nav-item--active" : ""}`}>
            <svg className="admin-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            Overview
          </NavLink>
          <NavLink to="/admin/workspaces" className={({ isActive }) => `admin-nav-item ${isActive ? "admin-nav-item--active" : ""}`}>
            <svg className="admin-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            Workspaces
          </NavLink>
          <NavLink to="/admin/users" className={({ isActive }) => `admin-nav-item ${isActive ? "admin-nav-item--active" : ""}`}>
            <svg className="admin-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            Users
          </NavLink>
          <NavLink to="/admin/activity" className={({ isActive }) => `admin-nav-item ${isActive ? "admin-nav-item--active" : ""}`}>
            <svg className="admin-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3v18h18" />
              <path d="M7 14l4-4 3 3 5-6" />
            </svg>
            Audit Logs
          </NavLink>
        </nav>

        <div className="admin-sidebar-footer">
          <div className="admin-user-info">
            <div className="admin-user-avatar">{user?.name?.[0]?.toUpperCase() ?? "A"}</div>
            <div className="admin-user-details">
              <span className="admin-user-name">{user?.name}</span>
              <span className="admin-user-role">Super Admin</span>
            </div>
          </div>
          <div className="admin-footer-actions">
            <NavLink to="/dashboard" className="admin-footer-link" title="Back to app">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 5l-7 7 7 7" />
              </svg>
            </NavLink>
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

      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
