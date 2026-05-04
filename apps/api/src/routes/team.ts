import bcrypt from "bcryptjs";
import { Router } from "express";
import { PLAN_LIMITS, isAtLimit, type PlanTier } from "../utils/plan-limits.js";
import { Prisma } from "../generated/prisma/client.js";
import { Role } from "../generated/prisma/enums.js";
import { prisma } from "../db/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";

export const teamRouter = Router();

const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 120;
const MAX_PASSWORD_LENGTH = 128;
const MAX_ROLE_NAME_LENGTH = 60;

teamRouter.use(requireAuth);
teamRouter.use(requireRole([Role.OWNER]));

/* ══════════════════════════════════════════════
   TEAM MEMBERS
══════════════════════════════════════════════ */

teamRouter.get("/", asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const includeInactive = parseBooleanQuery(req.query.includeInactive);

  const members = await prisma.membership.findMany({
    where: { workspaceId, isActive: includeInactive ? undefined : true },
    orderBy: { createdAt: "asc" },
    select: memberSelect,
  });

  return res.json({ members: members.map(formatMember) });
}));

teamRouter.post("/users", asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const input = parseCreateTeamUserInput(req.body);

  if (!input.name || !input.email || !input.password || !input.role) {
    return res.status(400).json({ error: "Name, email, password, and role are required" });
  }
  if (input.name.length > MAX_NAME_LENGTH) {
    return res.status(400).json({ error: "Name must be 120 characters or fewer" });
  }
  if (!isValidEmail(input.email)) {
    return res.status(400).json({ error: "A valid email address is required" });
  }
  if (!input.password.trim()) {
    return res.status(400).json({ error: "Password cannot be empty" });
  }
  if (input.password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }
  if (input.password.length > MAX_PASSWORD_LENGTH) {
    return res.status(400).json({ error: "Password must be 128 characters or fewer" });
  }
  if (input.role === "OWNER") {
    return res.status(400).json({ error: "Team users cannot be created as OWNER" });
  }
  if (!isAssignableRole(input.role)) {
    return res.status(400).json({ error: "Role must be MANAGER or OPERATOR" });
  }

  const wsForPlan = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { plan: true },
  });
  if (wsForPlan) {
    const limits = PLAN_LIMITS[wsForPlan.plan as PlanTier];
    if (limits.maxUsers !== -1) {
      const memberCount = await prisma.membership.count({ where: { workspaceId, isActive: true } });
      if (isAtLimit(memberCount, limits.maxUsers)) {
        return res.status(403).json({
          error: `Team member limit reached for your ${wsForPlan.plan} plan (${memberCount}/${limits.maxUsers}). Upgrade your plan to add more members.`,
          code: "PLAN_LIMIT_REACHED",
          limitType: "users",
        });
      }
    }
  }

  // Validate custom role if provided
  let customRoleRecord: { id: string; baseRole: Role } | null = null;
  if (input.customRoleId) {
    customRoleRecord = await prisma.customRole.findFirst({
      where: { id: input.customRoleId, workspaceId },
      select: { id: true, baseRole: true },
    });
    if (!customRoleRecord) {
      return res.status(400).json({ error: "Custom role not found" });
    }
  }

  const effectiveRole = customRoleRecord?.baseRole ?? (input.role as Extract<Role, "MANAGER" | "OPERATOR">);

  const existingUser = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existingUser) {
    return res.status(409).json({ error: "Email is already registered" });
  }

  const hashedPassword = await bcrypt.hash(input.password, 12);

  let result: ReturnType<typeof formatMember>;

  try {
    result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name: input.name!, email: input.email!, password: hashedPassword },
        select: { id: true },
      });

      const membership = await tx.membership.create({
        data: {
          userId: user.id,
          workspaceId,
          role: effectiveRole,
          customRoleId: customRoleRecord?.id ?? null,
        },
        select: memberSelect,
      });

      return formatMember(membership);
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return res.status(409).json({ error: "Email is already registered" });
    }
    throw error;
  }

  return res.status(201).json({ user: result });
}));

teamRouter.patch("/users/:userId", asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;
  const actorUserId = req.user?.userId ?? null;
  if (!workspaceId || !actorUserId) return res.status(403).json({ error: "Workspace access required" });

  const input = parseUpdateTeamUserInput(req.body);

  if (input.role === Role.OWNER) {
    return res.status(400).json({ error: "OWNER role edits are not supported" });
  }
  if (input.role && !isAssignableRole(input.role)) {
    return res.status(400).json({ error: "Role must be MANAGER or OPERATOR" });
  }
  if (!input.name && !input.role && input.customRoleId === undefined) {
    return res.status(400).json({ error: "At least one field (name, role, or customRoleId) is required" });
  }

  // Validate custom role if provided
  let customRoleRecord: { id: string; baseRole: Role } | null = null;
  if (input.customRoleId) {
    customRoleRecord = await prisma.customRole.findFirst({
      where: { id: input.customRoleId, workspaceId },
      select: { id: true, baseRole: true },
    });
    if (!customRoleRecord) {
      return res.status(400).json({ error: "Custom role not found" });
    }
  }

  const member = await prisma.$transaction(async (tx) => {
    const membership = await tx.membership.findFirst({
      where: { userId: req.params.userId, workspaceId },
      select: { id: true, userId: true, role: true },
    });

    if (!membership) return null;

    if (membership.role === Role.OWNER) {
      throw Object.assign(new Error("OWNER membership edits are not supported"), { status: 400 });
    }

    const effectiveRole = customRoleRecord?.baseRole ?? (input.role as Extract<Role, "MANAGER" | "OPERATOR"> | undefined);

    if (input.name) {
      await tx.user.update({ where: { id: membership.userId }, data: { name: input.name } });
    }

    const membershipUpdate: {
      role?: Extract<Role, "MANAGER" | "OPERATOR">;
      customRoleId?: string | null;
    } = {};

    if (effectiveRole) membershipUpdate.role = effectiveRole as Extract<Role, "MANAGER" | "OPERATOR">;

    // Handle custom role assignment / removal
    if (input.customRoleId === null) {
      membershipUpdate.customRoleId = null;
    } else if (customRoleRecord) {
      membershipUpdate.customRoleId = customRoleRecord.id;
    }

    if (Object.keys(membershipUpdate).length > 0) {
      await tx.membership.update({ where: { id: membership.id }, data: membershipUpdate });
    }

    const updated = await tx.membership.findUniqueOrThrow({
      where: { id: membership.id },
      select: memberSelect,
    });

    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        workspaceId,
        action: "UPDATE_TEAM_MEMBER",
        entity: "Membership",
        entityId: membership.userId,
        meta: { targetUserId: membership.userId, name: input.name, role: input.role, customRoleId: input.customRoleId },
      },
    });

    return updated;
  });

  if (!member) return res.status(404).json({ error: "Team member not found" });

  return res.json({ user: formatMember(member) });
}));

teamRouter.patch("/users/:userId/deactivate", asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;
  const actorUserId = req.user?.userId ?? null;
  if (!workspaceId || !actorUserId) return res.status(403).json({ error: "Workspace access required" });

  if (req.params.userId === actorUserId) {
    return res.status(400).json({ error: "You cannot deactivate your own access" });
  }

  const member = await prisma.$transaction(async (tx) => {
    const workspace = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { ownerId: true } });
    const membership = await tx.membership.findFirst({
      where: { userId: req.params.userId, workspaceId },
      select: { id: true, userId: true, role: true, isActive: true, deactivatedAt: true, createdAt: true, updatedAt: true, customRoleId: true, customRole: { select: { name: true, color: true } }, user: { select: { name: true, email: true } } },
    });

    if (!membership) return null;

    if (membership.role === Role.OWNER || workspace?.ownerId === membership.userId) {
      throw Object.assign(new Error("OWNER access cannot be deactivated"), { status: 400 });
    }

    if (!membership.isActive) return membership;

    const updated = await tx.membership.update({
      where: { id: membership.id },
      data: { isActive: false, deactivatedAt: new Date() },
      select: memberSelect,
    });

    await tx.auditLog.create({
      data: { userId: actorUserId, workspaceId, action: "DEACTIVATE_TEAM_MEMBER", entity: "Membership", entityId: updated.userId, meta: { targetUserId: updated.userId, email: updated.user.email, role: updated.role } },
    });

    return updated;
  });

  if (!member) return res.status(404).json({ error: "Team member not found" });
  return res.json({ user: formatMember(member) });
}));

teamRouter.patch("/users/:userId/reactivate", asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;
  const actorUserId = req.user?.userId ?? null;
  if (!workspaceId || !actorUserId) return res.status(403).json({ error: "Workspace access required" });

  const member = await prisma.$transaction(async (tx) => {
    const membership = await tx.membership.findFirst({
      where: { userId: req.params.userId, workspaceId },
      select: { id: true, userId: true, role: true, isActive: true },
    });

    if (!membership) return null;

    if (membership.role === Role.OWNER) {
      throw Object.assign(new Error("OWNER membership reactivation is not supported"), { status: 400 });
    }

    const updated = await tx.membership.update({
      where: { id: membership.id },
      data: { isActive: true, deactivatedAt: null },
      select: memberSelect,
    });

    await tx.auditLog.create({
      data: { userId: actorUserId, workspaceId, action: "REACTIVATE_TEAM_MEMBER", entity: "Membership", entityId: updated.userId, meta: { targetUserId: updated.userId, email: updated.user.email, role: updated.role } },
    });

    return updated;
  });

  if (!member) return res.status(404).json({ error: "Team member not found" });
  return res.json({ user: formatMember(member) });
}));

/* ══════════════════════════════════════════════
   CUSTOM ROLES
══════════════════════════════════════════════ */

teamRouter.get("/custom-roles", asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const customRoles = await prisma.customRole.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { memberships: { where: { isActive: true } } } } },
  });

  return res.json({
    customRoles: customRoles.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      baseRole: r.baseRole,
      permissions: r.permissions,
      memberCount: r._count.memberships,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  });
}));

teamRouter.post("/custom-roles", asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const input = parseCustomRoleInput(req.body);

  if (!input.name) return res.status(400).json({ error: "Role name is required" });
  if (input.name.length > MAX_ROLE_NAME_LENGTH) {
    return res.status(400).json({ error: "Role name must be 60 characters or fewer" });
  }
  if (!input.baseRole || !isAssignableRole(input.baseRole)) {
    return res.status(400).json({ error: "Base role must be MANAGER or OPERATOR" });
  }

  const permissions = Array.isArray(input.permissions) ? input.permissions.filter((p): p is string => typeof p === "string") : [];

  try {
    const customRole = await prisma.customRole.create({
      data: {
        workspaceId,
        name: input.name,
        color: input.color ?? "#6366f1",
        baseRole: input.baseRole as Extract<Role, "MANAGER" | "OPERATOR">,
        permissions,
      },
    });

    return res.status(201).json({
      customRole: {
        id: customRole.id,
        name: customRole.name,
        color: customRole.color,
        baseRole: customRole.baseRole,
        permissions: customRole.permissions,
        memberCount: 0,
        createdAt: customRole.createdAt,
        updatedAt: customRole.updatedAt,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return res.status(409).json({ error: "A role with this name already exists" });
    }
    throw error;
  }
}));

teamRouter.patch("/custom-roles/:roleId", asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const input = parseCustomRoleInput(req.body);

  if (input.name !== undefined && input.name.length > MAX_ROLE_NAME_LENGTH) {
    return res.status(400).json({ error: "Role name must be 60 characters or fewer" });
  }
  if (input.baseRole && !isAssignableRole(input.baseRole)) {
    return res.status(400).json({ error: "Base role must be MANAGER or OPERATOR" });
  }

  const existing = await prisma.customRole.findFirst({
    where: { id: req.params.roleId, workspaceId },
    select: { id: true, baseRole: true },
  });

  if (!existing) return res.status(404).json({ error: "Custom role not found" });

  const updateData: {
    name?: string;
    color?: string;
    baseRole?: Extract<Role, "MANAGER" | "OPERATOR">;
    permissions?: string[];
  } = {};

  if (input.name) updateData.name = input.name;
  if (input.color) updateData.color = input.color;
  if (input.baseRole && isAssignableRole(input.baseRole)) updateData.baseRole = input.baseRole as Extract<Role, "MANAGER" | "OPERATOR">;
  if (Array.isArray(input.permissions)) {
    updateData.permissions = input.permissions.filter((p): p is string => typeof p === "string");
  }

  // If baseRole changed, update all memberships using this role
  if (updateData.baseRole && updateData.baseRole !== existing.baseRole) {
    await prisma.$transaction([
      prisma.customRole.update({ where: { id: existing.id }, data: updateData }),
      prisma.membership.updateMany({
        where: { customRoleId: existing.id },
        data: { role: updateData.baseRole },
      }),
    ]);
  } else {
    try {
      await prisma.customRole.update({ where: { id: existing.id }, data: updateData });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return res.status(409).json({ error: "A role with this name already exists" });
      }
      throw error;
    }
  }

  const updated = await prisma.customRole.findUniqueOrThrow({
    where: { id: existing.id },
    include: { _count: { select: { memberships: { where: { isActive: true } } } } },
  });

  return res.json({
    customRole: {
      id: updated.id,
      name: updated.name,
      color: updated.color,
      baseRole: updated.baseRole,
      permissions: updated.permissions,
      memberCount: updated._count.memberships,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    },
  });
}));

teamRouter.delete("/custom-roles/:roleId", asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const existing = await prisma.customRole.findFirst({
    where: { id: req.params.roleId, workspaceId },
    select: { id: true, baseRole: true, _count: { select: { memberships: true } } },
  });

  if (!existing) return res.status(404).json({ error: "Custom role not found" });

  // Remove custom role from memberships, keep base role
  await prisma.$transaction([
    prisma.membership.updateMany({
      where: { customRoleId: existing.id },
      data: { customRoleId: null },
    }),
    prisma.customRole.delete({ where: { id: existing.id } }),
  ]);

  return res.json({ ok: true });
}));

/* ══════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════ */

const memberSelect = {
  userId: true,
  role: true,
  isActive: true,
  deactivatedAt: true,
  createdAt: true,
  updatedAt: true,
  customRoleId: true,
  customRole: { select: { name: true, color: true } },
  user: { select: { name: true, email: true } },
} as const;

function formatMember(m: {
  userId: string;
  role: Role;
  isActive: boolean;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  customRoleId: string | null;
  customRole: { name: string; color: string } | null;
  user: { name: string; email: string };
}) {
  return {
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    role: m.role,
    customRoleId: m.customRoleId,
    customRoleName: m.customRole?.name ?? null,
    customRoleColor: m.customRole?.color ?? null,
    isActive: m.isActive,
    deactivatedAt: m.deactivatedAt,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

function parseCreateTeamUserInput(body: unknown) {
  const input = body as { name?: unknown; email?: unknown; password?: unknown; role?: unknown; customRoleId?: unknown };
  return {
    name: parseOptionalString(input.name),
    email: parseOptionalString(input.email)?.toLowerCase(),
    password: typeof input.password === "string" ? input.password : undefined,
    role: parseOptionalString(input.role),
    customRoleId: parseOptionalString(input.customRoleId),
  };
}

function parseUpdateTeamUserInput(body: unknown) {
  const input = body as { name?: unknown; role?: unknown; customRoleId?: unknown };
  return {
    name: parseOptionalString(input.name),
    role: parseOptionalString(input.role),
    customRoleId: input.customRoleId === null ? null : parseOptionalString(input.customRoleId),
  };
}

function parseCustomRoleInput(body: unknown) {
  const input = body as { name?: unknown; color?: unknown; baseRole?: unknown; permissions?: unknown };
  return {
    name: parseOptionalString(input.name),
    color: parseOptionalString(input.color),
    baseRole: parseOptionalString(input.baseRole),
    permissions: Array.isArray(input.permissions) ? input.permissions : undefined,
  };
}

function parseOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

function parseBooleanQuery(value: unknown) {
  return typeof value === "string" && value.toLowerCase() === "true";
}

function isAssignableRole(value: string): value is Extract<Role, "MANAGER" | "OPERATOR"> {
  return value === Role.MANAGER || value === Role.OPERATOR;
}

function isValidEmail(value: string) {
  return value.length <= MAX_EMAIL_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
