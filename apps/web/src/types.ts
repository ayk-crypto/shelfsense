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

export type PlatformRole = "USER" | "SUPER_ADMIN" | "SUPPORT_ADMIN";

export interface User {
  id: string;
  name: string;
  email: string;
  emailVerified?: boolean;
  platformRole?: PlatformRole;
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
  businessType: string | null;
  notifyLowStock: boolean;
  notifyExpiringSoon: boolean;
  notifyExpired: boolean;
  whatsappAlertsEnabled: boolean;
  emailAlertsEnabled: boolean;
  pushAlertsEnabled: boolean;
  emailLowStock: boolean;
  emailExpiringSoon: boolean;
  emailExpired: boolean;
  dailyDigestEnabled: boolean;
  customUnits: string[];
  customCategories: string[];
  customPurchaseUnits: string[];
}

export interface WorkspaceSettingsResponse {
  settings: WorkspaceSettings;
}

export interface OnboardingStatus {
  onboardingCompleted: boolean;
  currentStep: number;
  hasItems: boolean;
  hasSuppliers: boolean;
  hasLocations: boolean;
  hasSelectedPlan: boolean;
  subscriptionStatus: string | null;
  nextStep: "WORKSPACE_SETUP" | "PLAN_SELECTION" | "DASHBOARD";
}

export interface OnboardingStatusResponse extends OnboardingStatus {}

export interface CompleteOnboardingResponse {
  onboardingCompleted: boolean;
}

export interface PublicPlan {
  id: string;
  name: string;
  code: string;
  description: string | null;
  monthlyPrice: number;
  annualPrice: number;
  currency: string;
  trialDays: number;
  maxUsers: number | null;
  maxLocations: number | null;
  maxItems: number | null;
  maxSuppliers: number | null;
  enableExpiryTracking: boolean;
  enableBarcodeScanning: boolean;
  enableReports: boolean;
  enableAdvancedReports: boolean;
  enablePurchases: boolean;
  enableSuppliers: boolean;
  enableTeamManagement: boolean;
  enableCustomRoles: boolean;
  enableEmailAlerts: boolean;
  enableDailyOps: boolean;
  sortOrder: number;
}

export interface SubscriptionPreview {
  plan: { id: string; name: string; code: string; currency: string };
  billingCycle: "MONTHLY" | "ANNUAL";
  originalAmount: number;
  discountAmount: number;
  payableAmount: number;
  couponApplied: boolean;
  couponMessage: string;
  canActivateWithoutPayment: boolean;
}

export interface CurrentSubscription {
  id: string;
  status: string;
  billingCycle: string;
  amount: number;
  currency: string;
  manualNotes: string | null;
  plan: { id: string; name: string; code: string };
}

export interface UpdateWorkspaceSettingsInput {
  name?: string;
  currency?: string;
  lowStockMultiplier?: number;
  expiryAlertDays?: number;
  ownerPhone?: string | null;
  businessType?: string | null;
  notifyLowStock?: boolean;
  notifyExpiringSoon?: boolean;
  notifyExpired?: boolean;
  whatsappAlertsEnabled?: boolean;
  emailAlertsEnabled?: boolean;
  pushAlertsEnabled?: boolean;
  emailLowStock?: boolean;
  emailExpiringSoon?: boolean;
  emailExpired?: boolean;
  dailyDigestEnabled?: boolean;
  customUnits?: string[];
  customCategories?: string[];
  customPurchaseUnits?: string[];
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
  purchaseUnit: string | null;
  purchaseConversionFactor: number | null;
  issueUnit: string | null;
  displayBothUnits: boolean;
}

export interface ItemsResponse {
  items: Item[];
}

export type BatchStatus = "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | "DEPLETED";
export type BatchExpiryStatus = "EXPIRED" | "EXPIRING_SOON" | "HEALTHY" | "NO_EXPIRY";

export interface BatchDetailItem extends Item {
  totalCurrentStock: number;
  totalStockValue: number;
  nearestExpiryDate: string | null;
  statuses: {
    isLowStock: boolean;
    hasExpired: boolean;
    hasExpiringSoon: boolean;
  };
}

export interface BatchDetailBatch {
  id: string;
  batchNo: string | null;
  location: {
    id: string;
    name: string;
  };
  remainingQuantity: number;
  originalQuantity: number;
  unitCost: number | null;
  totalValue: number;
  supplier: {
    id: string | null;
    name: string;
  } | null;
  expiryDate: string | null;
  createdAt: string;
  updatedAt: string;
  status: BatchStatus;
  expiryStatus: BatchExpiryStatus;
}

export interface BatchDetailMovement {
  id: string;
  batchId: string | null;
  batchNo: string | null;
  type: StockMovementType;
  quantity: number;
  unitCost: number | null;
  reason: string | null;
  note: string | null;
  location: {
    id: string;
    name: string;
  };
  createdBy: {
    id: string;
    name: string;
    email: string;
  } | null;
  createdAt: string;
  reference: string | null;
}

export interface BatchDetailResponse {
  item: BatchDetailItem;
  batches: BatchDetailBatch[];
  movements: BatchDetailMovement[];
  meta: {
    expiryAlertDays: number;
  };
}

export interface CreateItemInput {
  name: string;
  unit: string;
  category?: string;
  sku?: string;
  barcode?: string;
  minStockLevel: number;
  trackExpiry: boolean;
  purchaseUnit?: string | null;
  purchaseConversionFactor?: number | null;
  issueUnit?: string | null;
  displayBothUnits?: boolean;
}

export interface StockInInput {
  itemId: string;
  quantity: number;
  locationId?: string;
  unitCost?: number;
  expiryDate?: string;
  batchNo?: string;
  supplierId?: string;
  supplierName?: string;
  note?: string;
  enteredQuantity?: number;
  enteredUnit?: string;
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
  enteredQuantity?: number;
  enteredUnit?: string;
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

export interface StockTrendDataPoint {
  date: string;
  stockIn: number;
  stockOut: number;
}

export interface StockTrendResponse {
  data: StockTrendDataPoint[];
  days: number;
}

export type StockCountStatus = "DRAFT" | "FINALIZED" | "RETURNED" | "REJECTED";

export interface OpeningStockInput {
  itemId: string;
  locationId: string;
  quantity: number;
  unitCost?: number;
  batchNo?: string;
  supplierId?: string;
  supplierName?: string;
  expiryDate?: string;
  expiryEstimated?: boolean;
  notes?: string;
}

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
  managerComment: string | null;
  createdAt: string;
  updatedAt: string;
  finalizedAt: string | null;
  returnedAt: string | null;
  rejectedAt: string | null;
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
  returnedBy: {
    id: string;
    name: string;
    email: string;
  } | null;
  rejectedBy: {
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

export type PurchaseStatus =
  | "DRAFT"
  | "ORDERED"
  | "PARTIALLY_RECEIVED"
  | "RECEIVED"
  | "CANCELLED";

export interface PurchaseItemLine {
  id: string;
  purchaseId: string;
  itemId: string;
  quantity: number;
  orderedQuantity: number;
  receivedQuantity: number;
  remainingQuantity: number;
  unitCost: number;
  total: number;
  orderedValue: number;
  receivedValue: number;
  expiryDate: string | null;
  batchNo: string | null;
  item: {
    id: string;
    name: string;
    unit: string;
    trackExpiry: boolean;
  };
}

export interface Purchase {
  id: string;
  supplierId: string;
  status: PurchaseStatus;
  date: string;
  orderedAt: string | null;
  expectedDeliveryDate: string | null;
  receivedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  totalAmount: number;
  orderedQuantity: number;
  receivedQuantity: number;
  remainingQuantity: number;
  receivedValue: number;
  createdAt: string;
  supplier: {
    id: string;
    name: string;
  };
  location: {
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
  expectedDeliveryDate?: string;
  items: CreatePurchaseLineInput[];
}

export interface CreatePurchaseResponse {
  purchase: Purchase;
}

export interface PurchaseResponse {
  purchase: Purchase;
}

export interface PurchaseFilters {
  status?: PurchaseStatus;
  supplierId?: string;
  fromDate?: string;
  toDate?: string;
  locationId?: string;
}

export interface ReceivePurchaseLineInput {
  purchaseItemId: string;
  receivedQuantity: number;
  locationId?: string;
  expiryDate?: string;
  batchNo?: string;
  unitCost?: number;
  notes?: string;
}

export interface ReceivePurchaseInput {
  lines: ReceivePurchaseLineInput[];
}

export interface ReceivePurchaseResponse {
  purchase: Purchase;
  receivedQuantity: number;
  receivedValue: number;
}

export interface ReorderSuggestion {
  itemId: string;
  itemName: string;
  sku: string | null;
  barcode: string | null;
  category: string | null;
  unit: string;
  currentStock: number;
  minStockLevel: number;
  suggestedQuantity: number;
  trackExpiry: boolean;
  location: {
    id: string;
    name: string;
  };
  preferredSupplier: {
    id: string;
    name: string;
  } | null;
  lastPurchaseCost: number | null;
}

export interface ReorderSuggestionsResponse {
  suggestions: ReorderSuggestion[];
}

export interface CreateReorderPurchaseLineInput {
  itemId: string;
  supplierId: string;
  quantity: number;
  unitCost?: number;
}

export interface CreateReorderPurchasesInput {
  locationId?: string;
  items: CreateReorderPurchaseLineInput[];
}

export interface CreateReorderPurchasesResponse {
  purchases: Array<{
    id: string;
    supplierId: string;
    status: PurchaseStatus;
    totalAmount: number;
    purchaseItems: Array<{
      itemId: string;
      quantity: number;
      unitCost: number;
    }>;
  }>;
}

// ─── Plan ─────────────────────────────────────────────────────────────────────

export type PlanTier = "FREE" | "BASIC" | "PRO";

export interface PlanLimits {
  maxItems: number;
  maxLocations: number;
  maxUsers: number;
}

export interface PlanUsage {
  items: number;
  locations: number;
  users: number;
}

export interface PlanStatus {
  plan: PlanTier;
  limits: PlanLimits;
  usage: PlanUsage;
}

// ─── Reports ──────────────────────────────────────────────────────────────────

export interface ReportParams {
  dateFrom?: string;
  dateTo?: string;
  locationId?: string;
  itemId?: string;
  category?: string;
  supplierId?: string;
}

export interface InventoryValuationRow {
  itemId: string;
  itemName: string;
  category: string;
  unit: string;
  sku: string | null;
  totalQuantity: number;
  avgUnitCost: number;
  totalValue: number;
  batchCount: number;
}
export interface InventoryValuationResponse {
  summary: { totalItems: number; totalQuantity: number; totalValue: number };
  rows: InventoryValuationRow[];
  generatedAt: string;
}

export interface WastageCostRow {
  itemId: string;
  itemName: string;
  category: string;
  unit: string;
  totalQuantity: number;
  totalValue: number;
  movementCount: number;
}
export interface WastageCostResponse {
  summary: { totalItems: number; totalQuantity: number; totalValue: number };
  rows: WastageCostRow[];
  generatedAt: string;
}

export interface UsageRow {
  itemId: string;
  itemName: string;
  category: string;
  unit: string;
  totalQuantity: number;
  movementCount: number;
  lastUsed: string;
}
export interface UsageResponse {
  summary: { totalItems: number; totalQuantity: number; totalMovements: number };
  rows: UsageRow[];
  generatedAt: string;
}

export interface SupplierSpendRow {
  supplierId: string;
  supplierName: string;
  orderCount: number;
  totalSpend: number;
  avgOrderValue: number;
  lastOrderDate: string | null;
}
export interface SupplierSpendResponse {
  summary: { totalSuppliers: number; totalOrders: number; totalSpend: number };
  rows: SupplierSpendRow[];
  generatedAt: string;
}

export interface StockAgingRow {
  batchId: string;
  batchNo: string | null;
  itemName: string;
  category: string;
  unit: string;
  location: string;
  originalQty: number;
  remainingQty: number;
  unitCost: number;
  totalValue: number;
  ageDays: number;
  receivedAt: string;
}
export interface StockAgingResponse {
  summary: { totalBatches: number; totalValue: number; avgAgeDays: number };
  rows: StockAgingRow[];
  generatedAt: string;
}

export interface ExpiryLossRow {
  batchId: string;
  batchNo: string | null;
  itemName: string;
  category: string;
  unit: string;
  location: string;
  remainingQty: number;
  unitCost: number;
  potentialLoss: number;
  expiryDate: string;
  daysExpired: number;
}
export interface ExpiryLossResponse {
  summary: { totalBatches: number; totalExpiredQty: number; totalPotentialLoss: number };
  rows: ExpiryLossRow[];
  generatedAt: string;
}

export interface AdjustmentVarianceRow {
  itemId: string;
  itemName: string;
  category: string;
  unit: string;
  positiveAdj: number;
  negativeAdj: number;
  netVariance: number;
  movementCount: number;
}
export interface AdjustmentVarianceResponse {
  summary: { totalItems: number; totalPositive: number; totalNegative: number; netVariance: number };
  rows: AdjustmentVarianceRow[];
  generatedAt: string;
}

export interface TransferRow {
  id: string;
  createdAt: string;
  itemName: string;
  category: string;
  unit: string;
  type: "TRANSFER_IN" | "TRANSFER_OUT";
  quantity: number;
  location: string;
  note: string | null;
}
export interface TransferHistoryResponse {
  summary: { totalTransfers: number; totalInQty: number; totalOutQty: number };
  rows: TransferRow[];
  generatedAt: string;
}

export interface AdminOverviewStats {
  totalWorkspaces: number;
  activeWorkspaces: number;
  suspendedWorkspaces: number;
  trialWorkspaces: number;
  paidWorkspaces: number;
  expiredWorkspaces: number;
  trialEndingSoon: number;
  setupIncomplete: number;
  totalUsers: number;
  verifiedUsers: number;
  unverifiedUsers: number;
  newSignupsThisWeek: number;
  estimatedMrr: number;
  failedEmails24h: number;
}

export interface AdminAuditLog {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  meta: Record<string, unknown>;
  createdAt: string;
  admin: { id: string; name: string; email: string };
}

export interface AdminOverview {
  overview: AdminOverviewStats;
  recentActivity: AdminAuditLog[];
  recentWorkspaces: Array<{
    id: string;
    name: string;
    plan: string;
    createdAt: string;
    owner: { email: string; name: string };
  }>;
  recentUsers: Array<{
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    createdAt: string;
  }>;
}

export interface AdminWorkspace {
  id: string;
  name: string;
  plan: string;
  suspended: boolean;
  suspendedAt: string | null;
  suspendReason: string | null;
  trialEndsAt: string | null;
  subscriptionStatus: string | null;
  createdAt: string;
  owner: { id: string; name: string; email: string };
  memberCount: number;
  itemCount: number;
  stockMovementCount: number;
}

export interface AdminPagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface AdminWorkspacesResponse {
  workspaces: AdminWorkspace[];
  pagination: AdminPagination;
}

export interface AdminWorkspaceDetail {
  workspace: {
    id: string;
    name: string;
    plan: string;
    suspended: boolean;
    suspendedAt: string | null;
    suspendReason: string | null;
    trialEndsAt: string | null;
    subscriptionStatus: string | null;
    businessType: string | null;
    currency: string;
    onboardingCompleted: boolean;
    createdAt: string;
    owner: { id: string; name: string; email: string; emailVerified: boolean; createdAt: string };
    memberships: Array<{
      id: string;
      role: string;
      isActive: boolean;
      createdAt: string;
      user: { id: string; name: string; email: string; emailVerified: boolean };
    }>;
    locations: Array<{ id: string; name: string; createdAt: string }>;
    itemCount: number;
    stockMovementCount: number;
    purchaseCount: number;
    supplierCount: number;
    subscription?: {
      id: string;
      status: string;
      billingCycle: string;
      amount: number | null;
      currency: string;
      trialEndsAt: string | null;
      currentPeriodEnd: string | null;
      nextRenewalAt: string | null;
      manualNotes: string | null;
      plan?: { id: string; name: string; code: string } | null;
      coupon?: { id: string; code: string; name: string } | null;
    } | null;
    payments?: Array<{
      id: string;
      amount: number | null;
      currency: string;
      status: string;
      paymentMethod: string | null;
      paidAt: string | null;
    }>;
  };
  recentActivity: Array<{
    id: string;
    type: string;
    quantity: number;
    createdAt: string;
    item: { name: string };
  }>;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  isDisabled: boolean;
  platformRole: PlatformRole;
  createdAt: string;
  lastLoginAt: string | null;
  workspaceCount: number;
  primaryWorkspace: {
    id: string;
    name: string;
    plan: string;
    role: string;
    subscriptionStatus: string | null;
  } | null;
}

export interface AdminUsersStats {
  total: number;
  verified: number;
  unverified: number;
  active: number;
  disabled: number;
  newThisMonth: number;
  platformAdminCount: number;
}

export interface AdminWorkspacesStats {
  total: number;
  active: number;
  suspended: number;
  free: number;
  paid: number;
  pendingPayment: number;
}

export interface AdminUsersResponse {
  users: AdminUser[];
  pagination: AdminPagination;
}

export interface AdminUserDetail {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    isDisabled: boolean;
    passwordResetRequired: boolean;
    platformRole: PlatformRole;
    failedLoginAttempts: number;
    lockedUntil: string | null;
    createdAt: string;
    memberships: Array<{
      id: string;
      role: string;
      isActive: boolean;
      createdAt: string;
      workspace: { id: string; name: string; plan: string; suspended: boolean };
    }>;
  };
  recentActivity: Array<{
    id: string;
    action: string;
    entity: string;
    entityId: string;
    createdAt: string;
    workspace: { id: string; name: string } | null;
  }>;
}

export interface AdminAuditLogsResponse {
  logs: AdminAuditLog[];
  pagination: AdminPagination;
}

// ── Plans ────────────────────────────────────────────────────────────────────

export interface AdminPlan {
  id: string;
  name: string;
  code: string;
  description: string;
  monthlyPrice: number;
  annualPrice: number;
  currency: string;
  trialDays: number;
  maxUsers: number | null;
  maxLocations: number | null;
  maxItems: number | null;
  maxSuppliers: number | null;
  enableExpiryTracking: boolean;
  enableBarcodeScanning: boolean;
  enableReports: boolean;
  enableAdvancedReports: boolean;
  enablePurchases: boolean;
  enableSuppliers: boolean;
  enableTeamManagement: boolean;
  enableCustomRoles: boolean;
  enableEmailAlerts: boolean;
  enableDailyOps: boolean;
  isPublic: boolean;
  isActive: boolean;
  sortOrder: number;
  subscriptionCount: number;
  createdAt: string;
  updatedAt: string;
}

// ── Coupons ──────────────────────────────────────────────────────────────────

export interface AdminCoupon {
  id: string;
  code: string;
  name: string;
  description: string;
  discountType: "PERCENTAGE" | "FIXED_AMOUNT";
  discountValue: number;
  currency: string;
  validFrom: string | null;
  validUntil: string | null;
  maxRedemptions: number | null;
  redemptionsUsed: number;
  billingCycleRestriction: "ANY" | "MONTHLY" | "ANNUAL";
  durationType: "ONCE" | "REPEATING" | "FOREVER";
  durationMonths: number | null;
  isActive: boolean;
  createdAt: string;
}

// ── Subscriptions ─────────────────────────────────────────────────────────────

export interface AdminSubscription {
  id: string;
  workspaceId: string;
  planId: string;
  status: string;
  billingCycle: string;
  currency: string;
  amount: number;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextRenewalAt: string | null;
  couponId: string | null;
  manualNotes: string | null;
  createdAt: string;
  updatedAt: string;
  plan: { id: string; name: string; code: string };
  coupon: { id: string; code: string; name: string; discountType: string; discountValue: number } | null;
  workspace: { id: string; name: string; owner: { email: string } };
  payments?: AdminPayment[];
}

export interface AdminSubscriptionsResponse {
  subscriptions: AdminSubscription[];
  pagination: AdminPagination;
}

// ── Payments ──────────────────────────────────────────────────────────────────

export interface AdminPayment {
  id: string;
  workspaceId: string;
  subscriptionId?: string | null;
  amount: number;
  currency: string;
  paymentMethod: string;
  status: string;
  paidAt: string | null;
  referenceNumber: string | null;
  notes: string | null;
  createdAt: string;
  workspace: { id: string; name: string };
  recordedBy?: { id: string; name: string; email: string } | null;
  subscription?: { id: string; plan: { name: string; code: string } } | null;
}

export interface AdminPaymentsSummary {
  totalPaid: number;
  totalPending: number;
  totalFailed: number;
  totalRefunded: number;
  totalCollected: number;
}

export interface AdminPaymentsResponse {
  payments: AdminPayment[];
  pagination: AdminPagination;
}

// ── Email Templates ───────────────────────────────────────────────────────────

export interface AdminEmailTemplate {
  id: string | null;
  key: string;
  name: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  enabled: boolean;
  variables: string[] | null;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
  isDefault: boolean;
}

// ── Email Logs ────────────────────────────────────────────────────────────────

export interface AdminEmailLog {
  id: string;
  type: string;
  recipient: string;
  subject: string;
  status: string;
  provider: string | null;
  errorMessage: string | null;
  workspaceId: string | null;
  createdAt: string;
}

export interface AdminEmailLogsResponse {
  logs: AdminEmailLog[];
  pagination: AdminPagination;
}

// ── Announcements ─────────────────────────────────────────────────────────────

export interface AdminAnnouncement {
  id: string;
  title: string;
  message: string;
  severity: "INFO" | "SUCCESS" | "WARNING" | "CRITICAL";
  targetType: "ALL" | "PLAN" | "WORKSPACE";
  targetPlanId: string | null;
  targetWorkspaceId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  dismissible: boolean;
  isActive: boolean;
  createdAt: string;
  createdBy?: { id: string; name: string } | null;
}

// ── System Health ─────────────────────────────────────────────────────────────

export interface AdminSystemHealth {
  api: { status: string; timestamp: string };
  database: { status: "ok" | "error"; latencyMs: number | null };
  email: {
    configured: boolean;
    provider: string;
    failedLast24h: number;
    totalSent: number;
    lastSentAt: string | null;
    lastSentType: string | null;
  };
  scheduler: { status: string };
  build: { nodeVersion: string; env: string };
}

// ── Support Desk ──────────────────────────────────────────────────────────

export type TicketStatus = "OPEN" | "PENDING" | "RESOLVED" | "CLOSED";
export type TicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type TicketSource = "EMAIL" | "PORTAL" | "ADMIN";
export type MessageDirection = "INBOUND" | "OUTBOUND" | "INTERNAL";

export type TicketCategory = "billing" | "technical" | "account" | "feature" | "general";

export const TICKET_CATEGORIES: { value: TicketCategory; label: string }[] = [
  { value: "billing",   label: "Billing & Payments" },
  { value: "technical", label: "Technical Issue" },
  { value: "account",   label: "Account & Access" },
  { value: "feature",   label: "Feature Request" },
  { value: "general",   label: "General Question" },
];

export interface SupportTicket {
  id: string;
  ticketNumber: number;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  source: TicketSource;
  category: TicketCategory | null;
  workspaceId: string | null;
  userId: string | null;
  requesterEmail: string;
  requesterName: string | null;
  assignedToUserId: string | null;
  lastMessageAt: string;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  workspace: { id: string; name: string } | null;
  user: { id: string; name: string; email: string } | null;
  assignedTo: { id: string; name: string; email: string } | null;
  _count?: { messages: number };
}

export interface AdminNotificationSummary {
  openCount: number;
  pendingCount: number;
  urgentCount: number;
  resolvedCount: number;
  closedCount: number;
  totalActive: number;
  recentOpen: Array<{
    id: string;
    ticketNumber: number;
    subject: string;
    status: TicketStatus;
    priority: TicketPriority;
    category: TicketCategory | null;
    requesterEmail: string;
    requesterName: string | null;
    lastMessageAt: string;
    workspace: { id: string; name: string } | null;
  }>;
}

export interface SupportMessage {
  id: string;
  ticketId: string;
  direction: MessageDirection;
  senderEmail: string;
  senderName: string | null;
  bodyHtml: string | null;
  bodyText: string;
  providerMessageId: string | null;
  attachments: unknown;
  createdByUserId: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
}

export interface SupportInternalNote {
  id: string;
  ticketId: string;
  note: string;
  createdByUserId: string;
  createdAt: string;
  createdBy: { id: string; name: string };
}

export interface SupportTicketEvent {
  id: string;
  ticketId: string;
  actorUserId: string | null;
  eventType: string;
  metadata: unknown;
  createdAt: string;
  actor: { id: string; name: string } | null;
}

export interface SupportTicketDetail extends SupportTicket {
  messages: SupportMessage[];
  notes: SupportInternalNote[];
  events: SupportTicketEvent[];
}

export interface SupportTicketsResponse {
  tickets: SupportTicket[];
  total: number;
  page: number;
  pages: number;
}
