const CONTINUOUS_UNITS = new Set([
  "kg", "kilogram", "kilograms",
  "g", "gram", "grams",
  "mg", "milligram", "milligrams",
  "lb", "lbs", "pound", "pounds",
  "oz", "ounce", "ounces",
  "l", "litre", "litres", "liter", "liters",
  "ml", "millilitre", "millilitres", "milliliter", "milliliters",
  "m", "metre", "metres", "meter", "meters",
  "cm", "centimetre", "centimetres", "centimeter", "centimeters",
  "mm", "millimetre", "millimetres", "millimeter", "millimeters",
]);

const WHOLE_UNITS = new Set([
  "unit", "units", "piece", "pieces", "pc", "pcs",
  "packet", "packets", "pack", "packs",
  "carton", "cartons", "box", "boxes", "case", "cases",
  "bottle", "bottles", "can", "cans", "tin", "tins",
  "bag", "bags", "sack", "sacks", "pouch", "pouches",
  "sachet", "sachets", "jar", "jars", "tub", "tubs",
  "bucket", "buckets", "drum", "drums", "crate", "crates",
  "tray", "trays", "roll", "rolls", "sheet", "sheets",
  "bundle", "bundles", "set", "sets", "pair", "pairs",
  "dozen", "dozens", "cup", "cups", "plate", "plates",
  "slice", "slices", "loaf", "loaves", "tablet", "tablets",
  "capsule", "capsules", "tube", "tubes", "bar", "bars",
]);

const EPSILON = 1e-6;

export type QuantityUnitKind = "CONTINUOUS" | "WHOLE" | "CUSTOM";

export function normalizeQuantityUnit(unit: string | null | undefined) {
  return (unit ?? "")
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function getQuantityUnitKind(unit: string | null | undefined): QuantityUnitKind {
  const normalized = normalizeQuantityUnit(unit);
  if (CONTINUOUS_UNITS.has(normalized)) return "CONTINUOUS";
  if (WHOLE_UNITS.has(normalized)) return "WHOLE";
  return "CUSTOM";
}

export function allowsFractionalQuantity(
  unit: string | null | undefined,
  allowFractionalForCustom = true,
) {
  const kind = getQuantityUnitKind(unit);
  if (kind === "CONTINUOUS") return true;
  if (kind === "WHOLE") return false;
  return allowFractionalForCustom;
}

export function quantityInputStep(
  unit: string | null | undefined,
  allowFractionalForCustom = true,
) {
  return allowsFractionalQuantity(unit, allowFractionalForCustom) ? "0.01" : "1";
}

export function isWholeQuantity(value: number) {
  return Math.abs(value - Math.round(value)) <= EPSILON;
}

export function validateQuantityForUnit(
  value: number,
  unit: string | null | undefined,
  allowFractionalForCustom = true,
): string | null {
  if (!Number.isFinite(value)) return "Enter a valid quantity.";
  if (allowsFractionalQuantity(unit, allowFractionalForCustom) || isWholeQuantity(value)) return null;
  const label = normalizeQuantityUnit(unit) || "this unit";
  return `${capitalize(label)} must be entered as a whole quantity, such as 1, 2 or 3.`;
}

export function roundUpToAllowedQuantity(
  value: number,
  unit: string | null | undefined,
  allowFractionalForCustom = true,
) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!allowsFractionalQuantity(unit, allowFractionalForCustom)) {
    return Math.ceil(value - EPSILON);
  }
  return roundQuantity(value);
}

export function quantityRuleText(
  unit: string | null | undefined,
  allowFractionalForCustom = true,
) {
  return allowsFractionalQuantity(unit, allowFractionalForCustom)
    ? `Decimals are allowed for ${unit || "this unit"}.`
    : `Use whole ${unit || "unit"} quantities only.`;
}

function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
