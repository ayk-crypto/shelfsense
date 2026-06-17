import { describe, expect, it } from "vitest";
import {
  buildStockBreakdown,
  buildUsageMetrics,
  calculateCoverage,
  calculateReplenishment,
  calculateReorder,
  normalizeUnitConfig,
  summarizeIncomingPurchaseLines,
} from "../src/lib/inventory-units.js";
import {
  buildPurchaseLineSnapshot,
  parseQuantityUnit,
} from "../src/lib/purchase-unit-snapshots.js";
import {
  mergeItemInputForValidation,
  parseItemInput,
  validateItemInput,
} from "../src/routes/items.js";
import { buildEditItemPayload } from "../../web/src/utils/itemPayload.ts";
import type { CreateItemInput, Item } from "../../web/src/types.ts";

describe("inventory unit conversion", () => {
  it("handles exact carton conversion", () => {
    const stock = buildStockBreakdown(21, { baseUnit: "packets", buyingUnit: "cartons", conversionFactor: 7 });
    expect(stock).toMatchObject({
      buyingQuantity: 3,
      fullBuyingUnits: 3,
      remainingBaseUnits: 0,
      conversionRequired: false,
    });
  });

  it("handles partial carton conversion", () => {
    const stock = buildStockBreakdown(17, { baseUnit: "packets", buyingUnit: "cartons", conversionFactor: 7 });
    expect(stock.fullBuyingUnits).toBe(2);
    expect(stock.remainingBaseUnits).toBe(3);
  });

  it("uses different conversion factors per item", () => {
    expect(buildStockBreakdown(12, { baseUnit: "packets", buyingUnit: "cartons", conversionFactor: 6 }).buyingQuantity).toBe(2);
    expect(buildStockBreakdown(14, { baseUnit: "packets", buyingUnit: "cartons", conversionFactor: 7 }).buyingQuantity).toBe(2);
  });

  it("requires conversion when buying unit differs and factor is missing", () => {
    const config = normalizeUnitConfig({ baseUnit: "packet", buyingUnit: "carton", conversionFactor: null });
    expect(config.conversionRequired).toBe(true);
    const coverage = calculateCoverage(21, 1, true, config.conversionRequired, false);
    expect(coverage).toMatchObject({ calculationAvailable: false, message: "Conversion required" });
  });

  it("does not duplicate conversion when base unit equals buying unit", () => {
    const stock = buildStockBreakdown(5, { baseUnit: "packet", buyingUnit: "packet", conversionFactor: null });
    expect(stock.usesBuyingUnit).toBe(false);
    expect(stock.buyingQuantity).toBe(5);
  });
});

describe("coverage calculation", () => {
  it("calculates days from full precision base-unit values", () => {
    const usage = buildUsageMetrics(1, true, { baseUnit: "packet", buyingUnit: "carton", conversionFactor: 7 });
    const coverage = calculateCoverage(21, usage.averageDailyBaseQuantity, usage.hasUsageHistory, false, false);
    expect(usage.averageDailyBaseQuantity).toBeCloseTo(0.142857, 6);
    expect(coverage.daysRemaining).toBe(147);
  });

  it("supports low-stock sample with fractional daily usage", () => {
    const coverage = calculateCoverage(5, 0.571428, true, false, true);
    expect(coverage.daysRemaining).toBeCloseTo(8.75, 2);
  });

  it("returns no usage data when there is no history", () => {
    expect(calculateCoverage(21, null, false, false, false)).toMatchObject({
      calculationAvailable: false,
      message: "No usage data",
    });
  });

  it("returns no recent usage for zero average usage", () => {
    expect(calculateCoverage(21, 0, true, false, false)).toMatchObject({
      calculationAvailable: false,
      message: "No recent usage",
    });
  });

  it("returns zero days for zero stock", () => {
    expect(calculateCoverage(0, 1, true, false, true)).toMatchObject({
      calculationAvailable: true,
      daysRemaining: 0,
      status: "OUT_OF_STOCK",
    });
  });

  it("flags negative stock as a stock issue", () => {
    expect(calculateCoverage(-2, 1, true, false, true)).toMatchObject({
      calculationAvailable: true,
      status: "NEGATIVE_STOCK",
    });
  });
});

describe("reorder calculation", () => {
  it("rounds required base quantity up to full cartons", () => {
    const reorder = calculateReorder(8, 0, 0, { baseUnit: "packets", buyingUnit: "cartons", conversionFactor: 6 }, {
      isActive: true,
      requiresReplenishment: true,
    });
    expect(reorder.requiredBaseQuantity).toBe(8);
    expect(reorder.suggestedBuyingQuantity).toBe(2);
  });

  it("subtracts incoming open PO quantity after converting to base units", () => {
    const reorder = calculateReorder(20, 5, 2, { baseUnit: "packets", buyingUnit: "cartons", conversionFactor: 6 }, {
      isActive: true,
      requiresReplenishment: true,
    });
    expect(reorder.incomingBaseQuantity).toBe(12);
    expect(reorder.requiredBaseQuantity).toBe(3);
    expect(reorder.suggestedBuyingQuantity).toBe(1);
  });

  it("does not calculate reorder when conversion is invalid", () => {
    const reorder = calculateReorder(20, 5, 0, { baseUnit: "packets", buyingUnit: "cartons", conversionFactor: null }, {
      isActive: true,
      requiresReplenishment: true,
    });
    expect(reorder.calculationAvailable).toBe(false);
    expect(reorder.suggestedBuyingQuantity).toBeNull();
  });
});

describe("operational replenishment", () => {
  const today = new Date("2026-06-17T00:00:00.000Z");
  const baseConfig = { baseUnit: "packet", buyingUnit: "carton", conversionFactor: 5 };

  it("treats a full 2-carton PO as 10 outstanding base-unit packets", () => {
    const incoming = summarizeIncomingPurchaseLines([{
      purchaseId: "purchase-full",
      poReference: "PO-FULL",
      supplierName: "Vendor",
      status: "ORDERED",
      orderedBaseQty: 10,
      receivedBaseQty: 0,
      expectedDeliveryDate: new Date("2026-06-20T00:00:00.000Z"),
    }], baseConfig, today);

    expect(incoming.incomingBaseQty).toBe(10);
    expect(incoming.incomingBuyingQty).toBe(2);
    expect(incoming.lines[0]?.outstandingBaseQty).toBe(10);
    expect(incoming.lines[0]?.outstandingBuyingQty).toBe(2);
  });

  it("treats a full 2-carton receipt as 10 base packets received with nothing outstanding", () => {
    const incoming = summarizeIncomingPurchaseLines([{
      purchaseId: "purchase-full-received",
      poReference: "PO-FULL-RECEIVED",
      supplierName: "Vendor",
      status: "RECEIVED",
      orderedBaseQty: 10,
      receivedBaseQty: 10,
      expectedDeliveryDate: new Date("2026-06-20T00:00:00.000Z"),
    }], baseConfig, today);

    expect(incoming.incomingBaseQty).toBe(0);
    expect(incoming.incomingBuyingQty).toBe(0);
    expect(incoming.lines).toHaveLength(0);
  });

  it("treats a partial 1-carton receipt as 5 base packets received and 1 carton outstanding", () => {
    const incoming = summarizeIncomingPurchaseLines([{
      purchaseId: "purchase-partial",
      poReference: "PO-PARTIAL",
      supplierName: "Vendor",
      status: "PARTIALLY_RECEIVED",
      orderedBaseQty: 10,
      receivedBaseQty: 5,
      expectedDeliveryDate: new Date("2026-06-20T00:00:00.000Z"),
    }], baseConfig, today);

    expect(incoming.incomingBaseQty).toBe(5);
    expect(incoming.incomingBuyingQty).toBe(1);
    expect(incoming.lines[0]?.outstandingBaseQty).toBe(5);
    expect(incoming.lines[0]?.outstandingBuyingQty).toBe(1);
  });

  it("uses PO-line snapshot conversion when the item conversion later changes", () => {
    const incoming = summarizeIncomingPurchaseLines([{
      purchaseId: "purchase-snapshot",
      poReference: "PO-SNAPSHOT",
      supplierName: "Vendor",
      status: "PARTIALLY_RECEIVED",
      orderedBaseQty: 10,
      receivedBaseQty: 5,
      baseUnitSnapshot: "packet",
      purchaseUnitSnapshot: "carton",
      purchaseConversionFactorSnapshot: 5,
      unitSnapshotSource: "ORIGINAL",
      expectedDeliveryDate: new Date("2026-06-20T00:00:00.000Z"),
    }], { baseUnit: "packet", buyingUnit: "carton", conversionFactor: 6 }, today);

    expect(incoming.incomingBaseQty).toBe(5);
    expect(incoming.incomingBuyingQty).toBe(1);
    expect(incoming.lines[0]?.outstandingBaseQty).toBe(5);
    expect(incoming.lines[0]?.outstandingBuyingQty).toBe(1);
  });

  it("keeps legacy unknown conversion lines base-unit safe without fabricating purchase-unit display", () => {
    const incoming = summarizeIncomingPurchaseLines([{
      purchaseId: "purchase-legacy",
      poReference: "PO-LEGACY",
      supplierName: "Vendor",
      status: "ORDERED",
      orderedBaseQty: 10,
      receivedBaseQty: 0,
      baseUnitSnapshot: "packet",
      purchaseUnitSnapshot: "carton",
      purchaseConversionFactorSnapshot: null,
      unitSnapshotSource: "UNKNOWN",
      expectedDeliveryDate: new Date("2026-06-20T00:00:00.000Z"),
    }], baseConfig, today);

    expect(incoming.incomingBaseQty).toBe(10);
    expect(incoming.incomingBuyingQty).toBe(0);
    expect(incoming.lines[0]?.outstandingBuyingQty).toBeNull();
    expect(incoming.lines[0]?.conversionUnavailable).toBe(true);
  });

  it("treats invalid snapshot conversion as unavailable while preserving base incoming", () => {
    const incoming = summarizeIncomingPurchaseLines([{
      purchaseId: "purchase-invalid-snapshot",
      poReference: "PO-INVALID",
      supplierName: "Vendor",
      status: "ORDERED",
      orderedBaseQty: 10,
      receivedBaseQty: 0,
      baseUnitSnapshot: "packet",
      purchaseUnitSnapshot: "carton",
      purchaseConversionFactorSnapshot: 0,
      unitSnapshotSource: "INFERRED",
      expectedDeliveryDate: new Date("2026-06-20T00:00:00.000Z"),
    }], baseConfig, today);

    expect(incoming.incomingBaseQty).toBe(10);
    expect(incoming.lines[0]?.outstandingBuyingQty).toBeNull();
    expect(incoming.lines[0]?.conversionUnavailable).toBe(true);
  });

  it("supports fractional purchase quantities without double conversion", () => {
    const incoming = summarizeIncomingPurchaseLines([{
      purchaseId: "purchase-fractional",
      poReference: "PO-FRACTIONAL",
      supplierName: "Vendor",
      status: "ORDERED",
      orderedBaseQty: 2.5,
      receivedBaseQty: 0,
      baseUnitSnapshot: "packet",
      purchaseUnitSnapshot: "carton",
      purchaseConversionFactorSnapshot: 5,
      unitSnapshotSource: "ORIGINAL",
      expectedDeliveryDate: new Date("2026-06-20T00:00:00.000Z"),
    }], baseConfig, today);

    expect(incoming.incomingBaseQty).toBe(2.5);
    expect(incoming.incomingBuyingQty).toBe(0.5);
    expect(incoming.lines[0]?.outstandingBuyingQty).toBe(0.5);
  });

  it("keeps manual threshold mode behavior compatible", () => {
    const incoming = summarizeIncomingPurchaseLines([], baseConfig, today);
    const result = calculateReplenishment({
      mode: "MANUAL_THRESHOLD",
      currentStockBaseQty: 3,
      averageDailyUsageBaseQty: null,
      hasUsageHistory: false,
      supplierLeadTimeDays: null,
      safetyStockDays: null,
      reviewPeriodDays: null,
      lowStockThresholdBaseQty: 10,
      manualReorderPointBaseQty: null,
      manualTargetStockBaseQty: null,
      purchaseUnit: "carton",
      baseUnit: "packet",
      purchaseConversionFactor: 5,
      allowFractionalPurchaseUnit: false,
      incoming,
      today,
    });
    expect(result.status).toBe("REORDER_REQUIRED");
    expect(result.requiredBaseQty).toBe(7);
    expect(result.suggestedBuyingQty).toBe(2);
  });

  it("calculates days-based reorder point and target stock", () => {
    const incoming = summarizeIncomingPurchaseLines([], baseConfig, today);
    const result = calculateReplenishment({
      mode: "DAYS_BASED",
      currentStockBaseQty: 9,
      averageDailyUsageBaseQty: 0.571428,
      hasUsageHistory: true,
      supplierLeadTimeDays: 8,
      safetyStockDays: 7,
      reviewPeriodDays: 30,
      lowStockThresholdBaseQty: 0,
      manualReorderPointBaseQty: null,
      manualTargetStockBaseQty: null,
      purchaseUnit: "carton",
      baseUnit: "packet",
      purchaseConversionFactor: 5,
      allowFractionalPurchaseUnit: false,
      incoming,
      today,
    });
    expect(result.reorderPointBaseQty).toBeCloseTo(8.57142, 5);
    expect(result.targetStockBaseQty).toBeCloseTo(25.71426, 5);
    expect(result.requiredBaseQty).toBeCloseTo(16.71426, 5);
    expect(result.suggestedBuyingQty).toBe(4);
  });

  it("calculates the 500 MP days-based replenishment case without manual overrides", () => {
    const incoming = summarizeIncomingPurchaseLines([], baseConfig, today);
    const result = calculateReplenishment({
      mode: "DAYS_BASED",
      currentStockBaseQty: 5,
      averageDailyUsageBaseQty: 0.571428,
      hasUsageHistory: true,
      supplierLeadTimeDays: 8,
      safetyStockDays: 7,
      reviewPeriodDays: 30,
      lowStockThresholdBaseQty: 0,
      manualReorderPointBaseQty: null,
      manualTargetStockBaseQty: null,
      purchaseUnit: "carton",
      baseUnit: "packet",
      purchaseConversionFactor: 5,
      allowFractionalPurchaseUnit: false,
      incoming,
      today,
    });

    expect(result.reorderPointBaseQty).toBeCloseTo(8.57142, 5);
    expect(result.targetStockBaseQty).toBeCloseTo(25.71426, 5);
    expect(result.requiredBaseQty).toBeCloseTo(20.71426, 5);
    expect(result.suggestedBuyingQty).toBe(5);
    expect(result.status).toBe("REORDER_REQUIRED");
  });

  it("suggests additional quantity with a partial incoming PO", () => {
    const incoming = summarizeIncomingPurchaseLines([{
      purchaseId: "purchase-00000001",
      poReference: "PO-00000001",
      supplierName: "Vendor",
      status: "ORDERED",
      orderedBaseQty: 5,
      receivedBaseQty: 0,
      expectedDeliveryDate: new Date("2026-06-25T00:00:00.000Z"),
    }], baseConfig, today);
    const result = calculateReplenishment({
      mode: "DAYS_BASED",
      currentStockBaseQty: 9,
      averageDailyUsageBaseQty: 0.571428,
      hasUsageHistory: true,
      supplierLeadTimeDays: 8,
      safetyStockDays: 7,
      reviewPeriodDays: 30,
      lowStockThresholdBaseQty: 0,
      manualReorderPointBaseQty: null,
      manualTargetStockBaseQty: null,
      purchaseUnit: "carton",
      baseUnit: "packet",
      purchaseConversionFactor: 5,
      allowFractionalPurchaseUnit: false,
      incoming,
      today,
    });
    expect(result.incomingBaseQty).toBe(5);
    expect(result.requiredBaseQty).toBeCloseTo(11.71426, 5);
    expect(result.suggestedBuyingQty).toBe(3);
    expect(result.projectedStockAtDeliveryBaseQty).toBeCloseTo(9.428576, 5);
    expect(result.status).toBe("ADDITIONAL_QTY_REQUIRED");
  });

  it("marks an incoming PO as covered when it reaches target without stockout", () => {
    const incoming = summarizeIncomingPurchaseLines([{
      purchaseId: "purchase-00000002",
      poReference: "PO-00000002",
      supplierName: "Vendor",
      status: "ORDERED",
      orderedBaseQty: 20,
      receivedBaseQty: 0,
      expectedDeliveryDate: new Date("2026-06-20T00:00:00.000Z"),
    }], baseConfig, today);
    const result = calculateReplenishment({
      mode: "DAYS_BASED",
      currentStockBaseQty: 9,
      averageDailyUsageBaseQty: 0.571428,
      hasUsageHistory: true,
      supplierLeadTimeDays: 8,
      safetyStockDays: 7,
      reviewPeriodDays: 30,
      lowStockThresholdBaseQty: 0,
      manualReorderPointBaseQty: null,
      manualTargetStockBaseQty: null,
      purchaseUnit: "carton",
      baseUnit: "packet",
      purchaseConversionFactor: 5,
      allowFractionalPurchaseUnit: false,
      incoming,
      today,
    });
    expect(result.status).toBe("ON_ORDER_COVERED");
    expect(result.suggestedBuyingQty).toBe(0);
  });

  it("flags stockout risk before delivery", () => {
    const incoming = summarizeIncomingPurchaseLines([{
      purchaseId: "purchase-00000003",
      poReference: "PO-00000003",
      supplierName: "Vendor",
      status: "ORDERED",
      orderedBaseQty: 5,
      receivedBaseQty: 0,
      expectedDeliveryDate: new Date("2026-06-27T00:00:00.000Z"),
    }], baseConfig, today);
    const result = calculateReplenishment({
      mode: "DAYS_BASED",
      currentStockBaseQty: 2,
      averageDailyUsageBaseQty: 1,
      hasUsageHistory: true,
      supplierLeadTimeDays: 10,
      safetyStockDays: 2,
      reviewPeriodDays: 7,
      lowStockThresholdBaseQty: 0,
      manualReorderPointBaseQty: null,
      manualTargetStockBaseQty: null,
      purchaseUnit: "carton",
      baseUnit: "packet",
      purchaseConversionFactor: 5,
      allowFractionalPurchaseUnit: false,
      incoming,
      today,
    });
    expect(result.projectedStockAtDeliveryBaseQty).toBe(-3);
    expect(result.status).toBe("ON_ORDER_SHORTAGE_RISK");
  });

  it("sums multiple open POs and subtracts partially received quantities", () => {
    const incoming = summarizeIncomingPurchaseLines([
      { purchaseId: "po1", poReference: "PO1", supplierName: null, status: "ORDERED", orderedBaseQty: 15, receivedBaseQty: 5, expectedDeliveryDate: new Date("2026-06-24T00:00:00.000Z") },
      { purchaseId: "po2", poReference: "PO2", supplierName: null, status: "PARTIALLY_RECEIVED", orderedBaseQty: 10, receivedBaseQty: 2.5, expectedDeliveryDate: new Date("2026-06-22T00:00:00.000Z") },
      { purchaseId: "po3", poReference: "PO3", supplierName: null, status: "ORDERED", orderedBaseQty: 5, receivedBaseQty: 5, expectedDeliveryDate: new Date("2026-06-21T00:00:00.000Z") },
    ], baseConfig, today);
    expect(incoming.incomingBuyingQty).toBe(3.5);
    expect(incoming.incomingBaseQty).toBe(17.5);
    expect(incoming.earliestExpectedDeliveryDate?.toISOString().slice(0, 10)).toBe("2026-06-22");
  });

  it("flags overdue delivery", () => {
    const incoming = summarizeIncomingPurchaseLines([{
      purchaseId: "purchase-00000004",
      poReference: "PO-00000004",
      supplierName: "Vendor",
      status: "ORDERED",
      orderedBaseQty: 5,
      receivedBaseQty: 0,
      expectedDeliveryDate: new Date("2026-06-15T00:00:00.000Z"),
    }], baseConfig, today);
    const result = calculateReplenishment({
      mode: "DAYS_BASED",
      currentStockBaseQty: 9,
      averageDailyUsageBaseQty: 0.571428,
      hasUsageHistory: true,
      supplierLeadTimeDays: 8,
      safetyStockDays: 7,
      reviewPeriodDays: 30,
      lowStockThresholdBaseQty: 0,
      manualReorderPointBaseQty: null,
      manualTargetStockBaseQty: null,
      purchaseUnit: "carton",
      baseUnit: "packet",
      purchaseConversionFactor: 5,
      allowFractionalPurchaseUnit: false,
      incoming,
      today,
    });
    expect(result.status).toBe("OVERDUE_DELIVERY");
  });

  it("handles zero usage, no history, missing conversion, zero lead time, and manual overrides", () => {
    const incoming = summarizeIncomingPurchaseLines([], baseConfig, today);
    const noUsage = calculateReplenishment({
      mode: "DAYS_BASED", currentStockBaseQty: 9, averageDailyUsageBaseQty: null, hasUsageHistory: false,
      supplierLeadTimeDays: 8, safetyStockDays: 7, reviewPeriodDays: 30, lowStockThresholdBaseQty: 0,
      manualReorderPointBaseQty: null, manualTargetStockBaseQty: null, purchaseUnit: "carton", baseUnit: "packet",
      purchaseConversionFactor: 5, allowFractionalPurchaseUnit: false, incoming, today,
    });
    expect(noUsage.status).toBe("NO_USAGE_DATA");

    const missingConversionIncoming = summarizeIncomingPurchaseLines([], { baseUnit: "packet", buyingUnit: "carton", conversionFactor: null }, today);
    const missingConversion = calculateReplenishment({
      mode: "DAYS_BASED", currentStockBaseQty: 9, averageDailyUsageBaseQty: 1, hasUsageHistory: true,
      supplierLeadTimeDays: 0, safetyStockDays: 1, reviewPeriodDays: 1, lowStockThresholdBaseQty: 0,
      manualReorderPointBaseQty: null, manualTargetStockBaseQty: null, purchaseUnit: "carton", baseUnit: "packet",
      purchaseConversionFactor: null, allowFractionalPurchaseUnit: false, incoming: missingConversionIncoming, today,
    });
    expect(missingConversion.status).toBe("CONFIGURATION_REQUIRED");

    const zeroLead = calculateReplenishment({
      mode: "DAYS_BASED", currentStockBaseQty: 1.5, averageDailyUsageBaseQty: 1, hasUsageHistory: true,
      supplierLeadTimeDays: 0, safetyStockDays: 1, reviewPeriodDays: 4, lowStockThresholdBaseQty: 0,
      manualReorderPointBaseQty: 2, manualTargetStockBaseQty: 8, purchaseUnit: "carton", baseUnit: "packet",
      purchaseConversionFactor: 5, allowFractionalPurchaseUnit: false, incoming, today,
    });
    expect(zeroLead.reorderPointBaseQty).toBe(2);
    expect(zeroLead.targetStockBaseQty).toBe(8);
    expect(zeroLead.suggestedBuyingQty).toBe(2);
  });
});

describe("purchase order unit snapshots", () => {
  const item = { unit: "packet", purchaseUnit: "carton", purchaseConversionFactor: 5 };

  it("creates 2 cartons with conversion 5 as 10 base packets", () => {
    const snapshot = buildPurchaseLineSnapshot(2, "PURCHASE_UNIT", 50, item);

    expect("error" in snapshot).toBe(false);
    if ("error" in snapshot) throw new Error(snapshot.error);
    expect(snapshot.enteredQuantity).toBe(2);
    expect(snapshot.enteredUnitSnapshot).toBe("carton");
    expect(snapshot.baseUnitSnapshot).toBe("packet");
    expect(snapshot.purchaseUnitSnapshot).toBe("carton");
    expect(snapshot.purchaseConversionFactorSnapshot).toBe(5);
    expect(snapshot.storedBaseQuantity).toBe(10);
    expect(snapshot.baseUnitCost).toBe(10);
  });

  it("supports API creation with PURCHASE_UNIT", () => {
    const snapshot = buildPurchaseLineSnapshot(0.5, "PURCHASE_UNIT", 25, item);

    expect("error" in snapshot).toBe(false);
    if ("error" in snapshot) throw new Error(snapshot.error);
    expect(snapshot.storedBaseQuantity).toBe(2.5);
    expect(snapshot.baseUnitCost).toBe(5);
  });

  it("supports API creation with BASE_UNIT without converting quantity", () => {
    const snapshot = buildPurchaseLineSnapshot(10, "BASE_UNIT", 10, item);

    expect("error" in snapshot).toBe(false);
    if ("error" in snapshot) throw new Error(snapshot.error);
    expect(snapshot.enteredQuantity).toBe(10);
    expect(snapshot.enteredUnitSnapshot).toBe("packet");
    expect(snapshot.storedBaseQuantity).toBe(10);
    expect(snapshot.baseUnitCost).toBe(10);
  });

  it("rejects missing or invalid quantityUnit", () => {
    expect(parseQuantityUnit(undefined)).toBeUndefined();
    expect(parseQuantityUnit("")).toBeUndefined();
    expect(parseQuantityUnit("carton")).toBeUndefined();
  });

  it("rejects purchase-unit quantities when no valid conversion exists", () => {
    const snapshot = buildPurchaseLineSnapshot(2, "PURCHASE_UNIT", 50, {
      unit: "packet",
      purchaseUnit: "carton",
      purchaseConversionFactor: 0,
    });

    expect(snapshot).toEqual({
      error: "quantityUnit PURCHASE_UNIT requires the item to have a purchase unit and positive conversion factor",
    });
  });
});

describe("item replenishment payload parsing", () => {
  it("does not map reviewPeriodDays into manual reorder or target overrides", () => {
    const parsed = parseItemInput({
      replenishmentMode: "DAYS_BASED",
      procurementLeadTimeDays: 8,
      safetyStockDays: 7,
      reviewPeriodDays: 30,
      manualReorderPointBaseQty: null,
      manualTargetStockBaseQty: null,
    });

    expect(parsed.reviewPeriodDays).toBe(30);
    expect(parsed.manualReorderPointBaseQty).toBeNull();
    expect(parsed.manualTargetStockBaseQty).toBeNull();
  });

  it("keeps omitted manual override fields undefined on partial updates", () => {
    const parsed = parseItemInput({
      reviewPeriodDays: 30,
    });

    expect(parsed.reviewPeriodDays).toBe(30);
    expect(parsed.manualReorderPointBaseQty).toBeUndefined();
    expect(parsed.manualTargetStockBaseQty).toBeUndefined();
  });
});

describe("edit item replenishment payload serialization", () => {
  const today = new Date("2026-06-17T00:00:00.000Z");

  function baseItem(overrides: Partial<Item>): Item {
    return {
      id: "item-1",
      workspaceId: "workspace-1",
      name: "500 MP",
      unit: "packet",
      category: "Packaging & Disposables",
      sku: null,
      barcode: null,
      minStockLevel: 0,
      criticalStockLevel: null,
      parStockLevel: null,
      procurementFrequency: null,
      customFrequencyDays: null,
      procurementLeadTimeDays: 8,
      replenishmentMode: "DAYS_BASED",
      safetyStockDays: 7,
      reviewPeriodDays: 30,
      manualReorderPointBaseQty: 30,
      manualTargetStockBaseQty: null,
      allowFractionalPurchaseUnit: false,
      lastReceivedDate: null,
      trackExpiry: false,
      purchaseUnit: "carton",
      purchaseConversionFactor: 5,
      issueUnit: null,
      displayBothUnits: true,
      isActive: true,
      archivedAt: null,
      createdAt: "2026-06-17T00:00:00.000Z",
      updatedAt: "2026-06-17T00:00:00.000Z",
      ...overrides,
    };
  }

  it("loads an existing manual reorder override, clears it as null, and falls back to calculated DAYS_BASED reorder point", () => {
    const item = baseItem({ manualReorderPointBaseQty: 30 });
    expect(item.manualReorderPointBaseQty).toBe(30);

    const form: CreateItemInput = {
      name: item.name,
      unit: item.unit,
      category: item.category,
      sku: item.sku,
      barcode: item.barcode,
      minStockLevel: item.minStockLevel,
      criticalStockLevel: item.criticalStockLevel,
      parStockLevel: item.parStockLevel,
      procurementFrequency: item.procurementFrequency,
      customFrequencyDays: item.customFrequencyDays,
      procurementLeadTimeDays: item.procurementLeadTimeDays,
      replenishmentMode: item.replenishmentMode,
      safetyStockDays: item.safetyStockDays,
      reviewPeriodDays: item.reviewPeriodDays,
      manualReorderPointBaseQty: null,
      manualTargetStockBaseQty: item.manualTargetStockBaseQty,
      allowFractionalPurchaseUnit: item.allowFractionalPurchaseUnit,
      trackExpiry: item.trackExpiry,
      purchaseUnit: item.purchaseUnit,
      purchaseConversionFactor: item.purchaseConversionFactor,
      issueUnit: item.issueUnit,
      displayBothUnits: item.displayBothUnits,
    };

    const payload = buildEditItemPayload(form, item, true);
    expect(payload.manualReorderPointBaseQty).toBeNull();
    expect(payload.manualTargetStockBaseQty).toBeUndefined();

    const parsed = parseItemInput(payload);
    expect(parsed.manualReorderPointBaseQty).toBeNull();

    const result = calculateReplenishment({
      mode: "DAYS_BASED",
      currentStockBaseQty: 5,
      averageDailyUsageBaseQty: 0.571428,
      hasUsageHistory: true,
      supplierLeadTimeDays: 8,
      safetyStockDays: 7,
      reviewPeriodDays: 30,
      lowStockThresholdBaseQty: 0,
      manualReorderPointBaseQty: parsed.manualReorderPointBaseQty,
      manualTargetStockBaseQty: parsed.manualTargetStockBaseQty ?? null,
      purchaseUnit: "carton",
      baseUnit: "packet",
      purchaseConversionFactor: 5,
      allowFractionalPurchaseUnit: false,
      incoming: summarizeIncomingPurchaseLines([], { baseUnit: "packet", buyingUnit: "carton", conversionFactor: 5 }, today),
      today,
    });

    expect(result.reorderPointBaseQty).toBeCloseTo(8.57142, 5);
    expect(result.targetStockBaseQty).toBeCloseTo(25.71426, 5);
    expect(result.suggestedBuyingQty).toBe(5);
    expect(result.status).toBe("REORDER_REQUIRED");
  });

  it("maps Supplier Delivery Time to procurementLeadTimeDays in the edit payload", () => {
    const item = baseItem({ procurementLeadTimeDays: 8 });
    const form: CreateItemInput = {
      name: item.name,
      unit: item.unit,
      category: item.category,
      sku: item.sku,
      barcode: item.barcode,
      minStockLevel: item.minStockLevel,
      criticalStockLevel: item.criticalStockLevel,
      parStockLevel: item.parStockLevel,
      procurementFrequency: item.procurementFrequency,
      customFrequencyDays: item.customFrequencyDays,
      procurementLeadTimeDays: 9,
      replenishmentMode: item.replenishmentMode,
      safetyStockDays: item.safetyStockDays,
      reviewPeriodDays: item.reviewPeriodDays,
      manualReorderPointBaseQty: item.manualReorderPointBaseQty,
      manualTargetStockBaseQty: item.manualTargetStockBaseQty,
      allowFractionalPurchaseUnit: item.allowFractionalPurchaseUnit,
      trackExpiry: item.trackExpiry,
      purchaseUnit: item.purchaseUnit,
      purchaseConversionFactor: item.purchaseConversionFactor,
      issueUnit: item.issueUnit,
      displayBothUnits: item.displayBothUnits,
    };

    const payload = buildEditItemPayload(form, item, true);
    expect(payload.procurementLeadTimeDays).toBe(9);
    expect("supplierLeadTimeDays" in payload).toBe(false);
    expect("supplierDeliveryTime" in payload).toBe(false);
    expect("leadTimeDays" in payload).toBe(false);
  });

  it("validates a DAYS_BASED partial update against persisted lead-time settings", () => {
    const item = baseItem({
      procurementLeadTimeDays: 8,
      safetyStockDays: 7,
      reviewPeriodDays: 30,
      manualReorderPointBaseQty: 30,
    });
    const incoming = parseItemInput({ manualReorderPointBaseQty: null });
    const effective = mergeItemInputForValidation(incoming, item);

    expect(incoming.procurementLeadTimeDays).toBeUndefined();
    expect(effective.procurementLeadTimeDays).toBe(8);
    expect(effective.safetyStockDays).toBe(7);
    expect(effective.reviewPeriodDays).toBe(30);
    expect(effective.manualReorderPointBaseQty).toBeNull();
    expect(validateItemInput(effective)).toBeNull();
  });
});
