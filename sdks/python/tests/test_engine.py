from flagship import Engine, bucket


def base_flag(**overrides):
    flag = {
        "key": "f",
        "on": True,
        "variations": [True, False],
        "offVariation": 1,
        "fallthrough": {"variation": 0},
        "targets": [],
        "rules": [],
        "prerequisites": [],
        "salt": "salt",
        "version": 1,
    }
    flag.update(overrides)
    return flag


def dataset(flags, segments=None):
    return {
        "environmentKey": "test",
        "version": 1,
        "flags": {f["key"]: f for f in flags},
        "segments": segments or {},
    }


def test_missing_flag_returns_default():
    e = Engine(dataset([]))
    r = e.evaluate("nope", {"key": "u1"}, "fallback")
    assert r.value == "fallback"
    assert r.reason.kind == "ERROR"


def test_kill_switch():
    e = Engine(dataset([base_flag(on=False)]))
    assert e.evaluate("f", {"key": "u1"}, False).value is False


def test_targets_win():
    e = Engine(dataset([base_flag(targets=[{"variation": 0, "values": ["vip"]}], fallthrough={"variation": 1})]))
    assert e.evaluate("f", {"key": "vip"}, False).value is True
    assert e.evaluate("f", {"key": "other"}, True).value is False


def test_rule_match():
    flag = base_flag(
        rules=[{"id": "r1", "clauses": [{"attribute": "country", "op": "in", "values": ["US"]}], "variation": 0}],
        fallthrough={"variation": 1},
    )
    e = Engine(dataset([flag]))
    assert e.evaluate("f", {"key": "u", "country": "US"}, False).value is True
    assert e.evaluate("f", {"key": "u", "country": "FR"}, True).value is False


def test_rollout_is_deterministic():
    flag = base_flag(
        variations=["a", "b"],
        fallthrough={"rollout": {"variations": [{"variation": 0, "weight": 50}, {"variation": 1, "weight": 50}]}},
    )
    e = Engine(dataset([flag]))
    first = e.evaluate("f", {"key": "stable"}, "x").value
    second = e.evaluate("f", {"key": "stable"}, "x").value
    assert first == second


def test_hashing_matches_expected_range():
    for i in range(1000):
        p = bucket("flag", "salt", f"user-{i}")
        assert 0 <= p < 1


def test_segment_match():
    flag = base_flag(
        rules=[{"id": "r1", "clauses": [{"attribute": "", "op": "segmentMatch", "values": ["beta"]}], "variation": 0}],
        fallthrough={"variation": 1},
    )
    segs = {"beta": {"key": "beta", "included": ["u1"], "excluded": [], "rules": [], "salt": "s"}}
    e = Engine(dataset([flag], segs))
    assert e.evaluate("f", {"key": "u1"}, False).value is True
    assert e.evaluate("f", {"key": "u2"}, True).value is False
