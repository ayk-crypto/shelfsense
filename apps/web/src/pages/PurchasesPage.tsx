import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PlanFeatureGate } from "../components/PlanFeatureGate";
import { usePlanFeatures } from "../context/PlanFeaturesContext";
import {
  bulkDeletePurchases,
  cancelPurchase,
  createPurchase,
  deletePurchase,
  getPurchase,
  getPurchases,
  orderPurchase,
  patchPurchaseSupplier,
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
import { hasPurchaseUnit, fmtQty } from "../utils/purchaseUnits";

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
  quantity: string;       // in purchase units if purchaseUnit set, else base units
  unitCost: string;       // per purchase unit if purchaseUnit set, else per base unit
  lastCost?: number | null;
  metaLoading?: boolean;
  purchaseUnit?: string | null;
  purchaseConversionFactor?: number | null;
  baseUnit?: string;
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
  const navigate = useNavigate();
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
  const [detailPurchase, setDetailPurchase] = useState<Purchase | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Purchase | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [filters, setFilters] = useState<PurchaseFilters>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSupplierId, setBulkSupplierId] = useState("");
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Purchase | null>(null);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
    await load(filters);
  }

  function toggleSelect(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }

  function toggleSelectAll(checked: boolean) {
    if (checked) {
      setSelectedIds(new Set(purchases.filter((p) => p.status === "DRAFT").map((p) => p.id)));
    } else {
      setSelectedIds(new Set());
    }
  }

  async function handleBulkAssign() {
    if (!bulkSupplierId || selectedIds.size === 0) return;
    setBulkAssigning(true);
    const ids = [...selectedIds];
    let successCount = 0;
    let failCount = 0;
    for (const id of ids) {
      try {
        await patchPurchaseSupplier(id, bulkSupplierId);
        successCount++;
      } catch {
        failCount++;
      }
    }
    setBulkAssigning(false);
    setSelectedIds(new Set());
    setBulkSupplierId("");
    await load(filters);
    if (failCount === 0) {
      showToast(`Supplier updated on ${successCount} draft${successCount !== 1 ? "s" : ""}`, "success");
    } else {
      showToast(`Updated ${successCount}, failed ${failCount}`, "error");
    }
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

  function handleDeleteDraft(purchase: Purchase) {
    setDeleteTarget(purchase);
  }

  async function confirmDeleteDraft() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deletePurchase(deleteTarget.id);
      showToast("Draft purchase order deleted.", "success");
      if (detailPurchase?.id === deleteTarget.id) setDetailPurchase(null);
      setDeleteTarget(null);
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(deleteTarget.id); return next; });
      await load(filters);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to delete purchase", "error");
    } finally {
      setDeleting(false);
    }
  }

  async function confirmBulkDeleteDrafts() {
    setDeleting(true);
    try {
      const res = await bulkDeletePurchases([...selectedIds]);
      const n = res.deletedCount;
      showToast(
        n === 1 ? "Draft purchase order deleted." : `${n} draft purchase orders deleted.`,
        "success",
      );
      setBulkDeleteConfirmOpen(false);
      setSelectedIds(new Set());
      await load(filters);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to delete purchases", "error");
    } finally {
      setDeleting(false);
    }
  }

  if (planFeatures.isLoading || loading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Loading purchases...</p>
      </div>
    );
  }

  if (!planFeatures.enablePurchases) {
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

      {/* Bulk action bar — appears when DRAFT rows are selected */}
      {selectedIds.size > 0 && (
        <div className="pur-bulk-bar">
          <span className="pur-bulk-count">{selectedIds.size} draft{selectedIds.size !== 1 ? "s" : ""} selected</span>
          <select
            className="pur-bulk-supplier"
            value={bulkSupplierId}
            onChange={(e) => setBulkSupplierId(e.target.value)}
          >
            <option value="">— pick supplier —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button
            className="btn btn--primary btn--sm"
            disabled={!bulkSupplierId || bulkAssigning}
            onClick={() => { void handleBulkAssign(); }}
          >
            {bulkAssigning ? "Assigning…" : "Assign Supplier"}
          </button>
          <button
            className="btn btn--danger btn--sm"
            onClick={() => setBulkDeleteConfirmOpen(true)}
          >
            Delete Selected
          </button>
          <button className="pur-bulk-clear" onClick={() => setSelectedIds(new Set())}>Clear</button>
        </div>
      )}

      {purchases.length === 0 ? (
        <div className="empty-state">
          <h3>No purchases found</h3>
          <p>Create a draft purchase order, then receive stock only when items arrive.</p>
          <button className="btn btn--primary" onClick={() => setAddOpen(true)}>Create draft purchase</button>
        </div>
      ) : (
        <div className="pur-list">
          {/* Select-all header — only shown when there are DRAFTs */}
          {purchases.some((p) => p.status === "DRAFT") && (
            <div className="pur-select-all-row">
              <label className="pur-select-all-label">
                <input
                  type="checkbox"
                  checked={
                    purchases.filter((p) => p.status === "DRAFT").length > 0 &&
                    purchases.filter((p) => p.status === "DRAFT").every((p) => selectedIds.has(p.id))
                  }
                  onChange={(e) => toggleSelectAll(e.target.checked)}
                />
                <span>Select all drafts</span>
              </label>
            </div>
          )}
          {purchases.map((purchase) => {
            const isDraft = purchase.status === "DRAFT";
            const isSelected = selectedIds.has(purchase.id);
            return (
              <article
                key={purchase.id}
                className={`pur-item pur-item--lifecycle${isDraft ? " pur-item--selectable" : ""}${isSelected ? " pur-item--selected" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => setDetailPurchase(purchase)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") setDetailPurchase(purchase);
                }}
              >
                {isDraft && (
                  <div className="pur-check-wrap" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => toggleSelect(purchase.id, e.target.checked)}
                      aria-label={`Select draft from ${purchase.supplier.name}`}
                    />
                  </div>
                )}
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
                <RowActionMenu
                  purchase={purchase}
                  onDeleteDraft={() => handleDeleteDraft(purchase)}
                  onCancel={() => handleCancel(purchase)}
                />
              </article>
            );
          })}
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
          workspaceName={settings.name || "ShelfSense"}
          ownerPhone={settings.ownerPhone}
          onClose={() => setDetailPurchase(null)}
          onOrder={handleOrder}
          onCancel={handleCancel}
          onReceive={(purchase) => {
            setDetailPurchase(null);
            navigate(`/stock-in?mode=po&poId=${purchase.id}`);
          }}
        />
      )}

      {cancelTarget && (
        <CancelPurchaseModal
          target={cancelTarget}
          reason={cancelReason}
          cancelling={cancelling}
          onReasonChange={setCancelReason}
          onConfirm={() => { void confirmCancel(); }}
          onClose={() => setCancelTarget(null)}
        />
      )}

      {deleteTarget && (
        <DeleteDraftModal
          purchase={deleteTarget}
          deleting={deleting}
          onConfirm={() => { void confirmDeleteDraft(); }}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {bulkDeleteConfirmOpen && (
        <BulkDeleteDraftsModal
          count={selectedIds.size}
          deleting={deleting}
          onConfirm={() => { void confirmBulkDeleteDrafts(); }}
          onClose={() => setBulkDeleteConfirmOpen(false)}
        />
      )}

      <div className="toast-stack">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.type}`}>{toast.msg}</div>
        ))}
      </div>
    </div>
  );
}

function escHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function downloadPurchaseOrder(
  purchase: Purchase,
  currency: string,
  workspaceName: string,
  ownerPhone?: string | null,
) {
  const poNum = `PO-${purchase.id.slice(-8).toUpperCase()}`;
  const statusSlug = purchase.status.toLowerCase().replace(/_/g, "-");
  const showReceiving = purchase.status !== "DRAFT";
  const cols = showReceiving ? 6 : 4;

  // ── per-line helpers ─────────────────────────────────────────────────────
  function lineHelpers(line: (typeof purchase.purchaseItems)[0]) {
    const hasUop = hasPurchaseUnit(line.item.purchaseUnit, line.item.purchaseConversionFactor);
    const factor = line.item.purchaseConversionFactor ?? 1;
    const displayUnit = hasUop ? (line.item.purchaseUnit ?? line.item.unit) : line.item.unit;
    const toDisplay = (n: number) => fmtQty(hasUop ? n / factor : n);
    const dCostPerPU = hasUop ? line.unitCost * factor : line.unitCost;
    const costStr = dCostPerPU > 0 ? fmt(dCostPerPU, currency) : "—";
    const totalStr = dCostPerPU > 0 ? fmt(line.orderedValue, currency) : "—";
    return { displayUnit, toDisplay, costStr, totalStr };
  }

  // ── summary totals in purchase units ────────────────────────────────────
  let sumOrdered = 0, sumReceived = 0, sumRemaining = 0;
  let allCostsMissing = true;
  for (const line of purchase.purchaseItems) {
    const hasUop = hasPurchaseUnit(line.item.purchaseUnit, line.item.purchaseConversionFactor);
    const factor = line.item.purchaseConversionFactor ?? 1;
    sumOrdered   += hasUop ? line.orderedQuantity / factor : line.orderedQuantity;
    sumReceived  += hasUop ? line.receivedQuantity / factor : line.receivedQuantity;
    sumRemaining += hasUop ? line.remainingQuantity / factor : line.remainingQuantity;
    const dCost = hasUop ? line.unitCost * factor : line.unitCost;
    if (dCost > 0) allCostsMissing = false;
  }
  const estValueStr = allCostsMissing ? "Pricing not set" : fmt(purchase.totalAmount, currency);
  const recValueStr = allCostsMissing ? "—" : fmt(purchase.receivedValue, currency);

  // ── group line items by category ─────────────────────────────────────────
  const grouped = new Map<string, typeof purchase.purchaseItems>();
  for (const line of purchase.purchaseItems) {
    const cat = line.item.category?.trim() || "Uncategorized";
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(line);
  }
  const sortedCats = [...grouped.keys()].sort((a, b) => {
    if (a === "Uncategorized") return 1;
    if (b === "Uncategorized") return -1;
    return a.localeCompare(b);
  });

  // ── build table rows ──────────────────────────────────────────────────────
  const tableRows = sortedCats.map((cat) => {
    const lines = grouped.get(cat)!;
    const catRow = `<tr class="cat-row"><td colspan="${cols}"><span class="cat-lbl">${escHtml(cat)}</span></td></tr>`;
    const lineRows = lines.map((line) => {
      const { displayUnit, toDisplay, costStr, totalStr } = lineHelpers(line);
      const minNote = line.item.minStockLevel > 0
        ? `<span class="item-min">Min: ${fmtQty(line.item.minStockLevel)} ${escHtml(displayUnit)}</span>`
        : "";
      const itemCell = `<td><span class="item-nm">${escHtml(line.item.name)}</span> <span class="item-u">/ ${escHtml(displayUnit)}</span>${minNote}</td>`;
      const ordCell  = `<td class="num">${toDisplay(line.orderedQuantity)}</td>`;
      const costCell = `<td class="num">${escHtml(costStr)}</td>`;
      const totCell  = `<td class="num">${escHtml(totalStr)}</td>`;
      if (showReceiving) {
        return `<tr>${itemCell}${ordCell}<td class="num">${toDisplay(line.receivedQuantity)}</td><td class="num">${toDisplay(line.remainingQuantity)}</td>${costCell}${totCell}</tr>`;
      }
      return `<tr>${itemCell}${ordCell}${costCell}${totCell}</tr>`;
    }).join("");
    return catRow + lineRows;
  }).join("");

  // ── tfoot totals ──────────────────────────────────────────────────────────
  const tfootOrdered   = `<tr class="tf-row"><td colspan="${cols - 1}">Total ordered value</td><td class="num">${allCostsMissing ? "—" : escHtml(fmt(purchase.totalAmount, currency))}</td></tr>`;
  const tfootReceived  = showReceiving
    ? `<tr class="tf-row"><td colspan="${cols - 1}">Total received value</td><td class="num">${allCostsMissing ? "—" : escHtml(fmt(purchase.receivedValue, currency))}</td></tr>`
    : "";

  // ── supplier info ─────────────────────────────────────────────────────────
  const suppInfo = [
    `<div class="info-name">${escHtml(purchase.supplier.name)}</div>`,
    purchase.supplier.phone ? `<div class="info-line">${escHtml(purchase.supplier.phone)}</div>` : "",
    purchase.supplier.notes ? `<div class="info-line info-notes">${escHtml(purchase.supplier.notes)}</div>` : "",
  ].join("");

  // ── buyer info ────────────────────────────────────────────────────────────
  const buyerInfo = [
    `<div class="info-name">${escHtml(workspaceName)}</div>`,
    `<div class="info-line">${escHtml(purchase.location.name)}</div>`,
    ownerPhone ? `<div class="info-line">${escHtml(ownerPhone)}</div>` : "",
  ].join("");

  // ── dates ─────────────────────────────────────────────────────────────────
  function datePill(label: string, value: string | null | undefined) {
    if (!value) return "";
    return `<div class="dp"><span class="dp-lbl">${escHtml(label)}</span><strong class="dp-val">${escHtml(fmtDate(value))}</strong></div>`;
  }
  const datesHtml = [
    datePill("PO Date", purchase.date),
    datePill("Expected Delivery", purchase.expectedDeliveryDate),
    datePill("Ordered On", purchase.orderedAt),
    datePill("Received On", purchase.receivedAt),
    datePill("Cancelled On", purchase.cancelledAt),
  ].filter(Boolean).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escHtml(poNum)} — ${escHtml(purchase.supplier.name)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1e293b;background:#fff;font-size:13px;max-width:960px;margin:0 auto;padding:40px 48px}
@media print{
  .no-print{display:none!important}
  body{padding:20px 28px;font-size:12px}
  @page{size:A4;margin:14mm 12mm}
  .page-break-avoid{page-break-inside:avoid}
}

/* print toolbar */
.no-print{margin-bottom:28px}
.print-btn{background:#6366f1;color:#fff;border:none;padding:9px 20px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:8px}
.print-btn:hover{background:#4f46e5}

/* header */
.po-header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #6366f1;padding-bottom:18px;margin-bottom:24px;gap:24px}
.po-brand{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#6366f1;margin-bottom:4px}
.po-title{font-size:26px;font-weight:800;color:#1e293b;letter-spacing:-.5px;line-height:1.1}
.po-num{font-size:12px;color:#64748b;margin-top:4px;font-weight:500;font-family:monospace}
.po-meta{text-align:right;font-size:12px;color:#64748b;line-height:1.9;min-width:200px}
.po-meta strong{color:#1e293b;font-weight:600}
.po-badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;vertical-align:middle}
.po-badge--draft{background:#f1f5f9;color:#475569}
.po-badge--ordered{background:#eef2ff;color:#4338ca}
.po-badge--partially-received{background:#fff7ed;color:#c2410c}
.po-badge--received{background:#ecfdf5;color:#047857}
.po-badge--cancelled{background:#fef2f2;color:#b91c1c}

/* two-col info boxes */
.info-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px}
.info-box{border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px}
.info-box-lbl{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin-bottom:8px}
.info-name{font-size:15px;font-weight:700;color:#1e293b;margin-bottom:4px}
.info-line{font-size:12px;color:#475569;margin-bottom:2px}
.info-notes{color:#64748b;font-style:italic;margin-top:4px}

/* dates strip */
.dates-strip{display:flex;flex-wrap:wrap;gap:16px 28px;margin-bottom:18px;padding:12px 16px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0}
.dp{}
.dp-lbl{display:block;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;margin-bottom:2px}
.dp-val{font-size:13px;font-weight:600;color:#1e293b}

/* summary box */
.summary-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:0;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:22px}
.sum-cell{padding:12px 14px;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0}
.sum-cell:nth-child(3n){border-right:none}
.sum-cell:nth-last-child(-n+3){border-bottom:none}
.sum-lbl{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;margin-bottom:4px}
.sum-val{font-size:16px;font-weight:700;color:#1e293b}
.sum-val--accent{color:#6366f1}
.sum-val--muted{font-size:13px;color:#64748b;font-weight:500}

/* section heading */
.sec-head{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin-bottom:8px;margin-top:4px}

/* items table */
.po-box{border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:20px}
table{width:100%;border-collapse:collapse}
thead{background:#f8fafc}
th{padding:9px 12px;text-align:left;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#64748b;border-bottom:1px solid #e2e8f0;white-space:nowrap}
th.num,td.num{text-align:right;font-variant-numeric:tabular-nums}
td{padding:10px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#1e293b;vertical-align:middle}
.item-nm{font-weight:500}
.item-u{color:#94a3b8;font-size:12px}
.item-min{display:block;font-size:10.5px;color:#94a3b8;margin-top:2px}
.cat-row td{background:#f8fafc;padding:6px 12px;border-bottom:1px solid #e2e8f0}
.cat-lbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#475569}
tr:last-child td{border-bottom:none}
.tf-row td{background:#f8fafc;font-weight:700;border-top:2px solid #e2e8f0;font-size:13px;border-bottom:none}

/* cancel box */
.cancel-box{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;color:#991b1b;font-size:13px;margin-bottom:20px}

/* approval / receiving sections */
.sig-section{border:1px solid #e2e8f0;border-radius:8px;padding:16px 18px;margin-bottom:18px;page-break-inside:avoid}
.sig-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin-bottom:14px}
.sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px 28px}
.sig-field{padding-bottom:8px;border-bottom:1px solid #cbd5e1}
.sig-field-lbl{font-size:10px;color:#94a3b8;margin-bottom:18px;display:block}
.approval-status{margin-top:14px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:12px;color:#475569}
.approval-status strong{color:#1e293b}

/* footer */
.po-footer{margin-top:40px;padding-top:12px;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;font-size:10.5px;color:#94a3b8}
</style>
</head>
<body>

<div class="no-print">
  <button class="print-btn" onclick="window.print()">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
    Print / Save as PDF
  </button>
</div>

<!-- ── Header ── -->
<div class="po-header">
  <div>
    <div class="po-brand">${escHtml(workspaceName)}</div>
    <div class="po-title">Purchase Order</div>
    <div class="po-num">${escHtml(poNum)}</div>
  </div>
  <div class="po-meta">
    <div>Status: <span class="po-badge po-badge--${statusSlug}">${escHtml(STATUS_LABEL[purchase.status])}</span></div>
    <div>Branch: <strong>${escHtml(purchase.location.name)}</strong></div>
  </div>
</div>

<!-- ── Supplier & Buyer ── -->
<div class="info-row">
  <div class="info-box">
    <div class="info-box-lbl">Supplier</div>
    ${suppInfo || `<div class="info-line">—</div>`}
  </div>
  <div class="info-box">
    <div class="info-box-lbl">Buyer / Business</div>
    ${buyerInfo}
  </div>
</div>

<!-- ── Dates ── -->
${datesHtml ? `<div class="dates-strip">${datesHtml}</div>` : ""}

<!-- ── Summary ── -->
<div class="summary-grid">
  <div class="sum-cell">
    <div class="sum-lbl">Total items</div>
    <div class="sum-val">${purchase.purchaseItems.length}</div>
  </div>
  <div class="sum-cell">
    <div class="sum-lbl">Ordered qty</div>
    <div class="sum-val">${fmtQty(sumOrdered)}</div>
  </div>
  <div class="sum-cell">
    <div class="sum-lbl">Estimated value</div>
    <div class="${purchase.totalAmount > 0 ? "sum-val sum-val--accent" : "sum-val sum-val--muted"}">${escHtml(estValueStr)}</div>
  </div>
  <div class="sum-cell">
    <div class="sum-lbl">Received qty</div>
    <div class="sum-val">${fmtQty(sumReceived)}</div>
  </div>
  <div class="sum-cell">
    <div class="sum-lbl">Remaining qty</div>
    <div class="sum-val">${fmtQty(sumRemaining)}</div>
  </div>
  <div class="sum-cell">
    <div class="sum-lbl">Received value</div>
    <div class="sum-val">${escHtml(recValueStr)}</div>
  </div>
</div>

<!-- ── Line Items ── -->
<div class="sec-head">Line Items &nbsp;(${purchase.purchaseItems.length})</div>
<div class="po-box">
  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th class="num">Ordered</th>
        ${showReceiving ? `<th class="num">Received</th><th class="num">Remaining</th>` : ""}
        <th class="num">Unit Cost</th>
        <th class="num">Total Value</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
    <tfoot>
      ${tfootOrdered}
      ${tfootReceived}
    </tfoot>
  </table>
</div>

<!-- ── Cancellation ── -->
${purchase.cancelReason ? `<div class="cancel-box"><strong>Cancellation reason:</strong> ${escHtml(purchase.cancelReason)}</div>` : ""}

<!-- ── Approval ── -->
<div class="sig-section page-break-avoid">
  <div class="sig-title">Approval</div>
  <div class="sig-grid">
    <div class="sig-field"><span class="sig-field-lbl">Prepared by</span></div>
    <div class="sig-field"><span class="sig-field-lbl">Reviewed by</span></div>
    <div class="sig-field"><span class="sig-field-lbl">Approved by</span></div>
    <div class="sig-field"><span class="sig-field-lbl">Date approved</span></div>
  </div>
  <div class="approval-status">Approval status: <strong>${escHtml(STATUS_LABEL[purchase.status])}</strong></div>
</div>

<!-- ── Receiving ── -->
<div class="sig-section page-break-avoid">
  <div class="sig-title">Receiving</div>
  <div class="sig-grid">
    <div class="sig-field"><span class="sig-field-lbl">Received by</span></div>
    <div class="sig-field"><span class="sig-field-lbl">Receiving date</span></div>
    <div class="sig-field"><span class="sig-field-lbl">Supplier invoice / bill no.</span></div>
    <div class="sig-field"><span class="sig-field-lbl">Remarks</span></div>
  </div>
</div>

<!-- ── Footer ── -->
<div class="po-footer">
  <span>Generated by ShelfSense</span>
  <span>${escHtml(poNum)} &nbsp;·&nbsp; ${escHtml(purchase.supplier.name)} &nbsp;·&nbsp; ${escHtml(purchase.location.name)}</span>
  <span>${new Date().toLocaleString()}</span>
</div>

</body>
</html>`;

  const win = window.open("", "_blank");
  if (win) {
    win.document.write(html);
    win.document.close();
    win.focus();
  }
}

function CancelPurchaseModal({
  target,
  reason,
  cancelling,
  onReasonChange,
  onConfirm,
  onClose,
}: {
  target: Purchase;
  reason: string;
  cancelling: boolean;
  onReasonChange: (v: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Cancel Purchase Order</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
            </svg>
          </button>
        </div>
        <div className="modal-body">
          <div className="poc-warning">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <span>Cancelling the purchase from <strong>{target.supplier.name}</strong> cannot be undone.</span>
          </div>
          <label className="form-group">
            <span className="form-label">Reason (optional)</span>
            <input
              className="form-input"
              type="text"
              placeholder="e.g. Supplier out of stock"
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              autoFocus
            />
          </label>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Back</button>
          <button type="button" className="btn btn--danger" disabled={cancelling} onClick={onConfirm}>
            {cancelling ? "Cancelling…" : "Yes, Cancel PO"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: PurchaseStatus }) {
  return <span className={`purchase-status purchase-status--${status.toLowerCase().replace("_", "-")}`}>{STATUS_LABEL[status]}</span>;
}

function RowActionMenu({
  purchase,
  onDeleteDraft,
  onCancel,
}: {
  purchase: Purchase;
  onDeleteDraft: () => void;
  onCancel: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isDraft = purchase.status === "DRAFT";
  const canCancel = purchase.status === "ORDERED" || purchase.status === "PARTIALLY_RECEIVED";

  useEffect(() => {
    if (!open) return;
    function outside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

  if (!isDraft && !canCancel) {
    return (
      <svg className="pur-item-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M8 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <div className="pur-row-menu" ref={menuRef} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="pur-row-menu-btn"
        aria-label="More actions"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>
      {open && (
        <div className="pur-row-menu-drop">
          {isDraft && (
            <button
              type="button"
              className="pur-row-menu-item pur-row-menu-item--danger"
              onClick={() => { setOpen(false); onDeleteDraft(); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" /><path d="M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
              Delete Draft
            </button>
          )}
          {canCancel && (
            <button
              type="button"
              className="pur-row-menu-item"
              onClick={() => { setOpen(false); onCancel(); }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              Cancel PO
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DeleteDraftModal({
  purchase,
  deleting,
  onConfirm,
  onClose,
}: {
  purchase: Purchase;
  deleting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Delete draft purchase order?</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        <div className="modal-body">
          <div className="poc-warning poc-warning--danger">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
            <div>
              <p>This will permanently delete the draft purchase order from <strong>{purchase.supplier.name}</strong>.</p>
              <p style={{ marginTop: 6, opacity: 0.85 }}>This cannot be undone. To preserve a record, cancel the purchase order instead.</p>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={deleting}>Back</button>
          <button type="button" className="btn btn--danger" disabled={deleting} onClick={onConfirm}>
            {deleting ? "Deleting…" : "Delete Draft"}
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkDeleteDraftsModal({
  count,
  deleting,
  onConfirm,
  onClose,
}: {
  count: number;
  deleting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Delete {count} draft purchase order{count !== 1 ? "s" : ""}?</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        <div className="modal-body">
          <div className="poc-warning poc-warning--danger">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
            <div>
              <p>This will permanently delete <strong>{count} selected draft purchase order{count !== 1 ? "s" : ""}</strong>.</p>
              <p style={{ marginTop: 6, opacity: 0.85 }}>This cannot be undone. Only draft orders will be deleted — any non-draft orders in the selection are ignored.</p>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={deleting}>Back</button>
          <button type="button" className="btn btn--danger" disabled={deleting} onClick={onConfirm}>
            {deleting ? "Deleting…" : `Delete ${count} Draft${count !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function PurchaseDetailModal({
  purchase,
  currency,
  workspaceName,
  ownerPhone,
  onClose,
  onOrder,
  onCancel,
  onReceive,
}: {
  purchase: Purchase;
  currency: string;
  workspaceName: string;
  ownerPhone?: string | null;
  onClose: () => void;
  onOrder: (purchase: Purchase) => void;
  onCancel: (purchase: Purchase) => void;
  onReceive: (purchase: Purchase) => void;
}) {
  const canOrder = purchase.status === "DRAFT";
  const canReceive = purchase.status === "ORDERED" || purchase.status === "PARTIALLY_RECEIVED";
  const canCancel = purchase.status === "DRAFT" || purchase.status === "ORDERED" || purchase.status === "PARTIALLY_RECEIVED";
  const receivedPct = purchase.orderedQuantity > 0
    ? Math.min(100, Math.round((purchase.receivedQuantity / purchase.orderedQuantity) * 100))
    : 0;
  const lifecycleDates = [
    { label: "Ordered", value: purchase.orderedAt },
    { label: "Expected delivery", value: purchase.expectedDeliveryDate },
    { label: "Received", value: purchase.receivedAt },
    { label: "Cancelled", value: purchase.cancelledAt },
  ].filter((d) => d.value);

  // Sum quantities in purchase units so KPI strip matches what the table shows
  const poQtys = purchase.purchaseItems.reduce(
    (acc, line) => {
      const hasUop = hasPurchaseUnit(line.item.purchaseUnit, line.item.purchaseConversionFactor);
      const factor = line.item.purchaseConversionFactor ?? 1;
      acc.ordered   += hasUop ? line.orderedQuantity   / factor : line.orderedQuantity;
      acc.received  += hasUop ? line.receivedQuantity  / factor : line.receivedQuantity;
      acc.remaining += hasUop ? line.remainingQuantity / factor : line.remainingQuantity;
      return acc;
    },
    { ordered: 0, received: 0, remaining: 0 },
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide pod" onClick={(e) => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="pod-head">
          <div className="pod-head-left">
            <div className="pod-avatar" aria-hidden="true">
              {purchase.supplier.name.charAt(0).toUpperCase()}
            </div>
            <div className="pod-head-info">
              <span className="pod-supplier-name">{purchase.supplier.name}</span>
              <span className="pod-ref">
                PO-{purchase.id.slice(-8).toUpperCase()}
                <span className="pod-ref-dot">·</span>
                {purchase.location.name}
                <span className="pod-ref-dot">·</span>
                {fmtDate(purchase.date)}
              </span>
            </div>
          </div>
          <div className="pod-head-right">
            <StatusBadge status={purchase.status} />
            <button
              type="button"
              className="btn btn--ghost btn--sm pod-dl-btn"
              onClick={() => downloadPurchaseOrder(purchase, currency, workspaceName, ownerPhone)}
              title="Download / Print PO"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              <span className="pod-dl-text">Download PO</span>
            </button>
            <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
              <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
              </svg>
            </button>
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div className="pod-body">

          {/* KPI strip */}
          <div className="pod-kpis">
            <div className="pod-kpi">
              <span className="pod-kpi-label">Ordered value</span>
              <span className="pod-kpi-value pod-kpi-value--accent">{fmt(purchase.totalAmount, currency)}</span>
            </div>
            <div className="pod-kpi">
              <span className="pod-kpi-label">Received value</span>
              <span className="pod-kpi-value">{fmt(purchase.receivedValue, currency)}</span>
            </div>
            <div className="pod-kpi">
              <span className="pod-kpi-label">Ordered qty</span>
              <span className="pod-kpi-value">{fmtQty(poQtys.ordered)}</span>
            </div>
            <div className="pod-kpi">
              <span className="pod-kpi-label">Received qty</span>
              <span className="pod-kpi-value">{fmtQty(poQtys.received)}</span>
            </div>
            <div className="pod-kpi">
              <span className="pod-kpi-label">Remaining</span>
              <span className={`pod-kpi-value${poQtys.remaining > 0 ? " pod-kpi-value--warn" : " pod-kpi-value--ok"}`}>
                {fmtQty(poQtys.remaining)}
              </span>
            </div>
          </div>

          {/* Receive progress bar */}
          {purchase.orderedQuantity > 0 && (
            <div className="pod-progress-wrap">
              <div className="pod-progress-track">
                <div className="pod-progress-fill" style={{ width: `${receivedPct}%` }} />
              </div>
              <span className="pod-progress-pct">{receivedPct}% received</span>
            </div>
          )}

          {/* Lifecycle dates */}
          {lifecycleDates.length > 0 && (
            <div className="pod-dates">
              {lifecycleDates.map((d) => (
                <div key={d.label} className="pod-date-cell">
                  <span className="pod-date-label">{d.label}</span>
                  <span className="pod-date-value">{fmtDate(d.value)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Cancel reason */}
          {purchase.cancelReason && (
            <div className="pod-cancel-alert">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span><strong>Cancelled:</strong> {purchase.cancelReason}</span>
            </div>
          )}

          {/* Line items */}
          <div className="pod-items-heading">
            <span>Line items</span>
            <span className="pod-items-count">{purchase.purchaseItems.length}</span>
          </div>
          <div className="table-wrap">
            <table className="table pod-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="text-right">Ordered</th>
                  <th className="text-right">Received</th>
                  <th className="text-right">Remaining</th>
                  <th className="text-right">Unit cost</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {purchase.purchaseItems.map((line) => {
                  const hasUop = hasPurchaseUnit(line.item.purchaseUnit, line.item.purchaseConversionFactor);
                  const factor = line.item.purchaseConversionFactor ?? 1;
                  const displayUnit = hasUop ? (line.item.purchaseUnit ?? line.item.unit) : line.item.unit;
                  const dQty = (n: number) => hasUop ? fmtQty(n / factor) : fmtQty(n);
                  const dCost = hasUop ? line.unitCost * factor : line.unitCost;
                  return (
                  <tr key={line.id}>
                    <td>
                      <span className="td-name">{line.item.name}</span>
                      <span className="td-unit"> / {displayUnit}</span>
                    </td>
                    <td className="text-right td-num">{dQty(line.orderedQuantity)}</td>
                    <td className="text-right td-num">{dQty(line.receivedQuantity)}</td>
                    <td className={`text-right td-num${line.remainingQuantity > 0 ? " pod-remaining--active" : ""}`}>{dQty(line.remainingQuantity)}</td>
                    <td className="text-right td-num">{fmt(dCost, currency)}</td>
                    <td className="text-right td-num">{fmt(line.orderedValue, currency)}</td>
                  </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="pod-tfoot-row">
                  <td colSpan={5} className="pod-tfoot-label">Total ordered value</td>
                  <td className="text-right pod-tfoot-total">{fmt(purchase.totalAmount, currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="pod-footer">
          <div className="pod-footer-start">
            <button type="button" className="btn btn--ghost" onClick={onClose}>Close</button>
            <button
              type="button"
              className="btn btn--ghost btn--sm pod-footer-dl"
              onClick={() => downloadPurchaseOrder(purchase, currency, workspaceName, ownerPhone)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Download PO
            </button>
          </div>
          <div className="pod-footer-actions">
            {canCancel && (
              <button type="button" className="btn btn--danger" onClick={() => onCancel(purchase)}>
                Cancel PO
              </button>
            )}
            {canOrder && (
              <button type="button" className="btn btn--secondary" onClick={() => onOrder(purchase)}>
                Mark as Ordered
              </button>
            )}
            {canReceive && (
              <button type="button" className="btn btn--primary" onClick={() => onReceive(purchase)}>
                Receive Items
              </button>
            )}
          </div>
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
    const selectedItem = items.find((i) => i.id === itemId);
    const factor = selectedItem?.purchaseConversionFactor ?? null;
    const hasUnit = hasPurchaseUnit(selectedItem?.purchaseUnit, factor);
    setLines((prev) => prev.map((l) =>
      l.key === key
        ? {
            ...l,
            itemId,
            lastCost: undefined,
            metaLoading: !!itemId,
            purchaseUnit: selectedItem?.purchaseUnit ?? null,
            purchaseConversionFactor: factor,
            baseUnit: selectedItem?.unit,
          }
        : l,
    ));
    if (!itemId) return;
    try {
      const [suggRes, priceRes] = await Promise.all([
        getSupplierSuggestion(itemId),
        getPriceHistory(itemId, 1),
      ]);
      const baseCost = priceRes.history[0]?.unitCost ?? null;
      // Convert per-base-unit cost → per-purchase-unit cost for display
      const displayCost = hasUnit && factor && baseCost != null ? baseCost * factor : baseCost;
      setLines((prev) => prev.map((l) => {
        if (l.key !== key) return l;
        return {
          ...l,
          metaLoading: false,
          lastCost: displayCost,
          unitCost: l.unitCost || (displayCost != null ? String(displayCost) : ""),
        };
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
      items: validLines.map((line) => {
        const factor = line.purchaseConversionFactor;
        const hasUnit = hasPurchaseUnit(line.purchaseUnit, factor);
        const purchaseQty = numberValue(line.quantity) ?? 0;
        const purchaseCost = numberValue(line.unitCost) ?? 0;
        return {
          itemId: line.itemId,
          // Convert purchase units → base units before sending
          quantity: hasUnit && factor ? purchaseQty * factor : purchaseQty,
          // Convert per-purchase-unit cost → per-base-unit cost before sending
          unitCost: hasUnit && factor && purchaseCost > 0 ? purchaseCost / factor : purchaseCost,
        };
      }),
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
                <span className="form-label">Supplier *</span>
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
                <span className="form-label">Purchase date *</span>
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
                    <div className="pur-line-qty-cell">
                      <input
                        aria-label={line.purchaseUnit ? `Quantity (${line.purchaseUnit})` : "Quantity"}
                        className="form-input"
                        type="number"
                        min="0.01"
                        step={line.purchaseUnit ? "1" : "0.01"}
                        value={line.quantity}
                        onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                        placeholder="0"
                      />
                      {line.purchaseUnit && line.purchaseConversionFactor && (
                        <span className="pur-cost-hint">
                          {(numberValue(line.quantity) ?? 0) > 0
                            ? `≈ ${fmtQty((numberValue(line.quantity)! * line.purchaseConversionFactor))} ${line.baseUnit}`
                            : `1 ${line.purchaseUnit} = ${line.purchaseConversionFactor} ${line.baseUnit}`}
                        </span>
                      )}
                    </div>
                    <div className="pur-line-cost-cell">
                      <input
                        aria-label={line.purchaseUnit ? `Cost per ${line.purchaseUnit}` : "Unit cost"}
                        className="form-input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.unitCost}
                        onChange={(event) => updateLine(line.key, { unitCost: event.target.value })}
                        placeholder="0.00"
                      />
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
