import { PurchaseStatus, Role, StockMovementType, UnitSnapshotSource } from "../generated/prisma/enums.js";
import { Router, type Request } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../db/prisma.js";
import { requireActiveWorkspace, requireAuth, requireRole } from "../middleware/auth.js";
import { requirePlanFeature } from "../middleware/require-plan-feature.js";
import { asyncHandler } from "../utils/async-handler.js";
import { logAction } from "../utils/audit-log.js";
import { assertActiveLocation, assertActiveLocations, getActiveLocationId } from "../utils/locations.js";
import {
  buildPurchaseLineSnapshot,
  parseQuantityUnit,
  type PurchaseQuantityUnit,
} from "../lib/purchase-unit-snapshots.js";

export const purchasesRouter = Router();

purchasesRouter.use(requireAuth);
purchasesRouter.use(requireActiveWorkspace);
purchasesRouter.use(requirePlanFeature("enablePurchases"));

const purchaseInclude = {
  supplier: {
    select: {
      id: true,
      name: true,
      phone: true,
      notes: true,
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
          purchaseUnit: true,
          purchaseConversionFactor: true,
          category: true,
          minStockLevel: true,
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
    (item) => !item.itemId || item.quantity === undefined || item.unitCost === undefined || !item.quantityUnit,
  );
  if (invalidLine) {
    return res.status(400).json({ error: "Each purchase item requires itemId, quantity, quantityUnit, and unitCost" });
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
    select: { id: true, unit: true, purchaseUnit: true, purchaseConversionFactor: true },
  });
  if (items.length !== itemIds.length) return res.status(404).json({ error: "One or more items were not found" });

  const itemById = new Map(items.map((item) => [item.id, item]));
  const lines: Array<{
    itemId: string;
    quantity: number;
    unitCost: number;
    total: number;
    baseUnitSnapshot: string;
    purchaseUnitSnapshot: string | null;
    purchaseConversionFactorSnapshot: number | null;
    enteredQuantity: number;
    enteredUnitSnapshot: string;
    storedBaseQuantitySnapshot: number;
    unitSnapshotSource: UnitSnapshotSource;
  }> = [];
  for (const item of input.items) {
    const dbItem = itemById.get(item.itemId!)!;
    const snapshot = buildPurchaseLineSnapshot(item.quantity!, item.quantityUnit!, item.unitCost!, dbItem);
    if ("error" in snapshot) return res.status(400).json({ error: snapshot.error });
    lines.push({
      itemId: item.itemId!,
      quantity: snapshot.storedBaseQuantity,
      unitCost: snapshot.baseUnitCost,
      total: snapshot.storedBaseQuantity * snapshot.baseUnitCost,
      baseUnitSnapshot: snapshot.baseUnitSnapshot,
      purchaseUnitSnapshot: snapshot.purchaseUnitSnapshot,
      purchaseConversionFactorSnapshot: snapshot.purchaseConversionFactorSnapshot,
      enteredQuantity: snapshot.enteredQuantity,
      enteredUnitSnapshot: snapshot.enteredUnitSnapshot,
      storedBaseQuantitySnapshot: snapshot.storedBaseQuantity,
      unitSnapshotSource: UnitSnapshotSource.ORIGINAL,
    });
  }
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
            baseUnitSnapshot: line.baseUnitSnapshot,
            purchaseUnitSnapshot: line.purchaseUnitSnapshot,
            purchaseConversionFactorSnapshot: line.purchaseConversionFactorSnapshot,
            enteredQuantity: line.enteredQuantity,
            enteredUnitSnapshot: line.enteredUnitSnapshot,
            storedBaseQuantitySnapshot: line.storedBaseQuantitySnapshot,
            unitSnapshotSource: line.unitSnapshotSource,
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

purchasesRouter.post("/bulk-delete", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const body = req.body as { ids?: unknown };
  const ids = Array.isArray(body.ids)
    ? (body.ids as unknown[]).filter((id): id is string => typeof id === "string")
    : [];
  if (ids.length === 0) return res.status(400).json({ error: "At least one purchase ID is required" });

  const purchases = await prisma.purchase.findMany({
    where: { id: { in: ids }, workspaceId },
    select: { id: true, status: true, supplier: { select: { name: true } } },
  });

  const draftPurchases = purchases.filter((p) => p.status === PurchaseStatus.DRAFT);
  if (draftPurchases.length === 0) {
    return res.status(400).json({ error: "Only draft purchase orders can be deleted." });
  }

  const draftIds = draftPurchases.map((p) => p.id);
  await prisma.purchase.deleteMany({ where: { id: { in: draftIds }, workspaceId } });

  for (const p of draftPurchases) {
    await logPurchaseAction(req, workspaceId, "PURCHASE_DRAFT_DELETED", p.id, {
      reference: `PO-${p.id.slice(-8).toUpperCase()}`,
      supplierName: p.supplier.name,
    });
  }

  return res.json({ deletedCount: draftIds.length });
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

purchasesRouter.patch("/:id/supplier", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const { supplierId } = req.body as { supplierId?: unknown };
  if (!supplierId || typeof supplierId !== "string") {
    return res.status(400).json({ error: "supplierId is required" });
  }

  const purchase = await prisma.purchase.findFirst({
    where: { id: req.params.id, workspaceId },
    select: { id: true, status: true, supplierId: true },
  });
  if (!purchase) return res.status(404).json({ error: "Purchase not found" });
  if (purchase.status !== PurchaseStatus.DRAFT) {
    return res.status(400).json({ error: "Supplier can only be changed on DRAFT purchases" });
  }

  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, workspaceId },
    select: { id: true, name: true },
  });
  if (!supplier) return res.status(404).json({ error: "Supplier not found" });

  const updated = await prisma.purchase.update({
    where: { id: purchase.id },
    data: { supplierId: supplier.id },
    include: purchaseInclude,
  });

  await logPurchaseAction(req, workspaceId, "PURCHASE_SUPPLIER_CHANGED", purchase.id, {
    supplierId: supplier.id,
    supplierName: supplier.name,
  });

  return res.json({ purchase: mapPurchaseRecord(updated) });
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

      // Track how much we've already committed for each item in this transaction
      // (multiple batch rows for the same purchaseItemId arrive in one request)
      const accumulatedByItem = new Map<string, number>();

      for (const line of input.lines) {
        const purchaseItem = purchaseItemById.get(line.purchaseItemId!);
        if (!purchaseItem) throw new HttpError(400, "Received line does not belong to this purchase");

        const remainingQuantity = purchaseItem.quantity - purchaseItem.receivedQuantity;
        const alreadyAccumulated = accumulatedByItem.get(line.purchaseItemId!) ?? 0;
        if (!input.allowOverReceive && alreadyAccumulated + line.receivedQuantity! > remainingQuantity) {
          throw new HttpError(400, `Cannot receive more than ordered for ${purchaseItem.item.name}`);
        }
        accumulatedByItem.set(line.purchaseItemId!, alreadyAccumulated + line.receivedQuantity!);

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
            unitCostExclTax: line.unitCostExclTax ?? null,
            unitTax: line.unitTax ?? null,
            unitCostInclTax: line.unitCostInclTax ?? null,
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

      // Update lastReceivedDate on each unique item received in this GRN
      const receivedItemIds = [...new Set(input.lines.map((l) => {
        const pi = purchaseItemById.get(l.purchaseItemId!);
        return pi?.itemId ?? null;
      }).filter(Boolean) as string[])];
      const receivedNow = new Date();
      await Promise.all(
        receivedItemIds.map((itemId) =>
          tx.item.update({
            where: { id: itemId },
            data: { lastReceivedDate: receivedNow },
          }),
        ),
      );

      const freshItems = await tx.purchaseItem.findMany({
        where: { purchaseId: purchase.id },
        select: { quantity: true, receivedQuantity: true },
      });
      const allReceived = freshItems.every((item) => item.receivedQuantity >= item.quantity);
      const anyReceived = freshItems.some((item) => item.receivedQuantity > 0);
      const anyOverReceived = freshItems.some((item) => item.receivedQuantity > item.quantity);
      const nextStatus = allReceived
        ? anyOverReceived
          ? PurchaseStatus.RECEIVED_WITH_VARIANCE
          : PurchaseStatus.RECEIVED
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

// Simple force-close: closes a PO immediately regardless of pending quantities.
// Pending lines get closureAction=CLOSE_SHORT (no per-line reason required).
// Used by the Alerts page "Close PO" button for a fast, no-modal closure.
purchasesRouter.post("/:id/close", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const purchase = await prisma.purchase.findFirst({
    where: { id: req.params.id, workspaceId },
    select: {
      id: true,
      status: true,
      supplier: { select: { name: true } },
      purchaseItems: { select: { id: true, quantity: true, receivedQuantity: true } },
    },
  });

  if (!purchase) return res.status(404).json({ error: "Purchase not found" });
  if (
    purchase.status !== PurchaseStatus.ORDERED &&
    purchase.status !== PurchaseStatus.PARTIALLY_RECEIVED
  ) {
    return res.status(400).json({
      error: "Only ordered or partially received purchase orders can be closed.",
    });
  }

  const now = new Date();
  const pendingLines = purchase.purchaseItems.filter((l) => l.receivedQuantity < l.quantity);
  const allReceived = pendingLines.length === 0;
  const newStatus = allReceived ? PurchaseStatus.RECEIVED : PurchaseStatus.CLOSED_SHORT;

  if (pendingLines.length > 0) {
    await prisma.purchaseItem.updateMany({
      where: { id: { in: pendingLines.map((l) => l.id) } },
      data: {
        closureAction: "CLOSE_SHORT",
        closureReason: "Force closed",
        closedAt: now,
      },
    });
    // Update shortQty per-line (updateMany can't compute per-row)
    await Promise.all(
      pendingLines.map((l) =>
        prisma.purchaseItem.update({
          where: { id: l.id },
          data: { shortQty: l.quantity - l.receivedQuantity },
        }),
      ),
    );
  }

  await prisma.purchase.update({
    where: { id: purchase.id },
    data: {
      status: newStatus,
      receivedAt: allReceived ? now : null,
      closureType: allReceived ? null : "CLOSE_SHORT",
      closureReason: allReceived ? null : "Force closed",
      closedAt: allReceived ? null : now,
      closedById: allReceived ? null : req.user!.userId,
    },
  });

  await logPurchaseAction(req, workspaceId, "PURCHASE_MANUAL_CLOSE", purchase.id, {
    reference: `PO-${purchase.id.slice(-8).toUpperCase()}`,
    supplierName: purchase.supplier.name,
    newStatus,
    pendingLinesClosed: pendingLines.length,
  });

  return res.json({ success: true });
}));

// Close a PO with per-line closure actions and optional backorder draft creation.
purchasesRouter.post("/:id/close-with-variance", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const {
    lines = [],
    globalReason = "",
    closureNotes,
    createNewDraft = false,
  } = req.body as {
    lines: Array<{ purchaseItemId: string; action: string; reason?: string }>;
    globalReason?: string;
    closureNotes?: string;
    createNewDraft?: boolean;
  };

  if (!Array.isArray(lines)) {
    return res.status(400).json({ error: "lines must be an array" });
  }

  const purchase = await prisma.purchase.findFirst({
    where: { id: req.params.id, workspaceId },
    include: {
      ...purchaseInclude,
    },
  });

  if (!purchase) return res.status(404).json({ error: "Purchase not found" });
  if (
    purchase.status !== PurchaseStatus.ORDERED &&
    purchase.status !== PurchaseStatus.PARTIALLY_RECEIVED
  ) {
    return res.status(400).json({
      error: "Only ordered or partially received purchase orders can be closed.",
    });
  }

  const lineActionMap = new Map(lines.map((l) => [l.purchaseItemId, l]));
  const now = new Date();

  // Apply closure actions to non-KEEP_PENDING pending lines
  const actionedLines = purchase.purchaseItems.filter((pi) => {
    const remaining = pi.quantity - pi.receivedQuantity;
    if (remaining <= 0) return false;
    const la = lineActionMap.get(pi.id);
    return la && la.action !== "KEEP_PENDING";
  });

  if (actionedLines.length > 0) {
    await Promise.all(
      actionedLines.map((pi) => {
        const la = lineActionMap.get(pi.id)!;
        return prisma.purchaseItem.update({
          where: { id: pi.id },
          data: {
            closureAction: la.action,
            closureReason: (la.reason ?? globalReason) || null,
            shortQty: pi.quantity - pi.receivedQuantity,
            closedAt: now,
          },
        });
      }),
    );
  }

  // Determine which lines are still genuinely pending (no closure action applied)
  const stillPendingLines = purchase.purchaseItems.filter((pi) => {
    const remaining = pi.quantity - pi.receivedQuantity;
    if (remaining <= 0) return false;
    const la = lineActionMap.get(pi.id);
    return !la || la.action === "KEEP_PENDING";
  });

  const anyActioned = actionedLines.length > 0;

  if (!anyActioned && !createNewDraft) {
    return res.status(400).json({
      error: "Select a closure action for at least one pending item, or choose to create a new draft.",
    });
  }

  let newStatus: PurchaseStatus;
  let newDraftId: string | null = null;

  if (createNewDraft && stillPendingLines.length > 0) {
    // Create new DRAFT for still-pending items
    const newDraftTotalAmount = stillPendingLines.reduce(
      (sum, pi) => sum + (pi.quantity - pi.receivedQuantity) * pi.unitCost,
      0,
    );
    const newDraft = await prisma.purchase.create({
      data: {
        workspaceId: purchase.workspaceId,
        supplierId: purchase.supplierId,
        locationId: purchase.locationId,
        date: now,
        status: PurchaseStatus.DRAFT,
        totalAmount: newDraftTotalAmount,
        purchaseItems: {
          create: stillPendingLines.map((pi) => ({
            itemId: pi.itemId,
            quantity: pi.quantity - pi.receivedQuantity,
            receivedQuantity: 0,
            unitCost: pi.unitCost,
            total: (pi.quantity - pi.receivedQuantity) * pi.unitCost,
            baseUnitSnapshot: pi.baseUnitSnapshot,
            purchaseUnitSnapshot: pi.purchaseUnitSnapshot,
            purchaseConversionFactorSnapshot: pi.purchaseConversionFactorSnapshot,
            enteredQuantity: calculateEnteredQuantityForBaseQty(pi.quantity - pi.receivedQuantity, pi),
            enteredUnitSnapshot: pi.enteredUnitSnapshot,
            storedBaseQuantitySnapshot: pi.quantity - pi.receivedQuantity,
            unitSnapshotSource: pi.unitSnapshotSource,
          })),
        },
      },
    });
    newDraftId = newDraft.id;
    newStatus = PurchaseStatus.BACKORDERED;
  } else if (stillPendingLines.length === 0) {
    newStatus = PurchaseStatus.CLOSED_SHORT;
  } else {
    // Some lines kept pending, no new draft — PO stays open
    newStatus = PurchaseStatus.PARTIALLY_RECEIVED;
  }

  const isClosed = newStatus !== PurchaseStatus.PARTIALLY_RECEIVED;

  const updatedPurchase = await prisma.purchase.update({
    where: { id: purchase.id },
    data: {
      status: newStatus,
      closureType: isClosed ? (createNewDraft && newDraftId ? "BACKORDER" : "CLOSE_SHORT") : null,
      closureReason: isClosed ? (globalReason || null) : null,
      closureNotes: isClosed ? (closureNotes ?? null) : null,
      closedAt: isClosed ? now : null,
      closedById: isClosed ? req.user!.userId : null,
    },
    include: purchaseInclude,
  });

  await logPurchaseAction(req, workspaceId, "PURCHASE_CLOSE_WITH_VARIANCE", purchase.id, {
    reference: `PO-${purchase.id.slice(-8).toUpperCase()}`,
    supplierName: purchase.supplier.name,
    newStatus,
    globalReason,
    actionedCount: actionedLines.length,
    stillPendingCount: stillPendingLines.length,
    createNewDraft,
    newDraftId,
  });

  return res.json({
    purchase: mapPurchaseRecord(updatedPurchase),
    newDraftId,
  });
}));

purchasesRouter.delete("/:id", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const purchase = await prisma.purchase.findFirst({
    where: { id: req.params.id, workspaceId },
    select: { id: true, status: true, supplier: { select: { name: true } } },
  });

  if (!purchase) return res.status(404).json({ error: "Purchase not found" });

  if (purchase.status !== PurchaseStatus.DRAFT) {
    return res.status(400).json({
      error: "Only draft purchase orders can be deleted. Cancel the purchase order instead.",
    });
  }

  await prisma.purchase.delete({ where: { id: purchase.id } });

  await logPurchaseAction(req, workspaceId, "PURCHASE_DRAFT_DELETED", purchase.id, {
    reference: `PO-${purchase.id.slice(-8).toUpperCase()}`,
    supplierName: purchase.supplier.name,
  });

  return res.json({ success: true });
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
    quantityUnit?: unknown;
    unitCost?: unknown;
  };

  return {
    itemId: parseOptionalString(input.itemId),
    quantity: parseOptionalNumber(input.quantity),
    quantityUnit: parseQuantityUnit(input.quantityUnit),
    unitCost: parseOptionalNumber(input.unitCost),
  };
}

function parseReceiveInput(body: unknown, defaultLocationId: string) {
  const input = body as { lines?: unknown; allowOverReceive?: unknown };
  return {
    lines: Array.isArray(input.lines)
      ? input.lines.map((line) => parseReceiveLineInput(line, defaultLocationId))
      : [],
    allowOverReceive: input.allowOverReceive === true,
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
    unitCostExclTax?: unknown;
    unitTax?: unknown;
    unitCostInclTax?: unknown;
    notes?: unknown;
  };

  return {
    purchaseItemId: parseOptionalString(input.purchaseItemId),
    receivedQuantity: parseOptionalNumber(input.receivedQuantity),
    locationId: parseOptionalString(input.locationId) ?? defaultLocationId,
    expiryDate: parseOptionalDate(input.expiryDate),
    batchNo: parseNullableString(input.batchNo),
    unitCost: parseOptionalNumber(input.unitCost),
    unitCostExclTax: parseOptionalNumber(input.unitCostExclTax),
    unitTax: parseOptionalNumber(input.unitTax),
    unitCostInclTax: parseOptionalNumber(input.unitCostInclTax),
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
    const unitSnapshot = buildPurchaseLineUnitResponse(line, remainingQuantity);
    return {
      ...line,
      orderedQuantity: line.quantity,
      remainingQuantity,
      orderedValue: line.quantity * line.unitCost,
      receivedValue: line.receivedQuantity * line.unitCost,
      enteredQuantity: unitSnapshot.enteredQuantity,
      enteredUnit: unitSnapshot.enteredUnit,
      baseQuantity: line.quantity,
      baseUnit: unitSnapshot.baseUnit,
      conversionFactor: unitSnapshot.conversionFactor,
      unitSnapshot,
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

function calculateEnteredQuantityForBaseQty(baseQty: number, line: {
  purchaseUnitSnapshot: string | null;
  purchaseConversionFactorSnapshot: number | null;
  baseUnitSnapshot: string | null;
}) {
  if (line.purchaseUnitSnapshot && line.purchaseConversionFactorSnapshot && line.purchaseConversionFactorSnapshot > 0) {
    return baseQty / line.purchaseConversionFactorSnapshot;
  }
  return baseQty;
}

function buildPurchaseLineUnitResponse(line: PurchaseRecord["purchaseItems"][number], remainingQuantity: number) {
  const factor = line.purchaseConversionFactorSnapshot;
  const hasSnapshotConversion = Boolean(line.purchaseUnitSnapshot && factor !== null && factor > 0);
  const baseUnit = line.baseUnitSnapshot ?? line.item.unit;
  const enteredUnit = line.enteredUnitSnapshot ?? (hasSnapshotConversion ? line.purchaseUnitSnapshot! : baseUnit);
  const orderedPurchaseQuantity = hasSnapshotConversion ? line.quantity / factor! : null;
  const receivedPurchaseQuantity = hasSnapshotConversion ? line.receivedQuantity / factor! : null;
  const remainingPurchaseQuantity = hasSnapshotConversion ? remainingQuantity / factor! : null;

  return {
    source: line.unitSnapshotSource,
    baseUnit,
    purchaseUnit: line.purchaseUnitSnapshot,
    conversionFactor: factor,
    enteredQuantity: line.enteredQuantity ?? (hasSnapshotConversion ? orderedPurchaseQuantity : line.quantity),
    enteredUnit,
    storedBaseQuantity: line.storedBaseQuantitySnapshot ?? line.quantity,
    orderedBaseQuantity: line.quantity,
    receivedBaseQuantity: line.receivedQuantity,
    remainingBaseQuantity: remainingQuantity,
    orderedPurchaseQuantity,
    receivedPurchaseQuantity,
    remainingPurchaseQuantity,
    conversionUnavailable: !hasSnapshotConversion && Boolean(line.purchaseUnitSnapshot || line.item.purchaseUnit),
    message: !hasSnapshotConversion && Boolean(line.purchaseUnitSnapshot || line.item.purchaseUnit)
      ? "Historical purchase conversion unavailable"
      : null,
  };
}

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
