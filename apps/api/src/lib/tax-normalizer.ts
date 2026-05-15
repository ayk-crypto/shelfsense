export type TaxMode =
  | "TAX_PER_UNIT"
  | "TAX_PER_LINE"
  | "ALLOCATED_FROM_INVOICE_TOTAL"
  | "TAX_INCLUSIVE_PRICE"
  | "NO_TAX";

export interface NormalizedLineCost {
  taxMode: TaxMode;
  unitCostExclTax: number;
  unitTax: number;
  unitCostInclTax: number;
  lineSubtotalExclTax: number;
  lineTaxTotal: number;
  lineTotalInclTax: number;
  taxRate: number | null;
  allocated: boolean;
}

export interface RawInvoiceLine {
  qty: number;
  unitPriceExclTax?: number | null;
  unitPriceInclTax?: number | null;
  lineTotalExclTax?: number | null;
  lineTaxTotal?: number | null;
  lineTotalInclTax?: number | null;
  taxRate?: number | null;
}

export interface InvoiceLevelTax {
  invoiceSubtotalExclTax: number;
  invoiceTaxTotal: number;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function normalizeTaxPerUnit(line: RawInvoiceLine): NormalizedLineCost {
  const qty = line.qty || 1;
  const unitCostExclTax = line.unitPriceExclTax ?? 0;
  const unitTax = line.lineTaxTotal != null ? line.lineTaxTotal / qty : 0;
  const unitCostInclTax = unitCostExclTax + unitTax;
  const lineSubtotalExclTax = round4(unitCostExclTax * qty);
  const lineTaxTotal = round4(unitTax * qty);
  const lineTotalInclTax = round4(lineSubtotalExclTax + lineTaxTotal);
  const taxRate = unitCostExclTax > 0 ? round4(unitTax / unitCostExclTax) : null;
  return { taxMode: "TAX_PER_UNIT", unitCostExclTax, unitTax: round4(unitTax), unitCostInclTax: round4(unitCostInclTax), lineSubtotalExclTax, lineTaxTotal, lineTotalInclTax, taxRate, allocated: false };
}

export function normalizeTaxPerLine(line: RawInvoiceLine): NormalizedLineCost {
  const qty = line.qty || 1;
  const unitCostExclTax = line.unitPriceExclTax ?? (line.lineTotalExclTax != null ? line.lineTotalExclTax / qty : 0);
  const lineTaxTotal = line.lineTaxTotal ?? 0;
  const lineTotalInclTax = line.lineTotalInclTax ?? ((line.lineTotalExclTax ?? 0) + lineTaxTotal);
  const unitTax = round4(lineTaxTotal / qty);
  const unitCostInclTax = round4(lineTotalInclTax / qty);
  const lineSubtotalExclTax = round4(unitCostExclTax * qty);
  const taxRate = unitCostExclTax > 0 ? round4(unitTax / unitCostExclTax) : null;
  return { taxMode: "TAX_PER_LINE", unitCostExclTax: round4(unitCostExclTax), unitTax, unitCostInclTax, lineSubtotalExclTax, lineTaxTotal: round4(lineTaxTotal), lineTotalInclTax: round4(lineTotalInclTax), taxRate, allocated: false };
}

export function normalizeTaxAllocatedFromInvoice(
  line: RawInvoiceLine,
  invoiceTax: InvoiceLevelTax,
): NormalizedLineCost {
  const qty = line.qty || 1;
  const unitCostExclTax = line.unitPriceExclTax ?? (line.lineTotalExclTax != null ? line.lineTotalExclTax / qty : 0);
  const lineSubtotalExclTax = round4(unitCostExclTax * qty);
  const allocatedLineTax = invoiceTax.invoiceSubtotalExclTax > 0
    ? round4((lineSubtotalExclTax / invoiceTax.invoiceSubtotalExclTax) * invoiceTax.invoiceTaxTotal)
    : 0;
  const unitTax = round4(allocatedLineTax / qty);
  const unitCostInclTax = round4(unitCostExclTax + unitTax);
  const lineTotalInclTax = round4(lineSubtotalExclTax + allocatedLineTax);
  const taxRate = unitCostExclTax > 0 ? round4(unitTax / unitCostExclTax) : null;
  return { taxMode: "ALLOCATED_FROM_INVOICE_TOTAL", unitCostExclTax: round4(unitCostExclTax), unitTax, unitCostInclTax, lineSubtotalExclTax, lineTaxTotal: allocatedLineTax, lineTotalInclTax, taxRate, allocated: true };
}

export function normalizeTaxInclusivePrice(line: RawInvoiceLine): NormalizedLineCost {
  const qty = line.qty || 1;
  const unitCostInclTax = line.unitPriceInclTax ?? line.unitPriceExclTax ?? 0;
  const taxRate = line.taxRate ?? null;
  let unitCostExclTax: number;
  let unitTax: number;
  if (taxRate != null && taxRate > 0) {
    unitCostExclTax = round4(unitCostInclTax / (1 + taxRate));
    unitTax = round4(unitCostInclTax - unitCostExclTax);
  } else {
    unitCostExclTax = unitCostInclTax;
    unitTax = 0;
  }
  const lineSubtotalExclTax = round4(unitCostExclTax * qty);
  const lineTaxTotal = round4(unitTax * qty);
  const lineTotalInclTax = round4(unitCostInclTax * qty);
  return { taxMode: "TAX_INCLUSIVE_PRICE", unitCostExclTax, unitTax, unitCostInclTax: round4(unitCostInclTax), lineSubtotalExclTax, lineTaxTotal, lineTotalInclTax, taxRate, allocated: false };
}

export function normalizeTaxNone(line: RawInvoiceLine): NormalizedLineCost {
  const qty = line.qty || 1;
  const unitCostExclTax = line.unitPriceExclTax ?? line.unitPriceInclTax ?? 0;
  const lineSubtotalExclTax = round4(unitCostExclTax * qty);
  return { taxMode: "NO_TAX", unitCostExclTax: round4(unitCostExclTax), unitTax: 0, unitCostInclTax: round4(unitCostExclTax), lineSubtotalExclTax, lineTaxTotal: 0, lineTotalInclTax: lineSubtotalExclTax, taxRate: 0, allocated: false };
}

export function autoDetectAndNormalize(
  line: RawInvoiceLine,
  invoiceTax?: InvoiceLevelTax,
): NormalizedLineCost {
  if (line.lineTaxTotal != null && line.qty > 0 && line.lineTotalInclTax != null) {
    return normalizeTaxPerLine(line);
  }
  if (line.unitPriceInclTax != null && line.unitPriceExclTax == null) {
    return normalizeTaxInclusivePrice({ ...line, unitPriceInclTax: line.unitPriceInclTax });
  }
  if (invoiceTax && line.lineTaxTotal == null) {
    return normalizeTaxAllocatedFromInvoice(line, invoiceTax);
  }
  if (line.unitPriceExclTax != null && !line.lineTaxTotal) {
    return normalizeTaxNone(line);
  }
  return normalizeTaxNone(line);
}
