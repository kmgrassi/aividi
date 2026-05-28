import { NextRequest } from "next/server";
import { readJsonBody, runV1Route } from "@/lib/api/v1/http";
import { createGeneratedAsset } from "@/lib/api/v1/generated-assets";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  return runV1Route(req, async (ctx) => {
    const body = await readJsonBody(req);
    return createGeneratedAsset({
      ctx,
      projectId: params.projectId,
      body,
      idempotencyKey: req.headers.get("Idempotency-Key"),
    });
  });
}
