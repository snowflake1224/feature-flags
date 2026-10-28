import type { Environment, EvalReason } from "./types";

export function activeSdkKey(env: Environment | undefined): string | null {
  return env?.sdkKeys?.find((key) => key.active)?.key ?? null;
}

export function describeReason(reason: EvalReason | undefined): string {
  if (!reason) return "No evaluation yet.";
  switch (reason.kind) {
    case "OFF":
      return "Kill switch is off, so everyone receives the off variation.";
    case "TARGET_MATCH":
      return "The context key is individually targeted.";
    case "RULE_MATCH":
      return `Matched rule ${reason.ruleId ?? reason.ruleIndex ?? ""}.`.trim();
    case "PREREQUISITE_FAILED":
      return `Prerequisite ${reason.prerequisiteKey ?? "flag"} did not serve the required variation.`;
    case "FALLTHROUGH":
      return "No rule matched. Serving the fallthrough variation or rollout.";
    case "ERROR":
      return reason.errorKind === "FLAG_NOT_FOUND"
        ? "Flag is not in this environment dataset."
        : `Evaluation error${reason.errorKind ? `: ${reason.errorKind}` : ""}.`;
    default:
      return reason.kind;
  }
}