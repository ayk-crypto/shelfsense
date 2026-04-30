import type { CreatePurchaseInput, CreatePurchaseResponse, PurchasesResponse } from "../types";
import { apiClient } from "./client";

export async function getPurchases(): Promise<PurchasesResponse> {
  return apiClient.get<PurchasesResponse>("/purchases");
}

export async function createPurchase(data: CreatePurchaseInput): Promise<CreatePurchaseResponse> {
  return apiClient.post<CreatePurchaseResponse>("/purchases", data, true);
}
