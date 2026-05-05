import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AUTH_EXPIRED_EVENT, clearStoredLocation } from "../api/client";
import { getMe } from "../api/auth";
import type { User } from "../types";

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
  saveAuth: (user: User, token: string) => void;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = "shelfsense_token";
const USER_KEY = "shelfsense_user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => {
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const userJson = localStorage.getItem(USER_KEY);
      if (token && userJson) {
        return { token, user: JSON.parse(userJson) as User, isAuthenticated: true };
      }
    } catch {
      // ignore
    }
    return { token: null, user: null, isAuthenticated: false };
  });

  const saveAuth = useCallback((user: User, token: string) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    setState({ user, token, isAuthenticated: true });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    clearStoredLocation();
    setState({ user: null, token: null, isAuthenticated: false });
  }, []);

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    try {
      const { user } = await getMe();
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      setState((prev) => ({ ...prev, user }));
    } catch {
      // If the token is invalid, the 401 handler in apiClient will fire
      // AUTH_EXPIRED_EVENT which will call logout automatically.
    }
  }, []);

  useEffect(() => {
    window.addEventListener(AUTH_EXPIRED_EVENT, logout);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, logout);
  }, [logout]);

  // On mount, refresh user data from the server so stale localStorage values
  // (e.g. emailVerified: false after the user has since verified) are corrected.
  useEffect(() => {
    if (state.isAuthenticated) {
      void refreshUser();
    }
    // Only run once on mount — no deps needed beyond the initial auth check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, saveAuth, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
