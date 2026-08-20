import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAlerts } from "../api/alerts";
import { useAuth } from "../context/AuthContext";
import { useLocation } from "../context/LocationContext";
import type { AlertsResponse, Role } from "../types";

type ActionTone = "green" | "red" | "indigo" | "amber" | "orange" | "blue" | "gray" | "purple";

type OperationIconName =
  | "receive"
  | "deduct"
  | "count"
  | "scan"
  | "transfer"
  | "low"
  | "expiry"
  | "history"
  | "purchase"
  | "supplier"
  | "report";

interface OperationAction {
  key: string;
  title: string;
  description: string;
  to: string;
  tone: ActionTone;
  icon: OperationIconName;
  roles: Role[];
  group: "primary" | "secondary";
}

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

const ACTIONS: OperationAction[] = [
  {
    key: "receive",
    title: "Receive Stock",
    description: "Receive a purchase order or add a delivery without a PO.",
    to: "/stock-in",
    tone: "green",
    icon: "receive",
    roles: ["OWNER", "MANAGER"],
    group: "primary",
  },
  {
    key: "deduct",
    title: "Use Stock",
    description: "Record usage, wastage, expiry, or another stock removal.",
    to: "/stock-out",
    tone: "red",
    icon: "deduct",
    roles: ["OWNER", "MANAGER", "OPERATOR"],
    group: "primary",
  },
  {
    key: "count",
    title: "Count Stock",
    description: "Start or continue a physical stock count.",
    to: "/stock-count",
    tone: "indigo",
    icon: "count",
    roles: ["OWNER", "MANAGER", "OPERATOR"],
    group: "primary",
  },
  {
    key: "scan",
    title: "Scan Item",
    description: "Scan a barcode to find an item quickly.",
    to: "/items?action=scan",
    tone: "blue",
    icon: "scan",
    roles: ["OWNER", "MANAGER", "OPERATOR"],
    group: "primary",
  },
  {
    key: "transfer",
    title: "Transfer Stock",
    description: "Move stock between branches.",
    to: "/transfers",
    tone: "amber",
    icon: "transfer",
    roles: ["OWNER", "MANAGER"],
    group: "primary",
  },
  {
    key: "history",
    title: "Stock Ledger",
    description: "Review receipts, usage, transfers, counts, and adjustments.",
    to: "/movements",
    tone: "gray",
    icon: "history",
    roles: ["OWNER", "MANAGER", "OPERATOR"],
    group: "secondary",
  },
  {
    key: "purchases",
    title: "Purchase Orders",
    description: "Review drafts, open orders, and receiving progress.",
    to: "/purchases",
    tone: "green",
    icon: "purchase",
    roles: ["OWNER", "MANAGER"],
    group: "secondary",
  },
  {
    key: "suppliers",
    title: "Suppliers",
    description: "Review suppliers and their purchasing setup.",
    to: "/suppliers",
    tone: "blue",
    icon: "supplier",
    roles: ["OWNER", "MANAGER"],
    group: "secondary",
  },
  {
    key: "reports",
    title: "Reports",
    description: "Review inventory, purchasing, and stock trends.",
    to: "/reports",
    tone: "indigo",
    icon: "report",
    roles: ["OWNER", "MANAGER"],
    group: "secondary",
  },
];

export function DailyOperationsPage() {
  const { user } = useAuth();
  const { locations, activeLocationId } = useLocation();
  const navigate = useNavigate();
  const role = user?.role ?? null;
  const activeLocation = locations.find((location) => location.id === activeLocationId) ?? locations[0];
  const [alerts, setAlerts] = useState<AlertsResponse>(EMPTY_ALERTS);
  const [tasksLoading, setTasksLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setTasksLoading(true);
    getAlerts()
      .then((response) => {
        if (!cancelled) setAlerts(response);
      })
      .catch(() => {
        if (!cancelled) setAlerts(EMPTY_ALERTS);
      })
      .finally(() => {
        if (!cancelled) setTasksLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeLocationId]);

  const visibleActions = useMemo(
    () => ACTIONS.filter((action) => role !== null && action.roles.includes(role)),
    [role],
  );

  const primaryActions = visibleActions.filter((action) => action.group === "primary");
  const secondaryActions = visibleActions.filter((action) => action.group === "secondary");

  const workItems = useMemo<OperationAction[]>(() => {
    const incomingItemIds = new Set(alerts.awaitingReceiving.map((item) => item.itemId));
    const criticalWithoutCoveredIncoming = alerts.critical.filter(
      (item) => !item.activePo || !incomingItemIds.has(item.itemId),
    ).length;
    const replenishmentCount = (alerts.replenishmentAlerts ?? []).filter(
      (item) => !incomingItemIds.has(item.itemId),
    ).length;
    const orderingCount = criticalWithoutCoveredIncoming + replenishmentCount + alerts.reorderDue.length;
    const receivingCount = alerts.awaitingReceiving.length;
    const expiryCount = alerts.expired.length + alerts.expiringSoon.length;

    const items: OperationAction[] = [];

    if (orderingCount > 0) {
      items.push({
        key: "today-order",
        title: `${orderingCount} ${orderingCount === 1 ? "item needs" : "items need"} ordering`,
        description: "Review ShelfSense recommendations before stock becomes a service risk.",
        to: "/reorder-suggestions",
        tone: criticalWithoutCoveredIncoming > 0 ? "red" : "amber",
        icon: "low",
        roles: ["OWNER", "MANAGER", "OPERATOR"],
        group: "primary",
      });
    }

    if (receivingCount > 0) {
      items.push({
        key: "today-receive",
        title: `${receivingCount} ${receivingCount === 1 ? "item is" : "items are"} waiting to receive`,
        description: "Open purchase orders still have quantities pending receipt.",
        to: "/alerts?focus=receive",
        tone: "purple",
        icon: "receive",
        roles: ["OWNER", "MANAGER"],
        group: "primary",
      });
    }

    if (expiryCount > 0) {
      items.push({
        key: "today-expiry",
        title: `${expiryCount} ${expiryCount === 1 ? "batch needs" : "batches need"} expiry action`,
        description: alerts.expired.length > 0
          ? `${alerts.expired.length} already expired. Review removal, use, transfer, or disposal.`
          : "Review stock approaching expiry and decide what to do before it becomes waste.",
        to: "/alerts?focus=expiry",
        tone: alerts.expired.length > 0 ? "red" : "orange",
        icon: "expiry",
        roles: ["OWNER", "MANAGER", "OPERATOR"],
        group: "primary",
      });
    }

    return items.filter((item) => role !== null && item.roles.includes(role));
  }, [alerts, role]);

  return (
    <div className="daily-ops-page">
      <section className="daily-ops-hero">
        <div>
          <span className="daily-ops-kicker">Today&apos;s Work</span>
          <h1 className="page-title">What needs attention today</h1>
          <p className="page-subtitle">
            ShelfSense brings together the inventory work that actually needs a decision or action.
          </p>
        </div>
        <div className="daily-ops-context" aria-label="Current operation context">
          <span>Branch</span>
          <strong>{activeLocation?.name ?? "Current branch"}</strong>
          {role && <em>{role.toLowerCase()}</em>}
        </div>
      </section>

      <section className="daily-ops-section" aria-labelledby="today-work-heading">
        <div className="daily-ops-section-head">
          <h2 id="today-work-heading">Needs action</h2>
          <p>Only work that currently needs attention appears here.</p>
        </div>

        {tasksLoading ? (
          <div className="page-loading">
            <div className="spinner" />
            <p>Checking today&apos;s inventory work…</p>
          </div>
        ) : workItems.length > 0 ? (
          <div className="daily-ops-grid">
            {workItems.map((action) => (
              <OperationCard
                key={action.key}
                action={action}
                onSelect={() => navigate(action.to)}
              />
            ))}
          </div>
        ) : (
          <div className="daily-ops-empty">
            <div className="daily-ops-empty-icon">✓</div>
            <div>
              <strong>Nothing urgent right now</strong>
              <p>No ordering, receiving, or expiry actions are waiting for this branch.</p>
            </div>
          </div>
        )}
      </section>

      <section className="daily-ops-section" aria-labelledby="quick-actions-heading">
        <div className="daily-ops-section-head">
          <h2 id="quick-actions-heading">Quick actions</h2>
          <p>Common floor tasks remain one tap away.</p>
        </div>
        <div className="daily-ops-grid">
          {primaryActions.map((action) => (
            <OperationCard
              key={action.key}
              action={action}
              onSelect={() => navigate(action.to)}
            />
          ))}
        </div>
      </section>

      {secondaryActions.length > 0 && (
        <section className="daily-ops-section" aria-labelledby="follow-up-heading">
          <div className="daily-ops-section-head">
            <h2 id="follow-up-heading">Review & follow-up</h2>
            <p>Open these when you need history, purchasing detail, supplier information, or reporting.</p>
          </div>
          <div className="daily-ops-secondary-grid">
            {secondaryActions.map((action) => (
              <OperationCard
                key={action.key}
                action={action}
                compact
                onSelect={() => navigate(action.to)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function OperationCard({
  action,
  compact = false,
  onSelect,
}: {
  action: OperationAction;
  compact?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`daily-op-card daily-op-card--${action.tone}${compact ? " daily-op-card--compact" : ""}`}
      onClick={onSelect}
    >
      <span className="daily-op-card-icon">
        <OperationIcon icon={action.icon} />
      </span>
      <span className="daily-op-card-body">
        <strong>{action.title}</strong>
        <span>{action.description}</span>
      </span>
      <span className="daily-op-card-arrow" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        </svg>
      </span>
    </button>
  );
}

function OperationIcon({ icon }: { icon: OperationIconName }) {
  if (icon === "receive") {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="m5 12 7 7 7-7"/></svg>;
  }
  if (icon === "deduct") {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>;
  }
  if (icon === "count") {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11h6"/><path d="M9 15h6"/><path d="M8 3h8l2 3v15H6V6l2-3z"/></svg>;
  }
  if (icon === "scan") {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5V3h4"/><path d="M17 3h4v4"/><path d="M21 17v4h-4"/><path d="M7 21H3v-4"/><path d="M7 12h10"/></svg>;
  }
  if (icon === "transfer") {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h13"/><path d="m14 4 3 3-3 3"/><path d="M20 17H7"/><path d="m10 14-3 3 3 3"/></svg>;
  }
  if (icon === "low") {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19h16"/><path d="M6 15h3"/><path d="M11 11h3"/><path d="M16 7h3"/></svg>;
  }
  if (icon === "expiry") {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>;
  }
  if (icon === "history") {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h13"/><path d="m13 4 3 3-3 3"/><path d="M21 17H8"/><path d="m11 14-3 3 3 3"/></svg>;
  }
  if (icon === "purchase") {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2h12l3 5v15H3V7l3-5z"/><path d="M3 7h18"/></svg>;
  }
  if (icon === "supplier") {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21V8l9-5 9 5v13"/><path d="M8 21v-7h8v7"/></svg>;
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/></svg>;
}
