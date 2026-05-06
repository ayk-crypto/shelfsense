-- Add customPurchaseUnits column to Workspace (missing from production)
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "customPurchaseUnits" TEXT[] NOT NULL DEFAULT '{}';
