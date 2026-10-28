import { sha1Hex } from "./sha1";
import type {
  Clause,
  ClientDataset,
  DatasetFlag,
  EvalContext,
  EvalReason,
  EvalResult,
  FlagValue,
  VariationOrRollout,
} from "./types";

const LONG_SCALE = 0xfffffffffffffffn;

/**
 * Browser evaluation of a fetched flag set.
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
    if ((rule.clauses ?? []).every((clause) => matchClause(clause, context))) {
      return resolve(flag, rule, context, defaultValue, { kind: "RULE_MATCH", ruleId: rule.id, ruleIndex: i });
    }
  }

  return resolve(flag, flag.fallthrough ?? {}, context, defaultValue, { kind: "FALLTHROUGH" });
}

function matchClause(clause: Clause, context: EvalContext): boolean {
  const contextValue = clause.attribute === "key" ? context.key : context[clause.attribute];
  return (clause.values ?? []).some((ruleValue) => {
    if (clause.op === "in") return contextValue === ruleValue;
    if (clause.op === "endsWith") return typeof contextValue === "string" && contextValue.endsWith(ruleValue);
    return false;
  });
}

function resolve(
  flag: DatasetFlag,
  source: VariationOrRollout,
  context: EvalContext,
  defaultValue: FlagValue,
  reason: EvalReason,
): EvalResult {
  if (source.rollout) {
    const raw = source.rollout.bucketBy ? context[source.rollout.bucketBy] : context.key;
    const point = bucket(flag.key, flag.salt, String(raw ?? context.key));
    return result(flag, pickVariation(point, source.rollout.variations ?? []), defaultValue, reason);
  }
  return result(flag, source.variation ?? flag.offVariation, defaultValue, reason);
}

function off(flag: DatasetFlag, defaultValue: FlagValue, reason: EvalReason): EvalResult {
  return result(flag, flag.offVariation, defaultValue, reason);
}

function result(flag: DatasetFlag, variationIndex: number, defaultValue: FlagValue, reason: EvalReason): EvalResult {
  const value = flag.variations[variationIndex];
  if (value === undefined) return errorResult(defaultValue, "MALFORMED_FLAG");
  return { value, variationIndex, reason, flagVersion: flag.version };
}

function errorResult(defaultValue: FlagValue, errorKind: NonNullable<EvalReason["errorKind"]>): EvalResult {
  return { value: defaultValue, variationIndex: null, reason: { kind: "ERROR", errorKind } };
}

export function bucket(key: string, salt: string, bucketBy: string): number {
  const hex = sha1Hex(`${key}.${salt}.${bucketBy}`).slice(0, 15);
  return Number(BigInt(`0x${hex}`)) / Number(LONG_SCALE);
}

function pickVariation(point: number, variations: Array<{ variation: number; weight: number }>): number {
  let sum = 0;
  for (const weighted of variations) {
    sum += weighted.weight / 100;
    if (point < sum) return weighted.variation;
  }
  const last = variations[variations.length - 1];
  return last ? last.variation : 0;
}
