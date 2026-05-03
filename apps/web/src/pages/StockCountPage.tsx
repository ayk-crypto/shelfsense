import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  createStockCount,
  finalizeStockCount,
  getStockCount,
  getStockCounts,
  getStockCountStock,
  updateStockCount,
} from "../api/stockCounts";
import { useAuth } from "../context/AuthContext";
import { useLocation } from "../context/LocationContext";
import type { StockCount, StockCountStockItem } from "../types";

interface CountLine {
  itemId: string;
  physicalQuantity: string;
}

export function StockCountPage() {
  const { id } = useParams();

  if (id) {
    return <StockCountDetail id={id} />;
  }

  return <StockCountWorkspace />;
}

function StockCountWorkspace() {
  const { user } = useAuth();
  const { locations, activeLocationId } = useLocation();
  const navigate = useNavigate();
  const canFinalize = user?.role === "OWNER" || user?.role === "MANAGER";
  const [selectedLocationId, setSelectedLocationId] = useState(activeLocationId);
  const [stockItems, setStockItems] = useState<StockCountStockItem[]>([]);
  const [counts, setCounts] = useState<StockCountSummary[]>([]);
  const [lines, setLines] = useState<CountLine[]>([]);
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedLocationId && activeLocationId) setSelectedLocationId(activeLocationId);
  }, [activeLocationId, selectedLocationId]);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      if (!selectedLocationId) return;
      setLoading(true);
      try {
        const [stockRes, countsRes] = await Promise.all([
          getStockCountStock(selectedLocationId),
          getStockCounts(),
        ]);
        if (!cancelled) {
          setStockItems(stockRes.items);
          setCounts(countsRes.counts);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load stock count data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadData();
    return () => {
      cancelled = true;
    };
  }, [selectedLocationId]);

  const itemById = useMemo(
    () => new Map(stockItems.map((item) => [item.id, item])),
    [stockItems],
  );

  const selectedItemIds = useMemo(() => new Set(lines.map((line) => line.itemId)), [lines]);
  const filteredItems = useMemo(() => {
    const term = query.trim().toLowerCase();
    return stockItems
      .filter((item) => !selectedItemIds.has(item.id))
      .filter((item) => {
        if (!term) return true;
        return [item.name, item.sku, item.barcode, item.category]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(term));
      })
      .slice(0, 8);
  }, [query, selectedItemIds, stockItems]);

  const countedLines = lines.map((line) => {
    const item = itemById.get(line.itemId);
    const physicalQuantity = parseQuantity(line.physicalQuantity);
    const systemQuantity = item?.systemQuantity ?? 0;
    const variance = physicalQuantity - systemQuantity;
    return { ...line, item, physicalQuantity, systemQuantity, variance };
  });

  const totalVariance = countedLines.reduce((total, line) => total + line.variance, 0);
  const nonZeroVarianceCount = countedLines.filter((line) => roundQuantity(line.variance) !== 0).length;

  function addItem(item: StockCountStockItem) {
    setLines((current) => [
      ...current,
      { itemId: item.id, physicalQuantity: formatQuantity(item.systemQuantity) },
    ]);
    setQuery("");
    setMessage(null);
  }

  function updateLine(itemId: string, physicalQuantity: string) {
    setLines((current) =>
      current.map((line) => line.itemId === itemId ? { ...line, physicalQuantity } : line),
    );
  }

  function removeLine(itemId: string) {
    setLines((current) => current.filter((line) => line.itemId !== itemId));
  }

  async function handleSaveDraft(e?: FormEvent) {
    e?.preventDefault();
    if (!selectedLocationId || saving) return;

    const payloadItems = countedLines
      .filter((line) => line.item)
      .map((line) => ({
        itemId: line.itemId,
        physicalQuantity: roundQuantity(line.physicalQuantity),
      }));

    if (payloadItems.length === 0) {
      setError("Add at least one item before saving a draft.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = draftId
        ? await updateStockCount(draftId, {
            locationId: selectedLocationId,
            note: note.trim() || null,
            items: payloadItems,
          })
        : await createStockCount({
            locationId: selectedLocationId,
            note: note.trim() || null,
            items: payloadItems,
          });
      setDraftId(res.count.id);
      setLines(res.count.items.map((item) => ({
        itemId: item.itemId,
        physicalQuantity: formatQuantity(item.physicalQuantity),
      })));
      setCounts((await getStockCounts()).counts);
      setMessage("Draft saved. Managers and owners can finalize when the count is reviewed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save stock count");
    } finally {
      setSaving(false);
    }
  }

  async function handleFinalize() {
    if (!draftId || finalizing || !canFinalize) return;
    setFinalizing(true);
    setError(null);
    try {
      await finalizeStockCount(draftId);
      setMessage("Stock count finalized and adjustment movements posted.");
      setDraftId(null);
      setLines([]);
      const [stockRes, countsRes] = await Promise.all([
        getStockCountStock(selectedLocationId),
        getStockCounts(),
      ]);
      setStockItems(stockRes.items);
      setCounts(countsRes.counts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to finalize stock count");
    } finally {
      setFinalizing(false);
    }
  }

  return (
    <div className="stock-count-page">
      <section className="stock-count-hero">
        <div>
          <span className="daily-ops-kicker">Cycle Count</span>
          <h1 className="page-title">Count stock and post variance adjustments</h1>
          <p className="page-subtitle">
            Select a branch, add items, enter the physical count, then save a draft or finalize after review.
          </p>
        </div>
        <div className="stock-count-summary-strip" aria-label="Current count summary">
          <Metric label="Lines" value={String(lines.length)} />
          <Metric label="Variances" value={String(nonZeroVarianceCount)} />
          <Metric label="Net" value={formatSigned(totalVariance)} tone={varianceTone(totalVariance)} />
        </div>
      </section>

      {error && <div className="alert alert--error">{error}</div>}
      {message && <div className="alert alert--success">{message}</div>}

      <form className="stock-count-workspace" onSubmit={handleSaveDraft}>
        <section className="stock-count-panel stock-count-panel--setup">
          <div className="stock-count-panel-head">
            <div>
              <h2>Count setup</h2>
              <p>Counts are saved against one branch/location.</p>
            </div>
            {draftId && <span className="stock-count-status stock-count-status--draft">Draft saved</span>}
          </div>

          <label className="form-field">
            <span>Location / branch</span>
            <select
              value={selectedLocationId}
              onChange={(e) => {
                setSelectedLocationId(e.target.value);
                setLines([]);
                setDraftId(null);
                setMessage(null);
              }}
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span>Count note</span>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Evening freezer count, weekly dry-store cycle count..."
            />
          </label>

          <div className="stock-count-search">
            <label className="form-field">
              <span>Search inventory items</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, SKU, barcode, category..."
              />
            </label>
            <div className="stock-count-search-results">
              {loading ? (
                <p>Loading item stock...</p>
              ) : filteredItems.length === 0 ? (
                <p>No matching items to add.</p>
              ) : (
                filteredItems.map((item) => (
                  <button key={item.id} type="button" onClick={() => addItem(item)}>
                    <span>
                      <strong>{item.name}</strong>
                      <em>{item.sku || item.barcode || item.category || "Inventory item"}</em>
                    </span>
                    <span>{formatQuantity(item.systemQuantity)} {item.unit}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="stock-count-panel stock-count-panel--lines">
          <div className="stock-count-panel-head">
            <div>
              <h2>Counted items</h2>
              <p>Physical count minus system quantity becomes the variance.</p>
            </div>
            <div className="stock-count-actions">
              <button type="submit" className="btn btn--secondary" disabled={saving || lines.length === 0}>
                {saving ? "Saving..." : draftId ? "Update Draft" : "Save Draft"}
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={!draftId || !canFinalize || finalizing}
                onClick={handleFinalize}
                title={canFinalize ? undefined : "Only managers and owners can finalize stock counts"}
              >
                {finalizing ? "Finalizing..." : "Finalize Count"}
              </button>
            </div>
          </div>

          {countedLines.length === 0 ? (
            <div className="stock-count-empty-state">
              <strong>No items selected yet</strong>
              <span>Add items from the search panel to start counting this branch.</span>
            </div>
          ) : (
            <div className="stock-count-line-list">
              {countedLines.map((line) => (
                <article key={line.itemId} className="stock-count-line">
                  <div className="stock-count-line-main">
                    <strong>{line.item?.name ?? "Unknown item"}</strong>
                    <span>System: {formatQuantity(line.systemQuantity)} {line.item?.unit}</span>
                  </div>
                  <label>
                    <span>Physical</span>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      value={line.physicalQuantity}
                      onChange={(e) => updateLine(line.itemId, e.target.value)}
                    />
                  </label>
                  <VarianceBadge value={line.variance} unit={line.item?.unit ?? ""} />
                  <button type="button" className="icon-btn" onClick={() => removeLine(line.itemId)} aria-label="Remove item">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </form>

      <StockCountHistory
        counts={counts}
        onOpen={(countId) => navigate(`/stock-count/${countId}`)}
      />
    </div>
  );
}

function StockCountDetail({ id }: { id: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canFinalize = user?.role === "OWNER" || user?.role === "MANAGER";
  const [count, setCount] = useState<StockCount | null>(null);
  const [loading, setLoading] = useState(true);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadCount() {
      setLoading(true);
      try {
        const res = await getStockCount(id);
        if (!cancelled) {
          setCount(res.count);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load stock count");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadCount();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleFinalize() {
    if (!count || !canFinalize || finalizing) return;
    setFinalizing(true);
    setError(null);
    try {
      const res = await finalizeStockCount(count.id);
      setCount(res.count);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to finalize stock count");
    } finally {
      setFinalizing(false);
    }
  }

  if (loading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Loading stock count...</p>
      </div>
    );
  }

  if (error || !count) {
    return (
      <div className="page-error">
        <div className="alert alert--error">{error ?? "Stock count not found"}</div>
      </div>
    );
  }

  const totalVariance = count.items.reduce((total, item) => total + item.variance, 0);

  return (
    <div className="stock-count-page">
      <section className="stock-count-hero">
        <div>
          <span className="daily-ops-kicker">Stock Count Detail</span>
          <h1 className="page-title">{count.location.name} count</h1>
          <p className="page-subtitle">
            Created by {count.createdBy.name} on {formatDateTime(count.createdAt)}.
          </p>
        </div>
        <div className="stock-count-detail-actions">
          <span className={`stock-count-status stock-count-status--${count.status.toLowerCase()}`}>
            {formatStatus(count.status)}
          </span>
          <button type="button" className="btn btn--secondary" onClick={() => navigate("/stock-count")}>Back to Counts</button>
          {count.status === "DRAFT" && (
            <button
              type="button"
              className="btn btn--primary"
              disabled={!canFinalize || finalizing}
              onClick={handleFinalize}
            >
              {finalizing ? "Finalizing..." : "Finalize Count"}
            </button>
          )}
        </div>
      </section>

      <section className="stock-count-detail-grid">
        <DetailStat label="Location" value={count.location.name} />
        <DetailStat label="Created by" value={count.createdBy.name} />
        <DetailStat label="Status" value={formatStatus(count.status)} />
        <DetailStat label="Net variance" value={formatSigned(totalVariance)} tone={varianceTone(totalVariance)} />
        <DetailStat label="Finalized by" value={count.finalizedBy?.name ?? "Not finalized"} />
        <DetailStat label="Finalized date" value={count.finalizedAt ? formatDateTime(count.finalizedAt) : "Not finalized"} />
      </section>

      {count.note && (
        <section className="stock-count-panel">
          <div className="stock-count-panel-head">
            <div>
              <h2>Count note</h2>
              <p>{count.note}</p>
            </div>
          </div>
        </section>
      )}

      <section className="stock-count-panel">
        <div className="stock-count-panel-head">
          <div>
            <h2>Counted items</h2>
            <p>{count.items.length} items counted in this cycle count.</p>
          </div>
        </div>
        <div className="stock-count-detail-table-wrap">
          <table className="stock-count-detail-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>System</th>
                <th>Physical</th>
                <th>Variance</th>
              </tr>
            </thead>
            <tbody>
              {count.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.itemName}</strong>
                    <span>{item.unit}</span>
                  </td>
                  <td>{formatQuantity(item.systemQuantity)}</td>
                  <td>{formatQuantity(item.physicalQuantity)}</td>
                  <td><VarianceBadge value={item.variance} unit={item.unit} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

type StockCountSummary = Awaited<ReturnType<typeof getStockCounts>>["counts"][number];

function StockCountHistory({
  counts,
  onOpen,
}: {
  counts: StockCountSummary[];
  onOpen: (id: string) => void;
}) {
  return (
    <section className="stock-count-panel">
      <div className="stock-count-panel-head">
        <div>
          <h2>Stock Count History</h2>
          <p>Review drafts and finalized cycle counts.</p>
        </div>
      </div>
      {counts.length === 0 ? (
        <div className="stock-count-empty-state">
          <strong>No stock counts yet</strong>
          <span>Saved drafts and finalized counts will appear here.</span>
        </div>
      ) : (
        <div className="stock-count-history-list">
          {counts.map((count) => {
            const varianceTotal = count.items.reduce((total, item) => total + item.variance, 0);
            return (
              <button key={count.id} type="button" onClick={() => onOpen(count.id)}>
                <span>
                  <strong>{count.location.name}</strong>
                  <em>{count.createdBy.name} - {formatDateTime(count.createdAt)}</em>
                </span>
                <span className={`stock-count-status stock-count-status--${count.status.toLowerCase()}`}>
                  {formatStatus(count.status)}
                </span>
                <span className={`stock-count-history-variance stock-count-history-variance--${varianceTone(varianceTotal)}`}>
                  {formatSigned(varianceTotal)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "positive" | "negative" | "zero" | "neutral" }) {
  return (
    <div className={`stock-count-metric stock-count-metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DetailStat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "positive" | "negative" | "zero" | "neutral" }) {
  return (
    <div className={`stock-count-detail-stat stock-count-detail-stat--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function VarianceBadge({ value, unit }: { value: number; unit: string }) {
  const rounded = roundQuantity(value);
  const tone = varianceTone(rounded);
  return (
    <span className={`stock-count-variance stock-count-variance--${tone}`}>
      {formatSigned(rounded)} {unit}
    </span>
  );
}

function parseQuantity(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function formatQuantity(value: number) {
  const rounded = roundQuantity(value);
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function formatSigned(value: number) {
  const rounded = roundQuantity(value);
  if (rounded > 0) return `+${formatQuantity(rounded)}`;
  if (rounded < 0) return formatQuantity(rounded);
  return "0";
}

function varianceTone(value: number): "positive" | "negative" | "zero" {
  const rounded = roundQuantity(value);
  if (rounded > 0) return "positive";
  if (rounded < 0) return "negative";
  return "zero";
}

function formatStatus(status: StockCount["status"]) {
  return status === "FINALIZED" ? "Finalized" : "Draft";
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
