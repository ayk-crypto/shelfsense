-- CreateEnum
CREATE TYPE "ItemSupplierRole" AS ENUM ('PRIMARY', 'ALTERNATE');

-- CreateTable
CREATE TABLE "ItemSupplier" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "role" "ItemSupplierRole" NOT NULL DEFAULT 'PRIMARY',
    "supplierItemCode" TEXT,
    "preferredPurchaseUnit" TEXT,
    "lastPurchasePrice" DOUBLE PRECISION,
    "lastPurchaseDate" TIMESTAMP(3),
    "minimumOrderQuantity" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ItemSupplier_itemId_supplierId_role_key" ON "ItemSupplier"("itemId", "supplierId", "role");

-- CreateIndex
CREATE INDEX "ItemSupplier_workspaceId_idx" ON "ItemSupplier"("workspaceId");

-- CreateIndex
CREATE INDEX "ItemSupplier_itemId_idx" ON "ItemSupplier"("itemId");

-- CreateIndex
CREATE INDEX "ItemSupplier_supplierId_idx" ON "ItemSupplier"("supplierId");

-- CreateIndex
CREATE INDEX "ItemSupplier_workspaceId_role_idx" ON "ItemSupplier"("workspaceId", "role");

-- AddForeignKey
ALTER TABLE "ItemSupplier" ADD CONSTRAINT "ItemSupplier_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemSupplier" ADD CONSTRAINT "ItemSupplier_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemSupplier" ADD CONSTRAINT "ItemSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
