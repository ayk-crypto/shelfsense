-- Add custom workspace columns that were previously pushed directly via prisma db push.
-- Using IF NOT EXISTS so this is safe to apply against databases that already have these
-- columns (e.g. development) as well as those that don't (production / staging).

ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "customUnits"         TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "customCategories"    TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "customPurchaseUnits" TEXT[] NOT NULL DEFAULT '{}';
