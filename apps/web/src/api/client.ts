const API_BASE = import.meta.env.VITE_API_BASE_URL?.trim() || "/api";
const ACTIVE_LOCATION_KEY = "shelfsense_active_location_id";
const TOKEN_KEY = "shelfsense_token";
const USER_KEY = "shelfsense_user";
export const AUTH_EXPIRED_EVENT = "shelfsense:auth-expired";

let activeLocationId = localStorage.getItem(ACTIVE_LOCATION_KEY) || "";

export function setApiLocationId(locationId: string | null) {
  activeLocationId = locationId ?? "";

  if (activeLocationId) {
    localStorage.setItem(ACTIVE_LOCATION_KEY, activeLocationId);
  } else {
    localStorage.removeItem(ACTIVE_LOCATION_KEY);
  }
}

export function getApiLocationId() {
  return activeLocationId;
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
    throw new Error(
      (data as { error?: string; message?: string }).error ??
        (data as { error?: string; message?: string }).message ??
        "Request failed",
    );
  }

  return data as T;
}

function clearStoredAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
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
  post: <T>(path: string, body: unknown, auth = false) =>
    request<T>(path, { method: "POST", body, auth }),
  patch: <T>(path: string, body: unknown, auth = true) =>
    request<T>(path, { method: "PATCH", body, auth }),
  delete: <T = void>(path: string, auth = true) =>
    request<T>(path, { method: "DELETE", auth }),
};
