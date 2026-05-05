-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'PENDING', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TicketSource" AS ENUM ('EMAIL', 'PORTAL', 'ADMIN');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'INTERNAL');

-- CreateSequence for ticket numbers
CREATE SEQUENCE "SupportTicket_ticketNumber_seq" START WITH 1000 INCREMENT BY 1;

-- CreateTable: SupportTicket
CREATE TABLE "SupportTicket" (
    "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
    "ticketNumber"     INTEGER      NOT NULL DEFAULT nextval('"SupportTicket_ticketNumber_seq"'),
    "subject"          TEXT         NOT NULL,
    "status"           "TicketStatus"   NOT NULL DEFAULT 'OPEN',
    "priority"         "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "source"           "TicketSource"   NOT NULL DEFAULT 'EMAIL',
    "workspaceId"      UUID,
    "userId"           UUID,
    "requesterEmail"   TEXT         NOT NULL,
    "requesterName"    TEXT,
    "assignedToUserId" UUID,
    "lastMessageAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt"       TIMESTAMP(3),
    "closedAt"         TIMESTAMP(3),
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SupportMessage
CREATE TABLE "SupportMessage" (
    "id"                UUID              NOT NULL DEFAULT gen_random_uuid(),
    "ticketId"          UUID              NOT NULL,
    "direction"         "MessageDirection" NOT NULL,
    "senderEmail"       TEXT              NOT NULL,
    "senderName"        TEXT,
    "bodyHtml"          TEXT,
    "bodyText"          TEXT              NOT NULL,
    "providerMessageId" TEXT,
    "attachments"       JSONB,
    "createdByUserId"   UUID,
    "createdAt"         TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SupportInternalNote
CREATE TABLE "SupportInternalNote" (
    "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
    "ticketId"        UUID         NOT NULL,
    "note"            TEXT         NOT NULL,
    "createdByUserId" UUID         NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportInternalNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable: SupportTicketEvent
CREATE TABLE "SupportTicketEvent" (
    "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
    "ticketId"    UUID         NOT NULL,
    "actorUserId" UUID,
    "eventType"   TEXT         NOT NULL,
    "metadata"    JSONB,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportTicketEvent_pkey" PRIMARY KEY ("id")
);

-- AddUniqueConstraint
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_ticketNumber_key" UNIQUE ("ticketNumber");

-- AddForeignKeys: SupportTicket
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assignedToUserId_fkey"
    FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKeys: SupportMessage
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKeys: SupportInternalNote
ALTER TABLE "SupportInternalNote" ADD CONSTRAINT "SupportInternalNote_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupportInternalNote" ADD CONSTRAINT "SupportInternalNote_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKeys: SupportTicketEvent
ALTER TABLE "SupportTicketEvent" ADD CONSTRAINT "SupportTicketEvent_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SupportTicketEvent" ADD CONSTRAINT "SupportTicketEvent_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndexes
CREATE INDEX "SupportTicket_status_idx"          ON "SupportTicket"("status");
CREATE INDEX "SupportTicket_priority_idx"         ON "SupportTicket"("priority");
CREATE INDEX "SupportTicket_workspaceId_idx"      ON "SupportTicket"("workspaceId");
CREATE INDEX "SupportTicket_userId_idx"           ON "SupportTicket"("userId");
CREATE INDEX "SupportTicket_assignedToUserId_idx" ON "SupportTicket"("assignedToUserId");
CREATE INDEX "SupportTicket_lastMessageAt_idx"    ON "SupportTicket"("lastMessageAt");
CREATE INDEX "SupportTicket_createdAt_idx"        ON "SupportTicket"("createdAt");

CREATE INDEX "SupportMessage_ticketId_idx"  ON "SupportMessage"("ticketId");
CREATE INDEX "SupportMessage_direction_idx" ON "SupportMessage"("direction");
CREATE INDEX "SupportMessage_createdAt_idx" ON "SupportMessage"("createdAt");

CREATE INDEX "SupportInternalNote_ticketId_idx"  ON "SupportInternalNote"("ticketId");
CREATE INDEX "SupportInternalNote_createdAt_idx" ON "SupportInternalNote"("createdAt");

CREATE INDEX "SupportTicketEvent_ticketId_idx"  ON "SupportTicketEvent"("ticketId");
CREATE INDEX "SupportTicketEvent_createdAt_idx" ON "SupportTicketEvent"("createdAt");
