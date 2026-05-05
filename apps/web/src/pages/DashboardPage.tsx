import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getAlerts } from "../api/alerts";
import { getStockMovements, getStockSummary, getStockTrend } from "../api/stock";
import { useAuth } from "../context/AuthContext";
import { useLocation } from "../context/LocationContext";
import { useWorkspaceSettings } from "../context/WorkspaceSettingsContext";
import type { AlertsResponse, StockMovement, StockSummaryItem, StockTrendDataPoint } from "../types";
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

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
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
  const { activeLocationId, locationReady } = useLocation();
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
  const [trendDays, setTrendDays] = useState<7 | 14 | 30>(30);
  const [trendData, setTrendData] = useState<StockTrendDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [widgetErrors, setWidgetErrors] = useState<{
    alerts: string | null;
    wastage: string | null;
    usage: string | null;
  }>({ alerts: null, wastage: null, usage: null });

  useEffect(() => {
    async function load() {
      if (!locationReady) return;

      setLoading(true);
      setError(null);

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
          summaryResult,
          alertsResult,
          wastageResToday,
          wastageResWeek,
          wastageResLastWeek,
          usageResult,
        ] = await Promise.allSettled([
          getStockSummary(),
          getAlerts(),
          getStockMovements({ type: "WASTAGE", fromDate: todayStr, toDate: todayStr }),
          getStockMovements({ type: "WASTAGE", fromDate: thisWeekStartStr, toDate: todayStr }),
          getStockMovements({ type: "WASTAGE", fromDate: lastWeekStartStr, toDate: lastWeekEndStr }),
          getStockMovements({ type: "STOCK_OUT", ...usageRange }),
        ]);

        if (summaryResult.status === "fulfilled") {
          setSummary(summaryResult.value.summary);
        } else {
          throw summaryResult.reason;
        }

        const nextWidgetErrors = { alerts: null as string | null, wastage: null as string | null, usage: null as string | null };

        if (alertsResult.status === "fulfilled") {
          setAlerts(alertsResult.value);
        } else {
          setAlerts(EMPTY_ALERTS);
          nextWidgetErrors.alerts = alertsResult.reason instanceof Error ? alertsResult.reason.message : "Failed to load alerts";
        }

        const todayOk = wastageResToday.status === "fulfilled";
        const weekOk = wastageResWeek.status === "fulfilled";
        const lastWeekOk = wastageResLastWeek.status === "fulfilled";

        if (todayOk || weekOk || lastWeekOk) {
          setWastageToday(todayOk ? sumWastageValue(wastageResToday.value.movements) : 0);
          setWastageWeek(weekOk ? sumWastageValue(wastageResWeek.value.movements) : 0);
          setWastageLastWeek(lastWeekOk ? sumWastageValue(wastageResLastWeek.value.movements) : 0);
          setTopItems(weekOk ? topWastedItems(wastageResWeek.value.movements, 3) : []);
        } else {
          setWastageToday(0);
          setWastageWeek(0);
          setWastageLastWeek(0);
          setTopItems([]);
          nextWidgetErrors.wastage = "Failed to load wastage data";
        }

        if (usageResult.status === "fulfilled") {
          setUsageMovements(usageResult.value.movements);
        } else {
          setUsageMovements([]);
          nextWidgetErrors.usage = usageResult.reason instanceof Error ? usageResult.reason.message : "Failed to load usage data";
        }

        setWidgetErrors(nextWidgetErrors);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard data");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [canAccessManagement, activeLocationId, locationReady]);

  useEffect(() => {
    if (!locationReady) return;
    async function loadTrend() {
      try {
        const res = await getStockTrend(trendDays);
        setTrendData(res.data);
      } catch {
        setTrendData([]);
      }
    }
    void loadTrend();
  }, [trendDays, activeLocationId, locationReady]);

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
  const activeItemIds = new Set(usageMovements.map((m) => m.item.id));
  const slowMovers = summary
    .filter((item) => item.totalQuantity > 0 && !activeItemIds.has(item.itemId))
    .sort((a, b) => b.totalValue - a.totalValue)
    .slice(0, 8);

  return (
    <div className="dashboard">
      <div className="page-header">
        <h1 className="page-title">Today&apos;s operations</h1>
        <p className="page-subtitle">{workspaceName} inventory health, reorder work, and usage signals.</p>
      </div>

      <DashboardGroup
        title="Overview"
        helper="Current inventory health at a glance"
      >
      {widgetErrors.wastage && (
        <div className="widget-error">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Could not load wastage data. {widgetErrors.wastage}
        </div>
      )}
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

      </DashboardGroup>

      <DashboardGroup
        title="Movement Trends"
        helper="Daily stock in vs stock out quantities"
      >
        <StockTrendChart
          data={trendData}
          days={trendDays}
          onDaysChange={setTrendDays}
        />
      </DashboardGroup>

      <DashboardGroup
        title="Action Required"
        helper="Items that need attention"
      >
      {widgetErrors.alerts && (
        <div className="widget-error">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Could not load alert data. {widgetErrors.alerts}
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
          {canAccessManagement && reorderSuggestions.length > 0 && (
            <Link className="btn btn--secondary btn--sm" to="/reorder-suggestions">
              Create Purchase Draft
            </Link>
          )}
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

      </DashboardGroup>

      {canAccessManagement && (
      <DashboardGroup
        title="Insights"
        helper="Trends and cost patterns from your recent activity"
      >

      {widgetErrors.usage && (
        <div className="widget-error">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Could not load usage data. {widgetErrors.usage}
        </div>
      )}

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

      {canAccessManagement && (
        <div className="section slow-movers-section">
          <div className="section-header">
            <h2 className="section-title">Slow-Moving Stock</h2>
            <span className="section-helper">Items with stock on hand but no usage in the last 7 days</span>
          </div>

          {slowMovers.length === 0 ? (
            <div className="empty-state empty-state--compact empty-state--good">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              All items with stock had movement in the last 7 days.
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="text-right">In Stock</th>
                    <th>Unit</th>
                    <th className="text-right">Value Tied Up</th>
                    <th>Activity</th>
                  </tr>
                </thead>
                <tbody>
                  {slowMovers.map((item) => (
                    <tr key={item.itemId} className="slow-mover-row">
                      <td className="td-name">{item.itemName}</td>
                      <td className="text-right td-num">{formatNumber(item.totalQuantity)}</td>
                      <td className="td-unit">{item.unit}</td>
                      <td className="text-right td-num">
                        {item.totalValue > 0 ? formatCurrency(item.totalValue, currency) : "—"}
                      </td>
                      <td>
                        <span className="badge badge--gray">No movement · 7 days</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      </DashboardGroup>
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

function StockTrendChart({
  data,
  days,
  onDaysChange,
}: {
  data: StockTrendDataPoint[];
  days: 7 | 14 | 30;
  onDaysChange: (d: 7 | 14 | 30) => void;
}) {
  const hasData = data.some((d) => d.stockIn > 0 || d.stockOut > 0);

  const formatted = data.map((d) => ({
    ...d,
    label: new Date(d.date + "T00:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
  }));

  const tickInterval = days === 7 ? 0 : days === 14 ? 1 : 4;

  return (
    <div className="trend-chart-section">
      <div className="trend-chart-header">
        <div className="trend-chart-range-btns">
          {([7, 14, 30] as const).map((d) => (
            <button
              key={d}
              className={`trend-range-btn${days === d ? " trend-range-btn--active" : ""}`}
              onClick={() => onDaysChange(d)}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {!hasData ? (
        <div className="empty-state empty-state--compact">
          No stock movements in the last {days} days.
        </div>
      ) : (
        <div className="trend-chart-wrap">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={formatted} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "var(--color-text-muted)" }}
                axisLine={false}
                tickLine={false}
                interval={tickInterval}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--color-text-muted)" }}
                axisLine={false}
                tickLine={false}
                width={36}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                cursor={{ fill: "var(--color-border-light)" }}
              />
              <Legend
                wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
                formatter={(value) => (value === "stockIn" ? "Stock In" : "Stock Out")}
              />
              <Bar dataKey="stockIn" name="stockIn" fill="var(--color-green)" radius={[3, 3, 0, 0]} maxBarSize={28} />
              <Bar dataKey="stockOut" name="stockOut" fill="var(--color-primary)" radius={[3, 3, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
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

function DashboardGroup({
  title,
  helper,
  children,
}: {
  title: string;
  helper: string;
  children: React.ReactNode;
}) {
  return (
    <section className="dashboard-group">
      <div className="dashboard-group-header">
        <h2 className="dashboard-group-title">{title}</h2>
        <p className="dashboard-group-helper">{helper}</p>
      </div>
      <div className="dashboard-group-body">
        {children}
      </div>
    </section>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}
