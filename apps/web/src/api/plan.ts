import type { PlanStatus, PlanTier } from "../types";
import { apiClient } from "./client";

export function getPlanStatus(): Promise<PlanStatus> {
  return apiClient.get<PlanStatus>("/plan/status");
}

export function changePlan(plan: PlanTier): Promise<PlanStatus> {
  return apiClient.patch<PlanStatus>("/plan", { plan });
}
