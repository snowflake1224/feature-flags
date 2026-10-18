import { describe, expect, it } from "vitest";
import {
  emptyRule,
  parseContextList,
  parseValueList,
  slugKey,
  validateClauses,
  validateFlagKey,
  validateProjectKey,
  validateSegmentRules,
  validateTargetingRules,
} from "../lib/targeting";

describe("targeting construction and validation", () => {
  it("parses booleans, numbers, and strings according to the operator", () => {
    expect(parseValueList("true, false, 18, US", "greaterThan")).toEqual([true, false, 18, "US"]);
    expect(parseValueList("18, US", "in")).toEqual(["18", "US"]);
  });

  it("builds a rule with an id and a default clause", () => {
    const rule = emptyRule();
    expect(rule.id.startsWith("rule-")).toBe(true);
    expect(rule.variation).toBe(0);
    expect(rule.clauses).toHaveLength(1);
    expect(validateTargetingRules([rule])).toBeNull();
  });

  it("rejects clauses and rules that cannot be evaluated", () => {
    expect(validateClauses([], "Rule 1")).toMatch(/at least one clause/);
    expect(validateClauses([{ op: "in", values: ["US"] }], "Rule 1")).toMatch(/without an attribute/);
    expect(validateClauses([{ op: "segmentMatch", values: ["beta-users"] }], "Rule 1")).toBeNull();
    expect(validateTargetingRules([{ id: "r1", clauses: [{ attribute: "country", op: "in", values: ["US"] }] }])).toMatch(
      /variation or a rollout/,
    );
    expect(
      validateTargetingRules([
        {
          id: "r1",
          clauses: [{ attribute: "country", op: "in", values: ["DE"] }],
          rollout: { variations: [{ variation: 0, weight: 100 }] },
        },
      ]),
    ).toBeNull();
  });

  it("checks segment rule weights and key shapes", () => {
    const clauses = [{ attribute: "email", op: "endsWith" as const, values: ["@flagship.dev"] }];
    expect(validateSegmentRules([{ clauses, weight: 10 }])).toBeNull();
    expect(validateSegmentRules([{ clauses, weight: 101 }])).toMatch(/between 0 and 100/);
    expect(slugKey("Mobile App", true)).toBe("mobile-app");
    expect(validateFlagKey("new-checkout")).toBeNull();
    expect(validateFlagKey("has space")).toMatch(/letters, numbers/);
    expect(validateProjectKey("demo")).toBeNull();
    expect(validateProjectKey("Demo")).toMatch(/lowercase/);
    expect(parseContextList("user-beta-1,\nuser-beta-2")).toEqual(["user-beta-1", "user-beta-2"]);
  });
});
