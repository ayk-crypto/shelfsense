import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getItems } from "../api/items";
import { getLocations } from "../api/locations";
import { getOpenPurchases, receivePurchase } from "../api/purchases";
import { getPriceHistory, getSupplierSuggestion, stockIn } from "../api/stock";
import { getSuppliers } from "../api/suppliers";
import { useLocation } from "../context/LocationContext";
import { useWorkspaceSettings } from "../context/WorkspaceSettingsContext";
import type { Item, Location, Purchase, Supplier } from "../types";
import { formatCurrency } from "../utils/currency";

interface BatchRow {
  rowId: string;
  item: Item;
  qty: string;
  unitCost: string;
  expiryDate: string;
  batchNo: string;
  supplierId: string;
  note: string;
  lastPrice: number | null;
  metaLoading: boolean;
  suggested: boolean;
  enteredUnit: "base" | "purchase";
}

function fmtQty(n: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(n);
}

interface RowResult {
  rowId: string;
  itemName: string;
  batchNo: string;
  status: "success" | "error";
  error?: string;
}

interface PoReceiveLineDraft {
  purchaseItemId: string;
  itemName: string;
  itemUnit: string;
  remainingQty: number;
  trackExpiry: boolean;
  receivedQuantity: string;
  locationId: string;
  expiryDate: string;
  batchNo: string;
  unitCost: string;
  notes: string;
}

let poBatchSeq = 0;

interface PoBatchDraft {
  key: number;
  quantity: string;
  locationId: string;
  expiryDate: string;
  batchNo: string;
  unitCost: string;
  notes: string;
}

function newPoBatch(defaults: { locationId: string; unitCost: string }): PoBatchDraft {
  return {
    key: ++poBatchSeq,
    quantity: "",
    locationId: defaults.locationId,
    expiryDate: "",
    batchNo: "",
    unitCost: defaults.unitCost,
    notes: "",
  };
}

function generateBatchNo(rows: BatchRow[], itemId: string): string {
  const d = new Date();
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, "");
  const count = rows.filter((r) => r.item.id === itemId).length + 1;
  return `B${ymd}-${String(count).padStart(3, "0")}`;
}

export function StockInPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { settings } = useWorkspaceSettings();
  const currency = settings.currency;

  const [allItems, setAllItems] = useState<Item[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [search, setSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [globalNote, setGlobalNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<RowResult[] | null>(null);
  const [touched, setTouched] = useState(false);

  const { activeLocationId: defaultLocationId } = useLocation();
  const [locations, setLocations] = useState<Location[]>([]);
  const [mode, setMode] = useState<"direct" | "po">("direct");
  const [openPOs, setOpenPOs] = useState<Purchase[]>([]);
  const [poLoading, setPoLoading] = useState(false);
  const [selectedPoId, setSelectedPoId] = useState("");
  const [selectedPo, setSelectedPo] = useState<Purchase | null>(null);
  const [poBatches, setPoBatches] = useState<Record<string, PoBatchDraft[]>>({});
  const [poSubmitting, setPoSubmitting] = useState(false);
  const [poResult, setPoResult] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      try {
        const [itemsRes, suppliersRes, locationsRes] = await Promise.all([getItems(), getSuppliers(), getLocations()]);
        const activeItems = itemsRes.items.filter((i) => i.isActive);
        setAllItems(activeItems);
        setSuppliers(suppliersRes.suppliers);
        setLocations(locationsRes.locations);

        // Deep-link from PO detail: /stock-in?mode=po&poId=<id>
        const deepMode = searchParams.get("mode");
        const deepPoId = searchParams.get("poId");
        if (deepMode === "po" && deepPoId) {
          setMode("po");
          setPoLoading(true);
          const next = new URLSearchParams(searchParams);
          next.delete("mode");
          next.delete("poId");
          setSearchParams(next, { replace: true });
          try {
            const res = await getOpenPurchases();
            setOpenPOs(res.purchases);
            const po = res.purchases.find((p) => p.id === deepPoId) ?? null;
            if (po) {
              const fallbackLoc = locationsRes.locations[0]?.id ?? "";
              setSelectedPoId(po.id);
              setSelectedPo(po);
              const init: Record<string, PoBatchDraft[]> = {};
              for (const item of po.purchaseItems.filter((i) => i.remainingQuantity > 0)) {
                init[item.id] = [newPoBatch({ locationId: fallbackLoc, unitCost: String(item.unitCost) })];
              }
              setPoBatches(init);
            }
          } catch {
            setOpenPOs([]);
          } finally {
            setPoLoading(false);
          }
          setLoadingItems(false);
          return;
        }

        const itemId = searchParams.get("itemId");
        const query = searchParams.get("q")?.trim().toLowerCase();
        const preselected = itemId
          ? activeItems.find((item) => item.id === itemId)
          : query
            ? activeItems.find((item) =>
                item.name.toLowerCase().includes(query) ||
                (item.sku ?? "").toLowerCase().includes(query) ||
                (item.barcode ?? "").toLowerCase().includes(query)
              )
            : null;

        if (preselected) {
          const rowId = crypto.randomUUID();
          const batchNo = generateBatchNo([], preselected.id);
          setRows([{
            rowId,
            item: preselected,
            qty: "",
            unitCost: "",
            expiryDate: "",
            batchNo,
            supplierId: "",
            note: "",
            lastPrice: null,
            metaLoading: true,
            suggested: false,
            enteredUnit: preselected.purchaseUnit ? "purchase" : "base",
          }]);
          setSearch("");
          setShowDropdown(false);
          void fetchRowMeta(rowId, preselected.id);

          const next = new URLSearchParams(searchParams);
          next.delete("itemId");
          next.delete("q");
          setSearchParams(next, { replace: true });
        } else if (query) {
          setSearch(searchParams.get("q") ?? "");
          setShowDropdown(true);
        }
      } catch {
        setAllItems([]);
      } finally {
        setLoadingItems(false);
      }
    }
    void load();
  }, []);

  useEffect(() => {
    if (!showDropdown) return;
    function handlePointerDown(e: PointerEvent) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        searchRef.current && !searchRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showDropdown]);

  const stagedItemIds = new Set(rows.map((r) => r.item.id));
  const filteredItems = allItems
    .filter((i) => !stagedItemIds.has(i.id))
    .filter((i) => {
      const q = search.toLowerCase().trim();
      if (!q) return true;
      return (
        i.name.toLowerCase().includes(q) ||
        (i.sku ?? "").toLowerCase().includes(q) ||
        (i.barcode ?? "").toLowerCase().includes(q)
      );
    });

  function addItem(item: Item) {
    const rowId = crypto.randomUUID();
    const batchNo = generateBatchNo(rows, item.id);
    const newRow: BatchRow = {
      rowId,
      item,
      qty: "",
      unitCost: "",
      expiryDate: "",
      batchNo,
      supplierId: "",
      note: "",
      lastPrice: null,
      metaLoading: true,
      suggested: false,
      enteredUnit: item.purchaseUnit ? "purchase" : "base",
    };
    setRows((prev) => [...prev, newRow]);
    setSearch("");
    setShowDropdown(false);
    setResults(null);
    setTouched(false);
    void fetchRowMeta(rowId, item.id);
  }

  async function fetchRowMeta(rowId: string, itemId: string) {
    try {
      const [suggRes, priceRes] = await Promise.all([
        getSupplierSuggestion(itemId),
        getPriceHistory(itemId, 3),
      ]);
      setRows((prev) =>
        prev.map((r) =>
          r.rowId !== rowId
            ? r
            : {
                ...r,
                supplierId: suggRes.suggestion?.id ?? "",
                suggested: !!suggRes.suggestion,
                lastPrice: priceRes.history[0]?.unitCost ?? null,
                metaLoading: false,
              },
        ),
      );
    } catch {
      setRows((prev) => prev.map((r) => (r.rowId !== rowId ? r : { ...r, metaLoading: false })));
    }
  }

  function addBatch(sourceRowId: string) {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.rowId === sourceRowId);
      if (idx === -1) return prev;
      const source = prev[idx];
      const batchNo = generateBatchNo(prev, source.item.id);
      const newRow: BatchRow = {
        rowId: crypto.randomUUID(),
        item: source.item,
        qty: "",
        unitCost: source.unitCost,
        expiryDate: "",
        batchNo,
        supplierId: source.supplierId,
        note: "",
        lastPrice: source.lastPrice,
        metaLoading: false,
        suggested: false,
        enteredUnit: source.enteredUnit,
      };
      const updated = [...prev];
      updated.splice(idx + 1, 0, newRow);
      return updated;
    });
  }

  function removeRow(rowId: string) {
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));
  }

  function updateRow(rowId: string, field: keyof Omit<BatchRow, "rowId" | "item" | "lastPrice" | "metaLoading" | "suggested">, value: string) {
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, [field]: value } : r)));
  }

  function clearAll() {
    setRows([]);
    setGlobalNote("");
    setResults(null);
    setTouched(false);
  }

  async function switchMode(newMode: "direct" | "po") {
    setMode(newMode);
    setPoResult(null);
    if (newMode === "po" && openPOs.length === 0) {
      setPoLoading(true);
      try {
        const res = await getOpenPurchases();
        setOpenPOs(res.purchases);
      } catch {
        setOpenPOs([]);
      } finally {
        setPoLoading(false);
      }
    }
  }

  function handlePoSelect(poId: string) {
    setSelectedPoId(poId);
    setPoResult(null);
    const po = openPOs.find((p) => p.id === poId) ?? null;
    setSelectedPo(po);
    if (!po) { setPoBatches({}); return; }
    const fallbackLoc = defaultLocationId || (locations[0]?.id ?? "");
    const init: Record<string, PoBatchDraft[]> = {};
    for (const item of po.purchaseItems.filter((i) => i.remainingQuantity > 0)) {
      init[item.id] = [newPoBatch({ locationId: fallbackLoc, unitCost: String(item.unitCost) })];
    }
    setPoBatches(init);
  }

  function updatePoBatch(purchaseItemId: string, key: number, patch: Partial<PoBatchDraft>) {
    setPoBatches((cur) => ({
      ...cur,
      [purchaseItemId]: cur[purchaseItemId].map((b) => b.key === key ? { ...b, ...patch } : b),
    }));
  }

  function addPoBatch(purchaseItemId: string, defaults: { locationId: string; unitCost: string }) {
    setPoBatches((cur) => ({
      ...cur,
      [purchaseItemId]: [...cur[purchaseItemId], newPoBatch(defaults)],
    }));
  }

  function removePoBatch(purchaseItemId: string, key: number) {
    setPoBatches((cur) => ({
      ...cur,
      [purchaseItemId]: cur[purchaseItemId].filter((b) => b.key !== key),
    }));
  }

  async function handlePoReceiveSubmit() {
    if (!selectedPo) return;
    const pendingItems = selectedPo.purchaseItems.filter((i) => i.remainingQuantity > 0);

    const lines: { purchaseItemId: string; receivedQuantity: number; locationId?: string; expiryDate?: string; batchNo?: string; unitCost?: number; notes?: string }[] = [];

    for (const item of pendingItems) {
      const itemBatches = poBatches[item.id] ?? [];
      let totalForItem = 0;
      for (const b of itemBatches) {
        const qty = parseFloat(b.quantity) || 0;
        if (qty <= 0) continue;
        totalForItem += qty;
        if (totalForItem > item.remainingQuantity) {
          setPoResult({ type: "error", msg: `Total received for "${item.item.name}" (${totalForItem}) exceeds remaining (${item.remainingQuantity} ${item.item.unit})` });
          return;
        }
        lines.push({
          purchaseItemId: item.id,
          receivedQuantity: qty,
          locationId: b.locationId || undefined,
          expiryDate: b.expiryDate || undefined,
          batchNo: b.batchNo || undefined,
          unitCost: parseFloat(b.unitCost) || undefined,
          notes: b.notes || undefined,
        });
      }
    }

    if (lines.length === 0) {
      setPoResult({ type: "error", msg: "Enter at least one received quantity." });
      return;
    }
    setPoSubmitting(true);
    setPoResult(null);
    try {
      await receivePurchase(selectedPo.id, { lines });
      setPoResult({ type: "success", msg: "Receipt confirmed. Stock has been updated." });
      const res = await getOpenPurchases();
      setOpenPOs(res.purchases);
      setSelectedPoId("");
      setSelectedPo(null);
      setPoBatches({});
    } catch (err) {
      setPoResult({ type: "error", msg: err instanceof Error ? err.message : "Failed to record receipt." });
    } finally {
      setPoSubmitting(false);
    }
  }

  function isRowValid(row: BatchRow) {
    const qty = parseFloat(row.qty);
    if (!qty || qty <= 0) return false;
    if (row.item.trackExpiry && !row.expiryDate) return false;
    return true;
  }

  const validRowCount = rows.filter(isRowValid).length;

  async function handleSubmit() {
    setTouched(true);
    if (validRowCount === 0) return;

    setSubmitting(true);
    const out: RowResult[] = [];

    for (const row of rows) {
      if (!isRowValid(row)) {
        out.push({ rowId: row.rowId, itemName: row.item.name, batchNo: row.batchNo, status: "error", error: "Invalid — skipped" });
        continue;
      }
      const selectedSupplier = suppliers.find((s) => s.id === row.supplierId);
      const enteredQty = parseFloat(row.qty);
      const isPurchaseUnit = row.enteredUnit === "purchase" && !!row.item.purchaseUnit && !!row.item.purchaseConversionFactor;
      const baseQty = isPurchaseUnit ? enteredQty * row.item.purchaseConversionFactor! : enteredQty;
      try {
        await stockIn({
          itemId: row.item.id,
          quantity: baseQty,
          unitCost: row.unitCost ? parseFloat(row.unitCost) : undefined,
          expiryDate: row.expiryDate || undefined,
          batchNo: row.batchNo || undefined,
          supplierId: row.supplierId || undefined,
          supplierName: selectedSupplier?.name,
          note: [row.note.trim(), globalNote.trim()].filter(Boolean).join(" · ") || undefined,
          enteredQuantity: isPurchaseUnit ? enteredQty : undefined,
          enteredUnit: isPurchaseUnit ? row.item.purchaseUnit! : undefined,
        });
        out.push({ rowId: row.rowId, itemName: row.item.name, batchNo: row.batchNo, status: "success" });
      } catch (err) {
        out.push({
          rowId: row.rowId,
          itemName: row.item.name,
          batchNo: row.batchNo,
          status: "error",
          error: err instanceof Error ? err.message : "Failed",
        });
      }
    }

    setResults(out);
    setSubmitting(false);
    const failedIds = new Set(out.filter((r) => r.status === "error").map((r) => r.rowId));
    setRows((prev) => prev.filter((r) => failedIds.has(r.rowId)));
    if (failedIds.size === 0) setGlobalNote("");
  }

  const successCount = results?.filter((r) => r.status === "success").length ?? 0;
  const allSucceeded = results !== null && results.length > 0 && results.every((r) => r.status === "success");

  return (
    <div className="stock-entry-page">
      <div className="stock-entry-header">
        <div>
          <div className="stock-entry-type-badge stock-entry-type-badge--in">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
            Receive Stock
          </div>
          <h1 className="page-title">Receive Stock</h1>
          <p className="page-subtitle">
            {mode === "direct"
              ? <>Add items directly to stock with batch numbers, costs, expiry dates, and supplier info. Use <strong>+ Add batch</strong> on any row to record multiple batches.</>
              : "Receive goods against an open Purchase Order. Stock batches are created only when you confirm receipt."}
          </p>
        </div>
        {rows.length > 0 && (
          <div className="stock-entry-tally">
            <div className="stock-entry-tally-item">
              <span className="stock-entry-tally-num">{rows.length}</span>
              <span className="stock-entry-tally-label">batch{rows.length !== 1 ? "es" : ""}</span>
            </div>
            <div className="stock-entry-tally-div" />
            <div className="stock-entry-tally-item">
              <span className={`stock-entry-tally-num ${validRowCount < rows.length ? "stock-entry-tally-num--warn" : "stock-entry-tally-num--ok"}`}>{validRowCount}</span>
              <span className="stock-entry-tally-label">ready</span>
            </div>
          </div>
        )}
      </div>

      <div className="stock-entry-mode-toggle">
        <button
          type="button"
          className={`stock-entry-mode-btn${mode === "direct" ? " stock-entry-mode-btn--active" : ""}`}
          onClick={() => void switchMode("direct")}
        >
          Direct Receive
        </button>
        <button
          type="button"
          className={`stock-entry-mode-btn${mode === "po" ? " stock-entry-mode-btn--active" : ""}`}
          onClick={() => void switchMode("po")}
        >
          Receive Against PO
        </button>
      </div>

      {mode === "po" ? (
        <div className="po-receive-section">
          {poLoading ? (
            <div className="po-receive-loading">Loading open purchase orders…</div>
          ) : openPOs.length === 0 ? (
            <div className="po-receive-empty">
              <p>No open purchase orders found.</p>
              <p>Go to <a className="po-receive-link" href="/purchases">Purchases</a>, create a draft PO, and mark it as Ordered to receive here.</p>
            </div>
          ) : (
            <>
              <div className="form-group po-receive-selector">
                <label className="form-label">Select Purchase Order</label>
                <select className="form-input form-select" value={selectedPoId} onChange={(e) => handlePoSelect(e.target.value)}>
                  <option value="">Choose an open PO to receive against…</option>
                  {openPOs.map((po) => (
                    <option key={po.id} value={po.id}>
                      {po.supplier.name} — {po.remainingQuantity} unit{po.remainingQuantity !== 1 ? "s" : ""} remaining (#{po.id.slice(-6).toUpperCase()})
                    </option>
                  ))}
                </select>
              </div>
              {selectedPo && Object.keys(poBatches).length > 0 && (
                <div className="po-receive-form">
                  <div className="po-receive-summary">
                    <span><strong>{selectedPo.supplier.name}</strong></span>
                    <span>Ordered: {selectedPo.orderedQuantity}</span>
                    <span>Received so far: {selectedPo.receivedQuantity}</span>
                    <span>Remaining: <strong>{selectedPo.remainingQuantity}</strong></span>
                  </div>
                  <div className="por-items" style={{ padding: "14px 16px", gap: 12 }}>
                    {selectedPo.purchaseItems.filter((i) => i.remainingQuantity > 0).map((itemLine) => {
                      const itemBatches = poBatches[itemLine.id] ?? [];
                      const batchTotal = itemBatches.reduce((s, b) => s + (parseFloat(b.quantity) || 0), 0);
                      const isOver = batchTotal > itemLine.remainingQuantity;
                      const lastBatch = itemBatches[itemBatches.length - 1];
                      const fallbackLoc = defaultLocationId || (locations[0]?.id ?? "");
                      return (
                        <div key={itemLine.id} className="por-card">
                          <div className="por-card-head">
                            <div className="por-card-head-left">
                              <span className="por-card-name">{itemLine.item.name}</span>
                              <div className="por-card-meta">
                                <span className="por-card-stat">Ordered: <strong>{itemLine.orderedQuantity} {itemLine.item.unit}</strong></span>
                                <span className="por-card-stat">Received: <strong>{itemLine.receivedQuantity} {itemLine.item.unit}</strong></span>
                                <span className="por-card-stat por-card-stat--rem">Remaining: <strong>{itemLine.remainingQuantity} {itemLine.item.unit}</strong></span>
                              </div>
                            </div>
                            <div className="por-batch-tally">
                              <span className={`por-batch-total${isOver ? " por-batch-total--over" : batchTotal > 0 ? " por-batch-total--ok" : ""}`}>
                                {batchTotal > 0 ? `${batchTotal} / ${itemLine.remainingQuantity} ${itemLine.item.unit}` : `0 / ${itemLine.remainingQuantity} ${itemLine.item.unit}`}
                              </span>
                              {isOver && <span className="por-over-warning">Over by {batchTotal - itemLine.remainingQuantity}</span>}
                            </div>
                          </div>
                          <div className="por-batches">
                            {itemBatches.map((batch, idx) => (
                              <div key={batch.key} className="por-batch-row">
                                <div className="por-batch-label">
                                  <span className="por-batch-num">Batch {idx + 1}</span>
                                  {itemBatches.length > 1 && (
                                    <button type="button" className="por-batch-remove" onClick={() => removePoBatch(itemLine.id, batch.key)} aria-label={`Remove batch ${idx + 1}`}>
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                                      </svg>
                                    </button>
                                  )}
                                </div>
                                <div className="por-fields">
                                  <label className="por-field">
                                    <span className="por-field-label">Qty ({itemLine.item.unit}) *</span>
                                    <input className={`form-input${isOver ? " por-field--over" : ""}`} type="number" min="0" step="0.01" placeholder="0" value={batch.quantity} onChange={(e) => updatePoBatch(itemLine.id, batch.key, { quantity: e.target.value })} />
                                  </label>
                                  <label className="por-field">
                                    <span className="por-field-label">Branch</span>
                                    <select className="form-input form-select" value={batch.locationId} onChange={(e) => updatePoBatch(itemLine.id, batch.key, { locationId: e.target.value })}>
                                      {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
                                    </select>
                                  </label>
                                  <label className="por-field">
                                    <span className="por-field-label">Expiry date{itemLine.item.trackExpiry ? " *" : ""}</span>
                                    <input className="form-input" type="date" value={batch.expiryDate} onChange={(e) => updatePoBatch(itemLine.id, batch.key, { expiryDate: e.target.value })} />
                                  </label>
                                  <label className="por-field">
                                    <span className="por-field-label">Batch / Lot no.</span>
                                    <input className="form-input" value={batch.batchNo} onChange={(e) => updatePoBatch(itemLine.id, batch.key, { batchNo: e.target.value })} placeholder="Optional" />
                                  </label>
                                  <label className="por-field">
                                    <span className="por-field-label">Unit cost</span>
                                    <input className="form-input" type="number" min="0" step="0.01" value={batch.unitCost} onChange={(e) => updatePoBatch(itemLine.id, batch.key, { unitCost: e.target.value })} />
                                  </label>
                                  <label className="por-field">
                                    <span className="por-field-label">Notes</span>
                                    <input className="form-input" value={batch.notes} onChange={(e) => updatePoBatch(itemLine.id, batch.key, { notes: e.target.value })} placeholder="Optional" />
                                  </label>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="por-add-batch-row">
                            <button type="button" className="por-add-batch-btn" onClick={() => addPoBatch(itemLine.id, { locationId: lastBatch?.locationId ?? fallbackLoc, unitCost: lastBatch?.unitCost ?? String(itemLine.unitCost) })}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                              </svg>
                              Add another batch
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="po-receive-footer">
                    {poResult && <div className={`po-receive-result po-receive-result--${poResult.type}`}>{poResult.msg}</div>}
                    <button type="button" className="btn btn--primary" onClick={() => void handlePoReceiveSubmit()} disabled={poSubmitting}>
                      {poSubmitting ? "Receiving…" : "Confirm Receipt"}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <>
      {results && (
        <div className={`stock-entry-results ${allSucceeded ? "stock-entry-results--success" : "stock-entry-results--partial"}`}>
          <div className="stock-entry-results-icon">
            {allSucceeded ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            )}
          </div>
          <div className="stock-entry-results-body">
            <div className="stock-entry-results-title">
              {allSucceeded
                ? `All ${successCount} batch${successCount !== 1 ? "es" : ""} recorded successfully`
                : `${successCount} of ${results.length} batches recorded`}
            </div>
            {results.some((r) => r.status === "error") && (
              <ul className="stock-entry-results-errors">
                {results.filter((r) => r.status === "error").map((r) => (
                  <li key={r.rowId}><strong>{r.itemName}</strong> ({r.batchNo}): {r.error}</li>
                ))}
              </ul>
            )}
          </div>
          {allSucceeded && (
            <button className="btn btn--ghost btn--sm" onClick={clearAll}>Start new entry</button>
          )}
        </div>
      )}

      <div className="stock-entry-search-section">
        <label className="stock-entry-search-label">Search and add items</label>
        <div className="stock-entry-search-wrap" ref={dropdownRef}>
          <div className="stock-entry-search-box">
            <svg className="stock-entry-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              ref={searchRef}
              className="stock-entry-search-input"
              placeholder={loadingItems ? "Loading items…" : "Search by name, SKU, or barcode…"}
              value={search}
              disabled={loadingItems}
              onChange={(e) => { setSearch(e.target.value); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
            />
            {loadingItems && <div className="spinner stock-entry-search-spinner" />}
          </div>
          {showDropdown && !loadingItems && (
            <div className="stock-entry-dropdown">
              {filteredItems.length === 0 ? (
                <div className="stock-entry-dropdown-empty">
                  {search
                    ? "No items match your search"
                    : stagedItemIds.size === allItems.length
                      ? "All items already added — use + Add batch on a row to add another batch"
                      : "Start typing to search"}
                </div>
              ) : (
                filteredItems.slice(0, 10).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="stock-entry-dropdown-item"
                    onClick={() => addItem(item)}
                  >
                    <div className="stock-entry-dropdown-name">{item.name}</div>
                    <div className="stock-entry-dropdown-meta">
                      {item.unit}
                      {item.category ? ` · ${item.category}` : ""}
                      {item.sku ? ` · ${item.sku}` : ""}
                      {item.trackExpiry ? " · Expiry tracked" : ""}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {rows.length > 0 ? (
        <>
          <div className="stock-entry-table-wrap">
            <table className="stock-entry-table stock-entry-table--wide">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Batch #</th>
                  <th>Qty <span className="stock-entry-th-req">*</span></th>
                  <th>Unit Cost</th>
                  <th>Expiry Date</th>
                  <th>Supplier</th>
                  <th>Note</th>
                  <th className="stock-entry-th-actions"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const qty = parseFloat(row.qty);
                  const qtyInvalid = touched && (row.qty !== "" ? (isNaN(qty) || qty <= 0) : true);
                  const expiryMissing = touched && row.item.trackExpiry && !row.expiryDate;
                  const prevRow = idx > 0 ? rows[idx - 1] : null;
                  const isContinuation = prevRow?.item.id === row.item.id;
                  const batchNum = rows.slice(0, idx + 1).filter((r) => r.item.id === row.item.id).length;

                  return (
                    <tr key={row.rowId} className={`${qtyInvalid || expiryMissing ? "stock-entry-row--invalid" : ""} ${isContinuation ? "stock-entry-row--continuation" : ""}`}>
                      <td className="stock-entry-td-name">
                        {isContinuation ? (
                          <span className="stock-entry-batch-indent">
                            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="stock-entry-batch-arrow">
                              <path d="M4 4v5h8" />
                            </svg>
                            Batch {batchNum}
                          </span>
                        ) : (
                          <>
                            <span className="stock-entry-item-name">{row.item.name}</span>
                            {row.item.category && (
                              <span className="stock-entry-item-cat">{row.item.category}</span>
                            )}
                            {row.item.trackExpiry && (
                              <span className="stock-entry-item-flag stock-entry-item-flag--expiry">Expiry</span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="stock-entry-td-batch">
                        <input
                          className="stock-entry-input stock-entry-input--batch"
                          type="text"
                          value={row.batchNo}
                          onChange={(e) => updateRow(row.rowId, "batchNo", e.target.value)}
                          placeholder="Auto"
                        />
                      </td>
                      <td className="stock-entry-td-qty">
                        {row.item.purchaseUnit && (
                          <div className="uom-toggle">
                            <button
                              type="button"
                              className={`uom-toggle-btn${row.enteredUnit === "base" ? " uom-toggle-btn--active" : ""}`}
                              onClick={() => setRows((prev) => prev.map((r) => r.rowId === row.rowId ? { ...r, enteredUnit: "base", qty: "" } : r))}
                            >
                              {row.item.unit}
                            </button>
                            <button
                              type="button"
                              className={`uom-toggle-btn${row.enteredUnit === "purchase" ? " uom-toggle-btn--active" : ""}`}
                              onClick={() => setRows((prev) => prev.map((r) => r.rowId === row.rowId ? { ...r, enteredUnit: "purchase", qty: "" } : r))}
                            >
                              {row.item.purchaseUnit}
                            </button>
                          </div>
                        )}
                        <input
                          className={`stock-entry-input ${qtyInvalid ? "stock-entry-input--error" : ""}`}
                          type="number"
                          min={0.01}
                          step="any"
                          placeholder="0"
                          value={row.qty}
                          onChange={(e) => updateRow(row.rowId, "qty", e.target.value)}
                        />
                        {row.enteredUnit === "purchase" && row.item.purchaseUnit && row.item.purchaseConversionFactor && row.qty && parseFloat(row.qty) > 0 && (
                          <div className="uom-hint">
                            = {fmtQty(parseFloat(row.qty) * row.item.purchaseConversionFactor)} {row.item.unit}
                          </div>
                        )}
                      </td>
                      <td className="stock-entry-td-cost">
                        <input
                          className="stock-entry-input"
                          type="number"
                          min={0}
                          step="any"
                          placeholder="0.00"
                          value={row.unitCost}
                          onChange={(e) => updateRow(row.rowId, "unitCost", e.target.value)}
                        />
                        {row.lastPrice !== null && !row.metaLoading && (
                          <span className={`stock-entry-last-price ${
                            row.unitCost && parseFloat(row.unitCost) > row.lastPrice
                              ? "stock-entry-last-price--up"
                              : row.unitCost && parseFloat(row.unitCost) < row.lastPrice
                                ? "stock-entry-last-price--down"
                                : ""
                          }`}>
                            Last: {formatCurrency(row.lastPrice, currency)}
                            {row.unitCost && parseFloat(row.unitCost) > row.lastPrice && " ↑"}
                            {row.unitCost && parseFloat(row.unitCost) < row.lastPrice && " ↓"}
                          </span>
                        )}
                        {row.metaLoading && <span className="stock-entry-last-price stock-entry-last-price--loading">Loading…</span>}
                      </td>
                      <td className="stock-entry-td-expiry">
                        {row.item.trackExpiry ? (
                          <input
                            className={`stock-entry-input ${expiryMissing ? "stock-entry-input--error" : ""}`}
                            type="date"
                            value={row.expiryDate}
                            onChange={(e) => updateRow(row.rowId, "expiryDate", e.target.value)}
                          />
                        ) : (
                          <span className="stock-entry-na">—</span>
                        )}
                      </td>
                      <td className="stock-entry-td-supplier">
                        <div className="stock-entry-supplier-wrap">
                          <select
                            className="stock-entry-select"
                            value={row.supplierId}
                            onChange={(e) => {
                              setRows((prev) => prev.map((r) => r.rowId === row.rowId ? { ...r, supplierId: e.target.value, suggested: false } : r));
                            }}
                          >
                            <option value="">No supplier</option>
                            {suppliers.map((s) => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                          {row.suggested && row.supplierId && (
                            <span className="stock-entry-suggested-badge" title="Auto-suggested from recent batches">Suggested</span>
                          )}
                        </div>
                      </td>
                      <td className="stock-entry-td-note">
                        <input
                          className="stock-entry-input"
                          type="text"
                          placeholder="Optional…"
                          value={row.note}
                          onChange={(e) => updateRow(row.rowId, "note", e.target.value)}
                        />
                      </td>
                      <td className="stock-entry-td-actions">
                        <button
                          type="button"
                          className="stock-entry-add-batch-btn"
                          onClick={() => addBatch(row.rowId)}
                          title="Add another batch for this item"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                          </svg>
                          <span>Batch</span>
                        </button>
                        <button
                          type="button"
                          className="stock-entry-remove-btn"
                          onClick={() => removeRow(row.rowId)}
                          aria-label={`Remove ${row.item.name} ${row.batchNo}`}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="stock-entry-footer">
            <div className="stock-entry-global-note">
              <label className="form-label">Session note <span className="form-label-hint">(applies to all batches)</span></label>
              <input
                className="form-input"
                type="text"
                placeholder="e.g. Morning delivery from Metro…"
                value={globalNote}
                onChange={(e) => setGlobalNote(e.target.value)}
              />
            </div>
            <div className="stock-entry-footer-actions">
              <button type="button" className="btn btn--ghost" onClick={clearAll} disabled={submitting}>
                Clear all
              </button>
              <button
                type="button"
                className="btn btn--stock-in"
                onClick={() => void handleSubmit()}
                disabled={submitting || rows.length === 0}
              >
                {submitting ? <span className="btn-spinner" /> : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{width:15,height:15}}>
                    <path d="M12 5v14M5 12l7 7 7-7" />
                  </svg>
                )}
                {submitting ? "Recording…" : `Record Receipt (${validRowCount} batch${validRowCount !== 1 ? "es" : ""})`}
              </button>
            </div>
          </div>
        </>
      ) : (
        !results && (
          <div className="stock-entry-empty">
            <div className="stock-entry-empty-icon stock-entry-empty-icon--in">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
            </div>
            <h3>No items added yet</h3>
            <p>Use the search above to find items and add them to this receiving entry.</p>
          </div>
        )
      )}
      </>
      )}
    </div>
  );
}
