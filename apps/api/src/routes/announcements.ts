import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";

export const announcementsRouter = Router();

announcementsRouter.use(requireAuth);

announcementsRouter.get("/active", asyncHandler(async (req, res) => {
  const now = new Date();
  const workspaceId = req.user!.workspaceId;

  const announcements = await prisma.announcement.findMany({
    where: {
      isActive: true,
      OR: [{ startsAt: null }, { startsAt: { lte: now } }],
      AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      message: true,
      severity: true,
      targetType: true,
      targetWorkspaceId: true,
      dismissible: true,
      createdAt: true,
    },
  });

  const filtered = announcements.filter((a) => {
    if (a.targetType === "ALL") return true;
    if (a.targetType === "WORKSPACE" && workspaceId && a.targetWorkspaceId === workspaceId) return true;
    return false;
  });

  return res.json({ announcements: filtered });
}));
