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

const DUMMY_PASSWORD_HASH = "$2b$12$Dt24bkQRRvdVeStNHhrFOOuphpa/d7j4EW7c7fv0bUQTZNWu5dzCm";
const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 120;
const MAX_PASSWORD_LENGTH = 128;
const MAX_WORKSPACE_NAME_LENGTH = 160;
const TOKEN_ISSUER = "shelfsense-api";
const TOKEN_AUDIENCE = "shelfsense-web";

authRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

authRouter.post("/register", asyncHandler(async (req, res) => {
  const input = parseRegisterInput(req.body);
  const trimmedName = input.name;
  const trimmedEmail = input.email;
  const password = input.password;
  const trimmedWorkspaceName = input.workspaceName;

  if (!trimmedName || !trimmedEmail || !password) {
    return res.status(400).json({ error: "Name, email, and password are required" });
  }

  if (trimmedName.length > MAX_NAME_LENGTH) {
    return res.status(400).json({ error: "Name must be 120 characters or fewer" });
  }

  if (trimmedWorkspaceName && trimmedWorkspaceName.length > MAX_WORKSPACE_NAME_LENGTH) {
    return res.status(400).json({ error: "Workspace name must be 160 characters or fewer" });
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

  if (password.length > MAX_PASSWORD_LENGTH) {
    return res.status(400).json({ error: "Password must be 128 characters or fewer" });
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
      customRoleId: null,
      customRoleName: null,
      customRoleColor: null,
      permissions: null,
    },
    token: signToken(result.user.id),
  });
}));

authRouter.post("/login", asyncHandler(async (req, res) => {
  const input = parseLoginInput(req.body);
  const trimmedEmail = input.email;
  const password = input.password;

  if (!trimmedEmail || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  if (!isValidEmail(trimmedEmail) || password.length > MAX_PASSWORD_LENGTH) {
    await bcrypt.compare(password || "invalid", DUMMY_PASSWORD_HASH);
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const user = await prisma.user.findUnique({
    where: { email: trimmedEmail },
    include: {
      memberships: {
        where: { isActive: true },
        orderBy: { createdAt: "asc" },
        select: {
          workspaceId: true,
          role: true,
          customRoleId: true,
          customRole: {
            select: { name: true, color: true, permissions: true },
          },
        },
        take: 1,
      },
    },
  });

  const passwordMatches = await bcrypt.compare(password, user?.password ?? DUMMY_PASSWORD_HASH);

  if (!user || !passwordMatches) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const membership = user.memberships[0];
  const customRole = membership?.customRole ?? null;

  return res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      workspaceId: membership?.workspaceId ?? null,
      role: membership?.role ?? null,
      customRoleId: membership?.customRoleId ?? null,
      customRoleName: customRole?.name ?? null,
      customRoleColor: customRole?.color ?? null,
      permissions: customRole ? (customRole.permissions as string[]) : null,
    },
    token: signToken(user.id),
  });
}));

authRouter.get("/me", requireAuth, (req, res) => {
  return res.json({ user: req.user });
});

function signToken(userId: string) {
  return jwt.sign({ userId }, env.jwtSecret, {
    algorithm: "HS256",
    expiresIn: "7d",
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
  });
}

function isValidEmail(value: string) {
  return value.length <= MAX_EMAIL_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isUniqueConstraintError(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

function parseRegisterInput(body: unknown) {
  const input = body as {
    name?: unknown;
    email?: unknown;
    password?: unknown;
    workspaceName?: unknown;
  };

  return {
    name: parseOptionalString(input.name),
    email: parseOptionalString(input.email)?.toLowerCase(),
    password: typeof input.password === "string" ? input.password : undefined,
    workspaceName: parseOptionalString(input.workspaceName),
  };
}

function parseLoginInput(body: unknown) {
  const input = body as {
    email?: unknown;
    password?: unknown;
  };

  return {
    email: parseOptionalString(input.email)?.toLowerCase(),
    password: typeof input.password === "string" ? input.password : undefined,
  };
}

function parseOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}
