CREATE TYPE "UnitSnapshotSource" AS ENUM ('ORIGINAL', 'INFERRED', 'UNKNOWN');

ALTER TABLE "PurchaseItem"
  ADD COLUMN "baseUnitSnapshot" TEXT,
  ADD COLUMN "purchaseUnitSnapshot" TEXT,
  ADD COLUMN "purchaseConversionFactorSnapshot" DOUBLE PRECISION,
  ADD COLUMN "enteredQuantity" DOUBLE PRECISION,
  ADD COLUMN "enteredUnitSnapshot" TEXT,
  ADD COLUMN "storedBaseQuantitySnapshot" DOUBLE PRECISION,
  ADD COLUMN "unitSnapshotSource" "UnitSnapshotSource" NOT NULL DEFAULT 'UNKNOWN';

UPDATE "PurchaseItem" pi
SET
  "baseUnitSnapshot" = i."unit",
  "purchaseUnitSnapshot" = CASE
    WHEN i."purchaseUnit" IS NOT NULL
      AND trim(i."purchaseUnit") <> ''
      AND i."purchaseConversionFactor" IS NOT NULL
      AND i."purchaseConversionFactor" > 0
    THEN i."purchaseUnit"
    ELSE NULL
  END,
  "purchaseConversionFactorSnapshot" = CASE
    WHEN i."purchaseUnit" IS NOT NULL
      AND trim(i."purchaseUnit") <> ''
      AND i."purchaseConversionFactor" IS NOT NULL
      AND i."purchaseConversionFactor" > 0
    THEN i."purchaseConversionFactor"
    ELSE NULL
  END,
  "enteredQuantity" = CASE
    WHEN i."purchaseUnit" IS NOT NULL
      AND trim(i."purchaseUnit") <> ''
      AND i."purchaseConversionFactor" IS NOT NULL
      AND i."purchaseConversionFactor" > 0
    THEN pi."quantity" / i."purchaseConversionFactor"
    ELSE pi."quantity"
  END,
  "enteredUnitSnapshot" = CASE
    WHEN i."purchaseUnit" IS NOT NULL
      AND trim(i."purchaseUnit") <> ''
      AND i."purchaseConversionFactor" IS NOT NULL
      AND i."purchaseConversionFactor" > 0
    THEN i."purchaseUnit"
    ELSE i."unit"
  END,
  "storedBaseQuantitySnapshot" = pi."quantity",
  "unitSnapshotSource" = CASE
    WHEN i."unit" IS NULL OR trim(i."unit") = '' THEN 'UNKNOWN'::"UnitSnapshotSource"
    ELSE 'INFERRED'::"UnitSnapshotSource"
  END
FROM "Item" i
WHERE pi."itemId" = i."id";

CREATE INDEX "PurchaseItem_unitSnapshotSource_idx" ON "PurchaseItem"("unitSnapshotSource");
