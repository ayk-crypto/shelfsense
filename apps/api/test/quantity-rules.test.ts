import { describe, expect, it } from "vitest";
import {
  allowsFractionalQuantity,
  getQuantityUnitKind,
  isWholeQuantity,
  roundUpToAllowedQuantity,
  validateQuantityForUnit,
} from "../src/lib/quantity-rules.js";
import { buildPurchaseLineSnapshot } from "../src/lib/purchase-unit-snapshots.js";
import { isItemSettingsRequest } from "../src/middleware/quantity-rules.js";

describe("quantity unit rules", () => {
  it("does not treat bulk supplier actions as item IDs", () => {
    expect(isItemSettingsRequest("POST", "/items/bulk-assign-supplier")).toBe(false);
    expect(isItemSettingsRequest("POST", "/items/bulk-remove-supplier")).toBe(false);
    expect(isItemSettingsRequest("PATCH", "/items/bulk-assign-supplier")).toBe(false);
  });

  it("validates only item creation and UUID-based item updates", () => {
    const itemId = "6f9619ff-8b86-4d11-b42d-00cf4fc964ff";
    expect(isItemSettingsRequest("POST", "/items")).toBe(true);
    expect(isItemSettingsRequest("PATCH", `/items/${itemId}`)).toBe(true);
    expect(isItemSettingsRequest("PUT", `/items/${itemId}`)).toBe(true);
    expect(isItemSettingsRequest("POST", `/items/${itemId}`)).toBe(false);
    expect(isItemSettingsRequest("PATCH", `/items/${itemId}/suppliers`)).toBe(false);
  });

  it("allows fractional quantities for continuous units", () => {
    expect(getQuantityUnitKind("kg")).toBe("CONTINUOUS");
    expect(allowsFractionalQuantity("kg", false)).toBe(true);
    expect(validateQuantityForUnit(0.2, "kg", false)).toBeNull();
    expect(validateQuantityForUnit(3.6, "litre", false)).toBeNull();
  });

  it("requires whole quantities for countable units", () => {
    expect(getQuantityUnitKind("carton")).toBe("WHOLE");
    expect(allowsFractionalQuantity("carton", true)).toBe(false);
    expect(validateQuantityForUnit(3, "carton", true)).toBeNull();
    expect(validateQuantityForUnit(3.6, "carton", true)).toContain("whole number");
    expect(validateQuantityForUnit(0.2, "packet", true)).toContain("whole number");
  });

  it("rounds purchase suggestions up for whole units", () => {
    expect(roundUpToAllowedQuantity(3.6, "carton", true)).toBe(4);
    expect(roundUpToAllowedQuantity(1.01, "packet", false)).toBe(2);
    expect(roundUpToAllowedQuantity(3.6, "kg", false)).toBe(3.6);
  });

  it("keeps custom units configurable", () => {
    expect(getQuantityUnitKind("custom measure")).toBe("CUSTOM");
    expect(allowsFractionalQuantity("custom measure", true)).toBe(true);
    expect(allowsFractionalQuantity("custom measure", false)).toBe(false);
  });

  it("uses tolerance for values created by floating point conversion", () => {
    expect(isWholeQuantity(3.0000001)).toBe(true);
    expect(isWholeQuantity(3.01)).toBe(false);
  });

  it("records supplier-facing purchase units while retaining base stock quantities", () => {
    const oil = buildPurchaseLineSnapshot(
      41,
      "PURCHASE_UNIT",
      5_000,
      { unit: "litre", purchaseUnit: "carton", purchaseConversionFactor: 5 },
    );
    expect(oil).not.toHaveProperty("error");
    if ("error" in oil) return;
    expect(oil.enteredQuantity).toBe(41);
    expect(oil.enteredUnitSnapshot).toBe("carton");
    expect(oil.storedBaseQuantity).toBe(205);
    expect(oil.baseUnitSnapshot).toBe("litre");
    expect(oil.baseUnitCost).toBe(1_000);

    const cream = buildPurchaseLineSnapshot(
      10,
      "PURCHASE_UNIT",
      12_000,
      { unit: "pack", purchaseUnit: "carton", purchaseConversionFactor: 12 },
    );
    expect(cream).not.toHaveProperty("error");
    if ("error" in cream) return;
    expect(cream.enteredQuantity).toBe(10);
    expect(cream.enteredUnitSnapshot).toBe("carton");
    expect(cream.storedBaseQuantity).toBe(120);
  });
});
