import { apiClient } from "./client";
import type {
  AdminOverview,
  AdminWorkspacesResponse,
  AdminWorkspaceDetail,
  AdminUsersResponse,
  AdminUsersStats,
  AdminWorkspacesStats,
  AdminUserDetail,
  AdminAuditLogsResponse,
  AdminPlan,
  AdminCoupon,
  AdminSubscription,
  AdminSubscriptionsResponse,
  AdminPayment,
  AdminPaymentsResponse,
  AdminEmailTemplate,
  AdminEmailLog,
  AdminEmailLogsResponse,
  AdminAnnouncement,
  AdminSystemHealth,
} from "../types";

function qs(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") q.set(k, String(v));
  }
  return q.toString() ? `?${q.toString()}` : "";
}

// ── Overview ────────────────────────────────────────────────────────────────

export function getAdminOverview(): Promise<AdminOverview> {
  return apiClient.get<AdminOverview>("/admin/overview");
}

// ── Workspaces ───────────────────────────────────────────────────────────────

export function getAdminWorkspacesStats(): Promise<{ stats: AdminWorkspacesStats }> {
  return apiClient.get<{ stats: AdminWorkspacesStats }>("/admin/workspaces/stats");
}

export function getAdminWorkspaces(params: {
  page?: number; limit?: number; search?: string; plan?: string; status?: string;
} = {}): Promise<AdminWorkspacesResponse> {
  return apiClient.get<AdminWorkspacesResponse>(`/admin/workspaces${qs(params)}`);
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

export function createWorkspaceSubscription(workspaceId: string, data: Record<string, unknown>): Promise<{ subscription: AdminSubscription }> {
  return apiClient.post(`/admin/workspaces/${workspaceId}/subscription`, data);
}

export function updateWorkspaceSubscription(workspaceId: string, data: Record<string, unknown>): Promise<{ subscription: AdminSubscription }> {
  return apiClient.patch(`/admin/workspaces/${workspaceId}/subscription`, data);
}

export function applyWorkspaceCoupon(workspaceId: string, couponCode: string): Promise<{ ok: boolean }> {
  return apiClient.post(`/admin/workspaces/${workspaceId}/apply-coupon`, { couponCode });
}

export function removeWorkspaceCoupon(workspaceId: string): Promise<{ ok: boolean }> {
  return apiClient.post(`/admin/workspaces/${workspaceId}/remove-coupon`, {});
}

// ── Users ────────────────────────────────────────────────────────────────────

export function getAdminUsersStats(): Promise<{ stats: AdminUsersStats }> {
  return apiClient.get<{ stats: AdminUsersStats }>("/admin/users/stats");
}

export function getAdminUsers(params: {
  page?: number;
  limit?: number;
  search?: string;
  verified?: string;
  disabled?: string;
  role?: string;
  plan?: string;
  subscriptionStatus?: string;
  includePlatformAdmins?: string;
} = {}): Promise<AdminUsersResponse> {
  return apiClient.get<AdminUsersResponse>(`/admin/users${qs(params)}`);
}

export function getAdminUser(id: string): Promise<AdminUserDetail> {
  return apiClient.get<AdminUserDetail>(`/admin/users/${id}`);
}

export function getAdminTeam(): Promise<{ members: import("../types").AdminUser[] }> {
  return apiClient.get("/admin/team");
}

export function updateUserPlatformRole(
  id: string,
  role: "SUPER_ADMIN" | "SUPPORT_ADMIN" | "USER",
): Promise<{ ok: boolean; role: string }> {
  return apiClient.patch(`/admin/users/${id}/platform-role`, { role });
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

// ── Audit Logs ───────────────────────────────────────────────────────────────

export function getAdminAuditLogs(params: { page?: number; limit?: number; action?: string } = {}): Promise<AdminAuditLogsResponse> {
  return apiClient.get<AdminAuditLogsResponse>(`/admin/audit-logs${qs(params)}`);
}

// ── Plans ─────────────────────────────────────────────────────────────────────

export function getAdminPlans(): Promise<{ plans: AdminPlan[] }> {
  return apiClient.get("/admin/plans");
}

export function getAdminPlan(id: string): Promise<{ plan: AdminPlan }> {
  return apiClient.get(`/admin/plans/${id}`);
}

export function createAdminPlan(data: Record<string, unknown>): Promise<{ plan: AdminPlan }> {
  return apiClient.post("/admin/plans", data);
}

export function updateAdminPlan(id: string, data: Record<string, unknown>): Promise<{ plan: AdminPlan }> {
  return apiClient.patch(`/admin/plans/${id}`, data);
}

export function updateAdminPlanStatus(id: string, isActive: boolean): Promise<{ ok: boolean; isActive: boolean }> {
  return apiClient.patch(`/admin/plans/${id}/status`, { isActive });
}

// ── Coupons ───────────────────────────────────────────────────────────────────

export function getAdminCoupons(params: { page?: number; active?: string } = {}): Promise<{ coupons: AdminCoupon[] }> {
  return apiClient.get(`/admin/coupons${qs(params)}`);
}

export function createAdminCoupon(data: Record<string, unknown>): Promise<{ coupon: AdminCoupon }> {
  return apiClient.post("/admin/coupons", data);
}

export function updateAdminCoupon(id: string, data: Record<string, unknown>): Promise<{ coupon: AdminCoupon }> {
  return apiClient.patch(`/admin/coupons/${id}`, data);
}

export function updateAdminCouponStatus(id: string, isActive: boolean): Promise<{ ok: boolean; isActive: boolean }> {
  return apiClient.patch(`/admin/coupons/${id}/status`, { isActive });
}

// ── Subscriptions ─────────────────────────────────────────────────────────────

export function getAdminSubscriptions(params: { page?: number; limit?: number; status?: string; search?: string } = {}): Promise<AdminSubscriptionsResponse> {
  return apiClient.get(`/admin/subscriptions${qs(params)}`);
}

export function getAdminSubscription(id: string): Promise<{ subscription: AdminSubscription }> {
  return apiClient.get(`/admin/subscriptions/${id}`);
}

export function updateAdminSubscription(id: string, data: Record<string, unknown>): Promise<{ subscription: AdminSubscription }> {
  return apiClient.patch(`/admin/subscriptions/${id}`, data);
}

export function activateAdminSubscription(id: string, data: { billingCycle: string; expiryDate?: string }): Promise<{ subscription: AdminSubscription; ok: boolean }> {
  return apiClient.post(`/admin/subscriptions/${id}/activate`, data);
}

// ── Payments ──────────────────────────────────────────────────────────────────

export function getAdminPayments(params: { page?: number; limit?: number; status?: string; workspaceId?: string } = {}): Promise<AdminPaymentsResponse> {
  return apiClient.get(`/admin/payments${qs(params)}`);
}

export function createAdminPayment(data: Record<string, unknown>): Promise<{ payment: AdminPayment }> {
  return apiClient.post("/admin/payments", data);
}

export function updateAdminPayment(id: string, data: Record<string, unknown>): Promise<{ payment: AdminPayment }> {
  return apiClient.patch(`/admin/payments/${id}`, data);
}

export function markAdminPaymentPaid(id: string): Promise<{ payment: AdminPayment; ok: boolean }> {
  return apiClient.post(`/admin/payments/${id}/mark-paid`, {});
}

// ── Email Templates ───────────────────────────────────────────────────────────

export function getAdminEmailTemplates(): Promise<{ templates: AdminEmailTemplate[] }> {
  return apiClient.get("/admin/email-templates");
}

export function getAdminEmailTemplate(key: string): Promise<{ template: AdminEmailTemplate }> {
  return apiClient.get(`/admin/email-templates/${key}`);
}

export function updateAdminEmailTemplate(key: string, data: Partial<AdminEmailTemplate>): Promise<{ template: AdminEmailTemplate }> {
  return apiClient.patch(`/admin/email-templates/${key}`, data);
}

export function resetAdminEmailTemplate(key: string): Promise<{ template: AdminEmailTemplate }> {
  return apiClient.post(`/admin/email-templates/${key}/reset`, {});
}

export function testAdminEmailTemplate(key: string, testEmail?: string): Promise<{ ok: boolean; sentTo: string }> {
  return apiClient.post(`/admin/email-templates/${key}/test`, { testEmail });
}

// ── Email Logs ────────────────────────────────────────────────────────────────

export function getAdminEmailLogs(params: { page?: number; limit?: number; status?: string; type?: string; search?: string } = {}): Promise<AdminEmailLogsResponse> {
  return apiClient.get(`/admin/system/email-logs${qs(params)}`);
}

// ── Announcements ─────────────────────────────────────────────────────────────

export function getAdminAnnouncements(params: { active?: string } = {}): Promise<{ announcements: AdminAnnouncement[] }> {
  return apiClient.get(`/admin/announcements${qs(params)}`);
}

export function createAdminAnnouncement(data: Record<string, unknown>): Promise<{ announcement: AdminAnnouncement }> {
  return apiClient.post("/admin/announcements", data);
}

export function updateAdminAnnouncement(id: string, data: Record<string, unknown>): Promise<{ announcement: AdminAnnouncement }> {
  return apiClient.patch(`/admin/announcements/${id}`, data);
}

export function updateAdminAnnouncementStatus(id: string, isActive: boolean): Promise<{ ok: boolean; isActive: boolean }> {
  return apiClient.patch(`/admin/announcements/${id}/status`, { isActive });
}

// ── System Health ─────────────────────────────────────────────────────────────

export function getAdminSystemHealth(): Promise<{ health: AdminSystemHealth }> {
  return apiClient.get("/admin/system/health");
}

// ── Support Desk ──────────────────────────────────────────────────────────────

import type {
  SupportTicketsResponse,
  SupportTicketDetail,
  SupportTicket,
  SupportMessage,
  SupportInternalNote,
} from "../types";

export function getSupportTickets(params: {
  page?: number; limit?: number; status?: string; priority?: string;
  source?: string; category?: string; search?: string; workspaceId?: string; assignedToUserId?: string;
} = {}): Promise<SupportTicketsResponse> {
  return apiClient.get(`/admin/support/tickets${qs(params)}`);
}

export function getSupportTicket(id: string): Promise<{ ticket: SupportTicketDetail }> {
  return apiClient.get(`/admin/support/tickets/${id}`);
}

export function replySupportTicket(id: string, data: { bodyText: string; bodyHtml?: string }): Promise<{ message: SupportMessage }> {
  return apiClient.post(`/admin/support/tickets/${id}/reply`, data);
}

export function updateTicketStatus(id: string, status: string): Promise<{ ticket: SupportTicket }> {
  return apiClient.patch(`/admin/support/tickets/${id}/status`, { status });
}

export function updateTicketPriority(id: string, priority: string): Promise<{ ticket: SupportTicket }> {
  return apiClient.patch(`/admin/support/tickets/${id}/priority`, { priority });
}

export function updateTicketCategory(id: string, category: string | null): Promise<{ ticket: SupportTicket }> {
  return apiClient.patch(`/admin/support/tickets/${id}/category`, { category });
}

export function addTicketNote(id: string, note: string): Promise<{ note: SupportInternalNote }> {
  return apiClient.post(`/admin/support/tickets/${id}/notes`, { note });
}

export function assignTicket(id: string, assignedToUserId: string | null): Promise<{ ticket: SupportTicket }> {
  return apiClient.patch(`/admin/support/tickets/${id}/assign`, { assignedToUserId });
}

export function getAdminNotificationsSummary(): Promise<import("../types").AdminNotificationSummary> {
  return apiClient.get("/admin/support/summary");
}
