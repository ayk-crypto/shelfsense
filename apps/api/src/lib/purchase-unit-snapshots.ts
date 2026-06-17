export type PurchaseQuantityUnit = "PURCHASE_UNIT" | "BASE_UNIT";

export interface PurchaseSnapshotItemConfig {
  unit: string;
  purchaseUnit: string | null;
  purchaseConversionFactor: number | null;
}

export interface PurchaseLineSnapshot {
  baseUnitSnapshot: string;
  purchaseUnitSnapshot: string | null;
  purchaseConversionFactorSnapshot: number | null;
  enteredQuantity: number;
  enteredUnitSnapshot: string;
  storedBaseQuantity: number;
  baseUnitCost: number;
}

export function parseQuantityUnit(value: unknown): PurchaseQuantityUnit | undefined {
  if (value === "PURCHASE_UNIT" || value === "BASE_UNIT") return value;
  return undefined;
}

export function buildPurchaseLineSnapshot(
  quantity: number,
  quantityUnit: PurchaseQuantityUnit,
  unitCost: number,
  item: PurchaseSnapshotItemConfig,
): PurchaseLineSnapshot | { error: string } {
  const baseUnit = item.unit.trim();
  const purchaseUnit = item.purchaseUnit?.trim() || null;
  const factor = item.purchaseConversionFactor;

  if (quantityUnit === "PURCHASE_UNIT") {
    if (!purchaseUnit || factor === null || factor <= 0) {
      return { error: "quantityUnit PURCHASE_UNIT requires the item to have a purchase unit and positive conversion factor" };
    }
    return {
      baseUnitSnapshot: baseUnit,
      purchaseUnitSnapshot: purchaseUnit,
      purchaseConversionFactorSnapshot: factor,
      enteredQuantity: quantity,
      enteredUnitSnapshot: purchaseUnit,
      storedBaseQuantity: quantity * factor,
      baseUnitCost: unitCost / factor,
    };
  }

  return {
    baseUnitSnapshot: baseUnit,
    purchaseUnitSnapshot: purchaseUnit,
    purchaseConversionFactorSnapshot: purchaseUnit && factor !== null && factor > 0 ? factor : null,
    enteredQuantity: quantity,
    enteredUnitSnapshot: baseUnit,
    storedBaseQuantity: quantity,
    baseUnitCost: unitCost,
  };
}
