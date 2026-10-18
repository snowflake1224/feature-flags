import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { bucket, evaluate } from "../src/engine";
import type { ClientDataset, EvalContext, EvalResult, FlagValue } from "../src/types";

interface BucketVector {
  name: string;
  key: string;
  salt: string;
  bucketBy: string;
  seed?: number;
  expected: number;
}

interface EvalVector {
  name: string;
  dataset: ClientDataset;
  flagKey: string;
  context: EvalContext;
  defaultValue: FlagValue;
  expected: {
    value: FlagValue;
    variationIndex: number | null;
    reason: {
      kind: string;
      ruleId?: string;
      ruleIndex?: number;
      prerequisiteKey?: string;
      errorKind?: string;
    };
    flagVersion?: number;
  };
}

interface GoldenFile {
  buckets: BucketVector[];
  evaluations: EvalVector[];
}

/** Walk up from the test file and the process cwd so the fixture resolves in either workspace root. */
export function loadGoldenVectors(): GoldenFile {
  const starts = [process.cwd()];
  try {
    starts.push(dirname(fileURLToPath(import.meta.url)));
  } catch {
    /* import.meta.url is unavailable in this runner */
  }
  const seen = new Set<string>();
  for (const start of starts) {
    let dir = resolve(start);
    for (let i = 0; i < 12; i++) {
      if (seen.has(dir)) break;
      seen.add(dir);
      const candidate = join(dir, "testdata", "golden-vectors.json");
      if (existsSync(candidate)) {
        return JSON.parse(readFileSync(candidate, "utf8")) as GoldenFile;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error(`testdata/golden-vectors.json not found from ${starts.join(", ")}`);
}

function sharedResult(result: EvalResult) {
  const reason: EvalVector["expected"]["reason"] = { kind: result.reason.kind };
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

describe("shared golden vectors", () => {
  const golden = loadGoldenVectors();

  it("loads seeded and unseeded bucket points", () => {
    expect(golden.buckets.some((row) => !("seed" in row))).toBe(true);
    expect(golden.buckets.some((row) => row.seed === 0)).toBe(true);
    expect(golden.buckets.some((row) => typeof row.seed === "number" && row.seed !== 0)).toBe(true);
  });

  it.each(golden.buckets.map((row) => [row.name, row] as const))("bucket %s", (_name, row) => {
    const point =
      "seed" in row ? bucket(row.key, row.salt, row.bucketBy, row.seed) : bucket(row.key, row.salt, row.bucketBy);
    expect(point).toBe(row.expected);
  });

  it.each(golden.evaluations.map((row) => [row.name, row] as const))("evaluate %s", (_name, row) => {
    const result = evaluate(row.dataset, row.flagKey, row.context, row.defaultValue);
    expect(sharedResult(result)).toEqual(row.expected);
  });

  it("seed changes the rollout variation for the same key", () => {
    const plain = golden.evaluations.find((row) => row.name === "rollout no seed");
    const seeded = golden.evaluations.find((row) => row.name === "rollout seed 4");
    expect(plain?.expected.variationIndex).not.toBe(seeded?.expected.variationIndex);
  });
});
