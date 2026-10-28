import { describe, expect, it } from "vitest";
import { bucket, evaluateLocal } from "../lib/local-eval";
import { sha1Hex } from "../lib/sha1";
import type { ClientDataset, DatasetFlag } from "../lib/types";

function checkout(percent: number, partial: Partial<DatasetFlag> = {}): ClientDataset {
  return {
    environmentKey: "production",
    version: 1,
    flags: {
      "new-checkout": {
        key: "new-checkout",
        on: true,
        variations: [true, false],
        offVariation: 1,
        fallthrough: {
          rollout: {
            variations: [
              { variation: 0, weight: percent },
              { variation: 1, weight: 100 - percent },
            ],
          },
        },
        targets: [],
        rules: [
          {
            id: "staff-email",
            clauses: [{ attribute: "email", op: "endsWith", values: ["@flagship.dev"] }],
            variation: 0,
          },
        ],
        prerequisites: [],
        salt: "checkoutsalt00000",
        version: 3,
        ...partial,
      },
    },
  };
}

describe("local evaluation", () => {
  it("sha1 matches the known digest for abc", () => {
    expect(sha1Hex("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  });

  it("buckets exactly like the SDK", () => {
    expect(bucket("new-checkout", "checkoutsalt00000", "user-42")).toBe(0.5588033430205928);
  });

  it("matches the email-domain rule before the rollout", () => {
    const result = evaluateLocal(checkout(0), "new-checkout", { key: "u1", email: "ada@flagship.dev" });
    expect(result.value).toBe(true);
    expect(result.reason).toEqual({ kind: "RULE_MATCH", ruleId: "staff-email", ruleIndex: 0 });
  });

  it("keeps users included at 10% when the rollout grows to 20%", () => {
    for (let i = 0; i < 2000; i++) {
      const ctx = { key: `user-${i}` };
      if (evaluateLocal(checkout(10), "new-checkout", ctx).value === true) {
        expect(evaluateLocal(checkout(20), "new-checkout", ctx).value).toBe(true);
      }
    }
  });

  it("serves the off variation when the kill switch is off", () => {
    const result = evaluateLocal(checkout(100, { on: false }), "new-checkout", { key: "u1", email: "ada@flagship.dev" });
    expect(result.value).toBe(false);
    expect(result.reason.kind).toBe("OFF");
  });

  it("reports a missing flag", () => {
    const result = evaluateLocal(checkout(20), "nope", { key: "u1" }, false);
    expect(result).toEqual({ value: false, variationIndex: null, reason: { kind: "ERROR", errorKind: "FLAG_NOT_FOUND" } });
  });
});
