/** Pragmatic flag-config and SDK shapes used by the dashboard. */

export type FlagKind = "boolean" | "string";
export type FlagValue = boolean | string | null;

/** `in`: attribute equals one of the values. `endsWith`: e.g. an email domain. */
export type ClauseOp = "in" | "endsWith";

export interface Clause {
  attribute: string;
  op: ClauseOp;
  values: string[];
}

export interface WeightedVariation {
  variation: number;
  weight: number;
}

export interface Rollout {
  variations: WeightedVariation[];
  bucketBy?: string;
}

export interface VariationOrRollout {
  variation?: number;
  rollout?: Rollout;
}

export interface TargetingRule extends VariationOrRollout {
  id: string;
  clauses: Clause[];
  description?: string;
}

export interface Target {
  variation: number;
  values: string[];
}

export interface Prerequisite {
  flagKey: string;
  variation: number;
}

export interface SdkKey {
  id: string;
  key: string;
  kind: string;
  active: boolean;
}

export interface Environment {
  id: string;
  key: string;
  name: string;
  production: boolean;
  color?: string;
  sdkKeys?: SdkKey[];
}

export interface Project {
  id: string;
  key: string;
  name: string;
  environments: Environment[];
  _count?: { flags: number };
}

export interface FlagConfig {
  id: string;
  environmentId: string;
  on: boolean;
  offVariation: number;
  fallthrough: VariationOrRollout;
  targets: Target[];
  rules: TargetingRule[];
  prerequisites: Prerequisite[];
  salt: string;
  version: number;
  environment?: Environment;
}

export interface Flag {
  id: string;
  key: string;
  name: string;
  description?: string;
  kind: FlagKind;
  variations: FlagValue[];
  tags?: string[];
  temporary?: boolean;
  configs?: FlagConfig[];
}

export interface CreateFlagInput {
  key: string;
  name: string;
  description?: string;
  kind?: FlagKind;
  variations?: FlagValue[];
  temporary?: boolean;
  tags?: string[];
}

export interface UpdateConfigInput {
  on?: boolean;
  offVariation?: number;
  fallthrough?: VariationOrRollout;
  targets?: Target[];
  rules?: TargetingRule[];
  prerequisites?: Prerequisite[];
  comment?: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityKey: string;
  entityId?: string;
  actor: string;
  comment?: string | null;
  before?: unknown;
  after?: unknown;
  createdAt: string;
  environmentId?: string | null;
}

export interface HealthReport {
  status: string;
  checks: Record<string, string>;
  ts: string;
}

export interface DatasetFlag {
  key: string;
  on: boolean;
  variations: FlagValue[];
  offVariation: number;
  fallthrough: VariationOrRollout;
  targets: Target[];
  rules: TargetingRule[];
  prerequisites: Prerequisite[];
  salt: string;
  version: number;
}

export interface ClientDataset {
  environmentKey: string;
  version: number;
  flags: Record<string, DatasetFlag>;
}

export interface EvalContext {
  key: string;
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

export interface EvalResult {
  value: FlagValue;
  variationIndex: number | null;
  reason: EvalReason;
  flagVersion?: number;
}
