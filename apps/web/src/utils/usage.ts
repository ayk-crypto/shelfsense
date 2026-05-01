import type { StockMovement, StockSummaryItem } from "../types";

export interface UsageInsight {
  itemId: string;
  itemName: string;
  totalQuantity: number;
  estimatedValue: number;
  averageDailyUsage: number;
}

export interface StockForecast {
  itemId: string;
  itemName: string;
  currentQuantity: number;
  averageDailyUsage: number;
  estimatedDaysRemaining: number;
}

export type ForecastTone = "critical" | "warning" | "normal";

export function getLastSevenDaysRange() {
  const today = new Date();
  const from = new Date(today);
  from.setDate(today.getDate() - 6);

  return {
    fromDate: toYMD(from),
    toDate: toYMD(today),
  };
}

export function getUsageInsights(movements: StockMovement[]): UsageInsight[] {
  const insightsByItem = new Map<string, UsageInsight>();

  for (const movement of movements) {
    const previous = insightsByItem.get(movement.item.id) ?? {
      itemId: movement.item.id,
      itemName: movement.item.name,
      totalQuantity: 0,
      estimatedValue: 0,
      averageDailyUsage: 0,
    };
    const totalQuantity = previous.totalQuantity + movement.quantity;

    insightsByItem.set(movement.item.id, {
      ...previous,
      totalQuantity,
      estimatedValue: previous.estimatedValue + movement.quantity * (movement.unitCost ?? 0),
      averageDailyUsage: totalQuantity / 7,
    });
  }

  return [...insightsByItem.values()].sort(
    (first, second) => second.totalQuantity - first.totalQuantity,
  );
}

export function getEstimatedDaysRemaining(
  currentQuantity: number,
  averageDailyUsage: number,
) {
  return currentQuantity / averageDailyUsage;
}

export function getForecastTone(estimatedDaysRemaining: number): ForecastTone {
  if (estimatedDaysRemaining <= 2) return "critical";
  if (estimatedDaysRemaining <= 5) return "warning";
  return "normal";
}

export function getStockForecast(
  summary: StockSummaryItem[],
  usageInsights: UsageInsight[],
): StockForecast[] {
  const usageByItemId = new Map(usageInsights.map((usage) => [usage.itemId, usage]));

  return summary
    .map((item) => {
      const usage = usageByItemId.get(item.itemId);
      if (!usage || usage.averageDailyUsage <= 0) return null;

      return {
        itemId: item.itemId,
        itemName: item.itemName,
        currentQuantity: item.totalQuantity,
        averageDailyUsage: usage.averageDailyUsage,
        estimatedDaysRemaining: getEstimatedDaysRemaining(
          item.totalQuantity,
          usage.averageDailyUsage,
        ),
      };
    })
    .filter((item): item is StockForecast => item !== null)
    .sort(
      (first, second) =>
        first.estimatedDaysRemaining - second.estimatedDaysRemaining,
    );
}

function toYMD(date: Date) {
  return date.toISOString().slice(0, 10);
}
