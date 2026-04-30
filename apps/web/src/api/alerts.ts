import type { AlertsResponse } from "../types";
import { apiClient } from "./client";

export async function getAlerts(): Promise<AlertsResponse> {
  return apiClient.get<AlertsResponse>("/alerts");
}
