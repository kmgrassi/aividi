"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  GenerationRun,
  GenerationRunStatus,
  GenerationStage,
} from "@/lib/runs/types";

const POLL_INTERVAL_MS = 2000;

function isTerminal(status: GenerationRunStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

function formatElapsed(startIso: string | undefined): string {
  if (!startIso) return "0s";
  const seconds = Math.max(
    0,
    Math.round((Date.now() - new Date(startIso).getTime()) / 1000)
  );
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function stageBadge(status: GenerationRunStatus): string {
  switch (status) {
    case "running":
      return "●";
    case "succeeded":
      return "✓";
    case "failed":
      return "✕";
    case "canceled":
      return "—";
    default:
      return "○";
  }
}

export function RunProgress({
  projectId,
  runId,
  onReady,
}: {
  projectId: string;
  runId: string;
  onReady: () => void;
}) {
  const [run, setRun] = useState<GenerationRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const readyFired = useRef(false);

  // Poll the run endpoint while the document is visible and the run is not
  // terminal. We stop polling on terminal status, on document hidden, and on
  // unmount — and immediately re-poll on tab focus so the UI catches up.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const res = await fetch(
          `/api/v1/projects/${encodeURIComponent(projectId)}/generation-runs/${encodeURIComponent(runId)}`,
          { cache: "no-store" }
        );
        if (cancelled) return;
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error?.message || `Run lookup failed (${res.status})`);
        }
        const data = (await res.json()) as { run: GenerationRun };
        setRun(data.run);
        if (isTerminal(data.run.status)) return;
        if (document.visibilityState === "hidden") return;
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        timer = setTimeout(poll, POLL_INTERVAL_MS * 2);
      }
    }

    void poll();

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        if (timer) clearTimeout(timer);
        void poll();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [projectId, runId]);

  // Drive elapsed-time updates while the run is active.
  useEffect(() => {
    if (run && isTerminal(run.status)) return;
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [run]);

  // Hand off to the editor when the run terminally succeeds.
  useEffect(() => {
    if (run?.status === "succeeded" && !readyFired.current) {
      readyFired.current = true;
      onReady();
    }
  }, [run, onReady]);

  if (!run && !error) {
    return (
      <div className="run-progress">
        <p className="run-progress-status">Starting your run…</p>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="run-progress">
        <p className="run-progress-status error">{error}</p>
      </div>
    );
  }

  const elapsedFrom = run.startedAt || run.createdAt;
  // Reference `tick` so the elapsed clock re-renders each second.
  void tick;

  return (
    <div className="run-progress">
      <header className="run-progress-header">
        <h1>Generating your video</h1>
        <p className="run-progress-sub">
          {run.message || "Working on your prompt…"}
        </p>
        <p className="run-progress-meta">
          Elapsed {formatElapsed(elapsedFrom)} · Status {run.status}
          {typeof run.progressPercent === "number"
            ? ` · ${run.progressPercent}%`
            : ""}
        </p>
      </header>

      <ol className="run-progress-rail">
        {run.stages.map((stage: GenerationStage) => (
          <li key={stage.stageId} className={`run-stage run-stage-${stage.status}`}>
            <span className="run-stage-badge" aria-hidden>
              {stageBadge(stage.status)}
            </span>
            <span className="run-stage-label">{stage.label}</span>
            {stage.message && !stage.error && (
              <span className="run-stage-message">{stage.message}</span>
            )}
            {stage.error && (
              <span className="run-stage-error">{stage.error.message}</span>
            )}
          </li>
        ))}
      </ol>

      {run.status === "failed" && run.error && (
        <div className="run-progress-failure" role="alert">
          <h2>Generation failed</h2>
          <p>{run.error.message}</p>
          <p>
            <a className="run-progress-link" href="/">
              ← Back to landing
            </a>
          </p>
        </div>
      )}

      {error && run.status !== "failed" && (
        <p className="run-progress-status error">{error}</p>
      )}
    </div>
  );
}
