import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
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
          select: { workspaceId: true },
          take: 1,
        },
      },
    });

    if (!user) {
      return res.status(401).json({ error: "Invalid authentication token" });
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      workspaceId: user.memberships[0]?.workspaceId ?? null,
    };
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid authentication token" });
  }
}

function getBearerToken(req: Request) {
  const header = req.header("authorization");

  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length).trim();
}
