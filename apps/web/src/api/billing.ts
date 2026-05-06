import { apiClient } from "./client";

export interface BillingSubscription {
  id: string;
  status: string;
  billingCycle: string;
  amount: number;
  currency: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  nextRenewalAt: string | null;
  nextBillingAt: string | null;
  cancelAtPeriodEnd: boolean;
  manualNotes: string | null;
  gatewayProvider: string | null;
  gatewayStatus: string | null;
  createdAt: string;
  plan: {
    id: string;
    name: string;
    code: string;
    monthlyPrice: number;
    annualPrice: number;
    currency: string;
    maxUsers: number | null;
    maxLocations: number | null;
    maxItems: number | null;
    enableAdvancedReports: boolean;
    enableCustomRoles: boolean;
    enablePurchases: boolean;
    enableSuppliers: boolean;
    enableTeamManagement: boolean;
  };
  coupon: {
    id: string;
    code: string;
    name: string;
    discountType: string;
    discountValue: number;
  } | null;
  payments: Array<{
    id: string;
    amount: number;
    currency: string;
    paymentMethod: string;
    status: string;
    paidAt: string | null;
    referenceNumber: string | null;
    createdAt: string;
  }>;
}

export function getBillingSubscription(): Promise<{ subscription: BillingSubscription | null; provider: string }> {
  return apiClient.get("/billing/subscription");
}

export function getBillingSubscriptionByWorkspace(workspaceId: string): Promise<{ subscription: BillingSubscription | null; provider: string }> {
  return apiClient.get(`/billing/subscription/${workspaceId}`);
}

export function initiateCheckout(params: {
  planId: string;
  billingCycle: "MONTHLY" | "ANNUAL";
  couponCode?: string;
}): Promise<{
  ok: boolean;
  isFree: boolean;
  checkoutUrl?: string;
  subscriptionId: string;
  paymentId?: string;
  amount?: number;
  currency?: string;
  status?: string;
}> {
  return apiClient.post("/billing/checkout", params);
}

export function initiatePaddleCheckout(params: {
  planCode: string;
  billingCycle: "MONTHLY" | "ANNUAL";
}): Promise<{
  success: boolean;
  priceId: string;
  customerEmail: string;
  customData: {
    workspaceId: string;
    userId: string;
    planCode: string;
    billingCycle: string;
  };
}> {
  return apiClient.post("/billing/paddle/checkout", params);
}

export function simulateMockPayment(params: {
  token: string;
  paymentId: string;
  subscriptionId: string;
  action: "pay" | "cancel";
}): Promise<{ ok: boolean; status: string; idempotent?: boolean }> {
  return apiClient.post("/billing/webhooks/mock", params);
}

export function getBillingInvoices(): Promise<{
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    amount: number;
    currency: string;
    status: string;
    issuedAt: string;
    dueAt: string | null;
    paidAt: string | null;
    createdAt: string;
  }>;
}> {
  return apiClient.get("/billing/invoices");
}
