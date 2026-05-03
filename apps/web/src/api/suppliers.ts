import type { CreateSupplierInput, Supplier, SuppliersResponse } from "../types";
import { apiClient } from "./client";

export async function getSuppliers(): Promise<SuppliersResponse> {
  return apiClient.get<SuppliersResponse>("/suppliers");
}

export async function createSupplier(data: CreateSupplierInput): Promise<{ supplier: Supplier }> {
  return apiClient.post<{ supplier: Supplier }>("/suppliers", data, true);
}

export async function updateSupplier(id: string, data: CreateSupplierInput): Promise<{ supplier: Supplier }> {
  return apiClient.patch<{ supplier: Supplier }>(`/suppliers/${id}`, data, true);
}

export async function deleteSupplier(id: string): Promise<{ success: boolean }> {
  return apiClient.delete<{ success: boolean }>(`/suppliers/${id}`, true);
}
