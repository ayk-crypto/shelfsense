import { Role } from "../generated/prisma/enums.js";
import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import { calculateNextDueDate } from "../lib/physical-count-schedule.js";

export const physicalCountSettingsRouter = Router();
physicalCountSettingsRouter.use(requireAuth);

function getWorkspaceId(req: Parameters<typeof asyncHandler>[0] extends (...args: infer A) => unknown ? A[0] : never): string | null {
  return (req as { workspaceId?: string }).workspaceId ?? null;
}

physicalCountSettingsRouter.get(
  "/",
  requireRole([Role.OWNER, Role.MANAGER, Role.OPERATOR]),
  asyncHandler(async (req, res) => {
    const workspaceId = (req as unknown as { workspaceId?: string }).workspaceId;
    if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

    const settings = await prisma.physicalCountSettings.findUnique({
      where: { workspaceId },
    });

    return res.json({ settings: settings ?? null });
  }),
);

physicalCountSettingsRouter.patch(
  "/",
  requireRole([Role.OWNER, Role.MANAGER]),
  asyncHandler(async (req, res) => {
    const workspaceId = (req as unknown as { workspaceId?: string }).workspaceId;
    if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

    const {
      enabled,
      frequencyType,
      customIntervalNumber,
      customIntervalUnit,
      reminderLeadDays,
    } = req.body as {
      enabled?: boolean;
      frequencyType?: string;
      customIntervalNumber?: number | null;
      customIntervalUnit?: string | null;
      reminderLeadDays?: number;
    };

    const VALID_FREQUENCIES = ["weekly", "biweekly", "monthly", "quarterly", "custom"];
    if (frequencyType && !VALID_FREQUENCIES.includes(frequencyType)) {
      return res.status(400).json({ error: "Invalid frequencyType" });
    }
    if (customIntervalUnit && !["days", "weeks", "months"].includes(customIntervalUnit)) {
      return res.status(400).json({ error: "Invalid customIntervalUnit" });
    }
    if (frequencyType === "custom" && (!customIntervalNumber || customIntervalNumber < 1)) {
      return res.status(400).json({ error: "Custom interval must be at least 1" });
    }

    const existing = await prisma.physicalCountSettings.findUnique({
      where: { workspaceId },
    });

    const mergedFrequencyType = frequencyType ?? existing?.frequencyType ?? "monthly";
    const mergedCustomNum = customIntervalNumber !== undefined ? customIntervalNumber : (existing?.customIntervalNumber ?? null);
    const mergedCustomUnit = customIntervalUnit !== undefined ? customIntervalUnit : (existing?.customIntervalUnit ?? null);
    const isEnabled = enabled !== undefined ? enabled : (existing?.enabled ?? true);

    const nextDueAt = isEnabled
      ? calculateNextDueDate(existing?.lastCompletedAt ?? null, {
          frequencyType: mergedFrequencyType,
          customIntervalNumber: mergedCustomNum,
          customIntervalUnit: mergedCustomUnit,
          createdAt: existing?.createdAt ?? new Date(),
        })
      : null;

    const updated = await prisma.physicalCountSettings.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        enabled: isEnabled,
        frequencyType: mergedFrequencyType,
        customIntervalNumber: mergedCustomNum,
        customIntervalUnit: mergedCustomUnit,
        reminderLeadDays: reminderLeadDays ?? 0,
        nextDueAt,
      },
      update: {
        enabled: isEnabled,
        frequencyType: mergedFrequencyType,
        customIntervalNumber: mergedCustomNum,
        customIntervalUnit: mergedCustomUnit,
        reminderLeadDays: reminderLeadDays ?? 0,
        nextDueAt,
      },
    });

    return res.json({ settings: updated });
  }),
);
