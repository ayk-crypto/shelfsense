import { describe, expect, it } from "vitest";
import {
  calculateReplenishment,
  summarizeIncomingPurchaseLines,
} from "../src/lib/inventory-units.js";
import {
  calculateUsageProfile,
  normalizeReorderAction,
  resolvePlanningCycleDays,
} from "../src/lib/reorder-planning.js";

describe("reorder demand planning", () => {
  const today = new Date("2026-07-30T12:00:00.000Z");

  it("uses elapsed history to estimate monthly demand instead of extrapolating one week", () => {
    const profile = calculateUsageProfile([
      { quantity: 4, createdAt: new Date("2026-07-01T12:00:00.000Z") },
      { quantity: 6, createdAt: new Date("2026-07-30T08:00:00.000Z") },
    ], today);

    expect(profile).not.toBeNull();
    expect(profile?.historyDays).toBe(30);
    expect(profile?.totalUsageBaseQty).toBe(10);
    expect(profile?.averageDailyUsageBaseQty).toBeCloseTo(10 / 30, 6);
    expect(profile?.estimatedMonthlyUsageBaseQty).toBeCloseTo(10, 6);
  });

  it("smooths very new usage over at least seven days", () => {
    const profile = calculateUsageProfile([
      { quantity: 7, createdAt: new Date("2026-07-30T08:00:00.000Z") },
    ], today);

    expect(profile?.historyDays).toBe(7);
    expect(profile?.averageDailyUsageBaseQty).toBe(1);
    expect(profile?.estimatedMonthlyUsageBaseQty).toBe(30);
  });

  it("uses procurement frequency as the purchase planning cycle", () => {
    expect(resolvePlanningCycleDays("daily", null, 30)).toBe(1);
    expect(resolvePlanningCycleDays("weekly", null, 30)).toBe(7);
    expect(resolvePlanningCycleDays("biweekly", null, 30)).toBe(14);
    expect(resolvePlanningCycleDays("monthly", null, 7)).toBe(30);
    expect(resolvePlanningCycleDays("custom", 21, 30)).toBe(21);
    expect(resolvePlanningCycleDays(null, null, 30)).toBe(30);
  });

  it("does not suggest a PO when stock is above the reorder point", () => {
    const raw = calculateReplenishment({
      mode: "DAYS_BASED",
      currentStockBaseQty: 15,
      averageDailyUsageBaseQty: 0.571428,
      hasUsageHistory: true,
      supplierLeadTimeDays: 8,
      safetyStockDays: 7,
      reviewPeriodDays: 30,
      lowStockThresholdBaseQty: 10,
      manualReorderPointBaseQty: null,
      manualTargetStockBaseQty: null,
      purchaseUnit: "carton",
      baseUnit: "packet",
      purchaseConversionFactor: 5,
      allowFractionalPurchaseUnit: false,
      incoming: summarizeIncomingPurchaseLines([], {
        baseUnit: "packet",
        buyingUnit: "carton",
        conversionFactor: 5,
      }, today),
      today,
    });

    // The target is higher than current stock, but current stock is still above
    // the actual reorder trigger. This was the source of the 500 MP false PO.
    expect(raw.reorderPointBaseQty).toBeCloseTo(8.57142, 5);
    expect(raw.targetStockBaseQty).toBeCloseTo(25.71426, 5);
    expect(raw.status).toBe("REORDER_REQUIRED");

    const result = normalizeReorderAction(raw);
    expect(result.status).toBe("HEALTHY");
    expect(result.requiredBaseQty).toBe(0);
    expect(result.suggestedBuyingQty).toBe(0);
    expect(result.suggestedBaseQty).toBe(0);
  });

  it("still refills to the target after the reorder point is reached", () => {
    const result = normalizeReorderAction(calculateReplenishment({
      mode: "DAYS_BASED",
      currentStockBaseQty: 5,
      averageDailyUsageBaseQty: 0.571428,
      hasUsageHistory: true,
      supplierLeadTimeDays: 8,
      safetyStockDays: 7,
      reviewPeriodDays: 30,
      lowStockThresholdBaseQty: 10,
      manualReorderPointBaseQty: null,
      manualTargetStockBaseQty: null,
      purchaseUnit: "carton",
      baseUnit: "packet",
      purchaseConversionFactor: 5,
      allowFractionalPurchaseUnit: false,
      incoming: summarizeIncomingPurchaseLines([], {
        baseUnit: "packet",
        buyingUnit: "carton",
        conversionFactor: 5,
      }, today),
      today,
    }));

    expect(result.status).toBe("REORDER_REQUIRED");
    expect(result.requiredBaseQty).toBeCloseTo(20.71426, 5);
    expect(result.suggestedBuyingQty).toBe(5);
  });

  it("does not request an additional PO while stock plus incoming is above the trigger", () => {
    const result = normalizeReorderAction(calculateReplenishment({
      mode: "DAYS_BASED",
      currentStockBaseQty: 15,
      averageDailyUsageBaseQty: 0.571428,
      hasUsageHistory: true,
      supplierLeadTimeDays: 8,
      safetyStockDays: 7,
      reviewPeriodDays: 30,
      lowStockThresholdBaseQty: 10,
      manualReorderPointBaseQty: null,
      manualTargetStockBaseQty: null,
      purchaseUnit: "carton",
      baseUnit: "packet",
      purchaseConversionFactor: 5,
      allowFractionalPurchaseUnit: false,
      incoming: summarizeIncomingPurchaseLines([{
        purchaseId: "purchase-1",
        poReference: "PO-1",
        supplierName: "Supplier",
        status: "ORDERED",
        orderedBaseQty: 5,
        receivedBaseQty: 0,
        expectedDeliveryDate: new Date("2026-08-02T12:00:00.000Z"),
      }], {
        baseUnit: "packet",
        buyingUnit: "carton",
        conversionFactor: 5,
      }, today),
      today,
    }));

    expect(result.status).toBe("ON_ORDER_COVERED");
    expect(result.requiredBaseQty).toBe(0);
    expect(result.suggestedBuyingQty).toBe(0);
  });
});
