import type { ClauseOp } from "./types";

/**
 * A minimal, dependency-free semver comparison. Handles MAJOR.MINOR.PATCH with
 * optional pre-release. Returns -1 | 0 | 1, or null if either side is unparseable.
 */
function compareSemver(a: string, b: string): number | null {
  const parse = (v: string) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(v).trim());
    if (!m) return null;
    return {
      nums: [Number(m[1]), Number(m[2]), Number(m[3])],
      pre: m[4] ?? null,
    };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] < pb.nums[i] ? -1 : 1;
  }
  // A version without pre-release outranks one with pre-release.
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function toDate(v: unknown): number | null {
  if (typeof v === "number") return v; // treat as epoch millis
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/**
 * Evaluate a single (contextValue, op, ruleValue) triple. Segment matching is
 * handled by the engine, not here, because it needs the full dataset.
 */
export function matchSingle(
  contextValue: unknown,
  op: ClauseOp,
  ruleValue: string | number | boolean,
): boolean {
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
    case "greaterThan": {
      const a = toNumber(contextValue), b = toNumber(ruleValue);
      return a !== null && b !== null && a > b;
    }
    case "greaterThanOrEqual": {
      const a = toNumber(contextValue), b = toNumber(ruleValue);
      return a !== null && b !== null && a >= b;
    }
    case "lessThan": {
      const a = toNumber(contextValue), b = toNumber(ruleValue);
      return a !== null && b !== null && a < b;
    }
    case "lessThanOrEqual": {
      const a = toNumber(contextValue), b = toNumber(ruleValue);
      return a !== null && b !== null && a <= b;
    }
    case "semverEqual": {
      const c = compareSemver(String(contextValue), String(ruleValue));
      return c === 0;
    }
    case "semverGreaterThan": {
      const c = compareSemver(String(contextValue), String(ruleValue));
      return c === 1;
    }
    case "semverLessThan": {
      const c = compareSemver(String(contextValue), String(ruleValue));
      return c === -1;
    }
    case "before": {
      const a = toDate(contextValue), b = toDate(ruleValue);
      return a !== null && b !== null && a < b;
    }
    case "after": {
      const a = toDate(contextValue), b = toDate(ruleValue);
      return a !== null && b !== null && a > b;
    }
    case "segmentMatch":
      // resolved in the engine
      return false;
    default:
      return false;
  }
}
