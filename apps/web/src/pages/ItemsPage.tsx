import { useEffect, useRef, useState } from "react";
import { createItem, getItems } from "../api/items";
import { getStockSummary, stockIn, stockOut } from "../api/stock";
import type { CreateItemInput, Item, StockSummaryItem } from "../types";
import { formatCurrency } from "../utils/currency";

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

function getStatus(s: StockSummaryItem | undefined, trackExpiry: boolean): StatusInfo {
  if (!s) return { label: "No data", variant: "gray" };
  const now = Date.now();
  if (trackExpiry && s.nearestExpiryDate) {
    const exp = new Date(s.nearestExpiryDate).getTime();
    if (exp < now) return { label: "Expired", variant: "red" };
    if (exp <= now + 7 * 86_400_000) return { label: "Expiring", variant: "orange" };
  }
  if (s.isLowStock) return { label: "Low Stock", variant: "orange" };
  return { label: "OK", variant: "green" };
}

export function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [summaryMap, setSummaryMap] = useState<Map<string, StockSummaryItem>>(new Map());
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const [addItemOpen, setAddItemOpen] = useState(false);
  const [stockInItem, setStockInItem] = useState<Item | null>(null);
  const [stockOutItem, setStockOutItem] = useState<Item | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());

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

  async function loadAll() {
    try {
      const [itemsRes, summaryRes] = await Promise.all([getItems(), getStockSummary()]);
      setItems(itemsRes.items);
      setSummaryMap(new Map(summaryRes.summary.map((s) => [s.itemId, s])));
      setFetchError(null);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load items");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadAll(); }, []);

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
        <button className="btn btn--primary" onClick={() => setAddItemOpen(true)}>
          + Add Item
        </button>
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
                  const status = getStatus(s, item.trackExpiry);
                  return (
                    <tr key={item.id} className={s?.isLowStock ? "row--warn" : ""}>
                      <td className="td-name">{item.name}</td>
                      <td className="td-unit">{item.unit}</td>
                      <td className="text-right td-num">
                        {s !== undefined ? s.totalQuantity : "—"}
                      </td>
                      <td className="text-right td-num">
                        {s !== undefined ? formatCurrency(s.totalValue) : "—"}
                      </td>
                      <td>
                        <span className={`badge badge--${status.variant}`}>{status.label}</span>
                      </td>
                      <td className="td-actions">
                        <span className="quick-btns">
                          {([1, 5] as const).map((n) => (
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
                        <button
                          className="btn btn--sm btn--ghost btn--green-text"
                          onClick={() => setStockInItem(item)}
                        >
                          + In
                        </button>
                        <button
                          className="btn btn--sm btn--ghost btn--red-text"
                          onClick={() => setStockOutItem(item)}
                        >
                          − Out
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
              const status = getStatus(s, item.trackExpiry);
              return (
                <div key={item.id} className="item-card">
                  <div className="item-card-header">
                    <span className="item-card-name">{item.name}</span>
                    <span className={`badge badge--${status.variant}`}>{status.label}</span>
                  </div>
                  <div className="item-card-meta">
                    <span className="item-card-stat">
                      <span className="item-card-stat-label">In Stock</span>
                      <span className="item-card-stat-value">
                        {s !== undefined ? `${s.totalQuantity} ${item.unit}` : "—"}
                      </span>
                    </span>
                    <span className="item-card-stat">
                      <span className="item-card-stat-label">Value</span>
                      <span className="item-card-stat-value">
                        {s !== undefined ? formatCurrency(s.totalValue) : "—"}
                      </span>
                    </span>
                    <span className="item-card-stat">
                      <span className="item-card-stat-label">Min Level</span>
                      <span className="item-card-stat-value">{item.minStockLevel} {item.unit}</span>
                    </span>
                  </div>
                  <div className="item-card-actions">
                    <div className="quick-btns quick-btns--card">
                      {([1, 5] as const).map((n) => (
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
                      <button
                        className="btn btn--sm btn--ghost btn--green-text item-card-btn"
                        onClick={() => setStockInItem(item)}
                      >
                        + Stock In
                      </button>
                      <button
                        className="btn btn--sm btn--ghost btn--red-text item-card-btn"
                        onClick={() => setStockOutItem(item)}
                      >
                        − Use / Deduct
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
          onClose={() => setAddItemOpen(false)}
          onSuccess={(item) => {
            setItems((prev) => [item, ...prev]);
            setAddItemOpen(false);
            showToast(`"${item.name}" added successfully`, "success");
            void refreshSummary();
          }}
          onError={(msg) => showToast(msg, "error")}
        />
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

function AddItemModal({
  onClose,
  onSuccess,
  onError,
}: {
  onClose: () => void;
  onSuccess: (item: Item) => void;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState<CreateItemInput>({
    name: "",
    unit: UNIT_OPTIONS[0],
    category: CATEGORY_OPTIONS[0],
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
      const res = await createItem(form);
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
