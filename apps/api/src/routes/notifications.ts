import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

notificationsRouter.get("/", asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;
  const userId = req.user?.userId ?? null;

  if (!workspaceId || !userId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: getNotificationAccessWhere(workspaceId, userId),
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.notification.count({
      where: {
        ...getNotificationAccessWhere(workspaceId, userId),
        readAt: null,
      },
    }),
  ]);

  return res.json({ notifications, unreadCount });
}));

notificationsRouter.patch("/read-all", asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;
  const userId = req.user?.userId ?? null;

  if (!workspaceId || !userId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const result = await prisma.notification.updateMany({
    where: {
      ...getNotificationAccessWhere(workspaceId, userId),
      readAt: null,
    },
    data: { readAt: new Date() },
  });

  return res.json({ updatedCount: result.count });
}));

notificationsRouter.patch("/:id/read", asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;
  const userId = req.user?.userId ?? null;

  if (!workspaceId || !userId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const notification = await prisma.notification.findFirst({
    where: {
      id: req.params.id,
      ...getNotificationAccessWhere(workspaceId, userId),
    },
  });

  if (!notification) {
    return res.status(404).json({ error: "Notification not found" });
  }

  const updated = await prisma.notification.update({
    where: { id: notification.id },
    data: { readAt: notification.readAt ?? new Date() },
  });

  return res.json({ notification: updated });
}));

function getNotificationAccessWhere(workspaceId: string, userId: string) {
  return {
    workspaceId,
    OR: [
      { userId },
      { userId: null },
    ],
  };
}
