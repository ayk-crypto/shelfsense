import cron from "node-cron";
import { prisma } from "../db/prisma.js";
import { logger } from "../lib/logger.js";
import {
  sendLowStockAlertEmail,
  sendExpirySoonAlertEmail,
  sendDailyDigestEmail,
} from "../services/email.js";

const LOW_STOCK_EMAIL_COOLDOWN_HOURS = 4;
const EXPIRY_EMAIL_COOLDOWN_HOURS = 4;

export function startAlertScheduler(): void {
  cron.schedule("0 */4 * * *", () => void runLowStockJob());
  cron.schedule("0 2,6,10,14,18,22 * * *", () => void runExpirySoonJob());
  cron.schedule("0 8 * * *", () => void runDailyDigestJob());

  logger.info(
    "[SCHEDULER] Alert scheduler started — low stock every 4h, expiry every 4h (offset), daily digest at 08:00",
  );
}

async function runLowStockJob(): Promise<void> {
  logger.info("[SCHEDULER] Running low stock email job");
  try {
    const now = new Date();
    const cutoff = new Date(now.getTime() - LOW_STOCK_EMAIL_COOLDOWN_HOURS * 3_600_000);

    const workspaces = await prisma.workspace.findMany({
      where: {
        emailAlertsEnabled: true,
        emailLowStock: true,
        OR: [
          { lastScheduledLowStockEmailAt: null },
          { lastScheduledLowStockEmailAt: { lt: cutoff } },
        ],
      },
      select: {
        id: true,
        name: true,
        owner: { select: { email: true } },
      },
    });

    logger.info(`[SCHEDULER] Low stock job: ${workspaces.length} eligible workspace(s)`);

    for (const workspace of workspaces) {
      try {
        const items = await prisma.item.findMany({
          where: { workspaceId: workspace.id, isActive: true },
          select: {
            name: true,
            unit: true,
            minStockLevel: true,
            stockBatches: {
              where: { workspaceId: workspace.id, remainingQuantity: { gt: 0 } },
              select: { remainingQuantity: true },
            },
          },
        });

        const lowStock = items
          .map((item) => ({
            itemName: item.name,
            unit: item.unit,
            quantity: item.stockBatches.reduce((sum, b) => sum + b.remainingQuantity, 0),
            minStockLevel: item.minStockLevel,
          }))
          .filter((item) => item.quantity <= item.minStockLevel);

        if (lowStock.length === 0) continue;

        await sendLowStockAlertEmail({
          ownerEmail: workspace.owner.email,
          workspaceName: workspace.name,
          lowStock,
        });

        await prisma.workspace.update({
          where: { id: workspace.id },
          data: { lastScheduledLowStockEmailAt: now },
        });

        logger.info("[SCHEDULER] Low stock alert sent", {
          workspaceId: workspace.id,
          itemCount: lowStock.length,
        });
      } catch (err) {
        logger.warn("[SCHEDULER] Low stock job failed for workspace", {
          workspaceId: workspace.id,
          error: String(err),
        });
      }
    }
  } catch (err) {
    logger.error("[SCHEDULER] Low stock job fatal error", { error: String(err) });
  }
}

async function runExpirySoonJob(): Promise<void> {
  logger.info("[SCHEDULER] Running expiry email job");
  try {
    const now = new Date();
    const cutoff = new Date(now.getTime() - EXPIRY_EMAIL_COOLDOWN_HOURS * 3_600_000);

    const workspaces = await prisma.workspace.findMany({
      where: {
        emailAlertsEnabled: true,
        OR: [{ emailExpiringSoon: true }, { emailExpired: true }],
        AND: [
          {
            OR: [
              { lastScheduledExpirySoonEmailAt: null },
              { lastScheduledExpirySoonEmailAt: { lt: cutoff } },
            ],
          },
        ],
      },
      select: {
        id: true,
        name: true,
        expiryAlertDays: true,
        emailExpiringSoon: true,
        emailExpired: true,
        owner: { select: { email: true } },
      },
    });

    logger.info(`[SCHEDULER] Expiry job: ${workspaces.length} eligible workspace(s)`);

    for (const workspace of workspaces) {
      try {
        const expiryAlertDays =
          typeof workspace.expiryAlertDays === "number" && workspace.expiryAlertDays >= 0
            ? workspace.expiryAlertDays
            : 7;
        const expiryAlertUntil = new Date(now);
        expiryAlertUntil.setDate(now.getDate() + expiryAlertDays);

        const [expiringSoonRaw, expiredRaw] = await Promise.all([
          workspace.emailExpiringSoon
            ? prisma.stockBatch.findMany({
                where: {
                  workspaceId: workspace.id,
                  remainingQuantity: { gt: 0 },
                  expiryDate: { gte: now, lte: expiryAlertUntil },
                  item: { isActive: true },
                },
                orderBy: { expiryDate: "asc" },
                select: {
                  batchNo: true,
                  expiryDate: true,
                  item: { select: { name: true } },
                },
              })
            : Promise.resolve([]),
          workspace.emailExpired
            ? prisma.stockBatch.findMany({
                where: {
                  workspaceId: workspace.id,
                  remainingQuantity: { gt: 0 },
                  expiryDate: { lt: now },
                  item: { isActive: true },
                },
                orderBy: { expiryDate: "asc" },
                select: {
                  batchNo: true,
                  expiryDate: true,
                  item: { select: { name: true } },
                },
              })
            : Promise.resolve([]),
        ]);

        const expiringSoon = expiringSoonRaw.map((b) => ({
          itemName: b.item.name,
          batchNo: b.batchNo,
          expiryDate: b.expiryDate,
        }));
        const expired = expiredRaw.map((b) => ({
          itemName: b.item.name,
          batchNo: b.batchNo,
          expiryDate: b.expiryDate,
        }));

        if (expiringSoon.length === 0 && expired.length === 0) continue;

        await sendExpirySoonAlertEmail({
          ownerEmail: workspace.owner.email,
          workspaceName: workspace.name,
          expiringSoon,
          expired,
        });

        await prisma.workspace.update({
          where: { id: workspace.id },
          data: { lastScheduledExpirySoonEmailAt: now },
        });

        logger.info("[SCHEDULER] Expiry alert sent", {
          workspaceId: workspace.id,
          expiringSoon: expiringSoon.length,
          expired: expired.length,
        });
      } catch (err) {
        logger.warn("[SCHEDULER] Expiry job failed for workspace", {
          workspaceId: workspace.id,
          error: String(err),
        });
      }
    }
  } catch (err) {
    logger.error("[SCHEDULER] Expiry job fatal error", { error: String(err) });
  }
}

async function runDailyDigestJob(): Promise<void> {
  logger.info("[SCHEDULER] Running daily digest job");
  try {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const workspaces = await prisma.workspace.findMany({
      where: {
        dailyDigestEnabled: true,
        OR: [
          { lastDailyDigestSentAt: null },
          { lastDailyDigestSentAt: { lt: todayStart } },
        ],
      },
      select: {
        id: true,
        name: true,
        expiryAlertDays: true,
        owner: { select: { email: true } },
      },
    });

    logger.info(`[SCHEDULER] Daily digest job: ${workspaces.length} eligible workspace(s)`);

    for (const workspace of workspaces) {
      try {
        const expiryAlertDays =
          typeof workspace.expiryAlertDays === "number" && workspace.expiryAlertDays >= 0
            ? workspace.expiryAlertDays
            : 7;
        const expiryAlertUntil = new Date(now);
        expiryAlertUntil.setDate(now.getDate() + expiryAlertDays);

        const [itemsRaw, expiringSoonRaw, expiredRaw] = await Promise.all([
          prisma.item.findMany({
            where: { workspaceId: workspace.id, isActive: true },
            select: {
              name: true,
              unit: true,
              minStockLevel: true,
              stockBatches: {
                where: { workspaceId: workspace.id, remainingQuantity: { gt: 0 } },
                select: { remainingQuantity: true },
              },
            },
          }),
          prisma.stockBatch.findMany({
            where: {
              workspaceId: workspace.id,
              remainingQuantity: { gt: 0 },
              expiryDate: { gte: now, lte: expiryAlertUntil },
              item: { isActive: true },
            },
            orderBy: { expiryDate: "asc" },
            select: {
              batchNo: true,
              expiryDate: true,
              item: { select: { name: true } },
            },
          }),
          prisma.stockBatch.findMany({
            where: {
              workspaceId: workspace.id,
              remainingQuantity: { gt: 0 },
              expiryDate: { lt: now },
              item: { isActive: true },
            },
            orderBy: { expiryDate: "asc" },
            select: {
              batchNo: true,
              expiryDate: true,
              item: { select: { name: true } },
            },
          }),
        ]);

        const lowStock = itemsRaw
          .map((item) => ({
            itemName: item.name,
            unit: item.unit,
            quantity: item.stockBatches.reduce((sum, b) => sum + b.remainingQuantity, 0),
            minStockLevel: item.minStockLevel,
          }))
          .filter((item) => item.quantity <= item.minStockLevel);

        const expiringSoon = expiringSoonRaw.map((b) => ({
          itemName: b.item.name,
          batchNo: b.batchNo,
          expiryDate: b.expiryDate,
        }));

        const expired = expiredRaw.map((b) => ({
          itemName: b.item.name,
          batchNo: b.batchNo,
          expiryDate: b.expiryDate,
        }));

        await sendDailyDigestEmail({
          ownerEmail: workspace.owner.email,
          workspaceName: workspace.name,
          lowStock,
          expiringSoon,
          expired,
        });

        await prisma.workspace.update({
          where: { id: workspace.id },
          data: { lastDailyDigestSentAt: now },
        });

        logger.info("[SCHEDULER] Daily digest sent", {
          workspaceId: workspace.id,
          lowStock: lowStock.length,
          expiringSoon: expiringSoon.length,
          expired: expired.length,
        });
      } catch (err) {
        logger.warn("[SCHEDULER] Daily digest failed for workspace", {
          workspaceId: workspace.id,
          error: String(err),
        });
      }
    }
  } catch (err) {
    logger.error("[SCHEDULER] Daily digest job fatal error", { error: String(err) });
  }
}
