import { Router } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { PlatformRole } from "../generated/prisma/enums.js";
import { prisma } from "../db/prisma.js";
import { requireAuth, requirePlatformAdmin } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import { sendEmailVerificationEmail, sendPasswordResetEmail } from "../services/email.js";
import crypto from "crypto";

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

adminRouter.get("/overview", asyncHandler(async (_req, res) => {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    totalWorkspaces,
    suspendedWorkspaces,
    totalUsers,
    verifiedUsers,
    newSignupsThisWeek,
    recentAdminLogs,
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
        id: true,
        action: true,
        entity: true,
        entityId: true,
        meta: true,
        createdAt: true,
        admin: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  const trialWorkspaces = await prisma.workspace.count({
    where: { trialEndsAt: { gt: now } },
  });

  const paidWorkspaces = await prisma.workspace.count({
    where: { subscriptionStatus: "active" },
  });

  return res.json({
    overview: {
      totalWorkspaces,
      activeWorkspaces: totalWorkspaces - suspendedWorkspaces,
      suspendedWorkspaces,
      trialWorkspaces,
      paidWorkspaces,
      totalUsers,
      verifiedUsers,
      unverifiedUsers: totalUsers - verifiedUsers,
      newSignupsThisWeek,
    },
    recentActivity: recentAdminLogs,
  });
}));

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

  if (status === "suspended") {
    where.suspended = true;
  } else if (status === "active") {
    where.suspended = false;
  }

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
        createdAt: true,
        owner: { select: { id: true, name: true, email: true } },
        _count: {
          select: {
            memberships: { where: { isActive: true } },
            items: { where: { isActive: true } },
            stockMovements: true,
          },
        },
      },
    }),
  ]);

  return res.json({
    workspaces: workspaces.map((w) => ({
      ...w,
      memberCount: w._count.memberships,
      itemCount: w._count.items,
      stockMovementCount: w._count.stockMovements,
      _count: undefined,
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}));

adminRouter.get("/workspaces/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;

  const workspace = await prisma.workspace.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      plan: true,
      suspended: true,
      suspendedAt: true,
      suspendReason: true,
      trialEndsAt: true,
      subscriptionStatus: true,
      businessType: true,
      currency: true,
      onboardingCompleted: true,
      createdAt: true,
      owner: { select: { id: true, name: true, email: true, emailVerified: true, createdAt: true } },
      memberships: {
        select: {
          id: true,
          role: true,
          isActive: true,
          createdAt: true,
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
    },
  });

  if (!workspace) {
    return res.status(404).json({ error: "Workspace not found" });
  }

  const recentMovements = await prisma.stockMovement.findMany({
    where: { workspaceId: id },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      type: true,
      quantity: true,
      createdAt: true,
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

  const validPlans = ["FREE", "BASIC", "PRO"];
  if (plan && !validPlans.includes(plan)) {
    return res.status(400).json({ error: "Invalid plan value" });
  }

  const updateData: Record<string, unknown> = {};
  if (plan) updateData.plan = plan;
  if (trialEndsAt !== undefined) updateData.trialEndsAt = trialEndsAt ? new Date(trialEndsAt) : null;
  if (subscriptionStatus !== undefined) updateData.subscriptionStatus = subscriptionStatus;

  await prisma.workspace.update({ where: { id }, data: updateData });

  await logAdminAction(adminId, "workspace_plan_changed", "workspace", id, {
    workspaceName: workspace.name,
    oldPlan: workspace.plan,
    newPlan: plan ?? workspace.plan,
    trialEndsAt: trialEndsAt ?? null,
    subscriptionStatus: subscriptionStatus ?? null,
  });

  return res.json({ ok: true });
}));

adminRouter.get("/users", asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10)));
  const skip = (page - 1) * limit;

  const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
  const verified = typeof req.query.verified === "string" ? req.query.verified : undefined;
  const disabled = typeof req.query.disabled === "string" ? req.query.disabled : undefined;

  const where: Record<string, unknown> = {};

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

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        isDisabled: true,
        platformRole: true,
        createdAt: true,
        _count: { select: { memberships: true } },
      },
    }),
  ]);

  return res.json({
    users: users.map((u) => ({
      ...u,
      workspaceCount: u._count.memberships,
      _count: undefined,
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}));

adminRouter.get("/users/:id", asyncHandler(async (req, res) => {
  const { id } = req.params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      emailVerified: true,
      isDisabled: true,
      passwordResetRequired: true,
      platformRole: true,
      failedLoginAttempts: true,
      lockedUntil: true,
      createdAt: true,
      memberships: {
        select: {
          id: true,
          role: true,
          isActive: true,
          createdAt: true,
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
      id: true,
      action: true,
      entity: true,
      entityId: true,
      createdAt: true,
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
    targetEmail: user.email,
    targetName: user.name,
  });

  return res.json({ ok: true, isDisabled });
}));

adminRouter.post("/users/:id/resend-verification", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, emailVerified: true },
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

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true },
  });
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
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        action: true,
        entity: true,
        entityId: true,
        meta: true,
        createdAt: true,
        admin: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  return res.json({ logs, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));
