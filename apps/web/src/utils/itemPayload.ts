import type { CreateItemInput, Item } from "../types";

type UpdateItemInput = Partial<Omit<CreateItemInput, "category" | "sku" | "barcode">> & {
  category?: string | null;
  sku?: string | null;
  barcode?: string | null;
};

const nullableNumericFields = [
  "criticalStockLevel",
  "parStockLevel",
  "customFrequencyDays",
  "procurementLeadTimeDays",
  "safetyStockDays",
  "reviewPeriodDays",
  "manualReorderPointBaseQty",
  "manualTargetStockBaseQty",
] as const;

type NullableNumericField = typeof nullableNumericFields[number];

function normalizeNullableNumber(value: number | null | undefined) {
  return value === undefined ? undefined : value;
}

function nullableNumberChanged(
  current: number | null | undefined,
  initial: number | null | undefined,
) {
  return normalizeNullableNumber(current) !== normalizeNullableNumber(initial);
}

export function buildEditItemPayload(
  form: CreateItemInput,
  initial: Item,
  usesPurchaseUnit: boolean,
): UpdateItemInput {
  const payload: UpdateItemInput = {
    name: form.name.trim(),
    unit: form.unit.trim(),
    category: form.category?.trim() || null,
    sku: form.sku?.trim() || null,
    barcode: form.barcode?.trim() || null,
    minStockLevel: form.minStockLevel,
    procurementFrequency: form.procurementFrequency ?? null,
    replenishmentMode: form.replenishmentMode,
    allowFractionalPurchaseUnit: form.allowFractionalPurchaseUnit,
    trackExpiry: form.trackExpiry,
    purchaseUnit: usesPurchaseUnit ? form.purchaseUnit?.trim() || null : null,
    purchaseConversionFactor: usesPurchaseUnit ? form.purchaseConversionFactor ?? null : null,
    issueUnit: form.issueUnit ?? null,
    displayBothUnits: usesPurchaseUnit ? form.displayBothUnits : false,
  };

  for (const field of nullableNumericFields) {
    if (nullableNumberChanged(form[field], initial[field] as number | null | undefined)) {
      payload[field as NullableNumericField] = form[field] ?? null;
    }
  }

  return payload;
}
