-- CreateEnum
CREATE TYPE "PlanPriceDisplayMode" AS ENUM ('FIXED', 'CUSTOM');

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN "priceDisplayMode" "PlanPriceDisplayMode" NOT NULL DEFAULT 'FIXED';

-- DataMigration: set Business/Enterprise plans to CUSTOM
UPDATE "Plan"
SET "priceDisplayMode" = 'CUSTOM'
WHERE LOWER(code) LIKE '%business%'
   OR LOWER(code) LIKE '%enterprise%'
   OR LOWER(name) LIKE '%business%'
   OR LOWER(name) LIKE '%enterprise%';
