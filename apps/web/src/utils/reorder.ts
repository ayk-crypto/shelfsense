export function getSuggestedReorderQuantity(
  currentQuantity: number,
  minStockLevel: number,
  _legacyMultiplier?: number,
) {
  // First-pass formula: refill only the gap to minimum stock.
  // Future versions can factor in lead time, usage trends, and seasonality.
  if (minStockLevel <= 0) return 0;
  if (currentQuantity <= 0) return minStockLevel;
  return Math.max(0, minStockLevel - currentQuantity);
}
