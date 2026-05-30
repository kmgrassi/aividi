import { NextRequest, NextResponse } from "next/server";
import { getRun } from "@/lib/runs/store";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

export async function GET(
  _req: NextRequest,
  { params }: { params: { projectId: string; runId: string } }
): Promise<NextResponse> {
  const run = await getRun(params.projectId, params.runId);
  if (!run) {
    return NextResponse.json(
      { error: { code: "not_found", message: `Run not found: ${params.runId}` } },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }
  return NextResponse.json({ run }, { headers: NO_STORE_HEADERS });
}
