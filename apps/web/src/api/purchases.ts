import type {
  CreatePurchaseInput,
  CreatePurchaseResponse,
  PurchaseFilters,
  PurchaseResponse,
  PurchasesResponse,
  ReceivePurchaseInput,
  ReceivePurchaseResponse,
} from "../types";
import { apiClient } from "./client";

export async function getPurchases(filters: PurchaseFilters = {}): Promise<PurchasesResponse> {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.supplierId) params.set("supplierId", filters.supplierId);
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  if (filters.locationId) params.set("locationId", filters.locationId);

  const query = params.toString();
  return apiClient.get<PurchasesResponse>(query ? `/purchases?${query}` : "/purchases");
}

export async function createPurchase(data: CreatePurchaseInput): Promise<CreatePurchaseResponse> {
  return apiClient.post<CreatePurchaseResponse>("/purchases", data, true);
}

export async function getPurchase(id: string): Promise<PurchaseResponse> {
  return apiClient.get<PurchaseResponse>(`/purchases/${id}`);
}

export async function orderPurchase(id: string): Promise<PurchaseResponse> {
  return apiClient.post<PurchaseResponse>(`/purchases/${id}/order`, {}, true);
}

export async function cancelPurchase(id: string, reason?: string): Promise<PurchaseResponse> {
  return apiClient.post<PurchaseResponse>(`/purchases/${id}/cancel`, { reason }, true);
}

export async function receivePurchase(
  id: string,
  data: ReceivePurchaseInput,
): Promise<ReceivePurchaseResponse> {
  return apiClient.post<ReceivePurchaseResponse>(`/purchases/${id}/receive`, data, true);
}
