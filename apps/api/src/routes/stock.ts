import { Role, StockMovementType } from "../generated/prisma/enums.js";
import { Router, type Request } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { requireActiveWorkspace, requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import { logAction } from "../utils/audit-log.js";
import { assertActiveLocation, assertActiveLocations, getActiveLocationId } from "../utils/locations.js";

export const stockRouter = Router();

stockRouter.use(requireAuth);
stockRouter.use(requireActiveWorkspace);

stockRouter.post("/in", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }
  const locationId = await getActiveLocationId(req, workspaceId);

  const input = parseStockInInput(req.body);

  if (!input.itemId || input.quantity === undefined) {
    return res.status(400).json({ error: "Item and quantity are required" });
  }

  const quantity = input.quantity;

  if (quantity <= 0) {
    return res.status(400).json({ error: "Quantity must be greater than zero" });
  }

  if (input.expiryDate === "invalid") {
    return res.status(400).json({ error: "Expiry date must be a valid date" });
  }

  const itemId = input.itemId;
  const expiryDate = input.expiryDate;

  const item = await prisma.item.findFirst({
    where: { id: itemId, workspaceId, isActive: true },
    select: { id: true, name: true, unit: true },
  });

  if (!item) {
    return res.status(404).json({ error: "Item not found" });
  }

  try {
    const result = await runSerializableWrite(async (tx) => {
      await assertActiveLocation(tx, workspaceId, locationId);
      await assertActiveItem(tx, workspaceId, itemId);

      const latestPricedBatch = input.unitCost === undefined
        ? await tx.stockBatch.findFirst({
            where: {
              itemId,
              workspaceId,
              locationId,
              unitCost: { not: null },
            },
            orderBy: { createdAt: "desc" },
            select: { unitCost: true },
          })
        : null;
      // Quick stock-in actions do not send cost, so reuse the latest known cost to keep valuation stable.
      const effectiveUnitCost = input.unitCost ?? latestPricedBatch?.unitCost ?? null;

      const batch = await tx.stockBatch.create({
        data: {
          itemId,
          workspaceId,
          locationId,
          quantity,
          remainingQuantity: quantity,
          unitCost: effectiveUnitCost,
          expiryDate,
          batchNo: input.batchNo,
          supplierId: input.supplierId ?? null,
          supplierName: input.supplierName,
        },
      });

      const movement = await tx.stockMovement.create({
        data: {
          workspaceId,
          locationId,
          itemId,
          batchId: batch.id,
          type: StockMovementType.STOCK_IN,
          quantity,
          unitCost: effectiveUnitCost,
          note: input.note,
        },
      });

      return { batch, movement };
    });

    await logAction({
      userId: req.user!.userId,
      workspaceId,
      action: "STOCK_IN",
      entity: "Stock",
      entityId: itemId,
      meta: {
        itemName: item.name,
        unit: item.unit,
        quantity,
        locationId,
        note: input.note,
      },
    });

    return res.status(201).json(result);
  } catch (error) {
    if (isWriteConflict(error)) {
      return res.status(409).json({ error: "Inventory changed. Please retry." });
    }

    throw error;
  }
}));

stockRouter.post("/out", requireRole([Role.OWNER, Role.MANAGER, Role.OPERATOR]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }
  const locationId = await getActiveLocationId(req, workspaceId);

  const input = parseStockOutInput(req.body);

  if (!input.itemId || input.quantity === undefined) {
    return res.status(400).json({ error: "Item and quantity are required" });
  }

  const itemId = input.itemId;
  const quantity = input.quantity;

  if (quantity <= 0) {
    return res.status(400).json({ error: "Quantity must be greater than zero" });
  }

  const item = await prisma.item.findFirst({
    where: { id: itemId, workspaceId, isActive: true },
    select: { id: true, name: true, unit: true },
  });

  if (!item) {
    return res.status(404).json({ error: "Item not found" });
  }

  try {
    const result = await runSerializableWrite(async (tx) => {
      await assertActiveLocation(tx, workspaceId, locationId);
      await assertActiveItem(tx, workspaceId, itemId);

      const batches = await tx.stockBatch.findMany({
        where: {
          itemId,
          workspaceId,
          locationId,
          remainingQuantity: { gt: 0 },
        },
        select: {
          id: true,
          remainingQuantity: true,
          unitCost: true,
          expiryDate: true,
          createdAt: true,
        },
      });

      const availableQuantity = batches.reduce(
        (total, batch) => total + batch.remainingQuantity,
        0,
      );

      if (availableQuantity < quantity) {
        throw new InsufficientStockError(item.name, quantity, availableQuantity);
      }

      const sortedBatches = batches.sort(compareFifoBatches);
      let quantityToDeduct = quantity;
      const movements = [];

      for (const batch of sortedBatches) {
        if (quantityToDeduct <= 0) {
          break;
        }

        const deductedQuantity = Math.min(batch.remainingQuantity, quantityToDeduct);
        quantityToDeduct -= deductedQuantity;

        const updated = await tx.stockBatch.updateMany({
          where: {
            id: batch.id,
            workspaceId,
            locationId,
            remainingQuantity: { gte: deductedQuantity },
          },
          data: {
            remainingQuantity: { decrement: deductedQuantity },
          },
        });

        if (updated.count === 0) {
          throw new StockConflictError();
        }

        const wastageReasons = new Set(["wastage", "damaged", "expired"]);
        const movementType = input.reason && wastageReasons.has(input.reason)
          ? StockMovementType.WASTAGE
          : StockMovementType.STOCK_OUT;

        const movement = await tx.stockMovement.create({
          data: {
            workspaceId,
            locationId,
            itemId,
            batchId: batch.id,
            type: movementType,
            quantity: deductedQuantity,
            unitCost: batch.unitCost,
            reason: input.reason,
            note: input.note,
          },
        });

        movements.push(movement);
      }

      return { movements };
    });

    await logAction({
      userId: req.user!.userId,
      workspaceId,
      action: "STOCK_OUT",
      entity: "Stock",
      entityId: itemId,
      meta: {
        itemName: item.name,
        unit: item.unit,
        quantity,
        locationId,
        reason: input.reason,
        note: input.note,
      },
    });

    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      return res.status(400).json({ error: error.message });
    }

    if (isWriteConflict(error)) {
      return res.status(409).json({ error: "Inventory changed. Please retry." });
    }

    throw error;
  }
}));

stockRouter.post("/transfer", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const input = parseStockTransferInput(req.body);

  if (
    !input.itemId ||
    !input.fromLocationId ||
    !input.toLocationId ||
    input.quantity === undefined
  ) {
    return res.status(400).json({ error: "Item, locations, and quantity are required" });
  }

  if (input.fromLocationId === input.toLocationId) {
    return res.status(400).json({ error: "Source and destination locations must be different" });
  }

  if (input.quantity <= 0) {
    return res.status(400).json({ error: "Quantity must be greater than zero" });
  }

  const itemId = input.itemId;
  const fromLocationId = input.fromLocationId;
  const toLocationId = input.toLocationId;
  const quantity = input.quantity;

  const [item, locations] = await Promise.all([
    prisma.item.findFirst({
      where: { id: itemId, workspaceId, isActive: true },
      select: { id: true, name: true, unit: true },
    }),
    prisma.location.findMany({
      where: {
        workspaceId,
        id: { in: [fromLocationId, toLocationId] },
        isActive: true,
      },
      select: { id: true, name: true },
    }),
  ]);

  if (!item) {
    return res.status(404).json({ error: "Item not found" });
  }

  if (locations.length !== 2) {
    return res.status(400).json({ error: "Both locations must be active and belong to this workspace" });
  }

  const toLocation = locations.find((location) => location.id === toLocationId)!;
  const fromLocation = locations.find((location) => location.id === fromLocationId)!;

  try {
    const result = await runSerializableWrite(async (tx) => {
      await assertActiveLocations(tx, workspaceId, [fromLocationId, toLocationId]);
      await assertActiveItem(tx, workspaceId, itemId);

      const batches = await tx.stockBatch.findMany({
        where: {
          itemId,
          workspaceId,
          locationId: fromLocationId,
          remainingQuantity: { gt: 0 },
        },
        select: {
          id: true,
          remainingQuantity: true,
          unitCost: true,
          expiryDate: true,
          batchNo: true,
          supplierName: true,
          createdAt: true,
        },
      });

      const availableQuantity = batches.reduce(
        (total, batch) => total + batch.remainingQuantity,
        0,
      );

      if (availableQuantity < quantity) {
        throw new InsufficientStockError(item.name, quantity, availableQuantity);
      }

      const sortedBatches = batches.sort(compareFifoBatches);
      let quantityToTransfer = quantity;
      const movements = [];

      for (const batch of sortedBatches) {
        if (quantityToTransfer <= 0) {
          break;
        }

        const transferredQuantity = Math.min(batch.remainingQuantity, quantityToTransfer);
        quantityToTransfer -= transferredQuantity;

        const updated = await tx.stockBatch.updateMany({
          where: {
            id: batch.id,
            workspaceId,
            locationId: fromLocationId,
            remainingQuantity: { gte: transferredQuantity },
          },
          data: {
            remainingQuantity: { decrement: transferredQuantity },
          },
        });

        if (updated.count === 0) {
          throw new StockConflictError();
        }

        const transferOut = await tx.stockMovement.create({
          data: {
            workspaceId,
            locationId: fromLocationId,
            itemId,
            batchId: batch.id,
            type: StockMovementType.TRANSFER_OUT,
            quantity: transferredQuantity,
            unitCost: batch.unitCost,
            reason: "transfer",
            note: `Transferred to ${toLocation.name}`,
          },
        });

        const destinationBatch = await tx.stockBatch.create({
          data: {
            itemId,
            workspaceId,
            locationId: toLocationId,
            quantity: transferredQuantity,
            remainingQuantity: transferredQuantity,
            unitCost: batch.unitCost,
            expiryDate: batch.expiryDate,
            batchNo: batch.batchNo,
            supplierName: batch.supplierName,
          },
        });

        const transferIn = await tx.stockMovement.create({
          data: {
            workspaceId,
            locationId: toLocationId,
            itemId,
            batchId: destinationBatch.id,
            type: StockMovementType.TRANSFER_IN,
            quantity: transferredQuantity,
            unitCost: batch.unitCost,
            reason: "transfer",
            note: "Transferred from another location",
          },
        });

        movements.push(transferOut, transferIn);
      }

      return { movements };
    });

    await logAction({
      userId: req.user!.userId,
      workspaceId,
      action: "TRANSFER",
      entity: "Stock",
      entityId: itemId,
      meta: {
        itemName: item.name,
        unit: item.unit,
        quantity,
        fromLocationId,
        fromLocationName: fromLocation.name,
        toLocationId,
        toLocationName: toLocation.name,
      },
    });

    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      return res.status(400).json({ error: error.message });
    }

    if (isWriteConflict(error)) {
      return res.status(409).json({ error: "Inventory changed. Please retry." });
    }

    throw error;
  }
}));

stockRouter.get("/summary", requireRole([Role.OWNER, Role.MANAGER, Role.OPERATOR]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }
  const locationId = await getActiveLocationId(req, workspaceId);

  const items = await prisma.item.findMany({
    where: { workspaceId, isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      unit: true,
      minStockLevel: true,
      stockBatches: {
        where: {
          workspaceId,
          locationId,
          remainingQuantity: { gt: 0 },
        },
        select: {
          remainingQuantity: true,
          unitCost: true,
          expiryDate: true,
        },
      },
    },
  });

  const summary = items.map((item) => {
    const totalQuantity = item.stockBatches.reduce(
      (total, batch) => total + batch.remainingQuantity,
      0,
    );
    const totalValue = item.stockBatches.reduce(
      (total, batch) => total + batch.remainingQuantity * (batch.unitCost ?? 0),
      0,
    );
    const nearestExpiryDate = item.stockBatches
      .map((batch) => batch.expiryDate)
      .filter((expiryDate): expiryDate is Date => expiryDate !== null)
      .sort((first, second) => first.getTime() - second.getTime())[0] ?? null;

    return {
      itemId: item.id,
      itemName: item.name,
      unit: item.unit,
      totalQuantity,
      minStockLevel: item.minStockLevel,
      isLowStock: item.minStockLevel !== null && totalQuantity <= item.minStockLevel,
      totalValue,
      nearestExpiryDate,
    };
  });

  return res.json({ summary });
}));

stockRouter.get("/movements", requireRole([Role.OWNER, Role.MANAGER, Role.OPERATOR]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }
  const locationId = await getActiveLocationId(req, workspaceId);

  const filters = parseMovementFilters(req.query);

  if (filters.type === "invalid") {
    return res.status(400).json({ error: "Invalid movement type" });
  }

  if (filters.fromDate === "invalid" || filters.toDate === "invalid") {
    return res.status(400).json({ error: "Date filters must be valid dates" });
  }

  if (filters.itemId) {
    const item = await prisma.item.findFirst({
      where: { id: filters.itemId, workspaceId, isActive: true },
      select: { id: true },
    });

    if (!item) {
      return res.status(404).json({ error: "Item not found" });
    }
  }

  const movements = await prisma.stockMovement.findMany({
    where: {
      workspaceId,
      locationId,
      itemId: filters.itemId,
      type: filters.type,
      createdAt: {
        gte: filters.fromDate,
        lte: filters.toDate,
      },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      type: true,
      quantity: true,
      unitCost: true,
      reason: true,
      note: true,
      createdAt: true,
      item: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return res.json({ movements });
}));

stockRouter.get("/batches", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }
  const locationId = await getActiveLocationId(req, workspaceId);

  const batches = await prisma.stockBatch.findMany({
    where: { workspaceId, locationId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      quantity: true,
      remainingQuantity: true,
      expiryDate: true,
      unitCost: true,
      batchNo: true,
      supplierName: true,
      createdAt: true,
      item: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return res.json({ batches });
}));

stockRouter.get("/expiring-soon", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }
  const locationId = await getActiveLocationId(req, workspaceId);

  const now = new Date();
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { expiryAlertDays: true },
  });
  const expiryAlertUntil = new Date(now);
  expiryAlertUntil.setDate(now.getDate() + getExpiryAlertDays(workspace?.expiryAlertDays));

  const batches = await prisma.stockBatch.findMany({
    where: {
      workspaceId,
      locationId,
      remainingQuantity: { gt: 0 },
      expiryDate: {
        gte: now,
        lte: expiryAlertUntil,
      },
    },
    orderBy: { expiryDate: "asc" },
    select: {
      id: true,
      quantity: true,
      remainingQuantity: true,
      expiryDate: true,
      unitCost: true,
      batchNo: true,
      supplierName: true,
      item: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });

  return res.json({ batches });
}));

stockRouter.get("/supplier-suggestion", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const itemId = parseOptionalString(req.query.itemId);
  if (!itemId) return res.status(400).json({ error: "itemId is required" });

  const batches = await prisma.stockBatch.findMany({
    where: { workspaceId, itemId, supplierId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      supplierId: true,
      supplier: { select: { id: true, name: true } },
    },
  });

  const freq = new Map<string, { id: string; name: string; count: number }>();
  for (const b of batches) {
    if (!b.supplierId || !b.supplier) continue;
    const prev = freq.get(b.supplierId) ?? { id: b.supplierId, name: b.supplier.name, count: 0 };
    freq.set(b.supplierId, { ...prev, count: prev.count + 1 });
  }

  const sorted = [...freq.values()].sort((a, b) => b.count - a.count);
  const suggestion = sorted[0] ? { id: sorted[0].id, name: sorted[0].name } : null;

  return res.json({ suggestion });
}));

stockRouter.get("/trend", requireRole([Role.OWNER, Role.MANAGER, Role.OPERATOR]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const locationId = await getActiveLocationId(req, workspaceId);

  const daysRaw = typeof req.query.days === "string" ? parseInt(req.query.days, 10) : 30;
  const days = Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 365 ? daysRaw : 30;

  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - (days - 1));
  fromDate.setHours(0, 0, 0, 0);

  const movements = await prisma.stockMovement.findMany({
    where: {
      workspaceId,
      locationId,
      type: { in: [StockMovementType.STOCK_IN, StockMovementType.STOCK_OUT] },
      createdAt: { gte: fromDate },
    },
    select: {
      type: true,
      quantity: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const dayMap = new Map<string, { stockIn: number; stockOut: number }>();
  for (let i = 0; i < days; i++) {
    const d = new Date(fromDate);
    d.setDate(fromDate.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    dayMap.set(key, { stockIn: 0, stockOut: 0 });
  }

  for (const m of movements) {
    const key = m.createdAt.toISOString().slice(0, 10);
    const entry = dayMap.get(key);
    if (!entry) continue;
    if (m.type === StockMovementType.STOCK_IN) {
      entry.stockIn += m.quantity;
    } else if (m.type === StockMovementType.STOCK_OUT) {
      entry.stockOut += m.quantity;
    }
  }

  const data = [...dayMap.entries()].map(([date, vals]) => ({ date, ...vals }));

  return res.json({ data, days });
}));

stockRouter.get("/price-history", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const itemId = parseOptionalString(req.query.itemId);
  if (!itemId) return res.status(400).json({ error: "itemId is required" });

  const limitRaw = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 20;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 100 ? limitRaw : 20;

  const history = await prisma.stockBatch.findMany({
    where: { workspaceId, itemId, unitCost: { not: null } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      unitCost: true,
      quantity: true,
      batchNo: true,
      supplierName: true,
      createdAt: true,
      supplier: { select: { id: true, name: true } },
    },
  });

  return res.json({ history });
}));

function getWorkspaceId(req: Express.Request) {
  return req.user?.workspaceId ?? null;
}

function getExpiryAlertDays(value: number | null | undefined) {
  return typeof value === "number" && value >= 0 ? value : 7;
}

function parseStockInInput(body: unknown) {
  const input = body as {
    itemId?: unknown;
    quantity?: unknown;
    unitCost?: unknown;
    expiryDate?: unknown;
    batchNo?: unknown;
    supplierId?: unknown;
    supplierName?: unknown;
    note?: unknown;
  };

  return {
    itemId: parseOptionalString(input.itemId),
    quantity: parseOptionalNumber(input.quantity),
    unitCost: parseOptionalNumber(input.unitCost),
    expiryDate: parseOptionalDate(input.expiryDate),
    batchNo: parseNullableString(input.batchNo),
    supplierId: parseNullableString(input.supplierId),
    supplierName: parseNullableString(input.supplierName),
    note: parseNullableString(input.note),
  };
}

function parseStockOutInput(body: unknown) {
  const input = body as {
    itemId?: unknown;
    quantity?: unknown;
    reason?: unknown;
    note?: unknown;
  };

  return {
    itemId: parseOptionalString(input.itemId),
    quantity: parseOptionalNumber(input.quantity),
    reason: parseNullableString(input.reason),
    note: parseNullableString(input.note),
  };
}

function parseStockTransferInput(body: unknown) {
  const input = body as {
    itemId?: unknown;
    fromLocationId?: unknown;
    toLocationId?: unknown;
    quantity?: unknown;
  };

  return {
    itemId: parseOptionalString(input.itemId),
    fromLocationId: parseOptionalString(input.fromLocationId),
    toLocationId: parseOptionalString(input.toLocationId),
    quantity: parseOptionalNumber(input.quantity),
  };
}

type MovementTypeFilter = StockMovementType | "invalid" | undefined;

function parseMovementFilters(query: Request["query"]) {
  return {
    itemId: parseOptionalString(query.itemId),
    type: parseMovementType(query.type),
    fromDate: parseOptionalDate(query.fromDate),
    toDate: parseEndOfDayDate(query.toDate),
  };
}

function parseMovementType(value: unknown): MovementTypeFilter {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const type = value.trim();

  if (!isStockMovementType(type)) {
    return "invalid";
  }

  return type;
}

function isStockMovementType(value: string): value is StockMovementType {
  return Object.values(StockMovementType).includes(value as StockMovementType);
}

function compareFifoBatches(
  first: { expiryDate: Date | null; createdAt: Date },
  second: { expiryDate: Date | null; createdAt: Date },
) {
  const firstDate = first.expiryDate ?? first.createdAt;
  const secondDate = second.expiryDate ?? second.createdAt;

  return firstDate.getTime() - secondDate.getTime();
}

class InsufficientStockError extends Error {
  constructor(itemName: string, requested: number, available: number) {
    super(
      `Insufficient stock for ${itemName}. Requested ${requested}, available ${available}.`,
    );
    this.name = "InsufficientStockError";
  }
}

class StockConflictError extends Error {
  constructor() {
    super("Inventory changed. Please retry.");
    this.name = "StockConflictError";
  }
}

async function assertActiveItem(
  client: Prisma.TransactionClient,
  workspaceId: string,
  itemId: string,
) {
  const item = await client.item.findFirst({
    where: { id: itemId, workspaceId, isActive: true },
    select: { id: true },
  });

  if (!item) {
    throw Object.assign(new Error("Item must be active and belong to this workspace"), { status: 400 });
  }
}

function runSerializableWrite<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  return retrySerializable(
    () =>
      prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    maxAttempts,
  );
}

async function retrySerializable<T>(fn: () => Promise<T>, maxAttempts: number) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isSerializationConflict(error) || attempt === maxAttempts) {
        throw error;
      }
    }
  }

  throw lastError;
}

function isWriteConflict(error: unknown) {
  return error instanceof StockConflictError || isSerializationConflict(error);
}

function isSerializationConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
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

function parseOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseOptionalDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "invalid" : date;
}

function parseEndOfDayDate(value: unknown) {
  const date = parseOptionalDate(value);

  if (date instanceof Date && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date.setHours(23, 59, 59, 999);
  }

  return date;
}
