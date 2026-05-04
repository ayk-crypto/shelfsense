import crypto from "crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Prisma } from "../generated/prisma/client.js";
import { Role } from "../generated/prisma/enums.js";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { logAuthEvent, logSecurityEvent, logger } from "../lib/logger.js";
import { requireAuth } from "../middleware/auth.js";
import { sendEmailVerificationEmail, sendPasswordResetEmail } from "../services/email.js";
import { asyncHandler } from "../utils/async-handler.js";

export const authRouter = Router();

const DUMMY_PASSWORD_HASH = "$2b$12$Dt24bkQRRvdVeStNHhrFOOuphpa/d7j4EW7c7fv0bUQTZNWu5dzCm";
const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 120;
const MAX_PASSWORD_LENGTH = 128;
const MAX_WORKSPACE_NAME_LENGTH = 160;
const TOKEN_ISSUER = "shelfsense-api";
const TOKEN_AUDIENCE = "shelfsense-web";
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

authRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

authRouter.post("/register", asyncHandler(async (req, res) => {
  const input = parseRegisterInput(req.body);
  const { name: trimmedName, email: trimmedEmail, password, workspaceName: trimmedWorkspaceName } = input;

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

  const existingUser = await prisma.user.findUnique({ where: { email: trimmedEmail }, select: { id: true } });
  if (existingUser) {
    return res.status(409).json({ error: "Email is already registered" });
  }

  const hashedPassword = await bcrypt.hash(password, 12);
  const workspaceDisplayName = trimmedWorkspaceName || `${trimmedName}'s Workspace`;
  const { hash: tokenHash, raw: rawToken } = generateToken();
  const tokenExpiry = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);

  let result: { user: { id: string; name: string; email: string; createdAt: Date }; workspace: { id: string } };

  let currentStep = "init";
  try {
    result = await prisma.$transaction(async (tx) => {
      currentStep = "create_user";
      const user = await tx.user.create({
        data: { name: trimmedName, email: trimmedEmail, password: hashedPassword },
        select: { id: true, name: true, email: true, createdAt: true },
      });

      currentStep = "create_workspace";
      const workspace = await tx.workspace.create({
        data: { name: workspaceDisplayName, ownerId: user.id },
        select: { id: true },
      });

      currentStep = "create_location";
      await tx.location.create({ data: { workspaceId: workspace.id, name: "Main Branch" } });

      currentStep = "create_membership";
      await tx.membership.create({ data: { userId: user.id, workspaceId: workspace.id, role: Role.OWNER } });

      currentStep = "create_email_verif_token";
      await tx.emailVerifToken.create({ data: { userId: user.id, tokenHash, expiresAt: tokenExpiry } });

      return { user, workspace };
    });
  } catch (err) {
    const prismaCode =
      err instanceof Prisma.PrismaClientKnownRequestError ? err.code
      : err instanceof Prisma.PrismaClientInitializationError ? (err.errorCode ?? "INIT_ERROR")
      : undefined;

    logger.error("[AUTH] register failed", {
      step: currentStep,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      prismaCode,
    });

    if (isUniqueConstraintError(err)) {
      return res.status(409).json({ error: "Email is already registered" });
    }
    if (isPrismaConnectionError(err)) {
      return res.status(503).json({ error: "Database is temporarily unavailable. Please try again in a moment." });
    }
    if (isMissingTableError(err)) {
      return res.status(503).json({ error: "Service is not fully initialised. Please try again shortly." });
    }
    throw err;
  }

  logAuthEvent("register", { userId: result.user.id, email: trimmedEmail });
  void sendEmailVerificationEmail(trimmedEmail, rawToken).catch(() => {});

  return res.status(201).json({
    user: {
      id: result.user.id,
      name: result.user.name,
      email: result.user.email,
      emailVerified: false,
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
  const { email: trimmedEmail, password } = input;

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
          customRole: { select: { name: true, color: true, permissions: true } },
        },
        take: 1,
      },
    },
  });

  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    const remainingMs = user.lockedUntil.getTime() - Date.now();
    const remainingMin = Math.ceil(remainingMs / 60000);
    logSecurityEvent("account_locked_attempt", { email: trimmedEmail });
    return res.status(429).json({
      error: `Account temporarily locked due to too many failed attempts. Try again in ${remainingMin} minute${remainingMin !== 1 ? "s" : ""}.`,
    });
  }

  const passwordMatches = await bcrypt.compare(password, user?.password ?? DUMMY_PASSWORD_HASH);

  if (!user || !passwordMatches) {
    if (user) {
      const newAttempts = user.failedLoginAttempts + 1;
      const shouldLock = newAttempts >= LOCKOUT_THRESHOLD;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: newAttempts,
          lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_DURATION_MS) : user.lockedUntil,
        },
      });
      if (shouldLock) {
        logSecurityEvent("account_locked", { userId: user.id, email: trimmedEmail });
      }
    }
    logAuthEvent("login_failure", { email: trimmedEmail });
    return res.status(401).json({ error: "Invalid email or password" });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });

  const membership = user.memberships[0];
  const customRole = membership?.customRole ?? null;

  logAuthEvent("login_success", { userId: user.id, email: trimmedEmail });

  return res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
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

authRouter.post("/forgot-password", asyncHandler(async (req, res) => {
  const input = req.body as { email?: unknown };
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : undefined;

  const GENERIC_OK = "If that email is registered, a reset link has been sent.";

  if (!email || !isValidEmail(email)) {
    return res.json({ message: GENERIC_OK });
  }

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });

  if (!user) {
    await new Promise((r) => setTimeout(r, 200));
    return res.json({ message: GENERIC_OK });
  }

  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

  const { raw: rawToken, hash: tokenHash } = generateToken();
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
  });

  logAuthEvent("password_reset_requested", { userId: user.id, email });
  void sendPasswordResetEmail(email, rawToken).catch(() => {});

  return res.json({ message: GENERIC_OK });
}));

authRouter.post("/reset-password", asyncHandler(async (req, res) => {
  const input = req.body as { token?: unknown; password?: unknown };
  const rawToken = typeof input.token === "string" ? input.token.trim() : undefined;
  const newPassword = typeof input.password === "string" ? input.password : undefined;

  if (!rawToken || !newPassword) {
    return res.status(400).json({ error: "Token and new password are required" });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }
  if (newPassword.length > MAX_PASSWORD_LENGTH) {
    return res.status(400).json({ error: "Password must be 128 characters or fewer" });
  }

  const tokenHash = hashToken(rawToken);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." });
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { password: hashedPassword, failedLoginAttempts: 0, lockedUntil: null },
    }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);

  logAuthEvent("password_reset_completed", { userId: record.userId });

  return res.json({ message: "Password updated successfully. You can now sign in." });
}));

authRouter.post("/verify-email", asyncHandler(async (req, res) => {
  const input = req.body as { token?: unknown };
  const rawToken = typeof input.token === "string" ? input.token.trim() : undefined;

  if (!rawToken) {
    return res.status(400).json({ error: "Verification token is required" });
  }

  const tokenHash = hashToken(rawToken);
  const record = await prisma.emailVerifToken.findUnique({ where: { tokenHash } });

  if (!record) {
    return res.status(400).json({ error: "This verification link is invalid." });
  }
  if (record.usedAt) {
    return res.status(400).json({ error: "This verification link has already been used.", alreadyVerified: true });
  }
  if (record.expiresAt < new Date()) {
    return res.status(400).json({ error: "This verification link has expired. Please request a new one." });
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { emailVerified: true } }),
    prisma.emailVerifToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);

  logAuthEvent("email_verified", { userId: record.userId });

  return res.json({ message: "Email verified successfully." });
}));

authRouter.post("/resend-verification", requireAuth, asyncHandler(async (req, res) => {
  const userId = req.user!.userId;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, emailVerified: true } });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  if (user.emailVerified) {
    return res.status(400).json({ error: "Email is already verified." });
  }

  await prisma.emailVerifToken.deleteMany({ where: { userId } });

  const { raw: rawToken, hash: tokenHash } = generateToken();
  await prisma.emailVerifToken.create({
    data: { userId, tokenHash, expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS) },
  });

  logAuthEvent("verification_resent", { userId });
  void sendEmailVerificationEmail(user.email, rawToken).catch(() => {});

  return res.json({ message: "Verification email sent." });
}));

function signToken(userId: string) {
  return jwt.sign({ userId }, env.jwtSecret, {
    algorithm: "HS256",
    expiresIn: "7d",
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
  });
}

function generateToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("hex");
  return { raw, hash: hashToken(raw) };
}

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function isValidEmail(value: string) {
  return value.length <= MAX_EMAIL_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isUniqueConstraintError(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** DB unreachable / auth failed / timed out */
function isPrismaConnectionError(err: unknown) {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return ["P1000", "P1001", "P1002", "P1008", "P1017"].includes(err.code);
  }
  return false;
}

/** Schema not migrated — table or column missing */
function isMissingTableError(err: unknown) {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return ["P2021", "P2022"].includes(err.code);
  }
  return false;
}

function parseRegisterInput(body: unknown) {
  const input = body as { name?: unknown; email?: unknown; password?: unknown; workspaceName?: unknown };
  return {
    name: parseOptionalString(input.name),
    email: parseOptionalString(input.email)?.toLowerCase(),
    password: typeof input.password === "string" ? input.password : undefined,
    workspaceName: parseOptionalString(input.workspaceName),
  };
}

function parseLoginInput(body: unknown) {
  const input = body as { email?: unknown; password?: unknown };
  return {
    email: parseOptionalString(input.email)?.toLowerCase(),
    password: typeof input.password === "string" ? input.password : undefined,
  };
}

function parseOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}
