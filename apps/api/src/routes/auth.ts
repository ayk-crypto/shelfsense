import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Prisma } from "../generated/prisma/client.js";
import { Role } from "../generated/prisma/enums.js";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";

export const authRouter = Router();

authRouter.post("/register", asyncHandler(async (req, res) => {
  const { name, email, password, workspaceName } = req.body as {
    name?: string;
    email?: string;
    password?: string;
    workspaceName?: string;
  };

  const trimmedName = name?.trim();
  const trimmedEmail = email?.trim().toLowerCase();
  const trimmedWorkspaceName = workspaceName?.trim();

  if (!trimmedName || !trimmedEmail || !password) {
    return res.status(400).json({ error: "Name, email, and password are required" });
  }

  if (!isValidEmail(trimmedEmail)) {
    return res.status(400).json({ error: "A valid email address is required" });
  }

  if (!password.trim()) {
    return res.status(400).json({ error: "Password cannot be empty" });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: trimmedEmail },
    select: { id: true },
  });

  if (existingUser) {
    return res.status(409).json({ error: "Email is already registered" });
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const workspaceDisplayName = trimmedWorkspaceName || `${trimmedName}'s Workspace`;

  let result: {
    user: { id: string; name: string; email: string; createdAt: Date };
    workspace: { id: string };
  };

  try {
    result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: trimmedName,
          email: trimmedEmail,
          password: hashedPassword,
        },
        select: { id: true, name: true, email: true, createdAt: true },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: workspaceDisplayName,
          ownerId: user.id,
        },
        select: { id: true },
      });

      await tx.location.create({
        data: {
          workspaceId: workspace.id,
          name: "Main Branch",
        },
      });

      await tx.membership.create({
        data: {
          userId: user.id,
          workspaceId: workspace.id,
          role: Role.OWNER,
        },
      });

      return { user, workspace };
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return res.status(409).json({ error: "Email is already registered" });
    }

    throw err;
  }

  return res.status(201).json({
    user: {
      id: result.user.id,
      name: result.user.name,
      email: result.user.email,
      createdAt: result.user.createdAt,
      workspaceId: result.workspace.id,
      role: Role.OWNER,
    },
    token: signToken(result.user.id),
  });
}));

authRouter.post("/login", asyncHandler(async (req, res) => {
  const { email, password } = req.body as {
    email?: string;
    password?: string;
  };

  const trimmedEmail = email?.trim().toLowerCase();

  if (!trimmedEmail || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const user = await prisma.user.findUnique({
    where: { email: trimmedEmail },
    include: {
      memberships: {
        where: { isActive: true },
        orderBy: { createdAt: "asc" },
        select: { workspaceId: true, role: true },
        take: 1,
      },
    },
  });

  if (!user) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const passwordMatches = await bcrypt.compare(password, user.password);

  if (!passwordMatches) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const membership = user.memberships[0];

  return res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      workspaceId: membership?.workspaceId ?? null,
      role: membership?.role ?? null,
    },
    token: signToken(user.id),
  });
}));

authRouter.get("/me", requireAuth, (req, res) => {
  return res.json({ user: req.user });
});

function signToken(userId: string) {
  return jwt.sign({ userId }, env.jwtSecret, { expiresIn: "7d" });
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isUniqueConstraintError(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}
