import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createReorderPurchases, getReorderSuggestions } from "../api/reorderSuggestions";
import { getSuppliers } from "../api/suppliers";
import { useAuth } from "../context/AuthContext";
import { hasPermission } from "../utils/permissions";
import { useLocation } from "../context/LocationContext";
import { useWorkspaceSettings } from "../context/WorkspaceSettingsContext";
import type { ReorderSuggestion, Supplier } from "../types";
import { formatCurrency } from "../utils/currency";

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
  const canCreateDrafts = hasPermission(user, "purchases");
  const [suggestions, setSuggestions] = useState<ReorderSuggestion[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [lines, setLines] = useState<Record<string, DraftLineState>>({});
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
    return () => {
      cancelled = true;
    };
  }, [activeLocationId, canCreateDrafts]);

  const selectedLines = useMemo(
    () => suggestions.filter((suggestion) => lines[suggestion.itemId]?.selected),
    [lines, suggestions],
  );
  const selectedCount = selectedLines.length;
  const selectedTotal = selectedLines.reduce((sum, suggestion) => {
    const line = lines[suggestion.itemId];
    const quantity = toNumber(line?.quantity);
    const cost = toNumber(line?.unitCost);
    return sum + quantity * cost;
  }, 0);
  const selectedSupplierCount = new Set(
    selectedLines
      .map((suggestion) => lines[suggestion.itemId]?.supplierId)
      .filter(Boolean),
  ).size;

  function updateLine(itemId: string, patch: Partial<DraftLineState>) {
    setSuccess(null);
    setLines((current) => ({
      ...current,
      [itemId]: {
        ...(current[itemId] ?? {
          selected: false,
          supplierId: "",
          quantity: "",
          unitCost: "",
        }),
        ...patch,
      },
    }));
  }

  function toggleAll(checked: boolean) {
    setSuccess(null);
    setLines((current) => {
      const next = { ...current };
      for (const suggestion of suggestions) {
        next[suggestion.itemId] = {
          ...next[suggestion.itemId],
          selected: checked && Boolean(next[suggestion.itemId]?.supplierId),
        };
      }
      return next;
    });
  }

  async function handleCreateDrafts() {
    if (!canCreateDrafts) return;
    setSuccess(null);
    setError(null);

    const items = selectedLines.map((suggestion) => {
      const line = lines[suggestion.itemId];
      return {
        itemId: suggestion.itemId,
        supplierId: line.supplierId,
        quantity: toNumber(line.quantity),
        unitCost: toNumber(line.unitCost),
      };
    });

    if (items.length === 0) {
      setError("Select at least one reorder item.");
      return;
    }
    if (items.some((item) => !item.supplierId)) {
      setError("Choose a supplier for every selected item.");
      return;
    }
    if (items.some((item) => item.quantity <= 0)) {
      setError("Quantity must be greater than zero for every selected item.");
      return;
    }
    if (items.some((item) => item.unitCost < 0)) {
      setError("Unit cost cannot be negative.");
      return;
    }

    setCreating(true);
    try {
      const res = await createReorderPurchases({ locationId: activeLocationId ?? undefined, items });
      const purchaseLabel = res.purchases.length === 1 ? "purchase draft" : "purchase drafts";
      setSuccess(`Created ${res.purchases.length} ${purchaseLabel}.`);
      if (res.purchases[0]) {
        navigate(`/purchases?purchaseId=${encodeURIComponent(res.purchases[0].id)}&fromReorder=${res.purchases.length}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create purchase drafts");
    } finally {
      setCreating(false);
    }
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
    return (
      <div className="page-error">
        <div className="alert alert--error">{error}</div>
      </div>
    );
  }

  return (
    <div className="reorder-page">
      <div className="page-header reorder-page-header">
        <div>
          <h1 className="page-title">Reorder Suggestions</h1>
          <p className="page-subtitle">
            Convert low-stock items into purchase drafts for the active branch.
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
          <div className="reorder-toolbar">
            <label className="reorder-select-all">
              <input
                type="checkbox"
                checked={selectedCount > 0 && selectedCount === suggestions.filter((s) => lines[s.itemId]?.supplierId).length}
                onChange={(event) => toggleAll(event.target.checked)}
                disabled={!canCreateDrafts || suppliers.length === 0}
              />
              <span>Select ready items</span>
            </label>
            <div className="reorder-toolbar-summary">
              <span>{selectedCount} selected</span>
              <strong>{formatCurrency(selectedTotal, settings.currency)}</strong>
              {selectedSupplierCount > 1 && <em>{selectedSupplierCount} suppliers, separate drafts</em>}
            </div>
            {canCreateDrafts ? (
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleCreateDrafts}
                disabled={creating || selectedCount === 0}
              >
                {creating ? "Creating..." : "Create Purchase Draft"}
              </button>
            ) : (
              <span className="reorder-view-note">View only</span>
            )}
          </div>

          {canCreateDrafts && suppliers.length === 0 && (
            <div className="reorder-supplier-warning">
              Add at least one supplier before creating purchase drafts from reorder suggestions.
            </div>
          )}

          <div className="reorder-list" aria-label="Reorder suggestions">
            {suggestions.map((suggestion) => {
              const line = lines[suggestion.itemId] ?? {
                selected: false,
                supplierId: "",
                quantity: String(suggestion.suggestedQuantity),
                unitCost: String(suggestion.lastPurchaseCost ?? 0),
              };
              const itemTotal = toNumber(line.quantity) * toNumber(line.unitCost);
              const noSupplier = canCreateDrafts && suppliers.length > 0 && !line.supplierId;

              return (
                <article
                  key={suggestion.itemId}
                  className={`reorder-card${line.selected ? " reorder-card--selected" : ""}${noSupplier ? " reorder-card--needs-supplier" : ""}`}
                >
                  <label className="reorder-card-check">
                    <input
                      type="checkbox"
                      checked={line.selected}
                      disabled={!canCreateDrafts || !line.supplierId}
                      onChange={(event) => updateLine(suggestion.itemId, { selected: event.target.checked })}
                      aria-label={`Select ${suggestion.itemName}`}
                    />
                  </label>

                  <div className="reorder-card-main">
                    <div className="reorder-item-head">
                      <div>
                        <h2>{suggestion.itemName}</h2>
                        <p>
                          {suggestion.sku ? `SKU ${suggestion.sku}` : "No SKU"}
                          {suggestion.barcode ? ` - ${suggestion.barcode}` : ""}
                        </p>
                      </div>
                      <div className="reorder-item-tags">
                        {suggestion.category && <span>{suggestion.category}</span>}
                        {suggestion.trackExpiry && <span>Expiry tracked</span>}
                      </div>
                    </div>

                    <div className="reorder-stock-grid">
                      <Metric label="Current" value={`${formatNumber(suggestion.currentStock)} ${suggestion.unit}`} tone="danger" />
                      <Metric label="Minimum" value={`${formatNumber(suggestion.minStockLevel)} ${suggestion.unit}`} />
                      <Metric label="Suggested" value={`${formatNumber(suggestion.suggestedQuantity)} ${suggestion.unit}`} tone="accent" />
                      <Metric label="Location" value={suggestion.location.name} />
                    </div>
                  </div>

                  <div className="reorder-card-controls">
                    {canCreateDrafts ? (
                      <>
                        <label className="form-label">
                          Supplier
                          <select
                            className="form-input"
                            value={line.supplierId}
                            onChange={(event) => updateLine(suggestion.itemId, {
                              supplierId: event.target.value,
                              selected: event.target.value ? line.selected : false,
                            })}
                            disabled={suppliers.length === 0}
                          >
                            <option value="">Select supplier</option>
                            {suppliers.map((supplier) => (
                              <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                            ))}
                          </select>
                        </label>
                        <label className="form-label">
                          Qty
                          <input
                            className="form-input"
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.quantity}
                            onChange={(event) => updateLine(suggestion.itemId, { quantity: event.target.value })}
                          />
                        </label>
                        <label className="form-label">
                          Unit cost
                          <input
                            className="form-input"
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.unitCost}
                            onChange={(event) => updateLine(suggestion.itemId, { unitCost: event.target.value })}
                          />
                        </label>
                        <div className="reorder-line-total">
                          <span>Line total</span>
                          <strong>{formatCurrency(itemTotal, settings.currency)}</strong>
                        </div>
                      </>
                    ) : (
                      <div className="reorder-readonly-supplier">
                        <span>Supplier</span>
                        <strong>{suggestion.preferredSupplier?.name ?? "Not assigned"}</strong>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function buildInitialLines(suggestions: ReorderSuggestion[]) {
  return Object.fromEntries(
    suggestions.map((suggestion) => [
      suggestion.itemId,
      {
        selected: false,
        supplierId: suggestion.preferredSupplier?.id ?? "",
        quantity: String(suggestion.suggestedQuantity),
        unitCost: String(suggestion.lastPurchaseCost ?? 0),
      },
    ]),
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "danger" | "accent";
}) {
  return (
    <div className={`reorder-metric reorder-metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function toNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}
