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
  locationReady: boolean;
  error: string | null;
  switchedLocation: boolean;
  setActiveLocationId: (locationId: string) => void;
  refreshLocations: () => Promise<void>;
  clearSwitchedLocation: () => void;
}

const LocationContext = createContext<LocationContextValue | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [locations, setLocations] = useState<Location[]>([]);
  const [activeLocationId, setActiveLocationIdState] = useState(getApiLocationId());
  const [loading, setLoading] = useState(false);
  const [locationReady, setLocationReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [switchedLocation, setSwitchedLocation] = useState(false);

  const activeLocation = useMemo(
    () => locations.find((location) => location.id === activeLocationId) ?? locations[0] ?? null,
    [activeLocationId, locations],
  );

  const setActiveLocationId = useCallback((locationId: string) => {
    setActiveLocationIdState(locationId);
    setApiLocationId(locationId);
  }, []);

  const clearSwitchedLocation = useCallback(() => setSwitchedLocation(false), []);

  const refreshLocations = useCallback(async () => {
    if (!isAuthenticated) {
      setLocations([]);
      setActiveLocationIdState("");
      setApiLocationId(null);
      setLocationReady(false);
      return;
    }

    setLoading(true);

    // Capture the previously stored location ID before clearing it.
    // Clearing the API client variable immediately ensures that any API calls
    // made by child components during this async fetch will NOT send a stale
    // x-location-id header. The server will fall back to ensureDefaultLocation().
    const priorId = getApiLocationId();
    setApiLocationId(null);

    try {
      const res = await getLocations();
      setLocations(res.locations);

      // Validate the prior location against the active locations for this workspace.
      const savedLocation = res.locations.find((loc) => loc.id === priorId);
      const mainBranch = res.locations.find((loc) => loc.name === "Main Branch");
      const nextLocation = savedLocation ?? mainBranch ?? res.locations[0] ?? null;

      if (nextLocation) {
        // If we had a location stored but it's no longer valid (archived or
        // belongs to a different workspace), emit the switched flag for the UI.
        if (priorId && priorId !== nextLocation.id) {
          setSwitchedLocation(true);
        }
        setActiveLocationIdState(nextLocation.id);
        setApiLocationId(nextLocation.id);
      } else {
        // No active locations found — clear everything cleanly.
        setActiveLocationIdState("");
        setApiLocationId(null);
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load locations");
    } finally {
      setLoading(false);
      setLocationReady(true);
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
        locationReady,
        error,
        switchedLocation,
        setActiveLocationId,
        refreshLocations,
        clearSwitchedLocation,
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
