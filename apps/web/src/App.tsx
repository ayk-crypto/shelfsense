import { Navigate, Route, BrowserRouter as Router, Routes, useNavigate } from "react-router-dom";
import { AdminLayout } from "./pages/admin/AdminLayout";
import { AdminDashboardPage } from "./pages/admin/AdminDashboardPage";
import { AdminWorkspacesPage } from "./pages/admin/AdminWorkspacesPage";
import { AdminWorkspaceDetailPage } from "./pages/admin/AdminWorkspaceDetailPage";
import { AdminUsersPage } from "./pages/admin/AdminUsersPage";
import { AdminUserDetailPage } from "./pages/admin/AdminUserDetailPage";
import { AdminActivityPage } from "./pages/admin/AdminActivityPage";
import { AdminPlansPage } from "./pages/admin/AdminPlansPage";
import { AdminCouponsPage } from "./pages/admin/AdminCouponsPage";
import { AdminSubscriptionsPage } from "./pages/admin/AdminSubscriptionsPage";
import { AdminPaymentsPage } from "./pages/admin/AdminPaymentsPage";
import { AdminEmailTemplatesPage } from "./pages/admin/AdminEmailTemplatesPage";
import { AdminEmailLogsPage } from "./pages/admin/AdminEmailLogsPage";
import { AdminAnnouncementsPage } from "./pages/admin/AdminAnnouncementsPage";
import { AdminSystemHealthPage } from "./pages/admin/AdminSystemHealthPage";
import { AdminInboxPage } from "./pages/admin/AdminInboxPage";
import { AdminTicketDetailPage } from "./pages/admin/AdminTicketDetailPage";
import { AdminTeamPage } from "./pages/admin/AdminTeamPage";
import { getOnboardingStatus } from "./api/onboarding";
import { getWorkspaceSettings } from "./api/workspace";
import { AppShell } from "./components/AppShell";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { LocationProvider } from "./context/LocationContext";
import { useWorkspaceSettings, WorkspaceSettingsProvider } from "./context/WorkspaceSettingsContext";
import { ActivityPage } from "./pages/ActivityPage";
import { AlertsPage } from "./pages/AlertsPage";
import { BatchDetailPage } from "./pages/BatchDetailPage";
import { DailyOperationsPage } from "./pages/DailyOperationsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ItemsPage } from "./pages/ItemsPage";
import { LocationsPage } from "./pages/LocationsPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { LoginPage } from "./pages/LoginPage";
import { MovementsPage } from "./pages/MovementsPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { PlanSelectionPage } from "./pages/PlanSelectionPage";
import { PurchasesPage } from "./pages/PurchasesPage";
import { ReorderSuggestionsPage } from "./pages/ReorderSuggestionsPage";
import { ReportsPage } from "./pages/ReportsPage";
import { LandingPage } from "./pages/LandingPage";
import { PlanPage } from "./pages/PlanPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { SignupPage } from "./pages/SignupPage";
import { VerifyEmailPage } from "./pages/VerifyEmailPage";
import { StockCountPage } from "./pages/StockCountPage";
import { StockInPage } from "./pages/StockInPage";
import { StockOutPage } from "./pages/StockOutPage";
import { SuppliersPage } from "./pages/SuppliersPage";
import { TeamPage } from "./pages/TeamPage";
import { useEffect, useState } from "react";
import type { OnboardingStatus, WorkspaceSettings } from "./types";
import type { Role } from "./types";
import "./App.css";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) return <>{children}</>;
  if (user?.platformRole === "SUPER_ADMIN") {
    return <Navigate to="/admin" replace />;
  }
  return <Navigate to="/dashboard" replace />;
}

function WorkspaceRequiredRoute({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();

  if (user?.platformRole === "SUPER_ADMIN" || user?.platformRole === "SUPPORT_ADMIN") {
    return <Navigate to="/admin" replace />;
  }

  if (user?.workspaceId) return <>{children}</>;


  function handleSignupRedirect() {
    logout();
    window.location.assign("/signup");
  }

  return (
    <div className="page-error">
      <div className="access-denied">
        <h1 className="access-denied-title">Workspace setup needed</h1>
        <p className="access-denied-copy">
          This account is not connected to a ShelfSense workspace yet. Sign out and create a workspace owner account, or ask an owner to invite you.
        </p>
        <button type="button" className="btn btn--primary access-denied-action" onClick={handleSignupRedirect}>
          Sign out and create account
        </button>
      </div>
    </div>
  );
}

function RoleRoute({
  allowedRoles,
  children,
}: {
  allowedRoles: Role[];
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  return user?.role && allowedRoles.includes(user.role)
    ? <>{children}</>
    : <AccessDenied />;
}

function PlatformAdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.platformRole !== "SUPER_ADMIN" && user?.platformRole !== "SUPPORT_ADMIN") return <AccessDenied />;
  return <>{children}</>;
}

function DefaultRedirect() {
  const { user, isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.platformRole === "SUPER_ADMIN" || user?.platformRole === "SUPPORT_ADMIN") return <Navigate to="/admin" replace />;
  return <Navigate to="/dashboard" replace />;
}

function AccessDenied() {
  return (
    <div className="page-error">
      <div className="access-denied">
        <h1 className="access-denied-title">Access denied</h1>
        <p className="access-denied-copy">
          You do not have permission to view this page.
        </p>
      </div>
    </div>
  );
}

function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { loading: settingsLoading, error: settingsError } = useWorkspaceSettings();
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(user?.role === "OWNER");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      if (user?.role !== "OWNER") {
        setLoading(false);
        setStatus(null);
        return;
      }

      setLoading(true);
      try {
        const res = await getOnboardingStatus();
        if (!cancelled) {
          setStatus(res);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load onboarding status");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, [user?.role]);

  if (user?.platformRole === "SUPER_ADMIN" || user?.platformRole === "SUPPORT_ADMIN") {
    return <Navigate to="/admin" replace />;
  }

  if (user?.role !== "OWNER") return <>{children}</>;

  if (loading || settingsLoading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Loading workspace…</p>
      </div>
    );
  }

  if (error || settingsError) {
    return (
      <div className="page-error">
        <div className="alert alert--error">{error ?? settingsError ?? "Unable to load onboarding"}</div>
      </div>
    );
  }

  if (!status?.onboardingCompleted) {
    return <Navigate to="/onboarding" replace />;
  }

  if (!status.hasSelectedPlan) {
    return <Navigate to="/onboarding/plan" replace />;
  }

  return <>{children}</>;
}

function OnboardingPageWrapper() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [settingsRes, statusRes] = await Promise.all([
          getWorkspaceSettings(),
          getOnboardingStatus(),
        ]);
        if (cancelled) return;
        if (statusRes.onboardingCompleted && statusRes.hasSelectedPlan) {
          navigate("/dashboard", { replace: true });
          return;
        }
        if (statusRes.onboardingCompleted && !statusRes.hasSelectedPlan) {
          navigate("/onboarding/plan", { replace: true });
          return;
        }
        setSettings(settingsRes.settings);
        setStatus(statusRes);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load setup data");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (loading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Loading setup…</p>
      </div>
    );
  }

  if (error || !settings || !status) {
    return (
      <div className="page-error">
        <div className="alert alert--error">{error ?? "Unable to load setup data"}</div>
      </div>
    );
  }

  return (
    <OnboardingPage
      settings={settings}
      status={status}
      onSettingsUpdated={setSettings}
      onComplete={() => navigate("/onboarding/plan", { replace: true })}
    />
  );
}

export function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route
            path="/login"
            element={
              <PublicRoute>
                <LoginPage />
              </PublicRoute>
            }
          />
          <Route
            path="/signup"
            element={
              <PublicRoute>
                <SignupPage />
              </PublicRoute>
            }
          />
          <Route
            path="/forgot-password"
            element={
              <PublicRoute>
                <ForgotPasswordPage />
              </PublicRoute>
            }
          />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute>
                <WorkspaceRequiredRoute>
                  <OnboardingPageWrapper />
                </WorkspaceRequiredRoute>
              </ProtectedRoute>
            }
          />
          <Route
            path="/onboarding/plan"
            element={
              <ProtectedRoute>
                <WorkspaceRequiredRoute>
                  <PlanSelectionPage />
                </WorkspaceRequiredRoute>
              </ProtectedRoute>
            }
          />
          <Route
            element={
              <ProtectedRoute>
                <WorkspaceRequiredRoute>
                  <WorkspaceSettingsProvider>
                    <OnboardingGuard>
                      <LocationProvider>
                        <AppShell />
                      </LocationProvider>
                    </OnboardingGuard>
                  </WorkspaceSettingsProvider>
                </WorkspaceRequiredRoute>
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/daily-operations" element={<DailyOperationsPage />} />
            <Route path="/items" element={<ItemsPage />} />
            <Route path="/items/:id/batches" element={<BatchDetailPage />} />
            <Route path="/movements" element={<MovementsPage />} />
            <Route
              path="/stock-count"
              element={<RoleRoute allowedRoles={["OWNER", "MANAGER", "OPERATOR"]}><StockCountPage /></RoleRoute>}
            />
            <Route
              path="/stock-count/:id"
              element={<RoleRoute allowedRoles={["OWNER", "MANAGER", "OPERATOR"]}><StockCountPage /></RoleRoute>}
            />
            <Route
              path="/transfers"
              element={<RoleRoute allowedRoles={["OWNER", "MANAGER"]}><Navigate to="/items?action=transfer" replace /></RoleRoute>}
            />
            <Route
              path="/stock-in"
              element={<RoleRoute allowedRoles={["OWNER", "MANAGER"]}><StockInPage /></RoleRoute>}
            />
            <Route
              path="/stock-out"
              element={<RoleRoute allowedRoles={["OWNER", "MANAGER", "OPERATOR"]}><StockOutPage /></RoleRoute>}
            />
            <Route
              path="/suppliers"
              element={<RoleRoute allowedRoles={["OWNER", "MANAGER"]}><SuppliersPage /></RoleRoute>}
            />
            <Route
              path="/purchases"
              element={<RoleRoute allowedRoles={["OWNER", "MANAGER"]}><PurchasesPage /></RoleRoute>}
            />
            <Route
              path="/reorder-suggestions"
              element={<RoleRoute allowedRoles={["OWNER", "MANAGER", "OPERATOR"]}><ReorderSuggestionsPage /></RoleRoute>}
            />
            <Route
              path="/reports"
              element={<RoleRoute allowedRoles={["OWNER", "MANAGER"]}><ReportsPage /></RoleRoute>}
            />
            <Route
              path="/alerts"
              element={<RoleRoute allowedRoles={["OWNER", "MANAGER", "OPERATOR"]}><AlertsPage /></RoleRoute>}
            />
            <Route
              path="/team"
              element={<RoleRoute allowedRoles={["OWNER"]}><TeamPage /></RoleRoute>}
            />
            <Route
              path="/activity"
              element={<RoleRoute allowedRoles={["OWNER", "MANAGER"]}><ActivityPage /></RoleRoute>}
            />
            <Route
              path="/locations"
              element={<RoleRoute allowedRoles={["OWNER"]}><LocationsPage /></RoleRoute>}
            />
            <Route
              path="/plan"
              element={<RoleRoute allowedRoles={["OWNER"]}><PlanPage /></RoleRoute>}
            />
            <Route
              path="/settings"
              element={<RoleRoute allowedRoles={["OWNER"]}><SettingsPage /></RoleRoute>}
            />
          </Route>
          <Route
            path="/admin"
            element={
              <PlatformAdminRoute>
                <AdminLayout />
              </PlatformAdminRoute>
            }
          >
            <Route index element={<AdminDashboardPage />} />
            <Route path="workspaces" element={<AdminWorkspacesPage />} />
            <Route path="workspaces/:id" element={<AdminWorkspaceDetailPage />} />
            <Route path="users" element={<AdminUsersPage />} />
            <Route path="users/:id" element={<AdminUserDetailPage />} />
            <Route path="activity" element={<AdminActivityPage />} />
            <Route path="plans" element={<AdminPlansPage />} />
            <Route path="coupons" element={<AdminCouponsPage />} />
            <Route path="subscriptions" element={<AdminSubscriptionsPage />} />
            <Route path="payments" element={<AdminPaymentsPage />} />
            <Route path="email-templates" element={<AdminEmailTemplatesPage />} />
            <Route path="email-logs" element={<AdminEmailLogsPage />} />
            <Route path="announcements" element={<AdminAnnouncementsPage />} />
            <Route path="system" element={<AdminSystemHealthPage />} />
            <Route path="inbox" element={<AdminInboxPage />} />
            <Route path="inbox/:id" element={<AdminTicketDetailPage />} />
            <Route path="team" element={<AdminTeamPage />} />
          </Route>
          <Route path="/" element={<LandingPage />} />
          <Route path="*" element={<DefaultRedirect />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}
