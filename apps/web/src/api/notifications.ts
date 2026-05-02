import type { Notification, NotificationsResponse } from "../types";
import { apiClient } from "./client";

export async function getNotifications(): Promise<NotificationsResponse> {
  return apiClient.get<NotificationsResponse>("/notifications");
}

export async function markNotificationRead(id: string): Promise<{ notification: Notification }> {
  return apiClient.patch<{ notification: Notification }>(`/notifications/${id}/read`, {});
}

export async function markAllNotificationsRead(): Promise<{ updatedCount: number }> {
  return apiClient.patch<{ updatedCount: number }>("/notifications/read-all", {});
}
