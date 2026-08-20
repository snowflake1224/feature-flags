"""Flagship feature-flag SDK for Python."""
from .client import FlagshipClient
from .engine import Engine, EvalResult, EvalReason
from .hashing import bucket, pick_variation
from .operators import match_single

__all__ = [
    "FlagshipClient",
    "Engine",
    "EvalResult",
    "EvalReason",
    "bucket",
    "pick_variation",
    "match_single",
]
__version__ = "0.1.0"
