import type {
  AdjustmentVarianceResponse,
  ExpiryLossResponse,
  InventoryValuationResponse,
  ReportParams,
  StockAgingResponse,
  SupplierSpendResponse,
  TransferHistoryResponse,
  UsageResponse,
  WastageCostResponse,
} from "../types";
import { apiClient } from "./client";

const TOKEN_KEY = "shelfsense_token";
const ACTIVE_LOCATION_KEY = "shelfsense_active_location_id";
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "/api";

// ─── Shared parameter builder ─────────────────────────────────────────────────

function buildQuery(params: ReportParams): string {
  const p = new URLSearchParams();
  if (params.dateFrom) p.set("dateFrom", params.dateFrom);
  if (params.dateTo) p.set("dateTo", params.dateTo);
  if (params.locationId) p.set("locationId", params.locationId);
  if (params.itemId) p.set("itemId", params.itemId);
  if (params.category) p.set("category", params.category);
  if (params.supplierId) p.set("supplierId", params.supplierId);
  const q = p.toString();
  return q ? `?${q}` : "";
}

// ─── JSON report fetchers ────────────────────────────────────────────────────

export function getInventoryValuation(params: ReportParams = {}) {
  return apiClient.get<InventoryValuationResponse>(`/reports/inventory-valuation${buildQuery(params)}`);
}

export function getWastageCost(params: ReportParams = {}) {
  return apiClient.get<WastageCostResponse>(`/reports/wastage-cost${buildQuery(params)}`);
}

export function getUsageReport(params: ReportParams = {}) {
  return apiClient.get<UsageResponse>(`/reports/usage${buildQuery(params)}`);
}

export function getSupplierSpend(params: ReportParams = {}) {
  return apiClient.get<SupplierSpendResponse>(`/reports/supplier-spend${buildQuery(params)}`);
}

export function getStockAging(params: ReportParams = {}) {
  return apiClient.get<StockAgingResponse>(`/reports/stock-aging${buildQuery(params)}`);
}

export function getExpiryLoss(params: ReportParams = {}) {
  return apiClient.get<ExpiryLossResponse>(`/reports/expiry-loss${buildQuery(params)}`);
}

export function getAdjustmentVariance(params: ReportParams = {}) {
  return apiClient.get<AdjustmentVarianceResponse>(`/reports/adjustment-variance${buildQuery(params)}`);
}

export function getTransferHistory(params: ReportParams = {}) {
  return apiClient.get<TransferHistoryResponse>(`/reports/transfers${buildQuery(params)}`);
}

// ─── CSV download helper ──────────────────────────────────────────────────────
// Fetches with auth headers, creates a blob URL, and triggers a browser download.

export async function downloadReportCsv(
  endpoint: string,
  params: ReportParams,
  filename: string,
): Promise<void> {
  const p = new URLSearchParams();
  if (params.dateFrom) p.set("dateFrom", params.dateFrom);
  if (params.dateTo) p.set("dateTo", params.dateTo);
  if (params.locationId) p.set("locationId", params.locationId);
  if (params.itemId) p.set("itemId", params.itemId);
  if (params.category) p.set("category", params.category);
  if (params.supplierId) p.set("supplierId", params.supplierId);
  p.set("format", "csv");

  const token = localStorage.getItem(TOKEN_KEY);
  const locationId = localStorage.getItem(ACTIVE_LOCATION_KEY);
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (locationId) headers["x-location-id"] = locationId;

  const res = await fetch(`${API_BASE}/reports/${endpoint}?${p.toString()}`, { headers });
  if (!res.ok) throw new Error("Failed to download CSV report");

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
