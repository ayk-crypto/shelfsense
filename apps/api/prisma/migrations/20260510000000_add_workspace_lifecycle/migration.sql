-- Add lifecycle fields to Workspace
ALTER TABLE "Workspace" ADD COLUMN "trialStartedAt" TIMESTAMP(3);
ALTER TABLE "Workspace" ADD COLUMN "trialExtendedAt" TIMESTAMP(3);
ALTER TABLE "Workspace" ADD COLUMN "trialExtendedByAdminId" UUID;
ALTER TABLE "Workspace" ADD COLUMN "trialExtensionReason" TEXT;
ALTER TABLE "Workspace" ADD COLUMN "isDemoWorkspace" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Workspace" ADD COLUMN "demoResetAt" TIMESTAMP(3);
ALTER TABLE "Workspace" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Workspace" ADD COLUMN "archivedByAdminId" UUID;
ALTER TABLE "Workspace" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Workspace" ADD COLUMN "deletedByAdminId" UUID;
ALTER TABLE "Workspace" ADD COLUMN "deletionScheduledAt" TIMESTAMP(3);
ALTER TABLE "Workspace" ADD COLUMN "deletionReason" TEXT;

-- Indexes for lifecycle fields
CREATE INDEX "Workspace_isDemoWorkspace_idx" ON "Workspace"("isDemoWorkspace");
CREATE INDEX "Workspace_archivedAt_idx" ON "Workspace"("archivedAt");
CREATE INDEX "Workspace_deletedAt_idx" ON "Workspace"("deletedAt");
CREATE INDEX "Workspace_trialEndsAt_idx" ON "Workspace"("trialEndsAt");

-- FK: trialExtendedByAdminId -> User
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_trialExtendedByAdminId_fkey"
  FOREIGN KEY ("trialExtendedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FK: archivedByAdminId -> User
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_archivedByAdminId_fkey"
  FOREIGN KEY ("archivedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FK: deletedByAdminId -> User
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_deletedByAdminId_fkey"
  FOREIGN KEY ("deletedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- WorkspaceLifecycleLog model
CREATE TABLE "WorkspaceLifecycleLog" (
  "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID         NOT NULL,
  "adminId"     UUID         NOT NULL,
  "action"      TEXT         NOT NULL,
  "note"        TEXT,
  "meta"        JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceLifecycleLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkspaceLifecycleLog_workspaceId_idx" ON "WorkspaceLifecycleLog"("workspaceId");
CREATE INDEX "WorkspaceLifecycleLog_adminId_idx" ON "WorkspaceLifecycleLog"("adminId");
CREATE INDEX "WorkspaceLifecycleLog_createdAt_idx" ON "WorkspaceLifecycleLog"("createdAt");

ALTER TABLE "WorkspaceLifecycleLog" ADD CONSTRAINT "WorkspaceLifecycleLog_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WorkspaceLifecycleLog" ADD CONSTRAINT "WorkspaceLifecycleLog_adminId_fkey"
  FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
