import { Fragment, useEffect, useMemo, useState } from "react";
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
import {
  hasPurchaseUnit,
  getSuggestedPurchaseQty,
  fmtQty,
} from "../utils/purchaseUnits";

interface DraftLineState {
  selected: boolean;
  supplierId: string;
  quantity: string;
  unitCost: string;
}

export function ReorderSuggestionsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeLocationId } = useLocation();
  const { settings } = useWorkspaceSettings();
  const currency = settings.currency;
  const canCreateDrafts = hasPermission(user, "purchases");

  const [suggestions, setSuggestions] = useState<ReorderSuggestion[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [lines, setLines] = useState<Record<string, DraftLineState>>({});
  const [openDetails, setOpenDetails] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
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
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load reorder suggestions");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [activeLocationId, canCreateDrafts]);

  const selectedLines = useMemo(
    () => suggestions.filter((s) => lines[s.itemId]?.selected),
    [lines, suggestions],
  );
  const selectedCount = selectedLines.length;
  const selectedTotal = selectedLines.reduce((sum, s) => {
    const line = lines[s.itemId];
    return sum + toNumber(line?.quantity) * toNumber(line?.unitCost);
  }, 0);
  const selectedSupplierCount = new Set(
    selectedLines.map((s) => lines[s.itemId]?.supplierId).filter(Boolean),
  ).size;

  function updateLine(itemId: string, patch: Partial<DraftLineState>) {
    setSuccess(null);
    setLines((cur) => ({
      ...cur,
      [itemId]: {
        ...(cur[itemId] ?? { selected: false, supplierId: "", quantity: "", unitCost: "" }),
        ...patch,
      },
    }));
  }

  function toggleAll(checked: boolean) {
    setSuccess(null);
    setLines((cur) => {
      const next = { ...cur };
      for (const s of suggestions) {
        const hasSupplier = Boolean(next[s.itemId]?.supplierId);
        const hasQty = toNumber(next[s.itemId]?.quantity) > 0;
        next[s.itemId] = { ...next[s.itemId], selected: checked && hasSupplier && hasQty };
      }
      return next;
    });
  }

  function toggleDetails(itemId: string) {
    setOpenDetails((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  }

  async function handleCreateDrafts() {
    if (!canCreateDrafts) return;
    setSuccess(null);
    setError(null);

    const items = selectedLines.map((s) => {
      const line = lines[s.itemId];
      const factor = s.purchaseConversionFactor;
      const hasUnit = hasPurchaseUnit(s.purchaseUnit, factor);
      const purchaseQty = toNumber(line.quantity);
      const baseQty = hasUnit && factor ? purchaseQty * factor : purchaseQty;
      const purchaseCost = toNumber(line.unitCost);
      const baseCost = hasUnit && factor && purchaseCost > 0 ? purchaseCost / factor : purchaseCost;
      return { itemId: s.itemId, supplierId: line.supplierId, quantity: baseQty, unitCost: baseCost };
    });

    if (items.length === 0) { setError("Select at least one reorder item."); return; }
    if (items.some((i) => !i.supplierId)) { setError("Choose a supplier for every selected item."); return; }
    if (items.some((i) => i.quantity <= 0)) { setError("Quantity must be greater than zero for every selected item."); return; }
    if (items.some((i) => i.unitCost < 0)) { setError("Unit cost cannot be negative."); return; }

    setCreating(true);
    try {
      const res = await createReorderPurchases({ locationId: activeLocationId ?? undefined, items });
      const label = res.purchases.length === 1 ? "purchase draft" : "purchase drafts";
      setSuccess(`Created ${res.purchases.length} ${label}.`);
      if (res.purchases[0]) {
        navigate(`/purchases?purchaseId=${encodeURIComponent(res.purchases[0].id)}&fromReorder=${res.purchases.length}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create purchase drafts");
    } finally {
      setCreating(false);
    }
  }

  function handleExport() {
    const date = new Date().toISOString().split("T")[0];
    const rows = suggestions.map((s) => {
      const line = lines[s.itemId] ?? { selected: false, supplierId: "", quantity: "", unitCost: "" };
      const factor = s.purchaseConversionFactor;
      const hasUop = hasPurchaseUnit(s.purchaseUnit, factor);
      const purchaseUnit = s.purchaseUnit ?? s.unit;
      const qtyLabel = hasUop ? purchaseUnit : s.unit;
      const buyQty = hasUop && factor
        ? getSuggestedPurchaseQty(s.suggestedQuantity, factor)
        : s.suggestedQuantity;
      const supplierName = line.supplierId
        ? (suppliers.find((sup) => sup.id === line.supplierId)?.name ?? "")
        : (s.preferredSupplier?.name ?? "");
      const orderedQty = line.quantity !== "" ? Number(line.quantity) : buyQty;
      const unitCost = line.unitCost !== "" ? Number(line.unitCost) : "";
      const lineTotal = orderedQty && unitCost !== "" ? orderedQty * (unitCost as number) : "";

      return {
        "Item Name": s.itemName,
        "SKU": s.sku ?? "",
        "Category": s.category ?? "",
        "Location": s.location.name ?? "",
        "Current Stock": s.currentStock,
        "Min Stock": s.minStockLevel,
        "Shortage (base unit)": s.suggestedQuantity,
        "Base Unit": s.unit,
        [`Suggested Buy Qty`]: buyQty,
        "Order Unit": qtyLabel,
        "Qty to Order": orderedQty,
        "Supplier": supplierName,
        "Unit Cost": unitCost,
        "Line Total": lineTotal,
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);

    // Column widths
    ws["!cols"] = [
      { wch: 28 }, // Item Name
      { wch: 12 }, // SKU
      { wch: 16 }, // Category
      { wch: 16 }, // Location
      { wch: 14 }, // Current Stock
      { wch: 12 }, // Min Stock
      { wch: 20 }, // Shortage
      { wch: 12 }, // Base Unit
      { wch: 18 }, // Suggested Buy Qty
      { wch: 12 }, // Order Unit
      { wch: 14 }, // Qty to Order
      { wch: 22 }, // Supplier
      { wch: 12 }, // Unit Cost
      { wch: 12 }, // Line Total
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Reorder Suggestions");
    XLSX.writeFile(wb, `reorder-suggestions-${date}.xlsx`);
  }

  if (loading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Loading reorder suggestions...</p>
      </div>
    );
  }

  if (error && suggestions.length === 0) {
    return <div className="page-error"><div className="alert alert--error">{error}</div></div>;
  }

  const readyCount = suggestions.filter((s) => {
    const l = lines[s.itemId];
    return l?.supplierId && toNumber(l.quantity) > 0;
  }).length;

  // column span for detail row
  const colSpan = canCreateDrafts ? 10 : 6;

  return (
    <div className="reorder-page">
      {/* Header */}
      <div className="page-header reorder-page-header">
        <div>
          <h1 className="page-title">Reorder Suggestions</h1>
          <p className="page-subtitle">
            {suggestions.length > 0
              ? `${suggestions.length} item${suggestions.length !== 1 ? "s" : ""} below minimum stock — select and create a purchase draft.`
              : "Convert low-stock items into purchase drafts for the active branch."}
          </p>
        </div>
        {canCreateDrafts && suppliers.length === 0 && (
          <Link className="btn btn--primary" to="/suppliers">Add Supplier</Link>
        )}
      </div>

      {success && <div className="alert alert--success">{success}</div>}
      {error && suggestions.length > 0 && <div className="alert alert--error">{error}</div>}

      {suggestions.length === 0 ? (
        <div className="reorder-empty">
          <div className="reorder-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <h2>Nothing to reorder right now</h2>
          <p>Items appear here when current stock drops below the minimum stock level for the selected branch.</p>
        </div>
      ) : (
        <>
          {/* Sticky toolbar */}
          <div className="ro-toolbar">
            <label className="ro-select-all">
              <input
                type="checkbox"
                checked={readyCount > 0 && selectedCount === readyCount}
                onChange={(e) => toggleAll(e.target.checked)}
                disabled={!canCreateDrafts || suppliers.length === 0}
              />
              <span>Select ready items</span>
              {readyCount > 0 && <em className="ro-ready-count">{readyCount} ready</em>}
            </label>

            <div className="ro-toolbar-summary">
              {selectedCount > 0 ? (
                <>
                  <span className="ro-selected-count">{selectedCount} item{selectedCount !== 1 ? "s" : ""}</span>
                  <span className="ro-toolbar-divider">·</span>
                  <strong className="ro-toolbar-total">{formatCurrency(selectedTotal, currency)}</strong>
                  {selectedSupplierCount > 1 && (
                    <span className="ro-multi-supplier">{selectedSupplierCount} suppliers — separate drafts</span>
                  )}
                </>
              ) : (
                <span className="ro-toolbar-hint">Select items to create a draft</span>
              )}
            </div>

            <button
              type="button"
              className="btn btn--secondary ro-export-btn"
              onClick={handleExport}
              title="Export all suggested items to Excel"
            >
              Export Excel
            </button>

            {canCreateDrafts ? (
              <button
                type="button"
                className="btn btn--primary ro-create-btn"
                onClick={handleCreateDrafts}
                disabled={creating || selectedCount === 0}
              >
                {creating ? "Creating…" : selectedSupplierCount > 1 ? `Create ${selectedSupplierCount} Drafts` : "Create Draft"}
              </button>
            ) : (
              <span className="ro-view-note">View only</span>
            )}
          </div>

          {canCreateDrafts && suppliers.length === 0 && (
            <div className="reorder-supplier-warning">
              Add at least one supplier before creating purchase drafts from reorder suggestions.
            </div>
          )}

          {/* Table */}
          <div className="ro-table-wrap">
            <table className="ro-table">
              <thead>
                <tr>
                  <th className="ro-th ro-th--check"></th>
                  <th className="ro-th ro-th--name">Item</th>
                  <th className="ro-th ro-th--stock">Current</th>
                  <th className="ro-th ro-th--min">Min</th>
                  <th className="ro-th ro-th--buy">Buy</th>
                  {canCreateDrafts ? (
                    <>
                      <th className="ro-th ro-th--supplier">Supplier</th>
                      <th className="ro-th ro-th--qty">Qty</th>
                      <th className="ro-th ro-th--cost">Unit Cost</th>
                      <th className="ro-th ro-th--total">Total</th>
                    </>
                  ) : (
                    <th className="ro-th ro-th--supplier">Preferred Supplier</th>
                  )}
                  <th className="ro-th ro-th--expand"></th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s) => {
                  const line = lines[s.itemId] ?? { selected: false, supplierId: "", quantity: "", unitCost: "" };
                  const factor = s.purchaseConversionFactor;
                  const hasUop = hasPurchaseUnit(s.purchaseUnit, factor);
                  const purchaseUnit = s.purchaseUnit ?? s.unit;
                  const qtyLabel = hasUop ? purchaseUnit : s.unit;

                  const buyQty = hasUop && factor
                    ? getSuggestedPurchaseQty(s.suggestedQuantity, factor)
                    : s.suggestedQuantity;

                  const currentDisplay = hasUop && factor
                    ? (() => {
                        const whole = Math.floor(s.currentStock / factor);
                        const rem = +(s.currentStock - whole * factor).toFixed(6);
                        if (whole === 0) return `${fmtQty(rem)} ${s.unit}`;
                        if (rem === 0) return `${whole} ${purchaseUnit}`;
                        return `${whole} ${purchaseUnit} + ${fmtQty(rem)} ${s.unit}`;
                      })()
                    : `${fmtQty(s.currentStock)} ${s.unit}`;

                  const minDisplay = hasUop && factor
                    ? `${fmtQty(Math.ceil(s.minStockLevel / factor))} ${purchaseUnit}`
                    : `${fmtQty(s.minStockLevel)} ${s.unit}`;

                  const itemTotal = toNumber(line.quantity) * toNumber(line.unitCost);
                  const noSupplier = canCreateDrafts && suppliers.length > 0 && !line.supplierId;
                  const detailsOpen = openDetails.has(s.itemId);

                  const lastCostBase = s.lastPurchaseCost;
                  const lastCostDisplay = hasUop && factor && lastCostBase != null
                    ? lastCostBase * factor
                    : lastCostBase;

                  const enteredQty = toNumber(line.quantity);
                  const qtyHint = hasUop && factor && enteredQty > 0
                    ? `≈ ${fmtQty(enteredQty * factor)} ${s.unit}`
                    : hasUop && factor
                    ? `1 ${purchaseUnit} = ${factor} ${s.unit}`
                    : null;

                  return (
                    <Fragment key={s.itemId}>
                      <tr className={`ro-tr${line.selected ? " ro-tr--selected" : ""}${noSupplier ? " ro-tr--needs-supplier" : ""}`}>
                        {/* Checkbox */}
                        <td className="ro-td ro-td--check">
                          <input
                            type="checkbox"
                            checked={line.selected}
                            disabled={!canCreateDrafts || !line.supplierId}
                            onChange={(e) => updateLine(s.itemId, { selected: e.target.checked })}
                            aria-label={`Select ${s.itemName}`}
                          />
                        </td>

                        {/* Item name */}
                        <td className="ro-td ro-td--name">
                          <span className="ro-item-name">{s.itemName}</span>
                          {(s.sku || s.category || s.location.name) && (
                            <span className="ro-item-meta">
                              {[s.sku ? `SKU ${s.sku}` : "", s.category ?? "", s.location.name ?? ""].filter(Boolean).join(" · ")}
                            </span>
                          )}
                        </td>

                        {/* Current stock */}
                        <td className="ro-td ro-td--stock">{currentDisplay}</td>

                        {/* Min stock */}
                        <td className="ro-td ro-td--min">{minDisplay}</td>

                        {/* Buy qty chip */}
                        <td className="ro-td ro-td--buy">
                          <span className={`ro-buy-chip${buyQty === 0 ? " ro-buy-chip--zero" : ""}`}>
                            <span className="ro-buy-chip-label">Buy</span>
                            <span className="ro-buy-chip-qty">{fmtQty(buyQty)}</span>
                            <span className="ro-buy-chip-unit">{qtyLabel}</span>
                          </span>
                        </td>

                        {canCreateDrafts ? (
                          <>
                            {/* Supplier */}
                            <td className="ro-td ro-td--supplier">
                              <select
                                className="ro-select--sm"
                                value={line.supplierId}
                                onChange={(e) => updateLine(s.itemId, {
                                  supplierId: e.target.value,
                                  selected: e.target.value ? line.selected : false,
                                })}
                                disabled={suppliers.length === 0}
                              >
                                <option value="">— select —</option>
                                {suppliers.map((sup) => (
                                  <option key={sup.id} value={sup.id}>{sup.name}</option>
                                ))}
                              </select>
                            </td>

                            {/* Qty */}
                            <td className="ro-td ro-td--qty">
                              <input
                                className="ro-input--sm"
                                type="number"
                                min="0"
                                step={hasUop ? "1" : "0.01"}
                                value={line.quantity}
                                onChange={(e) => updateLine(s.itemId, { quantity: e.target.value })}
                                aria-label={`Quantity in ${qtyLabel}`}
                              />
                              {qtyHint && <span className="ro-ctrl-hint">{qtyHint}</span>}
                            </td>

                            {/* Unit cost */}
                            <td className="ro-td ro-td--cost">
                              <input
                                className="ro-input--sm"
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="Cost"
                                value={line.unitCost}
                                onChange={(e) => updateLine(s.itemId, { unitCost: e.target.value })}
                                aria-label={`Cost per ${qtyLabel}`}
                              />
                              {lastCostDisplay != null && lastCostDisplay > 0 && (
                                <span className="ro-ctrl-hint">Last: {formatCurrency(lastCostDisplay, currency)}</span>
                              )}
                            </td>

                            {/* Line total */}
                            <td className="ro-td ro-td--total">
                              <span className={`ro-total-val${itemTotal > 0 ? " ro-total-val--active" : ""}`}>
                                {formatCurrency(itemTotal, currency)}
                              </span>
                            </td>
                          </>
                        ) : (
                          <td className="ro-td ro-td--supplier ro-td--readonly-sup">
                            {s.preferredSupplier?.name ?? <span className="ro-no-supplier">—</span>}
                          </td>
                        )}

                        {/* Expand toggle */}
                        <td className="ro-td ro-td--expand">
                          <button
                            type="button"
                            className="ro-expand-btn"
                            onClick={() => toggleDetails(s.itemId)}
                            title={detailsOpen ? "Hide details" : "Show details"}
                          >
                            {detailsOpen ? "▴" : "▾"}
                          </button>
                        </td>
                      </tr>

                      {/* Detail expansion row */}
                      {detailsOpen && (
                        <tr className="ro-tr-detail">
                          <td colSpan={colSpan} className="ro-td-detail">
                            <div className="ro-details">
                              <div className="ro-detail-row">
                                <span>Current stock</span>
                                <span>{fmtQty(s.currentStock)} {s.unit}</span>
                              </div>
                              {hasUop && factor && (
                                <div className="ro-detail-row">
                                  <span>Current ({purchaseUnit}s)</span>
                                  <span>{currentDisplay}</span>
                                </div>
                              )}
                              <div className="ro-detail-row">
                                <span>Minimum stock</span>
                                <span>{fmtQty(s.minStockLevel)} {s.unit}</span>
                              </div>
                              <div className="ro-detail-row">
                                <span>Shortage</span>
                                <span>{fmtQty(s.suggestedQuantity)} {s.unit}</span>
                              </div>
                              {hasUop && factor && (
                                <>
                                  <div className="ro-detail-row">
                                    <span>Suggested purchase</span>
                                    <span>{buyQty} {purchaseUnit}</span>
                                  </div>
                                  <div className="ro-detail-row">
                                    <span>1 {purchaseUnit} =</span>
                                    <span>{factor} {s.unit}</span>
                                  </div>
                                </>
                              )}
                              {s.trackExpiry && (
                                <div className="ro-detail-row">
                                  <span>Expiry tracking</span>
                                  <span>Enabled</span>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function buildInitialLines(suggestions: ReorderSuggestion[]) {
  return Object.fromEntries(
    suggestions.map((s) => {
      const factor = s.purchaseConversionFactor;
      const hasUnit = hasPurchaseUnit(s.purchaseUnit, factor);
      const qty = hasUnit && factor
        ? String(getSuggestedPurchaseQty(s.suggestedQuantity, factor))
        : String(s.suggestedQuantity);
      const lastCost = s.lastPurchaseCost;
      const displayCost = hasUnit && factor && lastCost != null ? lastCost * factor : lastCost;
      return [
        s.itemId,
        {
          selected: false,
          supplierId: s.preferredSupplier?.id ?? "",
          quantity: qty,
          unitCost: displayCost ? String(displayCost) : "",
        },
      ];
    }),
  );
}

function toNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
