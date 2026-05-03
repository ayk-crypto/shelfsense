-- AlterTable
ALTER TABLE "StockBatch" ADD COLUMN     "supplierId" UUID;

-- CreateIndex
CREATE INDEX "StockBatch_supplierId_idx" ON "StockBatch"("supplierId");

-- AddForeignKey
ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
