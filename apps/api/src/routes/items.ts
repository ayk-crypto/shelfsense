import { Router } from "express";
import { Role } from "../generated/prisma/enums.js";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import { PLAN_LIMITS, isAtLimit, type PlanTier } from "../utils/plan-limits.js";

export const itemsRouter = Router();

itemsRouter.use(requireAuth);

const MAX_ITEM_NAME_LENGTH = 160;
const MAX_ITEM_UNIT_LENGTH = 32;
const MAX_ITEM_CATEGORY_LENGTH = 80;
const MAX_ITEM_SKU_LENGTH = 80;
const MAX_ITEM_BARCODE_LENGTH = 120;

itemsRouter.post("/", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { plan: true },
  });
  if (workspace) {
    const limits = PLAN_LIMITS[workspace.plan as PlanTier];
    if (limits.maxItems !== -1) {
      const itemCount = await prisma.item.count({ where: { workspaceId, isActive: true } });
      if (isAtLimit(itemCount, limits.maxItems)) {
        return res.status(403).json({
          error: `Item limit reached for your ${workspace.plan} plan (${itemCount}/${limits.maxItems}). Upgrade your plan to add more items.`,
          code: "PLAN_LIMIT_REACHED",
          limitType: "items",
        });
      }
    }
  }

  const data = parseItemInput(req.body);

  if (!data.name || !data.unit) {
    return res.status(400).json({ error: "Name and unit are required" });
  }

  const validationError = validateItemInput(data);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const name = data.name;
  const unit = data.unit;

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
        name,
        unit,
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

itemsRouter.get("/:id/batches-detail", requireRole([Role.OWNER, Role.MANAGER, Role.OPERATOR]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const [item, workspace] = await Promise.all([
    prisma.item.findFirst({
      where: { id: req.params.id, workspaceId },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        unit: true,
        category: true,
        minStockLevel: true,
        trackExpiry: true,
        isActive: true,
        archivedAt: true,
        createdAt: true,
      },
    }),
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { expiryAlertDays: true },
    }),
  ]);

  if (!item) {
    return res.status(404).json({ error: "Item not found" });
  }

  const [batches, movements] = await Promise.all([
    prisma.stockBatch.findMany({
      where: { workspaceId, itemId: item.id },
      orderBy: [{ remainingQuantity: "desc" }, { expiryDate: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        quantity: true,
        remainingQuantity: true,
        unitCost: true,
        expiryDate: true,
        batchNo: true,
        supplierName: true,
        createdAt: true,
        updatedAt: true,
        location: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
      },
    }),
    prisma.stockMovement.findMany({
      where: { workspaceId, itemId: item.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        batchId: true,
        type: true,
        quantity: true,
        unitCost: true,
        reason: true,
        note: true,
        createdAt: true,
        location: { select: { id: true, name: true } },
        batch: {
          select: {
            id: true,
            batchNo: true,
          },
        },
      },
    }),
  ]);

  const now = new Date();
  const expiryAlertDays = getExpiryAlertDays(workspace?.expiryAlertDays);
  const expiryAlertUntil = new Date(now.getTime() + expiryAlertDays * 86_400_000);

  const responseBatches = batches.map((batch) => {
    const status = getBatchStatus(batch.remainingQuantity, batch.expiryDate, expiryAlertUntil, now);
    const expiryStatus = getExpiryStatus(batch.expiryDate, expiryAlertUntil, now);
    const unitCost = batch.unitCost ?? null;

    return {
      id: batch.id,
      batchNo: batch.batchNo,
      location: batch.location,
      remainingQuantity: batch.remainingQuantity,
      originalQuantity: batch.quantity,
      unitCost,
      totalValue: batch.remainingQuantity * (unitCost ?? 0),
      supplier: batch.supplier
        ? { id: batch.supplier.id, name: batch.supplier.name }
        : batch.supplierName
          ? { id: null, name: batch.supplierName }
          : null,
      expiryDate: batch.expiryDate,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
      status,
      expiryStatus,
    };
  });

  const activeBatches = responseBatches.filter((batch) => batch.remainingQuantity > 0);
  const totalCurrentStock = activeBatches.reduce((total, batch) => total + batch.remainingQuantity, 0);
  const totalStockValue = activeBatches.reduce((total, batch) => total + batch.totalValue, 0);
  const nearestExpiryDate = activeBatches
    .map((batch) => batch.expiryDate)
    .filter((expiryDate): expiryDate is Date => expiryDate !== null)
    .sort((first, second) => first.getTime() - second.getTime())[0] ?? null;

  const itemStatuses = {
    isLowStock: item.minStockLevel !== null && totalCurrentStock <= item.minStockLevel,
    hasExpired: activeBatches.some((batch) => batch.expiryStatus === "EXPIRED"),
    hasExpiringSoon: activeBatches.some((batch) => batch.expiryStatus === "EXPIRING_SOON"),
  };

  return res.json({
    item: {
      ...item,
      totalCurrentStock,
      totalStockValue,
      nearestExpiryDate,
      statuses: itemStatuses,
    },
    batches: responseBatches,
    movements: movements.map((movement) => ({
      id: movement.id,
      batchId: movement.batchId,
      batchNo: movement.batch?.batchNo ?? null,
      type: movement.type,
      quantity: movement.quantity,
      unitCost: movement.unitCost,
      reason: movement.reason,
      note: movement.note,
      location: movement.location,
      createdBy: null,
      createdAt: movement.createdAt,
      reference: movement.batchId,
    })),
    meta: {
      expiryAlertDays,
    },
  });
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

  const validationError = validateItemInput(data);
  if (validationError) {
    return res.status(400).json({ error: validationError });
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

  await prisma.auditLog.create({
    data: {
      userId: req.user!.userId,
      workspaceId,
      action: "UPDATE_ITEM",
      entity: "Item",
      entityId: req.params.id,
      meta: JSON.stringify({ itemName: item?.name }),
    },
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

function getExpiryAlertDays(value: number | null | undefined) {
  return typeof value === "number" && value >= 0 ? value : 7;
}

function getBatchStatus(
  remainingQuantity: number,
  expiryDate: Date | null,
  expiryAlertUntil: Date,
  now: Date,
) {
  if (remainingQuantity <= 0) return "DEPLETED";
  if (!expiryDate) return "ACTIVE";
  if (expiryDate < now) return "EXPIRED";
  if (expiryDate <= expiryAlertUntil) return "EXPIRING_SOON";
  return "ACTIVE";
}

function getExpiryStatus(
  expiryDate: Date | null,
  expiryAlertUntil: Date,
  now: Date,
) {
  if (!expiryDate) return "NO_EXPIRY";
  if (expiryDate < now) return "EXPIRED";
  if (expiryDate <= expiryAlertUntil) return "EXPIRING_SOON";
  return "HEALTHY";
}

function validateItemInput(input: ReturnType<typeof parseItemInput>) {
  if (input.name && input.name.length > MAX_ITEM_NAME_LENGTH) {
    return "Item name must be 160 characters or fewer";
  }

  if (input.unit && input.unit.length > MAX_ITEM_UNIT_LENGTH) {
    return "Unit must be 32 characters or fewer";
  }

  if (input.category && input.category.length > MAX_ITEM_CATEGORY_LENGTH) {
    return "Category must be 80 characters or fewer";
  }

  if (input.sku && input.sku.length > MAX_ITEM_SKU_LENGTH) {
    return "SKU must be 80 characters or fewer";
  }

  if (input.barcode && input.barcode.length > MAX_ITEM_BARCODE_LENGTH) {
    return "Barcode must be 120 characters or fewer";
  }

  if (input.minStockLevel !== undefined && input.minStockLevel < 0) {
    return "Minimum stock level cannot be negative";
  }

  return null;
}

function sanitizeMeta(meta: Record<string, unknown>) {
  const blockedKeys = new Set(["password", "token", "authorization", "hash"]);
  return Object.fromEntries(
    Object.entries(meta).filter(([key]) => !blockedKeys.has(key.toLowerCase())),
  );
}
