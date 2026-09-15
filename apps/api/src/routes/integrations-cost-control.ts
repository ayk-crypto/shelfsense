import crypto from "node:crypto";
import { Router } from "express";
import { prisma } from "../db/prisma.js";
import { asyncHandler } from "../utils/async-handler.js";

export const costControlIntegrationRouter = Router();

type IntegrationContext = { workspaceId: string; credentialId: string; scopes: string[] };

declare global {
  namespace Express {
    interface Request {
      integration?: IntegrationContext;
    }
  }
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function requireIntegration(req: any, res: any, next: any) {
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: "Integration token required" });

  const tokenHash = hashToken(token);
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT "id", "workspaceId", "scopes", "expiresAt", "revokedAt"
       FROM "IntegrationCredential"
      WHERE "tokenHash" = $1
      LIMIT 1`,
    tokenHash,
  );
  const c = rows[0];
  if (!c || c.revokedAt || (c.expiresAt && new Date(c.expiresAt) <= new Date())) {
    return res.status(401).json({ error: "Integration token is invalid or expired" });
  }

  req.integration = { workspaceId: c.workspaceId, credentialId: c.id, scopes: c.scopes || [] };
  await prisma.$executeRawUnsafe(
    `UPDATE "IntegrationCredential" SET "lastUsedAt" = NOW() WHERE "id" = $1::uuid`,
    c.id,
  );
  next();
}

function requireScope(scope: string) {
  return (req: any, res: any, next: any) => {
    if (!req.integration?.scopes?.includes(scope)) return res.status(403).json({ error: `Missing scope: ${scope}` });
    next();
  };
}

costControlIntegrationRouter.use(requireIntegration);

costControlIntegrationRouter.get("/items", requireScope("items:read"), asyncHandler(async (req, res) => {
  const workspaceId = req.integration!.workspaceId;
  const items = await prisma.item.findMany({
    where: { workspaceId, isActive: true },
    select: {
      id: true,
      name: true,
      sku: true,
      barcode: true,
      unit: true,
      purchaseUnit: true,
      purchaseConversionFactor: true,
      issueUnit: true,
      category: true,
      updatedAt: true,
    },
    orderBy: { name: "asc" },
  });
  res.json({ workspaceId, items });
}));

costControlIntegrationRouter.get("/costs", requireScope("costs:read"), asyncHandler(async (req, res) => {
  const workspaceId = req.integration!.workspaceId;
  const asOf = req.query.asOf ? new Date(String(req.query.asOf)) : new Date();
  if (Number.isNaN(asOf.getTime())) return res.status(400).json({ error: "Invalid asOf date" });

  const purchases = await prisma.purchaseItem.findMany({
    where: {
      purchase: {
        workspaceId,
        status: { in: ["RECEIVED", "RECEIVED_WITH_VARIANCE", "PARTIALLY_RECEIVED", "CLOSED_SHORT"] as any },
        date: { lte: asOf },
      },
      receivedQuantity: { gt: 0 },
    },
    select: {
      id: true,
      itemId: true,
      unitCost: true,
      receivedQuantity: true,
      baseUnitSnapshot: true,
      purchaseUnitSnapshot: true,
      purchaseConversionFactorSnapshot: true,
      enteredQuantity: true,
      enteredUnitSnapshot: true,
      storedBaseQuantitySnapshot: true,
      updatedAt: true,
      item: { select: { name: true, unit: true, purchaseUnit: true, purchaseConversionFactor: true, issueUnit: true } },
      purchase: { select: { id: true, date: true, receivedAt: true, supplier: { select: { id: true, name: true } } } },
    },
    orderBy: [{ purchase: { date: "desc" } }, { updatedAt: "desc" }],
  });

  const latest = new Map<string, any>();
  for (const p of purchases) if (!latest.has(p.itemId)) latest.set(p.itemId, p);

  const costs = [...latest.values()].map((p) => ({
    shelfSenseItemId: p.itemId,
    itemName: p.item.name,
    purchaseItemId: p.id,
    purchaseId: p.purchase.id,
    effectiveDate: p.purchase.receivedAt || p.purchase.date,
    supplier: p.purchase.supplier,
    receivedQuantity: p.receivedQuantity,
    unitCost: p.unitCost,
    baseUnit: p.baseUnitSnapshot || p.item.unit,
    purchaseUnit: p.purchaseUnitSnapshot || p.item.purchaseUnit,
    purchaseConversionFactor: p.purchaseConversionFactorSnapshot || p.item.purchaseConversionFactor,
    enteredQuantity: p.enteredQuantity,
    enteredUnit: p.enteredUnitSnapshot,
    storedBaseQuantity: p.storedBaseQuantitySnapshot,
  }));

  res.json({ workspaceId, asOf: asOf.toISOString(), costs });
}));
