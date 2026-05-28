// Assumed PR1 contract: the thin HTTP boundary for `/api/v1` route handlers.
// Resolves the actor, attaches `X-Request-Id`, and renders typed-error
// envelopes. The framework-free core logic lives in sibling modules so it can
// be tested without `next/server`.

import { NextRequest, NextResponse } from "next/server";
import { newRequestId, resolveActor } from "./context";
import { ApiError, errorEnvelope } from "./errors";
import { RequestContext } from "./types";

export interface V1Result {
  status?: number;
  body: unknown;
}

export async function readJsonBody(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError("validation_failed", "Request body must be valid JSON.");
  }
}

export async function runV1Route(
  req: NextRequest,
  handler: (ctx: RequestContext) => Promise<V1Result>
): Promise<NextResponse> {
  const requestId = newRequestId();
  try {
    const actor = resolveActor(req.headers);
    const { status = 200, body } = await handler({ requestId, actor });
    return NextResponse.json(body, {
      status,
      headers: { "X-Request-Id": requestId },
    });
  } catch (err) {
    const apiErr =
      err instanceof ApiError
        ? err
        : new ApiError(
            "internal_error",
            err instanceof Error ? err.message : "Unexpected error."
          );
    return NextResponse.json(errorEnvelope(apiErr, requestId), {
      status: apiErr.status,
      headers: { "X-Request-Id": requestId },
    });
  }
}
