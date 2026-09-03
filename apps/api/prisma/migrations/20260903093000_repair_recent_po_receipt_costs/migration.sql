-- Repair PO receipts recorded before invoice totals were separated from unit cost.
-- The receiving UI was used with the whole invoice-line amount, while the API
-- persisted that value as cost per stock unit. Limit the one-time repair to
-- recent PO receipts; manual stock-in and opening-stock movements are excluded.

UPDATE "StockBatch" AS batch
SET
  "unitCost" = ROUND((batch."unitCost"::numeric / ABS(movement."quantity")::numeric), 4)::double precision,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "StockMovement" AS movement
WHERE movement."batchId" = batch."id"
  AND movement."reason" = 'purchase_receive'
  AND movement."createdAt" >= TIMESTAMP '2026-08-01 00:00:00'
  AND movement."quantity" <> 0
  AND batch."unitCost" IS NOT NULL;

UPDATE "StockMovement" AS movement
SET "unitCost" = batch."unitCost"
FROM "StockBatch" AS batch
WHERE movement."batchId" = batch."id"
  AND movement."reason" = 'purchase_receive'
  AND movement."createdAt" >= TIMESTAMP '2026-08-01 00:00:00'
  AND batch."unitCost" IS NOT NULL;

-- Refresh supplier-facing prices from the newest corrected receipt so PO
-- estimates no longer reuse the inflated historical amount.
WITH latest_receipt AS (
  SELECT DISTINCT ON (batch."workspaceId", batch."itemId", batch."supplierId")
    batch."workspaceId",
    batch."itemId",
    batch."supplierId",
    batch."unitCost",
    batch."createdAt",
    item."purchaseUnit",
    item."purchaseConversionFactor"
  FROM "StockBatch" AS batch
  INNER JOIN "StockMovement" AS movement ON movement."batchId" = batch."id"
  INNER JOIN "Item" AS item ON item."id" = batch."itemId"
  WHERE movement."reason" = 'purchase_receive'
    AND movement."createdAt" >= TIMESTAMP '2026-08-01 00:00:00'
    AND batch."supplierId" IS NOT NULL
    AND batch."unitCost" IS NOT NULL
  ORDER BY batch."workspaceId", batch."itemId", batch."supplierId", batch."createdAt" DESC
)
UPDATE "ItemSupplier" AS mapping
SET
  "lastPurchasePrice" = latest."unitCost" * COALESCE(NULLIF(latest."purchaseConversionFactor", 0), 1),
  "lastPurchaseDate" = latest."createdAt",
  "preferredPurchaseUnit" = latest."purchaseUnit",
  "updatedAt" = CURRENT_TIMESTAMP
FROM latest_receipt AS latest
WHERE mapping."workspaceId" = latest."workspaceId"
  AND mapping."itemId" = latest."itemId"
  AND mapping."supplierId" = latest."supplierId";
