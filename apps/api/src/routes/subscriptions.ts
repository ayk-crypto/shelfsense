import { Router } from "express";
import { SubscriptionStatus, BillingCycle, DiscountType, Role } from "../generated/prisma/enums.js";
import { prisma } from "../db/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import { logger } from "../lib/logger.js";

export const subscriptionsRouter = Router();

const PUBLIC_PLAN_SELECT = {
  id: true,
  name: true,
  code: true,
  description: true,
  monthlyPrice: true,
  annualPrice: true,
  currency: true,
  trialDays: true,
  maxUsers: true,
  maxLocations: true,
  maxItems: true,
  maxSuppliers: true,
  enableExpiryTracking: true,
  enableBarcodeScanning: true,
  enableReports: true,
  enableAdvancedReports: true,
  enablePurchases: true,
  enableSuppliers: true,
  enableTeamManagement: true,
  enableCustomRoles: true,
  enableEmailAlerts: true,
  enableDailyOps: true,
  priceDisplayMode: true,
  sortOrder: true,
} as const;

// ── GET /subscriptions/plans ────────────────────────────────────────────────

subscriptionsRouter.get("/plans", asyncHandler(async (_req, res) => {
  const plans = await prisma.plan.findMany({
    where: { isActive: true, isPublic: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: PUBLIC_PLAN_SELECT,
  });
  return res.json({ plans });
}));

// ── GET /subscriptions/current ──────────────────────────────────────────────

subscriptionsRouter.get("/current", requireAuth, asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const sub = await prisma.subscription.findFirst({
    where: { workspaceId, status: { not: SubscriptionStatus.CANCELLED } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      billingCycle: true,
      amount: true,
      currency: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      manualNotes: true,
      plan: { select: { id: true, name: true, code: true } },
    },
  });

  return res.json({ subscription: sub ?? null });
}));

// ── Coupon validation helper ─────────────────────────────────────────────────

async function validateCoupon(
  code: string,
  planId: string,
  billingCycle: "MONTHLY" | "ANNUAL",
  baseAmount: number,
): Promise<{
  coupon: { id: string; code: string; discountType: string; discountValue: number; name: string } | null;
  discountAmount: number;
  couponMessage: string;
  valid: boolean;
}> {
  const now = new Date();

  const coupon = await prisma.coupon.findFirst({
    where: { code: { equals: code, mode: "insensitive" } },
    select: {
      id: true,
      code: true,
      name: true,
      discountType: true,
      discountValue: true,
      isActive: true,
      validFrom: true,
      validUntil: true,
      maxRedemptions: true,
      redemptionsUsed: true,
      billingCycleRestriction: true,
      couponPlans: { select: { planId: true } },
    },
  });

  if (!coupon) {
    return { coupon: null, discountAmount: 0, couponMessage: "Coupon code not found.", valid: false };
  }
  if (!coupon.isActive) {
    return { coupon: null, discountAmount: 0, couponMessage: "This coupon is no longer active.", valid: false };
  }
  if (coupon.validFrom && coupon.validFrom > now) {
    return { coupon: null, discountAmount: 0, couponMessage: "This coupon is not yet valid.", valid: false };
  }
  if (coupon.validUntil && coupon.validUntil < now) {
    return { coupon: null, discountAmount: 0, couponMessage: "This coupon has expired.", valid: false };
  }
  if (coupon.maxRedemptions !== null && coupon.redemptionsUsed >= coupon.maxRedemptions) {
    return { coupon: null, discountAmount: 0, couponMessage: "This coupon has reached its redemption limit.", valid: false };
  }
  if (coupon.billingCycleRestriction !== "ANY") {
    if (coupon.billingCycleRestriction !== billingCycle) {
      return {
        coupon: null,
        discountAmount: 0,
        couponMessage: `This coupon is only valid for ${coupon.billingCycleRestriction.toLowerCase()} billing.`,
        valid: false,
      };
    }
  }
  if (coupon.couponPlans.length > 0) {
    const applicablePlanIds = coupon.couponPlans.map((cp) => cp.planId);
    if (!applicablePlanIds.includes(planId)) {
      return { coupon: null, discountAmount: 0, couponMessage: "This coupon is not applicable to the selected plan.", valid: false };
    }
  }

  let discountAmount = 0;
  if (coupon.discountType === DiscountType.PERCENTAGE) {
    discountAmount = (baseAmount * coupon.discountValue) / 100;
  } else {
    discountAmount = coupon.discountValue;
  }
  discountAmount = Math.min(baseAmount, Math.round(discountAmount * 100) / 100);

  const discountLabel =
    coupon.discountType === DiscountType.PERCENTAGE
      ? `${coupon.discountValue}% off`
      : `${coupon.discountValue} ${coupon.code} off`;

  return {
    coupon: {
      id: coupon.id,
      code: coupon.code,
      name: coupon.name,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
    },
    discountAmount,
    couponMessage: `Coupon "${coupon.code}" applied — ${discountLabel}`,
    valid: true,
  };
}

// ── POST /subscriptions/preview ─────────────────────────────────────────────

subscriptionsRouter.post("/preview", requireAuth, asyncHandler(async (req, res) => {
  const body = req.body as { planId?: string; billingCycle?: string; couponCode?: string };
  const { planId, billingCycle, couponCode } = body;

  if (!planId || typeof planId !== "string") {
    return res.status(400).json({ error: "planId is required" });
  }

  const cycle = billingCycle === "ANNUAL" ? "ANNUAL" : ("MONTHLY" as const);

  const plan = await prisma.plan.findFirst({
    where: { id: planId, isActive: true },
    select: { id: true, name: true, code: true, monthlyPrice: true, annualPrice: true, currency: true },
  });

  if (!plan) return res.status(404).json({ error: "Plan not found" });

  const isFree = plan.code === "FREE" || (plan.monthlyPrice === 0 && plan.annualPrice === 0);
  const baseAmount = isFree ? 0 : (cycle === "ANNUAL" ? plan.annualPrice : plan.monthlyPrice);

  let discountAmount = 0;
  let couponApplied = false;
  let couponMessage = "";
  let couponData: { id: string; code: string; discountType: string; discountValue: number; name: string } | null = null;

  if (couponCode && couponCode.trim() && !isFree && baseAmount > 0) {
    const result = await validateCoupon(couponCode.trim(), planId, cycle, baseAmount);
    if (result.valid && result.coupon) {
      discountAmount = result.discountAmount;
      couponApplied = true;
      couponMessage = result.couponMessage;
      couponData = result.coupon;
    } else {
      couponMessage = result.couponMessage;
    }
  }

  const payableAmount = Math.max(0, baseAmount - discountAmount);
  const canActivateWithoutPayment = payableAmount === 0;

  return res.json({
    plan: { id: plan.id, name: plan.name, code: plan.code, currency: plan.currency },
    billingCycle: cycle,
    originalAmount: baseAmount,
    discountAmount,
    payableAmount,
    couponApplied,
    couponMessage,
    coupon: couponData,
    canActivateWithoutPayment,
  });
}));

// ── POST /subscriptions/select-plan ─────────────────────────────────────────

const PLAN_TIER_MAP: Record<string, string> = {
  FREE: "FREE",
  STARTER: "BASIC",
  PRO: "PRO",
  BUSINESS: "PRO",
  CUSTOM: "PRO",
};

subscriptionsRouter.post(
  "/select-plan",
  requireAuth,
  requireRole([Role.OWNER]),
  asyncHandler(async (req, res) => {
    const workspaceId = req.user?.workspaceId ?? null;
    if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

    const body = req.body as { planId?: string; billingCycle?: string; couponCode?: string };
    const { planId, billingCycle, couponCode } = body;

    if (!planId || typeof planId !== "string") {
      return res.status(400).json({ error: "planId is required" });
    }

    const cycle = billingCycle === "ANNUAL" ? "ANNUAL" : ("MONTHLY" as const);

    const plan = await prisma.plan.findFirst({
      where: { id: planId, isActive: true },
      select: {
        id: true, name: true, code: true,
        monthlyPrice: true, annualPrice: true, currency: true,
      },
    });

    if (!plan) return res.status(404).json({ error: "Plan not found or inactive" });

    const isFree = plan.code === "FREE" || (plan.monthlyPrice === 0 && plan.annualPrice === 0);
    const baseAmount = isFree ? 0 : (cycle === "ANNUAL" ? plan.annualPrice : plan.monthlyPrice);
    const dbBillingCycle: BillingCycle = isFree
      ? BillingCycle.MANUAL
      : cycle === "ANNUAL"
      ? BillingCycle.ANNUAL
      : BillingCycle.MONTHLY;

    let discountAmount = 0;
    let couponId: string | null = null;

    if (couponCode && couponCode.trim() && !isFree && baseAmount > 0) {
      const validation = await validateCoupon(couponCode.trim(), planId, cycle, baseAmount);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.couponMessage });
      }
      discountAmount = validation.discountAmount;
      couponId = validation.coupon?.id ?? null;
    }

    const payableAmount = Math.max(0, baseAmount - discountAmount);
    const canActivate = isFree || payableAmount === 0;

    const subStatus: SubscriptionStatus = canActivate
      ? SubscriptionStatus.ACTIVE
      : SubscriptionStatus.MANUAL_REVIEW;

    const workspacePlanTier = PLAN_TIER_MAP[plan.code] ?? "FREE";
    const now = new Date();

    const sub = await prisma.$transaction(async (tx) => {
      await tx.subscription.updateMany({
        where: {
          workspaceId,
          status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL, SubscriptionStatus.MANUAL_REVIEW] },
        },
        data: { status: SubscriptionStatus.CANCELLED },
      });

      const created = await tx.subscription.create({
        data: {
          workspaceId,
          planId,
          status: subStatus,
          billingCycle: dbBillingCycle,
          currency: plan.currency,
          amount: payableAmount,
          couponId,
          currentPeriodStart: canActivate ? now : null,
          currentPeriodEnd:
            canActivate && !isFree
              ? new Date(
                  cycle === "ANNUAL"
                    ? now.getTime() + 365 * 24 * 60 * 60 * 1000
                    : now.getTime() + 30 * 24 * 60 * 60 * 1000,
                )
              : null,
          manualNotes: canActivate ? null : "Awaiting payment — no payment gateway configured.",
        },
      });

      if (couponId) {
        await tx.coupon.update({
          where: { id: couponId },
          data: { redemptionsUsed: { increment: 1 } },
        });
      }

      await tx.workspace.update({
        where: { id: workspaceId },
        data: {
          plan: workspacePlanTier as "FREE" | "BASIC" | "PRO",
          onboardingCompleted: true,
        },
      });

      return created;
    });

    logger.info("[SUBSCRIPTIONS] plan selected", {
      workspaceId,
      planCode: plan.code,
      status: subStatus,
      payableAmount,
      couponUsed: couponId != null,
    });

    return res.json({
      ok: true,
      subscription: {
        id: sub.id,
        status: sub.status,
        billingCycle: sub.billingCycle,
        payableAmount,
        pendingPayment: subStatus === SubscriptionStatus.MANUAL_REVIEW,
        planName: plan.name,
        planCode: plan.code,
      },
    });
  }),
);
