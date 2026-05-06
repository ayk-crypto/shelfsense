import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { PlanFeatureGate } from "../components/PlanFeatureGate";
import { usePlanFeatures } from "../context/PlanFeaturesContext";
import {
  cancelPurchase,
  createPurchase,
  getPurchase,
  getPurchases,
  orderPurchase,
  receivePurchase,
} from "../api/purchases";
import { getItems } from "../api/items";
import { getLocations } from "../api/locations";
import { getPriceHistory, getSupplierSuggestion } from "../api/stock";
import { getSuppliers } from "../api/suppliers";
import { useLocation } from "../context/LocationContext";
import { useWorkspaceSettings } from "../context/WorkspaceSettingsContext";
import type {
  CreatePurchaseInput,
  Item,
  Location,
  Purchase,
  PurchaseFilters,
  PurchaseStatus,
  Supplier,
} from "../types";
import { formatCurrency } from "../utils/currency";

const STATUSES: PurchaseStatus[] = ["DRAFT", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"];

const STATUS_LABEL: Record<PurchaseStatus, string> = {
  DRAFT: "Draft",
  ORDERED: "Ordered",
  PARTIALLY_RECEIVED: "Partially Received",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
};

interface Toast {
  id: number;
  msg: string;
  type: "success" | "error";
}

let toastSeq = 0;
let lineSeq = 0;

interface PurchaseLineDraft {
  key: number;
  itemId: string;
  quantity: string;
  unitCost: string;
  lastCost?: number | null;
  metaLoading?: boolean;
}

interface ReceiveLineDraft {
  purchaseItemId: string;
  receivedQuantity: string;
  locationId: string;
  expiryDate: string;
  batchNo: string;
  unitCost: string;
  notes: string;
}

function newLine(): PurchaseLineDraft {
  return { key: ++lineSeq, itemId: "", quantity: "", unitCost: "" };
}

function fmt(value: number, currency: string) {
  return formatCurrency(value, currency);
}

function fmtDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function toDateInput(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "";
}

function numberValue(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function PurchasesPage() {
  const planFeatures = usePlanFeatures();
  const [searchParams, setSearchParams] = useSearchParams();
  const handledReorderRedirect = useRef(false);
  const { activeLocationId } = useLocation();
  const { settings } = useWorkspaceSettings();
  const currency = settings.currency;
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [receivePurchaseTarget, setReceivePurchaseTarget] = useState<Purchase | null>(null);
  const [detailPurchase, setDetailPurchase] = useState<Purchase | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Purchase | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [filters, setFilters] = useState<PurchaseFilters>({});

  function showToast(msg: string, type: "success" | "error") {
    const id = ++toastSeq;
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), 3500);
  }

  async function load(nextFilters = filters) {
    setLoading(true);
    try {
      const [purchaseRes, supplierRes, itemRes, locationRes] = await Promise.all([
        getPurchases(nextFilters),
        getSuppliers(),
        getItems(),
        getLocations(),
      ]);
      setPurchases(purchaseRes.purchases);
      setSuppliers(supplierRes.suppliers);
      setItems(itemRes.items);
      setLocations(locationRes.locations);
      setFetchError(null);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load purchases");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocationId, filters.status, filters.supplierId, filters.fromDate, filters.toDate, filters.locationId]);

  useEffect(() => {
    const purchaseId = searchParams.get("purchaseId");
    if (!purchaseId || purchases.length === 0 || handledReorderRedirect.current) return;

    handledReorderRedirect.current = true;
    const fromReorder = Number(searchParams.get("fromReorder") ?? "0");
    const purchase = purchases.find((entry) => entry.id === purchaseId);
    if (purchase) setDetailPurchase(purchase);
    if (fromReorder > 0) {
      showToast(
        fromReorder === 1
          ? "Created purchase draft from reorder suggestions"
          : `Created ${fromReorder} purchase drafts from reorder suggestions`,
        "success",
      );
    }
    setSearchParams({}, { replace: true });
  }, [purchases, searchParams, setSearchParams]);

  const totals = useMemo(() => ({
    orderedValue: purchases.reduce((sum, purchase) => sum + purchase.totalAmount, 0),
    receivedValue: purchases.reduce((sum, purchase) => sum + purchase.receivedValue, 0),
    remainingQuantity: purchases.reduce((sum, purchase) => sum + purchase.remainingQuantity, 0),
  }), [purchases]);

  async function refreshDetail(id: string) {
    const res = await getPurchase(id);
    setDetailPurchase(res.purchase);
    setReceivePurchaseTarget((current) => current?.id === id ? res.purchase : current);
    await load(filters);
  }

  async function handleOrder(purchase: Purchase) {
    try {
      const res = await orderPurchase(purchase.id);
      showToast("Purchase marked as ordered", "success");
      setDetailPurchase(res.purchase);
      await load(filters);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to order purchase", "error");
    }
  }

  function handleCancel(purchase: Purchase) {
    setCancelTarget(purchase);
    setCancelReason("");
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      const res = await cancelPurchase(cancelTarget.id, cancelReason.trim() || undefined);
      showToast("Purchase cancelled", "success");
      setDetailPurchase(res.purchase);
      setCancelTarget(null);
      await load(filters);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to cancel purchase", "error");
    } finally {
      setCancelling(false);
    }
  }

  if (loading && purchases.length === 0) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Loading purchases...</p>
      </div>
    );
  }

  if (!planFeatures.enablePurchases && !planFeatures.isLoading) {
    return <PlanFeatureGate feature="enablePurchases">{null}</PlanFeatureGate>;
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
          <p className="page-subtitle">Create purchase orders, receive stock in parts, and track what is still due.</p>
        </div>
        <button className="btn btn--primary" onClick={() => setAddOpen(true)}>New Purchase</button>
      </div>

      <div className="ops-metric-strip" aria-label="Purchase summary">
        <div className="ops-metric">
          <span className="ops-metric-label">Purchases</span>
          <strong className="ops-metric-value">{purchases.length}</strong>
        </div>
        <div className="ops-metric">
          <span className="ops-metric-label">Ordered value</span>
          <strong className="ops-metric-value">{fmt(totals.orderedValue, currency)}</strong>
        </div>
        <div className="ops-metric">
          <span className="ops-metric-label">Received value</span>
          <strong className="ops-metric-value">{fmt(totals.receivedValue, currency)}</strong>
        </div>
        <div className="ops-metric">
          <span className="ops-metric-label">Remaining qty</span>
          <strong className="ops-metric-value">{totals.remainingQuantity}</strong>
        </div>
      </div>

      <div className="purchase-filters purchase-filters--lifecycle">
        <select
          className="form-input form-select purchase-filter-select"
          value={filters.status ?? ""}
          onChange={(e) => setFilters((current) => ({ ...current, status: e.target.value ? e.target.value as PurchaseStatus : undefined }))}
        >
          <option value="">All statuses</option>
          {STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
        </select>
        <select
          className="form-input form-select purchase-filter-select"
          value={filters.supplierId ?? ""}
          onChange={(e) => setFilters((current) => ({ ...current, supplierId: e.target.value || undefined }))}
        >
          <option value="">All suppliers</option>
          {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
        </select>
        <select
          className="form-input form-select purchase-filter-select"
          value={filters.locationId ?? ""}
          onChange={(e) => setFilters((current) => ({ ...current, locationId: e.target.value || undefined }))}
        >
          <option value="">Active branch</option>
          {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
        <input
          type="date"
          className="form-input purchase-filter-date"
          value={filters.fromDate ?? ""}
          onChange={(e) => setFilters((current) => ({ ...current, fromDate: e.target.value || undefined }))}
          aria-label="From date"
        />
        <input
          type="date"
          className="form-input purchase-filter-date"
          value={filters.toDate ?? ""}
          onChange={(e) => setFilters((current) => ({ ...current, toDate: e.target.value || undefined }))}
          aria-label="To date"
        />
        {(filters.status || filters.supplierId || filters.locationId || filters.fromDate || filters.toDate) && (
          <button className="btn btn--ghost btn--sm" onClick={() => setFilters({})}>Clear</button>
        )}
      </div>

      {purchases.length === 0 ? (
        <div className="empty-state">
          <h3>No purchases found</h3>
          <p>Create a draft purchase order, then receive stock only when items arrive.</p>
          <button className="btn btn--primary" onClick={() => setAddOpen(true)}>Create draft purchase</button>
        </div>
      ) : (
        <div className="pur-list">
          {purchases.map((purchase) => (
            <article
              key={purchase.id}
              className="pur-item pur-item--lifecycle"
              role="button"
              tabIndex={0}
              onClick={() => setDetailPurchase(purchase)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") setDetailPurchase(purchase);
              }}
            >
              <div className="pur-item-body">
                <div className="pur-item-row">
                  <span className="pur-item-supplier">{purchase.supplier.name}</span>
                  <StatusBadge status={purchase.status} />
                </div>
                <div className="pur-item-items">
                  {purchase.purchaseItems.slice(0, 2).map((line) => line.item.name).join(" / ")}
                  {purchase.purchaseItems.length > 2 && <span className="pur-item-extra"> +{purchase.purchaseItems.length - 2} more</span>}
                </div>
                <div className="purchase-progress">
                  <span>Ordered {purchase.orderedQuantity}</span>
                  <span>Received {purchase.receivedQuantity}</span>
                  <span>Remaining {purchase.remainingQuantity}</span>
                  <span>{purchase.location.name}</span>
                </div>
              </div>
              <div className="pur-item-right">
                <span className="pur-item-amount">{fmt(purchase.totalAmount, currency)}</span>
                <span className="pur-item-received">{fmt(purchase.receivedValue, currency)} received</span>
                <span className="pur-item-date">{fmtDate(purchase.date)}</span>
              </div>
              <svg className="pur-item-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M8 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </article>
          ))}
        </div>
      )}

      {addOpen && (
        <NewPurchaseModal
          currency={currency}
          suppliers={suppliers}
          items={items}
          onClose={() => setAddOpen(false)}
          onError={(message) => showToast(message, "error")}
          onSuccess={async (purchase) => {
            setAddOpen(false);
            showToast("Draft purchase created", "success");
            setDetailPurchase(purchase);
            await load(filters);
          }}
        />
      )}

      {detailPurchase && (
        <PurchaseDetailModal
          purchase={detailPurchase}
          currency={currency}
          onClose={() => setDetailPurchase(null)}
          onOrder={handleOrder}
          onCancel={handleCancel}
          onReceive={(purchase) => setReceivePurchaseTarget(purchase)}
        />
      )}

      {receivePurchaseTarget && (
        <ReceivePurchaseModal
          purchase={receivePurchaseTarget}
          currency={currency}
          locations={locations}
          defaultLocationId={activeLocationId || locations[0]?.id || ""}
          onClose={() => setReceivePurchaseTarget(null)}
          onError={(message) => showToast(message, "error")}
          onSuccess={async (purchase) => {
            setReceivePurchaseTarget(null);
            setDetailPurchase(purchase);
            showToast(purchase.status === "RECEIVED" ? "Purchase fully received" : "Purchase partially received", "success");
            await refreshDetail(purchase.id);
          }}
        />
      )}

      {cancelTarget && (
        <div className="modal-overlay" onClick={() => setCancelTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Cancel Purchase</h2>
              <button className="modal-close" onClick={() => setCancelTarget(null)} aria-label="Close">×</button>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: "var(--space-3)" }}>
                Cancel purchase from <strong>{cancelTarget.supplier.name}</strong>? This cannot be undone.
              </p>
              <label className="form-label">Reason (optional)</label>
              <input
                className="form-input"
                type="text"
                placeholder="e.g. Supplier out of stock"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                autoFocus
              />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn--ghost" onClick={() => setCancelTarget(null)}>Back</button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={cancelling}
                onClick={() => { void confirmCancel(); }}
              >
                {cancelling ? "Cancelling..." : "Cancel Purchase"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="toast-stack">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.type}`}>{toast.msg}</div>
        ))}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: PurchaseStatus }) {
  return <span className={`purchase-status purchase-status--${status.toLowerCase().replace("_", "-")}`}>{STATUS_LABEL[status]}</span>;
}

function PurchaseDetailModal({
  purchase,
  currency,
  onClose,
  onOrder,
  onCancel,
  onReceive,
}: {
  purchase: Purchase;
  currency: string;
  onClose: () => void;
  onOrder: (purchase: Purchase) => void;
  onCancel: (purchase: Purchase) => void;
  onReceive: (purchase: Purchase) => void;
}) {
  const canOrder = purchase.status === "DRAFT";
  const canReceive = purchase.status === "ORDERED" || purchase.status === "PARTIALLY_RECEIVED";
  const canCancel = purchase.status === "DRAFT" || purchase.status === "ORDERED" || purchase.status === "PARTIALLY_RECEIVED";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Purchase Details</h2>
            <p className="modal-subtitle">{purchase.supplier.name} / {fmtDate(purchase.date)}</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">x</button>
        </div>
        <div className="modal-body">
          <div className="purchase-detail-summary">
            <StatusBadge status={purchase.status} />
            <div><span>Ordered</span><strong>{purchase.orderedQuantity}</strong></div>
            <div><span>Received</span><strong>{purchase.receivedQuantity}</strong></div>
            <div><span>Remaining</span><strong>{purchase.remainingQuantity}</strong></div>
            <div><span>Ordered value</span><strong>{fmt(purchase.totalAmount, currency)}</strong></div>
            <div><span>Received value</span><strong>{fmt(purchase.receivedValue, currency)}</strong></div>
          </div>

          <div className="purchase-lifecycle-dates">
            <span>Ordered: {fmtDate(purchase.orderedAt)}</span>
            <span>Expected: {fmtDate(purchase.expectedDeliveryDate)}</span>
            <span>Received: {fmtDate(purchase.receivedAt)}</span>
            {purchase.cancelledAt && <span>Cancelled: {fmtDate(purchase.cancelledAt)}</span>}
          </div>

          {purchase.cancelReason && <div className="alert alert--error">Cancelled: {purchase.cancelReason}</div>}

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="text-right">Ordered qty</th>
                  <th className="text-right">Received qty</th>
                  <th className="text-right">Remaining</th>
                  <th className="text-right">Est. unit cost</th>
                  <th className="text-right">Ordered value</th>
                </tr>
              </thead>
              <tbody>
                {purchase.purchaseItems.map((line) => (
                  <tr key={line.id}>
                    <td className="td-name">{line.item.name} <span className="td-unit">/ {line.item.unit}</span></td>
                    <td className="text-right td-num">{line.orderedQuantity}</td>
                    <td className="text-right td-num">{line.receivedQuantity}</td>
                    <td className="text-right td-num">{line.remainingQuantity}</td>
                    <td className="text-right td-num">{fmt(line.unitCost, currency)}</td>
                    <td className="text-right td-num">{fmt(line.orderedValue, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn--ghost" onClick={onClose}>Close</button>
          {canCancel && <button className="btn btn--danger" onClick={() => onCancel(purchase)}>Cancel Purchase</button>}
          {canOrder && <button className="btn btn--primary" onClick={() => onOrder(purchase)}>Mark Ordered</button>}
          {canReceive && <button className="btn btn--primary" onClick={() => onReceive(purchase)}>Receive Items</button>}
        </div>
      </div>
    </div>
  );
}

function NewPurchaseModal({
  currency,
  suppliers,
  items,
  onClose,
  onSuccess,
  onError,
}: {
  currency: string;
  suppliers: Supplier[];
  items: Item[];
  onClose: () => void;
  onSuccess: (purchase: Purchase) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [supplierId, setSupplierId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [lines, setLines] = useState<PurchaseLineDraft[]>([newLine()]);
  const [saving, setSaving] = useState(false);
  const [supplierSuggestion, setSupplierSuggestion] = useState<{ id: string; name: string } | null>(null);

  async function handleItemChange(key: number, itemId: string) {
    setLines((prev) => prev.map((l) => l.key === key ? { ...l, itemId, lastCost: undefined, metaLoading: !!itemId } : l));
    if (!itemId) return;
    try {
      const [suggRes, priceRes] = await Promise.all([
        getSupplierSuggestion(itemId),
        getPriceHistory(itemId, 1),
      ]);
      const lastCost = priceRes.history[0]?.unitCost ?? null;
      setLines((prev) => prev.map((l) => {
        if (l.key !== key) return l;
        return { ...l, metaLoading: false, lastCost, unitCost: l.unitCost || (lastCost != null ? String(lastCost) : "") };
      }));
      if (suggRes.suggestion && !supplierId) {
        setSupplierSuggestion(suggRes.suggestion);
      }
    } catch {
      setLines((prev) => prev.map((l) => l.key === key ? { ...l, metaLoading: false } : l));
    }
  }

  function updateLine(key: number, patch: Partial<PurchaseLineDraft>) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  }

  function removeLine(key: number) {
    setLines((current) => current.length > 1 ? current.filter((line) => line.key !== key) : current);
  }

  const grandTotal = lines.reduce((sum, line) => {
    const quantity = numberValue(line.quantity) ?? 0;
    const unitCost = numberValue(line.unitCost) ?? 0;
    return sum + quantity * unitCost;
  }, 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const validLines = lines.filter((line) => line.itemId && (numberValue(line.quantity) ?? 0) > 0 && (numberValue(line.unitCost) ?? -1) >= 0);
    if (!supplierId) return onError("Supplier is required");
    if (validLines.length === 0) return onError("Add at least one valid purchase line");

    const payload: CreatePurchaseInput = {
      supplierId,
      date,
      expectedDeliveryDate: expectedDeliveryDate || undefined,
      items: validLines.map((line) => ({
        itemId: line.itemId,
        quantity: numberValue(line.quantity)!,
        unitCost: numberValue(line.unitCost)!,
      })),
    };

    setSaving(true);
    try {
      const res = await createPurchase(payload);
      await onSuccess(res.purchase);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to create purchase");
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide modal--purchase" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header purchase-modal-header">
          <div>
            <h2 className="modal-title">New Draft Purchase</h2>
            <p className="modal-subtitle">Build the order first. Stock is added later from Receive Items.</p>
          </div>
          <button className="modal-close purchase-modal-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <form onSubmit={(event) => { void submit(event); }}>
          <div className="modal-body purchase-modal-body">
            <div className="purchase-info-panel">
              <div className="purchase-info-heading">
                <span>Purchase Info</span>
                <strong>Draft</strong>
              </div>
              <div className="purchase-header-fields">
              <label className="form-group">
                <span className="form-label">Supplier</span>
                <select className="form-input form-select" value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
                  <option value="">Select supplier</option>
                  {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                </select>
              </label>
              {supplierSuggestion && !supplierId && (
                <button type="button" className="pur-supplier-hint" onClick={() => { setSupplierId(supplierSuggestion.id); setSupplierSuggestion(null); }}>
                  Suggested: {supplierSuggestion.name} — tap to use
                </button>
              )}
              <label className="form-group">
                <span className="form-label">Purchase date</span>
                <input className="form-input" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </label>
              <label className="form-group">
                <span className="form-label">Expected delivery</span>
                <input className="form-input" type="date" value={expectedDeliveryDate} onChange={(event) => setExpectedDeliveryDate(event.target.value)} />
              </label>
              </div>
            </div>

            <div className="purchase-lines-section">
              <div className="purchase-lines-title-row">
                <div>
                  <span className="purchase-lines-label">Line items</span>
                  <p>Batch numbers and expiry dates are added when you receive the goods.</p>
                </div>
                <button type="button" className="btn btn--ghost btn--sm purchase-add-line-btn" onClick={() => setLines((current) => [...current, newLine()])}>Add Line</button>
              </div>
              <div className="purchase-line purchase-line--lifecycle purchase-line--header">
                <span>Item</span><span>Qty</span><span>Unit cost</span><span>Total</span><span />
              </div>
              {lines.map((line) => {
                const quantity = numberValue(line.quantity) ?? 0;
                const unitCost = numberValue(line.unitCost) ?? 0;
                return (
                  <div key={line.key} className="purchase-line purchase-line--lifecycle">
                    <select aria-label="Item" className="form-input form-select" value={line.itemId} onChange={(event) => { void handleItemChange(line.key, event.target.value); }}>
                      <option value="">Select item</option>
                      {items.map((item) => <option key={item.id} value={item.id}>{item.name} / {item.unit}</option>)}
                    </select>
                    <input aria-label="Quantity" className="form-input" type="number" min="0.01" step="0.01" value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} placeholder="0" />
                    <div className="pur-line-cost-cell">
                      <input aria-label="Unit cost" className="form-input" type="number" min="0" step="0.01" value={line.unitCost} onChange={(event) => updateLine(line.key, { unitCost: event.target.value })} placeholder="0.00" />
                      {line.lastCost != null && <span className="pur-cost-hint">Last: {fmt(line.lastCost, currency)}</span>}
                    </div>
                    <span className="purchase-line-total">{fmt(quantity * unitCost, currency)}</span>
                    <button type="button" className="purchase-line-remove" onClick={() => removeLine(line.key)} disabled={lines.length === 1} aria-label="Remove line">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                );
              })}
              <div className="purchase-grand-total">
                <span className="purchase-grand-total-label">Ordered total</span>
                <span className="purchase-grand-total-value">{fmt(grandTotal, currency)}</span>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn--primary" disabled={saving}>{saving ? "Saving..." : "Create Draft"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ReceivePurchaseModal({
  purchase,
  currency,
  locations,
  defaultLocationId,
  onClose,
  onSuccess,
  onError,
}: {
  purchase: Purchase;
  currency: string;
  locations: Location[];
  defaultLocationId: string;
  onClose: () => void;
  onSuccess: (purchase: Purchase) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [lines, setLines] = useState<ReceiveLineDraft[]>(() =>
    purchase.purchaseItems
      .filter((line) => line.remainingQuantity > 0)
      .map((line) => ({
        purchaseItemId: line.id,
        receivedQuantity: String(line.remainingQuantity),
        locationId: defaultLocationId || purchase.location.id,
        expiryDate: "",
        batchNo: "",
        unitCost: String(line.unitCost),
        notes: "",
      })),
  );
  const [saving, setSaving] = useState(false);

  function updateLine(purchaseItemId: string, patch: Partial<ReceiveLineDraft>) {
    setLines((current) => current.map((line) => line.purchaseItemId === purchaseItemId ? { ...line, ...patch } : line));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const validLines = lines.filter((line) => (numberValue(line.receivedQuantity) ?? 0) > 0);
    if (validLines.length === 0) return onError("Enter at least one received quantity");

    setSaving(true);
    try {
      const res = await receivePurchase(purchase.id, {
        lines: validLines.map((line) => ({
          purchaseItemId: line.purchaseItemId,
          receivedQuantity: numberValue(line.receivedQuantity)!,
          locationId: line.locationId,
          expiryDate: line.expiryDate || undefined,
          batchNo: line.batchNo || undefined,
          unitCost: numberValue(line.unitCost),
          notes: line.notes || undefined,
        })),
      });
      await onSuccess(res.purchase);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to receive purchase");
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title">Receive Items</h2>
            <p className="modal-subtitle">{purchase.supplier.name} / Remaining {purchase.remainingQuantity}</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">x</button>
        </div>
        <form onSubmit={(event) => { void submit(event); }}>
          <div className="modal-body">
            <div className="purchase-line receive-line receive-line--header">
              <span>Item</span><span>Remaining</span><span>Receive</span><span>Branch</span><span>Expiry</span><span>Batch</span><span>Unit cost</span><span>Notes</span>
            </div>
            {purchase.purchaseItems.filter((line) => line.remainingQuantity > 0).map((itemLine) => {
              const line = lines.find((candidate) => candidate.purchaseItemId === itemLine.id)!;
              return (
                <div key={itemLine.id} className="purchase-line receive-line">
                  <span className="td-name">{itemLine.item.name}</span>
                  <span>{itemLine.remainingQuantity}</span>
                  <input className="form-input" type="number" min="0" max={itemLine.remainingQuantity} step="0.01" value={line.receivedQuantity} onChange={(event) => updateLine(itemLine.id, { receivedQuantity: event.target.value })} />
                  <select className="form-input form-select" value={line.locationId} onChange={(event) => updateLine(itemLine.id, { locationId: event.target.value })}>
                    {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                  </select>
                  <input className="form-input" type="date" value={line.expiryDate} onChange={(event) => updateLine(itemLine.id, { expiryDate: event.target.value })} />
                  <input className="form-input" value={line.batchNo} onChange={(event) => updateLine(itemLine.id, { batchNo: event.target.value })} />
                  <input className="form-input" type="number" min="0" step="0.01" value={line.unitCost} onChange={(event) => updateLine(itemLine.id, { unitCost: event.target.value })} />
                  <input className="form-input" value={line.notes} onChange={(event) => updateLine(itemLine.id, { notes: event.target.value })} placeholder="Optional" />
                </div>
              );
            })}
            <p className="purchase-receive-hint">Stock batches and stock-in movements are created only when this receiving form is submitted.</p>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn--primary" disabled={saving}>{saving ? "Receiving..." : `Receive (${fmt(lines.reduce((sum, line) => sum + ((numberValue(line.receivedQuantity) ?? 0) * (numberValue(line.unitCost) ?? 0)), 0), currency)})`}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
