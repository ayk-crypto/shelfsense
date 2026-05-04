export type PlanTier = "FREE" | "BASIC" | "PRO";

export interface PlanLimits {
  maxItems: number;
  maxLocations: number;
  maxUsers: number;
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  FREE:  { maxItems: 50,   maxLocations: 1,  maxUsers: 3  },
  BASIC: { maxItems: 500,  maxLocations: 5,  maxUsers: 10 },
  PRO:   { maxItems: -1,   maxLocations: -1, maxUsers: -1 },
};

export const PLAN_LABELS: Record<PlanTier, string> = {
  FREE:  "Free",
  BASIC: "Basic",
  PRO:   "Pro",
};

export function isUnlimited(limit: number): boolean {
  return limit === -1;
}

export function isAtLimit(current: number, max: number): boolean {
  if (isUnlimited(max)) return false;
  return current >= max;
}

export function formatLimit(max: number): string {
  return isUnlimited(max) ? "Unlimited" : max.toLocaleString();
}
