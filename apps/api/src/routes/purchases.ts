import { PurchaseStatus, Role, StockMovementType } from "../generated/prisma/enums.js";
import { Router, type Request } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { requireActiveWorkspace, requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import { logAction } from "../utils/audit-log.js";
import { assertActiveLocation, assertActiveLocations, getActiveLocationId } from "../utils/locations.js";

export const purchasesRouter = Router();

purchasesRouter.use(requireAuth);
purchasesRouter.use(requireActiveWorkspace);

const purchaseInclude = {
  supplier: {
    select: {
      id: true,
      name: true,
    },
  },
  location: {
    select: {
      id: true,
      name: true,
    },
  },
  purchaseItems: {
    orderBy: { createdAt: "asc" },
    include: {
      item: {
        select: {
          id: true,
          name: true,
          unit: true,
          trackExpiry: true,
        },
      },
    },
  },
} satisfies Prisma.PurchaseInclude;

purchasesRouter.post("/", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const locationId = await getActiveLocationId(req, workspaceId);
  const input = parsePurchaseInput(req.body);

  if (!input.supplierId) return res.status(400).json({ error: "Supplier is required" });
  if (input.date === "invalid") return res.status(400).json({ error: "Purchase date must be a valid date" });
  if (input.expectedDeliveryDate === "invalid") {
    return res.status(400).json({ error: "Expected delivery date must be a valid date" });
  }
  if (input.items.length === 0) return res.status(400).json({ error: "At least one purchase item is required" });

  const invalidLine = input.items.find(
    (item) => !item.itemId || item.quantity === undefined || item.unitCost === undefined,
  );
  if (invalidLine) {
    return res.status(400).json({ error: "Each purchase item requires itemId, quantity, and unitCost" });
  }

  const nonPositiveLine = input.items.find((item) => item.quantity! <= 0 || item.unitCost! < 0);
  if (nonPositiveLine) {
    return res.status(400).json({ error: "Quantity must be greater than zero and unit cost cannot be negative" });
  }

  const supplier = await prisma.supplier.findFirst({
    where: { id: input.supplierId, workspaceId },
    select: { id: true, name: true },
  });
  if (!supplier) return res.status(404).json({ error: "Supplier not found" });

  const itemIds = [...new Set(input.items.map((item) => item.itemId!))];
  const items = await prisma.item.findMany({
    where: { id: { in: itemIds }, workspaceId, isActive: true },
    select: { id: true },
  });
  if (items.length !== itemIds.length) return res.status(404).json({ error: "One or more items were not found" });

  const lines = input.items.map((item) => ({
    itemId: item.itemId!,
    quantity: item.quantity!,
    unitCost: item.unitCost!,
    total: item.quantity! * item.unitCost!,
  }));
  const totalAmount = lines.reduce((total, line) => total + line.total, 0);
  const purchaseDate = input.date instanceof Date ? input.date : new Date();

  const result = await runSerializableWrite(async (tx) => {
    await assertActiveLocation(tx, workspaceId, locationId);
    await assertActiveItems(tx, workspaceId, itemIds);

    const purchase = await tx.purchase.create({
      data: {
        supplierId: supplier.id,
        workspaceId,
        locationId,
        date: purchaseDate,
        expectedDeliveryDate: input.expectedDeliveryDate instanceof Date ? input.expectedDeliveryDate : null,
        status: PurchaseStatus.DRAFT,
        totalAmount,
        purchaseItems: {
          create: lines.map((line) => ({
            itemId: line.itemId,
            quantity: line.quantity,
            receivedQuantity: 0,
            unitCost: line.unitCost,
            total: line.total,
          })),
        },
      },
      include: purchaseInclude,
    });

    return mapPurchase(purchase);
  });

  await logPurchaseAction(req, workspaceId, "PURCHASE_CREATED", result.purchase.id, {
    supplierId: supplier.id,
    supplierName: supplier.name,
    totalOrderedValue: result.purchase.totalAmount,
    lineCount: lines.length,
    locationId,
  });

  return res.status(201).json(result);
}));

purchasesRouter.get("/", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const filters = parsePurchaseFilters(req.query);
  if (filters.status === "invalid") return res.status(400).json({ error: "Invalid purchase status" });
  if (filters.fromDate === "invalid" || filters.toDate === "invalid") {
    return res.status(400).json({ error: "Date filters must be valid dates" });
  }

  const locationId = filters.locationId ?? await getActiveLocationId(req, workspaceId);

  const purchases = await prisma.purchase.findMany({
    where: {
      workspaceId,
      locationId,
      status: filters.status,
      supplierId: filters.supplierId,
      date: {
        gte: filters.fromDate,
        lte: filters.toDate,
      },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: purchaseInclude,
  });

  return res.json({ purchases: purchases.map(mapPurchaseRecord) });
}));

purchasesRouter.get("/open", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const purchases = await prisma.purchase.findMany({
    where: {
      workspaceId,
      status: { in: [PurchaseStatus.ORDERED, PurchaseStatus.PARTIALLY_RECEIVED] },
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: purchaseInclude,
  });

  return res.json({ purchases: purchases.map(mapPurchaseRecord) });
}));

purchasesRouter.get("/:id", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const purchase = await prisma.purchase.findFirst({
    where: { id: req.params.id, workspaceId },
    include: purchaseInclude,
  });

  if (!purchase) return res.status(404).json({ error: "Purchase not found" });
  return res.json({ purchase: mapPurchaseRecord(purchase) });
}));

purchasesRouter.post("/:id/order", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const result = await runSerializableWrite(async (tx) => {
    const purchase = await tx.purchase.findFirst({
      where: { id: req.params.id, workspaceId },
      include: purchaseInclude,
    });
    if (!purchase) throw new HttpError(404, "Purchase not found");
    if (purchase.status !== PurchaseStatus.DRAFT) {
      throw new HttpError(400, "Only draft purchases can be marked as ordered");
    }

    const updated = await tx.purchase.update({
      where: { id: purchase.id },
      data: {
        status: PurchaseStatus.ORDERED,
        orderedAt: new Date(),
      },
      include: purchaseInclude,
    });

    return mapPurchase(updated);
  });

  await logPurchaseAction(req, workspaceId, "PURCHASE_ORDERED", result.purchase.id, {
    reference: result.purchase.id,
    supplierName: result.purchase.supplier.name,
    totalOrderedValue: result.purchase.totalAmount,
  });

  return res.json(result);
}));

purchasesRouter.post("/:id/cancel", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const reason = parseNullableString((req.body as { reason?: unknown }).reason) ?? null;

  const result = await runSerializableWrite(async (tx) => {
    const purchase = await tx.purchase.findFirst({
      where: { id: req.params.id, workspaceId },
      include: purchaseInclude,
    });
    if (!purchase) throw new HttpError(404, "Purchase not found");
    if (!canCancelPurchase(purchase.status)) {
      throw new HttpError(400, "This purchase cannot be cancelled");
    }

    const updated = await tx.purchase.update({
      where: { id: purchase.id },
      data: {
        status: PurchaseStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: reason,
      },
      include: purchaseInclude,
    });

    return mapPurchase(updated);
  });

  await logPurchaseAction(req, workspaceId, "PURCHASE_CANCELLED", result.purchase.id, {
    reference: result.purchase.id,
    supplierName: result.purchase.supplier.name,
    reason,
  });

  return res.json(result);
}));

purchasesRouter.post("/:id/receive", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const defaultLocationId = await getActiveLocationId(req, workspaceId);
  const input = parseReceiveInput(req.body, defaultLocationId);

  if (input.lines.length === 0) return res.status(400).json({ error: "At least one received line is required" });

  const invalidLine = input.lines.find(
    (line) => !line.purchaseItemId || line.receivedQuantity === undefined || line.receivedQuantity <= 0,
  );
  if (invalidLine) return res.status(400).json({ error: "Each received line needs a positive quantity" });

  const invalidCost = input.lines.find((line) => line.unitCost !== undefined && line.unitCost < 0);
  if (invalidCost) return res.status(400).json({ error: "Unit cost cannot be negative" });

  const invalidDate = input.lines.find((line) => line.expiryDate === "invalid");
  if (invalidDate) return res.status(400).json({ error: "Expiry date must be valid" });

  const locationIds = [...new Set(input.lines.map((line) => line.locationId))];

  try {
    const result = await runSerializableWrite(async (tx) => {
      await assertActiveLocations(tx, workspaceId, locationIds);

      const purchase = await tx.purchase.findFirst({
        where: { id: req.params.id, workspaceId },
        include: purchaseInclude,
      });
      if (!purchase) throw new HttpError(404, "Purchase not found");
      if (purchase.status === PurchaseStatus.CANCELLED) throw new HttpError(400, "Cancelled purchases cannot be received");
      if (purchase.status === PurchaseStatus.RECEIVED) throw new HttpError(400, "Purchase is already fully received");
      if (purchase.status !== PurchaseStatus.ORDERED && purchase.status !== PurchaseStatus.PARTIALLY_RECEIVED) {
        throw new HttpError(400, "Only ordered purchases can be received");
      }

      const purchaseItemById = new Map(purchase.purchaseItems.map((line) => [line.id, line]));
      const movements = [];
      const batches = [];
      let receivedValue = 0;
      let receivedQuantity = 0;

      for (const line of input.lines) {
        const purchaseItem = purchaseItemById.get(line.purchaseItemId!);
        if (!purchaseItem) throw new HttpError(400, "Received line does not belong to this purchase");

        const remainingQuantity = purchaseItem.quantity - purchaseItem.receivedQuantity;
        if (line.receivedQuantity! > remainingQuantity) {
          throw new HttpError(400, `Cannot receive more than ordered for ${purchaseItem.item.name}`);
        }

        const effectiveUnitCost = line.unitCost ?? purchaseItem.unitCost;
        const expiryDate = line.expiryDate instanceof Date ? line.expiryDate : null;
        const batchNo = line.batchNo ?? null;

        const batch = await tx.stockBatch.create({
          data: {
            itemId: purchaseItem.itemId,
            workspaceId,
            locationId: line.locationId,
            supplierId: purchase.supplierId,
            quantity: line.receivedQuantity!,
            remainingQuantity: line.receivedQuantity!,
            unitCost: effectiveUnitCost,
            expiryDate,
            batchNo,
            supplierName: purchase.supplier.name,
          },
        });

        const movement = await tx.stockMovement.create({
          data: {
            workspaceId,
            locationId: line.locationId,
            itemId: purchaseItem.itemId,
            batchId: batch.id,
            type: StockMovementType.STOCK_IN,
            quantity: line.receivedQuantity!,
            unitCost: effectiveUnitCost,
            reason: "purchase_receive",
            note: line.notes ?? `Received purchase ${purchase.id}`,
          },
        });

        const updatedLine = await tx.purchaseItem.updateMany({
          where: {
            id: purchaseItem.id,
            purchaseId: purchase.id,
            receivedQuantity: purchaseItem.receivedQuantity,
          },
          data: {
            receivedQuantity: { increment: line.receivedQuantity! },
          },
        });

        if (updatedLine.count === 0) throw new StockConflictError();

        batches.push(batch);
        movements.push(movement);
        receivedValue += line.receivedQuantity! * effectiveUnitCost;
        receivedQuantity += line.receivedQuantity!;
      }

      const freshItems = await tx.purchaseItem.findMany({
        where: { purchaseId: purchase.id },
        select: { quantity: true, receivedQuantity: true },
      });
      const allReceived = freshItems.every((item) => item.receivedQuantity >= item.quantity);
      const anyReceived = freshItems.some((item) => item.receivedQuantity > 0);
      const nextStatus = allReceived
        ? PurchaseStatus.RECEIVED
        : anyReceived
          ? PurchaseStatus.PARTIALLY_RECEIVED
          : purchase.status;

      const updatedPurchase = await tx.purchase.update({
        where: { id: purchase.id },
        data: {
          status: nextStatus,
          receivedAt: allReceived ? new Date() : purchase.receivedAt,
        },
        include: purchaseInclude,
      });

      return {
        purchase: mapPurchaseRecord(updatedPurchase),
        batches,
        movements,
        receivedValue,
        receivedQuantity,
        fullReceive: nextStatus === PurchaseStatus.RECEIVED,
      };
    });

    await logPurchaseAction(
      req,
      workspaceId,
      result.fullReceive ? "PURCHASE_FULL_RECEIVE" : "PURCHASE_PARTIAL_RECEIVE",
      result.purchase.id,
      {
        reference: result.purchase.id,
        supplierName: result.purchase.supplier.name,
        receivedQuantity: result.receivedQuantity,
        receivedValue: result.receivedValue,
        movementIds: result.movements.map((movement) => movement.id),
        batchIds: result.batches.map((batch) => batch.id),
      },
    );

    return res.status(201).json(result);
  } catch (error) {
    if (isWriteConflict(error)) {
      return res.status(409).json({ error: "Purchase receiving changed. Please retry." });
    }
    throw error;
  }
}));

function getWorkspaceId(req: Express.Request) {
  return req.user?.workspaceId ?? null;
}

function parsePurchaseInput(body: unknown) {
  const input = body as {
    supplierId?: unknown;
    date?: unknown;
    expectedDeliveryDate?: unknown;
    items?: unknown;
  };

  return {
    supplierId: parseOptionalString(input.supplierId),
    date: parseOptionalDate(input.date),
    expectedDeliveryDate: parseOptionalDate(input.expectedDeliveryDate),
    items: Array.isArray(input.items) ? input.items.map(parsePurchaseItemInput) : [],
  };
}

function parsePurchaseItemInput(value: unknown) {
  const input = value as {
    itemId?: unknown;
    quantity?: unknown;
    unitCost?: unknown;
  };

  return {
    itemId: parseOptionalString(input.itemId),
    quantity: parseOptionalNumber(input.quantity),
    unitCost: parseOptionalNumber(input.unitCost),
  };
}

function parseReceiveInput(body: unknown, defaultLocationId: string) {
  const input = body as { lines?: unknown };
  return {
    lines: Array.isArray(input.lines)
      ? input.lines.map((line) => parseReceiveLineInput(line, defaultLocationId))
      : [],
  };
}

function parseReceiveLineInput(value: unknown, defaultLocationId: string) {
  const input = value as {
    purchaseItemId?: unknown;
    receivedQuantity?: unknown;
    locationId?: unknown;
    expiryDate?: unknown;
    batchNo?: unknown;
    unitCost?: unknown;
    notes?: unknown;
  };

  return {
    purchaseItemId: parseOptionalString(input.purchaseItemId),
    receivedQuantity: parseOptionalNumber(input.receivedQuantity),
    locationId: parseOptionalString(input.locationId) ?? defaultLocationId,
    expiryDate: parseOptionalDate(input.expiryDate),
    batchNo: parseNullableString(input.batchNo),
    unitCost: parseOptionalNumber(input.unitCost),
    notes: parseNullableString(input.notes),
  };
}

function parsePurchaseFilters(query: Request["query"]) {
  return {
    status: parsePurchaseStatus(query.status),
    supplierId: parseOptionalString(query.supplierId),
    locationId: parseOptionalString(query.locationId),
    fromDate: parseOptionalDate(query.fromDate),
    toDate: parseEndOfDayDate(query.toDate),
  };
}

function parsePurchaseStatus(value: unknown): PurchaseStatus | "invalid" | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const status = value.trim();
  if (!Object.values(PurchaseStatus).includes(status as PurchaseStatus)) return "invalid";
  return status as PurchaseStatus;
}

function canCancelPurchase(status: PurchaseStatus) {
  return status === PurchaseStatus.DRAFT ||
    status === PurchaseStatus.ORDERED ||
    status === PurchaseStatus.PARTIALLY_RECEIVED;
}

function mapPurchase(purchase: PurchaseRecord) {
  return { purchase: mapPurchaseRecord(purchase) };
}

function mapPurchaseRecord(purchase: PurchaseRecord) {
  const purchaseItems = purchase.purchaseItems.map((line) => {
    const remainingQuantity = Math.max(0, line.quantity - line.receivedQuantity);
    return {
      ...line,
      orderedQuantity: line.quantity,
      remainingQuantity,
      orderedValue: line.quantity * line.unitCost,
      receivedValue: line.receivedQuantity * line.unitCost,
    };
  });
  const orderedQuantity = purchaseItems.reduce((total, line) => total + line.orderedQuantity, 0);
  const receivedQuantity = purchaseItems.reduce((total, line) => total + line.receivedQuantity, 0);
  const remainingQuantity = purchaseItems.reduce((total, line) => total + line.remainingQuantity, 0);
  const receivedValue = purchaseItems.reduce((total, line) => total + line.receivedValue, 0);

  return {
    ...purchase,
    purchaseItems,
    orderedQuantity,
    receivedQuantity,
    remainingQuantity,
    receivedValue,
  };
}

type PurchaseRecord = Prisma.PurchaseGetPayload<{ include: typeof purchaseInclude }>;

async function logPurchaseAction(
  req: Express.Request,
  workspaceId: string,
  action: string,
  purchaseId: string,
  meta: Record<string, unknown>,
) {
  await logAction({
    userId: req.user!.userId,
    workspaceId,
    action,
    entity: "Purchase",
    entityId: purchaseId,
    meta: {
      purchaseId,
      userId: req.user!.userId,
      userName: req.user!.name,
      ...meta,
    },
  });
}

async function assertActiveItems(
  client: Prisma.TransactionClient,
  workspaceId: string,
  itemIds: string[],
) {
  const activeItemCount = await client.item.count({
    where: {
      workspaceId,
      id: { in: itemIds },
      isActive: true,
    },
  });

  if (activeItemCount !== itemIds.length) {
    throw Object.assign(new Error("Purchase items must be active and belong to this workspace"), { status: 400 });
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
      if (!isSerializationConflict(error) || attempt === maxAttempts) throw error;
    }
  }

  throw lastError;
}

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

class StockConflictError extends Error {
  constructor() {
    super("Purchase receiving changed. Please retry.");
    this.name = "StockConflictError";
  }
}

function isWriteConflict(error: unknown) {
  return error instanceof StockConflictError || isSerializationConflict(error);
}

function isSerializationConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

function parseOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseNullableString(value: unknown) {
  if (value === null) return null;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseOptionalDate(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return "invalid";
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
