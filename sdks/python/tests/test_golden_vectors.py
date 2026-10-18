"""Parity with packages/sdk-js against testdata/golden-vectors.json."""
import json
from pathlib import Path

import pytest

from flagship import Engine, bucket


def load_golden_vectors():
    """Walk up from this file and the process cwd so pytest can start in sdks/python or the repo root."""
    starts = [Path(__file__).resolve().parent, Path.cwd()]
    seen = set()
    for start in starts:
        current = start
        for _ in range(12):
            if current in seen:
                break
            seen.add(current)
            candidate = current / "testdata" / "golden-vectors.json"
            if candidate.is_file():
                return json.loads(candidate.read_text(encoding="utf-8"))
            if current.parent == current:
                break
            current = current.parent
    raise FileNotFoundError("testdata/golden-vectors.json not found from " + ", ".join(str(s) for s in starts))


GOLDEN = load_golden_vectors()


def _shared_result(result):
    reason = {"kind": result.reason.kind}
    if result.reason.rule_id is not None:
        reason["ruleId"] = result.reason.rule_id
    if result.reason.rule_index is not None:
        reason["ruleIndex"] = result.reason.rule_index
    if result.reason.prerequisite_key is not None:
        reason["prerequisiteKey"] = result.reason.prerequisite_key
    if result.reason.error_kind is not None:
        reason["errorKind"] = result.reason.error_kind
    out = {
        "value": result.value,
        "variationIndex": result.variation_index,
        "reason": reason,
    }
    if result.flag_version is not None:
        out["flagVersion"] = result.flag_version
    return out


def test_fixture_covers_seed_and_no_seed():
    seeds = [row.get("seed", None) for row in GOLDEN["buckets"]]
    assert any(seed is None for seed in seeds)
    assert 0 in seeds
    assert any(isinstance(seed, int) and seed != 0 for seed in seeds)


@pytest.mark.parametrize("row", GOLDEN["buckets"], ids=[row["name"] for row in GOLDEN["buckets"]])
def test_bucket_matches_golden_vector(row):
    if "seed" in row:
        point = bucket(row["key"], row["salt"], row["bucketBy"], row["seed"])
    else:
        point = bucket(row["key"], row["salt"], row["bucketBy"])
    assert point == row["expected"]


@pytest.mark.parametrize("row", GOLDEN["evaluations"], ids=[row["name"] for row in GOLDEN["evaluations"]])
def test_evaluation_matches_golden_vector(row):
    result = Engine(row["dataset"]).evaluate(row["flagKey"], row["context"], row["defaultValue"])
    assert _shared_result(result) == row["expected"]


def test_seed_changes_rollout_variation():
    plain = next(row for row in GOLDEN["evaluations"] if row["name"] == "rollout no seed")
    seeded = next(row for row in GOLDEN["evaluations"] if row["name"] == "rollout seed 4")
    assert plain["expected"]["variationIndex"] != seeded["expected"]["variationIndex"]
