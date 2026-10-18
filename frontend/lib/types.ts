/** Pragmatic control-plane and data-plane shapes used by the dashboard. */

export type FlagKind = "boolean" | "string" | "number" | "json";
export type FlagValue = boolean | string | number | Record<string, unknown> | unknown[] | null;

export type ClauseOp =
  | "in"
  | "notIn"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "matchesRegex"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "lessThan"
  | "lessThanOrEqual"
  | "semverEqual"
  | "semverGreaterThan"
  | "semverLessThan"
  | "before"
  | "after"
  | "segmentMatch";

export interface Clause {
  attribute: string;
  op: ClauseOp;
  values: Array<string | number | boolean>;
  negate?: boolean;
}

export interface WeightedVariation {
  variation: number;
  weight: number;
}

export interface Rollout {
  variations: WeightedVariation[];
  bucketBy?: string;
  seed?: number;
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

export interface SegmentRule {
  clauses: Clause[];
  weight?: number;
  bucketBy?: string;
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

export interface Segment {
  id: string;
  key: string;
  name: string;
  description?: string;
  included: string[];
  excluded: string[];
  rules: SegmentRule[];
  salt?: string;
}

export interface SegmentInput {
  key: string;
  name: string;
  description?: string;
  included?: string[];
  excluded?: string[];
  rules?: SegmentRule[];
}

export interface Experiment {
  id: string;
  key: string;
  name: string;
  flagKey: string;
  exposureEvent: string;
  goalEvent: string;
  metricKind: "binary" | "numeric" | string;
  environmentId?: string;
  createdAt?: string;
}

export interface CreateExperimentInput {
  key: string;
  name: string;
  flagKey: string;
  exposureEvent: string;
  goalEvent: string;
  metricKind?: "binary" | "numeric";
}

export interface ExperimentVariationResult {
  variationIndex: number;
  value: unknown;
  isControl: boolean;
  exposures: number;
  conversions: number;
  conversionRate: number;
  avgValue: number;
  totalValue: number;
  z: number;
  pValue: number;
  relativeUplift: number;
  significant: boolean;
}

export interface ExperimentResults {
  experiment: Experiment;
  totalExposures: number;
  variations: ExperimentVariationResult[];
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

export interface DatasetSegment {
  key: string;
  included: string[];
  excluded: string[];
  rules: SegmentRule[];
  salt: string;
}

export interface ClientDataset {
  environmentKey: string;
  version: number;
  flags: Record<string, DatasetFlag>;
  segments: Record<string, DatasetSegment>;
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
  errorKind?: "FLAG_NOT_FOUND" | "MALFORMED_FLAG" | "WRONG_TYPE";
  inExperiment?: boolean;
}

export interface EvalResult {
  value: FlagValue;
  variationIndex: number | null;
  reason: EvalReason;
  flagVersion?: number;
}

/** Metric event. `context` is accepted alongside `contextKey` when the API supports it. */
export interface SdkEventInput {
  eventKey: string;
  contextKey: string;
  context?: EvalContext;
  flagKey?: string;
  value?: number;
  metadata?: Record<string, unknown>;
  ts?: number;
}

export interface StreamMessage {
  event: string;
  data: string;
}
