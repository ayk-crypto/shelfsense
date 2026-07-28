-- Keep quantity behaviour consistent for existing items.
-- Continuous order units may use decimals; countable order units must be whole.

UPDATE "Item"
SET "allowFractionalPurchaseUnit" = TRUE
WHERE LOWER(TRIM(COALESCE("purchaseUnit", "unit"))) IN (
  'kg', 'kilogram', 'kilograms',
  'g', 'gram', 'grams',
  'mg', 'milligram', 'milligrams',
  'lb', 'lbs', 'pound', 'pounds',
  'oz', 'ounce', 'ounces',
  'l', 'litre', 'litres', 'liter', 'liters',
  'ml', 'millilitre', 'millilitres', 'milliliter', 'milliliters',
  'm', 'metre', 'metres', 'meter', 'meters',
  'cm', 'centimetre', 'centimetres', 'centimeter', 'centimeters',
  'mm', 'millimetre', 'millimetres', 'millimeter', 'millimeters'
);

UPDATE "Item"
SET "allowFractionalPurchaseUnit" = FALSE
WHERE LOWER(TRIM(COALESCE("purchaseUnit", "unit"))) IN (
  'unit', 'units', 'piece', 'pieces', 'pc', 'pcs',
  'packet', 'packets', 'pack', 'packs',
  'carton', 'cartons', 'box', 'boxes', 'case', 'cases',
  'bottle', 'bottles', 'can', 'cans', 'tin', 'tins',
  'bag', 'bags', 'sack', 'sacks', 'pouch', 'pouches',
  'sachet', 'sachets', 'jar', 'jars', 'tub', 'tubs',
  'bucket', 'buckets', 'drum', 'drums', 'crate', 'crates',
  'tray', 'trays', 'roll', 'rolls', 'sheet', 'sheets',
  'bundle', 'bundles', 'set', 'sets', 'pair', 'pairs',
  'dozen', 'dozens', 'cup', 'cups', 'plate', 'plates',
  'slice', 'slices', 'loaf', 'loaves', 'tablet', 'tablets',
  'capsule', 'capsules', 'tube', 'tubes', 'bar', 'bars'
);
