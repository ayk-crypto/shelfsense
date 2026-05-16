import { apiClient } from "./client";
import type { PhysicalCountSettings } from "../types";

export async function getPhysicalCountSettings(): Promise<{ settings: PhysicalCountSettings | null }> {
  return apiClient.get<{ settings: PhysicalCountSettings | null }>("/physical-count-settings");
}

export async function updatePhysicalCountSettings(data: {
  enabled?: boolean;
  frequencyType?: string;
  customIntervalNumber?: number | null;
  customIntervalUnit?: string | null;
  reminderLeadDays?: number;
}): Promise<{ settings: PhysicalCountSettings }> {
  return apiClient.patch<{ settings: PhysicalCountSettings }>("/physical-count-settings", data);
}
