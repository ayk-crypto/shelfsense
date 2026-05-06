import { Router } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../utils/async-handler.js";

export const adminAnnouncementsRouter = Router();

async function logAdminAction(
  adminId: string,
  action: string,
  entity: string,
  entityId: string,
  meta: Record<string, unknown> = {},
) {
  await prisma.adminAuditLog.create({
    data: { adminId, action, entity, entityId, meta: meta as Prisma.InputJsonValue },
  });
}

const ANN_SELECT = {
  id: true,
  title: true,
  message: true,
  severity: true,
  targetType: true,
  targetPlanId: true,
  targetWorkspaceId: true,
  startsAt: true,
  endsAt: true,
  dismissible: true,
  isActive: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, name: true } },
} as const;

adminAnnouncementsRouter.get("/", asyncHandler(async (req, res) => {
  const active = typeof req.query.active === "string" ? req.query.active : undefined;
  const where: Record<string, unknown> = {};
  if (active === "true") where.isActive = true;
  if (active === "false") where.isActive = false;

  const announcements = await prisma.announcement.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: ANN_SELECT,
  });

  return res.json({ announcements });
}));

adminAnnouncementsRouter.post("/", asyncHandler(async (req, res) => {
  const adminId = req.user!.id;
  const body = req.body as {
    title: string;
    message: string;
    severity?: "INFO" | "SUCCESS" | "WARNING" | "CRITICAL";
    targetType?: "ALL" | "PLAN" | "WORKSPACE";
    targetPlanId?: string | null;
    targetWorkspaceId?: string | null;
    startsAt?: string | null;
    endsAt?: string | null;
    dismissible?: boolean;
  };

  if (!body.title?.trim() || !body.message?.trim()) {
    return res.status(400).json({ error: "title and message are required" });
  }

  const ann = await prisma.announcement.create({
    data: {
      title: body.title.trim(),
      message: body.message.trim(),
      severity: body.severity ?? "INFO",
      targetType: body.targetType ?? "ALL",
      targetPlanId: body.targetPlanId ?? null,
      targetWorkspaceId: body.targetWorkspaceId ?? null,
      startsAt: body.startsAt ? new Date(body.startsAt) : null,
      endsAt: body.endsAt ? new Date(body.endsAt) : null,
      dismissible: body.dismissible ?? true,
      createdByUserId: adminId,
    },
    select: ANN_SELECT,
  });

  await logAdminAction(adminId, "announcement_created", "announcement", ann.id, { title: ann.title });

  return res.status(201).json({ announcement: ann });
}));

adminAnnouncementsRouter.get("/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const ann = await prisma.announcement.findUnique({ where: { id }, select: ANN_SELECT });
  if (!ann) return res.status(404).json({ error: "Announcement not found" });
  return res.json({ announcement: ann });
}));

adminAnnouncementsRouter.patch("/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const body = req.body as Partial<{
    title: string;
    message: string;
    severity: string;
    targetType: string;
    targetPlanId: string | null;
    targetWorkspaceId: string | null;
    startsAt: string | null;
    endsAt: string | null;
    dismissible: boolean;
  }>;

  const ann = await prisma.announcement.findUnique({ where: { id } });
  if (!ann) return res.status(404).json({ error: "Announcement not found" });

  const data: Record<string, unknown> = {};
  if (body.title !== undefined) data.title = body.title.trim();
  if (body.message !== undefined) data.message = body.message.trim();
  if (body.severity !== undefined) data.severity = body.severity;
  if (body.targetType !== undefined) data.targetType = body.targetType;
  if (body.targetPlanId !== undefined) data.targetPlanId = body.targetPlanId;
  if (body.targetWorkspaceId !== undefined) data.targetWorkspaceId = body.targetWorkspaceId;
  if (body.startsAt !== undefined) data.startsAt = body.startsAt ? new Date(body.startsAt) : null;
  if (body.endsAt !== undefined) data.endsAt = body.endsAt ? new Date(body.endsAt) : null;
  if (body.dismissible !== undefined) data.dismissible = body.dismissible;

  const updated = await prisma.announcement.update({ where: { id }, data, select: ANN_SELECT });

  await logAdminAction(adminId, "announcement_updated", "announcement", id, { title: ann.title, changes: Object.keys(data) });

  return res.json({ announcement: updated });
}));

adminAnnouncementsRouter.delete("/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;

  const ann = await prisma.announcement.findUnique({ where: { id }, select: { id: true, title: true } });
  if (!ann) return res.status(404).json({ error: "Announcement not found" });

  await prisma.announcement.delete({ where: { id } });

  await logAdminAction(adminId, "announcement_deleted", "announcement", id, { title: ann.title });

  return res.json({ ok: true });
}));

adminAnnouncementsRouter.patch("/:id/status", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const { isActive } = req.body as { isActive: boolean };

  if (typeof isActive !== "boolean") {
    return res.status(400).json({ error: "isActive (boolean) is required" });
  }

  const ann = await prisma.announcement.findUnique({ where: { id } });
  if (!ann) return res.status(404).json({ error: "Announcement not found" });

  await prisma.announcement.update({ where: { id }, data: { isActive } });

  await logAdminAction(adminId, isActive ? "announcement_enabled" : "announcement_disabled", "announcement", id, { title: ann.title });

  return res.json({ ok: true, isActive });
}));
