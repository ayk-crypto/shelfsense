import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { createReorderPurchases, getReorderSuggestions } from "../api/reorderSuggestions";
import { getSuppliers } from "../api/suppliers";
import { useAuth } from "../context/AuthContext";
import { hasPermission } from "../utils/permissions";
import { useLocation } from "../context/LocationContext";
import { useWorkspaceSettings } from "../context/WorkspaceSettingsContext";
import type { ReorderSuggestion, Supplier } from "../types";
import { formatCurrency } from "../utils/currency";
import { fmtQty, getSuggestedPurchaseQty, hasPurchaseUnit } from "../utils/purchaseUnits";
import "./ToOrderPage.css";

interface DraftLineState {
  selected: boolean;
  supplierId: string;
  quantity: string;
  unitCost: string;
}

interface SupplierGroup {
  key: string;
  supplier: Supplier | null;
  items: ReorderSuggestion[];
}

export function ReorderSuggestionsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeLocationId } = useLocation();
  const { settings } = useWorkspaceSettings();
  const canCreateDrafts = hasPermission(user, "purchases");
  const currency = settings.currency;

  const [suggestions, setSuggestions] = useState<ReorderSuggestion[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [lines, setLines] = useState<Record<string, DraftLineState>>({});
  const [loading, setLoading] = useState(true);
  const [creatingSupplierId, setCreatingSupplierId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [suggestionRes, supplierRes] = await Promise.all([
          getReorderSuggestions(),
          canCreateDrafts ? getSuppliers() : Promise.resolve({ suppliers: [] }),
        ]);
        if (cancelled) return;
        setSuggestions(suggestionRes.suggestions);
        setSuppliers(supplierRes.suppliers);
        setLines(buildInitialLines(suggestionRes.suggestions));
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load items to order");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [activeLocationId, canCreateDrafts]);

  const supplierById = useMemo(() => new Map(suppliers.map((supplier) => [supplier.id, supplier])), [suppliers]);

  const groups = useMemo<SupplierGroup[]>(() => {
    const grouped = new Map<string, ReorderSuggestion[]>();
    for (const suggestion of suggestions) {
      const supplierId = lines[suggestion.itemId]?.supplierId || "__unlinked__";
      const current = grouped.get(supplierId) ?? [];
      current.push(suggestion);
      grouped.set(supplierId, current);
    }

    return [...grouped.entries()]
      .map(([key, items]) => ({
        key,
        supplier: key === "__unlinked__" ? null : (supplierById.get(key) ?? null),
        items,
      }))
      .sort((a, b) => {
        if (!a.supplier) return 1;
        if (!b.supplier) return -1;
        return a.supplier.name.localeCompare(b.supplier.name);
      });
  }, [lines, suggestions, supplierById]);

  const unlinkedCount = suggestions.filter((s) => !lines[s.itemId]?.supplierId).length;
  const linkedCount = suggestions.length - unlinkedCount;
  const supplierGroupCount = groups.filter((group) => group.supplier).length;

  function updateLine(itemId: string, patch: Partial<DraftLineState>) {
    setSuccess(null);
    setLines((current) => ({
      ...current,
      [itemId]: {
        ...(current[itemId] ?? { selected: false, supplierId: "", quantity: "", unitCost: "" }),
        ...patch,
      },
    }));
  }

  function setGroupSelected(group: SupplierGroup, selected: boolean) {
    setLines((current) => {
      const next = { ...current };
      for (const item of group.items) {
        const line = next[item.itemId];
        next[item.itemId] = {
          ...line,
          selected: selected && Boolean(line?.supplierId) && toNumber(line?.quantity) > 0,
        };
      }
      return next;
    });
  }

  async function createDraftForGroup(group: SupplierGroup) {
    if (!canCreateDrafts || !group.supplier) return;
    setError(null);
    setSuccess(null);

    const selectedItems = group.items.filter((item) => lines[item.itemId]?.selected);
    if (selectedItems.length === 0) {
      setError(`Select at least one item for ${group.supplier.name}.`);
      return;
    }

    const payload = selectedItems.map((suggestion) => {
      const line = lines[suggestion.itemId];
      const factor = suggestion.purchaseConversionFactor;
      const usesPurchaseUnit = hasPurchaseUnit(suggestion.purchaseUnit, factor);
      const purchaseQty = toNumber(line?.quantity);
      const baseQty = usesPurchaseUnit && factor ? purchaseQty * factor : purchaseQty;
      const purchaseCost = toNumber(line?.unitCost);
      const baseCost = usesPurchaseUnit && factor && purchaseCost > 0 ? purchaseCost / factor : purchaseCost;
      return {
        itemId: suggestion.itemId,
        supplierId: line?.supplierId ?? "",
        quantity: baseQty,
        unitCost: baseCost,
      };
    });

    if (payload.some((item) => !item.supplierId)) {
      setError("Assign a supplier before creating a purchase order.");
      return;
    }
    if (payload.some((item) => item.quantity <= 0)) {
      setError("Every selected item needs an order quantity greater than zero.");
      return;
    }

    setCreatingSupplierId(group.supplier.id);
    try {
      const res = await createReorderPurchases({ locationId: activeLocationId ?? undefined, items: payload });
      const purchase = res.purchases[0];
      setSuccess(`Draft PO created for ${group.supplier.name}.`);
      if (purchase) {
        navigate(`/purchases?purchaseId=${encodeURIComponent(purchase.id)}&fromReorder=1`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create purchase order");
    } finally {
      setCreatingSupplierId(null);
    }
  }

  function handleExport() {
    const date = new Date().toISOString().slice(0, 10);
    const rows = suggestions.map((suggestion) => {
      const line = lines[suggestion.itemId];
      const factor = suggestion.purchaseConversionFactor;
      const usesPurchaseUnit = hasPurchaseUnit(suggestion.purchaseUnit, factor);
      const orderUnit = usesPurchaseUnit ? (suggestion.purchaseUnit ?? suggestion.unit) : suggestion.unit;
      return {
        Item: suggestion.itemName,
        Category: suggestion.category ?? "",
        Supplier: line?.supplierId ? (supplierById.get(line.supplierId)?.name ?? "") : "Unlinked",
        "Current Stock": suggestion.currentStock,
        "Stock Unit": suggestion.unit,
        "Qty to Order": toNumber(line?.quantity),
        "Order Unit": orderUnit,
        "Unit Cost": toNumber(line?.unitCost),
        Reason: getReasonLabel(suggestion),
      };
    });
    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet["!cols"] = [
      { wch: 28 }, { wch: 18 }, { wch: 24 }, { wch: 14 }, { wch: 12 },
      { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 30 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "To Order");
    XLSX.writeFile(workbook, `to-order-${date}.xlsx`);
  }

  if (loading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Checking what needs to be ordered…</p>
      </div>
    );
  }

  if (error && suggestions.length === 0) {
    return <div className="page-error"><div className="alert alert--error">{error}</div></div>;
  }

  return (
    <div className="to-order-page">
      <div className="to-order-header">
        <div className="to-order-header-copy">
          <span className="to-order-kicker">Purchasing</span>
          <h1 className="page-title">To Order</h1>
          <p className="page-subtitle">
            ShelfSense has already considered current stock and incoming quantities on open purchase orders. Review the suggested buying quantity, then create one draft PO per supplier.
          </p>
        </div>
        <div className="to-order-actions">
          <button type="button" className="btn btn--secondary" onClick={handleExport} disabled={suggestions.length === 0}>Export</button>
          {unlinkedCount > 0 && <Link className="btn btn--secondary" to="/suppliers">Manage Suppliers</Link>}
          <Link className="btn btn--primary" to="/purchases">Purchase Orders</Link>
        </div>
      </div>

      {success && <div className="alert alert--success">{success}</div>}
      {error && suggestions.length > 0 && <div className="alert alert--error">{error}</div>}

      <div className="to-order-summary">
        <SummaryStat label="Need ordering" value={String(suggestions.length)} />
        <SummaryStat label="Ready with supplier" value={String(linkedCount)} />
        <SummaryStat label="Unlinked" value={String(unlinkedCount)} />
      </div>

      {suggestions.length === 0 ? (
        <div className="to-order-empty">
          <h2>Nothing needs ordering right now</h2>
          <p>Open purchase orders and current stock already cover your present replenishment needs.</p>
        </div>
      ) : (
        <div className="to-order-groups">
          {groups.map((group) => {
            const isUnlinked = !group.supplier;
            const selected = group.items.filter((item) => lines[item.itemId]?.selected);
            const groupTotal = selected.reduce((sum, item) => {
              const line = lines[item.itemId];
              return sum + toNumber(line?.quantity) * toNumber(line?.unitCost);
            }, 0);
            const allSelected = !isUnlinked && group.items.length > 0 && group.items.every((item) => lines[item.itemId]?.selected);

            return (
              <section key={group.key} className={`to-order-group${isUnlinked ? " to-order-group--unlinked" : ""}`}>
                <div className="to-order-group-head">
                  <div className="to-order-group-title-wrap">
                    <h2 className="to-order-group-title">{group.supplier?.name ?? "Unlinked"}</h2>
                    <span className={`to-order-group-badge${isUnlinked ? " to-order-group-badge--warn" : ""}`}>
                      {group.items.length} item{group.items.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="to-order-group-actions">
                    {!isUnlinked && canCreateDrafts && (
                      <label className="to-order-check">
                        <input type="checkbox" checked={allSelected} onChange={(event) => setGroupSelected(group, event.target.checked)} />
                        Include all
                      </label>
                    )}
                    {!isUnlinked && selected.length > 0 && groupTotal > 0 && <span className="to-order-group-total">{formatCurrency(groupTotal, currency)}</span>}
                    {!isUnlinked && canCreateDrafts && (
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        onClick={() => void createDraftForGroup(group)}
                        disabled={creatingSupplierId === group.supplier?.id || selected.length === 0}
                      >
                        {creatingSupplierId === group.supplier?.id ? "Creating…" : `Create Draft PO${selected.length > 0 ? ` (${selected.length})` : ""}`}
                      </button>
                    )}
                  </div>
                </div>

                {isUnlinked && (
                  <div className="to-order-unlinked-note">
                    These items need buying but are not linked to a supplier yet. Assign a supplier below and the item will automatically move into that supplier's section.
                  </div>
                )}

                <div className="to-order-list">
                  {group.items.map((suggestion) => {
                    const line = lines[suggestion.itemId] ?? { selected: false, supplierId: "", quantity: "", unitCost: "" };
                    const factor = suggestion.purchaseConversionFactor;
                    const usesPurchaseUnit = hasPurchaseUnit(suggestion.purchaseUnit, factor);
                    const orderUnit = usesPurchaseUnit ? (suggestion.purchaseUnit ?? suggestion.unit) : suggestion.unit;
                    const lineTotal = toNumber(line.quantity) * toNumber(line.unitCost);
                    const currentStockLabel = formatStock(suggestion);
                    const incomingLabel = getIncomingLabel(suggestion);

                    return (
                      <div key={suggestion.itemId} className={`to-order-row${!line.selected && !isUnlinked ? " to-order-row--off" : ""}`}>
                        <div className="to-order-item-main">
                          <div className="to-order-item-name">{suggestion.itemName}</div>
                          <span className="to-order-item-meta">
                            {[suggestion.category, suggestion.sku ? `SKU ${suggestion.sku}` : null, suggestion.location.name].filter(Boolean).join(" · ")}
                          </span>
                          <div className="to-order-why"><strong>Why:</strong> {getReasonLabel(suggestion)}</div>
                        </div>

                        <div className="to-order-stock">
                          <strong>{currentStockLabel}</strong>
                          <span>{incomingLabel}</span>
                        </div>

                        <div className="to-order-field">
                          <label>Order qty</label>
                          <input
                            className="to-order-input"
                            type="number"
                            min="0"
                            step={usesPurchaseUnit ? "1" : "0.01"}
                            value={line.quantity}
                            onChange={(event) => updateLine(suggestion.itemId, { quantity: event.target.value })}
                          />
                          <span className="to-order-unit-hint">
                            {orderUnit}{usesPurchaseUnit && factor ? ` · 1 ${orderUnit} = ${fmtQty(factor)} ${suggestion.unit}` : ""}
                          </span>
                        </div>

                        <div className={`to-order-field${isUnlinked ? " to-order-supplier-cell" : ""}`}>
                          <label>{isUnlinked ? "Assign supplier" : "Unit cost"}</label>
                          {isUnlinked ? (
                            <select
                              className="to-order-select"
                              value={line.supplierId}
                              onChange={(event) => updateLine(suggestion.itemId, {
                                supplierId: event.target.value,
                                selected: Boolean(event.target.value),
                              })}
                            >
                              <option value="">Choose supplier</option>
                              {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                            </select>
                          ) : (
                            <input
                              className="to-order-input"
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.unitCost}
                              onChange={(event) => updateLine(suggestion.itemId, { unitCost: event.target.value })}
                              placeholder="0.00"
                            />
                          )}
                        </div>

                        <div className="to-order-line-total">
                          {!isUnlinked && (
                            <>
                              <strong>{formatCurrency(lineTotal, currency)}</strong>
                              <span>{line.selected ? "Included" : "Excluded"}</span>
                            </>
                          )}
                        </div>

                        {!isUnlinked && canCreateDrafts && (
                          <label className="to-order-check" title="Include this item in the draft PO">
                            <input
                              type="checkbox"
                              checked={line.selected}
                              onChange={(event) => updateLine(suggestion.itemId, { selected: event.target.checked })}
                            />
                          </label>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {supplierGroupCount === 0 && unlinkedCount > 0 && suppliers.length === 0 && canCreateDrafts && (
        <div className="alert alert--warning">No suppliers exist yet. Add a supplier first, then link each item from this page.</div>
      )}
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="to-order-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function buildInitialLines(suggestions: ReorderSuggestion[]) {
  return Object.fromEntries(suggestions.map((suggestion) => {
    const factor = suggestion.purchaseConversionFactor;
    const usesPurchaseUnit = hasPurchaseUnit(suggestion.purchaseUnit, factor);
    const quantity = usesPurchaseUnit && factor
      ? String(getSuggestedPurchaseQty(suggestion.suggestedQuantity, factor))
      : String(suggestion.suggestedQuantity);
    const lastCost = suggestion.lastPurchaseCost;
    const displayCost = usesPurchaseUnit && factor && lastCost != null ? lastCost * factor : lastCost;
    const supplierId = suggestion.preferredSupplier?.id ?? "";
    return [suggestion.itemId, {
      selected: Boolean(supplierId),
      supplierId,
      quantity,
      unitCost: displayCost && displayCost > 0 ? String(displayCost) : "",
    }];
  }));
}

function formatStock(suggestion: ReorderSuggestion) {
  const factor = suggestion.purchaseConversionFactor;
  const usesPurchaseUnit = hasPurchaseUnit(suggestion.purchaseUnit, factor);
  if (!usesPurchaseUnit || !factor || !suggestion.purchaseUnit) {
    return `${fmtQty(suggestion.currentStock)} ${suggestion.unit} on hand`;
  }
  const whole = Math.floor(suggestion.currentStock / factor);
  const remainder = +(suggestion.currentStock - whole * factor).toFixed(6);
  if (whole === 0) return `${fmtQty(remainder)} ${suggestion.unit} on hand`;
  if (remainder === 0) return `${whole} ${suggestion.purchaseUnit} on hand`;
  return `${whole} ${suggestion.purchaseUnit} + ${fmtQty(remainder)} ${suggestion.unit}`;
}

function getReasonLabel(suggestion: ReorderSuggestion) {
  const status = suggestion.replenishment?.status ?? "REORDER_REQUIRED";
  switch (status) {
    case "ADDITIONAL_QTY_REQUIRED": return "Incoming stock helps, but it still does not cover the required level.";
    case "ON_ORDER_SHORTAGE_RISK": return "Stock is on order, but projected coverage is still too low.";
    case "OVERDUE_DELIVERY": return "An expected delivery is overdue and stock coverage is at risk.";
    case "CONFIGURATION_REQUIRED": return "Replenishment settings need attention before the recommendation can be fully optimized.";
    case "NO_USAGE_DATA": return "There is not enough usage history yet, so ShelfSense is using the configured stock threshold.";
    default: return "Available stock is below the replenishment point after accounting for incoming purchase orders.";
  }
}

function getIncomingLabel(suggestion: ReorderSuggestion) {
  const incoming = suggestion.replenishment?.incomingBaseQty;
  if (typeof incoming === "number" && incoming > 0) {
    return `${fmtQty(incoming)} ${suggestion.unit} already incoming`;
  }
  return `Minimum ${fmtQty(suggestion.minStockLevel)} ${suggestion.unit}`;
}

function toNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
