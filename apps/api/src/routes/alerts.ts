import { Router } from "express";
import { Role } from "../generated/prisma/enums.js";
import { prisma } from "../db/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import { getActiveLocationId } from "../utils/locations.js";

export const alertsRouter = Router();

alertsRouter.use(requireAuth);

alertsRouter.get("/", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;

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
            locationId,
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
        locationId,
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

function getExpiryAlertDays(value: number | null | undefined) {
  return typeof value === "number" && value >= 0 ? value : 7;
}
