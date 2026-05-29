import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { saveProject } from "@/lib/store";
import { critique, planEdit } from "@/lib/agent";
import { applyPatches, sanitizeTimeline } from "@/lib/timeline";
import { providerFor } from "@/lib/generative/providers";
import {
  AspectRatio,
  Beat,
  Clip,
  Project,
  StoryContext,
  Timeline,
  TimelineSegment,
} from "@/lib/types";
import { mergeStoryContext } from "@/lib/story-context";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const GENERATED_DIR = path.join(process.cwd(), "public", "generated");

function newId(prefix: string): string {
  return `${prefix}_` + Math.random().toString(36).slice(2, 10);
}

// Without provider keys we still produce a real timeline using the mock
// provider's placeholder frames, so the one-shot always returns a video.
function defaultImageProvider(): string {
  return process.env.OPENAI_API_KEY ? "openai" : "mock";
}

function imageSizeForAspect(ar: AspectRatio): string {
  if (ar === "16:9") return "1536x1024";
  if (ar === "1:1") return "1024x1024";
  return "1024x1536"; // 9:16
}

function beatImagePrompt(
  goal: string,
  beat: Beat,
  style: string,
  ar: AspectRatio
): string {
  return [
    `${style} cinematic still frame for a ${ar} short-form video.`,
    `Beat: ${beat.name} — ${beat.intent}.`,
    `Overall concept: ${goal}.`,
    `High quality, vivid lighting, strong composition, no on-screen text.`,
  ].join(" ");
}

async function generateImageClip(input: {
  provider: string;
  prompt: string;
  description: string;
  size: string;
  durationSec: number;
}): Promise<Clip> {
  const provider = providerFor(input.provider);
  const result = await provider.generateAsset({
    provider: provider.name,
    kind: "image",
    prompt: input.prompt,
    size: input.size,
  });
  await fs.mkdir(GENERATED_DIR, { recursive: true });
  const id = newId("img");
  const filename = `${id}.${result.extension}`;
  await fs.writeFile(path.join(GENERATED_DIR, filename), result.bytes);
  return {
    id,
    filename,
    url: `/generated/${filename}`,
    kind: "image",
    durationSec: input.durationSec,
    description: input.description,
    source: "generated",
    generatedBy: {
      provider: result.provider,
      model: result.model,
      prompt: result.prompt,
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const goal = String(body.goal || "").trim();
    const targetLengthSec = Number(body.targetLengthSec) || 30;
    const style = String(body.style || "fast-paced social ad");
    const aspectRatio = (body.aspectRatio || "9:16") as AspectRatio;
    const storyContext = mergeStoryContext(body.storyContext as StoryContext);
    const provider = body.provider
      ? String(body.provider)
      : defaultImageProvider();

    if (!goal) {
      return NextResponse.json(
        { error: "Describe the video you want to create." },
        { status: 400 }
      );
    }

    // 1. Plan: goal -> beats
    const plan = await planEdit({
      goal,
      targetLengthSec,
      style,
      aspectRatio,
      storyContext,
    });

    if (!plan.beats || plan.beats.length === 0) {
      return NextResponse.json(
        { error: "The planner returned no beats for this prompt." },
        { status: 502 }
      );
    }

    // 2. Generate one visual per beat from scratch (no uploads required).
    const size = imageSizeForAspect(aspectRatio);
    const clips = await Promise.all(
      plan.beats.map((beat) =>
        generateImageClip({
          provider,
          prompt: beatImagePrompt(goal, beat, style, aspectRatio),
          description: `${beat.name}: ${beat.intent}`,
          size,
          durationSec: Math.max(1.5, Number(beat.durationSec) || 4),
        })
      )
    );

    // 3. Assemble a beat-by-beat timeline from the generated clips.
    const segments: TimelineSegment[] = plan.beats.map((beat, i) => ({
      id: newId("seg"),
      clipId: clips[i].id,
      sourceInSec: 0,
      sourceOutSec: clips[i].durationSec,
      role: beat.name,
      reason: beat.intent,
    }));
    let timeline: Timeline = sanitizeTimeline(
      { aspectRatio, fps: 30, segments },
      clips
    );

    // 4. Critique once and apply patches — but never let it empty the cut.
    const { report, patches } = await critique({
      plan,
      timeline,
      clips,
      storyContext,
    });
    const patched = applyPatches(timeline, patches, clips);
    if (patched.segments.length > 0) timeline = patched;

    const project: Project = {
      id: "default",
      goal,
      storyContext,
      plan,
      timeline,
      clips,
      characterProfiles: [],
      characterReferences: [],
      critic: report,
      chat: [],
      updatedAt: new Date().toISOString(),
    };
    await saveProject(project);

    return NextResponse.json({
      project,
      provider,
      generatedClips: clips.length,
      appliedPatches: patches.length,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "One-shot generation failed" },
      { status: 500 }
    );
  }
}
