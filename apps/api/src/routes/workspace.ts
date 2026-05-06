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
  notifyLowStock: true,
  notifyExpiringSoon: true,
  notifyExpired: true,
  whatsappAlertsEnabled: false,
  emailAlertsEnabled: false,
  pushAlertsEnabled: false,
  emailLowStock: false,
  emailExpiringSoon: false,
  emailExpired: false,
  dailyDigestEnabled: false,
};

const PHONE_PATTERN = /^[+\d\s-]{7,24}$/;
const MAX_WORKSPACE_NAME_LENGTH = 160;
const MAX_CURRENCY_LENGTH = 12;

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
      ownerPhone: true,
      businessType: true,
      notifyLowStock: true,
      notifyExpiringSoon: true,
      notifyExpired: true,
      whatsappAlertsEnabled: true,
      emailAlertsEnabled: true,
      pushAlertsEnabled: true,
      emailLowStock: true,
      emailExpiringSoon: true,
      emailExpired: true,
      dailyDigestEnabled: true,
      customUnits: true,
      customCategories: true,
      customPurchaseUnits: true,
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

  if (input.name && input.name.length > MAX_WORKSPACE_NAME_LENGTH) {
    return res.status(400).json({ error: "Business name must be 160 characters or fewer" });
  }

  if (input.currency === "") {
    return res.status(400).json({ error: "Currency cannot be empty" });
  }

  if (input.currency && input.currency.length > MAX_CURRENCY_LENGTH) {
    return res.status(400).json({ error: "Currency must be 12 characters or fewer" });
  }

  if (input.lowStockMultiplier !== undefined && input.lowStockMultiplier <= 0) {
    return res.status(400).json({ error: "Low stock multiplier must be greater than zero" });
  }

  if (input.expiryAlertDays !== undefined && input.expiryAlertDays < 0) {
    return res.status(400).json({ error: "Expiry alert days cannot be negative" });
  }

  if (input.ownerPhone !== undefined && input.ownerPhone !== null && !isValidPhone(input.ownerPhone)) {
    return res.status(400).json({ error: "Owner phone can include only +, digits, spaces, and hyphen" });
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
      ownerPhone: true,
      businessType: true,
      notifyLowStock: true,
      notifyExpiringSoon: true,
      notifyExpired: true,
      whatsappAlertsEnabled: true,
      emailAlertsEnabled: true,
      pushAlertsEnabled: true,
      emailLowStock: true,
      emailExpiringSoon: true,
      emailExpired: true,
      dailyDigestEnabled: true,
      customUnits: true,
      customCategories: true,
      customPurchaseUnits: true,
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

  if (trimmedName.length > MAX_WORKSPACE_NAME_LENGTH) {
    return res.status(400).json({ error: "Workspace name must be 160 characters or fewer" });
  }

  const existingActiveMembership = await prisma.membership.findFirst({
    where: {
      userId: req.user!.id,
      isActive: true,
    },
    select: { id: true },
  });

  if (existingActiveMembership) {
    return res.status(409).json({ error: "User already has workspace access" });
  }

  const workspace = await prisma.workspace.create({
    data: {
      name: trimmedName,
      ownerId: req.user!.id,
      locations: {
        create: {
          name: "Main Branch",
        },
      },
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

const MAX_LIST_ITEMS = 100;
const MAX_LIST_ITEM_LENGTH = 40;

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v.length > 0 && v.length <= MAX_LIST_ITEM_LENGTH);
  return [...new Set(cleaned)].slice(0, MAX_LIST_ITEMS);
}

interface WorkspaceSettingsInput {
  name?: string;
  currency?: string;
  lowStockMultiplier?: number;
  expiryAlertDays?: number;
  ownerPhone?: string | null;
  businessType?: string | null;
  notifyLowStock?: boolean;
  notifyExpiringSoon?: boolean;
  notifyExpired?: boolean;
  whatsappAlertsEnabled?: boolean;
  emailAlertsEnabled?: boolean;
  pushAlertsEnabled?: boolean;
  emailLowStock?: boolean;
  emailExpiringSoon?: boolean;
  emailExpired?: boolean;
  dailyDigestEnabled?: boolean;
  customUnits?: string[];
  customCategories?: string[];
  customPurchaseUnits?: string[];
}

function parseWorkspaceSettingsInput(body: unknown): WorkspaceSettingsInput {
  const raw = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const result: WorkspaceSettingsInput = {};

  const name = parseOptionalString(raw["name"]);
  if (name !== undefined) result.name = name;

  const currency = parseOptionalString(raw["currency"]);
  if (currency !== undefined) result.currency = currency;

  const lowStockMultiplier = parseOptionalNumber(raw["lowStockMultiplier"]);
  if (lowStockMultiplier !== undefined) result.lowStockMultiplier = lowStockMultiplier;

  const expiryAlertDays = parseOptionalInteger(raw["expiryAlertDays"]);
  if (expiryAlertDays !== undefined) result.expiryAlertDays = expiryAlertDays;

  const ownerPhone = parseOptionalNullableString(raw["ownerPhone"]);
  if (ownerPhone !== undefined) result.ownerPhone = ownerPhone;

  const businessType = parseOptionalNullableString(raw["businessType"]);
  if (businessType !== undefined) result.businessType = businessType;

  const notifyLowStock = parseOptionalBoolean(raw["notifyLowStock"]);
  if (notifyLowStock !== undefined) result.notifyLowStock = notifyLowStock;

  const notifyExpiringSoon = parseOptionalBoolean(raw["notifyExpiringSoon"]);
  if (notifyExpiringSoon !== undefined) result.notifyExpiringSoon = notifyExpiringSoon;

  const notifyExpired = parseOptionalBoolean(raw["notifyExpired"]);
  if (notifyExpired !== undefined) result.notifyExpired = notifyExpired;

  const whatsappAlertsEnabled = parseOptionalBoolean(raw["whatsappAlertsEnabled"]);
  if (whatsappAlertsEnabled !== undefined) result.whatsappAlertsEnabled = whatsappAlertsEnabled;

  const emailAlertsEnabled = parseOptionalBoolean(raw["emailAlertsEnabled"]);
  if (emailAlertsEnabled !== undefined) result.emailAlertsEnabled = emailAlertsEnabled;

  const pushAlertsEnabled = parseOptionalBoolean(raw["pushAlertsEnabled"]);
  if (pushAlertsEnabled !== undefined) result.pushAlertsEnabled = pushAlertsEnabled;

  const emailLowStock = parseOptionalBoolean(raw["emailLowStock"]);
  if (emailLowStock !== undefined) result.emailLowStock = emailLowStock;

  const emailExpiringSoon = parseOptionalBoolean(raw["emailExpiringSoon"]);
  if (emailExpiringSoon !== undefined) result.emailExpiringSoon = emailExpiringSoon;

  const emailExpired = parseOptionalBoolean(raw["emailExpired"]);
  if (emailExpired !== undefined) result.emailExpired = emailExpired;

  const dailyDigestEnabled = parseOptionalBoolean(raw["dailyDigestEnabled"]);
  if (dailyDigestEnabled !== undefined) result.dailyDigestEnabled = dailyDigestEnabled;

  const units = parseStringArray(raw["customUnits"]);
  if (units !== undefined) result.customUnits = units;

  const cats = parseStringArray(raw["customCategories"]);
  if (cats !== undefined) result.customCategories = cats;

  const purchaseUnits = parseStringArray(raw["customPurchaseUnits"]);
  if (purchaseUnits !== undefined) result.customPurchaseUnits = purchaseUnits;

  return result;
}

function parseOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

function parseOptionalNullableString(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || null;
}

function parseOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseOptionalInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function parseOptionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function isValidPhone(value: string) {
  return PHONE_PATTERN.test(value) && /\d{7,}/.test(value.replace(/\D/g, ""));
}

function normalizeWorkspaceSettings(settings: {
  id: string;
  name: string;
  currency: string | null;
  lowStockMultiplier: number | null;
  expiryAlertDays: number | null;
  ownerPhone: string | null;
  businessType: string | null;
  notifyLowStock: boolean | null;
  notifyExpiringSoon: boolean | null;
  notifyExpired: boolean | null;
  whatsappAlertsEnabled: boolean | null;
  emailAlertsEnabled: boolean | null;
  pushAlertsEnabled: boolean | null;
  emailLowStock: boolean | null;
  emailExpiringSoon: boolean | null;
  emailExpired: boolean | null;
  dailyDigestEnabled: boolean | null;
  customUnits?: string[];
  customCategories?: string[];
  customPurchaseUnits?: string[];
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
    ownerPhone: settings.ownerPhone?.trim() || null,
    businessType: settings.businessType?.trim() || null,
    notifyLowStock: settings.notifyLowStock ?? DEFAULT_WORKSPACE_SETTINGS.notifyLowStock,
    notifyExpiringSoon: settings.notifyExpiringSoon ?? DEFAULT_WORKSPACE_SETTINGS.notifyExpiringSoon,
    notifyExpired: settings.notifyExpired ?? DEFAULT_WORKSPACE_SETTINGS.notifyExpired,
    whatsappAlertsEnabled: settings.whatsappAlertsEnabled ?? DEFAULT_WORKSPACE_SETTINGS.whatsappAlertsEnabled,
    emailAlertsEnabled: settings.emailAlertsEnabled ?? DEFAULT_WORKSPACE_SETTINGS.emailAlertsEnabled,
    pushAlertsEnabled: settings.pushAlertsEnabled ?? DEFAULT_WORKSPACE_SETTINGS.pushAlertsEnabled,
    emailLowStock: settings.emailLowStock ?? DEFAULT_WORKSPACE_SETTINGS.emailLowStock,
    emailExpiringSoon: settings.emailExpiringSoon ?? DEFAULT_WORKSPACE_SETTINGS.emailExpiringSoon,
    emailExpired: settings.emailExpired ?? DEFAULT_WORKSPACE_SETTINGS.emailExpired,
    dailyDigestEnabled: settings.dailyDigestEnabled ?? DEFAULT_WORKSPACE_SETTINGS.dailyDigestEnabled,
    customUnits: settings.customUnits ?? [],
    customCategories: settings.customCategories ?? [],
    customPurchaseUnits: settings.customPurchaseUnits ?? [],
  };
}
