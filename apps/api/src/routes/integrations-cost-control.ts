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

  // StockBatch is the finalized inventory receipt record. It contains the effective
  // receipt/invoice unit cost and its createdAt is the actual receipt timestamp.
  // Using it prevents future receipts from leaking into historical as-of costing.
  const batches = await prisma.stockBatch.findMany({
    where: {
      workspaceId,
      createdAt: { lte: asOf },
      OR: [
        { unitCost: { not: null } },
        { unitCostInclTax: { not: null } },
        { unitCostExclTax: { not: null } },
      ],
    },
    select: {
      id: true,
      itemId: true,
      quantity: true,
      receivedQuantity: true,
      receivedUnit: true,
      unitCost: true,
      unitCostInclTax: true,
      unitCostExclTax: true,
      supplierName: true,
      createdAt: true,
      item: {
        select: {
          name: true,
          unit: true,
          purchaseUnit: true,
          purchaseConversionFactor: true,
          issueUnit: true,
        },
      },
      supplier: { select: { id: true, name: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  const latest = new Map<string, any>();
  for (const batch of batches) {
    if (!latest.has(batch.itemId)) latest.set(batch.itemId, batch);
  }

  const costs = [...latest.values()].map((batch) => {
    const effectiveUnitCost = batch.unitCost ?? batch.unitCostInclTax ?? batch.unitCostExclTax;
    const supplier = batch.supplier || (batch.supplierName ? { id: null, name: batch.supplierName } : null);
    return {
      shelfSenseItemId: batch.itemId,
      itemName: batch.item.name,
      sourceBatchId: batch.id,
      effectiveDate: batch.createdAt,
      supplier,
      receivedQuantity: batch.receivedQuantity ?? batch.quantity,
      unitCost: effectiveUnitCost,
      baseUnit: batch.item.unit,
      purchaseUnit: batch.item.purchaseUnit,
      purchaseConversionFactor: batch.item.purchaseConversionFactor,
      enteredQuantity: batch.receivedQuantity ?? null,
      enteredUnit: batch.receivedUnit || batch.item.purchaseUnit || batch.item.unit,
      storedBaseQuantity: batch.quantity,
      issueUnit: batch.item.issueUnit,
    };
  });

  res.json({ workspaceId, asOf: asOf.toISOString(), costs });
}));
