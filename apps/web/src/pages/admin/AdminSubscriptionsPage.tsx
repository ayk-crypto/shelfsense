import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { activateAdminSubscription, getAdminSubscriptions } from "../../api/admin";
import type { AdminSubscription, AdminPagination } from "../../types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function fmtAmount(currency: string, amount: number) {
  if (amount === 0) return <span className="subs-amount-free">Free</span>;
  return <span className="subs-amount">{currency} {amount.toLocaleString()}</span>;
}

function daysUntil(iso: string) {
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  return diff;
}

const STATUS_META: Record<string, { color: string; label: string }> = {
  TRIAL:         { color: "yellow",  label: "Trial" },
  ACTIVE:        { color: "active",  label: "Active" },
  PAST_DUE:      { color: "warning", label: "Past Due" },
  EXPIRED:       { color: "red",     label: "Expired" },
  SUSPENDED:     { color: "suspended", label: "Suspended" },
  CANCELLED:     { color: "gray",    label: "Cancelled" },
  MANUAL_REVIEW: { color: "purple",  label: "Pending" },
};

const BILLING_COLORS: Record<string, string> = {
  MONTHLY: "subs-billing-monthly",
  ANNUAL:  "subs-billing-annual",
  MANUAL:  "subs-billing-manual",
};

// ─── Activate Modal ───────────────────────────────────────────────────────────

interface ActivateModalProps {
  sub: AdminSubscription;
  onClose: () => void;
  onActivated: (updated: AdminSubscription) => void;
}

function ActivateModal({ sub, onClose, onActivated }: ActivateModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [billingCycle, setBillingCycle] = useState(sub.billingCycle ?? "MONTHLY");
  const [expiryDate, setExpiryDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function computeDefault(cycle: string) {
    const d = new Date();
    if (cycle === "ANNUAL") d.setFullYear(d.getFullYear() + 1);
    else d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  }

  function applyPreset(days: number) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    setExpiryDate(d.toISOString().slice(0, 10));
  }

  function handleCycleChange(cycle: string) {
    setBillingCycle(cycle);
    setExpiryDate(computeDefault(cycle));
  }

  const effectiveExpiry = expiryDate || computeDefault(billingCycle);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleActivate() {
    setLoading(true);
    setError(null);
    try {
      const result = await activateAdminSubscription(sub.id, {
        billingCycle,
        expiryDate: effectiveExpiry,
      });
      onActivated(result.subscription);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to activate subscription");
    } finally {
      setLoading(false);
    }
  }

  const wsInitials = sub.workspace.name.slice(0, 2).toUpperCase();
  const planCode = sub.plan.code?.toUpperCase() ?? "";

  return (
    <div
      className="wsd-modal-backdrop"
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="wsd-modal wsd-modal--sm" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="wsd-modal-header">
          <div>
            <h2 className="wsd-modal-title">Activate Subscription</h2>
            <p className="wsd-modal-sub">Manually approve this pending subscription</p>
          </div>
          <button className="wsd-modal-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="wsd-modal-body">

          {/* Workspace + Plan info card */}
          <div className="subs-activate-info-card">
            <div className="subs-activate-ws">
              <div className="subs-activate-avatar">{wsInitials}</div>
              <div className="subs-activate-ws-text">
                <div className="subs-activate-ws-name">{sub.workspace.name}</div>
                <div className="subs-activate-ws-email">{sub.workspace.owner.email}</div>
              </div>
            </div>
            <div className={`subs-activate-plan-badge subs-plan-${planCode.toLowerCase()}`}>
              {sub.plan.name}
              {sub.amount > 0 && (
                <span className="subs-activate-plan-price"> · {sub.currency} {sub.amount.toLocaleString()}</span>
              )}
            </div>
          </div>

          {/* Billing cycle toggle */}
          <div className="subs-activate-field">
            <label className="subs-activate-label">Billing Cycle</label>
            <div className="subs-cycle-toggle">
              {[
                { value: "MONTHLY", label: "Monthly" },
                { value: "ANNUAL",  label: "Annual" },
                { value: "MANUAL",  label: "Manual" },
              ].map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={`subs-cycle-btn${billingCycle === value ? " subs-cycle-btn--active" : ""}`}
                  onClick={() => handleCycleChange(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Expiry date + presets */}
          <div className="subs-activate-field">
            <label className="subs-activate-label">Subscription Period Ends</label>
            <div className="subs-date-presets">
              {(billingCycle === "ANNUAL"
                ? [{ label: "1 year", days: 365 }, { label: "2 years", days: 730 }]
                : [{ label: "30 days", days: 30 }, { label: "60 days", days: 60 }, { label: "90 days", days: 90 }]
              ).map(({ label, days }) => (
                <button
                  key={label}
                  type="button"
                  className="subs-date-preset"
                  onClick={() => applyPreset(days)}
                >
                  {label}
                </button>
              ))}
            </div>
            <input
              type="date"
              className="subs-date-input"
              value={effectiveExpiry}
              onChange={(e) => setExpiryDate(e.target.value)}
            />
          </div>

          {/* Activation summary */}
          <div className="subs-activate-summary">
            <div className="subs-activate-summary-row">
              <span className="subs-activate-summary-label">Workspace</span>
              <span className="subs-activate-summary-value">{sub.workspace.name}</span>
            </div>
            <div className="subs-activate-summary-row">
              <span className="subs-activate-summary-label">Plan</span>
              <span className="subs-activate-summary-value">{sub.plan.name} ({planCode})</span>
            </div>
            <div className="subs-activate-summary-row">
              <span className="subs-activate-summary-label">Billing</span>
              <span className="subs-activate-summary-value">{billingCycle.charAt(0) + billingCycle.slice(1).toLowerCase()}</span>
            </div>
            <div className="subs-activate-summary-row">
              <span className="subs-activate-summary-label">Expires</span>
              <span className="subs-activate-summary-value subs-activate-summary-date">{fmtDate(effectiveExpiry)}</span>
            </div>
          </div>

          {error && (
            <div className="alert alert--error" style={{ marginTop: 12 }}>{error}</div>
          )}
        </div>

        {/* Footer */}
        <div className="wsd-modal-footer">
          <button className="btn btn--ghost" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            className="btn btn--primary subs-activate-cta"
            onClick={() => void handleActivate()}
            disabled={loading}
          >
            {loading ? (
              <><span className="spinner spinner--sm spinner--white" /> Activating…</>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Activate Subscription
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function AdminSubscriptionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [subscriptions, setSubscriptions] = useState<AdminSubscription[]>([]);
  const [pagination, setPagination] = useState<AdminPagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activateTarget, setActivateTarget] = useState<AdminSubscription | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const page   = parseInt(searchParams.get("page") ?? "1", 10);
  const status = searchParams.get("status") ?? "";
  const search = searchParams.get("search") ?? "";

  function load() {
    setLoading(true);
    getAdminSubscriptions({ page, status: status || undefined, search: search || undefined })
      .then((r) => { setSubscriptions(r.subscriptions); setPagination(r.pagination); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [page, status, search]);

  function setParam(k: string, v: string) {
    const next = new URLSearchParams(searchParams);
    if (v) next.set(k, v); else next.delete(k);
    if (k !== "page") next.delete("page");
    setSearchParams(next);
  }

  function handleActivated(updated: AdminSubscription) {
    setSubscriptions((prev) => prev.map((s) => s.id === updated.id ? updated : s));
    setActivateTarget(null);
  }

  const pendingCount = subscriptions.filter((s) => s.status === "MANUAL_REVIEW").length;

  return (
    <div className="admin-page">
      {activateTarget && (
        <ActivateModal
          sub={activateTarget}
          onClose={() => setActivateTarget(null)}
          onActivated={handleActivated}
        />
      )}

      {/* Page header */}
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Subscriptions</h1>
          <p className="admin-page-subtitle">
            {pagination?.total.toLocaleString() ?? "—"} total subscriptions
            {pendingCount > 0 && !loading && (
              <span className="subs-pending-badge">{pendingCount} pending activation</span>
            )}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="admin-filters admin-filters--wrap">
        <form
          className="admin-search-form"
          onSubmit={(e) => { e.preventDefault(); setParam("search", searchRef.current?.value ?? ""); }}
        >
          <input
            ref={searchRef}
            type="search"
            className="admin-search-input"
            placeholder="Search workspace or owner…"
            defaultValue={search}
          />
          <button type="submit" className="btn btn--primary btn--sm">Search</button>
        </form>

        <select
          className="admin-filter-select"
          value={status}
          onChange={(e) => setParam("status", e.target.value)}
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_META).map(([val, { label }]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>

        {(search || status) && (
          <button className="admin-clear-filters" onClick={() => setSearchParams({})}>
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <div className="admin-loading"><div className="spinner" /></div>
      ) : error ? (
        <div className="alert alert--error">{error}</div>
      ) : subscriptions.length === 0 ? (
        <div className="admin-empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
            <line x1="1" y1="10" x2="23" y2="10" />
          </svg>
          <p>No subscriptions found.</p>
        </div>
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Workspace</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Billing</th>
                  <th>Amount</th>
                  <th>Period End</th>
                  <th>Coupon</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((s) => {
                  const meta = STATUS_META[s.status] ?? { color: "gray", label: s.status };
                  const periodEnd = s.currentPeriodEnd ?? s.trialEndsAt;
                  const days = periodEnd ? daysUntil(periodEnd) : null;
                  const planCode = (s.plan.code ?? "free").toLowerCase();

                  return (
                    <tr key={s.id} className={s.status === "MANUAL_REVIEW" ? "subs-row--pending" : ""}>
                      <td>
                        <div className="subs-ws-cell">
                          <div className="subs-ws-avatar">{s.workspace.name.slice(0, 2).toUpperCase()}</div>
                          <div>
                            <Link to={`/admin/workspaces/${s.workspaceId}`} className="admin-link subs-ws-name">
                              {s.workspace.name}
                            </Link>
                            <div className="admin-muted">{s.workspace.owner.email}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`subs-plan-badge subs-plan-${planCode}`}>
                          {s.plan.name}
                        </span>
                      </td>
                      <td>
                        <span className={`admin-status-badge admin-status-badge--${meta.color}`}>
                          {meta.label}
                        </span>
                      </td>
                      <td>
                        <span className={`subs-billing-pill ${BILLING_COLORS[s.billingCycle] ?? ""}`}>
                          {s.billingCycle === "MONTHLY" ? "Monthly" : s.billingCycle === "ANNUAL" ? "Annual" : "Manual"}
                        </span>
                      </td>
                      <td>{fmtAmount(s.currency, s.amount)}</td>
                      <td>
                        {periodEnd ? (
                          <div>
                            <div className="subs-period-date">{fmtDate(periodEnd)}</div>
                            {days !== null && days > 0 && days < 90 && (
                              <div className={`subs-days-left${days < 14 ? " subs-days-left--warn" : ""}`}>
                                {days}d left
                              </div>
                            )}
                            {days !== null && days <= 0 && (
                              <div className="subs-days-left subs-days-left--expired">Expired</div>
                            )}
                            {s.trialEndsAt && !s.currentPeriodEnd && (
                              <div className="admin-muted" style={{ fontSize: 11, marginTop: 1 }}>Trial</div>
                            )}
                          </div>
                        ) : (
                          <span className="admin-muted">—</span>
                        )}
                      </td>
                      <td>
                        {s.coupon ? (
                          <div className="subs-coupon-chip">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
                              <line x1="7" y1="7" x2="7.01" y2="7" />
                            </svg>
                            {s.coupon.code}
                          </div>
                        ) : (
                          <span className="admin-muted">—</span>
                        )}
                      </td>
                      <td>
                        {s.status === "MANUAL_REVIEW" && (
                          <button
                            className="subs-activate-btn"
                            onClick={() => setActivateTarget(s)}
                            type="button"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            Activate
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {pagination && pagination.pages > 1 && (
            <div className="admin-pagination">
              <button className="btn btn--ghost btn--sm" disabled={page <= 1} onClick={() => setParam("page", String(page - 1))}>
                ← Prev
              </button>
              <span className="admin-pagination-info">Page {page} of {pagination.pages} · {pagination.total.toLocaleString()} total</span>
              <button className="btn btn--ghost btn--sm" disabled={page >= pagination.pages} onClick={() => setParam("page", String(page + 1))}>
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
