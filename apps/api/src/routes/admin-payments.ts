import { Router } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { PaymentStatus, SubscriptionStatus } from "../generated/prisma/enums.js";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../utils/async-handler.js";

export const adminPaymentsRouter = Router();

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

const PAYMENT_SELECT = {
  id: true,
  workspaceId: true,
  subscriptionId: true,
  amount: true,
  currency: true,
  paymentMethod: true,
  referenceNumber: true,
  status: true,
  paidAt: true,
  notes: true,
  recordedByUserId: true,
  createdAt: true,
  updatedAt: true,
  workspace: { select: { id: true, name: true } },
  recordedBy: { select: { id: true, name: true, email: true } },
  subscription: { select: { id: true, plan: { select: { name: true, code: true } } } },
} as const;

adminPaymentsRouter.get("/", asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10)));
  const skip = (page - 1) * limit;
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : undefined;

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (workspaceId) where.workspaceId = workspaceId;

  const [total, payments] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: PAYMENT_SELECT,
    }),
  ]);

  return res.json({ payments, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

adminPaymentsRouter.post("/", asyncHandler(async (req, res) => {
  const adminId = req.user!.id;
  const body = req.body as {
    workspaceId: string;
    subscriptionId?: string | null;
    amount: number;
    currency?: string;
    paymentMethod?: string;
    referenceNumber?: string;
    status?: string;
    paidAt?: string | null;
    notes?: string;
  };

  if (!body.workspaceId) return res.status(400).json({ error: "workspaceId is required" });
  if (typeof body.amount !== "number" || body.amount <= 0) {
    return res.status(400).json({ error: "amount must be a positive number" });
  }

  const ws = await prisma.workspace.findUnique({ where: { id: body.workspaceId }, select: { id: true, name: true } });
  if (!ws) return res.status(404).json({ error: "Workspace not found" });

  const payment = await prisma.payment.create({
    data: {
      workspaceId: body.workspaceId,
      subscriptionId: body.subscriptionId ?? null,
      amount: body.amount,
      currency: body.currency ?? "PKR",
      paymentMethod: (body.paymentMethod as never) ?? "OTHER",
      referenceNumber: body.referenceNumber ?? null,
      status: (body.status as never) ?? "PENDING",
      paidAt: body.paidAt ? new Date(body.paidAt) : null,
      notes: body.notes ?? null,
      recordedByUserId: adminId,
    },
    select: PAYMENT_SELECT,
  });

  await logAdminAction(adminId, "payment_recorded", "payment", payment.id, {
    workspaceId: body.workspaceId,
    workspaceName: ws.name,
    amount: body.amount,
    currency: body.currency ?? "PKR",
  });

  return res.status(201).json({ payment });
}));

adminPaymentsRouter.get("/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const payment = await prisma.payment.findUnique({ where: { id }, select: PAYMENT_SELECT });
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  return res.json({ payment });
}));

adminPaymentsRouter.patch("/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const body = req.body as Partial<{
    status: string;
    paymentMethod: string;
    referenceNumber: string | null;
    paidAt: string | null;
    notes: string | null;
    amount: number;
  }>;

  const payment = await prisma.payment.findUnique({ where: { id }, select: { id: true, workspaceId: true } });
  if (!payment) return res.status(404).json({ error: "Payment not found" });

  const data: Record<string, unknown> = {};
  if (body.status !== undefined) data.status = body.status;
  if (body.paymentMethod !== undefined) data.paymentMethod = body.paymentMethod;
  if (body.referenceNumber !== undefined) data.referenceNumber = body.referenceNumber;
  if (body.paidAt !== undefined) data.paidAt = body.paidAt ? new Date(body.paidAt) : null;
  if (body.notes !== undefined) data.notes = body.notes;
  if (body.amount !== undefined) data.amount = body.amount;

  const updated = await prisma.payment.update({ where: { id }, data, select: PAYMENT_SELECT });

  await logAdminAction(adminId, "payment_updated", "payment", id, {
    workspaceId: payment.workspaceId,
    changes: Object.keys(data),
  });

  return res.json({ payment: updated });
}));

// POST /admin/payments/:id/mark-paid — mark a payment as paid and activate subscription
adminPaymentsRouter.post("/:id/mark-paid", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;

  const payment = await prisma.payment.findUnique({
    where: { id },
    select: { id: true, workspaceId: true, subscriptionId: true, status: true, amount: true, currency: true },
  });
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  if (payment.status === PaymentStatus.PAID) return res.status(409).json({ error: "Payment is already marked as paid" });

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id },
      data: { status: PaymentStatus.PAID, paidAt: now },
    });

    if (payment.subscriptionId) {
      const sub = await tx.subscription.findUnique({
        where: { id: payment.subscriptionId },
        select: { id: true, status: true, billingCycle: true },
      });
      if (sub && sub.status === SubscriptionStatus.MANUAL_REVIEW) {
        const periodEnd = sub.billingCycle === "ANNUAL"
          ? new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
          : sub.billingCycle === "MONTHLY"
          ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
          : null;

        await tx.subscription.update({
          where: { id: payment.subscriptionId },
          data: {
            status: SubscriptionStatus.ACTIVE,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            nextRenewalAt: periodEnd,
            manualNotes: null,
          },
        });
      }
    }

    await tx.billingEvent.create({
      data: {
        workspaceId: payment.workspaceId,
        eventType: "admin_mark_paid",
        gatewayProvider: "admin",
        gatewayEventId: `admin_paid_${id}_${Date.now()}`,
        subscriptionId: payment.subscriptionId ?? undefined,
        paymentId: id,
        payload: { adminId, amount: payment.amount, currency: payment.currency },
      },
    });
  });

  await logAdminAction(adminId, "payment_marked_paid", "payment", id, {
    workspaceId: payment.workspaceId,
    subscriptionId: payment.subscriptionId,
    amount: payment.amount,
  });

  const updated = await prisma.payment.findUnique({ where: { id }, select: PAYMENT_SELECT });
  return res.json({ payment: updated, ok: true });
}));
