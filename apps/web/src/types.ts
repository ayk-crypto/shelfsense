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
  category: string | null;
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
  category?: string;
  barcode?: string;
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

export type StockMovementType =
  | "STOCK_IN"
  | "STOCK_OUT"
  | "WASTAGE"
  | "ADJUSTMENT";

export interface StockMovement {
  id: string;
  type: StockMovementType;
  quantity: number;
  unitCost: number | null;
  reason: string | null;
  note: string | null;
  createdAt: string;
  item: {
    id: string;
    name: string;
  };
}

export interface StockMovementsResponse {
  movements: StockMovement[];
}

export interface StockMovementFilters {
  itemId?: string;
  type?: StockMovementType;
  fromDate?: string;
  toDate?: string;
}

export interface LowStockAlert {
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  minStockLevel: number;
}

export interface ExpiryAlert {
  id: string;
  remainingQuantity: number;
  expiryDate: string;
  batchNo: string | null;
  item: {
    id: string;
    name: string;
    unit: string;
  };
}

export interface AlertsResponse {
  lowStock: LowStockAlert[];
  expiringSoon: ExpiryAlert[];
  expired: ExpiryAlert[];
}

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  createdAt: string;
}

export interface SuppliersResponse {
  suppliers: Supplier[];
}

export interface CreateSupplierInput {
  name: string;
  phone?: string;
  notes?: string;
}
