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

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

type InsightTab = "usage" | "forecast" | "slow";

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
  const [trendDays, setTrendDays] = useState<7 | 14 | 30>(7);
  const [trendData, setTrendData] = useState<StockTrendDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [widgetErrors, setWidgetErrors] = useState<{
    alerts: string | null;
    wastage: string | null;
    usage: string | null;
  }>({ alerts: null, wastage: null, usage: null });
  const [insightTab, setInsightTab] = useState<InsightTab>("usage");
  const [checklistDismissed, setChecklistDismissed] = useState(() => {
    try { return localStorage.getItem("ss_onboarding_dismissed") === "1"; } catch { return false; }
  });
  const [checklistManualDone, setChecklistManualDone] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("ss_onboarding_done");
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch { return new Set(); }
  });

  function toggleChecklistStep(id: string) {
    setChecklistManualDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      try { localStorage.setItem("ss_onboarding_done", JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  function dismissChecklist() {
    setChecklistDismissed(true);
    try { localStorage.setItem("ss_onboarding_dismissed", "1"); } catch {}
  }

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
  const wastageTrend = computeTrend(wastageWeek, wastageLastWeek);
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

  const today = new Date();
  const dateStr = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="dashboard db-v2">

      {/* ── Header ── */}
      <div className="db-header">
        <div className="db-header-left">
          <p className="db-header-workspace">{workspaceName}</p>
          <h1 className="db-header-title">Dashboard</h1>
        </div>
        <div className="db-header-right">
          <span className="db-header-date">{dateStr}</span>
          {canAccessManagement && reorderSuggestions.length > 0 && (
            <Link className="btn btn--primary btn--sm" to="/reorder-suggestions">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>
              </svg>
              Create Purchase Order
            </Link>
          )}
        </div>
      </div>

      {/* ── KPI Strip ── */}
      <div className="db-kpi-strip">
        <div className="db-kpi-item">
          <div className="db-kpi-icon db-kpi-icon--blue">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          </div>
          <div className="db-kpi-body">
            <span className="db-kpi-label">Inventory Value</span>
            <span className="db-kpi-value">{formatCurrency(totalValue, currency)}</span>
          </div>
        </div>

        <div className="db-kpi-divider" />

        <div className="db-kpi-item">
          <div className="db-kpi-icon db-kpi-icon--green">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
          </div>
          <div className="db-kpi-body">
            <span className="db-kpi-label">Total Items</span>
            <span className="db-kpi-value">{totalItems}</span>
          </div>
        </div>

        <div className="db-kpi-divider" />

        <div className={`db-kpi-item${lowStockCount > 0 ? " db-kpi-item--warn" : ""}`}>
          <div className={`db-kpi-icon${lowStockCount > 0 ? " db-kpi-icon--orange" : " db-kpi-icon--gray"}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          </div>
          <div className="db-kpi-body">
            <span className="db-kpi-label">Low Stock</span>
            <span className="db-kpi-value">{lowStockCount}</span>
            {lowStockCount > 0 && <span className="db-kpi-sub">needs reorder</span>}
          </div>
        </div>

        <div className="db-kpi-divider" />

        <div className={`db-kpi-item${expiringSoonCount > 0 ? " db-kpi-item--danger" : ""}`}>
          <div className={`db-kpi-icon${expiringSoonCount > 0 ? " db-kpi-icon--red" : " db-kpi-icon--gray"}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div className="db-kpi-body">
            <span className="db-kpi-label">Expiring Soon</span>
            <span className="db-kpi-value">{expiringSoonCount}</span>
            {expiringSoonCount > 0 && <span className="db-kpi-sub">within {settings.expiryAlertDays}d</span>}
          </div>
        </div>

        <div className="db-kpi-divider" />

        <div className={`db-kpi-item${wastageWeek > 0 ? " db-kpi-item--danger" : ""}`}>
          <div className={`db-kpi-icon${wastageWeek > 0 ? " db-kpi-icon--red" : " db-kpi-icon--gray"}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </div>
          <div className="db-kpi-body">
            <span className="db-kpi-label">Wastage (week)</span>
            <span className="db-kpi-value">{formatCurrency(wastageWeek, currency)}</span>
            {wastageTrend !== "flat" && (
              <span className={`db-kpi-sub${wastageTrend === "up" ? " db-kpi-sub--bad" : " db-kpi-sub--good"}`}>
                {wastageTrend === "up" ? "↑" : "↓"} vs last week
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Onboarding Checklist ── */}
      {canAccessManagement && !checklistDismissed && (
        <div className="db-body">
          <OnboardingChecklist
            summary={summary}
            manualDone={checklistManualDone}
            onToggle={toggleChecklistStep}
            onDismiss={dismissChecklist}
          />
        </div>
      )}

      {canAccessManagement && (
        <div className="db-body">

          {/* ── Bento row: Alerts | Reorder | Wastage ── */}
          <div className="db-bento">

            {/* Alerts card */}
            <div className={`db-card db-card--alerts${totalAlertCount > 0 ? " db-card--alerts-active" : ""}`}>
              <div className="db-card-head">
                <div className="db-card-head-left">
                  <svg className="db-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                  </svg>
                  <h2 className="db-card-title">Requires Attention</h2>
                </div>
                {totalAlertCount > 0 && (
                  <span className="db-badge db-badge--alert">{totalAlertCount}</span>
                )}
              </div>

              {widgetErrors.alerts && (
                <p className="db-widget-error">{widgetErrors.alerts}</p>
              )}

              {totalAlertCount === 0 ? (
                <div className="db-empty-good">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                  Everything looks clear right now
                </div>
              ) : (
                <>
                  <div className="db-alert-counts">
                    <span className="badge badge--yellow">{lowStockCount} low</span>
                    <span className="badge badge--orange">{expiringSoonCount} expiring</span>
                    <span className="badge badge--red">{expiredCount} expired</span>
                  </div>

                  {expiringSoonCount > 0 && (
                    <div className="db-expiry-list">
                      <p className="db-list-label">Expiring within {settings.expiryAlertDays} days</p>
                      {alerts.expiringSoon.slice(0, 3).map((batch) => {
                        const days = daysUntil(batch.expiryDate);
                        return (
                          <div key={batch.id} className="db-expiry-row">
                            <div className="db-expiry-info">
                              <span className="db-expiry-name">{batch.item.name}</span>
                              <span className="db-expiry-meta">
                                {batch.remainingQuantity} remaining
                                {batch.batchNo && ` · ${batch.batchNo}`}
                              </span>
                            </div>
                            <span className={`db-expiry-pill${days <= 1 ? " db-expiry-pill--critical" : days <= 3 ? " db-expiry-pill--warn" : ""}`}>
                              {days === 0 ? "Today" : days === 1 ? "1 day" : `${days} days`}
                            </span>
                          </div>
                        );
                      })}
                      {expiringSoonCount > 3 && (
                        <p className="db-see-more">+{expiringSoonCount - 3} more expiring items</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Reorder card */}
            <div className={`db-card db-card--reorder${reorderSuggestions.length > 0 ? " db-card--reorder-active" : ""}`}>
              <div className="db-card-head">
                <div className="db-card-head-left">
                  <svg className="db-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>
                  </svg>
                  <h2 className="db-card-title">Reorder Needed</h2>
                </div>
                {reorderSuggestions.length > 0 && (
                  <span className="db-badge db-badge--warn">{reorderSuggestions.length}</span>
                )}
              </div>

              {reorderSuggestions.length === 0 ? (
                <div className="db-empty-good">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                  Stock levels are all above minimums
                </div>
              ) : (
                <>
                  <div className="db-reorder-table">
                    <div className="db-reorder-header">
                      <span>Item</span>
                      <span className="text-right">On Hand</span>
                      <span className="text-right">Min</span>
                      <span className="text-right">Suggest</span>
                    </div>
                    {reorderSuggestions.slice(0, 4).map((item) => (
                      <div key={item.itemId} className="db-reorder-row">
                        <span className="db-reorder-name">{item.itemName}</span>
                        <span className="db-reorder-num db-reorder-num--low">{formatNumber(item.totalQuantity)}</span>
                        <span className="db-reorder-num">{formatNumber(item.minStockLevel)}</span>
                        <span className="db-reorder-num db-reorder-num--suggest">{formatNumber(item.suggestedQuantity)}</span>
                      </div>
                    ))}
                  </div>
                  {reorderSuggestions.length > 4 && (
                    <p className="db-see-more">+{reorderSuggestions.length - 4} more items need reorder</p>
                  )}
                  <Link className="btn btn--warning btn--sm db-reorder-cta" to="/reorder-suggestions">
                    Create Purchase Order Draft
                  </Link>
                </>
              )}
            </div>

            {/* Wastage card */}
            <div className="db-card">
              <div className="db-card-head">
                <div className="db-card-head-left">
                  <svg className="db-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                  </svg>
                  <h2 className="db-card-title">Wastage</h2>
                </div>
                {wastageTrend !== "flat" && (
                  <span className={`db-trend-badge${wastageTrend === "up" ? " db-trend-badge--bad" : " db-trend-badge--good"}`}>
                    {wastageTrend === "up" ? "↑" : "↓"} vs last wk
                  </span>
                )}
              </div>

              {widgetErrors.wastage && (
                <p className="db-widget-error">{widgetErrors.wastage}</p>
              )}

              <div className="db-wastage-stats">
                <div className="db-wastage-stat">
                  <span className="db-wastage-stat-label">Today</span>
                  <span className="db-wastage-stat-value">{formatCurrency(wastageToday, currency)}</span>
                </div>
                <div className="db-wastage-stat db-wastage-stat--week">
                  <span className="db-wastage-stat-label">This week</span>
                  <span className={`db-wastage-stat-value${wastageWeek > 0 ? " db-wastage-stat-value--red" : ""}`}>{formatCurrency(wastageWeek, currency)}</span>
                </div>
                <div className="db-wastage-stat">
                  <span className="db-wastage-stat-label">Last week</span>
                  <span className="db-wastage-stat-value db-wastage-stat-value--muted">{formatCurrency(wastageLastWeek, currency)}</span>
                </div>
              </div>

              {topItems.length > 0 && (
                <div className="db-top-wasted">
                  <p className="db-list-label">Top wasted this week</p>
                  {topItems.map((item, i) => (
                    <div key={item.itemId} className="db-top-wasted-row">
                      <span className="db-top-rank">#{i + 1}</span>
                      <span className="db-top-name">{item.name}</span>
                      <span className="db-top-qty">{formatNumber(item.qty)} units</span>
                      <span className="db-top-value">{formatCurrency(item.value, currency)}</span>
                    </div>
                  ))}
                </div>
              )}

              {wastageWeek === 0 && topItems.length === 0 && !widgetErrors.wastage && (
                <div className="db-empty-good">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                  No wastage recorded this week
                </div>
              )}
            </div>
          </div>

          {/* ── Movement Trends chart ── */}
          <div className="db-card db-card--full">
            <div className="db-card-head">
              <div className="db-card-head-left">
                <svg className="db-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                </svg>
                <h2 className="db-card-title">Movement Trends</h2>
                <span className="db-card-helper">Daily stock in vs stock out</span>
              </div>
              <div className="trend-chart-range-btns">
                {([7, 14, 30] as const).map((d) => (
                  <button
                    key={d}
                    className={`trend-range-btn${trendDays === d ? " trend-range-btn--active" : ""}`}
                    onClick={() => setTrendDays(d)}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>
            <StockTrendChart data={trendData} days={trendDays} />
          </div>

          {/* ── Tabbed Insights ── */}
          <div className="db-card db-card--full">
            <div className="db-insights-tabs">
              <button
                className={`db-tab-btn${insightTab === "usage" ? " db-tab-btn--active" : ""}`}
                onClick={() => setInsightTab("usage")}
              >
                Usage Insights
              </button>
              <button
                className={`db-tab-btn${insightTab === "forecast" ? " db-tab-btn--active" : ""}`}
                onClick={() => setInsightTab("forecast")}
              >
                Stock Forecast
              </button>
              <button
                className={`db-tab-btn${insightTab === "slow" ? " db-tab-btn--active" : ""}`}
                onClick={() => setInsightTab("slow")}
              >
                Slow Movers
              </button>
            </div>

            {widgetErrors.usage && insightTab !== "slow" && (
              <p className="db-widget-error" style={{ margin: "0 0 12px" }}>{widgetErrors.usage}</p>
            )}

            {insightTab === "usage" && (
              <div className="db-tab-content">
                {topUsageInsights.length === 0 ? (
                  <div className="empty-state empty-state--compact">No usage data for the last 7 days.</div>
                ) : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th className="text-right">Total Used</th>
                          <th>Unit</th>
                          <th className="text-right">Est. Value</th>
                          <th className="text-right">Avg / Day</th>
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
                              <td className="text-right td-num">{formatNumber(item.averageDailyUsage)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {insightTab === "forecast" && (
              <div className="db-tab-content">
                {stockForecast.length === 0 ? (
                  <div className="empty-state empty-state--compact">No forecast available yet.</div>
                ) : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th className="text-right">Current Stock</th>
                          <th className="text-right">Avg / Day</th>
                          <th className="text-right">Est. Days Remaining</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stockForecast.map((item) => (
                          <tr key={item.itemId} className={`forecast-row forecast-row--${getForecastTone(item.estimatedDaysRemaining)}`}>
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

            {insightTab === "slow" && (
              <div className="db-tab-content">
                {slowMovers.length === 0 ? (
                  <div className="empty-state empty-state--compact empty-state--good">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
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
                            <td><span className="badge badge--gray">No movement · 7 days</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      )}

      {/* ── Inventory Summary (all roles) ── */}
      <div className="db-body">
        <div className="db-card db-card--full">
          <div className="db-card-head">
            <div className="db-card-head-left">
              <svg className="db-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
              </svg>
              <h2 className="db-card-title">Inventory Summary</h2>
              <span className="db-card-helper">{totalItems} items</span>
            </div>
            <Link to="/items" className="btn btn--secondary btn--sm">View All Items</Link>
          </div>
          {summary.length === 0 ? (
            <div className="empty-state">No items found in this workspace.</div>
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

    </div>
  );
}

function StockTrendChart({
  data,
  days,
}: {
  data: StockTrendDataPoint[];
  days: 7 | 14 | 30;
}) {
  const hasData = data.some((d) => d.stockIn > 0 || d.stockOut > 0);
  const tickInterval = days === 7 ? 0 : days === 14 ? 1 : 4;

  const formatted = data.map((d) => ({
    ...d,
    label: new Date(d.date + "T00:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
  }));

  if (!hasData) {
    return (
      <div className="empty-state empty-state--compact">
        No stock movements in the last {days} days.
      </div>
    );
  }

  return (
    <div className="trend-chart-wrap">
      <ResponsiveContainer width="100%" height={220}>
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
  );
}

function OnboardingChecklist({
  summary,
  manualDone,
  onToggle,
  onDismiss,
}: {
  summary: StockSummaryItem[];
  manualDone: Set<string>;
  onToggle: (id: string) => void;
  onDismiss: () => void;
}) {
  const hasItems = summary.length > 0;
  const hasStock = summary.some((s) => s.totalQuantity > 0);
  const hasReorderLevels = summary.some((s) => s.minStockLevel > 0) || manualDone.has("reorder_levels");
  const hasCount = manualDone.has("first_count");

  const steps = [
    {
      id: "add_items",
      label: "Add your inventory items",
      hint: "Create the products or ingredients you track.",
      done: hasItems,
      auto: true,
      href: "/items",
      linkLabel: "Go to Items",
    },
    {
      id: "opening_stock",
      label: "Record opening stock balances",
      hint: "Set starting quantities for each item via Opening stock in the item menu.",
      done: hasStock || manualDone.has("opening_stock"),
      auto: hasStock,
      href: "/items",
      linkLabel: "Open an item → Opening stock",
    },
    {
      id: "reorder_levels",
      label: "Set reorder levels",
      hint: "Define minimum stock levels so you get low-stock alerts.",
      done: hasReorderLevels,
      auto: summary.some((s) => s.minStockLevel > 0),
      href: "/items",
      linkLabel: "Edit an item to set Min Stock",
    },
    {
      id: "first_count",
      label: "Run your first physical inventory count",
      hint: "Verify on-hand quantities match your records.",
      done: hasCount,
      auto: false,
      href: "/stock-count",
      linkLabel: "Go to Physical Count",
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  if (completedCount === steps.length) return null;
  const pct = Math.round((completedCount / steps.length) * 100);

  return (
    <div className="onboarding-checklist">
      <div className="oc-header">
        <div className="oc-header-text">
          <h2 className="oc-title">Getting started</h2>
          <span className="oc-progress-text">{completedCount} of {steps.length} steps complete</span>
        </div>
        <button type="button" className="oc-dismiss" onClick={onDismiss} aria-label="Dismiss checklist">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18" /><path d="m6 6 12 12" />
          </svg>
        </button>
      </div>
      <div className="oc-progress-bar-track">
        <div className="oc-progress-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="oc-steps">
        {steps.map((step) => (
          <div key={step.id} className={`oc-step${step.done ? " oc-step--done" : ""}`}>
            <button
              type="button"
              className="oc-checkbox"
              onClick={() => { if (!step.auto) onToggle(step.id); }}
              aria-label={step.done ? `${step.label} — done` : `Mark ${step.label} as done`}
              title={step.auto ? "Automatically detected" : "Click to mark complete"}
              style={step.auto ? { cursor: "default" } : undefined}
            >
              {step.done ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : null}
            </button>
            <div className="oc-step-body">
              <span className="oc-step-label">{step.label}</span>
              {!step.done && <span className="oc-step-hint">{step.hint}</span>}
            </div>
            {!step.done && (
              <Link to={step.href} className="oc-step-link">
                {step.linkLabel}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
