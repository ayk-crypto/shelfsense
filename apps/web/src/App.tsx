import { Navigate, Route, BrowserRouter as Router, Routes } from "react-router-dom";
import { getOnboardingStatus } from "./api/onboarding";
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
import { PurchasesPage } from "./pages/PurchasesPage";
import { ReorderSuggestionsPage } from "./pages/ReorderSuggestionsPage";
import { ReportsPage } from "./pages/ReportsPage";
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
import type { OnboardingStatus } from "./types";
import type { Role } from "./types";
import "./App.css";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Navigate to="/dashboard" replace /> : <>{children}</>;
}

function WorkspaceRequiredRoute({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();

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

function OwnerOnboardingGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { settings, loading: settingsLoading, error: settingsError, setSettings } = useWorkspaceSettings();
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

  if (user?.role !== "OWNER") return <>{children}</>;

  if (loading || settingsLoading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Loading workspace setup...</p>
      </div>
    );
  }

  if (error || settingsError || !status) {
    return (
      <div className="page-error">
        <div className="alert alert--error">{error ?? settingsError ?? "Unable to load onboarding"}</div>
      </div>
    );
  }

  if (!status.onboardingCompleted) {
    return (
      <OnboardingPage
        settings={settings}
        status={status}
        onSettingsUpdated={setSettings}
        onComplete={() => setStatus((current) => current ? { ...current, onboardingCompleted: true } : current)}
      />
    );
  }

  return <>{children}</>;
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
            element={
              <ProtectedRoute>
                <WorkspaceRequiredRoute>
                  <WorkspaceSettingsProvider>
                    <OwnerOnboardingGate>
                      <LocationProvider>
                        <AppShell />
                      </LocationProvider>
                    </OwnerOnboardingGate>
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
              element={<RoleRoute allowedRoles={["OWNER"]}><ActivityPage /></RoleRoute>}
            />
            <Route
              path="/locations"
              element={<RoleRoute allowedRoles={["OWNER"]}><LocationsPage /></RoleRoute>}
            />
            <Route
              path="/settings"
              element={<RoleRoute allowedRoles={["OWNER"]}><SettingsPage /></RoleRoute>}
            />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}
