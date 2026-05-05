import { apiClient } from "./client";
import type { PublicPlan, SubscriptionPreview, CurrentSubscription } from "../types";

export function getPublicPlans(): Promise<{ plans: PublicPlan[] }> {
  return apiClient.get("/subscriptions/plans");
}

export function getCurrentSubscription(): Promise<{ subscription: CurrentSubscription | null }> {
  return apiClient.get("/subscriptions/current");
}

export function previewSubscription(params: {
  planId: string;
  billingCycle: "MONTHLY" | "ANNUAL";
  couponCode?: string;
}): Promise<SubscriptionPreview> {
  return apiClient.post("/subscriptions/preview", params);
}

export function selectPlan(params: {
  planId: string;
  billingCycle: "MONTHLY" | "ANNUAL";
  couponCode?: string;
}): Promise<{
  ok: boolean;
  subscription: {
    id: string;
    status: string;
    billingCycle: string;
    payableAmount: number;
    pendingPayment: boolean;
    planName: string;
    planCode: string;
  };
}> {
  return apiClient.post("/subscriptions/select-plan", params);
}
