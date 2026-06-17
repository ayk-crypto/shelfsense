import JsBarcode from "jsbarcode";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmModal } from "../components/ConfirmModal";
import type { ConfirmOptions } from "../components/ConfirmModal";
import { useNavigate, useSearchParams } from "react-router-dom";
import { archiveItem, createItem, deleteItemPermanently, getItems, reactivateItem, updateItem } from "../api/items";
import { buildSupplierMappingMap, bulkAssignSupplier, bulkRemoveSupplier, getItemSuppliers, getSupplierMappings, putItemSuppliers } from "../api/item-suppliers";
import { getSuppliers } from "../api/suppliers";
import { addOpeningStock, getStockMovements, getStockSummary, stockIn, stockOut, stockTransfer } from "../api/stock";
import { useAuth } from "../context/AuthContext";
import { hasPermission } from "../utils/permissions";
import { useLocation } from "../context/LocationContext";
import { useWorkspaceSettings } from "../context/WorkspaceSettingsContext";
import type { BulkAssignSupplierRequest, CreateItemInput, Item, ItemSupplierInfo, ItemSupplierMapping, Location, StockMovement, StockSummaryItem, Supplier } from "../types";
import { formatCurrency } from "../utils/currency";
import { DEFAULT_CATEGORY_OPTIONS, DEFAULT_UNIT_OPTIONS } from "../utils/inventoryDefaults";
import {
  getEstimatedDaysRemaining,
  getForecastTone,
  getLastSevenDaysRange,
  getUsageInsights,
} from "../utils/usage";
import {
  formatDaysRemaining,
  formatQty,
  getStockDisplayLines,
  normalizeUnitConfig,
  toPurchaseQuantity,
} from "../utils/purchaseUnits";

const BarcodeScanner = lazy(() =>
  import("../components/BarcodeScanner").then((m) => ({ default: m.BarcodeScanner })),
);

interface Toast {
  id: number;
  msg: string;
  type: "success" | "error";
}

let toastSeq = 0;

const FALLBACK_UNIT_OPTIONS = DEFAULT_UNIT_OPTIONS;
const FALLBACK_CATEGORY_OPTIONS = DEFAULT_CATEGORY_OPTIONS;

interface StatusInfo { label: string; variant: "green" | "orange" | "red" | "gray" }

type BarcodeLabelPresetId = "small" | "medium" | "large";
type BarcodeLabelTemplateId = "barcode-only" | "name" | "name-details";
type ItemStatusFilter = "all" | "ok" | "low" | "expiring" | "expired" | "archived";
type ItemSortKey = "name" | "stock-asc" | "stock-desc" | "value-desc" | "recent";
type SupplierFilter = "all" | "has_supplier" | "no_supplier" | string;

const BARCODE_LABEL_PRESET_STORAGE_KEY = "shelfsense.barcodeLabelPreset";
const BARCODE_LABEL_TEMPLATE_STORAGE_KEY = "shelfsense.barcodeLabelTemplate";

const BARCODE_LABEL_PRESETS: Record<
  BarcodeLabelPresetId,
  { label: string; widthMm: number; heightMm: number; barcodeHeight: number; barWidth: number }
> = {
  small: { label: "Small", widthMm: 40, heightMm: 20, barcodeHeight: 34, barWidth: 1.05 },
  medium: { label: "Medium", widthMm: 50, heightMm: 30, barcodeHeight: 48, barWidth: 1.35 },
  large: { label: "Large", widthMm: 70, heightMm: 40, barcodeHeight: 62, barWidth: 1.7 },
};

const BARCODE_LABEL_TEMPLATES: Array<{ id: BarcodeLabelTemplateId; label: string }> = [
  { id: "barcode-only", label: "Barcode Only" },
  { id: "name", label: "Barcode + Item Name" },
  { id: "name-details", label: "Barcode + Item Name + SKU/Unit" },
];

interface ImportItemRow {
  rowNumber: number;
  name: string;
  unit: string;
  category: string;
  sku: string;
  barcode: string;
  minStockLevel: number;
  trackExpiry: boolean;
  purchaseUnit: string;
  purchaseConversionFactor: number | null;
  issueUnit: string;
  importMode: "new" | "update";
  existingItemId: string | null;
  errors: string[];
  status: "pending" | "imported" | "failed";
}

interface BulkProgress {
  updated: number;
  total: number;
  failed: number;
}

function getStatus(
  s: StockSummaryItem | undefined,
  item: Item,
  trackExpiry: boolean,
  expiryAlertDays: number,
): StatusInfo {
  if (!s) return { label: "No data", variant: "gray" };
  const config = normalizeUnitConfig(item.unit, item.purchaseUnit, item.purchaseConversionFactor);
  if (config.conversionRequired) return { label: "Conversion Required", variant: "orange" };
  if (s.totalQuantity < 0) return { label: "Stock Issue", variant: "red" };
  if (s.totalQuantity === 0) return { label: "Out of Stock", variant: "red" };
  const now = Date.now();
  if (trackExpiry && s.nearestExpiryDate) {
    const exp = new Date(s.nearestExpiryDate).getTime();
    if (exp < now) return { label: "Expired", variant: "red" };
    if (exp <= now + expiryAlertDays * 86_400_000) return { label: "Expiring", variant: "orange" };
  }
  if (s.isLowStock) return { label: "Low Stock", variant: "orange" };
  return { label: "OK", variant: "green" };
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function ItemsPage() {
  const { user } = useAuth();
  const { activeLocationId, locations } = useLocation();
  const { settings } = useWorkspaceSettings();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const canManageStock = hasPermission(user, "inventory_manage");
  const isOwner = user?.role === "OWNER";
  const currency = settings.currency;
  const unitOptions = settings.customUnits.length > 0 ? settings.customUnits : FALLBACK_UNIT_OPTIONS;
  const categoryOptions = settings.customCategories.length > 0 ? settings.customCategories : FALLBACK_CATEGORY_OPTIONS;
  const [items, setItems] = useState<Item[]>([]);
  const [summaryMap, setSummaryMap] = useState<Map<string, StockSummaryItem>>(new Map());
  const [usageMovements, setUsageMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const [addItemOpen, setAddItemOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanPrefillBarcode, setScanPrefillBarcode] = useState<string | undefined>();
  const [stockInItem, setStockInItem] = useState<Item | null>(null);
  const [openingStockItem, setOpeningStockItem] = useState<Item | null>(null);
  const [stockOutItem, setStockOutItem] = useState<Item | null>(null);
  const [adjustItem, setAdjustItem] = useState<Item | null>(null);
  const [transferItem, setTransferItem] = useState<Item | null>(null);
  const [barcodeItem, setBarcodeItem] = useState<Item | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(() => new Set());
  const [bulkCategory, setBulkCategory] = useState(categoryOptions[0] ?? FALLBACK_CATEGORY_OPTIONS[0]);
  const [bulkUnit, setBulkUnit] = useState(unitOptions[0] ?? FALLBACK_UNIT_OPTIONS[0]);
  const [bulkProgress, setBulkProgress] = useState<BulkProgress | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [confirmOpts, setConfirmOpts] = useState<ConfirmOptions | null>(null);
  const [deleteItem, setDeleteItem] = useState<Item | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<ItemStatusFilter>("all");
  const [sortBy, setSortBy] = useState<ItemSortKey>("name");
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [openActionMenuItemId, setOpenActionMenuItemId] = useState<string | null>(null);
  const [pendingCommandAction, setPendingCommandAction] = useState<"stock-in" | "transfer" | null>(null);
  const inventorySearchRef = useRef<HTMLInputElement>(null);
  const [supplierFilter, setSupplierFilter] = useState<SupplierFilter>("all");
  const [supplierMappingMap, setSupplierMappingMap] = useState<Map<string, ItemSupplierInfo>>(new Map());
  const [suppliersList, setSuppliersList] = useState<Supplier[]>([]);
  const [assignSupplierOpen, setAssignSupplierOpen] = useState(false);
  const [removeSupplierOpen, setRemoveSupplierOpen] = useState(false);
  const [manageSuppliersItem, setManageSuppliersItem] = useState<Item | null>(null);
  const selectedCount = selectedItemIds.size;
  const usageMap = useMemo(
    () => new Map(getUsageInsights(usageMovements).map((usage) => [usage.itemId, usage])),
    [usageMovements],
  );
  const filterCategoryOptions = useMemo(() => {
    const categories = new Set<string>();
    for (const item of items) {
      if (item.category?.trim()) categories.add(item.category.trim());
    }
    return [...categories].sort((a, b) => a.localeCompare(b));
  }, [items]);
  const filteredItems = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const filtered = items.filter((item) => {
      const summary = summaryMap.get(item.id);
      const status = getStatus(summary, item, item.trackExpiry, settings.expiryAlertDays);
      const matchesSearch =
        !query ||
        item.name.toLowerCase().includes(query) ||
        item.unit.toLowerCase().includes(query) ||
        item.category?.toLowerCase().includes(query) ||
        item.sku?.toLowerCase().includes(query) ||
        item.barcode?.toLowerCase().includes(query);
      const matchesCategory =
        categoryFilter === "all" ||
        (categoryFilter === "__uncategorized__" ? !item.category?.trim() : item.category === categoryFilter);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "archived" && !item.isActive) ||
        (statusFilter === "low" && summary?.isLowStock && item.isActive) ||
        (statusFilter === "expiring" && status.label === "Expiring" && item.isActive) ||
        (statusFilter === "expired" && status.label === "Expired" && item.isActive) ||
        (statusFilter === "ok" && status.label === "OK" && item.isActive);
      const mappingInfo = supplierMappingMap.get(item.id);
      const hasSupplierMapping =
        (mappingInfo?.primary != null) || (mappingInfo?.alternates?.length ?? 0) > 0;
      const matchesSupplier =
        supplierFilter === "all" ||
        (supplierFilter === "has_supplier" && hasSupplierMapping) ||
        (supplierFilter === "no_supplier" && !hasSupplierMapping) ||
        (supplierFilter !== "all" &&
          supplierFilter !== "has_supplier" &&
          supplierFilter !== "no_supplier" &&
          (mappingInfo?.primary?.supplierId === supplierFilter ||
            (mappingInfo?.alternates ?? []).some((a) => a.supplierId === supplierFilter)));
      return matchesSearch && matchesCategory && matchesStatus && matchesSupplier;
    });

    return filtered.sort((a, b) => {
      const summaryA = summaryMap.get(a.id);
      const summaryB = summaryMap.get(b.id);
      if (sortBy === "stock-asc") return (summaryA?.totalQuantity ?? 0) - (summaryB?.totalQuantity ?? 0);
      if (sortBy === "stock-desc") return (summaryB?.totalQuantity ?? 0) - (summaryA?.totalQuantity ?? 0);
      if (sortBy === "value-desc") return (summaryB?.totalValue ?? 0) - (summaryA?.totalValue ?? 0);
      if (sortBy === "recent") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return a.name.localeCompare(b.name);
    });
  }, [items, summaryMap, settings.expiryAlertDays, searchTerm, categoryFilter, statusFilter, sortBy, supplierFilter, supplierMappingMap]);
  const hasBarcodes = useMemo(() => filteredItems.some((item) => item.barcode), [filteredItems]);
  const visibleItemIds = useMemo(() => filteredItems.map((item) => item.id), [filteredItems]);
  const allVisibleSelected =
    visibleItemIds.length > 0 && visibleItemIds.every((id) => selectedItemIds.has(id));
  const activeCount = items.filter((item) => item.isActive).length;
  const archivedCount = items.length - activeCount;
  const lowStockCount = items.filter((item) => item.isActive && summaryMap.get(item.id)?.isLowStock).length;
  const filteredArchivedCount = filteredItems.filter((item) => !item.isActive).length;

  useEffect(() => {
    setSelectedItemIds((prev) => {
      const visible = new Set(visibleItemIds);
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleItemIds]);

  useEffect(() => {
    const query = searchParams.get("q") ?? "";
    setSearchTerm(query);
    const supplier = searchParams.get("supplier");
    if (supplier) setSupplierFilter(supplier);
  }, [searchParams]);

  useEffect(() => {
    if (!showArchived && statusFilter === "archived") {
      setStatusFilter("all");
    }
  }, [showArchived, statusFilter]);

  useEffect(() => {
    const action = searchParams.get("action");
    if (action === "scan") {
      setScannerOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete("action");
      setSearchParams(next, { replace: true });
      return;
    }

    if (action === "stock-in" || action === "transfer") {
      setPendingCommandAction(action);
      inventorySearchRef.current?.focus();
      const next = new URLSearchParams(searchParams);
      next.delete("action");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  function showToast(msg: string, type: "success" | "error") {
    const id = ++toastSeq;
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }


  async function refreshSummary() {
    try {
      const res = await getStockSummary();
      const map = new Map(res.summary.map((s) => [s.itemId, s]));
      setSummaryMap(map);
    } catch {
      /* non-blocking - keep showing stale data */
    }
  }

  async function refreshUsageInsights() {
    if (!canManageStock) return;

    try {
      const res = await getStockMovements({
        type: "STOCK_OUT",
        ...getLastSevenDaysRange(),
      });
      setUsageMovements(res.movements);
    } catch {
      /* non-blocking - keep showing stale usage insights */
    }
  }

  async function loadAll() {
    try {
      const [itemsRes, summaryRes, usageRes] = await Promise.all([
        getItems(showArchived),
        getStockSummary(),
        canManageStock
          ? getStockMovements({ type: "STOCK_OUT", ...getLastSevenDaysRange() })
          : Promise.resolve({ movements: [] }),
      ]);
      setItems(itemsRes.items);
      setSummaryMap(new Map(summaryRes.summary.map((s) => [s.itemId, s])));
      setUsageMovements(usageRes.movements);
      setFetchError(null);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load items");
    } finally {
      setLoading(false);
    }
    try {
      const [mappingsRes, suppliersRes] = await Promise.all([getSupplierMappings(), getSuppliers()]);
      setSupplierMappingMap(buildSupplierMappingMap(mappingsRes.items));
      setSuppliersList(suppliersRes.suppliers);
    } catch { /* non-blocking */ }
  }

  useEffect(() => { void loadAll(); }, [canManageStock, activeLocationId, showArchived]);

  function toggleItemSelection(itemId: string) {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleItemIds.forEach((id) => next.delete(id));
      } else {
        visibleItemIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedItemIds(new Set());
    setBulkProgress(null);
  }

  function applyBulkUpdate(label: string, patch: Partial<CreateItemInput>) {
    const selectedIds = visibleItemIds.filter((id) => selectedItemIds.has(id));
    if (selectedIds.length === 0) return;

    setConfirmOpts({
      title: `Apply "${label}"?`,
      message: `This will update ${selectedIds.length} selected item${selectedIds.length === 1 ? "" : "s"}.`,
      confirmLabel: "Apply",
      variant: "primary",
      onConfirm: async () => {
        setConfirmOpts(null);
        setBulkSaving(true);
        setBulkProgress({ updated: 0, total: selectedIds.length, failed: 0 });

        let updated = 0;
        let failed = 0;

        for (const id of selectedIds) {
          try {
            await updateItem(id, patch);
            updated += 1;
          } catch {
            failed += 1;
          }
          setBulkProgress({ updated, total: selectedIds.length, failed });
        }

        setBulkSaving(false);
        await loadAll();

        if (failed === 0) {
          setSelectedItemIds(new Set());
          showToast(`Updated ${updated} item${updated === 1 ? "" : "s"}`, "success");
        } else {
          showToast(`Updated ${updated} of ${selectedIds.length}; ${failed} failed`, "error");
        }
      },
      onCancel: () => setConfirmOpts(null),
    });
  }

  function handleArchiveItem(item: Item) {
    const quantity = summaryMap.get(item.id)?.totalQuantity ?? 0;
    const message = quantity > 0
      ? `It currently has ${formatNumber(quantity)} ${item.unit} in stock. Stock history will be preserved.`
      : "This item will be hidden from active inventory. You can restore it later.";

    setConfirmOpts({
      title: `Archive "${item.name}"?`,
      message,
      confirmLabel: "Archive",
      variant: "danger",
      onConfirm: async () => {
        setConfirmOpts(null);
        setBusy((prev) => new Set(prev).add(item.id));
        try {
          await archiveItem(item.id);
          showToast(`Archived "${item.name}"`, "success");
          await loadAll();
        } catch (err) {
          showToast(err instanceof Error ? err.message : "Failed to archive item", "error");
        } finally {
          setBusy((prev) => { const next = new Set(prev); next.delete(item.id); return next; });
        }
      },
      onCancel: () => setConfirmOpts(null),
    });
  }

  async function handleReactivateItem(item: Item) {
    setBusy((prev) => new Set(prev).add(item.id));
    try {
      await reactivateItem(item.id);
      showToast(`Reactivated "${item.name}"`, "success");
      await loadAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to reactivate item", "error");
    } finally {
      setBusy((prev) => { const next = new Set(prev); next.delete(item.id); return next; });
    }
  }

  function openPermanentDeleteModal(item: Item) {
    setDeleteItem(item);
    setDeleteConfirmText("");
  }

  async function handleConfirmPermanentDelete() {
    if (!deleteItem || deleteConfirmText !== deleteItem.name) return;
    setBusy((prev) => new Set(prev).add(deleteItem.id));
    try {
      await deleteItemPermanently(deleteItem.id);
      setItems((prev) => prev.filter((i) => i.id !== deleteItem.id));
      showToast(`"${deleteItem.name}" permanently deleted`, "success");
      setDeleteItem(null);
      setDeleteConfirmText("");
      await loadAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to delete item", "error");
    } finally {
      setBusy((prev) => { const next = new Set(prev); next.delete(deleteItem!.id); return next; });
    }
  }

  if (loading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Loading items...</p>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="page-error">
        <div className="alert alert--error">{fetchError}</div>
      </div>
    );
  }

  return (
    <div className="items-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Inventory</p>
          <h1 className="page-title">Inventory</h1>
          <p className="page-subtitle">Manage items, stock levels, suppliers, and expiry from one clean workspace.</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn--secondary" onClick={() => setScannerOpen(true)} title="Scan a barcode">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="btn-icon">
              <rect x="3" y="3" width="5" height="5" rx="1" />
              <rect x="16" y="3" width="5" height="5" rx="1" />
              <rect x="3" y="16" width="5" height="5" rx="1" />
              <path d="M16 16h5v5" /><path d="M16 21h5" />
              <path d="M3 12h4" /><path d="M9 3v4" /><path d="M9 9h4" /><path d="M9 12v4" />
              <path d="M12 9h4" /><path d="M12 16h4" />
            </svg>
            Scan
          </button>
          {canManageStock && (
            <>
              <button className="btn btn--secondary" onClick={() => setImportOpen(true)}>
                Import Items
              </button>
              <button className="btn btn--primary" onClick={() => { setScanPrefillBarcode(undefined); setAddItemOpen(true); }}>
                + Add Item
              </button>
            </>
          )}
        </div>
      </div>

      <div className="inventory-command-panel">
        <div className="inventory-kpis" aria-live="polite">
          <button
            type="button"
            className={`inv-kpi-pill${statusFilter === "all" ? " inv-kpi-pill--selected" : ""}`}
            onClick={() => { setStatusFilter("all"); }}
            title="Show all active items"
          >
            <strong>{activeCount}</strong> active
          </button>
          <button
            type="button"
            className={`inv-kpi-pill inv-kpi-pill--warn${statusFilter === "low" ? " inv-kpi-pill--selected" : ""}`}
            onClick={() => setStatusFilter(statusFilter === "low" ? "all" : "low")}
            title="Toggle low stock filter"
          >
            <strong>{lowStockCount}</strong> low stock
          </button>
          <button
            type="button"
            className={`inv-kpi-pill${showArchived ? " inv-kpi-pill--active" : ""}`}
            onClick={() => setShowArchived((v) => { if (v && statusFilter === "archived") setStatusFilter("all"); return !v; })}
            title={showArchived ? "Hide archived items" : "Show archived items"}
          >
            <strong>{archivedCount}</strong> archived
          </button>
        </div>

        <div className="inventory-filters">
          <label className="inventory-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              ref={inventorySearchRef}
              className="form-input"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search name, SKU, barcode, category..."
              aria-label="Search inventory items"
            />
          </label>
          <select
            className="form-select"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter by category"
          >
            <option value="all">All categories</option>
            <option value="__uncategorized__">Uncategorized</option>
            {filterCategoryOptions.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
          <select
            className="form-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ItemStatusFilter)}
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            <option value="ok">OK</option>
            <option value="low">Low stock</option>
            <option value="expiring">Expiring soon</option>
            <option value="expired">Expired</option>
            {(showArchived || statusFilter === "archived") && <option value="archived">Archived</option>}
          </select>
          <select
            className="form-select"
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            aria-label="Filter by supplier"
          >
            <option value="all">All suppliers</option>
            <option value="has_supplier">Has supplier</option>
            <option value="no_supplier">No supplier</option>
            {suppliersList.length > 0 && (
              <optgroup label="By supplier">
                {suppliersList.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </optgroup>
            )}
          </select>
          <select
            className="form-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as ItemSortKey)}
            aria-label="Sort inventory items"
          >
            <option value="name">Sort: Name</option>
            <option value="stock-asc">Stock: Low to high</option>
            <option value="stock-desc">Stock: High to low</option>
            <option value="value-desc">Value: High to low</option>
            <option value="recent">Newest first</option>
          </select>
          {canManageStock && (
            <button
              className="btn btn--secondary"
              onClick={() => {
                setShowArchived((value) => {
                  if (value && statusFilter === "archived") setStatusFilter("all");
                  return !value;
                });
              }}
            >
              {showArchived ? "Hide archived" : "Show archived"}
            </button>
          )}
          {(searchTerm || categoryFilter !== "all" || statusFilter !== "all" || sortBy !== "name" || supplierFilter !== "all") && (
            <button
              className="btn btn--ghost"
              onClick={() => {
                setSearchTerm("");
                setCategoryFilter("all");
                setStatusFilter("all");
                setSortBy("name");
                setSupplierFilter("all");
                setPendingCommandAction(null);
                setSearchParams(new URLSearchParams(), { replace: true });
              }}
            >
              Clear
            </button>
          )}
        </div>

        <p className="inventory-filter-summary">
          Showing {filteredItems.length} of {items.length} items
          {searchTerm ? ` matching "${searchTerm.trim()}"` : ""}
          {categoryFilter !== "all" ? ` in ${categoryFilter === "__uncategorized__" ? "Uncategorized" : categoryFilter}` : ""}
          {statusFilter !== "all" ? ` with ${statusFilter.replace("-", " ")} status` : ""}.
        </p>
      </div>

      {pendingCommandAction === "stock-in" && (
        <div className="inventory-action-notice" role="status">
          <strong>Stock in:</strong>
          <span>Search or choose an item below, then use the visible <strong>Receive</strong> row action.</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPendingCommandAction(null)}>
            Dismiss
          </button>
        </div>
      )}

      {pendingCommandAction === "transfer" && (
        <div className="inventory-action-notice" role="status">
          <strong>Transfer stock:</strong>
          <span>Search or choose an item below, then open the row menu and select <strong>Transfer</strong>.</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPendingCommandAction(null)}>
            Dismiss
          </button>
        </div>
      )}

      {canManageStock && selectedCount > 0 && (
        <BulkItemsBar
          selectedCount={selectedCount}
          allVisibleSelected={allVisibleSelected}
          bulkCategory={bulkCategory}
          bulkUnit={bulkUnit}
          categoryOptions={categoryOptions}
          unitOptions={unitOptions}
          progress={bulkProgress}
          saving={bulkSaving}
          onToggleAllVisible={toggleSelectAllVisible}
          onClear={clearSelection}
          onCategoryChange={setBulkCategory}
          onUnitChange={setBulkUnit}
          onApplyCategory={() => { void applyBulkUpdate(`Update category to ${bulkCategory}`, { category: bulkCategory }); }}
          onApplyUnit={() => { void applyBulkUpdate(`Update unit to ${bulkUnit}`, { unit: bulkUnit }); }}
          onEnableExpiry={() => { void applyBulkUpdate("Enable expiry tracking", { trackExpiry: true }); }}
          onDisableExpiry={() => { void applyBulkUpdate("Disable expiry tracking", { trackExpiry: false }); }}
          onAssignSupplier={() => setAssignSupplierOpen(true)}
          onRemoveSupplier={() => setRemoveSupplierOpen(true)}
        />
      )}

      {canManageStock && filteredItems.length > 0 && selectedCount === 0 && (
        <div className="selection-toolbar">
          <label className="bulk-select-all">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              disabled={bulkSaving}
              onChange={toggleSelectAllVisible}
            />
            Select all visible
          </label>
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty-state">
          <h3>No inventory items yet</h3>
          <p>Add your first item or import a CSV/Excel list to start tracking stock.</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="empty-state">
          <h3>No items match these filters</h3>
          <p>Try a different search, category, status, or show archived inventory.</p>
        </div>
      ) : (
        <>
          {/* Desktop table (hidden on mobile) */}
          <div className="table-wrap items-table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {canManageStock && (
                    <th className="select-col">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        disabled={bulkSaving || visibleItemIds.length === 0}
                        onChange={toggleSelectAllVisible}
                        aria-label="Select all visible items"
                      />
                    </th>
                  )}
                  <th>Name</th>
                  {hasBarcodes && <th>Barcode</th>}
                  <th>Unit</th>
                  <th className="text-right">In Stock</th>
                  <th className="text-right">Value</th>
                  <th>Status</th>
                  <th className="text-right col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const s = summaryMap.get(item.id);
                  const usage = usageMap.get(item.id);
                  const unitConfig = normalizeUnitConfig(item.unit, item.purchaseUnit, item.purchaseConversionFactor);
                  const estimatedDaysRemaining = s && !unitConfig.conversionRequired && usage && usage.averageDailyUsage > 0
                    ? getEstimatedDaysRemaining(s.totalQuantity, usage.averageDailyUsage)
                    : null;
                  const status = getStatus(s, item, item.trackExpiry, settings.expiryAlertDays);
                  const selected = selectedItemIds.has(item.id);
                  const stockDisplay = s ? getStockDisplayLines(s.totalQuantity, item.unit, item.purchaseUnit, item.purchaseConversionFactor) : null;
                  return (
                    <tr key={item.id} className={`${s?.isLowStock ? "row--warn" : ""} ${selected ? "row--selected" : ""} ${!item.isActive ? "is-muted" : ""}`}>
                      {canManageStock && (
                        <td className="select-col">
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={bulkSaving}
                            onChange={() => toggleItemSelection(item.id)}
                            aria-label={`Select ${item.name}`}
                          />
                        </td>
                      )}
                      <td className="td-name">
                        <span className="item-name-line">
                          <strong>{item.name}</strong>
                          {!item.isActive && (
                            <span className="badge badge--gray item-lifecycle-badge">Archived</span>
                          )}
                          {item.trackExpiry && (
                            <span className="badge badge--gray item-lifecycle-badge">Expiry</span>
                          )}
                        </span>
                        <span className="item-meta-line">
                          <span className={`cat-badge${!item.category ? " cat-badge--none" : ""}`}>
                            {item.category || "Uncategorized"}
                          </span>
                          {item.sku && <span className="item-sku-label">SKU {item.sku}</span>}
                        </span>
                        {(() => {
                          const mapping = supplierMappingMap.get(item.id);
                          if (!mapping) return null;
                          return (
                            <span className="item-supplier-row">
                              {mapping.primary && (
                                <span className="item-supplier-tag item-supplier-tag--primary" title={`Primary supplier: ${mapping.primary.supplierName}`}>
                                  {mapping.primary.supplierName}
                                </span>
                              )}
                              {mapping.alternates.map((a) => (
                                <span key={a.id} className="item-supplier-tag item-supplier-tag--alternate" title={`Alternate: ${a.supplierName}`}>
                                  {a.supplierName}
                                </span>
                              ))}
                            </span>
                          );
                        })()}
                        {stockDisplay?.conversionRequired && (
                          <button type="button" className="unit-config-link" onClick={() => setEditingItem(item)}>
                            Unit conversion required
                          </button>
                        )}
                        {s?.reorder?.calculationAvailable && (s.reorder.suggestedBuyingQuantity ?? 0) > 0 && (() => {
                          const unit = unitConfig.buyingUnit;
                          return <span className="reorder-hint">Suggested reorder: {formatQty(s.reorder!.suggestedBuyingQuantity!, 0)} {unit}</span>;
                        })()}
                        {supplierFilter !== "all" && s?.reorder?.incomingBaseQuantity !== null && s?.reorder?.incomingBaseQuantity !== undefined && s.reorder.incomingBaseQuantity > 0 && (
                          <span className="incoming-hint">
                            Incoming: {formatQty(s.reorder.incomingBuyingQuantity ?? 0, 2)} {unitConfig.buyingUnit} / {formatQty(s.reorder.incomingBaseQuantity, 2)} {item.unit}
                          </span>
                        )}
                        {usage && (() => {
                          if (unitConfig.conversionRequired) {
                            return <span className="usage-hint">Usage: {formatQty(usage.totalQuantity, 2)} {item.unit} in 7 days</span>;
                          }
                          const totalBuying = toPurchaseQuantity(usage.totalQuantity, unitConfig.conversionFactor);
                          const avgBuying = toPurchaseQuantity(usage.averageDailyUsage, unitConfig.conversionFactor);
                          return (
                            <span className="usage-hint">
                              7-day usage: {formatQty(totalBuying, 2)} {unitConfig.buyingUnit} / {formatQty(usage.totalQuantity, 2)} {item.unit}
                              {" - "}Avg/day: {formatQty(avgBuying, 4)} {unitConfig.buyingUnit} / {formatQty(usage.averageDailyUsage, 4)} {item.unit}
                            </span>
                          );
                        })()}
                        {s && !usage && !unitConfig.conversionRequired && (
                          <span className="forecast-hint forecast-hint--normal">No usage data</span>
                        )}
                        {s && usage && usage.averageDailyUsage <= 0 && !unitConfig.conversionRequired && (
                          <span className="forecast-hint forecast-hint--normal">No recent usage</span>
                        )}
                        {unitConfig.conversionRequired && (
                          <span className="forecast-hint forecast-hint--warning">Conversion required</span>
                        )}
                        {estimatedDaysRemaining !== null && s && usage && (
                          <span className={`forecast-hint forecast-hint--${getForecastTone(estimatedDaysRemaining)}`}>
                            Est. remaining: {formatDaysRemaining(estimatedDaysRemaining)} days
                            <details className="cover-details">
                              <summary>How calculated</summary>
                              <span>Available stock: {formatQty(s.totalQuantity, 2)} {item.unit}</span>
                              <span>Average daily usage: {formatQty(usage.averageDailyUsage, 6)} {item.unit}/day</span>
                              <span>Calculation: {formatQty(s.totalQuantity, 2)} / {formatQty(usage.averageDailyUsage, 6)} = {formatDaysRemaining(estimatedDaysRemaining)} days</span>
                              {unitConfig.usesBuyingUnit && (
                                <span>{formatQty(s.totalQuantity, 2)} {item.unit} = {formatQty(toPurchaseQuantity(s.totalQuantity, unitConfig.conversionFactor), 2)} {unitConfig.buyingUnit}; 1 {unitConfig.buyingUnit} = {formatQty(unitConfig.conversionFactor, 2)} {item.unit}</span>
                              )}
                            </details>
                          </span>
                        )}
                      </td>
                      {hasBarcodes && (
                        <td className="td-barcode">{item.barcode ?? "-"}</td>
                      )}
                      <td className="td-unit">{item.unit}</td>
                      <td className="text-right td-num">
                        {stockDisplay ? (
                          <span className="stock-display">
                            <strong>{stockDisplay.primary}</strong>
                            {stockDisplay.secondary && <span>{stockDisplay.secondary}</span>}
                            {stockDisplay.conversion && <span>{stockDisplay.conversion}</span>}
                          </span>
                        ) : "-"}
                      </td>
                      <td className="text-right td-num td-value">
                        {s !== undefined ? formatCurrency(s.totalValue, currency) : "-"}
                      </td>
                      <td>
                        <span className={`badge badge--${status.variant}`}>{status.label}</span>
                      </td>
                      <td className="td-actions">
                        {item.isActive && canManageStock && (
                          <button
                            type="button"
                            className="btn btn--sm btn--action-in"
                            onClick={() => { setPendingCommandAction(null); setStockInItem(item); }}
                          >
                            Receive
                          </button>
                        )}
                        {item.isActive && (
                          <button
                            type="button"
                            className="btn btn--sm btn--action-out"
                            onClick={() => setStockOutItem(item)}
                          >
                            Use
                          </button>
                        )}
                        <div className="row-action-menu">
                          <button
                            type="button"
                            className="btn btn--sm btn--secondary row-action-menu-trigger"
                            aria-haspopup="menu"
                            aria-expanded={openActionMenuItemId === item.id}
                            onClick={() => setOpenActionMenuItemId((cur) => cur === item.id ? null : item.id)}
                          >
                            <svg className="row-action-menu-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                              <circle cx="4" cy="10" r="1.5" /><circle cx="10" cy="10" r="1.5" /><circle cx="16" cy="10" r="1.5" />
                            </svg>
                          </button>
                          {openActionMenuItemId === item.id && (
                            <div className="row-action-menu-panel" role="menu">
                              <div className="row-action-menu-section">Stock</div>
                              {item.isActive && canManageStock && (
                                <button className="row-action-menu-item" role="menuitem" onClick={() => { setOpenActionMenuItemId(null); setAdjustItem(item); }}>
                                  Adjust quantity
                                </button>
                              )}
                              {item.isActive && canManageStock && (
                                <button className="row-action-menu-item" role="menuitem" onClick={() => { setOpenActionMenuItemId(null); setOpeningStockItem(item); }}>
                                  Opening stock
                                </button>
                              )}
                              <button className="row-action-menu-item" role="menuitem" onClick={() => { setOpenActionMenuItemId(null); navigate(`/items/${item.id}/batches`); }}>
                                Batch details
                              </button>
                              {item.isActive && canManageStock && locations.length > 1 && (
                                <button className="row-action-menu-item" role="menuitem" onClick={() => { setOpenActionMenuItemId(null); setPendingCommandAction(null); setTransferItem(item); }}>
                                  Transfer
                                </button>
                              )}
                              <div className="row-action-menu-divider" />
                              <div className="row-action-menu-section">Item</div>
                              {canManageStock && (
                                <button className="row-action-menu-item" role="menuitem" onClick={() => { setOpenActionMenuItemId(null); setEditingItem(item); }}>
                                  Edit item
                                </button>
                              )}
                              <button className="row-action-menu-item" role="menuitem" onClick={() => { setOpenActionMenuItemId(null); setBarcodeItem(item); }}>
                                Barcode
                              </button>
                              {canManageStock && (
                                <button className="row-action-menu-item" role="menuitem" onClick={() => { setOpenActionMenuItemId(null); setManageSuppliersItem(item); }}>
                                  Manage suppliers
                                </button>
                              )}
                              {canManageStock && (
                                <>
                                  <div className="row-action-menu-divider" />
                                  {item.isActive ? (
                                    <button className="row-action-menu-item row-action-menu-item--danger" role="menuitem" disabled={busy.has(item.id)} onClick={() => { setOpenActionMenuItemId(null); void handleArchiveItem(item); }}>
                                      Archive
                                    </button>
                                  ) : (
                                    <button className="row-action-menu-item row-action-menu-item--success" role="menuitem" disabled={busy.has(item.id)} onClick={() => { setOpenActionMenuItemId(null); void handleReactivateItem(item); }}>
                                      Reactivate
                                    </button>
                                  )}
                                  {!item.isActive && isOwner && (
                                    <button className="row-action-menu-item row-action-menu-item--danger" role="menuitem" disabled={busy.has(item.id)} onClick={() => { setOpenActionMenuItemId(null); openPermanentDeleteModal(item); }}>
                                      Delete permanently
                                    </button>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards (hidden on desktop) */}
          <div className="item-cards">
            {filteredItems.map((item) => {
              const s = summaryMap.get(item.id);
              const usage = usageMap.get(item.id);
              const unitConfig = normalizeUnitConfig(item.unit, item.purchaseUnit, item.purchaseConversionFactor);
              const estimatedDaysRemaining = s && !unitConfig.conversionRequired && usage && usage.averageDailyUsage > 0
                ? getEstimatedDaysRemaining(s.totalQuantity, usage.averageDailyUsage)
                : null;
              const status = getStatus(s, item, item.trackExpiry, settings.expiryAlertDays);
              const selected = selectedItemIds.has(item.id);
              const stockDisplay = s ? getStockDisplayLines(s.totalQuantity, item.unit, item.purchaseUnit, item.purchaseConversionFactor) : null;
              return (
                <div key={item.id} className={`item-card ${selected ? "item-card--selected" : ""} ${!item.isActive ? "is-muted" : ""}`}>
                  <div className="item-card-header">
                    <div className="item-card-title">
                      {canManageStock && (
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={bulkSaving}
                          onChange={() => toggleItemSelection(item.id)}
                          aria-label={`Select ${item.name}`}
                        />
                      )}
                      <span className="item-card-name">{item.name}</span>
                      {!item.isActive && (
                        <span className="badge badge--gray item-lifecycle-badge">Archived</span>
                      )}
                      {item.trackExpiry && (
                        <span className="badge badge--gray item-lifecycle-badge">Expiry</span>
                      )}
                    </div>
                    <span className={`badge badge--${status.variant}`}>{status.label}</span>
                  </div>
                  <div className="item-card-meta">
                    <span className="item-card-stat">
                      <span className="item-card-stat-label">Category</span>
                      <span className="item-card-stat-value">
                        <span className={`cat-badge${!item.category ? " cat-badge--none" : ""}`}>
                          {item.category || "Uncategorized"}
                        </span>
                      </span>
                    </span>
                    {item.barcode && (
                      <span className="item-card-stat">
                        <span className="item-card-stat-label">Barcode</span>
                        <span className="item-card-stat-value">{item.barcode}</span>
                      </span>
                    )}
                    {supplierMappingMap.get(item.id)?.primary && (
                      <span className="item-card-stat">
                        <span className="item-card-stat-label">Supplier</span>
                        <span className="item-card-stat-value">
                          <span className="item-supplier-tag item-supplier-tag--primary">
                            {supplierMappingMap.get(item.id)!.primary!.supplierName}
                          </span>
                        </span>
                      </span>
                    )}
                    <span className="item-card-stat">
                      <span className="item-card-stat-label">In Stock</span>
                      <span className="item-card-stat-value">
                        {stockDisplay ? (
                          <span className="stock-display stock-display--card">
                            <strong>{stockDisplay.primary}</strong>
                            {stockDisplay.secondary && <span>{stockDisplay.secondary}</span>}
                            {stockDisplay.conversion && <span>{stockDisplay.conversion}</span>}
                          </span>
                        ) : "-"}
                      </span>
                    </span>
                    <span className="item-card-stat">
                      <span className="item-card-stat-label">Value</span>
                      <span className="item-card-stat-value">
                        {s !== undefined ? formatCurrency(s.totalValue, currency) : "-"}
                      </span>
                    </span>
                    <span className="item-card-stat">
                      <span className="item-card-stat-label">Min Level</span>
                      <span className="item-card-stat-value">{item.minStockLevel} {item.unit}</span>
                    </span>
                  </div>
                  {stockDisplay?.conversionRequired && (
                    <button type="button" className="unit-config-link" onClick={() => setEditingItem(item)}>
                      Unit conversion required
                    </button>
                  )}
                  {s?.reorder?.calculationAvailable && (s.reorder.suggestedBuyingQuantity ?? 0) > 0 && (() => {
                    return <p className="reorder-hint reorder-hint--card">Suggested reorder: {formatQty(s.reorder!.suggestedBuyingQuantity!, 0)} {unitConfig.buyingUnit}</p>;
                  })()}
                  {supplierFilter !== "all" && s?.reorder?.incomingBaseQuantity !== null && s?.reorder?.incomingBaseQuantity !== undefined && s.reorder.incomingBaseQuantity > 0 && (
                    <p className="incoming-hint incoming-hint--card">
                      Incoming: {formatQty(s.reorder.incomingBuyingQuantity ?? 0, 2)} {unitConfig.buyingUnit} / {formatQty(s.reorder.incomingBaseQuantity, 2)} {item.unit}
                    </p>
                  )}
                  {usage && (() => {
                    if (unitConfig.conversionRequired) {
                      return <p className="usage-hint usage-hint--card">Usage: {formatQty(usage.totalQuantity, 2)} {item.unit} in 7 days</p>;
                    }
                    const totalBuying = toPurchaseQuantity(usage.totalQuantity, unitConfig.conversionFactor);
                    const avgBuying = toPurchaseQuantity(usage.averageDailyUsage, unitConfig.conversionFactor);
                    return (
                      <p className="usage-hint usage-hint--card">
                        7-day usage: {formatQty(totalBuying, 2)} {unitConfig.buyingUnit} / {formatQty(usage.totalQuantity, 2)} {item.unit}
                        {" - "}Avg/day: {formatQty(avgBuying, 4)} {unitConfig.buyingUnit} / {formatQty(usage.averageDailyUsage, 4)} {item.unit}
                      </p>
                    );
                  })()}
                  {estimatedDaysRemaining !== null && s && usage && (
                    <p className={`forecast-hint forecast-hint--card forecast-hint--${getForecastTone(estimatedDaysRemaining)}`}>
                      Est. remaining: {formatDaysRemaining(estimatedDaysRemaining)} days
                      <details className="cover-details">
                        <summary>How calculated</summary>
                        <span>Available stock: {formatQty(s.totalQuantity, 2)} {item.unit}</span>
                        <span>Average daily usage: {formatQty(usage.averageDailyUsage, 6)} {item.unit}/day</span>
                        <span>Calculation: {formatQty(s.totalQuantity, 2)} / {formatQty(usage.averageDailyUsage, 6)} = {formatDaysRemaining(estimatedDaysRemaining)} days</span>
                        {unitConfig.usesBuyingUnit && (
                          <span>{formatQty(s.totalQuantity, 2)} {item.unit} = {formatQty(toPurchaseQuantity(s.totalQuantity, unitConfig.conversionFactor), 2)} {unitConfig.buyingUnit}; 1 {unitConfig.buyingUnit} = {formatQty(unitConfig.conversionFactor, 2)} {item.unit}</span>
                        )}
                      </details>
                    </p>
                  )}
                  <div className="item-card-actions">
                    {item.isActive && canManageStock && (
                      <button
                        type="button"
                        className="btn btn--sm btn--action-in"
                        onClick={() => setStockInItem(item)}
                      >
                        Receive
                      </button>
                    )}
                    {item.isActive && (
                      <button
                        type="button"
                        className="btn btn--sm btn--action-out"
                        onClick={() => setStockOutItem(item)}
                      >
                        Use
                      </button>
                    )}
                    <div className="row-action-menu">
                      <button
                        type="button"
                        className="btn btn--sm btn--secondary row-action-menu-trigger"
                        aria-haspopup="menu"
                        aria-expanded={openActionMenuItemId === item.id}
                        onClick={() => setOpenActionMenuItemId((cur) => cur === item.id ? null : item.id)}
                      >
                        More
                      </button>
                      {openActionMenuItemId === item.id && (
                        <div className="row-action-menu-panel row-action-menu-panel--card" role="menu">
                          <div className="row-action-menu-section">Stock</div>
                          {item.isActive && canManageStock && (
                            <button className="row-action-menu-item" role="menuitem" onClick={() => { setOpenActionMenuItemId(null); setAdjustItem(item); }}>
                              Adjust quantity
                            </button>
                          )}
                          {item.isActive && canManageStock && (
                            <button className="row-action-menu-item" role="menuitem" onClick={() => { setOpenActionMenuItemId(null); setOpeningStockItem(item); }}>
                              Opening stock
                            </button>
                          )}
                          <button className="row-action-menu-item" role="menuitem" onClick={() => { setOpenActionMenuItemId(null); navigate(`/items/${item.id}/batches`); }}>
                            Batch details
                          </button>
                          {item.isActive && canManageStock && locations.length > 1 && (
                            <button className="row-action-menu-item" role="menuitem" onClick={() => { setOpenActionMenuItemId(null); setPendingCommandAction(null); setTransferItem(item); }}>
                              Transfer
                            </button>
                          )}
                          <div className="row-action-menu-divider" />
                          <div className="row-action-menu-section">Item</div>
                          {canManageStock && (
                            <button className="row-action-menu-item" role="menuitem" onClick={() => { setOpenActionMenuItemId(null); setEditingItem(item); }}>
                              Edit item
                            </button>
                          )}
                          <button className="row-action-menu-item" role="menuitem" onClick={() => { setOpenActionMenuItemId(null); setBarcodeItem(item); }}>
                            Barcode
                          </button>
                          {canManageStock && (
                            <button className="row-action-menu-item" role="menuitem" onClick={() => { setOpenActionMenuItemId(null); setManageSuppliersItem(item); }}>
                              Manage suppliers
                            </button>
                          )}
                          {canManageStock && (
                            <>
                              <div className="row-action-menu-divider" />
                              {item.isActive ? (
                                <button className="row-action-menu-item row-action-menu-item--danger" role="menuitem" disabled={busy.has(item.id)} onClick={() => { setOpenActionMenuItemId(null); void handleArchiveItem(item); }}>
                                  Archive
                                </button>
                              ) : (
                                <button className="row-action-menu-item row-action-menu-item--success" role="menuitem" disabled={busy.has(item.id)} onClick={() => { setOpenActionMenuItemId(null); void handleReactivateItem(item); }}>
                                  Reactivate
                                </button>
                              )}
                              {!item.isActive && isOwner && (
                                <button className="row-action-menu-item row-action-menu-item--danger" role="menuitem" disabled={busy.has(item.id)} onClick={() => { setOpenActionMenuItemId(null); openPermanentDeleteModal(item); }}>
                                  Delete permanently
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {addItemOpen && (
        <AddItemModal
          prefillBarcode={scanPrefillBarcode}
          suppliers={suppliersList}
          onClose={() => { setAddItemOpen(false); setScanPrefillBarcode(undefined); }}
          onSuccess={(item) => {
            setItems((prev) => [item, ...prev]);
            setAddItemOpen(false);
            setScanPrefillBarcode(undefined);
            showToast(`"${item.name}" added successfully`, "success");
            void refreshSummary();
            void loadAll();
          }}
          onError={(msg) => showToast(msg, "error")}
        />
      )}

      {editingItem && (
        <EditItemModal
          item={editingItem}
          suppliers={suppliersList}
          onClose={() => setEditingItem(null)}
          onSuccess={(updatedItem) => {
            setItems((prev) => prev.map((item) => (item.id === updatedItem.id ? updatedItem : item)));
            setEditingItem(null);
            showToast(`"${updatedItem.name}" updated`, "success");
            void refreshSummary();
            void loadAll();
          }}
          onError={(msg) => showToast(msg, "error")}
        />
      )}

      {importOpen && (
        <ImportItemsModal
          existingItems={items}
          onClose={() => setImportOpen(false)}
          onSuccess={(importedCount) => {
            showToast(`Imported ${importedCount} item${importedCount === 1 ? "" : "s"}`, "success");
            void loadAll();
          }}
          onError={(msg) => showToast(msg, "error")}
        />
      )}

      {scannerOpen && (
        <Suspense fallback={<ScannerLoadingOverlay />}>
          <BarcodeScanner
            items={items}
            summaryMap={summaryMap}
            currency={currency}
            canManageStock={canManageStock}
            onClose={() => {
              setScannerOpen(false);
              void refreshSummary();
            }}
            onCreateNew={(barcode) => {
              setScannerOpen(false);
              setScanPrefillBarcode(barcode);
              setAddItemOpen(true);
            }}
          />
        </Suspense>
      )}

      {stockInItem && (
        <StockInModal
          item={stockInItem}
          suppliers={suppliersList}
          defaultSupplierId={supplierMappingMap.get(stockInItem.id)?.primary?.supplierId ?? ""}
          onClose={() => setStockInItem(null)}
          onSuccess={() => {
            setStockInItem(null);
            showToast("Stock added successfully.", "success");
            void refreshSummary();
            void refreshUsageInsights();
          }}
          onError={(msg) => showToast(msg, "error")}
        />
      )}

      {openingStockItem && (
        <OpeningStockModal
          item={openingStockItem}
          locations={locations}
          defaultLocationId={activeLocationId}
          onClose={() => setOpeningStockItem(null)}
          onSuccess={() => {
            setOpeningStockItem(null);
            showToast("Opening stock added.", "success");
            void refreshSummary();
          }}
          onError={(msg) => showToast(msg, "error")}
        />
      )}

      {stockOutItem && (
        <StockOutModal
          item={stockOutItem}
          onClose={() => setStockOutItem(null)}
          onSuccess={() => {
            setStockOutItem(null);
            showToast("Stock deducted successfully.", "success");
            void refreshSummary();
            void refreshUsageInsights();
          }}
          onError={(msg) => showToast(msg, "error")}
        />
      )}

      {adjustItem && (
        <AdjustStockModal
          item={adjustItem}
          currentQty={summaryMap.get(adjustItem.id)?.totalQuantity ?? 0}
          onClose={() => setAdjustItem(null)}
          onSuccess={(fromQty, toQty) => {
            setAdjustItem(null);
            showToast(`Stock adjusted from ${fromQty} to ${toQty}`, "success");
            void refreshSummary();
            if (toQty < fromQty) void refreshUsageInsights();
          }}
          onError={(msg) => showToast(msg, "error")}
        />
      )}

      {transferItem && (
        <TransferStockModal
          item={transferItem}
          locations={locations}
          activeLocationId={activeLocationId}
          currentQty={summaryMap.get(transferItem.id)?.totalQuantity ?? 0}
          onClose={() => setTransferItem(null)}
          onSuccess={(quantity, toLocationName) => {
            setTransferItem(null);
            showToast(`Transferred ${formatNumber(quantity)} ${transferItem.unit} to ${toLocationName}`, "success");
            void refreshSummary();
          }}
          onError={(msg) => showToast(msg, "error")}
        />
      )}

      {barcodeItem && (
        <BarcodeModal
          item={barcodeItem}
          onClose={() => setBarcodeItem(null)}
          onCopy={() => showToast("Barcode copied", "success")}
          onError={(msg) => showToast(msg, "error")}
        />
      )}

      {confirmOpts && <ConfirmModal {...confirmOpts} />}

      {deleteItem && (
        <div className="modal-overlay" onClick={() => { setDeleteItem(null); setDeleteConfirmText(""); }}>
          <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Permanently delete item</h2>
              <button type="button" className="modal-close" onClick={() => { setDeleteItem(null); setDeleteConfirmText(""); }}>
                <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="delete-confirm-banner">
                <div className="delete-confirm-banner-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                </div>
                <div className="delete-confirm-banner-body">
                  <strong>This cannot be undone.</strong>
                  <p>All stock history, batches, and purchase order lines for <strong>{deleteItem.name}</strong> will be permanently erased.</p>
                </div>
              </div>
              <div className="form-group" style={{ marginTop: 20 }}>
                <label className="form-label">
                  Type <span className="delete-confirm-name-hint">{deleteItem.name}</span> to confirm:
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder={deleteItem.name}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter" && deleteConfirmText === deleteItem.name) { void handleConfirmPermanentDelete(); } if (e.key === "Escape") { setDeleteItem(null); setDeleteConfirmText(""); } }}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn--ghost" onClick={() => { setDeleteItem(null); setDeleteConfirmText(""); }}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={deleteConfirmText !== deleteItem.name || busy.has(deleteItem.id)}
                onClick={() => { void handleConfirmPermanentDelete(); }}
              >
                {busy.has(deleteItem.id)
                  ? <><div className="spinner spinner--sm spinner--white" /> Deleting...</>
                  : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}

      {assignSupplierOpen && (
        <BulkAssignSupplierModal
          selectedItemIds={[...selectedItemIds]}
          suppliers={suppliersList}
          onClose={() => setAssignSupplierOpen(false)}
          onSuccess={(msg) => {
            setAssignSupplierOpen(false);
            showToast(msg, "success");
            void loadAll();
          }}
          onError={(msg) => showToast(msg, "error")}
        />
      )}

      {removeSupplierOpen && (
        <BulkRemoveSupplierModal
          selectedItemIds={[...selectedItemIds]}
          suppliers={suppliersList}
          onClose={() => setRemoveSupplierOpen(false)}
          onSuccess={(msg) => {
            setRemoveSupplierOpen(false);
            showToast(msg, "success");
            void loadAll();
          }}
          onError={(msg) => showToast(msg, "error")}
        />
      )}

      {manageSuppliersItem && (
        <ItemSuppliersModal
          item={manageSuppliersItem}
          suppliers={suppliersList}
          onClose={() => setManageSuppliersItem(null)}
          onSuccess={(msg) => {
            showToast(msg, "success");
            void loadAll();
          }}
          onError={(msg) => showToast(msg, "error")}
        />
      )}

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.type}`}>
            {t.type === "success" ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            )}
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}

function BulkItemsBar({
  selectedCount,
  allVisibleSelected,
  bulkCategory,
  bulkUnit,
  categoryOptions,
  unitOptions,
  progress,
  saving,
  onToggleAllVisible,
  onClear,
  onCategoryChange,
  onUnitChange,
  onApplyCategory,
  onApplyUnit,
  onEnableExpiry,
  onDisableExpiry,
  onAssignSupplier,
  onRemoveSupplier,
}: {
  selectedCount: number;
  allVisibleSelected: boolean;
  bulkCategory: string;
  bulkUnit: string;
  categoryOptions: string[];
  unitOptions: string[];
  progress: BulkProgress | null;
  saving: boolean;
  onToggleAllVisible: () => void;
  onClear: () => void;
  onCategoryChange: (value: string) => void;
  onUnitChange: (value: string) => void;
  onApplyCategory: () => void;
  onApplyUnit: () => void;
  onEnableExpiry: () => void;
  onDisableExpiry: () => void;
  onAssignSupplier: () => void;
  onRemoveSupplier: () => void;
}) {
  return (
    <div className="bulk-actions-bar" aria-live="polite">
      <div className="bulk-actions-summary">
        <strong>{selectedCount} selected</strong>
        <label className="bulk-select-all">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            disabled={saving}
            onChange={onToggleAllVisible}
          />
          Select all visible
        </label>
      </div>

      <div className="bulk-actions-controls">
        <div className="bulk-action-group">
          <select
            className="form-select bulk-select"
            value={bulkCategory}
            onChange={(e) => onCategoryChange(e.target.value)}
            disabled={saving}
            aria-label="Bulk category"
          >
            {categoryOptions.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn--sm btn--ghost" disabled={saving} onClick={onApplyCategory}>
            Update category
          </button>
        </div>

        <div className="bulk-action-group">
          <select
            className="form-select bulk-select"
            value={bulkUnit}
            onChange={(e) => onUnitChange(e.target.value)}
            disabled={saving}
            aria-label="Bulk unit"
          >
            {unitOptions.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn--sm btn--ghost" disabled={saving} onClick={onApplyUnit}>
            Update unit
          </button>
        </div>

        <button type="button" className="btn btn--sm btn--ghost" disabled={saving} onClick={onEnableExpiry}>
          Enable expiry
        </button>
        <button type="button" className="btn btn--sm btn--ghost" disabled={saving} onClick={onDisableExpiry}>
          Disable expiry
        </button>
        <div className="bulk-action-divider" />
        <button type="button" className="btn btn--sm btn--ghost" disabled={saving} onClick={onAssignSupplier} title="Assign a supplier to selected items">
          Assign supplier
        </button>
        <button type="button" className="btn btn--sm btn--ghost" disabled={saving} onClick={onRemoveSupplier} title="Remove a supplier from selected items">
          Remove supplier
        </button>
        <button type="button" className="btn btn--sm btn--secondary" disabled={saving} onClick={onClear}>
          Clear
        </button>
      </div>

      {progress && (
        <div className="bulk-progress">
          Updated {progress.updated} of {progress.total}
          {progress.failed > 0 ? ` - ${progress.failed} failed` : ""}
        </div>
      )}
    </div>
  );
}

function AddItemModal({
  prefillBarcode,
  suppliers,
  onClose,
  onSuccess,
  onError,
}: {
  prefillBarcode?: string;
  suppliers: Supplier[];
  onClose: () => void;
  onSuccess: (item: Item) => void;
  onError: (msg: string) => void;
}) {
  const { settings: modalSettings } = useWorkspaceSettings();
  const unitOptions = modalSettings.customUnits.length > 0 ? modalSettings.customUnits : FALLBACK_UNIT_OPTIONS;
  const categoryOptions = modalSettings.customCategories.length > 0 ? modalSettings.customCategories : FALLBACK_CATEGORY_OPTIONS;
  const purchaseUnitOptions = modalSettings.customPurchaseUnits ?? [];
  const [form, setForm] = useState<CreateItemInput>({ name: "", unit: unitOptions[0] ?? FALLBACK_UNIT_OPTIONS[0], category: "", barcode: prefillBarcode ?? "", minStockLevel: 0, criticalStockLevel: null, parStockLevel: null, procurementFrequency: null, customFrequencyDays: null, procurementLeadTimeDays: null, trackExpiry: false, purchaseUnit: null, purchaseConversionFactor: null, issueUnit: null, displayBothUnits: false });
  const [saving, setSaving] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [usesPurchaseUnit, setUsesPurchaseUnit] = useState(false);
  const [moreSettingsOpen, setMoreSettingsOpen] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  const purchaseUnitInvalid = usesPurchaseUnit && (!form.purchaseUnit?.trim() || !form.purchaseConversionFactor || form.purchaseConversionFactor <= 0);
  const canSubmit = !saving && form.name.trim().length > 0 && form.unit.trim().length > 0 && !purchaseUnitInvalid;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    try {
      const res = await createItem({ ...form, category: form.category?.trim() || undefined, barcode: form.barcode?.trim() || undefined, purchaseUnit: usesPurchaseUnit ? form.purchaseUnit?.trim() || null : null, purchaseConversionFactor: usesPurchaseUnit ? form.purchaseConversionFactor ?? null : null, displayBothUnits: usesPurchaseUnit ? form.displayBothUnits : false });
      if (supplierId) await putItemSuppliers(res.item.id, [{ supplierId, role: "PRIMARY" }]);
      onSuccess(res.item);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to create item");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Add Item" onClose={onClose}>
      <form onSubmit={(e) => { void handleSubmit(e); }}>
        <div className="form-group"><label className="form-label">Item Name *</label><input ref={firstRef} className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Chicken Breast" required /></div>
        <div className="form-group"><label className="form-label">Stock Unit *</label><select className="form-select" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} required>{unitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></div>
        <div className="form-group"><label className="form-label">Category</label><input className="form-input" list="add-item-category-options" value={form.category ?? ""} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Optional category" /><datalist id="add-item-category-options">{categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}</datalist></div>
        <div className="form-group"><label className="form-label">Default Supplier</label><select className="form-select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Select supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></div>
        <div className="form-group"><label className="form-label">Low Stock Alert</label><input className="form-input" type="number" min={0} step="any" value={form.minStockLevel} onChange={(e) => setForm({ ...form, minStockLevel: e.target.value === "" ? 0 : Number(e.target.value) })} /></div>
        <div className="form-group form-group--inline"><input id="trackExpiry" type="checkbox" checked={form.trackExpiry} onChange={(e) => setForm({ ...form, trackExpiry: e.target.checked })} /><label htmlFor="trackExpiry" className="form-label form-label--check">Track expiry dates</label></div>

        <details className="more-settings" open={moreSettingsOpen} onToggle={(e) => setMoreSettingsOpen(e.currentTarget.open)}>
          <summary>More settings</summary>
          <p className="form-helper">Optional settings for purchase units, barcode, and reorder planning.</p>
          <div className="form-group form-group--inline"><input id="addUsesPurchaseUnit" type="checkbox" checked={usesPurchaseUnit} onChange={(e) => { const checked = e.target.checked; setUsesPurchaseUnit(checked); if (!checked) setForm({ ...form, purchaseUnit: null, purchaseConversionFactor: null, displayBothUnits: false }); }} /><label htmlFor="addUsesPurchaseUnit" className="form-label form-label--check">Do you buy this item in a different unit?</label></div>
          {usesPurchaseUnit && <><div className="form-row-2col"><div className="form-group"><label className="form-label">Purchase Unit *</label>{purchaseUnitOptions.length > 0 ? <select className="form-select" value={form.purchaseUnit ?? ""} onChange={(e) => setForm({ ...form, purchaseUnit: e.target.value || null, purchaseConversionFactor: e.target.value ? form.purchaseConversionFactor : null })} required><option value="">Select purchase unit</option>{purchaseUnitOptions.map((u) => <option key={u} value={u}>{u}</option>)}</select> : <input className="form-input" value={form.purchaseUnit ?? ""} onChange={(e) => setForm({ ...form, purchaseUnit: e.target.value || null })} placeholder="e.g. Carton" required />}</div><div className="form-group"><label className="form-label">How many stock units in one purchase unit? *</label><input className="form-input" type="number" min={0.0001} step="any" value={form.purchaseConversionFactor ?? ""} onChange={(e) => setForm({ ...form, purchaseConversionFactor: e.target.value ? Number(e.target.value) : null })} required /></div></div>{form.purchaseUnit && form.purchaseConversionFactor && form.purchaseConversionFactor > 0 && <p className="uom-hint uom-hint--form">1 {form.purchaseUnit} = {form.purchaseConversionFactor} {form.unit}</p>}<div className="form-group form-group--inline"><input id="displayBothUnits" type="checkbox" checked={form.displayBothUnits ?? false} onChange={(e) => setForm({ ...form, displayBothUnits: e.target.checked })} /><label htmlFor="displayBothUnits" className="form-label form-label--check">Show quantity in both units in inventory</label></div></>}
          <div className="form-row-2col"><div className="form-group"><label className="form-label">SKU</label><input className="form-input" value={form.sku ?? ""} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="Optional internal SKU" /></div><div className="form-group"><label className="form-label">Barcode</label><div className="barcode-input-row"><input className="form-input" value={form.barcode ?? ""} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder="Scan or enter barcode" /><button type="button" className="btn btn--ghost btn--sm" disabled={Boolean(form.barcode?.trim())} onClick={() => setForm({ ...form, barcode: generateBarcodeValue() })}>Auto-generate</button></div></div></div>
          <div className="item-units-section item-units-section--compact"><div className="item-units-section__title">Reorder Settings</div><div className="form-row-2col"><div className="form-group"><label className="form-label">Emergency Stock Level</label><input className="form-input" type="number" min={0} step="any" value={form.criticalStockLevel ?? ""} onChange={(e) => setForm({ ...form, criticalStockLevel: e.target.value === "" ? null : Number(e.target.value) })} /></div><div className="form-group"><label className="form-label">Ideal Stock Level</label><input className="form-input" type="number" min={0} step="any" value={form.parStockLevel ?? ""} onChange={(e) => setForm({ ...form, parStockLevel: e.target.value === "" ? null : Number(e.target.value) })} /></div></div><div className="form-row-2col"><div className="form-group"><label className="form-label">Procurement Frequency</label><select className="form-select" value={form.procurementFrequency ?? ""} onChange={(e) => setForm({ ...form, procurementFrequency: e.target.value || null, customFrequencyDays: e.target.value !== "custom" ? null : form.customFrequencyDays })}><option value="">Select frequency</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option><option value="monthly">Monthly</option><option value="custom">Custom</option></select></div>{form.procurementFrequency === "custom" ? <div className="form-group"><label className="form-label">Custom Interval (days)</label><input className="form-input" type="number" min={1} step={1} value={form.customFrequencyDays ?? ""} onChange={(e) => setForm({ ...form, customFrequencyDays: e.target.value === "" ? null : Number(e.target.value) })} /></div> : <div className="form-group"><label className="form-label">Supplier Delivery Time (days)</label><input className="form-input" type="number" min={0} step={1} value={form.procurementLeadTimeDays ?? ""} onChange={(e) => setForm({ ...form, procurementLeadTimeDays: e.target.value === "" ? null : Number(e.target.value) })} /></div>}</div>{form.procurementFrequency === "custom" && <div className="form-group"><label className="form-label">Supplier Delivery Time (days)</label><input className="form-input" type="number" min={0} step={1} value={form.procurementLeadTimeDays ?? ""} onChange={(e) => setForm({ ...form, procurementLeadTimeDays: e.target.value === "" ? null : Number(e.target.value) })} /></div>}</div>
        </details>

        <div className="modal-footer"><button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn btn--primary" disabled={!canSubmit}>{saving ? <span className="btn-spinner" /> : null}{saving ? "Adding..." : "Add Item"}</button></div>
      </form>
    </Modal>
  );
}

function EditItemModal({
  item,
  suppliers,
  onClose,
  onSuccess,
  onError,
}: {
  item: Item;
  suppliers: Supplier[];
  onClose: () => void;
  onSuccess: (item: Item) => void;
  onError: (msg: string) => void;
}) {
  const { settings: editSettings } = useWorkspaceSettings();
  const unitOptions = editSettings.customUnits.length > 0 ? editSettings.customUnits : FALLBACK_UNIT_OPTIONS;
  const categoryOptions = editSettings.customCategories.length > 0 ? editSettings.customCategories : FALLBACK_CATEGORY_OPTIONS;
  const purchaseUnitOptions = editSettings.customPurchaseUnits ?? [];
  const [form, setForm] = useState<CreateItemInput>({ name: item.name, unit: item.unit, category: item.category ?? "", sku: item.sku ?? "", barcode: item.barcode ?? "", minStockLevel: item.minStockLevel, criticalStockLevel: item.criticalStockLevel ?? null, parStockLevel: item.parStockLevel ?? null, procurementFrequency: item.procurementFrequency ?? null, customFrequencyDays: item.customFrequencyDays ?? null, procurementLeadTimeDays: item.procurementLeadTimeDays ?? null, trackExpiry: item.trackExpiry, purchaseUnit: item.purchaseUnit ?? null, purchaseConversionFactor: item.purchaseConversionFactor ?? null, issueUnit: item.issueUnit ?? null, displayBothUnits: item.displayBothUnits ?? false });
  const [saving, setSaving] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [existingSupplierMappings, setExistingSupplierMappings] = useState<ItemSupplierMapping[]>([]);
  const [usesPurchaseUnit, setUsesPurchaseUnit] = useState(Boolean(item.purchaseUnit || item.purchaseConversionFactor));
  const [moreSettingsOpen, setMoreSettingsOpen] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);
  useEffect(() => {
    let alive = true;
    getItemSuppliers(item.id).then((res) => { if (!alive) return; setExistingSupplierMappings(res.suppliers); setSupplierId(res.suppliers.find((s) => s.role === "PRIMARY")?.supplierId ?? ""); }).catch(() => { if (alive) setSupplierId(""); });
    return () => { alive = false; };
  }, [item.id]);

  const advancedConfigured = Boolean(item.purchaseUnit || item.purchaseConversionFactor || item.displayBothUnits || item.sku || item.barcode || item.criticalStockLevel != null || item.parStockLevel != null || item.procurementFrequency || item.customFrequencyDays != null || item.procurementLeadTimeDays != null);
  const purchaseUnitInvalid = usesPurchaseUnit && (!form.purchaseUnit?.trim() || !form.purchaseConversionFactor || form.purchaseConversionFactor <= 0);
  const canSubmit = !saving && form.name.trim().length > 0 && form.unit.trim().length > 0 && !purchaseUnitInvalid;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    try {
      const res = await updateItem(item.id, { ...form, name: form.name.trim(), unit: form.unit.trim(), category: form.category?.trim() || null, sku: form.sku?.trim() || null, barcode: form.barcode?.trim() || null, purchaseUnit: usesPurchaseUnit ? form.purchaseUnit?.trim() || null : null, purchaseConversionFactor: usesPurchaseUnit ? form.purchaseConversionFactor ?? null : null, displayBothUnits: usesPurchaseUnit ? form.displayBothUnits : false });
      const alternateMappings = existingSupplierMappings.filter((mapping) => mapping.role === "ALTERNATE" && mapping.supplierId !== supplierId).map((mapping) => ({ supplierId: mapping.supplierId, role: "ALTERNATE" as const }));
      await putItemSuppliers(item.id, supplierId ? [{ supplierId, role: "PRIMARY" }, ...alternateMappings] : alternateMappings);
      onSuccess(res.item);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to update item");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Edit Item" onClose={onClose}>
      <form onSubmit={(e) => { void handleSubmit(e); }}>
        <div className="form-group"><label className="form-label">Item Name *</label><input ref={firstRef} className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
        <div className="form-group"><label className="form-label">Stock Unit *</label><select className="form-select" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} required>{unitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></div>
        <div className="form-group"><label className="form-label">Category</label><input className="form-input" list="edit-item-category-options" value={form.category ?? ""} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Optional category" /><datalist id="edit-item-category-options">{categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}</datalist>{item.category && !categoryOptions.includes(item.category) && <p className="form-helper">Current category is preserved unless you edit or clear it.</p>}</div>
        <div className="form-group"><label className="form-label">Default Supplier</label><select className="form-select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Select supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></div>
        <div className="form-group"><label className="form-label">Low Stock Alert</label><input className="form-input" type="number" min={0} step="any" value={form.minStockLevel} onChange={(e) => setForm({ ...form, minStockLevel: e.target.value === "" ? 0 : Number(e.target.value) })} /></div>
        <div className="form-group form-group--inline"><input id="editTrackExpiry" type="checkbox" checked={form.trackExpiry} onChange={(e) => setForm({ ...form, trackExpiry: e.target.checked })} /><label htmlFor="editTrackExpiry" className="form-label form-label--check">Track expiry dates</label></div>

        <details className="more-settings" open={moreSettingsOpen} onToggle={(e) => setMoreSettingsOpen(e.currentTarget.open)}>
          <summary>More settings{advancedConfigured && !moreSettingsOpen && <span className="more-settings-configured">More settings configured</span>}</summary>
          <p className="form-helper">Optional settings for purchase units, barcode, and reorder planning.</p>
          {item.lastReceivedDate && <div className="form-group"><label className="form-label">Last Received</label><div className="form-input form-input--readonly">{new Date(item.lastReceivedDate).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</div></div>}
          <div className="form-group form-group--inline"><input id="editUsesPurchaseUnit" type="checkbox" checked={usesPurchaseUnit} onChange={(e) => { const checked = e.target.checked; setUsesPurchaseUnit(checked); if (!checked) setForm({ ...form, purchaseUnit: null, purchaseConversionFactor: null, displayBothUnits: false }); }} /><label htmlFor="editUsesPurchaseUnit" className="form-label form-label--check">Do you buy this item in a different unit?</label></div>
          {usesPurchaseUnit && <><div className="form-row-2col"><div className="form-group"><label className="form-label">Purchase Unit *</label>{purchaseUnitOptions.length > 0 ? <select className="form-select" value={form.purchaseUnit ?? ""} onChange={(e) => setForm({ ...form, purchaseUnit: e.target.value || null, purchaseConversionFactor: e.target.value ? form.purchaseConversionFactor : null })} required><option value="">Select purchase unit</option>{purchaseUnitOptions.map((u) => <option key={u} value={u}>{u}</option>)}</select> : <input className="form-input" value={form.purchaseUnit ?? ""} onChange={(e) => setForm({ ...form, purchaseUnit: e.target.value || null })} placeholder="e.g. Carton" required />}</div><div className="form-group"><label className="form-label">How many stock units in one purchase unit? *</label><input className="form-input" type="number" min={0.0001} step="any" value={form.purchaseConversionFactor ?? ""} onChange={(e) => setForm({ ...form, purchaseConversionFactor: e.target.value ? Number(e.target.value) : null })} required /></div></div>{form.purchaseUnit && form.purchaseConversionFactor && form.purchaseConversionFactor > 0 && <p className="uom-hint uom-hint--form">1 {form.purchaseUnit} = {form.purchaseConversionFactor} {form.unit}</p>}<div className="form-group form-group--inline"><input id="editDisplayBothUnits" type="checkbox" checked={form.displayBothUnits ?? false} onChange={(e) => setForm({ ...form, displayBothUnits: e.target.checked })} /><label htmlFor="editDisplayBothUnits" className="form-label form-label--check">Show quantity in both units in inventory</label></div></>}
          <div className="form-row-2col"><div className="form-group"><label className="form-label">SKU</label><input className="form-input" value={form.sku ?? ""} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="Optional internal SKU" /></div><div className="form-group"><label className="form-label">Barcode</label><input className="form-input" value={form.barcode ?? ""} onChange={(e) => setForm({ ...form, barcode: e.target.value })} placeholder="Scan or enter barcode" /></div></div>
          <div className="item-units-section item-units-section--compact"><div className="item-units-section__title">Reorder Settings</div><div className="form-row-2col"><div className="form-group"><label className="form-label">Emergency Stock Level</label><input className="form-input" type="number" min={0} step="any" value={form.criticalStockLevel ?? ""} onChange={(e) => setForm({ ...form, criticalStockLevel: e.target.value === "" ? null : Number(e.target.value) })} /></div><div className="form-group"><label className="form-label">Ideal Stock Level</label><input className="form-input" type="number" min={0} step="any" value={form.parStockLevel ?? ""} onChange={(e) => setForm({ ...form, parStockLevel: e.target.value === "" ? null : Number(e.target.value) })} /></div></div><div className="form-row-2col"><div className="form-group"><label className="form-label">Procurement Frequency</label><select className="form-select" value={form.procurementFrequency ?? ""} onChange={(e) => setForm({ ...form, procurementFrequency: e.target.value || null, customFrequencyDays: e.target.value !== "custom" ? null : form.customFrequencyDays })}><option value="">Select frequency</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="biweekly">Bi-weekly</option><option value="monthly">Monthly</option><option value="custom">Custom</option></select></div>{form.procurementFrequency === "custom" ? <div className="form-group"><label className="form-label">Custom Interval (days)</label><input className="form-input" type="number" min={1} step={1} value={form.customFrequencyDays ?? ""} onChange={(e) => setForm({ ...form, customFrequencyDays: e.target.value === "" ? null : Number(e.target.value) })} /></div> : <div className="form-group"><label className="form-label">Supplier Delivery Time (days)</label><input className="form-input" type="number" min={0} step={1} value={form.procurementLeadTimeDays ?? ""} onChange={(e) => setForm({ ...form, procurementLeadTimeDays: e.target.value === "" ? null : Number(e.target.value) })} /></div>}</div>{form.procurementFrequency === "custom" && <div className="form-group"><label className="form-label">Supplier Delivery Time (days)</label><input className="form-input" type="number" min={0} step={1} value={form.procurementLeadTimeDays ?? ""} onChange={(e) => setForm({ ...form, procurementLeadTimeDays: e.target.value === "" ? null : Number(e.target.value) })} /></div>}</div>
        </details>
        <div className="modal-footer"><button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn btn--primary" disabled={!canSubmit}>{saving ? <span className="btn-spinner" /> : null}{saving ? "Saving..." : "Save changes"}</button></div>
      </form>
    </Modal>
  );
}

function ImportItemsModal({
  existingItems,
  onClose,
  onSuccess,
  onError,
}: {
  existingItems: Item[];
  onClose: () => void;
  onSuccess: (importedCount: number) => void;
  onError: (msg: string) => void;
}) {
  const { settings: importSettings } = useWorkspaceSettings();
  const unitOptions = importSettings.customUnits.length > 0 ? importSettings.customUnits : FALLBACK_UNIT_OPTIONS;
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ImportItemRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [apiFailedCount, setApiFailedCount] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validRows = rows.filter((row) => row.errors.length === 0);
  const pendingValidRows = rows.filter((row) => row.status === "pending" && row.errors.length === 0);
  const invalidRows = rows.filter((row) => row.errors.length > 0);
  const canImport = !parsing && !importing && pendingValidRows.length > 0;
  const importProgress = pendingValidRows.length + importedCount > 0
    ? Math.round((importedCount / (pendingValidRows.length + importedCount + apiFailedCount)) * 100)
    : 0;

  async function processFile(file: File) {
    setFileName(file.name);
    setRows([]);
    setParseError(null);
    setImportedCount(0);
    setApiFailedCount(0);
    setParsing(true);

    try {
      if (!isSupportedImportFile(file.name)) {
        throw new Error("Please upload a .csv or .xlsx file.");
      }
      const parsedRows = await parseImportFile(file);
      setRows(validateImportRows(parsedRows, existingItems, unitOptions));
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Could not read the file. Please check the format and try again.");
    } finally {
      setParsing(false);
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void processFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void processFile(file);
  }

  async function handleImport() {
    const pendingRows = rows.filter((row) => row.errors.length === 0 && row.status === "pending");
    if (pendingRows.length === 0) return;

    setImporting(true);
    setImportedCount(0);
    setApiFailedCount(0);

    let imported = 0;
    let failed = 0;

    for (const row of pendingRows) {
      try {
        const payload = {
          name: row.name,
          unit: row.unit,
          category: row.category || undefined,
          sku: row.sku || undefined,
          barcode: row.barcode || undefined,
          minStockLevel: row.minStockLevel,
          trackExpiry: row.trackExpiry,
          purchaseUnit: row.purchaseUnit || null,
          purchaseConversionFactor: row.purchaseConversionFactor,
          issueUnit: row.issueUnit || null,
        };
        if (row.importMode === "update" && row.existingItemId) {
          await updateItem(row.existingItemId, payload);
        } else {
          await createItem(payload);
        }
        imported += 1;
        setImportedCount(imported);
        setRows((prev) => prev.map((c) =>
          c.rowNumber === row.rowNumber ? { ...c, status: "imported" } : c,
        ));
      } catch (err) {
        failed += 1;
        setApiFailedCount(failed);
        const message = err instanceof Error ? err.message : "Import failed";
        setRows((prev) => prev.map((c) =>
          c.rowNumber === row.rowNumber ? { ...c, status: "failed", errors: [...c.errors, message] } : c,
        ));
      }
    }

    setImporting(false);
    if (imported > 0) onSuccess(imported);
    if (failed > 0) onError(`${failed} row${failed === 1 ? "" : "s"} failed to import.`);
  }

  function downloadSampleTemplate() {
    const headers = ["name", "unit", "category", "sku", "barcode", "minStockLevel", "trackExpiry", "purchaseUnit", "purchaseConversionFactor"];
    const sampleRows = [
      ["Chicken Breast", "kg", "Raw Material", "CHK-BRST", "SS100000001", "10", "yes", "", ""],
      ["Paper Cups", "pack", "Packaging", "CUP-250", "", "5", "no", "Carton", "24"],
      ["Cooking Oil", "liter", "Ingredients", "OIL-COOK", "", "20", "no", "Jerry Can", "5"],
    ];
    const csv = [headers, ...sampleRows].map((row) => row.map(escapeCsvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "shelfsense-items-import-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  const hasFile = fileName !== "";

  return (
    <Modal title="Import Items" onClose={onClose}>
      <div className="import-modal">

        {/* Upload zone */}
        <div
          className={`import-drop-zone ${dragging ? "import-drop-zone--over" : ""} ${hasFile && !parseError ? "import-drop-zone--has-file" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
          aria-label="Upload file"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx"
            style={{ display: "none" }}
            onChange={handleFileInput}
          />

          {parsing ? (
            <div className="import-drop-content">
              <div className="spinner" />
              <p className="import-drop-label">Reading {fileName}...</p>
            </div>
          ) : hasFile && !parseError ? (
            <div className="import-drop-content">
              <div className="import-drop-file-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="import-drop-filename">{fileName}</p>
              <p className="import-drop-change">Click to choose a different file</p>
            </div>
          ) : (
            <div className="import-drop-content">
              <div className="import-drop-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              </div>
              <p className="import-drop-label">
                {dragging ? "Drop file here" : "Drop your CSV or Excel file here"}
              </p>
              <p className="import-drop-sub">or <span className="import-drop-browse">click to browse</span></p>
            </div>
          )}
        </div>

        {/* Template download */}
        <div className="import-template-row">
          <div className="import-columns-hint">
            <span className="import-col import-col--req">name</span>
            <span className="import-col import-col--req">unit</span>
            <span className="import-col">category</span>
            <span className="import-col">sku</span>
            <span className="import-col">barcode</span>
            <span className="import-col">minStockLevel</span>
            <span className="import-col">trackExpiry</span>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={downloadSampleTemplate} style={{ flexShrink: 0 }}>
            <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 14, height: 14 }} aria-hidden="true">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            Template
          </button>
        </div>

        {/* Parse error */}
        {parseError && (
          <div className="import-parse-error">
            <svg viewBox="0 0 20 20" fill="currentColor" style={{ width: 16, height: 16, flexShrink: 0 }} aria-hidden="true">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div>
              <strong>Could not read file</strong>
              <p>{parseError}</p>
            </div>
          </div>
        )}

        {/* Summary stats */}
        {rows.length > 0 && (
          <div className="import-stats-row">
            <div className="import-stat">
              <span className="import-stat-val">{rows.length}</span>
              <span className="import-stat-label">Total rows</span>
            </div>
            <div className="import-stat import-stat--success">
              <span className="import-stat-val">{validRows.length}</span>
              <span className="import-stat-label">Valid</span>
            </div>
            {validRows.filter((r) => r.importMode === "new").length > 0 && (
              <div className="import-stat import-stat--new">
                <span className="import-stat-val">{validRows.filter((r) => r.importMode === "new").length}</span>
                <span className="import-stat-label">New</span>
              </div>
            )}
            {validRows.filter((r) => r.importMode === "update").length > 0 && (
              <div className="import-stat import-stat--update">
                <span className="import-stat-val">{validRows.filter((r) => r.importMode === "update").length}</span>
                <span className="import-stat-label">Updates</span>
              </div>
            )}
            {invalidRows.length > 0 && (
              <div className="import-stat import-stat--error">
                <span className="import-stat-val">{invalidRows.length}</span>
                <span className="import-stat-label">Errors</span>
              </div>
            )}
            {importing && (
              <div className="import-stat import-stat--importing">
                <span className="import-stat-val">{importedCount}</span>
                <span className="import-stat-label">Imported</span>
              </div>
            )}
          </div>
        )}

        {/* Progress bar */}
        {importing && (
          <div className="import-progress-wrap">
            <div className="import-progress-bar">
              <div className="import-progress-fill" style={{ width: `${importProgress}%` }} />
            </div>
            <span className="import-progress-label">Importing {importedCount} of {pendingValidRows.length + importedCount + apiFailedCount}...</span>
          </div>
        )}

        {/* Preview table */}
        {rows.length > 0 && (
          <div className="import-preview-wrap">
            <table className="table import-preview-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>Name</th>
                  <th>Unit</th>
                  <th>Category</th>
                  <th>SKU</th>
                  <th className="text-right" style={{ width: 52 }}>Min</th>
                  <th style={{ width: 60 }}>Expiry</th>
                  <th style={{ width: 72 }}>Action</th>
                  <th style={{ width: 120 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.rowNumber} className={row.errors.length > 0 ? "import-row--error" : row.status === "imported" ? "import-row--done" : ""}>
                    <td className="import-cell-num">{row.rowNumber}</td>
                    <td>{row.name || <span className="import-cell-empty">-</span>}</td>
                    <td>{row.unit || <span className="import-cell-empty">-</span>}</td>
                    <td>{row.category || <span className="import-cell-empty">-</span>}</td>
                    <td>{row.sku || <span className="import-cell-empty">-</span>}</td>
                    <td className="text-right">{row.minStockLevel || 0}</td>
                    <td>{row.trackExpiry ? "Yes" : "No"}</td>
                    <td>
                      {row.importMode === "update"
                        ? <span className="import-action-badge import-action-badge--update">Update</span>
                        : <span className="import-action-badge import-action-badge--new">New</span>}
                    </td>
                    <td>
                      {row.errors.length > 0 ? (
                        <span className="import-row-error-badge" title={row.errors.join("; ")}>
                          <svg viewBox="0 0 16 16" fill="currentColor" style={{ width: 12, height: 12 }} aria-hidden="true">
                            <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 11a.75.75 0 110-1.5.75.75 0 010 1.5zm.75-4.5a.75.75 0 01-1.5 0v-3a.75.75 0 011.5 0v3z" />
                          </svg>
                          {row.errors[0].length > 22 ? `${row.errors[0].slice(0, 22)}...` : row.errors[0]}
                        </span>
                      ) : row.status === "imported" ? (
                        <span className="import-row-ok-badge">
                          <svg viewBox="0 0 16 16" fill="currentColor" style={{ width: 12, height: 12 }} aria-hidden="true">
                            <path fillRule="evenodd" d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" clipRule="evenodd" />
                          </svg>
                          Imported
                        </span>
                      ) : row.status === "failed" ? (
                        <span className="import-row-error-badge">Failed</span>
                      ) : (
                        <span className="import-row-ready-badge">Ready</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="modal-footer">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={importing}>
            Close
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => { void handleImport(); }}
            disabled={!canImport}
          >
            {(() => {
              if (importing) return <><div className="spinner spinner--sm spinner--white" /> Importing...</>;
              if (pendingValidRows.length === 0) return rows.length > 0 ? "No valid rows to import" : "Select a file";
              const newCount = pendingValidRows.filter((r) => r.importMode === "new").length;
              const updateCount = pendingValidRows.filter((r) => r.importMode === "update").length;
              const parts: string[] = [];
              if (newCount > 0) parts.push(`${newCount} new`);
              if (updateCount > 0) parts.push(`${updateCount} update${updateCount === 1 ? "" : "s"}`);
              return `Import ${pendingValidRows.length} item${pendingValidRows.length === 1 ? "" : "s"} (${parts.join(", ")})`;
            })()}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function BarcodeModal({
  item,
  onClose,
  onCopy,
  onError,
}: {
  item: Item;
  onClose: () => void;
  onCopy: () => void;
  onError: (msg: string) => void;
}) {
  const barcode = item.barcode ?? generateStablePreviewBarcode(item.id);
  const svgRef = useRef<SVGSVGElement>(null);
  const [presetId, setPresetId] = useState<BarcodeLabelPresetId>(() =>
    readStoredOption(
      BARCODE_LABEL_PRESET_STORAGE_KEY,
      Object.keys(BARCODE_LABEL_PRESETS) as BarcodeLabelPresetId[],
      "medium",
    ),
  );
  const [templateId, setTemplateId] = useState<BarcodeLabelTemplateId>(() =>
    readStoredOption(
      BARCODE_LABEL_TEMPLATE_STORAGE_KEY,
      BARCODE_LABEL_TEMPLATES.map((template) => template.id),
      "name",
    ),
  );
  const preset = BARCODE_LABEL_PRESETS[presetId];
  const dimensions = `${preset.widthMm}mm x ${preset.heightMm}mm`;
  const showItemName = templateId === "name" || templateId === "name-details";
  const detailText = useMemo(() => {
    const parts = [];
    if (item.sku) parts.push(`SKU: ${item.sku}`);
    if (item.unit) parts.push(`Unit: ${item.unit}`);
    return parts.join(" - ");
  }, [item.sku, item.unit]);
  const showDetails = templateId === "name-details" && detailText !== "";

  useEffect(() => {
    if (!svgRef.current) return;

    JsBarcode(svgRef.current, barcode, {
      format: "CODE128",
      width: preset.barWidth,
      height: preset.barcodeHeight,
      displayValue: false,
      margin: 0,
    });
  }, [barcode, preset.barWidth, preset.barcodeHeight]);

  useEffect(() => {
    storeOption(BARCODE_LABEL_PRESET_STORAGE_KEY, presetId);
  }, [presetId]);

  useEffect(() => {
    storeOption(BARCODE_LABEL_TEMPLATE_STORAGE_KEY, templateId);
  }, [templateId]);

  async function copyBarcode() {
    try {
      await navigator.clipboard.writeText(barcode);
      onCopy();
    } catch {
      onError("Could not copy barcode");
    }
  }

  function printLabel() {
    const svgMarkup = svgRef.current?.outerHTML;
    if (!svgMarkup) return;

    const printWindow = window.open("", "_blank", "width=420,height=520");
    if (!printWindow) {
      onError("Could not open print window");
      return;
    }

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>${escapeHtml(item.name)} Label</title>
          <style>
            * { box-sizing: border-box; }
            html, body {
              width: ${preset.widthMm}mm;
              min-height: ${preset.heightMm}mm;
              margin: 0;
              padding: 0;
              background: #fff;
              font-family: Arial, sans-serif;
            }
            body {
              display: flex;
              align-items: flex-start;
              justify-content: flex-start;
            }
            .label {
              width: ${preset.widthMm}mm;
              height: ${preset.heightMm}mm;
              padding: 2mm 2.5mm;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              gap: 1.2mm;
              overflow: hidden;
              text-align: center;
              color: #111;
              break-inside: avoid;
              page-break-inside: avoid;
            }
            .name {
              max-width: 100%;
              margin: 0;
              font-size: ${presetId === "small" ? "6.5pt" : presetId === "medium" ? "8pt" : "9.5pt"};
              font-weight: 700;
              line-height: 1.05;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .details {
              max-width: 100%;
              margin: 0;
              font-size: ${presetId === "small" ? "5.5pt" : presetId === "medium" ? "6.5pt" : "7.5pt"};
              line-height: 1;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .barcode {
              width: 100%;
              flex: 1 1 auto;
              min-height: 0;
              display: flex;
              align-items: center;
              justify-content: center;
              overflow: hidden;
            }
            svg {
              display: block;
              max-width: 100%;
              max-height: 100%;
            }
            @page {
              size: ${preset.widthMm}mm ${preset.heightMm}mm;
              margin: 0;
            }
            @media print {
              html, body {
                width: ${preset.widthMm}mm;
                height: ${preset.heightMm}mm;
              }
              body {
                print-color-adjust: exact;
                -webkit-print-color-adjust: exact;
              }
              .label {
                border: 0;
              }
            }
          </style>
        </head>
        <body>
          <div class="label">
            ${showItemName ? `<h1 class="name">${escapeHtml(item.name)}</h1>` : ""}
            <div class="barcode">${svgMarkup}</div>
            ${showDetails ? `<p class="details">${escapeHtml(detailText)}</p>` : ""}
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  return (
    <Modal title="Barcode Label" onClose={onClose}>
      <div className="barcode-modal">
        <div>
          <h3 className="barcode-item-name">{item.name}</h3>
          <p className="barcode-value">{barcode}</p>
        </div>

        <div className="barcode-controls">
          <label className="form-group">
            <span className="form-label">Label size</span>
            <select
              className="form-select"
              value={presetId}
              onChange={(e) => setPresetId(e.target.value as BarcodeLabelPresetId)}
            >
              <option value="small">Small: 40mm x 20mm</option>
              <option value="medium">Medium: 50mm x 30mm</option>
              <option value="large">Large: 70mm x 40mm</option>
            </select>
          </label>
          <label className="form-group">
            <span className="form-label">Template</span>
            <select
              className="form-select"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value as BarcodeLabelTemplateId)}
            >
              {BARCODE_LABEL_TEMPLATES.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div>
          <div className="barcode-preview-header">
            <span>Label preview</span>
            <strong>{dimensions}</strong>
          </div>
          <div className="barcode-preview">
            <div
              className={`barcode-label barcode-label--${presetId}`}
              style={{ width: `${preset.widthMm}mm`, height: `${preset.heightMm}mm` }}
            >
              {showItemName && <p className="barcode-label-name">{item.name}</p>}
              <div className="barcode-label-svg-wrap">
                <svg ref={svgRef} />
              </div>
              {showDetails && <p className="barcode-label-details">{detailText}</p>}
            </div>
          </div>
        </div>

        {!item.barcode && (
          <p className="barcode-hint">
            Preview barcode only. Add a barcode to the item to save it permanently.
          </p>
        )}
        <div className="modal-footer">
          <button type="button" className="btn btn--ghost" onClick={() => { void copyBarcode(); }}>
            Copy barcode
          </button>
          <button type="button" className="btn btn--primary" onClick={printLabel}>
            Print label
          </button>
        </div>
      </div>
    </Modal>
  );
}

function StockInModal({
  item,
  suppliers,
  defaultSupplierId,
  onClose,
  onSuccess,
  onError,
}: {
  item: Item;
  suppliers: Supplier[];
  defaultSupplierId?: string;
  onClose: () => void;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const navigate = useNavigate();
  const { settings } = useWorkspaceSettings();
  const [qty, setQty] = useState("");
  const [totalPrice, setTotalPrice] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);
  useEffect(() => {
    const defaultSupplier = suppliers.find((supplier) => supplier.id === defaultSupplierId);
    if (defaultSupplier) {
      setSupplierId(defaultSupplier.id);
      setSupplierSearch(defaultSupplier.name);
    }
  }, [defaultSupplierId, suppliers]);

  const quantity = parseFloat(qty);
  const invoiceTotal = parseFloat(totalPrice);
  const quantityValid = Number.isFinite(quantity) && quantity > 0;
  const totalPriceValid = Number.isFinite(invoiceTotal) && invoiceTotal > 0;
  const calculatedUnitCost = quantityValid && totalPriceValid ? roundCurrency(invoiceTotal / quantity) : null;
  const selectedSupplier = suppliers.find((supplier) => supplier.id === supplierId) ?? null;
  const hasInvalidSupplierText = supplierSearch.trim().length > 0 && !selectedSupplier;
  const expiryValid = !item.trackExpiry || Boolean(expiryDate);
  const canSubmit = quantityValid && totalPriceValid && expiryValid && !hasInvalidSupplierText;

  function handleSupplierSearch(value: string) {
    setSupplierSearch(value);
    const match = suppliers.find((supplier) => supplier.name.toLowerCase() === value.trim().toLowerCase());
    setSupplierId(match?.id ?? "");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || calculatedUnitCost === null) return;
    setSaving(true);
    try {
      await stockIn({
        itemId: item.id,
        quantity,
        totalPrice: invoiceTotal,
        unitCost: calculatedUnitCost,
        expiryDate: expiryDate || undefined,
        supplierId: supplierId || undefined,
        note: note.trim() || undefined,
      });
      onSuccess();
    } catch (err) {
      onError(err instanceof Error && err.message ? err.message : "Unable to update stock. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Stock In - ${item.name}`} onClose={onClose}>
      <form onSubmit={(e) => { void handleSubmit(e); }}>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Quantity received * ({item.unit})</label>
            <input
              ref={firstRef}
              className="form-input"
              type="number"
              min={0.01}
              step="any"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Total Price *</label>
            <input
              className="form-input"
              type="number"
              min={0.01}
              step="any"
              value={totalPrice}
              onChange={(e) => setTotalPrice(e.target.value)}
              placeholder="0.00"
              required
            />
            <p className="form-helper">Enter the total invoice amount for this item.</p>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Calculated Unit Cost</label>
          <div className="form-input form-input--readonly">
            {calculatedUnitCost !== null ? `${formatCurrency(calculatedUnitCost, settings.currency)} / ${item.unit}` : "Enter quantity and total price"}
          </div>
        </div>
        {item.trackExpiry && (
          <div className="form-group">
            <label className="form-label">Expiry Date *</label>
            <input
              className="form-input"
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              required={item.trackExpiry}
            />
          </div>
        )}
        <div className="form-group">
          <label className="form-label">Supplier</label>
          <input
            className="form-input"
            list={`stock-in-suppliers-${item.id}`}
            value={supplierSearch}
            onChange={(e) => handleSupplierSearch(e.target.value)}
            onBlur={(e) => handleSupplierSearch(e.target.value)}
            placeholder="Select supplier"
          />
          <datalist id={`stock-in-suppliers-${item.id}`}>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.name} />
            ))}
          </datalist>
          {hasInvalidSupplierText && (
            <p className="form-helper form-helper--error">Choose a supplier from the list.</p>
          )}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              onClose();
              navigate("/suppliers");
            }}
          >
            Add new supplier
          </button>
        </div>
        <div className="form-group">
          <label className="form-label">Note (optional)</label>
          <input
            className="form-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Any notes..."
          />
        </div>
        {canSubmit && calculatedUnitCost !== null && (
          <div className="stock-in-live-summary">
            Receiving {quantity} {item.unit} of {item.name} from {selectedSupplier?.name ?? "no supplier selected"} at total {formatCurrency(invoiceTotal, settings.currency)}. Calculated unit cost: {formatCurrency(calculatedUnitCost, settings.currency)} / {item.unit}.
          </div>
        )}
        <div className="modal-footer">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={saving || !canSubmit}
          >
            {saving ? <span className="btn-spinner" /> : null}
            {saving ? "Saving..." : "Add Stock"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function OpeningStockModal({
  item,
  locations,
  defaultLocationId,
  onClose,
  onSuccess,
  onError,
}: {
  item: Item;
  locations: Location[];
  defaultLocationId: string;
  onClose: () => void;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [locationId, setLocationId] = useState(defaultLocationId);
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [expiryEstimated, setExpiryEstimated] = useState(false);
  const [supplierName, setSupplierName] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const quantity = parseFloat(qty);
    if (!quantity || quantity <= 0) return;
    setSaving(true);
    try {
      await addOpeningStock({
        itemId: item.id,
        locationId,
        quantity,
        unitCost: unitCost ? parseFloat(unitCost) : undefined,
        batchNo: batchNo.trim() || undefined,
        expiryDate: expiryDate || undefined,
        expiryEstimated: expiryEstimated || undefined,
        supplierName: supplierName.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onSuccess();
    } catch (err) {
      onError(err instanceof Error && err.message ? err.message : "Unable to add opening stock. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Opening Stock - ${item.name}`} onClose={onClose}>
      <form onSubmit={(e) => { void handleSubmit(e); }}>
        <p className="form-hint" style={{ marginBottom: "1rem" }}>
          Record your starting inventory balance for this item. This creates a stock-in movement with reason <strong>opening_balance</strong>.
        </p>

        {locations.length > 1 && (
          <div className="form-group">
            <label className="form-label">Location *</label>
            <select
              className="form-select"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>{loc.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Opening quantity * ({item.unit})</label>
            <input
              ref={firstRef}
              className="form-input"
              type="number"
              min={0.001}
              step="any"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Unit cost <span className="form-label-opt">(optional)</span></label>
            <input
              className="form-input"
              type="number"
              min={0}
              step="any"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
              placeholder="0.00"
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Batch / Lot no. <span className="form-label-opt">(optional)</span></label>
            <input
              className="form-input"
              value={batchNo}
              onChange={(e) => setBatchNo(e.target.value)}
              placeholder="e.g. LOT-001"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Supplier name <span className="form-label-opt">(optional)</span></label>
            <input
              className="form-input"
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              placeholder="Supplier name"
            />
          </div>
        </div>

        {item.trackExpiry && (
          <div className="form-group">
            <label className="form-label">Expiry date *</label>
            <input
              className="form-input"
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              required={item.trackExpiry}
            />
            <label className="form-checkbox-label" style={{ marginTop: "0.4rem" }}>
              <input
                type="checkbox"
                checked={expiryEstimated}
                onChange={(e) => setExpiryEstimated(e.target.checked)}
              />
              Expiry date is estimated
            </label>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Notes <span className="form-label-opt">(optional)</span></label>
          <input
            className="form-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Counted at period start"
          />
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={saving || !qty || parseFloat(qty) <= 0 || (item.trackExpiry && !expiryDate)}
          >
            {saving ? <span className="btn-spinner" /> : null}
            {saving ? "Saving..." : "Record Opening Stock"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function StockOutModal({
  item,
  onClose,
  onSuccess,
  onError,
}: {
  item: Item;
  onClose: () => void;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("kitchen_usage");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const quantity = parseFloat(qty);
    if (!quantity || quantity <= 0) return;
    setSaving(true);
    try {
      await stockOut({
        itemId: item.id,
        quantity,
        reason,
        note: note.trim() || undefined,
      });
      onSuccess();
    } catch (err) {
      onError(err instanceof Error && err.message ? err.message : "Unable to update stock. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Use / Deduct - ${item.name}`} onClose={onClose}>
      <form onSubmit={(e) => { void handleSubmit(e); }}>
        <div className="form-group">
          <label className="form-label">Quantity * ({item.unit})</label>
          <input
            ref={firstRef}
            className="form-input"
            type="number"
            min={0.01}
            step="any"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="0"
            required
          />
        </div>
        <div className="form-group">
          <label className="form-label">Reason</label>
          <select
            className="form-select"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            <option value="kitchen_usage">Kitchen Usage</option>
            <option value="wastage">Wastage</option>
            <option value="manual_adjustment">Manual Adjustment</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Note (optional)</label>
          <input
            className="form-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Any notes..."
          />
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn--primary btn--danger"
            disabled={saving || !qty || parseFloat(qty) <= 0}
          >
            {saving ? <span className="btn-spinner" /> : null}
            {saving ? "Deducting..." : "Deduct Stock"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AdjustStockModal({
  item,
  currentQty,
  onClose,
  onSuccess,
  onError,
}: {
  item: Item;
  currentQty: number;
  onClose: () => void;
  onSuccess: (fromQty: number, toQty: number) => void;
  onError: (msg: string) => void;
}) {
  const [newQtyStr, setNewQtyStr] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const newQty = newQtyStr === "" ? null : parseFloat(newQtyStr);
  const isValidQty = newQty !== null && Number.isFinite(newQty) && newQty >= 0;
  const delta = isValidQty ? newQty! - currentQty : null;
  const noChange = delta === 0;
  const canSubmit = !saving && isValidQty && !noChange;

  function deltaLabel() {
    if (delta === null) return null;
    if (delta === 0) return { text: "No change", cls: "adjust-preview--none" };
    const abs = Math.abs(delta);
    return {
      text: delta > 0 ? `+${abs} will be added` : `${abs} will be deducted`,
      cls: delta > 0 ? "adjust-preview--add" : "adjust-preview--remove",
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || delta === null || newQty === null) return;
    setSaving(true);
    try {
      const trimmedNote = note.trim();
      const noteStr = trimmedNote
        ? `Stock adjustment: ${trimmedNote}`
        : "Stock adjustment";
      if (delta > 0) {
        await stockIn({ itemId: item.id, quantity: delta, note: noteStr });
      } else {
        await stockOut({
          itemId: item.id,
          quantity: -delta,
          reason: "manual_adjustment",
          note: noteStr,
        });
      }
      onSuccess(currentQty, newQty);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Adjustment failed");
      setSaving(false);
    }
  }

  const preview = deltaLabel();
  const btnLabel = isValidQty && !noChange
    ? `Set to ${newQty} ${item.unit}`
    : "Set Quantity";

  return (
    <Modal title={`Adjust Stock - ${item.name}`} onClose={onClose}>
      <form onSubmit={(e) => { void handleSubmit(e); }}>
        {/* Current stock reference */}
        <div className="adjust-current-stock">
          <span className="adjust-current-label">Current stock</span>
          <span className="adjust-current-value">
            {currentQty} <span className="adjust-current-unit">{item.unit}</span>
          </span>
        </div>

        <div className="form-group">
          <label className="form-label">New quantity ({item.unit}) *</label>
          <input
            ref={inputRef}
            className="form-input"
            type="number"
            min={0}
            step="any"
            value={newQtyStr}
            onChange={(e) => setNewQtyStr(e.target.value)}
            placeholder={String(currentQty)}
            required
          />
        </div>

        {/* Difference preview */}
        {preview && (
          <div className={`adjust-preview ${preview.cls}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="adjust-preview-icon">
              {delta! > 0 ? (
                <>
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <polyline points="19 12 12 19 5 12" transform="rotate(180 12 12)" />
                </>
              ) : delta! < 0 ? (
                <>
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <polyline points="19 12 12 19 5 12" />
                </>
              ) : (
                <line x1="5" y1="12" x2="19" y2="12" />
              )}
            </svg>
            {preview.text}
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Note (optional)</label>
          <input
            className="form-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reason for adjustment..."
          />
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={!canSubmit}
          >
            {saving ? <span className="btn-spinner" /> : null}
            {saving ? "Saving..." : btnLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TransferStockModal({
  item,
  locations,
  activeLocationId,
  currentQty,
  onClose,
  onSuccess,
  onError,
}: {
  item: Item;
  locations: Location[];
  activeLocationId: string;
  currentQty: number;
  onClose: () => void;
  onSuccess: (quantity: number, toLocationName: string) => void;
  onError: (msg: string) => void;
}) {
  const [fromLocationId, setFromLocationId] = useState(activeLocationId);
  const [toLocationId, setToLocationId] = useState(
    locations.find((location) => location.id !== activeLocationId)?.id ?? "",
  );
  const [qty, setQty] = useState("");
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  const quantity = parseFloat(qty);
  const canSubmit =
    !saving &&
    fromLocationId !== "" &&
    toLocationId !== "" &&
    fromLocationId !== toLocationId &&
    Number.isFinite(quantity) &&
    quantity > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    const toLocationName =
      locations.find((location) => location.id === toLocationId)?.name ?? "branch";

    setSaving(true);
    try {
      await stockTransfer({
        itemId: item.id,
        fromLocationId,
        toLocationId,
        quantity,
      });
      onSuccess(quantity, toLocationName);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Transfer failed");
      setSaving(false);
    }
  }

  return (
    <Modal title={`Transfer Stock - ${item.name}`} onClose={onClose}>
      <form onSubmit={(e) => { void handleSubmit(e); }}>
        <div className="adjust-current-stock">
          <span className="adjust-current-label">Current branch stock</span>
          <span className="adjust-current-value">
            {formatNumber(currentQty)} <span className="adjust-current-unit">{item.unit}</span>
          </span>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">From location</label>
            <select
              className="form-select"
              value={fromLocationId}
              onChange={(e) => {
                const nextFrom = e.target.value;
                setFromLocationId(nextFrom);
                if (nextFrom === toLocationId) {
                  setToLocationId(locations.find((location) => location.id !== nextFrom)?.id ?? "");
                }
              }}
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">To location</label>
            <select
              className="form-select"
              value={toLocationId}
              onChange={(e) => setToLocationId(e.target.value)}
            >
              <option value="">Select branch</option>
              {locations
                .filter((location) => location.id !== fromLocationId)
                .map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
            </select>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Quantity * ({item.unit})</label>
          <input
            ref={firstRef}
            className="form-input"
            type="number"
            min={0.01}
            step="any"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="0"
            required
          />
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
            {saving ? <span className="btn-spinner" /> : null}
            {saving ? "Transferring..." : "Transfer Stock"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function isSupportedImportFile(fileName: string) {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".csv") || lower.endsWith(".xlsx");
}

async function parseImportFile(file: File) {
  if (file.name.toLowerCase().endsWith(".csv")) {
    return tableRowsToRecords(parseCsvRows(await file.text()));
  }

  const readXlsxFile = (await import("read-excel-file/browser")).default;
  // The runtime return is Row[] for a single-sheet read; cast through unknown to satisfy TS
  const result = (await readXlsxFile(file)) as unknown;
  // Handle both Sheet[] (if multi-sheet mode) and Row[] (default mode)
  const rows: unknown[][] = Array.isArray(result) && result.length > 0 && result[0] !== null && typeof result[0] === "object" && !Array.isArray(result[0]) && "data" in (result[0] as object)
    ? ((result[0] as { data: unknown[][] }).data ?? [])
    : (result as unknown[][]);

  if (!rows || rows.length === 0) {
    throw new Error("The selected file is empty or contains no rows.");
  }

  return tableRowsToRecords(rows);
}

function tableRowsToRecords(rows: unknown[][]) {
  const [headerRow, ...dataRows] = rows;

  if (!headerRow) {
    throw new Error("The selected file is empty.");
  }

  const headers = headerRow.map((cell) => parseImportString(cell));

  if (!headers.some(Boolean)) {
    throw new Error("The selected file must include a header row.");
  }

  return dataRows
    .filter((row) => row.some((cell) => parseImportString(cell) !== ""))
    .map((row) => {
      const record: Record<string, unknown> = {};
      headers.forEach((header, index) => {
        if (header) record[header] = row[index] ?? "";
      });
      return record;
    });
}

function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);
  return rows.filter((candidate) => candidate.some((value) => value.trim() !== ""));
}

function validateImportRows(records: Array<Record<string, unknown>>, existingItems: Item[], allUnits: string[] = FALLBACK_UNIT_OPTIONS) {
  const existingByName = new Map(
    existingItems.map((item) => [item.name.trim().toLowerCase(), item]),
  );
  const existingBarcodes = new Map(
    existingItems
      .filter((item) => item.barcode)
      .map((item) => [normalizeBarcode(item.barcode ?? ""), item.id]),
  );
  const fileBarcodeCounts = new Map<string, number>();

  const rows = records.map((record, index) => {
    const normalized = normalizeImportRecord(record);
    const barcodeKey = normalizeBarcode(normalized.barcode);
    if (barcodeKey) {
      fileBarcodeCounts.set(barcodeKey, (fileBarcodeCounts.get(barcodeKey) ?? 0) + 1);
    }
    const nameKey = normalized.name.trim().toLowerCase();
    const existingMatch = existingByName.get(nameKey) ?? null;

    return {
      rowNumber: index + 2,
      ...normalized,
      importMode: (existingMatch ? "update" : "new") as "new" | "update",
      existingItemId: existingMatch?.id ?? null,
      errors: normalized.errors,
      status: "pending" as const,
    };
  });

  return rows.map((row) => {
    const errors: string[] = [...row.errors];
    const barcodeKey = normalizeBarcode(row.barcode);

    if (!row.name) errors.push("Name is required");
    if (!row.unit) errors.push("Unit is required");
    if (row.unit && !allUnits.includes(row.unit)) {
      errors.push(`Unit must be one of: ${allUnits.join(", ")}`);
    }
    if (barcodeKey) {
      const barcodeOwner = existingBarcodes.get(barcodeKey);
      if (barcodeOwner && barcodeOwner !== row.existingItemId) {
        errors.push("Barcode already used by a different item");
      }
    }
    if (barcodeKey && (fileBarcodeCounts.get(barcodeKey) ?? 0) > 1) {
      errors.push("Duplicate barcode in file");
    }
    if (!Number.isFinite(row.minStockLevel) || row.minStockLevel < 0) {
      errors.push("Min stock level must be zero or greater");
    }
    if (row.purchaseUnit && !row.purchaseConversionFactor) {
      errors.push("purchaseConversionFactor is required when purchaseUnit is set");
    }

    return { ...row, errors };
  });
}

function normalizeImportRecord(record: Record<string, unknown>) {
  const values = new Map<string, unknown>();

  for (const [key, value] of Object.entries(record)) {
    values.set(normalizeColumnName(key), value);
  }

  const rawUnit = parseImportString(values.get("unit"));
  const unit = normalizeUnit(rawUnit);
  const minStockLevelResult = parseOptionalNumber(values.get("minstocklevel"));
  const trackExpiryResult = parseOptionalBoolean(values.get("trackexpiry"));
  const purchaseUnit = parseImportString(values.get("purchaseunit"));
  const purchaseConversionFactorResult = parseOptionalConversionFactor(values.get("purchaseconversionfactor"));
  const issueUnit = parseImportString(values.get("issueunit"));

  return {
    name: parseImportString(values.get("name")),
    unit,
    category: parseImportString(values.get("category")),
    sku: parseImportString(values.get("sku")),
    barcode: parseImportString(values.get("barcode")),
    minStockLevel: minStockLevelResult.value,
    trackExpiry: trackExpiryResult.value,
    purchaseUnit,
    purchaseConversionFactor: purchaseConversionFactorResult.value,
    issueUnit,
    errors: [
      ...minStockLevelResult.errors,
      ...trackExpiryResult.errors,
      ...purchaseConversionFactorResult.errors,
    ],
  };
}

function normalizeColumnName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseImportString(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeUnit(value: string) {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  return FALLBACK_UNIT_OPTIONS.find((unit) => unit.toLowerCase() === lower) ?? trimmed;
}

function normalizeBarcode(value: string | null | undefined) {
  if (!value) return "";
  return String(value).trim().toLowerCase();
}

function parseOptionalNumber(value: unknown) {
  const raw = parseImportString(value);
  if (!raw) return { value: 0, errors: [] };

  const parsed = Number(raw);
  return Number.isFinite(parsed)
    ? { value: parsed, errors: [] }
    : { value: 0, errors: ["Min stock level must be a number"] };
}

function parseOptionalConversionFactor(value: unknown) {
  const raw = parseImportString(value);
  if (!raw) return { value: null as number | null, errors: [] };
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { value: null as number | null, errors: ["purchaseConversionFactor must be a positive number"] };
  }
  return { value: parsed as number | null, errors: [] };
}

function parseOptionalBoolean(value: unknown) {
  const raw = parseImportString(value).toLowerCase();
  if (!raw) return { value: false, errors: [] };
  if (["true", "yes", "1"].includes(raw)) return { value: true, errors: [] };
  if (["false", "no", "0"].includes(raw)) return { value: false, errors: [] };
  return { value: false, errors: ["trackExpiry must be true/false, yes/no, or 1/0"] };
}

function escapeCsvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function generateBarcodeValue() {
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.floor(Math.random() * 10_000).toString().padStart(4, "0");
  return `SS${timestamp}${random}`;
}

function generateStablePreviewBarcode(itemId: string) {
  return `SS${itemId.replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function readStoredOption<T extends string>(key: string, allowed: T[], fallback: T) {
  try {
    const stored = localStorage.getItem(key);
    return stored && allowed.includes(stored as T) ? (stored as T) : fallback;
  } catch {
    return fallback;
  }
}

function storeOption(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* localStorage may be unavailable in private or restricted browser modes */
  }
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function ScannerLoadingOverlay() {
  return (
    <div className="scanner-overlay" aria-label="Loading scanner..." aria-busy="true">
      <div className="scanner-loading">
        <div className="spinner scanner-loading-spinner" />
        <p className="scanner-loading-text">Loading scanner...</p>
      </div>
    </div>
  );
}

// Supplier Modal Components

function SupplierModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div className="sm-modal-overlay" onClick={onClose}>
      <div className="sm-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sm-modal-header">
          <h2 className="sm-modal-title">{title}</h2>
          <button type="button" className="sm-modal-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function BulkAssignSupplierModal({
  selectedItemIds,
  suppliers,
  onClose,
  onSuccess,
  onError,
}: {
  selectedItemIds: string[];
  suppliers: Supplier[];
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [role, setRole] = useState<"PRIMARY" | "ALTERNATE">("PRIMARY");
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [convertOld, setConvertOld] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ assigned: number; skipped: number; failed: number } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId) return;
    setSaving(true);
    try {
      const res = await bulkAssignSupplier({
        itemIds: selectedItemIds,
        supplierId,
        role,
        replaceExistingPrimary: replaceExisting,
        convertOldPrimaryToAlternate: convertOld,
      });
      setResult({ assigned: res.assigned, skipped: res.skipped, failed: res.failed });
      if (res.assigned > 0) {
        onSuccess(`Assigned supplier to ${res.assigned} item${res.assigned === 1 ? "" : "s"}${res.skipped > 0 ? ` (${res.skipped} skipped)` : ""}`);
      } else {
        setResult(res);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to assign supplier");
    } finally {
      setSaving(false);
    }
  }

  if (suppliers.length === 0) {
    return (
      <SupplierModalShell title="Assign Supplier" onClose={onClose}>
        <div className="sm-modal-body">
          <p className="sm-empty">No suppliers found. Add suppliers first before assigning them to items.</p>
        </div>
        <div className="sm-modal-footer">
          <button type="button" className="btn btn--secondary" onClick={onClose}>Close</button>
        </div>
      </SupplierModalShell>
    );
  }

  return (
    <SupplierModalShell title={`Assign Supplier - ${selectedItemIds.length} item${selectedItemIds.length === 1 ? "" : "s"}`} onClose={onClose}>
      <form onSubmit={(e) => { void handleSubmit(e); }}>
        <div className="sm-modal-body">
          <div className="sm-form-row">
            <div className="sm-form-group">
              <label className="sm-form-label" htmlFor="bulk-assign-supplier">Supplier</label>
              <select
                id="bulk-assign-supplier"
                className="form-select"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                required
              >
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="sm-form-group">
              <label className="sm-form-label" htmlFor="bulk-assign-role">Role</label>
              <select
                id="bulk-assign-role"
                className="form-select"
                value={role}
                onChange={(e) => setRole(e.target.value as "PRIMARY" | "ALTERNATE")}
              >
                <option value="PRIMARY">Primary</option>
                <option value="ALTERNATE">Alternate</option>
              </select>
            </div>
          </div>
          {role === "PRIMARY" && (
            <>
              <label className="form-checkbox-row" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, cursor: "pointer" }}>
                <input type="checkbox" checked={replaceExisting} onChange={(e) => setReplaceExisting(e.target.checked)} />
                <span className="sm-form-label" style={{ margin: 0 }}>Replace existing primary supplier</span>
              </label>
              {replaceExisting && (
                <label className="form-checkbox-row" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, cursor: "pointer" }}>
                  <input type="checkbox" checked={convertOld} onChange={(e) => setConvertOld(e.target.checked)} />
                  <span className="sm-form-label" style={{ margin: 0 }}>Convert old primary to alternate</span>
                </label>
              )}
            </>
          )}
          {result && result.assigned === 0 && (
            <div className={`sm-result-box ${result.failed > 0 ? "sm-result-box--error" : "sm-result-box--warning"}`}>
              <div className="sm-result-title">No items updated</div>
              <p>Skipped: {result.skipped} - Failed: {result.failed}</p>
            </div>
          )}
        </div>
        <div className="sm-modal-footer">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={saving || !supplierId}>
            {saving ? <><div className="spinner spinner--sm spinner--white" /> Assigning...</> : `Assign to ${selectedItemIds.length} item${selectedItemIds.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </form>
    </SupplierModalShell>
  );
}

function BulkRemoveSupplierModal({
  selectedItemIds,
  suppliers,
  onClose,
  onSuccess,
  onError,
}: {
  selectedItemIds: string[];
  suppliers: Supplier[];
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [role, setRole] = useState<"PRIMARY" | "ALTERNATE" | "ANY">("ANY");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supplierId) return;
    setSaving(true);
    try {
      const res = await bulkRemoveSupplier({ itemIds: selectedItemIds, supplierId, role });
      if (res.removed > 0) {
        onSuccess(`Removed ${res.removed} mapping${res.removed === 1 ? "" : "s"}${res.skipped > 0 ? ` (${res.skipped} had no match)` : ""}`);
      } else {
        onError("No supplier mappings found to remove for selected items");
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to remove supplier");
    } finally {
      setSaving(false);
    }
  }

  if (suppliers.length === 0) {
    return (
      <SupplierModalShell title="Remove Supplier" onClose={onClose}>
        <div className="sm-modal-body"><p className="sm-empty">No suppliers configured.</p></div>
        <div className="sm-modal-footer"><button type="button" className="btn btn--secondary" onClick={onClose}>Close</button></div>
      </SupplierModalShell>
    );
  }

  return (
    <SupplierModalShell title={`Remove Supplier - ${selectedItemIds.length} item${selectedItemIds.length === 1 ? "" : "s"}`} onClose={onClose}>
      <form onSubmit={(e) => { void handleSubmit(e); }}>
        <div className="sm-modal-body">
          <div className="sm-form-row">
            <div className="sm-form-group">
              <label className="sm-form-label" htmlFor="bulk-remove-supplier">Supplier</label>
              <select id="bulk-remove-supplier" className="form-select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="sm-form-group">
              <label className="sm-form-label" htmlFor="bulk-remove-role">Role to remove</label>
              <select id="bulk-remove-role" className="form-select" value={role} onChange={(e) => setRole(e.target.value as "PRIMARY" | "ALTERNATE" | "ANY")}>
                <option value="ANY">Any role</option>
                <option value="PRIMARY">Primary only</option>
                <option value="ALTERNATE">Alternate only</option>
              </select>
            </div>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-secondary, #64748b)" }}>
            This will remove the selected supplier mapping from all {selectedItemIds.length} selected items.
          </p>
        </div>
        <div className="sm-modal-footer">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--danger" disabled={saving || !supplierId}>
            {saving ? <><div className="spinner spinner--sm spinner--white" /> Removing...</> : "Remove mapping"}
          </button>
        </div>
      </form>
    </SupplierModalShell>
  );
}

function ItemSuppliersModal({
  item,
  suppliers,
  onClose,
  onSuccess,
  onError,
}: {
  item: Item;
  suppliers: Supplier[];
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [mappings, setMappings] = useState<ItemSupplierMapping[]>([]);
  const [loadingMappings, setLoadingMappings] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addSupplierId, setAddSupplierId] = useState(suppliers[0]?.id ?? "");
  const [addRole, setAddRole] = useState<"PRIMARY" | "ALTERNATE">("PRIMARY");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await getItemSuppliers(item.id);
        if (!cancelled) setMappings(res.suppliers);
      } catch { /* silent */ }
      finally { if (!cancelled) setLoadingMappings(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [item.id]);

  async function handleSave(newMappings: Array<{ supplierId: string; role: "PRIMARY" | "ALTERNATE" }>) {
    setSaving(true);
    try {
      const res = await putItemSuppliers(item.id, newMappings);
      setMappings(res.suppliers);
      onSuccess(`Supplier mappings updated for "${item.name}"`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to update suppliers");
    } finally {
      setSaving(false);
    }
  }

  function handleRemove(mappingId: string) {
    const next = mappings.filter((m) => m.id !== mappingId);
    void handleSave(next.map((m) => ({ supplierId: m.supplierId, role: m.role })));
  }

  function handleAdd() {
    if (!addSupplierId) return;
    const alreadyExists = mappings.some((m) => m.supplierId === addSupplierId && m.role === addRole);
    if (alreadyExists) {
      onError(`This supplier is already mapped as ${addRole.toLowerCase()} for this item`);
      return;
    }
    const next = [...mappings.map((m) => ({ supplierId: m.supplierId, role: m.role })), { supplierId: addSupplierId, role: addRole }];
    void handleSave(next);
  }

  const usedSupplierIds = new Set(mappings.map((m) => m.supplierId));
  const availableSuppliers = suppliers.filter((s) => !usedSupplierIds.has(s.id));

  return (
    <SupplierModalShell title={`Manage Suppliers - ${item.name}`} onClose={onClose}>
      <div className="sm-modal-body">
        {loadingMappings ? (
          <div style={{ textAlign: "center", padding: "24px 0" }}><div className="spinner" /></div>
        ) : mappings.length === 0 ? (
          <p className="sm-empty">No suppliers assigned to this item yet.</p>
        ) : (
          <div className="sm-mapping-list">
            {mappings.map((m) => (
              <div key={m.id} className="sm-mapping-row">
                <div className="sm-mapping-row-supplier">
                  <span className="sm-mapping-row-supplier-name">{m.supplierName}</span>
                  {m.supplierItemCode && <span style={{ fontSize: 11, color: "var(--text-muted, #94a3b8)" }}> - Code: {m.supplierItemCode}</span>}
                </div>
                <span className={`item-supplier-tag item-supplier-tag--${m.role === "PRIMARY" ? "primary" : "alternate"}`}>
                  {m.role === "PRIMARY" ? "Primary" : "Alternate"}
                </span>
                <div className="sm-mapping-row-actions">
                  <button type="button" className="btn btn--sm btn--ghost" disabled={saving} onClick={() => handleRemove(m.id)} title="Remove mapping">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {availableSuppliers.length > 0 && (
          <>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Add supplier</div>
            <div className="sm-add-row">
              <select className="form-select" value={addSupplierId} onChange={(e) => setAddSupplierId(e.target.value)} style={{ flex: 1 }}>
                {availableSuppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select className="form-select" value={addRole} onChange={(e) => setAddRole(e.target.value as "PRIMARY" | "ALTERNATE")} style={{ width: 130 }}>
                <option value="PRIMARY">Primary</option>
                <option value="ALTERNATE">Alternate</option>
              </select>
              <button type="button" className="btn btn--primary btn--sm" disabled={saving || !addSupplierId} onClick={handleAdd}>
                {saving ? <div className="spinner spinner--sm spinner--white" /> : "Add"}
              </button>
            </div>
          </>
        )}
        {suppliers.length === 0 && (
          <p className="sm-empty">No suppliers in your workspace. Add suppliers first.</p>
        )}
      </div>
      <div className="sm-modal-footer">
        <button type="button" className="btn btn--secondary" onClick={onClose}>Done</button>
      </div>
    </SupplierModalShell>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}



