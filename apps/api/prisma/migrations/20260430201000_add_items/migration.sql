CREATE TABLE "Item" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "barcode" TEXT,
    "unit" TEXT NOT NULL,
    "minStockLevel" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trackExpiry" BOOLEAN NOT NULL DEFAULT false,
    "workspaceId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Item_workspaceId_idx" ON "Item"("workspaceId");

ALTER TABLE "Item" ADD CONSTRAINT "Item_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
