export function getSuggestedReorderQuantity(
  currentQuantity: number,
  minStockLevel: number,
  multiplier = 2,
) {
  return Math.max(0, minStockLevel * multiplier - currentQuantity);
}
