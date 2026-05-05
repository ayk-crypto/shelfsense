import { Router } from "express";
import { Role, SubscriptionStatus } from "../generated/prisma/enums.js";
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

  const [workspace, itemsCount, suppliersCount, locationsCount, subscription] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { onboardingCompleted: true, onboardingStep: true },
    }),
    prisma.item.count({ where: { workspaceId } }),
    prisma.supplier.count({ where: { workspaceId } }),
    prisma.location.count({ where: { workspaceId } }),
    prisma.subscription.findFirst({
      where: { workspaceId, status: { not: SubscriptionStatus.CANCELLED } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    }),
  ]);

  if (!workspace) {
    return res.status(404).json({ error: "Workspace not found" });
  }

  const hasSelectedPlan = subscription !== null;
  const subscriptionStatus = subscription?.status ?? null;

  let nextStep: "WORKSPACE_SETUP" | "PLAN_SELECTION" | "DASHBOARD" = "WORKSPACE_SETUP";
  if (workspace.onboardingCompleted && hasSelectedPlan) {
    nextStep = "DASHBOARD";
  } else if (workspace.onboardingCompleted && !hasSelectedPlan) {
    nextStep = "PLAN_SELECTION";
  } else {
    nextStep = "WORKSPACE_SETUP";
  }

  return res.json({
    onboardingCompleted: workspace.onboardingCompleted,
    currentStep: workspace.onboardingStep,
    hasItems: itemsCount > 0,
    hasSuppliers: suppliersCount > 0,
    hasLocations: locationsCount > 0,
    hasSelectedPlan,
    subscriptionStatus,
    nextStep,
  });
}));

onboardingRouter.patch(
  "/step",
  requireRole([Role.OWNER]),
  asyncHandler(async (req, res) => {
    const workspaceId = req.user?.workspaceId ?? null;

    if (!workspaceId) {
      return res.status(403).json({ error: "Workspace access required" });
    }

    const body = req.body as { step?: unknown };
    const step = typeof body.step === "number" && Number.isInteger(body.step) && body.step >= 0 && body.step <= 5
      ? body.step
      : null;

    if (step === null) {
      return res.status(400).json({ error: "step must be an integer between 0 and 5" });
    }

    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { onboardingStep: step },
    });

    return res.json({ currentStep: step });
  }),
);

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
      data: { onboardingCompleted: true, onboardingStep: 5 },
      select: { onboardingCompleted: true },
    });

    return res.json({ onboardingCompleted: workspace.onboardingCompleted });
  }),
);
