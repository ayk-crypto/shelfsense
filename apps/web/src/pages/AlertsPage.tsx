import { useEffect, useState } from "react";
import { getAlerts } from "../api/alerts";
import type { AlertsResponse, ExpiryAlert, LowStockAlert } from "../types";

const EMPTY_ALERTS: AlertsResponse = {
  lowStock: [],
  expiringSoon: [],
  expired: [],
};

export function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertsResponse>(EMPTY_ALERTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadAlerts() {
      try {
        const res = await getAlerts();
        setAlerts(res);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load alerts");
      } finally {
        setLoading(false);
      }
    }

    void loadAlerts();
  }, []);

  if (loading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Loading alerts...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-error">
        <div className="alert alert--error">{error}</div>
      </div>
    );
  }

  const totalAlerts =
    alerts.lowStock.length + alerts.expiringSoon.length + alerts.expired.length;

  return (
    <div className="alerts-page">
      <div className="page-header">
        <h1 className="page-title">Alerts</h1>
        <p className="page-subtitle">
          {totalAlerts === 0
            ? "No active inventory alerts"
            : `${totalAlerts} active inventory alerts`}
        </p>
      </div>

      <LowStockSection items={alerts.lowStock} />
      <ExpirySection
        title="Expiring Soon"
        tone="orange"
        emptyText="No batches expiring in the next 7 days."
        batches={alerts.expiringSoon}
      />
      <ExpirySection
        title="Expired"
        tone="red"
        emptyText="No expired batches with remaining stock."
        batches={alerts.expired}
      />
    </div>
  );
}

function LowStockSection({ items }: { items: LowStockAlert[] }) {
  return (
    <section className="section alert-section alert-section--yellow">
      <div className="section-header">
        <h2 className="section-title">
          Low Stock <span className="badge badge--yellow">{items.length}</span>
        </h2>
      </div>

      {items.length === 0 ? (
        <div className="empty-state">No low stock items.</div>
      ) : (
        <div className="alert-card-list">
          {items.map((item) => (
            <article key={item.itemId} className="alert-card">
              <div>
                <h3 className="alert-card-title">{item.itemName}</h3>
                <p className="alert-card-meta">
                  {formatNumber(item.quantity)} {item.unit} available
                </p>
              </div>
              <div className="alert-card-stat">
                <span>Min level</span>
                <strong>
                  {formatNumber(item.minStockLevel)} {item.unit}
                </strong>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function ExpirySection({
  title,
  tone,
  emptyText,
  batches,
}: {
  title: string;
  tone: "orange" | "red";
  emptyText: string;
  batches: ExpiryAlert[];
}) {
  return (
    <section className={`section alert-section alert-section--${tone}`}>
      <div className="section-header">
        <h2 className="section-title">
          {title} <span className={`badge badge--${tone}`}>{batches.length}</span>
        </h2>
      </div>

      {batches.length === 0 ? (
        <div className="empty-state">{emptyText}</div>
      ) : (
        <div className="alert-card-list">
          {batches.map((batch) => (
            <article key={batch.id} className="alert-card">
              <div>
                <h3 className="alert-card-title">{batch.item.name}</h3>
                <p className="alert-card-meta">
                  {formatNumber(batch.remainingQuantity)} {batch.item.unit} remaining
                  {batch.batchNo ? ` · Batch ${batch.batchNo}` : ""}
                </p>
              </div>
              <div className="alert-card-stat">
                <span>Expiry date</span>
                <strong>{formatDate(batch.expiryDate)}</strong>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}
