import { Role } from "../generated/prisma/enums.js";
import { Router } from "express";
import { Prisma } from "../generated/prisma/client.js";
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

  const includeArchived = parseBooleanQuery(req.query.includeArchived);

  await ensureDefaultLocation(workspaceId);

  const locations = await prisma.location.findMany({
    where: {
      workspaceId,
      isActive: includeArchived ? undefined : true,
    },
    orderBy: { createdAt: "asc" },
    select: locationSelect,
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
    select: locationSelect,
  });

  return res.status(201).json({ location });
}));

locationsRouter.patch("/:id", requireRole([Role.OWNER]), asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;
  const actorUserId = req.user?.userId ?? null;

  if (!workspaceId || !actorUserId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const name = parseOptionalString((req.body as { name?: unknown }).name);

  if (!name) {
    return res.status(400).json({ error: "Location name is required" });
  }

  const duplicate = await prisma.location.findFirst({
    where: {
      workspaceId,
      id: { not: req.params.id },
      name: { equals: name, mode: "insensitive" },
    },
    select: { id: true },
  });

  if (duplicate) {
    return res.status(409).json({ error: "Location already exists" });
  }

  const location = await prisma.$transaction(async (tx) => {
    const result = await tx.location.updateMany({
      where: {
        id: req.params.id,
        workspaceId,
      },
      data: { name },
    });

    if (result.count === 0) {
      return null;
    }

    const updatedLocation = await tx.location.findFirstOrThrow({
      where: {
        id: req.params.id,
        workspaceId,
      },
      select: locationSelect,
    });

    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        workspaceId,
        action: "UPDATE_LOCATION",
        entity: "Location",
        entityId: updatedLocation.id,
        meta: {
          locationName: updatedLocation.name,
        },
      },
    });

    return updatedLocation;
  });

  if (!location) {
    return res.status(404).json({ error: "Location not found" });
  }

  return res.json({ location });
}));

locationsRouter.patch("/:id/archive", requireRole([Role.OWNER]), asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;
  const actorUserId = req.user?.userId ?? null;

  if (!workspaceId || !actorUserId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const location = await archiveLocationWithRetry(workspaceId, actorUserId, req.params.id);

  if (!location) {
    return res.status(404).json({ error: "Location not found" });
  }

  return res.json({ location });
}));

locationsRouter.patch("/:id/reactivate", requireRole([Role.OWNER]), asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;
  const actorUserId = req.user?.userId ?? null;

  if (!workspaceId || !actorUserId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const location = await prisma.$transaction(async (tx) => {
    const existing = await tx.location.findFirst({
      where: {
        id: req.params.id,
        workspaceId,
      },
      select: locationSelect,
    });

    if (!existing) {
      return null;
    }

    if (existing.isActive) {
      return existing;
    }

    const updatedLocation = await tx.location.update({
      where: { id: existing.id },
      data: {
        isActive: true,
        archivedAt: null,
      },
      select: locationSelect,
    });

    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        workspaceId,
        action: "REACTIVATE_LOCATION",
        entity: "Location",
        entityId: updatedLocation.id,
        meta: {
          locationName: updatedLocation.name,
        },
      },
    });

    return updatedLocation;
  });

  if (!location) {
    return res.status(404).json({ error: "Location not found" });
  }

  return res.json({ location });
}));

function parseOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

function parseBooleanQuery(value: unknown) {
  return typeof value === "string" && value.toLowerCase() === "true";
}

const locationSelect = {
  id: true,
  name: true,
  workspaceId: true,
  isActive: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

async function archiveLocationWithRetry(
  workspaceId: string,
  actorUserId: string,
  locationId: string,
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await archiveLocation(workspaceId, actorUserId, locationId);
    } catch (error) {
      lastError = error;

      if (!isSerializationConflict(error)) {
        throw error;
      }

      if (attempt === 3) {
        throw Object.assign(new Error("Location changed. Please retry."), { status: 409 });
      }
    }
  }

  throw lastError;
}

async function archiveLocation(
  workspaceId: string,
  actorUserId: string,
  locationId: string,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.location.findFirst({
      where: {
        id: locationId,
        workspaceId,
      },
      select: locationSelect,
    });

    if (!existing) {
      return null;
    }

    if (!existing.isActive) {
      return existing;
    }

    const remainingStockCount = await tx.stockBatch.count({
      where: {
        workspaceId,
        locationId: existing.id,
        remainingQuantity: { gt: 0 },
      },
    });

    if (remainingStockCount > 0) {
      throw Object.assign(new Error("Cannot archive a location with remaining stock"), { status: 400 });
    }

    const otherActiveLocationCount = await tx.location.count({
      where: {
        workspaceId,
        isActive: true,
        id: { not: existing.id },
      },
    });

    if (otherActiveLocationCount === 0) {
      throw Object.assign(new Error("Cannot archive the last active location"), { status: 400 });
    }

    const updatedLocation = await tx.location.update({
      where: { id: existing.id },
      data: {
        isActive: false,
        archivedAt: new Date(),
      },
      select: locationSelect,
    });

    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        workspaceId,
        action: "ARCHIVE_LOCATION",
        entity: "Location",
        entityId: updatedLocation.id,
        meta: {
          locationName: updatedLocation.name,
        },
      },
    });

    return updatedLocation;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function isSerializationConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}
