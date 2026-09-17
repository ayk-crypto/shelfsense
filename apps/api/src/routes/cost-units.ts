import { Router } from "express";
import { Role, StockMovementType } from "../generated/prisma/enums.js";
import { prisma } from "../db/prisma.js";
import { requireActiveWorkspace, requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import { getActiveLocationId } from "../utils/locations.js";
import { logAction } from "../utils/audit-log.js";

export const costUnitsRouter = Router();

costUnitsRouter.use(requireAuth);
costUnitsRouter.use(requireActiveWorkspace);
costUnitsRouter.use(requireRole([Role.OWNER, Role.MANAGER]));

function getWorkspaceId(req: Express.Request) {
  return req.user?.workspaceId ?? null;
}

function parsePurchaseId(note: string | null | undefined) {
  if (!note) return null;
  const match = note.match(/Received purchase\s+([0-9a-fA-F-]{36})/i);
  return match?.[1] ?? null;
}

function poReference(id: string) {
  return `PO-${id.slice(-8).toUpperCase()}`;
}

function positiveFactor(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

costUnitsRouter.get("/", asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const locationId = await getActiveLocationId(req, workspaceId);
  const [items, batches] = await Promise.all([
    prisma.item.findMany({
      where: { workspaceId, isActive: true },
      select: {
        id: true,
        name: true,
        category: true,
        unit: true,
        purchaseUnit: true,
        purchaseConversionFactor: true,
        issueUnit: true,
        updatedAt: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.stockBatch.findMany({
      where: { workspaceId, locationId },
      select: {
        id: true,
        itemId: true,
        quantity: true,
        remainingQuantity: true,
        unitCost: true,
        unitCostExclTax: true,
        unitCostInclTax: true,
        receivedQuantity: true,
        receivedUnit: true,
        supplierName: true,
        createdAt: true,
        supplier: { select: { id: true, name: true } },
        stockMovements: {
          where: { type: StockMovementType.STOCK_IN },
          select: { reason: true, note: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
  ]);

  const currentByItem = new Map<string, number>();
  const latestByItem = new Map<string, (typeof batches)[number]>();
  for (const batch of batches) {
    currentByItem.set(batch.itemId, (currentByItem.get(batch.itemId) ?? 0) + batch.remainingQuantity);
    if (!latestByItem.has(batch.itemId)) latestByItem.set(batch.itemId, batch);
  }

  const rows = items.map((item) => {
    const factor = positiveFactor(item.purchaseConversionFactor);
    const purchaseUnit = item.purchaseUnit?.trim() || null;
    const storageUnit = item.unit;
    const conversionRequired = Boolean(purchaseUnit && purchaseUnit !== storageUnit);
    const latest = latestByItem.get(item.id) ?? null;
    const baseUnitCost = latest
      ? (latest.unitCost ?? latest.unitCostInclTax ?? latest.unitCostExclTax)
      : null;
    const currentStorageQuantity = currentByItem.get(item.id) ?? 0;
    const movement = latest?.stockMovements[0] ?? null;
    const purchaseId = movement?.reason === "purchase_receive" ? parsePurchaseId(movement.note) : null;
    const sourceType = movement?.reason === "purchase_receive" ? "PO" : latest ? "DIRECT" : "NONE";
    const purchaseUnitCost = baseUnitCost != null
      ? baseUnitCost * (conversionRequired && factor ? factor : 1)
      : null;
    const receivedQuantity = latest
      ? (latest.receivedQuantity ?? (conversionRequired && factor ? latest.quantity / factor : latest.quantity))
      : null;
    const receivedUnit = latest
      ? (latest.receivedUnit || (conversionRequired ? purchaseUnit : storageUnit))
      : null;

    let status: "READY" | "MISSING_CONVERSION" | "MISSING_COST" = "READY";
    if (conversionRequired && !factor) status = "MISSING_CONVERSION";
    else if (baseUnitCost == null || baseUnitCost <= 0) status = "MISSING_COST";

    return {
      itemId: item.id,
      name: item.name,
      category: item.category,
      storageUnit,
      purchaseUnit,
      conversionFactor: factor,
      issueUnit: item.issueUnit,
      currentStorageQuantity,
      currentPurchaseEquivalent: conversionRequired && factor ? currentStorageQuantity / factor : currentStorageQuantity,
      storageUnitCost: baseUnitCost,
      purchaseUnitCost,
      status,
      lastPurchase: latest ? {
        batchId: latest.id,
        date: latest.createdAt,
        sourceType,
        purchaseId,
        poReference: purchaseId ? poReference(purchaseId) : null,
        supplierId: latest.supplier?.id ?? null,
        supplierName: latest.supplier?.name ?? latest.supplierName ?? null,
        receivedQuantity,
        receivedUnit,
        storedBaseQuantity: latest.quantity,
        baseUnitCost,
        purchaseUnitCost,
      } : null,
    };
  });

  return res.json({ locationId, items: rows });
}));

costUnitsRouter.patch("/items/:itemId/latest-cost", asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });
  const locationId = await getActiveLocationId(req, workspaceId);
  const unitCost = typeof req.body?.unitCost === "number" ? req.body.unitCost : Number(req.body?.unitCost);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "Cost & Units correction";

  if (!Number.isFinite(unitCost) || unitCost <= 0) {
    return res.status(400).json({ error: "Storage unit cost must be greater than zero" });
  }

  const item = await prisma.item.findFirst({
    where: { id: req.params.itemId, workspaceId, isActive: true },
    select: { id: true, name: true, unit: true },
  });
  if (!item) return res.status(404).json({ error: "Item not found" });

  const latest = await prisma.stockBatch.findFirst({
    where: { workspaceId, locationId, itemId: item.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, unitCost: true, unitCostInclTax: true, unitCostExclTax: true },
  });
  if (!latest) return res.status(404).json({ error: "No receipt found for this item" });

  const previousCost = latest.unitCost ?? latest.unitCostInclTax ?? latest.unitCostExclTax ?? null;
  await prisma.$transaction(async (tx) => {
    await tx.stockBatch.update({ where: { id: latest.id }, data: { unitCost } });
    await tx.stockMovement.updateMany({
      where: { workspaceId, batchId: latest.id, type: StockMovementType.STOCK_IN },
      data: { unitCost },
    });
  });

  await logAction({
    userId: req.user!.userId,
    workspaceId,
    action: "LATEST_ITEM_COST_CORRECTED",
    entity: "StockBatch",
    entityId: latest.id,
    meta: {
      itemId: item.id,
      itemName: item.name,
      storageUnit: item.unit,
      previousCost,
      newCost: unitCost,
      reason: reason || "Cost & Units correction",
      locationId,
    },
  });

  return res.json({ success: true, batchId: latest.id, previousCost, unitCost });
}));
