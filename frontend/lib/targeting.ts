import type { Clause, ClauseOp, TargetingRule } from "./types";

export const CLAUSE_OPS: { value: ClauseOp; label: string }[] = [
  { value: "in", label: "equals" },
  { value: "endsWith", label: "ends with" },
];

export function newRuleId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `rule-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `rule-${Date.now().toString(36)}`;
}

export function parseValueList(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function formatValueList(values: string[] | undefined): string {
  return (values ?? []).join(", ");
}

export function emptyClause(): Clause {
  return { attribute: "email", op: "endsWith", values: ["@example.com"] };
}

export function emptyRule(): TargetingRule {
  return { id: newRuleId(), description: "", clauses: [emptyClause()], variation: 0 };
}

export function validateClauses(clauses: unknown, label: string): string | null {
  if (!Array.isArray(clauses) || clauses.length === 0) {
    return `${label} needs at least one clause.`;
  }
  for (const clause of clauses) {
    if (!clause || typeof clause !== "object") return `${label} has a clause that is not an object.`;
    const c = clause as Clause;
    if (c.op !== "in" && c.op !== "endsWith") return `${label} must use "equals" or "ends with".`;
    if (!c.attribute) return `${label} has a clause without an attribute.`;
    if (!Array.isArray(c.values) || c.values.length === 0) {
      return `${label} has a clause without values.`;
    }
  }
  return null;
}

export function validateTargetingRules(rules: unknown): string | null {
  if (!Array.isArray(rules)) return "Rules must be a list.";
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
