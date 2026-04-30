import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";

export const alertsRouter = Router();

alertsRouter.use(requireAuth);

alertsRouter.get("/", asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const now = new Date();
  const sevenDaysFromNow = new Date(now);
  sevenDaysFromNow.setDate(now.getDate() + 7);

  const [items, expiringSoon, expired] = await Promise.all([
    prisma.item.findMany({
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
          },
        },
      },
    }),
    prisma.stockBatch.findMany({
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
        remainingQuantity: true,
        expiryDate: true,
        batchNo: true,
        item: {
          select: {
            id: true,
            name: true,
            unit: true,
          },
        },
      },
    }),
    prisma.stockBatch.findMany({
      where: {
        workspaceId,
        remainingQuantity: { gt: 0 },
        expiryDate: {
          lt: now,
        },
      },
      orderBy: { expiryDate: "asc" },
      select: {
        id: true,
        remainingQuantity: true,
        expiryDate: true,
        batchNo: true,
        item: {
          select: {
            id: true,
            name: true,
            unit: true,
          },
        },
      },
    }),
  ]);

  const lowStock = items
    .map((item) => {
      const quantity = item.stockBatches.reduce(
        (total, batch) => total + batch.remainingQuantity,
        0,
      );

      return {
        itemId: item.id,
        itemName: item.name,
        unit: item.unit,
        quantity,
        minStockLevel: item.minStockLevel,
      };
    })
    .filter((item) => item.quantity <= item.minStockLevel);

  return res.json({
    lowStock,
    expiringSoon,
    expired,
  });
}));
