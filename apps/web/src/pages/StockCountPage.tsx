import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  createStockCount,
  finalizeStockCount,
  getStockCount,
  getStockCounts,
  getStockCountStock,
  rejectStockCount,
  returnForRecount,
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
  if (id) return <StockCountDetail id={id} />;
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
  const [actioning, setActioning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [managerActionType, setManagerActionType] = useState<"return" | "reject" | null>(null);
  const [managerComment, setManagerComment] = useState("");

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
    return () => { cancelled = true; };
  }, [selectedLocationId]);

  const itemById = useMemo(
    () => new Map(stockItems.map((item) => [item.id, item])),
    [stockItems],
  );
  const selectedItemIds = useMemo(() => new Set(lines.map((l) => l.itemId)), [lines]);
  const filteredItems = useMemo(() => {
    const term = query.trim().toLowerCase();
    return stockItems
      .filter((item) => !selectedItemIds.has(item.id))
      .filter((item) => {
        if (!term) return true;
        return [item.name, item.sku, item.barcode, item.category]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(term));
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

  const totalVariance = countedLines.reduce((t, l) => t + l.variance, 0);
  const nonZeroVarianceCount = countedLines.filter((l) => roundQuantity(l.variance) !== 0).length;
  const affectedItems = countedLines
    .filter((l): l is typeof l & { item: StockCountStockItem } => l.item !== undefined && roundQuantity(l.variance) !== 0);

  function addItem(item: StockCountStockItem) {
    setLines((cur) => [...cur, { itemId: item.id, physicalQuantity: formatQuantity(item.systemQuantity) }]);
    setQuery("");
    setMessage(null);
  }

  function updateLine(itemId: string, physicalQuantity: string) {
    setLines((cur) => cur.map((l) => l.itemId === itemId ? { ...l, physicalQuantity } : l));
  }

  function removeLine(itemId: string) {
    setLines((cur) => cur.filter((l) => l.itemId !== itemId));
  }

  async function handleSaveDraft(e?: FormEvent) {
    e?.preventDefault();
    if (!selectedLocationId || saving) return;
    const payloadItems = countedLines
      .filter((l) => l.item)
      .map((l) => ({ itemId: l.itemId, physicalQuantity: roundQuantity(l.physicalQuantity) }));
    if (payloadItems.length === 0) { setError("Add at least one item before saving a draft."); return; }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = draftId
        ? await updateStockCount(draftId, { locationId: selectedLocationId, note: note.trim() || null, items: payloadItems })
        : await createStockCount({ locationId: selectedLocationId, note: note.trim() || null, items: payloadItems });
      setDraftId(res.count.id);
      setLines(res.count.items.map((item) => ({ itemId: item.itemId, physicalQuantity: formatQuantity(item.physicalQuantity) })));
      setCounts((await getStockCounts()).counts);
      setMessage("Draft saved. Managers and owners can approve when the count is reviewed.");
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
    setMessage(null);
    try {
      await finalizeStockCount(draftId);
      setMessage("Stock count approved and adjustment movements posted.");
      setDraftId(null);
      setLines([]);
      const [stockRes, countsRes] = await Promise.all([
        getStockCountStock(selectedLocationId),
        getStockCounts(),
      ]);
      setStockItems(stockRes.items);
      setCounts(countsRes.counts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve stock count");
    } finally {
      setFinalizing(false);
    }
  }

  async function handleManagerAction() {
    if (!draftId || actioning || !canFinalize || !managerActionType) return;
    setActioning(true);
    setError(null);
    setMessage(null);
    try {
      if (managerActionType === "return") {
        await returnForRecount(draftId, managerComment.trim() || undefined);
        setMessage("Count returned for recount. The team can now re-submit a corrected count.");
      } else {
        await rejectStockCount(draftId, managerComment.trim() || undefined);
        setMessage("Count rejected.");
      }
      setDraftId(null);
      setLines([]);
      setManagerActionType(null);
      setManagerComment("");
      setCounts((await getStockCounts()).counts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to perform manager action");
    } finally {
      setActioning(false);
    }
  }

  return (
    <div className="stock-count-page">
      <div className="sc-header">
        <div className="sc-header-left">
          <span className="daily-ops-kicker">Physical Count</span>
          <h1 className="page-title">Physical Inventory Count</h1>
          <p className="page-subtitle">Select a location, add items, enter physical counts, then save a draft or approve to post adjustments.</p>
        </div>
        <div className="sc-metrics">
          <ScMetric label="Lines" value={String(lines.length)} />
          <ScMetric label="Variances" value={String(nonZeroVarianceCount)} tone={nonZeroVarianceCount > 0 ? "negative" : "zero"} />
          <ScMetric label="Net" value={formatSigned(totalVariance)} tone={varianceTone(totalVariance)} />
        </div>
      </div>

      {error && (
        <div className="alert alert--error" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </div>
      )}
      {message && (
        <div className="alert alert--success" role="status">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {message}
        </div>
      )}

      <form className="sc-workspace" onSubmit={handleSaveDraft}>
        <aside className="sc-panel sc-panel--setup">
          <div className="sc-panel-head">
            <div>
              <h2 className="sc-panel-title">Count setup</h2>
              <p className="sc-panel-sub">Counts are saved against one branch/location.</p>
            </div>
            {draftId && (
              <span className="stock-count-status stock-count-status--draft">
                <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true"><circle cx="4" cy="4" r="4" /></svg>
                Draft saved
              </span>
            )}
          </div>

          <div className="sc-setup-fields">
            <div className="form-group">
              <label className="form-label" htmlFor="sc-location">Location / branch</label>
              <select
                id="sc-location"
                className="form-select"
                value={selectedLocationId}
                onChange={(e) => {
                  setSelectedLocationId(e.target.value);
                  setLines([]);
                  setDraftId(null);
                  setMessage(null);
                }}
              >
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="sc-note">Count note <span className="form-label-opt">(optional)</span></label>
              <textarea
                id="sc-note"
                className="form-input sc-note-textarea"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Evening freezer count, weekly dry-store cycle count…"
              />
            </div>
          </div>

          <div className="sc-search-section">
            <div className="form-group">
              <label className="form-label" htmlFor="sc-search">Add items to count</label>
              <div className="sc-search-input-wrap">
                <svg className="sc-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                </svg>
                <input
                  id="sc-search"
                  className="form-input sc-search-input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name, SKU, barcode, category…"
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="sc-search-results">
              {loading ? (
                <div className="sc-search-hint">
                  <span className="btn-spinner btn-spinner--xs" />
                  Loading items…
                </div>
              ) : query.trim() === "" ? (
                <div className="sc-search-hint">Start typing to search items</div>
              ) : filteredItems.length === 0 ? (
                <div className="sc-search-hint">No matching items found</div>
              ) : (
                filteredItems.map((item) => (
                  <button key={item.id} type="button" className="sc-item-result" onClick={() => addItem(item)}>
                    <div className="sc-item-result-info">
                      <strong className="sc-item-result-name">{item.name}</strong>
                      <span className="sc-item-result-meta">
                        {[item.category, item.sku].filter(Boolean).join(" · ") || "Inventory item"}
                      </span>
                    </div>
                    <div className="sc-item-result-right">
                      <span className="sc-item-result-qty">{formatQuantity(item.systemQuantity)} {item.unit}</span>
                      <svg className="sc-item-result-add" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" /><path d="M12 8v8M8 12h8" />
                      </svg>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </aside>

        <section className="sc-panel sc-panel--lines">
          <div className="sc-panel-head">
            <div>
              <h2 className="sc-panel-title">Counted items</h2>
              <p className="sc-panel-sub">
                {countedLines.length === 0
                  ? "Add items from the search panel to start this count."
                  : `${countedLines.length} item${countedLines.length === 1 ? "" : "s"} added — physical count minus system quantity becomes the variance.`}
              </p>
            </div>
            <div className="sc-panel-actions">
              <button
                type="submit"
                className="btn btn--secondary btn--sm"
                disabled={saving || lines.length === 0}
              >
                {saving ? <><span className="btn-spinner btn-spinner--xs" /> Saving…</> : draftId ? "Update Draft" : "Save Draft"}
              </button>
              {draftId && canFinalize && (
                <>
                  <button
                    type="button"
                    className="btn btn--warning btn--sm"
                    disabled={actioning}
                    onClick={() => { setManagerActionType("return"); setManagerComment(""); }}
                    title="Return this count for the operator to recount"
                  >
                    Return for Recount
                  </button>
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    disabled={actioning}
                    onClick={() => { setManagerActionType("reject"); setManagerComment(""); }}
                    title="Reject this count — no adjustments will be made"
                  >
                    Reject Count
                  </button>
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={finalizing}
                    onClick={() => setShowApproveConfirm(true)}
                  >
                    {finalizing ? <><span className="btn-spinner btn-spinner--xs" /> Approving…</> : "Approve & Adjust Stock"}
                  </button>
                </>
              )}
            </div>
          </div>

          {countedLines.length === 0 ? (
            <div className="sc-empty">
              <svg className="sc-empty-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
              <p className="sc-empty-title">No items added yet</p>
              <p className="sc-empty-sub">Search for items on the left to add them to this cycle count.</p>
            </div>
          ) : (
            <div className="sc-line-list">
              <div className="sc-line-header">
                <span>Item</span>
                <span>System qty</span>
                <span>Physical count</span>
                <span>Variance</span>
                <span />
              </div>
              {countedLines.map((line) => (
                <div key={line.itemId} className="sc-line">
                  <div className="sc-line-info">
                    <strong className="sc-line-name">{line.item?.name ?? "Unknown item"}</strong>
                    <span className="sc-line-unit">{line.item?.category ?? line.item?.unit ?? ""}</span>
                  </div>
                  <div className="sc-line-system">
                    <span className="sc-line-system-val">{formatQuantity(line.systemQuantity)}</span>
                    <span className="sc-line-system-unit">{line.item?.unit}</span>
                  </div>
                  <div className="sc-line-physical">
                    <input
                      className="form-input sc-line-input"
                      type="number"
                      min="0"
                      step="0.001"
                      value={line.physicalQuantity}
                      onChange={(e) => updateLine(line.itemId, e.target.value)}
                      aria-label={`Physical quantity for ${line.item?.name}`}
                    />
                  </div>
                  <VarianceBadge value={line.variance} unit={line.item?.unit ?? ""} />
                  <button
                    type="button"
                    className="sc-line-remove"
                    onClick={() => removeLine(line.itemId)}
                    aria-label={`Remove ${line.item?.name}`}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </form>

      <StockCountHistory counts={counts} onOpen={(id) => navigate(`/stock-count/${id}`)} />

      {showApproveConfirm && (
        <ApprovalConfirmModal
          affectedItems={affectedItems}
          onConfirm={() => { setShowApproveConfirm(false); void handleFinalize(); }}
          onCancel={() => setShowApproveConfirm(false)}
          loading={finalizing}
        />
      )}

      {managerActionType && (
        <ManagerActionDialog
          type={managerActionType}
          comment={managerComment}
          onCommentChange={setManagerComment}
          onConfirm={() => { void handleManagerAction(); }}
          onCancel={() => { setManagerActionType(null); setManagerComment(""); }}
          loading={actioning}
        />
      )}
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
  const [actioning, setActioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showApproveConfirm, setShowApproveConfirm] = useState(false);
  const [managerActionType, setManagerActionType] = useState<"return" | "reject" | null>(null);
  const [managerComment, setManagerComment] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadCount() {
      setLoading(true);
      try {
        const res = await getStockCount(id);
        if (!cancelled) { setCount(res.count); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load stock count");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadCount();
    return () => { cancelled = true; };
  }, [id]);

  async function handleFinalize() {
    if (!count || !canFinalize || finalizing) return;
    setFinalizing(true);
    setError(null);
    try {
      const res = await finalizeStockCount(count.id);
      setCount(res.count);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve stock count");
    } finally {
      setFinalizing(false);
    }
  }

  async function handleManagerAction() {
    if (!count || !canFinalize || actioning || !managerActionType) return;
    setActioning(true);
    setError(null);
    try {
      let res;
      if (managerActionType === "return") {
        res = await returnForRecount(count.id, managerComment.trim() || undefined);
      } else {
        res = await rejectStockCount(count.id, managerComment.trim() || undefined);
      }
      setCount(res.count);
      setManagerActionType(null);
      setManagerComment("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to perform manager action");
    } finally {
      setActioning(false);
    }
  }

  if (loading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Loading stock count…</p>
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

  const totalVariance = count.items.reduce((t, item) => t + item.variance, 0);
  const affectedItems = count.items.filter((item) => roundQuantity(item.variance) !== 0).map((item) => ({
    item: { name: item.itemName },
    physicalQuantity: item.physicalQuantity,
    systemQuantity: item.systemQuantity,
    variance: item.variance,
    itemId: item.itemId,
  }));
  const isDraft = count.status === "DRAFT";
  const isReturned = count.status === "RETURNED";
  const isRejected = count.status === "REJECTED";

  return (
    <div className="stock-count-page">
      <div className="sc-header">
        <div className="sc-header-left">
          <span className="daily-ops-kicker">Stock Count Detail</span>
          <h1 className="page-title">{count.location.name} count</h1>
          <p className="page-subtitle">
            Created by {count.createdBy.name} on {formatDateTime(count.createdAt)}.
          </p>
        </div>
        <div className="sc-detail-actions">
          <span className={`stock-count-status stock-count-status--${count.status.toLowerCase()}`}>
            <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true"><circle cx="4" cy="4" r="4" /></svg>
            {formatStatus(count.status)}
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate("/stock-count")}>
            ← Back
          </button>
          {isDraft && canFinalize && (
            <>
              <button
                type="button"
                className="btn btn--warning btn--sm"
                disabled={actioning}
                onClick={() => { setManagerActionType("return"); setManagerComment(""); }}
              >
                Return for Recount
              </button>
              <button
                type="button"
                className="btn btn--danger btn--sm"
                disabled={actioning}
                onClick={() => { setManagerActionType("reject"); setManagerComment(""); }}
              >
                Reject Count
              </button>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={finalizing}
                onClick={() => setShowApproveConfirm(true)}
              >
                {finalizing ? <><span className="btn-spinner btn-spinner--xs" /> Approving…</> : "Approve & Adjust Stock"}
              </button>
            </>
          )}
          {isReturned && canFinalize && (
            <button
              type="button"
              className="btn btn--danger btn--sm"
              disabled={actioning}
              onClick={() => { setManagerActionType("reject"); setManagerComment(""); }}
            >
              Reject Count
            </button>
          )}
        </div>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {(isReturned || isRejected) && (
        <div className={`sc-manager-banner sc-manager-banner--${isReturned ? "returned" : "rejected"}`}>
          <div className="sc-manager-banner-icon">
            {isReturned ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="m15 9-6 6" /><path d="m9 9 6 6" />
              </svg>
            )}
          </div>
          <div className="sc-manager-banner-body">
            <strong className="sc-manager-banner-title">
              {isReturned ? "Returned for Recount" : "Count Rejected"}
            </strong>
            {isReturned ? (
              <p>
                Returned by {count.returnedBy?.name ?? "manager"} on {formatDateTime(count.returnedAt!)}.
                {count.managerComment && <> — <em>{count.managerComment}</em></>}
              </p>
            ) : (
              <p>
                Rejected by {count.rejectedBy?.name ?? "manager"} on {formatDateTime(count.rejectedAt!)}.
                {count.managerComment && <> — <em>{count.managerComment}</em></>}
              </p>
            )}
            {isReturned && (
              <p className="sc-manager-banner-hint">Start a new count from the <button type="button" className="sc-inline-link" onClick={() => navigate("/stock-count")}>Physical Count</button> page.</p>
            )}
          </div>
        </div>
      )}

      <div className="sc-detail-stats">
        <DetailStat label="Location" value={count.location.name} />
        <DetailStat label="Created by" value={count.createdBy.name} />
        <DetailStat label="Status" value={formatStatus(count.status)} />
        <DetailStat label="Net variance" value={formatSigned(totalVariance)} tone={varianceTone(totalVariance)} />
        {count.finalizedBy && <DetailStat label="Approved by" value={count.finalizedBy.name} />}
        {count.finalizedAt && <DetailStat label="Approved" value={formatDateTime(count.finalizedAt)} />}
        {count.returnedBy && <DetailStat label="Returned by" value={count.returnedBy.name} />}
        {count.rejectedBy && <DetailStat label="Rejected by" value={count.rejectedBy.name} />}
      </div>

      {count.note && (
        <div className="sc-panel sc-detail-note">
          <p className="sc-panel-title">Count note</p>
          <p className="sc-panel-sub">{count.note}</p>
        </div>
      )}

      <div className="sc-panel">
        <div className="sc-panel-head">
          <div>
            <h2 className="sc-panel-title">Counted items</h2>
            <p className="sc-panel-sub">{count.items.length} item{count.items.length === 1 ? "" : "s"} counted in this cycle count.</p>
          </div>
        </div>
        <div className="stock-count-detail-table-wrap">
          <table className="stock-count-detail-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>System qty</th>
                <th>Physical qty</th>
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
      </div>

      {showApproveConfirm && (
        <ApprovalConfirmModal
          affectedItems={affectedItems}
          onConfirm={() => { setShowApproveConfirm(false); void handleFinalize(); }}
          onCancel={() => setShowApproveConfirm(false)}
          loading={finalizing}
        />
      )}

      {managerActionType && (
        <ManagerActionDialog
          type={managerActionType}
          comment={managerComment}
          onCommentChange={setManagerComment}
          onConfirm={() => { void handleManagerAction(); }}
          onCancel={() => { setManagerActionType(null); setManagerComment(""); }}
          loading={actioning}
        />
      )}
    </div>
  );
}

function ApprovalConfirmModal({
  affectedItems,
  onConfirm,
  onCancel,
  loading,
}: {
  affectedItems: Array<{ item: { name: string }; systemQuantity: number; physicalQuantity: number; variance: number; itemId: string }>;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <div className="modal-overlay" onClick={onCancel} role="dialog" aria-modal="true" aria-labelledby="approve-modal-title">
      <div className="modal-box modal-box--md" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title" id="approve-modal-title">Confirm: Approve &amp; Adjust Stock</h2>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </div>
        <div className="modal-body">
          {affectedItems.length === 0 ? (
            <p className="sc-approve-no-variance">No variance detected. No stock adjustments will be made — all item quantities match.</p>
          ) : (
            <>
              <p className="sc-approve-intro">The following items have variances and will have their stock adjusted:</p>
              <div className="sc-approve-table-wrap">
                <table className="sc-approve-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>System</th>
                      <th>Physical</th>
                      <th>Adjustment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {affectedItems.map((item) => (
                      <tr key={item.itemId}>
                        <td><strong>{item.item.name}</strong></td>
                        <td>{formatQuantity(item.systemQuantity)}</td>
                        <td>{formatQuantity(item.physicalQuantity)}</td>
                        <td>
                          <span className={`sc-variance-pill sc-variance-pill--${varianceTone(item.variance)}`}>
                            {formatSigned(item.variance)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={loading}>Cancel</button>
          <button type="button" className="btn btn--primary" onClick={onConfirm} disabled={loading}>
            {loading ? <><span className="btn-spinner btn-spinner--xs" /> Approving…</> : "Approve & Adjust Stock"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ManagerActionDialog({
  type,
  comment,
  onCommentChange,
  onConfirm,
  onCancel,
  loading,
}: {
  type: "return" | "reject";
  comment: string;
  onCommentChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { textRef.current?.focus(); }, []);

  const isReturn = type === "return";
  return (
    <div className="modal-overlay" onClick={onCancel} role="dialog" aria-modal="true">
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{isReturn ? "Return for Recount" : "Reject Count"}</h2>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </div>
        <div className="modal-body">
          <p className="sc-action-dialog-desc">
            {isReturn
              ? "Send this count back to the operator for correction. Add a comment explaining what needs to be recounted."
              : "Permanently reject this count. No stock adjustments will be made. This cannot be undone."}
          </p>
          <div className="form-group">
            <label className="form-label" htmlFor="manager-comment">
              Manager comment <span className="form-label-opt">(optional)</span>
            </label>
            <textarea
              id="manager-comment"
              ref={textRef}
              className="form-input"
              rows={3}
              value={comment}
              onChange={(e) => onCommentChange(e.target.value)}
              placeholder={isReturn ? "e.g. Recount freezer section, items 3–8 appear incorrect" : "e.g. Count conducted outside of business hours, invalid"}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={loading}>Cancel</button>
          <button
            type="button"
            className={`btn ${isReturn ? "btn--warning" : "btn--danger"}`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? <><span className="btn-spinner btn-spinner--xs" /> Processing…</> : isReturn ? "Return for Recount" : "Reject Count"}
          </button>
        </div>
      </div>
    </div>
  );
}

type StockCountSummary = Awaited<ReturnType<typeof getStockCounts>>["counts"][number];

function StockCountHistory({ counts, onOpen }: { counts: StockCountSummary[]; onOpen: (id: string) => void }) {
  return (
    <div className="sc-panel sc-history">
      <div className="sc-panel-head">
        <div>
          <h2 className="sc-panel-title">Count history</h2>
          <p className="sc-panel-sub">Review saved drafts and finalized cycle counts.</p>
        </div>
      </div>
      {counts.length === 0 ? (
        <div className="sc-empty sc-empty--inline">
          <svg className="sc-empty-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
          </svg>
          <p className="sc-empty-title">No counts yet</p>
          <p className="sc-empty-sub">Saved drafts and approved counts will appear here.</p>
        </div>
      ) : (
        <div className="sc-history-list">
          {counts.map((count) => {
            const varianceTotal = count.items.reduce((t, item) => t + item.variance, 0);
            return (
              <button key={count.id} type="button" className="sc-history-row" onClick={() => onOpen(count.id)}>
                <div className="sc-history-row-info">
                  <strong className="sc-history-location">{count.location.name}</strong>
                  <span className="sc-history-meta">{count.createdBy.name} · {formatDateTime(count.createdAt)}</span>
                </div>
                <div className="sc-history-row-right">
                  <span className={`stock-count-status stock-count-status--${count.status.toLowerCase()}`}>
                    <svg width="6" height="6" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true"><circle cx="4" cy="4" r="4" /></svg>
                    {formatStatus(count.status)}
                  </span>
                  <span className={`sc-variance-pill sc-variance-pill--${varianceTone(varianceTotal)}`}>
                    {formatSigned(varianceTotal)}
                  </span>
                  <svg className="sc-history-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ScMetric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "positive" | "negative" | "zero" | "neutral" }) {
  return (
    <div className={`sc-metric sc-metric--${tone}`}>
      <span className="sc-metric-label">{label}</span>
      <strong className="sc-metric-value">{value}</strong>
    </div>
  );
}

function DetailStat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "positive" | "negative" | "zero" | "neutral" }) {
  return (
    <div className={`sc-detail-stat sc-detail-stat--${tone}`}>
      <span className="sc-detail-stat-label">{label}</span>
      <strong className="sc-detail-stat-value">{value}</strong>
    </div>
  );
}

function VarianceBadge({ value, unit }: { value: number; unit: string }) {
  const rounded = roundQuantity(value);
  const tone = varianceTone(rounded);
  return (
    <span className={`sc-variance-pill sc-variance-pill--${tone}`}>
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
  switch (status) {
    case "FINALIZED": return "Approved";
    case "RETURNED": return "Returned";
    case "REJECTED": return "Rejected";
    default: return "Draft";
  }
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
