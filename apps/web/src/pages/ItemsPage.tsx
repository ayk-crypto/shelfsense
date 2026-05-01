import JsBarcode from "jsbarcode";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createItem, getItems } from "../api/items";
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
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const hasBarcodes = useMemo(() => items.some((item) => item.barcode), [items]);
  const usageMap = useMemo(
    () => new Map(getUsageInsights(usageMovements).map((usage) => [usage.itemId, usage])),
    [usageMovements],
  );

  function showToast(msg: string, type: "success" | "error") {
    const id = ++toastSeq;
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }

  async function quickAdjust(item: Item, delta: number) {
    setBusy((prev) => new Set(prev).add(item.id));
    try {
      if (delta > 0) {
        await stockIn({ itemId: item.id, quantity: delta, note: "Quick adjustment" });
      } else {
        await stockOut({ itemId: item.id, quantity: -delta, reason: "manual_adjustment", note: "Quick adjustment" });
      }
      const sign = delta > 0 ? "+" : "";
      showToast(`${sign}${delta} ${item.unit} — ${item.name}`, "success");
      void refreshSummary();
      if (delta < 0) void refreshUsageInsights();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Action failed", "error");
    } finally {
      setBusy((prev) => { const s = new Set(prev); s.delete(item.id); return s; });
    }
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
        getItems(),
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

  useEffect(() => { void loadAll(); }, [canManageStock, activeLocationId]);

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
          <h1 className="page-title">Items</h1>
          <p className="page-subtitle">Manage your inventory items</p>
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
            <button className="btn btn--primary" onClick={() => { setScanPrefillBarcode(undefined); setAddItemOpen(true); }}>
              + Add Item
            </button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="empty-state">
          <p>No items yet. Add your first inventory item to get started.</p>
        </div>
      ) : (
        <>
          {/* ── Desktop table (hidden on mobile) ── */}
          <div className="table-wrap items-table-wrap">
            <table className="table">
              <thead>
                <tr>
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
                {items.map((item) => {
                  const s = summaryMap.get(item.id);
                  const usage = usageMap.get(item.id);
                  const estimatedDaysRemaining = s && usage && usage.averageDailyUsage > 0
                    ? getEstimatedDaysRemaining(s.totalQuantity, usage.averageDailyUsage)
                    : null;
                  const status = getStatus(s, item.trackExpiry, settings.expiryAlertDays);
                  return (
                    <tr key={item.id} className={s?.isLowStock ? "row--warn" : ""}>
                      <td className="td-name">
                        {item.name}
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
                        {s !== undefined ? s.totalQuantity : "—"}
                      </td>
                      <td className="text-right td-num">
                        {s !== undefined ? formatCurrency(s.totalValue, currency) : "—"}
                      </td>
                      <td>
                        <span className={`badge badge--${status.variant}`}>{status.label}</span>
                      </td>
                      <td className="td-actions">
                        <span className="quick-btns">
                          {canManageStock && ([1, 5] as const).map((n) => (
                            <button
                              key={`+${n}`}
                              className="btn btn--xs btn--quick btn--quick-in"
                              disabled={busy.has(item.id)}
                              onClick={() => { void quickAdjust(item, n); }}
                              title={`Add ${n} ${item.unit}`}
                            >+{n}</button>
                          ))}
                          {([1, 5] as const).map((n) => (
                            <button
                              key={`-${n}`}
                              className="btn btn--xs btn--quick btn--quick-out"
                              disabled={busy.has(item.id)}
                              onClick={() => { void quickAdjust(item, -n); }}
                              title={`Deduct ${n} ${item.unit}`}
                            >−{n}</button>
                          ))}
                        </span>
                        <span className="actions-divider" />
                        {canManageStock && (
                          <button
                            className="btn btn--sm btn--ghost btn--green-text"
                            onClick={() => setStockInItem(item)}
                          >
                            + In
                          </button>
                        )}
                        <button
                          className="btn btn--sm btn--ghost btn--red-text"
                          onClick={() => setStockOutItem(item)}
                        >
                          − Out
                        </button>
                        {canManageStock && (
                          <button
                            className="btn btn--sm btn--ghost btn--blue-text"
                            onClick={() => setAdjustItem(item)}
                            title="Set exact stock quantity"
                          >
                            Adjust
                          </button>
                        )}
                        {canManageStock && locations.length > 1 && (
                          <button
                            className="btn btn--sm btn--ghost"
                            onClick={() => setTransferItem(item)}
                          >
                            Transfer
                          </button>
                        )}
                        <button
                          className="btn btn--sm btn--ghost"
                          onClick={() => setBarcodeItem(item)}
                        >
                          Barcode
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Mobile cards (hidden on desktop) ── */}
          <div className="item-cards">
            {items.map((item) => {
              const s = summaryMap.get(item.id);
              const usage = usageMap.get(item.id);
              const estimatedDaysRemaining = s && usage && usage.averageDailyUsage > 0
                ? getEstimatedDaysRemaining(s.totalQuantity, usage.averageDailyUsage)
                : null;
              const status = getStatus(s, item.trackExpiry, settings.expiryAlertDays);
              return (
                <div key={item.id} className="item-card">
                  <div className="item-card-header">
                    <span className="item-card-name">{item.name}</span>
                    <span className={`badge badge--${status.variant}`}>{status.label}</span>
                  </div>
                  <div className="item-card-meta">
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
                    <div className="quick-btns quick-btns--card">
                      {canManageStock && ([1, 5] as const).map((n) => (
                        <button
                          key={`+${n}`}
                          className="btn btn--xs btn--quick btn--quick-in"
                          disabled={busy.has(item.id)}
                          onClick={() => { void quickAdjust(item, n); }}
                          title={`Add ${n} ${item.unit}`}
                        >+{n}</button>
                      ))}
                      {([1, 5] as const).map((n) => (
                        <button
                          key={`-${n}`}
                          className="btn btn--xs btn--quick btn--quick-out"
                          disabled={busy.has(item.id)}
                          onClick={() => { void quickAdjust(item, -n); }}
                          title={`Deduct ${n} ${item.unit}`}
                        >−{n}</button>
                      ))}
                    </div>
                    <div className="item-card-modal-actions">
                      {canManageStock && (
                        <button
                          className="btn btn--sm btn--ghost btn--green-text item-card-btn"
                          onClick={() => setStockInItem(item)}
                        >
                          + Stock In
                        </button>
                      )}
                      <button
                        className="btn btn--sm btn--ghost btn--red-text item-card-btn"
                        onClick={() => setStockOutItem(item)}
                      >
                        − Use / Deduct
                      </button>
                      {canManageStock && (
                        <button
                          className="btn btn--sm btn--ghost btn--blue-text item-card-btn"
                          onClick={() => setAdjustItem(item)}
                        >
                        ≡ Set Quantity
                        </button>
                      )}
                      {canManageStock && locations.length > 1 && (
                        <button
                          className="btn btn--sm btn--ghost item-card-btn"
                          onClick={() => setTransferItem(item)}
                        >
                          Transfer
                        </button>
                      )}
                      <button
                        className="btn btn--sm btn--ghost item-card-btn"
                        onClick={() => setBarcodeItem(item)}
                      >
                        Barcode
                      </button>
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
          <label className="form-label">Min Stock Level</label>
          <input
            className="form-input"
            type="number"
            min={0}
            value={form.minStockLevel}
            onChange={(e) => setForm({ ...form, minStockLevel: Number(e.target.value) })}
          />
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

  useEffect(() => {
    if (!svgRef.current) return;

    JsBarcode(svgRef.current, barcode, {
      format: "CODE128",
      width: 2,
      height: 72,
      displayValue: true,
      fontSize: 14,
      margin: 8,
    });
  }, [barcode]);

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
            body { font-family: Arial, sans-serif; padding: 24px; }
            .label { border: 1px solid #111; width: 320px; padding: 16px; text-align: center; }
            h1 { font-size: 18px; margin: 0 0 10px; }
            p { font-size: 12px; margin: 8px 0 0; }
            svg { max-width: 100%; }
          </style>
        </head>
        <body>
          <div class="label">
            <h1>${escapeHtml(item.name)}</h1>
            ${svgMarkup}
            <p>${escapeHtml(barcode)}</p>
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
        <div className="barcode-preview">
          <svg ref={svgRef} />
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
