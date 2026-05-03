import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getWorkspaceSettings } from "../api/workspace";
import { useAuth } from "./AuthContext";
import type { WorkspaceSettings } from "../types";

const DEFAULT_SETTINGS: WorkspaceSettings = {
  id: "",
  name: "ShelfSense",
  currency: "PKR",
  lowStockMultiplier: 2,
  expiryAlertDays: 7,
  ownerPhone: null,
  notifyLowStock: true,
  notifyExpiringSoon: true,
  notifyExpired: true,
  whatsappAlertsEnabled: false,
  emailAlertsEnabled: false,
  pushAlertsEnabled: false,
};

interface WorkspaceSettingsContextValue {
  settings: WorkspaceSettings;
  loading: boolean;
  error: string | null;
  refreshSettings: () => Promise<void>;
  setSettings: (settings: WorkspaceSettings) => void;
}

const WorkspaceSettingsContext = createContext<WorkspaceSettingsContextValue | null>(null);

export function WorkspaceSettingsProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [settings, setSettings] = useState<WorkspaceSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshSettings = useCallback(async () => {
    if (!isAuthenticated) {
      setSettings(DEFAULT_SETTINGS);
      return;
    }

    setLoading(true);
    try {
      const res = await getWorkspaceSettings();
      setSettings(res.settings);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workspace settings");
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => { void refreshSettings(); }, [refreshSettings]);

  return (
    <WorkspaceSettingsContext.Provider
      value={{ settings, loading, error, refreshSettings, setSettings }}
    >
      {children}
    </WorkspaceSettingsContext.Provider>
  );
}

export function useWorkspaceSettings() {
  const ctx = useContext(WorkspaceSettingsContext);
  if (!ctx) {
    throw new Error("useWorkspaceSettings must be used within WorkspaceSettingsProvider");
  }
  return ctx;
}
