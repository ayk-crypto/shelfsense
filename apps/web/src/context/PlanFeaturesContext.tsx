import { createContext, useContext } from "react";
import type { CurrentSubscriptionPlan } from "../types";

export interface PlanFeatures {
  enablePurchases: boolean;
  enableSuppliers: boolean;
  enableTeamManagement: boolean;
  enableCustomRoles: boolean;
  enableAdvancedReports: boolean;
  enableEmailAlerts: boolean;
  enableDailyOps: boolean;
  enableReports: boolean;
  enableExpiryTracking: boolean;
  enableBarcodeScanning: boolean;
  planCode: string;
  planName: string;
  isLoading: boolean;
}

const FREE_FEATURES: PlanFeatures = {
  enablePurchases: false,
  enableSuppliers: false,
  enableTeamManagement: false,
  enableCustomRoles: false,
  enableAdvancedReports: false,
  enableEmailAlerts: false,
  enableDailyOps: false,
  enableReports: true,
  enableExpiryTracking: true,
  enableBarcodeScanning: true,
  planCode: "FREE",
  planName: "Free",
  isLoading: false,
};

export function planFeaturesFromSubscription(
  plan: CurrentSubscriptionPlan | null | undefined,
  isLoading = false,
): PlanFeatures {
  if (!plan) return { ...FREE_FEATURES, isLoading };
  return {
    enablePurchases: plan.enablePurchases,
    enableSuppliers: plan.enableSuppliers,
    enableTeamManagement: plan.enableTeamManagement,
    enableCustomRoles: plan.enableCustomRoles,
    enableAdvancedReports: plan.enableAdvancedReports,
    enableEmailAlerts: plan.enableEmailAlerts,
    enableDailyOps: plan.enableDailyOps,
    enableReports: plan.enableReports,
    enableExpiryTracking: plan.enableExpiryTracking,
    enableBarcodeScanning: plan.enableBarcodeScanning,
    planCode: plan.code,
    planName: plan.name,
    isLoading,
  };
}

export const REQUIRED_PLAN: Record<keyof Omit<PlanFeatures, "planCode" | "planName" | "isLoading">, string> = {
  enablePurchases: "Basic",
  enableSuppliers: "Basic",
  enableTeamManagement: "Basic",
  enableCustomRoles: "Pro",
  enableAdvancedReports: "Pro",
  enableEmailAlerts: "Basic",
  enableDailyOps: "Basic",
  enableReports: "Basic",
  enableExpiryTracking: "Basic",
  enableBarcodeScanning: "Basic",
};

export const PlanFeaturesContext = createContext<PlanFeatures>({ ...FREE_FEATURES, isLoading: true });

export function usePlanFeatures(): PlanFeatures {
  return useContext(PlanFeaturesContext);
}
