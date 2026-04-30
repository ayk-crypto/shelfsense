import type { ExpiringSoonResponse, StockSummaryResponse } from "../types";
import { apiClient } from "./client";

export async function getStockSummary(): Promise<StockSummaryResponse> {
  return apiClient.get<StockSummaryResponse>("/stock/summary");
}

export async function getExpiringSoon(): Promise<ExpiringSoonResponse> {
  return apiClient.get<ExpiringSoonResponse>("/stock/expiring-soon");
}
