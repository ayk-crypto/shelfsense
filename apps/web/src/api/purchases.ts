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

export async function getOpenPurchases(): Promise<PurchasesResponse> {
  return apiClient.get<PurchasesResponse>("/purchases/open");
}

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

export async function patchPurchaseSupplier(id: string, supplierId: string): Promise<PurchaseResponse> {
  return apiClient.patch<PurchaseResponse>(`/purchases/${id}/supplier`, { supplierId });
}

export async function deletePurchase(id: string): Promise<{ success: boolean }> {
  return apiClient.delete<{ success: boolean }>(`/purchases/${id}`);
}

export async function bulkDeletePurchases(ids: string[]): Promise<{ deletedCount: number }> {
  return apiClient.post<{ deletedCount: number }>("/purchases/bulk-delete", { ids }, true);
}

export async function closePurchase(id: string): Promise<{ success: boolean }> {
  return apiClient.post<{ success: boolean }>(`/purchases/${id}/close`, {}, true);
}

export interface ClosePurchaseVarianceLine {
  purchaseItemId: string;
  action: "KEEP_PENDING" | "CLOSE_SHORT" | "CANCEL";
  reason?: string;
}

export interface ClosePurchaseWithVarianceInput {
  lines: ClosePurchaseVarianceLine[];
  globalReason?: string;
  closureNotes?: string;
  createNewDraft?: boolean;
}

export async function closePurchaseWithVariance(
  id: string,
  data: ClosePurchaseWithVarianceInput,
): Promise<{ purchase: import("../types").Purchase; newDraftId: string | null }> {
  return apiClient.post<{ purchase: import("../types").Purchase; newDraftId: string | null }>(
    `/purchases/${id}/close-with-variance`,
    data,
    true,
  );
}
