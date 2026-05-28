// Assumed PR1 contract: local persistence + media locations.
//
// Metadata persists under `.local/` (per the contract's local-mode behavior).
// Generated media is written under `public/generated/` so it is statically
// served and viewable by the existing UI; hosted deployments would swap this
// for object storage. All paths are env-overridable so tests can use temp dirs.

import path from "path";

export function localDir(): string {
  return process.env.AIVIDI_LOCAL_DIR || path.join(process.cwd(), ".local");
}

export function dbPath(): string {
  return path.join(localDir(), "db.json");
}

export function generatedMediaDir(): string {
  return (
    process.env.AIVIDI_GENERATED_DIR ||
    path.join(process.cwd(), "public", "generated")
  );
}

export function generatedUrlBase(): string {
  return process.env.AIVIDI_GENERATED_URL_BASE || "/generated";
}
