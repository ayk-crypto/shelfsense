import { Router } from "express";
import { Role } from "../generated/prisma/enums.js";
import { prisma } from "../db/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import { getActiveLocationId } from "../utils/locations.js";

export const alertsRouter = Router();

alertsRouter.use(requireAuth);

alertsRouter.get("/", requireRole([Role.OWNER, Role.MANAGER, Role.OPERATOR]), asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;
  const userId = req.user?.userId ?? null;

  if (!workspaceId || !userId) {
    return res.status(403).json({ error: "Workspace access required" });
  }
  const locationId = await getActiveLocationId(req, workspaceId);

  const now = new Date();
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      expiryAlertDays: true,
      notifyLowStock: true,
      notifyExpiringSoon: true,
      notifyExpired: true,
    },
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

  await generateAlertNotifications({
    workspaceId,
    userId,
    lowStock,
    expiringSoon,
    expired,
    now,
    preferences: {
      notifyLowStock: workspace?.notifyLowStock ?? true,
      notifyExpiringSoon: workspace?.notifyExpiringSoon ?? true,
      notifyExpired: workspace?.notifyExpired ?? true,
    },
  });

  return res.json({
    lowStock,
    expiringSoon,
    expired,
  });
}));

function getExpiryAlertDays(value: number | null | undefined) {
  return typeof value === "number" && value >= 0 ? value : 7;
}

interface AlertNotificationInput {
  workspaceId: string;
  userId: string;
  lowStock: Array<{
    itemId: string;
    itemName: string;
    unit: string;
    quantity: number;
    minStockLevel: number;
  }>;
  expiringSoon: Array<{
    id: string;
    remainingQuantity: number;
    expiryDate: Date | null;
    batchNo: string | null;
    item: {
      id: string;
      name: string;
      unit: string;
    };
  }>;
  expired: Array<{
    id: string;
    remainingQuantity: number;
    expiryDate: Date | null;
    batchNo: string | null;
    item: {
      id: string;
      name: string;
      unit: string;
    };
  }>;
  now: Date;
  preferences: {
    notifyLowStock: boolean;
    notifyExpiringSoon: boolean;
    notifyExpired: boolean;
  };
}

interface NotificationCandidate {
  type: string;
  title: string;
  message: string;
  entity: string;
  entityId: string;
}

async function generateAlertNotifications({
  workspaceId,
  userId,
  lowStock,
  expiringSoon,
  expired,
  now,
  preferences,
}: AlertNotificationInput) {
  const candidates: NotificationCandidate[] = [
    ...(preferences.notifyLowStock
      ? lowStock.map((item) => ({
          type: "LOW_STOCK",
          title: "Low stock detected",
          message: `${item.itemName} is at ${formatQuantity(item.quantity)} ${item.unit}, below or equal to the minimum of ${formatQuantity(item.minStockLevel)}.`,
          entity: "Item",
          entityId: item.itemId,
        }))
      : []),
    ...(preferences.notifyExpiringSoon
      ? expiringSoon.map((batch) => ({
          type: "EXPIRY_SOON",
          title: "Stock expiring soon",
          message: `${batch.item.name}${batch.batchNo ? ` batch ${batch.batchNo}` : ""} expires on ${formatDate(batch.expiryDate)}.`,
          entity: "StockBatch",
          entityId: batch.id,
        }))
      : []),
    ...(preferences.notifyExpired
      ? expired.map((batch) => ({
          type: "EXPIRED_STOCK",
          title: "Expired stock detected",
          message: `${batch.item.name}${batch.batchNo ? ` batch ${batch.batchNo}` : ""} expired on ${formatDate(batch.expiryDate)}.`,
          entity: "StockBatch",
          entityId: batch.id,
        }))
      : []),
  ];

  if (candidates.length === 0) return;

  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayStart.getDate() + 1);

  await Promise.all(
    candidates.map(async (candidate) => {
      const existing = await prisma.notification.findFirst({
        where: {
          workspaceId,
          userId,
          type: candidate.type,
          entity: candidate.entity,
          entityId: candidate.entityId,
          createdAt: {
            gte: dayStart,
            lt: dayEnd,
          },
        },
        select: { id: true },
      });

      if (existing) return;

      await prisma.notification.create({
        data: {
          workspaceId,
          userId,
          type: candidate.type,
          title: candidate.title,
          message: candidate.message,
          entity: candidate.entity,
          entityId: candidate.entityId,
        },
      });
    }),
  );
}

function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatDate(value: Date | null) {
  if (!value) return "an unknown date";
  return value.toISOString().slice(0, 10);
}
