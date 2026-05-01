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

  const members = await prisma.membership.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
    select: {
      userId: true,
      role: true,
      createdAt: true,
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
      createdAt: member.createdAt,
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
        createdAt: true,
      },
    });

    return {
      userId: user.id,
      name: user.name,
      email: user.email,
      role: membership.role,
      createdAt: membership.createdAt,
    };
  });

  return res.status(201).json({ user: result });
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

function parseOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

function isAssignableRole(value: string): value is Extract<Role, "MANAGER" | "OPERATOR"> {
  return value === Role.MANAGER || value === Role.OPERATOR;
}
