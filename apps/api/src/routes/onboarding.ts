import { Router } from "express";
import { Role } from "../generated/prisma/enums.js";
import { prisma } from "../db/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import { ensureDefaultLocation } from "../utils/locations.js";

export const onboardingRouter = Router();

onboardingRouter.use(requireAuth);

onboardingRouter.get("/status", asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  await ensureDefaultLocation(workspaceId);

  const [workspace, itemsCount, suppliersCount, locationsCount] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { onboardingCompleted: true },
    }),
    prisma.item.count({ where: { workspaceId } }),
    prisma.supplier.count({ where: { workspaceId } }),
    prisma.location.count({ where: { workspaceId } }),
  ]);

  if (!workspace) {
    return res.status(404).json({ error: "Workspace not found" });
  }

  return res.json({
    onboardingCompleted: workspace.onboardingCompleted,
    hasItems: itemsCount > 0,
    hasSuppliers: suppliersCount > 0,
    hasLocations: locationsCount > 0,
  });
}));

onboardingRouter.patch(
  "/complete",
  requireRole([Role.OWNER]),
  asyncHandler(async (req, res) => {
    const workspaceId = req.user?.workspaceId ?? null;

    if (!workspaceId) {
      return res.status(403).json({ error: "Workspace access required" });
    }

    const workspace = await prisma.workspace.update({
      where: { id: workspaceId },
      data: { onboardingCompleted: true },
      select: { onboardingCompleted: true },
    });

    return res.json({ onboardingCompleted: workspace.onboardingCompleted });
  }),
);
