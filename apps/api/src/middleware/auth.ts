import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "../generated/prisma/enums.js";
import { PlatformRole } from "../generated/prisma/enums.js";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";

interface AuthTokenPayload {
  userId: string;
  iss?: string;
  aud?: string;
}

const TOKEN_ISSUER = "shelfsense-api";
const TOKEN_AUDIENCE = "shelfsense-web";

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const token = getBearerToken(req);

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret, {
      algorithms: ["HS256"],
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    }) as AuthTokenPayload;

    if (!payload.userId) {
      return res.status(401).json({ error: "Invalid authentication token" });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        isDisabled: true,
        platformRole: true,
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

    if (!user) {
      return res.status(401).json({ error: "Invalid authentication token" });
    }

    if (user.isDisabled) {
      return res.status(403).json({ error: "This account has been disabled. Contact support." });
    }

    const membership = user.memberships[0];
    const customRole = membership?.customRole ?? null;

    req.user = {
      userId: user.id,
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      platformRole: user.platformRole,
      workspaceId: membership?.workspaceId ?? null,
      role: membership?.role ?? null,
      customRoleId: membership?.customRoleId ?? null,
      customRoleName: customRole?.name ?? null,
      customRoleColor: customRole?.color ?? null,
      permissions: customRole ? (customRole.permissions as string[]) : null,
    };

    return next();
  } catch {
    return res.status(401).json({ error: "Invalid authentication token" });
  }
}

export function requireRole(allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = req.user?.role;

    if (!role || !allowedRoles.includes(role)) {
      return res.status(403).json({
        message: "You do not have permission to perform this action.",
      });
    }

    return next();
  };
}

export function requirePlatformAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const platformRole = req.user?.platformRole;

  if (platformRole !== PlatformRole.SUPER_ADMIN) {
    return res.status(403).json({ error: "Platform admin access required." });
  }

  return next();
}

function getBearerToken(req: Request) {
  const header = req.header("authorization");

  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length).trim();
}
