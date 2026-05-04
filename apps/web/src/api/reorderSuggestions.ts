import type {
  CreateReorderPurchasesInput,
  CreateReorderPurchasesResponse,
  ReorderSuggestionsResponse,
} from "../types";
import { apiClient } from "./client";

export async function getReorderSuggestions(): Promise<ReorderSuggestionsResponse> {
  return apiClient.get<ReorderSuggestionsResponse>("/reorder-suggestions");
}

export async function createReorderPurchases(
  data: CreateReorderPurchasesInput,
): Promise<CreateReorderPurchasesResponse> {
  return apiClient.post<CreateReorderPurchasesResponse>("/reorder-suggestions/create-purchases", data, true);
}
