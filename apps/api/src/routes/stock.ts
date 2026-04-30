import { StockMovementType } from "../generated/prisma/enums.js";
import { Router, type Request } from "express";
import { prisma } from "../db/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";

export const stockRouter = Router();

stockRouter.use(requireAuth);

stockRouter.post("/in", asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

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
    where: { id: itemId, workspaceId },
    select: { id: true },
  });

  if (!item) {
    return res.status(404).json({ error: "Item not found" });
  }

  const result = await prisma.$transaction(async (tx) => {
    const batch = await tx.stockBatch.create({
      data: {
        itemId,
        workspaceId,
        quantity,
        remainingQuantity: quantity,
        unitCost: input.unitCost,
        expiryDate,
        batchNo: input.batchNo,
        supplierName: input.supplierName,
      },
    });

    const movement = await tx.stockMovement.create({
      data: {
        workspaceId,
        itemId,
        batchId: batch.id,
        type: StockMovementType.STOCK_IN,
        quantity,
        unitCost: input.unitCost,
        note: input.note,
      },
    });

    return { batch, movement };
  });

  return res.status(201).json(result);
}));

stockRouter.post("/out", asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

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
    where: { id: itemId, workspaceId },
    select: { id: true, name: true },
  });

  if (!item) {
    return res.status(404).json({ error: "Item not found" });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const batches = await tx.stockBatch.findMany({
        where: {
          itemId,
          workspaceId,
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

        await tx.stockBatch.updateMany({
          where: { id: batch.id, workspaceId },
          data: {
            remainingQuantity: batch.remainingQuantity - deductedQuantity,
          },
        });

        const movement = await tx.stockMovement.create({
          data: {
            workspaceId,
            itemId,
            batchId: batch.id,
            type: StockMovementType.STOCK_OUT,
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

    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof InsufficientStockError) {
      return res.status(400).json({ error: error.message });
    }

    throw error;
  }
}));

stockRouter.get("/summary", asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const items = await prisma.item.findMany({
    where: { workspaceId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      unit: true,
      minStockLevel: true,
      stockBatches: {
        where: {
          workspaceId,
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
      isLowStock: totalQuantity <= item.minStockLevel,
      totalValue,
      nearestExpiryDate,
    };
  });

  return res.json({ summary });
}));

stockRouter.get("/movements", asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const filters = parseMovementFilters(req.query);

  if (filters.type === "invalid") {
    return res.status(400).json({ error: "Invalid movement type" });
  }

  if (filters.fromDate === "invalid" || filters.toDate === "invalid") {
    return res.status(400).json({ error: "Date filters must be valid dates" });
  }

  if (filters.itemId) {
    const item = await prisma.item.findFirst({
      where: { id: filters.itemId, workspaceId },
      select: { id: true },
    });

    if (!item) {
      return res.status(404).json({ error: "Item not found" });
    }
  }

  const movements = await prisma.stockMovement.findMany({
    where: {
      workspaceId,
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

stockRouter.get("/batches", asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const batches = await prisma.stockBatch.findMany({
    where: { workspaceId },
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

stockRouter.get("/expiring-soon", asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const now = new Date();
  const sevenDaysFromNow = new Date(now);
  sevenDaysFromNow.setDate(now.getDate() + 7);

  const batches = await prisma.stockBatch.findMany({
    where: {
      workspaceId,
      remainingQuantity: { gt: 0 },
      expiryDate: {
        gte: now,
        lte: sevenDaysFromNow,
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

function getWorkspaceId(req: Express.Request) {
  return req.user?.workspaceId ?? null;
}

function parseStockInInput(body: unknown) {
  const input = body as {
    itemId?: unknown;
    quantity?: unknown;
    unitCost?: unknown;
    expiryDate?: unknown;
    batchNo?: unknown;
    supplierName?: unknown;
    note?: unknown;
  };

  return {
    itemId: parseOptionalString(input.itemId),
    quantity: parseOptionalNumber(input.quantity),
    unitCost: parseOptionalNumber(input.unitCost),
    expiryDate: parseOptionalDate(input.expiryDate),
    batchNo: parseNullableString(input.batchNo),
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
