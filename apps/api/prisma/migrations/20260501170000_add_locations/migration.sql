CREATE TABLE "Location" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "workspaceId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Location_workspaceId_idx" ON "Location"("workspaceId");
CREATE UNIQUE INDEX "Location_workspaceId_name_key" ON "Location"("workspaceId", "name");

ALTER TABLE "Location"
ADD CONSTRAINT "Location_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Location" ("name", "workspaceId")
SELECT 'Main Branch', "id"
FROM "Workspace"
ON CONFLICT ("workspaceId", "name") DO NOTHING;

ALTER TABLE "StockBatch" ADD COLUMN "locationId" UUID;
ALTER TABLE "StockMovement" ADD COLUMN "locationId" UUID;
ALTER TABLE "Purchase" ADD COLUMN "locationId" UUID;

UPDATE "StockBatch" sb
SET "locationId" = l."id"
FROM "Location" l
WHERE l."workspaceId" = sb."workspaceId"
  AND l."name" = 'Main Branch'
  AND sb."locationId" IS NULL;

UPDATE "StockMovement" sm
SET "locationId" = l."id"
FROM "Location" l
WHERE l."workspaceId" = sm."workspaceId"
  AND l."name" = 'Main Branch'
  AND sm."locationId" IS NULL;

UPDATE "Purchase" p
SET "locationId" = l."id"
FROM "Location" l
WHERE l."workspaceId" = p."workspaceId"
  AND l."name" = 'Main Branch'
  AND p."locationId" IS NULL;

ALTER TABLE "StockBatch" ALTER COLUMN "locationId" SET NOT NULL;
ALTER TABLE "StockMovement" ALTER COLUMN "locationId" SET NOT NULL;
ALTER TABLE "Purchase" ALTER COLUMN "locationId" SET NOT NULL;

CREATE INDEX "StockBatch_locationId_idx" ON "StockBatch"("locationId");
CREATE INDEX "StockMovement_locationId_idx" ON "StockMovement"("locationId");
CREATE INDEX "Purchase_locationId_idx" ON "Purchase"("locationId");

ALTER TABLE "StockBatch"
ADD CONSTRAINT "StockBatch_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "Location"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StockMovement"
ADD CONSTRAINT "StockMovement_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "Location"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Purchase"
ADD CONSTRAINT "Purchase_locationId_fkey"
FOREIGN KEY ("locationId") REFERENCES "Location"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
