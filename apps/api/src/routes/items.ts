import { Router } from "express";
import { Role } from "../generated/prisma/enums.js";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";

export const itemsRouter = Router();

itemsRouter.use(requireAuth);

itemsRouter.post("/", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const data = parseItemInput(req.body);

  if (!data.name || !data.unit) {
    return res.status(400).json({ error: "Name and unit are required" });
  }

  if (data.barcode) {
    const duplicate = await findDuplicateBarcode(workspaceId, data.barcode);

    if (duplicate) {
      return res.status(400).json({
        error: "Barcode already exists for another item.",
      });
    }
  }

  const item = await prisma.$transaction(async (tx) => {
    const createdItem = await tx.item.create({
      data: {
        ...data,
        name: data.name,
        unit: data.unit,
        workspaceId,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: req.user!.userId,
        workspaceId,
        action: "CREATE_ITEM",
        entity: "Item",
        entityId: createdItem.id,
        meta: sanitizeMeta({
          itemName: createdItem.name,
          unit: createdItem.unit,
          category: createdItem.category,
          minStockLevel: createdItem.minStockLevel,
        }) as Prisma.InputJsonValue,
      },
    });

    return createdItem;
  });

  return res.status(201).json({ item });
}));

itemsRouter.get("/", requireRole([Role.OWNER, Role.MANAGER, Role.OPERATOR]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const includeArchived = parseBooleanQuery(req.query.includeArchived);

  const items = await prisma.item.findMany({
    where: {
      workspaceId,
      isActive: includeArchived ? undefined : true,
    },
    orderBy: { createdAt: "desc" },
  });

  return res.json({ items });
}));

itemsRouter.get("/:id", requireRole([Role.OWNER, Role.MANAGER, Role.OPERATOR]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const item = await prisma.item.findFirst({
    where: { id: req.params.id, workspaceId },
  });

  if (!item) {
    return res.status(404).json({ error: "Item not found" });
  }

  return res.json({ item });
}));

itemsRouter.patch("/:id", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const data = parseItemInput(req.body);

  if (data.name === "" || data.unit === "") {
    return res.status(400).json({ error: "Name and unit cannot be empty" });
  }

  if (data.barcode) {
    const duplicate = await findDuplicateBarcode(
      workspaceId,
      data.barcode,
      req.params.id,
    );

    if (duplicate) {
      return res.status(400).json({
        error: "Barcode already exists for another item.",
      });
    }
  }

  const result = await prisma.item.updateMany({
    where: { id: req.params.id, workspaceId },
    data,
  });

  if (result.count === 0) {
    return res.status(404).json({ error: "Item not found" });
  }

  const item = await prisma.item.findFirst({
    where: { id: req.params.id, workspaceId },
  });

  return res.json({ item });
}));

itemsRouter.delete("/:id", requireRole([Role.OWNER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const item = await prisma.$transaction(async (tx) => {
    const existing = await tx.item.findFirst({
      where: {
        id: req.params.id,
        workspaceId,
      },
      select: {
        id: true,
        name: true,
        isActive: true,
      },
    });

    if (!existing) return null;
    if (!existing.isActive) return existing;

    const archivedItem = await tx.item.update({
      where: { id: existing.id },
      data: {
        isActive: false,
        archivedAt: new Date(),
      },
      select: {
        id: true,
        name: true,
        isActive: true,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: req.user!.userId,
        workspaceId,
        action: "ARCHIVE_ITEM",
        entity: "Item",
        entityId: archivedItem.id,
        meta: sanitizeMeta({
          itemName: archivedItem.name,
        }) as Prisma.InputJsonValue,
      },
    });

    return archivedItem;
  });

  if (!item) {
    return res.status(404).json({ error: "Item not found" });
  }

  return res.status(204).send();
}));

itemsRouter.patch("/:id/reactivate", requireRole([Role.OWNER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const item = await prisma.$transaction(async (tx) => {
    const existing = await tx.item.findFirst({
      where: {
        id: req.params.id,
        workspaceId,
      },
      select: {
        id: true,
        name: true,
        isActive: true,
      },
    });

    if (!existing) return null;
    if (existing.isActive) {
      return tx.item.findUniqueOrThrow({ where: { id: existing.id } });
    }

    const reactivatedItem = await tx.item.update({
      where: { id: existing.id },
      data: {
        isActive: true,
        archivedAt: null,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: req.user!.userId,
        workspaceId,
        action: "REACTIVATE_ITEM",
        entity: "Item",
        entityId: reactivatedItem.id,
        meta: sanitizeMeta({
          itemName: reactivatedItem.name,
        }) as Prisma.InputJsonValue,
      },
    });

    return reactivatedItem;
  });

  if (!item) {
    return res.status(404).json({ error: "Item not found" });
  }

  return res.json({ item });
}));

function getWorkspaceId(req: Express.Request) {
  return req.user?.workspaceId ?? null;
}

async function findDuplicateBarcode(
  workspaceId: string,
  barcode: string,
  excludingItemId?: string,
) {
  return prisma.item.findFirst({
    where: {
      workspaceId,
      barcode,
      id: excludingItemId ? { not: excludingItemId } : undefined,
    },
    select: { id: true },
  });
}

function parseItemInput(body: unknown) {
  const input = body as {
    name?: unknown;
    sku?: unknown;
    barcode?: unknown;
    unit?: unknown;
    category?: unknown;
    minStockLevel?: unknown;
    trackExpiry?: unknown;
  };

  return {
    name: parseOptionalString(input.name),
    sku: parseNullableString(input.sku),
    barcode: parseNullableString(input.barcode),
    unit: parseOptionalString(input.unit),
    category: parseNullableString(input.category),
    minStockLevel:
      typeof input.minStockLevel === "number" ? input.minStockLevel : undefined,
    trackExpiry:
      typeof input.trackExpiry === "boolean" ? input.trackExpiry : undefined,
  };
}

function parseOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

function parseNullableString(value: unknown) {
  if (value === null) {
    return null;
  }

  return typeof value === "string" ? value.trim() : undefined;
}

function parseBooleanQuery(value: unknown) {
  return typeof value === "string" && value.toLowerCase() === "true";
}

function sanitizeMeta(meta: Record<string, unknown>) {
  const blockedKeys = new Set(["password", "token", "authorization", "hash"]);
  return Object.fromEntries(
    Object.entries(meta).filter(([key]) => !blockedKeys.has(key.toLowerCase())),
  );
}
