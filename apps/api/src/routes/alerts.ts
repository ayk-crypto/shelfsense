import { Router } from "express";
import { Role, PurchaseStatus } from "../generated/prisma/enums.js";
import { prisma } from "../db/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import { getActiveLocationId } from "../utils/locations.js";
import { sendAlertDigestEmail } from "../services/email.js";
import { logger } from "../lib/logger.js";

export const alertsRouter = Router();

alertsRouter.use(requireAuth);

const OPEN_PO_STATUSES = [PurchaseStatus.ORDERED, PurchaseStatus.PARTIALLY_RECEIVED];

/** Convert a procurement frequency to calendar-aware next due date */
function calcNextProcurementDate(
  lastReceivedDate: Date,
  frequency: string,
  customFrequencyDays: number | null,
): Date | null {
  const d = new Date(lastReceivedDate);
  switch (frequency) {
    case "daily":
      d.setDate(d.getDate() + 1);
      break;
    case "weekly":
      d.setDate(d.getDate() + 7);
      break;
    case "biweekly":
      d.setDate(d.getDate() + 14);
      break;
    case "monthly": {
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + 1);
      const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, dim));
      break;
    }
    case "custom":
      if (!customFrequencyDays || customFrequencyDays < 1) return null;
      d.setDate(d.getDate() + customFrequencyDays);
      break;
    default:
      return null;
  }
  return d;
}

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
      name: true,
      expiryAlertDays: true,
      notifyLowStock: true,
      notifyExpiringSoon: true,
      notifyExpired: true,
      emailAlertsEnabled: true,
      emailLowStock: true,
      emailExpiringSoon: true,
      emailExpired: true,
      owner: { select: { email: true } },
    },
  });

  const expiryAlertUntil = new Date(now);
  expiryAlertUntil.setDate(now.getDate() + getExpiryAlertDays(workspace?.expiryAlertDays));

  // ── Fetch all data in parallel ────────────────────────────────────────────
  const [items, openPurchases, expiringSoon, expired] = await Promise.all([
    prisma.item.findMany({
      where: { workspaceId, isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        unit: true,
        purchaseUnit: true,
        purchaseConversionFactor: true,
        minStockLevel: true,
        criticalStockLevel: true,
        parStockLevel: true,
        procurementFrequency: true,
        customFrequencyDays: true,
        procurementLeadTimeDays: true,
        lastReceivedDate: true,
        stockBatches: {
          where: { workspaceId, locationId, remainingQuantity: { gt: 0 } },
          select: { remainingQuantity: true },
        },
      },
    }),

    // Open POs with line-level received quantities and expected delivery date
    prisma.purchase.findMany({
      where: { workspaceId, status: { in: OPEN_PO_STATUSES } },
      select: {
        id: true,
        status: true,
        expectedDeliveryDate: true,
        purchaseItems: {
          select: { itemId: true, quantity: true, receivedQuantity: true },
        },
      },
    }),

    prisma.stockBatch.findMany({
      where: {
        workspaceId,
        locationId,
        remainingQuantity: { gt: 0 },
        expiryDate: { gte: now, lte: expiryAlertUntil },
        item: { isActive: true },
      },
      orderBy: { expiryDate: "asc" },
      select: {
        id: true,
        remainingQuantity: true,
        expiryDate: true,
        batchNo: true,
        item: { select: { id: true, name: true, unit: true } },
      },
    }),

    prisma.stockBatch.findMany({
      where: {
        workspaceId,
        locationId,
        remainingQuantity: { gt: 0 },
        expiryDate: { lt: now },
        item: { isActive: true },
      },
      orderBy: { expiryDate: "asc" },
      select: {
        id: true,
        remainingQuantity: true,
        expiryDate: true,
        batchNo: true,
        item: { select: { id: true, name: true, unit: true } },
      },
    }),
  ]);

  // ── Build line-level pending PO map ───────────────────────────────────────
  // An item is "awaiting" only if its OWN line in an open PO has receivedQty < orderedQty.
  // Over-received or fully-received lines do NOT count as pending.
  type PendingPoInfo = {
    purchaseId: string;
    poStatus: string;
    orderedQty: number;
    receivedQty: number;
    pendingQty: number;
    expectedDeliveryDate: Date | null;
    poReference: string;
  };

  const itemPendingPo = new Map<string, PendingPoInfo>();
  for (const po of openPurchases) {
    for (const line of po.purchaseItems) {
      // Skip lines where this item's quantity is already fully or over-received
      if (line.receivedQuantity >= line.quantity) continue;

      const pendingQty = line.quantity - line.receivedQuantity;
      if (!itemPendingPo.has(line.itemId)) {
        itemPendingPo.set(line.itemId, {
          purchaseId: po.id,
          poStatus: po.status,
          orderedQty: line.quantity,
          receivedQty: line.receivedQuantity,
          pendingQty,
          expectedDeliveryDate: po.expectedDeliveryDate,
          poReference: `PO-${po.id.slice(-8).toUpperCase()}`,
        });
      }
    }
  }

  // ── Categorise items ──────────────────────────────────────────────────────
  type CriticalAlert = {
    itemId: string; itemName: string; unit: string;
    purchaseUnit: string | null; purchaseConversionFactor: number | null;
    quantity: number; criticalStockLevel: number; minStockLevel: number;
    activePo: { purchaseId: string; poStatus: string; poReference: string } | null;
  };
  type ReorderDueAlert = {
    itemId: string; itemName: string; unit: string;
    purchaseUnit: string | null; purchaseConversionFactor: number | null;
    quantity: number; parStockLevel: number | null;
    nextProcurementDate: string; procurementFrequency: string;
    daysOverdue: number;
  };
  type BelowParAlert = {
    itemId: string; itemName: string; unit: string;
    purchaseUnit: string | null; purchaseConversionFactor: number | null;
    quantity: number; parStockLevel: number;
    nextProcurementDate: string | null; procurementFrequency: string | null;
  };
  type AwaitingAlert = {
    itemId: string; itemName: string; unit: string;
    purchaseUnit: string | null; purchaseConversionFactor: number | null;
    quantity: number; purchaseId: string; poStatus: string;
    poReference: string;
    orderedQty: number; receivedQty: number; pendingQty: number;
    expectedDeliveryDate: string | null;
    criticalStockLevel: number | null;
  };

  const critical: CriticalAlert[] = [];
  const reorderDue: ReorderDueAlert[] = [];
  const belowPar: BelowParAlert[] = [];
  const awaitingReceiving: AwaitingAlert[] = [];

  for (const item of items) {
    const quantity = item.stockBatches.reduce((s, b) => s + b.remainingQuantity, 0);
    const effectiveCritical = item.criticalStockLevel ?? item.minStockLevel;

    // ── Determine next procurement due date ──
    let nextProcDate: Date | null = null;
    if (item.procurementFrequency && item.lastReceivedDate) {
      nextProcDate = calcNextProcurementDate(
        item.lastReceivedDate,
        item.procurementFrequency,
        item.customFrequencyDays,
      );
    }

    // Reorder due if today >= (nextDueDate - leadTimeDays)
    const leadDays = item.procurementLeadTimeDays ?? 0;
    const triggerDate = nextProcDate
      ? new Date(nextProcDate.getTime() - leadDays * 86_400_000)
      : null;
    const isReorderDue = triggerDate !== null && now >= triggerDate;

    const pendingPo = itemPendingPo.get(item.id);

    // ── RULE 1: Critical stock (always show, regardless of open PO) ──────────
    // Per spec: if critical AND has open PO, show in critical WITH "PO in progress" badge.
    // The item should NOT appear in Awaiting PO in this case.
    if (effectiveCritical > 0 && quantity <= effectiveCritical) {
      critical.push({
        itemId: item.id,
        itemName: item.name,
        unit: item.unit,
        purchaseUnit: item.purchaseUnit,
        purchaseConversionFactor: item.purchaseConversionFactor,
        quantity,
        criticalStockLevel: effectiveCritical,
        minStockLevel: item.minStockLevel,
        activePo: pendingPo
          ? { purchaseId: pendingPo.purchaseId, poStatus: pendingPo.poStatus, poReference: pendingPo.poReference }
          : null,
      });

    // ── RULE 2: Awaiting receiving (open PO with genuinely pending lines) ────
    } else if (pendingPo) {
      awaitingReceiving.push({
        itemId: item.id,
        itemName: item.name,
        unit: item.unit,
        purchaseUnit: item.purchaseUnit,
        purchaseConversionFactor: item.purchaseConversionFactor,
        quantity,
        purchaseId: pendingPo.purchaseId,
        poStatus: pendingPo.poStatus,
        poReference: pendingPo.poReference,
        orderedQty: pendingPo.orderedQty,
        receivedQty: pendingPo.receivedQty,
        pendingQty: pendingPo.pendingQty,
        expectedDeliveryDate: pendingPo.expectedDeliveryDate?.toISOString() ?? null,
        criticalStockLevel: effectiveCritical > 0 ? effectiveCritical : null,
      });

    // ── RULE 3: Reorder due (procurement cycle has elapsed, no open PO) ──────
    } else if (isReorderDue && nextProcDate) {
      const diffMs = now.getTime() - nextProcDate.getTime();
      reorderDue.push({
        itemId: item.id,
        itemName: item.name,
        unit: item.unit,
        purchaseUnit: item.purchaseUnit,
        purchaseConversionFactor: item.purchaseConversionFactor,
        quantity,
        parStockLevel: item.parStockLevel,
        nextProcurementDate: nextProcDate.toISOString(),
        procurementFrequency: item.procurementFrequency!,
        daysOverdue: Math.max(0, Math.round(diffMs / 86_400_000)),
      });

    // ── RULE 4: Below par (informational, no urgent action required) ─────────
    } else if (item.parStockLevel !== null && quantity < item.parStockLevel) {
      belowPar.push({
        itemId: item.id,
        itemName: item.name,
        unit: item.unit,
        purchaseUnit: item.purchaseUnit,
        purchaseConversionFactor: item.purchaseConversionFactor,
        quantity,
        parStockLevel: item.parStockLevel,
        nextProcurementDate: nextProcDate?.toISOString() ?? null,
        procurementFrequency: item.procurementFrequency ?? null,
      });
    }
  }

  // ── Backward-compat lowStock = critical (for dashboard + email) ──────────
  const lowStock = critical.map((c) => ({
    itemId: c.itemId,
    itemName: c.itemName,
    unit: c.unit,
    purchaseUnit: c.purchaseUnit,
    purchaseConversionFactor: c.purchaseConversionFactor,
    quantity: c.quantity,
    minStockLevel: c.criticalStockLevel,
  }));

  // ── Notifications + email ────────────────────────────────────────────────
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayStart.getDate() + 1);

  const workspaceEmailEligibility = (workspace?.emailAlertsEnabled ?? false)
    ? await getWorkspaceEmailEligibility(workspaceId, dayStart, dayEnd)
    : { lowStockUnsent: false, expiringSoonUnsent: false, expiredUnsent: false };

  await generateAlertNotifications({
    workspaceId,
    userId,
    critical,
    reorderDue,
    expiringSoon,
    expired,
    now,
    dayStart,
    dayEnd,
    preferences: {
      notifyLowStock: workspace?.notifyLowStock ?? true,
      notifyExpiringSoon: workspace?.notifyExpiringSoon ?? true,
      notifyExpired: workspace?.notifyExpired ?? true,
    },
  });

  const ownerEmail = workspace?.owner?.email;
  if (ownerEmail && (workspace?.emailAlertsEnabled ?? false)) {
    const emailPayload = {
      ownerEmail,
      workspaceName: workspace?.name ?? "Your Workspace",
      lowStock:
        (workspace?.emailLowStock ?? false) && workspaceEmailEligibility.lowStockUnsent
          ? lowStock
          : [],
      expiringSoon:
        (workspace?.emailExpiringSoon ?? false) && workspaceEmailEligibility.expiringSoonUnsent
          ? expiringSoon.map((b) => ({ itemName: b.item.name, batchNo: b.batchNo, expiryDate: b.expiryDate }))
          : [],
      expired:
        (workspace?.emailExpired ?? false) && workspaceEmailEligibility.expiredUnsent
          ? expired.map((b) => ({ itemName: b.item.name, batchNo: b.batchNo, expiryDate: b.expiryDate }))
          : [],
    };
    const hasAnyEmail =
      emailPayload.lowStock.length > 0 ||
      emailPayload.expiringSoon.length > 0 ||
      emailPayload.expired.length > 0;
    if (hasAnyEmail) {
      sendAlertDigestEmail(emailPayload).catch((err: unknown) => {
        logger.warn("[EMAIL] Failed to send alert digest", { error: String(err) });
      });
    }
  }

  return res.json({
    lowStock,
    critical,
    reorderDue,
    belowPar,
    awaitingReceiving,
    expiringSoon,
    expired,
  });
}));

function getExpiryAlertDays(value: number | null | undefined) {
  return typeof value === "number" && value >= 0 ? value : 7;
}

async function generateAlertNotifications({
  workspaceId,
  userId,
  critical,
  reorderDue,
  expiringSoon,
  expired,
  dayStart,
  dayEnd,
  preferences,
}: {
  workspaceId: string;
  userId: string;
  critical: Array<{ itemId: string; itemName: string; unit: string; quantity: number; criticalStockLevel: number }>;
  reorderDue: Array<{ itemId: string; itemName: string; nextProcurementDate: string; daysOverdue: number }>;
  expiringSoon: Array<{ id: string; remainingQuantity: number; expiryDate: Date | null; batchNo: string | null; item: { id: string; name: string; unit: string } }>;
  expired: Array<{ id: string; remainingQuantity: number; expiryDate: Date | null; batchNo: string | null; item: { id: string; name: string; unit: string } }>;
  now: Date;
  dayStart: Date;
  dayEnd: Date;
  preferences: { notifyLowStock: boolean; notifyExpiringSoon: boolean; notifyExpired: boolean };
}): Promise<void> {
  const candidates: Array<{ type: string; title: string; message: string; entity: string; entityId: string }> = [
    ...(preferences.notifyLowStock
      ? [
          ...critical.map((item) => ({
            type: "CRITICAL_STOCK",
            title: "Critical stock level reached",
            message: `${item.itemName} is at ${formatQuantity(item.quantity)} ${item.unit} — at or below the critical level of ${formatQuantity(item.criticalStockLevel)}.`,
            entity: "Item",
            entityId: item.itemId,
          })),
          ...reorderDue.map((item) => ({
            type: "REORDER_DUE",
            title: "Reorder due",
            message: `${item.itemName} procurement is due${item.daysOverdue > 0 ? ` (${item.daysOverdue} day${item.daysOverdue !== 1 ? "s" : ""} overdue)` : ""}.`,
            entity: "Item",
            entityId: item.itemId,
          })),
        ]
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

  await Promise.all(
    candidates.map(async (candidate) => {
      const existing = await prisma.notification.findFirst({
        where: {
          workspaceId,
          userId,
          type: candidate.type,
          entity: candidate.entity,
          entityId: candidate.entityId,
          createdAt: { gte: dayStart, lt: dayEnd },
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

async function getWorkspaceEmailEligibility(
  workspaceId: string,
  dayStart: Date,
  dayEnd: Date,
): Promise<{ lowStockUnsent: boolean; expiringSoonUnsent: boolean; expiredUnsent: boolean }> {
  const [lowStockCount, expiringSoonCount, expiredCount] = await Promise.all([
    prisma.notification.count({
      where: { workspaceId, type: { in: ["LOW_STOCK", "CRITICAL_STOCK"] }, createdAt: { gte: dayStart, lt: dayEnd } },
    }),
    prisma.notification.count({
      where: { workspaceId, type: "EXPIRY_SOON", createdAt: { gte: dayStart, lt: dayEnd } },
    }),
    prisma.notification.count({
      where: { workspaceId, type: "EXPIRED_STOCK", createdAt: { gte: dayStart, lt: dayEnd } },
    }),
  ]);
  return {
    lowStockUnsent: lowStockCount === 0,
    expiringSoonUnsent: expiringSoonCount === 0,
    expiredUnsent: expiredCount === 0,
  };
}

function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatDate(value: Date | null) {
  if (!value) return "an unknown date";
  return value.toISOString().slice(0, 10);
}
