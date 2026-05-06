import type {
  SaveStockCountInput,
  StockCountResponse,
  StockCountsResponse,
  StockCountStatus,
  StockCountStockResponse,
} from "../types";
import { apiClient } from "./client";

export async function getStockCountStock(locationId: string): Promise<StockCountStockResponse> {
  return apiClient.get<StockCountStockResponse>(
    `/stock-counts/stock?locationId=${encodeURIComponent(locationId)}`,
  );
}

export async function getStockCounts(status?: StockCountStatus): Promise<StockCountsResponse> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiClient.get<StockCountsResponse>(`/stock-counts${query}`);
}

export async function getStockCount(id: string): Promise<StockCountResponse> {
  return apiClient.get<StockCountResponse>(`/stock-counts/${encodeURIComponent(id)}`);
}

export async function createStockCount(data: SaveStockCountInput): Promise<StockCountResponse> {
  return apiClient.post<StockCountResponse>("/stock-counts", data, true);
}

export async function updateStockCount(id: string, data: SaveStockCountInput): Promise<StockCountResponse> {
  return apiClient.patch<StockCountResponse>(`/stock-counts/${encodeURIComponent(id)}`, data, true);
}

export async function finalizeStockCount(id: string): Promise<StockCountResponse> {
  return apiClient.post<StockCountResponse>(`/stock-counts/${encodeURIComponent(id)}/finalize`, {}, true);
}

export async function returnForRecount(id: string, managerComment?: string): Promise<StockCountResponse> {
  return apiClient.post<StockCountResponse>(
    `/stock-counts/${encodeURIComponent(id)}/return-for-recount`,
    { managerComment },
    true,
  );
}

export async function rejectStockCount(id: string, managerComment?: string): Promise<StockCountResponse> {
  return apiClient.post<StockCountResponse>(
    `/stock-counts/${encodeURIComponent(id)}/reject`,
    { managerComment },
    true,
  );
}
