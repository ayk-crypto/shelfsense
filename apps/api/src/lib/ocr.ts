import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";

export interface ExtractedInvoiceLine {
  lineNumber: number;
  rawDescription: string;
  qty: number | null;
  unitPriceExclTax: number | null;
  unitPriceInclTax: number | null;
  lineTotalExclTax: number | null;
  lineTaxTotal: number | null;
  lineTotalInclTax: number | null;
  taxRate: number | null;
  discount: number | null;
  batchNo: string | null;
  expiryDate: string | null;
  sku: string | null;
  unit: string | null;
}

export interface ExtractedInvoice {
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  invoiceSubtotalExclTax: number | null;
  invoiceTaxTotal: number | null;
  invoiceTotalInclTax: number | null;
  taxMode: string | null;
  lines: ExtractedInvoiceLine[];
  rawText: string;
}

const EXTRACTION_PROMPT = `You are an invoice data extraction assistant. Extract all data from the supplier invoice and return it as JSON.

Return ONLY valid JSON in this exact format:
{
  "supplierName": string or null,
  "invoiceNumber": string or null,
  "invoiceDate": "YYYY-MM-DD" or null,
  "invoiceSubtotalExclTax": number or null,
  "invoiceTaxTotal": number or null,
  "invoiceTotalInclTax": number or null,
  "taxMode": "TAX_PER_LINE" | "TAX_PER_UNIT" | "ALLOCATED_FROM_INVOICE_TOTAL" | "TAX_INCLUSIVE_PRICE" | "NO_TAX" | null,
  "lines": [
    {
      "lineNumber": number,
      "rawDescription": string,
      "qty": number or null,
      "unitPriceExclTax": number or null,
      "unitPriceInclTax": number or null,
      "lineTotalExclTax": number or null,
      "lineTaxTotal": number or null,
      "lineTotalInclTax": number or null,
      "taxRate": number or null (as decimal, e.g. 0.18 for 18%),
      "discount": number or null,
      "batchNo": string or null,
      "expiryDate": "YYYY-MM-DD" or null,
      "sku": string or null,
      "unit": string or null
    }
  ]
}

Rules:
- taxMode detection: if invoice has per-line tax column → TAX_PER_LINE, if unit prices already include tax → TAX_INCLUSIVE_PRICE, if only invoice-total tax → ALLOCATED_FROM_INVOICE_TOTAL, if no tax at all → NO_TAX
- All monetary values must be numbers (not strings)
- For each line item, extract all available pricing/tax columns
- Include ALL line items, not just product lines (skip header/footer rows)
- Do not include null fields if they are truly not present`;

export async function isOcrAvailable(): Promise<boolean> {
  return Boolean(env.openAiApiKey);
}

async function extractWithOpenAI(
  content: { type: "image_url"; imageUrl: string } | { type: "text"; text: string },
): Promise<ExtractedInvoice> {
  const { default: OpenAI } = await import("openai");
  const openai = new OpenAI({ apiKey: env.openAiApiKey });

  const messages: Parameters<typeof openai.chat.completions.create>[0]["messages"] = [
    {
      role: "user",
      content:
        content.type === "image_url"
          ? [
              { type: "text", text: EXTRACTION_PROMPT },
              { type: "image_url", image_url: { url: content.imageUrl, detail: "high" } },
            ]
          : EXTRACTION_PROMPT + "\n\nInvoice text:\n" + content.text,
    },
  ];

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages,
    response_format: { type: "json_object" },
    max_tokens: 4096,
    temperature: 0.1,
  });

  const rawText = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(rawText) as ExtractedInvoice & { lines?: ExtractedInvoiceLine[] };
  return {
    supplierName: parsed.supplierName ?? null,
    invoiceNumber: parsed.invoiceNumber ?? null,
    invoiceDate: parsed.invoiceDate ?? null,
    invoiceSubtotalExclTax: parsed.invoiceSubtotalExclTax ?? null,
    invoiceTaxTotal: parsed.invoiceTaxTotal ?? null,
    invoiceTotalInclTax: parsed.invoiceTotalInclTax ?? null,
    taxMode: parsed.taxMode ?? null,
    lines: (parsed.lines ?? []).map((l, i) => ({
      lineNumber: l.lineNumber ?? i + 1,
      rawDescription: l.rawDescription ?? "",
      qty: l.qty ?? null,
      unitPriceExclTax: l.unitPriceExclTax ?? null,
      unitPriceInclTax: l.unitPriceInclTax ?? null,
      lineTotalExclTax: l.lineTotalExclTax ?? null,
      lineTaxTotal: l.lineTaxTotal ?? null,
      lineTotalInclTax: l.lineTotalInclTax ?? null,
      taxRate: l.taxRate ?? null,
      discount: l.discount ?? null,
      batchNo: l.batchNo ?? null,
      expiryDate: l.expiryDate ?? null,
      sku: l.sku ?? null,
      unit: l.unit ?? null,
    })),
    rawText,
  };
}

async function extractTextFromPdf(filePath: string): Promise<string> {
  try {
    // pdf-parse is CommonJS; use dynamic require via module wrapper
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require("pdf-parse");
    const buffer = fs.readFileSync(filePath);
    const result = await pdfParse(buffer);
    return result.text;
  } catch {
    return "";
  }
}

export async function extractInvoiceFromFile(
  filePath: string,
  fileType: string,
): Promise<ExtractedInvoice> {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = fileType.toLowerCase();
  const isImage = mimeType.includes("image") || [".jpg", ".jpeg", ".png", ".webp"].includes(ext);
  const isPdf = mimeType.includes("pdf") || ext === ".pdf";

  if (isImage) {
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString("base64");
    const mime = mimeType.includes("png") ? "image/png" : "image/jpeg";
    const dataUrl = `data:${mime};base64,${base64}`;
    return extractWithOpenAI({ type: "image_url", imageUrl: dataUrl });
  }

  if (isPdf) {
    const text = await extractTextFromPdf(filePath);
    if (!text.trim()) {
      throw new Error("Could not extract text from PDF. The file may be image-based. Please upload a JPG/PNG instead.");
    }
    return extractWithOpenAI({ type: "text", text });
  }

  throw new Error("Unsupported file type. Please upload a PDF, JPG, or PNG.");
}
