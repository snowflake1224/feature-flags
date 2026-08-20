"""Stable rollout bucketing — must match the TypeScript engine exactly."""
import hashlib
from typing import List, Dict

_LONG_SCALE = 0xFFFFFFFFFFFFFFF  # 15 hex F's => 60 bits


def bucket(key: str, salt: str, bucket_by: str, seed: int | None = None) -> float:
    """Map (key, salt, bucket_by) deterministically into [0, 1).

    Identical inputs always yield the same point, which is what makes
    percentage rollouts sticky as you scale them up.
    """
    prefix = f"{seed}." if seed is not None else ""
    hash_input = f"{prefix}{key}.{salt}.{bucket_by}"
    digest = hashlib.sha1(hash_input.encode("utf-8")).hexdigest()[:15]
    value = int(digest, 16)
    return value / _LONG_SCALE


def pick_variation(point: float, variations: List[Dict]) -> int:
    """Pick a variation index from weighted variations (weights are 0..100)."""
    total = 0.0
    for wv in variations:
        total += wv["weight"] / 100.0
        if point < total:
            return wv["variation"]
    return variations[-1]["variation"] if variations else 0
