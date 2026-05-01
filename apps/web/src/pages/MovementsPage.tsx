import { useEffect, useMemo, useState } from "react";
import { getItems } from "../api/items";
import { getStockMovements } from "../api/stock";
import { useLocation } from "../context/LocationContext";
import { useWorkspaceSettings } from "../context/WorkspaceSettingsContext";
import type { Item, StockMovement, StockMovementFilters, StockMovementType } from "../types";
import { formatCurrency } from "../utils/currency";

const MOVEMENT_TYPES: Array<{ value: StockMovementType; label: string }> = [
  { value: "STOCK_IN", label: "Stock In" },
  { value: "STOCK_OUT", label: "Stock Out" },
  { value: "WASTAGE", label: "Wastage" },
  { value: "ADJUSTMENT", label: "Adjustment" },
  { value: "TRANSFER_IN", label: "Transfer In" },
  { value: "TRANSFER_OUT", label: "Transfer Out" },
];

const MOVEMENT_LABELS = Object.fromEntries(
  MOVEMENT_TYPES.map((type) => [type.value, type.label]),
) as Record<StockMovementType, string>;

function wastageTotal(movements: StockMovement[]) {
  const wastageMvts = movements.filter((m) => m.type === "WASTAGE");
  const qty = wastageMvts.reduce((acc, m) => acc + m.quantity, 0);
  const value = wastageMvts.reduce((acc, m) => acc + m.quantity * (m.unitCost ?? 0), 0);

  const byItem = new Map<string, { name: string; qty: number }>();
  for (const m of wastageMvts) {
    const prev = byItem.get(m.item.id) ?? { name: m.item.name, qty: 0 };
    byItem.set(m.item.id, { name: m.item.name, qty: prev.qty + m.quantity });
  }
  const topItem = [...byItem.values()].sort((a, b) => b.qty - a.qty)[0] ?? null;

  return { qty, value, count: wastageMvts.length, topItem };
}

export function MovementsPage() {
  const { activeLocationId } = useLocation();
  const { settings } = useWorkspaceSettings();
  const [items, setItems] = useState<Item[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [filters, setFilters] = useState<StockMovementFilters>({});
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const itemOptions = useMemo(
    () => [...items].sort((first, second) => first.name.localeCompare(second.name)),
    [items],
  );

  useEffect(() => {
    async function loadItems() {
      try {
        const res = await getItems();
        setItems(res.items);
      } catch {
        setItems([]);
      }
    }
    void loadItems();
  }, []);

  useEffect(() => {
    async function loadMovements() {
      setLoading(true);
      try {
        const res = await getStockMovements(filters);
        setMovements(res.movements);
        setFetchError(null);
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : "Failed to load movements");
      } finally {
        setLoading(false);
      }
    }
    void loadMovements();
  }, [filters, activeLocationId]);

  const isWastageOnly = filters.type === "WASTAGE";
  const { qty: wQty, value: wValue, count: wCount, topItem: wTopItem } = wastageTotal(movements);
  const showSummary = wCount > 0;
  const wastagePercent =
    movements.length > 0 ? Math.round((wCount / movements.length) * 100) : 0;

  function toggleWastageFilter() {
    setFilters((prev) =>
      prev.type === "WASTAGE"
        ? { ...prev, type: undefined }
        : { ...prev, type: "WASTAGE" },
    );
  }

  return (
    <div className="movements-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Movements</h1>
          <p className="page-subtitle">Review stock activity across your workspace</p>
        </div>
      </div>

      <div className="movement-filters">
        <label className="form-group">
          <span className="form-label">Type</span>
          <select
            className="form-select"
            value={filters.type ?? ""}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                type: (e.target.value || undefined) as StockMovementType | undefined,
              }))
            }
          >
            <option value="">All types</option>
            {MOVEMENT_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </label>

        <label className="form-group">
          <span className="form-label">Item</span>
          <select
            className="form-select"
            value={filters.itemId ?? ""}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, itemId: e.target.value || undefined }))
            }
          >
            <option value="">All items</option>
            {itemOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label className="form-group">
          <span className="form-label">From</span>
          <input
            className="form-input"
            type="date"
            value={filters.fromDate ?? ""}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, fromDate: e.target.value || undefined }))
            }
          />
        </label>

        <label className="form-group">
          <span className="form-label">To</span>
          <input
            className="form-input"
            type="date"
            value={filters.toDate ?? ""}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, toDate: e.target.value || undefined }))
            }
          />
        </label>

        <div className="form-group form-group--align-end">
          <button
            className={`btn btn--sm ${isWastageOnly ? "btn--wastage-active" : "btn--wastage"}`}
            onClick={toggleWastageFilter}
            title="Show only wastage movements"
          >
            <WastageIcon />
            {isWastageOnly ? "All types" : "Wastage only"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="page-loading">
          <div className="spinner" />
          <p>Loading movements...</p>
        </div>
      ) : fetchError ? (
        <div className="page-error">
          <div className="alert alert--error">{fetchError}</div>
        </div>
      ) : movements.length === 0 ? (
        <div className="empty-state">
          <p>No stock movements found.</p>
        </div>
      ) : (
        <>
          {showSummary && (
            <div className="wastage-summary">
              <WastageIcon />
              <span>
                <strong>{wCount}</strong> wastage movement{wCount !== 1 ? "s" : ""}
              </span>
              <span className="wastage-summary-sep">·</span>
              <span>
                Total qty <strong>{formatNumber(wQty)}</strong>
              </span>
              <span className="wastage-summary-sep">·</span>
              <span>
                Est. value lost <strong>{formatCurrency(wValue, settings.currency)}</strong>
              </span>
              {wTopItem && (
                <>
                  <span className="wastage-summary-sep">·</span>
                  <span>
                    Top wasted: <strong>{wTopItem.name}</strong>{" "}
                    <span className="wastage-summary-muted">({formatNumber(wTopItem.qty)} units)</span>
                  </span>
                </>
              )}
              {!isWastageOnly && (
                <>
                  <span className="wastage-summary-sep">·</span>
                  <span className="wastage-summary-pct">
                    {wastagePercent}% of visible movements
                  </span>
                </>
              )}
            </div>
          )}
          <MovementTable movements={movements} />
          <MovementCards movements={movements} />
        </>
      )}
    </div>
  );
}

function MovementTable({ movements }: { movements: StockMovement[] }) {
  return (
    <div className="table-wrap movements-table">
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Item</th>
            <th>Type</th>
            <th className="text-right">Quantity</th>
            <th className="text-right">Unit Cost</th>
            <th>Reason</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((movement) => (
            <tr
              key={movement.id}
              className={movement.type === "WASTAGE" ? "row--wastage" : ""}
            >
              <td className="td-expiry">{formatDateTime(movement.createdAt)}</td>
              <td className="td-name">{movement.item.name}</td>
              <td>
                <MovementBadge type={movement.type} />
              </td>
              <td className="text-right td-num">{formatNumber(movement.quantity)}</td>
              <td className="text-right td-num">{formatMoney(movement.unitCost)}</td>
              <td className="td-unit">{movement.reason || "-"}</td>
              <td className="td-unit">{movement.note || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MovementCards({ movements }: { movements: StockMovement[] }) {
  return (
    <div className="movement-card-list">
      {movements.map((movement) => (
        <article
          key={movement.id}
          className={`movement-card ${movement.type === "WASTAGE" ? "movement-card--wastage" : ""}`}
        >
          <div className="movement-card-head">
            <div>
              <h2 className="movement-card-title">{movement.item.name}</h2>
              <p className="movement-card-date">{formatDateTime(movement.createdAt)}</p>
            </div>
            <MovementBadge type={movement.type} />
          </div>
          <dl className="movement-card-grid">
            <div>
              <dt>Quantity</dt>
              <dd>{formatNumber(movement.quantity)}</dd>
            </div>
            <div>
              <dt>Unit Cost</dt>
              <dd>{formatMoney(movement.unitCost)}</dd>
            </div>
            <div>
              <dt>Reason</dt>
              <dd>{movement.reason || "-"}</dd>
            </div>
            <div>
              <dt>Note</dt>
              <dd>{movement.note || "-"}</dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
}

function MovementBadge({ type }: { type: StockMovementType }) {
  return (
    <span className={`badge movement-badge movement-badge--${type.toLowerCase()}`}>
      {type === "WASTAGE" && <WastageIcon />}
      {MOVEMENT_LABELS[type]}
    </span>
  );
}

function WastageIcon() {
  return (
    <svg
      className="wastage-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function formatMoney(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}
