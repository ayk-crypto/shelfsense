-- ============================================================
-- Catch-up migration: schema fields/tables/enum values that
-- were added via `prisma db push` without migration files.
-- Every statement is idempotent (IF NOT EXISTS / DO $$ guards)
-- and safe against any database state — fresh or partially
-- migrated via db push.
-- ============================================================

-- ── PlanTier enum (required by Workspace.plan) ───────────────
DO $$ BEGIN
  CREATE TYPE "PlanTier" AS ENUM ('FREE', 'BASIC', 'PRO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── InvoiceStatus enum (required by Invoice.status) ──────────
DO $$ BEGIN
  CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'VOID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── PaymentMethod: add gateway-specific values ────────────────
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'MOCK';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'PAYFAST';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'SAFEPAY';

-- ── StockCountStatus: add review-cycle values ─────────────────
ALTER TYPE "StockCountStatus" ADD VALUE IF NOT EXISTS 'RETURNED';
ALTER TYPE "StockCountStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

-- ── User ──────────────────────────────────────────────────────
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);

-- ── Workspace ─────────────────────────────────────────────────
ALTER TABLE "Workspace"
  ADD COLUMN IF NOT EXISTS "onboardingStep"   INTEGER    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "businessType"     TEXT,
  ADD COLUMN IF NOT EXISTS "customUnits"      TEXT[]     NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "customCategories" TEXT[]     NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "plan"             "PlanTier" NOT NULL DEFAULT 'FREE';

-- ── Item ──────────────────────────────────────────────────────
ALTER TABLE "Item"
  ADD COLUMN IF NOT EXISTS "purchaseUnit"             TEXT,
  ADD COLUMN IF NOT EXISTS "purchaseConversionFactor" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "issueUnit"                TEXT,
  ADD COLUMN IF NOT EXISTS "displayBothUnits"         BOOLEAN NOT NULL DEFAULT false;

-- ── StockBatch ────────────────────────────────────────────────
ALTER TABLE "StockBatch"
  ADD COLUMN IF NOT EXISTS "receivedQuantity" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "receivedUnit"     TEXT;

-- ── StockMovement ─────────────────────────────────────────────
ALTER TABLE "StockMovement"
  ADD COLUMN IF NOT EXISTS "enteredQuantity"  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "enteredUnit"      TEXT,
  ADD COLUMN IF NOT EXISTS "conversionFactor" DOUBLE PRECISION;

-- ── StockCount: review-cycle columns + FK constraints ─────────
ALTER TABLE "StockCount"
  ADD COLUMN IF NOT EXISTS "managerComment" TEXT,
  ADD COLUMN IF NOT EXISTS "returnedById"   UUID,
  ADD COLUMN IF NOT EXISTS "rejectedById"   UUID,
  ADD COLUMN IF NOT EXISTS "returnedAt"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejectedAt"     TIMESTAMP(3);

DO $$ BEGIN
  ALTER TABLE "StockCount"
    ADD CONSTRAINT "StockCount_returnedById_fkey"
    FOREIGN KEY ("returnedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "StockCount"
    ADD CONSTRAINT "StockCount_rejectedById_fkey"
    FOREIGN KEY ("rejectedById") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Invoice table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Invoice" (
  "id"             UUID             NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId"    UUID             NOT NULL,
  "subscriptionId" UUID,
  "paymentId"      UUID,
  "invoiceNumber"  TEXT             NOT NULL,
  "amount"         DOUBLE PRECISION NOT NULL,
  "currency"       TEXT             NOT NULL DEFAULT 'USD',
  "status"         "InvoiceStatus"  NOT NULL DEFAULT 'DRAFT',
  "issuedAt"       TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueAt"          TIMESTAMP(3),
  "paidAt"         TIMESTAMP(3),
  "notes"          TEXT,
  "lineItems"      JSONB            NOT NULL DEFAULT '[]',
  "createdAt"      TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_invoiceNumber_key"  ON "Invoice"("invoiceNumber");
CREATE INDEX        IF NOT EXISTS "Invoice_workspaceId_idx"    ON "Invoice"("workspaceId");
CREATE INDEX        IF NOT EXISTS "Invoice_status_idx"         ON "Invoice"("status");
CREATE INDEX        IF NOT EXISTS "Invoice_subscriptionId_idx" ON "Invoice"("subscriptionId");
CREATE INDEX        IF NOT EXISTS "Invoice_createdAt_idx"      ON "Invoice"("createdAt");

DO $$ BEGIN
  ALTER TABLE "Invoice"
    ADD CONSTRAINT "Invoice_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Invoice"
    ADD CONSTRAINT "Invoice_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Invoice"
    ADD CONSTRAINT "Invoice_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "Payment"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── BillingEvent table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "BillingEvent" (
  "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId"     UUID,
  "eventType"       TEXT         NOT NULL,
  "gatewayProvider" TEXT,
  "gatewayEventId"  TEXT,
  "subscriptionId"  UUID,
  "paymentId"       UUID,
  "payload"         JSONB,
  "processedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BillingEvent_gatewayProvider_gatewayEventId_key"
  ON "BillingEvent"("gatewayProvider", "gatewayEventId");
CREATE INDEX IF NOT EXISTS "BillingEvent_workspaceId_idx" ON "BillingEvent"("workspaceId");
CREATE INDEX IF NOT EXISTS "BillingEvent_eventType_idx"   ON "BillingEvent"("eventType");
CREATE INDEX IF NOT EXISTS "BillingEvent_createdAt_idx"   ON "BillingEvent"("createdAt");

DO $$ BEGIN
  ALTER TABLE "BillingEvent"
    ADD CONSTRAINT "BillingEvent_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
