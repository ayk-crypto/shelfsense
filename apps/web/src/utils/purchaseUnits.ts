export interface PurchaseUnitBreakdown {
  whole: number;
  remainder: number;
  purchaseUnit: string;
  baseUnit: string;
}

export interface NormalizedUnitConfig {
  baseUnit: string;
  buyingUnit: string;
  conversionFactor: number;
  usesBuyingUnit: boolean;
  conversionRequired: boolean;
}

export function hasPurchaseUnit(
  purchaseUnit: string | null | undefined,
  conversionFactor: number | null | undefined,
): boolean {
  return (
    Boolean(purchaseUnit) &&
    typeof conversionFactor === "number" &&
    conversionFactor > 0
  );
}

export function normalizeUnitConfig(
  baseUnit: string,
  purchaseUnit: string | null | undefined,
  conversionFactor: number | null | undefined,
): NormalizedUnitConfig {
  const cleanBaseUnit = baseUnit.trim();
  const buyingUnit = purchaseUnit?.trim() || cleanBaseUnit;
  const usesBuyingUnit = buyingUnit.toLowerCase() !== cleanBaseUnit.toLowerCase();
  const conversionRequired = usesBuyingUnit && (typeof conversionFactor !== "number" || conversionFactor <= 0);

  return {
    baseUnit: cleanBaseUnit,
    buyingUnit,
    conversionFactor: conversionRequired ? 1 : (usesBuyingUnit ? conversionFactor! : 1),
    usesBuyingUnit,
    conversionRequired,
  };
}

export function toPurchaseQuantity(baseQty: number, conversionFactor: number): number {
  return baseQty / conversionFactor;
}

export function toBaseQuantity(purchaseQty: number, conversionFactor: number): number {
  return purchaseQty * conversionFactor;
}

export function getSuggestedPurchaseQty(shortageBaseQty: number, conversionFactor: number): number {
  if (conversionFactor <= 0 || shortageBaseQty <= 0) return 0;
  return Math.ceil(shortageBaseQty / conversionFactor);
}

export function getSuggestedBaseEquivalent(suggestedPurchaseQty: number, conversionFactor: number): number {
  return suggestedPurchaseQty * conversionFactor;
}

export function getPurchaseBreakdown(
  baseQty: number,
  conversionFactor: number,
  purchaseUnit: string,
  baseUnit: string,
): PurchaseUnitBreakdown {
  const whole = Math.floor(baseQty / conversionFactor);
  const remainder = +(baseQty - whole * conversionFactor).toFixed(6);
  return { whole, remainder, purchaseUnit, baseUnit };
}

export function formatPurchaseBreakdown(breakdown: PurchaseUnitBreakdown): string {
  const { whole, remainder, purchaseUnit, baseUnit } = breakdown;
  if (whole === 0 && remainder === 0) return formatQuantityWithUnit(0, baseUnit);
  if (whole === 0) return `${formatQuantityWithUnit(0, purchaseUnit, 0)} + ${formatQuantityWithUnit(remainder, baseUnit)}`;
  if (remainder === 0) return formatQuantityWithUnit(whole, purchaseUnit);
  return `${formatQuantityWithUnit(whole, purchaseUnit)} + ${formatQuantityWithUnit(remainder, baseUnit)}`;
}

export function getStockDisplayLines(
  baseQty: number,
  baseUnit: string,
  purchaseUnit: string | null | undefined,
  conversionFactor: number | null | undefined,
) {
  const config = normalizeUnitConfig(baseUnit, purchaseUnit, conversionFactor);
  if (config.conversionRequired) {
    return {
      primary: formatQuantityWithUnit(baseQty, config.baseUnit),
      secondary: "Unit conversion required",
      conversion: null as string | null,
      conversionRequired: true,
    };
  }
  if (!config.usesBuyingUnit) {
    return {
      primary: formatQuantityWithUnit(baseQty, config.baseUnit),
      secondary: null as string | null,
      conversion: null as string | null,
      conversionRequired: false,
    };
  }

  const breakdown = getPurchaseBreakdown(baseQty, config.conversionFactor, config.buyingUnit, config.baseUnit);
  return {
    primary: formatPurchaseBreakdown(breakdown),
    secondary: `${formatQuantityWithUnit(baseQty, config.baseUnit)} total`,
    conversion: `${formatQuantityWithUnit(1, config.buyingUnit)} = ${formatQuantityWithUnit(config.conversionFactor, config.baseUnit)}`,
    conversionRequired: false,
  };
}

export function formatQty(value: number, maximumFractionDigits: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value);
}

export function formatDaysRemaining(value: number) {
  const maxDigits = Math.abs(value) < 10 ? 2 : 1;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: maxDigits }).format(value);
}

export function formatQuantityWithUnit(value: number, unit: string, maximumFractionDigits = 2) {
  return `${formatQty(value, maximumFractionDigits)} ${getUnitLabel(unit, value)}`;
}

export function formatRateUnit(unit: string) {
  return `${singularizeUnit(unit)}/day`;
}

export function getUnitLabel(unit: string, quantity: number) {
  return quantity === 1 ? singularizeUnit(unit) : pluralizeUnit(unit);
}

export function singularizeUnit(unit: string) {
  const trimmed = unit.trim();
  if (/ies$/i.test(trimmed)) return `${trimmed.slice(0, -3)}y`;
  if (/(ches|shes|xes|ses|zes)$/i.test(trimmed)) return trimmed.slice(0, -2);
  if (/s$/i.test(trimmed) && !/ss$/i.test(trimmed)) return trimmed.slice(0, -1);
  return trimmed;
}

export function pluralizeUnit(unit: string) {
  const singular = singularizeUnit(unit);
  if (/[^aeiou]y$/i.test(singular)) return `${singular.slice(0, -1)}ies`;
  if (/(ch|sh|x|s|z)$/i.test(singular)) return `${singular}es`;
  return `${singular}s`;
}

export function fmtQty(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}
