import { apiClient } from "./client";
import type {
  InvoiceUpload,
  InvoiceUploadFull,
  InvoiceLine,
} from "../types";

const API_BASE = import.meta.env.VITE_API_BASE_URL?.trim() || "/api";
const TOKEN_KEY = "shelfsense_token";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function checkOcrStatus(): Promise<{ available: boolean }> {
  return apiClient.get<{ available: boolean }>("/receiving/ocr-status");
}

export async function uploadInvoice(
  file: File,
  purchaseOrderId?: string,
): Promise<{ invoiceUpload: InvoiceUpload }> {
  const form = new FormData();
  form.append("invoice", file);
  if (purchaseOrderId) form.append("purchaseOrderId", purchaseOrderId);

  const res = await fetch(`${API_BASE}/receiving/invoices/upload`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: form,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? "Upload failed");
  }
  return res.json();
}

export async function extractInvoice(
  invoiceId: string,
): Promise<{ invoiceUpload: InvoiceUploadFull }> {
  return apiClient.post<{ invoiceUpload: InvoiceUploadFull }>(
    `/receiving/invoices/${invoiceId}/extract`,
    {},
    true,
  );
}

export async function matchInvoiceLines(
  invoiceId: string,
  purchaseOrderId?: string,
): Promise<{ invoiceUpload: InvoiceUploadFull }> {
  return apiClient.post<{ invoiceUpload: InvoiceUploadFull }>(
    `/receiving/invoices/${invoiceId}/match`,
    { purchaseOrderId },
    true,
  );
}

export async function getInvoice(
  invoiceId: string,
): Promise<{ invoiceUpload: InvoiceUploadFull }> {
  return apiClient.get<{ invoiceUpload: InvoiceUploadFull }>(
    `/receiving/invoices/${invoiceId}`,
  );
}

export async function updateInvoiceLine(
  lineId: string,
  updates: Partial<{
    userConfirmedItemId: string;
    userConfirmedPurchaseItemId: string;
    userEditedQty: number;
    userEditedUnitCostExclTax: number;
    userEditedUnitTax: number;
    userEditedUnitCostInclTax: number;
    userEditedBatchNo: string;
    userEditedExpiryDate: string;
    userAction: string;
    matchStatus: string;
  }>,
): Promise<{ line: InvoiceLine }> {
  return apiClient.patch<{ line: InvoiceLine }>(
    `/receiving/invoice-lines/${lineId}`,
    updates,
    true,
  );
}

export async function addManualInvoiceLine(
  invoiceId: string,
  line: {
    rawDescription: string;
    qty?: number;
    unitCostExclTax?: number;
    unitTax?: number;
    unitCostInclTax?: number;
    batchNo?: string;
    expiryDate?: string;
    taxMode?: string;
  },
): Promise<{ line: InvoiceLine }> {
  return apiClient.post<{ line: InvoiceLine }>(
    `/receiving/invoices/${invoiceId}/lines`,
    line,
    true,
  );
}

export async function deleteInvoiceLine(lineId: string): Promise<void> {
  return apiClient.delete<void>(`/receiving/invoice-lines/${lineId}`);
}

export async function confirmItemAlias(params: {
  invoiceItemName: string;
  inventoryItemId: string;
  supplierId?: string;
}): Promise<void> {
  return apiClient.post<void>("/receiving/aliases", params, true);
}
