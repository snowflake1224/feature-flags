import { describe, expect, it } from "vitest";
import { twoProportionTest, normalCdf } from "../src/experiments/stats";

describe("experiment statistics", () => {
  it("normalCdf is ~0.5 at 0 and monotonic", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 2);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 2);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 2);
  });

  it("detects a significant uplift", () => {
    const r = twoProportionTest(100, 1000, 160, 1000);
    expect(r.relativeUplift).toBeCloseTo(0.6, 1);
    expect(r.significant).toBe(true);
    expect(r.pValue).toBeLessThan(0.05);
  });

  it("does not flag noise as significant", () => {
    const r = twoProportionTest(100, 1000, 103, 1000);
    expect(r.significant).toBe(false);
  });

  it("is safe with zero exposures", () => {
    const r = twoProportionTest(0, 0, 0, 0);
    expect(r.pValue).toBe(1);
    expect(r.significant).toBe(false);
  });
});
