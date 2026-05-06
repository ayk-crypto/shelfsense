import { Router } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../utils/async-handler.js";

export const adminSubscriptionsRouter = Router();

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

const SUB_SELECT = {
  id: true,
  workspaceId: true,
  planId: true,
  status: true,
  billingCycle: true,
  currency: true,
  amount: true,
  trialEndsAt: true,
  currentPeriodStart: true,
  currentPeriodEnd: true,
  nextRenewalAt: true,
  couponId: true,
  manualNotes: true,
  createdAt: true,
  updatedAt: true,
  workspace: { select: { id: true, name: true, owner: { select: { email: true, name: true } } } },
  plan: { select: { id: true, name: true, code: true, monthlyPrice: true } },
  coupon: { select: { id: true, code: true, name: true, discountType: true, discountValue: true } },
} as const;

adminSubscriptionsRouter.get("/", asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10)));
  const skip = (page - 1) * limit;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (search) {
    where.workspace = {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { owner: { email: { contains: search, mode: "insensitive" } } },
      ],
    };
  }

  const [total, subscriptions] = await Promise.all([
    prisma.subscription.count({ where }),
    prisma.subscription.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: SUB_SELECT,
    }),
  ]);

  return res.json({ subscriptions, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

adminSubscriptionsRouter.get("/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const sub = await prisma.subscription.findUnique({
    where: { id },
    select: {
      ...SUB_SELECT,
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
  if (!sub) return res.status(404).json({ error: "Subscription not found" });
  return res.json({ subscription: sub });
}));

adminSubscriptionsRouter.patch("/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const body = req.body as Partial<{
    planId: string;
    status: string;
    billingCycle: string;
    currency: string;
    amount: number;
    trialEndsAt: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    nextRenewalAt: string | null;
    couponId: string | null;
    manualNotes: string | null;
  }>;

  const sub = await prisma.subscription.findUnique({ where: { id }, select: { id: true, workspaceId: true, status: true } });
  if (!sub) return res.status(404).json({ error: "Subscription not found" });

  const data: Record<string, unknown> = {};
  if (body.planId !== undefined) data.planId = body.planId;
  if (body.status !== undefined) data.status = body.status;
  if (body.billingCycle !== undefined) data.billingCycle = body.billingCycle;
  if (body.amount !== undefined) data.amount = body.amount;
  if (body.trialEndsAt !== undefined) data.trialEndsAt = body.trialEndsAt ? new Date(body.trialEndsAt) : null;
  if (body.currentPeriodStart !== undefined) data.currentPeriodStart = body.currentPeriodStart ? new Date(body.currentPeriodStart) : null;
  if (body.currentPeriodEnd !== undefined) data.currentPeriodEnd = body.currentPeriodEnd ? new Date(body.currentPeriodEnd) : null;
  if (body.nextRenewalAt !== undefined) data.nextRenewalAt = body.nextRenewalAt ? new Date(body.nextRenewalAt) : null;
  if (body.couponId !== undefined) data.couponId = body.couponId;
  if (body.manualNotes !== undefined) data.manualNotes = body.manualNotes;

  const updated = await prisma.subscription.update({ where: { id }, data, select: SUB_SELECT });

  await logAdminAction(adminId, "subscription_updated", "subscription", id, {
    workspaceId: sub.workspaceId,
    changes: Object.keys(data),
  });

  return res.json({ subscription: updated });
}));

// POST /admin/workspaces/:workspaceId/subscription — create subscription for workspace
adminSubscriptionsRouter.post("/workspaces/:workspaceId", asyncHandler(async (req, res) => {
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
      currency: "USD",
      amount: body.amount ?? 0,
      trialEndsAt: body.trialEndsAt ? new Date(body.trialEndsAt) : null,
      currentPeriodStart: body.currentPeriodStart ? new Date(body.currentPeriodStart) : null,
      currentPeriodEnd: body.currentPeriodEnd ? new Date(body.currentPeriodEnd) : null,
      nextRenewalAt: body.nextRenewalAt ? new Date(body.nextRenewalAt) : null,
      manualNotes: body.manualNotes ?? null,
    },
    select: SUB_SELECT,
  });

  await logAdminAction(adminId, "subscription_created", "subscription", sub.id, {
    workspaceId,
    workspaceName: ws.name,
    planName: plan.name,
  });

  return res.status(201).json({ subscription: sub });
}));

// PATCH /admin/workspaces/:workspaceId/subscription — update latest subscription for workspace
adminSubscriptionsRouter.patch("/workspaces/:workspaceId", asyncHandler(async (req, res) => {
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
  if (body.amount !== undefined) data.amount = body.amount;
  if (body.trialEndsAt !== undefined) data.trialEndsAt = body.trialEndsAt ? new Date(body.trialEndsAt as string) : null;
  if (body.currentPeriodStart !== undefined) data.currentPeriodStart = body.currentPeriodStart ? new Date(body.currentPeriodStart as string) : null;
  if (body.currentPeriodEnd !== undefined) data.currentPeriodEnd = body.currentPeriodEnd ? new Date(body.currentPeriodEnd as string) : null;
  if (body.nextRenewalAt !== undefined) data.nextRenewalAt = body.nextRenewalAt ? new Date(body.nextRenewalAt as string) : null;
  if (body.couponId !== undefined) data.couponId = body.couponId;
  if (body.manualNotes !== undefined) data.manualNotes = body.manualNotes;

  const updated = await prisma.subscription.update({ where: { id: sub.id }, data, select: SUB_SELECT });

  await logAdminAction(adminId, "subscription_updated", "subscription", sub.id, { workspaceId, changes: Object.keys(data) });

  return res.json({ subscription: updated });
}));

// POST /admin/subscriptions/:id/activate — manually activate a MANUAL_REVIEW subscription
adminSubscriptionsRouter.post("/:id/activate", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const body = req.body as { billingCycle?: string; expiryDate?: string };

  const sub = await prisma.subscription.findUnique({
    where: { id },
    select: { id: true, status: true, workspaceId: true, billingCycle: true, amount: true, currency: true },
  });
  if (!sub) return res.status(404).json({ error: "Subscription not found" });
  if (sub.status === "ACTIVE") return res.status(409).json({ error: "Subscription is already active" });

  const now = new Date();
  const billingCycle = (body.billingCycle ?? sub.billingCycle) as "MONTHLY" | "ANNUAL" | "MANUAL";
  let currentPeriodEnd: Date | null = null;

  if (body.expiryDate) {
    currentPeriodEnd = new Date(body.expiryDate);
  } else if (billingCycle === "ANNUAL") {
    currentPeriodEnd = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  } else if (billingCycle === "MONTHLY") {
    currentPeriodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  }

  await prisma.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { id },
      data: {
        status: "ACTIVE",
        billingCycle,
        currentPeriodStart: now,
        currentPeriodEnd,
        nextRenewalAt: currentPeriodEnd,
        manualNotes: null,
      },
    });

    // Auto-create a PAID payment record so it appears in the Payments tab
    if (sub.amount > 0) {
      await tx.payment.create({
        data: {
          workspaceId: sub.workspaceId,
          subscriptionId: id,
          amount: sub.amount,
          currency: sub.currency,
          paymentMethod: "OTHER",
          status: "PAID",
          paidAt: now,
          recordedByUserId: adminId,
          notes: `Manually activated by admin (${billingCycle.toLowerCase()} · expires ${currentPeriodEnd ? currentPeriodEnd.toISOString().slice(0, 10) : "no expiry"})`,
        },
      });
    }
  });

  await logAdminAction(adminId, "subscription_activated", "subscription", id, {
    workspaceId: sub.workspaceId,
    billingCycle,
    expiryDate: body.expiryDate ?? null,
    paymentRecorded: sub.amount > 0,
  });

  const result = await prisma.subscription.findUnique({ where: { id }, select: SUB_SELECT });
  return res.json({ subscription: result, ok: true });
}));
