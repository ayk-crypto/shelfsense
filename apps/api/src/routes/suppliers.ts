import { Router } from "express";
import { Role } from "../generated/prisma/enums.js";
import { prisma } from "../db/prisma.js";
import { requireActiveWorkspace, requireAuth, requireRole } from "../middleware/auth.js";
import { requirePlanFeature } from "../middleware/require-plan-feature.js";
import { asyncHandler } from "../utils/async-handler.js";
import { logAction } from "../utils/audit-log.js";

export const suppliersRouter = Router();

suppliersRouter.use(requireAuth);
suppliersRouter.use(requireActiveWorkspace);
suppliersRouter.use(requirePlanFeature("enableSuppliers"));

const MAX_SUPPLIER_NAME_LENGTH = 120;
const MAX_SUPPLIER_PHONE_LENGTH = 32;
const MAX_SUPPLIER_NOTES_LENGTH = 1000;

suppliersRouter.post("/", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const input = parseSupplierInput(req.body);

  if (!input.name) {
    return res.status(400).json({ error: "Supplier name is required" });
  }

  if (input.name.length > MAX_SUPPLIER_NAME_LENGTH) {
    return res.status(400).json({ error: "Supplier name must be 120 characters or fewer" });
  }

  if (input.phone && input.phone.length > MAX_SUPPLIER_PHONE_LENGTH) {
    return res.status(400).json({ error: "Supplier phone must be 32 characters or fewer" });
  }

  if (input.notes && input.notes.length > MAX_SUPPLIER_NOTES_LENGTH) {
    return res.status(400).json({ error: "Supplier notes must be 1000 characters or fewer" });
  }

  const supplier = await prisma.supplier.create({
    data: {
      name: input.name,
      phone: input.phone,
      notes: input.notes,
      workspaceId,
    },
  });

  await logAction({
    userId: req.user!.userId,
    workspaceId,
    action: "CREATE_SUPPLIER",
    entity: "Supplier",
    entityId: supplier.id,
    meta: {
      supplierName: supplier.name,
    },
  });

  return res.status(201).json({ supplier });
}));

suppliersRouter.get("/", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const suppliers = await prisma.supplier.findMany({
    where: { workspaceId },
    orderBy: { name: "asc" },
  });

  return res.json({ suppliers });
}));

suppliersRouter.patch("/:id", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const { id } = req.params;
  const existing = await prisma.supplier.findFirst({ where: { id, workspaceId }, select: { id: true } });
  if (!existing) return res.status(404).json({ error: "Supplier not found" });

  const input = parseSupplierInput(req.body);

  if (input.name !== undefined && !input.name) {
    return res.status(400).json({ error: "Supplier name is required" });
  }
  if (input.name && input.name.length > MAX_SUPPLIER_NAME_LENGTH) {
    return res.status(400).json({ error: "Supplier name must be 120 characters or fewer" });
  }
  if (input.phone && input.phone.length > MAX_SUPPLIER_PHONE_LENGTH) {
    return res.status(400).json({ error: "Supplier phone must be 32 characters or fewer" });
  }
  if (input.notes && input.notes.length > MAX_SUPPLIER_NOTES_LENGTH) {
    return res.status(400).json({ error: "Supplier notes must be 1000 characters or fewer" });
  }

  const supplier = await prisma.supplier.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.phone !== undefined && { phone: input.phone }),
      ...(input.notes !== undefined && { notes: input.notes }),
    },
  });

  await logAction({
    userId: req.user!.userId,
    workspaceId,
    action: "UPDATE_SUPPLIER",
    entity: "Supplier",
    entityId: supplier.id,
    meta: { supplierName: supplier.name },
  });

  return res.json({ supplier });
}));

suppliersRouter.delete("/:id", requireRole([Role.OWNER, Role.MANAGER]), asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

  const { id } = req.params;
  const existing = await prisma.supplier.findFirst({
    where: { id, workspaceId },
    select: { id: true, name: true },
  });
  if (!existing) return res.status(404).json({ error: "Supplier not found" });

  await prisma.supplier.delete({ where: { id } });

  await logAction({
    userId: req.user!.userId,
    workspaceId,
    action: "DELETE_SUPPLIER",
    entity: "Supplier",
    entityId: id,
    meta: { supplierName: existing.name },
  });

  return res.json({ success: true });
}));

function getWorkspaceId(req: Express.Request) {
  return req.user?.workspaceId ?? null;
}

function parseSupplierInput(body: unknown) {
  const input = body as {
    name?: unknown;
    phone?: unknown;
    notes?: unknown;
  };

  return {
    name: parseOptionalString(input.name),
    phone: parseNullableString(input.phone),
    notes: parseNullableString(input.notes),
  };
}

function parseOptionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined;
}

function parseNullableString(value: unknown) {
  if (value === null) {
    return null;
  }

  const parsed = parseOptionalString(value);
  return parsed === "" ? null : parsed;
}
