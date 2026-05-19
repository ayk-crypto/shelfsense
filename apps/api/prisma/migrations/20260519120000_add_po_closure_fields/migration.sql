-- Add new PurchaseStatus enum values
ALTER TYPE "PurchaseStatus" ADD VALUE IF NOT EXISTS 'RECEIVED_WITH_VARIANCE';
ALTER TYPE "PurchaseStatus" ADD VALUE IF NOT EXISTS 'CLOSED_SHORT';
ALTER TYPE "PurchaseStatus" ADD VALUE IF NOT EXISTS 'BACKORDERED';

-- Add closure audit fields to Purchase header
ALTER TABLE "Purchase"
  ADD COLUMN IF NOT EXISTS "closureType"   TEXT,
  ADD COLUMN IF NOT EXISTS "closureReason" TEXT,
  ADD COLUMN IF NOT EXISTS "closureNotes"  TEXT,
  ADD COLUMN IF NOT EXISTS "closedAt"      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "closedById"    UUID;

-- Add per-line closure fields to PurchaseItem
ALTER TABLE "PurchaseItem"
  ADD COLUMN IF NOT EXISTS "closureAction" TEXT,
  ADD COLUMN IF NOT EXISTS "closureReason" TEXT,
  ADD COLUMN IF NOT EXISTS "shortQty"      FLOAT8,
  ADD COLUMN IF NOT EXISTS "closedAt"      TIMESTAMPTZ;
