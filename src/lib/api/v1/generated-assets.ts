// PR2: Generated Asset Endpoint For Agents.
//
// Turns an agent generation request into a normal project asset with full
// provenance, modeled as an `asset_generation` job. Reuses the existing
// preflight + provider pipeline; adds typed errors, idempotency, and actual
// audio-duration capture.

import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { parseConsistencyMode } from "@/lib/generative/character-context";
import { preflightGenerationContent } from "@/lib/generative/preflight";
import { providerFor } from "@/lib/generative/providers";
import {
  AudioGenerationMode,
  DialogueInput,
  GenerativeAssetKind,
  GenerativeProviderName,
} from "@/lib/generative/types";
import type { GeneratedAssetCharacterBinding } from "@/lib/types";
import { measureAudioDurationSec } from "./audio-duration";
import { generatedMediaDir, generatedUrlBase } from "./config";
import { ApiError, fieldError } from "./errors";
import {
  addAsset,
  createJob,
  getAsset,
  getIdempotency,
  getJob,
  getProject,
  newId,
  putIdempotency,
  updateJob,
} from "./store";
import {
  ASSET_SCHEMA_VERSION,
  GeneratedAssetProvenance,
  JOB_SCHEMA_VERSION,
  RequestContext,
  V1Asset,
  V1Job,
} from "./types";

const CHARACTER_PROMPT_INVARIANT_VERSION = "char.invariant.v1";
const DEFAULT_AUDIO_OUTPUT_FORMAT = "mp3_44100_128";
const AUDIO_MODES = new Set(["speech", "dialogue", "sound_effect", "music"]);

// provider -> supported kinds. Kept local to v1 so it can diverge from the
// browser route's rules as providers gain capabilities.
const PROVIDER_KIND_SUPPORT: Record<
  GenerativeProviderName,
  GenerativeAssetKind[]
> = {
  openai: ["image", "video"],
  gemini: ["video"],
  elevenlabs: ["audio"],
  mock: ["image", "video", "audio"],
  nanobanano: [],
};

interface ParsedRequest {
  kind: GenerativeAssetKind;
  provider: GenerativeProviderName;
  prompt: string;
  description: string;
  durationSec: number;
  providerSeconds?: number;
  referenceAssetIds: string[];
  characterProfileIds: string[];
  characterReferenceIds: string[];
  consistencyMode: ReturnType<typeof parseConsistencyMode>;
  preflightIterations: number;
  audioMode?: AudioGenerationMode;
  dialogueInputs?: DialogueInput[];
  model?: string;
  size?: string;
  quality?: "low" | "medium" | "high" | "auto";
  voiceId?: string;
  outputFormat?: string;
  languageCode?: string;
  loop?: boolean;
  promptInfluence?: number;
  forceInstrumental?: boolean;
}

export interface CreateGeneratedAssetArgs {
  ctx: RequestContext;
  projectId: string;
  body: unknown;
  idempotencyKey: string | null;
}

export interface GetGeneratedAssetJobArgs {
  ctx: RequestContext;
  projectId: string;
  jobId: string;
}

export interface V1Result {
  status: number;
  body: { job: V1Job };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("validation_failed", "Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function normalizeProvider(
  value: unknown,
  kind: GenerativeAssetKind
): GenerativeProviderName | null {
  const fallback = kind === "audio" ? "elevenlabs" : "openai";
  const name = String(value || fallback).toLowerCase();
  if (name === "openai") return "openai";
  if (name === "gemini") return "gemini";
  if (name === "elevenlabs") return "elevenlabs";
  if (name === "mock") return "mock";
  if (name === "nanobanano" || name === "nano-banano" || name === "nano_banano") {
    return "nanobanano";
  }
  return null;
}

function parseAudioMode(value: unknown): AudioGenerationMode | undefined {
  const mode = String(value || "");
  return AUDIO_MODES.has(mode) ? (mode as AudioGenerationMode) : undefined;
}

function parseQuality(value: unknown): ParsedRequest["quality"] {
  const q = String(value || "");
  return q === "low" || q === "medium" || q === "high" || q === "auto"
    ? q
    : undefined;
}

function parseRequest(body: unknown): ParsedRequest {
  const b = asRecord(body);

  const kind = String(b.kind ?? "image") as GenerativeAssetKind;
  if (kind !== "image" && kind !== "video" && kind !== "audio") {
    throw new ApiError(
      "validation_failed",
      "kind must be one of image, video, or audio.",
      fieldError("kind", "Expected image, video, or audio.")
    );
  }

  const provider = normalizeProvider(b.provider, kind);
  if (!provider) {
    throw new ApiError(
      "validation_failed",
      `Unknown generative provider: ${String(b.provider)}.`,
      fieldError("provider", "Unknown provider.")
    );
  }

  const supportedKinds = PROVIDER_KIND_SUPPORT[provider];
  if (!supportedKinds.includes(kind)) {
    const reason = supportedKinds.length
      ? `Provider "${provider}" supports ${supportedKinds.join(
          ", "
        )} generation, not ${kind}.`
      : `Provider "${provider}" is registered but not implemented yet.`;
    throw new ApiError(
      "validation_failed",
      reason,
      fieldError("provider", reason)
    );
  }

  const audioMode = parseAudioMode(b.audioMode);
  const dialogueInputs: DialogueInput[] | undefined = Array.isArray(
    b.dialogueInputs
  )
    ? (b.dialogueInputs as unknown[]).map((line) => {
        const entry = (line || {}) as Record<string, unknown>;
        return {
          text: String(entry.text || ""),
          voiceId: String(entry.voiceId || entry.voice_id || ""),
        };
      })
    : undefined;
  const hasDialogueText =
    kind === "audio" &&
    audioMode === "dialogue" &&
    Boolean(dialogueInputs?.some((line) => line.text.trim()));

  const prompt = String(b.prompt || "").trim();
  if (!prompt && !hasDialogueText) {
    throw new ApiError(
      "validation_failed",
      "prompt is required unless dialogueInputs are provided.",
      fieldError("prompt", "prompt is required.")
    );
  }

  const dialogueText = dialogueInputs
    ?.map((line) => line.text)
    .filter(Boolean)
    .join(" ");
  const description = String(b.description || prompt || dialogueText || "");

  const seconds = b.seconds !== undefined ? Number(b.seconds) : undefined;
  const durationSec =
    Number(b.durationSec) || (kind === "image" ? 4 : seconds || 8);

  let consistencyMode: ReturnType<typeof parseConsistencyMode>;
  const characterProfileIds = parseStringArray(b.characterProfileIds);
  try {
    consistencyMode =
      b.consistencyMode !== undefined
        ? parseConsistencyMode(b.consistencyMode)
        : parseConsistencyMode(
            characterProfileIds.length > 0 ? "reference_pack" : "prompt_only"
          );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid consistencyMode.";
    throw new ApiError(
      "validation_failed",
      message,
      fieldError("consistencyMode", message)
    );
  }

  const preflightIterations =
    b.preflightReviewIterations === undefined ? 0 : b.preflightReviewIterations;

  return {
    kind,
    provider,
    prompt,
    description,
    durationSec,
    providerSeconds: kind === "image" ? undefined : durationSec,
    referenceAssetIds: parseStringArray(b.referenceAssetIds),
    characterProfileIds,
    characterReferenceIds: parseStringArray(b.characterReferenceIds),
    consistencyMode,
    preflightIterations: preflightIterations as number,
    audioMode,
    dialogueInputs,
    model: b.model ? String(b.model) : undefined,
    size: b.size ? String(b.size) : undefined,
    quality: parseQuality(b.quality),
    voiceId: b.voiceId ? String(b.voiceId) : undefined,
    outputFormat: b.outputFormat ? String(b.outputFormat) : undefined,
    languageCode: b.languageCode ? String(b.languageCode) : undefined,
    loop: typeof b.loop === "boolean" ? b.loop : undefined,
    promptInfluence:
      typeof b.promptInfluence === "number" ? b.promptInfluence : undefined,
    forceInstrumental:
      typeof b.forceInstrumental === "boolean" ? b.forceInstrumental : undefined,
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

function hashBody(body: unknown): string {
  return createHash("sha256").update(stableStringify(body)).digest("hex");
}

function idempotencyScope(
  ctx: RequestContext,
  projectId: string,
  key: string
): string {
  return [
    ctx.actor.id,
    ctx.actor.workspaceId,
    `generated-assets:${projectId}`,
    key,
  ].join("|");
}

async function runGeneration(
  ctx: RequestContext,
  projectId: string,
  parsed: ParsedRequest
): Promise<V1Asset> {
  const referencePaths: string[] = [];
  for (const id of parsed.referenceAssetIds) {
    const asset = await getAsset(ctx.actor.workspaceId, projectId, id);
    if (!asset) {
      throw new ApiError(
        "validation_failed",
        `Reference asset not found: ${id}.`,
        fieldError("referenceAssetIds", `Unknown asset: ${id}.`)
      );
    }
    if (asset.status !== "ready") {
      throw new ApiError(
        "asset_not_ready",
        `Reference asset is not ready: ${id}.`,
        { assetIds: [id] }
      );
    }
    if (asset.storagePath) referencePaths.push(asset.storagePath);
  }

  const preflight = await preflightGenerationContent({
    provider: parsed.provider,
    kind: parsed.kind,
    prompt: parsed.prompt,
    description: parsed.description,
    iterations: parsed.preflightIterations,
    dialogueInputs: parsed.dialogueInputs,
  });

  const provider = providerFor(parsed.provider);
  const result = await provider.generateAsset({
    provider: parsed.provider,
    kind: parsed.kind,
    prompt: preflight.finalPrompt || parsed.prompt,
    referencePaths,
    model: parsed.model,
    size: parsed.size,
    quality: parsed.quality,
    seconds: parsed.providerSeconds,
    audioMode: parsed.audioMode,
    voiceId: parsed.voiceId,
    outputFormat: parsed.outputFormat,
    languageCode: parsed.languageCode,
    dialogueInputs: preflight.finalDialogueInputs || parsed.dialogueInputs,
    loop: parsed.loop,
    promptInfluence: parsed.promptInfluence,
    forceInstrumental: parsed.forceInstrumental,
  });

  const assetId = newId(
    result.kind === "image" ? "img" : result.kind === "audio" ? "aud" : "vid"
  );
  const filename = `${assetId}.${result.extension}`;
  const dir = path.join(generatedMediaDir(), projectId);
  await fs.mkdir(dir, { recursive: true });
  const storagePath = path.join(dir, filename);
  await fs.writeFile(storagePath, result.bytes);
  const url = `${generatedUrlBase()}/${projectId}/${filename}`;

  const actualDurationSec =
    result.kind === "audio"
      ? measureAudioDurationSec(result.bytes, {
          outputFormat: parsed.outputFormat || DEFAULT_AUDIO_OUTPUT_FORMAT,
        })
      : undefined;
  const durationSec =
    result.kind === "audio"
      ? actualDurationSec ?? parsed.durationSec
      : parsed.durationSec;

  const characterBinding: GeneratedAssetCharacterBinding | undefined =
    parsed.characterProfileIds.length > 0
      ? {
          assetId,
          characterProfileIds: parsed.characterProfileIds,
          referenceIds: parsed.characterReferenceIds,
          consistencyMode: parsed.consistencyMode,
          originalPrompt: parsed.prompt,
          promptInvariantVersion: CHARACTER_PROMPT_INVARIANT_VERSION,
        }
      : undefined;

  const provenance: GeneratedAssetProvenance = {
    provider: result.provider,
    model: result.model,
    prompt: preflight.finalPrompt,
    providerPrompt: result.prompt,
    preflight: preflight.completedIterations > 0 ? preflight : undefined,
    referenceAssetIds: parsed.referenceAssetIds.length
      ? parsed.referenceAssetIds
      : undefined,
    characterBinding,
    requestedDurationSec: parsed.durationSec,
    actualDurationSec,
  };

  const now = new Date().toISOString();
  const asset: V1Asset = {
    id: assetId,
    schemaVersion: ASSET_SCHEMA_VERSION,
    workspaceId: ctx.actor.workspaceId,
    projectId,
    kind: result.kind,
    source: "generated",
    status: "ready",
    filename,
    url,
    storagePath,
    mimeType: result.mimeType,
    durationSec,
    description: preflight.finalDescription || parsed.description,
    provenance,
    createdAt: now,
    updatedAt: now,
  };

  return addAsset(asset);
}

export async function createGeneratedAsset(
  args: CreateGeneratedAssetArgs
): Promise<V1Result> {
  const { ctx, projectId, body, idempotencyKey } = args;

  const project = await getProject(ctx.actor.workspaceId, projectId);
  if (!project) {
    throw new ApiError("not_found", `Project not found: ${projectId}.`);
  }

  const parsed = parseRequest(body);

  if (!idempotencyKey || !idempotencyKey.trim()) {
    throw new ApiError(
      "validation_failed",
      "Idempotency-Key header is required for generated-asset creation."
    );
  }

  const scope = idempotencyScope(ctx, projectId, idempotencyKey.trim());
  const bodyHash = hashBody(body);
  const existing = await getIdempotency(scope);
  if (existing) {
    if (existing.bodyHash !== bodyHash) {
      throw new ApiError(
        "idempotency_conflict",
        "Idempotency-Key was already used with a different request body."
      );
    }
    return existing.response as V1Result;
  }

  const job = await createJob({
    schemaVersion: JOB_SCHEMA_VERSION,
    workspaceId: ctx.actor.workspaceId,
    projectId,
    type: "asset_generation",
    status: "running",
    progress: { currentStep: "generating_assets", percent: 10 },
    result: null,
    error: null,
  });

  try {
    const asset = await runGeneration(ctx, projectId, parsed);
    const finished = await updateJob(job.id, {
      status: "succeeded",
      progress: { currentStep: "saving_artifact", percent: 100 },
      result: { assetIds: [asset.id] },
      error: null,
    });
    const response: V1Result = { status: 202, body: { job: finished } };
    await putIdempotency({
      scope,
      bodyHash,
      response,
      createdAt: new Date().toISOString(),
    });
    return response;
  } catch (err) {
    const apiErr =
      err instanceof ApiError
        ? err
        : new ApiError(
            "job_failed",
            err instanceof Error ? err.message : "Asset generation failed."
          );
    await updateJob(job.id, {
      status: "failed",
      error: { code: apiErr.code, message: apiErr.message },
    });
    throw apiErr;
  }
}

export async function getGeneratedAssetJob(
  args: GetGeneratedAssetJobArgs
): Promise<V1Result> {
  const { ctx, projectId, jobId } = args;

  const project = await getProject(ctx.actor.workspaceId, projectId);
  if (!project) {
    throw new ApiError("not_found", `Project not found: ${projectId}.`);
  }

  const job = await getJob(ctx.actor.workspaceId, jobId);
  if (
    !job ||
    job.projectId !== projectId ||
    job.type !== "asset_generation"
  ) {
    throw new ApiError("not_found", `Generated-asset job not found: ${jobId}.`);
  }

  return { status: 200, body: { job } };
}
