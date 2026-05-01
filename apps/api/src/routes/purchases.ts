import { Role, StockMovementType } from "../generated/prisma/enums.js";
import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";

export const purchasesRouter = Router();

purchasesRouter.use(requireAuth);

purchasesRouter.post("/", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const input = parsePurchaseInput(req.body);

  if (!input.supplierId) {
    return res.status(400).json({ error: "Supplier is required" });
  }

  if (input.date === "invalid") {
    return res.status(400).json({ error: "Purchase date must be a valid date" });
  }

  if (input.items.length === 0) {
    return res.status(400).json({ error: "At least one purchase item is required" });
  }

  const invalidLine = input.items.find(
    (item) => !item.itemId || item.quantity === undefined || item.unitCost === undefined,
  );

  if (invalidLine) {
    return res.status(400).json({
      error: "Each purchase item requires itemId, quantity, and unitCost",
    });
  }

  const nonPositiveLine = input.items.find(
    (item) => item.quantity! <= 0 || item.unitCost! < 0,
  );

  if (nonPositiveLine) {
    return res.status(400).json({
      error: "Quantity must be greater than zero and unit cost cannot be negative",
    });
  }

  const supplier = await prisma.supplier.findFirst({
    where: { id: input.supplierId, workspaceId },
    select: { id: true, name: true },
  });

  if (!supplier) {
    return res.status(404).json({ error: "Supplier not found" });
  }

  const itemIds = [...new Set(input.items.map((item) => item.itemId!))];
  const items = await prisma.item.findMany({
    where: {
      id: { in: itemIds },
      workspaceId,
    },
    select: { id: true },
  });

  if (items.length !== itemIds.length) {
    return res.status(404).json({ error: "One or more items were not found" });
  }

  const lines = input.items.map((item) => ({
    itemId: item.itemId!,
    quantity: item.quantity!,
    unitCost: item.unitCost!,
    total: item.quantity! * item.unitCost!,
  }));
  const totalAmount = lines.reduce((total, line) => total + line.total, 0);
  const purchaseDate = input.date ?? new Date();

  const result = await prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.create({
      data: {
        supplierId: supplier.id,
        workspaceId,
        date: purchaseDate,
        totalAmount,
      },
    });

    const purchaseItems = [];
    const stockBatches = [];
    const stockMovements = [];

    for (const line of lines) {
      const purchaseItem = await tx.purchaseItem.create({
        data: {
          purchaseId: purchase.id,
          itemId: line.itemId,
          quantity: line.quantity,
          unitCost: line.unitCost,
          total: line.total,
        },
      });

      const stockBatch = await tx.stockBatch.create({
        data: {
          itemId: line.itemId,
          workspaceId,
          quantity: line.quantity,
          remainingQuantity: line.quantity,
          unitCost: line.unitCost,
          supplierName: supplier.name,
        },
      });

      const stockMovement = await tx.stockMovement.create({
        data: {
          workspaceId,
          itemId: line.itemId,
          batchId: stockBatch.id,
          type: StockMovementType.STOCK_IN,
          quantity: line.quantity,
          unitCost: line.unitCost,
          reason: "purchase",
          note: `Purchase from ${supplier.name}`,
        },
      });

      purchaseItems.push(purchaseItem);
      stockBatches.push(stockBatch);
      stockMovements.push(stockMovement);
    }

    return {
      purchase,
      purchaseItems,
      stockBatches,
      stockMovements,
    };
  });

  return res.status(201).json(result);
}));

purchasesRouter.get("/", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const purchases = await prisma.purchase.findMany({
    where: { workspaceId },
    orderBy: { date: "desc" },
    include: {
      supplier: {
        select: {
          id: true,
          name: true,
        },
      },
      purchaseItems: {
        include: {
          item: {
            select: {
              id: true,
              name: true,
              unit: true,
            },
          },
        },
      },
    },
  });

  return res.json({ purchases });
}));

function getWorkspaceId(req: Express.Request) {
  return req.user?.workspaceId ?? null;
}

function parsePurchaseInput(body: unknown) {
  const input = body as {
    supplierId?: unknown;
    date?: unknown;
    items?: unknown;
  };

  return {
    supplierId: parseOptionalString(input.supplierId),
    date: parseOptionalDate(input.date),
    items: Array.isArray(input.items)
      ? input.items.map(parsePurchaseItemInput)
      : [],
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

function parseOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

function parseOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseOptionalDate(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    return "invalid";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "invalid" : date;
}
