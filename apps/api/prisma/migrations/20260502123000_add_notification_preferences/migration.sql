ALTER TABLE "Workspace" ADD COLUMN "ownerPhone" TEXT;
ALTER TABLE "Workspace" ADD COLUMN "notifyLowStock" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Workspace" ADD COLUMN "notifyExpiringSoon" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Workspace" ADD COLUMN "notifyExpired" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Workspace" ADD COLUMN "whatsappAlertsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Workspace" ADD COLUMN "emailAlertsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Workspace" ADD COLUMN "pushAlertsEnabled" BOOLEAN NOT NULL DEFAULT false;
