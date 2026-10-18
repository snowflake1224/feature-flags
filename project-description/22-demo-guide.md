# Demo guide

A self-contained path through the seeded **Demo Project**. The dashboard includes Flags, Segments, Experiments, Audit log, Settings, and an in-browser **Live demo** tab for the streamed dataset, local evaluation, health, and experiment events. The Node example remains useful for showing the same data-plane behavior through the published SDK.

Setup commands match the root [README](../README.md). Pattern names and tradeoffs are in [21-design-patterns.md](./21-design-patterns.md).

## Setup

Prerequisites: Node 20+, Docker, and Python 3.9+ only if you run the Python example.

```bash
npm install
npm run infra:up
npm run build:sdk
cp .env.example .env
cd backend
npm run prisma:generate
npm run db:push
npm run seed
cd ..
npm run dev:backend    # http://localhost:4000/health
npm run dev:frontend   # http://localhost:3000
```

Leave `ADMIN_API_KEY` unset for this localhost walkthrough. The control plane is open on purpose. See [Secure demo configuration](../README.md#secure-demo-configuration) before you expose the API beyond your machine.

Seed prints:

```text
Production SDK key:  sdk-production-demo00000000
Development SDK key: sdk-development-demo0000000
```

Those keys are public sample credentials baked into `backend/prisma/seed.ts`. They are not secrets.

`GET http://localhost:4000/health` should return `status: "ok"` and `checks.postgres` / `checks.redis` of `"ok"`. The handler still responds HTTP 200 when a check is `"down"`; read the JSON, not only the status code.

Reseeding deletes the existing `demo` project (cascade, including audit and events) and creates it again. Experiment counts are resampled with `Math.random()` around the rates below, so a second seed will not match the first seed’s exact conversion numbers.

## Personas

The seed does not store display names. These labels are the context keys and rules in `backend/prisma/seed.ts`, plus the three users in `examples/node-demo/index.mjs`. Salts are `checkoutsalt00000` and `pricingsalt000000`. Buckets are sticky: the same key always lands in the same place.

Production `new-checkout` is on. The `beta-users` segment is served variation 0 (`true`) before fallthrough. Fallthrough is 20% `true` / 80% `false`. Off variation is index 1 (`false`). Development fallthrough is “everyone variation 0”; do this walkthrough on **production**.

| Persona | Context | Production `new-checkout` | Why |
|---|---|---|---|
| Ada Lovelace | `ada-lovelace`, `email: ada@flagship.dev` | `true` | Named included member and domain match; seeded with deterministic experiment events. |
| Grace Hopper | `grace-hopper`, `email: grace@flagship.dev` | `true` | Named included member and domain match; seeded with deterministic experiment events. |
| Beta One | `user-beta-1`, and in the Node demo also `email: b@flagship.dev` | `true` | Listed in `beta-users.included`. The fallthrough bucket is about 0.56, which would have been `false`. The segment rule wins. |
| Beta Two | `user-beta-2` | `true` | Included |
| Beta Three | `user-beta-3` | `true` | Included |
| Employee by domain | Any other key whose `email` ends with `@flagship.dev`, and who is not in `excluded` | `true` | Segment rule `endsWith`. Not a separate seeded user row. |
| General user | `user-1` with `email: a@example.com` (Node demo) | `false` | Not in the segment. Checkout bucket about 0.57, outside the 20% band. |
| General user | `user-42` (Node demo) | `false` | Checkout bucket about 0.56. |
| Rollout hit | `user-0` | `true` if you evaluate them | Not in the segment. Checkout bucket about 0.11, inside 20%. This key is also one of the synthetic experiment users. |

`beta-users` is copied onto both environments. Included keys: `user-beta-1`, `user-beta-2`, `user-beta-3`, `ada-lovelace`, and `grace-hopper`.

Production `pricing-experiment` is a 50/50 string rollout (`control` = index 0, `variant` = index 1) with no targeting rules. Examples: `user-beta-2` buckets to control (about 0.42); `user-42` and `user-beta-1` bucket to variant. Attribute rules do not apply to this flag, so adding an email does not move the bucket (`bucketBy` defaults to the context key).

## Browser walkthrough

1. Open `http://localhost:3000`. You should see **Demo Project**. Open it. The dashboard selects the **production** environment (the red production badge).
2. **Flags.** Two flags: **New Checkout Flow** (`new-checkout`, on) and **Pricing Page Experiment** (`pricing-experiment`, on). The checkout flag’s production rule targets `beta-users`; fallthrough is the 20/80 rollout.
3. Optional check from the flag’s test-targeting action: context key `user-beta-1` evaluates to `true` with a rule match; `user-1` evaluates to `false` with fallthrough. Switch the environment to **development** and `user-1` becomes `true` (fallthrough variation 0). Switch back to production before the kill switch.
4. **Segments.** `beta-users` shows the included keys (`user-beta-1`, `user-beta-2`, `user-beta-3`, `ada-lovelace`, `grace-hopper`) and the `@flagship.dev` email rule.
5. **Live demo.** Wait for the authenticated stream to show `live` and its initial `put`. Evaluate `user-beta-1`, then use **Compare** to place the browser-local and server results side by side. The Node example in the next section is the same stream from a process.
6. Turn `new-checkout` off from the Live demo. That is the kill switch: one config update, an audit row, a dataset rebuild, a `patch`, and an authenticated re-fetch. Production changes require confirmation.
7. **Audit log.** A new row appears for that flag. The actor is the `x-actor-email` header. **Settings → Operator identity** saves it in this browser and the next request sends it, with no reload. The default is `demo@flagship.dev` (`localStorage["flagship.actor"]`). The header badge shows that same actor. The admin API key on the same card (`localStorage["flagship.adminKey"]`) is sent as `x-api-key` when the field is not blank. Those values stay in local storage, not in git.
8. **Experiments.** Open **Pricing Layout A/B** (`pricing-ab`) on production. You should see exposures and a higher conversion rate on the variant than on control, usually called significant. The seed aims at about 10% (control) and 14% (variant) over `user-0` … `user-3999`. It is a random sample, not a fixed fixture, and the test peeks at the whole sample with no multiple-comparison correction. Say that out loud if someone treats the p-value as a finished analysis.
9. **Settings.** The production key matches the seed string while it is still active. The on-screen sentence that rotation disables old keys immediately is true for the Postgres `active` flag and for the new key. It is not true for a process that already cached the old key (see troubleshooting). This tab is also where you edit the actor email and the admin API key.

> **TODO (screenshot):** Projects list with Demo Project. Do not point an image tag at a file that is not in the repo.
>
> **TODO (screenshot):** Production flags, `new-checkout` on, environment badge visible.
>
> **TODO (GIF):** Kill switch off, then the Node process logging a dataset update and `new-checkout=false`.

## Expected realtime behavior

With the API up and the production key unchanged:

```bash
node examples/node-demo/index.mjs
```

You should see Beta One on the new checkout and `user-1` / `user-42` off, then the process waits up to 60 seconds.

When you turn the flag off in the dashboard:

1. `FlagsService` updates that environment’s `FlagConfig` (`on`, version increment), writes the audit row, and calls `DatasetService.refresh`.
2. Redis `SET`s `flagship:dataset:{environmentId}` and `PUBLISH`es `flagship:changes:{environmentId}` with `{ version }`.
3. Every API process subscribed to that channel writes an SSE `patch` to its open streams. The JS SDK does not apply the patch body as a dataset. It `GET`s `/sdk/dataset` and replaces local state unless the new version is **strictly older**.
4. `onChange` runs. The example logs `new-checkout=false` for `user-1` (the off variation). Beta One is `false` too: a kill switch ignores the segment.

End-to-end is Redis pub/sub plus one dataset fetch, typically well under a second on localhost. It is not a push of the full ruleset inside the patch.

Python does not stream:

```bash
pip install -e sdks/python
python examples/python-demo/main.py
```

That client polls (default 15s). A kill switch shows up on the next poll, not on the SSE path.

One local caveat: many SSE clients on the **same** API process share one Redis subscriber connection. Disconnecting one stream must not `UNSUBSCRIBE` the channel while another stream still needs it. If a second Node process stops seeing updates after the first one exits, that shared subscription is the first place to look (`backend/src/redis/redis.service.ts`).

The dashboard **Live demo** tab shows the same sequence in the browser: connection state, dataset version, `put` then `patch`, refresh latency, and the flag value evaluated locally. Browser `EventSource` cannot send the SDK bearer token, so the tab uses `fetch` streaming. The Node command above remains the alternative when you want that log outside the page.

## Experiments and event simulation

**Already in the seed.** Production events `pricing_viewed` (exposure) and `subscribed` (goal) for `user-0` … `user-3999`, variation taken from the same bucket function the engine uses, goal value `19` either way. Results group unique `contextKey`s and run a two-proportion z-test against variation 0. The experiment row exists only on production, so the development environment looks empty.

**Sending more events from Node.** The Node example calls `track` for `pricing_viewed` and sometimes `subscribed`. Those rows show up after you refresh experiment results. `track` is fire-and-forget in the SDK; a failed POST is logged and does not change the flag value.

**In-browser simulator.** The Live demo tab uses the active environment SDK key to post exposure and conversion events. Edit the context, provide the experiment flag and event names, send both events, then refresh the selected experiment’s summary without leaving the page. Off the page, the Node example still calls `track`, and `POST /sdk/events` with `Authorization: Bearer sdk-production-demo00000000` does the same.

**Attribution.** Ingest stores `contextKey` and, when `flagKey` is set, stamps `variationIndex` with the evaluation engine. The client sends the full evaluation context (key plus attributes) on that path and the API still accepts a body that only has `contextKey`. Pricing rollout ignores attributes, so extra fields do not move these seeded users. A flag with an email or segment rule **does** need the attributes; key-only attribution would mis-label those events. Aggregation still keys off the stored `contextKey`, not the attribute bag.

## Troubleshooting

| What you see | What it usually is |
|---|---|
| Dashboard “Could not reach API” | Backend not on port 4000, or `NEXT_PUBLIC_API_URL` pointing elsewhere. Restart the Next dev server after changing that variable; it is inlined at build/start. |
| Health `postgres` or `redis` is `down` | `npm run infra:up`, then confirm `DATABASE_URL` and `REDIS_URL` in `.env`. |
| Empty project list | Seed did not run, or it ran against a different database than the API. |
| Kill switch does not move the Node demo | Demo already exited (it closes after 60s), wrong SDK key, or you toggled **development** while the example uses the production key. |
| Second stream goes quiet when the first disconnects | Shared Redis subscriber dropped the channel. See realtime section. |
| Rotated key still works for a bit | Postgres marks it inactive immediately and the new key works on first use. `SdkAuthService` keeps a **successful** lookup in a per-process `Map` for 30 seconds and does not delete that entry on rotate. Another API instance has its own map. Invalid keys are not negative-cached. |
| `401` on the dashboard after you set `ADMIN_API_KEY` | Control-plane routes require `x-api-key`. In **Settings**, paste the key into **Admin API key** and choose **Save identity**. It is kept in browser local storage and sent on later dashboard requests. Unset `ADMIN_API_KEY` when you want the localhost API open with no key. |
| Experiment looks empty | Environment is development, or the seed was wiped. |
| Variant is not “significant” | Possible. Rates are random around 10% and 14%. Reseed or treat it as a noisy sample. |
| Segment edit and the Node client does not change | Confirm you saved the **production** segment and the client applied a **newer** dataset version. Segment updates increment `Segment.version` so the environment version moves. A client that already exited will not show it. |

`JWT_SECRET` in `.env.example` is unused by application code. Setting it does not lock the API.

## Interview talking points

Use the demo as the spine, then the limits. Longer answers are in [20-interview-deep-dive.md](./20-interview-deep-dive.md) and [21-design-patterns.md](./21-design-patterns.md).

1. **One process, two paths.** Show the toggle hitting Postgres and the SDK reading Redis. Planes are logical. Cloud Run does not scale them separately.
2. **Kill switch sequence.** Version bump, audit insert, Redis `SET` + `PUBLISH`, SSE `patch`, client `GET`, local `evaluate`. Patch body is not the ruleset.
3. **Why Beta One stays on until the kill switch.** Included segment beats a fallthrough bucket that would have been false. After `on: false`, everyone gets `offVariation`.
4. **Stickiness.** `user-42`’s pricing variation is a pure function of flag key, salt, and context key. Ramping 10% to 20% does not evict the 10%. No user-assignment table.
5. **Experiments stamp variation at ingest** with the same engine, using the full context when the client sent it, so later rule edits do not rewrite history. Results are an in-memory z-test, not a warehouse.
6. **Volunteer three limits.** Open admin API unless `ADMIN_API_KEY` is set (Settings sends that key after you save it); 30s per-process auth cache after rotation; Python polls and is a port. Bucket and representative evaluation are checked against `testdata/golden-vectors.json`, shared with the TypeScript tests. The Python client is still not the TypeScript package.
