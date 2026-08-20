"""Flagship Python client — polling data source + local evaluation."""
import threading
import time
from typing import Any, Callable, Dict, List, Optional

import requests

from .engine import Engine


class FlagshipClient:
    """Downloads the environment ruleset and refreshes it on an interval.

    Flag reads are local and synchronous (never block on the network).
    """

    def __init__(
        self,
        sdk_key: str,
        base_url: str = "http://localhost:4000",
        polling_interval: float = 15.0,
        max_staleness: float = 0.0,
        logger: Optional[Callable[[str], None]] = None,
    ):
        self.sdk_key = sdk_key
        self.base_url = base_url.rstrip("/")
        self.polling_interval = polling_interval
        self.max_staleness = max_staleness
        self._engine: Optional[Engine] = None
        self._last_updated = 0.0
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._log = logger or (lambda msg: None)

    def _headers(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {self.sdk_key}", "Content-Type": "application/json"}

    def start(self):
        self._fetch()
        self._thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._thread.start()

    def _poll_loop(self):
        while not self._stop.wait(self.polling_interval):
            try:
                self._fetch()
            except Exception as e:  # noqa: BLE001
                self._log(f"[flagship] poll failed: {e}")

    def _fetch(self):
        resp = requests.get(f"{self.base_url}/sdk/dataset", headers=self._headers(), timeout=10)
        resp.raise_for_status()
        dataset = resp.json()
        with self._lock:
            if self._engine is None:
                self._engine = Engine(dataset)
            elif dataset.get("version", 0) >= self._engine.version:
                self._engine.update(dataset)
            self._last_updated = time.time()

    def _is_stale(self) -> bool:
        if self.max_staleness == 0:
            return False
        return (time.time() - self._last_updated) > self.max_staleness

    def variation(self, flag_key: str, context: Dict[str, Any], default_value: Any):
        with self._lock:
            if self._engine is None or self._is_stale():
                from .engine import EvalReason, EvalResult

                return EvalResult(default_value, None, EvalReason("ERROR"))
            return self._engine.evaluate(flag_key, context, default_value)

    def bool_variation(self, flag_key: str, context: Dict[str, Any], default: bool = False) -> bool:
        return bool(self.variation(flag_key, context, default).value)

    def string_variation(self, flag_key: str, context: Dict[str, Any], default: str = "") -> str:
        return str(self.variation(flag_key, context, default).value)

    def number_variation(self, flag_key: str, context: Dict[str, Any], default: float = 0) -> float:
        return self.variation(flag_key, context, default).value

    def json_variation(self, flag_key: str, context: Dict[str, Any], default: Any) -> Any:
        return self.variation(flag_key, context, default).value

    def all_flags(self, context: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            if self._engine is None:
                return {}
            return {k: self._engine.evaluate(k, context, None).value for k in self._engine.all_flag_keys()}

    def track(self, event_key: str, context: Dict[str, Any], flag_key: Optional[str] = None,
              value: Optional[float] = None, metadata: Optional[Dict[str, Any]] = None):
        """Fire-and-forget metric event (exposure/conversion)."""
        try:
            requests.post(
                f"{self.base_url}/sdk/events",
                headers=self._headers(),
                json={
                    "eventKey": event_key,
                    "contextKey": context.get("key"),
                    "flagKey": flag_key,
                    "value": value,
                    "metadata": metadata,
                    "ts": int(time.time() * 1000),
                },
                timeout=5,
            )
        except Exception as e:  # noqa: BLE001
            self._log(f"[flagship] track failed: {e}")

    def close(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=1)
