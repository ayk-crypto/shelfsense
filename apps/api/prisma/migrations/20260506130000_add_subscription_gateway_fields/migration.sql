-- Add gateway integration columns to Subscription.
-- These were added to schema.prisma via db push without a migration file.
-- Using IF NOT EXISTS so this is safe against any database state.

ALTER TABLE "Subscription"
  ADD COLUMN IF NOT EXISTS "gatewayProvider"       TEXT,
  ADD COLUMN IF NOT EXISTS "gatewayCustomerId"      TEXT,
  ADD COLUMN IF NOT EXISTS "gatewaySubscriptionId"  TEXT;
