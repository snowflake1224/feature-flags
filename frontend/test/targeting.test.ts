import { describe, expect, it } from "vitest";
import {
  emptyRule,
  parseValueList,
  slugKey,
  validateClauses,
  validateFlagKey,
  validateProjectKey,
  validateTargetingRules,
} from "../lib/targeting";

describe("targeting construction and validation", () => {
  it("parses comma-separated string values", () => {
    expect(parseValueList("US, CA, ,DE")).toEqual(["US", "CA", "DE"]);
  });

  it("builds a rule with an id and a default clause", () => {
    const rule = emptyRule();
    expect(rule.id.startsWith("rule-")).toBe(true);
    expect(rule.variation).toBe(0);
    expect(rule.clauses).toHaveLength(1);
    expect(validateTargetingRules([rule])).toBeNull();
  });

  it("only accepts equals and ends-with clauses", () => {
    expect(validateClauses([], "Rule 1")).toMatch(/at least one clause/);
    expect(validateClauses([{ op: "in", values: ["US"] }], "Rule 1")).toMatch(/without an attribute/);
    expect(validateClauses([{ attribute: "version", op: "semverGreaterThan", values: ["1.0.0"] }], "Rule 1")).toMatch(
      /equals.*ends with/,
    );
    expect(validateClauses([{ attribute: "email", op: "endsWith", values: ["@flagship.dev"] }], "Rule 1")).toBeNull();
    expect(validateTargetingRules([{ id: "r1", clauses: [{ attribute: "country", op: "in", values: ["US"] }] }])).toMatch(
      /variation or a rollout/,
    );
  });

  it("checks key shapes", () => {
    expect(slugKey("Mobile App", true)).toBe("mobile-app");
    expect(validateFlagKey("new-checkout")).toBeNull();
    expect(validateFlagKey("has space")).toMatch(/letters, numbers/);
    expect(validateProjectKey("demo")).toBeNull();
    expect(validateProjectKey("Demo")).toMatch(/lowercase/);
  });
});
