import { useState } from "react";
import type { InvoiceLine, InvoiceLineMatchStatus, InvoiceUploadFull } from "../types";
import { updateInvoiceLine, addManualInvoiceLine, deleteInvoiceLine } from "../api/receiving";

interface PurchaseItemRef {
  id: string;
  itemId: string;
  itemName: string;
  unit: string;
  remainingQuantity: number;
  unitCost: number;
}

interface ApplyResult {
  purchaseItemId: string;
  qty: number;
  unitCost: number;
  unitCostExclTax: number | null;
  unitTax: number | null;
  unitCostInclTax: number | null;
  batchNo: string;
  expiryDate: string;
}

interface Props {
  invoiceUpload: InvoiceUploadFull;
  purchaseItems: PurchaseItemRef[];
  inventoryCostBasis: "INCLUDING_TAX" | "EXCLUDING_TAX";
  currency: string;
  onApply: (results: ApplyResult[]) => void;
  onInvoiceUpdated: (upload: InvoiceUploadFull) => void;
}

function confidenceLabel(score: number | null): { label: string; cls: string } {
  if (score == null) return { label: "–", cls: "srm-conf--none" };
  if (score >= 0.9) return { label: `${Math.round(score * 100)}%`, cls: "srm-conf--high" };
  if (score >= 0.7) return { label: `${Math.round(score * 100)}%`, cls: "srm-conf--medium" };
  return { label: `${Math.round(score * 100)}%`, cls: "srm-conf--low" };
}

function matchStatusBadge(status: InvoiceLineMatchStatus | null): { label: string; cls: string } {
  switch (status) {
    case "MATCHED": return { label: "Matched", cls: "srm-match--matched" };
    case "NEEDS_REVIEW": return { label: "Review", cls: "srm-match--review" };
    case "EXTRA_INVOICE_ITEM": return { label: "Extra", cls: "srm-match--extra" };
    case "UNMATCHED": return { label: "Unmatched", cls: "srm-match--unmatched" };
    default: return { label: "Unknown", cls: "srm-match--none" };
  }
}

function effectiveQty(line: InvoiceLine) {
  return line.userEditedQty ?? line.extractedQty ?? 0;
}

function effectiveUnitCostExclTax(line: InvoiceLine) {
  return line.userEditedUnitCostExclTax ?? line.extractedUnitCostExclTax ?? 0;
}

function effectiveUnitTax(line: InvoiceLine) {
  return line.userEditedUnitTax ?? line.extractedUnitTax ?? 0;
}

function effectiveUnitCostInclTax(line: InvoiceLine) {
  return line.userEditedUnitCostInclTax ?? line.extractedUnitCostInclTax ?? 0;
}

export function SmartMatchingPanel({
  invoiceUpload,
  purchaseItems,
  inventoryCostBasis,
  currency,
  onApply,
  onInvoiceUpdated,
}: Props) {
  const [editingLine, setEditingLine] = useState<string | null>(null);
  const [lineEdits, setLineEdits] = useState<Record<string, Partial<{
    userEditedQty: string;
    userEditedUnitCostExclTax: string;
    userEditedUnitTax: string;
    userEditedUnitCostInclTax: string;
    userEditedBatchNo: string;
    userEditedExpiryDate: string;
    userConfirmedPurchaseItemId: string;
  }>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [showAddLine, setShowAddLine] = useState(false);
  const [newLine, setNewLine] = useState({ desc: "", qty: "", costExcl: "", tax: "", costIncl: "" });
  const [addingLine, setAddingLine] = useState(false);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  const lines = invoiceUpload.invoiceLines;
  const matchedCount = lines.filter((l) => l.matchStatus === "MATCHED").length;
  const reviewCount = lines.filter((l) => l.matchStatus === "NEEDS_REVIEW").length;
  const unmatchedCount = lines.filter((l) => l.matchStatus === "UNMATCHED" || l.matchStatus === null).length;

  function getEdit(lineId: string, field: string, fallback: unknown) {
    return (lineEdits[lineId]?.[field as keyof typeof lineEdits[string]] as string | undefined) ?? String(fallback ?? "");
  }

  async function saveLineEdit(line: InvoiceLine) {
    const edits = lineEdits[line.id];
    if (!edits) { setEditingLine(null); return; }
    setSaving(line.id);
    try {
      const updates: Record<string, unknown> = {};
      if (edits.userEditedQty !== undefined) updates.userEditedQty = parseFloat(edits.userEditedQty) || null;
      if (edits.userEditedUnitCostExclTax !== undefined) updates.userEditedUnitCostExclTax = parseFloat(edits.userEditedUnitCostExclTax) || null;
      if (edits.userEditedUnitTax !== undefined) updates.userEditedUnitTax = parseFloat(edits.userEditedUnitTax) || null;
      if (edits.userEditedUnitCostInclTax !== undefined) updates.userEditedUnitCostInclTax = parseFloat(edits.userEditedUnitCostInclTax) || null;
      if (edits.userEditedBatchNo !== undefined) updates.userEditedBatchNo = edits.userEditedBatchNo;
      if (edits.userEditedExpiryDate !== undefined) updates.userEditedExpiryDate = edits.userEditedExpiryDate;
      if (edits.userConfirmedPurchaseItemId !== undefined) updates.userConfirmedPurchaseItemId = edits.userConfirmedPurchaseItemId;

      const res = await updateInvoiceLine(line.id, updates as Parameters<typeof updateInvoiceLine>[1]);
      const newLines = lines.map((l) => (l.id === res.line.id ? res.line : l));
      onInvoiceUpdated({ ...invoiceUpload, invoiceLines: newLines });
    } finally {
      setSaving(null);
      setEditingLine(null);
      setLineEdits((prev) => { const next = { ...prev }; delete next[line.id]; return next; });
    }
  }

  async function handleDeleteLine(lineId: string) {
    if (!confirm("Remove this invoice line?")) return;
    await deleteInvoiceLine(lineId);
    onInvoiceUpdated({ ...invoiceUpload, invoiceLines: lines.filter((l) => l.id !== lineId) });
  }

  async function handleAddLine() {
    if (!newLine.desc.trim()) return;
    setAddingLine(true);
    try {
      const res = await addManualInvoiceLine(invoiceUpload.id, {
        rawDescription: newLine.desc,
        qty: parseFloat(newLine.qty) || undefined,
        unitCostExclTax: parseFloat(newLine.costExcl) || undefined,
        unitTax: parseFloat(newLine.tax) || undefined,
        unitCostInclTax: parseFloat(newLine.costIncl) || undefined,
        taxMode: "NO_TAX",
      });
      onInvoiceUpdated({ ...invoiceUpload, invoiceLines: [...lines, res.line] });
      setNewLine({ desc: "", qty: "", costExcl: "", tax: "", costIncl: "" });
      setShowAddLine(false);
    } finally {
      setAddingLine(false);
    }
  }

  function handleApplyAll() {
    const results: ApplyResult[] = [];
    for (const line of lines) {
      if (skipped.has(line.id)) continue;
      if (line.userAction === "skip") continue;
      const purchaseItemId = line.userConfirmedPurchaseItemId ??
        line.matchedPurchaseItemId;
      if (!purchaseItemId) continue;

      const qty = effectiveQty(line);
      if (!qty) continue;

      const unitCostExclTax = effectiveUnitCostExclTax(line) || null;
      const unitTax = effectiveUnitTax(line) || null;
      const unitCostInclTax = effectiveUnitCostInclTax(line) || null;
      const unitCost = inventoryCostBasis === "EXCLUDING_TAX"
        ? (unitCostExclTax ?? unitCostInclTax ?? 0)
        : (unitCostInclTax ?? unitCostExclTax ?? 0);

      results.push({
        purchaseItemId,
        qty,
        unitCost,
        unitCostExclTax,
        unitTax,
        unitCostInclTax,
        batchNo: line.userEditedBatchNo ?? line.extractedBatchNo ?? "",
        expiryDate: line.userEditedExpiryDate ?? line.extractedExpiryDate ?? "",
      });
    }
    onApply(results);
  }

  const applicableLines = lines.filter((l) => !skipped.has(l.id) && l.userAction !== "skip" && (l.matchedPurchaseItemId || l.userConfirmedPurchaseItemId));

  return (
    <div className="srm-panel">
      <div className="srm-panel-header">
        <div className="srm-panel-title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
          </svg>
          Invoice Lines ({lines.length})
        </div>
        <div className="srm-panel-stats">
          {matchedCount > 0 && <span className="srm-stat srm-stat--matched">{matchedCount} matched</span>}
          {reviewCount > 0 && <span className="srm-stat srm-stat--review">{reviewCount} review</span>}
          {unmatchedCount > 0 && <span className="srm-stat srm-stat--unmatched">{unmatchedCount} unmatched</span>}
        </div>
      </div>

      <div className="srm-table-wrap">
        <table className="srm-table">
          <thead>
            <tr>
              <th className="srm-th srm-th--num">#</th>
              <th className="srm-th srm-th--desc">Invoice Line</th>
              <th className="srm-th srm-th--item">PO Item</th>
              <th className="srm-th srm-th--num2">Qty</th>
              <th className="srm-th srm-th--cost">Excl Tax</th>
              <th className="srm-th srm-th--cost">Tax</th>
              <th className="srm-th srm-th--cost">Incl Tax</th>
              <th className="srm-th srm-th--batch">Batch No.</th>
              <th className="srm-th srm-th--expiry">Expiry</th>
              <th className="srm-th srm-th--match">Match</th>
              <th className="srm-th srm-th--actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const isEditing = editingLine === line.id;
              const isSkipped = skipped.has(line.id) || line.userAction === "skip";
              const conf = confidenceLabel(line.confidenceScore);
              const matchBadge = matchStatusBadge(line.matchStatus);
              const matchedPoItem = purchaseItems.find(
                (p) => p.id === (line.userConfirmedPurchaseItemId ?? line.matchedPurchaseItemId),
              );

              return (
                <tr key={line.id} className={`srm-row${isSkipped ? " srm-row--skipped" : ""}${isEditing ? " srm-row--editing" : ""}`}>
                  <td className="srm-td srm-td--num">{line.lineNumber}</td>
                  <td className="srm-td srm-td--desc">
                    <span className="srm-desc" title={line.rawDescription}>{line.rawDescription}</span>
                  </td>
                  <td className="srm-td srm-td--item">
                    {isEditing ? (
                      <select
                        className="srm-select"
                        value={getEdit(line.id, "userConfirmedPurchaseItemId", line.userConfirmedPurchaseItemId ?? line.matchedPurchaseItemId ?? "")}
                        onChange={(e) => setLineEdits((prev) => ({ ...prev, [line.id]: { ...prev[line.id], userConfirmedPurchaseItemId: e.target.value } }))}
                      >
                        <option value="">Not matched</option>
                        {purchaseItems.map((p) => (
                          <option key={p.id} value={p.id}>{p.itemName} ({p.remainingQuantity} {p.unit} rem.)</option>
                        ))}
                      </select>
                    ) : (
                      <span className="srm-item-name">{matchedPoItem?.itemName ?? <span className="srm-unmatched-label">Not matched</span>}</span>
                    )}
                  </td>
                  <td className="srm-td srm-td--num2">
                    {isEditing ? (
                      <input className="srm-input srm-input--sm" type="number" min="0" step="0.001"
                        value={getEdit(line.id, "userEditedQty", effectiveQty(line))}
                        onChange={(e) => setLineEdits((prev) => ({ ...prev, [line.id]: { ...prev[line.id], userEditedQty: e.target.value } }))}
                      />
                    ) : (
                      <span>{effectiveQty(line) || "–"}</span>
                    )}
                  </td>
                  <td className="srm-td srm-td--cost">
                    {isEditing ? (
                      <input className="srm-input srm-input--sm" type="number" min="0" step="0.0001"
                        value={getEdit(line.id, "userEditedUnitCostExclTax", effectiveUnitCostExclTax(line))}
                        onChange={(e) => setLineEdits((prev) => ({ ...prev, [line.id]: { ...prev[line.id], userEditedUnitCostExclTax: e.target.value } }))}
                      />
                    ) : (
                      <span className="srm-cost">{effectiveUnitCostExclTax(line) ? `${currency} ${effectiveUnitCostExclTax(line).toFixed(2)}` : "–"}</span>
                    )}
                  </td>
                  <td className="srm-td srm-td--cost">
                    {isEditing ? (
                      <input className="srm-input srm-input--sm" type="number" min="0" step="0.0001"
                        value={getEdit(line.id, "userEditedUnitTax", effectiveUnitTax(line))}
                        onChange={(e) => setLineEdits((prev) => ({ ...prev, [line.id]: { ...prev[line.id], userEditedUnitTax: e.target.value } }))}
                      />
                    ) : (
                      <span className="srm-cost srm-cost--tax">{effectiveUnitTax(line) ? `${currency} ${effectiveUnitTax(line).toFixed(2)}` : "–"}</span>
                    )}
                  </td>
                  <td className="srm-td srm-td--cost">
                    {isEditing ? (
                      <input className="srm-input srm-input--sm" type="number" min="0" step="0.0001"
                        value={getEdit(line.id, "userEditedUnitCostInclTax", effectiveUnitCostInclTax(line))}
                        onChange={(e) => setLineEdits((prev) => ({ ...prev, [line.id]: { ...prev[line.id], userEditedUnitCostInclTax: e.target.value } }))}
                      />
                    ) : (
                      <span className="srm-cost srm-cost--incl">{effectiveUnitCostInclTax(line) ? `${currency} ${effectiveUnitCostInclTax(line).toFixed(2)}` : "–"}</span>
                    )}
                  </td>
                  <td className="srm-td srm-td--batch">
                    {isEditing ? (
                      <input className="srm-input srm-input--sm" type="text" placeholder="Optional"
                        value={getEdit(line.id, "userEditedBatchNo", line.userEditedBatchNo ?? line.extractedBatchNo ?? "")}
                        onChange={(e) => setLineEdits((prev) => ({ ...prev, [line.id]: { ...prev[line.id], userEditedBatchNo: e.target.value } }))}
                      />
                    ) : (
                      <span>{line.userEditedBatchNo ?? line.extractedBatchNo ?? "–"}</span>
                    )}
                  </td>
                  <td className="srm-td srm-td--expiry">
                    {isEditing ? (
                      <input className="srm-input srm-input--sm" type="date"
                        value={getEdit(line.id, "userEditedExpiryDate", line.userEditedExpiryDate ?? line.extractedExpiryDate ?? "")}
                        onChange={(e) => setLineEdits((prev) => ({ ...prev, [line.id]: { ...prev[line.id], userEditedExpiryDate: e.target.value } }))}
                      />
                    ) : (
                      <span>{line.userEditedExpiryDate ?? line.extractedExpiryDate ?? "–"}</span>
                    )}
                  </td>
                  <td className="srm-td srm-td--match">
                    <div className="srm-match-cell">
                      <span className={`srm-match-badge ${matchBadge.cls}`}>{matchBadge.label}</span>
                      <span className={`srm-conf-badge ${conf.cls}`}>{conf.label}</span>
                    </div>
                  </td>
                  <td className="srm-td srm-td--actions">
                    {isEditing ? (
                      <div className="srm-row-actions">
                        <button type="button" className="srm-action-btn srm-action-btn--save" onClick={() => void saveLineEdit(line)} disabled={saving === line.id}>
                          {saving === line.id ? "…" : "Save"}
                        </button>
                        <button type="button" className="srm-action-btn srm-action-btn--cancel" onClick={() => { setEditingLine(null); setLineEdits((prev) => { const n = { ...prev }; delete n[line.id]; return n; }); }}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="srm-row-actions">
                        {!isSkipped && (
                          <button type="button" className="srm-action-btn srm-action-btn--edit" onClick={() => setEditingLine(line.id)} title="Edit this line">
                            Edit
                          </button>
                        )}
                        <button type="button" className={`srm-action-btn ${isSkipped ? "srm-action-btn--unskip" : "srm-action-btn--skip"}`}
                          onClick={() => setSkipped((prev) => { const n = new Set(prev); if (n.has(line.id)) n.delete(line.id); else n.add(line.id); return n; })}
                          title={isSkipped ? "Include this line" : "Skip this line"}>
                          {isSkipped ? "Include" : "Skip"}
                        </button>
                        <button type="button" className="srm-action-btn srm-action-btn--delete" onClick={() => void handleDeleteLine(line.id)} title="Remove line">
                          ×
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="srm-panel-footer">
        <div className="srm-footer-left">
          <button type="button" className="srm-add-line-btn" onClick={() => setShowAddLine(!showAddLine)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add line manually
          </button>
          {showAddLine && (
            <div className="srm-add-line-form">
              <input className="srm-input" placeholder="Description *" value={newLine.desc} onChange={(e) => setNewLine((p) => ({ ...p, desc: e.target.value }))} />
              <input className="srm-input srm-input--sm" type="number" placeholder="Qty" value={newLine.qty} onChange={(e) => setNewLine((p) => ({ ...p, qty: e.target.value }))} />
              <input className="srm-input srm-input--sm" type="number" placeholder="Excl Tax" value={newLine.costExcl} onChange={(e) => setNewLine((p) => ({ ...p, costExcl: e.target.value }))} />
              <input className="srm-input srm-input--sm" type="number" placeholder="Tax" value={newLine.tax} onChange={(e) => setNewLine((p) => ({ ...p, tax: e.target.value }))} />
              <input className="srm-input srm-input--sm" type="number" placeholder="Incl Tax" value={newLine.costIncl} onChange={(e) => setNewLine((p) => ({ ...p, costIncl: e.target.value }))} />
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => void handleAddLine()} disabled={addingLine || !newLine.desc.trim()}>
                {addingLine ? "Adding…" : "Add"}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowAddLine(false)}>Cancel</button>
            </div>
          )}
        </div>
        <div className="srm-footer-right">
          <div className="srm-cost-basis-note">
            Cost basis: <strong>{inventoryCostBasis === "INCLUDING_TAX" ? "Including Tax" : "Excluding Tax"}</strong>
          </div>
          <button
            type="button"
            className="btn btn--primary srm-apply-btn"
            onClick={handleApplyAll}
            disabled={applicableLines.length === 0}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 11 12 14 22 4"/>
            </svg>
            Apply {applicableLines.length} Line{applicableLines.length !== 1 ? "s" : ""} to Receive
          </button>
        </div>
      </div>
    </div>
  );
}
