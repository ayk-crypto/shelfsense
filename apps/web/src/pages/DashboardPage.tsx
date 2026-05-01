import { useEffect, useState } from "react";
import { getAlerts } from "../api/alerts";
import { getStockMovements, getStockSummary } from "../api/stock";
import { useAuth } from "../context/AuthContext";
import { useWorkspaceSettings } from "../context/WorkspaceSettingsContext";
import type { AlertsResponse, StockMovement, StockSummaryItem } from "../types";
import { formatCurrency } from "../utils/currency";
import { getSuggestedReorderQuantity } from "../utils/reorder";
import {
  getForecastTone,
  getLastSevenDaysRange,
  getStockForecast,
  getUsageInsights,
} from "../utils/usage";

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

function sumWastageValue(movements: StockMovement[]) {
  return movements.reduce((acc, m) => acc + m.quantity * (m.unitCost ?? 0), 0);
}

interface WastedItem {
  itemId: string;
  name: string;
  qty: number;
  value: number;
}

function topWastedItems(movements: StockMovement[], n: number): WastedItem[] {
  const map = new Map<string, WastedItem>();
  for (const m of movements) {
    const prev = map.get(m.item.id) ?? { itemId: m.item.id, name: m.item.name, qty: 0, value: 0 };
    map.set(m.item.id, {
      ...prev,
      qty: prev.qty + m.quantity,
      value: prev.value + m.quantity * (m.unitCost ?? 0),
    });
  }
  return [...map.values()].sort((a, b) => b.value - a.value).slice(0, n);
}

type Trend = "up" | "down" | "flat";

function computeTrend(thisWeek: number, lastWeek: number): Trend {
  if (thisWeek > lastWeek) return "up";
  if (thisWeek < lastWeek) return "down";
  return "flat";
}

const EMPTY_ALERTS: AlertsResponse = {
  lowStock: [],
  expiringSoon: [],
  expired: [],
};

export function DashboardPage() {
  const { user } = useAuth();
  const { settings } = useWorkspaceSettings();
  const canAccessManagement = user?.role === "OWNER" || user?.role === "MANAGER";
  const currency = settings.currency;
  const workspaceName = settings.name.trim() || "ShelfSense";
  const [summary, setSummary] = useState<StockSummaryItem[]>([]);
  const [alerts, setAlerts] = useState<AlertsResponse>(EMPTY_ALERTS);
  const [wastageToday, setWastageToday] = useState(0);
  const [wastageWeek, setWastageWeek] = useState(0);
  const [wastageLastWeek, setWastageLastWeek] = useState(0);
  const [topItems, setTopItems] = useState<WastedItem[]>([]);
  const [usageMovements, setUsageMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        if (!canAccessManagement) {
          const summaryRes = await getStockSummary();
          setSummary(summaryRes.summary);
          setAlerts(EMPTY_ALERTS);
          setWastageToday(0);
          setWastageWeek(0);
          setWastageLastWeek(0);
          setTopItems([]);
          setUsageMovements([]);
          return;
        }

        const today = new Date();
        const todayStr = toYMD(today);

        const thisWeekStart = new Date(today);
        thisWeekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
        const thisWeekStartStr = toYMD(thisWeekStart);

        const lastWeekStart = new Date(thisWeekStart);
        lastWeekStart.setDate(lastWeekStart.getDate() - 7);
        const lastWeekStartStr = toYMD(lastWeekStart);

        const lastWeekEnd = new Date(thisWeekStart);
        lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
        const lastWeekEndStr = toYMD(lastWeekEnd);
        const usageRange = getLastSevenDaysRange();

        const [
          summaryRes,
          alertsRes,
          wastageResToday,
          wastageResWeek,
          wastageResLastWeek,
          usageRes,
        ] =
          await Promise.all([
            getStockSummary(),
            getAlerts(),
            getStockMovements({ type: "WASTAGE", fromDate: todayStr, toDate: todayStr }),
            getStockMovements({ type: "WASTAGE", fromDate: thisWeekStartStr, toDate: todayStr }),
            getStockMovements({ type: "WASTAGE", fromDate: lastWeekStartStr, toDate: lastWeekEndStr }),
            getStockMovements({ type: "STOCK_OUT", ...usageRange }),
          ]);

        setSummary(summaryRes.summary);
        setAlerts(alertsRes);
        setWastageToday(sumWastageValue(wastageResToday.movements));
        setWastageWeek(sumWastageValue(wastageResWeek.movements));
        setWastageLastWeek(sumWastageValue(wastageResLastWeek.movements));
        setTopItems(topWastedItems(wastageResWeek.movements, 3));
        setUsageMovements(usageRes.movements);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard data");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [canAccessManagement]);

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
  const trend = computeTrend(wastageWeek, wastageLastWeek);
  const summaryByItemId = new Map(summary.map((item) => [item.itemId, item]));
  const lowStockIds = new Set(alerts.lowStock.map((item) => item.itemId));
  const reorderSuggestions = summary
    .filter((item) => item.totalQuantity <= item.minStockLevel || lowStockIds.has(item.itemId))
    .map((item) => ({
      ...item,
      suggestedQuantity: getSuggestedReorderQuantity(
        item.totalQuantity,
        item.minStockLevel,
        settings.lowStockMultiplier,
      ),
    }));
  const usageInsights = getUsageInsights(usageMovements);
  const topUsageInsights = usageInsights.slice(0, 5);
  const stockForecast = getStockForecast(summary, usageInsights).slice(0, 5);

  return (
    <div className="dashboard">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">{workspaceName} inventory at a glance</p>
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
            <span className="stat-value">{formatCurrency(totalValue, currency)}</span>
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
            <span className="stat-value">{formatCurrency(wastageWeek, currency)}</span>
            <span className="stat-sublabel">
              Today {formatCurrency(wastageToday, currency)} · This week {formatCurrency(wastageWeek, currency)}
            </span>
            <WastageTrend trend={trend} thisWeek={wastageWeek} lastWeek={wastageLastWeek} />
          </div>
        </div>
      </div>

      {canAccessManagement && topItems.length > 0 && (
        <div className="wastage-top-section">
          <h2 className="wastage-top-title">
            <svg className="wastage-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" /><path d="M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
            Top Wasted Items — This Week
          </h2>
          <div className="wastage-top-list">
            {topItems.map((item, i) => (
              <div key={item.itemId} className="wastage-top-row">
                <span className="wastage-top-rank">#{i + 1}</span>
                <span className="wastage-top-name">{item.name}</span>
                <span className="wastage-top-qty">{formatNumber(item.qty)} units wasted</span>
                <span className="wastage-top-value">{formatCurrency(item.value, currency)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {canAccessManagement && (
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
      )}

      <div className="section reorder-section">
        <div className="section-header">
          <h2 className="section-title">Reorder Suggestions</h2>
        </div>

        {reorderSuggestions.length === 0 ? (
          <div className="empty-state empty-state--compact">
            No reorder suggestions right now.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="text-right">Current Stock</th>
                  <th className="text-right">Minimum Level</th>
                  <th className="text-right">Suggested Order</th>
                  <th>Unit</th>
                </tr>
              </thead>
              <tbody>
                {reorderSuggestions.map((item) => (
                  <tr key={item.itemId} className="row--warn">
                    <td className="td-name">{item.itemName}</td>
                    <td className="text-right td-num">{formatNumber(item.totalQuantity)}</td>
                    <td className="text-right td-num">{formatNumber(item.minStockLevel)}</td>
                    <td className="text-right td-num">
                      <strong>{formatNumber(item.suggestedQuantity)}</strong>
                    </td>
                    <td className="td-unit">{item.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canAccessManagement && (
      <div className="section usage-section">
        <div className="section-header">
          <h2 className="section-title">Usage Insights</h2>
        </div>

        {topUsageInsights.length === 0 ? (
          <div className="empty-state empty-state--compact">
            No usage insights for the last 7 days.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="text-right">Total Used</th>
                  <th>Unit</th>
                  <th className="text-right">Estimated Value</th>
                  <th className="text-right">Avg/day</th>
                </tr>
              </thead>
              <tbody>
                {topUsageInsights.map((item) => {
                  const unit = summaryByItemId.get(item.itemId)?.unit ?? "units";
                  return (
                    <tr key={item.itemId}>
                      <td className="td-name">{item.itemName}</td>
                      <td className="text-right td-num">{formatNumber(item.totalQuantity)}</td>
                      <td className="td-unit">{unit}</td>
                      <td className="text-right td-num">{formatCurrency(item.estimatedValue, currency)}</td>
                      <td className="text-right td-num">
                        {formatNumber(item.averageDailyUsage)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {canAccessManagement && (
      <div className="section forecast-section">
        <div className="section-header">
          <h2 className="section-title">Stock Forecast</h2>
        </div>

        {stockForecast.length === 0 ? (
          <div className="empty-state empty-state--compact">
            No stock forecast available yet.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="text-right">Current Stock</th>
                  <th className="text-right">Avg/day Usage</th>
                  <th className="text-right">Est. Days Remaining</th>
                </tr>
              </thead>
              <tbody>
                {stockForecast.map((item) => (
                  <tr
                    key={item.itemId}
                    className={`forecast-row forecast-row--${getForecastTone(item.estimatedDaysRemaining)}`}
                  >
                    <td className="td-name">{item.itemName}</td>
                    <td className="text-right td-num">{formatNumber(item.currentQuantity)}</td>
                    <td className="text-right td-num">{formatNumber(item.averageDailyUsage)}</td>
                    <td className="text-right td-num">
                      <span className={`forecast-pill forecast-pill--${getForecastTone(item.estimatedDaysRemaining)}`}>
                        {formatNumber(item.estimatedDaysRemaining)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {canAccessManagement && expiringSoonCount > 0 && (
        <div className="section">
          <div className="section-header">
            <h2 className="section-title">
              <span className="badge badge--red">Expiring within {settings.expiryAlertDays} days</span>
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
                    <td className="text-right td-num">{formatCurrency(item.totalValue, currency)}</td>
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

function WastageTrend({
  trend,
  thisWeek,
  lastWeek,
}: {
  trend: Trend;
  thisWeek: number;
  lastWeek: number;
}) {
  if (trend === "flat" && thisWeek === 0 && lastWeek === 0) return null;

  const icon = trend === "up" ? "↑" : trend === "down" ? "↓" : "→";
  const label =
    trend === "up"
      ? "Up vs last week"
      : trend === "down"
        ? "Down vs last week"
        : "Same as last week";

  return (
    <span className={`wastage-trend wastage-trend--${trend}`}>
      {icon} {label}
    </span>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}
