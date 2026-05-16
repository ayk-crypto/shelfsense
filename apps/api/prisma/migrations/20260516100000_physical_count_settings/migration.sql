-- CreateTable: PhysicalCountSettings
CREATE TABLE "PhysicalCountSettings" (
    "id"                   UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspaceId"          UUID NOT NULL,
    "locationId"           UUID,
    "enabled"              BOOLEAN NOT NULL DEFAULT true,
    "frequencyType"        TEXT NOT NULL DEFAULT 'monthly',
    "customIntervalNumber" INTEGER,
    "customIntervalUnit"   TEXT,
    "reminderLeadDays"     INTEGER NOT NULL DEFAULT 0,
    "lastCompletedAt"      TIMESTAMP(3),
    "lastCompletedCountId" UUID,
    "nextDueAt"            TIMESTAMP(3),
    "lastReminderSentAt"   TIMESTAMP(3),
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PhysicalCountSettings_pkey" PRIMARY KEY ("id")
);

-- CreateUniqueIndex
CREATE UNIQUE INDEX "PhysicalCountSettings_workspaceId_key" ON "PhysicalCountSettings"("workspaceId");

-- CreateIndex
CREATE INDEX "PhysicalCountSettings_workspaceId_idx" ON "PhysicalCountSettings"("workspaceId");
CREATE INDEX "PhysicalCountSettings_nextDueAt_idx" ON "PhysicalCountSettings"("nextDueAt");

-- AddForeignKey
ALTER TABLE "PhysicalCountSettings" ADD CONSTRAINT "PhysicalCountSettings_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
