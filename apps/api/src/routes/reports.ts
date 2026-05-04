import { Router } from "express";
import type { Response } from "express";
import { prisma } from "../db/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/require-permission.js";
import { asyncHandler } from "../utils/async-handler.js";

export const reportsRouter = Router();

// ─── Shared utilities ────────────────────────────────────────────────────────

const MAX_ROWS = 1000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface ReportFilters {
  locationId?: string;
  itemId?: string;
  category?: string;
  supplierId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

function parseFilters(q: Record<string, unknown>): ReportFilters {
  const f: ReportFilters = {};
  if (typeof q.locationId === "string" && q.locationId) f.locationId = q.locationId;
  if (typeof q.itemId === "string" && q.itemId) f.itemId = q.itemId;
  if (typeof q.category === "string" && q.category) f.category = q.category;
  if (typeof q.supplierId === "string" && q.supplierId) f.supplierId = q.supplierId;
  if (typeof q.dateFrom === "string" && q.dateFrom) {
    const d = new Date(q.dateFrom + "T00:00:00.000Z");
    if (!isNaN(d.getTime())) f.dateFrom = d;
  }
  if (typeof q.dateTo === "string" && q.dateTo) {
    const d = new Date(q.dateTo + "T23:59:59.999Z");
    if (!isNaN(d.getTime())) f.dateTo = d;
  }
  return f;
}

function dateRange(f: ReportFilters) {
  if (!f.dateFrom && !f.dateTo) return undefined;
  return {
    ...(f.dateFrom ? { gte: f.dateFrom } : {}),
    ...(f.dateTo ? { lte: f.dateTo } : {}),
  };
}

function isCsv(q: Record<string, unknown>): boolean {
  return q.format === "csv";
}

type CsvCell = string | number | boolean | null | undefined;

function buildCsv(rows: CsvCell[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const s = cell == null ? "" : String(cell);
          return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\r\n");
}

function sendCsv(res: Response, filename: string, rows: CsvCell[][]): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buildCsv(rows));
}

// ─── 1. Inventory Valuation ───────────────────────────────────────────────────
// Current stock value: remaining batches × unit cost, grouped by item.

reportsRouter.get(
  "/inventory-valuation",
  requireAuth,
  requirePermission("reports:export"),
  asyncHandler(async (req, res) => {
    const workspaceId = req.user!.workspaceId!;
    const f = parseFilters(req.query as Record<string, unknown>);
    const dr = dateRange(f);

    const batches = await prisma.stockBatch.findMany({
      where: {
        workspaceId,
        remainingQuantity: { gt: 0 },
        ...(f.locationId ? { locationId: f.locationId } : {}),
        ...(f.itemId ? { itemId: f.itemId } : {}),
        ...(dr ? { createdAt: dr } : {}),
      },
      select: {
        itemId: true,
        remainingQuantity: true,
        unitCost: true,
        item: { select: { name: true, category: true, unit: true, sku: true } },
      },
      take: MAX_ROWS * 10,
    });

    const filtered = f.category
      ? batches.filter((b) => (b.item.category ?? "Uncategorized") === f.category)
      : batches;

    type Entry = { name: string; cat: string; unit: string; sku: string | null; qty: number; wtCost: number; batches: number };
    const map = new Map<string, Entry>();
    for (const b of filtered) {
      const e: Entry = map.get(b.itemId) ?? { name: b.item.name, cat: b.item.category ?? "Uncategorized", unit: b.item.unit, sku: b.item.sku, qty: 0, wtCost: 0, batches: 0 };
      e.qty += b.remainingQuantity;
      e.wtCost += b.remainingQuantity * (b.unitCost ?? 0);
      e.batches += 1;
      map.set(b.itemId, e);
    }

    const rows = Array.from(map.entries())
      .map(([itemId, v]) => ({
        itemId,
        itemName: v.name,
        category: v.cat,
        unit: v.unit,
        sku: v.sku,
        totalQuantity: round2(v.qty),
        avgUnitCost: v.qty > 0 ? round2(v.wtCost / v.qty) : 0,
        totalValue: round2(v.wtCost),
        batchCount: v.batches,
      }))
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, MAX_ROWS);

    const summary = {
      totalItems: rows.length,
      totalQuantity: round2(rows.reduce((s, r) => s + r.totalQuantity, 0)),
      totalValue: round2(rows.reduce((s, r) => s + r.totalValue, 0)),
    };

    if (isCsv(req.query as Record<string, unknown>)) {
      return sendCsv(res, "inventory-valuation.csv", [
        ["Item Name", "Category", "SKU", "Unit", "Total Quantity", "Avg Unit Cost", "Total Value", "Active Batches"],
        ...rows.map((r) => [r.itemName, r.category, r.sku ?? "", r.unit, r.totalQuantity, r.avgUnitCost, r.totalValue, r.batchCount]),
      ]);
    }
    return res.json({ summary, rows, generatedAt: new Date() });
  }),
);

// ─── 2. Wastage Cost ──────────────────────────────────────────────────────────
// WASTAGE movements aggregated by item — quantities and imputed cost.

reportsRouter.get(
  "/wastage-cost",
  requireAuth,
  requirePermission("reports:export"),
  asyncHandler(async (req, res) => {
    const workspaceId = req.user!.workspaceId!;
    const f = parseFilters(req.query as Record<string, unknown>);
    const dr = dateRange(f);

    const movements = await prisma.stockMovement.findMany({
      where: {
        workspaceId,
        type: "WASTAGE",
        ...(f.locationId ? { locationId: f.locationId } : {}),
        ...(f.itemId ? { itemId: f.itemId } : {}),
        ...(dr ? { createdAt: dr } : {}),
      },
      select: {
        itemId: true,
        quantity: true,
        unitCost: true,
        item: { select: { name: true, category: true, unit: true } },
      },
      take: MAX_ROWS * 5,
    });

    const filtered = f.category
      ? movements.filter((m) => (m.item.category ?? "Uncategorized") === f.category)
      : movements;

    type Entry = { name: string; cat: string; unit: string; qty: number; value: number; count: number };
    const map = new Map<string, Entry>();
    for (const m of filtered) {
      const e: Entry = map.get(m.itemId) ?? { name: m.item.name, cat: m.item.category ?? "Uncategorized", unit: m.item.unit, qty: 0, value: 0, count: 0 };
      e.qty += m.quantity;
      e.value += m.quantity * (m.unitCost ?? 0);
      e.count += 1;
      map.set(m.itemId, e);
    }

    const rows = Array.from(map.entries())
      .map(([itemId, v]) => ({
        itemId,
        itemName: v.name,
        category: v.cat,
        unit: v.unit,
        totalQuantity: round2(v.qty),
        totalValue: round2(v.value),
        movementCount: v.count,
      }))
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, MAX_ROWS);

    const summary = {
      totalItems: rows.length,
      totalQuantity: round2(rows.reduce((s, r) => s + r.totalQuantity, 0)),
      totalValue: round2(rows.reduce((s, r) => s + r.totalValue, 0)),
    };

    if (isCsv(req.query as Record<string, unknown>)) {
      return sendCsv(res, "wastage-cost.csv", [
        ["Item Name", "Category", "Unit", "Total Wasted Qty", "Total Wasted Value", "Event Count"],
        ...rows.map((r) => [r.itemName, r.category, r.unit, r.totalQuantity, r.totalValue, r.movementCount]),
      ]);
    }
    return res.json({ summary, rows, generatedAt: new Date() });
  }),
);

// ─── 3. Usage by Item / Category ──────────────────────────────────────────────
// STOCK_OUT movements aggregated by item — how much of each item was consumed.

reportsRouter.get(
  "/usage",
  requireAuth,
  requirePermission("reports:export"),
  asyncHandler(async (req, res) => {
    const workspaceId = req.user!.workspaceId!;
    const f = parseFilters(req.query as Record<string, unknown>);
    const dr = dateRange(f);

    const movements = await prisma.stockMovement.findMany({
      where: {
        workspaceId,
        type: "STOCK_OUT",
        ...(f.locationId ? { locationId: f.locationId } : {}),
        ...(f.itemId ? { itemId: f.itemId } : {}),
        ...(dr ? { createdAt: dr } : {}),
      },
      select: {
        itemId: true,
        quantity: true,
        createdAt: true,
        item: { select: { name: true, category: true, unit: true } },
        location: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS * 5,
    });

    const filtered = f.category
      ? movements.filter((m) => (m.item.category ?? "Uncategorized") === f.category)
      : movements;

    type Entry = { name: string; cat: string; unit: string; qty: number; count: number; lastUsed: Date };
    const map = new Map<string, Entry>();
    for (const m of filtered) {
      const e: Entry = map.get(m.itemId) ?? { name: m.item.name, cat: m.item.category ?? "Uncategorized", unit: m.item.unit, qty: 0, count: 0, lastUsed: m.createdAt };
      e.qty += m.quantity;
      e.count += 1;
      if (m.createdAt > e.lastUsed) e.lastUsed = m.createdAt;
      map.set(m.itemId, e);
    }

    const rows = Array.from(map.entries())
      .map(([itemId, v]) => ({
        itemId,
        itemName: v.name,
        category: v.cat,
        unit: v.unit,
        totalQuantity: round2(v.qty),
        movementCount: v.count,
        lastUsed: v.lastUsed.toISOString(),
      }))
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .slice(0, MAX_ROWS);

    const summary = {
      totalItems: rows.length,
      totalQuantity: round2(rows.reduce((s, r) => s + r.totalQuantity, 0)),
      totalMovements: rows.reduce((s, r) => s + r.movementCount, 0),
    };

    if (isCsv(req.query as Record<string, unknown>)) {
      return sendCsv(res, "usage-by-item.csv", [
        ["Item Name", "Category", "Unit", "Total Used", "Movement Count", "Last Used"],
        ...rows.map((r) => [r.itemName, r.category, r.unit, r.totalQuantity, r.movementCount, r.lastUsed]),
      ]);
    }
    return res.json({ summary, rows, generatedAt: new Date() });
  }),
);

// ─── 4. Supplier Spend ────────────────────────────────────────────────────────
// Purchase orders (non-draft, non-cancelled) aggregated by supplier.

reportsRouter.get(
  "/supplier-spend",
  requireAuth,
  requirePermission("reports:export"),
  asyncHandler(async (req, res) => {
    const workspaceId = req.user!.workspaceId!;
    const f = parseFilters(req.query as Record<string, unknown>);
    const dr = dateRange(f);

    const purchases = await prisma.purchase.findMany({
      where: {
        workspaceId,
        status: { notIn: ["DRAFT", "CANCELLED"] },
        ...(f.supplierId ? { supplierId: f.supplierId } : {}),
        ...(f.locationId ? { locationId: f.locationId } : {}),
        ...(dr ? { date: dr } : {}),
      },
      select: {
        supplierId: true,
        totalAmount: true,
        date: true,
        supplier: { select: { name: true } },
      },
      orderBy: { date: "desc" },
      take: MAX_ROWS * 5,
    });

    type Entry = { name: string; orders: number; spend: number; lastDate: Date | null };
    const map = new Map<string, Entry>();
    for (const p of purchases) {
      const e: Entry = map.get(p.supplierId) ?? { name: p.supplier.name, orders: 0, spend: 0, lastDate: null };
      e.orders += 1;
      e.spend += p.totalAmount;
      if (!e.lastDate || p.date > e.lastDate) e.lastDate = p.date;
      map.set(p.supplierId, e);
    }

    const rows = Array.from(map.entries())
      .map(([supplierId, v]) => ({
        supplierId,
        supplierName: v.name,
        orderCount: v.orders,
        totalSpend: round2(v.spend),
        avgOrderValue: v.orders > 0 ? round2(v.spend / v.orders) : 0,
        lastOrderDate: v.lastDate ? v.lastDate.toISOString() : null,
      }))
      .sort((a, b) => b.totalSpend - a.totalSpend)
      .slice(0, MAX_ROWS);

    const summary = {
      totalSuppliers: rows.length,
      totalOrders: rows.reduce((s, r) => s + r.orderCount, 0),
      totalSpend: round2(rows.reduce((s, r) => s + r.totalSpend, 0)),
    };

    if (isCsv(req.query as Record<string, unknown>)) {
      return sendCsv(res, "supplier-spend.csv", [
        ["Supplier", "Order Count", "Total Spend", "Avg Order Value", "Last Order Date"],
        ...rows.map((r) => [r.supplierName, r.orderCount, r.totalSpend, r.avgOrderValue, r.lastOrderDate ?? ""]),
      ]);
    }
    return res.json({ summary, rows, generatedAt: new Date() });
  }),
);

// ─── 5. Stock Aging ───────────────────────────────────────────────────────────
// Open batches with remaining quantity, sorted oldest-first to highlight stale stock.

reportsRouter.get(
  "/stock-aging",
  requireAuth,
  requirePermission("reports:export"),
  asyncHandler(async (req, res) => {
    const workspaceId = req.user!.workspaceId!;
    const f = parseFilters(req.query as Record<string, unknown>);

    const batches = await prisma.stockBatch.findMany({
      where: {
        workspaceId,
        remainingQuantity: { gt: 0 },
        ...(f.locationId ? { locationId: f.locationId } : {}),
        ...(f.itemId ? { itemId: f.itemId } : {}),
      },
      select: {
        id: true,
        batchNo: true,
        quantity: true,
        remainingQuantity: true,
        unitCost: true,
        createdAt: true,
        item: { select: { name: true, category: true, unit: true } },
        location: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
      take: MAX_ROWS,
    });

    const filtered = f.category
      ? batches.filter((b) => (b.item.category ?? "Uncategorized") === f.category)
      : batches;

    const now = Date.now();
    const rows = filtered
      .map((b) => {
        const ageDays = Math.floor((now - b.createdAt.getTime()) / 86_400_000);
        return {
          batchId: b.id,
          batchNo: b.batchNo,
          itemName: b.item.name,
          category: b.item.category ?? "Uncategorized",
          unit: b.item.unit,
          location: b.location.name,
          originalQty: b.quantity,
          remainingQty: b.remainingQuantity,
          unitCost: b.unitCost ?? 0,
          totalValue: round2(b.remainingQuantity * (b.unitCost ?? 0)),
          ageDays,
          receivedAt: b.createdAt.toISOString(),
        };
      })
      .sort((a, b) => b.ageDays - a.ageDays);

    const summary = {
      totalBatches: rows.length,
      totalValue: round2(rows.reduce((s, r) => s + r.totalValue, 0)),
      avgAgeDays: rows.length > 0 ? Math.round(rows.reduce((s, r) => s + r.ageDays, 0) / rows.length) : 0,
    };

    if (isCsv(req.query as Record<string, unknown>)) {
      return sendCsv(res, "stock-aging.csv", [
        ["Item Name", "Category", "Unit", "Location", "Batch No", "Original Qty", "Remaining Qty", "Unit Cost", "Total Value", "Age (Days)", "Received At"],
        ...rows.map((r) => [r.itemName, r.category, r.unit, r.location, r.batchNo ?? "", r.originalQty, r.remainingQty, r.unitCost, r.totalValue, r.ageDays, r.receivedAt]),
      ]);
    }
    return res.json({ summary, rows, generatedAt: new Date() });
  }),
);

// ─── 6. Expiry Loss ───────────────────────────────────────────────────────────
// Batches that have already expired but still have remaining quantity — potential write-off value.

reportsRouter.get(
  "/expiry-loss",
  requireAuth,
  requirePermission("reports:export"),
  asyncHandler(async (req, res) => {
    const workspaceId = req.user!.workspaceId!;
    const f = parseFilters(req.query as Record<string, unknown>);

    const now = new Date();

    // Date filters apply to expiryDate range — useful to scope "which month's expiries"
    const expiryWhere = {
      lt: now,
      ...(f.dateFrom ? { gte: f.dateFrom } : {}),
      ...(f.dateTo ? { lte: f.dateTo } : {}),
    };

    const batches = await prisma.stockBatch.findMany({
      where: {
        workspaceId,
        remainingQuantity: { gt: 0 },
        expiryDate: expiryWhere,
        ...(f.locationId ? { locationId: f.locationId } : {}),
        ...(f.itemId ? { itemId: f.itemId } : {}),
      },
      select: {
        id: true,
        batchNo: true,
        remainingQuantity: true,
        unitCost: true,
        expiryDate: true,
        item: { select: { name: true, category: true, unit: true } },
        location: { select: { name: true } },
      },
      orderBy: { expiryDate: "asc" },
      take: MAX_ROWS,
    });

    const filtered = f.category
      ? batches.filter((b) => (b.item.category ?? "Uncategorized") === f.category)
      : batches;

    const rows = filtered
      .map((b) => {
        const daysExpired = Math.floor((now.getTime() - b.expiryDate!.getTime()) / 86_400_000);
        return {
          batchId: b.id,
          batchNo: b.batchNo,
          itemName: b.item.name,
          category: b.item.category ?? "Uncategorized",
          unit: b.item.unit,
          location: b.location.name,
          remainingQty: b.remainingQuantity,
          unitCost: b.unitCost ?? 0,
          potentialLoss: round2(b.remainingQuantity * (b.unitCost ?? 0)),
          expiryDate: b.expiryDate!.toISOString(),
          daysExpired,
        };
      })
      .sort((a, b) => b.potentialLoss - a.potentialLoss);

    const summary = {
      totalBatches: rows.length,
      totalExpiredQty: round2(rows.reduce((s, r) => s + r.remainingQty, 0)),
      totalPotentialLoss: round2(rows.reduce((s, r) => s + r.potentialLoss, 0)),
    };

    if (isCsv(req.query as Record<string, unknown>)) {
      return sendCsv(res, "expiry-loss.csv", [
        ["Item Name", "Category", "Unit", "Location", "Batch No", "Remaining Qty", "Unit Cost", "Potential Loss", "Expiry Date", "Days Expired"],
        ...rows.map((r) => [r.itemName, r.category, r.unit, r.location, r.batchNo ?? "", r.remainingQty, r.unitCost, r.potentialLoss, r.expiryDate, r.daysExpired]),
      ]);
    }
    return res.json({ summary, rows, generatedAt: new Date() });
  }),
);

// ─── 7. Adjustment Variance ───────────────────────────────────────────────────
// ADJUSTMENT movements grouped by item — positive (gains) vs negative (shrinkage).

reportsRouter.get(
  "/adjustment-variance",
  requireAuth,
  requirePermission("reports:export"),
  asyncHandler(async (req, res) => {
    const workspaceId = req.user!.workspaceId!;
    const f = parseFilters(req.query as Record<string, unknown>);
    const dr = dateRange(f);

    const movements = await prisma.stockMovement.findMany({
      where: {
        workspaceId,
        type: "ADJUSTMENT",
        ...(f.locationId ? { locationId: f.locationId } : {}),
        ...(f.itemId ? { itemId: f.itemId } : {}),
        ...(dr ? { createdAt: dr } : {}),
      },
      select: {
        itemId: true,
        quantity: true,
        item: { select: { name: true, category: true, unit: true } },
      },
      take: MAX_ROWS * 5,
    });

    const filtered = f.category
      ? movements.filter((m) => (m.item.category ?? "Uncategorized") === f.category)
      : movements;

    type Entry = { name: string; cat: string; unit: string; pos: number; neg: number; count: number };
    const map = new Map<string, Entry>();
    for (const m of filtered) {
      const e: Entry = map.get(m.itemId) ?? { name: m.item.name, cat: m.item.category ?? "Uncategorized", unit: m.item.unit, pos: 0, neg: 0, count: 0 };
      if (m.quantity >= 0) e.pos += m.quantity;
      else e.neg += Math.abs(m.quantity);
      e.count += 1;
      map.set(m.itemId, e);
    }

    const rows = Array.from(map.entries())
      .map(([itemId, v]) => ({
        itemId,
        itemName: v.name,
        category: v.cat,
        unit: v.unit,
        positiveAdj: round2(v.pos),
        negativeAdj: round2(v.neg),
        netVariance: round2(v.pos - v.neg),
        movementCount: v.count,
      }))
      .sort((a, b) => Math.abs(b.netVariance) - Math.abs(a.netVariance))
      .slice(0, MAX_ROWS);

    const summary = {
      totalItems: rows.length,
      totalPositive: round2(rows.reduce((s, r) => s + r.positiveAdj, 0)),
      totalNegative: round2(rows.reduce((s, r) => s + r.negativeAdj, 0)),
      netVariance: round2(rows.reduce((s, r) => s + r.netVariance, 0)),
    };

    if (isCsv(req.query as Record<string, unknown>)) {
      return sendCsv(res, "adjustment-variance.csv", [
        ["Item Name", "Category", "Unit", "Positive Adj", "Negative Adj", "Net Variance", "Event Count"],
        ...rows.map((r) => [r.itemName, r.category, r.unit, r.positiveAdj, r.negativeAdj, r.netVariance, r.movementCount]),
      ]);
    }
    return res.json({ summary, rows, generatedAt: new Date() });
  }),
);

// ─── 8. Transfer History ──────────────────────────────────────────────────────
// All TRANSFER_IN / TRANSFER_OUT movements — raw rows, newest first.

reportsRouter.get(
  "/transfers",
  requireAuth,
  requirePermission("reports:export"),
  asyncHandler(async (req, res) => {
    const workspaceId = req.user!.workspaceId!;
    const f = parseFilters(req.query as Record<string, unknown>);
    const dr = dateRange(f);

    const movements = await prisma.stockMovement.findMany({
      where: {
        workspaceId,
        type: { in: ["TRANSFER_IN", "TRANSFER_OUT"] },
        ...(f.locationId ? { locationId: f.locationId } : {}),
        ...(f.itemId ? { itemId: f.itemId } : {}),
        ...(dr ? { createdAt: dr } : {}),
      },
      select: {
        id: true,
        type: true,
        quantity: true,
        note: true,
        createdAt: true,
        item: { select: { name: true, category: true, unit: true } },
        location: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
    });

    const filtered = f.category
      ? movements.filter((m) => (m.item.category ?? "Uncategorized") === f.category)
      : movements;

    const rows = filtered.map((m) => ({
      id: m.id,
      createdAt: m.createdAt.toISOString(),
      itemName: m.item.name,
      category: m.item.category ?? "Uncategorized",
      unit: m.item.unit,
      type: m.type as "TRANSFER_IN" | "TRANSFER_OUT",
      quantity: m.quantity,
      location: m.location.name,
      note: m.note,
    }));

    const summary = {
      totalTransfers: rows.length,
      totalInQty: round2(rows.filter((r) => r.type === "TRANSFER_IN").reduce((s, r) => s + r.quantity, 0)),
      totalOutQty: round2(rows.filter((r) => r.type === "TRANSFER_OUT").reduce((s, r) => s + r.quantity, 0)),
    };

    if (isCsv(req.query as Record<string, unknown>)) {
      return sendCsv(res, "transfer-history.csv", [
        ["Date", "Item Name", "Category", "Unit", "Type", "Quantity", "Location", "Note"],
        ...rows.map((r) => [r.createdAt, r.itemName, r.category, r.unit, r.type, r.quantity, r.location, r.note ?? ""]),
      ]);
    }
    return res.json({ summary, rows, generatedAt: new Date() });
  }),
);
