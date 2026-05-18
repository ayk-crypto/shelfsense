-- Add procurement planning fields to Item
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "criticalStockLevel"    DOUBLE PRECISION;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "parStockLevel"          DOUBLE PRECISION;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "procurementFrequency"   TEXT;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "customFrequencyDays"    INTEGER;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "procurementLeadTimeDays" INTEGER;
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "lastReceivedDate"       TIMESTAMP(3);

-- Backward compat: pre-populate criticalStockLevel from minStockLevel where it is already set
UPDATE "Item" SET "criticalStockLevel" = "minStockLevel" WHERE "minStockLevel" > 0;
