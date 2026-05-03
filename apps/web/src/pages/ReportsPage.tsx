import { useEffect, useMemo, useState } from "react";
import { getItems } from "../api/items";
import { getPurchases } from "../api/purchases";
import { getStockMovements, getStockSummary } from "../api/stock";
import { useLocation } from "../context/LocationContext";
import { useWorkspaceSettings } from "../context/WorkspaceSettingsContext";
import type { Item, Purchase, StockMovement, StockMovementType, StockSummaryItem } from "../types";

interface ReportsData {
  stockSummary: StockSummaryItem[];
  stockMovements: StockMovement[];
  purchases: Purchase[];
  items: Item[];
}

interface ReportFilters {
  fromDate: string;
  toDate: string;
  movementType: "" | StockMovementType;
  supplierId: string;
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

const EMPTY_REPORTS: ReportsData = {
  stockSummary: [],
  stockMovements: [],
  purchases: [],
  items: [],
};

const EMPTY_FILTERS: ReportFilters = {
  fromDate: "",
  toDate: "",
  movementType: "",
  supplierId: "",
  category: "",
};

const MOVEMENT_TYPES: StockMovementType[] = [
  "STOCK_IN",
  "STOCK_OUT",
  "WASTAGE",
  "ADJUSTMENT",
  "TRANSFER_IN",
  "TRANSFER_OUT",
];

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
        const [summaryRes, movementsRes, purchasesRes, itemsRes] = await Promise.all([
          getStockSummary(),
          getStockMovements(),
          getPurchases(),
          getItems(),
        ]);

        setData({
          stockSummary: summaryRes.summary,
          stockMovements: movementsRes.movements,
          purchases: purchasesRes.purchases,
          items: itemsRes.items,
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

  const itemById = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items]);

  const supplierOptions = useMemo(
    () =>
      Array.from(new Map(data.purchases.map((purchase) => [purchase.supplier.id, purchase.supplier])).values())
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data.purchases],
  );

  const categoryOptions = useMemo(
    () =>
      Array.from(
        new Set(
          data.items
            .map((item) => item.category?.trim())
            .filter((category): category is string => Boolean(category)),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [data.items],
  );

  const filteredStockSummary = useMemo(
    () =>
      data.stockSummary.filter((item) => {
        if (!filters.category) return true;
        const category = itemById.get(item.itemId)?.category?.trim() || "Uncategorized";
        return category === filters.category;
      }),
    [data.stockSummary, filters.category, itemById],
  );

  const filteredStockMovements = useMemo(
    () =>
      data.stockMovements.filter((movement) => {
        if (filters.movementType && movement.type !== filters.movementType) return false;
        return isWithinDateRange(movement.createdAt, filters.fromDate, filters.toDate);
      }),
    [data.stockMovements, filters.fromDate, filters.movementType, filters.toDate],
  );

  const filteredPurchases = useMemo(
    () =>
      data.purchases.filter((purchase) => {
        if (filters.supplierId && purchase.supplier.id !== filters.supplierId) return false;
        return isWithinDateRange(purchase.date, filters.fromDate, filters.toDate);
      }),
    [data.purchases, filters.fromDate, filters.supplierId, filters.toDate],
  );

  const activeFilterLabels = useMemo(
    () => getActiveFilterLabels(filters, supplierOptions),
    [filters, supplierOptions],
  );

  const hasFilters = activeFilterLabels.length > 0;
  const workspaceName = settings.name || "ShelfSense";

  function updateFilter<K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
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
          <p className="page-subtitle">Prepare filtered operational exports as CSV or print-friendly PDF files.</p>
        </div>
      </div>

      <div className="ops-metric-strip" aria-label="Report summary">
        <div className="ops-metric">
          <span className="ops-metric-label">Stock rows</span>
          <strong className="ops-metric-value">{filteredStockSummary.length}</strong>
        </div>
        <div className="ops-metric">
          <span className="ops-metric-label">Movement rows</span>
          <strong className="ops-metric-value">{filteredStockMovements.length}</strong>
        </div>
        <div className="ops-metric">
          <span className="ops-metric-label">Purchase rows</span>
          <strong className="ops-metric-value">{filteredPurchases.length}</strong>
        </div>
        <div className="ops-metric">
          <span className="ops-metric-label">Active filters</span>
          <strong className="ops-metric-value">{activeFilterLabels.length}</strong>
        </div>
      </div>

      <section className="report-filters" aria-label="Report filters">
        <div className="report-filter-grid">
          <label className="form-group">
            <span className="form-label">From date</span>
            <input
              className="form-input"
              type="date"
              value={filters.fromDate}
              max={filters.toDate || undefined}
              onChange={(event) => updateFilter("fromDate", event.target.value)}
            />
          </label>
          <label className="form-group">
            <span className="form-label">To date</span>
            <input
              className="form-input"
              type="date"
              value={filters.toDate}
              min={filters.fromDate || undefined}
              onChange={(event) => updateFilter("toDate", event.target.value)}
            />
          </label>
          <label className="form-group">
            <span className="form-label">Movement type</span>
            <select
              className="form-input form-select"
              value={filters.movementType}
              onChange={(event) => updateFilter("movementType", event.target.value as ReportFilters["movementType"])}
            >
              <option value="">All movements</option>
              {MOVEMENT_TYPES.map((type) => (
                <option key={type} value={type}>{formatMovementType(type)}</option>
              ))}
            </select>
          </label>
          <label className="form-group">
            <span className="form-label">Supplier</span>
            <select
              className="form-input form-select"
              value={filters.supplierId}
              onChange={(event) => updateFilter("supplierId", event.target.value)}
            >
              <option value="">All suppliers</option>
              {supplierOptions.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
              ))}
            </select>
          </label>
          <label className="form-group">
            <span className="form-label">Category</span>
            <select
              className="form-input form-select"
              value={filters.category}
              onChange={(event) => updateFilter("category", event.target.value)}
            >
              <option value="">All categories</option>
              {categoryOptions.map((category) => (
                <option key={category} value={category}>{category}</option>
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
              <p className="report-filter-empty">No filters applied. Exports include all available rows.</p>
            )}
          </div>
          <button type="button" className="btn btn--ghost report-clear-btn" disabled={!hasFilters} onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      </section>

      <div className="report-grid">
        <ReportCard
          title="Stock Summary"
          description="Current quantity, reorder levels, valuation, category, and expiry status."
          rowCount={filteredStockSummary.length}
          onExportCsv={() => exportStockSummary(filteredStockSummary, itemById, filters)}
          onExportPdf={() =>
            exportPdf(
              getStockSummaryPdfReport(filteredStockSummary, itemById, workspaceName, activeFilterLabels, filters),
            )
          }
        />
        <ReportCard
          title="Stock Movements"
          description="Stock in, stock out, wastage, adjustment, and transfer activity."
          rowCount={filteredStockMovements.length}
          onExportCsv={() => exportStockMovements(filteredStockMovements, filters)}
          onExportPdf={() =>
            exportPdf(getStockMovementsPdfReport(filteredStockMovements, workspaceName, activeFilterLabels, filters))
          }
        />
        <ReportCard
          title="Purchases"
          description="Purchase totals by supplier with line counts."
          rowCount={filteredPurchases.length}
          onExportCsv={() => exportPurchases(filteredPurchases, filters)}
          onExportPdf={() => exportPdf(getPurchasesPdfReport(filteredPurchases, workspaceName, activeFilterLabels, filters))}
        />
      </div>
    </div>
  );
}

function ReportCard({
  title,
  description,
  rowCount,
  onExportCsv,
  onExportPdf,
}: {
  title: string;
  description: string;
  rowCount: number;
  onExportCsv: () => void;
  onExportPdf: () => void;
}) {
  return (
    <article className="report-card">
      <div>
        <h2 className="report-card-title">{title}</h2>
        <p className="report-card-copy">{description}</p>
      </div>
      <div className="report-card-footer">
        <span className="report-card-count">{rowCount} rows</span>
        <div className="report-card-actions">
          <button
            type="button"
            className="btn btn--secondary report-export-btn"
            disabled={rowCount === 0}
            onClick={onExportPdf}
          >
            PDF
          </button>
          <button
            type="button"
            className="btn btn--primary report-export-btn"
            disabled={rowCount === 0}
            onClick={onExportCsv}
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

function exportStockSummary(summary: StockSummaryItem[], itemById: Map<string, Item>, filters: ReportFilters) {
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

function exportStockMovements(movements: StockMovement[], filters: ReportFilters) {
  downloadCsv(
    withDateSuffix("shelfsense-stock-movements.csv", filters),
    toCsv([
      ["Date", "Item Name", "Type", "Quantity", "Unit Cost", "Reason", "Note"],
      ...movements.map((movement) => [
        formatDateTime(movement.createdAt),
        movement.item.name,
        formatMovementType(movement.type),
        movement.quantity,
        movement.unitCost ?? "",
        movement.reason ?? "",
        movement.note ?? "",
      ]),
    ]),
  );
}

function exportPurchases(purchases: Purchase[], filters: ReportFilters) {
  downloadCsv(
    withDateSuffix("shelfsense-purchases.csv", filters),
    toCsv([
      ["Date", "Supplier", "Total Amount", "Number of Lines"],
      ...purchases.map((purchase) => [
        formatDate(purchase.date),
        purchase.supplier.name,
        purchase.totalAmount,
        purchase.purchaseItems.length,
      ]),
    ]),
  );
}

function getStockSummaryPdfReport(
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
    headers: ["Item", "Category", "Unit", "Qty", "Min", "Low", "Value", "Expiry"],
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

function getStockMovementsPdfReport(
  movements: StockMovement[],
  workspaceName: string,
  filters: string[],
  rawFilters: ReportFilters,
): PdfReport {
  return {
    title: "Stock Movements",
    workspaceName,
    filename: withDateSuffix("shelfsense-stock-movements.pdf", rawFilters),
    filters,
    headers: ["Date", "Item", "Type", "Qty", "Cost", "Reason", "Note"],
    rows: movements.map((movement) => [
      formatDate(movement.createdAt),
      movement.item.name,
      formatMovementType(movement.type),
      movement.quantity,
      movement.unitCost ?? "-",
      movement.reason ?? "-",
      movement.note ?? "-",
    ]),
  };
}

function getPurchasesPdfReport(
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
    rows: purchases.map((purchase) => [
      formatDate(purchase.date),
      purchase.supplier.name,
      purchase.totalAmount,
      purchase.purchaseItems.length,
    ]),
  };
}

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
  doc.text(`Active filters: ${report.filters.length > 0 ? report.filters.join("; ") : "None"}`, margin, y);
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
    row.forEach((cell, index) => {
      doc.text(truncatePdfCell(cell, colWidth - 10), margin + index * colWidth + 5, y + 13);
    });
    doc.setDrawColor(230, 235, 232);
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
  doc.setFillColor(244, 247, 245);
  doc.rect(margin, y, colWidth * headers.length, 22, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  headers.forEach((header, index) => {
    doc.text(header, margin + index * colWidth + 5, y + 14);
  });
  return y + 23;
}

function truncatePdfCell(value: string | number, maxWidth: number) {
  const text = String(value);
  const maxChars = Math.max(8, Math.floor(maxWidth / 4.4));
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}...` : text;
}

function toCsv(rows: Array<Array<string | number>>) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function csvCell(value: string | number) {
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
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

function getActiveFilterLabels(filters: ReportFilters, suppliers: Array<{ id: string; name: string }>) {
  const labels: string[] = [];
  if (filters.fromDate) labels.push(`From ${filters.fromDate}`);
  if (filters.toDate) labels.push(`To ${filters.toDate}`);
  if (filters.movementType) labels.push(`Movement: ${formatMovementType(filters.movementType)}`);
  if (filters.supplierId) {
    labels.push(`Supplier: ${suppliers.find((supplier) => supplier.id === filters.supplierId)?.name ?? "Selected"}`);
  }
  if (filters.category) labels.push(`Category: ${filters.category}`);
  return labels;
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
  const [name, extension] = splitFilename(filename);
  const suffix = [filters.fromDate, filters.toDate].filter(Boolean).join("-to-");
  return `${name}-${suffix}.${extension}`;
}

function splitFilename(filename: string) {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex === -1) return [filename, ""] as const;
  return [filename.slice(0, dotIndex), filename.slice(dotIndex + 1)] as const;
}

function formatMovementType(type: StockMovementType) {
  return type
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: string | null) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function formatDateTime(value: string) {
  return new Date(value).toISOString();
}
