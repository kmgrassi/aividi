// Assumed PR1 contract: single asset read. Provided here (read-only) so PR2's
// generated assets are demonstrable end-to-end; PR1's implementation
// supersedes this route.

import { NextRequest } from "next/server";
import { runV1Route } from "@/lib/api/v1/http";
import { ApiError } from "@/lib/api/v1/errors";
import { getAsset, getProject } from "@/lib/api/v1/store";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { projectId: string; assetId: string } }
) {
  return runV1Route(req, async (ctx) => {
    const project = await getProject(ctx.actor.workspaceId, params.projectId);
    if (!project) {
      throw new ApiError("not_found", `Project not found: ${params.projectId}.`);
    }

    const asset = await getAsset(
      ctx.actor.workspaceId,
      params.projectId,
      params.assetId
    );
    if (!asset) {
      throw new ApiError("not_found", `Asset not found: ${params.assetId}.`);
    }

    return { body: { asset } };
  });
}
