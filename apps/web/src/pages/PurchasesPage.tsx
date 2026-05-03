import { useEffect, useRef, useState } from "react";
import { getItems } from "../api/items";
import { createPurchase, getPurchases } from "../api/purchases";
import { getSuppliers } from "../api/suppliers";
import { useLocation } from "../context/LocationContext";
import { useWorkspaceSettings } from "../context/WorkspaceSettingsContext";
import type { CreatePurchaseInput, Item, Purchase, Supplier } from "../types";
import { formatCurrency } from "../utils/currency";

const AVATAR_COLORS = [
  { bg: "#e0f2fe", text: "#0369a1" },
  { bg: "#dcfce7", text: "#16a34a" },
  { bg: "#fef9c3", text: "#a16207" },
  { bg: "#fce7f3", text: "#be185d" },
  { bg: "#ede9fe", text: "#6d28d9" },
  { bg: "#ffedd5", text: "#c2410c" },
  { bg: "#e0e7ff", text: "#4338ca" },
  { bg: "#f0fdf4", text: "#15803d" },
];

function getAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface Toast {
  id: number;
  msg: string;
  type: "success" | "error";
}

let toastSeq = 0;

function fmt(n: number, currency: string) {
  return formatCurrency(n, currency);
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

/* ─────────────────────────────────────────────
   Main page
───────────────────────────────────────────── */
export function PurchasesPage() {
  const { activeLocationId } = useLocation();
  const { settings } = useWorkspaceSettings();
  const currency = settings.currency;
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [detailPurchase, setDetailPurchase] = useState<Purchase | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Filters
  const [filterSupplier, setFilterSupplier] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

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

  useEffect(() => { void load(); }, [activeLocationId]);

  // Derive unique suppliers for filter dropdown
  const supplierOptions = Array.from(
    new Map(purchases.map((p) => [p.supplier.id, p.supplier])).values(),
  ).sort((a, b) => a.name.localeCompare(b.name));

  // Filtered list (client-side)
  const filtered = purchases.filter((p) => {
    if (filterSupplier && p.supplier.id !== filterSupplier) return false;
    if (filterFrom) {
      const pDate = p.date.slice(0, 10);
      if (pDate < filterFrom) return false;
    }
    if (filterTo) {
      const pDate = p.date.slice(0, 10);
      if (pDate > filterTo) return false;
    }
    return true;
  });

  const hasFilters = filterSupplier || filterFrom || filterTo;
  const filteredTotal = filtered.reduce((sum, purchase) => sum + purchase.totalAmount, 0);
  const filteredLineCount = filtered.reduce((sum, purchase) => sum + purchase.purchaseItems.length, 0);

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
          <p className="page-subtitle">Manage procurement intake, supplier spend, and purchase line detail.</p>
        </div>
        <button className="btn btn--primary" onClick={() => setAddOpen(true)}>
          + New Purchase
        </button>
      </div>

      <div className="ops-metric-strip" aria-label="Purchase summary">
        <div className="ops-metric">
          <span className="ops-metric-label">Visible purchases</span>
          <strong className="ops-metric-value">{filtered.length}</strong>
        </div>
        <div className="ops-metric">
          <span className="ops-metric-label">Visible spend</span>
          <strong className="ops-metric-value">{fmt(filteredTotal, currency)}</strong>
        </div>
        <div className="ops-metric">
          <span className="ops-metric-label">Purchase lines</span>
          <strong className="ops-metric-value">{filteredLineCount}</strong>
        </div>
        <div className="ops-metric">
          <span className="ops-metric-label">Suppliers</span>
          <strong className="ops-metric-value">{supplierOptions.length}</strong>
        </div>
      </div>

      {/* ── Filters ── */}
      {purchases.length > 0 && (
        <div className="purchase-filters">
          <select
            className="form-input form-select purchase-filter-select"
            value={filterSupplier}
            onChange={(e) => setFilterSupplier(e.target.value)}
          >
            <option value="">All suppliers</option>
            {supplierOptions.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

          <div className="purchase-filter-dates">
            <input
              type="date"
              className="form-input purchase-filter-date"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
              title="From date"
              aria-label="From date"
            />
            <span className="purchase-filter-sep">–</span>
            <input
              type="date"
              className="form-input purchase-filter-date"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
              title="To date"
              aria-label="To date"
            />
          </div>

          {hasFilters && (
            <button
              className="btn btn--ghost btn--sm purchase-filter-clear"
              onClick={() => { setFilterSupplier(""); setFilterFrom(""); setFilterTo(""); }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {purchases.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="6" y="10" width="36" height="32" rx="3" />
              <path d="M16 10V7a2 2 0 012-2h12a2 2 0 012 2v3" strokeLinecap="round" />
              <path d="M16 22h16M16 30h10" strokeLinecap="round" />
            </svg>
          </div>
          <h3>No purchases yet</h3>
          <p>Record your first purchase to track stock intake and supplier spend.</p>
          <button className="btn btn--primary" onClick={() => setAddOpen(true)}>
            Record first purchase
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state empty-state--compact">
          <p>No purchases match the current filters.</p>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => { setFilterSupplier(""); setFilterFrom(""); setFilterTo(""); }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="pur-list">
          {filtered.map((p) => {
            const color = getAvatarColor(p.supplier.name);
            const initials = getInitials(p.supplier.name);
            const preview = p.purchaseItems.slice(0, 2).map((li) => li.item.name).join(" · ");
            const extra = p.purchaseItems.length > 2 ? p.purchaseItems.length - 2 : 0;
            return (
              <div
                key={p.id}
                className="pur-item"
                role="button"
                tabIndex={0}
                onClick={() => setDetailPurchase(p)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setDetailPurchase(p); }}
              >
                <div className="pur-avatar" style={{ background: color.bg, color: color.text }}>
                  {initials}
                </div>
                <div className="pur-item-body">
                  <div className="pur-item-supplier">{p.supplier.name}</div>
                  <div className="pur-item-items">
                    {preview}
                    {extra > 0 && <span className="pur-item-extra"> +{extra} more</span>}
                  </div>
                </div>
                <div className="pur-item-right">
                  <span className="pur-item-amount">{fmt(p.totalAmount, currency)}</span>
                  <div className="pur-item-meta">
                    <span className="pur-item-date">{fmtDate(p.date)}</span>
                    <span className="pur-item-lines">
                      {p.purchaseItems.length} {p.purchaseItems.length === 1 ? "line" : "lines"}
                    </span>
                  </div>
                </div>
                <svg className="pur-item-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M8 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modals ── */}
      {addOpen && (
        <NewPurchaseModal
          currency={currency}
          onClose={() => setAddOpen(false)}
          onSuccess={(totalAmount, supplierName) => {
            setAddOpen(false);
            void load();
            showToast(
              `Purchase of ${fmt(totalAmount, currency)} from "${supplierName}" recorded`,
              "success",
            );
          }}
          onError={(msg) => showToast(msg, "error")}
        />
      )}

      {detailPurchase && (
        <PurchaseDetailModal
          purchase={detailPurchase}
          currency={currency}
          onClose={() => setDetailPurchase(null)}
        />
      )}

      {/* ── Toast stack ── */}
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
   Purchase Detail Modal
───────────────────────────────────────────── */
function PurchaseDetailModal({
  purchase,
  currency,
  onClose,
}: {
  purchase: Purchase;
  currency: string;
  onClose: () => void;
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
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Purchase Details</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          {/* ── Summary banner ── */}
          <div className="pur-detail-banner">
            <div className="pur-detail-banner-left">
              {(() => {
                const color = getAvatarColor(purchase.supplier.name);
                const initials = getInitials(purchase.supplier.name);
                return (
                  <div className="pur-detail-avatar" style={{ background: color.bg, color: color.text }}>
                    {initials}
                  </div>
                );
              })()}
              <div className="pur-detail-banner-info">
                <span className="pur-detail-supplier">{purchase.supplier.name}</span>
                <span className="pur-detail-subline">
                  {fmtDate(purchase.date)}
                  <span className="pur-detail-dot">·</span>
                  {purchase.purchaseItems.length} {purchase.purchaseItems.length === 1 ? "line item" : "line items"}
                </span>
              </div>
            </div>
            <div className="pur-detail-total">{fmt(purchase.totalAmount, currency)}</div>
          </div>

          {/* ── Line items ── */}
          <div className="purchase-detail-lines">
            <p className="purchase-detail-lines-heading">Items Purchased</p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="th-right">Qty</th>
                    <th className="th-right">Unit Cost</th>
                    <th className="th-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {purchase.purchaseItems.map((li) => (
                    <tr key={li.id}>
                      <td className="td-name">
                        {li.item.name}
                        {li.item.unit && (
                          <span className="td-unit"> · {li.item.unit}</span>
                        )}
                      </td>
                      <td className="td-amount">{li.quantity}</td>
                      <td className="td-amount">{fmt(li.unitCost, currency)}</td>
                      <td className="td-amount" style={{ fontWeight: 600 }}>{fmt(li.total, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onClose}>Close</button>
        </div>
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
  currency,
  onClose,
  onSuccess,
  onError,
}: {
  currency: string;
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
                  <span className="purchase-lines-label">Items</span>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={addLine}>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: 13, height: 13 }}>
                      <path d="M8 3v10M3 8h10" strokeLinecap="round" />
                    </svg>
                    Add Line
                  </button>
                </div>

                <div className="purchase-line purchase-line--header">
                  <span className="purchase-line-num" />
                  <span>Item</span>
                  <span>Qty</span>
                  <span>Unit Cost</span>
                  <span className="purchase-line-total-label">Total</span>
                  <span />
                </div>

                {lines.map((line, idx) => {
                  const t = lineTotal(line);
                  return (
                    <div key={line.key} className="purchase-line">
                      <span className="purchase-line-num">{idx + 1}</span>
                      <div className="purchase-line-item">
                        <select
                          className="form-input form-select"
                          value={line.itemId}
                          onChange={(e) => updateLine(line.key, { itemId: e.target.value })}
                        >
                          <option value="">Select item…</option>
                          {items.map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.name}{i.unit ? ` · ${i.unit}` : ""}
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
                        {t !== null ? fmt(t, currency) : <span className="text-muted">—</span>}
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

                <div className="purchase-grand-total">
                  <span className="purchase-grand-total-label">Grand Total</span>
                  <span className="purchase-grand-total-value">{fmt(grandTotal, currency)}</span>
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
