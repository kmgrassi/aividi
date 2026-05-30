import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import {
  GenerationRunsStore,
  createGenerationRunsStore,
} from "../generation-runs";

let tmpDir: string;
let store: GenerationRunsStore;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aividi-genruns-"));
  store = createGenerationRunsStore(tmpDir);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test("createRun persists with assigned id, schemaVersion, and timestamps", async () => {
  const run = await store.createRun({
    projectId: "proj_a",
    status: "queued",
  });

  assert.match(run.id, /^genrun_/);
  assert.equal(run.schemaVersion, "genrun.v1");
  assert.equal(run.projectId, "proj_a");
  assert.equal(run.status, "queued");
  assert.equal(run.createdAt, run.updatedAt);

  const read = await store.getRun(run.id);
  assert.deepEqual(read, run);
});

test("updateRun applies patch, bumps updatedAt, and preserves identity fields", async () => {
  const run = await store.createRun({
    projectId: "proj_a",
    status: "queued",
  });

  await new Promise((r) => setTimeout(r, 5));

  const updated = await store.updateRun(run.id, {
    status: "running",
    currentStageType: "creative_plan",
    progressPercent: 20,
    message: "Planning a 60-second explainer.",
    startedAt: new Date().toISOString(),
  });

  assert.equal(updated.id, run.id);
  assert.equal(updated.projectId, run.projectId);
  assert.equal(updated.schemaVersion, run.schemaVersion);
  assert.equal(updated.createdAt, run.createdAt);
  assert.notEqual(updated.updatedAt, run.updatedAt);
  assert.equal(updated.status, "running");
  assert.equal(updated.currentStageType, "creative_plan");
  assert.equal(updated.progressPercent, 20);
});

test("updateRun ignores attempts to clobber projectId/schemaVersion/createdAt", async () => {
  const run = await store.createRun({
    projectId: "proj_a",
    status: "queued",
  });

  // Cast to `any` to simulate a hand-rolled caller (e.g. raw JSON over the
  // wire) trying to clobber identity fields the patch type forbids. The store
  // must strip them so projectId and createdAt remain stable.
  const updated = await store.updateRun(run.id, {
    projectId: "proj_b",
    createdAt: "1999-01-01T00:00:00.000Z",
    message: "still proj_a",
  } as never);

  assert.equal(updated.projectId, "proj_a");
  assert.equal(updated.createdAt, run.createdAt);
  assert.equal(updated.message, "still proj_a");
});

test("updateRun throws when the run does not exist", async () => {
  await assert.rejects(
    () => store.updateRun("genrun_missing", { status: "failed" }),
    /generation run not found/
  );
});

test("listRunsForProject returns only that project's runs, newest first", async () => {
  const a1 = await store.createRun({ projectId: "proj_a", status: "queued" });
  await new Promise((r) => setTimeout(r, 5));
  const a2 = await store.createRun({ projectId: "proj_a", status: "queued" });
  await store.createRun({ projectId: "proj_b", status: "queued" });

  const aList = await store.listRunsForProject("proj_a");
  assert.equal(aList.length, 2);
  assert.equal(aList[0].id, a2.id);
  assert.equal(aList[1].id, a1.id);

  const bList = await store.listRunsForProject("proj_b");
  assert.equal(bList.length, 1);

  const cList = await store.listRunsForProject("proj_missing");
  assert.deepEqual(cList, []);
});

test("stages are stored per run and listed in order", async () => {
  const run = await store.createRun({
    projectId: "proj_a",
    status: "running",
  });

  await store.saveStage({
    runId: run.id,
    type: "asset_generation",
    label: "Generating visuals",
    order: 2,
    status: "queued",
    jobIds: [],
    artifactIds: [],
  });
  await store.saveStage({
    runId: run.id,
    type: "creative_plan",
    label: "Planning",
    order: 1,
    status: "running",
    jobIds: ["job_x"],
    artifactIds: [],
  });
  // Stage for a different run should not leak in.
  const otherRun = await store.createRun({
    projectId: "proj_a",
    status: "queued",
  });
  await store.saveStage({
    runId: otherRun.id,
    type: "creative_plan",
    label: "Other plan",
    order: 1,
    status: "queued",
    jobIds: [],
    artifactIds: [],
  });

  const stages = await store.listStagesForRun(run.id);
  assert.equal(stages.length, 2);
  assert.equal(stages[0].order, 1);
  assert.equal(stages[0].type, "creative_plan");
  assert.equal(stages[1].order, 2);
  assert.equal(stages[1].type, "asset_generation");
  for (const s of stages) {
    assert.equal(s.schemaVersion, "genstage.v1");
    assert.match(s.id, /^genstage_/);
  }
});

test("updateStage bumps updatedAt and preserves runId", async () => {
  const run = await store.createRun({ projectId: "proj_a", status: "running" });
  const stage = await store.saveStage({
    runId: run.id,
    type: "asset_generation",
    label: "Generating visuals",
    order: 1,
    status: "queued",
    jobIds: [],
    artifactIds: [],
  });

  await new Promise((r) => setTimeout(r, 5));

  const updated = await store.updateStage(stage.id, {
    status: "running",
    progressPercent: 50,
    jobIds: ["job_1", "job_2"],
    message: "Generating visual 4 of 8.",
  });

  assert.equal(updated.runId, run.id);
  assert.equal(updated.status, "running");
  assert.equal(updated.progressPercent, 50);
  assert.deepEqual(updated.jobIds, ["job_1", "job_2"]);
  assert.notEqual(updated.updatedAt, stage.updatedAt);
  assert.equal(updated.createdAt, stage.createdAt);
});

test("stage items are scoped by stageId and updatable", async () => {
  const run = await store.createRun({ projectId: "proj_a", status: "running" });
  const stage = await store.saveStage({
    runId: run.id,
    type: "asset_generation",
    label: "Generating visuals",
    order: 1,
    status: "running",
    jobIds: [],
    artifactIds: [],
  });

  const item = await store.saveStageItem({
    stageId: stage.id,
    runId: run.id,
    kind: "image",
    label: "Beat 1: hook still",
    status: "running",
    provider: "imagen-3",
    promptPreview: "cinematic still of...",
  });

  assert.match(item.id, /^genitem_/);
  assert.equal(item.schemaVersion, "genitem.v1");

  const completed = await store.updateStageItem(item.id, {
    status: "succeeded",
    assetId: "asset_42",
    progressPercent: 100,
  });
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.assetId, "asset_42");
  assert.equal(completed.stageId, stage.id);

  // Item belonging to a different stage must not leak.
  const otherStage = await store.saveStage({
    runId: run.id,
    type: "audio_generation",
    label: "Narration",
    order: 2,
    status: "queued",
    jobIds: [],
    artifactIds: [],
  });
  await store.saveStageItem({
    stageId: otherStage.id,
    runId: run.id,
    kind: "audio",
    label: "Narration take 1",
    status: "queued",
  });

  const items = await store.listStageItemsForStage(stage.id);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, item.id);
});

test("refresh recovery: a fresh store instance over the same dir reads prior records", async () => {
  const run = await store.createRun({ projectId: "proj_a", status: "running" });
  await store.saveStage({
    runId: run.id,
    type: "creative_plan",
    label: "Planning",
    order: 1,
    status: "running",
    jobIds: [],
    artifactIds: [],
  });

  const reopened = createGenerationRunsStore(tmpDir);
  const recovered = await reopened.getRun(run.id);
  assert.ok(recovered);
  assert.equal(recovered!.id, run.id);

  const stages = await reopened.listStagesForRun(run.id);
  assert.equal(stages.length, 1);
  assert.equal(stages[0].type, "creative_plan");
});
