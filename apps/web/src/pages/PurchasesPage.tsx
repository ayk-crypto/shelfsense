import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PlanFeatureGate } from "../components/PlanFeatureGate";
import { usePlanFeatures } from "../context/PlanFeaturesContext";
import {
  cancelPurchase,
  closePurchaseWithVariance,
  createPurchase,
  deletePurchase,
  getPurchase,
  getPurchases,
  orderPurchase,
  refreshPurchaseEstimates,
  type ClosePurchaseVarianceLine,
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
import "./PurchaseOrdersInbox.css";

type InboxLane = "OPEN" | "DRAFT" | "WAITING" | "PARTIAL" | "CLOSED";

const LANE_LABEL: Record<InboxLane, string> = {
  OPEN: "Open",
  DRAFT: "Drafts",
  WAITING: "Waiting delivery",
  PARTIAL: "Part received",
  CLOSED: "Closed",
};

const STATUS_LABEL: Record<PurchaseStatus, string> = {
  DRAFT: "Draft",
  ORDERED: "Waiting Delivery",
  PARTIALLY_RECEIVED: "Part Received",
  RECEIVED: "Received",
  RECEIVED_WITH_VARIANCE: "Received with Variance",
  CLOSED_SHORT: "Closed Short",
  BACKORDERED: "Backordered",
  CANCELLED: "Cancelled",
};

const CLOSED_STATUSES = new Set<PurchaseStatus>([
  "RECEIVED",
  "RECEIVED_WITH_VARIANCE",
  "CLOSED_SHORT",
  "CANCELLED",
]);

interface Toast {
  id: number;
  msg: string;
  type: "success" | "error";
}

interface PurchaseLineDraft {
  key: number;
  itemId: string;
  quantity: string;
  unitCost: string;
  lastCost?: number | null;
  lastCostDate?: string | null;
  lastCostSupplier?: string | null;
  estimateMatchesSupplier?: boolean;
  costEdited?: boolean;
  metaLoading?: boolean;
  purchaseUnit?: string | null;
  purchaseConversionFactor?: number | null;
  baseUnit?: string;
}

let toastSeq = 0;
let lineSeq = 0;

function newLine(): PurchaseLineDraft {
  return { key: ++lineSeq, itemId: "", quantity: "", unitCost: "" };
}

function money(value: number, currency: string) {
  return formatCurrency(value, currency);
}

function fmtDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function numberValue(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function poRef(purchase: Purchase) {
  return `PO-${purchase.id.slice(-8).toUpperCase()}`;
}

function laneMatches(purchase: Purchase, lane: InboxLane) {
  if (lane === "DRAFT") return purchase.status === "DRAFT";
  if (lane === "WAITING") return purchase.status === "ORDERED" || purchase.status === "BACKORDERED";
  if (lane === "PARTIAL") return purchase.status === "PARTIALLY_RECEIVED";
  if (lane === "CLOSED") return CLOSED_STATUSES.has(purchase.status);
  return !CLOSED_STATUSES.has(purchase.status);
}

function getPurchaseLineDisplay(line: Purchase["purchaseItems"][number]) {
  const snapshot = line.unitSnapshot;
  const factor = snapshot?.conversionFactor && snapshot.conversionFactor > 0 ? snapshot.conversionFactor : null;
  const purchaseUnit = snapshot?.purchaseUnit ?? null;
  const baseUnit = snapshot?.baseUnit ?? line.baseUnitSnapshot ?? line.item.unit;
  const usesPurchaseUnit = Boolean(purchaseUnit && factor);
  const displayUnit = usesPurchaseUnit ? purchaseUnit! : baseUnit;
  const displayQty = (qty: number) => usesPurchaseUnit ? qty / factor! : qty;
  const displayCost = usesPurchaseUnit ? line.unitCost * factor! : line.unitCost;
  return { displayUnit, displayQty, displayCost };
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
  const [lane, setLane] = useState<InboxLane>("OPEN");
  const [filters, setFilters] = useState<PurchaseFilters>({});
  const [addOpen, setAddOpen] = useState(false);
  const [detailPurchase, setDetailPurchase] = useState<Purchase | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Purchase | null>(null);
  const [closeTarget, setCloseTarget] = useState<Purchase | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Purchase | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  function showToast(msg: string, type: "success" | "error") {
    const id = ++toastSeq;
    setToasts((current) => [...current, { id, msg, type }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3500);
  }

  async function load(nextFilters = filters) {
    setLoading(true);
    try {
      const query: PurchaseFilters = {
        supplierId: nextFilters.supplierId,
        locationId: nextFilters.locationId,
        fromDate: nextFilters.fromDate,
        toDate: nextFilters.toDate,
      };
      const [purchaseRes, supplierRes, itemRes, locationRes] = await Promise.all([
        getPurchases(query),
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
      setFetchError(err instanceof Error ? err.message : "Failed to load purchase orders");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocationId, filters.supplierId, filters.locationId, filters.fromDate, filters.toDate]);

  useEffect(() => {
    const purchaseId = searchParams.get("purchaseId");
    if (!purchaseId || purchases.length === 0 || handledReorderRedirect.current) return;
    handledReorderRedirect.current = true;
    const fromReorder = Number(searchParams.get("fromReorder") ?? "0");
    const purchase = purchases.find((entry) => entry.id === purchaseId);
    if (purchase) setDetailPurchase(purchase);
    if (fromReorder > 0) {
      showToast(fromReorder === 1 ? "Draft PO created from To Order" : `${fromReorder} draft POs created from To Order`, "success");
    }
    setSearchParams({}, { replace: true });
  }, [purchases, searchParams, setSearchParams]);

  const laneCounts = useMemo(() => ({
    OPEN: purchases.filter((p) => laneMatches(p, "OPEN")).length,
    DRAFT: purchases.filter((p) => laneMatches(p, "DRAFT")).length,
    WAITING: purchases.filter((p) => laneMatches(p, "WAITING")).length,
    PARTIAL: purchases.filter((p) => laneMatches(p, "PARTIAL")).length,
    CLOSED: purchases.filter((p) => laneMatches(p, "CLOSED")).length,
  }), [purchases]);

  const visiblePurchases = useMemo(
    () => purchases
      .filter((purchase) => laneMatches(purchase, lane))
      .sort((a, b) => {
        const aDate = new Date(a.expectedDeliveryDate ?? a.date).getTime();
        const bDate = new Date(b.expectedDeliveryDate ?? b.date).getTime();
        if (lane === "CLOSED") return bDate - aDate;
        return aDate - bDate;
      }),
    [lane, purchases],
  );

  const openPurchases = purchases.filter((purchase) => laneMatches(purchase, "OPEN"));
  const openValue = openPurchases.reduce((sum, purchase) => sum + purchase.totalAmount, 0);
  const waitingToReceive = openPurchases.reduce((sum, purchase) => sum + purchase.remainingQuantity, 0);
  const overdueCount = openPurchases.filter((purchase) => {
    if (!purchase.expectedDeliveryDate || purchase.status === "DRAFT") return false;
    return new Date(purchase.expectedDeliveryDate).getTime() < new Date(todayISO()).getTime();
  }).length;

  async function refreshDetail(id: string) {
    try {
      const current = purchases.find((purchase) => purchase.id === id) ?? detailPurchase;
      const res = current?.status === "DRAFT" ? await refreshPurchaseEstimates(id) : await getPurchase(id);
      setDetailPurchase(res.purchase);
      if (current?.status === "DRAFT") {
        const priced = res.purchase.purchaseItems.filter((line) => line.unitCost > 0).length;
        showToast(
          priced > 0 ? `Updated estimates for ${priced} item${priced === 1 ? "" : "s"}` : "No previous prices found for this draft",
          priced > 0 ? "success" : "error",
        );
      }
      await load(filters);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to refresh PO estimates", "error");
    }
  }

  async function handleOrder(purchase: Purchase) {
    try {
      const res = await orderPurchase(purchase.id);
      setDetailPurchase(res.purchase);
      showToast("PO marked as ordered", "success");
      await load(filters);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to order PO", "error");
    }
  }

  if (planFeatures.isLoading || loading) {
    return <div className="page-loading"><div className="spinner" /><p>Loading purchase orders...</p></div>;
  }

  if (!planFeatures.enablePurchases) {
    return <PlanFeatureGate feature="enablePurchases">{null}</PlanFeatureGate>;
  }

  if (fetchError) {
    return <div className="page-error"><div className="alert alert--error">{fetchError}</div></div>;
  }

  return (
    <div className="po-inbox-page">
      <div className="po-inbox-head">
        <div>
          <span className="po-inbox-kicker">Purchasing</span>
          <h1>Purchase Orders</h1>
          <p>See what needs ordering, what is on the way, and what still needs receiving.</p>
        </div>
        <div className="po-inbox-head-actions">
          <button type="button" className="btn btn--secondary" onClick={() => navigate("/reorder-suggestions")}>To Order</button>
          <button type="button" className="btn btn--primary" onClick={() => setAddOpen(true)}>New Purchase Order</button>
        </div>
      </div>

      <div className="po-inbox-summary" aria-label="Purchase order summary">
        <div><span>Open POs</span><strong>{laneCounts.OPEN}</strong></div>
        <div><span>Open value</span><strong>{money(openValue, currency)}</strong></div>
        <div><span>Qty still due</span><strong>{fmtQty(waitingToReceive)}</strong></div>
        <div className={overdueCount > 0 ? "po-summary-alert" : ""}><span>Overdue</span><strong>{overdueCount}</strong></div>
      </div>

      <div className="po-lanes" role="tablist" aria-label="Purchase order lifecycle">
        {(Object.keys(LANE_LABEL) as InboxLane[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={lane === key}
            className={`po-lane${lane === key ? " po-lane--active" : ""}`}
            onClick={() => setLane(key)}
          >
            <span>{LANE_LABEL[key]}</span>
            <em>{laneCounts[key]}</em>
          </button>
        ))}
      </div>

      <div className="po-inbox-filters">
        <select
          className="form-input form-select"
          value={filters.supplierId ?? ""}
          onChange={(event) => setFilters((current) => ({ ...current, supplierId: event.target.value || undefined }))}
        >
          <option value="">All suppliers</option>
          {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
        </select>
        <select
          className="form-input form-select"
          value={filters.locationId ?? ""}
          onChange={(event) => setFilters((current) => ({ ...current, locationId: event.target.value || undefined }))}
        >
          <option value="">Active branch</option>
          {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
        <input type="date" className="form-input" value={filters.fromDate ?? ""} onChange={(event) => setFilters((current) => ({ ...current, fromDate: event.target.value || undefined }))} aria-label="From date" />
        <input type="date" className="form-input" value={filters.toDate ?? ""} onChange={(event) => setFilters((current) => ({ ...current, toDate: event.target.value || undefined }))} aria-label="To date" />
        {(filters.supplierId || filters.locationId || filters.fromDate || filters.toDate) && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setFilters({})}>Clear</button>
        )}
      </div>

      {visiblePurchases.length === 0 ? (
        <div className="po-inbox-empty">
          <div className="po-inbox-empty-icon">✓</div>
          <h2>No {LANE_LABEL[lane].toLowerCase()} purchase orders</h2>
          <p>{lane === "OPEN" ? "Nothing needs purchasing attention in this view." : "Switch to another stage or create a new purchase order."}</p>
          {lane === "OPEN" && <button type="button" className="btn btn--secondary" onClick={() => navigate("/reorder-suggestions")}>Check To Order</button>}
        </div>
      ) : (
        <div className="po-inbox-list">
          {visiblePurchases.map((purchase) => (
            <PurchaseInboxCard
              key={purchase.id}
              purchase={purchase}
              currency={currency}
              onOpen={() => setDetailPurchase(purchase)}
              onReceive={() => navigate(`/stock-in?mode=po&poId=${purchase.id}`)}
              onOrder={() => void handleOrder(purchase)}
            />
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
            setLane("DRAFT");
            setDetailPurchase(purchase);
            showToast("Draft purchase order created", "success");
            await load(filters);
          }}
        />
      )}

      {detailPurchase && (
        <PurchaseDetailModal
          purchase={detailPurchase}
          currency={currency}
          workspaceName={settings.name}
          ownerPhone={settings.ownerPhone}
          onClose={() => setDetailPurchase(null)}
          onRefresh={() => void refreshDetail(detailPurchase.id)}
          onOrder={() => void handleOrder(detailPurchase)}
          onReceive={() => {
            setDetailPurchase(null);
            navigate(`/stock-in?mode=po&poId=${detailPurchase.id}`);
          }}
          onCancel={() => setCancelTarget(detailPurchase)}
          onClosePO={() => setCloseTarget(detailPurchase)}
          onDelete={() => setDeleteTarget(detailPurchase)}
        />
      )}

      {cancelTarget && (
        <CancelPurchaseModal
          purchase={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onSuccess={async (updated) => {
            setCancelTarget(null);
            setDetailPurchase(updated);
            showToast("Purchase order cancelled", "success");
            await load(filters);
          }}
        />
      )}

      {closeTarget && (
        <ClosePOModal
          purchase={closeTarget}
          onClose={() => setCloseTarget(null)}
          onSuccess={async (updated, newDraftId) => {
            setCloseTarget(null);
            setDetailPurchase(updated);
            showToast(newDraftId ? "PO closed and a new draft was created for pending items" : "PO closure saved", "success");
            await load(filters);
          }}
        />
      )}

      {deleteTarget && (
        <DeleteDraftModal
          purchase={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onSuccess={async () => {
            setDeleteTarget(null);
            setDetailPurchase(null);
            showToast("Draft purchase order deleted", "success");
            await load(filters);
          }}
        />
      )}

      <div className="toast-stack">
        {toasts.map((toast) => <div key={toast.id} className={`toast toast--${toast.type}`}>{toast.msg}</div>)}
      </div>
    </div>
  );
}

function PurchaseInboxCard({
  purchase,
  currency,
  onOpen,
  onReceive,
  onOrder,
}: {
  purchase: Purchase;
  currency: string;
  onOpen: () => void;
  onReceive: () => void;
  onOrder: () => void;
}) {
  const canReceive = purchase.status === "ORDERED" || purchase.status === "PARTIALLY_RECEIVED" || purchase.status === "BACKORDERED";
  const isDraft = purchase.status === "DRAFT";
  const receivedPct = purchase.orderedQuantity > 0 ? Math.min(100, Math.round((purchase.receivedQuantity / purchase.orderedQuantity) * 100)) : 0;
  const overdue = Boolean(
    purchase.expectedDeliveryDate
    && !isDraft
    && !CLOSED_STATUSES.has(purchase.status)
    && new Date(purchase.expectedDeliveryDate).getTime() < new Date(todayISO()).getTime(),
  );

  return (
    <article className={`po-card${overdue ? " po-card--overdue" : ""}`} onClick={onOpen}>
      <div className="po-card-main">
        <div className="po-card-topline">
          <span className="po-card-ref">{poRef(purchase)}</span>
          <StatusBadge status={purchase.status} />
          {overdue && <span className="po-overdue-badge">Overdue</span>}
        </div>
        <h3>{purchase.supplier.name}</h3>
        <p className="po-card-items">
          {purchase.purchaseItems.slice(0, 3).map((line) => line.item.name).join(" · ")}
          {purchase.purchaseItems.length > 3 ? ` · +${purchase.purchaseItems.length - 3} more` : ""}
        </p>
        <div className="po-card-meta">
          <span>{purchase.location.name}</span>
          <span>{purchase.purchaseItems.length} item{purchase.purchaseItems.length !== 1 ? "s" : ""}</span>
          <span>{purchase.expectedDeliveryDate ? `Expected ${fmtDate(purchase.expectedDeliveryDate)}` : `Created ${fmtDate(purchase.date)}`}</span>
        </div>
        {!isDraft && !CLOSED_STATUSES.has(purchase.status) && (
          <div className="po-card-progress">
            <div className="po-card-progress-track"><span style={{ width: `${receivedPct}%` }} /></div>
            <span>{receivedPct}% received · {fmtQty(purchase.remainingQuantity)} still due</span>
          </div>
        )}
      </div>
      <div className="po-card-side">
        <strong>{money(purchase.totalAmount, currency)}</strong>
        {purchase.receivedValue > 0 && <span>{money(purchase.receivedValue, currency)} received</span>}
        <div className="po-card-actions" onClick={(event) => event.stopPropagation()}>
          {isDraft && <button type="button" className="btn btn--secondary btn--sm" onClick={onOrder}>Mark Ordered</button>}
          {canReceive && <button type="button" className="btn btn--primary btn--sm" onClick={onReceive}>Receive</button>}
          <button type="button" className="btn btn--ghost btn--sm" onClick={onOpen}>View</button>
        </div>
      </div>
    </article>
  );
}

function StatusBadge({ status }: { status: PurchaseStatus }) {
  return <span className={`purchase-status purchase-status--${status.toLowerCase().replace(/_/g, "-")}`}>{STATUS_LABEL[status]}</span>;
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
    const costStr = dCostPerPU > 0 ? money(dCostPerPU, currency) : "—";
    const totalStr = dCostPerPU > 0 ? money(line.orderedValue, currency) : "—";
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
  const estValueStr = allCostsMissing ? "Pricing not set" : money(purchase.totalAmount, currency);
  const recValueStr = allCostsMissing ? "—" : money(purchase.receivedValue, currency);

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
  const tfootOrdered   = `<tr class="tf-row"><td colspan="${cols - 1}">Total ordered value</td><td class="num">${allCostsMissing ? "—" : escHtml(money(purchase.totalAmount, currency))}</td></tr>`;
  const tfootReceived  = showReceiving
    ? `<tr class="tf-row"><td colspan="${cols - 1}">Total received value</td><td class="num">${allCostsMissing ? "—" : escHtml(money(purchase.receivedValue, currency))}</td></tr>`
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

function PurchaseDetailModal({
  purchase,
  currency,
  workspaceName,
  ownerPhone,
  onClose,
  onRefresh,
  onOrder,
  onReceive,
  onCancel,
  onClosePO,
  onDelete,
}: {
  purchase: Purchase;
  currency: string;
  workspaceName: string;
  ownerPhone?: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onOrder: () => void;
  onReceive: () => void;
  onCancel: () => void;
  onClosePO: () => void;
  onDelete: () => void;
}) {
  const canOrder = purchase.status === "DRAFT";
  const canReceive = purchase.status === "ORDERED" || purchase.status === "PARTIALLY_RECEIVED" || purchase.status === "BACKORDERED";
  const canCancel = purchase.status === "DRAFT" || purchase.status === "ORDERED" || purchase.status === "PARTIALLY_RECEIVED" || purchase.status === "BACKORDERED";
  const canClose = purchase.status === "ORDERED" || purchase.status === "PARTIALLY_RECEIVED" || purchase.status === "BACKORDERED";

  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide po-detail" onClick={(event) => event.stopPropagation()}>
        <div className="po-detail-head">
          <div>
            <span className="po-detail-ref">{poRef(purchase)}</span>
            <h2>{purchase.supplier.name}</h2>
            <p>{purchase.location.name} · {fmtDate(purchase.date)}</p>
          </div>
          <div className="po-detail-head-actions">
            <StatusBadge status={purchase.status} />
            <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>

        <div className="po-detail-summary">
          <div><span>Ordered value</span><strong>{money(purchase.totalAmount, currency)}</strong></div>
          <div><span>Received value</span><strong>{money(purchase.receivedValue, currency)}</strong></div>
          <div><span>Remaining qty</span><strong>{fmtQty(purchase.remainingQuantity)}</strong></div>
          <div><span>Expected</span><strong>{fmtDate(purchase.expectedDeliveryDate)}</strong></div>
        </div>

        <div className="po-detail-body">
          <div className="po-detail-section-head"><span>Items</span><em>{purchase.purchaseItems.length}</em></div>
          <div className="po-detail-lines">
            {purchase.purchaseItems.map((line) => {
              const display = getPurchaseLineDisplay(line);
              return (
                <div key={line.id} className="po-detail-line">
                  <div>
                    <strong>{line.item.name}</strong>
                    <span>{display.displayUnit}</span>
                  </div>
                  <div><span>Ordered</span><strong>{fmtQty(display.displayQty(line.orderedQuantity))}</strong></div>
                  <div><span>Received</span><strong>{fmtQty(display.displayQty(line.receivedQuantity))}</strong></div>
                  <div><span>Remaining</span><strong>{fmtQty(display.displayQty(line.remainingQuantity))}</strong></div>
                  <div><span>Unit cost</span><strong>{money(display.displayCost, currency)}</strong></div>
                </div>
              );
            })}
          </div>
          {purchase.cancelReason && <div className="po-detail-note"><strong>Cancellation reason:</strong> {purchase.cancelReason}</div>}
          {purchase.closureReason && <div className="po-detail-note"><strong>Closure:</strong> {purchase.closureReason}</div>}
        </div>

        <div className="po-detail-footer">
          <div>
            <button type="button" className="btn btn--ghost" onClick={onRefresh}>{purchase.status === "DRAFT" ? "Update estimates" : "Refresh"}</button>
            <button type="button" className="btn btn--secondary" onClick={() => downloadPurchaseOrder(purchase, currency, workspaceName, ownerPhone)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>
              Download PDF
            </button>
          </div>
          <div>
            {purchase.status === "DRAFT" && <button type="button" className="btn btn--danger" onClick={onDelete}>Delete Draft</button>}
            {canCancel && <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel PO</button>}
            {canClose && <button type="button" className="btn btn--secondary" onClick={onClosePO}>Close PO</button>}
            {canOrder && <button type="button" className="btn btn--secondary" onClick={onOrder}>Mark Ordered</button>}
            {canReceive && <button type="button" className="btn btn--primary" onClick={onReceive}>Receive Items</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function CancelPurchaseModal({
  purchase,
  onClose,
  onSuccess,
}: {
  purchase: Purchase;
  onClose: () => void;
  onSuccess: (purchase: Purchase) => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const res = await cancelPurchase(purchase.id, reason.trim() || undefined);
      onSuccess(res.purchase);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel purchase order");
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header"><h2 className="modal-title">Cancel {poRef(purchase)}?</h2><button type="button" className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body">
          <p className="po-modal-copy">This stops the PO from being received. Add a short reason if useful for the audit trail.</p>
          <label className="form-group"><span className="form-label">Reason</span><input className="form-input" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Supplier unavailable" autoFocus /></label>
          {error && <div className="alert alert--error">{error}</div>}
        </div>
        <div className="modal-footer"><button type="button" className="btn btn--ghost" onClick={onClose}>Back</button><button type="button" className="btn btn--danger" disabled={saving} onClick={() => void submit()}>{saving ? "Cancelling..." : "Cancel PO"}</button></div>
      </div>
    </div>
  );
}

const CLOSURE_REASONS = [
  "Supplier did not provide item",
  "Supplier out of stock",
  "Item no longer required",
  "Price changed",
  "Quality issue",
  "Ordered from another supplier",
  "Delivery delayed beyond acceptable time",
  "Other",
];

function ClosePOModal({
  purchase,
  onClose,
  onSuccess,
}: {
  purchase: Purchase;
  onClose: () => void;
  onSuccess: (purchase: Purchase, newDraftId: string | null) => void;
}) {
  const pending = purchase.purchaseItems.filter((line) => line.remainingQuantity > 0 && !line.closureAction);
  const [actions, setActions] = useState<Record<string, "KEEP_PENDING" | "CLOSE_SHORT" | "CANCEL">>(
    Object.fromEntries(pending.map((line) => [line.id, "KEEP_PENDING"])),
  );
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [newDraft, setNewDraft] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actioned = Object.values(actions).some((action) => action !== "KEEP_PENDING");
  const kept = pending.some((line) => actions[line.id] === "KEEP_PENDING");
  const canSave = (actioned || (newDraft && kept)) && (!actioned || Boolean(reason));

  async function submit() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const lines: ClosePurchaseVarianceLine[] = pending.map((line) => ({
        purchaseItemId: line.id,
        action: actions[line.id] ?? "KEEP_PENDING",
        reason: reason || undefined,
      }));
      const res = await closePurchaseWithVariance(purchase.id, {
        lines,
        globalReason: reason || undefined,
        closureNotes: notes.trim() || undefined,
        createNewDraft: newDraft,
      });
      onSuccess(res.purchase, res.newDraftId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to close purchase order");
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide" style={{ maxWidth: 760 }} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header"><div><h2 className="modal-title">Close {poRef(purchase)}</h2><p className="modal-subtitle">Decide what to do with quantities the supplier has not delivered.</p></div><button type="button" className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body">
          {pending.length === 0 ? (
            <div className="po-modal-copy">No pending quantities remain on this PO.</div>
          ) : (
            <>
              <div className="po-close-lines">
                {pending.map((line) => (
                  <div className="po-close-line" key={line.id}>
                    <div><strong>{line.item.name}</strong><span>{fmtQty(line.remainingQuantity)} {line.item.unit} pending</span></div>
                    <select className="form-input form-select" value={actions[line.id]} onChange={(event) => setActions((current) => ({ ...current, [line.id]: event.target.value as "KEEP_PENDING" | "CLOSE_SHORT" | "CANCEL" }))}>
                      <option value="KEEP_PENDING">Keep pending</option>
                      <option value="CLOSE_SHORT">Close short</option>
                      <option value="CANCEL">Cancel remaining</option>
                    </select>
                  </div>
                ))}
              </div>
              {kept && <label className="po-close-new-draft"><input type="checkbox" checked={newDraft} onChange={(event) => setNewDraft(event.target.checked)} /> Create a new draft PO for items kept pending</label>}
              {actioned && (
                <label className="form-group"><span className="form-label">Closure reason *</span><select className="form-input form-select" value={reason} onChange={(event) => setReason(event.target.value)}><option value="">Select reason</option>{CLOSURE_REASONS.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select></label>
              )}
              <label className="form-group"><span className="form-label">Notes</span><textarea className="form-input" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional context" /></label>
            </>
          )}
          {error && <div className="alert alert--error">{error}</div>}
        </div>
        <div className="modal-footer"><button type="button" className="btn btn--ghost" onClick={onClose}>Back</button>{pending.length > 0 && <button type="button" className="btn btn--primary" disabled={!canSave || saving} onClick={() => void submit()}>{saving ? "Saving..." : "Save Closure"}</button>}</div>
      </div>
    </div>
  );
}

function DeleteDraftModal({
  purchase,
  onClose,
  onSuccess,
}: {
  purchase: Purchase;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await deletePurchase(purchase.id);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete draft");
      setSaving(false);
    }
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 440 }} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header"><h2 className="modal-title">Delete draft?</h2><button type="button" className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body"><p className="po-modal-copy">{poRef(purchase)} for <strong>{purchase.supplier.name}</strong> will be permanently deleted.</p>{error && <div className="alert alert--error">{error}</div>}</div>
        <div className="modal-footer"><button type="button" className="btn btn--ghost" onClick={onClose}>Back</button><button type="button" className="btn btn--danger" disabled={saving} onClick={() => void submit()}>{saving ? "Deleting..." : "Delete Draft"}</button></div>
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

  async function loadLineEstimate(key: number, itemId: string, targetSupplierId: string) {
    const selectedItem = items.find((item) => item.id === itemId);
    if (!selectedItem) return;
    const factor = selectedItem.purchaseConversionFactor ?? null;
    const usesPurchaseUnit = hasPurchaseUnit(selectedItem.purchaseUnit, factor);
    try {
      const priceRes = await getPriceHistory(itemId, 2, targetSupplierId || undefined);
      const latest = priceRes.history[0] ?? null;
      const baseCost = latest?.unitCost ?? null;
      const displayCost = usesPurchaseUnit && factor && baseCost != null ? baseCost * factor : baseCost;
      setLines((current) => current.map((line) => line.key === key ? {
        ...line,
        metaLoading: false,
        lastCost: displayCost,
        lastCostDate: latest?.createdAt ?? null,
        lastCostSupplier: latest?.supplier?.name ?? latest?.supplierName ?? null,
        estimateMatchesSupplier: Boolean(targetSupplierId && latest?.supplier?.id === targetSupplierId),
        unitCost: line.costEdited ? line.unitCost : (displayCost != null ? String(displayCost) : ""),
      } : line));
    } catch {
      setLines((current) => current.map((line) => line.key === key ? { ...line, metaLoading: false } : line));
    }
  }

  function handleSupplierChange(nextSupplierId: string) {
    setSupplierId(nextSupplierId);
    setSupplierSuggestion(null);
    for (const line of lines) {
      if (line.itemId && !line.costEdited) void loadLineEstimate(line.key, line.itemId, nextSupplierId);
    }
  }

  async function handleItemChange(key: number, itemId: string) {
    const selectedItem = items.find((item) => item.id === itemId);
    const factor = selectedItem?.purchaseConversionFactor ?? null;
    const usesPurchaseUnit = hasPurchaseUnit(selectedItem?.purchaseUnit, factor);
    setLines((current) => current.map((line) => line.key === key ? {
      ...line,
      itemId,
      metaLoading: Boolean(itemId),
      unitCost: "",
      lastCost: null,
      lastCostDate: null,
      lastCostSupplier: null,
      estimateMatchesSupplier: false,
      costEdited: false,
      purchaseUnit: selectedItem?.purchaseUnit ?? null,
      purchaseConversionFactor: factor,
      baseUnit: selectedItem?.unit,
    } : line));
    if (!itemId) return;
    try {
      void loadLineEstimate(key, itemId, supplierId);
      const supplierRes = await getSupplierSuggestion(itemId);
      if (supplierRes.suggestion && !supplierId) setSupplierSuggestion(supplierRes.suggestion);
    } catch {
      setLines((current) => current.map((line) => line.key === key ? { ...line, metaLoading: false } : line));
    }
  }

  const grandTotal = lines.reduce((sum, line) => sum + (numberValue(line.quantity) ?? 0) * (numberValue(line.unitCost) ?? 0), 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const validLines = lines.filter((line) => line.itemId && (numberValue(line.quantity) ?? 0) > 0 && (numberValue(line.unitCost) ?? -1) >= 0);
    if (!supplierId) return onError("Supplier is required");
    if (validLines.length === 0) return onError("Add at least one item with a quantity");
    const payload: CreatePurchaseInput = {
      supplierId,
      date,
      expectedDeliveryDate: expectedDeliveryDate || undefined,
      items: validLines.map((line) => ({
        itemId: line.itemId,
        quantity: numberValue(line.quantity) ?? 0,
        quantityUnit: hasPurchaseUnit(line.purchaseUnit, line.purchaseConversionFactor) ? "PURCHASE_UNIT" : "BASE_UNIT",
        unitCost: numberValue(line.unitCost) ?? 0,
      })),
    };
    setSaving(true);
    try {
      const res = await createPurchase(payload);
      await onSuccess(res.purchase);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to create purchase order");
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal--wide po-new-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header"><div><h2 className="modal-title">New Purchase Order</h2><p className="modal-subtitle">Create the draft now. Batches and expiry are captured when goods arrive.</p></div><button type="button" className="modal-close" onClick={onClose}>×</button></div>
        <form onSubmit={(event) => void submit(event)}>
          <div className="modal-body">
            <div className="po-new-info">
              <label className="form-group"><span className="form-label">Supplier *</span><select className="form-input form-select" value={supplierId} onChange={(event) => handleSupplierChange(event.target.value)}><option value="">Select supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
              {supplierSuggestion && !supplierId && <button type="button" className="po-supplier-suggestion" onClick={() => handleSupplierChange(supplierSuggestion.id)}>Use suggested supplier: {supplierSuggestion.name}</button>}
              <label className="form-group"><span className="form-label">PO date</span><input className="form-input" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
              <label className="form-group"><span className="form-label">Expected delivery</span><input className="form-input" type="date" value={expectedDeliveryDate} onChange={(event) => setExpectedDeliveryDate(event.target.value)} /></label>
            </div>

            <div className="po-new-lines-head"><div><strong>Items</strong><span>Enter quantities in purchase units where configured.</span></div><button type="button" className="btn btn--secondary btn--sm" onClick={() => setLines((current) => [...current, newLine()])}>Add Item</button></div>
            <div className="po-new-lines">
              {lines.map((line) => {
                const qty = numberValue(line.quantity) ?? 0;
                const cost = numberValue(line.unitCost) ?? 0;
                return (
                  <div className="po-new-line" key={line.key}>
                    <select className="form-input form-select" value={line.itemId} onChange={(event) => void handleItemChange(line.key, event.target.value)}><option value="">Select item</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                    <div><input className="form-input" type="number" min="0" step={line.purchaseUnit ? "1" : "0.01"} placeholder="Qty" value={line.quantity} onChange={(event) => setLines((current) => current.map((entry) => entry.key === line.key ? { ...entry, quantity: event.target.value } : entry))} />{line.purchaseUnit && <span>{line.purchaseUnit}{line.purchaseConversionFactor ? ` · 1 = ${fmtQty(line.purchaseConversionFactor)} ${line.baseUnit}` : ""}</span>}</div>
                    <div className="po-estimate-field"><input className="form-input" type="number" min="0" step="0.01" placeholder={line.metaLoading ? "Checking last price…" : "Estimated unit price"} value={line.unitCost} onChange={(event) => setLines((current) => current.map((entry) => entry.key === line.key ? { ...entry, unitCost: event.target.value, costEdited: true } : entry))} />{line.lastCost != null ? <span className="po-estimate-source">{line.estimateMatchesSupplier ? "Last from this supplier" : "Latest available"}: {money(line.lastCost, currency)} per {line.purchaseUnit ?? line.baseUnit}{line.lastCostDate ? ` · ${fmtDate(line.lastCostDate)}` : ""}</span> : line.itemId && !line.metaLoading ? <span className="po-estimate-source po-estimate-source--empty">No previous price · enter an estimate</span> : null}</div>
                    <strong>{money(qty * cost, currency)}</strong>
                    <button type="button" className="po-line-remove" disabled={lines.length === 1} onClick={() => setLines((current) => current.length > 1 ? current.filter((entry) => entry.key !== line.key) : current)}>×</button>
                  </div>
                );
              })}
            </div>
            <div className="po-new-total"><span>Estimated PO total<small>Final amount is confirmed when stock is received.</small></span><strong>{money(grandTotal, currency)}</strong></div>
          </div>
          <div className="modal-footer"><button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button><button type="submit" className="btn btn--primary" disabled={saving}>{saving ? "Creating..." : "Create Draft"}</button></div>
        </form>
      </div>
    </div>
  );
}
