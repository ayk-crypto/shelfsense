export interface UnitConfig {
  baseUnit: string;
  buyingUnit: string | null;
  conversionFactor: number | null;
}

export interface StockUnitBreakdown {
  baseQuantity: number;
  baseUnit: string;
  buyingUnit: string;
  conversionFactor: number;
  buyingQuantity: number;
  fullBuyingUnits: number;
  remainingBaseUnits: number;
  usesBuyingUnit: boolean;
  conversionRequired: boolean;
}

export interface UsageMetrics {
  last7DaysBaseQuantity: number | null;
  last7DaysBuyingQuantity: number | null;
  averageDailyBaseQuantity: number | null;
  averageDailyBuyingQuantity: number | null;
  hasUsageHistory: boolean;
}

export interface CoverageMetrics {
  daysRemaining: number | null;
  status: "OK" | "LOW_STOCK" | "OUT_OF_STOCK" | "NEGATIVE_STOCK" | "CONVERSION_REQUIRED" | "NO_USAGE_DATA" | "NO_RECENT_USAGE";
  calculationAvailable: boolean;
  message: string | null;
}

export interface ReorderMetrics {
  targetBaseQuantity: number;
  requiredBaseQuantity: number | null;
  incomingBaseQuantity: number | null;
  incomingBuyingQuantity: number | null;
  suggestedBuyingQuantity: number | null;
  suggestedBaseQuantity: number | null;
  calculationAvailable: boolean;
}

export function normalizeUnitConfig(config: UnitConfig) {
  const baseUnit = config.baseUnit.trim();
  const buyingUnit = config.buyingUnit?.trim() || baseUnit;
  const usesBuyingUnit = buyingUnit.toLowerCase() !== baseUnit.toLowerCase();
  const conversionFactor = usesBuyingUnit ? config.conversionFactor : 1;
  const conversionRequired = usesBuyingUnit && (!conversionFactor || conversionFactor <= 0);

  return {
    baseUnit,
    buyingUnit,
    usesBuyingUnit,
    conversionFactor: conversionRequired ? null : conversionFactor ?? 1,
    conversionRequired,
  };
}

export function buildStockBreakdown(baseQuantity: number, config: UnitConfig): StockUnitBreakdown {
  const normalized = normalizeUnitConfig(config);
  const factor = normalized.conversionFactor ?? 1;
  const buyingQuantity = normalized.conversionRequired ? 0 : baseQuantity / factor;
  const fullBuyingUnits = normalized.conversionRequired ? 0 : Math.trunc(baseQuantity / factor);
  const remainingBaseUnits = normalized.conversionRequired
    ? baseQuantity
    : roundQuantity(baseQuantity - fullBuyingUnits * factor);

  return {
    baseQuantity,
    baseUnit: normalized.baseUnit,
    buyingUnit: normalized.buyingUnit,
    conversionFactor: factor,
    buyingQuantity,
    fullBuyingUnits,
    remainingBaseUnits,
    usesBuyingUnit: normalized.usesBuyingUnit,
    conversionRequired: normalized.conversionRequired,
  };
}

export function buildUsageMetrics(
  last7DaysBaseQuantity: number | null,
  hasUsageHistory: boolean,
  config: UnitConfig,
): UsageMetrics {
  const normalized = normalizeUnitConfig(config);
  if (normalized.conversionRequired || last7DaysBaseQuantity === null) {
    return {
      last7DaysBaseQuantity,
      last7DaysBuyingQuantity: null,
      averageDailyBaseQuantity: last7DaysBaseQuantity === null ? null : last7DaysBaseQuantity / 7,
      averageDailyBuyingQuantity: null,
      hasUsageHistory,
    };
  }

  const averageDailyBaseQuantity = last7DaysBaseQuantity / 7;
  return {
    last7DaysBaseQuantity,
    last7DaysBuyingQuantity: last7DaysBaseQuantity / (normalized.conversionFactor ?? 1),
    averageDailyBaseQuantity,
    averageDailyBuyingQuantity: averageDailyBaseQuantity / (normalized.conversionFactor ?? 1),
    hasUsageHistory,
  };
}

export function calculateCoverage(
  currentStockBaseQty: number,
  averageDailyUsageBaseQty: number | null,
  hasUsageHistory: boolean,
  conversionRequired: boolean,
  isLowStock: boolean,
): CoverageMetrics {
  if (conversionRequired) {
    return { daysRemaining: null, status: "CONVERSION_REQUIRED", calculationAvailable: false, message: "Conversion required" };
  }
  if (!hasUsageHistory) {
    return { daysRemaining: null, status: "NO_USAGE_DATA", calculationAvailable: false, message: "No usage data" };
  }
  if (averageDailyUsageBaseQty === null || averageDailyUsageBaseQty <= 0) {
    return { daysRemaining: null, status: "NO_RECENT_USAGE", calculationAvailable: false, message: "No recent usage" };
  }
  if (currentStockBaseQty < 0) {
    return {
      daysRemaining: currentStockBaseQty / averageDailyUsageBaseQty,
      status: "NEGATIVE_STOCK",
      calculationAvailable: true,
      message: "Stock issue",
    };
  }
  if (currentStockBaseQty === 0) {
    return { daysRemaining: 0, status: "OUT_OF_STOCK", calculationAvailable: true, message: null };
  }

  return {
    daysRemaining: currentStockBaseQty / averageDailyUsageBaseQty,
    status: isLowStock ? "LOW_STOCK" : "OK",
    calculationAvailable: true,
    message: null,
  };
}

export function calculateReorder(
  targetStockBaseQty: number,
  availableBaseQty: number,
  incomingBuyingQty: number,
  config: UnitConfig,
  options: { isActive: boolean; requiresReplenishment: boolean },
): ReorderMetrics {
  const normalized = normalizeUnitConfig(config);
  const unavailable: ReorderMetrics = {
    targetBaseQuantity: targetStockBaseQty,
    requiredBaseQuantity: null,
    incomingBaseQuantity: null,
    incomingBuyingQuantity: incomingBuyingQty,
    suggestedBuyingQuantity: null,
    suggestedBaseQuantity: null,
    calculationAvailable: false,
  };

  if (!options.isActive || !options.requiresReplenishment || normalized.conversionRequired) {
    return unavailable;
  }

  const factor = normalized.conversionFactor ?? 1;
  const incomingBaseQuantity = incomingBuyingQty * factor;
  const requiredBaseQuantity = Math.max(0, targetStockBaseQty - availableBaseQty - incomingBaseQuantity);
  const suggestedBuyingQuantity = requiredBaseQuantity > 0 ? Math.ceil(requiredBaseQuantity / factor) : 0;

  return {
    targetBaseQuantity: targetStockBaseQty,
    requiredBaseQuantity,
    incomingBaseQuantity,
    incomingBuyingQuantity: incomingBuyingQty,
    suggestedBuyingQuantity,
    suggestedBaseQuantity: suggestedBuyingQuantity * factor,
    calculationAvailable: true,
  };
}

export function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
