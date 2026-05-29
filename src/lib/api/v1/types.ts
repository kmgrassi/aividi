// Assumed PR1 contract: shared `/api/v1` resource shapes.
//
// PR2 ("Generated Asset Endpoint For Agents") is being built in parallel with
// PR1 ("Versioned Agent Project And Asset Foundation"). These types encode the
// assumptions PR2 makes about PR1's data model so the two branches can be
// reconciled. When PR1 lands, its real definitions should supersede this file.

import type {
  GeneratedAssetCharacterBinding,
  GenerationPreflightResult,
} from "@/lib/types";
import type { GenerativeAssetKind } from "@/lib/generative/types";

export const PROJECT_SCHEMA_VERSION = "project.v1" as const;
export const ASSET_SCHEMA_VERSION = "asset.v1" as const;
export const JOB_SCHEMA_VERSION = "job.v1" as const;

export type AuthMode = "local" | "hosted";

export interface RequestActor {
  id: string;
  workspaceId: string;
  mode: AuthMode;
}

export interface RequestContext {
  requestId: string;
  actor: RequestActor;
}

export type ProjectStatus = "active" | "deleted";

export interface V1Project {
  id: string;
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  workspaceId: string;
  name: string;
  status: ProjectStatus;
  brief?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type AssetSourceType =
  | "generated"
  | "upload"
  | "remote_url"
  | "local_path";

export type AssetStatus = "processing" | "ready" | "failed";

// Settings used to produce a generated asset, persisted so agents can later
// reconstruct or reproduce the request.
export interface GeneratedAssetProviderSettings {
  model?: string;
  size?: string;
  quality?: string;
  seconds?: number;
  audioMode?: string;
  voiceId?: string;
  outputFormat?: string;
  languageCode?: string;
  loop?: boolean;
  promptInfluence?: number;
  forceInstrumental?: boolean;
  // Provider-returned consistency/reference settings, when present.
  consistency?: Record<string, unknown>;
}

// Mirrors the "Generated Asset Provenance" data-model addition in the scope doc.
export interface GeneratedAssetProvenance {
  provider: string;
  model?: string;
  prompt: string;
  providerPrompt?: string;
  preflight?: GenerationPreflightResult;
  referenceAssetIds?: string[];
  characterBinding?: GeneratedAssetCharacterBinding;
  providerSettings?: GeneratedAssetProviderSettings;
  requestedDurationSec?: number;
  actualDurationSec?: number;
}

export interface V1Asset {
  id: string;
  schemaVersion: typeof ASSET_SCHEMA_VERSION;
  workspaceId: string;
  projectId: string;
  kind: GenerativeAssetKind;
  source: AssetSourceType;
  status: AssetStatus;
  filename: string;
  url: string;
  storagePath?: string;
  mimeType: string;
  durationSec?: number;
  description?: string;
  provenance?: GeneratedAssetProvenance;
  createdAt: string;
  updatedAt: string;
}

export type JobType =
  | "asset_ingest"
  | "asset_generation"
  | "composition"
  | "timeline_generation"
  | "audio_alignment"
  | "revision"
  | "export";

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";

export interface JobProgress {
  currentStep?: string;
  percent?: number;
}

export interface V1Job {
  id: string;
  schemaVersion: typeof JOB_SCHEMA_VERSION;
  workspaceId: string;
  projectId: string;
  type: JobType;
  status: JobStatus;
  progress?: JobProgress;
  result?: unknown;
  error?: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
}

export type IdempotencyStatus = "pending" | "completed";

export interface IdempotencyRecord {
  scope: string;
  bodyHash: string;
  status: IdempotencyStatus;
  jobId?: string;
  response: { status: number; body: unknown } | null;
  createdAt: string;
  updatedAt: string;
}
