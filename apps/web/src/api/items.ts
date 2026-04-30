import type { CreateItemInput, Item, ItemsResponse } from "../types";
import { apiClient } from "./client";

export async function getItems(): Promise<ItemsResponse> {
  return apiClient.get<ItemsResponse>("/items");
}

export async function createItem(data: CreateItemInput): Promise<{ item: Item }> {
  return apiClient.post<{ item: Item }>("/items", data, true);
}
