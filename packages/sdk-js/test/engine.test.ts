import { describe, expect, it } from "vitest";
import { Engine } from "../src/engine";
import type { ClientDataset, Flag } from "../src/types";

function flag(partial: Partial<Flag> & Pick<Flag, "key">): Flag {
  return {
    on: true,
    variations: [true, false],
    offVariation: 1,
    fallthrough: { variation: 0 },
    targets: [],
    rules: [],
    prerequisites: [],
    salt: "salt",
    version: 1,
    ...partial,
  };
}

function dataset(flags: Flag[]): ClientDataset {
  return {
    environmentKey: "test",
    version: 1,
    flags: Object.fromEntries(flags.map((f) => [f.key, f])),
  };
}

function rollout(percent: number): Flag["fallthrough"] {
  return {
    rollout: {
      variations: [
        { variation: 0, weight: percent },
        { variation: 1, weight: 100 - percent },
      ],
    },
  };
}

describe("Engine", () => {
  it("returns default + error when flag is missing", () => {
    const e = new Engine(dataset([]));
    const r = e.evaluate("nope", { key: "u1" }, "fallback");
    expect(r.value).toBe("fallback");
    expect(r.reason.kind).toBe("ERROR");
    expect(r.reason.errorKind).toBe("FLAG_NOT_FOUND");
  });

  it("kill switch serves offVariation for everyone", () => {
    const e = new Engine(dataset([flag({ key: "f", on: false })]));
    const r = e.evaluate("f", { key: "u1" }, false);
    expect(r.value).toBe(false);
    expect(r.reason.kind).toBe("OFF");
  });

  it("individual targets win over rules and fallthrough", () => {
    const e = new Engine(
      dataset([
        flag({
          key: "f",
          targets: [{ variation: 0, values: ["vip-user"] }],
          fallthrough: { variation: 1 },
        }),
      ]),
    );
    expect(e.evaluate("f", { key: "vip-user" }, false).value).toBe(true);
    expect(e.evaluate("f", { key: "other" }, true).value).toBe(false);
  });

  it("matches an attribute-equals rule", () => {
    const e = new Engine(
      dataset([
        flag({
          key: "f",
          rules: [{ id: "r1", clauses: [{ attribute: "country", op: "in", values: ["US", "CA"] }], variation: 0 }],
          fallthrough: { variation: 1 },
        }),
      ]),
    );
    expect(e.evaluate("f", { key: "u1", country: "US" }, false).value).toBe(true);
    expect(e.evaluate("f", { key: "u2", country: "FR" }, true).value).toBe(false);
  });

  it("matches an email-domain rule", () => {
    const e = new Engine(
      dataset([
        flag({
          key: "f",
          rules: [{ id: "staff", clauses: [{ attribute: "email", op: "endsWith", values: ["@flagship.dev"] }], variation: 0 }],
          fallthrough: { variation: 1 },
        }),
      ]),
    );
    const staff = e.evaluate("f", { key: "u1", email: "ada@flagship.dev" }, false);
    expect(staff.value).toBe(true);
    expect(staff.reason).toEqual({ kind: "RULE_MATCH", ruleId: "staff", ruleIndex: 0 });
    expect(e.evaluate("f", { key: "u2", email: "ada@example.com" }, true).value).toBe(false);
    expect(e.evaluate("f", { key: "u3" }, true).value).toBe(false);
  });

  it("serves string variations", () => {
    const e = new Engine(dataset([flag({ key: "layout", variations: ["a", "b"], fallthrough: { variation: 1 } })]));
    expect(e.evaluate("layout", { key: "u1" }, "x").value).toBe("b");
  });

  it("keeps users included at 10% when the rollout grows to 20%", () => {
    const at10 = new Engine(dataset([flag({ key: "f", fallthrough: rollout(10) })]));
    const at20 = new Engine(dataset([flag({ key: "f", fallthrough: rollout(20) })]));
    let included10 = 0;
    let included20 = 0;
    for (let i = 0; i < 5000; i++) {
      const ctx = { key: `user-${i}` };
      const before = at10.evaluate("f", ctx, false).value;
      const after = at20.evaluate("f", ctx, false).value;
      if (before) {
        included10++;
        expect(after).toBe(true);
      }
      if (after) included20++;
    }
    expect(included10).toBeGreaterThan(0);
    expect(included20).toBeGreaterThan(included10);
  });

  it("fails closed to offVariation when a prerequisite is off", () => {
    const e = new Engine(
      dataset([
        flag({ key: "parent", on: false }),
        flag({
          key: "child",
          prerequisites: [{ flagKey: "parent", variation: 0 }],
          fallthrough: { variation: 0 },
          offVariation: 1,
        }),
      ]),
    );
    const r = e.evaluate("child", { key: "u1" }, false);
    expect(r.reason.kind).toBe("PREREQUISITE_FAILED");
    expect(r.value).toBe(false);
  });
});
