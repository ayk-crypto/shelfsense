export type Role = "OWNER" | "MANAGER" | "OPERATOR";

export const PERMISSION_DEFS = [
  { key: "dashboard",         label: "Dashboard",              group: "General",     description: "View the main dashboard and metrics" },
  { key: "inventory_view",    label: "View Inventory",         group: "Inventory",   description: "Browse and search items" },
  { key: "inventory_manage",  label: "Manage Items",           group: "Inventory",   description: "Create, edit, and archive items" },
  { key: "stock_in",          label: "Stock In",               group: "Stock",       description: "Record stock received into inventory" },
  { key: "stock_out",         label: "Stock Out",              group: "Stock",       description: "Record stock removed from inventory" },
  { key: "movements_view",    label: "Stock Activity",         group: "Stock",       description: "View the full stock movement history" },
  { key: "reports",           label: "Reports",                group: "Reporting",   description: "Access and export inventory reports" },
  { key: "alerts",            label: "Alerts",                 group: "Reporting",   description: "View low-stock and expiry alerts" },
  { key: "suppliers",         label: "Suppliers",              group: "Procurement", description: "Manage supplier contacts" },
  { key: "purchases",         label: "Purchases",              group: "Procurement", description: "View and create purchase orders" },
  { key: "locations",         label: "Locations",              group: "Settings",    description: "Manage branch and warehouse locations" },
  { key: "settings",          label: "Settings",               group: "Settings",    description: "Access workspace configuration" },
] as const;

export type Permission = (typeof PERMISSION_DEFS)[number]["key"];

export const MANAGER_PERMISSIONS: Permission[] = [
  "dashboard", "inventory_view", "inventory_manage", "stock_in", "stock_out",
  "movements_view", "reports", "alerts", "suppliers", "purchases", "locations", "settings",
];

export const OPERATOR_PERMISSIONS: Permission[] = [
  "dashboard", "inventory_view", "stock_out", "movements_view", "alerts",
];

export interface CustomRole {
  id: string;
  name: string;
  color: string;
  baseRole: "MANAGER" | "OPERATOR";
  permissions: Permission[];
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomRolesResponse {
  customRoles: CustomRole[];
}

export interface CreateCustomRoleInput {
  name: string;
  color: string;
  baseRole: "MANAGER" | "OPERATOR";
  permissions: Permission[];
}

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  workspaceId?: string | null;
  role?: Role | null;
  customRoleId?: string | null;
  customRoleName?: string | null;
  customRoleColor?: string | null;
  permissions?: Permission[] | null;
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
  customRoleId: string | null;
  customRoleName: string | null;
  customRoleColor: string | null;
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
  customRoleId?: string | null;
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
  batchNo?: string;
  supplierId?: string;
  supplierName?: string;
  note?: string;
}

export interface SupplierSuggestion {
  id: string;
  name: string;
}

export interface SupplierSuggestionResponse {
  suggestion: SupplierSuggestion | null;
}

export interface PriceHistoryEntry {
  id: string;
  unitCost: number;
  quantity: number;
  batchNo: string | null;
  createdAt: string;
  supplierName: string | null;
  supplier: { id: string; name: string } | null;
}

export interface PriceHistoryResponse {
  history: PriceHistoryEntry[];
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

export type StockCountStatus = "DRAFT" | "FINALIZED";

export interface StockCountStockItem {
  id: string;
  name: string;
  unit: string;
  sku: string | null;
  barcode: string | null;
  category: string | null;
  systemQuantity: number;
}

export interface StockCountStockResponse {
  items: StockCountStockItem[];
}

export interface StockCountLineInput {
  itemId: string;
  physicalQuantity: number;
}

export interface SaveStockCountInput {
  locationId: string;
  note?: string | null;
  items: StockCountLineInput[];
}

export interface StockCountLine {
  id: string;
  itemId: string;
  itemName: string;
  unit: string;
  systemQuantity: number;
  physicalQuantity: number;
  variance: number;
}

export interface StockCount {
  id: string;
  status: StockCountStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  finalizedAt: string | null;
  location: {
    id: string;
    name: string;
  };
  createdBy: {
    id: string;
    name: string;
    email: string;
  };
  finalizedBy: {
    id: string;
    name: string;
    email: string;
  } | null;
  items: StockCountLine[];
}

export interface StockCountsResponse {
  counts: Array<Omit<StockCount, "items"> & { items: Array<{ id: string; variance: number }> }>;
}

export interface StockCountResponse {
  count: StockCount;
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
