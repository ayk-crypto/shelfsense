import { useEffect, useMemo, useState } from "react";
import { getItems } from "../api/items";
import { getStockMovements } from "../api/stock";
import type { Item, StockMovement, StockMovementFilters, StockMovementType } from "../types";

const MOVEMENT_TYPES: Array<{ value: StockMovementType; label: string }> = [
  { value: "STOCK_IN", label: "Stock In" },
  { value: "STOCK_OUT", label: "Stock Out" },
  { value: "WASTAGE", label: "Wastage" },
  { value: "ADJUSTMENT", label: "Adjustment" },
];

const MOVEMENT_LABELS = Object.fromEntries(
  MOVEMENT_TYPES.map((type) => [type.value, type.label]),
) as Record<StockMovementType, string>;

export function MovementsPage() {
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
  }, [filters]);

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
            <tr key={movement.id}>
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
        <article key={movement.id} className="movement-card">
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
      {MOVEMENT_LABELS[type]}
    </span>
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
  if (value === null) {
    return "-";
  }

  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(value);
}
