"""Clause operators — mirror of the TypeScript implementation."""
import re
from datetime import datetime
from typing import Any


def _to_number(v: Any):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v)
        except ValueError:
            return None
    return None


def _to_date(v: Any):
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp() * 1000
        except ValueError:
            return None
    return None


def _parse_semver(v: str):
    m = re.match(r"^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?", str(v).strip())
    if not m:
        return None
    return ([int(m.group(1)), int(m.group(2)), int(m.group(3))], m.group(4))


def _compare_semver(a: str, b: str):
    pa, pb = _parse_semver(a), _parse_semver(b)
    if pa is None or pb is None:
        return None
    for i in range(3):
        if pa[0][i] != pb[0][i]:
            return -1 if pa[0][i] < pb[0][i] else 1
    if pa[1] == pb[1]:
        return 0
    if pa[1] is None:
        return 1
    if pb[1] is None:
        return -1
    return -1 if pa[1] < pb[1] else 1


def match_single(context_value: Any, op: str, rule_value: Any) -> bool:
    if op == "in":
        return context_value == rule_value
    if op == "notIn":
        return context_value != rule_value
    if op == "contains":
        return isinstance(context_value, str) and str(rule_value) in context_value
    if op == "startsWith":
        return isinstance(context_value, str) and context_value.startswith(str(rule_value))
    if op == "endsWith":
        return isinstance(context_value, str) and context_value.endswith(str(rule_value))
    if op == "matchesRegex":
        try:
            return isinstance(context_value, str) and re.search(str(rule_value), context_value) is not None
        except re.error:
            return False
    if op in ("greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual"):
        a, b = _to_number(context_value), _to_number(rule_value)
        if a is None or b is None:
            return False
        return {
            "greaterThan": a > b,
            "greaterThanOrEqual": a >= b,
            "lessThan": a < b,
            "lessThanOrEqual": a <= b,
        }[op]
    if op in ("semverEqual", "semverGreaterThan", "semverLessThan"):
        c = _compare_semver(str(context_value), str(rule_value))
        return {
            "semverEqual": c == 0,
            "semverGreaterThan": c == 1,
            "semverLessThan": c == -1,
        }[op]
    if op in ("before", "after"):
        a, b = _to_date(context_value), _to_date(rule_value)
        if a is None or b is None:
            return False
        return a < b if op == "before" else a > b
    return False
