import cron from "node-cron";
import { prisma } from "../db/prisma.js";
import { logger } from "../lib/logger.js";
import {
  sendLowStockAlertEmail,
  sendExpirySoonAlertEmail,
  sendDailyDigestEmail,
  sendPhysicalCountReminderEmail,
} from "../services/email.js";
import { daysUntilDue } from "../lib/physical-count-schedule.js";

const LOW_STOCK_EMAIL_COOLDOWN_HOURS = 4;
const EXPIRY_EMAIL_COOLDOWN_HOURS = 4;

export function startAlertScheduler(): void {
  cron.schedule("0 */4 * * *", () => void runLowStockJob());
  cron.schedule("0 2,6,10,14,18,22 * * *", () => void runExpirySoonJob());
  cron.schedule("0 8 * * *", () => void runDailyDigestJob());
  cron.schedule("0 9 * * *", () => void runPhysicalCountReminderJob());

  logger.info(
    "[SCHEDULER] Alert scheduler started — low stock every 4h, expiry every 4h (offset), daily digest at 08:00, physical count reminder at 09:00",
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
            criticalStockLevel: true,
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
            minStockLevel: item.criticalStockLevel ?? item.minStockLevel,
          }))
          .filter((item) => item.minStockLevel > 0 && item.quantity <= item.minStockLevel);

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

async function runPhysicalCountReminderJob(): Promise<void> {
  logger.info("[SCHEDULER] Running physical count reminder job");
  try {
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const settingsRecords = await prisma.physicalCountSettings.findMany({
      where: {
        enabled: true,
        nextDueAt: { not: null },
      },
      include: {
        workspace: {
          select: {
            id: true,
            name: true,
            owner: { select: { email: true } },
            emailAlertsEnabled: true,
          },
        },
      },
    });

    logger.info(`[SCHEDULER] Physical count reminder: ${settingsRecords.length} configured workspace(s)`);

    for (const rec of settingsRecords) {
      try {
        if (!rec.nextDueAt) continue;

        const nextDue = new Date(rec.nextDueAt);
        const days = daysUntilDue(nextDue);
        const leadDays = rec.reminderLeadDays ?? 0;

        // Trigger condition: days <= leadDays (includes overdue: days < 0)
        if (days > leadDays) continue;

        // Dedup: only send once per day
        if (rec.lastReminderSentAt) {
          const lastSentMidnight = new Date(rec.lastReminderSentAt);
          lastSentMidnight.setHours(0, 0, 0, 0);
          if (lastSentMidnight.getTime() === todayMidnight.getTime()) continue;
        }

        const workspaceId = rec.workspaceId;

        // Check no active count already in progress
        const activeCount = await prisma.stockCount.findFirst({
          where: { workspaceId, status: "DRAFT" },
          select: { id: true },
        });
        if (activeCount) {
          logger.info("[SCHEDULER] Skipping reminder — active count exists", { workspaceId });
          continue;
        }

        // Create in-app notification for the workspace owner
        const owner = await prisma.user.findFirst({
          where: {
            ownedSpaces: { some: { id: workspaceId } },
          },
          select: { id: true },
        });

        if (owner) {
          let title: string;
          let message: string;
          if (days < 0) {
            const overdue = Math.abs(days);
            title = "Physical count overdue";
            message = `Physical inventory count is overdue by ${overdue} day${overdue !== 1 ? "s" : ""}. Please start a new count.`;
          } else if (days === 0) {
            title = "Physical count due today";
            message = "Physical inventory count is due today. Start a count to verify stock accuracy.";
          } else {
            title = `Physical count due in ${days} days`;
            message = `Physical inventory count is due in ${days} day${days !== 1 ? "s" : ""}. Plan ahead to avoid disruptions.`;
          }

          await prisma.notification.create({
            data: {
              workspaceId,
              userId: owner.id,
              type: "PHYSICAL_COUNT_REMINDER",
              title,
              message,
              entity: "PhysicalCountSettings",
              entityId: rec.id,
            },
          }).catch(() => {}); // ignore duplicate errors
        }

        // Send email if alerts are enabled
        if (rec.workspace.emailAlertsEnabled) {
          await sendPhysicalCountReminderEmail({
            ownerEmail: rec.workspace.owner.email,
            workspaceName: rec.workspace.name,
            workspaceId,
            daysUntilDue: days,
            nextDueAt: nextDue,
          });
        }

        // Mark reminder sent
        await prisma.physicalCountSettings.update({
          where: { id: rec.id },
          data: { lastReminderSentAt: now },
        });

        logger.info("[SCHEDULER] Physical count reminder sent", { workspaceId, days });
      } catch (err) {
        logger.warn("[SCHEDULER] Physical count reminder failed for workspace", {
          workspaceId: rec.workspaceId,
          error: String(err),
        });
      }
    }
  } catch (err) {
    logger.error("[SCHEDULER] Physical count reminder job fatal error", { error: String(err) });
  }
}
