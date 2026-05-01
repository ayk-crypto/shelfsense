import { Role } from "../generated/prisma/enums.js";
import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import { ensureDefaultLocation } from "../utils/locations.js";

export const locationsRouter = Router();

locationsRouter.use(requireAuth);

locationsRouter.get("/", asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  await ensureDefaultLocation(workspaceId);

  const locations = await prisma.location.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      workspaceId: true,
      createdAt: true,
    },
  });

  return res.json({ locations });
}));

locationsRouter.post("/", requireRole([Role.OWNER]), asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const name = parseOptionalString((req.body as { name?: unknown }).name);

  if (!name) {
    return res.status(400).json({ error: "Location name is required" });
  }

  const existing = await prisma.location.findFirst({
    where: {
      workspaceId,
      name: { equals: name, mode: "insensitive" },
    },
    select: { id: true },
  });

  if (existing) {
    return res.status(409).json({ error: "Location already exists" });
  }

  const location = await prisma.location.create({
    data: {
      workspaceId,
      name,
    },
    select: {
      id: true,
      name: true,
      workspaceId: true,
      createdAt: true,
    },
  });

  return res.status(201).json({ location });
}));

function parseOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}
