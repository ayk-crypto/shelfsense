import { describe, expect, it } from "vitest";
import {
  buildStockBreakdown,
  buildUsageMetrics,
  calculateCoverage,
  calculateReorder,
  normalizeUnitConfig,
} from "../src/lib/inventory-units.js";

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
