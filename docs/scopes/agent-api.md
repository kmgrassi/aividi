# Agent API Scope

## Objective

Expose the same video editing workflow to external agents through stable,
versioned APIs. Agents should be able to create projects, provide video assets
and context, generate timelines, revise edits, and request exports without using
the browser UI.

## Design Principles

- Version every public API path or schema.
- Treat long-running operations as jobs.
- Support idempotency for all mutating requests that agents may retry.
- Use the same Express `/api/v1` surface as the browser app where practical.
- Authenticate agent clients with workspace-scoped API keys in v1.
- Return typed errors with stable codes.
- Keep raw model output internal; expose validated project, timeline, patch, and
  job objects.
- Never require agents to upload large files through the app server if signed
  object-storage uploads are available.

## Core Resources

- `Workspace`: tenant boundary for users, projects, assets, jobs, and agent
  clients.
- `User`: Supabase-authenticated browser user mapped to an internal user record.
- `AgentClient`: workspace-scoped API client with explicit scopes.
- `Project`: top-level editing workspace.
- `Asset`: uploaded or registered source media.
- `Context`: project brief and clip annotations.
- `GenerationJob`: async request to create or regenerate a timeline.
- `Timeline`: structured edit made from source assets.
- `Revision`: natural-language or structured patch request.
- `ExportJob`: async render request.
- `Artifact`: exported media or derived file.

## Proposed API

### Projects

- `POST /api/v1/projects`
- `GET /api/v1/projects/:projectId`
- `PATCH /api/v1/projects/:projectId`
- `DELETE /api/v1/projects/:projectId`

### Assets

- `POST /api/v1/projects/:projectId/assets/upload-url`
- `POST /api/v1/projects/:projectId/assets`
- `GET /api/v1/projects/:projectId/assets`
- `GET /api/v1/projects/:projectId/assets/:assetId`
- `PATCH /api/v1/projects/:projectId/assets/:assetId/context`
- `DELETE /api/v1/projects/:projectId/assets/:assetId`

### Generation

- `POST /api/v1/projects/:projectId/generations`
- `GET /api/v1/projects/:projectId/generations/:jobId`
- `GET /api/v1/projects/:projectId/timelines/:timelineId`

### Revision

- `POST /api/v1/projects/:projectId/timelines/:timelineId/revisions`
- `GET /api/v1/projects/:projectId/timelines/:timelineId/revisions/:jobId`

### Export

- `POST /api/v1/projects/:projectId/timelines/:timelineId/exports`
- `GET /api/v1/projects/:projectId/exports/:jobId`
- `GET /api/v1/projects/:projectId/artifacts/:artifactId`

## Example Agent Flow

```http
POST /api/v1/projects
Idempotency-Key: create-demo-001

{
  "name": "Harper launch teaser",
  "brief": {
    "goal": "Create a punchy 15 second vertical teaser.",
    "targetLengthSec": 15,
    "aspectRatio": "9:16",
    "style": "fast-paced product demo",
    "audience": "clinical operations leaders"
  }
}
```

```http
POST /api/v1/projects/proj_123/assets
Idempotency-Key: asset-harper-demo-001

{
  "source": {
    "type": "remote_url",
    "url": "https://storage.example.com/input/harper-demo.mp4"
  },
  "context": {
    "summary": "Main product workflow demo",
    "recommendedRoles": ["hook", "workflow_reveal"],
    "moments": [
      {
        "startSec": 4.0,
        "endSec": 8.5,
        "label": "Core workflow shown clearly"
      }
    ]
  }
}
```

```http
POST /api/v1/projects/proj_123/generations
Idempotency-Key: gen-harper-001

{
  "briefVersion": "briefv_123",
  "assetIds": ["asset_1", "asset_2", "asset_3"],
  "variantCount": 2
}
```

## Job Response Shape

```json
{
  "job": {
    "id": "job_123",
    "type": "generation",
    "status": "queued",
    "projectId": "proj_123",
    "createdAt": "2026-05-28T12:00:00.000Z",
    "updatedAt": "2026-05-28T12:00:00.000Z"
  }
}
```

## Error Shape

```json
{
  "error": {
    "code": "asset_not_ready",
    "message": "One or more assets are still processing.",
    "requestId": "req_123",
    "details": {
      "assetIds": ["asset_2"]
    }
  }
}
```

## Security Requirements

- Workspace-scoped API keys for agent clients in v1.
- Supabase JWT verification for browser-user requests.
- Per-workspace and per-project authorization checks.
- Rate limits by client, project, and operation type.
- Signed URLs for large file transfer.
- Redacted logs for prompts, secrets, and customer media URLs.
- Optional webhook signing for job completion callbacks.

OAuth-style third-party authorization is out of scope for v1. Hosted agent
clients use API keys; local agent clients use `AUTH_MODE=local` without keys.

## Local Development

Agent API behavior should be testable locally without Supabase. When
`AUTH_MODE=local`, API requests resolve to a deterministic development
workspace. This mode should support the full create-upload-generate-export loop
without API key validation, but must be disabled in hosted production
environments.

## Acceptance Criteria

- An agent can create a project, register remote videos with context, generate a
  timeline, revise it, and request an export without browser interaction.
- Agent requests are authorized against workspace-scoped API key scopes.
- In `AUTH_MODE=local`, an agent can perform the same workflow without providing
  an API key.
- Retried mutating requests with the same idempotency key do not create duplicate
  assets, jobs, timelines, or exports.
- Agents can poll job status and receive typed terminal states: `succeeded`,
  `failed`, or `canceled`.
- API responses are stable enough to support generated clients or SDKs.
