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

export interface Item {
  id: string;
  name: string;
  unit: string;
  minStockLevel: number;
  trackExpiry: boolean;
  sku: string | null;
  barcode: string | null;
  createdAt: string;
}

export interface ItemsResponse {
  items: Item[];
}

export interface CreateItemInput {
  name: string;
  unit: string;
  minStockLevel: number;
  trackExpiry: boolean;
}

export interface StockInInput {
  itemId: string;
  quantity: number;
  unitCost?: number;
  expiryDate?: string;
  supplierName?: string;
  note?: string;
}

export interface StockOutInput {
  itemId: string;
  quantity: number;
  reason?: string;
  note?: string;
}
