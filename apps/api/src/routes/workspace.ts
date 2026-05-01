import { Role } from "../generated/prisma/enums.js";
import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../utils/async-handler.js";

export const workspaceRouter = Router();

const DEFAULT_WORKSPACE_SETTINGS = {
  currency: "PKR",
  lowStockMultiplier: 2,
  expiryAlertDays: 7,
};

workspaceRouter.get("/settings", requireAuth, asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const settings = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      id: true,
      name: true,
      currency: true,
      lowStockMultiplier: true,
      expiryAlertDays: true,
    },
  });

  if (!settings) {
    return res.status(404).json({ error: "Workspace not found" });
  }

  return res.json({ settings: normalizeWorkspaceSettings(settings) });
}));

workspaceRouter.patch("/settings", requireAuth, requireRole([Role.OWNER]), asyncHandler(async (req, res) => {
  const workspaceId = req.user?.workspaceId ?? null;

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const input = parseWorkspaceSettingsInput(req.body);

  if (input.name === "") {
    return res.status(400).json({ error: "Business name cannot be empty" });
  }

  if (input.currency === "") {
    return res.status(400).json({ error: "Currency cannot be empty" });
  }

  if (input.lowStockMultiplier !== undefined && input.lowStockMultiplier <= 0) {
    return res.status(400).json({ error: "Low stock multiplier must be greater than zero" });
  }

  if (input.expiryAlertDays !== undefined && input.expiryAlertDays < 0) {
    return res.status(400).json({ error: "Expiry alert days cannot be negative" });
  }

  const settings = await prisma.workspace.update({
    where: { id: workspaceId },
    data: input,
    select: {
      id: true,
      name: true,
      currency: true,
      lowStockMultiplier: true,
      expiryAlertDays: true,
    },
  });

  return res.json({ settings: normalizeWorkspaceSettings(settings) });
}));

workspaceRouter.post("/create", requireAuth, asyncHandler(async (req, res) => {
  const { name } = req.body as { name?: string };

  const trimmedName = name?.trim();

  if (!trimmedName) {
    return res.status(400).json({ error: "Workspace name is required" });
  }

  const workspace = await prisma.workspace.create({
    data: {
      name: trimmedName,
      ownerId: req.user!.id,
      memberships: {
        create: {
          userId: req.user!.id,
          role: Role.OWNER,
        },
      },
    },
    include: {
      memberships: {
        where: { userId: req.user!.id },
        select: { id: true, role: true, createdAt: true },
      },
    },
  });

  return res.status(201).json({ workspace });
}));

function parseWorkspaceSettingsInput(body: unknown) {
  const input = body as {
    name?: unknown;
    currency?: unknown;
    lowStockMultiplier?: unknown;
    expiryAlertDays?: unknown;
  };

  return {
    name: parseOptionalString(input.name),
    currency: parseOptionalString(input.currency),
    lowStockMultiplier: parseOptionalNumber(input.lowStockMultiplier),
    expiryAlertDays: parseOptionalInteger(input.expiryAlertDays),
  };
}

function parseOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

function parseOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseOptionalInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function normalizeWorkspaceSettings(settings: {
  id: string;
  name: string;
  currency: string | null;
  lowStockMultiplier: number | null;
  expiryAlertDays: number | null;
}) {
  return {
    id: settings.id,
    name: settings.name,
    currency: settings.currency?.trim() || DEFAULT_WORKSPACE_SETTINGS.currency,
    lowStockMultiplier:
      typeof settings.lowStockMultiplier === "number" && settings.lowStockMultiplier > 0
        ? settings.lowStockMultiplier
        : DEFAULT_WORKSPACE_SETTINGS.lowStockMultiplier,
    expiryAlertDays:
      typeof settings.expiryAlertDays === "number" && settings.expiryAlertDays >= 0
        ? settings.expiryAlertDays
        : DEFAULT_WORKSPACE_SETTINGS.expiryAlertDays,
  };
}
