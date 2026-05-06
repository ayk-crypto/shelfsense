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
  const [poReceiveLines, setPoReceiveLines] = useState<PoReceiveLineDraft[]>([]);
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
    if (!po) { setPoReceiveLines([]); return; }
    setPoReceiveLines(
      po.purchaseItems
        .filter((item) => item.remainingQuantity > 0)
        .map((item) => ({
          purchaseItemId: item.id,
          itemName: item.item.name,
          itemUnit: item.item.unit,
          remainingQty: item.remainingQuantity,
          trackExpiry: item.item.trackExpiry,
          receivedQuantity: String(item.remainingQuantity),
          locationId: defaultLocationId || (locations[0]?.id ?? ""),
          expiryDate: "",
          batchNo: "",
          unitCost: String(item.unitCost),
          notes: "",
        }))
    );
  }

  function updatePoLine(purchaseItemId: string, patch: Partial<PoReceiveLineDraft>) {
    setPoReceiveLines((prev) => prev.map((l) => l.purchaseItemId === purchaseItemId ? { ...l, ...patch } : l));
  }

  async function handlePoReceiveSubmit() {
    if (!selectedPo) return;
    const validLines = poReceiveLines.filter((l) => (parseFloat(l.receivedQuantity) || 0) > 0);
    if (validLines.length === 0) {
      setPoResult({ type: "error", msg: "Enter at least one received quantity." });
      return;
    }
    setPoSubmitting(true);
    setPoResult(null);
    try {
      await receivePurchase(selectedPo.id, {
        lines: validLines.map((l) => ({
          purchaseItemId: l.purchaseItemId,
          receivedQuantity: parseFloat(l.receivedQuantity),
          locationId: l.locationId || undefined,
          expiryDate: l.expiryDate || undefined,
          batchNo: l.batchNo || undefined,
          unitCost: parseFloat(l.unitCost) || undefined,
          notes: l.notes || undefined,
        })),
      });
      setPoResult({ type: "success", msg: "Receipt confirmed. Stock has been updated." });
      const res = await getOpenPurchases();
      setOpenPOs(res.purchases);
      setSelectedPoId("");
      setSelectedPo(null);
      setPoReceiveLines([]);
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
      try {
        await stockIn({
          itemId: row.item.id,
          quantity: parseFloat(row.qty),
          unitCost: row.unitCost ? parseFloat(row.unitCost) : undefined,
          expiryDate: row.expiryDate || undefined,
          batchNo: row.batchNo || undefined,
          supplierId: row.supplierId || undefined,
          supplierName: selectedSupplier?.name,
          note: [row.note.trim(), globalNote.trim()].filter(Boolean).join(" · ") || undefined,
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
              {selectedPo && poReceiveLines.length > 0 && (
                <div className="po-receive-form">
                  <div className="po-receive-summary">
                    <span><strong>{selectedPo.supplier.name}</strong></span>
                    <span>Ordered: {selectedPo.orderedQuantity}</span>
                    <span>Received so far: {selectedPo.receivedQuantity}</span>
                    <span>Remaining: <strong>{selectedPo.remainingQuantity}</strong></span>
                  </div>
                  <div className="purchase-line receive-line receive-line--header">
                    <span>Item</span><span>Remaining</span><span>Receive qty</span><span>Branch</span><span>Expiry</span><span>Batch</span><span>Unit cost</span><span>Notes</span>
                  </div>
                  {poReceiveLines.map((line) => (
                    <div key={line.purchaseItemId} className="purchase-line receive-line">
                      <span className="td-name">{line.itemName} <span className="td-unit">/ {line.itemUnit}</span></span>
                      <span>{line.remainingQty}</span>
                      <input className="form-input" type="number" min="0" max={line.remainingQty} step="0.01" value={line.receivedQuantity} onChange={(e) => updatePoLine(line.purchaseItemId, { receivedQuantity: e.target.value })} />
                      <select className="form-input form-select" value={line.locationId} onChange={(e) => updatePoLine(line.purchaseItemId, { locationId: e.target.value })}>
                        {locations.map((loc) => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
                      </select>
                      {line.trackExpiry ? (
                        <input className="form-input" type="date" value={line.expiryDate} onChange={(e) => updatePoLine(line.purchaseItemId, { expiryDate: e.target.value })} />
                      ) : (
                        <span className="stock-entry-na">—</span>
                      )}
                      <input className="form-input" value={line.batchNo} onChange={(e) => updatePoLine(line.purchaseItemId, { batchNo: e.target.value })} placeholder="Optional" />
                      <input className="form-input" type="number" min="0" step="0.01" value={line.unitCost} onChange={(e) => updatePoLine(line.purchaseItemId, { unitCost: e.target.value })} />
                      <input className="form-input" value={line.notes} onChange={(e) => updatePoLine(line.purchaseItemId, { notes: e.target.value })} placeholder="Optional" />
                    </div>
                  ))}
                  <p className="purchase-receive-hint">Stock batches are created only when you confirm receipt below.</p>
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
                        <input
                          className={`stock-entry-input ${qtyInvalid ? "stock-entry-input--error" : ""}`}
                          type="number"
                          min={0.01}
                          step="any"
                          placeholder="0"
                          value={row.qty}
                          onChange={(e) => updateRow(row.rowId, "qty", e.target.value)}
                        />
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
