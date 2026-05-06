export const DEFAULT_UNIT_OPTIONS = [
  "kg", "g", "liter", "ml", "pcs", "pack", "box", "dozen", "bottle", "can", "bag",
];

export const DEFAULT_CATEGORY_OPTIONS = [
  "Raw Material", "Beverage", "Packaging", "Cleaning", "Finished Goods", "Other",
];

export function effectiveUnits(customUnits: string[]): string[] {
  return customUnits.length > 0 ? customUnits : DEFAULT_UNIT_OPTIONS;
}

export function effectiveCategories(customCategories: string[]): string[] {
  return customCategories.length > 0 ? customCategories : DEFAULT_CATEGORY_OPTIONS;
}
