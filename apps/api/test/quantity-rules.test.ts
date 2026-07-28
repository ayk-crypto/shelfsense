import { describe, expect, it } from "vitest";
import {
  allowsFractionalQuantity,
  getQuantityUnitKind,
  isWholeQuantity,
  roundUpToAllowedQuantity,
  validateQuantityForUnit,
} from "../src/lib/quantity-rules.js";

describe("quantity unit rules", () => {
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
});
