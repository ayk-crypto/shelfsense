import { apiClient } from "./client";

export type CostUnitStatus = "READY" | "MISSING_CONVERSION" | "MISSING_COST";
export type CostUnitSourceType = "PO" | "DIRECT" | "NONE";

export interface CostUnitLastPurchase {
  batchId: string;
  date: string;
  sourceType: CostUnitSourceType;
  purchaseId: string | null;
  poReference: string | null;
  supplierId: string | null;
  supplierName: string | null;
  receivedQuantity: number | null;
  receivedUnit: string | null;
  storedBaseQuantity: number;
  baseUnitCost: number | null;
  purchaseUnitCost: number | null;
}

export interface CostUnitItem {
  itemId: string;
  name: string;
  category: string | null;
  storageUnit: string;
  purchaseUnit: string | null;
  conversionFactor: number | null;
  issueUnit: string | null;
  currentStorageQuantity: number;
  currentPurchaseEquivalent: number;
  storageUnitCost: number | null;
  purchaseUnitCost: number | null;
  status: CostUnitStatus;
  lastPurchase: CostUnitLastPurchase | null;
}

export interface CostUnitsResponse {
  locationId: string;
  items: CostUnitItem[];
}

export async function getCostUnits(): Promise<CostUnitsResponse> {
  return apiClient.get<CostUnitsResponse>("/cost-units");
}

export async function correctLatestStorageUnitCost(
  itemId: string,
  unitCost: number,
  reason?: string,
): Promise<{ success: boolean; batchId: string; previousCost: number | null; unitCost: number }> {
  return apiClient.patch(`/cost-units/items/${encodeURIComponent(itemId)}/latest-cost`, {
    unitCost,
    reason,
  });
}
