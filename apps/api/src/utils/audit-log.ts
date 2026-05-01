import { prisma } from "../db/prisma.js";
import type { Prisma } from "../generated/prisma/client.js";

interface LogActionInput {
  userId: string;
  workspaceId: string;
  action: string;
  entity: string;
  entityId: string;
  meta: Record<string, unknown>;
}

export async function logAction({
  userId,
  workspaceId,
  action,
  entity,
  entityId,
  meta,
}: LogActionInput) {
  await prisma.auditLog.create({
    data: {
      userId,
      workspaceId,
      action,
      entity,
      entityId,
      meta: sanitizeMeta(meta) as Prisma.InputJsonValue,
    },
  });
}

function sanitizeMeta(meta: Record<string, unknown>) {
  const blockedKeys = new Set(["password", "token", "authorization", "hash"]);
  return Object.fromEntries(
    Object.entries(meta).filter(([key]) => !blockedKeys.has(key.toLowerCase())),
  );
}
