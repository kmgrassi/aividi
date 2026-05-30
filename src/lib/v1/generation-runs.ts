import { promises as fs } from "fs";
import path from "path";
import { defaultDbDir } from "./store";

// Local persistence for generation runs, stages, and stage items
// (scope doc: docs/scopes/generation-progress-ui.md, PR 2).
//
// Records live under `.local/dev-db/` alongside the rest of the v1 store, one
// JSON file per record keyed by ID. The status vocabulary (`queued` ... `canceled`)
// matches the existing job vocab so a run is always interpretable as an aggregate
// over the jobs that produced it.
//
// Types are defined inline here rather than in src/lib/v1/types.ts to keep this
// PR minimal; a future PR can promote them to the shared contract module.

// --- Types -----------------------------------------------------------------

export const GENERATION_SCHEMA = {
  run: "genrun.v1",
  stage: "genstage.v1",
  stageItem: "genitem.v1",
} as const;

export type GenerationRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";

export type GenerationStageType =
  | "brief_intake"
  | "creative_plan"
  | "asset_generation"
  | "audio_generation"
  | "timeline_assembly"
  | "quality_review"
  | "export"
  | "ready";

export type GenerationStageItemKind =
  | "image"
  | "video"
  | "audio"
  | "caption"
  | "timeline"
  | "export";

export interface GenerationErrorSummary {
  code: string;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export interface GenerationRun {
  id: string;
  schemaVersion: typeof GENERATION_SCHEMA.run;
  projectId: string;
  briefVersionId?: string;
  status: GenerationRunStatus;
  currentStageType?: GenerationStageType;
  progressPercent?: number;
  message?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: GenerationErrorSummary;
}

export interface GenerationStage {
  id: string;
  schemaVersion: typeof GENERATION_SCHEMA.stage;
  runId: string;
  type: GenerationStageType;
  label: string;
  order: number;
  status: GenerationRunStatus;
  progressPercent?: number;
  message?: string;
  startedAt?: string;
  completedAt?: string;
  jobIds: string[];
  artifactIds: string[];
  createdAt: string;
  updatedAt: string;
  error?: GenerationErrorSummary;
}

export interface GenerationStageItem {
  id: string;
  schemaVersion: typeof GENERATION_SCHEMA.stageItem;
  stageId: string;
  runId: string;
  kind: GenerationStageItemKind;
  label: string;
  status: GenerationRunStatus;
  progressPercent?: number;
  provider?: string;
  promptPreview?: string;
  assetId?: string;
  artifactId?: string;
  retryable?: boolean;
  createdAt: string;
  updatedAt: string;
  error?: GenerationErrorSummary;
}

// --- Store -----------------------------------------------------------------

export type CreateGenerationRunInput = Omit<
  GenerationRun,
  "id" | "schemaVersion" | "createdAt" | "updatedAt"
> & { id?: string };

export type CreateGenerationStageInput = Omit<
  GenerationStage,
  "id" | "schemaVersion" | "createdAt" | "updatedAt"
> & { id?: string };

export type CreateGenerationStageItemInput = Omit<
  GenerationStageItem,
  "id" | "schemaVersion" | "createdAt" | "updatedAt"
> & { id?: string };

export type UpdateGenerationRunPatch = Partial<
  Omit<GenerationRun, "id" | "schemaVersion" | "projectId" | "createdAt">
>;

export type UpdateGenerationStagePatch = Partial<
  Omit<GenerationStage, "id" | "schemaVersion" | "runId" | "createdAt">
>;

export type UpdateGenerationStageItemPatch = Partial<
  Omit<
    GenerationStageItem,
    "id" | "schemaVersion" | "stageId" | "runId" | "createdAt"
  >
>;

export interface GenerationRunsStore {
  createRun(input: CreateGenerationRunInput): Promise<GenerationRun>;
  getRun(id: string): Promise<GenerationRun | null>;
  updateRun(
    id: string,
    patch: UpdateGenerationRunPatch
  ): Promise<GenerationRun>;
  listRunsForProject(projectId: string): Promise<GenerationRun[]>;

  saveStage(input: CreateGenerationStageInput): Promise<GenerationStage>;
  getStage(id: string): Promise<GenerationStage | null>;
  updateStage(
    id: string,
    patch: UpdateGenerationStagePatch
  ): Promise<GenerationStage>;
  listStagesForRun(runId: string): Promise<GenerationStage[]>;

  saveStageItem(
    input: CreateGenerationStageItemInput
  ): Promise<GenerationStageItem>;
  getStageItem(id: string): Promise<GenerationStageItem | null>;
  updateStageItem(
    id: string,
    patch: UpdateGenerationStageItemPatch
  ): Promise<GenerationStageItem>;
  listStageItemsForStage(stageId: string): Promise<GenerationStageItem[]>;
}

const COLLECTIONS = {
  runs: "generation-runs",
  stages: "generation-stages",
  stageItems: "generation-stage-items",
} as const;

function safeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function rand(): string {
  return Math.random().toString(36).slice(2, 10);
}

function newId(prefix: string): string {
  return `${prefix}_${rand()}`;
}

export function createGenerationRunsStore(
  rootDir: string
): GenerationRunsStore {
  function dir(collection: string): string {
    return path.join(rootDir, collection);
  }

  function file(collection: string, key: string): string {
    return path.join(dir(collection), `${safeKey(key)}.json`);
  }

  async function readJson<T>(
    collection: string,
    key: string
  ): Promise<T | null> {
    try {
      const raw = await fs.readFile(file(collection, key), "utf8");
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async function writeJson<T>(
    collection: string,
    key: string,
    value: T
  ): Promise<T> {
    await fs.mkdir(dir(collection), { recursive: true });
    await fs.writeFile(
      file(collection, key),
      JSON.stringify(value, null, 2),
      "utf8"
    );
    return value;
  }

  async function readAll<T>(collection: string): Promise<T[]> {
    let names: string[];
    try {
      names = await fs.readdir(dir(collection));
    } catch {
      return [];
    }
    const records: T[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(
          path.join(dir(collection), name),
          "utf8"
        );
        records.push(JSON.parse(raw) as T);
      } catch {
        // Skip unreadable/partial records rather than failing the whole list.
      }
    }
    return records;
  }

  return {
    async createRun(input) {
      const now = new Date().toISOString();
      const run: GenerationRun = {
        ...input,
        id: input.id ?? newId("genrun"),
        schemaVersion: GENERATION_SCHEMA.run,
        createdAt: now,
        updatedAt: now,
      };
      await writeJson(COLLECTIONS.runs, run.id, run);
      return run;
    },

    getRun: (id) => readJson<GenerationRun>(COLLECTIONS.runs, id),

    async updateRun(id, patch) {
      const current = await readJson<GenerationRun>(COLLECTIONS.runs, id);
      if (!current) {
        throw new Error(`generation run not found: ${id}`);
      }
      const next: GenerationRun = {
        ...current,
        ...patch,
        id: current.id,
        schemaVersion: current.schemaVersion,
        projectId: current.projectId,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
      };
      await writeJson(COLLECTIONS.runs, id, next);
      return next;
    },

    async listRunsForProject(projectId) {
      const all = await readAll<GenerationRun>(COLLECTIONS.runs);
      return all
        .filter((r) => r.projectId === projectId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },

    async saveStage(input) {
      const now = new Date().toISOString();
      const stage: GenerationStage = {
        ...input,
        id: input.id ?? newId("genstage"),
        schemaVersion: GENERATION_SCHEMA.stage,
        createdAt: now,
        updatedAt: now,
      };
      await writeJson(COLLECTIONS.stages, stage.id, stage);
      return stage;
    },

    getStage: (id) => readJson<GenerationStage>(COLLECTIONS.stages, id),

    async updateStage(id, patch) {
      const current = await readJson<GenerationStage>(COLLECTIONS.stages, id);
      if (!current) {
        throw new Error(`generation stage not found: ${id}`);
      }
      const next: GenerationStage = {
        ...current,
        ...patch,
        id: current.id,
        schemaVersion: current.schemaVersion,
        runId: current.runId,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
      };
      await writeJson(COLLECTIONS.stages, id, next);
      return next;
    },

    async listStagesForRun(runId) {
      const all = await readAll<GenerationStage>(COLLECTIONS.stages);
      return all
        .filter((s) => s.runId === runId)
        .sort((a, b) => a.order - b.order);
    },

    async saveStageItem(input) {
      const now = new Date().toISOString();
      const item: GenerationStageItem = {
        ...input,
        id: input.id ?? newId("genitem"),
        schemaVersion: GENERATION_SCHEMA.stageItem,
        createdAt: now,
        updatedAt: now,
      };
      await writeJson(COLLECTIONS.stageItems, item.id, item);
      return item;
    },

    getStageItem: (id) =>
      readJson<GenerationStageItem>(COLLECTIONS.stageItems, id),

    async updateStageItem(id, patch) {
      const current = await readJson<GenerationStageItem>(
        COLLECTIONS.stageItems,
        id
      );
      if (!current) {
        throw new Error(`generation stage item not found: ${id}`);
      }
      const next: GenerationStageItem = {
        ...current,
        ...patch,
        id: current.id,
        schemaVersion: current.schemaVersion,
        stageId: current.stageId,
        runId: current.runId,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
      };
      await writeJson(COLLECTIONS.stageItems, id, next);
      return next;
    },

    async listStageItemsForStage(stageId) {
      const all = await readAll<GenerationStageItem>(COLLECTIONS.stageItems);
      return all
        .filter((i) => i.stageId === stageId)
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    },
  };
}

let _store: GenerationRunsStore | null = null;
export function getGenerationRunsStore(): GenerationRunsStore {
  if (!_store) _store = createGenerationRunsStore(defaultDbDir());
  return _store;
}
