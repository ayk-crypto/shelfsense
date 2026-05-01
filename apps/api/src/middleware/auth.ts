import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "../generated/prisma/enums.js";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";

interface AuthTokenPayload {
  userId: string;
}

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
    const payload = jwt.verify(token, env.jwtSecret) as AuthTokenPayload;
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        name: true,
        email: true,
        memberships: {
          orderBy: { createdAt: "asc" },
          select: { workspaceId: true, role: true },
          take: 1,
        },
      },
    });

    if (!user) {
      return res.status(401).json({ error: "Invalid authentication token" });
    }

    const membership = user.memberships[0];

    req.user = {
      userId: user.id,
      id: user.id,
      name: user.name,
      email: user.email,
      workspaceId: membership?.workspaceId ?? null,
      role: membership?.role ?? null,
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

function getBearerToken(req: Request) {
  const header = req.header("authorization");

  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length).trim();
}
