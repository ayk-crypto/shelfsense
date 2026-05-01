const API_BASE = import.meta.env.VITE_API_BASE_URL?.trim() || "/api";
const ACTIVE_LOCATION_KEY = "shelfsense_active_location_id";

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
  return localStorage.getItem("shelfsense_token");
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

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      (data as { error?: string; message?: string }).error ??
        (data as { error?: string; message?: string }).message ??
        "Request failed",
    );
  }

  return data as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown, auth = false) =>
    request<T>(path, { method: "POST", body, auth }),
  patch: <T>(path: string, body: unknown, auth = true) =>
    request<T>(path, { method: "PATCH", body, auth }),
};
