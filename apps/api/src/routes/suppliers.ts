import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";

export const suppliersRouter = Router();

suppliersRouter.use(requireAuth);

suppliersRouter.post("/", asyncHandler(async (req, res) => {
  const workspaceId = getWorkspaceId(req);

  if (!workspaceId) {
    return res.status(403).json({ error: "Workspace access required" });
  }

  const input = parseSupplierInput(req.body);

  if (!input.name) {
    return res.status(400).json({ error: "Supplier name is required" });
  }

  const supplier = await prisma.supplier.create({
    data: {
      name: input.name,
      phone: input.phone,
      notes: input.notes,
      workspaceId,
    },
  });

  return res.status(201).json({ supplier });
}));

suppliersRouter.get("/", asyncHandler(async (req, res) => {
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
