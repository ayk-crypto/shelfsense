import { Router } from "express";
import crypto from "crypto";
import { SubscriptionStatus, BillingCycle, PaymentMethod, PaymentStatus, Role } from "../generated/prisma/enums.js";
import { DiscountType } from "../generated/prisma/enums.js";
import { prisma } from "../db/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import { getPaymentProvider } from "../lib/payment-provider/index.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { getPaddlePriceId } from "../lib/paddle-config.js";

export const billingRouter = Router();

const PLAN_TIER_MAP: Record<string, string> = {
  FREE: "FREE",
  STARTER: "BASIC",
  PRO: "PRO",
  BUSINESS: "PRO",
  CUSTOM: "PRO",
};

// ── Coupon validation (shared helper) ───────────────────────────────────────

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
      id: true, code: true, name: true,
      discountType: true, discountValue: true, isActive: true,
      validFrom: true, validUntil: true,
      maxRedemptions: true, redemptionsUsed: true,
      billingCycleRestriction: true,
      couponPlans: { select: { planId: true } },
    },
  });

  if (!coupon)
    return { coupon: null, discountAmount: 0, couponMessage: "Coupon code not found.", valid: false };
  if (!coupon.isActive)
    return { coupon: null, discountAmount: 0, couponMessage: "This coupon is no longer active.", valid: false };
  if (coupon.validFrom && coupon.validFrom > now)
    return { coupon: null, discountAmount: 0, couponMessage: "This coupon is not yet valid.", valid: false };
  if (coupon.validUntil && coupon.validUntil < now)
    return { coupon: null, discountAmount: 0, couponMessage: "This coupon has expired.", valid: false };
  if (coupon.maxRedemptions !== null && coupon.redemptionsUsed >= coupon.maxRedemptions)
    return { coupon: null, discountAmount: 0, couponMessage: "This coupon has reached its redemption limit.", valid: false };
  if (coupon.billingCycleRestriction !== "ANY" && coupon.billingCycleRestriction !== billingCycle)
    return {
      coupon: null, discountAmount: 0,
      couponMessage: `This coupon is only valid for ${coupon.billingCycleRestriction.toLowerCase()} billing.`,
      valid: false,
    };
  if (coupon.couponPlans.length > 0 && !coupon.couponPlans.map((cp) => cp.planId).includes(planId))
    return { coupon: null, discountAmount: 0, couponMessage: "This coupon is not applicable to the selected plan.", valid: false };

  let discountAmount = 0;
  if (coupon.discountType === DiscountType.PERCENTAGE) {
    discountAmount = (baseAmount * coupon.discountValue) / 100;
  } else {
    discountAmount = coupon.discountValue;
  }
  discountAmount = Math.min(baseAmount, Math.round(discountAmount * 100) / 100);

  return {
    coupon: { id: coupon.id, code: coupon.code, name: coupon.name, discountType: coupon.discountType, discountValue: coupon.discountValue },
    discountAmount,
    couponMessage: `Coupon "${coupon.code}" applied.`,
    valid: true,
  };
}

// ── GET /billing/subscription ───────────────────────────────────────────────

billingRouter.get(
  "/subscription",
  requireAuth,
  asyncHandler(async (req, res) => {
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
        nextRenewalAt: true,
        nextBillingAt: true,
        cancelAtPeriodEnd: true,
        manualNotes: true,
        gatewayProvider: true,
        gatewayStatus: true,
        createdAt: true,
        plan: {
          select: {
            id: true, name: true, code: true,
            monthlyPrice: true, annualPrice: true, currency: true,
            maxUsers: true, maxLocations: true, maxItems: true,
            enableAdvancedReports: true, enableCustomRoles: true,
            enablePurchases: true, enableSuppliers: true, enableTeamManagement: true,
          },
        },
        coupon: { select: { id: true, code: true, name: true, discountType: true, discountValue: true } },
        payments: {
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true, amount: true, currency: true, paymentMethod: true,
            status: true, paidAt: true, referenceNumber: true, createdAt: true,
          },
        },
      },
    });

    return res.json({ subscription: sub ?? null, provider: env.paymentProvider });
  }),
);

// ── POST /billing/checkout ──────────────────────────────────────────────────

billingRouter.post(
  "/checkout",
  requireAuth,
  requireRole([Role.OWNER]),
  asyncHandler(async (req, res) => {
    const workspaceId = req.user?.workspaceId ?? null;
    const userId = req.user?.userId ?? null;
    if (!workspaceId || !userId) return res.status(403).json({ error: "Workspace access required" });

    const body = req.body as { planId?: string; billingCycle?: string; couponCode?: string };
    const { planId, billingCycle, couponCode } = body;

    if (!planId || typeof planId !== "string")
      return res.status(400).json({ error: "planId is required" });

    const cycle = billingCycle === "ANNUAL" ? "ANNUAL" : ("MONTHLY" as const);

    const [plan, user] = await Promise.all([
      prisma.plan.findFirst({
        where: { id: planId, isActive: true },
        select: { id: true, name: true, code: true, monthlyPrice: true, annualPrice: true, currency: true },
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }),
    ]);

    if (!plan) return res.status(404).json({ error: "Plan not found or inactive" });
    if (!user) return res.status(404).json({ error: "User not found" });

    const isFree = plan.code === "FREE" || (plan.monthlyPrice === 0 && plan.annualPrice === 0);
    const baseAmount = isFree ? 0 : (cycle === "ANNUAL" ? plan.annualPrice : plan.monthlyPrice);
    const dbBillingCycle: BillingCycle = isFree
      ? BillingCycle.MANUAL
      : cycle === "ANNUAL"
      ? BillingCycle.ANNUAL
      : BillingCycle.MONTHLY;

    let discountAmount = 0;
    let couponId: string | null = null;

    if (couponCode?.trim() && !isFree && baseAmount > 0) {
      const validation = await validateCoupon(couponCode.trim(), planId, cycle, baseAmount);
      if (!validation.valid) return res.status(400).json({ error: validation.couponMessage });
      discountAmount = validation.discountAmount;
      couponId = validation.coupon?.id ?? null;
    }

    const payableAmount = Math.max(0, baseAmount - discountAmount);
    const canActivate = isFree || payableAmount === 0;
    const workspacePlanTier = PLAN_TIER_MAP[plan.code] ?? "FREE";
    const now = new Date();

    // When Paddle is the payment provider, paid plans MUST go through the
    // Paddle overlay checkout + webhook confirmation. Prevent any direct
    // activation (including the MANUAL_REVIEW fallback path) for paid plans.
    if (env.paymentProvider === "paddle" && !canActivate) {
      logger.warn("[BILLING] Blocked non-Paddle paid checkout — PAYMENT_PROVIDER=paddle", {
        workspaceId, planCode: plan.code, planId,
      });
      return res.status(403).json({
        error: "Paid plan activation must go through Paddle checkout. Use POST /billing/paddle/checkout instead.",
        code: "PADDLE_CHECKOUT_REQUIRED",
      });
    }

    if (canActivate) {
      const sub = await prisma.$transaction(async (tx) => {
        await tx.subscription.updateMany({
          where: { workspaceId, status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL, SubscriptionStatus.MANUAL_REVIEW] } },
          data: { status: SubscriptionStatus.CANCELLED },
        });
        const created = await tx.subscription.create({
          data: {
            workspaceId, planId, status: SubscriptionStatus.ACTIVE,
            billingCycle: dbBillingCycle, currency: plan.currency, amount: payableAmount, couponId,
            currentPeriodStart: now,
            currentPeriodEnd: isFree ? null : new Date(now.getTime() + (cycle === "ANNUAL" ? 365 : 30) * 24 * 60 * 60 * 1000),
          },
        });
        if (couponId) await tx.coupon.update({ where: { id: couponId }, data: { redemptionsUsed: { increment: 1 } } });
        await tx.workspace.update({ where: { id: workspaceId }, data: { plan: workspacePlanTier as "FREE" | "BASIC" | "PRO", onboardingCompleted: true } });
        return created;
      });

      logger.info("[BILLING] free/discounted checkout activated", { workspaceId, planCode: plan.code });
      return res.json({ ok: true, isFree: true, subscriptionId: sub.id, status: "ACTIVE" });
    }

    const provider = getPaymentProvider();
    const idempotencyKey = crypto.randomBytes(20).toString("hex");

    const { sub, payment } = await prisma.$transaction(async (tx) => {
      await tx.subscription.updateMany({
        where: { workspaceId, status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL, SubscriptionStatus.MANUAL_REVIEW] } },
        data: { status: SubscriptionStatus.CANCELLED },
      });

      if (couponId) await tx.coupon.update({ where: { id: couponId }, data: { redemptionsUsed: { increment: 1 } } });

      const created = await tx.subscription.create({
        data: {
          workspaceId, planId, status: SubscriptionStatus.MANUAL_REVIEW,
          billingCycle: dbBillingCycle, currency: plan.currency, amount: payableAmount, couponId,
          gatewayProvider: provider.name,
          manualNotes: `Awaiting payment via ${provider.name} gateway.`,
        },
      });

      await tx.workspace.update({
        where: { id: workspaceId },
        data: { plan: workspacePlanTier as "FREE" | "BASIC" | "PRO", onboardingCompleted: true },
      });

      const pmt = await tx.payment.create({
        data: {
          workspaceId, subscriptionId: created.id,
          amount: payableAmount, currency: plan.currency,
          paymentMethod: (provider.name === "mock" ? PaymentMethod.MOCK : provider.name === "payfast" ? PaymentMethod.PAYFAST : PaymentMethod.SAFEPAY),
          status: PaymentStatus.PENDING,
          gatewayProvider: provider.name,
          recordedByUserId: userId,
          notes: `Checkout initiated via ${provider.name}. Key: ${idempotencyKey}`,
        },
      });

      await tx.billingEvent.create({
        data: {
          workspaceId, eventType: "checkout_initiated",
          gatewayProvider: provider.name, gatewayEventId: `init_${idempotencyKey}`,
          subscriptionId: created.id, paymentId: pmt.id,
          payload: { planId, billingCycle: cycle, amount: payableAmount, couponId, idempotencyKey },
        },
      });

      return { sub: created, payment: pmt };
    });

    const checkoutResult = await provider.createCheckout({
      idempotencyKey,
      subscriptionId: sub.id,
      paymentId: payment.id,
      workspaceId,
      amount: payableAmount,
      currency: plan.currency,
      planName: plan.name,
      billingCycle: cycle,
      customerEmail: user.email,
      successUrl: `${env.appUrl}/billing/success?subscriptionId=${sub.id}`,
      cancelUrl: `${env.appUrl}/billing/failed?subscriptionId=${sub.id}`,
    });

    await prisma.subscription.update({
      where: { id: sub.id },
      data: { gatewaySubscriptionId: checkoutResult.gatewayReference ?? null, gatewayCustomerId: checkoutResult.gatewayCustomerId ?? null },
    });

    await prisma.payment.update({
      where: { id: payment.id },
      data: { gatewayReference: checkoutResult.gatewayReference ?? null },
    });

    logger.info("[BILLING] checkout initiated", {
      workspaceId, planCode: plan.code, provider: provider.name, amount: payableAmount,
    });

    return res.json({
      ok: true, isFree: false, checkoutUrl: checkoutResult.checkoutUrl,
      subscriptionId: sub.id, paymentId: payment.id,
      amount: payableAmount, currency: plan.currency,
    });
  }),
);

// ── POST /billing/webhooks/mock ─────────────────────────────────────────────
// Simulates a gateway callback for the mock provider.
// Body: { token: string, paymentId: string, subscriptionId: string, action: "pay" | "cancel" }

billingRouter.post(
  "/webhooks/mock",
  asyncHandler(async (req, res) => {
    if (env.paymentProvider !== "mock") {
      return res.status(403).json({ error: "Mock webhook is only available when PAYMENT_PROVIDER=mock" });
    }

    const { token, paymentId, subscriptionId, action } = req.body as {
      token: string;
      paymentId: string;
      subscriptionId: string;
      action: "pay" | "cancel";
    };

    if (!token || !paymentId || !subscriptionId || !["pay", "cancel"].includes(action)) {
      return res.status(400).json({ error: "token, paymentId, subscriptionId and action (pay|cancel) are required" });
    }

    const eventId = `${action}_${token}`;

    const existing = await prisma.billingEvent.findUnique({
      where: { gatewayProvider_gatewayEventId: { gatewayProvider: "mock", gatewayEventId: eventId } },
    });
    if (existing) {
      return res.json({ ok: true, idempotent: true, status: action === "pay" ? "ACTIVE" : "CANCELLED" });
    }

    const [payment, sub] = await Promise.all([
      prisma.payment.findUnique({ where: { id: paymentId }, select: { id: true, workspaceId: true, subscriptionId: true, amount: true } }),
      prisma.subscription.findUnique({ where: { id: subscriptionId }, select: { id: true, workspaceId: true, planId: true, billingCycle: true, amount: true } }),
    ]);

    if (!payment || !sub) return res.status(404).json({ error: "Payment or subscription not found" });
    if (payment.workspaceId !== sub.workspaceId) return res.status(400).json({ error: "Mismatch: payment and subscription belong to different workspaces" });

    const now = new Date();

    if (action === "pay") {
      const periodEnd = sub.billingCycle === "ANNUAL"
        ? new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
        : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      await prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: paymentId },
          data: { status: PaymentStatus.PAID, paidAt: now, gatewayReference: `mock_paid_${token}` },
        });

        await tx.subscription.update({
          where: { id: subscriptionId },
          data: {
            status: SubscriptionStatus.ACTIVE,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            nextRenewalAt: periodEnd,
            manualNotes: null,
          },
        });

        await tx.billingEvent.create({
          data: {
            workspaceId: sub.workspaceId, eventType: "payment_completed",
            gatewayProvider: "mock", gatewayEventId: eventId,
            subscriptionId, paymentId,
            payload: { action, token, amount: payment.amount },
          },
        });
      });

      logger.info("[BILLING][MOCK] payment completed", { workspaceId: sub.workspaceId, subscriptionId, paymentId });
      return res.json({ ok: true, status: "ACTIVE" });
    } else {
      await prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: paymentId },
          data: { status: PaymentStatus.CANCELLED },
        });

        await tx.subscription.update({
          where: { id: subscriptionId },
          data: { status: SubscriptionStatus.CANCELLED, manualNotes: "Payment cancelled by user." },
        });

        await tx.billingEvent.create({
          data: {
            workspaceId: sub.workspaceId, eventType: "payment_cancelled",
            gatewayProvider: "mock", gatewayEventId: eventId,
            subscriptionId, paymentId,
            payload: { action, token },
          },
        });
      });

      logger.info("[BILLING][MOCK] payment cancelled", { workspaceId: sub.workspaceId, subscriptionId, paymentId });
      return res.json({ ok: true, status: "CANCELLED" });
    }
  }),
);

// ── POST /billing/paddle/checkout ───────────────────────────────────────────
// Returns priceId + customData for the frontend to open Paddle overlay.
// Does NOT activate the subscription — that happens after the verified webhook.

billingRouter.post(
  "/paddle/checkout",
  requireAuth,
  requireRole([Role.OWNER]),
  asyncHandler(async (req, res) => {
    const userId = req.user?.userId ?? null;
    const workspaceId = req.user?.workspaceId ?? null;
    if (!workspaceId || !userId) return res.status(403).json({ error: "Workspace access required" });

    const { planCode, billingCycle } = req.body as { planCode?: string; billingCycle?: string };

    if (!planCode || typeof planCode !== "string") {
      return res.status(400).json({ error: "planCode is required" });
    }

    const upperCode = planCode.toUpperCase();

    if (upperCode === "BUSINESS") {
      return res.status(400).json({
        error: "Business plan requires contacting sales.",
        contactSales: true,
        contactEmail: "sales@shelfsenseapp.com",
      });
    }

    if (env.paymentProvider !== "paddle") {
      return res.status(400).json({
        error: "Paddle checkout is not available. The active payment provider is not Paddle.",
        code: "PADDLE_NOT_CONFIGURED",
      });
    }

    if (upperCode === "FREE") {
      return res.status(400).json({ error: "Free plan does not go through Paddle checkout. Use /billing/checkout instead." });
    }

    if (!["BASIC", "PRO", "STARTER"].includes(upperCode)) {
      return res.status(400).json({ error: "planCode must be BASIC, PRO, or BUSINESS" });
    }

    const cycle = billingCycle === "ANNUAL" ? "ANNUAL" : ("MONTHLY" as const);

    const priceId = getPaddlePriceId(upperCode, cycle);
    if (!priceId) {
      logger.error("[PADDLE] Price ID not configured", { planCode: upperCode, billingCycle: cycle });
      return res.status(500).json({ error: `Paddle price ID not configured for ${upperCode} ${cycle}. Contact support.` });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    logger.info("[PADDLE] Checkout requested", {
      workspaceId,
      planCode: upperCode,
      billingCycle: cycle,
      priceId: priceId.slice(0, 10) + "...",
    });

    return res.json({
      success: true,
      priceId,
      customerEmail: user.email,
      customData: {
        workspaceId,
        userId,
        planCode: upperCode,
        billingCycle: cycle,
      },
    });
  }),
);

// ── GET /billing/subscription/:workspaceId ───────────────────────────────────
// Same as GET /billing/subscription but accepts workspaceId as URL param.
// Validates the requesting user belongs to that workspace.

billingRouter.get(
  "/subscription/:workspaceId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params;
    const userWorkspaceId = req.user?.workspaceId ?? null;

    if (!userWorkspaceId || workspaceId !== userWorkspaceId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const sub = await prisma.subscription.findFirst({
      where: { workspaceId, status: { not: SubscriptionStatus.CANCELLED } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, status: true, billingCycle: true, amount: true, currency: true,
        currentPeriodStart: true, currentPeriodEnd: true, nextRenewalAt: true, nextBillingAt: true,
        cancelAtPeriodEnd: true, manualNotes: true, gatewayProvider: true, gatewayStatus: true,
        createdAt: true,
        plan: {
          select: {
            id: true, name: true, code: true,
            monthlyPrice: true, annualPrice: true, currency: true,
            maxUsers: true, maxLocations: true, maxItems: true,
            enableAdvancedReports: true, enableCustomRoles: true,
            enablePurchases: true, enableSuppliers: true, enableTeamManagement: true,
          },
        },
        coupon: { select: { id: true, code: true, name: true, discountType: true, discountValue: true } },
        payments: {
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true, amount: true, currency: true, paymentMethod: true,
            status: true, paidAt: true, referenceNumber: true, createdAt: true,
          },
        },
      },
    });

    return res.json({ subscription: sub ?? null, provider: env.paymentProvider });
  }),
);

// ── GET /billing/invoices ────────────────────────────────────────────────────

billingRouter.get(
  "/invoices",
  requireAuth,
  asyncHandler(async (req, res) => {
    const workspaceId = req.user?.workspaceId ?? null;
    if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

    const invoices = await prisma.invoice.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true, invoiceNumber: true, amount: true, currency: true,
        status: true, issuedAt: true, dueAt: true, paidAt: true, createdAt: true,
      },
    });

    return res.json({ invoices });
  }),
);
