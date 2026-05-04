import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useLocation } from "../context/LocationContext";
import type { Role } from "../types";

type ActionTone = "green" | "red" | "indigo" | "amber" | "orange" | "blue" | "gray";

interface OperationAction {
  key: string;
  title: string;
  description: string;
  to: string;
  tone: ActionTone;
  icon: "receive" | "deduct" | "count" | "scan" | "transfer" | "low" | "expiry" | "history" | "purchase" | "supplier" | "report";
  roles: Role[];
  group: "primary" | "secondary";
}

const ACTIONS: OperationAction[] = [
  {
    key: "receive",
    title: "Receive Stock",
    description: "Add delivered items into inventory.",
    to: "/stock-in",
    tone: "green",
    icon: "receive",
    roles: ["OWNER", "MANAGER"],
    group: "primary",
  },
  {
    key: "deduct",
    title: "Use / Deduct Stock",
    description: "Record usage, wastage, or removals.",
    to: "/stock-out",
    tone: "red",
    icon: "deduct",
    roles: ["OWNER", "MANAGER", "OPERATOR"],
    group: "primary",
  },
  {
    key: "count",
    title: "Count Stock",
    description: "Prepare a physical count and variance check.",
    to: "/stock-count",
    tone: "indigo",
    icon: "count",
    roles: ["OWNER", "MANAGER", "OPERATOR"],
    group: "primary",
  },
  {
    key: "scan",
    title: "Scan Item",
    description: "Open the scanner for quick item lookup.",
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
    key: "low-stock",
    title: "Reorder Low Stock",
    description: "Turn low-stock items into purchase drafts.",
    to: "/reorder-suggestions",
    tone: "orange",
    icon: "low",
    roles: ["OWNER", "MANAGER", "OPERATOR"],
    group: "primary",
  },
  {
    key: "expiring",
    title: "View Expiring Items",
    description: "Review batches close to expiry.",
    to: "/alerts?focus=expiring",
    tone: "red",
    icon: "expiry",
    roles: ["OWNER", "MANAGER", "OPERATOR"],
    group: "primary",
  },
  {
    key: "history",
    title: "Movement History",
    description: "Audit recent stock activity.",
    to: "/movements",
    tone: "gray",
    icon: "history",
    roles: ["OWNER", "MANAGER", "OPERATOR"],
    group: "secondary",
  },
  {
    key: "purchases",
    title: "Purchases",
    description: "Record supplier purchases.",
    to: "/purchases",
    tone: "green",
    icon: "purchase",
    roles: ["OWNER", "MANAGER"],
    group: "secondary",
  },
  {
    key: "suppliers",
    title: "Suppliers",
    description: "Manage supplier contacts.",
    to: "/suppliers",
    tone: "blue",
    icon: "supplier",
    roles: ["OWNER", "MANAGER"],
    group: "secondary",
  },
  {
    key: "reports",
    title: "Reports",
    description: "Review exports and trends.",
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

  const visibleActions = useMemo(
    () => ACTIONS.filter((action) => role !== null && action.roles.includes(role)),
    [role],
  );
  const primaryActions = visibleActions.filter((action) => action.group === "primary");
  const secondaryActions = visibleActions.filter((action) => action.group === "secondary");

  return (
    <div className="daily-ops-page">
      <section className="daily-ops-hero">
        <div>
          <span className="daily-ops-kicker">Daily Operations</span>
          <h1 className="page-title">Run today&apos;s inventory work</h1>
          <p className="page-subtitle">
            Fast actions for receiving, deducting, scanning, counting, and checking urgent stock issues.
          </p>
        </div>
        <div className="daily-ops-context" aria-label="Current operation context">
          <span>Branch</span>
          <strong>{activeLocation?.name ?? "Current branch"}</strong>
          {role && <em>{role.toLowerCase()}</em>}
        </div>
      </section>

      <section className="daily-ops-section" aria-labelledby="daily-primary-heading">
        <div className="daily-ops-section-head">
          <h2 id="daily-primary-heading">Floor actions</h2>
          <p>Large touch targets for the work staff repeat all day.</p>
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
        <section className="daily-ops-section" aria-labelledby="daily-secondary-heading">
          <div className="daily-ops-section-head">
            <h2 id="daily-secondary-heading">Operational follow-up</h2>
            <p>Review activity, suppliers, purchases, and reporting after the floor work.</p>
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

function OperationIcon({ icon }: { icon: OperationAction["icon"] }) {
  if (icon === "receive") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5v14" />
        <path d="m5 12 7 7 7-7" />
      </svg>
    );
  }

  if (icon === "deduct") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 19V5" />
        <path d="m5 12 7-7 7 7" />
      </svg>
    );
  }

  if (icon === "count") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 11h6" />
        <path d="M9 15h6" />
        <path d="M8 3h8l2 3v15H6V6l2-3z" />
      </svg>
    );
  }

  if (icon === "scan") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7V5a1 1 0 0 1 1-1h2" />
        <path d="M17 4h2a1 1 0 0 1 1 1v2" />
        <path d="M20 17v2a1 1 0 0 1-1 1h-2" />
        <path d="M7 20H5a1 1 0 0 1-1-1v-2" />
        <path d="M7 12h10" />
      </svg>
    );
  }

  if (icon === "transfer") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7h13" />
        <path d="m14 4 3 3-3 3" />
        <path d="M20 17H7" />
        <path d="m10 14-3 3 3 3" />
      </svg>
    );
  }

  if (icon === "low") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
        <path d="M10.3 3.9 2.1 18a2 2 0 0 0 1.7 3h16.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      </svg>
    );
  }

  if (icon === "expiry") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }

  if (icon === "history") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 4v6h6" />
        <path d="M12 7v5l4 2" />
      </svg>
    );
  }

  if (icon === "purchase") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 7h14l-2 8H8L7 7z" />
        <path d="M7 7 6 4H3" />
        <circle cx="9" cy="20" r="1" />
        <circle cx="18" cy="20" r="1" />
      </svg>
    );
  }

  if (icon === "supplier") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.9" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19V5" />
      <path d="M8 19v-7" />
      <path d="M12 19V8" />
      <path d="M16 19v-4" />
      <path d="M20 19V9" />
    </svg>
  );
}
