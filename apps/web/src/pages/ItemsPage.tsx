import JsBarcode from "jsbarcode";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { archiveItem, createItem, getItems, reactivateItem, updateItem } from "../api/items";
import { getStockMovements, getStockSummary, stockIn, stockOut, stockTransfer } from "../api/stock";
import { useAuth } from "../context/AuthContext";
import { useLocation } from "../context/LocationContext";
import { useWorkspaceSettings } from "../context/WorkspaceSettingsContext";
import type { CreateItemInput, Item, Location, StockMovement, StockSummaryItem } from "../types";
import { formatCurrency } from "../utils/currency";
import { getSuggestedReorderQuantity } from "../utils/reorder";
import {
  getEstimatedDaysRemaining,
  getForecastTone,
  getLastSevenDaysRange,
  getUsageInsights,
} from "../utils/usage";

const BarcodeScanner = lazy(() =>
  import("../components/BarcodeScanner").then((m) => ({ default: m.BarcodeScanner })),
);

interface Toast {
  id: number;
  msg: string;
  type: "success" | "error";
}

let toastSeq = 0;

const UNIT_OPTIONS = [
  "kg", "g", "liter", "ml", "pcs", "pack", "box", "dozen", "bottle", "can", "bag",
];

const CATEGORY_OPTIONS = [
  "Raw Material", "Beverage", "Packaging", "Cleaning", "Finished Goods", "Other",
];

interface StatusInfo { label: string; variant: "green" | "orange" | "red" | "gray" }

type BarcodeLabelPresetId = "small" | "medium" | "large";
type BarcodeLabelTemplateId = "barcode-only" | "name" | "name-details";
type ItemStatusFilter = "all" | "ok" | "low" | "expiring" | "expired" | "archived";
type ItemSortKey = "name" | "stock-asc" | "stock-desc" | "value-desc" | "recent";

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
  trackExpiry: boolean,
  expiryAlertDays: number,
): StatusInfo {
  if (!s) return { label: "No data", variant: "gray" };
  const now = Date.now();
  if (trackExpiry && s.nearestExpiryDate) {
    const exp = new Date(s.nearestExpiryDate).getTime();
    if (exp < now) return { label: "Expired", variant: "red" };
    if (exp <= now + expiryAlertDays * 86_400_000) return { label: "Expiring", variant: "orange" };
  }
  if (s.isLowStock) return { label: "Low Stock", variant: "orange" };
  return { label: "OK", variant: "green" };
}

export function ItemsPage() {
  const { user } = useAuth();
  const { activeLocationId, locations } = useLocation();
  const { settings } = useWorkspaceSettings();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const canManageStock = user?.role === "OWNER" || user?.role === "MANAGER";
  const currency = settings.currency;
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
  const [stockOutItem, setStockOutItem] = useState<Item | null>(null);
  const [adjustItem, setAdjustItem] = useState<Item | null>(null);
  const [transferItem, setTransferItem] = useState<Item | null>(null);
  const [barcodeItem, setBarcodeItem] = useState<Item | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(() => new Set());
  const [bulkCategory, setBulkCategory] = useState(CATEGORY_OPTIONS[0]);
  const [bulkUnit, setBulkUnit] = useState(UNIT_OPTIONS[0]);
  const [bulkProgress, setBulkProgress] = useState<BulkProgress | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<ItemStatusFilter>("all");
  const [sortBy, setSortBy] = useState<ItemSortKey>("name");
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [openActionMenuItemId, setOpenActionMenuItemId] = useState<string | null>(null);
  const [pendingCommandAction, setPendingCommandAction] = useState<"stock-in" | "transfer" | null>(null);
  const inventorySearchRef = useRef<HTMLInputElement>(null);
  const selectedCount = selectedItemIds.size;
  const usageMap = useMemo(
    () => new Map(getUsageInsights(usageMovements).map((usage) => [usage.itemId, usage])),
    [usageMovements],
  );
  const categoryOptions = useMemo(() => {
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
      const status = getStatus(summary, item.trackExpiry, settings.expiryAlertDays);
      const matchesSearch =
        !query ||
        item.name.toLowerCase().includes(query) ||
        item.unit.toLowerCase().includes(query) ||
        item.category?.toLowerCase().includes(query) ||
        item.sku?.toLowerCase().includes(query) ||
        item.barcode?.toLowerCase().includes(query);
      const matchesCategory = categoryFilter === "all" || item.category === categoryFilter;
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "archived" && !item.isActive) ||
        (statusFilter === "low" && summary?.isLowStock && item.isActive) ||
        (statusFilter === "expiring" && status.label === "Expiring" && item.isActive) ||
        (statusFilter === "expired" && status.label === "Expired" && item.isActive) ||
        (statusFilter === "ok" && status.label === "OK" && item.isActive);
      return matchesSearch && matchesCategory && matchesStatus;
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
  }, [items, summaryMap, settings.expiryAlertDays, searchTerm, categoryFilter, statusFilter, sortBy]);
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
      /* non-blocking — keep showing stale data */
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

  async function applyBulkUpdate(label: string, patch: Partial<CreateItemInput>) {
    const selectedIds = visibleItemIds.filter((id) => selectedItemIds.has(id));
    if (selectedIds.length === 0) return;

    const confirmed = window.confirm(`Apply "${label}" to ${selectedIds.length} selected item${selectedIds.length === 1 ? "" : "s"}?`);
    if (!confirmed) return;

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
  }

  async function handleArchiveItem(item: Item) {
    const quantity = summaryMap.get(item.id)?.totalQuantity ?? 0;
    const stockNote = quantity > 0 ? ` It currently has ${formatNumber(quantity)} ${item.unit} in stock; history will be preserved.` : "";
    if (!window.confirm(`Archive "${item.name}"?${stockNote}`)) return;

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

  if (loading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Loading items…</p>
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
          <h1 className="page-title">Inventory command center</h1>
          <p className="page-subtitle">Search, scan, move stock, and maintain every item from one table-first workspace.</p>
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
            {categoryOptions.map((category) => (
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
          {(searchTerm || categoryFilter !== "all" || statusFilter !== "all" || sortBy !== "name") && (
            <button
              className="btn btn--ghost"
              onClick={() => {
                setSearchTerm("");
                setCategoryFilter("all");
                setStatusFilter("all");
                setSortBy("name");
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
          {categoryFilter !== "all" ? ` in ${categoryFilter}` : ""}
          {statusFilter !== "all" ? ` with ${statusFilter.replace("-", " ")} status` : ""}.
        </p>
      </div>

      {pendingCommandAction === "stock-in" && (
        <div className="inventory-action-notice" role="status">
          <strong>Stock in:</strong>
          <span>Search or choose an item below, then use the visible <strong>+ In</strong> row action.</span>
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
          {/* ── Desktop table (hidden on mobile) ── */}
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
                  const estimatedDaysRemaining = s && usage && usage.averageDailyUsage > 0
                    ? getEstimatedDaysRemaining(s.totalQuantity, usage.averageDailyUsage)
                    : null;
                  const status = getStatus(s, item.trackExpiry, settings.expiryAlertDays);
                  const selected = selectedItemIds.has(item.id);
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
                        {s?.isLowStock && (
                          <span className="reorder-hint">
                            Suggested reorder:{" "}
                            {formatNumber(getSuggestedReorderQuantity(
                              s.totalQuantity,
                              s.minStockLevel,
                              settings.lowStockMultiplier,
                            ))} {item.unit}
                          </span>
                        )}
                        {usage && (
                          <span className="usage-hint">
                            7-day usage: {formatNumber(usage.totalQuantity)} {item.unit} · Avg/day:{" "}
                            {formatNumber(usage.averageDailyUsage)} {item.unit}
                          </span>
                        )}
                        {estimatedDaysRemaining !== null && (
                          <span className={`forecast-hint forecast-hint--${getForecastTone(estimatedDaysRemaining)}`}>
                            Est. remaining: {formatNumber(estimatedDaysRemaining)} days
                          </span>
                        )}
                      </td>
                      {hasBarcodes && (
                        <td className="td-barcode">{item.barcode ?? "-"}</td>
                      )}
                      <td className="td-unit">{item.unit}</td>
                      <td className="text-right td-num">
                        {s !== undefined ? formatNumber(s.totalQuantity) : "—"}
                      </td>
                      <td className="text-right td-num td-value">
                        {s !== undefined ? formatCurrency(s.totalValue, currency) : "—"}
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
                            + In
                          </button>
                        )}
                        {item.isActive && (
                          <button
                            type="button"
                            className="btn btn--sm btn--action-out"
                            onClick={() => setStockOutItem(item)}
                          >
                            − Out
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

          {/* ── Mobile cards (hidden on desktop) ── */}
          <div className="item-cards">
            {filteredItems.map((item) => {
              const s = summaryMap.get(item.id);
              const usage = usageMap.get(item.id);
              const estimatedDaysRemaining = s && usage && usage.averageDailyUsage > 0
                ? getEstimatedDaysRemaining(s.totalQuantity, usage.averageDailyUsage)
                : null;
              const status = getStatus(s, item.trackExpiry, settings.expiryAlertDays);
              const selected = selectedItemIds.has(item.id);
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
                    <span className="item-card-stat">
                      <span className="item-card-stat-label">In Stock</span>
                      <span className="item-card-stat-value">
                        {s !== undefined ? `${s.totalQuantity} ${item.unit}` : "—"}
                      </span>
                    </span>
                    <span className="item-card-stat">
                      <span className="item-card-stat-label">Value</span>
                      <span className="item-card-stat-value">
                        {s !== undefined ? formatCurrency(s.totalValue, currency) : "—"}
                      </span>
                    </span>
                    <span className="item-card-stat">
                      <span className="item-card-stat-label">Min Level</span>
                      <span className="item-card-stat-value">{item.minStockLevel} {item.unit}</span>
                    </span>
                  </div>
                  {s?.isLowStock && (
                    <p className="reorder-hint reorder-hint--card">
                      Suggested reorder:{" "}
                      {formatNumber(getSuggestedReorderQuantity(
                        s.totalQuantity,
                        s.minStockLevel,
                        settings.lowStockMultiplier,
                      ))} {item.unit}
                    </p>
                  )}
                  {usage && (
                    <p className="usage-hint usage-hint--card">
                      7-day usage: {formatNumber(usage.totalQuantity)} {item.unit} · Avg/day:{" "}
                      {formatNumber(usage.averageDailyUsage)} {item.unit}
                    </p>
                  )}
                  {estimatedDaysRemaining !== null && (
                    <p className={`forecast-hint forecast-hint--card forecast-hint--${getForecastTone(estimatedDaysRemaining)}`}>
                      Est. remaining: {formatNumber(estimatedDaysRemaining)} days
                    </p>
                  )}
                  <div className="item-card-actions">
                    {item.isActive && canManageStock && (
                      <button
                        type="button"
                        className="btn btn--sm btn--action-in"
                        onClick={() => setStockInItem(item)}
                      >
                        + In
                      </button>
                    )}
                    {item.isActive && (
                      <button
                        type="button"
                        className="btn btn--sm btn--action-out"
                        onClick={() => setStockOutItem(item)}
                      >
                        − Out
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
          onClose={() => { setAddItemOpen(false); setScanPrefillBarcode(undefined); }}
          onSuccess={(item) => {
            setItems((prev) => [item, ...prev]);
            setAddItemOpen(false);
            setScanPrefillBarcode(undefined);
            showToast(`"${item.name}" added successfully`, "success");
            void refreshSummary();
          }}
          onError={(msg) => showToast(msg, "error")}
        />
      )}

      {editingItem && (
        <EditItemModal
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSuccess={(updatedItem) => {
            setItems((prev) => prev.map((item) => (item.id === updatedItem.id ? updatedItem : item)));
            setEditingItem(null);
            showToast(`"${updatedItem.name}" updated`, "success");
            void refreshSummary();
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
          onClose={() => setStockInItem(null)}
          onSuccess={() => {
            const name = stockInItem.name;
            setStockInItem(null);
            showToast(`Stock added for "${name}"`, "success");
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
            const name = stockOutItem.name;
            setStockOutItem(null);
            showToast(`Stock deducted from "${name}"`, "success");
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
}: {
  selectedCount: number;
  allVisibleSelected: boolean;
  bulkCategory: string;
  bulkUnit: string;
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
            {CATEGORY_OPTIONS.map((category) => (
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
            {UNIT_OPTIONS.map((unit) => (
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
        <button type="button" className="btn btn--sm btn--secondary" disabled={saving} onClick={onClear}>
          Clear
        </button>
      </div>

      {progress && (
        <div className="bulk-progress">
          Updated {progress.updated} of {progress.total}
          {progress.failed > 0 ? ` · ${progress.failed} failed` : ""}
        </div>
      )}
    </div>
  );
}

function AddItemModal({
  prefillBarcode,
  onClose,
  onSuccess,
  onError,
}: {
  prefillBarcode?: string;
  onClose: () => void;
  onSuccess: (item: Item) => void;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState<CreateItemInput>({
    name: "",
    unit: UNIT_OPTIONS[0],
    category: CATEGORY_OPTIONS[0],
    barcode: prefillBarcode ?? "",
    minStockLevel: 0,
    trackExpiry: false,
  });
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.unit.trim()) return;
    setSaving(true);
    try {
      const res = await createItem({
        ...form,
        barcode: form.barcode?.trim() || undefined,
      });
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
        <div className="form-group">
          <label className="form-label">Name *</label>
          <input
            ref={firstRef}
            className="form-input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Chicken Breast"
            required
          />
        </div>
        <div className="form-group">
          <label className="form-label">Unit *</label>
          <select
            className="form-select"
            value={form.unit}
            onChange={(e) => setForm({ ...form, unit: e.target.value })}
            required
          >
            {UNIT_OPTIONS.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Category</label>
          <select
            className="form-select"
            value={form.category ?? ""}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          >
            {CATEGORY_OPTIONS.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Low Stock Alert Threshold</label>
          <input
            className="form-input"
            type="number"
            min={0}
            value={form.minStockLevel}
            onChange={(e) => setForm({ ...form, minStockLevel: Number(e.target.value) })}
          />
          <p className="form-helper">Alert triggers when stock is at or below this quantity. Set it based on how fast this item is used.</p>
        </div>
        <div className="form-group">
          <label className="form-label">Barcode</label>
          <div className="barcode-input-row">
            <input
              className="form-input"
              value={form.barcode ?? ""}
              onChange={(e) => setForm({ ...form, barcode: e.target.value })}
              placeholder="Scan or enter barcode"
            />
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={Boolean(form.barcode?.trim())}
              onClick={() => setForm({ ...form, barcode: generateBarcodeValue() })}
            >
              Auto-generate
            </button>
          </div>
        </div>
        <div className="form-group form-group--inline">
          <input
            id="trackExpiry"
            type="checkbox"
            checked={form.trackExpiry}
            onChange={(e) => setForm({ ...form, trackExpiry: e.target.checked })}
          />
          <label htmlFor="trackExpiry" className="form-label form-label--check">
            Track expiry dates
          </label>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={saving || !form.name.trim() || !form.unit.trim()}
          >
            {saving ? <span className="btn-spinner" /> : null}
            {saving ? "Adding…" : "Add Item"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditItemModal({
  item,
  onClose,
  onSuccess,
  onError,
}: {
  item: Item;
  onClose: () => void;
  onSuccess: (item: Item) => void;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState<CreateItemInput>({
    name: item.name,
    unit: item.unit,
    category: item.category ?? "",
    sku: item.sku ?? "",
    barcode: item.barcode ?? "",
    minStockLevel: item.minStockLevel,
    trackExpiry: item.trackExpiry,
  });
  const [saving, setSaving] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.unit.trim()) return;
    setSaving(true);
    try {
      const res = await updateItem(item.id, {
        ...form,
        name: form.name.trim(),
        unit: form.unit.trim(),
        category: form.category?.trim() || null,
        sku: form.sku?.trim() || null,
        barcode: form.barcode?.trim() || null,
      });
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
        <div className="form-group">
          <label className="form-label">Name *</label>
          <input
            ref={firstRef}
            className="form-input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>
        <div className="form-group">
          <label className="form-label">Unit *</label>
          <select
            className="form-select"
            value={form.unit}
            onChange={(e) => setForm({ ...form, unit: e.target.value })}
            required
          >
            {UNIT_OPTIONS.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Category</label>
          <input
            className="form-input"
            list="edit-item-category-options"
            value={form.category ?? ""}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            placeholder="Optional category"
          />
          <datalist id="edit-item-category-options">
            {CATEGORY_OPTIONS.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </datalist>
          {item.category && !CATEGORY_OPTIONS.includes(item.category) && (
            <p className="form-helper">Current custom category is preserved unless you edit or clear it.</p>
          )}
        </div>
        <div className="form-group">
          <label className="form-label">SKU</label>
          <input
            className="form-input"
            value={form.sku ?? ""}
            onChange={(e) => setForm({ ...form, sku: e.target.value })}
            placeholder="Optional internal SKU"
          />
        </div>
        <div className="form-group">
          <label className="form-label">Low Stock Alert Threshold</label>
          <input
            className="form-input"
            type="number"
            min={0}
            value={form.minStockLevel}
            onChange={(e) => setForm({ ...form, minStockLevel: Number(e.target.value) })}
          />
          <p className="form-helper">Alert triggers when stock is at or below this quantity. Set it based on how fast this item is used.</p>
        </div>
        <div className="form-group">
          <label className="form-label">Barcode</label>
          <input
            className="form-input"
            value={form.barcode ?? ""}
            onChange={(e) => setForm({ ...form, barcode: e.target.value })}
            placeholder="Scan or enter barcode"
          />
        </div>
        <div className="form-group form-group--inline">
          <input
            id="editTrackExpiry"
            type="checkbox"
            checked={form.trackExpiry}
            onChange={(e) => setForm({ ...form, trackExpiry: e.target.checked })}
          />
          <label htmlFor="editTrackExpiry" className="form-label form-label--check">
            Track expiry dates
          </label>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={saving || !form.name.trim() || !form.unit.trim()}
          >
            {saving ? <span className="btn-spinner" /> : null}
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
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
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ImportItemRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const [apiFailedCount, setApiFailedCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importableRows = rows.filter((row) => row.status !== "pending" || row.errors.length === 0);
  const pendingValidRows = rows.filter((row) => row.status === "pending" && row.errors.length === 0);
  const invalidCount = rows.length - importableRows.length;
  const failedRowsCount = invalidCount + apiFailedCount;
  const canImport = !parsing && !importing && pendingValidRows.length > 0;

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setRows([]);
    setParseError(null);
    setImportedCount(0);
    setApiFailedCount(0);
    setParsing(true);

    try {
      if (!isSupportedImportFile(file.name)) {
        throw new Error("Please choose a .csv or .xlsx file.");
      }

      const parsedRows = await parseImportFile(file);
      setRows(validateImportRows(parsedRows, existingItems));
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Could not parse import file");
    } finally {
      setParsing(false);
    }
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
        await createItem({
          name: row.name,
          unit: row.unit,
          category: row.category || undefined,
          sku: row.sku || undefined,
          barcode: row.barcode || undefined,
          minStockLevel: row.minStockLevel,
          trackExpiry: row.trackExpiry,
        });

        imported += 1;
        setImportedCount(imported);
        setRows((prev) => prev.map((candidate) => (
          candidate.rowNumber === row.rowNumber
            ? { ...candidate, status: "imported" }
            : candidate
        )));
      } catch (err) {
        failed += 1;
        setApiFailedCount(failed);
        const message = err instanceof Error ? err.message : "Import failed";
        setRows((prev) => prev.map((candidate) => (
          candidate.rowNumber === row.rowNumber
            ? { ...candidate, status: "failed", errors: [...candidate.errors, message] }
            : candidate
        )));
      }
    }

    setImporting(false);
    if (imported > 0) onSuccess(imported);
    if (failed > 0) onError(`${failed} row${failed === 1 ? "" : "s"} failed to import.`);
  }

  function downloadSampleTemplate() {
    const headers = ["name", "unit", "category", "sku", "barcode", "minStockLevel", "trackExpiry"];
    const sampleRows = [
      ["Chicken Breast", "kg", "Raw Material", "CHK-BRST", "SS100000001", "10", "yes"],
      ["Paper Cups", "pack", "Packaging", "CUP-250", "", "5", "no"],
    ];
    const csv = [headers, ...sampleRows].map((row) => row.map(escapeCsvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "shelfsense-items-import-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Modal title="Import Items" onClose={onClose}>
      <div className="import-modal">
        <div className="import-guidance">
          <p>
            Upload a CSV or Excel file with columns:
            {" "}
            <strong>name</strong>, <strong>unit</strong>, category, sku, barcode, minStockLevel, trackExpiry.
          </p>
          <p>
            Required: name and unit. Units must be one of: {UNIT_OPTIONS.join(", ")}.
            trackExpiry accepts true/false, yes/no, or 1/0.
          </p>
        </div>

        <div className="import-actions">
          <input
            ref={fileInputRef}
            className="import-file-input"
            type="file"
            accept=".csv,.xlsx"
            onChange={(e) => { void handleFileChange(e); }}
          />
          <button type="button" className="btn btn--ghost" onClick={() => fileInputRef.current?.click()}>
            Choose file
          </button>
          <button type="button" className="btn btn--secondary" onClick={downloadSampleTemplate}>
            Download sample template
          </button>
        </div>

        {fileName && <p className="import-file-name">{fileName}</p>}
        {parsing && <p className="import-status">Parsing file...</p>}
        {parseError && <div className="alert alert--error">{parseError}</div>}

        {rows.length > 0 && (
          <>
            <div className="import-summary">
              <span>{rows.length} rows parsed</span>
              <span>{importableRows.length} valid</span>
              <span>{failedRowsCount} failed rows</span>
              {importing || importedCount > 0 ? (
                <strong>Imported {importedCount} of {importableRows.length}</strong>
              ) : null}
            </div>

            <div className="import-preview-wrap">
              <table className="table import-preview-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Name</th>
                    <th>Unit</th>
                    <th>Category</th>
                    <th>SKU</th>
                    <th>Barcode</th>
                    <th className="text-right">Min</th>
                    <th>Expiry</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.rowNumber} className={row.errors.length > 0 ? "row--warn" : ""}>
                      <td>{row.rowNumber}</td>
                      <td>{row.name || "-"}</td>
                      <td>{row.unit || "-"}</td>
                      <td>{row.category || "-"}</td>
                      <td>{row.sku || "-"}</td>
                      <td>{row.barcode || "-"}</td>
                      <td className="text-right">{row.minStockLevel}</td>
                      <td>{row.trackExpiry ? "Yes" : "No"}</td>
                      <td>
                        {row.errors.length > 0 ? (
                          <span className="import-row-errors">{row.errors.join("; ")}</span>
                        ) : row.status === "imported" ? (
                          <span className="badge badge--green">Imported</span>
                        ) : row.status === "failed" ? (
                          <span className="badge badge--red">Failed</span>
                        ) : (
                          <span className="badge badge--gray">Ready</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="modal-footer">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={importing}>
            Close
          </button>
          <button type="button" className="btn btn--primary" onClick={() => { void handleImport(); }} disabled={!canImport}>
            {importing ? <span className="btn-spinner" /> : null}
            {importing ? "Importing..." : `Import ${pendingValidRows.length} valid rows`}
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
  const dimensions = `${preset.widthMm}mm × ${preset.heightMm}mm`;
  const showItemName = templateId === "name" || templateId === "name-details";
  const detailText = useMemo(() => {
    const parts = [];
    if (item.sku) parts.push(`SKU: ${item.sku}`);
    if (item.unit) parts.push(`Unit: ${item.unit}`);
    return parts.join(" · ");
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
  const [unitCost, setUnitCost] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [supplier, setSupplier] = useState("");
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
      await stockIn({
        itemId: item.id,
        quantity,
        unitCost: unitCost ? parseFloat(unitCost) : undefined,
        expiryDate: expiryDate || undefined,
        supplierName: supplier.trim() || undefined,
        note: note.trim() || undefined,
      });
      onSuccess();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to record stock in");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Stock In — ${item.name}`} onClose={onClose}>
      <form onSubmit={(e) => { void handleSubmit(e); }}>
        <div className="form-row">
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
            <label className="form-label">Unit Cost</label>
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
          <label className="form-label">Supplier (optional)</label>
          <input
            className="form-input"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            placeholder="Supplier name"
          />
        </div>
        <div className="form-group">
          <label className="form-label">Note (optional)</label>
          <input
            className="form-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Any notes…"
          />
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={saving || !qty || parseFloat(qty) <= 0}
          >
            {saving ? <span className="btn-spinner" /> : null}
            {saving ? "Saving…" : "Add Stock"}
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
      onError(err instanceof Error ? err.message : "Failed to record stock out");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Use / Deduct — ${item.name}`} onClose={onClose}>
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
            placeholder="Any notes…"
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
            {saving ? "Deducting…" : "Deduct Stock"}
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
    <Modal title={`Adjust Stock — ${item.name}`} onClose={onClose}>
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
            placeholder="Reason for adjustment…"
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
            {saving ? "Saving…" : btnLabel}
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
    <Modal title={`Transfer Stock — ${item.name}`} onClose={onClose}>
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
  const sheets = await readXlsxFile(file);
  const firstSheet = sheets[0];

  if (!firstSheet) {
    throw new Error("The selected file does not contain a worksheet.");
  }

  return tableRowsToRecords(firstSheet.data);
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

function validateImportRows(records: Array<Record<string, unknown>>, existingItems: Item[]) {
  const existingBarcodes = new Set(
    existingItems
      .map((item) => normalizeBarcode(item.barcode ?? ""))
      .filter(Boolean),
  );
  const fileBarcodeCounts = new Map<string, number>();

  const rows = records.map((record, index) => {
    const normalized = normalizeImportRecord(record);
    const barcodeKey = normalizeBarcode(normalized.barcode);
    if (barcodeKey) {
      fileBarcodeCounts.set(barcodeKey, (fileBarcodeCounts.get(barcodeKey) ?? 0) + 1);
    }

    return {
      rowNumber: index + 2,
      ...normalized,
      errors: normalized.errors,
      status: "pending" as const,
    };
  });

  return rows.map((row) => {
    const errors: string[] = [...row.errors];
    const barcodeKey = normalizeBarcode(row.barcode);

    if (!row.name) errors.push("Name is required");
    if (!row.unit) errors.push("Unit is required");
    if (row.unit && !UNIT_OPTIONS.includes(row.unit)) {
      errors.push(`Unit must be one of: ${UNIT_OPTIONS.join(", ")}`);
    }
    if (barcodeKey && existingBarcodes.has(barcodeKey)) {
      errors.push("Barcode already exists");
    }
    if (barcodeKey && (fileBarcodeCounts.get(barcodeKey) ?? 0) > 1) {
      errors.push("Duplicate barcode in file");
    }
    if (!Number.isFinite(row.minStockLevel) || row.minStockLevel < 0) {
      errors.push("Min stock level must be zero or greater");
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

  return {
    name: parseImportString(values.get("name")),
    unit,
    category: parseImportString(values.get("category")),
    sku: parseImportString(values.get("sku")),
    barcode: parseImportString(values.get("barcode")),
    minStockLevel: minStockLevelResult.value,
    trackExpiry: trackExpiryResult.value,
    errors: [
      ...minStockLevelResult.errors,
      ...trackExpiryResult.errors,
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
  return UNIT_OPTIONS.find((unit) => unit.toLowerCase() === lower) ?? trimmed;
}

function normalizeBarcode(value: string) {
  return value.trim().toLowerCase();
}

function parseOptionalNumber(value: unknown) {
  const raw = parseImportString(value);
  if (!raw) return { value: 0, errors: [] };

  const parsed = Number(raw);
  return Number.isFinite(parsed)
    ? { value: parsed, errors: [] }
    : { value: 0, errors: ["Min stock level must be a number"] };
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
    <div className="scanner-overlay" aria-label="Loading scanner…" aria-busy="true">
      <div className="scanner-loading">
        <div className="spinner scanner-loading-spinner" />
        <p className="scanner-loading-text">Loading scanner…</p>
      </div>
    </div>
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



