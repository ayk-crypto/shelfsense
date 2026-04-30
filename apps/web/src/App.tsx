import { Navigate, Route, BrowserRouter as Router, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { AlertsPage } from "./pages/AlertsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ItemsPage } from "./pages/ItemsPage";
import { LoginPage } from "./pages/LoginPage";
import { MovementsPage } from "./pages/MovementsPage";
import { SuppliersPage } from "./pages/SuppliersPage";
import "./App.css";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Navigate to="/dashboard" replace /> : <>{children}</>;
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
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/items" element={<ItemsPage />} />
            <Route path="/movements" element={<MovementsPage />} />
            <Route path="/suppliers" element={<SuppliersPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}
