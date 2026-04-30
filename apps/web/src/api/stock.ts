import type { ExpiringSoonResponse, StockInInput, StockOutInput, StockSummaryResponse } from "../types";
import { apiClient } from "./client";

export async function getStockSummary(): Promise<StockSummaryResponse> {
  return apiClient.get<StockSummaryResponse>("/stock/summary");
}

export async function getExpiringSoon(): Promise<ExpiringSoonResponse> {
  return apiClient.get<ExpiringSoonResponse>("/stock/expiring-soon");
}

export async function stockIn(data: StockInInput): Promise<unknown> {
  return apiClient.post<unknown>("/stock/in", data, true);
}

export async function stockOut(data: StockOutInput): Promise<unknown> {
  return apiClient.post<unknown>("/stock/out", data, true);
}
