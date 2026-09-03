export function unitCostFromReceiptTotal(totalAmount: number | undefined, receivedBaseQuantity: number) {
  if (totalAmount === undefined) return undefined;
  if (!Number.isFinite(totalAmount) || totalAmount < 0 || !Number.isFinite(receivedBaseQuantity) || receivedBaseQuantity <= 0) {
    return undefined;
  }
  return Math.round(((totalAmount / receivedBaseQuantity) + Number.EPSILON) * 10000) / 10000;
}
