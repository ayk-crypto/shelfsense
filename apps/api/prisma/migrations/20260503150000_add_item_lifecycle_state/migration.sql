ALTER TABLE "Item"
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "Item_workspaceId_isActive_idx" ON "Item"("workspaceId", "isActive");