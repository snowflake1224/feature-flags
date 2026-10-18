import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateLocal } from "../lib/local-eval";
import { sha1Hex } from "../lib/sha1";
import type { ClientDataset, EvalContext, EvalResult, FlagValue } from "../lib/types";

interface EvalVector {
  name: string;
  dataset: ClientDataset;
  flagKey: string;
  context: EvalContext;
  defaultValue: FlagValue;
  expected: {
    value: FlagValue;
    variationIndex: number | null;
    reason: Record<string, unknown>;
    flagVersion?: number;
  };
}

function loadGoldenEvaluations(): EvalVector[] {
  const starts = [process.cwd(), dirname(fileURLToPath(import.meta.url))];
  const seen = new Set<string>();
  for (const start of starts) {
    let dir = resolve(start);
    for (let i = 0; i < 12; i++) {
      if (seen.has(dir)) break;
      seen.add(dir);
      const candidate = join(dir, "testdata", "golden-vectors.json");
      if (existsSync(candidate)) {
        const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { evaluations: EvalVector[] };
        return parsed.evaluations;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error("testdata/golden-vectors.json not found");
}

function sharedResult(result: EvalResult) {
  const reason: Record<string, unknown> = { kind: result.reason.kind };
  if (result.reason.ruleId !== undefined) reason.ruleId = result.reason.ruleId;
  if (result.reason.ruleIndex !== undefined) reason.ruleIndex = result.reason.ruleIndex;
  if (result.reason.prerequisiteKey !== undefined) reason.prerequisiteKey = result.reason.prerequisiteKey;
  if (result.reason.errorKind !== undefined) reason.errorKind = result.reason.errorKind;
  const out: EvalVector["expected"] = {
    value: result.value,
    variationIndex: result.variationIndex,
    reason,
  };
  if (result.flagVersion !== undefined) out.flagVersion = result.flagVersion;
  return out;
}

describe("local evaluation", () => {
  it("sha1 matches the known digest for abc", () => {
    expect(sha1Hex("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  });

  it("matches the shared evaluation golden vectors", () => {
    const evaluations = loadGoldenEvaluations();
    expect(evaluations.length).toBeGreaterThan(0);
    for (const row of evaluations) {
      const result = evaluateLocal(row.dataset, row.flagKey, row.context, row.defaultValue);
      expect(sharedResult(result), row.name).toEqual(row.expected);
    }
  });
});
