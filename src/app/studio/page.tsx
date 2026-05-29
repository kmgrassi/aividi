"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Editor } from "@/components/Editor";

function StudioInner() {
  const params = useSearchParams();
  const goal = params.get("goal") ?? "";
  const length = Number(params.get("length")) || 30;
  const autostart = params.get("autostart") === "1";
  return (
    <Editor initialGoal={goal} initialLength={length} initialAutostart={autostart} />
  );
}

export default function StudioPage() {
  return (
    <Suspense fallback={null}>
      <StudioInner />
    </Suspense>
  );
}
