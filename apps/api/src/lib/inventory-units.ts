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

export type ReplenishmentMode = "MANUAL_THRESHOLD" | "DAYS_BASED";

export type ReplenishmentStatus =
  | "HEALTHY"
  | "REORDER_REQUIRED"
  | "ON_ORDER_COVERED"
  | "ON_ORDER_SHORTAGE_RISK"
  | "ADDITIONAL_QTY_REQUIRED"
  | "OVERDUE_DELIVERY"
  | "NO_USAGE_DATA"
  | "CONFIGURATION_REQUIRED";

export interface IncomingPurchaseLine {
  purchaseId: string;
  poReference: string;
  supplierName: string | null;
  status: string;
  orderedBaseQty: number;
  receivedBaseQty: number;
  baseUnitSnapshot?: string | null;
  purchaseUnitSnapshot?: string | null;
  purchaseConversionFactorSnapshot?: number | null;
  unitSnapshotSource?: string | null;
  expectedDeliveryDate: Date | null;
}

export interface IncomingPurchaseSummary {
  incomingBuyingQty: number;
  incomingBaseQty: number;
  earliestExpectedDeliveryDate: Date | null;
  overdueLines: IncomingPurchaseLine[];
  lines: Array<IncomingPurchaseLine & {
    outstandingBuyingQty: number | null;
    outstandingBaseQty: number;
    conversionUnavailable: boolean;
  }>;
}

export interface ReplenishmentInput {
  mode: ReplenishmentMode;
  currentStockBaseQty: number;
  averageDailyUsageBaseQty: number | null;
  hasUsageHistory: boolean;
  supplierLeadTimeDays: number | null;
  safetyStockDays: number | null;
  reviewPeriodDays: number | null;
  lowStockThresholdBaseQty: number;
  manualReorderPointBaseQty: number | null;
  manualTargetStockBaseQty: number | null;
  purchaseUnit: string | null;
  baseUnit: string;
  purchaseConversionFactor: number | null;
  allowFractionalPurchaseUnit: boolean;
  incoming: IncomingPurchaseSummary;
  today: Date;
}

export interface ReplenishmentMetrics {
  mode: ReplenishmentMode;
  averageDailyUsageBaseQty: number | null;
  supplierLeadTimeDays: number | null;
  safetyStockDays: number | null;
  reviewPeriodDays: number | null;
  reorderPointBaseQty: number | null;
  targetStockBaseQty: number | null;
  currentStockBaseQty: number;
  incomingBaseQty: number;
  incomingBuyingQty: number;
  projectedStockAtDeliveryBaseQty: number | null;
  daysUntilStockout: number | null;
  expectedStockoutDate: string | null;
  earliestExpectedDeliveryDate: string | null;
  requiredBaseQty: number | null;
  suggestedBuyingQty: number | null;
  suggestedBaseQty: number | null;
  additionalSuggestedBuyingQty: number | null;
  status: ReplenishmentStatus;
  statusLabel: string;
  configurationIssues: string[];
  purchaseOrders: IncomingPurchaseSummary["lines"];
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

export function summarizeIncomingPurchaseLines(
  lines: IncomingPurchaseLine[],
  config: UnitConfig,
  today = new Date(),
): IncomingPurchaseSummary {
  const normalized = normalizeUnitConfig(config);
  const normalizedLines = normalized.conversionRequired ? [] : lines
    .map((line) => {
      const outstandingBaseQty = Math.max(0, line.orderedBaseQty - line.receivedBaseQty);
      const lineFactor = line.purchaseConversionFactorSnapshot && line.purchaseConversionFactorSnapshot > 0
        ? line.purchaseConversionFactorSnapshot
        : null;
      const fallbackFactor = line.purchaseUnitSnapshot ? null : (normalized.conversionFactor ?? 1);
      const factor = lineFactor ?? fallbackFactor;
      return {
        ...line,
        outstandingBuyingQty: factor && factor > 0 ? outstandingBaseQty / factor : null,
        outstandingBaseQty,
        conversionUnavailable: factor === null || factor <= 0,
      };
    })
    .filter((line) => line.outstandingBaseQty > 0);

  const incomingBaseQty = normalizedLines.reduce((total, line) => total + line.outstandingBaseQty, 0);
  const incomingBuyingQty = normalizedLines.reduce((total, line) => total + (line.outstandingBuyingQty ?? 0), 0);
  const earliestExpectedDeliveryDate = normalizedLines
    .map((line) => line.expectedDeliveryDate)
    .filter((date): date is Date => date !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const dayStart = startOfDay(today);
  const overdueLines = normalizedLines.filter((line) => line.expectedDeliveryDate !== null && startOfDay(line.expectedDeliveryDate) < dayStart);

  return {
    incomingBuyingQty,
    incomingBaseQty,
    earliestExpectedDeliveryDate,
    overdueLines,
    lines: normalizedLines,
  };
}

export function calculateReplenishment(input: ReplenishmentInput): ReplenishmentMetrics {
  const config = normalizeUnitConfig({
    baseUnit: input.baseUnit,
    buyingUnit: input.purchaseUnit,
    conversionFactor: input.purchaseConversionFactor,
  });
  const configurationIssues: string[] = [];
  if (config.conversionRequired) configurationIssues.push("Unit conversion required");

  const factor = config.conversionFactor ?? 1;
  const hasIncoming = input.incoming.incomingBaseQty > 0;
  const earliestDelivery = input.incoming.earliestExpectedDeliveryDate;
  const daysUntilDelivery = earliestDelivery ? Math.max(0, diffDays(input.today, earliestDelivery)) : input.supplierLeadTimeDays;
  const daysUntilStockout =
    input.averageDailyUsageBaseQty && input.averageDailyUsageBaseQty > 0
      ? input.currentStockBaseQty / input.averageDailyUsageBaseQty
      : null;
  const expectedStockoutDate =
    daysUntilStockout !== null ? addDays(input.today, daysUntilStockout).toISOString() : null;
  const projectedStockAtDeliveryBaseQty =
    input.averageDailyUsageBaseQty !== null && input.averageDailyUsageBaseQty > 0 && daysUntilDelivery !== null
      ? input.currentStockBaseQty - input.averageDailyUsageBaseQty * daysUntilDelivery + input.incoming.incomingBaseQty
      : null;

  if (input.incoming.overdueLines.length > 0) {
    return buildReplenishmentResult(input, {
      reorderPointBaseQty: null,
      targetStockBaseQty: null,
      requiredBaseQty: null,
      suggestedBuyingQty: null,
      suggestedBaseQty: null,
      projectedStockAtDeliveryBaseQty,
      daysUntilStockout,
      expectedStockoutDate,
      status: "OVERDUE_DELIVERY",
      configurationIssues,
    });
  }

  if (input.mode === "MANUAL_THRESHOLD") {
    const reorderPointBaseQty = input.manualReorderPointBaseQty ?? input.lowStockThresholdBaseQty;
    const targetStockBaseQty = input.manualTargetStockBaseQty ?? input.lowStockThresholdBaseQty;
    const requiredBaseQty = Math.max(0, targetStockBaseQty - input.currentStockBaseQty - input.incoming.incomingBaseQty);
    const suggestedBuyingQty = toSuggestedBuyingQty(requiredBaseQty, factor, input.allowFractionalPurchaseUnit);
    const status: ReplenishmentStatus =
      input.currentStockBaseQty <= reorderPointBaseQty && requiredBaseQty > 0
        ? hasIncoming ? "ADDITIONAL_QTY_REQUIRED" : "REORDER_REQUIRED"
        : hasIncoming ? "ON_ORDER_COVERED" : "HEALTHY";

    return buildReplenishmentResult(input, {
      reorderPointBaseQty,
      targetStockBaseQty,
      requiredBaseQty,
      suggestedBuyingQty,
      suggestedBaseQty: suggestedBuyingQty === null ? null : suggestedBuyingQty * factor,
      projectedStockAtDeliveryBaseQty,
      daysUntilStockout,
      expectedStockoutDate,
      status,
      configurationIssues,
    });
  }

  if (!input.hasUsageHistory) {
    return buildReplenishmentResult(input, {
      reorderPointBaseQty: null,
      targetStockBaseQty: null,
      requiredBaseQty: null,
      suggestedBuyingQty: null,
      suggestedBaseQty: null,
      projectedStockAtDeliveryBaseQty,
      daysUntilStockout,
      expectedStockoutDate,
      status: "NO_USAGE_DATA",
      configurationIssues,
    });
  }

  if (!input.averageDailyUsageBaseQty || input.averageDailyUsageBaseQty <= 0) {
    configurationIssues.push("Average daily usage is zero");
  }
  if (input.supplierLeadTimeDays === null || input.supplierLeadTimeDays < 0) configurationIssues.push("Lead time required");
  if (input.safetyStockDays === null || input.safetyStockDays < 0) configurationIssues.push("Safety stock days required");
  if (input.reviewPeriodDays === null || input.reviewPeriodDays <= 0) configurationIssues.push("Review period required");

  if (configurationIssues.length > 0) {
    return buildReplenishmentResult(input, {
      reorderPointBaseQty: null,
      targetStockBaseQty: null,
      requiredBaseQty: null,
      suggestedBuyingQty: null,
      suggestedBaseQty: null,
      projectedStockAtDeliveryBaseQty,
      daysUntilStockout,
      expectedStockoutDate,
      status: "CONFIGURATION_REQUIRED",
      configurationIssues,
    });
  }

  const avg = input.averageDailyUsageBaseQty!;
  const lead = input.supplierLeadTimeDays!;
  const safety = input.safetyStockDays!;
  const review = input.reviewPeriodDays!;
  const calculatedReorderPoint = avg * (lead + safety);
  const calculatedTarget = avg * (lead + safety + review);
  const reorderPointBaseQty = input.manualReorderPointBaseQty ?? calculatedReorderPoint;
  const targetStockBaseQty = input.manualTargetStockBaseQty ?? calculatedTarget;

  if (targetStockBaseQty < reorderPointBaseQty) {
    configurationIssues.push("Target stock must be greater than or equal to reorder point");
    return buildReplenishmentResult(input, {
      reorderPointBaseQty,
      targetStockBaseQty,
      requiredBaseQty: null,
      suggestedBuyingQty: null,
      suggestedBaseQty: null,
      projectedStockAtDeliveryBaseQty,
      daysUntilStockout,
      expectedStockoutDate,
      status: "CONFIGURATION_REQUIRED",
      configurationIssues,
    });
  }

  const requiredBaseQty = Math.max(0, targetStockBaseQty - input.currentStockBaseQty - input.incoming.incomingBaseQty);
  const suggestedBuyingQty = toSuggestedBuyingQty(requiredBaseQty, factor, input.allowFractionalPurchaseUnit);
  const suggestedBaseQty = suggestedBuyingQty === null ? null : suggestedBuyingQty * factor;
  const stockPositionAtOrBelowReorderPoint = input.currentStockBaseQty + input.incoming.incomingBaseQty <= reorderPointBaseQty;
  const incomingCoversTarget = input.currentStockBaseQty + input.incoming.incomingBaseQty >= targetStockBaseQty;
  const shortageRisk = projectedStockAtDeliveryBaseQty !== null && projectedStockAtDeliveryBaseQty <= 0;

  let status: ReplenishmentStatus = "HEALTHY";
  if (hasIncoming && shortageRisk) status = "ON_ORDER_SHORTAGE_RISK";
  else if (hasIncoming && !incomingCoversTarget) status = "ADDITIONAL_QTY_REQUIRED";
  else if (hasIncoming && incomingCoversTarget) status = "ON_ORDER_COVERED";
  else if (stockPositionAtOrBelowReorderPoint || requiredBaseQty > 0) status = "REORDER_REQUIRED";

  return buildReplenishmentResult(input, {
    reorderPointBaseQty,
    targetStockBaseQty,
    requiredBaseQty,
    suggestedBuyingQty,
    suggestedBaseQty,
    projectedStockAtDeliveryBaseQty,
    daysUntilStockout,
    expectedStockoutDate,
    status,
    configurationIssues,
  });
}

function buildReplenishmentResult(
  input: ReplenishmentInput,
  values: {
    reorderPointBaseQty: number | null;
    targetStockBaseQty: number | null;
    requiredBaseQty: number | null;
    suggestedBuyingQty: number | null;
    suggestedBaseQty: number | null;
    projectedStockAtDeliveryBaseQty: number | null;
    daysUntilStockout: number | null;
    expectedStockoutDate: string | null;
    status: ReplenishmentStatus;
    configurationIssues: string[];
  },
): ReplenishmentMetrics {
  return {
    mode: input.mode,
    averageDailyUsageBaseQty: input.averageDailyUsageBaseQty,
    supplierLeadTimeDays: input.supplierLeadTimeDays,
    safetyStockDays: input.safetyStockDays,
    reviewPeriodDays: input.reviewPeriodDays,
    reorderPointBaseQty: values.reorderPointBaseQty,
    targetStockBaseQty: values.targetStockBaseQty,
    currentStockBaseQty: input.currentStockBaseQty,
    incomingBaseQty: input.incoming.incomingBaseQty,
    incomingBuyingQty: input.incoming.incomingBuyingQty,
    projectedStockAtDeliveryBaseQty: values.projectedStockAtDeliveryBaseQty,
    daysUntilStockout: values.daysUntilStockout,
    expectedStockoutDate: values.expectedStockoutDate,
    earliestExpectedDeliveryDate: input.incoming.earliestExpectedDeliveryDate?.toISOString() ?? null,
    requiredBaseQty: values.requiredBaseQty,
    suggestedBuyingQty: values.suggestedBuyingQty,
    suggestedBaseQty: values.suggestedBaseQty,
    additionalSuggestedBuyingQty: values.suggestedBuyingQty,
    status: values.status,
    statusLabel: statusLabel(values.status),
    configurationIssues: values.configurationIssues,
    purchaseOrders: input.incoming.lines,
  };
}

function toSuggestedBuyingQty(requiredBaseQty: number, factor: number, allowFractional: boolean) {
  if (requiredBaseQty <= 0) return 0;
  if (factor <= 0) return null;
  const raw = requiredBaseQty / factor;
  return allowFractional ? raw : Math.ceil(raw);
}

function statusLabel(status: ReplenishmentStatus) {
  switch (status) {
    case "REORDER_REQUIRED": return "Reorder required";
    case "ON_ORDER_COVERED": return "On order";
    case "ON_ORDER_SHORTAGE_RISK": return "Stockout risk before delivery";
    case "ADDITIONAL_QTY_REQUIRED": return "Additional quantity required";
    case "OVERDUE_DELIVERY": return "Delivery overdue";
    case "NO_USAGE_DATA": return "Usage data required";
    case "CONFIGURATION_REQUIRED": return "Configuration required";
    default: return "Healthy";
  }
}

function diffDays(from: Date, to: Date) {
  return (startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000;
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86_400_000);
}

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
