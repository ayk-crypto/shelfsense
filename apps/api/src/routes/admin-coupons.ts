import { Router } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../utils/async-handler.js";

export const adminCouponsRouter = Router();

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

const COUPON_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  discountType: true,
  discountValue: true,
  currency: true,
  validFrom: true,
  validUntil: true,
  maxRedemptions: true,
  redemptionsUsed: true,
  billingCycleRestriction: true,
  durationType: true,
  durationMonths: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  couponPlans: { select: { planId: true, plan: { select: { id: true, name: true, code: true } } } },
  _count: { select: { subscriptions: true } },
} as const;

adminCouponsRouter.get("/", asyncHandler(async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
  const active = typeof req.query.active === "string" ? req.query.active : undefined;

  const where: Record<string, unknown> = {};
  if (search) {
    where.OR = [
      { code: { contains: search, mode: "insensitive" } },
      { name: { contains: search, mode: "insensitive" } },
    ];
  }
  if (active === "true") where.isActive = true;
  if (active === "false") where.isActive = false;

  const coupons = await prisma.coupon.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: COUPON_SELECT,
  });

  return res.json({
    coupons: coupons.map((c) => ({
      ...c,
      subscriptionCount: c._count.subscriptions,
      _count: undefined,
    })),
  });
}));

adminCouponsRouter.post("/", asyncHandler(async (req, res) => {
  const adminId = req.user!.id;
  const body = req.body as {
    code: string;
    name: string;
    description?: string;
    discountType: "PERCENTAGE" | "FIXED_AMOUNT";
    discountValue: number;
    currency?: string;
    validFrom?: string | null;
    validUntil?: string | null;
    maxRedemptions?: number | null;
    billingCycleRestriction?: "ANY" | "MONTHLY" | "ANNUAL";
    durationType?: "ONCE" | "REPEATING" | "FOREVER";
    durationMonths?: number | null;
    planIds?: string[];
  };

  if (!body.code?.trim() || !body.name?.trim()) {
    return res.status(400).json({ error: "code and name are required" });
  }
  if (!["PERCENTAGE", "FIXED_AMOUNT"].includes(body.discountType)) {
    return res.status(400).json({ error: "discountType must be PERCENTAGE or FIXED_AMOUNT" });
  }
  if (typeof body.discountValue !== "number" || body.discountValue <= 0) {
    return res.status(400).json({ error: "discountValue must be a positive number" });
  }
  if (body.discountType === "PERCENTAGE" && body.discountValue > 100) {
    return res.status(400).json({ error: "Percentage discount cannot exceed 100" });
  }

  const code = body.code.trim().toUpperCase();
  const existing = await prisma.coupon.findUnique({ where: { code } });
  if (existing) return res.status(409).json({ error: "Coupon code already exists" });

  const coupon = await prisma.coupon.create({
    data: {
      code,
      name: body.name.trim(),
      description: body.description?.trim() ?? null,
      discountType: body.discountType,
      discountValue: body.discountValue,
      currency: body.currency ?? "PKR",
      validFrom: body.validFrom ? new Date(body.validFrom) : null,
      validUntil: body.validUntil ? new Date(body.validUntil) : null,
      maxRedemptions: body.maxRedemptions ?? null,
      billingCycleRestriction: body.billingCycleRestriction ?? "ANY",
      durationType: body.durationType ?? "ONCE",
      durationMonths: body.durationMonths ?? null,
      couponPlans: body.planIds?.length
        ? { create: body.planIds.map((planId) => ({ planId })) }
        : undefined,
    },
  });

  await logAdminAction(adminId, "coupon_created", "coupon", coupon.id, { code: coupon.code, name: coupon.name });

  return res.status(201).json({ coupon });
}));

adminCouponsRouter.get("/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const coupon = await prisma.coupon.findUnique({ where: { id }, select: COUPON_SELECT });
  if (!coupon) return res.status(404).json({ error: "Coupon not found" });
  return res.json({ coupon: { ...coupon, subscriptionCount: coupon._count.subscriptions, _count: undefined } });
}));

adminCouponsRouter.patch("/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const body = req.body as Partial<{
    name: string;
    description: string | null;
    discountType: "PERCENTAGE" | "FIXED_AMOUNT";
    discountValue: number;
    currency: string;
    validFrom: string | null;
    validUntil: string | null;
    maxRedemptions: number | null;
    billingCycleRestriction: "ANY" | "MONTHLY" | "ANNUAL";
    durationType: "ONCE" | "REPEATING" | "FOREVER";
    durationMonths: number | null;
    planIds: string[];
  }>;

  const coupon = await prisma.coupon.findUnique({ where: { id } });
  if (!coupon) return res.status(404).json({ error: "Coupon not found" });

  if (body.discountType === "PERCENTAGE" && body.discountValue && body.discountValue > 100) {
    return res.status(400).json({ error: "Percentage discount cannot exceed 100" });
  }
  if (body.discountValue !== undefined && body.discountValue <= 0) {
    return res.status(400).json({ error: "discountValue must be positive" });
  }

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name.trim();
  if (body.description !== undefined) data.description = body.description;
  if (body.discountType !== undefined) data.discountType = body.discountType;
  if (body.discountValue !== undefined) data.discountValue = body.discountValue;
  if (body.currency !== undefined) data.currency = body.currency;
  if (body.validFrom !== undefined) data.validFrom = body.validFrom ? new Date(body.validFrom) : null;
  if (body.validUntil !== undefined) data.validUntil = body.validUntil ? new Date(body.validUntil) : null;
  if (body.maxRedemptions !== undefined) data.maxRedemptions = body.maxRedemptions;
  if (body.billingCycleRestriction !== undefined) data.billingCycleRestriction = body.billingCycleRestriction;
  if (body.durationType !== undefined) data.durationType = body.durationType;
  if (body.durationMonths !== undefined) data.durationMonths = body.durationMonths;

  await prisma.$transaction(async (tx) => {
    await tx.coupon.update({ where: { id }, data });
    if (body.planIds !== undefined) {
      await tx.couponPlan.deleteMany({ where: { couponId: id } });
      if (body.planIds.length > 0) {
        await tx.couponPlan.createMany({
          data: body.planIds.map((planId) => ({ couponId: id, planId })),
        });
      }
    }
  });

  await logAdminAction(adminId, "coupon_updated", "coupon", id, { code: coupon.code, changes: Object.keys(data) });

  const updated = await prisma.coupon.findUnique({ where: { id }, select: COUPON_SELECT });
  return res.json({ coupon: updated });
}));

adminCouponsRouter.patch("/:id/status", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const { isActive } = req.body as { isActive: boolean };

  if (typeof isActive !== "boolean") {
    return res.status(400).json({ error: "isActive (boolean) is required" });
  }

  const coupon = await prisma.coupon.findUnique({ where: { id } });
  if (!coupon) return res.status(404).json({ error: "Coupon not found" });

  await prisma.coupon.update({ where: { id }, data: { isActive } });

  await logAdminAction(adminId, isActive ? "coupon_enabled" : "coupon_disabled", "coupon", id, { code: coupon.code });

  return res.json({ ok: true, isActive });
}));
