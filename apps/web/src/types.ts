export type Role = "OWNER" | "MANAGER" | "OPERATOR";

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  workspaceId?: string | null;
  role?: Role | null;
}

export interface LoginResponse {
  user: User;
  token: string;
}

export interface TeamMember {
  userId: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  deactivatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeamResponse {
  members: TeamMember[];
}

export interface CreateTeamUserInput {
  name: string;
  email: string;
  password: string;
  role: "MANAGER" | "OPERATOR";
}

export interface CreateTeamUserResponse {
  user: TeamMember;
}

export interface WorkspaceSettings {
  id: string;
  name: string;
  currency: string;
  lowStockMultiplier: number;
  expiryAlertDays: number;
  ownerPhone: string | null;
  notifyLowStock: boolean;
  notifyExpiringSoon: boolean;
  notifyExpired: boolean;
  whatsappAlertsEnabled: boolean;
  emailAlertsEnabled: boolean;
  pushAlertsEnabled: boolean;
}

export interface WorkspaceSettingsResponse {
  settings: WorkspaceSettings;
}

export interface OnboardingStatus {
  onboardingCompleted: boolean;
  hasItems: boolean;
  hasSuppliers: boolean;
  hasLocations: boolean;
}

export interface OnboardingStatusResponse extends OnboardingStatus {}

export interface CompleteOnboardingResponse {
  onboardingCompleted: boolean;
}

export interface UpdateWorkspaceSettingsInput {
  name?: string;
  currency?: string;
  lowStockMultiplier?: number;
  expiryAlertDays?: number;
  ownerPhone?: string | null;
  notifyLowStock?: boolean;
  notifyExpiringSoon?: boolean;
  notifyExpired?: boolean;
  whatsappAlertsEnabled?: boolean;
  emailAlertsEnabled?: boolean;
  pushAlertsEnabled?: boolean;
}

export interface Location {
  id: string;
  name: string;
  workspaceId: string;
  isActive: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocationsResponse {
  locations: Location[];
}

export interface CreateLocationInput {
  name: string;
}

export interface CreateLocationResponse {
  location: Location;
}

export interface AuditLog {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  meta: Record<string, unknown>;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
}

export interface AuditLogsResponse {
  logs: AuditLog[];
}

export interface AuditLogFilters {
  fromDate?: string;
  toDate?: string;
  action?: string;
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
  isActive: boolean;
  archivedAt: string | null;
  createdAt: string;
}

export interface ItemsResponse {
  items: Item[];
}

export interface CreateItemInput {
  name: string;
  unit: string;
  category?: string;
  sku?: string;
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

export interface StockTransferInput {
  itemId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number;
}

export type StockMovementType =
  | "STOCK_IN"
  | "STOCK_OUT"
  | "WASTAGE"
  | "ADJUSTMENT"
  | "TRANSFER_IN"
  | "TRANSFER_OUT";

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

export interface Notification {
  id: string;
  workspaceId: string;
  userId: string | null;
  type: string;
  title: string;
  message: string;
  entity: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsResponse {
  notifications: Notification[];
  unreadCount: number;
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

export interface PurchaseItemLine {
  id: string;
  purchaseId: string;
  itemId: string;
  quantity: number;
  unitCost: number;
  total: number;
  item: {
    id: string;
    name: string;
    unit: string;
  };
}

export interface Purchase {
  id: string;
  supplierId: string;
  date: string;
  totalAmount: number;
  createdAt: string;
  supplier: {
    id: string;
    name: string;
  };
  purchaseItems: PurchaseItemLine[];
}

export interface PurchasesResponse {
  purchases: Purchase[];
}

export interface CreatePurchaseLineInput {
  itemId: string;
  quantity: number;
  unitCost: number;
}

export interface CreatePurchaseInput {
  supplierId: string;
  date?: string;
  items: CreatePurchaseLineInput[];
}

export interface CreatePurchaseResponse {
  purchase: {
    id: string;
    supplierId: string;
    date: string;
    totalAmount: number;
    createdAt: string;
  };
}
