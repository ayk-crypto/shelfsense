-- AddColumn dailyDigestEnabled
ALTER TABLE "Workspace" ADD COLUMN "dailyDigestEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AddColumn lastScheduledLowStockEmailAt
ALTER TABLE "Workspace" ADD COLUMN "lastScheduledLowStockEmailAt" TIMESTAMP(3);

-- AddColumn lastScheduledExpirySoonEmailAt
ALTER TABLE "Workspace" ADD COLUMN "lastScheduledExpirySoonEmailAt" TIMESTAMP(3);

-- AddColumn lastDailyDigestSentAt
ALTER TABLE "Workspace" ADD COLUMN "lastDailyDigestSentAt" TIMESTAMP(3);
