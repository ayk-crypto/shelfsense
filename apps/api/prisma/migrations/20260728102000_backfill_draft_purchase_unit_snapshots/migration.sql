-- Repair draft purchase orders created from reorder planning before unit snapshots
-- were recorded. Quantities remain stored in the stock/base unit internally;
-- the snapshot records how the supplier-facing purchase quantity should display.

UPDATE "PurchaseItem" AS pi
SET
  "baseUnitSnapshot" = TRIM(i."unit"),
  "purchaseUnitSnapshot" = CASE
    WHEN NULLIF(TRIM(i."purchaseUnit"), '') IS NOT NULL
      AND i."purchaseConversionFactor" IS NOT NULL
      AND i."purchaseConversionFactor" > 0
    THEN TRIM(i."purchaseUnit")
    ELSE NULL
  END,
  "purchaseConversionFactorSnapshot" = CASE
    WHEN NULLIF(TRIM(i."purchaseUnit"), '') IS NOT NULL
      AND i."purchaseConversionFactor" IS NOT NULL
      AND i."purchaseConversionFactor" > 0
    THEN i."purchaseConversionFactor"
    ELSE NULL
  END,
  "enteredQuantity" = CASE
    WHEN NULLIF(TRIM(i."purchaseUnit"), '') IS NOT NULL
      AND i."purchaseConversionFactor" IS NOT NULL
      AND i."purchaseConversionFactor" > 0
    THEN pi."quantity" / i."purchaseConversionFactor"
    ELSE pi."quantity"
  END,
  "enteredUnitSnapshot" = CASE
    WHEN NULLIF(TRIM(i."purchaseUnit"), '') IS NOT NULL
      AND i."purchaseConversionFactor" IS NOT NULL
      AND i."purchaseConversionFactor" > 0
    THEN TRIM(i."purchaseUnit")
    ELSE TRIM(i."unit")
  END,
  "storedBaseQuantitySnapshot" = pi."quantity",
  "unitSnapshotSource" = 'INFERRED'
FROM "Purchase" AS p, "Item" AS i
WHERE pi."purchaseId" = p."id"
  AND pi."itemId" = i."id"
  AND p."status" = 'DRAFT'
  AND (
    pi."unitSnapshotSource" = 'UNKNOWN'
    OR pi."baseUnitSnapshot" IS NULL
    OR pi."enteredUnitSnapshot" IS NULL
    OR pi."storedBaseQuantitySnapshot" IS NULL
  );
