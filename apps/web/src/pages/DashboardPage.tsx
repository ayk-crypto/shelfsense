import { useEffect, useState } from "react";
import { getAlerts } from "../api/alerts";
import { getStockMovements, getStockSummary } from "../api/stock";
import type { AlertsResponse, StockMovement, StockSummaryItem } from "../types";
import { formatCurrency } from "../utils/currency";

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function daysUntil(dateStr: string) {
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function toYMD(d: Date) {
  return d.toISOString().slice(0, 10);
}

function wastageValue(movements: StockMovement[]) {
  return movements.reduce(
    (acc, m) => acc + m.quantity * (m.unitCost ?? 0),
    0,
  );
}

const EMPTY_ALERTS: AlertsResponse = {
  lowStock: [],
  expiringSoon: [],
  expired: [],
};

export function DashboardPage() {
  const [summary, setSummary] = useState<StockSummaryItem[]>([]);
  const [alerts, setAlerts] = useState<AlertsResponse>(EMPTY_ALERTS);
  const [wastageToday, setWastageToday] = useState(0);
  const [wastageWeek, setWastageWeek] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const today = new Date();
        const todayStr = toYMD(today);

        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
        const weekStartStr = toYMD(weekStart);

        const [summaryRes, alertsRes, wastageResToday, wastageResWeek] =
          await Promise.all([
            getStockSummary(),
            getAlerts(),
            getStockMovements({ type: "WASTAGE", fromDate: todayStr, toDate: todayStr }),
            getStockMovements({ type: "WASTAGE", fromDate: weekStartStr, toDate: todayStr }),
          ]);

        setSummary(summaryRes.summary);
        setAlerts(alertsRes);
        setWastageToday(wastageValue(wastageResToday.movements));
        setWastageWeek(wastageValue(wastageResWeek.movements));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard data");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  if (loading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Loading dashboard…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-error">
        <div className="alert alert--error">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </div>
      </div>
    );
  }

  const totalValue = summary.reduce((acc, item) => acc + item.totalValue, 0);
  const totalItems = summary.length;
  const lowStockCount = alerts.lowStock.length;
  const expiringSoonCount = alerts.expiringSoon.length;
  const expiredCount = alerts.expired.length;
  const totalAlertCount = lowStockCount + expiringSoonCount + expiredCount;

  return (
    <div className="dashboard">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">Your inventory at a glance</p>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-icon stat-icon--blue">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </div>
          <div className="stat-body">
            <span className="stat-label">Total Inventory Value</span>
            <span className="stat-value">{formatCurrency(totalValue)}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon stat-icon--green">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            </svg>
          </div>
          <div className="stat-body">
            <span className="stat-label">Total Items</span>
            <span className="stat-value">{totalItems}</span>
          </div>
        </div>

        <div className={`stat-card ${lowStockCount > 0 ? "stat-card--warn" : ""}`}>
          <div className={`stat-icon ${lowStockCount > 0 ? "stat-icon--orange" : "stat-icon--gray"}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <div className="stat-body">
            <span className="stat-label">Low Stock Items</span>
            <span className="stat-value">{lowStockCount}</span>
          </div>
        </div>

        <div className={`stat-card ${expiringSoonCount > 0 ? "stat-card--danger" : ""}`}>
          <div className={`stat-icon ${expiringSoonCount > 0 ? "stat-icon--red" : "stat-icon--gray"}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div className="stat-body">
            <span className="stat-label">Expiring Soon</span>
            <span className="stat-value">{expiringSoonCount}</span>
          </div>
        </div>

        <div className={`stat-card ${wastageWeek > 0 ? "stat-card--danger" : ""}`}>
          <div className={`stat-icon ${wastageWeek > 0 ? "stat-icon--red" : "stat-icon--gray"}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </div>
          <div className="stat-body">
            <span className="stat-label">Wastage Value</span>
            <span className="stat-value">{formatCurrency(wastageWeek)}</span>
            <span className="stat-sublabel">
              Today {formatCurrency(wastageToday)} · This week {formatCurrency(wastageWeek)}
            </span>
          </div>
        </div>
      </div>

      <div className={`alert-summary ${totalAlertCount > 0 ? "alert-summary--active" : ""}`}>
        <div>
          <h2 className="alert-summary-title">Alert Summary</h2>
          <p className="alert-summary-copy">
            {totalAlertCount === 0
              ? "Everything looks clear right now."
              : `${totalAlertCount} items or batches need attention.`}
          </p>
        </div>
        <div className="alert-summary-counts">
          <span className="badge badge--yellow">{lowStockCount} low</span>
          <span className="badge badge--orange">{expiringSoonCount} soon</span>
          <span className="badge badge--red">{expiredCount} expired</span>
        </div>
      </div>

      {expiringSoonCount > 0 && (
        <div className="section">
          <div className="section-header">
            <h2 className="section-title">
              <span className="badge badge--red">Expiring within 7 days</span>
            </h2>
          </div>
          <div className="expiry-list">
            {alerts.expiringSoon.map((batch) => {
              const days = daysUntil(batch.expiryDate);
              return (
                <div key={batch.id} className="expiry-item">
                  <div className="expiry-item-name">{batch.item.name}</div>
                  <div className="expiry-item-meta">
                    <span className="expiry-qty">{batch.remainingQuantity} remaining</span>
                    {batch.batchNo && <span className="expiry-batch">Batch: {batch.batchNo}</span>}
                  </div>
                  <div className={`expiry-days ${days <= 2 ? "expiry-days--critical" : ""}`}>
                    {days === 0
                      ? "Expires today"
                      : days === 1
                        ? "1 day left"
                        : `${days} days left`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="section">
        <div className="section-header">
          <h2 className="section-title">Inventory Summary</h2>
        </div>

        {summary.length === 0 ? (
          <div className="empty-state">
            <p>No items found in this workspace.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="text-right">Qty</th>
                  <th>Unit</th>
                  <th className="text-right">Min Level</th>
                  <th>Status</th>
                  <th className="text-right">Value</th>
                  <th>Nearest Expiry</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((item) => (
                  <tr key={item.itemId} className={item.isLowStock ? "row--warn" : ""}>
                    <td className="td-name">{item.itemName}</td>
                    <td className="text-right td-num">{item.totalQuantity}</td>
                    <td className="td-unit">{item.unit}</td>
                    <td className="text-right td-num">{item.minStockLevel}</td>
                    <td>
                      {item.isLowStock ? (
                        <span className="badge badge--orange">Low stock</span>
                      ) : (
                        <span className="badge badge--green">OK</span>
                      )}
                    </td>
                    <td className="text-right td-num">{formatCurrency(item.totalValue)}</td>
                    <td className="td-expiry">{formatDate(item.nearestExpiryDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
