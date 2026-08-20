# @flagship/sdk

JavaScript / Node.js SDK for the Flagship feature-flag platform. Ships the same
pure evaluation engine the server uses, so flag reads are **local, synchronous,
and sub-millisecond** — no network hop on the hot path.

## Install

```bash
npm install @flagship/sdk
```

## Quick start

```ts
import { FlagshipClient } from "@flagship/sdk";

const client = new FlagshipClient({
  sdkKey: "sdk-prod-xxxxxxxx",
  baseUrl: "https://flags.example.com",
  mode: "streaming", // near-real-time kill switches via SSE
});

await client.start();

const context = { key: "user-123", country: "US", plan: "pro" };

if (client.boolVariation("new-checkout", context, false)) {
  // ...show new checkout
}

// Experiments
await client.track("checkout_completed", context, { value: 49.0 });
```

## Data source modes

| Mode        | Freshness           | Cost                      | Use for                    |
| ----------- | ------------------- | ------------------------- | -------------------------- |
| `streaming` | near-real-time (ms) | 1 long-lived SSE conn     | kill switches, most apps   |
| `polling`   | `pollingIntervalMs` | 1 request per interval    | restricted networks, batch |

## Stale config behavior

If the server is unreachable the SDK keeps serving the last dataset. Set
`maxStalenessMs` to fail back to your in-code defaults after a threshold.

## Local evaluation only

You can use the engine without any network — e.g. in tests or edge workers:

```ts
import { Engine } from "@flagship/sdk/engine";

const engine = new Engine(dataset);
const { value, reason } = engine.evaluate("flag-key", { key: "u1" }, false);
```

## Testing

```bash
npm test
```
