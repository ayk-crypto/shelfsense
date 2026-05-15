-- CreateEnum
CREATE TYPE "OcrStatus" AS ENUM ('NOT_UPLOADED', 'UPLOADED', 'PROCESSING', 'EXTRACTED', 'NEEDS_REVIEW', 'FAILED');

-- CreateEnum
CREATE TYPE "TaxMode" AS ENUM ('TAX_PER_UNIT', 'TAX_PER_LINE', 'ALLOCATED_FROM_INVOICE_TOTAL', 'TAX_INCLUSIVE_PRICE', 'NO_TAX');

-- CreateEnum
CREATE TYPE "InvoiceLineMatchStatus" AS ENUM ('MATCHED', 'NEEDS_REVIEW', 'EXTRA_INVOICE_ITEM', 'UNMATCHED');

-- CreateEnum
CREATE TYPE "InventoryCostBasis" AS ENUM ('INCLUDING_TAX', 'EXCLUDING_TAX');

-- AlterTable Workspace
ALTER TABLE "Workspace" ADD COLUMN "inventoryCostBasis" "InventoryCostBasis" NOT NULL DEFAULT 'INCLUDING_TAX';

-- AlterTable StockBatch
ALTER TABLE "StockBatch" ADD COLUMN "unitCostExclTax" DOUBLE PRECISION,
                          ADD COLUMN "unitTax" DOUBLE PRECISION,
                          ADD COLUMN "unitCostInclTax" DOUBLE PRECISION;

-- CreateTable SupplierInvoiceUpload
CREATE TABLE "SupplierInvoiceUpload" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspaceId" UUID NOT NULL,
    "purchaseOrderId" UUID,
    "supplierId" UUID,
    "uploadedById" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "filePath" TEXT NOT NULL,
    "ocrStatus" "OcrStatus" NOT NULL DEFAULT 'UPLOADED',
    "extractedRawText" TEXT,
    "extractedJson" JSONB,
    "invoiceNumber" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "supplierName" TEXT,
    "invoiceSubtotalExclTax" DOUBLE PRECISION,
    "invoiceTaxTotal" DOUBLE PRECISION,
    "invoiceTotalInclTax" DOUBLE PRECISION,
    "taxMode" "TaxMode",
    "duplicateWarning" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierInvoiceUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable SupplierInvoiceLine
CREATE TABLE "SupplierInvoiceLine" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoiceUploadId" UUID NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "rawDescription" TEXT NOT NULL,
    "normalizedDescription" TEXT,
    "extractedQty" DOUBLE PRECISION,
    "extractedUnitCostExclTax" DOUBLE PRECISION,
    "extractedUnitTax" DOUBLE PRECISION,
    "extractedUnitCostInclTax" DOUBLE PRECISION,
    "extractedLineSubtotalExclTax" DOUBLE PRECISION,
    "extractedLineTaxTotal" DOUBLE PRECISION,
    "extractedLineTotalInclTax" DOUBLE PRECISION,
    "extractedTaxRate" DOUBLE PRECISION,
    "extractedBatchNo" TEXT,
    "extractedExpiryDate" TIMESTAMP(3),
    "taxMode" "TaxMode",
    "suggestedInventoryItemId" UUID,
    "matchedPurchaseItemId" UUID,
    "confidenceScore" DOUBLE PRECISION,
    "matchStatus" "InvoiceLineMatchStatus",
    "userConfirmedItemId" UUID,
    "userConfirmedPurchaseItemId" UUID,
    "userEditedQty" DOUBLE PRECISION,
    "userEditedUnitCostExclTax" DOUBLE PRECISION,
    "userEditedUnitTax" DOUBLE PRECISION,
    "userEditedUnitCostInclTax" DOUBLE PRECISION,
    "userEditedBatchNo" TEXT,
    "userEditedExpiryDate" TIMESTAMP(3),
    "userAction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable SupplierItemAlias
CREATE TABLE "SupplierItemAlias" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspaceId" UUID NOT NULL,
    "supplierId" UUID,
    "invoiceItemName" TEXT NOT NULL,
    "normalizedInvoiceItemName" TEXT NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "confidenceBoost" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "lastConfirmedAt" TIMESTAMP(3),
    "confirmedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierItemAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierInvoiceUpload_workspaceId_idx" ON "SupplierInvoiceUpload"("workspaceId");
CREATE INDEX "SupplierInvoiceUpload_purchaseOrderId_idx" ON "SupplierInvoiceUpload"("purchaseOrderId");
CREATE INDEX "SupplierInvoiceUpload_invoiceNumber_idx" ON "SupplierInvoiceUpload"("invoiceNumber");
CREATE INDEX "SupplierInvoiceLine_invoiceUploadId_idx" ON "SupplierInvoiceLine"("invoiceUploadId");
CREATE INDEX "SupplierItemAlias_workspaceId_idx" ON "SupplierItemAlias"("workspaceId");
CREATE INDEX "SupplierItemAlias_workspaceId_supplierId_idx" ON "SupplierItemAlias"("workspaceId", "supplierId");
CREATE UNIQUE INDEX "SupplierItemAlias_workspaceId_supplierId_normalizedInvoiceItemName_key" ON "SupplierItemAlias"("workspaceId", "supplierId", "normalizedInvoiceItemName") NULLS NOT DISTINCT;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceUpload" ADD CONSTRAINT "SupplierInvoiceUpload_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoiceUpload" ADD CONSTRAINT "SupplierInvoiceUpload_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoiceUpload" ADD CONSTRAINT "SupplierInvoiceUpload_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_invoiceUploadId_fkey" FOREIGN KEY ("invoiceUploadId") REFERENCES "SupplierInvoiceUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupplierItemAlias" ADD CONSTRAINT "SupplierItemAlias_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierItemAlias" ADD CONSTRAINT "SupplierItemAlias_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierItemAlias" ADD CONSTRAINT "SupplierItemAlias_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
