# Quality, Safety, And Observability Scope

## Objective

Make generated edits trustworthy, debuggable, and safe to operate with real
users, real customer media, and automated agent clients.

## Validation

- Validate all request bodies with shared schemas.
- Validate all model outputs before saving or rendering.
- Enforce clip constraints outside the prompt: do-not-use, required moments,
  source bounds, minimum segment duration, and allowed asset IDs.
- Clamp safe numeric values where appropriate and reject impossible requests.
- Add schema versions to timeline, patch, brief, and context objects.

## Testing

- Unit tests for timeline patch application and sanitization.
- Route tests for upload, project, generate, revise, and export error behavior.
- Integration test with tiny fixture videos.
- Contract tests for agent API request/response shapes.
- Regression tests for invalid model output.

## Observability

- Structured logs with request ID, project ID, job ID, route, status, duration,
  model, and token usage where available.
- Metrics for upload success, generation success, export success, latency,
  retry counts, and failure codes.
- Redaction for API keys, signed URLs, prompts containing customer-sensitive
  text, and raw model output.
- Basic admin/debug view for project jobs and recent failures.

## Safety Controls

- Supabase auth and server-side authorization before project access in hosted
  environments.
- Explicit local auth bypass for development only, guarded by environment mode.
- Workspace roles and agent API scopes enforced server-side.
- File size, duration, and type limits.
- Rate limits for expensive operations.
- Storage lifecycle policies for raw uploads and exports.
- Secrets kept only in environment or secret manager, never in tracked files.
- Audit events for project creation, asset upload, context changes, generation,
  revision, export, and deletion.

## Quality Signals

Each generation should produce machine-readable quality data:

```ts
interface GenerationQualityReport {
  scores: {
    hook: number;
    clarity: number;
    pacing: number;
    visualVariety: number;
    briefCoverage: number;
    constraintCompliance: number;
  };
  summary: string;
  warnings: string[];
}
```

## Acceptance Criteria

- Invalid model output cannot reach Remotion rendering.
- API clients receive typed, stable error codes for common failure modes.
- Browser users and agent clients cannot access projects outside their
  authorized workspaces.
- Local development can run without login while making the active dev identity
  obvious in logs and UI.
- A production incident can be traced from request to job to model call to
  project mutation.
- Logs and errors do not include secret values or full signed media URLs.
