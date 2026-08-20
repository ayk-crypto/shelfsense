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
import { hasPermission } from "../utils/permissions";
import "./StockCountBlindCount.css";

interface CountLine {
  itemId: string;
  physicalQuantity: string;
}

type StockCountSummary = Awaited<ReturnType<typeof getStockCounts>>["counts"][number];

export function StockCountPage() {
  const { id } = useParams();
  if (id) return <StockCountDetail id={id} />;
  return <StockCountWorkspace />;
}

function StockCountWorkspace() {
  const { user } = useAuth();
  const { locations, activeLocationId } = useLocation();
  const navigate = useNavigate();
  const canFinalize = hasPermission(user, "inventory_manage");

  const [selectedLocationId, setSelectedLocationId] = useState(activeLocationId);
  const [stockItems, setStockItems] = useState<StockCountStockItem[]>([]);
  const [counts, setCounts] = useState<StockCountSummary[]>([]);
  const [lines, setLines] = useState<CountLine[]>([]);
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [reviewMode, setReviewMode] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [actioning, setActioning] = useState(false);
  const [resuming, setResuming] = useState<string | null>(null);
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
    const isComplete = line.physicalQuantity.trim() !== "";
    const physicalQuantity = isComplete ? parseQuantity(line.physicalQuantity) : 0;
    const systemQuantity = item?.systemQuantity ?? 0;
    const variance = physicalQuantity - systemQuantity;
    return { ...line, item, isComplete, physicalQuantity, systemQuantity, variance };
  });

  const completedLines = countedLines.filter((line) => line.isComplete);
  const incompleteCount = countedLines.length - completedLines.length;
  const totalVariance = completedLines.reduce((total, line) => total + line.variance, 0);
  const nonZeroVarianceCount = completedLines.filter((line) => roundQuantity(line.variance) !== 0).length;
  const matchedCount = completedLines.length - nonZeroVarianceCount;
  const affectedItems = completedLines.filter(
    (line): line is typeof line & { item: StockCountStockItem } =>
      line.item !== undefined && roundQuantity(line.variance) !== 0,
  );
  const canReview = countedLines.length > 0 && incompleteCount === 0;
  const canApproveLatest = Boolean(draftId && !isDirty && canReview);

  function resetWorkingCount() {
    setLines([]);
    setDraftId(null);
    setNote("");
    setReviewMode(false);
    setIsDirty(false);
    setMessage(null);
    setError(null);
  }

  function addItem(item: StockCountStockItem) {
    setLines((current) => [...current, { itemId: item.id, physicalQuantity: "" }]);
    setQuery("");
    setReviewMode(false);
    setIsDirty(true);
    setMessage(null);
    setError(null);
  }

  function updateLine(itemId: string, physicalQuantity: string) {
    setLines((current) => current.map((line) => line.itemId === itemId ? { ...line, physicalQuantity } : line));
    setReviewMode(false);
    setIsDirty(true);
    setMessage(null);
  }

  function removeLine(itemId: string) {
    setLines((current) => current.filter((line) => line.itemId !== itemId));
    setReviewMode(false);
    setIsDirty(true);
    setMessage(null);
  }

  async function handleResumeCount(id: string) {
    if (resuming) return;
    setResuming(id);
    setError(null);
    setMessage(null);
    try {
      const res = await getStockCount(id);
      if (res.count.status !== "DRAFT") {
        navigate(`/stock-count/${id}`);
        return;
      }
      setSelectedLocationId(res.count.location.id);
      setDraftId(res.count.id);
      setNote(res.count.note ?? "");
      setLines(res.count.items.map((item) => ({
        itemId: item.itemId,
        physicalQuantity: formatQuantity(item.physicalQuantity),
      })));
      setReviewMode(false);
      setIsDirty(false);
      setMessage("Draft resumed. Continue counting where you left off.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resume stock count");
    } finally {
      setResuming(null);
    }
  }

  async function handleSaveDraft(e?: FormEvent) {
    e?.preventDefault();
    if (!selectedLocationId || saving) return;

    const completePayload = countedLines
      .filter((line) => line.item && line.isComplete)
      .map((line) => ({ itemId: line.itemId, physicalQuantity: roundQuantity(line.physicalQuantity) }));

    if (completePayload.length === 0) {
      setError("Enter at least one physical quantity before saving.");
      return;
    }

    const pendingLines = lines.filter((line) => line.physicalQuantity.trim() === "");
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const res = draftId
        ? await updateStockCount(draftId, {
            locationId: selectedLocationId,
            note: note.trim() || null,
            items: completePayload,
          })
        : await createStockCount({
            locationId: selectedLocationId,
            note: note.trim() || null,
            items: completePayload,
          });

      const savedIds = new Set(res.count.items.map((item) => item.itemId));
      setDraftId(res.count.id);
      setLines([
        ...res.count.items.map((item) => ({
          itemId: item.itemId,
          physicalQuantity: formatQuantity(item.physicalQuantity),
        })),
        ...pendingLines.filter((line) => !savedIds.has(line.itemId)),
      ]);
      setCounts((await getStockCounts()).counts);
      setIsDirty(pendingLines.length > 0);
      setMessage(
        pendingLines.length > 0
          ? `Progress saved for ${completePayload.length} item${completePayload.length === 1 ? "" : "s"}. ${pendingLines.length} item${pendingLines.length === 1 ? " is" : "s are"} still waiting to be counted.`
          : "Count saved. Review the variances before approving any stock adjustments.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save stock count");
    } finally {
      setSaving(false);
    }
  }

  async function handleFinalize() {
    if (!draftId || finalizing || !canFinalize || !canApproveLatest) return;
    setFinalizing(true);
    setError(null);
    setMessage(null);
    try {
      await finalizeStockCount(draftId);
      setMessage("Stock count approved and adjustment movements posted.");
      resetWorkingCount();
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
        setMessage("Count returned for recount.");
      } else {
        await rejectStockCount(draftId, managerComment.trim() || undefined);
        setMessage("Count rejected.");
      }
      resetWorkingCount();
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
          <span className="daily-ops-kicker">Stock Count</span>
          <h1 className="page-title">Count what is physically there</h1>
          <p className="page-subtitle">
            ShelfSense hides expected quantities while you count. Variances only appear when you choose Review Count.
          </p>
        </div>
        <div className="sc-metrics">
          {reviewMode ? (
            <>
              <ScMetric label="Matched" value={String(matchedCount)} tone="positive" />
              <ScMetric label="Differences" value={String(nonZeroVarianceCount)} tone={nonZeroVarianceCount > 0 ? "negative" : "zero"} />
              <ScMetric label="Net" value={formatSigned(totalVariance)} tone={varianceTone(totalVariance)} />
            </>
          ) : (
            <>
              <ScMetric label="Added" value={String(lines.length)} />
              <ScMetric label="Counted" value={String(completedLines.length)} tone={completedLines.length > 0 ? "positive" : "neutral"} />
              <ScMetric label="Remaining" value={String(incompleteCount)} tone={incompleteCount > 0 ? "negative" : "zero"} />
            </>
          )}
        </div>
      </div>

      <div className="sc-blind-banner">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 3l18 18" />
          <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
          <path d="M9.9 4.2A10.8 10.8 0 0 1 12 4c5 0 9.3 3.1 11 8a11.8 11.8 0 0 1-2 3.8" />
          <path d="M6.6 6.6A11.8 11.8 0 0 0 1 12c1.7 4.9 6 8 11 8 1.5 0 3-.3 4.3-.8" />
        </svg>
        <div>
          <strong>Blind count is on</strong>
          <p>Expected stock is intentionally hidden until review, so staff count the shelf rather than confirm the system.</p>
        </div>
      </div>

      {error && <div className="alert alert--error" role="alert">{error}</div>}
      {message && <div className="alert alert--success" role="status">{message}</div>}

      <form className="sc-workspace" onSubmit={handleSaveDraft}>
        <aside className="sc-panel sc-panel--setup">
          <div className="sc-panel-head">
            <div>
              <h2 className="sc-panel-title">1. Choose what to count</h2>
              <p className="sc-panel-sub">Branch is selected once. Search by item, SKU, barcode, or category.</p>
            </div>
            {draftId && (
              <span className="stock-count-status stock-count-status--draft">
                <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true"><circle cx="4" cy="4" r="4" /></svg>
                Draft
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
                onChange={(event) => {
                  setSelectedLocationId(event.target.value);
                  resetWorkingCount();
                }}
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>{location.name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="sc-note">Count note <span className="form-label-opt">(optional)</span></label>
              <textarea
                id="sc-note"
                className="form-input sc-note-textarea"
                rows={2}
                value={note}
                onChange={(event) => { setNote(event.target.value); setIsDirty(true); }}
                placeholder="e.g. Evening freezer count"
              />
            </div>
          </div>

          <div className="sc-search-section">
            <div className="form-group">
              <label className="form-label" htmlFor="sc-search">Search or scan item</label>
              <div className="sc-search-input-wrap">
                <svg className="sc-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                </svg>
                <input
                  id="sc-search"
                  className="form-input sc-search-input"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Name, SKU, barcode…"
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="sc-search-results">
              {loading ? (
                <div className="sc-search-hint"><span className="btn-spinner btn-spinner--xs" /> Loading items…</div>
              ) : query.trim() === "" ? (
                <div className="sc-search-hint">Type or scan to find an item</div>
              ) : filteredItems.length === 0 ? (
                <div className="sc-search-hint">No matching items found</div>
              ) : (
                filteredItems.map((item) => (
                  <button key={item.id} type="button" className="sc-item-result" onClick={() => addItem(item)}>
                    <div className="sc-item-result-info">
                      <strong className="sc-item-result-name">{item.name}</strong>
                      <span className="sc-item-result-meta">{[item.category, item.sku].filter(Boolean).join(" · ") || "Inventory item"}</span>
                    </div>
                    <div className="sc-item-result-right">
                      <span className="sc-item-result-qty">Count in {item.unit}</span>
                      <svg className="sc-item-result-add" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
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
              <h2 className="sc-panel-title">{reviewMode ? "3. Review differences" : "2. Enter physical quantities"}</h2>
              <p className="sc-panel-sub">
                {reviewMode
                  ? "Expected quantities are now visible for review. Only differences need attention."
                  : "Enter what you physically counted. ShelfSense will not show expected stock yet."}
              </p>
            </div>
            <div className="sc-panel-actions">
              {!reviewMode ? (
                <>
                  <button type="submit" className="btn btn--secondary btn--sm" disabled={saving || completedLines.length === 0}>
                    {saving ? <><span className="btn-spinner btn-spinner--xs" /> Saving…</> : draftId ? "Save Progress" : "Save Draft"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--primary btn--sm"
                    disabled={!canReview}
                    onClick={() => { setReviewMode(true); setError(null); }}
                  >
                    Review Count
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setReviewMode(false)}>Back to Counting</button>
                  {isDirty && (
                    <button type="submit" className="btn btn--secondary btn--sm" disabled={saving}>
                      {saving ? <><span className="btn-spinner btn-spinner--xs" /> Saving…</> : "Save Latest Counts"}
                    </button>
                  )}
                  {draftId && canFinalize && !isDirty && (
                    <>
                      <button type="button" className="btn btn--warning btn--sm" disabled={actioning} onClick={() => { setManagerActionType("return"); setManagerComment(""); }}>Recount</button>
                      <button type="button" className="btn btn--danger btn--sm" disabled={actioning} onClick={() => { setManagerActionType("reject"); setManagerComment(""); }}>Reject</button>
                      <button type="button" className="btn btn--primary btn--sm" disabled={finalizing || !canApproveLatest} onClick={() => setShowApproveConfirm(true)}>
                        {finalizing ? <><span className="btn-spinner btn-spinner--xs" /> Approving…</> : "Approve Adjustments"}
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {!reviewMode && countedLines.length > 0 && (
            <div className="sc-progress-strip">
              <div className="sc-progress-card"><span>Items added</span><strong>{countedLines.length}</strong></div>
              <div className="sc-progress-card"><span>Counted</span><strong>{completedLines.length}</strong></div>
              <div className="sc-progress-card"><span>Still to count</span><strong>{incompleteCount}</strong></div>
            </div>
          )}

          {reviewMode && (
            <div className="sc-review-summary">
              <div className="sc-review-card"><span>Matched</span><strong>{matchedCount}</strong></div>
              <div className="sc-review-card"><span>Differences</span><strong>{nonZeroVarianceCount}</strong></div>
              <div className="sc-review-card"><span>Net variance</span><strong>{formatSigned(totalVariance)}</strong></div>
            </div>
          )}

          {countedLines.length === 0 ? (
            <div className="sc-empty">
              <svg className="sc-empty-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
              <p className="sc-empty-title">No items selected</p>
              <p className="sc-empty-sub">Search or scan an item to begin counting.</p>
            </div>
          ) : (
            <div className="sc-line-list">
              <div className="sc-line-header">
                <span>Item</span>
                <span>{reviewMode ? "System qty" : "Unit"}</span>
                <span>Physical count</span>
                <span>{reviewMode ? "Variance" : "Status"}</span>
                <span />
              </div>
              {countedLines.map((line) => (
                <div key={line.itemId} className="sc-line">
                  <div className="sc-line-info">
                    <strong className="sc-line-name">{line.item?.name ?? "Unknown item"}</strong>
                    <span className="sc-line-unit">{line.item?.category ?? "Inventory item"}</span>
                  </div>
                  <div className="sc-line-system">
                    {reviewMode ? (
                      <>
                        <span className="sc-line-system-val">{formatQuantity(line.systemQuantity)}</span>
                        <span className="sc-line-system-unit">{line.item?.unit}</span>
                      </>
                    ) : (
                      <span className="sc-line-system-val">{line.item?.unit}</span>
                    )}
                  </div>
                  <div className="sc-line-physical">
                    <input
                      className="form-input sc-line-input"
                      type="number"
                      min="0"
                      step="0.001"
                      value={line.physicalQuantity}
                      onChange={(event) => updateLine(line.itemId, event.target.value)}
                      placeholder="Enter count"
                      disabled={reviewMode}
                      inputMode="decimal"
                      aria-label={`Physical quantity for ${line.item?.name}`}
                    />
                  </div>
                  {reviewMode ? (
                    <VarianceBadge value={line.variance} unit={line.item?.unit ?? ""} />
                  ) : line.isComplete ? (
                    <span className="sc-counted-pill">Counted</span>
                  ) : (
                    <span className="sc-pending-pill">Waiting</span>
                  )}
                  <button type="button" className="sc-line-remove" onClick={() => removeLine(line.itemId)} disabled={reviewMode} aria-label={`Remove ${line.item?.name}`}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {!reviewMode && lines.length > 0 && incompleteCount > 0 && (
            <p className="sc-panel-sub" style={{ marginTop: 12 }}>
              Review Count unlocks after every selected item has a physical quantity.
            </p>
          )}
          {reviewMode && isDirty && (
            <div className="alert alert--warning" style={{ marginTop: 12 }}>
              Save the latest counts before approving adjustments.
            </div>
          )}
        </section>
      </form>

      <StockCountHistory
        counts={counts}
        resumingId={resuming}
        onResume={(id) => { void handleResumeCount(id); }}
        onOpen={(id) => navigate(`/stock-count/${id}`)}
      />

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
  const canFinalize = hasPermission(user, "inventory_manage");
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
      const res = managerActionType === "return"
        ? await returnForRecount(count.id, managerComment.trim() || undefined)
        : await rejectStockCount(count.id, managerComment.trim() || undefined);
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
    return <div className="page-loading"><div className="spinner" /><p>Loading stock count…</p></div>;
  }

  if (error || !count) {
    return <div className="page-error"><div className="alert alert--error">{error ?? "Stock count not found"}</div></div>;
  }

  const totalVariance = count.items.reduce((total, item) => total + item.variance, 0);
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
          <span className="daily-ops-kicker">Stock Count Review</span>
          <h1 className="page-title">{count.location.name} count</h1>
          <p className="page-subtitle">Created by {count.createdBy.name} on {formatDateTime(count.createdAt)}.</p>
        </div>
        <div className="sc-detail-actions">
          <span className={`stock-count-status stock-count-status--${count.status.toLowerCase()}`}>
            <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true"><circle cx="4" cy="4" r="4" /></svg>
            {formatStatus(count.status)}
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigate("/stock-count")}>← Back</button>
          {isDraft && canFinalize && (
            <>
              <button type="button" className="btn btn--warning btn--sm" disabled={actioning} onClick={() => { setManagerActionType("return"); setManagerComment(""); }}>Recount</button>
              <button type="button" className="btn btn--danger btn--sm" disabled={actioning} onClick={() => { setManagerActionType("reject"); setManagerComment(""); }}>Reject</button>
              <button type="button" className="btn btn--primary btn--sm" disabled={finalizing} onClick={() => setShowApproveConfirm(true)}>
                {finalizing ? <><span className="btn-spinner btn-spinner--xs" /> Approving…</> : "Approve Adjustments"}
              </button>
            </>
          )}
          {isReturned && canFinalize && (
            <button type="button" className="btn btn--danger btn--sm" disabled={actioning} onClick={() => { setManagerActionType("reject"); setManagerComment(""); }}>Reject</button>
          )}
        </div>
      </div>

      {error && <div className="alert alert--error">{error}</div>}

      {(isReturned || isRejected) && (
        <div className={`sc-manager-banner sc-manager-banner--${isReturned ? "returned" : "rejected"}`}>
          <div className="sc-manager-banner-body">
            <strong className="sc-manager-banner-title">{isReturned ? "Returned for Recount" : "Count Rejected"}</strong>
            <p>
              {isReturned ? "Returned" : "Rejected"} by {isReturned ? count.returnedBy?.name ?? "manager" : count.rejectedBy?.name ?? "manager"}.
              {count.managerComment && <> — <em>{count.managerComment}</em></>}
            </p>
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
            <h2 className="sc-panel-title">Variance review</h2>
            <p className="sc-panel-sub">System and physical quantities are shown here only after the count has been captured.</p>
          </div>
        </div>
        <div className="stock-count-detail-table-wrap">
          <table className="stock-count-detail-table">
            <thead><tr><th>Item</th><th>System qty</th><th>Physical qty</th><th>Variance</th></tr></thead>
            <tbody>
              {count.items.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.itemName}</strong><span>{item.unit}</span></td>
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
      <div className="modal-box modal-box--md" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title" id="approve-modal-title">Approve stock adjustments?</h2>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          {affectedItems.length === 0 ? (
            <p className="sc-approve-no-variance">Everything matches. No stock adjustments will be posted.</p>
          ) : (
            <>
              <p className="sc-approve-intro">Only these differences will adjust stock:</p>
              <div className="sc-approve-table-wrap">
                <table className="sc-approve-table">
                  <thead><tr><th>Item</th><th>System</th><th>Counted</th><th>Adjustment</th></tr></thead>
                  <tbody>
                    {affectedItems.map((item) => (
                      <tr key={item.itemId}>
                        <td><strong>{item.item.name}</strong></td>
                        <td>{formatQuantity(item.systemQuantity)}</td>
                        <td>{formatQuantity(item.physicalQuantity)}</td>
                        <td><span className={`sc-variance-pill sc-variance-pill--${varianceTone(item.variance)}`}>{formatSigned(item.variance)}</span></td>
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
            {loading ? <><span className="btn-spinner btn-spinner--xs" /> Approving…</> : "Approve Adjustments"}
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
  onCommentChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { textRef.current?.focus(); }, []);
  const isReturn = type === "return";

  return (
    <div className="modal-overlay" onClick={onCancel} role="dialog" aria-modal="true">
      <div className="modal-box" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{isReturn ? "Request a recount" : "Reject count"}</h2>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <p className="sc-action-dialog-desc">
            {isReturn
              ? "Send this count back for correction. Add a comment if a particular item or area needs another count."
              : "Reject this count without posting any stock adjustments."}
          </p>
          <div className="form-group">
            <label className="form-label" htmlFor="manager-comment">Manager comment <span className="form-label-opt">(optional)</span></label>
            <textarea
              id="manager-comment"
              ref={textRef}
              className="form-input"
              rows={3}
              value={comment}
              onChange={(event) => onCommentChange(event.target.value)}
              placeholder={isReturn ? "e.g. Recount freezer items" : "Reason for rejection"}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={loading}>Cancel</button>
          <button type="button" className={`btn ${isReturn ? "btn--warning" : "btn--danger"}`} onClick={onConfirm} disabled={loading}>
            {loading ? <><span className="btn-spinner btn-spinner--xs" /> Processing…</> : isReturn ? "Request Recount" : "Reject Count"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StockCountHistory({
  counts,
  onOpen,
  onResume,
  resumingId,
}: {
  counts: StockCountSummary[];
  onOpen: (id: string) => void;
  onResume: (id: string) => void;
  resumingId: string | null;
}) {
  return (
    <div className="sc-panel sc-history">
      <div className="sc-panel-head">
        <div>
          <h2 className="sc-panel-title">Recent counts</h2>
          <p className="sc-panel-sub">Resume drafts or review completed counts.</p>
        </div>
      </div>
      {counts.length === 0 ? (
        <div className="sc-empty sc-empty--inline">
          <p className="sc-empty-title">No counts yet</p>
          <p className="sc-empty-sub">Saved drafts and approved counts will appear here.</p>
        </div>
      ) : (
        <div className="sc-history-list">
          {counts.map((count) => {
            const varianceTotal = count.items.reduce((total, item) => total + item.variance, 0);
            const isDraft = count.status === "DRAFT";
            return (
              <button
                key={count.id}
                type="button"
                className="sc-history-row"
                onClick={() => isDraft ? onResume(count.id) : onOpen(count.id)}
              >
                <div className="sc-history-row-info">
                  <strong className="sc-history-location">{count.location.name}</strong>
                  <span className="sc-history-meta">{count.createdBy.name} · {formatDateTime(count.createdAt)}</span>
                </div>
                <div className="sc-history-row-right">
                  <span className={`stock-count-status stock-count-status--${count.status.toLowerCase()}`}>
                    <svg width="6" height="6" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true"><circle cx="4" cy="4" r="4" /></svg>
                    {formatStatus(count.status)}
                  </span>
                  {isDraft ? (
                    <span className="sc-counted-pill">{resumingId === count.id ? "Opening…" : "Resume"}</span>
                  ) : (
                    <span className={`sc-variance-pill sc-variance-pill--${varianceTone(varianceTotal)}`}>{formatSigned(varianceTotal)}</span>
                  )}
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
  return <div className={`sc-metric sc-metric--${tone}`}><span className="sc-metric-label">{label}</span><strong className="sc-metric-value">{value}</strong></div>;
}

function DetailStat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "positive" | "negative" | "zero" | "neutral" }) {
  return <div className={`sc-detail-stat sc-detail-stat--${tone}`}><span className="sc-detail-stat-label">{label}</span><strong className="sc-detail-stat-value">{value}</strong></div>;
}

function VarianceBadge({ value, unit }: { value: number; unit: string }) {
  const rounded = roundQuantity(value);
  return <span className={`sc-variance-pill sc-variance-pill--${varianceTone(rounded)}`}>{formatSigned(rounded)} {unit}</span>;
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
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
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
