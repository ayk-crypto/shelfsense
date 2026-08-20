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
import "./ItemControlCenter.css";

const BATCH_STATUS_LABELS: Record<BatchStatus, string> = {
  ACTIVE: "Active",
  EXPIRING_SOON: "Expiring soon",
  EXPIRED: "Expired",
  DEPLETED: "Depleted",
};

const EXPIRY_STATUS_LABELS: Record<BatchExpiryStatus, string> = {
  EXPIRED: "Expired",
  EXPIRING_SOON: "Expiring soon",
  HEALTHY: "Healthy",
  NO_EXPIRY: "No expiry",
};

const MOVEMENT_TYPES: Array<{ value: StockMovementType; label: string }> = [
  { value: "STOCK_IN", label: "Received" },
  { value: "STOCK_OUT", label: "Used" },
  { value: "WASTAGE", label: "Wastage" },
  { value: "ADJUSTMENT", label: "Adjustment" },
  { value: "TRANSFER_IN", label: "Transfer in" },
  { value: "TRANSFER_OUT", label: "Transfer out" },
];

const MOVEMENT_LABELS = Object.fromEntries(MOVEMENT_TYPES.map((type) => [type.value, type.label])) as Record<StockMovementType, string>;

export function BatchDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { settings } = useWorkspaceSettings();
  const [data, setData] = useState<BatchDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [locationFilter, setLocationFilter] = useState("");
  const [batchStatusFilter, setBatchStatusFilter] = useState<BatchStatus | "">("");
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
        if (!cancelled) setFetchError(err instanceof Error ? err.message : "Failed to load item");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadDetail();
    return () => { cancelled = true; };
  }, [id]);

  const locationOptions = useMemo(() => {
    if (!data) return [];
    const byId = new Map<string, string>();
    data.batches.forEach((batch) => byId.set(batch.location.id, batch.location.name));
    data.movements.forEach((movement) => byId.set(movement.location.id, movement.location.name));
    return [...byId.entries()].map(([locationId, name]) => ({ id: locationId, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);

  const filteredBatches = useMemo(() => {
    if (!data) return [];
    return data.batches.filter((batch) => (!locationFilter || batch.location.id === locationFilter) && (!batchStatusFilter || batch.status === batchStatusFilter));
  }, [batchStatusFilter, data, locationFilter]);

  const filteredMovements = useMemo(() => {
    if (!data) return [];
    return data.movements.filter((movement) => (!locationFilter || movement.location.id === locationFilter) && (!movementTypeFilter || movement.type === movementTypeFilter));
  }, [data, locationFilter, movementTypeFilter]);

  if (loading) return <div className="page-loading"><div className="spinner" /><p>Loading item...</p></div>;
  if (fetchError || !data) return <div className="page-error"><div className="alert alert--error">{fetchError ?? "Item not found"}</div></div>;

  const { item } = data;
  const activeBatches = data.batches.filter((batch) => batch.remainingQuantity > 0);
  const expiringCount = activeBatches.filter((batch) => batch.expiryStatus === "EXPIRING_SOON").length;
  const expiredCount = activeBatches.filter((batch) => batch.expiryStatus === "EXPIRED").length;
  const recentBatch = [...data.batches].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  const recentSupplier = recentBatch?.supplier?.name ?? "Not linked from receipts";
  const purchaseUnitText = item.purchaseUnit && item.purchaseConversionFactor
    ? `${item.purchaseUnit} · 1 ${item.purchaseUnit} = ${formatNumber(item.purchaseConversionFactor)} ${item.unit}`
    : item.purchaseUnit ?? "Same as stock unit";
  const healthCopy = item.statuses.hasExpired
    ? `${expiredCount} expired batch${expiredCount === 1 ? "" : "es"} needs attention.`
    : item.statuses.hasExpiringSoon
      ? `${expiringCount} batch${expiringCount === 1 ? "" : "es"} expiring soon.`
      : item.statuses.isLowStock
        ? "Stock is below the configured minimum level."
        : "Stock position looks healthy.";

  return (
    <div className="icc-page">
      <button type="button" className="btn btn--ghost btn--sm icc-back" onClick={() => navigate("/items")}>← Back to Items</button>

      <section className="icc-hero">
        <div className="icc-title-block">
          <span className="daily-ops-kicker">Item Control Center</span>
          <div className="icc-title-line">
            <h1 className="page-title">{item.name}</h1>
            <ItemStatusCluster item={item} />
          </div>
          <p className="page-subtitle">
            {item.category || "Uncategorized"} · Stock unit {item.unit}
            {item.sku ? ` · SKU ${item.sku}` : ""}
            {item.barcode ? ` · ${item.barcode}` : ""}
          </p>
        </div>
        {item.isActive && (
          <div className="icc-actions" aria-label="Item actions">
            <button className="btn btn--primary" onClick={() => navigate("/stock-in")}>Receive Stock</button>
            <button className="btn btn--secondary" onClick={() => navigate("/stock-out")}>Use Stock</button>
            <button className="btn btn--secondary" onClick={() => navigate("/stock-count")}>Count Stock</button>
            <button className="btn btn--ghost" onClick={() => navigate("/reorder-suggestions")}>To Order</button>
          </div>
        )}
      </section>

      <section className={`icc-attention ${item.statuses.hasExpired ? "icc-attention--danger" : item.statuses.hasExpiringSoon || item.statuses.isLowStock ? "icc-attention--warn" : "icc-attention--good"}`}>
        <div>
          <strong>{item.statuses.hasExpired || item.statuses.hasExpiringSoon || item.statuses.isLowStock ? "Needs attention" : "No urgent action"}</strong>
          <span>{healthCopy}</span>
        </div>
        {(item.statuses.isLowStock || item.statuses.hasExpired || item.statuses.hasExpiringSoon) && (
          <button type="button" className="btn btn--sm btn--secondary" onClick={() => item.statuses.isLowStock ? navigate("/reorder-suggestions") : setBatchStatusFilter(item.statuses.hasExpired ? "EXPIRED" : "EXPIRING_SOON")}>Review</button>
        )}
      </section>

      <section className="icc-kpis" aria-label="Item overview">
        <OverviewCard label="Current stock" value={`${formatNumber(item.totalCurrentStock)} ${item.unit}`} tone={item.statuses.isLowStock ? "warn" : "normal"} />
        <OverviewCard label="Minimum level" value={`${formatNumber(item.minStockLevel)} ${item.unit}`} />
        <OverviewCard label="Stock value" value={formatCurrency(item.totalStockValue, settings.currency)} />
        <OverviewCard label="Nearest expiry" value={item.nearestExpiryDate ? formatDate(item.nearestExpiryDate) : "No expiry"} tone={item.statuses.hasExpired ? "danger" : item.statuses.hasExpiringSoon ? "warn" : "normal"} />
      </section>

      <section className="icc-info-grid">
        <InfoCard title="Purchasing">
          <InfoRow label="Purchase unit" value={purchaseUnitText} />
          <InfoRow label="Recent supplier" value={recentSupplier} />
          <InfoRow label="Last received" value={item.lastReceivedDate ? formatDate(item.lastReceivedDate) : "No receipt recorded"} />
          <InfoRow label="Lead time" value={item.procurementLeadTimeDays != null ? `${item.procurementLeadTimeDays} days` : "Not configured"} />
        </InfoCard>
        <InfoCard title="Stock rules">
          <InfoRow label="Replenishment" value={item.replenishmentMode === "DAYS_BASED" ? "Days based" : "Manual threshold"} />
          <InfoRow label="Critical level" value={item.criticalStockLevel != null ? `${formatNumber(item.criticalStockLevel)} ${item.unit}` : "Not configured"} />
          <InfoRow label="Par level" value={item.parStockLevel != null ? `${formatNumber(item.parStockLevel)} ${item.unit}` : "Not configured"} />
          <InfoRow label="Expiry tracking" value={item.trackExpiry ? "Enabled" : "Not required"} />
        </InfoCard>
      </section>

      <section className="icc-filterbar" aria-label="Item history filters">
        <select className="form-select" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)}>
          <option value="">All locations</option>
          {locationOptions.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
        <select className="form-select" value={batchStatusFilter} onChange={(e) => setBatchStatusFilter(e.target.value as BatchStatus | "")}>
          <option value="">All batches</option>
          {(Object.keys(BATCH_STATUS_LABELS) as BatchStatus[]).map((status) => <option key={status} value={status}>{BATCH_STATUS_LABELS[status]}</option>)}
        </select>
        <select className="form-select" value={movementTypeFilter} onChange={(e) => setMovementTypeFilter(e.target.value as StockMovementType | "")}>
          <option value="">All activity</option>
          {MOVEMENT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
        </select>
        {(locationFilter || batchStatusFilter || movementTypeFilter) && <button className="btn btn--ghost btn--sm" onClick={() => { setLocationFilter(""); setBatchStatusFilter(""); setMovementTypeFilter(""); }}>Clear</button>}
      </section>

      <section className="icc-section">
        <div className="icc-section-head"><div><h2>Stock & batches</h2><p>What is physically available, where it is, who supplied it, and when it expires.</p></div><span>{filteredBatches.length}</span></div>
        {filteredBatches.length === 0 ? <EmptyPanel title="No batches match" copy="Clear the filters or receive stock for this item." /> : <BatchList batches={filteredBatches} currency={settings.currency} unit={item.unit} />}
      </section>

      <section className="icc-section">
        <div className="icc-section-head"><div><h2>Recent activity</h2><p>Receipts, usage, wastage, adjustments and transfers for this item.</p></div><span>{filteredMovements.length}</span></div>
        {filteredMovements.length === 0 ? <EmptyPanel title="No activity found" copy="Stock movements for this item will appear here." /> : <MovementList movements={filteredMovements} unit={item.unit} />}
      </section>
    </div>
  );
}

function ItemStatusCluster({ item }: { item: BatchDetailResponse["item"] }) {
  const statuses = [
    !item.isActive ? { label: "Archived", tone: "gray" } : null,
    item.statuses.hasExpired ? { label: "Expired", tone: "danger" } : null,
    item.statuses.hasExpiringSoon ? { label: "Expiring", tone: "warn" } : null,
    item.statuses.isLowStock ? { label: "Low stock", tone: "warn" } : null,
  ].filter((entry): entry is { label: string; tone: string } => entry !== null);
  if (statuses.length === 0) statuses.push({ label: "Healthy", tone: "good" });
  return <div className="icc-statuses">{statuses.map((status) => <span key={status.label} className={`icc-status icc-status--${status.tone}`}>{status.label}</span>)}</div>;
}

function OverviewCard({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "warn" | "danger" }) {
  return <article className={`icc-kpi icc-kpi--${tone}`}><span>{label}</span><strong>{value}</strong></article>;
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <article className="icc-info-card"><h2>{title}</h2><div>{children}</div></article>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="icc-info-row"><span>{label}</span><strong>{value}</strong></div>;
}

function BatchList({ batches, currency, unit }: { batches: BatchDetailBatch[]; currency: string; unit: string }) {
  return <div className="icc-list">{batches.map((batch) => (
    <article key={batch.id} className="icc-list-row">
      <div className="icc-list-main"><div className="icc-list-title"><strong>{batch.batchNo || "Auto batch"}</strong><BatchStatusBadge status={batch.status} /></div><span>{batch.location.name} · Received {formatDate(batch.createdAt)} · {batch.supplier?.name ?? "Supplier not recorded"}</span></div>
      <div className="icc-list-metric"><span>Remaining</span><strong>{formatNumber(batch.remainingQuantity)} {unit}</strong></div>
      <div className="icc-list-metric"><span>Value</span><strong>{formatCurrency(batch.totalValue, currency)}</strong></div>
      <div className="icc-list-metric"><span>Expiry</span><strong>{batch.expiryDate ? formatDate(batch.expiryDate) : "Not tracked"}</strong></div>
    </article>
  ))}</div>;
}

function MovementList({ movements, unit }: { movements: BatchDetailMovement[]; unit: string }) {
  return <div className="icc-list">{movements.map((movement) => (
    <article key={movement.id} className="icc-list-row icc-list-row--movement">
      <div className="icc-list-main"><div className="icc-list-title"><strong>{MOVEMENT_LABELS[movement.type]}</strong><MovementBadge type={movement.type} /></div><span>{formatDateTime(movement.createdAt)} · {movement.location.name}{movement.batchNo ? ` · ${movement.batchNo}` : ""}</span></div>
      <div className="icc-list-metric"><span>Quantity</span><strong>{formatNumber(movement.quantity)} {unit}</strong></div>
      <div className="icc-list-note"><span>{movement.reason || movement.note || "No note"}</span></div>
    </article>
  ))}</div>;
}

function BatchStatusBadge({ status }: { status: BatchStatus }) {
  const tone = status === "EXPIRED" ? "danger" : status === "EXPIRING_SOON" ? "warn" : status === "DEPLETED" ? "gray" : "good";
  return <span className={`icc-status icc-status--${tone}`}>{BATCH_STATUS_LABELS[status]}</span>;
}

function MovementBadge({ type }: { type: StockMovementType }) {
  return <span className="icc-movement-badge">{MOVEMENT_LABELS[type]}</span>;
}

function EmptyPanel({ title, copy }: { title: string; copy: string }) {
  return <div className="icc-empty"><strong>{title}</strong><span>{copy}</span></div>;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
