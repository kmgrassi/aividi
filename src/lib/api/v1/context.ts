// Assumed PR1 contract: actor/workspace resolution and request IDs.
//
// First-iteration target is the local/open-source flow. `AUTH_MODE=local`
// (the default here) resolves to a deterministic dev actor + workspace. Hosted
// API-key validation is owned by PR1 / later hosted work, so hosted requests
// fail closed with `unauthorized` rather than silently allowing access.

import { ApiError } from "./errors";
import { AuthMode, RequestActor } from "./types";

export const LOCAL_ACTOR_ID = "local_dev";
export const LOCAL_WORKSPACE_ID = "dev_workspace";

export function authMode(): AuthMode {
  return process.env.AUTH_MODE === "hosted" ? "hosted" : "local";
}

export function newRequestId(): string {
  return "req_" + Math.random().toString(36).slice(2, 12);
}

export function resolveActor(_headers: Headers): RequestActor {
  if (authMode() === "local") {
    return {
      id: LOCAL_ACTOR_ID,
      workspaceId: LOCAL_WORKSPACE_ID,
      mode: "local",
    };
  }
  throw new ApiError(
    "unauthorized",
    "Hosted agent authentication is not configured yet. Set AUTH_MODE=local for local development."
  );
}
