import type { CreateSupplierInput, Supplier, SuppliersResponse } from "../types";
import { apiClient } from "./client";

export async function getSuppliers(): Promise<SuppliersResponse> {
  return apiClient.get<SuppliersResponse>("/suppliers");
}

export async function createSupplier(data: CreateSupplierInput): Promise<{ supplier: Supplier }> {
  return apiClient.post<{ supplier: Supplier }>("/suppliers", data, true);
}
