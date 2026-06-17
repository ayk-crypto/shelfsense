import { ItemSupplierRole, PurchaseStatus, Role, StockMovementType } from "../generated/prisma/enums.js";
import { Router, type Request } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import { logAction } from "../utils/audit-log.js";
import { assertActiveLocation, getActiveLocationId } from "../utils/locations.js";
import {
  calculateReplenishment,
  summarizeIncomingPurchaseLines,
  type ReplenishmentMode,
} from "../lib/inventory-units.js";

export const reorderSuggestionsRouter = Router();

reorderSuggestionsRouter.use(requireAuth);

reorderSuggestionsRouter.get("/", requireRole([Role.OWNER, Role.MANAGER, Role.OPERATOR]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const locationId = await getActiveLocationId(req, workspaceId);
  const now = new Date();
  const usageFromDate = new Date(now);
  usageFromDate.setDate(now.getDate() - 6);
  usageFromDate.setHours(0, 0, 0, 0);
  const location = await prisma.location.findFirst({
    where: { id: locationId, workspaceId, isActive: true },
    select: { id: true, name: true },
  });
  if (!location) return res.status(400).json({ error: "Location is archived or unavailable" });

  const [items, usageMovements] = await Promise.all([
    prisma.item.findMany({
    where: { workspaceId, isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      sku: true,
      barcode: true,
      category: true,
      unit: true,
      purchaseUnit: true,
      purchaseConversionFactor: true,
      minStockLevel: true,
      procurementLeadTimeDays: true,
      replenishmentMode: true,
      safetyStockDays: true,
      reviewPeriodDays: true,
      manualReorderPointBaseQty: true,
      manualTargetStockBaseQty: true,
      allowFractionalPurchaseUnit: true,
      trackExpiry: true,
      stockBatches: {
        where: { workspaceId, locationId, remainingQuantity: { gt: 0 } },
        select: { remainingQuantity: true },
      },
      purchaseItems: {
        where: {
          purchase: {
            workspaceId,
            locationId,
            status: { in: [PurchaseStatus.ORDERED, PurchaseStatus.PARTIALLY_RECEIVED, PurchaseStatus.BACKORDERED] },
          },
        },
        select: {
          quantity: true,
          receivedQuantity: true,
          baseUnitSnapshot: true,
          purchaseUnitSnapshot: true,
          purchaseConversionFactorSnapshot: true,
          unitSnapshotSource: true,
          unitCost: true,
          purchase: {
            select: {
              id: true,
              status: true,
              expectedDeliveryDate: true,
              supplier: { select: { id: true, name: true } },
            },
          },
        },
      },
      itemSuppliers: {
        where: { workspaceId, role: ItemSupplierRole.PRIMARY },
        take: 1,
        select: { supplier: { select: { id: true, name: true } } },
      },
    },
    }),
    prisma.stockMovement.findMany({
      where: {
        workspaceId,
        locationId,
        type: StockMovementType.STOCK_OUT,
        createdAt: { gte: usageFromDate, lte: now },
      },
      select: { itemId: true, quantity: true },
    }),
  ]);

  const usageByItemId = new Map<string, number>();
  for (const movement of usageMovements) {
    usageByItemId.set(movement.itemId, (usageByItemId.get(movement.itemId) ?? 0) + movement.quantity);
  }

  const suggestions = items
    .map((item) => {
      const currentStock = item.stockBatches.reduce((sum, batch) => sum + batch.remainingQuantity, 0);
      const usageBaseQty = usageByItemId.get(item.id) ?? null;
      const incoming = summarizeIncomingPurchaseLines(item.purchaseItems.map((line) => ({
        purchaseId: line.purchase.id,
        poReference: `PO-${line.purchase.id.slice(-8).toUpperCase()}`,
        supplierName: line.purchase.supplier.name,
        status: line.purchase.status,
        orderedBaseQty: line.quantity,
        receivedBaseQty: line.receivedQuantity,
        baseUnitSnapshot: line.baseUnitSnapshot,
        purchaseUnitSnapshot: line.purchaseUnitSnapshot,
        purchaseConversionFactorSnapshot: line.purchaseConversionFactorSnapshot,
        unitSnapshotSource: line.unitSnapshotSource,
        expectedDeliveryDate: line.purchase.expectedDeliveryDate,
      })), {
        baseUnit: item.unit,
        buyingUnit: item.purchaseUnit,
        conversionFactor: item.purchaseConversionFactor,
      }, now);
      const replenishment = calculateReplenishment({
        mode: (item.replenishmentMode === "DAYS_BASED" ? "DAYS_BASED" : "MANUAL_THRESHOLD") as ReplenishmentMode,
        currentStockBaseQty: currentStock,
        averageDailyUsageBaseQty: usageBaseQty === null ? null : usageBaseQty / 7,
        hasUsageHistory: usageBaseQty !== null,
        supplierLeadTimeDays: item.procurementLeadTimeDays,
        safetyStockDays: item.safetyStockDays,
        reviewPeriodDays: item.reviewPeriodDays,
        lowStockThresholdBaseQty: item.minStockLevel,
        manualReorderPointBaseQty: item.manualReorderPointBaseQty,
        manualTargetStockBaseQty: item.manualTargetStockBaseQty,
        purchaseUnit: item.purchaseUnit,
        baseUnit: item.unit,
        purchaseConversionFactor: item.purchaseConversionFactor,
        allowFractionalPurchaseUnit: item.allowFractionalPurchaseUnit,
        incoming,
        today: now,
      });
      const suggestedQuantity = replenishment.requiredBaseQty ?? 0;
      const lastPurchase = item.purchaseItems[0] ?? null;
      const primaryMappedSupplier = item.itemSuppliers[0]?.supplier ?? null;

      return {
        itemId: item.id,
        itemName: item.name,
        sku: item.sku,
        barcode: item.barcode,
        category: item.category,
        unit: item.unit,
        purchaseUnit: item.purchaseUnit,
        purchaseConversionFactor: item.purchaseConversionFactor,
        currentStock,
        minStockLevel: item.minStockLevel,
        suggestedQuantity,
        replenishment,
        trackExpiry: item.trackExpiry,
        location,
        preferredSupplier: primaryMappedSupplier ?? lastPurchase?.purchase.supplier ?? null,
        lastPurchaseCost: lastPurchase?.unitCost ?? null,
      };
    })
    .filter((item) => ["REORDER_REQUIRED", "ADDITIONAL_QTY_REQUIRED", "ON_ORDER_SHORTAGE_RISK", "OVERDUE_DELIVERY", "CONFIGURATION_REQUIRED", "NO_USAGE_DATA"].includes(item.replenishment.status));

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
