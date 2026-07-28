import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getItems } from "../api/items";
import { getSupplierMappings } from "../api/item-suppliers";
import { createReorderPurchases } from "../api/reorderSuggestions";
import { getStockMovements, getStockSummary } from "../api/stock";
import { getSuppliers } from "../api/suppliers";
import { useLocation } from "../context/LocationContext";
import type { Item, StockMovement, StockSummaryItem, Supplier } from "../types";
import "./SupplierPurchasePlanPage.css";

const HISTORY_DAYS = 60;
const PLAN_DAYS = 30;
const MIN_OBSERVATION_DAYS = 7;
const DAY_MS = 86_400_000;

type PlanStatus = "BUY" | "REVIEW" | "ENOUGH";
type ViewFilter = "BUY" | "REVIEW" | "ALL";

type SupplierPlanRow = {
  item: Item;
  factor: number;
  displayUnit: string;
  currentQty: number;
  incomingQty: number;
  monthlyUsageQty: number | null;
  lowStockQty: number;
  projectedQty: number | null;
  suggestedQty: number;
  status: PlanStatus;
};

export function SupplierPurchasePlanPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeLocationId } = useLocation();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [summaries, setSummaries] = useState<StockSummaryItem[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [mappingItems, setMappingItems] = useState<Awaited<ReturnType<typeof getSupplierMappings>>["items"]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ViewFilter>("BUY");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [quantities, setQuantities] = useState<Record<string, string>>({});

  const selectedSupplierId = searchParams.get("supplierId") ?? "";
  const selectedSupplier = suppliers.find((supplier) => supplier.id === selectedSupplierId) ?? null;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      const now = new Date();
      const from = new Date(now.getTime() - (HISTORY_DAYS - 1) * DAY_MS);

      try {
        const [supplierRes, itemRes, summaryRes, movementRes, mappingRes] = await Promise.all([
          getSuppliers(),
          getItems(false),
          getStockSummary(),
          getStockMovements({
            type: "STOCK_OUT",
            fromDate: toApiDate(from),
            toDate: toApiDate(now),
          }),
          getSupplierMappings(),
        ]);
        if (cancelled) return;

        const sortedSuppliers = [...supplierRes.suppliers].sort((a, b) => a.name.localeCompare(b.name));
        setSuppliers(sortedSuppliers);
        setItems(itemRes.items.filter((item) => item.isActive));
        setSummaries(summaryRes.summary);
        setMovements(movementRes.movements);
        setMappingItems(mappingRes.items);

        const requestedSupplierId = searchParams.get("supplierId");
        if (!requestedSupplierId && sortedSuppliers[0]) {
          setSearchParams({ supplierId: sortedSuppliers[0].id }, { replace: true });
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unable to prepare the supplier plan.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [activeLocationId]);

  const rows = useMemo(() => {
    if (!selectedSupplierId) return [];

    const linkedIds = new Set(
      mappingItems
        .filter((mapping) =>
          mapping.primary?.supplierId === selectedSupplierId
          || mapping.alternates.some((alternate) => alternate.supplierId === selectedSupplierId),
        )
        .map((mapping) => mapping.itemId),
    );
    const summaryMap = new Map(summaries.map((summary) => [summary.itemId, summary]));
    const usageMap = buildUsageMap(movements, new Date());

    return items
      .filter((item) => linkedIds.has(item.id))
      .map((item) => buildPlanRow(item, summaryMap.get(item.id) ?? null, usageMap.get(item.id)))
      .sort((a, b) => {
        const rank = { BUY: 0, REVIEW: 1, ENOUGH: 2 } as const;
        return rank[a.status] - rank[b.status] || a.item.name.localeCompare(b.item.name);
      });
  }, [items, mappingItems, movements, selectedSupplierId, summaries]);

  useEffect(() => {
    const nextSelected = new Set<string>();
    const nextQuantities: Record<string, string> = {};
    for (const row of rows) {
      nextQuantities[row.item.id] = formatEditable(row.suggestedQty);
      if (row.status === "BUY" && row.suggestedQty > 0) nextSelected.add(row.item.id);
    }
    setSelectedIds(nextSelected);
    setQuantities(nextQuantities);
    setFilter("BUY");
  }, [selectedSupplierId, rows]);

  const buyCount = rows.filter((row) => row.status === "BUY").length;
  const reviewCount = rows.filter((row) => row.status === "REVIEW").length;
  const enoughCount = rows.filter((row) => row.status === "ENOUGH").length;
  const visibleRows = rows.filter((row) => filter === "ALL" || row.status === filter);
  const selectedRows = rows.filter((row) => selectedIds.has(row.item.id) && toNumber(quantities[row.item.id]) > 0);

  function changeSupplier(supplierId: string) {
    if (supplierId) setSearchParams({ supplierId });
    else setSearchParams({});
  }

  function toggleRow(itemId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(itemId); else next.delete(itemId);
      return next;
    });
  }

  function selectAllVisible(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const row of visibleRows) {
        if (row.status === "REVIEW" || toNumber(quantities[row.item.id]) <= 0) continue;
        if (checked) next.add(row.item.id); else next.delete(row.item.id);
      }
      return next;
    });
  }

  async function createDraft() {
    if (!selectedSupplier || selectedRows.length === 0) return;
    const confirmed = window.confirm(
      `Create one draft purchase order for ${selectedSupplier.name} with ${selectedRows.length} item${selectedRows.length === 1 ? "" : "s"}?`,
    );
    if (!confirmed) return;

    setCreating(true);
    setError(null);
    try {
      const response = await createReorderPurchases({
        locationId: activeLocationId ?? undefined,
        items: selectedRows.map((row) => ({
          itemId: row.item.id,
          supplierId: selectedSupplier.id,
          quantity: roundQty(toNumber(quantities[row.item.id]) * row.factor),
          unitCost: 0,
        })),
      });
      const purchase = response.purchases[0];
      if (purchase) {
        navigate(`/purchases?purchaseId=${encodeURIComponent(purchase.id)}&fromSupplierPlan=1`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the supplier purchase draft.");
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return <div className="page-loading"><div className="spinner" /><p>Preparing monthly supplier plan…</p></div>;
  }

  if (error && suppliers.length === 0) {
    return <div className="page-error"><div className="alert alert--error">{error}</div></div>;
  }

  return (
    <div className="supplier-plan-page">
      <div className="page-header supplier-plan-header">
        <div>
          <p className="supplier-plan-eyebrow">PURCHASING</p>
          <h1 className="page-title">Monthly Supplier Plan</h1>
          <p className="page-subtitle">Choose a supplier and buy enough to last until the next monthly visit.</p>
        </div>
        <Link className="btn btn--secondary" to="/reorder-suggestions">Urgent reorders</Link>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      <section className="supplier-plan-control-card">
        <div className="supplier-plan-control-main">
          <label htmlFor="supplier-plan-select">Supplier</label>
          <select
            id="supplier-plan-select"
            className="form-select"
            value={selectedSupplierId}
            onChange={(event) => changeSupplier(event.target.value)}
          >
            <option value="">Select supplier</option>
            {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
          </select>
        </div>
        <div className="supplier-plan-cycle">
          <strong>30-day plan</strong>
          <span>Current stock + incoming orders − next 30 days usage</span>
        </div>
      </section>

      {!selectedSupplier ? (
        <div className="supplier-plan-empty"><h2>Select a supplier</h2><p>ShelfSense will show all items linked to that supplier.</p></div>
      ) : rows.length === 0 ? (
        <div className="supplier-plan-empty">
          <h2>No items linked to {selectedSupplier.name}</h2>
          <p>Assign this supplier to items from the Inventory page, then return here.</p>
          <Link className="btn btn--primary" to="/items">Open Inventory</Link>
        </div>
      ) : (
        <>
          <div className="supplier-plan-summary">
            <div><span>Linked items</span><strong>{rows.length}</strong></div>
            <div className={buyCount > 0 ? "is-action" : ""}><span>Buy this visit</span><strong>{buyCount}</strong></div>
            <div className={reviewCount > 0 ? "is-review" : ""}><span>Review manually</span><strong>{reviewCount}</strong></div>
            <div><span>Enough stock</span><strong>{enoughCount}</strong></div>
          </div>

          <div className="supplier-plan-toolbar">
            <div className="supplier-plan-filters" role="tablist" aria-label="Purchase plan filters">
              <button className={filter === "BUY" ? "active" : ""} onClick={() => setFilter("BUY")}>To buy <span>{buyCount}</span></button>
              <button className={filter === "REVIEW" ? "active" : ""} onClick={() => setFilter("REVIEW")}>Review <span>{reviewCount}</span></button>
              <button className={filter === "ALL" ? "active" : ""} onClick={() => setFilter("ALL")}>All linked <span>{rows.length}</span></button>
            </div>
            <label className="supplier-plan-select-visible">
              <input
                type="checkbox"
                checked={visibleRows.some((row) => row.status !== "REVIEW" && toNumber(quantities[row.item.id]) > 0)
                  && visibleRows.filter((row) => row.status !== "REVIEW" && toNumber(quantities[row.item.id]) > 0).every((row) => selectedIds.has(row.item.id))}
                onChange={(event) => selectAllVisible(event.target.checked)}
              />
              Select visible
            </label>
          </div>

          {filter === "REVIEW" && (
            <div className="supplier-plan-note">These items have no usable stock-out history. Enter a quantity only when you decide it is needed.</div>
          )}

          <div className="supplier-plan-table-wrap">
            <table className="supplier-plan-table">
              <thead>
                <tr>
                  <th className="check-col" />
                  <th>Item</th>
                  <th>Current</th>
                  <th>30-day use</th>
                  <th>Low alert</th>
                  <th>After 30 days</th>
                  <th>Buy now</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const qty = toNumber(quantities[row.item.id]);
                  const canSelect = qty > 0;
                  return (
                    <tr key={row.item.id} className={selectedIds.has(row.item.id) ? "selected" : ""}>
                      <td className="check-col">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(row.item.id)}
                          disabled={!canSelect}
                          onChange={(event) => toggleRow(row.item.id, event.target.checked)}
                          aria-label={`Select ${row.item.name}`}
                        />
                      </td>
                      <td>
                        <strong>{row.item.name}</strong>
                        <span>{row.item.category || "Uncategorized"}</span>
                      </td>
                      <td>{formatQty(row.currentQty)} <small>{row.displayUnit}</small>{row.incomingQty > 0 && <em>+ {formatQty(row.incomingQty)} incoming</em>}</td>
                      <td>{row.monthlyUsageQty === null ? <span className="supplier-plan-muted">No history</span> : <>{formatQty(row.monthlyUsageQty)} <small>{row.displayUnit}</small></>}</td>
                      <td>{formatQty(row.lowStockQty)} <small>{row.displayUnit}</small></td>
                      <td className={row.projectedQty !== null && row.projectedQty <= row.lowStockQty ? "projected-low" : ""}>
                        {row.projectedQty === null ? "—" : <>{formatQty(row.projectedQty)} <small>{row.displayUnit}</small></>}
                      </td>
                      <td>
                        <div className="supplier-plan-qty-input">
                          <input
                            type="number"
                            min="0"
                            step={row.factor > 1 && !row.item.allowFractionalPurchaseUnit ? "1" : "0.01"}
                            value={quantities[row.item.id] ?? "0"}
                            onChange={(event) => {
                              setQuantities((current) => ({ ...current, [row.item.id]: event.target.value }));
                              const nextQty = toNumber(event.target.value);
                              toggleRow(row.item.id, nextQty > 0);
                            }}
                            aria-label={`Quantity to buy for ${row.item.name}`}
                          />
                          <span>{row.displayUnit}</span>
                        </div>
                        {row.status === "BUY" && <em className="supplier-plan-status buy">Recommended</em>}
                        {row.status === "REVIEW" && <em className="supplier-plan-status review">Review</em>}
                        {row.status === "ENOUGH" && <em className="supplier-plan-status enough">No purchase</em>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="supplier-plan-footer">
            <div><strong>{selectedRows.length}</strong> item{selectedRows.length === 1 ? "" : "s"} selected for {selectedSupplier.name}</div>
            <button className="btn btn--primary" disabled={creating || selectedRows.length === 0} onClick={() => { void createDraft(); }}>
              {creating ? "Creating draft…" : `Create ${selectedSupplier.name} Draft`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function buildUsageMap(movements: StockMovement[], now: Date) {
  const usage = new Map<string, { total: number; earliest: number }>();
  for (const movement of movements) {
    const itemId = movement.item.id;
    const createdAt = new Date(movement.createdAt).getTime();
    const current = usage.get(itemId);
    usage.set(itemId, {
      total: (current?.total ?? 0) + Math.abs(movement.quantity),
      earliest: Math.min(current?.earliest ?? createdAt, createdAt),
    });
  }

  const result = new Map<string, { total: number; observedDays: number }>();
  for (const [itemId, entry] of usage) {
    const elapsedDays = Math.floor((now.getTime() - entry.earliest) / DAY_MS) + 1;
    result.set(itemId, {
      total: entry.total,
      observedDays: Math.max(MIN_OBSERVATION_DAYS, Math.min(HISTORY_DAYS, elapsedDays)),
    });
  }
  return result;
}

function buildPlanRow(
  item: Item,
  summary: StockSummaryItem | null,
  usage: { total: number; observedDays: number } | undefined,
): SupplierPlanRow {
  const usesPurchaseUnit = Boolean(
    item.purchaseUnit?.trim()
    && item.purchaseConversionFactor
    && item.purchaseConversionFactor > 0
    && item.purchaseUnit.trim().toLowerCase() !== item.unit.trim().toLowerCase(),
  );
  const factor = usesPurchaseUnit ? item.purchaseConversionFactor! : 1;
  const displayUnit = usesPurchaseUnit ? item.purchaseUnit!.trim() : item.unit.trim();
  const currentQty = (summary?.totalQuantity ?? 0) / factor;
  const incomingQty = (summary?.replenishment?.incomingBaseQty ?? 0) / factor;
  const monthlyUsageQty = usage
    ? (usage.total / usage.observedDays) * PLAN_DAYS / factor
    : null;
  const lowStockQty = item.minStockLevel / factor;
  const availableQty = currentQty + incomingQty;
  const projectedQty = monthlyUsageQty === null ? null : availableQty - monthlyUsageQty;
  const rawSuggestion = monthlyUsageQty === null ? 0 : Math.max(0, lowStockQty + monthlyUsageQty - availableQty);
  const suggestedQty = usesPurchaseUnit && !item.allowFractionalPurchaseUnit
    ? Math.ceil(rawSuggestion)
    : roundQty(rawSuggestion);
  const status: PlanStatus = monthlyUsageQty === null ? "REVIEW" : suggestedQty > 0 ? "BUY" : "ENOUGH";

  return {
    item,
    factor,
    displayUnit,
    currentQty: roundQty(currentQty),
    incomingQty: roundQty(incomingQty),
    monthlyUsageQty: monthlyUsageQty === null ? null : roundQty(monthlyUsageQty),
    lowStockQty: roundQty(lowStockQty),
    projectedQty: projectedQty === null ? null : roundQty(projectedQty),
    suggestedQty,
    status,
  };
}

function toApiDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatQty(value: number) {
  return new Intl.NumberFormat("en-PK", { maximumFractionDigits: 2 }).format(value);
}

function formatEditable(value: number) {
  return String(roundQty(value));
}

function toNumber(value: string | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function roundQty(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
