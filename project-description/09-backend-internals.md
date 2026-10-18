# Backend internals

## Application startup

1. `backend/src/main.ts` imports `reflect-metadata`.
2. `NestFactory.create(AppModule)`.
3. CORS from `CORS_ORIGIN` or `*`, `credentials: true`.
4. Global `ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false })` — unknown properties **not** stripped-and-rejected (`forbidNonWhitelisted: false`).
5. `setGlobalPrefix("", { exclude: ["health"] })`.
6. `listen(PORT || 4000, "0.0.0.0")`.

Module init order: Nest instantiates imported modules. `PrismaService.onModuleInit` `$connect`. `RedisService.onModuleInit` connects both clients, **ignoring errors**.

**No** Nest `ConfigModule`. Env vars read via `process.env` at use site.

**Logging:** Nest default + one `console.log`. `bufferLogs: false`.

## Dependency injection

Standard Nest constructors. Global modules export Prisma, Redis, Dataset, SdkAuth, AdminGuard.

`FlagsService` constructor: Prisma, Audit, Dataset (`flags.service.ts:30-34`).

## Request lifecycle (REST)

```text
TCP → Express
→ CORS
→ route
→ guards (AdminGuard or none)
→ ValidationPipe (if DTO metadata)
→ controller
→ service
→ Prisma / Redis / Engine
→ JSON serializer (class instance / plain object)
→ exception filter (default)
```

**No** custom middleware files, helmet, compression, or request IDs.

## SSE lifecycle

Controller uses `@Res()` so Nest does **not** send a JSON body. Manual headers + `flushHeaders`. Node `req.on("close")` for cleanup. `setInterval` heartbeat must be cleared (it is).

## Controllers / routing

See `06-api-reference.md`. Decorators: `@Controller`, HTTP method, `@Param`, `@Body`, `@Query`, `@Req`, `@Actor()`.

## Services (business logic)

| Service | File | Notable algorithms / complexity |
|---|---|---|
| DatasetService.buildDataset | `dataset.service.ts:19-69` | O(flags + segments) memory of full env |
| FlagsService.create | `flags.service.ts:36-86` | O(envs) configs |
| FlagsService.toggle | `:164-196` | single row update |
| EventsService.ingest | `events.service.ts:28-47` | one eval + one insert; **O(rules)** eval |
| EventsService.ingestBatch | loop | O(n) serial awaits — **no parallelism** |
| ExperimentsService.results | `experiments.service.ts:59-133` | O(events) time, extra Set memory per variation |
| twoProportionTest | `stats.ts:14-31` | O(1) |
| SdkAuthService.resolve | `sdk-auth.service.ts:30-48` | O(1) cache; else one SQL |

### `buildDataset` side effects / failures

Reads only, except caller `refresh` writes Redis. `findUniqueOrThrow` if env id invalid.

### `evaluateFlag` (library, used by backend)

See `18-algorithms-and-data-structures.md`. Recursion on prerequisites with `seen` Set — O(flags in chain); cycle → `MALFORMED_FLAG`.

## Repositories

**None.** Services call `this.prisma.*` directly.

## Models

Prisma generated client. Domain types for evaluation live in `@flagship/sdk` `types.ts`, not as Nest entities.

## Validation / serialization

- DTO classes only on: create project, create flag, toggle.
- Other bodies: `Record<string, unknown>` or service interfaces — **invalid JSON rules are stored as-is** until evaluate fails closed (malformed variation).
- Responses: Prisma objects (Date → ISO JSON).

## Authentication / authorization

See `12-security.md`. No role checks (any admin caller can mutate any `projectId` in the URL — **IDOR** if API key is global).

## Background processing

**No** `@Cron`, Bull, or worker threads in the API.

Python SDK uses a **daemon thread** for polling (`client.py:41-42`) — that is client-side, not backend.

JS SDK `setInterval` for polling.

SSE `setInterval` heartbeat is per-connection on the API.

## Configuration

| Env | Used by |
|---|---|
| `PORT` | `main.ts` |
| `CORS_ORIGIN` | `main.ts` |
| `DATABASE_URL` | Prisma |
| `REDIS_URL` | RedisService default `redis://localhost:6379` |
| `ADMIN_API_KEY` | AdminGuard |
| `NODE_ENV` | Docker/Cloud Run; not branched in app code much |
| `JWT_SECRET` | **unused in TS** |

`.env.example` documents backend + `NEXT_PUBLIC_API_URL`.

## Error handling

- `BadRequestException`, `NotFoundException`, `UnauthorizedException`.
- Health swallows check errors into `"down"`.
- Redis subscribe JSON parse catch empty.
- **No** retry helpers, circuit breakers, or timeouts on Prisma (driver defaults).

## Database access

All through Prisma. Event ingest cannot skip DB.

## External API calls

Backend **does not** call third-party HTTP APIs. It **is** the API.

## Concurrency considerations

- Node cluster **not** used.
- Concurrent `refresh` for same env: last SET wins; both publish; extra SSE patches.
- `FlagConfig.version` increment is atomic in SQL.
- In-process auth cache not mutexed — Map in single-threaded JS is OK.
- SSE writes from Redis message callback must not throw (malformed ignored).
