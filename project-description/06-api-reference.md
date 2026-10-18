# API reference

Base URL local default: `http://localhost:4000`. No global path prefix (`main.ts:15`).

**Default status codes:** Nest/Express 200 with JSON body unless an `HttpException` is thrown (`401`, `400`, `404`). **No custom exception filter.** Validation failures: 400 from `ValidationPipe`. Unhandled Prisma errors: 500.

**Rate limiting:** not present.

**WebSockets:** not present. SSE is documented under data plane.

---

## Shared: control-plane auth

- **Guard:** `AdminGuard` on all `/projects...` controllers listed below.
- If `ADMIN_API_KEY` env is **unset**: all requests allowed.
- If set: header `x-api-key` must match, else `401` `{ statusCode, message: "invalid admin api key" }`.
- **Actor (not auth):** `x-actor-email` or `x-actor`, else `"system"` (`actor.decorator.ts`).
- Dashboard sends `Content-Type: application/json` and `x-actor-email` (`frontend/lib/api.ts:11-14`). Dashboard **does not send** `x-api-key`.

CORS: `origin` from `CORS_ORIGIN` comma-separated or `*`; `credentials: true` (`main.ts:8-11`).

---

## `GET /health`

**Auth:** none.

**Purpose:** liveness-ish dependency check.

**Response:** `{ status: "ok" | "degraded", checks: { postgres, redis }, ts: ISO string }`.

**DB:** `SELECT 1`. **Cache:** Redis `PING`.

**HTTP status:** 200 even if degraded (`health.controller.ts:13-28`).

---

## Projects

### `POST /projects`

**Purpose:** create project + production/development envs + SDK keys.

**Body:** `{ key: string, name: string }`  
**Validation:** `key` `/^[a-z0-9-]+$/`, `name` string.

**Response:** project including environments and sdkKeys (`get` after create).

**DB:** nested create; two `sdkKey` inserts; audit insert.

### `GET /projects`

**Response:** projects ordered `createdAt desc`, include environments, `_count.flags`.

### `GET /projects/:projectId`

**404** if missing.

**Response:** environments include `sdkKeys`.

### `POST /projects/environments/:environmentId/rotate-key`

**DB:** deactivate keys; insert new; audit.

**404/500:** `findUniqueOrThrow` if env missing (Prisma → 500 unless mapped — **not mapped**, so missing id is likely 500).

---

## Flags — `/projects/:projectId/flags`

### `POST /`

**Body:** `{ key, name, description?, kind?, variations?, temporary?, tags? }`  
**Validation:** key `/^[a-zA-Z0-9-_.]+$/`; kind in boolean|string|number|json.

**400:** fewer than one variation (`flags.service.ts:39-41`).

**Default variations:** `[true,false]` if boolean or kind omitted; else `[]` which then fails the length check unless provided.

**Side effects:** refresh **all** environments.

### `GET /`

List flags with configs+environment, `updatedAt desc`.

### `GET /:key`

**404** flag not found.

### `PATCH /:key/environments/:environmentId`

**Body (unvalidated JSON):** `on?`, `offVariation?`, `fallthrough?`, `targets?`, `rules?`, `prerequisites?`, `comment?`.

**DB:** increment version; audit `flag.updated`; refresh that env.

**404** missing flag or config for env.

### `POST /:key/environments/:environmentId/toggle`

**Body:** `{ on: boolean, comment?: string }` validated.

**Audit:** `flag.enabled` or `flag.killswitch`.

### `POST /:key/environments/:environmentId/evaluate`

**Body:** `EvalContext` (expects `key` plus attributes). Default context `{ key: "anonymous" }` if nullish.

**Response:** `EvalResult`.

**Cache:** getDataset.

### `DELETE /:key`

Deletes flag (cascade configs); refresh all env ids that had configs; audit `flag.deleted`.

---

## Segments — `/projects/:projectId/environments/:environmentId/segments`

**Note:** `projectId` is used for audit/create FK; **list does not verify** the environment belongs to the project.

### `GET /`

Segments for environment, `key asc`.

### `POST /`

**Body:** treated as `UpsertSegmentInput` (`key`, `name`, `description?`, `included?`, `excluded?`, `rules?`) — **no DTO class**.

### `PATCH /:key`

Partial update; **404** if missing.

### `DELETE /:key`

**404** if missing.

All mutations: audit + `dataset.refresh`.

---

## Audit — `/projects/:projectId/audit`

### `GET /`

**Query:** `limit?` (number), `entityId?`.

**Response:** up to min(limit||100, 500) rows, `createdAt desc`.

---

## Experiments — `/projects/:projectId/environments/:environmentId/experiments`

### `GET /`

List for environment, `createdAt desc`.

### `POST /`

**Body:** `{ key, name, flagKey, exposureEvent, goalEvent, metricKind? }` — **no class-validator DTO**.

Audit `experiment.created`. **Does not** refresh dataset (experiments are not in `ClientDataset`).

### `GET /:key/results`

**404** experiment not found.

**Response:** `{ experiment, totalExposures, variations: [{ variationIndex, value, isControl, exposures, conversions, conversionRate, avgValue, totalValue, z, pValue, relativeUplift, significant }] }`.

**DB:** all matching events for flag + two event keys (no time window, no pagination).

---

## Data plane — `/sdk`

**Auth:** `Authorization: Bearer <sdkKey>` or `x-sdk-key`.  
**401:** missing/invalid/inactive key (`"missing SDK key"` / `"invalid SDK key"`).

No AdminGuard.

### `GET /sdk/dataset`

**Response:** `ClientDataset`:

```text
{
  environmentKey: string,
  version: number,
  flags: { [key]: Flag },
  segments: { [key]: Segment }
}
```

**Cache:** Redis GET; miss compile + SET.

### `GET /sdk/stream` (SSE)

**Headers set:** `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`.

**Events:**

| event | data | When |
|---|---|---|
| `put` | full `ClientDataset` JSON | connect |
| `patch` | `{ version: number }` | Redis publish |
| comment | `: keep-alive` | every 25s |

**Lifecycle:** connection held until client abort. No server-side max duration in code. No SSE auth refresh.

**Reconnection:** not implemented server-side. Browser/EventSource typically auto-reconnects (JS client logs on `onerror` and relies on EventSource, `client.ts:125-127`). Reconnect gets a new `put`.

**Broadcast:** all subscribers on that **environment’s Redis channel**, across API instances sharing Redis.

### `POST /sdk/events`

**Body:** `IncomingEvent` or `{ events: IncomingEvent[] }`.

```text
{
  eventKey: string,
  contextKey: string,                 // required identity; still stored on Event
  context?: { key, ...attributes },   // full EvalContext; key defaults from contextKey
  flagKey?: string,
  value?: number,
  metadata?: object,
  ts?: number   // epoch ms → Date
}
```

**Response:** `{ ok: true }` or `{ ok: true, count: n }`.

**Logic:** if `flagKey` is set, `evaluate` with `context` when present, otherwise `{ key: contextKey }`; insert Event. Batch = loop `ingest`. `contextKey` stays the stored identity either way.

---

## Endpoints that do not exist

- Login/logout/JWT
- WebSocket
- GraphQL
- Flag scheduled changes
- Client-side SDK key kind restrictions
- DELETE experiment
- Frontend proxy API routes (`frontend` has no `app/api`)
