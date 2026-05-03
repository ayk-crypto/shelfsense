import { useEffect, useState } from "react";
import { getAlerts } from "../api/alerts";
import { useLocation } from "../context/LocationContext";
import { useWorkspaceSettings } from "../context/WorkspaceSettingsContext";
import type { AlertsResponse, ExpiryAlert, LowStockAlert } from "../types";
import { getSuggestedReorderQuantity } from "../utils/reorder";

const EMPTY_ALERTS: AlertsResponse = {
  lowStock: [],
  expiringSoon: [],
  expired: [],
};

export function AlertsPage() {
  const { activeLocationId } = useLocation();
  const { settings } = useWorkspaceSettings();
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
  }, [activeLocationId]);

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
        <div>
          <h1 className="page-title">Inventory Alerts</h1>
          <p className="page-subtitle">
            {totalAlerts === 0
              ? "No active inventory alerts — everything looks good."
              : `${totalAlerts} active alert${totalAlerts !== 1 ? "s" : ""} requiring attention.`}
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="alrt-summary">
        <div className={`rpt-metric ${totalAlerts > 0 ? "rpt-metric--red" : "rpt-metric--green"}`}>
          <div className="rpt-metric-icon">
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
            </svg>
          </div>
          <div className="rpt-metric-body">
            <span className="rpt-metric-label">Total Active</span>
            <strong className="rpt-metric-value">{totalAlerts}</strong>
          </div>
        </div>

        <div className="rpt-metric rpt-metric--amber">
          <div className="rpt-metric-icon">
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="rpt-metric-body">
            <span className="rpt-metric-label">Low Stock</span>
            <strong className="rpt-metric-value">{alerts.lowStock.length}</strong>
          </div>
        </div>

        <div className="rpt-metric rpt-metric--orange">
          <div className="rpt-metric-icon">
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="rpt-metric-body">
            <span className="rpt-metric-label">Expiring Soon</span>
            <strong className="rpt-metric-value">{alerts.expiringSoon.length}</strong>
          </div>
        </div>

        <div className="rpt-metric rpt-metric--red">
          <div className="rpt-metric-icon">
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="rpt-metric-body">
            <span className="rpt-metric-label">Expired</span>
            <strong className="rpt-metric-value">{alerts.expired.length}</strong>
          </div>
        </div>
      </div>

      {/* All-clear state */}
      {totalAlerts === 0 && (
        <div className="alrt-all-clear">
          <div className="alrt-all-clear-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <div className="alrt-all-clear-body">
            <h2 className="alrt-all-clear-title">All clear</h2>
            <p className="alrt-all-clear-sub">
              No low stock, expiring, or expired items to report right now.
            </p>
          </div>
        </div>
      )}

      <LowStockSection items={alerts.lowStock} multiplier={settings.lowStockMultiplier} />
      <ExpirySection
        title="Expiring Soon"
        tone="orange"
        emptyText={`No batches expiring in the next ${settings.expiryAlertDays} days.`}
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

function LowStockSection({
  items,
  multiplier,
}: {
  items: LowStockAlert[];
  multiplier: number;
}) {
  if (items.length === 0) return null;
  return (
    <section className="alrt-section alrt-section--amber">
      <div className="alrt-section-header">
        <div className="alrt-section-header-left">
          <div className="alrt-section-icon alrt-section-icon--amber">
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
          <h2 className="alrt-section-title">Low Stock</h2>
        </div>
        <span className="alrt-section-badge alrt-section-badge--amber">{items.length}</span>
      </div>
      <div className="alrt-rows">
        {items.map((item) => {
          const reorder = getSuggestedReorderQuantity(
            item.quantity,
            item.minStockLevel,
            multiplier
          );
          return (
            <div key={item.itemId} className="alrt-row alrt-row--amber">
              <div className="alrt-row-main">
                <span className="alrt-row-name">{item.itemName}</span>
                <span className="alrt-row-meta">
                  {formatNumber(item.quantity)} {item.unit} available
                </span>
              </div>
              <div className="alrt-row-stats">
                <div className="alrt-stat">
                  <span className="alrt-stat-label">Min level</span>
                  <strong className="alrt-stat-value">
                    {formatNumber(item.minStockLevel)} {item.unit}
                  </strong>
                </div>
                <div className="alrt-stat">
                  <span className="alrt-stat-label">Reorder</span>
                  <strong className="alrt-stat-value alrt-stat-value--amber">
                    {formatNumber(reorder)} {item.unit}
                  </strong>
                </div>
              </div>
            </div>
          );
        })}
      </div>
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
  if (batches.length === 0) return null;
  return (
    <section className={`alrt-section alrt-section--${tone}`}>
      <div className="alrt-section-header">
        <div className="alrt-section-header-left">
          <div className={`alrt-section-icon alrt-section-icon--${tone}`}>
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
            </svg>
          </div>
          <h2 className="alrt-section-title">{title}</h2>
        </div>
        <span className={`alrt-section-badge alrt-section-badge--${tone}`}>{batches.length}</span>
      </div>
      <div className="alrt-rows">
        {batches.map((batch) => {
          const days = getDaysUntilExpiry(batch.expiryDate);
          const pillLabel =
            days < 0
              ? `${Math.abs(days)}d overdue`
              : days === 0
              ? "Expires today"
              : `${days}d left`;
          return (
            <div key={batch.id} className={`alrt-row alrt-row--${tone}`}>
              <div className="alrt-row-main">
                <span className="alrt-row-name">{batch.item.name}</span>
                <span className="alrt-row-meta">
                  {formatNumber(batch.remainingQuantity)} {batch.item.unit} remaining
                  {batch.batchNo ? ` · Batch ${batch.batchNo}` : ""}
                </span>
              </div>
              <div className="alrt-row-stats">
                <div className="alrt-stat">
                  <span className="alrt-stat-label">Expiry date</span>
                  <strong className="alrt-stat-value">{formatDate(batch.expiryDate)}</strong>
                </div>
                <div className={`alrt-days-pill alrt-days-pill--${tone}`}>{pillLabel}</div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function getDaysUntilExpiry(value: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const exp = new Date(value);
  exp.setHours(0, 0, 0, 0);
  return Math.round((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
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
