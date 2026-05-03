import type { CreateItemInput, Item, ItemsResponse } from "../types";
import { apiClient } from "./client";

type UpdateItemInput = Partial<Omit<CreateItemInput, "category" | "sku" | "barcode">> & {
  category?: string | null;
  sku?: string | null;
  barcode?: string | null;
};

export async function getItems(includeArchived = false): Promise<ItemsResponse> {
  return apiClient.get<ItemsResponse>(`/items${includeArchived ? "?includeArchived=true" : ""}`);
}

export async function createItem(data: CreateItemInput): Promise<{ item: Item }> {
  return apiClient.post<{ item: Item }>("/items", data, true);
}

export async function updateItem(
  id: string,
  data: UpdateItemInput,
): Promise<{ item: Item }> {
  return apiClient.patch<{ item: Item }>(`/items/${id}`, data, true);
}

export async function archiveItem(id: string): Promise<void> {
  await apiClient.delete(`/items/${id}`);
}

export async function reactivateItem(id: string): Promise<{ item: Item }> {
  return apiClient.patch<{ item: Item }>(`/items/${id}/reactivate`, {}, true);
}
