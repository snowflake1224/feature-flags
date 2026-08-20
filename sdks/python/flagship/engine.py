"""Flagship evaluation engine (Python).

A faithful port of the TypeScript engine so server-side Python services and
the JS SDK evaluate identically for the same dataset and context.
"""
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set

from .hashing import bucket, pick_variation
from .operators import match_single


@dataclass
class EvalReason:
    kind: str
    rule_id: Optional[str] = None
    rule_index: Optional[int] = None
    prerequisite_key: Optional[str] = None
    error_kind: Optional[str] = None


@dataclass
class EvalResult:
    value: Any
    variation_index: Optional[int]
    reason: EvalReason
    flag_version: Optional[int] = None


@dataclass
class Engine:
    dataset: Dict[str, Any] = field(default_factory=dict)

    @property
    def version(self) -> int:
        return self.dataset.get("version", 0)

    def update(self, dataset: Dict[str, Any]):
        self.dataset = dataset

    def all_flag_keys(self) -> List[str]:
        return list(self.dataset.get("flags", {}).keys())

    def evaluate(self, flag_key: str, context: Dict[str, Any], default_value: Any) -> EvalResult:
        flag = self.dataset.get("flags", {}).get(flag_key)
        if not flag:
            return EvalResult(default_value, None, EvalReason("ERROR", error_kind="FLAG_NOT_FOUND"))
        return self._evaluate_flag(flag, context, default_value, set())

    def _evaluate_flag(self, flag, context, default_value, seen: Set[str]) -> EvalResult:
        if flag["key"] in seen:
            return EvalResult(default_value, None, EvalReason("ERROR", error_kind="MALFORMED_FLAG"))
        seen.add(flag["key"])

        # 1. Prerequisites
        for pre in flag.get("prerequisites", []):
            pre_flag = self.dataset.get("flags", {}).get(pre["flagKey"])
            if not pre_flag:
                return self._off(flag, default_value, EvalReason("PREREQUISITE_FAILED", prerequisite_key=pre["flagKey"]))
            pre_result = self._evaluate_flag(pre_flag, context, None, seen)
            if not pre_flag.get("on") or pre_result.variation_index != pre["variation"]:
                return self._off(flag, default_value, EvalReason("PREREQUISITE_FAILED", prerequisite_key=pre["flagKey"]))

        # 2. Kill switch
        if not flag.get("on"):
            return self._off(flag, default_value, EvalReason("OFF"))

        # 3. Individual targets
        for target in flag.get("targets", []):
            if context.get("key") in target.get("values", []):
                return self._result(flag, target["variation"], default_value, EvalReason("TARGET_MATCH"))

        # 4. Rules
        for i, rule in enumerate(flag.get("rules", [])):
            if all(self._match_clause(c, context) for c in rule.get("clauses", [])):
                return self._resolve(flag, rule, context, default_value, EvalReason("RULE_MATCH", rule_id=rule.get("id"), rule_index=i))

        # 5. Fallthrough
        return self._resolve(flag, flag.get("fallthrough", {}), context, default_value, EvalReason("FALLTHROUGH"))

    def _match_clause(self, clause, context) -> bool:
        if clause["op"] == "segmentMatch":
            result = any(self._match_segment(self.dataset.get("segments", {}).get(str(s)), context) for s in clause.get("values", []))
        else:
            cv = self._attr(context, clause["attribute"])
            values = clause.get("values", [])
            if isinstance(cv, list):
                result = any(match_single(x, clause["op"], rv) for x in cv for rv in values)
            else:
                result = any(match_single(cv, clause["op"], rv) for rv in values)
        return (not result) if clause.get("negate") else result

    def _match_segment(self, segment, context) -> bool:
        if not segment:
            return False
        key = context.get("key")
        if key in segment.get("excluded", []):
            return False
        if key in segment.get("included", []):
            return True
        for rule in segment.get("rules", []):
            ok = True
            for c in rule.get("clauses", []):
                cv = self._attr(context, c["attribute"])
                values = c.get("values", [])
                if isinstance(cv, list):
                    r = any(match_single(x, c["op"], rv) for x in cv for rv in values)
                else:
                    r = any(match_single(cv, c["op"], rv) for rv in values)
                if c.get("negate"):
                    r = not r
                if not r:
                    ok = False
                    break
            if not ok:
                continue
            if "weight" not in rule or rule["weight"] is None:
                return True
            by = str(self._attr(context, rule.get("bucketBy", "key")) or key)
            if bucket(segment["key"], segment["salt"], by) < rule["weight"] / 100.0:
                return True
        return False

    def _resolve(self, flag, vr, context, default_value, reason) -> EvalResult:
        rollout = vr.get("rollout")
        if rollout:
            bucket_by = rollout.get("bucketBy", "key")
            by = str(self._attr(context, bucket_by) or context.get("key"))
            point = bucket(flag["key"], flag["salt"], by, rollout.get("seed"))
            variation = pick_variation(point, rollout["variations"])
            return self._result(flag, variation, default_value, reason)
        return self._result(flag, vr.get("variation", flag["offVariation"]), default_value, reason)

    def _off(self, flag, default_value, reason) -> EvalResult:
        return self._result(flag, flag["offVariation"], default_value, reason)

    def _result(self, flag, variation_index, default_value, reason) -> EvalResult:
        variations = flag.get("variations", [])
        if variation_index is None or variation_index >= len(variations):
            return EvalResult(default_value, None, EvalReason("ERROR", error_kind="MALFORMED_FLAG"))
        return EvalResult(variations[variation_index], variation_index, reason, flag.get("version"))

    def _attr(self, context, path: str):
        if path == "key":
            return context.get("key")
        if path in context:
            return context[path]
        if "." not in path:
            return None
        cur = context
        for part in path.split("."):
            if isinstance(cur, dict) and part in cur:
                cur = cur[part]
            else:
                return None
        return cur
