import { apiClient } from "./client";
import type {
  AdminOverview,
  AdminWorkspacesResponse,
  AdminWorkspaceDetail,
  AdminUsersResponse,
  AdminUserDetail,
  AdminAuditLogsResponse,
} from "../types";

export function getAdminOverview(): Promise<AdminOverview> {
  return apiClient.get<AdminOverview>("/admin/overview");
}

export function getAdminWorkspaces(params: {
  page?: number;
  limit?: number;
  search?: string;
  plan?: string;
  status?: string;
} = {}): Promise<AdminWorkspacesResponse> {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.search) qs.set("search", params.search);
  if (params.plan) qs.set("plan", params.plan);
  if (params.status) qs.set("status", params.status);
  const q = qs.toString();
  return apiClient.get<AdminWorkspacesResponse>(`/admin/workspaces${q ? `?${q}` : ""}`);
}

export function getAdminWorkspace(id: string): Promise<AdminWorkspaceDetail> {
  return apiClient.get<AdminWorkspaceDetail>(`/admin/workspaces/${id}`);
}

export function updateWorkspaceStatus(id: string, suspended: boolean, reason?: string): Promise<{ ok: boolean; suspended: boolean }> {
  return apiClient.patch(`/admin/workspaces/${id}/status`, { suspended, reason });
}

export function updateWorkspacePlan(id: string, data: { plan?: string; trialEndsAt?: string | null; subscriptionStatus?: string | null }): Promise<{ ok: boolean }> {
  return apiClient.patch(`/admin/workspaces/${id}/plan`, data);
}

export function getAdminUsers(params: {
  page?: number;
  limit?: number;
  search?: string;
  verified?: string;
  disabled?: string;
} = {}): Promise<AdminUsersResponse> {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.search) qs.set("search", params.search);
  if (params.verified) qs.set("verified", params.verified);
  if (params.disabled) qs.set("disabled", params.disabled);
  const q = qs.toString();
  return apiClient.get<AdminUsersResponse>(`/admin/users${q ? `?${q}` : ""}`);
}

export function getAdminUser(id: string): Promise<AdminUserDetail> {
  return apiClient.get<AdminUserDetail>(`/admin/users/${id}`);
}

export function updateUserStatus(id: string, isDisabled: boolean): Promise<{ ok: boolean; isDisabled: boolean }> {
  return apiClient.patch(`/admin/users/${id}/status`, { isDisabled });
}

export function adminResendVerification(id: string): Promise<{ ok: boolean }> {
  return apiClient.post(`/admin/users/${id}/resend-verification`, {});
}

export function adminForcePasswordReset(id: string): Promise<{ ok: boolean }> {
  return apiClient.post(`/admin/users/${id}/force-password-reset`, {});
}

export function getAdminAuditLogs(params: { page?: number; limit?: number; action?: string } = {}): Promise<AdminAuditLogsResponse> {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.action) qs.set("action", params.action);
  const q = qs.toString();
  return apiClient.get<AdminAuditLogsResponse>(`/admin/audit-logs${q ? `?${q}` : ""}`);
}
