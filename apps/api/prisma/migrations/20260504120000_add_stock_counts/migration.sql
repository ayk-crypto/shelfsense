CREATE TYPE "StockCountStatus" AS ENUM ('DRAFT', 'FINALIZED');

CREATE TABLE "StockCount" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "finalizedById" UUID,
    "status" "StockCountStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finalizedAt" TIMESTAMP(3),

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockCountItem" (
    "id" UUID NOT NULL,
    "stockCountId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "itemName" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "systemQuantity" DOUBLE PRECISION NOT NULL,
    "physicalQuantity" DOUBLE PRECISION NOT NULL,
    "variance" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockCountItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StockCount_workspaceId_idx" ON "StockCount"("workspaceId");
CREATE INDEX "StockCount_locationId_idx" ON "StockCount"("locationId");
CREATE INDEX "StockCount_createdById_idx" ON "StockCount"("createdById");
CREATE INDEX "StockCount_finalizedById_idx" ON "StockCount"("finalizedById");
CREATE INDEX "StockCount_status_idx" ON "StockCount"("status");
CREATE INDEX "StockCount_createdAt_idx" ON "StockCount"("createdAt");

CREATE INDEX "StockCountItem_stockCountId_idx" ON "StockCountItem"("stockCountId");
CREATE INDEX "StockCountItem_itemId_idx" ON "StockCountItem"("itemId");
CREATE UNIQUE INDEX "StockCountItem_stockCountId_itemId_key" ON "StockCountItem"("stockCountId", "itemId");

ALTER TABLE "StockCount"
ADD CONSTRAINT "StockCount_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockCount"
ADD CONSTRAINT "StockCount_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockCount"
ADD CONSTRAINT "StockCount_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockCount"
ADD CONSTRAINT "StockCount_finalizedById_fkey"
FOREIGN KEY ("finalizedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockCountItem"
ADD CONSTRAINT "StockCountItem_stockCountId_fkey"
FOREIGN KEY ("stockCountId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockCountItem"
ADD CONSTRAINT "StockCountItem_itemId_fkey"
FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
