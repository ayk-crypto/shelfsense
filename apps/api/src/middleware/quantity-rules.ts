import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db/prisma.js";
import {
  allowsFractionalQuantity,
  getQuantityUnitKind,
  isWholeQuantity,
  validateQuantityForUnit,
} from "../lib/quantity-rules.js";

type ItemRule = {
  id: string;
  unit: string;
  purchaseUnit: string | null;
  purchaseConversionFactor: number | null;
  allowFractionalPurchaseUnit: boolean;
  minStockLevel: number;
  criticalStockLevel: number | null;
  parStockLevel: number | null;
  manualReorderPointBaseQty: number | null;
  manualTargetStockBaseQty: number | null;
};

const ITEM_QUANTITY_FIELDS = [
  "minStockLevel",
  "criticalStockLevel",
  "parStockLevel",
  "manualReorderPointBaseQty",
  "manualTargetStockBaseQty",
] as const;

export async function enforceQuantityRules(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.method !== "POST" && req.method !== "PATCH" && req.method !== "PUT") {
      next();
      return;
    }

    const path = req.path;

    if (path === "/items" || /^\/items\/[^/]+$/.test(path)) {
      const error = await validateItemSettingsRequest(req);
      if (error) {
        res.status(400).json({ error, code: "INVALID_QUANTITY_INCREMENT" });
        return;
      }
      next();
      return;
    }

    if (path.startsWith("/stock/") && path !== "/stock/movements") {
      const error = await validateStockRequest(req.body as Record<string, unknown>);
      if (error) {
        res.status(400).json({ error, code: "INVALID_QUANTITY_INCREMENT" });
        return;
      }
      next();
      return;
    }

    if (path === "/purchases") {
      const error = await validatePurchaseCreateRequest(req.body as Record<string, unknown>);
      if (error) {
        res.status(400).json({ error, code: "INVALID_QUANTITY_INCREMENT" });
        return;
      }
      next();
      return;
    }

    if (/^\/purchases\/[^/]+\/receive$/.test(path)) {
      const error = await validatePurchaseReceiveRequest(req.body as Record<string, unknown>);
      if (error) {
        res.status(400).json({ error, code: "INVALID_QUANTITY_INCREMENT" });
        return;
      }
      next();
      return;
    }

    if (path === "/reorder-suggestions/create-purchases") {
      const error = await validateReorderDraftRequest(req.body as Record<string, unknown>);
      if (error) {
        res.status(400).json({ error, code: "INVALID_QUANTITY_INCREMENT" });
        return;
      }
      next();
      return;
    }

    if (path === "/stock-counts" || /^\/stock-counts\/[^/]+$/.test(path)) {
      const error = await validateStockCountRequest(req.body as Record<string, unknown>);
      if (error) {
        res.status(400).json({ error, code: "INVALID_QUANTITY_INCREMENT" });
        return;
      }
    }

    next();
  } catch (error) {
    next(error);
  }
}

async function validateItemSettingsRequest(req: Request) {
  const body = req.body as Record<string, unknown>;
  const itemId = req.path === "/items" ? null : req.path.split("/")[2] ?? null;
  const existing = itemId ? await getItemRule(itemId) : null;
  const unit = readString(body.unit) ?? existing?.unit ?? null;
  if (!unit) return null;

  for (const field of ITEM_QUANTITY_FIELDS) {
    const incoming = readNullableNumber(body[field]);
    const value = incoming.provided ? incoming.value : existing?.[field] ?? null;
    if (typeof value !== "number") continue;
    const error = validateQuantityForUnit(value, unit, true);
    if (error) return `${fieldLabel(field)}: ${error}`;
  }

  const purchaseUnit = readNullableString(body.purchaseUnit).provided
    ? readNullableString(body.purchaseUnit).value
    : existing?.purchaseUnit ?? null;
  const conversion = readNullableNumber(body.purchaseConversionFactor).provided
    ? readNullableNumber(body.purchaseConversionFactor).value
    : existing?.purchaseConversionFactor ?? null;

  if (typeof conversion === "number" && conversion > 0 && !allowsFractionalQuantity(unit, true) && !isWholeQuantity(conversion)) {
    return `One ${purchaseUnit || "purchase unit"} must contain a whole number of ${unit}.`;
  }

  if (purchaseUnit) {
    const kind = getQuantityUnitKind(purchaseUnit);
    if (kind === "WHOLE") body.allowFractionalPurchaseUnit = false;
    if (kind === "CONTINUOUS") body.allowFractionalPurchaseUnit = true;
  }

  if (existing && readString(body.unit) && readString(body.unit) !== existing.unit && !allowsFractionalQuantity(unit, true)) {
    const batches = await prisma.stockBatch.findMany({
      where: { itemId: existing.id, remainingQuantity: { not: 0 } },
      select: { remainingQuantity: true },
      take: 200,
    });
    if (batches.some((batch) => !isWholeQuantity(batch.remainingQuantity))) {
      return `Cannot change the stock unit to ${unit} while current stock contains fractional quantities.`;
    }
  }

  return null;
}

async function validateStockRequest(body: Record<string, unknown>) {
  const itemId = readString(body.itemId);
  if (!itemId) return null;
  const item = await getItemRule(itemId);
  if (!item) return null;

  const baseQuantity = readNumber(body.quantity);
  if (baseQuantity !== null) {
    const error = validateQuantityForUnit(baseQuantity, item.unit, true);
    if (error) return error;
  }

  const enteredQuantity = readNumber(body.enteredQuantity);
  const enteredUnit = readString(body.enteredUnit);
  if (enteredQuantity !== null && enteredUnit) {
    const isPurchaseUnit = Boolean(item.purchaseUnit && normalize(enteredUnit) === normalize(item.purchaseUnit));
    const error = validateQuantityForUnit(
      enteredQuantity,
      enteredUnit,
      isPurchaseUnit ? item.allowFractionalPurchaseUnit : true,
    );
    if (error) return error;
  }

  return null;
}

async function validatePurchaseCreateRequest(body: Record<string, unknown>) {
  const lines = Array.isArray(body.items) ? body.items as Array<Record<string, unknown>> : [];
  const itemIds = unique(lines.map((line) => readString(line.itemId)).filter((id): id is string => Boolean(id)));
  const itemMap = await getItemRules(itemIds);

  for (const line of lines) {
    const itemId = readString(line.itemId);
    const quantity = readNumber(line.quantity);
    const item = itemId ? itemMap.get(itemId) : null;
    if (!item || quantity === null) continue;

    const quantityUnit = readString(line.quantityUnit);
    const usesPurchaseUnit = quantityUnit === "PURCHASE_UNIT";
    const unit = usesPurchaseUnit ? item.purchaseUnit ?? item.unit : item.unit;
    const error = validateQuantityForUnit(quantity, unit, usesPurchaseUnit ? item.allowFractionalPurchaseUnit : true);
    if (error) return `${itemId}: ${error}`;
  }

  return null;
}

async function validatePurchaseReceiveRequest(body: Record<string, unknown>) {
  const lines = Array.isArray(body.lines) ? body.lines as Array<Record<string, unknown>> : [];
  const purchaseItemIds = unique(lines.map((line) => readString(line.purchaseItemId)).filter((id): id is string => Boolean(id)));
  if (purchaseItemIds.length === 0) return null;

  const purchaseItems = await prisma.purchaseItem.findMany({
    where: { id: { in: purchaseItemIds } },
    select: { id: true, item: { select: { unit: true } } },
  });
  const unitByLine = new Map(purchaseItems.map((line) => [line.id, line.item.unit]));

  for (const line of lines) {
    const purchaseItemId = readString(line.purchaseItemId);
    const quantity = readNumber(line.receivedQuantity);
    const unit = purchaseItemId ? unitByLine.get(purchaseItemId) : null;
    if (!unit || quantity === null) continue;
    const error = validateQuantityForUnit(quantity, unit, true);
    if (error) return error;
  }

  return null;
}

async function validateReorderDraftRequest(body: Record<string, unknown>) {
  const lines = Array.isArray(body.items) ? body.items as Array<Record<string, unknown>> : [];
  const itemIds = unique(lines.map((line) => readString(line.itemId)).filter((id): id is string => Boolean(id)));
  const itemMap = await getItemRules(itemIds);

  for (const line of lines) {
    const itemId = readString(line.itemId);
    const quantity = readNumber(line.quantity);
    const item = itemId ? itemMap.get(itemId) : null;
    if (!item || quantity === null) continue;
    const error = validateQuantityForUnit(quantity, item.unit, true);
    if (error) return `${item.name ?? item.id}: ${error}`;
  }

  return null;
}

async function validateStockCountRequest(body: Record<string, unknown>) {
  const lines = Array.isArray(body.items) ? body.items as Array<Record<string, unknown>> : [];
  const itemIds = unique(lines.map((line) => readString(line.itemId)).filter((id): id is string => Boolean(id)));
  const itemMap = await getItemRules(itemIds);

  for (const line of lines) {
    const itemId = readString(line.itemId);
    const quantity = readNumber(line.physicalQuantity);
    const item = itemId ? itemMap.get(itemId) : null;
    if (!item || quantity === null) continue;
    const error = validateQuantityForUnit(quantity, item.unit, true);
    if (error) return `${item.name ?? item.id}: ${error}`;
  }

  return null;
}

async function getItemRule(id: string) {
  return prisma.item.findUnique({
    where: { id },
    select: itemRuleSelect,
  });
}

async function getItemRules(ids: string[]) {
  if (ids.length === 0) return new Map<string, ItemRule & { name?: string }>();
  const items = await prisma.item.findMany({
    where: { id: { in: ids } },
    select: { ...itemRuleSelect, name: true },
  });
  return new Map(items.map((item) => [item.id, item]));
}

const itemRuleSelect = {
  id: true,
  unit: true,
  purchaseUnit: true,
  purchaseConversionFactor: true,
  allowFractionalPurchaseUnit: true,
  minStockLevel: true,
  criticalStockLevel: true,
  parStockLevel: true,
  manualReorderPointBaseQty: true,
  manualTargetStockBaseQty: true,
} as const;

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNullableString(value: unknown) {
  if (value === undefined) return { provided: false, value: null as string | null };
  if (value === null || value === "") return { provided: true, value: null as string | null };
  return { provided: true, value: readString(value) };
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNullableNumber(value: unknown) {
  if (value === undefined) return { provided: false, value: null as number | null };
  if (value === null || value === "") return { provided: true, value: null as number | null };
  return { provided: true, value: readNumber(value) };
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function fieldLabel(field: typeof ITEM_QUANTITY_FIELDS[number]) {
  switch (field) {
    case "minStockLevel": return "Low Stock Alert";
    case "criticalStockLevel": return "Emergency Stock Level";
    case "parStockLevel": return "Ideal Stock Level";
    case "manualReorderPointBaseQty": return "Manual Reorder Point";
    case "manualTargetStockBaseQty": return "Restock Target";
  }
}
