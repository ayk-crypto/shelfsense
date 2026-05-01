import type { AuditLogFilters, AuditLogsResponse } from "../types";
import { apiClient } from "./client";

export async function getAuditLogs(
  filters: AuditLogFilters = {},
): Promise<AuditLogsResponse> {
  const params = new URLSearchParams();

  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  if (filters.action) params.set("action", filters.action);

  const query = params.toString();
  return apiClient.get<AuditLogsResponse>(
    query ? `/audit-logs?${query}` : "/audit-logs",
  );
}
