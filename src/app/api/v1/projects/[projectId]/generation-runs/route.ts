import { NextRequest, NextResponse } from "next/server";
import { executeRun } from "@/lib/runs/execute";
import { createRun, listRuns } from "@/lib/runs/store";

export const dynamic = "force-dynamic";
// The browser is no longer held open: the route returns 202 immediately and
// the run continues in the background. The high maxDuration is for the
// background work itself, not the response.
export const maxDuration = 800;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function bad(message: string, status = 400): NextResponse {
  return NextResponse.json(
    { error: { code: "validation_failed", message } },
    { status, headers: NO_STORE_HEADERS }
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: { projectId: string } }
): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return bad("Request body must be valid JSON.");
  }

  const goal = String(body.goal || "").trim();
  if (!goal) return bad("Describe the video you want to create.");

  const run = await createRun({
    projectId: params.projectId,
    inputs: {
      goal,
      targetLengthSec: Number(body.targetLengthSec) || 30,
      style: String(body.style || "fast-paced social ad"),
      aspectRatio: String(body.aspectRatio || "9:16"),
      storyContext: body.storyContext,
    },
  });

  // Fire-and-forget: the response returns immediately while the run continues
  // in the background. Errors during execution are persisted on the run, so
  // the polling UI surfaces them — there is no caller to throw to here.
  void executeRun(run).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[run ${run.runId}] unexpected failure`, err);
  });

  return NextResponse.json(
    { run },
    { status: 202, headers: NO_STORE_HEADERS }
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { projectId: string } }
): Promise<NextResponse> {
  const runs = await listRuns(params.projectId);
  return NextResponse.json({ runs }, { headers: NO_STORE_HEADERS });
}
