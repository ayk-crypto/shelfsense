import type { ReplenishmentMetrics } from "./inventory-units.js";

const DAY_MS = 86_400_000;

export const REORDER_USAGE_LOOKBACK_DAYS = 60;
export const MIN_USAGE_SMOOTHING_DAYS = 7;

export interface UsageMovementSample {
  quantity: number;
  createdAt: Date;
}

export interface UsageProfile {
  totalUsageBaseQty: number;
  averageDailyUsageBaseQty: number;
  estimatedMonthlyUsageBaseQty: number;
  historyDays: number;
  lookbackDays: number;
}

/**
 * Builds a stable demand rate for procurement planning.
 *
 * The old reorder endpoint used only the latest seven days and always divided by
 * seven. A single busy week could therefore inflate a monthly purchase order.
 * This profile uses up to sixty days of real usage and divides by the elapsed
 * history window, with a seven-day minimum to avoid extrapolating one busy day
 * into a full month.
 */
export function calculateUsageProfile(
  movements: UsageMovementSample[],
  today: Date,
  lookbackDays = REORDER_USAGE_LOOKBACK_DAYS,
): UsageProfile | null {
  const safeLookbackDays = Math.max(1, Math.floor(lookbackDays));
  const windowStart = startOfDay(new Date(today.getTime() - (safeLookbackDays - 1) * DAY_MS));
  const validMovements = movements.filter((movement) => (
    Number.isFinite(movement.quantity) &&
    movement.quantity > 0 &&
    movement.createdAt instanceof Date &&
    !Number.isNaN(movement.createdAt.getTime()) &&
    movement.createdAt >= windowStart &&
    movement.createdAt <= today
  ));

  if (validMovements.length === 0) return null;

  const totalUsageBaseQty = validMovements.reduce((sum, movement) => sum + movement.quantity, 0);
  const firstUsageDate = validMovements.reduce(
    (earliest, movement) => movement.createdAt < earliest ? movement.createdAt : earliest,
    validMovements[0]!.createdAt,
  );
  const elapsedDays = Math.floor((startOfDay(today).getTime() - startOfDay(firstUsageDate).getTime()) / DAY_MS) + 1;
  const historyDays = Math.min(
    safeLookbackDays,
    Math.max(MIN_USAGE_SMOOTHING_DAYS, elapsedDays),
  );
  const averageDailyUsageBaseQty = totalUsageBaseQty / historyDays;

  return {
    totalUsageBaseQty,
    averageDailyUsageBaseQty,
    estimatedMonthlyUsageBaseQty: averageDailyUsageBaseQty * 30,
    historyDays,
    lookbackDays: safeLookbackDays,
  };
}

/**
 * Makes Procurement Frequency the source of truth for the order cycle. The
 * explicit review-period value remains a backwards-compatible fallback.
 */
export function resolvePlanningCycleDays(
  procurementFrequency: string | null,
  customFrequencyDays: number | null,
  configuredReviewPeriodDays: number | null,
): number | null {
  switch (procurementFrequency?.toLowerCase()) {
    case "daily":
      return 1;
    case "weekly":
      return 7;
    case "biweekly":
      return 14;
    case "monthly":
      return 30;
    case "custom":
      return customFrequencyDays !== null && customFrequencyDays > 0
        ? customFrequencyDays
        : configuredReviewPeriodDays;
    default:
      return configuredReviewPeriodDays;
  }
}

/**
 * A target stock level is the level to refill to after a reorder is triggered;
 * it is not itself a reorder trigger. This prevents items above their reorder
 * point from appearing on the PO worksheet merely because they are below the
 * calculated monthly target.
 */
export function normalizeReorderAction(metrics: ReplenishmentMetrics): ReplenishmentMetrics {
  if (metrics.mode !== "DAYS_BASED") return metrics;

  if ([
    "OVERDUE_DELIVERY",
    "ON_ORDER_SHORTAGE_RISK",
    "NO_USAGE_DATA",
    "CONFIGURATION_REQUIRED",
  ].includes(metrics.status)) {
    return metrics;
  }

  const requiredBaseQty = metrics.requiredBaseQty ?? 0;
  const stockPositionBaseQty = metrics.currentStockBaseQty + metrics.incomingBaseQty;
  const reorderTriggered = metrics.reorderPointBaseQty !== null &&
    stockPositionBaseQty <= metrics.reorderPointBaseQty &&
    requiredBaseQty > 0;

  if (metrics.incomingBaseQty > 0) {
    if (reorderTriggered) {
      return {
        ...metrics,
        status: "ADDITIONAL_QTY_REQUIRED",
        statusLabel: "Additional quantity required",
      };
    }

    return clearSuggestedQuantity(metrics, "ON_ORDER_COVERED", "On order");
  }

  if (reorderTriggered) {
    return {
      ...metrics,
      status: "REORDER_REQUIRED",
      statusLabel: "Reorder required",
    };
  }

  return clearSuggestedQuantity(metrics, "HEALTHY", "Healthy");
}

function clearSuggestedQuantity(
  metrics: ReplenishmentMetrics,
  status: "HEALTHY" | "ON_ORDER_COVERED",
  statusLabel: string,
): ReplenishmentMetrics {
  return {
    ...metrics,
    requiredBaseQty: 0,
    suggestedBuyingQty: 0,
    suggestedBaseQty: 0,
    additionalSuggestedBuyingQty: 0,
    status,
    statusLabel,
  };
}

function startOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}
