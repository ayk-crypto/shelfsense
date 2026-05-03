import { Role, StockCountStatus, StockMovementType } from "../generated/prisma/enums.js";
import { Router, type Request } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";

export const stockCountsRouter = Router();

stockCountsRouter.use(requireAuth);

stockCountsRouter.get("/stock", requireRole([Role.OWNER, Role.MANAGER, Role.OPERATOR]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const locationId = parseOptionalString(req.query.locationId);
  if (!locationId) return res.status(400).json({ error: "Location is required" });

  const location = await prisma.location.findFirst({
    where: { id: locationId, workspaceId, isActive: true },
    select: { id: true },
  });
  if (!location) return res.status(404).json({ error: "Location not found" });

  const items = await getItemStockSnapshot(prisma, workspaceId, locationId);
  return res.json({ items });
}));

stockCountsRouter.get("/", requireRole([Role.OWNER, Role.MANAGER, Role.OPERATOR]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const status = parseStockCountStatus(req.query.status);
  if (status === "invalid") return res.status(400).json({ error: "Invalid stock count status" });

  const counts = await prisma.stockCount.findMany({
    where: { workspaceId, status },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: countListSelect,
  });

  return res.json({ counts });
}));

stockCountsRouter.post("/", requireRole([Role.OWNER, Role.MANAGER, Role.OPERATOR]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const input = parseStockCountInput(req.body);
  const validation = validateDraftInput(input);
  if (validation) return res.status(400).json({ error: validation });

  try {
    const result = await prisma.$transaction(async (tx) => {
      await assertActiveLocation(tx, workspaceId, input.locationId!);
      const preparedItems = await prepareCountItems(tx, workspaceId, input.locationId!, input.items);

      const count = await tx.stockCount.create({
        data: {
          workspaceId,
          locationId: input.locationId!,
          createdById: req.user!.userId,
          note: input.note,
          items: {
            create: preparedItems,
          },
        },
        select: countDetailSelect,
      });

      await tx.auditLog.create({
        data: {
          userId: req.user!.userId,
          workspaceId,
          action: "STOCK_COUNT_DRAFT_SAVED",
          entity: "StockCount",
          entityId: count.id,
          meta: {
            locationId: input.locationId,
            itemCount: preparedItems.length,
          } as Prisma.InputJsonValue,
        },
      });

      return count;
    });

    return res.status(201).json({ count: result });
  } catch (error) {
    if (error instanceof InvalidStockCountError) {
      return res.status(400).json({ error: error.message });
    }
    throw error;
  }
}));

stockCountsRouter.get("/:id", requireRole([Role.OWNER, Role.MANAGER, Role.OPERATOR]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const count = await prisma.stockCount.findFirst({
    where: { id: req.params.id, workspaceId },
    select: countDetailSelect,
  });

  if (!count) return res.status(404).json({ error: "Stock count not found" });
  return res.json({ count });
}));

stockCountsRouter.patch("/:id", requireRole([Role.OWNER, Role.MANAGER, Role.OPERATOR]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const input = parseStockCountInput(req.body);
  const validation = validateDraftInput(input);
  if (validation) return res.status(400).json({ error: validation });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.stockCount.findFirst({
        where: { id: req.params.id, workspaceId },
        select: { id: true, status: true },
      });

      if (!existing) throw new NotFoundError("Stock count not found");
      if (existing.status !== StockCountStatus.DRAFT) {
        throw new InvalidStockCountError("Finalized counts cannot be edited");
      }

      await assertActiveLocation(tx, workspaceId, input.locationId!);
      const preparedItems = await prepareCountItems(tx, workspaceId, input.locationId!, input.items);

      await tx.stockCountItem.deleteMany({ where: { stockCountId: existing.id } });
      const count = await tx.stockCount.update({
        where: { id: existing.id },
        data: {
          locationId: input.locationId!,
          note: input.note,
          items: { create: preparedItems },
        },
        select: countDetailSelect,
      });

      await tx.auditLog.create({
        data: {
          userId: req.user!.userId,
          workspaceId,
          action: "STOCK_COUNT_DRAFT_UPDATED",
          entity: "StockCount",
          entityId: count.id,
          meta: {
            locationId: input.locationId,
            itemCount: preparedItems.length,
          } as Prisma.InputJsonValue,
        },
      });

      return count;
    });

    return res.json({ count: result });
  } catch (error) {
    if (error instanceof NotFoundError) return res.status(404).json({ error: error.message });
    if (error instanceof InvalidStockCountError) return res.status(400).json({ error: error.message });
    throw error;
  }
}));

stockCountsRouter.post("/:id/finalize", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  try {
    const result = await runSerializableWrite(async (tx) => {
      const count = await tx.stockCount.findFirst({
        where: { id: req.params.id, workspaceId },
        include: {
          location: { select: { id: true, name: true } },
          items: {
            orderBy: { itemName: "asc" },
            include: { item: { select: { id: true, name: true, unit: true, isActive: true } } },
          },
        },
      });

      if (!count) throw new NotFoundError("Stock count not found");
      if (count.status !== StockCountStatus.DRAFT) {
        throw new InvalidStockCountError("Stock count is already finalized");
      }
      if (count.items.length === 0) {
        throw new InvalidStockCountError("Add at least one counted item before finalizing");
      }

      const adjustedItems = [];

      for (const line of count.items) {
        if (!line.item.isActive) {
          throw new InvalidStockCountError(`${line.itemName} is archived and cannot be adjusted`);
        }

        if (line.variance > 0) {
          await increaseForCount(tx, workspaceId, count.locationId, line);
          adjustedItems.push({ itemId: line.itemId, itemName: line.itemName, variance: line.variance });
        } else if (line.variance < 0) {
          await deductForCount(tx, workspaceId, count.locationId, line);
          adjustedItems.push({ itemId: line.itemId, itemName: line.itemName, variance: line.variance });
        }
      }

      const finalized = await tx.stockCount.update({
        where: { id: count.id },
        data: {
          status: StockCountStatus.FINALIZED,
          finalizedById: req.user!.userId,
          finalizedAt: new Date(),
        },
        select: countDetailSelect,
      });

      await tx.auditLog.create({
        data: {
          userId: req.user!.userId,
          workspaceId,
          action: "STOCK_COUNT_FINALIZED",
          entity: "StockCount",
          entityId: count.id,
          meta: {
            locationId: count.locationId,
            locationName: count.location.name,
            itemCount: count.items.length,
            adjustedItems,
          } as Prisma.InputJsonValue,
        },
      });

      return finalized;
    });

    return res.json({ count: result });
  } catch (error) {
    if (error instanceof NotFoundError) return res.status(404).json({ error: error.message });
    if (error instanceof InvalidStockCountError || error instanceof InsufficientStockError) {
      return res.status(400).json({ error: error.message });
    }
    if (isWriteConflict(error)) {
      return res.status(409).json({ error: "Inventory changed. Please retry." });
    }
    throw error;
  }
}));

const countListSelect = {
  id: true,
  status: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  finalizedAt: true,
  location: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  finalizedBy: { select: { id: true, name: true, email: true } },
  items: { select: { id: true, variance: true } },
} satisfies Prisma.StockCountSelect;

const countDetailSelect = {
  id: true,
  status: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  finalizedAt: true,
  location: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  finalizedBy: { select: { id: true, name: true, email: true } },
  items: {
    orderBy: { itemName: "asc" },
    select: {
      id: true,
      itemId: true,
      itemName: true,
      unit: true,
      systemQuantity: true,
      physicalQuantity: true,
      variance: true,
    },
  },
} satisfies Prisma.StockCountSelect;

async function getItemStockSnapshot(
  client: Prisma.TransactionClient | typeof prisma,
  workspaceId: string,
  locationId: string,
) {
  const items = await client.item.findMany({
    where: { workspaceId, isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      unit: true,
      sku: true,
      barcode: true,
      category: true,
      stockBatches: {
        where: { workspaceId, locationId, remainingQuantity: { gt: 0 } },
        select: { remainingQuantity: true },
      },
    },
  });

  return items.map((item) => ({
    id: item.id,
    name: item.name,
    unit: item.unit,
    sku: item.sku,
    barcode: item.barcode,
    category: item.category,
    systemQuantity: roundQuantity(
      item.stockBatches.reduce((total, batch) => total + batch.remainingQuantity, 0),
    ),
  }));
}

async function prepareCountItems(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  locationId: string,
  lines: ParsedStockCountItem[],
) {
  const duplicateItemId = findDuplicate(lines.map((line) => line.itemId));
  if (duplicateItemId) {
    throw new InvalidStockCountError("Each item can only appear once in a stock count");
  }

  const itemIds = lines.map((line) => line.itemId);
  const items = await tx.item.findMany({
    where: { workspaceId, id: { in: itemIds }, isActive: true },
    select: {
      id: true,
      name: true,
      unit: true,
      stockBatches: {
        where: { workspaceId, locationId, remainingQuantity: { gt: 0 } },
        select: { remainingQuantity: true },
      },
    },
  });
  const itemById = new Map(items.map((item) => [item.id, item]));

  if (items.length !== itemIds.length) {
    throw new InvalidStockCountError("All counted items must be active and belong to this workspace");
  }

  return lines.map((line) => {
    const item = itemById.get(line.itemId)!;
    const systemQuantity = roundQuantity(
      item.stockBatches.reduce((total, batch) => total + batch.remainingQuantity, 0),
    );
    const physicalQuantity = roundQuantity(line.physicalQuantity);
    const variance = roundQuantity(physicalQuantity - systemQuantity);

    return {
      itemId: item.id,
      itemName: item.name,
      unit: item.unit,
      systemQuantity,
      physicalQuantity,
      variance,
    };
  });
}

async function increaseForCount(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  locationId: string,
  line: CountAdjustmentLine,
) {
  const latestPricedBatch = await tx.stockBatch.findFirst({
    where: { workspaceId, locationId, itemId: line.itemId, unitCost: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { unitCost: true },
  });
  const quantity = roundQuantity(line.variance);

  const batch = await tx.stockBatch.create({
    data: {
      workspaceId,
      locationId,
      itemId: line.itemId,
      quantity,
      remainingQuantity: quantity,
      unitCost: latestPricedBatch?.unitCost ?? null,
      batchNo: "Stock Count Adjustment",
    },
  });

  await tx.stockMovement.create({
    data: {
      workspaceId,
      locationId,
      itemId: line.itemId,
      batchId: batch.id,
      type: StockMovementType.ADJUSTMENT,
      quantity,
      unitCost: latestPricedBatch?.unitCost ?? null,
      reason: "Stock Count Adjustment",
      note: `Stock count adjusted ${line.itemName} by +${formatQuantity(quantity)}`,
    },
  });
}

async function deductForCount(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  locationId: string,
  line: CountAdjustmentLine,
) {
  let quantityToDeduct = roundQuantity(Math.abs(line.variance));
  const batches = await tx.stockBatch.findMany({
    where: {
      workspaceId,
      locationId,
      itemId: line.itemId,
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
  const available = roundQuantity(
    batches.reduce((total, batch) => total + batch.remainingQuantity, 0),
  );

  if (available < quantityToDeduct) {
    throw new InsufficientStockError(line.itemName, quantityToDeduct, available);
  }

  for (const batch of batches.sort(compareFifoBatches)) {
    if (quantityToDeduct <= 0) break;

    const deductedQuantity = roundQuantity(Math.min(batch.remainingQuantity, quantityToDeduct));
    quantityToDeduct = roundQuantity(quantityToDeduct - deductedQuantity);

    const updated = await tx.stockBatch.updateMany({
      where: {
        id: batch.id,
        workspaceId,
        locationId,
        remainingQuantity: { gte: deductedQuantity },
      },
      data: { remainingQuantity: { decrement: deductedQuantity } },
    });

    if (updated.count === 0) throw new StockConflictError();

    await tx.stockMovement.create({
      data: {
        workspaceId,
        locationId,
        itemId: line.itemId,
        batchId: batch.id,
        type: StockMovementType.ADJUSTMENT,
        quantity: -deductedQuantity,
        unitCost: batch.unitCost,
        reason: "Stock Count Adjustment",
        note: `Stock count adjusted ${line.itemName} by -${formatQuantity(deductedQuantity)}`,
      },
    });
  }
}

interface ParsedStockCountInput {
  locationId?: string;
  note?: string | null;
  items: ParsedStockCountItem[];
}

interface ParsedStockCountItem {
  itemId: string;
  physicalQuantity: number;
}

interface CountAdjustmentLine {
  itemId: string;
  itemName: string;
  variance: number;
}

function parseStockCountInput(body: unknown): ParsedStockCountInput {
  const input = body as {
    locationId?: unknown;
    note?: unknown;
    items?: unknown;
  };
  const items = Array.isArray(input.items)
    ? input.items.map(parseStockCountLine).filter((line): line is ParsedStockCountItem => line !== null)
    : [];

  return {
    locationId: parseOptionalString(input.locationId),
    note: parseNullableString(input.note),
    items,
  };
}

function parseStockCountLine(value: unknown): ParsedStockCountItem | null {
  const line = value as { itemId?: unknown; physicalQuantity?: unknown };
  const itemId = parseOptionalString(line.itemId);
  const physicalQuantity = parseOptionalNumber(line.physicalQuantity);
  if (!itemId || physicalQuantity === undefined) return null;
  return { itemId, physicalQuantity };
}

function validateDraftInput(input: ParsedStockCountInput) {
  if (!input.locationId) return "Location is required";
  if (input.items.length === 0) return "Add at least one item to count";
  if (input.items.some((item) => item.physicalQuantity < 0)) {
    return "Physical count cannot be negative";
  }
  return null;
}

type StockCountStatusFilter = StockCountStatus | "invalid" | undefined;

function parseStockCountStatus(value: unknown): StockCountStatusFilter {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const status = value.trim();
  return Object.values(StockCountStatus).includes(status as StockCountStatus)
    ? status as StockCountStatus
    : "invalid";
}

async function assertActiveLocation(
  client: Prisma.TransactionClient,
  workspaceId: string,
  locationId: string,
) {
  const location = await client.location.findFirst({
    where: { id: locationId, workspaceId, isActive: true },
    select: { id: true },
  });

  if (!location) throw new InvalidStockCountError("Location must be active and belong to this workspace");
}

function findDuplicate(values: string[]) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return null;
}

function compareFifoBatches(
  first: { expiryDate: Date | null; createdAt: Date },
  second: { expiryDate: Date | null; createdAt: Date },
) {
  const firstDate = first.expiryDate ?? first.createdAt;
  const secondDate = second.expiryDate ?? second.createdAt;
  return firstDate.getTime() - secondDate.getTime();
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
      if (!isSerializationConflict(error) || attempt === maxAttempts) throw error;
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

function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function parseOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

function parseNullableString(value: unknown) {
  if (value === null) return null;
  return typeof value === "string" ? value.trim() : undefined;
}

function parseOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getWorkspaceId(req: Request) {
  return req.user?.workspaceId ?? null;
}

class NotFoundError extends Error {}

class InvalidStockCountError extends Error {}

class StockConflictError extends Error {
  constructor() {
    super("Inventory changed. Please retry.");
    this.name = "StockConflictError";
  }
}

class InsufficientStockError extends Error {
  constructor(itemName: string, requested: number, available: number) {
    super(`Insufficient stock for ${itemName}. Need ${requested}, available ${available}. Refresh the count before finalizing.`);
    this.name = "InsufficientStockError";
  }
}
