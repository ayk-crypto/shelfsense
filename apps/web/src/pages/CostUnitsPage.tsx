import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getCostUnits, correctLatestStorageUnitCost, type CostUnitItem, type CostUnitStatus } from "../api/cost-units";
import { updateItem } from "../api/items";
import { useLocation } from "../context/LocationContext";
import { useWorkspaceSettings } from "../context/WorkspaceSettingsContext";
import { formatCurrency } from "../utils/currency";
import { DEFAULT_UNIT_OPTIONS } from "../utils/inventoryDefaults";
import "./CostUnitsPage.css";

type ViewFilter = "ALL" | "NEEDS_ATTENTION" | "MISSING_CONVERSION" | "NO_PURCHASE" | "DIRECT";

interface Toast {
  id: number;
  message: string;
  type: "success" | "error";
}

let toastSequence = 0;

function fmtQty(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
}

function fmtDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function statusLabel(status: CostUnitStatus) {
  if (status === "MISSING_CONVERSION") return "Check units";
  if (status === "MISSING_COST") return "Missing cost";
  return "Ready";
}

function currentStockDisplay(item: CostUnitItem) {
  const factor = item.conversionFactor;
  if (!item.purchaseUnit || item.purchaseUnit === item.storageUnit || !factor || factor <= 0) {
    return {
      primary: `${fmtQty(item.currentStorageQuantity)} ${item.storageUnit}`,
      secondary: null,
    };
  }

  const fullPurchaseUnits = Math.floor((item.currentStorageQuantity + 1e-9) / factor);
  const remainder = item.currentStorageQuantity - fullPurchaseUnits * factor;
  const remainderRounded = Math.abs(remainder) < 0.0005 ? 0 : remainder;
  return {
    primary: remainderRounded > 0
      ? `${fmtQty(fullPurchaseUnits)} ${item.purchaseUnit} + ${fmtQty(remainderRounded)} ${item.storageUnit}`
      : `${fmtQty(fullPurchaseUnits)} ${item.purchaseUnit}`,
    secondary: `${fmtQty(item.currentStorageQuantity)} ${item.storageUnit} total`,
  };
}

export function CostUnitsPage() {
  const navigate = useNavigate();
  const { activeLocationId } = useLocation();
  const { settings } = useWorkspaceSettings();
  const currency = settings.currency;
  const storageUnitOptions = settings.customUnits.length > 0 ? settings.customUnits : DEFAULT_UNIT_OPTIONS;
  const purchaseUnitOptions = settings.customPurchaseUnits.length > 0
    ? settings.customPurchaseUnits
    : storageUnitOptions;

  const [items, setItems] = useState<CostUnitItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ViewFilter>("ALL");
  const [editing, setEditing] = useState<CostUnitItem | null>(null);
  const [storageUnit, setStorageUnit] = useState("");
  const [purchaseUnit, setPurchaseUnit] = useState("");
  const [conversionFactor, setConversionFactor] = useState("");
  const [purchaseCost, setPurchaseCost] = useState("");
  const [saving, setSaving] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  function showToast(message: string, type: Toast["type"]) {
    const id = ++toastSequence;
    setToasts((current) => [...current, { id, message, type }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3500);
  }

  async function load() {
    setLoading(true);
    try {
      const response = await getCostUnits();
      setItems(response.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load item costing data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocationId]);

  const counts = useMemo(() => ({
    total: items.length,
    needsAttention: items.filter((item) => item.status !== "READY" || !item.lastPurchase).length,
    missingConversion: items.filter((item) => item.status === "MISSING_CONVERSION").length,
    noPurchase: items.filter((item) => !item.lastPurchase).length,
    direct: items.filter((item) => item.lastPurchase?.sourceType === "DIRECT").length,
  }), [items]);

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesSearch = !query
        || item.name.toLowerCase().includes(query)
        || item.category?.toLowerCase().includes(query)
        || item.storageUnit.toLowerCase().includes(query)
        || item.purchaseUnit?.toLowerCase().includes(query);
      if (!matchesSearch) return false;

      if (filter === "NEEDS_ATTENTION") return item.status !== "READY" || !item.lastPurchase;
      if (filter === "MISSING_CONVERSION") return item.status === "MISSING_CONVERSION";
      if (filter === "NO_PURCHASE") return !item.lastPurchase;
      if (filter === "DIRECT") return item.lastPurchase?.sourceType === "DIRECT";
      return true;
    });
  }, [items, search, filter]);

  function openEditor(item: CostUnitItem) {
    const sameUnit = !item.purchaseUnit || item.purchaseUnit === item.storageUnit;
    const factor = sameUnit ? 1 : item.conversionFactor;
    const effectivePurchaseCost = item.purchaseUnitCost
      ?? (item.storageUnitCost != null && factor ? item.storageUnitCost * factor : null);

    setEditing(item);
    setStorageUnit(item.storageUnit);
    setPurchaseUnit(item.purchaseUnit ?? item.storageUnit);
    setConversionFactor(item.conversionFactor ? String(item.conversionFactor) : sameUnit ? "1" : "");
    setPurchaseCost(effectivePurchaseCost != null ? String(effectivePurchaseCost) : "");
  }

  async function saveEditor() {
    if (!editing) return;

    const trimmedStorage = storageUnit.trim();
    const trimmedPurchase = purchaseUnit.trim() || trimmedStorage;
    const factor = Number(conversionFactor);
    const requiresConversion = trimmedPurchase !== trimmedStorage;

    if (!trimmedStorage) {
      showToast("Storage unit is required", "error");
      return;
    }
    if (requiresConversion && (!Number.isFinite(factor) || factor <= 0)) {
      showToast("Enter how many storage units are in one purchase unit", "error");
      return;
    }

    const nextPurchaseCost = purchaseCost.trim() ? Number(purchaseCost) : null;
    if (purchaseCost.trim() && (!Number.isFinite(nextPurchaseCost) || Number(nextPurchaseCost) <= 0)) {
      showToast("Purchase price must be greater than zero", "error");
      return;
    }

    setSaving(true);
    try {
      const nextFactor = requiresConversion ? factor : 1;
      const unitsChanged = trimmedStorage !== editing.storageUnit
        || trimmedPurchase !== (editing.purchaseUnit ?? editing.storageUnit)
        || nextFactor !== (editing.conversionFactor ?? ((!editing.purchaseUnit || editing.purchaseUnit === editing.storageUnit) ? 1 : null));

      if (unitsChanged) {
        await updateItem(editing.itemId, {
          unit: trimmedStorage,
          purchaseUnit: trimmedPurchase,
          purchaseConversionFactor: nextFactor,
          issueUnit: trimmedStorage,
        });
      }

      const nextStorageCost = nextPurchaseCost != null ? nextPurchaseCost / nextFactor : null;
      const oldStorageCost = editing.storageUnitCost;
      const costChanged = nextStorageCost != null
        && (oldStorageCost == null || Math.abs(nextStorageCost - oldStorageCost) > 0.0001);

      if (costChanged) {
        await correctLatestStorageUnitCost(
          editing.itemId,
          nextStorageCost,
          "Purchase price corrected from Cost & Units screen",
        );
      }

      await load();
      setEditing(null);
      showToast("Item units and purchase price updated", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to update item", "error");
    } finally {
      setSaving(false);
    }
  }

  const editorSameUnit = purchaseUnit.trim() === storageUnit.trim();
  const editorFactor = editorSameUnit ? 1 : Number(conversionFactor);
  const calculatedStorageCost = purchaseCost && Number(purchaseCost) > 0 && Number.isFinite(editorFactor) && editorFactor > 0
    ? Number(purchaseCost) / editorFactor
    : null;
  const editorPurchaseUnitOptions = purchaseUnit && !purchaseUnitOptions.includes(purchaseUnit)
    ? [purchaseUnit, ...purchaseUnitOptions]
    : purchaseUnitOptions;
  const editorStorageUnitOptions = storageUnit && !storageUnitOptions.includes(storageUnit)
    ? [storageUnit, ...storageUnitOptions]
    : storageUnitOptions;

  if (loading) {
    return <div className="page-loading"><div className="spinner" /><p>Loading Cost & Units...</p></div>;
  }

  if (error) {
    return <div className="page-error"><div className="alert alert--error">{error}</div></div>;
  }

  return (
    <div className="cost-units-page">
      <div className="cost-units-head">
        <div>
          <span className="cost-units-kicker">Inventory setup</span>
          <h1>Cost & Units</h1>
          <p>Check purchase-to-storage conversions and the latest cost Plate Cost receives from ShelfSense.</p>
        </div>
        <div className="cost-units-head-note">
          <span>Cost source</span>
          <strong>Latest received stock</strong>
        </div>
      </div>

      <div className="cost-units-summary" aria-label="Cost and unit data quality summary">
        <button type="button" className={filter === "ALL" ? "is-active" : ""} onClick={() => setFilter("ALL")}>
          <span>All items</span><strong>{counts.total}</strong>
        </button>
        <button type="button" className={filter === "NEEDS_ATTENTION" ? "is-active" : ""} onClick={() => setFilter("NEEDS_ATTENTION")}>
          <span>Needs attention</span><strong>{counts.needsAttention}</strong>
        </button>
        <button type="button" className={filter === "MISSING_CONVERSION" ? "is-active" : ""} onClick={() => setFilter("MISSING_CONVERSION")}>
          <span>Missing conversion</span><strong>{counts.missingConversion}</strong>
        </button>
        <button type="button" className={filter === "NO_PURCHASE" ? "is-active" : ""} onClick={() => setFilter("NO_PURCHASE")}>
          <span>No purchase history</span><strong>{counts.noPurchase}</strong>
        </button>
        <button type="button" className={filter === "DIRECT" ? "is-active" : ""} onClick={() => setFilter("DIRECT")}>
          <span>Direct receipts</span><strong>{counts.direct}</strong>
        </button>
      </div>

      <div className="cost-units-toolbar">
        <div className="cost-units-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.35-4.35" />
          </svg>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search item, category, or unit..." />
        </div>
        <span>{visibleItems.length} item{visibleItems.length === 1 ? "" : "s"}</span>
      </div>

      <div className="cost-units-table-wrap">
        <table className="cost-units-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Units & conversion</th>
              <th>Current stock</th>
              <th>Last purchase</th>
              <th>Purchase cost</th>
              <th>Storage unit cost</th>
              <th>Status</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((item) => {
              const stock = currentStockDisplay(item);
              const sameUnit = !item.purchaseUnit || item.purchaseUnit === item.storageUnit;
              return (
                <tr key={item.itemId} className={item.status !== "READY" || !item.lastPurchase ? "cost-units-row--attention" : ""}>
                  <td data-label="Item">
                    <strong className="cost-item-name">{item.name}</strong>
                    <span className="cost-item-category">{item.category || "Uncategorized"}</span>
                  </td>
                  <td data-label="Units & conversion">
                    <div className="cost-unit-flow">
                      <strong>{item.purchaseUnit || item.storageUnit}</strong>
                      <span>→</span>
                      <strong>{item.storageUnit}</strong>
                    </div>
                    <span className={`cost-unit-conversion${item.status === "MISSING_CONVERSION" ? " is-warning" : ""}`}>
                      {sameUnit
                        ? `1 ${item.storageUnit} = 1 ${item.storageUnit}`
                        : item.conversionFactor
                          ? `1 ${item.purchaseUnit} = ${fmtQty(item.conversionFactor)} ${item.storageUnit}`
                          : "Conversion required"}
                    </span>
                  </td>
                  <td data-label="Current stock">
                    <strong>{stock.primary}</strong>
                    {stock.secondary && <span>{stock.secondary}</span>}
                  </td>
                  <td data-label="Last purchase">
                    {item.lastPurchase ? (
                      <div className="cost-last-purchase">
                        <strong>
                          {item.lastPurchase.receivedQuantity != null
                            ? `${fmtQty(item.lastPurchase.receivedQuantity)} ${item.lastPurchase.receivedUnit || item.purchaseUnit || item.storageUnit}`
                            : `${fmtQty(item.lastPurchase.storedBaseQuantity)} ${item.storageUnit}`}
                        </strong>
                        <span>{fmtDate(item.lastPurchase.date)}</span>
                        {item.lastPurchase.sourceType === "PO" && item.lastPurchase.purchaseId ? (
                          <button type="button" className="cost-po-link" onClick={() => navigate(`/purchases?purchaseId=${item.lastPurchase?.purchaseId}`)}>
                            {item.lastPurchase.poReference || "Open PO"} ↗
                          </button>
                        ) : item.lastPurchase.sourceType === "PO" ? (
                          <span className="cost-source-tag">PO receipt</span>
                        ) : (
                          <span className="cost-source-tag">Direct receipt</span>
                        )}
                      </div>
                    ) : <span className="cost-empty">No purchase history</span>}
                  </td>
                  <td data-label="Purchase cost">
                    {item.purchaseUnitCost != null ? (
                      <><strong>{formatCurrency(item.purchaseUnitCost, currency)}</strong><span>per {item.purchaseUnit || item.storageUnit}</span></>
                    ) : <span className="cost-empty">—</span>}
                  </td>
                  <td data-label="Storage unit cost">
                    {item.storageUnitCost != null ? (
                      <><strong className="cost-storage-price">{formatCurrency(item.storageUnitCost, currency)}</strong><span>per {item.storageUnit}</span></>
                    ) : <span className="cost-empty">Missing</span>}
                  </td>
                  <td data-label="Status">
                    <span className={`cost-status cost-status--${item.status.toLowerCase().replaceAll("_", "-")}`}>{statusLabel(item.status)}</span>
                  </td>
                  <td className="cost-actions-cell">
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => openEditor(item)}>Edit</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visibleItems.length === 0 && (
          <div className="cost-units-empty"><strong>No matching items</strong><span>Try another search or filter.</span></div>
        )}
      </div>

      {editing && (
        <div className="cost-editor-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) setEditing(null);
        }}>
          <aside className="cost-editor" role="dialog" aria-modal="true" aria-labelledby="cost-editor-title">
            <div className="cost-editor-head">
              <div>
                <span>Edit Cost & Units</span>
                <h2 id="cost-editor-title">{editing.name}</h2>
              </div>
              <button type="button" className="cost-editor-close" onClick={() => !saving && setEditing(null)} aria-label="Close">×</button>
            </div>

            <div className="cost-editor-body">
              <div className="cost-editor-section">
                <h3>Unit setup</h3>
                <p>Purchase unit is how you buy it. Storage unit is the unit ShelfSense and Plate Cost use internally.</p>
                <label className="form-label">
                  Purchase unit
                  <select className="form-input" value={purchaseUnit} onChange={(event) => setPurchaseUnit(event.target.value)}>
                    {editorPurchaseUnitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                  </select>
                </label>
                <label className="form-label">
                  Storage unit
                  <select className="form-input" value={storageUnit} onChange={(event) => setStorageUnit(event.target.value)}>
                    {editorStorageUnitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                  </select>
                </label>
                <label className="form-label">
                  Storage units in 1 purchase unit
                  <input className="form-input" type="number" min="0.0001" step="any" value={conversionFactor} onChange={(event) => setConversionFactor(event.target.value)} disabled={editorSameUnit} />
                </label>
                <div className="cost-editor-equation">
                  <span>Conversion</span>
                  <strong>
                    1 {purchaseUnit || "purchase unit"} = {editorSameUnit ? "1" : conversionFactor || "?"} {storageUnit || "storage units"}
                  </strong>
                </div>
              </div>

              <div className="cost-editor-section">
                <h3>Latest purchase price</h3>
                {editing.lastPurchase ? (
                  <>
                    <p>
                      Latest receipt: {fmtDate(editing.lastPurchase.date)} · {editing.lastPurchase.sourceType === "PO" ? editing.lastPurchase.poReference || "PO receipt" : "Direct receipt"}
                    </p>
                    <label className="form-label">
                      Purchase price per {purchaseUnit || storageUnit || "purchase unit"}
                      <input className="form-input" type="number" min="0.0001" step="any" value={purchaseCost} onChange={(event) => setPurchaseCost(event.target.value)} />
                    </label>
                    <div className="cost-editor-equation">
                      <span>Calculated storage-unit cost</span>
                      <strong>
                        {calculatedStorageCost != null ? formatCurrency(calculatedStorageCost, currency) : "—"}
                        {storageUnit ? ` / ${storageUnit}` : ""}
                      </strong>
                    </div>
                    <div className="cost-editor-warning">
                      Enter the price paid for one {purchaseUnit || "purchase unit"}. ShelfSense calculates the {storageUnit || "storage unit"} cost automatically using the conversion above. The correction is recorded in the Audit Log and does not rewrite the supplier invoice.
                    </div>
                  </>
                ) : (
                  <div className="cost-editor-no-receipt">No received stock exists yet, so there is no purchase price to correct.</div>
                )}
              </div>
            </div>

            <div className="cost-editor-footer">
              <button type="button" className="btn btn--secondary" disabled={saving} onClick={() => setEditing(null)}>Cancel</button>
              <button type="button" className="btn btn--primary" disabled={saving} onClick={() => void saveEditor()}>
                {saving ? "Saving..." : "Save changes"}
              </button>
            </div>
          </aside>
        </div>
      )}

      <div className="toast-container">
        {toasts.map((toast) => <div key={toast.id} className={`toast toast--${toast.type}`}>{toast.message}</div>)}
      </div>
    </div>
  );
}
