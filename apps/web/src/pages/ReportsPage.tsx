import { useEffect, useMemo, useState } from "react";
import { getAlerts } from "../api/alerts";
import { getItems } from "../api/items";
import { getPurchases } from "../api/purchases";
import { getStockMovements, getStockSummary } from "../api/stock";
import { useLocation } from "../context/LocationContext";
import { useWorkspaceSettings } from "../context/WorkspaceSettingsContext";
import type {
  AlertsResponse,
  ExpiryAlert,
  Item,
  LowStockAlert,
  Purchase,
  StockMovement,
  StockMovementType,
  StockSummaryItem,
} from "../types";

interface ReportsData {
  stockSummary: StockSummaryItem[];
  stockMovements: StockMovement[];
  purchases: Purchase[];
  items: Item[];
  alerts: AlertsResponse;
}

interface ReportFilters {
  fromDate: string;
  toDate: string;
  category: string;
}

interface PdfReport {
  title: string;
  workspaceName: string;
  filename: string;
  filters: string[];
  headers: string[];
  rows: Array<Array<string | number>>;
}

interface ExpiryRow {
  alert: ExpiryAlert;
  status: "expired" | "expiring-soon";
  daysFromNow: number;
}

const EMPTY_REPORTS: ReportsData = {
  stockSummary: [],
  stockMovements: [],
  purchases: [],
  items: [],
  alerts: { lowStock: [], expiringSoon: [], expired: [] },
};

const EMPTY_FILTERS: ReportFilters = { fromDate: "", toDate: "", category: "" };

export function ReportsPage() {
  const { activeLocationId } = useLocation();
  const { settings } = useWorkspaceSettings();
  const [data, setData] = useState<ReportsData>(EMPTY_REPORTS);
  const [filters, setFilters] = useState<ReportFilters>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadReports() {
      setLoading(true);
      try {
        const [summaryRes, movementsRes, purchasesRes, itemsRes, alertsRes] = await Promise.all([
          getStockSummary(),
          getStockMovements(),
          getPurchases(),
          getItems(),
          getAlerts(),
        ]);
        setData({
          stockSummary: summaryRes.summary,
          stockMovements: movementsRes.movements,
          purchases: purchasesRes.purchases,
          items: itemsRes.items,
          alerts: alertsRes,
        });
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load reports");
      } finally {
        setLoading(false);
      }
    }
    void loadReports();
  }, [activeLocationId]);

  const itemById = useMemo(
    () => new Map(data.items.map((item) => [item.id, item])),
    [data.items],
  );

  const categoryOptions = useMemo(
    () =>
      Array.from(
        new Set(
          data.items
            .map((item) => item.category?.trim())
            .filter((c): c is string => Boolean(c)),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [data.items],
  );

  const supplierOptions = useMemo(
    () =>
      Array.from(
        new Map(data.purchases.map((p) => [p.supplier.id, p.supplier])).values(),
      ).sort((a, b) => a.name.localeCompare(b.name)),
    [data.purchases],
  );

  // Base date-filtered movements
  const dateFilteredMovements = useMemo(
    () =>
      data.stockMovements.filter((m) =>
        isWithinDateRange(m.createdAt, filters.fromDate, filters.toDate),
      ),
    [data.stockMovements, filters.fromDate, filters.toDate],
  );

  // Per-type movement reports (date filter only — type is implicit)
  const filteredStockIn = useMemo(
    () => dateFilteredMovements.filter((m) => m.type === "STOCK_IN"),
    [dateFilteredMovements],
  );
  const filteredStockOut = useMemo(
    () => dateFilteredMovements.filter((m) => m.type === "STOCK_OUT"),
    [dateFilteredMovements],
  );
  const filteredWastage = useMemo(
    () => dateFilteredMovements.filter((m) => m.type === "WASTAGE"),
    [dateFilteredMovements],
  );
  const filteredTransfers = useMemo(
    () =>
      dateFilteredMovements.filter(
        (m) => m.type === "TRANSFER_IN" || m.type === "TRANSFER_OUT",
      ),
    [dateFilteredMovements],
  );

  // All movements (date + category filter via item lookup)
  const filteredAllMovements = useMemo(
    () =>
      dateFilteredMovements.filter((m) => {
        if (!filters.category) return true;
        const item = itemById.get(m.item.id);
        return (item?.category?.trim() || "Uncategorized") === filters.category;
      }),
    [dateFilteredMovements, filters.category, itemById],
  );

  // Stock summary (category filter)
  const filteredStockSummary = useMemo(
    () =>
      data.stockSummary.filter((item) => {
        if (!filters.category) return true;
        return (itemById.get(item.itemId)?.category?.trim() || "Uncategorized") === filters.category;
      }),
    [data.stockSummary, filters.category, itemById],
  );

  // Low stock (category filter)
  const filteredLowStock = useMemo(
    () =>
      data.alerts.lowStock.filter((item) => {
        if (!filters.category) return true;
        return (itemById.get(item.itemId)?.category?.trim() || "Uncategorized") === filters.category;
      }),
    [data.alerts.lowStock, filters.category, itemById],
  );

  // Expiry rows: combine expired + expiring-soon with status + days from now
  const filteredExpiry = useMemo((): ExpiryRow[] => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    function toRow(alert: ExpiryAlert, status: ExpiryRow["status"]): ExpiryRow {
      const expDate = new Date(alert.expiryDate);
      expDate.setHours(0, 0, 0, 0);
      const daysFromNow = Math.round((expDate.getTime() - now.getTime()) / 86_400_000);
      return { alert, status, daysFromNow };
    }
    const rows: ExpiryRow[] = [
      ...data.alerts.expired.map((a) => toRow(a, "expired")),
      ...data.alerts.expiringSoon.map((a) => toRow(a, "expiring-soon")),
    ];
    return rows
      .filter((r) => {
        if (!filters.category) return true;
        const item = itemById.get(r.alert.item.id);
        return (item?.category?.trim() || "Uncategorized") === filters.category;
      })
      .sort((a, b) => a.daysFromNow - b.daysFromNow);
  }, [data.alerts.expired, data.alerts.expiringSoon, filters.category, itemById]);

  // Purchases (date filter)
  const filteredPurchases = useMemo(
    () =>
      data.purchases.filter((p) =>
        isWithinDateRange(p.date, filters.fromDate, filters.toDate),
      ),
    [data.purchases, filters.fromDate, filters.toDate],
  );

  const activeFilterLabels = useMemo(() => {
    const labels: string[] = [];
    if (filters.fromDate) labels.push(`From ${filters.fromDate}`);
    if (filters.toDate) labels.push(`To ${filters.toDate}`);
    if (filters.category) labels.push(`Category: ${filters.category}`);
    return labels;
  }, [filters]);

  const hasFilters = activeFilterLabels.length > 0;
  const workspaceName = settings.name || "ShelfSense";

  function updateFilter<K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  if (loading) {
    return (
      <div className="page-loading">
        <div className="spinner" />
        <p>Loading reports...</p>
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

  return (
    <div className="reports-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle">
            Filtered operational exports for inventory, stock activity, and procurement.
          </p>
        </div>
      </div>

      {/* Summary strip */}
      <div className="ops-metric-strip">
        <div className="ops-metric">
          <span className="ops-metric-label">Total items</span>
          <strong className="ops-metric-value">{filteredStockSummary.length}</strong>
        </div>
        <div className="ops-metric ops-metric--amber">
          <span className="ops-metric-label">Low stock</span>
          <strong className="ops-metric-value">{filteredLowStock.length}</strong>
        </div>
        <div className="ops-metric ops-metric--red">
          <span className="ops-metric-label">Expiry alerts</span>
          <strong className="ops-metric-value">{filteredExpiry.length}</strong>
        </div>
        <div className="ops-metric ops-metric--green">
          <span className="ops-metric-label">Stock in</span>
          <strong className="ops-metric-value">{filteredStockIn.length}</strong>
        </div>
        <div className="ops-metric">
          <span className="ops-metric-label">Stock out</span>
          <strong className="ops-metric-value">{filteredStockOut.length}</strong>
        </div>
        <div className="ops-metric ops-metric--orange">
          <span className="ops-metric-label">Wastage</span>
          <strong className="ops-metric-value">{filteredWastage.length}</strong>
        </div>
      </div>

      {/* Filter bar */}
      <section className="report-filters">
        <div className="report-filter-grid">
          <label className="form-group">
            <span className="form-label">From date</span>
            <input
              className="form-input"
              type="date"
              value={filters.fromDate}
              max={filters.toDate || undefined}
              onChange={(e) => updateFilter("fromDate", e.target.value)}
            />
          </label>
          <label className="form-group">
            <span className="form-label">To date</span>
            <input
              className="form-input"
              type="date"
              value={filters.toDate}
              min={filters.fromDate || undefined}
              onChange={(e) => updateFilter("toDate", e.target.value)}
            />
          </label>
          <label className="form-group">
            <span className="form-label">Category</span>
            <select
              className="form-input form-select"
              value={filters.category}
              onChange={(e) => updateFilter("category", e.target.value)}
            >
              <option value="">All categories</option>
              {categoryOptions.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
              <option value="Uncategorized">Uncategorized</option>
            </select>
          </label>
        </div>

        <div className="report-filter-summary">
          <div>
            <span className="report-filter-summary-label">Active filters</span>
            {hasFilters ? (
              <div className="report-filter-chips">
                {activeFilterLabels.map((label) => (
                  <span key={label} className="report-filter-chip">{label}</span>
                ))}
              </div>
            ) : (
              <p className="report-filter-empty">No filters applied — exports include all available rows.</p>
            )}
          </div>
          <button
            type="button"
            className="btn btn--ghost report-clear-btn"
            disabled={!hasFilters}
            onClick={() => setFilters(EMPTY_FILTERS)}
          >
            Clear filters
          </button>
        </div>
      </section>

      {/* ── Inventory Reports ── */}
      <div className="report-section">
        <div className="report-section-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          </svg>
          <h2>Inventory</h2>
        </div>
        <div className="report-grid">
          <ReportCard
            color="indigo"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
            }
            title="Stock Summary"
            description="Current quantity, reorder levels, total valuation, and nearest expiry per item."
            rowCount={filteredStockSummary.length}
            onExportCsv={() => exportStockSummary(filteredStockSummary, itemById, filters, workspaceName)}
            onExportPdf={() =>
              exportPdf(
                getStockSummaryPdf(filteredStockSummary, itemById, workspaceName, activeFilterLabels, filters),
              )
            }
          />
          <ReportCard
            color="amber"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            }
            title="Low Stock"
            description="Items currently below their minimum stock level that need restocking."
            rowCount={filteredLowStock.length}
            onExportCsv={() => exportLowStock(filteredLowStock, itemById, filters)}
            onExportPdf={() =>
              exportPdf(getLowStockPdf(filteredLowStock, itemById, workspaceName, activeFilterLabels, filters))
            }
          />
          <ReportCard
            color="purple"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
            }
            title="Expiry Status"
            description="Expired and expiring-soon batches with remaining quantities and days to expiry."
            rowCount={filteredExpiry.length}
            onExportCsv={() => exportExpiry(filteredExpiry, filters)}
            onExportPdf={() =>
              exportPdf(getExpiryPdf(filteredExpiry, workspaceName, activeFilterLabels, filters))
            }
          />
        </div>
      </div>

      {/* ── Stock Activity ── */}
      <div className="report-section">
        <div className="report-section-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7h13M13 4l3 3-3 3M21 17H8M8 14l-3 3 3 3" />
          </svg>
          <h2>Stock Activity</h2>
        </div>
        <div className="report-grid">
          <ReportCard
            color="green"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
            }
            title="Stock In"
            description="All stock-in transactions: received quantities, unit costs, and supplier notes."
            rowCount={filteredStockIn.length}
            onExportCsv={() => exportMovementsByType(filteredStockIn, "stock-in", filters)}
            onExportPdf={() =>
              exportPdf(getMovementTypePdf(filteredStockIn, "Stock In", "stock-in", workspaceName, activeFilterLabels, filters))
            }
          />
          <ReportCard
            color="red"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M19 12l-7-7-7 7" />
              </svg>
            }
            title="Stock Out"
            description="All stock-out transactions: quantities deducted, reasons, and operator notes."
            rowCount={filteredStockOut.length}
            onExportCsv={() => exportMovementsByType(filteredStockOut, "stock-out", filters)}
            onExportPdf={() =>
              exportPdf(getMovementTypePdf(filteredStockOut, "Stock Out", "stock-out", workspaceName, activeFilterLabels, filters))
            }
          />
          <ReportCard
            color="orange"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            }
            title="Wastage"
            description="Items recorded as wasted or spoiled, with quantities and waste reasons."
            rowCount={filteredWastage.length}
            onExportCsv={() => exportMovementsByType(filteredWastage, "wastage", filters)}
            onExportPdf={() =>
              exportPdf(getMovementTypePdf(filteredWastage, "Wastage", "wastage", workspaceName, activeFilterLabels, filters))
            }
          />
          <ReportCard
            color="cyan"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            }
            title="Transfers"
            description="Stock transferred between locations — both inbound and outbound movements."
            rowCount={filteredTransfers.length}
            onExportCsv={() => exportMovementsByType(filteredTransfers, "transfers", filters)}
            onExportPdf={() =>
              exportPdf(getMovementTypePdf(filteredTransfers, "Transfers", "transfers", workspaceName, activeFilterLabels, filters))
            }
          />
          <ReportCard
            color="indigo"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7h13M13 4l3 3-3 3M21 17H8M8 14l-3 3 3 3" />
              </svg>
            }
            title="All Movements"
            description="Complete movement log across all types — use the date and category filters above."
            rowCount={filteredAllMovements.length}
            onExportCsv={() => exportAllMovements(filteredAllMovements, filters)}
            onExportPdf={() =>
              exportPdf(getAllMovementsPdf(filteredAllMovements, workspaceName, activeFilterLabels, filters))
            }
          />
        </div>
      </div>

      {/* ── Procurement ── */}
      <div className="report-section">
        <div className="report-section-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <path d="M16 10a4 4 0 0 1-8 0" />
          </svg>
          <h2>Procurement</h2>
        </div>
        <div className="report-grid">
          <ReportCard
            color="blue"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <path d="M16 10a4 4 0 0 1-8 0" />
              </svg>
            }
            title="Purchases"
            description="Purchase orders by supplier with line items, costs, and order totals."
            rowCount={filteredPurchases.length}
            onExportCsv={() => exportPurchases(filteredPurchases, filters)}
            onExportPdf={() =>
              exportPdf(getPurchasesPdf(filteredPurchases, workspaceName, activeFilterLabels, filters))
            }
          />
          <ReportCard
            color="blue"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            }
            title="Purchase by Supplier"
            description="Supplier-level purchase summary: total spend, number of orders, and item count."
            rowCount={supplierOptions.length}
            onExportCsv={() => exportPurchaseBySupplier(filteredPurchases, filters)}
            onExportPdf={() =>
              exportPdf(getPurchaseBySupplierPdf(filteredPurchases, workspaceName, activeFilterLabels, filters))
            }
          />
        </div>
      </div>
    </div>
  );
}

/* ── Report Card Component ── */
type ReportColor = "indigo" | "green" | "red" | "amber" | "purple" | "cyan" | "orange" | "blue";

function ReportCard({
  color,
  icon,
  title,
  description,
  rowCount,
  onExportCsv,
  onExportPdf,
}: {
  color: ReportColor;
  icon: React.ReactNode;
  title: string;
  description: string;
  rowCount: number;
  onExportCsv: () => void;
  onExportPdf: () => void;
}) {
  return (
    <article className={`report-card report-card--${color}`}>
      <div className="report-card-top">
        <div className={`report-card-icon report-card-icon--${color}`}>{icon}</div>
        <div>
          <h2 className="report-card-title">{title}</h2>
          <p className="report-card-copy">{description}</p>
        </div>
      </div>
      <div className="report-card-footer">
        <span className={`report-card-count ${rowCount === 0 ? "report-card-count--zero" : ""}`}>
          {rowCount.toLocaleString()} row{rowCount !== 1 ? "s" : ""}
        </span>
        <div className="report-card-actions">
          <button
            type="button"
            className="btn btn--secondary report-export-btn"
            disabled={rowCount === 0}
            onClick={onExportPdf}
            title="Export as PDF"
          >
            <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            PDF
          </button>
          <button
            type="button"
            className="btn btn--primary report-export-btn"
            disabled={rowCount === 0}
            onClick={onExportCsv}
            title="Export as CSV"
          >
            <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            CSV
          </button>
        </div>
      </div>
    </article>
  );
}

/* ══════════════════════════════════════════════════
   CSV EXPORT FUNCTIONS
══════════════════════════════════════════════════ */

function exportStockSummary(
  summary: StockSummaryItem[],
  itemById: Map<string, Item>,
  filters: ReportFilters,
  _workspaceName: string,
) {
  downloadCsv(
    withDateSuffix("shelfsense-stock-summary.csv", filters),
    toCsv([
      ["Item Name", "Category", "Unit", "Quantity", "Min Stock Level", "Low Stock", "Total Value", "Nearest Expiry"],
      ...summary.map((item) => [
        item.itemName,
        getItemCategory(item.itemId, itemById),
        item.unit,
        item.totalQuantity,
        item.minStockLevel,
        item.isLowStock ? "Yes" : "No",
        item.totalValue,
        formatDate(item.nearestExpiryDate),
      ]),
    ]),
  );
}

function exportLowStock(
  rows: LowStockAlert[],
  itemById: Map<string, Item>,
  filters: ReportFilters,
) {
  downloadCsv(
    withDateSuffix("shelfsense-low-stock.csv", filters),
    toCsv([
      ["Item Name", "Category", "Unit", "Current Qty", "Min Stock Level", "Deficit"],
      ...rows.map((r) => [
        r.itemName,
        getItemCategory(r.itemId, itemById),
        r.unit,
        r.quantity,
        r.minStockLevel,
        r.minStockLevel - r.quantity,
      ]),
    ]),
  );
}

function exportExpiry(rows: ExpiryRow[], filters: ReportFilters) {
  downloadCsv(
    withDateSuffix("shelfsense-expiry-status.csv", filters),
    toCsv([
      ["Item Name", "Unit", "Remaining Qty", "Expiry Date", "Days from Today", "Status", "Batch No"],
      ...rows.map((r) => [
        r.alert.item.name,
        r.alert.item.unit,
        r.alert.remainingQuantity,
        formatDate(r.alert.expiryDate),
        r.daysFromNow,
        r.status === "expired" ? "Expired" : "Expiring Soon",
        r.alert.batchNo ?? "",
      ]),
    ]),
  );
}

function exportMovementsByType(movements: StockMovement[], type: string, filters: ReportFilters) {
  downloadCsv(
    withDateSuffix(`shelfsense-${type}.csv`, filters),
    toCsv([
      ["Date", "Item Name", "Type", "Quantity", "Unit Cost", "Reason", "Note"],
      ...movements.map((m) => [
        formatDateTime(m.createdAt),
        m.item.name,
        formatMovementType(m.type),
        m.quantity,
        m.unitCost ?? "",
        m.reason ?? "",
        m.note ?? "",
      ]),
    ]),
  );
}

function exportAllMovements(movements: StockMovement[], filters: ReportFilters) {
  exportMovementsByType(movements, "movements", filters);
}

function exportPurchases(purchases: Purchase[], filters: ReportFilters) {
  downloadCsv(
    withDateSuffix("shelfsense-purchases.csv", filters),
    toCsv([
      ["Date", "Supplier", "Total Amount", "Number of Lines"],
      ...purchases.map((p) => [
        formatDate(p.date),
        p.supplier.name,
        p.totalAmount,
        p.purchaseItems.length,
      ]),
    ]),
  );
}

function exportPurchaseBySupplier(purchases: Purchase[], filters: ReportFilters) {
  const bySupplier = new Map<string, { name: string; orders: number; totalSpend: number; totalItems: number }>();
  for (const p of purchases) {
    const existing = bySupplier.get(p.supplier.id) ?? { name: p.supplier.name, orders: 0, totalSpend: 0, totalItems: 0 };
    existing.orders += 1;
    existing.totalSpend += p.totalAmount;
    existing.totalItems += p.purchaseItems.length;
    bySupplier.set(p.supplier.id, existing);
  }
  downloadCsv(
    withDateSuffix("shelfsense-purchases-by-supplier.csv", filters),
    toCsv([
      ["Supplier", "Total Orders", "Total Spend", "Total Line Items"],
      ...Array.from(bySupplier.values()).sort((a, b) => b.totalSpend - a.totalSpend).map((s) => [
        s.name,
        s.orders,
        s.totalSpend,
        s.totalItems,
      ]),
    ]),
  );
}

/* ══════════════════════════════════════════════════
   PDF REPORT BUILDERS
══════════════════════════════════════════════════ */

function getStockSummaryPdf(
  summary: StockSummaryItem[],
  itemById: Map<string, Item>,
  workspaceName: string,
  filters: string[],
  rawFilters: ReportFilters,
): PdfReport {
  return {
    title: "Stock Summary",
    workspaceName,
    filename: withDateSuffix("shelfsense-stock-summary.pdf", rawFilters),
    filters,
    headers: ["Item", "Category", "Unit", "Qty", "Min", "Low Stock", "Value", "Expiry"],
    rows: summary.map((item) => [
      item.itemName,
      getItemCategory(item.itemId, itemById),
      item.unit,
      item.totalQuantity,
      item.minStockLevel,
      item.isLowStock ? "Yes" : "No",
      item.totalValue,
      formatDate(item.nearestExpiryDate) || "-",
    ]),
  };
}

function getLowStockPdf(
  rows: LowStockAlert[],
  itemById: Map<string, Item>,
  workspaceName: string,
  filters: string[],
  rawFilters: ReportFilters,
): PdfReport {
  return {
    title: "Low Stock Alert",
    workspaceName,
    filename: withDateSuffix("shelfsense-low-stock.pdf", rawFilters),
    filters,
    headers: ["Item", "Category", "Unit", "Current Qty", "Min Level", "Deficit"],
    rows: rows.map((r) => [
      r.itemName,
      getItemCategory(r.itemId, itemById),
      r.unit,
      r.quantity,
      r.minStockLevel,
      r.minStockLevel - r.quantity,
    ]),
  };
}

function getExpiryPdf(
  rows: ExpiryRow[],
  workspaceName: string,
  filters: string[],
  rawFilters: ReportFilters,
): PdfReport {
  return {
    title: "Expiry Status",
    workspaceName,
    filename: withDateSuffix("shelfsense-expiry-status.pdf", rawFilters),
    filters,
    headers: ["Item", "Unit", "Remaining Qty", "Expiry Date", "Days", "Status"],
    rows: rows.map((r) => [
      r.alert.item.name,
      r.alert.item.unit,
      r.alert.remainingQuantity,
      formatDate(r.alert.expiryDate),
      r.daysFromNow,
      r.status === "expired" ? "Expired" : "Expiring Soon",
    ]),
  };
}

function getMovementTypePdf(
  movements: StockMovement[],
  title: string,
  slug: string,
  workspaceName: string,
  filters: string[],
  rawFilters: ReportFilters,
): PdfReport {
  return {
    title,
    workspaceName,
    filename: withDateSuffix(`shelfsense-${slug}.pdf`, rawFilters),
    filters,
    headers: ["Date", "Item", "Type", "Qty", "Cost", "Reason", "Note"],
    rows: movements.map((m) => [
      formatDate(m.createdAt),
      m.item.name,
      formatMovementType(m.type),
      m.quantity,
      m.unitCost ?? "-",
      m.reason ?? "-",
      m.note ?? "-",
    ]),
  };
}

function getAllMovementsPdf(
  movements: StockMovement[],
  workspaceName: string,
  filters: string[],
  rawFilters: ReportFilters,
): PdfReport {
  return getMovementTypePdf(movements, "All Movements", "movements", workspaceName, filters, rawFilters);
}

function getPurchasesPdf(
  purchases: Purchase[],
  workspaceName: string,
  filters: string[],
  rawFilters: ReportFilters,
): PdfReport {
  return {
    title: "Purchases",
    workspaceName,
    filename: withDateSuffix("shelfsense-purchases.pdf", rawFilters),
    filters,
    headers: ["Date", "Supplier", "Total", "Lines"],
    rows: purchases.map((p) => [
      formatDate(p.date),
      p.supplier.name,
      p.totalAmount,
      p.purchaseItems.length,
    ]),
  };
}

function getPurchaseBySupplierPdf(
  purchases: Purchase[],
  workspaceName: string,
  filters: string[],
  rawFilters: ReportFilters,
): PdfReport {
  const bySupplier = new Map<string, { name: string; orders: number; totalSpend: number; totalItems: number }>();
  for (const p of purchases) {
    const existing = bySupplier.get(p.supplier.id) ?? { name: p.supplier.name, orders: 0, totalSpend: 0, totalItems: 0 };
    existing.orders += 1;
    existing.totalSpend += p.totalAmount;
    existing.totalItems += p.purchaseItems.length;
    bySupplier.set(p.supplier.id, existing);
  }
  return {
    title: "Purchases by Supplier",
    workspaceName,
    filename: withDateSuffix("shelfsense-purchases-by-supplier.pdf", rawFilters),
    filters,
    headers: ["Supplier", "Orders", "Total Spend", "Line Items"],
    rows: Array.from(bySupplier.values())
      .sort((a, b) => b.totalSpend - a.totalSpend)
      .map((s) => [s.name, s.orders, s.totalSpend, s.totalItems]),
  };
}

/* ══════════════════════════════════════════════════
   PDF ENGINE
══════════════════════════════════════════════════ */

async function exportPdf(report: PdfReport) {
  const { default: JsPDF } = await import("jspdf");
  const doc = new JsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 38;
  const tableWidth = pageWidth - margin * 2;
  const colWidth = tableWidth / report.headers.length;
  const generatedAt = new Date().toLocaleString();
  let y = margin;

  doc.setProperties({ title: `${report.workspaceName} - ${report.title}` });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(report.workspaceName, margin, y);
  y += 22;

  doc.setFontSize(13);
  doc.text(report.title, margin, y);
  y += 18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Generated: ${generatedAt}`, margin, y);
  y += 14;
  doc.text(
    `Active filters: ${report.filters.length > 0 ? report.filters.join("; ") : "None"}`,
    margin,
    y,
  );
  y += 20;

  y = drawPdfTableHeader(doc, report.headers, margin, y, colWidth);

  report.rows.forEach((row) => {
    if (y > pageHeight - 42) {
      doc.addPage();
      y = margin;
      y = drawPdfTableHeader(doc, report.headers, margin, y, colWidth);
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    row.forEach((cell, i) => {
      doc.text(truncatePdfCell(cell, colWidth - 10), margin + i * colWidth + 5, y + 13);
    });
    doc.setDrawColor(230, 235, 240);
    doc.line(margin, y + 20, pageWidth - margin, y + 20);
    y += 21;
  });

  doc.save(report.filename);
}

function drawPdfTableHeader(
  doc: InstanceType<typeof import("jspdf").default>,
  headers: string[],
  margin: number,
  y: number,
  colWidth: number,
) {
  doc.setFillColor(244, 247, 252);
  doc.rect(margin, y, colWidth * headers.length, 22, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  headers.forEach((header, i) => {
    doc.text(header, margin + i * colWidth + 5, y + 14);
  });
  return y + 23;
}

function truncatePdfCell(value: string | number, maxWidth: number) {
  const text = String(value);
  const maxChars = Math.max(8, Math.floor(maxWidth / 4.4));
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

/* ══════════════════════════════════════════════════
   UTILITY HELPERS
══════════════════════════════════════════════════ */

function toCsv(rows: Array<Array<string | number>>) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function csvCell(value: string | number) {
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getItemCategory(itemId: string, itemById: Map<string, Item>) {
  return itemById.get(itemId)?.category?.trim() || "Uncategorized";
}

function isWithinDateRange(value: string, fromDate: string, toDate: string) {
  const date = value.slice(0, 10);
  if (fromDate && date < fromDate) return false;
  if (toDate && date > toDate) return false;
  return true;
}

function withDateSuffix(filename: string, filters: Pick<ReportFilters, "fromDate" | "toDate">) {
  if (!filters.fromDate && !filters.toDate) return filename;
  const dotIndex = filename.lastIndexOf(".");
  const name = dotIndex === -1 ? filename : filename.slice(0, dotIndex);
  const ext = dotIndex === -1 ? "" : filename.slice(dotIndex + 1);
  const suffix = [filters.fromDate, filters.toDate].filter(Boolean).join("-to-");
  return `${name}-${suffix}.${ext}`;
}

function formatMovementType(type: StockMovementType) {
  return type
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: string | null | undefined) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}
