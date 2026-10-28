// Core data model for the Flagship evaluation engine.
// These types are shared verbatim between the backend (dashboard "test
// targeting") and the client SDK (local evaluation).

/** Boolean flags are the default; a flag may also serve string variations. */
export type FlagValue = boolean | string | null;

/**
 * `in`: the attribute equals one of `values`.
 * `endsWith`: the attribute is a string ending with one of `values` (e.g. an email domain).
 */
export type ClauseOp = "in" | "endsWith";

export interface Clause {
  attribute: string;
  op: ClauseOp;
  values: string[];
}

export interface WeightedVariation {
  /** index into Flag.variations */
  variation: number;
  /** 0..100 percentage; weights across a rollout should sum to 100 */
  weight: number;
}

export interface Rollout {
  variations: WeightedVariation[];
  /** context attribute used for bucketing; defaults to the context key */
  bucketBy?: string;
}

export interface VariationOrRollout {
  /** index into Flag.variations, when serving a single variation */
  variation?: number;
  /** percentage rollout across variations */
  rollout?: Rollout;
}

export interface TargetingRule extends VariationOrRollout {
  id: string;
  clauses: Clause[];
  description?: string;
}

/** Individually targeted context keys mapped to a specific variation. */
export interface Target {
  variation: number;
  values: string[];
}

export interface Prerequisite {
  flagKey: string;
  /** variation index the prerequisite flag must serve */
  variation: number;
}

export interface Flag {
  key: string;
  /** kill switch: when false the flag serves offVariation for everyone */
  on: boolean;
  variations: FlagValue[];
  offVariation: number;
  fallthrough: VariationOrRollout;
  targets: Target[];
  rules: TargetingRule[];
  prerequisites: Prerequisite[];
  /** stable per-flag salt so bucketing is deterministic yet flag-specific */
  salt: string;
  version: number;
}

/** The full ruleset an SDK downloads for one environment. */
export interface ClientDataset {
  environmentKey: string;
  /** sum of flag config versions; changes whenever any flag changes */
  version: number;
  flags: Record<string, Flag>;
}

export interface EvalContext {
  /** stable identifier used for bucketing (e.g. user id, device id) */
  key: string;
  /** arbitrary attributes referenced by targeting clauses */
  [attribute: string]: unknown;
}

export type EvalReasonKind =
  | "OFF"
  | "FALLTHROUGH"
  | "TARGET_MATCH"
  | "RULE_MATCH"
  | "PREREQUISITE_FAILED"
  | "ERROR";

export interface EvalReason {
  kind: EvalReasonKind;
  ruleId?: string;
  ruleIndex?: number;
  prerequisiteKey?: string;
  errorKind?: "FLAG_NOT_FOUND" | "MALFORMED_FLAG";
}

export interface EvalResult<T extends FlagValue = FlagValue> {
  value: T;
  variationIndex: number | null;
  reason: EvalReason;
  flagVersion?: number;
}
