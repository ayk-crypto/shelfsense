import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getAlerts } from "../api/alerts";
import { useLocation } from "../context/LocationContext";
import { useWorkspaceSettings } from "../context/WorkspaceSettingsContext";
import type { AlertsResponse, ExpiryAlert, LowStockAlert } from "../types";
import { getSuggestedReorderQuantity } from "../utils/reorder";
import { hasPurchaseUnit, getSuggestedPurchaseQty } from "../utils/purchaseUnits";

type AlertTab = "all" | "low-stock" | "expiring" | "expired";

const EMPTY_ALERTS: AlertsResponse = { lowStock: [], expiringSoon: [], expired: [] };

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

  const lowStockSorted = [...alerts.lowStock].sort((a, b) => {
    const ra = a.minStockLevel > 0 ? a.quantity / a.minStockLevel : 0;
    const rb = b.minStockLevel > 0 ? b.quantity / b.minStockLevel : 0;
    return ra - rb;
  });
  const filteredLowStock  = lowStockSorted.filter(i => !q || i.itemName.toLowerCase().includes(q));
  const filteredExpiring  = alerts.expiringSoon.filter(b => !q || b.item.name.toLowerCase().includes(q));
  const filteredExpired   = alerts.expired.filter(b => !q || b.item.name.toLowerCase().includes(q));

  const counts = {
    lowStock: alerts.lowStock.length,
    expiring: alerts.expiringSoon.length,
    expired:  alerts.expired.length,
    all:      alerts.lowStock.length + alerts.expiringSoon.length + alerts.expired.length,
  };

  if (loading) return <div className="page-loading"><div className="spinner" /><p>Loading alerts…</p></div>;
  if (error)   return <div className="page-error"><div className="alert alert--error">{error}</div></div>;

  const showLowStock = (tab === "all" || tab === "low-stock") && counts.lowStock > 0 && filteredLowStock.length > 0;
  const showExpiring = (tab === "all" || tab === "expiring") && counts.expiring > 0 && filteredExpiring.length > 0;
  const showExpired  = (tab === "all" || tab === "expired")  && counts.expired > 0  && filteredExpired.length > 0;

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
          {counts.lowStock > 0 && (
            <Link className="btn btn--primary btn--sm" to="/reorder-suggestions">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Create Purchase Draft
            </Link>
          )}
        </div>
      </div>

      {/* ── KPI tiles (click to filter) ── */}
      <div className="alv-kpis">
        <button
          type="button"
          className={`alv-kpi ${tab === "all" ? "alv-kpi--active" : ""} ${counts.all > 0 ? "alv-kpi--total-warn" : "alv-kpi--total-ok"}`}
          onClick={() => setTab("all")}
        >
          <div className={`alv-kpi-icon ${counts.all > 0 ? "alv-kpi-icon--warn" : "alv-kpi-icon--ok"}`}>
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z"/>
            </svg>
          </div>
          <div className="alv-kpi-body">
            <span className="alv-kpi-label">Total Alerts</span>
            <strong className={`alv-kpi-value ${counts.all > 0 ? "alv-kpi-value--warn" : "alv-kpi-value--ok"}`}>{counts.all}</strong>
          </div>
        </button>

        <button
          type="button"
          className={`alv-kpi ${tab === "low-stock" ? "alv-kpi--active" : ""}`}
          onClick={() => setTab("low-stock")}
        >
          <div className="alv-kpi-icon alv-kpi-icon--amber">
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
            </svg>
          </div>
          <div className="alv-kpi-body">
            <span className="alv-kpi-label">Low Stock</span>
            <strong className="alv-kpi-value alv-kpi-value--amber">{counts.lowStock}</strong>
          </div>
        </button>

        <button
          type="button"
          className={`alv-kpi ${tab === "expiring" ? "alv-kpi--active" : ""}`}
          onClick={() => setTab("expiring")}
        >
          <div className="alv-kpi-icon alv-kpi-icon--orange">
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/>
            </svg>
          </div>
          <div className="alv-kpi-body">
            <span className="alv-kpi-label">Expiring Soon</span>
            <strong className="alv-kpi-value alv-kpi-value--orange">{counts.expiring}</strong>
          </div>
        </button>

        <button
          type="button"
          className={`alv-kpi ${tab === "expired" ? "alv-kpi--active" : ""}`}
          onClick={() => setTab("expired")}
        >
          <div className="alv-kpi-icon alv-kpi-icon--red">
            <svg viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/>
            </svg>
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
          {(["all", "low-stock", "expiring", "expired"] as AlertTab[]).map((t) => {
            const labels: Record<AlertTab, string> = {
              all: "All",
              "low-stock": "Low Stock",
              expiring: "Expiring Soon",
              expired: "Expired",
            };
            const tabCounts: Record<AlertTab, number> = {
              all: counts.all,
              "low-stock": counts.lowStock,
              expiring: counts.expiring,
              expired: counts.expired,
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
                  <span className={`alv-tab-badge ${t === "expired" ? "alv-tab-badge--red" : t === "expiring" ? "alv-tab-badge--orange" : t === "low-stock" ? "alv-tab-badge--amber" : "alv-tab-badge--default"}`}>
                    {tabCounts[t]}
                  </span>
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
            <p className="alv-all-clear-sub">No low stock, expiring, or expired items to report right now.</p>
          </div>
        </div>
      )}

      {/* ── Low stock table ── */}
      {showLowStock && (
        <LowStockTable
          items={filteredLowStock}
          multiplier={settings.lowStockMultiplier}
          showSectionHead={tab === "all"}
        />
      )}
      {tab === "low-stock" && counts.lowStock === 0 && (
        <EmptyTab icon="amber" message="No low stock alerts for this location." />
      )}
      {tab === "low-stock" && counts.lowStock > 0 && filteredLowStock.length === 0 && q && (
        <NoMatch />
      )}

      {/* ── Expiring soon table ── */}
      {showExpiring && (
        <ExpiryTable
          title="Expiring Soon"
          tone="orange"
          batches={filteredExpiring}
          showSectionHead={tab === "all"}
        />
      )}
      {tab === "expiring" && counts.expiring === 0 && (
        <EmptyTab icon="orange" message={`No batches expiring in the next ${settings.expiryAlertDays} days.`} />
      )}
      {tab === "expiring" && counts.expiring > 0 && filteredExpiring.length === 0 && q && (
        <NoMatch />
      )}

      {/* ── Expired table ── */}
      {showExpired && (
        <ExpiryTable
          title="Expired"
          tone="red"
          batches={filteredExpired}
          showSectionHead={tab === "all"}
        />
      )}
      {tab === "expired" && counts.expired === 0 && (
        <EmptyTab icon="red" message="No expired batches with remaining stock." />
      )}
      {tab === "expired" && counts.expired > 0 && filteredExpired.length === 0 && q && (
        <NoMatch />
      )}

    </div>
  );
}

/* ── Low Stock Table ────────────────────────────────────────────────────── */

function LowStockTable({
  items,
  multiplier,
  showSectionHead,
}: {
  items: LowStockAlert[];
  multiplier: number;
  showSectionHead: boolean;
}) {
  return (
    <section className="alv-section">
      {showSectionHead && (
        <div className="alv-sec-head alv-sec-head--amber">
          <div className="alv-sec-head-left">
            <div className="alv-sec-icon alv-sec-icon--amber">
              <svg viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
              </svg>
            </div>
            <span className="alv-sec-title">Low Stock</span>
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
              <th>Stock Level</th>
              <th className="alv-th-r">Current Stock</th>
              <th className="alv-th-r">Min Level</th>
              <th className="alv-th-r">Shortage</th>
              <th className="alv-th-r">Suggested Buy</th>
              <th className="alv-th-action"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const shortage = getSuggestedReorderQuantity(item.quantity, item.minStockLevel, multiplier);
              const factor = item.purchaseConversionFactor;
              const hasUnit = hasPurchaseUnit(item.purchaseUnit, factor);
              const buyPU = hasUnit && factor ? getSuggestedPurchaseQty(shortage, factor) : null;
              const pct = item.minStockLevel > 0 ? Math.min(100, (item.quantity / item.minStockLevel) * 100) : 0;
              const isOut = item.quantity === 0;

              return (
                <tr key={item.itemId} className={`alv-tr alv-tr--ls ${isOut ? "alv-tr--out" : ""}`}>
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
                        <div
                          className="alv-bar-fill"
                          style={{ width: `${pct}%`, background: isOut ? "#ef4444" : pct < 50 ? "#f97316" : "#f59e0b" }}
                        />
                      </div>
                      <span className="alv-bar-pct">{Math.round(pct)}%</span>
                    </div>
                  </td>
                  <td className="alv-td-r">
                    <span className={`alv-num ${isOut ? "alv-num--danger" : "alv-num--amber"}`}>{fmtN(item.quantity)}</span>
                    <span className="alv-unit"> {item.unit}</span>
                  </td>
                  <td className="alv-td-r">
                    <span className="alv-num">{fmtN(item.minStockLevel)}</span>
                    <span className="alv-unit"> {item.unit}</span>
                  </td>
                  <td className="alv-td-r">
                    <span className="alv-num alv-num--amber">{fmtN(shortage)}</span>
                    <span className="alv-unit"> {item.unit}</span>
                  </td>
                  <td className="alv-td-r">
                    {buyPU != null ? (
                      <><span className="alv-num">{buyPU}</span><span className="alv-unit"> {item.purchaseUnit}</span></>
                    ) : (
                      <span className="alv-dash">—</span>
                    )}
                  </td>
                  <td className="alv-td-action">
                    <Link to="/reorder-suggestions" className="alv-row-action">
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

/* ── Expiry Table ───────────────────────────────────────────────────────── */

function ExpiryTable({
  title,
  tone,
  batches,
  showSectionHead,
}: {
  title: string;
  tone: "orange" | "red";
  batches: ExpiryAlert[];
  showSectionHead: boolean;
}) {
  return (
    <section className="alv-section">
      {showSectionHead && (
        <div className={`alv-sec-head alv-sec-head--${tone}`}>
          <div className="alv-sec-head-left">
            <div className={`alv-sec-icon alv-sec-icon--${tone}`}>
              <svg viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"/>
              </svg>
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
              if (days < 0) {
                pillLabel = `${Math.abs(days)}d overdue`;
                pillClass = "alv-pill--danger";
              } else if (days === 0) {
                pillLabel = "Expires today";
                pillClass = "alv-pill--danger";
              } else if (days === 1) {
                pillLabel = "Tomorrow";
                pillClass = "alv-pill--danger";
              } else if (days <= 3) {
                pillLabel = `${days}d left`;
                pillClass = "alv-pill--warn";
              } else {
                pillLabel = `${days}d left`;
                pillClass = "alv-pill--caution";
              }

              return (
                <tr key={batch.id} className={`alv-tr alv-tr--${tone}`}>
                  <td className="alv-td-name">
                    <div className="alv-item-name">{batch.item.name}</div>
                  </td>
                  <td>
                    {batch.batchNo
                      ? <span className="alv-batch-tag">{batch.batchNo}</span>
                      : <span className="alv-dash">—</span>}
                  </td>
                  <td className="alv-td-r">
                    <span className="alv-num">{fmtN(batch.remainingQuantity)}</span>
                    <span className="alv-unit"> {batch.item.unit}</span>
                  </td>
                  <td className="alv-td-r">
                    <span className="alv-date">{fmtDate(batch.expiryDate)}</span>
                  </td>
                  <td className="alv-td-r">
                    <span className={`alv-pill ${pillClass}`}>{pillLabel}</span>
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

/* ── Utility components ─────────────────────────────────────────────────── */

function EmptyTab({ icon, message }: { icon: "amber" | "orange" | "red"; message: string }) {
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
