CREATE TYPE "PurchaseStatus" AS ENUM (
  'DRAFT',
  'ORDERED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED'
);

ALTER TABLE "Purchase"
  ADD COLUMN "orderedAt" TIMESTAMP(3),
  ADD COLUMN "expectedDeliveryDate" TIMESTAMP(3),
  ADD COLUMN "receivedAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelReason" TEXT,
  ADD COLUMN "status" "PurchaseStatus" NOT NULL DEFAULT 'RECEIVED';

-- Add the three genuinely new columns to PurchaseItem.
ALTER TABLE "PurchaseItem"
  ADD COLUMN "receivedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "expiryDate" TIMESTAMP(3),
  ADD COLUMN "batchNo" TEXT;

-- updatedAt was added (without a default) by migration 20260504062024.
-- Use IF NOT EXISTS so this migration is idempotent on any DB that already
-- has the column (e.g. from an earlier db push).
ALTER TABLE "PurchaseItem"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "Purchase"
SET
  "status" = 'RECEIVED',
  "orderedAt" = COALESCE("orderedAt", "date"),
  "receivedAt" = COALESCE("receivedAt", "date");

UPDATE "PurchaseItem"
SET "receivedQuantity" = "quantity";

ALTER TABLE "Purchase"
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';

CREATE INDEX "Purchase_status_idx" ON "Purchase"("status");
CREATE INDEX "Purchase_orderedAt_idx" ON "Purchase"("orderedAt");
