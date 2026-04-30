import { useEffect, useRef, useState } from "react";
import { getItems } from "../api/items";
import { createPurchase, getPurchases } from "../api/purchases";
import { getSuppliers } from "../api/suppliers";
import type { CreatePurchaseInput, Item, Purchase, Supplier } from "../types";

interface Toast {
  id: number;
  msg: string;
  type: "success" | "error";
}

let toastSeq = 0;

function fmt(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function PurchasesPage() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  function showToast(msg: string, type: "success" | "error") {
    const id = ++toastSeq;
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }

  async function load() {
    try {
      const res = await getPurchases();
      setPurchases(res.purchases);
      setFetchError(null);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load purchases");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  if (loading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Loading purchases…</p>
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
    <div className="purchases-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Purchases</h1>
          <p className="page-subtitle">Record stock purchases from suppliers</p>
        </div>
        <button className="btn btn--primary" onClick={() => setAddOpen(true)}>
          + New Purchase
        </button>
      </div>

      {purchases.length === 0 ? (
        <div className="empty-state">
          <p>No purchases yet. Record your first purchase to track stock intake.</p>
        </div>
      ) : (
        <>
          {/* ── Desktop table ── */}
          <div className="table-wrap purchases-table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Supplier</th>
                  <th className="th-right">Total Amount</th>
                  <th className="th-right">Lines</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((p) => (
                  <tr key={p.id}>
                    <td className="td-expiry">{fmtDate(p.date)}</td>
                    <td className="td-name">{p.supplier.name}</td>
                    <td className="td-amount">{fmt(p.totalAmount)}</td>
                    <td className="td-count">{p.purchaseItems.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Mobile cards ── */}
          <div className="purchase-cards">
            {purchases.map((p) => (
              <div key={p.id} className="purchase-card">
                <div className="purchase-card-header">
                  <span className="purchase-card-supplier">{p.supplier.name}</span>
                  <span className="purchase-card-date">{fmtDate(p.date)}</span>
                </div>
                <div className="purchase-card-meta">
                  <span className="purchase-card-amount">{fmt(p.totalAmount)}</span>
                  <span className="purchase-card-lines">
                    {p.purchaseItems.length} {p.purchaseItems.length === 1 ? "line" : "lines"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {addOpen && (
        <NewPurchaseModal
          onClose={() => setAddOpen(false)}
          onSuccess={(totalAmount, supplierName) => {
            setAddOpen(false);
            void load();
            showToast(
              `Purchase of ${fmt(totalAmount)} from "${supplierName}" recorded`,
              "success",
            );
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

/* ─────────────────────────────────────────────
   New Purchase Modal
───────────────────────────────────────────── */
interface PurchaseLine {
  key: number;
  itemId: string;
  qty: string;
  unitCost: string;
}

let lineSeq = 0;

function newLine(): PurchaseLine {
  return { key: ++lineSeq, itemId: "", qty: "", unitCost: "" };
}

function NewPurchaseModal({
  onClose,
  onSuccess,
  onError,
}: {
  onClose: () => void;
  onSuccess: (totalAmount: number, supplierName: string) => void;
  onError: (msg: string) => void;
}) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(true);

  const [supplierId, setSupplierId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [lines, setLines] = useState<PurchaseLine[]>([newLine()]);
  const [saving, setSaving] = useState(false);

  const supplierRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [sRes, iRes] = await Promise.all([getSuppliers(), getItems()]);
        setSuppliers(sRes.suppliers);
        setItems(iRes.items);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setDataLoading(false);
        requestAnimationFrame(() => supplierRef.current?.focus());
      }
    })();
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function addLine() {
    setLines((prev) => [...prev, newLine()]);
  }

  function removeLine(key: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  }

  function updateLine(key: number, patch: Partial<Omit<PurchaseLine, "key">>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function lineTotal(line: PurchaseLine) {
    const q = parseFloat(line.qty);
    const c = parseFloat(line.unitCost);
    return Number.isFinite(q) && Number.isFinite(c) ? q * c : null;
  }

  const grandTotal = lines.reduce<number>((sum, l) => {
    const t = lineTotal(l);
    return t !== null ? sum + t : sum;
  }, 0);

  const canSubmit =
    !saving &&
    supplierId !== "" &&
    date !== "" &&
    lines.some(
      (l) =>
        l.itemId !== "" &&
        parseFloat(l.qty) > 0 &&
        parseFloat(l.unitCost) >= 0 &&
        Number.isFinite(parseFloat(l.qty)) &&
        Number.isFinite(parseFloat(l.unitCost)),
    );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const validLines = lines.filter(
      (l) =>
        l.itemId !== "" &&
        parseFloat(l.qty) > 0 &&
        parseFloat(l.unitCost) >= 0 &&
        Number.isFinite(parseFloat(l.qty)) &&
        Number.isFinite(parseFloat(l.unitCost)),
    );

    if (validLines.length === 0) {
      onError("Add at least one valid purchase line");
      return;
    }

    const payload: CreatePurchaseInput = {
      supplierId,
      date,
      items: validLines.map((l) => ({
        itemId: l.itemId,
        quantity: parseFloat(l.qty),
        unitCost: parseFloat(l.unitCost),
      })),
    };

    setSaving(true);
    try {
      const res = await createPurchase(payload);
      const supplierName = suppliers.find((s) => s.id === supplierId)?.name ?? "Supplier";
      onSuccess(res.purchase.totalAmount, supplierName);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to create purchase");
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">New Purchase</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          {dataLoading ? (
            <div className="purchase-modal-loading">
              <div className="spinner" />
              <p>Loading suppliers & items…</p>
            </div>
          ) : loadError ? (
            <div className="alert alert--error">{loadError}</div>
          ) : (
            <form id="purchase-form" onSubmit={(e) => { void handleSubmit(e); }}>
              {/* ── Header fields ── */}
              <div className="purchase-header-fields">
                <div className="form-group">
                  <label className="form-label">Supplier *</label>
                  <select
                    ref={supplierRef}
                    className="form-input form-select"
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                    required
                  >
                    <option value="">Select supplier…</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Purchase Date *</label>
                  <input
                    type="date"
                    className="form-input"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* ── Lines ── */}
              <div className="purchase-lines-section">
                <div className="purchase-lines-title-row">
                  <span className="purchase-lines-label">Purchase Lines</span>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={addLine}>
                    + Add Line
                  </button>
                </div>

                {/* Desktop column headers */}
                <div className="purchase-line purchase-line--header">
                  <span>Item</span>
                  <span>Qty</span>
                  <span>Unit Cost</span>
                  <span className="purchase-line-total-label">Total</span>
                  <span />
                </div>

                {lines.map((line) => {
                  const t = lineTotal(line);
                  return (
                    <div key={line.key} className="purchase-line">
                      <div className="purchase-line-item">
                        <select
                          className="form-input form-select"
                          value={line.itemId}
                          onChange={(e) => updateLine(line.key, { itemId: e.target.value })}
                        >
                          <option value="">Select item…</option>
                          {items.map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.name}{i.unit ? ` (${i.unit})` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="purchase-line-qty">
                        <input
                          type="number"
                          className="form-input"
                          placeholder="0"
                          min="0.01"
                          step="0.01"
                          value={line.qty}
                          onChange={(e) => updateLine(line.key, { qty: e.target.value })}
                        />
                      </div>
                      <div className="purchase-line-cost">
                        <input
                          type="number"
                          className="form-input"
                          placeholder="0.00"
                          min="0"
                          step="0.01"
                          value={line.unitCost}
                          onChange={(e) => updateLine(line.key, { unitCost: e.target.value })}
                        />
                      </div>
                      <div className="purchase-line-total">
                        {t !== null ? fmt(t) : <span className="text-muted">—</span>}
                      </div>
                      <button
                        type="button"
                        className="purchase-line-remove"
                        onClick={() => removeLine(line.key)}
                        disabled={lines.length === 1}
                        aria-label="Remove line"
                        title="Remove line"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  );
                })}

                {/* Grand total */}
                <div className="purchase-grand-total">
                  <span className="purchase-grand-total-label">Grand Total</span>
                  <span className="purchase-grand-total-value">{fmt(grandTotal)}</span>
                </div>
              </div>
            </form>
          )}
        </div>

        {!dataLoading && !loadError && (
          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              form="purchase-form"
              className="btn btn--primary"
              disabled={!canSubmit}
            >
              {saving ? <span className="btn-spinner" /> : null}
              {saving ? "Saving…" : "Create Purchase"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
