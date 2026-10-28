# @flagship/sdk

JavaScript client for Flagship. It fetches the environment's flag set, re-fetches
it every few seconds, and evaluates flags locally against the copy it holds. A
flag read never waits on the network.

## Quick start

```ts
import { FlagshipClient } from "@flagship/sdk";

const client = new FlagshipClient({
  sdkKey: "sdk-production-demo00000000",
  baseUrl: "http://localhost:4000",
  pollingIntervalMs: 5_000,
});

await client.start();

if (client.boolVariation("new-checkout", { key: "user-123", email: "a@example.com" }, false)) {
  // ...show new checkout
}
```

A dashboard toggle takes effect on the next fetch, so the worst case is one
polling interval.

## Stale config

If the server is unreachable the client keeps serving the last flag set. Set
`maxStalenessMs` to fall back to your in-code defaults after a threshold.

## Local evaluation only

```ts
import { Engine } from "@flagship/sdk/engine";

const engine = new Engine(dataset);
const { value, reason } = engine.evaluate("flag-key", { key: "u1" }, false);
```
