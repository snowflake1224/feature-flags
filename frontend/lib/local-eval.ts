import { sha1Hex } from "./sha1";
import type {
  Clause,
  ClientDataset,
  DatasetFlag,
  DatasetSegment,
  EvalContext,
  EvalReason,
  EvalResult,
  FlagValue,
  VariationOrRollout,
} from "./types";

const LONG_SCALE = 0xfffffffffffffffn;

/**
 * Browser evaluation of a downloaded dataset.
 * Mirrors the SDK order: prerequisites, kill switch, targets, rules, fallthrough.
 * The dashboard still shows the server result beside this so drift is visible.
 */
export function evaluateLocal(
  dataset: ClientDataset,
  flagKey: string,
  context: EvalContext,
  defaultValue: FlagValue = null,
): EvalResult {
  const flag = dataset.flags[flagKey];
  if (!flag) {
    return { value: defaultValue, variationIndex: null, reason: { kind: "ERROR", errorKind: "FLAG_NOT_FOUND" } };
  }
  return evaluateFlag(dataset, flag, context, defaultValue, new Set());
}

function evaluateFlag(
  dataset: ClientDataset,
  flag: DatasetFlag,
  context: EvalContext,
  defaultValue: FlagValue,
  seen: Set<string>,
): EvalResult {
  if (seen.has(flag.key)) return errorResult(defaultValue, "MALFORMED_FLAG");
  seen.add(flag.key);

  for (const pre of flag.prerequisites ?? []) {
    const preFlag = dataset.flags[pre.flagKey];
    if (!preFlag) {
      return off(flag, defaultValue, { kind: "PREREQUISITE_FAILED", prerequisiteKey: pre.flagKey });
    }
    const preResult = evaluateFlag(dataset, preFlag, context, null, seen);
    if (!preFlag.on || preResult.variationIndex !== pre.variation) {
      return off(flag, defaultValue, { kind: "PREREQUISITE_FAILED", prerequisiteKey: pre.flagKey });
    }
  }

  if (!flag.on) return off(flag, defaultValue, { kind: "OFF" });

  for (const target of flag.targets ?? []) {
    if (target.values?.includes(context.key)) {
      return result(flag, target.variation, defaultValue, { kind: "TARGET_MATCH" });
    }
  }

  const rules = flag.rules ?? [];
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if ((rule.clauses ?? []).every((clause) => matchClause(dataset, clause, context))) {
      return resolve(flag, rule, context, defaultValue, {
        kind: "RULE_MATCH",
        ruleId: rule.id,
        ruleIndex: i,
      });
    }
  }

  return resolve(flag, flag.fallthrough ?? {}, context, defaultValue, { kind: "FALLTHROUGH" });
}

function matchClause(dataset: ClientDataset, clause: Clause, context: EvalContext): boolean {
  let matched: boolean;
  if (clause.op === "segmentMatch") {
    matched = (clause.values ?? []).some((segKey) =>
      matchSegment(dataset.segments[String(segKey)], context),
    );
  } else {
    const contextValue = attr(context, clause.attribute);
    if (Array.isArray(contextValue)) {
      matched = contextValue.some((item) =>
        (clause.values ?? []).some((ruleValue) => matchSingle(item, clause.op, ruleValue)),
      );
    } else {
      matched = (clause.values ?? []).some((ruleValue) => matchSingle(contextValue, clause.op, ruleValue));
    }
  }
  return clause.negate ? !matched : matched;
}

function matchSegment(segment: DatasetSegment | undefined, context: EvalContext): boolean {
  if (!segment) return false;
  if (segment.excluded?.includes(context.key)) return false;
  if (segment.included?.includes(context.key)) return true;
  for (const rule of segment.rules ?? []) {
    const clausesMatch = (rule.clauses ?? []).every((clause) => {
      const contextValue = attr(context, clause.attribute);
      const matched = Array.isArray(contextValue)
        ? contextValue.some((item) =>
            (clause.values ?? []).some((ruleValue) => matchSingle(item, clause.op, ruleValue)),
          )
        : (clause.values ?? []).some((ruleValue) => matchSingle(contextValue, clause.op, ruleValue));
      return clause.negate ? !matched : matched;
    });
    if (!clausesMatch) continue;
    if (rule.weight === undefined) return true;
    const by = String(attr(context, rule.bucketBy ?? "key") ?? context.key);
    if (bucket(segment.key, segment.salt, by) < rule.weight / 100) return true;
  }
  return false;
}

function resolve(
  flag: DatasetFlag,
  source: VariationOrRollout,
  context: EvalContext,
  defaultValue: FlagValue,
  reason: EvalReason,
): EvalResult {
  if (source.rollout) {
    const bucketBy = source.rollout.bucketBy ?? "key";
    const by = String(attr(context, bucketBy) ?? context.key);
    const point = bucket(flag.key, flag.salt, by, source.rollout.seed);
    const picked = pickVariation(point, source.rollout.variations ?? []);
    return result(flag, picked.variation, defaultValue, { ...reason, inExperiment: picked.inExperiment });
  }
  return result(flag, source.variation ?? flag.offVariation, defaultValue, reason);
}

function off(flag: DatasetFlag, defaultValue: FlagValue, reason: EvalReason): EvalResult {
  return result(flag, flag.offVariation, defaultValue, reason);
}

function result(
  flag: DatasetFlag,
  variationIndex: number,
  defaultValue: FlagValue,
  reason: EvalReason,
): EvalResult {
  const value = flag.variations[variationIndex];
  if (value === undefined) return errorResult(defaultValue, "MALFORMED_FLAG");
  return { value, variationIndex, reason, flagVersion: flag.version };
}

function errorResult(defaultValue: FlagValue, errorKind: NonNullable<EvalReason["errorKind"]>): EvalResult {
  return { value: defaultValue, variationIndex: null, reason: { kind: "ERROR", errorKind } };
}

function attr(context: EvalContext, path: string): unknown {
  if (path === "key") return context.key;
  if (path in context) return context[path];
  if (!path.includes(".")) return undefined;
  return path.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object" && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, context);
}

export function bucket(key: string, salt: string, bucketBy: string, seed?: number): number {
  const prefix = seed !== undefined ? `${seed}.` : "";
  const hex = sha1Hex(`${prefix}${key}.${salt}.${bucketBy}`).slice(0, 15);
  return Number(BigInt(`0x${hex}`)) / Number(LONG_SCALE);
}

function pickVariation(
  point: number,
  variations: Array<{ variation: number; weight: number }>,
): { variation: number; inExperiment: boolean } {
  let sum = 0;
  for (const weighted of variations) {
    sum += weighted.weight / 100;
    if (point < sum) return { variation: weighted.variation, inExperiment: false };
  }
  const last = variations[variations.length - 1];
  return { variation: last ? last.variation : 0, inExperiment: false };
}

function matchSingle(contextValue: unknown, op: Clause["op"], ruleValue: string | number | boolean): boolean {
  switch (op) {
    case "in":
      return contextValue === ruleValue;
    case "notIn":
      return contextValue !== ruleValue;
    case "contains":
      return typeof contextValue === "string" && contextValue.includes(String(ruleValue));
    case "startsWith":
      return typeof contextValue === "string" && contextValue.startsWith(String(ruleValue));
    case "endsWith":
      return typeof contextValue === "string" && contextValue.endsWith(String(ruleValue));
    case "matchesRegex":
      try {
        return typeof contextValue === "string" && new RegExp(String(ruleValue)).test(contextValue);
      } catch {
        return false;
      }
    case "greaterThan":
    case "greaterThanOrEqual":
    case "lessThan":
    case "lessThanOrEqual": {
      const a = toNumber(contextValue);
      const b = toNumber(ruleValue);
      if (a === null || b === null) return false;
      if (op === "greaterThan") return a > b;
      if (op === "greaterThanOrEqual") return a >= b;
      if (op === "lessThan") return a < b;
      return a <= b;
    }
    case "semverEqual":
    case "semverGreaterThan":
    case "semverLessThan": {
      const cmp = compareSemver(String(contextValue), String(ruleValue));
      if (cmp === null) return false;
      if (op === "semverEqual") return cmp === 0;
      if (op === "semverGreaterThan") return cmp === 1;
      return cmp === -1;
    }
    case "before":
    case "after": {
      const a = toDate(contextValue);
      const b = toDate(ruleValue);
      if (a === null || b === null) return false;
      return op === "before" ? a < b : a > b;
    }
    default:
      return false;
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return null;
}

function toDate(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : time;
  }
  return null;
}

function compareSemver(a: string, b: string): number | null {
  const parse = (value: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(value.trim());
    if (!match) return null;
    return { nums: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? null };
  };
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i++) {
    if (left.nums[i] !== right.nums[i]) return left.nums[i] < right.nums[i] ? -1 : 1;
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === null) return 1;
  if (right.pre === null) return -1;
  return left.pre < right.pre ? -1 : 1;
}
