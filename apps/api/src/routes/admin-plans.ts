import { Router } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../utils/async-handler.js";

export const adminPlansRouter = Router();

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

const PLAN_SELECT = {
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
  maxPurchasesPerMonth: true,
  maxStockMovementsPerMonth: true,
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
  isPublic: true,
  isActive: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { subscriptions: true } },
} as const;

adminPlansRouter.get("/", asyncHandler(async (_req, res) => {
  const plans = await prisma.plan.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: PLAN_SELECT,
  });
  return res.json({
    plans: plans.map((p) => ({ ...p, subscriptionCount: p._count.subscriptions, _count: undefined })),
  });
}));

adminPlansRouter.post("/", asyncHandler(async (req, res) => {
  const adminId = req.user!.id;
  const body = req.body as {
    name: string;
    code: string;
    description?: string;
    monthlyPrice?: number;
    annualPrice?: number;
    currency?: string;
    trialDays?: number;
    maxUsers?: number | null;
    maxLocations?: number | null;
    maxItems?: number | null;
    maxSuppliers?: number | null;
    maxPurchasesPerMonth?: number | null;
    maxStockMovementsPerMonth?: number | null;
    enableExpiryTracking?: boolean;
    enableBarcodeScanning?: boolean;
    enableReports?: boolean;
    enableAdvancedReports?: boolean;
    enablePurchases?: boolean;
    enableSuppliers?: boolean;
    enableTeamManagement?: boolean;
    enableCustomRoles?: boolean;
    enableEmailAlerts?: boolean;
    enableDailyOps?: boolean;
    isPublic?: boolean;
    sortOrder?: number;
  };

  if (!body.name?.trim() || !body.code?.trim()) {
    return res.status(400).json({ error: "name and code are required" });
  }

  const code = body.code.trim().toUpperCase();

  const existing = await prisma.plan.findUnique({ where: { code } });
  if (existing) return res.status(409).json({ error: "Plan code already exists" });

  const plan = await prisma.plan.create({
    data: {
      name: body.name.trim(),
      code,
      description: body.description?.trim() ?? null,
      monthlyPrice: body.monthlyPrice ?? 0,
      annualPrice: body.annualPrice ?? 0,
      currency: "USD",
      trialDays: body.trialDays ?? 0,
      maxUsers: body.maxUsers ?? null,
      maxLocations: body.maxLocations ?? null,
      maxItems: body.maxItems ?? null,
      maxSuppliers: body.maxSuppliers ?? null,
      maxPurchasesPerMonth: body.maxPurchasesPerMonth ?? null,
      maxStockMovementsPerMonth: body.maxStockMovementsPerMonth ?? null,
      enableExpiryTracking: body.enableExpiryTracking ?? true,
      enableBarcodeScanning: body.enableBarcodeScanning ?? true,
      enableReports: body.enableReports ?? true,
      enableAdvancedReports: body.enableAdvancedReports ?? false,
      enablePurchases: body.enablePurchases ?? true,
      enableSuppliers: body.enableSuppliers ?? true,
      enableTeamManagement: body.enableTeamManagement ?? true,
      enableCustomRoles: body.enableCustomRoles ?? false,
      enableEmailAlerts: body.enableEmailAlerts ?? true,
      enableDailyOps: body.enableDailyOps ?? true,
      isPublic: body.isPublic ?? true,
      sortOrder: body.sortOrder ?? 0,
    },
  });

  await logAdminAction(adminId, "plan_created", "plan", plan.id, { name: plan.name, code: plan.code });

  return res.status(201).json({ plan });
}));

adminPlansRouter.get("/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const plan = await prisma.plan.findUnique({ where: { id }, select: PLAN_SELECT });
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  return res.json({ plan: { ...plan, subscriptionCount: plan._count.subscriptions, _count: undefined } });
}));

adminPlansRouter.patch("/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const body = req.body as Partial<{
    name: string;
    description: string | null;
    monthlyPrice: number;
    annualPrice: number;
    currency: string;
    trialDays: number;
    maxUsers: number | null;
    maxLocations: number | null;
    maxItems: number | null;
    maxSuppliers: number | null;
    maxPurchasesPerMonth: number | null;
    maxStockMovementsPerMonth: number | null;
    enableExpiryTracking: boolean;
    enableBarcodeScanning: boolean;
    enableReports: boolean;
    enableAdvancedReports: boolean;
    enablePurchases: boolean;
    enableSuppliers: boolean;
    enableTeamManagement: boolean;
    enableCustomRoles: boolean;
    enableEmailAlerts: boolean;
    enableDailyOps: boolean;
    isPublic: boolean;
    sortOrder: number;
  }>;

  const plan = await prisma.plan.findUnique({ where: { id } });
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name.trim();
  if (body.description !== undefined) data.description = body.description;
  if (body.monthlyPrice !== undefined) data.monthlyPrice = body.monthlyPrice;
  if (body.annualPrice !== undefined) data.annualPrice = body.annualPrice;
  if (body.trialDays !== undefined) data.trialDays = body.trialDays;
  if (body.maxUsers !== undefined) data.maxUsers = body.maxUsers;
  if (body.maxLocations !== undefined) data.maxLocations = body.maxLocations;
  if (body.maxItems !== undefined) data.maxItems = body.maxItems;
  if (body.maxSuppliers !== undefined) data.maxSuppliers = body.maxSuppliers;
  if (body.maxPurchasesPerMonth !== undefined) data.maxPurchasesPerMonth = body.maxPurchasesPerMonth;
  if (body.maxStockMovementsPerMonth !== undefined) data.maxStockMovementsPerMonth = body.maxStockMovementsPerMonth;
  if (body.enableExpiryTracking !== undefined) data.enableExpiryTracking = body.enableExpiryTracking;
  if (body.enableBarcodeScanning !== undefined) data.enableBarcodeScanning = body.enableBarcodeScanning;
  if (body.enableReports !== undefined) data.enableReports = body.enableReports;
  if (body.enableAdvancedReports !== undefined) data.enableAdvancedReports = body.enableAdvancedReports;
  if (body.enablePurchases !== undefined) data.enablePurchases = body.enablePurchases;
  if (body.enableSuppliers !== undefined) data.enableSuppliers = body.enableSuppliers;
  if (body.enableTeamManagement !== undefined) data.enableTeamManagement = body.enableTeamManagement;
  if (body.enableCustomRoles !== undefined) data.enableCustomRoles = body.enableCustomRoles;
  if (body.enableEmailAlerts !== undefined) data.enableEmailAlerts = body.enableEmailAlerts;
  if (body.enableDailyOps !== undefined) data.enableDailyOps = body.enableDailyOps;
  if (body.isPublic !== undefined) data.isPublic = body.isPublic;
  if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;

  const updated = await prisma.plan.update({ where: { id }, data });

  await logAdminAction(adminId, "plan_updated", "plan", id, { name: updated.name, changes: Object.keys(data) });

  return res.json({ plan: updated });
}));

adminPlansRouter.patch("/:id/status", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const { isActive } = req.body as { isActive: boolean };

  if (typeof isActive !== "boolean") {
    return res.status(400).json({ error: "isActive (boolean) is required" });
  }

  const plan = await prisma.plan.findUnique({ where: { id } });
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  await prisma.plan.update({ where: { id }, data: { isActive } });

  await logAdminAction(adminId, isActive ? "plan_activated" : "plan_archived", "plan", id, { name: plan.name });

  return res.json({ ok: true, isActive });
}));
