import { useEffect, useRef, useState } from "react";
import { createItem, getItems } from "../api/items";
import { stockIn, stockOut } from "../api/stock";
import type { CreateItemInput, Item } from "../types";

interface Toast {
  id: number;
  msg: string;
  type: "success" | "error";
}

let toastSeq = 0;

const UNIT_OPTIONS = [
  "kg",
  "g",
  "liter",
  "ml",
  "pcs",
  "pack",
  "box",
  "dozen",
  "bottle",
  "can",
  "bag",
];

const CATEGORY_OPTIONS = [
  "Raw Material",
  "Beverage",
  "Packaging",
  "Cleaning",
  "Finished Goods",
  "Other",
];

export function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const [addItemOpen, setAddItemOpen] = useState(false);
  const [stockInItem, setStockInItem] = useState<Item | null>(null);
  const [stockOutItem, setStockOutItem] = useState<Item | null>(null);

  function showToast(msg: string, type: "success" | "error") {
    const id = ++toastSeq;
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }

  async function loadItems() {
    try {
      const res = await getItems();
      setItems(res.items);
      setFetchError(null);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load items");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadItems(); }, []);

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
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Unit</th>
                <th className="text-right">Min Level</th>
                <th>Tracks Expiry</th>
                <th className="text-right col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="td-name">{item.name}</td>
                  <td className="td-unit">{item.category ?? "Other"}</td>
                  <td className="td-unit">{item.unit}</td>
                  <td className="text-right td-num">{item.minStockLevel}</td>
                  <td>
                    {item.trackExpiry ? (
                      <span className="badge badge--blue">Yes</span>
                    ) : (
                      <span className="badge badge--gray">No</span>
                    )}
                  </td>
                  <td className="td-actions">
                    <button
                      className="btn btn--sm btn--ghost btn--green-text"
                      onClick={() => setStockInItem(item)}
                    >
                      + Stock In
                    </button>
                    <button
                      className="btn btn--sm btn--ghost btn--red-text"
                      onClick={() => setStockOutItem(item)}
                    >
                      − Use / Deduct
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {addItemOpen && (
        <AddItemModal
          onClose={() => setAddItemOpen(false)}
          onSuccess={(item) => {
            setItems((prev) => [item, ...prev]);
            setAddItemOpen(false);
            showToast(`"${item.name}" added successfully`, "success");
          }}
          onError={(msg) => showToast(msg, "error")}
        />
      )}

      {stockInItem && (
        <StockInModal
          item={stockInItem}
          onClose={() => setStockInItem(null)}
          onSuccess={() => {
            showToast(`Stock added for "${stockInItem.name}"`, "success");
            setStockInItem(null);
          }}
          onError={(msg) => showToast(msg, "error")}
        />
      )}

      {stockOutItem && (
        <StockOutModal
          item={stockOutItem}
          onClose={() => setStockOutItem(null)}
          onSuccess={() => {
            showToast(`Stock deducted from "${stockOutItem.name}"`, "success");
            setStockOutItem(null);
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
