import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db/prisma.js";
import { SubscriptionStatus } from "../generated/prisma/enums.js";
import { logger } from "../lib/logger.js";

export type PlanFeatureKey =
  | "enablePurchases"
  | "enableSuppliers"
  | "enableTeamManagement"
  | "enableCustomRoles"
  | "enableAdvancedReports"
  | "enableEmailAlerts"
  | "enableDailyOps"
  | "enableReports"
  | "enableExpiryTracking"
  | "enableBarcodeScanning";

const REQUIRED_PLAN_LABEL: Record<PlanFeatureKey, string> = {
  enablePurchases: "Basic",
  enableSuppliers: "Basic",
  enableTeamManagement: "Basic",
  enableCustomRoles: "Pro",
  enableAdvancedReports: "Pro",
  enableEmailAlerts: "Basic",
  enableDailyOps: "Basic",
  enableReports: "Basic",
  enableExpiryTracking: "Basic",
  enableBarcodeScanning: "Basic",
};

export function requirePlanFeature(feature: PlanFeatureKey) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const workspaceId = req.user?.workspaceId ?? null;
    if (!workspaceId) {
      return res.status(403).json({ error: "Workspace access required" });
    }

    try {
      const sub = await prisma.subscription.findFirst({
        where: {
          workspaceId,
          status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL, SubscriptionStatus.MANUAL_REVIEW] },
        },
        orderBy: { createdAt: "desc" },
        select: {
          plan: {
            select: {
              name: true,
              [feature]: true,
            },
          },
        },
      });

      const featureEnabled = sub?.plan?.[feature as keyof typeof sub.plan];

      if (!featureEnabled) {
        logger.warn("[PLAN] Feature access denied", {
          workspaceId,
          feature,
          path: req.path,
          method: req.method,
        });
        return res.status(403).json({
          error: `This feature requires the ${REQUIRED_PLAN_LABEL[feature]} plan or higher. Upgrade your plan to access it.`,
          code: "PLAN_FEATURE_REQUIRED",
          feature,
          requiredPlan: REQUIRED_PLAN_LABEL[feature],
          upgradeRequired: true,
        });
      }

      return next();
    } catch (err) {
      logger.error("[PLAN] Failed to check plan feature", {
        error: String(err),
        workspaceId,
        feature,
      });
      return next();
    }
  };
}
