export function getSuggestedReorderQuantity(
  currentQuantity: number,
  minStockLevel: number,
) {
  return Math.max(0, minStockLevel * 2 - currentQuantity);
}
