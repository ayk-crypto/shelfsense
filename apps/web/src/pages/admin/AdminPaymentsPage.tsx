import { useEffect, useState, useCallback, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getAdminPayments, getAdminPaymentsSummary, markAdminPaymentPaid } from "../../api/admin";
import type { AdminPayment, AdminPagination, AdminPaymentsSummary } from "../../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function fmtAmount(amount: number, currency: string) {
  const symbol = currency === "USD" ? "$" : currency;
  return `${symbol} ${amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function fmtMethod(method: string) {
  return method.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function avatarColor(str: string) {
  const colors = ["#6366f1","#8b5cf6","#ec4899","#f59e0b","#10b981","#3b82f6","#f97316","#14b8a6"];
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return colors[Math.abs(h) % colors.length];
}

function wsInitials(name: string) {
  return name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; cls: string }> = {
  PAID:      { label: "Paid",      cls: "pmt-status--paid" },
  PENDING:   { label: "Pending",   cls: "pmt-status--pending" },
  FAILED:    { label: "Failed",    cls: "pmt-status--failed" },
  REFUNDED:  { label: "Refunded",  cls: "pmt-status--refunded" },
  CANCELLED: { label: "Cancelled", cls: "pmt-status--cancelled" },
};

const METHOD_ICONS: Record<string, string> = {
  "BANK_TRANSFER": "🏦",
  "CREDIT_CARD":   "💳",
  "CASH":          "💵",
  "CHEQUE":        "📄",
  "OTHER":         "🔗",
};

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, icon, accent, onClick, active, loading,
}: {
  label: string; value: string | number; icon: React.ReactNode;
  accent: string; onClick?: () => void; active?: boolean; loading: boolean;
}) {
  return (
    <button
      className={`pmt-stat-card${active ? " pmt-stat-card--active" : ""}${onClick ? "" : " pmt-stat-card--no-click"}`}
      style={{ "--accent": accent } as React.CSSProperties}
      onClick={onClick}
      type="button"
    >
      <div className="pmt-stat-icon">{icon}</div>
      <div className="pmt-stat-body">
        {loading
          ? <div className="pmt-stat-skeleton" />
          : <div className="pmt-stat-value">{value}</div>
        }
        <div className="pmt-stat-label">{label}</div>
      </div>
    </button>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ type, text, onClose }: { type: "success" | "error"; text: string; onClose: () => void }) {
  return (
    <div className={`pmt-toast pmt-toast--${type}`}>
      <span className="pmt-toast-icon">{type === "success" ? "✓" : "✕"}</span>
      <span>{text}</span>
      <button className="pmt-toast-close" onClick={onClose}>✕</button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function AdminPaymentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [pagination, setPagination] = useState<AdminPagination | null>(null);
  const [summary, setSummary] = useState<AdminPaymentsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const status = searchParams.get("status") ?? "";

  const loadSummary = useCallback(() => {
    setSummaryLoading(true);
    getAdminPaymentsSummary()
      .then(setSummary)
      .catch(() => {})
      .finally(() => setSummaryLoading(false));
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    getAdminPayments({ page, status: status || undefined, search: search || undefined })
      .then((r) => { setPayments(r.payments); setPagination(r.pagination); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [page, status, search]);

  useEffect(() => { load(); loadSummary(); }, [load, loadSummary]);

  function setParam(k: string, v: string) {
    const next = new URLSearchParams(searchParams);
    if (v) next.set(k, v); else next.delete(k);
    if (k !== "page") next.delete("page");
    setSearchParams(next);
  }

  function handleSearchChange(val: string) {
    setSearch(val);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      next.delete("page");
      setSearchParams(next);
    }, 300);
  }

  function showToast(type: "success" | "error", text: string) {
    setToast({ type, text });
    setTimeout(() => setToast(null), 4000);
  }

  async function handleMarkPaid(p: AdminPayment) {
    if (!window.confirm(`Mark ${fmtAmount(p.amount, p.currency)} as PAID for ${p.workspace.name}? This will also activate the subscription if pending.`)) return;
    setActionLoading(p.id);
    try {
      await markAdminPaymentPaid(p.id);
      showToast("success", "Payment marked as paid. Subscription activated.");
      load(); loadSummary();
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Failed");
    } finally {
      setActionLoading(null);
    }
  }

  function copyRef(ref: string, id: string) {
    navigator.clipboard.writeText(ref).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    });
  }

  const hasFilters = search || status;
  function clearFilters() { setSearch(""); setParam("status", ""); }

  const statCards = [
    {
      label: "Total Collected",
      value: summary ? `$ ${(summary.totalCollected).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : "—",
      accent: "#10b981",
      onClick: undefined,
      active: false,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
        </svg>
      ),
    },
    {
      label: "Paid",
      value: summary?.totalPaid ?? 0,
      accent: "#10b981",
      onClick: () => setParam("status", status === "PAID" ? "" : "PAID"),
      active: status === "PAID",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
      ),
    },
    {
      label: "Pending",
      value: summary?.totalPending ?? 0,
      accent: "#f59e0b",
      onClick: () => setParam("status", status === "PENDING" ? "" : "PENDING"),
      active: status === "PENDING",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
      ),
    },
    {
      label: "Failed / Refunded",
      value: summary ? (summary.totalFailed + summary.totalRefunded) : 0,
      accent: "#ef4444",
      onClick: () => setParam("status", status === "FAILED" ? "" : "FAILED"),
      active: status === "FAILED",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
      ),
    },
  ];

  return (
    <div className="admin-page">
      {/* Toast */}
      {toast && <Toast type={toast.type} text={toast.text} onClose={() => setToast(null)} />}

      {/* Header */}
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Payments</h1>
          <p className="admin-page-subtitle">
            All recorded payment transactions
            {pagination && <span className="inbox-total-badge">{pagination.total.toLocaleString()} record{pagination.total !== 1 ? "s" : ""}</span>}
          </p>
        </div>
        <button
          className="inbox-refresh-btn"
          onClick={() => { load(); loadSummary(); }}
          type="button"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
          </svg>
          Refresh
        </button>
      </div>

      {/* Stat cards */}
      <div className="pmt-stats">
        {statCards.map((s) => (
          <StatCard key={s.label} loading={summaryLoading} {...s} />
        ))}
      </div>

      {/* Status tabs */}
      <div className="inbox-status-tabs" style={{ marginBottom: 16 }}>
        {[
          { v: "",          label: "All payments" },
          { v: "PAID",      label: "Paid" },
          { v: "PENDING",   label: "Pending" },
          { v: "FAILED",    label: "Failed" },
          { v: "REFUNDED",  label: "Refunded" },
          { v: "CANCELLED", label: "Cancelled" },
        ].map((tab) => (
          <button
            key={tab.v}
            type="button"
            className={`inbox-status-tab${status === tab.v ? " inbox-status-tab--active" : ""}`}
            onClick={() => setParam("status", tab.v)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filter row */}
      <div className="inbox-filter-row" style={{ marginBottom: 20 }}>
        <div className="inbox-search-wrap">
          <svg className="inbox-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            className="inbox-search-input"
            placeholder="Search by workspace name…"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
          {search && (
            <button className="inbox-search-clear" onClick={() => handleSearchChange("")} type="button">✕</button>
          )}
        </div>
        {hasFilters && (
          <button className="admin-clear-filters" onClick={clearFilters} type="button">Clear filters</button>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="inbox-skeleton-list">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="inbox-skeleton-row">
              <div className="inbox-skeleton-cell" style={{ width: 140 }}/>
              <div className="inbox-skeleton-cell" style={{ width: 90 }}/>
              <div className="inbox-skeleton-cell" style={{ width: 80 }}/>
              <div className="inbox-skeleton-cell" style={{ width: 100 }}/>
              <div className="inbox-skeleton-cell" style={{ width: 70 }}/>
              <div className="inbox-skeleton-cell" style={{ width: 90 }}/>
              <div className="inbox-skeleton-cell" style={{ width: 90 }}/>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="alert alert--error">{error}</div>
      ) : payments.length === 0 ? (
        <div className="inbox-empty">
          <div className="inbox-empty-icon">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
            </svg>
          </div>
          <p className="inbox-empty-title">No payments found</p>
          <p className="inbox-empty-sub">{hasFilters ? "Try adjusting your filters." : "No payment records yet."}</p>
          {hasFilters && <button className="btn btn--secondary btn--sm" onClick={clearFilters}>Clear filters</button>}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="pmt-table-wrap">
            <table className="admin-table pmt-table">
              <thead>
                <tr>
                  <th>Workspace</th>
                  <th>Amount</th>
                  <th>Plan</th>
                  <th>Method</th>
                  <th>Reference</th>
                  <th>Status</th>
                  <th>Paid At</th>
                  <th>Recorded</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  const meta = STATUS_META[p.status] ?? { label: p.status, cls: "pmt-status--cancelled" };
                  const bg = avatarColor(p.workspace.name);
                  const methodIcon = METHOD_ICONS[p.paymentMethod] ?? "🔗";

                  return (
                    <tr key={p.id} className="pmt-row">
                      {/* Workspace */}
                      <td>
                        <div className="pmt-ws-cell">
                          <div className="pmt-ws-avatar" style={{ background: bg }}>
                            {wsInitials(p.workspace.name)}
                          </div>
                          <Link to={`/admin/workspaces/${p.workspaceId}`} className="pmt-ws-name">
                            {p.workspace.name}
                          </Link>
                        </div>
                      </td>

                      {/* Amount */}
                      <td>
                        <span className={`pmt-amount${p.status === "PAID" ? " pmt-amount--paid" : p.status === "PENDING" ? " pmt-amount--pending" : " pmt-amount--other"}`}>
                          {fmtAmount(p.amount, p.currency)}
                        </span>
                      </td>

                      {/* Plan */}
                      <td>
                        {p.subscription?.plan ? (
                          <span className="pmt-plan-badge">{p.subscription.plan.name}</span>
                        ) : (
                          <span className="inbox-dash">—</span>
                        )}
                      </td>

                      {/* Method */}
                      <td>
                        <span className="pmt-method">
                          <span className="pmt-method-icon">{methodIcon}</span>
                          {fmtMethod(p.paymentMethod)}
                        </span>
                      </td>

                      {/* Reference */}
                      <td>
                        {p.referenceNumber ? (
                          <div className="pmt-ref-cell">
                            <span className="pmt-ref">{p.referenceNumber}</span>
                            <button
                              className={`pmt-copy-btn${copiedId === p.id ? " pmt-copy-btn--copied" : ""}`}
                              onClick={() => copyRef(p.referenceNumber!, p.id)}
                              title="Copy reference"
                              type="button"
                            >
                              {copiedId === p.id ? (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                              ) : (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                              )}
                            </button>
                          </div>
                        ) : (
                          <span className="inbox-dash">—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td>
                        <span className={`pmt-status ${meta.cls}`}>{meta.label}</span>
                      </td>

                      {/* Paid At */}
                      <td className="pmt-date">
                        {p.paidAt ? (
                          <span>{fmtDate(p.paidAt)}</span>
                        ) : (
                          <span className="inbox-dash">—</span>
                        )}
                      </td>

                      {/* Recorded */}
                      <td>
                        <div className="pmt-recorded">
                          <div className="pmt-recorded-date">{fmtDate(p.createdAt)}</div>
                          {p.recordedBy && (
                            <div className="pmt-recorded-by">by {p.recordedBy.name}</div>
                          )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td>
                        {p.status === "PENDING" && (
                          <button
                            className="pmt-mark-paid-btn"
                            disabled={actionLoading === p.id}
                            onClick={() => handleMarkPaid(p)}
                            type="button"
                          >
                            {actionLoading === p.id ? (
                              <span className="pmt-btn-spinner" />
                            ) : (
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                            )}
                            Mark Paid
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="pmt-mobile-cards">
            {payments.map((p) => {
              const meta = STATUS_META[p.status] ?? { label: p.status, cls: "pmt-status--cancelled" };
              const bg = avatarColor(p.workspace.name);
              return (
                <div key={p.id} className="pmt-mobile-card">
                  <div className="pmt-mobile-card-top">
                    <div className="pmt-ws-cell">
                      <div className="pmt-ws-avatar pmt-ws-avatar--sm" style={{ background: bg }}>
                        {wsInitials(p.workspace.name)}
                      </div>
                      <Link to={`/admin/workspaces/${p.workspaceId}`} className="pmt-ws-name">{p.workspace.name}</Link>
                    </div>
                    <span className={`pmt-status ${meta.cls}`}>{meta.label}</span>
                  </div>
                  <div className="pmt-mobile-card-amount">
                    <span className={`pmt-amount${p.status === "PAID" ? " pmt-amount--paid" : p.status === "PENDING" ? " pmt-amount--pending" : " pmt-amount--other"}`}>
                      {fmtAmount(p.amount, p.currency)}
                    </span>
                    {p.subscription?.plan && <span className="pmt-plan-badge">{p.subscription.plan.name}</span>}
                  </div>
                  <div className="pmt-mobile-card-meta">
                    <span className="pmt-method"><span className="pmt-method-icon">{METHOD_ICONS[p.paymentMethod] ?? "🔗"}</span>{fmtMethod(p.paymentMethod)}</span>
                    <span className="pmt-date">{p.paidAt ? fmtDate(p.paidAt) : fmtDate(p.createdAt)}</span>
                  </div>
                  {p.status === "PENDING" && (
                    <button
                      className="pmt-mark-paid-btn"
                      style={{ marginTop: 10, width: "100%" }}
                      disabled={actionLoading === p.id}
                      onClick={() => handleMarkPaid(p)}
                      type="button"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      Mark Paid
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {pagination && pagination.pages > 1 && (
            <div className="admin-pagination">
              <button className="btn btn--ghost btn--sm" disabled={page <= 1} onClick={() => setParam("page", String(page - 1))}>← Prev</button>
              <span className="admin-pagination-info">Page {page} of {pagination.pages} · {pagination.total.toLocaleString()} total</span>
              <button className="btn btn--ghost btn--sm" disabled={page >= pagination.pages} onClick={() => setParam("page", String(page + 1))}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
