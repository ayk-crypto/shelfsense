export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface LoginResponse {
  user: User;
  token: string;
}

export interface StockSummaryItem {
  itemId: string;
  itemName: string;
  unit: string;
  totalQuantity: number;
  minStockLevel: number;
  isLowStock: boolean;
  totalValue: number;
  nearestExpiryDate: string | null;
}

export interface StockSummaryResponse {
  summary: StockSummaryItem[];
}

export interface ExpiringBatch {
  id: string;
  quantity: number;
  remainingQuantity: number;
  expiryDate: string;
  unitCost: number | null;
  batchNo: string | null;
  supplierName: string | null;
  item: {
    id: string;
    name: string;
  };
}

export interface ExpiringSoonResponse {
  batches: ExpiringBatch[];
}
