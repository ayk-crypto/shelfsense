CREATE TYPE "StockMovementType" AS ENUM ('STOCK_IN', 'STOCK_OUT', 'WASTAGE', 'ADJUSTMENT');

CREATE TABLE "StockBatch" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "remainingQuantity" DOUBLE PRECISION NOT NULL,
    "unitCost" DOUBLE PRECISION,
    "expiryDate" TIMESTAMP(3),
    "batchNo" TEXT,
    "supplierName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockMovement" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "batchId" UUID,
    "type" "StockMovementType" NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitCost" DOUBLE PRECISION,
    "reason" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StockBatch_workspaceId_idx" ON "StockBatch"("workspaceId");

CREATE INDEX "StockBatch_itemId_idx" ON "StockBatch"("itemId");

CREATE INDEX "StockBatch_expiryDate_idx" ON "StockBatch"("expiryDate");

CREATE INDEX "StockMovement_workspaceId_idx" ON "StockMovement"("workspaceId");

CREATE INDEX "StockMovement_itemId_idx" ON "StockMovement"("itemId");

CREATE INDEX "StockMovement_batchId_idx" ON "StockMovement"("batchId");

CREATE INDEX "StockMovement_type_idx" ON "StockMovement"("type");

ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "StockBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
