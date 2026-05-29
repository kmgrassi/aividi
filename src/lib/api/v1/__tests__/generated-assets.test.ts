import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Point the local store + generated media at throwaway temp dirs before any
// store call. config.ts reads these lazily, so setting them here is enough.
const TMP_ROOT = path.join(os.tmpdir(), `aividi-v1-${process.pid}-${Date.now()}`);
process.env.AIVIDI_LOCAL_DIR = path.join(TMP_ROOT, "local");
process.env.AIVIDI_GENERATED_DIR = path.join(TMP_ROOT, "media");
process.env.AIVIDI_GENERATED_URL_BASE = "/generated";
delete process.env.AUTH_MODE;

import { ApiError } from "../errors";
import {
  createGeneratedAsset,
  getGeneratedAssetJob,
} from "../generated-assets";
import { createProject, getAsset, listAssets } from "../store";
import { LOCAL_WORKSPACE_ID } from "../context";
import { RequestContext } from "../types";

const ctx: RequestContext = {
  requestId: "req_test",
  actor: { id: "local_dev", workspaceId: LOCAL_WORKSPACE_ID, mode: "local" },
};

function jobResultAssetIds(result: unknown): string[] {
  return (result as { assetIds: string[] }).assetIds;
}

async function expectApiError(
  promise: Promise<unknown>,
  code: ApiError["code"]
): Promise<void> {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof ApiError, `expected ApiError, got ${err}`);
    assert.equal(err.code, code);
    return true;
  });
}

test("creates image, video, and audio generated assets and lists them", async () => {
  const project = await createProject({
    workspaceId: LOCAL_WORKSPACE_ID,
    name: "agent video",
  });

  const image = await createGeneratedAsset({
    ctx,
    projectId: project.id,
    body: { kind: "image", provider: "mock", prompt: "petri dish hook" },
    idempotencyKey: "img-1",
  });
  assert.equal(image.status, 202);
  assert.equal(image.body.job.status, "succeeded");
  assert.equal(image.body.job.type, "asset_generation");

  const video = await createGeneratedAsset({
    ctx,
    projectId: project.id,
    body: {
      kind: "video",
      provider: "mock",
      prompt: "workflow reveal",
      durationSec: 6,
    },
    idempotencyKey: "vid-1",
  });
  assert.equal(video.body.job.status, "succeeded");

  const audio = await createGeneratedAsset({
    ctx,
    projectId: project.id,
    body: {
      kind: "audio",
      provider: "mock",
      prompt: "calm narration",
      durationSec: 5,
    },
    idempotencyKey: "aud-1",
  });
  assert.equal(audio.body.job.status, "succeeded");

  // Poll the job through the GET endpoint.
  const polled = await getGeneratedAssetJob({
    ctx,
    projectId: project.id,
    jobId: audio.body.job.id,
  });
  assert.equal(polled.body.job.status, "succeeded");

  // List through the standard asset store (what GET /assets surfaces).
  const { assets } = await listAssets(LOCAL_WORKSPACE_ID, project.id);
  assert.equal(assets.length, 3);
  assert.deepEqual(
    [...assets.map((a) => a.kind)].sort(),
    ["audio", "image", "video"]
  );
  assert.ok(assets.every((a) => a.source === "generated"));
});

test("persists actual audio duration and provider settings in provenance", async () => {
  const project = await createProject({
    workspaceId: LOCAL_WORKSPACE_ID,
    name: "audio provenance",
  });

  const res = await createGeneratedAsset({
    ctx,
    projectId: project.id,
    body: {
      kind: "audio",
      provider: "mock",
      prompt: "five second line",
      durationSec: 5,
    },
    idempotencyKey: "aud-prov-1",
  });

  const assetId = jobResultAssetIds(res.body.job.result)[0];
  const asset = await getAsset(LOCAL_WORKSPACE_ID, project.id, assetId);
  assert.ok(asset, "asset should exist");
  assert.equal(asset.kind, "audio");
  assert.equal(asset.provenance?.provider, "mock");
  assert.equal(asset.provenance?.requestedDurationSec, 5);
  // Mock returns a real 8kHz WAV of the requested length.
  assert.equal(asset.provenance?.actualDurationSec, 5);
  assert.equal(asset.durationSec, 5);
});

test("records character binding metadata when character fields are provided", async () => {
  const project = await createProject({
    workspaceId: LOCAL_WORKSPACE_ID,
    name: "character binding",
  });

  const res = await createGeneratedAsset({
    ctx,
    projectId: project.id,
    body: {
      kind: "image",
      provider: "mock",
      prompt: "fleming portrait",
      characterProfileIds: ["char_fleming"],
      characterReferenceIds: ["ref_hero"],
      consistencyMode: "hero_frame",
    },
    idempotencyKey: "char-1",
  });

  const assetId = jobResultAssetIds(res.body.job.result)[0];
  const asset = await getAsset(LOCAL_WORKSPACE_ID, project.id, assetId);
  assert.deepEqual(asset?.provenance?.characterBinding?.characterProfileIds, [
    "char_fleming",
  ]);
  assert.equal(
    asset?.provenance?.characterBinding?.consistencyMode,
    "hero_frame"
  );
});

test("idempotent replay returns the original job without duplicating assets", async () => {
  const project = await createProject({
    workspaceId: LOCAL_WORKSPACE_ID,
    name: "idempotency",
  });
  const body = { kind: "image", provider: "mock", prompt: "stable hook" };

  const first = await createGeneratedAsset({
    ctx,
    projectId: project.id,
    body,
    idempotencyKey: "dup-key",
  });
  const replay = await createGeneratedAsset({
    ctx,
    projectId: project.id,
    body,
    idempotencyKey: "dup-key",
  });

  assert.equal(replay.body.job.id, first.body.job.id);
  const { assets } = await listAssets(LOCAL_WORKSPACE_ID, project.id);
  assert.equal(assets.length, 1);
});

test("concurrent retries with the same key produce a single asset", async () => {
  const project = await createProject({
    workspaceId: LOCAL_WORKSPACE_ID,
    name: "concurrent idempotency",
  });
  const call = () =>
    createGeneratedAsset({
      ctx,
      projectId: project.id,
      body: { kind: "image", provider: "mock", prompt: "race" },
      idempotencyKey: "race-key",
    });

  const [a, b] = await Promise.all([call(), call()]);
  assert.equal(a.body.job.id, b.body.job.id);

  const { assets } = await listAssets(LOCAL_WORKSPACE_ID, project.id);
  assert.equal(assets.length, 1);
});

test("persists provider settings used to produce the asset", async () => {
  const project = await createProject({
    workspaceId: LOCAL_WORKSPACE_ID,
    name: "provider settings",
  });

  const image = await createGeneratedAsset({
    ctx,
    projectId: project.id,
    body: {
      kind: "image",
      provider: "mock",
      prompt: "settings",
      size: "1024x1024",
      quality: "high",
    },
    idempotencyKey: "ps-img",
  });
  const imageAssetId = jobResultAssetIds(image.body.job.result)[0];
  const imageAsset = await getAsset(LOCAL_WORKSPACE_ID, project.id, imageAssetId);
  assert.equal(imageAsset?.provenance?.providerSettings?.size, "1024x1024");
  assert.equal(imageAsset?.provenance?.providerSettings?.quality, "high");

  const audio = await createGeneratedAsset({
    ctx,
    projectId: project.id,
    body: {
      kind: "audio",
      provider: "mock",
      prompt: "voice over",
      durationSec: 4,
      voiceId: "voice_123",
      outputFormat: "mp3_44100_192",
      audioMode: "speech",
    },
    idempotencyKey: "ps-aud",
  });
  const audioAssetId = jobResultAssetIds(audio.body.job.result)[0];
  const audioAsset = await getAsset(LOCAL_WORKSPACE_ID, project.id, audioAssetId);
  assert.equal(audioAsset?.provenance?.providerSettings?.voiceId, "voice_123");
  assert.equal(
    audioAsset?.provenance?.providerSettings?.outputFormat,
    "mp3_44100_192"
  );
  assert.equal(audioAsset?.provenance?.providerSettings?.audioMode, "speech");
});

test("reusing an idempotency key with a different body conflicts", async () => {
  const project = await createProject({
    workspaceId: LOCAL_WORKSPACE_ID,
    name: "idempotency conflict",
  });

  await createGeneratedAsset({
    ctx,
    projectId: project.id,
    body: { kind: "image", provider: "mock", prompt: "first" },
    idempotencyKey: "conflict-key",
  });

  await expectApiError(
    createGeneratedAsset({
      ctx,
      projectId: project.id,
      body: { kind: "image", provider: "mock", prompt: "different" },
      idempotencyKey: "conflict-key",
    }),
    "idempotency_conflict"
  );
});

test("returns typed errors for unsupported and invalid requests", async () => {
  const project = await createProject({
    workspaceId: LOCAL_WORKSPACE_ID,
    name: "errors",
  });

  // Audio requested from an image/video-only provider.
  await expectApiError(
    createGeneratedAsset({
      ctx,
      projectId: project.id,
      body: { kind: "audio", provider: "openai", prompt: "voice" },
      idempotencyKey: "e1",
    }),
    "validation_failed"
  );

  // Image requested from a video-only provider.
  await expectApiError(
    createGeneratedAsset({
      ctx,
      projectId: project.id,
      body: { kind: "image", provider: "gemini", prompt: "frame" },
      idempotencyKey: "e2",
    }),
    "validation_failed"
  );

  // Unknown provider.
  await expectApiError(
    createGeneratedAsset({
      ctx,
      projectId: project.id,
      body: { kind: "image", provider: "made-up", prompt: "x" },
      idempotencyKey: "e3",
    }),
    "validation_failed"
  );

  // Invalid consistency mode.
  await expectApiError(
    createGeneratedAsset({
      ctx,
      projectId: project.id,
      body: {
        kind: "image",
        provider: "mock",
        prompt: "x",
        consistencyMode: "telepathy",
      },
      idempotencyKey: "e4",
    }),
    "validation_failed"
  );

  // Missing prompt.
  await expectApiError(
    createGeneratedAsset({
      ctx,
      projectId: project.id,
      body: { kind: "image", provider: "mock" },
      idempotencyKey: "e5",
    }),
    "validation_failed"
  );

  // Missing idempotency key.
  await expectApiError(
    createGeneratedAsset({
      ctx,
      projectId: project.id,
      body: { kind: "image", provider: "mock", prompt: "x" },
      idempotencyKey: null,
    }),
    "validation_failed"
  );

  // Unknown project.
  await expectApiError(
    createGeneratedAsset({
      ctx,
      projectId: "proj_missing",
      body: { kind: "image", provider: "mock", prompt: "x" },
      idempotencyKey: "e6",
    }),
    "not_found"
  );
});
