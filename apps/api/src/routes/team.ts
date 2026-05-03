import bcrypt from "bcryptjs";
import { Router } from "express";
import { Role } from "../generated/prisma/enums.js";
import { prisma } from "../db/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";

export const teamRouter = Router();

teamRouter.use(requireAuth);
teamRouter.use(requireRole([Role.OWNER]));

teamRouter.get("/", asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const includeInactive = parseBooleanQuery(req.query.includeInactive);

  const members = await prisma.membership.findMany({
    where: {
      workspaceId,
      isActive: includeInactive ? undefined : true,
    },
    orderBy: { createdAt: "asc" },
    select: {
      userId: true,
      role: true,
      isActive: true,
      deactivatedAt: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: {
          name: true,
          email: true,
        },
      },
    },
  });

  return res.json({
    members: members.map((member) => ({
      userId: member.userId,
      name: member.user.name,
      email: member.user.email,
      role: member.role,
      isActive: member.isActive,
      deactivatedAt: member.deactivatedAt,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
    })),
  });
}));

teamRouter.post("/users", asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const input = parseCreateTeamUserInput(req.body);

  if (!input.name || !input.email || !input.password || !input.role) {
    return res.status(400).json({ error: "Name, email, password, and role are required" });
  }

  if (input.role === "OWNER") {
    return res.status(400).json({ error: "Team users cannot be created as OWNER" });
  }

  if (!isAssignableRole(input.role)) {
    return res.status(400).json({ error: "Role must be MANAGER or OPERATOR" });
  }

  const name = input.name;
  const email = input.email;
  const password = input.password;
  const role = input.role;

  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existingUser) {
    return res.status(409).json({ error: "Email is already registered" });
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
      },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
      },
    });

    const membership = await tx.membership.create({
      data: {
        userId: user.id,
        workspaceId,
        role,
      },
      select: {
        role: true,
        isActive: true,
        deactivatedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      role: membership.role,
      isActive: membership.isActive,
      deactivatedAt: membership.deactivatedAt,
      createdAt: membership.createdAt,
      updatedAt: membership.updatedAt,
    };
  });

  return res.status(201).json({ user: result });
}));

teamRouter.patch("/users/:userId", asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;
  const actorUserId = req.user?.userId ?? null;

  if (!workspaceId || !actorUserId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const input = parseUpdateTeamUserInput(req.body);

  if (input.name === "" || input.role === "") {
    return res.status(400).json({ error: "Name and role cannot be empty" });
  }

  if (input.role === Role.OWNER) {
    return res.status(400).json({ error: "OWNER role edits are not supported" });
  }

  if (input.role && !isAssignableRole(input.role)) {
    return res.status(400).json({ error: "Role must be MANAGER or OPERATOR" });
  }

  if (!input.name && !input.role) {
    return res.status(400).json({ error: "Name or role is required" });
  }

  const nextRole = input.role as Extract<Role, "MANAGER" | "OPERATOR"> | undefined;

  const member = await prisma.$transaction(async (tx) => {
    const membership = await tx.membership.findFirst({
      where: {
        userId: req.params.userId,
        workspaceId,
      },
      select: {
        id: true,
        userId: true,
        role: true,
        isActive: true,
        deactivatedAt: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    if (!membership) {
      return null;
    }

    if (membership.role === Role.OWNER) {
      throw Object.assign(new Error("OWNER membership edits are not supported"), { status: 400 });
    }

    if (input.name) {
      await tx.user.update({
        where: { id: membership.userId },
        data: { name: input.name },
      });
    }

    if (nextRole) {
      await tx.membership.update({
        where: { id: membership.id },
        data: { role: nextRole },
      });
    }

    const updatedMember = await tx.membership.findUniqueOrThrow({
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
        meta: {
          targetUserId: membership.userId,
          name: input.name,
          role: input.role,
        },
      },
    });

    return updatedMember;
  });

  if (!member) {
    return res.status(404).json({ error: "Team member not found" });
  }

  return res.json({ user: formatMember(member) });
}));

teamRouter.patch("/users/:userId/deactivate", asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;
  const actorUserId = req.user?.userId ?? null;

  if (!workspaceId || !actorUserId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  if (req.params.userId === actorUserId) {
    return res.status(400).json({ error: "You cannot deactivate your own access" });
  }

  const member = await prisma.$transaction(async (tx) => {
    const workspace = await tx.workspace.findUnique({
      where: { id: workspaceId },
      select: { ownerId: true },
    });

    const membership = await tx.membership.findFirst({
      where: {
        userId: req.params.userId,
        workspaceId,
      },
      select: {
        id: true,
        userId: true,
        role: true,
        isActive: true,
        deactivatedAt: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    if (!membership) {
      return null;
    }

    if (membership.role === Role.OWNER || workspace?.ownerId === membership.userId) {
      throw Object.assign(new Error("OWNER access cannot be deactivated"), { status: 400 });
    }

    if (!membership.isActive) {
      return membership;
    }

    const updatedMember = await tx.membership.update({
      where: { id: membership.id },
      data: {
        isActive: false,
        deactivatedAt: new Date(),
      },
      select: {
        userId: true,
        role: true,
        isActive: true,
        deactivatedAt: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        workspaceId,
        action: "DEACTIVATE_TEAM_MEMBER",
        entity: "Membership",
        entityId: updatedMember.userId,
        meta: {
          targetUserId: updatedMember.userId,
          email: updatedMember.user.email,
          role: updatedMember.role,
        },
      },
    });

    return updatedMember;
  });

  if (!member) {
    return res.status(404).json({ error: "Team member not found" });
  }

  return res.json({ user: formatMember(member) });
}));

teamRouter.patch("/users/:userId/reactivate", asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;
  const actorUserId = req.user?.userId ?? null;

  if (!workspaceId || !actorUserId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const member = await prisma.$transaction(async (tx) => {
    const membership = await tx.membership.findFirst({
      where: {
        userId: req.params.userId,
        workspaceId,
      },
      select: {
        id: true,
        userId: true,
        role: true,
        isActive: true,
      },
    });

    if (!membership) {
      return null;
    }

    if (membership.role === Role.OWNER) {
      throw Object.assign(new Error("OWNER membership reactivation is not supported"), { status: 400 });
    }

    const updatedMember = await tx.membership.update({
      where: { id: membership.id },
      data: {
        isActive: true,
        deactivatedAt: null,
      },
      select: {
        userId: true,
        role: true,
        isActive: true,
        deactivatedAt: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        workspaceId,
        action: "REACTIVATE_TEAM_MEMBER",
        entity: "Membership",
        entityId: updatedMember.userId,
        meta: {
          targetUserId: updatedMember.userId,
          email: updatedMember.user.email,
          role: updatedMember.role,
        },
      },
    });

    return updatedMember;
  });

  if (!member) {
    return res.status(404).json({ error: "Team member not found" });
  }

  return res.json({ user: formatMember(member) });
}));

function parseCreateTeamUserInput(body: unknown) {
  const input = body as {
    name?: unknown;
    email?: unknown;
    password?: unknown;
    role?: unknown;
  };

  return {
    name: parseOptionalString(input.name),
    email: parseOptionalString(input.email)?.toLowerCase(),
    password: parseOptionalString(input.password),
    role: parseOptionalString(input.role),
  };
}

function parseUpdateTeamUserInput(body: unknown) {
  const input = body as {
    name?: unknown;
    role?: unknown;
  };

  return {
    name: parseOptionalString(input.name),
    role: parseOptionalString(input.role),
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

const memberSelect = {
  userId: true,
  role: true,
  isActive: true,
  deactivatedAt: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      name: true,
      email: true,
    },
  },
} as const;

function formatMember(member: {
  userId: string;
  role: Role;
  isActive: boolean;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  user: {
    name: string;
    email: string;
  };
}) {
  return {
    userId: member.userId,
    name: member.user.name,
    email: member.user.email,
    role: member.role,
    isActive: member.isActive,
    deactivatedAt: member.deactivatedAt,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
  };
}
