import path from "path";
import fs from "fs";
import { Router } from "express";
import multer from "multer";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../utils/async-handler.js";
import { prisma } from "../db/prisma.js";
import { extractInvoiceFromFile, isOcrAvailable } from "../lib/ocr.js";
import { autoDetectAndNormalize } from "../lib/tax-normalizer.js";
import { findBestMatch } from "../lib/invoice-matcher.js";
import { Role } from "../generated/prisma/enums.js";
import { Prisma } from "../generated/prisma/client.js";

const UPLOAD_DIR = path.resolve("uploads/invoices");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `invoice-${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error("Only PDF, JPG, and PNG files are accepted"));
  },
});

export const receivingRouter = Router();

function mapInvoiceLine(line: Record<string, unknown>) {
  return {
    id: line.id,
    invoiceUploadId: line.invoiceUploadId,
    lineNumber: line.lineNumber,
    rawDescription: line.rawDescription,
    normalizedDescription: line.normalizedDescription,
    extractedQty: line.extractedQty,
    extractedUnitCostExclTax: line.extractedUnitCostExclTax,
    extractedUnitTax: line.extractedUnitTax,
    extractedUnitCostInclTax: line.extractedUnitCostInclTax,
    extractedLineSubtotalExclTax: line.extractedLineSubtotalExclTax,
    extractedLineTaxTotal: line.extractedLineTaxTotal,
    extractedLineTotalInclTax: line.extractedLineTotalInclTax,
    extractedTaxRate: line.extractedTaxRate,
    extractedBatchNo: line.extractedBatchNo,
    extractedExpiryDate: line.extractedExpiryDate,
    taxMode: line.taxMode,
    suggestedInventoryItemId: line.suggestedInventoryItemId,
    matchedPurchaseItemId: line.matchedPurchaseItemId,
    confidenceScore: line.confidenceScore,
    matchStatus: line.matchStatus,
    userConfirmedItemId: line.userConfirmedItemId,
    userConfirmedPurchaseItemId: line.userConfirmedPurchaseItemId,
    userEditedQty: line.userEditedQty,
    userEditedUnitCostExclTax: line.userEditedUnitCostExclTax,
    userEditedUnitTax: line.userEditedUnitTax,
    userEditedUnitCostInclTax: line.userEditedUnitCostInclTax,
    userEditedBatchNo: line.userEditedBatchNo,
    userEditedExpiryDate: line.userEditedExpiryDate,
    userAction: line.userAction,
    createdAt: line.createdAt,
    updatedAt: line.updatedAt,
  };
}

function mapInvoiceUpload(upload: Record<string, unknown>) {
  return {
    id: upload.id,
    workspaceId: upload.workspaceId,
    purchaseOrderId: upload.purchaseOrderId,
    supplierId: upload.supplierId,
    fileName: upload.fileName,
    fileType: upload.fileType,
    fileSize: upload.fileSize,
    ocrStatus: upload.ocrStatus,
    invoiceNumber: upload.invoiceNumber,
    invoiceDate: upload.invoiceDate,
    supplierName: upload.supplierName,
    invoiceSubtotalExclTax: upload.invoiceSubtotalExclTax,
    invoiceTaxTotal: upload.invoiceTaxTotal,
    invoiceTotalInclTax: upload.invoiceTotalInclTax,
    taxMode: upload.taxMode,
    duplicateWarning: upload.duplicateWarning,
    createdAt: upload.createdAt,
    updatedAt: upload.updatedAt,
  };
}

function mapInvoiceUploadFull(upload: Record<string, unknown> & { invoiceLines?: unknown[] }) {
  return {
    ...mapInvoiceUpload(upload),
    invoiceLines: (upload.invoiceLines ?? []).map((l) => mapInvoiceLine(l as Record<string, unknown>)),
  };
}

function getWorkspaceId(req: import("express").Request): string | null {
  return req.user?.workspaceId ?? null;
}

receivingRouter.get("/ocr-status", requireAuth, asyncHandler(async (_req, res) => {
  return res.json({ available: await isOcrAvailable() });
}));

receivingRouter.post(
  "/invoices/upload",
  requireAuth,
  requireRole([Role.OWNER, Role.MANAGER]),
  upload.single("invoice"),
  asyncHandler(async (req, res) => {
    const workspaceId = getWorkspaceId(req);
    if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const purchaseOrderId =
      typeof req.body.purchaseOrderId === "string" && req.body.purchaseOrderId.trim()
        ? req.body.purchaseOrderId.trim()
        : null;

    const invoiceUpload = await prisma.supplierInvoiceUpload.create({
      data: {
        workspaceId,
        purchaseOrderId,
        uploadedById: req.user!.userId,
        fileName: req.file.originalname,
        fileType: req.file.mimetype,
        fileSize: req.file.size,
        filePath: req.file.path,
        ocrStatus: "UPLOADED",
      },
    });

    return res.status(201).json({ invoiceUpload: mapInvoiceUpload(invoiceUpload as unknown as Record<string, unknown>) });
  }),
);

receivingRouter.post(
  "/invoices/:id/extract",
  requireAuth,
  requireRole([Role.OWNER, Role.MANAGER]),
  asyncHandler(async (req, res) => {
    const workspaceId = getWorkspaceId(req);
    if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

    const invoiceUpload = await prisma.supplierInvoiceUpload.findFirst({
      where: { id: req.params.id, workspaceId },
    });
    if (!invoiceUpload) return res.status(404).json({ error: "Invoice upload not found" });

    if (!(await isOcrAvailable())) {
      return res.status(422).json({
        error: "OCR_NOT_AVAILABLE",
        message: "AI extraction is not configured. Please enter invoice lines manually.",
      });
    }

    await prisma.supplierInvoiceUpload.update({
      where: { id: invoiceUpload.id },
      data: { ocrStatus: "PROCESSING" },
    });

    try {
      const extracted = await extractInvoiceFromFile(invoiceUpload.filePath, invoiceUpload.fileType);

      const invoiceTaxContext =
        extracted.invoiceSubtotalExclTax != null && extracted.invoiceTaxTotal != null
          ? {
              invoiceSubtotalExclTax: extracted.invoiceSubtotalExclTax,
              invoiceTaxTotal: extracted.invoiceTaxTotal,
            }
          : undefined;

      let duplicateWarning = false;
      if (extracted.invoiceNumber) {
        const existing = await prisma.supplierInvoiceUpload.findFirst({
          where: {
            workspaceId,
            invoiceNumber: extracted.invoiceNumber,
            id: { not: invoiceUpload.id },
          },
          select: { id: true },
        });
        duplicateWarning = !!existing;
      }

      await prisma.supplierInvoiceLine.deleteMany({ where: { invoiceUploadId: invoiceUpload.id } });

      for (let idx = 0; idx < extracted.lines.length; idx++) {
        const line = extracted.lines[idx];
        const rawLine = {
          qty: line.qty ?? 1,
          unitPriceExclTax: line.unitPriceExclTax,
          unitPriceInclTax: line.unitPriceInclTax,
          lineTotalExclTax: line.lineTotalExclTax,
          lineTaxTotal: line.lineTaxTotal,
          lineTotalInclTax: line.lineTotalInclTax,
          taxRate: line.taxRate,
        };
        const normalized = autoDetectAndNormalize(rawLine, invoiceTaxContext);

        await prisma.supplierInvoiceLine.create({
          data: {
            invoiceUploadId: invoiceUpload.id,
            lineNumber: line.lineNumber ?? idx + 1,
            rawDescription: line.rawDescription,
            normalizedDescription: line.rawDescription.toLowerCase().trim(),
            extractedQty: line.qty,
            extractedUnitCostExclTax: normalized.unitCostExclTax || null,
            extractedUnitTax: normalized.unitTax || null,
            extractedUnitCostInclTax: normalized.unitCostInclTax || null,
            extractedLineSubtotalExclTax: normalized.lineSubtotalExclTax || null,
            extractedLineTaxTotal: normalized.lineTaxTotal || null,
            extractedLineTotalInclTax: normalized.lineTotalInclTax || null,
            extractedTaxRate: normalized.taxRate,
            extractedBatchNo: line.batchNo,
            extractedExpiryDate: line.expiryDate ? new Date(line.expiryDate) : null,
            taxMode: normalized.taxMode as import("../generated/prisma/enums.js").TaxMode,
          },
        });
      }

      const updatedUpload = await prisma.supplierInvoiceUpload.update({
        where: { id: invoiceUpload.id },
        data: {
          ocrStatus: "EXTRACTED",
          extractedRawText: extracted.rawText?.slice(0, 10000) ?? null,
          extractedJson: extracted as unknown as Prisma.InputJsonValue,
          invoiceNumber: extracted.invoiceNumber,
          invoiceDate: extracted.invoiceDate ? new Date(extracted.invoiceDate) : null,
          supplierName: extracted.supplierName,
          invoiceSubtotalExclTax: extracted.invoiceSubtotalExclTax,
          invoiceTaxTotal: extracted.invoiceTaxTotal,
          invoiceTotalInclTax: extracted.invoiceTotalInclTax,
          taxMode: (extracted.taxMode as import("../generated/prisma/enums.js").TaxMode | null) ?? null,
          duplicateWarning,
        },
        include: { invoiceLines: { orderBy: { lineNumber: "asc" } } },
      });

      return res.json({
        invoiceUpload: mapInvoiceUploadFull(updatedUpload as unknown as Record<string, unknown> & { invoiceLines: unknown[] }),
      });
    } catch (err: unknown) {
      await prisma.supplierInvoiceUpload.update({
        where: { id: invoiceUpload.id },
        data: { ocrStatus: "FAILED" },
      });
      const message = err instanceof Error ? err.message : "Extraction failed";
      return res.status(422).json({ error: "OCR_FAILED", message });
    }
  }),
);

receivingRouter.post(
  "/invoices/:id/match",
  requireAuth,
  asyncHandler(async (req, res) => {
    const workspaceId = getWorkspaceId(req);
    if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

    const invoiceUpload = await prisma.supplierInvoiceUpload.findFirst({
      where: { id: req.params.id, workspaceId },
      include: { invoiceLines: { orderBy: { lineNumber: "asc" } } },
    });
    if (!invoiceUpload) return res.status(404).json({ error: "Invoice upload not found" });

    const purchaseOrderId =
      (typeof req.body.purchaseOrderId === "string" ? req.body.purchaseOrderId : null) ??
      invoiceUpload.purchaseOrderId;

    let poItems: Array<{
      id: string;
      itemId: string;
      item: { id: string; name: string; sku: string | null; barcode: string | null; unit: string };
    }> = [];

    if (purchaseOrderId) {
      const purchase = await prisma.purchase.findFirst({
        where: { id: purchaseOrderId, workspaceId },
        include: {
          purchaseItems: {
            include: { item: { select: { id: true, name: true, sku: true, barcode: true, unit: true } } },
          },
        },
      });
      if (purchase) poItems = purchase.purchaseItems;
    }

    const aliases = await prisma.supplierItemAlias.findMany({
      where: { workspaceId },
      select: { invoiceItemName: true, normalizedInvoiceItemName: true, inventoryItemId: true, confidenceBoost: true },
    });

    const poItemIds = new Set(poItems.map((p) => p.itemId));
    const candidates = poItems.map((p) => ({
      id: p.itemId,
      name: p.item.name,
      sku: p.item.sku,
      barcode: p.item.barcode,
      unit: p.item.unit,
    }));

    for (const line of invoiceUpload.invoiceLines) {
      const match = findBestMatch(line.rawDescription, candidates, aliases, poItemIds);
      const matchedPurchaseItem = match ? poItems.find((p) => p.itemId === match.itemId) ?? null : null;

      await prisma.supplierInvoiceLine.update({
        where: { id: line.id },
        data: {
          suggestedInventoryItemId: match?.itemId ?? null,
          matchedPurchaseItemId: matchedPurchaseItem?.id ?? null,
          confidenceScore: match?.confidenceScore ?? null,
          matchStatus: (match?.matchStatus ?? "UNMATCHED") as import("../generated/prisma/enums.js").InvoiceLineMatchStatus,
        },
      });
    }

    const updatedUpload = await prisma.supplierInvoiceUpload.findFirst({
      where: { id: invoiceUpload.id },
      include: { invoiceLines: { orderBy: { lineNumber: "asc" } } },
    });

    return res.json({
      invoiceUpload: mapInvoiceUploadFull(updatedUpload as unknown as Record<string, unknown> & { invoiceLines: unknown[] }),
    });
  }),
);

receivingRouter.patch(
  "/invoice-lines/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const workspaceId = getWorkspaceId(req);
    if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

    const line = await prisma.supplierInvoiceLine.findFirst({
      where: { id: req.params.id, invoiceUpload: { workspaceId } },
    });
    if (!line) return res.status(404).json({ error: "Invoice line not found" });

    const body = req.body as Record<string, unknown>;
    const parseNum = (v: unknown) => (v !== undefined && v !== null ? Number(v) : undefined);
    const parseStr = (v: unknown) => (typeof v === "string" ? v.trim() || null : undefined);

    const updated = await prisma.supplierInvoiceLine.update({
      where: { id: line.id },
      data: {
        userConfirmedItemId: typeof body.userConfirmedItemId === "string" ? body.userConfirmedItemId : line.userConfirmedItemId,
        userConfirmedPurchaseItemId: typeof body.userConfirmedPurchaseItemId === "string" ? body.userConfirmedPurchaseItemId : line.userConfirmedPurchaseItemId,
        userEditedQty: parseNum(body.userEditedQty) ?? line.userEditedQty,
        userEditedUnitCostExclTax: parseNum(body.userEditedUnitCostExclTax) ?? line.userEditedUnitCostExclTax,
        userEditedUnitTax: parseNum(body.userEditedUnitTax) ?? line.userEditedUnitTax,
        userEditedUnitCostInclTax: parseNum(body.userEditedUnitCostInclTax) ?? line.userEditedUnitCostInclTax,
        userEditedBatchNo: parseStr(body.userEditedBatchNo) ?? line.userEditedBatchNo,
        userEditedExpiryDate: body.userEditedExpiryDate ? new Date(body.userEditedExpiryDate as string) : line.userEditedExpiryDate,
        userAction: typeof body.userAction === "string" ? body.userAction : line.userAction,
        matchStatus: body.matchStatus
          ? (body.matchStatus as import("../generated/prisma/enums.js").InvoiceLineMatchStatus)
          : line.matchStatus,
      },
    });

    return res.json({ line: mapInvoiceLine(updated as unknown as Record<string, unknown>) });
  }),
);

receivingRouter.get(
  "/invoices/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const workspaceId = getWorkspaceId(req);
    if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

    const invoiceUpload = await prisma.supplierInvoiceUpload.findFirst({
      where: { id: req.params.id, workspaceId },
      include: { invoiceLines: { orderBy: { lineNumber: "asc" } } },
    });
    if (!invoiceUpload) return res.status(404).json({ error: "Invoice upload not found" });

    return res.json({
      invoiceUpload: mapInvoiceUploadFull(invoiceUpload as unknown as Record<string, unknown> & { invoiceLines: unknown[] }),
    });
  }),
);

receivingRouter.post(
  "/invoices/:id/lines",
  requireAuth,
  requireRole([Role.OWNER, Role.MANAGER]),
  asyncHandler(async (req, res) => {
    const workspaceId = getWorkspaceId(req);
    if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

    const invoiceUpload = await prisma.supplierInvoiceUpload.findFirst({
      where: { id: req.params.id, workspaceId },
      include: { invoiceLines: { select: { id: true } } },
    });
    if (!invoiceUpload) return res.status(404).json({ error: "Invoice upload not found" });

    const body = req.body as {
      rawDescription?: string;
      qty?: number;
      unitCostExclTax?: number;
      unitTax?: number;
      unitCostInclTax?: number;
      batchNo?: string;
      expiryDate?: string;
      taxMode?: string;
    };

    if (!body.rawDescription?.trim()) {
      return res.status(400).json({ error: "rawDescription is required" });
    }

    const nextLineNumber = (invoiceUpload.invoiceLines.length ?? 0) + 1;
    const taxMode = (body.taxMode as import("../generated/prisma/enums.js").TaxMode | undefined) ?? "NO_TAX";

    const line = await prisma.supplierInvoiceLine.create({
      data: {
        invoiceUploadId: invoiceUpload.id,
        lineNumber: nextLineNumber,
        rawDescription: body.rawDescription.trim(),
        normalizedDescription: body.rawDescription.trim().toLowerCase(),
        extractedQty: body.qty ?? null,
        extractedUnitCostExclTax: body.unitCostExclTax ?? null,
        extractedUnitTax: body.unitTax ?? null,
        extractedUnitCostInclTax: body.unitCostInclTax ?? null,
        extractedBatchNo: body.batchNo ?? null,
        extractedExpiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
        taxMode,
        userEditedQty: body.qty ?? null,
        userEditedUnitCostExclTax: body.unitCostExclTax ?? null,
        userEditedUnitTax: body.unitTax ?? null,
        userEditedUnitCostInclTax: body.unitCostInclTax ?? null,
      },
    });

    await prisma.supplierInvoiceUpload.update({
      where: { id: invoiceUpload.id },
      data: { ocrStatus: "EXTRACTED" },
    });

    return res.status(201).json({ line: mapInvoiceLine(line as unknown as Record<string, unknown>) });
  }),
);

receivingRouter.delete(
  "/invoice-lines/:id",
  requireAuth,
  requireRole([Role.OWNER, Role.MANAGER]),
  asyncHandler(async (req, res) => {
    const workspaceId = getWorkspaceId(req);
    if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

    const line = await prisma.supplierInvoiceLine.findFirst({
      where: { id: req.params.id, invoiceUpload: { workspaceId } },
    });
    if (!line) return res.status(404).json({ error: "Invoice line not found" });

    await prisma.supplierInvoiceLine.delete({ where: { id: line.id } });
    return res.json({ ok: true });
  }),
);

receivingRouter.post(
  "/aliases",
  requireAuth,
  asyncHandler(async (req, res) => {
    const workspaceId = getWorkspaceId(req);
    if (!workspaceId) return res.status(403).json({ error: "Workspace access required" });

    const { invoiceItemName, inventoryItemId, supplierId } = req.body as {
      invoiceItemName?: string;
      inventoryItemId?: string;
      supplierId?: string | null;
    };

    if (!invoiceItemName?.trim() || !inventoryItemId?.trim()) {
      return res.status(400).json({ error: "invoiceItemName and inventoryItemId are required" });
    }

    const normalizedName = invoiceItemName
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const existing = await prisma.supplierItemAlias.findFirst({
      where: { workspaceId, supplierId: supplierId ?? null, normalizedInvoiceItemName: normalizedName },
    });

    if (existing) {
      await prisma.supplierItemAlias.update({
        where: { id: existing.id },
        data: { inventoryItemId, lastConfirmedAt: new Date(), confirmedById: req.user!.userId },
      });
    } else {
      await prisma.supplierItemAlias.create({
        data: {
          workspaceId,
          supplierId: supplierId ?? null,
          invoiceItemName: invoiceItemName.trim(),
          normalizedInvoiceItemName: normalizedName,
          inventoryItemId,
          lastConfirmedAt: new Date(),
          confirmedById: req.user!.userId,
        },
      });
    }

    return res.json({ ok: true });
  }),
);
