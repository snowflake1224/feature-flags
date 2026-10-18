# Data flow

## 1. Create flag (control plane write)

```text
Browser FlagsTab.create()
→ POST /projects/:projectId/flags
→ CORS (main.ts)
→ AdminGuard (allow or x-api-key)
→ ValidationPipe (CreateFlagDto)
→ FlagsController.create
→ FlagsService.create
   → Environment.findMany
   → Flag.create (nested FlagConfig per env, on:false, salt nanoid)
   → AuditService.record flag.created
   → DatasetService.refresh each env
      → buildDataset (Prisma reads)
      → Redis SET flagship:dataset:{envId} EX 3600
      → Redis PUBLISH flagship:changes:{envId} {"version":N}
→ JSON flag + configs
```

**SSE clients:** receive `event: patch` then JS SDK `fetchDataset()` (`client.ts:124`).

---

## 2. Kill switch

```text
Toggle in FlagsTab
→ POST .../toggle { on, comment }
→ FlagsService.toggle
   → FlagConfig.update { on, version increment }
   → audit flag.enabled | flag.killswitch
   → dataset.refresh
→ JSON updated config
```

Engine after refresh: if `flag.on === false`, all evaluations return `offVariation` with reason `OFF` (`engine.ts:90-93`).

---

## 3. SDK bootstrap + local eval (happy path)

```text
FlagshipClient.start()
→ GET /sdk/dataset  Authorization: Bearer sdk-...
→ SdkAuthService.resolve (cache or Prisma sdkKey)
→ DatasetService.getDataset
   → Redis GET  (hit: parse JSON)
   → miss: buildDataset + cacheDataset
→ applyDataset → new Engine(dataset)
→ resolve readyPromise
→ boolVariation() → Engine.evaluate (CPU only)
```

No Postgres on Redis hit (except possibly first auth if key not cached).

---

## 4. SSE live updates

```text
Client EventSource GET /sdk/stream (+ Bearer)
→ resolve SDK key
→ set SSE headers, flush
→ getDataset, write:
     event: put
     data: {full ClientDataset}
→ redis.subscribeToChanges(envId)
→ on PUBLISH: write event: patch data: {"version":N}
→ every 25s: ": keep-alive\n\n"
→ req close: clearInterval, unsubscribe, res.end
```

JS client: `put` → `applyDataset`; `patch` → `fetchDataset()` (full GET), not apply patch payload (`client.ts:115-124`).

**Not a broadcast to other browsers’ dashboards.** Dashboard refetches on its own after toggle.

---

## 5. Polling (JS mode=polling or Python)

```text
start() fetch once
→ setInterval / thread wait polling_interval
→ GET /sdk/dataset
→ apply if version >= current (Python) / not older (JS)
```

Default JS interval 15s (`client.ts:49`); Python 15.0s (`client.py:21`).

---

## 6. Test targeting

```text
FlagDrawer runTest
→ POST .../evaluate { key, attributes... }
→ dataset.getDataset
→ evaluate(ds, key, context, null)
→ { value, variationIndex, reason, flagVersion }
```

---

## 7. Experiment event + results

### Ingest (async from app’s POV, sync on server)

```text
client.track(...)
→ POST /sdk/events
→ EventsService.ingest
   → optional evaluate(dataset, flagKey, full EvalContext or { key: contextKey }, null)
   → prisma.event.create
→ { ok: true }
```

`track` is fire-and-forget on clients (catch + log). The JS SDK sends `contextKey` and the full `EvalContext` (key plus attributes). Attribution uses that context so segment and attribute rules match local evaluation. Bodies that only include `contextKey` still ingest and are evaluated as `{ key: contextKey }`. The stored row’s identity remains `contextKey`. Server still awaits the DB insert.

**Not a queue:**

```text
Producer → Queue → Worker   # DOES NOT EXIST
```

### Results

```text
ExperimentsTab
→ GET .../experiments/:key/results
→ load Experiment + Flag variations
→ event.findMany (exposure + goal keys, that flag)
→ in-memory Sets by variationIndex
→ twoProportionTest vs variation 0
→ JSON variations[]
```

---

## 8. Key rotation

```text
SettingsTab rotate
→ POST /projects/environments/:environmentId/rotate-key
→ updateMany active false + create new key
→ audit sdkkey.rotated
```

Postgres marks old keys `active: false` immediately, and a brand-new key works on first use. `SdkAuthService` does not cache failures and does not evict on rotate. A key **already resolved** on that process stays valid until its 30s Map entry expires. Other API processes have separate maps.

---

## Sequence: kill switch to user-facing eval

```text
Operator          API              Postgres     Redis         SDK
   | toggle         |                 |           |            |
   |--------------->| UPDATE on       |           |            |
   |                |---------------> |           |            |
   |                | INSERT audit    |           |            |
   |                | buildDataset    |           |            |
   |                | SELECT configs  |           |            |
   |                |<----------------|           |            |
   |                | SET dataset     |---------->|            |
   |                | PUBLISH ver     |---------->|            |
   |                |                 |           |----------> | SSE patch
   |                |                 |           |            | GET dataset
   |                | GET cache       |<----------|            |
   |                |----------------------------------------->| JSON
   |                |                 |           |            | Engine.update
   |                |                 |           |            | next boolVariation() uses off
```

## Frontend data flow

No WebSocket. Each tab loads on mount. Environment switch in `ProjectDashboard` changes `envId` and remounts tab props so effects re-run.

## Asynchronous flows that do not exist

- Outbox pattern
- Redis Streams consumers
- Webhook callbacks to customer URLs
