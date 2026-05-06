import { Router } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { PlatformRole } from "../generated/prisma/enums.js";
import { prisma } from "../db/prisma.js";
import { requireAuth, requirePlatformAdmin } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import { sendEmailVerificationEmail, sendPasswordResetEmail } from "../services/email.js";
import crypto from "crypto";
import { adminPlansRouter } from "./admin-plans.js";
import { adminCouponsRouter } from "./admin-coupons.js";
import { adminSubscriptionsRouter } from "./admin-subscriptions.js";
import { adminPaymentsRouter } from "./admin-payments.js";
import { adminEmailTemplatesRouter } from "./admin-email-templates.js";
import { adminAnnouncementsRouter } from "./admin-announcements.js";
import { adminSystemRouter } from "./admin-system.js";
import { adminSupportRouter } from "./admin-support.js";

export const adminRouter = Router();

adminRouter.use(requireAuth, requirePlatformAdmin);

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

// Mount sub-routers
adminRouter.use("/plans", adminPlansRouter);
adminRouter.use("/coupons", adminCouponsRouter);
adminRouter.use("/subscriptions", adminSubscriptionsRouter);
adminRouter.use("/payments", adminPaymentsRouter);
adminRouter.use("/email-templates", adminEmailTemplatesRouter);
adminRouter.use("/announcements", adminAnnouncementsRouter);
adminRouter.use("/system", adminSystemRouter);
adminRouter.use("/support", adminSupportRouter);

// Workspace subscription helpers mounted under workspaces/:id
adminRouter.post("/workspaces/:workspaceId/subscription", asyncHandler(async (req, res) => {
  // delegate to subscriptions sub-router logic inline
  const { workspaceId } = req.params;
  const adminId = req.user!.id;
  const body = req.body as {
    planId: string;
    status?: string;
    billingCycle?: string;
    currency?: string;
    amount?: number;
    trialEndsAt?: string | null;
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
    nextRenewalAt?: string | null;
    manualNotes?: string;
  };

  if (!body.planId) return res.status(400).json({ error: "planId is required" });

  const [ws, plan] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, name: true } }),
    prisma.plan.findUnique({ where: { id: body.planId }, select: { id: true, name: true } }),
  ]);
  if (!ws) return res.status(404).json({ error: "Workspace not found" });
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  const sub = await prisma.subscription.create({
    data: {
      workspaceId,
      planId: body.planId,
      status: (body.status as never) ?? "TRIAL",
      billingCycle: (body.billingCycle as never) ?? "MANUAL",
      currency: body.currency ?? "PKR",
      amount: body.amount ?? 0,
      trialEndsAt: body.trialEndsAt ? new Date(body.trialEndsAt) : null,
      currentPeriodStart: body.currentPeriodStart ? new Date(body.currentPeriodStart) : null,
      currentPeriodEnd: body.currentPeriodEnd ? new Date(body.currentPeriodEnd) : null,
      nextRenewalAt: body.nextRenewalAt ? new Date(body.nextRenewalAt) : null,
      manualNotes: body.manualNotes ?? null,
    },
  });

  await logAdminAction(adminId, "subscription_created", "subscription", sub.id, { workspaceId, workspaceName: ws.name, planName: plan.name });

  return res.status(201).json({ subscription: sub });
}));

adminRouter.patch("/workspaces/:workspaceId/subscription", asyncHandler(async (req, res) => {
  const { workspaceId } = req.params;
  const adminId = req.user!.id;
  const body = req.body as Record<string, unknown>;

  const sub = await prisma.subscription.findFirst({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!sub) return res.status(404).json({ error: "No subscription found for this workspace" });

  const data: Record<string, unknown> = {};
  if (body.planId !== undefined) data.planId = body.planId;
  if (body.status !== undefined) data.status = body.status;
  if (body.billingCycle !== undefined) data.billingCycle = body.billingCycle;
  if (body.currency !== undefined) data.currency = body.currency;
  if (body.amount !== undefined) data.amount = body.amount;
  if (body.trialEndsAt !== undefined) data.trialEndsAt = body.trialEndsAt ? new Date(body.trialEndsAt as string) : null;
  if (body.currentPeriodStart !== undefined) data.currentPeriodStart = body.currentPeriodStart ? new Date(body.currentPeriodStart as string) : null;
  if (body.currentPeriodEnd !== undefined) data.currentPeriodEnd = body.currentPeriodEnd ? new Date(body.currentPeriodEnd as string) : null;
  if (body.nextRenewalAt !== undefined) data.nextRenewalAt = body.nextRenewalAt ? new Date(body.nextRenewalAt as string) : null;
  if (body.couponId !== undefined) data.couponId = body.couponId;
  if (body.manualNotes !== undefined) data.manualNotes = body.manualNotes;

  await prisma.subscription.update({ where: { id: sub.id }, data });

  await logAdminAction(adminId, "subscription_updated", "subscription", sub.id, { workspaceId, changes: Object.keys(data) });

  const updated = await prisma.subscription.findUnique({
    where: { id: sub.id },
    include: { plan: { select: { id: true, name: true, code: true } }, coupon: { select: { id: true, code: true, name: true } } },
  });

  return res.json({ subscription: updated });
}));

adminRouter.post("/workspaces/:id/apply-coupon", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const { couponCode } = req.body as { couponCode: string };

  if (!couponCode) return res.status(400).json({ error: "couponCode is required" });

  const coupon = await prisma.coupon.findUnique({ where: { code: couponCode.toUpperCase() } });
  if (!coupon) return res.status(404).json({ error: "Coupon not found" });
  if (!coupon.isActive) return res.status(400).json({ error: "Coupon is not active" });

  const sub = await prisma.subscription.findFirst({
    where: { workspaceId: id },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!sub) return res.status(404).json({ error: "No subscription found for this workspace" });

  await prisma.subscription.update({ where: { id: sub.id }, data: { couponId: coupon.id } });
  await prisma.coupon.update({ where: { id: coupon.id }, data: { redemptionsUsed: { increment: 1 } } });

  await logAdminAction(adminId, "coupon_applied", "workspace", id, { couponCode: coupon.code, subscriptionId: sub.id });

  return res.json({ ok: true });
}));

adminRouter.post("/workspaces/:id/remove-coupon", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;

  const sub = await prisma.subscription.findFirst({
    where: { workspaceId: id },
    orderBy: { createdAt: "desc" },
    select: { id: true, couponId: true },
  });
  if (!sub) return res.status(404).json({ error: "No subscription found" });
  if (!sub.couponId) return res.status(400).json({ error: "No coupon applied" });

  await prisma.subscription.update({ where: { id: sub.id }, data: { couponId: null } });

  await logAdminAction(adminId, "coupon_removed", "workspace", id, { subscriptionId: sub.id });

  return res.json({ ok: true });
}));

// ── Overview ───────────────────────────────────────────────────────────

adminRouter.get("/overview", asyncHandler(async (_req, res) => {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const trialEndingSoon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [
    totalWorkspaces,
    suspendedWorkspaces,
    totalUsers,
    verifiedUsers,
    newSignupsThisWeek,
    recentAdminLogs,
    trialWorkspaces,
    paidWorkspaces,
    expiredWorkspaces,
    trialEndingSoonCount,
    setupIncomplete,
    failedEmails24h,
    recentWorkspaces,
    recentUsers,
    plans,
    activeSubscriptions,
  ] = await Promise.all([
    prisma.workspace.count(),
    prisma.workspace.count({ where: { suspended: true } }),
    prisma.user.count(),
    prisma.user.count({ where: { emailVerified: true } }),
    prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.adminAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true, action: true, entity: true, entityId: true, meta: true, createdAt: true,
        admin: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.workspace.count({ where: { trialEndsAt: { gt: now } } }),
    prisma.workspace.count({ where: { subscriptionStatus: "active" } }),
    prisma.workspace.count({ where: { subscriptionStatus: "expired" } }),
    prisma.workspace.count({ where: { trialEndsAt: { gt: now, lte: trialEndingSoon } } }),
    prisma.workspace.count({ where: { onboardingCompleted: false } }),
    prisma.emailLog.count({ where: { status: "FAILED", createdAt: { gte: dayAgo } } }),
    prisma.workspace.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, name: true, plan: true, createdAt: true, owner: { select: { email: true, name: true } } },
    }),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, name: true, email: true, emailVerified: true, createdAt: true },
    }),
    prisma.plan.findMany({ where: { isActive: true }, select: { id: true, name: true, monthlyPrice: true } }),
    prisma.subscription.findMany({
      where: { status: "ACTIVE" },
      select: { planId: true, amount: true, billingCycle: true },
    }),
  ]);

  // Estimated MRR from active subscriptions
  let estimatedMrr = 0;
  for (const sub of activeSubscriptions) {
    if (sub.amount > 0) {
      estimatedMrr += sub.billingCycle === "ANNUAL" ? sub.amount / 12 : sub.amount;
    } else {
      const plan = plans.find((p) => p.id === sub.planId);
      if (plan) estimatedMrr += plan.monthlyPrice;
    }
  }

  return res.json({
    overview: {
      totalWorkspaces,
      activeWorkspaces: totalWorkspaces - suspendedWorkspaces,
      suspendedWorkspaces,
      trialWorkspaces,
      paidWorkspaces,
      expiredWorkspaces,
      trialEndingSoon: trialEndingSoonCount,
      setupIncomplete,
      totalUsers,
      verifiedUsers,
      unverifiedUsers: totalUsers - verifiedUsers,
      newSignupsThisWeek,
      estimatedMrr: Math.round(estimatedMrr),
      failedEmails24h,
    },
    recentActivity: recentAdminLogs,
    recentWorkspaces,
    recentUsers,
  });
}));

// ── Workspaces ─────────────────────────────────────────────────────────

adminRouter.get("/workspaces", asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10)));
  const skip = (page - 1) * limit;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
  const plan = typeof req.query.plan === "string" ? req.query.plan.trim() : undefined;
  const status = typeof req.query.status === "string" ? req.query.status.trim() : undefined;

  const where: Record<string, unknown> = {};

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { owner: { email: { contains: search, mode: "insensitive" } } },
      { owner: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  if (plan && ["FREE", "BASIC", "PRO"].includes(plan)) {
    where.plan = plan;
  }

  if (status === "suspended") where.suspended = true;
  else if (status === "active") where.suspended = false;
  else if (status === "trial") where.trialEndsAt = { gt: new Date() };

  const now = new Date();
  const trialEndingSoon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [total, workspaces] = await Promise.all([
    prisma.workspace.count({ where }),
    prisma.workspace.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        plan: true,
        suspended: true,
        suspendedAt: true,
        suspendReason: true,
        trialEndsAt: true,
        subscriptionStatus: true,
        onboardingCompleted: true,
        createdAt: true,
        owner: { select: { id: true, name: true, email: true, emailVerified: true } },
        _count: {
          select: {
            memberships: { where: { isActive: true } },
            items: { where: { isActive: true } },
            stockMovements: true,
            locations: { where: { isActive: true } },
          },
        },
        subscriptions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true, plan: { select: { name: true } }, trialEndsAt: true },
        },
      },
    }),
  ]);

  const mapped = workspaces.map((w) => {
    const sub = w.subscriptions[0];
    const lastMovement = null; // would need separate query for last activity
    const health = computeHealth({
      suspended: w.suspended,
      onboardingCompleted: w.onboardingCompleted,
      emailVerified: w.owner.emailVerified,
      itemCount: w._count.items,
      locationCount: w._count.locations,
      stockMovementCount: w._count.stockMovements,
      trialEndsAt: w.trialEndsAt,
      subscriptionStatus: sub?.status ?? null,
      createdAt: w.createdAt,
      thirtyDaysAgo,
      trialEndingSoon,
      now,
    });

    return {
      ...w,
      memberCount: w._count.memberships,
      itemCount: w._count.items,
      stockMovementCount: w._count.stockMovements,
      locationCount: w._count.locations,
      subscription: sub ?? null,
      health,
      _count: undefined,
      subscriptions: undefined,
    };
  });

  return res.json({ workspaces: mapped, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

function computeHealth(opts: {
  suspended: boolean;
  onboardingCompleted: boolean;
  emailVerified: boolean;
  itemCount: number;
  locationCount: number;
  stockMovementCount: number;
  trialEndsAt: Date | null;
  subscriptionStatus: string | null;
  createdAt: Date;
  thirtyDaysAgo: Date;
  trialEndingSoon: Date;
  now: Date;
}): string {
  if (opts.suspended) return "Suspended";
  if (opts.subscriptionStatus === "PAST_DUE" || opts.subscriptionStatus === "EXPIRED") return "Payment Due";
  if (opts.trialEndsAt && opts.trialEndsAt > opts.now && opts.trialEndsAt <= opts.trialEndingSoon) return "Trial Ending Soon";
  if (!opts.onboardingCompleted || opts.itemCount === 0 || opts.locationCount === 0) return "Setup Incomplete";
  if (!opts.emailVerified) return "Setup Incomplete";
  if (opts.stockMovementCount === 0 && opts.createdAt < opts.thirtyDaysAgo) return "Inactive";
  return "Healthy";
}

adminRouter.get("/workspaces/stats", asyncHandler(async (_req, res) => {
  const [total, suspended, free, paid, pendingPayment] = await Promise.all([
    prisma.workspace.count(),
    prisma.workspace.count({ where: { suspended: true } }),
    prisma.workspace.count({ where: { plan: "FREE" } }),
    prisma.workspace.count({ where: { plan: { in: ["BASIC", "PRO"] } } }),
    prisma.workspace.count({ where: { subscriptionStatus: "MANUAL_REVIEW" } }),
  ]);

  return res.json({
    stats: {
      total,
      active: total - suspended,
      suspended,
      free,
      paid,
      pendingPayment,
    },
  });
}));

adminRouter.get("/workspaces/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;

  const workspace = await prisma.workspace.findUnique({
    where: { id },
    select: {
      id: true, name: true, plan: true, suspended: true, suspendedAt: true,
      suspendReason: true, trialEndsAt: true, subscriptionStatus: true,
      businessType: true, currency: true, onboardingCompleted: true, createdAt: true,
      owner: { select: { id: true, name: true, email: true, emailVerified: true, createdAt: true } },
      memberships: {
        select: {
          id: true, role: true, isActive: true, createdAt: true,
          user: { select: { id: true, name: true, email: true, emailVerified: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      locations: {
        where: { isActive: true },
        select: { id: true, name: true, createdAt: true },
      },
      _count: {
        select: {
          items: { where: { isActive: true } },
          stockMovements: true,
          purchases: true,
          suppliers: true,
        },
      },
      subscriptions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true, status: true, billingCycle: true, currency: true, amount: true,
          trialEndsAt: true, currentPeriodStart: true, currentPeriodEnd: true,
          nextRenewalAt: true, manualNotes: true, createdAt: true, updatedAt: true,
          plan: { select: { id: true, name: true, code: true, monthlyPrice: true } },
          coupon: { select: { id: true, code: true, name: true, discountType: true, discountValue: true } },
          payments: {
            orderBy: { createdAt: "desc" },
            take: 5,
            select: { id: true, amount: true, currency: true, paymentMethod: true, status: true, paidAt: true, createdAt: true },
          },
        },
      },
      payments: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true, amount: true, currency: true, paymentMethod: true,
          status: true, paidAt: true, referenceNumber: true, notes: true, createdAt: true,
          recordedBy: { select: { name: true } },
        },
      },
    },
  });

  if (!workspace) return res.status(404).json({ error: "Workspace not found" });

  const recentMovements = await prisma.stockMovement.findMany({
    where: { workspaceId: id },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true, type: true, quantity: true, createdAt: true,
      item: { select: { name: true } },
    },
  });

  return res.json({
    workspace: {
      ...workspace,
      itemCount: workspace._count.items,
      stockMovementCount: workspace._count.stockMovements,
      purchaseCount: workspace._count.purchases,
      supplierCount: workspace._count.suppliers,
      subscription: workspace.subscriptions[0] ?? null,
      subscriptions: undefined,
      _count: undefined,
    },
    recentActivity: recentMovements,
  });
}));

adminRouter.patch("/workspaces/:id/status", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const { suspended, reason } = req.body as { suspended: boolean; reason?: string };

  if (typeof suspended !== "boolean") {
    return res.status(400).json({ error: "suspended (boolean) is required" });
  }

  const workspace = await prisma.workspace.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!workspace) return res.status(404).json({ error: "Workspace not found" });

  await prisma.workspace.update({
    where: { id },
    data: {
      suspended,
      suspendedAt: suspended ? new Date() : null,
      suspendReason: suspended ? (reason ?? null) : null,
    },
  });

  await logAdminAction(adminId, suspended ? "workspace_suspended" : "workspace_reactivated", "workspace", id, {
    workspaceName: workspace.name,
    reason: reason ?? null,
  });

  return res.json({ ok: true, suspended });
}));

adminRouter.patch("/workspaces/:id/plan", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const { plan, trialEndsAt, subscriptionStatus } = req.body as {
    plan?: string;
    trialEndsAt?: string | null;
    subscriptionStatus?: string | null;
  };

  const workspace = await prisma.workspace.findUnique({ where: { id }, select: { id: true, name: true, plan: true } });
  if (!workspace) return res.status(404).json({ error: "Workspace not found" });

  // Map plan codes (e.g. STARTER, BUSINESS) to PlanTier enum values (FREE, BASIC, PRO)
  const PLAN_CODE_TO_TIER: Record<string, string> = {
    FREE: "FREE", STARTER: "BASIC", BASIC: "BASIC",
    PRO: "PRO", BUSINESS: "PRO", CUSTOM: "PRO",
  };
  const validPlanTiers = ["FREE", "BASIC", "PRO"];

  let resolvedTier: string | undefined;
  if (plan !== undefined) {
    const upper = plan.toUpperCase();
    if (validPlanTiers.includes(upper)) {
      resolvedTier = upper;
    } else if (PLAN_CODE_TO_TIER[upper]) {
      resolvedTier = PLAN_CODE_TO_TIER[upper];
    } else {
      // Last resort: look up plan by code in the Plan table
      const planRecord = await prisma.plan.findFirst({
        where: { code: { equals: plan, mode: "insensitive" } },
        select: { code: true },
      });
      if (planRecord) {
        resolvedTier = PLAN_CODE_TO_TIER[planRecord.code.toUpperCase()];
      }
      if (!resolvedTier) {
        return res.status(400).json({ error: "Invalid plan value" });
      }
    }
  }

  const updateData: Record<string, unknown> = {};
  if (resolvedTier) updateData.plan = resolvedTier;
  if (trialEndsAt !== undefined) updateData.trialEndsAt = trialEndsAt ? new Date(trialEndsAt) : null;
  if (subscriptionStatus !== undefined) updateData.subscriptionStatus = subscriptionStatus;

  // If changing the plan tier, also sync the latest subscription's planId to a matching plan
  if (resolvedTier) {
    const latestSub = await prisma.subscription.findFirst({
      where: { workspaceId: id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (latestSub) {
      const matchingPlan = await prisma.plan.findFirst({
        where: { code: { in: [resolvedTier, resolvedTier.charAt(0) + resolvedTier.slice(1).toLowerCase()], mode: "insensitive" }, isActive: true },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (matchingPlan) {
        await prisma.subscription.update({
          where: { id: latestSub.id },
          data: { planId: matchingPlan.id },
        });
      }
    }
  }

  await prisma.workspace.update({ where: { id }, data: updateData });

  await logAdminAction(adminId, "workspace_plan_changed", "workspace", id, {
    workspaceName: workspace.name,
    oldPlan: workspace.plan,
    newPlan: resolvedTier ?? workspace.plan,
    trialEndsAt: trialEndsAt ?? null,
    subscriptionStatus: subscriptionStatus ?? null,
  });

  return res.json({ ok: true, newPlan: resolvedTier ?? workspace.plan });
}));

// ── Users ──────────────────────────────────────────────────────────────

adminRouter.get("/users/stats", asyncHandler(async (_req, res) => {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [total, verified, disabled, newThisMonth, platformAdminCount] = await Promise.all([
    prisma.user.count({ where: { platformRole: PlatformRole.USER } }),
    prisma.user.count({ where: { platformRole: PlatformRole.USER, emailVerified: true } }),
    prisma.user.count({ where: { platformRole: PlatformRole.USER, isDisabled: true } }),
    prisma.user.count({ where: { platformRole: PlatformRole.USER, createdAt: { gte: firstOfMonth } } }),
    prisma.user.count({ where: { platformRole: { not: PlatformRole.USER } } }),
  ]);

  return res.json({
    stats: {
      total,
      verified,
      unverified: total - verified,
      active: total - disabled,
      disabled,
      newThisMonth,
      platformAdminCount,
    },
  });
}));

adminRouter.get("/users", asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10)));
  const skip = (page - 1) * limit;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
  const verified = typeof req.query.verified === "string" ? req.query.verified : undefined;
  const disabled = typeof req.query.disabled === "string" ? req.query.disabled : undefined;
  const role = typeof req.query.role === "string" ? req.query.role.trim() : undefined;
  const plan = typeof req.query.plan === "string" ? req.query.plan.trim() : undefined;
  const subscriptionStatus = typeof req.query.subscriptionStatus === "string" ? req.query.subscriptionStatus.trim() : undefined;
  const includePlatformAdmins = req.query.includePlatformAdmins === "true";

  const where: Prisma.UserWhereInput = {};

  // Default: customer users only. Super admin can opt-in to see platform admins too.
  if (!includePlatformAdmins) {
    where.platformRole = PlatformRole.USER;
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ];
  }
  if (verified === "true") where.emailVerified = true;
  if (verified === "false") where.emailVerified = false;
  if (disabled === "true") where.isDisabled = true;
  if (disabled === "false") where.isDisabled = false;

  // Workspace-level filters via membership relation
  if (role || plan || subscriptionStatus) {
    where.memberships = {
      some: {
        isActive: true,
        ...(role ? { role: role as never } : {}),
        ...(plan || subscriptionStatus ? {
          workspace: {
            ...(plan ? { plan: plan as never } : {}),
            ...(subscriptionStatus ? { subscriptionStatus } : {}),
          },
        } : {}),
      },
    };
  }

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, email: true, emailVerified: true,
        isDisabled: true, platformRole: true, createdAt: true, lastLoginAt: true,
        _count: { select: { memberships: { where: { isActive: true } } } },
        memberships: {
          where: { isActive: true },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: {
            role: true,
            workspace: { select: { id: true, name: true, plan: true, subscriptionStatus: true } },
          },
        },
      },
    }),
  ]);

  return res.json({
    users: users.map((u) => {
      const m = u.memberships[0];
      return {
        ...u,
        workspaceCount: u._count.memberships,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        primaryWorkspace: m ? {
          id: m.workspace.id,
          name: m.workspace.name,
          plan: m.workspace.plan,
          role: m.role,
          subscriptionStatus: m.workspace.subscriptionStatus,
        } : null,
        memberships: undefined,
        _count: undefined,
      };
    }),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}));

adminRouter.get("/users/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, name: true, email: true, emailVerified: true, isDisabled: true,
      passwordResetRequired: true, platformRole: true, failedLoginAttempts: true,
      lockedUntil: true, createdAt: true,
      memberships: {
        select: {
          id: true, role: true, isActive: true, createdAt: true,
          workspace: { select: { id: true, name: true, plan: true, suspended: true } },
        },
      },
    },
  });

  if (!user) return res.status(404).json({ error: "User not found" });

  const recentAuditLogs = await prisma.auditLog.findMany({
    where: { userId: id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true, action: true, entity: true, entityId: true, createdAt: true,
      workspace: { select: { id: true, name: true } },
    },
  });

  return res.json({ user, recentActivity: recentAuditLogs });
}));

adminRouter.patch("/users/:id/status", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const { isDisabled } = req.body as { isDisabled: boolean };

  if (typeof isDisabled !== "boolean") {
    return res.status(400).json({ error: "isDisabled (boolean) is required" });
  }
  if (id === adminId) {
    return res.status(400).json({ error: "You cannot disable your own account." });
  }

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true, email: true, platformRole: true } });
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.platformRole === PlatformRole.SUPER_ADMIN) {
    return res.status(400).json({ error: "Cannot disable another super admin." });
  }

  await prisma.user.update({ where: { id }, data: { isDisabled } });

  await logAdminAction(adminId, isDisabled ? "user_disabled" : "user_enabled", "user", id, {
    targetEmail: user.email, targetName: user.name,
  });

  return res.json({ ok: true, isDisabled });
}));

adminRouter.post("/users/:id/resend-verification", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;

  const user = await prisma.user.findUnique({
    where: { id }, select: { id: true, name: true, email: true, emailVerified: true },
  });
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.emailVerified) return res.status(400).json({ error: "User email is already verified." });

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await prisma.emailVerifToken.deleteMany({ where: { userId: id } });
  await prisma.emailVerifToken.create({ data: { userId: id, tokenHash, expiresAt } });
  await sendEmailVerificationEmail(user.email, rawToken);

  await logAdminAction(adminId, "admin_resend_verification", "user", id, { targetEmail: user.email });

  return res.json({ ok: true });
}));

adminRouter.post("/users/:id/force-password-reset", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true, email: true } });
  if (!user) return res.status(404).json({ error: "User not found" });

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await prisma.passwordResetToken.deleteMany({ where: { userId: id, usedAt: null } });
  await prisma.passwordResetToken.create({ data: { userId: id, tokenHash, expiresAt } });
  await prisma.user.update({ where: { id }, data: { passwordResetRequired: true } });
  await sendPasswordResetEmail(user.email, rawToken);

  await logAdminAction(adminId, "admin_force_password_reset", "user", id, { targetEmail: user.email });

  return res.json({ ok: true });
}));

// ── Admin Team ──────────────────────────────────────────────────────────

adminRouter.get("/team", asyncHandler(async (_req, res) => {
  const members = await prisma.user.findMany({
    where: { platformRole: { not: PlatformRole.USER } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, name: true, email: true, emailVerified: true,
      isDisabled: true, platformRole: true, createdAt: true,
      _count: { select: { memberships: true } },
    },
  });
  return res.json({
    members: members.map((m) => ({ ...m, workspaceCount: m._count.memberships, _count: undefined })),
  });
}));

adminRouter.patch("/users/:id/platform-role", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const { role } = req.body as { role: string };

  if (req.user!.platformRole !== PlatformRole.SUPER_ADMIN) {
    return res.status(403).json({ error: "Only Super Admins can manage admin roles." });
  }

  if (!["SUPER_ADMIN", "SUPPORT_ADMIN", "USER"].includes(role)) {
    return res.status(400).json({ error: "Invalid role. Must be SUPER_ADMIN, SUPPORT_ADMIN, or USER." });
  }

  if (id === adminId) {
    return res.status(400).json({ error: "You cannot change your own platform role." });
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, platformRole: true },
  });
  if (!user) return res.status(404).json({ error: "User not found" });

  await prisma.user.update({ where: { id }, data: { platformRole: role as PlatformRole } });

  await logAdminAction(adminId, "user_platform_role_changed", "user", id, {
    targetEmail: user.email, fromRole: user.platformRole, toRole: role,
  });

  return res.json({ ok: true, role });
}));

// ── Audit logs ─────────────────────────────────────────────────────────

adminRouter.get("/audit-logs", asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10)));
  const skip = (page - 1) * limit;
  const action = typeof req.query.action === "string" ? req.query.action.trim() : undefined;

  const where: Record<string, unknown> = {};
  if (action) where.action = action;

  const [total, logs] = await Promise.all([
    prisma.adminAuditLog.count({ where }),
    prisma.adminAuditLog.findMany({
      where, skip, take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true, action: true, entity: true, entityId: true, meta: true, createdAt: true,
        admin: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  return res.json({ logs, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));
