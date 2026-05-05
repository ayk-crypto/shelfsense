import { apiClient } from "./client";

export interface CustomerAnnouncement {
  id: string;
  title: string;
  message: string;
  severity: "INFO" | "SUCCESS" | "WARNING" | "CRITICAL";
  dismissible: boolean;
  createdAt: string;
}

export function getActiveAnnouncements(): Promise<{ announcements: CustomerAnnouncement[] }> {
  return apiClient.get("/announcements/active");
}
