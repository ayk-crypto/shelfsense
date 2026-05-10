export interface PurchaseUnitBreakdown {
  whole: number;
  remainder: number;
  purchaseUnit: string;
  baseUnit: string;
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
  if (whole === 0 && remainder === 0) return `0 ${baseUnit}`;
  if (whole === 0) return `${fmtQty(remainder)} ${baseUnit}`;
  if (remainder === 0) return `${whole} ${purchaseUnit}`;
  return `${whole} ${purchaseUnit} + ${fmtQty(remainder)} ${baseUnit}`;
}

export function fmtQty(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}
