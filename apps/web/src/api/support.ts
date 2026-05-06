import { apiClient } from "./client";
import type { SupportTicket, SupportTicketsResponse, SupportMessage } from "../types";

interface TicketWithMessages extends SupportTicket {
  messages: SupportMessage[];
}

export function getMyTickets(params: {
  page?: number;
  limit?: number;
  status?: string;
  category?: string;
} = {}): Promise<SupportTicketsResponse> {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.status) qs.set("status", params.status);
  if (params.category) qs.set("category", params.category);
  const q = qs.toString();
  return apiClient.get(`/support/tickets${q ? `?${q}` : ""}`);
}

export function createSupportTicket(data: {
  subject: string;
  message: string;
  category?: string;
}): Promise<{ ticket: SupportTicket }> {
  return apiClient.post("/support/tickets", data);
}

export function getMyTicket(id: string): Promise<{ ticket: TicketWithMessages }> {
  return apiClient.get(`/support/tickets/${id}`);
}

export function replyToTicket(
  id: string,
  message: string,
): Promise<{ message: SupportMessage }> {
  return apiClient.post(`/support/tickets/${id}/reply`, { message });
}
