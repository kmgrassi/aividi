import { NextRequest } from "next/server";
import { runV1Route } from "@/lib/api/v1/http";
import { getGeneratedAssetJob } from "@/lib/api/v1/generated-assets";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { projectId: string; jobId: string } }
) {
  return runV1Route(req, (ctx) =>
    getGeneratedAssetJob({
      ctx,
      projectId: params.projectId,
      jobId: params.jobId,
    })
  );
}
