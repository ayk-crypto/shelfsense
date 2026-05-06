import { useCallback, useEffect, useRef, useState } from "react";
import {
  downloadReportCsv,
  getAdjustmentVariance,
  getExpiryLoss,
  getInventoryValuation,
  getStockAging,
  getSupplierSpend,
  getTransferHistory,
  getUsageReport,
  getWastageCost,
} from "../api/reports";
import { useNavigate } from "react-router-dom";
import { useLocation } from "../context/LocationContext";
import { useWorkspaceSettings } from "../context/WorkspaceSettingsContext";
import { usePlanFeatures, REQUIRED_PLAN } from "../context/PlanFeaturesContext";
import type {
  AdjustmentVarianceResponse,
  AdjustmentVarianceRow,
  ExpiryLossResponse,
  ExpiryLossRow,
  InventoryValuationResponse,
  InventoryValuationRow,
  ReportParams,
  StockAgingResponse,
  StockAgingRow,
  SupplierSpendResponse,
  SupplierSpendRow,
  TransferHistoryResponse,
  TransferRow,
  UsageResponse,
  UsageRow,
  WastageCostResponse,
  WastageCostRow,
} from "../types";

// ─── Report configuration ──────────────────────────────────────────────────

type ReportId =
  | "inventory-valuation"
  | "wastage-cost"
  | "usage"
  | "supplier-spend"
  | "stock-aging"
  | "expiry-loss"
  | "adjustment-variance"
  | "transfers";

interface ReportDef {
  id: ReportId;
  label: string;
  description: string;
  color: string;
  accentColor: string;
  showCategory: boolean;
  showSupplier: boolean;
  csvEndpoint: string;
  csvFilename: string;
  isAdvanced?: boolean;
}

const REPORTS: ReportDef[] = [
  {
    id: "inventory-valuation",
    label: "Inventory Valuation",
    description: "Current stock value across all active batches — quantity × unit cost, grouped by item.",
    color: "#6366f1",
    accentColor: "#eef2ff",
    showCategory: true,
    showSupplier: false,
    csvEndpoint: "inventory-valuation",
    csvFilename: "inventory-valuation.csv",
    isAdvanced: true,
  },
  {
    id: "wastage-cost",
    label: "Wastage Cost",
    description: "Items recorded as wasted or spoiled — quantities and imputed cost of loss.",
    color: "#dc2626",
    accentColor: "#fef2f2",
    showCategory: true,
    showSupplier: false,
    csvEndpoint: "wastage-cost",
    csvFilename: "wastage-cost.csv",
    isAdvanced: true,
  },
  {
    id: "usage",
    label: "Usage by Item",
    description: "Stock-out movements aggregated per item — how much of each item was consumed.",
    color: "#059669",
    accentColor: "#ecfdf5",
    showCategory: true,
    showSupplier: false,
    csvEndpoint: "usage",
    csvFilename: "usage-by-item.csv",
  },
  {
    id: "supplier-spend",
    label: "Supplier Spend",
    description: "Purchase orders grouped by supplier — total spend, order count, and average order value.",
    color: "#3b82f6",
    accentColor: "#eff6ff",
    showCategory: false,
    showSupplier: true,
    csvEndpoint: "supplier-spend",
    csvFilename: "supplier-spend.csv",
    isAdvanced: true,
  },
  {
    id: "stock-aging",
    label: "Stock Aging",
    description: "Open batches sorted by age — identifies stale or slow-moving inventory.",
    color: "#d97706",
    accentColor: "#fffbeb",
    showCategory: true,
    showSupplier: false,
    csvEndpoint: "stock-aging",
    csvFilename: "stock-aging.csv",
  },
  {
    id: "expiry-loss",
    label: "Expiry Loss",
    description: "Expired batches still holding remaining quantity — potential write-off value.",
    color: "#be123c",
    accentColor: "#fff1f2",
    showCategory: true,
    showSupplier: false,
    csvEndpoint: "expiry-loss",
    csvFilename: "expiry-loss.csv",
  },
  {
    id: "adjustment-variance",
    label: "Adjustment Variance",
    description: "Manual stock adjustments split into gains and losses — net variance per item.",
    color: "#7c3aed",
    accentColor: "#f5f3ff",
    showCategory: true,
    showSupplier: false,
    csvEndpoint: "adjustment-variance",
    csvFilename: "adjustment-variance.csv",
  },
  {
    id: "transfers",
    label: "Transfer History",
    description: "All inter-location transfers — inbound and outbound movements with notes.",
    color: "#0891b2",
    accentColor: "#ecfeff",
    showCategory: true,
    showSupplier: false,
    csvEndpoint: "transfers",
    csvFilename: "transfer-history.csv",
  },
];

// ─── State types ──────────────────────────────────────────────────────────

type AnyReportResponse =
  | InventoryValuationResponse
  | WastageCostResponse
  | UsageResponse
  | SupplierSpendResponse
  | StockAgingResponse
  | ExpiryLossResponse
  | AdjustmentVarianceResponse
  | TransferHistoryResponse;

interface ReportState {
  data: AnyReportResponse | null;
  loading: boolean;
  error: string | null;
}

const EMPTY_STATE: ReportState = { data: null, loading: false, error: null };

// ─── Utilities ─────────────────────────────────────────────────────────────

function fmt(n: number | undefined | null, currency?: string): string {
  const v = n ?? 0;
  if (currency) return `${currency} ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

// ─── Main component ────────────────────────────────────────────────────────

export function ReportsPage() {
  const planFeatures = usePlanFeatures();
  const navigate = useNavigate();
  const { locations } = useLocation();
  const { settings } = useWorkspaceSettings();
  const currency = settings.currency || "";

  const [activeId, setActiveId] = useState<ReportId>("inventory-valuation");
  const [params, setParams] = useState<ReportParams>({});
  const [state, setState] = useState<ReportState>(EMPTY_STATE);
  const [csvLoading, setCsvLoading] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const fetchRef = useRef(0);

  const activeDef = REPORTS.find((r) => r.id === activeId)!;

  const runReport = useCallback(
    async (id: ReportId, p: ReportParams) => {
      const ticket = ++fetchRef.current;
      setState({ data: null, loading: true, error: null });
      setCsvError(null);
      try {
        let result: AnyReportResponse;
        switch (id) {
          case "inventory-valuation": result = await getInventoryValuation(p); break;
          case "wastage-cost": result = await getWastageCost(p); break;
          case "usage": result = await getUsageReport(p); break;
          case "supplier-spend": result = await getSupplierSpend(p); break;
          case "stock-aging": result = await getStockAging(p); break;
          case "expiry-loss": result = await getExpiryLoss(p); break;
          case "adjustment-variance": result = await getAdjustmentVariance(p); break;
          case "transfers": result = await getTransferHistory(p); break;
        }
        if (ticket === fetchRef.current) {
          setState({ data: result, loading: false, error: null });
        }
      } catch (err) {
        if (ticket === fetchRef.current) {
          setState({ data: null, loading: false, error: err instanceof Error ? err.message : "Failed to load report" });
        }
      }
    },
    [],
  );

  // Auto-fetch when switching tabs (clear old data first)
  useEffect(() => {
    void runReport(activeId, params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  function handleSwitchReport(id: ReportId) {
    setActiveId(id);
    setParams({});
  }

  function handleApplyFilters() {
    void runReport(activeId, params);
  }

  function handleClearFilters() {
    setParams({});
    void runReport(activeId, {});
  }

  async function handleExportCsv() {
    setCsvLoading(true);
    setCsvError(null);
    try {
      await downloadReportCsv(activeDef.csvEndpoint, params, activeDef.csvFilename);
    } catch (err) {
      setCsvError(err instanceof Error ? err.message : "CSV download failed");
    } finally {
      setCsvLoading(false);
    }
  }

  const hasFilters = Object.values(params).some(Boolean);
  const hasData = state.data !== null && !state.loading;
  const rowCount = state.data ? (state.data.rows as unknown[]).length : 0;

  return (
    <div className="reports-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle">Business analytics and exportable data for inventory, costs, and procurement.</p>
        </div>
      </div>

      <div className="rpt-layout">
        {/* ── Sidebar nav ── */}
        <nav className="rpt-nav" aria-label="Report navigation">
          {REPORTS.map((r) => {
            const isLocked = r.isAdvanced && !planFeatures.enableAdvancedReports && !planFeatures.isLoading;
            return (
              <button
                key={r.id}
                type="button"
                className={`rpt-nav-btn${activeId === r.id ? " rpt-nav-btn--active" : ""}${isLocked ? " rpt-nav-btn--locked" : ""}`}
                style={activeId === r.id && !isLocked ? ({ "--rpt-accent": r.color } as React.CSSProperties) : undefined}
                onClick={() => isLocked ? navigate("/plan") : handleSwitchReport(r.id)}
                title={isLocked ? `Upgrade to ${REQUIRED_PLAN.enableAdvancedReports} to access this report` : undefined}
              >
                <span className="rpt-nav-dot" style={activeId === r.id && !isLocked ? { background: r.color } : undefined} />
                <span className="rpt-nav-label">{r.label}</span>
                {isLocked && (
                  <svg className="rpt-nav-lock" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="7" width="10" height="8" rx="1.5" />
                    <path d="M5 7V5a3 3 0 0 1 6 0v2" />
                  </svg>
                )}
              </button>
            );
          })}
        </nav>

        {/* ── Main panel ── */}
        <main className="rpt-main">
          {/* Report header */}
          <div className="rpt-report-head" style={{ borderLeftColor: activeDef.color }}>
            <div className="rpt-report-head-text">
              <h2 className="rpt-report-title">{activeDef.label}</h2>
              <p className="rpt-report-desc">{activeDef.description}</p>
            </div>
            <button
              type="button"
              className="btn btn--primary rpt-export-btn"
              onClick={() => void handleExportCsv()}
              disabled={!hasData || rowCount === 0 || csvLoading}
              title="Export report as CSV"
            >
              {csvLoading ? (
                <span className="spinner spinner--sm" />
              ) : (
                <svg className="btn-icon" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              )}
              Export CSV
            </button>
          </div>

          {activeDef.isAdvanced && !planFeatures.enableAdvancedReports && !planFeatures.isLoading && (
            <div className="plan-gate plan-gate--inline">
              <div className="plan-gate__card">
                <div className="plan-gate__icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>
                <h2 className="plan-gate__title">{REQUIRED_PLAN.enableAdvancedReports} plan required</h2>
                <p className="plan-gate__body">
                  This report isn't available on your current <strong>{planFeatures.planName}</strong> plan.
                  Upgrade to <strong>{REQUIRED_PLAN.enableAdvancedReports}</strong> or higher to access all advanced analytics.
                </p>
                <div className="plan-gate__actions">
                  <button className="btn btn--primary" onClick={() => navigate("/plan")}>View plans</button>
                </div>
              </div>
            </div>
          )}

          {csvError && (
            <div className="alert alert--error" style={{ marginBottom: 12 }}>{csvError}</div>
          )}

          {/* Filter bar */}
          <div className="rpt-filters">
            <div className="rpt-filter-row">
              <label className="rpt-filter-field">
                <span className="rpt-filter-label">From</span>
                <input
                  type="date"
                  className="form-input rpt-filter-input"
                  value={params.dateFrom ?? ""}
                  max={params.dateTo || undefined}
                  onChange={(e) => setParams((p) => ({ ...p, dateFrom: e.target.value || undefined }))}
                />
              </label>
              <label className="rpt-filter-field">
                <span className="rpt-filter-label">To</span>
                <input
                  type="date"
                  className="form-input rpt-filter-input"
                  value={params.dateTo ?? ""}
                  min={params.dateFrom || undefined}
                  onChange={(e) => setParams((p) => ({ ...p, dateTo: e.target.value || undefined }))}
                />
              </label>
              {locations.length > 1 && (
                <label className="rpt-filter-field">
                  <span className="rpt-filter-label">Location</span>
                  <select
                    className="form-input form-select rpt-filter-input"
                    value={params.locationId ?? ""}
                    onChange={(e) => setParams((p) => ({ ...p, locationId: e.target.value || undefined }))}
                  >
                    <option value="">All locations</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </label>
              )}
              {activeDef.showCategory && (
                <label className="rpt-filter-field">
                  <span className="rpt-filter-label">Category</span>
                  <input
                    type="text"
                    className="form-input rpt-filter-input"
                    placeholder="e.g. Dairy"
                    value={params.category ?? ""}
                    onChange={(e) => setParams((p) => ({ ...p, category: e.target.value || undefined }))}
                  />
                </label>
              )}
              {activeDef.showSupplier && (
                <label className="rpt-filter-field">
                  <span className="rpt-filter-label">Supplier ID</span>
                  <input
                    type="text"
                    className="form-input rpt-filter-input"
                    placeholder="Supplier UUID"
                    value={params.supplierId ?? ""}
                    onChange={(e) => setParams((p) => ({ ...p, supplierId: e.target.value || undefined }))}
                  />
                </label>
              )}
            </div>
            <div className="rpt-filter-actions">
              <button type="button" className="btn btn--primary" onClick={handleApplyFilters} disabled={state.loading}>
                {state.loading ? <><span className="spinner spinner--sm" /> Running…</> : "Run Report"}
              </button>
              {hasFilters && (
                <button type="button" className="btn btn--ghost" onClick={handleClearFilters} disabled={state.loading}>
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Loading */}
          {state.loading && (
            <div className="rpt-state-block">
              <span className="spinner" />
              <p className="rpt-state-msg">Generating report…</p>
            </div>
          )}

          {/* Error */}
          {!state.loading && state.error && (
            <div className="rpt-state-block">
              <div className="alert alert--error" style={{ maxWidth: 500 }}>{state.error}</div>
              <button type="button" className="btn btn--ghost" style={{ marginTop: 12 }} onClick={handleApplyFilters}>Retry</button>
            </div>
          )}

          {/* Empty prompt (not yet run / no rows) */}
          {!state.loading && !state.error && state.data && rowCount === 0 && (
            <div className="rpt-state-block">
              <div className="rpt-empty-icon" style={{ color: activeDef.color }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 17H7A5 5 0 0 1 7 7h2" /><path d="M15 7h2a5 5 0 0 1 0 10h-2" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
              </div>
              <p className="rpt-state-msg">No data for the selected filters.</p>
              {hasFilters && (
                <button type="button" className="btn btn--ghost" style={{ marginTop: 8 }} onClick={handleClearFilters}>Remove filters</button>
              )}
            </div>
          )}

          {/* Report results */}
          {!state.loading && !state.error && state.data && rowCount > 0 && (
            <div className="rpt-results">
              {/* Summary cards */}
              <ReportSummary data={state.data} reportId={activeId} currency={currency} />

              {/* Data table */}
              <div className="rpt-table-container">
                <div className="rpt-table-meta">
                  <span className="rpt-table-count">{rowCount.toLocaleString()} row{rowCount !== 1 ? "s" : ""}</span>
                  {state.data.generatedAt && (
                    <span className="rpt-table-ts">Generated {fmtDateTime(state.data.generatedAt)}</span>
                  )}
                </div>
                <div className="table-wrap">
                  <ReportTable data={state.data} reportId={activeId} currency={currency} />
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ─── Summary cards ─────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rpt-stat-card">
      <span className="rpt-stat-label">{label}</span>
      <strong className="rpt-stat-value">{value}</strong>
    </div>
  );
}

function ReportSummary({ data, reportId, currency }: { data: AnyReportResponse; reportId: ReportId; currency: string }) {
  const c = currency;

  if (reportId === "inventory-valuation") {
    const s = (data as InventoryValuationResponse).summary;
    return (
      <div className="rpt-summary">
        <StatCard label="Items" value={(s.totalItems ?? 0).toLocaleString()} />
        <StatCard label="Total Quantity" value={fmt(s.totalQuantity)} />
        <StatCard label="Total Value" value={fmt(s.totalValue, c)} />
      </div>
    );
  }
  if (reportId === "wastage-cost") {
    const s = (data as WastageCostResponse).summary;
    return (
      <div className="rpt-summary">
        <StatCard label="Items Wasted" value={(s.totalItems ?? 0).toLocaleString()} />
        <StatCard label="Total Qty Wasted" value={fmt(s.totalQuantity)} />
        <StatCard label="Total Cost of Wastage" value={fmt(s.totalValue, c)} />
      </div>
    );
  }
  if (reportId === "usage") {
    const s = (data as UsageResponse).summary;
    return (
      <div className="rpt-summary">
        <StatCard label="Items Used" value={(s.totalItems ?? 0).toLocaleString()} />
        <StatCard label="Total Qty Used" value={fmt(s.totalQuantity)} />
        <StatCard label="Stock-Out Events" value={(s.totalMovements ?? 0).toLocaleString()} />
      </div>
    );
  }
  if (reportId === "supplier-spend") {
    const s = (data as SupplierSpendResponse).summary;
    return (
      <div className="rpt-summary">
        <StatCard label="Suppliers" value={(s.totalSuppliers ?? 0).toLocaleString()} />
        <StatCard label="Total Orders" value={(s.totalOrders ?? 0).toLocaleString()} />
        <StatCard label="Total Spend" value={fmt(s.totalSpend, c)} />
      </div>
    );
  }
  if (reportId === "stock-aging") {
    const s = (data as StockAgingResponse).summary;
    return (
      <div className="rpt-summary">
        <StatCard label="Open Batches" value={(s.totalBatches ?? 0).toLocaleString()} />
        <StatCard label="Total Value" value={fmt(s.totalValue, c)} />
        <StatCard label="Avg Age" value={`${s.avgAgeDays ?? 0} days`} />
      </div>
    );
  }
  if (reportId === "expiry-loss") {
    const s = (data as ExpiryLossResponse).summary;
    return (
      <div className="rpt-summary">
        <StatCard label="Expired Batches" value={(s.totalBatches ?? 0).toLocaleString()} />
        <StatCard label="Total Expired Qty" value={fmt(s.totalExpiredQty)} />
        <StatCard label="Potential Loss" value={fmt(s.totalPotentialLoss, c)} />
      </div>
    );
  }
  if (reportId === "adjustment-variance") {
    const s = (data as AdjustmentVarianceResponse).summary;
    const net = s.netVariance ?? 0;
    return (
      <div className="rpt-summary">
        <StatCard label="Items Adjusted" value={(s.totalItems ?? 0).toLocaleString()} />
        <StatCard label="Total Gains" value={`+${fmt(s.totalPositive)}`} />
        <StatCard label="Total Losses" value={`-${fmt(s.totalNegative)}`} />
        <StatCard label="Net Variance" value={`${net >= 0 ? "+" : ""}${fmt(net)}`} />
      </div>
    );
  }
  if (reportId === "transfers") {
    const s = (data as TransferHistoryResponse).summary;
    return (
      <div className="rpt-summary">
        <StatCard label="Total Transfers" value={(s.totalTransfers ?? 0).toLocaleString()} />
        <StatCard label="Total In" value={fmt(s.totalInQty)} />
        <StatCard label="Total Out" value={fmt(s.totalOutQty)} />
      </div>
    );
  }
  return null;
}

// ─── Data tables ───────────────────────────────────────────────────────────

function ReportTable({ data, reportId, currency }: { data: AnyReportResponse; reportId: ReportId; currency: string }) {
  const c = currency;

  if (reportId === "inventory-valuation") {
    const rows = (data as InventoryValuationResponse).rows;
    return (
      <table className="table">
        <thead>
          <tr>
            <th>Item</th><th>Category</th><th>SKU</th><th>Unit</th>
            <th className="rpt-th-num">Qty</th>
            <th className="rpt-th-num">Avg Cost</th>
            <th className="rpt-th-num">Total Value</th>
            <th className="rpt-th-num">Batches</th>
          </tr>
        </thead>
        <tbody>
          {(rows as InventoryValuationRow[]).map((r) => (
            <tr key={r.itemId}>
              <td className="rpt-td-primary">{r.itemName}</td>
              <td><span className="rpt-badge">{r.category}</span></td>
              <td className="rpt-td-mono">{r.sku ?? <span className="rpt-td-dim">—</span>}</td>
              <td>{r.unit}</td>
              <td className="rpt-td-num">{fmt(r.totalQuantity)}</td>
              <td className="rpt-td-num">{fmt(r.avgUnitCost, c)}</td>
              <td className="rpt-td-num rpt-td-bold">{fmt(r.totalValue, c)}</td>
              <td className="rpt-td-num">{r.batchCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (reportId === "wastage-cost") {
    const rows = (data as WastageCostResponse).rows;
    return (
      <table className="table">
        <thead>
          <tr>
            <th>Item</th><th>Category</th><th>Unit</th>
            <th className="rpt-th-num">Qty Wasted</th>
            <th className="rpt-th-num">Cost</th>
            <th className="rpt-th-num">Events</th>
          </tr>
        </thead>
        <tbody>
          {(rows as WastageCostRow[]).map((r) => (
            <tr key={r.itemId}>
              <td className="rpt-td-primary">{r.itemName}</td>
              <td><span className="rpt-badge">{r.category}</span></td>
              <td>{r.unit}</td>
              <td className="rpt-td-num">{fmt(r.totalQuantity)}</td>
              <td className="rpt-td-num rpt-td-bold rpt-td-red">{fmt(r.totalValue, c)}</td>
              <td className="rpt-td-num">{r.movementCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (reportId === "usage") {
    const rows = (data as UsageResponse).rows;
    return (
      <table className="table">
        <thead>
          <tr>
            <th>Item</th><th>Category</th><th>Unit</th>
            <th className="rpt-th-num">Total Used</th>
            <th className="rpt-th-num">Events</th>
            <th>Last Used</th>
          </tr>
        </thead>
        <tbody>
          {(rows as UsageRow[]).map((r) => (
            <tr key={r.itemId}>
              <td className="rpt-td-primary">{r.itemName}</td>
              <td><span className="rpt-badge">{r.category}</span></td>
              <td>{r.unit}</td>
              <td className="rpt-td-num rpt-td-bold">{fmt(r.totalQuantity)}</td>
              <td className="rpt-td-num">{r.movementCount}</td>
              <td className="rpt-td-muted">{fmtDate(r.lastUsed)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (reportId === "supplier-spend") {
    const rows = (data as SupplierSpendResponse).rows;
    return (
      <table className="table">
        <thead>
          <tr>
            <th>Supplier</th>
            <th className="rpt-th-num">Orders</th>
            <th className="rpt-th-num">Total Spend</th>
            <th className="rpt-th-num">Avg Order</th>
            <th>Last Order</th>
          </tr>
        </thead>
        <tbody>
          {(rows as SupplierSpendRow[]).map((r) => (
            <tr key={r.supplierId}>
              <td className="rpt-td-primary">{r.supplierName}</td>
              <td className="rpt-td-num">{r.orderCount}</td>
              <td className="rpt-td-num rpt-td-bold">{fmt(r.totalSpend, c)}</td>
              <td className="rpt-td-num">{fmt(r.avgOrderValue, c)}</td>
              <td className="rpt-td-muted">{r.lastOrderDate ? fmtDate(r.lastOrderDate) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (reportId === "stock-aging") {
    const rows = (data as StockAgingResponse).rows;
    return (
      <table className="table">
        <thead>
          <tr>
            <th>Item</th><th>Category</th><th>Location</th><th>Batch No</th><th>Unit</th>
            <th className="rpt-th-num">Orig Qty</th>
            <th className="rpt-th-num">Remaining</th>
            <th className="rpt-th-num">Value</th>
            <th className="rpt-th-num">Age (days)</th>
            <th>Received</th>
          </tr>
        </thead>
        <tbody>
          {(rows as StockAgingRow[]).map((r) => (
            <tr key={r.batchId}>
              <td className="rpt-td-primary">{r.itemName}</td>
              <td><span className="rpt-badge">{r.category}</span></td>
              <td className="rpt-td-muted">{r.location}</td>
              <td className="rpt-td-mono">{r.batchNo ?? <span className="rpt-td-dim">—</span>}</td>
              <td>{r.unit}</td>
              <td className="rpt-td-num">{fmt(r.originalQty)}</td>
              <td className="rpt-td-num">{fmt(r.remainingQty)}</td>
              <td className="rpt-td-num">{fmt(r.totalValue, c)}</td>
              <td className="rpt-td-num">
                <span className={`rpt-age-badge ${r.ageDays > 90 ? "rpt-age-badge--old" : r.ageDays > 30 ? "rpt-age-badge--mid" : "rpt-age-badge--fresh"}`}>
                  {r.ageDays}d
                </span>
              </td>
              <td className="rpt-td-muted">{fmtDate(r.receivedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (reportId === "expiry-loss") {
    const rows = (data as ExpiryLossResponse).rows;
    return (
      <table className="table">
        <thead>
          <tr>
            <th>Item</th><th>Category</th><th>Location</th><th>Batch No</th><th>Unit</th>
            <th className="rpt-th-num">Remaining Qty</th>
            <th className="rpt-th-num">Unit Cost</th>
            <th className="rpt-th-num">Potential Loss</th>
            <th>Expiry Date</th>
            <th className="rpt-th-num">Days Expired</th>
          </tr>
        </thead>
        <tbody>
          {(rows as ExpiryLossRow[]).map((r) => (
            <tr key={r.batchId}>
              <td className="rpt-td-primary">{r.itemName}</td>
              <td><span className="rpt-badge">{r.category}</span></td>
              <td className="rpt-td-muted">{r.location}</td>
              <td className="rpt-td-mono">{r.batchNo ?? <span className="rpt-td-dim">—</span>}</td>
              <td>{r.unit}</td>
              <td className="rpt-td-num">{fmt(r.remainingQty)}</td>
              <td className="rpt-td-num">{fmt(r.unitCost, c)}</td>
              <td className="rpt-td-num rpt-td-bold rpt-td-red">{fmt(r.potentialLoss, c)}</td>
              <td className="rpt-td-muted">{fmtDate(r.expiryDate)}</td>
              <td className="rpt-td-num">
                <span className="rpt-age-badge rpt-age-badge--old">{r.daysExpired}d</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (reportId === "adjustment-variance") {
    const rows = (data as AdjustmentVarianceResponse).rows;
    return (
      <table className="table">
        <thead>
          <tr>
            <th>Item</th><th>Category</th><th>Unit</th>
            <th className="rpt-th-num">Gains (+)</th>
            <th className="rpt-th-num">Losses (−)</th>
            <th className="rpt-th-num">Net Variance</th>
            <th className="rpt-th-num">Events</th>
          </tr>
        </thead>
        <tbody>
          {(rows as AdjustmentVarianceRow[]).map((r) => (
            <tr key={r.itemId}>
              <td className="rpt-td-primary">{r.itemName}</td>
              <td><span className="rpt-badge">{r.category}</span></td>
              <td>{r.unit}</td>
              <td className="rpt-td-num rpt-td-green">+{fmt(r.positiveAdj)}</td>
              <td className="rpt-td-num rpt-td-red">-{fmt(r.negativeAdj)}</td>
              <td className={`rpt-td-num rpt-td-bold ${r.netVariance >= 0 ? "rpt-td-green" : "rpt-td-red"}`}>
                {r.netVariance >= 0 ? "+" : ""}{fmt(r.netVariance)}
              </td>
              <td className="rpt-td-num">{r.movementCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (reportId === "transfers") {
    const rows = (data as TransferHistoryResponse).rows;
    return (
      <table className="table">
        <thead>
          <tr>
            <th>Date</th><th>Item</th><th>Category</th><th>Unit</th>
            <th>Type</th>
            <th className="rpt-th-num">Quantity</th>
            <th>Location</th><th>Note</th>
          </tr>
        </thead>
        <tbody>
          {(rows as TransferRow[]).map((r) => (
            <tr key={r.id}>
              <td className="rpt-td-muted rpt-td-nowrap">{fmtDate(r.createdAt)}</td>
              <td className="rpt-td-primary">{r.itemName}</td>
              <td><span className="rpt-badge">{r.category}</span></td>
              <td>{r.unit}</td>
              <td>
                <span className={`rpt-transfer-badge rpt-transfer-badge--${r.type === "TRANSFER_IN" ? "in" : "out"}`}>
                  {r.type === "TRANSFER_IN" ? "↓ In" : "↑ Out"}
                </span>
              </td>
              <td className="rpt-td-num rpt-td-bold">{fmt(r.quantity)}</td>
              <td className="rpt-td-muted">{r.location}</td>
              <td className="rpt-td-muted">{r.note ?? <span className="rpt-td-dim">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return null;
}
