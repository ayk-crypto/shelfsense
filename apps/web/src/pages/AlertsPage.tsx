import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getAlerts } from "../api/alerts";
import { closePurchase } from "../api/purchases";
import { useLocation } from "../context/LocationContext";
import { useWorkspaceSettings } from "../context/WorkspaceSettingsContext";
import type {
  AlertsResponse,
  AwaitingReceivingAlert,
  BelowParAlert,
  CriticalStockAlert,
  ExpiryAlert,
  ReorderDueAlert,
} from "../types";
import { getSuggestedReorderQuantity } from "../utils/reorder";
import { hasPurchaseUnit, getSuggestedPurchaseQty } from "../utils/purchaseUnits";

type AlertTab = "all" | "critical" | "reorder-due" | "below-par" | "awaiting" | "expiring" | "expired";

const EMPTY_ALERTS: AlertsResponse = {
  lowStock: [],
  critical: [],
  reorderDue: [],
  belowPar: [],
  awaitingReceiving: [],
  expiringSoon: [],
  expired: [],
};

function fmtN(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function fmtDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function getDays(value: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const exp = new Date(value);
  exp.setHours(0, 0, 0, 0);
  return Math.round((exp.getTime() - now.getTime()) / 86400000);
}

function timeAgo(date: Date): string {
  const secs = Math.round((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

function labelFrequency(freq: string) {
  switch (freq) {
    case "daily":    return "Daily";
    case "weekly":   return "Weekly";
    case "biweekly": return "Bi-weekly";
    case "monthly":  return "Monthly";
    case "custom":   return "Custom";
    default:         return freq;
  }
}

export function AlertsPage() {
  const { activeLocationId } = useLocation();
  const { settings } = useWorkspaceSettings();
  const [alerts, setAlerts] = useState<AlertsResponse>(EMPTY_ALERTS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [tab, setTab] = useState<AlertTab>("all");
  const [search, setSearch] = useState("");

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await getAlerts();
      setAlerts(res);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load alerts");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [activeLocationId, load]);

  const q = search.trim().toLowerCase();
  const matches = (name: string) => !q || name.toLowerCase().includes(q);

  const criticalSorted = [...alerts.critical].sort((a, b) => {
    const ra = a.criticalStockLevel > 0 ? a.quantity / a.criticalStockLevel : 0;
    const rb = b.criticalStockLevel > 0 ? b.quantity / b.criticalStockLevel : 0;
    return ra - rb;
  });
  const reorderSorted = [...alerts.reorderDue].sort((a, b) => b.daysOverdue - a.daysOverdue);

  const filteredCritical   = criticalSorted.filter(i => matches(i.itemName));
  const filteredReorderDue = reorderSorted.filter(i => matches(i.itemName));
  const filteredBelowPar   = alerts.belowPar.filter(i => matches(i.itemName));
  const filteredAwaiting   = alerts.awaitingReceiving.filter(i => matches(i.itemName));
  const filteredExpiring   = alerts.expiringSoon.filter(b => matches(b.item.name));
  const filteredExpired    = alerts.expired.filter(b => matches(b.item.name));

  const counts = {
    critical:   alerts.critical.length,
    reorderDue: alerts.reorderDue.length,
    belowPar:   alerts.belowPar.length,
    awaiting:   alerts.awaitingReceiving.length,
    expiring:   alerts.expiringSoon.length,
    expired:    alerts.expired.length,
    get all() {
      return this.critical + this.reorderDue + this.belowPar + this.awaiting + this.expiring + this.expired;
    },
  };

  if (loading) return <div className="page-loading"><div className="spinner" /><p>Loading alerts…</p></div>;
  if (error)   return <div className="page-error"><div className="alert alert--error">{error}</div></div>;

  const showCritical   = (tab === "all" || tab === "critical")    && filteredCritical.length > 0;
  const showReorderDue = (tab === "all" || tab === "reorder-due") && filteredReorderDue.length > 0;
  const showBelowPar   = (tab === "all" || tab === "below-par")   && filteredBelowPar.length > 0;
  const showAwaiting   = (tab === "all" || tab === "awaiting")    && filteredAwaiting.length > 0;
  const showExpiring   = (tab === "all" || tab === "expiring")    && filteredExpiring.length > 0;
  const showExpired    = (tab === "all" || tab === "expired")     && filteredExpired.length > 0;

  return (
    <div className="alv-page">

      {/* ── Page header ── */}
      <div className="alv-header">
        <div className="alv-header-left">
          <h1 className="alv-title">Alerts</h1>
          <p className="alv-subtitle">
            {counts.all === 0
              ? "All inventory is healthy — nothing needs attention."
              : `${counts.all} alert${counts.all !== 1 ? "s" : ""} need${counts.all === 1 ? "s" : ""} your attention`}
          </p>
        </div>
        <div className="alv-header-right">
          {lastRefreshed && <span className="alv-last-updated">Updated {timeAgo(lastRefreshed)}</span>}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void load(true)}
            disabled={refreshing}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={refreshing ? "alv-spin" : ""}>
              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          {(counts.critical > 0 || counts.reorderDue > 0) && (
            <Link className="btn btn--primary btn--sm" to="/reorder-suggestions">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Create Purchase Draft
            </Link>
          )}
        </div>
      </div>

      {/* ── KPI tiles ── */}
      <div className="alv-kpis alv-kpis--wide">
        <button type="button" className={`alv-kpi ${tab === "all" ? "alv-kpi--active" : ""} ${counts.all > 0 ? "alv-kpi--total-warn" : "alv-kpi--total-ok"}`} onClick={() => setTab("all")}>
          <div className={`alv-kpi-icon ${counts.all > 0 ? "alv-kpi-icon--warn" : "alv-kpi-icon--ok"}`}>
            <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z"/></svg>
          </div>
          <div className="alv-kpi-body">
            <span className="alv-kpi-label">Total</span>
            <strong className={`alv-kpi-value ${counts.all > 0 ? "alv-kpi-value--warn" : "alv-kpi-value--ok"}`}>{counts.all}</strong>
          </div>
        </button>

        <button type="button" className={`alv-kpi ${tab === "critical" ? "alv-kpi--active" : ""}`} onClick={() => setTab("critical")}>
          <div className="alv-kpi-icon alv-kpi-icon--red">
            <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
          </div>
          <div className="alv-kpi-body">
            <span className="alv-kpi-label">Critical</span>
            <strong className="alv-kpi-value alv-kpi-value--red">{counts.critical}</strong>
          </div>
        </button>

        <button type="button" className={`alv-kpi ${tab === "reorder-due" ? "alv-kpi--active" : ""}`} onClick={() => setTab("reorder-due")}>
          <div className="alv-kpi-icon alv-kpi-icon--amber">
            <svg viewBox="0 0 20 20" fill="currentColor"><path d="M4 2a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H4zm14 18a2 2 0 100-4 2 2 0 000 4zM7 16a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
          </div>
          <div className="alv-kpi-body">
            <span className="alv-kpi-label">Reorder Due</span>
            <strong className="alv-kpi-value alv-kpi-value--amber">{counts.reorderDue}</strong>
          </div>
        </button>

        <button type="button" className={`alv-kpi ${tab === "below-par" ? "alv-kpi--active" : ""}`} onClick={() => setTab("below-par")}>
          <div className="alv-kpi-icon alv-kpi-icon--blue">
            <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3zm11 4a1 1 0 10-2 0v4a1 1 0 102 0V7zm-3 1a1 1 0 10-2 0v3a1 1 0 102 0V8zM8 9a1 1 0 00-2 0v2a1 1 0 102 0V9z" clipRule="evenodd"/></svg>
          </div>
          <div className="alv-kpi-body">
            <span className="alv-kpi-label">Below Par</span>
            <strong className="alv-kpi-value alv-kpi-value--blue">{counts.belowPar}</strong>
          </div>
        </button>

        <button type="button" className={`alv-kpi ${tab === "awaiting" ? "alv-kpi--active" : ""}`} onClick={() => setTab("awaiting")}>
          <div className="alv-kpi-icon alv-kpi-icon--purple">
            <svg viewBox="0 0 20 20" fill="currentColor"><path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/><path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H10a1 1 0 001-1V5a1 1 0 00-1-1H3zM14 7a1 1 0 00-1 1v6.05A2.5 2.5 0 0115.95 16H17a1 1 0 001-1v-5a1 1 0 00-.293-.707l-2-2A1 1 0 0015 7h-1z"/></svg>
          </div>
          <div className="alv-kpi-body">
            <span className="alv-kpi-label">Awaiting PO</span>
            <strong className="alv-kpi-value alv-kpi-value--purple">{counts.awaiting}</strong>
          </div>
        </button>

        <button type="button" className={`alv-kpi ${tab === "expiring" ? "alv-kpi--active" : ""}`} onClick={() => setTab("expiring")}>
          <div className="alv-kpi-icon alv-kpi-icon--orange">
            <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/></svg>
          </div>
          <div className="alv-kpi-body">
            <span className="alv-kpi-label">Expiring Soon</span>
            <strong className="alv-kpi-value alv-kpi-value--orange">{counts.expiring}</strong>
          </div>
        </button>

        <button type="button" className={`alv-kpi ${tab === "expired" ? "alv-kpi--active" : ""}`} onClick={() => setTab("expired")}>
          <div className="alv-kpi-icon alv-kpi-icon--red">
            <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/></svg>
          </div>
          <div className="alv-kpi-body">
            <span className="alv-kpi-label">Expired</span>
            <strong className="alv-kpi-value alv-kpi-value--red">{counts.expired}</strong>
          </div>
        </button>
      </div>

      {/* ── Toolbar: tabs + search ── */}
      <div className="alv-toolbar">
        <div className="alv-tabs" role="tablist">
          {(["all", "critical", "reorder-due", "below-par", "awaiting", "expiring", "expired"] as AlertTab[]).map((t) => {
            const labels: Record<AlertTab, string> = {
              all: "All",
              critical: "Critical",
              "reorder-due": "Reorder Due",
              "below-par": "Below Par",
              awaiting: "Awaiting PO",
              expiring: "Expiring",
              expired: "Expired",
            };
            const tabCounts: Record<AlertTab, number> = {
              all: counts.all,
              critical: counts.critical,
              "reorder-due": counts.reorderDue,
              "below-par": counts.belowPar,
              awaiting: counts.awaiting,
              expiring: counts.expiring,
              expired: counts.expired,
            };
            const badgeClass: Record<AlertTab, string> = {
              all: "alv-tab-badge--default",
              critical: "alv-tab-badge--red",
              "reorder-due": "alv-tab-badge--amber",
              "below-par": "alv-tab-badge--blue",
              awaiting: "alv-tab-badge--purple",
              expiring: "alv-tab-badge--orange",
              expired: "alv-tab-badge--red",
            };
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={`alv-tab ${tab === t ? "alv-tab--active" : ""}`}
                onClick={() => setTab(t)}
              >
                {labels[t]}
                {tabCounts[t] > 0 && (
                  <span className={`alv-tab-badge ${badgeClass[t]}`}>{tabCounts[t]}</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="alv-search-wrap">
          <svg className="alv-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="search"
            placeholder="Search items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="alv-search-input"
          />
        </div>
      </div>

      {/* ── All-clear state ── */}
      {counts.all === 0 && (
        <div className="alv-all-clear">
          <div className="alv-all-clear-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          </div>
          <div>
            <h2 className="alv-all-clear-title">All clear</h2>
            <p className="alv-all-clear-sub">No stock or expiry alerts to report right now.</p>
          </div>
        </div>
      )}

      {/* ── Critical stock ── */}
      {showCritical && (
        <CriticalTable
          items={filteredCritical}
          multiplier={settings.lowStockMultiplier}
          showSectionHead={tab === "all"}
        />
      )}
      {tab === "critical" && counts.critical === 0 && (
        <EmptyTab icon="red" message="No items at critical stock level." />
      )}
      {tab === "critical" && counts.critical > 0 && filteredCritical.length === 0 && q && <NoMatch />}

      {/* ── Reorder due ── */}
      {showReorderDue && (
        <ReorderDueTable items={filteredReorderDue} showSectionHead={tab === "all"} />
      )}
      {tab === "reorder-due" && counts.reorderDue === 0 && (
        <EmptyTab icon="amber" message="No procurement cycles due right now." />
      )}
      {tab === "reorder-due" && counts.reorderDue > 0 && filteredReorderDue.length === 0 && q && <NoMatch />}

      {/* ── Below par ── */}
      {showBelowPar && (
        <BelowParTable items={filteredBelowPar} showSectionHead={tab === "all"} />
      )}
      {tab === "below-par" && counts.belowPar === 0 && (
        <EmptyTab icon="blue" message="No items below their par (target) level." />
      )}
      {tab === "below-par" && counts.belowPar > 0 && filteredBelowPar.length === 0 && q && <NoMatch />}

      {/* ── Awaiting receiving ── */}
      {showAwaiting && (
        <AwaitingTable
          items={filteredAwaiting}
          showSectionHead={tab === "all"}
          onClose={async (purchaseId) => {
            await closePurchase(purchaseId);
            await load();
          }}
        />
      )}
      {tab === "awaiting" && counts.awaiting === 0 && (
        <EmptyTab icon="purple" message="No items awaiting a pending purchase order." />
      )}
      {tab === "awaiting" && counts.awaiting > 0 && filteredAwaiting.length === 0 && q && <NoMatch />}

      {/* ── Expiring soon ── */}
      {showExpiring && (
        <ExpiryTable title="Expiring Soon" tone="orange" batches={filteredExpiring} showSectionHead={tab === "all"} />
      )}
      {tab === "expiring" && counts.expiring === 0 && (
        <EmptyTab icon="orange" message={`No batches expiring in the next ${settings.expiryAlertDays} days.`} />
      )}
      {tab === "expiring" && counts.expiring > 0 && filteredExpiring.length === 0 && q && <NoMatch />}

      {/* ── Expired ── */}
      {showExpired && (
        <ExpiryTable title="Expired" tone="red" batches={filteredExpired} showSectionHead={tab === "all"} />
      )}
      {tab === "expired" && counts.expired === 0 && (
        <EmptyTab icon="red" message="No expired batches with remaining stock." />
      )}
      {tab === "expired" && counts.expired > 0 && filteredExpired.length === 0 && q && <NoMatch />}

    </div>
  );
}

/* ── Critical Stock Table ────────────────────────────────────────────────── */

function CriticalTable({ items, multiplier, showSectionHead }: { items: CriticalStockAlert[]; multiplier: number; showSectionHead: boolean }) {
  return (
    <section className="alv-section">
      {showSectionHead && (
        <div className="alv-sec-head alv-sec-head--red">
          <div className="alv-sec-head-left">
            <div className="alv-sec-icon alv-sec-icon--red">
              <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
            </div>
            <span className="alv-sec-title">Critical Stock</span>
            <span className="alv-sec-badge alv-sec-badge--red">{items.length}</span>
          </div>
          <Link className="btn btn--ghost btn--sm" to="/reorder-suggestions">
            Create Purchase Draft
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
            </svg>
          </Link>
        </div>
      )}
      <div className="alv-table-wrap">
        <table className="alv-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Stock Level</th>
              <th className="alv-th-r">Current Stock</th>
              <th className="alv-th-r">Critical Level</th>
              <th className="alv-th-r">Shortage</th>
              <th className="alv-th-r">Suggested Buy</th>
              <th>Procurement</th>
              <th className="alv-th-action"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const shortage = getSuggestedReorderQuantity(item.quantity, item.criticalStockLevel, multiplier);
              const factor = item.purchaseConversionFactor;
              const hasUnit = hasPurchaseUnit(item.purchaseUnit, factor);
              const buyPU = hasUnit && factor ? getSuggestedPurchaseQty(shortage, factor) : null;
              const pct = item.criticalStockLevel > 0 ? Math.min(100, (item.quantity / item.criticalStockLevel) * 100) : 0;
              const isOut = item.quantity === 0;
              return (
                <tr key={item.itemId} className={`alv-tr alv-tr--critical ${isOut ? "alv-tr--out" : ""}`}>
                  <td className="alv-td-name">
                    <div className="alv-item-name">{item.itemName}</div>
                    <div className="alv-item-meta">
                      <span className="alv-item-unit">{item.unit}</span>
                      {isOut && <span className="alv-pill alv-pill--danger">Out of stock</span>}
                    </div>
                  </td>
                  <td className="alv-td-bar">
                    <div className="alv-bar-wrap">
                      <div className="alv-bar-track">
                        <div className="alv-bar-fill" style={{ width: `${pct}%`, background: isOut ? "#ef4444" : "#f97316" }} />
                      </div>
                      <span className="alv-bar-pct">{Math.round(pct)}%</span>
                    </div>
                  </td>
                  <td className="alv-td-r">
                    <span className={`alv-num ${isOut ? "alv-num--danger" : "alv-num--red"}`}>{fmtN(item.quantity)}</span>
                    <span className="alv-unit"> {item.unit}</span>
                  </td>
                  <td className="alv-td-r">
                    <span className="alv-num">{fmtN(item.criticalStockLevel)}</span>
                    <span className="alv-unit"> {item.unit}</span>
                  </td>
                  <td className="alv-td-r">
                    <span className="alv-num alv-num--red">{fmtN(shortage)}</span>
                    <span className="alv-unit"> {item.unit}</span>
                  </td>
                  <td className="alv-td-r">
                    {buyPU != null
                      ? <><span className="alv-num">{buyPU}</span><span className="alv-unit"> {item.purchaseUnit}</span></>
                      : <span className="alv-dash">—</span>}
                  </td>
                  <td>
                    {item.activePo
                      ? (
                        <Link to={`/purchases/${item.activePo.purchaseId}`} className="alv-po-inprogress">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 17H5a2 2 0 0 0-2 2"/><path d="M13 17h6"/><rect x="1" y="3" width="15" height="13" rx="2"/><path d="m19 10 3 3-3 3"/></svg>
                          PO in progress
                        </Link>
                      )
                      : <span className="alv-dash">—</span>}
                  </td>
                  <td className="alv-td-action">
                    {item.activePo
                      ? (
                        <Link to={`/purchases/${item.activePo.purchaseId}`} className="alv-row-action alv-row-action--purple">
                          View PO
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                          </svg>
                        </Link>
                      )
                      : (
                        <Link to="/reorder-suggestions" className="alv-row-action alv-row-action--red">
                          Reorder
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                          </svg>
                        </Link>
                      )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ── Reorder Due Table ────────────────────────────────────────────────────── */

function ReorderDueTable({ items, showSectionHead }: { items: ReorderDueAlert[]; showSectionHead: boolean }) {
  return (
    <section className="alv-section">
      {showSectionHead && (
        <div className="alv-sec-head alv-sec-head--amber">
          <div className="alv-sec-head-left">
            <div className="alv-sec-icon alv-sec-icon--amber">
              <svg viewBox="0 0 20 20" fill="currentColor"><path d="M4 2a1 1 0 000 2h1.22l.305 1.222a.997.997 0 00.01.042l1.358 5.43-.893.892C3.74 11.846 4.632 14 6.414 14H15a1 1 0 000-2H6.414l1-1H14a1 1 0 00.894-.553l3-6A1 1 0 0017 3H6.28l-.31-1.243A1 1 0 005 1H4zm14 18a2 2 0 100-4 2 2 0 000 4zM7 16a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
            </div>
            <span className="alv-sec-title">Reorder Due</span>
            <span className="alv-sec-badge alv-sec-badge--amber">{items.length}</span>
          </div>
          <Link className="btn btn--ghost btn--sm" to="/reorder-suggestions">
            Create Purchase Draft
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
            </svg>
          </Link>
        </div>
      )}
      <div className="alv-table-wrap">
        <table className="alv-table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="alv-th-r">Current Stock</th>
              <th className="alv-th-r">Par Level</th>
              <th>Frequency</th>
              <th className="alv-th-r">Next Procurement</th>
              <th className="alv-th-r">Status</th>
              <th className="alv-th-action"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.itemId} className="alv-tr alv-tr--reorder">
                <td className="alv-td-name">
                  <div className="alv-item-name">{item.itemName}</div>
                  <div className="alv-item-meta"><span className="alv-item-unit">{item.unit}</span></div>
                </td>
                <td className="alv-td-r">
                  <span className="alv-num alv-num--amber">{fmtN(item.quantity)}</span>
                  <span className="alv-unit"> {item.unit}</span>
                </td>
                <td className="alv-td-r">
                  {item.parStockLevel != null
                    ? <><span className="alv-num">{fmtN(item.parStockLevel)}</span><span className="alv-unit"> {item.unit}</span></>
                    : <span className="alv-dash">—</span>}
                </td>
                <td>
                  <span className="alv-freq-badge">{labelFrequency(item.procurementFrequency)}</span>
                </td>
                <td className="alv-td-r">
                  <span className="alv-date">{fmtDate(item.nextProcurementDate)}</span>
                </td>
                <td className="alv-td-r">
                  {item.daysOverdue > 0
                    ? <span className="alv-pill alv-pill--warn">{item.daysOverdue}d overdue</span>
                    : <span className="alv-pill alv-pill--caution">Due today</span>}
                </td>
                <td className="alv-td-action">
                  <Link to="/reorder-suggestions" className="alv-row-action alv-row-action--amber">
                    Reorder
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                    </svg>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ── Below Par Table ──────────────────────────────────────────────────────── */

function BelowParTable({ items, showSectionHead }: { items: BelowParAlert[]; showSectionHead: boolean }) {
  return (
    <section className="alv-section">
      {showSectionHead && (
        <div className="alv-sec-head alv-sec-head--blue">
          <div className="alv-sec-head-left">
            <div className="alv-sec-icon alv-sec-icon--blue">
              <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 3a1 1 0 000 2v8a2 2 0 002 2h2.586l-1.293 1.293a1 1 0 101.414 1.414L10 15.414l2.293 2.293a1 1 0 001.414-1.414L12.414 15H15a2 2 0 002-2V5a1 1 0 100-2H3zm11 4a1 1 0 10-2 0v4a1 1 0 102 0V7zm-3 1a1 1 0 10-2 0v3a1 1 0 102 0V8zM8 9a1 1 0 00-2 0v2a1 1 0 102 0V9z" clipRule="evenodd"/></svg>
            </div>
            <span className="alv-sec-title">Below Par Level</span>
            <span className="alv-sec-badge alv-sec-badge--blue">{items.length}</span>
          </div>
        </div>
      )}
      <div className="alv-table-wrap">
        <table className="alv-table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="alv-th-r">Current Stock</th>
              <th className="alv-th-r">Par Level</th>
              <th className="alv-th-r">Gap</th>
              <th>Next Procurement</th>
              <th className="alv-th-action"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const gap = item.parStockLevel - item.quantity;
              return (
                <tr key={item.itemId} className="alv-tr alv-tr--below-par">
                  <td className="alv-td-name">
                    <div className="alv-item-name">{item.itemName}</div>
                    <div className="alv-item-meta"><span className="alv-item-unit">{item.unit}</span></div>
                  </td>
                  <td className="alv-td-r">
                    <span className="alv-num alv-num--blue">{fmtN(item.quantity)}</span>
                    <span className="alv-unit"> {item.unit}</span>
                  </td>
                  <td className="alv-td-r">
                    <span className="alv-num">{fmtN(item.parStockLevel)}</span>
                    <span className="alv-unit"> {item.unit}</span>
                  </td>
                  <td className="alv-td-r">
                    <span className="alv-num alv-num--blue">{fmtN(gap)}</span>
                    <span className="alv-unit"> {item.unit}</span>
                  </td>
                  <td>
                    {item.nextProcurementDate
                      ? <span className="alv-date">{fmtDate(item.nextProcurementDate)}</span>
                      : <span className="alv-dash">—</span>}
                  </td>
                  <td className="alv-td-action">
                    <Link to="/reorder-suggestions" className="alv-row-action alv-row-action--blue">
                      Reorder
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                      </svg>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ── Awaiting Receiving Table ─────────────────────────────────────────────── */

function AwaitingTable({
  items,
  showSectionHead,
  onClose,
}: {
  items: AwaitingReceivingAlert[];
  showSectionHead: boolean;
  onClose: (purchaseId: string) => Promise<void>;
}) {
  const [closing, setClosing] = useState<string | null>(null);

  const poStatusLabel: Record<string, string> = {
    ORDERED: "Ordered",
    PARTIALLY_RECEIVED: "Partial",
  };

  async function handleClose(purchaseId: string) {
    if (!window.confirm("Close this PO? It will be marked as received and removed from alerts.")) return;
    setClosing(purchaseId);
    try {
      await onClose(purchaseId);
    } finally {
      setClosing(null);
    }
  }

  return (
    <section className="alv-section">
      {showSectionHead && (
        <div className="alv-sec-head alv-sec-head--purple">
          <div className="alv-sec-head-left">
            <div className="alv-sec-icon alv-sec-icon--purple">
              <svg viewBox="0 0 20 20" fill="currentColor"><path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/><path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H10a1 1 0 001-1V5a1 1 0 00-1-1H3zM14 7a1 1 0 00-1 1v6.05A2.5 2.5 0 0115.95 16H17a1 1 0 001-1v-5a1 1 0 00-.293-.707l-2-2A1 1 0 0015 7h-1z"/></svg>
            </div>
            <span className="alv-sec-title">Awaiting Receiving</span>
            <span className="alv-sec-badge alv-sec-badge--purple">{items.length}</span>
          </div>
          <Link className="btn btn--ghost btn--sm" to="/purchases">
            View Purchase Orders
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
            </svg>
          </Link>
        </div>
      )}
      <div className="alv-table-wrap">
        <table className="alv-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>PO Reference</th>
              <th className="alv-th-r">Ordered</th>
              <th className="alv-th-r">Received</th>
              <th className="alv-th-r">Pending</th>
              <th>PO Status</th>
              <th>Expected By</th>
              <th className="alv-th-action"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const isCritical = item.criticalStockLevel != null && item.quantity <= item.criticalStockLevel;
              const isClosing = closing === item.purchaseId;
              return (
                <tr key={item.itemId} className="alv-tr alv-tr--awaiting">
                  <td className="alv-td-name">
                    <div className="alv-item-name">{item.itemName}</div>
                    <div className="alv-item-meta">
                      <span className="alv-item-unit">{item.unit}</span>
                      {isCritical && <span className="alv-pill alv-pill--danger">Critical</span>}
                    </div>
                  </td>
                  <td>
                    <Link to={`/purchases/${item.purchaseId}`} className="alv-po-ref">
                      {item.poReference}
                    </Link>
                  </td>
                  <td className="alv-td-r">
                    <span className="alv-num">{fmtN(item.orderedQty)}</span>
                    <span className="alv-unit"> {item.unit}</span>
                  </td>
                  <td className="alv-td-r">
                    <span className="alv-num alv-num--purple">{fmtN(item.receivedQty)}</span>
                    <span className="alv-unit"> {item.unit}</span>
                  </td>
                  <td className="alv-td-r">
                    <span className="alv-num alv-num--amber">{fmtN(item.pendingQty)}</span>
                    <span className="alv-unit"> {item.unit}</span>
                  </td>
                  <td>
                    <span className={`alv-pill ${item.poStatus === "ORDERED" ? "alv-pill--caution" : "alv-pill--purple"}`}>
                      {poStatusLabel[item.poStatus] ?? item.poStatus}
                    </span>
                  </td>
                  <td>
                    {item.expectedDeliveryDate
                      ? <span className="alv-date">{fmtDate(item.expectedDeliveryDate)}</span>
                      : <span className="alv-dash">—</span>}
                  </td>
                  <td className="alv-td-action alv-td-action--gap">
                    <Link to={`/purchases/${item.purchaseId}`} className="alv-row-action alv-row-action--purple">
                      View PO
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                      </svg>
                    </Link>
                    <button
                      type="button"
                      className="alv-row-action alv-row-action--ghost"
                      onClick={() => void handleClose(item.purchaseId)}
                      disabled={isClosing}
                      title="Mark PO as closed (removes from alerts)"
                    >
                      {isClosing ? "Closing…" : "Close PO"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ── Expiry Table ───────────────────────────────────────────────────────── */

function ExpiryTable({ title, tone, batches, showSectionHead }: { title: string; tone: "orange" | "red"; batches: ExpiryAlert[]; showSectionHead: boolean }) {
  return (
    <section className="alv-section">
      {showSectionHead && (
        <div className={`alv-sec-head alv-sec-head--${tone}`}>
          <div className="alv-sec-head-left">
            <div className={`alv-sec-icon alv-sec-icon--${tone}`}>
              <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/></svg>
            </div>
            <span className="alv-sec-title">{title}</span>
            <span className={`alv-sec-badge alv-sec-badge--${tone}`}>{batches.length}</span>
          </div>
        </div>
      )}
      <div className="alv-table-wrap">
        <table className="alv-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Batch No.</th>
              <th className="alv-th-r">Qty Remaining</th>
              <th className="alv-th-r">Expiry Date</th>
              <th className="alv-th-r">Urgency</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((batch) => {
              const days = getDays(batch.expiryDate);
              let pillLabel: string;
              let pillClass: string;
              if (days < 0) { pillLabel = `${Math.abs(days)}d overdue`; pillClass = "alv-pill--danger"; }
              else if (days === 0) { pillLabel = "Expires today"; pillClass = "alv-pill--danger"; }
              else if (days === 1) { pillLabel = "Tomorrow"; pillClass = "alv-pill--danger"; }
              else if (days <= 3) { pillLabel = `${days}d left`; pillClass = "alv-pill--warn"; }
              else { pillLabel = `${days}d left`; pillClass = "alv-pill--caution"; }
              return (
                <tr key={batch.id} className={`alv-tr alv-tr--${tone}`}>
                  <td className="alv-td-name"><div className="alv-item-name">{batch.item.name}</div></td>
                  <td>{batch.batchNo ? <span className="alv-batch-tag">{batch.batchNo}</span> : <span className="alv-dash">—</span>}</td>
                  <td className="alv-td-r">
                    <span className="alv-num">{fmtN(batch.remainingQuantity)}</span>
                    <span className="alv-unit"> {batch.item.unit}</span>
                  </td>
                  <td className="alv-td-r"><span className="alv-date">{fmtDate(batch.expiryDate)}</span></td>
                  <td className="alv-td-r"><span className={`alv-pill ${pillClass}`}>{pillLabel}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ── Utility components ─────────────────────────────────────────────────── */

function EmptyTab({ icon, message }: { icon: "amber" | "orange" | "red" | "blue" | "purple"; message: string }) {
  return (
    <div className="alv-empty-tab">
      <div className={`alv-empty-tab-icon alv-empty-tab-icon--${icon}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
      </div>
      <p className="alv-empty-tab-msg">{message}</p>
    </div>
  );
}

function NoMatch() {
  return (
    <div className="alv-no-match">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <span>No items match your search.</span>
    </div>
  );
}
