import type {
  ExpiringSoonResponse,
  StockInInput,
  StockMovementFilters,
  StockMovementsResponse,
  StockOutInput,
  StockSummaryResponse,
  StockTransferInput,
} from "../types";
import { apiClient } from "./client";

export async function getStockSummary(): Promise<StockSummaryResponse> {
  return apiClient.get<StockSummaryResponse>("/stock/summary");
}

export async function getExpiringSoon(): Promise<ExpiringSoonResponse> {
  return apiClient.get<ExpiringSoonResponse>("/stock/expiring-soon");
}

export async function getStockMovements(
  filters: StockMovementFilters = {},
): Promise<StockMovementsResponse> {
  const params = new URLSearchParams();

  if (filters.itemId) params.set("itemId", filters.itemId);
  if (filters.type) params.set("type", filters.type);
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);

  const query = params.toString();
  return apiClient.get<StockMovementsResponse>(
    query ? `/stock/movements?${query}` : "/stock/movements",
  );
}

export async function stockIn(data: StockInInput): Promise<unknown> {
  return apiClient.post<unknown>("/stock/in", data, true);
}

export async function stockOut(data: StockOutInput): Promise<unknown> {
  return apiClient.post<unknown>("/stock/out", data, true);
}

export async function stockTransfer(data: StockTransferInput): Promise<unknown> {
  return apiClient.post<unknown>("/stock/transfer", data, true);
}
