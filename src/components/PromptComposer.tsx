"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

const TEMPLATES: { label: string; prompt: string }[] = [
  {
    label: "Product intro",
    prompt:
      "Create a 30-second intro for a new product launch. Hook in the first 3 seconds, show what it does, and end with a strong call to action.",
  },
  {
    label: "Explainer",
    prompt:
      "Make a 30-second explainer that breaks down one big idea simply — open with a question, reveal the key insight, and finish with a satisfying payoff.",
  },
  {
    label: "Social ad",
    prompt:
      "A fast-paced 30-second social ad that shows a relatable problem, reveals the solution, and ends with a punchy call to action.",
  },
  {
    label: "Event hype reel",
    prompt:
      "A high-energy 30-second hype reel announcing an event — build anticipation with quick cuts and end on the date with a call to register.",
  },
];

export function PromptComposer() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function start() {
    const goal = value.trim();
    if (!goal || submitting) return;
    setSubmitting(true);
    router.push(
      `/studio?goal=${encodeURIComponent(goal)}&length=30&autostart=1`
    );
  }

  return (
    <div className="lp-prompt">
      <div className="lp-templates">
        <span className="lp-templates-label">Try a template:</span>
        {TEMPLATES.map((t) => (
          <button
            type="button"
            key={t.label}
            className="lp-chip"
            onClick={() => setValue(t.prompt)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <label htmlFor="goal" className="lp-prompt-label">
        What&apos;s your 30-second video?
      </label>
      <textarea
        id="goal"
        className="lp-prompt-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. A 30-second ad that hooks fast, shows the problem, demos the product, and ends with a strong CTA."
        rows={3}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) start();
        }}
      />
      <button
        type="button"
        className="lp-prompt-submit"
        onClick={start}
        disabled={!value.trim() || submitting}
      >
        {submitting
          ? "Opening the studio…"
          : "Create my 30-second video →"}
      </button>
      <p className="lp-prompt-hint">
        No clips needed — aividi generates the visuals and cuts the video for
        you. Bring your own keys for real footage, or preview with placeholders.
      </p>
    </div>
  );
}
