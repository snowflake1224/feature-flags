import { bucket, pickVariation } from "./hash";
import { matchSingle } from "./operators";
import type {
  Clause,
  ClientDataset,
  EvalContext,
  EvalResult,
  Flag,
  FlagValue,
  Segment,
  VariationOrRollout,
} from "./types";

/**
 * Flagship evaluation engine.
 *
 * Pure and synchronous: given a dataset (all flags + segments for one
 * environment) and a context, it returns a deterministic result. No IO, no
 * clocks (except `after`/`before` operators comparing against context values),
 * so it is trivially unit-testable and identical across server and SDK.
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
        return this.result(flag, target.variation, defaultValue, {
          kind: "TARGET_MATCH",
        });
      }
    }

    // 4. Rules (first match wins)
    for (let i = 0; i < (flag.rules ?? []).length; i++) {
      const rule = flag.rules[i];
      if (rule.clauses.every((c) => this.matchClause(c, context, seen))) {
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

  private matchClause(clause: Clause, context: EvalContext, seen: Set<string>): boolean {
    let result: boolean;
    if (clause.op === "segmentMatch") {
      result = clause.values.some((segKey) =>
        this.matchSegment(this.dataset.segments[String(segKey)], context),
      );
    } else {
      const contextValue = this.attr(context, clause.attribute);
      if (Array.isArray(contextValue)) {
        // Multi-valued attribute: match if ANY element satisfies ANY rule value.
        result = contextValue.some((cv) =>
          clause.values.some((rv) => matchSingle(cv, clause.op, rv)),
        );
      } else {
        result = clause.values.some((rv) => matchSingle(contextValue, clause.op, rv));
      }
    }
    return clause.negate ? !result : result;
  }

  private matchSegment(segment: Segment | undefined, context: EvalContext): boolean {
    if (!segment) return false;
    if (segment.excluded?.includes(context.key)) return false;
    if (segment.included?.includes(context.key)) return true;
    for (const rule of segment.rules ?? []) {
      const clausesMatch = rule.clauses.every((c) => {
        const contextValue = this.attr(context, c.attribute);
        const r = Array.isArray(contextValue)
          ? contextValue.some((cv) => c.values.some((rv) => matchSingle(cv, c.op, rv)))
          : c.values.some((rv) => matchSingle(contextValue, c.op, rv));
        return c.negate ? !r : r;
      });
      if (!clausesMatch) continue;
      if (rule.weight === undefined) return true;
      const by = String(this.attr(context, rule.bucketBy ?? "key") ?? context.key);
      const point = bucket(segment.key, segment.salt, by);
      if (point < rule.weight / 100) return true;
    }
    return false;
  }

  private resolveVariationOrRollout<T extends FlagValue>(
    flag: Flag,
    vr: VariationOrRollout,
    context: EvalContext,
    defaultValue: T,
    reason: EvalResult["reason"],
  ): EvalResult<T> {
    if (vr.rollout) {
      const bucketBy = vr.rollout.bucketBy ?? "key";
      const by = String(this.attr(context, bucketBy) ?? context.key);
      const point = bucket(flag.key, flag.salt, by, vr.rollout.seed);
      const picked = pickVariation(point, vr.rollout.variations);
      return this.result(flag, picked.variation, defaultValue, {
        ...reason,
        inExperiment: picked.inExperiment,
      });
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
    errorKind: "FLAG_NOT_FOUND" | "MALFORMED_FLAG" | "WRONG_TYPE",
  ): EvalResult<T> {
    return {
      value: defaultValue,
      variationIndex: null,
      reason: { kind: "ERROR", errorKind },
    };
  }

  /** Supports dotted paths like "company.plan". */
  private attr(context: EvalContext, path: string): unknown {
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
