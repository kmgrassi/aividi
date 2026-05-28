// Assumed PR1 contract: standard asset listing. Provided here (read-only) so
// PR2's generated assets are demonstrable end-to-end; PR1's implementation
// supersedes this route.

import { NextRequest } from "next/server";
import { runV1Route } from "@/lib/api/v1/http";
import { ApiError } from "@/lib/api/v1/errors";
import { getProject, listAssets } from "@/lib/api/v1/store";
import { GenerativeAssetKind } from "@/lib/generative/types";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function parseKind(value: string | null): GenerativeAssetKind | undefined {
  return value === "image" || value === "video" || value === "audio"
    ? value
    : undefined;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  return runV1Route(req, async (ctx) => {
    const project = await getProject(ctx.actor.workspaceId, params.projectId);
    if (!project) {
      throw new ApiError("not_found", `Project not found: ${params.projectId}.`);
    }

    const sp = req.nextUrl.searchParams;
    const rawLimit = sp.get("limit") ? Number(sp.get("limit")) : DEFAULT_LIMIT;
    const limit = Math.max(1, Math.min(MAX_LIMIT, rawLimit || DEFAULT_LIMIT));
    const cursor = sp.get("cursor");
    const kind = parseKind(sp.get("kind"));

    const { assets, nextCursor } = await listAssets(
      ctx.actor.workspaceId,
      params.projectId,
      { limit, cursor, kind }
    );

    return {
      body: { assets, pagination: { limit, nextCursor } },
    };
  });
}
