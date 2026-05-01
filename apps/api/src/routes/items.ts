import { Router } from "express";
import { Role } from "../generated/prisma/enums.js";
import { prisma } from "../db/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";

export const itemsRouter = Router();

itemsRouter.use(requireAuth);

itemsRouter.post("/", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const data = parseItemInput(req.body);

  if (!data.name || !data.unit) {
    return res.status(400).json({ error: "Name and unit are required" });
  }

  if (data.barcode) {
    const duplicate = await findDuplicateBarcode(workspaceId, data.barcode);

    if (duplicate) {
      return res.status(400).json({
        error: "Barcode already exists for another item.",
      });
    }
  }

  const item = await prisma.item.create({
    data: {
      ...data,
      name: data.name,
      unit: data.unit,
      workspaceId,
    },
  });

  return res.status(201).json({ item });
}));

itemsRouter.get("/", requireRole([Role.OWNER, Role.MANAGER, Role.OPERATOR]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const items = await prisma.item.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
  });

  return res.json({ items });
}));

itemsRouter.get("/:id", requireRole([Role.OWNER, Role.MANAGER, Role.OPERATOR]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const item = await prisma.item.findFirst({
    where: { id: req.params.id, workspaceId },
  });

  if (!item) {
    return res.status(404).json({ error: "Item not found" });
  }

  return res.json({ item });
}));

itemsRouter.patch("/:id", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const data = parseItemInput(req.body);

  if (data.name === "" || data.unit === "") {
    return res.status(400).json({ error: "Name and unit cannot be empty" });
  }

  if (data.barcode) {
    const duplicate = await findDuplicateBarcode(
      workspaceId,
      data.barcode,
      req.params.id,
    );

    if (duplicate) {
      return res.status(400).json({
        error: "Barcode already exists for another item.",
      });
    }
  }

  const result = await prisma.item.updateMany({
    where: { id: req.params.id, workspaceId },
    data,
  });

  if (result.count === 0) {
    return res.status(404).json({ error: "Item not found" });
  }

  const item = await prisma.item.findFirst({
    where: { id: req.params.id, workspaceId },
  });

  return res.json({ item });
}));

itemsRouter.delete("/:id", requireRole([Role.OWNER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const result = await prisma.item.deleteMany({
    where: { id: req.params.id, workspaceId },
  });

  if (result.count === 0) {
    return res.status(404).json({ error: "Item not found" });
  }

  return res.status(204).send();
}));

function getWorkspaceId(req: Express.Request) {
  return req.user?.workspaceId ?? null;
}

async function findDuplicateBarcode(
  workspaceId: string,
  barcode: string,
  excludingItemId?: string,
) {
  return prisma.item.findFirst({
    where: {
      workspaceId,
      barcode,
      id: excludingItemId ? { not: excludingItemId } : undefined,
    },
    select: { id: true },
  });
}

function parseItemInput(body: unknown) {
  const input = body as {
    name?: unknown;
    sku?: unknown;
    barcode?: unknown;
    unit?: unknown;
    category?: unknown;
    minStockLevel?: unknown;
    trackExpiry?: unknown;
  };

  return {
    name: parseOptionalString(input.name),
    sku: parseNullableString(input.sku),
    barcode: parseNullableString(input.barcode),
    unit: parseOptionalString(input.unit),
    category: parseNullableString(input.category),
    minStockLevel:
      typeof input.minStockLevel === "number" ? input.minStockLevel : undefined,
    trackExpiry:
      typeof input.trackExpiry === "boolean" ? input.trackExpiry : undefined,
  };
}

function parseOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

function parseNullableString(value: unknown) {
  if (value === null) {
    return null;
  }

  return typeof value === "string" ? value.trim() : undefined;
}
