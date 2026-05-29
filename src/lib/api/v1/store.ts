// Assumed PR1 contract: persistence for projects, assets, jobs, and
// idempotency records. This is a file-backed local implementation so PR2 is
// runnable and testable now; PR1's real store (Postgres/hosted) should
// supersede it behind the same function surface.

import { promises as fs } from "fs";
import path from "path";
import { dbPath, localDir } from "./config";
import {
  IdempotencyRecord,
  PROJECT_SCHEMA_VERSION,
  ProjectStatus,
  V1Asset,
  V1Job,
  V1Project,
} from "./types";

interface Db {
  projects: V1Project[];
  assets: V1Asset[];
  jobs: V1Job[];
  idempotency: IdempotencyRecord[];
}

function emptyDb(): Db {
  return { projects: [], assets: [], jobs: [], idempotency: [] };
}

export function newId(prefix: string): string {
  return `${prefix}_` + Math.random().toString(36).slice(2, 10);
}

async function readDb(): Promise<Db> {
  try {
    const raw = await fs.readFile(dbPath(), "utf8");
    return { ...emptyDb(), ...(JSON.parse(raw) as Partial<Db>) } as Db;
  } catch {
    return emptyDb();
  }
}

async function writeDb(db: Db): Promise<void> {
  await fs.mkdir(localDir(), { recursive: true });
  await fs.writeFile(dbPath(), JSON.stringify(db, null, 2), "utf8");
}

// Serialize read-modify-write so concurrent route handlers don't clobber the
// single JSON file.
let queue: Promise<unknown> = Promise.resolve();

function withDb<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const db = await readDb();
    const result = await fn(db);
    await writeDb(db);
    return result;
  });
  // Keep the chain alive even if this op rejects.
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function readOnly<T>(fn: (db: Db) => T): Promise<T> {
  return queue.then(async () => fn(await readDb()));
}

export interface CreateProjectInput {
  workspaceId: string;
  name: string;
  brief?: Record<string, unknown>;
}

export function createProject(input: CreateProjectInput): Promise<V1Project> {
  return withDb((db) => {
    const now = new Date().toISOString();
    const project: V1Project = {
      id: newId("proj"),
      schemaVersion: PROJECT_SCHEMA_VERSION,
      workspaceId: input.workspaceId,
      name: input.name,
      status: "active",
      brief: input.brief,
      createdAt: now,
      updatedAt: now,
    };
    db.projects.push(project);
    return project;
  });
}

export function getProject(
  workspaceId: string,
  projectId: string,
  { includeDeleted = false }: { includeDeleted?: boolean } = {}
): Promise<V1Project | null> {
  return readOnly((db) => {
    const project = db.projects.find(
      (p) => p.id === projectId && p.workspaceId === workspaceId
    );
    if (!project) return null;
    if (project.status === "deleted" && !includeDeleted) return null;
    return project;
  });
}

export function addAsset(asset: V1Asset): Promise<V1Asset> {
  return withDb((db) => {
    db.assets.push(asset);
    return asset;
  });
}

export interface ListAssetsOptions {
  kind?: V1Asset["kind"];
  limit?: number;
  cursor?: string | null;
}

export interface ListAssetsResult {
  assets: V1Asset[];
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export function listAssets(
  workspaceId: string,
  projectId: string,
  options: ListAssetsOptions = {}
): Promise<ListAssetsResult> {
  return readOnly((db) => {
    const limit = Math.max(
      1,
      Math.min(MAX_LIMIT, options.limit || DEFAULT_LIMIT)
    );
    // Newest first.
    const all = db.assets
      .filter(
        (a) => a.workspaceId === workspaceId && a.projectId === projectId
      )
      .filter((a) => (options.kind ? a.kind === options.kind : true))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    const startIndex = options.cursor
      ? all.findIndex((a) => a.id === options.cursor) + 1
      : 0;
    const page = all.slice(startIndex, startIndex + limit);
    const nextCursor =
      startIndex + limit < all.length ? page[page.length - 1].id : null;
    return { assets: page, nextCursor };
  });
}

export function getAsset(
  workspaceId: string,
  projectId: string,
  assetId: string
): Promise<V1Asset | null> {
  return readOnly(
    (db) =>
      db.assets.find(
        (a) =>
          a.id === assetId &&
          a.projectId === projectId &&
          a.workspaceId === workspaceId
      ) || null
  );
}

export function createJob(
  job: Omit<V1Job, "id" | "createdAt" | "updatedAt">
): Promise<V1Job> {
  return withDb((db) => {
    const now = new Date().toISOString();
    const full: V1Job = {
      ...job,
      id: newId("job"),
      createdAt: now,
      updatedAt: now,
    };
    db.jobs.push(full);
    return full;
  });
}

export type ReserveJobInput = Omit<
  V1Job,
  "id" | "createdAt" | "updatedAt"
> & { scope: string; bodyHash: string };

export type ReserveJobResult =
  | { kind: "reserved"; job: V1Job }
  | { kind: "existing"; record: IdempotencyRecord };

// Atomically claim an idempotency key and create its job in a single
// transaction. If the key already exists (even as an in-flight reservation),
// the existing record is returned instead so concurrent retries never start a
// second generation.
export function reserveJob(input: ReserveJobInput): Promise<ReserveJobResult> {
  const { scope, bodyHash, ...jobInput } = input;
  return withDb((db) => {
    const existing = db.idempotency.find((r) => r.scope === scope);
    if (existing) return { kind: "existing", record: existing };

    const now = new Date().toISOString();
    const job: V1Job = {
      ...jobInput,
      id: newId("job"),
      createdAt: now,
      updatedAt: now,
    };
    db.jobs.push(job);
    db.idempotency.push({
      scope,
      bodyHash,
      status: "pending",
      jobId: job.id,
      response: null,
      createdAt: now,
      updatedAt: now,
    });
    return { kind: "reserved", job };
  });
}

// Finalize a reservation with the response that retries should replay.
export function completeIdempotency(
  scope: string,
  response: { status: number; body: unknown }
): Promise<void> {
  return withDb((db) => {
    const record = db.idempotency.find((r) => r.scope === scope);
    if (record) {
      record.status = "completed";
      record.response = response;
      record.updatedAt = new Date().toISOString();
    }
  });
}

// Release a reservation (e.g. after a failed generation) so the key can be
// retried rather than permanently caching a failure.
export function releaseIdempotency(scope: string): Promise<void> {
  return withDb((db) => {
    db.idempotency = db.idempotency.filter((r) => r.scope !== scope);
  });
}

export function updateJob(
  jobId: string,
  patch: Partial<Omit<V1Job, "id" | "createdAt">>
): Promise<V1Job> {
  return withDb((db) => {
    const job = db.jobs.find((j) => j.id === jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    return job;
  });
}

export function getJob(
  workspaceId: string,
  jobId: string
): Promise<V1Job | null> {
  return readOnly(
    (db) =>
      db.jobs.find((j) => j.id === jobId && j.workspaceId === workspaceId) ||
      null
  );
}
