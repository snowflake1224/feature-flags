# flagship-sdk (Python)

Python SDK for the Flagship feature-flag platform. Ships the same evaluation
engine as the server and JS SDK, so evaluation is **local, synchronous, and
identical** across languages.

## Install

```bash
pip install -e sdks/python        # local / editable
# or once published:  pip install flagship-sdk
```

## Usage

```python
from flagship import FlagshipClient

client = FlagshipClient(
    sdk_key="sdk-production-demo00000000",
    base_url="http://localhost:4000",
    polling_interval=15,
)
client.start()

context = {"key": "user-123", "country": "US", "plan": "pro"}

if client.bool_variation("new-checkout", context, default=False):
    ...  # show new checkout

# Experiments
client.track("subscribed", context, flag_key="pricing-experiment", value=19.0)
```

## Local evaluation only

```python
from flagship import Engine

engine = Engine(dataset)             # dataset dict from /sdk/dataset
result = engine.evaluate("flag-key", {"key": "u1"}, False)
print(result.value, result.reason.kind)
```

## Test

```bash
cd sdks/python && pip install -e ".[dev]" && pytest
```
