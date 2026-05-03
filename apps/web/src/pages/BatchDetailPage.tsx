import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getItemBatchesDetail } from "../api/items";
import { useWorkspaceSettings } from "../context/WorkspaceSettingsContext";
import type {
  BatchDetailBatch,
  BatchDetailMovement,
  BatchDetailResponse,
  BatchExpiryStatus,
  BatchStatus,
  StockMovementType,
} from "../types";
import { formatCurrency } from "../utils/currency";

const BATCH_STATUS_LABELS: Record<BatchStatus, string> = {
  ACTIVE: "Active",
  EXPIRING_SOON: "Expiring Soon",
  EXPIRED: "Expired",
  DEPLETED: "Depleted",
};

const EXPIRY_STATUS_LABELS: Record<BatchExpiryStatus, string> = {
  EXPIRED: "Expired",
  EXPIRING_SOON: "Expiring Soon",
  HEALTHY: "Healthy",
  NO_EXPIRY: "No expiry tracked",
};

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

export function BatchDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { settings } = useWorkspaceSettings();
  const [data, setData] = useState<BatchDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [locationFilter, setLocationFilter] = useState("");
  const [batchStatusFilter, setBatchStatusFilter] = useState<BatchStatus | "">("");
  const [expiryStatusFilter, setExpiryStatusFilter] = useState<BatchExpiryStatus | "">("");
  const [movementTypeFilter, setMovementTypeFilter] = useState<StockMovementType | "">("");

  useEffect(() => {
    let cancelled = false;

    async function loadDetail() {
      if (!id) return;
      setLoading(true);
      try {
        const res = await getItemBatchesDetail(id);
        if (!cancelled) {
          setData(res);
          setFetchError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setFetchError(err instanceof Error ? err.message : "Failed to load batch details");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const locationOptions = useMemo(() => {
    if (!data) return [];
    const byId = new Map<string, string>();
    for (const batch of data.batches) byId.set(batch.location.id, batch.location.name);
    for (const movement of data.movements) byId.set(movement.location.id, movement.location.name);
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const filteredBatches = useMemo(() => {
    if (!data) return [];
    return data.batches.filter((batch) => {
      const matchesLocation = !locationFilter || batch.location.id === locationFilter;
      const matchesBatchStatus = !batchStatusFilter || batch.status === batchStatusFilter;
      const matchesExpiryStatus = !expiryStatusFilter || batch.expiryStatus === expiryStatusFilter;
      return matchesLocation && matchesBatchStatus && matchesExpiryStatus;
    });
  }, [batchStatusFilter, data, expiryStatusFilter, locationFilter]);

  const filteredMovements = useMemo(() => {
    if (!data) return [];
    return data.movements.filter((movement) => {
      const matchesLocation = !locationFilter || movement.location.id === locationFilter;
      const matchesType = !movementTypeFilter || movement.type === movementTypeFilter;
      return matchesLocation && matchesType;
    });
  }, [data, locationFilter, movementTypeFilter]);

  if (loading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Loading batch detail...</p>
      </div>
    );
  }

  if (fetchError || !data) {
    return (
      <div className="page-error">
        <div className="alert alert--error">{fetchError ?? "Batch detail not found"}</div>
      </div>
    );
  }

  const { item } = data;
  const activeBatchCount = data.batches.filter((batch) => batch.remainingQuantity > 0).length;
  const depletedBatchCount = data.batches.length - activeBatchCount;

  return (
    <div className="batch-detail-page">
      <section className="batch-detail-hero">
        <button type="button" className="btn btn--ghost btn--sm batch-detail-back" onClick={() => navigate("/items")}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </svg>
          Back to inventory
        </button>
        <div className="batch-detail-hero-main">
          <div>
            <span className="daily-ops-kicker">Batch Detail</span>
            <h1 className="page-title">{item.name}</h1>
            <p className="page-subtitle">
              {item.category || "Uncategorized"} / {item.unit}
              {item.sku ? ` / SKU ${item.sku}` : ""}
              {item.barcode ? ` / Barcode ${item.barcode}` : ""}
            </p>
          </div>
          <ItemStatusCluster
            isLowStock={item.statuses.isLowStock}
            hasExpired={item.statuses.hasExpired}
            hasExpiringSoon={item.statuses.hasExpiringSoon}
            isArchived={!item.isActive}
          />
        </div>
      </section>

      <section className="batch-summary-grid" aria-label="Item batch summary">
        <SummaryCard label="Current stock" value={`${formatNumber(item.totalCurrentStock)} ${item.unit}`} />
        <SummaryCard label="Stock value" value={formatCurrency(item.totalStockValue, settings.currency)} />
        <SummaryCard label="Nearest expiry" value={item.nearestExpiryDate ? formatDate(item.nearestExpiryDate) : "No expiry"} tone={item.statuses.hasExpired ? "danger" : item.statuses.hasExpiringSoon ? "warn" : "normal"} />
        <SummaryCard label="Min level" value={`${formatNumber(item.minStockLevel)} ${item.unit}`} tone={item.statuses.isLowStock ? "warn" : "normal"} />
        <SummaryCard label="Active batches" value={String(activeBatchCount)} />
        <SummaryCard label="Depleted batches" value={String(depletedBatchCount)} />
      </section>

      <section className="batch-detail-filters" aria-label="Batch detail filters">
        <label className="form-group">
          <span className="form-label">Location</span>
          <select className="form-select" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
            <option value="">All locations</option>
            {locationOptions.map((location) => (
              <option key={location.id} value={location.id}>{location.name}</option>
            ))}
          </select>
        </label>
        <label className="form-group">
          <span className="form-label">Batch status</span>
          <select className="form-select" value={batchStatusFilter} onChange={(e) => setBatchStatusFilter(e.target.value as BatchStatus | "")}>
            <option value="">All statuses</option>
            {(Object.keys(BATCH_STATUS_LABELS) as BatchStatus[]).map((status) => (
              <option key={status} value={status}>{BATCH_STATUS_LABELS[status]}</option>
            ))}
          </select>
        </label>
        <label className="form-group">
          <span className="form-label">Expiry status</span>
          <select className="form-select" value={expiryStatusFilter} onChange={(e) => setExpiryStatusFilter(e.target.value as BatchExpiryStatus | "")}>
            <option value="">All expiry states</option>
            {(Object.keys(EXPIRY_STATUS_LABELS) as BatchExpiryStatus[]).map((status) => (
              <option key={status} value={status}>{EXPIRY_STATUS_LABELS[status]}</option>
            ))}
          </select>
        </label>
        <label className="form-group">
          <span className="form-label">Movement type</span>
          <select className="form-select" value={movementTypeFilter} onChange={(e) => setMovementTypeFilter(e.target.value as StockMovementType | "")}>
            <option value="">All movements</option>
            {MOVEMENT_TYPES.map((type) => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="batch-detail-section">
        <div className="batch-detail-section-head">
          <div>
            <h2>Stock batches</h2>
            <p>Remaining quantity, value, supplier, expiry, and branch for each received batch.</p>
          </div>
          <span>{filteredBatches.length} shown</span>
        </div>
        {filteredBatches.length === 0 ? (
          <EmptyPanel title="No batches match these filters" copy="Clear filters or receive stock for this item to create active batches." />
        ) : (
          <>
            <BatchTable batches={filteredBatches} currency={settings.currency} />
            <BatchCards batches={filteredBatches} currency={settings.currency} />
          </>
        )}
      </section>

      <section className="batch-detail-section">
        <div className="batch-detail-section-head">
          <div>
            <h2>Movement history</h2>
            <p>Recent stock activity for this item, including batch references when available.</p>
          </div>
          <span>{filteredMovements.length} shown</span>
        </div>
        {filteredMovements.length === 0 ? (
          <EmptyPanel title="No movements match these filters" copy="Stock in, stock out, transfers, adjustments, and count adjustments will appear here." />
        ) : (
          <>
            <MovementTable movements={filteredMovements} />
            <MovementCards movements={filteredMovements} />
          </>
        )}
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: string;
  tone?: "normal" | "warn" | "danger";
}) {
  return (
    <article className={`batch-summary-card batch-summary-card--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function ItemStatusCluster({
  isLowStock,
  hasExpired,
  hasExpiringSoon,
  isArchived,
}: {
  isLowStock: boolean;
  hasExpired: boolean;
  hasExpiringSoon: boolean;
  isArchived: boolean;
}) {
  const statuses = [
    isArchived ? { label: "Archived", tone: "gray" } : null,
    isLowStock ? { label: "Low stock", tone: "warn" } : null,
    hasExpired ? { label: "Expired batch", tone: "danger" } : null,
    hasExpiringSoon ? { label: "Expiring soon", tone: "warn" } : null,
  ].filter((status): status is { label: string; tone: string } => status !== null);

  if (statuses.length === 0) {
    statuses.push({ label: "Healthy", tone: "good" });
  }

  return (
    <div className="batch-status-cluster">
      {statuses.map((status) => (
        <span key={status.label} className={`batch-status-pill batch-status-pill--${status.tone}`}>
          {status.label}
        </span>
      ))}
    </div>
  );
}

function BatchTable({ batches, currency }: { batches: BatchDetailBatch[]; currency: string }) {
  return (
    <div className="table-wrap batch-detail-table-wrap">
      <table className="table batch-detail-table">
        <thead>
          <tr>
            <th>Batch</th>
            <th>Location</th>
            <th className="text-right">Remaining</th>
            <th className="text-right">Original</th>
            <th className="text-right">Unit Cost</th>
            <th className="text-right">Value</th>
            <th>Supplier</th>
            <th>Expiry</th>
            <th>Received</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => (
            <tr key={batch.id}>
              <td className="td-unit">{batch.batchNo || "No batch #"}</td>
              <td>{batch.location.name}</td>
              <td className="text-right td-num">{formatNumber(batch.remainingQuantity)}</td>
              <td className="text-right td-num">{formatNumber(batch.originalQuantity)}</td>
              <td className="text-right td-num">{formatMoney(batch.unitCost, currency)}</td>
              <td className="text-right td-num">{formatCurrency(batch.totalValue, currency)}</td>
              <td>{batch.supplier?.name ?? "-"}</td>
              <td><ExpiryBadge status={batch.expiryStatus} date={batch.expiryDate} /></td>
              <td className="td-expiry">{formatDate(batch.createdAt)}</td>
              <td><BatchStatusBadge status={batch.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BatchCards({ batches, currency }: { batches: BatchDetailBatch[]; currency: string }) {
  return (
    <div className="batch-card-list">
      {batches.map((batch) => (
        <article key={batch.id} className="batch-card">
          <div className="batch-card-head">
            <div>
              <h3>{batch.batchNo || "No batch #"}</h3>
              <p>{batch.location.name} / Received {formatDate(batch.createdAt)}</p>
            </div>
            <BatchStatusBadge status={batch.status} />
          </div>
          <dl className="batch-card-grid">
            <div><dt>Remaining</dt><dd>{formatNumber(batch.remainingQuantity)}</dd></div>
            <div><dt>Original</dt><dd>{formatNumber(batch.originalQuantity)}</dd></div>
            <div><dt>Unit Cost</dt><dd>{formatMoney(batch.unitCost, currency)}</dd></div>
            <div><dt>Value</dt><dd>{formatCurrency(batch.totalValue, currency)}</dd></div>
            <div><dt>Supplier</dt><dd>{batch.supplier?.name ?? "-"}</dd></div>
            <div><dt>Expiry</dt><dd><ExpiryBadge status={batch.expiryStatus} date={batch.expiryDate} /></dd></div>
          </dl>
        </article>
      ))}
    </div>
  );
}

function MovementTable({ movements }: { movements: BatchDetailMovement[] }) {
  return (
    <div className="table-wrap batch-detail-table-wrap">
      <table className="table batch-detail-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th className="text-right">Quantity</th>
            <th>Location</th>
            <th>Batch</th>
            <th>Reason</th>
            <th>Created by</th>
            <th>Reference</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((movement) => (
            <tr key={movement.id}>
              <td className="td-expiry">{formatDateTime(movement.createdAt)}</td>
              <td><MovementBadge type={movement.type} /></td>
              <td className="text-right td-num">{formatNumber(movement.quantity)}</td>
              <td>{movement.location.name}</td>
              <td>{movement.batchNo || movement.batchId || "-"}</td>
              <td>{movement.reason || movement.note || "-"}</td>
              <td>{movement.createdBy?.name ?? "-"}</td>
              <td className="td-unit">{movement.reference ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MovementCards({ movements }: { movements: BatchDetailMovement[] }) {
  return (
    <div className="batch-card-list">
      {movements.map((movement) => (
        <article key={movement.id} className="batch-card">
          <div className="batch-card-head">
            <div>
              <h3>{MOVEMENT_LABELS[movement.type]}</h3>
              <p>{formatDateTime(movement.createdAt)} / {movement.location.name}</p>
            </div>
            <MovementBadge type={movement.type} />
          </div>
          <dl className="batch-card-grid">
            <div><dt>Quantity</dt><dd>{formatNumber(movement.quantity)}</dd></div>
            <div><dt>Batch</dt><dd>{movement.batchNo || movement.batchId || "-"}</dd></div>
            <div><dt>Reason</dt><dd>{movement.reason || "-"}</dd></div>
            <div><dt>Created by</dt><dd>{movement.createdBy?.name ?? "-"}</dd></div>
            <div><dt>Reference</dt><dd>{movement.reference ?? "-"}</dd></div>
            <div><dt>Note</dt><dd>{movement.note || "-"}</dd></div>
          </dl>
        </article>
      ))}
    </div>
  );
}

function BatchStatusBadge({ status }: { status: BatchStatus }) {
  return (
    <span className={`batch-status-pill batch-status-pill--${statusTone(status)}`}>
      {BATCH_STATUS_LABELS[status]}
    </span>
  );
}

function ExpiryBadge({ status, date }: { status: BatchExpiryStatus; date: string | null }) {
  return (
    <span className={`batch-expiry-pill batch-expiry-pill--${expiryTone(status)}`}>
      <span>{EXPIRY_STATUS_LABELS[status]}</span>
      {date && <em>{formatDate(date)}</em>}
    </span>
  );
}

function MovementBadge({ type }: { type: StockMovementType }) {
  return (
    <span className={`badge movement-badge movement-badge--${type.toLowerCase()}`}>
      {MOVEMENT_LABELS[type]}
    </span>
  );
}

function EmptyPanel({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="batch-empty-panel">
      <strong>{title}</strong>
      <span>{copy}</span>
    </div>
  );
}

function statusTone(status: BatchStatus) {
  if (status === "EXPIRED") return "danger";
  if (status === "EXPIRING_SOON") return "warn";
  if (status === "DEPLETED") return "gray";
  return "good";
}

function expiryTone(status: BatchExpiryStatus) {
  if (status === "EXPIRED") return "danger";
  if (status === "EXPIRING_SOON") return "warn";
  if (status === "NO_EXPIRY") return "gray";
  return "good";
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function formatMoney(value: number | null, currency: string) {
  return value === null ? "-" : formatCurrency(value, currency);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
