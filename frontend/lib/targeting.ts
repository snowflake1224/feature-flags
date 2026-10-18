import type { Clause, ClauseOp, SegmentRule, TargetingRule } from "./types";

export const COMMON_OPS: { value: ClauseOp; label: string; numeric?: boolean }[] = [
  { value: "in", label: "is one of" },
  { value: "notIn", label: "is not one of" },
  { value: "contains", label: "contains" },
  { value: "startsWith", label: "starts with" },
  { value: "endsWith", label: "ends with" },
  { value: "greaterThan", label: "greater than", numeric: true },
  { value: "greaterThanOrEqual", label: "at least", numeric: true },
  { value: "lessThan", label: "less than", numeric: true },
  { value: "lessThanOrEqual", label: "at most", numeric: true },
  { value: "segmentMatch", label: "is in segment" },
];

const NUMERIC = new Set<ClauseOp>([
  "greaterThan",
  "greaterThanOrEqual",
  "lessThan",
  "lessThanOrEqual",
]);

export function newRuleId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `rule-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `rule-${Date.now().toString(36)}`;
}

export function parseValueList(raw: string, op: ClauseOp): Array<string | number | boolean> {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (part === "true") return true;
      if (part === "false") return false;
      if (NUMERIC.has(op) && part !== "" && !Number.isNaN(Number(part))) return Number(part);
      return part;
    });
}

export function formatValueList(values: Array<string | number | boolean> | undefined): string {
  return (values ?? []).map(String).join(", ");
}

export function emptyClause(): Clause {
  return { attribute: "country", op: "in", values: ["US"] };
}

export function emptyRule(): TargetingRule {
  return { id: newRuleId(), description: "", clauses: [emptyClause()], variation: 0 };
}

export function emptySegmentRule(): SegmentRule {
  return { clauses: [emptyClause()] };
}

export function validateClauses(clauses: unknown, label: string): string | null {
  if (!Array.isArray(clauses) || clauses.length === 0) {
    return `${label} needs at least one clause.`;
  }
  for (const clause of clauses) {
    if (!clause || typeof clause !== "object") return `${label} has a clause that is not an object.`;
    const c = clause as Clause;
    if (!c.op) return `${label} has a clause without an operator.`;
    if (c.op !== "segmentMatch" && !c.attribute) {
      return `${label} has a clause without an attribute.`;
    }
    if (!Array.isArray(c.values) || c.values.length === 0) {
      return `${label} has a clause without values.`;
    }
  }
  return null;
}

export function validateTargetingRules(rules: unknown): string | null {
  if (!Array.isArray(rules)) return "Rules must be a JSON array.";
  for (const [index, rule] of rules.entries()) {
    if (!rule || typeof rule !== "object") return `Rule ${index + 1} must be an object.`;
    const r = rule as TargetingRule;
    if (!r.id || typeof r.id !== "string") return `Rule ${index + 1} needs a string id.`;
    const clauseError = validateClauses(r.clauses, `Rule ${index + 1}`);
    if (clauseError) return clauseError;
    const hasVariation = typeof r.variation === "number";
    const hasRollout = !!r.rollout && Array.isArray(r.rollout.variations) && r.rollout.variations.length > 0;
    if (!hasVariation && !hasRollout) {
      return `Rule ${index + 1} must serve a variation or a rollout.`;
    }
  }
  return null;
}

export function validateSegmentRules(rules: unknown): string | null {
  if (!Array.isArray(rules)) return "Rules must be a JSON array.";
  for (const [index, rule] of rules.entries()) {
    if (!rule || typeof rule !== "object") return `Rule ${index + 1} must be an object.`;
    const r = rule as SegmentRule;
    const clauseError = validateClauses(r.clauses, `Rule ${index + 1}`);
    if (clauseError) return clauseError;
    if (r.weight !== undefined && (typeof r.weight !== "number" || r.weight < 0 || r.weight > 100)) {
      return `Rule ${index + 1} weight must be between 0 and 100.`;
    }
  }
  return null;
}

export function parseContextList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function slugKey(name: string, lowercase = false): string {
  const slug = name
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return lowercase ? slug.toLowerCase() : slug;
}

const FLAG_KEY = /^[a-zA-Z0-9-_.]+$/;
const PROJECT_KEY = /^[a-z0-9-]+$/;

export function validateFlagKey(key: string): string | null {
  if (!key.trim()) return "Key is required.";
  if (!FLAG_KEY.test(key.trim())) return "Use letters, numbers, dashes, underscores, or dots.";
  return null;
}

export function validateProjectKey(key: string): string | null {
  if (!key.trim()) return "Key is required.";
  if (!PROJECT_KEY.test(key.trim())) return "Use lowercase letters, numbers, and dashes.";
  return null;
}

export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
