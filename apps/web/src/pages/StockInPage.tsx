import { useEffect, useRef, useState } from "react";
import { getItems } from "../api/items";
import { getPriceHistory, getSupplierSuggestion, stockIn } from "../api/stock";
import { getSuppliers } from "../api/suppliers";
import { useWorkspaceSettings } from "../context/WorkspaceSettingsContext";
import type { Item, Supplier } from "../types";
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

function generateBatchNo(rows: BatchRow[], itemId: string): string {
  const d = new Date();
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, "");
  const count = rows.filter((r) => r.item.id === itemId).length + 1;
  return `B${ymd}-${String(count).padStart(3, "0")}`;
}

export function StockInPage() {
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

  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      try {
        const [itemsRes, suppliersRes] = await Promise.all([getItems(), getSuppliers()]);
        setAllItems(itemsRes.items.filter((i) => i.isActive));
        setSuppliers(suppliersRes.suppliers);
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
            Stock In
          </div>
          <h1 className="page-title">Record Stock In</h1>
          <p className="page-subtitle">Add items to stock with batch numbers, costs, expiry dates, and supplier info. Use <strong>+ Add batch</strong> on any row to record multiple batches for the same item.</p>
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
                {submitting ? "Recording…" : `Record Stock In (${validRowCount} batch${validRowCount !== 1 ? "es" : ""})`}
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
            <p>Use the search above to find items and add them to this stock-in entry.</p>
          </div>
        )
      )}
    </div>
  );
}
