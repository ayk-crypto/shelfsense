import type {
  BulkAssignSupplierRequest,
  BulkAssignSupplierResponse,
  BulkRemoveSupplierRequest,
  BulkRemoveSupplierResponse,
  ItemSupplierInfo,
  ItemSupplierMapping,
  SupplierMappingsResponse,
} from "../types";
import { apiClient } from "./client";

export interface SupplierMappingFilters {
  search?: string;
  categoryId?: string;
  supplierId?: string;
  hasSupplier?: boolean;
}

export async function getSupplierMappings(
  filters: SupplierMappingFilters = {},
): Promise<SupplierMappingsResponse> {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.supplierId) params.set("supplierId", filters.supplierId);
  if (filters.hasSupplier !== undefined)
    params.set("hasSupplier", String(filters.hasSupplier));
  const qs = params.toString();
  return apiClient.get<SupplierMappingsResponse>(
    `/items/supplier-mappings${qs ? `?${qs}` : ""}`,
  );
}

export async function bulkAssignSupplier(
  data: BulkAssignSupplierRequest,
): Promise<BulkAssignSupplierResponse> {
  return apiClient.post<BulkAssignSupplierResponse>(
    "/items/bulk-assign-supplier",
    data,
  );
}

export async function bulkRemoveSupplier(
  data: BulkRemoveSupplierRequest,
): Promise<BulkRemoveSupplierResponse> {
  return apiClient.post<BulkRemoveSupplierResponse>(
    "/items/bulk-remove-supplier",
    data,
  );
}

export async function getItemSuppliers(
  itemId: string,
): Promise<{ suppliers: ItemSupplierMapping[] }> {
  return apiClient.get<{ suppliers: ItemSupplierMapping[] }>(
    `/items/${encodeURIComponent(itemId)}/suppliers`,
  );
}

export async function putItemSuppliers(
  itemId: string,
  mappings: Array<{
    supplierId: string;
    role: "PRIMARY" | "ALTERNATE";
    supplierItemCode?: string | null;
    preferredPurchaseUnit?: string | null;
    minimumOrderQuantity?: number | null;
  }>,
): Promise<{ suppliers: ItemSupplierMapping[] }> {
  return apiClient.patch<{ suppliers: ItemSupplierMapping[] }>(
    `/items/${encodeURIComponent(itemId)}/suppliers`,
    { mappings },
  );
}

export function buildSupplierMappingMap(
  infos: ItemSupplierInfo[],
): Map<string, ItemSupplierInfo> {
  return new Map(infos.map((info) => [info.itemId, info]));
}
