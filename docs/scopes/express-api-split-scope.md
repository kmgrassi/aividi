# Express API Split Scope

## Objective

Move all API/server-side behavior out of Next.js route handlers into an Express server, while keeping the same monorepo target shape (UI and API as separate applications inside one repo). The first milestone is a functional server-side API migration; infrastructure relocation to a separate hosting target (Roku/AWS) is explicitly out of scope for this stage.

## Current State and Constraint

- Current repository is a single Next.js app where API endpoints live under `src/app/api/*` and call shared logic in `src/lib/api/*`.
- The product-level API contract is already documented in `docs/scopes/api-contract-v1.md`.
- Existing shared logic includes request validation, auth resolution, idempotency, store/repository access, and typed responses.
- We will preserve behavior and API shape first, then shift deployment topology.

## Target Operating Model (this scope)

- Keep monorepo layout intent as-is from the architecture docs:
  - `apps/web` (front-end)
  - `apps/api` (Express API)
  - shared packages used by both apps.
- Move API implementation under Express.
- Keep the external contract stable:
  - `api/v1` routes remain the same path and payload/response formats.
- Update web/agent callers to hit the Express API base URL.
- Leave runtime/runtime hosting split (`apps/web` + `apps/api` on same host) for now.

## Phase 1 — Lift and Stabilize API into Express

### Scope

- Scaffold Express app in `apps/api`.
- Add HTTP server wiring:
  - JSON parsing, request ID/log context, error handler, health endpoint, and CORS settings for local web dev.
- Rehost all `src/app/api/v1/*` behavior in Express routes.
- Keep endpoints semantically identical:
  - `GET /api/v1/health`
  - `GET /api/v1/me`
  - `GET /api/v1/projects`
  - `POST /api/v1/projects`
  - `GET /api/v1/projects/:projectId`
  - `PATCH /api/v1/projects/:projectId`
  - `GET /api/v1/projects/:projectId/assets`
  - `POST /api/v1/projects/:projectId/assets`
  - `GET /api/v1/projects/:projectId/assets/:assetId`
  - `POST /api/v1/projects/:projectId/generations`
  - `GET /api/v1/projects/:projectId/generations`
  - `GET /api/v1/projects/:projectId/generations/:jobId`
  - other `api/` endpoints currently used by web/agents (export, revisions, briefs, revisions, artifacts, timelines, jobs).
- Reuse existing shared API modules from `src/lib/api/v1` by moving them into a shared location consumed by both web and api.
  - Suggested destination in this repo stage: `packages/api-core` (or equivalent package in `packages/`).
- Add local launch config in `apps/api` for `npm run dev` and `npm run start`.
- Keep local file-backed store behavior unchanged during this phase (no storage migration yet).

### Deliverables

- Express server serves all current `api/v1` endpoints.
- Existing front-end pages call `apps/api` endpoint base (no logic changes to request shapes).
- `api/v1` contract remains backward compatible.
- Health endpoint and error format match current behavior.

### Acceptance Criteria

- All existing `api/v1` request/response examples execute successfully against Express.
- Existing front-end flows (login-aware contexts, project list, generation, revise, export orchestration) work unchanged from consumer perspective.
- API-side behavior for auth, validation, idempotency, and authorization matches prior implementation.
- End-to-end run with both apps started locally from the monorepo works.

## Phase 2 — Clean Monorepo Boundary Hardening

### Scope

- Remove server-only imports from web runtime.
- Ensure browser app never imports route handlers directly.
- Move any server-only env vars and secrets into `apps/api` process env only.
- Publish shared contracts/types into packages used by both apps.
- Add runtime checks/build boundaries to prevent cross-layer dependency violations.

### Deliverables

- Deterministic dependency boundaries:
  - `apps/web` imports UI + API client code only.
  - `apps/api` owns handlers, repositories, job execution, and credentials.
- Documented local proxy/target config for development (`.env.local` and README updates).

## Phase 3 — Deployment Readiness (Roku/AWS path)

### Scope

- Extract environment/runtime configuration so API can be deployed independently of web host.
- Add deployment target profile for either Roku/AWS environment (for example: container image + service, or serverless/managed container run).
- Add health checks and startup probes for `apps/api`.
- Ensure secure secret injection and host-based URL configuration for API base URL in web client.

### Delivery Conditions

- API deploys independently from web UI.
- CORS/networking and auth still allow browser in this monorepo-hosted environment.
- Operational checklist is updated (`rollout`, `scale`, `logging`, and `secrets`).

## Out of Scope (for this phase)

- Redesigning API response formats.
- Moving storage/datastore from local file store to managed DB/object storage.
- Moving rendering or media-processing workers off-process from API process.
- Adding new model providers or changing job orchestration models.

## Risks

- Hidden coupling between Next route lifecycle assumptions and API handlers (`NextRequest`/`NextResponse`) if handlers are not abstracted first.
- Missing endpoint parity during migration can silently break agent clients.
- Auth/session behavior drift if local mode and hosted mode are not kept aligned.
- CORS and base URL mistakes in browser ↔ Express integration.

## Suggested First Tasks

1. Scaffold `apps/api` with Express and route modules.
2. Extract `src/lib/api/v1` helpers into shared package(s) used by both web and api.
3. Migrate one route group (`/api/v1/projects`) end-to-end and validate contract parity.
4. Expand route migration to remaining API endpoints.
5. Update UI calls to explicit API base URL and document local run order.
