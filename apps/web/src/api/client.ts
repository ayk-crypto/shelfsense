const API_BASE = import.meta.env.VITE_API_BASE_URL?.trim() || "/api";
const TOKEN_KEY = "shelfsense_token";
const USER_KEY = "shelfsense_user";
export const AUTH_EXPIRED_EVENT = "shelfsense:auth-expired";

const LOCATION_KEY_LEGACY = "shelfsense_active_location_id";
const LOCATION_KEY_PREFIX = "shelfsense:loc:";

let _workspaceId = "";
let activeLocationId = localStorage.getItem(LOCATION_KEY_LEGACY) || "";

export function setCurrentWorkspaceId(workspaceId: string) {
  _workspaceId = workspaceId;
  if (!workspaceId) {
    activeLocationId = "";
    return;
  }

  const wsKey = LOCATION_KEY_PREFIX + workspaceId;
  const wsStored = localStorage.getItem(wsKey);
  if (wsStored) {
    activeLocationId = wsStored;
    return;
  }

  const legacyStored = localStorage.getItem(LOCATION_KEY_LEGACY);
  if (legacyStored) {
    activeLocationId = legacyStored;
    localStorage.setItem(wsKey, legacyStored);
  } else {
    activeLocationId = "";
  }
}

export function setApiLocationId(locationId: string | null) {
  activeLocationId = locationId ?? "";

  if (_workspaceId) {
    const wsKey = LOCATION_KEY_PREFIX + _workspaceId;
    if (activeLocationId) {
      localStorage.setItem(wsKey, activeLocationId);
    } else {
      localStorage.removeItem(wsKey);
    }
  } else {
    if (activeLocationId) {
      localStorage.setItem(LOCATION_KEY_LEGACY, activeLocationId);
    } else {
      localStorage.removeItem(LOCATION_KEY_LEGACY);
    }
  }
}

export function getApiLocationId() {
  return activeLocationId;
}

export function clearStoredLocation() {
  activeLocationId = "";
  if (_workspaceId) {
    localStorage.removeItem(LOCATION_KEY_PREFIX + _workspaceId);
  }
  localStorage.removeItem(LOCATION_KEY_LEGACY);
  _workspaceId = "";
}

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (auth) {
    const token = getToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  if (activeLocationId) {
    headers["x-location-id"] = activeLocationId;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(
      navigator.onLine
        ? "Unable to reach the ShelfSense server. Please try again in a moment."
        : "You appear offline. Reconnect to the internet to refresh ShelfSense data.",
    );
  }

  const data = await parseJsonResponse(res);

  if (res.status === 401 && auth) {
    clearStoredAuth();
  }

  if (!res.ok) {
    const apiMessage =
      (data as { error?: string; message?: string }).error ??
      (data as { error?: string; message?: string }).message ??
      "Request failed";
    const requestId = res.headers.get("x-request-id");
    const err = new Error(apiMessage) as Error & { requestId?: string; status?: number };
    err.requestId = requestId ?? undefined;
    err.status = res.status;
    throw err;
  }

  return data as T;
}

function clearStoredAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  clearStoredLocation();
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}

async function parseJsonResponse(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown, auth = true) =>
    request<T>(path, { method: "POST", body, auth }),
  patch: <T>(path: string, body: unknown, auth = true) =>
    request<T>(path, { method: "PATCH", body, auth }),
  delete: <T = void>(path: string, auth = true) =>
    request<T>(path, { method: "DELETE", auth }),
};
