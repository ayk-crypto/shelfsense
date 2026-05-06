-- Standardise platform billing currency to USD.
-- Workspace.currency is intentionally left as-is (customer operational currency).

-- ── Plan ──────────────────────────────────────────────────────────────────────
ALTER TABLE "Plan" ALTER COLUMN "currency" SET DEFAULT 'USD';
UPDATE "Plan" SET "currency" = 'USD' WHERE "currency" IS NULL OR "currency" = '' OR "currency" != 'USD';

-- ── Subscription ──────────────────────────────────────────────────────────────
ALTER TABLE "Subscription" ALTER COLUMN "currency" SET DEFAULT 'USD';
UPDATE "Subscription" SET "currency" = 'USD' WHERE "currency" IS NULL OR "currency" = '';

-- ── Payment ───────────────────────────────────────────────────────────────────
ALTER TABLE "Payment" ALTER COLUMN "currency" SET DEFAULT 'USD';
UPDATE "Payment" SET "currency" = 'USD' WHERE "currency" IS NULL OR "currency" = '';
