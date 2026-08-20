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

function dataset(flags: Flag[], segments: ClientDataset["segments"] = {}): ClientDataset {
  return {
    environmentKey: "test",
    version: 1,
    flags: Object.fromEntries(flags.map((f) => [f.key, f])),
    segments,
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

  it("matches targeting rules with clauses", () => {
    const e = new Engine(
      dataset([
        flag({
          key: "f",
          rules: [
            {
              id: "r1",
              clauses: [{ attribute: "country", op: "in", values: ["US", "CA"] }],
              variation: 0,
            },
          ],
          fallthrough: { variation: 1 },
        }),
      ]),
    );
    expect(e.evaluate("f", { key: "u1", country: "US" }, false).value).toBe(true);
    expect(e.evaluate("f", { key: "u2", country: "FR" }, true).value).toBe(false);
  });

  it("supports negate and comparison operators", () => {
    const e = new Engine(
      dataset([
        flag({
          key: "f",
          rules: [
            {
              id: "r1",
              clauses: [{ attribute: "age", op: "greaterThanOrEqual", values: [18] }],
              variation: 0,
            },
          ],
          fallthrough: { variation: 1 },
        }),
      ]),
    );
    expect(e.evaluate("f", { key: "u", age: 21 }, false).value).toBe(true);
    expect(e.evaluate("f", { key: "u", age: 15 }, true).value).toBe(false);
  });

  it("resolves percentage rollout deterministically", () => {
    const e = new Engine(
      dataset([
        flag({
          key: "f",
          variations: ["a", "b"],
          offVariation: 1,
          fallthrough: {
            rollout: {
              variations: [
                { variation: 0, weight: 50 },
                { variation: 1, weight: 50 },
              ],
            },
          },
        }),
      ]),
    );
    const first = e.evaluate("f", { key: "stable-user" }, "x").value;
    const second = e.evaluate("f", { key: "stable-user" }, "x").value;
    expect(first).toBe(second);
    expect(["a", "b"]).toContain(first);
  });

  it("evaluates segment matches", () => {
    const e = new Engine(
      dataset(
        [
          flag({
            key: "f",
            rules: [
              {
                id: "r1",
                clauses: [{ attribute: "", op: "segmentMatch", values: ["beta"] }],
                variation: 0,
              },
            ],
            fallthrough: { variation: 1 },
          }),
        ],
        {
          beta: { key: "beta", included: ["u1"], excluded: [], rules: [], salt: "s" },
        },
      ),
    );
    expect(e.evaluate("f", { key: "u1" }, false).value).toBe(true);
    expect(e.evaluate("f", { key: "u2" }, true).value).toBe(false);
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
