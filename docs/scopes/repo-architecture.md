# Repo Architecture Scope

## Objective

Move the MVP toward a monorepo layout that separates runnable applications from
shared product logic. The target shape should match the Parallel Agent platform
style closely enough that auth, API, local development, and deployment patterns
feel familiar.

## Target Layout

```txt
apps/
  web/       # Vite-style React app
  api/       # Express API server and local job execution
packages/
  shared/    # request/response schemas, common types, ids, errors
  timeline/  # timeline model, patch validation, sanitization
  agent/     # model prompts, structured calls, generation/revision logic
  renderer/  # Remotion composition and render helpers
docs/
  scopes/
.local/      # ignored local JSON data and media artifacts
```

## Package Boundaries

- `apps/web` owns browser UI, routing, Supabase client session handling, and API
  calls.
- `apps/api` owns Express routes, request context, authorization, local job
  execution, repositories, and API responses.
- `packages/shared` owns schemas and types used by both browser and API.
- `packages/timeline` owns deterministic timeline operations and validation.
- `packages/agent` owns model-facing logic and structured outputs.
- `packages/renderer` owns Remotion components and server render helpers.

## Migration Principles

- Extract shared logic before moving UI code.
- Keep the API contract stable while moving implementation underneath it.
- Preserve the current working upload/generate/export loop during migration.
- Do not introduce hosted-only requirements into local development.

## Acceptance Criteria

- `apps/web` can run the browser app without importing API-only code.
- `apps/api` can run the API and local jobs without depending on Next.js.
- Shared schema and timeline code is imported from packages, not copied between
  apps.
- Local development uses `.local/` for generated data and media and keeps it out
  of git.
