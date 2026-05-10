import { Router } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { requireSuperAdmin } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";

export const adminLifecycleRouter = Router();

// ── Helpers ────────────────────────────────────────────────────────────────

async function logLifecycle(
  workspaceId: string,
  adminId: string,
  action: string,
  note?: string,
  meta?: Record<string, unknown>,
) {
  await prisma.workspaceLifecycleLog.create({
    data: {
      workspaceId,
      adminId,
      action,
      note: note ?? null,
      meta: meta ? (meta as Prisma.InputJsonValue) : undefined,
    },
  });
}

function buildWhere(filter?: string): Record<string, unknown> {
  const now = new Date();
  const soonMs = 7 * 24 * 60 * 60 * 1000;

  switch (filter) {
    case "trial":
      return { trialEndsAt: { gt: now }, deletedAt: null, archivedAt: null };
    case "trial_expiring":
      return {
        trialEndsAt: { gt: now, lte: new Date(now.getTime() + soonMs) },
        deletedAt: null, archivedAt: null,
      };
    case "trial_expired":
      return {
        subscriptionStatus: { in: ["TRIAL", "EXPIRED"] },
        trialEndsAt: { lt: now },
        deletedAt: null, archivedAt: null,
      };
    case "demo":
      return { isDemoWorkspace: true, deletedAt: null, archivedAt: null };
    case "inactive": {
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return {
        deletedAt: null, archivedAt: null,
        stockMovements: { none: { createdAt: { gte: thirtyDaysAgo } } },
        createdAt: { lt: thirtyDaysAgo },
      };
    }
    case "archived":
      return { archivedAt: { not: null }, deletedAt: null };
    case "deleted":
      return { deletedAt: { not: null } };
    default:
      return { deletedAt: null };
  }
}

// ── Stats ──────────────────────────────────────────────────────────────────

adminLifecycleRouter.get("/stats", asyncHandler(async (_req, res) => {
  const now = new Date();
  const soonMs = 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    activeTrials,
    expiringTrials,
    expiredTrials,
    demo,
    archived,
    softDeleted,
    total,
    suspended,
  ] = await Promise.all([
    prisma.workspace.count({ where: { trialEndsAt: { gt: now }, deletedAt: null, archivedAt: null } }),
    prisma.workspace.count({ where: { trialEndsAt: { gt: now, lte: new Date(now.getTime() + soonMs) }, deletedAt: null, archivedAt: null } }),
    prisma.workspace.count({ where: { trialEndsAt: { lt: now }, subscriptionStatus: { in: ["TRIAL", "EXPIRED"] }, deletedAt: null, archivedAt: null } }),
    prisma.workspace.count({ where: { isDemoWorkspace: true, deletedAt: null, archivedAt: null } }),
    prisma.workspace.count({ where: { archivedAt: { not: null }, deletedAt: null } }),
    prisma.workspace.count({ where: { deletedAt: { not: null } } }),
    prisma.workspace.count({ where: { deletedAt: null } }),
    prisma.workspace.count({ where: { suspended: true, deletedAt: null, archivedAt: null } }),
  ]);

  // inactive = no stock movement in 30 days and workspace older than 30 days
  // We count workspaces where latest stockMovement.createdAt < thirtyDaysAgo (or none at all)
  const inactiveRaw = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint as count
    FROM "Workspace" w
    WHERE w."deletedAt" IS NULL
      AND w."archivedAt" IS NULL
      AND w."createdAt" < ${thirtyDaysAgo}
      AND NOT EXISTS (
        SELECT 1 FROM "StockMovement" sm
        WHERE sm."workspaceId" = w.id
          AND sm."createdAt" >= ${thirtyDaysAgo}
      )
  `;
  const inactive = Number(inactiveRaw[0]?.count ?? 0);

  return res.json({
    stats: {
      total,
      activeTrials,
      expiringTrials,
      expiredTrials,
      inactive,
      demo,
      archived,
      softDeleted,
      suspended,
    },
  });
}));

// ── List Workspaces ────────────────────────────────────────────────────────

adminLifecycleRouter.get("/workspaces", asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "25"), 10)));
  const skip = (page - 1) * limit;
  const filter = typeof req.query.filter === "string" ? req.query.filter : "all";
  const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;

  const baseWhere = buildWhere(filter);

  if (search) {
    (baseWhere as Record<string, unknown>).OR = [
      { name: { contains: search, mode: "insensitive" } },
      { owner: { email: { contains: search, mode: "insensitive" } } },
      { owner: { name: { contains: search, mode: "insensitive" } } },
    ];
  }

  const now = new Date();
  const soonMs = 7 * 24 * 60 * 60 * 1000;

  const [total, workspaces] = await Promise.all([
    prisma.workspace.count({ where: baseWhere }),
    prisma.workspace.findMany({
      where: baseWhere,
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
        subscriptionStatus: true,
        trialEndsAt: true,
        trialStartedAt: true,
        trialExtendedAt: true,
        trialExtensionReason: true,
        isDemoWorkspace: true,
        demoResetAt: true,
        archivedAt: true,
        deletedAt: true,
        deletionScheduledAt: true,
        deletionReason: true,
        onboardingCompleted: true,
        createdAt: true,
        owner: { select: { id: true, name: true, email: true } },
        trialExtendedBy: { select: { id: true, name: true } },
        archivedBy: { select: { id: true, name: true } },
        deletedBy: { select: { id: true, name: true } },
        _count: {
          select: {
            memberships: { where: { isActive: true } },
            items: { where: { isActive: true } },
            stockMovements: true,
          },
        },
        stockMovements: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
      },
    }),
  ]);

  const mapped = workspaces.map((w) => {
    const lastActivity = w.stockMovements[0]?.createdAt ?? null;
    let lifecycleStatus = "active";
    if (w.deletedAt) lifecycleStatus = "deleted";
    else if (w.archivedAt) lifecycleStatus = "archived";
    else if (w.isDemoWorkspace) lifecycleStatus = "demo";
    else if (w.suspended) lifecycleStatus = "suspended";
    else if (w.trialEndsAt) {
      if (w.trialEndsAt < now) lifecycleStatus = "trial_expired";
      else if (w.trialEndsAt <= new Date(now.getTime() + soonMs)) lifecycleStatus = "trial_expiring";
      else lifecycleStatus = "trial";
    }

    return {
      id: w.id,
      name: w.name,
      plan: w.plan,
      suspended: w.suspended,
      suspendedAt: w.suspendedAt,
      suspendReason: w.suspendReason,
      subscriptionStatus: w.subscriptionStatus,
      trialEndsAt: w.trialEndsAt,
      trialStartedAt: w.trialStartedAt,
      trialExtendedAt: w.trialExtendedAt,
      trialExtensionReason: w.trialExtensionReason,
      isDemoWorkspace: w.isDemoWorkspace,
      demoResetAt: w.demoResetAt,
      archivedAt: w.archivedAt,
      deletedAt: w.deletedAt,
      deletionScheduledAt: w.deletionScheduledAt,
      deletionReason: w.deletionReason,
      onboardingCompleted: w.onboardingCompleted,
      createdAt: w.createdAt,
      owner: w.owner,
      trialExtendedBy: w.trialExtendedBy,
      archivedBy: w.archivedBy,
      deletedBy: w.deletedBy,
      memberCount: w._count.memberships,
      itemCount: w._count.items,
      stockMovementCount: w._count.stockMovements,
      lastActivityAt: lastActivity,
      lifecycleStatus,
    };
  });

  return res.json({
    workspaces: mapped,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}));

// ── Lifecycle Logs for a workspace ─────────────────────────────────────────

adminLifecycleRouter.get("/workspaces/:id/logs", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10)));
  const skip = (page - 1) * limit;

  const ws = await prisma.workspace.findFirst({ where: { id }, select: { id: true } });
  if (!ws) return res.status(404).json({ error: "Workspace not found" });

  const [total, logs] = await Promise.all([
    prisma.workspaceLifecycleLog.count({ where: { workspaceId: id } }),
    prisma.workspaceLifecycleLog.findMany({
      where: { workspaceId: id },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        action: true,
        note: true,
        meta: true,
        createdAt: true,
        admin: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  return res.json({ logs, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

// ── Trial Management ───────────────────────────────────────────────────────

adminLifecycleRouter.post("/workspaces/:id/start-trial", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const { days, note } = req.body as { days?: number; note?: string };

  const trialDays = Math.max(1, Math.min(365, Number(days ?? 14)));

  const ws = await prisma.workspace.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true, trialEndsAt: true },
  });
  if (!ws) return res.status(404).json({ error: "Workspace not found" });

  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

  await prisma.workspace.update({
    where: { id },
    data: {
      trialEndsAt,
      trialStartedAt: now,
      subscriptionStatus: "TRIAL",
    },
  });

  await logLifecycle(id, adminId, "trial_started", note, { days: trialDays, trialEndsAt: trialEndsAt.toISOString() });

  return res.json({ ok: true, trialEndsAt });
}));

adminLifecycleRouter.post("/workspaces/:id/extend-trial", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const { days, reason, note } = req.body as { days?: number; reason?: string; note?: string };

  const extendDays = Math.max(1, Math.min(365, Number(days ?? 7)));

  const ws = await prisma.workspace.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true, trialEndsAt: true },
  });
  if (!ws) return res.status(404).json({ error: "Workspace not found" });

  const base = ws.trialEndsAt && ws.trialEndsAt > new Date() ? ws.trialEndsAt : new Date();
  const trialEndsAt = new Date(base.getTime() + extendDays * 24 * 60 * 60 * 1000);

  await prisma.workspace.update({
    where: { id },
    data: {
      trialEndsAt,
      trialExtendedAt: new Date(),
      trialExtendedByAdminId: adminId,
      trialExtensionReason: reason ?? null,
      subscriptionStatus: "TRIAL",
    },
  });

  await logLifecycle(id, adminId, "trial_extended", note ?? reason, { days: extendDays, trialEndsAt: trialEndsAt.toISOString() });

  return res.json({ ok: true, trialEndsAt });
}));

adminLifecycleRouter.post("/workspaces/:id/expire-trial", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const { note } = req.body as { note?: string };

  const ws = await prisma.workspace.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!ws) return res.status(404).json({ error: "Workspace not found" });

  const expiredAt = new Date(Date.now() - 1000);

  await prisma.workspace.update({
    where: { id },
    data: {
      trialEndsAt: expiredAt,
      subscriptionStatus: "EXPIRED",
    },
  });

  await logLifecycle(id, adminId, "trial_expired_manual", note);

  return res.json({ ok: true });
}));

// ── Demo Workspace ─────────────────────────────────────────────────────────

adminLifecycleRouter.post("/workspaces/:id/mark-demo", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const { isDemoWorkspace, note } = req.body as { isDemoWorkspace?: boolean; note?: string };
  const flag = isDemoWorkspace !== false;

  const ws = await prisma.workspace.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!ws) return res.status(404).json({ error: "Workspace not found" });

  await prisma.workspace.update({
    where: { id },
    data: { isDemoWorkspace: flag },
  });

  await logLifecycle(id, adminId, flag ? "marked_as_demo" : "unmarked_as_demo", note);

  return res.json({ ok: true, isDemoWorkspace: flag });
}));

adminLifecycleRouter.post("/workspaces/:id/reset-demo", requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const { note } = req.body as { note?: string };

  const ws = await prisma.workspace.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true, isDemoWorkspace: true },
  });
  if (!ws) return res.status(404).json({ error: "Workspace not found" });
  if (!ws.isDemoWorkspace) return res.status(400).json({ error: "Workspace is not marked as a demo workspace." });

  // Count what will be deleted
  const [itemCount, movementCount, batchCount, supplierCount, purchaseCount, countCount] = await Promise.all([
    prisma.item.count({ where: { workspaceId: id } }),
    prisma.stockMovement.count({ where: { workspaceId: id } }),
    prisma.stockBatch.count({ where: { workspaceId: id } }),
    prisma.supplier.count({ where: { workspaceId: id } }),
    prisma.purchase.count({ where: { workspaceId: id } }),
    prisma.stockCount.count({ where: { workspaceId: id } }),
  ]);

  // Hard delete all transactional data — keep workspace structure (locations, memberships, settings)
  await prisma.$transaction([
    prisma.stockMovement.deleteMany({ where: { workspaceId: id } }),
    prisma.stockBatch.deleteMany({ where: { workspaceId: id } }),
    prisma.item.deleteMany({ where: { workspaceId: id } }),
    prisma.purchase.deleteMany({ where: { workspaceId: id } }),
    prisma.supplier.deleteMany({ where: { workspaceId: id } }),
    prisma.stockCount.deleteMany({ where: { workspaceId: id } }),
    prisma.notification.deleteMany({ where: { workspaceId: id } }),
    prisma.auditLog.deleteMany({ where: { workspaceId: id } }),
    prisma.workspace.update({
      where: { id },
      data: { demoResetAt: new Date() },
    }),
  ]);

  await logLifecycle(id, adminId, "demo_reset", note, {
    deleted: { items: itemCount, movements: movementCount, batches: batchCount, suppliers: supplierCount, purchases: purchaseCount, stockCounts: countCount },
  });

  return res.json({
    ok: true,
    deleted: { items: itemCount, movements: movementCount, batches: batchCount, suppliers: supplierCount, purchases: purchaseCount, stockCounts: countCount },
  });
}));

// ── Archive ────────────────────────────────────────────────────────────────

adminLifecycleRouter.post("/workspaces/:id/archive", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const { reason, note } = req.body as { reason?: string; note?: string };

  const ws = await prisma.workspace.findFirst({
    where: { id, deletedAt: null, archivedAt: null },
    select: { id: true, name: true },
  });
  if (!ws) return res.status(404).json({ error: "Workspace not found or already archived" });

  const now = new Date();
  await prisma.workspace.update({
    where: { id },
    data: {
      archivedAt: now,
      archivedByAdminId: adminId,
      suspended: true,
      suspendedAt: now,
      suspendReason: reason ?? "Workspace archived by admin",
    },
  });

  await logLifecycle(id, adminId, "archived", note ?? reason, { reason });

  return res.json({ ok: true });
}));

adminLifecycleRouter.post("/workspaces/:id/unarchive", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const { note } = req.body as { note?: string };

  const ws = await prisma.workspace.findFirst({
    where: { id, deletedAt: null, archivedAt: { not: null } },
    select: { id: true, name: true },
  });
  if (!ws) return res.status(404).json({ error: "Workspace not found or not archived" });

  await prisma.workspace.update({
    where: { id },
    data: {
      archivedAt: null,
      archivedByAdminId: null,
      suspended: false,
      suspendedAt: null,
      suspendReason: null,
    },
  });

  await logLifecycle(id, adminId, "unarchived", note);

  return res.json({ ok: true });
}));

// ── Soft Delete ────────────────────────────────────────────────────────────

adminLifecycleRouter.post("/workspaces/:id/soft-delete", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const { reason, note, scheduleDays } = req.body as { reason?: string; note?: string; scheduleDays?: number };

  const ws = await prisma.workspace.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!ws) return res.status(404).json({ error: "Workspace not found or already deleted" });

  const now = new Date();
  const deletionScheduledAt = scheduleDays && scheduleDays > 0
    ? new Date(now.getTime() + scheduleDays * 24 * 60 * 60 * 1000)
    : null;

  await prisma.workspace.update({
    where: { id },
    data: {
      deletedAt: now,
      deletedByAdminId: adminId,
      deletionReason: reason ?? null,
      deletionScheduledAt,
      suspended: true,
      suspendedAt: now,
      suspendReason: "Workspace deleted",
    },
  });

  await logLifecycle(id, adminId, "soft_deleted", note ?? reason, { reason, scheduleDays, deletionScheduledAt: deletionScheduledAt?.toISOString() });

  return res.json({ ok: true, deletedAt: now, deletionScheduledAt });
}));

adminLifecycleRouter.post("/workspaces/:id/restore", asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const { note } = req.body as { note?: string };

  const ws = await prisma.workspace.findFirst({
    where: { id, deletedAt: { not: null } },
    select: { id: true, name: true },
  });
  if (!ws) return res.status(404).json({ error: "Workspace not found or not deleted" });

  await prisma.workspace.update({
    where: { id },
    data: {
      deletedAt: null,
      deletedByAdminId: null,
      deletionReason: null,
      deletionScheduledAt: null,
      suspended: false,
      suspendedAt: null,
      suspendReason: null,
    },
  });

  await logLifecycle(id, adminId, "restored", note);

  return res.json({ ok: true });
}));

// ── Permanent Delete (SUPER_ADMIN only) ────────────────────────────────────

adminLifecycleRouter.delete("/workspaces/:id/permanent-delete", requireSuperAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = req.user!.id;
  const { confirmPhrase, reason } = req.body as { confirmPhrase?: string; reason?: string };

  const ws = await prisma.workspace.findFirst({
    where: { id },
    select: { id: true, name: true, deletedAt: true },
  });
  if (!ws) return res.status(404).json({ error: "Workspace not found" });

  const expectedPhrase = `permanently delete ${ws.name}`;
  if (confirmPhrase?.trim().toLowerCase() !== expectedPhrase.toLowerCase()) {
    return res.status(400).json({
      error: "Confirmation phrase does not match.",
      expectedPhrase,
    });
  }

  // Log to admin audit log before deletion (lifecycle log will cascade)
  await prisma.adminAuditLog.create({
    data: {
      adminId,
      action: "workspace_permanent_deleted",
      entity: "workspace",
      entityId: id,
      meta: { workspaceName: ws.name, reason: reason ?? null } as Prisma.InputJsonValue,
    },
  });

  // Cascade deletes everything via FK constraints
  await prisma.workspace.delete({ where: { id } });

  return res.json({ ok: true, deleted: { workspaceId: id, workspaceName: ws.name } });
}));
