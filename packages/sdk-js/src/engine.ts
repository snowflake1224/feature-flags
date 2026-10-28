import { bucket, pickVariation } from "./hash";
import { matchSingle } from "./operators";
import type {
  Clause,
  ClientDataset,
  EvalContext,
  EvalResult,
  Flag,
  FlagValue,
  VariationOrRollout,
} from "./types";

/**
 * Flagship evaluation engine.
 *
 * Pure and synchronous: given a dataset (all flags for one environment) and a
 * context, it returns a deterministic result. No IO, no clocks, so it is
 * trivially unit-testable and identical in the SDK and the dashboard API.
 *
 * Evaluation order for a single flag:
 *   1. prerequisites  -> if any fails, serve offVariation
 *   2. kill switch    -> if !flag.on, serve offVariation
 *   3. individual targets (exact key match)
 *   4. targeting rules (first match wins)
 *   5. fallthrough (default rule: single variation or % rollout)
 */
export class Engine {
  constructor(private dataset: ClientDataset) {}

  update(dataset: ClientDataset) {
    this.dataset = dataset;
  }

  get version(): number {
    return this.dataset.version;
  }

  allFlagKeys(): string[] {
    return Object.keys(this.dataset.flags);
  }

  evaluate<T extends FlagValue = FlagValue>(
    flagKey: string,
    context: EvalContext,
    defaultValue: T,
  ): EvalResult<T> {
    const flag = this.dataset.flags[flagKey];
    if (!flag) {
      return {
        value: defaultValue,
        variationIndex: null,
        reason: { kind: "ERROR", errorKind: "FLAG_NOT_FOUND" },
      };
    }
    return this.evaluateFlag(flag, context, defaultValue, new Set());
  }

  private evaluateFlag<T extends FlagValue>(
    flag: Flag,
    context: EvalContext,
    defaultValue: T,
    seen: Set<string>,
  ): EvalResult<T> {
    // Guard against prerequisite cycles.
    if (seen.has(flag.key)) {
      return this.errorResult(defaultValue, "MALFORMED_FLAG");
    }
    seen.add(flag.key);

    // 1. Prerequisites
    for (const pre of flag.prerequisites ?? []) {
      const preFlag = this.dataset.flags[pre.flagKey];
      if (!preFlag) {
        return this.off(flag, defaultValue, {
          kind: "PREREQUISITE_FAILED",
          prerequisiteKey: pre.flagKey,
        });
      }
      const preResult = this.evaluateFlag(preFlag, context, null, seen);
      if (!preFlag.on || preResult.variationIndex !== pre.variation) {
        return this.off(flag, defaultValue, {
          kind: "PREREQUISITE_FAILED",
          prerequisiteKey: pre.flagKey,
        });
      }
    }

    // 2. Kill switch
    if (!flag.on) {
      return this.off(flag, defaultValue, { kind: "OFF" });
    }

    // 3. Individual targets
    for (const target of flag.targets ?? []) {
      if (target.values.includes(context.key)) {
        return this.result(flag, target.variation, defaultValue, { kind: "TARGET_MATCH" });
      }
    }

    // 4. Rules (first match wins; clauses within a rule are AND-ed)
    const rules = flag.rules ?? [];
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (rule.clauses.every((c) => this.matchClause(c, context))) {
        return this.resolveVariationOrRollout(flag, rule, context, defaultValue, {
          kind: "RULE_MATCH",
          ruleId: rule.id,
          ruleIndex: i,
        });
      }
    }

    // 5. Fallthrough
    return this.resolveVariationOrRollout(flag, flag.fallthrough, context, defaultValue, {
      kind: "FALLTHROUGH",
    });
  }

  private matchClause(clause: Clause, context: EvalContext): boolean {
    const contextValue = clause.attribute === "key" ? context.key : context[clause.attribute];
    return clause.values.some((rv) => matchSingle(contextValue, clause.op, rv));
  }

  private resolveVariationOrRollout<T extends FlagValue>(
    flag: Flag,
    vr: VariationOrRollout,
    context: EvalContext,
    defaultValue: T,
    reason: EvalResult["reason"],
  ): EvalResult<T> {
    if (vr.rollout) {
      const raw = vr.rollout.bucketBy ? context[vr.rollout.bucketBy] : context.key;
      const by = String(raw ?? context.key);
      const point = bucket(flag.key, flag.salt, by);
      return this.result(flag, pickVariation(point, vr.rollout.variations), defaultValue, reason);
    }
    return this.result(flag, vr.variation ?? flag.offVariation, defaultValue, reason);
  }

  private off<T extends FlagValue>(
    flag: Flag,
    defaultValue: T,
    reason: EvalResult["reason"],
  ): EvalResult<T> {
    return this.result(flag, flag.offVariation, defaultValue, reason);
  }

  private result<T extends FlagValue>(
    flag: Flag,
    variationIndex: number,
    defaultValue: T,
    reason: EvalResult["reason"],
  ): EvalResult<T> {
    const value = flag.variations[variationIndex];
    if (value === undefined) {
      return this.errorResult(defaultValue, "MALFORMED_FLAG");
    }
    return {
      value: value as T,
      variationIndex,
      reason,
      flagVersion: flag.version,
    };
  }

  private errorResult<T extends FlagValue>(
    defaultValue: T,
    errorKind: "FLAG_NOT_FOUND" | "MALFORMED_FLAG",
  ): EvalResult<T> {
    return {
      value: defaultValue,
      variationIndex: null,
      reason: { kind: "ERROR", errorKind },
    };
  }
}

/** Convenience one-shot evaluation. */
export function evaluate<T extends FlagValue = FlagValue>(
  dataset: ClientDataset,
  flagKey: string,
  context: EvalContext,
  defaultValue: T,
): EvalResult<T> {
  return new Engine(dataset).evaluate(flagKey, context, defaultValue);
}

export { bucket, pickVariation } from "./hash";
