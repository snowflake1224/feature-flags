import type { ClauseOp } from "./types";

/** Evaluate a single (contextValue, op, ruleValue) triple. */
export function matchSingle(contextValue: unknown, op: ClauseOp, ruleValue: string): boolean {
  switch (op) {
    case "in":
      return contextValue === ruleValue;
    case "endsWith":
      return typeof contextValue === "string" && contextValue.endsWith(ruleValue);
    default:
      return false;
  }
}
