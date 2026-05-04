import { PurchaseStatus, Role } from "../generated/prisma/enums.js";
import { Router, type Request } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import { logAction } from "../utils/audit-log.js";
import { assertActiveLocation, getActiveLocationId } from "../utils/locations.js";

export const reorderSuggestionsRouter = Router();

reorderSuggestionsRouter.use(requireAuth);

reorderSuggestionsRouter.get("/", requireRole([Role.OWNER, Role.MANAGER, Role.OPERATOR]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const locationId = await getActiveLocationId(req, workspaceId);
  const location = await prisma.location.findFirst({
    where: { id: locationId, workspaceId, isActive: true },
    select: { id: true, name: true },
  });
  if (!location) return res.status(400).json({ error: "Location is archived or unavailable" });

  const items = await prisma.item.findMany({
    where: { workspaceId, isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      sku: true,
      barcode: true,
      category: true,
      unit: true,
      minStockLevel: true,
      trackExpiry: true,
      stockBatches: {
        where: { workspaceId, locationId, remainingQuantity: { gt: 0 } },
        select: { remainingQuantity: true },
      },
      purchaseItems: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          unitCost: true,
          purchase: {
            select: {
              supplier: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

  const suggestions = items
    .map((item) => {
      const currentStock = item.stockBatches.reduce((sum, batch) => sum + batch.remainingQuantity, 0);
      const suggestedQuantity = getSuggestedQuantity(currentStock, item.minStockLevel);
      const lastPurchase = item.purchaseItems[0] ?? null;

      return {
        itemId: item.id,
        itemName: item.name,
        sku: item.sku,
        barcode: item.barcode,
        category: item.category,
        unit: item.unit,
        currentStock,
        minStockLevel: item.minStockLevel,
        suggestedQuantity,
        trackExpiry: item.trackExpiry,
        location,
        preferredSupplier: lastPurchase?.purchase.supplier ?? null,
        lastPurchaseCost: lastPurchase?.unitCost ?? null,
      };
    })
    .filter((item) => item.suggestedQuantity > 0);

  return res.json({ suggestions });
}));

reorderSuggestionsRouter.post("/create-purchases", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const defaultLocationId = await getActiveLocationId(req, workspaceId);
  const input = parseCreatePurchasesInput(req.body, defaultLocationId);

  if (input.items.length === 0) return res.status(400).json({ error: "Select at least one reorder item" });

  const invalidLine = input.items.find((item) => !item.itemId || !item.supplierId || item.quantity === undefined);
  if (invalidLine) return res.status(400).json({ error: "Each reorder item needs item, supplier, and quantity" });

  const nonPositiveLine = input.items.find((item) => item.quantity! <= 0 || (item.unitCost !== undefined && item.unitCost < 0));
  if (nonPositiveLine) return res.status(400).json({ error: "Quantity must be greater than zero and unit cost cannot be negative" });

  const itemIds = [...new Set(input.items.map((item) => item.itemId!))];
  const supplierIds = [...new Set(input.items.map((item) => item.supplierId!))];

  const [items, suppliers] = await Promise.all([
    prisma.item.findMany({
      where: { workspaceId, id: { in: itemIds }, isActive: true },
      select: { id: true, name: true },
    }),
    prisma.supplier.findMany({
      where: { workspaceId, id: { in: supplierIds } },
      select: { id: true, name: true },
    }),
  ]);

  if (items.length !== itemIds.length) return res.status(404).json({ error: "One or more items were not found" });
  if (suppliers.length !== supplierIds.length) return res.status(404).json({ error: "One or more suppliers were not found" });

  const itemById = new Map(items.map((item) => [item.id, item]));
  const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const linesBySupplier = new Map<string, CreateReorderLine[]>();
  for (const item of input.items) {
    const list = linesBySupplier.get(item.supplierId!) ?? [];
    list.push(item);
    linesBySupplier.set(item.supplierId!, list);
  }

  const purchases = await runSerializableWrite(async (tx) => {
    await assertActiveLocation(tx, workspaceId, input.locationId);

    const created = [];
    for (const [supplierId, lines] of linesBySupplier) {
      const totalAmount = lines.reduce((sum, line) => sum + line.quantity! * (line.unitCost ?? 0), 0);
      const purchase = await tx.purchase.create({
        data: {
          supplierId,
          workspaceId,
          locationId: input.locationId,
          date: new Date(),
          status: PurchaseStatus.DRAFT,
          totalAmount,
          purchaseItems: {
            create: lines.map((line) => ({
              itemId: line.itemId!,
              quantity: line.quantity!,
              receivedQuantity: 0,
              unitCost: line.unitCost ?? 0,
              total: line.quantity! * (line.unitCost ?? 0),
            })),
          },
        },
        select: {
          id: true,
          supplierId: true,
          status: true,
          totalAmount: true,
          purchaseItems: {
            select: {
              itemId: true,
              quantity: true,
              unitCost: true,
            },
          },
        },
      });
      created.push(purchase);
    }
    return created;
  });

  await Promise.all(purchases.map((purchase) => {
    const supplier = supplierById.get(purchase.supplierId);
    return logAction({
      userId: req.user!.userId,
      workspaceId,
      action: "PURCHASE_DRAFT_FROM_REORDER",
      entity: "Purchase",
      entityId: purchase.id,
      meta: {
        purchaseId: purchase.id,
        supplierId: purchase.supplierId,
        supplierName: supplier?.name,
        locationId: input.locationId,
        userId: req.user!.userId,
        userName: req.user!.name,
        items: purchase.purchaseItems.map((line) => ({
          itemId: line.itemId,
          itemName: itemById.get(line.itemId)?.name,
          quantity: line.quantity,
          unitCost: line.unitCost,
        })),
      },
    });
  }));

  return res.status(201).json({ purchases });
}));

function getSuggestedQuantity(currentStock: number, minStockLevel: number) {
  // Simple first-pass formula: fill the gap back to minimum stock.
  // Later this can factor in usage trends, supplier lead time, and seasonality.
  if (minStockLevel <= 0) return 0;
  if (currentStock <= 0) return minStockLevel;
  return Math.max(0, minStockLevel - currentStock);
}

function getWorkspaceId(req: Express.Request) {
  return req.user?.workspaceId ?? null;
}

interface CreateReorderLine {
  itemId?: string;
  supplierId?: string;
  quantity?: number;
  unitCost?: number;
}

function parseCreatePurchasesInput(body: unknown, defaultLocationId: string) {
  const input = body as { locationId?: unknown; items?: unknown };
  return {
    locationId: parseOptionalString(input.locationId) ?? defaultLocationId,
    items: Array.isArray(input.items) ? input.items.map(parseCreateReorderLine) : [],
  };
}

function parseCreateReorderLine(value: unknown): CreateReorderLine {
  const input = value as { itemId?: unknown; supplierId?: unknown; quantity?: unknown; unitCost?: unknown };
  return {
    itemId: parseOptionalString(input.itemId),
    supplierId: parseOptionalString(input.supplierId),
    quantity: parseOptionalNumber(input.quantity),
    unitCost: parseOptionalNumber(input.unitCost),
  };
}

function parseOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function runSerializableWrite<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, maxAttempts = 3): Promise<T> {
  return retrySerializable(
    () => prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
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
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") || attempt === maxAttempts) {
        throw error;
      }
    }
  }
  throw lastError;
}
