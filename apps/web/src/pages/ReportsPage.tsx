import { useEffect, useState } from "react";
import { getPurchases } from "../api/purchases";
import { getStockMovements, getStockSummary } from "../api/stock";
import { useLocation } from "../context/LocationContext";
import type { Purchase, StockMovement, StockSummaryItem } from "../types";

interface ReportsData {
  stockSummary: StockSummaryItem[];
  stockMovements: StockMovement[];
  purchases: Purchase[];
}

const EMPTY_REPORTS: ReportsData = {
  stockSummary: [],
  stockMovements: [],
  purchases: [],
};

export function ReportsPage() {
  const { activeLocationId } = useLocation();
  const [data, setData] = useState<ReportsData>(EMPTY_REPORTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadReports() {
      try {
        const [summaryRes, movementsRes, purchasesRes] = await Promise.all([
          getStockSummary(),
          getStockMovements(),
          getPurchases(),
        ]);

        setData({
          stockSummary: summaryRes.summary,
          stockMovements: movementsRes.movements,
          purchases: purchasesRes.purchases,
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
          <p className="page-subtitle">Export ShelfSense data as CSV files</p>
        </div>
      </div>

      <div className="report-grid">
        <ReportCard
          title="Stock Summary"
          description="Current quantity, reorder levels, valuation, and expiry status."
          rowCount={data.stockSummary.length}
          onExport={() => exportStockSummary(data.stockSummary)}
        />
        <ReportCard
          title="Stock Movements"
          description="All stock in, stock out, wastage, and adjustment activity."
          rowCount={data.stockMovements.length}
          onExport={() => exportStockMovements(data.stockMovements)}
        />
        <ReportCard
          title="Purchases"
          description="Purchase totals by supplier with line counts."
          rowCount={data.purchases.length}
          onExport={() => exportPurchases(data.purchases)}
        />
      </div>
    </div>
  );
}

function ReportCard({
  title,
  description,
  rowCount,
  onExport,
}: {
  title: string;
  description: string;
  rowCount: number;
  onExport: () => void;
}) {
  return (
    <article className="report-card">
      <div>
        <h2 className="report-card-title">{title}</h2>
        <p className="report-card-copy">{description}</p>
      </div>
      <div className="report-card-footer">
        <span className="report-card-count">{rowCount} rows</span>
        <button
          type="button"
          className="btn btn--primary report-export-btn"
          disabled={rowCount === 0}
          onClick={onExport}
        >
          <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Export CSV
        </button>
      </div>
    </article>
  );
}

function exportStockSummary(summary: StockSummaryItem[]) {
  downloadCsv(
    "shelfsense-stock-summary.csv",
    toCsv([
      ["Item Name", "Unit", "Quantity", "Min Stock Level", "Low Stock", "Total Value", "Nearest Expiry"],
      ...summary.map((item) => [
        item.itemName,
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

function exportStockMovements(movements: StockMovement[]) {
  downloadCsv(
    "shelfsense-stock-movements.csv",
    toCsv([
      ["Date", "Item Name", "Type", "Quantity", "Unit Cost", "Reason", "Note"],
      ...movements.map((movement) => [
        formatDateTime(movement.createdAt),
        movement.item.name,
        movement.type,
        movement.quantity,
        movement.unitCost ?? "",
        movement.reason ?? "",
        movement.note ?? "",
      ]),
    ]),
  );
}

function exportPurchases(purchases: Purchase[]) {
  downloadCsv(
    "shelfsense-purchases.csv",
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

function formatDate(value: string | null) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function formatDateTime(value: string) {
  return new Date(value).toISOString();
}
