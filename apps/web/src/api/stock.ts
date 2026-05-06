import type {
  ExpiringSoonResponse,
  OpeningStockInput,
  PriceHistoryResponse,
  StockInInput,
  StockMovementFilters,
  StockMovementsResponse,
  StockOutInput,
  StockSummaryResponse,
  StockTransferInput,
  StockTrendResponse,
  SupplierSuggestionResponse,
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

export async function addOpeningStock(data: OpeningStockInput): Promise<unknown> {
  return apiClient.post<unknown>("/stock/opening", data, true);
}

export async function stockOut(data: StockOutInput): Promise<unknown> {
  return apiClient.post<unknown>("/stock/out", data, true);
}

export async function stockTransfer(data: StockTransferInput): Promise<unknown> {
  return apiClient.post<unknown>("/stock/transfer", data, true);
}

export async function getSupplierSuggestion(itemId: string): Promise<SupplierSuggestionResponse> {
  return apiClient.get<SupplierSuggestionResponse>(`/stock/supplier-suggestion?itemId=${encodeURIComponent(itemId)}`);
}

export async function getPriceHistory(itemId: string, limit?: number): Promise<PriceHistoryResponse> {
  const params = new URLSearchParams({ itemId });
  if (limit) params.set("limit", String(limit));
  return apiClient.get<PriceHistoryResponse>(`/stock/price-history?${params.toString()}`);
}

export async function getStockTrend(days: number = 30): Promise<StockTrendResponse> {
  return apiClient.get<StockTrendResponse>(`/stock/trend?days=${days}`);
}
