import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getLocations } from "../api/locations";
import { getApiLocationId, setApiLocationId } from "../api/client";
import { useAuth } from "./AuthContext";
import type { Location } from "../types";

interface LocationContextValue {
  locations: Location[];
  activeLocation: Location | null;
  activeLocationId: string;
  loading: boolean;
  error: string | null;
  setActiveLocationId: (locationId: string) => void;
  refreshLocations: () => Promise<void>;
}

const LocationContext = createContext<LocationContextValue | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [locations, setLocations] = useState<Location[]>([]);
  const [activeLocationId, setActiveLocationIdState] = useState(getApiLocationId());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeLocation = useMemo(
    () => locations.find((location) => location.id === activeLocationId) ?? locations[0] ?? null,
    [activeLocationId, locations],
  );

  const setActiveLocationId = useCallback((locationId: string) => {
    setActiveLocationIdState(locationId);
    setApiLocationId(locationId);
  }, []);

  const refreshLocations = useCallback(async () => {
    if (!isAuthenticated) {
      setLocations([]);
      setActiveLocationIdState("");
      setApiLocationId(null);
      return;
    }

    setLoading(true);
    try {
      const res = await getLocations();
      setLocations(res.locations);

      const savedLocationId = getApiLocationId();
      const savedLocation = res.locations.find((location) => location.id === savedLocationId);
      const mainBranch = res.locations.find((location) => location.name === "Main Branch");
      const nextLocation = savedLocation ?? mainBranch ?? res.locations[0] ?? null;

      if (nextLocation) {
        setActiveLocationIdState(nextLocation.id);
        setApiLocationId(nextLocation.id);
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load locations");
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => { void refreshLocations(); }, [refreshLocations]);

  return (
    <LocationContext.Provider
      value={{
        locations,
        activeLocation,
        activeLocationId: activeLocation?.id ?? activeLocationId,
        loading,
        error,
        setActiveLocationId,
        refreshLocations,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) {
    throw new Error("useLocation must be used within LocationProvider");
  }
  return ctx;
}
