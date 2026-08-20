"""Minimal Python example.

Run the backend + seed first, install the SDK, then:
    python examples/python-demo/main.py
"""
import os
import random
import time

from flagship import FlagshipClient

client = FlagshipClient(
    sdk_key=os.environ.get("SDK_KEY", "sdk-production-demo00000000"),
    base_url=os.environ.get("API_URL", "http://localhost:4000"),
    polling_interval=10,
)
client.start()

users = [
    {"key": "user-1", "country": "US", "email": "a@example.com"},
    {"key": "user-beta-1", "country": "DE", "email": "b@flagship.dev"},
    {"key": "user-42", "country": "FR"},
]

for u in users:
    checkout = client.bool_variation("new-checkout", u, False)
    pricing = client.string_variation("pricing-experiment", u, "control")
    print(f"{u['key']:<12} new-checkout={checkout}  pricing={pricing}")
    client.track("pricing_viewed", u, flag_key="pricing-experiment")
    if random.random() < 0.12:
        client.track("subscribed", u, flag_key="pricing-experiment", value=19)

time.sleep(1)
client.close()
