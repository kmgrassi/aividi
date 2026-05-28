# Jobs And Processing Scope

## Objective

Move long-running work out of synchronous request handlers so upload ingest,
media analysis, generation, revision, and export are reliable, retryable, and
observable.

## Job Types

- `asset_ingest`: validate media, extract metadata, create thumbnails.
- `asset_analysis`: optional transcript, scene detection, vision tags, quality
  scoring, embeddings.
- `generation`: plan beats, select clips, critique, create timeline variants.
- `revision`: apply conversational or structured edits to a timeline.
- `export`: render a timeline to an artifact.

## Job States

- `queued`
- `running`
- `succeeded`
- `failed`
- `canceled`

Each job should include progress metadata where practical:

```ts
interface JobProgress {
  currentStep?: string;
  percent?: number;
  message?: string;
}
```

## Worker Requirements

- Jobs are idempotent or guarded by idempotency keys.
- Workers claim jobs atomically.
- Failed jobs capture typed failure codes and redacted diagnostics.
- Retry policies distinguish transient failures from invalid input.
- Render jobs run in an environment with a compatible browser and media codecs.
- Job logs include request IDs, project IDs, job IDs, and asset/timeline IDs.

## UI Requirements

- Show progress for uploads, generation, revision, and export.
- Allow canceling queued or running jobs where supported.
- Allow retrying failed jobs when the error is retryable.
- Keep the last successful project state visible while new jobs run.

## API Requirements

- Job creation endpoints return `202 Accepted` and a job object.
- Polling endpoints return current state and result pointers.
- Optional webhooks can notify external agents when jobs finish.
- Terminal job states are immutable.

## Acceptance Criteria

- A generation request does not time out even if model calls take longer than a
  normal HTTP request.
- A render failure does not corrupt the timeline or delete previous artifacts.
- A client can recover from network loss by polling a known job ID.
- Operators can diagnose failed jobs from logs without exposing customer secrets.
