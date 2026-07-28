import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getAlerts } from "../api/alerts";
import { getPhysicalCountSettings } from "../api/physicalCountSettings";
import { getOpenPurchases, getPurchases } from "../api/purchases";
import { getStockMovements, getStockSummary } from "../api/stock";
import { PhysicalCountReminderCard } from "../components/PhysicalCountReminderCard";
import { useAuth } from "../context/AuthContext";
import { useLocation } from "../context/LocationContext";
import { useWorkspaceSettings } from "../context/WorkspaceSettingsContext";
import type {
  AlertsResponse,
  PhysicalCountSettings,
  Purchase,
  StockMovement,
  StockSummaryItem,
} from "../types";
import { hasPermission } from "../utils/permissions";
import "./DashboardToday.css";

const DAY_MS = 86_400_000;
const EMPTY_ALERTS: AlertsResponse = {
  lowStock: [],
  critical: [],
  reorderDue: [],
  belowPar: [],
  awaitingReceiving: [],
  replenishmentAlerts: [],
  expiringSoon: [],
  expired: [],
};

type QuickAction = {
  label: string;
  helper: string;
  to: string;
  tone: "green" | "red" | "indigo" | "blue";
  icon: "receive" | "use" | "scan" | "count";
};

type UsedItem = {
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  value: number;
  movementCount: number;
};

export function DashboardPage() {
  const { user } = useAuth();
  const { activeLocation, activeLocationId, locationReady } = useLocation();
  const { settings } = useWorkspaceSettings();
  const navigate = useNavigate();

  const canStockIn = hasPermission(user, "stock_in");
  const canStockOut = hasPermission(user, "stock_out");
  const canViewInventory = hasPermission(user, "inventory_view");
  const canViewAlerts = hasPermission(user, "alerts");
  const canViewPurchases = hasPermission(user, "purchases");
  const canViewInsights = hasPermission(user, "reports") || hasPermission(user, "inventory_manage");

  const [summary, setSummary] = useState<StockSummaryItem[]>([]);
  const [alerts, setAlerts] = useState<AlertsResponse>(EMPTY_ALERTS);
  const [usageMovements, setUsageMovements] = useState<StockMovement[]>([]);
  const [wastageMovements, setWastageMovements] = useState<StockMovement[]>([]);
  const [recentMovements, setRecentMovements] = useState<StockMovement[]>([]);
  const [draftPurchases, setDraftPurchases] = useState<Purchase[]>([]);
  const [openPurchases, setOpenPurchases] = useState<Purchase[]>([]);
  const [pcSettings, setPcSettings] = useState<PhysicalCountSettings | null>(null);
  const [pcSettingsLoading, setPcSettingsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      if (!locationReady) return;
      setLoading(true);
      setError(null);

      const now = new Date();
      const sixtyDayStart = startOfDay(new Date(now.getTime() - 59 * DAY_MS));
      const weekStart = startOfWeek(now);
      const previousWeekStart = new Date(weekStart.getTime() - 7 * DAY_MS);

      try {
        const [
          summaryResult,
          alertsResult,
          usageResult,
          wastageResult,
          recentResult,
          draftsResult,
          openResult,
        ] = await Promise.all([
          getStockSummary(),
          canViewAlerts
            ? withFallback(getAlerts(), EMPTY_ALERTS)
            : Promise.resolve(EMPTY_ALERTS),
          withFallback(
            getStockMovements({
              type: "STOCK_OUT",
              fromDate: toYMD(sixtyDayStart),
              toDate: toYMD(now),
            }),
            { movements: [] },
          ),
          withFallback(
            getStockMovements({
              type: "WASTAGE",
              fromDate: toYMD(previousWeekStart),
              toDate: toYMD(now),
            }),
            { movements: [] },
          ),
          withFallback(getStockMovements(), { movements: [] }),
          canViewPurchases
            ? withFallback(getPurchases({ status: "DRAFT" }), { purchases: [] })
            : Promise.resolve({ purchases: [] }),
          canViewPurchases
            ? withFallback(getOpenPurchases(), { purchases: [] })
            : Promise.resolve({ purchases: [] }),
        ]);

        if (cancelled) return;
        setSummary(summaryResult.summary);
        setAlerts(alertsResult);
        setUsageMovements(usageResult.movements);
        setWastageMovements(wastageResult.movements);
        setRecentMovements(
          [...recentResult.movements]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 5),
        );
        setDraftPurchases(draftsResult.purchases);
        setOpenPurchases(openResult.purchases);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load today’s dashboard.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [activeLocationId, canViewAlerts, canViewPurchases, locationReady]);

  useEffect(() => {
    if (!canViewInventory) return;
    setPcSettingsLoading(true);
    getPhysicalCountSettings()
      .then((response) => setPcSettings(response.settings))
      .catch(() => setPcSettings(null))
      .finally(() => setPcSettingsLoading(false));
  }, [canViewInventory, activeLocationId]);

  const summaryByItemId = useMemo(
    () => new Map(summary.map((item) => [item.itemId, item])),
    [summary],
  );

  const topUsedItems = useMemo(
    () => buildTopUsedItems(usageMovements, summaryByItemId, 30),
    [summaryByItemId, usageMovements],
  );

  const slowMovers = useMemo(() => {
    const usedItemIds = new Set(usageMovements.map((movement) => movement.item.id));
    return summary
      .filter((item) => item.totalQuantity > 0 && !usedItemIds.has(item.itemId))
      .sort((a, b) => b.totalValue - a.totalValue || b.totalQuantity - a.totalQuantity)
      .slice(0, 5);
  }, [summary, usageMovements]);

  if (loading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Preparing today’s overview…</p>
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

  const now = new Date();
  const todayStart = startOfDay(now).getTime();
  const weekStart = startOfWeek(now).getTime();
  const previousWeekStart = weekStart - 7 * DAY_MS;
  const totalValue = summary.reduce((total, item) => total + item.totalValue, 0);
  const usageValueToday = usageMovements
    .filter((movement) => new Date(movement.createdAt).getTime() >= todayStart)
    .reduce((total, movement) => total + Math.abs(movement.quantity) * (movement.unitCost ?? 0), 0);
  const wastageThisWeek = movementValueBetween(wastageMovements, weekStart, Number.POSITIVE_INFINITY);
  const wastageLastWeek = movementValueBetween(wastageMovements, previousWeekStart, weekStart);
  const wastageTrend = compareTrend(wastageThisWeek, wastageLastWeek);

  const criticalWithoutPo = alerts.critical.filter((item) => !item.activePo);
  const criticalCovered = alerts.critical.filter((item) => Boolean(item.activePo));
  const expiryCount = alerts.expiringSoon.length + alerts.expired.length;
  const urgentItemIds = new Set<string>(criticalWithoutPo.map((item) => item.itemId));
  for (const item of alerts.replenishmentAlerts) {
    if ([
      "REORDER_REQUIRED",
      "ON_ORDER_SHORTAGE_RISK",
      "ADDITIONAL_QTY_REQUIRED",
      "OVERDUE_DELIVERY",
    ].includes(item.replenishment.status)) {
      urgentItemIds.add(item.itemId);
    }
  }

  const quickActions: QuickAction[] = [
    canStockIn
      ? { label: "Receive Stock", helper: "Add delivered items", to: "/stock-in", tone: "green", icon: "receive" }
      : null,
    canStockOut
      ? { label: "Use Stock", helper: "Record usage or wastage", to: "/stock-out", tone: "red", icon: "use" }
      : null,
    canViewInventory
      ? { label: "Scan Item", helper: "Find an item quickly", to: "/items?action=scan", tone: "blue", icon: "scan" }
      : null,
    canViewInventory
      ? { label: "Count Stock", helper: "Check physical quantity", to: "/stock-count", tone: "indigo", icon: "count" }
      : null,
  ].filter((action): action is QuickAction => action !== null);

  const branchName = activeLocation?.name ?? "Current Branch";
  const dateLabel = now.toLocaleDateString("en-SA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <main className="today-dashboard">
      <header className="today-header">
        <div>
          <span className="today-eyebrow">{settings.name}</span>
          <h1>Today — {branchName}</h1>
          <p>{dateLabel}</p>
        </div>
      </header>

      {quickActions.length > 0 && (
        <section className="today-actions" aria-label="Quick inventory actions">
          {quickActions.map((action) => (
            <Link key={action.label} to={action.to} className={`today-action today-action--${action.tone}`}>
              <span className="today-action-icon"><ActionIcon icon={action.icon} /></span>
              <span>
                <strong>{action.label}</strong>
                <small>{action.helper}</small>
              </span>
              <svg className="today-action-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M5 12h14" /><path d="m13 6 6 6-6 6" />
              </svg>
            </Link>
          ))}
        </section>
      )}

      {(canViewAlerts || canViewPurchases) && (
        <section className="today-main-grid">
          {canViewAlerts && (
            <article className="today-card today-card--priorities">
              <CardHeader title="Today’s Priorities" helper="Only items that need action" icon="priority" />
              <div className="priority-list">
                {criticalWithoutPo.length > 0 && (
                  <PriorityRow
                    tone="danger"
                    label="Critical stock — purchase needed"
                    count={criticalWithoutPo.length}
                    note="No incoming purchase order is covering these items."
                    to="/alerts"
                  />
                )}
                {criticalCovered.length > 0 && (
                  <PriorityRow
                    tone="covered"
                    label="Critical stock — already ordered"
                    count={criticalCovered.length}
                    note="Monitor delivery rather than ordering again."
                    to="/purchases"
                  />
                )}
                {expiryCount > 0 && (
                  <PriorityRow
                    tone={alerts.expired.length > 0 ? "danger" : "warning"}
                    label="Expiry attention"
                    count={expiryCount}
                    note={alerts.expired.length > 0 ? `${alerts.expired.length} expired batch${alerts.expired.length === 1 ? "" : "es"}.` : "Batches are approaching expiry."}
                    to="/alerts?focus=expiring"
                  />
                )}
                {openPurchases.length > 0 && (
                  <PriorityRow
                    tone="info"
                    label="Purchase orders awaiting delivery"
                    count={openPurchases.length}
                    note="Receive these when the supplier delivery arrives."
                    to="/purchases"
                  />
                )}
                {criticalWithoutPo.length === 0 && criticalCovered.length === 0 && expiryCount === 0 && openPurchases.length === 0 && (
                  <div className="today-clear-state">
                    <span>✓</span>
                    <div><strong>Everything looks clear</strong><small>No urgent stock or expiry action is waiting.</small></div>
                  </div>
                )}
              </div>
              <Link className="today-card-link" to="/alerts">View all alerts</Link>
            </article>
          )}

          {canViewPurchases && (
            <article className="today-card today-card--purchasing db-card--reorder">
              <CardHeader title="Purchasing" helper="Urgent orders and planned supplier visits" icon="purchase" />
              <div className="purchase-overview">
                <div className={urgentItemIds.size > 0 ? "purchase-stat purchase-stat--warn" : "purchase-stat"}>
                  <span>Urgent reorder</span>
                  <strong>{urgentItemIds.size}</strong>
                  <small>{urgentItemIds.size > 0 ? "items need purchasing" : "nothing urgent"}</small>
                </div>
                <div className="purchase-stat">
                  <span>Draft POs</span>
                  <strong>{draftPurchases.length}</strong>
                  <small>awaiting review</small>
                </div>
                <div className="purchase-stat">
                  <span>Incoming POs</span>
                  <strong>{openPurchases.length}</strong>
                  <small>ordered or partly received</small>
                </div>
              </div>
              <div className="purchase-actions">
                <Link className="btn btn--primary btn--sm" to="/reorder-suggestions">Review urgent reorders</Link>
                <Link className="btn btn--secondary btn--sm" to="/purchases">View purchase orders</Link>
              </div>
              <p className="purchase-plan-helper">For a supplier visit, choose the supplier and whether stock should cover 15, 30 or 60 days.</p>
            </article>
          )}
        </section>
      )}

      {canViewInventory && (pcSettings?.enabled || pcSettingsLoading) && (
        <section className="today-count-reminder">
          <PhysicalCountReminderCard
            settings={pcSettings}
            loading={pcSettingsLoading}
            onConfigure={() => navigate("/settings#physical-count")}
          />
        </section>
      )}

      {canViewInsights && (
        <section className="today-kpis" aria-label="Operational snapshot">
          <KpiCard label="Inventory Value" value={formatMoney(totalValue, settings.currency)} helper="Current branch stock" icon="value" />
          <KpiCard label="Active Items" value={formatNumber(summary.length)} helper="Tracked at this branch" icon="items" />
          <KpiCard label="Usage Value Today" value={formatMoney(usageValueToday, settings.currency)} helper="Based on recorded stock out" icon="usage" />
          <KpiCard
            label="Wastage This Week"
            value={formatMoney(wastageThisWeek, settings.currency)}
            helper={wastageTrend === "flat" ? "Same as last week" : `${wastageTrend === "up" ? "↑" : "↓"} versus last week`}
            icon="wastage"
            tone={wastageTrend === "up" ? "danger" : wastageTrend === "down" ? "good" : undefined}
          />
        </section>
      )}

      {canViewInsights && (
        <section className="today-insight-grid">
          <article className="today-card">
            <CardHeader title="Top 5 Used Items" helper="Recorded usage during the last 30 days" icon="usage" />
            <div className="ranked-list">
              {topUsedItems.length === 0 ? (
                <EmptyPanel text="No usage has been recorded during the last 30 days." />
              ) : topUsedItems.map((item, index) => (
                <Link key={item.itemId} to={`/items?q=${encodeURIComponent(item.itemName)}`} className="ranked-row">
                  <span className="ranked-number">{index + 1}</span>
                  <span className="ranked-main">
                    <strong>{item.itemName}</strong>
                    <small>{item.movementCount} usage entr{item.movementCount === 1 ? "y" : "ies"}</small>
                  </span>
                  <span className="ranked-value">
                    <strong>{formatNumber(item.quantity)}</strong>
                    <small>{item.unit}</small>
                  </span>
                </Link>
              ))}
            </div>
            <Link className="today-card-link" to="/reports">View usage report</Link>
          </article>

          <article className="today-card">
            <CardHeader title="Top 5 Slow Movers" helper="In stock with no recorded usage for 60 days" icon="slow" />
            <div className="ranked-list">
              {slowMovers.length === 0 ? (
                <EmptyPanel text="Every stocked item has recorded usage during the last 60 days." good />
              ) : slowMovers.map((item, index) => (
                <Link key={item.itemId} to={`/items?q=${encodeURIComponent(item.itemName)}`} className="ranked-row">
                  <span className="ranked-number ranked-number--muted">{index + 1}</span>
                  <span className="ranked-main">
                    <strong>{item.itemName}</strong>
                    <small>{formatMoney(item.totalValue, settings.currency)} tied up</small>
                  </span>
                  <span className="ranked-value">
                    <strong>{formatNumber(item.totalQuantity)}</strong>
                    <small>{item.unit}</small>
                  </span>
                </Link>
              ))}
            </div>
            <Link className="today-card-link" to="/reports">Review slow-moving stock</Link>
          </article>
        </section>
      )}

      <section className="today-card today-activity-card">
        <CardHeader title="Recent Activity" helper="Latest stock movements at this branch" icon="activity" />
        <div className="activity-list">
          {recentMovements.length === 0 ? (
            <EmptyPanel text="No recent stock activity is available." />
          ) : recentMovements.map((movement) => (
            <div key={movement.id} className="activity-row">
              <span className={`activity-marker activity-marker--${movementTone(movement.type)}`} />
              <div className="activity-main">
                <strong>{movementLabel(movement.type)} — {movement.item.name}</strong>
                <small>{movement.note || movement.reason || "Inventory movement recorded"}</small>
              </div>
              <div className="activity-meta">
                <strong>{formatNumber(Math.abs(movement.quantity))} {movement.item.unit ?? summaryByItemId.get(movement.item.id)?.unit ?? "units"}</strong>
                <small>{formatRelativeTime(movement.createdAt)}</small>
              </div>
            </div>
          ))}
        </div>
        <Link className="today-card-link" to="/movements">View all stock activity</Link>
      </section>
    </main>
  );
}

function CardHeader({ title, helper, icon }: { title: string; helper: string; icon: DashboardIconName }) {
  return (
    <div className="today-card-header">
      <span className="today-card-icon"><DashboardIcon name={icon} /></span>
      <div><h2>{title}</h2><p>{helper}</p></div>
    </div>
  );
}

function PriorityRow({
  tone,
  label,
  count,
  note,
  to,
}: {
  tone: "danger" | "warning" | "covered" | "info";
  label: string;
  count: number;
  note: string;
  to: string;
}) {
  return (
    <Link to={to} className={`priority-row priority-row--${tone}`}>
      <span className="priority-dot" />
      <span className="priority-copy"><strong>{label}</strong><small>{note}</small></span>
      <span className="priority-count">{count}</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
    </Link>
  );
}

function KpiCard({
  label,
  value,
  helper,
  icon,
  tone,
}: {
  label: string;
  value: string;
  helper: string;
  icon: DashboardIconName;
  tone?: "danger" | "good";
}) {
  return (
    <article className={`today-kpi${tone ? ` today-kpi--${tone}` : ""}`}>
      <span className="today-kpi-icon"><DashboardIcon name={icon} /></span>
      <span className="today-kpi-label">{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </article>
  );
}

function EmptyPanel({ text, good = false }: { text: string; good?: boolean }) {
  return <div className={`today-empty${good ? " today-empty--good" : ""}`}>{good && <span>✓</span>}<p>{text}</p></div>;
}

type DashboardIconName = "priority" | "purchase" | "value" | "items" | "usage" | "wastage" | "slow" | "activity";

function DashboardIcon({ name }: { name: DashboardIconName }) {
  if (name === "priority") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="m10.3 3.9-8.2 14A2 2 0 0 0 3.8 21h16.4a2 2 0 0 0 1.7-3l-8.2-14a2 2 0 0 0-3.4 0z"/></svg>;
  if (name === "purchase") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>;
  if (name === "value") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>;
  if (name === "items") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>;
  if (name === "usage") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>;
  if (name === "wastage") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="m8 6 1-3h6l1 3"/><path d="m19 6-1 15H6L5 6"/></svg>;
  if (name === "slow") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>;
}

function ActionIcon({ icon }: { icon: QuickAction["icon"] }) {
  if (icon === "receive") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 4v14"/><path d="m6 12 6 6 6-6"/><path d="M5 21h14"/></svg>;
  if (icon === "use") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 20V6"/><path d="m6 12 6-6 6 6"/><path d="M5 3h14"/></svg>;
  if (icon === "scan") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 8V5a1 1 0 0 1 1-1h3"/><path d="M16 4h3a1 1 0 0 1 1 1v3"/><path d="M20 16v3a1 1 0 0 1-1 1h-3"/><path d="M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M7 12h10"/></svg>;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M8 3h8l2 3v15H6V6l2-3z"/><path d="M9 11h6M9 15h6"/></svg>;
}

function buildTopUsedItems(
  movements: StockMovement[],
  summaryByItemId: Map<string, StockSummaryItem>,
  days: number,
) {
  const cutoff = startOfDay(new Date(Date.now() - (days - 1) * DAY_MS)).getTime();
  const map = new Map<string, UsedItem>();

  for (const movement of movements) {
    if (new Date(movement.createdAt).getTime() < cutoff) continue;
    const itemId = movement.item.id;
    const existing = map.get(itemId) ?? {
      itemId,
      itemName: movement.item.name,
      unit: movement.item.unit ?? summaryByItemId.get(itemId)?.unit ?? "units",
      quantity: 0,
      value: 0,
      movementCount: 0,
    };
    existing.quantity += Math.abs(movement.quantity);
    existing.value += Math.abs(movement.quantity) * (movement.unitCost ?? 0);
    existing.movementCount += 1;
    map.set(itemId, existing);
  }

  return [...map.values()]
    .sort((a, b) => b.quantity - a.quantity || b.value - a.value)
    .slice(0, 5);
}

function movementValueBetween(movements: StockMovement[], from: number, to: number) {
  return movements
    .filter((movement) => {
      const time = new Date(movement.createdAt).getTime();
      return time >= from && time < to;
    })
    .reduce((total, movement) => total + Math.abs(movement.quantity) * (movement.unitCost ?? 0), 0);
}

function compareTrend(current: number, previous: number): "up" | "down" | "flat" {
  if (current > previous) return "up";
  if (current < previous) return "down";
  return "flat";
}

function movementLabel(type: StockMovement["type"]) {
  if (type === "STOCK_IN") return "Received";
  if (type === "STOCK_OUT") return "Used";
  if (type === "WASTAGE") return "Wastage";
  if (type === "TRANSFER_IN") return "Transferred in";
  if (type === "TRANSFER_OUT") return "Transferred out";
  return "Adjusted";
}

function movementTone(type: StockMovement["type"]) {
  if (type === "STOCK_IN" || type === "TRANSFER_IN") return "in";
  if (type === "WASTAGE") return "waste";
  if (type === "STOCK_OUT" || type === "TRANSFER_OUT") return "out";
  return "adjust";
}

function formatRelativeTime(value: string) {
  const time = new Date(value).getTime();
  const diffMinutes = Math.max(0, Math.round((Date.now() - time) / 60_000));
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(value).toLocaleDateString("en-SA", { day: "numeric", month: "short" });
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-SA", { maximumFractionDigits: 2 }).format(value);
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("en-SA", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function startOfDay(value: Date) {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
}

function startOfWeek(value: Date) {
  const result = startOfDay(value);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}

function toYMD(value: Date) {
  return value.toISOString().slice(0, 10);
}

async function withFallback<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}
