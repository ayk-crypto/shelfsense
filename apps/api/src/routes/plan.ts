import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import { PLAN_LIMITS, type PlanTier } from "../utils/plan-limits.js";
import { Role } from "../generated/prisma/enums.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

export const planRouter = Router();

const VALID_PLANS: PlanTier[] = ["FREE", "BASIC", "PRO"];

async function buildPlanStatus(workspaceId: string, plan: PlanTier) {
  const [itemCount, locationCount, memberCount] = await Promise.all([
    prisma.item.count({ where: { workspaceId, isActive: true } }),
    prisma.location.count({ where: { workspaceId, isActive: true } }),
    prisma.membership.count({ where: { workspaceId, isActive: true } }),
  ]);

  return {
    plan,
    limits: PLAN_LIMITS[plan],
    usage: {
      items: itemCount,
      locations: locationCount,
      users: memberCount,
    },
  };
}

planRouter.get(
  "/status",
  requireAuth,
  asyncHandler(async (req, res) => {
    const workspaceId = req.user?.workspaceId ?? null;
    if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { plan: true },
    });

    if (!workspace) return res.status(404).json({ error: "Workspace not found" });

    return res.json(await buildPlanStatus(workspaceId, workspace.plan as PlanTier));
  }),
);

planRouter.patch(
  "/",
  requireAuth,
  requireRole([Role.OWNER]),
  asyncHandler(async (req, res) => {
    const workspaceId = req.user?.workspaceId ?? null;
    if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

    const body = req.body as { plan?: unknown };
    const requestedPlan = typeof body.plan === "string" ? (body.plan as PlanTier) : undefined;

    if (!requestedPlan || !VALID_PLANS.includes(requestedPlan)) {
      return res.status(400).json({ error: "Valid plan is required: FREE, BASIC, or PRO" });
    }

    // Block direct paid-plan activation when Paddle is the payment provider.
    // Paid plans must be activated via Paddle checkout + webhook confirmation.
    // Downgrading to FREE is always permitted directly.
    if (env.paymentProvider === "paddle" && requestedPlan !== "FREE") {
      logger.warn("[PLAN] Blocked direct paid plan change — Paddle checkout required", {
        workspaceId, requestedPlan,
      });
      return res.status(403).json({
        error: "Paid plan changes require Paddle checkout. Please use the billing page.",
        code: "PADDLE_CHECKOUT_REQUIRED",
        redirectTo: `/billing/checkout?plan=${requestedPlan}`,
      });
    }

    const workspace = await prisma.workspace.update({
      where: { id: workspaceId },
      data: { plan: requestedPlan },
      select: { plan: true },
    });

    return res.json(await buildPlanStatus(workspaceId, workspace.plan as PlanTier));
  }),
);
