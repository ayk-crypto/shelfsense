import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getItems } from "../api/items";
import { getStockSummary, stockOut } from "../api/stock";
import type { Item, StockSummaryItem } from "../types";

const REASONS = [
  { value: "kitchen_usage", label: "Kitchen Usage" },
  { value: "wastage", label: "Wastage" },
  { value: "manual_adjustment", label: "Manual Adjustment" },
  { value: "damaged", label: "Damaged" },
  { value: "expired", label: "Expired" },
  { value: "other", label: "Other" },
];

interface Row {
  rowId: string;
  item: Item;
  qty: string;
  reason: string;
  note: string;
  enteredUnit: "base" | "purchase";
}

function fmtQty(n: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(n);
}

interface RowResult {
  rowId: string;
  itemName: string;
  status: "success" | "error";
  error?: string;
}

export function StockOutPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [allItems, setAllItems] = useState<Item[]>([]);
  const [summaryMap, setSummaryMap] = useState<Map<string, StockSummaryItem>>(new Map());
  const [loadingItems, setLoadingItems] = useState(true);
  const [search, setSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [globalNote, setGlobalNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<RowResult[] | null>(null);
  const [touched, setTouched] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      try {
        const [itemsRes, summaryRes] = await Promise.all([getItems(), getStockSummary()]);
        const activeItems = itemsRes.items.filter((i) => i.isActive);
        setAllItems(activeItems);
        setSummaryMap(new Map(summaryRes.summary.map((s) => [s.itemId, s])));

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
          setRows([{
            rowId: crypto.randomUUID(),
            item: preselected,
            qty: "",
            reason: "kitchen_usage",
            note: "",
            enteredUnit: preselected.purchaseUnit ? "purchase" : "base",
          }]);
          setSearch("");
          setShowDropdown(false);

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

  const stagedIds = new Set(rows.map((r) => r.item.id));
  const filteredItems = allItems
    .filter((i) => !stagedIds.has(i.id))
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
    setRows((prev) => [
      ...prev,
      { rowId: crypto.randomUUID(), item, qty: "", reason: "kitchen_usage", note: "", enteredUnit: item.purchaseUnit ? "purchase" : "base" },
    ]);
    setSearch("");
    setShowDropdown(false);
    setResults(null);
    setTouched(false);
  }

  function removeRow(rowId: string) {
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));
  }

  function updateRow(rowId: string, field: keyof Omit<Row, "rowId" | "item">, value: string) {
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, [field]: value } : r)));
  }

  function clearAll() {
    setRows([]);
    setGlobalNote("");
    setResults(null);
    setTouched(false);
  }

  function isRowValid(row: Row) {
    const qty = parseFloat(row.qty);
    return !!(qty && qty > 0);
  }

  const validRowCount = rows.filter(isRowValid).length;

  function fmt(n: number) {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
  }

  async function handleSubmit() {
    setTouched(true);
    if (validRowCount === 0) return;

    setSubmitting(true);
    const out: RowResult[] = [];

    for (const row of rows) {
      if (!isRowValid(row)) {
        out.push({ rowId: row.rowId, itemName: row.item.name, status: "error", error: "Invalid quantity — skipped" });
        continue;
      }
      const enteredQty = parseFloat(row.qty);
      const isPurchaseUnit = row.enteredUnit === "purchase" && !!row.item.purchaseUnit && !!row.item.purchaseConversionFactor;
      const baseQty = isPurchaseUnit ? enteredQty * row.item.purchaseConversionFactor! : enteredQty;
      try {
        await stockOut({
          itemId: row.item.id,
          quantity: baseQty,
          reason: row.reason || undefined,
          note: [row.note.trim(), globalNote.trim()].filter(Boolean).join(" · ") || undefined,
          enteredQuantity: isPurchaseUnit ? enteredQty : undefined,
          enteredUnit: isPurchaseUnit ? row.item.purchaseUnit! : undefined,
        });
        out.push({ rowId: row.rowId, itemName: row.item.name, status: "success" });
      } catch (err) {
        out.push({
          rowId: row.rowId,
          itemName: row.item.name,
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
          <div className="stock-entry-type-badge stock-entry-type-badge--out">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M19 12l-7-7-7 7" />
            </svg>
            Stock Out
          </div>
          <h1 className="page-title">Record Stock Out</h1>
          <p className="page-subtitle">Deduct multiple items from stock at once — usage, wastage, adjustments, or any reason.</p>
        </div>
        {rows.length > 0 && (
          <div className="stock-entry-tally">
            <div className="stock-entry-tally-item">
              <span className="stock-entry-tally-num">{rows.length}</span>
              <span className="stock-entry-tally-label">staged</span>
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
                ? `All ${successCount} item${successCount !== 1 ? "s" : ""} deducted successfully`
                : `${successCount} of ${results.length} items deducted`}
            </div>
            {results.some((r) => r.status === "error") && (
              <ul className="stock-entry-results-errors">
                {results.filter((r) => r.status === "error").map((r) => (
                  <li key={r.rowId}><strong>{r.itemName}</strong>: {r.error}</li>
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
                  {search ? "No items match your search" : stagedIds.size === allItems.length ? "All items already added" : "Start typing to search"}
                </div>
              ) : (
                filteredItems.slice(0, 10).map((item) => {
                  const s = summaryMap.get(item.id);
                  return (
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
                        {s !== undefined ? ` · ${fmt(s.totalQuantity)} in stock` : ""}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {rows.length > 0 ? (
        <>
          <div className="stock-entry-table-wrap">
            <table className="stock-entry-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Unit</th>
                  <th>In Stock</th>
                  <th>Quantity <span className="stock-entry-th-req">*</span></th>
                  <th>Reason</th>
                  <th>Note</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const qty = parseFloat(row.qty);
                  const s = summaryMap.get(row.item.id);
                  const qtyInvalid = touched && (row.qty !== "" ? (isNaN(qty) || qty <= 0) : true);
                  const overStock = s !== undefined && qty > s.totalQuantity;
                  return (
                    <tr key={row.rowId} className={qtyInvalid ? "stock-entry-row--invalid" : overStock ? "stock-entry-row--warn" : ""}>
                      <td className="stock-entry-td-name">
                        <span className="stock-entry-item-name">{row.item.name}</span>
                        {row.item.category && (
                          <span className="stock-entry-item-cat">{row.item.category}</span>
                        )}
                      </td>
                      <td className="stock-entry-td-unit">
                        {row.item.unit}
                        {row.item.purchaseUnit && (
                          <span className="stock-entry-unit-sub">&nbsp;/{row.item.purchaseUnit}</span>
                        )}
                      </td>
                      <td className="stock-entry-td-stock">
                        {s !== undefined ? (
                          <>
                            <span className={`stock-entry-stock-chip ${s.isLowStock ? "stock-entry-stock-chip--low" : ""}`}>
                              {fmt(s.totalQuantity)}
                            </span>
                            {row.item.displayBothUnits && row.item.purchaseUnit && row.item.purchaseConversionFactor && s.totalQuantity > 0 && (
                              <span className="qty-dual">
                                {fmtQty(s.totalQuantity / row.item.purchaseConversionFactor)} {row.item.purchaseUnit}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="stock-entry-na">—</span>
                        )}
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
                          className={`stock-entry-input ${qtyInvalid ? "stock-entry-input--error" : overStock ? "stock-entry-input--warn" : ""}`}
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
                      <td className="stock-entry-td-reason">
                        <select
                          className="stock-entry-select"
                          value={row.reason}
                          onChange={(e) => updateRow(row.rowId, "reason", e.target.value)}
                        >
                          {REASONS.map((r) => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
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
                      <td className="stock-entry-td-remove">
                        <button
                          type="button"
                          className="stock-entry-remove-btn"
                          onClick={() => removeRow(row.rowId)}
                          aria-label={`Remove ${row.item.name}`}
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
              <label className="form-label">Batch note <span className="form-label-hint">(applies to all items)</span></label>
              <input
                className="form-input"
                type="text"
                placeholder="e.g. End of day count, Shift handover…"
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
                className="btn btn--stock-out"
                onClick={() => void handleSubmit()}
                disabled={submitting || rows.length === 0}
              >
                {submitting ? <span className="btn-spinner" /> : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{width:15,height:15}}>
                    <path d="M12 19V5M19 12l-7-7-7 7" />
                  </svg>
                )}
                {submitting ? "Recording…" : `Record Stock Out (${validRowCount})`}
              </button>
            </div>
          </div>
        </>
      ) : (
        !results && (
          <div className="stock-entry-empty">
            <div className="stock-entry-empty-icon stock-entry-empty-icon--out">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M19 12l-7-7-7 7" />
              </svg>
            </div>
            <h3>No items added yet</h3>
            <p>Use the search above to find items and add them to this stock-out entry.</p>
          </div>
        )
      )}
    </div>
  );
}
