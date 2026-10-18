# Frontend architecture

The dashboard is a **Next.js 14 App Router** app (`frontend/`), React 18, Tailwind. It is an operator console with an authenticated, browser-side data-plane demonstration.

## Application structure

```text
frontend/
  app/
    layout.tsx                 shell: header "Flagship"
    page.tsx                   project list + create
    projects/[projectId]/page.tsx
    globals.css
  components/
    AppHeader.tsx
    ui.tsx                     form, feedback, dialog, status primitives
    dashboard/
      ProjectDashboard.tsx     env switcher + tabs
      DemoOnboarding.tsx
      FlagsTab.tsx
      FlagDrawer.tsx
      RuleBuilder.tsx
      SegmentsTab.tsx
      ExperimentsTab.tsx
      LiveDemoTab.tsx
      AuditTab.tsx
      SettingsTab.tsx
  lib/
    api.ts                     typed admin + SDK fetch wrapper
    types.ts                   dashboard API types
    local-eval.ts              browser-local evaluation
    sse.ts                     incremental SSE framing
    targeting.ts               form construction + validation
    diff.ts / format.ts / sha1.ts
  test/                        Vitest tests for pure helpers
```

No `app/api` routes. No middleware.ts. No auth pages.

## Pages / routes

| Route | File | Behavior |
|---|---|---|
| `/` | `app/page.tsx` | Client component `ProjectsPage` |
| `/projects/[projectId]` | `app/projects/[projectId]/page.tsx` | Server page wrapping `ProjectDashboard` |

`layout.tsx` sets metadata title/description. Main width `max-w-6xl`.

## State management

**React local state only.** No Redux/Zustand/React Query.

- Projects page: `projects`, `loading`, `error`, form fields.
- Dashboard: `project`, `envId`, `tab`, `error`.
- Tabs: their own lists/results.

**Re-fetch:** after mutations, tabs call `load()` callbacks. No cache invalidation layer. No optimistic updates (toggle awaits API then `load()`).

**Re-render:** standard React. Lists keyed by `flag.id`, etc.

## Hooks

The app uses React state/effects/callbacks and memoizes parsed contexts/local results where useful. No global state library is required.

## API client

`frontend/lib/api.ts`:

- `BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"`
- Actor and optional admin API key are read from local storage on every request, so Settings changes apply without reload.
- `request()`: `cache: "no-store"`, typed return values, readable JSON error messages.
- Methods cover complete dashboard CRUD, audit, health, SDK dataset/event endpoints, and authenticated streaming.

## WebSocket / SSE client

`LiveDemoTab` opens `/sdk/stream` with authenticated `fetch()` and incrementally parses SSE frames. Native `EventSource` is not used because it cannot attach the SDK bearer header. A `patch` triggers an authenticated dataset pull and browser-local re-evaluation.

## Authentication state

There is no user/session authentication. Settings stores the optional demo `ADMIN_API_KEY` and actor email in local storage. The former authorizes control-plane requests; the latter only labels audit entries.

## Form handling / validation

Forms use controlled local state and shared validation helpers. Common targeting clauses are constructed visually; advanced JSON remains available for the complete engine shape. Flag/project keys, segment rules, contexts, variation weights, prerequisites, and destructive production changes receive explicit validation or confirmation.

## Error handling

Pages and tabs expose loading, empty, success, and error feedback. Mutations catch request errors and keep forms open for correction. Production toggles and destructive actions use confirmation dialogs.

## Loading states

Project/dashboard skeletons and operation-specific pending labels cover initial loads, saves, key rotation, and experiment result refreshes.

## Caching / performance

No `useMemo` for expensive lists. Experiment bars are CSS widths. `next.config.mjs` `reactStrictMode: true` (double-mount effects in dev). Docker uses `output: "standalone"`.

Images: no `next/image` usage in these pages.

## Important components

| Component | Responsibility |
|---|---|
| `ProjectDashboard` | Project/env context, accessible tabs, onboarding |
| `FlagsTab` | List/create/delete, kill switch, production guard |
| `FlagDrawer` | Variations, rollout, prerequisites, targeting builder/JSON, evaluation |
| `SegmentsTab` | Complete segment CRUD |
| `ExperimentsTab` | Create experiments and explain/display results |
| `LiveDemoTab` | Health, authenticated SSE, local/server evaluation, event simulation |
| `AuditTab` | Filters and field-level before/after diffs |
| `SettingsTab` | SDK keys/snippets, rotation, actor/admin-key settings |
| `ui.tsx` | Accessible form, feedback, dialog, and status primitives |

## Frontend ↔ backend

Browser must reach the API URL **directly** (CORS). Compose frontend env `NEXT_PUBLIC_API_URL: http://localhost:4000` so the **browser** talks to host port 4000, not the Docker-internal hostname — correct for local full-stack.

## Remaining gaps

- No user accounts, SSO, or RBAC; local-storage admin key is intentionally demo-grade.
- Playwright is a manual seeded-stack smoke test rather than an automatically provisioned browser job.
- Complex targeting operators still fall back to Advanced JSON instead of receiving a bespoke widget.
